/**
 * The release logs (lib/vault/release-log.ts), one per channel, from the
 * channel's served manifest and vault/releases/<channel>.json:
 * production's under website/security/releases/ (https://vettid.org),
 * staging's under sites/staging/security/releases/ (https://staging.vettid.org,
 * served by VettidOrgStageSiteStack).
 *
 *   npx ts-node --transpile-only scripts/vault/release-log.ts [--channel prod|staging]           write the pages (production: then fill in the navigation)
 *   npx ts-node --transpile-only scripts/vault/release-log.ts [--channel prod|staging] --check   fail if a page or index.json is stale
 *
 * Without --channel, both channels. The publish step
 * (scripts/vault/manifest.ts publish) runs it for its channel;
 * check:manifest runs the check for both.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { channelVault } from '../../lib/config';
import { servedManifest } from '../../lib/vault/manifest-check';
import { EMPTY_INDEX, LogIndex, LogManifest, buildIndex, renderLog, withoutNav } from '../../lib/vault/release-log';
import { CHANNELS, Channel, RELEASE_LOG_DIRS, ReleaseFile, SERVED_PATHS, readReleaseFile } from '../../lib/vault/release-list';

const ROOT = join(__dirname, '..', '..');

function previousIndex(root: string, channel: Channel): LogIndex {
  const p = join(root, RELEASE_LOG_DIRS[channel], 'index.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as LogIndex) : EMPTY_INDEX;
}

function files(root: string, manifest: LogManifest | null, file: ReleaseFile): Map<string, string> {
  return renderLog(buildIndex(previousIndex(root, file.channel), manifest, file), file.channel);
}

/** Problems with a channel's committed log (stale or missing pages, a stale index.json); the channel is the file's. */
export function checkReleaseLog(root: string, manifest: LogManifest | null, file: ReleaseFile): string[] {
  let want: Map<string, string>;
  try {
    want = files(root, manifest, file);
  } catch (e) {
    return [(e as Error).message];
  }
  const out: string[] = [];
  const fix = `run npm run release-log -- --channel ${file.channel}`;
  for (const [path, content] of want) {
    const p = join(root, path);
    if (!existsSync(p)) {
      out.push(`${path} is missing (${fix})`);
      continue;
    }
    const have = readFileSync(p, 'utf8');
    const same = path.endsWith('.html') ? withoutNav(have) === withoutNav(content) : have === content;
    if (!same) out.push(`${path} is stale (${fix})`);
  }
  return out;
}

export function writeReleaseLog(root: string, manifest: LogManifest | null, file: ReleaseFile): string[] {
  const written: string[] = [];
  for (const [path, content] of files(root, manifest, file)) {
    const p = join(root, path);
    mkdirSync(dirname(p), { recursive: true });
    // Keep the navigation sync-nav already rendered into an existing page.
    if (existsSync(p) && path.endsWith('.html') && withoutNav(readFileSync(p, 'utf8')) === withoutNav(content)) continue;
    writeFileSync(p, content);
    written.push(path);
  }
  // Only the production site has the shared navigation (website/).
  if (file.channel === 'prod' && written.some((p) => p.endsWith('.html'))) execFileSync('node', [join(root, 'scripts', 'sync-nav.mjs')], { stdio: 'inherit' });
  return written;
}

/** A channel's inputs: its served manifest (null before its first publication) and its validated release file. */
export function logInputs(root: string, channel: Channel): { manifest: LogManifest | null; file: ReleaseFile } {
  const { vault } = channelVault(channel);
  const file = readReleaseFile(root, channel, vault.account);
  const served = join(root, SERVED_PATHS[channel]);
  return { manifest: existsSync(served) ? servedManifest(readFileSync(served)) : null, file };
}

if (require.main === module) {
  const i = process.argv.indexOf('--channel');
  const only = i >= 0 ? (process.argv[i + 1] as Channel) : undefined;
  if (only !== undefined && !CHANNELS.includes(only)) {
    console.error('usage: release-log.ts [--channel prod|staging] [--check]');
    process.exit(2);
  }
  let failed = false;
  for (const channel of only ? [only] : CHANNELS) {
    const { manifest, file } = logInputs(ROOT, channel);
    if (process.argv.includes('--check')) {
      const problems = checkReleaseLog(ROOT, manifest, file);
      for (const p of problems) console.error(`  ✗ ${channel}: ${p}`);
      failed ||= problems.length > 0;
    } else {
      const written = writeReleaseLog(ROOT, manifest, file);
      console.log(written.length ? `${channel} release log: wrote ${written.join(', ')}` : `${channel} release log: up to date`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}
