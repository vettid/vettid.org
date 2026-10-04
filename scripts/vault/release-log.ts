/**
 * The release log pages under website/security/releases/ (lib/vault/release-log.ts),
 * from the production manifest and vault/releases/prod.json.
 *
 *   npx ts-node --transpile-only scripts/vault/release-log.ts           write the pages, then fill in the navigation
 *   npx ts-node --transpile-only scripts/vault/release-log.ts --check   fail if a page or index.json is stale
 *
 * The publish step (scripts/vault/manifest.ts publish) runs it; check:manifest
 * runs the check.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { channelVault } from '../../lib/config';
import { servedManifest } from '../../lib/vault/manifest-check';
import { EMPTY_INDEX, LogIndex, LogManifest, buildIndex, renderLog, withoutNav } from '../../lib/vault/release-log';
import { RELEASE_LOG_DIR, ReleaseFile, SERVED_PATHS, readReleaseFile } from '../../lib/vault/release-list';

const ROOT = join(__dirname, '..', '..');
const INDEX = join(RELEASE_LOG_DIR, 'index.json');

function previousIndex(root: string): LogIndex {
  const p = join(root, INDEX);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as LogIndex) : EMPTY_INDEX;
}

function files(root: string, manifest: LogManifest | null, file: ReleaseFile): Map<string, string> {
  return renderLog(buildIndex(previousIndex(root), manifest, file));
}

/** Problems with the committed log (stale or missing pages, a stale index.json). */
export function checkReleaseLog(root: string, manifest: LogManifest | null, file: ReleaseFile): string[] {
  let want: Map<string, string>;
  try {
    want = files(root, manifest, file);
  } catch (e) {
    return [(e as Error).message];
  }
  const out: string[] = [];
  for (const [path, content] of want) {
    const p = join(root, path);
    if (!existsSync(p)) {
      out.push(`${path} is missing (run scripts/vault/release-log.ts)`);
      continue;
    }
    const have = readFileSync(p, 'utf8');
    const same = path.endsWith('.html') ? withoutNav(have) === withoutNav(content) : have === content;
    if (!same) out.push(`${path} is stale (run scripts/vault/release-log.ts)`);
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
  if (written.some((p) => p.endsWith('.html'))) execFileSync('node', [join(root, 'scripts', 'sync-nav.mjs')], { stdio: 'inherit' });
  return written;
}

export function prodInputs(root: string): { manifest: LogManifest | null; file: ReleaseFile } {
  const { vault } = channelVault('prod');
  const file = readReleaseFile(root, 'prod', vault.account);
  const served = join(root, SERVED_PATHS.prod);
  return { manifest: existsSync(served) ? servedManifest(readFileSync(served)) : null, file };
}

if (require.main === module) {
  const { manifest, file } = prodInputs(ROOT);
  if (process.argv.includes('--check')) {
    const problems = checkReleaseLog(ROOT, manifest, file);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exitCode = problems.length ? 1 : 0;
  } else {
    const written = writeReleaseLog(ROOT, manifest, file);
    console.log(written.length ? `release log: wrote ${written.join(', ')}` : 'release log: up to date');
  }
}
