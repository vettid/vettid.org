---
title: ADMIN-API
status: v1 (Phase 1b)
related: ACCOUNT-ADMIN-PLAN.md (§5.1 lifecycle, §6 admin)
---

# Admin API (v1)

Base URL: `https://admin-api.vettid.org` (REST API; the default execute-api
endpoint is disabled). Reachable **only** from the admin exit node's egress IP
(resource policy) — plus a Cognito admin-pool authorizer on every route.

## Conventions

- **Auth:** `Authorization: Bearer <id_token>` from the admin pool (hosted UI,
  code + PKCE). The caller must be in the `admin` group, and is re-checked
  as still **enabled** in Cognito on every request (cached 60 s), else `403`.
- **CORS:** origin `https://admin.vettid.org` only; headers `Authorization`,
  `Content-Type`.
- **Bodies:** JSON in, JSON out. Times are ISO-8601 UTC strings.
- **Errors:** non-2xx with `{ "error": "<code>", "message": "<human text>" }`.
  Codes: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`,
  `internal`, `recovery_active` (`409`, from `reinstate` only, with a
  `recoveries` list beside the two members), and `vault_exists` (`409`,
  from `DELETE /admin/members/{user_guid}` only, with a `vaults` list
  beside the two members; MEMBER-API 2.6.5).
- **Pagination:** list endpoints take `?cursor=` and return
  `{ "items": [...], "cursor": "<opaque>" | null }`. Default page size 50.
- **Audit:** every mutating call writes an audit event (actor = caller email).
  The address of the person acted on is not in the event: it is in a
  record beside it that is deleted after 90 days (MEMBER-API 2.6.0
  "Retention"; `AuditEvent.email` below).

## Types

```ts
type State = 'requested' | 'registered' | 'member' | 'rejected'
  | 'withdrawn';   // MEMBER-API 2.6.0: withdrawn by the person; no names; gone within 15 minutes; in no list
type AccountStatus = 'active' | 'suspended' | 'canceled';

interface Member {
  user_guid: string;
  email: string;
  first_name: string;
  last_name: string;
  state: State;
  account_status: AccountStatus;
  email_verified: boolean;        // SES verification (sandbox opt-in) complete
  invite_code: string | null;     // registration code used on the request, if any
  created_at: string;
  updated_at: string;
  terms_version: string | null;   // accepted terms version, if any
  pin_enabled: boolean;
  subscription: Subscription | null;
  voting_rights: boolean;         // member + active paid subscription (governance voting is upcoming)
  vault_canary: boolean;          // vault canary tester (see "Vault canary"); never shown to the member
}

interface Subscription {
  type_id: string;
  type_name: string;
  status: 'trial' | 'active' | 'expired' | 'canceled';
  paid: boolean;
  started_at: string;
  expires_at: string;
}
```

## People

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/requests` | — | `{items: Member[], cursor}` — state `requested`, oldest first |
| POST | `/admin/requests/{user_guid}/approve` | — | `Member` (now `registered`; Cognito user created). `409` until the address has completed SES verification (checked live; a flag that lagged is set in the same write as the state, so the person gets "Your VettID account is ready" and not the request email just before it). `409` too, with nothing changed, if Cognito already holds a user for the address under another `user_guid` (left by an earlier request's removal that was given up on, audit `request.removal_incomplete`): an operator removes that user first (RUNBOOK "Membership requests", "Removal by hand"). A user that carries this request's own `user_guid` (an approval that stopped half-way) is reused. |
| POST | `/admin/requests/{user_guid}/reject` | `{reason?: string}` | `Member` (now `rejected`). The declined request, with the reason, is deleted automatically 30 days later (MEMBER-API 2.6.0 "Retention"); the person is not told. |
| POST | `/admin/requests/{user_guid}/resend-verification` | — | `{ok: true}`. `409` for a `withdrawn` request. |
| GET | `/admin/members?state=&status=&q=` | — | `{items: Member[], cursor}`. `state` ∈ registered/member (default both); `status` ∈ active/suspended/canceled; `q` = email prefix |
| GET | `/admin/members/{user_guid}` | — | `Member` |
| POST | `/admin/members/{user_guid}/suspend` | `{reason: string}` | `Member`. The status is written first, then sign-in is disabled and the sessions are ended: from the status write on the account cannot sign in and none of its pending vault deletions is carried out. If a later step fails the answer is `500` with the account already suspended and no `member.suspend` event: the suspension is half done (sign-in may not be disabled, the sessions may not be ended; such a session reaches only `lock` and the two vault cancels), and repeating the call finishes it. For an account that is already suspended the call answers `200` (MEMBER-API 2.6.2; it answered `409` before), repeats the two sign-in steps, writes `member.suspend` with `repeat: true` in its detail and the reason given now, and leaves the stored reason as it is. `409` for a canceled account. |
| POST | `/admin/members/{user_guid}/reinstate` | `{allow_active_recovery?: boolean}` | `Member`. In this order: (1) a vault deletion of the member that is still pending is cancelled (MEMBER-API "Vault deletion: start over"; the member is emailed; audited `member.vault_deletion_cancel` with `on: "reinstate"`), so that a deletion which waited through the suspension is not carried out when the account is active again; (2) if a recovery of the member's vault is still active (pending, available or registered, before its `expires_at`), the answer is `409 recovery_active` with `recoveries: [{vault_id, recovery_id, state, available_at, expires_at}]` and the account stays as it is, unless the body says `allow_active_recovery: true`; the recovery is not cancelled either way, and with the confirmation the event `member.reinstate_with_active_recovery` is written at this point, before sign-in is enabled; (3) the member's sessions are ended (a suspension whose sign-out failed must not hand an old session back), sign-in is enabled, and the status is written last; then `member.reinstate` is written and the vault gets its account snapshot. Step 1 is made before step 2 answers, so a `409 recovery_active` means a pending deletion has already been cancelled. `409` also if the deletion changed while it was being cancelled (repeat the call). `500` has two meanings, told apart by the member's `account_status`: if a step up to and including the status write failed (the cancel could not be made, or was made and could not be recorded; ending the sessions; enabling sign-in), the account is still not active, a pending deletion may already have been cancelled, and a repeat finishes; if the step after the status write failed (the `member.reinstate` event), the account is active, and a repeat answers `409` "already active"; a snapshot that could not be requested is logged and does not fail the call. The recovery shown can be one that has just completed in the vault and is not yet recorded as completed (`registered`): the warning is then a false alarm. |
| DELETE | `/admin/members/{user_guid}` | — | `{ok: true}` (permanent; Cognito user + data removed, audit kept). Refused while the member has a vault that is not deleted (MEMBER-API 2.6.5): `409 vault_exists` with `vaults: [{vault_id, state}]` and a message that says why and what to do (the vault goes when the member deletes it, in the app or by "Delete my vault and start over", or with the account 7 days after the member cancels it; delete the member after that); nothing is changed and nothing is audited. A vault whose deletion was asked for and not yet reported still counts. The check is made first, through the member API's member-vaults function; if it cannot be made the answer is `500` and nothing is changed. `{ok: true}` means this call deleted the row: if the row was removed by something else after the call read it (the cleanup job, another admin), the answer is `404` `No such member`, as for an unknown id, and no `member.delete` is audited. The Cognito user and the `email:<addr>` marker go only if they are this member's own (`custom:user_guid`, `member_guid`); ones that belong to a newer request or account for the same address are left, and the `member.delete` audit event then says so in its detail (`sign_in_user: "left"`, `email_marker: "left"`); the answer is the same (MEMBER-API 2.6.2 "Retention"). |
| POST | `/admin/members/{user_guid}/clear-pin` | — | `Member` — removes the PIN and its lockout; the member is emailed a notice. Audited. |
| POST | `/admin/members/{user_guid}/vault/deletion/cancel` | — | `{cancelled: boolean}`. Cancels the member's pending "Delete my vault and start over" (MEMBER-API "Vault deletion: start over"), whatever the account status: `true` when a pending deletion was removed (the member is emailed; audited `member.vault_deletion_cancel`, detail `vault_id`, `deletion_id`); `false` when there was none, so a repeat is harmless. `409` when the deletion is already being carried out (`executing`, also when its `delete` has not been queued yet: it cannot be cancelled), when it changed while it was being cancelled (repeat the call), or when the row is not an account; `404` for an unknown member. `500` if the cancel could not be made, or was made and its audit event could not be written (a repeat then answers `false`). A pending recovery has no admin cancel. |
| POST | `/admin/members/{user_guid}/subscription/extend` | `{days: number}` (1–366) | `Member` |
| GET | `/admin/invites` | — | `{items: Invite[], cursor}` (registration codes) |
| POST | `/admin/invites` | `{max_uses: number (1–1000), expires_in_days: number (1–365), note?: string}` | `Invite`. The admin site's form defaults `max_uses` to 2. |
| POST | `/admin/invites/{code}/expire` | — | `Invite` |
| DELETE | `/admin/invites/{code}` | — | `{ok: true}` |

**A pending vault deletion, a recovery, and the account's status
(MEMBER-API 2.6.2).** A
member's "Delete my vault and start over" is carried out 24 hours after
the request only while the account is active. Suspending an account
does not cancel it but stops it from being carried out, from the
moment the status is written; reinstating the account cancels it. A
recovery is blocked while the account is not active, but its times do
not move, and no admin route cancels it: `reinstate` warns about an
active one and asks for a confirmation. Support's order when an account
looks taken over is: suspend, cancel the vault deletion, reinstate when
the member has their mailbox back (RUNBOOK "No recovery with the backup
off; start over"). The people function has no right on the vault
tables. It invokes three functions of the member API: the account push
(the member's running vault gets its account snapshot), as before;
the start-over cancel, which removes a pending deletion record and
reports an active recovery and does nothing else; and (MEMBER-API
2.6.5) the member-vaults check, which lists the member's vaults that
are not deleted, for Delete, under a role of its own that may only
Query the vaults table and its `user-index`.

**Registration codes.** Members and the admin site call these
*registration codes* (formerly "invite codes"); each is good for 2 uses by
default. The routes (`/admin/invites`), the `Invite` type, the
`invite_code` field and the audit actions (`invite.create`,
`invite.expire`, `invite.delete`) keep their names for compatibility.

```ts
interface Invite {
  code: string; note: string; max_uses: number; uses: number;
  status: 'active' | 'expired' | 'exhausted';
  expires_at: string; created_at: string; created_by: string;
}
```

## Vault canary

Canary testers are members routed to `canary` vault releases: builds under
test that are not published yet (VAULT-RELEASES §10.1 step 9, §11.3;
MEMBER-API "Canary releases"). The flag is `vault_canary: true` on the
member row. Served by its own Lambda, whose role may update a member row
only in `vault_canary` and `updated_at` (IAM `dynamodb:Attributes`, no
`ALL_NEW`/`ALL_OLD` return values) and holds no Cognito member-pool rights.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/vault-canary` | — | `{items: CanaryMember[], cursor}` — flagged members (a filtered scan; a page may hold fewer than 50 with a non-null cursor) |
| GET | `/admin/vault-canary/{user_guid}` | — | `CanaryMember` |
| POST | `/admin/vault-canary/{user_guid}` | — | `CanaryMember` — sets the flag. `409` unless state `member`, or if already set; `404` for an unknown member. Audited `member.vault_canary.set`. |
| DELETE | `/admin/vault-canary/{user_guid}` | — | `CanaryMember` — clears the flag, in any state. `409` if not set; `404` for an unknown member. Audited `member.vault_canary.clear`. |

```ts
interface CanaryMember {
  user_guid: string; email: string; first_name: string; last_name: string;
  state: State; account_status: AccountStatus;
  vault_canary: boolean;
  eligible: boolean;               // state === 'member' (the flag may be set)
}
```

Clearing the flag of a member whose vault is sealed to a canary release
makes that vault unreachable (`410 release_unavailable`) until the
release is published. The admin site shows the switch on each member's
row (Members) with a confirmation, and lists testers below the members.

## Vault service

The operator's pause of the member API's vault routes (MEMBER-API "Vault
service pause"; owner decision 2026-10-05): while paused, the routes that
start or change vault activity (enclave, enroll, unlock, recovery request
and register; since MEMBER-API 2.0.0 also setup-code issue, redeem and
recovery claim) answer `503 vault_unavailable`; status, polling, lock, the
recovery status and cancels, and reading or revoking a setup code keep
working. No vault, key, manifest or
release row is touched. The state is the SSM parameter
`/vettid-org/<stage>/switch/vault-service` in the member API's account
(no parameter: on). Served by its own Lambda, whose role may only get
and put that one parameter (and write the audit table).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/vault-service` | — | `VaultService` |
| POST | `/admin/vault-service/pause` | `{reason: string}` (1–500 chars, required) | `VaultService` (paused). `409` if already paused. Audited `vault.service.pause` (`reason`). |
| POST | `/admin/vault-service/resume` | — | `VaultService` (on). `409` if not paused. Audited `vault.service.resume` (`paused_reason`, `paused_by`, `paused_at`: what the pause was). |

```ts
interface VaultService {
  enabled: boolean;               // false: paused
  reason: string | null;          // the operator's note; never shown to members
  set_by: string | null;          // admin email, or whoever wrote it from the CLI
  set_at: string | null;          // ISO-8601; null when never set
}
```

A change takes effect in the member API within about 30 s (its cache).
Every write to the parameter, from here or the CLI, emails the security
alerts; production also alarms while paused (RUNBOOK "Pausing the vault
service"). The admin site shows the state and the switch on its **Vault
service** page, each change behind a confirmation (pausing asks for the
reason).

## Content

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/terms` | — | `{items: Terms[], cursor}` newest first |
| POST | `/admin/terms` | `{title: string, text: string}` (≤ 200,000 chars) | `Terms` (draft). The text is normalized (line endings, trailing spaces, runs of blank lines) and stored; a PDF is generated from it. `400` lists any characters the PDF font can't render |
| POST | `/admin/terms/{version_id}/publish` | — | `Terms` (becomes `current`; previous current → `superseded`) |
| DELETE | `/admin/terms/{version_id}` | — | `{ok: true}` — drafts only |
| GET | `/admin/terms/{version_id}/download-url` | — | `{url: string}` to the generated PDF (5 min) |
| GET | `/admin/subscription-types` | — | `{items: SubscriptionType[], cursor}` |
| POST | `/admin/subscription-types` | `{name, description, duration_days (1–3660), is_trial: boolean, paid: boolean}` | `SubscriptionType` |
| POST | `/admin/subscription-types/{type_id}/enable` | — | `SubscriptionType` |
| POST | `/admin/subscription-types/{type_id}/disable` | — | `SubscriptionType` |

```ts
interface Terms {
  version_id: string; title: string;
  status: 'draft' | 'current' | 'superseded';
  sha256: string;                  // of the normalized text — what members accept
  pdf_sha256: string;              // of the generated PDF
  chars: number;
  created_at: string; created_by: string;
  published_at: string | null; published_by: string | null;
}
interface SubscriptionType {
  type_id: string; name: string; description: string;
  duration_days: number; is_trial: boolean; paid: boolean; enabled: boolean;
  created_at: string;
}
```

Terms are authored as plain text (paragraphs separated by blank lines); the
server renders the PDF. The browser never talks to S3 except to open a
presigned download link.

## System

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/admin/me` | — | `{email: string}` |
| GET | `/admin/admins` | — | `{items: Admin[], cursor}` |
| POST | `/admin/admins` | `{email}` | `{status: 'verification_sent' \| 'created', admin?: Admin}` — SES sandbox: first call sends SES verification; call again after the recipient clicks it |
| POST | `/admin/admins/{email}/disable` | — | `Admin` (not self) |
| POST | `/admin/admins/{email}/enable` | — | `Admin` |
| DELETE | `/admin/admins/{email}` | — | `{ok: true}` (not self) |
| GET | `/admin/audit?month=YYYY-MM&actor=&subject=` | — | `{items: AuditEvent[], cursor}` newest first; `actor` / `subject` filter (exact) instead of month. A person's events are found by `subject` (their `user_guid`), not by their address. Events written before MEMBER-API 2.6.0 still carry `detail.email` and a member's address as `actor` until the backfill has run (RUNBOOK "Membership requests"). |

```ts
interface Admin {
  email: string; enabled: boolean;
  status: string;                  // Cognito status, e.g. CONFIRMED, FORCE_CHANGE_PASSWORD
  created_at: string;
}
interface AuditEvent {
  ts: string;
  actor: string;                   // an admin's email, `member:<user_guid>` (a member's own action), `public`, `app` or `system`
  action: string; subject: string;
  detail: Record<string, unknown>;
  email?: string;                  // the address of the person the event is about, at the time; present for 90 days after the event, then gone (MEMBER-API 2.6.0 "Retention")
}
```
