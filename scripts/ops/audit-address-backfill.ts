/**
 * Audit events written before MEMBER-API 2.6.0 hold people's email
 * addresses inside the event, for ever (`detail.email`, and the member's
 * address as `actor` of what a member did). Since 2.6.0 an event names a
 * person by account id only, and an address goes to a separate record that
 * expires 90 days after the event (lambda/shared/audit.ts). This brings the
 * old events to the same shape (RUNBOOK "Membership requests" → "Audit
 * log"):
 *
 *   - `detail.email` is taken out of the event; if the event is younger
 *     than 90 days the address is written to its address record, expiring
 *     90 days after the event; if older, it is gone
 *   - a member's own action (the actions listed below) gets the actor
 *     `member:<their account id>` instead of their address
 *
 *   npx ts-node --transpile-only --prefer-ts-exts scripts/ops/audit-address-backfill.ts [--stage prod|staging] [--profile P]
 *       DRY RUN (the default): counts only, per action. Writes nothing.
 *   ... --apply
 *       makes the changes. Safe to repeat and to interrupt: an event
 *       already converted is not counted again. Each --apply run appends
 *       one audit event of its own, `admin.audit_address_backfill`: the
 *       operator (the session's caller ARN) as actor, the table as
 *       subject, the counts as detail, and `completed: false` if the run
 *       stopped on an error. Rewriting old events in place otherwise
 *       leaves no record that it was done, by whom, or to how many.
 *
 * Not touched: administrators' own addresses (the actor of an admin
 * action, the subject of `admin.*` events, `paused_by`): they are staff
 * identities and the point of the record. Events with an address as actor
 * and an action this script does not know are counted as "unclassified"
 * and left alone: look at them before deciding.
 *
 * Prints counts and action names, never an address. The Lambdas cannot do
 * this (they may only append to the audit table): it needs an operator's
 * session that may update it.
 */
import { execFileSync } from 'node:child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AUDIT_ADDRESS_DAYS, addressMonth, memberActor } from '../../lambda/shared/audit';
import { tsId } from '../../lambda/shared/ids';

const REGION = 'us-east-1';
const STAGES = {
  prod: { account: '449757308783', profile: 'default', prefix: 'vettid-org' },
  staging: { account: '347272280361', profile: 'vault-staging', prefix: 'vettid-org-staging' },
} as const;

/** What a member does themselves (lambda/member/account.ts, vault.ts): the actor was their address. */
export const MEMBER_ACTIONS = new Set([
  'member.accept_terms',
  'member.cancel',
  'member.pin_change',
  'member.pin_disable',
  'member.pin_enable',
  'subscription.cancel',
  'subscription.start',
  'vault.deletion_cancel',
  'vault.deletion_request',
  'vault.enroll_code_issued',
  'vault.enroll_code_redeemed',
  'vault.enroll_code_revoked',
  'vault.enroll_code_typed_blocked',
  'vault.enroll_request',
  'vault.lock_request',
  'vault.recovery_attempt',
  'vault.recovery_cancel',
  'vault.recovery_claim',
  'vault.recovery_code_released',
  'vault.recovery_completed',
  'vault.recovery_open',
  'vault.recovery_register',
  'vault.recovery_registered',
  'vault.recovery_request',
  'vault.recovery_unavailable',
  'vault.unlock_request',
]);

/** An admin (or the seed script) acting: the actor is staff and stays. */
const ADMIN_ACTION_RE = /^(admin|invite|request|terms|subscription_type)\.|^member\.(suspend|reinstate|delete|clear_pin|vault_canary\.(set|clear))$|^subscription\.extend$|^vault\.service\./;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AuditRow {
  month: string;
  ts_id: string;
  ts?: string;
  actor?: string;
  action?: string;
  subject?: string;
  detail?: Record<string, unknown>;
}

export interface Plan {
  /** Take `detail.email` out of the event. */
  removeEmail: boolean;
  /** Write the address record (the event is younger than 90 days): its expiry, epoch seconds. */
  addressExpiresAt?: number;
  /** The actor to set instead of the member's address. */
  actor?: string;
  unclassified: boolean;
}

/** What to do with one event row. Pure: the tests exercise it. */
export function plan(row: AuditRow, nowMs: number): Plan {
  const out: Plan = { removeEmail: false, unclassified: false };
  if (row.month.startsWith('addr#')) return out; // an address record, not an event
  const email = row.detail?.email;
  if (typeof email === 'string') {
    out.removeEmail = true;
    const at = Date.parse(row.ts ?? row.ts_id.slice(0, 24));
    const expires = Math.floor(at / 1000) + AUDIT_ADDRESS_DAYS * 86_400;
    if (Number.isFinite(expires) && expires * 1000 > nowMs) out.addressExpiresAt = expires;
  }
  if (typeof row.actor === 'string' && row.actor.includes('@')) {
    const action = row.action ?? '';
    if (MEMBER_ACTIONS.has(action) && typeof row.subject === 'string' && UUID_RE.test(row.subject)) out.actor = memberActor(row.subject);
    else if (!ADMIN_ACTION_RE.test(action)) out.unclassified = true;
  }
  return out;
}

export interface Counts {
  events: number;
  emailRemoved: number;
  addressKept90: number;
  addressGone: number;
  actorRewritten: number;
  unclassified: number;
}

/** The action of the record an --apply run leaves; `admin.*`, so a later run leaves its actor alone. */
export const BACKFILL_ACTION = 'admin.audit_address_backfill';

/**
 * The one event an --apply run appends: who ran it (the operator's caller
 * ARN: a staff identity, like an admin's address on an admin action), on
 * which table, and how many events it changed. Counts only: no address.
 * Pure: the tests exercise it.
 */
export function backfillEvent(operator: string, stage: string, tableName: string, counts: Counts, completed: boolean, ts: string): AuditRow {
  return {
    month: ts.slice(0, 7),
    ts_id: tsId(ts),
    ts,
    actor: operator,
    action: BACKFILL_ACTION,
    subject: tableName,
    detail: {
      stage,
      completed,
      events_scanned: counts.events,
      email_removed: counts.emailRemoved,
      address_kept_90_days: counts.addressKept90,
      address_gone: counts.addressGone,
      actor_rewritten: counts.actorRewritten,
      unclassified_left: counts.unclassified,
    },
  };
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const stageName = flag('stage') ?? 'prod';
  if (stageName !== 'prod' && stageName !== 'staging') throw new Error('--stage must be prod or staging');
  const stage = STAGES[stageName];
  const profile = flag('profile') ?? stage.profile;
  const apply = process.argv.includes('--apply');

  const account = execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text', '--profile', profile], { encoding: 'utf8' }).trim();
  if (account !== stage.account) throw new Error(`profile ${profile} is account ${account}, not ${stageName}'s (${stage.account}): refusing`);
  // The operator, for the record an --apply run leaves (below).
  const operator = execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Arn', '--output', 'text', '--profile', profile], { encoding: 'utf8' }).trim();
  process.env.AWS_PROFILE = profile;
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  const TableName = `${stage.prefix}-audit`;

  const counts: Counts = { events: 0, emailRemoved: 0, addressKept90: 0, addressGone: 0, actorRewritten: 0, unclassified: 0 };
  const byAction = new Map<string, number>();
  const unclassified = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const now = Date.now();

  // An --apply run is itself recorded, also when it stops half-way (what it
  // changed until then stays changed).
  const record = async (completed: boolean): Promise<void> => {
    if (!apply) return;
    await ddb.send(
      new PutCommand({
        TableName,
        Item: backfillEvent(operator, stageName, TableName, counts, completed, new Date().toISOString()),
        ConditionExpression: 'attribute_not_exists(ts_id)',
      }),
    );
  };

  try {
    await convert();
  } catch (e) {
    await record(false).catch((e2: Error) => console.error(`error: the run's own audit event could not be written: ${e2.name}`));
    throw e;
  }
  await record(true);

  async function convert(): Promise<void> {
    let start: Record<string, unknown> | undefined;
    do {
      const r = await ddb.send(new ScanCommand({ TableName, ExclusiveStartKey: start }));
      for (const item of (r.Items ?? []) as AuditRow[]) {
        if (item.month.startsWith('addr#')) continue;
        counts.events++;
        const p = plan(item, now);
        if (p.unclassified) {
          counts.unclassified++;
          bump(unclassified, item.action ?? '(none)');
        }
        if (!p.removeEmail && !p.actor) continue;
        bump(byAction, item.action ?? '(none)');
        if (p.removeEmail) counts.emailRemoved++;
        if (p.removeEmail) p.addressExpiresAt ? counts.addressKept90++ : counts.addressGone++;
        if (p.actor) counts.actorRewritten++;
        if (!apply) continue;

        // The address record first: if the event's update then fails, the
        // next run finds the event unchanged and the record already there.
        if (p.addressExpiresAt) {
          await ddb
            .send(
              new PutCommand({
                TableName,
                Item: { month: addressMonth(item.month), ts_id: item.ts_id, email: item.detail!.email, expires_at: p.addressExpiresAt },
                ConditionExpression: 'attribute_not_exists(ts_id)',
              }),
            )
            .catch((e: Error) => {
              if (e.name !== 'ConditionalCheckFailedException') throw e;
            });
        }
        const sets: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, unknown> = {};
        if (p.actor) {
          sets.push('#a = :a');
          names['#a'] = 'actor';
          values[':a'] = p.actor;
        }
        if (p.removeEmail) {
          names['#d'] = 'detail';
          names['#e'] = 'email';
        }
        await ddb.send(
          new UpdateCommand({
            TableName,
            Key: { month: item.month, ts_id: item.ts_id },
            UpdateExpression: `${sets.length ? `SET ${sets.join(', ')} ` : ''}${p.removeEmail ? 'REMOVE #d.#e' : ''}`.trim(),
            ConditionExpression: 'attribute_exists(ts_id)',
            ExpressionAttributeNames: names,
            ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
          }),
        );
      }
      start = r.LastEvaluatedKey;
    } while (start);
  }

  console.log(`${stageName} ${TableName}: ${counts.events} events${apply ? '' : ' (dry run: nothing written)'}`);
  console.log(`  detail.email ${apply ? 'removed' : 'to remove'}: ${counts.emailRemoved} (address kept in a 90-day record: ${counts.addressKept90}; older than 90 days, gone: ${counts.addressGone})`);
  console.log(`  member's address as actor ${apply ? 'replaced' : 'to replace'} by member:<id>: ${counts.actorRewritten}`);
  for (const [a, n] of [...byAction].sort()) console.log(`    ${a}: ${n}`);
  if (apply) console.log(`  recorded: audit event ${BACKFILL_ACTION} (actor: this session; the counts above)`);
  if (counts.unclassified) {
    console.log(`  UNCLASSIFIED (an address as actor, an action this script does not know; left alone): ${counts.unclassified}`);
    for (const [a, n] of [...unclassified].sort()) console.log(`    ${a}: ${n}`);
  }
}

if (require.main === module) {
  main().catch((e: Error) => {
    console.error(`error: ${e.name}: ${e.message}`);
    process.exit(1);
  });
}
