// Setup codes, as the portal shows them (MEMBER-API 2.0.0 "Setup codes",
// VAULT-MESSAGING 0.15.0 §11.12.1). Pure functions only (no DOM, no
// storage), so they are unit-tested in Node.
//
// One issuance has two secrets: the QR secret (16 bytes, 22 characters
// base64url), drawn as the QR and carried by the same-device App Link, and
// the typed code (8 symbols), shown as XXXX-XXXX and typed in the app
// together with the account's email. Neither is ever stored, logged or sent
// anywhere by this site: the page only shows them, until they are used, are
// cancelled, expire or the page is left.

/** 16 bytes, base64url without padding. */
export const SECRET_RE = /^[A-Za-z0-9_-]{22}$/;
/** 8 symbols; no 0, 1, I, L or O. */
export const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
const ORIGIN_RE = /^https:\/\/[a-z0-9.-]+(:\d+)?$/;

/**
 * The QR payload (§11.12.1): compact JSON, keys in this order. `api` is the
 * member API origin (this site's), an identifier the app compares with its
 * own built-in origin and never connects to. The typed code is not in it.
 */
export function setupQrPayload(api, secret) {
  if (!ORIGIN_RE.test(api) || !SECRET_RE.test(secret)) throw new Error('setupQrPayload: bad input');
  return JSON.stringify({ v: 1, t: 'e', api, s: secret });
}

/** "XXXX-XXXX". */
export function formatCode(code) {
  if (!CODE_RE.test(code)) throw new Error('formatCode: bad code');
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * The same-device App Link (ENROLLMENT-CODES §3.2): the QR secret in the
 * fragment (never sent to a server), never the typed code.
 */
export function appLink(origin, secret) {
  if (!ORIGIN_RE.test(origin) || !SECRET_RE.test(secret)) throw new Error('appLink: bad input');
  return `${origin}/vault/enroll/#s=${secret}`;
}

/** The QR secret from an App Link's fragment (`#s=<secret>`), or null. */
export function secretFromHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const s = params.get('s');
  return s && SECRET_RE.test(s) ? s : null;
}

/** Time left as "4:59" (minutes:seconds), "0:00" once past. */
export function mmss(msLeft) {
  const s = Math.max(0, Math.ceil(Number(msLeft) / 1000) || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
