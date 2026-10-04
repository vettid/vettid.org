import { mockClient } from 'aws-sdk-client-mock';
import { AutoScalingClient, DescribeAutoScalingGroupsCommand, SetDesiredCapacityCommand } from '@aws-sdk/client-auto-scaling';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Group, LiveInstance, ReleaseRow, Snapshot, plan, routable } from '../../lambda/vault/scaler-logic';

Object.assign(process.env, {
  TABLE_VAULT_RELEASES: 'releases', TABLE_VAULT_INSTANCES: 'instances', CAP_PER_RELEASE: '2', CAP_TOTAL: '6', IDLE_MINUTES: '30',
});
/* eslint-disable @typescript-eslint/no-require-imports */
const scaler = require('../../lambda/vault/scaler');
/* eslint-enable */

const NOW = Date.parse('2026-10-04T12:00:00.000Z');
const iso = (agoS: number) => new Date(NOW - agoS * 1000).toISOString();
const hb = (agoS: number) => Math.floor(NOW / 1000) - agoS;
const pcr = (c: string) => c.repeat(96);
const P1 = pcr('1');
const P2 = pcr('2');
const P3 = pcr('3');
const LIMITS = { perRelease: 2, total: 6, idleMinutes: 30 };

const row = (release: string, n: number, extra: Partial<ReleaseRow> = {}): ReleaseRow => ({ release, release_number: n, status: 'active', available: true, ...extra });
const group = (pcr0: string, n: number, extra: Partial<Group> = {}): Group => ({ name: `vettid-org-vault-r${n}`, pcr0, releaseNumber: n, min: 0, max: 2, desired: 0, ...extra });
const snap = (releases: ReleaseRow[], groups: Group[], live: Record<string, LiveInstance[]> = {}, limits = LIMITS): Snapshot => ({ now: NOW, releases, groups, live, limits });
const inst = (load: number, agoS = 5): LiveInstance => ({ instance_id: `i-${load}${agoS}`, heartbeat_at: hb(agoS), load });

describe('scaler: start', () => {
  test('a fresh start request with no live instance raises desired to 1 and records the start', () => {
    const p = plan(snap([row(P1, 1, { start_requested_at: iso(10) })], [group(P1, 1)]));
    expect(p.setDesired).toEqual([{ group: 'vettid-org-vault-r1', release: P1, from: 0, to: 1, reason: 'start' }]);
    expect(p.markStartIssued).toEqual([P1]);
    expect(p.metrics.StartsIssued).toBe(1);
  });

  test('a request already served (older than the last issued start) does nothing', () => {
    const p = plan(snap([row(P1, 1, { start_requested_at: iso(100), start_issued_at: iso(90) })], [group(P1, 1)]));
    expect(p.setDesired).toEqual([]);
  });

  test('a stale request (older than 5 min) never starts anything, so an idle stop is not undone', () => {
    const p = plan(snap([row(P1, 1, { start_requested_at: iso(301) })], [group(P1, 1)]));
    expect(p.setDesired).toEqual([]);
  });

  test('no start while an instance is live or already booting', () => {
    expect(plan(snap([row(P1, 1, { start_requested_at: iso(10) })], [group(P1, 1)], { [P1]: [inst(0)] })).setDesired).toEqual([]);
    expect(plan(snap([row(P1, 1, { start_requested_at: iso(10) })], [group(P1, 1, { desired: 1 })])).setDesired).toEqual([]);
  });

  test('deprecated and retired releases are started (move-only, C1–C8)', () => {
    for (const status of ['deprecated', 'retired']) {
      expect(plan(snap([row(P1, 1, { status, start_requested_at: iso(1) })], [group(P1, 1)])).setDesired).toHaveLength(1);
    }
  });

  test('removed is never started, unless rescue: true', () => {
    const removed = plan(snap([row(P1, 1, { status: 'removed', start_requested_at: iso(1) })], [group(P1, 1)]));
    expect(removed.setDesired).toEqual([]);
    const rescue = plan(snap([row(P1, 1, { status: 'removed', rescue: true, start_requested_at: iso(1) })], [group(P1, 1)]));
    expect(rescue.setDesired.map((d) => d.to)).toEqual([1]);
  });

  test('unavailable or unknown statuses are not routable', () => {
    expect(routable(row(P1, 1, { available: false }))).toBe(false);
    expect(routable(row(P1, 1, { status: 'canary' }))).toBe(false);
    expect(routable(row(P1, 1, { status: 'removed', rescue: false }))).toBe(false);
    expect(plan(snap([row(P1, 1, { available: false, start_requested_at: iso(1) })], [group(P1, 1)])).setDesired).toEqual([]);
  });

  test('no group: the start is counted as blocked, nothing is created', () => {
    const p = plan(snap([row(P1, 1, { start_requested_at: iso(1) })], []));
    expect(p.setDesired).toEqual([]);
    expect(p.metrics.StartsBlocked).toBe(1);
  });

  test('a group whose tags disagree with the row is ignored', () => {
    const wrongNumber = plan(snap([row(P1, 1, { start_requested_at: iso(1) })], [group(P1, 7)]));
    expect(wrongNumber.setDesired).toEqual([]);
    expect(wrongNumber.notes.join()).toMatch(/release number tag/);
    const badPcr = plan(snap([row(P1, 1, { start_requested_at: iso(1) })], [group('nope', 1)]));
    expect(badPcr.setDesired).toEqual([]);
  });

  test('the total cap of 6 blocks a start', () => {
    const rows = [row(P1, 1), row(P2, 2), row(P3, 3, { start_requested_at: iso(1) })];
    const groups = [group(P1, 1, { desired: 2, min: 2 }), group(P2, 2, { desired: 2, min: 2 }), group(P3, 3)];
    const ok = plan(snap(rows, groups, { [P1]: [inst(1), inst(1)], [P2]: [inst(1), inst(1)] }));
    expect(ok.setDesired.map((d) => d.group)).toEqual(['vettid-org-vault-r3']); // 4 + 1 ≤ 6
    const full = plan(snap(rows, groups, { [P1]: [inst(1), inst(1)], [P2]: [inst(1), inst(1)] }, { ...LIMITS, total: 4 }));
    expect(full.setDesired).toEqual([]);
    expect(full.metrics.StartsBlocked).toBe(1);
    expect(full.notes.join()).toMatch(/total cap/);
  });

  test('the per-release cap and the group max bound a start', () => {
    const p = plan(snap([row(P1, 1, { start_requested_at: iso(1) })], [group(P1, 1, { max: 0 })]));
    expect(p.setDesired).toEqual([]);
    expect(p.metrics.StartsBlocked).toBe(1);
  });
});

describe('scaler: stop', () => {
  const idleRow = (agoS: number) => row(P1, 1, { start_requested_at: iso(agoS), start_issued_at: iso(agoS) });

  test('idle for 30 minutes (all live instances at load 0) → desired back to the minimum', () => {
    const p = plan(snap([idleRow(30 * 60)], [group(P1, 1, { desired: 1 })], { [P1]: [inst(0)] }));
    expect(p.setDesired).toEqual([{ group: 'vettid-org-vault-r1', release: P1, from: 1, to: 0, reason: 'idle' }]);
    expect(p.metrics.StopsIssued).toBe(1);
  });

  test('not yet idle for 30 minutes → kept', () => {
    expect(plan(snap([idleRow(29 * 60)], [group(P1, 1, { desired: 1 })], { [P1]: [inst(0)] })).setDesired).toEqual([]);
  });

  test('a busy instance keeps the group and refreshes busy_at at most every 5 minutes', () => {
    const busy = plan(snap([idleRow(3600)], [group(P1, 1, { desired: 1 })], { [P1]: [inst(0), inst(3)] }));
    expect(busy.setDesired).toEqual([]);
    expect(busy.markBusy).toEqual([P1]);
    const recent = plan(snap([row(P1, 1, { start_issued_at: iso(3600), busy_at: iso(60) })], [group(P1, 1, { desired: 1 })], { [P1]: [inst(2)] }));
    expect(recent.markBusy).toEqual([]);
  });

  test('busy_at counts as activity: idle 30 min after the last busy report', () => {
    const r = row(P1, 1, { start_issued_at: iso(7200), busy_at: iso(25 * 60) });
    expect(plan(snap([r], [group(P1, 1, { desired: 1 })], { [P1]: [inst(0)] })).setDesired).toEqual([]);
    const r2 = row(P1, 1, { start_issued_at: iso(7200), busy_at: iso(31 * 60) });
    expect(plan(snap([r2], [group(P1, 1, { desired: 1 })], { [P1]: [inst(0)] })).setDesired.map((d) => d.to)).toEqual([0]);
  });

  test('never below the group minimum (always-on release, O7)', () => {
    const p = plan(snap([idleRow(7200)], [group(P1, 1, { min: 1, desired: 2 })], { [P1]: [inst(0), inst(0)] }));
    expect(p.setDesired.map((d) => d.to)).toEqual([1]);
    expect(plan(snap([idleRow(7200)], [group(P1, 1, { min: 1, desired: 1 })], { [P1]: [inst(0)] })).setDesired).toEqual([]);
  });

  test('a hand scale-up without markers starts the idle clock instead of stopping at once', () => {
    const p = plan(snap([row(P1, 1)], [group(P1, 1, { desired: 1 })], { [P1]: [inst(0)] }));
    expect(p.setDesired).toEqual([]);
    expect(p.markBusy).toEqual([P1]);
  });

  test('a removed release without rescue goes to its minimum at once', () => {
    const p = plan(snap([row(P1, 1, { status: 'removed', busy_at: iso(1) })], [group(P1, 1, { desired: 1 })], { [P1]: [inst(4)] }));
    expect(p.setDesired).toEqual([{ group: 'vettid-org-vault-r1', release: P1, from: 1, to: 0, reason: 'not_routable' }]);
  });

  test('groups without a release row (candidate, canary) are left to the operator', () => {
    const p = plan(snap([], [group(P1, 1, { desired: 1 })]));
    expect(p.setDesired).toEqual([]);
  });
});

describe('scaler: alarms', () => {
  test('a start issued 10+ min ago, still requested, nothing live → StartsUnfulfilled', () => {
    const r = row(P1, 1, { start_requested_at: iso(20), start_issued_at: iso(11 * 60) });
    const p = plan(snap([r], [group(P1, 1, { desired: 1 })]));
    expect(p.metrics.StartsUnfulfilled).toBe(1);
    const early = plan(snap([row(P1, 1, { start_requested_at: iso(20), start_issued_at: iso(5 * 60) })], [group(P1, 1, { desired: 1 })]));
    expect(early.metrics.StartsUnfulfilled).toBe(0);
  });

  test('ActiveMinimumUnmet: the newest active release with min 1 has no live instance', () => {
    const rows = [row(P1, 1, { status: 'deprecated' }), row(P2, 2)];
    expect(plan(snap(rows, [group(P1, 1), group(P2, 2, { min: 1, desired: 1 })])).metrics.ActiveMinimumUnmet).toBe(1);
    expect(plan(snap(rows, [group(P1, 1), group(P2, 2, { min: 1, desired: 1 })], { [P2]: [inst(0)] })).metrics.ActiveMinimumUnmet).toBe(0);
    expect(plan(snap(rows, [group(P1, 1), group(P2, 2)])).metrics.ActiveMinimumUnmet).toBe(0); // on demand (O7: 0 until members exist)
  });

  test('stale heartbeats are not live', () => {
    const p = plan(snap([row(P1, 1, { start_requested_at: iso(1) })], [group(P1, 1)], { [P1]: [inst(0, 91)] }));
    expect(p.setDesired.map((d) => d.to)).toEqual([1]);
    expect(p.metrics.LiveInstances).toBe(0);
  });
});

describe('scaler handler (AWS calls)', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const asg = mockClient(AutoScalingClient);
  beforeEach(() => {
    ddb.reset();
    asg.reset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  test('starts a requested release through SetDesiredCapacity, marker first', async () => {
    ddb.on(ScanCommand).resolves({ Items: [row(P1, 1, { start_requested_at: iso(5) })] });
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(UpdateCommand).resolves({});
    asg.on(DescribeAutoScalingGroupsCommand).resolves({
      AutoScalingGroups: [
        {
          AutoScalingGroupName: 'vettid-org-vault-r1', MinSize: 0, MaxSize: 2, DesiredCapacity: 0,
          Tags: [{ Key: 'vettid:vault-scaler', Value: 'managed' }, { Key: 'vettid:vault-release', Value: '1' }, { Key: 'vettid:vault-pcr0', Value: P1 }],
        } as never,
      ],
    });
    asg.on(SetDesiredCapacityCommand).resolves({});
    const p = await scaler.reconcile(NOW);
    expect(p.metrics.StartsIssued).toBe(1);
    expect(asg.commandCalls(DescribeAutoScalingGroupsCommand)[0].args[0].input.Filters).toEqual([{ Name: 'tag:vettid:vault-scaler', Values: ['managed'] }]);
    expect(asg.commandCalls(SetDesiredCapacityCommand)[0].args[0].input).toEqual({ AutoScalingGroupName: 'vettid-org-vault-r1', DesiredCapacity: 1, HonorCooldown: false });
    const upd = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(upd.UpdateExpression).toBe('SET #a = :at');
    expect(upd.ExpressionAttributeNames).toEqual({ '#a': 'start_issued_at', '#r': 'release' });
    expect(upd.ConditionExpression).toBe('attribute_exists(#r)');
    // The live query uses the registry's release index with the 90 s cut.
    expect(ddb.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({ IndexName: 'release-index', ExpressionAttributeValues: { ':r': P1, ':cut': hb(90) } });
  });

  test('untagged or unmanaged groups are never touched', () => {
    expect(scaler.toGroup({ AutoScalingGroupName: 'other', Tags: [] })).toBeNull();
    expect(scaler.toGroup({ AutoScalingGroupName: 'x', Tags: [{ Key: 'vettid:vault-scaler', Value: 'managed' }] })).toBeNull();
  });

  test('metrics go out as EMF in VettID/Vault', () => {
    const line = JSON.parse(scaler.emf({ StartsIssued: 1 }, NOW));
    expect(line._aws.CloudWatchMetrics[0].Namespace).toBe('VettID/Vault');
    expect(line.Component).toBe('scaler');
    expect(line.StartsIssued).toBe(1);
  });
});
