/**
 * The public release log (RELEASE-UPDATES §5, VAULT-RELEASES §7):
 * `/security/releases/` on vettid.org, one page per production release,
 * generated from the signed manifest (the authority for numbers, PCRs,
 * statuses and dates) and `vault/releases/prod.json` (tag, commit and the
 * log text), so the log cannot disagree with the manifest.
 *
 * `website/security/releases/index.json` is both the machine-readable log
 * and its memory: a release the manifest has dropped (removed, and no live
 * key admits it, §10.3 step 5) keeps its last entry there and its page
 * stays (RELEASE-UPDATES §5: an entry stays after its release has ended).
 * The vault notice job reads it for urgent security releases (W8).
 *
 * Pure: inputs in, files out (scripts/vault/release-log.ts writes or checks
 * them). The shared navigation inside the pages is filled in by
 * scripts/sync-nav.mjs; comparisons ignore it.
 */
import type { ReleaseFile, SecurityLevel } from './release-list';

export interface LogManifest {
  serial: number;
  releases: { release: number; pcr0: string; pcr1: string; pcr2: string; seal_key: string; status: string; published_at: string; ends_at?: string; notes: string }[];
}

export interface LogEntry {
  release: number;
  status: string;
  published_at: string;
  ends_at?: string;
  pcr0: string;
  pcr1: string;
  pcr2: string;
  seal_key: string;
  notes: string;
  tag?: string;
  source_commit?: string;
  summary: string;
  changes: string[];
  security: SecurityLevel;
  security_text?: string;
  affects?: number[];
  /** false once the manifest no longer lists the release. */
  listed: boolean;
}

export interface LogIndex {
  /** The manifest serial the log was generated from (0: none published). */
  serial: number;
  releases: LogEntry[];
}

export const EMPTY_INDEX: LogIndex = { serial: 0, releases: [] };

/** Merges the manifest and the release file into the previous index. */
export function buildIndex(prev: LogIndex, manifest: LogManifest | null, file: ReleaseFile): LogIndex {
  if (!manifest) {
    if (prev.releases.length) throw new Error('the release log lists releases, but no manifest is published');
    return EMPTY_INDEX;
  }
  if (manifest.serial < prev.serial) throw new Error(`the manifest serial ${manifest.serial} is below the log's ${prev.serial}`);
  const byNumber = new Map(prev.releases.map((r) => [r.release, r]));
  for (const m of manifest.releases) {
    const e = file.releases.find((x) => x.release === m.release);
    if (!e || e.pcr0 !== m.pcr0) throw new Error(`release ${m.release} is in the manifest but not (with that PCR0) in vault/releases/prod.json`);
    if (!e.log) throw new Error(`release ${m.release} has no log text in vault/releases/prod.json`);
    const old = byNumber.get(m.release);
    if (old && old.pcr0 !== m.pcr0) throw new Error(`release ${m.release}: the log has another PCR0`);
    byNumber.set(m.release, {
      release: m.release,
      status: m.status,
      published_at: m.published_at,
      ...(m.ends_at ? { ends_at: m.ends_at } : {}),
      pcr0: m.pcr0,
      pcr1: m.pcr1,
      pcr2: m.pcr2,
      seal_key: m.seal_key,
      notes: m.notes,
      ...(e.host ? { tag: e.host.tag, source_commit: e.host.source_commit } : old?.tag ? { tag: old.tag, source_commit: old.source_commit } : {}),
      summary: e.log.summary,
      changes: [...e.log.changes],
      security: e.log.security,
      ...(e.log.security_text ? { security_text: e.log.security_text } : {}),
      ...(e.log.affects ? { affects: [...e.log.affects] } : {}),
      listed: true,
    });
  }
  const listed = new Set(manifest.releases.map((r) => r.release));
  for (const [n, r] of byNumber) {
    if (!listed.has(n)) {
      if (r.listed && r.status !== 'removed') throw new Error(`release ${n} left the manifest while ${r.status}`);
      byNumber.set(n, { ...r, listed: false });
    }
  }
  return { serial: manifest.serial, releases: [...byNumber.values()].sort((a, b) => b.release - a.release) };
}

// ---- HTML ------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (t: string) => t.slice(0, 10);

const STATUS_TEXT: Record<string, string> = {
  active: 'Active',
  deprecated: 'Deprecated (move-only)',
  retired: 'Retired (final notice)',
  removed: 'Ended',
};
const SECURITY_TEXT: Record<SecurityLevel, string> = {
  none: 'No security fix',
  recommended: 'Security fix: update recommended',
  urgent: 'Security fix: update urgently',
};

const NAV_BLOCKS = `<!-- nav:header -->
<!-- /nav:header -->
<!-- nav:menu -->
<!-- /nav:menu -->`;
const NAV_FOOTER = `<!-- nav:footer -->
<!-- /nav:footer -->`;

const CSS = `
    .wrap { max-width: 880px; margin: 0 auto; padding: 120px 24px 80px; }
    .hero { margin-bottom: 40px; }
    .hero-badge {
      display: inline-block; padding: 6px 12px; background: var(--gold-wash); color: var(--accent);
      border: 1px solid var(--border); border-radius: 16px; font-size: 0.85rem; font-weight: 500; margin-bottom: 16px;
    }
    h1 { font-size: 2.4rem; margin-bottom: 12px; color: var(--ink-hi); }
    .subtitle { font-size: 1.1rem; color: var(--text-muted); }
    section { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 28px 32px; margin-bottom: 24px; }
    section h2 { font-size: 1.35rem; margin-bottom: 12px; color: var(--accent); }
    section h3 { font-size: 1.05rem; margin: 20px 0 8px; color: var(--text); }
    section p { color: var(--text-muted); margin-bottom: 12px; }
    section ul { color: var(--text-muted); padding-left: 22px; margin-bottom: 12px; }
    section ul li { margin-bottom: 6px; }
    section a { color: var(--accent); text-decoration: none; }
    section a:hover { color: var(--accent-hover); }
    code, .mono { font-family: var(--font-mono); font-size: 0.85rem; color: var(--text); word-break: break-all; }
    pre { background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; overflow-x: auto;
      font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px; white-space: pre; }
    .table-scroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th { text-align: left; color: var(--text-subtle); font-weight: 500; font-size: 0.75rem; text-transform: uppercase;
      letter-spacing: 0.06em; padding: 8px 10px; border-bottom: 1px solid var(--border); }
    td { color: var(--text); padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .status { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.8rem; border: 1px solid var(--border); white-space: nowrap; }
    .status-active { color: var(--success); }
    .status-deprecated, .status-retired { color: var(--warn); }
    .status-removed { color: var(--text-subtle); }
    dl.fields { display: grid; grid-template-columns: max-content 1fr; gap: 10px 20px; }
    dl.fields dt { color: var(--text-subtle); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; padding-top: 2px; }
    dl.fields dd { color: var(--text); }
    .security-urgent { color: var(--error); }
    .security-recommended { color: var(--warn); }
    @media (max-width: 600px) {
      section { padding: 22px 18px; }
      dl.fields { grid-template-columns: 1fr; gap: 4px; }
      dl.fields dd { margin-bottom: 10px; }
    }
`;

function page(opts: { path: string; title: string; description: string; body: string }): string {
  const url = `https://vettid.org${opts.path}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(opts.title)} — VettID</title>
  <meta name="description" content="${esc(opts.description)}" />
  <link rel="canonical" href="${url}"/>
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
<link rel="icon" type="image/png" href="/assets/favicon.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>
<link rel="manifest" href="/manifest.json"/>
<meta name="theme-color" content="#0b0b12"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="VettID"/>
<meta property="og:title" content="${esc(opts.title)} — VettID"/>
<meta property="og:description" content="${esc(opts.description)}"/>
<meta property="og:url" content="${url}"/>
<meta property="og:image" content="https://vettid.org/assets/og.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="VettID tower mark. Secure. Private. Trusted. You hold your keys. Not us."/>
<meta name="twitter:card" content="summary_large_image"/>
  <link rel="preload" href="/assets/fonts/inter-regular.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/plusjakartasans-bold.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/fonts.css" />
  <link rel="stylesheet" href="/shared/nav.css" />
  <link rel="stylesheet" href="/assets/site.css">
  <style>${CSS}</style>
</head>
<body>
<!-- Generated by scripts/vault/release-log.ts from the signed manifest and vault/releases/prod.json. Do not edit. -->

${NAV_BLOCKS}

<div class="wrap">
${opts.body}
</div>

<footer>
  <div class="battlement-mini"></div>
${NAV_FOOTER}
  <p>&copy; 2026 The VettID Project. All rights reserved.</p>
  <p class="footer-privacy">No trackers, no analytics, no third-party resources &mdash; this site loads nothing from anyone but us.</p>
</footer>
<script src="/shared/js/nav.js"></script>
</body>
</html>
`;
}

const status = (s: string) => `<span class="status status-${esc(s)}">${esc(STATUS_TEXT[s] ?? s)}</span>`;
const short = (pcr: string) => `${pcr.slice(0, 16)}…`;

const ABOUT = `  <section>
    <h2>How to check a release</h2>
    <p>VettID lists every vault release it runs in a signed manifest at <a href="https://vettid.org/.well-known/vettid/pcr-manifest.json"><code>/.well-known/vettid/pcr-manifest.json</code></a>. Your app verifies its signature with a key built into the app, and your vault only opens in the release you approved. This log is generated from that manifest, so the two cannot disagree; the manifest's history is public in the <a href="https://github.com/vettid/vettid.org/commits/master/website/.well-known/vettid/pcr-manifest.json">vettid.org repository</a>.</p>
    <p>Releases are built reproducibly from the public <a href="https://github.com/vettid/vettid-vault">vettid-vault</a> source. Anyone can rebuild a release from its tag and compare the measurement (PCR0) with the one listed here: <a href="https://github.com/vettid/vettid-vault/blob/main/docs/RELEASING.md#rebuild-and-match-anyone">how to rebuild and match</a>.</p>
    <p>What the statuses mean, and how long each release keeps running, is explained in <a href="https://github.com/vettid/vettid.org/blob/master/docs/RELEASE-UPDATES.md">Vault release updates</a>: a release is kept for at least 12 months after a newer one replaces it, the last 90 days with a final notice and emails, then it ends.</p>
  </section>`;

export function renderIndexPage(index: LogIndex): string {
  const rows = index.releases
    .map(
      (r) => `        <tr>
          <td><a href="/security/releases/${r.release}/">Release ${r.release}</a></td>
          <td>${day(r.published_at)}</td>
          <td>Production</td>
          <td><span class="mono" title="${esc(r.pcr0)}">${short(r.pcr0)}</span></td>
          <td>${status(r.status)}</td>
          <td>${r.ends_at ? day(r.ends_at) : '&mdash;'}</td>
        </tr>`,
    )
    .join('\n');
  const list = index.releases.length
    ? `  <section>
    <h2>Releases</h2>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Release</th><th>Published</th><th>Channel</th><th>PCR0</th><th>Status</th><th>End date</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
    <p>Generated from manifest serial ${index.serial}. Machine-readable: <a href="/security/releases/index.json"><code>index.json</code></a>.</p>
  </section>`
    : `  <section>
    <h2>Releases</h2>
    <p>No production release has been published yet. The first release appears here, and in the signed manifest, when the vault opens to members.</p>
  </section>`;
  return page({
    path: '/security/releases/',
    title: 'Vault release log',
    description: 'Every VettID vault release: its measurements, source, changes, security fixes, status and end date.',
    body: `  <div class="hero">
    <span class="hero-badge">Vault releases</span>
    <h1>Vault release log</h1>
    <p class="subtitle">Every vault release VettID runs: what it is, what changed, and how long it keeps running.</p>
  </div>

${list}

${ABOUT}`,
  });
}

export function renderReleasePage(r: LogEntry): string {
  const commit = r.source_commit
    ? `<a href="https://github.com/vettid/vettid-vault/tree/${esc(r.source_commit)}"><code>${esc(r.source_commit)}</code></a>`
    : '&mdash;';
  const tag = r.tag ? `<a href="https://github.com/vettid/vettid-vault/releases/tag/${esc(r.tag)}"><code>${esc(r.tag)}</code></a>` : '&mdash;';
  const statusLine =
    r.status === 'active'
      ? 'The current release. New vaults are enrolled into it, and the app offers it to everyone on an older release.'
      : r.status === 'deprecated'
        ? `Replaced by a newer release. It still unlocks and lets you move to the newer release, nothing more.${r.ends_at ? ` It ends on ${day(r.ends_at)}.` : ''}`
        : r.status === 'retired'
          ? `Final notice: this release ends on ${day(r.ends_at!)}. Approve the update in your app before then; a vault still on this release afterwards can no longer be opened.`
          : `This release has ended${r.ends_at ? ` (${day(r.ends_at)})` : ''}. Its sealing key is scheduled for deletion or deleted; a vault still sealed to it can no longer be opened.`;
  const rebuild = r.tag
    ? `<pre>git clone https://github.com/vettid/vettid-vault &amp;&amp; cd vettid-vault
git checkout ${esc(r.tag)}
gh release download ${esc(r.tag)} -p measurements.json -p vault-enclave.eif -D published
CHANNEL=prod release/rebuild.sh out published/measurements.json</pre>`
    : '';
  return page({
    path: `/security/releases/${r.release}/`,
    title: `Vault release ${r.release}`,
    description: `VettID vault release ${r.release}: measurements, source, changes, security and status.`,
    body: `  <div class="hero">
    <span class="hero-badge"><a href="/security/releases/">Vault release log</a></span>
    <h1>Vault release ${r.release}</h1>
    <p class="subtitle">${esc(r.summary)}</p>
  </div>

  <section>
    <h2>Status</h2>
    <dl class="fields">
      <dt>Status</dt><dd>${status(r.status)}</dd>
      <dt>Published</dt><dd>${day(r.published_at)}</dd>
      <dt>End date</dt><dd>${r.ends_at ? day(r.ends_at) : 'Not set (at least 12 months after a newer release replaces it)'}</dd>
    </dl>
    <p>${statusLine}</p>
  </section>

  <section>
    <h2>Changes</h2>
${r.changes.length ? `    <ul>\n${r.changes.map((c) => `      <li>${esc(c)}</li>`).join('\n')}\n    </ul>` : '    <p>No member-visible changes.</p>'}
    <h3>Security</h3>
    <p class="security-${esc(r.security)}">${esc(SECURITY_TEXT[r.security])}${r.affects?.length ? ` (affects release${r.affects.length > 1 ? 's' : ''} ${r.affects.join(', ')})` : ''}</p>
${r.security_text ? `    <p>${esc(r.security_text)}</p>\n` : ''}  </section>

  <section>
    <h2>Measurements</h2>
    <dl class="fields">
      <dt>PCR0</dt><dd><code>${esc(r.pcr0)}</code></dd>
      <dt>PCR1</dt><dd><code>${esc(r.pcr1)}</code></dd>
      <dt>PCR2</dt><dd><code>${esc(r.pcr2)}</code></dd>
      <dt>Sealing key</dt><dd><code>${esc(r.seal_key)}</code></dd>
    </dl>
  </section>

  <section>
    <h2>Source</h2>
    <dl class="fields">
      <dt>Tag</dt><dd>${tag}</dd>
      <dt>Commit</dt><dd>${commit}</dd>
    </dl>
    <p>Rebuild it on an arm64 Linux machine and compare the PCR0 with the one above (<a href="https://github.com/vettid/vettid-vault/blob/main/docs/RELEASING.md#rebuild-and-match-anyone">details</a>):</p>
${rebuild}  </section>`,
  });
}

/** Every generated file, by path relative to the repository root. */
export function renderLog(index: LogIndex): Map<string, string> {
  const out = new Map<string, string>();
  out.set('website/security/releases/index.html', renderIndexPage(index));
  out.set('website/security/releases/index.json', `${JSON.stringify(index, null, 2)}\n`);
  for (const r of index.releases) out.set(`website/security/releases/${r.release}/index.html`, renderReleasePage(r));
  return out;
}

/** The page without its generated navigation (scripts/sync-nav.mjs owns those blocks). */
export function withoutNav(html: string): string {
  return html.replace(/<!-- nav:(header|menu|footer)[^>]*-->[\s\S]*?<!-- \/nav:\1 -->/g, '<!-- nav:$1 -->');
}
