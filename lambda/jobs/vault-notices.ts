/**
 * Daily vault release notices (VAULT-RELEASES §3.5, §10.2, §10.3;
 * RELEASE-UPDATES §3; docs/MEMBER-API.md "Vault release notices").
 *
 * Members whose vault is sealed to a release that is ending are emailed:
 *
 *  - `ends_90`, `ends_30`, `ends_7`, `ends_1`: 90, 30, 7 and 1 days before
 *    the release's `ends_at`, while it is `deprecated` or `retired`. A run
 *    sends only the latest milestone that is due (a missed day does not
 *    send a stale "90 days" next to the "30 days").
 *  - `ended`: once the release is `removed` (not reopened for a rescue), up
 *    to 14 days after `ends_at`: the release has ended; how to ask for a
 *    rescue in the 30-day window.
 *  - `urgent_<U>`: a security release U marked `urgent` in the published
 *    release log (`/security/releases/index.json`, generated from the signed
 *    manifest and vault/releases/<channel>.json), in its first 30 days, to
 *    members on the releases it lists as affected (§10.2).
 *
 * Every email links release notes (RELEASE-UPDATES §3, VAULT-RELEASES §3.5):
 * the ending and ended emails link the ending release's entry and the
 * entry and one-line summary of the newest `active` release (the one the
 * app offers); the urgent email links the security release's entry with
 * its summary and what it fixes. The links are the releases' `notes` as
 * the stage's own log lists them (`RELEASE_LOG_URL`, the log on the site
 * that serves the stage's manifest), else `RELEASE_LOG_URL<n>/`; a summary
 * the log cannot give is left out, never the link.
 *
 * Who: the vaults whose `sealed_release` is the release, through the vaults
 * table's `sealed-release-index` (vault_id, user_guid and state only).
 * `sealed_release` is written by the host and advisory, which is fine for
 * notices (§3.5). Deleted vaults are skipped.
 *
 * Each (member, release, end date, milestone) is mailed at most once: a
 * conditional put of a marker in the ratelimits table claims it (it
 * expires 60 days after the end date); a failed send releases the claim,
 * so the next day's run retries. The apps show the same information at
 * every unlock from the manifest itself (VAULT-MESSAGING §11.10.6), and
 * GET /api/vault/status carries it for the account site.
 *
 * Nothing here is a security decision: it reads the routing table and a
 * public page, and sends system email (SES; members are verified
 * identities, so the sandbox is fine).
 */
import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { ddb, env, table } from '../shared/aws';
import { sendMail } from '../shared/mail';
import { memberByGuid } from '../shared/members';
import type { MemberItem } from '../shared/model';

const DAY_MS = 86_400_000;
/** The milestones before `ends_at`, in days (RELEASE-UPDATES §3: 90, 30, 7 and 1). */
export const MILESTONE_DAYS = [90, 30, 7, 1] as const;
/** How long after `ends_at` the `ended` email may still go out. */
export const ENDED_GRACE_DAYS = 14;
/** How long after its publication an urgent security release is announced. */
export const URGENT_DAYS = 30;
const PCR0_RE = /^[0-9a-f]{96}$/;
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export interface NoticeRelease {
  release: string; // PCR0
  release_number: number;
  status: string;
  ends_at?: string;
  rescue?: boolean;
}

export type Milestone = `ends_${(typeof MILESTONE_DAYS)[number]}` | 'ended';

/** The notice due for a release now, if any (pure). */
export function dueMilestone(r: NoticeRelease, now: number): Milestone | null {
  if (typeof r.ends_at !== 'string' || !TIME_RE.test(r.ends_at)) return null;
  const end = Date.parse(r.ends_at);
  if (!Number.isFinite(end)) return null;
  if (now < end) {
    if (r.status !== 'deprecated' && r.status !== 'retired') return null;
    const daysLeft = Math.ceil((end - now) / DAY_MS);
    const due = [...MILESTONE_DAYS].reverse().find((d) => daysLeft <= d);
    return due === undefined ? null : `ends_${due}`;
  }
  if (r.status === 'removed' && r.rescue !== true && now - end <= ENDED_GRACE_DAYS * DAY_MS) return 'ended';
  return null;
}

/** An entry of the published release log's index.json (lib/vault/release-log.ts). */
export interface LogEntry {
  release: number;
  status: string;
  published_at: string;
  listed: boolean;
  notes?: string;
  summary?: string;
  security?: string;
  security_text?: string;
  affects?: number[];
}

type Log = { releases?: unknown } | null;

const logEntry = (log: Log, n: number): Partial<LogEntry> | undefined =>
  Array.isArray(log?.releases) ? (log!.releases as Partial<LogEntry>[]).find((e) => e && typeof e === 'object' && e.release === n) : undefined;

/** Plain text from the log for an email: one line, no control characters, bounded. */
const plain = (s: unknown, max: number): string | undefined => {
  if (typeof s !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
  if (!t) return undefined;
  return [...t].length > max ? `${[...t].slice(0, max - 1).join('')}…` : t;
};

/** Release n's notes URL: its `notes` in the stage's log, else its entry there (pure). */
export function notesUrl(log: Log, n: number): string {
  const notes = logEntry(log, n)?.notes;
  return typeof notes === 'string' && /^https:\/\/[^\s/@]+\/\S*$/.test(notes) && notes.length <= 1024 ? notes : logUrl(n);
}

/** What an email says about a release: number, notes link and (when the log has it) its one-line summary (pure). */
export interface ReleaseRef {
  n: number;
  url: string;
  summary?: string;
}

export function releaseRef(log: Log, n: number): ReleaseRef {
  const summary = plain(logEntry(log, n)?.summary, 160);
  return { n, url: notesUrl(log, n), ...(summary ? { summary } : {}) };
}

/** The urgent security releases to announce now (pure). */
export function urgentReleases(log: { releases?: unknown } | null, now: number): LogEntry[] {
  const list = Array.isArray(log?.releases) ? (log!.releases as LogEntry[]) : [];
  return list.filter(
    (e) =>
      e &&
      e.security === 'urgent' &&
      e.listed === true &&
      Number.isSafeInteger(e.release) &&
      Array.isArray(e.affects) &&
      typeof e.published_at === 'string' &&
      Date.parse(e.published_at) <= now &&
      now - Date.parse(e.published_at) <= URGENT_DAYS * DAY_MS,
  );
}

const day = (iso: string) => iso.slice(0, 10);
const logUrl = (n: number) => `${env('RELEASE_LOG_URL')}${n}/`;
const FOOTER = `VettID never asks for your PIN or password by email.

— VettID
`;

/** The newest release's paragraph in the ending and ended emails: what the app offers. */
const newestText = (newest: ReleaseRef | undefined, n: number, which: string) =>
  newest && newest.n > n
    ? `The newest release, ${which}, is release ${newest.n}.${newest.summary ? ` ${newest.summary}` : ''}
What's new in release ${newest.n}: ${newest.url}

`
    : '';

export function endingMail(ending: ReleaseRef, endsAt: string, milestone: Exclude<Milestone, 'ended'>, newest?: ReleaseRef): { subject: string; text: string } {
  const n = ending.n;
  const days = Number(milestone.slice(5));
  return {
    subject: days === 1 ? `Last day: your VettID vault's software ends on ${day(endsAt)}` : `Action needed: your VettID vault's software ends on ${day(endsAt)}`,
    text: `Your VettID vault still runs on release ${n} of the vault software. That release ends on ${day(endsAt)} (${days === 1 ? 'tomorrow' : `in ${days} days`}).

After that date your vault can no longer be opened in release ${n}. A vault that has not moved to a newer release by then is lost, and you would have to enroll a new vault.

Moving takes one step: open the VettID app, unlock your vault with your PIN, and approve the update when the app offers it. Nothing else changes: your data stays encrypted, and nobody, including VettID, can open your vault or move it without you.

${newestText(newest, n, 'which the app offers you')}Release ${n} (the one that is ending): ${ending.url}
All releases: ${env('RELEASE_LOG_URL')}

${FOOTER}`,
  };
}

export function endedMail(ending: ReleaseRef, endsAt: string, newest?: ReleaseRef): { subject: string; text: string } {
  const n = ending.n;
  return {
    subject: `Your VettID vault's software release ${n} has ended`,
    text: `Release ${n} of the vault software, which your VettID vault is still sealed to, ended on ${day(endsAt)}. Your vault can no longer be opened.

For 30 days after that date VettID can restart release ${n} once, so that you can move your vault to a newer release. If you want that, write to support@vettid.org now. After those 30 days the release's key is deleted and the vault can never be opened again, by anyone; its stored data is then erased, and you can enroll a new vault.

${newestText(newest, n, 'which a restarted vault moves to')}Release ${n} (the one that ended): ${ending.url}
All releases: ${env('RELEASE_LOG_URL')}

${FOOTER}`,
  };
}

export function urgentMail(u: LogEntry, affected: number, ref: ReleaseRef = { n: u.release, url: logUrl(u.release) }): { subject: string; text: string } {
  const fixes = plain(u.security_text, 1000);
  return {
    subject: 'Security update for your VettID vault',
    text: `Release ${u.release} of the vault software fixes a security problem in release ${affected}, which your VettID vault runs on.${ref.summary ? `\n\n${ref.summary}` : ''}${fixes ? `\n\nWhat it fixes: ${fixes}` : ''}

VettID cannot update your vault for you. Open the VettID app, unlock your vault with your PIN, and approve the update to release ${u.release} when the app offers it.

What's new in release ${u.release}: ${ref.url}

${FOOTER}`,
  };
}

async function releasesWithStatus(status: string): Promise<NoticeRelease[]> {
  const out: NoticeRelease[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: table.vaultReleases(),
        IndexName: 'status-index',
        KeyConditionExpression: '#s = :s',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': status },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...((r.Items ?? []) as NoticeRelease[]).filter((x) => PCR0_RE.test(x.release) && Number.isSafeInteger(x.release_number)));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/** Members (user_guid) with a live vault sealed to `pcr0`. */
async function sealedMembers(pcr0: string): Promise<string[]> {
  const out = new Set<string>();
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: table.vaults(),
        IndexName: 'sealed-release-index',
        KeyConditionExpression: 'sealed_release = :r',
        ExpressionAttributeValues: { ':r': pcr0 },
        ExclusiveStartKey: start,
      }),
    );
    for (const v of (r.Items ?? []) as { user_guid?: unknown; state?: unknown }[]) {
      if (typeof v.user_guid === 'string' && v.user_guid && v.state !== 'deleted') out.add(v.user_guid);
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return [...out];
}

/** Claim a notice; false if it was already sent (or is being sent). */
async function claim(key: string, expiresAt: number): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: table.ratelimits(),
        Item: { key, expires_at: expiresAt, at: new Date().toISOString() },
        ConditionExpression: 'attribute_not_exists(#k)',
        ExpressionAttributeNames: { '#k': 'key' },
      }),
    );
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

async function release(key: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: table.ratelimits(), Key: { key } }));
}

const mailable = (m: MemberItem | null): m is MemberItem => !!m && typeof m.email === 'string' && !!m.email && m.state !== 'rejected';

interface Counts {
  sent: number;
  skipped: number;
  failed: number;
}

async function notify(
  guids: string[],
  noticeKey: (guid: string) => string,
  expiresAt: number,
  mail: { subject: string; text: string },
  detail: Record<string, unknown>,
  counts: Counts,
): Promise<void> {
  for (const guid of guids) {
    const key = noticeKey(guid);
    if (!(await claim(key, expiresAt))) {
      counts.skipped++;
      continue;
    }
    const m = await memberByGuid(guid);
    if (!mailable(m)) {
      counts.skipped++; // the claim stays: nobody to tell
      continue;
    }
    try {
      await sendMail(m.email, mail.subject, mail.text);
    } catch (e) {
      counts.failed++;
      console.error('vault notice mail failed', JSON.stringify({ ...detail, error: (e as Error).name }));
      await release(key);
      continue;
    }
    counts.sent++;
    await audit('system', 'vault.release_notice', guid, detail);
  }
}

async function fetchLog(): Promise<Log> {
  try {
    const r = await fetch(`${env('RELEASE_LOG_URL')}index.json`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as { releases?: unknown };
  } catch (e) {
    // Urgent-release emails wait for the next run; the deadline notices go on, with links but no summaries.
    console.error('release log fetch failed', JSON.stringify({ error: (e as Error).message }));
    return null;
  }
}

export async function handler(): Promise<Counts> {
  const now = Date.now();
  const counts: Counts = { sent: 0, skipped: 0, failed: 0 };
  const [active, ...ending] = await Promise.all(['active', 'deprecated', 'retired', 'removed'].map(releasesWithStatus));
  const rows = ending.flat();
  const log = await fetchLog();
  // The newest active release: the one the app offers (VAULT-RELEASES §3.5).
  const newestN = active.length ? Math.max(...active.map((r) => r.release_number)) : 0;
  const newest = newestN ? releaseRef(log, newestN) : undefined;

  for (const r of rows) {
    const milestone = dueMilestone(r, now);
    if (!milestone) continue;
    const guids = await sealedMembers(r.release);
    if (!guids.length) continue;
    const ref = releaseRef(log, r.release_number);
    const mail = milestone === 'ended' ? endedMail(ref, r.ends_at!, newest) : endingMail(ref, r.ends_at!, milestone, newest);
    const expiresAt = Math.floor(Date.parse(r.ends_at!) / 1000) + 60 * 86_400;
    await notify(guids, (g) => `vault-notice#${r.release_number}#${r.release.slice(0, 16)}#${r.ends_at}#${milestone}#${g}`, expiresAt, mail,
      { release_number: r.release_number, milestone, ends_at: r.ends_at }, counts);
  }

  const urgent = urgentReleases(log, now);
  for (const u of urgent) {
    for (const a of u.affects ?? []) {
      // Only releases that still run: deprecated or retired (not removed).
      const row = rows.find((x) => x.release_number === a && (x.status === 'deprecated' || x.status === 'retired'));
      if (!row) continue;
      const guids = await sealedMembers(row.release);
      const expiresAt = Math.floor(Date.parse(u.published_at) / 1000) + (URGENT_DAYS + 60) * 86_400;
      await notify(guids, (g) => `vault-notice#urgent#${u.release}#${g}`, expiresAt, urgentMail(u, a, releaseRef(log, u.release)),
        { release_number: a, milestone: `urgent_${u.release}` }, counts);
    }
  }
  console.log(JSON.stringify({ msg: 'vault notices', ...counts }));
  return counts;
}
