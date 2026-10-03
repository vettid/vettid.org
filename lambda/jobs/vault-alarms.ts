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
 */
import type { DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { ddb, env, table } from '../shared/aws';
import { sendMail } from '../shared/mail';
import { hit } from '../shared/ratelimit';
import type { MemberItem } from '../shared/model';

export const MAX_MAILS_PER_DAY = 4;

const VAULT_ID_RE = /^[0-9a-f]{32}$/;
const ALARM_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Alarm kinds the host may record, with their email. */
const MAILS: Record<string, { subject: string; text: (at: string) => string }> = {
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
  alarm?: { kind?: unknown; alarm_id?: unknown; at?: unknown };
  alarm_pending?: unknown;
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

/** Handle one stream record. Exported for tests. */
export async function processRecord(rec: DynamoDBRecord): Promise<'ignored' | 'claimed_elsewhere' | 'mailed' | 'not_mailed'> {
  if (rec.eventName === 'REMOVE' || !rec.dynamodb?.NewImage) return 'ignored';
  const row = unmarshall(rec.dynamodb.NewImage as Parameters<typeof unmarshall>[0]) as AlarmRow;
  const a = row.alarm;
  if (row.alarm_pending !== true || !a || typeof a.alarm_id !== 'string' || !ALARM_ID_RE.test(a.alarm_id)) return 'ignored';
  if (typeof row.vault_id !== 'string' || !VAULT_ID_RE.test(row.vault_id)) return 'ignored';
  const vaultId = row.vault_id;
  const alarmId = a.alarm_id;
  const kind = typeof a.kind === 'string' ? a.kind : '';
  if (!(await claim(vaultId, alarmId))) return 'claimed_elsewhere';

  const subject = row.user_guid ?? '';
  const detail = { vault_id: vaultId, kind, alarm_id: alarmId };
  const notMailed = async (reason: string) => {
    await audit('system', 'vault.alarm_email', subject, { ...detail, mailed: false, reason });
    return 'not_mailed' as const;
  };

  const mail = MAILS[kind];
  if (!mail) return notMailed('unknown_kind');
  if (!row.user_guid) return notMailed('no_member');
  if (!(await hit(`vault-alarm-mail#${vaultId}`, MAX_MAILS_PER_DAY, 86_400)).allowed) return notMailed('rate_limited');
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
  await markEmailed(vaultId, alarmId, Math.floor(Date.now() / 1000));
  await audit('system', 'vault.alarm_email', subject, { ...detail, mailed: true });
  return 'mailed';
}

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const rec of event.Records) await processRecord(rec);
};
