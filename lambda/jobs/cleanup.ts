/**
 * Daily:
 *  - delete accounts canceled more than 7 days ago (Cognito user,
 *    subscription, member row + email marker; the audit trail stays)
 *  - reclaim membership requests never email-verified within 14 days
 *  - mark subscriptions past their expiry as `expired`
 */
import { AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DeleteEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { DeleteCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { cognito, ddb, env, ses, table } from '../shared/aws';

const STALE_DAYS = 14;
import { emailMarkerKey } from '../shared/members';
import type { MemberItem, SubscriptionItem } from '../shared/model';

async function* query(input: ConstructorParameters<typeof QueryCommand>[0]) {
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
    yield* r.Items ?? [];
    start = r.LastEvaluatedKey;
  } while (start);
}

export const handler = async () => {
  const now = new Date().toISOString();
  let deleted = 0;
  for (const state of ['registered', 'member']) {
    for await (const item of query({
      TableName: table.members(),
      IndexName: 'state-index',
      KeyConditionExpression: '#s = :s',
      FilterExpression: 'account_status = :c AND delete_after < :now',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':s': state, ':c': 'canceled', ':now': now },
    })) {
      const m = item as MemberItem;
      // Delete the member row FIRST, conditionally: if an admin reinstated
      // the account after our query, the condition fails and nothing else
      // is touched.
      try {
        await ddb.send(
          new DeleteCommand({
            TableName: table.members(),
            Key: { user_guid: m.user_guid },
            ConditionExpression: 'account_status = :c AND delete_after < :now',
            ExpressionAttributeValues: { ':c': 'canceled', ':now': now },
          }),
        );
      } catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException') continue;
        throw e;
      }
      try {
        await cognito.send(new AdminDeleteUserCommand({ UserPoolId: env('MEMBER_POOL_ID'), Username: m.email }));
      } catch (e) {
        if ((e as Error).name !== 'UserNotFoundException') throw e;
      }
      await ddb.send(new DeleteCommand({ TableName: table.subscriptions(), Key: { user_guid: m.user_guid } }));
      await ddb.send(new DeleteCommand({ TableName: table.members(), Key: { user_guid: emailMarkerKey(m.email) } }));
      await audit('system', 'member.delete_after_cancel', m.user_guid, {});
      deleted++;
    }
  }

  // Stale requests: never verified their address within STALE_DAYS. Remove
  // the row, its email marker and — unless the mailing list still uses the
  // address — its SES identity, so abandoned or abusive requests don't eat
  // the account's SES identity quota.
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  let reclaimed = 0;
  for await (const item of query({
    TableName: table.members(),
    IndexName: 'state-index',
    KeyConditionExpression: '#s = :r AND updated_at < :before',
    FilterExpression: 'email_verified = :f',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: { ':r': 'requested', ':before': staleBefore, ':f': false },
  })) {
    const m = item as MemberItem;
    try {
      await ddb.send(
        new DeleteCommand({
          TableName: table.members(),
          Key: { user_guid: m.user_guid },
          ConditionExpression: '#s = :r AND email_verified = :f',
          ExpressionAttributeNames: { '#s': 'state' },
          ExpressionAttributeValues: { ':r': 'requested', ':f': false },
        }),
      );
    } catch (e) {
      if ((e as Error).name === 'ConditionalCheckFailedException') continue;
      throw e;
    }
    await ddb.send(new DeleteCommand({ TableName: table.members(), Key: { user_guid: emailMarkerKey(m.email) } }));
    const onList = await ddb.send(new GetCommand({ TableName: env('TABLE_MAILING_LIST'), Key: { email: m.email } }));
    if (!onList.Item) {
      try {
        await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: m.email }));
      } catch (e) {
        if ((e as Error).name !== 'NotFoundException') throw e;
      }
    }
    await audit('system', 'request.reclaim_unverified', m.user_guid, {});
    reclaimed++;
  }

  let expired = 0;
  for (const status of ['trial', 'active']) {
    for await (const item of query({
      TableName: table.subscriptions(),
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :s AND expires_at < :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status, ':now': now },
    })) {
      const s = item as SubscriptionItem;
      await ddb.send(
        new UpdateCommand({
          TableName: table.subscriptions(),
          Key: { user_guid: s.user_guid },
          UpdateExpression: 'SET #s = :e',
          ConditionExpression: '#s = :s AND expires_at < :now',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':e': 'expired', ':s': status, ':now': now },
        }),
      );
      expired++;
    }
  }
  console.log(JSON.stringify({ deleted, reclaimed, expired }));
  return { deleted, reclaimed, expired };
};
