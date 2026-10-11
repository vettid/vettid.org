import * as fs from 'fs';
import * as path from 'path';
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import * as cdk from 'aws-cdk-lib';
import { channelVault, loadConfig, releaseLogBaseUrl } from '../lib/config';
import { checkChannel } from '../lib/vault/manifest-check';
import { EMPTY_INDEX, buildIndex, renderLog, withoutNav } from '../lib/vault/release-log';
import {
  LEGACY_STAGING_NOTES_THROUGH,
  RELEASE_LOG_HOSTS,
  ReleaseFile,
  consistencyProblems,
  hostSpecs,
  keySpecs,
  legacyStagingNotes,
  manifestEntries,
  notesToSwitch,
  readReleaseFile,
  releaseLogIndexUrl,
  releaseLogUrl,
  renderManifest,
  successorProblems,
  validateReleaseFile,
} from '../lib/vault/release-list';
import { LABEL, keyId } from '../lambda/shared/manifest';
import { checkReleaseLog, logInputs } from '../scripts/vault/release-log';

/** vettid-vault testdata/vectors/release.json (see vault-manifest-sync.test.ts). */
const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/manifest/release.json'), 'utf8'));
const ROOT = path.join(__dirname, '..');
const ACCOUNT = '369484479783';

const pcr = (c: string) => c.repeat(96);
const keyArn = (n: number) => `arn:aws:kms:us-east-1:${ACCOUNT}:key/0000000${n}-0000-4000-8000-000000000000`;
const host = (n: number) => ({
  tag: `release/prod/${n}`, source_commit: 'c'.repeat(40), measurements_sha256: '1'.repeat(64), host_files_sha256: '2'.repeat(64),
  nitro_cli_version: '1.5.0', base_ami: 'ami-0123456789abcdef0', ami_revision: 0, min_instances: 0, max_instances: 1,
});
const log = (summary: string, extra: Record<string, unknown> = {}) => ({ summary, changes: ['A change.'], security: 'none', ...extra });

/** Two releases: 1 deprecated, 2 active, 3 a candidate. */
function sample(): any {
  return {
    channel: 'prod',
    signed_serial: 3,
    releases: [
      { release: 1, status: 'deprecated', pcr0: pcr('a'), pcr1: pcr('1'), pcr2: pcr('2'), seal_key: keyArn(1), admitted_pcr0s: [],
        published_at: '2027-01-15T12:00:00Z', ends_at: '2028-02-15T00:00:00Z', notes: releaseLogUrl('prod', 1), host: host(1), log: log('First release.') },
      { release: 2, status: 'active', pcr0: pcr('b'), pcr1: pcr('3'), pcr2: pcr('4'), seal_key: keyArn(2), admitted_pcr0s: [pcr('a')],
        published_at: '2027-02-15T12:00:00Z', notes: releaseLogUrl('prod', 2), host: host(2), log: log('Second release.', { security: 'urgent', security_text: 'Fixes X.', affects: [1] }) },
      { release: 3, status: 'candidate', pcr0: pcr('c'), pcr1: pcr('5'), pcr2: pcr('6'), seal_key: '', admitted_pcr0s: [pcr('a'), pcr('b')],
        notes: releaseLogUrl('prod', 3) },
    ],
  };
}

const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const SPKI = key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

function served(bytes: Buffer, k = key.privateKey, spki = SPKI): Buffer {
  const sig = sign('sha256', Buffer.concat([Buffer.from(LABEL), Buffer.from([0]), bytes]), { key: k, dsaEncoding: 'ieee-p1363' });
  return Buffer.from(JSON.stringify({ manifest: bytes.toString('base64'), sig: sig.toString('base64'), key_id: keyId(spki) }));
}

const publish = (file: ReleaseFile, serial: number, issuedAt = '2027-03-01T00:00:00Z') => served(renderManifest(serial, issuedAt, manifestEntries(file)));

describe('manifest rendering (VAULT-MESSAGING §11.10.1)', () => {
  test('reproduces vettid-vault manifest.Build byte for byte (both recorded vectors)', () => {
    for (const bytes of [V.manifest, V.manifest_0_10_0.manifest] as string[]) {
      const m = JSON.parse(bytes);
      expect(renderManifest(m.serial, m.issued_at, m.releases).toString('utf8')).toBe(bytes);
    }
  });

  test('candidates are left out; entries are sorted; ends_at only where set', () => {
    const f = validateReleaseFile(sample(), 'prod', ACCOUNT);
    const m = JSON.parse(renderManifest(4, '2027-03-01T00:00:00Z', manifestEntries(f).reverse()).toString());
    expect(m.releases.map((r: any) => r.release)).toEqual([1, 2]);
    expect(Object.keys(m.releases[0])).toEqual(['release', 'pcr0', 'pcr1', 'pcr2', 'seal_key', 'status', 'published_at', 'ends_at', 'notes']);
    expect(Object.keys(m.releases[1])).not.toContain('ends_at');
  });

  test('refuses a zero serial, a bad time and an empty list', () => {
    const e = manifestEntries(validateReleaseFile(sample(), 'prod', ACCOUNT));
    expect(() => renderManifest(0, '2027-03-01T00:00:00Z', e)).toThrow(/serial/);
    expect(() => renderManifest(1, '2027-03-01T00:00:00.000Z', e)).toThrow(/issued_at/);
    expect(() => renderManifest(1, '2027-03-01T00:00:00Z', [])).toThrow(/no release/);
  });
});

describe('the release file (vault/releases/<channel>.json)', () => {
  test('a valid file; host stacks and keys derive from it', () => {
    const f = validateReleaseFile(sample(), 'prod', ACCOUNT);
    expect(hostSpecs(f).map((s) => [s.release, s.tag, s.pcr0])).toEqual([[1, 'release/prod/1', pcr('a')], [2, 'release/prod/2', pcr('b')]]);
    expect(keySpecs(f)).toEqual([
      { release: 1, pcr0: pcr('a'), admittedPcr0s: [] },
      { release: 2, pcr0: pcr('b'), admittedPcr0s: [pcr('a')] },
      { release: 3, pcr0: pcr('c'), admittedPcr0s: [pcr('a'), pcr('b')] },
    ]);
  });

  test.each([
    ['another account’s key', (f: any) => (f.releases[0].seal_key = keyArn(1).replace(ACCOUNT, '111122223333')), /seal_key/],
    ['an empty key outside candidates', (f: any) => (f.releases[1].seal_key = ''), /seal_key/],
    ['an admitted PCR0 that is not listed', (f: any) => (f.releases[1].admitted_pcr0s = [pcr('d')]), /admitted/],
    ['a release admitting itself or a later one', (f: any) => (f.releases[0].admitted_pcr0s = [pcr('b')]), /admitted/],
    ['notes not the release log entry', (f: any) => (f.releases[0].notes = 'https://vettid.org/releases/1'), /notes/],
    ['notes another channel\'s log entry', (f: any) => (f.releases[0].notes = releaseLogUrl('staging', 1)), /notes must be https:\/\/vettid.org\/security\/releases\/1\//],
    ['a legacy GitHub notes URL in production', (f: any) => (f.releases[0].notes = legacyStagingNotes(1)), /notes/],
    ['retired without ends_at', (f: any) => { f.releases[0].status = 'retired'; delete f.releases[0].ends_at; }, /retired/],
    ['ends_at on an active release', (f: any) => (f.releases[1].ends_at = '2028-01-01T00:00:00Z'), /ends_at/],
    ['an unknown status', (f: any) => (f.releases[0].status = 'canary'), /status/],
    ['a removed release with a stack', (f: any) => (f.releases[0].status = 'removed'), /stack/],
    ['no published_at once listed', (f: any) => delete f.releases[1].published_at, /published_at/],
    ['no log once published', (f: any) => delete f.releases[1].log, /log is required/],
    ['a summary over 160 characters', (f: any) => (f.releases[1].log.summary = 'x'.repeat(161)), /log.summary must be at most 160/],
    ['a summary on two lines', (f: any) => (f.releases[1].log.summary = 'One.\nTwo.'), /log.summary must be one line/],
    ['an empty summary', (f: any) => (f.releases[1].log.summary = ' '), /log.summary/],
    ['markup in a change', (f: any) => (f.releases[1].log.changes = ['<b>bold</b>']), /log.changes\[0\] must be plain text/],
    ['a link in a change', (f: any) => (f.releases[1].log.changes = ['See https://example.org']), /plain text/],
    ['code quotes in a change', (f: any) => (f.releases[1].log.changes = ['The `vault-parent` binary']), /plain text/],
    ['no changes', (f: any) => (f.releases[1].log.changes = []), /1 to 20 changes/],
    ['21 changes', (f: any) => (f.releases[1].log.changes = Array(21).fill('A change.')), /1 to 20 changes/],
    ['a change over 280 characters', (f: any) => (f.releases[1].log.changes = ['x'.repeat(281)]), /log.changes\[0\] must be at most 280/],
    ['security_text over 1,000 characters', (f: any) => (f.releases[1].log.security_text = 'x'.repeat(1001)), /security_text must be at most 1000/],
    ['a security release without text', (f: any) => delete f.releases[1].log.security_text, /security_text/],
    ['a number listed twice', (f: any) => (f.releases[1].release = 1), /sorted/],
    ['a duplicate PCR0', (f: any) => (f.releases[1].pcr0 = pcr('a')), /PCR0/],
    ['a debug PCR', (f: any) => (f.releases[1].pcr1 = pcr('0')), /pcr1/],
    ['the wrong channel', (f: any) => (f.channel = 'staging'), /channel/],
    ['a bad host tag', (f: any) => (f.releases[0].host.tag = 'vault-r1'), /tag/],
  ])('refuses %s', (_what, change, re) => {
    const f = sample();
    change(f);
    expect(() => validateReleaseFile(f, 'prod', ACCOUNT)).toThrow(re);
  });

  test('at the limits: a 160-character summary, 20 changes of 280, 1,000 characters of security_text', () => {
    const f = sample();
    f.releases[1].log = log('é'.repeat(160), { changes: Array(20).fill('x'.repeat(280)), security: 'recommended', security_text: 'y'.repeat(1000) });
    expect(() => validateReleaseFile(f, 'prod', ACCOUNT)).not.toThrow();
  });

  test('a candidate may carry no log yet; its notes are still its log entry', () => {
    const f = sample();
    expect(f.releases[2].log).toBeUndefined();
    expect(() => validateReleaseFile(f, 'prod', ACCOUNT)).not.toThrow();
  });

  test('the committed files are valid (production lists nothing until release 1, W10)', () => {
    for (const ch of ['prod', 'staging'] as const) {
      const f = readReleaseFile(ROOT, ch, channelVault(ch).vault.account);
      if (ch === 'prod') expect(f.releases).toEqual([]);
    }
  });
});

describe('release notes on every channel (VAULT-RELEASES §7)', () => {
  const STAGING_ACCOUNT = channelVault('staging').vault.account;
  const stagingKey = (n: number) => `arn:aws:kms:us-east-1:${STAGING_ACCOUNT}:key/0000000${n}-0000-4000-8000-000000000000`;
  /** Staging: 9 published with its log URL, 10 published with a legacy one (not allowed), and candidates. */
  const staging = (): any => ({
    channel: 'staging',
    signed_serial: 3,
    releases: [
      { release: 8, status: 'deprecated', pcr0: pcr('a'), pcr1: pcr('1'), pcr2: pcr('2'), seal_key: stagingKey(8), admitted_pcr0s: [],
        published_at: '2027-01-15T12:00:00Z', notes: legacyStagingNotes(8), log: log('Eight.') },
      { release: 9, status: 'active', pcr0: pcr('b'), pcr1: pcr('3'), pcr2: pcr('4'), seal_key: stagingKey(9), admitted_pcr0s: [pcr('a')],
        published_at: '2027-02-15T12:00:00Z', notes: releaseLogUrl('staging', 9), log: log('Nine.') },
      { release: 10, status: 'candidate', pcr0: pcr('c'), pcr1: pcr('5'), pcr2: pcr('6'), seal_key: '', admitted_pcr0s: [pcr('a'), pcr('b')],
        notes: releaseLogUrl('staging', 10) },
    ],
  });

  test('each channel\'s log is on the host that serves its manifest', () => {
    expect(releaseLogUrl('prod', 4)).toBe('https://vettid.org/security/releases/4/');
    expect(releaseLogUrl('staging', 9)).toBe('https://staging.vettid.org/security/releases/9/');
    for (const ch of ['prod', 'staging'] as const) {
      expect(new URL(channelVault(ch).vault.manifestUrl).host).toBe(RELEASE_LOG_HOSTS[ch]);
      const config = loadConfig(new cdk.App({ context: { stage: channelVault(ch).stage } }).node);
      expect(releaseLogBaseUrl(config)).toBe(releaseLogIndexUrl(ch));
    }
  });

  test('staging: log is required once a release leaves candidate', () => {
    expect(() => validateReleaseFile(staging(), 'staging', STAGING_ACCOUNT)).not.toThrow();
    const f = staging();
    delete f.releases[1].log;
    expect(() => validateReleaseFile(f, 'staging', STAGING_ACCOUNT)).toThrow(/release 9: log is required/);
  });

  test('staging: notes is the staging log entry; the GitHub URL only for the releases signed before the rule', () => {
    const prodUrl = staging();
    prodUrl.releases[1].notes = releaseLogUrl('prod', 9);
    expect(() => validateReleaseFile(prodUrl, 'staging', STAGING_ACCOUNT)).toThrow(/notes must be https:\/\/staging.vettid.org\/security\/releases\/9\//);
    expect(LEGACY_STAGING_NOTES_THROUGH).toBe(9);
    const late = staging();
    late.releases[2].notes = legacyStagingNotes(10);
    expect(() => validateReleaseFile(late, 'staging', STAGING_ACCOUNT)).toThrow(/release 10: notes/);
    const other = staging();
    other.releases[0].notes = legacyStagingNotes(7);
    expect(() => validateReleaseFile(other, 'staging', STAGING_ACCOUNT)).toThrow(/release 8: notes/);
  });

  test('notesToSwitch names the legacy entries (vault:manifest sign refuses them; `notes` switches them)', () => {
    const f = validateReleaseFile(staging(), 'staging', STAGING_ACCOUNT);
    expect(notesToSwitch(f)).toEqual([8]);
    expect(notesToSwitch(validateReleaseFile(sample(), 'prod', ACCOUNT))).toEqual([]);
  });

  test('successor: a legacy notes may switch to the log entry once; a log entry never changes', () => {
    const e = manifestEntries(validateReleaseFile(staging(), 'staging', STAGING_ACCOUNT));
    const switched = e.map((r) => ({ ...r, notes: releaseLogUrl('staging', r.release) }));
    expect(successorProblems({ serial: 1, releases: e }, { serial: 2, releases: switched })).toEqual([]);
    const back = switched.map((r) => ({ ...r, notes: legacyStagingNotes(r.release) }));
    expect(successorProblems({ serial: 2, releases: switched }, { serial: 3, releases: back })).toEqual([
      expect.stringMatching(/release 8's notes changed from its release log entry/),
      expect.stringMatching(/release 9's notes changed from its release log entry/),
    ]);
  });
});

describe('status and date consistency (§3.2, §3.5)', () => {
  const e = () => manifestEntries(validateReleaseFile(sample(), 'prod', ACCOUNT));
  test('a consistent manifest', () => expect(consistencyProblems(e(), '2027-03-01T00:00:00Z')).toEqual([]));
  test('deprecated within 90 days of its end must be retired', () =>
    expect(consistencyProblems(e(), '2027-12-01T00:00:00Z')).toEqual([expect.stringMatching(/release 1: within 90 days.*retired/)]));
  test('a passed end date must be removed', () =>
    expect(consistencyProblems(e(), '2028-03-01T00:00:00Z').join()).toMatch(/release 1: its ends_at .* has passed/));
  test('deprecated without a newer active release', () => {
    const x = e();
    x[1].status = 'deprecated';
    expect(consistencyProblems(x, '2027-03-01T00:00:00Z').join()).toMatch(/no active release/);
  });
  test('published after issued_at', () => expect(consistencyProblems(e(), '2027-02-01T00:00:00Z').join()).toMatch(/release 2: published_at/));
});

describe('check:manifest (VAULT-RELEASES §7)', () => {
  const file = () => validateReleaseFile(sample(), 'prod', ACCOUNT);
  const base = (over: Partial<Parameters<typeof checkChannel>[0]> = {}) =>
    checkChannel({ channel: 'prod', file: file(), served: publish(file(), 3), pinnedKeys: [SPKI], history: [], ...over });

  test('a signed render of the release file passes', () => expect(base()).toEqual([]));

  test('nothing served and nothing listed passes; listed but not served fails', () => {
    const empty = validateReleaseFile({ channel: 'prod', signed_serial: 0, releases: [] }, 'prod', ACCOUNT);
    expect(checkChannel({ channel: 'prod', file: empty, served: null, pinnedKeys: [SPKI], history: [] })).toEqual([]);
    expect(base({ served: null }).join()).toMatch(/no manifest is served/);
  });

  test('a signature by an unpinned key, or a changed byte, fails', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const otherSpki = other.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(base({ served: served(renderManifest(3, '2027-03-01T00:00:00Z', manifestEntries(file())), other.privateKey, otherSpki) }).join()).toMatch(/not pinned/);
    const doc = JSON.parse(publish(file(), 3).toString());
    const b = Buffer.from(doc.manifest, 'base64');
    b[b.length - 5] ^= 1;
    expect(base({ served: Buffer.from(JSON.stringify({ ...doc, manifest: b.toString('base64') })) }).join()).toMatch(/does not verify/);
  });

  test('a manifest that is not a render of the file (hand-edited, or the file changed) fails', () => {
    const f = sample();
    f.releases[1].log.summary = 'log text is not in the manifest';
    const edited = validateReleaseFile(f, 'prod', ACCOUNT);
    expect(checkChannel({ channel: 'prod', file: edited, served: publish(file(), 3), pinnedKeys: [SPKI], history: [] })).toEqual([]);
    f.releases[0].status = 'retired';
    const changed = validateReleaseFile(f, 'prod', ACCOUNT);
    expect(checkChannel({ channel: 'prod', file: changed, served: publish(file(), 3), pinnedKeys: [SPKI], history: [] }).join()).toMatch(/not a render/);
  });

  test('a serial above signed_serial fails', () => expect(base({ served: publish(file(), 4) }).join()).toMatch(/signed_serial/));

  test('history: serials strictly increase; skipped (canary) serials are fine', () => {
    const one = validateReleaseFile({ ...sample(), releases: [{ ...sample().releases[0], status: 'active', ends_at: undefined }] }, 'prod', ACCOUNT);
    const h = (serial: number) => ({ commit: `c${serial}`.padEnd(40, '0'), served: publish(one, serial, '2027-01-20T00:00:00Z') });
    expect(base({ history: [h(1)] })).toEqual([]);
    expect(base({ history: [h(1), h(2)] })).toEqual([]);
    expect(base({ history: [h(3)] }).join()).toMatch(/serial 3 is not above the previous 3/);
    expect(base({ history: [h(2), h(1)] }).join()).toMatch(/serial 1 is not above the previous 2/);
  });

  test('history: no release dropped before removed, no status going back, no PCR or key change', () => {
    const now = file();
    const h = { commit: 'a'.repeat(40), served: publish(now, 2) };
    const f = sample();
    f.releases.splice(0, 1);
    f.releases[0].admitted_pcr0s = [];
    f.releases[1].admitted_pcr0s = [pcr('b')];
    expect(checkChannel({ channel: 'prod', file: validateReleaseFile(f, 'prod', ACCOUNT), served: publish(validateReleaseFile(f, 'prod', ACCOUNT), 3), pinnedKeys: [SPKI], history: [h] }).join())
      .toMatch(/release 1 \(deprecated\) is dropped before it is removed/);
    const back = sample();
    back.releases[0].status = 'active';
    delete back.releases[0].ends_at;
    const later = { commit: 'b'.repeat(40), served: publish(now, 2) };
    expect(checkChannel({ channel: 'prod', file: validateReleaseFile(back, 'prod', ACCOUNT), served: publish(validateReleaseFile(back, 'prod', ACCOUNT), 3), pinnedKeys: [SPKI], history: [later] }).join())
      .toMatch(/goes back from deprecated to active/);
  });

  test('a served manifest must never disappear', () => {
    const empty = validateReleaseFile({ channel: 'prod', signed_serial: 3, releases: [] }, 'prod', ACCOUNT);
    expect(checkChannel({ channel: 'prod', file: empty, served: null, pinnedKeys: [SPKI], history: [{ commit: 'a'.repeat(40), served: publish(file(), 3) }] }).join())
      .toMatch(/deleted/);
  });

  test('every PCR0 a key admits stays listed', () => {
    const f = sample();
    f.releases[0].status = 'removed';
    delete f.releases[0].host;
    const ok = validateReleaseFile(f, 'prod', ACCOUNT);
    expect(checkChannel({ channel: 'prod', file: ok, served: publish(ok, 3), pinnedKeys: [SPKI], history: [] })).toEqual([]);
  });
});

describe('release log (RELEASE-UPDATES §5)', () => {
  const file = () => validateReleaseFile(sample(), 'prod', ACCOUNT);
  const manifest = (f: ReleaseFile, serial: number) => ({ serial, releases: manifestEntries(f) });

  test('an index page, a page per listed release, and index.json, from the manifest and the file', () => {
    const idx = buildIndex(EMPTY_INDEX, manifest(file(), 3), file());
    expect(idx.serial).toBe(3);
    expect(idx.releases.map((r) => [r.release, r.status, r.listed])).toEqual([[2, 'active', true], [1, 'deprecated', true]]);
    const out = renderLog(idx);
    expect([...out.keys()].sort()).toEqual([
      'website/security/releases/1/index.html', 'website/security/releases/2/index.html',
      'website/security/releases/index.html', 'website/security/releases/index.json',
    ]);
    const p2 = out.get('website/security/releases/2/index.html')!;
    expect(p2).toContain(pcr('b'));
    expect(p2).toContain('release/prod/2');
    expect(p2).toContain('Security fix: update urgently (affects release 1)');
    expect(out.get('website/security/releases/1/index.html')).toContain('It ends on 2028-02-15.');
    expect(out.get('website/security/releases/index.html')).toContain('Generated from manifest serial 3');
    for (const html of [...out.values()].filter((v) => v.startsWith('<!DOCTYPE'))) {
      expect(html).not.toMatch(/ style="/); // check:site: no inline style attributes
      expect(html).not.toMatch(/<script>/); // CSP: no inline scripts
      expect((html.match(/<div[ >]/g) ?? []).length).toBe((html.match(/<\/div>/g) ?? []).length);
      expect(html).toContain('<!-- nav:header -->');
    }
    expect(JSON.parse(out.get('website/security/releases/index.json')!).releases[0]).toMatchObject({ release: 2, security: 'urgent', affects: [1] });
  });

  test('a release dropped from the manifest keeps its entry and page; text is escaped', () => {
    const f = sample();
    f.releases[0].log.summary = 'Fish & chips, "quoted"'; // markup itself is refused by the validation
    const first = buildIndex(EMPTY_INDEX, manifest(validateReleaseFile(f, 'prod', ACCOUNT), 3), validateReleaseFile(f, 'prod', ACCOUNT));
    expect(renderLog(first).get('website/security/releases/1/index.html')).toContain('Fish &amp; chips, &quot;quoted&quot;');
    f.releases[0].status = 'removed';
    delete f.releases[0].host;
    const removed = validateReleaseFile(f, 'prod', ACCOUNT);
    const second = buildIndex(first, manifest(removed, 4), removed);
    const g = sample();
    g.releases.splice(0, 1);
    g.releases[0].admitted_pcr0s = [];
    g.releases[1].admitted_pcr0s = [pcr('b')];
    const dropped = validateReleaseFile(g, 'prod', ACCOUNT);
    const third = buildIndex(second, manifest(dropped, 5), dropped);
    expect(third.releases.map((r) => [r.release, r.status, r.listed])).toEqual([[2, 'active', true], [1, 'removed', false]]);
    expect(renderLog(third).has('website/security/releases/1/index.html')).toBe(true);
    expect(() => buildIndex(first, manifest(dropped, 5), dropped)).toThrow(/left the manifest while deprecated/);
    expect(() => buildIndex(third, manifest(dropped, 4), dropped)).toThrow(/below/);
  });

  test('the navigation blocks are ignored when comparing (sync-nav owns them)', () => {
    const a = '<!-- nav:menu — generated -->\n<a>x</a>\n<!-- /nav:menu -->';
    expect(withoutNav(a)).toBe(withoutNav('<!-- nav:menu -->\n<!-- /nav:menu -->'));
  });

  test.each(['prod', 'staging'] as const)('the committed %s release log is current', (ch) => {
    const { manifest: m, file: f } = logInputs(ROOT, ch);
    expect(checkReleaseLog(ROOT, m, f)).toEqual([]);
  });

  test('the committed staging log lists every release in the staging manifest, with its log text', () => {
    const { manifest: m, file: f } = logInputs(ROOT, 'staging');
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites/staging/security/releases/index.json'), 'utf8'));
    expect(idx.serial).toBe(m!.serial);
    for (const r of m!.releases) {
      const e = idx.releases.find((x: any) => x.release === r.release);
      expect(e).toMatchObject({ notes: r.notes, status: r.status, security: 'none', summary: f.releases.find((x) => x.release === r.release)!.log!.summary });
    }
  });

  test('staging: pages under sites/staging in the staging design, with log.css, no inline style, the staging manifest linked', () => {
    const SA = channelVault('staging').vault.account;
    const f = sample();
    f.channel = 'staging';
    for (const r of f.releases) {
      r.seal_key = r.seal_key && r.seal_key.replace(ACCOUNT, SA);
      r.notes = releaseLogUrl('staging', r.release);
      if (r.host) r.host.tag = `release/staging/${r.release}`;
    }
    const sf = validateReleaseFile(f, 'staging', SA);
    const out = renderLog(buildIndex(EMPTY_INDEX, manifest(sf, 3), sf), 'staging');
    expect([...out.keys()].sort()).toEqual([
      'sites/staging/security/releases/1/index.html', 'sites/staging/security/releases/2/index.html',
      'sites/staging/security/releases/index.html', 'sites/staging/security/releases/index.json', 'sites/staging/security/releases/log.css',
    ]);
    const index = out.get('sites/staging/security/releases/index.html')!;
    expect(index).toMatch(/<title>[^<]*Staging \(test builds\)[^<]*<\/title>/);
    expect(index).toMatch(/<h1>[^<]*Staging \(test builds\)/);
    expect(index).toContain('href="/.well-known/vettid/pcr-manifest.json"');
    expect(index).toContain('<td>Staging</td>');
    expect(out.get('sites/staging/security/releases/2/index.html')).toContain('CHANNEL=staging release/rebuild.sh');
    for (const [p, html] of [...out].filter(([k]) => k.endsWith('.html'))) {
      expect({ p, inline: / style="|<style[\s>]|<script/.test(html) }).toEqual({ p, inline: false }); // CSP style-src/script-src 'self'
      expect(html).toContain('href="/security/releases/log.css"');
      expect(html).not.toContain('nav:header');
    }
    expect(JSON.parse(out.get('sites/staging/security/releases/index.json')!).releases.map((r: any) => r.notes))
      .toEqual([releaseLogUrl('staging', 2), releaseLogUrl('staging', 1)]);
  });
});

describe('pinned manifest keys (lib/config.ts, VAULT-RELEASES §6.1)', () => {
  test.each([
    ['prod', ['4353463f85c4012f', '1abd49da96970b6e']],
    ['staging', ['e9b3a403423120ac']],
  ] as const)('%s: P-256 SubjectPublicKeyInfo, key_ids %j', (ch, ids) => {
    const keys = channelVault(ch).vault.manifestKeys;
    expect(keys.map(keyId)).toEqual(ids);
    for (const k of keys) {
      const pub = createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' });
      expect(pub.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    }
  });
});
