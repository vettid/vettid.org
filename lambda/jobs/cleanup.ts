/**
 * Every 5 minutes (event `{task: "start_over"}`, MEMBER-API 2.1.0,
 * VAULT-MESSAGING 0.16.0 §11.11.9): each "delete my vault and start over"
 * past its `deletes_at` and not cancelled is marked `executing` and its
 * vault is asked to delete itself (the host's `delete`, as below); one
 * that could not be queued yet (no instance running, the service paused)
 * is tried again at the next run, and the daily retry below covers the rest.
 *
 * Daily:
 *  - delete accounts canceled more than 7 days ago (Cognito user,
 *    subscription, member row + email marker; each vault is asked to delete
 *    itself, VAULT-MESSAGING 0.9.0 §12.5, and its row goes with the
 *    vault_deleted notice; the audit trail stays)
 *  - retry vault deletions not yet reported
 *  - reclaim membership requests never email-verified within 14 days
 *  - mark subscriptions past their expiry as `expired`
 */
import { AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DeleteEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DeleteCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { cognito, ddb, env, ses, table } from '../shared/aws';

const STALE_DAYS = 14;
import { emailMarkerKey, vaultPointerKey } from '../shared/members';
import type { MemberItem, SubscriptionItem } from '../shared/model';
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

export const handler = async (event?: { task?: string }) => {
  // The five-minute schedule (MEMBER-API 2.1.0): start-overs only.
  if (event?.task === 'start_over') {
    const r = await executeStartOvers(Math.floor(Date.now() / 1000));
    console.log(JSON.stringify({ startOvers: r }));
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
    if (!onList.Item) {
      try {
        await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: m.email }));
      } catch (e) {
        if ((e as Error).name !== 'NotFoundException') throw e;
      }
    }
    await audit('system', 'request.reclaim_unverified', m.user_guid, {});
    reclaimed++;
  }

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
  console.log(JSON.stringify({ deleted, reclaimed, expired, vaultRetries }));
  return { deleted, reclaimed, expired, vaultRetries };
};
