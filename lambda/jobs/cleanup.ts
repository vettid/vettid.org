/**
 * Daily:
 *  - delete accounts canceled more than 7 days ago (Cognito user,
 *    subscription, member row + email marker; the audit trail stays)
 *  - mark subscriptions past their expiry as `expired`
 */
import { AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DeleteCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { cognito, ddb, env, table } from '../shared/aws';
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
      try {
        await cognito.send(new AdminDeleteUserCommand({ UserPoolId: env('MEMBER_POOL_ID'), Username: m.email }));
      } catch (e) {
        if ((e as Error).name !== 'UserNotFoundException') throw e;
      }
      await ddb.send(new DeleteCommand({ TableName: table.subscriptions(), Key: { user_guid: m.user_guid } }));
      await ddb.send(new DeleteCommand({ TableName: table.members(), Key: { user_guid: emailMarkerKey(m.email) } }));
      await ddb.send(new DeleteCommand({ TableName: table.members(), Key: { user_guid: m.user_guid } }));
      await audit('system', 'member.delete_after_cancel', m.user_guid, { email: m.email });
      deleted++;
    }
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
  console.log(JSON.stringify({ deleted, expired }));
  return { deleted, expired };
};
