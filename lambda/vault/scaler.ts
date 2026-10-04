/**
 * vault-scaler (VAULT-RELEASES §8.6): starts and stops the per-release
 * instance groups. Triggered by the `vault-releases` stream (filtered to
 * rows carrying a start request; the member API records one at most every
 * 30 s per release) and by a 1-minute schedule. Every invocation runs one
 * full, idempotent reconcile pass (lambda/vault/scaler-logic.ts); reserved
 * concurrency 1 keeps two passes from racing.
 *
 * Reads: the release rows, the groups tagged `vettid:vault-scaler`, live
 * registry rows per release. Writes: SetDesiredCapacity on those groups
 * only, and the scaler's own markers (`start_issued_at`, `busy_at`) on
 * release rows. Metrics go out as CloudWatch embedded metric format
 * (namespace VettID/Vault).
 */
import { AutoScalingClient, DescribeAutoScalingGroupsCommand, SetDesiredCapacityCommand, type AutoScalingGroup } from '@aws-sdk/client-auto-scaling';
import { QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env } from '../shared/aws';
import { Group, LIVE_HEARTBEAT_S, LiveInstance, PCR0_RE, Plan, ReleaseRow, plan } from './scaler-logic';

const asg = new AutoScalingClient({});

const TAG_MANAGED = 'vettid:vault-scaler';
const TAG_RELEASE = 'vettid:vault-release';
const TAG_PCR0 = 'vettid:vault-pcr0';

export async function loadReleases(): Promise<ReleaseRow[]> {
  const out: ReleaseRow[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: env('TABLE_VAULT_RELEASES'),
        ProjectionExpression: '#r, release_number, #s, available, rescue, start_requested_at, start_issued_at, busy_at',
        ExpressionAttributeNames: { '#r': 'release', '#s': 'status' },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...((r.Items ?? []) as ReleaseRow[]));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

export function toGroup(g: AutoScalingGroup): Group | null {
  const tag = (k: string) => g.Tags?.find((t) => t.Key === k)?.Value;
  if (tag(TAG_MANAGED) !== 'managed' || !g.AutoScalingGroupName) return null;
  const n = Number(tag(TAG_RELEASE));
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return { name: g.AutoScalingGroupName, pcr0: tag(TAG_PCR0) ?? '', releaseNumber: n, min: g.MinSize ?? 0, max: g.MaxSize ?? 0, desired: g.DesiredCapacity ?? 0 };
}

export async function loadGroups(): Promise<Group[]> {
  const out: Group[] = [];
  let token: string | undefined;
  do {
    const r = await asg.send(
      new DescribeAutoScalingGroupsCommand({ Filters: [{ Name: `tag:${TAG_MANAGED}`, Values: ['managed'] }], NextToken: token }),
    );
    for (const g of r.AutoScalingGroups ?? []) {
      const x = toGroup(g);
      if (x) out.push(x);
    }
    token = r.NextToken;
  } while (token);
  return out;
}

export async function loadLive(pcr0: string, nowS: number): Promise<LiveInstance[]> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: env('TABLE_VAULT_INSTANCES'),
      IndexName: 'release-index',
      KeyConditionExpression: '#r = :r AND heartbeat_at >= :cut',
      ExpressionAttributeNames: { '#r': 'release' },
      ExpressionAttributeValues: { ':r': pcr0, ':cut': nowS - LIVE_HEARTBEAT_S },
    }),
  );
  return (r.Items ?? []) as LiveInstance[];
}

async function mark(release: string, attr: 'start_issued_at' | 'busy_at', at: string): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env('TABLE_VAULT_RELEASES'),
        Key: { release },
        UpdateExpression: 'SET #a = :at',
        ConditionExpression: 'attribute_exists(#r)',
        ExpressionAttributeNames: { '#a': attr, '#r': 'release' },
        ExpressionAttributeValues: { ':at': at },
      }),
    );
  } catch (e) {
    if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
  }
}

/** CloudWatch embedded metric format: one log line, no PutMetricData call. */
export function emf(metrics: Plan['metrics'], now: number): string {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [{ Namespace: 'VettID/Vault', Dimensions: [['Component']], Metrics: Object.keys(metrics).map((Name) => ({ Name, Unit: 'Count' })) }],
    },
    Component: 'scaler',
    ...metrics,
  });
}

export async function reconcile(now = Date.now()): Promise<Plan> {
  const limits = {
    perRelease: Number(env('CAP_PER_RELEASE')),
    total: Number(env('CAP_TOTAL')),
    idleMinutes: Number(env('IDLE_MINUTES')),
  };
  const [releases, groups] = await Promise.all([loadReleases(), loadGroups()]);
  const live: Record<string, LiveInstance[]> = {};
  for (const r of releases) {
    if (PCR0_RE.test(r.release)) live[r.release] = await loadLive(r.release, Math.floor(now / 1000));
  }
  const p = plan({ now, releases, groups, live, limits });
  const at = new Date(now).toISOString();
  for (const d of p.setDesired) {
    // Record the start before raising capacity: a crash in between leaves
    // the marker, never a start that is issued twice.
    if (d.reason === 'start') await mark(d.release, 'start_issued_at', at);
    await asg.send(new SetDesiredCapacityCommand({ AutoScalingGroupName: d.group, DesiredCapacity: d.to, HonorCooldown: false }));
    console.log(JSON.stringify({ msg: 'desired capacity set', group: d.group, from: d.from, to: d.to, reason: d.reason }));
  }
  for (const r of p.markBusy) await mark(r, 'busy_at', at);
  for (const n of p.notes) console.log(JSON.stringify({ msg: 'scaler', note: n }));
  console.log(emf(p.metrics, now));
  return p;
}

export async function handler(): Promise<void> {
  await reconcile();
}
