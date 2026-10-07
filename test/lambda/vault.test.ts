import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { KeyObject, createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';

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
  TABLE_MEMBERS: 'members', TABLE_TERMS: 'terms', TABLE_AUDIT: 'audit', TABLE_RATELIMITS: 'rl', TABLE_SUBSCRIPTIONS: 'subscriptions',
  TABLE_VAULTS: 'vaults', TABLE_VAULT_INSTANCES: 'instances', TABLE_VAULT_REQUESTS: 'requests', TABLE_VAULT_RELEASES: 'releases',
  MEMBER_POOL_ID: 'us-east-1_pool', MEMBER_CLIENT_ID: 'client', ORIGIN_VERIFY_SECRET_ARN: 'origin',
  VAULT_QUEUE_URL_PREFIX: QUEUE_PREFIX, SENDER_EMAIL: 'no-reply@vettid.org', ACCOUNT_HOST: 'account.vettid.org',
  VAULT_SERVICE_PARAM: '/vettid-org/prod/switch/vault-service',
  ENROLL_CODE_KEY_PARAM: '/vettid-org/prod/member/enroll-code-key',
});

/* eslint-disable @typescript-eslint/no-require-imports */
const vault = require('../../lambda/member/vault');
const vaultService = require('../../lambda/shared/vault-service');
const enrollCode = require('../../lambda/shared/enroll-code');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const sm = mockClient(SecretsManagerClient);
const sqs = mockClient(SQSClient);
const sesMock = mockClient(SESv2Client);
const ssm = mockClient(SSMClient);

/** The vault service switch as SSM holds it (undefined: no parameter, on). */
let switchValue: string | undefined;
const paused = (reason = 'incident') => (switchValue = JSON.stringify({ enabled: false, reason, set_by: 'ops@vettid.org', set_at: '2026-10-02T11:00:00.000Z' }));

// ---- a tiny in-memory DynamoDB ---------------------------------------------------

const KEYS: Record<string, string> = {
  members: 'user_guid', terms: 'version_id', audit: 'ts_id', rl: 'key', subscriptions: 'user_guid',
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
    const v = i.ExpressionAttributeValues ?? {};
    if (t === 'rl' && i.UpdateExpression === 'SET expires_at = :exp') {
      // An app request's nonce: single use while unexpired.
      if (cur && !(cur.expires_at < v[':now'])) throw ccf();
      tbl(t).set(k, { key: k, expires_at: v[':exp'] });
      return {};
    }
    if (t === 'rl') {
      const count = (cur?.count ?? 0) + 1;
      tbl(t).set(k, { key: k, count });
      return { Attributes: { count } };
    }
    if (t === 'vaults' && i.UpdateExpression.startsWith('SET recovery.#st')) {
      // markRegistered: pending -> registered, same recovery only.
      if (!cur?.recovery || cur.recovery.recovery_id !== v[':id'] || cur.recovery.state !== v[':pending']) throw ccf();
      cur.recovery.state = v[':reg'] ?? v[':un'];
      if (v[':rk']) cur.recovery.recovering_key = structuredClone(v[':rk']);
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression.startsWith('SET recovery.claim_keys')) {
      if (!cur?.recovery || cur.recovery.recovery_id !== v[':id']) throw ccf();
      cur.recovery.claim_keys = structuredClone(v[':keys']);
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression === 'REMOVE recovery.claim_keys, recovery.recovering_key') {
      if (!cur?.recovery || cur.recovery.recovery_id !== v[':id']) throw ccf();
      delete cur.recovery.claim_keys;
      delete cur.recovery.recovering_key;
    } else if (t === 'vaults' && i.UpdateExpression === 'REMOVE app_key_pending') {
      if (cur?.app_key_pending?.kid !== v[':k']) throw ccf();
      delete cur.app_key_pending;
    } else if (t === 'vaults' && i.UpdateExpression.startsWith('SET app_key_pending')) {
      if (!cur || cur.user_guid !== v[':g']) throw ccf();
      cur.app_key_pending = structuredClone(v[':p']);
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression.startsWith('SET enroll_live')) {
      tbl(t).set(k, { ...cur, vault_id: k, enroll_live: v[':k'], updated_at: v[':now'] });
    } else if (t === 'vaults' && i.UpdateExpression.startsWith('SET recovery.register_ids')) {
      if (!cur?.recovery || cur.recovery.recovery_id !== v[':id']) throw ccf();
      cur.recovery.register_ids = structuredClone(v[':ids']);
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression.startsWith('SET recovery')) {
      if (!cur) throw ccf();
      if (i.ConditionExpression.startsWith('attribute_not_exists(recovery)') && cur.recovery) throw ccf();
      if (i.ConditionExpression.startsWith('recovery.recovery_id = :id') && cur.recovery?.recovery_id !== v[':id']) throw ccf();
      if (i.ConditionExpression.includes('attribute_not_exists(deletion)') && cur.deletion) throw ccf();
      tbl(t).set(k, { ...cur, recovery: structuredClone(v[':r']), updated_at: v[':now'] });
    } else if (t === 'vaults' && i.UpdateExpression === 'SET deletion = :d, updated_at = :now') {
      // The start-over request (2.1.0): no deletion yet, the recovery read (or none).
      if (!cur || cur.user_guid !== v[':g'] || cur.deletion) throw ccf();
      if (v[':rid'] ? cur.recovery?.recovery_id !== v[':rid'] : cur.recovery) throw ccf();
      cur.deletion = structuredClone(v[':d']);
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression === 'REMOVE deletion SET updated_at = :now') {
      if (cur?.deletion?.deletion_id !== v[':id'] || cur.deletion.state !== v[':pending']) throw ccf();
      delete cur.deletion;
      cur.updated_at = v[':now'];
    } else if (t === 'vaults') {
      if (i.ConditionExpression === 'attribute_not_exists(current_vault_id)' && cur?.current_vault_id) throw ccf();
      if (i.ConditionExpression === 'current_vault_id = :old' && cur?.current_vault_id !== v[':old']) throw ccf();
      tbl(t).set(k, { ...cur, vault_id: k, current_vault_id: v[':new'], updated_at: v[':now'] });
    } else if (t === 'releases') {
      if (!cur) throw ccf();
      if (cur.start_requested_at !== undefined && !(cur.start_requested_at < v[':cut'])) throw ccf();
      cur.start_requested_at = v[':now'];
      cur.start_requests = (cur.start_requests ?? 0) + 1;
    } else if (t === 'requests' && i.UpdateExpression === 'SET #st = :revoked') {
      if (cur?.state !== v[':live']) throw ccf();
      cur.state = v[':revoked'];
    } else if (t === 'requests' && i.UpdateExpression === 'ADD typed_attempts :one') {
      if (!cur || cur.typed_blocked !== v[':f'] || !(cur.typed_attempts < v[':max'])) throw ccf();
      cur.typed_attempts += 1;
      return { Attributes: { typed_attempts: cur.typed_attempts } };
    } else if (t === 'requests' && i.UpdateExpression === 'SET typed_blocked = :t') {
      if (!cur || cur.typed_blocked !== v[':f']) throw ccf();
      cur.typed_blocked = true;
    } else if (t === 'requests' && i.UpdateExpression.startsWith('SET #st = :used')) {
      if (!cur || cur.state !== v[':live'] || !(cur.expires_at > v[':now']) || (v[':f'] !== undefined && cur.typed_blocked !== v[':f'])) throw ccf();
      Object.assign(cur, { state: v[':used'], used_at: v[':now'], used_via: v[':via'] });
    } else if (t === 'requests') {
      if (cur && i.UpdateExpression.startsWith('SET released')) cur.released = true;
      else if (cur) cur.status = v[':e'];
    }
    return {};
  });
  ddb.on(QueryCommand).callsFake((i) => {
    const v = i.ExpressionAttributeValues;
    if (i.TableName === 'terms') return { Items: [...tbl('terms').values()].filter((x) => x.status === 'current') };
    if (i.TableName === 'members' && i.IndexName === 'email-index') return { Items: [...tbl('members').values()].filter((x) => x.email === v[':e']).slice(0, 1) };
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
const MSHA = '9'.repeat(64); // manifest_sha256 (0.10.0 §11.5)

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
type EvOpts = { guid?: string; headers?: Record<string, string>; query?: Record<string, string>; session?: boolean; app?: AppSig };
const ev = (method: string, path: string, body?: unknown, opts: EvOpts = {}) => {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const rawQuery = opts.query ? new URLSearchParams(opts.query).toString() : '';
  const headers: Record<string, string> = { 'x-origin-verify': ORIGIN, 'x-vettid-csrf': '1', 'cloudfront-viewer-address': '2001:db8:1:2:3:4:5:6:443', ...opts.headers };
  if (opts.app) headers['x-vettid-app'] = signHeader(method, path, rawQuery, raw ?? '', opts.app);
  return {
    rawPath: path,
    rawQueryString: rawQuery,
    body: raw,
    isBase64Encoded: false,
    cookies: [`vid_id=tok-${opts.guid ?? 'g1'}`, 'vid_s=1'],
    queryStringParameters: opts.query,
    headers,
    requestContext: { http: { method, sourceIp: '10.0.0.1' } },
  } as any;
};

// ---- apps: app keys and signed requests (MEMBER-API 2.0.0, VAULT-MESSAGING §11.12.2) ----

interface TestKey { priv: KeyObject; b64: string; kid: string }
const makeKey = (): TestKey => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  return { priv: privateKey, b64: der.toString('base64'), kid: createHash('sha256').update(der).digest().subarray(0, 16).toString('hex') };
};
const APP_KEYS: Record<string, TestKey> = {};
/** One P-256 app key per name (by default the member's guid). */
const keyOf = (name: string) => (APP_KEYS[name] ??= makeKey());

interface AppSig { key: TestKey; vault: string; ts?: number; nonce?: string; tamper?: (input: string) => string }
function signHeader(method: string, path: string, query: string, body: string, a: AppSig): string {
  const ts = String(a.ts ?? Math.floor(Date.now() / 1000));
  const nonce = a.nonce ?? randomBytes(16).toString('base64url');
  let input = ['vettid/member-api/app/1', method, path, query, a.vault, a.key.kid, ts, nonce, createHash('sha256').update(body).digest('hex')].join('\n');
  if (a.tamper) input = a.tamper(input);
  const sig = cryptoSign('sha256', Buffer.from(input), { key: a.key.priv, dsaEncoding: 'der' }).toString('base64url');
  return `v=1; vault=${a.vault}; kid=${a.key.kid}; ts=${ts}; nonce=${nonce}; sig=${sig}`;
}

/** The routes only an app may call (2.0.0), and the key each test call signs with by default. */
const APP_ONLY: Record<string, 'app' | 'pending' | 'claim'> = {
  'GET /api/vault/enclave': 'app',
  'POST /api/vault/enroll': 'pending',
  'POST /api/vault/unlock': 'app',
  'POST /api/vault/recovery/register': 'claim',
};
/** The vault a redeem made for a member who had none (as the test calls provision it). */
const evid = (guid: string) => createHash('sha256').update(`vault:${guid}`).digest('hex').slice(0, 32);
const currentVaultId = (guid: string): string | undefined => getItem('vaults', `user#${guid}`)?.current_vault_id;

/**
 * Put the member's app key where the route expects it, as the redeem, the
 * host or a claim would have: the pending key (enroll; and enclave for a
 * member without a vault, which gets one as a redeem would), the vault's
 * `app_key`, or the recovery's claim keys. Returns the vault to sign for.
 */
function provision(guid: string, role: 'app' | 'pending' | 'claim', key: TestKey): string {
  let vid = currentVaultId(guid);
  let row = vid ? getItem('vaults', vid) : undefined;
  if (!row && role !== 'claim') {
    vid = evid(guid);
    vaultOf(guid, { vault_id: vid, state: 'enrolling' });
    row = getItem('vaults', vid);
    role = 'pending';
  }
  if (!row) return vid ?? '';
  const nowS = Math.floor(Date.now() / 1000);
  if (role === 'pending' || (role === 'app' && row.state === 'enrolling' && !row.app_key)) row.app_key_pending = { key: key.b64, kid: key.kid, until: nowS + 3600 };
  if (role === 'app' && row.state !== 'enrolling') row.app_key = { key: key.b64, kid: key.kid, seq: 1 };
  if (role === 'claim' && row.recovery && !(row.recovery.claim_keys ?? []).some((k: any) => k.kid === key.kid)) {
    row.recovery.claim_keys = [...(row.recovery.claim_keys ?? []), { key: key.b64, kid: key.kid }];
  }
  return row.vault_id;
}

/**
 * The event a test call sends: app-only routes are signed by the member's
 * app key (provisioned as above) unless `session` asks for the portal's
 * cookies; any route is signed when `app` is given.
 */
function build(method: string, path: string, body?: unknown, opts: EvOpts = {}) {
  const role = APP_ONLY[`${method} ${path}`];
  if (role && !opts.session && !opts.app) {
    const guid = opts.guid ?? 'g1';
    const key = keyOf(guid);
    const vid = provision(guid, role, key) || (body as any)?.vault_id || '';
    return ev(method, path, body, { ...opts, app: { key, vault: vid } });
  }
  return ev(method, path, body, opts);
}
const call = async (...a: Parameters<typeof ev>) => {
  const res = await vault.handler(build(...a));
  return { status: res.statusCode as number, body: JSON.parse(res.body) };
};
const sent = () => sqs.commandCalls(SendMessageCommand).map((c) => ({ url: c.args[0].input.QueueUrl, msg: JSON.parse(c.args[0].input.MessageBody!) }));

let logs: string[];
beforeEach(() => {
  db = {};
  ddb.reset(); sm.reset(); sqs.reset(); sesMock.reset(); ssm.reset();
  switchValue = undefined;
  vaultService.resetVaultServiceCache();
  ssm.on(GetParameterCommand).callsFake(() => {
    if (switchValue === undefined) throw Object.assign(new Error('nf'), { name: 'ParameterNotFound' });
    return { Parameter: { Value: switchValue } };
  });
  sesMock.on(SendEmailCommand).resolves({});
  installFakeDdb();
  sm.on(GetSecretValueCommand, { SecretId: 'origin' }).resolves({ SecretString: ORIGIN });
  sqs.on(SendMessageCommand).resolves({ MessageId: 'm' });
  jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  put('terms', { version_id: 't1', status: 'current' });
  for (const g of ['g1', 'g2']) put('members', { user_guid: g, email: `${g}@x.org`, first_name: 'Ada', last_name: g === 'g1' ? 'One' : 'Two', state: 'member', account_status: 'active', terms_version: 't1' });
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
  const ENROLL = { request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
  const UNLOCK = { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
  const enrollBody = () => ({ ...ENROLL, vault_id: currentVaultId('g1') ?? evid('g1') });

  // Enrollment with the pending key needs an active member (2.0.0: the
  // terms were checked when the portal issued the code).
  test('enrollment: a registered user gets 403 terms_required on enclave and enroll', async () => {
    put('members', { user_guid: 'g1', email: 'g1@x.org', first_name: 'Ada', last_name: 'One', state: 'registered', account_status: 'active' });
    for (const [method, path, body] of [['GET', '/api/vault/enclave'], ['POST', '/api/vault/enroll', enrollBody()]] as [string, string, unknown?][]) {
      const r = await call(method, path, body);
      expect({ path, status: r.status, error: r.body.error, code: r.body.code }).toEqual({ path, status: 403, error: 'terms_required', code: 'terms_required' });
    }
    expect(sqs.calls()).toHaveLength(0);
  });

  test('2.0.0: enrolling, unlocking and the enclave no longer need the current terms', async () => {
    put('terms', { version_id: 't1', status: 'superseded' });
    put('terms', { version_id: 't2', status: 'current' });
    release(R0, 4);
    instance('i-1', R0);
    expect((await call('GET', '/api/vault/enclave')).status).toBe(200);
    expect((await call('POST', '/api/vault/enroll', enrollBody())).status).toBe(202);
    put('vaults', { ...getItem('vaults', evid('g1')), state: 'locked', sealed_release: R0 });
    expect((await call('POST', '/api/vault/unlock', { ...UNLOCK, vault_id: evid('g1'), request_id: RID2 })).status).toBe(202);
    // A registered (not yet member) account with an existing vault may unlock it too.
    put('members', { user_guid: 'g1', email: 'g1@x.org', first_name: 'Ada', last_name: 'One', state: 'registered', account_status: 'active' });
    expect((await call('POST', '/api/vault/unlock', { ...UNLOCK, vault_id: evid('g1'), request_id: '01JB2Z6V9K3M4N5P6Q7R8S9T0X' })).status).toBe(202);
  });

  test('lock and status stay available for an existing vault without current terms', async () => {
    put('terms', { version_id: 't2', status: 'current' }); // g1 accepted t1 only
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    expect((await call('GET', '/api/vault/status')).body.vault.vault_id).toBe(VID);
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID })).status).toBe(202);
    expect(sent()[0].msg.op).toBe('lock');
    put('members', { user_guid: 'g1', email: 'g1@x.org', first_name: 'Ada', last_name: 'One', state: 'registered', account_status: 'active' });
    expect((await call('GET', '/api/vault/status')).status).toBe(200);
  });

  test('a canceled account: every route but lock is blocked at once (portal and app)', async () => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    put('members', { user_guid: 'g1', email: 'g1@x.org', first_name: 'Ada', last_name: 'One', state: 'member', account_status: 'canceled', terms_version: 't1' });
    const app = { key: keyOf('g1'), vault: VID };
    provision('g1', 'app', keyOf('g1'));
    for (const [method, path, body, opts] of [
      ['GET', '/api/vault/enclave'],
      ['POST', '/api/vault/enroll', { ...ENROLL, vault_id: VID }],
      ['POST', '/api/vault/unlock', UNLOCK],
      ['GET', '/api/vault/status'],
      ['GET', `/api/vault/requests/${RID}`],
      ['GET', '/api/vault/status', undefined, { app }],
      ['GET', `/api/vault/requests/${RID}`, undefined, { app }],
    ] as [string, string, unknown?, EvOpts?][]) {
      const r = await call(method, path, body, opts);
      // enroll: the pending key was never issued for a canceled account; the vault's app key cannot enroll.
      expect({ path, status: r.status }).toEqual({ path, status: path === '/api/vault/enroll' ? 401 : 403 });
    }
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID })).status).toBe(202);
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID2 }, { app })).status).toBe(202);
    expect(sent().map((m) => m.msg.op)).toEqual(['lock', 'lock']);
  });

  test("lock needs the caller's own vault", async () => {
    vaultOf('g2', { vault_id: VID });
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID })).status).toBe(404);
  });

  test('state-changing routes need the CSRF header', async () => {
    const r = await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID }, { headers: { 'x-vettid-csrf': '' } });
    expect(r).toEqual({ status: 403, body: expect.objectContaining({ error: 'csrf' }) });
  });

  test('2.0.0: enclave, enroll, unlock and register refuse a portal session (401), cookies or not', async () => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0 });
    for (const [method, path, body] of [
      ['GET', '/api/vault/enclave'],
      ['POST', '/api/vault/enroll', { ...ENROLL, vault_id: VID }],
      ['POST', '/api/vault/unlock', UNLOCK],
      ['POST', '/api/vault/recovery/register', { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV }],
    ] as [string, string, unknown?][]) {
      expect({ path, status: (await call(method, path, body, { session: true })).status }).toEqual({ path, status: 401 });
    }
    expect(sqs.calls()).toHaveLength(0);
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

  test('start requests are recorded at most every 30 s per release, however many members ask', async () => {
    release(R0, 4);
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    vaultOf('g2', { vault_id: 'e'.repeat(32), sealed_release: R0 });
    for (const guid of ['g1', 'g2', 'g1']) expect((await call('GET', '/api/vault/enclave', undefined, { guid })).body.error).toBe('release_starting');
    expect(getItem('releases', R0).start_requests).toBe(1);
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 31_000);
    await call('GET', '/api/vault/enclave');
    expect(getItem('releases', R0).start_requests).toBe(2);
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

    test('malformed → 400; unknown release → 410', async () => {
      expect((await call('GET', '/api/vault/enclave', undefined, { query: { release: 'A'.repeat(96) } })).status).toBe(400);
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

// ---- dark launch (VAULT-RELEASES §9): an empty release registry ------------------

describe('dark launch: no active release', () => {
  const enrollBody = { vault_id: evid('g1'), request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
  const writes = () => ddb.commandCalls(PutCommand).concat(ddb.commandCalls(UpdateCommand) as any).map((c) => c.args[0].input.TableName).filter((t) => t !== 'rl');

  test('enclave and enroll answer 503 vault_unavailable; nothing is created, queued or start-requested', async () => {
    const e = await call('GET', '/api/vault/enclave');
    expect(e).toEqual({ status: 503, body: expect.objectContaining({ error: 'vault_unavailable', code: 'vault_unavailable', retry_after: 300 }) });
    const r = await call('POST', '/api/vault/enroll', enrollBody);
    expect(r).toEqual({ status: 503, body: expect.objectContaining({ error: 'vault_unavailable', code: 'vault_unavailable', retry_after: 300 }) });
    expect(sqs.calls()).toHaveLength(0);
    expect(writes()).toEqual([]);
    expect(tbl('releases').size).toBe(0);
    expect(tbl('vaults').size).toBe(2); // the redeem's vault and pointer (made by the test), nothing more
    expect(tbl('requests').size).toBe(0);
  });

  test('even with a stray instance registered, enroll is 503 (an instance alone is not a release)', async () => {
    instance('i-1', R0);
    expect((await call('POST', '/api/vault/enroll', enrollBody)).body.error).toBe('vault_unavailable');
    expect(sqs.calls()).toHaveLength(0);
  });

  test('only deprecated, retired, removed or unstartable releases: still 503 vault_unavailable', async () => {
    release(R0, 4, 'deprecated');
    release(R1, 5, 'active', { available: false });
    release('c'.repeat(96), 6, 'removed');
    instance('i-1', R0);
    expect((await call('GET', '/api/vault/enclave')).body.error).toBe('vault_unavailable');
    expect((await call('POST', '/api/vault/enroll', enrollBody)).body.error).toBe('vault_unavailable');
    for (const r of tbl('releases').values()) expect(r.start_requests).toBeUndefined();
  });

  test('status, unlock and lock without a vault: {vault: null}, 401 (no key for it), 404', async () => {
    expect((await call('GET', '/api/vault/status')).body).toEqual({ vault: null, service: 'available' });
    expect((await call('POST', '/api/vault/unlock', { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA }, { app: { key: keyOf('g1'), vault: VID } })).status).toBe(401);
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID2 })).status).toBe(404);
    expect((await call('POST', '/api/vault/recovery', { browser_key: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64') })).status).toBe(404);
    expect(sqs.calls()).toHaveLength(0);
    expect(writes()).toEqual([]);
  });

  test('rate limits still apply: enclave 30 per minute, enroll 3 per day', async () => {
    for (let i = 0; i < 30; i++) expect((await call('GET', '/api/vault/enclave')).status).toBe(503);
    expect((await call('GET', '/api/vault/enclave')).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await call('POST', '/api/vault/enroll', enrollBody)).status).toBe(503);
    expect((await call('POST', '/api/vault/enroll', enrollBody)).status).toBe(429);
  });
});

// ---- removed releases (VAULT-MESSAGING 0.10.0 §11.10.5) ----------------------------

describe('a removed release', () => {
  beforeEach(() => {
    release(R0, 4, 'removed', { ends_at: '2027-11-01T00:00:00Z' });
    release(R1, 5);
    instance('i-new', R1);
  });

  test('the enclave route answers 410 release_unavailable and requests no start', async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    const r = await call('GET', '/api/vault/enclave');
    expect(r).toEqual({ status: 410, body: expect.objectContaining({ error: 'release_unavailable', code: 'release_unavailable' }) });
    expect(getItem('releases', R0).start_requests).toBeUndefined();
    expect((await call('GET', '/api/vault/enclave', undefined, { query: { release: R0 } })).status).toBe(410);
  });

  test('even a stray live instance of it is not routed', async () => {
    instance('i-old', R0);
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    expect((await call('GET', '/api/vault/enclave')).status).toBe(410);
  });

  test('reopened for a rescue: routed as usual, and started on demand', async () => {
    release(R0, 4, 'removed', { rescue: true });
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ error: 'release_starting', release: R0 });
    expect(getItem('releases', R0).start_requests).toBe(1);
    instance('i-old', R0);
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ instance_id: 'i-old', release: R0 });
  });

  test('recovery is 410 too (no instance to send it to)', async () => {
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0 });
    const r = await call('POST', '/api/vault/recovery', { browser_key: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64') });
    expect(r.status).toBe(410);
    expect(getItem('vaults', VID).recovery).toBeUndefined();
    expect(sqs.calls()).toHaveLength(0);
  });
});

// manifest_sha256: REQUIRED, 64 lowercase hex (VAULT-MESSAGING 0.10.0 §11.1).
const badManifestHashes: [string, Record<string, unknown>][] = [
  ['no manifest_sha256', { manifest_sha256: undefined }],
  ['manifest_sha256 in upper case', { manifest_sha256: 'A'.repeat(64) }],
  ['manifest_sha256 of 63 hex', { manifest_sha256: '9'.repeat(63) }],
  ['manifest_sha256 of 65 hex', { manifest_sha256: '9'.repeat(65) }],
  ['manifest_sha256 as a number', { manifest_sha256: 9 }],
  ['manifest_sha256 in base64', { manifest_sha256: Buffer.alloc(32, 9).toString('base64') }],
];

describe('POST /api/vault/enroll', () => {
  // 2.0.0: the redeem made the vault and recorded the pending key; enroll names that vault.
  const body = (extra: Record<string, unknown> = {}) => ({ vault_id: evid('g1'), request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA, ...extra });
  beforeEach(() => {
    release(R1, 5);
    instance('i-1', R1);
  });

  test("goes to the redeem's vault, writes the slot with the key's kid, enqueues the §11.5 message with app_key, audits", async () => {
    const r = await call('POST', '/api/vault/enroll', body());
    expect(r.status).toBe(202);
    const vid = evid('g1');
    expect(r.body).toEqual({ vault_id: vid, request_id: RID });
    expect(getItem('requests', RID)).toMatchObject({ request_id: RID, vault_id: vid, user_guid: 'g1', op: 'enroll', status: 'queued', instance_id: 'i-1', expires_at: NOW + 900, app_kid: keyOf('g1').kid });
    expect(getItem('requests', RID)).not.toHaveProperty('envelope'); // envelopes are not stored
    const [m] = sent();
    expect(m.url).toBe(QUEUE_PREFIX + 'i-1');
    // 2.2.0: every enroll carries the account snapshot (VAULT-MESSAGING 0.18.0 §11.5).
    expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'etk_kid', 'envelope', 'manifest_sha256', 'app_key', 'account', 'enqueued_at']);
    expect(m.msg).toMatchObject({ v: 1, op: 'enroll', vault_id: vid, user_guid: 'g1', request_id: RID, etk_kid: KID, envelope: ENV, manifest_sha256: MSHA, app_key: keyOf('g1').b64 });
    expect(m.msg.account).toMatchObject({ v: 1, email: 'g1@x.org', first_name: 'Ada', last_name: 'One', name_change: { allowed_after: null, last: null }, state: 'member', account_status: 'active' });
    expect(m.msg.account).not.toHaveProperty('email_hint'); // 2.3.0
    const auditPut = ddb.commandCalls(PutCommand).find((c) => c.args[0].input.TableName === 'audit')!;
    expect(auditPut.args[0].input.Item).toMatchObject({ action: 'vault.enroll_request', subject: 'g1', detail: { vault_id: vid, via: 'app', kid: keyOf('g1').kid } });
    expect(JSON.stringify(auditPut.args[0].input.Item)).not.toContain(ENV.slice(0, 64));
  });

  test('2.2.0: no snapshot, no enroll: 503 vault_unavailable and nothing queued', async () => {
    put('members', { ...getItem('members', 'g1'), last_name: 'x'.repeat(161) });
    const r = await call('POST', '/api/vault/enroll', body());
    expect(r).toEqual({ status: 503, body: expect.objectContaining({ error: 'vault_unavailable' }) });
    expect(sqs.calls()).toHaveLength(0);
    expect(tbl('requests').size).toBe(0);
  });

  test.each([
    ['too short', 'a@'],
    ['without @', 'member.example.com'],
    ['over 1,016 bytes', 'm@' + 'x'.repeat(1015)],
    ['with a control character', 'm\n@x.org'],
    ['missing', undefined],
  ])('2.3.0: an email a vault would refuse (%s): no snapshot, no enroll, nothing queued', async (_n, email) => {
    put('members', { ...getItem('members', 'g1'), email });
    const r = await call('POST', '/api/vault/enroll', body());
    expect(r).toEqual({ status: 503, body: expect.objectContaining({ error: 'vault_unavailable' }) });
    expect(sqs.calls()).toHaveLength(0);
    expect(tbl('requests').size).toBe(0);
  });

  test("a second enrollment reuses the member's vault_id (the enclave decides on replacement)", async () => {
    const first = await call('POST', '/api/vault/enroll', body());
    const second = await call('POST', '/api/vault/enroll', body({ request_id: RID2 }));
    expect(second.body.vault_id).toBe(first.body.vault_id);
  });

  test('only the pending key enrolls: the vault app key, an expired pending key, another vault → 401 or 404', async () => {
    provision('g1', 'pending', keyOf('g1'));
    const row = getItem('vaults', evid('g1'));
    // The host reported this key as the vault's app key: no longer pending (cleared once app_key names it).
    row.app_key = { key: keyOf('g1').b64, kid: keyOf('g1').kid, seq: 1 };
    expect((await call('POST', '/api/vault/enroll', body(), { app: { key: keyOf('g1'), vault: evid('g1') } })).status).toBe(401);
    delete row.app_key;
    row.app_key_pending.until = NOW;
    expect((await call('POST', '/api/vault/enroll', body(), { app: { key: keyOf('g1'), vault: evid('g1') } })).status).toBe(401);
    row.app_key_pending.until = NOW + 10;
    expect((await call('POST', '/api/vault/enroll', body({ vault_id: VID }), { app: { key: keyOf('g1'), vault: evid('g1') } })).status).toBe(404);
    expect(sqs.calls()).toHaveLength(0);
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
    ...badManifestHashes,
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
  const body = (extra: Record<string, unknown> = {}) => ({ vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA, ...extra });
  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
    instance('i-2', R0);
  });

  test('no lease: forwarded to the named live instance; the §11.5 message carries manifest_sha256', async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    const r = await call('POST', '/api/vault/unlock', body());
    expect(r).toEqual({ status: 202, body: { vault_id: VID, request_id: RID } });
    const [m] = sent();
    expect(m).toMatchObject({ url: QUEUE_PREFIX + 'i-1', msg: { v: 1, op: 'unlock', vault_id: VID, user_guid: 'g1', request_id: RID, etk_kid: KID, envelope: ENV, manifest_sha256: MSHA } });
    // 2.0.0: the account snapshot rides in every unlock (VAULT-MESSAGING §11.13); no app_key.
    expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'etk_kid', 'envelope', 'manifest_sha256', 'account', 'enqueued_at']);
    expect(Object.keys(m.msg.account)).toEqual(['v', 'as_of', 'email', 'first_name', 'last_name', 'name_change', 'state', 'account_status', 'deletes_at', 'terms', 'subscription', 'voting_rights']);
    expect(m.msg.account).toEqual({
      v: 1, as_of: new Date(NOW_MS).toISOString(), email: 'g1@x.org', // 2.3.0: the full address, not the hint
      first_name: 'Ada', last_name: 'One', name_change: { allowed_after: null, last: null }, // 2.2.0
      state: 'member', account_status: 'active', deletes_at: null,
      terms: { needs_acceptance: false }, subscription: null, voting_rights: false,
    });
    expect(getItem('requests', RID).app_kid).toBe(keyOf('g1').kid);
  });

  test('the snapshot carries the subscription, the terms state, (2.2.0) the names and (2.3.0) the email; never the user_guid', async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    put('members', { ...getItem('members', 'g1'), first_name: 'Gina', last_name: 'One' });
    put('subscriptions', { user_guid: 'g1', type_id: 'trial', type_name: 'Trial', status: 'trial', paid: false, started_at: '2026-10-01T00:00:00.000Z', expires_at: '2026-10-31T00:00:00.000Z' });
    put('terms', { version_id: 't1', status: 'superseded' });
    put('terms', { version_id: 't2', status: 'current' });
    await call('POST', '/api/vault/unlock', body());
    const a = sent()[0].msg.account;
    expect(a).toMatchObject({ terms: { needs_acceptance: true }, subscription: { type_name: 'Trial', status: 'trial', paid: false, expires_at: '2026-10-31T00:00:00.000Z' } });
    expect(Object.keys(a.subscription)).toEqual(['type_name', 'status', 'paid', 'expires_at']);
    expect(a).toMatchObject({ first_name: 'Gina', last_name: 'One' });
    const text = JSON.stringify(a);
    expect(text).not.toContain('"g1"');
    expect(a.email).toBe('g1@x.org');
    expect(text).not.toContain('***'); // no email_hint
  });

  test("2.2.0: name_change carries allowed_after (the last applied change + 30 days) and the vault row's result", async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0, name_change_result: { seq: 3, status: 'refused', reason: 'too_soon' } });
    const changed = new Date(NOW_MS - 10 * 86_400_000).toISOString();
    put('members', { ...getItem('members', 'g1'), name_changed_at: changed, name_change_applied: { vault_id: VID, seq: 2, first_name: 'Old', last_name: 'Name' } });
    await call('POST', '/api/vault/unlock', body());
    const a = sent()[0].msg.account;
    expect(a.name_change).toEqual({ allowed_after: new Date(NOW_MS + 20 * 86_400_000).toISOString(), last: { seq: 3, status: 'refused', reason: 'too_soon' } });
    expect(JSON.stringify(a)).not.toContain('Old'); // the change record stays on the member row
  });

  test('2.2.0: allowed_after is null once the 30 days have passed; an applied result has no reason; a malformed one is null', async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0, name_change_result: { seq: 4, status: 'applied', reason: 'x' } });
    put('members', { ...getItem('members', 'g1'), name_changed_at: new Date(NOW_MS - 30 * 86_400_000).toISOString() });
    await call('POST', '/api/vault/unlock', body());
    expect(sent()[0].msg.account.name_change).toEqual({ allowed_after: null, last: { seq: 4, status: 'applied' } });
    put('vaults', { ...getItem('vaults', VID), name_change_result: { seq: 5, status: 'refused', reason: 'other' } });
    await call('POST', '/api/vault/unlock', body({ request_id: RID2 }));
    expect(sent()[1].msg.account.name_change.last).toBeNull();
  });

  test('2.2.0: a member without names a vault accepts gets no snapshot in an unlock (it is optional there)', async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    put('members', { ...getItem('members', 'g1'), first_name: '' });
    expect((await call('POST', '/api/vault/unlock', body())).status).toBe(202);
    expect(sent()[0].msg).not.toHaveProperty('account');
  });

  test('2.3.0: a member whose email a vault would refuse gets no snapshot in an unlock', async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    put('members', { ...getItem('members', 'g1'), email: 'no-at-sign' });
    expect((await call('POST', '/api/vault/unlock', body())).status).toBe(202);
    expect(sent()[0].msg).not.toHaveProperty('account');
  });

  test('2.3.0: with the names and the email at their maxima the snapshot fits in 2 KiB', async () => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0, name_change_result: { seq: 2 ** 40, status: 'refused', reason: 'too_soon' } });
    const email = 'm@' + 'x'.repeat(1014); // 1,016 bytes
    put('members', { ...getItem('members', 'g1'), email, first_name: 'Ä'.repeat(80), last_name: 'Ö'.repeat(80), name_changed_at: new Date(NOW_MS - 86_400_000).toISOString() });
    put('subscriptions', { user_guid: 'g1', type_id: 't', type_name: 'T'.repeat(64), status: 'trial', paid: false, started_at: '2026-10-01T00:00:00.000Z', expires_at: '2026-10-31T00:00:00.000Z' });
    expect((await call('POST', '/api/vault/unlock', body())).status).toBe(202);
    const a = sent()[0].msg.account;
    expect(a.email).toBe(email);
    expect(Buffer.byteLength(JSON.stringify(a), 'utf8')).toBeLessThanOrEqual(2048);
  });

  test.each(badManifestHashes)('rejects %s with 400 and enqueues nothing', async (_name, extra) => {
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    const r = await call('POST', '/api/vault/unlock', body(extra));
    expect(r).toEqual({ status: 400, body: expect.objectContaining({ error: 'bad_request' }) });
    expect(sqs.calls()).toHaveLength(0);
    expect(tbl('requests').size).toBe(0);
  });

  test('the named instance runs a removed release → 410 release_unavailable, nothing queued; a rescue reopens it', async () => {
    release(R0, 4, 'removed', { ends_at: '2027-11-01T00:00:00Z' });
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    const r = await call('POST', '/api/vault/unlock', body());
    expect(r).toEqual({ status: 410, body: expect.objectContaining({ error: 'release_unavailable', code: 'release_unavailable' }) });
    expect(sqs.calls()).toHaveLength(0);
    expect(tbl('requests').size).toBe(0);
    release(R0, 4, 'removed', { rescue: true });
    expect((await call('POST', '/api/vault/unlock', body({ request_id: RID2 }))).status).toBe(202);
    expect(sent()).toHaveLength(1);
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

  test("another member's vault or a deleted vault → 401 (no key of this app); another vault_id in the body → 404", async () => {
    vaultOf('g2', { vault_id: VID });
    provision('g2', 'app', keyOf('g2'));
    expect((await call('POST', '/api/vault/unlock', body(), { app: { key: keyOf('g1'), vault: VID } })).status).toBe(401); // g1 has no vault
    vaultOf('g1', { vault_id: 'e'.repeat(32) });
    expect((await call('POST', '/api/vault/unlock', body())).status).toBe(404);
    vaultOf('g1', { vault_id: VID, state: 'deleted', app_key: { key: keyOf('g1').b64, kid: keyOf('g1').kid, seq: 1 } });
    expect((await call('POST', '/api/vault/unlock', body(), { app: { key: keyOf('g1'), vault: VID } })).status).toBe(401);
    expect(sqs.calls()).toHaveLength(0);
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

  test('audited without PIN or envelope', async () => {
    vaultOf('g1', { vault_id: VID });
    await call('POST', '/api/vault/unlock', body());
    const item = ddb.commandCalls(PutCommand).find((c) => c.args[0].input.TableName === 'audit')!.args[0].input.Item!;
    expect(item).toMatchObject({ action: 'vault.unlock_request', subject: 'g1', detail: { vault_id: VID, request_id: RID, instance_id: 'i-1', via: 'app', kid: keyOf('g1').kid } });
    expect(JSON.stringify(item)).not.toContain(ENV.slice(0, 64));
  });

  test('60 per IPv4 address (carrier NAT) across members', async () => {
    const headers = { 'cloudfront-viewer-address': '198.51.100.7:443' };
    const key = `vault-unlock-net#198.51.100.7#${NOW - (NOW % 900)}`;
    put('rl', { key, count: 59 });
    vaultOf('g1', { vault_id: VID });
    expect((await call('POST', '/api/vault/unlock', body(), { headers })).status).toBe(202); // 60th
    const r = await call('POST', '/api/vault/unlock', body({ request_id: RID2 }), { headers });
    expect(r.status).toBe(429);
    expect(getItem('rl', key).count).toBe(61);
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

  test('works whatever the release status, including removed (locking only reduces exposure)', async () => {
    release(R0, 4, 'removed');
    vaultOf('g1', { vault_id: VID, state: 'unlocked', sealed_release: R0, lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID })).status).toBe(202);
    expect(sent().map((m) => m.msg.op)).toEqual(['lock']);
  });

  test('goes to the leaseholder, without envelope, etk_kid or manifest_sha256', async () => {
    vaultOf('g1', { vault_id: VID, state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    const r = await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID });
    expect(r.status).toBe(202);
    const [m] = sent();
    expect(m.url).toBe(QUEUE_PREFIX + 'i-1');
    expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'enqueued_at']);
    expect(m.msg.op).toBe('lock');
    const item = ddb.commandCalls(PutCommand).find((c) => c.args[0].input.TableName === 'audit')!.args[0].input.Item!;
    expect(item).toMatchObject({ action: 'vault.lock_request', detail: { vault_id: VID, request_id: RID, instance_id: 'i-1' } });
  });

  test('no live lease: nothing to lock, the slot is done at once', async () => {
    vaultOf('g1', { vault_id: VID });
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID })).status).toBe(202);
    expect(sqs.calls()).toHaveLength(0);
    expect((await call('GET', `/api/vault/requests/${RID}`)).body).toEqual({ status: 'done' });
  });
});

// ---- GET /api/vault/requests/{id} ------------------------------------------------

describe('GET /api/vault/requests/{id}', () => {
  const slot = (extra: Record<string, unknown>) =>
    put('requests', { request_id: RID, vault_id: VID, user_guid: 'g1', op: 'unlock', status: 'queued', created_at: new Date(NOW_MS - 10_000).toISOString(), expires_at: NOW + 800, ...extra });
  const RESULT = Buffer.alloc(5_252, 7).toString('base64');

  test('queued, then done with the opaque envelope and code', async () => {
    slot({});
    expect((await call('GET', `/api/vault/requests/${RID}`)).body).toEqual({ status: 'queued' });
    slot({ status: 'done', envelope: RESULT, code: 'etk_unknown' });
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 1000); // next polling window
    expect((await call('GET', `/api/vault/requests/${RID}`)).body).toEqual({ status: 'done', envelope: RESULT, code: 'etk_unknown' });
  });

  test('only a 5,252-byte result envelope and a well-formed code are passed on', async () => {
    for (const [i, bytes] of [5_251, 5_253, 13_444, 8_192].entries()) {
      jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + i * 1000);
      slot({ status: 'done', envelope: Buffer.alloc(bytes).toString('base64'), code: 'Bad Code' });
      expect((await call('GET', `/api/vault/requests/${RID}`)).body).toEqual({ status: 'done' });
    }
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
    expect((await call('GET', '/api/vault/status')).body).toEqual({ vault: null, service: 'available' });
  });

  test('advisory lifecycle fields; lease as a boolean only', async () => {
    vaultOf('g1', { vault_id: VID, state: 'unlocked', sealed_release: R0, vault_version: R0, state_version: 1, lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    const r = await call('GET', '/api/vault/status');
    expect(r.body).toEqual({
      vault: {
        vault_id: VID, state: 'unlocked', sealed_release: R0, vault_version: R0, state_version: 1, leased: true, recovery: null, alarm: null,
        credential_backup: null, deletion: null, // 2.1.0
        // R0 has no release row here: unknown (the API would answer 410).
        release: { number: null, status: 'unknown', ends_at: null, newest_active: null, notice: 'unavailable' },
        created_at: expect.any(String), updated_at: expect.any(String),
      },
      service: 'available',
    });
  });

  test('`unlocked` only under a live lease: a stopped vault the host has not marked reads `locked` (0.10.6 §11.5)', async () => {
    // Locked from the app over the relay: the host removed the lease but the row still says unlocked.
    vaultOf('g1', { vault_id: VID, state: 'unlocked', sealed_release: R0 });
    let r = (await call('GET', '/api/vault/status')).body.vault;
    expect(r).toMatchObject({ state: 'locked', leased: false });
    // An expired lease (a crashed instance) is no lease either.
    put('vaults', { ...getItem('vaults', VID), lease: { instance_id: 'i-1', lease_expires_at: NOW } });
    r = (await call('GET', '/api/vault/status')).body.vault;
    expect(r).toMatchObject({ state: 'locked', leased: false });
    put('vaults', { ...getItem('vaults', VID), lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    expect((await call('GET', '/api/vault/status')).body.vault).toMatchObject({ state: 'unlocked', leased: true });
    // Other states are reported as they are.
    put('vaults', { ...getItem('vaults', VID), state: 'enrolling', lease: undefined });
    expect((await call('GET', '/api/vault/status')).body.vault.state).toBe('enrolling');
    // The row itself is not rewritten (the host owns `state`).
    expect(getItem('vaults', VID).state).toBe('enrolling');
  });

  test('a deleted vault (§12.5) reads as no vault', async () => {
    vaultOf('g1', { vault_id: VID, state: 'deleted', alarm: { kind: 'vault_deleted', alarm_id: '01JABCDEFGHJKMNPQRSTVWXYZ0', at: NOW } });
    expect((await call('GET', '/api/vault/status')).body).toEqual({ vault: null, service: 'available' });
  });

  test('the last host-reported alarm (kind and time only, VAULT-MESSAGING 0.9.0 §11.5)', async () => {
    vaultOf('g1', { vault_id: VID, state: 'unlocked', alarm: { kind: 'credential_clone', alarm_id: '01JABCDEFGHJKMNPQRSTVWXYZ0', at: NOW - 60, emailed_at: NOW }, alarm_pending: true });
    const r = await call('GET', '/api/vault/status');
    expect(r.body.vault.alarm).toEqual({ kind: 'credential_clone', at: new Date((NOW - 60) * 1000).toISOString() });
    expect(JSON.stringify(r.body)).not.toContain('01JABCDEFGHJKMNPQRSTVWXYZ0');
  });
});

describe('GET /api/vault/status: the sealed release and its notice (W8)', () => {
  const RN = 'c'.repeat(96);
  const status = async () => (await call('GET', '/api/vault/status')).body.vault.release;
  beforeEach(() => release(RN, 6)); // the newest active release

  test.each([
    ['the newest active release: no notice', 'active', { release_number: 8 }, { number: 8, status: 'active', newest_active: 8, notice: null }],
    ['deprecated: update available, with its end date', 'deprecated', { ends_at: '2027-11-01T00:00:00Z' }, { status: 'deprecated', ends_at: '2027-11-01T00:00:00Z', notice: 'update_available' }],
    ['retired: the final warning', 'retired', { ends_at: '2027-11-01T00:00:00Z' }, { status: 'retired', notice: 'final_warning' }],
    ['removed: ended', 'removed', { ends_at: '2027-11-01T00:00:00Z' }, { status: 'removed', notice: 'ended' }],
    ['removed, reopened: rescue', 'removed', { rescue: true }, { notice: 'rescue' }],
    ['no longer startable: unavailable', 'deprecated', { available: false }, { notice: 'unavailable' }],
  ])('%s', async (_what, st, extra, want) => {
    release(R0, 4, st, extra);
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    expect(await status()).toMatchObject({ newest_active: 6, ...want });
  });

  test('an older release that is still active: update available', async () => {
    release(R0, 4);
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    expect(await status()).toEqual({ number: 4, status: 'active', ends_at: null, newest_active: 6, notice: 'update_available' });
  });

  test('a canary release reads as unknown to anyone but a canary member', async () => {
    release(R0, 7, 'canary');
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    expect(await status()).toMatchObject({ number: null, status: 'unknown', notice: 'unavailable' });
    put('members', { ...getItem('members', 'g1'), vault_canary: true });
    expect(await status()).toMatchObject({ number: 7, status: 'canary', notice: null });
  });

  test('a vault not sealed yet has no release', async () => {
    vaultOf('g1', { vault_id: VID, state: 'enrolling' });
    expect(await status()).toBeNull();
  });
});

// ---- canary releases (VAULT-RELEASES §10.1 step 9, §11.3; W8) ----------------------

describe('canary routing', () => {
  const RC = 'c'.repeat(96); // the release under test
  const enrollBody = { vault_id: evid('g1'), request_id: RID, instance_id: 'i-canary', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
  const canaryMember = (g = 'g1') => put('members', { ...getItem('members', g), vault_canary: true });
  beforeEach(() => {
    release(R0, 4); // the current release
    release(RC, 5, 'canary');
    instance('i-cur', R0);
  });

  test('normal members never see a canary release: enrollment goes to the active one', async () => {
    instance('i-canary', RC);
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ instance_id: 'i-cur', release: R0 });
    expect((await call('POST', '/api/vault/enroll', enrollBody)).body).toMatchObject({ error: 'instance_moved' });
    expect(sqs.calls()).toHaveLength(0);
  });

  test('normal members: a canary release is unknown (410), even asked for by PCR0 or named by instance', async () => {
    instance('i-canary', RC);
    vaultOf('g1', { vault_id: VID, sealed_release: RC });
    expect((await call('GET', '/api/vault/enclave')).status).toBe(410);
    expect((await call('GET', '/api/vault/enclave', undefined, { query: { release: RC } })).status).toBe(410);
    const r = await call('POST', '/api/vault/unlock', { vault_id: VID, request_id: RID, instance_id: 'i-canary', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA });
    expect(r.status).toBe(410);
    expect(getItem('releases', RC).start_requests).toBeUndefined();
    expect(sqs.calls()).toHaveLength(0);
  });

  test('a canary member enrolls into the canary release, which is started on demand', async () => {
    canaryMember();
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ error: 'release_starting', release: RC });
    expect(getItem('releases', RC).start_requests).toBe(1);
    instance('i-canary', RC);
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ instance_id: 'i-canary', release: RC });
    expect((await call('POST', '/api/vault/enroll', enrollBody)).status).toBe(202);
    expect(sent()[0]).toMatchObject({ url: QUEUE_PREFIX + 'i-canary', msg: { op: 'enroll' } });
  });

  test('a canary member can enroll into the canary before any release is active (production release 1)', async () => {
    release(R0, 4, 'deprecated');
    canaryMember();
    instance('i-canary', RC);
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ instance_id: 'i-canary' });
    tbl('releases').delete(RC);
    expect((await call('GET', '/api/vault/enclave')).body.error).toBe('vault_unavailable');
  });

  test('a canary member with no canary release enrolls as usual', async () => {
    tbl('releases').delete(RC);
    canaryMember();
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ instance_id: 'i-cur' });
  });

  test('a canary member’s vault sealed to the canary is routed there: unlock and recovery', async () => {
    canaryMember();
    instance('i-canary', RC);
    vaultOf('g1', { vault_id: VID, sealed_release: RC });
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ instance_id: 'i-canary' });
    const r = await call('POST', '/api/vault/unlock', { vault_id: VID, request_id: RID, instance_id: 'i-canary', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA });
    expect(r.status).toBe(202);
    const rec = await call('POST', '/api/vault/recovery', { browser_key: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64') });
    expect(rec.status).toBe(202);
    expect(sent().map((s) => [s.url, s.msg.op])).toEqual([[QUEUE_PREFIX + 'i-canary', 'unlock'], [QUEUE_PREFIX + 'i-canary', 'recovery']]);
  });

  test('the oldest release’s canary vault keeps its release until it moves (the ladder, §11.3)', async () => {
    canaryMember();
    instance('i-canary', RC);
    vaultOf('g1', { vault_id: VID, sealed_release: R0 });
    expect((await call('GET', '/api/vault/enclave')).body).toMatchObject({ instance_id: 'i-cur', release: R0 });
  });

  test('a canary release that cannot start is 410 for canary members too', async () => {
    canaryMember();
    release(RC, 5, 'canary', { available: false });
    vaultOf('g1', { vault_id: VID, sealed_release: RC });
    expect((await call('GET', '/api/vault/enclave')).status).toBe(410);
  });
});

test('routable: statuses, canary and rescue (shared with the cleanup job)', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { routable } = require('../../lambda/shared/vault-routing');
  /* eslint-enable */
  const row = (status: string, extra = {}) => ({ release: R0, release_number: 1, status, ...extra });
  expect(['active', 'deprecated', 'retired'].map((s) => routable(row(s)))).toEqual([true, true, true]);
  expect(routable(row('removed'))).toBe(false);
  expect(routable(row('removed', { rescue: true }))).toBe(true);
  expect(routable(row('canary'))).toBe(false);
  expect(routable(row('canary'), { canary: true })).toBe(true);
  expect(routable(row('active', { available: false }))).toBe(false);
  expect(routable(row('candidate'))).toBe(false); // never a row; refused if one appears
  expect(routable(null)).toBe(false);
});

// ---- helpers ------------------------------------------------------------------------

test('envelope sizes match VAULT-MESSAGING §5.4', () => {
  expect(vault.ENVELOPE_BYTES_LARGE).toBe(13_444);
  expect(vault.ENVELOPE_BYTES_SMALL).toBe(5_252);
  expect(vault.RESULT_ENVELOPE_BYTES).toBe(5_252);
  expect(vault.decodeCanonicalB64('AA==')).toEqual(Buffer.from([0]));
  expect(vault.decodeCanonicalB64('AB==')).toBeNull(); // non-zero padding bits
  expect(vault.decodeCanonicalB64('AA')).toBeNull();
});

// ---- recovery (VAULT-MESSAGING §11.11) ----------------------------------------------

describe('vault recovery', () => {
  const BK = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
  const mails = () => sesMock.commandCalls(SendEmailCommand).map((c) => ({
    to: c.args[0].input.Destination!.ToAddresses![0],
    subject: c.args[0].input.Content!.Simple!.Subject!.Data!,
    text: c.args[0].input.Content!.Simple!.Body!.Text!.Data!,
  }));
  // Move the clock; the instances keep heartbeating.
  const at = (s: number) => {
    jest.spyOn(Date, 'now').mockReturnValue(s * 1000);
    for (const i of tbl('instances').values()) i.heartbeat_at = s - 10;
  };
  const request = async () => {
    const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
    expect(r.status).toBe(202);
    return r.body.recovery_id as string;
  };
  const sealedCode = Buffer.alloc(5_252, 0x33).toString('base64');
  const answer = (rid: string) => Object.assign(getItem('requests', rid), { status: 'done', envelope: sealedCode });

  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0 });
  });

  test('request: recorded, queued with the browser key and no envelope, mailed with a cancel link, audited', async () => {
    const rid = await request();
    const row = getItem('vaults', VID);
    expect(row.recovery).toEqual({ recovery_id: rid, state: 'pending', requested_at: NOW, available_at: NOW + 86_400, expires_at: NOW + 172_800 });
    const [m] = sent();
    expect(m.url).toBe(QUEUE_PREFIX + 'i-1');
    expect(m.msg).toMatchObject({ v: 1, op: 'recovery', vault_id: VID, user_guid: 'g1', request_id: rid, browser_key: BK });
    expect(m.msg.envelope).toBeUndefined();
    expect(m.msg.etk_kid).toBeUndefined();
    // The slot keeps the sealed code until the recovery expires.
    expect(getItem('requests', rid).expires_at).toBeGreaterThan(NOW + 172_800);
    const [mail] = mails();
    expect(mail.to).toBe('g1@x.org');
    const token = /cancel#t=([A-Za-z0-9_-]{43})/.exec(mail.text)![1];
    // Only the token's hash is stored.
    const linkRows = [...tbl('requests').values()].filter((x) => x.op === 'recovery_cancel_link');
    expect(linkRows).toHaveLength(1);
    expect(JSON.stringify(linkRows)).not.toContain(token);
    expect([...tbl('audit').values()].map((a) => a.action)).toContain('vault.recovery_request');
    expect(JSON.stringify([...tbl('audit').values()])).not.toContain(BK);
  });

  test('GET /api/vault/recovery without an enrolled vault is {recovery: null}, not 404 (0.10.6 §11.11.7)', async () => {
    expect(await call('GET', '/api/vault/recovery', undefined, { guid: 'g2' })).toEqual({ status: 200, body: { recovery: null } });
    put('vaults', { ...getItem('vaults', VID), state: 'enrolling' });
    expect(await call('GET', '/api/vault/recovery')).toEqual({ status: 200, body: { recovery: null } });
    put('vaults', { ...getItem('vaults', VID), state: 'deleted' });
    expect(await call('GET', '/api/vault/recovery')).toEqual({ status: 200, body: { recovery: null } });
  });

  test('bad browser key → 400; no enrolled vault → 404; a second request while one is active → 409', async () => {
    expect((await call('POST', '/api/vault/recovery', { browser_key: Buffer.alloc(65, 3).toString('base64') })).status).toBe(400);
    expect((await call('POST', '/api/vault/recovery', { browser_key: 'AAAA' })).status).toBe(400);
    put('vaults', { ...getItem('vaults', VID), state: 'enrolling' });
    expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(404);
    put('vaults', { ...getItem('vaults', VID), state: 'locked' });
    await request();
    const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
    expect(r).toMatchObject({ status: 409, body: { error: 'recovery_active' } });
  });

  test('goes to the leaseholder when the vault is running (the enclave locks it first)', async () => {
    instance('i-2', R0, { load: 9 });
    put('vaults', { ...getItem('vaults', VID), state: 'unlocked', lease: { instance_id: 'i-2', lease_expires_at: NOW + 60 } });
    await request();
    expect(sent()[0].url).toBe(QUEUE_PREFIX + 'i-2');
  });

  test('the sealed code is released only between available_at and expires_at', async () => {
    const rid = await request();
    answer(rid);
    let r = await call('GET', '/api/vault/recovery');
    expect(r.body.recovery).toMatchObject({ recovery_id: rid, state: 'pending' });
    expect(r.body.recovery.sealed_code).toBeUndefined();
    at(NOW + 86_400);
    r = await call('GET', '/api/vault/recovery');
    expect(r.body.recovery).toMatchObject({ vault_id: VID, state: 'available', sealed_code: sealedCode });
    await call('GET', '/api/vault/recovery');
    expect([...tbl('audit').values()].filter((a) => a.action === 'vault.recovery_code_released')).toHaveLength(1);
    at(NOW + 172_800);
    r = await call('GET', '/api/vault/recovery');
    expect(r.body.recovery.state).toBe('expired');
    expect(r.body.recovery.sealed_code).toBeUndefined();
    // Owner apps see it in the status while it is active.
    at(NOW + 100);
    expect((await call('GET', '/api/vault/status')).body.vault.recovery).toEqual({ state: 'pending', available_at: new Date((NOW + 86_400) * 1000).toISOString() });
  });

  test('register: only while available, like an unlock', async () => {
    const rid = await request();
    answer(rid);
    const body = { vault_id: VID, request_id: RID2, instance_id: 'i-1', etk_kid: KID, envelope: ENV };
    expect((await call('POST', '/api/vault/recovery/register', body)).body.error).toBe('recovery_not_available');
    at(NOW + 86_400 + 5);
    const r = await call('POST', '/api/vault/recovery/register', body);
    expect(r).toEqual({ status: 202, body: { vault_id: VID, request_id: RID2 } });
    const m = sent().pop()!;
    expect(m.msg).toMatchObject({ op: 'recovery_register', request_id: RID2, etk_kid: KID, envelope: ENV });
    expect((await call('POST', '/api/vault/recovery/register', { ...body, envelope: envelope(5_252) })).status).toBe(400);
  });

  test('cancel from the session: marked, queued to the enclave, mailed; then a new request is possible', async () => {
    const rid = await request();
    expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: RID })).status).toBe(404);
    expect(await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).toEqual({ status: 200, body: { cancelled: true } });
    expect(getItem('vaults', VID).recovery.state).toBe('cancelled');
    expect(sent().map((m) => m.msg.op)).toEqual(['recovery', 'recovery_cancel']);
    // Again: nothing left to cancel, nothing queued or mailed.
    expect(await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).toEqual({ status: 200, body: { cancelled: false } });
    expect(sent()).toHaveLength(2);
    expect(mails().map((m) => m.subject)).toContain('VettID vault recovery cancelled');
    expect((await call('GET', '/api/vault/recovery')).body.recovery.state).toBe('cancelled');
    // A cancelled recovery is never released.
    at(NOW + 86_400);
    expect((await call('GET', '/api/vault/recovery')).body.recovery.sealed_code).toBeUndefined();
    expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(202);
  });

  test('cancel by the email link, without a session; a wrong token → 404', async () => {
    await request();
    const token = /cancel#t=([A-Za-z0-9_-]{43})/.exec(mails()[0].text)![1];
    const noSession = { headers: {}, guid: 'nobody' };
    expect((await call('POST', '/api/vault/recovery/cancel-link', { token: 'x'.repeat(43) }, noSession)).status).toBe(404);
    expect((await call('POST', '/api/vault/recovery/cancel-link', { token: 'short' }, noSession)).status).toBe(400);
    expect(await call('POST', '/api/vault/recovery/cancel-link', { token }, noSession)).toEqual({ status: 200, body: { cancelled: true } });
    expect(getItem('vaults', VID).recovery.state).toBe('cancelled');
    // The link stays valid until expires_at; a second use cancels nothing.
    expect(await call('POST', '/api/vault/recovery/cancel-link', { token }, noSession)).toEqual({ status: 200, body: { cancelled: false } });
    expect(mails().filter((m) => m.subject === 'VettID vault recovery cancelled')).toHaveLength(1);
    const a = [...tbl('audit').values()].find((x) => x.action === 'vault.recovery_cancel');
    expect(a.detail.via).toBe('link');
    expect(JSON.stringify([...tbl('audit').values()])).not.toContain(token);
  });

  describe('registered: the code is spent (0.10.6 §11.11.7)', () => {
    const REG = { vault_id: VID, request_id: RID2, instance_id: 'i-1', etk_kid: KID, envelope: ENV };
    const RESULT = Buffer.alloc(5_252, 0x44).toString('base64');
    /** Request, answer, wait 24 h, register. */
    const registerOnce = async () => {
      const rid = await request();
      answer(rid);
      at(NOW + 86_400 + 5);
      expect((await call('POST', '/api/vault/recovery/register', REG)).status).toBe(202);
      return rid;
    };
    const answerRegister = (code?: string) => Object.assign(getItem('requests', RID2), { status: 'done', envelope: RESULT, ...(code ? { code } : {}) });
    const registeredAudits = () => [...tbl('audit').values()].filter((a) => a.action === 'vault.recovery_registered');

    test('the register slot names its recovery, and the recovery keeps the register id', async () => {
      const rid = await registerOnce();
      expect(getItem('requests', RID2)).toMatchObject({ op: 'recovery_register', recovery_id: rid, status: 'queued' });
      expect(getItem('vaults', VID).recovery).toMatchObject({ recovery_id: rid, state: 'pending', register_ids: [RID2] });
    });

    test("learnt from the app's poll of the register result: no more sealed_code; blocks a new request; still cancellable", async () => {
      const rid = await registerOnce();
      answerRegister('recovery_registered');
      // The app reads the envelope; the marker is passed on (apps ignore it).
      expect((await call('GET', `/api/vault/requests/${RID2}`)).body).toEqual({ status: 'done', envelope: RESULT, code: 'recovery_registered' });
      expect(getItem('vaults', VID).recovery.state).toBe('registered');
      expect(registeredAudits()).toHaveLength(1);
      expect(registeredAudits()[0].detail).toEqual({ vault_id: VID, recovery_id: rid });
      const r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r).toMatchObject({ recovery_id: rid, vault_id: VID, state: 'registered' });
      expect(r.sealed_code).toBeUndefined();
      expect((await call('GET', '/api/vault/status')).body.vault.recovery).toEqual({ state: 'registered', available_at: new Date((NOW + 86_400) * 1000).toISOString() });
      // The code cannot be registered again, and no new request while it is active.
      expect((await call('POST', '/api/vault/recovery/register', { ...REG, request_id: RID })).body.error).toBe('recovery_not_available');
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('recovery_active');
      // A repeated poll changes nothing.
      jest.spyOn(Date, 'now').mockReturnValue((NOW + 86_400 + 7) * 1000);
      await call('GET', `/api/vault/requests/${RID2}`);
      expect(registeredAudits()).toHaveLength(1);
      // Cancel still works (it removes the registered app's key in the enclave).
      expect(await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).toEqual({ status: 200, body: { cancelled: true } });
      expect(getItem('vaults', VID).recovery.state).toBe('cancelled');
    });

    test('learnt by GET /api/vault/recovery from the register slots when the app never polled', async () => {
      await registerOnce();
      answerRegister('recovery_registered');
      const r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r.state).toBe('registered');
      expect(r.sealed_code).toBeUndefined();
      expect(registeredAudits()).toHaveLength(1);
      // The code was never released after the register.
      expect([...tbl('audit').values()].filter((a) => a.action === 'vault.recovery_code_released')).toHaveLength(0);
    });

    test('learnt by GET /api/vault/status too', async () => {
      await registerOnce();
      answerRegister('recovery_registered');
      expect((await call('GET', '/api/vault/status')).body.vault.recovery.state).toBe('registered');
      expect(getItem('vaults', VID).recovery.state).toBe('registered');
    });

    test('a register answered without the marker (refused, or random bytes) leaves the code available', async () => {
      await registerOnce();
      answerRegister();
      expect((await call('GET', `/api/vault/requests/${RID2}`)).body).toEqual({ status: 'done', envelope: RESULT });
      expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ state: 'available', sealed_code: sealedCode });
      expect(registeredAudits()).toHaveLength(0);
    });

    test('a marker that arrives after a cancel changes nothing', async () => {
      const rid = await registerOnce();
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).body).toEqual({ cancelled: true });
      answerRegister('recovery_registered');
      await call('GET', `/api/vault/requests/${RID2}`);
      expect(getItem('vaults', VID).recovery.state).toBe('cancelled');
      expect(registeredAudits()).toHaveLength(0);
    });

    test("another member's slot or another recovery's marker is ignored", async () => {
      const rid = await registerOnce();
      answerRegister('recovery_registered');
      getItem('requests', RID2).recovery_id = RID; // not this recovery
      await call('GET', '/api/vault/recovery');
      expect(getItem('vaults', VID).recovery).toMatchObject({ recovery_id: rid, state: 'pending' });
    });

    test('after expires_at it still reads registered, but is no longer active', async () => {
      await registerOnce();
      answerRegister('recovery_registered');
      await call('GET', `/api/vault/requests/${RID2}`);
      at(NOW + 172_800);
      expect((await call('GET', '/api/vault/recovery')).body.recovery.state).toBe('registered');
      expect((await call('GET', '/api/vault/status')).body.vault.recovery).toBeNull();
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: getItem('vaults', VID).recovery.recovery_id })).body).toEqual({ cancelled: false });
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(202);
    });
  });

  test('rate limits: 3 requests a day', async () => {
    for (let i = 0; i < 3; i++) {
      await request();
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: getItem('vaults', VID).recovery.recovery_id })).status).toBe(200);
    }
    expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(429);
  });

  test('a mail failure (SES sandbox) does not fail the request', async () => {
    sesMock.on(SendEmailCommand).rejects(Object.assign(new Error('x'), { name: 'MessageRejected' }));
    await request();
    expect(logs.join('\n')).toContain('vault mail failed');
  });
});

// ---- the vault service pause (MEMBER-API 1.2.0 "Vault service pause") ------------------

describe('vault service pause', () => {
  const BK = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
  const UNLOCK = { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
  const REGISTER = { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV };
  const refused: [string, string, unknown?, Record<string, string>?][] = [
    ['GET', '/api/vault/enclave'],
    ['GET', '/api/vault/enclave', undefined, { release: R0 }],
    ['POST', '/api/vault/enroll', { ...UNLOCK, vault_id: undefined }],
    ['POST', '/api/vault/unlock', UNLOCK],
    ['POST', '/api/vault/recovery', { browser_key: BK }],
    ['POST', '/api/vault/recovery/register', REGISTER],
  ];
  const raw = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => vault.handler(build(method, path, body, { query }));
  // An app request's nonce is recorded by its signature check, which comes first (2.0.0); nothing else is written.
  const writes = () => ddb.commandCalls(PutCommand).length + ddb.commandCalls(UpdateCommand).filter((c) => !String(c.args[0].input.Key?.key ?? '').startsWith('appnonce#')).length;

  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0 });
  });

  // register is signed by a claim key, so the vault has a recovery for it.
  const withRecovery = (path: string) => {
    if (path.endsWith('/register')) put('vaults', { ...getItem('vaults', VID), recovery: { recovery_id: RID2, state: 'pending', requested_at: NOW - 90_000, available_at: NOW - 3600, expires_at: NOW + 80_000 } });
  };

  test.each(refused)('paused: %s %s → 503 vault_unavailable, service paused, Retry-After; nothing written, queued, started or counted', async (...[method, path, body, query]: [string, string, unknown?, Record<string, string>?]) => {
    withRecovery(path);
    paused();
    const res = await raw(method, path, body, query);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('300');
    expect(JSON.parse(res.body)).toEqual({
      error: 'vault_unavailable', code: 'vault_unavailable', service: 'paused', retry_after: 300,
      message: 'The vault service is paused for maintenance. Try again later.',
    });
    // Not the operator's reason; no rate-limit hit (a paused attempt does not use up the daily allowance).
    expect(res.body).not.toContain('incident');
    expect(writes()).toBe(0);
    expect(sqs.calls()).toHaveLength(0);
    expect(getItem('releases', R0).start_requested_at).toBeUndefined();
  });

  test.each(refused)('on: %s %s is not refused by the switch', async (...[method, path, body, query]: [string, string, unknown?, Record<string, string>?]) => {
    withRecovery(path);
    const res = await raw(method, path, body, query);
    expect(JSON.parse(res.body).service).toBeUndefined();
  });

  test('paused before body checks: a malformed unlock is 503, not 400', async () => {
    paused();
    expect((await call('POST', '/api/vault/unlock', { vault_id: 'nope' })).status).toBe(503);
  });

  test('the account checks still come first: a registered user enrolling gets 403 terms_required', async () => {
    paused();
    put('members', { user_guid: 'g1', email: 'g1@x.org', first_name: 'Ada', last_name: 'One', state: 'registered', account_status: 'active' });
    expect((await call('POST', '/api/vault/enroll', { vault_id: VID })).body.error).toBe('terms_required');
  });

  test('the signature check comes before everything: an unsigned or badly signed app request is 401 even while paused', async () => {
    paused();
    const r = await call('POST', '/api/vault/unlock', UNLOCK, { app: { key: keyOf('g1'), vault: VID, tamper: (x) => x.replace('POST', 'PUT') } });
    expect(r.status).toBe(401);
  });

  test('status: served, with service paused (and available when on), with or without a vault', async () => {
    expect((await call('GET', '/api/vault/status')).body).toMatchObject({ vault: { vault_id: VID }, service: 'available' });
    paused();
    vaultService.resetVaultServiceCache();
    expect((await call('GET', '/api/vault/status')).body).toMatchObject({ vault: { vault_id: VID }, service: 'paused' });
    expect((await call('GET', '/api/vault/status', undefined, { guid: 'g2' })).body).toEqual({ vault: null, service: 'paused' });
  });

  test('lock: still goes to the leaseholder; without a lease the slot is done; never a start', async () => {
    paused();
    put('vaults', { ...getItem('vaults', VID), state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID })).status).toBe(202);
    expect(sent().map((m) => m.msg.op)).toEqual(['lock']);
    put('vaults', { ...getItem('vaults', VID), state: 'locked', lease: undefined });
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID2 })).status).toBe(202);
    expect(getItem('requests', RID2).status).toBe('done');
    expect(getItem('releases', R0).start_requested_at).toBeUndefined();
  });

  test('polling a request queued before the pause still answers', async () => {
    const r = await call('POST', '/api/vault/unlock', UNLOCK);
    expect(r.status).toBe(202);
    paused();
    vaultService.resetVaultServiceCache();
    Object.assign(getItem('requests', RID), { status: 'done', envelope: Buffer.alloc(5_252, 1).toString('base64') });
    expect((await call('GET', `/api/vault/requests/${RID}`)).body.status).toBe('done');
  });

  test('recovery status and cancel: served; the cancel goes to a live instance, or is recorded and mailed without a start', async () => {
    const rid = (await call('POST', '/api/vault/recovery', { browser_key: BK })).body.recovery_id;
    paused();
    vaultService.resetVaultServiceCache();
    expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ recovery_id: rid, state: 'pending' });
    // With a live instance the cancel is queued as usual.
    expect(await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).toEqual({ status: 200, body: { cancelled: true } });
    expect(sent().map((m) => m.msg.op)).toEqual(['recovery', 'recovery_cancel']);

    // No live instance: recorded and mailed, not queued, no start requested.
    put('vaults', { ...getItem('vaults', VID), recovery: undefined });
    switchValue = undefined;
    vaultService.resetVaultServiceCache();
    const rid2 = (await call('POST', '/api/vault/recovery', { browser_key: BK }, { guid: 'g1' })).body.recovery_id;
    tbl('instances').clear();
    paused();
    vaultService.resetVaultServiceCache();
    sqs.resetHistory();
    expect(await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid2 })).toEqual({ status: 200, body: { cancelled: true } });
    expect(getItem('vaults', VID).recovery.state).toBe('cancelled');
    expect(sqs.calls()).toHaveLength(0);
    expect(getItem('releases', R0).start_requested_at).toBeUndefined();
    expect(logs.join('\n')).toContain('recovery cancel not queued');
  });

  test('cache: a change takes effect after at most 30 s; one SSM read per 30 s', async () => {
    const enclave = async () => (await call('GET', '/api/vault/enclave')).status;
    expect(await enclave()).toBe(200);
    paused();
    expect(await enclave()).toBe(200); // cached "on"
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 29_000);
    expect(await enclave()).toBe(200);
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 30_000);
    expect(await enclave()).toBe(503);
    for (const i of tbl('instances').values()) i.heartbeat_at = NOW + 20;
    switchValue = JSON.stringify({ enabled: true });
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 59_000);
    expect(await enclave()).toBe(503); // cached "paused"
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 60_000);
    expect(await enclave()).toBe(200);
    expect(ssm.commandCalls(GetParameterCommand)).toHaveLength(3);
    expect(ssm.commandCalls(GetParameterCommand)[0].args[0].input.Name).toBe('/vettid-org/prod/switch/vault-service');
  });

  test('values: absent or enabled true is on; enabled false, or anything unreadable, is paused', async () => {
    const st = async (v: string | undefined) => {
      switchValue = v;
      vaultService.resetVaultServiceCache();
      return (await call('GET', '/api/vault/status')).body.service;
    };
    expect(await st(undefined)).toBe('available');
    expect(await st('{"enabled":true}')).toBe('available');
    expect(await st('{"enabled":false}')).toBe('paused');
    expect(await st('off')).toBe('paused');
    expect(await st('{"enabled":"false"}')).toBe('paused');
    expect(await st('[]')).toBe('paused');
  });

  test('an unreadable switch: the last value read is kept; with none, on (logged)', async () => {
    ssm.on(GetParameterCommand).rejects(Object.assign(new Error('x'), { name: 'ThrottlingException' }));
    expect((await call('GET', '/api/vault/enclave')).status).toBe(200);
    expect(logs.join('\n')).toContain('vault service switch unreadable');
    // Last read paused, then SSM fails: still paused.
    ssm.reset();
    paused();
    ssm.on(GetParameterCommand).callsFake(() => ({ Parameter: { Value: switchValue } }));
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 31_000);
    expect((await call('GET', '/api/vault/enclave')).status).toBe(503);
    ssm.on(GetParameterCommand).rejects(Object.assign(new Error('x'), { name: 'InternalServerError' }));
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 62_000);
    expect((await call('GET', '/api/vault/enclave')).status).toBe(503);
  });

  test('other 503s carry Retry-After too (release_starting: 30)', async () => {
    tbl('instances').clear();
    const res = await raw('GET', '/api/vault/enclave');
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error).toBe('release_starting');
    expect(res.headers['Retry-After']).toBe('30');
  });
});

// ---- app request signing (MEMBER-API 2.0.0, VAULT-MESSAGING 0.15.0 §11.12.2) ----------

describe('app request signing', () => {
  const UNLOCK = { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
  const app = (extra: Partial<AppSig> = {}): AppSig => ({ key: keyOf('g1'), vault: VID, ...extra });
  const status = (opts: EvOpts) => call('GET', '/api/vault/status', undefined, opts);
  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0 });
    provision('g1', 'app', keyOf('g1'));
  });

  test("status with the vault's app key: that vault, no session needed", async () => {
    const r = await call('GET', '/api/vault/status', undefined, { app: app(), guid: 'nobody' });
    expect(r.status).toBe(200);
    expect(r.body.vault.vault_id).toBe(VID);
  });

  test('a malformed header, or a member missing, repeated or unknown: 401 with no detail', async () => {
    const good = signHeader('GET', '/api/vault/status', '', '', app());
    for (const h of [
      'garbage',
      good.replace('v=1', 'v=2'),
      good.replace(/; nonce=[^;]+/, ''),
      `${good}; extra=1`,
      good.replace('kid=', 'kid=0'),
      good.replace(/ts=\d+/, 'ts=0123'),
      `${good}; sig=AAAA`,
    ]) {
      const r = await call('GET', '/api/vault/status', undefined, { headers: { 'x-vettid-app': h } });
      expect({ h, status: r.status, body: r.body }).toEqual({ h, status: 401, body: { error: 'unauthorized', message: 'Unauthorized' } });
    }
  });

  test('ts must be within 300 s of the clock', async () => {
    expect((await status({ app: app({ ts: NOW - 300 }) })).status).toBe(200);
    expect((await status({ app: app({ ts: NOW + 300 }) })).status).toBe(200);
    expect((await status({ app: app({ ts: NOW - 301 }) })).status).toBe(401);
    expect((await status({ app: app({ ts: NOW + 301 }) })).status).toBe(401);
  });

  test('a nonce is single use (a captured request cannot be replayed)', async () => {
    const nonce = randomBytes(16).toString('base64url');
    expect((await status({ app: app({ nonce }) })).status).toBe(200);
    expect((await status({ app: app({ nonce }) })).status).toBe(401);
    // After 600 s the record has expired (and ts would be stale anyway).
    expect(getItem('rl', `appnonce#${keyOf('g1').kid}#${nonce}`).expires_at).toBe(NOW + 600);
  });

  test('the signature covers the method, path, query, vault, kid, ts, nonce and body', async () => {
    for (const tamper of [
      (x: string) => x.replace('\nGET\n', '\nPOST\n'),
      (x: string) => x.replace('/api/vault/status', '/api/vault/statuS'),
      (x: string) => x.replace(`\n${VID}\n`, `\n${'e'.repeat(32)}\n`),
    ]) expect((await status({ app: app({ tamper }) })).status).toBe(401);
    // The body: an unlock whose envelope differs from the signed one.
    const res = await vault.handler({ ...build('POST', '/api/vault/unlock', UNLOCK, { app: app() }), body: JSON.stringify({ ...UNLOCK, request_id: RID2 }) });
    expect(res.statusCode).toBe(401);
    // The query.
    const q = build('GET', '/api/vault/enclave', undefined, { app: app(), query: { release: R0 } });
    expect((await vault.handler({ ...q, rawQueryString: `release=${R1}`, queryStringParameters: { release: R1 } })).statusCode).toBe(401);
    expect(sqs.calls()).toHaveLength(0);
  });

  test("another key, or the key of another member's vault: 401", async () => {
    vaultOf('g2', { vault_id: 'e'.repeat(32), state: 'locked' });
    provision('g2', 'app', keyOf('g2'));
    expect((await status({ app: app({ key: keyOf('stranger') }) })).status).toBe(401);
    expect((await status({ app: app({ key: keyOf('g2') }) })).status).toBe(401);
    expect((await status({ app: { key: keyOf('g2'), vault: 'e'.repeat(32) } })).body.vault.vault_id).toBe('e'.repeat(32));
  });

  test('cookies are ignored and CSRF is not required on an app request', async () => {
    // A valid session cookie does not rescue a bad signature.
    expect((await status({ app: app({ key: keyOf('stranger') }), guid: 'g1' })).status).toBe(401);
    // A signed POST without the CSRF header is served.
    put('vaults', { ...getItem('vaults', VID), state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    const r = await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID }, { app: app(), headers: { 'x-vettid-csrf': '' } });
    expect(r.status).toBe(202);
    expect(getItem('requests', RID).app_kid).toBe(keyOf('g1').kid);
    const a = [...tbl('audit').values()].find((x) => x.action === 'vault.lock_request');
    expect(a.detail).toMatchObject({ via: 'app', kid: keyOf('g1').kid });
    // Portal-only routes see no session from an app.
    expect((await call('POST', '/api/vault/enroll-code', undefined, { app: app() })).status).toBe(401);
    expect((await call('GET', '/api/vault/recovery', undefined, { app: app() })).status).toBe(401);
  });

  test('an app polls only the requests its own key made', async () => {
    expect((await call('POST', '/api/vault/unlock', UNLOCK, { app: app() })).status).toBe(202);
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 1000);
    expect((await call('GET', `/api/vault/requests/${RID}`, undefined, { app: app() })).body).toEqual({ status: 'queued' });
    // The portal (the member's session) may poll it too.
    expect((await call('GET', `/api/vault/requests/${RID}`)).status).toBe(200);
    // A slot made by the portal or by another key is not this app's.
    put('requests', { request_id: RID2, vault_id: VID, user_guid: 'g1', op: 'lock', status: 'done', created_at: new Date(NOW_MS).toISOString(), expires_at: NOW + 800 });
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 2000);
    expect((await call('GET', `/api/vault/requests/${RID2}`, undefined, { app: app() })).status).toBe(404);
  });

  test('the pending key may call enclave, enroll and poll; not unlock, lock or status', async () => {
    const row = getItem('vaults', VID);
    delete row.app_key;
    row.app_key_pending = { key: keyOf('g1').b64, kid: keyOf('g1').kid, until: NOW + 3600 };
    expect((await call('GET', '/api/vault/enclave', undefined, { app: app() })).status).toBe(200);
    expect((await status({ app: app() })).status).toBe(401);
    expect((await call('POST', '/api/vault/unlock', UNLOCK, { app: app() })).status).toBe(401);
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID }, { app: app() })).status).toBe(401);
  });

  test('once the host reports the pending key as the app key, the pending record is cleared', async () => {
    const row = getItem('vaults', VID);
    row.app_key_pending = { key: keyOf('g1').b64, kid: keyOf('g1').kid, until: NOW + 3600 };
    expect((await status({ app: app() })).status).toBe(200);
    expect(getItem('vaults', VID).app_key_pending).toBeUndefined();
    expect(getItem('vaults', VID).app_key.kid).toBe(keyOf('g1').kid); // the host's, untouched
  });

  test('a vault that is not the member\'s current one: 401', async () => {
    put('vaults', { vault_id: 'user#g1', current_vault_id: 'e'.repeat(32) });
    expect((await status({ app: app() })).status).toBe(401);
  });
});

// ---- setup codes (MEMBER-API 2.0.0 "Setup codes", VAULT-MESSAGING §11.12.1) -----------

describe('setup codes', () => {
  const K_CODE = Buffer.alloc(32, 0x4b);
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const newKey = () => keyOf(`app-${randomBytes(4).toString('hex')}`);
  const issue = async (guid = 'g1') => {
    const r = await call('POST', '/api/vault/enroll-code', undefined, { guid });
    expect(r.status).toBe(201);
    return r.body as { secret: string; code: string; expires_at: string; api: string };
  };
  /** A redeem, signed by the key it registers, with an empty vault. */
  const redeem = (body: Record<string, unknown>, key = newKey(), opts: EvOpts = {}) =>
    call('POST', '/api/vault/enroll/redeem', { ...body, app_key: key.b64 }, { app: { key, vault: '' }, guid: 'nobody', ...opts });
  const mails = () => sesMock.commandCalls(SendEmailCommand).map((c) => ({ to: c.args[0].input.Destination!.ToAddresses![0], subject: c.args[0].input.Content!.Simple!.Subject!.Data!, text: c.args[0].input.Content!.Simple!.Body!.Text!.Data! }));
  const issuances = () => [...tbl('requests').values()].filter((x) => x.op === 'enroll_code');
  let holds: number[];

  beforeEach(() => {
    enrollCode.resetEnrollCodeKeyCache();
    ssm.on(GetParameterCommand, { Name: '/vettid-org/prod/member/enroll-code-key' }).resolves({ Parameter: { Value: K_CODE.toString('base64') } });
    holds = [];
    jest.spyOn(vault.timing, 'hold').mockImplementation(async (...a: unknown[]) => void holds.push(a[0] as number));
    release(R0, 4);
    instance('i-1', R0);
  });

  test('issue: a 22-character QR secret, an 8-symbol code, 5 minutes, the API origin; only MACs are stored', async () => {
    const c = await issue();
    expect(c.secret).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(c.secret, 'base64url')).toHaveLength(16);
    expect(c.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(c.expires_at).toBe(new Date((NOW + 300) * 1000).toISOString());
    expect(c.api).toBe('https://account.vettid.org');
    const [row] = issuances();
    expect(row.request_id).toBe(`enroll#${enrollCode.qrMac(K_CODE, c.secret)}`);
    expect(row).toMatchObject({ user_guid: 'g1', state: 'live', issued_at: NOW, expires_at: NOW + 300, typed_attempts: 0, typed_blocked: false });
    expect(row.code_mac).toBe(enrollCode.codeMac(K_CODE, 'g1', c.code).toString('hex'));
    expect(getItem('vaults', 'user#g1')).toMatchObject({ enroll_live: row.request_id });
    expect(getItem('vaults', 'user#g1')).not.toHaveProperty('user_guid');
    // Neither secret is stored, audited or logged.
    const everything = JSON.stringify([...Object.values(db)].map((m) => [...m.values()])) + logs.join('\n');
    expect(everything).not.toContain(c.secret);
    expect(everything).not.toContain(c.code);
    expect([...tbl('audit').values()].map((a) => a.action)).toEqual(['vault.enroll_code_issued']);
    expect(ssm.commandCalls(GetParameterCommand).find((x) => x.args[0].input.Name === '/vettid-org/prod/member/enroll-code-key')!.args[0].input.WithDecryption).toBe(true);
  });

  test('issue needs a member with the current terms; a new issuance revokes the old one', async () => {
    put('members', { user_guid: 'g1', email: 'g1@x.org', first_name: 'Ada', last_name: 'One', state: 'registered', account_status: 'active' });
    expect((await call('POST', '/api/vault/enroll-code')).body.error).toBe('terms_required');
    put('members', { user_guid: 'g1', email: 'g1@x.org', state: 'member', account_status: 'active', terms_version: 't0' });
    expect((await call('POST', '/api/vault/enroll-code')).body.error).toBe('terms_required');
    put('members', { user_guid: 'g1', email: 'g1@x.org', state: 'member', account_status: 'active', terms_version: 't1' });
    const first = await issue();
    const second = await issue();
    expect(issuances().map((x) => x.state).sort()).toEqual(['live', 'revoked']);
    expect((await redeem({ secret: first.secret })).body.error).toBe('invalid_code');
    expect((await redeem({ secret: second.secret })).status).toBe(200);
  });

  test('issue: 5 per member per hour', async () => {
    for (let i = 0; i < 5; i++) await issue();
    expect((await call('POST', '/api/vault/enroll-code')).status).toBe(429);
  });

  test('GET: the latest issuance, never its secrets; DELETE revokes it', async () => {
    expect((await call('GET', '/api/vault/enroll-code')).body).toEqual({ enroll_code: null });
    const c = await issue();
    const live = (await call('GET', '/api/vault/enroll-code')).body;
    expect(live).toEqual({ enroll_code: { state: 'live', typed_blocked: false, issued_at: new Date(NOW_MS).toISOString(), expires_at: c.expires_at } });
    expect(JSON.stringify(live)).not.toContain(c.secret);
    expect(await call('DELETE', '/api/vault/enroll-code')).toEqual({ status: 200, body: { revoked: true } });
    expect(await call('DELETE', '/api/vault/enroll-code')).toEqual({ status: 200, body: { revoked: false } });
    expect((await call('GET', '/api/vault/enroll-code')).body.enroll_code.state).toBe('revoked');
    expect((await redeem({ secret: c.secret })).body.error).toBe('invalid_code');
    expect([...tbl('audit').values()].map((a) => a.action)).toContain('vault.enroll_code_revoked');
    await issue();
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 300_000);
    expect((await call('GET', '/api/vault/enroll-code')).body.enroll_code.state).toBe('expired');
  });

  test('redeem by QR secret: the vault, the pending key, the email, the audit and the answer', async () => {
    const c = await issue();
    const key = newKey();
    const r = await redeem({ secret: c.secret }, key);
    expect(r.status).toBe(200);
    const vid = r.body.vault_id;
    expect(r.body).toEqual({ vault_id: vid, user_guid: 'g1', email_hint: 'g***@x.org' });
    expect(vid).toMatch(/^[0-9a-f]{32}$/);
    expect(getItem('vaults', vid)).toMatchObject({ vault_id: vid, user_guid: 'g1', state: 'enrolling', app_key_pending: { key: key.b64, kid: key.kid, until: NOW + 3600 } });
    expect(getItem('vaults', vid)).not.toHaveProperty('app_key'); // only the host writes it
    expect(getItem('vaults', 'user#g1')).toMatchObject({ current_vault_id: vid, enroll_live: issuances()[0].request_id });
    expect(issuances()[0]).toMatchObject({ state: 'used', used_at: NOW, used_via: 'qr' });
    expect(mails()).toEqual([expect.objectContaining({ to: 'g1@x.org', subject: 'VettID: your setup code was used', text: expect.stringContaining(`A phone used your setup code at ${new Date(NOW_MS).toISOString()} to set up your VettID vault.`) })]);
    const a = [...tbl('audit').values()].find((x) => x.action === 'vault.enroll_code_redeemed');
    expect(a.detail).toEqual({ vault_id: vid, kid: key.kid, via: 'qr' });
    // Single use, both forms.
    expect((await redeem({ secret: c.secret })).body).toMatchObject({ error: 'invalid_code', code: 'invalid_code' });
    expect((await redeem({ email: 'g1@x.org', code: c.code })).status).toBe(404);
    expect((await call('GET', '/api/vault/enroll-code')).body.enroll_code).toMatchObject({ state: 'used', used_at: new Date(NOW_MS).toISOString() });
    // The pending key now enrolls into that vault.
    const enroll = await call('POST', '/api/vault/enroll', { vault_id: vid, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA }, { app: { key, vault: vid } });
    expect(enroll.status).toBe(202);
    expect(sent()[0].msg.app_key).toBe(key.b64);
  });

  test('redeem typed: email and code normalised; compared with that member only; held to 250 ms', async () => {
    const c = await issue();
    const typed = `${c.code.slice(0, 4).toLowerCase()} - ${c.code.slice(4).toLowerCase()}`;
    const r = await redeem({ email: '  G1@X.org ', code: typed });
    expect(r.status).toBe(200);
    expect(r.body.user_guid).toBe('g1');
    expect(issuances()[0]).toMatchObject({ state: 'used', used_via: 'typed', typed_attempts: 1 });
    expect(holds).toEqual([250]);
  });

  test("no account oracle: every typed failure is the same 404 invalid_code, after the same work and hold", async () => {
    const c = await issue();
    const other = await issue('g2');
    const cases: [string, Record<string, unknown>][] = [
      ['wrong code', { email: 'g1@x.org', code: c.code === '22222222' ? '33333333' : '22222222' }],
      ["another member's code", { email: 'g1@x.org', code: other.code }],
      ['unknown email', { email: 'nobody@x.org', code: c.code }],
      ['malformed code', { email: 'g1@x.org', code: 'I0O1L' }],
      ['empty email', { email: '', code: c.code }],
    ];
    const answers = [];
    for (const [, body] of cases) {
      const r = await redeem(body, newKey(), { headers: { 'cloudfront-viewer-address': `203.0.113.${answers.length + 1}:443` } });
      answers.push(r);
    }
    for (const r of answers) expect(r).toEqual({ status: 404, body: { error: 'invalid_code', code: 'invalid_code', message: 'This setup code is not valid. Get a new code on the account site.' } });
    expect(holds).toEqual([250, 250, 250, 250, 250]);
    // The members were looked up for every email (the same work).
    expect(ddb.commandCalls(QueryCommand).filter((q) => q.args[0].input.IndexName === 'email-index').length).toBe(4);
    // Counted on the issuance, or on the per-email counter for an email without one.
    expect(issuances().find((x) => x.user_guid === 'g1').typed_attempts).toBe(3);
    expect(issuances().find((x) => x.user_guid === 'g2').typed_attempts).toBe(0);
    // Nothing of what was typed is logged or audited.
    expect(logs.join('\n')).not.toContain('nobody@x.org');
    expect(JSON.stringify([...tbl('audit').values()])).not.toContain('nobody@x.org');
    const failed = [...tbl('audit').values()].filter((a) => a.action === 'vault.enroll_code_failed');
    expect(failed.length).toBeGreaterThan(0);
    // The code still works for the right member.
    expect((await redeem({ email: 'g1@x.org', code: c.code })).status).toBe(200);
  });

  test('expired, revoked and blocked issuances: 404 invalid_code', async () => {
    const c = await issue();
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 300_000);
    expect((await redeem({ secret: c.secret })).status).toBe(404);
    expect((await redeem({ email: 'g1@x.org', code: c.code })).status).toBe(404);
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const d = await issue();
    await call('DELETE', '/api/vault/enroll-code');
    expect((await redeem({ email: 'g1@x.org', code: d.code })).status).toBe(404);
    // A canceled or suspended account: the code is not redeemable.
    const e = await issue();
    put('members', { ...getItem('members', 'g1'), account_status: 'suspended' });
    expect((await redeem({ secret: e.secret })).status).toBe(404);
  });

  test('typed: 5 per (email, network) per 5 minutes, for unknown emails too', async () => {
    for (const email of ['g1@x.org', 'nobody@x.org']) {
      for (let i = 0; i < 5; i++) expect((await redeem({ email, code: '22222222' }, newKey(), { headers: { 'cloudfront-viewer-address': '198.51.100.9:443' } })).status).toBe(404);
      const r = await redeem({ email, code: '22222222' }, newKey(), { headers: { 'cloudfront-viewer-address': '198.51.100.9:443' } });
      expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
      // Another network may still try.
      expect((await redeem({ email, code: '22222222' }, newKey(), { headers: { 'cloudfront-viewer-address': '198.51.100.10:443' } })).status).toBe(404);
    }
  });

  test('both forms, per source network: 30 per 5 minutes per IPv4 address, 10 per IPv6 /64', async () => {
    const v4 = { headers: { 'cloudfront-viewer-address': '198.51.100.7:443' } };
    put('rl', { key: `enroll-redeem-net#198.51.100.7#${NOW - (NOW % 300)}`, count: 29 });
    expect((await redeem({ secret: 'A'.repeat(22) }, newKey(), v4)).status).toBe(404);
    expect((await redeem({ secret: 'A'.repeat(22) }, newKey(), v4)).status).toBe(429);
    put('rl', { key: `enroll-redeem-net#2001:0db8:0001:0002::/64#${NOW - (NOW % 300)}`, count: 9 });
    expect((await redeem({ secret: 'A'.repeat(22) })).status).toBe(404);
    expect((await redeem({ secret: 'A'.repeat(22) })).status).toBe(429);
  });

  test('the 800th typed attempt blocks typed entry for that issuance only: alarm, email, audit; the QR still works', async () => {
    const c = await issue();
    issuances()[0].typed_attempts = 799;
    const wrong = c.code === '22222222' ? '33333333' : '22222222';
    expect((await redeem({ email: 'g1@x.org', code: wrong })).status).toBe(404);
    expect(issuances()[0]).toMatchObject({ typed_attempts: 800, typed_blocked: true, state: 'live' });
    const emf = logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((x) => x?.EnrollTypedCeiling === 1);
    expect(emf._aws.CloudWatchMetrics[0]).toMatchObject({ Namespace: 'VettID/MemberApi', Metrics: [{ Name: 'EnrollTypedCeiling', Unit: 'Count' }] });
    expect(mails().map((m) => m.text)).toEqual([expect.stringContaining('Someone tried many wrong codes for your account. Scan the QR code instead, or get a new code.')]);
    expect([...tbl('audit').values()].find((a) => a.action === 'vault.enroll_code_typed_blocked').detail).toEqual({ issued_at: new Date(NOW_MS).toISOString() });
    expect((await call('GET', '/api/vault/enroll-code')).body.enroll_code.typed_blocked).toBe(true);
    // Even the right code, typed, now fails like any other; nothing more is counted or mailed.
    expect((await redeem({ email: 'g1@x.org', code: c.code }, newKey(), { headers: { 'cloudfront-viewer-address': '203.0.113.1:443' } })).status).toBe(404);
    expect(issuances()[0].typed_attempts).toBe(800);
    expect(mails()).toHaveLength(1);
    // Another member is unaffected, and so is this member's QR.
    const other = await issue('g2');
    expect((await redeem({ email: 'g2@x.org', code: other.code }, newKey(), { headers: { 'cloudfront-viewer-address': '203.0.113.2:443' } })).status).toBe(200);
    expect((await redeem({ secret: c.secret }, newKey(), { headers: { 'cloudfront-viewer-address': '203.0.113.3:443' } })).status).toBe(200);
  });

  test('exactly one form, else 400; the request must be signed by app_key with an empty vault', async () => {
    const c = await issue();
    for (const body of [{}, { secret: c.secret, email: 'g1@x.org', code: c.code }, { secret: c.secret, code: c.code }, { email: 'g1@x.org' }, { email: 'g1@x.org', code: 7 }]) {
      expect({ body, status: (await redeem(body)).status }).toEqual({ body, status: 400 });
    }
    const key = newKey();
    // Signed by another key than app_key, with a vault, without a header, or with a malformed app_key: 401.
    expect((await call('POST', '/api/vault/enroll/redeem', { secret: c.secret, app_key: key.b64 }, { app: { key: newKey(), vault: '' } })).status).toBe(401);
    expect((await call('POST', '/api/vault/enroll/redeem', { secret: c.secret, app_key: key.b64 }, { app: { key, vault: VID } })).status).toBe(401);
    expect((await call('POST', '/api/vault/enroll/redeem', { secret: c.secret, app_key: key.b64 })).status).toBe(401);
    expect((await call('POST', '/api/vault/enroll/redeem', { secret: c.secret, app_key: 'AAAA' }, { app: { key, vault: '' } })).status).toBe(401);
    expect(issuances()[0].state).toBe('live');
  });

  test('an existing vault: the pending key goes on it (the enclave decides); a deleted one gets a fresh vault_id', async () => {
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0, app_key: { key: keyOf('g1').b64, kid: keyOf('g1').kid, seq: 1 } });
    const key = newKey();
    const r = await redeem({ secret: (await issue()).secret }, key);
    expect(r.body.vault_id).toBe(VID);
    expect(getItem('vaults', VID).app_key_pending.kid).toBe(key.kid);
    expect(getItem('vaults', VID).app_key.kid).toBe(keyOf('g1').kid); // never replaced by the API
    put('vaults', { ...getItem('vaults', VID), state: 'deleted' });
    const fresh = await redeem({ secret: (await issue()).secret });
    expect(fresh.body.vault_id).not.toBe(VID);
    expect(getItem('vaults', 'user#g1').current_vault_id).toBe(fresh.body.vault_id);
    // After the deletion notice removed the rows (§12.5) too.
    tbl('vaults').delete(fresh.body.vault_id);
    tbl('vaults').delete('user#g1');
    const again = await redeem({ secret: (await issue()).secret });
    expect(again.status).toBe(200);
    expect(again.body.vault_id).not.toBe(fresh.body.vault_id);
  });

  test('paused: issue and redeem refused before anything is spent, counted or written; read and revoke served', async () => {
    const c = await issue();
    paused();
    vaultService.resetVaultServiceCache();
    const before = JSON.stringify(issuances());
    for (const body of [{ secret: c.secret }, { email: 'g1@x.org', code: c.code }]) {
      const res = await vault.handler(build('POST', '/api/vault/enroll/redeem', { ...body, app_key: keyOf('p').b64 }, { app: { key: keyOf('p'), vault: '' } }));
      expect(res.statusCode).toBe(503);
      expect(res.headers['Retry-After']).toBe('300');
      expect(JSON.parse(res.body)).toMatchObject({ error: 'vault_unavailable', service: 'paused' });
    }
    expect(JSON.stringify(issuances())).toBe(before);
    expect(mails()).toHaveLength(0);
    expect([...tbl('rl').keys()].filter((k) => /^enroll-(redeem|typed|fail)/.test(k))).toEqual([]);
    expect((await call('POST', '/api/vault/enroll-code')).body).toMatchObject({ error: 'vault_unavailable', service: 'paused' });
    expect(issuances()).toHaveLength(1);
    expect((await call('GET', '/api/vault/enroll-code')).body.enroll_code.state).toBe('live');
    expect((await call('DELETE', '/api/vault/enroll-code')).body).toEqual({ revoked: true });
  });

  test('a missing k_code fails closed (500), and nothing is issued', async () => {
    enrollCode.resetEnrollCodeKeyCache();
    ssm.on(GetParameterCommand, { Name: '/vettid-org/prod/member/enroll-code-key' }).rejects(Object.assign(new Error('nf'), { name: 'ParameterNotFound' }));
    expect((await call('POST', '/api/vault/enroll-code')).status).toBe(500);
    expect(issuances()).toHaveLength(0);
  });

  test('the typed code is uniform over the 31-symbol alphabet (rejection sampling)', () => {
    // Bytes 248-255 are skipped; 0..247 map onto the alphabet 8 times each.
    const bytes = Buffer.from([255, 248, 0, 30, 31, 247, 249, 61, 62, 100, 200]);
    expect(enrollCode.newTypedCode(() => bytes)).toBe([0, 30, 31, 247, 61, 62, 100, 200].map((b) => ALPHABET[b % 31]).join(''));
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) for (const ch of enrollCode.newTypedCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect([...counts.keys()].sort().join('')).toBe(ALPHABET);
    for (const n of counts.values()) expect(n).toBeGreaterThan(32_000 / 31 * 0.8);
  });
});

// ---- recovery claim (MEMBER-API 2.0.0, VAULT-MESSAGING 0.15.0 §11.11.7) ----------------

describe('recovery claim and the recovering key', () => {
  const BK = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
  const newApp = keyOf('new-phone');
  const claim = (body: Record<string, unknown>, key = newApp, vault = VID) =>
    call('POST', '/api/vault/recovery/claim', { ...body, app_key: key.b64 }, { app: { key, vault }, guid: 'nobody' });
  const at = (s: number) => {
    jest.spyOn(Date, 'now').mockReturnValue(s * 1000);
    for (const i of tbl('instances').values()) i.heartbeat_at = s - 10;
  };
  const REG = { vault_id: VID, request_id: RID2, instance_id: 'i-1', etk_kid: KID, envelope: ENV };
  const UNLOCK = { vault_id: VID, request_id: '01JB2Z6V9K3M4N5P6Q7R8S9T0X', instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
  let rid: string;

  beforeEach(async () => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0, app_key: { key: keyOf('old-phone').b64, kid: keyOf('old-phone').kid, seq: 1 } });
    rid = (await call('POST', '/api/vault/recovery', { browser_key: BK })).body.recovery_id;
    Object.assign(getItem('requests', rid), { status: 'done', envelope: Buffer.alloc(5_252, 3).toString('base64') });
  });

  test('only while available: pending → 409 recovery_not_available; an unknown pair → 404', async () => {
    expect((await claim({ vault_id: VID, recovery_id: rid })).body).toMatchObject({ error: 'recovery_not_available' });
    at(NOW + 86_400 + 5);
    expect((await claim({ vault_id: VID, recovery_id: RID })).status).toBe(404);
    expect((await claim({ vault_id: 'e'.repeat(32), recovery_id: rid }, newApp, 'e'.repeat(32))).status).toBe(404);
    // The body must name the vault the request is signed for.
    expect((await claim({ vault_id: 'e'.repeat(32), recovery_id: rid })).status).toBe(400);
  });

  test('claim → register → recovery_registered → the recovering key unlocks; the host reports it → keys cleared', async () => {
    at(NOW + 86_400 + 5);
    const r = await claim({ vault_id: VID, recovery_id: rid });
    expect(r).toEqual({ status: 200, body: { user_guid: 'g1', email_hint: 'g***@x.org' } });
    expect(getItem('vaults', VID).recovery.claim_keys).toEqual([{ key: newApp.b64, kid: newApp.kid }]);
    expect([...tbl('audit').values()].find((a) => a.action === 'vault.recovery_claim').detail).toEqual({ vault_id: VID, recovery_id: rid, kid: newApp.kid });
    // A claim key: enclave and register, not unlock or status.
    const signed = { app: { key: newApp, vault: VID } };
    expect((await call('GET', '/api/vault/enclave', undefined, signed)).status).toBe(200);
    expect((await call('GET', '/api/vault/status', undefined, signed)).status).toBe(401);
    expect((await call('POST', '/api/vault/unlock', UNLOCK, signed)).status).toBe(401);
    expect((await call('POST', '/api/vault/recovery/register', REG, signed)).status).toBe(202);
    const m = sent().pop()!;
    expect(m.msg).toMatchObject({ op: 'recovery_register', app_key: newApp.b64 });
    expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'etk_kid', 'envelope', 'app_key', 'enqueued_at']);
    expect(getItem('requests', RID2)).toMatchObject({ recovery_id: rid, app_kid: newApp.kid });
    // The old phone's key is not a claim key.
    expect((await call('POST', '/api/vault/recovery/register', { ...REG, request_id: RID }, { app: { key: keyOf('old-phone'), vault: VID } })).status).toBe(401);
    // The enclave accepts it.
    Object.assign(getItem('requests', RID2), { status: 'done', envelope: Buffer.alloc(5_252, 4).toString('base64'), code: 'recovery_registered' });
    at(NOW + 86_400 + 7);
    expect((await call('GET', `/api/vault/requests/${RID2}`, undefined, signed)).body.code).toBe('recovery_registered');
    expect(getItem('vaults', VID).recovery).toMatchObject({ state: 'registered', recovering_key: { key: newApp.b64, kid: newApp.kid } });
    // The recovering key may unlock, read status and lock while the recovery is active.
    expect((await call('GET', '/api/vault/status', undefined, signed)).body.vault.recovery.state).toBe('registered');
    expect((await call('POST', '/api/vault/unlock', UNLOCK, signed)).status).toBe(202);
    // The old phone still unlocks too until the enclave reports the new app key.
    expect((await call('GET', '/api/vault/status', undefined, { app: { key: keyOf('old-phone'), vault: VID } })).status).toBe(200);
    // The host writes the new key: the old key is refused, the recovery's keys are cleared.
    getItem('vaults', VID).app_key = { key: newApp.b64, kid: newApp.kid, seq: 2 };
    expect((await call('GET', '/api/vault/status', undefined, { app: { key: keyOf('old-phone'), vault: VID } })).status).toBe(401);
    expect((await call('GET', '/api/vault/status', undefined, signed)).status).toBe(200);
    expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
    expect(getItem('vaults', VID).recovery.recovering_key).toBeUndefined();
  });

  test('at most 10 claim keys; the oldest goes; 10 claims per vault per day', async () => {
    at(NOW + 86_400 + 5);
    const keys = Array.from({ length: 10 }, (_, i) => keyOf(`claimer-${i}`));
    for (const [i, k] of keys.entries()) {
      expect((await claim({ vault_id: VID, recovery_id: rid }, k)).status).toBe(200);
      if (i === 0) expect(getItem('vaults', VID).recovery.claim_keys).toHaveLength(1);
    }
    expect(getItem('vaults', VID).recovery.claim_keys.map((k: any) => k.kid)).toEqual(keys.map((k) => k.kid));
    expect((await claim({ vault_id: VID, recovery_id: rid }, keyOf('claimer-10'))).status).toBe(429);
    getItem('vaults', VID).recovery.claim_keys = keys.slice(0, 10).map((k) => ({ key: k.b64, kid: k.kid }));
    jest.spyOn(Date, 'now').mockReturnValue((NOW + 2 * 86_400 - 60) * 1000); // next day's window, recovery still available
    for (const i of tbl('instances').values()) i.heartbeat_at = NOW + 2 * 86_400 - 70;
    expect((await claim({ vault_id: VID, recovery_id: rid }, keyOf('claimer-10'))).status).toBe(200);
    expect(getItem('vaults', VID).recovery.claim_keys.map((k: any) => k.kid)).toEqual([...keys.slice(1), keyOf('claimer-10')].map((k) => k.kid));
  });

  test('paused: claim refused before the body is read; no claim key written', async () => {
    at(NOW + 86_400 + 5);
    paused();
    vaultService.resetVaultServiceCache();
    const r = await call('POST', '/api/vault/recovery/claim', { app_key: newApp.b64 }, { app: { key: newApp, vault: VID }, guid: 'nobody' });
    expect(r.body).toMatchObject({ error: 'vault_unavailable', service: 'paused' });
    expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
  });
});

// ---- the staging-only switch-over (ENROLLMENT-CODES §8 step 3) ---------------------------

describe('legacy sessions on the app routes (staging switch-over)', () => {
  beforeEach(() => {
    process.env.VAULT_LEGACY_SESSION_AUTH = '1';
    release(R0, 4);
    instance('i-1', R0);
  });
  afterEach(() => {
    delete process.env.VAULT_LEGACY_SESSION_AUTH;
  });

  test('a session enrolls and unlocks as before 2.0.0 (terms required; no app_key in the message)', async () => {
    expect((await call('GET', '/api/vault/enclave', undefined, { session: true })).status).toBe(200);
    const r = await call('POST', '/api/vault/enroll', { request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA }, { session: true });
    expect(r.status).toBe(202);
    expect(sent()[0].msg.app_key).toBeUndefined();
    expect(sent()[0].msg.account).toMatchObject({ first_name: 'Ada', last_name: 'One', name_change: { allowed_after: null, last: null } }); // 2.2.0
    expect(getItem('vaults', 'user#g1').current_vault_id).toBe(r.body.vault_id);
    put('members', { user_guid: 'g1', email: 'g1@x.org', first_name: 'Ada', last_name: 'One', state: 'registered', account_status: 'active' });
    expect((await call('GET', '/api/vault/enclave', undefined, { session: true })).body.error).toBe('terms_required');
  });

  test('signed requests work alongside', async () => {
    expect((await call('GET', '/api/vault/enclave')).status).toBe(200);
  });
});

// ---- the account snapshot to a running vault (lambda/jobs/vault-account-push.ts) -------

describe('account push', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const push = require('../../lambda/jobs/vault-account-push');
  /* eslint-enable */
  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
  });

  test('to the live leaseholder only: a slot and the op account with the snapshot', async () => {
    vaultOf('g1', { vault_id: VID, state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    put('members', { ...getItem('members', 'g1'), account_status: 'canceled', delete_after: '2026-10-09T12:00:00.000Z' });
    expect(await push.handler({ user_guid: 'g1' })).toEqual({ sent: true });
    const [m] = sent();
    expect(m.url).toBe(QUEUE_PREFIX + 'i-1');
    expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'account', 'enqueued_at']);
    expect(m.msg).toMatchObject({ v: 1, op: 'account', vault_id: VID, user_guid: 'g1', account: { account_status: 'canceled', deletes_at: '2026-10-09T12:00:00.000Z', email: 'g1@x.org' } });
    expect(m.msg.account).not.toHaveProperty('email_hint'); // 2.3.0
    expect(getItem('requests', m.msg.request_id)).toMatchObject({ op: 'account', status: 'queued', vault_id: VID, instance_id: 'i-1' });
    expect(tbl('audit').size).toBe(0);
  });

  test('no live lease, no vault, a deleted vault or a suspended account: nothing is sent or started', async () => {
    expect(await push.handler({ user_guid: 'g1' })).toEqual({ sent: false });
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0 });
    expect(await push.handler({ user_guid: 'g1' })).toEqual({ sent: false });
    put('vaults', { ...getItem('vaults', VID), state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW - 1 } });
    expect(await push.handler({ user_guid: 'g1' })).toEqual({ sent: false });
    put('vaults', { ...getItem('vaults', VID), lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    put('members', { ...getItem('members', 'g1'), account_status: 'suspended' });
    expect(await push.handler({ user_guid: 'g1' })).toEqual({ sent: false });
    expect(await push.handler({ user_guid: '../x' })).toEqual({ sent: false });
    expect(sqs.calls()).toHaveLength(0);
    expect(getItem('releases', R0).start_requests).toBeUndefined();
  });

  test("2.2.0: the snapshot carries the names and the vault row's name_change_result", async () => {
    vaultOf('g1', { vault_id: VID, state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 }, name_change_result: { seq: 7, status: 'applied' } });
    put('members', { ...getItem('members', 'g1'), first_name: 'Grace', last_name: 'Hopper', name_changed_at: new Date(NOW_MS).toISOString() });
    expect(await push.handler({ user_guid: 'g1' })).toEqual({ sent: true });
    expect(sent()[0].msg.account).toMatchObject({
      first_name: 'Grace', last_name: 'Hopper',
      name_change: { allowed_after: new Date(NOW_MS + 30 * 86_400_000).toISOString(), last: { seq: 7, status: 'applied' } },
    });
  });

  test('sent while the vault service is paused (it reaches only a running vault)', async () => {
    paused();
    vaultOf('g1', { vault_id: VID, state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    expect(await push.handler({ user_guid: 'g1' })).toEqual({ sent: true });
  });
});

// ---- MEMBER-API 2.1.0 (VAULT-MESSAGING 0.16.0): no recovery with the backup off; start over ----

describe('2.1.0: the credential backup bit and the refused recovery', () => {
  const BK = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
  const REFUSAL = Buffer.alloc(5_252, 0x55).toString('base64');
  const at = (s: number) => {
    jest.spyOn(Date, 'now').mockReturnValue(s * 1000);
    for (const i of tbl('instances').values()) i.heartbeat_at = s - 10;
  };
  const audits = (action: string) => [...tbl('audit').values()].filter((a) => a.action === action);

  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0, app_key: { key: keyOf('g1').b64, kid: keyOf('g1').kid, seq: 1 } });
  });

  test('status carries credential_backup (null until reported) and deletion (null)', async () => {
    let v = (await call('GET', '/api/vault/status')).body.vault;
    expect(v).toMatchObject({ credential_backup: null, deletion: null });
    getItem('vaults', VID).credential_backup = false;
    v = (await call('GET', '/api/vault/status', undefined, { app: { key: keyOf('g1'), vault: VID } })).body.vault;
    expect(v.credential_backup).toBe(false);
  });

  test('backup off: 409 recovery_unavailable {reason: no_backup}; nothing written, queued or mailed; the request still counts', async () => {
    getItem('vaults', VID).credential_backup = false;
    const before = structuredClone(getItem('vaults', VID));
    for (let n = 0; n < 3; n++) {
      const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
      expect(r).toMatchObject({ status: 409, body: { error: 'recovery_unavailable', code: 'recovery_unavailable', reason: 'no_backup' } });
    }
    expect(getItem('vaults', VID)).toEqual(before);
    expect(sent()).toHaveLength(0);
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    expect([...tbl('requests').values()]).toHaveLength(0);
    expect(tbl('audit').size).toBe(0);
    expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(429);
  });

  test('backup on, or not reported: the request goes on (the enclave decides)', async () => {
    getItem('vaults', VID).credential_backup = true;
    expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(202);
  });

  test("the enclave's refusal (slot code recovery_unavailable) ends the recovery at once; its sealed refusal is returned; claim refused", async () => {
    const rid = (await call('POST', '/api/vault/recovery', { browser_key: BK })).body.recovery_id;
    Object.assign(getItem('requests', rid), { status: 'done', envelope: REFUSAL, code: 'recovery_unavailable' });
    at(NOW + 60);
    const r = await call('GET', '/api/vault/recovery');
    expect(r.body.recovery).toMatchObject({ recovery_id: rid, state: 'unavailable', sealed_code: REFUSAL });
    expect(getItem('vaults', VID).recovery.state).toBe('unavailable');
    expect(audits('vault.recovery_unavailable')).toHaveLength(1);
    expect(audits('vault.recovery_code_released')).toHaveLength(0);
    // Ended: not in the status, not claimable even after available_at, and a new request is possible.
    expect((await call('GET', '/api/vault/status')).body.vault.recovery).toBeNull();
    at(NOW + 86_400 + 5);
    const newApp = keyOf('new-phone');
    const claim = await call('POST', '/api/vault/recovery/claim', { vault_id: VID, recovery_id: rid, app_key: newApp.b64 }, { app: { key: newApp, vault: VID }, guid: 'nobody' });
    expect(claim.body.error).toBe('recovery_not_available');
    expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).body).toEqual({ cancelled: false });
    expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(202);
  });

  test('a refusal is noticed at claim time too, without a status read first', async () => {
    const rid = (await call('POST', '/api/vault/recovery', { browser_key: BK })).body.recovery_id;
    Object.assign(getItem('requests', rid), { status: 'done', envelope: REFUSAL, code: 'recovery_unavailable' });
    at(NOW + 86_400 + 5);
    const newApp = keyOf('new-phone');
    const claim = await call('POST', '/api/vault/recovery/claim', { vault_id: VID, recovery_id: rid, app_key: newApp.b64 }, { app: { key: newApp, vault: VID }, guid: 'nobody' });
    expect(claim).toMatchObject({ status: 409, body: { error: 'recovery_not_available' } });
    expect(getItem('vaults', VID).recovery.state).toBe('unavailable');
  });

  test('a refusal without the code (a release before 0.16.0) is shown at available_at, as before', async () => {
    const rid = (await call('POST', '/api/vault/recovery', { browser_key: BK })).body.recovery_id;
    Object.assign(getItem('requests', rid), { status: 'done', envelope: REFUSAL });
    expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ state: 'pending' });
    expect((await call('GET', '/api/vault/recovery')).body.recovery.sealed_code).toBeUndefined();
    at(NOW + 86_400);
    expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ state: 'available', sealed_code: REFUSAL });
  });
});

describe('2.1.0: delete my vault and start over (§11.11.9)', () => {
  const BK = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
  const CONFIRM = { confirm: 'delete my vault' };
  const mails = () => sesMock.commandCalls(SendEmailCommand).map((c) => ({
    to: c.args[0].input.Destination!.ToAddresses![0],
    subject: c.args[0].input.Content!.Simple!.Subject!.Data!,
    text: c.args[0].input.Content!.Simple!.Body!.Text!.Data!,
  }));
  const audits = (action: string) => [...tbl('audit').values()].filter((a) => a.action === action);
  const iso = (s: number) => new Date(s * 1000).toISOString();
  const noSession = { headers: {}, guid: 'nobody' };

  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0, credential_backup: false, app_key: { key: keyOf('g1').b64, kid: keyOf('g1').kid, seq: 1 } });
  });

  test('request: recorded with deletes_at = +24 h, mailed with a single-use cancel link (hash only), audited; nothing queued or locked', async () => {
    const r = await call('POST', '/api/vault/deletion', CONFIRM);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ deletion_id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/), requested_at: iso(NOW), deletes_at: iso(NOW + 86_400) });
    const row = getItem('vaults', VID);
    expect(row.deletion).toEqual({ deletion_id: r.body.deletion_id, state: 'pending', requested_at: NOW, deletes_at: NOW + 86_400 });
    expect(row.state).toBe('locked');
    expect(sent()).toHaveLength(0);
    const [mail] = mails();
    expect(mail).toMatchObject({ to: 'g1@x.org', subject: 'VettID: your vault will be deleted' });
    const token = /deletion\/cancel#t=([A-Za-z0-9_-]{43})/.exec(mail.text)![1];
    const links = [...tbl('requests').values()].filter((x) => x.op === 'deletion_cancel_link');
    expect(links).toEqual([expect.objectContaining({ request_id: `dcancel#${createHash('sha256').update(token).digest('hex')}`, deletion_id: r.body.deletion_id, expires_at: NOW + 86_400 })]);
    expect(JSON.stringify([...tbl('requests').values()])).not.toContain(token);
    expect(audits('vault.deletion_request')).toHaveLength(1);
    expect(JSON.stringify([...tbl('audit').values()])).not.toContain(token);
    // GET and the status show it; a second request and a recovery request are refused.
    expect((await call('GET', '/api/vault/deletion')).body).toEqual({ deletion: { deletion_id: r.body.deletion_id, state: 'pending', requested_at: iso(NOW), deletes_at: iso(NOW + 86_400) } });
    expect((await call('GET', '/api/vault/status', undefined, { app: { key: keyOf('g1'), vault: VID } })).body.vault.deletion).toEqual({ deletion_id: r.body.deletion_id, state: 'pending', deletes_at: iso(NOW + 86_400) });
    expect((await call('POST', '/api/vault/deletion', CONFIRM)).body.error).toBe('deletion_pending');
    getItem('vaults', VID).credential_backup = true;
    expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('deletion_pending');
    getItem('vaults', VID).deletion.state = 'executing';
    expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('deletion_pending');
  });

  test('refusals: the phrase (400), no confirmed vault (404), an active recovery (409), the terms (403); limit 3 a day', async () => {
    expect((await call('POST', '/api/vault/deletion', { confirm: 'Delete my vault' })).status).toBe(400);
    expect((await call('POST', '/api/vault/deletion', {})).status).toBe(400);
    expect((await call('POST', '/api/vault/deletion', CONFIRM, { guid: 'g2' })).status).toBe(404);
    put('vaults', { ...getItem('vaults', VID), state: 'enrolling' });
    expect((await call('POST', '/api/vault/deletion', CONFIRM)).status).toBe(404);
    put('vaults', { ...getItem('vaults', VID), state: 'locked', credential_backup: true });
    expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(202);
    expect((await call('POST', '/api/vault/deletion', CONFIRM)).body.error).toBe('recovery_active');
    getItem('members', 'g1').terms_version = 't0';
    expect((await call('POST', '/api/vault/deletion', CONFIRM)).body.error).toBe('terms_required');
    getItem('members', 'g1').terms_version = 't1';
    // Counted for g1: the 404 (enrolling) and the 409 so far; the phrase and the terms come first.
    expect((await call('POST', '/api/vault/deletion', CONFIRM)).body.error).toBe('recovery_active');
    expect((await call('POST', '/api/vault/deletion', CONFIRM)).status).toBe(429);
  });

  test('cancel from the session: removed, mailed, audited; again → {cancelled: false}; then a new request is possible', async () => {
    const id = (await call('POST', '/api/vault/deletion', CONFIRM)).body.deletion_id;
    expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: RID })).toEqual({ status: 200, body: { cancelled: false } });
    expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: id })).toEqual({ status: 200, body: { cancelled: true } });
    expect(getItem('vaults', VID).deletion).toBeUndefined();
    expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: id })).toEqual({ status: 200, body: { cancelled: false } });
    expect(mails().filter((m) => m.subject === 'VettID vault deletion cancelled')).toHaveLength(1);
    expect(audits('vault.deletion_cancel').map((a) => a.detail.via)).toEqual(['session']);
    expect((await call('GET', '/api/vault/deletion')).body).toEqual({ deletion: null });
    expect((await call('POST', '/api/vault/deletion', CONFIRM)).status).toBe(202);
  });

  test('cancel once executing → {cancelled: false}', async () => {
    const id = (await call('POST', '/api/vault/deletion', CONFIRM)).body.deletion_id;
    getItem('vaults', VID).deletion.state = 'executing';
    expect((await call('POST', '/api/vault/deletion/cancel', { deletion_id: id })).body).toEqual({ cancelled: false });
    expect(getItem('vaults', VID).deletion.state).toBe('executing');
  });

  test('cancel by the email link, without a session; a wrong or malformed token → 404/400; second use cancels nothing', async () => {
    await call('POST', '/api/vault/deletion', CONFIRM);
    const token = /deletion\/cancel#t=([A-Za-z0-9_-]{43})/.exec(mails()[0].text)![1];
    expect((await call('POST', '/api/vault/deletion/cancel-link', { token: 'x'.repeat(43) }, noSession)).status).toBe(404);
    expect((await call('POST', '/api/vault/deletion/cancel-link', { token: 'short' }, noSession)).status).toBe(400);
    // The recovery's link route does not take it, nor this route a recovery link.
    expect((await call('POST', '/api/vault/recovery/cancel-link', { token }, noSession)).status).toBe(404);
    expect(await call('POST', '/api/vault/deletion/cancel-link', { token }, noSession)).toEqual({ status: 200, body: { cancelled: true } });
    expect(getItem('vaults', VID).deletion).toBeUndefined();
    expect(await call('POST', '/api/vault/deletion/cancel-link', { token }, noSession)).toEqual({ status: 200, body: { cancelled: false } });
    expect(audits('vault.deletion_cancel').map((a) => a.detail.via)).toEqual(['link']);
    // A new deletion is not cancelled by the old link.
    await call('POST', '/api/vault/deletion', CONFIRM);
    expect((await call('POST', '/api/vault/deletion/cancel-link', { token }, noSession)).body).toEqual({ cancelled: false });
    expect(getItem('vaults', VID).deletion.state).toBe('pending');
    // After deletes_at the link is gone.
    jest.spyOn(Date, 'now').mockReturnValue((NOW + 86_401) * 1000);
    const token2 = /deletion\/cancel#t=([A-Za-z0-9_-]{43})/.exec(mails().filter((m) => m.subject === 'VettID: your vault will be deleted')[1].text)![1];
    expect((await call('POST', '/api/vault/deletion/cancel-link', { token: token2 }, noSession)).status).toBe(404);
  });

  test("cancel by the vault's app, signed by its app key, with the id from its status (2.1.1); another key is 401", async () => {
    await call('POST', '/api/vault/deletion', CONFIRM);
    const id = (await call('GET', '/api/vault/status', undefined, { app: { key: keyOf('g1'), vault: VID } })).body.vault.deletion.deletion_id;
    const other = keyOf('stranger');
    expect((await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { app: { key: other, vault: VID } })).status).toBe(401);
    expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { app: { key: keyOf('g1'), vault: VID } })).toEqual({ status: 200, body: { cancelled: true } });
    expect(audits('vault.deletion_cancel')[0].detail).toMatchObject({ via: 'app', kid: keyOf('g1').kid });
  });

  test('the app cannot request one (session routes only)', async () => {
    expect((await call('POST', '/api/vault/deletion', CONFIRM, { app: { key: keyOf('g1'), vault: VID } })).status).toBe(401);
    expect(getItem('vaults', VID).deletion).toBeUndefined();
  });
});
