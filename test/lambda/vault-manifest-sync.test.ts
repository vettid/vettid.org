import * as fs from 'fs';
import * as path from 'path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mockClient } from 'aws-sdk-client-mock';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DeleteCommand, DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LABEL, ManifestError, keyId, parseManifest, verifyServed } from '../../lambda/shared/manifest';

/**
 * test/fixtures/manifest/release.json is a verbatim copy of vettid-vault
 * testdata/vectors/release.json (commit fb470e9): a manifest signed with a
 * TEST key, before and after VAULT-MESSAGING 0.10.0 (removed, ends_at).
 */
const V = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/manifest/release.json'), 'utf8'));

Object.assign(process.env, {
  TABLE_VAULT_RELEASES: 'releases', DATA_BUCKET: 'bucket', SSM_RELEASES_PATH: '/vettid-org/prod/vault/releases/',
  MANIFEST_URL: 'https://vettid.org/.well-known/vettid/pcr-manifest.json', PINNED_KEYS: JSON.stringify([V.manifest_key_spki_b64]),
});
/* eslint-disable @typescript-eslint/no-require-imports */
const sync = require('../../lambda/vault/manifest-sync');
/* eslint-enable */

describe('manifest verification (vettid-vault vectors)', () => {
  test('key_id is the first 8 bytes of SHA-256(SPKI)', () => {
    expect(keyId(V.manifest_key_spki_b64)).toBe(V.manifest_key_id);
  });

  test('the recorded served documents verify and parse', () => {
    const m = verifyServed(V.served, [V.manifest_key_spki_b64]);
    expect(m.serial).toBe(7);
    expect(m.sha256).toBe(V.manifest_sha256_hex);
    expect(m.releases.map((r) => [r.release, r.status])).toEqual([[3, 'deprecated'], [4, 'active']]);
    const m10 = verifyServed(V.manifest_0_10_0.served, [V.manifest_key_spki_b64]);
    expect(m10.sha256).toBe(V.manifest_0_10_0.manifest_sha256_hex);
    expect(m10.releases.some((r) => r.status === 'removed')).toBe(true);
    expect(m10.releases.some((r) => r.ends_at)).toBe(true);
    expect(V.manifest_0_10_0.object_key).toBe(`manifests/${m10.sha256}.json`);
  });

  test('an unpinned key, a changed byte or a bad signature is refused', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(() => verifyServed(V.served, [other])).toThrow(/not pinned/);
    const doc = JSON.parse(V.served);
    const bytes = Buffer.from(doc.manifest, 'base64');
    bytes[bytes.length - 3] ^= 1;
    expect(() => verifyServed(JSON.stringify({ ...doc, manifest: bytes.toString('base64') }), [V.manifest_key_spki_b64])).toThrow(ManifestError);
    expect(() => verifyServed(JSON.stringify({ ...doc, sig: Buffer.alloc(64).toString('base64') }), [V.manifest_key_spki_b64])).toThrow(/signature/);
    expect(() => verifyServed('not json', [V.manifest_key_spki_b64])).toThrow(/JSON/);
  });

  const good = JSON.parse(V.manifest);
  const bad = (f: (m: any) => void) => {
    const m = JSON.parse(V.manifest);
    f(m);
    return () => parseManifest(Buffer.from(JSON.stringify(m)));
  };
  test.each([
    ['unknown status', (m: any) => (m.releases[0].status = 'canary')],
    ['debug PCR0', (m: any) => (m.releases[0].pcr0 = '0'.repeat(96))],
    ['uppercase PCR', (m: any) => (m.releases[0].pcr1 = m.releases[0].pcr1.toUpperCase().replace(/1/g, 'A'))],
    ['unsorted releases', (m: any) => m.releases.reverse()],
    ['duplicate pcr0', (m: any) => (m.releases[1].pcr0 = m.releases[0].pcr0)],
    ['v 2', (m: any) => (m.v = 2)],
    ['serial 0', (m: any) => (m.serial = 0)],
    ['fractional seconds', (m: any) => (m.issued_at = '2026-10-02T12:00:00.5Z')],
    ['http notes', (m: any) => (m.releases[0].notes = 'http://vettid.org/x')],
    ['bad ends_at', (m: any) => (m.releases[0].ends_at = '2027-01-01')],
    ['empty releases', (m: any) => (m.releases = [])],
  ])('format refuses %s', (_n, f) => {
    expect(bad(f)).toThrow(ManifestError);
  });

  test('unknown members are ignored (additive fields)', () => {
    expect(parseManifest(Buffer.from(JSON.stringify({ ...good, future: 1 }))).serial).toBe(7);
  });

  test('a document signed with a fresh key verifies when that key is pinned', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const bytes = Buffer.from(V.manifest);
    const sig = sign('sha256', Buffer.concat([Buffer.from(LABEL), Buffer.from([0]), bytes]), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    const served = JSON.stringify({ manifest: bytes.toString('base64'), sig: sig.toString('base64'), key_id: keyId(spki) });
    expect(verifyServed(served, [V.manifest_key_spki_b64, spki]).serial).toBe(7);
  });
});

describe('sync plan', () => {
  const m = verifyServed(V.served, [V.manifest_key_spki_b64]);
  const [r3, r4] = m.releases;

  test('upserts every listed release; available from the release stacks', () => {
    const p = sync.syncPlan(m, [], new Set([4]));
    expect(p.reject).toBeUndefined();
    expect(p.upserts.map((u: any) => [u.number, u.status, u.available])).toEqual([[3, 'deprecated', false], [4, 'active', true]]);
  });

  test('a lower serial, or the same serial with other bytes, is refused', () => {
    expect(sync.syncPlan(m, [{ release: r3.pcr0, manifest_serial: 8 }], new Set()).reject).toMatch(/lower/);
    expect(sync.syncPlan(m, [{ release: r3.pcr0, manifest_serial: 7, manifest_sha256: 'f'.repeat(64) }], new Set()).reject).toMatch(/different bytes/);
    expect(sync.syncPlan(m, [{ release: r3.pcr0, manifest_serial: 7, manifest_sha256: m.sha256 }], new Set()).reject).toBeUndefined();
  });

  test('rows of unlisted releases written by an older manifest are deleted; hand-made rows are not', () => {
    const gone = 'e'.repeat(96);
    const hand = 'd'.repeat(96);
    const p = sync.syncPlan(m, [{ release: gone, manifest_serial: 6 }, { release: hand }, { release: r4.pcr0, manifest_serial: 6 }], new Set());
    expect(p.deletes).toEqual([gone]);
  });
});

describe('sync handler', () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  const ssm = mockClient(SSMClient);
  const s3 = mockClient(S3Client);
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    ddb.reset();
    ssm.reset();
    s3.reset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(V.manifest_0_10_0.served, { status: 200 }));
  });
  afterEach(() => fetchSpy.mockRestore());

  test('upserts routing rows without touching start requests, rescue or scaler markers', async () => {
    ddb.on(ScanCommand).resolves({ Items: [{ release: 'e'.repeat(96), manifest_serial: 1 }] });
    ddb.on(UpdateCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});
    ssm.on(GetParametersByPathCommand).resolves({
      Parameters: [
        { Name: '/vettid-org/prod/vault/releases/4/group-name', Value: 'vettid-org-vault-r4' },
        { Name: '/vettid-org/prod/vault/releases/4/seal-key-arn', Value: 'arn' },
      ],
    });
    s3.on(HeadObjectCommand).resolves({});
    const r = await sync.handler();
    expect(r.status).toBe('synced');
    const ups = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(ups.length).toBeGreaterThan(0);
    for (const u of ups) {
      expect(u.UpdateExpression).not.toMatch(/start_|rescue|busy_at/);
      expect(u.ConditionExpression).toBe('attribute_not_exists(manifest_serial) OR manifest_serial <= :serial');
    }
    const avail = Object.fromEntries(ups.map((u) => [u.ExpressionAttributeValues![':n'], u.ExpressionAttributeValues![':a']]));
    expect(avail[4]).toBe(true);
    expect(Object.values(avail).filter((a) => a === true)).toHaveLength(1);
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input).toMatchObject({ Key: { release: 'e'.repeat(96) }, ConditionExpression: 'manifest_serial < :serial' });
    expect(s3.commandCalls(HeadObjectCommand)[0].args[0].input).toEqual({ Bucket: 'bucket', Key: V.manifest_0_10_0.object_key });
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  test('a manifest that does not verify writes nothing', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ...JSON.parse(V.served), sig: Buffer.alloc(64).toString('base64') }), { status: 200 }));
    expect((await sync.handler()).status).toBe('rejected');
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  test('nothing served yet (404, or no such host): absent, nothing written', async () => {
    ddb.on(ScanCommand).resolves({ Items: [{ release: 'c'.repeat(96), status: 'canary' }] }); // an operator's canary row
    fetchSpy.mockResolvedValue(new Response('<html>404</html>', { status: 404 }));
    expect((await sync.handler()).status).toBe('absent');
    fetchSpy.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    expect((await sync.handler()).status).toBe('absent');
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  test('nothing served after a manifest was synced: an error (alarm)', async () => {
    ddb.on(ScanCommand).resolves({ Items: [{ release: 'e'.repeat(96), manifest_serial: 3 }] });
    fetchSpy.mockResolvedValue(new Response('', { status: 404 }));
    await expect(sync.handler()).rejects.toThrow(/serial 3 was synced/);
    fetchSpy.mockResolvedValue(new Response('', { status: 503 }));
    await expect(sync.handler()).rejects.toThrow(/HTTP 503/);
  });

  test('no pinned key: skipped', async () => {
    const prev = process.env.PINNED_KEYS;
    process.env.PINNED_KEYS = '[]';
    try {
      expect((await sync.handler()).status).toBe('skipped');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      process.env.PINNED_KEYS = prev;
    }
  });
});
