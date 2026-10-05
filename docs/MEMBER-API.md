---
title: MEMBER-API
status: v1 (Phase 2)
version: 1.1.0
changelog:
  - 1.1.0 (2026-10-05, VAULT-MESSAGING 0.10.6): `VaultStatus` documents
    `recovery`; `state` reads `unlocked` only under a live lease;
    `Recovery` gains `vault_id` and the state `registered` (no
    `sealed_code` after it); both recovery cancel routes answer
    `{cancelled}`. Additive: v1 clients that ignore unknown fields and
    treat an unknown recovery state as ended keep working
  - 1.0.0: v1 as first published (Phase 2), with the vault routes added
    since (no version was recorded before 1.1.0)
related: ACCOUNT-ADMIN-PLAN.md (§5 member account site), ADMIN-API.md
---

# Member API (v1)

Served **same-origin** under `https://account.vettid.org/api/*` (CloudFront
forwards `/api/*` to an HTTP API). No CORS anywhere.

## Session model

- The browser never sees a token. Sign-in sets **httpOnly, Secure,
  SameSite=Strict, host-only** cookies:
  - `vid_id` — Cognito ID token (Path `/api`, ~60 min)
  - `vid_rt` — refresh token (Path `/api`, 30 days)
  - `vid_pin` — pending PIN step (Path `/api/auth`, 5 min, only mid sign-in)
- Every **state-changing** request (`POST`/`DELETE`) must send header
  `X-VettID-CSRF: 1` (a custom header cross-site forms can't send; belt and
  braces with SameSite=Strict). Missing → `403 csrf`.
- An expired `vid_id` is renewed **server-side, in the same request**, from
  `vid_rt` (a fresh `vid_id` comes back in `Set-Cookie`), so normal use never
  sees a 401. If a call still returns `401` (refresh token expired or
  revoked), the client may try `POST /api/auth/refresh` once, then signs the
  user out (send them to `/signin/`).

## Conventions

JSON in/out. Errors: non-2xx with `{ "error": "<code>", "message": "<text>" }`.
Codes: `bad_request`, `unauthorized`, `forbidden`, `csrf`, `not_found`,
`conflict`, `rate_limited` (with `retry_after` seconds), `internal`.
Responses are `Cache-Control: no-store`.

## Public

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/public/request` | `{email, first_name, last_name, invite_code?: string, consent: true}` | `{outcome}` (below). `invite_code` is the optional **registration code** (field name kept for compatibility). Names: letters, spaces, `'’.-`, ≤ 40 chars. Global hourly cap (past it: same answer, nothing created). Requests never email-verified are deleted after 14 days. |

`consent` must be `true`: while SES is in sandbox, we can only email
addresses that have verified with SES, and that verification **is** the
email opt-in. Every new request triggers an SES verification email
("Amazon Web Services – Email Address Verification Request") which the
applicant must click before we can send them anything (including sign-in
links).

`outcome`:
- `"pending_approval"` — no code (or code invalid/expired/used up): an admin
  will review. *The response does not say whether a code was rejected* —
  invalid codes silently fall back to review.
- `"registered"` — valid code: the account exists; they can sign in once the
  SES verification is clicked.

Duplicate requests for an address that already exists return
`"pending_approval"` (no existence oracle). Rate-limited per IP.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/start` | `{email}` | `{ok: true}` always, answered **before** any account lookup (no existence oracle, by content or timing). A separate mailer then emails a link if the address belongs to an active account with a verified email: `https://account.vettid.org/auth/#t=<token>&e=<email>` (valid 15 min, single use). Rate-limited per IPv4 address / IPv6 /64, per (address, network), per address (5 sent/hour) and globally. |
| POST | `/api/auth/verify` | `{email, token}` | `{status: "signed_in"}` (cookies set) or `{status: "pin_required"}` (`vid_pin` set). `401 unauthorized` for a bad/expired/used link. |
| POST | `/api/auth/pin` | `{pin}` | `{status: "signed_in"}` or `401` (`message` says attempts left / locked). Requires a valid (HMAC-signed) `vid_pin`; rate-limited per network. |
| POST | `/api/auth/refresh` | — | `{ok: true}` (new `vid_id`) or `401` |
| POST | `/api/auth/signout` | — | `{ok: true}`; revokes the refresh token, clears cookies |

The link token travels in the URL **fragment** (never sent to servers or
logs). The `/auth/` page strips it from the address bar immediately and
only POSTs it to `/api/auth/verify` after the person clicks **Continue**
(showing which address, and warning if this would switch accounts) — so
opening a link can't silently sign someone into another account, and email
link scanners can't burn the single-use token.

Rate limits key on the viewer's IPv4 address or IPv6 **/64**. PINs: 5
attempts per 15 minutes (reserved atomically before checking), 15 failures
in a day lock PIN entry for 24 hours; members are emailed when their PIN is
set, changed, removed or locked.

## Account (requires `vid_id`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/account/me` | — | `Me` |
| GET | `/api/account/terms` | — | `{version_id, title, sha256, text, pdf_url}` current terms (`pdf_url` presigned, 5 min) |
| POST | `/api/account/terms/accept` | `{version_id, sha256}` | `Me` — must match the current version; `registered` → `member` |
| GET | `/api/account/subscription-types` | — | `{items: SubscriptionType[]}` — enabled types this member may start (trials hidden once used) |
| POST | `/api/account/subscription` | `{type_id}` | `Me` — members only; trials only for now (no payments yet), once per person |
| POST | `/api/account/subscription/cancel` | — | `Me` |
| POST | `/api/account/pin` | `{pin, current_pin?}` | `Me` — set (no current) or change (`current_pin` required). 4–8 digits, not trivially weak |
| DELETE | `/api/account/pin` | `{current_pin}` | `Me` — disable |
| POST | `/api/account/preferences` | `{email_updates?: boolean, pin_prompt_dismissed?: boolean}` (at least one) | `Me` |
| POST | `/api/account/cancel` | `{confirm: "CANCEL", pin?}` | `{ok: true}` — `pin` required if a PIN is set. Account disabled now, deleted after 7 days; cookies cleared |

```ts
interface Me {
  user_guid: string;
  email: string;
  first_name: string;
  last_name: string;
  state: 'registered' | 'member';
  account_status: 'active';
  terms: {
    current_version: string | null;   // null if none published
    accepted_version: string | null;
    needs_acceptance: boolean;        // current exists and differs from accepted
  };
  subscription: {
    type_id: string; type_name: string;
    status: 'trial' | 'active' | 'expired' | 'canceled';
    paid: boolean; started_at: string; expires_at: string;
  } | null;
  voting_rights: boolean;           // paid members are the voting members; governance voting is upcoming
  email_verified: boolean;          // always true once signed in (links need it)
  pin_enabled: boolean;
  preferences: { email_updates: boolean; pin_prompt_dismissed: boolean };
  created_at: string;
}

interface SubscriptionType {
  type_id: string; name: string; description: string;
  duration_days: number; is_trial: boolean; paid: boolean;
}
```

Notes for the UI:
- `registered` members see terms acceptance as the next step; subscription
  only after becoming `member`.
- If the published terms change, `needs_acceptance` turns true again for
  existing members (they stay `member`; the UI should prompt).
- Paid types are listed but can't be started yet (`409` "Payments are not
  available yet").

## Vault (alternate channel, requires `vid_id`)

The routes of VAULT-MESSAGING 0.10.0 §11 (enroll, unlock, lock): the app seals each
request to an enclave instance's transport key (ETK), the API forwards the
opaque bytes to that instance's SQS queue, and the app polls for the sealed
answer. The API checks sizes and the envelope's clear header only; it never
sees or stores PINs, keys, mailbox ids or device identifiers, and never logs
envelopes.

**Access** (§11.1). The vault does not depend on subscription or voting
rights.
- `GET /api/vault/enclave`, `enroll` and `unlock` require an active account
  in state `member` that has accepted the **current** terms. Anyone else gets
  `403 terms_required`: `registered` users (they have not accepted the terms
  yet), and members whose accepted version is no longer current
  (`terms.needs_acceptance` in `Me`).
- `lock`, `status` and `requests/{id}` stay available for an existing vault
  whatever the account state (`registered`, terms out of date), because
  locking only reduces exposure.
- **Cancelling the account** blocks every vault route except `lock` at once
  (`403 forbidden`); `lock` keeps working for as long as the session does.
  After the 7-day grace period the daily cleanup job deletes the member's
  vault rows (every `vault_id` they had, and the pointer row). Deleting the
  stored objects under `vaults/<vault_id>/` (encrypted state and sealed
  headers) is a TODO in the cleanup job until the vault data bucket exists
  (VAULT-PLAN V5); nothing is stored there before then.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/vault/status` | — | `{vault: VaultStatus \| null}` |
| GET | `/api/vault/enclave` | — (`?release=<pcr0>` only to abandon an unconfirmed move, §11.10.4) | `Enclave`: the instance to seal to (below) |
| POST | `/api/vault/enroll` | `{request_id, instance_id, etk_kid, envelope, manifest_sha256}` | `202 {vault_id, request_id}` |
| POST | `/api/vault/unlock` | `{vault_id, request_id, instance_id, etk_kid, envelope, manifest_sha256}` | `202 {vault_id, request_id}` |
| POST | `/api/vault/lock` | `{vault_id, request_id}` | `202 {vault_id, request_id}` |
| GET | `/api/vault/requests/{request_id}` | — | `{status: "queued"\|"done"\|"expired", envelope?, code?}` (§11.5) |

```ts
interface Enclave {
  instance_id: string;
  release: string;      // PCR0 (96 lowercase hex) from the instance's attested descriptor
  descriptor: string;   // base64 of the exact descriptor bytes (§11.2)
  attestation: string;  // base64 Nitro attestation document; user_data binds the descriptor
}

interface VaultStatus {     // advisory: written by the enclave host, never a security signal (§11.5)
  vault_id: string;
  state: 'enrolling' | 'locked' | 'unlocked';  // `unlocked` only while `leased` (below)
  sealed_release: string | null;
  vault_version: string | null;
  state_version: number | string | null;
  leased: boolean;          // an instance currently holds the vault
  alarm: { kind: 'credential_clone'; at: string } | null;  // the last host alarm (below), advisory
  release: ReleaseInfo | null;  // the sealed release (W8); null while not sealed yet
  recovery: {               // the active recovery ("Vault recovery"), for apps and the account site
    state: 'pending' | 'available' | 'registered';
    available_at: string;   // RFC 3339
  } | null;                 // null: none, or it was cancelled or has expired
  created_at: string; updated_at: string;
}

interface ReleaseInfo {     // from the routing table (the signed manifest); advisory
  number: number | null;    // null: unknown (not in the manifest; the API answers 410)
  status: 'active' | 'deprecated' | 'retired' | 'removed' | 'canary' | 'unknown';
  ends_at: string | null;   // RFC 3339; set on deprecated and retired releases once known
  newest_active: number | null;
  notice: 'update_available'   // deprecated, or an older active release: offer the newest
        | 'final_warning'      // retired: the release ends at ends_at
        | 'ended'              // removed: the vault can no longer be opened
        | 'rescue'             // removed, reopened for a rescue: only the move is offered
        | 'unavailable'        // unknown, or its image can no longer start
        | null;
}
```

The apps take release status from the signed manifest itself
(VAULT-MESSAGING §11.10.6); `release` is for the account site and agrees
with it because both come from the same manifest.

**`state` and the lease** (1.1.0, VAULT-MESSAGING 0.10.6 §11.5). A vault
runs only while its instance holds an unexpired lease, so a row that says
`unlocked` without one is answered `locked`: the host's own update to
`locked` can arrive late or, before vettid-vault fixes it, not at all
(for a vault locked from the app over the relay). `leased` is the same
check. A lease that is unexpired but held by a crashed instance still
reads `unlocked` until it expires.

**Fields.**
- `request_id`: a canonical ULID chosen by the app, the same as inside the
  envelope. Each one is accepted once (`409 duplicate_request` after).
- `vault_id`: 32 lowercase hex (128 bits), assigned by the API at the first
  enrollment and returned by it. A member has one current vault; a second
  enrollment reuses it (the enclave decides whether a provisional vault may be
  replaced and answers `vault_exists` otherwise, §11.3). A new `vault_id` is
  assigned only after the vault is deleted.
- `instance_id`: from `GET /api/vault/enclave`. `etk_kid`: the descriptor's
  `kid` (16 lowercase hex).
- `envelope`: canonical base64 (with padding, no line breaks) of the sealed v2
  envelope. Enroll and unlock are exactly **13,444 bytes** (12,288 padded +
  1,156 sealed overhead, §5.4). The clear header must be v2 / suite 2 /
  sealed / flags 0, with an all-zero `sender_kid` and `recipient_kid` =
  `etk_kid`. Anything else is `400 bad_request` and is not forwarded.
- `manifest_sha256` (VAULT-MESSAGING 0.10.0 §11.5, "Manifest by hash";
  enroll and unlock only, REQUIRED): 64 lowercase hex, the SHA-256 of the
  release manifest bytes the sealed request names. The API checks the
  format only (else `400 bad_request`) and copies it into the queue
  message as `manifest_sha256`; the enclave host fetches
  `manifests/<manifest_sha256>.json` from the vault data bucket and hands
  it to the enclave. `manifest_serial` travels only inside the sealed
  request; the API neither needs nor reads it. Recovery `register` and
  every other op carry no `manifest_sha256`.
- `envelope` in a result: base64 of exactly **5,252 bytes**, only when
  `status` is `done`: `vault.enroll.result` (§11.3) or `vault.unlock.result`
  (§11.4), sealed to the app, or random bytes of the same size when the
  enclave could not read the request. All are opaque to the API; a slot
  envelope of any other size is not passed on. Lock has no envelope.
- `code`: a host code matching `[a-z_][a-z0-9_]*`, never a sealed outcome.
  Today only `etk_unknown` (no envelope): refetch the descriptor and re-seal.
- `expired`: the request left the queue unprocessed (5-minute retention) or
  could not be queued. Slots disappear 15 minutes after creation (`404`).

**Routing** (§11.1, §11.10.5). `GET /api/vault/enclave` returns:
1. the instance holding the vault's lease, if the lease is unexpired **and**
   that instance is live (a crashed holder doesn't strand the vault);
2. otherwise a live instance of the vault's `sealed_release`, least loaded
   first;
3. for enrollment (no vault, or not sealed yet), a live instance of the
   newest `active` release that has one (for a canary member, of the
   newest `canary` release while one exists; below).

An instance is live while its registry heartbeat is under 90 s old and its
registered queue is `vettid-org-vault-control-<instance_id>` in this account.
POSTs are forwarded only if the named instance is live and holds the lease,
or nobody holds a live lease; enroll additionally needs an instance of an
`active` release. Lock goes to the leaseholder; with no live lease there is
nothing running to lock and the slot is `done` at once.

**Vault errors** carry the MEMBER-API `error` plus the spec's `code` (same
value), and `retry_after` seconds where given:

| Status | `error` | Meaning |
|---|---|---|
| 403 | `terms_required` | Not a member, or the current terms are not accepted |
| 404 | `not_found` | No such vault (or not yours), no such request |
| 409 | `instance_moved` | The named instance is gone or no longer holds the vault: refetch `/api/vault/enclave` and re-seal |
| 409 | `vault_busy` | `?release=` asked for a release while another release's instance holds the vault (`retry_after`: until the lease ends) |
| 409 | `duplicate_request` | `request_id` already used |
| 410 | `release_unavailable` | The vault's release (or the one `?release=` asked for) is unknown, `removed` (its end date has passed, VAULT-MESSAGING 0.10.0 §11.10.5), or its image can no longer be started |
| 503 | `release_starting` | No instance of the release is running; one has been requested. Body also has `release` and `retry_after` (30) |
| 503 | `vault_unavailable` | No `active` release is deployed yet (`retry_after` 300) |

A `deprecated` or `retired` release still serves the vaults sealed to it
(§11.10.1); an unknown, `removed` or unstartable one is `410`, except a
`removed` release that operations have reopened for a rescue (§11.10.5),
which is routed as usual. The rule covers `GET /api/vault/enclave` (with
or without `?release=`, no start is requested), `unlock` and recovery
`register` to an instance of such a release, and a recovery request (a
recovery cancel is still recorded and mailed, only not queued); `lock`
keeps working whatever the release (locking only reduces exposure). The
cleanup job never asks a `removed` release to start for an account
deletion either.

**Canary releases** (VAULT-RELEASES §10.1 step 9, §11.3; W8). Before a
release is published, operations may add a release row with status
`canary` (never a manifest status) for its PCR0. It is routed only for
members whose member row has `vault_canary: true` (set by an operator
from the admin site, ADMIN-API "Vault canary"; never shown or settable by
the member):

- enrollment (`GET /api/vault/enclave` without a vault, and `enroll`) goes
  to the newest `canary` release while one exists, even when no release is
  `active` (production release 1's canary); otherwise to the `active` ones
  as for everyone;
- a canary member's vault sealed to a canary release is routed there like
  any release (unlock, recovery, `?release=`), and started on demand;
- for every other member a canary release is unknown: `410
  release_unavailable` for it by PCR0 or instance, never an enrollment
  target, `status` shows it as `unknown`.

When the published manifest lists the release, the manifest sync turns
the row into an ordinary `active` row. A failed canary's row is deleted by
the operator. The cleanup job reaches a canary release like any other for
an account deletion.

**Dark launch** (VAULT-RELEASES §9). While the release registry has no
`active` release that can start (as before the first release), `GET
/api/vault/enclave` and `enroll` answer `503 vault_unavailable` after their
rate limits and body checks: no vault row, response slot or start request
is written and nothing is queued, even if a stray instance is registered.
`status` answers `{vault: null}`, and `unlock`, `lock` and recovery answer
`404` (there are no vaults). Start requests are recorded only for a known,
routable release, and at most once per 30 s per release however many
members or retries ask.

**Rate limits** (§11.8; `429 rate_limited` with `retry_after`): enroll 3 per
member per day; unlock 10 per member per 15 minutes, and per source network
10 per IPv6 /64 or 60 per IPv4 address per 15 minutes (carrier NAT puts many
members behind one IPv4 address); polling `requests/{id}` 2 per second per
member. Not in the spec, chosen here: `enclave` 30 per member per minute,
`status` 60 per minute, `lock` 30 per 15 minutes.

**Audit.** Enroll, unlock and lock requests are written to the audit table
(`vault.enroll_request`, `vault.unlock_request`, `vault.lock_request`): the
member, `vault_id`, `request_id`, instance and release. Never PINs or
envelopes. Account deletion after cancellation records the deleted
`vault_ids`.

### Vault release notices (VAULT-RELEASES §3.5, §10.2; W8)

A daily job (`VaultNoticeJob`, 15:00 UTC, role
`vettid-org-member-vault-notices`) emails the members whose vault row's
`sealed_release` is an ending release, found through the vaults table's
`sealed-release-index` (it projects only `vault_id`, `user_guid` and
`state`; deleted vaults are skipped):

| Notice | When | Release |
|---|---|---|
| `ends_90`, `ends_30`, `ends_7`, `ends_1` | 90, 30, 7 and 1 days before `ends_at` (a run sends only the latest one due, so a missed day sends the current one, never a stale one) | `deprecated` or `retired` with `ends_at` |
| `ended` | up to 14 days after `ends_at` | `removed`, not reopened for a rescue: how to ask for a rescue in the 30-day window |
| `urgent_<U>` | in the first 30 days of release U | U is marked `security: urgent` in the release log (`https://vettid.org/security/releases/index.json`, generated from the signed manifest); sent to members on each release in U's `affects` that still runs |

Each notice goes to a member at most once per release, end date and
milestone: a conditional put of `vault-notice#…` in the ratelimits table
claims it (expiring 60 days after the end date); a failed send releases
the claim and the next run retries. Mails are plain text from the system
sender (members are SES-verified identities) and are audited as
`vault.release_notice` (release number and milestone only). The job reads
the vault account's tables only through the access matrix
(`lib/vault/access.ts`): `Query` on `vault-releases` and on that one
index, nothing else. In-app notices come from the manifest and
`GET /api/vault/status` (`release.notice`).

Not built yet: the email when a release's key has been deleted (D + 30)
and the deletion of the stored objects of vaults still sealed to a
deleted key (D + 37), which needs the cleanup role in the data bucket's
policy (VAULT-RELEASES §3.5, §8.2).

### Vault recovery (VAULT-MESSAGING 0.4.1 §11.11)

For a member who has lost their app (VAULT-MESSAGING 0.9.0: a vault has
one app). The portal asks; the vault is locked at once; after 24 hours the
portal shows a one-time code (as a QR, rendered in the page) that a new
app presents. The new app then needs the PIN and the credential password,
and **replaces** the old app (removed, its keys revoked); desktops and
agents stay. With the credential backup off there is no copy of the
credential to hand over: the password is not needed, but the credential
and every critical item are lost, and the new app can only create a new
credential or delete the vault (§11.11.5). A member who still has the old
phone moves the app by direct transfer instead (§6.7.1), without the API. The code is minted inside the enclave and
reaches the API only sealed to a P-256 key held by the member's browser, so
the API never holds it in a usable form; the enclave enforces the 24 h and
the expiry itself.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/vault/recovery` | `{browser_key}` | `202 {recovery_id, available_at, expires_at}` |
| GET | `/api/vault/recovery` | — | `{recovery: Recovery \| null}` |
| POST | `/api/vault/recovery/cancel` | `{recovery_id}` | `200 {cancelled: boolean}` |
| POST | `/api/vault/recovery/cancel-link` | `{token}` (no session) | `200 {cancelled: boolean}` |
| POST | `/api/vault/recovery/register` | `{vault_id, request_id, instance_id, etk_kid, envelope}` | `202 {vault_id, request_id}`; poll `GET /api/vault/requests/{id}` |

```ts
interface Recovery {
  recovery_id: string;                 // ULID; the queue request id
  vault_id: string;                    // the vault being recovered (HKDF info and QR payload, §11.11.2)
  state: 'pending' | 'available' | 'registered' | 'cancelled' | 'expired';
  requested_at: string;                // RFC 3339
  available_at: string;                // requested_at + 24 h
  expires_at: string;                  // available_at + 24 h
  sealed_code?: string;                // b64 of 5,252 bytes, only while `available`
}
```

- **Access.** Request, status, cancel and register need the same account
  state as unlock (`member`, current terms). The cancel link needs no
  session, only its token.
- **`browser_key`**: canonical base64 of an uncompressed P-256 point (65
  bytes, first byte `0x04`), made by the portal with WebCrypto
  (non-extractable private key kept in IndexedDB).
- **Request.** `404 not_found` without an enrolled vault (state
  `enrolling` included); `409 recovery_active` while a recovery is
  `pending` or `available`. The API writes the recovery on the vault row,
  creates the response slot (TTL = `expires_at`) and enqueues `recovery`
  (with `browser_key`) to the leaseholder, or to a live instance of the
  vault's `sealed_release` (`503 release_starting` as for the enclave
  route). It emails the member: what happened, when the code becomes
  available, and a single-use cancel link
  (`https://account.vettid.org/vault/recovery/cancel#t=<token>`; the API
  stores only the token's SHA-256, in a request-table row that expires
  with the recovery).
- **Status.** `available` from `available_at` to `expires_at` while not
  cancelled; `sealed_code` is the slot's envelope, returned only then (and
  absent if the host has not answered yet). The portal decrypts it and
  renders the QR locally.
  The sealed answer may instead be a refusal (`error: "no_credential"`,
  VAULT-MESSAGING §11.11.2): a vault without a Protean Credential cannot
  be recovered. The API cannot tell the two apart; the portal shows the
  refusal once it decrypts the answer.
- **Registered** (1.1.0, VAULT-MESSAGING 0.10.6 §11.11.7). The register
  route records the `request_id` on the recovery (`register_ids`, at
  most the 10 a day the rate limit allows) and on its slot
  (`recovery_id`). When a register slot is `done` with `code:
  "recovery_registered"` (the enclave's clear marker of `{ok: true}`,
  copied by the host), the API sets the recovery's state to
  `registered` (conditional on the same `recovery_id` and on not being
  cancelled) and audits `vault.recovery_registered`. It notices it when
  the app polls `GET /api/vault/requests/{id}` for that request, and
  also when `GET /api/vault/recovery` or `/status` finds an `available`
  recovery with register requests (it reads their slots, which live 15
  minutes). From then on `sealed_code` is not returned. `registered`
  stays active until `expires_at` (a new request is `409
  recovery_active`, `status` shows it, it can be cancelled), and reads
  `registered` afterwards. Until vettid-vault sends the marker, a
  recovery stays `available` after a register, as before.
- **Cancel** (session or link): marks the recovery `cancelled`, enqueues
  `recovery_cancel` to the same routing, emails the member and answers
  `{cancelled: true}`. Cancelling a recovery that is not `pending`,
  `available` or `registered` (or one that has passed `expires_at`) is a
  no-op answered `{cancelled: false}`. The link stays valid until the
  recovery's `expires_at`, so its second use answers `false`; a link of a
  recovery that a newer one has replaced is `404`.
- **Register.** Like unlock (envelope exactly 13,444 bytes, routing,
  `request_id` once), and only while the recovery is `available`
  (`409 recovery_not_available`). The enclave re-checks the delay, the
  expiry, the code and the device attestation.
- **`GET /api/vault/status`** includes `recovery: {state,
  available_at} | null` in `VaultStatus` (above): the active recovery
  (`pending`, `available` or `registered` before `expires_at`), so the
  app can show a recovery in progress and offer to cancel it.
- **Rate limits:** request 3 per member per day; register 10 per member
  per day; cancel 30 per member per 15 minutes; the cancel link 20 per
  source network per 15 minutes; status 60 per minute.
- **Audit:** `vault.recovery_request`, `vault.recovery_cancel` (with
  `via: session | link`), `vault.recovery_code_released` (first release),
  `vault.recovery_register`, `vault.recovery_registered` (1.1.0). Never the code, the browser key, the token or
  envelopes.
- **Email** uses the system mailer (SES sandbox: the member's address must
  be a verified identity, as for sign-in links; a failed send is logged
  and does not fail the request).

### The account site's vault pages

What `sites/account` does with the routes above (enrollment, unlock,
release approval, `register` and vault deletion are app-only; the site
never asks for the vault PIN or the credential password):

- **`/account/#vault`** (a tab of the account page, behind the `/account/`
  cookie gate): `GET /api/vault/status`, loaded when the tab is opened.
  No vault: what is needed (membership, current terms, Android 12+), the
  app link from `/config.json` (`android_app_url`, CDK context
  `androidAppUrl` / `<stage>AndroidAppUrl`; until it is set the page says
  the app is not available yet; staging says to use the VettID Staging
  build), and the setup steps as the app shows them. A vault: state,
  release number and status, `release.notice` as a notice (approval
  happens in the app at an unlock), an open recovery, the last
  `credential_clone` alarm, and **Lock vault** (`POST /api/vault/lock`
  with a browser-made ULID, then up to 30 s of `requests/{id}` polling)
  while the vault is `unlocked` or leased. The release log link is
  production's in every stage.
- **`/account/vault/recovery/`** (gated): the request
  (`browser_key` from a WebCrypto P-256 pair made **non-extractable**,
  kept in IndexedDB `vettid-vault-recovery`, store `keys`, keyed by
  `recovery_id` once the API answers; an unbound key survives a lost
  answer and is tried when the code is opened), the 24 h countdown and
  cancel, and, while `available`, the code: opened in the page (ECDH
  `deriveBits`, HKDF-SHA-256, AES-256-GCM, all WebCrypto), drawn as the
  §11.11.2 QR payload by the vendored qrcode-generator 2.0.4 (MIT,
  `js/vendor/`, checksum pinned in `test/site-vault.test.ts`) and as
  text in groups of four. The code is decrypted only when the member
  presses **Show the code** and is removed from the page on **Hide**, on
  any re-render and on `pagehide`; it is never sent, logged or stored.
  Polling `GET /api/vault/recovery` is at most once a minute (once every
  15 s while `available` without `sealed_code`). A browser without the
  key (another browser, a private window, cleared site data) is told so
  and offered cancel and a new request. Keys of ended recoveries are
  deleted. The seal is opened with the recovery's own `vault_id`. A
  `registered` recovery is shown as "used on your new phone", without a
  code (its key is deleted), with cancel while it is active.
- **`/vault/recovery/cancel#t=<token>`** (outside the gate, no session):
  the fragment is removed from the address bar first; the token is sent
  to `cancel-link` only when the member presses the button.
  `{cancelled: true}` confirms the cancel; `{cancelled: false}` says
  there was nothing left to cancel (cancelled already, or ended); 404
  explains that the link no longer belongs to a recovery.

### Vault alarms (VAULT-MESSAGING 0.9.0 §3.5.9, §11.5)

When the vault sees a clone of the member's Protean Credential (a copy
presented by another device, or a stale copy that the app's own retry
does not explain), it refuses it, alerts the app and freezes credential
operations. It has no email egress, so it reports the content-free host
alarm `alarm.credential_clone`. The parent records it on the vault row,
whatever the lease: `alarm = {kind: "credential_clone", alarm_id, at}`
(`alarm_id` a ULID made by the parent, `at` epoch seconds) and
`alarm_pending = true`.

- **Email.** The `vaults` table has a DynamoDB stream (new images). The
  `vault-alarms` job Lambda receives only records whose new image has
  `alarm_pending = true` (event-source filter). For each it claims the
  send with a conditional `REMOVE alarm_pending SET alarm.emailed_at`
  (condition: `alarm_pending` still true and the same `alarm_id`), finds
  the member by the row's `user_guid` and emails them with the system
  mailer: their credential was presented by another device; credential
  use is frozen until their app confirms, then the app rotates the
  credential; if it was not them, change the PIN and the password, and
  use recovery if the phone is gone. No secret, device or version is in
  the email (the alarm carries none). If the send fails, the Lambda
  restores `alarm_pending` so the stream retries.
- **Rate limit:** at most 4 alarm emails per vault per day (owner
  decision, 2026-10-03); further alarms are recorded on the row but not
  mailed.
- **Audit:** `vault.alarm_email` (`vault_id`, `kind`, `alarm_id`;
  `suppressed: true` when rate-limited).
- **Status.** `GET /api/vault/status` returns `alarm: {kind, at}` (the
  last alarm) or `null`, for the account site. Advisory: the vault's own
  alert to the app is the authoritative signal.
- **SES** as for recovery notices (`ses:SendEmail`, sandbox rules; a
  failed send is logged).
- **IAM.** Only the enclave host writes `alarm` and sets `alarm_pending`;
  the alarm Lambda may only clear `alarm_pending` and set
  `alarm.emailed_at` (conditional update), and read `members`. The member
  API never writes either.

### Vault deletion (VAULT-MESSAGING 0.9.0 §12.5)

A vault is deleted by its app (`vault.delete` over the relay: the
holder with the PIN and the password, or a recovering app, including
through the account site's recovery with the backup off), or by the
member API when an account is cancelled. The vault deletes itself:
notices and revocations, keys destroyed, every stored object erased.
Its own audit log goes with it, so the member is told by email.

- **Notice.** On the lifecycle event `deleted` the parent records, on
  the vault row and whatever the lease, `state = deleted`,
  `alarm = {kind: "vault_deleted", alarm_id, at}` and
  `alarm_pending = true`. The `vault-alarms` Lambda claims it as for a
  clone alarm and emails the member: their vault was deleted at that
  time, it cannot be restored, and whom to contact if it was not them.
  No rate limit applies (one notice per deletion). Audit:
  `vault.alarm_email` with `kind: vault_deleted`.
- **Rows.** After the email (or when no member is found) the Lambda
  deletes the vault row (condition: `state = deleted`) and the pointer
  row `user#<guid>` if it still names this vault, so the member's next
  enrollment is a fresh one with a new `vault_id`.
- **Account cancellation.** After the 7-day grace period the cleanup job
  enqueues the operation `delete` (§11.5 SQS message, no envelope) for
  each of the member's vaults not yet `deleted`, to the leaseholder or
  else a live instance of the vault's `sealed_release` (requesting a
  start as the enclave route does when none runs). It sets
  `deletion_requested_at` on the row; a later run retries until the vault
  reports `deleted`, whose notice removes the rows. A vault that is
  running deletes itself with the full semantics; otherwise the
  instance erases its stored objects. Rows of vaults that never reach
  `deleted` within 30 days are logged for operations, not dropped
  silently.
- **Status.** A `deleted` vault row reads as no vault (`{vault: null}`).
- **IAM.** The alarm Lambda may delete vault rows and pointer rows
  (conditional) in addition to its alarm updates; the cleanup job may
  send to the vault-control queues as the API does.

**Left to the API by the spec, decided here:** the shape of `Enclave`; the
`vault_id` encoding; reuse of `vault_id` on re-enrollment; liveness (90 s
heartbeat) and "dead holder means no live lease"; least-load selection
(`load` in the registry, lower first, then freshest heartbeat); newest
`active` release for enrollment; the `vault_busy` and `vault_unavailable`
answers; `lock` without a live lease; `retry_after` values; the extra rate
limits above; the `rescue` flag that marks a reopened `removed` release;
the 30 s start-request interval.

**Tables** (in the vault account's VettidOrgVaultStack, VAULT-RELEASES
§8.1; the API addresses them by table ARN across accounts; the enclave
host writes the fields marked *host*):
- `vettid-org-vaults` (PK `vault_id`, GSI `user-index`): `user_guid`,
  `state`, `created_at`, `updated_at`; *host*: `lease {instance_id,
  lease_expires_at (epoch s)}`, `sealed_release`, `vault_version`,
  `state_version`, later `state`; `alarm {kind, alarm_id, at}` and
  `alarm_pending: true` when the vault reports a host alarm (below; the
  alarm Lambda adds `alarm.emailed_at` and removes `alarm_pending`).
  Pointer rows `user#<guid>` →
  `current_vault_id` (API only; no `user_guid`, so they stay out of the index).
  API: `recovery {recovery_id, state (pending|registered|cancelled),
  requested_at, available_at, expires_at, register_ids?}` (epoch s for
  the times; `available` and `expired` are derived from them).
- `vettid-org-vault-instances` (PK `instance_id`, GSI `release-index` on
  `release` + `heartbeat_at`), all *host*: `release`, `queue_url`,
  `descriptor` (b64), `attestation` (b64), `heartbeat_at` (epoch s),
  `expires_at` (TTL), optional `load`.
- `vettid-org-vault-requests` (PK `request_id`, TTL `expires_at`, 15 min),
  the response slots. API: `vault_id`, `user_guid`, `op`, `status: queued`,
  `instance_id`, `created_at`; *host*: `status: done`, `envelope` (b64 of
  5,252 bytes, if any) and `code: etk_unknown` when the enclave reported it,
  or `status: expired` for a request the host did not forward (the lease is
  held elsewhere) or the enclave could not read (VAULT-MESSAGING 0.3.2
  §11.5). The host only updates slots that are still `queued`.
- `vettid-org-vault-releases` (PK `release` = PCR0, GSI `status-index` on
  `status` + `release_number`), rendered from the signed manifest by
  operations: `release_number`, `status` (`active|deprecated|retired|removed`),
  `available` (false once the image can't be started), `rescue` (true while
  a `removed` release is reopened for a rescue, VAULT-RELEASES §10.3) and
  `ends_at` (RFC 3339, from the manifest; not used for routing). The API
  records on-demand start requests here (`start_requested_at`,
  `start_requests`; at most every 30 s per release, never creating a row);
  the scaler that starts instances is VAULT-RELEASES §8.6, fed by this
  table's stream (new and old images; ARN in SSM
  `vault/vault-releases-stream-arn`, vault account).

The API can write only its own attributes on `vaults` and
`vault-releases` (never a lease, `sealed_release` or a status), cannot write
the instance registry, and can `sqs:SendMessage` only to
`vettid-org-vault-control-*` queues. Only the cleanup job and the deletion
notice can delete vault rows. These limits are enforced twice: by the
three functions' IAM policies here (fixed role names
`vettid-org-member-vault`, `-cleanup`, `-vault-alarms`) and by the vault
account's table, stream and queue resource policies, rendered from the same
matrix (`lib/vault/access.ts`). Table names, the queue prefix and the queue
policy the parent applies are published under `/vettid-org/<stage>/vault/`
in the vault account for the enclave host.
