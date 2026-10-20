/**
 * Every 5 minutes (event `{task: "start_over"}`, MEMBER-API 2.1.0,
 * VAULT-MESSAGING 0.16.0 §11.11.9): each "delete my vault and start over"
 * past its `deletes_at` and not cancelled is marked `executing` and its
 * vault is asked to delete itself (the host's `delete`, as below); one
 * that could not be queued yet (no instance running, the service paused)
 * is tried again at the next run, and the daily retry below covers the rest.
 * A start-over is carried out only while its member's account is active: for
 * a suspended or canceled account, and for one whose member row is gone or
 * cannot be read, it stays pending (held), and the run says how many it
 * held and why (EMF, alarmed). The same run (MEMBER-API 2.10.0) sends
 * `delete_resume` for each vault row whose host-written `deleting_at` is at
 * least 2 minutes old and that is not `deleted` (`resumeDeletions` below);
 * it never sends `delete` because of that mark.
 *
 * A second function runs this module's `cancelHandler` and nothing else
 * (event `{task: "cancel_start_over", user_guid}`): the admin API, which
 * holds no right on the vault tables, invokes it to cancel a member's
 * pending start-over. It shares this job's role. `handler` below does not
 * know that task. A third function runs `memberVaultsHandler` and nothing
 * else (event `{task: "member_vaults", user_guid}`), under a role of its
 * own that may only Query the vaults table and its user-index: the admin
 * API's Delete asks it whether the member still has a vault, and refuses
 * while one exists.
 *
 * Every 15 minutes (event `{task: "requests"}`, MEMBER-API 2.6.0): each
 * withdrawn membership request is removed (row, email marker, a Cognito
 * user left by a failed code registration, and the SES identity if the
 * request created it and the mailing list does not use it).
 *
 * Daily:
 *  - delete accounts canceled more than 7 days ago (Cognito user,
 *    subscription, member row + email marker; each vault is asked to delete
 *    itself, VAULT-MESSAGING 0.9.0 §12.5, and its row goes with the
 *    vault_deleted notice; the SES identity of the address goes under the
 *    14-day reclaim's rule; the audit trail stays)
 *  - mark the vaults whose member row is gone, and that nobody asked yet;
 *    7 days after the mark, the member row still missing and no operator
 *    hold, ask them to delete themselves as for a canceled account (an
 *    account deletion that stopped before its vault step)
 *  - retry vault deletions not yet reported
 *  - reclaim membership requests never email-verified within 14 days
 *  - remove membership requests declined more than 30 days ago (2.6.0),
 *    exactly as a withdrawn one
 *  - mark subscriptions past their expiry as `expired`
 */
import { DeleteEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DeleteCommand, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { ddb, env, ses, table } from '../shared/aws';

const STALE_DAYS = 14;
import { deleteOwnSignInUser, leftBehind, ownEmailMarkerDelete, vaultPointerKey } from '../shared/members';
import type { MemberItem, SubscriptionItem } from '../shared/model';
import { DECLINED_DAYS, REMOVAL_GIVE_UP_DAYS, ownAddress } from '../shared/requests';
import { liveLease, newUlid, pickInstance, releaseRow, requestStart, routable, type InstanceRow } from '../shared/vault-routing';
import { vaultService } from '../shared/vault-service';
import { canSignIn } from '../shared/members';

async function* query(input: ConstructorParameters<typeof QueryCommand>[0]) {
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
    yield* r.Items ?? [];
    start = r.LastEvaluatedKey;
  } while (start);
}

const sqs = new SQSClient({});

/** After this long without a `deleted` report, a vault deletion is flagged to operations. */
export const DELETION_STALE_S = 30 * 86_400;

interface VaultRowLite {
  vault_id: string;
  user_guid: string;
  state?: string;
  sealed_release?: string;
  lease?: { instance_id?: unknown; lease_expires_at?: unknown };
  deletion_requested_at?: number;
  /**
   * MEMBER-API 2.10.0: when the vault reported its deletion's marking flush,
   * written by the host (advisory; read only by the resume run below).
   */
  deleting_at?: number;
  /** MEMBER-API 2.10.0: when the resume run last sent `delete_resume`, written by this job. */
  deletion_resumed_at?: number;
  /** MEMBER-API 2.1.0: the member's start-over (§11.11.9), written by the member API. */
  deletion?: { deletion_id?: unknown; state?: unknown; deletes_at?: unknown; queued_at?: unknown };
}

/**
 * Where a host operation without an envelope for this vault goes, as for
 * `delete` (VAULT-MESSAGING §12.5): the leaseholder, else a live instance of
 * its sealed release (a start is requested when none runs). Null while the
 * vault service is paused (nothing is queued or start-requested then), for
 * a release that is not routable, or when no instance runs yet.
 */
async function routeAsDelete(v: VaultRowLite, nowS: number): Promise<InstanceRow | null> {
  const paused = !(await vaultService()).enabled;
  let inst = paused ? null : await liveLease(v, nowS);
  if (!inst && v.sealed_release && !paused) {
    const rel = await releaseRow(v.sealed_release);
    // A `removed` release (not reopened for a rescue) is never started
    // (VAULT-MESSAGING 0.10.0 §11.10.5); the stored objects of vaults still
    // sealed to it go after the key's deletion (VAULT-RELEASES §3.5, D + 37;
    // not built yet). Until then the row stays, retried and flagged by the
    // caller.
    // A canary release is the host's to reach for a canary member's vault.
    if (routable(rel, { canary: true })) {
      inst = await pickInstance(v.sealed_release, nowS);
      if (!inst) await requestStart(v.sealed_release);
    }
  }
  return inst;
}

/**
 * Ask one vault to delete itself (VAULT-MESSAGING 0.9.0 §12.5): the queue
 * operation `delete` (§11.5, no envelope) to the leaseholder, else a live
 * instance of its sealed release (a start is requested when none runs).
 * A running vault deletes itself with the full semantics; otherwise the
 * instance erases the stored objects. The vault's `deleted` report brings
 * the vault_deleted notice, whose mailer removes the row. Returns whether
 * the operation was queued.
 *
 * While the operator has paused the vault service (MEMBER-API "Vault
 * service pause") nothing is queued or start-requested: the row gets its
 * `deletion_requested_at` and a run after the pause retries it.
 */
export async function requestVaultDeletion(v: VaultRowLite, nowS: number): Promise<boolean> {
  if (v.state === 'deleted') return false;
  if (!v.sealed_release && !v.lease) {
    // Never sealed: nothing is stored for it; the row is all there is.
    await ddb.send(new DeleteCommand({ TableName: table.vaults(), Key: { vault_id: v.vault_id } }));
    return false;
  }
  let inst = await routeAsDelete(v, nowS);
  if (inst) {
    const message = {
      v: 1,
      op: 'delete',
      vault_id: v.vault_id,
      user_guid: v.user_guid,
      request_id: newUlid(),
      enqueued_at: new Date(nowS * 1000).toISOString(),
    };
    try {
      await sqs.send(new SendMessageCommand({ QueueUrl: inst.queue_url, MessageBody: JSON.stringify(message) }));
    } catch (e) {
      console.error('vault delete enqueue failed', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
      inst = null;
    }
  }
  if (typeof v.deletion_requested_at !== 'number') {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET deletion_requested_at = :t',
        ConditionExpression: 'attribute_exists(vault_id) AND attribute_not_exists(deletion_requested_at)',
        ExpressionAttributeValues: { ':t': nowS },
      }),
    ).catch((e: Error) => {
      if (e.name !== 'ConditionalCheckFailedException') throw e;
    });
  } else if (v.deletion_requested_at < nowS - DELETION_STALE_S) {
    console.warn('vault deletion pending', JSON.stringify({ vault_id: v.vault_id }));
  }
  return !!inst;
}

/**
 * A canceled member's vaults: each is asked to delete itself; the pointer
 * row goes now (the member is gone). Response slots are not used.
 */
async function deleteVaults(guid: string, nowS: number): Promise<string[]> {
  const ids: string[] = [];
  for await (const item of query({
    TableName: table.vaults(),
    IndexName: 'user-index',
    KeyConditionExpression: 'user_guid = :g',
    ExpressionAttributeValues: { ':g': guid },
  })) {
    const v = item as VaultRowLite;
    await requestVaultDeletion(v, nowS);
    ids.push(String(v.vault_id));
  }
  await ddb.send(new DeleteCommand({ TableName: table.vaults(), Key: { vault_id: vaultPointerKey(guid) } }));
  return ids;
}

/** Retry deletions not yet reported (the member row is already gone). */
async function retryVaultDeletions(nowS: number): Promise<number> {
  let n = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table.vaults(),
        FilterExpression: 'attribute_exists(deletion_requested_at) AND #s <> :d AND deletion_requested_at < :recent',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':d': 'deleted', ':recent': nowS - 3600 },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of r.Items ?? []) {
      await requestVaultDeletion(item as VaultRowLite, nowS);
      n++;
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return n;
}

/** More members without a row than this in one daily run, and the run holds all of them. */
export const ORPHAN_LIMIT = 5;
/**
 * Also held when the members without a row are more than this share of the
 * owners the run read (at least one is always allowed). It binds in small
 * tables, where ORPHAN_LIMIT could be every member; see deleteOrphanVaults.
 */
export const ORPHAN_SHARE = 0.15;
/** A vault is asked to delete itself only this long after `orphan_seen_at`, its member row still missing. */
export const ORPHAN_GRACE_S = 7 * 86_400;

/** What one daily run did with vaults whose member row is gone. */
export interface OrphanVaultCounts {
  /** Vault rows seen without a member row for the first time: `orphan_seen_at` written (the warning). */
  marked: number;
  /** Vault rows marked by an earlier run and still inside their 7 days. */
  waiting: number;
  /** Vault rows whose member row is back: `orphan_seen_at` removed. */
  cleared: number;
  /** Members whose vaults were asked to delete themselves (as for a canceled account). */
  requested: number;
  /** Members without a row with a vault an operator holds (`orphan_hold`): left alone. */
  operator_held: number;
  /** Members without a row left because the run found too many of them (nothing written for any). */
  held: number;
  /** Member rows that could not be read: their vaults are left for the next run. */
  read_errors: number;
  /** Members whose vaults could not all be marked or asked (the sweep itself failing counts one): tried again at the next run. */
  failures: number;
}

/**
 * Vault rows whose member row is gone (MEMBER-API "Vault deletion",
 * Vaults without a member). The daily account deletion removes the member
 * row first, under its guard, and asks the member's vaults to delete
 * themselves after it; if it stops in between (a timeout, a failed call),
 * nothing else would ever come back to those vaults, because the row that
 * named them is gone. This scan finds them: a vault row with an owner, not
 * `deleted` and without `deletion_requested_at` (nobody asked it yet).
 * Each owner's member row is read consistently.
 *
 * Nothing irreversible happens at first sight. A vault without a member
 * row first gets `orphan_seen_at` (a conditional write: an existing mark is
 * never moved), counted as OrphanVaultsSeen and alarmed, so that an
 * operator hears of it while the vault still exists. Only when the member
 * row is still missing ORPHAN_GRACE_S (7 days) after the mark of every one
 * of that member's vaults are they deleted, exactly as for a canceled
 * account (`deleteVaults`: the host's `delete` to each vault not yet
 * deleted, a never-sealed row deleted, the pointer row deleted), audited
 * `vault.orphan_deletion_requested` and alarmed (OrphanVaultDeletions);
 * from then on the daily retry has them. A member row that is back removes
 * the mark. A vault an operator put on hold (`orphan_hold`, set by hand,
 * RUNBOOK; any value counts) keeps all of its member's vaults out of this, marked or
 * not. So the first run after this was deployed only marks the vaults that
 * are already without a member (also those whose start-over is held for a
 * missing row) and deletes nothing for 7 days.
 *
 * On doubt nothing is written: a member row that cannot be read leaves
 * its vaults for the next run (`read_errors`); and a run that finds more
 * members without a row than ORPHAN_LIMIT, or than ORPHAN_SHARE of the
 * owners it read, marks and asks none of them (`held`), at every run until
 * that is no longer so. The case it protects against is a wrong or damaged
 * members table, above all one restored from an older backup: every
 * member who joined after the backup would look gone. A normal day has
 * none or one stopped deletion; 15 % is far above that and below what a
 * restore weeks old would lose while the membership grows. The fixed count
 * binds from about 34 owners up, the share below that. The grace period
 * covers what both miss: a restore that is put right within 7 days
 * clears the marks again.
 */
export async function deleteOrphanVaults(nowS: number): Promise<OrphanVaultCounts> {
  const counts: OrphanVaultCounts = { marked: 0, waiting: 0, cleared: 0, requested: 0, operator_held: 0, held: 0, read_errors: 0, failures: 0 };
  type OrphanRow = VaultRowLite & { orphan_seen_at?: unknown; orphan_hold?: unknown };
  const owners = new Map<string, OrphanRow[]>();
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table.vaults(),
        FilterExpression: 'attribute_exists(user_guid) AND attribute_not_exists(deletion_requested_at) AND #s <> :d',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':d': 'deleted' },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of r.Items ?? []) {
      const v = item as OrphanRow;
      // Checked again here: what the scan's filter says is not relied on.
      if (typeof v.user_guid !== 'string' || !v.user_guid || typeof v.vault_id !== 'string' || v.vault_id.startsWith('user#')) continue;
      if (v.state === 'deleted' || typeof v.deletion_requested_at === 'number') continue;
      owners.set(v.user_guid, [...(owners.get(v.user_guid) ?? []), v]);
    }
    start = r.LastEvaluatedKey;
  } while (start);

  const orphans: [string, OrphanRow[]][] = [];
  let read = 0;
  for (const [guid, rows] of owners) {
    let present: boolean;
    try {
      const r = await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: guid }, ConsistentRead: true }));
      present = !!r?.Item;
      read++;
    } catch (e) {
      console.error('orphaned vaults: a member row could not be read', JSON.stringify({ user_guid: guid, error: (e as Error).name }));
      counts.read_errors++;
      continue;
    }
    if (!present) {
      orphans.push([guid, rows]);
      continue;
    }
    // The member row is back (restored, or the read before was wrong): the mark goes.
    for (const v of rows.filter((x) => typeof x.orphan_seen_at === 'number')) {
      try {
        await ddb.send(new UpdateCommand({
          TableName: table.vaults(),
          Key: { vault_id: v.vault_id },
          UpdateExpression: 'REMOVE orphan_seen_at',
          ConditionExpression: 'attribute_exists(orphan_seen_at)',
        }));
        counts.cleared++;
      } catch (e) {
        if ((e as Error).name === 'ConditionalCheckFailedException') continue;
        console.error('orphaned vaults: a mark could not be cleared', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
        counts.failures++;
      }
    }
  }

  const allowed = Math.max(1, Math.floor(read * ORPHAN_SHARE));
  if (orphans.length > ORPHAN_LIMIT || orphans.length > allowed) {
    console.warn('orphaned vaults: held, more members without a row than one run accepts', JSON.stringify({ members: orphans.length, owners: read, limit: Math.min(ORPHAN_LIMIT, allowed) }));
    counts.held = orphans.length;
    return counts;
  }

  for (const [guid, rows] of orphans) {
    // Any `orphan_hold` is a hold, whatever its type or value (fail safe):
    // a hold typed by hand as "true" or 1 must not be ignored.
    const holds = rows.filter((v) => v.orphan_hold !== undefined);
    if (holds.length) {
      for (const v of holds.filter((x) => x.orphan_hold !== true)) {
        console.warn('orphaned vaults: orphan_hold is not the boolean true; treated as a hold', JSON.stringify({ vault_id: v.vault_id, type: typeof v.orphan_hold }));
      }
      counts.operator_held++;
      continue;
    }
    try {
      let due = true;
      for (const v of rows) {
        if (typeof v.orphan_seen_at === 'number') {
          if (v.orphan_seen_at > nowS - ORPHAN_GRACE_S) {
            due = false;
            counts.waiting++;
          }
          continue;
        }
        due = false;
        try {
          await ddb.send(new UpdateCommand({
            TableName: table.vaults(),
            Key: { vault_id: v.vault_id },
            UpdateExpression: 'SET orphan_seen_at = :t',
            ConditionExpression: 'attribute_exists(vault_id) AND attribute_not_exists(orphan_seen_at) AND attribute_not_exists(deletion_requested_at)',
            ExpressionAttributeValues: { ':t': nowS },
          }));
          counts.marked++;
          console.warn('orphaned vaults: a vault without a member row, marked', JSON.stringify({ vault_id: v.vault_id, user_guid: guid }));
        } catch (e) {
          if ((e as Error).name !== 'ConditionalCheckFailedException') throw e; // marked or asked meanwhile
        }
      }
      if (!due) continue;
      const seen = Math.min(...rows.map((v) => v.orphan_seen_at as number));
      const vaultIds = await deleteVaults(guid, nowS);
      await audit('system', 'vault.orphan_deletion_requested', guid, { vault_ids: vaultIds, orphan_seen_at: seen });
      counts.requested++;
    } catch (e) {
      console.error('orphaned vaults: not all marked or asked to delete themselves', JSON.stringify({ user_guid: guid, error: (e as Error).name }));
      counts.failures++;
    }
  }
  return counts;
}

/**
 * One EMF line per daily run (no PutMetricData right), zeros included, so
 * that the alarms return to OK by themselves.
 */
export function orphanVaultEmf(c: OrphanVaultCounts, now: number): string {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [{
        Namespace: NAMESPACE,
        Dimensions: [[]],
        Metrics: [
          { Name: 'OrphanVaultsSeen', Unit: 'Count' },
          { Name: 'OrphanVaultsWaiting', Unit: 'Count' },
          { Name: 'OrphanVaultDeletions', Unit: 'Count' },
          { Name: 'OrphanVaultsOperatorHeld', Unit: 'Count' },
          { Name: 'OrphanVaultsHeld', Unit: 'Count' },
        ],
      }],
    },
    OrphanVaultsSeen: c.marked,
    OrphanVaultsWaiting: c.waiting,
    OrphanVaultDeletions: c.requested,
    OrphanVaultsOperatorHeld: c.operator_held,
    OrphanVaultsHeld: c.held + c.read_errors + c.failures,
  });
}

/**
 * Start-overs (MEMBER-API 2.1.0, VAULT-MESSAGING 0.16.0 §11.11.9): a
 * `pending` deletion past `deletes_at` becomes `executing` (conditional on
 * the same deletion still pending, so a cancel that won stays cancelled)
 * and its vault is asked to delete itself exactly as for an account
 * cancellation; `queued_at` records when the `delete` could be queued. An
 * `executing` one never queued is tried again at each run. The vault's
 * `deleted` report then brings the vault_deleted notice, which emails the
 * member and removes the rows.
 *
 * Only for an active account. A due deletion whose member is suspended or
 * canceled (`not_active`), has no row (`no_member`), or could not be read
 * (`read_error`) stays `pending` and is counted in `held` under that
 * reason: it is neither carried out nor cancelled. The 24 hours exist so
 * that the member can cancel, and an account that is not active cannot use
 * the account page or the app; suspending is also what support does when an
 * account looks taken over. Reinstating the account cancels the deletion
 * (lambda/admin/people.ts, the only code that makes an account active
 * again; anything added that does so must cancel it too), so a held one is
 * not carried out later without a new request. A canceled account's vaults
 * go with the account, by the daily run above.
 *
 * A third case is neither: a due pending deletion on a row that already has
 * `deletion_requested_at` was asked to delete itself by the account's own
 * deletion (the member row is gone by then); this run leaves it to the
 * daily retry and counts nothing.
 *
 * `no_member` without that mark is an orphan: the member row was removed by
 * something that did not ask the vault to delete itself (an account
 * deletion that stopped before its vault step, or an admin's Delete from
 * before it refused while a vault exists). This run holds it and never
 * carries the start-over out on a missing row; it is alarmed. The daily
 * run's orphan scan (`deleteOrphanVaults`) marks the vault and, if the
 * member row is still missing 7 days later and no operator holds it, asks
 * it to delete itself as for a canceled account; from then on it is the
 * first case above. The member row is read consistently just
 * before the conditional write; the two tables are in different AWS
 * accounts, so they cannot be written in one transaction, and a suspension
 * written between this run's read and its write does not stop that
 * deletion.
 */
export async function executeStartOvers(nowS: number): Promise<{ executed: number; retried: number; held: StartOverHeld }> {
  let executed = 0;
  let retried = 0;
  const held: StartOverHeld = { not_active: 0, no_member: 0, read_error: 0 };
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table.vaults(),
        FilterExpression: 'attribute_exists(deletion) AND #s <> :d',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':d': 'deleted' },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of r.Items ?? []) {
      const v = item as VaultRowLite;
      const d = v.deletion;
      if (!d || typeof d.deletion_id !== 'string' || typeof d.deletes_at !== 'number' || v.state === 'deleted') continue;
      if (d.state === 'pending' && d.deletes_at <= nowS) {
        // The account's own deletion already asked this vault to delete
        // itself (the member row is gone): the daily retry has it.
        if (typeof v.deletion_requested_at === 'number') continue;
        const standing = await accountStanding(v.user_guid);
        if (standing !== 'active') {
          held[standing]++;
          continue;
        }
        try {
          await ddb.send(
            new UpdateCommand({
              TableName: table.vaults(),
              Key: { vault_id: v.vault_id },
              UpdateExpression: 'SET deletion.#st = :ex',
              ConditionExpression: 'deletion.deletion_id = :id AND deletion.#st = :p',
              ExpressionAttributeNames: { '#st': 'state' },
              ExpressionAttributeValues: { ':ex': 'executing', ':p': 'pending', ':id': d.deletion_id },
            }),
          );
        } catch (e) {
          if ((e as Error).name === 'ConditionalCheckFailedException') continue; // cancelled meanwhile
          throw e;
        }
        const queued = await requestVaultDeletion(v, nowS);
        if (queued) await markQueued(v.vault_id, d.deletion_id, nowS);
        await audit('system', 'vault.deletion_executed', v.user_guid, { vault_id: v.vault_id, deletion_id: d.deletion_id, queued });
        executed++;
      } else if (d.state === 'executing' && typeof d.queued_at !== 'number') {
        if (await requestVaultDeletion(v, nowS)) await markQueued(v.vault_id, d.deletion_id, nowS);
        retried++;
      }
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return { executed, retried, held };
}

async function markQueued(vaultId: string, deletionId: string, nowS: number): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: table.vaults(),
      Key: { vault_id: vaultId },
      UpdateExpression: 'SET deletion.queued_at = :t',
      ConditionExpression: 'deletion.deletion_id = :id',
      ExpressionAttributeValues: { ':t': nowS, ':id': deletionId },
    }),
  ).catch((e: Error) => {
    if (e.name !== 'ConditionalCheckFailedException') throw e;
  });
}

/** Due start-overs a run did not carry out, by reason. */
export interface StartOverHeld {
  /** The account is suspended or canceled (or the row is not an account). */
  not_active: number;
  /** No member row, or no owner on the vault row. */
  no_member: number;
  /** The member row could not be read. */
  read_error: number;
}

/**
 * Whether a start-over may be carried out for this member: `active` only
 * for an account that can sign in (lambda/shared/members.ts), which is what
 * the member's own request needed. Read consistently. Everything else is a
 * reason to hold: on doubt nothing is deleted, and the next run asks again.
 */
async function accountStanding(userGuid: unknown): Promise<'active' | keyof StartOverHeld> {
  if (typeof userGuid !== 'string' || !userGuid) return 'no_member';
  let m: MemberItem | null;
  try {
    const r = await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: userGuid }, ConsistentRead: true }));
    m = (r.Item as MemberItem | undefined) ?? null;
  } catch (e) {
    console.error('start-over held: the member row could not be read', JSON.stringify({ error: (e as Error).name })); // never the address
    return 'read_error';
  }
  if (!m) return 'no_member';
  return canSignIn(m) ? 'active' : 'not_active';
}

/**
 * One EMF line per 5-minute run (no PutMetricData right): what the run
 * held, by reason. Written at every run, zeros included, so that the alarms
 * on `no_member` and `read_error` return to OK by themselves.
 */
export function startOverEmf(held: StartOverHeld, now: number): string {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [{
        Namespace: NAMESPACE,
        Dimensions: [[]],
        Metrics: [{ Name: 'StartOverHeldNotActive', Unit: 'Count' }, { Name: 'StartOverHeldNoMember', Unit: 'Count' }, { Name: 'StartOverHeldReadError', Unit: 'Count' }],
      }],
    },
    StartOverHeldNotActive: held.not_active,
    StartOverHeldNoMember: held.no_member,
    StartOverHeldReadError: held.read_error,
  });
}

// ---- a deletion the vault marked and that stopped: the resume (MEMBER-API 2.10.0) ----

/** A mark younger than this is left to the vault's own deletion, still running. */
export const RESUME_AFTER_S = 120;
/** For this long after the mark the resume is sent at every run; then hourly; and the row is logged. */
export const RESUME_HOURLY_AFTER_S = 3600;
/** The 5-minute schedule (lib/stacks/member-api-stack.ts): the window in which a log that is due once is written. */
export const RESUME_RUN_S = 300;

export interface DeletionResumes {
  /** `delete_resume` queued. */
  sent: number;
  /** Rows not `deleted` 1 hour or more after `deleting_at` (the metric). */
  pending: number;
}

/**
 * Whether a once-due log falls in this run: `at` (or, after 30 days, each
 * day from `deleting_at + DELETION_STALE_S`) lies within the last run
 * interval. Neither the job nor the spec keeps a "logged" mark, so the
 * schedule's own interval decides; the metric counts every run.
 */
function resumeLogDue(deletingAt: number, nowS: number): boolean {
  const age = nowS - deletingAt;
  if (age >= RESUME_HOURLY_AFTER_S && age < RESUME_HOURLY_AFTER_S + RESUME_RUN_S) return true;
  return age >= DELETION_STALE_S && (age - DELETION_STALE_S) % 86_400 < RESUME_RUN_S;
}

/**
 * A vault deleting itself has the host write `deleting_at` on its row once
 * the marking flush is stored (VAULT-MESSAGING 0.51.0 §12.5 "Mark at the
 * host"). If the deletion stops before `deleted`, nothing else would finish
 * it: the app sends nothing more. So for each row with `deleting_at` at
 * least 2 minutes old and not `deleted`, this run sends the queue operation
 * `delete_resume` (§11.5, no envelope), routed exactly as `delete` is
 * (nothing while the service is paused or to a `removed` release), and sets
 * `deletion_resumed_at`: at every run while the mark is under 1 hour old,
 * then when `deletion_resumed_at` is at least 1 hour old. The vault's
 * `deleted` report is the result; its notice removes the row.
 *
 * The mark is written by the host, which is not trusted: the enclave erases
 * on a `delete_resume` only a vault whose own sealed header records the
 * deletion (or one already erased). This run NEVER sends `delete` because
 * of `deleting_at`, never sets `deletion_requested_at` for it, and nothing
 * a member sees reads the mark.
 *
 * `deletion_resumed_at` is set only when the message was queued, so a run
 * after a pause, or once a requested start has an instance, sends at once.
 * A row with neither a sealed release nor a lease has nowhere to go and is
 * left (its rows are the daily run's, never this run's, to delete).
 */
export async function resumeDeletions(nowS: number): Promise<DeletionResumes> {
  let sent = 0;
  let pending = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table.vaults(),
        FilterExpression: 'attribute_exists(deleting_at) AND #s <> :d',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':d': 'deleted' },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of r.Items ?? []) {
      const v = item as VaultRowLite;
      if (v.state === 'deleted' || typeof v.deleting_at !== 'number') continue;
      const age = nowS - v.deleting_at;
      if (age < RESUME_AFTER_S) continue;
      if (age >= RESUME_HOURLY_AFTER_S) {
        pending++;
        if (resumeLogDue(v.deleting_at, nowS)) console.warn('vault deletion resume pending', JSON.stringify({ vault_id: v.vault_id }));
        if (typeof v.deletion_resumed_at === 'number' && v.deletion_resumed_at > nowS - RESUME_HOURLY_AFTER_S) continue;
      }
      if (await sendDeleteResume(v, nowS)) sent++;
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return { sent, pending };
}

/** `delete_resume` to where `delete` would go; on success, `deletion_resumed_at`. Returns whether it was queued. */
async function sendDeleteResume(v: VaultRowLite, nowS: number): Promise<boolean> {
  if (!v.sealed_release && !v.lease) return false;
  const inst = await routeAsDelete(v, nowS);
  if (!inst) return false;
  const message = {
    v: 1,
    op: 'delete_resume',
    vault_id: v.vault_id,
    user_guid: v.user_guid,
    request_id: newUlid(),
    enqueued_at: new Date(nowS * 1000).toISOString(),
  };
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: inst.queue_url, MessageBody: JSON.stringify(message) }));
  } catch (e) {
    console.error('vault delete_resume enqueue failed', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
    return false;
  }
  await ddb.send(
    new UpdateCommand({
      TableName: table.vaults(),
      Key: { vault_id: v.vault_id },
      UpdateExpression: 'SET deletion_resumed_at = :t',
      ConditionExpression: 'attribute_exists(vault_id)',
      ExpressionAttributeValues: { ':t': nowS },
    }),
  ).catch((e: Error) => {
    if (e.name !== 'ConditionalCheckFailedException') throw e; // the row is gone: deleted meanwhile
  });
  return true;
}

/**
 * One EMF line per 5-minute run (no PutMetricData right), zeros included:
 * the rows still not `deleted` 1 hour after their mark. Counts only.
 */
export function deletionResumeEmf(c: DeletionResumes, now: number): string {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [{ Namespace: NAMESPACE, Dimensions: [[]], Metrics: [{ Name: 'DeletionResumesPending', Unit: 'Count' }] }],
    },
    DeletionResumesPending: c.pending,
  });
}

const USER_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the task `cancel_start_over` answers (the admin API checks `ok` and `task`). */
export interface StartOverCancel {
  ok: true;
  task: 'cancel_start_over';
  /** Pending start-overs this call removed (`requested_at` in epoch seconds). */
  cancelled: { vault_id: string; deletion_id: string; requested_at: number | null }[];
  /** Start-overs already being carried out: they cannot be cancelled. */
  executing: { vault_id: string; deletion_id: string }[];
  /** Start-overs that changed between the read and the write (cancelled by the member, or just carried out). */
  changed: number;
  /**
   * Recoveries of the member's vaults that are still active (pending,
   * available or registered, before `expires_at`; times in epoch seconds).
   * Reported only: this task never changes a recovery.
   */
  recoveries: { vault_id: string; recovery_id: string; state: 'pending' | 'available' | 'registered'; available_at: number | null; expires_at: number }[];
}

type CancelRow = VaultRowLite & {
  deletion?: { requested_at?: unknown };
  recovery?: { recovery_id?: unknown; state?: unknown; available_at?: unknown; expires_at?: unknown };
};

/** One vault row (or the member's pointer row) from the base table, read consistently. The job's role has Query, not GetItem. */
async function consistentRow(vaultId: string): Promise<Record<string, unknown> | null> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: table.vaults(),
      KeyConditionExpression: 'vault_id = :id',
      ExpressionAttributeValues: { ':id': vaultId },
      ConsistentRead: true,
      Limit: 1,
    }),
  );
  return r.Items?.[0] ?? null;
}

/**
 * The ids of a member's vaults, from the pointer row (read consistently:
 * the current vault, which the index may not list yet) and the
 * eventually consistent `user-index` (earlier vaults). Ids only: the
 * caller reads each row again with `consistentRow`.
 */
async function memberVaultIds(userGuid: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const pointer = await consistentRow(vaultPointerKey(userGuid));
  if (typeof pointer?.current_vault_id === 'string') ids.add(pointer.current_vault_id);
  for await (const item of query({
    TableName: table.vaults(),
    IndexName: 'user-index',
    KeyConditionExpression: 'user_guid = :g',
    ExpressionAttributeValues: { ':g': userGuid },
  })) {
    if (typeof item.vault_id === 'string') ids.add(item.vault_id);
  }
  return ids;
}

/** What the task `member_vaults` answers (the admin API checks `ok` and `task`). */
export interface MemberVaults {
  ok: true;
  task: 'member_vaults';
  /** The member's vaults that are not `deleted` (a deletion asked for and not yet reported included). */
  vaults: { vault_id: string; state: string | null }[];
}

/**
 * A member's vaults that are not deleted, for the admin API's Delete,
 * which refuses while there is one (ADMIN-API "People"). It only reads: the
 * same reads as the cancel below (the pointer row and the index for the
 * ids, each row again from the base table, consistently). A row that
 * names another member is not this member's. Any failed read fails the
 * task, so the caller never takes "no vault" from an error.
 */
export async function memberVaults(userGuid: unknown): Promise<MemberVaults> {
  if (typeof userGuid !== 'string' || !USER_GUID_RE.test(userGuid)) throw new Error('member_vaults: user_guid is not an account id');
  const out: MemberVaults = { ok: true, task: 'member_vaults', vaults: [] };
  for (const id of await memberVaultIds(userGuid)) {
    const v = (await consistentRow(id)) as VaultRowLite | null;
    if (!v || v.user_guid !== userGuid || v.state === 'deleted') continue;
    out.vaults.push({ vault_id: v.vault_id, state: typeof v.state === 'string' ? v.state : null });
  }
  return out;
}

/**
 * The handler of a third function (lib/stacks/member-api-stack.ts,
 * `MemberVaults`, its own role: Query on the vaults table and its
 * user-index only), which the admin API may invoke: it runs the task
 * `member_vaults` and nothing else of this module.
 */
export const memberVaultsHandler = async (event?: { task?: string; user_guid?: unknown }): Promise<MemberVaults> => {
  if (event?.task !== 'member_vaults') throw new Error('this function runs the task member_vaults only');
  return memberVaults(event.user_guid);
};

/**
 * Cancel a member's pending start-over for the admin API (ADMIN-API
 * "People"; also when an account is reinstated). The admin API's functions
 * hold no right on the vault tables; this job's role already may write
 * `deletion`. The record is removed under the condition of the member's own
 * cancel (the same deletion, still `pending`), so one that is `executing`
 * is never undone here and a repeat finds nothing. Unlike the member's
 * cancel it does not set `updated_at` (this role may not name it), and it
 * neither audits nor mails: the caller does both.
 *
 * Every decision is made from a consistent read of the base table, because
 * a reinstatement relies on the answer "nothing pending". The vaults come
 * from two places: the member's pointer row, read consistently, which names
 * the current vault (the only vault a start-over can be requested for: the
 * request route finds it through the same pointer); and the `user-index`,
 * which is eventually consistent and is used only to find other vault ids.
 * A vault the index does not list yet is therefore still found if it is the
 * current one, and a vault that is not the current one is an earlier vault,
 * already deleted, on which nothing new can be requested. What the index
 * says about a row is never used: each id is read again.
 *
 * An active recovery on a vault is reported (the reinstatement asks the
 * admin about it) and never changed here.
 */
export async function cancelStartOvers(userGuid: unknown, nowS = Math.floor(Date.now() / 1000)): Promise<StartOverCancel> {
  if (typeof userGuid !== 'string' || !USER_GUID_RE.test(userGuid)) throw new Error('cancel_start_over: user_guid is not an account id');
  const out: StartOverCancel = { ok: true, task: 'cancel_start_over', cancelled: [], executing: [], changed: 0, recoveries: [] };
  for (const id of await memberVaultIds(userGuid)) {
    const v = (await consistentRow(id)) as CancelRow | null;
    if (!v || v.user_guid !== userGuid || v.state === 'deleted') continue;
    const rec = v.recovery;
    if (rec && typeof rec.recovery_id === 'string' && typeof rec.expires_at === 'number' && nowS < rec.expires_at && (rec.state === 'pending' || rec.state === 'registered')) {
      const availableAt = typeof rec.available_at === 'number' ? rec.available_at : null;
      const state = rec.state === 'registered' ? 'registered' : availableAt !== null && nowS >= availableAt ? 'available' : 'pending';
      out.recoveries.push({ vault_id: v.vault_id, recovery_id: rec.recovery_id, state, available_at: availableAt, expires_at: rec.expires_at });
    }
    const d = v.deletion;
    if (!d || typeof d.deletion_id !== 'string') continue;
    if (d.state === 'executing') {
      out.executing.push({ vault_id: v.vault_id, deletion_id: d.deletion_id });
      continue;
    }
    if (d.state !== 'pending') continue;
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: table.vaults(),
          Key: { vault_id: v.vault_id },
          UpdateExpression: 'REMOVE deletion',
          ConditionExpression: 'deletion.deletion_id = :id AND deletion.#st = :p',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: { ':id': d.deletion_id, ':p': 'pending' },
        }),
      );
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
      out.changed++;
      continue;
    }
    // At once, so that a record of the cancel exists whatever happens to
    // the caller's audit event (its write can fail, the caller can time out).
    console.log(JSON.stringify({ startOverCancel: { user_guid: userGuid, vault_id: v.vault_id, deletion_id: d.deletion_id } }));
    out.cancelled.push({ vault_id: v.vault_id, deletion_id: d.deletion_id, requested_at: typeof d.requested_at === 'number' ? d.requested_at : null });
  }
  return out;
}

/**
 * The handler of the second function (lib/stacks/member-api-stack.ts,
 * `StartOverCancel`), the only one the admin API may invoke: it runs the
 * task `cancel_start_over` and nothing else of this module.
 */
export const cancelHandler = async (event?: { task?: string; user_guid?: unknown }): Promise<StartOverCancel> => {
  if (event?.task !== 'cancel_start_over') throw new Error('this function runs the task cancel_start_over only');
  return cancelStartOvers(event.user_guid);
};

// ---- membership requests: withdrawn, and declined past their 30 days ---------------

export const NAMESPACE = 'VettID/MemberApi';

/** One EMF line (no PutMetricData right): what the request-removal alarms read. */
export function removalEmf(failures: number, abandoned: number, now: number): string {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [{ Namespace: NAMESPACE, Dimensions: [[]], Metrics: [{ Name: 'RequestRemovalFailures', Unit: 'Count' }, { Name: 'RequestRemovalAbandoned', Unit: 'Count' }] }],
    },
    RequestRemovalFailures: failures,
    RequestRemovalAbandoned: abandoned,
  });
}

const conditionFailed = (e: unknown): boolean => {
  const err = e as { name?: string; CancellationReasons?: { Code?: string }[] };
  if (err.name === 'ConditionalCheckFailedException') return true;
  return err.name === 'TransactionCanceledException' && (err.CancellationReasons ?? []).some((r) => r.Code === 'ConditionalCheckFailed');
};

/**
 * The address's SES identity goes only if this request created it
 * (`owns_identity`, set when the request's own CreateEmailIdentity
 * succeeded), it is not one of the project's own addresses, and the mailing
 * list does not use it. The request's own row is the only member row the
 * address can have (the email marker), and it is being removed. A row from
 * before 2.6.0 has no flag: its identity is kept (never on doubt).
 */
async function releaseIdentity(m: MemberItem): Promise<'deleted' | 'kept'> {
  if (m.owns_identity !== true || ownAddress(m.email)) return 'kept';
  const onList = await ddb.send(new GetCommand({ TableName: env('TABLE_MAILING_LIST'), Key: { email: m.email }, ConsistentRead: true }));
  if (onList.Item) return 'kept';
  try {
    await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: m.email }));
  } catch (e) {
    if ((e as Error).name !== 'NotFoundException') throw e;
  }
  return 'deleted';
}

/**
 * The SES identity of an address whose row the daily run has just deleted
 * (a request never verified within 14 days; an account deleted 7 days after
 * its cancellation). Kept if the mailing list uses the address, if the row
 * found the identity already there when it was created (`owns_identity`
 * false, 2.6.0), or if the address is one of the project's own (under
 * vettid.org); otherwise deleted. A row from before 2.6.0 (no flag) keeps
 * the rule it was created under: its request created the identity. The
 * caller calls this only when the row's own email marker went with it: a
 * marker that names another request or account means the address is in use
 * again, and its identity with it.
 */
async function releaseIdentityOfGoneRow(m: MemberItem): Promise<'deleted' | 'kept'> {
  const onList = await ddb.send(new GetCommand({ TableName: env('TABLE_MAILING_LIST'), Key: { email: m.email }, ConsistentRead: true }));
  if (onList.Item || m.owns_identity === false || ownAddress(m.email)) return 'kept';
  try {
    await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: m.email }));
  } catch (e) {
    if ((e as Error).name !== 'NotFoundException') throw e;
  }
  return 'deleted';
}

/**
 * A request has no Cognito user, except one a failed code registration
 * left behind (lambda/member/public.ts falls back to review). Delete it
 * only if it carries this request's id: a user under the same address with
 * another id is somebody's account.
 */
async function deleteRequestUser(m: MemberItem): Promise<'deleted' | 'none' | 'other'> {
  const r = await deleteOwnSignInUser(m);
  if (r === 'other') console.warn('request removal: the sign-in user under its address carries another id and is left', JSON.stringify({ user_guid: m.user_guid })); // never the address
  return r;
}

type RowDelete = { TableName: string; Key: { user_guid: string }; ConditionExpression: string; ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, unknown> };

/**
 * A member's row and its email marker, in one transaction, so that neither
 * is ever there without the other: the row only under `row`'s own guard,
 * the marker only if it is this member's own (or already gone). A marker
 * that names another request (made for the address after somebody else
 * removed the old marker) is not ours: it is left ('left'), and the row
 * goes alone, still under its guard. A row that fails its guard throws a
 * failed condition (see `conditionFailed`): nothing was deleted.
 */
async function deleteRowAndOwnMarker(m: MemberItem, row: RowDelete, what: string): Promise<'deleted' | 'left'> {
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [{ Delete: row }, { Delete: ownEmailMarkerDelete(m) }] }));
    return 'deleted';
  } catch (e) {
    const err = e as { name?: string; CancellationReasons?: { Code?: string }[] };
    const [rowReason, markerReason] = err.CancellationReasons ?? [];
    // Only "the marker is somebody else's" is handled here; a row that
    // fails its guard (or anything else) is the caller's to judge.
    if (err.name !== 'TransactionCanceledException' || rowReason?.Code === 'ConditionalCheckFailed' || markerReason?.Code !== 'ConditionalCheckFailed') throw e;
    console.warn(`${what}: the email marker belongs to another request and is left`, JSON.stringify({ user_guid: m.user_guid })); // never the address
    await ddb.send(new DeleteCommand(row));
    return 'left';
  }
}

/** A request's row, only while it is still in `state`, with its own marker. */
const deleteRequestRows = (m: MemberItem, state: 'withdrawn' | 'rejected') =>
  deleteRowAndOwnMarker(
    m,
    {
      TableName: table.members(),
      Key: { user_guid: m.user_guid },
      ConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':s': state },
    },
    'request removal',
  );

export interface RemovalCounts {
  removed: number;
  failures: number;
  abandoned: number;
}

/**
 * Remove requests that are due: everything outside the table first (so a
 * failure leaves the row to be retried at the next run), the rows last.
 * One request's failure never stops the next one. After
 * REMOVAL_GIVE_UP_DAYS of failures the rows are deleted anyway, so that no
 * address waits in the table for ever; what could not be removed outside
 * it (an SES identity, a Cognito user) is then the operator's to
 * reconcile, and the alarm on RequestRemovalAbandoned says so.
 */
export async function removeRequests(
  due: { m: MemberItem; since: number }[],
  state: 'withdrawn' | 'rejected',
  nowMs: number,
): Promise<RemovalCounts> {
  const counts: RemovalCounts = { removed: 0, failures: 0, abandoned: 0 };
  const after = state === 'withdrawn' ? 'withdraw' : 'decline';
  for (const { m, since } of due) {
    try {
      const user = await deleteRequestUser(m);
      const identity = await releaseIdentity(m);
      const marker = await deleteRequestRows(m, state);
      await audit('system', 'request.removed', m.user_guid, { after, identity, ...leftBehind(user, marker) });
      counts.removed++;
    } catch (e) {
      if (conditionFailed(e)) continue; // no longer in that state (an admin deleted it meanwhile): not ours
      console.error('request removal failed', JSON.stringify({ after, error: (e as Error).name })); // never the address
      if (nowMs - since < REMOVAL_GIVE_UP_DAYS * 86_400_000) {
        counts.failures++;
        continue;
      }
      try {
        const marker = await deleteRequestRows(m, state);
        await audit('system', 'request.removal_incomplete', m.user_guid, { after, ...leftBehind(undefined, marker) });
        counts.abandoned++;
      } catch (e2) {
        if (conditionFailed(e2)) continue;
        console.error('request removal could not be abandoned', JSON.stringify({ after, error: (e2 as Error).name }));
        counts.failures++;
      }
    }
  }
  return counts;
}

const ms = (iso: unknown): number => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0; // unreadable: treated as old
};

/** Withdrawn requests (the public route marked them): all of them are due. */
export async function removeWithdrawn(nowMs: number): Promise<RemovalCounts> {
  const due: { m: MemberItem; since: number }[] = [];
  for await (const item of query({
    TableName: table.members(),
    IndexName: 'state-index',
    KeyConditionExpression: '#s = :w',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: { ':w': 'withdrawn' },
  })) {
    const m = item as MemberItem;
    due.push({ m, since: ms(m.withdrawn_at ?? m.updated_at) });
  }
  return removeRequests(due, 'withdrawn', nowMs);
}

/**
 * Declined requests, DECLINED_DAYS after the decline: `rejected_at`, or
 * for a row declined before 2.6.0 its `updated_at` (the decline was the
 * row's last change).
 */
export async function removeDeclined(nowMs: number): Promise<RemovalCounts> {
  const due: { m: MemberItem; since: number }[] = [];
  for await (const item of query({
    TableName: table.members(),
    IndexName: 'state-index',
    KeyConditionExpression: '#s = :r',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: { ':r': 'rejected' },
  })) {
    const m = item as MemberItem;
    const dueAt = ms(m.rejected_at ?? m.updated_at) + DECLINED_DAYS * 86_400_000;
    if (dueAt <= nowMs) due.push({ m, since: dueAt });
  }
  return removeRequests(due, 'rejected', nowMs);
}

export const handler = async (event?: { task?: string }) => {
  // The five-minute schedule (MEMBER-API 2.1.0): start-overs only.
  if (event?.task === 'start_over') {
    const { held, ...r } = await executeStartOvers(Math.floor(Date.now() / 1000));
    console.log(JSON.stringify({ startOvers: r }));
    // What it held, by reason, on a line of its own (the line above is unchanged).
    console.log(startOverEmf(held, Date.now()));
    // 2.10.0: deletions the vault marked and that stopped. A failure here
    // never undoes the start-overs above; the metric line is written anyway.
    let resumes: DeletionResumes = { sent: 0, pending: 0 };
    try {
      resumes = await resumeDeletions(Math.floor(Date.now() / 1000));
    } catch (e) {
      console.error('deletion resume sweep failed', (e as Error).name);
    }
    console.log(deletionResumeEmf(resumes, Date.now()));
    return r;
  }
  // The fifteen-minute schedule (MEMBER-API 2.6.0): withdrawn requests only.
  if (event?.task === 'requests') {
    const r = await removeWithdrawn(Date.now());
    console.log(removalEmf(r.failures, r.abandoned, Date.now()));
    console.log(JSON.stringify({ withdrawn: r }));
    return r;
  }
  const now = new Date().toISOString();
  // Both sweeps below delete the row FIRST, under its guard and in one
  // transaction with its own email marker, and everything else after.
  //  - The guard is what protects a person who changed their mind: an
  //    account an admin reinstated after the query, a request verified or
  //    approved after it. If the guard fails, nothing at all is touched.
  //    (Row last would need a claim on the row that reinstate respects; the
  //    job's role cannot write to a member row.)
  //  - Marker and row together: an address is never left reserved by a
  //    marker with no row behind it.
  //  - What comes after the row cannot be retried from the row. So each
  //    step is tried on its own, a failure never skips the next step or
  //    the next row, and what could not be removed is named in the audit
  //    event (`incomplete`), logged and alarmed (RequestRemovalAbandoned),
  //    for the operator to reconcile (RUNBOOK "Membership requests"). The
  //    vaults are the exception: the orphan scan below finds them again.
  let failures = 0; // the row could not be deleted: it is still there, and the next run tries again
  let incomplete = 0; // the row is gone, something of its own outside it is not
  const afterRow = (what: string, m: MemberItem, undone: string[]) => async <T>(name: string, f: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await f();
    } catch (e) {
      console.error(`${what}: removed, but not all of it`, JSON.stringify({ user_guid: m.user_guid, not_removed: name, error: (e as Error).name })); // never the address
      undone.push(name);
      return undefined;
    }
  };
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
      let marker: 'deleted' | 'left';
      try {
        marker = await deleteRowAndOwnMarker(
          m,
          {
            TableName: table.members(),
            Key: { user_guid: m.user_guid },
            ConditionExpression: 'account_status = :c AND delete_after < :now',
            ExpressionAttributeValues: { ':c': 'canceled', ':now': now },
          },
          'canceled account',
        );
      } catch (e) {
        if (conditionFailed(e)) continue; // reinstated (or deleted by an admin) meanwhile: not ours
        console.error('canceled account: not removed', JSON.stringify({ user_guid: m.user_guid, error: (e as Error).name })); // never the address
        failures++;
        continue;
      }
      const undone: string[] = [];
      const step = afterRow('canceled account', m, undone);
      // The sign-in user is named by the address, not by the account: it
      // goes only if it is this account's own. One that carries another id
      // belongs to a request or account made for the address since.
      const user = await step('sign_in_user', () => deleteOwnSignInUser(m));
      if (user === 'other') {
        console.warn('canceled account: the sign-in user under its address carries another id and is left', JSON.stringify({ user_guid: m.user_guid })); // never the address
      }
      await step('subscription', () => ddb.send(new DeleteCommand({ TableName: table.subscriptions(), Key: { user_guid: m.user_guid } })));
      const vaultIds = (await step('vaults', () => deleteVaults(m.user_guid, Math.floor(Date.now() / 1000)))) ?? [];
      // The address's SES identity, under the 14-day reclaim's rule, and only
      // while nothing else uses the address: its marker went with the row
      // and the sign-in user under it was this account's own or none. One
      // that carries another id (or could not be checked) means the address
      // may have been requested again, and its identity is that request's.
      const identity = marker === 'deleted' && (user === 'deleted' || user === 'none')
        ? await step('ses_identity', () => releaseIdentityOfGoneRow(m))
        : 'kept';
      await audit('system', 'member.delete_after_cancel', m.user_guid, {
        ...(vaultIds.length ? { vault_ids: vaultIds } : {}),
        ...(identity ? { identity } : {}),
        ...leftBehind(user, marker),
        ...(undone.length ? { incomplete: undone } : {}),
      });
      if (undone.length) incomplete++;
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
    let marker: 'deleted' | 'left';
    try {
      marker = await deleteRowAndOwnMarker(
        m,
        {
          TableName: table.members(),
          Key: { user_guid: m.user_guid },
          ConditionExpression: '#s = :r AND email_verified = :f',
          ExpressionAttributeNames: { '#s': 'state' },
          ExpressionAttributeValues: { ':r': 'requested', ':f': false },
        },
        'unverified request',
      );
    } catch (e) {
      if (conditionFailed(e)) continue; // verified, approved, declined or deleted meanwhile: not ours
      console.error('unverified request: not removed', JSON.stringify({ user_guid: m.user_guid, error: (e as Error).name })); // never the address
      failures++;
      continue;
    }
    const undone: string[] = [];
    // A marker that names another request: the address has been requested
    // again, and its SES identity is what that request's verification runs
    // on. Neither is this row's to delete.
    if (marker === 'deleted') {
      await afterRow('unverified request', m, undone)('ses_identity', () => releaseIdentityOfGoneRow(m));
    }
    await audit('system', 'request.reclaim_unverified', m.user_guid, { ...leftBehind(undefined, marker), ...(undone.length ? { incomplete: undone } : {}) });
    if (undone.length) incomplete++;
    reclaimed++;
  }

  // Declined requests past their 30 days. A failure here is counted and
  // alarmed, and never stops the rest of the run.
  let declined: RemovalCounts = { removed: 0, failures: 0, abandoned: 0 };
  try {
    declined = await removeDeclined(Date.now());
  } catch (e) {
    console.error('declined-request sweep failed', (e as Error).name);
    declined.failures++;
  }
  // One alarm for "a removal is waiting" and one for "a removal ended
  // unfinished", whatever was being removed.
  console.log(removalEmf(declined.failures + failures, declined.abandoned + incomplete, Date.now()));

  // Vaults whose member row is gone and that nobody asked to delete: the
  // account deletion above stopped before its vault step finished, in this
  // run or an earlier one. Lines of their own (the summary line below is
  // unchanged); a failure here never stops the rest of the run.
  let orphans: OrphanVaultCounts = { marked: 0, waiting: 0, cleared: 0, requested: 0, operator_held: 0, held: 0, read_errors: 0, failures: 0 };
  try {
    orphans = await deleteOrphanVaults(Math.floor(Date.now() / 1000));
  } catch (e) {
    console.error('orphaned-vault sweep failed', (e as Error).name);
    orphans.failures++;
  }
  console.log(JSON.stringify({ vaultOrphans: orphans }));
  console.log(orphanVaultEmf(orphans, Date.now()));

  const vaultRetries = await retryVaultDeletions(Math.floor(Date.now() / 1000));

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
  console.log(JSON.stringify({ deleted, reclaimed, expired, vaultRetries, declined, failures, incomplete }));
  return { deleted, reclaimed, expired, vaultRetries, declined, failures, incomplete };
};
