---
title: ENROLLMENT-CODES
status: draft (design note; normative text in VAULT-MESSAGING 0.15.0 §11.12–§11.13 and MEMBER-API 2.0.0)
version: 0.2.2
date: 2026-10-06
changelog:
  - 0.2.2: errata: the setup QR's example payload is 79 bytes, not 78
    (§3.2; still version 5 at level M); related versions
    (VAULT-MESSAGING 0.15.2, MEMBER-API 2.0.1)
  - 0.2.1: approved by the owner 2026-10-06 and renumbered at merge:
    VAULT-MESSAGING 0.15.0 (was 0.11.0; 0.12.0–0.14.0 merged first) and
    MEMBER-API 2.0.0 on top of 1.2.0; staging vaults of S1–S3; how
    enrollment meets the daily owner check and the vault service pause
    (§8)
  - 0.2.0: owner review of PR #122: 5 minutes; a 128-bit QR secret as the
    primary path; the 8-character code only typed with the member's email
    and checked against that member's issuance; 800 typed attempts per
    issuance; no global cap; no account oracle (§3, §7, §9, §10)
  - 0.1.0: first draft
owner: Al Liebl (Mesmer)
related:
  - VAULT-MESSAGING.md (0.15.2)
  - MEMBER-API.md (2.0.1)
  - ANDROID-PLAN.md
classification: public (no secrets; safe for github.com/vettid)
---

# Enrollment codes: the app and the account portal kept apart

## 1. Why

The owner's decision of 2026-10-05:

> "enrolling a vault feels off - i have to go into the app and log into the
> site again? with vettid.dev we used 8 character enrollment codes or qr
> codes to simplify this process. i'd like to keep the app and account
> portal separate. where we want account site information in the app it
> should be routed through the vault"

Follow-ups the same day:

- "code format is good": 8 characters from an unambiguous alphabet,
  single-use, about 15 minutes, rate-limited, also shown as a QR.
- After reviewing the first draft (PR #122), and seeing API probing on
  vettid.org, the owner made it more conservative: 5 minutes; a long
  random secret in the QR as the primary path; the typed code only with
  the member's email, checked against that member's code alone; no
  global brake that one attacker could pull for everyone (§3).
- "membership and subscription status are right": the app shows these,
  read-only. Changes are made on the portal.

Until VAULT-MESSAGING 0.10.7 the app signed in to the member API like a
browser (magic link and PIN, httpOnly cookies, CSRF header), read
`/api/account/me` for the `user_guid` and the terms state, and sent every
alternate-channel request (§11) under that session. The member signed in
twice, once on the portal and once in the app, and the app carried a
copy of the account site's session for as long as it was installed.

## 2. The design in one page

```
Portal (browser, signed in)   Member API                     App                      Enclave
 | "Set up your vault"          |                              |                          |
 |--POST /api/vault/enroll-code->| member, current terms        |                          |
 |<--{secret, code, expires_at}-| store MACs only; 5 min        |                          |
 | show QR {"v":1,"t":"e","api","s"} and XXXX-XXXX               |                          |
 |                              |<--POST enroll/redeem{secret | email+code, app_key} (signed)
 |                              | -> user_guid; spend issuance; |                          |
 |                              | vault_id; pending app key     |                          |
 |                              |--{vault_id, user_guid, email_hint}------------------------>|
 |                              |<--GET /api/vault/enclave (signed)                         |
 |                              |<--POST /api/vault/enroll (signed){envelope}               |
 |                              |--queue{enroll, user_guid, app_key, envelope}------------->|
 |                              |                              |   bind user_guid, app_key;
 |                              |<--lifecycle enrolled{app_key} (host writes the vault row)-|
 |                              | app key confirmed            |                          |
 | email: "a phone set up your vault"                          |                          |
 later: unlock, lock, status, polling: signed by app_key; no cookies anywhere in the app
 account state: API --queue{account} / unlock{account}--> vault --sync.event--> app, desktops
```

1. **The portal issues a code.** A signed-in member who has accepted the
   current terms presses "Set up your vault". The API makes one issuance
   with two secrets: a 128-bit **QR secret** (in the QR and the
   same-device link) and an 8-character **typed code** (for typing, only
   together with the member's email). It stores only MACs and returns
   both once. One live issuance per member; a new one revokes the old;
   5 minutes; redeeming either form spends both.
2. **The app redeems it.** The app makes its **app key** (a hardware-held
   P-256 signing key for the member API, separate from the device
   attestation key of §11.7) and sends `{secret, app_key}` (scanned) or
   `{email, code, app_key}` (typed), signed with that key. The API spends
   the issuance, finds or assigns the member's `vault_id`
   and records the key as the vault's **pending** app key. It answers the
   `vault_id`, the `user_guid` and a masked email, which the app shows
   ("Setting up a vault for m***@example.com").
3. **The app enrolls as before**, except that every request is signed by
   the app key instead of carrying cookies, and the sealed `vault.enroll`
   carries the app key too. The enclave checks that it equals the key in
   the queue message, stores it with the app's unlock key in the sealed
   header and reports it to the host in the `enrolled` lifecycle event.
   The host writes it to the vault row: the key is now the vault's app
   key.
4. **Later calls** (enclave descriptor, unlock, lock, status, request
   polling) are signed by the app key. The API finds the vault by the
   `vault_id` in the signature header, the member by the vault row, and
   applies its usual account checks, rate limits and canary routing. The
   enclave keeps its own authenticators (PIN, unlock-key signature, device
   assertion): the app key adds nothing the API could use against the
   vault.
5. **Account information goes through the vault.** The API puts an
   account snapshot (membership state, terms state, subscription,
   voting rights, a masked email) in every unlock queue message and pushes
   a fresh one to a running vault when it changes. The vault keeps the
   latest, tells its app and desktops with `sync.event{account.changed}`,
   and answers `account.get`. It is display only.
6. **Recovery and transfer change the app key**, and the vault tells the
   host each time: a transfer's new app sends its app key in its
   `hs.init`; a recovering app sends it in the sealed register request.
   When the new app replaces the old one, the vault emits the lifecycle
   event `app_key`, and the old key stops working at the API.

The portal keeps magic link and PIN sign-in, cookies and CSRF for its own
pages (status, lock, recovery requests). The app never signs in.

## 3. The setup code

(Revised 2026-10-05 after the owner's review of PR #122, in view of API
probing seen on vettid.org: 5 minutes instead of 15, and no global brake.
The first draft had a single 8-character code redeemable on its own and a
global cap of 600 failed redemptions an hour; that cap was a heckler's
veto, since anyone could spend it to stop every member's enrollment.)

### 3.1 One issuance, two forms

Each press of "Get a setup code" on the portal makes one **issuance** with
two secrets:

| | QR secret | Typed code |
|---|---|---|
| What | 16 random bytes, 22 characters base64url (128 bits) | 8 symbols of `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31 symbols, no 0, 1, I, L or O; about 39.6 bits) |
| Shown as | the QR, and inside the same-device App Link | `XXXX-XXXX` text under the QR |
| Redeemed with | the secret alone | the member's email address **and** the code |
| Guessable? | no (2^128) | only against that one member's live code, under the per-email ceiling (§3.3) |

- **Lifetime:** 5 minutes from issue, single use, one live issuance per
  member. Redeeming either form spends the issuance, so both die
  together; a new issuance, the portal's "Cancel code" or expiry also
  ends both.
- **Generation:** CSPRNG; the code's symbols by rejection sampling (bytes
  248–255 discarded, the rest mod 31), so they are uniform. vettid.dev
  used `b % 31` and was slightly biased.
- **Input of the typed code:** spaces and hyphens removed, upper-cased;
  any other character outside the alphabet is refused in the app with
  "codes never contain 0, 1, I, L or O" before anything is sent. The
  email is trimmed and lower-cased, as sign-in does.
- **Storage** (`k_code` is a secret HMAC key in SSM SecureString; nothing
  stores either secret in the clear):
  - the issuance row is keyed by `HMAC-SHA-256(k_code, "qr" || 0x00 ||
    secret)`, so a QR redeem is one lookup;
  - the row holds `user_guid`, `code_mac = HMAC-SHA-256(k_code, "code" ||
    0x00 || user_guid || 0x00 || code)`, `expires_at` (also the TTL),
    `state` and the typed-attempt count;
  - the member's pointer row names the live issuance, which is how a new
    issuance or a cancel revokes the old one, and how a typed redeem
    finds it.
  A plain hash of the 39.6-bit code would be reversible by enumeration in
  minutes; with the keyed MAC a table dump or backup without the key is
  useless. Binding `code_mac` to `user_guid` means a code is only ever
  compared with its own member's issuance.

### 3.2 The QR and the same-device link

```json
{"v":1,"t":"e","api":"https://account.vettid.org","s":"<22 chars base64url>"}
```

- Byte mode, error correction M or higher, quiet zone of 4 modules, any
  version: the same rules as the recovery QR (VAULT-MESSAGING §11.11.2).
  The payload is 79 bytes (version 5 at level M, which holds 84).
- `s` is the QR secret. The typed code is not in the QR: the QR does not
  need it, and leaving it out keeps a photographed QR from also giving
  away the typed form.
- `t: "e"` joins the existing types `r` (recovery, §11.11.2) and `p`
  (pairing and transfer, §6.4). One scanner in the app reads all three
  and routes by `t`.
- **`api` is an identifier, never an address.** The app compares it,
  exactly, with the member API origin built into it (production
  `https://account.vettid.org`, staging
  `https://account.staging.vettid.org`, a dev stack its own) and refuses
  a mismatch with a message naming the environment ("This code is for
  VettID Staging"). It never sends anything to a URL taken from a QR.
  vettid.dev's iOS app used the QR's `api_url` as its base URL, so a
  forged QR could point it at any server; that is not repeated.
- The recovery QR gains the same `api` member (§11.11.2), for the same
  reason.

**Same device.** A member who opens the portal on the phone itself cannot
scan the screen. The portal then also offers **Open in the VettID app**,
an Android App Link `https://account.vettid.org/vault/enroll/#s=<secret>`
carrying the **QR secret** (never the short code), in the fragment, which
never reaches a server or a log. The account site already serves
`assetlinks.json`; the app's intent filter moves from `/auth/` to
`/vault/enroll/`. Without the app installed the link opens a portal page
that removes the fragment from the address bar, offers the app download
and draws the same QR from the secret (for another phone). OWNER
DECISION 4.

### 3.3 Guessing

**The QR secret** cannot be guessed (2^128 per issuance). Its redeems are
subject only to the per-network limits below; nothing about it needs a
brake.

**The typed code** is only ever compared with one member's single live
issuance, found from the email the caller typed. There is no shared
space: a guess is a guess against one named member's code, never against
every live code.

| Limit (MEMBER-API) | Value | Purpose |
|---|---|---|
| Redeems per source network (both forms) | 30 per 5 min per IPv4 address (carrier NAT); 10 per 5 min per IPv6 /64 | Cheap probing from one place |
| Typed redeems per (email, source network) | 5 per 5 min | One sender against one member |
| **Typed attempts per issuance** (the per-email ceiling) | **800** | The bound on distributed guessing of one member's code |
| Codes issued | 5 per member per hour, 20 per day; 20 per source network per hour | Bounds the issuances an attacker can exploit |

- **Per issuance:** the chance that 800 guesses find one 5-minute code is
  at most 800 / 31^8 = 800 / 8.53 × 10^11 = **9.4 × 10^-10**, within the
  target of about 10^-9 per window. (A ceiling of 1,000 would give
  1.2 × 10^-9.) The count is per issuance, not per clock window, so a
  code that straddles two windows still gets 800 guesses in all.
- **Per member and day:** at most 20 issuances, so at most 1.9 × 10^-8 a
  day even if every one of them is attacked to the ceiling, and the
  member is emailed at the first.
- **Distributed attackers** gain nothing beyond the ceiling: 800 is
  total across all sources. Per-network limits only slow the cheap case.
- **No global brake** anywhere. An attacker who floods one member's
  typed entry stops **that member's typed entry for that one code**
  (blast radius: one member, at most 5 minutes, typed path only). The
  member's QR, its App Link and every other member are unaffected.
- **When the ceiling is reached** the issuance is marked `typed_blocked`:
  every further typed attempt for it gets the same failure answer as
  any other (below); a QR redeem of the same issuance still works. The
  API raises the operations alert `MemberEnrollTypedCeiling` and emails
  the member ("Someone tried many wrong codes for your account; scan the
  QR instead, or get a new code"). The portal page shows the same.
- **No account-existence oracle.** A wrong email, an email with no live
  issuance, a wrong code, an expired, used, revoked or blocked issuance,
  and a non-member all get the same `404 invalid_code`, with the same
  work done (a member lookup, a MAC computed and compared against the
  stored `code_mac` or a dummy one) and the answer held until at least
  250 ms after receipt so that timing is flat to within network jitter.
  The per-(email, network) limit counts attempts for every email,
  existing or not, so its `429` reveals nothing either. Attempts against
  an email with no live issuance are counted on a per-email,
  per-5-minute counter that behaves the same way but protects nothing.
- **What a hit gains:** an empty vault enrolled into the member's account
  (§7, "stolen code"). Never access to an existing vault: a confirmed
  vault is never replaced (VAULT-MESSAGING §11.3), and unlocking needs
  an unlock key, a device assertion and the PIN.

## 4. The app key

### 4.1 Why a new key

The app needs something the API can verify on every request, without a
session:

- **The device attestation key (§11.7)** was the obvious candidate, and is
  rejected: its certificate chain and serials are stable hardware-linked
  data, which 0.4 deliberately kept inside the enclave ("the member API
  sees none of it", §11.7). Showing its public key to the API on every
  request would make it a device identifier at the API.
- **A bearer credential** (a random token minted at enrollment) is simpler
  but is a copyable secret on the phone and in the API's tables.
- **A per-app P-256 signing key** (the **app key**) is generated by the app
  for one vault, held in Android Keystore (StrongBox if present, TEE
  otherwise; non-exportable; no user authentication, so background lock
  and polling work) or the iOS Secure Enclave. It identifies nothing but
  "this vault's app", which the API already knows from `vault_id`. The API
  holds only its public key; a dump of the API's tables can sign nothing.
  P-256 because every Android 12+ Keystore and StrongBox supports it (Ed25519
  needs API 33 and is not in StrongBox).

### 4.2 Signing requests

Every app request to `/api/vault/*` carries one header:

```
X-VettID-App: v=1; vault=<vault_id or empty>; kid=<akid>; ts=<unix s>; nonce=<b64url 16 B>; sig=<b64url DER ECDSA>
```

over the string (each `\n` a literal newline, no trailing newline)

```
"vettid/member-api/app/1" \n METHOD \n path \n query \n vault_id \n akid \n ts \n nonce \n hex(SHA-256(body))
```

- `akid` = the first 16 bytes of SHA-256(SPKI DER of the app key), 32
  lowercase hex.
- `ts` within 300 s of the API's clock; `nonce` single-use for 600 s (a
  conditional put in the rate-limit table), so a captured request cannot
  be replayed even within its window.
- Not `Authorization`: CloudFront cannot forward `Authorization` through
  an origin request policy (only through a cache policy, and `/api/*`
  disables caching), so the account site's distribution adds
  `X-VettID-App` to its forwarded headers.
- A request with `X-VettID-App` is authenticated by it alone: cookies are
  ignored and CSRF does not apply (no browser can send the header
  cross-site without CORS, which the API never grants).

### 4.3 Which key may do what

The vault row holds up to three kinds of key (MEMBER-API "App keys"):

| Key | Written by | When | May call |
|---|---|---|---|
| `app_key` | the enclave host, from the vault's lifecycle events | `enrolled`, `unlocked`, `locked`, `app_key` (§11.5), highest `app_key_seq` wins | `enclave`, `unlock`, `lock`, `status`, its own `requests/{id}` |
| `app_key_pending` | the API, at redeem | 1 hour | `enclave`, `enroll`, its own `requests/{id}` |
| recovery claim keys (≤ 10), then the recovering key | the API, at `recovery/claim`; the key of the register request the enclave accepted (`recovery_registered`) | while the recovery is active | claim keys: `enclave`, `recovery/register`, own `requests/{id}`; the recovering key also `unlock`, `lock`, `status` |

The **enclave is the source of truth** for `app_key`: the host writes the
key the enclave reports, so the API's view follows enrollment, transfer
and recovery without the API seeing the relay. The API's own records
(pending, claim keys) only open the doors that lead to the enclave, which
then decides.

### 4.4 Rotation and revocation

- **Transfer (§6.7.1).** The new phone makes its own app key and sends it
  in its `hs.init` (`api_key`). The approval's flush makes it the app's
  key, and the vault emits `app_key`; the host writes it; the old phone's
  key is refused from then on (`401 unauthorized`), and the old app
  already learns of its removal from `device.unlinked`.
- **Recovery (§11.11).** The new phone claims the recovery with its key,
  registers with it, and unlocks with it while the recovery is
  `registered`. When `credential.recover` or `credential.reset` makes it
  the app, the vault emits `app_key`.
- **Replaced phone without the old one:** recovery, as above. There is no
  portal "revoke the app" button (OWNER DECISION 13): the recovery's
  `recovery_pending` already keeps a thief with the old phone and the PIN
  out for the 24 hours, and the portal session would otherwise gain a way
  to cut the member's own app off.
- **Lost key** (a Keystore wipe): the device attestation key goes with
  it, so the phone could not unlock anyway: recovery.
- **No self-rotation** in 0.15.0. A later `app.key.rotate` over the relay
  would be one more `app_key` event.
- **Ordering and loss.** The sealed header counts app-key changes
  (`app_key_seq`, 1 at enrollment). Every report carries the key and its
  `app_key_seq`, and the parent writes it only if the sequence is higher
  than the row's, whatever the lease (a stale instance can only report an
  older sequence, which changes nothing). `enrolled` always replaces the
  row's key, since a replaced provisional vault starts again at 1.
- **The report travels with the header write.** A change of app key is
  a header write (the new unlock key). The `app_key` event is handed to
  the parent in the same exchange as that header's store request, and the
  parent writes the row right after the store succeeds. So a vault that
  crashes after its flush has still reported its new key; one that
  crashes before it never changed. The `unlocked` and `locked` events also
  repeat the current key. The remaining gap (the parent itself dying
  between the two writes) leaves the new phone unable to reach the API;
  the member then uses recovery. It is availability only, and listed as an
  open risk (VAULT-MESSAGING §15 item 20).

### 4.5 What the API can do with it

Nothing it could not do before. The API verifies app keys; it never holds
a private one. It can refuse, misroute, lie in `status`, and forward
requests of its own making to the enclave, but every enclave operation
that matters still needs what only the app has: the PIN and the unlock
key's signature and device assertion for an unlock (and an approval for a
release update), the recovery code and a fresh attestation for a register,
an attested device for an enrollment. `lock` it could always send (§11.5).
The member API therefore does not gain the ability to impersonate the app
to the vault, and the enclave does not verify app-key signatures: it would
only be checking the API's own bookkeeping.

## 5. Account information through the vault

### 5.1 Push, not pull

Two ways were considered:

- **(a) The API delivers it over the host path** (chosen). A snapshot rides
  in every `unlock` queue message, and the API sends the new queue op
  `account` to a running vault when the member's account changes. The
  enclave gains no egress, the vault needs no credential for the API,
  and nothing new crosses the enclave boundary in the other direction.
- **(b) The enclave fetches it from the API.** It would need an allowlisted
  route to the API, a credential to authenticate as the vault (which
  §13.7 never gives the host a reason to know), and a polling schedule.
  Rejected.

Today there is no way for the host to hand data to a running vault
process (the host-to-enclave frames are queue, lease lost, ping, shutdown
and self-test). The `account` op is the first queue op that reaches a
running vault's process instead of only its header; it takes no lease and
is dropped by a vault that is not running.

### 5.2 The snapshot

```json
{ "v": 1, "as_of": "2026-10-05T12:00:00Z", "email_hint": "m***@example.com",
  "state": "member", "account_status": "active", "deletes_at": null,
  "terms": { "needs_acceptance": false },
  "subscription": { "type_name": "Trial", "status": "trial", "paid": false,
                    "expires_at": "2026-11-04T12:00:00Z" },
  "voting_rights": false }
```

- The fields of MEMBER-API `Me` that the owner named (membership and
  subscription), plus the terms state (so the app can say "accept the
  updated terms on the account site") and `account_status` /
  `deletes_at` (a cancelled account's vault is deleted at the end of the
  grace period; the app should say so).
- **`email_hint`** (first character of the local part, `***`, the domain)
  lets the app show which account the vault belongs to. It is what makes
  a reversed phishing attack visible (§7). No name, no full email, no
  `user_guid`.
- **Freshness:** at least as fresh as the last unlock; changes made while
  the vault runs arrive within seconds (queue latency). A trial's expiry
  happens by time: the app shows `expired` once `expires_at` has passed.
  A new terms version changes `needs_acceptance` for every member at once;
  the API does not fan out to every running vault: each vault learns it at
  its next unlock (OWNER DECISION 9).
- **Integrity:** none beyond the host path. The snapshot is VettID's own
  data about the member, VettID is the authority on it, and nothing in the
  vault depends on it. A dishonest host can show a wrong membership in the
  app; it could equally refuse service.

### 5.3 In the vault

- The vault keeps the latest snapshot in its DEK state (never in the
  sealed header; a locked vault has none to give), ignores one whose
  `as_of` is not newer than the stored one (the host may reorder), and
  refuses a malformed one or one over 2 KiB.
- On a change it sends `sync.event{kind: "account.changed", version}` to
  the app and desktops (not agents). Devices fetch it with `account.get`.
- Display only. The vault makes no decision from it; membership and terms
  are enforced by the API (MEMBER-API "Access").

### 5.4 §13.7

"A vault reports only to its owner" stays true and gains two lines: the
snapshot is inbound from the host and goes only to the owner's app and
desktops; and the vault reports one more thing to its host, its app's
API public key (`enrolled`, `unlocked`, `locked`, `app_key`). That key is not a
device identifier (it exists for this vault only), and the host learns
from its changes that a transfer or recovery completed, which it could
already infer from the next unlock.

## 6. What changes elsewhere

| Piece | Becomes |
|---|---|
| App sign-in (email, magic link, account PIN), `SignInLink`, `SessionCookieJar`, `/api/account/me` in the app | Removed. The app's onboarding starts at "Scan or type your setup code". |
| The `account.vettid.org/auth/` App Link | Removed from the app; links open the portal in the browser. The account site keeps serving `assetlinks.json` for `/vault/enroll/` (OWNER DECISION 4). |
| "Sign out of this device" in the app's avatar sheet | Removed; "Account site" opens the browser. |
| Portal sign-in (magic link + PIN), cookies, CSRF | Unchanged. |
| `enclave`, `enroll`, `unlock`, recovery `register` | App key only; cookies no longer accepted (MEMBER-API 2.0.0). A portal session can no longer even submit an unlock (§11.6). |
| `status`, `lock`, `requests/{id}` | Either: the portal with its session, the app with its key. |
| Recovery request, status, cancel, cancel link | Portal only, unchanged. |
| Canary routing | Unchanged in effect: the member is found from the code (redeem) or the vault row (later calls), and `vault_canary` is read from the member row as today. |
| Terms | Required when the portal **issues** a code (and at redeem the account must still be an active member). After that the vault keeps working when terms change: the portal asks for acceptance, and the app shows `needs_acceptance` from the snapshot (OWNER DECISION 7). |
| Account cancellation | Unchanged: every route but `lock` is refused at once, and the vault is deleted after 7 days; the snapshot tells the app `deletes_at`. |

## 7. Threats

| Threat | What it gives | Mitigation |
|---|---|---|
| **Stolen setup code** (photo of the QR or the code, screenshot sync, a shared screen) | Within 5 minutes, before the member uses it (the typed code also needs the member's email, which a photo of the portal page may show): an empty vault enrolled into the member's account, with an attacker's PIN and phone. Its account snapshot shows the attacker the member's masked email, membership and subscription. Never access to an existing vault (a confirmed vault is not replaced). | Single use; 5 minutes; one live issuance; the portal shows the code only when asked and hides it on leaving the page; the member's own redeem then fails "code already used", the portal shows the code as used, and the member is emailed at every redemption. Remedy: support deletes the vault with the host `delete` op (OWNER DECISION 11). |
| **Shoulder-surfed QR** | As a stolen code. | As above; the QR is large only while the member holds the "Show" control (as recovery does). |
| **Phishing a code** ("support needs your setup code") | As a stolen code. | Portal wording: "Only type this into your own VettID app. VettID will never ask for it." The redemption email. |
| **Reverse phishing** (the attacker gives the member a code of the attacker's own account) | The member's new vault belongs to the attacker's account: the attacker could later request a recovery from their portal. The data stays the member's (PIN, credential password), and a recovery still needs both, after 24 h in which the member's app sees `vault.locking{recovery}` and `recovery_pending`. | The app shows `email_hint` before enrolling ("Setting up a vault for m***@example.com") and in Settings from the snapshot. |
| **Guessing the QR secret** | Nothing: 128 bits, 5 minutes. | Per-network limits only. |
| **Guessing a member's typed code** (distributed, targeted: the attacker knows the email) | At most 800 guesses per issuance across all sources: 9.4 × 10⁻¹⁰ per issuance, at most 1.9 × 10⁻⁸ a day per member (§3.3). | The per-issuance ceiling; per-(email, network) and per-network limits. |
| **Flooding one member's typed entry** (to stop them enrolling) | That member cannot use the typed code of that issuance (at most 5 minutes). Blast radius: one member's typed path. The QR, the App Link and every other member keep working; there is no global brake to pull. | The alert `MemberEnrollTypedCeiling`; the member is emailed and told to scan the QR. |
| **Probing for accounts** through typed redeem | Nothing: wrong email, wrong code, expired or blocked issuance all answer `404 invalid_code` with flat timing; limits count non-existent emails like real ones (§3.3). | — |
| **A malicious member API** | What it had: refuse, misroute, lie about status and account, bind a new enrollment to any member (it is the membership authority), issue codes for anyone, see request timing. New: it sees app public keys and when they change (a transfer or recovery completed). | Unchanged enclave checks (§4.5): it cannot unlock, register, approve, or forge an app's request to the vault. |
| **A compromised portal session** | Issue a code (useful only for an account without a confirmed vault), request a recovery (24 h, cancellable, as before), lock, read status, cancel codes. It can no longer submit an unlock attempt: before 0.15.0 it could (it still needed the unlock key and the attestation, so it learned nothing). | The redemption email; recovery emails as before. |
| **A stolen phone** | As before: the thief has the app key, the unlock key and the attestation key, and needs the PIN. | Recovery (`recovery_pending` from the request on; the old key is revoked when the recovery completes). |
| **A replayed app request** | Nothing: `ts` window and single-use nonce; POST bodies also carry single-use `request_id`s. | — |
| **A forged QR `api`** | Nothing: the app never connects to it (§3.2). | — |

## 8. Migration and rollout

Production has no vaults yet; this must be in place before production
release 1. Staging has vaults enrolled under releases S1 to S3 with the
old flow: their sealed headers hold no app key, so a 0.15.0 app cannot
reach them. They are test vaults: they are deleted and re-enrolled
(OWNER DECISION 14), not migrated.

1. **Spec** (this PR) approved.
2. **vettid-vault** 0.15.0: enclave (`app.api_key` in enroll and register,
   `api_key` in a transfer's `hs.init`, key in the header, lifecycle
   `app_key`, queue op `account`, `account` in unlock, `account.get`,
   `sync.event` kind `account.changed`), parent (forward `account`, write
   `app_key`), memberapitest (signed requests, redeem, claim, pending
   keys), vectors. Staging release **S4**.
3. **vettid.org** member API and portal, deployed to staging with both
   auths on the app routes for the switch-over (a staging-only flag,
   never on in production).
4. **vettid-android**: the new onboarding and signed requests; staging
   build against S4.
5. **Staging cut-over:** delete the S1–S3 vaults, re-enroll with codes,
   run the recovery and transfer drills, turn the legacy flag off.
6. **Production:** release 1 built from vettid-vault 0.15.0; the API in
   production never accepts cookies on the app routes.

Releases merged before this one, and what they mean for it:

- **The daily owner check** (VAULT-MESSAGING 0.13.0 §3.6). Enrollment
  starts the owner-check clock, and enrollment by setup code is no
  exception: the clock starts at the enrollment's first
  `credential.create`. While the vault is held, `account.get` is refused
  with `owner_check_required` and `sync.event{account.changed}` waits for
  the check like other fan-out; the queue op `account` is still stored.
- **The vault service pause** (MEMBER-API 1.2.0). While the operator has
  paused the vault service, issuing a code, redeeming one and a recovery
  `claim` are refused with `503 vault_unavailable` like `enroll`, before
  anything is spent, counted or written; reading and revoking a code are
  still served (MEMBER-API "Vault service pause").

## 9. Alternatives not taken

- **Approve on the portal** (after the app redeems, the open portal page
  asks "A phone is using your code: approve?"). Stronger against a stolen
  code, but it brings back the two-sided dance the owner objected to;
  the 5-minute single-use issuance with an email is judged enough.
- **One 8-character code redeemable on its own, with a global cap on
  failed redemptions** (the first draft). Every live code shared one
  guessing space, so only a global cap kept the odds down, and that cap
  let any attacker stop every member's enrollment. Replaced (owner,
  2026-10-05) by the 128-bit QR secret and the email-bound typed code.
- **Keeping a narrow app session** (a refresh token scoped to the vault
  routes). Still a bearer secret, still the account site's session model
  in the app.
- **Enclave-verified app keys.** Adds nothing (§4.5).

## 10. Owner decisions

Each with its recommendation; all are repeated in VAULT-MESSAGING §15 item
20.

1. Alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, 8 symbols (about 39.6
   bits), uniform by rejection sampling. Recommended: yes.
2. **Changed by the owner, 2026-10-05:** 5 minutes (was 15); single use,
   one live issuance per member, shown once, stored only as MACs
   (unchanged).
3. The QR carries the API origin as an identifier the app must match
   exactly, never as an address. Recommended: yes.
4. A same-device App Link `https://account.vettid.org/vault/enroll/#s=…`
   on the portal, carrying the QR secret, never the short code (owner,
   2026-10-05). Recommended: yes.
5. A separate per-app P-256 app key signs app requests, not the device
   attestation key and not a bearer token. Recommended: yes.
6. The enclave is the source of the vault's app key and reports it to the
   host (`enrolled`, `unlocked`, `locked`, `app_key`), a §13.7 amendment.
   Recommended: yes.
7. Unlock no longer requires the current terms; only issuing a code does.
   Recommended: yes.
8. Account information reaches the app only through the vault, as a
   display-only snapshot pushed by the API (with the fields of §5.2,
   `email_hint` included). Recommended: yes.
9. A new terms version reaches running vaults at their next unlock, not
   by a fan-out push. Recommended: yes.
10. The member is emailed at every redemption. Recommended: yes.
11. A vault enrolled with a stolen code is removed by support with the
    host `delete` op; no self-service deletion on the portal in v1.
    Recommended: yes.
12. **Changed by the owner, 2026-10-05: removed.** No global cap or brake
    on redemptions anywhere (it was a heckler's veto); replaced by
    decisions 16–19.
13. No portal button to revoke the app's key. Recommended: no button;
    recovery covers a lost phone.
14. Staging vaults of S1–S3 are deleted and re-enrolled; no compatibility
    path in production. Recommended: yes.
15. The app drops sign-in entirely, including the `/auth/` App Link.
    Recommended: yes.
16. Each issuance has a 128-bit QR secret (22 characters base64url), the
    primary path, redeemable alone and limited only per network.
    Recommended: yes.
17. The typed fallback needs the member's email and the 8-character code,
    compared only with that member's live issuance (a MAC bound to the
    `user_guid`). Recommended: yes.
18. A ceiling of 800 typed attempts per issuance (9.4 × 10⁻¹⁰ per
    issuance), plus 5 per (email, network) and the per-network limits;
    reaching it blocks only that issuance's typed entry, raises an alert
    and emails the member, and the QR still works. Recommended: yes.
19. No account-existence oracle: one `404 invalid_code` for every typed
    failure, the same work done, the answer held to at least 250 ms.
    Recommended: yes.
