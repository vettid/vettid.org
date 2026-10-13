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
 * held and why (EMF, alarmed).
 *
 * A second function runs this module's `cancelHandler` and nothing else
 * (event `{task: "cancel_start_over", user_guid}`): the admin API, which
 * holds no right on the vault tables, invokes it to cancel a member's
 * pending start-over. It shares this job's role. `handler` below does not
 * know that task.
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
 *    vault_deleted notice; the audit trail stays)
 *  - retry vault deletions not yet reported
 *  - reclaim membership requests never email-verified within 14 days
 *  - remove membership requests declined more than 30 days ago (2.6.0),
 *    exactly as a withdrawn one
 *  - mark subscriptions past their expiry as `expired`
 */
import { AdminDeleteUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DeleteEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DeleteCommand, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { cognito, ddb, env, ses, table } from '../shared/aws';

const STALE_DAYS = 14;
import { emailMarkerKey, vaultPointerKey } from '../shared/members';
import type { MemberItem, SubscriptionItem } from '../shared/model';
import { DECLINED_DAYS, REMOVAL_GIVE_UP_DAYS, ownAddress } from '../shared/requests';
import { liveLease, newUlid, pickInstance, releaseRow, requestStart, routable } from '../shared/vault-routing';
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
  /** MEMBER-API 2.1.0: the member's start-over (§11.11.9), written by the member API. */
  deletion?: { deletion_id?: unknown; state?: unknown; deletes_at?: unknown; queued_at?: unknown };
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
  const paused = !(await vaultService()).enabled;
  let inst = paused ? null : await liveLease(v, nowS);
  if (!inst && v.sealed_release && !paused) {
    const rel = await releaseRow(v.sealed_release);
    // A `removed` release (not reopened for a rescue) is never started
    // (VAULT-MESSAGING 0.10.0 §11.10.5); the stored objects of vaults still
    // sealed to it go after the key's deletion (VAULT-RELEASES §3.5, D + 37;
    // not built yet). Until then the row stays, retried and flagged below.
    // A canary release is the host's to reach for a canary member's vault.
    if (routable(rel, { canary: true })) {
      inst = await pickInstance(v.sealed_release, nowS);
      if (!inst) await requestStart(v.sealed_release);
    }
  }
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
 * something that did not ask the vault to delete itself (an admin's
 * Delete). It is held, never erased on a missing row, and alarmed for an
 * operator to decide (RUNBOOK). The member row is read consistently just
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
  for (const id of ids) {
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
 * A request has no Cognito user, except one a failed code registration
 * left behind (lambda/member/public.ts falls back to review). Delete it
 * only if it carries this request's id: a user under the same address with
 * another id is somebody's account.
 */
async function deleteRequestUser(m: MemberItem): Promise<void> {
  try {
    const u = await cognito.send(new AdminGetUserCommand({ UserPoolId: env('MEMBER_POOL_ID'), Username: m.email }));
    if (u.UserAttributes?.find((a) => a.Name === 'custom:user_guid')?.Value !== m.user_guid) return;
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: env('MEMBER_POOL_ID'), Username: m.email }));
  } catch (e) {
    if ((e as Error).name !== 'UserNotFoundException') throw e;
  }
}

/**
 * The row and its email marker, together, and only while the row is still
 * in `state`. The marker goes only if it is this request's own (or already
 * gone): an admin's Delete removes marker and row in two calls, and a new
 * request for the address made in between owns a new marker under the same
 * key. A marker that names another request is not ours: it is left, and the
 * row goes alone.
 */
async function deleteRequestRows(m: MemberItem, state: 'withdrawn' | 'rejected'): Promise<void> {
  const row = {
    TableName: table.members(),
    Key: { user_guid: m.user_guid },
    ConditionExpression: '#s = :s',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: { ':s': state },
  };
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: row },
          {
            Delete: {
              TableName: table.members(),
              Key: { user_guid: emailMarkerKey(m.email) },
              ConditionExpression: 'attribute_not_exists(user_guid) OR member_guid = :g',
              ExpressionAttributeValues: { ':g': m.user_guid },
            },
          },
        ],
      }),
    );
  } catch (e) {
    const err = e as { name?: string; CancellationReasons?: { Code?: string }[] };
    const [rowReason, markerReason] = err.CancellationReasons ?? [];
    // Only "the marker is somebody else's" is handled here; a row no longer
    // in `state` (or anything else) is the caller's to judge.
    if (err.name !== 'TransactionCanceledException' || rowReason?.Code === 'ConditionalCheckFailed' || markerReason?.Code !== 'ConditionalCheckFailed') throw e;
    console.warn('request removal: the email marker belongs to another request and is left', JSON.stringify({ state })); // never the address
    await ddb.send(new DeleteCommand(row));
  }
}

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
      await deleteRequestUser(m);
      const identity = await releaseIdentity(m);
      await deleteRequestRows(m, state);
      await audit('system', 'request.removed', m.user_guid, { after, identity });
      counts.removed++;
    } catch (e) {
      if (conditionFailed(e)) continue; // no longer in that state (an admin deleted it meanwhile): not ours
      console.error('request removal failed', JSON.stringify({ after, error: (e as Error).name })); // never the address
      if (nowMs - since < REMOVAL_GIVE_UP_DAYS * 86_400_000) {
        counts.failures++;
        continue;
      }
      try {
        await deleteRequestRows(m, state);
        await audit('system', 'request.removal_incomplete', m.user_guid, { after });
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
      const vaultIds = await deleteVaults(m.user_guid, Math.floor(Date.now() / 1000));
      await audit('system', 'member.delete_after_cancel', m.user_guid, vaultIds.length ? { vault_ids: vaultIds } : {});
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
    // 2.6.0: a request that found the identity already there (`owns_identity`
    // false) leaves it; one of the project's own addresses is never deleted.
    // A row from before 2.6.0 (no flag) keeps the rule it was created under.
    if (!onList.Item && m.owns_identity !== false && !ownAddress(m.email)) {
      try {
        await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: m.email }));
      } catch (e) {
        if ((e as Error).name !== 'NotFoundException') throw e;
      }
    }
    await audit('system', 'request.reclaim_unverified', m.user_guid, {});
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
  console.log(removalEmf(declined.failures, declined.abandoned, Date.now()));

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
  console.log(JSON.stringify({ deleted, reclaimed, expired, vaultRetries, declined }));
  return { deleted, reclaimed, expired, vaultRetries, declined };
};
