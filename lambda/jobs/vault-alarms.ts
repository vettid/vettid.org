/**
 * Vaults table stream → credential-clone alarm email (VAULT-MESSAGING 0.9.0
 * §3.5.9, §11.5; docs/MEMBER-API.md "Vault alarms").
 *
 * A vault has no email egress. When it sees its Protean Credential presented
 * by another device, or a stale copy, it freezes credential use, alerts the
 * member's app and reports a content-free lifecycle event
 * (`alarm.credential_clone`) to its host. The parent records it on the vault
 * row:
 *
 *   alarm = { kind: 'credential_clone', alarm_id: <ULID>, at: <epoch s> },
 *   alarm_pending = true
 *
 * This function (behind an event-source filter on `alarm_pending = true`)
 * claims each alarm once (conditional REMOVE alarm_pending), looks the
 * member up and emails them. On a transient send failure it puts
 * `alarm_pending` back and rethrows, so the stream (or the next write to the
 * row) retries. At most MAX_MAILS_PER_DAY alarm emails go out per vault per
 * day; further alarms are audited, not mailed.
 *
 * The alarm carries no secrets and neither does the email. Nothing here is
 * a security decision: the vault has already frozen and alerted the app.
 *
 * The same path carries the deletion notice (VAULT-MESSAGING 0.9.0 §12.5):
 * on the lifecycle event `deleted` the parent records
 * `alarm = {kind: 'vault_deleted', ...}`. The vault's own audit log is gone,
 * so the member is emailed (no rate limit: one notice per deletion), then
 * the vault row (still `deleted`) and the member's pointer row (if it still
 * names this vault) are removed, so the next enrollment is a fresh one.
 *
 * Release A (VAULT-HOST-PROTOCOL 0.1.11, P15; MEMBER-API 2.7.1): the
 * parent's update that marks the row `deleted` also sets
 * `att_sweep_pending`, and removes it once it has deleted every object under
 * `vaults/<vault_id>/att/`. A restarted parent resumes the sweeps that rows
 * still record, so the vault row is kept while `att_sweep_pending` is set:
 * the notice is handled as before (mail, audit, pointer row), the alarm is
 * stamped `alarm.handled_at`, and the row goes when a later stream record
 * shows it `deleted`, handled and no longer pending (a second filter on the
 * event source; the parent's removal of `att_sweep_pending` is that record).
 * The stamp is what tells the follow-up that the notice was handled, so a
 * row is never removed while its notice could still need a retry.
 *
 * The record kept (MEMBER-API 2.11.0, "Vault deletion"): before the row
 * goes, `vdeleted#<vault_id>` is put in the vault-requests table with the
 * vault's app public keys, `deleted_at`, the cause and `expires_at` (90
 * days, lambda/shared/vault-tombstone.ts), so that the vault's own app is
 * still told `410 vault_deleted` after the row is gone. A row whose record
 * could not be written is kept (still `deleted`, which answers the same)
 * and stamped handled, so the follow-up tries again.
 */
import type { DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { ddb, env, table } from '../shared/aws';
import { sendMail } from '../shared/mail';
import { vaultPointerKey } from '../shared/members';
import { hit } from '../shared/ratelimit';
import type { MemberItem } from '../shared/model';
import { VAULT_TOMBSTONE_TTL_S, type VaultTombstone, tombstoneCause, tombstoneKey, vaultAppKeys } from '../shared/vault-tombstone';

export const MAX_MAILS_PER_DAY = 4;

const VAULT_ID_RE = /^[0-9a-f]{32}$/;
const ALARM_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Kinds that are never rate-limited (one notice per event). */
const UNLIMITED = new Set(['vault_deleted']);

/** Alarm kinds the host may record, with their email. */
const MAILS: Record<string, { subject: string; text: (at: string) => string }> = {
  vault_deleted: {
    subject: 'Your VettID vault was deleted',
    text: (at) => `At ${at} your VettID vault was deleted, together with everything stored in it: your items, your Protean Credential and its critical items, your connections and your devices' access.

A deleted vault cannot be restored.

If you did not delete it, secure your VettID account now (sign in and review it) and contact VettID support:
https://${env('ACCOUNT_HOST')}/

VettID never asks for your PIN or password by email.

— VettID
`,
  },
  credential_clone: {
    subject: 'Security alert: your VettID credential was presented by another device',
    text: (at) => `At ${at} your VettID vault saw your Protean Credential presented by a device other than your app, or an old copy of it.

Your vault refused it. Use of your credential is frozen until your VettID app confirms the alert; your app then rotates the credential, which makes every other copy useless. Messages and connections keep working.

Open your VettID app now and answer the alert.

If it was not you: after the rotation, change your vault PIN and your credential password. If you no longer have your phone, start a recovery from your account page:
https://${env('ACCOUNT_HOST')}/

VettID never asks for your PIN or password by email.

— VettID
`,
  },
};

interface AlarmRow {
  vault_id: string;
  user_guid?: string;
  state?: unknown;
  alarm?: { kind?: unknown; alarm_id?: unknown; at?: unknown; handled_at?: unknown };
  alarm_pending?: unknown;
  att_sweep_pending?: unknown;
  /** 2.11.0: what the record kept after the row is removed is made of. */
  app_key?: { key: string; kid: string; seq?: number };
  app_key_next?: { key: string; kid: string; seq?: number };
  account_deleted_at?: unknown;
  deletion_requested_at?: unknown;
  deletion?: { state?: unknown } | null;
}

const isCcf = (e: unknown) => (e as Error).name === 'ConditionalCheckFailedException';

/** Claim the alarm: only one invocation gets past this for a given alarm_id. */
async function claim(vaultId: string, alarmId: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: vaultId },
        UpdateExpression: 'REMOVE alarm_pending',
        ConditionExpression: 'alarm_pending = :t AND alarm.alarm_id = :id',
        ExpressionAttributeValues: { ':t': true, ':id': alarmId },
      }),
    );
    return true;
  } catch (e) {
    if (isCcf(e)) return false; // already claimed, or a newer alarm replaced it
    throw e;
  }
}

/** Put the claim back after a transient failure, unless a newer alarm took over. */
async function unclaim(vaultId: string, alarmId: string): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: vaultId },
        UpdateExpression: 'SET alarm_pending = :t',
        ConditionExpression: 'attribute_exists(vault_id) AND alarm.alarm_id = :id',
        ExpressionAttributeValues: { ':t': true, ':id': alarmId },
      }),
    );
  } catch (e) {
    if (!isCcf(e)) throw e;
  }
}

async function markEmailed(vaultId: string, alarmId: string, now: number): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: vaultId },
        UpdateExpression: 'SET alarm.emailed_at = :now',
        ConditionExpression: 'alarm.alarm_id = :id',
        ExpressionAttributeValues: { ':now': now, ':id': alarmId },
      }),
    );
  } catch (e) {
    if (!isCcf(e)) throw e;
  }
}

/**
 * 2.11.0: the record of the deleted vault, put before its row is removed
 * (an earlier record of the same vault is replaced, which only moves its
 * expiry). Public keys, times and the cause only.
 */
async function putTombstone(row: AlarmRow, nowS: number): Promise<void> {
  const a = row.alarm;
  const item: VaultTombstone = {
    request_id: tombstoneKey(row.vault_id),
    vault_id: row.vault_id,
    ...(typeof row.user_guid === 'string' ? { user_guid: row.user_guid } : {}),
    keys: vaultAppKeys(row).map((k) => ({ key: k.key, kid: k.kid })),
    deleted_at: a && a.kind === 'vault_deleted' && typeof a.at === 'number' && Number.isFinite(a.at) ? a.at : null,
    cause: tombstoneCause(row),
    expires_at: nowS + VAULT_TOMBSTONE_TTL_S,
  };
  await ddb.send(new PutCommand({ TableName: table.vaultRequests(), Item: item }));
}

/**
 * Remove a deleted vault's row, unless the parent's attachment sweep is
 * still pending on it (P15). Returns whether the row went; false also when
 * it is gone already or no longer `deleted`, and (2.11.0) when its record
 * could not be written first (the row is kept).
 */
async function removeVaultRow(row: AlarmRow): Promise<boolean> {
  const vaultId = row.vault_id;
  // The image's own view: a row still sweeping fails the delete below anyway.
  if (row.state !== 'deleted' || row.att_sweep_pending !== undefined) return false;
  try {
    await putTombstone(row, Math.floor(Date.now() / 1000));
  } catch (e) {
    console.error('vault tombstone not written', JSON.stringify({ vault_id: vaultId, error: (e as Error).name }));
    return false;
  }
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: table.vaults(),
        Key: { vault_id: vaultId },
        ConditionExpression: '#s = :deleted AND attribute_not_exists(att_sweep_pending)',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':deleted': 'deleted' },
      }),
    );
    return true;
  } catch (e) {
    if (!isCcf(e)) throw e;
    return false;
  }
}

/** The notice was handled: the follow-up record may remove the row (only the alarm map is written). */
async function markHandled(vaultId: string, alarmId: string, now: number): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: vaultId },
        UpdateExpression: 'SET alarm.handled_at = :now',
        ConditionExpression: 'alarm.alarm_id = :id',
        ExpressionAttributeValues: { ':now': now, ':id': alarmId },
      }),
    );
  } catch (e) {
    if (!isCcf(e)) throw e; // the row is gone, or a newer alarm replaced this one
  }
}

/**
 * After the deletion notice (§12.5): the vault row goes (or, while the
 * attachment sweep is pending, is stamped handled and kept for the
 * follow-up), and the member's pointer row goes if it still names it.
 */
async function removeRows(row: AlarmRow, alarmId: string): Promise<void> {
  const vaultId = row.vault_id;
  const guid = row.user_guid;
  if (!(await removeVaultRow(row))) await markHandled(vaultId, alarmId, Math.floor(Date.now() / 1000));
  if (!guid) return;
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: table.vaults(),
        Key: { vault_id: vaultPointerKey(guid) },
        ConditionExpression: 'current_vault_id = :id',
        ExpressionAttributeValues: { ':id': vaultId },
      }),
    );
  } catch (e) {
    if (!isCcf(e)) throw e; // the pointer names another vault, or is gone
  }
}

/** A deleted vault's row whose notice was handled and whose sweep is done: the follow-up removes it. */
const sweptAndHandled = (row: AlarmRow) =>
  row.alarm_pending === undefined &&
  row.att_sweep_pending === undefined &&
  row.state === 'deleted' &&
  row.alarm?.kind === 'vault_deleted' &&
  typeof row.alarm.handled_at === 'number';

/** Handle one stream record. Exported for tests. */
export async function processRecord(rec: DynamoDBRecord): Promise<'ignored' | 'claimed_elsewhere' | 'mailed' | 'not_mailed' | 'removed'> {
  if (rec.eventName === 'REMOVE' || !rec.dynamodb?.NewImage) return 'ignored';
  const row = unmarshall(rec.dynamodb.NewImage as Parameters<typeof unmarshall>[0]) as AlarmRow;
  if (sweptAndHandled(row)) {
    if (typeof row.vault_id !== 'string' || !VAULT_ID_RE.test(row.vault_id)) return 'ignored';
    return (await removeVaultRow(row)) ? 'removed' : 'ignored';
  }
  const a = row.alarm;
  if (row.alarm_pending !== true || !a || typeof a.alarm_id !== 'string' || !ALARM_ID_RE.test(a.alarm_id)) return 'ignored';
  if (typeof row.vault_id !== 'string' || !VAULT_ID_RE.test(row.vault_id)) return 'ignored';
  const vaultId = row.vault_id;
  const alarmId = a.alarm_id;
  const kind = typeof a.kind === 'string' ? a.kind : '';
  if (!(await claim(vaultId, alarmId))) return 'claimed_elsewhere';

  const subject = row.user_guid ?? '';
  const detail = { vault_id: vaultId, kind, alarm_id: alarmId };
  const deletion = kind === 'vault_deleted';
  const notMailed = async (reason: string) => {
    await audit('system', 'vault.alarm_email', subject, { ...detail, mailed: false, reason });
    if (deletion) await removeRows(row, alarmId);
    return 'not_mailed' as const;
  };

  const mail = MAILS[kind];
  if (!mail) return notMailed('unknown_kind');
  if (!row.user_guid) return notMailed('no_member');
  if (!UNLIMITED.has(kind) && !(await hit(`vault-alarm-mail#${vaultId}`, MAX_MAILS_PER_DAY, 86_400)).allowed) return notMailed('rate_limited');
  const m = (await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: row.user_guid } }))).Item as MemberItem | undefined;
  if (!m?.email) return notMailed('no_member');

  const at = typeof a.at === 'number' && Number.isFinite(a.at) ? new Date(a.at * 1000).toISOString() : 'an unknown time';
  try {
    await sendMail(m.email, mail.subject, mail.text(at));
  } catch (e) {
    const name = (e as Error).name;
    // Never log the address or the error object.
    console.error('vault alarm mail failed', JSON.stringify({ vault_id: vaultId, alarm_id: alarmId, error: name }));
    if (name === 'MessageRejected') return notMailed('rejected'); // permanent (e.g. SES sandbox)
    await unclaim(vaultId, alarmId);
    throw e;
  }
  await audit('system', 'vault.alarm_email', subject, { ...detail, mailed: true });
  if (deletion) await removeRows(row, alarmId);
  else await markEmailed(vaultId, alarmId, Math.floor(Date.now() / 1000));
  return 'mailed';
}

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const rec of event.Records) await processRecord(rec);
};
