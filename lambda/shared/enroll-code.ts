/**
 * Setup codes (MEMBER-API 2.0.0 "Setup codes", VAULT-MESSAGING 0.15.0
 * §11.12.1, ENROLLMENT-CODES.md §3): one issuance, two secrets.
 *
 *  - the QR secret: 16 CSPRNG bytes, 22 characters base64url (128 bits);
 *  - the typed code: 8 symbols of 23456789ABCDEFGHJKMNPQRSTUVWXYZ (31
 *    symbols, about 39.6 bits), uniform by rejection sampling.
 *
 * Neither is stored: with `k_code`, an HMAC key in SSM SecureString, the
 * issuance row is keyed by HMAC(k_code, "qr" || 0x00 || secret) and holds
 * code_mac = HMAC(k_code, "code" || 0x00 || user_guid || 0x00 || code), so
 * a code is only ever compared with its own member's issuance. Neither
 * secret, nor a code, is ever logged or audited.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { env } from './aws';

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 8;
export const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
/** 16 bytes, base64url without padding. */
export const QR_SECRET_RE = /^[A-Za-z0-9_-]{22}$/;

/** Issuances live 5 minutes. */
export const ENROLL_CODE_TTL_S = 5 * 60;
/** Typed attempts per issuance, from every source together. */
export const TYPED_CEILING = 800;
/** A redeemed key may enroll for this long. */
export const PENDING_KEY_TTL_S = 3600;
/** The typed path answers no sooner than this after receipt. */
export const TYPED_MIN_MS = 250;

/** Bytes 248–255 are discarded so that `b % 31` is uniform (248 = 8 × 31). */
const REJECT_FROM = 248;

/** The typed code: 8 uniform symbols of the alphabet. */
export function newTypedCode(random: (n: number) => Buffer = randomBytes): string {
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const b of random(16)) {
      if (b >= REJECT_FROM) continue;
      out += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/** The QR secret: 16 bytes as 22 characters base64url. */
export const newQrSecret = (random: (n: number) => Buffer = randomBytes): string => random(16).toString('base64url');

/** A QR secret in canonical form (22 characters that decode to 16 bytes and back). */
export function isQrSecret(s: unknown): s is string {
  if (typeof s !== 'string' || !QR_SECRET_RE.test(s)) return false;
  const b = Buffer.from(s, 'base64url');
  return b.length === 16 && b.toString('base64url') === s;
}

/** A typed code as the member may type it: spaces and hyphens removed, upper case. */
export const normalizeCode = (s: string): string => s.replace(/[\s-]/g, '').toUpperCase();

/** The email as sign-in normalizes it: trimmed, lower case. */
export const normalizeEmail = (s: string): string => s.trim().toLowerCase();

/** "XXXX-XXXX". */
export const formatCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

const hmac = (key: Buffer, ...parts: string[]) => {
  const h = createHmac('sha256', key);
  parts.forEach((p, i) => {
    if (i) h.update(Buffer.from([0]));
    h.update(p, 'utf8');
  });
  return h.digest();
};

/** The issuance's lookup key: hex HMAC(k_code, "qr" || 0x00 || secret). */
export const qrMac = (k: Buffer, secret: string): string => hmac(k, 'qr', secret).toString('hex');

/** HMAC(k_code, "code" || 0x00 || user_guid || 0x00 || code). */
export const codeMac = (k: Buffer, userGuid: string, code: string): Buffer => hmac(k, 'code', userGuid, code);

/** The per-(email, network) counter's email part: hex HMAC(k_code, email). */
export const emailMac = (k: Buffer, email: string): string => hmac(k, email).toString('hex');

/** The request-table key of an issuance. */
export const issuanceKey = (qrMacHex: string): string => `enroll#${qrMacHex}`;

/**
 * `email_hint`: the first character of the local part, `***`, `@`, the
 * domain (VAULT-MESSAGING §11.13).
 */
export function emailHint(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}

// ---- k_code ------------------------------------------------------------------------

const ssm = new SSMClient({});
const KEY_CACHE_MS = 5 * 60 * 1000;
let cachedKey: { key: Buffer; at: number } | null = null;

/**
 * k_code from SSM SecureString (env ENROLL_CODE_KEY_PARAM,
 * /vettid-org/<stage>/member/enroll-code-key): base64 of at least 32 random
 * bytes, created once by an operator (RUNBOOK "Setup codes"). Cached per
 * container for 5 minutes. A missing or short key fails the request (500):
 * codes are never issued or checked without it.
 */
export async function enrollCodeKey(now = Date.now()): Promise<Buffer> {
  if (cachedKey && now - cachedKey.at < KEY_CACHE_MS) return cachedKey.key;
  const r = await ssm.send(new GetParameterCommand({ Name: env('ENROLL_CODE_KEY_PARAM'), WithDecryption: true }));
  const key = Buffer.from(String(r.Parameter?.Value ?? '').trim(), 'base64');
  if (key.length < 32) throw new Error('enroll code key is missing or shorter than 32 bytes');
  cachedKey = { key, at: now };
  return key;
}

/** Tests only. */
export function resetEnrollCodeKeyCache(): void {
  cachedKey = null;
}
