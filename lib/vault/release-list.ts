/**
 * The release list: `vault/releases/<channel>.json` (VAULT-RELEASES §7),
 * the source of truth for one channel's releases. CDK reads it (release
 * keys in VettidOrgVaultStack, one VettidOrgVaultRelease<N>Stack per entry
 * with a `host`), the manifest tooling renders the manifest from it
 * (scripts/vault/manifest.ts, through vettid-vault's `vaultctl manifest`),
 * and the release log pages are generated from it and the signed manifest
 * (scripts/vault/release-log.ts).
 *
 * The file is also a valid `vaultctl manifest render -releases` input: that
 * parser reads `releases[].{release, pcr0, pcr1, pcr2, seal_key, status,
 * published_at, ends_at, notes}`, ignores every other member and leaves
 * `candidate` entries out.
 *
 * Plain Node (fs, crypto) only: imported by the CDK app, the scripts and
 * the tests, never by a Lambda.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReleaseKeySpec } from '../constructs/release-key';
import { VaultReleaseSpec, validateReleaseList } from './releases';

export type Channel = 'prod' | 'staging';
export const CHANNELS: readonly Channel[] = ['prod', 'staging'];

/** The four manifest statuses (fixed from release 1 on, C1) plus `candidate` (in CDK, not in the manifest; §10.1 step 5). */
export const LIST_STATUSES = ['candidate', 'active', 'deprecated', 'retired', 'removed'] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];
export type ManifestStatus = Exclude<ListStatus, 'candidate'>;

/** How urgent updating is (RELEASE-UPDATES §5 "Security"). */
export const SECURITY_LEVELS = ['none', 'recommended', 'urgent'] as const;
export type SecurityLevel = (typeof SECURITY_LEVELS)[number];

/** The release log text of one release (RELEASE-UPDATES §5). Plain text: the app shows it as written. */
export interface ReleaseLog {
  /** One line, plain language, at most LOG_LIMITS.summary characters. */
  readonly summary: string;
  /** What changed: features, fixes, and anything that touches how members' data is handled. */
  readonly changes: readonly string[];
  readonly security: SecurityLevel;
  /** For `recommended` and `urgent`: what was fixed and who is affected. */
  readonly security_text?: string;
  /** Release numbers the security fix applies to (members sealed to them are emailed for `urgent`, §10.2). */
  readonly affects?: readonly number[];
}

/** The release stack's inputs (§8.3), as in lib/vault/releases.ts, in the file's snake_case. */
export interface HostEntry {
  readonly tag: string;
  readonly source_commit: string;
  readonly measurements_sha256: string;
  readonly host_files_sha256: string;
  readonly nitro_cli_version: string;
  readonly base_ami: string;
  readonly ami_revision: number;
  readonly min_instances: 0 | 1;
  readonly max_instances: 1 | 2;
}

export interface ReleaseEntry {
  readonly release: number;
  readonly status: ListStatus;
  readonly pcr0: string;
  readonly pcr1: string;
  readonly pcr2: string;
  /** The sealing key's ARN; empty only for a `candidate` whose key does not exist yet (§10.1 step 6). */
  readonly seal_key: string;
  /** PCR0s of every release not `removed` when this release's key was created (§6.2); never changes. */
  readonly admitted_pcr0s: readonly string[];
  /** RFC 3339, whole seconds UTC. Required once the release is in a manifest. */
  readonly published_at?: string;
  readonly ends_at?: string;
  /**
   * The release's entry in its channel's release log, releaseLogUrl(channel, n)
   * (VAULT-RELEASES §7 "Release notes on every channel"); staging releases
   * signed before that rule may still carry their GitHub release URL
   * (legacyStagingNotes) until the next staging signing switches them.
   */
  readonly notes: string;
  /** Null or absent: no release stack (not built yet, or deleted at `removed`). */
  readonly host?: HostEntry | null;
  /** Required once the release leaves `candidate` (signed into a manifest), in every channel. */
  readonly log?: ReleaseLog;
}

export interface ReleaseFile {
  readonly channel: Channel;
  /**
   * The highest manifest serial ever signed for this channel, published or
   * not (a canary manifest's serial is never reused, §7, §10.1). The
   * signing script raises it before it signs.
   */
  readonly signed_serial: number;
  readonly releases: readonly ReleaseEntry[];
}

/** Where each channel's list lives. */
export const releaseFilePath = (root: string, channel: Channel) => join(root, 'vault', 'releases', `${channel}.json`);

/**
 * Where each channel's served manifest is committed (VAULT-RELEASES §7).
 * Production's is the site's `/.well-known/vettid/pcr-manifest.json`;
 * staging's is kept under vault/ and served byte for byte by
 * VettidOrgStageSiteStack at
 * https://staging.vettid.org/.well-known/vettid/pcr-manifest.json.
 * Absent until the channel's first release is published.
 */
export const SERVED_PATHS: Record<Channel, string> = {
  prod: 'website/.well-known/vettid/pcr-manifest.json',
  staging: 'vault/staging/pcr-manifest.json',
};

/**
 * Each channel's release log (RELEASE-UPDATES §5, VAULT-RELEASES §7): on
 * the site that serves the channel's manifest (the host of
 * channelVault(channel).vault.manifestUrl; a test checks they agree),
 * generated into these directories by scripts/vault/release-log.ts.
 */
export const RELEASE_LOG_HOSTS: Record<Channel, string> = {
  prod: 'vettid.org',
  staging: 'staging.vettid.org',
};
export const RELEASE_LOG_DIRS: Record<Channel, string> = {
  prod: 'website/security/releases',
  staging: 'sites/staging/security/releases',
};
/** The release log's index on the channel's site. */
export const releaseLogIndexUrl = (channel: Channel) => `https://${RELEASE_LOG_HOSTS[channel]}/security/releases/`;
/** A release's `notes`: its entry in its own channel's log. */
export const releaseLogUrl = (channel: Channel, n: number) => `${releaseLogIndexUrl(channel)}${n}/`;
/** True if `url` is release n's entry in any channel's log (the successor rule: such a `notes` never changes). */
export const isReleaseLogUrl = (url: string, n: number) => CHANNELS.some((c) => url === releaseLogUrl(c, n));

/**
 * The staging releases signed before the log rule (S1–S8 published, S9 a
 * candidate when it was written) carry their GitHub release URL as `notes`.
 * The validation accepts that URL for them, and only for them, so that the
 * manifests already signed stay renders of the file; `vault:manifest sign`
 * refuses it (notesToSwitch), so the next staging signing switches all of
 * them to their log URLs at once (VAULT-RELEASES §7 "Backfill").
 */
export const LEGACY_STAGING_NOTES_THROUGH = 9;
export const legacyStagingNotes = (n: number) => `https://github.com/vettid/vettid-vault/releases/tag/release/staging/${n}`;

/** The release log text limits (VAULT-RELEASES §7 "Text limits"). */
export const LOG_LIMITS = { summary: 160, changes: 20, change: 280, securityText: 1000 } as const;

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);
const PCR = HEX(96);
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** Characters the manifest renderers agree on byte for byte (Go's encoder and JSON.stringify). */
const PRINTABLE = /^[\x20-\x7e]*$/;

export const isTime = (s: unknown): s is string => {
  if (typeof s !== 'string' || !TIME.test(s)) return false;
  const t = new Date(s);
  return !Number.isNaN(t.getTime()) && t.toISOString().replace('.000Z', 'Z') === s;
};

const isPcr = (s: unknown): s is string => typeof s === 'string' && PCR.test(s) && !/^0+$/.test(s);

const sealKeyRe = (account: string) => new RegExp(`^arn:aws:kms:us-east-1:${account}:key/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`);

/**
 * Checks a release file against the plan's rules. `account` is the
 * channel's vault account (every seal key must be there, §3.1).
 */
export function validateReleaseFile(raw: unknown, channel: Channel, account: string): ReleaseFile {
  const bad = (what: string): never => {
    throw new Error(`vault/releases/${channel}.json: ${what}`);
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('not an object');
  const f = raw as Record<string, unknown>;
  if (f.channel !== channel) bad(`channel must be "${channel}"`);
  if (!Number.isSafeInteger(f.signed_serial) || (f.signed_serial as number) < 0) bad('signed_serial must be a non-negative integer');
  if (!Array.isArray(f.releases)) bad('releases must be an array');
  const entries = f.releases as Record<string, unknown>[];
  const pcr0s = new Map<string, number>();
  let last = 0;
  for (const e of entries) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) bad('entry is not an object');
    const n = e.release as number;
    const at = (what: string) => bad(`release ${n}: ${what}`);
    if (!Number.isSafeInteger(n) || n < 1 || n > 9999) bad('release must be 1..9999');
    if (n <= last) bad('releases must be sorted by release number, each listed once');
    last = n;
    if (!LIST_STATUSES.includes(e.status as ListStatus)) at(`unknown status ${JSON.stringify(e.status)}`);
    for (const k of ['pcr0', 'pcr1', 'pcr2']) if (!isPcr(e[k])) at(`${k} must be 96 lowercase hex, not a debug PCR`);
    if (pcr0s.has(e.pcr0 as string)) at('PCR0 already used by another release');
    const candidate = e.status === 'candidate';
    if (typeof e.seal_key !== 'string') at('seal_key must be a string');
    if (!(candidate && e.seal_key === '') && !sealKeyRe(account).test(e.seal_key as string)) {
      at(`seal_key must be a KMS key ARN in us-east-1 of account ${account}${candidate ? ' (or empty before the key exists)' : ''}`);
    }
    if (!Array.isArray(e.admitted_pcr0s)) at('admitted_pcr0s must be an array');
    const admitted = e.admitted_pcr0s as unknown[];
    if (new Set(admitted).size !== admitted.length) at('admitted_pcr0s must be distinct');
    for (const a of admitted) {
      if (typeof a !== 'string' || !pcr0s.has(a)) at('admitted_pcr0s may only name earlier releases that are still listed (§7: every PCR0 a live key admits is listed)');
    }
    if (e.published_at !== undefined && !isTime(e.published_at)) at('published_at must be RFC 3339 in whole seconds UTC');
    if (!candidate && e.published_at === undefined) at('published_at is required once the release is in a manifest');
    if (e.ends_at !== undefined) {
      if (!isTime(e.ends_at)) at('ends_at must be RFC 3339 in whole seconds UTC');
      if (e.status === 'active' || candidate) at('ends_at is set only on deprecated, retired and removed releases (§11.10.1)');
      if (e.published_at !== undefined && (e.ends_at as string) <= (e.published_at as string)) at('ends_at must be after published_at');
    }
    if (e.status === 'retired' && e.ends_at === undefined) at('a retired release needs its ends_at (§3.5)');
    if (e.status === 'removed' && e.host) at('a removed release has no release stack (§10.3 step 2: delete it, then drop host)');
    if (typeof e.notes !== 'string' || !/^https:\/\/[^\s/@]+\/\S*$/.test(e.notes) || e.notes.length > 1024) at('notes must be an https URL');
    const legacy = channel === 'staging' && n <= LEGACY_STAGING_NOTES_THROUGH && e.notes === legacyStagingNotes(n);
    if (e.notes !== releaseLogUrl(channel, n) && !legacy) at(`notes must be ${releaseLogUrl(channel, n)} (its release log entry)`);
    for (const k of ['pcr0', 'pcr1', 'pcr2', 'seal_key', 'published_at', 'ends_at', 'notes']) {
      if (e[k] !== undefined && !PRINTABLE.test(e[k] as string)) at(`${k} must be printable ASCII`);
    }
    if (e.log !== undefined) validateLog(e.log, at);
    else if (!candidate) at('log is required once the release leaves candidate (its release log entry, RELEASE-UPDATES §5)');
    pcr0s.set(e.pcr0 as string, n);
  }
  const file = raw as ReleaseFile;
  validateReleaseList(hostSpecs(file), channel);
  return file;
}

/** Control characters (including line breaks) and markup, which the app would show as written. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const MARKUP = /[<>`]|\*\*|\]\(|:\/\//;

/** Problems with one plain-text log string, or null. */
export function plainTextProblem(s: unknown, max: number): string | null {
  if (typeof s !== 'string' || !s.trim()) return 'must be non-empty text';
  if (s !== s.trim()) return 'must not start or end with spaces';
  if ([...s].length > max) return `must be at most ${max} characters (it has ${[...s].length})`;
  if (CONTROL.test(s)) return 'must be one line of plain text (no control characters)';
  if (MARKUP.test(s)) return 'must be plain text: no markup, code quotes or links (<, >, `, **, ](, ://)';
  return null;
}

function validateLog(raw: unknown, at: (what: string) => never): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) at('log must be an object');
  const l = raw as Record<string, unknown>;
  const text = (what: string, v: unknown, max: number) => {
    const p = plainTextProblem(v, max);
    if (p) at(`${what} ${p}`);
  };
  text('log.summary', l.summary, LOG_LIMITS.summary);
  if (!Array.isArray(l.changes) || l.changes.length < 1 || l.changes.length > LOG_LIMITS.changes) at(`log.changes must list 1 to ${LOG_LIMITS.changes} changes`);
  (l.changes as unknown[]).forEach((c, i) => text(`log.changes[${i}]`, c, LOG_LIMITS.change));
  if (!SECURITY_LEVELS.includes(l.security as SecurityLevel)) at(`log.security must be one of ${SECURITY_LEVELS.join(', ')}`);
  if (l.security !== 'none' || l.security_text !== undefined) text('log.security_text', l.security_text, LOG_LIMITS.securityText);
  if (l.affects !== undefined && (!Array.isArray(l.affects) || l.affects.some((n) => !Number.isSafeInteger(n) || n < 1))) at('log.affects must list release numbers');
}

/**
 * Entries whose `notes` is not yet their log URL (the legacy staging ones).
 * `vault:manifest sign` refuses to sign while any is left: the first
 * staging signing after the log rule switches them all
 * (`vault:manifest notes --channel staging`).
 */
export function notesToSwitch(file: ReleaseFile): number[] {
  return file.releases.filter((e) => e.notes !== releaseLogUrl(file.channel, e.release)).map((e) => e.release);
}

export function readReleaseFile(root: string, channel: Channel, account: string): ReleaseFile {
  return validateReleaseFile(JSON.parse(readFileSync(releaseFilePath(root, channel), 'utf8')), channel, account);
}

/** The release stacks (entries with a `host`). */
export function hostSpecs(file: ReleaseFile): VaultReleaseSpec[] {
  return file.releases
    .filter((e) => e.host)
    .map((e) => {
      const h = e.host!;
      return {
        release: e.release,
        channel: file.channel,
        tag: h.tag,
        sourceCommit: h.source_commit,
        pcr0: e.pcr0,
        measurementsSha256: h.measurements_sha256,
        hostFilesSha256: h.host_files_sha256,
        nitroCliVersion: h.nitro_cli_version,
        baseAmi: h.base_ami,
        amiRevision: h.ami_revision,
        minInstances: h.min_instances,
        maxInstances: h.max_instances,
      };
    });
}

/**
 * The release keys (§6.2): one per listed release. A key's inputs never
 * change (the custom resource refuses an update); dropping a release from
 * the list leaves its key alone.
 */
export function keySpecs(file: ReleaseFile): ReleaseKeySpec[] {
  return file.releases.map((e) => ({ release: e.release, pcr0: e.pcr0, admittedPcr0s: [...e.admitted_pcr0s] }));
}

// ---- manifest bytes (VAULT-MESSAGING §11.10.1) --------------------------------------

export interface ManifestEntry {
  release: number;
  pcr0: string;
  pcr1: string;
  pcr2: string;
  seal_key: string;
  status: ManifestStatus;
  published_at: string;
  ends_at?: string;
  notes: string;
}

/** The entries a manifest of this list carries: every non-candidate, in release order. */
export function manifestEntries(file: ReleaseFile): ManifestEntry[] {
  return file.releases
    .filter((e) => e.status !== 'candidate')
    .map((e) => ({
      release: e.release,
      pcr0: e.pcr0,
      pcr1: e.pcr1,
      pcr2: e.pcr2,
      seal_key: e.seal_key,
      status: e.status as ManifestStatus,
      published_at: e.published_at!,
      ...(e.ends_at ? { ends_at: e.ends_at } : {}),
      notes: e.notes,
    }));
}

/**
 * Canonical manifest bytes: compact JSON in the §11.10.1 member order,
 * entries sorted by release, the same bytes as vettid-vault's
 * manifest.Build (checked against its vectors). Strings are printable
 * ASCII (validated), where JSON.stringify and Go's encoder agree.
 */
export function renderManifest(serial: number, issuedAt: string, entries: readonly ManifestEntry[]): Buffer {
  if (!Number.isSafeInteger(serial) || serial < 1) throw new Error('serial must be at least 1');
  if (!isTime(issuedAt)) throw new Error('issued_at must be RFC 3339 in whole seconds UTC');
  if (entries.length === 0) throw new Error('no release to list');
  const q = (s: string) => {
    if (!PRINTABLE.test(s)) throw new Error('manifest strings must be printable ASCII');
    return JSON.stringify(s);
  };
  const rs = [...entries].sort((a, b) => a.release - b.release).map((r) =>
    `{"release":${r.release},"pcr0":${q(r.pcr0)},"pcr1":${q(r.pcr1)},"pcr2":${q(r.pcr2)},"seal_key":${q(r.seal_key)},` +
    `"status":${q(r.status)},"published_at":${q(r.published_at)}${r.ends_at ? `,"ends_at":${q(r.ends_at)}` : ''},"notes":${q(r.notes)}}`,
  );
  return Buffer.from(`{"v":1,"serial":${serial},"issued_at":${q(issuedAt)},"releases":[${rs.join(',')}]}`, 'utf8');
}

export const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** The successor rules (as vaultctl's CheckSuccessor) plus the strict serial rule and the notes rule of §7. */
export function successorProblems(
  prev: { serial: number; releases: readonly ManifestEntry[] },
  next: { serial: number; releases: readonly ManifestEntry[] },
): string[] {
  const out: string[] = [];
  if (next.serial <= prev.serial) out.push(`serial ${next.serial} is not above the previous ${prev.serial}`);
  const rank: Record<string, number> = { active: 0, deprecated: 1, retired: 2, removed: 3 };
  for (const p of prev.releases) {
    const n = next.releases.find((r) => r.release === p.release);
    if (!n) {
      if (p.status !== 'removed') out.push(`release ${p.release} (${p.status}) is dropped before it is removed`);
      continue;
    }
    if (n.pcr0 !== p.pcr0 || n.pcr1 !== p.pcr1 || n.pcr2 !== p.pcr2 || n.seal_key !== p.seal_key) out.push(`release ${p.release}'s PCRs or seal_key changed`);
    if (rank[n.status] < rank[p.status]) out.push(`release ${p.release} goes back from ${p.status} to ${n.status}`);
    if (n.published_at !== p.published_at) out.push(`release ${p.release}'s published_at changed`);
    // Once a release's notes is its log entry it never changes (§7); before, they were not compared (the staging backfill).
    if (isReleaseLogUrl(p.notes, p.release) && n.notes !== p.notes) out.push(`release ${p.release}'s notes changed from its release log entry ${p.notes}`);
  }
  return out;
}

/**
 * Consistency of statuses and dates within one manifest (§3.2, §3.5,
 * §11.10.1), beyond what the parser checks. `now` is the time the check
 * runs (the CI commit), so a deadline that has passed must show `removed`
 * only once the operator has acted; the check flags what is overdue.
 */
export function consistencyProblems(entries: readonly ManifestEntry[], issuedAt: string): string[] {
  const out: string[] = [];
  const active = entries.filter((e) => e.status === 'active');
  if (active.length === 0 && entries.some((e) => e.status !== 'removed')) out.push('no active release, but releases still run (nothing to move to)');
  const newestActive = active.length ? Math.max(...active.map((e) => e.release)) : 0;
  for (const e of entries) {
    if (e.published_at > issuedAt) out.push(`release ${e.release}: published_at is after the manifest's issued_at`);
    if (e.status === 'active' && e.ends_at) out.push(`release ${e.release}: an active release has no end date`);
    if (e.status === 'retired' && !e.ends_at) out.push(`release ${e.release}: retired without ends_at`);
    if ((e.status === 'deprecated' || e.status === 'retired') && e.release > newestActive) {
      out.push(`release ${e.release}: ${e.status}, but no newer active release replaces it`);
    }
    if (e.ends_at && (e.status === 'deprecated' || e.status === 'retired') && e.ends_at <= issuedAt) {
      out.push(`release ${e.release}: its ends_at ${e.ends_at} has passed, so it must be removed (§10.3 step 2)`);
    }
    if (e.ends_at && e.status === 'deprecated') {
      // The final notice period: retired at least 90 days before the end.
      const ninety = new Date(Date.parse(e.ends_at) - 90 * 86_400_000).toISOString().replace('.000Z', 'Z');
      if (issuedAt >= ninety) out.push(`release ${e.release}: within 90 days of its ends_at but still deprecated (set retired, §3.5)`);
    }
  }
  return out;
}
