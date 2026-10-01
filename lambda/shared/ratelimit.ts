import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env } from './aws';

const tableName = () => env('TABLE_RATELIMITS');

/**
 * Fixed-window counter in vettid-org-ratelimits. Returns whether this hit is
 * within `limit` for the current window, and seconds until the window ends.
 * Items expire via TTL shortly after their window.
 */
export async function hit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number; count: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const r = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { key: `${key}#${windowStart}` },
      UpdateExpression: 'ADD #c :one SET expires_at = if_not_exists(expires_at, :exp)',
      ExpressionAttributeNames: { '#c': 'count' },
      ExpressionAttributeValues: { ':one': 1, ':exp': windowStart + windowSeconds + 60 },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  const count = Number(r.Attributes?.count ?? 1);
  return { allowed: count <= limit, retryAfter: windowStart + windowSeconds - now, count };
}

/**
 * Failure counter with a lockout (e.g. PIN attempts): `failures(key)` reads,
 * `fail(key)` increments (TTL = lockout period from the latest failure),
 * `clear(key)` resets on success.
 */
export const lockout = {
  async failures(key: string): Promise<number> {
    const r = await ddb.send(new GetCommand({ TableName: tableName(), Key: { key }, ConsistentRead: true }));
    const exp = Number(r.Item?.expires_at ?? 0);
    return exp > Date.now() / 1000 ? Number(r.Item?.count ?? 0) : 0;
  },
  async fail(key: string, lockSeconds: number): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const r = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { key },
        // Restart the count if the previous lock period has lapsed.
        UpdateExpression: 'SET #c = if_not_exists(#c, :zero) + :one, expires_at = :exp',
        ConditionExpression: 'attribute_not_exists(expires_at) OR expires_at > :now',
        ExpressionAttributeNames: { '#c': 'count' },
        ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':exp': now + lockSeconds, ':now': now },
        ReturnValues: 'UPDATED_NEW',
      }),
    ).catch(async (e) => {
      if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
      return ddb.send(
        new UpdateCommand({
          TableName: tableName(),
          Key: { key },
          UpdateExpression: 'SET #c = :one, expires_at = :exp',
          ExpressionAttributeNames: { '#c': 'count' },
          ExpressionAttributeValues: { ':one': 1, ':exp': now + lockSeconds },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
    });
    return Number(r.Attributes?.count ?? 1);
  },
  /**
   * Atomically reserve one attempt BEFORE checking it, so concurrent guesses
   * can't all read "under the limit" first. Returns the attempt number
   * (1..max) or null when the key is locked. The window starts at the first
   * attempt and lasts `windowSeconds`.
   */
  async reserve(key: string, max: number, windowSeconds: number): Promise<number | null> {
    for (let i = 0; i < 3; i++) {
      const now = Math.floor(Date.now() / 1000);
      try {
        const r = await ddb.send(
          new UpdateCommand({
            TableName: tableName(),
            Key: { key },
            UpdateExpression: 'ADD #c :one',
            ConditionExpression: 'expires_at > :now AND #c < :max',
            ExpressionAttributeNames: { '#c': 'count' },
            ExpressionAttributeValues: { ':one': 1, ':now': now, ':max': max },
            ReturnValues: 'UPDATED_NEW',
          }),
        );
        return Number(r.Attributes?.count);
      } catch (e) {
        if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
      }
      try {
        // No live window: start one with this attempt.
        await ddb.send(
          new PutCommand({
            TableName: tableName(),
            Item: { key, count: 1, expires_at: now + windowSeconds },
            ConditionExpression: 'attribute_not_exists(#k) OR expires_at <= :now',
            ExpressionAttributeNames: { '#k': 'key' },
            ExpressionAttributeValues: { ':now': now },
          }),
        );
        return 1;
      } catch (e) {
        if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
      }
      // Live window at or over the limit → locked (unless it just expired; retry).
      const cur = await ddb.send(new GetCommand({ TableName: tableName(), Key: { key }, ConsistentRead: true }));
      if (cur.Item && Number(cur.Item.expires_at) > now && Number(cur.Item.count) >= max) return null;
    }
    return null;
  },
  /** Force a key into the locked state until `until` (epoch seconds). */
  async lockUntil(key: string, max: number, until: number): Promise<void> {
    await ddb.send(new PutCommand({ TableName: tableName(), Item: { key, count: max, expires_at: until } }));
  },
  async clear(key: string): Promise<void> {
    await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { key } }));
  },
};
