---
title: ACCOUNT-ADMIN-PLAN
status: accepted — decisions recorded in §9
version: 0.3.0
changelog:
  - 0.3.0: owner decisions of 2026-11-03 (§9 7): **deleting a VettID
    account** (§5.4), for the apps' "Delete my account" (Apple App Store
    rule 5.1.1(v)). The member's own deletion replaces the cancel: it
    is refused while the member has a vault, confirmed by an email code,
    carried out 7 days later, and can be cancelled from a link in the
    email; the mailing list entry goes too if the member leaves the box
    ticked. An account deletion no longer asks a vault to delete itself.
    With MEMBER-API 2.14.0
  - 0.2.2: owner decision 2026-10-26 (VAULT-MESSAGING 0.64.0 §1.1):
    governance voting is planned in the member vault with a service
    vault, specified later; §1 and §9 3a note it
  - 0.2.1: owner decisions of 2026-10-03: invite codes are now called
    registration codes, good for 2 uses by default (API names unchanged);
    paid members are the voting members and governance voting is upcoming
    (§5.1, §9 3a)
  - 0.2.0: decisions recorded; simplified membership lifecycle; magic link + PIN
    kept and fixed; subscriptions kept (free trial); SES sandbox opt-in
  - 0.1.0: initial draft
date: 2026-11-03
owner: Al Liebl (Mesmer)
component: vettid.org CDK — auth, account site, admin site
related:
  - MEMBER-API.md (2.14.0)
  - RELAY-PLAN.md
  - RELAY-PROTOCOL.md
  - PUSH-GATEWAY.md
  - CALLING-SERVICE.md
  - PQC-MIGRATION.md
  - RUNBOOK.md
---

# account.vettid.org + admin.vettid.org — Port Plan

## 1. Goal and scope

Stand up the member account site at **account.vettid.org** and a dramatically
simplified admin site at **admin.vettid.org** (reachable only over the
Headscale/Tailscale tailnet), in the vettid.org repo, from the vettid-dev code
base — with a CDK layout that stays manageable as relay, push gateway, calling,
and vault stacks arrive later.

**In scope:** member auth (magic link + PIN, fixed), the membership lifecycle
(§5.1), membership terms, free-trial subscriptions, profile/preferences,
suspend/cancel/delete; admin request queue, members, registration codes, terms,
subscription types, admins, audit; the private-access network path.

**Out of scope here (later phases, own plans):** everything under `/vault/*`
(waits on the relay per RELAY-PLAN Phase 5), NATS (deleted, never ported),
governance voting/proposals (the *voting-rights* rule is modeled now, §5.1:
paid members are the voting members; governance voting for them is coming
soon; owner decision 2026-10-26: in the member vault with a service
vault, specified later in VAULT-MESSAGING), payments, services registry, vault
broadcasts/metrics, help offers, bulk email. Fresh users — no data migration from the archive.

## 2. What the review found

Three parallel reviews covered the account site, the admin site, and CDK
structure in both repos. Headlines:

- **The frontends are thin; the backend was not.** vettid-dev was ~11.3k lines
  of CDK across 11 stacks, 248 Lambdas (one function per route ≈ 7 CFN
  resources each → ~1,700 resources), which forced splitting stacks by
  *resource count* rather than by domain ("split to stay under the 500 limit").
  One shared HttpApi + authorizers was referenced from 5 stacks → export locks.
  Cognito pools were `RemovalPolicy.DESTROY`. Frontends deployed outside CDK via
  a `sed` script.
- **Account splits cleanly.** Every `/account/*`, `/auth/*`, `/register`
  endpoint is plain Lambda + DynamoDB + Cognito (+ SES/S3). Nothing in it needs
  NATS or the enclave. About half of `account.js` (4,871 lines) is vault UI that
  is deferred.
- **Admin shrinks to ~4 sections.** Of ~17 UI areas, the ones a fresh
  deployment actually needs are: registrations queue, members, registration codes, admins +
  audit. The rest is vault/NATS-coupled, governance, or nice-to-have.
- **The existing code carries real bugs we must not port.** Highlights (full
  list in §8): sign-out never clears the refresh cookie (silent re-login); PIN
  lockout silently fails open (wrong key prefix vs. IAM condition, missing env);
  PINs are unsalted SHA-256; `tokenExchange` writes unverified client input into
  `Set-Cookie`; any admin can self-escalate via a writable `custom:admin_type`;
  the registration dedupe check is ineffective (`Scan` + `Limit:1` + filter);
  recovery QR data was sent to Google's chart API (0-byte local QR lib).

**Conclusion:** port the *flows and API contracts*, rewrite the
*implementation*. Handler logic is reused where sound; the frontends are
rebuilt smaller in Night Watch rather than restyled 5k-line files.

## 3. CDK architecture

### 3.1 Principles

1. **Existing stacks are untouched.** `VettidOrgDnsStack`, `VettidOrgStack`,
   `VettidOrgSignupStack`, `VettidOrgPlaybooksStack`, `VettidDevRedirectStack`
   keep their IDs and logical IDs (moving web-stack resources into constructs
   would re-create named buckets and fail).
2. **Split by domain and change rate, not by resource count.** Stateful stacks
   (pools, tables) rarely deploy and are RETAIN + deletion-protected. Stateless
   stacks (APIs, sites) deploy freely.
3. **Route groups, not function-per-route.** One Lambda per route group
   (`ANY /api/account/{proxy+}` with a small in-handler router). An API stack is
   ~40–60 resources instead of hundreds.
4. **No cross-stack exports between stateful and stateless.** Stateful stacks
   write IDs to SSM (`/vettid-org/<stage>/auth/member-pool-id`, …); tables use fixed
   names (`vettid-org-*`). Consumers read SSM / `Table.fromTableName`. Props stay
   only for the stable hosted zone.
5. **Config is generated by CDK.** `config.js` for each site is emitted in the
   `BucketDeployment` via `Source.jsonData`/`Source.data` with pool/client IDs
   as tokens. No `sed`, no placeholders.
6. **Guardrails in CI.** A jest test fails if any stack template exceeds 200
   resources; `lib/` files aim for ≤ 400 lines (logic goes into constructs).

### 3.2 Target stacks

| Stack | Kind | Contents | Deploys |
|---|---|---|---|
| `VettidOrgAuthStack` | stateful | Member pool + admin pool (RETAIN + deletionProtection), groups, app clients, admin hosted-UI domain, PIN pepper, SES (vettid.org domain identity) for Cognito email | rarely |
| `VettidOrgDataStack` | stateful | DynamoDB tables (§3.4), terms PDF bucket; all RETAIN + PITR + deletionProtection | rarely |
| `VettidOrgAdminAccessStack` | stateful-ish | Small VPC (1 public subnet, no NAT), t4g.nano Tailscale node joined to Headscale as exit node, Elastic IP (retained), SSM-only management (no SSH), pre-auth key from Secrets Manager; the admin-site CloudFront WAF allowlist | rarely |
| `VettidOrgMemberApiStack` | stateless | HttpApi + route-group Lambdas (`auth`, `register`, `account`, `membership`) + scheduled jobs (account cleanup) + registration stream mailer; JWT verified in-handler with `aws-jwt-verify` | often |
| `VettidOrgAccountSiteStack` | stateless | Bucket, cert, CloudFront at account.vettid.org, `/api/*` → member API **same-origin** (the signup pattern: no CORS, host-only `SameSite=Strict` cookies), CSP `script-src 'self'`, generated config | often |
| `VettidOrgAdminApiStack` | stateless | Regional REST API at `admin-api.vettid.org`, resource policy `aws:SourceIp = <exit-node EIP>`, Cognito admin-pool authorizer, ~3 route-group Lambdas | often |
| `VettidOrgAdminSiteStack` | stateless | Bucket, cert, CloudFront at admin.vettid.org, WAF IPSet allowlist (EIP), generated config, CSP `'self'` only | sometimes |
| *later* `VettidOrgRelayStack` | — | `vettid-relay` binary (Fargate or single instance + EBS for SQLite) per RELAY-PLAN Phase 5 | — |
| *later* `VettidOrgPushStack` | — | Push gateway; APNs/FCM creds in Secrets Manager, isolated | — |
| *later* `VettidOrgCallingStack` | — | coturn + sidecar construct per CALLING-SERVICE §4 | — |
| *later* `VettidOrgVaultStack` | — | Nitro/vault, rewritten for the relay (no NATS port) | — |

Future stacks consume auth/data via SSM only, never props from the API stacks.

### 3.3 Repo layout

```
lib/
  config.ts                 # typed stage (default prod; suffix names only when ≠ prod)
  constructs/
    api-function.ts         # NodejsFunction defaults: node22, ARM64, minify+sourcemap,
                            #   @aws-sdk/* external, explicit LogGroup (1 mo), shared env
    route-group.ts          # api + prefix + entry + grants → one fn + one {proxy+} route
    static-site.ts          # bucket, OAC, cert, records, headers policy, deploy + config
    ssm-refs.ts             # typed read/write of /vettid-org/* parameters
  stacks/                   # existing + new stacks, one file each
lambda/
  shared/                   # ported + trimmed common/util (http, audit, rate limit, jwt)
  member/<group>.ts
  admin/<group>.ts
  signup/                   # existing, untouched
sites/
  account/                  # new account frontend (Night Watch)
  admin/                    # new admin frontend
website/                    # existing public site, untouched
```

Adds `esbuild` as a devDependency. Stack IDs `VettidOrg<Thing>Stack`; physical
names `vettid-org-<thing>`. No staging environment now; if one is ever needed it
goes in a separate AWS account under `staging.vettid.org`.

### 3.4 Data model (fresh)

Fewer, purpose-clear tables instead of vettid-dev's 37:

| Table | Holds | Notes |
|---|---|---|
| `vettid-org-members` | lifecycle state (§5.1), account status, terms acceptance, PIN hash, preferences | PK `user_guid`; GSIs `email`, `state`; stream → mailer |
| `vettid-org-invites` | registration codes (formerly invite codes), uses, expiry | a valid code = auto-registration; table and API names keep "invite" |
| `vettid-org-subscriptions` | subscription per member + subscription types | `has_used_trial` kept on the member row so a trial can't be re-taken |
| `vettid-org-terms` | membership terms versions | PDF in `vettid-org-terms` bucket |
| `vettid-org-audit` | append-only admin + security events | writers get PutItem only; actor passed explicitly |
| `vettid-org-ratelimits` | rate-limit + PIN-lockout counters with TTL | split out of audit (old design mixed them) |
| `vettid-org-magic-links` | single-use magic-link tokens, 15-min TTL | GSI on email for rate limiting (no scans) |
| `vettid-org-mailing-list` | **existing** | replaces vettid-dev's waitlist table |

Preferences move out of the audit table.

## 4. Admin private access (Headscale/Tailscale)

```
admin laptop/phone ──WireGuard (tailnet)──▶ AWS exit node (EIP) ──▶ admin.vettid.org (CloudFront)
     (Headscale-coordinated)                                    ├─▶ admin-api.vettid.org (REST API)
                                                                └─▶ admin managed login (Cognito)
```

- **Exit node in AWS** (`VettidOrgAdminAccessStack`): t4g.nano, Elastic IP,
  Tailscale joined to your Headscale with `--advertise-exit-node`; approve the
  route in Headscale. Pre-auth key lives in Secrets Manager; instance managed
  by SSM Session Manager only (no inbound ports at all — Tailscale is
  outbound-initiated). Unattended security updates on.
- **Two locks, both keyed to the EIP:**
  1. Admin site: WAF IPSet rule on the admin distribution (change the IP
     without a redeploy).
  2. Admin API: REST API resource policy `aws:SourceIp`. (HttpApi can't take
     WAF or a resource policy and its `execute-api` URL is always public —
     hence REST, called directly with CORS.)

  *Dropped on first deploy:* a regional WAF on the admin user pool. The
  classic hosted UI makes some calls (first-login "set new password") from
  Cognito's own servers, so an IP allowlist there blocks legitimate
  sign-ins. The login relies on MFA; its tokens only work through the two
  locks above.
- **Plus identity:** admin pool with TOTP MFA required, single `admin` group,
  no user-writable attributes, PKCE + verified `state`, tokens in memory only.
- **Usage:** turn on the "aws-admin" exit node in the Tailscale client → admin
  works; off → 403 everywhere. Only while the exit node is on does other
  traffic route via AWS.
- **Multiple admins:** every admin joins the tailnet (Headscale user + device)
  and uses the same exit node; access is revoked by removing their Headscale
  node *and* disabling their Cognito admin user. Each admin has their own
  Cognito identity and TOTP, so the audit log attributes every action.
- **Rejected:** fully private VPC endpoint + internal ALB + split DNS (~$30+/mo,
  private certs, more to patch) — revisit only if "no public endpoint at all"
  becomes a requirement. AWS Client VPN (~$75+/mo) — you already run Headscale.

## 5. Member account site

### 5.1 Membership lifecycle (simplified)

One form — **Request early access** (called "Request membership" until 2026-10) — replaces vettid-dev's separate Register and
Waitlist tabs. The registration code (formerly "invite code"; good for 2
uses by default) is an optional field on it.

```
request membership ──(no code)──▶ REQUESTED ──admin approves──▶ REGISTERED
        │                            └─admin rejects──▶ (closed)      │
        └──(valid code)──────────────────────────────────▶ REGISTERED │
                                                                       ▼
                                          accept current terms ──▶ MEMBER
                                                                       │
                     subscription (trial now, paid later) ─────────────┤
                                                                       ▼
                                   MEMBER + active *paid* subscription = voting rights
```

| State | Means | Account site access |
|---|---|---|
| `requested` | flagged in the admin queue; no Cognito user yet | none |
| `registered` | Cognito user exists (group `registered`) | yes — profile, terms, preferences |
| `member` | accepted the current terms (group `member`) | yes — plus subscriptions |

Orthogonal to the lifecycle:

- **Subscription:** `none` / `trial` / `active` / `expired`. Free-trial
  subscription types to start; payment is a later phase.
  `voting_rights = state == member && subscription == active && type.paid`
  — computed in one shared function so governance voting and the admin UI
  agree. Paid members are the voting members; a free trial does **not**
  grant voting (§9 3a). Governance voting itself is upcoming.
- **Account status:** `active` / `suspended` / `canceled` → deleted.
  *Suspend* (admin) disables the Cognito user and blocks sign-in, reversible.
  *Delete my account* (member, §5.4; 0.3.0, it replaces *Cancel*)
  disables immediately and schedules deletion in 7 days, which the member
  can stop from the email's link (or support, by reinstating) until then;
  it is refused while the member has a vault. *Delete* (admin, or the
  daily cleanup job) removes the Cognito user and personal data, keeping
  only an audit stub. The status `canceled` keeps its name: it is an
  account whose deletion is scheduled.

### 5.2 Email under the SES sandbox

No production SES access (decision). As with vettid.dev, the request form
triggers SES identity verification for the applicant's address, and that
verification is the email opt-in. Consequences, designed in rather than
discovered:

- Email consent is **required** on the request form (not an optional box):
  without a verified identity we can't send the magic link.
- The request is stored immediately; admin approval and code-based
  registration proceed regardless, but sign-in emails only go out once the
  address is verified. The request-received page and the admin queue both
  show verification status; admins can trigger a resend.
- Sandbox limits: 200 emails/day, 1/s, 10,000 verified identities per region.
  Fine for launch; the RUNBOOK records them as the trigger for revisiting
  production access.

### 5.3 Site and auth

- **Host:** account.vettid.org; same-origin API at `/api/*`. The apex
  placeholder routes (`/signin`, `/account`, `/register`, `/auth`, `/signout`)
  301 to account.vettid.org; the header "Coming Soon" chip becomes Sign in at
  launch.
- **Auth: magic link + optional PIN, fixed** (Cognito custom auth, three
  triggers kept):
  - Round 1 is the magic link only. The PIN challenge is issued as a
    *second* custom-auth round, only after the link token verifies — so the
    public challenge never reveals whether an address has a PIN.
  - PINs stored as HMAC-SHA-256 with a secret pepper (Secrets Manager) over
    the per-user GUID + PIN; weak-PIN list kept; constant-time compare.
  - Lockout that actually works: counters in `vettid-org-ratelimits` with
    matching grants, TTL-based cooldown, tested in CI (the old one failed
    open silently).
  - Magic-link tokens: 32 random bytes, stored hashed, single use (marked
    `used_at` atomically), 15-min TTL; sent by an async mailer.
  - PIN enforced server-side for sensitive account actions (PIN change/
    disable, cancel), not by a browser flag.
- **Session model (one model, not three):** refresh token in an httpOnly,
  `Secure`, host-only, `SameSite=Strict` cookie set by the same-origin auth
  route after *server-side* token verification; ID/access tokens in memory only;
  sign-out = clear cookie (HTTP API v2 `cookies` field) + `RevokeToken`.
- **Pages:** Request early access, Sign in, Account (profile, membership/terms,
  subscription, PIN, email preferences, cancel). Vault Services tab omitted
  until the relay phase.
- **Frontend:** plain ES modules, Night Watch tokens, shares
  `website/shared/nav.css` and `/assets/fonts.css` so chrome matches the main
  site. No `innerHTML` with data; no third-party script or font loads.

### 5.4 Deleting a VettID account (0.3.0)

A member deletes their **VettID account**: the membership, the sign-in,
the address and everything the account system holds about them. This is
not the deletion of their **vault**, which has its own authorities and
lifecycle (VAULT-MESSAGING §12.5; MEMBER-API "Vault deletion" and "Vault
deletion: start over"). Recovery, transfer, a service vault's admin
roles, votes and connections all live in the vault, so "vault first"
covers them: they go with the vault, never with the account. Published
votes (the results on the site and in Rekor) are not account data and
stay. The apps' "Delete my account" (App Store rule
5.1.1(v); IOS-PLAN, ANDROID-PLAN) opens the page of this section.

**Owner decisions of 2026-11-03** (§9 7):
1. **Vault first.** An account deletion is refused while the member has
   a vault. The member deletes the vault first: in the app (the holder's
   `vault.delete`, with the PIN and the password) or on the account site
   with "Delete my vault and start over" (24 hours). An account deletion
   never asks a vault to delete itself.
2. **7 days, and a cancel link.** The account is disabled at once and
   deleted 7 days later. The confirmation email carries a link that
   cancels the deletion until then; support can also cancel it (an
   admin's reinstate).
3. **The mailing list: asked, ticked by default.** The page has a box
   "Also remove me from the VettID mailing list", ticked; with it ticked
   the address's mailing-list entry is deleted with the account.

#### 5.4.1 Who can delete, and what blocks it

- **Who.** A signed-in account (`registered` or `member`) whose
  `account_status` is `active`. A suspended account cannot sign in, so
  it cannot delete itself; its member asks support. A membership request that is not an account
  yet is removed with its withdrawal link (MEMBER-API "Withdrawing a
  request").
- **A vault blocks it.** A vault counts if its row is not `deleted`,
  whatever its other state (`locked`, `unlocked`, `enrolling`), and
  also while its deletion has been asked for and not yet reported (a
  start-over that is `pending` or `executing`, or a vault deleting
  itself). This is the check an admin's Delete makes (ADMIN-API
  "People", the member API's `member_vaults` task; the account function
  invokes the same function, since the vault tables are in the vault
  account and it holds no right on them), with one
  difference: a row that was **never sealed**, in MEMBER-API's sense
  (no `sealed_release` **and** no lease: a setup that never reached an
  instance's report, so no app holds anything of it; MEMBER-API "Vault
  deletion", Never-sealed rows), does not block. A row with a lease and
  no release is an enrollment under way, and it blocks, whether its
  lease has expired or not: an expired lease does not prove that no
  instance will still report `enrolled`. A start-over cannot remove such
  a row (it needs a confirmed vault), so the member finishes the setup
  in the app or asks support, and the page says so (5.4.6); the RUNBOOK
  ("Account deletions held") says how the operator ends a setup that was
  abandoned. Any failed read fails the check: "no vault" is never taken
  from an error.
- **Checked three times.** When the code is asked for (so that no code
  is sent for a deletion that cannot go ahead), when the deletion is
  confirmed, and by the cleanup job before it deletes anything
  (5.4.3). A canceled account cannot start or finish an enrollment
  (`/api/vault/enroll` and the setup-code redeem need an active
  account), so a vault can appear after the request only from a setup
  already in flight, which the job's conditional deletes catch.

#### 5.4.2 Confirming: phrase, PIN, email code

The session (a magic link, maybe followed by the PIN, §5.3) can be old,
or a browser left signed in. So the deletion asks for proof that is
fresh and comes from the address:

1. The member types the phrase **`delete my account`** (exact, as
   `delete my vault` for the start-over).
2. If a PIN is set, the PIN, checked as for every sensitive account
   action (§5.3; its lockout applies).
3. An **email code**: 6 digits, sent to the account's address when the
   member asks for it, valid **15 minutes**, at most **5 attempts**,
   single use. A new code replaces the old one. Stored only as an
   HMAC-SHA-256 under the PIN pepper over a purpose label, the
   `user_guid`, the code's id and the code (`"acctdel-code" || 0x00 ||
   …`, so that it can never equal a PIN's HMAC), on the member row with
   its expiry and attempt count; a wrong code spends an attempt with a
   conditional update, so two guesses cannot share one. At most **3
   codes an hour** per account, and the per-address mail limits of
   sign-in apply too. With the session and the PIN in front of it, that
   is at most about 15 guesses an hour, at one in a million each.

The order of checks when the deletion is confirmed: the session and
`active`, the phrase, the PIN, the code, then the vault check. A correct
code is spent when it is checked, even if the vault check then refuses:
the member asks for a new one. A failure changes nothing else.

#### 5.4.3 What happens, and when

| When | What |
|---|---|
| **The request** (the member confirms) | One conditional write (still `active`) records on the member row `account_status: canceled`, `delete_after` (now + 7 days) and `account_deletion {deletion_id, requested_at, deletes_at, mailing_list: "remove" \| "keep"}`, to which the mailer later adds `cancel_hash`, `mail_claimed_at` and `mailed_at`. Every field of the deletion is inside this one map, tied to its `deletion_id`, so whatever removes the deletion (the cancel link, a reinstate, the job) removes them all, and a later deletion starts clean. Then sign-in is disabled and every session ended (Cognito `AdminDisableUser`, `AdminUserGlobalSignOut`), and this browser's cookies are cleared. Nothing is deleted. If disabling sign-in or ending the sessions fails after the write, the answer is `500` with the account already `canceled`: a session still alive is refused by every route that needs an active account (`403`; only the vault's lock and the two vault cancels answer a canceled account, and they only keep things as they are), and a repeat of the request from such a session is refused the same way, so the **cleanup job finishes it**: each daily run disables sign-in and ends the sessions again for every `canceled` account it reads, before anything else (the cleanup job's role gains `AdminDisableUser` and `AdminUserGlobalSignOut` for it). |
| **The confirmation email** | Sent by the members-stream mailer from the row's change, as the request emails are (MEMBER-API "Request emails"). The mailer mints the cancel link's token (5.4.4) and claims the send in one conditional write: `account_deletion.cancel_hash` (the secret's SHA-256) and `account_deletion.mail_claimed_at`, only if the row is still `canceled` with this `account_deletion.deletion_id` and has no claim; so a retry or a second record cannot send twice, and the token exists in the email alone. It writes **`account_deletion.mailed_at` only after SES has accepted the message**. A failed send takes the claim and the hash off again, is logged by error name and counted (`AccountDeletionMailFailures`, alarmed), and the record is failed so that the stream retries it. A function that stops between the claim and the send leaves the claim without `account_deletion.mailed_at`: nothing sends again by itself. The cleanup job never deletes an account without `account_deletion.mailed_at`: it holds it (reason `mail`, alarmed), and the operator reinstates it and tells the member to ask again (RUNBOOK). So the member always has the cancel link before anything is deleted. |
| **Until the account is deleted** | The account can't sign in. The cancel link, or an admin's reinstate, puts everything back as it was: sign-in enabled, `account_status: active`, the deletion record removed; the member is emailed. The link works until the cleanup job has deleted the account, not only until `deletes_at`: the job's guard and the cancel's condition are on the same row, so exactly one of them wins. |
| **The first daily run at or after `deletes_at`** (07:00 UTC, so 7 to 8 days after the request) | In this order. (1) The member's vaults are read again; with one that blocks (5.4.1), the account is **held**. (2) Without `account_deletion.mailed_at`, it is **held**. (Before (1), every run disables sign-in and ends the sessions again for each `canceled` account it reads, so that a request whose Cognito steps failed is finished.) (3) The never-sealed vault rows are deleted, each conditional on still having no `sealed_release` and no lease; if a condition fails, the rest waits and the account is **held**. (The host's `enrolled` update must not recreate a row deleted here: the code PR checks that it is conditional on the row existing, VAULT-HOST-PROTOCOL, and opens a vettid-vault issue if it is not; until then such a row is a vault without a member, which the sweep for those marks and alarms on, MEMBER-API 2.6.5.) (4) The member row (with its cancel link's hash) and its email marker go in one transaction under the guard (still `canceled`, past `delete_after`, the same `deletion_id`). (5) Then each on its own, a failure skipping neither the next step nor the next row, as for a canceled account today (MEMBER-API "Retention", "The daily sweeps"): the sign-in user (if it is this account's own), the subscription, the pointer row `user#<guid>`, **the mailing-list entry** (5.4.3.1), and the SES identity under the existing rule (kept if the mailing list still uses the address, if the request did not create it, or if the address is the project's own). |
| **Held** | Nothing is deleted; the account stays `canceled` and the cancel link keeps working. Logged by `user_guid` only, audited (`member.deletion_held`, with the reason), counted (`AccountDeletionsHeld`, alarmed) and tried again at every daily run. At the first run that holds it for a vault or an unfinished setup (`vault`, `enrolling`: the run less than 24 hours after `deletes_at`, so no mark is needed and the job writes nothing to the member row) the member is emailed (5.4.6): what blocks it, and how to go on. A canceled account cannot unlock its vault (the member API refuses its vault routes except lock and the two cancels), so the way on is the cancel link, then the vault's deletion, then a new account deletion. The RUNBOOK ("Account deletions held", written with the code) lists them; for reason `mail` the operator reinstates and tells the member, and for the others reinstates at the member's request. |
| **Afterwards** | No tombstone is kept: once the email marker is gone, the address can request membership again like any other. Abuse is dealt with by suspension, before a deletion, not by remembering deleted addresses. Kept: the audit events (by `user_guid`, no address); an address record of an admin's earlier action expires 90 days after that action, as now. The `vdeleted#` records of vaults deleted before, for their 90 days. Short-lived records that name the `user_guid` and expire on their own (rate-limit counters, request-table items such as an earlier start-over's cancel link), within their TTLs. A copy of the address in a log or an audit address record is deleted within 90 days, and in AWS's own audit log (CloudTrail) within 400 days. The tables' point-in-time backups (35 days) and CloudTrail's record of the SES calls (400 days), as now. |

No email is sent after the deletion: the confirmation said when it
would happen, and a mail afterwards would mean keeping the address.

##### 5.4.3.1 The mailing-list entry

With `mailing_list: "remove"`, the entry for the account's address is
removed **as an unsubscribe removes it** (`lambda/signup/subscribe.mjs`,
`removeSubscription`): the row is read (consistently); if it says the
list created the address's SES identity (`ownsIdentity`), a release
marker is put first; then the row is deleted, **conditional on the
`unsubToken` just read**, so that a new sign-up made meanwhile is not
removed (a failed condition leaves the list alone, and its marker
finds the row in use and keeps the identity); then an unconfirmed
row's confirm-link pointer (`tokenHash`), which names the address too.
The list's 15-minute sweep then releases the identity unless a member
uses it. This runs after the member row is gone, so the sweep finds no
member using the address. With `keep`, or with no entry, nothing on the
list changes. The cleanup job's role needs, on the list table, a
consistent `GetItem`, the marker's `PutItem` and the row's and the
pointer's `DeleteItem`, nothing else; the account function (for
`mailing_list` in `GET /api/account/deletion`) and the stream mailer
(for the confirmation's wording) need `GetItem` only; the signup stack exports nothing
new, since the table has a fixed name (§3.1, rule 4).

##### 5.4.3.2 Accounts cancelled before 0.3.0

None to carry over: VettID has no members yet (owner, 2026-11-03), so
no account was cancelled under the old flow. Should a `canceled` row
without an `account_deletion` record exist all the same (a staging
account, say), the job treats it as this section's deletion with
`mailing_list: "keep"`, and it is held like any other (reason `mail`,
as it has no `account_deletion.mailed_at`), so nothing of it is deleted without
an operator.

##### 5.4.3.3 What changes for the old cancel

`POST /api/account/cancel` is withdrawn (`404`); the account page's
Cancel becomes a link to this page. For new deletions the cleanup job no
longer writes `account_deleted_at` on vault rows or sends the host's
`delete` because of an account (MEMBER-API "Vault deletion", Account
cancellation). The mechanism itself stays: the "Vaults without a
member" sweep still uses it for a vault whose member row is gone for
another reason, and vaults already asked keep being retried until they
report `deleted`, their apps still told `410 account_deleted`. In the
same deploy as the code:
- the privacy notice's account paragraph (`website/privacy/`, "How
  long"): "If you delete your account" instead of "cancel", the vault
  no longer in the list (you delete it first), the cancel link, and the
  mailing-list entry if you ask; and, in the same file, the "Records
  that outlast the request" item, which says the audit log keeps the
  address with "no deletion period" (since MEMBER-API 2.6.0 the address
  is in a record deleted after 90 days), and the "Your rights" sentence
  that gives the audit log's entries 400 days (that is CloudTrail's
  period; the account system's own address records go after 90);
- the account guide's "Cancel any time" card
  (`sites/account/guide/`): deletion, 7 days, the cancel link, and the
  vault first.

#### 5.4.4 Member-API routes (MEMBER-API 2.14.0, "Deleting the account")

All under the session of 5.4.1 except the cancel link. Answers as in
MEMBER-API's Conventions.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/account/deletion` | — | `{blocked_by: {vaults: [{vault_id, state}]} \| null, pin_required: boolean, mailing_list: boolean}`: what the page needs (whether a vault blocks it, whether the PIN is asked, whether the address is on the mailing list, so the box is shown only then) |
| POST | `/api/account/deletion/code` | — | `202 {expires_at}`; the code is emailed. `409 vault_exists` `{vaults}`; `429 rate_limited` |
| POST | `/api/account/deletion` | `{confirm: "delete my account", code, pin?, remove_from_mailing_list: boolean}` | `202 {deletion_id, requested_at, deletes_at}`; cookies cleared. `400 bad_request` (the phrase, a missing field); `403 forbidden` with `message` (the PIN, as the PIN routes do; the code: wrong, expired or used, with attempts left; texts in 5.4.6); `409 vault_exists` `{vaults}` |
| POST | `/api/account/deletion/cancel-link` | `{token}` (**no session**: the account function answers it before its session check) | `200 {cancelled: boolean}`; `404` when the link names nothing (the account is deleted, or the token is unknown); `429 rate_limited` |

- **The cancel link.** `https://account.vettid.org/account/delete/cancel/#t=<token>`,
  in the fragment (never sent to a server or a log, as the sign-in
  link). The token is the request withdrawal link's
  (`lambda/shared/requests.ts`): `<user_guid>.<32 random bytes,
  base64url>`; the id finds the member row with one read, the secret is
  what authorizes, and only the secret's SHA-256 is stored, on the
  member row (`account_deletion.cancel_hash`, written by the mailer, 5.4.3). So
  the link lives exactly as long as the deletion: no other table, no
  TTL, and nothing to clean up; a held member's link keeps working. It
  answers only for the row's current hash, compared in constant time.
  The vault tables (another AWS account) are not touched by it.
- **The page** strips the fragment from the address bar on load (as
  `/auth/` does), shows what it will do, and POSTs only on **Cancel the
  deletion**, so a mail scanner opening it does nothing.
- **The cancel.** Rate-limited in the API, as the start-over's link is:
  `account-deletion-link#<ip>`, 20 per 15 minutes per IPv4 address or
  IPv6 /64 (the WAF's `/api/public/*` rule does not cover this path).
  In reinstate's order: a consistent read of the member row, which must
  be `canceled` with an `account_deletion.cancel_hash` equal to the token's
  (otherwise `{cancelled: false}`; `404` when the row is gone); sign-in enabled (idempotent); then the conditional write
  (still `canceled`, the same `account_deletion.deletion_id` and hash)
  to `active`, removing `account_deletion` and `delete_after`. If that write's condition
  fails, sign-in is disabled again unless the row is now `active`, and
  the answer is `{cancelled: false}`. Then the email (5.4.6) and
  `{cancelled: true}`. The link is not used up: a later use answers
  `{cancelled: false}`, as the start-over's link does (the hash is gone
  with the deletion). Reinstate's rule
  that anything making an account active first cancels a pending vault
  deletion holds trivially: an account deleted under this section has
  no vault.
- **Support.** An admin's reinstate of a `canceled` account cancels the
  deletion the same way (ADMIN-API "People"), audited as now, and the
  member gets the support variant of the email.
- **The admin Delete's message** (ADMIN-API, `409 vault_exists`) no
  longer says the vault goes with the account: the vault goes when the
  member deletes it (in the app, or with "Delete my vault and start
  over").

#### 5.4.5 Audit and logs

New events, none with an address (MEMBER-API "The audit log"):
`member.deletion_code` (actor `member:<guid>`, nothing in detail),
`member.deletion_request` (`deletion_id`, `deletes_at`, `mailing_list`),
`member.deletion_cancel` (`deletion_id`, `via: "link" | "admin"`),
`member.deletion_held` (actor `system`; `reason: "vault" | "mail" |
"enrolling"`, and `vault_ids` for a vault, at each run that holds).
The paths the owner's reporting sees change too: the account site
gains `/account/delete/` and `/account/delete/cancel/`, and the API the
four routes of 5.4.4, while `POST /api/account/cancel` answers `404`.
`member.delete_after_cancel` gains `deletion_id` and `mailing_list:
"removed" | "kept" | "not_listed"`. `member.cancel` is no longer
written. Logs carry ids and error names only, never an address, a code
or a token.

#### 5.4.6 Texts (drafts for the owner)

All from `VettID <no-reply@<zone>>`, plain text, no names (MEMBER-API
"Request emails"). `<when>` is the date and time in UTC, e.g. "10
November 2026, 07:00 UTC".

**The page, `/account/delete/`** (stable: the apps open it):
- Not signed in: "**Delete your VettID account.** Sign in first, then
  choose Delete my account on your account page." with **Sign in**.
- With an unfinished setup (an `enrolling` vault): "**Your vault setup
  isn't finished.** Your VettID account can be deleted only when no
  vault is left. Finish setting up your vault in the VettID app and
  then delete it there, or write to support@vettid.org to end the
  setup."
- With a vault: "**You still have a vault.** Your VettID account can be
  deleted only after your vault. Delete your vault in the VettID app,
  or here with **Delete my vault and start over**, which takes 24
  hours. Then come back to this page." (The app's own label is the
  apps' to name; the page links to the start-over section.)
- Otherwise: "**Delete your VettID account.** This deletes your
  membership, your sign-in, your subscription and your email address
  from VettID (unless you stay on the mailing list). Your account is
  closed at once and deleted after 7 days. Until then you can cancel
  with the link we email you. After that it can't be undone. A record
  that your account existed stays in our security log. Any copy of your
  email address in our logs is deleted within 90 days, and in AWS's own
  audit log within 400 days." Then the box "Also remove me from the VettID mailing
  list" (ticked; shown only when the address is on the list), "Type
  **delete my account** to confirm", the PIN if one is set, **Email me
  a code**, the code field and **Delete my account**.
- Done: "**Your account is closed.** It will be deleted after <when>.
  We're emailing you a link that cancels the deletion."

**The code email.** Subject "Your VettID account deletion code". "Someone
signed in to your VettID account asked to delete it. If it was you,
enter this code on the page: <code>. It works for 15 minutes. If it
wasn't you, don't share the code. Your account stays as it is, but
someone may be able to sign in as you: write to support@vettid.org."

**The confirmation email.** Subject "Your VettID account will be
deleted". "Your VettID account is closed, and will be deleted after
<when>. That deletes your membership, your sign-in, your subscription
and your email address from VettID[, and removes you from the VettID
mailing list][; your address stays on the mailing list]. To keep your
account, use this link until then: <link>. If you didn't ask for this,
use the link and write to support@vettid.org."

**The held email** (once, at the first hold for a vault or an
unfinished setup). Subject "Your VettID account was not deleted yet".
"Your VettID account is closed and was due to be deleted, but a vault
of yours still exists (or its setup was never finished), so nothing
has been deleted. While your account is closed your vault can't be
opened, so: use the link from our earlier email to keep your account,
delete your vault in the VettID app (or write to support@vettid.org to
end an unfinished setup), then delete your account again. We check
every day, and nothing is deleted while a vault is left."

**The cancel email.** Subject "Your VettID account was not deleted".
From the link: "You cancelled the deletion of your VettID account. You
can sign in again as before." From support: "VettID support cancelled
the deletion of your VettID account, as you asked. You can sign in
again as before. If you did not ask for this, write to
support@vettid.org."

**Error texts** (on the page, from the answers; nothing fails
silently):
- The phrase (`400`): "Type delete my account exactly as shown."
- The code, wrong: "That code isn't right. You have <n> more tries." Its
  last try: "That code isn't right, and it can't be used again. Ask for
  a new code."
- The code, expired or used: "That code has expired or was already
  used. Ask for a new code."
- The PIN: the PIN routes' own texts ("Incorrect PIN. <n> attempts
  left.", "Too many incorrect PINs; PIN entry is locked for now.").
- `409 vault_exists`: the "You still have a vault" or "Your vault setup
  isn't finished" text above, in place of the form.
- `429` for codes: "You've asked for 3 codes in the last hour. Try again
  later." Other `429`: "Too many tries. Wait a few minutes and try
  again."
- The code email could not be sent (`500` from the code route): "We
  couldn't send the code. Nothing has changed. Try again in a few
  minutes, or write to support@vettid.org."
- The deletion's `500`: "Something went wrong, and your account may
  already be closed. Don't try again: check your email for the cancel
  link. If no email comes within an hour, write to support@vettid.org."
- The cancel link, failed (`500`, `429`): "We couldn't cancel the
  deletion just now. Try the link again in a few minutes; it keeps
  working until your account is deleted."

**The cancel page, `/account/delete/cancel/`.** "**Keep your VettID
account?** Someone asked, from your account, to delete it. If you want
to keep it, cancel the deletion." **Cancel the deletion**, then "Your
account is open again. Sign in as before." or "This link no longer
works: the deletion was already cancelled, or carried out." (The page
knows nothing until the member clicks: the token is all it holds.)

## 6. Simplified admin

One page, six small sections:

1. **Requests** — membership requests without a code (with SES verification
   status); approve → `registered`, reject; resend verification.
2. **Members** — search/list (server-side query, paginated) showing state,
   subscription, voting rights; suspend, reinstate, delete; extend/reactivate
   a subscription.
3. **Registration codes** — create codes (uses, default 2; expiry), list,
   expire, delete. (API routes keep `/admin/invites`; ADMIN-API.)
4. **Terms** — publish a new terms version (PDF generated server-side), list,
   download. Members must accept the current version to become `member`.
5. **Subscription types** — create, enable/disable (free trial now; a `paid`
   flag for later).
6. **Admins & audit** — invite admin (Cognito `AdminCreateUser` emails the temp
   password; replaces the pending-admins table), list, disable, remove;
   filterable audit log. Password/MFA management via Cognito managed login.

Dropped: admin roles (cosmetic and escalatable today), notifications matrix
(new requests notify `admin@vettid.org`, as the mailing list already does), flatpickr
(native date inputs), and all EMS/BGS vault, governance and system-health
features.

## 7. PQC touchpoints

Per PQC-MIGRATION.md, account/admin carry no HNDL-exposed application crypto;
their exposure is the TLS key exchange. Actions: confirm CloudFront viewer
connections negotiate hybrid `X25519MLKEM768` (and pick the newest TLS 1.3
security policy on the API Gateway custom domains), and record it in the
RUNBOOK. Cognito/JWT signatures are short-lived tokens — zero HNDL exposure,
nothing to migrate.

## 8. Fixes carried into the port (do not port these bugs)

Auth & session
- Sign-out must actually clear the cookie (v2 `cookies`) and revoke the token.
- Verify tokens server-side before setting cookies; never echo client input
  into `Set-Cookie`.
- No tokens in `localStorage`; no refresh-token fallback to JS storage.
- PIN: peppered HMAC, server-side enforcement, working lockout with matching
  key prefix + grants + tests (§5.3).
- Don't reveal account properties (e.g., `pinRequired`) in public challenge
  params — PIN is a second round; rate-limit via GSI, not table scans.
- Drop the NATS `checkRecoveryFraud` call from `verifyAuthChallenge`.
- Admin: PKCE single implementation with `state` check; no writable role
  attribute; `script-src 'self'` only.

Data & logic
- Registration dedupe via `email` GSI (not `Scan` + `Limit`).
- Trial can't be re-taken: `has_used_trial` survives subscription changes.
- No full-table scans on request paths (subscription types, cancel lookup).
- Audit writes: explicit actor; decide fail-closed for admin actions.
- No `@test.vettid.dev`-style rate-limit bypasses; exact-host URL allow-lists.
- SES templates defined in CDK (old ones were console-made).
- `ses:SendEmail` stays `resources: ['*']` (see memory/RUNBOOK — scoping it
  silently breaks sends against the domain identity).

## 9. Decisions (2026-10-01)

1. **Admin egress:** AWS exit node (there will be other admins).
2. **Member login:** keep magic link + PIN; fix them (§5.3). No passkeys.
3. **Registration:** registration code or admin approval, simplified into
   the single lifecycle in §5.1. Registration codes (renamed from "invite
   codes", owner decision 2026-10-03) are good for 2 uses by default.
   - 3a. *Decided 2026-10-03:* paid members are the voting members; a free
     trial does not grant voting rights. Votes are not a vault feature;
     governance voting for paid members is upcoming.
     *Owner decision 2026-10-26:* votes become a vault feature after all,
     in the member vault with a service vault, specified later
     (VAULT-MESSAGING §1.1).
4. **Subscriptions:** kept, starting with free-trial types; payments later.
5. **SES:** stay in the sandbox; verification-as-opt-in (§5.2).
6. **Docs:** design docs and this plan are committed to the public repo.
7. **Deleting a VettID account** (*owner decisions of 2026-11-03*, §5.4):
   the vault first (an account deletion is refused while the member has
   a vault, and never asks a vault to delete itself); 7 days, with a
   cancel link in the email; the mailing list asked on the page, ticked
   by default.

## 10. Phases

**Phase 0 — Foundations** (1 PR)
`lib/config.ts`, constructs (`api-function`, `route-group`, `static-site`,
`ssm-refs`), esbuild, resource-count guard test, RUNBOOK stack table update
(incl. missing PlaybooksStack).

**Phase 1 — Auth, data, admin** (2–3 PRs)
AuthStack + DataStack → AdminAccessStack (exit node + WAF allowlists; verify from tailnet) →
AdminApiStack + AdminSiteStack (requests, members, registration codes, terms,
subscription types, admins, audit). Bootstrap the first admin via a script
(`AdminCreateUser` + add to group). Acceptance: admin reachable only with the
exit node on; MFA enforced; audit entries for every mutating action; off-tailnet
requests 403 at site, API, and login.

**Phase 2 — Account site** (2–3 PRs)
MemberApiStack + AccountSiteStack, apex placeholder redirects, SES templates.
Acceptance, end to end: request (no code) → verify email → admin approves →
sign in (magic link, then PIN) → accept terms → member → start trial;
request with a registration code → registered without admin; suspend/reinstate; cancel →
cleanup job deletes; sign-out actually ends the session; tests
for each fix in §8.

**Phase 3+ — Relay era (separate plans)**
RelayStack (RELAY-PLAN Phase 5), PushStack, CallingStack, VaultStack; then the
account Vault Services tab and the vault bits of admin, rebuilt against the
relay. Separately: payments for paid subscriptions, and governance voting
for paid members (upcoming).

## 11. Cost delta (approx., monthly)

| Item | Cost |
|---|---|
| Cognito Essentials (both pools, < 10k MAU) | $0 |
| AWS exit node (t4g.nano + EIP + 8 GB gp3) | ~$7 |
| WAF: admin CloudFront ACL | ~$6 |
| DynamoDB on-demand, Lambda, API Gateway at launch volumes | ~$1–3 |
| **Total** | **~$14/mo** on top of today's ~$8 |

The admin CloudFront rule could instead be added to the existing telemetry ACL
(host-scoped) to save ~$5.
