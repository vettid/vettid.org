/**
 * Member API, vault routes: /api/vault/*  (docs/MEMBER-API.md "Vault",
 * docs/VAULT-MESSAGING.md §11 alternate channel)
 *
 * The API is a router and a mailbox, nothing more:
 *  - it picks the enclave instance a member's app should seal to
 *    (GET /api/vault/enclave: the live lease, else a live instance of the
 *    vault's sealed release, else it asks for one to be started);
 *  - it checks the size and the clear header of each sealed envelope, never
 *    its contents, and forwards it to that instance's SQS queue only if the
 *    instance still holds the vault's lease (or nobody does);
 *  - the parent writes the enclave's sealed answer into the request table,
 *    which the app polls.
 *
 * It never sees or stores PINs, keys, mailbox ids or device identifiers
 * (§11.5). Envelopes are never logged.
 *
 * Recovery (§11.11, docs/MEMBER-API.md "Vault recovery"): the API records
 * the request on the vault row (`recovery`), routes the recovery operations
 * like a lock, keeps the enclave's browser-sealed code in the request's
 * slot until the recovery expires, and releases it only after 24 h. It
 * never holds the code itself, only that ciphertext; cancel-link tokens are
 * stored as their SHA-256 in request-table rows that expire with the
 * recovery.
 *
 * Shared contract with the enclave host (vettid/vettid-vault, the parent):
 *  - vaults table, PK vault_id: { vault_id, user_guid, state,
 *    lease: { instance_id, lease_expires_at (epoch s) }, sealed_release,
 *    vault_version, state_version, created_at, updated_at }. The API creates
 *    the row (state `enrolling`); the parent owns lease and lifecycle fields.
 *    Rows keyed `user#<user_guid>` are the API's per-member pointer
 *    (`current_vault_id`) and never carry user_guid.
 *  - vault-instances table, PK instance_id: { instance_id, release (PCR0 hex),
 *    queue_url, descriptor (b64 exact bytes), attestation (b64), heartbeat_at
 *    (epoch s), expires_at (TTL), load? }.
 *  - vault-requests table, PK request_id: the API puts { request_id,
 *    vault_id, user_guid, op, status: queued, instance_id, created_at,
 *    expires_at }; the parent sets status `done` and `envelope` (b64 of a
 *    5,252-byte sealed result) and/or `code` (e.g. etk_unknown).
 *  - vault-releases table, PK release (PCR0 hex): { release, release_number,
 *    status: active|deprecated|retired, available? }, rendered from the
 *    signed manifest by operations. The API records on-demand start requests
 *    on it (start_requested_at); acting on them is infrastructure (V5).
 */
import { createHash, randomBytes } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { ddb, env, table } from '../shared/aws';
import { HttpError, Router, badRequest, forbidden, notFound } from '../shared/http';
import { nowIso } from '../shared/ids';
import { ApiError, MemberRequest, RateLimited, WithStatus, memberHandler, requireSession } from '../shared/member-http';
import { canSignIn, currentTerms, memberByGuid, vaultPointerKey } from '../shared/members';
import type { MemberItem } from '../shared/model';
import { hit } from '../shared/ratelimit';
import { sendMail } from '../shared/mail';

const sqs = new SQSClient({});
const router = new Router<MemberRequest>();

// ---- wire constants (VAULT-MESSAGING §5.2, §5.4, §11) ------------------------------

/** Sealed-mode overhead: 20-byte clear header + 1,120-byte HPKE enc + 16-byte tag. */
const SEALED_OVERHEAD = 1_156;
/** vault.enroll / vault.unlock: inner plaintext padded to exactly 12,288 bytes. */
export const ENVELOPE_BYTES_LARGE = 12_288 + SEALED_OVERHEAD; // 13,444
/** Every other alternate-channel envelope: 4,096 bytes padded. */
export const ENVELOPE_BYTES_SMALL = 4_096 + SEALED_OVERHEAD; // 5,252
/** Every sealed result in a response slot is a 4,096-padded envelope (§11.3, §11.4, §11.5). */
export const RESULT_ENVELOPE_BYTES = ENVELOPE_BYTES_SMALL; // 5,252

/** An instance is live if it heartbeat within this many seconds. */
export const LIVE_HEARTBEAT_S = 90;
/** What 503 release_starting tells the app to wait. */
export const START_RETRY_AFTER_S = 30;
/** Request slots live 15 minutes (§11.5). */
const REQUEST_TTL_S = 15 * 60;
/** Queue retention (§11.5); a request still queued after this (+ slack) has expired. */
const QUEUE_RETENTION_S = 5 * 60;
const EXPIRY_SLACK_S = 30;

// ---- validation ------------------------------------------------------------------

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const VAULT_ID_RE = /^[0-9a-f]{32}$/;
const KID_RE = /^[0-9a-f]{16}$/;
const PCR0_RE = /^[0-9a-f]{96}$/;
/** Becomes part of an SQS queue name (≤ 80 chars incl. the prefix). */
export const INSTANCE_ID_RE = /^[A-Za-z0-9_-]{1,48}$/;
const CODE_RE = /^[a-z_][a-z0-9_]{0,63}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function field(body: Record<string, unknown>, key: string, re: RegExp, what: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !re.test(v)) throw badRequest(`${key} must be ${what}`);
  return v;
}

/** Canonical standard base64 with padding (no whitespace), or null. */
export function decodeCanonicalB64(s: string): Buffer | null {
  if (s.length % 4 !== 0 || !B64_RE.test(s)) return null;
  const buf = Buffer.from(s, 'base64');
  return buf.toString('base64') === s ? buf : null;
}

/**
 * Size and clear-header check of a sealed alternate-channel envelope
 * (§5.2): v2, suite 2, sealed mode, flags 0, all-zero sender_kid (§11.3),
 * recipient_kid = the ETK kid the request names, and exactly the padded
 * size of its op. The ciphertext is never inspected.
 */
export function checkEnvelope(b64: unknown, expectedBytes: number, etkKid: string): string {
  if (typeof b64 !== 'string') throw badRequest('envelope is required');
  // Cheap length check before decoding anything.
  if (b64.length !== Math.ceil(expectedBytes / 3) * 4) throw badRequest('envelope has the wrong size');
  const buf = decodeCanonicalB64(b64);
  if (!buf || buf.length !== expectedBytes) throw badRequest('envelope has the wrong size or encoding');
  const header = buf.subarray(0, 20);
  const ok =
    header[0] === 0x02 && // ver
    header[1] === 0x02 && // suite
    header[2] === 0x02 && // mode: sealed
    header[3] === 0x00 && // flags
    header.subarray(4, 12).every((b) => b === 0) && // sender_kid: anonymous
    header.subarray(12, 20).toString('hex') === etkKid; // recipient_kid
  if (!ok) throw badRequest('envelope header does not match a sealed request to etk_kid');
  return b64;
}

// ---- types -------------------------------------------------------------------------

export interface Lease {
  instance_id: string;
  lease_expires_at: number;
}

export interface VaultRow {
  vault_id: string;
  user_guid: string;
  state: 'enrolling' | 'locked' | 'unlocked' | 'deleted';
  lease?: Lease;
  sealed_release?: string;
  vault_version?: string;
  state_version?: string | number;
  /** API-owned: the recovery in progress or last ended (VAULT-MESSAGING §11.11). */
  recovery?: RecoveryRow;
  created_at: string;
  updated_at: string;
}

export interface RecoveryRow {
  recovery_id: string;
  state: 'pending' | 'cancelled';
  requested_at: number; // epoch s
  available_at: number;
  expires_at: number;
}

export interface InstanceRow {
  instance_id: string;
  release: string;
  queue_url: string;
  descriptor: string;
  attestation: string;
  heartbeat_at: number;
  load?: number;
}

interface ReleaseRow {
  release: string;
  release_number: number;
  status: 'active' | 'deprecated' | 'retired';
  /** false once the release's image can no longer be started (§11.10.5). */
  available?: boolean;
}

type Op = 'enroll' | 'unlock' | 'lock' | 'recovery' | 'recovery_cancel' | 'recovery_register';

// ---- errors (§11.1, §11.9, §11.10.5) ------------------------------------------------
// Bodies carry the MEMBER-API `error` and also the spec's `code`.

const vaultError = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ApiError(status, code, message, { code, ...extra });

const instanceMoved = () =>
  vaultError(409, 'instance_moved', 'The vault is now served by another enclave instance; fetch /api/vault/enclave again and re-seal.');
const releaseUnavailable = () => vaultError(410, 'release_unavailable', 'The enclave release this vault is sealed to can no longer be started.');
const releaseStarting = (release: string) =>
  vaultError(503, 'release_starting', 'An enclave for this vault is starting; retry shortly.', { release, retry_after: START_RETRY_AFTER_S });

// ---- clock -------------------------------------------------------------------------

const nowS = () => Math.floor(Date.now() / 1000);

// ---- member gate -------------------------------------------------------------------

/**
 * Access (§11.1):
 *  - lock: any signed-in account holder with a vault, whatever the account
 *    state, including a canceled account in its grace period (locking only
 *    reduces exposure);
 *  - status and request polling: an active account (cancellation blocks them);
 *  - enclave, enroll, unlock: an active account in state `member` that has
 *    accepted the current terms, else 403 terms_required.
 */
async function loadAccountHolder(req: MemberRequest): Promise<MemberItem> {
  const s = await requireSession(req);
  const m = await memberByGuid(s.user_guid);
  if (!m || m.email !== s.email) throw forbidden('This account is not active');
  return m;
}

async function loadActiveAccount(req: MemberRequest): Promise<MemberItem> {
  const m = await loadAccountHolder(req);
  if (!canSignIn(m)) throw forbidden('This account is not active');
  return m;
}

async function loadVaultMember(req: MemberRequest): Promise<MemberItem> {
  const m = await loadActiveAccount(req);
  if (m.state !== 'member') throw vaultError(403, 'terms_required', 'Accept the membership terms to use the vault');
  const terms = await currentTerms();
  if (terms && terms.version_id !== m.terms_version) {
    throw vaultError(403, 'terms_required', 'The membership terms have changed; accept the current terms to use the vault');
  }
  return m;
}

async function limit(key: string, max: number, windowS: number): Promise<void> {
  const r = await hit(key, max, windowS);
  if (!r.allowed) throw new RateLimited(r.retryAfter);
}

// ---- vault rows --------------------------------------------------------------------

const memberPointerKey = vaultPointerKey;

/** The member's current vault, read consistently through the per-member pointer row. */
async function currentVault(guid: string): Promise<{ pointer: string | null; vault: VaultRow | null }> {
  const p = await ddb.send(new GetCommand({ TableName: table.vaults(), Key: { vault_id: memberPointerKey(guid) }, ConsistentRead: true }));
  const pointer = typeof p.Item?.current_vault_id === 'string' ? (p.Item.current_vault_id as string) : null;
  if (!pointer) return { pointer: null, vault: null };
  const v = await ddb.send(new GetCommand({ TableName: table.vaults(), Key: { vault_id: pointer }, ConsistentRead: true }));
  const row = v.Item as VaultRow | undefined;
  return { pointer, vault: row && row.user_guid === guid ? row : null };
}

/** Current vault unless it has been deleted. */
const activeVault = (v: VaultRow | null) => (v && v.state !== 'deleted' ? v : null);

/**
 * The vault an enrollment targets: the member's existing vault if it isn't
 * deleted (the enclave decides whether a provisional vault may be replaced
 * and answers vault_exists for a confirmed one, §11.3), else a new one.
 */
async function vaultForEnrollment(guid: string, cur: { pointer: string | null; vault: VaultRow | null }): Promise<VaultRow> {
  const existing = activeVault(cur.vault);
  if (existing) return existing;
  const vaultId = randomBytes(16).toString('hex'); // 128-bit, opaque (§11.5)
  const now = nowIso();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: memberPointerKey(guid) },
        UpdateExpression: 'SET current_vault_id = :new, updated_at = :now',
        ConditionExpression: cur.pointer ? 'current_vault_id = :old' : 'attribute_not_exists(vault_id)',
        ExpressionAttributeValues: { ':new': vaultId, ':now': now, ...(cur.pointer ? { ':old': cur.pointer } : {}) },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw vaultError(409, 'conflict', 'Another enrollment is in progress; try again');
    throw e;
  }
  const row: VaultRow = { vault_id: vaultId, user_guid: guid, state: 'enrolling', created_at: now, updated_at: now };
  await ddb.send(new PutCommand({ TableName: table.vaults(), Item: row, ConditionExpression: 'attribute_not_exists(vault_id)' }));
  return row;
}

// ---- instances, leases, releases -----------------------------------------------------

/** The queue URL an instance must use: the API never sends anywhere else. */
export const expectedQueueUrl = (instanceId: string) => `${env('VAULT_QUEUE_URL_PREFIX')}${instanceId}`;

const isLive = (i: InstanceRow | undefined, now: number): i is InstanceRow =>
  !!i &&
  INSTANCE_ID_RE.test(i.instance_id) &&
  typeof i.heartbeat_at === 'number' &&
  i.heartbeat_at >= now - LIVE_HEARTBEAT_S &&
  i.queue_url === expectedQueueUrl(i.instance_id) &&
  typeof i.descriptor === 'string' &&
  typeof i.attestation === 'string';

async function liveInstance(instanceId: string, now: number): Promise<InstanceRow | null> {
  if (!INSTANCE_ID_RE.test(instanceId)) return null;
  const r = await ddb.send(new GetCommand({ TableName: table.vaultInstances(), Key: { instance_id: instanceId } }));
  const i = r.Item as InstanceRow | undefined;
  return isLive(i, now) ? i : null;
}

/**
 * The instance holding a live lease on the vault, or null. A lease counts
 * as live only while it is unexpired AND its holder is a live instance: a
 * crashed holder does not strand the vault until its lease runs out. Leases
 * are a routing aid only; the parent's conditional lease write and the
 * split-brain guard (§12.3) keep two instances from running one vault.
 */
async function liveLease(v: VaultRow | null, now: number): Promise<InstanceRow | null> {
  const l = v?.lease;
  if (!l || typeof l.instance_id !== 'string' || typeof l.lease_expires_at !== 'number' || l.lease_expires_at <= now) return null;
  return liveInstance(l.instance_id, now);
}

async function releaseRow(release: string): Promise<ReleaseRow | null> {
  const r = await ddb.send(new GetCommand({ TableName: table.vaultReleases(), Key: { release } }));
  return (r.Item as ReleaseRow | undefined) ?? null;
}

/** A live instance of `release`, least loaded first, then freshest heartbeat. */
async function pickInstance(release: string, now: number): Promise<InstanceRow | null> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: table.vaultInstances(),
      IndexName: 'release-index',
      KeyConditionExpression: '#r = :r AND heartbeat_at >= :cut',
      ExpressionAttributeNames: { '#r': 'release' },
      ExpressionAttributeValues: { ':r': release, ':cut': now - LIVE_HEARTBEAT_S },
    }),
  );
  const candidates = ((r.Items ?? []) as Pick<InstanceRow, 'instance_id' | 'heartbeat_at' | 'load'>[]).sort(
    (a, b) => (a.load ?? 0) - (b.load ?? 0) || b.heartbeat_at - a.heartbeat_at,
  );
  for (const c of candidates.slice(0, 5)) {
    const i = await liveInstance(c.instance_id, now);
    if (i && i.release === release) return i;
  }
  return null;
}

/**
 * Ask for an instance of `release` to be started. For now this only records
 * the request on the release row; the infrastructure that acts on it is V5
 * (VAULT-PLAN §4). Only start-request attributes are writable by the API.
 */
async function requestStart(release: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: table.vaultReleases(),
      Key: { release },
      UpdateExpression: 'SET start_requested_at = :now ADD start_requests :one',
      ConditionExpression: 'attribute_exists(#r)',
      ExpressionAttributeNames: { '#r': 'release' },
      ExpressionAttributeValues: { ':now': nowIso(), ':one': 1 },
    }),
  );
}

const describe = (i: InstanceRow) => ({ instance_id: i.instance_id, release: i.release, descriptor: i.descriptor, attestation: i.attestation });

/** Route to `release`: a live instance, else start one (503), unless it can't run (410). */
async function routeToRelease(release: string, now: number) {
  const rel = await releaseRow(release);
  if (!rel || rel.available === false) throw releaseUnavailable();
  const inst = await pickInstance(release, now);
  if (inst) return describe(inst);
  await requestStart(release);
  throw releaseStarting(release);
}

/** Enrollment: the newest `active` release with a live instance, else start the newest. */
async function routeForEnrollment(now: number) {
  const r = await ddb.send(
    new QueryCommand({
      TableName: table.vaultReleases(),
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :a',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':a': 'active' },
      ScanIndexForward: false, // newest release_number first
    }),
  );
  const active = ((r.Items ?? []) as ReleaseRow[]).filter((x) => x.available !== false && PCR0_RE.test(x.release));
  if (!active.length) throw vaultError(503, 'vault_unavailable', 'The vault service is not available yet', { retry_after: 300 });
  for (const rel of active) {
    const inst = await pickInstance(rel.release, now);
    if (inst) return describe(inst);
  }
  await requestStart(active[0].release);
  throw releaseStarting(active[0].release);
}

// ---- requests ------------------------------------------------------------------------

/**
 * Create the response slot, then enqueue. The slot exists before the
 * message, so the parent can always answer into it.
 */
async function enqueue(
  op: Op,
  m: MemberItem,
  vault: VaultRow,
  requestId: string,
  inst: InstanceRow,
  sealed?: { etk_kid: string; envelope: string },
  opts: { extra?: Record<string, string>; ttlS?: number } = {},
): Promise<void> {
  const created = nowIso();
  try {
    await ddb.send(
      new PutCommand({
        TableName: table.vaultRequests(),
        Item: {
          request_id: requestId,
          vault_id: vault.vault_id,
          user_guid: m.user_guid,
          op,
          status: 'queued',
          instance_id: inst.instance_id,
          created_at: created,
          expires_at: nowS() + (opts.ttlS ?? REQUEST_TTL_S),
        },
        ConditionExpression: 'attribute_not_exists(request_id)',
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw vaultError(409, 'duplicate_request', 'request_id has already been used');
    throw e;
  }
  // §11.5 queue message, in the spec's member order. Lock carries no envelope.
  const message = {
    v: 1,
    op,
    vault_id: vault.vault_id,
    user_guid: m.user_guid,
    request_id: requestId,
    ...(sealed ? { etk_kid: sealed.etk_kid, envelope: sealed.envelope } : {}),
    ...(opts.extra ?? {}),
    enqueued_at: created,
  };
  try {
    await sqs.send(new SendMessageCommand({ QueueUrl: inst.queue_url, MessageBody: JSON.stringify(message) }));
  } catch (e) {
    const name = (e as Error).name;
    // Never log the message or the error object (it could echo the request).
    console.error('vault enqueue failed', JSON.stringify({ op, request_id: requestId, instance_id: inst.instance_id, error: name }));
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaultRequests(),
        Key: { request_id: requestId },
        UpdateExpression: 'SET #s = :e',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':e': 'expired' },
      }),
    );
    if (name === 'QueueDoesNotExist' || name === 'AWS.SimpleQueueService.NonExistentQueue') throw instanceMoved();
    throw new HttpError(500, 'internal', 'Could not queue the request');
  }
}

/** Forward only to the leaseholder, or to any live instance while nobody holds the lease (§11.1). */
async function routeCheck(vault: VaultRow | null, instanceId: string, now: number): Promise<InstanceRow> {
  const inst = await liveInstance(instanceId, now);
  if (!inst) throw instanceMoved();
  const holder = await liveLease(vault, now);
  if (holder && holder.instance_id !== instanceId) throw instanceMoved();
  return inst;
}

// ---- routes --------------------------------------------------------------------------

router.on('GET', '/api/vault/status', async (req) => {
  const m = await loadActiveAccount(req);
  await limit(`vault-status#${m.user_guid}`, 60, 60);
  const now = nowS();
  const v = activeVault((await currentVault(m.user_guid)).vault);
  if (!v) return { vault: null };
  return {
    vault: {
      vault_id: v.vault_id,
      state: v.state,
      sealed_release: v.sealed_release ?? null,
      vault_version: v.vault_version ?? null,
      state_version: v.state_version ?? null,
      // Advisory (lifecycle values come from the host and are never used for security, §11.5).
      leased: !!v.lease && typeof v.lease.lease_expires_at === 'number' && v.lease.lease_expires_at > now,
      // So owner apps can show a recovery in progress and offer to cancel it (§11.11.7).
      recovery: recoveryActive(v.recovery, now) ? { state: recoveryState(v.recovery, now), available_at: iso(v.recovery!.available_at) } : null,
      created_at: v.created_at,
      updated_at: v.updated_at,
    },
  };
});

router.on('GET', '/api/vault/enclave', async (req) => {
  const m = await loadVaultMember(req);
  await limit(`vault-enclave#${m.user_guid}`, 30, 60);
  const now = nowS();
  const requested = req.query.release;
  if (requested !== undefined && !PCR0_RE.test(requested)) throw badRequest('release must be a PCR0 (96 lowercase hex)');
  const vault = activeVault((await currentVault(m.user_guid)).vault);
  const holder = await liveLease(vault, now);

  if (requested !== undefined) {
    // §11.10.5: only for abandoning an unconfirmed move, so only for an existing vault.
    if (!vault) throw notFound('No vault is enrolled');
    if (holder) {
      if (holder.release === requested) return describe(holder);
      throw vaultError(409, 'vault_busy', 'The vault is open on another release; retry after its lease ends', {
        retry_after: Math.max(1, vault.lease!.lease_expires_at - now),
      });
    }
    return routeToRelease(requested, now);
  }
  if (holder) return describe(holder);
  if (vault?.sealed_release) return routeToRelease(vault.sealed_release, now);
  return routeForEnrollment(now);
});

router.on('POST', '/api/vault/enroll', async (req) => {
  const m = await loadVaultMember(req);
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  const instanceId = field(req.body, 'instance_id', INSTANCE_ID_RE, 'an instance id');
  const etkKid = field(req.body, 'etk_kid', KID_RE, '16 lowercase hex');
  const envelope = checkEnvelope(req.body.envelope, ENVELOPE_BYTES_LARGE, etkKid);
  await limit(`vault-enroll#${m.user_guid}`, 3, 86_400);

  const now = nowS();
  const cur = await currentVault(m.user_guid);
  const inst = await routeCheck(activeVault(cur.vault), instanceId, now);
  // Enrollment goes to an instance of an `active` release (§11.1).
  if ((await releaseRow(inst.release))?.status !== 'active') throw instanceMoved();
  const vault = await vaultForEnrollment(m.user_guid, cur);
  await enqueue('enroll', m, vault, requestId, inst, { etk_kid: etkKid, envelope });
  await audit(m.email, 'vault.enroll_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: instanceId, release: inst.release });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('POST', '/api/vault/unlock', async (req) => {
  const m = await loadVaultMember(req);
  const vaultId = field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex');
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  const instanceId = field(req.body, 'instance_id', INSTANCE_ID_RE, 'an instance id');
  const etkKid = field(req.body, 'etk_kid', KID_RE, '16 lowercase hex');
  const envelope = checkEnvelope(req.body.envelope, ENVELOPE_BYTES_LARGE, etkKid);
  await limit(`vault-unlock#${m.user_guid}`, 10, 15 * 60);
  // Per source network: an IPv6 /64, or an IPv4 address (carrier NAT puts
  // many members behind one address, hence the higher limit; §11.8).
  await limit(`vault-unlock-net#${req.ip}`, req.ip.endsWith('/64') ? 10 : 60, 15 * 60);

  const vault = activeVault((await currentVault(m.user_guid)).vault);
  if (!vault || vault.vault_id !== vaultId) throw notFound('No such vault');
  const inst = await routeCheck(vault, instanceId, nowS());
  await enqueue('unlock', m, vault, requestId, inst, { etk_kid: etkKid, envelope });
  await audit(m.email, 'vault.unlock_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: instanceId, release: inst.release });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('POST', '/api/vault/lock', async (req) => {
  const m = await loadAccountHolder(req);
  const vaultId = field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex');
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  await limit(`vault-lock#${m.user_guid}`, 30, 15 * 60);

  const vault = activeVault((await currentVault(m.user_guid)).vault);
  if (!vault || vault.vault_id !== vaultId) throw notFound('No such vault');
  const holder = await liveLease(vault, nowS());
  if (holder) {
    await enqueue('lock', m, vault, requestId, holder);
  } else {
    // Nobody holds the vault, so it is not running: nothing to lock.
    try {
      await ddb.send(
        new PutCommand({
          TableName: table.vaultRequests(),
          Item: { request_id: requestId, vault_id: vault.vault_id, user_guid: m.user_guid, op: 'lock', status: 'done', created_at: nowIso(), expires_at: nowS() + REQUEST_TTL_S },
          ConditionExpression: 'attribute_not_exists(request_id)',
        }),
      );
    } catch (e) {
      if ((e as Error).name === 'ConditionalCheckFailedException') throw vaultError(409, 'duplicate_request', 'request_id has already been used');
      throw e;
    }
  }
  await audit(m.email, 'vault.lock_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: holder?.instance_id ?? null });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('GET', '/api/vault/requests/{id}', async (req) => {
  const m = await loadActiveAccount(req);
  const requestId = req.params.id;
  if (!ULID_RE.test(requestId)) throw badRequest('Malformed request id');
  await limit(`vault-poll#${m.user_guid}`, 2, 1);
  const r = await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: requestId }, ConsistentRead: true }));
  const item = r.Item;
  const now = nowS();
  if (!item || item.user_guid !== m.user_guid || Number(item.expires_at) <= now) throw notFound('No such request');

  let status = String(item.status);
  if (status === 'queued' && Date.parse(String(item.created_at)) / 1000 + QUEUE_RETENTION_S + EXPIRY_SLACK_S < now) status = 'expired';
  if (status !== 'queued' && status !== 'done' && status !== 'expired') status = 'expired';
  // §11.5: {status, envelope?, code?}. The envelope (vault.enroll.result,
  // vault.unlock.result, or random bytes of the same size) is opaque here;
  // anything but exactly 5,252 bytes is not passed on.
  const out: Record<string, unknown> = { status };
  if (status === 'done') {
    const env = typeof item.envelope === 'string' ? decodeCanonicalB64(item.envelope) : null;
    if (env && env.length === RESULT_ENVELOPE_BYTES) out.envelope = item.envelope;
    if (typeof item.code === 'string' && CODE_RE.test(item.code)) out.code = item.code;
  }
  return out;
});

// ---- recovery (VAULT-MESSAGING §11.11) ------------------------------------------------
//
// The code is minted inside the enclave and reaches the API only sealed to a
// P-256 key held by the member's browser: the slot of the `recovery` request
// holds that ciphertext until the recovery expires. The API gates when it is
// released; the enclave enforces the same times on its own.

/** The code becomes usable 24 h after the request, for 24 h (§11.11.2). */
export const RECOVERY_DELAY_S = 24 * 3600;
export const RECOVERY_VALIDITY_S = 24 * 3600;
const CANCEL_LINK_PREFIX = 'rcancel#';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
const iso = (s: number) => new Date(s * 1000).toISOString();

type RecoveryState = 'pending' | 'available' | 'cancelled' | 'expired';

export function recoveryState(r: RecoveryRow | undefined, now: number): RecoveryState | null {
  if (!r) return null;
  if (r.state === 'cancelled') return 'cancelled';
  if (now >= r.expires_at) return 'expired';
  return now >= r.available_at ? 'available' : 'pending';
}

const recoveryActive = (r: RecoveryRow | undefined, now: number) => {
  const st = recoveryState(r, now);
  return st === 'pending' || st === 'available';
};

/** A vault that recovery can act on: enrolled (not `enrolling`) and not deleted. */
async function recoverableVault(guid: string): Promise<VaultRow> {
  const v = activeVault((await currentVault(guid)).vault);
  if (!v || v.state === 'enrolling') throw notFound('No enrolled vault');
  return v;
}

/** The instance a recovery operation goes to: the leaseholder, else one of the sealed release. */
async function recoveryInstance(v: VaultRow, now: number): Promise<InstanceRow> {
  const holder = await liveLease(v, now);
  if (holder) return holder;
  if (!v.sealed_release) throw vaultError(409, 'conflict', 'The vault is not sealed to a release yet');
  const rel = await releaseRow(v.sealed_release);
  if (!rel || rel.available === false) throw releaseUnavailable();
  const inst = await pickInstance(v.sealed_release, now);
  if (inst) return inst;
  await requestStart(v.sealed_release);
  throw releaseStarting(v.sealed_release);
}

/** Write the recovery, conditional on the one read (or none): concurrent requests cannot both win. */
async function setRecovery(v: VaultRow, r: RecoveryRow, expectId: string | null): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET recovery = :r, updated_at = :now',
        ConditionExpression: expectId ? 'recovery.recovery_id = :id' : 'attribute_not_exists(recovery)',
        ExpressionAttributeValues: { ':r': r, ':now': nowIso(), ...(expectId ? { ':id': expectId } : {}) },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw vaultError(409, 'conflict', 'The recovery changed; try again');
    throw e;
  }
}

/** System email; a failed send (e.g. SES sandbox) is logged, never fatal. */
async function notify(to: string, subject: string, text: string): Promise<void> {
  try {
    await sendMail(to, subject, text);
  } catch (e) {
    console.error('recovery mail failed', JSON.stringify({ error: (e as Error).name }));
  }
}

const requestedMail = (cancelUrl: string, availableAt: number) => `A recovery of your VettID vault was requested from your account.

Your vault has been locked. If nobody cancels, a one-time recovery code becomes available on your account page at ${iso(availableAt)}, for 24 hours. A new app then needs the code, your vault PIN and your credential password.

If you did not ask for this, cancel it now:
${cancelUrl}

You can also cancel it from any of your VettID apps or from your account page.`;

/** Cancel: mark it, tell the enclave, tell the member. */
async function cancelRecovery(m: MemberItem, v: VaultRow, via: 'session' | 'link'): Promise<void> {
  const now = nowS();
  const r = v.recovery;
  if (!r || !recoveryActive(r, now)) return; // nothing to cancel: a no-op
  await setRecovery(v, { ...r, state: 'cancelled' }, r.recovery_id);
  try {
    const inst = await recoveryInstance(v, now);
    await enqueue('recovery_cancel', m, v, newUlid(), inst);
  } catch (e) {
    // The enclave also refuses the code if the API never releases it, but
    // a cancel that could not be queued is worth knowing about.
    console.error('recovery cancel not queued', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
  }
  await audit(m.email, 'vault.recovery_cancel', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id, via });
  await notify(m.email, 'VettID vault recovery cancelled', `The recovery of your VettID vault requested at ${iso(r.requested_at)} has been cancelled. Your apps can unlock the vault again.`);
}

/** A ULID for requests the API makes on its own (cancel). */
function newUlid(): string {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = A[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(16);
  let r = '';
  for (let i = 0; i < 16; i++) r += A[rnd[i] % 32];
  return time + r;
}

router.on('POST', '/api/vault/recovery', async (req) => {
  const m = await loadVaultMember(req);
  const bk = req.body.browser_key;
  const key = typeof bk === 'string' ? decodeCanonicalB64(bk) : null;
  if (!key || key.length !== 65 || key[0] !== 0x04) throw badRequest('browser_key must be base64 of an uncompressed P-256 point');
  await limit(`vault-recovery#${m.user_guid}`, 3, 86_400);
  const now = nowS();
  const v = await recoverableVault(m.user_guid);
  if (recoveryActive(v.recovery, now)) throw vaultError(409, 'recovery_active', 'A recovery is already in progress');
  const inst = await recoveryInstance(v, now);
  const recoveryId = newUlid();
  const r: RecoveryRow = { recovery_id: recoveryId, state: 'pending', requested_at: now, available_at: now + RECOVERY_DELAY_S, expires_at: now + RECOVERY_DELAY_S + RECOVERY_VALIDITY_S };
  await setRecovery(v, r, v.recovery?.recovery_id ?? null);
  // The slot keeps the sealed code until the recovery expires.
  await enqueue('recovery', m, v, recoveryId, inst, undefined, { extra: { browser_key: bk as string }, ttlS: r.expires_at - now + 3600 });
  const token = randomBytes(32).toString('base64url');
  await ddb.send(
    new PutCommand({
      TableName: table.vaultRequests(),
      Item: { request_id: CANCEL_LINK_PREFIX + sha256Hex(token), vault_id: v.vault_id, user_guid: m.user_guid, op: 'recovery_cancel_link', status: 'link', recovery_id: recoveryId, created_at: nowIso(), expires_at: r.expires_at },
      ConditionExpression: 'attribute_not_exists(request_id)',
    }),
  );
  await audit(m.email, 'vault.recovery_request', m.user_guid, { vault_id: v.vault_id, recovery_id: recoveryId, instance_id: inst.instance_id });
  await notify(m.email, 'VettID vault recovery requested', requestedMail(`https://${env('ACCOUNT_HOST')}/vault/recovery/cancel#t=${token}`, r.available_at));
  return new WithStatus(202, { recovery_id: recoveryId, available_at: iso(r.available_at), expires_at: iso(r.expires_at) });
});

router.on('GET', '/api/vault/recovery', async (req) => {
  const m = await loadVaultMember(req);
  await limit(`vault-recovery-status#${m.user_guid}`, 60, 60);
  const now = nowS();
  const v = activeVault((await currentVault(m.user_guid)).vault);
  const r = v?.recovery;
  const state = recoveryState(r, now);
  if (!v || !r || !state) return { recovery: null };
  const out: Record<string, unknown> = {
    recovery_id: r.recovery_id, state, requested_at: iso(r.requested_at), available_at: iso(r.available_at), expires_at: iso(r.expires_at),
  };
  if (state === 'available') {
    const slot = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: r.recovery_id }, ConsistentRead: true }))).Item;
    const env = slot && slot.user_guid === m.user_guid && slot.status === 'done' && typeof slot.envelope === 'string' ? decodeCanonicalB64(slot.envelope) : null;
    if (env && env.length === RESULT_ENVELOPE_BYTES) {
      out.sealed_code = slot!.envelope;
      if (!slot!.released) {
        await ddb.send(
          new UpdateCommand({
            TableName: table.vaultRequests(),
            Key: { request_id: r.recovery_id },
            UpdateExpression: 'SET released = :t',
            ExpressionAttributeValues: { ':t': true },
          }),
        );
        await audit(m.email, 'vault.recovery_code_released', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id });
      }
    }
  }
  return { recovery: out };
});

router.on('POST', '/api/vault/recovery/cancel', async (req) => {
  const m = await loadActiveAccount(req);
  const recoveryId = field(req.body, 'recovery_id', ULID_RE, 'a ULID');
  await limit(`vault-recovery-cancel#${m.user_guid}`, 30, 15 * 60);
  const v = activeVault((await currentVault(m.user_guid)).vault);
  if (!v || v.recovery?.recovery_id !== recoveryId) throw notFound('No such recovery');
  await cancelRecovery(m, v, 'session');
  return {};
});

// The email link: no session, the token stands in for it (§11.11.7).
router.on('POST', '/api/vault/recovery/cancel-link', async (req) => {
  await limit(`vault-recovery-link#${req.ip}`, 20, 15 * 60);
  const token = req.body.token;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw badRequest('token is malformed');
  const key = CANCEL_LINK_PREFIX + sha256Hex(token);
  const link = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: key }, ConsistentRead: true }))).Item;
  if (!link || link.op !== 'recovery_cancel_link' || Number(link.expires_at) <= nowS()) throw notFound('This link is no longer valid');
  const m = await memberByGuid(String(link.user_guid));
  const v = (await ddb.send(new GetCommand({ TableName: table.vaults(), Key: { vault_id: String(link.vault_id) }, ConsistentRead: true }))).Item as VaultRow | undefined;
  if (!m || !v || v.user_guid !== m.user_guid || v.recovery?.recovery_id !== link.recovery_id) throw notFound('This link is no longer valid');
  await cancelRecovery(m, v, 'link');
  return {};
});

router.on('POST', '/api/vault/recovery/register', async (req) => {
  const m = await loadVaultMember(req);
  const vaultId = field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex');
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  const instanceId = field(req.body, 'instance_id', INSTANCE_ID_RE, 'an instance id');
  const etkKid = field(req.body, 'etk_kid', KID_RE, '16 lowercase hex');
  const envelope = checkEnvelope(req.body.envelope, ENVELOPE_BYTES_LARGE, etkKid);
  await limit(`vault-recovery-register#${m.user_guid}`, 10, 86_400);
  const now = nowS();
  const vault = activeVault((await currentVault(m.user_guid)).vault);
  if (!vault || vault.vault_id !== vaultId) throw notFound('No such vault');
  if (recoveryState(vault.recovery, now) !== 'available') throw vaultError(409, 'recovery_not_available', 'No recovery code is valid now');
  const inst = await routeCheck(vault, instanceId, now);
  await enqueue('recovery_register', m, vault, requestId, inst, { etk_kid: etkKid, envelope });
  await audit(m.email, 'vault.recovery_register', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, recovery_id: vault.recovery!.recovery_id, instance_id: instanceId });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

export const handler = memberHandler(router);
