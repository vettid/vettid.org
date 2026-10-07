/**
 * Sends a member's account snapshot to their running vault (MEMBER-API
 * 2.0.0 "Account snapshot to the vault", VAULT-MESSAGING 0.15.0 §11.13).
 *
 * Invoked asynchronously ({ user_guid }) by the account routes after terms
 * are accepted, a subscription is started or cancelled and the account is
 * cancelled, by the admin site's equivalents, and (2.2.0) by the vault-names
 * job after it processed a name change (lambda/jobs/vault-names.ts). It sends the queue op
 * `account` only to the vault's live leaseholder: with no live lease nothing
 * is sent (the next unlock carries a snapshot), and nothing is ever started.
 * A response slot is written as for a lock; the host answers it `done`.
 *
 * Sent while the vault service is paused too: it reaches only a running
 * vault (MEMBER-API "Vault service pause"). Not audited: it is the member's
 * own data going to the member's own vault.
 */
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { snapshotFor } from '../shared/account-snapshot';
import { ddb, table } from '../shared/aws';
import { nowIso } from '../shared/ids';
import { vaultPointerKey } from '../shared/members';
import type { MemberItem } from '../shared/model';
import { liveLease, newUlid } from '../shared/vault-routing';

const sqs = new SQSClient({});
const GUID_RE = /^[A-Za-z0-9-]{1,64}$/;
/** Slots live 15 minutes (§11.5). */
const REQUEST_TTL_S = 15 * 60;

export const handler = async (event: { user_guid?: unknown }): Promise<{ sent: boolean }> => {
  const guid = event?.user_guid;
  if (typeof guid !== 'string' || !GUID_RE.test(guid)) return { sent: false };
  // Consistent: the change that asked for this push was written just before.
  const m = (await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: guid }, ConsistentRead: true }))).Item as MemberItem | undefined;
  if (!m) return { sent: false };

  const p = await ddb.send(new GetCommand({ TableName: table.vaults(), Key: { vault_id: vaultPointerKey(guid) }, ConsistentRead: true }));
  const vaultId = typeof p.Item?.current_vault_id === 'string' ? (p.Item.current_vault_id as string) : null;
  if (!vaultId) return { sent: false };
  const v = (await ddb.send(new GetCommand({ TableName: table.vaults(), Key: { vault_id: vaultId }, ConsistentRead: true }))).Item;
  if (!v || v.user_guid !== guid || v.state === 'deleted') return { sent: false };

  const now = Math.floor(Date.now() / 1000);
  const holder = await liveLease(v as { lease?: { instance_id?: unknown; lease_expires_at?: unknown } }, now);
  if (!holder) return { sent: false };
  // The vault row's name_change_result rides along (2.2.0).
  const account = await snapshotFor(m, v);
  if (!account) return { sent: false };

  const requestId = newUlid();
  const created = nowIso();
  await ddb.send(
    new PutCommand({
      TableName: table.vaultRequests(),
      Item: { request_id: requestId, vault_id: vaultId, user_guid: guid, op: 'account', status: 'queued', instance_id: holder.instance_id, created_at: created, expires_at: now + REQUEST_TTL_S },
      ConditionExpression: 'attribute_not_exists(request_id)',
    }),
  );
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: holder.queue_url,
        MessageBody: JSON.stringify({ v: 1, op: 'account', vault_id: vaultId, user_guid: guid, request_id: requestId, account, enqueued_at: created }),
      }),
    );
  } catch (e) {
    console.error('account push not queued', JSON.stringify({ vault_id: vaultId, instance_id: holder.instance_id, error: (e as Error).name }));
    return { sent: false };
  }
  return { sent: true };
};
