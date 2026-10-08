---
title: MEMBER-API
status: v1 (Phase 2)
version: 2.3.1
changelog:
  - 2.3.1 (2026-10-08, VAULT-MESSAGING 0.21.0; owner decision of
    2026-10-08, §15 item 29): an email address with a control
    character, C0 (U+0000–U+001F), DEL (U+007F), C1 (U+0080–U+009F),
    U+2028 or U+2029, is refused (`400`, "Invalid email address") at
    registration and by every route that takes an email, the same set
    a vault refuses in the snapshot's `email`; the names rule is stated
    to refuse the same characters (its letters-only pattern already
    did). So a vault never refuses a snapshot built from a registered
    member
  - 2.3.0 (2026-10-07, VAULT-MESSAGING 0.20.0; owner decision of
    2026-10-07): the account snapshot carries the member's full
    verified `email` (the member row's, trimmed and lower-cased, at
    most 254 characters) instead of `email_hint`, so that the app can
    show the member their own address; still `v: 1`, `email` required.
    The vault returns it only to the member's app and desktops and
    never passes it on. Running vaults (0.15.0–0.19.0) accept the new
    form unchanged. `POST /api/vault/enroll/redeem` and
    `POST /api/vault/recovery/claim` keep answering the masked
    `email_hint`
  - 2.2.1 (2026-10-07, VAULT-MESSAGING 0.19.0): errata from the
    vault's implementation (vettid-vault #45). Names are trimmed of
    leading and trailing U+0020 spaces only, at registration
    (`/api/public/request`) as in the name-change job (before, the
    registration trimmed all JavaScript white space); the snapshot's
    `name_change.last.status` is `applied` or `refused`, `reason` only
    with `refused`; the vault re-reports a still-pending name request
    with each `unlocked` report, which the row's `seq` condition makes
    a no-op when the request is already recorded
  - 2.2.0 (2026-10-07, VAULT-MESSAGING 0.18.0; owner decisions of
    2026-10-07): the account snapshot carries `first_name`,
    `last_name` and `name_change` (required; still `v: 1`), which the
    vault sends every connection in its profile's core, and the
    `enroll` queue message carries the snapshot too. Members change
    their names **only in the app**: the vault checks the PIN and the
    credential password and reports the request (host event
    `account_name`, the vault row's `name_change`); a stream job
    applies it at most once per 30 days, audits `member.name_change` or
    `member.name_change_refused`, emails the member and pushes the
    snapshot. The portal shows the names read-only; there is no name
    route for a session or an app key. Additive
  - 2.1.2 (2026-10-06, VAULT-MESSAGING 0.17.0): editorial. The
    `X-VettID-App` header's `nonce` and `sig` are base64url without
    padding, canonical, as the apps send and the API already requires
    (a padded value is `401 unauthorized`)
  - 2.1.1 (2026-10-06, owner decision of 2026-10-06, from the
    implementation, vettid.org #148): `VaultStatus.deletion` carries
    `deletion_id`, so that the app, which cannot read the session-only
    `GET /api/vault/deletion`, can send `POST /api/vault/deletion/cancel
    {deletion_id}` with its app key. Additive. Editorial (vettid-vault
    #42): the recovery state `unavailable` covers either sealed refusal,
    `no_backup` or `no_credential` (a vault without a credential exists
    only during enrollment); the API acts on the slot code
    `recovery_unavailable` alone, never on the sealed body
  - 2.1.0 (2026-10-06, VAULT-MESSAGING 0.16.0; owner decisions of
    2026-10-06: no recovery with the credential backup off; start over
    instead): the vault row gains the host-written `credential_backup`
    (one bit the vault reports: whether it keeps a backup copy of its
    credential) and `VaultStatus.credential_backup`; `POST
    /api/vault/recovery` answers `409 recovery_unavailable` (`reason:
    "no_backup"`) when it is `false`, and `409 deletion_pending` during
    a start-over; a recovery the enclave refuses (slot code
    `recovery_unavailable`) ends at once in the new state `unavailable`,
    with its sealed refusal returned immediately. New: "Delete my vault
    and start over" (`/api/vault/deletion`, `GET`, `/cancel`,
    `/cancel-link`; 24 h, emails, cancel from the portal, the link or
    the app; then the queue op `delete`) and `VaultStatus.deletion`.
    Removed from the text: the backup-off recovery that ended in a new
    credential or a deletion by the recovering app. Additive for v2
    clients that ignore unknown fields and treat an unknown recovery
    state as ended
  - 2.0.1 (2026-10-06, from the implementation, vettid.org #144):
    editorial. The pause refusal of `redeem` and recovery `claim` comes
    after the signature check, which reads `app_key` from the body, and
    before anything is spent, counted, written or emailed (it used to
    say "before the body is read"); a suspended account gets no account
    snapshot (`account_status` is `active` or `canceled` only); limits
    chosen where the spec was silent: reading a setup code 60 per member
    per minute, revoking it 30 per 15 minutes; failed redeems are
    audited at the 1st, 10th, 100th, … failure per source network and
    hour
  - 2.0.0 (2026-10-06, VAULT-MESSAGING 0.15.0; ENROLLMENT-CODES.md):
    **breaking for apps.** Apps no longer sign in: the portal issues a
    setup code (`/api/vault/enroll-code`: a 128-bit QR secret and an
    8-symbol code typed with the member's email; 5 minutes; no global
    limit), the app redeems it
    (`/api/vault/enroll/redeem`) with its app key, and every app request
    is signed by that key (`X-VettID-App`) instead of carrying cookies.
    `enclave`, `enroll`, `unlock` and recovery `register` accept only
    signed requests; `status`, `lock` and `requests/{id}` accept either.
    New: recovery `claim`; the vault row's `app_key` (host-written),
    pending and claim keys; the `account` snapshot pushed to the vault;
    the redemption email. Unlock no longer needs the current terms. The
    portal's `/auth/` App Link is no longer claimed by the app; `/vault/enroll/`
    is. Portal sign-in, cookies and CSRF are unchanged. While the vault
    service is paused (1.2.0), code issue, redeem and recovery `claim`
    are refused like `enroll`; reading and revoking a code are served.
    Numbered after 1.2.0 (the kill switch), which it keeps
  - 1.2.0 (2026-10-05): the operator's vault service pause ("Vault
    service pause"): while paused, `GET /api/vault/enclave`, `enroll`,
    `unlock`, recovery request and recovery `register` answer `503
    vault_unavailable` with `service: "paused"` and a `Retry-After`
    header; `GET /api/vault/status` gains the top-level `service`.
    Additive: v1 clients that ignore unknown fields and already handle
    `503 vault_unavailable` keep working
  - 1.1.0 (2026-10-05, VAULT-MESSAGING 0.10.6): `VaultStatus` documents
    `recovery`; `state` reads `unlocked` only under a live lease;
    `Recovery` gains `vault_id` and the state `registered` (no
    `sealed_code` after it); both recovery cancel routes answer
    `{cancelled}`; `GET /api/vault/recovery` without an enrolled vault is
    `{recovery: null}` (as it always was). Additive: v1 clients that ignore unknown fields and
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
| POST | `/api/public/request` | `{email, first_name, last_name, invite_code?: string, consent: true}` | `{outcome}` (below). `invite_code` is the optional **registration code** (field name kept for compatibility). Names: trimmed of leading and trailing U+0020 spaces only (2.2.1), then letters, spaces, `'’.-`, ≤ 40 chars (so never a control character: C0, DEL, C1, U+2028 or U+2029, 2.3.1). Email: trimmed and lower-cased, at most 254 characters, one `@` with a dot in the domain, no white space and (2.3.1) no C0, DEL, C1, U+2028 or U+2029 (the snapshot `email`'s rule, VAULT-MESSAGING 0.21.0 §11.13). Global hourly cap (past it: same answer, nothing created). Requests never email-verified are deleted after 14 days. |

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

**Names** (2.2.0, VAULT-MESSAGING 0.18.0 §10.8, §11.13). `first_name`
and `last_name` are the names every connection of the member's vault
sees, as the name on the member's VettID account (never as a verified
identity). Members change them **only in the app** (owner decision of
2026-10-07), through their vault ("Name changes from the vault",
below); no account route changes them, for a session or an app key.

Notes for the UI:
- `registered` members see terms acceptance as the next step; subscription
  only after becoming `member`.
- The account page shows the names read-only, says that every
  connection sees them, and that they are changed in the VettID app
  (at most once every 30 days).
- If the published terms change, `needs_acceptance` turns true again for
  existing members (they stay `member`; the UI should prompt).
- Paid types are listed but can't be started yet (`409` "Payments are not
  available yet").

## Vault (alternate channel)

The routes of VAULT-MESSAGING 0.15.0 §11 (enroll, unlock, lock): the app seals each
request to an enclave instance's transport key (ETK), the API forwards the
opaque bytes to that instance's SQS queue, and the app polls for the sealed
answer. The API checks sizes and the envelope's clear header only; it never
sees or stores PINs, keys (other than app public keys), mailbox ids or
device identifiers, and never logs envelopes.

### Two kinds of caller (2.0.0)

- **The account portal** uses its session (`vid_id` cookie, CSRF header)
  for `status`, `lock`, `requests/{id}`, the enrollment-code routes and the
  recovery routes it always had.
- **Apps never sign in** (owner decision of 2026-10-05). Each request is
  signed by the app's **app key** (VAULT-MESSAGING §11.12.2): a per-app,
  per-vault P-256 key in Android Keystore or the iOS Secure Enclave. The
  API finds the vault from the header and the member from the vault row,
  then applies the same account checks, rate limits and canary routing as
  for a session. A request carrying `X-VettID-App` is authenticated by it
  alone (cookies ignored, no CSRF header needed).

| Route | Portal (session) | App (signed) |
|---|---|---|
| `POST /api/vault/enroll-code`, `GET`, `DELETE` | yes | — |
| `POST /api/vault/enroll/redeem` | — | the key being registered (`vault=` empty) |
| `GET /api/vault/enclave` | — | `app_key`, pending key, claim or recovering key |
| `POST /api/vault/enroll` | — | pending key |
| `POST /api/vault/unlock` | — | `app_key`, recovering key |
| `POST /api/vault/lock` | yes | `app_key`, recovering key |
| `GET /api/vault/status` | yes | `app_key`, recovering key |
| `GET /api/vault/requests/{id}` | yes (the member's slots) | the key that made the request |
| `POST /api/vault/recovery`, `GET`, `/cancel` | yes | — |
| `POST /api/vault/recovery/cancel-link` | its token | — |
| `POST /api/vault/recovery/claim` | — | the key being registered (`vault=` the QR's) |
| `POST /api/vault/recovery/register` | — | a claim key |
| `POST /api/vault/deletion`, `GET` (2.1.0) | yes | — |
| `POST /api/vault/deletion/cancel` (2.1.0) | yes | `app_key` |
| `POST /api/vault/deletion/cancel-link` (2.1.0) | its token | — |

### App request signing (2.0.0)

```
X-VettID-App: v=1; vault=<vault_id or empty>; kid=<akid>; ts=<Unix s>; nonce=<b64url 16 B>; sig=<b64url DER>
```

`nonce` and `sig` are base64url (RFC 4648 §5) without padding, canonical
(2.1.2): a padded or non-canonical value fails the header's syntax.
`sig` is ECDSA P-256 / SHA-256 over `"vettid/member-api/app/1" \n METHOD
\n path \n query \n vault_id \n akid \n ts \n nonce \n
hex(SHA-256(body))` (VAULT-MESSAGING §11.12.2). `akid` is the first 16
bytes of SHA-256 of the key's SPKI DER, 32 lowercase hex. The API checks,
in order: the header's syntax, `ts` within 300 s, the nonce unused for
this `akid` within 600 s (a conditional put of `appnonce#<akid>#<nonce>`
in the rate-limit table, TTL 600 s), that the key is allowed for the
route on that vault (table above), and the signature. Any failure is
`401 unauthorized` with no detail. The header, not `Authorization`,
because CloudFront forwards `Authorization` only through a cache policy
and `/api/*` disables caching: the account site's `/api/*` origin request
policy adds `X-VettID-App` to its allowlist.

**App keys on the vault row** (`vaults` table):
- `app_key {key, kid, seq}`: written **only by the enclave host**, from
  the vault's lifecycle reports (`enrolled`, `unlocked`, `locked`,
  `app_key`; VAULT-MESSAGING §11.5), whatever the lease, when `seq` is
  higher than the stored one (`enrolled` always). The API never writes it.
- `app_key_pending {key, kid, until}`: written by the redeem; valid 1
  hour; cleared once `app_key` names the same `kid`.
- On the recovery: `claim_keys [{key, kid}]` (at most 10) and
  `recovering_key {key, kid}` (from the register whose slot came back
  `recovery_registered`).
- On each response slot: the signing `kid` (`app_kid`), so that only that
  key can poll it.

### Setup codes (2.0.0, VAULT-MESSAGING §11.12.1)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/vault/enroll-code` | — (session, CSRF) | `201 {secret, code, expires_at, api}`: `secret` the 22-character QR secret, `code` the 8-symbol typed code, each returned only here; `api` the origin for the QR |
| GET | `/api/vault/enroll-code` | — (session) | `{enroll_code: {state: 'live'\|'used'\|'expired'\|'revoked', typed_blocked: boolean, issued_at, expires_at, used_at?} \| null}`: the member's latest issuance, never its secrets |
| DELETE | `/api/vault/enroll-code` | — (session, CSRF) | `{revoked: boolean}` |
| POST | `/api/vault/enroll/redeem` | `{secret, app_key}` or `{email, code, app_key}` (signed by `app_key`) | `200 {vault_id, user_guid, email_hint}` |

- **Issue** needs an active account in state `member` with the current
  terms (`403 terms_required`). It revokes the member's live issuance, if
  any, and makes one issuance with two secrets that live and die
  together: the QR secret (16 CSPRNG bytes, base64url, 22 characters)
  and the typed code (8 symbols of `23456789ABCDEFGHJKMNPQRSTUVWXYZ` by
  rejection sampling). It lives **5 minutes** and is redeemed once, by
  either secret.
- **Storage.** `k_code` is an HMAC key in SSM SecureString
  (`/vettid-org/<stage>/member/enroll-code-key`). The issuance is a
  request-table row keyed `enroll#<hex HMAC(k_code, "qr" || 0x00 ||
  secret)>` with `user_guid`, `code_mac` = HMAC(k_code, "code" || 0x00 ||
  user_guid || 0x00 || code), `issued_at`, `expires_at` (also the TTL),
  `state` (`live`, `used`, `revoked`), `typed_attempts` and
  `typed_blocked`. The member's pointer row `user#<guid>` names the live
  issuance (`enroll_live`), which is how a new issuance or `DELETE`
  revokes the old one and how a typed redeem finds it. Neither secret is
  stored, logged or audited.
- **Redeem.** Exactly one form, else `400 bad_request`. `app_key` is the
  b64 SPKI DER of a P-256 key, and the request must be signed by it with
  an empty `vault`.
  - **By QR secret** `{secret, app_key}`: one lookup by the secret's
    HMAC.
  - **Typed** `{email, code, app_key}`: the email is trimmed and
    lower-cased, the code stripped of spaces and hyphens and upper-cased
    (a code of another form is `404 invalid_code` like any other
    failure). The API finds the member by email, the live issuance
    through the pointer, and compares `code_mac` in constant time. The
    code is never compared with another member's issuance. Each typed
    attempt increments `typed_attempts` (conditional on not blocked);
    the 800th makes the issuance `typed_blocked` (below).
  - Both forms require the issuance to be live, unexpired, the pointer's
    current one, and its member an active `member` (typed: and not
    `typed_blocked`). Then the API marks it `used` with a conditional
    write (one winner, both secrets spent), finds or assigns the member's
    vault (as enroll did), writes `app_key_pending`, emails the member ("A
    phone used your setup code at <time> to set up your VettID vault. If
    this wasn't you, contact support."), audits
    `vault.enroll_code_redeemed` (with `via: qr | typed`), and answers
    `vault_id`, `user_guid` and `email_hint` (first character of the
    local part, `***`, `@`, the domain).
- **One failure answer.** Every failure of either form, including a
  wrong or unknown email, a member without a live issuance, a wrong code,
  and an expired, used, revoked or `typed_blocked` issuance, is `404
  invalid_code`. The typed path does the same work in every case (the
  member lookup, a MAC compared against the stored `code_mac` or a dummy
  one) and answers no sooner than 250 ms after receipt, so neither the
  content nor the timing reveals whether an account exists.
- **Limits** (`429 rate_limited` with `retry_after`). **None is global.**
  - Issue: 5 per member per hour and 20 per day; 20 per source network
    per hour.
  - Redeem, both forms, per source network: 30 per 5 minutes per IPv4
    address (carrier NAT), 10 per IPv6 /64.
  - Typed, per (email, source network): 5 per 5 minutes, counted for
    every email whether or not it belongs to an account
    (`enroll-typed#<HMAC(k_code, email)>#<network>`).
  - Typed, **per issuance: 800 attempts** from all sources together:
    at most 800 / 31^8 ≈ 9.4 × 10^-10 chance per issuance that guessing
    finds the code (at most 1.9 × 10^-8 per member and day, at 20
    issuances). At the 800th the issuance becomes `typed_blocked`: its
    typed redeems answer `404 invalid_code`, its QR secret still
    redeems, the API emails the member once ("Someone tried many wrong
    codes for your account. Scan the QR code instead, or get a new
    code.") and raises the alarm `MemberEnrollTypedCeiling`; the portal
    page shows it. Attempts against an email with no live issuance are
    counted on a per-email, per-5-minute counter with the same
    threshold, so the behaviour is the same for every email; it blocks
    nothing real.
  - The QR secret (128 bits) needs no limit beyond the per-network one.
  - The effect of flooding is therefore bounded to one member's typed
    entry for one issuance (at most 5 minutes); every other member, and
    that member's QR and App Link, are unaffected.
  - Not in the spec, chosen here (2.0.1): reading the code (`GET`) 60
    per member per minute; revoking it (`DELETE`) 30 per member per 15
    minutes.
- **Audit:** `vault.enroll_code_issued`, `vault.enroll_code_revoked`,
  `vault.enroll_code_redeemed` (member, `vault_id`, the key's `kid`,
  `via`), `vault.enroll_code_typed_blocked` (member, issuance time),
  `vault.enroll_code_failed` (aggregated per source network and hour:
  written at the 1st, 10th, 100th, … failure of the network's hour, with
  the count so far and `via`). Never a secret, a code or an email that
  is not a member's.

### Access (§11.1)

The vault does not depend on subscription or voting rights.
- **Enrollment** needs a member in state `member` with the **current**
  terms when the portal issues the code (`403 terms_required` on
  `POST /api/vault/enroll-code`), and an active `member` account at redeem
  and at `enclave` and `enroll` with the pending key.
- **Since 2.0.0** `enclave` (for an enrolled vault), `unlock` and recovery
  `register` need an active account but no longer the current terms: the
  vault keeps working when the terms change; the portal prompts as
  before, and the app shows `needs_acceptance` from the account snapshot.
- `lock`, `status` and `requests/{id}` stay available for an existing vault
  whatever the account state (`registered`, terms out of date), because
  locking only reduces exposure.
- **Cancelling the account** blocks every vault route except `lock` at once
  (`403 forbidden`); `lock` keeps working, with the portal's session or
  the app key, until the vault rows are deleted.
  After the 7-day grace period the daily cleanup job deletes the member's
  vault rows (every `vault_id` they had, and the pointer row). Deleting the
  stored objects under `vaults/<vault_id>/` (encrypted state and sealed
  headers) is a TODO in the cleanup job until the vault data bucket exists
  (VAULT-PLAN V5); nothing is stored there before then.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/vault/status` | — | `{vault: VaultStatus \| null, service: 'available' \| 'paused'}` (`service`: 1.2.0, "Vault service pause"; app: the signing key's vault) |
| GET | `/api/vault/enclave` | — (`?release=<pcr0>` only to abandon an unconfirmed move, §11.10.4) | `Enclave`: the instance to seal to (below) |
| POST | `/api/vault/enroll` | `{vault_id, request_id, instance_id, etk_kid, envelope, manifest_sha256}` (signed by the pending key; 2.0.0 adds `vault_id`, the redeem's) | `202 {vault_id, request_id}`; the queue message carries the pending key as `app_key` |
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
  } | null;                 // null: none, or it was cancelled, refused or has expired
  credential_backup: boolean | null;  // 2.1.0: host-written; false = the vault cannot be recovered; null = not reported yet
  deletion: {               // 2.1.0: a pending start-over ("Vault deletion: start over")
    deletion_id: string;    // 2.1.1: what the app's cancel names
    state: 'pending' | 'executing';
    deletes_at: string;     // RFC 3339
  } | null;
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
  enrollment and returned by it (since 2.0.0 by the redeem). A member has one current vault; a second
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
| 503 | `vault_unavailable` | No `active` release is deployed yet, or the operator has paused the vault service (body `service: "paused"`, below); `retry_after` 300 |

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

**Vault service pause** (1.2.0; owner decision 2026-10-05). An
operator switch that makes the vault service temporarily unavailable
without touching any vault, key, manifest, release row or stored state,
and turns it back on (ADMIN-API "Vault service", RUNBOOK "Pausing the
vault service"). It is the off switch the published manifest does not
have: the only other way back is a manifest serial with the release
`removed` (VAULT-RELEASES §12.3), which also strands the vaults on it.

- **State.** One SSM parameter per stage in the member API's account,
  `/vettid-org/<stage>/switch/vault-service`, value JSON `{enabled,
  reason, set_by, set_at}`. No parameter (the normal case) means on; a
  value that is not JSON with a boolean `enabled` means paused (someone
  wrote it on purpose). It is never created or changed by a deploy.
- **Effect.** The vault Lambda reads it at most every 30 s per instance
  (a change takes effect within about 30 s). If a read fails it keeps
  the last value it read, and with none it treats the service as on
  (logged `vault service switch unreadable`): an SSM outage must not take
  the vaults down.
- **Paused: refused** with `503 vault_unavailable`, `service: "paused"`,
  `retry_after` 300 and the header `Retry-After: 300`, right after the
  account checks and before body checks and rate limits (paused attempts
  do not use up a member's daily enroll or recovery allowance). Nothing
  is written, queued or start-requested:
  `GET /api/vault/enclave` (with or without `?release=`), `enroll`,
  `unlock` (and with it release-update approvals, which travel in an
  unlock), `POST /api/vault/recovery`, `POST /api/vault/recovery/register`.
- **Paused: the 2.0.0 routes.** Refused in the same way:
  `POST /api/vault/enroll-code` (issue, like `enroll`: a code that could
  not be used before it expires is not issued), `POST
  /api/vault/enroll/redeem` and `POST /api/vault/recovery/claim`. For the
  redeem and the claim the refusal comes right after the app signature
  check (which reads `app_key` from the body: the request is signed by
  that key) and before any lookup, so before anything is spent, counted,
  written or emailed: no issuance is spent, no typed attempt is counted,
  no `app_key_pending` or claim key is written and no email is sent, and
  it reveals nothing about an account. Only `app_key` is read for the
  signature; the rest of the body is not looked at. Served: `GET` and `DELETE /api/vault/enroll-code` (revoking
  only reduces exposure), and the app-signed `status`, `lock` and
  `requests/{id}` like the portal's. A redeem that succeeded just before
  the pause leaves `app_key_pending` (1 hour); `enclave` and `enroll`
  with it are refused while paused, and after the hour the member gets a
  new code. The `account` snapshot op to a live leaseholder (below) is
  still sent: it goes only to a leaseholder and never starts anything.
- **Paused: still served.** `status` (it adds `service: "paused"`),
  `requests/{id}` (answers to requests queued before the pause), `lock`
  (locking only reduces exposure; it goes to the leaseholder and never
  starts anything), `GET /api/vault/recovery`, and both recovery
  cancels: the cancel is recorded and mailed as usual and queued only
  to a leaseholder or a live instance, never by asking for a start (as
  for a `removed` release); the next unlock can still cancel it in the
  enclave (§11.11.4).
- **Running vaults** keep running until they lock (lease expiry, the
  app, or the drain at scale-in); the pause does not lock them, and the
  relay is not affected. A "lock every vault" operator action does not
  exist; it is a follow-up if one is wanted.
- **Starts.** While paused nothing asks the scaler for a start: the
  routes above write no start request, and the daily cleanup job neither
  queues account-deletion `delete` operations nor requests starts (it
  records `deletion_requested_at` and retries after the pause, as for a
  release that cannot start). The scaler starts hosts only for start
  requests, so at most a request made in the last 5 minutes before the
  pause starts one host, which stops again after 30 idle minutes. Release
  stacks' always-on minimums are deployment configuration and stay as
  they are.
- **`reason`** is for operators (admin site, audit, alerts) and is never
  shown to members; they see only the generic text: "The vault service is
  paused for maintenance. Try again later."
- **Audit and alerts.** Each change from the admin API is audited
  (`vault.service.pause`, `vault.service.resume`). Every write to the
  parameter, from the admin API or the CLI, emails the security-alerts
  topic, and while paused a CloudWatch alarm reports it (production: on
  pausing, again after 24 h, and when it ends).
- **Clients.** The account site's Vault tab shows "Vault service is
  paused for maintenance" when `status` says so (and, since 2.0.0, does
  not offer **Get a setup code** while paused). Apps treat the 503 as
  they treat `vault_unavailable` today (try again later) and may show
  `service: "paused"` from `status`.

**Rate limits** (§11.8; `429 rate_limited` with `retry_after`): the code
limits above; enroll 3 per
member per day; unlock 10 per member per 15 minutes, and per source network
10 per IPv6 /64 or 60 per IPv4 address per 15 minutes (carrier NAT puts many
members behind one IPv4 address); polling `requests/{id}` 2 per second per
member. Not in the spec, chosen here: `enclave` 30 per member per minute,
`status` 60 per minute, `lock` 30 per 15 minutes.

**Audit.** Enroll, unlock and lock requests are written to the audit table
(`vault.enroll_request`, `vault.unlock_request`, `vault.lock_request`): the
member, `vault_id`, `request_id`, instance and release, and (2.0.0)
`via: session | app` with the app key's `kid`. Never PINs or
envelopes. Account deletion after cancellation records the deleted
`vault_ids`.

### Account snapshot to the vault (2.0.0, VAULT-MESSAGING §11.13)

The app shows membership, terms and subscription state, read-only, and
gets it only from its vault. The API builds the snapshot from the member
row (`v`, `as_of`, `email` (2.3.0; `email_hint` before), `first_name`,
`last_name` and `name_change` (2.2.0), `state`, `account_status`, `deletes_at`, `terms.needs_acceptance`,
`subscription {type_name, status, paid, expires_at} | null`,
`voting_rights`; at most 2 KiB) and sends it:

- in every `enroll` (2.2.0) and `unlock` queue message (`account`; an
  `enroll` without one is refused by the enclave, so the API builds it
  before it enqueues and answers `503 vault_unavailable` if it cannot);
- as the queue op `account` to the vault's live leaseholder after a
  change: `POST /api/account/terms/accept`, `/subscription`,
  `/subscription/cancel`, `/cancel` (and the admin site's equivalents),
  and (2.2.0) after the name-change job has processed a request.
  With no live lease nothing is sent. A slot is written as for `lock`;
  the host answers it `done`. A newly published terms version is not
  fanned out (each vault learns it at its next unlock).

**Names (2.2.0).** `first_name` and `last_name` are the member row's, as
stored (validated at registration or by the name-change job).
`name_change` is `{allowed_after,
last}`: `allowed_after` is the member row's `name_changed_at` + 30 days
while that lies in the future, else `null` (always `null` before the
first change: the registration names do not count); `last` is the vault
row's `name_change_result` (`{seq, status, reason?}`) or `null`;
`status` is `applied` or `refused`, and `reason` (`too_soon`,
`invalid` or `account`) is present only with `refused` (2.2.1). A vault
refuses a snapshot whose `status` is anything else and keeps the one it
had (VAULT-MESSAGING §11.13). The
snapshot keeps `"v": 1` with these members required: VettID has no
vaults to stay compatible with (owner decision of 2026-10-07).

The snapshot's `account_status` is `active` or `canceled` only
(VAULT-MESSAGING §11.13). A **suspended** account (or one in any other
status, or in neither state `registered` nor `member`) gets **no
snapshot**: none is put in an `unlock` (which a suspended account cannot
make anyway, Access above) and no `account` op is sent; the vault keeps
the last snapshot it had.

**Email (2.3.0, owner decision of 2026-10-07).** `email` is the member
row's `email`, the address the member verified at registration, as
stored (trimmed and lower-cased by `/api/public/request`; at most 254
characters). It replaces `email_hint`, which the snapshot no longer
carries; the redeem and recovery-claim answers keep `email_hint` (the
first character of the local part, `***`, `@` and the domain), since
they reach an app before it has proved anything. The vault shows the
address to the member's app and desktops only and never passes it to a
connection, an agent or back to the host (VAULT-MESSAGING 0.20.0
§11.13). With the names and the email at their maxima the snapshot is
about 1.9 KiB, under the 2 KiB limit, which `accountSnapshot` still
enforces (a snapshot over it is not sent). A 0.20.0 vault refuses a
snapshot without `email`; older vaults (0.15.0–0.19.0) check
`email_hint` only when present and ignore unknown members, so they
accept the new form, and the API sends `email` only, without a
transition. A member whose address changes (no route changes it today)
would get the new one with the next snapshot.

**Characters (2.3.1, owner decision of 2026-10-08, VAULT-MESSAGING
0.21.0 §11.13).** A 0.21.0 vault refuses a snapshot whose `email`
contains C0 (U+0000–U+001F), DEL (U+007F), C1 (U+0080–U+009F), U+2028
or U+2029, or whose names contain any of them, and keeps the snapshot
it had. The API therefore refuses such an address wherever it takes
one (the shared email check: registration, sign-in, typed redeem; `400`
"Invalid email address", as for any other bad address), and the names
rule (letters, spaces, `'’.-`) admits none of them, at registration and
in the name-change job. No registered member can have one, so every
snapshot the API builds from a member registered under 2.3.1 is
accepted. Rows registered before are not rewritten: the earlier
pattern already refused white space, U+2028 and U+2029, and a member
whose stored address held another of these characters would keep their
vault's last snapshot until the address is corrected.

It is display only and never a security signal; the API's own checks
(Access, above) are what enforce membership and terms. Its names are the
one part a vault passes on, to its connections, as the account's
(unverified) names. Audit: none (it is
the member's own data going to the member's own vault).

### Name changes from the vault (2.2.0, VAULT-MESSAGING 0.18.0 §10.8, §11.5)

The member asks in the app (`account.name.set`); the vault checks the
PIN and the credential password, as in the daily owner check, and the
validation below, then reports the event `account_name {seq,
first_name, last_name}`. The parent writes `name_change = {seq,
first_name, last_name, at}` and `name_change_pending = true` on the
vault row, whatever the lease, if `seq` is higher than the row's.
While the request is still pending in the vault, the vault reports it
again with every `unlocked` report (2.2.1, VAULT-MESSAGING 0.19.0
§11.5), so that an event lost after the flush reaches the row; a
request the row already holds fails the `seq` condition, which the
parent treats as done, and is not processed twice.

- **The job.** The `vaults` table's stream (new images) feeds a
  `vault-names` job Lambda, filtered on `name_change_pending = true`. It
  claims the request with a conditional `REMOVE name_change_pending`
  (condition: still true, same `seq`), finds the member by the row's
  `user_guid`, and refuses the change (`status: "refused"`) when:
  - `account`: the account is not `active`, or not in state
    `registered` or `member`, or the vault row is not the member's
    current vault;
  - `invalid`: a name fails the registration rule (as in
    `/api/public/request`: trimmed of leading and trailing U+0020
    spaces only (2.2.1);
    `^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$`; at most 40 characters,
    counted as UTF-16 code units), or
    both equal the current names;
  - `too_soon`: the member row's `name_changed_at` is less than 30 days
    ago (the **rate limit**: one applied change per 30 days per member;
    the registration names do not count, refused requests do not
    count).
  Otherwise it updates the member row's `first_name`, `last_name` and
  `name_changed_at` (conditional on `name_changed_at` unchanged, so two
  requests cannot both pass the 30 days) with `status: "applied"`.
- **Then**, either way, it writes `name_change_result = {seq, status,
  reason?}` on the vault row (conditional on `seq` not lower than the
  stored result's), and pushes the snapshot to the vault's live
  leaseholder (Account snapshot to the vault, above); with no live lease
  the next unlock carries it. The vault settles the app's request from
  the snapshot's `name_change.last` and, after an applied change, sends
  the new names to every connection. If the job fails before the
  result is written, it restores `name_change_pending` so the stream
  retries.
- **Email.** After an applied change the member is emailed with the
  system mailer: "The name on your VettID account was changed from …
  to … in your VettID app; your connections now see it. If this
  wasn't you, contact support." Refusals are not emailed (the app
  shows them).
- **Audit:** `member.name_change` (`vault_id`, `seq`, the previous and
  the new names) or `member.name_change_refused` (`vault_id`, `seq`,
  `reason`).
- **What the app shows** comes from the vault (VAULT-MESSAGING §10.8):
  "Name change requested" while pending, the new names once applied,
  and for `too_soon` "You can change your name once every 30 days. You
  can change it again on <allowed_after>."
- **IAM.** Only the enclave host writes `name_change` and sets
  `name_change_pending`; the job may only clear `name_change_pending`
  and write `name_change_result` on the vault row, update the names and
  `name_changed_at` on the member row, and read both. No route of the
  member API or the admin API changes the names. The admin API shows
  them (ADMIN-API "People"); if an admin edit is ever added, it MUST
  push the snapshot as the job does.
- **Why the vault path** (owner decision of 2026-10-07, VAULT-MESSAGING
  §15 item 26): a change needs the member's PIN and credential password,
  not a portal session or a phone's app-key signature alone.

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
agents stay. **A recovery exists only with the credential backup on**
(VAULT-MESSAGING 0.16.0, owner decisions of 2026-10-06: "THERE IS NO
RECOVERY IF BACKUP IS DISABLED"). With the backup off the request is
refused upfront (below), and the member's only path is to delete the
vault and start over ("Vault deletion: start over"). A member who still has the old
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
| POST | `/api/vault/recovery/claim` | `{vault_id, recovery_id, app_key}` (app, signed by `app_key`; 2.0.0) | `200 {user_guid, email_hint}` |
| POST | `/api/vault/recovery/register` | `{vault_id, request_id, instance_id, etk_kid, envelope}` (app, signed by a claim key; 2.0.0) | `202 {vault_id, request_id}`; poll `GET /api/vault/requests/{id}` |

```ts
interface Recovery {
  recovery_id: string;                 // ULID; the queue request id
  vault_id: string;                    // the vault being recovered (HKDF info and QR payload, §11.11.2)
  state: 'pending' | 'available' | 'registered' | 'cancelled' | 'expired'
       | 'unavailable';                // 2.1.0: the enclave refused it (no_backup or no_credential; slot code recovery_unavailable)
  requested_at: string;                // RFC 3339
  available_at: string;                // requested_at + 24 h
  expires_at: string;                  // available_at + 24 h
  sealed_code?: string;                // b64 of 5,252 bytes, only while `available`
}
```

- **Access.** Request, status and cancel are the portal's and need a
  session of an active `member` with the current terms. Claim and register
  (2.0.0) are the new app's: signed, no session, an active account. The
  cancel link needs no session, only its token.
- **Claim** (2.0.0). Only while the recovery is `available` (`409
  recovery_not_available`; `404 not_found` when `vault_id` and
  `recovery_id` do not name the vault's current recovery). Adds the key
  to `claim_keys` (at most 10; the oldest goes), audits
  `vault.recovery_claim`, answers `user_guid` and `email_hint`. Limits: 10
  per vault per day, 10 per source network per 15 minutes.
- **Recovering key** (2.0.0). When a register slot comes back
  `recovery_registered`, the API records that register's key (the slot's
  `app_kid`) as `recovering_key`, with the `registered` state. It may
  `unlock`, `lock` and read `status` while the recovery is active. When
  the host writes the vault's `app_key` with the same `kid` (the recovery
  completed), the recovery's keys are cleared.
- **`browser_key`**: canonical base64 of an uncompressed P-256 point (65
  bytes, first byte `0x04`), made by the portal with WebCrypto
  (non-extractable private key kept in IndexedDB).
- **Request.** `404 not_found` without an enrolled vault (state
  `enrolling` included); `409 recovery_active` while a recovery is
  `pending` or `available`; `409 deletion_pending` while a start-over
  is pending (2.1.0). **Backup off** (2.1.0): when the vault row's
  `credential_backup` is `false`, `409 recovery_unavailable` with
  `{error, reason: "no_backup"}`, before anything is written, enqueued,
  locked or mailed (the request still counts toward the rate limit);
  the portal says the vault cannot be recovered because its credential
  backup is off, and offers the start-over. With `credential_backup`
  absent the request proceeds and the enclave decides. The API writes the recovery on the vault row,
  creates the response slot (TTL = `expires_at`) and enqueues `recovery`
  (with `browser_key`) to the leaseholder, or to a live instance of the
  vault's `sealed_release` (`503 release_starting` as for the enclave
  route). It emails the member: what happened, when the code becomes
  available, and a single-use cancel link
  (`https://account.vettid.org/vault/recovery/cancel#t=<token>`; the API
  stores only the token's SHA-256, in a request-table row that expires
  with the recovery).
- **Status.** Without an enrolled vault (none, `enrolling` or deleted)
  the answer is `{recovery: null}`, not `404`; likewise for a vault that
  never had a recovery. `available` from `available_at` to `expires_at` while not
  cancelled; `sealed_code` is the slot's envelope, returned only then (and
  absent if the host has not answered yet). The portal decrypts it and
  renders the QR locally.
  The sealed answer may instead be a refusal (`error: "no_credential"`
  or, 2.1.0, `"no_backup"`, VAULT-MESSAGING §11.11.2): the vault cannot
  be recovered. Since 2.1.0 the enclave marks a refusal with the slot's
  clear `code: "recovery_unavailable"`: the API then sets the
  recovery's state to `unavailable` (an ended state, conditional on the
  same `recovery_id`), returns the slot's envelope as `sealed_code`
  at once (not waiting for `available_at`), refuses claim and register
  for it, and audits `vault.recovery_unavailable`. The API notices the
  code as it notices `recovery_registered` (below), on the request's
  own slot. The portal decrypts the refusal and shows it. A refusal
  without the code (a release before 0.16.0) is shown at
  `available_at`, as before.
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
  (`409 recovery_not_available`), signed by one of its claim keys, which
  goes into the queue message as `app_key` (2.0.0). The enclave re-checks the delay, the
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
release approval and `register` are app-only; the site deletes a vault
only by the 24-hour start-over; it never asks for the vault PIN or the
credential password):

- **`/account/#vault`** (a tab of the account page, behind the `/account/`
  cookie gate): `GET /api/vault/status`, loaded when the tab is opened.
  No vault: what is needed (membership, current terms, Android 12+), the
  app link from `/config.json` (`android_app_url`, CDK context
  `androidAppUrl` / `<stage>AndroidAppUrl`; until it is set the page says
  the app is not available yet; staging says to use the VettID Staging
  build), the setup steps as the app shows them, and (2.0.0) **Set up
  your vault**, which leads to the setup page.
- **`/account/vault/setup/`** (gated; 2.0.0): issues a code
  (`POST /api/vault/enroll-code`) when the member presses **Get a setup
  code** (never on page load), and shows it as the §11.12.1 QR (the same
  vendored generator as recovery) and as `XXXX-XXXX` text, with a
  5-minute countdown, **Cancel code** (`DELETE`) and, on a phone, **Open
  in the VettID app** (`https://<account host>/vault/enroll/#s=<QR
  secret>`, an App Link the app claims; never the typed code). The text
  says the typed code must be entered with the account's email. The code is removed from the page on
  `pagehide` and when it is used or expires (the page polls `GET
  /api/vault/enroll-code` every 5 s while live). A reload does not show
  it again: the member gets a new one. Wording: "Only enter this in your
  own VettID app. VettID will never ask you for it." With a vault
  already enrolled the page says so first (a confirmed vault is not
  replaced; use transfer or recovery to move phones).
- **`/vault/enroll/`** (outside the gate; 2.0.0): the App Link target.
  Without the app it removes the fragment from the address bar, offers
  the app's download link, and draws the QR from the secret in the
  fragment (for scanning with another phone). A vault: state,
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
  §11.11.2 QR payload (with `api`, 2.0.0) by the vendored qrcode-generator 2.0.4 (MIT,
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
- **Backup off** (2.1.0): the vault tab says, when `credential_backup`
  is `false`, that the vault cannot be recovered if the phone is lost,
  and links to the start-over. The recovery page shows the API's `409
  recovery_unavailable` (or a decrypted `no_backup` refusal) as "This
  vault cannot be recovered: its credential backup is off. You can
  delete it and start over with a new vault", with the link. The
  0.15.x copy that promised a new credential or a deletion after a
  backup-off recovery is removed.
- **`/account/vault/deletion/`** (gated; 2.1.0): **Delete my vault and
  start over**: what is lost (everything in the vault, for good), the
  typed phrase, the 24 h countdown and **Cancel**, then, once the vault
  is gone, **Set up your vault**. **`/vault/deletion/cancel#t=<token>`**
  (outside the gate) works like the recovery's cancel link.
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
holder with the PIN and the password), by the member's start-over from
the account site (2.1.0, below), or by the member API when an account is
cancelled. 2.1.0 removed the recovering app's deletion (VAULT-MESSAGING
0.16.0). The vault deletes itself:
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
- **Stored versions.** The data bucket keeps noncurrent versions for 7
  days (VAULT-RELEASES §8.2, §11.4): the erased objects, still sealed,
  are gone 7 days after the deletion (VAULT-MESSAGING §12.5).
- **IAM.** The alarm Lambda may delete vault rows and pointer rows
  (conditional) in addition to its alarm updates; the cleanup job may
  send to the vault-control queues as the API does.

### Vault deletion: start over (2.1.0, VAULT-MESSAGING 0.16.0 §11.11.9)

For a member who has lost the phone with the credential backup off (no
recovery exists then), or who does not want to recover: the portal
deletes the vault after 24 hours, and the member then enrolls a new,
empty vault with a setup code. The deletion needs no app, PIN or
credential because it opens and returns nothing; the delay, emails and
cancel stop someone holding the member's session from destroying the
vault at once (owner decision, 2026-10-06).

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/vault/deletion` | `{confirm: "delete my vault"}` | `202 {deletion_id, requested_at, deletes_at}` |
| GET | `/api/vault/deletion` | — | `{deletion: Deletion \| null}` |
| POST | `/api/vault/deletion/cancel` | `{deletion_id}` (portal session, or the vault's app signed by its `app_key`) | `200 {cancelled: boolean}` |
| POST | `/api/vault/deletion/cancel-link` | `{token}` (no session) | `200 {cancelled: boolean}` |

```ts
interface Deletion {
  deletion_id: string;                 // ULID
  state: 'pending' | 'executing' | 'cancelled';
  requested_at: string;                // RFC 3339
  deletes_at: string;                  // requested_at + 24 h
}
```

- **Request.** A session of an active `member` with the current terms.
  `400 bad_request` without the exact phrase; `404 not_found` without a
  confirmed vault (none, `enrolling` or deleted); `409 recovery_active`
  while a recovery is `pending`, `available` or `registered`; `409
  deletion_pending` while one is `pending` or `executing`. Offered
  whatever `credential_backup` says. The API writes `deletion
  {deletion_id, state: pending, requested_at, deletes_at}` on the vault
  row and emails the member: the vault and everything in it will be
  deleted at `deletes_at` and cannot be restored; how to cancel; a
  single-use cancel link
  (`https://account.vettid.org/vault/deletion/cancel#t=<token>`, stored
  as its SHA-256 in a request-table row that expires at `deletes_at`).
  Nothing is enqueued and the vault is not locked.
- **Cancel** (session, link or app): conditional on `state = pending`;
  removes the record, emails the member, answers `{cancelled: true}`;
  otherwise `{cancelled: false}`. The app sees `deletion` (with its
  `deletion_id`, 2.1.1) in `GET /api/vault/status` and offers the
  cancel.
- **Execution.** The cleanup job (every 5 minutes) takes each `pending`
  deletion past `deletes_at`, sets `executing` (conditional) and
  enqueues the operation `delete` exactly as for an account
  cancellation (below; `deletion_requested_at`, retries, the 30-day
  log). The `vault_deleted` notice emails the member and deletes the
  rows; the portal then offers **Set up your vault** (a new setup code).
- **Rate limits:** request 3 per member per day; cancel 30 per member
  per 15 minutes; the link 20 per source network per 15 minutes.
- **Audit:** `vault.deletion_request`, `vault.deletion_cancel` (`via:
  session | link | app`), `vault.deletion_executed`. Never the token.

**Left to the API by the spec, decided here:** the shape of `Enclave`; the
`vault_id` encoding; reuse of `vault_id` on re-enrollment; liveness (90 s
heartbeat) and "dead holder means no live lease"; least-load selection
(`load` in the registry, lower first, then freshest heartbeat); newest
`active` release for enrollment; the `vault_busy` and `vault_unavailable`
answers; `lock` without a live lease; `retry_after` values; the extra rate
limits above; the vault service pause; the `rescue` flag that marks a reopened `removed` release;
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
  API: `recovery {recovery_id, state (pending|registered|cancelled|unavailable),
  requested_at, available_at, expires_at, register_ids?}` (epoch s for
  the times; `available` and `expired` are derived from them);
  `deletion {deletion_id, state (pending|executing), requested_at,
  deletes_at}` (2.1.0). *Host* (2.1.0): `credential_backup` (bool, from
  the vault's lifecycle reports, VAULT-MESSAGING §11.5).
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
