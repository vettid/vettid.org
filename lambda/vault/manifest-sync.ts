/**
 * vault-manifest-sync (VAULT-RELEASES §7 "Registry sync"): every 5 minutes
 * (and on demand after a publish: `aws lambda invoke`), fetch the served
 * manifest, verify it under the pinned manifest keys, and upsert the
 * `vault-releases` routing rows: number, status, seal key, `ends_at`, and
 * `available` (true while the release's instance group exists, i.e. its
 * release stack published `vault/releases/<n>/group-name`).
 *
 * - Never touches the member API's start-request attributes, the scaler's
 *   markers or an operator's `rescue`.
 * - Refuses a manifest whose serial is lower than one already synced, or
 *   the same serial with different bytes (metric ManifestRejected).
 * - Deletes rows of releases the manifest no longer lists (an unlisted
 *   release is unknown: the API answers 410), only if an older manifest
 *   wrote them.
 * - Checks that the bucket holds `manifests/<sha256>.json` (the publish
 *   step's copy, which hosts hand to enclaves, M1); metric
 *   ManifestMissingInBucket if not.
 *
 * No pinned key configured (before W7/W10): logs and does nothing.
 */
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env, s3 } from '../shared/aws';
import { Manifest, ManifestError, MAX_SERVED, verifyServed } from '../shared/manifest';

const ssm = new SSMClient({});

export interface SyncedRow {
  release: string;
  release_number?: number;
  manifest_serial?: number;
  manifest_sha256?: string;
}

export interface SyncPlan {
  reject?: string;
  upserts: { pcr0: string; number: number; status: string; seal_key: string; ends_at?: string; available: boolean }[];
  deletes: string[];
}

/** Pure: what the table should become for this manifest. */
export function syncPlan(m: Manifest, rows: SyncedRow[], groupReleases: Set<number>): SyncPlan {
  const synced = rows.filter((r) => typeof r.manifest_serial === 'number');
  const top = synced.reduce((n, r) => Math.max(n, r.manifest_serial!), 0);
  if (m.serial < top) return { reject: `serial ${m.serial} is lower than the synced ${top}`, upserts: [], deletes: [] };
  if (m.serial === top && synced.some((r) => r.manifest_serial === top && r.manifest_sha256 && r.manifest_sha256 !== m.sha256)) {
    return { reject: `serial ${m.serial} was synced with different bytes`, upserts: [], deletes: [] };
  }
  const listed = new Set(m.releases.map((r) => r.pcr0));
  return {
    upserts: m.releases.map((r) => ({
      pcr0: r.pcr0,
      number: r.release,
      status: r.status,
      seal_key: r.seal_key,
      ...(r.ends_at ? { ends_at: r.ends_at } : {}),
      available: groupReleases.has(r.release),
    })),
    deletes: synced.filter((r) => !listed.has(r.release)).map((r) => r.release),
  };
}

function metrics(values: Record<string, number>): void {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [{ Namespace: 'VettID/Vault', Dimensions: [['Component']], Metrics: Object.keys(values).map((Name) => ({ Name, Unit: 'Count' })) }],
      },
      Component: 'manifest-sync',
      ...values,
    }),
  );
}

async function fetchServed(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!r.ok) throw new Error(`manifest fetch: HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > MAX_SERVED) throw new ManifestError('served', 'served document too large');
  return b;
}

async function groupReleases(): Promise<Set<number>> {
  const path = env('SSM_RELEASES_PATH'); // /vettid-org/<stage>/vault/releases/
  const out = new Set<number>();
  let token: string | undefined;
  do {
    const r = await ssm.send(new GetParametersByPathCommand({ Path: path, Recursive: true, NextToken: token }));
    for (const p of r.Parameters ?? []) {
      const m = p.Name?.slice(path.length).match(/^(\d{1,4})\/group-name$/);
      if (m && p.Value) out.add(Number(m[1]));
    }
    token = r.NextToken;
  } while (token);
  return out;
}

async function scanRows(): Promise<SyncedRow[]> {
  const out: SyncedRow[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: env('TABLE_VAULT_RELEASES'),
        ProjectionExpression: '#r, release_number, manifest_serial, manifest_sha256',
        ExpressionAttributeNames: { '#r': 'release' },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...((r.Items ?? []) as SyncedRow[]));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

async function inBucket(sha: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: env('DATA_BUCKET'), Key: `manifests/${sha}.json` }));
    return true;
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'NotFound' || name === 'NoSuchKey') return false;
    throw e;
  }
}

export async function handler(): Promise<{ status: string; serial?: number }> {
  const keys = JSON.parse(env('PINNED_KEYS')) as string[];
  if (!Array.isArray(keys) || keys.length === 0) {
    console.log(JSON.stringify({ msg: 'manifest sync skipped: no pinned manifest key configured' }));
    return { status: 'skipped' };
  }
  let m: Manifest;
  try {
    m = verifyServed(await fetchServed(env('MANIFEST_URL')), keys);
  } catch (e) {
    if (e instanceof ManifestError) {
      console.log(JSON.stringify({ msg: 'manifest rejected', code: e.code, reason: e.message }));
      metrics({ ManifestRejected: 1 });
      return { status: 'rejected' };
    }
    throw e;
  }
  const [rows, groups] = await Promise.all([scanRows(), groupReleases()]);
  const p = syncPlan(m, rows, groups);
  if (p.reject) {
    console.log(JSON.stringify({ msg: 'manifest rejected', code: 'serial', reason: p.reject }));
    metrics({ ManifestRejected: 1 });
    return { status: 'rejected', serial: m.serial };
  }
  const now = new Date().toISOString();
  for (const u of p.upserts) {
    const names: Record<string, string> = { '#s': 'status' };
    const values: Record<string, unknown> = {
      ':n': u.number, ':s': u.status, ':k': u.seal_key, ':a': u.available, ':serial': m.serial, ':sha': m.sha256, ':now': now,
    };
    let expr = 'SET release_number = :n, #s = :s, seal_key = :k, available = :a, manifest_serial = :serial, manifest_sha256 = :sha, synced_at = :now';
    if (u.ends_at) {
      expr += ', ends_at = :e';
      values[':e'] = u.ends_at;
    } else {
      expr += ' REMOVE ends_at';
    }
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env('TABLE_VAULT_RELEASES'),
          Key: { release: u.pcr0 },
          UpdateExpression: expr,
          // A concurrent, newer sync wins.
          ConditionExpression: 'attribute_not_exists(manifest_serial) OR manifest_serial <= :serial',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
    }
  }
  for (const pcr0 of p.deletes) {
    try {
      await ddb.send(
        new DeleteCommand({
          TableName: env('TABLE_VAULT_RELEASES'),
          Key: { release: pcr0 },
          ConditionExpression: 'manifest_serial < :serial',
          ExpressionAttributeValues: { ':serial': m.serial },
        }),
      );
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
    }
  }
  const present = await inBucket(m.sha256);
  if (!present) console.log(JSON.stringify({ msg: 'manifest not in the data bucket', key: `manifests/${m.sha256}.json` }));
  metrics({ ManifestSynced: 1, ManifestRejected: 0, ManifestMissingInBucket: present ? 0 : 1, ManifestSerial: m.serial, ManifestReleases: m.releases.length });
  console.log(JSON.stringify({ msg: 'manifest synced', serial: m.serial, sha256: m.sha256, upserts: p.upserts.length, deletes: p.deletes.length }));
  return { status: 'synced', serial: m.serial };
}
