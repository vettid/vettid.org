/**
 * The record of a deleted vault kept after its row is removed (MEMBER-API
 * 2.11.0, "Vault deletion", What a phone is told; VAULT-MESSAGING §12.5).
 *
 * When the alarm mailer removes a `deleted` vault row (lambda/jobs/
 * vault-alarms.ts), it first writes `vdeleted#<vault_id>` in the
 * vault-requests table: the vault's app public keys, when it was deleted
 * and why, nothing else (not the member's user_guid: nothing needs it). For 90 days (`expires_at`, the table's TTL; not
 * divided by the staging time scale, which never scales retention) a
 * request signed by one of those keys is answered `410 vault_deleted`
 * (lambda/member/vault.ts, appCaller). The TTL removes a row up to two days
 * late, so the reader checks `expires_at` itself.
 */

/** An app public key: canonical b64 of its SPKI DER and its akid (as on the vault row). */
export interface TombstoneKey {
  key: string;
  kid: string;
}

type SeqKey = TombstoneKey & { seq?: number };

const isKey = (k: unknown): k is SeqKey =>
  !!k && typeof (k as TombstoneKey).key === 'string' && typeof (k as TombstoneKey).kid === 'string';

/**
 * The host's pending app key (2.7.0, release R), while it counts: set, a
 * key with a `seq`, not the current key, and with a `seq` above
 * `app_key`'s (an `app_key` without `seq` admits no pending key). The
 * host clears it by the rules of VAULT-MESSAGING §11.14.2; one it failed
 * to clear after `app_key` reached its `seq` is not accepted. There is no
 * time limit. (Moved here from lambda/member/vault.ts in 2.11.0, which
 * re-exports it, so that the alarm mailer reads the keys the same way.)
 */
export function pendingAppKey<K extends SeqKey>(v: { app_key?: K; app_key_next?: K }): K | null {
  const n = v.app_key_next;
  if (!isKey(n) || typeof n.seq !== 'number') return null;
  const cur = isKey(v.app_key) ? v.app_key : null;
  if (cur && cur.kid === n.kid) return null;
  // Staleness is judged by seq only: an app_key without one cannot be
  // compared, so a pending key beside it is not accepted.
  if (cur && !(typeof cur.seq === 'number' && n.seq > cur.seq)) return null;
  return n;
}

/** The vault's app keys: the host's `app_key` and (2.7.0) its pending `app_key_next`. */
export function vaultAppKeys<K extends SeqKey>(v: { app_key?: K; app_key_next?: K }): K[] {
  const next = pendingAppKey(v);
  return [...(isKey(v.app_key) ? [v.app_key] : []), ...(next ? [next] : [])];
}

/** 90 days, real time on every stage. */
export const VAULT_TOMBSTONE_TTL_S = 90 * 86_400;

export const tombstoneKey = (vaultId: string) => `vdeleted#${vaultId}`;

/** Why the vault was deleted, as far as the API knows (advisory; never shown). */
export type TombstoneCause = 'account' | 'start_over' | 'vault';

export interface VaultTombstone {
  request_id: string; // vdeleted#<vault_id>
  vault_id: string;
  /** The vault's app keys (public): the host's `app_key` and its pending `app_key_next`. */
  keys: TombstoneKey[];
  /** Epoch s: the host's `vault_deleted` notice time, or null when it had none. */
  deleted_at: number | null;
  cause: TombstoneCause;
  /** Epoch s: removal of the row + 90 days (TTL). */
  expires_at: number;
}

/** The vault row's attributes the cause is read from. */
export interface CauseFields {
  account_deleted_at?: unknown;
  deletion_requested_at?: unknown;
  deletion?: { state?: unknown } | null;
}

/**
 * `account`: the account deletion asked (its `account_deleted_at`, or,
 * for a row asked before 2.11.0, `deletion_requested_at` without a
 * start-over); `start_over`: the member's start-over; `vault`: neither, so
 * the vault reported its own deletion (its holder's `vault.delete`).
 */
export function tombstoneCause(row: CauseFields): TombstoneCause {
  if (typeof row.account_deleted_at === 'number') return 'account';
  if (row.deletion && row.deletion.state === 'executing') return 'start_over';
  if (typeof row.deletion_requested_at === 'number') return 'account';
  return 'vault';
}
