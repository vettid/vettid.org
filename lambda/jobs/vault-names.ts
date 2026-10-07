/**
 * Vaults table stream → name changes from the vault (MEMBER-API 2.2.0 "Name
 * changes from the vault", VAULT-MESSAGING 0.18.0 §10.8, §11.5).
 *
 * Members change their names only in the app: the vault checks the PIN and
 * the credential password and reports the host event `account_name`; the
 * parent records it on the vault row:
 *
 *   name_change = { seq, first_name, last_name, at: <epoch s> },
 *   name_change_pending = true
 *
 * This job (behind an event-source filter on `name_change_pending = true`)
 * claims each request once (conditional REMOVE name_change_pending, same
 * `seq`), then refuses it (`account`, `invalid`, `too_soon`) or applies it to
 * the member row (conditional on `name_changed_at` unchanged, so two racing
 * requests cannot both pass the 30 days), audits, emails the member after
 * an applied change, writes `name_change_result = {seq, status, reason?}` on
 * the vault row and asks vettid-org-member-account-push to send the running
 * vault its new snapshot, whose `name_change.last` settles the request.
 *
 * If anything fails before the result is written, `name_change_pending` is
 * put back and the error rethrown, so the stream retries. A retried run
 * recognizes a change it already applied (the member row's
 * `name_change_applied`), so a retry never turns an applied change into a
 * refusal.
 */
import type { DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { NAME_CHANGE_INTERVAL_MS, NameChangeReason, pushAccountSnapshot } from '../shared/account-snapshot';
import { audit } from '../shared/audit';
import { ddb, table } from '../shared/aws';
import { sendMail } from '../shared/mail';
import { vaultPointerKey } from '../shared/members';
import { normalizeName } from '../shared/names';
import type { MemberItem } from '../shared/model';

const VAULT_ID_RE = /^[0-9a-f]{32}$/;
const GUID_RE = /^[A-Za-z0-9-]{1,64}$/;
/** Member-row update attempts when a concurrent change moves name_changed_at. */
const APPLY_ATTEMPTS = 3;

export type Outcome = 'ignored' | 'claimed_elsewhere' | 'applied' | 'refused' | 'superseded';

interface NameRow {
  vault_id?: unknown;
  user_guid?: unknown;
  state?: unknown;
  name_change?: { seq?: unknown; first_name?: unknown; last_name?: unknown; at?: unknown };
  name_change_pending?: unknown;
}

const isCcf = (e: unknown) => (e as Error).name === 'ConditionalCheckFailedException';

/** The registration rule (lambda/shared/names.ts); re-exported for tests. */
export { normalizeName };

async function claim(vaultId: string, seq: number): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: vaultId },
        UpdateExpression: 'REMOVE name_change_pending',
        ConditionExpression: 'name_change_pending = :t AND name_change.seq = :seq',
        ExpressionAttributeValues: { ':t': true, ':seq': seq },
      }),
    );
    return true;
  } catch (e) {
    if (isCcf(e)) return false; // already claimed, or a newer request replaced it
    throw e;
  }
}

/** Put the claim back after a failure, unless a newer request or a result for this one took over. */
async function unclaim(vaultId: string, seq: number): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: vaultId },
        UpdateExpression: 'SET name_change_pending = :t',
        ConditionExpression: 'attribute_exists(vault_id) AND name_change.seq = :seq AND (attribute_not_exists(name_change_result) OR name_change_result.seq < :seq)',
        ExpressionAttributeValues: { ':t': true, ':seq': seq },
      }),
    );
  } catch (e) {
    if (!isCcf(e)) throw e;
  }
}

/** Record the outcome; false when a result for a later request is already stored. */
async function writeResult(vaultId: string, result: Record<string, unknown>): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: vaultId },
        UpdateExpression: 'SET name_change_result = :r',
        ConditionExpression: 'attribute_exists(vault_id) AND (attribute_not_exists(name_change_result) OR name_change_result.seq <= :seq)',
        ExpressionAttributeValues: { ':r': result, ':seq': result.seq },
      }),
    );
    return true;
  } catch (e) {
    if (isCcf(e)) return false;
    throw e;
  }
}

const getMember = async (guid: string) =>
  (await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: guid }, ConsistentRead: true }))).Item as MemberItem | undefined;

async function isCurrentVault(guid: string, vaultId: string): Promise<boolean> {
  const p = await ddb.send(new GetCommand({ TableName: table.vaults(), Key: { vault_id: vaultPointerKey(guid) }, ConsistentRead: true }));
  return p.Item?.current_vault_id === vaultId;
}

type Decision = { status: 'applied'; first: string; last: string; prev: { first_name: string; last_name: string }; done: boolean } | { status: 'refused'; reason: NameChangeReason };

function decide(m: MemberItem | undefined, current: boolean, vaultId: string, seq: number, first: string | null, last: string | null, now: number): Decision {
  if (!m || !current || m.account_status !== 'active' || (m.state !== 'registered' && m.state !== 'member')) return { status: 'refused', reason: 'account' };
  // A retried run after this very change was applied.
  const done = m.name_change_applied;
  if (done && done.vault_id === vaultId && done.seq === seq) {
    return { status: 'applied', first: m.first_name, last: m.last_name, prev: { first_name: done.first_name, last_name: done.last_name }, done: true };
  }
  if (first === null || last === null || (first === m.first_name && last === m.last_name)) return { status: 'refused', reason: 'invalid' };
  const changed = m.name_changed_at ? Date.parse(m.name_changed_at) : NaN;
  if (Number.isFinite(changed) && now < changed + NAME_CHANGE_INTERVAL_MS) return { status: 'refused', reason: 'too_soon' };
  return { status: 'applied', first, last, prev: { first_name: m.first_name, last_name: m.last_name }, done: false };
}

/** The member-row write; false when name_changed_at moved (a concurrent change won) or the member is gone. */
async function apply(m: MemberItem, vaultId: string, seq: number, first: string, last: string, nowIso: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: m.user_guid },
        UpdateExpression: 'SET first_name = :f, last_name = :l, name_changed_at = :now, name_change_applied = :a, updated_at = :now',
        ConditionExpression: m.name_changed_at ? 'attribute_exists(user_guid) AND name_changed_at = :prev' : 'attribute_exists(user_guid) AND attribute_not_exists(name_changed_at)',
        ExpressionAttributeValues: {
          ':f': first,
          ':l': last,
          ':now': nowIso,
          ':a': { vault_id: vaultId, seq, first_name: m.first_name, last_name: m.last_name },
          ...(m.name_changed_at ? { ':prev': m.name_changed_at } : {}),
        },
      }),
    );
    return true;
  } catch (e) {
    if (isCcf(e)) return false;
    throw e;
  }
}

const changedMail = (from: string, to: string) => `The name on your VettID account was changed from ${from} to ${to} in your VettID app. Your connections now see it.

You can change your name again in 30 days.

If this wasn't you, contact support@vettid.org right away.

— VettID
`;

/** Handle one stream record. Exported for tests. */
export async function processRecord(rec: DynamoDBRecord): Promise<Outcome> {
  if (rec.eventName === 'REMOVE' || !rec.dynamodb?.NewImage) return 'ignored';
  const row = unmarshall(rec.dynamodb.NewImage as Parameters<typeof unmarshall>[0]) as NameRow;
  const nc = row.name_change;
  if (row.name_change_pending !== true || !nc || typeof nc.seq !== 'number' || !Number.isSafeInteger(nc.seq) || nc.seq < 1) return 'ignored';
  if (typeof row.vault_id !== 'string' || !VAULT_ID_RE.test(row.vault_id)) return 'ignored';
  const vaultId = row.vault_id;
  const seq = nc.seq;
  if (!(await claim(vaultId, seq))) return 'claimed_elsewhere';

  const guid = typeof row.user_guid === 'string' && GUID_RE.test(row.user_guid) ? row.user_guid : null;
  let result: { seq: number; status: 'applied' } | { seq: number; status: 'refused'; reason: NameChangeReason };
  try {
    const first = normalizeName(nc.first_name);
    const last = normalizeName(nc.last_name);
    let decision: Decision = { status: 'refused', reason: 'account' };
    if (guid && row.state !== 'deleted') {
      const current = await isCurrentVault(guid, vaultId);
      for (let i = 0; ; i++) {
        const m = await getMember(guid);
        const now = Date.now();
        decision = decide(m, current, vaultId, seq, first, last, now);
        if (decision.status !== 'applied' || decision.done) break;
        if (await apply(m!, vaultId, seq, decision.first, decision.last, new Date(now).toISOString())) break;
        // name_changed_at moved under us: re-read and decide again (now too_soon, or the member is gone).
        if (i + 1 >= APPLY_ATTEMPTS) throw new Error('name change: member row kept changing');
      }
    }
    if (decision.status === 'applied') {
      await audit('system', 'member.name_change', guid!, {
        vault_id: vaultId,
        seq,
        from: decision.prev,
        to: { first_name: decision.first, last_name: decision.last },
      });
      const m = await getMember(guid!);
      if (m?.email) {
        try {
          await sendMail(m.email, 'The name on your VettID account was changed', changedMail(`${decision.prev.first_name} ${decision.prev.last_name}`, `${decision.first} ${decision.last}`));
        } catch (e) {
          const name = (e as Error).name;
          // Never log the address or the error object.
          console.error('name change mail failed', JSON.stringify({ vault_id: vaultId, seq, error: name }));
          if (name !== 'MessageRejected') throw e; // transient: retried with the claim (permanent, e.g. SES sandbox: not)
        }
      }
      result = { seq, status: 'applied' };
    } else {
      await audit('system', 'member.name_change_refused', guid ?? '', { vault_id: vaultId, seq, reason: decision.reason });
      result = { seq, status: 'refused', reason: decision.reason };
    }
    if (!(await writeResult(vaultId, result))) return 'superseded';
  } catch (e) {
    await unclaim(vaultId, seq);
    throw e;
  }
  // Best effort: with no live lease, or on a failure, the next unlock carries the snapshot.
  if (guid) await pushAccountSnapshot(guid);
  return result.status;
}

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const rec of event.Records) await processRecord(rec);
};
