import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// "tok-<guid>" ID tokens verify as that user; anything else is expired.
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({
      verify: async (t: string) => {
        if (t.startsWith('tok-')) return { 'custom:user_guid': t.slice(4), email: `${t.slice(4)}@x.org` };
        throw new Error('JwtExpiredError');
      },
    }),
  },
}));

const QUEUE_PREFIX = 'https://sqs.us-east-1.amazonaws.com/123456789012/vettid-org-vault-control-';
Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_TERMS: 'terms', TABLE_AUDIT: 'audit', TABLE_RATELIMITS: 'rl',
  TABLE_VAULTS: 'vaults', TABLE_VAULT_INSTANCES: 'instances', TABLE_VAULT_REQUESTS: 'requests', TABLE_VAULT_RELEASES: 'releases',
  MEMBER_POOL_ID: 'us-east-1_pool', MEMBER_CLIENT_ID: 'client', ORIGIN_VERIFY_SECRET_ARN: 'origin',
  VAULT_QUEUE_URL_PREFIX: QUEUE_PREFIX,
});

/* eslint-disable @typescript-eslint/no-require-imports */
const vault = require('../../lambda/member/vault');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const sm = mockClient(SecretsManagerClient);
const sqs = mockClient(SQSClient);

// ---- a tiny in-memory DynamoDB ---------------------------------------------------

const KEYS: Record<string, string> = {
  members: 'user_guid', terms: 'version_id', audit: 'ts_id', rl: 'key',
  vaults: 'vault_id', instances: 'instance_id', requests: 'request_id', releases: 'release',
};
let db: Record<string, Map<string, any>>;
const tbl = (t: string) => (db[t] ??= new Map());
const put = (t: string, item: any) => tbl(t).set(item[KEYS[t]], item);
const getItem = (t: string, k: string) => tbl(t).get(k);
const ccf = () => Object.assign(new Error('ccf'), { name: 'ConditionalCheckFailedException' });

function installFakeDdb() {
  ddb.on(GetCommand).callsFake((i) => ({ Item: tbl(i.TableName).get(i.Key[KEYS[i.TableName]]) }));
  ddb.on(PutCommand).callsFake((i) => {
    const k = i.Item[KEYS[i.TableName]];
    if (i.ConditionExpression?.startsWith('attribute_not_exists') && tbl(i.TableName).has(k)) throw ccf();
    tbl(i.TableName).set(k, structuredClone(i.Item));
    return {};
  });
  ddb.on(UpdateCommand).callsFake((i) => {
    const t = i.TableName;
    const k = i.Key[KEYS[t]];
    const cur = tbl(t).get(k);
    if (t === 'rl') {
      const count = (cur?.count ?? 0) + 1;
      tbl(t).set(k, { key: k, count });
      return { Attributes: { count } };
    }
    const v = i.ExpressionAttributeValues ?? {};
    if (t === 'vaults') {
      if (i.ConditionExpression === 'attribute_not_exists(vault_id)' && cur) throw ccf();
      if (i.ConditionExpression === 'current_vault_id = :old' && cur?.current_vault_id !== v[':old']) throw ccf();
      tbl(t).set(k, { ...cur, vault_id: k, current_vault_id: v[':new'], updated_at: v[':now'] });
    } else if (t === 'releases') {
      if (!cur) throw ccf();
      cur.start_requested_at = v[':now'];
      cur.start_requests = (cur.start_requests ?? 0) + 1;
    } else if (t === 'requests') {
      if (cur) cur.status = v[':e'];
    }
    return {};
  });
  ddb.on(QueryCommand).callsFake((i) => {
    const v = i.ExpressionAttributeValues;
    if (i.TableName === 'terms') return { Items: [...tbl('terms').values()].filter((x) => x.status === 'current') };
    if (i.TableName === 'releases') {
      return { Items: [...tbl('releases').values()].filter((x) => x.status === v[':a']).sort((a, b) => b.release_number - a.release_number) };
    }
    if (i.TableName === 'instances') {
      return {
        Items: [...tbl('instances').values()]
          .filter((x) => x.release === v[':r'] && x.heartbeat_at >= v[':cut'])
          .map(({ instance_id, release, heartbeat_at, load }) => ({ instance_id, release, heartbeat_at, load })),
      };
    }
    throw new Error(`unexpected query on ${i.TableName}`);
  });
}

// ---- fixtures ------------------------------------------------------------------

const NOW_MS = Date.UTC(2026, 9, 2, 12, 0, 0);
const NOW = NOW_MS / 1000;
const R0 = 'a'.repeat(96);
const R1 = 'b'.repeat(96);
const KID = '0123456789abcdef';
const RID = '01JB2Z6V9K3M4N5P6Q7R8S9T0V';
const RID2 = '01JB2Z6V9K3M4N5P6Q7R8S9T0W';
const VID = 'f'.repeat(32);

function envelope(bytes = 13_444, kid = KID, patch: (b: Buffer) => void = () => {}): string {
  const b = Buffer.alloc(bytes, 0x5a);
  b.set([0x02, 0x02, 0x02, 0x00], 0);
  b.fill(0, 4, 12);
  Buffer.from(kid, 'hex').copy(b, 12);
  patch(b);
  return b.toString('base64');
}
const ENV = envelope();

const instance = (id: string, release: string, extra: Record<string, unknown> = {}) =>
  put('instances', {
    instance_id: id, release, queue_url: QUEUE_PREFIX + id,
    descriptor: Buffer.from(`desc-${id}`).toString('base64'), attestation: Buffer.from(`att-${id}`).toString('base64'),
    heartbeat_at: NOW - 10, load: 0, ...extra,
  });
const release = (pcr0: string, n: number, status = 'active', extra: Record<string, unknown> = {}) =>
  put('releases', { release: pcr0, release_number: n, status, ...extra });
const vaultOf = (guid: string, row: Record<string, unknown>) => {
  put('vaults', { vault_id: `user#${guid}`, current_vault_id: row.vault_id });
  put('vaults', { user_guid: guid, state: 'locked', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', ...row });
};

const ORIGIN = 'origin-secret';
const ev = (method: string, path: string, body?: unknown, opts: { guid?: string; headers?: Record<string, string>; query?: Record<string, string> } = {}) =>
  ({
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    cookies: [`vid_id=tok-${opts.guid ?? 'g1'}`, 'vid_s=1'],
    queryStringParameters: opts.query,
    headers: { 'x-origin-verify': ORIGIN, 'x-vettid-csrf': '1', 'cloudfront-viewer-address': '2001:db8:1:2:3:4:5:6:443', ...opts.headers },
    requestContext: { http: { method, sourceIp: '10.0.0.1' } },
  }) as any;
const call = async (...a: Parameters<typeof ev>) => {
  const res = await vault.handler(ev(...a));
  return { status: res.statusCode as number, body: JSON.parse(res.body) };
};
const sent = () => sqs.commandCalls(SendMessageCommand).map((c) => ({ url: c.args[0].input.QueueUrl, msg: JSON.parse(c.args[0].input.MessageBody!) }));

let logs: string[];
beforeEach(() => {
  db = {};
  ddb.reset(); sm.reset(); sqs.reset();
  installFakeDdb();
  sm.on(GetSecretValueCommand, { SecretId: 'origin' }).resolves({ SecretString: ORIGIN });
  sqs.on(SendMessageCommand).resolves({ MessageId: 'm' });
  jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  put('terms', { version_id: 't1', status: 'current' });
  for (const g of ['g1', 'g2']) put('members', { user_guid: g, email: `${g}@x.org`, state: 'member', account_status: 'active', terms_version: 't1' });
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, Object.getOwnPropertyNames(a ?? {})))).join(' ')));
  }
});

afterEach(() => {
  // Envelopes are never logged, whatever happened.
  for (const l of logs) expect(l).not.toContain(ENV.slice(0, 64));
  jest.restoreAllMocks();
});

// ---- access ---------------------------------------------------------------------

describe('access', () => {
  const routes: [string, string, unknown?][] = [
    ['GET', '/api/vault/status'],
    ['GET', '/api/vault/enclave'],
    ['POST', '/api/vault/enroll', { request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV }],
    ['POST', '/api/vault/unlock', { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV }],
    ['POST', '/api/vault/lock', { vault_id: VID, request_id: RID }],
    ['GET', `/api/vault/requests/${RID}`],
  ];

  test.each(routes)('registered users get 403 terms_required: %s %s', async (...[method, path, body]: [string, string, unknown?]) => {
    put('members', { user_guid: 'g1', email: 'g1@x.org', state: 'registered', account_status: 'active' });
    const r = await call(method, path, body);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'terms_required', code: 'terms_required' });
    expect(sqs.calls()).toHaveLength(0);
  });

  test.each(routes)('members whose accepted terms are no longer current get 403 terms_required: %s %s', async (...[method, path, body]: [string, string, unknown?]) => {
    put('terms', { version_id: 't1', status: 'superseded' });
    put('terms', { version_id: 't2', status: 'current' });
    const r = await call(method, path, body);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('terms_required');
  });

  test('inactive accounts are refused', async () => {
    put('members', { user_guid: 'g1', email: 'g1@x.org', state: 'member', account_status: 'canceled', terms_version: 't1' });
    expect((await call('GET', '/api/vault/status')).status).toBe(403);
  });

  test('state-changing routes need the CSRF header', async () => {
    const r = await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID }, { headers: { 'x-vettid-csrf': '' } });
    expect(r).toEqual({ status: 403, body: expect.objectContaining({ error: 'csrf' }) });
  });
});

// ---- GET /api/vault/enclave ------------------------------------------------------

describe('GET /api/vault/enclave', () => {
  test('nothing deployed yet: 503 vault_unavailable', async () => {
    const r = await call('GET', '/api/vault/enclave');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: 'vault_unavailable', retry_after: 300 });
  });

  test('enrollment: newest active release with a live instance; serves the exact descriptor and attestation', async () => {
    release(R0, 4);
    release(R1, 5);
    release('c'.repeat(96), 6, 'active', { available: false });
    instance('i-old', R0);
    instance('i-new', R1);
    const r = await call('GET', '/api/vault/enclave');
    expect(r).toEqual({
      status: 200,
      body: { instance_id: 'i-new', release: R1, descriptor: Buffer.from('desc-i-new').toString('base64'), attestation: Buffer.from('att-i-new').toString('base64') },
    });
  });

  test('enrollment never goes to a deprecated release', async () => {
    release(R0, 4, 'deprecated');
    release(R1, 5);
    instance('i-old', R0);
    const r = await call('GET', '/api/vault/enclave');
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: 'release_starting', code: 'release_starting', release: R1, retry_after: 30 });
    expect(getItem('releases', R1).start_requests).toBe(1);
  });

  test('a live lease wins over load', async () => {
    release(R0, 4);
    instance('i-leased', R0, { load: 50 });
    instance('i-idle', R0, { load: 0 });
    vaultOf('g1', { vault_id: VID, sealed_release: R0, lease: { instance_id: 'i-leased', lease_expires_at: NOW + 100 } });
    expect((await call('GET', '/api/vault/enclave')).body.instance_id).toBe('i-leased');
  });

  test('no lease: a live instance of the sealed release, least loaded', async () => {
    release(R0, 4);
    release(R1, 5);
    instance('i-a', R0, { load: 7 });
    instance('i-b', R0, { load: 2 });
    instance('i-newer', R1, { load: 0 });
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    expect((await call('GET', '/api/vault/enclave')).body.instance_id).toBe('i-b');
  });

  test('an expired lease, or one held by a dead instance, does not pin the vault', async () => {
    release(R0, 4);
    instance('i-live', R0);
    instance('i-dead', R0, { heartbeat_at: NOW - 600 });
    vaultOf('g1', { vault_id: VID, sealed_release: R0, lease: { instance_id: 'i-dead', lease_expires_at: NOW + 100 } });
    expect((await call('GET', '/api/vault/enclave')).body.instance_id).toBe('i-live');
    vaultOf('g1', { vault_id: VID, sealed_release: R0, lease: { instance_id: 'i-live', lease_expires_at: NOW - 1 } });
    expect((await call('GET', '/api/vault/enclave')).body.instance_id).toBe('i-live');
  });

  test('instances advertising a foreign queue are ignored', async () => {
    release(R0, 4);
    instance('i-evil', R0, { queue_url: 'https://sqs.us-east-1.amazonaws.com/999999999999/vettid-org-vault-control-i-evil' });
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    const r = await call('GET', '/api/vault/enclave');
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('release_starting');
  });

  test('sealed release not running: records a start request, 503 release_starting', async () => {
    release(R0, 4, 'retired'); // retired releases still unlock the vaults sealed to them
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    const r = await call('GET', '/api/vault/enclave');
    expect(r).toEqual({ status: 503, body: expect.objectContaining({ error: 'release_starting', release: R0, retry_after: 30 }) });
    expect(getItem('releases', R0)).toMatchObject({ start_requests: 1, start_requested_at: expect.any(String) });
  });

  test('unknown release, or one that can no longer start: 410 release_unavailable', async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ error: 'release_unavailable', code: 'release_unavailable' });
    release(R0, 4, 'retired', { available: false });
    instance('i-a', R0);
    expect((await call('GET', '/api/vault/enclave')).status).toBe(410);
  });

  describe('?release= (abandoning an unconfirmed move)', () => {
    test('routes to the requested release instead of sealed_release', async () => {
      release(R0, 4);
      release(R1, 5);
      instance('i-r0', R0);
      instance('i-r1', R1);
      vaultOf('g1', { vault_id: VID, sealed_release: R1 });
      const r = await call('GET', '/api/vault/enclave', undefined, { query: { release: R0 } });
      expect(r.body).toMatchObject({ instance_id: 'i-r0', release: R0 });
    });

    test('malformed → 400; no vault → 404; unknown release → 410', async () => {
      expect((await call('GET', '/api/vault/enclave', undefined, { query: { release: 'A'.repeat(96) } })).status).toBe(400);
      expect((await call('GET', '/api/vault/enclave', undefined, { query: { release: R0 } })).status).toBe(404);
      vaultOf('g1', { vault_id: VID, sealed_release: R1 });
      expect((await call('GET', '/api/vault/enclave', undefined, { query: { release: R0 } })).status).toBe(410);
    });

    test('while another release holds the lease: 409 vault_busy with retry_after', async () => {
      release(R0, 4);
      release(R1, 5);
      instance('i-r0', R0);
      instance('i-r1', R1);
      vaultOf('g1', { vault_id: VID, sealed_release: R1, lease: { instance_id: 'i-r1', lease_expires_at: NOW + 120 } });
      const r = await call('GET', '/api/vault/enclave', undefined, { query: { release: R0 } });
      expect(r).toEqual({ status: 409, body: expect.objectContaining({ error: 'vault_busy', retry_after: 120 }) });
    });
  });

  test('rate limited per member', async () => {
    for (let i = 0; i < 30; i++) await call('GET', '/api/vault/enclave');
    const r = await call('GET', '/api/vault/enclave');
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited', retry_after: expect.any(Number) });
  });
});

// ---- POST /api/vault/enroll -------------------------------------------------------

describe('POST /api/vault/enroll', () => {
  const body = (extra: Record<string, unknown> = {}) => ({ request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, ...extra });
  beforeEach(() => {
    release(R1, 5);
    instance('i-1', R1);
  });

  test('assigns a vault_id, creates the row and the slot, enqueues the §11.5 message, audits', async () => {
    const r = await call('POST', '/api/vault/enroll', body());
    expect(r.status).toBe(202);
    const vid = r.body.vault_id;
    expect(vid).toMatch(/^[0-9a-f]{32}$/);
    expect(r.body).toEqual({ vault_id: vid, request_id: RID });
    expect(getItem('vaults', 'user#g1')).toMatchObject({ current_vault_id: vid });
    expect(getItem('vaults', 'user#g1')).not.toHaveProperty('user_guid'); // pointer rows stay out of user-index
    expect(getItem('vaults', vid)).toEqual({ vault_id: vid, user_guid: 'g1', state: 'enrolling', created_at: expect.any(String), updated_at: expect.any(String) });
    expect(getItem('requests', RID)).toMatchObject({ request_id: RID, vault_id: vid, user_guid: 'g1', op: 'enroll', status: 'queued', instance_id: 'i-1', expires_at: NOW + 900 });
    expect(getItem('requests', RID)).not.toHaveProperty('envelope'); // envelopes are not stored
    const [m] = sent();
    expect(m.url).toBe(QUEUE_PREFIX + 'i-1');
    expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'etk_kid', 'envelope', 'enqueued_at']);
    expect(m.msg).toMatchObject({ v: 1, op: 'enroll', vault_id: vid, user_guid: 'g1', request_id: RID, etk_kid: KID, envelope: ENV });
    const auditPut = ddb.commandCalls(PutCommand).find((c) => c.args[0].input.TableName === 'audit')!;
    expect(auditPut.args[0].input.Item).toMatchObject({ action: 'vault.enroll_request', subject: 'g1' });
    expect(JSON.stringify(auditPut.args[0].input.Item)).not.toContain(ENV.slice(0, 64));
  });

  test('a second enrollment reuses the member\'s vault_id (the enclave decides on replacement)', async () => {
    const first = await call('POST', '/api/vault/enroll', body());
    const second = await call('POST', '/api/vault/enroll', body({ request_id: RID2 }));
    expect(second.body.vault_id).toBe(first.body.vault_id);
  });

  test('a deleted vault gets a fresh vault_id', async () => {
    vaultOf('g1', { vault_id: VID, state: 'deleted' });
    const r = await call('POST', '/api/vault/enroll', body());
    expect(r.body.vault_id).not.toBe(VID);
    expect(getItem('vaults', 'user#g1').current_vault_id).toBe(r.body.vault_id);
  });

  test.each([
    ['unlock-size envelope of the wrong op size (4,096 padded)', { envelope: envelope(5_252) }],
    ['one byte short', { envelope: envelope(13_443) }],
    ['non-canonical base64', { envelope: ENV.replace(/.$/, '\n') }],
    ['not sealed mode', { envelope: envelope(13_444, KID, (b) => (b[2] = 0x01)) }],
    ['non-zero sender_kid', { envelope: envelope(13_444, KID, (b) => (b[5] = 1)) }],
    ['recipient_kid ≠ etk_kid', { envelope: envelope(13_444, 'fedcba9876543210') }],
    ['bad request_id', { request_id: 'not-a-ulid' }],
    ['bad etk_kid', { etk_kid: 'XYZ' }],
    ['bad instance_id', { instance_id: '../../x' }],
  ])('rejects %s with 400 and enqueues nothing', async (_name, extra) => {
    const r = await call('POST', '/api/vault/enroll', body(extra));
    expect(r.status).toBe(400);
    expect(sqs.calls()).toHaveLength(0);
    expect(tbl('requests').size).toBe(0);
  });

  test('instance gone → 409 instance_moved; instance of a non-active release → 409 instance_moved', async () => {
    let r = await call('POST', '/api/vault/enroll', body({ instance_id: 'i-gone' }));
    expect(r).toEqual({ status: 409, body: expect.objectContaining({ error: 'instance_moved', code: 'instance_moved' }) });
    release(R0, 4, 'deprecated');
    instance('i-old', R0);
    r = await call('POST', '/api/vault/enroll', body({ instance_id: 'i-old' }));
    expect(r.body.error).toBe('instance_moved');
    expect(sqs.calls()).toHaveLength(0);
  });

  test('3 per member per day', async () => {
    for (const id of [RID, RID2, '01JB2Z6V9K3M4N5P6Q7R8S9T0X']) expect((await call('POST', '/api/vault/enroll', body({ request_id: id }))).status).toBe(202);
    const r = await call('POST', '/api/vault/enroll', body({ request_id: '01JB2Z6V9K3M4N5P6Q7R8S9T0Y' }));
    expect(r.status).toBe(429);
    expect(r.body.retry_after).toBeGreaterThan(0);
  });

  test('a reused request_id is refused before anything is queued', async () => {
    await call('POST', '/api/vault/enroll', body());
    const r = await call('POST', '/api/vault/enroll', body());
    expect(r).toEqual({ status: 409, body: expect.objectContaining({ error: 'duplicate_request' }) });
    expect(sent()).toHaveLength(1);
  });
});

// ---- POST /api/vault/unlock ------------------------------------------------------

describe('POST /api/vault/unlock', () => {
  const body = (extra: Record<string, unknown> = {}) => ({ vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, ...extra });
  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
    instance('i-2', R0);
  });

  test('no lease: forwarded to the named live instance', async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    const r = await call('POST', '/api/vault/unlock', body());
    expect(r).toEqual({ status: 202, body: { vault_id: VID, request_id: RID } });
    expect(sent()[0]).toMatchObject({ url: QUEUE_PREFIX + 'i-1', msg: { op: 'unlock', vault_id: VID, user_guid: 'g1', etk_kid: KID, envelope: ENV } });
  });

  test('forwarded when the named instance holds the lease', async () => {
    vaultOf('g1', { vault_id: VID, lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    expect((await call('POST', '/api/vault/unlock', body())).status).toBe(202);
  });

  test('another instance holds the lease → 409 instance_moved, nothing queued', async () => {
    vaultOf('g1', { vault_id: VID, lease: { instance_id: 'i-2', lease_expires_at: NOW + 60 } });
    const r = await call('POST', '/api/vault/unlock', body());
    expect(r.body).toMatchObject({ error: 'instance_moved' });
    expect(r.status).toBe(409);
    expect(sqs.calls()).toHaveLength(0);
    expect(tbl('requests').size).toBe(0);
  });

  test('another vault_id, or a deleted vault → 404', async () => {
    vaultOf('g2', { vault_id: VID });
    expect((await call('POST', '/api/vault/unlock', body())).status).toBe(404); // g1 has no vault
    vaultOf('g1', { vault_id: 'e'.repeat(32) });
    expect((await call('POST', '/api/vault/unlock', body())).status).toBe(404);
    vaultOf('g1', { vault_id: VID, state: 'deleted' });
    expect((await call('POST', '/api/vault/unlock', body())).status).toBe(404);
  });

  test('padding is fixed: a 4,096-padded envelope is refused', async () => {
    vaultOf('g1', { vault_id: VID });
    expect((await call('POST', '/api/vault/unlock', body({ envelope: envelope(5_252) }))).status).toBe(400);
  });

  test('10 per member per 15 min', async () => {
    vaultOf('g1', { vault_id: VID });
    for (let i = 0; i < 10; i++) {
      const rid = `01JB2Z6V9K3M4N5P6Q7R8S9TA${i}`;
      expect((await call('POST', '/api/vault/unlock', body({ request_id: rid }))).status).toBe(202);
    }
    expect((await call('POST', '/api/vault/unlock', body({ request_id: '01JB2Z6V9K3M4N5P6Q7R8S9TZZ' }))).status).toBe(429);
  });

  test('10 per source /64 across members', async () => {
    vaultOf('g1', { vault_id: VID });
    vaultOf('g2', { vault_id: 'e'.repeat(32) });
    for (let i = 0; i < 10; i++) {
      const rid = `01JB2Z6V9K3M4N5P6Q7R8S9TA${i}`;
      // Same /64, different host bits.
      const headers = { 'cloudfront-viewer-address': `2001:db8:1:2:${i}::1:443` };
      expect((await call('POST', '/api/vault/unlock', body({ request_id: rid }), { headers })).status).toBe(202);
    }
    const r = await call('POST', '/api/vault/unlock', body({ vault_id: 'e'.repeat(32), request_id: '01JB2Z6V9K3M4N5P6Q7R8S9TZZ' }), { guid: 'g2' });
    expect(r.status).toBe(429);
    expect(getItem('rl', `vault-unlock-net#2001:0db8:0001:0002::/64#${NOW - (NOW % 900)}`).count).toBe(11);
  });

  test('queue gone at send time → 409 instance_moved and the slot is expired', async () => {
    vaultOf('g1', { vault_id: VID });
    sqs.on(SendMessageCommand).rejects(Object.assign(new Error('gone'), { name: 'QueueDoesNotExist' }));
    const r = await call('POST', '/api/vault/unlock', body());
    expect(r.body.error).toBe('instance_moved');
    expect(getItem('requests', RID).status).toBe('expired');
    expect(logs.join('\n')).toContain('vault enqueue failed');
  });
});

// ---- POST /api/vault/lock ----------------------------------------------------------

describe('POST /api/vault/lock', () => {
  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
  });

  test('goes to the leaseholder, without envelope or etk_kid', async () => {
    vaultOf('g1', { vault_id: VID, state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    const r = await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID });
    expect(r.status).toBe(202);
    const [m] = sent();
    expect(m.url).toBe(QUEUE_PREFIX + 'i-1');
    expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'enqueued_at']);
    expect(m.msg.op).toBe('lock');
  });

  test('no live lease: nothing to lock, the slot is done at once', async () => {
    vaultOf('g1', { vault_id: VID });
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID })).status).toBe(202);
    expect(sqs.calls()).toHaveLength(0);
    expect((await call('GET', `/api/vault/requests/${RID}`)).body).toEqual({ request_id: RID, op: 'lock', status: 'done' });
  });
});

// ---- GET /api/vault/requests/{id} ------------------------------------------------

describe('GET /api/vault/requests/{id}', () => {
  const slot = (extra: Record<string, unknown>) =>
    put('requests', { request_id: RID, vault_id: VID, user_guid: 'g1', op: 'unlock', status: 'queued', created_at: new Date(NOW_MS - 10_000).toISOString(), expires_at: NOW + 800, ...extra });
  const RESULT = Buffer.alloc(5_252, 7).toString('base64');

  test('queued, then done with the opaque envelope and code', async () => {
    slot({});
    expect((await call('GET', `/api/vault/requests/${RID}`)).body).toEqual({ request_id: RID, op: 'unlock', status: 'queued' });
    slot({ status: 'done', envelope: RESULT, code: 'etk_unknown' });
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 1000); // next polling window
    expect((await call('GET', `/api/vault/requests/${RID}`)).body).toEqual({ request_id: RID, op: 'unlock', status: 'done', envelope: RESULT, code: 'etk_unknown' });
  });

  test('oversized or malformed response envelopes are not passed on', async () => {
    slot({ status: 'done', envelope: Buffer.alloc(8_193).toString('base64'), code: 'Bad Code' });
    expect((await call('GET', `/api/vault/requests/${RID}`)).body).toEqual({ request_id: RID, op: 'unlock', status: 'done' });
  });

  test('still queued after queue retention → expired', async () => {
    slot({ created_at: new Date(NOW_MS - 400_000).toISOString() });
    expect((await call('GET', `/api/vault/requests/${RID}`)).body.status).toBe('expired');
  });

  test("another member's request, or a lapsed slot → 404", async () => {
    slot({ user_guid: 'g2' });
    expect((await call('GET', `/api/vault/requests/${RID}`)).status).toBe(404);
    slot({ expires_at: NOW - 1 });
    expect((await call('GET', `/api/vault/requests/${RID}`)).status).toBe(404);
  });

  test('polling: 2 per second', async () => {
    slot({});
    expect((await call('GET', `/api/vault/requests/${RID}`)).status).toBe(200);
    expect((await call('GET', `/api/vault/requests/${RID}`)).status).toBe(200);
    const r = await call('GET', `/api/vault/requests/${RID}`);
    expect(r.status).toBe(429);
    expect(r.body.retry_after).toBe(1);
  });

  test('malformed id → 400', async () => {
    expect((await call('GET', '/api/vault/requests/nope')).status).toBe(400);
  });
});

// ---- GET /api/vault/status ----------------------------------------------------------

describe('GET /api/vault/status', () => {
  test('no vault', async () => {
    expect((await call('GET', '/api/vault/status')).body).toEqual({ vault: null });
  });

  test('advisory lifecycle fields; lease as a boolean only', async () => {
    vaultOf('g1', { vault_id: VID, state: 'unlocked', sealed_release: R0, vault_version: R0, state_version: 1, lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    const r = await call('GET', '/api/vault/status');
    expect(r.body).toEqual({
      vault: { vault_id: VID, state: 'unlocked', sealed_release: R0, vault_version: R0, state_version: 1, leased: true, created_at: expect.any(String), updated_at: expect.any(String) },
    });
  });
});

// ---- helpers ------------------------------------------------------------------------

test('envelope sizes match VAULT-MESSAGING §5.4', () => {
  expect(vault.ENVELOPE_BYTES_LARGE).toBe(13_444);
  expect(vault.ENVELOPE_BYTES_SMALL).toBe(5_252);
  expect(vault.decodeCanonicalB64('AA==')).toEqual(Buffer.from([0]));
  expect(vault.decodeCanonicalB64('AB==')).toBeNull(); // non-zero padding bits
  expect(vault.decodeCanonicalB64('AA')).toBeNull();
});
