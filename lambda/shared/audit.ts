import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, table } from './aws';
import { nowIso, tsId } from './ids';

/**
 * Append an audit event. Writers hold PutItem only (append-only by IAM).
 * Called after the action succeeds; if the write fails the error propagates
 * so the caller sees a 500 rather than a silently unaudited change
 * (vettid-dev swallowed these).
 */
export async function audit(actor: string, action: string, subject: string, detail: Record<string, unknown> = {}): Promise<void> {
  const ts = nowIso();
  await ddb.send(
    new PutCommand({
      TableName: table.audit(),
      Item: { month: ts.slice(0, 7), ts_id: tsId(ts), ts, actor, action, subject, detail },
      ConditionExpression: 'attribute_not_exists(ts_id)',
    }),
  );
}
