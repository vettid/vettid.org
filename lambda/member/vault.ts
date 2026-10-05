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
 * recovery. A register slot answered with the host's `recovery_registered`
 * marker turns the recovery `registered` (VAULT-MESSAGING 0.10.6 §11.11.7):
 * the code is spent and no longer released.
 *
 * Status reports `unlocked` only under a live lease (0.10.6 §11.5): the
 * host's `locked` update can lag, or be lost for a vault locked over the
 * relay.
 *
 * Shared contract with the enclave host (vettid/vettid-vault, the parent):
 *  - vaults table, PK vault_id: { vault_id, user_guid, state,
 *    lease: { instance_id, lease_expires_at (epoch s) }, sealed_release,
 *    vault_version, state_version, created_at, updated_at, alarm: { kind,
 *    alarm_id (ULID), at (epoch s) }, alarm_pending: true }. The API creates
 *    the row (state `enrolling`); the parent owns lease, lifecycle and alarm
 *    fields (the alarm mailer only clears alarm_pending, VAULT-MESSAGING
 *    0.9.0 §11.5).
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
 *    status: active|deprecated|retired|removed, available?, rescue?,
 *    ends_at? }, rendered from the signed manifest by operations. The API
 *    records on-demand start requests on it (start_requested_at, at most
 *    every 30 s per release); the scaler acts on them (VAULT-RELEASES §8.6).
 *    An operator may add a row with status `canary` for a release under
 *    test (VAULT-RELEASES §10.1 step 9): it is routed only for members whose
 *    row has `vault_canary: true` (enrollment prefers it; for everyone else
 *    it is unknown, 410), and becomes an ordinary row when the published
 *    manifest lists it.
 *
 * Dark launch (VAULT-RELEASES §9): with no `active` release in the registry,
 * enroll and GET /api/vault/enclave answer 503 vault_unavailable; nothing is
 * created, queued or start-requested, and every route keeps its rate limit.
 *
 * Vault service pause (MEMBER-API 1.2.0 "Vault service pause"): while the
 * operator's switch is off, enclave, enroll, unlock, recovery request and
 * register answer 503 vault_unavailable (service: "paused") right after the
 * account checks, before body checks and rate limits; nothing is written,
 * queued or start-requested. Status (with `service`), polling, lock, the
 * recovery status and cancels stay; a cancel is queued only to a running
 * instance, never by a start request.
 *
 * Manifest by hash (VAULT-MESSAGING 0.10.0 §11.5): enroll and unlock carry
 * `manifest_sha256` in the clear; the API checks its format only and copies
 * it into the queue message, so the host can hand that manifest to the
 * enclave. `manifest_serial` travels only inside the sealed request.
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
import { vaultService } from '../shared/vault-service';
import {
  INSTANCE_ID_RE,
  type InstanceRow,
  LIVE_HEARTBEAT_S,
  type ReleaseRow,
  expectedQueueUrl,
  liveInstance,
  liveLease,
  newUlid,
  pickInstance,
  releaseRow,
  requestStart,
  isCanaryMember,
  routable,
} from '../shared/vault-routing';

export { INSTANCE_ID_RE, LIVE_HEARTBEAT_S, expectedQueueUrl };
export type { InstanceRow };

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
const SHA256_RE = /^[0-9a-f]{64}$/;
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
  /**
   * Host-owned: the last alarm the vault reported (VAULT-MESSAGING 0.9.0
   * §11.5), content-free. `alarm_pending` is cleared by the alarm mailer
   * (lambda/jobs/vault-alarms.ts). Advisory; never a security signal.
   */
  alarm?: { kind: string; alarm_id: string; at: number; emailed_at?: number };
  alarm_pending?: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecoveryRow {
  recovery_id: string;
  /** `registered`: a register request was answered with the enclave's marker (0.10.6 §11.11.7). */
  state: 'pending' | 'registered' | 'cancelled';
  requested_at: number; // epoch s
  available_at: number;
  expires_at: number;
  /** The register requests sent for this recovery, so their slots can be checked. */
  register_ids?: string[];
}

type Op = 'enroll' | 'unlock' | 'lock' | 'recovery' | 'recovery_cancel' | 'recovery_register';


// ---- errors (§11.1, §11.9, §11.10.5) ------------------------------------------------
// Bodies carry the MEMBER-API `error` and also the spec's `code`.

const vaultError = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ApiError(status, code, message, { code, ...extra });

const instanceMoved = () =>
  vaultError(409, 'instance_moved', 'The vault is now served by another enclave instance; fetch /api/vault/enclave again and re-seal.');
const releaseUnavailable = () =>
  vaultError(410, 'release_unavailable', 'The enclave release this vault is sealed to has ended or can no longer be started.');
const vaultUnavailable = () => vaultError(503, 'vault_unavailable', 'The vault service is not available yet', { retry_after: 300 });
/** What a paused vault service answers (also `Retry-After`, member-http). */
export const PAUSED_RETRY_AFTER_S = 300;
const vaultPaused = () =>
  vaultError(503, 'vault_unavailable', 'The vault service is paused for maintenance. Try again later.', { service: 'paused', retry_after: PAUSED_RETRY_AFTER_S });

/** Routes that start or change vault activity: refused while the operator has paused the service. */
async function requireService(): Promise<void> {
  if (!(await vaultService()).enabled) throw vaultPaused();
}

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

const describe = (i: InstanceRow) => ({ instance_id: i.instance_id, release: i.release, descriptor: i.descriptor, attestation: i.attestation });

/**
 * Route to `release`: a live instance, else start one (503), unless it
 * can't run or was removed (410). `canary`: the member may use canary
 * releases (VAULT-RELEASES §10.1 step 9); for anyone else a canary release
 * is unknown (410).
 */
async function routeToRelease(release: string, now: number, canary: boolean) {
  const rel = await releaseRow(release);
  if (!routable(rel, { canary })) throw releaseUnavailable();
  const inst = await pickInstance(release, now);
  if (inst) return describe(inst);
  await requestStart(release);
  throw releaseStarting(release);
}

/** The releases with `status` that can run, newest first. */
async function releasesWithStatus(status: 'active' | 'canary'): Promise<ReleaseRow[]> {
  const r = await ddb.send(
    new QueryCommand({
      TableName: table.vaultReleases(),
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :a',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':a': status },
      ScanIndexForward: false, // newest release_number first
    }),
  );
  return ((r.Items ?? []) as ReleaseRow[]).filter((x) => x.status === status && x.available !== false && PCR0_RE.test(x.release));
}

/**
 * What a new vault may be enrolled into, newest first: the `active`
 * releases; for a canary member, the `canary` releases instead while any
 * exists (the canary enrolls into the release under test, §10.1 step 9,
 * even before production release 1, when nothing is active). None (the
 * dark launch, VAULT-RELEASES §9) is 503 vault_unavailable.
 */
async function enrollmentTargets(canary: boolean): Promise<ReleaseRow[]> {
  if (canary) {
    const c = await releasesWithStatus('canary');
    if (c.length) return c;
  }
  const active = await releasesWithStatus('active');
  if (!active.length) throw vaultUnavailable();
  return active;
}

/** Enrollment: the newest target release with a live instance, else start the newest. */
async function routeForEnrollment(now: number, canary: boolean) {
  const targets = await enrollmentTargets(canary);
  for (const rel of targets) {
    const inst = await pickInstance(rel.release, now);
    if (inst) return describe(inst);
  }
  await requestStart(targets[0].release);
  throw releaseStarting(targets[0].release);
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
  sealed?: { etk_kid: string; envelope: string; manifest_sha256?: string },
  opts: { extra?: Record<string, string>; ttlS?: number; slot?: Record<string, string> } = {},
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
          ...(opts.slot ?? {}),
        },
        ConditionExpression: 'attribute_not_exists(request_id)',
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw vaultError(409, 'duplicate_request', 'request_id has already been used');
    throw e;
  }
  // §11.5 queue message, in the spec's member order. Lock carries no
  // envelope; manifest_sha256 is for enroll and unlock only.
  const message = {
    v: 1,
    op,
    vault_id: vault.vault_id,
    user_guid: m.user_guid,
    request_id: requestId,
    ...(sealed ? { etk_kid: sealed.etk_kid, envelope: sealed.envelope } : {}),
    ...(sealed?.manifest_sha256 ? { manifest_sha256: sealed.manifest_sha256 } : {}),
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

/**
 * Unlock-like requests to an existing vault: the named instance's release
 * must still be routable; a `removed` release (not reopened for a rescue)
 * is 410 release_unavailable (VAULT-MESSAGING 0.10.0 §11.9, §11.10.5).
 */
async function requireRoutable(inst: InstanceRow, canary: boolean): Promise<void> {
  if (!routable(await releaseRow(inst.release), { canary })) throw releaseUnavailable();
}

/**
 * What the account site and apps show about the vault's release (W8,
 * RELEASE-UPDATES §3; the apps' own source is the signed manifest,
 * VAULT-MESSAGING §11.10.6): its number, status and end date, and the
 * notice that follows from them. Advisory, from the routing table.
 */
export type ReleaseNotice = 'update_available' | 'final_warning' | 'ended' | 'rescue' | 'unavailable' | null;

export function releaseNotice(rel: ReleaseRow | null, newestActive: number | null, canary: boolean): {
  number: number | null; status: string; ends_at: string | null; newest_active: number | null; notice: ReleaseNotice;
} {
  if (!rel || (rel.status === 'canary' && !canary)) return { number: null, status: 'unknown', ends_at: null, newest_active: newestActive, notice: 'unavailable' };
  const base = { number: rel.release_number, status: rel.status, ends_at: rel.ends_at ?? null, newest_active: newestActive };
  if (rel.available === false) return { ...base, notice: 'unavailable' };
  switch (rel.status) {
    case 'active':
      return { ...base, notice: newestActive !== null && newestActive > rel.release_number ? 'update_available' : null };
    case 'deprecated':
      return { ...base, notice: 'update_available' };
    case 'retired':
      return { ...base, notice: 'final_warning' };
    case 'removed':
      return { ...base, notice: rel.rescue === true ? 'rescue' : 'ended' };
    default:
      return { ...base, notice: null };
  }
}

// ---- routes --------------------------------------------------------------------------

router.on('GET', '/api/vault/status', async (req) => {
  const m = await loadActiveAccount(req);
  await limit(`vault-status#${m.user_guid}`, 60, 60);
  const now = nowS();
  const service = (await vaultService()).enabled ? 'available' : 'paused';
  const found = activeVault((await currentVault(m.user_guid)).vault);
  if (!found) return { vault: null, service };
  const v = await refreshRegistered(m, found);
  let release = null;
  if (v.sealed_release) {
    const [rel, active] = await Promise.all([releaseRow(v.sealed_release), releasesWithStatus('active')]);
    release = releaseNotice(rel, active.length ? active[0].release_number : null, isCanaryMember(m));
  }
  // A vault runs only under a live lease: `unlocked` without one is a vault
  // that stopped before its host recorded the lock (0.10.6 §11.5).
  const leased = !!v.lease && typeof v.lease.lease_expires_at === 'number' && v.lease.lease_expires_at > now;
  return {
    vault: {
      vault_id: v.vault_id,
      state: v.state === 'unlocked' && !leased ? 'locked' : v.state,
      sealed_release: v.sealed_release ?? null,
      // The sealed release's number, status, end date and notice (W8).
      release,
      vault_version: v.vault_version ?? null,
      state_version: v.state_version ?? null,
      // Advisory (lifecycle values come from the host and are never used for security, §11.5).
      leased,
      // So owner apps can show a recovery in progress and offer to cancel it (§11.11.7).
      recovery: recoveryActive(v.recovery, now) ? { state: recoveryState(v.recovery, now), available_at: iso(v.recovery!.available_at) } : null,
      // The last alarm the vault reported to its host (a credential clone, 0.9.0 §3.5.9).
      alarm: v.alarm && typeof v.alarm.kind === 'string' && typeof v.alarm.at === 'number' ? { kind: v.alarm.kind, at: iso(v.alarm.at) } : null,
      created_at: v.created_at,
      updated_at: v.updated_at,
    },
    // The operator's pause (MEMBER-API 1.2.0), so sites and apps can say so.
    service,
  };
});

router.on('GET', '/api/vault/enclave', async (req) => {
  const m = await loadVaultMember(req);
  await requireService();
  await limit(`vault-enclave#${m.user_guid}`, 30, 60);
  const now = nowS();
  const requested = req.query.release;
  if (requested !== undefined && !PCR0_RE.test(requested)) throw badRequest('release must be a PCR0 (96 lowercase hex)');
  const vault = activeVault((await currentVault(m.user_guid)).vault);
  const holder = await liveLease(vault, now);
  const canary = isCanaryMember(m);

  if (requested !== undefined) {
    // §11.10.5: only for abandoning an unconfirmed move, so only for an existing vault.
    if (!vault) throw notFound('No vault is enrolled');
    if (holder) {
      if (holder.release === requested) return describe(holder);
      throw vaultError(409, 'vault_busy', 'The vault is open on another release; retry after its lease ends', {
        retry_after: Math.max(1, vault.lease!.lease_expires_at - now),
      });
    }
    return routeToRelease(requested, now, canary);
  }
  if (holder) return describe(holder);
  if (vault?.sealed_release) return routeToRelease(vault.sealed_release, now, canary);
  return routeForEnrollment(now, canary);
});

router.on('POST', '/api/vault/enroll', async (req) => {
  const m = await loadVaultMember(req);
  await requireService();
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  const instanceId = field(req.body, 'instance_id', INSTANCE_ID_RE, 'an instance id');
  const etkKid = field(req.body, 'etk_kid', KID_RE, '16 lowercase hex');
  const envelope = checkEnvelope(req.body.envelope, ENVELOPE_BYTES_LARGE, etkKid);
  const manifestSha256 = field(req.body, 'manifest_sha256', SHA256_RE, '64 lowercase hex');
  await limit(`vault-enroll#${m.user_guid}`, 3, 86_400);

  // Dark launch: no `active` release, nothing to enroll into (503 vault_unavailable).
  const targets = await enrollmentTargets(isCanaryMember(m));
  const now = nowS();
  const cur = await currentVault(m.user_guid);
  const inst = await routeCheck(activeVault(cur.vault), instanceId, now);
  // Enrollment goes to an instance of an `active` release (§11.1), or of a
  // canary release for a canary member.
  if (!targets.some((r) => r.release === inst.release)) throw instanceMoved();
  const vault = await vaultForEnrollment(m.user_guid, cur);
  await enqueue('enroll', m, vault, requestId, inst, { etk_kid: etkKid, envelope, manifest_sha256: manifestSha256 });
  await audit(m.email, 'vault.enroll_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: instanceId, release: inst.release });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('POST', '/api/vault/unlock', async (req) => {
  const m = await loadVaultMember(req);
  await requireService();
  const vaultId = field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex');
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  const instanceId = field(req.body, 'instance_id', INSTANCE_ID_RE, 'an instance id');
  const etkKid = field(req.body, 'etk_kid', KID_RE, '16 lowercase hex');
  const envelope = checkEnvelope(req.body.envelope, ENVELOPE_BYTES_LARGE, etkKid);
  const manifestSha256 = field(req.body, 'manifest_sha256', SHA256_RE, '64 lowercase hex');
  await limit(`vault-unlock#${m.user_guid}`, 10, 15 * 60);
  // Per source network: an IPv6 /64, or an IPv4 address (carrier NAT puts
  // many members behind one address, hence the higher limit; §11.8).
  await limit(`vault-unlock-net#${req.ip}`, req.ip.endsWith('/64') ? 10 : 60, 15 * 60);

  const vault = activeVault((await currentVault(m.user_guid)).vault);
  if (!vault || vault.vault_id !== vaultId) throw notFound('No such vault');
  const inst = await routeCheck(vault, instanceId, nowS());
  await requireRoutable(inst, isCanaryMember(m));
  await enqueue('unlock', m, vault, requestId, inst, { etk_kid: etkKid, envelope, manifest_sha256: manifestSha256 });
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
    // The app polls its register result: the moment to retire the code.
    if (isRegisteredSlot(item) && VAULT_ID_RE.test(String(item.vault_id))) {
      const v = (await ddb.send(new GetCommand({ TableName: table.vaults(), Key: { vault_id: String(item.vault_id) }, ConsistentRead: true }))).Item as VaultRow | undefined;
      if (v?.recovery && v.user_guid === m.user_guid && v.recovery.recovery_id === item.recovery_id) await markRegistered(m, v, v.recovery);
    }
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

type RecoveryState = 'pending' | 'available' | 'registered' | 'cancelled' | 'expired';

/** The state the API answers; `available` and `expired` follow from the clock. */
export function recoveryState(r: RecoveryRow | undefined, now: number): RecoveryState | null {
  if (!r) return null;
  if (r.state === 'cancelled') return 'cancelled';
  // The code is spent; it stays `registered` after expires_at (0.10.6 §11.11.7).
  if (r.state === 'registered') return 'registered';
  if (now >= r.expires_at) return 'expired';
  return now >= r.available_at ? 'available' : 'pending';
}

/** Pending, available or registered, before expires_at: blocks a new request, can be cancelled. */
export const recoveryActive = (r: RecoveryRow | undefined, now: number): boolean => {
  if (!r || now >= r.expires_at) return false;
  const st = recoveryState(r, now);
  return st === 'pending' || st === 'available' || st === 'registered';
};

/** The host's copy of the enclave's clear marker of a successful register (0.10.6 §11.5). */
export const REGISTERED_CODE = 'recovery_registered';
/** At most this many register ids are kept on a recovery (the route's daily rate limit). */
const MAX_REGISTER_IDS = 10;

const isRegisteredSlot = (item: Record<string, unknown> | undefined): boolean =>
  !!item && item.op === 'recovery_register' && item.status === 'done' && item.code === REGISTERED_CODE && typeof item.recovery_id === 'string';

/**
 * Record that the code of `r` is spent: `pending` -> `registered`, only for
 * the same recovery and never over a cancel (conditional). Returns the
 * recovery as it now is.
 */
async function markRegistered(m: MemberItem, v: VaultRow, r: RecoveryRow): Promise<RecoveryRow> {
  if (r.state !== 'pending') return r;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET recovery.#st = :reg, updated_at = :now',
        ConditionExpression: 'recovery.recovery_id = :id AND recovery.#st = :pending',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':reg': 'registered', ':pending': 'pending', ':id': r.recovery_id, ':now': nowIso() },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return r; // cancelled or replaced meanwhile
    throw e;
  }
  await audit(m.email, 'vault.recovery_registered', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id });
  return { ...r, state: 'registered' };
}

/**
 * While the code is available, look at the slots of this recovery's
 * register requests (they live 15 minutes): one answered with the marker
 * means the code is spent. Returns the vault row with its recovery updated.
 */
async function refreshRegistered(m: MemberItem, v: VaultRow): Promise<VaultRow> {
  const r = v.recovery;
  if (!r || recoveryState(r, nowS()) !== 'available' || !r.register_ids?.length) return v;
  for (const id of r.register_ids.slice(-MAX_REGISTER_IDS)) {
    if (!ULID_RE.test(id)) continue;
    const slot = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: id }, ConsistentRead: true }))).Item;
    if (isRegisteredSlot(slot) && slot!.user_guid === m.user_guid && slot!.recovery_id === r.recovery_id) {
      return { ...v, recovery: await markRegistered(m, v, r) };
    }
  }
  return v;
}

/** A vault that recovery can act on: enrolled (not `enrolling`) and not deleted. */
async function recoverableVault(guid: string): Promise<VaultRow> {
  const v = activeVault((await currentVault(guid)).vault);
  if (!v || v.state === 'enrolling') throw notFound('No enrolled vault');
  return v;
}

/**
 * The instance a recovery operation goes to: the leaseholder, else one of
 * the sealed release. While the service is paused (only a cancel gets
 * here then) no start is requested.
 */
async function recoveryInstance(v: VaultRow, now: number, canary: boolean): Promise<InstanceRow> {
  const holder = await liveLease(v, now);
  if (holder) return holder;
  if (!v.sealed_release) throw vaultError(409, 'conflict', 'The vault is not sealed to a release yet');
  if (!routable(await releaseRow(v.sealed_release), { canary })) throw releaseUnavailable();
  const inst = await pickInstance(v.sealed_release, now);
  if (inst) return inst;
  if (!(await vaultService()).enabled) throw vaultPaused();
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

The new app replaces your current app, which is removed; your desktops and agents stay paired. If your credential backup is off, your credential and its critical items cannot be restored: the new app can only start a new credential or delete the vault.

If you did not ask for this, cancel it now:
${cancelUrl}

You can also cancel it from any of your VettID apps or from your account page.`;

/** Cancel: mark it, tell the enclave, tell the member. False: nothing to cancel (a no-op). */
async function cancelRecovery(m: MemberItem, v: VaultRow, via: 'session' | 'link'): Promise<boolean> {
  const now = nowS();
  const r = v.recovery;
  if (!r || !recoveryActive(r, now)) return false;
  await setRecovery(v, { ...r, state: 'cancelled' }, r.recovery_id);
  try {
    const inst = await recoveryInstance(v, now, isCanaryMember(m));
    await enqueue('recovery_cancel', m, v, newUlid(), inst);
  } catch (e) {
    // The enclave also refuses the code if the API never releases it, but
    // a cancel that could not be queued is worth knowing about.
    console.error('recovery cancel not queued', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
  }
  await audit(m.email, 'vault.recovery_cancel', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id, via });
  await notify(m.email, 'VettID vault recovery cancelled', `The recovery of your VettID vault requested at ${iso(r.requested_at)} has been cancelled. Your apps can unlock the vault again.`);
  return true;
}


router.on('POST', '/api/vault/recovery', async (req) => {
  const m = await loadVaultMember(req);
  await requireService();
  const bk = req.body.browser_key;
  const key = typeof bk === 'string' ? decodeCanonicalB64(bk) : null;
  if (!key || key.length !== 65 || key[0] !== 0x04) throw badRequest('browser_key must be base64 of an uncompressed P-256 point');
  await limit(`vault-recovery#${m.user_guid}`, 3, 86_400);
  const now = nowS();
  const v = await recoverableVault(m.user_guid);
  if (recoveryActive(v.recovery, now)) throw vaultError(409, 'recovery_active', 'A recovery is already in progress');
  const inst = await recoveryInstance(v, now, isCanaryMember(m));
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
  const found = activeVault((await currentVault(m.user_guid)).vault);
  const v = found ? await refreshRegistered(m, found) : null;
  const r = v?.recovery;
  const state = recoveryState(r, now);
  if (!v || !r || !state) return { recovery: null };
  const out: Record<string, unknown> = {
    recovery_id: r.recovery_id, vault_id: v.vault_id, state, requested_at: iso(r.requested_at), available_at: iso(r.available_at), expires_at: iso(r.expires_at),
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
  return { cancelled: await cancelRecovery(m, v, 'session') };
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
  return { cancelled: await cancelRecovery(m, v, 'link') };
});

/** Remember a register request on its recovery (best effort: the app's poll finds the slot anyway). */
async function recordRegisterId(v: VaultRow, recoveryId: string, requestId: string): Promise<void> {
  const ids = [...(v.recovery?.register_ids ?? []), requestId].slice(-MAX_REGISTER_IDS);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET recovery.register_ids = :ids, updated_at = :now',
        ConditionExpression: 'recovery.recovery_id = :id',
        ExpressionAttributeValues: { ':ids': ids, ':id': recoveryId, ':now': nowIso() },
      }),
    );
  } catch (e) {
    console.error('register id not recorded', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
  }
}

router.on('POST', '/api/vault/recovery/register', async (req) => {
  const m = await loadVaultMember(req);
  await requireService();
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
  await requireRoutable(inst, isCanaryMember(m));
  const recoveryId = vault.recovery!.recovery_id;
  // The slot names its recovery, so its answer can retire the code (0.10.6 §11.11.7).
  await enqueue('recovery_register', m, vault, requestId, inst, { etk_kid: etkKid, envelope }, { slot: { recovery_id: recoveryId } });
  await recordRegisterId(vault, recoveryId, requestId);
  await audit(m.email, 'vault.recovery_register', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, recovery_id: recoveryId, instance_id: instanceId });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

export const handler = memberHandler(router);
