import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { CreateEmailIdentityCommand, DeleteEmailIdentityCommand, GetEmailIdentityCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

Object.assign(process.env, {
  TABLE_NAME: 'list',
  MEMBERS_TABLE_NAME: 'members',
  ORIGIN_VERIFY_SECRET_ARN: 'origin',
  SENDER_EMAIL: 'no-reply@vettid.org',
  ADMIN_EMAIL: 'admin@vettid.org',
});

/**
 * The signup Lambdas are plain ESM (.mjs) and jest runs CommonJS, so load
 * them through esbuild's ESM→CJS transform and evaluate them with this test's
 * own `require`: dependencies resolve through jest's module registry, so
 * aws-sdk-client-mock patches the same SDK classes the handlers use.
 */
function loadMjs(rel: string): any {
  const file = resolve(__dirname, '../..', rel);
  const { code } = transformSync(readFileSync(file, 'utf8'), { format: 'cjs', loader: 'js', target: 'node20', sourcefile: file });
  const mod = { exports: {} as any };
  new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
  return mod.exports;
}

const ddb = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const sm = mockClient(SecretsManagerClient);

const subscribe = loadMjs('lambda/signup/subscribe.mjs');
const check = loadMjs('lambda/signup/check-verifications.mjs');

const ORIGIN = 'origin-secret-value';
const post = (body: unknown, headers: Record<string, string> = {}) =>
  ({
    rawPath: '/api/subscribe',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'x-origin-verify': ORIGIN, 'content-type': 'application/json', ...headers },
    requestContext: { http: { method: 'POST' } },
  }) as any;
const confirmEv = (t: string, headers: Record<string, string> = {}) =>
  ({
    rawPath: '/api/subscribe/confirm',
    queryStringParameters: { t },
    headers: { 'x-origin-verify': ORIGIN, ...headers },
    requestContext: { http: { method: 'GET' } },
  }) as any;

beforeEach(() => {
  ddb.reset(); ses.reset(); sm.reset();
  jest.spyOn(console, 'log').mockImplementation(() => undefined); // handlers log outcome shapes
  sm.on(GetSecretValueCommand, { SecretId: 'origin' }).resolves({ SecretString: ORIGIN });
  ddb.on(GetCommand).resolves({});
  ddb.on(PutCommand).resolves({});
  ddb.on(UpdateCommand).resolves({ Attributes: { n: 1 } });
  ses.on(SendEmailCommand).resolves({});
  ses.on(CreateEmailIdentityCommand).resolves({});
});

describe('subscribe: request guards', () => {
  test('requests without the CloudFront origin secret get 403 and touch nothing', async () => {
    for (const headers of [{ 'x-origin-verify': 'nope' }, { 'x-origin-verify': '' }]) {
      const res = await subscribe.handler(post({ email: 'a@example.com' }, headers));
      expect(res.statusCode).toBe(403);
    }
    expect(ddb.calls()).toHaveLength(0);
    expect(ses.calls()).toHaveLength(0);
  });

  test('confirm links need the origin secret too', async () => {
    const res = await subscribe.handler(confirmEv('x'.repeat(43), { 'x-origin-verify': 'nope' }));
    expect(res.statusCode).toBe(403);
  });

  test('non-JSON bodies (cross-site form posts) get 415', async () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
      const res = await subscribe.handler(post('{"email":"a@example.com"}', { 'content-type': ct }));
      expect(res.statusCode).toBe(415);
    }
    expect(ddb.calls()).toHaveLength(0);
  });

  test('application/json with a charset is accepted', async () => {
    ses.on(CreateEmailIdentityCommand).resolves({});
    const res = await subscribe.handler(post({ email: 'a@example.com' }, { 'content-type': 'Application/JSON; charset=utf-8' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

describe('subscribe: opt-in paths', () => {
  test('a new address goes through SES verification as a pending row', async () => {
    const res = await subscribe.handler(post({ email: 'New@Example.com' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(ses.commandCalls(CreateEmailIdentityCommand)[0].args[0].input).toEqual({ EmailIdentity: 'new@example.com' });
    const put = ddb.commandCalls(PutCommand)[0].args[0].input;
    expect(put.Item).toMatchObject({ email: 'new@example.com', status: 'pending' });
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  test('an already-verified address is NOT confirmed instantly: it gets a single-use link', async () => {
    ses.on(CreateEmailIdentityCommand).rejects(Object.assign(new Error('exists'), { name: 'AlreadyExistsException' }));
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
    const res = await subscribe.handler(post({ email: 'member@example.com' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const puts = ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item!);
    const row = puts.find((i) => i.email === 'member@example.com')!;
    expect(row.status).toBe('pending_link'); // not 'pending' (the sweep would confirm it) and not 'confirmed'
    const now = Math.floor(Date.now() / 1000);
    expect(row.expiresAt).toBeGreaterThan(now + 47 * 3600);
    expect(row.expiresAt).toBeLessThanOrEqual(now + 48 * 3600);

    const mail = ses.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(mail.Destination!.ToAddresses).toEqual(['member@example.com']);
    expect(mail.Content!.Simple!.Subject!.Data).toBe('Confirm your VettID updates subscription');
    const token = /https:\/\/vettid\.org\/api\/subscribe\/confirm\?t=([A-Za-z0-9_-]+)/.exec(mail.Content!.Simple!.Body!.Text!.Data!)![1];
    // Only the hash is stored, never the token.
    const hash = createHash('sha256').update(token).digest('hex');
    expect(row.tokenHash).toBe(hash);
    expect(JSON.stringify(puts)).not.toContain(token);
    expect(puts.find((i) => i.email === `#confirm#${hash}`)).toMatchObject({ target: 'member@example.com' });
  });

  test('the global hourly cap also covers confirmation-link mail', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: { n: 201 } });
    ses.on(CreateEmailIdentityCommand).rejects(Object.assign(new Error('exists'), { name: 'AlreadyExistsException' }));
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
    const res = await subscribe.handler(post({ email: 'member@example.com' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(ses.calls()).toHaveLength(0);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  test('existing rows get the same generic success and no mail', async () => {
    ddb.on(GetCommand).resolves({ Item: { email: 'a@example.com', status: 'confirmed' } });
    const res = await subscribe.handler(post({ email: 'a@example.com' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(ses.calls()).toHaveLength(0);
  });
});

describe('subscribe: confirm link', () => {
  const token = 'A'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  const future = () => Math.floor(Date.now() / 1000) + 3600;

  test('a valid link confirms (conditionally, single use) and redirects to the site', async () => {
    ddb.on(GetCommand, { Key: { email: `#confirm#${hash}` } }).resolves({ Item: { target: 'm@example.com', expiresAt: future() } });
    const res = await subscribe.handler(confirmEv(token));
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://vettid.org/?subscribed=1');
    const upd = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(upd.Key).toEqual({ email: 'm@example.com' });
    expect(upd.ConditionExpression).toContain('tokenHash = :h');
    expect(upd.ExpressionAttributeValues![':h']).toBe(hash);
    expect(upd.ExpressionAttributeValues![':awaiting']).toBe('pending_link');
  });

  test('replayed / stale links do not confirm', async () => {
    ddb.on(GetCommand, { Key: { email: `#confirm#${hash}` } }).resolves({ Item: { target: 'm@example.com', expiresAt: future() } });
    ddb.on(UpdateCommand).rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    const res = await subscribe.handler(confirmEv(token));
    expect(res.headers.location).toBe('https://vettid.org/?subscribed=0');
    expect(ses.calls()).toHaveLength(0);
  });

  test('expired, unknown and malformed tokens do not confirm', async () => {
    ddb.on(GetCommand, { Key: { email: `#confirm#${hash}` } }).resolves({ Item: { target: 'm@example.com', expiresAt: 1 } });
    for (const t of [token, 'B'.repeat(43), 'short', '']) {
      const res = await subscribe.handler(confirmEv(t));
      expect(res.headers.location).toBe('https://vettid.org/?subscribed=0');
    }
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});

describe('check-verifications: identity reclaim', () => {
  const expiredRow = { email: 'x@example.com', status: 'pending', expiresAt: 1 };
  beforeEach(() => {
    ddb.on(QueryCommand, { TableName: 'list' }).resolves({ Items: [expiredRow] });
    ddb.on(DeleteCommand).resolves({});
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: false });
    ses.on(DeleteEmailIdentityCommand).resolves({});
  });

  test('deletes an unverified identity when no member uses the address', async () => {
    ddb.on(QueryCommand, { TableName: 'members' }).resolves({ Items: [] });
    const out = await check.handler();
    expect(out).toMatchObject({ reclaimed: 1, keptForMember: 0 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(1);
  });

  test("keeps the identity when a member row has the address (a pending member's verification)", async () => {
    ddb.on(QueryCommand, { TableName: 'members' }).resolves({ Items: [{ user_guid: 'g' }] });
    const out = await check.handler();
    expect(out).toMatchObject({ reclaimed: 0, keptForMember: 1 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
    const q = ddb.commandCalls(QueryCommand).find((c) => c.args[0].input.TableName === 'members')!.args[0].input;
    expect(q).toMatchObject({ IndexName: 'email-index', ExpressionAttributeValues: { ':e': 'x@example.com' } });
    // our expired row is still cleaned up
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  test('a failed member lookup keeps the identity (fail safe)', async () => {
    ddb.on(QueryCommand, { TableName: 'members' }).rejects(new Error('boom'));
    await check.handler();
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
  });

  test('pending_link rows are never swept to confirmed (only status=pending is queried)', async () => {
    await check.handler();
    const q = ddb.commandCalls(QueryCommand).find((c) => c.args[0].input.TableName === 'list')!.args[0].input;
    expect(q.ExpressionAttributeValues).toEqual({ ':pending': 'pending' });
  });
});
