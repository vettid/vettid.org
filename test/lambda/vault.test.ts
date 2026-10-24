import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { KeyObject, createHash, generateKeyPairSync, randomBytes, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { keyFromScalar, signDigest } from './ecdsa-prehash';
import { marshall } from '@aws-sdk/util-dynamodb';

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
  // 2.7.0: the recovery request key (VettidOrgDataStack).
  RECOVERY_REQUEST_KEY_ARN: 'arn:aws:kms:us-east-1:123456789012:key/11111111-2222-4333-8444-555555555555',
  RECOVERY_REQUEST_KEY_ID: '11111111-2222-4333-8444-555555555555',
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
const kms = mockClient(KMSClient);
/** The KMS stand-in's key: a fixed P-256 scalar; signatures are real ECDSA over the digest the API sends (MessageType DIGEST). */
const RRK_D = BigInt('0x' + createHash('sha256').update('vault.test recovery request key').digest('hex'));
const RRK = keyFromScalar(RRK_D);
/** Tests set this to make KMS refuse to sign (cleared before each test). */
let kmsDown = false;

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
/** Tests set these to make a put, or an update of a request row, fail (cleared before each test). */
let failPut: ((input: any) => boolean) | undefined;
let failUpdate: ((input: any) => boolean) | undefined;
/** Tests set this to make a get fail (cleared before each test). */
let failGet: ((input: any) => boolean) | undefined;
/** Called before an update is applied: what another request did in between. */
let onUpdate: ((input: any) => void) | undefined;

function installFakeDdb() {
  ddb.on(GetCommand).callsFake((i) => {
    if (failGet?.(i)) throw Object.assign(new Error('unavailable'), { name: 'InternalServerError' });
    return { Item: tbl(i.TableName).get(i.Key[KEYS[i.TableName]]) };
  });
  ddb.on(PutCommand).callsFake((i) => {
    if (failPut?.(i)) throw Object.assign(new Error('unavailable'), { name: 'InternalServerError' });
    const k = i.Item[KEYS[i.TableName]];
    if (i.ConditionExpression?.startsWith('attribute_not_exists') && tbl(i.TableName).has(k)) throw ccf();
    tbl(i.TableName).set(k, structuredClone(i.Item));
    return {};
  });
  ddb.on(UpdateCommand).callsFake((i) => {
    onUpdate?.(i);
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
    if (t === 'vaults' && i.UpdateExpression === 'SET recovery.#st = :cancelled, recovery.cancelled_via = :via, recovery.cancelled_at = :now, updated_at = :nowIso') {
      // 2.9.0: the one cancel write of every cancel: a field update, never a replacement of the recovery.
      expect(i.ConditionExpression).toBe('recovery.recovery_id = :id AND recovery.#st IN (:pending, :registered) AND recovery.expires_at > :now');
      const r = cur?.recovery;
      if (!r || r.recovery_id !== v[':id'] || ![v[':pending'], v[':registered']].includes(r.state) || !(r.expires_at > v[':now'])) throw ccf();
      Object.assign(r, { state: v[':cancelled'], cancelled_via: v[':via'], cancelled_at: v[':now'] });
      cur.updated_at = v[':nowIso'];
    } else if (t === 'vaults' && i.UpdateExpression === 'SET recovery.unlock_ids = :ids, updated_at = :now') {
      // 2.9.0: appended on the same recovery and the list read.
      const r = cur?.recovery;
      if (!r || r.recovery_id !== v[':id']) throw ccf();
      if (i.ConditionExpression.includes('attribute_not_exists(recovery.unlock_ids)') ? r.unlock_ids !== undefined : JSON.stringify(r.unlock_ids) !== JSON.stringify(v[':old'])) throw ccf();
      r.unlock_ids = structuredClone(v[':ids']);
      cur.updated_at = v[':now'];
    } else if (t === 'requests' && i.UpdateExpression.startsWith('SET noticing = :now')) {
      // 2.9.0: the notice row's claim; opening it may create it, a take-up needs it.
      const open = !i.ConditionExpression.startsWith('attribute_exists(request_id)');
      expect(i.ConditionExpression).toBe(`${open ? '' : 'attribute_exists(request_id) AND '}attribute_not_exists(noticed_at) AND (attribute_not_exists(noticing) OR noticing < :stale)`);
      expect(i.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
      if ((!cur && !open) || (cur && (cur.noticed_at !== undefined || (cur.noticing !== undefined && !(cur.noticing < v[':stale']))))) {
        // As DynamoDB returns it: the raw attribute-value form (lib-dynamodb does not unmarshall exception payloads).
        throw Object.assign(ccf(), cur ? { Item: marshall(cur) } : {});
      }
      const row = cur ?? { request_id: k };
      row.noticing = v[':now'];
      row.notice_tries = (row.notice_tries ?? v[':zero']) + v[':one'];
      if (open) Object.assign(row, { vault_id: v[':v'], user_guid: v[':g'], recovery_id: v[':rid'], expires_at: v[':exp'] });
      tbl(t).set(k, row);
      return { Attributes: { noticing: row.noticing, notice_tries: row.notice_tries } };
    } else if (t === 'requests' && i.UpdateExpression.startsWith('SET noticed_at = :now')) {
      if (!cur) throw ccf();
      cur.noticed_at = v[':now'];
      if (v[':t']) cur.notice_failed = true;
      delete cur.noticing;
    } else if (t === 'requests' && i.UpdateExpression === 'SET cancel_noticed_at = :now') {
      expect(i.ConditionExpression).toBe('attribute_exists(request_id) AND cancelled_recovery_id = :rid AND attribute_not_exists(cancel_noticed_at)');
      if (!cur || cur.cancelled_recovery_id !== v[':rid'] || cur.cancel_noticed_at !== undefined) throw ccf();
      cur.cancel_noticed_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression === 'SET recovery.#st = :done, recovery.completed_at = :at, updated_at = :now REMOVE recovery.claim_keys, recovery.recovering_key') {
      // completeRecovery (2.4.1): registered -> completed, same recovery and recovering key. The API's role may
      // not name the host's `app_key` in a write (the table's attribute-level policy), so the condition does not.
      expect(i.ConditionExpression).toBe('recovery.recovery_id = :id AND recovery.#st = :reg AND recovery.recovering_key.kid = :k');
      const r = cur?.recovery;
      if (!r || r.recovery_id !== v[':id'] || r.state !== v[':reg'] || r.recovering_key?.kid !== v[':k']) throw ccf();
      r.state = v[':done'];
      r.completed_at = v[':at'];
      delete r.claim_keys;
      delete r.recovering_key;
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression.startsWith('SET recovery.#st')) {
      // markRegistered: pending -> registered, same recovery only; refreshUnavailable: pending -> unavailable (2.7.0: with its reason).
      if (!cur?.recovery || cur.recovery.recovery_id !== v[':id'] || cur.recovery.state !== v[':pending']) throw ccf();
      cur.recovery.state = v[':reg'] ?? v[':un'];
      if (v[':rk']) cur.recovery.recovering_key = structuredClone(v[':rk']);
      if (v[':reason']) cur.recovery.reason = v[':reason'];
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression.startsWith('SET recovery.available_at = :a')) {
      // 2.7.0 applyEnclaveTimes: once, while pending, same recovery.
      expect(i.ConditionExpression).toBe('recovery.recovery_id = :id AND recovery.#st = :pending AND attribute_not_exists(recovery.enclave_times)');
      const r = cur?.recovery;
      if (!r || r.recovery_id !== v[':id'] || r.state !== v[':pending'] || r.enclave_times !== undefined) throw ccf();
      Object.assign(r, { available_at: v[':a'], expires_at: v[':x'], enclave_times: true });
      if (i.UpdateExpression.includes('REMOVE recovery.earliest')) delete r.earliest;
      else r.earliest = true;
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression === 'SET recovery.expires_at = :x, updated_at = :now') {
      // 2.7.0 noticeAttempt: a registered recovery's expiry only moves later.
      expect(i.ConditionExpression).toBe('recovery.recovery_id = :id AND recovery.#st = :reg AND recovery.expires_at < :x');
      const r = cur?.recovery;
      if (!r || r.recovery_id !== v[':id'] || r.state !== v[':reg'] || !(r.expires_at < v[':x'])) throw ccf();
      r.expires_at = v[':x'];
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression.startsWith('SET recovery.open_ids')) {
      if (!cur?.recovery || cur.recovery.recovery_id !== v[':id']) throw ccf();
      cur.recovery.open_ids = structuredClone(v[':ids']);
      cur.updated_at = v[':now'];
    } else if (t === 'vaults' && i.UpdateExpression.startsWith('SET recovery.claim_keys')) {
      if (!cur?.recovery || cur.recovery.recovery_id !== v[':id']) throw ccf();
      cur.recovery.claim_keys = structuredClone(v[':keys']);
      cur.updated_at = v[':now'];
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
    } else if (t === 'requests' && i.UpdateExpression === 'SET expires_at = :exp') {
      // 2.7.0 extendRecoveryRows: only later, only a row that names the recovery (the slot is keyed by it).
      if (!cur || !(cur.expires_at < v[':exp']) || (v[':rid'] !== undefined && cur.recovery_id !== v[':rid'])) throw ccf();
      cur.expires_at = v[':exp'];
    } else if (t === 'requests' && i.UpdateExpression.startsWith('SET attempt_noticing = :now')) {
      // 2.7.0 noticeAttempt's claim: one caller at a time; a stalled claim may be taken again.
      expect(i.ConditionExpression).toBe('attribute_exists(request_id) AND code = :c AND attribute_not_exists(attempt_noticed_at) AND (attribute_not_exists(attempt_noticing) OR attempt_noticing < :stale)');
      if (!cur || cur.code !== v[':c'] || cur.attempt_noticed_at !== undefined || (cur.attempt_noticing !== undefined && !(cur.attempt_noticing < v[':stale']))) throw ccf();
      cur.attempt_noticing = v[':now'];
      cur.attempt_notice_tries = (cur.attempt_notice_tries ?? v[':zero']) + v[':one'];
      return { Attributes: { attempt_noticing: cur.attempt_noticing, attempt_notice_tries: cur.attempt_notice_tries } };
    } else if (t === 'requests' && i.UpdateExpression.startsWith('SET attempt_noticed_at = :now')) {
      // ...and its record, only after the mail.
      if (!cur) throw ccf();
      cur.attempt_noticed_at = v[':now'];
      if (v[':t']) cur.attempt_notice_failed = true;
      delete cur.attempt_noticing;
    } else if (t === 'requests' && i.UpdateExpression === 'SET releasing = :now') {
      // The release of a recovery code: one request at a time, and never once it is recorded.
      expect(i.ConditionExpression).toBe('attribute_exists(request_id) AND attribute_not_exists(released) AND (attribute_not_exists(releasing) OR releasing < :stale)');
      if (!cur || cur.released !== undefined || (cur.releasing !== undefined && !(cur.releasing < v[':stale']))) throw ccf();
      cur.releasing = v[':now'];
    } else if (t === 'requests') {
      if (failUpdate?.(i)) throw Object.assign(new Error('unavailable'), { name: 'InternalServerError' });
      if (cur && i.UpdateExpression.startsWith('SET released')) cur.released = true;
      else if (cur) cur.status = v[':e'];
    }
    return {};
  });
  ddb.on(ScanCommand).callsFake((i) => {
    const v = i.ExpressionAttributeValues;
    if (i.TableName === 'vaults') {
      // 2.9.0 sweepAppCancels: three attributes only (the job's grant), rows with recovery_cancelled.
      expect(i).toMatchObject({ ProjectionExpression: 'vault_id, recovery, recovery_cancelled', FilterExpression: 'attribute_exists(recovery_cancelled)', Select: 'SPECIFIC_ATTRIBUTES' });
      return {
        Items: [...tbl('vaults').values()].filter((x) => x.recovery_cancelled !== undefined)
          .map((x) => structuredClone({ vault_id: x.vault_id, recovery: x.recovery, recovery_cancelled: x.recovery_cancelled })),
      };
    }
    if (i.TableName !== 'requests') throw new Error(`unexpected scan of ${i.TableName}`);
    if (v[':rcn'] !== undefined) {
      // 2.9.0 sweepAppCancels: marked unlock slots not noticed, and stalled notice rows.
      return {
        Items: [...tbl('requests').values()].filter((x) =>
          (x.op === v[':unlock'] && x.code === v[':c'] && x.cancelled_recovery_id !== undefined && x.cancel_noticed_at === undefined)
          || (String(x.request_id).startsWith(v[':rcn']) && x.noticed_at === undefined && x.noticing < v[':stale'])).map((x) => structuredClone(x)),
      };
    }
    // 2.7.0 sweepAttempts: the unnoticed counted attempts (or stalled notices).
    return {
      Items: [...tbl('requests').values()]
        .filter((x) => x.op === v[':op'] && x.code === v[':c'] && x.attempt_noticed_at === undefined && (x.attempt_noticing === undefined || x.attempt_noticing < v[':stale']))
        .map((x) => structuredClone(x)),
    };
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
  failPut = undefined;
  failUpdate = undefined;
  failGet = undefined;
  onUpdate = undefined;
  ddb.reset(); sm.reset(); sqs.reset(); sesMock.reset(); ssm.reset(); kms.reset();
  kmsDown = false;
  kms.on(SignCommand).callsFake((i) => {
    if (kmsDown) throw Object.assign(new Error('kms down'), { name: 'KMSInternalException' });
    return { KeyId: process.env.RECOVERY_REQUEST_KEY_ARN, SigningAlgorithm: 'ECDSA_SHA_256', Signature: signDigest(RRK_D, i.Message) };
  });
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
    // 2.11.0: a deleted vault answers its own app key 410 (below), another key 401.
    vaultOf('g1', { vault_id: VID, state: 'deleted', app_key: { key: keyOf('g1').b64, kid: keyOf('g1').kid, seq: 1 } });
    expect((await call('POST', '/api/vault/unlock', body(), { app: { key: keyOf('g2'), vault: VID } })).status).toBe(401);
    expect((await call('POST', '/api/vault/unlock', body(), { app: { key: keyOf('g1'), vault: VID } })).body).toMatchObject({ error: 'vault_deleted' });
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

  test('no live lease: nothing to lock, the slot is done at once, as not_running (2.5.0)', async () => {
    vaultOf('g1', { vault_id: VID });
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID })).status).toBe(202);
    expect(sqs.calls()).toHaveLength(0);
    expect((await call('GET', `/api/vault/requests/${RID}`)).body).toEqual({ status: 'done', code: 'not_running' });
  });

  // 2.5.0 (release L, "Locks"): unlock_id makes the lock bound; the API
  // checks its form only and copies it into the queue message; the audit
  // says whether the lock was bound, never the value.
  test('a bound lock carries unlock_id in the queue message; the audit records bound', async () => {
    const UID = '0123456789abcdef0123456789abcdef';
    vaultOf('g1', { vault_id: VID, state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID, unlock_id: UID })).status).toBe(202);
    const [m] = sent();
    expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'unlock_id', 'enqueued_at']);
    expect(m.msg.unlock_id).toBe(UID);
    const audits = () => ddb.commandCalls(PutCommand).filter((c) => c.args[0].input.TableName === 'audit').map((c) => c.args[0].input.Item!);
    expect(audits()[0]).toMatchObject({ action: 'vault.lock_request', detail: { bound: true } });
    expect(JSON.stringify(audits())).not.toContain(UID);
    // Unconditional: no member in the message, bound false.
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID2 })).status).toBe(202);
    expect(Object.keys(sent()[1].msg)).not.toContain('unlock_id');
    expect(audits()[1]).toMatchObject({ action: 'vault.lock_request', detail: { bound: false } });
  });

  test.each([['upper case', '0123456789ABCDEF0123456789ABCDEF'], ['short', '0123'], ['a number', 7], ['null', null], ['empty', '']])(
    'a malformed unlock_id (%s) is 400 and nothing is queued', async (_name, uid) => {
      vaultOf('g1', { vault_id: VID, state: 'unlocked', lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
      const r = await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID, unlock_id: uid });
      expect(r.status).toBe(400);
      expect(sqs.calls()).toHaveLength(0);
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

  // 2.5.0 (release L): a lock's slot passes its three codes, beside the
  // codes already passed; no other operation's slot passes them.
  test("a lock's codes for a lock's slot only", async () => {
    let i = 0;
    const poll = async (extra: Record<string, unknown>) => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + (i += 1) * 1000);
      slot(extra);
      return (await call('GET', `/api/vault/requests/${RID}`)).body;
    };
    for (const code of ['locked', 'not_running', 'stale']) {
      expect(await poll({ op: 'lock', status: 'done', code })).toEqual({ status: 'done', code });
      expect(await poll({ op: 'unlock', status: 'done', envelope: RESULT, code })).toEqual({ status: 'done', envelope: RESULT });
    }
    expect(await poll({ op: 'lock', status: 'done', code: 'etk_unknown' })).toEqual({ status: 'done', code: 'etk_unknown' });
    expect(await poll({ op: 'lock', status: 'done' })).toEqual({ status: 'done' }); // a release before L
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

  // 2.5.0 (release L, "Locks"): what `locked` rests on.
  test('locked_basis: reported, no_lease, or absent', async () => {
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0 });
    expect((await call('GET', '/api/vault/status')).body.vault).toMatchObject({ state: 'locked', locked_basis: 'reported' });
    put('vaults', { ...getItem('vaults', VID), state: 'unlocked' });
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 1000);
    expect((await call('GET', '/api/vault/status')).body.vault).toMatchObject({ state: 'locked', locked_basis: 'no_lease' });
    put('vaults', { ...getItem('vaults', VID), lease: { instance_id: 'i-1', lease_expires_at: NOW + 60 } });
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 2000);
    const v = (await call('GET', '/api/vault/status')).body.vault;
    expect(v.state).toBe('unlocked');
    expect(v).not.toHaveProperty('locked_basis');
    put('vaults', { ...getItem('vaults', VID), state: 'enrolling', lease: undefined });
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + 3000);
    expect((await call('GET', '/api/vault/status')).body.vault).not.toHaveProperty('locked_basis');
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

describe('2.11.0: a deleted vault is told to its own app key (410), and to nobody else', () => {
  const A = () => keyOf('g1');
  const deletedRow = (extra: Record<string, unknown> = {}) =>
    vaultOf('g1', {
      vault_id: VID, state: 'deleted', sealed_release: R0,
      app_key: { key: A().b64, kid: A().kid, seq: 1 },
      alarm: { kind: 'vault_deleted', alarm_id: '01JABCDEFGHJKMNPQRSTVWXYZ0', at: NOW - 60 },
      ...extra,
    });
  const tombstone = (extra: Record<string, unknown> = {}) =>
    put('requests', {
      request_id: `vdeleted#${VID}`, vault_id: VID, user_guid: 'g1', keys: [{ key: A().b64, kid: A().kid }],
      deleted_at: NOW - 3600, cause: 'vault', expires_at: NOW + 86_400, ...extra,
    });
  const status = (app: Partial<AppSig> = {}) => call('GET', '/api/vault/status', undefined, { app: { key: A(), vault: VID, ...app } });
  const DELETED = { error: 'vault_deleted', code: 'vault_deleted', deleted_at: new Date((NOW - 60) * 1000).toISOString() };

  test('a deleted row, authenticated by the app key → 410 vault_deleted with deleted_at, on any signed route', async () => {
    deletedRow();
    const r = await status();
    expect(r.status).toBe(410);
    expect(r.body).toMatchObject(DELETED);
    // The pending app_key_next (2.7.0) is the vault's app key too.
    const next = makeKey();
    put('vaults', { ...getItem('vaults', VID), app_key_next: { key: next.b64, kid: next.kid, seq: 2 } });
    expect((await status({ key: next })).status).toBe(410);
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID }, { app: { key: A(), vault: VID } })).body).toMatchObject(DELETED);
    // A deleted row without the host's notice time: deleted_at null.
    put('vaults', { ...getItem('vaults', VID), alarm: undefined });
    expect((await status()).body).toMatchObject({ code: 'vault_deleted', deleted_at: null });
    expect(sqs.calls()).toHaveLength(0);
  });

  test('a deleted row with a bad signature, a stale ts, a spent nonce or another key → the bare 401', async () => {
    deletedRow();
    const bare = { error: 'unauthorized' };
    let r = await status({ tamper: (i) => i.replace('GET', 'PUT') });
    expect(r).toEqual({ status: 401, body: expect.objectContaining(bare) });
    expect(r.body).not.toHaveProperty('code');
    expect((await status({ ts: NOW - 301 })).status).toBe(401);
    const nonce = randomBytes(16).toString('base64url');
    expect((await status({ nonce })).status).toBe(410);
    expect((await status({ nonce })).status).toBe(401);
    expect((await status({ key: keyOf('g2') })).status).toBe(401);
    // A recovery's claim key is not the vault's app key.
    const claim = makeKey();
    put('vaults', { ...getItem('vaults', VID), recovery: { recovery_id: RID, state: 'pending', requested_at: NOW, available_at: NOW + 86_400, expires_at: NOW + 7 * 86_400, claim_keys: [{ key: claim.b64, kid: claim.kid }] } });
    expect((await status({ key: claim })).status).toBe(401);
    // None of the failures counted against the 410's own limit.
    expect([...tbl('rl').keys()].filter((k) => k.startsWith('vault-gone#'))).toEqual([`vault-gone#${VID}#${NOW - (NOW % 60)}`]);
  });

  test('the row removed: the record (vdeleted#) → 410 vault_deleted; expired, absent or another key → 401', async () => {
    tombstone();
    expect(await status()).toEqual({ status: 410, body: expect.objectContaining({ code: 'vault_deleted', deleted_at: new Date((NOW - 3600) * 1000).toISOString() }) });
    expect((await status({ key: keyOf('g2') })).status).toBe(401);
    expect((await status({ tamper: (i) => i + 'x' })).status).toBe(401);
    // The TTL removes a row late: the API checks expires_at itself.
    tombstone({ expires_at: NOW });
    expect((await status()).status).toBe(401);
    tbl('requests').delete(`vdeleted#${VID}`);
    expect((await status()).status).toBe(401);
    // A record that names another vault under this key is not this vault's.
    tombstone({ vault_id: 'e'.repeat(32) });
    expect((await status()).status).toBe(401);
    // A damaged key list is no key (and no crash).
    tombstone({ keys: [null, { kid: A().kid }, 'x'] });
    expect((await status()).status).toBe(401);
    tombstone({ keys: [null, { key: A().b64, kid: A().kid }] });
    expect((await status()).status).toBe(410);
  });

  test('account deletion: account_deleted_at → 410 account_deleted after the signature, with or without the member row', async () => {
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0, app_key: { key: A().b64, kid: A().kid, seq: 1 }, account_deleted_at: NOW - 30 });
    expect(await status()).toEqual({ status: 410, body: expect.objectContaining({ error: 'account_deleted', code: 'account_deleted', deleted_at: new Date((NOW - 30) * 1000).toISOString() }) });
    tbl('members').delete('g1');
    tbl('vaults').delete('user#g1');
    expect((await status()).body).toMatchObject({ code: 'account_deleted' });
    expect((await status({ tamper: (i) => i + 'x' })).status).toBe(401);
    expect((await status({ key: keyOf('g2') })).status).toBe(401);
    // Then the vault reports `deleted`: vault_deleted.
    put('vaults', { ...getItem('vaults', VID), state: 'deleted' });
    expect((await status()).body).toMatchObject({ code: 'vault_deleted' });
  });

  test('a missing member row alone (no account_deleted_at) stays 401', async () => {
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0, app_key: { key: A().b64, kid: A().kid, seq: 1 } });
    expect((await status()).status).toBe(200);
    tbl('members').delete('g1');
    expect(await status()).toEqual({ status: 401, body: expect.not.objectContaining({ code: expect.anything() }) });
  });

  test("the 410 has its own rate limit (vault-gone#<vault_id>, 60 a minute), not the member's status budget", async () => {
    deletedRow();
    for (let i = 0; i < 60; i++) expect((await status()).status).toBe(410);
    const r = await status();
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: 'rate_limited' });
    const keys = [...tbl('rl').keys()];
    expect(keys).toContain(`vault-gone#${VID}#${NOW - (NOW % 60)}`);
    expect(keys.some((k) => k.startsWith('vault-status#'))).toBe(false);
    // The record's 410 counts against the same key.
    tbl('vaults').delete(VID);
    tombstone();
    expect((await status()).status).toBe(429);
  });

  test("the portal's session still reads a deleted vault as no vault", async () => {
    deletedRow();
    expect((await call('GET', '/api/vault/status')).body).toEqual({ vault: null, service: 'available' });
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
    // 2.7.0: the times are the earliest possible until the enclave's slot says; the request email's link is remembered (by its hash).
    expect(row.recovery).toEqual({
      recovery_id: rid, state: 'pending', requested_at: NOW, available_at: NOW + 86_400, expires_at: NOW + 172_800, locator: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{12}$/),
      earliest: true, cancel_key: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const [m] = sent();
    expect(m.url).toBe(QUEUE_PREFIX + 'i-1');
    expect(m.msg).toMatchObject({ v: 1, op: 'recovery', vault_id: VID, user_guid: 'g1', request_id: rid, browser_key: BK });
    // 2.7.0 (§11.14.8): signed with the recovery request key.
    expect(m.msg).toMatchObject({ signed_at: '2026-10-02T12:00:00Z', key_id: '11111111-2222-4333-8444-555555555555', sig: expect.any(String) });
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

  describe('the recovery\'s own slot through GET /api/vault/requests/{id}', () => {
    const poll = (rid: string) => call('GET', `/api/vault/requests/${rid}`);
    const released = () => [...tbl('audit').values()].filter((a) => a.action === 'vault.recovery_code_released');

    test('status only, before and after available_at: never the sealed code, no release recorded', async () => {
      const rid = await request();
      expect(await poll(rid)).toEqual({ status: 200, body: { status: 'queued' } });
      answer(rid);
      // Before the 24 hours, seconds after the request.
      at(NOW + 5);
      expect(await poll(rid)).toEqual({ status: 200, body: { status: 'done' } });
      // And after them: the code is the status route's to release.
      at(NOW + 86_400 + 5);
      expect(await poll(rid)).toEqual({ status: 200, body: { status: 'done' } });
      at(NOW + 172_800 - 5);
      expect(await poll(rid)).toEqual({ status: 200, body: { status: 'done' } });
      // The slot outlives the recovery by an hour: status only then too, and after that it is gone.
      at(NOW + 172_800 + 1800);
      expect(await poll(rid)).toEqual({ status: 200, body: { status: 'done' } });
      at(NOW + 172_800 + 3601);
      expect((await poll(rid)).status).toBe(404);
      expect(released()).toHaveLength(0);
      expect(getItem('requests', rid).released).toBeUndefined();
    });

    test('GET /api/vault/recovery still releases it from available_at, with its audit event, after the slot was polled', async () => {
      const rid = await request();
      answer(rid);
      at(NOW + 5);
      expect((await poll(rid)).body).toEqual({ status: 'done' });
      expect((await call('GET', '/api/vault/recovery')).body.recovery.sealed_code).toBeUndefined();
      at(NOW + 86_400);
      expect((await poll(rid)).body).toEqual({ status: 'done' });
      expect(released()).toHaveLength(0);
      const r = await call('GET', '/api/vault/recovery');
      expect(r.body.recovery).toMatchObject({ recovery_id: rid, state: 'available', sealed_code: sealedCode, locator: getItem('vaults', VID).recovery.locator });
      expect(released().map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: rid }]);
      expect(getItem('requests', rid).released).toBe(true);
    });

    test('a refusal\'s slot answers its status only too; the status route returns the sealed refusal', async () => {
      const rid = await request();
      Object.assign(answer(rid), { code: 'recovery_unavailable' });
      at(NOW + 5);
      expect((await poll(rid)).body).toEqual({ status: 'done' });
      expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ state: 'unavailable', sealed_code: sealedCode });
    });

    const RESULT = Buffer.alloc(5_252, 0x55).toString('base64');
    const slotOf = (op: unknown) => {
      const row: Record<string, unknown> = { request_id: RID2, vault_id: VID, user_guid: 'g1', op, status: 'done', envelope: RESULT, code: 'etk_unknown', created_at: new Date(NOW_MS).toISOString(), expires_at: NOW + 800 };
      if (op === undefined) delete row.op;
      put('requests', row);
    };

    test('the slots of the operations a client polls still answer their envelope and code', async () => {
      for (const [i, op] of ['enroll', 'unlock', 'lock', 'recovery_register'].entries()) {
        at(NOW + 10 + i);
        slotOf(op);
        expect((await poll(RID2)).body).toEqual({ status: 'done', envelope: RESULT, code: 'etk_unknown' });
      }
    });

    test('fail closed: a slot of any other operation, of one spelled differently, or with no `op`, answers its status only', async () => {
      for (const [i, op] of ['recovery', 'Recovery', 'RECOVERY', ' recovery', 'recovery_cancel', 'account', 'delete', 'something_new', '', undefined, null, 7, ['unlock']].entries()) {
        at(NOW + 10 + i);
        slotOf(op);
        expect((await poll(RID2)).body).toEqual({ status: 'done' });
      }
    });

    describe('the release is on record before the code is returned', () => {
      const isRelease = (i: any) => i.TableName === 'audit' && i.Item?.action === 'vault.recovery_code_released';
      const status = () => call('GET', '/api/vault/recovery');

      test('the audit write fails: no code in that answer or the next; a later request records the release once and returns the code', async () => {
        const rid = await request();
        answer(rid);
        at(NOW + 86_400);
        failPut = isRelease;
        expect((await status()).status).toBe(500);
        expect(released()).toHaveLength(0);
        expect(getItem('requests', rid).released).toBeUndefined();
        // The audit log is back, but the failed attempt is not yet old enough to retry: still no code.
        failPut = undefined;
        at(NOW + 86_400 + 5);
        let r = await status();
        expect(r.body.recovery).toMatchObject({ state: 'available' });
        expect(r.body.recovery.sealed_code).toBeUndefined();
        expect(r.body.recovery.locator).toBeUndefined();
        expect(released()).toHaveLength(0);
        at(NOW + 86_400 + 61);
        r = await status();
        expect(r.body.recovery).toMatchObject({ state: 'available', sealed_code: sealedCode });
        expect(released().map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: rid }]);
        expect(getItem('requests', rid).released).toBe(true);
        expect((await status()).body.recovery.sealed_code).toBe(sealedCode);
        expect(released()).toHaveLength(1);
      });

      test('while the audit log keeps failing the code is never returned', async () => {
        const rid = await request();
        answer(rid);
        failPut = isRelease;
        for (const t of [0, 61, 200, 3600]) {
          at(NOW + 86_400 + t);
          const r = await status();
          expect(r.status).toBe(500);
          expect(JSON.stringify(r.body)).not.toContain(sealedCode);
          expect(getItem('requests', rid).released).toBeUndefined();
        }
        expect(released()).toHaveLength(0);
      });

      test('concurrent requests: one writes the event; none returns the code before it is recorded', async () => {
        const rid = await request();
        answer(rid);
        at(NOW + 86_400);
        const answers = await Promise.all([status(), status(), status()]);
        expect(answers.map((a) => a.status)).toEqual([200, 200, 200]);
        expect(answers.filter((a) => a.body.recovery.sealed_code === sealedCode).length).toBeGreaterThanOrEqual(1);
        expect(released()).toHaveLength(1);
        // Another request's release in progress, not yet recorded: no code and no second event.
        delete getItem('requests', rid).released;
        getItem('requests', rid).releasing = NOW + 86_400;
        const r = await status();
        expect(r.body.recovery).toMatchObject({ state: 'available' });
        expect(r.body.recovery.sealed_code).toBeUndefined();
        expect(released()).toHaveLength(1);
        // Recorded meanwhile: the code, still one event.
        getItem('requests', rid).released = true;
        expect((await status()).body.recovery.sealed_code).toBe(sealedCode);
        expect(released()).toHaveLength(1);
      });

      test('another request finishes the release between this one\'s read and its mark: the code, from a fresh read, and no second event', async () => {
        const rid = await request();
        answer(rid);
        at(NOW + 86_400);
        // The other request holds the mark when this one reads the slot...
        getItem('requests', rid).releasing = NOW + 86_400;
        // ...and has written the event and recorded the release by the time this one tries to take the mark.
        // (A new row object: the one this request read stays as it was, unreleased.)
        onUpdate = (i) => {
          if (i.UpdateExpression !== 'SET releasing = :now') return;
          put('audit', { ts_id: 'other-request', action: 'vault.recovery_code_released', detail: { vault_id: VID, recovery_id: rid } });
          put('requests', { ...getItem('requests', rid), released: true });
        };
        const r = await status();
        expect(r.body.recovery).toMatchObject({ state: 'available', sealed_code: sealedCode, locator: getItem('vaults', VID).recovery.locator });
        expect(released()).toHaveLength(1);
      });

      test('the event is written but recording it on the slot fails: no code then; the retry writes the event again rather than release unrecorded', async () => {
        const rid = await request();
        answer(rid);
        at(NOW + 86_400);
        failUpdate = (i) => i.UpdateExpression === 'SET released = :t';
        expect((await status()).status).toBe(500);
        expect(released()).toHaveLength(1);
        failUpdate = undefined;
        at(NOW + 86_400 + 61);
        expect((await status()).body.recovery.sealed_code).toBe(sealedCode);
        expect(released()).toHaveLength(2);
      });
    });
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

  test('an app gets a result only for the operations a client polls: its own slot of any other operation, or of none, answers status only', async () => {
    const RESULT = Buffer.alloc(5_252, 0x66).toString('base64');
    const own = (op: unknown) => {
      const row: Record<string, unknown> = { request_id: RID2, vault_id: VID, user_guid: 'g1', op, app_kid: keyOf('g1').kid, status: 'done', envelope: RESULT, code: 'etk_unknown', created_at: new Date(NOW_MS).toISOString(), expires_at: NOW + 800 };
      if (op === undefined) delete row.op;
      put('requests', row);
    };
    const poll = () => call('GET', `/api/vault/requests/${RID2}`, undefined, { app: app() });
    for (const [i, op] of ['recovery', 'Recovery', 'recovery_cancel', 'account', 'delete', 'something_new', '', undefined].entries()) {
      jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + (i + 1) * 1000);
      own(op);
      expect(await poll()).toEqual({ status: 200, body: { status: 'done' } });
    }
    for (const [i, op] of ['enroll', 'unlock', 'lock', 'recovery_register'].entries()) {
      jest.spyOn(Date, 'now').mockReturnValue(NOW_MS + (i + 20) * 1000);
      own(op);
      expect(await poll()).toEqual({ status: 200, body: { status: 'done', envelope: RESULT, code: 'etk_unknown' } });
    }
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

  // 2.3.1: an email with a control character is refused as the shared email check refuses it,
  // before any lookup or count; the answer depends on the input only, and the hold still applies.
  test.each(['g1\u0000@x.org', 'g1@x\u007f.org', 'g1@x.org\u0085x', 'g\u20281@x.org', 'g1@x.o\u2029rg'])('typed redeem refuses %j with 400 Invalid email address', async (addr) => {
    const c = await issue();
    const r = await redeem({ email: addr, code: c.code });
    expect(r).toMatchObject({ status: 400, body: { message: 'Invalid email address' } });
    expect(holds).toEqual([250]);
    expect(ddb.commandCalls(QueryCommand).filter((q) => q.args[0].input.IndexName === 'email-index')).toHaveLength(0);
    expect(issuances()[0]).toMatchObject({ state: 'live', typed_attempts: 0 });
    expect([...tbl('rl').keys()].filter((k) => k.startsWith('enroll-typed'))).toEqual([]);
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
    // 2.4.0: the answer also carries the two identifiers; the audit says how the app read the code.
    expect(r).toEqual({ status: 200, body: { user_guid: 'g1', email_hint: 'g***@x.org', vault_id: VID, recovery_id: rid } });
    expect(getItem('vaults', VID).recovery.claim_keys).toEqual([{ key: newApp.b64, kid: newApp.kid }]);
    expect([...tbl('audit').values()].find((a) => a.action === 'vault.recovery_claim').detail).toEqual({ vault_id: VID, recovery_id: rid, kid: newApp.kid, via: 'qr' });
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
    // The recovering key may read status while the recovery is active; 2.7.0 (release R): it may not unlock or lock (403).
    expect((await call('GET', '/api/vault/status', undefined, signed)).body.vault.recovery.state).toBe('registered');
    expect((await call('POST', '/api/vault/unlock', UNLOCK, signed))).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: '01JB2Z6V9K3M4N5P6Q7R8S9T0Y' }, signed)).status).toBe(403);
    // The old phone still unlocks too until the enclave reports the new app key.
    expect((await call('GET', '/api/vault/status', undefined, { app: { key: keyOf('old-phone'), vault: VID } })).status).toBe(200);
    // The host writes the new key: the old key is refused, the recovery's keys are cleared.
    getItem('vaults', VID).app_key = { key: newApp.b64, kid: newApp.kid, seq: 2 };
    expect((await call('GET', '/api/vault/status', undefined, { app: { key: keyOf('old-phone'), vault: VID } })).status).toBe(401);
    expect((await call('GET', '/api/vault/status', undefined, signed)).status).toBe(200);
    expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
    expect(getItem('vaults', VID).recovery.recovering_key).toBeUndefined();
    // 2.4.1: and the recovery is recorded as completed, which the new app's status no longer shows.
    expect(getItem('vaults', VID).recovery).toMatchObject({ recovery_id: rid, state: 'completed', completed_at: NOW + 86_400 + 7 });
    expect((await call('GET', '/api/vault/status', undefined, signed)).body.vault.recovery).toBeNull();
  });

  describe('2.4.1: a completed recovery stops blocking a new request', () => {
    const signed = { app: { key: newApp, vault: VID } };
    const audits = (action: string) => [...tbl('audit').values()].filter((a) => a.action === action);
    /** Claim, register, the enclave's marker, the app's poll: `registered`, with its recovering key. */
    const register = async () => {
      at(NOW + 86_400 + 5);
      expect((await claim({ vault_id: VID, recovery_id: rid })).status).toBe(200);
      expect((await call('POST', '/api/vault/recovery/register', REG, signed)).status).toBe(202);
      Object.assign(getItem('requests', RID2), { status: 'done', envelope: Buffer.alloc(5_252, 4).toString('base64'), code: 'recovery_registered' });
      at(NOW + 86_400 + 7);
      expect((await call('GET', `/api/vault/requests/${RID2}`, undefined, signed)).body.code).toBe('recovery_registered');
      expect(getItem('vaults', VID).recovery).toMatchObject({ state: 'registered', recovering_key: { kid: newApp.kid } });
    };
    /** The host's report after `credential.recover` (§11.11.5 step 3): the vault's app key is the new app's. */
    const hostReports = (key = newApp) => (getItem('vaults', VID).app_key = { key: key.b64, kid: key.kid, seq: 2 });

    test('registered is not completed: the PIN and password step has not succeeded, so it still blocks and can be cancelled', async () => {
      await register();
      // The recovering app tries (2.7.0: an unlock is refused; it would open), but the host has not reported its key.
      expect((await call('POST', '/api/vault/unlock', UNLOCK, signed)).status).toBe(403);
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('recovery_active');
      expect((await call('GET', '/api/vault/recovery')).body.recovery.state).toBe('registered');
      expect(getItem('vaults', VID).recovery.state).toBe('registered');
      expect(audits('vault.recovery_completed')).toHaveLength(0);
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).body).toEqual({ cancelled: true });
    });

    test('an app key that is not the recovering key completes nothing', async () => {
      await register();
      hostReports(keyOf('some-other-phone'));
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('recovery_active');
      expect(getItem('vaults', VID).recovery.state).toBe('registered');
    });

    test('a registered recovery without a recovering key is never taken as completed', async () => {
      await register();
      delete getItem('vaults', VID).recovery.recovering_key;
      delete getItem('vaults', VID).recovery.claim_keys;
      hostReports();
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('recovery_active');
      expect((await call('GET', '/api/vault/recovery')).body.recovery.state).toBe('registered');
      expect(audits('vault.recovery_completed')).toHaveLength(0);
    });

    test('pending and available recoveries are not completed by an app key report', async () => {
      // Pending, with a key planted where a recovering key would be: the state decides.
      getItem('vaults', VID).recovery.recovering_key = { key: newApp.b64, kid: newApp.kid };
      hostReports();
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('recovery_active');
      at(NOW + 86_400 + 5);
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('recovery_active');
      expect((await call('GET', '/api/vault/recovery')).body.recovery.state).toBe('available');
      expect(audits('vault.recovery_completed')).toHaveLength(0);
    });

    test('the host reports the recovering key as the app key: the next request records the completion and succeeds', async () => {
      await register();
      const oldLocator = getItem('vaults', VID).recovery.locator;
      hostReports();
      at(NOW + 86_400 + 600);
      const before = sent().length;
      const mailsBefore = sesMock.commandCalls(SendEmailCommand).length;
      // No app call and no status read in between: the request itself notices.
      const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
      expect(r.status).toBe(202);
      const rid2 = r.body.recovery_id;
      expect(rid2).not.toBe(rid);
      const [done] = audits('vault.recovery_completed');
      expect(done.detail).toEqual({ vault_id: VID, recovery_id: rid, kid: newApp.kid });
      expect(audits('vault.recovery_completed')).toHaveLength(1);
      expect(JSON.stringify(done)).not.toContain(newApp.b64);
      expect(JSON.stringify(done)).not.toContain(oldLocator);
      // The new recovery is an ordinary one: pending, queued, mailed, with its own locator and no keys.
      const rec = getItem('vaults', VID).recovery;
      expect(rec).toEqual({
        recovery_id: rid2, state: 'pending', requested_at: NOW + 86_400 + 600, available_at: NOW + 2 * 86_400 + 600, expires_at: NOW + 3 * 86_400 + 600,
        locator: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{12}$/), earliest: true, cancel_key: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(rec.locator).not.toBe(oldLocator);
      expect(sent().slice(before).map((m) => m.msg.op)).toEqual(['recovery']);
      // 2.7.0: the completion is mailed, then the new request.
      expect(sesMock.commandCalls(SendEmailCommand).slice(mailsBefore).map((c) => c.args[0].input.Content!.Simple!.Subject!.Data)).toEqual(['VettID vault recovered', 'VettID vault recovery requested']);
      // The old recovery is gone for good: its pair and its locator name no current recovery.
      const other = keyOf('another-phone');
      expect((await claim({ vault_id: VID, recovery_id: rid }, other)).status).toBe(404);
      expect((await call('POST', '/api/vault/recovery/claim', { locator: oldLocator, app_key: other.b64 }, { app: { key: other, vault: '' }, guid: 'nobody' })).status).toBe(404);
      // And the new one is in progress: a further request is refused, the old cancel is not for it.
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('recovery_active');
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).status).toBe(404);
      expect(getItem('vaults', VID).recovery.recovery_id).toBe(rid2);
    });

    test('completed: GET shows it without code, locator or keys; status shows none; its code cannot be claimed or registered again', async () => {
      await register();
      const oldLocator = getItem('vaults', VID).recovery.locator;
      hostReports();
      at(NOW + 86_400 + 60);
      const g = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(g).toEqual({
        recovery_id: rid, vault_id: VID, state: 'completed', requested_at: new Date(NOW * 1000).toISOString(),
        available_at: new Date((NOW + 86_400) * 1000).toISOString(), expires_at: new Date((NOW + 172_800) * 1000).toISOString(),
        completed_at: new Date((NOW + 86_400 + 60) * 1000).toISOString(),
      });
      expect(getItem('vaults', VID).recovery).toEqual({
        recovery_id: rid, state: 'completed', requested_at: NOW, available_at: NOW + 86_400, expires_at: NOW + 172_800, locator: oldLocator,
        register_ids: [RID2], completed_at: NOW + 86_400 + 60, earliest: true, cancel_key: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect((await call('GET', '/api/vault/status')).body.vault.recovery).toBeNull();
      // Recorded once, however often it is read.
      await call('GET', '/api/vault/recovery');
      expect(audits('vault.recovery_completed')).toHaveLength(1);
      // Still inside the code's window: the old pair and locator are refused, and nothing is written.
      const other = keyOf('another-phone');
      expect((await claim({ vault_id: VID, recovery_id: rid }, other)).body.error).toBe('recovery_not_available');
      expect((await call('POST', '/api/vault/recovery/claim', { locator: oldLocator, app_key: other.b64 }, { app: { key: other, vault: '' }, guid: 'nobody' })).body.error).toBe('recovery_not_available');
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
      // The key that claimed it is now the app key and nothing else: no register for the ended recovery.
      expect((await call('POST', '/api/vault/recovery/register', { ...REG, request_id: RID }, signed)).status).toBe(401);
      // The old phone's key is refused.
      expect((await call('GET', '/api/vault/status', undefined, { app: { key: keyOf('old-phone'), vault: VID } })).status).toBe(401);
    });

    test('completed: nothing to cancel (no cancel queued, no mail), by session or by the emailed link', async () => {
      const token = /cancel#t=([A-Za-z0-9_-]{43})/.exec(sesMock.commandCalls(SendEmailCommand)[0].args[0].input.Content!.Simple!.Body!.Text!.Data!)![1];
      await register();
      hostReports();
      const before = sent().length;
      const mailsBefore = sesMock.commandCalls(SendEmailCommand).length;
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).body).toEqual({ cancelled: false });
      expect((await call('POST', '/api/vault/recovery/cancel-link', { token }, { guid: 'nobody' })).body).toEqual({ cancelled: false });
      expect(getItem('vaults', VID).recovery.state).toBe('completed');
      expect(sent()).toHaveLength(before);
      // 2.7.0: the only mail is the completion's (recorded by the first cancel call), never a cancel.
      expect(sesMock.commandCalls(SendEmailCommand).slice(mailsBefore).map((c) => c.args[0].input.Content!.Simple!.Subject!.Data)).toEqual(['VettID vault recovered']);
      expect(audits('vault.recovery_cancel')).toHaveLength(0);
    });

    test('the request limit (3 per member per day) still applies after a completed recovery', async () => {
      await register();
      hostReports();
      // A day after the completed recovery's request: that day's three (cancelled in between), then the limit.
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(202);
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: getItem('vaults', VID).recovery.recovery_id })).body).toEqual({ cancelled: true });
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(202);
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: getItem('vaults', VID).recovery.recovery_id })).body).toEqual({ cancelled: true });
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(202);
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: getItem('vaults', VID).recovery.recovery_id })).body).toEqual({ cancelled: true });
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(429);
    });

    test('a completed recovery does not block a start-over either; the backup bit and a pending deletion still refuse a request', async () => {
      await register();
      hostReports();
      getItem('vaults', VID).credential_backup = false;
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body).toMatchObject({ error: 'recovery_unavailable', reason: 'no_backup' });
      expect(getItem('vaults', VID).recovery).toMatchObject({ recovery_id: rid, state: 'completed' });
      expect((await call('POST', '/api/vault/deletion', { confirm: 'delete my vault' })).status).toBe(202);
      getItem('vaults', VID).credential_backup = true;
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('deletion_pending');
    });
  });

  describe('the scanned form\'s limits: the network first, the vault only for its own recovery', () => {
    const rl = (prefix: string) => [...tbl('rl').keys()].filter((k) => String(k).startsWith(prefix));
    const perVault = () => rl('vault-recovery-claim#').map((k) => getItem('rl', k).count);
    /** A scanned claim from another source network. */
    const claimFrom = (ip: string, body: Record<string, unknown>, vault = VID, key = newApp) =>
      call('POST', '/api/vault/recovery/claim', { ...body, app_key: key.b64 }, { app: { key, vault }, guid: 'nobody', headers: { 'cloudfront-viewer-address': `${ip}:443` } });

    test('a known vault_id with a wrong recovery_id does not use the vault\'s daily allowance', async () => {
      at(NOW + 86_400 + 5);
      // More than the vault's 10 a day, from as many networks, each with a key just made.
      for (let i = 0; i < 12; i++) {
        const r = await claimFrom(`2001:db8:${i + 1}:1::1`, { vault_id: VID, recovery_id: RID }, VID, keyOf(`stranger-${i}`));
        expect(r).toEqual({ status: 404, body: { error: 'not_found', message: 'No such recovery' } });
      }
      expect(rl('vault-recovery-claim#')).toHaveLength(0);
      expect(rl('vault-recovery-claim-net#')).toHaveLength(12);
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
      // The member's new app still claims.
      expect((await claim({ vault_id: VID, recovery_id: rid })).status).toBe(200);
      expect(perVault()).toEqual([1]);
    });

    test('a pair that names the vault\'s recovery counts, whatever the claim then answers', async () => {
      // Pending: 409, counted.
      expect((await claim({ vault_id: VID, recovery_id: rid })).status).toBe(409);
      expect(perVault()).toEqual([1]);
      at(NOW + 3600);
      for (let i = 0; i < 9; i++) expect((await claimFrom(`2001:db8:${i + 1}:1::1`, { vault_id: VID, recovery_id: rid })).status).toBe(409);
      expect(perVault()).toEqual([10]);
      const r = await claimFrom('2001:db8:99:1::1', { vault_id: VID, recovery_id: rid });
      expect(r.status).toBe(429);
      expect(r.body.error).toBe('rate_limited');
    });

    test('a recovery in any state is the vault\'s recovery: cancelled, expired, registered, refused or completed is 409, and counts', async () => {
      const row = () => getItem('vaults', VID).recovery;
      const pending = structuredClone(row());
      const cases: [string, number, () => void | Promise<unknown>][] = [
        ['cancelled', NOW + 86_400 + 5, () => call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })],
        ['expired', NOW + 172_800 + 5, () => {}],
        ['registered', NOW + 86_400 + 5, () => void (row().state = 'registered')],
        ['unavailable', NOW + 86_400 + 5, () => void (row().state = 'unavailable')],
        ['completed', NOW + 86_400 + 5, () => void Object.assign(row(), { state: 'completed', completed_at: NOW + 86_400 })],
      ];
      for (const [i, [state, when, enter]] of cases.entries()) {
        getItem('vaults', VID).recovery = structuredClone(pending);
        for (const k of rl('vault-recovery-claim#')) tbl('rl').delete(k);
        at(when);
        await enter();
        if (state !== 'expired') expect(row().state).toBe(state);
        const r = await claimFrom(`2001:db8:${i + 1}:1::1`, { vault_id: VID, recovery_id: rid });
        expect([state, r.status, r.body.error]).toEqual([state, 409, 'recovery_not_available']);
        expect([state, perVault()]).toEqual([state, [1]]);
        expect(row().claim_keys).toBeUndefined();
      }
    });

    test('the right pair of a member whose row is gone is the 404 of a miss, and of a canceled account 403; both count against the vault', async () => {
      at(NOW + 86_400 + 5);
      const member = structuredClone(getItem('members', 'g1'));
      put('members', { ...member, account_status: 'canceled' });
      const canceled = await claimFrom('2001:db8:1:1::1', { vault_id: VID, recovery_id: rid });
      expect([canceled.status, canceled.body.error]).toEqual([403, 'forbidden']);
      expect(perVault()).toEqual([1]);
      tbl('members').delete('g1');
      const gone = await claimFrom('2001:db8:2:1::1', { vault_id: VID, recovery_id: rid });
      expect(gone).toEqual({ status: 404, body: { error: 'not_found', message: 'No such recovery' } });
      expect(perVault()).toEqual([2]);
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
      // The member's row back: the claim succeeds.
      put('members', member);
      expect((await claimFrom('2001:db8:3:1::1', { vault_id: VID, recovery_id: rid })).status).toBe(200);
    });

    test('the per-network limit comes first: 10 per 15 minutes, misses count, and the 11th is refused before any lookup', async () => {
      at(NOW + 86_400 + 5);
      for (let i = 0; i < 10; i++) expect((await claim({ vault_id: VID, recovery_id: RID })).status).toBe(404);
      const gets = ddb.commandCalls(GetCommand).filter((c) => c.args[0].input.TableName === 'vaults').length;
      // The right pair from the same network is refused too, uncounted for the vault.
      expect((await claim({ vault_id: VID, recovery_id: rid })).status).toBe(429);
      expect(ddb.commandCalls(GetCommand).filter((c) => c.args[0].input.TableName === 'vaults')).toHaveLength(gets);
      expect(rl('vault-recovery-claim#')).toHaveLength(0);
      // Another network is not affected.
      expect((await claimFrom('2001:db8:77:1::1', { vault_id: VID, recovery_id: rid })).status).toBe(200);
    });

    test('every miss is the same 404 after the same reads: an unknown vault, another recovery, a deleted vault, a pointer elsewhere', async () => {
      at(NOW + 86_400 + 5);
      const OTHER = 'e'.repeat(32);
      const miss = async (n: number, vid: string, recoveryId: string) => {
        const before = ddb.commandCalls(GetCommand).length;
        const r = await claimFrom(`2001:db8:${n}:1::1`, { vault_id: vid, recovery_id: recoveryId }, vid);
        expect(r.status).toBe(404);
        return { body: r.body, reads: ddb.commandCalls(GetCommand).slice(before).map((c) => c.args[0].input.TableName) };
      };
      const unknownVault = await miss(1, OTHER, rid);
      const otherRecovery = await miss(2, VID, RID);
      expect(otherRecovery).toEqual(unknownVault);
      expect(unknownVault.reads.filter((t) => t === 'vaults')).toHaveLength(2);
      const pointer = structuredClone(getItem('vaults', 'user#g1'));
      put('vaults', { ...pointer, current_vault_id: OTHER });
      expect(await miss(3, VID, rid)).toEqual(unknownVault);
      put('vaults', pointer);
      getItem('vaults', VID).state = 'deleted';
      expect(await miss(4, VID, rid)).toEqual(unknownVault);
      expect(rl('vault-recovery-claim#')).toHaveLength(0);
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
    });
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

// ---- the typed recovery code (MEMBER-API 2.4.0, VAULT-MESSAGING 0.25.0 §11.11.10) ---------

describe('2.4.0: the recovery locator and the claim by locator', () => {
  const BK = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
  const LOCATOR = /^[0-9A-HJKMNP-TV-Z]{12}$/;
  const AVAILABLE = NOW + 86_400 + 5;
  const newApp = keyOf('typing-phone');
  const at = (s: number) => {
    jest.spyOn(Date, 'now').mockReturnValue(s * 1000);
    for (const i of tbl('instances').values()) i.heartbeat_at = s - 10;
  };
  const request = async (guid = 'g1') => {
    const r = await call('POST', '/api/vault/recovery', { browser_key: BK }, { guid });
    expect(r.status).toBe(202);
    return r.body.recovery_id as string;
  };
  const answer = (rid: string, extra: Record<string, unknown> = {}) => Object.assign(getItem('requests', rid), { status: 'done', envelope: Buffer.alloc(5_252, 3).toString('base64'), ...extra });
  const locatorOf = (vid = VID) => getItem('vaults', vid).recovery.locator as string;
  const locatorRows = () => [...tbl('requests').values()].filter((x) => x.op === 'recovery_locator');
  /** Signed with an empty `vault`, as a setup code's redeem; another source network when `ip` is given. */
  const claim = (body: Record<string, unknown>, opts: { key?: TestKey; vault?: string; ip?: string } = {}) =>
    call('POST', '/api/vault/recovery/claim', { ...body, app_key: (opts.key ?? newApp).b64 }, {
      app: { key: opts.key ?? newApp, vault: opts.vault ?? '' },
      guid: 'nobody',
      headers: opts.ip ? { 'cloudfront-viewer-address': `${opts.ip}:443` } : undefined,
    });
  const audits = (action: string) => [...tbl('audit').values()].filter((a) => a.action === action);
  const rl = (prefix: string) => [...tbl('rl').keys()].filter((k) => String(k).startsWith(prefix));
  /** A locator no recovery has (a different one from the minted). */
  const other = (loc: string) => (loc[0] === '0' ? '1' : '0') + loc.slice(1);

  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0 });
  });

  describe('minting', () => {
    test('60 bits as 12 Crockford characters, most significant first', () => {
      const bytes = jest.spyOn(require('node:crypto'), 'randomBytes') as jest.SpyInstance;
      bytes.mockReturnValueOnce(Buffer.from('ffffffffffffffff', 'hex'));
      expect(vault.locators.draw()).toBe('Z'.repeat(12));
      bytes.mockReturnValueOnce(Buffer.from('000000000000000f', 'hex')); // the low 4 bits are not used
      expect(vault.locators.draw()).toBe('0'.repeat(12));
      bytes.mockReturnValueOnce(Buffer.from('0842108421084210', 'hex')); // 00001 twelve times
      expect(vault.locators.draw()).toBe('1'.repeat(12));
      bytes.mockReturnValueOnce(Buffer.from('f800000000000010', 'hex')); // the first and the last 5 bits
      expect(vault.locators.draw()).toBe('Z0000000000' + '1');
      bytes.mockRestore();
      const drawn = new Set(Array.from({ length: 200 }, () => vault.locators.draw()));
      expect(drawn.size).toBe(200);
      for (const l of drawn) expect(l).toMatch(LOCATOR);
    });

    test('one per request: on the recovery and as a request-table row that expires with it', async () => {
      const rid = await request();
      const loc = locatorOf();
      expect(loc).toMatch(LOCATOR);
      expect(locatorRows()).toEqual([
        { request_id: `recovery-locator#${loc}`, vault_id: VID, recovery_id: rid, op: 'recovery_locator', status: 'locator', created_at: expect.any(String), expires_at: NOW + 172_800 },
      ]);
      expect(getItem('vaults', VID).recovery.expires_at).toBe(NOW + 172_800);
    });

    test('the request answers no locator; it is in no email, audit entry or log', async () => {
      const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
      expect(r.body).toEqual({ recovery_id: expect.any(String), available_at: expect.any(String), expires_at: expect.any(String), earliest: true });
      const loc = locatorOf();
      const mailed = JSON.stringify(sesMock.commandCalls(SendEmailCommand).map((c) => c.args[0].input));
      expect(mailed).not.toContain(loc);
      expect(JSON.stringify([...tbl('audit').values()])).not.toContain(loc);
      expect(JSON.stringify(sent())).not.toContain(loc);
      expect(logs.join('\n')).not.toContain(loc);
    });

    test('a new request mints another locator; the old one no longer names the current recovery', async () => {
      const first = await request();
      const loc1 = locatorOf();
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: first })).body).toEqual({ cancelled: true });
      const second = await request();
      const loc2 = locatorOf();
      expect(loc2).not.toBe(loc1);
      expect(locatorRows().map((x) => [x.request_id, x.recovery_id]).sort()).toEqual([[`recovery-locator#${loc1}`, first], [`recovery-locator#${loc2}`, second]].sort());
    });

    test('unique among the rows held: a collision draws again (conditional put)', async () => {
      const taken = 'TAKEN0000000';
      put('requests', { request_id: `recovery-locator#${taken}`, vault_id: 'e'.repeat(32), recovery_id: RID, op: 'recovery_locator', status: 'locator', expires_at: NOW + 500 });
      const draw = jest.spyOn(vault.locators, 'draw').mockReturnValueOnce(taken).mockReturnValueOnce(taken).mockReturnValueOnce('FREE00000000');
      await request();
      expect(draw).toHaveBeenCalledTimes(3);
      expect(locatorOf()).toBe('FREE00000000');
      // The other recovery's row is untouched.
      expect(getItem('requests', `recovery-locator#${taken}`)).toMatchObject({ vault_id: 'e'.repeat(32), recovery_id: RID });
    });

    test('no free locator after 5 draws: the request fails and nothing is recorded, queued or mailed', async () => {
      put('requests', { request_id: 'recovery-locator#TAKEN0000000', vault_id: 'e'.repeat(32), recovery_id: RID, op: 'recovery_locator', status: 'locator', expires_at: NOW + 500 });
      const draw = jest.spyOn(vault.locators, 'draw').mockReturnValue('TAKEN0000000');
      const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
      expect(r.status).toBe(500);
      expect(draw).toHaveBeenCalledTimes(5);
      expect(getItem('vaults', VID).recovery).toBeUndefined();
      expect(sent()).toHaveLength(0);
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    });
  });

  describe('GET /api/vault/recovery: `locator` only with a code\'s `sealed_code`', () => {
    test('pending: none; available without the envelope: none; with the code: both; expired: none', async () => {
      const rid = await request();
      const loc = locatorOf();
      answer(rid);
      let r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r.state).toBe('pending');
      expect(r).not.toHaveProperty('locator');
      expect(r).not.toHaveProperty('sealed_code');
      at(AVAILABLE);
      // The vault has not handed the code over yet: no sealed_code, so no locator.
      Object.assign(getItem('requests', rid), { status: 'queued', envelope: undefined });
      r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r.state).toBe('available');
      expect(r).not.toHaveProperty('locator');
      expect(r).not.toHaveProperty('sealed_code');
      answer(rid);
      r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r).toMatchObject({ state: 'available', sealed_code: expect.any(String), locator: loc });
      at(NOW + 172_800 + 1);
      r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r.state).toBe('expired');
      expect(r).not.toHaveProperty('locator');
    });

    test('never with a refusal (`unavailable`), cancelled or registered', async () => {
      const rid = await request();
      answer(rid, { code: 'recovery_unavailable' });
      let r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r).toMatchObject({ state: 'unavailable', sealed_code: expect.any(String) });
      expect(r).not.toHaveProperty('locator');
      getItem('vaults', VID).recovery.state = 'cancelled';
      r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r).not.toHaveProperty('locator');
      getItem('vaults', VID).recovery.state = 'registered';
      at(AVAILABLE);
      r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r.state).toBe('registered');
      expect(r).not.toHaveProperty('locator');
    });

    test('a recovery requested before 2.4.0 has none: the code alone', async () => {
      const rid = await request();
      answer(rid);
      delete getItem('vaults', VID).recovery.locator;
      at(AVAILABLE);
      const r = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(r).toMatchObject({ state: 'available', sealed_code: expect.any(String) });
      expect(r).not.toHaveProperty('locator');
    });

    test('status never carries it', async () => {
      await request();
      at(AVAILABLE);
      const s = await call('GET', '/api/vault/status');
      expect(s.body.vault.recovery).toEqual({ state: 'available', available_at: expect.any(String) });
      expect(JSON.stringify(s.body)).not.toContain(locatorOf());
    });
  });

  describe('POST /api/vault/recovery/claim {locator, app_key}', () => {
    let rid: string;
    let loc: string;
    beforeEach(async () => {
      rid = await request();
      answer(rid);
      loc = locatorOf();
    });

    test('hit: the answer of the pair with its two identifiers; the key is a claim key; audited `via: typed` without the locator', async () => {
      at(AVAILABLE);
      const r = await claim({ locator: loc });
      expect(r).toEqual({ status: 200, body: { user_guid: 'g1', email_hint: 'g***@x.org', vault_id: VID, recovery_id: rid } });
      expect(getItem('vaults', VID).recovery.claim_keys).toEqual([{ key: newApp.b64, kid: newApp.kid }]);
      expect(audits('vault.recovery_claim').map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: rid, kid: newApp.kid, via: 'typed' }]);
      expect(audits('vault.recovery_locator_miss')).toHaveLength(0);
      expect(JSON.stringify([...tbl('audit').values()])).not.toContain(loc);
      expect(logs.join('\n')).not.toContain(loc);
      // The claim key then works exactly as a scanned claim's: enclave and register.
      const signed = { app: { key: newApp, vault: VID } };
      expect((await call('GET', '/api/vault/enclave', undefined, signed)).status).toBe(200);
      const REG = { vault_id: VID, request_id: RID2, instance_id: 'i-1', etk_kid: KID, envelope: ENV };
      expect((await call('POST', '/api/vault/recovery/register', REG, signed)).status).toBe(202);
      expect(getItem('requests', RID2)).toMatchObject({ recovery_id: rid, app_kid: newApp.kid });
    });

    test('the same answer as the scanned form for the same recovery', async () => {
      at(AVAILABLE);
      const typed = await claim({ locator: loc });
      const scanned = await claim({ vault_id: VID, recovery_id: rid }, { key: keyOf('scanning-phone'), vault: VID });
      expect(scanned).toEqual(typed);
      expect(audits('vault.recovery_claim').map((a) => a.detail.via).sort()).toEqual(['qr', 'typed']);
    });

    test('signed with an empty `vault`: a vault in the header is 401, and so is a scanned body signed with none', async () => {
      at(AVAILABLE);
      expect((await claim({ locator: loc }, { vault: VID })).status).toBe(401);
      expect((await claim({ vault_id: VID, recovery_id: rid }, { vault: '' })).status).toBe(401);
      // Signed by another key than the one in the body.
      const r = await call('POST', '/api/vault/recovery/claim', { locator: loc, app_key: newApp.b64 }, { app: { key: keyOf('someone-else'), vault: '' }, guid: 'nobody' });
      expect(r.status).toBe(401);
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
      // Refused at the signature: nothing counted.
      expect(rl('vault-recovery-claim-net#')).toHaveLength(0);
    });

    test('the body\'s syntax: a locator with either identifier, or not 12 canonical characters, is 400 before any limit or lookup', async () => {
      at(AVAILABLE);
      const bad: Record<string, unknown>[] = [
        { locator: loc, vault_id: VID },
        { locator: loc, recovery_id: rid },
        { locator: loc, vault_id: VID, recovery_id: rid },
        { locator: loc.toLowerCase() === loc ? 'abcdefghjkmn' : loc.toLowerCase() },
        { locator: loc.slice(1) },
        { locator: `${loc}0` },
        { locator: `${loc.slice(0, 4)} ${loc.slice(4)}` },
        { locator: `U${loc.slice(1)}` },
        { locator: `I${loc.slice(1)}` },
        { locator: `O${loc.slice(1)}` },
        { locator: `L${loc.slice(1)}` },
        { locator: 12 },
        { locator: null },
      ];
      for (const b of bad) expect((await claim(b)).status).toBe(400);
      expect(rl('vault-recovery-claim')).toHaveLength(0);
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
      expect(audits('vault.recovery_locator_miss')).toHaveLength(0);
    });

    test('miss: 404 with the body of an unknown pair; nothing written to the recovery; no per-vault count', async () => {
      at(AVAILABLE);
      const unknownPair = await claim({ vault_id: VID, recovery_id: RID }, { vault: VID, ip: '2001:db8:9:9::1' });
      expect(unknownPair.status).toBe(404);
      const before = structuredClone(getItem('vaults', VID));
      const perVault = rl('vault-recovery-claim#').length;
      const miss = await claim({ locator: other(loc) });
      expect(miss).toEqual(unknownPair);
      expect(getItem('vaults', VID)).toEqual(before);
      expect(rl('vault-recovery-claim#')).toHaveLength(perVault);
      expect(locatorRows()).toHaveLength(1);
    });

    test('every miss does the same reads: the locator row, a vault row, a pointer row', async () => {
      at(AVAILABLE);
      const reads = async (body: Record<string, unknown>) => {
        const n = ddb.commandCalls(GetCommand).length;
        expect((await claim(body)).status).toBe(404);
        return ddb.commandCalls(GetCommand).slice(n).map((c) => c.args[0].input.TableName);
      };
      const unknown = await reads({ locator: other(loc) });
      // Stale: the row is there, its recovery was replaced.
      getItem('vaults', VID).recovery.recovery_id = RID;
      const stale = await reads({ locator: loc });
      expect(stale).toEqual(unknown);
      expect(unknown.filter((t) => t === 'requests')).toHaveLength(1);
      expect(unknown.filter((t) => t === 'vaults')).toHaveLength(2);
    });

    test('stale: the locator of a cancelled recovery, and of a replaced one, is 404', async () => {
      at(AVAILABLE);
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).body).toEqual({ cancelled: true });
      expect((await claim({ locator: loc }))).toMatchObject({ status: 404, body: { error: 'not_found' } });
      // Replaced by a new request (pending): the old locator stays a miss, the new one is not yet available.
      const rid2 = await request();
      answer(rid2);
      const loc2 = locatorOf();
      expect((await claim({ locator: loc })).status).toBe(404);
      expect((await claim({ locator: loc2 }))).toMatchObject({ status: 409, body: { error: 'recovery_not_available' } });
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
    });

    test('a miss too: an expired recovery, a deleted vault, a pointer that names another vault, a row of another shape', async () => {
      at(AVAILABLE);
      const row = getItem('requests', `recovery-locator#${loc}`);
      const saved = structuredClone(getItem('vaults', VID));
      getItem('vaults', VID).state = 'deleted';
      expect((await claim({ locator: loc })).status).toBe(404);
      put('vaults', structuredClone(saved));
      getItem('vaults', 'user#g1').current_vault_id = 'e'.repeat(32);
      expect((await claim({ locator: loc })).status).toBe(404);
      getItem('vaults', 'user#g1').current_vault_id = VID;
      tbl('vaults').delete(VID);
      expect((await claim({ locator: loc })).status).toBe(404);
      put('vaults', structuredClone(saved));
      row.op = 'recovery_cancel_link';
      expect((await claim({ locator: loc })).status).toBe(404);
      row.op = 'recovery_locator';
      // The recovery names another locator than the row's key.
      getItem('vaults', VID).recovery.locator = other(loc);
      expect((await claim({ locator: loc })).status).toBe(404);
      put('vaults', structuredClone(saved));
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
      // Past the recovery's expiry the row no longer counts, whether or not the TTL has removed it.
      at(NOW + 172_800);
      expect((await claim({ locator: loc }, { ip: '2001:db8:7:7::1' })).status).toBe(404);
    });

    test('not available: pending, refused by the enclave or registered → 409 recovery_not_available', async () => {
      expect((await claim({ locator: loc }))).toMatchObject({ status: 409, body: { error: 'recovery_not_available' } });
      at(AVAILABLE);
      getItem('vaults', VID).recovery.state = 'registered';
      expect((await claim({ locator: loc })).body).toMatchObject({ error: 'recovery_not_available' });
      getItem('vaults', VID).recovery.state = 'pending';
      Object.assign(getItem('requests', rid), { code: 'recovery_unavailable' });
      expect((await claim({ locator: loc })).body).toMatchObject({ error: 'recovery_not_available' });
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
    });

    test('an account that is not active: 403, as the scanned form', async () => {
      at(AVAILABLE);
      getItem('members', 'g1').account_status = 'canceled';
      const typed = await claim({ locator: loc });
      const scanned = await claim({ vault_id: VID, recovery_id: rid }, { vault: VID });
      expect(typed.status).toBe(403);
      expect(scanned).toEqual(typed);
    });

    test('paused: refused after the signature, before the body is read; nothing counted, looked up or written', async () => {
      at(AVAILABLE);
      paused();
      vaultService.resetVaultServiceCache();
      const gets = ddb.commandCalls(GetCommand).filter((c) => c.args[0].input.TableName === 'requests').length;
      for (const body of [{ locator: loc }, { locator: 'not a locator' }, { locator: loc, vault_id: VID }]) {
        const r = await claim(body);
        expect(r).toMatchObject({ status: 503, body: { error: 'vault_unavailable', service: 'paused' } });
      }
      expect(ddb.commandCalls(GetCommand).filter((c) => c.args[0].input.TableName === 'requests')).toHaveLength(gets);
      expect(rl('vault-recovery-claim')).toHaveLength(0);
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
      // A bad signature is still 401 while paused.
      expect((await claim({ locator: loc }, { vault: VID })).status).toBe(401);
    });

    test('the per-network limit comes before the lookup: 10 per 15 minutes, misses count, and it is the scanned form\'s bucket', async () => {
      at(AVAILABLE);
      for (let i = 0; i < 6; i++) expect((await claim({ locator: other(loc) })).status).toBe(404);
      // Scanned claims from the same network count in the same bucket.
      for (let i = 0; i < 4; i++) expect((await claim({ vault_id: VID, recovery_id: rid }, { vault: VID, key: keyOf(`net-${i}`) })).status).toBe(200);
      expect(rl('vault-recovery-claim-net#')).toHaveLength(1);
      const lookups = () => ddb.commandCalls(GetCommand).filter((c) => String(c.args[0].input.Key?.request_id).startsWith('recovery-locator#')).length;
      const n = lookups();
      // The 11th: refused before the lookup, even with the right locator.
      const r = await claim({ locator: loc });
      expect(r.status).toBe(429);
      expect(lookups()).toBe(n);
      expect((await claim({ vault_id: VID, recovery_id: rid }, { vault: VID })).status).toBe(429);
      // Another network is not affected: no limit is global.
      expect((await claim({ locator: loc }, { ip: '2001:db8:5:5::1' })).status).toBe(200);
      expect((await claim({ locator: loc }, { ip: '198.51.100.7' })).status).toBe(200);
    });

    test('the per-vault limit comes after a hit: 10 per day, shared with the scanned form; misses are charged to no vault', async () => {
      at(AVAILABLE);
      const net = (i: number) => `2001:db8:${(i + 16).toString(16)}:1::1`;
      for (let i = 0; i < 5; i++) expect((await claim({ locator: loc }, { key: keyOf(`pv-${i}`), ip: net(i) })).status).toBe(200);
      for (let i = 5; i < 10; i++) expect((await claim({ vault_id: VID, recovery_id: rid }, { vault: VID, key: keyOf(`pv-${i}`), ip: net(i) })).status).toBe(200);
      // Misses from anywhere do not move the vault's count.
      for (let i = 10; i < 14; i++) expect((await claim({ locator: other(loc) }, { ip: net(i) })).status).toBe(404);
      expect(rl('vault-recovery-claim#')).toEqual([expect.stringContaining(`vault-recovery-claim#${VID}#`)]);
      expect(getItem('rl', rl('vault-recovery-claim#')[0]).count).toBe(10);
      expect((await claim({ locator: loc }, { key: keyOf('pv-late'), ip: net(20) })).status).toBe(429);
      expect(getItem('vaults', VID).recovery.claim_keys).toHaveLength(10);
      // Another member's recovery is untouched by it.
      vaultOf('g2', { vault_id: 'e'.repeat(32), state: 'locked', sealed_release: R0 });
      at(NOW);
      const rid2 = await request('g2');
      answer(rid2);
      at(AVAILABLE);
      expect((await claim({ locator: locatorOf('e'.repeat(32)) }, { key: keyOf('pv-late'), ip: net(21) })).body).toMatchObject({ user_guid: 'g2', vault_id: 'e'.repeat(32), recovery_id: rid2 });
    });

    test('misses are audited per source network and hour at the 1st, 10th, 100th, never with the locator', async () => {
      at(AVAILABLE);
      const tried: string[] = [];
      for (let i = 0; i < 12; i++) {
        // Each 15-minute window allows 10: move on within the same hour.
        if (i === 10) at(AVAILABLE + 15 * 60);
        const l = other(loc).slice(0, 11) + '0123456789AB'[i];
        tried.push(l);
        const r = await claim({ locator: l });
        expect(r.status).toBe(404);
      }
      const misses = audits('vault.recovery_locator_miss');
      const expected = tried.filter((l) => l !== loc).length;
      expect(expected).toBeGreaterThanOrEqual(11);
      expect(misses.map((a) => a.detail)).toEqual([
        { network: '2001:0db8:0001:0002::/64', misses_this_hour: 1 },
        { network: '2001:0db8:0001:0002::/64', misses_this_hour: 10 },
      ]);
      const all = JSON.stringify([...tbl('audit').values()]) + logs.join('\n');
      for (const l of tried) expect(all).not.toContain(l);
    });
  });

  describe('the scanned form is unchanged', () => {
    test('a recovery without a locator (requested before 2.4.0) is claimed by its pair', async () => {
      const rid = await request();
      answer(rid);
      const loc = locatorOf();
      delete getItem('vaults', VID).recovery.locator;
      at(AVAILABLE);
      // Its row may still be there: without the locator on the recovery it names nothing.
      expect((await claim({ locator: loc })).status).toBe(404);
      const r = await claim({ vault_id: VID, recovery_id: rid }, { vault: VID });
      expect(r).toEqual({ status: 200, body: { user_guid: 'g1', email_hint: 'g***@x.org', vault_id: VID, recovery_id: rid } });
      // An unknown pair counts against the network only, never the vault it names, and audits no miss.
      const n = audits('vault.recovery_locator_miss').length;
      expect((await claim({ vault_id: VID, recovery_id: RID }, { vault: VID })).status).toBe(404);
      expect(getItem('rl', rl('vault-recovery-claim#')[0]).count).toBe(1);
      expect(audits('vault.recovery_locator_miss')).toHaveLength(n);
      // The body must still name the vault the request is signed for.
      expect((await claim({ vault_id: 'e'.repeat(32), recovery_id: rid }, { vault: VID })).status).toBe(400);
    });
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

  // MEMBER-API 2.8.0 "Staging time scale" (S14): the 24 h are divided by
  // the scale when the request is made, on staging only.
  describe('the staging time scale', () => {
    afterEach(() => {
      delete process.env.STAGE;
      delete process.env.TIME_SCALE;
    });
    const deletesAt = async () => {
      const r = await call('POST', '/api/vault/deletion', CONFIRM);
      expect(r.status).toBe(202);
      const row = getItem('vaults', VID).deletion;
      const link = [...tbl('requests').values()].find((x) => x.op === 'deletion_cancel_link')!;
      expect(r.body.deletes_at).toBe(iso(row.deletes_at));
      expect(link.expires_at).toBe(row.deletes_at);
      expect(mails()[0].text).toContain(`will be deleted at ${iso(row.deletes_at)}`);
      return row.deletes_at - row.requested_at;
    };

    test('staging at 1: 24 hours; the email has no note', async () => {
      Object.assign(process.env, { STAGE: 'staging', TIME_SCALE: '1' });
      expect(await deletesAt()).toBe(86_400);
      expect(mails()[0].text).not.toContain('Staging');
    });

    test('staging at 24: 1 hour (deletes_at, the cancel link and the email, which adds the note)', async () => {
      Object.assign(process.env, { STAGE: 'staging', TIME_SCALE: '24' });
      expect(await deletesAt()).toBe(3_600);
      expect(mails()[0].text.endsWith('\n\nStaging: 1 day = 1 hour.')).toBe(true);
    });

    test('TIME_SCALE outside staging is ignored: 24 hours', async () => {
      Object.assign(process.env, { STAGE: 'prod', TIME_SCALE: '24' });
      expect(await deletesAt()).toBe(86_400);
    });

    test('a deletion requested before the scale changed keeps its time', async () => {
      expect(await deletesAt()).toBe(86_400);
      Object.assign(process.env, { STAGE: 'staging', TIME_SCALE: '24' });
      expect((await call('GET', '/api/vault/deletion')).body.deletion.deletes_at).toBe(iso(NOW + 86_400));
    });
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

// A suspended (or canceled) account keeps the cancels and gains nothing else.
describe('an account that is not active: the cancels stay, nothing else opens', () => {
  const BK = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
  const CONFIRM = { confirm: 'delete my vault' };
  const mails = () => sesMock.commandCalls(SendEmailCommand).map((c) => ({
    to: c.args[0].input.Destination!.ToAddresses![0],
    subject: c.args[0].input.Content!.Simple!.Subject!.Data!,
    text: c.args[0].input.Content!.Simple!.Body!.Text!.Data!,
  }));
  const audits = (action: string) => [...tbl('audit').values()].filter((a) => a.action === action);
  const noSession = { headers: {}, guid: 'nobody' };
  const app = () => ({ key: keyOf('g1'), vault: VID });
  const setStatus = (account_status: string) => void (getItem('members', 'g1').account_status = account_status);

  beforeEach(() => {
    release(R0, 4);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0, credential_backup: true, app_key: { key: keyOf('g1').b64, kid: keyOf('g1').kid, seq: 1 } });
  });

  describe.each(['suspended', 'canceled'])('%s', (status) => {
    test('a pending vault deletion is cancelled from the session: removed, mailed, audited', async () => {
      const id = (await call('POST', '/api/vault/deletion', CONFIRM)).body.deletion_id;
      setStatus(status);
      expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: id })).toEqual({ status: 200, body: { cancelled: true } });
      expect(getItem('vaults', VID).deletion).toBeUndefined();
      expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: id })).toEqual({ status: 200, body: { cancelled: false } });
      expect(mails().filter((m) => m.subject === 'VettID vault deletion cancelled')).toHaveLength(1);
      expect(audits('vault.deletion_cancel').map((a) => a.detail.via)).toEqual(['session']);
    });

    test("a pending vault deletion is cancelled by the vault's app key; another key is still 401", async () => {
      const id = (await call('POST', '/api/vault/deletion', CONFIRM)).body.deletion_id;
      setStatus(status);
      expect((await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { app: { key: keyOf('stranger'), vault: VID } })).status).toBe(401);
      expect(getItem('vaults', VID).deletion.state).toBe('pending');
      expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { app: app() })).toEqual({ status: 200, body: { cancelled: true } });
      expect(getItem('vaults', VID).deletion).toBeUndefined();
      expect(audits('vault.deletion_cancel')[0].detail).toMatchObject({ via: 'app', kid: keyOf('g1').kid });
    });

    test('a pending vault deletion is cancelled by the email link, without a session', async () => {
      await call('POST', '/api/vault/deletion', CONFIRM);
      const token = /deletion\/cancel#t=([A-Za-z0-9_-]{43})/.exec(mails()[0].text)![1];
      setStatus(status);
      expect(await call('POST', '/api/vault/deletion/cancel-link', { token }, noSession)).toEqual({ status: 200, body: { cancelled: true } });
      expect(getItem('vaults', VID).deletion).toBeUndefined();
      expect(audits('vault.deletion_cancel').map((a) => a.detail.via)).toEqual(['link']);
    });

    test('a pending recovery is cancelled from the session and the enclave is told; the email link works too', async () => {
      const rid = (await call('POST', '/api/vault/recovery', { browser_key: BK })).body.recovery_id;
      const token = /recovery\/cancel#t=([A-Za-z0-9_-]{43})/.exec(mails()[0].text)![1];
      setStatus(status);
      expect(await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).toEqual({ status: 200, body: { cancelled: true } });
      expect(getItem('vaults', VID).recovery.state).toBe('cancelled');
      expect(sent().map((m) => m.msg.op)).toEqual(['recovery', 'recovery_cancel']);
      expect(mails().filter((m) => m.subject === 'VettID vault recovery cancelled')).toHaveLength(1);
      expect(audits('vault.recovery_cancel').map((a) => a.detail.via)).toEqual(['session']);
      // The link of a second recovery, made while the account was active again.
      setStatus('active');
      jest.spyOn(Date, 'now').mockReturnValue((NOW + 10) * 1000);
      await call('POST', '/api/vault/recovery', { browser_key: BK });
      const token2 = /recovery\/cancel#t=([A-Za-z0-9_-]{43})/.exec(mails().filter((m) => m.subject === 'VettID vault recovery requested')[1].text)![1];
      expect(token2).not.toBe(token);
      setStatus(status);
      expect(await call('POST', '/api/vault/recovery/cancel-link', { token: token2 }, noSession)).toEqual({ status: 200, body: { cancelled: true } });
      expect(getItem('vaults', VID).recovery.state).toBe('cancelled');
    });

    // The checks below are the only guards left on the two cancel routes now
    // that the account's status is not one of them.
    describe('a cancel still needs the session or the key of the account it is for', () => {
      const VID2 = 'e'.repeat(32);
      let id: string;
      let rid: string;
      const intact = () => {
        expect(getItem('vaults', VID).deletion).toMatchObject({ deletion_id: id, state: 'pending' });
        expect(audits('vault.deletion_cancel')).toHaveLength(0);
        expect(mails().filter((m) => m.subject === 'VettID vault deletion cancelled')).toHaveLength(0);
      };

      beforeEach(async () => {
        // g2 is another member, active, with a vault and an app key of their own.
        vaultOf('g2', { vault_id: VID2, state: 'locked', sealed_release: R0, app_key: { key: keyOf('g2').b64, kid: keyOf('g2').kid, seq: 1 } });
        id = (await call('POST', '/api/vault/deletion', CONFIRM)).body.deletion_id;
        setStatus(status);
      });

      test("another member's session: their own vault has no such deletion ({cancelled: false}); nothing of g1's is touched", async () => {
        expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { guid: 'g2' })).toEqual({ status: 200, body: { cancelled: false } });
        intact();
      });

      test("another member's app key: signed for their own vault it finds no such deletion; signed for g1's vault it is 401", async () => {
        expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { app: { key: keyOf('g2'), vault: VID2 } })).toEqual({ status: 200, body: { cancelled: false } });
        expect((await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { app: { key: keyOf('g2'), vault: VID } })).status).toBe(401);
        intact();
      });

      test('a session that names no member: 403', async () => {
        expect((await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { guid: 'nobody' })).status).toBe(403);
        intact();
      });

      test("a session whose address is not the member row's (the address changed hands): 403 on both cancels", async () => {
        getItem('members', 'g1').email = 'someone-else@x.org'; // the session still says g1@x.org
        expect((await call('POST', '/api/vault/deletion/cancel', { deletion_id: id })).status).toBe(403);
        expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: RID })).status).toBe(403);
        intact();
      });

      test("a pointer that names somebody else's vault gives no access to it (the vault row's owner is checked)", async () => {
        put('vaults', { vault_id: 'user#g2', current_vault_id: VID });
        expect(await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { guid: 'g2' })).toEqual({ status: 200, body: { cancelled: false } });
        intact();
      });

      test("a link row that names another member for this vault cancels nothing (404): the link's member must own the vault", async () => {
        const token = 'L'.repeat(43);
        put('requests', { request_id: `dcancel#${createHash('sha256').update(token).digest('hex')}`, vault_id: VID, user_guid: 'g2', op: 'deletion_cancel_link', status: 'link', deletion_id: id, expires_at: NOW + 3600 });
        expect((await call('POST', '/api/vault/deletion/cancel-link', { token }, noSession)).status).toBe(404);
        intact();
      });

      test("only the vault's app key: a pending key and a recovery's claim key are 401", async () => {
        const pendingKey = keyOf('pending-phone');
        getItem('vaults', VID).app_key_pending = { key: pendingKey.b64, kid: pendingKey.kid, until: NOW + 3600 };
        expect((await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { app: { key: pendingKey, vault: VID } })).status).toBe(401);
        const claimKey = keyOf('claim-phone');
        getItem('vaults', VID).recovery = { recovery_id: RID, state: 'pending', requested_at: NOW - 90_000, available_at: NOW - 3600, expires_at: NOW + 82_800, claim_keys: [{ key: claimKey.b64, kid: claimKey.kid }] };
        expect((await call('POST', '/api/vault/deletion/cancel', { deletion_id: id }, { app: { key: claimKey, vault: VID } })).status).toBe(401);
        intact();
      });

      test("a recovery: another member's session finds no such recovery (404), also through a pointer that names this vault; a link row for another member is 404", async () => {
        setStatus('active');
        getItem('vaults', VID).deletion = undefined;
        rid = (await call('POST', '/api/vault/recovery', { browser_key: BK })).body.recovery_id;
        setStatus(status);
        expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid }, { guid: 'g2' })).status).toBe(404);
        put('vaults', { vault_id: 'user#g2', current_vault_id: VID });
        expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid }, { guid: 'g2' })).status).toBe(404);
        const token = 'R'.repeat(43);
        put('requests', { request_id: `rcancel#${createHash('sha256').update(token).digest('hex')}`, vault_id: VID, user_guid: 'g2', op: 'recovery_cancel_link', status: 'link', recovery_id: rid, expires_at: NOW + 3600 });
        expect((await call('POST', '/api/vault/recovery/cancel-link', { token }, noSession)).status).toBe(404);
        expect(getItem('vaults', VID).recovery).toMatchObject({ recovery_id: rid, state: 'pending' });
        expect(audits('vault.recovery_cancel')).toHaveLength(0);
      });
    });

    test('nothing else opens: no request, no status, no code, no recovery step', async () => {
      const id = (await call('POST', '/api/vault/deletion', CONFIRM)).body.deletion_id;
      setStatus(status);
      const before = sent().length;
      for (const [method, path, body, opts] of [
        ['POST', '/api/vault/deletion', CONFIRM],
        ['GET', '/api/vault/deletion'],
        ['GET', '/api/vault/status'],
        ['GET', '/api/vault/status', undefined, { app: app() }],
        ['GET', `/api/vault/requests/${RID}`],
        ['GET', `/api/vault/requests/${RID}`, undefined, { app: app() }],
        ['POST', '/api/vault/recovery', { browser_key: BK }],
        ['GET', '/api/vault/recovery'],
        ['POST', '/api/vault/enroll-code', {}],
        ['GET', '/api/vault/enroll-code'],
        ['DELETE', '/api/vault/enroll-code'],
        ['GET', '/api/vault/enclave', undefined, { app: app() }],
        ['POST', '/api/vault/unlock', { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA }, { app: app() }],
      ] as [string, string, unknown?, EvOpts?][]) {
        const r = await call(method, path, body, opts);
        expect({ method, path, via: opts ? 'app' : 'session', status: r.status }).toEqual({ method, path, via: opts ? 'app' : 'session', status: 403 });
      }
      expect(sent()).toHaveLength(before);
      expect(getItem('vaults', VID).deletion).toMatchObject({ deletion_id: id, state: 'pending' });
      expect(audits('vault.deletion_request')).toHaveLength(1);
    });

    test('a recovery asked for before is blocked, not stopped: its code is not released and a new app can neither claim it nor register; its clock runs on', async () => {
      const rid = (await call('POST', '/api/vault/recovery', { browser_key: BK })).body.recovery_id;
      Object.assign(getItem('requests', rid), { status: 'done', envelope: Buffer.alloc(5_252, 3).toString('base64') });
      jest.spyOn(Date, 'now').mockReturnValue((NOW + 86_400 + 5) * 1000);
      for (const i of tbl('instances').values()) i.heartbeat_at = NOW + 86_400;
      setStatus(status);
      expect((await call('GET', '/api/vault/recovery')).status).toBe(403);
      const phone = keyOf('new-phone');
      const claim = await call('POST', '/api/vault/recovery/claim', { vault_id: VID, recovery_id: rid, app_key: phone.b64 }, { app: { key: phone, vault: VID }, guid: 'nobody' });
      expect(claim.status).toBe(403);
      expect(getItem('vaults', VID).recovery.claim_keys).toBeUndefined();
      expect(audits('vault.recovery_code_released')).toHaveLength(0);
      expect(getItem('requests', rid).released).toBeUndefined();
      // A key that had claimed the recovery before the account stopped being active cannot register either.
      getItem('vaults', VID).recovery.claim_keys = [{ key: phone.b64, kid: phone.kid }];
      const before = sent().length;
      const reg = await call('POST', '/api/vault/recovery/register', { vault_id: VID, request_id: RID2, instance_id: 'i-1', etk_kid: KID, envelope: ENV }, { app: { key: phone, vault: VID }, guid: 'nobody' });
      expect(reg.status).toBe(403);
      expect(sent()).toHaveLength(before);
      expect(getItem('requests', RID2)).toBeUndefined();
      // Nothing was paused: the recovery is the same record with the same times, and it is usable again once the account is active.
      expect(getItem('vaults', VID).recovery).toMatchObject({ recovery_id: rid, state: 'pending', available_at: NOW + 86_400, expires_at: NOW + 172_800 });
      setStatus('active');
      expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ recovery_id: rid, state: 'available', sealed_code: expect.any(String) });
    });
  });
});

// ---- release R (MEMBER-API 2.7.0, VAULT-MESSAGING 0.33.0 §11.14) ---------------------------

describe('2.7.0: recovery from release R', () => {
  const BK = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
  const BK_RAW = Buffer.from(BK, 'base64');
  const newApp = keyOf('r-new-phone');
  const oldApp = keyOf('r-old-phone');
  const signed = { app: { key: newApp, vault: VID } };
  const audits = (action: string) => [...tbl('audit').values()].filter((a) => a.action === action);
  const mails = () => sesMock.commandCalls(SendEmailCommand).map((c) => ({
    subject: c.args[0].input.Content!.Simple!.Subject!.Data!, text: c.args[0].input.Content!.Simple!.Body!.Text!.Data!,
  }));
  const at = (s: number) => {
    jest.spyOn(Date, 'now').mockReturnValue(s * 1000);
    for (const i of tbl('instances').values()) i.heartbeat_at = s - 10;
  };
  const isoS = (s: number) => new Date(s * 1000).toISOString();
  const H = 3600;
  const DAY = 86_400;
  /** What the enclave verifies (vettid-vault enclave/recoverysig.go), built here independently of the API's code. */
  const verifies = (msg: any, browserKey?: Buffer) => {
    const last = browserKey ? createHash('sha256').update(browserKey).digest('hex') : '';
    const s = ['vettid/vms/2/recovery-request', msg.op, msg.vault_id, msg.user_guid, msg.request_id, msg.signed_at, last].join('\n');
    return cryptoVerify('sha256', Buffer.from(s), { key: RRK.pub, dsaEncoding: 'der' }, Buffer.from(msg.sig, 'base64'));
  };
  const request = async () => {
    const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
    expect(r.status).toBe(202);
    return r.body.recovery_id as string;
  };
  /** The enclave's answer into the recovery's own slot (release R: with its clear times). */
  const answer = (rid: string, extra: Record<string, unknown> = {}) =>
    Object.assign(getItem('requests', rid), { status: 'done', envelope: Buffer.alloc(5_252, 0x33).toString('base64'), ...extra });
  /** A recovery already registered to newApp (as markRegistered leaves it). */
  const registered = (extra: Record<string, unknown> = {}) => {
    const v = getItem('vaults', VID);
    v.recovery = {
      recovery_id: RID, state: 'registered', requested_at: NOW - 3 * DAY, available_at: NOW - 2 * DAY + 60, expires_at: NOW + DAY - 60, locator: 'ABCDEFGHJKMN',
      claim_keys: [{ key: newApp.b64, kid: newApp.kid }], recovering_key: { key: newApp.b64, kid: newApp.kid }, cancel_key: 'c'.repeat(64), ...extra,
    };
    put('requests', { request_id: `recovery-locator#ABCDEFGHJKMN`, vault_id: VID, op: 'recovery_locator', status: 'locator', recovery_id: RID, expires_at: NOW + DAY - 60 });
    put('requests', { request_id: `rcancel#${'c'.repeat(64)}`, vault_id: VID, user_guid: 'g1', op: 'recovery_cancel_link', status: 'link', recovery_id: RID, expires_at: NOW + DAY - 60 });
  };
  const OPEN = { vault_id: VID, request_id: RID2, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
  const open = (body: Record<string, unknown> = OPEN, opts: EvOpts = signed) => call('POST', '/api/vault/recovery/open', body, opts);

  beforeEach(() => {
    release(R0, 14);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0, app_key: { key: oldApp.b64, kid: oldApp.kid, seq: 1 } });
  });

  describe('signed recovery and recovery_cancel (§11.14.8)', () => {
    test('the request is signed over its own members (op, vault, member, request id, signed_at, SHA-256 of the raw browser key)', async () => {
      const rid = await request();
      const [m] = sent();
      expect(m.msg).toMatchObject({ op: 'recovery', request_id: rid, signed_at: '2026-10-02T12:00:00Z', key_id: process.env.RECOVERY_REQUEST_KEY_ID });
      expect(verifies(m.msg, BK_RAW)).toBe(true);
      // Mutation-minded: the same signature fails over any other member, or over the base64 instead of the raw point.
      expect(verifies({ ...m.msg, vault_id: 'e'.repeat(32) }, BK_RAW)).toBe(false);
      expect(verifies({ ...m.msg, op: 'recovery_cancel' }, BK_RAW)).toBe(false);
      expect(verifies(m.msg, Buffer.from(BK))).toBe(false);
      expect(verifies(m.msg)).toBe(false);
      // The digest KMS was asked to sign, nothing else.
      const [k] = kms.commandCalls(SignCommand);
      expect(k.args[0].input).toMatchObject({ KeyId: process.env.RECOVERY_REQUEST_KEY_ARN, MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256' });
      expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'browser_key', 'signed_at', 'key_id', 'sig', 'enqueued_at']);
    });

    test('a cancel (session and link) is signed with an empty last line and its own request id', async () => {
      const rid = await request();
      const token = /cancel#t=([A-Za-z0-9_-]{43})/.exec(mails()[0].text)![1];
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).body).toEqual({ cancelled: true });
      const c = sent().pop()!;
      expect(c.msg).toMatchObject({ op: 'recovery_cancel', signed_at: '2026-10-02T12:00:00Z', key_id: process.env.RECOVERY_REQUEST_KEY_ID });
      expect(c.msg.request_id).not.toBe(rid);
      expect(c.msg.browser_key).toBeUndefined();
      expect(verifies(c.msg)).toBe(true);
      expect(verifies(c.msg, BK_RAW)).toBe(false);
      // The link of a later recovery: also signed.
      const rid2 = await request();
      const token2 = /cancel#t=([A-Za-z0-9_-]{43})/.exec(mails().pop()!.text)![1];
      expect(token2).not.toBe(token);
      expect((await call('POST', '/api/vault/recovery/cancel-link', { token: token2 }, { guid: 'nobody' })).body).toEqual({ cancelled: true });
      const c2 = sent().pop()!;
      expect(c2.msg.op).toBe('recovery_cancel');
      expect(verifies(c2.msg)).toBe(true);
      expect(rid2).not.toBe(rid);
    });

    test('KMS cannot sign: the request is 503 and leaves nothing (no recovery, locator, link, queue message or mail), and is not counted', async () => {
      kmsDown = true;
      const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
      expect(r).toMatchObject({ status: 503, body: { error: 'vault_unavailable', retry_after: 60 } });
      expect(getItem('vaults', VID).recovery).toBeUndefined();
      expect([...tbl('requests').values()]).toEqual([]);
      expect(sent()).toHaveLength(0);
      expect(mails()).toHaveLength(0);
      expect(audits('vault.recovery_request')).toHaveLength(0);
      // Signed before the limit is counted: a KMS outage does not use up the member's three a day.
      expect(getItem('rl', `vault-recovery#g1#${NOW - (NOW % DAY)}`)).toBeUndefined();
    });

    test('KMS cannot sign a cancel: the recovery is cancelled at the API and mailed; nothing unsigned is queued', async () => {
      const rid = await request();
      kmsDown = true;
      expect((await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).body).toEqual({ cancelled: true });
      expect(getItem('vaults', VID).recovery.state).toBe('cancelled');
      expect(sent().map((m) => m.msg.op)).toEqual(['recovery']);
      expect(mails().map((m) => m.subject)).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled']);
      expect(logs.join('\n')).toContain('recovery cancel not queued');
    });

    test('N2: a looser 10-an-hour limit before signing, so a burst never reaches KMS; the 3 a day stay after it', async () => {
      kmsDown = true;
      for (let i = 0; i < 10; i++) expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(503);
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).status).toBe(429);
      expect(kms.commandCalls(SignCommand)).toHaveLength(10);
      expect(getItem('rl', `vault-recovery#g1#${NOW - (NOW % DAY)}`)).toBeUndefined();
    });

    test('the request email says "at the earliest", the three days and the ten attempts', async () => {
      await request();
      const t = mails()[0].text;
      expect(t).toContain(`${isoS(NOW + DAY)} at the earliest`);
      expect(t).toMatch(/three days after its app was last used/);
      expect(t).toMatch(/ten attempts in all/);
      expect(t).toMatch(/cancel#t=[A-Za-z0-9_-]{43}/);
    });
  });

  describe("the enclave's times in the recovery's own slot (§11.14.5)", () => {
    test('not_before and expires become available_at and expires_at; earliest goes; the code waits for them; the rows that live with the recovery follow', async () => {
      const rid = await request();
      const locator = getItem('vaults', VID).recovery.locator;
      const cancelKey = getItem('vaults', VID).recovery.cancel_key;
      expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ state: 'pending', earliest: true, available_at: isoS(NOW + DAY) });
      answer(rid, { not_before: isoS(NOW + 72 * H), expires: isoS(NOW + 96 * H) });
      const g = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(g).toMatchObject({ state: 'pending', available_at: isoS(NOW + 72 * H), expires_at: isoS(NOW + 96 * H) });
      expect(g.earliest).toBeUndefined();
      expect(getItem('vaults', VID).recovery).toMatchObject({ available_at: NOW + 72 * H, expires_at: NOW + 96 * H, enclave_times: true });
      expect(getItem('vaults', VID).recovery.earliest).toBeUndefined();
      expect(getItem('requests', rid).expires_at).toBe(NOW + 96 * H + H);
      expect(getItem('requests', `recovery-locator#${locator}`).expires_at).toBe(NOW + 96 * H);
      expect(getItem('requests', `rcancel#${cancelKey}`).expires_at).toBe(NOW + 96 * H);
      // At the old 24 hours: still pending, no code, nothing claimable.
      at(NOW + DAY + 5);
      const p = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(p.state).toBe('pending');
      expect(p.sealed_code).toBeUndefined();
      expect(audits('vault.recovery_code_released')).toHaveLength(0);
      at(NOW + 72 * H);
      expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ state: 'available', sealed_code: expect.any(String) });
      at(NOW + 96 * H);
      expect((await call('GET', '/api/vault/recovery')).body.recovery.state).toBe('expired');
    });

    test('a claim before the enclave time is refused even if nobody read the status (the claim applies the times itself)', async () => {
      const rid = await request();
      answer(rid, { not_before: isoS(NOW + 72 * H), expires: isoS(NOW + 96 * H) });
      at(NOW + DAY + 5);
      const r = await call('POST', '/api/vault/recovery/claim', { vault_id: VID, recovery_id: rid, app_key: newApp.b64 }, { app: { key: newApp, vault: VID }, guid: 'nobody' });
      expect(r.body.error).toBe('recovery_not_available');
      expect(getItem('vaults', VID).recovery.available_at).toBe(NOW + 72 * H);
    });

    test("the enclave's earliest keeps the estimate marked", async () => {
      const rid = await request();
      answer(rid, { not_before: isoS(NOW + 72 * H), expires: isoS(NOW + 96 * H), earliest: true });
      expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ available_at: isoS(NOW + 72 * H), earliest: true });
      expect(getItem('vaults', VID).recovery.earliest).toBe(true);
    });

    test('the API keeps its floor (never before request + 24 h, open at least 24 h) and its cap (130 days)', async () => {
      const rid = await request();
      answer(rid, { not_before: isoS(NOW + H), expires: isoS(NOW + 2 * H) });
      await call('GET', '/api/vault/recovery');
      expect(getItem('vaults', VID).recovery).toMatchObject({ available_at: NOW + DAY, expires_at: NOW + 2 * DAY });
      // Another vault: a far expiry is capped.
      vaultOf('g2', { vault_id: 'e'.repeat(32), state: 'locked', sealed_release: R0 });
      const r2 = (await call('POST', '/api/vault/recovery', { browser_key: BK }, { guid: 'g2' })).body.recovery_id;
      answer(r2, { not_before: isoS(NOW + 72 * H), expires: isoS(NOW + 400 * DAY) });
      await call('GET', '/api/vault/recovery', undefined, { guid: 'g2' });
      expect(getItem('vaults', 'e'.repeat(32)).recovery.expires_at).toBe(NOW + vault.RECOVERY_MAX_SPAN_S);
      expect(vault.RECOVERY_MAX_SPAN_S).toBe(130 * DAY);
    });

    test('F3: a not_before past the cap is shown as the enclave gave it; the recovery ends at the cap without becoming available', async () => {
      const rid = await request();
      answer(rid, { not_before: isoS(NOW + 200 * DAY), expires: isoS(NOW + 201 * DAY) });
      const g = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(g).toMatchObject({ state: 'pending', available_at: isoS(NOW + 200 * DAY), expires_at: isoS(NOW + vault.RECOVERY_MAX_SPAN_S) });
      at(NOW + vault.RECOVERY_MAX_SPAN_S);
      const e = (await call('GET', '/api/vault/recovery')).body.recovery;
      expect(e.state).toBe('expired');
      expect(e.sealed_code).toBeUndefined();
    });

    test('applied once: a later change of the slot moves nothing', async () => {
      const rid = await request();
      answer(rid, { not_before: isoS(NOW + 72 * H), expires: isoS(NOW + 96 * H) });
      await call('GET', '/api/vault/recovery');
      Object.assign(getItem('requests', rid), { not_before: isoS(NOW + 30 * H), expires: isoS(NOW + 54 * H) });
      await call('GET', '/api/vault/recovery');
      expect(getItem('vaults', VID).recovery).toMatchObject({ available_at: NOW + 72 * H, expires_at: NOW + 96 * H });
    });

    test('a release before R (no times in the slot) and malformed times: the API\'s own times stand, still marked earliest', async () => {
      const rid = await request();
      answer(rid);
      await call('GET', '/api/vault/recovery');
      expect(getItem('vaults', VID).recovery).toMatchObject({ available_at: NOW + DAY, expires_at: NOW + 2 * DAY, earliest: true });
      Object.assign(getItem('requests', rid), { not_before: 'tomorrow', expires: isoS(NOW + 96 * H) });
      await call('GET', '/api/vault/recovery');
      expect(getItem('vaults', VID).recovery.enclave_times).toBeUndefined();
      expect(vault.slotTime('2026-10-05T12:00:00Z')).toBe(Date.UTC(2026, 9, 5, 12) / 1000);
      expect(vault.slotTime('2026-10-05T12:00:00.4Z')).toBe(Date.UTC(2026, 9, 5, 12) / 1000 + 1); // rounded up, never earlier
      for (const bad of ['2026-10-05', '2026-10-05 12:00:00Z', 1_760_000_000, null, '']) expect(vault.slotTime(bad)).toBeNull();
    });
  });

  // MEMBER-API 2.8.0 "Staging time scale" (S5, S6): the estimates of POST
  // /api/vault/recovery and the API's floors are divided by the scale on
  // staging only, and only for a vault on a release that ships `time_scale`
  // (TIME_SCALE_FROM_RELEASE; this block's vault is on release 14). The
  // request email states the scaled durations, staging's own attempt waits
  // and the note.
  describe('the staging time scale', () => {
    const ON = { STAGE: 'staging', TIME_SCALE: '24', TIME_SCALE_FROM_RELEASE: '14' };
    afterEach(() => {
      delete process.env.STAGE;
      delete process.env.TIME_SCALE;
      delete process.env.TIME_SCALE_FROM_RELEASE;
    });
    const estimates = async () => {
      const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
      expect(r.status).toBe(202);
      const row = getItem('vaults', VID).recovery;
      expect(r.body).toMatchObject({ available_at: isoS(row.available_at), expires_at: isoS(row.expires_at), earliest: true });
      expect(getItem('requests', `rcancel#${row.cancel_key}`).expires_at).toBe(row.expires_at);
      expect(getItem('requests', `recovery-locator#${row.locator}`).expires_at).toBe(row.expires_at);
      return { rid: r.body.recovery_id as string, row, available: row.available_at - NOW, expires: row.expires_at - NOW, mail: mails().find((m) => m.subject === 'VettID vault recovery requested')!.text };
    };
    const PROD_WAITS = 'After the first two, each wrong attempt is followed by a wait, which starts at one day and grows to thirty days.';

    test('production (no STAGE): request + 24 h and + 48 h; the email reads as before', async () => {
      const e = await estimates();
      expect([e.available, e.expires]).toEqual([DAY, 2 * DAY]);
      expect(e.row.time_scale).toBeUndefined();
      expect(e.mail).toContain('at the earliest, for 24 hours. The time can be later: a vault cannot be recovered until three days after');
      expect(e.mail).toContain(PROD_WAITS);
      expect(e.mail).not.toContain('Staging');
    });

    test('staging at 1: request + 24 h and + 48 h, no note', async () => {
      Object.assign(process.env, { ...ON, TIME_SCALE: '1' });
      const e = await estimates();
      expect([e.available, e.expires]).toEqual([DAY, 2 * DAY]);
      expect(e.mail).toContain(PROD_WAITS);
      expect(e.mail).not.toContain('Staging');
    });

    test('staging at 24, a release that ships time_scale: request + 1 h and + 2 h, still earliest; the email says 1 hour, 3 hours, staging\'s attempt waits and the note', async () => {
      Object.assign(process.env, ON);
      const e = await estimates();
      expect([e.available, e.expires]).toEqual([H, 2 * H]);
      expect(e.row.time_scale).toBe(24);
      expect(e.mail).toContain('at the earliest, for 1 hour. The time can be later: a vault cannot be recovered until 3 hours after');
      // The attempt waits W(k) are not divided by the scale (STAGING-TIME-SCALE §2.1, T6): staging's own values, never "one day".
      expect(e.mail).not.toContain('one day');
      expect(e.mail).toContain("each wrong attempt is followed by a wait, which starts at 10 minutes and grows to 5 hours (staging's own waits, not divided by the time scale).");
      expect(e.mail.endsWith('\n\nStaging: 1 day = 1 hour.')).toBe(true);
    });

    test('staging at 24, a vault on a release before the one that ships time_scale: real time, the email as in production', async () => {
      Object.assign(process.env, { ...ON, TIME_SCALE_FROM_RELEASE: '15' });
      const e = await estimates();
      expect([e.available, e.expires]).toEqual([DAY, 2 * DAY]);
      expect(e.row.time_scale).toBeUndefined();
      expect(e.mail).toContain(PROD_WAITS);
      expect(e.mail).not.toContain('Staging');
    });

    test('staging at 24 without TIME_SCALE_FROM_RELEASE: real time', async () => {
      Object.assign(process.env, { STAGE: 'staging', TIME_SCALE: '24' });
      expect((await estimates()).available).toBe(DAY);
    });

    test('staging at 24: the floors are 1 h and 1 h; the enclave\'s later times win', async () => {
      Object.assign(process.env, ON);
      const { rid } = await estimates();
      answer(rid, { not_before: isoS(NOW + 600), expires: isoS(NOW + 1200) });
      await call('GET', '/api/vault/recovery');
      expect(getItem('vaults', VID).recovery).toMatchObject({ available_at: NOW + H, expires_at: NOW + 2 * H, enclave_times: true });
      vaultOf('g2', { vault_id: 'e'.repeat(32), state: 'locked', sealed_release: R0 });
      const r2 = (await call('POST', '/api/vault/recovery', { browser_key: BK }, { guid: 'g2' })).body.recovery_id;
      answer(r2, { not_before: isoS(NOW + 3 * H), expires: isoS(NOW + 4 * H) });
      await call('GET', '/api/vault/recovery', undefined, { guid: 'g2' });
      expect(getItem('vaults', 'e'.repeat(32)).recovery).toMatchObject({ available_at: NOW + 3 * H, expires_at: NOW + 4 * H });
    });

    test('a recovery requested before the scale turned on keeps its times, its floors included', async () => {
      const { rid } = await estimates();
      Object.assign(process.env, ON);
      expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ available_at: isoS(NOW + DAY), expires_at: isoS(NOW + 2 * DAY) });
      answer(rid, { not_before: isoS(NOW + 600), expires: isoS(NOW + 1200) });
      await call('GET', '/api/vault/recovery');
      expect(getItem('vaults', VID).recovery).toMatchObject({ available_at: NOW + DAY, expires_at: NOW + 2 * DAY, enclave_times: true });
    });

    test('TIME_SCALE outside staging is ignored', async () => {
      Object.assign(process.env, { ...ON, STAGE: 'prod' });
      const e = await estimates();
      expect([e.available, e.expires]).toEqual([DAY, 2 * DAY]);
      expect(e.mail).not.toContain('Staging');
    });
  });

  describe('a refused recovery and its reason (§11.14.13)', () => {
    test('not_offered: unavailable with the reason, audited with it; an unknown reason is not passed on', async () => {
      const rid = await request();
      answer(rid, { code: 'recovery_unavailable', reason: 'not_offered' });
      expect((await call('GET', '/api/vault/recovery')).body.recovery).toMatchObject({ state: 'unavailable', reason: 'not_offered', sealed_code: expect.any(String) });
      expect(audits('vault.recovery_unavailable')[0].detail).toEqual({ vault_id: VID, recovery_id: rid, reason: 'not_offered' });
      vaultOf('g2', { vault_id: 'e'.repeat(32), state: 'locked', sealed_release: R0 });
      const r2 = (await call('POST', '/api/vault/recovery', { browser_key: BK }, { guid: 'g2' })).body.recovery_id;
      answer(r2, { code: 'recovery_unavailable', reason: 'because' });
      const g2 = (await call('GET', '/api/vault/recovery', undefined, { guid: 'g2' })).body.recovery;
      expect(g2.state).toBe('unavailable');
      expect(g2.reason).toBeUndefined();
    });
  });

  describe('POST /api/vault/recovery/open (§11.14.6)', () => {
    beforeEach(() => registered());

    test('signed by the recovering key while registered: queued as recovery_open with that key, the manifest hash and nothing else; audited without an outcome', async () => {
      const r = await open();
      expect(r).toEqual({ status: 202, body: { vault_id: VID, request_id: RID2 } });
      const [m] = sent();
      expect(m.url).toBe(QUEUE_PREFIX + 'i-1');
      expect(Object.keys(m.msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'etk_kid', 'envelope', 'manifest_sha256', 'app_key', 'enqueued_at']);
      expect(m.msg).toMatchObject({ v: 1, op: 'recovery_open', vault_id: VID, user_guid: 'g1', request_id: RID2, etk_kid: KID, envelope: ENV, manifest_sha256: MSHA, app_key: newApp.b64 });
      expect(getItem('requests', RID2)).toMatchObject({ op: 'recovery_open', status: 'queued', recovery_id: RID, app_kid: newApp.kid, instance_id: 'i-1' });
      expect(getItem('vaults', VID).recovery.open_ids).toEqual([RID2]);
      const [a] = audits('vault.recovery_open');
      expect(a.detail).toEqual({ vault_id: VID, recovery_id: RID, request_id: RID2, instance_id: 'i-1' });
      expect(kms.commandCalls(SignCommand)).toHaveLength(0); // opens are the phone's, sealed; the API signs nothing here
    });

    test('only the recovering key: a claim key, the old app key, a session or an unsigned call are refused, nothing queued', async () => {
      const claimOnly = keyOf('r-claim-only');
      getItem('vaults', VID).recovery.claim_keys.push({ key: claimOnly.b64, kid: claimOnly.kid });
      expect((await open(OPEN, { app: { key: claimOnly, vault: VID } })).status).toBe(401);
      expect((await open({ ...OPEN, request_id: RID }, { app: { key: oldApp, vault: VID } })).status).toBe(401);
      expect((await open(OPEN, {})).status).toBe(401);
      expect(sent()).toHaveLength(0);
    });

    test('not while the recovery is not registered and active: cancelled, expired, pending or completed → refused', async () => {
      for (const patch of [{ state: 'cancelled' }, { expires_at: NOW - 1 }, { state: 'pending' }, { state: 'completed' }]) {
        registered(patch);
        const r = await open();
        expect({ patch, ok: r.status === 202 }).toEqual({ patch, ok: false });
        expect([401, 409]).toContain(r.status);
      }
      // Completed by the host's report: the recovering key is the app key now, and opens nothing.
      registered();
      getItem('vaults', VID).app_key = { key: newApp.b64, kid: newApp.kid, seq: 2 };
      expect((await open()).status).toBe(401);
      expect(sent().filter((m) => m.msg.op === 'recovery_open')).toHaveLength(0);
    });

    test('body checks: the envelope is an unlock-sized sealed request to etk_kid; manifest_sha256 is required; the vault must be the signed one', async () => {
      expect((await open({ ...OPEN, envelope: envelope(5_252) })).status).toBe(400);
      expect((await open({ ...OPEN, envelope: envelope(13_444, 'fedcba9876543210') })).status).toBe(400);
      const { manifest_sha256: _m, ...noManifest } = OPEN;
      expect((await open(noManifest)).status).toBe(400);
      expect((await open({ ...OPEN, request_id: 'nope' })).status).toBe(400);
      expect((await open({ ...OPEN, vault_id: 'e'.repeat(32) })).status).toBe(404);
      expect(sent()).toHaveLength(0);
    });

    test('routing: the leaseholder or, with none, a live instance of the sealed release; another release is instance_moved', async () => {
      release(R1, 15);
      instance('i-9', R1);
      expect((await open({ ...OPEN, instance_id: 'i-9' })).body.error).toBe('instance_moved');
      instance('i-2', R0);
      getItem('vaults', VID).lease = { instance_id: 'i-2', lease_expires_at: NOW + 60 };
      expect((await open({ ...OPEN, request_id: RID })).body.error).toBe('instance_moved');
      expect((await open({ ...OPEN, request_id: RID, instance_id: 'i-2' })).status).toBe(202);
      expect(sent().pop()!.url).toBe(QUEUE_PREFIX + 'i-2');
    });

    test('limits: 10 per source network per 15 minutes, 30 per recovery per day (they save work; the vault counts attempts)', async () => {
      const ids = Array.from({ length: 12 }, (_, i) => `01JB2Z6V9K3M4N5P6Q7R8S9V${'0123456789AB'[i]}0`);
      for (let i = 0; i < 10; i++) expect((await open({ ...OPEN, request_id: ids[i] })).status).toBe(202);
      expect((await open({ ...OPEN, request_id: ids[10] })).status).toBe(429);
      // Another network: allowed until the recovery's 30 a day.
      const perRecovery = `vault-recovery-open#${RID}#${NOW - (NOW % DAY)}`;
      expect(getItem('rl', perRecovery).count).toBe(10); // the refused 11th was stopped at the network limit, before this one
      tbl('rl').set(perRecovery, { key: perRecovery, count: 30 });
      const other = { app: { key: newApp, vault: VID }, headers: { 'cloudfront-viewer-address': '198.51.100.7:443' } };
      expect((await open({ ...OPEN, request_id: ids[11] }, other)).status).toBe(429);
      expect(vault.OPEN_LIMIT_PER_NETWORK).toBe(10);
      expect(vault.OPEN_LIMIT_PER_RECOVERY).toBe(30);
      // Only the last few open ids are kept on the recovery.
      expect(getItem('vaults', VID).recovery.open_ids).toEqual(ids.slice(0, 10).slice(-vault.MAX_OPEN_IDS));
    });

    test('paused service: 503, nothing queued', async () => {
      paused();
      expect((await open()).body).toMatchObject({ error: 'vault_unavailable', service: 'paused' });
      expect(sent()).toHaveLength(0);
    });

    test('the recovering key may not unlock or lock (403), but may poll its open and read status', async () => {
      const UNLOCK = { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
      expect((await call('POST', '/api/vault/unlock', UNLOCK, signed)).status).toBe(403);
      expect((await call('POST', '/api/vault/lock', { vault_id: VID, request_id: RID }, signed)).status).toBe(403);
      expect((await open()).status).toBe(202);
      expect((await call('GET', `/api/vault/requests/${RID2}`, undefined, signed)).body).toEqual({ status: 'queued' });
      expect((await call('GET', '/api/vault/status', undefined, signed)).status).toBe(200);
    });
  });

  describe('a counted attempt (`recovery_attempt`, §11.14.11)', () => {
    const result = Buffer.alloc(5_252, 0x44).toString('base64');
    const counted = (extra: Record<string, unknown> = {}) =>
      Object.assign(getItem('requests', RID2), { status: 'done', envelope: result, code: 'recovery_attempt', ...extra });
    const sweep = () => vault.sweepAttempts();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jobHandler = () => require('../../lambda/jobs/vault-attempts').handler();
    beforeEach(async () => {
      registered();
      expect((await open()).status).toBe(202);
    });

    test('the poll passes the result on; the attempt is audited and mailed once, with a cancel link that works; a wait moves expires_at and the rows', async () => {
      counted({ retry_at: isoS(NOW + 4 * DAY), expires: isoS(NOW + 5 * DAY) });
      const p = await call('GET', `/api/vault/requests/${RID2}`, undefined, signed);
      expect(p.body).toEqual({ status: 'done', envelope: result, code: 'recovery_attempt' });
      expect(getItem('vaults', VID).recovery.expires_at).toBe(NOW + 5 * DAY);
      expect(getItem('requests', 'recovery-locator#ABCDEFGHJKMN').expires_at).toBe(NOW + 5 * DAY);
      expect(getItem('requests', `rcancel#${'c'.repeat(64)}`).expires_at).toBe(NOW + 5 * DAY);
      const [a] = audits('vault.recovery_attempt');
      expect(a.detail).toEqual({ vault_id: VID, recovery_id: RID, request_id: RID2, retry_at: isoS(NOW + 4 * DAY), expires: isoS(NOW + 5 * DAY) });
      const [mail] = mails();
      expect(mail.subject).toBe('VettID vault recovery: an attempt was made');
      // The time is the open's (its slot's created_at), not the moment the API noticed it.
      expect(mail.text).toContain(`on ${new Date(Math.floor(Date.parse(getItem('requests', RID2).created_at) / 1000) * 1000).toISOString()}`);
      // It never says whether the attempt was right, nor how many are used or left.
      expect(mail.text).not.toMatch(/was (wrong|right|correct)|succeeded|failed|attempts? (left|used)|\d+ of 10/i);
      // Polled again, read again: nothing more.
      await call('GET', `/api/vault/requests/${RID2}`, undefined, signed);
      await call('GET', '/api/vault/recovery');
      expect(audits('vault.recovery_attempt')).toHaveLength(1);
      expect(mails()).toHaveLength(1);
      // The recovery stays open across the wait, with the same code: still active days later.
      at(NOW + 3 * DAY);
      expect((await call('GET', '/api/vault/recovery')).body.recovery.state).toBe('registered');
      expect((await call('POST', '/api/vault/recovery', { browser_key: BK })).body.error).toBe('recovery_active');
      // The link in the attempt mail cancels it.
      const token = /cancel#t=([A-Za-z0-9_-]{43})/.exec(mail.text)![1];
      expect((await call('POST', '/api/vault/recovery/cancel-link', { token }, { guid: 'nobody' })).body).toEqual({ cancelled: true });
      expect(getItem('vaults', VID).recovery.state).toBe('cancelled');
    });

    test('noticed from the status reads too, without the app\'s poll (open_ids), once', async () => {
      counted();
      await call('GET', '/api/vault/recovery');
      await call('GET', '/api/vault/status');
      expect(audits('vault.recovery_attempt')).toHaveLength(1);
      expect(mails().map((m) => m.subject)).toEqual(['VettID vault recovery: an attempt was made']);
      expect(getItem('vaults', VID).recovery.expires_at).toBe(NOW + DAY - 60); // no wait began: unchanged
    });

    test('expires_at only moves later, and never past the cap', async () => {
      counted({ expires: isoS(NOW + H) });
      await call('GET', `/api/vault/requests/${RID2}`, undefined, signed);
      expect(getItem('vaults', VID).recovery.expires_at).toBe(NOW + DAY - 60);
      expect(mails()).toHaveLength(1);
      // Another attempt with an expiry beyond 130 days after the request.
      const id3 = '01JB2Z6V9K3M4N5P6Q7R8S9T3A';
      expect((await open({ ...OPEN, request_id: id3 })).status).toBe(202);
      Object.assign(getItem('requests', id3), { status: 'done', envelope: result, code: 'recovery_attempt', expires: isoS(NOW + 400 * DAY) });
      await call('GET', `/api/vault/requests/${id3}`, undefined, signed);
      expect(getItem('vaults', VID).recovery.expires_at).toBe(NOW - 3 * DAY + vault.RECOVERY_MAX_SPAN_S);
    });

    test('an open answered without the marker (not counted: busy, quiet, wait…) mails and audits nothing', async () => {
      Object.assign(getItem('requests', RID2), { status: 'done', envelope: result });
      await call('GET', `/api/vault/requests/${RID2}`, undefined, signed);
      await call('GET', '/api/vault/recovery');
      expect(audits('vault.recovery_attempt')).toHaveLength(0);
      expect(mails()).toHaveLength(0);
      // The marker on any other op's slot is not an attempt either.
      Object.assign(getItem('requests', RID2), { op: 'recovery_register', code: 'recovery_attempt' });
      await call('GET', '/api/vault/recovery');
      expect(mails()).toHaveLength(0);
    });

    test('an attempt after a cancel is still mailed and audited (by the sweep), with no cancel link, and moves nothing', async () => {
      getItem('vaults', VID).recovery.state = 'cancelled';
      counted({ expires: isoS(NOW + 5 * DAY) });
      // The recovering key no longer authenticates after a cancel, and a status read sweeps only a registered recovery.
      expect((await call('GET', `/api/vault/requests/${RID2}`, undefined, signed)).status).toBe(401);
      await call('GET', '/api/vault/recovery');
      expect(mails()).toHaveLength(0);
      await sweep();
      expect(audits('vault.recovery_attempt')).toHaveLength(1);
      const [mail] = mails();
      expect(mail.subject).toBe('VettID vault recovery: an attempt was made');
      expect(mail.text).not.toMatch(/cancel#t=/);
      expect(mail.text).toMatch(/check that no recovery is in progress/);
      expect(getItem('vaults', VID).recovery.expires_at).toBe(NOW + DAY - 60);
      expect([...tbl('requests').values()].filter((x) => x.op === 'recovery_cancel_link' && x.recovery_id === RID)).toHaveLength(1); // only registered()'s own
    });

    test('a failure while noticing never hides the open\'s result from the app', async () => {
      counted();
      failPut = (i) => i.TableName === 'requests' && String(i.Item?.request_id).startsWith('rcancel#');
      const p = await call('GET', `/api/vault/requests/${RID2}`, undefined, signed);
      expect(p.body).toEqual({ status: 'done', envelope: result, code: 'recovery_attempt' });
      expect(logs.join('\n')).toContain('recovery attempt not noticed');
      // Claimed but not recorded: it is taken up again, not lost.
      expect(getItem('requests', RID2).attempt_noticed_at).toBeUndefined();
      expect(getItem('requests', RID2).attempt_noticing).toBe(NOW);
    });

    test('F2: a notice whose mail fails is retried after ATTEMPT_RETRY_S (not before), and recorded only once mailed', async () => {
      counted();
      sesMock.on(SendEmailCommand).rejectsOnce(Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' }));
      await call('GET', `/api/vault/requests/${RID2}`, undefined, signed);
      expect(getItem('requests', RID2).attempt_noticed_at).toBeUndefined();
      expect(getItem('requests', RID2).attempt_notice_tries).toBe(1);
      // Within the retry window: neither a poll nor the sweep takes it again.
      at(NOW + 60);
      await call('GET', `/api/vault/requests/${RID2}`, undefined, signed);
      expect(await sweep()).toEqual({ found: 0, noticed: 0, failed: 0 });
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
      // After it: the sweep retries, mails and records.
      at(NOW + vault.ATTEMPT_RETRY_S + 1);
      expect(await sweep()).toEqual({ found: 1, noticed: 1, failed: 0 });
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);
      expect(getItem('requests', RID2)).toMatchObject({ attempt_noticed_at: NOW + vault.ATTEMPT_RETRY_S + 1, attempt_notice_tries: 2 });
      expect(getItem('requests', RID2).attempt_noticing).toBeUndefined();
      // The failed first try had already audited: the retry audits again (errs on the side of the record).
      expect(audits('vault.recovery_attempt')).toHaveLength(2);
      // Recorded: never again.
      at(NOW + 3 * vault.ATTEMPT_RETRY_S);
      expect(await sweep()).toEqual({ found: 0, noticed: 0, failed: 0 });
    });

    test('F2: after ATTEMPT_MAX_TRIES the notice is given up, recorded as failed and logged', async () => {
      counted({ attempt_notice_tries: vault.ATTEMPT_MAX_TRIES, attempt_noticing: NOW - vault.ATTEMPT_RETRY_S - 1 });
      expect(await sweep()).toMatchObject({ found: 1 });
      expect(getItem('requests', RID2)).toMatchObject({ attempt_notice_failed: true, attempt_noticed_at: NOW });
      expect(mails()).toHaveLength(0);
      expect(logs.join('\n')).toContain('recovery attempt notice abandoned');
      expect(vault.ATTEMPT_MAX_TRIES).toBe(24);
    });

    test('F1: an attempt the phone never polls is mailed by the 5-minute sweep (the job), once; its slot lives as long as the recovery', async () => {
      // The open's slot outlives 15 minutes: the recovery's expires_at plus an hour.
      expect(getItem('requests', RID2).expires_at).toBe(NOW + DAY - 60 + 3600);
      counted({ expires: isoS(NOW + 5 * DAY) });
      at(NOW + 40 * 60); // long after the old 15-minute slot life; nobody polls or reads the status
      const r = await jobHandler();
      expect(r).toEqual({ found: 1, noticed: 1, failed: 0, cancels: { found: 0, noticed: 0, failed: 0 } });
      expect(audits('vault.recovery_attempt')).toHaveLength(1);
      expect(mails().map((m) => m.subject)).toEqual(['VettID vault recovery: an attempt was made']);
      expect(getItem('vaults', VID).recovery.expires_at).toBe(NOW + 5 * DAY);
      expect(logs.join('\n')).toContain('"RecoveryAttemptsUnnoticed":1');
      expect(await jobHandler()).toMatchObject({ found: 0, noticed: 0, failed: 0 });
      expect(mails()).toHaveLength(1);
    });

    test('F1: the next open notices every earlier counted attempt before it is forwarded', async () => {
      counted();
      const id3 = '01JB2Z6V9K3M4N5P6Q7R8S9T3B';
      expect((await open({ ...OPEN, request_id: id3 })).status).toBe(202);
      expect(audits('vault.recovery_attempt')).toHaveLength(1);
      expect(mails()).toHaveLength(1);
      expect(getItem('vaults', VID).recovery.open_ids).toEqual([RID2, id3]);
    });

    test('N1: the sweep\'s writes to the request table: puts only cancel links, and every update is conditional on the item existing', async () => {
      counted({ expires: isoS(NOW + 5 * DAY) });
      ddb.resetHistory();
      expect(await sweep()).toEqual({ found: 1, noticed: 1, failed: 0 });
      const puts = ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'requests');
      expect(puts.length).toBeGreaterThan(0);
      for (const i of puts) expect(String(i.Item!.request_id)).toMatch(/^rcancel#[0-9a-f]{64}$/);
      const updates = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'requests');
      expect(updates.map((i) => i.UpdateExpression)).toEqual(expect.arrayContaining([
        expect.stringMatching(/^SET attempt_noticing/), expect.stringMatching(/^SET attempt_noticed_at/), 'SET expires_at = :exp',
      ]));
      const allowed = ['request_id', 'expires_at', 'recovery_id', 'code', 'attempt_noticing', 'attempt_notice_tries', 'attempt_noticed_at', 'attempt_notice_failed'];
      for (const i of updates) {
        expect({ u: i.UpdateExpression, c: i.ConditionExpression }).toEqual({ u: i.UpdateExpression, c: expect.stringContaining('attribute_exists(request_id)') });
        // Every attribute it names is one the job's grant allows (lib/vault/access.ts `vault-attempts`).
        const named = `${i.UpdateExpression} ${i.ConditionExpression}`.replace(/:[a-z_]+/g, '').match(/[a-z_]+/g)!
          .filter((w) => !['SET', 'REMOVE', 'AND', 'OR', 'if_not_exists', 'attribute_exists', 'attribute_not_exists'].includes(w));
        for (const a of named) expect({ a, allowed: allowed.includes(a) }).toEqual({ a, allowed: true });
      }
      const vaultUpdates = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'vaults');
      for (const i of vaultUpdates) expect(i.ConditionExpression).toMatch(/recovery\.recovery_id = :id/);
    });

    test('N3: while an earlier attempt cannot be mailed, no further open is forwarded (503, fail-safe); once noticed or given up, opens go on', async () => {
      counted();
      sesMock.on(SendEmailCommand).rejects(new Error('ses down'));
      const id3 = '01JB2Z6V9K3M4N5P6Q7R8S9T3D';
      const r1 = await open({ ...OPEN, request_id: id3 });
      expect(r1).toMatchObject({ status: 503, body: { error: 'attempt_notice_pending', retry_after: vault.ATTEMPT_RETRY_S } });
      expect(sent().filter((m) => m.msg.op === 'recovery_open')).toHaveLength(1); // only the first open
      // Still claimed (within 5 minutes): still refused, and no second send is tried meanwhile.
      at(NOW + 60);
      expect((await open({ ...OPEN, request_id: id3 })).status).toBe(503);
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
      // Given up after ATTEMPT_MAX_TRIES (recorded as failed): opens go on.
      Object.assign(getItem('requests', RID2), { attempt_notice_tries: vault.ATTEMPT_MAX_TRIES, attempt_noticing: NOW - vault.ATTEMPT_RETRY_S });
      at(NOW + 120);
      expect((await open({ ...OPEN, request_id: id3 })).status).toBe(202);
      expect(getItem('requests', RID2).attempt_notice_failed).toBe(true);
    });

    test('a status read during an SES outage still answers (the notice failure is logged)', async () => {
      counted();
      sesMock.on(SendEmailCommand).rejects(new Error('ses down'));
      expect((await call('GET', '/api/vault/recovery')).status).toBe(200);
      expect(logs.join('\n')).toContain('recovery attempt not noticed');
    });

    test('the sweep skips slots whose vault or member is gone, and counts a failed notice for the next run', async () => {
      counted();
      const other = '01JB2Z6V9K3M4N5P6Q7R8S9T3C';
      put('requests', { request_id: other, op: 'recovery_open', status: 'done', code: 'recovery_attempt', vault_id: 'e'.repeat(32), user_guid: 'gone', recovery_id: RID, created_at: '2026-10-02T12:00:00.000Z', expires_at: NOW + DAY });
      sesMock.on(SendEmailCommand).rejectsOnce(new Error('ses down'));
      expect(await sweep()).toEqual({ found: 2, noticed: 0, failed: 1 });
      expect(getItem('requests', other).attempt_noticing).toBeUndefined();
    });
  });

  describe('the heavy derivation\'s permit: a recovering phone\'s enclave (VAULT-HOST-PROTOCOL §6.6)', () => {
    beforeEach(() => {
      registered();
      instance('i-1', R0, { load: 0, heavy_kdf_free: false });
      instance('i-2', R0, { load: 5, heavy_kdf_free: true });
    });

    test('prefers an instance that shows heavy_kdf_free; everyone else gets the least loaded', async () => {
      expect((await call('GET', '/api/vault/enclave', undefined, signed)).body.instance_id).toBe('i-2');
      expect((await call('GET', '/api/vault/enclave', undefined, { app: { key: oldApp, vault: VID } })).body.instance_id).toBe('i-1');
    });

    test('none free: the least loaded live instance, as before', async () => {
      getItem('instances', 'i-2').heavy_kdf_free = false;
      expect((await call('GET', '/api/vault/enclave', undefined, signed)).body.instance_id).toBe('i-1');
    });

    test('a leaseholder is still the leaseholder', async () => {
      getItem('vaults', VID).lease = { instance_id: 'i-1', lease_expires_at: NOW + 60 };
      expect((await call('GET', '/api/vault/enclave', undefined, signed)).body.instance_id).toBe('i-1');
    });
  });

  describe('the pending app key (`app_key_next`, §11.14.2)', () => {
    const next = keyOf('r-next-phone');
    const UNLOCK = { vault_id: VID, request_id: RID, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA };
    const as = (k: TestKey) => ({ app: { key: k, vault: VID } });

    test('while set and ahead of app_key, both keys are the vault\'s app key; when app_key reaches it, only the new one', async () => {
      getItem('vaults', VID).app_key_next = { key: next.b64, kid: next.kid, seq: 2, header_seq: 40 };
      expect((await call('POST', '/api/vault/unlock', UNLOCK, as(next))).status).toBe(202);
      expect((await call('GET', '/api/vault/status', undefined, as(oldApp))).status).toBe(200);
      expect((await call('GET', '/api/vault/status', undefined, as(next))).status).toBe(200);
      // The host's step 3: app_key is the next key (the host also clears app_key_next; a left-over one is ignored).
      getItem('vaults', VID).app_key = { key: next.b64, kid: next.kid, seq: 2 };
      expect((await call('GET', '/api/vault/status', undefined, as(oldApp))).status).toBe(401);
      expect((await call('GET', '/api/vault/status', undefined, as(next))).status).toBe(200);
    });

    test('a pending key that is not ahead of app_key, or names it, counts for nothing', async () => {
      expect(vault.pendingAppKey({ app_key: { key: oldApp.b64, kid: oldApp.kid, seq: 3 }, app_key_next: { key: next.b64, kid: next.kid, seq: 3 } })).toBeNull();
      expect(vault.pendingAppKey({ app_key: { key: oldApp.b64, kid: oldApp.kid, seq: 3 }, app_key_next: { key: next.b64, kid: next.kid } })).toBeNull();
      expect(vault.pendingAppKey({ app_key: { key: next.b64, kid: next.kid, seq: 1 }, app_key_next: { key: next.b64, kid: next.kid, seq: 2 } })).toBeNull();
      expect(vault.pendingAppKey({ app_key: { key: oldApp.b64, kid: oldApp.kid, seq: 1 }, app_key_next: { kid: next.kid, seq: 2 } as never })).toBeNull();
      // An app_key without seq cannot be compared: no pending key beside it; nor a pending key without one.
      expect(vault.pendingAppKey({ app_key: { key: oldApp.b64, kid: oldApp.kid }, app_key_next: { key: next.b64, kid: next.kid, seq: 2 } })).toBeNull();
      expect(vault.pendingAppKey({ app_key_next: { key: next.b64, kid: next.kid } })).toBeNull();
      expect(vault.pendingAppKey({ app_key_next: { key: next.b64, kid: next.kid, seq: 1 } })).toMatchObject({ kid: next.kid });
      expect(vault.pendingAppKey({ app_key: { key: oldApp.b64, kid: oldApp.kid, seq: 1 }, app_key_next: { key: next.b64, kid: next.kid, seq: 2 } })).toMatchObject({ kid: next.kid });
      getItem('vaults', VID).app_key_next = { key: next.b64, kid: next.kid, seq: 1 };
      expect((await call('GET', '/api/vault/status', undefined, as(next))).status).toBe(401);
    });

    test('a recovery between its first and third write: the recovering key is the pending app key, so it may unlock (the vault decides)', async () => {
      registered();
      getItem('vaults', VID).app_key_next = { key: newApp.b64, kid: newApp.kid, seq: 2, header_seq: 7 };
      expect((await call('POST', '/api/vault/unlock', UNLOCK, signed)).status).toBe(202);
      // Not completed yet: only app_key's report completes a recovery.
      expect(getItem('vaults', VID).recovery.state).toBe('registered');
      getItem('vaults', VID).app_key = { key: newApp.b64, kid: newApp.kid, seq: 2 };
      await call('GET', '/api/vault/recovery');
      expect(getItem('vaults', VID).recovery.state).toBe('completed');
      expect(mails().map((m) => m.subject)).toEqual(['VettID vault recovered']);
      expect(mails()[0].text).toContain('is now on a new phone');
    });
  });
});

describe('2.9.0: a recovery cancelled from the phone (VAULT-MESSAGING 0.49.0 §11.5, §11.11.4)', () => {
  const BK = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
  const owner = keyOf('rc-owner-phone');
  const asOwner = { app: { key: owner, vault: VID } };
  const audits = (action: string) => [...tbl('audit').values()].filter((a) => a.action === action);
  const mails = () => sesMock.commandCalls(SendEmailCommand).map((c) => ({
    subject: c.args[0].input.Content!.Simple!.Subject!.Data!, text: c.args[0].input.Content!.Simple!.Body!.Text!.Data!,
  }));
  const subjects = () => mails().map((m) => m.subject);
  const isoS = (s: number) => new Date(s * 1000).toISOString();
  const DAY = 86_400;
  let clock = NOW;
  const at = (s: number) => {
    clock = s;
    jest.spyOn(Date, 'now').mockReturnValue(s * 1000);
    for (const i of tbl('instances').values()) i.heartbeat_at = s - 10;
  };
  /** A few seconds on: the poll limit is 2 a second. */
  const tick = () => at(clock + 2);
  const result = Buffer.alloc(5_252, 0x55).toString('base64');
  const U1 = '01JB2Z6V9K3M4N5P6Q7R8S9V01';
  const U2 = '01JB2Z6V9K3M4N5P6Q7R8S9V02';
  const sweep = () => vault.sweepAppCancels();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jobHandler = () => require('../../lambda/jobs/vault-attempts').handler();
  const request = async () => {
    tick();
    const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
    expect(r.status).toBe(202);
    return r.body.recovery_id as string;
  };
  const unlock = async (id: string) => {
    tick();
    expect((await call('POST', '/api/vault/unlock', { vault_id: VID, request_id: id, instance_id: 'i-1', etk_kid: KID, envelope: ENV, manifest_sha256: MSHA }, asOwner)).status).toBe(202);
  };
  /** The host's copy of the enclave's marker into the unlock's slot. */
  const answer = (id: string, rid: string, extra: Record<string, unknown> = {}) =>
    Object.assign(getItem('requests', id), { status: 'done', envelope: result, code: 'recovery_cancelled', cancelled_recovery_id: rid, ...extra });
  const poll = async (id: string) => {
    tick();
    return call('GET', `/api/vault/requests/${id}`, undefined, asOwner);
  };
  const siteCancel = async (rid: string) => {
    tick();
    return (await call('POST', '/api/vault/recovery/cancel', { recovery_id: rid })).body;
  };
  const status = async () => {
    tick();
    return call('GET', '/api/vault/status');
  };
  const recovery = async () => {
    tick();
    return (await call('GET', '/api/vault/recovery')).body.recovery;
  };
  const rec = () => getItem('vaults', VID).recovery;
  /** What the enclave verifies, built here independently: seven lines, or eight with the named recovery. */
  const verifies = (msg: any, recoveryId?: string) => {
    const lines = ['vettid/vms/2/recovery-request', msg.op, msg.vault_id, msg.user_guid, msg.request_id, msg.signed_at, ''];
    if (recoveryId !== undefined) lines.push(recoveryId);
    return cryptoVerify('sha256', Buffer.from(lines.join('\n')), { key: RRK.pub, dsaEncoding: 'der' }, Buffer.from(msg.sig, 'base64'));
  };
  const appCancelText = (requestedAt: number) => `The recovery of your VettID vault requested at ${isoS(requestedAt)} was cancelled from your VettID app, which unlocked the vault with your PIN. Your apps can unlock the vault again.

If you did not do this, someone else may have your phone and know your PIN. Sign in to your account page and request a new recovery, and change your PIN once your vault is back on a phone you hold.`;

  beforeEach(() => {
    delete process.env.RECOVERY_CANCEL_ID_FROM_RELEASE;
    release(R0, 14);
    instance('i-1', R0);
    vaultOf('g1', { vault_id: VID, state: 'locked', sealed_release: R0, app_key: { key: owner.b64, kid: owner.kid, seq: 1 } });
    at(NOW);
  });
  afterAll(() => {
    delete process.env.RECOVERY_CANCEL_ID_FROM_RELEASE;
  });

  test('the app polls its unlock: the named recovery ends `cancelled` via `app`, once, audited and mailed; nothing is enqueued; a new request is possible', async () => {
    const rid = await request();
    const requestedAt = rec().requested_at;
    await unlock(U1);
    // The slot names the recovery it was queued under and lives as long as it, plus an hour; the recovery remembers it.
    expect(getItem('requests', U1)).toMatchObject({ op: 'unlock', recovery_id: rid, expires_at: rec().expires_at + 3600 });
    expect(rec().unlock_ids).toEqual([U1]);
    answer(U1, rid);
    const p = await poll(U1);
    expect(p.body).toEqual({ status: 'done', envelope: result, code: 'recovery_cancelled' });
    expect(rec()).toMatchObject({ recovery_id: rid, state: 'cancelled', cancelled_via: 'app', cancelled_at: clock });
    const [a] = audits('vault.recovery_cancel');
    expect(a.detail).toEqual({ vault_id: VID, recovery_id: rid, via: 'app', request_id: U1, source: 'slot' });
    expect(subjects()).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled']);
    expect(mails()[1].text).toBe(appCancelText(requestedAt));
    // The vault has already ended it: no recovery_cancel.
    expect(sent().map((m) => m.msg.op)).toEqual(['recovery', 'unlock']);
    // The notice row: recorded; its TTL is the later of expires_at and now, plus one day.
    expect(getItem('requests', `rcnotice#${rid}`)).toMatchObject({ vault_id: VID, user_guid: 'g1', recovery_id: rid, notice_tries: 1, expires_at: rec().expires_at + DAY, noticed_at: expect.any(Number) });
    expect(getItem('requests', `rcnotice#${rid}`).noticing).toBeUndefined();
    expect(getItem('requests', U1).cancel_noticed_at).toEqual(expect.any(Number));
    // Polled again, read again, swept: nothing more.
    await poll(U1);
    expect(await recovery()).toMatchObject({ recovery_id: rid, state: 'cancelled', cancelled_via: 'app' });
    expect((await status()).body.vault.recovery).toBeNull();
    expect(await sweep()).toEqual({ found: 0, noticed: 0, failed: 0 });
    expect(audits('vault.recovery_cancel')).toHaveLength(1);
    expect(audits('vault.recovery_cancel_seen')).toHaveLength(0);
    expect(mails()).toHaveLength(2);
    expect(await request()).not.toBe(rid);
  });

  test('an unlock while no recovery is active: a 15-minute slot, no recovery_id, nothing remembered', async () => {
    await unlock(U1);
    expect(getItem('requests', U1).recovery_id).toBeUndefined();
    expect(getItem('requests', U1).expires_at).toBe(clock + 900);
  });

  describe('reordering: the marker\'s own id decides, never the slot\'s recovery_id', () => {
    test('an unlock queued under R1 that ran after R1\'s cancel and R2\'s request, and ended R2: R2 ends here too', async () => {
      const r1 = await request();
      await unlock(U1);
      expect(getItem('requests', U1).recovery_id).toBe(r1);
      expect(await siteCancel(r1)).toEqual({ cancelled: true });
      const r2 = await request();
      answer(U1, r2);
      await poll(U1);
      expect(rec()).toMatchObject({ recovery_id: r2, state: 'cancelled', cancelled_via: 'app' });
      expect(audits('vault.recovery_cancel').map((a) => [a.detail.recovery_id, a.detail.via])).toEqual([[r1, 'session'], [r2, 'app']]);
      expect(subjects()).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled', 'VettID vault recovery requested', 'VettID vault recovery cancelled']);
    });

    test('an unlock queued under R2 that ran before R2\'s own request and ended R1: R2 stays; `vault.recovery_cancel_seen` (replaced), once, no mail', async () => {
      const r1 = await request();
      expect(await siteCancel(r1)).toEqual({ cancelled: true });
      const r2 = await request();
      await unlock(U1);
      expect(getItem('requests', U1).recovery_id).toBe(r2);
      answer(U1, r1);
      const before = mails().length;
      await poll(U1);
      await status();
      await sweep();
      await sweep();
      expect(rec()).toMatchObject({ recovery_id: r2, state: 'pending' });
      expect(rec().cancelled_via).toBeUndefined();
      expect(audits('vault.recovery_cancel_seen').map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: r1, ended: 'replaced' }]);
      expect(mails()).toHaveLength(before);
      expect(getItem('requests', `rcnotice#${r1}`)).toBeUndefined();
    });
  });

  test('the vault row\'s recovery_cancelled alone (a lost answer) ends the matching recovery once; with the slot too, still once', async () => {
    const rid = await request();
    await unlock(U1);
    getItem('vaults', VID).recovery_cancelled = { recovery_id: rid, at: clock };
    expect((await status()).body.vault.recovery).toBeNull();
    expect(rec()).toMatchObject({ state: 'cancelled', cancelled_via: 'app' });
    expect(audits('vault.recovery_cancel').map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: rid, via: 'app', source: 'row' }]);
    // The slot's marker arrives as well (the answer was not lost after all): marked, nothing more.
    answer(U1, rid);
    await poll(U1);
    await recovery();
    await status();
    await sweep();
    expect(getItem('requests', U1).cancel_noticed_at).toEqual(expect.any(Number));
    expect(audits('vault.recovery_cancel')).toHaveLength(1);
    expect(audits('vault.recovery_cancel_seen')).toHaveLength(0);
    expect(subjects()).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled']);
  });

  test.each<[string, (rid: string) => Promise<void>]>([
    ['cancelled', async (rid) => void expect(await siteCancel(rid)).toEqual({ cancelled: true })],
    ['completed', async () => void (rec().state = 'completed')],
    ['unavailable', async () => void (rec().state = 'unavailable')],
    ['expired', async () => at(rec().expires_at + 60)],
  ])('already ended (%s): `vault.recovery_cancel_seen` once per slot across polls, status reads and sweeps; no mail; the row alone never audits it', async (ended, end) => {
    const rid = await request();
    await unlock(U1);
    await end(rid);
    answer(U1, rid);
    getItem('vaults', VID).recovery_cancelled = { recovery_id: rid, at: clock };
    const before = subjects();
    await poll(U1);
    await poll(U1);
    await recovery();
    await status();
    await sweep();
    at(clock + vault.ATTEMPT_RETRY_S + 1);
    await sweep();
    await status();
    expect(audits('vault.recovery_cancel_seen').map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: rid, ended }]);
    expect(audits('vault.recovery_cancel').filter((a) => a.detail.via === 'app')).toHaveLength(0);
    expect(subjects()).toEqual(before);
    expect(getItem('requests', `rcnotice#${rid}`)).toBeUndefined();
    // A second slot naming the same recovery is its own claim: one more audit, still no mail.
    await unlock(U2);
    answer(U2, rid);
    await poll(U2);
    await sweep();
    expect(audits('vault.recovery_cancel_seen')).toHaveLength(2);
    expect(subjects()).toEqual(before);
  });

  test('the row alone, for a recovery already ended here, never audits and mails nothing', async () => {
    const rid = await request();
    expect(await siteCancel(rid)).toEqual({ cancelled: true });
    getItem('vaults', VID).recovery_cancelled = { recovery_id: rid, at: clock };
    await recovery();
    await status();
    await sweep();
    expect(audits('vault.recovery_cancel_seen')).toHaveLength(0);
    expect(subjects()).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled']);
  });

  test('after the mail, the row\'s recovery_cancelled (never cleared) opens no notice: after the notice row\'s TTL, and after expires_at moved', async () => {
    const rid = await request();
    getItem('vaults', VID).recovery_cancelled = { recovery_id: rid, at: clock };
    await recovery();
    expect(mails()).toHaveLength(2);
    // The notice row has gone (its TTL), the row still names the recovery.
    tbl('requests').delete(`rcnotice#${rid}`);
    at(clock + 3 * DAY);
    await recovery();
    await status();
    await sweep();
    // An attempt's notice could have moved expires_at later.
    rec().expires_at = clock + 10 * DAY;
    await recovery();
    await status();
    await sweep();
    expect(mails()).toHaveLength(2);
    expect(audits('vault.recovery_cancel')).toHaveLength(1);
    expect(audits('vault.recovery_cancel_seen')).toHaveLength(0);
    expect(getItem('requests', `rcnotice#${rid}`)).toBeUndefined();
  });

  test('a claim that stopped after the cancel write and before the email is taken up after ATTEMPT_RETRY_S, not before, and mails', async () => {
    const rid = await request();
    await unlock(U1);
    answer(U1, rid);
    // The next send fails once (rejectsOnce would target the stub's first call, the request's mail).
    let failNext = true;
    sesMock.on(SendEmailCommand).callsFake(() => {
      if (!failNext) return {};
      failNext = false;
      throw Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' });
    });
    const p = await poll(U1);
    // The failure never hides the result.
    expect(p.body).toEqual({ status: 'done', envelope: result, code: 'recovery_cancelled' });
    expect(logs.join('\n')).toContain('recovery cancel not noticed');
    expect(rec()).toMatchObject({ state: 'cancelled', cancelled_via: 'app' });
    const claimedAt = clock;
    expect(getItem('requests', `rcnotice#${rid}`)).toMatchObject({ noticing: claimedAt, notice_tries: 1 });
    expect(getItem('requests', `rcnotice#${rid}`).noticed_at).toBeUndefined();
    // Within the retry window: neither a poll, a status read nor the sweep takes it again.
    at(claimedAt + 60);
    await poll(U1);
    await status();
    expect(await sweep()).toMatchObject({ noticed: 1 }); // the slot: the notice is under way
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2); // the request and the failed one
    // After it: taken up (the recovery already reads cancelled via app), mailed and recorded.
    at(claimedAt + vault.ATTEMPT_RETRY_S + 1);
    await sweep();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(3);
    expect(mails()[2]).toEqual({ subject: 'VettID vault recovery cancelled', text: appCancelText(rec().requested_at) });
    expect(getItem('requests', `rcnotice#${rid}`)).toMatchObject({ notice_tries: 2, noticed_at: clock });
    expect(getItem('requests', U1).cancel_noticed_at).toEqual(expect.any(Number));
    // The stopped claim had audited already: the retry audits again (errs on the side of the record).
    expect(audits('vault.recovery_cancel')).toHaveLength(2);
    at(clock + 3 * vault.ATTEMPT_RETRY_S);
    expect(await sweep()).toEqual({ found: 0, noticed: 0, failed: 0 });
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(3);
  });

  test('after ATTEMPT_MAX_TRIES the notice is given up, recorded as failed and logged; nothing is mailed', async () => {
    const rid = await request();
    put('requests', { request_id: `rcnotice#${rid}`, vault_id: VID, user_guid: 'g1', recovery_id: rid, notice_tries: vault.ATTEMPT_MAX_TRIES, noticing: clock - vault.ATTEMPT_RETRY_S - 1, expires_at: clock + DAY });
    expect(await sweep()).toEqual({ found: 1, noticed: 1, failed: 0 });
    expect(getItem('requests', `rcnotice#${rid}`)).toMatchObject({ notice_failed: true, noticed_at: clock });
    expect(logs.join('\n')).toContain('recovery cancel notice abandoned');
    expect(subjects()).toEqual(['VettID vault recovery requested']);
    expect(rec().state).toBe('pending');
  });

  test('the sweep (the job) notices a marker on a slot older than 15 minutes, which lives as long as the recovery', async () => {
    const rid = await request();
    await unlock(U1);
    answer(U1, rid);
    at(clock + 40 * 60); // nobody polls or reads the status
    expect(Number(getItem('requests', U1).expires_at)).toBeGreaterThan(clock);
    const r = await jobHandler();
    expect(r.cancels).toEqual({ found: 1, noticed: 1, failed: 0 });
    expect(logs.join('\n')).toContain('"RecoveryCancelsUnnoticed":1');
    expect(rec()).toMatchObject({ state: 'cancelled', cancelled_via: 'app' });
    expect(subjects()).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled']);
    expect((await jobHandler()).cancels).toEqual({ found: 0, noticed: 0, failed: 0 });
  });

  test('the sweep notices a row-only cancel; its request-table writes name only the job\'s attributes, and it never reads the request table', async () => {
    const rid = await request();
    getItem('vaults', VID).recovery_cancelled = { recovery_id: rid, at: clock };
    // A marked slot of an already ended recovery as well (the slot claim).
    const other = '01JB2Z6V9K3M4N5P6Q7R8S9V09';
    put('requests', { request_id: other, op: 'unlock', status: 'done', code: 'recovery_cancelled', cancelled_recovery_id: RID, vault_id: VID, user_guid: 'g1', created_at: '2026-10-02T12:00:00.000Z', expires_at: clock + DAY });
    ddb.resetHistory();
    expect(await sweep()).toEqual({ found: 2, noticed: 2, failed: 0 });
    expect(rec()).toMatchObject({ state: 'cancelled', cancelled_via: 'app' });
    expect(audits('vault.recovery_cancel').map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: rid, via: 'app', source: 'row' }]);
    expect(audits('vault.recovery_cancel_seen').map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: RID, ended: 'replaced' }]);
    expect(ddb.commandCalls(GetCommand).filter((c) => c.args[0].input.TableName === 'requests')).toHaveLength(0);
    expect(ddb.commandCalls(PutCommand).filter((c) => c.args[0].input.TableName === 'requests')).toHaveLength(0);
    const slotAttrs = ['request_id', 'expires_at', 'recovery_id', 'code', 'attempt_noticing', 'attempt_notice_tries', 'attempt_noticed_at', 'attempt_notice_failed', 'cancel_noticed_at', 'cancelled_recovery_id'];
    const noticeAttrs = ['request_id', 'vault_id', 'user_guid', 'recovery_id', 'noticing', 'notice_tries', 'noticed_at', 'notice_failed', 'expires_at'];
    const updates = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'requests');
    expect(updates.length).toBeGreaterThan(0);
    for (const i of updates) {
      const notice = String(i.Key!.request_id).startsWith('rcnotice#');
      if (!notice) expect(i.ConditionExpression).toContain('attribute_exists(request_id)');
      const named = `${i.UpdateExpression} ${i.ConditionExpression}`.replace(/:[a-z_]+/g, '').match(/[a-z_]+/g)!
        .filter((w) => !['SET', 'REMOVE', 'AND', 'OR', 'if_not_exists', 'attribute_exists', 'attribute_not_exists'].includes(w));
      for (const a of named) expect({ a, notice, allowed: (notice ? noticeAttrs : slotAttrs).includes(a) }).toEqual({ a, notice, allowed: true });
    }
    for (const i of ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((x) => x.TableName === 'vaults')) {
      expect(i.UpdateExpression!.replace(/[:#][a-zA-Z_]+/g, '').match(/[a-z_]+/g)!.filter((w) => !['SET', 'REMOVE'].includes(w)).every((w) => ['recovery', 'cancelled_via', 'cancelled_at', 'updated_at', 'completed_at', 'claim_keys', 'recovering_key'].includes(w))).toBe(true);
    }
  });

  test('an unlock_ids append concurrent with a site cancel: both land, the recovery reads cancelled, and the next poll changes nothing', async () => {
    const rid = await request();
    // The site's cancel write lands between the unlock's read and its append.
    onUpdate = (i) => {
      if (i.TableName === 'vaults' && String(i.UpdateExpression).startsWith('SET recovery.unlock_ids')) {
        onUpdate = undefined;
        Object.assign(getItem('vaults', VID).recovery, { state: 'cancelled', cancelled_via: 'session', cancelled_at: clock });
      }
    };
    await unlock(U1);
    expect(rec()).toMatchObject({ recovery_id: rid, state: 'cancelled', cancelled_via: 'session', unlock_ids: [U1] });
    answer(U1, rid);
    const before = mails().length;
    await poll(U1);
    expect(rec()).toMatchObject({ recovery_id: rid, state: 'cancelled', cancelled_via: 'session', unlock_ids: [U1] });
    expect(audits('vault.recovery_cancel').filter((a) => a.detail.via === 'app')).toHaveLength(0);
    expect(mails()).toHaveLength(before);
  });

  test('two unlocks append concurrently: neither id is lost (the append is retried on the list read)', async () => {
    await request();
    await unlock(U1);
    onUpdate = (i) => {
      if (i.TableName === 'vaults' && String(i.UpdateExpression).startsWith('SET recovery.unlock_ids')) {
        onUpdate = undefined;
        getItem('vaults', VID).recovery.unlock_ids = [U1, '01JB2Z6V9K3M4N5P6Q7R8S9V07'];
      }
    };
    await unlock(U2);
    expect(rec().unlock_ids).toEqual([U1, '01JB2Z6V9K3M4N5P6Q7R8S9V07', U2]);
  });

  describe('a site cancel and a phone cancel of the same recovery: one cancel, one `vault.recovery_cancel`, one email', () => {
    test('the phone first: the route loses and answers {cancelled: false}, enqueues and mails nothing', async () => {
      const rid = await request();
      await unlock(U1);
      answer(U1, rid);
      await poll(U1);
      expect(await siteCancel(rid)).toEqual({ cancelled: false });
      expect(audits('vault.recovery_cancel').map((a) => a.detail.via)).toEqual(['app']);
      expect(subjects()).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled']);
      expect(sent().map((m) => m.msg.op)).toEqual(['recovery', 'unlock']);
    });

    test('the site\'s write lands between the notice\'s claim and its write: the notice loses, audits `seen` (cancelled), mails nothing', async () => {
      const rid = await request();
      await unlock(U1);
      answer(U1, rid);
      onUpdate = (i) => {
        if (i.TableName === 'vaults' && i.ExpressionAttributeValues?.[':via'] === 'app') {
          onUpdate = undefined;
          Object.assign(getItem('vaults', VID).recovery, { state: 'cancelled', cancelled_via: 'session', cancelled_at: clock });
        }
      };
      await poll(U1);
      expect(rec()).toMatchObject({ state: 'cancelled', cancelled_via: 'session' });
      expect(audits('vault.recovery_cancel').filter((a) => a.detail.via === 'app')).toHaveLength(0);
      expect(audits('vault.recovery_cancel_seen').map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: rid, ended: 'cancelled' }]);
      expect(subjects()).toEqual(['VettID vault recovery requested']);
      expect(getItem('requests', `rcnotice#${rid}`).noticed_at).toEqual(expect.any(Number));
    });

    test('the site first: the phone\'s marker is the "already ended" path', async () => {
      const rid = await request();
      await unlock(U1);
      expect(await siteCancel(rid)).toEqual({ cancelled: true });
      answer(U1, rid);
      await poll(U1);
      expect(audits('vault.recovery_cancel').map((a) => a.detail.via)).toEqual(['session']);
      expect(subjects()).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled']);
      expect(rec().cancelled_via).toBe('session');
    });
  });

  test.each<[string, () => void]>([
    ['the row (a lost answer)', () => void (getItem('vaults', VID).recovery_cancelled = { recovery_id: rec().recovery_id, at: clock })],
    ['an unlock slot nobody polled', () => void answer(U1, rec().recovery_id)],
  ])('POST /api/vault/recovery after a phone cancel nobody noticed (%s) answers 202, not 409 recovery_active', async (_n, mark) => {
    const r1 = await request();
    await unlock(U1);
    mark();
    tick();
    const r = await call('POST', '/api/vault/recovery', { browser_key: BK });
    expect(r.status).toBe(202);
    expect(r.body.recovery_id).not.toBe(r1);
    expect(audits('vault.recovery_cancel').map((a) => [a.detail.recovery_id, a.detail.via])).toEqual([[r1, 'app']]);
    expect(subjects()).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled', 'VettID vault recovery requested']);
  });

  test('the marker on a slot whose op is not `unlock` is ignored', async () => {
    const rid = await request();
    await unlock(U1);
    answer(U1, rid, { op: 'lock' });
    expect((await poll(U1)).body.code).toBe('recovery_cancelled');
    await recovery();
    await status();
    expect(await sweep()).toEqual({ found: 0, noticed: 0, failed: 0 });
    expect(rec().state).toBe('pending');
    expect(audits('vault.recovery_cancel')).toHaveLength(0);
    expect(audits('vault.recovery_cancel_seen')).toHaveLength(0);
    expect(subjects()).toEqual(['VettID vault recovery requested']);
  });

  test('a malformed cancelled_recovery_id is no marker', async () => {
    const rid = await request();
    await unlock(U1);
    answer(U1, rid.toLowerCase());
    await poll(U1);
    await sweep();
    expect(rec().state).toBe('pending');
    expect(audits('vault.recovery_cancel_seen')).toHaveLength(0);
  });

  test('the unlock_ids append is best effort: a failed re-read after a refused append still answers 202 (the unlock is queued)', async () => {
    await request();
    onUpdate = (i) => {
      if (i.TableName === 'vaults' && String(i.UpdateExpression).startsWith('SET recovery.unlock_ids')) {
        onUpdate = undefined;
        getItem('vaults', VID).recovery.unlock_ids = ['01JB2Z6V9K3M4N5P6Q7R8S9V07'];
        failGet = (g) => g.TableName === 'vaults' && g.Key.vault_id === VID;
      }
    };
    await unlock(U1);
    expect(sent().map((m) => m.msg.op)).toEqual(['recovery', 'unlock']);
    expect(logs.join('\n')).toContain('unlock id not recorded');
    // Nor does a failed append itself fail the route.
    failGet = undefined;
    failUpdate = undefined;
    const before = ddb.commandCalls(UpdateCommand).length;
    onUpdate = (i) => {
      if (i.TableName === 'vaults' && String(i.UpdateExpression).startsWith('SET recovery.unlock_ids')) {
        onUpdate = undefined;
        throw Object.assign(new Error('unavailable'), { name: 'InternalServerError' });
      }
    };
    await unlock(U2);
    expect(ddb.commandCalls(UpdateCommand).length).toBeGreaterThan(before);
    expect(sent().map((m) => m.msg.op)).toEqual(['recovery', 'unlock', 'unlock']);
  });

  test('a stalled notice the sweep takes up from its own row is audited with source `notice`', async () => {
    const rid = await request();
    put('requests', { request_id: `rcnotice#${rid}`, vault_id: VID, user_guid: 'g1', recovery_id: rid, notice_tries: 1, noticing: clock - vault.ATTEMPT_RETRY_S - 1, expires_at: clock + 3 * DAY });
    expect(await sweep()).toEqual({ found: 1, noticed: 1, failed: 0 });
    expect(rec()).toMatchObject({ state: 'cancelled', cancelled_via: 'app' });
    expect(audits('vault.recovery_cancel').map((a) => a.detail)).toEqual([{ vault_id: VID, recovery_id: rid, via: 'app', source: 'notice' }]);
    expect(subjects()).toEqual(['VettID vault recovery requested', 'VettID vault recovery cancelled']);
  });

  test('a status read whose row names an ended recovery reads nothing from the request table for it', async () => {
    const rid = await request();
    expect(await siteCancel(rid)).toEqual({ cancelled: true });
    getItem('vaults', VID).recovery_cancelled = { recovery_id: rid, at: clock };
    ddb.resetHistory();
    await status();
    await recovery();
    const reads = ddb.commandCalls(GetCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'requests');
    expect(reads.filter((i) => String(i.Key!.request_id).startsWith('rcnotice#'))).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'requests' && String(i.Key!.request_id).startsWith('rcnotice#'))).toHaveLength(0);
  });

  test('the unlock slots under a recovery are extended with it when its expires_at moves (the enclave\'s times)', async () => {
    const rid = await request();
    await unlock(U1);
    const later = clock + 5 * DAY;
    Object.assign(getItem('requests', rid), { status: 'done', envelope: Buffer.alloc(5_252, 0x33).toString('base64'), not_before: isoS(clock + DAY), expires: isoS(later) });
    await recovery();
    expect(rec().expires_at).toBe(later);
    expect(getItem('requests', U1).expires_at).toBe(later + 3600);
  });

  describe('a cancel names its recovery from RECOVERY_CANCEL_ID_FROM_RELEASE (§11.14.8)', () => {
    const cancelMsg = () => sent().filter((m) => m.msg.op === 'recovery_cancel').pop()!.msg;

    test('unset: never named; the seven-line form', async () => {
      const rid = await request();
      expect(await siteCancel(rid)).toEqual({ cancelled: true });
      const msg = cancelMsg();
      expect(msg.recovery_id).toBeUndefined();
      expect(verifies(msg)).toBe(true);
      expect(verifies(msg, rid)).toBe(false);
    });

    test('at the release: recovery_id and the eight-line signature; a stripped or changed id fails it', async () => {
      process.env.RECOVERY_CANCEL_ID_FROM_RELEASE = '14';
      const rid = await request();
      expect(await siteCancel(rid)).toEqual({ cancelled: true });
      const msg = cancelMsg();
      expect(msg.recovery_id).toBe(rid);
      expect(Object.keys(msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'recovery_id', 'signed_at', 'key_id', 'sig', 'enqueued_at']);
      expect(verifies(msg, rid)).toBe(true);
      // Stripped (the host removes the member): the seven-line string does not verify.
      expect(verifies(msg)).toBe(false);
      expect(verifies(msg, RID)).toBe(false);
      // The link route names it too.
      const token = /cancel#t=([A-Za-z0-9_-]{43})/.exec(mails().filter((m) => m.subject === 'VettID vault recovery requested').pop()!.text)![1];
      const rid2 = await request();
      const token2 = /cancel#t=([A-Za-z0-9_-]{43})/.exec(mails().pop()!.text)![1];
      expect(token2).not.toBe(token);
      tick();
      expect((await call('POST', '/api/vault/recovery/cancel-link', { token: token2 }, { guid: 'nobody' })).body).toEqual({ cancelled: true });
      expect(cancelMsg().recovery_id).toBe(rid2);
      expect(verifies(cancelMsg(), rid2)).toBe(true);
    });

    test.each(['15', 'x', '', '0'])('below the release, or a malformed setting (%j): the seven-line form', async (v) => {
      process.env.RECOVERY_CANCEL_ID_FROM_RELEASE = v;
      const rid = await request();
      expect(await siteCancel(rid)).toEqual({ cancelled: true });
      const msg = cancelMsg();
      expect(msg.recovery_id).toBeUndefined();
      expect(verifies(msg)).toBe(true);
    });

    test('an instance whose release has no row: the seven-line form', async () => {
      process.env.RECOVERY_CANCEL_ID_FROM_RELEASE = '1';
      expect(await vault.cancelNamesRecovery({ release: R1 })).toBe(false);
      expect(await vault.cancelNamesRecovery({ release: R0 })).toBe(true);
    });
  });
});
