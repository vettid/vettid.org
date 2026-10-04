/**
 * Vault instance routing shared by the member API's vault routes and the
 * cleanup job (VAULT-MESSAGING §11.1, §11.10.5; §12.5 deletion on account
 * cancellation): which enclave instance a queue operation goes to.
 */
import { randomBytes } from 'node:crypto';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env, table } from './aws';

/** An instance is live if it heartbeat within this many seconds. */
export const LIVE_HEARTBEAT_S = 90;
/** Becomes part of an SQS queue name (≤ 80 chars incl. the prefix). */
export const INSTANCE_ID_RE = /^[A-Za-z0-9_-]{1,48}$/;

export interface InstanceRow {
  instance_id: string;
  release: string;
  queue_url: string;
  descriptor: string;
  attestation: string;
  heartbeat_at: number;
  load?: number;
}

export interface ReleaseRow {
  release: string;
  release_number: number;
  /**
   * VAULT-MESSAGING 0.10.0 §11.10.1: fixed from release 1 on, written by the
   * manifest sync. Plus `canary`, which is never in a manifest: a row an
   * operator writes for a release under test before its manifest is
   * published (VAULT-RELEASES §10.1 step 9), routed only for canary members.
   */
  status: 'active' | 'deprecated' | 'retired' | 'removed' | 'canary';
  /** false once the release's image can no longer be started (§11.10.5). */
  available?: boolean;
  /**
   * true while operations have reopened a `removed` release for a rescue
   * (§11.10.5, VAULT-RELEASES §10.3 step 3); it is routed as usual meanwhile.
   */
  rescue?: boolean;
  /** RFC 3339 end date from the manifest (0.10.0); for apps and notices, not routing. */
  ends_at?: string;
}

/**
 * Whether the API may route to (and ask to start) a release (§11.10.5): it
 * is known, its image can still start, and it is not `removed` unless
 * reopened for a rescue. A `canary` release is routable only for canary
 * members (VAULT-RELEASES §10.1 step 9, §11.3) and for the host operations
 * of the cleanup job (a vault sealed to it can only be a canary member's).
 * Anything else answers 410 release_unavailable.
 */
export const routable = (rel: ReleaseRow | null, opts: { canary?: boolean } = {}): rel is ReleaseRow => {
  if (!rel || rel.available === false) return false;
  switch (rel.status) {
    case 'active':
    case 'deprecated':
    case 'retired':
      return true;
    case 'removed':
      return rel.rescue === true;
    case 'canary':
      return opts.canary === true;
    default:
      return false;
  }
};

/** A member whose vault may use canary releases: `vault_canary: true` on the member row, set by an operator (RUNBOOK "Vault"). */
export const isCanaryMember = (m: { vault_canary?: unknown } | null | undefined): boolean => m?.vault_canary === true;

/** A release's start request is recorded at most this often. */
export const START_REQUEST_INTERVAL_S = 30;

/** The queue URL an instance must use: the API never sends anywhere else. */
export const expectedQueueUrl = (instanceId: string) => `${env('VAULT_QUEUE_URL_PREFIX')}${instanceId}`;

const isLive = (i: InstanceRow | undefined, now: number): i is InstanceRow =>
  !!i &&
  INSTANCE_ID_RE.test(i.instance_id) &&
  typeof i.heartbeat_at === 'number' &&
  i.heartbeat_at >= now - LIVE_HEARTBEAT_S &&
  i.queue_url === expectedQueueUrl(i.instance_id) &&
  typeof i.descriptor === 'string' &&
  typeof i.attestation === 'string';

export async function liveInstance(instanceId: string, now: number): Promise<InstanceRow | null> {
  if (!INSTANCE_ID_RE.test(instanceId)) return null;
  const r = await ddb.send(new GetCommand({ TableName: table.vaultInstances(), Key: { instance_id: instanceId } }));
  const i = r.Item as InstanceRow | undefined;
  return isLive(i, now) ? i : null;
}

/**
 * The instance holding a live lease on the vault, or null. A lease counts
 * as live only while it is unexpired AND its holder is a live instance: a
 * crashed holder does not strand the vault until its lease runs out. Leases
 * are a routing aid only; the parent's conditional lease write and the
 * split-brain guard (§12.3) keep two instances from running one vault.
 */
export async function liveLease(
  v: { lease?: { instance_id?: unknown; lease_expires_at?: unknown } } | null,
  now: number,
): Promise<InstanceRow | null> {
  const l = v?.lease;
  if (!l || typeof l.instance_id !== 'string' || typeof l.lease_expires_at !== 'number' || l.lease_expires_at <= now) return null;
  return liveInstance(l.instance_id, now);
}

export async function releaseRow(release: string): Promise<ReleaseRow | null> {
  const r = await ddb.send(new GetCommand({ TableName: table.vaultReleases(), Key: { release } }));
  return (r.Item as ReleaseRow | undefined) ?? null;
}

/** A live instance of `release`, least loaded first, then freshest heartbeat. */
export async function pickInstance(release: string, now: number): Promise<InstanceRow | null> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: table.vaultInstances(),
      IndexName: 'release-index',
      KeyConditionExpression: '#r = :r AND heartbeat_at >= :cut',
      ExpressionAttributeNames: { '#r': 'release' },
      ExpressionAttributeValues: { ':r': release, ':cut': now - LIVE_HEARTBEAT_S },
    }),
  );
  const candidates = ((r.Items ?? []) as Pick<InstanceRow, 'instance_id' | 'heartbeat_at' | 'load'>[]).sort(
    (a, b) => (a.load ?? 0) - (b.load ?? 0) || b.heartbeat_at - a.heartbeat_at,
  );
  for (const c of candidates.slice(0, 5)) {
    const i = await liveInstance(c.instance_id, now);
    if (i && i.release === release) return i;
  }
  return null;
}

/**
 * Ask for an instance of `release` to be started: records the request on
 * the release row, which the scaler acts on (VAULT-RELEASES §8.6). Only
 * start-request attributes are writable by the API. Callers check
 * `routable` first. The write never creates a row (no start requests for
 * releases that don't exist), and is recorded at most once per
 * START_REQUEST_INTERVAL_S per release, so a burst of members, app retries
 * or cleanup runs costs one write and one stream record, not one each.
 * Returns whether this call recorded it (false: a request was recorded
 * recently, or the row is gone; callers answer release_starting either way).
 */
export async function requestStart(release: string): Promise<boolean> {
  const now = Date.now();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaultReleases(),
        Key: { release },
        UpdateExpression: 'SET start_requested_at = :now ADD start_requests :one',
        // ISO-8601 UTC strings of one format compare in time order.
        ConditionExpression: 'attribute_exists(#r) AND (attribute_not_exists(start_requested_at) OR start_requested_at < :cut)',
        ExpressionAttributeNames: { '#r': 'release' },
        ExpressionAttributeValues: {
          ':now': new Date(now).toISOString(),
          ':cut': new Date(now - START_REQUEST_INTERVAL_S * 1000).toISOString(),
          ':one': 1,
        },
      }),
    );
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

/** A ULID for requests the API makes on its own (cancel, delete). */
export function newUlid(): string {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = A[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let r = '';
  for (let i = 0; i < 16; i++) r += A[rnd[i] % 32];
  return time + r;
}
