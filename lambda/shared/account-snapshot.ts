/**
 * The account snapshot the member API hands to the member's vault
 * (MEMBER-API 2.0.0 "Account snapshot to the vault", VAULT-MESSAGING 0.15.0
 * §11.13). The app shows membership, terms and subscription state from it,
 * read-only; it never calls the account routes. Display only: nothing in the
 * vault or the API depends on it.
 *
 *   { "v": 1, "as_of", "email_hint", "state", "account_status", "deletes_at",
 *     "terms": { "needs_acceptance" },
 *     "subscription": { "type_name", "status", "paid", "expires_at" } | null,
 *     "voting_rights" }
 *
 * No name, no full address, no user_guid. At most 2 KiB.
 */
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, table } from './aws';
import { emailHint } from './enroll-code';
import { CurrentTerms, currentTerms } from './members';
import { MemberItem, SubscriptionItem, hasVotingRights } from './model';

export const SNAPSHOT_MAX_BYTES = 2048;

export interface AccountSnapshot {
  v: 1;
  as_of: string;
  email_hint: string;
  state: 'registered' | 'member';
  account_status: 'active' | 'canceled';
  deletes_at: string | null;
  terms: { needs_acceptance: boolean };
  subscription: { type_name: string; status: SubscriptionItem['status']; paid: boolean; expires_at: string } | null;
  voting_rights: boolean;
}

/**
 * The snapshot for `m`, or null when it cannot be expressed in the spec's
 * form (an account that is neither active nor canceled, e.g. suspended, or
 * not registered/member) or would exceed 2 KiB. Callers then send none.
 */
export function accountSnapshot(m: MemberItem, sub: SubscriptionItem | null, terms: CurrentTerms | null, now = new Date(Date.now())): AccountSnapshot | null {
  if (m.state !== 'registered' && m.state !== 'member') return null;
  if (m.account_status !== 'active' && m.account_status !== 'canceled') return null;
  const snap: AccountSnapshot = {
    v: 1,
    as_of: now.toISOString(),
    email_hint: emailHint(m.email),
    state: m.state,
    account_status: m.account_status,
    deletes_at: m.account_status === 'canceled' && m.delete_after ? m.delete_after : null,
    terms: { needs_acceptance: !!terms && terms.version_id !== m.terms_version },
    subscription: sub ? { type_name: sub.type_name, status: sub.status, paid: !!sub.paid, expires_at: sub.expires_at } : null,
    voting_rights: hasVotingRights(m, sub, now),
  };
  return Buffer.byteLength(JSON.stringify(snap), 'utf8') <= SNAPSHOT_MAX_BYTES ? snap : null;
}

async function subscriptionOf(guid: string): Promise<SubscriptionItem | null> {
  // Consistent: a push follows the write that changed it by milliseconds.
  const r = await ddb.send(new GetCommand({ TableName: table.subscriptions(), Key: { user_guid: guid }, ConsistentRead: true }));
  return (r.Item as SubscriptionItem | undefined) ?? null;
}

/** Read what the snapshot needs and build it; null if anything fails (the caller sends none). */
export async function snapshotFor(m: MemberItem): Promise<AccountSnapshot | null> {
  try {
    const [sub, terms] = await Promise.all([subscriptionOf(m.user_guid), currentTerms()]);
    return accountSnapshot(m, sub, terms);
  } catch (e) {
    console.error('account snapshot unavailable', JSON.stringify({ error: (e as Error).name }));
    return null;
  }
}

// ---- telling a running vault --------------------------------------------------------

const lambda = new LambdaClient({});

/**
 * After a change to the member's account (terms accepted, subscription
 * started, changed or cancelled, account cancelled or reinstated), ask the
 * account-push function (env ACCOUNT_PUSH_FN; lambda/jobs/vault-account-push.ts)
 * to send the new snapshot to the member's running vault. Asynchronous and
 * best effort: a failure is logged and never fails the caller's request;
 * the vault gets a fresh snapshot at its next unlock anyway.
 */
export async function pushAccountSnapshot(userGuid: string): Promise<void> {
  const fn = process.env.ACCOUNT_PUSH_FN;
  if (!fn) return;
  try {
    await lambda.send(new InvokeCommand({ FunctionName: fn, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ user_guid: userGuid })) }));
  } catch (e) {
    console.error('account push not requested', JSON.stringify({ error: (e as Error).name }));
  }
}
