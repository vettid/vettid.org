import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, table } from './aws';
import type { MemberItem } from './model';

/**
 * Email uniqueness marker. DynamoDB can't enforce uniqueness on a GSI, so
 * every member row is created in a transaction with a marker row keyed by
 * address (`user_guid = "email:<addr>"`). Markers carry no `email` or
 * `state` attribute, so they never appear in the email/state indexes.
 * Whoever deletes a member must delete its marker too.
 */
export const emailMarkerKey = (email: string) => `email:${email}`;

/**
 * The member's pointer row in the vaults table (`current_vault_id`). It
 * carries no user_guid, so it stays out of the table's user-index.
 */
export const vaultPointerKey = (guid: string) => `user#${guid}`;

export async function memberByEmail(email: string): Promise<MemberItem | null> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: table.members(),
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :e',
      ExpressionAttributeValues: { ':e': email },
      Limit: 1,
    }),
  );
  return (r.Items?.[0] as MemberItem | undefined) ?? null;
}

export async function memberByGuid(guid: string): Promise<MemberItem | null> {
  const r = await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: guid } }));
  return (r.Item as MemberItem | undefined) ?? null;
}

/** Account holders who may sign in and use the account site. */
export const canSignIn = (m: MemberItem | null): m is MemberItem =>
  !!m && (m.state === 'registered' || m.state === 'member') && m.account_status === 'active';

export interface CurrentTerms {
  version_id: string;
  title: string;
  sha256: string;
}

/** The membership terms version members must have accepted (null if none is published). */
export async function currentTerms(): Promise<CurrentTerms | null> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: table.terms(),
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :c',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':c': 'current' },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  return (r.Items?.[0] as CurrentTerms | undefined) ?? null;
}
