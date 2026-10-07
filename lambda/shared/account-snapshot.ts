/**
 * The account snapshot the member API hands to the member's vault
 * (MEMBER-API 2.0.0 "Account snapshot to the vault", VAULT-MESSAGING 0.15.0
 * §11.13). The app shows membership, terms and subscription state from it,
 * read-only; it never calls the account routes. Display only: nothing in the
 * vault or the API depends on it, except (2.2.0, VAULT-MESSAGING 0.18.0
 * §10.8) the names, which the vault sends every connection as the
 * account's (unverified) names.
 *
 *   { "v": 1, "as_of", "email", "first_name", "last_name",
 *     "name_change": { "allowed_after": RFC 3339 | null,
 *                      "last": { "seq", "status", "reason"? } | null },
 *     "state", "account_status", "deletes_at",
 *     "terms": { "needs_acceptance" },
 *     "subscription": { "type_name", "status", "paid", "expires_at" } | null,
 *     "voting_rights" }
 *
 * 2.2.0: first_name, last_name and name_change are required (still v: 1;
 * a 0.18.0 vault refuses a snapshot without them, older ones ignore unknown
 * members). No user_guid. At most 2 KiB.
 *
 * 2.3.0 (VAULT-MESSAGING 0.20.0): the member's full verified `email`
 * replaces `email_hint` (still v: 1; `email` required by a 0.20.0 vault,
 * older ones check `email_hint` only when present). The vault returns it
 * only to the member's own app and desktops. The masked hint stays in the
 * redeem and recovery-claim answers (lambda/member/vault.ts). Never log a
 * snapshot: it carries the full address.
 */
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, table } from './aws';
import { CurrentTerms, currentTerms } from './members';
import { MemberItem, SubscriptionItem, hasVotingRights } from './model';

export const SNAPSHOT_MAX_BYTES = 2048;

/** One applied name change per 30 days per member (MEMBER-API 2.2.0). */
export const NAME_CHANGE_INTERVAL_MS = 30 * 86_400_000;

export type NameChangeReason = 'too_soon' | 'invalid' | 'account';

/**
 * The vault row's `name_change_result` (written by lambda/jobs/vault-names.ts):
 * the outcome of the vault's latest name request the API processed. `reason`
 * only with `refused` (VAULT-MESSAGING §11.13).
 */
export type NameChangeResult = { seq: number; status: 'applied' } | { seq: number; status: 'refused'; reason: NameChangeReason };

export interface AccountSnapshot {
  v: 1;
  as_of: string;
  email: string;
  first_name: string;
  last_name: string;
  name_change: { allowed_after: string | null; last: NameChangeResult | null };
  state: 'registered' | 'member';
  account_status: 'active' | 'canceled';
  deletes_at: string | null;
  terms: { needs_acceptance: boolean };
  subscription: { type_name: string; status: SubscriptionItem['status']; paid: boolean; expires_at: string } | null;
  voting_rights: boolean;
}

const REASONS: readonly string[] = ['too_soon', 'invalid', 'account'];

/** A stored `name_change_result` in the snapshot's form, or null when absent or malformed. */
export function nameChangeResult(r: unknown): NameChangeResult | null {
  if (!r || typeof r !== 'object') return null;
  const { seq, status, reason } = r as { seq?: unknown; status?: unknown; reason?: unknown };
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return null;
  if (status === 'applied') return { seq, status };
  if (status === 'refused' && typeof reason === 'string' && REASONS.includes(reason)) return { seq, status, reason: reason as NameChangeReason };
  return null;
}

/** When the next name change may be applied: the last applied one + 30 days while that lies ahead, else null. */
export function nameChangeAllowedAfter(m: Pick<MemberItem, 'name_changed_at'>, now: Date): string | null {
  const at = m.name_changed_at ? Date.parse(m.name_changed_at) : NaN;
  if (!Number.isFinite(at)) return null;
  const after = at + NAME_CHANGE_INTERVAL_MS;
  return after > now.getTime() ? new Date(after).toISOString() : null;
}

/** What a 0.18.0 vault accepts as a name (§11.13): a string of 1–160 bytes without control characters. */
const snapshotName = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 160 && !/\p{Cc}/u.test(v);

/** What a 0.20.0 vault accepts as the email (§11.13): 3–1,016 bytes of UTF-8 with an `@` and no control characters. */
const snapshotEmail = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  const n = Buffer.byteLength(v, 'utf8');
  return n >= 3 && n <= 1016 && v.includes('@') && !/\p{Cc}/u.test(v);
};

/**
 * The snapshot for `m`, or null when it cannot be expressed in the spec's
 * form (an account that is neither active nor canceled, e.g. suspended, or
 * not registered/member; names or an email a vault would refuse) or would
 * exceed 2 KiB.
 * Callers then send none. `vault` is the member's vault row, for the
 * outcome of its latest name request (`name_change_result`).
 */
export function accountSnapshot(
  m: MemberItem,
  sub: SubscriptionItem | null,
  terms: CurrentTerms | null,
  now = new Date(Date.now()),
  vault: { name_change_result?: unknown } | null = null,
): AccountSnapshot | null {
  if (m.state !== 'registered' && m.state !== 'member') return null;
  if (m.account_status !== 'active' && m.account_status !== 'canceled') return null;
  if (!snapshotName(m.first_name) || !snapshotName(m.last_name)) return null;
  if (!snapshotEmail(m.email)) return null;
  const snap: AccountSnapshot = {
    v: 1,
    as_of: now.toISOString(),
    email: m.email,
    first_name: m.first_name,
    last_name: m.last_name,
    name_change: { allowed_after: nameChangeAllowedAfter(m, now), last: nameChangeResult(vault?.name_change_result) },
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

/**
 * Read what the snapshot needs and build it; null if anything fails (the
 * caller sends none). `vault`: the member's vault row as read (its
 * `name_change_result`), or null for a vault without one yet.
 */
export async function snapshotFor(m: MemberItem, vault: { name_change_result?: unknown } | null): Promise<AccountSnapshot | null> {
  try {
    const [sub, terms] = await Promise.all([subscriptionOf(m.user_guid), currentTerms()]);
    return accountSnapshot(m, sub, terms, new Date(Date.now()), vault);
  } catch (e) {
    console.error('account snapshot unavailable', JSON.stringify({ error: (e as Error).name }));
    return null;
  }
}

// ---- telling a running vault --------------------------------------------------------

const lambda = new LambdaClient({});

/**
 * After a change to the member's account (terms accepted, subscription
 * started, changed or cancelled, account cancelled or reinstated, and since
 * 2.2.0 a name change from the vault processed), ask the
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
