// The vault recovery code, as the portal sees it (VAULT-MESSAGING §11.11.2).
// Pure functions only (no DOM, no storage), so they are unit-tested in Node.
//
// The enclave mints the code and seals it to a P-256 key made by this
// browser; the member API only ever holds the ciphertext:
//
//   out = 0x01 || eph (65) || nonce (12) || AES-256-GCM(k, nonce, aad = out[0:78], pt)
//   k   = HKDF-SHA-256(ikm = ECDH(eph, browser_key), salt = eph || browser_key,
//                      info = "vettid/vms/2/recovery-code-seal" || 0x00 || vault_id || 0x00 || recovery_id, L = 32)
//   pt  = {"v":1,"vault_id","recovery_id","code","not_before","expires_at"} || 0x00 padding
//       | {"v":1,"vault_id","recovery_id","error":"no_credential"} || 0x00 padding
//
// Opened here with WebCrypto only (ECDH deriveBits, HKDF, AES-GCM). The
// code never leaves the page: it is not sent, logged or stored.

/** Every result in a response slot is exactly this size (§11.5). */
export const SEALED_CODE_BYTES = 5252;
const VERSION = 0x01;
const POINT_BYTES = 65;
const NONCE_BYTES = 12;
const HEADER_BYTES = 1 + POINT_BYTES + NONCE_BYTES; // 78
const LABEL = 'vettid/vms/2/recovery-code-seal';

/** 32 Crockford base32 characters (20 random bytes). */
export const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{32}$/;
export const VAULT_ID_RE = /^[0-9a-f]{32}$/;
export const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/** The cancel link's token: 32 random bytes, base64url without padding. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Why a sealed code could not be read. */
export class SealError extends Error {
  /** kind: 'malformed' (not a sealed code) | 'unopenable' (wrong key, or random bytes) | 'mismatch' (opened, but not for this recovery) */
  constructor(kind) {
    super(`sealed code: ${kind}`);
    this.name = 'SealError';
    this.kind = kind;
  }
}

// ── base64 ──────────────────────────────────────────────────────────────

/** Canonical base64 (with padding, no whitespace) -> bytes, or null. */
export function fromBase64(s) {
  if (typeof s !== 'string' || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  let bin;
  try {
    bin = atob(s);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return toBase64(out) === s ? out : null;
}

export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const utf8 = (s) => new TextEncoder().encode(s);

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── open ────────────────────────────────────────────────────────────────

/**
 * Open a sealed code with this browser's key.
 *   privateKey: the non-extractable ECDH P-256 CryptoKey made for this recovery
 *   browserKey: its public key, 65 bytes uncompressed (sent as browser_key)
 *   sealed:     the 5,252 bytes of `sealed_code`
 * Resolves to { code, notBefore, expiresAt } or { error } (the vault's
 * refusal, e.g. "no_credential"); throws SealError otherwise.
 */
export async function openSealedCode({ privateKey, browserKey, sealed, vaultId, recoveryId }, subtle = globalThis.crypto.subtle) {
  if (!(sealed instanceof Uint8Array) || sealed.length !== SEALED_CODE_BYTES || sealed[0] !== VERSION) throw new SealError('malformed');
  if (!(browserKey instanceof Uint8Array) || browserKey.length !== POINT_BYTES || browserKey[0] !== 0x04) throw new SealError('malformed');
  if (!VAULT_ID_RE.test(vaultId) || !ULID_RE.test(recoveryId)) throw new SealError('malformed');

  const eph = sealed.slice(1, 1 + POINT_BYTES);
  let ephKey;
  try {
    ephKey = await subtle.importKey('raw', eph, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch {
    // Not a point on the curve: random bytes (the enclave could not answer).
    throw new SealError('unopenable');
  }

  let shared;
  try {
    shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: ephKey }, privateKey, 256));
  } catch {
    throw new SealError('unopenable');
  }
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  shared.fill(0);
  const kBits = new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: concat(eph, browserKey), info: utf8(`${LABEL}\0${vaultId}\0${recoveryId}`) },
    ikm,
    256,
  ));
  const k = await subtle.importKey('raw', kBits, 'AES-GCM', false, ['decrypt']);
  kBits.fill(0);

  let pt;
  try {
    pt = new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.slice(1 + POINT_BYTES, HEADER_BYTES), additionalData: sealed.slice(0, HEADER_BYTES), tagLength: 128 },
      k,
      sealed.slice(HEADER_BYTES),
    ));
  } catch {
    throw new SealError('unopenable');
  }
  try {
    return parsePlaintext(pt, vaultId, recoveryId);
  } finally {
    pt.fill(0);
  }
}

/** The sealed JSON, followed by zero bytes only; strict about every field. */
export function parsePlaintext(pt, vaultId, recoveryId) {
  let end = pt.indexOf(0);
  if (end < 0) end = pt.length;
  for (let i = end; i < pt.length; i += 1) if (pt[i] !== 0) throw new SealError('malformed');
  let o;
  try {
    o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pt.subarray(0, end)));
  } catch {
    throw new SealError('malformed');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) throw new SealError('malformed');
  if (o.vault_id !== vaultId || o.recovery_id !== recoveryId) throw new SealError('mismatch');
  if ('error' in o) {
    if (typeof o.error !== 'string' || !o.error || o.error.length > 64) throw new SealError('malformed');
    return { error: o.error };
  }
  if (typeof o.code !== 'string' || !CODE_RE.test(o.code)) throw new SealError('malformed');
  if (typeof o.not_before !== 'string' || !TS_RE.test(o.not_before)) throw new SealError('malformed');
  if (typeof o.expires_at !== 'string' || !TS_RE.test(o.expires_at)) throw new SealError('malformed');
  return { code: o.code, notBefore: o.not_before, expiresAt: o.expires_at };
}

// ── what the page shows ─────────────────────────────────────────────────

/**
 * The QR payload the new app scans (§11.11.2): compact JSON, keys in this
 * order. `api` (VAULT-MESSAGING 0.15.0) is the member API origin of this
 * portal: an identifier the app compares with its own built-in origin,
 * never an address it connects to.
 */
export function qrPayload(api, vaultId, recoveryId, code) {
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(api) || !VAULT_ID_RE.test(vaultId) || !ULID_RE.test(recoveryId) || !CODE_RE.test(code)) throw new Error('qrPayload: bad input');
  return JSON.stringify({ v: 1, t: 'r', api, vault_id: vaultId, recovery_id: recoveryId, code });
}

/** The code as text, in groups of four for typing (§11.11.2). */
export function codeGroups(code) {
  return code.match(/.{1,4}/g) ?? [];
}

// ── ids ─────────────────────────────────────────────────────────────────

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A canonical ULID (48-bit ms time, 80 random bits), e.g. a lock's request_id. */
export function newUlid(now = Date.now(), random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  let t = Math.floor(now);
  if (!Number.isSafeInteger(t) || t < 0 || t >= 2 ** 48) throw new Error('newUlid: time out of range');
  const out = new Array(26);
  for (let i = 9; i >= 0; i -= 1) {
    out[i] = CROCKFORD[t % 32];
    t = Math.floor(t / 32);
  }
  const r = random(10);
  let acc = 0;
  let bits = 0;
  let at = 10;
  for (const byte of r) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out[at] = CROCKFORD[(acc >> bits) & 31];
      at += 1;
    }
    acc &= (1 << bits) - 1;
  }
  return out.join('');
}

/** The token from a cancel link's fragment (`#t=<token>`), or null. */
export function tokenFromHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const t = params.get('t');
  return t && TOKEN_RE.test(t) ? t : null;
}
