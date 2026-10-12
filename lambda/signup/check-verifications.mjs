// Scheduled every 15 minutes:
//  - finish unsubscribes: for each release marker subscribe.mjs left, delete
//    the address's SES identity. Only an identity the list itself created is
//    ever deleted (the marker says so), and not while something else uses it;
//  - promote pending subscribers whose SES identity verification succeeded
//    (the user accepted the SES verification email), and send them the
//    welcome mail: the first mail of ours they get, and so the first with
//    their unsubscribe link.
// The two halves run independently: a failure in one does not stop the other.
// Privacy: never log email addresses or tokens; log counts only.

import { SESv2Client, GetEmailIdentityCommand, DeleteEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { listMessage, newUnsubscribeToken, notifyAdmin } from './list-mail.mjs';

const ses = new SESv2Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;
// VettID members share SES identities with the mailing list (both use SES
// verification as the opt-in). Never reclaim an identity a member row uses.
const MEMBERS_TABLE = process.env.MEMBERS_TABLE_NAME;

// A release that keeps failing is retried at every sweep for this long, then
// abandoned (see abandon()). The alarm on retries fires within the first
// hour, so this is the time the operator has to look.
const RELEASE_GIVE_UP_SECONDS = 7 * 24 * 3600;
// An abandoned marker stays, without the address, as a count for this long.
const ABANDONED_KEPT_SECONDS = 90 * 24 * 3600;
// Stop taking new markers this long into a run (the function has 2 minutes).
const RELEASE_BUDGET_MS = 60 * 1000;

// Does any member row (any state) use this address? 'unknown' when a lookup
// fails: a failed lookup must never lead to deleting someone's identity.
// The marker row `email:<addr>` is written in one transaction with the
// member row (lambda/shared/members.ts) and is read strongly consistent, so
// a member who registered a moment ago is seen; the index, which lags by a
// second or so, also catches a member row whose marker is missing.
const memberUse = async (email) => {
  try {
    const marker = await ddb.send(new GetCommand({
      TableName: MEMBERS_TABLE,
      Key: { user_guid: `email:${email}` },
      ConsistentRead: true,
    }));
    if (marker.Item) return 'yes';
    const res = await ddb.send(new QueryCommand({
      TableName: MEMBERS_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :e',
      ExpressionAttributeValues: { ':e': email },
      Limit: 1,
    }));
    return (res.Items?.length ?? 0) > 0 ? 'yes' : 'no';
  } catch (err) {
    console.log(JSON.stringify({ outcome: 'member_lookup_failed', code: err?.name }));
    return 'unknown';
  }
};

// The project's own addresses (admin@, no-reply@, …) are never reclaimed.
const ownAddress = (email) => /@([a-z0-9-]+\.)*vettid\.org$/.test(email);

const sendWelcome = async (email, token) => {
  // Best-effort, like the admin notice: the subscription stands either way,
  // and every later mailing carries the link too.
  try {
    await ses.send(listMessage({
      to: email,
      subject: 'You are on the VettID mailing list',
      text:
        `Thanks for confirming. You are on the VettID mailing list: we will write when membership opens, ` +
        `and with VettID updates. That is all we use this address for.\n`,
      token,
    }));
  } catch (err) {
    console.log(JSON.stringify({ outcome: 'welcome_failed', code: err?.name }));
  }
};

// ---- releases (finishing unsubscribes) ------------------------------------------

// Giving up on a release: the address is taken OFF the marker, so it does
// not sit in the table for ever, and the marker leaves the retry queue. The
// identity is NOT deleted (never on doubt): it stays in SES until the
// operator reconciles (RUNBOOK "Mailing list" → Unsubscribe). What is left
// of the marker is a count, and it expires.
const abandon = async (marker, nowSec) => {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { email: marker.email },
    UpdateExpression: 'SET #s = :abandoned, abandonedAt = :now, expiresAt = :exp REMOVE #t',
    ExpressionAttributeNames: { '#s': 'status', '#t': 'target' },
    ExpressionAttributeValues: {
      ':abandoned': 'release_abandoned',
      ':now': new Date(nowSec * 1000).toISOString(),
      ':exp': nowSec + ABANDONED_KEPT_SECONDS,
    },
  }));
};

// One marker. Returns 'released' | 'kept' | 'retry'; throws on a failure
// (the caller counts it as a retry).
const release = async (marker) => {
  const email = marker.target;
  const settle = () => ddb.send(new DeleteCommand({ TableName: TABLE, Key: { email: marker.email } }));

  // Only an identity the list created (CreateEmailIdentity succeeded for
  // that row) is the list's to delete. Any other existed before, or belongs
  // to something else, and is left alone.
  if (marker.ownsIdentity !== true || typeof email !== 'string' || ownAddress(email)) {
    await settle();
    return 'kept';
  }
  // Back on the list already (signed up again, or the row's delete did not
  // happen): the identity is still in use. It is still the list's own, so
  // the row takes the flag over.
  const row = await ddb.send(new GetCommand({ TableName: TABLE, Key: { email }, ConsistentRead: true }));
  if (row.Item) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { email },
        UpdateExpression: 'SET ownsIdentity = :true',
        ConditionExpression: 'attribute_exists(email)',
        ExpressionAttributeValues: { ':true': true },
      }));
    } catch (err) {
      if (err?.name !== 'ConditionalCheckFailedException') throw err;
      return 'retry'; // the row went again meanwhile: look afresh next sweep
    }
    await settle();
    return 'kept';
  }
  const use = await memberUse(email);
  if (use === 'unknown') return 'retry';
  if (use === 'yes') {
    await settle();
    return 'kept';
  }
  try {
    await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: email }));
  } catch (err) {
    if (err?.name !== 'NotFoundException') throw err; // already gone
  }
  await settle();
  return 'released';
};

const releaseIdentities = async () => {
  const started = Date.now();
  const counts = { released: 0, releaseKept: 0, releaseRetry: 0, releaseAbandoned: 0 };
  let start;
  do {
    // Newest first, and every page: a marker that keeps failing can neither
    // hold up a newer one nor push it out of reach.
    const page = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :release',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':release': 'release' },
      ScanIndexForward: false,
      Limit: 100,
      ExclusiveStartKey: start,
    }));
    for (const marker of page.Items ?? []) {
      let outcome = 'retry';
      try {
        outcome = await release(marker);
      } catch (err) {
        console.log(JSON.stringify({ outcome: 'release_failed', code: err?.name }));
      }
      if (outcome === 'released') counts.released += 1;
      else if (outcome === 'kept') counts.releaseKept += 1;
      else {
        const nowSec = Math.floor(Date.now() / 1000);
        const since = Math.floor(Date.parse(marker.requestedAt ?? '') / 1000);
        // A marker with no readable date is treated as old.
        const old = !(since > nowSec - RELEASE_GIVE_UP_SECONDS);
        let abandoned = false;
        if (old) {
          try {
            await abandon(marker, nowSec);
            abandoned = true;
          } catch (err) {
            console.log(JSON.stringify({ outcome: 'release_abandon_failed', code: err?.name }));
          }
        }
        if (abandoned) counts.releaseAbandoned += 1;
        else counts.releaseRetry += 1;
      }
    }
    start = page.LastEvaluatedKey;
  } while (start && Date.now() - started < RELEASE_BUDGET_MS);
  return counts;
};

// ---- pending rows ---------------------------------------------------------------

const confirmPending = async () => {
  const pending = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :pending',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':pending': 'pending' },
    Limit: 200,
  }));

  const counts = { confirmed: 0, stillPending: 0, reclaimed: 0, keptForMember: 0, keptNotOurs: 0 };

  for (const item of pending.Items ?? []) {
    let verified = false;
    try {
      const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: item.email }));
      verified = identity.VerifiedForSendingStatus === true;
    } catch (err) {
      if (err?.name !== 'NotFoundException') {
        console.log(JSON.stringify({ outcome: 'ses_error', code: err?.name }));
      }
      continue;
    }

    if (!verified) {
      // Reclaim identities of subscribers who never verified: once the row's
      // TTL window has passed (SES links expire in 24h; rows TTL at 3 days),
      // the identity is dead weight against the account's identity quota.
      // Delete the SES identity and the row now rather than leaking the
      // identity and waiting on DynamoDB TTL. Best-effort: a failure just
      // retries next sweep.
      const expired = typeof item.expiresAt === 'number' && item.expiresAt < Math.floor(Date.now() / 1000);
      if (expired) {
        try {
          if (item.ownsIdentity !== true || ownAddress(item.email)) {
            // The identity existed before this row (somebody else's, e.g. a
            // pending member's): not the list's to delete. Just drop the row.
            counts.keptNotOurs += 1;
          } else if ((await memberUse(item.email)) !== 'no') {
            // A pending VettID member may be mid-verification on the same
            // address: deleting the identity would void their SES link. Keep
            // the identity (the member flows own it); just drop our row.
            counts.keptForMember += 1;
          } else {
            await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: item.email }));
            counts.reclaimed += 1;
          }
          await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { email: item.email } }));
        } catch (err) {
          console.log(JSON.stringify({ outcome: 'reclaim_failed', code: err?.name }));
        }
      } else {
        counts.stillPending += 1;
      }
      continue;
    }

    let token;
    try {
      const res = await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { email: item.email },
        // unsubToken: only rows created before unsubscribe existed lack one.
        UpdateExpression: 'SET #s = :confirmed, confirmedAt = :now, unsubToken = if_not_exists(unsubToken, :u) REMOVE expiresAt',
        // Still pending: not unsubscribed (or expired) since the query.
        ConditionExpression: '#s = :pending',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':confirmed': 'confirmed',
          ':pending': 'pending',
          ':now': new Date().toISOString(),
          ':u': newUnsubscribeToken(),
        },
        ReturnValues: 'ALL_NEW',
      }));
      token = res.Attributes?.unsubToken;
    } catch (err) {
      if (err?.name !== 'ConditionalCheckFailedException') throw err;
      continue;
    }
    if (token) await sendWelcome(item.email, token);
    await notifyAdmin(ses, 'SES verification email accepted');
    counts.confirmed += 1;
  }
  return counts;
};

// ---- entry ----------------------------------------------------------------------

export const handler = async () => {
  let failure;
  let releases = {};
  let pending = {};
  // Releases first, and on their own: an error among the pending rows must
  // not leave unsubscribes unfinished, nor the other way round.
  try {
    releases = await releaseIdentities();
  } catch (err) {
    failure = err;
    console.log(JSON.stringify({ outcome: 'release_sweep_failed', code: err?.name }));
  }
  try {
    pending = await confirmPending();
  } catch (err) {
    failure ??= err;
    console.log(JSON.stringify({ outcome: 'pending_sweep_failed', code: err?.name }));
  }
  const result = { ...pending, ...releases };
  console.log(JSON.stringify({ outcome: 'sweep', ...result }));
  if (failure) throw failure; // counted by the function's Errors metric (alarmed)
  return result;
};
