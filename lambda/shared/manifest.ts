/**
 * The signed release manifest (VAULT-MESSAGING §11.10.1), as the vault
 * manifest sync reads it: the served document's signature under a pinned
 * key, then the manifest's format. A port of vettid-vault's
 * vms/manifest.Parse checks that matter for routing; tested against that
 * repo's recorded vectors (test/fixtures/manifest).
 *
 * The routing table built from it is never trusted for security: apps and
 * the enclave verify the manifest themselves.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';

export const LABEL = 'vettid/pcr-manifest/1';
export const MAX_BYTES = 65536;
export const MAX_SERVED = 90112;
export const STATUSES = ['active', 'deprecated', 'retired', 'removed'] as const;
export type Status = (typeof STATUSES)[number];

export interface ManifestRelease {
  release: number;
  pcr0: string;
  pcr1: string;
  pcr2: string;
  seal_key: string;
  status: Status;
  published_at: string;
  ends_at?: string;
  notes: string;
}

export interface Manifest {
  serial: number;
  issued_at: string;
  releases: ManifestRelease[];
  /** hex(SHA-256(manifest bytes)): the name of the bucket copy, manifests/<sha256>.json. */
  sha256: string;
}

export class ManifestError extends Error {
  constructor(readonly code: 'served' | 'key' | 'signature' | 'format', message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

/** key_id = hex(SHA-256(SPKI DER)[0:8]). */
export function keyId(spkiB64: string): string {
  return createHash('sha256').update(Buffer.from(spkiB64, 'base64')).digest('hex').slice(0, 16);
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PCR = /^[0-9a-f]{96}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const isTime = (s: unknown): s is string => {
  if (typeof s !== 'string' || !TIME.test(s)) return false;
  const t = new Date(s);
  return !Number.isNaN(t.getTime()) && t.toISOString().replace('.000Z', 'Z') === s;
};
const isPcr = (s: unknown): s is string => typeof s === 'string' && PCR.test(s) && !/^0+$/.test(s);
const isUint = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
const isHttps = (s: unknown): s is string => {
  if (typeof s !== 'string' || s === '' || s.length > 1024) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !!u.host && !u.username && !u.password;
  } catch {
    return false;
  }
};
const isSealKey = (s: unknown): s is string => typeof s === 'string' && s.length >= 1 && s.length <= 256 && /^[\x21-\x7e]+$/.test(s);

/**
 * Verifies the served document `{manifest, sig, key_id}` under one of the
 * pinned keys (SPKI, base64 DER) and parses the manifest bytes.
 */
export function verifyServed(served: string | Buffer, pinnedSpkis: readonly string[]): Manifest {
  const raw = Buffer.isBuffer(served) ? served : Buffer.from(served, 'utf8');
  if (raw.length === 0 || raw.length > MAX_SERVED) throw new ManifestError('served', 'served document size');
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ManifestError('served', 'served document is not JSON');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ManifestError('served', 'served document is not an object');
  const { manifest, sig, key_id } = doc as { manifest?: unknown; sig?: unknown; key_id?: unknown };
  if (typeof manifest !== 'string' || !B64.test(manifest) || typeof sig !== 'string' || !B64.test(sig) || typeof key_id !== 'string' || !/^[0-9a-f]{16}$/.test(key_id)) {
    throw new ManifestError('served', 'served document fields');
  }
  const bytes = Buffer.from(manifest, 'base64');
  const signature = Buffer.from(sig, 'base64');
  if (signature.length !== 64) throw new ManifestError('served', 'signature length');
  const spki = pinnedSpkis.find((k) => keyId(k) === key_id);
  if (!spki) throw new ManifestError('key', `key_id ${key_id} is not pinned`);
  const pub = createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' });
  if (pub.asymmetricKeyType !== 'ec' || pub.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new ManifestError('key', 'pinned key is not P-256');
  const signed = Buffer.concat([Buffer.from(LABEL, 'utf8'), Buffer.from([0]), bytes]);
  if (!verify('sha256', signed, { key: pub, dsaEncoding: 'ieee-p1363' }, signature)) throw new ManifestError('signature', 'signature does not verify');
  return parseManifest(bytes);
}

/** The manifest's format (§11.10.1): unknown members are ignored, unknown statuses refused. */
export function parseManifest(bytes: Buffer): Manifest {
  const fail = (what: string): never => {
    throw new ManifestError('format', what);
  };
  if (bytes.length === 0 || bytes.length > MAX_BYTES) fail('size');
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(bytes.toString('utf8'));
  } catch {
    return fail('not JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail('not an object');
  if (o.v !== 1) fail('v');
  if (!isUint(o.serial)) fail('serial');
  if (!isTime(o.issued_at)) fail('issued_at');
  if (!Array.isArray(o.releases) || o.releases.length === 0) fail('releases');
  const releases: ManifestRelease[] = [];
  const pcr0s = new Set<string>();
  let last = 0;
  for (const e of o.releases as unknown[]) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) fail('entry');
    const r = e as Record<string, unknown>;
    if (!isUint(r.release) || r.release <= last) fail('release numbers must increase');
    last = r.release as number;
    if (!isPcr(r.pcr0) || !isPcr(r.pcr1) || !isPcr(r.pcr2)) fail(`release ${r.release}: PCRs`);
    if (pcr0s.has(r.pcr0 as string)) fail(`release ${r.release}: duplicate pcr0`);
    pcr0s.add(r.pcr0 as string);
    if (!isSealKey(r.seal_key)) fail(`release ${r.release}: seal_key`);
    if (!STATUSES.includes(r.status as Status)) fail(`release ${r.release}: unknown status`);
    if (!isTime(r.published_at)) fail(`release ${r.release}: published_at`);
    if (r.ends_at !== undefined && !isTime(r.ends_at)) fail(`release ${r.release}: ends_at`);
    if (!isHttps(r.notes)) fail(`release ${r.release}: notes`);
    releases.push({
      release: r.release as number,
      pcr0: r.pcr0 as string,
      pcr1: r.pcr1 as string,
      pcr2: r.pcr2 as string,
      seal_key: r.seal_key as string,
      status: r.status as Status,
      published_at: r.published_at as string,
      ...(r.ends_at !== undefined ? { ends_at: r.ends_at as string } : {}),
      notes: r.notes as string,
    });
  }
  return { serial: o.serial as number, issued_at: o.issued_at as string, releases, sha256: createHash('sha256').update(bytes).digest('hex') };
}
