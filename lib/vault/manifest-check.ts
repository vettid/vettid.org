/**
 * The manifest check (VAULT-RELEASES §7, `npm run check:manifest`): what
 * must hold for a channel's committed, served manifest. Pure; the git and
 * file reading is scripts/vault/check-manifest.ts.
 *
 *  - the release file is valid (lib/vault/release-list.ts);
 *  - nothing is served while no release is listed, and something is served
 *    once one is;
 *  - the served document verifies under a pinned key, within the size
 *    limits, and its manifest bytes parse strictly;
 *  - those bytes are exactly a fresh render of the release file (so the
 *    file, CDK and the manifest cannot disagree);
 *  - the serial is no higher than `signed_serial` (a serial is never
 *    reused), and every published version in git history is a valid
 *    successor of the one before (serial strictly increasing, no release
 *    dropped before it is removed, statuses only forward, PCRs, keys and
 *    publication dates unchanged);
 *  - statuses and dates are consistent (§3.2, §3.5);
 *  - every PCR0 a listed release's key admits is listed (§11.10.1).
 */
import { ManifestError, parseManifest, verifyServed } from '../../lambda/shared/manifest';
import {
  ManifestEntry,
  ReleaseFile,
  consistencyProblems,
  manifestEntries,
  renderManifest,
  successorProblems,
} from './release-list';

export interface HistoryVersion {
  /** The commit (for messages). */
  commit: string;
  /** The served document at that commit, or null where the file did not exist. */
  served: Buffer | null;
}

export interface ChannelCheck {
  channel: string;
  file: ReleaseFile;
  /** The served document now (working tree), or null. */
  served: Buffer | null;
  pinnedKeys: readonly string[];
  /**
   * Earlier versions of the served file, oldest first (from the history of
   * its path), without the newest one when the working tree still has it.
   */
  history: readonly HistoryVersion[];
}

interface Parsed {
  serial: number;
  issued_at: string;
  releases: ManifestEntry[];
}

/** The manifest inside a served document, parsed but not verified (history). */
export function servedManifest(served: Buffer): Parsed {
  let doc: { manifest?: unknown };
  try {
    doc = JSON.parse(served.toString('utf8'));
  } catch {
    throw new ManifestError('served', 'served document is not JSON');
  }
  if (typeof doc?.manifest !== 'string') throw new ManifestError('served', 'served document has no manifest');
  return toParsed(parseManifest(Buffer.from(doc.manifest, 'base64')));
}

const toParsed = (m: { serial: number; issued_at: string; releases: ManifestEntry[] | { status: string }[] }): Parsed => ({
  serial: m.serial,
  issued_at: m.issued_at,
  releases: m.releases as ManifestEntry[],
});

export function checkChannel(c: ChannelCheck): string[] {
  const out: string[] = [];
  const p = (s: string) => out.push(`${c.channel}: ${s}`);
  const entries = manifestEntries(c.file);

  // History: every published version is a valid successor of the previous one.
  const versions: { commit: string; m: Parsed | null }[] = [];
  for (const h of c.history) {
    if (!h.served) {
      versions.push({ commit: h.commit, m: null });
      continue;
    }
    try {
      versions.push({ commit: h.commit, m: servedManifest(h.served) });
    } catch (e) {
      p(`the version at ${h.commit.slice(0, 12)} does not parse: ${(e as Error).message}`);
    }
  }

  let current: Parsed | null = null;
  if (!c.served) {
    if (entries.length) p(`vault/releases/${c.channel}.json lists releases for the manifest, but no manifest is served (publish it: scripts/vault/manifest.ts publish)`);
  } else {
    try {
      current = toParsed(verifyServed(c.served, c.pinnedKeys));
    } catch (e) {
      p(`the served manifest does not verify under the pinned keys: ${(e as Error).message}`);
    }
  }
  if (current) {
    if (!entries.length) {
      p('a manifest is served, but the release file lists no release for it');
    } else {
      const expected = renderManifest(current.serial, current.issued_at, entries);
      const doc = JSON.parse(c.served!.toString('utf8')) as { manifest: string };
      if (!expected.equals(Buffer.from(doc.manifest, 'base64'))) {
        p(`the served manifest is not a render of vault/releases/${c.channel}.json (edit the file and sign and publish a new manifest; never edit the served file by hand)`);
      }
    }
    if (current.serial > c.file.signed_serial) p(`serial ${current.serial} is above signed_serial ${c.file.signed_serial} (the signing script raises it before signing)`);
    for (const s of consistencyProblems(current.releases, current.issued_at)) p(s);
    const listed = new Set(current.releases.map((r) => r.pcr0));
    for (const e of c.file.releases) {
      for (const a of e.admitted_pcr0s) {
        if (!listed.has(a)) p(`release ${e.release}'s key admits a PCR0 the manifest does not list (§11.10.1: every admitted PCR0 stays listed)`);
      }
    }
  }

  // The sequence of published versions, ending with the current one.
  const seq = [...versions, { commit: 'working tree', m: c.served ? (current ?? safeParse(c.served)) : null }];
  let prev: { commit: string; m: Parsed } | null = null;
  for (const v of seq) {
    if (!v.m) {
      if (prev) p(`the served manifest was deleted at ${v.commit.slice(0, 12)} after serial ${prev.m.serial} was published (it must stay served)`);
      continue;
    }
    if (prev) {
      for (const s of successorProblems(prev.m, v.m)) p(`${v.commit === 'working tree' ? 'now' : v.commit.slice(0, 12)} after ${prev.commit.slice(0, 12)}: ${s}`);
    }
    prev = { commit: v.commit, m: v.m };
  }
  return out;
}

function safeParse(served: Buffer): Parsed | null {
  try {
    return servedManifest(served);
  } catch {
    return null;
  }
}
