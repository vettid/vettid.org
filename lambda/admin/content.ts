/**
 * Admin route group: membership terms and subscription types.
 *   /admin/terms/*  /admin/subscription-types/*
 * Contract: docs/ADMIN-API.md.
 */
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'node:crypto';
import { audit } from '../shared/audit';
import { adminHandler } from '../shared/admin-handler';
import { ddb, env, s3, table } from '../shared/aws';
import { Router, badRequest, bool, conflict, decodeCursor, encodeCursor, int, notFound, str } from '../shared/http';
import { nowIso } from '../shared/ids';
import { checkTermsText, normalizeTermsText, renderTermsPdf, sha256Hex } from '../shared/terms-pdf';

const MAX_TEXT_CHARS = 200_000;
const bucket = () => env('TERMS_BUCKET');
const pdfKey = (version: string) => `terms/${version}.pdf`;
const textKey = (version: string) => `terms/${version}.txt`;

/**
 * Terms are authored as plain text. The text (normalized) is the source of
 * truth: `sha256` is its hash and is what a member's acceptance records. The
 * PDF is generated from it at creation and stored alongside.
 */
interface TermsItem {
  version_id: string;
  title: string;
  status: 'draft' | 'current' | 'superseded';
  sha256: string; // of the normalized text
  pdf_sha256: string;
  chars: number;
  created_at: string;
  created_by: string;
  // Absent (never null) until published: published_at is the status-index
  // sort key, and DynamoDB rejects a NULL index key.
  published_at?: string;
  published_by?: string;
}

const termsView = (t: TermsItem) => ({ ...t, published_at: t.published_at ?? null, published_by: t.published_by ?? null });

const router = new Router();

// ---- terms --------------------------------------------------------------------

router.on('GET', '/admin/terms', async ({ query }) => {
  // Versions are few; scan + sort newest first.
  const r = await ddb.send(new ScanCommand({ TableName: table.terms(), Limit: 200, ExclusiveStartKey: decodeCursor(query.cursor) }));
  const items = ((r.Items ?? []) as TermsItem[]).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(termsView);
  return { items, cursor: encodeCursor(r.LastEvaluatedKey) };
});

router.on('POST', '/admin/terms', async ({ body, actor }) => {
  const title = str(body, 'title', { max: 200 });
  const text = normalizeTermsText(str(body, 'text', { max: MAX_TEXT_CHARS }));
  if (!text) throw badRequest('text is empty');
  const bad = await checkTermsText(text + title);
  if (bad.length) {
    const shown = bad.slice(0, 10).map((c) => `"${c}" (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`);
    throw badRequest(`These characters can't be rendered in the PDF; replace them and try again: ${shown.join(', ')}${bad.length > 10 ? ', …' : ''}`);
  }

  const now = nowIso();
  // e.g. 2026-10-01T153012-3f9a: sortable, readable in audit and file names.
  const version_id = `${now.slice(0, 19).replace(/:/g, '')}-${randomBytes(2).toString('hex')}`;
  const textSha = sha256Hex(text);
  const pdf = await renderTermsPdf({ title, versionId: version_id, text, textSha256: textSha });

  await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: textKey(version_id), Body: text, ContentType: 'text/plain; charset=utf-8' }));
  await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: pdfKey(version_id), Body: pdf, ContentType: 'application/pdf' }));

  const item: TermsItem = {
    version_id,
    title,
    status: 'draft',
    sha256: textSha,
    pdf_sha256: sha256Hex(pdf),
    chars: text.length,
    created_at: now,
    created_by: actor,
  };
  await ddb.send(new PutCommand({ TableName: table.terms(), Item: item, ConditionExpression: 'attribute_not_exists(version_id)' }));
  await audit(actor, 'terms.create', version_id, { title, sha256: textSha, chars: text.length });
  return termsView(item);
});

async function getTerms(version: string): Promise<TermsItem> {
  const r = await ddb.send(new GetCommand({ TableName: table.terms(), Key: { version_id: version } }));
  if (!r.Item) throw notFound('No such terms version');
  return r.Item as TermsItem;
}

router.on('POST', '/admin/terms/{version_id}/publish', async ({ params, actor }) => {
  const t = await getTerms(params.version_id);
  if (t.status !== 'draft') throw conflict(`Version is ${t.status}`);

  const current = await ddb.send(
    new QueryCommand({
      TableName: table.terms(),
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :c',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':c': 'current' },
    }),
  );
  const now = nowIso();
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        ...(current.Items ?? []).map((c) => ({
          Update: {
            TableName: table.terms(),
            Key: { version_id: c.version_id },
            UpdateExpression: 'SET #s = :sup',
            ConditionExpression: '#s = :c',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':sup': 'superseded', ':c': 'current' },
          },
        })),
        {
          Update: {
            TableName: table.terms(),
            Key: { version_id: t.version_id },
            UpdateExpression: 'SET #s = :c, published_at = :n, published_by = :a',
            ConditionExpression: '#s = :d',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':c': 'current', ':n': now, ':a': actor, ':d': 'draft' },
          },
        },
      ],
    }),
  );
  await audit(actor, 'terms.publish', t.version_id, { sha256: t.sha256, superseded: (current.Items ?? []).map((c) => c.version_id) });
  return termsView({ ...t, status: 'current', published_at: now, published_by: actor });
});

router.on('DELETE', '/admin/terms/{version_id}', async ({ params, actor }) => {
  const t = await getTerms(params.version_id);
  if (t.status !== 'draft') throw conflict('Only drafts can be deleted; published terms are a permanent record');
  await ddb.send(
    new DeleteCommand({
      TableName: table.terms(),
      Key: { version_id: t.version_id },
      ConditionExpression: '#s = :d',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':d': 'draft' },
    }),
  );
  await s3.send(
    new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: [{ Key: pdfKey(t.version_id) }, { Key: textKey(t.version_id) }] } }),
  );
  await audit(actor, 'terms.delete_draft', t.version_id, { title: t.title });
  return { ok: true };
});

router.on('GET', '/admin/terms/{version_id}/download-url', async ({ params }) => {
  await getTerms(params.version_id);
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket(),
      Key: pdfKey(params.version_id),
      ResponseContentDisposition: `inline; filename="vettid-terms-${params.version_id}.pdf"`,
    }),
    { expiresIn: 300 },
  );
  return { url };
});

// ---- subscription types -------------------------------------------------------

interface SubscriptionTypeItem {
  type_id: string;
  name: string;
  description: string;
  duration_days: number;
  is_trial: boolean;
  paid: boolean;
  enabled: boolean;
  created_at: string;
}

router.on('GET', '/admin/subscription-types', async ({ query }) => {
  const r = await ddb.send(new ScanCommand({ TableName: table.subscriptionTypes(), Limit: 200, ExclusiveStartKey: decodeCursor(query.cursor) }));
  const items = ((r.Items ?? []) as SubscriptionTypeItem[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { items, cursor: encodeCursor(r.LastEvaluatedKey) };
});

router.on('POST', '/admin/subscription-types', async ({ body, actor }) => {
  const name = str(body, 'name', { max: 80 });
  const item: SubscriptionTypeItem = {
    type_id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || randomBytes(4).toString('hex'),
    name,
    description: str(body, 'description', { optional: true, max: 500 }),
    duration_days: int(body, 'duration_days', 1, 3660),
    is_trial: bool(body, 'is_trial'),
    paid: bool(body, 'paid'),
    enabled: true,
    created_at: nowIso(),
  };
  if (item.is_trial && item.paid) throw badRequest('A trial cannot be paid');
  try {
    await ddb.send(new PutCommand({ TableName: table.subscriptionTypes(), Item: item, ConditionExpression: 'attribute_not_exists(type_id)' }));
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw conflict('A type with that name already exists');
    throw e;
  }
  await audit(actor, 'subscription_type.create', item.type_id, { ...item });
  return item;
});

for (const [verb, enabled] of [['enable', true], ['disable', false]] as const) {
  router.on('POST', `/admin/subscription-types/{type_id}/${verb}`, async ({ params, actor }) => {
    try {
      const r = await ddb.send(
        new UpdateCommand({
          TableName: table.subscriptionTypes(),
          Key: { type_id: params.type_id },
          UpdateExpression: 'SET enabled = :e',
          ConditionExpression: 'attribute_exists(type_id)',
          ExpressionAttributeValues: { ':e': enabled },
          ReturnValues: 'ALL_NEW',
        }),
      );
      await audit(actor, `subscription_type.${verb}`, params.type_id);
      return r.Attributes;
    } catch (e) {
      if ((e as Error).name === 'ConditionalCheckFailedException') throw notFound('No such subscription type');
      throw e;
    }
  });
}

export const handler = adminHandler(router);
