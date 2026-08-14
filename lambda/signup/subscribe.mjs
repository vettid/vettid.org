// POST /api/subscribe — mailing-list opt-in via SES identity verification.
// Privacy: never log email addresses; log shapes and outcomes only.

import { SESv2Client, CreateEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const ses = new SESv2Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const ok = (body) => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body ?? '{}');
  } catch {
    return ok({ ok: false, error: 'invalid request' });
  }

  // Honeypot: bots that fill the hidden field get a quiet fake success
  if (typeof payload.website === 'string' && payload.website.length > 0) {
    console.log(JSON.stringify({ outcome: 'honeypot' }));
    return ok({ ok: true });
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 320) {
    console.log(JSON.stringify({ outcome: 'invalid_email', length: email.length }));
    return ok({ ok: false, error: 'invalid email' });
  }

  // Idempotent + enumeration-safe: existing rows (any status) return the
  // same generic success as new ones.
  const existing = await ddb.send(new GetCommand({ TableName: TABLE, Key: { email } }));
  if (existing.Item) {
    console.log(JSON.stringify({ outcome: 'duplicate', status: existing.Item.status }));
    return ok({ ok: true });
  }

  try {
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
  } catch (err) {
    if (err?.name !== 'AlreadyExistsException') {
      console.log(JSON.stringify({ outcome: 'ses_error', code: err?.name }));
      return ok({ ok: false, error: 'temporary failure, try again later' });
    }
  }

  const now = new Date();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      email,
      status: 'pending',
      requestedAt: now.toISOString(),
      // TTL: unconfirmed rows purge after 3 days (SES links expire in 24h)
      expiresAt: Math.floor(now.getTime() / 1000) + 3 * 24 * 3600,
    },
    ConditionExpression: 'attribute_not_exists(email)',
  })).catch((err) => {
    if (err?.name !== 'ConditionalCheckFailedException') throw err;
  });

  console.log(JSON.stringify({ outcome: 'pending_created' }));
  return ok({ ok: true });
};
