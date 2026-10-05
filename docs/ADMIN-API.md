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
  `internal`.
- **Pagination:** list endpoints take `?cursor=` and return
  `{ "items": [...], "cursor": "<opaque>" | null }`. Default page size 50.
- **Audit:** every mutating call writes an audit event (actor = caller email).

## Types

```ts
type State = 'requested' | 'registered' | 'member' | 'rejected';
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
| POST | `/admin/requests/{user_guid}/approve` | — | `Member` (now `registered`; Cognito user created). `409` until the address has completed SES verification (checked live). |
| POST | `/admin/requests/{user_guid}/reject` | `{reason?: string}` | `Member` (now `rejected`) |
| POST | `/admin/requests/{user_guid}/resend-verification` | — | `{ok: true}` |
| GET | `/admin/members?state=&status=&q=` | — | `{items: Member[], cursor}`. `state` ∈ registered/member (default both); `status` ∈ active/suspended/canceled; `q` = email prefix |
| GET | `/admin/members/{user_guid}` | — | `Member` |
| POST | `/admin/members/{user_guid}/suspend` | `{reason: string}` | `Member` |
| POST | `/admin/members/{user_guid}/reinstate` | — | `Member` |
| DELETE | `/admin/members/{user_guid}` | — | `{ok: true}` (permanent; Cognito user + data removed, audit kept) |
| POST | `/admin/members/{user_guid}/clear-pin` | — | `Member` — removes the PIN and its lockout; the member is emailed a notice. Audited. |
| POST | `/admin/members/{user_guid}/subscription/extend` | `{days: number}` (1–366) | `Member` |
| GET | `/admin/invites` | — | `{items: Invite[], cursor}` (registration codes) |
| POST | `/admin/invites` | `{max_uses: number (1–1000), expires_in_days: number (1–365), note?: string}` | `Invite`. The admin site's form defaults `max_uses` to 2. |
| POST | `/admin/invites/{code}/expire` | — | `Invite` |
| DELETE | `/admin/invites/{code}` | — | `{ok: true}` |

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
and register) answer `503 vault_unavailable`; status, polling, lock, the
recovery status and cancels keep working. No vault, key, manifest or
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
| GET | `/admin/audit?month=YYYY-MM&actor=&subject=` | — | `{items: AuditEvent[], cursor}` newest first; `actor` / `subject` filter (exact) instead of month |

```ts
interface Admin {
  email: string; enabled: boolean;
  status: string;                  // Cognito status, e.g. CONFIRMED, FORCE_CHANGE_PASSWORD
  created_at: string;
}
interface AuditEvent {
  ts: string; actor: string; action: string; subject: string;
  detail: Record<string, unknown>;
}
```
