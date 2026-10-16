import { createHash, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockClient } from 'aws-sdk-client-mock';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { KEY_ID_RE, RECOVERY_REQUEST_LABEL, recoveryRequestSigningString, signRecoveryRequest, signedAtOf } from '../../lambda/shared/recovery-sign';
import { keyFromScalar, signDigest } from './ecdsa-prehash';

/**
 * Signed recovery requests (VAULT-MESSAGING 0.33.0 §11.14.8; MEMBER-API
 * 2.7.0). The vectors come from vettid-vault's own builder and signer
 * (test/fixtures/recovery/request-signature-vector.json): the member API
 * must build the same bytes, and a signature over them must verify the way
 * the enclave verifies it (ECDSA P-256, SHA-256 of the string, DER).
 */
const V = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'recovery', 'request-signature-vector.json'), 'utf8'));
const BK = Buffer.from(V.browser_key_hex, 'hex');
const goPub = createPublicKey({ key: Buffer.from(V.spki, 'base64'), format: 'der', type: 'spki' });
const D = BigInt(`0x${createHash('sha256').update(V.key_scalar_seed).digest('hex')}`);
const kmsKey = keyFromScalar(D);

describe('the signing string (vettid-vault vms/recovery.RequestSigningString)', () => {
  test('reproduces the release R vectors byte for byte', () => {
    expect(BK).toHaveLength(65);
    expect(recoveryRequestSigningString('recovery', V.vault_id, V.user_guid, V.recovery.request_id, V.signed_at, BK)).toBe(V.recovery.signing_string);
    expect(recoveryRequestSigningString('recovery_cancel', V.vault_id, V.user_guid, V.recovery_cancel.request_id, V.signed_at)).toBe(V.recovery_cancel.signing_string);
  });

  test('seven lines, the label first, no trailing newline; the last line is hex(SHA-256) of the raw 65-byte point, not of its base64', () => {
    const s = recoveryRequestSigningString('recovery', 'v', 'u', 'r', '2026-10-15T12:00:00Z', BK);
    const lines = s.split('\n');
    expect(lines).toEqual([RECOVERY_REQUEST_LABEL, 'recovery', 'v', 'u', 'r', '2026-10-15T12:00:00Z', createHash('sha256').update(BK).digest('hex')]);
    expect(lines[6]).not.toBe(createHash('sha256').update(BK.toString('base64')).digest('hex'));
    expect(s.endsWith('\n')).toBe(false);
    // A cancel's last line is empty, so the string ends in exactly one newline.
    expect(recoveryRequestSigningString('recovery_cancel', 'v', 'u', 'r', 't').split('\n')).toEqual([RECOVERY_REQUEST_LABEL, 'recovery_cancel', 'v', 'u', 'r', 't', '']);
  });

  test.each<[string, () => string]>([
    ['an empty member', () => recoveryRequestSigningString('recovery', '', 'u', 'r', 't', BK)],
    ['a member with a newline', () => recoveryRequestSigningString('recovery', 'v', 'u\nx', 'r', 't', BK)],
    ['a member with a carriage return', () => recoveryRequestSigningString('recovery_cancel', 'v', 'u', 'r\r', 't')],
    ['a recovery without its browser key', () => recoveryRequestSigningString('recovery', 'v', 'u', 'r', 't')],
    ['a recovery with an empty browser key', () => recoveryRequestSigningString('recovery', 'v', 'u', 'r', 't', Buffer.alloc(0))],
    ['a cancel with a browser key', () => recoveryRequestSigningString('recovery_cancel', 'v', 'u', 'r', 't', BK)],
    ['another op', () => recoveryRequestSigningString('unlock' as never, 'v', 'u', 'r', 't')],
  ])('refuses %s (as the enclave\'s builder does)', (_n, f) => {
    expect(f).toThrow();
  });
});

describe('signed_at: RFC 3339 in UTC to the second', () => {
  test('whole seconds, Z, no fraction (the enclave re-formats and compares)', () => {
    expect(signedAtOf(Date.UTC(2026, 9, 15, 12, 0, 0, 999))).toBe('2026-10-15T12:00:00Z');
    expect(signedAtOf(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02T03:04:05Z');
    expect(signedAtOf(Date.now())).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('cross-language: Go signs, the member API verifies; the member API signs, Go verifies', () => {
  test('the fixed key is the one in the vector', () => {
    expect(kmsKey.spkiB64).toBe(V.spki);
  });

  test("vettid-vault's signatures verify over the strings the member API builds", () => {
    const s1 = recoveryRequestSigningString('recovery', V.vault_id, V.user_guid, V.recovery.request_id, V.signed_at, BK);
    const s2 = recoveryRequestSigningString('recovery_cancel', V.vault_id, V.user_guid, V.recovery_cancel.request_id, V.signed_at);
    expect(cryptoVerify('sha256', Buffer.from(s1), { key: goPub, dsaEncoding: 'der' }, Buffer.from(V.recovery.go_sig, 'base64'))).toBe(true);
    expect(cryptoVerify('sha256', Buffer.from(s2), { key: goPub, dsaEncoding: 'der' }, Buffer.from(V.recovery_cancel.go_sig, 'base64'))).toBe(true);
    // ...and not over any other string (a one-character change, or the other op's signature).
    expect(cryptoVerify('sha256', Buffer.from(s1.replace('test-vault-0001', 'test-vault-0002')), { key: goPub, dsaEncoding: 'der' }, Buffer.from(V.recovery.go_sig, 'base64'))).toBe(false);
    expect(cryptoVerify('sha256', Buffer.from(s1), { key: goPub, dsaEncoding: 'der' }, Buffer.from(V.recovery_cancel.go_sig, 'base64'))).toBe(false);
  });

  test('a DIGEST signature (as KMS makes it) is the same ECDSA as node\'s over the string, and verifies like the enclave\'s check', () => {
    const s = V.recovery.signing_string as string;
    const sig = signDigest(D, createHash('sha256').update(s).digest());
    expect(cryptoVerify('sha256', Buffer.from(s), { key: goPub, dsaEncoding: 'der' }, sig)).toBe(true);
    // node's own signature over the string verifies the same way (the equivalence the KMS stand-in relies on).
    const own = cryptoSign('sha256', Buffer.from(s), { key: kmsKey.priv, dsaEncoding: 'der' });
    expect(cryptoVerify('sha256', Buffer.from(s), { key: kmsKey.pub, dsaEncoding: 'der' }, own)).toBe(true);
  });
});

describe('signRecoveryRequest: KMS Sign with the recovery request key', () => {
  const kms = mockClient(KMSClient);
  const KEY_ARN = 'arn:aws:kms:us-east-1:449757308783:key/11111111-2222-4333-8444-555555555555';
  const KEY_ID = '11111111-2222-4333-8444-555555555555';
  const NOW = Date.UTC(2026, 9, 15, 12, 0, 0, 400);
  beforeEach(() => {
    kms.reset();
    process.env.RECOVERY_REQUEST_KEY_ARN = KEY_ARN;
    process.env.RECOVERY_REQUEST_KEY_ID = KEY_ID;
    kms.on(SignCommand).callsFake((i) => ({ KeyId: KEY_ARN, SigningAlgorithm: 'ECDSA_SHA_256', Signature: signDigest(D, i.Message) }));
  });

  test('signs the SHA-256 digest of exactly the vector string (MessageType DIGEST, ECDSA_SHA_256), by the key ARN; carries key_id, signed_at and base64 DER', async () => {
    const out = await signRecoveryRequest('recovery', V.vault_id, V.user_guid, V.recovery.request_id, BK, NOW);
    const [call] = kms.commandCalls(SignCommand);
    expect(call.args[0].input).toEqual({
      KeyId: KEY_ARN,
      Message: createHash('sha256').update(V.recovery.signing_string).digest(),
      MessageType: 'DIGEST',
      SigningAlgorithm: 'ECDSA_SHA_256',
    });
    expect(out.signed_at).toBe(V.signed_at);
    expect(out.key_id).toBe(KEY_ID);
    expect(out.sig).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(cryptoVerify('sha256', Buffer.from(V.recovery.signing_string), { key: goPub, dsaEncoding: 'der' }, Buffer.from(out.sig, 'base64'))).toBe(true);
  });

  test('a cancel: the empty last line', async () => {
    const out = await signRecoveryRequest('recovery_cancel', V.vault_id, V.user_guid, V.recovery_cancel.request_id, undefined, NOW);
    expect(kms.commandCalls(SignCommand)[0].args[0].input.Message).toEqual(createHash('sha256').update(V.recovery_cancel.signing_string).digest());
    expect(cryptoVerify('sha256', Buffer.from(V.recovery_cancel.signing_string), { key: goPub, dsaEncoding: 'der' }, Buffer.from(out.sig, 'base64'))).toBe(true);
  });

  test.each<[string, Record<string, unknown>]>([
    ['no signature', { Signature: undefined }],
    ['another algorithm', { SigningAlgorithm: 'ECDSA_SHA_384' }],
    ['not DER', { Signature: Buffer.alloc(64, 1) }],
    ['longer than the enclave reads (80 bytes)', { Signature: Buffer.concat([Buffer.from([0x30]), Buffer.alloc(80, 1)]) }],
  ])('refuses an answer with %s (nothing is sent then)', async (_n, over) => {
    kms.on(SignCommand).callsFake((i) => ({ KeyId: KEY_ARN, SigningAlgorithm: 'ECDSA_SHA_256', Signature: signDigest(D, i.Message), ...over }));
    await expect(signRecoveryRequest('recovery_cancel', 'v', 'u', 'r', undefined, NOW)).rejects.toThrow(/no usable signature/);
  });

  test('a KMS error propagates', async () => {
    kms.on(SignCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    await expect(signRecoveryRequest('recovery_cancel', 'v', 'u', 'r', undefined, NOW)).rejects.toThrow('denied');
  });

  test('without the key configured, or with a key id a release would refuse, nothing reaches KMS', async () => {
    delete process.env.RECOVERY_REQUEST_KEY_ARN;
    await expect(signRecoveryRequest('recovery_cancel', 'v', 'u', 'r')).rejects.toThrow(/RECOVERY_REQUEST_KEY_ARN/);
    process.env.RECOVERY_REQUEST_KEY_ARN = KEY_ARN;
    process.env.RECOVERY_REQUEST_KEY_ID = 'key id with spaces';
    await expect(signRecoveryRequest('recovery_cancel', 'v', 'u', 'r')).rejects.toThrow(/key id/);
    expect(kms.commandCalls(SignCommand)).toHaveLength(0);
    // What vettid-vault releasecfg accepts: [A-Za-z0-9_:/-], 1 to 128 characters (a KMS key id or ARN).
    expect(KEY_ID_RE.test(KEY_ID) && KEY_ID_RE.test(KEY_ARN)).toBe(true);
    expect(KEY_ID_RE.test('a'.repeat(129)) || KEY_ID_RE.test('') || KEY_ID_RE.test('a.b')).toBe(false);
  });
});
