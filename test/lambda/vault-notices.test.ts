import { mockClient } from 'aws-sdk-client-mock';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_AUDIT: 'audit', TABLE_RATELIMITS: 'rl', TABLE_VAULTS: 'vaults', TABLE_VAULT_RELEASES: 'releases',
  SENDER_EMAIL: 'no-reply@vettid.org', RELEASE_LOG_URL: 'https://vettid.org/security/releases/',
});
/* eslint-disable @typescript-eslint/no-require-imports */
const job = require('../../lambda/jobs/vault-notices');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const DAY = 86_400_000;
const NOW = Date.UTC(2027, 10, 1, 15, 0, 0); // 2027-11-01T15:00:00Z
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const P = (c: string) => c.repeat(96);

describe('dueMilestone (pure)', () => {
  const r = (status: string, endsInDays: number | null, extra = {}) => ({
    release: P('a'), release_number: 3, status, ...(endsInDays === null ? {} : { ends_at: iso(NOW + endsInDays * DAY) }), ...extra,
  });
  test.each([
    [r('deprecated', 120), null],
    [r('deprecated', 90), 'ends_90'],
    [r('retired', 89.5), 'ends_90'],
    [r('retired', 31), 'ends_90'],
    [r('retired', 30), 'ends_30'],
    [r('retired', 29), 'ends_30'], // a missed day still sends the 30-day notice, not the stale 90-day one
    [r('retired', 7), 'ends_7'],
    [r('retired', 2), 'ends_7'],
    [r('retired', 1), 'ends_1'],
    [r('retired', 0.2), 'ends_1'],
    [r('active', 30), null],
    [r('retired', null), null],
    [r('removed', -1), 'ended'],
    [r('removed', -14), 'ended'],
    [r('removed', -15), null],
    [r('removed', -1, { rescue: true }), null],
    [r('retired', -1), null], // passed but not removed yet: no "ended" claim
    [r('removed', 5), null],
    [{ ...r('retired', null), ends_at: 'soon' }, null],
  ])('%j → %s', (row, want) => expect(job.dueMilestone(row, NOW)).toBe(want));
});

describe('urgentReleases (pure)', () => {
  const e = (extra = {}) => ({ release: 6, status: 'active', published_at: iso(NOW - 3 * DAY), listed: true, security: 'urgent', affects: [5], ...extra });
  test('urgent, listed, with affected releases, in its first 30 days', () => {
    expect(job.urgentReleases({ releases: [e()] }, NOW)).toHaveLength(1);
    expect(job.urgentReleases({ releases: [e({ security: 'recommended' })] }, NOW)).toHaveLength(0);
    expect(job.urgentReleases({ releases: [e({ published_at: iso(NOW - 31 * DAY) })] }, NOW)).toHaveLength(0);
    expect(job.urgentReleases({ releases: [e({ listed: false })] }, NOW)).toHaveLength(0);
    expect(job.urgentReleases({ releases: [e({ affects: undefined })] }, NOW)).toHaveLength(0);
    expect(job.urgentReleases(null, NOW)).toEqual([]);
    expect(job.urgentReleases({ releases: 'x' }, NOW)).toEqual([]);
  });
});

describe('the notice job', () => {
  let rl: Map<string, unknown>;
  let releases: any[];
  let vaults: any[];
  let members: Record<string, any>;
  let fetchSpy: jest.SpyInstance;
  const mails = () => ses.commandCalls(SendEmailCommand).map((c) => ({
    to: c.args[0].input.Destination!.ToAddresses![0],
    subject: c.args[0].input.Content!.Simple!.Subject!.Data!,
    text: c.args[0].input.Content!.Simple!.Body!.Text!.Data!,
  }));

  beforeEach(() => {
    ddb.reset();
    ses.reset();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    rl = new Map();
    releases = [
      { release: P('a'), release_number: 3, status: 'retired', ends_at: iso(NOW + 30 * DAY) },
      { release: P('b'), release_number: 4, status: 'deprecated', ends_at: iso(NOW + 200 * DAY) },
      { release: P('c'), release_number: 2, status: 'removed', ends_at: iso(NOW - 2 * DAY) },
    ];
    vaults = [
      { vault_id: '1'.repeat(32), sealed_release: P('a'), user_guid: 'g1', state: 'locked' },
      { vault_id: '2'.repeat(32), sealed_release: P('a'), user_guid: 'g2', state: 'unlocked' },
      { vault_id: '3'.repeat(32), sealed_release: P('a'), user_guid: 'g3', state: 'deleted' },
      { vault_id: '4'.repeat(32), sealed_release: P('c'), user_guid: 'g4', state: 'locked' },
      { vault_id: '5'.repeat(32), sealed_release: P('b'), user_guid: 'g5', state: 'locked' },
    ];
    members = Object.fromEntries(['g1', 'g2', 'g3', 'g4', 'g5'].map((g) => [g, { user_guid: g, email: `${g}@x.org`, state: 'member' }]));
    ddb.on(QueryCommand).callsFake((i) => {
      if (i.TableName === 'releases') return { Items: releases.filter((r) => r.status === i.ExpressionAttributeValues[':s']) };
      if (i.TableName === 'vaults') {
        expect(i.IndexName).toBe('sealed-release-index');
        return { Items: vaults.filter((v) => v.sealed_release === i.ExpressionAttributeValues[':r']).map(({ vault_id, user_guid, state, sealed_release }) => ({ vault_id, user_guid, state, sealed_release })) };
      }
      throw new Error(`unexpected query ${i.TableName}`);
    });
    ddb.on(PutCommand).callsFake((i) => {
      if (i.TableName === 'audit') return {};
      if (rl.has(i.Item.key)) throw Object.assign(new Error('ccf'), { name: 'ConditionalCheckFailedException' });
      rl.set(i.Item.key, i.Item);
      return {};
    });
    ddb.on(DeleteCommand).callsFake((i) => {
      rl.delete(i.Key.key);
      return {};
    });
    ddb.on(GetCommand).callsFake((i) => ({ Item: members[i.Key.user_guid] }));
    ses.on(SendEmailCommand).resolves({});
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ serial: 9, releases: [] }), { status: 200 }));
  });
  afterEach(() => jest.restoreAllMocks());

  test('the 30-day notice to members on the retiring release, and "ended" for the removed one; once only', async () => {
    const c = await job.handler();
    expect(c).toEqual({ sent: 3, skipped: 0, failed: 0 });
    const m = mails();
    expect(m.map((x) => x.to).sort()).toEqual(['g1@x.org', 'g2@x.org', 'g4@x.org']);
    const g1 = m.find((x) => x.to === 'g1@x.org')!;
    expect(g1.subject).toBe(`Action needed: your VettID vault's software ends on ${iso(NOW + 30 * DAY).slice(0, 10)}`);
    expect(g1.text).toContain('release 3');
    expect(g1.text).toContain('in 30 days');
    expect(g1.text).toContain('https://vettid.org/security/releases/3/');
    const g4 = m.find((x) => x.to === 'g4@x.org')!;
    expect(g4.subject).toBe("Your VettID vault's software release 2 has ended");
    expect(g4.text).toContain('support@vettid.org');
    for (const x of m) expect(x.text).toContain('never asks for your PIN');
    // Deduplicated: a second run the same day (or a retry) sends nothing.
    ses.resetHistory();
    expect(await job.handler()).toEqual({ sent: 0, skipped: 3, failed: 0 });
    expect(mails()).toEqual([]);
    // The claim expires 60 days after the end date (ratelimits TTL).
    const k = [...rl.keys()].find((x) => x.endsWith('#ends_30#g1'))!;
    expect((rl.get(k) as any).expires_at).toBe(Math.floor((NOW + 30 * DAY) / 1000) + 60 * 86_400);
  });

  test('the next milestone is a new notice; a moved date is a new series', async () => {
    await job.handler();
    ses.resetHistory();
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 23 * DAY); // 7 days left
    await job.handler();
    expect(mails().filter((x) => x.text.includes('release 3')).map((x) => x.to).sort()).toEqual(['g1@x.org', 'g2@x.org']);
    expect(mails()[0].text).toContain('in 7 days');
    ses.resetHistory();
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 29 * DAY + 3600_000); // the last day
    await job.handler();
    expect(mails().filter((x) => x.text.includes('release 3'))[0].subject).toMatch(/^Last day/);
  });

  test('a failed send is retried by the next run; a member who cannot be mailed is skipped', async () => {
    ses.on(SendEmailCommand).rejectsOnce(Object.assign(new Error('x'), { name: 'MessageRejected' })).resolves({});
    delete members.g4;
    const c = await job.handler();
    expect(c.failed).toBe(1);
    expect(c.skipped).toBe(1);
    // (No resetHistory: it would re-arm the mock's "once".)
    const again = await job.handler();
    expect({ again, keys: [...rl.keys()].length }).toEqual({ again: { sent: 1, skipped: 2, failed: 0 }, keys: 3 });
  });

  test('an urgent security release emails members on the affected releases that still run, once', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      serial: 9,
      releases: [
        { release: 5, status: 'active', published_at: iso(NOW - DAY), listed: true, security: 'urgent', security_text: 'Fixes a bug in recovery.', affects: [4, 2] },
      ],
    }), { status: 200 }));
    releases = releases.filter((r) => r.release_number !== 3 && r.release_number !== 2).concat([{ release: P('c'), release_number: 2, status: 'removed' }]);
    await job.handler();
    const m = mails();
    expect(m).toHaveLength(1); // release 4's member; release 2 is removed
    expect(m[0]).toMatchObject({ to: 'g5@x.org', subject: 'Security update for your VettID vault' });
    expect(m[0].text).toContain('Release 5 of the vault software fixes a security problem in release 4');
    expect(m[0].text).toContain('Fixes a bug in recovery.');
    ses.resetHistory();
    await job.handler();
    expect(mails()).toEqual([]);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://vettid.org/security/releases/index.json');
  });

  test('the release log being unreachable does not stop the deadline notices', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
    expect((await job.handler()).sent).toBe(3);
  });
});
