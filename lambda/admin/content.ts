/**
 * Admin route group: membership terms and subscription types.
 *   /admin/terms/*  /admin/subscription-types/*
 * Contract: docs/ADMIN-API.md.
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { audit } from '../shared/audit';
import { adminHandler } from '../shared/admin-handler';
import { ddb, env, s3, table } from '../shared/aws';
import { Router, badRequest, bool, conflict, decodeCursor, encodeCursor, int, notFound, str } from '../shared/http';
import { nowIso } from '../shared/ids';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const bucket = () => env('TERMS_BUCKET');
const pdfKey = (version: string) => `terms/${version}.pdf`;

interface TermsItem {
  version_id: string;
  title: string;
  status: 'draft' | 'current' | 'superseded';
  sha256: string | null;
  created_at: string;
  created_by: string;
  published_at: string | null;
  published_by: string | null;
}

const router = new Router();

// ---- terms --------------------------------------------------------------------

router.on('GET', '/admin/terms', async ({ query }) => {
  // Versions are few; scan + sort newest first.
  const r = await ddb.send(new ScanCommand({ TableName: table.terms(), Limit: 200, ExclusiveStartKey: decodeCursor(query.cursor) }));
  const items = ((r.Items ?? []) as TermsItem[]).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { items, cursor: encodeCursor(r.LastEvaluatedKey) };
});

router.on('POST', '/admin/terms', async ({ body, actor }) => {
  const title = str(body, 'title', { max: 200 });
  const now = nowIso();
  // e.g. 2026-10-01T153012-3f9a — sortable, readable in audit and file names.
  const version_id = `${now.slice(0, 19).replace(/:/g, '')}-${randomBytes(2).toString('hex')}`;
  const item: TermsItem = {
    version_id,
    title,
    status: 'draft',
    sha256: null,
    created_at: now,
    created_by: actor,
    published_at: null,
    published_by: null,
  };
  await ddb.send(new PutCommand({ TableName: table.terms(), Item: item, ConditionExpression: 'attribute_not_exists(version_id)' }));
  const upload_url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket(), Key: pdfKey(version_id), ContentType: 'application/pdf' }),
    { expiresIn: 900 },
  );
  await audit(actor, 'terms.create', version_id, { title });
  return { terms: item, upload_url };
});

async function sha256Of(stream: Readable): Promise<{ hash: string; head: Buffer }> {
  const h = createHash('sha256');
  let head = Buffer.alloc(0);
  for await (const chunk of stream) {
    const b = chunk as Buffer;
    if (head.length < 5) head = Buffer.concat([head, b.subarray(0, 5 - head.length)]);
    h.update(b);
  }
  return { hash: h.digest('hex'), head };
}

router.on('POST', '/admin/terms/{version_id}/publish', async ({ params, actor }) => {
  const r = await ddb.send(new GetCommand({ TableName: table.terms(), Key: { version_id: params.version_id } }));
  const t = r.Item as TermsItem | undefined;
  if (!t) throw notFound('No such terms version');
  if (t.status !== 'draft') throw conflict(`Version is ${t.status}`);

  let size: number;
  try {
    size = (await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: pdfKey(t.version_id) }))).ContentLength ?? 0;
  } catch {
    throw conflict('No PDF uploaded for this version yet');
  }
  if (size > MAX_PDF_BYTES) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: pdfKey(t.version_id) }));
    throw badRequest('PDF exceeds 10 MB; upload a smaller file');
  }
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: pdfKey(t.version_id) }));
  const { hash, head } = await sha256Of(obj.Body as Readable);
  if (head.toString('latin1') !== '%PDF-') throw badRequest('Uploaded file is not a PDF');

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
            UpdateExpression: 'SET #s = :c, sha256 = :h, published_at = :n, published_by = :a',
            ConditionExpression: '#s = :d',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':c': 'current', ':h': hash, ':n': now, ':a': actor, ':d': 'draft' },
          },
        },
      ],
    }),
  );
  await audit(actor, 'terms.publish', t.version_id, { sha256: hash, superseded: (current.Items ?? []).map((c) => c.version_id) });
  return { ...t, status: 'current', sha256: hash, published_at: now, published_by: actor };
});

router.on('GET', '/admin/terms/{version_id}/download-url', async ({ params }) => {
  const r = await ddb.send(new GetCommand({ TableName: table.terms(), Key: { version_id: params.version_id } }));
  if (!r.Item) throw notFound('No such terms version');
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
