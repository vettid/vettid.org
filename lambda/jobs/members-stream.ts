/**
 * Members table stream → lifecycle email.
 *
 *  - "Your account is ready, sign in": once a person is `registered` AND
 *    their address has passed SES verification (whichever happens last:
 *    admin approval, invite registration, or the verification click).
 *    `welcome_sent` makes it once-only.
 *  - "We have your request" (MEMBER-API 2.6.0): once, at the moment a
 *    request (`requested`) becomes verified, with the link that withdraws
 *    it. Amazon's verification mail cannot carry our link, and before
 *    verification we may not mail the address at all (SES sandbox), so this
 *    is the first moment the person can be given one. Only the transition
 *    sends: a request that was already verified before this change (no
 *    token, no mail) is never mailed from here, whatever is written to its
 *    row later (scripts/ops/request-mail-backfill.ts is the operator's
 *    choice for those).
 */
import type { DynamoDBStreamHandler } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env, table } from '../shared/aws';
import { nowIso } from '../shared/ids';
import { sendMail } from '../shared/mail';
import type { MemberItem } from '../shared/model';
import { adminNotice, newWithdrawToken, requestReceivedMail, withdrawLink } from '../shared/requests';

type Image = Parameters<typeof unmarshall>[0];

const verifiedRequest = (m: Partial<MemberItem> | null): boolean =>
  !!m && m.state === 'requested' && m.email_verified === true && m.account_status === 'active';

/**
 * Claim first (a retry or a concurrent record cannot send twice), then
 * send. Only the token's hash is stored; the token exists in the email
 * alone. A failed send gives the claim's token back (the link was never
 * delivered) but keeps `request_mail_at`, so nothing here loops; the
 * backfill script counts and can send such rows.
 */
export async function sendRequestReceived(m: Pick<MemberItem, 'user_guid' | 'email'>): Promise<'sent' | 'skipped' | 'failed'> {
  const { token, hash } = newWithdrawToken(m.user_guid);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: m.user_guid },
        UpdateExpression: 'SET withdraw_token_hash = :h, request_mail_at = :n',
        ConditionExpression:
          'attribute_exists(user_guid) AND attribute_not_exists(withdraw_token_hash) AND #s = :req AND account_status = :active AND email_verified = :t',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':h': hash, ':n': nowIso(), ':req': 'requested', ':active': 'active', ':t': true },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return 'skipped';
    throw e;
  }
  const mail = requestReceivedMail(withdrawLink(env('ACCOUNT_HOST'), token));
  try {
    await sendMail(m.email, mail.subject, mail.text);
    return 'sent';
  } catch (e) {
    console.error('request mail failed', (e as Error).name); // never the address or the link
    await ddb
      .send(
        new UpdateCommand({
          TableName: table.members(),
          Key: { user_guid: m.user_guid },
          UpdateExpression: 'REMOVE withdraw_token_hash',
          ConditionExpression: 'withdraw_token_hash = :h',
          ExpressionAttributeValues: { ':h': hash },
        }),
      )
      .catch((err: Error) => console.error('request mail un-claim failed', err.name));
    return 'failed';
  }
}

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const rec of event.Records) {
    if (rec.eventName === 'REMOVE' || !rec.dynamodb?.NewImage) continue;
    const m = unmarshall(rec.dynamodb.NewImage as Image) as MemberItem;
    const old = rec.dynamodb.OldImage ? (unmarshall(rec.dynamodb.OldImage as Image) as Partial<MemberItem>) : null;

    // A request that has just become verified (or arrived verified).
    if (verifiedRequest(m) && !verifiedRequest(old) && !m.request_mail_at && !m.withdraw_token_hash) {
      const outcome = await sendRequestReceived(m);
      // The request's own notice already said "already verified" when it arrived so.
      if (outcome !== 'skipped' && old) {
        try {
          const notice = adminNotice('verified');
          await sendMail(env('ADMIN_EMAIL'), notice.subject, notice.text);
        } catch (e) {
          console.error('admin notify failed', (e as Error).name);
        }
      }
      continue;
    }

    if (m.state !== 'registered' || !m.email_verified || m.welcome_sent || m.account_status !== 'active') continue;

    // Claim the send first so a retry or a concurrent record can't double-send.
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: table.members(),
          Key: { user_guid: m.user_guid },
          UpdateExpression: 'SET welcome_sent = :t',
          // Re-check the live row: never recreate a deleted member (an
          // UpdateItem on a missing key would), nor email someone who has
          // since been suspended or canceled.
          ConditionExpression:
            'attribute_exists(user_guid) AND attribute_not_exists(welcome_sent) AND #s = :reg AND account_status = :active AND email_verified = :t',
          ExpressionAttributeNames: { '#s': 'state' },
          ExpressionAttributeValues: { ':t': true, ':reg': 'registered', ':active': 'active' },
        }),
      );
    } catch (e) {
      if ((e as Error).name === 'ConditionalCheckFailedException') continue;
      throw e;
    }
    await sendMail(
      m.email,
      'Your VettID account is ready',
      `Your VettID account is ready. Sign in here — we'll email you a one-time link:\n\n` +
        `https://${env('ACCOUNT_HOST')}/signin/\n\n` +
        'Once you are in, review and accept the membership terms to become a member.\n\n— VettID\n',
    );
  }
};
