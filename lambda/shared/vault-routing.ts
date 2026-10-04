/**
 * Vault instance routing shared by the member API's vault routes and the
 * cleanup job (VAULT-MESSAGING §11.1, §11.10.5; §12.5 deletion on account
 * cancellation): which enclave instance a queue operation goes to.
 */
import { randomBytes } from 'node:crypto';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env, table } from './aws';
import { nowIso } from './ids';

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
  status: 'active' | 'deprecated' | 'retired';
  /** false once the release's image can no longer be started (§11.10.5). */
  available?: boolean;
}

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
 * Ask for an instance of `release` to be started. For now this only records
 * the request on the release row; the infrastructure that acts on it is V5
 * (VAULT-PLAN §4). Only start-request attributes are writable by the API.
 */
export async function requestStart(release: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: table.vaultReleases(),
      Key: { release },
      UpdateExpression: 'SET start_requested_at = :now ADD start_requests :one',
      ConditionExpression: 'attribute_exists(#r)',
      ExpressionAttributeNames: { '#r': 'release' },
      ExpressionAttributeValues: { ':now': nowIso(), ':one': 1 },
    }),
  );
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
