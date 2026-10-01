/**
 * Every 15 minutes: flip `email_verified` for people who have clicked their
 * SES verification email since (SES sandbox: verification is the opt-in and
 * a prerequisite for emailing them anything, including sign-in links).
 */
import { GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, ses, table } from '../shared/aws';
import { nowIso } from '../shared/ids';
import type { MemberItem } from '../shared/model';

export const handler = async (): Promise<{ checked: number; verified: number }> => {
  let checked = 0;
  let verified = 0;
  for (const state of ['requested', 'registered', 'member']) {
    let start: Record<string, unknown> | undefined;
    do {
      const r = await ddb.send(
        new QueryCommand({
          TableName: table.members(),
          IndexName: 'state-index',
          KeyConditionExpression: '#s = :s',
          FilterExpression: 'email_verified = :f',
          ExpressionAttributeNames: { '#s': 'state' },
          ExpressionAttributeValues: { ':s': state, ':f': false },
          ExclusiveStartKey: start,
        }),
      );
      for (const m of (r.Items ?? []) as MemberItem[]) {
        checked++;
        try {
          const id = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: m.email }));
          if (!id.VerifiedForSendingStatus) continue;
        } catch (e) {
          if ((e as Error).name === 'NotFoundException') continue;
          throw e;
        }
        await ddb.send(
          new UpdateCommand({
            TableName: table.members(),
            Key: { user_guid: m.user_guid },
            UpdateExpression: 'SET email_verified = :t, updated_at = :n',
            ConditionExpression: 'attribute_exists(user_guid)',
            ExpressionAttributeValues: { ':t': true, ':n': nowIso() },
          }),
        );
        verified++;
        await new Promise((res) => setTimeout(res, 250)); // stay well under SES API rate limits
      }
      start = r.LastEvaluatedKey;
    } while (start);
  }
  console.log(JSON.stringify({ checked, verified }));
  return { checked, verified };
};
