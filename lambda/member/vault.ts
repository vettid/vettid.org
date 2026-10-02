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
 *    expires_at }; the parent sets status `done` and `envelope` (b64, sealed)
 *    and/or `code` (e.g. etk_unknown).
 *  - vault-releases table, PK release (PCR0 hex): { release, release_number,
 *    status: active|deprecated|retired, available? }, rendered from the
 *    signed manifest by operations. The API records on-demand start requests
 *    on it (start_requested_at); acting on them is infrastructure (V5).
 */
import { randomBytes } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { ddb, env, table } from '../shared/aws';
import { HttpError, Router, badRequest, forbidden, notFound } from '../shared/http';
import { nowIso } from '../shared/ids';
import { ApiError, MemberRequest, RateLimited, WithStatus, memberHandler, requireSession } from '../shared/member-http';
import { canSignIn, currentTerms, memberByGuid } from '../shared/members';
import type { MemberItem } from '../shared/model';
import { hit } from '../shared/ratelimit';

const sqs = new SQSClient({});
const router = new Router<MemberRequest>();

// ---- wire constants (VAULT-MESSAGING §5.2, §5.4, §11) ------------------------------

/** Sealed-mode overhead: 20-byte clear header + 1,120-byte HPKE enc + 16-byte tag. */
const SEALED_OVERHEAD = 1_156;
/** vault.enroll / vault.unlock: inner plaintext padded to exactly 12,288 bytes. */
export const ENVELOPE_BYTES_LARGE = 12_288 + SEALED_OVERHEAD; // 13,444
/** Every other alternate-channel envelope: 4,096 bytes padded. */
export const ENVELOPE_BYTES_SMALL = 4_096 + SEALED_OVERHEAD; // 5,252
/** Response slots hold at most 8 KiB of envelope (§11.5). */
const RESPONSE_MAX_BYTES = 8 * 1024;

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
  created_at: string;
  updated_at: string;
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

type Op = 'enroll' | 'unlock' | 'lock';

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
 * Every vault route: an active account in state `member` that has accepted
 * the current terms. `registered` users, and members whose accepted terms
 * are no longer current, get 403 terms_required.
 */
async function loadVaultMember(req: MemberRequest): Promise<MemberItem> {
  const s = await requireSession(req);
  const m = await memberByGuid(s.user_guid);
  if (!canSignIn(m) || m.email !== s.email) throw forbidden('This account is not active');
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

const memberPointerKey = (guid: string) => `user#${guid}`;

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
          expires_at: nowS() + REQUEST_TTL_S,
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
  const m = await loadVaultMember(req);
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
  await limit(`vault-unlock-net#${req.ip}`, 10, 15 * 60);

  const vault = activeVault((await currentVault(m.user_guid)).vault);
  if (!vault || vault.vault_id !== vaultId) throw notFound('No such vault');
  const inst = await routeCheck(vault, instanceId, nowS());
  await enqueue('unlock', m, vault, requestId, inst, { etk_kid: etkKid, envelope });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('POST', '/api/vault/lock', async (req) => {
  const m = await loadVaultMember(req);
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
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('GET', '/api/vault/requests/{id}', async (req) => {
  const m = await loadVaultMember(req);
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
  const out: Record<string, unknown> = { request_id: requestId, op: item.op, status };
  if (status === 'done') {
    const env = typeof item.envelope === 'string' ? decodeCanonicalB64(item.envelope) : null;
    if (env && env.length <= RESPONSE_MAX_BYTES) out.envelope = item.envelope;
    if (typeof item.code === 'string' && CODE_RE.test(item.code)) out.code = item.code;
  }
  return out;
});

export const handler = memberHandler(router);
