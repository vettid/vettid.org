// Scheduled every 15 minutes:
//  - promote pending subscribers whose SES identity verification succeeded
//    (the user accepted the SES verification email), and send them the
//    welcome mail: the first mail of ours they get, and so the first with
//    their unsubscribe link;
//  - finish unsubscribes: for each release marker subscribe.mjs left, delete
//    the address's SES identity unless something else uses it.
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

// Does any member row (any state) use this address? 'unknown' when the
// lookup fails: a failed lookup must never lead to deleting someone's
// identity.
const memberUse = async (email) => {
  try {
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
const usedByMember = async (email) => (await memberUse(email)) !== 'no';

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

// Finishes unsubscribes. A marker stays until it is settled one way or the
// other, so a failure is retried at the next sweep instead of leaving an
// address in SES for good. The marker has no TTL for the same reason.
const releaseIdentities = async () => {
  const markers = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :release',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':release': 'release' },
    Limit: 200,
  }));
  let released = 0;
  let releaseKept = 0;
  let releaseRetry = 0;
  for (const marker of markers.Items ?? []) {
    const email = marker.target;
    try {
      let keep = typeof email !== 'string' || ownAddress(email);
      if (!keep) {
        // Back on the list already (signed up again, or the row's delete did
        // not happen): the row owns the identity again.
        const row = await ddb.send(new GetCommand({ TableName: TABLE, Key: { email } }));
        keep = Boolean(row.Item);
      }
      if (!keep) {
        const use = await memberUse(email);
        if (use === 'unknown') { releaseRetry += 1; continue; }
        keep = use === 'yes';
      }
      if (keep) {
        releaseKept += 1;
      } else {
        try {
          await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: email }));
        } catch (err) {
          if (err?.name !== 'NotFoundException') throw err; // already gone
        }
        released += 1;
      }
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { email: marker.email } }));
    } catch (err) {
      releaseRetry += 1;
      console.log(JSON.stringify({ outcome: 'release_failed', code: err?.name }));
    }
  }
  return { released, releaseKept, releaseRetry };
};

export const handler = async () => {
  const pending = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'status-index',
    KeyConditionExpression: '#s = :pending',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':pending': 'pending' },
    Limit: 200,
  }));

  let confirmed = 0;
  let stillPending = 0;
  let reclaimed = 0;
  let keptForMember = 0;

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
          // A pending VettID member may be mid-verification on the same
          // address: deleting the identity would void their SES link. Keep
          // the identity (the member flows own it); just drop our row.
          if (await usedByMember(item.email)) {
            keptForMember += 1;
          } else {
            await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: item.email }));
            reclaimed += 1;
          }
          await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { email: item.email } }));
        } catch (err) {
          console.log(JSON.stringify({ outcome: 'reclaim_failed', code: err?.name }));
        }
      } else {
        stillPending += 1;
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
    confirmed += 1;
  }

  const releases = await releaseIdentities();

  console.log(JSON.stringify({ outcome: 'sweep', confirmed, stillPending, reclaimed, keptForMember, ...releases }));
  return { confirmed, stillPending, reclaimed, keptForMember, ...releases };
};
