/**
 * Test-only: ECDSA P-256 signing of a ready-made SHA-256 digest, as AWS KMS
 * does for `Sign` with MessageType DIGEST. Node's crypto signs only messages
 * it hashes itself, so the KMS stand-in in the member API tests uses this
 * to return real signatures that a verifier (node's crypto.verify('sha256',
 * <signing string>, ...), the enclave's ecdsa.VerifyASN1) accepts. Slow and
 * not constant-time: never use outside tests.
 */
import { KeyObject, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';

const p = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const a = p - 3n;
const G: [bigint, bigint] = [
  0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
  0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
];
type Pt = [bigint, bigint] | null;

const mod = (x: bigint, m: bigint) => ((x % m) + m) % m;
function inv(x: bigint, m: bigint): bigint {
  let [r0, r1, s0, s1] = [mod(x, m), m, 1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return mod(s0, m);
}
function add(P: Pt, Q: Pt): Pt {
  if (!P) return Q;
  if (!Q) return P;
  if (P[0] === Q[0] && mod(P[1] + Q[1], p) === 0n) return null;
  const l = P[0] === Q[0] && P[1] === Q[1] ? mod((3n * P[0] * P[0] + a) * inv(2n * P[1], p), p) : mod((Q[1] - P[1]) * inv(Q[0] - P[0], p), p);
  const x = mod(l * l - P[0] - Q[0], p);
  return [x, mod(l * (P[0] - x) - P[1], p)];
}
function mul(k: bigint, P: Pt): Pt {
  let R: Pt = null;
  let A = P;
  while (k > 0n) {
    if (k & 1n) R = add(R, A);
    A = add(A, A);
    k >>= 1n;
  }
  return R;
}
const b2i = (b: Buffer) => BigInt(`0x${b.toString('hex') || '0'}`);
function derInt(x: bigint): Buffer {
  let h = x.toString(16);
  if (h.length % 2) h = `0${h}`;
  let b = Buffer.from(h, 'hex');
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return Buffer.concat([Buffer.from([0x02, b.length]), b]);
}

/** The private scalar of a P-256 KeyObject. */
export function scalarOf(key: KeyObject): bigint {
  return b2i(Buffer.from(key.export({ format: 'jwk' }).d as string, 'base64url'));
}

/** A P-256 key pair from a fixed scalar (for vectors shared with Go). */
export function keyFromScalar(d: bigint): { priv: KeyObject; pub: KeyObject; spkiB64: string } {
  const Q = mul(d, G)!;
  const b = (x: bigint) => Buffer.from(x.toString(16).padStart(64, '0'), 'hex').toString('base64url');
  const jwk = { kty: 'EC', crv: 'P-256', x: b(Q[0]), y: b(Q[1]), d: b(d) };
  const priv = createPrivateKey({ key: jwk, format: 'jwk' });
  const pub = createPublicKey(priv);
  return { priv, pub, spkiB64: (pub.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64') };
}

/** DER ECDSA signature of a 32-byte digest under scalar d (low-s, like KMS and Go). */
export function signDigest(d: bigint, digest: Uint8Array): Buffer {
  const e = b2i(Buffer.from(digest));
  for (;;) {
    const k = mod(b2i(randomBytes(40)), n - 1n) + 1n;
    const R = mul(k, G)!;
    const r = mod(R[0], n);
    if (r === 0n) continue;
    let s = mod(inv(k, n) * (e + r * d), n);
    if (s === 0n) continue;
    if (s > n / 2n) s = n - s;
    const body = Buffer.concat([derInt(r), derInt(s)]);
    return Buffer.concat([Buffer.from([0x30, body.length]), body]);
  }
}
