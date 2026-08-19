// POST /api/subscribe — mailing-list opt-in via SES identity verification.
// Privacy: never log email addresses; log shapes and outcomes only.

import { SESv2Client, CreateEmailIdentityCommand, GetEmailIdentityCommand, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ses = new SESv2Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// Global outbound circuit breaker: a backstop for the WAF per-IP/per-JA4
// rate limits. Even an actor rotating both IP and fingerprint can't cause
// more than this many new verification emails per hour, account-wide, which
// caps the worst-case spam-relay / reputation-burn blast radius. Generous
// vs. real signup volume; when tripped it's logged so we notice.
const GLOBAL_HOURLY_CAP = 200;

// Returns true if creating one more identity would exceed the hourly cap.
// Atomic counter in the same table under a sentinel key ('#' can't begin a
// real email), self-expiring via TTL. Fails open (returns false) so a
// counter error never blocks a legitimate signup.
const overGlobalCap = async () => {
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { email: `#send-quota#${hour}` },
      UpdateExpression: 'ADD n :one SET expiresAt = if_not_exists(expiresAt, :exp)',
      ExpressionAttributeValues: {
        ':one': 1,
        ':exp': Math.floor(Date.now() / 1000) + 2 * 3600,
      },
      ReturnValues: 'UPDATED_NEW',
    }));
    return (res.Attributes?.n ?? 0) > GLOBAL_HOURLY_CAP;
  } catch (err) {
    console.log(JSON.stringify({ outcome: 'quota_check_failed', code: err?.name }));
    return false;
  }
};

const notifyAdmin = async (email, how) => {
  // Best-effort: a notification failure must never fail the subscription.
  // In the SES sandbox this succeeds only once ADMIN_EMAIL is verified.
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: `VettID Mailing List <${process.env.SENDER_EMAIL}>`,
      Destination: { ToAddresses: [process.env.ADMIN_EMAIL] },
      Content: {
        Simple: {
          Subject: { Data: 'New mailing list subscriber' },
          Body: {
            Text: {
              Data:
                `A subscriber just confirmed their spot on the vettid.org mailing list.\n\n` +
                `Email: ${email}\n` +
                `Confirmed via: ${how}\n` +
                `At: ${new Date().toISOString()}\n`,
            },
          },
        },
      },
    }));
  } catch (err) {
    console.log(JSON.stringify({ outcome: 'notify_failed', code: err?.name }));
  }
};


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

  // New address = one verification email would go out. Check the global
  // hourly cap FIRST, and if exceeded, drop silently with the same generic
  // success — no identity created, no mail sent, no state leaked to the
  // caller. The WAF limits should make this unreachable in practice; it's
  // the last backstop against a distributed send flood.
  if (await overGlobalCap()) {
    console.log(JSON.stringify({ outcome: 'global_cap_reached' }));
    return ok({ ok: true });
  }

  let alreadyVerified = false;
  try {
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
  } catch (err) {
    if (err?.name !== 'AlreadyExistsException') {
      console.log(JSON.stringify({ outcome: 'ses_error', code: err?.name }));
      return ok({ ok: false, error: 'temporary failure, try again later' });
    }
    // Identity already exists (e.g. verified in an earlier era of this
    // account) — no new verification email goes out, so confirm directly
    // if it is already verified.
    try {
      const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
      alreadyVerified = identity.VerifiedForSendingStatus === true;
    } catch { /* fall through as pending */ }
  }

  const now = new Date();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: alreadyVerified ? {
      email,
      status: 'confirmed',
      requestedAt: now.toISOString(),
      confirmedAt: now.toISOString(),
    } : {
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

  if (alreadyVerified) {
    await notifyAdmin(email, 'already-verified identity (instant confirm)');
  }

  console.log(JSON.stringify({ outcome: alreadyVerified ? 'confirmed_direct' : 'pending_created' }));
  return ok({ ok: true });
};
