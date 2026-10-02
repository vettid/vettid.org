---
title: MEMBER-API
status: v1 (Phase 2)
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
| POST | `/api/public/request` | `{email, first_name, last_name, invite_code?: string, consent: true}` | `{outcome}` (below). Names: letters, spaces, `'’.-`, ≤ 40 chars. Global hourly cap (past it: same answer, nothing created). Requests never email-verified are deleted after 14 days. |

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
  voting_rights: boolean;
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

The routes of VAULT-MESSAGING §11 (enroll, unlock, lock): the app seals each
request to an enclave instance's transport key (ETK), the API forwards the
opaque bytes to that instance's SQS queue, and the app polls for the sealed
answer. The API checks sizes and the envelope's clear header only; it never
sees or stores PINs, keys, mailbox ids or device identifiers, and never logs
envelopes.

**Access.** Every `/api/vault/*` route requires an active account in state
`member` that has accepted the **current** terms. Anyone else gets
`403 terms_required`: `registered` users (they have not accepted the terms
yet), and members whose accepted version is no longer current
(`terms.needs_acceptance` in `Me`). The vault does not depend on subscription
or voting rights.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/vault/status` | — | `{vault: VaultStatus \| null}` |
| GET | `/api/vault/enclave` | — (`?release=<pcr0>` only to abandon an unconfirmed move, §11.10.4) | `Enclave`: the instance to seal to (below) |
| POST | `/api/vault/enroll` | `{request_id, instance_id, etk_kid, envelope}` | `202 {vault_id, request_id}` |
| POST | `/api/vault/unlock` | `{vault_id, request_id, instance_id, etk_kid, envelope}` | `202 {vault_id, request_id}` |
| POST | `/api/vault/lock` | `{vault_id, request_id}` | `202 {vault_id, request_id}` |
| GET | `/api/vault/requests/{request_id}` | — | `{request_id, op, status: "queued"\|"done"\|"expired", envelope?, code?}` |

```ts
interface Enclave {
  instance_id: string;
  release: string;      // PCR0 (96 lowercase hex) from the instance's attested descriptor
  descriptor: string;   // base64 of the exact descriptor bytes (§11.2)
  attestation: string;  // base64 Nitro attestation document; user_data binds the descriptor
}

interface VaultStatus {     // advisory: written by the enclave host, never a security signal (§11.5)
  vault_id: string;
  state: 'enrolling' | 'locked' | 'unlocked';
  sealed_release: string | null;
  vault_version: string | null;
  state_version: number | string | null;
  leased: boolean;          // an instance currently holds the vault
  created_at: string; updated_at: string;
}
```

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
- `envelope` in a result: base64 of the sealed answer (≤ 8 KiB decoded), only
  when `status` is `done`. `code` is a short reason from the enclave host
  (e.g. `etk_unknown`: refetch the descriptor and re-seal). Lock and enroll
  usually finish without an envelope (enroll answers through the relay,
  §11.3).
- `expired`: the request left the queue unprocessed (5-minute retention) or
  could not be queued. Slots disappear 15 minutes after creation (`404`).

**Routing** (§11.1, §11.10.5). `GET /api/vault/enclave` returns:
1. the instance holding the vault's lease, if the lease is unexpired **and**
   that instance is live (a crashed holder doesn't strand the vault);
2. otherwise a live instance of the vault's `sealed_release`, least loaded
   first;
3. for enrollment (no vault, or not sealed yet), a live instance of the
   newest `active` release that has one.

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
| 410 | `release_unavailable` | The vault's release (or the one `?release=` asked for) is unknown, or its image can no longer be started |
| 503 | `release_starting` | No instance of the release is running; one has been requested. Body also has `release` and `retry_after` (30) |
| 503 | `vault_unavailable` | No `active` release is deployed yet (`retry_after` 300) |

A `retired` release still serves the vaults sealed to it (§11.10.1); only an
unknown or unstartable one is `410`.

**Rate limits** (§11.8; `429 rate_limited` with `retry_after`): enroll 3 per
member per day; unlock 10 per member per 15 minutes and 10 per viewer IPv4
address / IPv6 /64 per 15 minutes; polling `requests/{id}` 2 per second per
member. Not in the spec, chosen here: `enclave` 30 per member per minute,
`status` 60 per minute, `lock` 30 per 15 minutes.

**Left to the API by the spec, decided here:** the shape of `Enclave`; the
`vault_id` encoding; reuse of `vault_id` on re-enrollment; liveness (90 s
heartbeat) and "dead holder means no live lease"; least-load selection
(`load` in the registry, lower first, then freshest heartbeat); newest
`active` release for enrollment; the `vault_busy` and `vault_unavailable`
answers; `lock` without a live lease; `retry_after` values; the extra rate
limits above.

**Tables** (VettidOrgDataStack; the enclave host writes the fields marked
*host*):
- `vettid-org-vaults` (PK `vault_id`, GSI `user-index`): `user_guid`,
  `state`, `created_at`, `updated_at`; *host*: `lease {instance_id,
  lease_expires_at (epoch s)}`, `sealed_release`, `vault_version`,
  `state_version`, later `state`. Pointer rows `user#<guid>` →
  `current_vault_id` (API only; no `user_guid`, so they stay out of the index).
- `vettid-org-vault-instances` (PK `instance_id`, GSI `release-index` on
  `release` + `heartbeat_at`), all *host*: `release`, `queue_url`,
  `descriptor` (b64), `attestation` (b64), `heartbeat_at` (epoch s),
  `expires_at` (TTL), optional `load`.
- `vettid-org-vault-requests` (PK `request_id`, TTL `expires_at`, 15 min).
  API: `vault_id`, `user_guid`, `op`, `status: queued`, `instance_id`,
  `created_at`; *host*: `status: done`, `envelope` (b64), `code`.
- `vettid-org-vault-releases` (PK `release` = PCR0, GSI `status-index` on
  `status` + `release_number`), rendered from the signed manifest by
  operations: `release_number`, `status` (`active|deprecated|retired`),
  `available` (false once the image can't be started). The API records
  on-demand start requests here (`start_requested_at`, `start_requests`); the
  infrastructure that starts instances is VAULT-PLAN V5.

The API's IAM can write only its own attributes on `vaults` and
`vault-releases` (never a lease, `sealed_release` or a status), cannot write
the instance registry, and can `sqs:SendMessage` only to
`vettid-org-vault-control-*` queues. Table names and the queue prefix are
published under `/vettid-org/<stage>/data/` for the enclave host.
