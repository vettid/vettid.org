import { mockClient } from 'aws-sdk-client-mock';
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PDFDocument } from 'pdf-lib';
import { checkTermsText, normalizeTermsText, renderTermsPdf, sha256Hex } from '../../lambda/shared/terms-pdf';

process.env.ALLOWED_ORIGIN = 'https://admin.vettid.org';
process.env.TERMS_BUCKET = 'terms-bucket';
for (const [k, v] of Object.entries({
  TABLE_MEMBERS: 'members', TABLE_INVITES: 'invites', TABLE_TERMS: 'terms',
  TABLE_SUBSCRIPTIONS: 'subs', TABLE_SUBSCRIPTION_TYPES: 'types', TABLE_AUDIT: 'audit',
})) process.env[k] = v;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../../lambda/admin/content');
const ddb = mockClient(DynamoDBDocumentClient);
const s3 = mockClient(S3Client);

const event = (method: string, path: string, body?: unknown) =>
  ({
    httpMethod: method, path, isBase64Encoded: false, queryStringParameters: null,
    body: body === undefined ? null : JSON.stringify(body),
    requestContext: { authorizer: { claims: { email: 'al@vettid.org', 'cognito:groups': 'admin' } } },
  }) as any;

describe('terms text → PDF', () => {
  test('normalization makes equivalent text hash identically', () => {
    const a = normalizeTermsText('Para one.  \r\nline two\r\n\r\n\r\n\r\nPara two.\t\n');
    const b = normalizeTermsText('Para one.\nline two\n\nPara two.');
    expect(a).toBe('Para one.\nline two\n\nPara two.');
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  test('curly quotes and dashes are fine; emoji and CJK are reported', async () => {
    expect(await checkTermsText('“Members” — must ‘accept’ – the terms… © 2026')).toEqual([]);
    expect(await checkTermsText('ok 😀 好')).toEqual(['😀', '好']);
  });

  test('renders a multi-page PDF with metadata', async () => {
    const para = 'Members agree to these terms. '.repeat(40);
    const text = normalizeTermsText(Array.from({ length: 30 }, (_, i) => `${i + 1}. ${para}`).join('\n\n'));
    const pdf = await renderTermsPdf({ title: 'Sample', versionId: '2026-10-01T120000-abcd', text, textSha256: sha256Hex(text) });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe('Sample');
  });

  test('hard-breaks a word longer than the line instead of overflowing', async () => {
    const pdf = await renderTermsPdf({ title: 'T', versionId: 'v', text: 'x'.repeat(2000), textSha256: 'h'.repeat(64) });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('admin terms routes', () => {
  beforeEach(() => {
    ddb.reset();
    s3.reset();
    ddb.on(PutCommand).resolves({});
    s3.on(PutObjectCommand).resolves({});
  });

  test('create stores normalized text + generated PDF, records the text hash, audits', async () => {
    const res = await handler(event('POST', '/admin/terms', { title: 'Terms v1', text: 'Hello.  \r\n\r\n\r\nWorld.' }));
    expect(res.statusCode).toBe(200);
    const item = JSON.parse(res.body);
    expect(item).toMatchObject({ title: 'Terms v1', status: 'draft', sha256: sha256Hex('Hello.\n\nWorld.'), chars: 14 });

    const puts = s3.commandCalls(PutObjectCommand).map((c) => c.args[0].input);
    expect(puts.map((p) => [p.Key, p.ContentType])).toEqual([
      [`terms/${item.version_id}.txt`, 'text/plain; charset=utf-8'],
      [`terms/${item.version_id}.pdf`, 'application/pdf'],
    ]);
    expect(puts[0].Body).toBe('Hello.\n\nWorld.');
    const auditPut = ddb.commandCalls(PutCommand).find((c) => c.args[0].input.TableName === 'audit')!;
    expect(auditPut.args[0].input.Item).toMatchObject({ action: 'terms.create', actor: 'al@vettid.org' });
  });

  test('unrenderable characters are rejected with their code points, nothing stored', async () => {
    const res = await handler(event('POST', '/admin/terms', { title: 'T', text: 'Smile 😀' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toContain('U+1F600');
    expect(s3.calls()).toHaveLength(0);
  });

  test('only drafts can be deleted', async () => {
    ddb.on(GetCommand).resolves({ Item: { version_id: 'v1', status: 'current', title: 'T' } });
    expect((await handler(event('DELETE', '/admin/terms/v1'))).statusCode).toBe(409);

    ddb.on(GetCommand).resolves({ Item: { version_id: 'v1', status: 'draft', title: 'T' } });
    ddb.on(DeleteCommand).resolves({});
    s3.on(DeleteObjectsCommand).resolves({});
    expect((await handler(event('DELETE', '/admin/terms/v1'))).statusCode).toBe(200);
    expect(s3.commandCalls(DeleteObjectsCommand)[0].args[0].input.Delete?.Objects).toHaveLength(2);
  });
});
