import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, table } from './aws';
import { nowIso, tsId } from './ids';

/**
 * How long a requester's or member's email address stays in the audit log
 * (MEMBER-API 2.6.0 "Retention", owner decision of 2026-10-12). The event
 * itself is kept; only the address goes.
 */
export const AUDIT_ADDRESS_DAYS = 90;

/**
 * Partition of the address records: `addr#<YYYY-MM>`, sort key the event's
 * own `ts_id`. Outside the month partitions, and without `actor` or
 * `subject`, so no listing or index of events ever returns one.
 */
export const addressMonth = (month: string): string => `addr#${month}`;

/**
 * The actor of something a member did themselves: their account id, never
 * their address (the subject index and the member row give the person while
 * the account exists).
 */
export const memberActor = (userGuid: string): string => `member:${userGuid}`;

/**
 * Append an audit event. Writers hold PutItem only (append-only by IAM).
 * Called after the action succeeds; if the write fails the error propagates
 * so the caller sees a 500 rather than a silently unaudited change
 * (vettid-dev swallowed these).
 *
 * A person's address is never stored in the event. A caller that passes
 * `detail.email` (an admin acting on a request or an account, a new
 * request) gets it written to a separate address record under the same
 * `ts_id`, which carries `expires_at` and is deleted by the table's TTL
 * AUDIT_ADDRESS_DAYS after the event. The event stays, naming the person by
 * `subject` (their account id) only.
 */
export async function audit(actor: string, action: string, subject: string, detail: Record<string, unknown> = {}): Promise<void> {
  const ts = nowIso();
  const ts_id = tsId(ts);
  const month = ts.slice(0, 7);
  const { email, ...rest } = detail;
  await ddb.send(
    new PutCommand({
      TableName: table.audit(),
      Item: { month, ts_id, ts, actor, action, subject, detail: rest },
      ConditionExpression: 'attribute_not_exists(ts_id)',
    }),
  );
  if (typeof email === 'string' && email) {
    await ddb.send(
      new PutCommand({
        TableName: table.audit(),
        Item: { month: addressMonth(month), ts_id, email, expires_at: Math.floor(Date.parse(ts) / 1000) + AUDIT_ADDRESS_DAYS * 86_400 },
        ConditionExpression: 'attribute_not_exists(ts_id)',
      }),
    );
  }
}
