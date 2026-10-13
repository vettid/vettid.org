import { AdminDeleteUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { cognito, ddb, env, table } from './aws';
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
 * The delete of a member's email marker, for a DeleteCommand or a
 * transaction: only if the marker is this member's own (`member_guid`) or
 * is already gone. The key is the address, and an address can be requested
 * again as soon as its marker is deleted: a delete by key alone, made a
 * moment after somebody else removed this member, would take the marker of
 * the NEW request for the address, and with it that address's uniqueness.
 * A failed condition means "not ours": leave the marker where it is.
 */
export const ownEmailMarkerDelete = (m: { email: string; user_guid: string }) => ({
  TableName: table.members(),
  Key: { user_guid: emailMarkerKey(m.email) },
  ConditionExpression: 'attribute_not_exists(user_guid) OR member_guid = :g',
  ExpressionAttributeValues: { ':g': m.user_guid },
});

/**
 * Delete the Cognito (sign-in) user under the member's address, but only
 * if it carries this member's id (`custom:user_guid`, set at creation and
 * immutable). Users are named by address too: one with another id, or with
 * none, belongs to another request or account for the same address and is
 * left.
 *   'deleted'  it was this member's and is gone
 *   'none'     there is no user under the address
 *   'other'    there is one, and it is not this member's: untouched
 * Cognito has no conditional delete, so a user replaced between the read
 * and the delete (milliseconds) is not covered.
 */
export async function deleteOwnSignInUser(m: { email: string; user_guid: string }): Promise<'deleted' | 'none' | 'other'> {
  const UserPoolId = env('MEMBER_POOL_ID');
  try {
    const u = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: m.email }));
    if (u.UserAttributes?.find((a) => a.Name === 'custom:user_guid')?.Value !== m.user_guid) return 'other';
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId, Username: m.email }));
    return 'deleted';
  } catch (e) {
    if ((e as Error).name !== 'UserNotFoundException') throw e;
    return 'none';
  }
}

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

/**
 * For the audit event of a deletion: what, of the things named by the
 * address, was found to be somebody else's and left. The record itself
 * then shows that the address was not cleared by this deletion. No address.
 */
export const leftBehind = (signInUser: 'deleted' | 'none' | 'other' | undefined, marker: 'deleted' | 'left' | undefined) => ({
  ...(signInUser === 'other' ? { sign_in_user: 'left' } : {}),
  ...(marker === 'left' ? { email_marker: 'left' } : {}),
});

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
