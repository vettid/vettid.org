/**
 * Every 5 minutes (event `{task: "start_over"}`, MEMBER-API 2.1.0,
 * VAULT-MESSAGING 0.16.0 §11.11.9): each "delete my vault and start over"
 * past its `deletes_at` and not cancelled is marked `executing` and its
 * vault is asked to delete itself (the host's `delete`, as below); one
 * that could not be queued yet (no instance running, the service paused)
 * is tried again at the next run, and the daily retry below covers the rest.
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
import { DeleteEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DeleteCommand, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { ddb, env, ses, table } from '../shared/aws';

const STALE_DAYS = 14;
import { deleteOwnSignInUser, leftBehind, ownEmailMarkerDelete, vaultPointerKey } from '../shared/members';
import type { MemberItem, SubscriptionItem } from '../shared/model';
import { DECLINED_DAYS, REMOVAL_GIVE_UP_DAYS, ownAddress } from '../shared/requests';
import { liveLease, newUlid, pickInstance, releaseRow, requestStart, routable } from '../shared/vault-routing';
import { vaultService } from '../shared/vault-service';

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
 */
export async function executeStartOvers(nowS: number): Promise<{ executed: number; retried: number }> {
  let executed = 0;
  let retried = 0;
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
  return { executed, retried };
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
    const r = await executeStartOvers(Math.floor(Date.now() / 1000));
    console.log(JSON.stringify({ startOvers: r }));
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
  //    for the operator to reconcile (RUNBOOK "Membership requests").
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
      await audit('system', 'member.delete_after_cancel', m.user_guid, {
        ...(vaultIds.length ? { vault_ids: vaultIds } : {}),
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
      await afterRow('unverified request', m, undone)('ses_identity', async () => {
        const onList = await ddb.send(new GetCommand({ TableName: env('TABLE_MAILING_LIST'), Key: { email: m.email } }));
        // 2.6.0: a request that found the identity already there (`owns_identity`
        // false) leaves it; one of the project's own addresses is never deleted.
        // A row from before 2.6.0 (no flag) keeps the rule it was created under.
        if (onList.Item || m.owns_identity === false || ownAddress(m.email)) return;
        try {
          await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: m.email }));
        } catch (e) {
          if ((e as Error).name !== 'NotFoundException') throw e;
        }
      });
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
