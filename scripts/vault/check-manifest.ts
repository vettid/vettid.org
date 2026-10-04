/**
 * `npm run check:manifest` (CI): the committed release manifests and the
 * release log (VAULT-RELEASES §7). For each channel: the release file, the
 * served manifest (signature under the keys pinned in lib/config.ts, exact
 * render of the release file, signed_serial), the history of the served
 * file in git (serials strictly increasing, successor rules), status and
 * date consistency; for production also the release log pages.
 *
 * Needs the full git history of the served files: CI checks out with
 * fetch-depth 0. A shallow clone fails unless MANIFEST_CHECK_ALLOW_SHALLOW=1.
 *
 *   npx ts-node --transpile-only scripts/vault/check-manifest.ts [prod|staging]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { channelVault } from '../../lib/config';
import { HistoryVersion, checkChannel, servedManifest } from '../../lib/vault/manifest-check';
import { CHANNELS, Channel, SERVED_PATHS, readReleaseFile } from '../../lib/vault/release-list';
import { checkReleaseLog } from './release-log';

const ROOT = join(__dirname, '..', '..');

const git = (args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });

/** Versions of a path, oldest first; null where a commit deleted it. */
function history(path: string): HistoryVersion[] {
  const commits = git(['log', '--format=%H', '--', path]).toString('utf8').split('\n').filter(Boolean).reverse();
  return commits.map((commit) => {
    try {
      return { commit, served: git(['show', `${commit}:${path}`]) };
    } catch {
      return { commit, served: null };
    }
  });
}

function main(): number {
  const only = process.argv[2] as Channel | undefined;
  if (only && !CHANNELS.includes(only)) {
    console.error(`unknown channel ${only}`);
    return 2;
  }
  if (git(['rev-parse', '--is-shallow-repository']).toString().trim() === 'true' && process.env.MANIFEST_CHECK_ALLOW_SHALLOW !== '1') {
    console.error('check:manifest needs the full git history (fetch-depth: 0) to check serials against earlier manifests');
    return 2;
  }
  const problems: string[] = [];
  for (const channel of only ? [only] : CHANNELS) {
    const { vault } = channelVault(channel);
    let file;
    try {
      file = readReleaseFile(ROOT, channel, vault.account);
    } catch (e) {
      problems.push(`${channel}: ${(e as Error).message}`);
      continue;
    }
    const path = SERVED_PATHS[channel];
    const served = existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path)) : null;
    const h = history(path);
    const last = h[h.length - 1];
    if (last && served && last.served && last.served.equals(served)) h.pop();
    problems.push(...checkChannel({ channel, file, served, pinnedKeys: vault.manifestKeys, history: h }));
    if (channel === 'prod') {
      let manifest = null;
      try {
        manifest = served ? servedManifest(served) : null;
      } catch {
        // reported above
      }
      problems.push(...checkReleaseLog(ROOT, manifest, file).map((s) => `prod release log: ${s}`));
    }
    if (!problems.length) {
      console.log(`check:manifest ${channel}: ${served ? `serial ${servedManifest(served).serial}` : 'nothing published yet'}, ${file.releases.length} release(s) listed`);
    }
  }
  if (problems.length) {
    console.error(`check:manifest FAILED (${problems.length}):`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    return 1;
  }
  console.log('check:manifest OK');
  return 0;
}

process.exitCode = main();
