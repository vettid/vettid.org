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
  if (!ORIGIN_RE.test(api) || !VAULT_ID_RE.test(vaultId) || !ULID_RE.test(recoveryId) || !CODE_RE.test(code)) throw new Error('qrPayload: bad input');
  return JSON.stringify({ v: 1, t: 'r', api, vault_id: vaultId, recovery_id: recoveryId, code });
}

// ── the typed form (VAULT-MESSAGING 0.25.0 §11.11.10) ───────────────────
//
//   typed = locator (12) || code (32) || check (4)
//   check = the first 20 bits of
//           SHA-256("vettid/vms/2/recovery-typed-check" || 0x00 || api || 0x00 || locator || code),
//           as 4 Crockford base32 characters (most significant 5 bits first)
//
// The locator comes from the member API (with `sealed_code` only); the check
// characters are computed here and are never sent: the app verifies them
// with its own built-in origin and drops them.

const TYPED_LABEL = 'vettid/vms/2/recovery-typed-check';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** The API's locator: 12 Crockford base32 characters (60 random bits). */
export const LOCATOR_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(:\d+)?$/;
export const TYPED_LENGTH = 48;
export const TYPED_GROUPS = 12;
const TYPED_RE = /^[0-9A-HJKMNP-TV-Z]{48}$/;

/** The 4 check characters for `api` (the portal's origin, no trailing slash), `locator` and `code`. */
export async function typedCheck(api, locator, code, subtle = globalThis.crypto.subtle) {
  if (typeof api !== 'string' || !ORIGIN_RE.test(api) || !LOCATOR_RE.test(locator) || !CODE_RE.test(code)) throw new Error('typedCheck: bad input');
  const h = new Uint8Array(await subtle.digest('SHA-256', utf8(`${TYPED_LABEL}\0${api}\0${locator}${code}`)));
  // The first 20 bits: two bytes and the high half of the third.
  const bits = (h[0] << 12) | (h[1] << 4) | (h[2] >> 4);
  let out = '';
  for (let shift = 15; shift >= 0; shift -= 5) out += ALPHABET[(bits >> shift) & 31];
  return out;
}

/** The 48 characters the member types: locator, code, check. */
export async function typedForm(api, locator, code, subtle = globalThis.crypto.subtle) {
  return locator + code + (await typedCheck(api, locator, code, subtle));
}

/**
 * How the page shows the typed form: three rows of four groups of four.
 * Each group carries its text and what a screen reader is given instead
 * ("Group 3 of 12: 2, H, T, D"): one group at a time, spelled character by
 * character, never read as a word.
 */
export function typedRows(typed) {
  if (typeof typed !== 'string' || !TYPED_RE.test(typed)) throw new Error('typedRows: bad input');
  const rows = [];
  for (let g = 0; g < TYPED_GROUPS; g += 1) {
    const text = typed.slice(g * 4, g * 4 + 4);
    if (g % 4 === 0) rows.push([]);
    rows[rows.length - 1].push({ text, spoken: `Group ${g + 1} of ${TYPED_GROUPS}: ${text.split('').join(', ')}` });
  }
  return rows;
}

// ── ids ─────────────────────────────────────────────────────────────────

const CROCKFORD = ALPHABET;

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

// ── A cancel the API answered 404 (MEMBER-API 2.6.3) ────────────────────

/** The cancel route's own 404: `not_found`. A 404 without that code (not the API's JSON) is an ordinary error. */
export function cancelNotFound(err) {
  return err?.status === 404 && err?.code === 'not_found';
}

/**
 * What the recovery page does after a cancel answered `404 not_found` and
 * the state was reloaded. `loaded`: the reload succeeded; `recovery`: the
 * recovery it fetched (null: none); `oldId`: the recovery the cancel named;
 * `active`: the fetched recovery is in progress.
 * The old recovery's key is deleted only when the reload confirms that the
 * API no longer names that recovery.
 *  - reload_failed: nothing is known; the key stays (error).
 *  - still_current: the API still names it; the key stays (error).
 *  - replaced: a newer recovery is in progress (notice).
 *  - gone: the vault has no recovery in progress (notice).
 */
export function cancelGoneOutcome({ loaded, recovery, oldId, active }) {
  if (!loaded) return { deleteKey: false, kind: 'reload_failed' };
  if (recovery && recovery.recovery_id === oldId) return { deleteKey: false, kind: 'still_current' };
  return { deleteKey: true, kind: recovery && active ? 'replaced' : 'gone' };
}
