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
 * It never sees or stores PINs, keys (other than app public keys), mailbox
 * ids or device identifiers (§11.5). Envelopes are never logged.
 *
 * Two kinds of caller (MEMBER-API 2.0.0, VAULT-MESSAGING 0.15.0 §11.12):
 *  - the account portal, with its session (cookies, CSRF): status, lock,
 *    request polling, the setup-code routes and the recovery routes;
 *  - apps, which never sign in: each request is signed by the app's P-256
 *    app key (`X-VettID-App`, lambda/shared/app-auth.ts). The vault comes
 *    from the header, the member from the vault row; the key must be one the
 *    row allows for the route: the host-written `app_key`, the redeem's
 *    `app_key_pending` (1 hour), a recovery's claim keys or its recovering
 *    key. `enclave`, `enroll`, `unlock` and recovery `register` accept only
 *    signed requests (a staging-only switch, VAULT_LEGACY_SESSION_AUTH, still
 *    admits sessions there for the switch-over: ENROLLMENT-CODES §8 step 3).
 *
 * Setup codes (2.0.0, §11.12.1, lambda/shared/enroll-code.ts): the portal
 * issues a 5-minute issuance with a 128-bit QR secret and an 8-symbol typed
 * code (typed only with the member's email); the app redeems it with its
 * app key, which becomes the vault's pending key. Only MACs are stored.
 * There is no global limit anywhere; the typed path has one failure answer
 * (404 invalid_code) and flat timing.
 *
 * The account snapshot (2.0.0, §11.13) rides in every unlock queue message
 * and (2.2.0) every enroll;
 * changes reach a running vault through lambda/jobs/vault-account-push.ts.
 *
 * Recovery (§11.11, docs/MEMBER-API.md "Vault recovery"): the API records
 * the request on the vault row (`recovery`), routes the recovery operations
 * like a lock, keeps the enclave's browser-sealed code in the request's
 * slot until the recovery expires, and releases it only after 24 h. It
 * never holds the code itself, only that ciphertext; cancel-link tokens are
 * stored as their SHA-256 in request-table rows that expire with the
 * recovery. The new app claims the recovery with its key (2.0.0) and
 * registers with it; a register slot answered with the host's
 * `recovery_registered` marker turns the recovery `registered` (VAULT-MESSAGING
 * 0.10.6 §11.11.7) and makes that key the recovering key.
 *
 * No recovery with the credential backup off (2.1.0, VAULT-MESSAGING 0.16.0):
 * the host writes the vault's one-bit `credential_backup` on the row; a
 * request for a vault whose bit is `false` is refused upfront (409
 * recovery_unavailable, reason no_backup) before anything is written,
 * queued, locked or mailed. A recovery whose own slot comes back with the
 * enclave's clear `recovery_unavailable` ends at once (state `unavailable`)
 * and its sealed refusal is returned without waiting for `available_at`.
 *
 * Start over (2.1.0, §11.11.9): "Delete my vault and start over" from the
 * portal records `deletion` on the vault row and emails a cancel link; after
 * 24 h without a cancel (portal, link or the app's key) the cleanup job's
 * five-minute run sends the host's `delete` (lambda/jobs/cleanup.ts). The
 * API enforces the delay; nothing is queued or locked before then.
 *
 * Status reports `unlocked` only under a live lease (0.10.6 §11.5): the
 * host's `locked` update can lag, or be lost for a vault locked over the
 * relay.
 *
 * Shared contract with the enclave host (vettid/vettid-vault, the parent):
 *  - vaults table, PK vault_id: { vault_id, user_guid, state,
 *    lease: { instance_id, lease_expires_at (epoch s) }, sealed_release,
 *    vault_version, state_version, created_at, updated_at, alarm: { kind,
 *    alarm_id (ULID), at (epoch s) }, alarm_pending: true, app_key: { key,
 *    kid, seq } }. The API creates the row (state `enrolling`); the parent
 *    owns lease, lifecycle, alarm and app_key fields (the alarm mailer only
 *    clears alarm_pending, VAULT-MESSAGING 0.9.0 §11.5). The API writes
 *    only its own: `app_key_pending` and `recovery` (with its claim keys).
 *    Rows keyed `user#<user_guid>` are the API's per-member pointer
 *    (`current_vault_id`, and `enroll_live`: the member's latest setup-code
 *    issuance) and never carry user_guid.
 *  - vault-instances table, PK instance_id: { instance_id, release (PCR0 hex),
 *    queue_url, descriptor (b64 exact bytes), attestation (b64), heartbeat_at
 *    (epoch s), expires_at (TTL), load? }.
 *  - vault-requests table, PK request_id: the API puts { request_id,
 *    vault_id, user_guid, op, status: queued, instance_id, created_at,
 *    expires_at, app_kid? }; the parent sets status `done` and `envelope` (b64
 *    of a 5,252-byte sealed result) and/or `code` (e.g. etk_unknown). Setup
 *    code issuances live here too, keyed `enroll#<hex HMAC>`.
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
 * queued or start-requested. So do (2.0.0) setup-code issue, and redeem and
 * recovery claim right after their signature check, before the body is read
 * and before any lookup. Status (with `service`), polling, lock, the recovery
 * status and cancels, and reading or revoking a setup code stay; a cancel is
 * queued only to a running instance, never by a start request.
 *
 * Manifest by hash (VAULT-MESSAGING 0.10.0 §11.5): enroll and unlock carry
 * `manifest_sha256` in the clear; the API checks its format only and copies
 * it into the queue message, so the host can hand that manifest to the
 * enclave. `manifest_serial` travels only inside the sealed request.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { snapshotFor } from '../shared/account-snapshot';
import { AppHeader, AppKey, NONCE_TTL_S, TS_WINDOW_S, parseAppHeader, parseAppKey, signingInput, verifyAppSignature } from '../shared/app-auth';
import { audit } from '../shared/audit';
import { ddb, env, table } from '../shared/aws';
import {
  CODE_RE,
  ENROLL_CODE_TTL_S,
  PENDING_KEY_TTL_S,
  TYPED_CEILING,
  TYPED_MIN_MS,
  codeMac,
  emailHint,
  emailMac,
  enrollCodeKey,
  isQrSecret,
  issuanceKey,
  newQrSecret,
  newTypedCode,
  normalizeCode,
  normalizeEmail,
  qrMac,
} from '../shared/enroll-code';
import { HttpError, Router, badRequest, forbidden, notFound } from '../shared/http';
import { nowIso } from '../shared/ids';
import { ApiError, MemberRequest, RateLimited, WithStatus, memberHandler, requireSession } from '../shared/member-http';
import { canSignIn, currentTerms, memberByEmail, memberByGuid, vaultPointerKey } from '../shared/members';
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
const CODE_RE_HOST = /^[a-z_][a-z0-9_]{0,63}$/;
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

/** An app public key: canonical b64 of its SPKI DER and its akid. */
export interface StoredKey {
  key: string;
  kid: string;
}

export interface VaultRow {
  vault_id: string;
  user_guid: string;
  state: 'enrolling' | 'locked' | 'unlocked' | 'deleted';
  lease?: Lease;
  sealed_release?: string;
  vault_version?: string;
  state_version?: string | number;
  /**
   * Host-owned (2.0.0, VAULT-MESSAGING 0.15.0 §11.5): the vault's app key as
   * the enclave last reported it. The API only reads it.
   */
  app_key?: StoredKey & { seq?: number };
  /** API-owned (2.0.0): the key a setup-code redeem registered; valid until `until` (epoch s). */
  app_key_pending?: StoredKey & { until: number };
  /** API-owned: the recovery in progress or last ended (VAULT-MESSAGING §11.11). */
  recovery?: RecoveryRow;
  /**
   * Host-owned (2.1.0, VAULT-MESSAGING 0.16.0 §11.5): whether the vault keeps a
   * backup copy of its credential, as last reported. Absent until a 0.16.0
   * release reports it. Used only to refuse a recovery request upfront.
   */
  credential_backup?: boolean;
  /** API-owned (2.1.0): a pending or executing start-over (§11.11.9). */
  deletion?: DeletionRow;
  /**
   * Host-owned: the last alarm the vault reported (VAULT-MESSAGING 0.9.0
   * §11.5), content-free. `alarm_pending` is cleared by the alarm mailer
   * (lambda/jobs/vault-alarms.ts). Advisory; never a security signal.
   */
  alarm?: { kind: string; alarm_id: string; at: number; emailed_at?: number };
  alarm_pending?: boolean;
  /**
   * Host-owned (2.2.0, VAULT-MESSAGING 0.18.0 §11.5): the vault's latest name
   * request, and the flag the vault-names job clears when it claims it.
   */
  name_change?: { seq: number; first_name: string; last_name: string; at: number };
  name_change_pending?: boolean;
  /** Written by the vault-names job (2.2.0): the outcome the next snapshot carries. */
  name_change_result?: { seq: number; status: string; reason?: string };
  created_at: string;
  updated_at: string;
}

export interface RecoveryRow {
  recovery_id: string;
  /**
   * `registered`: a register request was answered with the enclave's marker
   * (0.10.6 §11.11.7). `unavailable` (2.1.0): the enclave refused the request
   * (its slot's `recovery_unavailable`, 0.16.0 §11.11.2); an ended state.
   */
  state: 'pending' | 'registered' | 'cancelled' | 'unavailable';
  requested_at: number; // epoch s
  available_at: number;
  expires_at: number;
  /** The register requests sent for this recovery, so their slots can be checked. */
  register_ids?: string[];
  /** 2.0.0: the keys of new apps that claimed this recovery (at most 10, oldest dropped). */
  claim_keys?: StoredKey[];
  /** 2.0.0: the claim key whose register came back `recovery_registered`. */
  recovering_key?: StoredKey;
}

/** API-owned (2.1.0, VAULT-MESSAGING 0.16.0 §11.11.9): "Delete my vault and start over". */
export interface DeletionRow {
  deletion_id: string;
  state: 'pending' | 'executing';
  requested_at: number; // epoch s
  deletes_at: number; // requested_at + 24 h
  /** The cleanup job: when the host's `delete` was queued (absent until it could be). */
  queued_at?: number;
}

type Op = 'enroll' | 'unlock' | 'lock' | 'recovery' | 'recovery_cancel' | 'recovery_register';

// ---- errors (§11.1, §11.9, §11.10.5) ------------------------------------------------
// Bodies carry the MEMBER-API `error` and also the spec's `code`.

const vaultError = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  new ApiError(status, code, message, { code, ...extra });

const unauthorized = () => new HttpError(401, 'unauthorized', 'Unauthorized');
const termsRequired = (message = 'Accept the membership terms to use the vault') => vaultError(403, 'terms_required', message);
const instanceMoved = () =>
  vaultError(409, 'instance_moved', 'The vault is now served by another enclave instance; fetch /api/vault/enclave again and re-seal.');
const releaseUnavailable = () =>
  vaultError(410, 'release_unavailable', 'The enclave release this vault is sealed to has ended or can no longer be started.');
const vaultUnavailable = () => vaultError(503, 'vault_unavailable', 'The vault service is not available yet', { retry_after: 300 });
/** What a paused vault service answers (also `Retry-After`, member-http). */
export const PAUSED_RETRY_AFTER_S = 300;
const vaultPaused = () =>
  vaultError(503, 'vault_unavailable', 'The vault service is paused for maintenance. Try again later.', { service: 'paused', retry_after: PAUSED_RETRY_AFTER_S });
/** Every failure of a setup-code redeem, of either form (§11.12.1). */
const invalidCode = () => vaultError(404, 'invalid_code', 'This setup code is not valid. Get a new code on the account site.');

/** Routes that start or change vault activity: refused while the operator has paused the service. */
async function requireService(): Promise<void> {
  if (!(await vaultService()).enabled) throw vaultPaused();
}

const releaseStarting = (release: string) =>
  vaultError(503, 'release_starting', 'An enclave for this vault is starting; retry shortly.', { release, retry_after: START_RETRY_AFTER_S });

// ---- clock -------------------------------------------------------------------------

const nowS = () => Math.floor(Date.now() / 1000);

/** The typed redeem's minimum answer time (§11.12.1); replaceable in tests. */
export const timing = {
  hold: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
};

// ---- member gate (portal sessions) ----------------------------------------------------

/**
 * Access (§11.1, MEMBER-API "Access"):
 *  - lock: any account holder with a vault, whatever the account state,
 *    including a canceled account in its grace period (locking only
 *    reduces exposure);
 *  - status, request polling, reading and revoking a setup code: an active
 *    account (cancellation blocks them);
 *  - issuing a setup code, the recovery request and its status: an active
 *    account in state `member` that has accepted the current terms, else
 *    403 terms_required.
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
  await requireCurrentTerms(m);
  return m;
}

async function requireCurrentTerms(m: MemberItem): Promise<void> {
  if (m.state !== 'member') throw termsRequired();
  const terms = await currentTerms();
  if (terms && terms.version_id !== m.terms_version) {
    throw termsRequired('The membership terms have changed; accept the current terms to use the vault');
  }
}

/** App callers: an active account (cancellation blocks every route but lock). */
function requireActive(m: MemberItem): void {
  if (!canSignIn(m)) throw forbidden('This account is not active');
}

/** Enrollment with a pending key: an active account in state `member` (the terms were checked when the code was issued). */
function requireActiveMember(m: MemberItem): void {
  requireActive(m);
  if (m.state !== 'member') throw termsRequired();
}

async function limit(key: string, max: number, windowS: number): Promise<void> {
  const r = await hit(key, max, windowS);
  if (!r.allowed) throw new RateLimited(r.retryAfter);
}

/** Per source network: an IPv6 /64 gets `v6`, an IPv4 address (carrier NAT) `v4`. */
const perNetwork = (ip: string, v4: number, v6: number) => (ip.endsWith('/64') ? v6 : v4);

// ---- vault rows --------------------------------------------------------------------

const memberPointerKey = vaultPointerKey;

interface Pointer {
  current_vault_id?: string;
  /** The request-table key of the member's latest setup-code issuance. */
  enroll_live?: string;
}

async function readPointer(guid: string): Promise<Pointer | null> {
  const p = await ddb.send(new GetCommand({ TableName: table.vaults(), Key: { vault_id: memberPointerKey(guid) }, ConsistentRead: true }));
  return (p.Item as Pointer | undefined) ?? null;
}

/** The member's current vault, read consistently through the per-member pointer row. */
async function currentVault(guid: string): Promise<{ pointer: string | null; vault: VaultRow | null }> {
  const p = await readPointer(guid);
  const pointer = typeof p?.current_vault_id === 'string' ? p.current_vault_id : null;
  if (!pointer) return { pointer: null, vault: null };
  const row = await vaultRow(pointer);
  return { pointer, vault: row && row.user_guid === guid ? row : null };
}

async function vaultRow(vaultId: string): Promise<VaultRow | null> {
  const v = await ddb.send(new GetCommand({ TableName: table.vaults(), Key: { vault_id: vaultId }, ConsistentRead: true }));
  return (v.Item as VaultRow | undefined) ?? null;
}

/** Current vault unless it has been deleted. */
const activeVault = (v: VaultRow | null) => (v && v.state !== 'deleted' ? v : null);

/**
 * The vault an enrollment targets: the member's existing vault if it isn't
 * deleted (the enclave decides whether a provisional vault may be replaced
 * and answers vault_exists for a confirmed one, §11.3), else a new one. The
 * pointer row may exist without a vault (it also names the member's setup
 * code), so a new pointer is conditional on `current_vault_id`.
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
        ConditionExpression: cur.pointer ? 'current_vault_id = :old' : 'attribute_not_exists(current_vault_id)',
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

// ---- app callers (2.0.0, §11.12.2) ---------------------------------------------------

type KeyRole = 'app' | 'pending' | 'claim' | 'recovering';

interface Caller {
  via: 'session' | 'app';
  m: MemberItem;
  /** App callers: the vault the header names. Sessions: the member's current vault. */
  vault: VaultRow | null;
  /** App callers: the signing key and the role it matched. */
  key: StoredKey | null;
  role: KeyRole | null;
}

const isStoredKey = (k: unknown): k is StoredKey =>
  !!k && typeof (k as StoredKey).key === 'string' && typeof (k as StoredKey).kid === 'string';

/**
 * The keys a vault row allows in `role` now. The pending key ends after an
 * hour, or once the host's `app_key` names it; a recovery's keys only while
 * the recovery is active and the vault's app key is not yet the recovering
 * key (then the recovery has completed, §11.11.5).
 */
function keysFor(v: VaultRow, role: KeyRole, now: number): StoredKey[] {
  const appKid = isStoredKey(v.app_key) ? v.app_key.kid : null;
  switch (role) {
    case 'app':
      return isStoredKey(v.app_key) ? [v.app_key] : [];
    case 'pending': {
      const p = v.app_key_pending;
      return isStoredKey(p) && typeof p.until === 'number' && p.until > now && p.kid !== appKid ? [p] : [];
    }
    case 'claim':
    case 'recovering': {
      const r = v.recovery;
      if (!r || !recoveryActive(r, now)) return [];
      if (isStoredKey(r.recovering_key) && r.recovering_key.kid === appKid) return [];
      if (role === 'recovering') return isStoredKey(r.recovering_key) ? [r.recovering_key] : [];
      return (r.claim_keys ?? []).filter(isStoredKey);
    }
  }
}

/** Header syntax and `ts`; any failure is 401 with no detail. */
function appHeader(req: MemberRequest): AppHeader {
  const h = parseAppHeader(req.appHeader);
  if (!h || Math.abs(nowS() - h.ts) > TS_WINDOW_S) throw unauthorized();
  return h;
}

/** Single use within 600 s per key: a conditional write of `appnonce#<akid>#<nonce>` (ratelimits table). */
async function spendNonce(h: AppHeader): Promise<void> {
  const now = nowS();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.ratelimits(),
        Key: { key: `appnonce#${h.kid}#${h.nonce}` },
        UpdateExpression: 'SET expires_at = :exp',
        ConditionExpression: 'attribute_not_exists(#k) OR expires_at < :now',
        ExpressionAttributeNames: { '#k': 'key' },
        ExpressionAttributeValues: { ':exp': now + NONCE_TTL_S, ':now': now },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw unauthorized();
    throw e;
  }
}

function signatureOk(req: MemberRequest, h: AppHeader, key: AppKey): boolean {
  const query = req.event.rawQueryString ?? '';
  return verifyAppSignature(key.key, signingInput(req.method, req.path, query, h, req.rawBody), h.sig);
}

/**
 * A request signed by a key the vault row allows for the route (`roles`,
 * tried in order). Checks, in order: the header's syntax, `ts`, the nonce,
 * that the key is allowed, and the signature. The vault must be the
 * member's current one and not deleted.
 */
async function appCaller(req: MemberRequest, roles: KeyRole[]): Promise<Caller & { vault: VaultRow; key: StoredKey; role: KeyRole }> {
  const h = appHeader(req);
  if (!h.vault) throw unauthorized();
  await spendNonce(h);
  const now = nowS();
  const v = await vaultRow(h.vault);
  if (!v || typeof v.user_guid !== 'string' || v.state === 'deleted') throw unauthorized();
  let match: { key: StoredKey; role: KeyRole } | null = null;
  for (const role of roles) {
    const k = keysFor(v, role, now).find((x) => x.kid === h.kid);
    if (k) {
      match = { key: k, role };
      break;
    }
  }
  const key = match ? parseAppKey(match.key.key) : null;
  if (!match || !key || key.kid !== h.kid || !signatureOk(req, h, key)) throw unauthorized();
  const [pointer, m] = await Promise.all([readPointer(v.user_guid), memberByGuid(v.user_guid)]);
  if (!m || pointer?.current_vault_id !== v.vault_id) throw unauthorized();
  if (match.role === 'app') await tidyKeys(v);
  return { via: 'app', m, vault: v, key: match.key, role: match.role };
}

/**
 * Once the host's `app_key` names the pending key, or a recovery's
 * recovering key, the API's own records of it are cleared (best effort;
 * keysFor() already ignores them). The conditions name only the API's own
 * attributes.
 */
async function tidyKeys(v: VaultRow): Promise<void> {
  const appKid = isStoredKey(v.app_key) ? v.app_key.kid : null;
  if (!appKid) return;
  const updates: UpdateCommand[] = [];
  if (v.app_key_pending?.kid === appKid) {
    updates.push(new UpdateCommand({
      TableName: table.vaults(),
      Key: { vault_id: v.vault_id },
      UpdateExpression: 'REMOVE app_key_pending',
      ConditionExpression: 'app_key_pending.kid = :k',
      ExpressionAttributeValues: { ':k': appKid },
    }));
  }
  const r = v.recovery;
  if (r && isStoredKey(r.recovering_key) && r.recovering_key.kid === appKid) {
    updates.push(new UpdateCommand({
      TableName: table.vaults(),
      Key: { vault_id: v.vault_id },
      UpdateExpression: 'REMOVE recovery.claim_keys, recovery.recovering_key',
      ConditionExpression: 'recovery.recovery_id = :id',
      ExpressionAttributeValues: { ':id': r.recovery_id },
    }));
  }
  for (const u of updates) {
    try {
      await ddb.send(u);
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') console.error('app key tidy failed', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
    }
  }
}

/**
 * Redeem and claim: the request must be signed by the key it registers
 * (`app_key` in the body), with `vault=` as given. Same checks and order as
 * appCaller(); no row is read.
 */
async function newKeyCaller(req: MemberRequest, vault: (h: AppHeader) => boolean): Promise<{ h: AppHeader; key: AppKey }> {
  const h = appHeader(req);
  if (!vault(h)) throw unauthorized();
  await spendNonce(h);
  const key = parseAppKey(req.body.app_key);
  if (!key || key.kid !== h.kid || !signatureOk(req, h, key)) throw unauthorized();
  return { h, key };
}

/** The staging-only switch-over (ENROLLMENT-CODES §8 step 3): sessions still admitted on the app routes. Never on in production. */
const legacySessions = () => process.env.VAULT_LEGACY_SESSION_AUTH === '1';

/**
 * `enclave`, `enroll`, `unlock`, recovery `register`: the app only (2.0.0),
 * or, with the staging switch on and no app header, a session as before
 * 2.0.0 (with its terms check).
 */
async function appOnlyCaller(req: MemberRequest, roles: KeyRole[]): Promise<Caller> {
  if (req.appHeader === undefined && legacySessions()) {
    const m = await loadVaultMember(req);
    return { via: 'session', m, vault: activeVault((await currentVault(m.user_guid)).vault), key: null, role: null };
  }
  if (req.appHeader === undefined) throw unauthorized();
  return appCaller(req, roles);
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
 * message, so the parent can always answer into it. The slot records the
 * signing key's kid (`app_kid`), so that only that key can poll it.
 */
async function enqueue(
  op: Op,
  m: MemberItem,
  vault: VaultRow,
  requestId: string,
  inst: InstanceRow,
  sealed?: { etk_kid: string; envelope: string; manifest_sha256?: string },
  opts: { extra?: Record<string, unknown>; ttlS?: number; slot?: Record<string, string> } = {},
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

/** The slot attribute naming the key that made an app request. */
const slotOf = (c: Caller): Record<string, string> => (c.key ? { app_kid: c.key.kid } : {});
/** Audit detail: who asked (2.0.0). */
const viaOf = (c: Caller) => ({ via: c.via, ...(c.key ? { kid: c.key.kid } : {}) });

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
  let m: MemberItem;
  let found: VaultRow | null;
  if (req.appHeader !== undefined) {
    const c = await appCaller(req, ['app', 'recovering']);
    requireActive(c.m);
    m = c.m;
    found = c.vault;
  } else {
    m = await loadActiveAccount(req);
    found = null;
  }
  await limit(`vault-status#${m.user_guid}`, 60, 60);
  const now = nowS();
  const service = (await vaultService()).enabled ? 'available' : 'paused';
  if (req.appHeader === undefined) found = activeVault((await currentVault(m.user_guid)).vault);
  if (!found) return { vault: null, service };
  const v = await refreshRecovery(m, found);
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
      // 2.1.0: the host-written backup bit (false: the vault cannot be recovered; null: not reported yet).
      credential_backup: typeof v.credential_backup === 'boolean' ? v.credential_backup : null,
      // 2.1.0: a pending start-over, so the app can show it and offer to cancel (§11.11.9).
      // 2.1.1: with its id, which the app's cancel names (it cannot read GET /api/vault/deletion).
      deletion: deletionOf(v) ? { deletion_id: v.deletion!.deletion_id, state: v.deletion!.state, deletes_at: iso(v.deletion!.deletes_at) } : null,
      created_at: v.created_at,
      updated_at: v.updated_at,
    },
    // The operator's pause (MEMBER-API 1.2.0), so sites and apps can say so.
    service,
  };
});

router.on('GET', '/api/vault/enclave', async (req) => {
  const c = await appOnlyCaller(req, ['app', 'pending', 'claim', 'recovering']);
  const m = c.m;
  // Enrollment (the pending key) needs an active member; an enrolled vault an active account (2.0.0).
  if (c.via === 'app') {
    if (c.role === 'pending') requireActiveMember(m);
    else requireActive(m);
  }
  await requireService();
  await limit(`vault-enclave#${m.user_guid}`, 30, 60);
  const now = nowS();
  const requested = req.query.release;
  if (requested !== undefined && !PCR0_RE.test(requested)) throw badRequest('release must be a PCR0 (96 lowercase hex)');
  const vault = c.vault;
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
  const c = await appOnlyCaller(req, ['pending']);
  const m = c.m;
  if (c.via === 'app') requireActiveMember(m);
  await requireService();
  // 2.0.0: the redeem's vault_id; the app's request names it twice (body and header).
  const vaultId = c.via === 'app' ? field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex') : null;
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  const instanceId = field(req.body, 'instance_id', INSTANCE_ID_RE, 'an instance id');
  const etkKid = field(req.body, 'etk_kid', KID_RE, '16 lowercase hex');
  const envelope = checkEnvelope(req.body.envelope, ENVELOPE_BYTES_LARGE, etkKid);
  const manifestSha256 = field(req.body, 'manifest_sha256', SHA256_RE, '64 lowercase hex');
  if (vaultId !== null && vaultId !== c.vault!.vault_id) throw notFound('No such vault');
  await limit(`vault-enroll#${m.user_guid}`, 3, 86_400);

  // Dark launch: no `active` release, nothing to enroll into (503 vault_unavailable).
  const targets = await enrollmentTargets(isCanaryMember(m));
  const now = nowS();
  let vault: VaultRow;
  let inst: InstanceRow;
  if (c.via === 'app') {
    inst = await routeCheck(c.vault, instanceId, now);
    vault = c.vault!;
  } else {
    const cur = await currentVault(m.user_guid);
    inst = await routeCheck(activeVault(cur.vault), instanceId, now);
    vault = await vaultForEnrollment(m.user_guid, cur);
  }
  // Enrollment goes to an instance of an `active` release (§11.1), or of a
  // canary release for a canary member.
  if (!targets.some((r) => r.release === inst.release)) throw instanceMoved();
  // 2.2.0 (VAULT-MESSAGING 0.18.0 §11.5): every enroll carries the account
  // snapshot, whose names the vault shares with its connections; the
  // enclave refuses an enroll without one, so none is sent without it.
  const account = await snapshotFor(m, vault);
  if (!account) throw vaultUnavailable();
  // The enclave binds the vault to the key the request was signed with (§11.5: `app_key`).
  await enqueue('enroll', m, vault, requestId, inst, { etk_kid: etkKid, envelope, manifest_sha256: manifestSha256 }, {
    extra: { ...(c.key ? { app_key: c.key.key } : {}), account },
    slot: slotOf(c),
  });
  await audit(m.email, 'vault.enroll_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: instanceId, release: inst.release, ...viaOf(c) });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('POST', '/api/vault/unlock', async (req) => {
  const c = await appOnlyCaller(req, ['app', 'recovering']);
  const m = c.m;
  // 2.0.0: an active account; the current terms are no longer required (§11.1).
  if (c.via === 'app') requireActive(m);
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
  await limit(`vault-unlock-net#${req.ip}`, perNetwork(req.ip, 60, 10), 15 * 60);

  const vault = c.vault;
  if (!vault || vault.vault_id !== vaultId) throw notFound('No such vault');
  const inst = await routeCheck(vault, instanceId, nowS());
  await requireRoutable(inst, isCanaryMember(m));
  // The account snapshot rides in every unlock (§11.13), whenever the member can be read.
  const account = await snapshotFor(m, vault);
  await enqueue('unlock', m, vault, requestId, inst, { etk_kid: etkKid, envelope, manifest_sha256: manifestSha256 }, {
    extra: account ? { account } : {},
    slot: slotOf(c),
  });
  await audit(m.email, 'vault.unlock_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: instanceId, release: inst.release, ...viaOf(c) });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('POST', '/api/vault/lock', async (req) => {
  // The portal's session or the app key, whatever the account state (locking only reduces exposure).
  const c: Caller = req.appHeader !== undefined
    ? await appCaller(req, ['app', 'recovering'])
    : { via: 'session', m: await loadAccountHolder(req), vault: null, key: null, role: null };
  const m = c.m;
  const vaultId = field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex');
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  await limit(`vault-lock#${m.user_guid}`, 30, 15 * 60);

  const vault = c.via === 'app' ? c.vault : activeVault((await currentVault(m.user_guid)).vault);
  if (!vault || vault.vault_id !== vaultId) throw notFound('No such vault');
  const holder = await liveLease(vault, nowS());
  if (holder) {
    await enqueue('lock', m, vault, requestId, holder, undefined, { slot: slotOf(c) });
  } else {
    // Nobody holds the vault, so it is not running: nothing to lock.
    try {
      await ddb.send(
        new PutCommand({
          TableName: table.vaultRequests(),
          Item: { request_id: requestId, vault_id: vault.vault_id, user_guid: m.user_guid, op: 'lock', status: 'done', created_at: nowIso(), expires_at: nowS() + REQUEST_TTL_S, ...slotOf(c) },
          ConditionExpression: 'attribute_not_exists(request_id)',
        }),
      );
    } catch (e) {
      if ((e as Error).name === 'ConditionalCheckFailedException') throw vaultError(409, 'duplicate_request', 'request_id has already been used');
      throw e;
    }
  }
  await audit(m.email, 'vault.lock_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: holder?.instance_id ?? null, ...viaOf(c) });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('GET', '/api/vault/requests/{id}', async (req) => {
  let c: Caller;
  if (req.appHeader !== undefined) {
    c = await appCaller(req, ['app', 'pending', 'claim', 'recovering']);
    requireActive(c.m);
  } else {
    c = { via: 'session', m: await loadActiveAccount(req), vault: null, key: null, role: null };
  }
  const m = c.m;
  const requestId = req.params.id;
  if (!ULID_RE.test(requestId)) throw badRequest('Malformed request id');
  await limit(`vault-poll#${m.user_guid}`, 2, 1);
  const r = await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: requestId }, ConsistentRead: true }));
  const item = r.Item;
  const now = nowS();
  if (!item || item.user_guid !== m.user_guid || Number(item.expires_at) <= now) throw notFound('No such request');
  // An app polls only the requests its own key made (§11.12.2).
  if (c.via === 'app' && (item.vault_id !== c.vault!.vault_id || item.app_kid !== c.key!.kid)) throw notFound('No such request');

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
    if (typeof item.code === 'string' && CODE_RE_HOST.test(item.code)) out.code = item.code;
    // The app polls its register result: the moment to retire the code.
    if (isRegisteredSlot(item) && VAULT_ID_RE.test(String(item.vault_id))) {
      const v = await vaultRow(String(item.vault_id));
      if (v?.recovery && v.user_guid === m.user_guid && v.recovery.recovery_id === item.recovery_id) await markRegistered(m, v, v.recovery, item);
    }
  }
  return out;
});

// ---- setup codes (2.0.0, VAULT-MESSAGING §11.12.1) --------------------------------------

/** The member API origin, for the QR's `api` (an identifier the app compares, never an address). */
const apiOrigin = () => `https://${env('ACCOUNT_HOST')}`;
const iso = (s: number) => new Date(s * 1000).toISOString();

interface IssuanceRow {
  request_id: string;
  op: 'enroll_code';
  user_guid: string;
  code_mac: string; // hex
  issued_at: number;
  expires_at: number; // also the TTL
  state: 'live' | 'used' | 'revoked';
  typed_attempts: number;
  typed_blocked: boolean;
  used_at?: number;
}

async function issuance(key: string): Promise<IssuanceRow | null> {
  const r = await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: key }, ConsistentRead: true }));
  const it = r.Item as IssuanceRow | undefined;
  return it && it.op === 'enroll_code' && typeof it.user_guid === 'string' ? it : null;
}

/** Revoke a live issuance (conditional); true if this call revoked it. */
async function revokeIssuance(key: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaultRequests(),
        Key: { request_id: key },
        UpdateExpression: 'SET #st = :revoked',
        ConditionExpression: '#st = :live',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':revoked': 'revoked', ':live': 'live' },
      }),
    );
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

const issuanceState = (it: IssuanceRow, now: number): 'live' | 'used' | 'expired' | 'revoked' =>
  it.state === 'used' ? 'used' : it.state === 'revoked' ? 'revoked' : now >= it.expires_at ? 'expired' : 'live';

router.on('POST', '/api/vault/enroll-code', async (req) => {
  // An active member with the current terms (403 terms_required).
  const m = await loadVaultMember(req);
  // Paused: a code that could not be used before it expires is not issued.
  await requireService();
  await limit(`enroll-code-issue#${m.user_guid}`, 5, 3600);
  await limit(`enroll-code-issue-day#${m.user_guid}`, 20, 86_400);
  await limit(`enroll-code-issue-net#${req.ip}`, 20, 3600);
  const k = await enrollCodeKey();
  const secret = newQrSecret();
  const code = newTypedCode();
  const now = nowS();
  const key = issuanceKey(qrMac(k, secret));
  const row: IssuanceRow = {
    request_id: key,
    op: 'enroll_code',
    user_guid: m.user_guid,
    code_mac: codeMac(k, m.user_guid, code).toString('hex'),
    issued_at: now,
    expires_at: now + ENROLL_CODE_TTL_S,
    state: 'live',
    typed_attempts: 0,
    typed_blocked: false,
  };
  await ddb.send(new PutCommand({ TableName: table.vaultRequests(), Item: row, ConditionExpression: 'attribute_not_exists(request_id)' }));
  // One live issuance per member: the pointer names the new one, and the old one is revoked.
  const pointer = await readPointer(m.user_guid);
  await ddb.send(
    new UpdateCommand({
      TableName: table.vaults(),
      Key: { vault_id: memberPointerKey(m.user_guid) },
      UpdateExpression: 'SET enroll_live = :k, updated_at = :now',
      ExpressionAttributeValues: { ':k': key, ':now': nowIso() },
    }),
  );
  if (pointer?.enroll_live && pointer.enroll_live !== key) await revokeIssuance(pointer.enroll_live);
  await audit(m.email, 'vault.enroll_code_issued', m.user_guid, { expires_at: iso(row.expires_at) });
  return new WithStatus(201, { secret, code, expires_at: iso(row.expires_at), api: apiOrigin() });
});

router.on('GET', '/api/vault/enroll-code', async (req) => {
  const m = await loadActiveAccount(req);
  await limit(`enroll-code-read#${m.user_guid}`, 60, 60);
  const pointer = await readPointer(m.user_guid);
  const it = pointer?.enroll_live ? await issuance(pointer.enroll_live) : null;
  if (!it || it.user_guid !== m.user_guid) return { enroll_code: null };
  return {
    enroll_code: {
      state: issuanceState(it, nowS()),
      typed_blocked: it.typed_blocked === true,
      issued_at: iso(it.issued_at),
      expires_at: iso(it.expires_at),
      ...(typeof it.used_at === 'number' ? { used_at: iso(it.used_at) } : {}),
    },
  };
});

router.on('DELETE', '/api/vault/enroll-code', async (req) => {
  const m = await loadActiveAccount(req);
  await limit(`enroll-code-revoke#${m.user_guid}`, 30, 15 * 60);
  const pointer = await readPointer(m.user_guid);
  const it = pointer?.enroll_live ? await issuance(pointer.enroll_live) : null;
  const revoked = !!it && it.user_guid === m.user_guid && issuanceState(it, nowS()) === 'live' && (await revokeIssuance(it.request_id));
  if (revoked) await audit(m.email, 'vault.enroll_code_revoked', m.user_guid, {});
  return { revoked };
});

/** System email; a failed send (e.g. SES sandbox) is logged, never fatal. */
async function notify(to: string, subject: string, text: string): Promise<void> {
  try {
    await sendMail(to, subject, text);
  } catch (e) {
    console.error('vault mail failed', JSON.stringify({ error: (e as Error).name }));
  }
}

/** An active account in state `member`: who a code can be redeemed for. */
const redeemable = (m: MemberItem | null): m is MemberItem => !!m && canSignIn(m) && m.state === 'member';

/**
 * Failed redeems, aggregated per source network and hour for the audit log
 * (MEMBER-API "Setup codes"): the 1st, 10th, 100th, ... failure of each
 * window is recorded with the count so far. Never a secret, a code or an
 * email.
 */
async function auditFailure(req: MemberRequest, via: 'qr' | 'typed'): Promise<void> {
  try {
    const r = await hit(`enroll-fail#${req.ip}`, Number.MAX_SAFE_INTEGER, 3600);
    if (/^10*$/.test(String(r.count))) {
      await audit('app', 'vault.enroll_code_failed', req.ip, { network: req.ip, failures_this_hour: r.count, via });
    }
  } catch (e) {
    console.error('enroll failure not recorded', JSON.stringify({ error: (e as Error).name }));
  }
}

/** The 800th typed attempt: block the issuance's typed entry, tell the member and operations (once). */
async function blockTyped(m: MemberItem, it: IssuanceRow): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaultRequests(),
        Key: { request_id: it.request_id },
        UpdateExpression: 'SET typed_blocked = :t',
        ConditionExpression: 'typed_blocked = :f',
        ExpressionAttributeValues: { ':t': true, ':f': false },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return; // someone else did
    throw e;
  }
  // The alarm MemberEnrollTypedCeiling watches this metric (EMF; member-api-stack).
  console.log(JSON.stringify({
    _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: 'VettID/MemberApi', Dimensions: [[]], Metrics: [{ Name: 'EnrollTypedCeiling', Unit: 'Count' }] }] },
    EnrollTypedCeiling: 1,
  }));
  await audit(m.email, 'vault.enroll_code_typed_blocked', m.user_guid, { issued_at: iso(it.issued_at) });
  await notify(m.email, 'VettID: many wrong setup codes were tried',
    `Someone tried many wrong codes for your account. Scan the QR code instead, or get a new code.

The setup code you got at ${iso(it.issued_at)} can no longer be typed in; its QR code still works until it expires. If you weren't setting up your vault, you can cancel the code on your account page.`);
}

/**
 * One typed attempt against a live issuance, counted before the code is
 * compared: at most TYPED_CEILING per issuance from every source together.
 * Returns the attempt number, or null if the issuance is blocked or full.
 */
async function countTyped(it: IssuanceRow): Promise<number | null> {
  try {
    const r = await ddb.send(
      new UpdateCommand({
        TableName: table.vaultRequests(),
        Key: { request_id: it.request_id },
        UpdateExpression: 'ADD typed_attempts :one',
        ConditionExpression: 'typed_blocked = :f AND typed_attempts < :max',
        ExpressionAttributeValues: { ':one': 1, ':f': false, ':max': TYPED_CEILING },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(r.Attributes?.typed_attempts);
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

/** Spend the issuance: one winner, both secrets. */
async function spend(it: IssuanceRow, via: 'qr' | 'typed', now: number): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaultRequests(),
        Key: { request_id: it.request_id },
        UpdateExpression: 'SET #st = :used, used_at = :now, used_via = :via',
        ConditionExpression: via === 'typed' ? '#st = :live AND expires_at > :now AND typed_blocked = :f' : '#st = :live AND expires_at > :now',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':used': 'used', ':live': 'live', ':now': now, ':via': via, ...(via === 'typed' ? { ':f': false } : {}) },
      }),
    );
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

/** The issuance can be redeemed now: live, unexpired, the member's current one. */
const usable = (it: IssuanceRow | null, pointer: Pointer | null, now: number): it is IssuanceRow =>
  !!it && it.state === 'live' && it.expires_at > now && pointer?.enroll_live === it.request_id;

/** After a successful spend: the vault, the pending key, the email, the audit, the answer. */
async function completeRedeem(m: MemberItem, key: AppKey, via: 'qr' | 'typed') {
  const vault = await vaultForEnrollment(m.user_guid, await currentVault(m.user_guid));
  const now = nowS();
  await ddb.send(
    new UpdateCommand({
      TableName: table.vaults(),
      Key: { vault_id: vault.vault_id },
      UpdateExpression: 'SET app_key_pending = :p, updated_at = :now',
      ConditionExpression: 'user_guid = :g',
      ExpressionAttributeValues: { ':p': { key: key.b64, kid: key.kid, until: now + PENDING_KEY_TTL_S }, ':g': m.user_guid, ':now': nowIso() },
    }),
  );
  await notify(m.email, 'VettID: your setup code was used',
    `A phone used your setup code at ${iso(now)} to set up your VettID vault. If this wasn't you, contact support@vettid.org.`);
  await audit(m.email, 'vault.enroll_code_redeemed', m.user_guid, { vault_id: vault.vault_id, kid: key.kid, via });
  return { vault_id: vault.vault_id, user_guid: m.user_guid, email_hint: emailHint(m.email) };
}

/** The dummy code_mac a typed attempt is compared with when there is no issuance (the same work). */
const DUMMY_MAC = Buffer.alloc(32);

async function redeemTyped(req: MemberRequest, key: AppKey, emailIn: string, codeIn: string) {
  const k = await enrollCodeKey();
  const email = normalizeEmail(emailIn).slice(0, 320);
  const code = normalizeCode(codeIn);
  // Counted for every email, whether or not it belongs to an account: its 429 tells nothing.
  await limit(`enroll-typed#${emailMac(k, email)}#${req.ip}`, 5, 5 * 60);
  const now = nowS();
  const found = email ? await memberByEmail(email) : null;
  const m = redeemable(found) ? found : null;
  const pointer = m ? await readPointer(m.user_guid) : null;
  const it = m && pointer?.enroll_live ? await issuance(pointer.enroll_live) : null;
  const live = usable(it, pointer, now) && it.user_guid === m!.user_guid && it.typed_blocked !== true ? it : null;
  let attempt: number | null = null;
  if (live) {
    attempt = await countTyped(live);
  } else {
    // Same threshold, protecting nothing: the behaviour is the same for every email.
    await hit(`enroll-typed-none#${emailMac(k, email)}`, TYPED_CEILING, 5 * 60);
  }
  // The MAC is computed and compared in every case (against a dummy without an issuance).
  const mac = codeMac(k, m?.user_guid ?? '', code);
  const stored = live && attempt !== null ? Buffer.from(live.code_mac, 'hex') : DUMMY_MAC;
  const same = stored.length === mac.length && timingSafeEqual(stored, mac);
  if (live && attempt !== null && same && CODE_RE.test(code) && (await spend(live, 'typed', now))) {
    return completeRedeem(m!, key, 'typed');
  }
  if (live && attempt !== null && attempt >= TYPED_CEILING) await blockTyped(m!, live);
  await auditFailure(req, 'typed');
  throw invalidCode();
}

async function redeemQr(req: MemberRequest, key: AppKey, secret: unknown) {
  const now = nowS();
  if (isQrSecret(secret)) {
    const it = await issuance(issuanceKey(qrMac(await enrollCodeKey(), secret)));
    const m = it ? await memberByGuid(it.user_guid) : null;
    const pointer = it ? await readPointer(it.user_guid) : null;
    if (redeemable(m) && usable(it, pointer, now) && (await spend(it, 'qr', now))) return completeRedeem(m, key, 'qr');
  }
  await auditFailure(req, 'qr');
  throw invalidCode();
}

router.on('POST', '/api/vault/enroll/redeem', async (req) => {
  const received = typeof req.event.requestContext?.timeEpoch === 'number' ? req.event.requestContext.timeEpoch : Date.now();
  // Signed by the key it registers, with an empty `vault`.
  const { key } = await newKeyCaller(req, (h) => h.vault === '');
  // Paused: refused before the body is read and before any lookup; nothing is spent, counted or written.
  await requireService();
  const b = req.body;
  const hasSecret = 'secret' in b;
  const hasTyped = 'email' in b || 'code' in b;
  if (hasSecret === hasTyped) throw badRequest('Send exactly one of {secret, app_key} or {email, code, app_key}');
  if (hasTyped && (typeof b.email !== 'string' || typeof b.code !== 'string' || b.email.length > 1024 || b.code.length > 64)) throw badRequest('email and code must be strings');
  // Both forms, per source network: 30 per 5 minutes per IPv4 address, 10 per IPv6 /64.
  await limit(`enroll-redeem-net#${req.ip}`, perNetwork(req.ip, 30, 10), 5 * 60);
  if (hasSecret) return redeemQr(req, key, b.secret);
  // The typed form answers no sooner than 250 ms after receipt, whatever the outcome.
  try {
    return await redeemTyped(req, key, b.email as string, b.code as string);
  } finally {
    const wait = received + TYPED_MIN_MS - Date.now();
    await timing.hold(Math.max(0, Math.min(TYPED_MIN_MS, wait)));
  }
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
/** A recovery keeps at most this many claim keys (the register limit); the oldest goes. */
export const MAX_CLAIM_KEYS = 10;

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

type RecoveryState = 'pending' | 'available' | 'registered' | 'cancelled' | 'expired' | 'unavailable';

/** The state the API answers; `available` and `expired` follow from the clock. */
export function recoveryState(r: RecoveryRow | undefined, now: number): RecoveryState | null {
  if (!r) return null;
  if (r.state === 'cancelled') return 'cancelled';
  // 2.1.0: refused by the enclave (no backup copy, or no credential); ended.
  if (r.state === 'unavailable') return 'unavailable';
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
/** The host's copy of the enclave's clear marker of a refused recovery request (0.16.0 §11.11.2). */
export const UNAVAILABLE_CODE = 'recovery_unavailable';
/** At most this many register ids are kept on a recovery (the route's daily rate limit). */
const MAX_REGISTER_IDS = 10;

const isRegisteredSlot = (item: Record<string, unknown> | undefined): boolean =>
  !!item && item.op === 'recovery_register' && item.status === 'done' && item.code === REGISTERED_CODE && typeof item.recovery_id === 'string';

/**
 * Record that the code of `r` is spent: `pending` -> `registered`, only for
 * the same recovery and never over a cancel (conditional). The register's
 * key (the slot's `app_kid`, one of the claim keys) becomes the recovering
 * key (2.0.0). Returns the recovery as it now is.
 */
async function markRegistered(m: MemberItem, v: VaultRow, r: RecoveryRow, slot: Record<string, unknown>): Promise<RecoveryRow> {
  if (r.state !== 'pending') return r;
  const recovering = (r.claim_keys ?? []).find((k) => isStoredKey(k) && k.kid === slot.app_kid);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: `SET recovery.#st = :reg, updated_at = :now${recovering ? ', recovery.recovering_key = :rk' : ''}`,
        ConditionExpression: 'recovery.recovery_id = :id AND recovery.#st = :pending',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':reg': 'registered', ':pending': 'pending', ':id': r.recovery_id, ':now': nowIso(), ...(recovering ? { ':rk': recovering } : {}) },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return r; // cancelled or replaced meanwhile
    throw e;
  }
  await audit(m.email, 'vault.recovery_registered', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id });
  return { ...r, state: 'registered', ...(recovering ? { recovering_key: recovering } : {}) };
}

/** The recovery request's own slot (its request_id is the recovery_id), if it is the member's. */
async function recoverySlot(m: MemberItem, r: RecoveryRow): Promise<Record<string, unknown> | null> {
  const slot = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: r.recovery_id }, ConsistentRead: true }))).Item;
  return slot && slot.user_guid === m.user_guid ? slot : null;
}

/**
 * 2.1.0 (VAULT-MESSAGING 0.16.0 §11.11.2, §11.11.7): while a recovery is
 * `pending` (before or after available_at), its own slot answered with the
 * enclave's clear `recovery_unavailable` means the enclave refused it: the
 * recovery ends at once as `unavailable` (conditional on the same recovery,
 * never over a cancel or a register). Returns the recovery as it now is.
 */
async function refreshUnavailable(m: MemberItem, v: VaultRow, r: RecoveryRow, now: number): Promise<RecoveryRow> {
  if (r.state !== 'pending' || now >= r.expires_at) return r;
  const slot = await recoverySlot(m, r);
  if (!slot || slot.status !== 'done' || slot.code !== UNAVAILABLE_CODE) return r;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET recovery.#st = :un, updated_at = :now',
        ConditionExpression: 'recovery.recovery_id = :id AND recovery.#st = :pending',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':un': 'unavailable', ':pending': 'pending', ':id': r.recovery_id, ':now': nowIso() },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return r; // cancelled, registered or replaced meanwhile
    throw e;
  }
  await audit(m.email, 'vault.recovery_unavailable', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id });
  return { ...r, state: 'unavailable' };
}

/**
 * Bring the recovery up to date from its slots: the enclave's refusal
 * (2.1.0, above), then, while the code is available, the slots of its
 * register requests (they live 15 minutes): one answered with the marker
 * means the code is spent. Returns the vault row with its recovery updated.
 */
async function refreshRecovery(m: MemberItem, v: VaultRow): Promise<VaultRow> {
  if (!v.recovery) return v;
  const refused = await refreshUnavailable(m, v, v.recovery, nowS());
  if (refused !== v.recovery) return { ...v, recovery: refused };
  const r = v.recovery;
  if (!r || recoveryState(r, nowS()) !== 'available' || !r.register_ids?.length) return v;
  for (const id of r.register_ids.slice(-MAX_REGISTER_IDS)) {
    if (!ULID_RE.test(id)) continue;
    const slot = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: id }, ConsistentRead: true }))).Item;
    if (isRegisteredSlot(slot) && slot!.user_guid === m.user_guid && slot!.recovery_id === r.recovery_id) {
      return { ...v, recovery: await markRegistered(m, v, r, slot!) };
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

/**
 * Write the recovery, conditional on the one read (or none): concurrent
 * requests cannot both win. A new request (`request`) also needs no
 * start-over to be pending (2.1.0), so a concurrent deletion request and
 * recovery request cannot both win either.
 */
async function setRecovery(v: VaultRow, r: RecoveryRow, expectId: string | null, request = false): Promise<void> {
  const cond = expectId ? 'recovery.recovery_id = :id' : 'attribute_not_exists(recovery)';
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET recovery = :r, updated_at = :now',
        ConditionExpression: request ? `${cond} AND attribute_not_exists(deletion)` : cond,
        ExpressionAttributeValues: { ':r': r, ':now': nowIso(), ...(expectId ? { ':id': expectId } : {}) },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw vaultError(409, 'conflict', 'The recovery changed; try again');
    throw e;
  }
}

const requestedMail = (cancelUrl: string, availableAt: number) => `A recovery of your VettID vault was requested from your account.

Your vault has been locked. If nobody cancels, a one-time recovery code becomes available on your account page at ${iso(availableAt)}, for 24 hours. A new app then needs the code, your vault PIN and your credential password.

The new app replaces your current app, which is removed; your desktops and agents stay paired. A vault whose credential backup is off cannot be recovered: it refuses the recovery, and your account page then says so.

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
  if (deletionOf(v)) throw deletionPending();
  // 2.1.0 (VAULT-MESSAGING 0.16.0 §11.11.7): no recovery with the credential
  // backup off. Refused before anything is written, queued, locked or mailed;
  // with the bit absent the request goes on and the enclave decides.
  if (v.credential_backup === false) {
    throw vaultError(409, 'recovery_unavailable', 'This vault cannot be recovered: its credential backup is off. You can delete it and start over.', { reason: 'no_backup' });
  }
  const inst = await recoveryInstance(v, now, isCanaryMember(m));
  const recoveryId = newUlid();
  const r: RecoveryRow = { recovery_id: recoveryId, state: 'pending', requested_at: now, available_at: now + RECOVERY_DELAY_S, expires_at: now + RECOVERY_DELAY_S + RECOVERY_VALIDITY_S };
  await setRecovery(v, r, v.recovery?.recovery_id ?? null, true);
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
  const v = found ? await refreshRecovery(m, found) : null;
  const r = v?.recovery;
  const state = recoveryState(r, now);
  if (!v || !r || !state) return { recovery: null };
  const out: Record<string, unknown> = {
    recovery_id: r.recovery_id, vault_id: v.vault_id, state, requested_at: iso(r.requested_at), available_at: iso(r.available_at), expires_at: iso(r.expires_at),
  };
  // The code from available_at; a refusal (2.1.0, `unavailable`) at once.
  if (state === 'available' || state === 'unavailable') {
    const slot = await recoverySlot(m, r);
    const env = slot && slot.status === 'done' && typeof slot.envelope === 'string' ? decodeCanonicalB64(slot.envelope) : null;
    if (env && env.length === RESULT_ENVELOPE_BYTES) {
      out.sealed_code = slot!.envelope;
      if (state === 'available' && !slot!.released) {
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
  const v = await vaultRow(String(link.vault_id));
  if (!m || !v || v.user_guid !== m.user_guid || v.recovery?.recovery_id !== link.recovery_id) throw notFound('This link is no longer valid');
  return { cancelled: await cancelRecovery(m, v, 'link') };
});

// The new app (2.0.0): no session and no key at the API yet; it presents the
// QR's vault_id and recovery_id with its own app key (§11.11.7).
router.on('POST', '/api/vault/recovery/claim', async (req) => {
  // Signed by the key it registers, with `vault=` the QR's vault.
  const { h, key } = await newKeyCaller(req, (x) => x.vault !== '');
  // Paused: refused before the body is read and before any lookup.
  await requireService();
  const vaultId = field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex');
  const recoveryId = field(req.body, 'recovery_id', ULID_RE, 'a ULID');
  if (vaultId !== h.vault) throw badRequest('vault_id must be the vault the request is signed for');
  await limit(`vault-recovery-claim#${vaultId}`, 10, 86_400);
  await limit(`vault-recovery-claim-net#${req.ip}`, 10, 15 * 60);
  const now = nowS();
  const v = await vaultRow(vaultId);
  const r = v?.recovery;
  if (!v || v.state === 'deleted' || !r || r.recovery_id !== recoveryId) throw notFound('No such recovery');
  const m = await memberByGuid(v.user_guid);
  const pointer = m ? await readPointer(m.user_guid) : null;
  if (!m || pointer?.current_vault_id !== v.vault_id) throw notFound('No such recovery');
  requireActive(m);
  // 2.1.0: a recovery the enclave refused is `unavailable`, never claimable.
  if (recoveryState(await refreshUnavailable(m, v, r, now), now) !== 'available') throw vaultError(409, 'recovery_not_available', 'No recovery code is valid now');
  const keys = [...(r.claim_keys ?? []).filter((k) => isStoredKey(k) && k.kid !== key.kid), { key: key.b64, kid: key.kid }].slice(-MAX_CLAIM_KEYS);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET recovery.claim_keys = :keys, updated_at = :now',
        ConditionExpression: 'recovery.recovery_id = :id',
        ExpressionAttributeValues: { ':keys': keys, ':id': r.recovery_id, ':now': nowIso() },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw vaultError(409, 'conflict', 'The recovery changed; try again');
    throw e;
  }
  await audit(m.email, 'vault.recovery_claim', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id, kid: key.kid });
  return { user_guid: m.user_guid, email_hint: emailHint(m.email) };
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
  // 2.0.0: signed by one of the recovery's claim keys; an active account.
  const c = await appOnlyCaller(req, ['claim']);
  const m = c.m;
  if (c.via === 'app') requireActive(m);
  await requireService();
  const vaultId = field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex');
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  const instanceId = field(req.body, 'instance_id', INSTANCE_ID_RE, 'an instance id');
  const etkKid = field(req.body, 'etk_kid', KID_RE, '16 lowercase hex');
  const envelope = checkEnvelope(req.body.envelope, ENVELOPE_BYTES_LARGE, etkKid);
  await limit(`vault-recovery-register#${m.user_guid}`, 10, 86_400);
  const now = nowS();
  const vault = c.vault;
  if (!vault || vault.vault_id !== vaultId) throw notFound('No such vault');
  const rec = vault.recovery ? await refreshUnavailable(m, vault, vault.recovery, now) : undefined;
  if (recoveryState(rec, now) !== 'available') throw vaultError(409, 'recovery_not_available', 'No recovery code is valid now');
  const inst = await routeCheck(vault, instanceId, now);
  await requireRoutable(inst, isCanaryMember(m));
  const recoveryId = vault.recovery!.recovery_id;
  // The slot names its recovery, so its answer can retire the code (0.10.6
  // §11.11.7), and its key, which then becomes the recovering key; the
  // queue message carries the key for the enclave to bind (§11.5).
  await enqueue('recovery_register', m, vault, requestId, inst, { etk_kid: etkKid, envelope }, {
    extra: c.key ? { app_key: c.key.key } : {},
    slot: { recovery_id: recoveryId, ...slotOf(c) },
  });
  await recordRegisterId(vault, recoveryId, requestId);
  await audit(m.email, 'vault.recovery_register', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, recovery_id: recoveryId, instance_id: instanceId, ...viaOf(c) });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

// ---- start over: "Delete my vault and start over" (2.1.0, VAULT-MESSAGING 0.16.0 §11.11.9) ----
//
// For a member who lost the phone with the credential backup off (no
// recovery exists then), or who does not want to recover. The deletion
// opens and returns nothing; the API enforces its 24 h, the emails and the
// cancel (portal, the email link, the app's key). The cleanup job's
// five-minute run then sends the host's `delete` (lambda/jobs/cleanup.ts).
// Nothing is queued and the vault is not locked or told during the wait.

/** The start-over runs 24 h after the request (§11.11.9). */
export const DELETION_DELAY_S = 24 * 3600;
export const DELETION_PHRASE = 'delete my vault';
const DELETION_LINK_PREFIX = 'dcancel#';

/** The vault's start-over, if one is pending or executing. */
export function deletionOf(v: VaultRow | null | undefined): DeletionRow | null {
  const d = v?.deletion;
  if (!d || typeof d.deletion_id !== 'string' || typeof d.deletes_at !== 'number') return null;
  return d.state === 'pending' || d.state === 'executing' ? d : null;
}

const deletionPending = () => vaultError(409, 'deletion_pending', 'Your vault is being deleted to start over. Cancel the deletion first.');

const deletionBody = (d: DeletionRow) => ({ deletion_id: d.deletion_id, state: d.state, requested_at: iso(d.requested_at), deletes_at: iso(d.deletes_at) });

const deletionRequestedMail = (cancelUrl: string, requestedAt: number, deletesAt: number) => `You asked to delete your VettID vault and start over, from your account, at ${iso(requestedAt)}.

Your vault and everything in it (your messages, connections, profile, items, Protean Credential, audit log and feed) will be deleted at ${iso(deletesAt)}. This cannot be undone: nothing can be restored afterwards. You can then set up a new, empty vault from your account page.

To keep your vault, cancel before then:
${cancelUrl}

You can also cancel on your account page or in your VettID app.

If you did not ask for this, cancel now, then secure your email account and your VettID account.`;

/**
 * Cancel a pending start-over: conditional on the same deletion and
 * `pending`; removes the record, mails the member. False: nothing to cancel
 * (none, another one, or already executing).
 */
async function cancelDeletion(m: MemberItem, v: VaultRow, deletionId: string, via: 'session' | 'link' | 'app', kid?: string): Promise<boolean> {
  const d = deletionOf(v);
  if (!d || d.deletion_id !== deletionId || d.state !== 'pending') return false;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'REMOVE deletion SET updated_at = :now',
        ConditionExpression: 'deletion.deletion_id = :id AND deletion.#st = :pending',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':id': deletionId, ':pending': 'pending', ':now': nowIso() },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false; // executing, cancelled or replaced meanwhile
    throw e;
  }
  await audit(m.email, 'vault.deletion_cancel', m.user_guid, { vault_id: v.vault_id, deletion_id: deletionId, via, ...(kid ? { kid } : {}) });
  await notify(m.email, 'VettID vault deletion cancelled',
    `The deletion of your VettID vault requested at ${iso(d.requested_at)} has been cancelled. Your vault and everything in it stay as they are.`);
  return true;
}

router.on('POST', '/api/vault/deletion', async (req) => {
  // A session of an active member with the current terms, as for a recovery request.
  const m = await loadVaultMember(req);
  if (req.body.confirm !== DELETION_PHRASE) throw badRequest(`confirm must be exactly "${DELETION_PHRASE}"`);
  await limit(`vault-deletion#${m.user_guid}`, 3, 86_400);
  const now = nowS();
  // A confirmed vault: not none, `enrolling` or deleted (404).
  const v = await recoverableVault(m.user_guid);
  if (recoveryActive(v.recovery, now)) throw vaultError(409, 'recovery_active', 'A recovery is in progress; cancel it first');
  if (deletionOf(v)) throw deletionPending();
  const d: DeletionRow = { deletion_id: newUlid(), state: 'pending', requested_at: now, deletes_at: now + DELETION_DELAY_S };
  // Conditional on what was read: no start-over yet, and the same (inactive) recovery or none.
  const rid = v.recovery?.recovery_id;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET deletion = :d, updated_at = :now',
        ConditionExpression: `user_guid = :g AND attribute_not_exists(deletion) AND ${rid ? 'recovery.recovery_id = :rid' : 'attribute_not_exists(recovery)'}`,
        ExpressionAttributeValues: { ':d': d, ':g': m.user_guid, ':now': nowIso(), ...(rid ? { ':rid': rid } : {}) },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw vaultError(409, 'conflict', 'The vault changed; try again');
    throw e;
  }
  // The single-use cancel link: only its SHA-256 is stored, until deletes_at.
  const token = randomBytes(32).toString('base64url');
  await ddb.send(
    new PutCommand({
      TableName: table.vaultRequests(),
      Item: { request_id: DELETION_LINK_PREFIX + sha256Hex(token), vault_id: v.vault_id, user_guid: m.user_guid, op: 'deletion_cancel_link', status: 'link', deletion_id: d.deletion_id, created_at: nowIso(), expires_at: d.deletes_at },
      ConditionExpression: 'attribute_not_exists(request_id)',
    }),
  );
  await audit(m.email, 'vault.deletion_request', m.user_guid, { vault_id: v.vault_id, deletion_id: d.deletion_id, deletes_at: iso(d.deletes_at) });
  await notify(m.email, 'VettID: your vault will be deleted',
    deletionRequestedMail(`https://${env('ACCOUNT_HOST')}/vault/deletion/cancel#t=${token}`, d.requested_at, d.deletes_at));
  return new WithStatus(202, { deletion_id: d.deletion_id, requested_at: iso(d.requested_at), deletes_at: iso(d.deletes_at) });
});

router.on('GET', '/api/vault/deletion', async (req) => {
  const m = await loadActiveAccount(req);
  await limit(`vault-deletion-status#${m.user_guid}`, 60, 60);
  const d = deletionOf(activeVault((await currentVault(m.user_guid)).vault));
  return { deletion: d ? deletionBody(d) : null };
});

// The portal's session, or the vault's app signed by its app key (§11.11.9).
router.on('POST', '/api/vault/deletion/cancel', async (req) => {
  let c: Caller;
  if (req.appHeader !== undefined) {
    c = await appCaller(req, ['app']);
    requireActive(c.m);
  } else {
    c = { via: 'session', m: await loadActiveAccount(req), vault: null, key: null, role: null };
  }
  const m = c.m;
  const deletionId = field(req.body, 'deletion_id', ULID_RE, 'a ULID');
  await limit(`vault-deletion-cancel#${m.user_guid}`, 30, 15 * 60);
  const v = c.via === 'app' ? c.vault : activeVault((await currentVault(m.user_guid)).vault);
  if (!v) return { cancelled: false };
  return { cancelled: await cancelDeletion(m, v, deletionId, c.via, c.key?.kid) };
});

// The email link: no session, the token stands in for it.
router.on('POST', '/api/vault/deletion/cancel-link', async (req) => {
  await limit(`vault-deletion-link#${req.ip}`, 20, 15 * 60);
  const token = req.body.token;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw badRequest('token is malformed');
  const link = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: DELETION_LINK_PREFIX + sha256Hex(token) }, ConsistentRead: true }))).Item;
  if (!link || link.op !== 'deletion_cancel_link' || Number(link.expires_at) <= nowS()) throw notFound('This link is no longer valid');
  const m = await memberByGuid(String(link.user_guid));
  const v = await vaultRow(String(link.vault_id));
  if (!m || !v || v.user_guid !== m.user_guid) throw notFound('This link is no longer valid');
  return { cancelled: await cancelDeletion(m, v, String(link.deletion_id), 'link') };
});

export const handler = memberHandler(router);
