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
 * registers with it (2.4.0: the claim also takes the typed form's
 * `locator`, minted with the request and kept in a request-table row
 * `recovery-locator#<locator>` that expires with the recovery; a locator is
 * never logged or audited); a register slot answered with the host's
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
 *
 * Recovery from release R (MEMBER-API 2.7.0, VAULT-MESSAGING 0.33.0 §11.14):
 *  - every `recovery` and `recovery_cancel` is signed with the recovery
 *    request key in KMS (lambda/shared/recovery-sign.ts); nothing is queued
 *    without the signature;
 *  - the registered phone opens the recovery with POST
 *    /api/vault/recovery/open (signed by the recovering key, forwarded only
 *    while `registered`; queue op `recovery_open`), and its enclave is
 *    preferably one whose row shows `heavy_kdf_free`; the recovering key no
 *    longer unlocks or locks;
 *  - the recovery's own slot carries the enclave's clear `not_before`,
 *    `expires` and `earliest`, which become `available_at` and `expires_at`;
 *    a refusal's slot carries `reason` (`not_offered` among them); an open's
 *    slot with `code: "recovery_attempt"` is a counted attempt: audited,
 *    mailed once, and `expires_at` moves to its `expires`. The API never
 *    learns an attempt's outcome or the count;
 *  - while the host's `app_key_next` is set (a transfer or recovery between
 *    its first and third write), that key is accepted beside `app_key` as
 *    the vault's app key.
 *
 * A recovery cancelled from the phone (MEMBER-API 2.9.0, VAULT-MESSAGING
 * 0.49.0 §11.5): an owner app's unlock that ended a recovery in the vault
 * comes back with the host's clear `recovery_cancelled` and
 * `cancelled_recovery_id` on its slot, and the vault row's
 * `recovery_cancelled` is the backstop. The recovery with that id (and no
 * other) is ended here as `cancelled` via `app`, once, through a per-recovery
 * notice row claimed before the audit and the email (noticeAppCancel), from
 * the app's poll, the status reads, the recovery request and the 5-minute
 * sweep. Every cancel is one conditional field update (cancelWrite); a
 * `recovery_cancel` names its recovery from RECOVERY_CANCEL_ID_FROM_RELEASE.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { snapshotFor } from '../shared/account-snapshot';
import { AppHeader, AppKey, NONCE_TTL_S, TS_WINDOW_S, parseAppHeader, parseAppKey, signingInput, verifyAppSignature } from '../shared/app-auth';
import { audit, memberActor } from '../shared/audit';
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
import { CONTROL_RE, HttpError, Router, badRequest, forbidden, notFound } from '../shared/http';
import { nowIso } from '../shared/ids';
import { ApiError, MemberRequest, RateLimited, WithStatus, memberHandler, requireSession } from '../shared/member-http';
import { canSignIn, currentTerms, memberByEmail, memberByGuid, vaultPointerKey } from '../shared/members';
import type { MemberItem } from '../shared/model';
import { hit } from '../shared/ratelimit';
import { sendMail } from '../shared/mail';
import { signRecoveryRequest } from '../shared/recovery-sign';
import { recoveryScale, scaledMail, scaledSeconds, timeScale } from '../shared/time-scale';
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
  /**
   * Host-owned (2.7.0, release R; VAULT-MESSAGING §11.14.2): the app key a
   * transfer or recovery is putting in place, from the header write of its
   * step 1 until `app_key` reaches its `seq` or the vault abandons it. The
   * API only reads it, and accepts it as the vault's app key while it is set
   * and ahead of `app_key`.
   */
  app_key_next?: StoredKey & { seq?: number; header_seq?: number };
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
  /**
   * Host-owned (2.9.0, VAULT-HOST-PROTOCOL 0.1.13 §7.2, VAULT-MESSAGING
   * 0.49.0 §11.5): the recovery the vault's last cancelling unlock ended,
   * from that unlock's lifecycle event (`at`: the parent's time). The
   * backstop for an answer lost before its slot was written. Overwritten at
   * the next such unlock, never cleared; the API only reads it.
   */
  recovery_cancelled?: { recovery_id: string; at?: number };
  created_at: string;
  updated_at: string;
}

export interface RecoveryRow {
  recovery_id: string;
  /**
   * `registered`: a register request was answered with the enclave's marker
   * (0.10.6 §11.11.7). `unavailable` (2.1.0): the enclave refused the request
   * (its slot's `recovery_unavailable`, 0.16.0 §11.11.2); an ended state.
   * `completed` (2.4.1): a registered recovery whose recovering key the host
   * reported as the vault's app key (§11.11.5 step 3); an ended state.
   */
  state: 'pending' | 'registered' | 'cancelled' | 'unavailable' | 'completed';
  /** 2.4.1: when the API recorded the completion (epoch s). */
  completed_at?: number;
  requested_at: number; // epoch s
  available_at: number;
  expires_at: number;
  /** The register requests sent for this recovery, so their slots can be checked. */
  register_ids?: string[];
  /** 2.0.0: the keys of new apps that claimed this recovery (at most 10, oldest dropped). */
  claim_keys?: StoredKey[];
  /** 2.0.0: the claim key whose register came back `recovery_registered`. */
  recovering_key?: StoredKey;
  /**
   * 2.4.0 (VAULT-MESSAGING 0.25.0 §11.11.10): the typed form's locator, 12
   * Crockford base32 characters. Absent on a recovery requested before 2.4.0.
   * Returned only by GET /api/vault/recovery together with a code's
   * `sealed_code`; never logged, audited or mailed.
   */
  locator?: string;
  /**
   * 2.7.0: `available_at` is still an estimate (the API's own request + 24 h,
   * or the enclave's when it could not read its counter). Removed when the
   * recovery's slot brings the enclave's `not_before` without `earliest`.
   */
  earliest?: boolean;
  /** 2.7.0: the slot's times have been applied (once). */
  enclave_times?: boolean;
  /** 2.7.0: with `unavailable` only, the slot's clear reason. */
  reason?: RecoveryReason;
  /** 2.7.0: the open requests sent for this recovery (the last few), so their slots can be checked. */
  open_ids?: string[];
  /**
   * 2.7.0: the request-table key of the request email's cancel link (the
   * SHA-256 of its token, as that row's key holds it), so the link can be
   * kept valid as long as the recovery when its `expires_at` moves.
   */
  cancel_key?: string;
  /**
   * 2.8.0 (staging only): the time scale the recovery's estimates and floors
   * were divided by, decided when it was requested (recoveryScale: only for
   * a vault on a release that ships `time_scale`). Absent: 1, real time; a
   * recovery requested before the scale turned on keeps its times.
   */
  time_scale?: 24;
  /**
   * 2.9.0: with `cancelled` only, for a cancel recorded from 2.9.0: the
   * session or link route, or `app` (an owner app's unlock ended it in the
   * vault, "A recovery cancelled from the phone"); and when (epoch s).
   */
  cancelled_via?: CancelVia;
  cancelled_at?: number;
  /**
   * 2.9.0: the unlock requests queued while this recovery was active (the
   * latest MAX_UNLOCK_IDS), so the status reads can find their slots; the
   * slots live as long as the recovery, plus an hour.
   */
  unlock_ids?: string[];
}

/** 2.9.0: how a recovery was cancelled. */
export type CancelVia = 'session' | 'link' | 'app';
const CANCEL_VIAS: ReadonlySet<string> = new Set<CancelVia>(['session', 'link', 'app']);

/** The clear reasons a refused recovery's slot may carry (2.1.0, 2.7.0). */
export type RecoveryReason = 'no_backup' | 'no_credential' | 'not_offered';
const RECOVERY_REASONS: ReadonlySet<string> = new Set<RecoveryReason>(['no_backup', 'no_credential', 'not_offered']);

/** API-owned (2.1.0, VAULT-MESSAGING 0.16.0 §11.11.9): "Delete my vault and start over". */
export interface DeletionRow {
  deletion_id: string;
  state: 'pending' | 'executing';
  requested_at: number; // epoch s
  deletes_at: number; // requested_at + 24 h (divided by the staging time scale)
  /** The cleanup job: when the host's `delete` was queued (absent until it could be). */
  queued_at?: number;
}

type Op = 'enroll' | 'unlock' | 'lock' | 'recovery' | 'recovery_cancel' | 'recovery_register' | 'recovery_open';
/**
 * The operations whose result `GET /api/vault/requests/{id}` passes on (the
 * envelope and the code): those a client makes with its own request id and
 * polls at once, each result sealed to the app that asked. Never `recovery`,
 * whose slot holds the sealed recovery code. The other slots (`recovery_cancel`
 * here, `account` and `delete` from the jobs) have ids the API makes and never
 * returns, and no result for a client.
 */
const POLLED_OPS: ReadonlySet<string> = new Set<Op>(['enroll', 'unlock', 'lock', 'recovery_register', 'recovery_open']);

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

/**
 * 2.7.0 (release R, VAULT-MESSAGING §11.14.6 "What is removed"): a
 * registered phone does not unlock or lock; it opens the recovery. Its key
 * matched the recovering role only (while the host's `app_key_next` names
 * it, it is the vault's pending app key and matches `app` first).
 */
const recoveringRefused = () =>
  vaultError(403, 'forbidden', 'A recovering phone opens the recovery (POST /api/vault/recovery/open); it does not unlock or lock the vault.');

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
 *  - cancelling a recovery or a start-over: any account holder too,
 *    whatever the account state, with the session, the email link or (the
 *    start-over) the app key. Cancelling only keeps the vault as it is, and
 *    a suspended account must not lose the one thing its owner can still do
 *    against a deletion or a recovery somebody else asked for;
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
 * The host's pending app key (2.7.0, release R), while it counts: set, a
 * key with a `seq`, not the current key, and with a `seq` above
 * `app_key`'s (an `app_key` without `seq` admits no pending key). The
 * host clears it by the rules of VAULT-MESSAGING §11.14.2; one it failed
 * to clear after `app_key` reached its `seq` is not accepted here. There
 * is no time limit.
 */
export function pendingAppKey(v: Pick<VaultRow, 'app_key' | 'app_key_next'>): StoredKey | null {
  const n = v.app_key_next;
  if (!isStoredKey(n) || typeof n.seq !== 'number') return null;
  const cur = isStoredKey(v.app_key) ? v.app_key : null;
  if (cur && cur.kid === n.kid) return null;
  // Staleness is judged by seq only: an app_key without one cannot be
  // compared, so a pending key beside it is not accepted.
  if (cur && !(typeof cur.seq === 'number' && n.seq > cur.seq)) return null;
  return n;
}

/**
 * The keys a vault row allows in `role` now. The pending key ends after an
 * hour, or once the host's `app_key` names it; a recovery's keys only while
 * the recovery is active and the vault's app key is not yet the recovering
 * key (then the recovery has completed, §11.11.5). The vault's app key is
 * the host's `app_key` and (2.7.0) its pending `app_key_next`.
 */
function keysFor(v: VaultRow, role: KeyRole, now: number): StoredKey[] {
  const appKid = isStoredKey(v.app_key) ? v.app_key.kid : null;
  switch (role) {
    case 'app': {
      const next = pendingAppKey(v);
      return [...(isStoredKey(v.app_key) ? [v.app_key] : []), ...(next ? [next] : [])];
    }
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
  const vault = match.role === 'app' ? await tidyKeys(m, v) : v;
  return { via: 'app', m, vault, key: match.key, role: match.role };
}

/**
 * Once the host's `app_key` names the pending key, the API's own record of
 * it is cleared (best effort; keysFor() already ignores it; the condition
 * names only the API's own attribute). Once it names a recovery's
 * recovering key, the recovery is recorded as completed (2.4.1,
 * completeRecovery()), which clears its keys. Returns the row as it now is.
 */
async function tidyKeys(m: MemberItem, v: VaultRow): Promise<VaultRow> {
  const appKid = isStoredKey(v.app_key) ? v.app_key.kid : null;
  if (!appKid) return v;
  if (v.app_key_pending?.kid === appKid) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'REMOVE app_key_pending',
        ConditionExpression: 'app_key_pending.kid = :k',
        ExpressionAttributeValues: { ':k': appKid },
      }));
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') console.error('app key tidy failed', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
    }
  }
  try {
    return await completeRecovery(m, v);
  } catch (e) {
    // Best effort here: the next read of the recovery records it.
    console.error('recovery completion not recorded', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
    return v;
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
async function routeToRelease(release: string, now: number, canary: boolean, preferHeavyKdf = false) {
  const rel = await releaseRow(release);
  if (!routable(rel, { canary })) throw releaseUnavailable();
  const inst = await pickInstance(release, now, preferHeavyKdf);
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
  // The recovering key is also one of the claim keys; it is matched as
  // `recovering` first (2.7.0: its enclave should have the heavy permit free).
  const c = await appOnlyCaller(req, ['app', 'pending', 'recovering', 'claim']);
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
  // 2.7.0: a recovering phone seals its recovery open to this instance, so
  // prefer one that can give the heavy derivation's permit now.
  if (vault?.sealed_release) return routeToRelease(vault.sealed_release, now, canary, c.role === 'recovering');
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
  await audit(memberActor(m.user_guid), 'vault.enroll_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: instanceId, release: inst.release, ...viaOf(c) });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('POST', '/api/vault/unlock', async (req) => {
  // 2.7.0 (release R): the recovering key no longer unlocks (403); a
  // registered phone opens the recovery instead (POST /api/vault/recovery/open).
  const c = await appOnlyCaller(req, ['app', 'recovering']);
  if (c.role === 'recovering') throw recoveringRefused();
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
  const now = nowS();
  const inst = await routeCheck(vault, instanceId, now);
  await requireRoutable(inst, isCanaryMember(m));
  // The account snapshot rides in every unlock (§11.13), whenever the member can be read.
  const account = await snapshotFor(m, vault);
  // 2.9.0 ("A recovery cancelled from the phone"): an unlock queued while a
  // recovery is active may end it in the vault. Its slot names that
  // recovery and lives as long as it (plus an hour), as an open's does, and
  // the recovery remembers the request, so that the status reads and the
  // sweep can still find the slot's marker. Which recovery ends is decided
  // by the marker's own id, never by this one.
  const under = vault.recovery && recoveryActive(vault.recovery, now) ? vault.recovery : null;
  await enqueue('unlock', m, vault, requestId, inst, { etk_kid: etkKid, envelope, manifest_sha256: manifestSha256 }, {
    extra: account ? { account } : {},
    slot: { ...slotOf(c), ...(under ? { recovery_id: under.recovery_id } : {}) },
    ...(under ? { ttlS: Math.max(REQUEST_TTL_S, under.expires_at + 3600 - now) } : {}),
  });
  if (under) await recordUnlockId(vault, under, requestId);
  await audit(memberActor(m.user_guid), 'vault.unlock_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: instanceId, release: inst.release, ...viaOf(c) });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

router.on('POST', '/api/vault/lock', async (req) => {
  // The portal's session or the app key, whatever the account state (locking only reduces exposure).
  // 2.7.0 (release R): not the recovering key (403), which has no running vault to lock.
  const c: Caller = req.appHeader !== undefined
    ? await appCaller(req, ['app', 'recovering'])
    : { via: 'session', m: await loadAccountHolder(req), vault: null, key: null, role: null };
  if (c.role === 'recovering') throw recoveringRefused();
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
  await audit(memberActor(m.user_guid), 'vault.lock_request', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, instance_id: holder?.instance_id ?? null, ...viaOf(c) });
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
  // A recovery request's own slot (its id is the recovery_id) holds the
  // sealed recovery code. Only GET /api/vault/recovery releases that, from
  // available_at and with its audit event: here the slot answers its status
  // and nothing else (no envelope, no code), at any time. So does any slot
  // that is not one of the operations a client polls for its result, and a
  // slot without an `op` (fail closed).
  if (typeof item.op !== 'string' || !POLLED_OPS.has(item.op)) return out;
  if (status === 'done') {
    const env = typeof item.envelope === 'string' ? decodeCanonicalB64(item.envelope) : null;
    if (env && env.length === RESULT_ENVELOPE_BYTES) out.envelope = item.envelope;
    if (typeof item.code === 'string' && CODE_RE_HOST.test(item.code)) out.code = item.code;
    // The app polls its register result: the moment to retire the code.
    if (isRegisteredSlot(item) && VAULT_ID_RE.test(String(item.vault_id))) {
      const v = await vaultRow(String(item.vault_id));
      if (v?.recovery && v.user_guid === m.user_guid && v.recovery.recovery_id === item.recovery_id) await markRegistered(m, v, v.recovery, item);
    }
    // 2.7.0: the app polls its open's result: a counted attempt is mailed
    // and audited now (once). Its failure never hides the result.
    if (isAttemptSlot(item) && VAULT_ID_RE.test(String(item.vault_id))) {
      try {
        const v = await vaultRow(String(item.vault_id));
        if (v && v.user_guid === m.user_guid) await noticeAttempt(m, v, v.recovery, item);
      } catch (e) {
        console.error('recovery attempt not noticed', JSON.stringify({ request_id: requestId, error: (e as Error).name }));
      }
    }
    // 2.9.0: the app polls its unlock's result: a recovery the unlock ended
    // in the vault is ended here too (once). Its failure never hides the result.
    if (isCancelledSlot(item) && VAULT_ID_RE.test(String(item.vault_id))) {
      try {
        const v = await vaultRow(String(item.vault_id));
        if (v && v.user_guid === m.user_guid) await noticeAppCancel(m, v, String(item.cancelled_recovery_id), { kind: 'slot', slot: item });
      } catch (e) {
        console.error('recovery cancel not noticed', JSON.stringify({ request_id: requestId, error: (e as Error).name }));
      }
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
  await audit(memberActor(m.user_guid), 'vault.enroll_code_issued', m.user_guid, { expires_at: iso(row.expires_at) });
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
  if (revoked) await audit(memberActor(m.user_guid), 'vault.enroll_code_revoked', m.user_guid, {});
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
  await audit(memberActor(m.user_guid), 'vault.enroll_code_typed_blocked', m.user_guid, { issued_at: iso(it.issued_at) });
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
  await audit(memberActor(m.user_guid), 'vault.enroll_code_redeemed', m.user_guid, { vault_id: vault.vault_id, kid: key.kid, via });
  return { vault_id: vault.vault_id, user_guid: m.user_guid, email_hint: emailHint(m.email) };
}

/** The dummy code_mac a typed attempt is compared with when there is no issuance (the same work). */
const DUMMY_MAC = Buffer.alloc(32);

async function redeemTyped(req: MemberRequest, key: AppKey, emailIn: string, codeIn: string) {
  const k = await enrollCodeKey();
  const email = normalizeEmail(emailIn).slice(0, 320);
  // 2.3.1: an address with a control character is refused as the shared email
  // check refuses it, before any lookup or count. The answer depends only on
  // what was typed, never on an account, so it is no account oracle.
  if (CONTROL_RE.test(email)) throw badRequest('Invalid email address');
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

/**
 * The code becomes usable 24 h after the request, for 24 h (§11.11.2). On
 * staging both are divided by the time scale when used (S5, S6; MEMBER-API
 * 2.8.0 "Staging time scale"): the estimates and the API's own floors.
 */
export const RECOVERY_DELAY_S = 24 * 3600;
export const RECOVERY_VALIDITY_S = 24 * 3600;
const CANCEL_LINK_PREFIX = 'rcancel#';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** A recovery keeps at most this many claim keys (the register limit); the oldest goes. */
export const MAX_CLAIM_KEYS = 10;
/**
 * 2.7.0 (release R): a recovery stays open across the waits between
 * attempts, for up to about 122 days (VAULT-MESSAGING §11.14.5). The API
 * takes no `expires_at` from a slot later than this after the request, so
 * that a host cannot keep a recovery open, and blocking, for ever.
 */
export const RECOVERY_MAX_SPAN_S = 130 * 86_400;
/** 2.7.0: the open requests remembered on a recovery (their slots live as long as the recovery, plus an hour). */
export const MAX_OPEN_IDS = 10;
/** 2.7.0: opens forwarded per recovery per day, and per source network per 15 minutes (they save work; the vault's counter bounds guessing). */
export const OPEN_LIMIT_PER_RECOVERY = 30;
export const OPEN_LIMIT_PER_NETWORK = 10;

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

// ---- the typed form's locator (2.4.0, VAULT-MESSAGING 0.25.0 §11.11.10) ----------------
//
// 60 random bits as 12 Crockford base32 characters, minted with the request.
// It stands for the pair (vault_id, recovery_id) at the claim and is kept in
// the clear: it is no more than the two identifiers the table holds anyway.
// It is not derived from the code, which the API cannot read. Never logged.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LOCATOR_LENGTH = 12;
const LOCATOR_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
const LOCATOR_PREFIX = 'recovery-locator#';
/** A collision among 60-bit locators is not expected; a few draws bound the loop. */
const LOCATOR_DRAWS = 5;
/** Keys no row has: what a miss reads instead, so that every miss does the same work. */
const NO_VAULT_ID = 'recovery-locator-none';
const NO_USER_GUID = 'recovery-locator-none';

/** An object so tests can stub the draw (a collision draws again). */
export const locators = {
  /** 60 bits from the CSPRNG, most significant 5 bits first. */
  draw(): string {
    let n = randomBytes(8).readBigUInt64BE() >> 4n;
    let out = '';
    for (let i = 0; i < LOCATOR_LENGTH; i++) {
      out = CROCKFORD[Number(n & 31n)] + out;
      n >>= 5n;
    }
    return out;
  },
};

/** Mint a locator for the recovery and write its row (conditional: unique among the rows held). */
async function mintLocator(vaultId: string, recoveryId: string, expiresAt: number): Promise<string> {
  for (let i = 0; i < LOCATOR_DRAWS; i++) {
    const locator = locators.draw();
    try {
      await ddb.send(
        new PutCommand({
          TableName: table.vaultRequests(),
          Item: { request_id: LOCATOR_PREFIX + locator, vault_id: vaultId, op: 'recovery_locator', status: 'locator', recovery_id: recoveryId, created_at: nowIso(), expires_at: expiresAt },
          ConditionExpression: 'attribute_not_exists(request_id)',
        }),
      );
      return locator;
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
    }
  }
  throw new Error('no free recovery locator');
}

/**
 * The pair a locator names, or null (a miss). Every call does the same three
 * consistent reads (the locator's row, a vault row, a pointer row; rows that
 * cannot exist stand in when there is none), and writes nothing, so timing
 * does not tell an unknown locator from a stale one. A miss: no such row, a
 * row past its recovery's expiry, a vault that is gone or deleted, a recovery
 * that was replaced or cancelled, or a member whose pointer names another
 * vault.
 */
async function locatorPair(locator: string, now: number): Promise<{ vault_id: string; recovery_id: string } | null> {
  const row = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: LOCATOR_PREFIX + locator }, ConsistentRead: true }))).Item;
  const named =
    row && row.op === 'recovery_locator' && typeof row.vault_id === 'string' && VAULT_ID_RE.test(row.vault_id) && typeof row.recovery_id === 'string' && Number(row.expires_at) > now
      ? { vault_id: row.vault_id, recovery_id: row.recovery_id }
      : null;
  const v = await vaultRow(named?.vault_id ?? NO_VAULT_ID);
  const pointer = await readPointer(v && typeof v.user_guid === 'string' ? v.user_guid : NO_USER_GUID);
  const r = v?.recovery;
  const current = !!named && !!v && v.state !== 'deleted' && !!r && r.recovery_id === named.recovery_id && r.locator === locator && r.state !== 'cancelled' && pointer?.current_vault_id === v.vault_id;
  return current ? named : null;
}

/**
 * Misses, aggregated per source network and hour for the audit log (as
 * failed redeems): the 1st, 10th, 100th, ... miss of each window is recorded
 * with the count so far. Never the locator tried.
 */
async function auditLocatorMiss(req: MemberRequest): Promise<void> {
  try {
    const r = await hit(`recovery-locator-miss#${req.ip}`, Number.MAX_SAFE_INTEGER, 3600);
    if (/^10*$/.test(String(r.count))) {
      await audit('app', 'vault.recovery_locator_miss', req.ip, { network: req.ip, misses_this_hour: r.count });
    }
  } catch (e) {
    console.error('locator miss not recorded', JSON.stringify({ error: (e as Error).name }));
  }
}

type RecoveryState = 'pending' | 'available' | 'registered' | 'cancelled' | 'expired' | 'unavailable' | 'completed';

/** The state the API answers; `available` and `expired` follow from the clock. */
export function recoveryState(r: RecoveryRow | undefined, now: number): RecoveryState | null {
  if (!r) return null;
  if (r.state === 'cancelled') return 'cancelled';
  // 2.1.0: refused by the enclave (no backup copy, or no credential); ended.
  if (r.state === 'unavailable') return 'unavailable';
  // 2.4.1: the new app holds the credential and is the vault's app; ended.
  if (r.state === 'completed') return 'completed';
  // The code is spent; it stays `registered` after expires_at (0.10.6 §11.11.7).
  if (r.state === 'registered') return 'registered';
  if (now >= r.expires_at) return 'expired';
  return now >= r.available_at ? 'available' : 'pending';
}

/**
 * Pending, available or registered, before expires_at: blocks a new request,
 * can be cancelled. Never a `completed` one (2.4.1), whatever the clock.
 */
export const recoveryActive = (r: RecoveryRow | undefined, now: number): boolean => {
  if (!r || now >= r.expires_at) return false;
  const st = recoveryState(r, now);
  return st === 'pending' || st === 'available' || st === 'registered';
};

/** The host's copy of the enclave's clear marker of a successful register (0.10.6 §11.5). */
export const REGISTERED_CODE = 'recovery_registered';
/** The host's copy of the enclave's clear marker of a refused recovery request (0.16.0 §11.11.2). */
export const UNAVAILABLE_CODE = 'recovery_unavailable';
/** 2.7.0: the host's copy of the enclave's clear marker of a counted recovery open (§11.14.11); never says right or wrong. */
export const ATTEMPT_CODE = 'recovery_attempt';
/** At most this many register ids are kept on a recovery (the route's daily rate limit). */
const MAX_REGISTER_IDS = 10;

const isRegisteredSlot = (item: Record<string, unknown> | undefined): boolean =>
  !!item && item.op === 'recovery_register' && item.status === 'done' && item.code === REGISTERED_CODE && typeof item.recovery_id === 'string';

/** 2.7.0: an open's slot that the enclave marked as a counted attempt. */
const isAttemptSlot = (item: Record<string, unknown> | undefined): boolean =>
  !!item && item.op === 'recovery_open' && item.status === 'done' && item.code === ATTEMPT_CODE && typeof item.recovery_id === 'string';

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** An RFC 3339 time from a slot as epoch seconds (rounded up, so never earlier), or null. */
export function slotTime(v: unknown): number | null {
  if (typeof v !== 'string' || !RFC3339_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.ceil(ms / 1000) : null;
}

/**
 * 2.7.0: keep the request-table rows that live as long as a recovery alive
 * as long as its new `expires_at` (best effort; each only moves later): the
 * recovery's own slot (an hour beyond, as at the request), its locator row
 * and the request email's cancel link. Conditional on each row still naming
 * this recovery.
 */
async function extendRecoveryRows(r: RecoveryRow, expiresAt: number): Promise<void> {
  const rows: [string, number, boolean][] = [[r.recovery_id, expiresAt + 3600, false]];
  if (typeof r.locator === 'string' && LOCATOR_RE.test(r.locator)) rows.push([LOCATOR_PREFIX + r.locator, expiresAt, true]);
  if (typeof r.cancel_key === 'string' && /^[0-9a-f]{64}$/.test(r.cancel_key)) rows.push([CANCEL_LINK_PREFIX + r.cancel_key, expiresAt, true]);
  for (const [key, exp, named] of rows) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: table.vaultRequests(),
        Key: { request_id: key },
        UpdateExpression: 'SET expires_at = :exp',
        ConditionExpression: `attribute_exists(request_id) AND expires_at < :exp${named ? ' AND recovery_id = :rid' : ''}`,
        ExpressionAttributeValues: { ':exp': exp, ...(named ? { ':rid': r.recovery_id } : {}) },
      }));
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') console.error('recovery row not extended', JSON.stringify({ error: (e as Error).name }));
    }
  }
}

/**
 * A cancel link for the recovery: a fresh 256-bit token whose SHA-256 keys a
 * request-table row that expires with the recovery. Returns the token (for
 * the email only) and the row's key.
 */
async function mintCancelLink(v: VaultRow, m: MemberItem, recoveryId: string, expiresAt: number): Promise<{ token: string; key: string }> {
  const token = randomBytes(32).toString('base64url');
  const key = sha256Hex(token);
  await ddb.send(
    new PutCommand({
      TableName: table.vaultRequests(),
      Item: { request_id: CANCEL_LINK_PREFIX + key, vault_id: v.vault_id, user_guid: m.user_guid, op: 'recovery_cancel_link', status: 'link', recovery_id: recoveryId, created_at: nowIso(), expires_at: expiresAt },
      ConditionExpression: 'attribute_not_exists(request_id)',
    }),
  );
  return { token, key };
}

const cancelUrlOf = (token: string) => `https://${env('ACCOUNT_HOST')}/vault/recovery/cancel#t=${token}`;

/**
 * 2.7.0 (release R; VAULT-MESSAGING §11.14.5): the recovery's own slot
 * carries the enclave's clear `not_before`, `expires` and `earliest`. They
 * become `available_at` and `expires_at` (once, while `pending`), and
 * `earliest` stays only if the enclave set it (it could not read its
 * counter). The API keeps its own floor: never earlier than request + 24 h,
 * never open for less than 24 h (both divided by the staging time scale), and never longer than RECOVERY_MAX_SPAN_S
 * after the request (a `not_before` past that cap is shown as it is, and
 * the recovery expires at the cap without becoming available). A release before R sends none of them: the API's own
 * times stand, marked `earliest`. Returns the recovery as it now is.
 */
async function applyEnclaveTimes(v: VaultRow, r: RecoveryRow, slot: Record<string, unknown> | null): Promise<RecoveryRow> {
  if (r.state !== 'pending' || r.enclave_times === true || !slot || slot.status !== 'done') return r;
  const notBefore = slotTime(slot.not_before);
  const expires = slotTime(slot.expires);
  if (notBefore === null || expires === null) return r;
  // Never a time earlier than the enclave's. With a not_before past the cap
  // the recovery can never become available: it is kept pending and ends
  // (expired) at the cap, and the account site shows the enclave's time.
  // The floors at the recovery's own scale (2.8.0), as its estimates were made.
  const scale = r.time_scale ?? 1;
  const availableAt = Math.max(r.requested_at + Math.ceil(RECOVERY_DELAY_S / scale), notBefore);
  const expiresAt = Math.min(r.requested_at + RECOVERY_MAX_SPAN_S, Math.max(expires, availableAt + Math.ceil(RECOVERY_VALIDITY_S / scale)));
  const earliest = slot.earliest === true;
  const before = r.expires_at;
  try {
    await ddb.send(new UpdateCommand({
      TableName: table.vaults(),
      Key: { vault_id: v.vault_id },
      UpdateExpression: `SET recovery.available_at = :a, recovery.expires_at = :x, recovery.enclave_times = :t, updated_at = :now${earliest ? ', recovery.earliest = :t' : ' REMOVE recovery.earliest'}`,
      ConditionExpression: 'recovery.recovery_id = :id AND recovery.#st = :pending AND attribute_not_exists(recovery.enclave_times)',
      ExpressionAttributeNames: { '#st': 'state' },
      ExpressionAttributeValues: { ':a': availableAt, ':x': expiresAt, ':t': true, ':id': r.recovery_id, ':pending': 'pending', ':now': nowIso() },
    }));
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return r; // applied, cancelled or replaced meanwhile
    throw e;
  }
  if (expiresAt > before) await extendRecoveryRows(r, expiresAt);
  const { earliest: _e, ...rest } = r;
  return { ...rest, available_at: availableAt, expires_at: expiresAt, enclave_times: true, ...(earliest ? { earliest: true } : {}) };
}

const attemptMail = (at: number, cancelUrl: string | null) => `An attempt was made to open your VettID vault with a recovery, on ${iso(at)}.

Attempts are limited to ten, and after the first two each wrong one is followed by a growing wait. If this was you and it did not work, the app on your new phone shows when you can try again.

${cancelUrl ? `If this was not you, cancel the recovery now:
${cancelUrl}` : 'If this was not you, sign in to your account page and check that no recovery is in progress.'}

If you still have your phone, open the VettID app and enter your PIN and password.`;

/** 2.7.0: a notice that did not finish (its mail, audit or link failed) may be taken up again after this long. */
export const ATTEMPT_RETRY_S = 300;
/** 2.7.0: after this many tries the notice is given up, recorded and logged (an address SES will never deliver to). */
export const ATTEMPT_MAX_TRIES = 24;

/**
 * 2.7.0 (release R; VAULT-MESSAGING §11.14.11): an open's slot answered with
 * the enclave's `recovery_attempt` is a counted attempt. The member is told
 * once per slot, whatever the phone does afterwards: from the app's poll,
 * from a status read, from the next open, or from the 5-minute sweep
 * (sweepAttempts), whichever comes first.
 *
 * Claim, then work, then record (as the code's release: `releasing` /
 * `released`): a conditional claim (`attempt_noticing`, with a count of
 * tries) lets one caller at a time work on the slot; the recovery's
 * `expires_at` moves to the slot's `expires` when that is later and the
 * recovery is still registered (a wait began; it stays open with the same
 * code); the attempt is audited; the member is mailed with a fresh cancel
 * link; and only then is `attempt_noticed_at` set. A notice that failed
 * anywhere is taken up again ATTEMPT_RETRY_S after its claim (it may then
 * audit twice, which errs on the side of the record); after
 * ATTEMPT_MAX_TRIES it is given up and logged. An attempt whose recovery
 * has since been cancelled or replaced is still mailed and audited; it
 * moves nothing. The API learns that an attempt was counted and when the
 * next is possible, never whether it was right or how many were used.
 * Returns the recovery as it now is.
 */
async function noticeAttempt(m: MemberItem, v: VaultRow, r: RecoveryRow | undefined, slot: Record<string, unknown>): Promise<RecoveryRow | undefined> {
  if (!isAttemptSlot(slot) || slot.user_guid !== m.user_guid || slot.vault_id !== v.vault_id || typeof slot.request_id !== 'string') return r;
  if (slot.attempt_noticed_at !== undefined) return r;
  const now = nowS();
  let tries: number;
  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: table.vaultRequests(),
      Key: { request_id: slot.request_id },
      UpdateExpression: 'SET attempt_noticing = :now, attempt_notice_tries = if_not_exists(attempt_notice_tries, :zero) + :one',
      ConditionExpression: 'attribute_exists(request_id) AND code = :c AND attribute_not_exists(attempt_noticed_at) AND (attribute_not_exists(attempt_noticing) OR attempt_noticing < :stale)',
      ExpressionAttributeValues: { ':now': now, ':zero': 0, ':one': 1, ':c': ATTEMPT_CODE, ':stale': now - ATTEMPT_RETRY_S },
      ReturnValues: 'UPDATED_NEW',
    }));
    tries = Number(res.Attributes?.attempt_notice_tries ?? 1);
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return r; // noticed, or being noticed
    throw e;
  }
  const done = async (extra: Record<string, unknown> = {}) => {
    await ddb.send(new UpdateCommand({
      TableName: table.vaultRequests(),
      Key: { request_id: slot.request_id },
      UpdateExpression: `SET attempt_noticed_at = :now${extra.failed ? ', attempt_notice_failed = :t' : ''} REMOVE attempt_noticing`,
      ConditionExpression: 'attribute_exists(request_id)', // never creates an item
      ExpressionAttributeValues: { ':now': nowS(), ...(extra.failed ? { ':t': true } : {}) },
    }));
  };
  if (tries > ATTEMPT_MAX_TRIES) {
    console.error('recovery attempt notice abandoned', JSON.stringify({ vault_id: v.vault_id, request_id: slot.request_id, tries }));
    await done({ failed: true });
    return r;
  }
  // The recovery the attempt was made in, if it is still the vault's.
  const current = r && r.recovery_id === slot.recovery_id ? r : null;
  let out = r;
  const expires = slotTime(slot.expires);
  if (current && current.state === 'registered' && expires !== null) {
    const moved = Math.min(current.requested_at + RECOVERY_MAX_SPAN_S, expires);
    if (moved > current.expires_at) {
      try {
        await ddb.send(new UpdateCommand({
          TableName: table.vaults(),
          Key: { vault_id: v.vault_id },
          UpdateExpression: 'SET recovery.expires_at = :x, updated_at = :now',
          ConditionExpression: 'recovery.recovery_id = :id AND recovery.#st = :reg AND recovery.expires_at < :x',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: { ':x': moved, ':id': current.recovery_id, ':reg': 'registered', ':now': nowIso() },
        }));
        out = { ...current, expires_at: moved };
        await extendRecoveryRows(current, moved);
      } catch (e) {
        if ((e as Error).name !== 'ConditionalCheckFailedException') throw e; // ended, replaced or moved further meanwhile
      }
    }
  }
  const retryAt = slotTime(slot.retry_at);
  await audit(memberActor(m.user_guid), 'vault.recovery_attempt', m.user_guid, {
    vault_id: v.vault_id, recovery_id: slot.recovery_id, request_id: slot.request_id,
    ...(retryAt !== null ? { retry_at: iso(retryAt) } : {}), ...(expires !== null ? { expires: iso(expires) } : {}),
  });
  const attemptAt = Date.parse(String(slot.created_at));
  // A cancel link only for a recovery that can still be cancelled.
  const live = current && out && recoveryActive(out, nowS()) ? out : null;
  const link = live ? await mintCancelLink(v, m, live.recovery_id, Math.max(live.expires_at, now + 3600)) : null;
  // Not notify(): a failed send must leave the notice to be taken up again.
  await sendMail(m.email, 'VettID vault recovery: an attempt was made', attemptMail(Number.isFinite(attemptAt) ? Math.floor(attemptAt / 1000) : now, link ? cancelUrlOf(link.token) : null));
  await done();
  return out;
}

/**
 * Notice the counted attempts among a recovery's open slots (each a read),
 * oldest first. A notice that fails is logged, not thrown. Returns the
 * recovery as it now is and how many counted attempts are still not
 * recorded as noticed (being noticed elsewhere, or failing).
 */
async function noticeOpenSlots(m: MemberItem, v: VaultRow, r: RecoveryRow): Promise<{ r: RecoveryRow; unnoticed: number }> {
  let cur: RecoveryRow = r;
  let unnoticed = 0;
  for (const id of (r.open_ids ?? []).slice(-MAX_OPEN_IDS)) {
    if (!ULID_RE.test(id)) continue;
    const slot = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: id }, ConsistentRead: true }))).Item;
    if (!isAttemptSlot(slot) || slot!.attempt_noticed_at !== undefined) continue;
    try {
      cur = (await noticeAttempt(m, v, cur, slot!)) ?? cur;
    } catch (e) {
      console.error('recovery attempt not noticed', JSON.stringify({ request_id: id, error: (e as Error).name }));
    }
    const after = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: id }, ConsistentRead: true }))).Item;
    if (after && after.attempt_noticed_at === undefined) unnoticed++;
  }
  return { r: cur, unnoticed };
}

/**
 * 2.7.0: the backstop that does not depend on any client (lambda/jobs/
 * vault-attempts.ts, every 5 minutes). It finds every open slot the
 * enclave marked as a counted attempt that has not been noticed (or whose
 * notice stalled for ATTEMPT_RETRY_S) and notices it. Open slots live as
 * long as their recovery (plus an hour), so none expires unnoticed. The
 * request table is small (slots, links, locators, setup-code issuances),
 * so a filtered Scan is the simplest complete search. Returns the counts.
 */
export async function sweepAttempts(): Promise<{ found: number; noticed: number; failed: number }> {
  const now = nowS();
  let found = 0;
  let noticed = 0;
  let failed = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(new ScanCommand({
      TableName: table.vaultRequests(),
      FilterExpression: '#op = :op AND code = :c AND attribute_not_exists(attempt_noticed_at) AND (attribute_not_exists(attempt_noticing) OR attempt_noticing < :stale)',
      ExpressionAttributeNames: { '#op': 'op' },
      ExpressionAttributeValues: { ':op': 'recovery_open', ':c': ATTEMPT_CODE, ':stale': now - ATTEMPT_RETRY_S },
      ExclusiveStartKey: start,
    }));
    for (const slot of page.Items ?? []) {
      if (!isAttemptSlot(slot) || !VAULT_ID_RE.test(String(slot.vault_id))) continue;
      found++;
      try {
        const [v, m] = await Promise.all([vaultRow(String(slot.vault_id)), memberByGuid(String(slot.user_guid))]);
        if (!v || !m || v.user_guid !== m.user_guid) continue; // the vault or the member is gone: nobody to tell
        await noticeAttempt(m, v, v.recovery, slot);
        noticed++;
      } catch (e) {
        failed++;
        console.error('recovery attempt not noticed', JSON.stringify({ request_id: slot.request_id, error: (e as Error).name }));
      }
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return { found, noticed, failed };
}

// ---- a recovery cancelled from the phone (2.9.0; VAULT-MESSAGING 0.49.0 §11.5, §11.11.4) ----
//
// An owner app's unlock with `cancel_recovery` ends a recovery inside the
// vault. The enclave names the recovery it ended (its own id, the API's
// `recovery_id`) in two places: the unlock's slot (`code:
// "recovery_cancelled"` with `cancelled_recovery_id`, copied by the host)
// and, as the backstop for an answer lost before its slot was written, the
// vault row (`recovery_cancelled`, from the unlock's lifecycle event). Either
// ends only the recovery with that id, once: one notice row per recovery
// (`rcnotice#<recovery_id>`) is claimed before anything is audited or
// mailed, as noticeAttempt claims a slot. No `recovery_cancel` is enqueued:
// the vault has already ended the recovery.

/** 2.9.0: the host's copy of the enclave's clear marker of an unlock that cancelled a recovery. */
export const CANCELLED_CODE = 'recovery_cancelled';
/** 2.9.0: the unlock requests remembered on a recovery. */
export const MAX_UNLOCK_IDS = 10;
const NOTICE_PREFIX = 'rcnotice#';

/** 2.9.0: an unlock slot the host marked with the enclave's `recovery_cancelled` and the id of the recovery it ended. The marker on any other op's slot is ignored. */
const isCancelledSlot = (item: Record<string, unknown> | undefined): boolean =>
  !!item && item.op === 'unlock' && item.status === 'done' && item.code === CANCELLED_CODE && typeof item.request_id === 'string'
  && typeof item.cancelled_recovery_id === 'string' && ULID_RE.test(item.cancelled_recovery_id);

/** The vault row's host-written `recovery_cancelled`, if it names a recovery. */
const rowCancelledId = (v: Pick<VaultRow, 'recovery_cancelled'>): string | null => {
  const rc = v.recovery_cancelled;
  return rc && typeof rc.recovery_id === 'string' && ULID_RE.test(rc.recovery_id) ? rc.recovery_id : null;
};

/** The recovery `id` is the vault's and can still be cancelled: `pending` or `registered` (the row's states; `available` follows from the clock) before its `expires_at`. */
const cancellable = (r: RecoveryRow | undefined, id: string, now: number): r is RecoveryRow =>
  !!r && r.recovery_id === id && (r.state === 'pending' || r.state === 'registered') && now < r.expires_at;

/**
 * 2.9.0: the cancel write, for every cancel (the session route, the link
 * route and a cancel from the phone): a conditional field update that never
 * replaces the `recovery` map (not setRecovery), so concurrent cancels have
 * exactly one winner, and a concurrent `unlock_ids` append is neither lost
 * nor undoes it. True: this call cancelled it.
 */
async function cancelWrite(vaultId: string, recoveryId: string, via: CancelVia, now: number): Promise<boolean> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: table.vaults(),
      Key: { vault_id: vaultId },
      UpdateExpression: 'SET recovery.#st = :cancelled, recovery.cancelled_via = :via, recovery.cancelled_at = :now, updated_at = :nowIso',
      ConditionExpression: 'recovery.recovery_id = :id AND recovery.#st IN (:pending, :registered) AND recovery.expires_at > :now',
      ExpressionAttributeNames: { '#st': 'state' },
      ExpressionAttributeValues: { ':cancelled': 'cancelled', ':via': via, ':now': now, ':nowIso': nowIso(), ':id': recoveryId, ':pending': 'pending', ':registered': 'registered' },
    }));
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false; // ended, cancelled or replaced meanwhile
    throw e;
  }
}

/**
 * Remember an unlock request on its recovery (best effort: the app's poll
 * and the sweep find the slot anyway). A conditional field update on the
 * same recovery and on the list read (retried on a concurrent append),
 * never a replacement of the recovery.
 */
async function recordUnlockId(v: VaultRow, r: RecoveryRow, requestId: string): Promise<void> {
  let cur = r;
  for (let i = 0; i < 3; i++) {
    const old = Array.isArray(cur.unlock_ids) ? cur.unlock_ids : undefined;
    const ids = [...(old ?? []), requestId].slice(-MAX_UNLOCK_IDS);
    try {
      await ddb.send(new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET recovery.unlock_ids = :ids, updated_at = :now',
        ConditionExpression: `recovery.recovery_id = :id AND ${old ? 'recovery.unlock_ids = :old' : 'attribute_not_exists(recovery.unlock_ids)'}`,
        ExpressionAttributeValues: { ':ids': ids, ':id': r.recovery_id, ':now': nowIso(), ...(old ? { ':old': old } : {}) },
      }));
      return;
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') break;
      const fresh = await vaultRow(v.vault_id);
      if (!fresh?.recovery || fresh.recovery.recovery_id !== r.recovery_id) return; // replaced: nothing to remember it on
      cur = fresh.recovery;
    }
  }
  console.error('unlock id not recorded', JSON.stringify({ vault_id: v.vault_id }));
}

// Draft for the owner's wording (MEMBER-API 2.9.0 "Email").
const appCancelMail = (requestedAt: number) => `The recovery of your VettID vault requested at ${iso(requestedAt)} was cancelled from your VettID app, which unlocked the vault with your PIN. Your apps can unlock the vault again.

If you did not do this, someone else may have your phone and know your PIN. Sign in to your account page and request a new recovery, and change your PIN once your vault is back on a phone you hold.`;

type NoticeClaim = { tries: number } | 'absent' | 'noticed' | 'busy';

/**
 * Claim the recovery's notice row: set `noticing` and count `notice_tries`,
 * only while it has no `noticed_at` and no `noticing` newer than
 * ATTEMPT_RETRY_S. `openTtl` (a live recovery only) may create the row, with
 * that TTL; without it only an existing row is taken up. A refused claim
 * says why: no row, already noticed, or under way.
 */
async function claimNotice(m: MemberItem, v: VaultRow, recoveryId: string, openTtl: number | null, now: number): Promise<NoticeClaim> {
  try {
    const res = await ddb.send(new UpdateCommand({
      TableName: table.vaultRequests(),
      Key: { request_id: NOTICE_PREFIX + recoveryId },
      UpdateExpression: `SET noticing = :now, notice_tries = if_not_exists(notice_tries, :zero) + :one${openTtl !== null ? ', vault_id = :v, user_guid = :g, recovery_id = :rid, expires_at = :exp' : ''}`,
      ConditionExpression: `${openTtl !== null ? '' : 'attribute_exists(request_id) AND '}attribute_not_exists(noticed_at) AND (attribute_not_exists(noticing) OR noticing < :stale)`,
      ExpressionAttributeValues: {
        ':now': now, ':zero': 0, ':one': 1, ':stale': now - ATTEMPT_RETRY_S,
        ...(openTtl !== null ? { ':v': v.vault_id, ':g': m.user_guid, ':rid': recoveryId, ':exp': openTtl } : {}),
      },
      ReturnValues: 'UPDATED_NEW',
      ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
    }));
    return { tries: Number(res.Attributes?.notice_tries ?? 1) };
  } catch (e) {
    if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
    const old = (e as { Item?: Record<string, unknown> }).Item;
    if (!old || Object.keys(old).length === 0) return 'absent';
    return old.noticed_at !== undefined ? 'noticed' : 'busy';
  }
}

/** The slot's own claim (`cancel_noticed_at`, conditional): true for the one caller that set it. */
async function markSlotNoticed(requestId: string, recoveryId: string): Promise<boolean> {
  try {
    await ddb.send(new UpdateCommand({
      TableName: table.vaultRequests(),
      Key: { request_id: requestId },
      UpdateExpression: 'SET cancel_noticed_at = :now',
      ConditionExpression: 'attribute_exists(request_id) AND cancelled_recovery_id = :rid AND attribute_not_exists(cancel_noticed_at)', // never creates an item
      ExpressionAttributeValues: { ':now': nowS(), ':rid': recoveryId },
    }));
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

type CancelSource = { kind: 'slot'; slot: Record<string, unknown> } | { kind: 'row' } | { kind: 'notice' };

/**
 * 2.9.0: notice the cancel of recovery `recoveryId` by an owner app's unlock,
 * from an unlock slot's marker, the vault row's `recovery_cancelled`, or (the
 * sweep) a notice row whose claim stalled.
 *
 * Claim, work, record (as noticeAttempt):
 *  - a new notice row is opened only while the named recovery is the
 *    vault's and still pending or registered before its `expires_at`;
 *    otherwise only an existing row without `noticed_at` is taken up. Once
 *    the cancel write has run the recovery is `cancelled` for good, so
 *    neither the row's `recovery_cancelled` (never cleared), a moved
 *    `expires_at` nor the notice row's expiry can open a second notice;
 *  - an already ended recovery opens no notice: a slot naming it is claimed
 *    by its own `cancel_noticed_at`, and only that claimer audits
 *    `vault.recovery_cancel_seen` (never from the vault row alone);
 *  - the work: the completion check, then the cancel write (`app`); its
 *    winner (or a taker-up that finds the recovery `cancelled` via `app`)
 *    audits `vault.recovery_cancel` and mails with sendMail (a failed send
 *    throws and leaves the claim to be taken up after ATTEMPT_RETRY_S);
 *    otherwise the recovery ended meanwhile: `vault.recovery_cancel_seen`;
 *  - the record: `noticed_at`, and the slot's `cancel_noticed_at`.
 * After ATTEMPT_MAX_TRIES the notice is given up, recorded and logged.
 * `peek: false` (the sweep, which may not read the request table): a row
 * source is acted on only for a live recovery. Returns true when it claimed
 * the notice (the vault row may have changed).
 */
async function noticeAppCancel(m: MemberItem, v: VaultRow, recoveryId: string, src: CancelSource, opts: { peek?: boolean } = {}): Promise<boolean> {
  if (!ULID_RE.test(recoveryId)) return false;
  const slot = src.kind === 'slot' ? src.slot : null;
  if (slot && (!isCancelledSlot(slot) || slot.cancelled_recovery_id !== recoveryId || slot.user_guid !== m.user_guid || slot.vault_id !== v.vault_id || slot.cancel_noticed_at !== undefined)) return false;
  const now = nowS();
  const live = cancellable(v.recovery, recoveryId, now);
  if (!live && src.kind === 'row') {
    // Only a stalled notice is taken up from the row; a read first, rather
    // than a refused conditional write on every status read.
    if (opts.peek === false) return false;
    const row = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: NOTICE_PREFIX + recoveryId }, ConsistentRead: true }))).Item;
    if (!row || row.noticed_at !== undefined || (typeof row.noticing === 'number' && row.noticing >= now - ATTEMPT_RETRY_S)) return false;
  }
  const claim = await claimNotice(m, v, recoveryId, live ? Math.max(v.recovery!.expires_at, now) + 86_400 : null, now);
  if (claim === 'busy') return false;
  if (claim === 'absent' || claim === 'noticed') {
    if (slot) await slotOfEndedRecovery(m, v, recoveryId, slot, claim === 'noticed', now);
    return false;
  }
  const record = async (failed = false) => {
    await ddb.send(new UpdateCommand({
      TableName: table.vaultRequests(),
      Key: { request_id: NOTICE_PREFIX + recoveryId },
      UpdateExpression: `SET noticed_at = :now${failed ? ', notice_failed = :t' : ''} REMOVE noticing`,
      ConditionExpression: 'attribute_exists(request_id)', // never creates an item
      ExpressionAttributeValues: { ':now': nowS(), ...(failed ? { ':t': true } : {}) },
    }));
    if (slot) await markSlotNoticed(String(slot.request_id), recoveryId);
  };
  if (claim.tries > ATTEMPT_MAX_TRIES) {
    console.error('recovery cancel notice abandoned', JSON.stringify({ vault_id: v.vault_id, recovery_id: recoveryId, tries: claim.tries }));
    await record(true);
    return true;
  }
  // The completion check first (2.4.1), as for the cancel routes.
  const cur = await completeRecovery(m, v);
  let r = cur.recovery;
  let won = !!r && r.recovery_id === recoveryId && (await cancelWrite(cur.vault_id, recoveryId, 'app', now));
  if (!won) {
    const fresh = await vaultRow(v.vault_id);
    r = fresh && fresh.user_guid === m.user_guid ? fresh.recovery : undefined;
    // A claim taken up after it stopped between the cancel write and the email.
    won = !!r && r.recovery_id === recoveryId && r.state === 'cancelled' && r.cancelled_via === 'app';
  }
  if (won) {
    const source = slot ? 'slot' : src.kind === 'row' || rowCancelledId(v) === recoveryId ? 'row' : 'slot';
    await audit(memberActor(m.user_guid), 'vault.recovery_cancel', m.user_guid, {
      vault_id: v.vault_id, recovery_id: recoveryId, via: 'app', ...(slot ? { request_id: slot.request_id } : {}), source,
    });
    // Not notify(): a failed send must leave the notice to be taken up again.
    await sendMail(m.email, 'VettID vault recovery cancelled', appCancelMail(r!.requested_at));
  } else {
    // Ended between the claim and the write: replaced, cancelled from the
    // account site, completed, unavailable or past its expires_at.
    const ended = r && r.recovery_id === recoveryId ? (recoveryState(r, nowS()) ?? 'replaced') : 'replaced';
    await audit(memberActor(m.user_guid), 'vault.recovery_cancel_seen', m.user_guid, { vault_id: v.vault_id, recovery_id: recoveryId, ended });
  }
  await record();
  return true;
}

/**
 * A slot whose marker names a recovery that has already ended here (or is
 * no longer the vault's), with no notice to take up: claimed by its own
 * `cancel_noticed_at`, and only that claimer audits
 * `vault.recovery_cancel_seen`, once per slot. Nothing is mailed. When the
 * recovery's notice exists and is done (`covered`), or the recovery reads
 * cancelled from the phone already, the slot is only marked.
 */
async function slotOfEndedRecovery(m: MemberItem, v: VaultRow, recoveryId: string, slot: Record<string, unknown>, covered: boolean, now: number): Promise<void> {
  if (!(await markSlotNoticed(String(slot.request_id), recoveryId))) return;
  if (covered) return;
  const r = v.recovery && v.recovery.recovery_id === recoveryId ? v.recovery : null;
  if (r && r.state === 'cancelled' && r.cancelled_via === 'app') return;
  await audit(memberActor(m.user_guid), 'vault.recovery_cancel_seen', m.user_guid, {
    vault_id: v.vault_id, recovery_id: recoveryId, ended: r ? (recoveryState(r, now) ?? 'replaced') : 'replaced',
  });
}

/**
 * 2.9.0: the status reads (GET /api/vault/recovery and /status) and the
 * recovery request (before a 409 recovery_active): the vault row's
 * `recovery_cancelled`, then the slots of the active recovery's
 * `unlock_ids`. A notice that fails is logged, not thrown. Returns the
 * vault row as it now is.
 */
async function noticeAppCancels(m: MemberItem, v: VaultRow): Promise<VaultRow> {
  let cur = v;
  const reread = async () => {
    const fresh = await vaultRow(v.vault_id);
    if (fresh && fresh.user_guid === v.user_guid) cur = fresh;
  };
  const rowId = rowCancelledId(cur);
  if (rowId) {
    try {
      if (await noticeAppCancel(m, cur, rowId, { kind: 'row' })) await reread();
    } catch (e) {
      console.error('recovery cancel not noticed', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
      await reread(); // the cancel write may have run before the failure
    }
  }
  const r = cur.recovery;
  if (!r || !recoveryActive(r, nowS()) || !Array.isArray(r.unlock_ids)) return cur;
  for (const id of r.unlock_ids.slice(-MAX_UNLOCK_IDS)) {
    if (typeof id !== 'string' || !ULID_RE.test(id)) continue;
    const slot = (await ddb.send(new GetCommand({ TableName: table.vaultRequests(), Key: { request_id: id }, ConsistentRead: true }))).Item;
    if (!isCancelledSlot(slot) || slot!.cancel_noticed_at !== undefined) continue;
    try {
      if (await noticeAppCancel(m, cur, String(slot!.cancelled_recovery_id), { kind: 'slot', slot: slot! })) await reread();
    } catch (e) {
      console.error('recovery cancel not noticed', JSON.stringify({ request_id: id, error: (e as Error).name }));
      await reread();
    }
  }
  return cur;
}

/**
 * 2.9.0: the client-independent backstop (lambda/jobs/vault-attempts.ts,
 * every 5 minutes): unlock slots with `cancelled_recovery_id` and no
 * `cancel_noticed_at` (they live as long as their recovery, plus an hour),
 * notice rows whose claim stalled, and vault rows (a Scan projecting only
 * `vault_id`, `recovery` and `recovery_cancelled`) whose
 * `recovery_cancelled` names a recovery still pending or registered.
 * Returns the counts (`found`: RecoveryCancelsUnnoticed).
 */
export async function sweepAppCancels(): Promise<{ found: number; noticed: number; failed: number }> {
  let found = 0;
  let noticed = 0;
  let failed = 0;
  const run = async (vaultId: string, guid: string, recoveryId: string, src: CancelSource, label: string) => {
    found++;
    try {
      const [v, m] = await Promise.all([vaultRow(vaultId), memberByGuid(guid)]);
      if (!v || !m || v.user_guid !== m.user_guid) return; // the vault or the member is gone: nobody to tell
      if (src.kind === 'row' && !cancellable(v.recovery, recoveryId, nowS())) return;
      await noticeAppCancel(m, v, recoveryId, src, { peek: false });
      noticed++;
    } catch (e) {
      failed++;
      console.error('recovery cancel not noticed', JSON.stringify({ [label]: label === 'vault_id' ? vaultId : src.kind === 'slot' ? src.slot.request_id : NOTICE_PREFIX + recoveryId, error: (e as Error).name }));
    }
  };
  let start: Record<string, unknown> | undefined;
  do {
    const now = nowS();
    const page = await ddb.send(new ScanCommand({
      TableName: table.vaultRequests(),
      FilterExpression: '(#op = :unlock AND code = :c AND attribute_exists(cancelled_recovery_id) AND attribute_not_exists(cancel_noticed_at)) OR (begins_with(request_id, :rcn) AND attribute_not_exists(noticed_at) AND noticing < :stale)',
      ExpressionAttributeNames: { '#op': 'op' },
      ExpressionAttributeValues: { ':unlock': 'unlock', ':c': CANCELLED_CODE, ':rcn': NOTICE_PREFIX, ':stale': now - ATTEMPT_RETRY_S },
      ExclusiveStartKey: start,
    }));
    for (const item of page.Items ?? []) {
      if (!VAULT_ID_RE.test(String(item.vault_id)) || typeof item.user_guid !== 'string') continue;
      if (String(item.request_id).startsWith(NOTICE_PREFIX)) {
        if (typeof item.recovery_id !== 'string' || NOTICE_PREFIX + item.recovery_id !== item.request_id || item.noticed_at !== undefined) continue;
        await run(item.vault_id as string, item.user_guid, item.recovery_id, { kind: 'notice' }, 'request_id');
      } else if (isCancelledSlot(item) && item.cancel_noticed_at === undefined) {
        await run(item.vault_id as string, item.user_guid, String(item.cancelled_recovery_id), { kind: 'slot', slot: item }, 'request_id');
      }
    }
    start = page.LastEvaluatedKey;
  } while (start);
  do {
    const page: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> } = await ddb.send(new ScanCommand({
      TableName: table.vaults(),
      ProjectionExpression: 'vault_id, recovery, recovery_cancelled',
      FilterExpression: 'attribute_exists(recovery_cancelled)',
      Select: 'SPECIFIC_ATTRIBUTES',
      ExclusiveStartKey: start,
    }));
    for (const row of (page.Items ?? []) as unknown as Pick<VaultRow, 'vault_id' | 'recovery' | 'recovery_cancelled'>[]) {
      const rid = rowCancelledId(row);
      if (!rid || !VAULT_ID_RE.test(String(row.vault_id)) || !cancellable(row.recovery, rid, nowS())) continue;
      // The member comes from the full row (GetItem); the projection names three attributes only.
      const full = await vaultRow(row.vault_id);
      if (!full || typeof full.user_guid !== 'string') continue;
      await run(row.vault_id, full.user_guid, rid, { kind: 'row' }, 'vault_id');
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return { found, noticed, failed };
}

/**
 * 2.9.0 ("A cancel names its recovery", VAULT-MESSAGING 0.49.0 §11.14.8):
 * whether a `recovery_cancel` to this instance carries `recovery_id` and the
 * eight-line signature. Only when the instance's release is at least
 * RECOVERY_CANCEL_ID_FROM_RELEASE; unset (or malformed), never: an older
 * release would fail the named form's signature and ignore the cancel.
 */
export async function cancelNamesRecovery(inst: Pick<InstanceRow, 'release'>): Promise<boolean> {
  const raw = process.env.RECOVERY_CANCEL_ID_FROM_RELEASE;
  if (raw === undefined || !/^[1-9][0-9]{0,8}$/.test(raw)) return false;
  const rel = await releaseRow(inst.release);
  return typeof rel?.release_number === 'number' && rel.release_number >= Number(raw);
}

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
  await audit(memberActor(m.user_guid), 'vault.recovery_registered', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id });
  return { ...r, state: 'registered', ...(recovering ? { recovering_key: recovering } : {}) };
}

/**
 * 2.4.1 (VAULT-MESSAGING §11.11.5 step 3, §11.5): the recovery has completed
 * in the vault. The only sign the API has, and the one it already trusts to
 * admit the new app and refuse the old one: the host's `app_key` on the vault
 * row names the recovery's recovering key. The vault makes the registered
 * app's key its app key only in the flush of a successful
 * `credential.recover` (PIN and credential password both proved), and the
 * host writes `app_key` after that flush is stored. `registered` alone is not
 * it, and a recovery without a recovering key is never completed here.
 */
const recoveryCompleted = (v: VaultRow): boolean => {
  const r = v.recovery;
  return !!r && r.state === 'registered' && isStoredKey(r.recovering_key) && isStoredKey(v.app_key) && r.recovering_key.kid === v.app_key.kid;
};

/**
 * Record a completed recovery: `registered` -> `completed`, an ended state
 * that no longer blocks a new request, and its keys cleared. Conditional on
 * the same recovery, still registered, with the recovering key that was
 * compared. The condition names only the API's own attributes: the API's
 * role may not name the host's `app_key` in a write (the table's
 * attribute-level policy), and a later change of `app_key` (a transfer)
 * does not undo a completion. A recovery that is not completed, or that
 * changed meanwhile, is returned as read. Returns the vault row with its
 * recovery as it now is.
 */
async function completeRecovery(m: MemberItem, v: VaultRow): Promise<VaultRow> {
  if (!recoveryCompleted(v)) return v;
  const r = v.recovery!;
  const kid = r.recovering_key!.kid;
  const completedAt = nowS();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET recovery.#st = :done, recovery.completed_at = :at, updated_at = :now REMOVE recovery.claim_keys, recovery.recovering_key',
        ConditionExpression: 'recovery.recovery_id = :id AND recovery.#st = :reg AND recovery.recovering_key.kid = :k',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':done': 'completed', ':reg': 'registered', ':id': r.recovery_id, ':k': kid, ':at': completedAt, ':now': nowIso() },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return v; // recorded, cancelled or replaced meanwhile
    throw e;
  }
  await audit(memberActor(m.user_guid), 'vault.recovery_completed', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id, kid });
  // 2.7.0: the completion email (draft text, MEMBER-API "Recovery from release R").
  await notify(m.email, 'VettID vault recovered', `Your VettID vault was recovered on ${iso(completedAt)} and is now on a new phone. Your old app was removed.`);
  const { claim_keys: _c, recovering_key: _k, ...rest } = r;
  return { ...v, recovery: { ...rest, state: 'completed', completed_at: completedAt } };
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
async function refreshUnavailable(m: MemberItem, v: VaultRow, r: RecoveryRow, now: number, read?: Record<string, unknown> | null): Promise<RecoveryRow> {
  if (r.state !== 'pending' || now >= r.expires_at) return r;
  const slot = read === undefined ? await recoverySlot(m, r) : read;
  if (!slot || slot.status !== 'done' || slot.code !== UNAVAILABLE_CODE) return r;
  // 2.7.0: the slot's clear reason (`not_offered`: a release that refuses recovery, §11.14.13).
  const reason = typeof slot.reason === 'string' && RECOVERY_REASONS.has(slot.reason) ? (slot.reason as RecoveryReason) : null;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: `SET recovery.#st = :un, updated_at = :now${reason ? ', recovery.reason = :reason' : ''}`,
        ConditionExpression: 'recovery.recovery_id = :id AND recovery.#st = :pending',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':un': 'unavailable', ':pending': 'pending', ':id': r.recovery_id, ':now': nowIso(), ...(reason ? { ':reason': reason } : {}) },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return r; // cancelled, registered or replaced meanwhile
    throw e;
  }
  await audit(memberActor(m.user_guid), 'vault.recovery_unavailable', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id, ...(reason ? { reason } : {}) });
  return { ...r, state: 'unavailable', ...(reason ? { reason } : {}) };
}

/**
 * A `pending` recovery from its own slot, read once: the enclave's refusal
 * (2.1.0), else (2.7.0) the enclave's times. Returns the recovery as it now is.
 */
async function refreshPending(m: MemberItem, v: VaultRow, r: RecoveryRow, now: number): Promise<RecoveryRow> {
  if (r.state !== 'pending' || now >= r.expires_at) return r;
  const slot = await recoverySlot(m, r);
  const refused = await refreshUnavailable(m, v, r, now, slot);
  if (refused !== r) return refused;
  return applyEnclaveTimes(v, r, slot);
}

/**
 * Bring the recovery up to date: its completion (2.4.1, from the vault row
 * itself), then from its slots: the enclave's refusal
 * (2.1.0, above), then, while the code is available, the slots of its
 * register requests (they live 15 minutes): one answered with the marker
 * means the code is spent. Returns the vault row with its recovery updated.
 */
async function refreshRecovery(m: MemberItem, found: VaultRow): Promise<VaultRow> {
  if (!found.recovery) return found;
  const vc = await completeRecovery(m, found);
  if (vc !== found || !vc.recovery) return vc;
  // 2.9.0: a recovery cancelled from the phone (the row's recovery_cancelled, the unlock slots).
  const v0 = await noticeAppCancels(m, vc);
  if (!v0.recovery || v0.recovery.recovery_id !== vc.recovery.recovery_id || v0.recovery.state !== vc.recovery.state) return v0;
  const pending = await refreshPending(m, v0, v0.recovery, nowS());
  if (pending.state !== v0.recovery.state) return { ...v0, recovery: pending };
  const v = pending === v0.recovery ? v0 : { ...v0, recovery: pending };
  const r = v.recovery!;
  // 2.7.0: a registered recovery's opens (their slots live as long as the recovery, plus an hour): each
  // counted attempt is noticed once.
  if (r.state === 'registered' && r.open_ids?.length) {
    const { r: cur } = await noticeOpenSlots(m, v, r);
    return cur === r ? v : { ...v, recovery: cur };
  }
  if (recoveryState(r, nowS()) !== 'available' || !r.register_ids?.length) return v;
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

// 2.7.0 (release R): draft text for the owner's wording (MEMBER-API "Recovery from release R").
const requestedMail = (cancelUrl: string, availableAt: number) => `A recovery of your VettID vault was requested from your account.

Your vault has been locked. If nobody cancels, a one-time recovery code becomes available on your account page at ${iso(availableAt)} at the earliest, for 24 hours. The time can be later: a vault cannot be recovered until three days after its app was last used with the PIN and the password. Your account page shows the exact time.

A new phone then needs the code, your vault PIN and your credential password, entered together. There are ten attempts in all. After the first two, each wrong attempt is followed by a wait, which starts at one day and grows to thirty days. You get an email for every attempt.

The new app replaces your current app, which is removed; your desktops and agents stay paired. A vault whose credential backup is off cannot be recovered: it refuses the recovery, and your account page then says so.

If you did not ask for this, cancel it now:
${cancelUrl}

If you still have your phone, open the VettID app and enter your PIN and password there: that also stops this recovery. You can also cancel it from your account page.`;

/** 2.7.0: a recovery operation that could not be signed is not sent; the member may try again. */
const signingUnavailable = () =>
  vaultError(503, 'vault_unavailable', 'Recovery requests cannot be signed right now. Try again later.', { retry_after: 60 });

/**
 * Cancel: mark it, tell the enclave, tell the member. False: nothing to
 * cancel (a no-op), or (2.9.0) another cancel won the conditional write
 * (another route, or a cancel from the phone): only the winner enqueues,
 * audits and mails.
 */
async function cancelRecovery(m: MemberItem, found: VaultRow, via: 'session' | 'link'): Promise<boolean> {
  const now = nowS();
  // 2.4.1: a completed recovery has ended; there is nothing to cancel.
  const v = await completeRecovery(m, found);
  const r = v.recovery;
  if (!r || !recoveryActive(r, now)) return false;
  if (!(await cancelWrite(v.vault_id, r.recovery_id, via, now))) return false;
  try {
    const inst = await recoveryInstance(v, now, isCanaryMember(m));
    // 2.7.0 (§11.14.8): signed; an enclave of release R ignores an unsigned cancel.
    // 2.9.0: from RECOVERY_CANCEL_ID_FROM_RELEASE it names the recovery (inside the signature).
    const named = await cancelNamesRecovery(inst);
    const cancelId = newUlid();
    const sig = await signRecoveryRequest('recovery_cancel', v.vault_id, m.user_guid, cancelId, undefined, Date.now(), named ? r.recovery_id : undefined);
    await enqueue('recovery_cancel', m, v, cancelId, inst, undefined, { extra: { ...(named ? { recovery_id: r.recovery_id } : {}), ...sig } });
  } catch (e) {
    // The enclave also refuses the code if the API never releases it, but
    // a cancel that could not be queued is worth knowing about.
    console.error('recovery cancel not queued', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
  }
  await audit(memberActor(m.user_guid), 'vault.recovery_cancel', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id, via });
  await notify(m.email, 'VettID vault recovery cancelled', `The recovery of your VettID vault requested at ${iso(r.requested_at)} has been cancelled. Your apps can unlock the vault again.`);
  return true;
}


router.on('POST', '/api/vault/recovery', async (req) => {
  const m = await loadVaultMember(req);
  await requireService();
  const bk = req.body.browser_key;
  const key = typeof bk === 'string' ? decodeCanonicalB64(bk) : null;
  if (!key || key.length !== 65 || key[0] !== 0x04) throw badRequest('browser_key must be base64 of an uncompressed P-256 point');
  // 2.7.0 (§11.14.8): signed first, before the request limit is counted and
  // before anything is written, so that a key that cannot sign (a KMS
  // outage) neither uses up the member's three requests nor leaves anything
  // behind. A member without an enrolled vault gets the 404 below, counted.
  // A looser limit before the signature (each one is a KMS call): 10 an
  // hour per member. The 3 a day are counted after it succeeds.
  await limit(`vault-recovery-sign#${m.user_guid}`, 10, 3600);
  const recoveryId = newUlid();
  const pre = activeVault((await currentVault(m.user_guid)).vault);
  let sig;
  if (pre && pre.state !== 'enrolling') {
    try {
      sig = await signRecoveryRequest('recovery', pre.vault_id, m.user_guid, recoveryId, key);
    } catch (e) {
      console.error('recovery request not signed', JSON.stringify({ vault_id: pre.vault_id, error: (e as Error).name }));
      throw signingUnavailable();
    }
  }
  await limit(`vault-recovery#${m.user_guid}`, 3, 86_400);
  const now = nowS();
  // 2.4.1: a completed recovery is recorded first, so it does not block this one.
  // 2.9.0: so is a recovery cancelled from the phone that nobody noticed yet.
  const v = await noticeAppCancels(m, await completeRecovery(m, await recoverableVault(m.user_guid)));
  // The vault the signature names (it changed in between only if the member enrolled anew).
  if (!sig || v.vault_id !== pre!.vault_id) throw vaultError(409, 'conflict', 'The vault changed; try again');
  if (recoveryActive(v.recovery, now)) throw vaultError(409, 'recovery_active', 'A recovery is already in progress');
  if (deletionOf(v)) throw deletionPending();
  // 2.1.0 (VAULT-MESSAGING 0.16.0 §11.11.7): no recovery with the credential
  // backup off. Refused before anything is written, queued, locked or mailed;
  // with the bit absent the request goes on and the enclave decides.
  if (v.credential_backup === false) {
    throw vaultError(409, 'recovery_unavailable', 'This vault cannot be recovered: its credential backup is off. You can delete it and start over.', { reason: 'no_backup' });
  }
  const inst = await recoveryInstance(v, now, isCanaryMember(m));
  // 2.8.0 (staging): scaled only for a vault on a release that ships `time_scale`, whose enclave scales its own times.
  // (No read at all at scale 1, production.)
  const scale = timeScale() === 1 ? 1 : recoveryScale((await releaseRow(v.sealed_release!))?.release_number);
  const availableAt = now + Math.ceil(RECOVERY_DELAY_S / scale);
  const expiresAt = availableAt + Math.ceil(RECOVERY_VALIDITY_S / scale);
  // 2.4.0: the typed form's locator, minted with the request. Its row is
  // written first, so the recovery never names a locator without a row; a
  // row whose request then fails names no current recovery (a miss) and expires.
  const locator = await mintLocator(v.vault_id, recoveryId, expiresAt);
  // The cancel link's row, before the recovery that names it (a row whose request fails names no current recovery).
  const link = await mintCancelLink(v, m, recoveryId, expiresAt);
  // 2.7.0: the times are the earliest possible until the enclave's slot says (`earliest`).
  const r: RecoveryRow = {
    recovery_id: recoveryId, state: 'pending', requested_at: now, available_at: availableAt, expires_at: expiresAt, locator, earliest: true, cancel_key: link.key,
    ...(scale !== 1 ? { time_scale: scale } : {}),
  };
  await setRecovery(v, r, v.recovery?.recovery_id ?? null, true);
  // The slot keeps the sealed code until the recovery expires.
  await enqueue('recovery', m, v, recoveryId, inst, undefined, { extra: { browser_key: bk as string, ...sig }, ttlS: r.expires_at - now + 3600 });
  await audit(memberActor(m.user_guid), 'vault.recovery_request', m.user_guid, { vault_id: v.vault_id, recovery_id: recoveryId, instance_id: inst.instance_id });
  await notify(m.email, 'VettID vault recovery requested', scaledMail(requestedMail(cancelUrlOf(link.token), r.available_at), scale));
  return new WithStatus(202, { recovery_id: recoveryId, available_at: iso(r.available_at), expires_at: iso(r.expires_at), earliest: true });
});

/** After this long an unfinished release (its audit write failed, or the function died) may be tried again. */
export const RELEASE_RETRY_S = 60;

/**
 * Whether the recovery code may be returned now: only when its release is on
 * record. The slot's `released` is set after `vault.recovery_code_released`
 * has been written, never before, so a failed audit write leaves the code
 * unreleased (the request fails; a later one tries again). Of the requests
 * that find it unreleased, the one that takes the slot's `releasing` mark
 * (conditional) writes the event; the others answer without the code unless
 * the release has been recorded meanwhile (the page asks again). The event is
 * written once, except when a release fails after its audit write and before
 * `released` is set: the next attempt then writes it again, which errs on
 * the side of the record.
 */
async function codeReleased(m: MemberItem, v: VaultRow, r: RecoveryRow, slot: Record<string, unknown>, now: number): Promise<boolean> {
  if (slot.released === true) return true;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaultRequests(),
        Key: { request_id: r.recovery_id },
        UpdateExpression: 'SET releasing = :now',
        ConditionExpression: 'attribute_exists(request_id) AND attribute_not_exists(released) AND (attribute_not_exists(releasing) OR releasing < :stale)',
        ExpressionAttributeValues: { ':now': now, ':stale': now - RELEASE_RETRY_S },
      }),
    );
  } catch (e) {
    if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
    // Another request is releasing it, or has: the code only if that is recorded.
    return (await recoverySlot(m, r))?.released === true;
  }
  await audit(memberActor(m.user_guid), 'vault.recovery_code_released', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id });
  await ddb.send(
    new UpdateCommand({
      TableName: table.vaultRequests(),
      Key: { request_id: r.recovery_id },
      UpdateExpression: 'SET released = :t',
      ExpressionAttributeValues: { ':t': true },
    }),
  );
  return true;
}

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
  // 2.4.1: when the API recorded that the new app took the vault over.
  if (state === 'completed' && typeof r.completed_at === 'number') out.completed_at = iso(r.completed_at);
  // 2.9.0: how a cancel recorded from 2.9.0 was made (`app`: an owner app's unlock).
  if (state === 'cancelled' && typeof r.cancelled_via === 'string' && CANCEL_VIAS.has(r.cancelled_via)) out.cancelled_via = r.cancelled_via;
  // 2.7.0: available_at is still an estimate ("at the earliest").
  if (r.earliest === true && (state === 'pending' || state === 'available')) out.earliest = true;
  // 2.7.0: why the enclave refused it (`not_offered`: the release does not offer recovery).
  if (state === 'unavailable' && typeof r.reason === 'string' && RECOVERY_REASONS.has(r.reason)) out.reason = r.reason;
  // The code from available_at; a refusal (2.1.0, `unavailable`) at once.
  if (state === 'available' || state === 'unavailable') {
    const slot = await recoverySlot(m, r);
    const env = slot && slot.status === 'done' && typeof slot.envelope === 'string' ? decodeCanonicalB64(slot.envelope) : null;
    // A code is returned only once its release is on record (a refusal has no release).
    if (env && env.length === RESULT_ENVELOPE_BYTES && (state === 'unavailable' || (await codeReleased(m, v, r, slot!, now)))) {
      out.sealed_code = slot!.envelope;
      // 2.4.0: the locator only together with a code's sealed_code, never with a refusal's.
      if (state === 'available' && typeof r.locator === 'string' && LOCATOR_RE.test(r.locator)) out.locator = r.locator;
    }
  }
  return { recovery: out };
});

router.on('POST', '/api/vault/recovery/cancel', async (req) => {
  // Whatever the account state, as for lock ("member gate" above): a cancel only keeps the vault as it is.
  const m = await loadAccountHolder(req);
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
// QR's vault_id and recovery_id with its own app key (§11.11.7), or (2.4.0,
// §11.11.10) the typed form's locator, which stands for that pair.
router.on('POST', '/api/vault/recovery/claim', async (req) => {
  const typed = 'locator' in req.body;
  // Signed by the key it registers, with `vault=` the QR's vault; empty with a locator.
  const { h, key } = await newKeyCaller(req, (x) => (typed ? x.vault === '' : x.vault !== ''));
  // Paused: refused before the body is read and before any lookup.
  await requireService();
  if (typed) return claimByLocator(req, key);
  const vaultId = field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex');
  const recoveryId = field(req.body, 'recovery_id', ULID_RE, 'a ULID');
  if (vaultId !== h.vault) throw badRequest('vault_id must be the vault the request is signed for');
  // The per-network limit first (hits and misses alike), then the lookup;
  // the vault's daily allowance is charged only to a pair that names the
  // vault's recovery, as in the typed form. Otherwise anyone who knows a
  // vault_id could spend the allowance of a recovery they cannot claim.
  await limit(`vault-recovery-claim-net#${req.ip}`, 10, 15 * 60);
  if (!(await scannedPair(vaultId, recoveryId))) throw notFound('No such recovery');
  await limit(`vault-recovery-claim#${vaultId}`, 10, 86_400);
  return claimRecovery(key, vaultId, recoveryId, 'qr');
});

/**
 * Whether the scanned pair names a vault's recovery: the vault exists, is not
 * deleted, its recovery has that id and its member's pointer names it. Every
 * call does the same two consistent reads (the vault row and a pointer row,
 * one that cannot exist when there is no vault) and writes nothing, so timing
 * does not tell an unknown vault from a known vault with another recovery.
 * A recovery in any state is a hit here (a cancelled or expired one gets its
 * 409 from the claim, as before).
 */
async function scannedPair(vaultId: string, recoveryId: string): Promise<boolean> {
  const v = await vaultRow(vaultId);
  const pointer = await readPointer(v && typeof v.user_guid === 'string' ? v.user_guid : NO_USER_GUID);
  return !!v && v.state !== 'deleted' && v.recovery?.recovery_id === recoveryId && pointer?.current_vault_id === v.vault_id;
}

/**
 * The typed form (2.4.0): the body's syntax, the per-network limit (the
 * scanned form's bucket; hits and misses alike), the lookup, and on a hit
 * the scanned form's per-vault limit and code. A miss is the unknown pair's
 * 404, writes nothing to any recovery and is charged to none.
 */
async function claimByLocator(req: MemberRequest, key: AppKey) {
  if ('vault_id' in req.body || 'recovery_id' in req.body) throw badRequest('Send exactly one of {vault_id, recovery_id, app_key} or {locator, app_key}');
  const locator = field(req.body, 'locator', LOCATOR_RE, '12 characters of 0-9A-HJKMNP-TV-Z');
  await limit(`vault-recovery-claim-net#${req.ip}`, 10, 15 * 60);
  const pair = await locatorPair(locator, nowS());
  if (!pair) {
    await auditLocatorMiss(req);
    throw notFound('No such recovery');
  }
  await limit(`vault-recovery-claim#${pair.vault_id}`, 10, 86_400);
  return claimRecovery(key, pair.vault_id, pair.recovery_id, 'typed');
}

/** The claim of the pair (`vault_id`, `recovery_id`), however the app read it. */
async function claimRecovery(key: AppKey, vaultId: string, recoveryId: string, via: 'qr' | 'typed') {
  const now = nowS();
  const v = await vaultRow(vaultId);
  const r = v?.recovery;
  if (!v || v.state === 'deleted' || !r || r.recovery_id !== recoveryId) throw notFound('No such recovery');
  const m = await memberByGuid(v.user_guid);
  const pointer = m ? await readPointer(m.user_guid) : null;
  if (!m || pointer?.current_vault_id !== v.vault_id) throw notFound('No such recovery');
  requireActive(m);
  // 2.1.0: a recovery the enclave refused is `unavailable`, never claimable.
  if (recoveryState(await refreshPending(m, v, r, now), now) !== 'available') throw vaultError(409, 'recovery_not_available', 'No recovery code is valid now');
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
  await audit(memberActor(m.user_guid), 'vault.recovery_claim', m.user_guid, { vault_id: v.vault_id, recovery_id: r.recovery_id, kid: key.kid, via });
  // 2.4.0: the two identifiers, which the typed app has from nowhere else.
  return { user_guid: m.user_guid, email_hint: emailHint(m.email), vault_id: v.vault_id, recovery_id: r.recovery_id };
}

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
  const rec = vault.recovery ? await refreshPending(m, vault, vault.recovery, now) : undefined;
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
  await audit(memberActor(m.user_guid), 'vault.recovery_register', m.user_guid, { vault_id: vault.vault_id, request_id: requestId, recovery_id: recoveryId, instance_id: instanceId, ...viaOf(c) });
  return new WithStatus(202, { vault_id: vault.vault_id, request_id: requestId });
});

/** Remember an open request on its recovery (best effort: the app's poll notices its attempt anyway). */
async function recordOpenId(v: VaultRow, r: RecoveryRow, requestId: string): Promise<void> {
  const ids = [...(r.open_ids ?? []), requestId].slice(-MAX_OPEN_IDS);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.vaults(),
        Key: { vault_id: v.vault_id },
        UpdateExpression: 'SET recovery.open_ids = :ids, updated_at = :now',
        ConditionExpression: 'recovery.recovery_id = :id',
        ExpressionAttributeValues: { ':ids': ids, ':id': r.recovery_id, ':now': nowIso() },
      }),
    );
  } catch (e) {
    console.error('open id not recorded', JSON.stringify({ vault_id: v.vault_id, error: (e as Error).name }));
  }
}

/**
 * 2.7.0 (release R; VAULT-MESSAGING §11.14.6, MEMBER-API "Recovery from
 * release R"): the registered phone opens the recovery with the PIN, the
 * password and its phone secret, sealed to the instance's ETK. Signed by the
 * recovery's recovering key only; forwarded only while the recovery is
 * `registered` and before its `expires_at`, as the queue op `recovery_open`
 * with that key as `app_key`, to the leaseholder or (nobody holding the
 * lease) a live instance of the vault's sealed release, which the phone got
 * from GET /api/vault/enclave (preferring one with `heavy_kdf_free`). The
 * limits save work; the bound on guessing is the vault's attempt counter.
 * The API never reads the outcome; a counted attempt comes back as the
 * slot's `recovery_attempt` (noticeAttempt).
 */
router.on('POST', '/api/vault/recovery/open', async (req) => {
  // No session path: a registered phone has an app key and nothing else.
  if (req.appHeader === undefined) throw unauthorized();
  const c = await appCaller(req, ['recovering']);
  const m = c.m;
  requireActive(m);
  await requireService();
  const vaultId = field(req.body, 'vault_id', VAULT_ID_RE, '32 lowercase hex');
  const requestId = field(req.body, 'request_id', ULID_RE, 'a ULID');
  const instanceId = field(req.body, 'instance_id', INSTANCE_ID_RE, 'an instance id');
  const etkKid = field(req.body, 'etk_kid', KID_RE, '16 lowercase hex');
  // vault.recovery.open is padded to 12,288 bytes, as an unlock (§5.4, §11.14.6).
  const envelope = checkEnvelope(req.body.envelope, ENVELOPE_BYTES_LARGE, etkKid);
  // The enclave's queue parser requires it for this op (as for an unlock): the host hands it that manifest.
  const manifestSha256 = field(req.body, 'manifest_sha256', SHA256_RE, '64 lowercase hex');
  const vault = c.vault;
  if (vault.vault_id !== vaultId) throw notFound('No such vault');
  await limit(`vault-recovery-open-net#${req.ip}`, OPEN_LIMIT_PER_NETWORK, 15 * 60);
  const now = nowS();
  const r = vault.recovery;
  if (!r || r.state !== 'registered' || !recoveryActive(r, now) || !isStoredKey(r.recovering_key) || r.recovering_key.kid !== c.key.kid) {
    throw vaultError(409, 'recovery_not_available', 'This recovery cannot be opened now');
  }
  await limit(`vault-recovery-open#${r.recovery_id}`, OPEN_LIMIT_PER_RECOVERY, 86_400);
  const inst = await routeCheck(vault, instanceId, now);
  await requireRoutable(inst, isCanaryMember(m));
  // Only the vault's own release can open its header.
  if (vault.sealed_release && inst.release !== vault.sealed_release) throw instanceMoved();
  // Every earlier counted attempt is noticed (mailed, audited) before
  // another open goes out, whether or not the phone ever polled it. Fail
  // safe: while one cannot be recorded as noticed (its mail keeps failing,
  // or another caller is noticing it right now), no further open is
  // forwarded, until it is noticed or given up (ATTEMPT_MAX_TRIES).
  const { r: cur, unnoticed } = await noticeOpenSlots(m, vault, r);
  if (unnoticed > 0) {
    throw vaultError(503, 'attempt_notice_pending', 'An earlier attempt has not been reported to you by email yet. Try again in a few minutes.', { retry_after: ATTEMPT_RETRY_S });
  }
  // The slot lives as long as the recovery (plus an hour), not 15 minutes,
  // so a counted attempt can still be noticed by the sweep however late.
  await enqueue('recovery_open', m, vault, requestId, inst, { etk_kid: etkKid, envelope, manifest_sha256: manifestSha256 }, {
    extra: { app_key: c.key.key },
    slot: { recovery_id: r.recovery_id, ...slotOf(c) },
    ttlS: Math.max(REQUEST_TTL_S, cur.expires_at + 3600 - now),
  });
  await recordOpenId(vault, cur, requestId);
  // Never the outcome, which the API cannot read.
  await audit(memberActor(m.user_guid), 'vault.recovery_open', m.user_guid, { vault_id: vault.vault_id, recovery_id: r.recovery_id, request_id: requestId, instance_id: instanceId });
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

/**
 * The start-over runs 24 h after the request (§11.11.9); on staging the
 * 24 h are divided by the time scale when the request is made (S14,
 * MEMBER-API 2.8.0 "Staging time scale").
 */
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
  await audit(memberActor(m.user_guid), 'vault.deletion_cancel', m.user_guid, { vault_id: v.vault_id, deletion_id: deletionId, via, ...(kid ? { kid } : {}) });
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
  const v = await completeRecovery(m, await recoverableVault(m.user_guid));
  if (recoveryActive(v.recovery, now)) throw vaultError(409, 'recovery_active', 'A recovery is in progress; cancel it first');
  if (deletionOf(v)) throw deletionPending();
  const d: DeletionRow = { deletion_id: newUlid(), state: 'pending', requested_at: now, deletes_at: now + scaledSeconds(DELETION_DELAY_S) };
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
  await audit(memberActor(m.user_guid), 'vault.deletion_request', m.user_guid, { vault_id: v.vault_id, deletion_id: d.deletion_id, deletes_at: iso(d.deletes_at) });
  await notify(m.email, 'VettID: your vault will be deleted',
    scaledMail(deletionRequestedMail(`https://${env('ACCOUNT_HOST')}/vault/deletion/cancel#t=${token}`, d.requested_at, d.deletes_at)));
  return new WithStatus(202, { deletion_id: d.deletion_id, requested_at: iso(d.requested_at), deletes_at: iso(d.deletes_at) });
});

router.on('GET', '/api/vault/deletion', async (req) => {
  const m = await loadActiveAccount(req);
  await limit(`vault-deletion-status#${m.user_guid}`, 60, 60);
  const d = deletionOf(activeVault((await currentVault(m.user_guid)).vault));
  return { deletion: d ? deletionBody(d) : null };
});

// The portal's session, or the vault's app signed by its app key (§11.11.9).
// Whatever the account state, as for lock ("member gate" above): a
// suspended or canceled account can still stop its vault's deletion.
router.on('POST', '/api/vault/deletion/cancel', async (req) => {
  const c: Caller = req.appHeader !== undefined
    ? await appCaller(req, ['app'])
    : { via: 'session', m: await loadAccountHolder(req), vault: null, key: null, role: null };
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
