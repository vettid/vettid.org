/**
 * Signed recovery requests (VAULT-MESSAGING 0.33.0 §11.14.8, MEMBER-API 2.7.0
 * "Recovery from release R"; release R).
 *
 * The member API signs every `recovery` and `recovery_cancel` queue
 * operation with the recovery request key, an ECDSA P-256 key that exists
 * only in AWS KMS (VettidOrgDataStack; its policy admits the vault
 * function's role alone to kms:Sign). The enclave verifies the signature
 * under a key its release pins (`recovery_request_keys`) before it locks a
 * running vault or touches the header, and refuses a `signed_at` more than 5
 * minutes from its clock.
 *
 * What is signed, with literal newlines and no trailing newline, exactly as
 * vettid-vault `vms/recovery.RequestSigningString` builds it:
 *
 *   "vettid/vms/2/recovery-request" \n op \n vault_id \n user_guid \n
 *   request_id \n signed_at \n hex(SHA-256(browser_key))
 *
 * `browser_key` is the 65 raw bytes of the browser's P-256 point (not its
 * base64); for a cancel the last line is empty. The signature is ECDSA with
 * SHA-256 over those bytes (KMS: MessageType DIGEST, the digest computed
 * here), DER-encoded; the queue message carries `signed_at`, `key_id` and
 * `sig` (standard base64 of the DER) in the clear.
 *
 * It does nothing against VettID as a whole, which holds the key; it keeps
 * the power to start or cancel a recovery from someone who controls the
 * vault account's host but not the member API.
 */
import { createHash } from 'node:crypto';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { env } from './aws';

export const RECOVERY_REQUEST_LABEL = 'vettid/vms/2/recovery-request';
export type RecoveryRequestOp = 'recovery' | 'recovery_cancel';

/** The members a signed queue operation carries. */
export interface RecoverySignature {
  signed_at: string;
  key_id: string;
  sig: string;
}

/** vettid-vault releasecfg `validKeyID`: what a release accepts as a `key_id`. */
export const KEY_ID_RE = /^[A-Za-z0-9_:/-]{1,128}$/;
/** The enclave refuses a signature longer than this (enclave/wire.go); a P-256 DER signature is at most 72 bytes. */
export const MAX_SIG_BYTES = 80;

/** RFC 3339 in UTC to the second, `YYYY-MM-DDTHH:MM:SSZ` (the enclave requires exactly this form). */
export function signedAtOf(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

/**
 * The signing string, or a thrown Error for members the enclave's builder
 * would refuse (empty, or holding CR or LF; a `recovery` without its browser
 * key; a cancel with one).
 */
export function recoveryRequestSigningString(
  op: RecoveryRequestOp,
  vaultId: string,
  userGuid: string,
  requestId: string,
  signedAt: string,
  browserKey?: Uint8Array,
): string {
  for (const s of [op, vaultId, userGuid, requestId, signedAt]) {
    if (typeof s !== 'string' || s === '' || /[\r\n]/.test(s)) throw new Error('recovery signing: bad member');
  }
  let last = '';
  if (op === 'recovery') {
    if (!browserKey || browserKey.length === 0) throw new Error('recovery signing: no browser key');
    last = createHash('sha256').update(browserKey).digest('hex');
  } else if (op === 'recovery_cancel') {
    if (browserKey !== undefined) throw new Error('recovery signing: a cancel has no browser key');
  } else {
    throw new Error('recovery signing: bad op');
  }
  return [RECOVERY_REQUEST_LABEL, op, vaultId, userGuid, requestId, signedAt, last].join('\n');
}

let kms: KMSClient | undefined;
const client = () => (kms ??= new KMSClient({}));

/**
 * Sign one recovery operation with the recovery request key. Throws if the
 * key is not configured, KMS refuses, or the answer is not a signature the
 * enclave would parse; the caller then sends nothing.
 */
export async function signRecoveryRequest(
  op: RecoveryRequestOp,
  vaultId: string,
  userGuid: string,
  requestId: string,
  browserKey?: Uint8Array,
  nowMs: number = Date.now(),
): Promise<RecoverySignature> {
  const keyArn = env('RECOVERY_REQUEST_KEY_ARN');
  const keyId = env('RECOVERY_REQUEST_KEY_ID');
  if (!KEY_ID_RE.test(keyId)) throw new Error('recovery signing: RECOVERY_REQUEST_KEY_ID is not a key id a release accepts');
  const signedAt = signedAtOf(nowMs);
  const digest = createHash('sha256').update(recoveryRequestSigningString(op, vaultId, userGuid, requestId, signedAt, browserKey), 'utf8').digest();
  const out = await client().send(new SignCommand({ KeyId: keyArn, Message: digest, MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256' }));
  const sig = out.Signature ? Buffer.from(out.Signature) : null;
  if (!sig || sig.length < 8 || sig.length > MAX_SIG_BYTES || sig[0] !== 0x30 || out.SigningAlgorithm !== 'ECDSA_SHA_256') {
    throw new Error('recovery signing: KMS answered no usable signature');
  }
  return { signed_at: signedAt, key_id: keyId, sig: sig.toString('base64') };
}
