/**
 * App request signing (MEMBER-API 2.0.0 "App request signing",
 * VAULT-MESSAGING 0.15.0 §11.12.2). Apps never sign in: every app request to
 * /api/vault/* carries
 *
 *   X-VettID-App: v=1; vault=<vault_id or empty>; kid=<akid>; ts=<Unix s>; nonce=<b64url 16 B>; sig=<b64url DER>
 *
 * where `sig` is ECDSA P-256 / SHA-256 by the app key over
 *
 *   "vettid/member-api/app/1" \n METHOD \n path \n query \n vault_id \n akid \n ts \n nonce \n hex(SHA-256(body))
 *
 * (each \n a literal newline, no trailing newline). `akid` is the first 16
 * bytes of SHA-256(SPKI DER of the app key), 32 lowercase hex.
 *
 * Pure helpers only: parsing, the signed string, keys and verification. The
 * nonce record and which key a route accepts live with the routes
 * (lambda/member/vault.ts). The API holds public keys only.
 */
import { KeyObject, createHash, createPublicKey, verify } from 'node:crypto';

/** The header, as API Gateway (payload v2) presents it: lower case. */
export const APP_HEADER = 'x-vettid-app';
export const SIGNING_LABEL = 'vettid/member-api/app/1';
/** `ts` must be within this many seconds of the API's clock. */
export const TS_WINDOW_S = 300;
/** A nonce is single-use for this long (per akid). */
export const NONCE_TTL_S = 600;

export const AKID_RE = /^[0-9a-f]{32}$/;
const VAULT_RE = /^([0-9a-f]{32})?$/;
const TS_RE = /^(0|[1-9][0-9]{0,11})$/;
const NONCE_RE = /^[A-Za-z0-9_-]{22}$/;
const SIG_RE = /^[A-Za-z0-9_-]{8,128}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const HEADER_KEYS = ['v', 'vault', 'kid', 'ts', 'nonce', 'sig'];

export interface AppHeader {
  /** 32 lowercase hex, or '' (redeem). */
  vault: string;
  kid: string;
  /** As sent (canonical decimal), and as a number. */
  tsRaw: string;
  ts: number;
  nonce: string;
  sig: Buffer;
}

/** Canonical unpadded base64url of exactly `bytes` bytes, or null. */
function b64url(s: string, bytes?: number): Buffer | null {
  const buf = Buffer.from(s, 'base64url');
  if (buf.toString('base64url') !== s) return null;
  if (bytes !== undefined && buf.length !== bytes) return null;
  return buf;
}

/** The header's six members, each exactly once; anything else is null. */
export function parseAppHeader(value: string | undefined): AppHeader | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  const fields = new Map<string, string>();
  for (const part of value.split(';')) {
    const p = part.trim();
    const i = p.indexOf('=');
    if (i <= 0) return null;
    const k = p.slice(0, i);
    if (!HEADER_KEYS.includes(k) || fields.has(k)) return null;
    fields.set(k, p.slice(i + 1));
  }
  if (fields.size !== HEADER_KEYS.length || fields.get('v') !== '1') return null;
  const vault = fields.get('vault')!;
  const kid = fields.get('kid')!;
  const tsRaw = fields.get('ts')!;
  const nonce = fields.get('nonce')!;
  const sigRaw = fields.get('sig')!;
  if (!VAULT_RE.test(vault) || !AKID_RE.test(kid) || !TS_RE.test(tsRaw) || !NONCE_RE.test(nonce) || !SIG_RE.test(sigRaw)) return null;
  if (!b64url(nonce, 16)) return null;
  const sig = b64url(sigRaw);
  if (!sig) return null;
  return { vault, kid, tsRaw, ts: Number(tsRaw), nonce, sig };
}

const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** The exact bytes the app signs. */
export function signingInput(
  method: string,
  path: string,
  query: string,
  h: Pick<AppHeader, 'vault' | 'kid' | 'tsRaw' | 'nonce'>,
  body: Buffer,
): Buffer {
  return Buffer.from([SIGNING_LABEL, method.toUpperCase(), path, query, h.vault, h.kid, h.tsRaw, h.nonce, sha256Hex(body)].join('\n'), 'utf8');
}

export interface AppKey {
  /** The canonical b64 of the SPKI DER, as stored on the vault row and sent to the enclave. */
  b64: string;
  kid: string;
  key: KeyObject;
}

/** akid: the first 16 bytes of SHA-256(SPKI DER), 32 lowercase hex. */
export const akid = (spki: Buffer): string => createHash('sha256').update(spki).digest().subarray(0, 16).toString('hex');

/**
 * An app key from its canonical standard base64 (with padding) SPKI DER: a
 * P-256 public key, in exactly the encoding Node re-exports (uncompressed
 * point), so that its akid is well defined. Null otherwise.
 */
export function parseAppKey(b64: unknown): AppKey | null {
  if (typeof b64 !== 'string' || b64.length > 256 || b64.length % 4 !== 0 || !B64_RE.test(b64)) return null;
  const der = Buffer.from(b64, 'base64');
  if (der.toString('base64') !== b64) return null;
  let key: KeyObject;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return null;
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
  const canonical = key.export({ format: 'der', type: 'spki' }) as Buffer;
  if (!canonical.equals(der)) return null;
  return { b64, kid: akid(der), key };
}

/** ECDSA P-256 / SHA-256, DER signature. Never throws. */
export function verifyAppSignature(key: KeyObject, data: Buffer, sig: Buffer): boolean {
  try {
    return verify('sha256', data, { key, dsaEncoding: 'der' }, sig);
  } catch {
    return false;
  }
}
