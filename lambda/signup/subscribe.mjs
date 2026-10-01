// Mailing-list signup API (behind the vettid.org CloudFront /api/* behavior):
//
//   POST /api/subscribe          opt-in via SES identity verification, or —
//                                for an address SES has already verified —
//                                via our own single-use confirmation link
//   GET  /api/subscribe/confirm  ?t=<token> from that link; confirms and
//                                302s back to the site
//
// Every request must carry CloudFront's X-Origin-Verify secret: the
// execute-api URL is public, and without the check anyone could skip the
// site's WAF rate limits by calling it directly.
// Privacy: never log email addresses; log shapes and outcomes only.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SESv2Client, CreateEmailIdentityCommand, GetEmailIdentityCommand, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const ses = new SESv2Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const secrets = new SecretsManagerClient({});
const TABLE = process.env.TABLE_NAME;

const SITE = 'https://vettid.org';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// Our own confirmation links (already-SES-verified addresses) live 48h.
const CONFIRM_TTL_SECONDS = 48 * 3600;
// Rows awaiting our confirmation link. Deliberately NOT 'pending': the
// verification sweep (check-verifications.mjs) promotes 'pending' rows whose
// SES identity is verified — which these addresses already are, so the
// sweep would confirm them without the owner's consent.
const AWAITING_LINK = 'pending_link';
// Pointer items '#confirm#<sha256(token)>' → email. '#' can't begin a real
// address (same convention as the send-quota sentinel).
const confirmKey = (hash) => `#confirm#${hash}`;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Global outbound circuit breaker: a backstop for the WAF per-IP/per-JA4
// rate limits. Even an actor rotating both IP and fingerprint can't cause
// more than this many outbound emails per hour (SES verification mails and
// our confirmation mails share the budget), which caps the worst-case
// spam-relay / reputation-burn blast radius. Generous vs. real signup
// volume; when tripped it's logged so we notice.
const GLOBAL_HOURLY_CAP = 200;

// Returns true if sending one more email would exceed the hourly cap.
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

// ---- origin verification ------------------------------------------------------

const SECRET_CACHE_MS = 5 * 60 * 1000;
let cachedSecret; // { value, at }

const originSecret = async () => {
  if (cachedSecret && Date.now() - cachedSecret.at < SECRET_CACHE_MS) return cachedSecret.value;
  const res = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.ORIGIN_VERIFY_SECRET_ARN }));
  cachedSecret = { value: res.SecretString ?? '', at: Date.now() };
  return cachedSecret.value;
};

const fromCloudFront = async (event) => {
  const given = Buffer.from(event.headers?.['x-origin-verify'] ?? '');
  const expected = Buffer.from(await originSecret());
  return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
};

// ---- responses ------------------------------------------------------------------

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});
const ok = (body) => json(200, body);
const redirect = (location) => ({
  statusCode: 302,
  headers: { location, 'cache-control': 'no-store' },
  body: '',
});

// ---- mail -----------------------------------------------------------------------

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

const sendConfirmLink = (email, token) =>
  ses.send(new SendEmailCommand({
    FromEmailAddress: `VettID <${process.env.SENDER_EMAIL}>`,
    Destination: { ToAddresses: [email] },
    Content: {
      Simple: {
        Subject: { Data: 'Confirm your VettID updates subscription' },
        Body: {
          Text: {
            Data:
              `Someone (hopefully you) asked to receive VettID updates at this address.\n\n` +
              `To confirm, open this link within 48 hours:\n\n` +
              `${SITE}/api/subscribe/confirm?t=${token}\n\n` +
              `If this wasn't you, ignore this email and you won't hear from us.\n`,
          },
        },
      },
    },
  }));

// ---- POST /api/subscribe --------------------------------------------------------

const subscribe = async (event) => {
  // JSON only: a cross-site <form> can only send urlencoded, multipart or
  // text/plain without a CORS preflight, so this shuts out forged posts.
  const mediaType = String(event.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    console.log(JSON.stringify({ outcome: 'unsupported_media_type' }));
    return json(415, { ok: false, error: 'unsupported media type' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body ?? '{}');
  } catch {
    return ok({ ok: false, error: 'invalid request' });
  }
  if (!payload || typeof payload !== 'object') return ok({ ok: false, error: 'invalid request' });

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

  // New address = one email would go out (SES's verification or our
  // confirmation link). Check the global hourly cap FIRST, and if exceeded,
  // drop silently with the same generic success — no identity created, no
  // mail sent, no state leaked to the caller. The WAF limits should make
  // this unreachable in practice; it's the last backstop against a
  // distributed send flood.
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
    // Identity already exists (a VettID member, or verified in an earlier
    // era of this account) — SES sends no new verification email, so if it
    // is verified we ask the owner ourselves before subscribing them.
    try {
      const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
      alreadyVerified = identity.VerifiedForSendingStatus === true;
    } catch { /* fall through as pending */ }
  }

  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);

  if (!alreadyVerified) {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        email,
        status: 'pending',
        requestedAt: now.toISOString(),
        // TTL: unconfirmed rows purge after 3 days (SES links expire in 24h)
        expiresAt: nowSec + 3 * 24 * 3600,
      },
      ConditionExpression: 'attribute_not_exists(email)',
    })).catch((err) => {
      if (err?.name !== 'ConditionalCheckFailedException') throw err;
    });
    console.log(JSON.stringify({ outcome: 'pending_created' }));
    return ok({ ok: true });
  }

  // Already verified with SES: that proves the address once worked, not that
  // its owner wants this list. Send our own single-use link; only its hash
  // is stored.
  const token = randomBytes(32).toString('base64url');
  const hash = sha256(token);
  const expiresAt = nowSec + CONFIRM_TTL_SECONDS;
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { email, status: AWAITING_LINK, requestedAt: now.toISOString(), tokenHash: hash, expiresAt },
      ConditionExpression: 'attribute_not_exists(email)',
    }));
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') throw err;
    console.log(JSON.stringify({ outcome: 'duplicate_race' }));
    return ok({ ok: true });
  }
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { email: confirmKey(hash), target: email, expiresAt },
  }));
  try {
    await sendConfirmLink(email, token);
  } catch (err) {
    console.log(JSON.stringify({ outcome: 'confirm_send_failed', code: err?.name }));
    return ok({ ok: false, error: 'temporary failure, try again later' });
  }
  console.log(JSON.stringify({ outcome: 'confirm_link_sent' }));
  return ok({ ok: true });
};

// ---- GET /api/subscribe/confirm -------------------------------------------------

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

const confirm = async (event) => {
  const done = redirect(`${SITE}/?subscribed=1`);
  const failed = redirect(`${SITE}/?subscribed=0`);
  const token = event.queryStringParameters?.t ?? '';
  if (!TOKEN_RE.test(token)) {
    console.log(JSON.stringify({ outcome: 'confirm_malformed' }));
    return failed;
  }
  const hash = sha256(token);
  const nowSec = Math.floor(Date.now() / 1000);

  const pointer = await ddb.send(new GetCommand({ TableName: TABLE, Key: { email: confirmKey(hash) } }));
  const email = pointer.Item?.target;
  // DynamoDB TTL deletion lags; enforce expiry here.
  if (typeof email !== 'string' || !(pointer.Item.expiresAt > nowSec)) {
    console.log(JSON.stringify({ outcome: 'confirm_unknown_or_expired' }));
    return failed;
  }

  // Single use: the condition only holds while the row still awaits THIS
  // token, so a replayed link (or a stale one after re-subscribing) fails.
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { email },
      UpdateExpression: 'SET #s = :confirmed, confirmedAt = :now REMOVE expiresAt, tokenHash',
      ConditionExpression: '#s = :awaiting AND tokenHash = :h AND expiresAt > :nowSec',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':confirmed': 'confirmed',
        ':awaiting': AWAITING_LINK,
        ':h': hash,
        ':now': new Date().toISOString(),
        ':nowSec': nowSec,
      },
    }));
  } catch (err) {
    if (err?.name !== 'ConditionalCheckFailedException') throw err;
    console.log(JSON.stringify({ outcome: 'confirm_stale' }));
    return failed;
  }
  await notifyAdmin(email, 'confirmation link (address was already SES-verified)');
  console.log(JSON.stringify({ outcome: 'confirmed_link' }));
  return done;
};

// ---- entry ----------------------------------------------------------------------

export const handler = async (event) => {
  if (!(await fromCloudFront(event))) {
    console.log(JSON.stringify({ outcome: 'origin_rejected' }));
    return json(403, { ok: false, error: 'forbidden' });
  }
  const method = event.requestContext?.http?.method;
  const path = event.rawPath;
  if (method === 'GET' && path === '/api/subscribe/confirm') return confirm(event);
  if (method === 'POST' && path === '/api/subscribe') return subscribe(event);
  return json(404, { ok: false, error: 'not found' });
};
