// The account site's vault modules (sites/account/js): opening the sealed
// recovery code (VAULT-MESSAGING §11.11.2), the QR it is drawn as, and the
// wording helpers. Browser ES modules, loaded through test/site-esm-transform.cjs;
// WebCrypto is Node's (globalThis.crypto), the same API the browser has.

import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-require-imports */
const rc = require('../sites/account/js/recovery-code.js');
const qr = require('../sites/account/js/qr.js');
const vt = require('../sites/account/js/vault-text.js');
const sc = require('../sites/account/js/site-config.js');
const jsQR = require('jsqr');
/* eslint-enable @typescript-eslint/no-require-imports */

// Typed loosely: the DOM BufferSource types fight Uint8Array<ArrayBufferLike> here.
const subtle: any = webcrypto.subtle; // eslint-disable-line @typescript-eslint/no-explicit-any
const SIZE = 5252;

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const hex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));

/**
 * The Go reference's vector (vettid-vault vms/altchan.SealRecoveryCode).
 * TODO(VAULT-MESSAGING 0.10.6 §15 item 19): switch to vettid-vault's shared
 * vector `testdata/vectors/recovery.json` once it lands on vettid-vault main
 * (not there on 2026-10-05); until then this is a copy made with the same
 * generator, so the portal and the apps may still test against different bytes.
 */
const vector = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'recovery', 'seal-vector.json'), 'utf8'));

async function importBrowserKey(dHex: string, pubHex: string) {
  const pub = hex(pubHex);
  return subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: b64url(hex(dHex)), x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

/** The enclave side, in WebCrypto: seal `body` (raw plaintext before padding) to `browserKey`. */
async function seal(browserKey: Uint8Array, vaultId: string, recoveryId: string, body: Uint8Array, opts: { pad?: (pt: Uint8Array) => void } = {}) {
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephPub = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const peer = await subtle.importKey('raw', browserKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: peer }, eph.privateKey, 256);
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const salt = new Uint8Array([...ephPub, ...browserKey]);
  const info = new TextEncoder().encode(`vettid/vms/2/recovery-code-seal\0${vaultId}\0${recoveryId}`);
  const k = await subtle.importKey('raw', await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikm, 256), 'AES-GCM', false, ['encrypt']);
  const pt = new Uint8Array(SIZE - 78 - 16);
  pt.set(body);
  opts.pad?.(pt);
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const header = new Uint8Array([1, ...ephPub, ...nonce]);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: header }, k, pt));
  return new Uint8Array([...header, ...ct]);
}

const VAULT = 'fedcba9876543210fedcba9876543210';
const REC = '01JB30000000000000000000AB';
const CODE = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
const json = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const goodBody = () => json({ v: 1, vault_id: VAULT, recovery_id: REC, code: CODE, not_before: '2026-10-06T12:00:00.000Z', expires_at: '2026-10-07T12:00:00.000Z' });

async function browserPair() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return { privateKey: pair.privateKey, browserKey: new Uint8Array(await subtle.exportKey('raw', pair.publicKey)) };
}

describe('sealed recovery code: the Go reference vector', () => {
  test('opens to the code, the times and the ids', async () => {
    const privateKey = await importBrowserKey(vector.browser_private_d, vector.browser_public);
    const sealed = rc.fromBase64(vector.sealed_code);
    expect(sealed).toHaveLength(SIZE);
    const r = await rc.openSealedCode({ privateKey, browserKey: hex(vector.browser_public), sealed, vaultId: vector.vault_id, recoveryId: vector.recovery_id }, subtle);
    expect(r).toEqual({ code: vector.code, notBefore: vector.not_before, expiresAt: vector.expires_at });
  });

  test('opens the vault\'s refusal (no_credential)', async () => {
    const privateKey = await importBrowserKey(vector.browser_private_d, vector.browser_public);
    const r = await rc.openSealedCode({ privateKey, browserKey: hex(vector.browser_public), sealed: rc.fromBase64(vector.sealed_refusal), vaultId: vector.vault_id, recoveryId: vector.recovery_id }, subtle);
    expect(r).toEqual({ error: 'no_credential' });
  });

  test('the QR payload is byte for byte the reference RecoveryQR', () => {
    expect(rc.qrPayload(vector.vault_id, vector.recovery_id, vector.code)).toBe(vector.qr_payload);
  });

  test('another recovery id or vault id derives another key: unopenable', async () => {
    const privateKey = await importBrowserKey(vector.browser_private_d, vector.browser_public);
    const sealed = rc.fromBase64(vector.sealed_code);
    const base = { privateKey, browserKey: hex(vector.browser_public), sealed };
    await expect(rc.openSealedCode({ ...base, vaultId: vector.vault_id, recoveryId: '01JB2Z6V9K3M4N5P6Q7R8S9T0W' }, subtle)).rejects.toMatchObject({ kind: 'unopenable' });
    await expect(rc.openSealedCode({ ...base, vaultId: '0'.repeat(32), recoveryId: vector.recovery_id }, subtle)).rejects.toMatchObject({ kind: 'unopenable' });
  });
});

describe('sealed recovery code: WebCrypto round trips', () => {
  test('a non-extractable browser key opens what the enclave side sealed', async () => {
    const { privateKey, browserKey } = await browserPair();
    expect(privateKey.extractable).toBe(false);
    const sealed = await seal(browserKey, VAULT, REC, goodBody());
    expect(sealed).toHaveLength(SIZE);
    await expect(rc.openSealedCode({ privateKey, browserKey, sealed, vaultId: VAULT, recoveryId: REC }, subtle))
      .resolves.toEqual({ code: CODE, notBefore: '2026-10-06T12:00:00.000Z', expiresAt: '2026-10-07T12:00:00.000Z' });
  });

  test('every tampered region, another key, or random bytes: unopenable', async () => {
    const { privateKey, browserKey } = await browserPair();
    const sealed = await seal(browserKey, VAULT, REC, goodBody());
    for (const at of [10, 70, 77, 78, 2000, SIZE - 1]) {
      const bad = sealed.slice();
      bad[at] ^= 0x01;
      await expect(rc.openSealedCode({ privateKey, browserKey, sealed: bad, vaultId: VAULT, recoveryId: REC }, subtle)).rejects.toMatchObject({ kind: 'unopenable' });
    }
    const other = await browserPair();
    await expect(rc.openSealedCode({ ...other, sealed, vaultId: VAULT, recoveryId: REC }, subtle)).rejects.toMatchObject({ kind: 'unopenable' });
    const random = webcrypto.getRandomValues(new Uint8Array(SIZE));
    random[0] = 1;
    await expect(rc.openSealedCode({ privateKey, browserKey, sealed: random, vaultId: VAULT, recoveryId: REC }, subtle)).rejects.toMatchObject({ kind: 'unopenable' });
  });

  test('wrong size or version: malformed', async () => {
    const { privateKey, browserKey } = await browserPair();
    const sealed = await seal(browserKey, VAULT, REC, goodBody());
    const v2 = sealed.slice();
    v2[0] = 2;
    for (const bad of [sealed.slice(0, SIZE - 1), new Uint8Array([...sealed, 0]), v2]) {
      await expect(rc.openSealedCode({ privateKey, browserKey, sealed: bad, vaultId: VAULT, recoveryId: REC }, subtle)).rejects.toMatchObject({ kind: 'malformed' });
    }
  });

  test('the plaintext is checked strictly', async () => {
    const { privateKey, browserKey } = await browserPair();
    const open = async (body: Uint8Array, opts = {}) => rc.openSealedCode({ privateKey, browserKey, sealed: await seal(browserKey, VAULT, REC, body, opts), vaultId: VAULT, recoveryId: REC }, subtle);
    const base = { v: 1, vault_id: VAULT, recovery_id: REC, code: CODE, not_before: '2026-10-06T12:00:00.000Z', expires_at: '2026-10-07T12:00:00.000Z' };
    await expect(open(json({ ...base, vault_id: '1'.repeat(32) }))).rejects.toMatchObject({ kind: 'mismatch' });
    await expect(open(json({ ...base, recovery_id: '01JB30000000000000000000AC' }))).rejects.toMatchObject({ kind: 'mismatch' });
    await expect(open(json({ ...base, v: 2 }))).rejects.toMatchObject({ kind: 'malformed' });
    await expect(open(json({ ...base, code: 'abcdefghjkmnpqrstvwxyz0123456789' }))).rejects.toMatchObject({ kind: 'malformed' });
    await expect(open(json({ ...base, code: CODE.slice(1) }))).rejects.toMatchObject({ kind: 'malformed' });
    await expect(open(json({ ...base, not_before: '2026-10-06T12:00:00Z' }))).rejects.toMatchObject({ kind: 'malformed' });
    await expect(open(new TextEncoder().encode('{"v":1,'))).rejects.toMatchObject({ kind: 'malformed' });
    await expect(open(goodBody(), { pad: (pt: Uint8Array) => { pt[pt.length - 1] = 1; } })).rejects.toMatchObject({ kind: 'malformed' });
    await expect(open(json({ v: 1, vault_id: VAULT, recovery_id: REC, error: '' }))).rejects.toMatchObject({ kind: 'malformed' });
    await expect(open(json({ v: 1, vault_id: VAULT, recovery_id: REC, error: 'no_credential' }))).resolves.toEqual({ error: 'no_credential' });
  });
});

describe('recovery-code helpers', () => {
  test('canonical base64 only', () => {
    expect(rc.fromBase64('AAEC')).toEqual(new Uint8Array([0, 1, 2]));
    expect(rc.toBase64(new Uint8Array([0, 1, 2]))).toBe('AAEC');
    for (const bad of ['AAE', 'AA EC', 'AAF=', 'AA-_', 'AAEC\n', 123]) expect(rc.fromBase64(bad)).toBeNull();
  });

  test('codeGroups: eight groups of four', () => {
    expect(rc.codeGroups(CODE)).toEqual(['ABCD', 'EFGH', 'JKMN', 'PQRS', 'TVWX', 'YZ01', '2345', '6789']);
  });

  test('qrPayload refuses malformed input', () => {
    expect(() => rc.qrPayload(VAULT, REC, 'short')).toThrow();
    expect(() => rc.qrPayload('XYZ', REC, CODE)).toThrow();
  });

  test('newUlid: canonical, time-ordered, 80 random bits', () => {
    const t = Date.UTC(2026, 9, 5, 12, 0, 0);
    const a = rc.newUlid(t, () => new Uint8Array(10));
    expect(a).toMatch(rc.ULID_RE);
    expect(a.slice(10)).toBe('0'.repeat(16));
    expect(rc.newUlid(t, () => new Uint8Array(10).fill(0xff)).slice(10)).toBe('Z'.repeat(16));
    expect(rc.newUlid(t + 1) > a).toBe(true);
    // Same time encoding as the canonical ULID spec: 01ARYZ6S41 = 1469918176385.
    expect(rc.newUlid(1469918176385, () => new Uint8Array(10)).slice(0, 10)).toBe('01ARYZ6S41');
  });

  test('tokenFromHash: only #t=<43 base64url chars>', () => {
    const tok = 'A'.repeat(42) + '_';
    expect(rc.tokenFromHash(`#t=${tok}`)).toBe(tok);
    expect(rc.tokenFromHash(`#t=${tok}x`)).toBeNull();
    expect(rc.tokenFromHash('#t=abc')).toBeNull();
    expect(rc.tokenFromHash('')).toBeNull();
  });
});

describe('QR code (vendored qrcode-generator 2.0.4)', () => {
  test('the vendored file is the pinned, unmodified release', () => {
    const src = readFileSync(join(__dirname, '..', 'sites', 'account', 'js', 'vendor', 'qrcode-generator.js'));
    const sum = createHash('sha256').update(src).digest('hex');
    expect(sum).toBe('ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0');
    const notes = readFileSync(join(__dirname, '..', 'sites', 'account', 'js', 'vendor', 'qrcode-generator.LICENSE.txt'), 'utf8');
    expect(notes).toContain(sum);
    expect(notes).toContain('MIT License');
  });

  /** Rasterize the module grid as the SVG draws it (4-module quiet zone) and decode it. */
  function decode(modules: boolean[][], scale = 4) {
    const n = modules.length + 8;
    const w = n * scale;
    const px = new Uint8ClampedArray(w * w * 4).fill(255);
    modules.forEach((row, r) => row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const i = (((r + 4) * scale + y) * w + (c + 4) * scale + x) * 4;
          px[i] = 0;
          px[i + 1] = 0;
          px[i + 2] = 0;
        }
      }
    }));
    return jsQR(px, w, w);
  }

  test('round trip: the recovery payload decodes back exactly', () => {
    const payload = rc.qrPayload(vector.vault_id, vector.recovery_id, vector.code);
    const modules = qr.qrModules(payload);
    expect(modules.length).toBe(49); // version 8 at level M for 146 bytes
    const got = decode(modules);
    expect(got).not.toBeNull();
    expect(got.data).toBe(payload);
  });

  test('the SVG path covers exactly the dark modules', () => {
    const modules = qr.qrModules('{"v":1,"t":"r"}');
    const n = modules.length;
    const drawn = Array.from({ length: n }, () => new Array(n).fill(false));
    for (const m of qr.qrPath(modules).matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const [x, y, len] = [Number(m[1]) - 4, Number(m[2]) - 4, Number(m[3])];
      for (let i = 0; i < len; i += 1) drawn[y][x + i] = true;
    }
    expect(drawn).toEqual(modules);
  });

  test('refuses non-ASCII input', () => {
    expect(() => qr.qrModules('café')).toThrow();
  });
});

describe('vault wording', () => {
  test('every release notice has a title and text; null without one', () => {
    for (const notice of ['update_available', 'final_warning', 'ended', 'rescue', 'unavailable']) {
      const n = vt.releaseNotice({ number: 3, status: 'retired', ends_at: '2027-01-01T00:00:00Z', newest_active: 5, notice });
      expect(n.title).toBeTruthy();
      expect(n.text).toBeTruthy();
    }
    expect(vt.releaseNotice({ number: 3, status: 'active', ends_at: null, newest_active: 3, notice: null })).toBeNull();
    expect(vt.releaseNotice(null)).toBeNull();
    expect(vt.releaseNotice({ number: 2, notice: 'update_available', newest_active: 3 }).title).toBe('Update available: release 3');
  });

  test('the vault service pause (MEMBER-API 1.2.0): a generic notice when status says paused, none otherwise', () => {
    const n = vt.servicePaused({ vault: null, service: 'paused' });
    expect(n).toEqual({ tone: 'warn', title: 'Vault service is paused for maintenance', text: expect.stringContaining('locking still works') });
    for (const st of [{ vault: null, service: 'available' }, { vault: null }, null, undefined]) expect(vt.servicePaused(st)).toBeNull();
  });

  test('the account page shows the pause notice in every vault view', () => {
    const src = readFileSync(join(__dirname, '..', 'sites', 'account', 'js', 'vault.js'), 'utf8');
    expect(src.match(/pausedNotice\(\),/g)).toHaveLength(3); // enrolling, a vault, no vault
  });

  test('the states the API returns all have labels', () => {
    for (const s of ['enrolling', 'locked', 'unlocked']) expect(vt.vaultState(s)[0]).not.toBe(s);
    for (const s of ['active', 'deprecated', 'retired', 'removed', 'canary', 'unknown']) expect(vt.releaseStatus(s)[0]).not.toBe(s);
  });

  test('timeUntil', () => {
    const now = Date.UTC(2026, 9, 5, 12, 0, 0);
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(vt.timeUntil(at(30_000), now)).toBe('less than a minute');
    expect(vt.timeUntil(at(25 * 60_000), now)).toBe('about 25 minutes');
    expect(vt.timeUntil(at(3 * 3600_000 + 20 * 60_000), now)).toBe('3 hours 20 minutes');
    expect(vt.timeUntil(at(23 * 3600_000 + 50 * 60_000), now)).toBe('about 24 hours');
  });
});

describe('site config (config.json)', () => {
  test('prod and staging, with and without an app link', () => {
    const log = 'https://vettid.org/security/releases/';
    expect(sc.normalize({ stage: 'prod', release_log_url: log, android_app_url: null }))
      .toEqual({ stage: 'prod', staging: false, releaseLogUrl: log, androidAppUrl: null });
    expect(sc.normalize({ stage: 'staging', release_log_url: log, android_app_url: 'https://example.org/app' }))
      .toEqual({ stage: 'staging', staging: true, releaseLogUrl: log, androidAppUrl: 'https://example.org/app' });
  });

  test('anything but an https link is ignored', () => {
    expect(sc.normalize({ stage: 'prod', android_app_url: 'javascript:alert(1)' }).androidAppUrl).toBeNull();
    expect(sc.normalize({ stage: 'prod', android_app_url: 'http://x' }).androidAppUrl).toBeNull();
    expect(sc.normalize(null).releaseLogUrl).toBe('https://vettid.org/security/releases/');
    expect(sc.normalize({ release_log_url: 'javascript:x' }).releaseLogUrl).toBe('https://vettid.org/security/releases/');
  });
});
