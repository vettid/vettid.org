---
title: MEMBER-API
status: v1 (Phase 2)
version: 2.10.0
changelog:
  - 2.10.0 (2026-10-20; **approved by the owner (2026-10-20)**, with
    VAULT-MESSAGING 0.51.0 and VAULT-HOST-PROTOCOL 0.1.14, vettid.org
    #356; for the vault's staging release 20; not built). "Vault
    deletion": a deletion that the vault marked and that stopped
    before its `deleted` report is **resumed**. The host writes
    `deleting_at` on the vault row when the vault's marking flush is
    stored (`MarkDeleting`), and removes it on `unlocked`. The 5-minute
    cleanup run sends the queue operation `delete_resume` for each row
    with `deleting_at` at least 2 minutes old that is not `deleted`,
    routed as `delete` is, at every run for the first hour and then
    hourly, and logs one still not finished after 1 hour and daily
    after 30 days. It never sends `delete` because of `deleting_at`.
    **The mark stays internal**: `deleting_at` (and
    `deletion_resumed_at`) are used only by the cleanup run, its log and
    its metric, and are never shown to the member. `GET
    /api/vault/status` keeps reporting the row's own `state` (a
    `deleted` row still reads `{vault: null}`); the account site shows
    no "being deleted" text and still offers recovery and start-over,
    because the mark is host-written and the host is not trusted. No new
    route, no new refusal, no new status value. The host role may write
    `deleting_at`; the cleanup job only reads it
  - 2.9.0 (2026-10-19; owner decision 2026-10-19, **approved by the
    owner (2026-10-19)**, with VAULT-MESSAGING 0.49.0 and
    VAULT-HOST-PROTOCOL 0.1.13; revised after review; not built). New
    "A recovery cancelled from the phone": the recovery that an owner
    app's unlock ended in the vault, named by the enclave
    (`cancelled_recovery_id` on the unlock's slot, or
    `recovery_cancelled` on the vault row from the unlock's lifecycle
    event), is ended here as `cancelled`, once, from either source. A
    per-recovery notice row is claimed before anything is audited or
    mailed; only its claimer audits and mails, and a notice that
    stalled is taken up again. Every cancel (both routes and this one)
    is a conditional field update of the recovery that never replaces
    it, so exactly one cancel wins, with one audit and one email.
    Unlock slots made under a recovery live as long as it. Approved by
    the owner (2026-10-19): a `recovery_cancel` names
    its recovery from the release that supports it
    (`RECOVERY_CANCEL_ID_FROM_RELEASE`). New permissions for the host
    and the `vault-attempts` job are listed. The `Recovery` object
    gains `cancelled_via`. Until now a recovery cancelled from the phone
    stayed pending on the account site, and a new request was `409
    recovery_active`
  - 2.8.0 (2026-10-18; **approved by the owner 2026-10-18**, with
    VAULT-MESSAGING 0.43.0 and STAGING-TIME-SCALE 0.1.0; not built).
    New "Staging time scale": a staging stack parameter `timeScale` (1
    or 24) divides the start-over deletion's 24 h, the account site
    PIN's 24 h lock and the recovery estimates (request + 24 h and
    + 48 h), and the emails and account site texts say the scaled times
    with "Staging: 1 day = 1 hour". The production stack has 1 in code
    and the CDK app refuses another value. The daily jobs (a cancelled
    account's 7 days, orphaned vaults, the 14- and 30-day removals) and
    the release notices are not scaled
  - 2.7.1 (2026-10-15; with VAULT-HOST-PROTOCOL 0.1.11, P15, for the
    vault's attachments release "release A"; built in this repository,
    not deployed). No route, request or response changes. "Vault
    deletion", **Rows**: the `vault-alarms` job keeps a deleted vault's
    row while the parent's attachment sweep is pending on it
    (`att_sweep_pending`), so that a restarted parent can resume the
    sweep; it stamps the notice handled (`alarm.handled_at`) and removes
    the row when a later stream record shows it `deleted`, handled and
    no longer pending (a second event-source filter). The pointer row
    goes with the notice, as before. No IAM change: the stamp writes
    only `alarm`, and the job's DeleteItem was unconditioned
  - 2.7.0 (2026-10-15; **wording for the owner's approval**, with
    VAULT-MESSAGING 0.33.0 §11.14; for the vault's "release R", not
    built). "Vault recovery", **Recovery from release R**: the API signs
    every `recovery` and `recovery_cancel` queue operation with the
    **recovery request key** (ECDSA P-256 in AWS KMS, usable for signing
    by the vault function only); new route **`POST
    /api/vault/recovery/open`** (signed by the recovering key, forwarded
    only while `registered`, 30 per recovery per day and 10 per source
    network per 15 minutes, audit `vault.recovery_open`); the recovering
    key may no longer call `unlock` or `lock`; `available_at` and
    `expires_at` come from the enclave's clear `not_before` and
    `expires` and may be later than 24 and 48 hours (new member
    `earliest`), and `expires_at` moves with each wait; a slot's
    `recovery_attempt` sends the member an email per counted attempt
    (audit `vault.recovery_attempt`); new texts for the request email,
    the attempt email and the completion email, and for the account
    site's recovery page; a release that refuses recovery answers
    `recovery_unavailable` with `reason: "not_offered"` (new `reason` on
    `Recovery`); a pending app key (`app_key_next`) accepted beside
    the current one during a transfer or recovery. The API never
    learns an attempt's outcome or the count. VettID can suppress every
    email; said where they are specified. The section heading's stale
    "VAULT-MESSAGING 0.4.1" is corrected
  - 2.6.5 (2026-10-14; as built; wording for the owner's approval).
    No member API route, request or response shape changes.
    **The daily run finds vaults whose member row is gone** ("Vault
    deletion", Vaults without a member): a vault row with an owner, not
    `deleted` and not yet asked to delete itself, whose member row a
    consistent read does not find, is first only marked
    (`orphan_seen_at`, never moved; metric `OrphanVaultsSeen`,
    alarmed). If the member row is still missing 7 days after the mark
    of each of that member's vaults, and no operator has put one of
    them on hold (`orphan_hold`, set by hand), they are asked to delete
    themselves exactly as for a canceled account (the host's `delete`,
    a never-sealed row and the pointer row deleted), audited
    `vault.orphan_deletion_requested` and alarmed
    (`OrphanVaultDeletions`). A member row that is back clears the
    mark. An account deletion that stopped after the member row and
    before the vaults is therefore finished 7 days later. On doubt
    nothing is written: an unreadable member row leaves its vaults for
    the next run, and a run that finds more than 5 members without a
    row, or more than 15 % of the owners it read, marks and asks none
    of them. New metrics `OrphanVaultsSeen`, `OrphanVaultsWaiting`,
    `OrphanVaultDeletions`, `OrphanVaultsOperatorHeld`,
    `OrphanVaultsHeld` (namespace `VettID/MemberApi`); alarms
    `vettid-org-orphan-vaults-seen`, `-orphan-vault-deletions`,
    `-orphan-vaults-held`; new log line `{"vaultOrphans": …}`. **A
    start-over held for a missing member row** ("Vault deletion: start
    over", Held) is still never carried out by the 5-minute run; its
    vault now goes through the same marking and 7 days, unless an
    operator holds it. The first daily run after the deploy only
    marks. **A canceled account's SES identity goes with the
    account** ("Retention"): under the 14-day reclaim's rule (kept if
    the mailing list uses the address, if the request found the
    identity already there, or for an address under vettid.org), and
    only when the account's own email marker went with the row and the
    sign-in user under the address was its own or none;
    `member.delete_after_cancel` gains `identity: "deleted" | "kept"`
    in its detail, and `ses_identity` can appear in its `incomplete`.
    **ADMIN-API: Delete refuses while the member has a vault** that is
    not deleted (`409 vault_exists`, nothing changed), so an admin's
    Delete no longer leaves a vault without a member. IAM: a third
    function on the cleanup module, `MemberVaults`, runs only the task
    `member_vaults` under a fixed-name role of its own
    (`vettid-org-member-member-vaults`) that may only Query the vaults
    table and its `user-index`; the admin people function may invoke
    it (its ARN in SSM `member-api/member-vaults-fn-arn`). The cleanup
    job may also write `orphan_seen_at` on a vault row. Both are in the
    vault account's table policy too, so `VettidOrgVaultStack` is
    deployed first (RUNBOOK "Deploy order for 2.6.5"). No existing
    log line, metric or alarm is renamed or removed
  - 2.6.4 (2026-10-13; editorial errata, as built; approved by the
    owner 2026-10-13). No route, answer or email changes: the text
    is corrected to what the API does.
    **The recovery's cancel link is not single-use** ("Vault
    recovery", Request): its token is not used up, it stays usable
    until the recovery's `expires_at`, and a second use answers
    `{cancelled: false}`, as Cancel already said. **Nor is the
    deletion's cancel link** ("Vault deletion: start over", Request):
    it stays usable until `deletes_at`, a use after the deletion was
    cancelled answers `{cancelled: false}`, and from `deletes_at` it
    answers `404`. The withdrawal link of "Withdrawing a request" is
    used up by its one use, as that section says, and is not changed.
    **The sender of the request emails is `no-reply@<zone>`** ("Request
    emails"), the stage's own sending domain: `no-reply@vettid.org` in
    production and `no-reply@staging.vettid.org` on staging; the text
    named production's address only
  - 2.6.3 (2026-10-13; editorial, erratum as built; approved by the
    owner 2026-10-13). No route, answer or email changes: the text
    is corrected to what the API does.
    **`POST /api/vault/recovery/cancel` answers `404 not_found` for a
    `recovery_id` that is not the current recovery of the member's
    vault** (no vault, a deleted vault, a vault with no recovery, or
    another id, such as that of a recovery a newer one has replaced);
    the route table said `200 {cancelled}` only. `{cancelled: false}`
    is the answer only for the vault's current recovery once it has
    ended. **Every answer of the two cancel routes is listed**
    (`200` with `true` or `false`, `400`, `401`, `403`, `404`, `409`,
    `429`), for the session and for the email link. **The email link
    is not uniform**: a token the API does not hold, one past the
    recovery's `expires_at` and one of a replaced recovery answer
    `404`, unlike the withdrawal link of "Withdrawing a request",
    which answers the same for every token. See "Vault recovery"
    (the route table, Cancel)
  - 2.6.2 (2026-10-13; as built in vettid.org #251 and #254; approved
    by the owner 2026-10-13; each clause below is separate and names
    what it follows).
    *What is named by the address, as built in vettid.org #251:* no
    member API route, answer or email changes. "Retention"
    gains the rule "What is named by the address is deleted only by
    its owner" (the email marker and the Cognito user go only if they
    carry the id of the row being deleted, in every deletion) and
    "The daily sweeps" (a canceled account and an unverified request:
    row and marker in one transaction; what could not be removed after
    the row is named in the audit event's `incomplete` and alarmed).
    Audit events of a deletion may carry `sign_in_user: "left"`,
    `email_marker: "left"` and `incomplete: [...]` in their detail.
    ADMIN-API: `DELETE /admin/members/{user_guid}` answers `404` when
    the row was removed by something else after the call read it.
    *A pending vault deletion and the account's status, as built in
    vettid.org #254 (ADMIN-API "People"):*
    **A pending "delete my vault and start over" is carried out only for
    an active account**: the cleanup job reads the member's row before it
    sets `executing`, and for an account that is suspended or canceled,
    or whose row is missing or unreadable, the deletion stays `pending`,
    neither carried out nor cancelled, whatever the time passed. **What
    is held is counted and two reasons are alarmed**: metrics
    `StartOverHeldNotActive`, `StartOverHeldNoMember`,
    `StartOverHeldReadError` at every run; alarms on the last two after
    three runs in a row. A deletion whose member row is gone is held for
    an operator and never carried out by the job.
    **Reinstating an account cancels its pending deletion** first, and
    the member is emailed; a member who wants the deletion asks again
    for a new 24 hours. **Reinstating warns about an active recovery**:
    a recovery is blocked, not stopped, while the account is not active,
    so ADMIN-API `reinstate` answers `409 recovery_active` until the
    admin confirms; it does not cancel the recovery.
    **The cancels work whatever the account's status**:
    `POST /api/vault/deletion/cancel` (session or app key) and
    `POST /api/vault/recovery/cancel` (session) no longer answer `403`
    to a suspended or canceled account, as `lock` never did; the two
    email links already worked. No other vault route is open to an
    account that is not active. **An admin can cancel a member's pending
    deletion**: ADMIN-API
    `POST /admin/members/{user_guid}/vault/deletion/cancel`
    (`{cancelled}`; `409` once `executing`), audited
    `member.vault_deletion_cancel`, the member emailed. **Suspend writes
    the status first**, so the hold begins with that write; a repeat
    finishes a suspension that failed half-way (ADMIN-API: `suspend` on
    a suspended account answers `200`, not `409` as before), and
    **Reinstate ends the member's sessions** before it enables sign-in.
    **No member API request or response shape changes**, and no
    existing audit event, log line, metric or alarm changes. A canceled
    account's vaults are deleted with the account after its 7 days, as
    before. IAM: the cleanup job's role may `GetItem` on the members
    table; a second function, `StartOverCancel`, runs only the cancel
    under that role; the admin people function may invoke that function
    (its ARN in SSM `member-api/start-over-cancel-fn-arn`) and not the
    cleanup job; nothing changes in the vault account. See "Retention",
    "Access", "Vault recovery" (Access), "Vault deletion: start over"
  - 2.6.1 (2026-10-13; editorial, errata as built; each clause below
    is separate and names what it follows, so that further clauses can
    be added).
    *Vault recovery, as built in vettid.org #253 (VAULT-MESSAGING
    0.29.2); approved by the owner 2026-10-13:*
    **The recovery code leaves the API by one route only.** `GET
    /api/vault/requests/{id}` passes on `envelope` and `code` only for
    the slot of an enroll, unlock, lock or recovery register request;
    a recovery request's own slot, and any other slot (recovery
    cancel, the jobs' `account` and `delete`, an operation not in the
    list), answers `{status}` only, for a session and an app key
    alike; no client read a result from those, and a future operation
    must be added to the list deliberately. `sealed_code` comes only
    from `GET /api/vault/recovery`: a code's while `available`, a
    refusal's at once (`unavailable`), as "Status" already said.
    **The release is audited before the code is returned:**
    `vault.recovery_code_released` is written first and the release
    recorded after it, so a failed audit write leaves the code
    unreleased (retried by the first request more than 60 seconds
    later); a request that meets a release in progress, or arrives
    within those 60 seconds, answers `available` without
    `sealed_code` and `locator`, which is a new answer a client can
    see even when nothing fails (two first requests together).
    **The scanned claim's limits are ordered as the typed form's:**
    the per-network limit, the lookup, and the per-vault limit only
    for a pair that names the vault's recovery, in whatever state; a
    miss (a vault with no recovery at all among them) does the same
    two reads in every case and is charged to no vault; the two
    refusals after the per-vault limit (member row gone, account not
    active) are stated. See "Two kinds of caller", "Access", "Vault
    recovery" (Claim, Status, Audit)
  - 2.6.0 (2026-10-12; owner decisions of 2026-10-12, made on the
    membership-request privacy notice, vettid.org #248: "we should only
    support removal via the link with nothing manually required",
    "declines should be kept for 30 days", "90 days for the logs", and
    the admin notice without people's addresses; **approved by the
    owner 2026-10-12** on vettid.org #250, with the wording "request
    for early access" in the emails and on the page, as on the privacy
    notice. Independent of 2.5.0: it takes effect when it
    is deployed, while 2.5.0 still waits for release L and its text is
    not changed). **`POST /api/public/request/withdraw`** `{token}`:
    a person withdraws their request for early access with a link, and
    everything the request created is removed without an operator.
    **A new email**, "We have your request for early access to
    VettID", sent once when a request's address is verified, carries
    the link.
    **Retention**: a declined request is deleted 30 days after the
    decline; a person's email address stays in the audit log for 90
    days, in a record beside the event, and the event itself is kept;
    a member's own actions are audited under `member:<user_guid>`
    instead of their address. **The admin notice** of a request
    carries no name, address or code, and a second one says when a
    request is verified. A new row state, `withdrawn` (never an
    account, gone within 15 minutes). No change to
    `POST /api/public/request`, its answers, or any other route. See
    "Withdrawing a request", "Retention", "Request emails"
  - 2.5.0 (2026-10-12; **approved by the owner 2026-10-12** on
    vettid.org #247, **not implemented yet**; VAULT-MESSAGING 0.29.0,
    VAULT-LOCK 0.1.0 decisions L3–L8; takes effect with the vault's
    "release L").
    **`POST /api/vault/lock`** accepts an optional `unlock_id`, which
    makes the lock a bound one; without it the lock is unconditional
    and is carried out only if it was queued after the vault's current
    unlock. **`GET /api/vault/requests/{id}`** for a lock returns a
    `code` beside `done`: `locked`, `not_running` or `stale`; when no
    instance holds the vault the API writes `not_running` itself.
    **`VaultStatus.locked_basis`**: whether `locked` rests on a report
    from the vault's host or on the absence of a live lease. The
    account site's lock shows the true outcome. No change for requests
    that omit `unlock_id` except that they can no longer lock a vault
    opened after they were queued. See "Locks"
  - 2.4.2 (2026-10-11; editorial, as built: errata from the
    implementations of 2.4.0 and 2.4.1 and of the notice mail,
    vettid.org #215, #222, #224; approved by the owner 2026-10-11).
    No
    route, body or status code changes. **Claim by locator** ("Vault
    recovery"): which recoveries a locator misses (a cancelled or
    expired one is `404`, where the scanned pair answers `409`); the
    lookup is three consistent reads, not two; what a miss does write
    (the request's nonce, the per-network count and the miss count;
    nothing on any vault or recovery); a body signed for the wrong
    form is `401` before anything else; a locator that cannot be
    minted is `500`; the miss audit's detail; the request limit is
    counted before the active check. **Completed** (2.4.1): the cases
    that still block until `expires_at`, and that recoveries completed
    before 2.4.1 are not converted. **Vault release notices**: the
    ending mail says how far away the end is, counted in whole UTC
    calendar days from the run that sends it, and names the time for
    today and tomorrow (the staging drill's first notice on 2026-10-11
    said "in 7 days" two days before the end). 2.4.0 marked approved
  - 2.4.1 (2026-10-11, VAULT-MESSAGING §11.11.5 step 3, §11.5; owner
    decision of 2026-10-11: a completed recovery must stop blocking a
    new request; found on staging, where a member who had recovered
    could not start another recovery until the old one's `expires_at`):
    "Vault recovery": a `registered` recovery whose recovering key the
    host reports as the vault's `app_key` has completed, and the API
    records it as `completed`, a new ended state (`Recovery.state`,
    with `completed_at`): it no longer blocks a recovery request or a
    start-over, `status` no longer shows it and there is nothing left
    to cancel. Before, the API cleared the recovery's keys at that
    point and left it `registered` and active until `expires_at`.
    `registered` alone still blocks, as does a registered recovery
    with no recovering key. Audit `vault.recovery_completed`. The
    recovery page shows a completed recovery as the last one and
    offers a new request. No change to the queue, the enclave, the
    request limit or any other route
  - 2.4.0 (2026-10-11, VAULT-MESSAGING 0.25.0 §11.11.10; owner decision
    of 2026-10-11, "we should allow a typed recovery code"; approved by
    the owner 2026-10-11, merged as vettid.org #212): the recovery code
    can be typed. The API mints a
    12-character `locator` (60 random bits) with each recovery request
    and returns it in `GET /api/vault/recovery` together with
    `sealed_code`; `POST /api/vault/recovery/claim` also takes
    `{locator, app_key}`, signed with an empty `vault`, and both forms
    of the claim answer `vault_id` and `recovery_id` as well. The
    recovery page shows the typed form (locator, code and 4 check
    characters computed in the browser: 48 characters in 12 groups of
    four) instead of the bare code. Additive: an app that sends the
    scanned form and ignores unknown fields is unaffected; the queue,
    the enclave and the register route do not change
  - 2.3.2 (2026-10-10, VAULT-RELEASES 0.1.10 W11, RELEASE-UPDATES
    0.3.0; editorial, as built): "Vault release notices": every notice
    email links release notes (the ending release's entry, the newest
    `active` release's entry and summary; the urgent email the security
    release's entry, summary and what it fixes), taken from the stage's
    own release log; `RELEASE_LOG_URL` and the account site's
    `release_log_url` are per stage (`https://<zoneName>/security/releases/`,
    staging's own log in staging)
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
| POST | `/api/public/request/withdraw` | `{token}` | `{ok: true}` always (2.6.0, "Withdrawing a request") |

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

### Request states

| What happened | The row | What else exists |
|---|---|---|
| Request made, address not verified | `requested`, `email_verified: false` | the `email:<addr>` marker row; an SES identity (created by the request, or already there) |
| Address verified, waiting for review | `requested`, `email_verified: true` | the same; since 2.6.0 the hash of the withdrawal token on the row |
| Declined by an admin | `rejected` (`rejected_at`, `reject_reason?`) | the same |
| Withdrawn by the person (2.6.0) | `withdrawn` (`withdrawn_at`; no names) | the same, until the cleanup job's next run (every 15 minutes) |
| Approved, or made with a valid code | `registered`: **an account** | the marker, the SES identity, a Cognito user |

A request has no Cognito user. The one exception: a registration with
a valid code whose Cognito call failed half-way falls back to
`requested` and can leave a user behind; removal looks for it (below).
The same address cannot have a second row in any state: a new request
for an address whose request is pending, declined or being withdrawn
answers `"pending_approval"` and creates nothing, as for any existing
address.

`owns_identity` (2.6.0) on the row says whose the SES identity is:
`true` only when the request's own `CreateEmailIdentity` call succeeded
(or an admin's "resend verification" created it for this row); `false`
when the identity was already there (the mailing list's, an earlier
account's, one the operator verified). Rows from before 2.6.0 have no
flag.

### Withdrawing a request (2.6.0)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/public/request/withdraw` | `{token}` | `200 {ok: true}`, **always the same**: for a token that withdrew a request and for one that names nothing |

**Owner decision of 2026-10-12**: a request is removed with the link,
and nothing is done by hand.

- **The token** is `<user_guid>.<secret>`: the row's id, a dot, and 32
  random bytes (base64url, 43 characters). The id finds the row with
  one conditional write, so there is no index, no pointer row and no
  server secret; the secret is what authorizes, and only its SHA-256
  is stored (`withdraw_token_hash` on the row). It is made when the
  "we have your request" email is sent ("Request emails") and exists
  nowhere but in that email. It does not expire while the request is
  held, and it is dead once used, once the request is approved (the
  hash is removed with the approval) or once the row is gone.
- **The link** is `https://account.vettid.org/request/withdraw/#w=<token>`:
  a static page of the account site with the token in the URL
  **fragment**, which a browser never sends, so it reaches no log.
  The page takes it out of the address bar and the history, and shows
  one button. **Opening the link changes nothing** (mail scanners and
  link previews open links), and the API has no `GET` for it: the
  path answers `404` to anything but `POST`. The button `POST`s the
  token as JSON with the `X-VettID-CSRF` header, like every other
  call of the site. It is not list mail and carries no
  `List-Unsubscribe` headers.
- **What the POST does**: one conditional update of the row the token
  names, only if its hash matches and the row is `requested` or
  `rejected`. It sets `state: withdrawn` and `withdrawn_at`, and
  removes the token hash,
  **the first and last name, the decline reason** and a code, at
  once. The function that serves the public routes can delete
  nothing: no row, no SES identity, no Cognito user.
- **What is removed, and when.** Every 15 minutes the cleanup job
  takes each `withdrawn` row and removes, in this order: a Cognito
  user under the address, only if it carries this request's
  `user_guid` (the half-failed code registration above; any other
  user under that address is somebody's account and is left); the SES
  identity of the address, only if `owns_identity` is `true`, the
  address is not one of the project's own (`…@vettid.org` and its
  sub-domains) and the mailing list has no row for it; then, in one
  transaction, the row (only if it is still `withdrawn`) and its
  `email:<addr>` marker (only if the marker is this request's own, by
  its `member_guid`, or is already gone: a marker that names another
  request, made after an admin's Delete took the old one, is left,
  and the row goes alone). Until that transaction the row still holds
  the address, which is what keeps a new request for it from racing
  the removal. A row from before 2.6.0 has no `owns_identity`: its
  SES identity is kept (never on doubt).
- **A failure** leaves the row for the next run (every 15 minutes),
  never stops the next request's removal, and is counted
  (`VettID/MemberApi` `RequestRemovalFailures`, alarm
  `request-removal-failing`). After 7 days of failures the row and
  the marker are deleted anyway, so that no address waits in the
  table for ever; what could not be removed outside the table is
  left, audited (`request.removal_incomplete`) and alarmed
  (`RequestRemovalAbandoned`, alarm `request-removal-abandoned`).
  A Cognito user left that way carries the old request's `user_guid`:
  an admin's approval of a later request for the same address is
  refused (`409`, nothing changed) until an operator has removed that
  user, instead of making an account that cannot sign in (ADMIN-API
  "approve").
- **Uniform answers.** A malformed token, an unknown one, a used one,
  the token of a request that has since been approved or deleted, and
  a working one all answer `200 {ok: true}` with the same bytes, so
  the route says nothing about any request or address. Only a failure
  on our side answers differently (`500`), and the per-network limit
  (20 an hour, `429`), neither of which depends on the token. The
  account site's WAF limit for `/api/public/*` (30 per 5 minutes per
  IP) applies as to the request route.
- **An approved request is an account.** The link does nothing for it
  (same answer). An account is cancelled by its member
  (`POST /api/account/cancel`) or deleted by an admin; neither is
  routed through this link.
- **Each state.** Unverified: there is no link, and none is needed:
  the request is deleted after 14 days (below). Verified and pending:
  the link from the email. Declined: the same link keeps working
  until the request is deleted ("Retention"). Requests verified
  before 2.6.0 was deployed have no token and got no email; they are
  not mailed automatically (the operator's
  `scripts/ops/request-mail-backfill.ts`, a dry run by default, can
  send them the email: an owner decision, RUNBOOK "Membership
  requests").
- **Audit:** `request.withdraw` (actor `public`, subject the request's
  `user_guid`, `from: requested | rejected`), `request.removed`
  (actor `system`; `after: withdraw | decline`, `identity: deleted |
  kept`), `request.removal_incomplete`. **None carries the address.**
- **Logs:** neither the route nor the job logs an address, a name or
  a token; outcomes and error names only.
- **The admin site** shows nothing new: a withdrawn request is no
  longer in the requests list (it lists `requested`), and a
  `withdrawn` row can be neither approved, declined nor re-verified
  (`409`).

### Retention (2.6.0)

| What | How long | By what |
|---|---|---|
| A request whose address is never verified | 14 days from the request | the daily cleanup job (as before; since 2.6.0 it leaves an SES identity the request did not create) |
| A verified request waiting for review | no limit (until approved, declined or withdrawn) | — |
| A declined request: the row, its reason, its marker | **30 days** from the decline | the daily cleanup job (07:00 UTC), removed exactly as a withdrawn one |
| A canceled account: the row, its marker, the sign-in user, the subscription, the vaults, and (2.6.5) the address's SES identity | **7 days** from the cancellation | the daily cleanup job; the SES identity under the 14-day reclaim's rule (below) |
| A withdrawn request | names and decline reason: at once; the rest at the cleanup job's next run (every 15 minutes) | the cleanup job |
| A person's email address in the audit log | **90 days** from the event | DynamoDB TTL on the address record |
| The audit events themselves | kept | — |

**What is named by the address is deleted only by its owner (2.6.2).** The
`email:<addr>` marker and the Cognito user are keyed by the address,
not by the request or account, and an address can be requested again
as soon as its marker is gone. Every deletion (an admin's Delete, the
14-day reclaim, the deletion after a cancellation, the removal of a
withdrawn or declined request) therefore deletes the marker only if
its `member_guid` is the row being deleted (or the marker is already
gone), and the Cognito user only if its `custom:user_guid` is. One
that names another id belongs to a newer request or account for the
address: it is left, and the row still goes. The function that did
it (the cleanup job, or the admin API for an admin's Delete) logs a
warning by id, never the address, and the deletion's audit event says
so in its detail: `sign_in_user: "left"`, `email_marker: "left"`
(`member.delete`, `member.delete_after_cancel`,
`request.reclaim_unverified`, `request.removed`,
`request.removal_incomplete`). The 14-day reclaim then leaves the SES
identity too, since the newer request's verification runs on it.
Cognito has no conditional delete, so its check is a read just before
the delete.

**The daily sweeps (a canceled account past its date, the 14-day
reclaim) (2.6.2).** The row is deleted first, under its guard (still
`canceled` and past `delete_after`; still `requested` and unverified),
in one transaction with its own marker. First, because the guard is
what protects a person who changed their mind: an account an admin
reinstated, or a request verified, after the job's query is not
touched at all. Together with the marker, so that an address is never
left reserved by a marker with no row. What is removed after the row
(a canceled account's sign-in user, subscription, vaults and, 2.6.5,
SES identity; a request's SES identity) cannot be retried from the
row, so each step is tried on its own, a failure skips neither the
next step nor the next row, and the audit event names what was not
removed (`incomplete: ["sign_in_user" | "subscription" | "vaults" |
"ses_identity", …]`), counted as `RequestRemovalAbandoned` for the
operator to reconcile. The vaults are found again by the next daily
run ("Vault deletion", Vaults without a member, 2.6.5).

**A canceled account's SES identity (2.6.5).** When the daily run
deletes an account 7 days after its cancellation, the address's SES
identity goes under the same rule as the 14-day reclaim's: it is kept
if the mailing list uses the address, if the request found the
identity already there (`owns_identity: false`), or if the address is
one of the project's own (under vettid.org); otherwise it is deleted
(an account from before 2.6.0, whose row has no flag, had its
identity created by its request). It is deleted only when the
account's own email marker went with the row and the sign-in user
under the address was this account's own or there was none: a marker
or a user that names another id (or a user that could not be
checked) means the address may be in use again, and the identity is
left. The audit event `member.delete_after_cancel` says which:
`identity: "deleted" | "kept"`. A row whose transaction fails for another
reason stays, is counted as `RequestRemovalFailures`, and is tried
again at the next run. (Unlike a withdrawn or declined request, which
cannot go back to being wanted: there everything outside the table
goes first and the rows last, retried for 7 days.)

**Declined requests (owner decision of 2026-10-12: "declines should be
kept for 30 days").** `POST /admin/requests/{id}/reject` records
`rejected_at`. The members table has no TTL, and a TTL could remove
neither the marker row nor the SES identity, so the daily cleanup job
does it: a `rejected` row whose `rejected_at` is more than 30 days old
is removed as in "Withdrawing a request" (Cognito user if it is the
request's, SES identity if the request created it and nothing else
uses it, then row and marker together). It runs once a day, so a
declined request is gone between 30 and 31 days after the decline.
A row declined before 2.6.0 has no `rejected_at`: its `updated_at`
is used, which is the time of the decline (nothing changes a declined
row afterwards, except an admin's "resend verification" that finds
the address verified). So at the first run
after the deploy every request declined more than 30 days earlier is
deleted. While a declined row exists, a new request from the same
address is answered as any existing address and creates nothing (as
before); after it is deleted the address can request again. The
person is not told of a decline (as before).

**The audit log (owner decision of 2026-10-12: "90 days for the
logs").** The audit table is the account system's security record:
what an admin did to whom, what a member did, what the jobs did. Its
events are kept. What changes is where a person's address is:

- An event **never contains a requester's or member's address**. It
  names the person by `subject`, their `user_guid`.
- Where the caller knows the address at the time (a new request, an
  admin approving, declining, re-verifying, suspending, reinstating
  or deleting, clearing a PIN, the canary flag), it is written to a
  separate **address record** in the same table: partition
  `addr#<YYYY-MM>`, the event's own `ts_id`, `email`, and
  `expires_at` 90 days after the event. DynamoDB's TTL deletes it
  (within about two days of the expiry; the admin API stops returning
  it at the expiry). It has no `actor` or `subject`, so it is in no
  index and no listing of events.
- What a member does themselves (terms, subscription, PIN, cancel,
  every vault route) is recorded with the actor
  `member:<user_guid>`, not their address, and writes no address
  record: while the account exists its row gives the address.
- So after a request or an account is deleted, the log still says
  that id X was requested, approved by admin A, deleted by admin B,
  and when; who X was can be read for 90 days after each event that
  recorded the address, and not after. Deleting an account writes
  the address once more (`member.delete`), into a record that expires
  90 days after the deletion; the automatic deletion after a
  cancellation (`member.delete_after_cancel`) and a withdrawal
  record no address at all.
- Not covered, on purpose: an administrator's own address (the actor
  of what they did, the subject of `admin.*` events). Those are staff
  identities and the point of the record.
- Writers still hold `PutItem` only: nothing running can alter or
  delete an event. Events written before 2.6.0 keep the address
  inside them until the operator runs
  `scripts/ops/audit-address-backfill.ts` once (dry run by default;
  RUNBOOK "Membership requests"). Each `--apply` run of it appends one
  event of its own, `admin.audit_address_backfill` (actor: the
  operator's session; detail: the counts), since changing old events
  in place would otherwise leave no record.
- Also holding the address after these periods, unchanged by 2.6.0:
  the tables' point-in-time-recovery backups (35 days), and the
  organization CloudTrail's record of the SES identity calls
  (400 days).

### Request emails (2.6.0)

All from `VettID <no-reply@<zone>>`, where `<zone>` is the stage's own
DNS zone and sending domain (`no-reply@vettid.org` in production,
`no-reply@staging.vettid.org` on staging), plain text, and with no
member-supplied text (names) in them.

- **Amazon's verification email** (SES, as before): sent by AWS when
  the request creates the address's SES identity. It cannot carry
  anything of ours.
- **"We have your request for early access to VettID"** (new): sent
  once per request by the members-stream mailer, at the moment the request
  becomes verified (the 15-minute verification sweep, or at once for
  an address SES had already verified), which is the first moment we
  may mail the address at all. It says the address is confirmed, that
  an administrator will review the request, and gives the withdrawal
  link. The mailer claims the send on the row first (`request_mail_at`
  and the token hash, conditional on the row still being a verified
  request without a token), so a retry cannot send twice; if the send
  fails the token hash is taken off again and the failure is logged
  by error name. An address somebody else typed into the form gets
  this email only if SES had already verified it (or its owner
  clicks Amazon's email); the link is then how its owner removes the
  request.
- **"Your VettID account is ready"** (as before): on approval, or on
  verification of a code registration. A request approved while its
  `email_verified` flag still lagged behind SES gets this email only:
  the approval sets the flag in the same write as the state, so the
  row is never a verified pending request and the email above is not
  sent seconds before this one.
- **No email** is sent for a decline, a withdrawal or an expiry.
- **To the administrative mailbox** (`ADMIN_EMAIL`), without a name,
  an address or a registration code: "VettID: a request for early
  access arrived" (saying whether its address is verified yet),
  "VettID: a request for early access was verified" (when a request
  that arrived unverified becomes verified), "VettID: someone registered with a
  registration code". Each has a link to the admin site, which is
  reachable only from VettID's own network and is where the request
  is read.

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
| `GET /api/vault/requests/{id}` | yes (the member's slots; the result only for enroll, unlock, lock and recovery register, 2.6.1) | the key that made the request |
| `POST /api/vault/recovery`, `GET`, `/cancel` | yes | — |
| `POST /api/vault/recovery/cancel-link` | its token | — |
| `POST /api/vault/recovery/claim` | — | the key being registered (`vault=` the QR's; empty with a `locator`, 2.4.0) |
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
- **Cancelling the account** blocks every vault route except `lock` and
  the two cancels (`POST /api/vault/deletion/cancel`,
  `POST /api/vault/recovery/cancel`) at once (`403 forbidden`); `lock`
  and the cancels keep working, with the portal's session or (lock, the
  deletion's cancel) the app key, until the vault rows are deleted.
  After the 7-day grace period the daily cleanup job deletes the member's
  vault rows (every `vault_id` they had, and the pointer row). Deleting the
  stored objects under `vaults/<vault_id>/` (encrypted state and sealed
  headers) is a TODO in the cleanup job until the vault data bucket exists
  (VAULT-PLAN V5); nothing is stored there before then.
- **A suspended account** (2.6.2) is treated the same way: every vault
  route answers `403 forbidden` except `lock` and the two cancels. A
  suspended account cannot sign in, so a session is one from before the
  suspension. It ends within the hour once the suspension has ended
  the sessions; if that step of the suspension failed (ADMIN-API,
  `suspend`), the session keeps renewing itself until the suspension is
  repeated or the account is reinstated, which ends it, and in that
  time it reaches only `lock` and the two cancels. The app key and the
  email links need no session. Cancelling only keeps the vault as it is,
  and suspending is what support does when an account looks taken over:
  it must not take away the member's way to stop a deletion or a
  recovery that someone else asked for. The other checks on the two
  cancels are unchanged and are now the only ones: the session's
  address must be the member row's, the vault must be the member's own
  (the pointer row and the vault row's owner), and an app request must
  be signed by the vault's `app_key` (not a pending or a claim key).
  No other vault route is open to an account that is not active.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/vault/status` | — | `{vault: VaultStatus \| null, service: 'available' \| 'paused'}` (`service`: 1.2.0, "Vault service pause"; app: the signing key's vault) |
| GET | `/api/vault/enclave` | — (`?release=<pcr0>` only to abandon an unconfirmed move, §11.10.4) | `Enclave`: the instance to seal to (below) |
| POST | `/api/vault/enroll` | `{vault_id, request_id, instance_id, etk_kid, envelope, manifest_sha256}` (signed by the pending key; 2.0.0 adds `vault_id`, the redeem's) | `202 {vault_id, request_id}`; the queue message carries the pending key as `app_key` |
| POST | `/api/vault/unlock` | `{vault_id, request_id, instance_id, etk_kid, envelope, manifest_sha256}` | `202 {vault_id, request_id}` |
| POST | `/api/vault/lock` | `{vault_id, request_id}`; 2.5.0 (with release L): also `unlock_id?` (32 lowercase hex), "Locks" | `202 {vault_id, request_id}` |
| GET | `/api/vault/requests/{request_id}` | — | `{status: "queued"\|"done"\|"expired", envelope?, code?}` (§11.5); 2.5.0 (with release L): for a lock, `code` is `locked`, `not_running` or `stale` ("Locks"). 2.6.1: `envelope` and `code` only for the slot of an `enroll`, `unlock`, `lock` or recovery `register` request; any other slot the member owns, a recovery request's own slot among them, answers `{status}` only ("Vault recovery", Status) |

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
  locked_basis?: 'reported' | 'no_lease';      // 2.5.0 (with release L): only with state 'locked' ("Locks")
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
| `urgent_<U>` | in the first 30 days of release U | U is marked `security: urgent` in the stage's release log (`index.json`, generated from the signed manifest); sent to members on each release in U's `affects` that still runs |

**How far away the end is** (2.4.2, as built; vettid.org #224). The
`ends_*` mail's first sentence gives the end date and, in brackets, the
time left: "That release ends on 2026-10-13 (in 2 days)." The time left
is counted **from the run that sends the mail, not from the
milestone's name**, in whole UTC calendar days (the end's UTC date
minus the run's): "in *n* days" for two or more, "tomorrow at 15:30
UTC" and "today at 15:30 UTC" with the end's time of day. One value
serves every mail of a run. The milestones, the rule for which one is
due and the subjects are unchanged ("Action needed: your VettID
vault's software ends on *date*"; for `ends_1`, "Last day: …"); the
`ended` mail has no such phrase. Why: a run sends the latest milestone
due, so a release whose end date is set less than 90 days ahead, or a
missed run, gets a milestone whose name no longer says how long is
left. The staging drill's first notice, sent on 2026-10-11 for an end
on 2026-10-13, was the `ends_7` mail and said "in 7 days".

Every email links release notes (RELEASE-UPDATES §3, VAULT-RELEASES §3.5;
W11). The job reads the stage's own release log, `RELEASE_LOG_URL` =
`https://<zoneName>/security/releases/` (production
`https://vettid.org/security/releases/`, staging
`https://staging.vettid.org/security/releases/`), once per run
(`index.json`, 10 s timeout, no redirects):

- `ends_*` and `ended`: the ending release's notes, and the newest
  `active` release (the highest `release_number` among the `active` rows
  of `vault-releases`, the one the app offers) with its notes and its
  one-line log summary, when it is newer than the ending one; plus the
  log's index.
- `urgent_<U>`: U's notes, its summary and its `security_text` ("What it
  fixes").

A release's link is its `notes` as the log lists it (an `https` URL;
staging releases signed before the log rule still list their GitHub
release URL until the next staging signing), otherwise
`RELEASE_LOG_URL<n>/`. Summaries and `security_text` are flattened to one
line and bounded (160 and 1,000 characters). If the log cannot be read,
the deadline notices still go out with the links and without summaries;
urgent emails wait for the next run.

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

### Staging time scale (2.8.0; approved by the owner 2026-10-18)

*STAGING-TIME-SCALE §5.3; VAULT-MESSAGING 0.43.0 §11.10.8.* The staging
stack takes a parameter `timeScale`, 1 or 24, which reaches the
function as `TIME_SCALE`; the function uses it only when its stage is
`staging`. The production stack is built with 1 in code, and the CDK
app refuses to synthesise it with any other value. At 24 the API
divides by it, when each starts: the start-over deletion's 24 hours
(`deletes_at`, "Vault deletion: start over"), the account site PIN's
24-hour lock (the day over which failures are counted is unchanged),
and the recovery estimates of `POST /api/vault/recovery` (request + 1 h
and + 2 h, still `earliest` until the enclave's own times arrive).
Emails and account site texts take every scaled duration from the same
number and, on staging, add "Staging: 1 day = 1 hour". Not scaled: the
daily jobs ("Retention": a cancelled account's 7 days, orphaned vaults,
the 14- and 30-day removals), the release notices and the rate limits.
A timer started before the parameter changed keeps its time.

### Vault recovery (VAULT-MESSAGING §11.11; from release R also §11.14)

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
| POST | `/api/vault/recovery/cancel` | `{recovery_id}` | `200 {cancelled: boolean}`; `404 not_found` when `recovery_id` is not the current recovery of the member's vault (Cancel, below) |
| POST | `/api/vault/recovery/cancel-link` | `{token}` (no session) | `200 {cancelled: boolean}`; `404 not_found` for a token that is unknown, past the recovery's `expires_at` or of a replaced recovery (Cancel, below) |
| POST | `/api/vault/recovery/claim` | `{vault_id, recovery_id, app_key}` (scanned; 2.0.0) or `{locator, app_key}` (typed; 2.4.0); app, signed by `app_key` | `200 {user_guid, email_hint, vault_id, recovery_id}` (the two identifiers since 2.4.0) |
| POST | `/api/vault/recovery/register` | `{vault_id, request_id, instance_id, etk_kid, envelope}` (app, signed by a claim key; 2.0.0) | `202 {vault_id, request_id}`; poll `GET /api/vault/requests/{id}` |
| POST | `/api/vault/recovery/open` | `{vault_id, request_id, instance_id, etk_kid, envelope}` (2.7.0, release R; app, signed by the recovering key) | `202 {vault_id, request_id}`; poll `GET /api/vault/requests/{id}` (Recovery from release R, below) |

```ts
interface Recovery {
  recovery_id: string;                 // ULID; the queue request id
  vault_id: string;                    // the vault being recovered (HKDF info and QR payload, §11.11.2)
  state: 'pending' | 'available' | 'registered' | 'cancelled' | 'expired'
       | 'unavailable'                 // 2.1.0: the enclave refused it (no_backup or no_credential; slot code recovery_unavailable)
       | 'completed';                  // 2.4.1: the new app holds the credential and is the vault's app (ended)
  requested_at: string;                // RFC 3339
  available_at: string;                // requested_at + 24 h (2.7.0, release R: the enclave's not_before, which may be later)
  expires_at: string;                  // available_at + 24 h (2.7.0, release R: the enclave's expires, moved by each wait)
  earliest?: true;                     // 2.7.0: available_at is still the API's own estimate (or the enclave's, when it could not read its counter)
  reason?: 'no_backup' | 'no_credential' | 'not_offered';  // 2.7.0: only with `unavailable`, from the slot's clear reason
  completed_at?: string;               // 2.4.1: only with `completed`; when the API recorded it
  cancelled_via?: 'session' | 'link' | 'app';  // 2.9.0: only with `cancelled`, for a cancel recorded from 2.9.0; `app`: an owner app's unlock (A recovery cancelled from the phone)
  sealed_code?: string;                // b64 of 5,252 bytes, only while `available`
  locator?: string;                    // 2.4.0: 12 Crockford base32 characters, only together with a `sealed_code` that is a code's (never with `unavailable`)
}
```

- **Access.** Request and status are the portal's and need a session of
  an active `member` with the current terms. Cancel is the portal's and
  needs a session of the account holder, whatever the account's state or
  status (2.6.2: a suspended or canceled account can still cancel;
  "Access"). Claim and register (2.0.0) are the new app's: signed, no
  session, an active account. The cancel link needs no session, only its
  token, and works whatever the account's status.
- **An account that is not active (2.6.2).** A recovery is then
  blocked, not stopped: the status (and with it the code) answers
  `403`, and so do claim and register, but `available_at` and
  `expires_at` do not move. A recovery that is still before
  `expires_at` when the account becomes active again is usable again at
  once. The admin API therefore reinstates an account with an active
  recovery only after the admin has confirmed it (ADMIN-API,
  `reinstate`, `409 recovery_active`); it does not cancel the recovery.
- **Claim** (2.0.0). Only while the recovery is `available` (`409
  recovery_not_available`; `404 not_found` when `vault_id` and
  `recovery_id` do not name the vault's current recovery). Adds the key
  to `claim_keys` (at most 10; the oldest goes), audits
  `vault.recovery_claim`, answers `user_guid` and `email_hint` and,
  since 2.4.0, the recovery's `vault_id` and `recovery_id`. Limits
  (order as built, 2.6.1): after the signature and the pause, the
  body's syntax and `vault_id` being the vault the request is signed
  for (`400`; counted against neither limit); then 10 per source
  network per 15 minutes, hits and misses alike, counted before the
  lookup; then the lookup; then, only when the pair names the vault's
  recovery, 10 per vault per day.
  - **The pair names the vault's recovery** when the vault exists and
    is not deleted, its recovery has that `recovery_id`, and the
    member's pointer names that vault. The recovery's state does not
    matter: a `pending`, cancelled, expired, `registered`,
    `unavailable` or `completed` recovery is a hit, counts against the
    vault and then answers `409 recovery_not_available`.
  - **A miss** (no such vault, a vault with no recovery at all, another
    `recovery_id`, a deleted vault, a pointer that names another
    vault) is `404 not_found` with one body, after the same two
    consistent reads in every case: the vault row of the `vault_id`
    sent, and a pointer row (the member's, or a key that no row has
    when there is no vault). It writes nothing on any vault, recovery
    or request row and is charged to no vault. It does write, in the
    rate-limit table, the signed request's nonce and the per-network
    count. Scanned misses are not audited.
  - **After the per-vault limit** the account checks run, and two
    refusals there have already counted against the vault: the right
    pair of a member whose row is gone answers the miss's `404
    not_found`, and the right pair of an account that is not active
    answers `403 forbidden`.
- **Claim by locator** (2.4.0, VAULT-MESSAGING 0.25.0 §11.11.10): the
  typed form. Body `{locator, app_key}`; a body with `locator` and
  either identifier is `400`. Signed by the key being registered with
  `vault=` empty, as the redeem. In order: the signature; the pause
  (`503 vault_unavailable` with `service: "paused"`, before the body
  is read, as the scanned form); the body's syntax (`locator` exactly 12 characters of
  `0-9A-HJKMNP-TV-Z`; the app sends the canonical form, and anything
  else is `400`); the per-network limit; the lookup.
  - **Miss.** No such locator, or its recovery is not the vault's
    current one (replaced), or the vault or the pointer is gone:
    `404 not_found`, the body of an unknown pair, after the same work
    (one read of the locator row and one of a vault row, a dummy when
    there is none), so that timing does not tell a miss from a stale
    hit. A miss writes nothing and is charged to no recovery.
    As built (2.4.2):
    - A locator whose recovery was **cancelled** or has passed
      `expires_at` is a miss too (`404`), where the scanned pair of
      the same recovery answers `409 recovery_not_available`. So is a
      locator whose vault is deleted, or whose member's vault pointer
      names another vault. A current recovery in any other state
      (`pending`, `registered`, `unavailable`, `completed`) is a hit
      and gets the scanned form's `409` after the per-vault limit.
    - The work is **three** consistent reads on every call, hit or
      miss: the locator row, a vault row and the member's pointer row
      (dummies where there is none). The pointer is part of deciding a
      miss, so a mismatch is a true miss, decided before the per-vault
      limit, and charges no vault.
    - "Writes nothing" means nothing on any vault, recovery or request
      row. A miss does write, in the rate-limit table: the signed
      request's nonce, the per-network count (charged before the
      lookup) and the per-network miss count that the audit reads.
    - A body signed for the other form is `401` before anything else
      is looked at: a `locator` body signed with a non-empty `vault=`,
      and a scanned body signed with an empty one.
  - **Hit.** From here the scanned form's code runs with the row's
    `vault_id` and `recovery_id`: the per-vault limit, the account
    checks, `409 recovery_not_available` unless `available`, the
    claim keys, the audit and the answer.
  - **Limits.** Per source network, 10 per 15 minutes, in the same
    bucket as the scanned form (`vault-recovery-claim-net#<network>`,
    hits and misses alike); then, on a hit, the scanned form's 10 per
    vault per day. **None is global**, as for setup codes: a search
    for locators cannot stop anyone else's recovery.
  - **Audit.** `vault.recovery_claim` gains `via: qr | typed`.
    Misses are audited as `vault.recovery_locator_miss`, aggregated
    per source network and hour (at the 1st, 10th, 100th, … miss, as
    `vault.enroll_code_failed`); never the locator tried. (2.4.2) Its
    detail is `{network, misses_this_hour}`. If the count or the audit
    cannot be written, the answer is still `404`.
- **The locator** (2.4.0). 60 bits from the API's CSPRNG as 12
  Crockford base32 characters, minted in `POST /api/vault/recovery`.
  Kept on the recovery (`recovery.locator`) and as a request-table
  row `recovery-locator#<locator>` → `{vault_id, recovery_id}`,
  written with a conditional put (a collision draws again) and
  expiring with the recovery, like the cancel link's row. It is kept
  in the clear: it is no more than the `vault_id` and `recovery_id`
  it stands for, which the table holds anyway. `GET
  /api/vault/recovery` returns it only in an answer that carries a
  code's `sealed_code` (`available`). It is not in `status`, in any
  email or in a log. A recovery requested before 2.4.0 has none.
  (2.4.2) After 5 draws that all collide the request fails with `500`
  and no recovery is recorded: nothing is enqueued, locked or mailed.
  It has still counted toward the request limit. At 60 bits this is
  not expected to happen.
- **Recovering key** (2.0.0). When a register slot comes back
  `recovery_registered`, the API records that register's key (the slot's
  `app_kid`) as `recovering_key`, with the `registered` state. It may
  `unlock`, `lock` and read `status` while the recovery is active. When
  the host writes the vault's `app_key` with the same `kid` (the recovery
  completed), the recovery's keys are cleared and, since 2.4.1, the
  recovery is recorded as `completed` (below).
- **Completed** (2.4.1; owner decision of 2026-10-11). A recovery has
  completed when the new app holds the credential and is the vault's
  app (VAULT-MESSAGING §11.11.5 step 3). The API's sign of it is the
  one it already uses to admit the new app's key and refuse the old
  one: the recovery is `registered`, it has a `recovering_key`, and
  the host's `app_key` on the vault row has the same `kid`. The vault
  makes the registered app's key its app key only in the flush of a
  successful `credential.recover` (the PIN and the credential password
  both proved), and the host writes `app_key` after that flush is
  stored (VAULT-MESSAGING §11.5). The API then sets the recovery's
  state to `completed` with `completed_at`, removes its `claim_keys`
  and `recovering_key`, and audits `vault.recovery_completed`; the
  write is conditional on the same `recovery_id`, the state
  `registered` and the `recovering_key` that was compared (the API's
  own attributes only; it never names the host's `app_key` in a
  write). It does so on the first
  request that reads the recovery afterwards: any request signed by
  the vault's app key, `GET /api/vault/status`, `GET
  /api/vault/recovery`, a recovery request, a cancel or a start-over
  request. `completed` is an ended state, whatever the clock:
  - it does not block a new request (`POST /api/vault/recovery`, which
    replaces it as it replaces any ended recovery; the request limit
    and every other refusal apply unchanged) or a start-over;
  - `GET /api/vault/status` answers `recovery: null`; `GET
    /api/vault/recovery` answers it with `state: "completed"`, without
    `sealed_code` or `locator`, until a new request replaces it;
  - a cancel is a no-op (`{cancelled: false}`: nothing is enqueued or
    mailed);
  - claim and register are refused for it as for `registered` (`409
    recovery_not_available`; `404` once it is replaced), and the code
    was spent at the register.
  `registered` alone is **not** completed: until the host's report the
  recovery is in progress (the PIN or the password step has not
  succeeded) and blocks as before. So does a registered recovery with
  no `recovering_key` (its register's key was no longer among the
  claim keys, or its keys were cleared before 2.4.1): the API has no
  sign for it, and it ends at `expires_at`. (2.4.2) All the cases
  that still block until `expires_at`, as built: a registered
  recovery with no `recovering_key` (the register's key had been
  pushed out of the 10 claim keys by later claims); a register made
  through the staging-only legacy-session path, which has no app key
  to record; a host that never reports `app_key`; and a recovery that
  completed **before 2.4.1 was deployed**, whose keys the older code
  had already cleared: it is not converted and stays `registered`
  until its `expires_at`. No migration exists or is needed: each ends
  within 24 hours of becoming available. A host that misreports
  `app_key` gains nothing here: only the member's session can then
  request a recovery, and that session can cancel a registered
  recovery anyway.
- **`browser_key`**: canonical base64 of an uncompressed P-256 point (65
  bytes, first byte `0x04`), made by the portal with WebCrypto
  (non-extractable private key kept in IndexedDB).
- **Request.** `404 not_found` without an enrolled vault (state
  `enrolling` included); `409 recovery_active` while a recovery is
  `pending`, `available` or `registered` before its `expires_at` (never
  for a `completed` one, 2.4.1); `409 deletion_pending` while a start-over
  is pending (2.1.0). (2.4.2, as built: the request limit of 3 a day is
  counted first, so a request refused as `recovery_active` uses one
  of the three, as one refused for the backup does.) **Backup off** (2.1.0): when the vault row's
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
  available, and a cancel link
  (`https://account.vettid.org/vault/recovery/cancel#t=<token>`; the API
  stores only the token's SHA-256, in a request-table row that expires
  with the recovery). The link is not used up by a cancel (2.6.4, as
  built): it stays usable until the recovery's `expires_at`, and a
  second use answers `{cancelled: false}` (Cancel, below).
- **Status.** Without an enrolled vault (none, `enrolling` or deleted)
  the answer is `{recovery: null}`, not `404`; likewise for a vault that
  never had a recovery. `available` from `available_at` to `expires_at` while not
  cancelled; `sealed_code` is the slot's envelope, returned only then (and
  absent if the host has not answered yet), or at once for a refusal
  (`unavailable`, below). (2.6.1) No other route returns it: `GET
  /api/vault/requests/{id}` answers `{status}` only for the recovery's
  own slot (its id is the `recovery_id`), whatever the recovery's state
  and until the slot expires, one hour after the recovery.
  (2.6.1) A code's `sealed_code` is returned only after
  `vault.recovery_code_released` has been written: the API marks the slot
  (`releasing`), writes the event, then records the release
  (`released`). If the audit write fails the request fails (`500`) and
  the code stays unreleased; the release is tried again by the first
  request that arrives more than 60 seconds after the failed attempt
  began. Until then, and likewise while another request is releasing
  (two requests can arrive together with nothing failing), a request
  answers `200` with `state: "available"` and without `sealed_code`
  and `locator`, unless the release has been recorded meanwhile; the
  page asks again. The event is written once, except when a
  release fails after the audit write and before it is recorded, in
  which case the retry writes it again. The portal decrypts it and
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
  `registered` afterwards, unless it completes first (2.4.1,
  "Completed" above). Until vettid-vault sends the marker, a
  recovery stays `available` after a register, as before.
- **Cancel** (session or link): marks the recovery `cancelled`, enqueues
  `recovery_cancel` to the same routing, emails the member and answers
  `{cancelled: true}`. (2.9.0) The mark is the conditional field update
  of "A recovery cancelled from the phone" (below), with `cancelled_via`
  `session` or `link`; only the caller whose update succeeds enqueues,
  audits and mails, and a caller that loses to another cancel answers
  `{cancelled: false}`. The `recovery_cancel` names the recovery from
  the release that supports it (same section). Cancelling a recovery that is not `pending`,
  `available` or `registered` (or one that has passed `expires_at`) is a
  no-op answered `{cancelled: false}`. The link stays valid until the
  recovery's `expires_at`, so its second use answers `false`; a link of a
  recovery that a newer one has replaced is `404`.
  **The answers of the session route** (2.6.3, as built).
  `recovery_id` must name the current recovery of the member's vault,
  which is the one recorded on the vault's row, in whatever state.
  - `200 {cancelled: true}`: it is the current recovery, it was
    `pending`, `available` or `registered` before its `expires_at`,
    and this call cancelled it.
  - `200 {cancelled: false}`: it is the current recovery and it has
    ended: it was cancelled already, it is `unavailable` or
    `completed`, or it has passed its `expires_at`. Nothing is
    enqueued or mailed, and no cancel is audited.
  - `404 not_found`: it is not the current recovery. The member has
    no vault, the vault is deleted, the vault has no recovery, or the
    vault's recovery has another id (a recovery that a newer one has
    replaced, or an id that was never the member's). The answer is
    the same in each case.
  - `409 conflict`: the recovery was replaced between the read and
    the write. A repeat then answers `404`.
  - `400 bad_request`: `recovery_id` is not a ULID. `401`: no
    session. `403 forbidden`: the session's account row is gone or
    carries another email address; never for the account's status
    or its terms alone (Access, above). `429 rate_limited`: the
    limit below.
  **The answers of the link route** (2.6.3, as built).
  - `200 {cancelled: true}`: the token's recovery is still the
    vault's current one and was active, and this call cancelled it.
  - `200 {cancelled: false}`: the token's recovery is still the
    vault's current one and is before its `expires_at`, but has
    ended (cancelled already, as on the link's second use;
    `unavailable`; `completed`).
  - `404 not_found`: a token the API does not hold; a token whose
    recovery has passed its `expires_at` (the token's row expires
    with the recovery, so the link never answers `false` for an
    expiry); a token of a recovery that a newer one has replaced; or
    a token whose member or vault row is gone. The body is the same
    in each case.
  - `409 conflict`: as for the session route. `400 bad_request`: the
    token is not 43 base64url characters. `429 rate_limited`: the
    limit below, counted before the token is looked at.
  The link works whatever the account's status. Its answers are not
  uniform, unlike the withdrawal link's ("Withdrawing a request"):
  `404` and `200` tell a token the API holds from one it does not.
  The token is 256 random bits, and the route is limited per source
  network.
- **Register.** Like unlock (envelope exactly 13,444 bytes, routing,
  `request_id` once), and only while the recovery is `available`
  (`409 recovery_not_available`), signed by one of its claim keys, which
  goes into the queue message as `app_key` (2.0.0). The enclave re-checks the delay, the
  expiry, the code and the device attestation.
- **`GET /api/vault/status`** includes `recovery: {state,
  available_at} | null` in `VaultStatus` (above): the active recovery
  (`pending`, `available` or `registered` before `expires_at`), so the
  app can show a recovery in progress and offer to cancel it.
- **Rate limits:** request 3 per member per day; claim as above;
  register 10 per member per day; cancel 30 per member per 15 minutes; the cancel link 20 per
  source network per 15 minutes; status 60 per minute.
- **Audit:** `vault.recovery_request`, `vault.recovery_cancel` (with
  `via: session | link`, and from 2.9.0 `app`), `vault.recovery_cancel_seen`
  (2.9.0: an app's cancel of a recovery that had already ended here), `vault.recovery_code_released` (first release; written before the code is returned, 2.6.1),
  `vault.recovery_register`, `vault.recovery_registered` (1.1.0),
  `vault.recovery_completed` (2.4.1; `vault_id`, `recovery_id`, the
  key's `kid`),
  `vault.recovery_claim` (2.0.0; `via`, 2.4.0),
  `vault.recovery_locator_miss` (2.4.0), `vault.recovery_open` and
  `vault.recovery_attempt` (2.7.0, release R). Never the code, the locator, the browser key, the token or
  envelopes.
- **Email** uses the system mailer (SES sandbox: the member's address must
  be a verified identity, as for sign-in links; a failed send is logged
  and does not fail the request).

#### Recovery from release R (2.7.0)

*Wording for the owner's approval, with VAULT-MESSAGING 0.33.0 §11.14.
It applies to vaults of release R and later, and binds nothing before.
Everything above holds except where this says otherwise.*

- **Signed queue operations.** The API signs every `recovery` and
  `recovery_cancel` it enqueues (VAULT-MESSAGING §11.14.8): the string
  `"vettid/vms/2/recovery-request" \n op \n vault_id \n user_guid \n
  request_id \n signed_at \n hex(SHA-256(browser_key))` (the last line
  empty for a cancel), signed with the **recovery request key**, an
  ECDSA P-256 key in AWS KMS in the account that runs the member API
  (`alias/vettid-org-recovery-request`; staging
  `alias/vettid-org-staging-recovery-request`), whose key policy allows `Sign` to
  the member API's vault function only; the message carries
  `signed_at`, `key_id` and `sig`. The vault releases pin its public
  key (`recovery_request_keys`). A refused signature is answered with
  random bytes and nothing happens; the API treats it like an enclave
  that cannot answer. The signature does nothing against VettID as a
  whole, which holds the key; in production it separates the member
  API's account from the vault's, and on staging, where both run in one
  account, two roles only.
- **Times.** `POST /api/vault/recovery` still answers request + 24 h and
  + 48 h, now the earliest possible times, with `earliest: true`. When
  the request's slot returns the enclave's clear `not_before`,
  `expires` and `earliest`, the API stores them as `available_at` and
  `expires_at` (a vault cannot be recovered until 72 hours after its
  member was last present, and not during a wait), and drops
  `earliest` unless the enclave set it. The code is released from
  `available_at` as before.
- **`POST /api/vault/recovery/open`.** Body `{vault_id, request_id,
  instance_id, etk_kid, envelope}` (envelope exactly 13,444 bytes, as
  an unlock), signed by the recovery's `recovering_key`. Forwarded only
  while the recovery is `registered` and before its `expires_at` (`409
  recovery_not_available` otherwise); enqueued as `recovery_open` with
  that key as `app_key`, to a live instance of the vault's
  `sealed_release`, preferring one whose registry row shows
  `heavy_kdf_free` (VAULT-HOST-PROTOCOL §6.6). The result is polled with
  `GET /api/vault/requests/{id}`, which returns `envelope` and `code`
  for this slot. Limits: 30 per recovery per day and 10 per source
  network per 15 minutes. **These limits save work; the bound on
  guessing is the vault's attempt counter, not the API.** Audit
  `vault.recovery_open` (`vault_id`, `recovery_id`, `request_id`; never
  the outcome, which the API cannot read).
- **A counted attempt.** When an open's slot comes back with `code:
  "recovery_attempt"`, the API audits `vault.recovery_attempt`, moves
  the recovery's `expires_at` to the slot's `expires` when present
  (the recovery stays open across waits with the same code), and
  emails the member (below). It learns that an attempt was counted and
  when the next is possible, never whether it was right, and never the
  number of attempts used, which the vault reports to its owner only.
- **The recovering key** may call `enclave`, `open` and poll its own
  requests; `unlock` and `lock` are refused `403` (a registered phone
  does not unlock from release R).
- **The pending app key.** A transfer or a recovery replaces the app in
  three writes (VAULT-MESSAGING §11.14.2). The host writes
  `app_key_next` (`{key, kid, seq}`, `seq` one above `app_key`'s) with
  the first and `app_key` with the third. While `app_key_next` is set,
  with no time limit, the API accepts requests signed by either key as
  the vault's app key; when `app_key` reaches its `seq` it is cleared and
  the old key is refused. It is also cleared when the vault abandons the
  replacement (`app_key` repeated with `next_cleared: true`) and when an
  `unlocked` or `locked` report says `next: false` with an `app_key_seq`
  at least the next key's `seq` or a `header_seq` at least that of the
  write that carried it, so that a stale report never clears it
  (VAULT-MESSAGING §11.14.2). This is not the redeem's
  `app_key_pending` above. A restore by an operator (RUNBOOK) resets
  `app_key` to the old header's key and clears the pending one, the one
  case in which `seq` goes down.
- **Completed** is noticed as before, from the host's `app_key`; the
  vault makes the registered key its app key when the recovery open
  completes (VAULT-MESSAGING §11.14.6 step 6).
- **A release that refuses recovery** (VAULT-MESSAGING §11.14.13): the
  slot's `recovery_unavailable` carries the clear `reason:
  "not_offered"` (the API cannot read the sealed refusal); the API ends
  the recovery as `unavailable` with that `reason` and the account site
  says "This vault's release does not offer recovery. Your vault gains
  recovery only after you move it to a release that does, which needs
  your phone."
- **Emails** (texts are drafts for the owner's wording). VettID can
  suppress every email, and an attacker who is VettID needs none: they
  are a notice against an attacker who is someone else.
  - *Request*: "A recovery of your VettID vault was requested from your
    account. Your vault has been locked. If nobody cancels, a one-time
    recovery code becomes available on your account page at
    {available_at} at the earliest, for 24 hours. The time can be later:
    a vault cannot be recovered until three days after its app was last
    used with the PIN and the password. Your account page shows the
    exact time. A new phone then needs the code, your vault PIN and your
    credential password, entered together. There are ten attempts in
    all. After the first two, each wrong attempt is followed by a wait,
    which starts at one day and grows to thirty days. You get an email
    for every attempt. The new app replaces your current app, which is
    removed; your desktops and agents stay paired. If you did not ask
    for this, cancel it now: {cancel_url}. If you still have your phone,
    open the VettID app and enter your PIN and password there: that also
    stops this recovery."
  - *Attempt*: "An attempt was made to open your VettID vault with a
    recovery, on {time}. Attempts are limited to ten, and after the
    first two each wrong one is followed by a growing wait. If this was
    you and it did not work, the app on your new phone shows when you
    can try again. If this was not you, cancel the recovery now:
    {cancel_url}. If you still have your phone, open the VettID app and
    enter your PIN and password."
  - *Completed*: "Your VettID vault was recovered on {time} and is now
    on a new phone. Your old app was removed."
  - The cancel email is unchanged.
- **The account site's recovery page** (drafts): before the request,
  "Recovering takes at least 24 hours, and up to three days if your app
  was used recently. You will need a new phone, your vault PIN and your
  credential password. You have ten attempts at the PIN and password
  together. The first two can be made at once. After that, each wrong
  attempt is followed by a wait: one day, then two, four, eight and
  sixteen days, then thirty days each. If all ten are wrong, this vault
  cannot be recovered."; while waiting, "Your recovery code will be
  ready on {date} at {time}" and, while `earliest`, "at the earliest";
  and "The app on your new phone shows how many attempts are left." The
  page cannot show the count.

#### A recovery cancelled from the phone (2.9.0)

*Owner decision of 2026-10-19; approved by the owner (2026-10-19),
with VAULT-MESSAGING 0.49.0 (§11.5, §11.11.4, §11.14.8) and
VAULT-HOST-PROTOCOL 0.1.13. Not built. It needs the vault release that
sets the marker and the event field.*

**Before 2.9.0.** An owner app's unlock with `cancel_recovery` ends a
recovery inside the vault (VAULT-MESSAGING §11.11.4), and its result is
sealed to the app. The API never learned of it. The account site kept
showing the recovery as pending, and a new request was answered `409
recovery_active` until the recovery's `expires_at`.

**The two sources.** The vault names the recovery it ended, by the
recovery's own id (the API's `recovery_id`):

- **the slot**: an `unlock` slot that comes back `done` with `code:
  "recovery_cancelled"` and `cancelled_recovery_id`, copied by the host
  from the enclave's answer. The API reads them only on a slot whose
  `op` is `unlock`;
- **the vault row**: `recovery_cancelled: {recovery_id, at}`, which the
  host writes from that unlock's lifecycle event. It is the backstop for
  an answer that was lost before its slot was written
  (VAULT-MESSAGING §11.5: a timed-out call or a parent that stopped
  meets the replay set on redelivery, and that answer has no code). The
  host overwrites it at the next such unlock and never clears it; the
  API only reads it.

Either source ends **only the recovery whose `recovery_id` equals the
named id**. The queue is not ordered, so the recovery that was current
when the API queued the unlock may not be the one the enclave ended:

- an unlock queued under R2 can run before R2's own `recovery` and end
  R1. It must not end R2 here, or the API would show R2 cancelled while
  the enclave still holds it, and mail the member;
- an unlock queued under R1 can run after R1's cancel and R2's request,
  and end R2. R2 must then end here too.

**Finding the sources.** These only say where to look; they never
decide which recovery ends:

- when the unlock route queues an `unlock` while the vault's recovery is
  active, it records that recovery's id on the slot (`recovery_id`) and
  the request id on the recovery (`unlock_ids`, the latest 10, appended
  with a conditional field update on the same `recovery_id`, never by
  replacing the recovery). Such a slot lives as long as the recovery
  plus an hour, `max(REQUEST_TTL_S, expires_at + 3600 - now)`, as an
  open's slot does, so a sweep outage longer than 15 minutes does not
  lose it;
- the vault row is read on every recovery path anyway.

**The notice, claimed first.** All the work for one cancelled recovery
goes through one notice row in the request table, `rcnotice#<recovery_id>`
(TTL: the recovery's `expires_at` plus one day). It follows
`noticeAttempt`'s claim, work, record:

1. **Claim.** A conditional update of the notice row sets `noticing`
   and counts `notice_tries`, only when it has no `noticed_at` and no
   `noticing` newer than `ATTEMPT_RETRY_S` (5 minutes). A caller that
   fails the condition stops: the notice is done or under way. After
   `ATTEMPT_MAX_TRIES` the notice is given up, recorded with
   `notice_failed` and logged.
   - **A new notice row is opened only for a live recovery**: when the
     named recovery is the vault's current one and still `pending` or
     `registered` before its `expires_at`. Otherwise a caller may only
     take up an existing row that has no `noticed_at` (a claim that
     stopped). Once the cancel write has run, the recovery is
     `cancelled` for good, so neither the row's `recovery_cancelled`,
     which the host never clears, nor a later move of `expires_at`, nor
     the expiry of the notice row can open a second notice or send a
     second email. The row's TTL is the later of `expires_at` and now,
     plus one day, so a stalled claim outlives its retries.
     (Chosen over recording the email on the recovery,
     `cancel_mailed_at`: the email's state stays in one place, as for
     `noticeAttempt`, and the check that opens a notice is the same
     condition as the cancel write.)
   - **An already ended recovery** opens no notice row. A slot whose
     marker names the vault's current recovery that has ended (for
     example, cancelled from the site a moment before), or a recovery
     that is no longer the vault's, is claimed by its own
     `cancel_noticed_at` (a conditional update, `attribute_not_exists`).
     Only that claimer audits `vault.recovery_cancel_seen`. So the audit
     is written once per slot, whatever polls and sweeps follow, and
     never for the row's `recovery_cancelled` alone, which can be read
     again long after the slot is gone.
2. **Work.**
   - The completion check runs first (2.4.1), as for the cancel routes:
     a recovery that has in fact completed is recorded `completed`.
   - Then the **cancel write**, a conditional field update of the
     vault row (below) with `cancelled_via: "app"`.
   - When that write succeeds, or when the recovery already reads
     `cancelled` with `cancelled_via: "app"` (a claim taken up again
     after it stopped between the write and the email), the claimer
     audits `vault.recovery_cancel` (`via: "app"`, `vault_id`,
     `recovery_id`, the unlock's `request_id` when known, `source:
     slot | row`) and sends the email with `sendMail`. A failed send
     throws and leaves the claim to be taken up again, unlike
     `notify()`, which would lose it.
   - Otherwise the recovery ended between the claim and the write
     (replaced, cancelled from the account site, `completed`,
     `unavailable`, or past its `expires_at`). Nothing changes and
     nothing is mailed. The claimer audits `vault.recovery_cancel_seen`
     (`vault_id`, `recovery_id`, `ended`: the state it found, or
     `replaced`).
   - No `recovery_cancel` is enqueued: the vault has already ended the
     recovery.
3. **Record.** `noticed_at` is set and `noticing` removed. The slot, if
   it still exists, gets `cancel_noticed_at`, so that the sweep skips
   it.

A claim taken up again after a failure may audit twice. That errs on
the side of the record, as `noticeAttempt` does.

**The cancel write, for every cancel.** The session route, the link
route and this notice all end a recovery with the same conditional field
update. None of them uses `setRecovery`, which replaces the whole
`recovery` map:

```
SET recovery.#st = :cancelled, recovery.cancelled_via = :via, recovery.cancelled_at = :now, updated_at = :nowIso
IF  recovery.recovery_id = :id AND recovery.#st IN (:pending, :registered) AND recovery.expires_at > :now
```

`pending` and `registered` are the row's states; `available` follows
from the clock. Whichever side wins, there is exactly one cancel, one
`vault.recovery_cancel` audit and one email:

- the routes enqueue, audit and mail only when their update succeeds,
  and answer `{cancelled: false}` when it fails because the recovery
  ended meanwhile;
- the notice mails only as above.

An `unlock_ids` append that races a cancel cannot be lost, and cannot
undo the cancel, since neither write replaces the map.

**Where the sources are read:**

- when the app polls `GET /api/vault/requests/{id}` for that unlock,
  which it always does to read its result;
- in `GET /api/vault/recovery` and `/api/vault/status`, before they
  answer. They read the row's `recovery_cancelled` and the slots of the
  active recovery's `unlock_ids`;
- in `POST /api/vault/recovery`, the same, before a request is refused
  `409 recovery_active`, so that a recovery cancelled from the phone
  never blocks a new one;
- in the 5-minute sweep (`lambda/jobs/vault-attempts.ts`). It scans the
  request table for `unlock` slots with `cancelled_recovery_id` and no
  `cancel_noticed_at`, and for notice rows whose claim stalled. It scans
  the vault table, projecting only `vault_id`, `recovery` and
  `recovery_cancelled`, for rows whose `recovery_cancelled.recovery_id`
  is the id of a recovery that is still `pending` or `registered`. The
  job's metric gains `RecoveryCancelsUnnoticed`.

**A cancel names its recovery** (VAULT-MESSAGING 0.49.0 §11.14.8;
approved by the owner (2026-10-19)). A cancel from the
account site that reaches the enclave after a newer recovery's request
would end the newer one in the vault while this API still shows it
pending. So, when the instance the cancel goes to runs a release at
least `RECOVERY_CANCEL_ID_FROM_RELEASE` (a stack setting, as
`TIME_SCALE_FROM_RELEASE`; unset, never), the `recovery_cancel` carries
`recovery_id` and the API signs the eight-line string. Otherwise it
sends the seven-line form, which older releases verify and which cancels
whatever is in progress. A named cancel that finds another recovery or
none comes back with the slot code `recovery_not_current`. Nothing in
the API reads a cancel's slot (`recovery_cancel` is not in
`POLLED_OPS`, and no job reads it), and no action is needed: the API
ended its own record before it queued the cancel. The code serves the
operator's logs and the vault's tests. A named cancel sent to a release
that is too old fails the signature and is ignored silently: the
enclave keeps the recovery while the API shows it cancelled. That is
safe but silent, so the setting is changed only after a staging test of
both forms at the boundary release. The signer,
`lambda/shared/recovery-sign.ts` (`recoveryRequestSigningString`),
gains the optional `recovery_id` and the eight-line form, tested against
the new `recovery.json` vectors (VAULT-MESSAGING §16).

**Email** (draft for the owner's wording). Subject "VettID vault
recovery cancelled", the subject of the other cancel emails. Body:

> The recovery of your VettID vault requested at {requested_at} was
> cancelled from your VettID app, which unlocked the vault with your
> PIN. Your apps can unlock the vault again.
>
> If you did not do this, someone else may have your phone and know your
> PIN. Sign in to your account page and request a new recovery, and
> change your PIN once your vault is back on a phone you hold.

**Account site.** No new text: a cancelled recovery reads as one
cancelled from the account site does.

**Permissions** (as 2.7.0 named them; tested in
`test/vault-stack.test.ts` and `test/account-admin-stacks.test.ts`):

- **The host** (`lib/stacks/vault-stack.ts`) may also write
  `recovery_cancelled` on the vault table (its `UpdateItem` attribute
  list) and `cancelled_recovery_id` on the request table (its slot
  attribute list). The test lists both, and asserts that no member API
  role may write `recovery_cancelled`.
- **`vault-attempts`** (`lib/vault/access.ts`):
  - an `UpdateItem` statement on the request table with `leadingKeys:
    ['rcnotice#*']` and only the notice's attributes (`request_id`,
    `vault_id`, `user_guid`, `recovery_id`, `noticing`, `notice_tries`,
    `noticed_at`, `notice_failed`, `expires_at`). It is the one update
    of this job that may create an item;
  - `cancel_noticed_at` and `cancelled_recovery_id` added to its slot
    `UpdateItem` attributes (the second because its conditions name
    it);
  - a `Scan` of the vault table limited to `vault_id`, `recovery` and
    `recovery_cancelled`, with the conditions the host's P15 Scan uses
    (`ForAllValues:StringEquals` on `dynamodb:Attributes`, `Select`
    `SPECIFIC_ATTRIBUTES`, and `Null` false);
  - its vault-table `UpdateItem` stays `vault_id`, `recovery` and
    `updated_at`.
- **`vault`**: no change. Its vault-table writes stay its own attributes
  (`recovery` covers `cancelled_via`, `cancelled_at` and `unlock_ids`),
  and it only reads `recovery_cancelled`. Its request-table access is
  not limited by attribute, as before, so it can write the notice rows
  and the slot attributes.

**Tests to expect.**

Member API (`test/lambda/vault.test.ts`; the sweep in
`test/lambda/jobs.test.ts`):
- a marker whose `cancelled_recovery_id` differs from the slot's
  `recovery_id` ends the named recovery when it is the vault's, and
  ends nothing (`vault.recovery_cancel_seen`, `replaced`) when the
  vault's recovery is another;
- the row's `recovery_cancelled` alone (no slot, as after a lost answer)
  ends the matching recovery once; the slot and the row together end
  it once, with one audit and one email;
- the "already ended" path (cancelled from the site, completed,
  unavailable, expired) audits `vault.recovery_cancel_seen` once per
  slot, across repeated polls, status reads and sweeps, and mails
  nothing; the row's `recovery_cancelled` alone never audits it;
- after the cancel was mailed, a later `GET /api/vault/recovery` or
  `/status`, with the row's `recovery_cancelled` still set, opens no
  notice and mails nothing: after the notice row's TTL, and after
  `expires_at` was moved by an attempt;
- the signer's seven- and eight-line strings match the `recovery.json`
  vectors;
- a claim that stopped after the cancel write and before the email is
  taken up after `ATTEMPT_RETRY_S` and mails; a failed send is retried;
  after `ATTEMPT_MAX_TRIES` it is given up and logged;
- the sweep notices a marker on a slot older than 15 minutes (the
  slot's lifetime follows the recovery), and a row-only cancel;
- an `unlock_ids` append concurrent with a site cancel: both writes
  land, the recovery reads `cancelled`, and the next poll of the unlock
  slot changes nothing;
- a site cancel and a phone cancel of the same recovery: one cancel,
  one `vault.recovery_cancel`, one email; the losing route answers
  `{cancelled: false}`;
- `POST /api/vault/recovery` after a phone cancel that nobody polled
  answers `202`, not `409 recovery_active`;
- no `recovery_cancel` is enqueued for a phone cancel;
- a site cancel to an instance at or above
  `RECOVERY_CANCEL_ID_FROM_RELEASE` carries `recovery_id` and the
  eight-line signature, and below it the seven-line form; unset, never;
- the marker on a slot whose `op` is not `unlock` is ignored.

Vault (vettid-vault):
- a cancel with a persist failure gives no marker and no lifecycle
  field;
- a marker naming another recovery than the API's slot;
- a lost answer whose lifecycle event is still written;
- `recovery_cancel` with a mismatched id cancels nothing and answers
  `recovery_not_current`;
- a seven-line cancel keeps the old rule;
- a changed or stripped `recovery_id` fails the signature.
- `recovery_not_current`, with no envelope, passes `ParseResponse` and
  reaches the cancel's slot, and on no other operation;
- the abandon path puts the id on `unlocked` only; a completed move on
  `moved`; the field crosses `internal/vaultipc`;
- the seven- and eight-line `recovery.json` vectors.

### Locks (2.5.0; VAULT-MESSAGING 0.29.0 §11.5, VAULT-LOCK)

*Approved by the owner 2026-10-12; not implemented yet. It describes
the routes as they are from the deploy that accompanies the vault's
release L; until then they behave as 2.4.2 describes.*

- **`POST /api/vault/lock`** `{vault_id, request_id, unlock_id?}`.
  Callers and limits are unchanged: the account session, the app key
  or a recovering key, whatever the account's state; 30 in 15 minutes
  per member. `unlock_id`, when present, MUST be 32 lowercase hex
  characters (`400 bad_request` otherwise). The API does not know
  whether it is right; it copies it into the queue message.
  - **With `unlock_id`: a bound lock.** The vault locks only if the
    value names its current unlock (VAULT-MESSAGING §10.2 "Locks").
    Only the app has the value, from its unlock result.
  - **Without: an unconditional lock.** This is what the account site
    sends, what a recovering app sends, and what an app sends when it
    does not hold the value. The enclave carries it out only if the
    message's `enqueued_at` is later than that of the unlock that
    opened the vault (§11.5), so a lock that waited in the queue cannot
    lock a vault opened since.
  - The message goes to the instance that holds the vault's live
    lease. **When no instance holds it** the API queues nothing and
    writes the slot itself, as before, now as `done` with
    `code: "not_running"`.
- **The slot.** `status` is `queued`, `done` or `expired` as before.
  For a lock, `done` carries a `code`, written by the vault's host from
  the enclave's answer (or by the API in the case above):

  | `code` | Meaning | What a caller does |
  |---|---|---|
  | `locked` | the vault was running and has been locked | the lock is confirmed |
  | `not_running` | no instance was running the vault | the lock is confirmed: there was nothing open |
  | `stale` | the vault is open under a newer unlock; nothing was done | the app: its own unlock is over, the lock it asked for is finished. The account site: ask again (a new request is queued now, and so is newer) |
  | (none) | the vault's release is from before L: the message was read; whether the vault locked is not known | read the status |

  `expired`: the request was not carried out in time (the instance
  went away, or the queue did not deliver it); ask again.
  The API passes on these three codes for a slot whose `op` is `lock`
  and for no other, beside the codes it already passes (§11.5).
- **These answers are the host's word**, like everything in
  `VaultStatus`: the slot is written by the vault's host, which the
  vault's design does not trust for more than availability
  (VAULT-MESSAGING §13.3). An app that has the vault's own answer over
  the relay prefers it.
- **`VaultStatus.locked_basis`**, present when `state` is `locked`:
  - `reported`: the row says `locked` because the vault's host
    recorded a lock or a stop (the lifecycle event `locked`, or the
    stop notice, §11.5 "A stopped vault is locked");
  - `no_lease`: the row says `unlocked` but no instance holds a live
    lease, so the API reports `locked` (the rule since 1.1.0). Nothing
    reported a lock. A vault runs only under a live lease, so this
    means "no vault is running" once leases are current (within
    180 s of a host's failure).
- **Audit.** `vault.lock_request` also records whether the request was
  bound (`bound: true|false`), never the value.

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
  while the vault is `unlocked` or leased. 2.5.0 (with release L, "Locks"): the
  site's lock carries no `unlock_id` (it is unconditional), and the
  site says what the slot says: `locked` or `not_running`, "Your vault
  is locked."; `stale`, it asks once more by itself and then, if still
  stale, "Your vault was opened again just now. Lock it again if you
  want it closed."; `done` without a code, `expired` or no answer in
  30 s, "We asked your vault to lock but couldn't confirm it yet.
  Check the status in a minute." (as today; before 2.5.0 `done` alone
  showed "Your vault is locked."). The release log link is the
  stage's own log (`release_log_url` in `/config.json`,
  `https://<zoneName>/security/releases/`).
- **`/account/vault/recovery/`** (gated): the request
  (`browser_key` from a WebCrypto P-256 pair made **non-extractable**,
  kept in IndexedDB `vettid-vault-recovery`, store `keys`, keyed by
  `recovery_id` once the API answers; an unbound key survives a lost
  answer and is tried when the code is opened), the 24 h countdown and
  cancel, and, while `available`, the code: opened in the page (ECDH
  `deriveBits`, HKDF-SHA-256, AES-256-GCM, all WebCrypto), drawn as the
  §11.11.2 QR payload (with `api`, 2.0.0) by the vendored qrcode-generator 2.0.4 (MIT,
  `js/vendor/`, checksum pinned in `test/site-vault.test.ts`) and, 2.4.0,
  as the **typed form** of VAULT-MESSAGING 0.25.0 §11.11.10 under
  "Can't scan? Type this code in the app": the API's `locator`, the
  code and 4 check characters (the first 20 bits of SHA-256 over
  `"vettid/vms/2/recovery-typed-check" || 0x00 || location.origin ||
  0x00 || locator || code`, computed with WebCrypto), 48 characters
  as twelve groups of four in three rows, each group its own element,
  with "The code has no I, L, O or U" and no copy button. The bare
  32-character text shown until 2.3.2 is removed. Without a `locator`
  (a recovery requested before 2.4.0) only the QR is shown, with
  "To type the code instead, cancel this recovery and start a new
  one". The check characters are never sent. The code is decrypted only when the member
  presses **Show the code** and is removed from the page on **Hide**, on
  any re-render and on `pagehide`; it is never sent, logged or stored.
  Polling `GET /api/vault/recovery` is at most once a minute (once every
  15 s while `available` without `sealed_code`). A browser without the
  key (another browser, a private window, cleared site data) is told so
  and offered cancel and a new request. Keys of ended recoveries are
  deleted. The seal is opened with the recovery's own `vault_id`. A
  `registered` recovery is shown as "used on your new phone", without a
  code (its key is deleted), with cancel while it is active. A
  `completed` recovery (2.4.1) is an ended one: the page offers a new
  request, under "Your last recovery, requested …, was completed on
  your new phone", and a page that was open while it completed says
  "Your vault was recovered on your new phone."
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
  `alarm.emailed_at` or (2.7.1) `alarm.handled_at` (conditional update),
  and read `members`. The member
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
  deletes the vault row (condition: `state = deleted` and, 2.7.1, no
  `att_sweep_pending`) and the pointer row `user#<guid>` if it still
  names this vault, so the member's next enrollment is a fresh one with
  a new `vault_id`.
- **Rows kept for the attachment sweep** (2.7.1; VAULT-HOST-PROTOCOL
  P15, from the vault's release A). The parent's update that marks the
  row `deleted` also sets `att_sweep_pending = true`, and the parent
  removes it once it has deleted every object under
  `vaults/<vault_id>/att/`; a parent that restarts finds the sweeps
  left pending by that attribute. While it is set, the row's delete
  fails its condition: the Lambda then stamps `alarm.handled_at`
  (epoch seconds; condition: the same `alarm_id`) and keeps the row.
  The vaults stream's second filter for the Lambda passes the records
  whose new image has `state = deleted`, no `att_sweep_pending` and an
  `alarm` of kind `vault_deleted` with `handled_at`; for those the
  Lambda deletes the row under the same condition, and mails, claims
  and audits nothing. The parent's removal of `att_sweep_pending` is
  such a record (or the stamp itself, when the sweep finished first).
  The stamp is what keeps a row whose notice may still be retried (a
  failed send) from being removed. A row still pending is listed by
  RUNBOOK "Vault attachment sweep".
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
- **Vaults without a member (2.6.5).** The member row goes first, and
  the vaults are asked after it; a run that stops in between would
  leave vaults that nothing names any more. So each daily run also
  scans the vault rows that have an owner, are not `deleted` and have
  no `deletion_requested_at`, and reads each owner's member row (a
  consistent read). Nothing irreversible happens at first sight:
  - A vault whose member row is missing gets `orphan_seen_at` (a
    conditional write; a mark is never moved), counted as
    `OrphanVaultsSeen` and alarmed, so that an operator hears of it
    while the vault still exists.
  - When the member row is still missing 7 days or more after the
    mark of every one of that member's vaults, the run does what the
    account deletion does: each vault is asked to delete itself as
    above, a never-sealed row and the pointer row are deleted, and the
    audit event `vault.orphan_deletion_requested` (actor `system`,
    subject the `user_guid`, detail `vault_ids`, `orphan_seen_at`) is
    written; from then on the daily retry has them.
    `OrphanVaultDeletions` counts these and is alarmed.
  - A member row that is back removes the mark.
  - An operator can keep a vault without a member by setting
    `orphan_hold: true` on its row by hand (RUNBOOK "Vaults without a
    member"); a hold on any of a member's vaults keeps all of them out,
    marked or not (`OrphanVaultsOperatorHeld`). Any `orphan_hold`
    attribute counts as a hold, whatever its type or value (one that is
    not the boolean true is logged as a warning). The job never writes
    it.
  On doubt nothing is written: a member row that cannot be read leaves
  its vaults for the next run; and a run that finds more members
  without a row than 5, or than 15 % of the owners it read (one is
  always allowed), marks and asks none of them, at every run until
  that is no longer so. That protects against a wrong or damaged
  members table, above all one restored from an older backup, in which
  every member who joined since would look gone; the 7 days cover
  what the limits miss. `OrphanVaultsHeld` counts what was held,
  unreadable or failed, and is alarmed. All five metrics are written at
  every daily run (namespace `VettID/MemberApi`, no dimensions); the
  three alarms (`vettid-org-orphan-vaults-seen`,
  `-orphan-vault-deletions`, `-orphan-vaults-held`) go to the
  security-alerts topic in production. The first daily run after 2.6.5
  is deployed only marks the vaults already without a member, and
  deletes nothing for 7 days. An admin's Delete refuses while the
  member has a vault (ADMIN-API "People"), so it does not leave one
  behind.
- **Resume (2.10.0; VAULT-MESSAGING 0.51.0 §12.5, VAULT-HOST-PROTOCOL
  0.1.14).** A vault deleting itself (by its app's `vault.delete`, or on
  the host's `delete`) has the parent write **`deleting_at`** (epoch
  seconds) on its row once the marking flush is stored, whatever the
  lease and only once; it tells no device before that write. If the
  deletion then stops before `deleted` (a crash, a host failure, a
  store error), the row would otherwise stay as it is: the app sends
  nothing more, and only the host's `delete` of an account
  cancellation or a start-over is retried.
  - **The run.** The 5-minute cleanup run (the one that carries out
    start-overs) scans the vault rows with `deleting_at` that are not
    `deleted`. For each whose `deleting_at` is at least **2 minutes**
    old it sends the queue operation **`delete_resume`** (§11.5 SQS
    message: `v`, `op`, `vault_id`, `user_guid`, `request_id`,
    `enqueued_at`; no envelope), routed exactly as `delete` is (the
    leaseholder, else a live instance of `sealed_release`, requesting
    a start when none runs; nothing while the vault service is paused
    or to a `removed` release), and sets `deletion_resumed_at` (epoch
    seconds) on the row. It sends again at every run while
    `deleting_at` is less than 1 hour old, and after that when
    `deletion_resumed_at` is at least 1 hour old. No response slot is
    written or read: the vault's `deleted` report is the result, and
    its notice removes the row as above.
  - **Logged.** A row still not `deleted` 1 hour after `deleting_at` is
    logged (`vault deletion resume pending`, `vault_id` only) and
    counted in the metric `DeletionResumesPending` (namespace
    `VettID/MemberApi`, written at every run), and again daily after
    30 days (`DELETION_STALE_S`), as for `delete`.
  - **Never `delete`.** The run never sends the unconditional `delete`
    because of `deleting_at`, and never sets `deletion_requested_at`
    for it. `deleting_at` is written by the host, so it is advisory:
    `delete_resume` makes the enclave erase only a vault whose own
    sealed header records the deletion (or one already erased), and a
    forged or stale mark costs at most resumes that do nothing; it is
    never shown to the member. The parent removes the mark on an
    `unlocked` report.
  - **Never shown.** The mark is host-written, and the host is not
    trusted, so nothing a member sees depends on it: a forged or faulty
    mark must not be able to tell a member that a healthy vault is being
    deleted, or hide their recovery options. `deleting_at` and
    `deletion_resumed_at` are read only by the cleanup run, its log and
    its metric. `GET /api/vault/status` reports the row's own `state`
    (`locked`, `unlocked` …) whatever the mark, as before; a `deleted`
    row reads `{vault: null}`, and once the row is gone the app key is
    refused `401`. The account site shows no "being deleted" text and
    offers recovery and start-over as normal. That is safe: a recovery
    or an unlock that opens a vault whose sealed header or state records
    `deleting` finishes the deletion instead of running the vault
    (VAULT-MESSAGING §12.5 "A state that records `deleting` never
    runs"), and a start-over is the member's own explicit request. The
    apps show "being deleted" only after the vault's own
    `device.unlinked{vault_deleted}` (ANDROID-PLAN 0.1.54 §4, IOS-PLAN
    0.1.12 §4.2); they never derive a deletion from this status. No
    route refuses anything new because of the mark. A setup code is
    refused as for any confirmed vault until the row is gone.
  - **IAM.** The host role may write `deleting_at` (and remove it); the
    cleanup job reads it and writes `deletion_resumed_at`.
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
| POST | `/api/vault/deletion/cancel` | `{deletion_id}` (portal session, or the vault's app signed by its `app_key`; 2.6.2: whatever the account's status) | `200 {cancelled: boolean}` |
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
  cancel link
  (`https://account.vettid.org/vault/deletion/cancel#t=<token>`, stored
  as its SHA-256 in a request-table row that expires at `deletes_at`).
  The link is not used up by a cancel (2.6.4, as built): it stays
  usable until `deletes_at`, a use after the deletion was cancelled
  answers `{cancelled: false}`, and from `deletes_at` it answers `404`.
  Nothing is enqueued and the vault is not locked.
- **Cancel** (session, link or app): conditional on `state = pending`;
  removes the record, emails the member, answers `{cancelled: true}`;
  otherwise `{cancelled: false}`. The app sees `deletion` (with its
  `deletion_id`, 2.1.1) in `GET /api/vault/status` and offers the
  cancel. 2.6.2: all three work whatever the account's status
  (suspended, canceled), because a cancel only keeps the vault as it is
  ("Access"). `GET /api/vault/deletion` and `status` still need an
  active account, so a suspended member's app or page cannot read the
  `deletion_id` after the suspension: in practice a suspended member
  uses the email link, which stops working at `deletes_at` as before, or
  asks support (ADMIN-API,
  `POST /admin/members/{user_guid}/vault/deletion/cancel`).
- **Execution.** The cleanup job (every 5 minutes) looks at each
  `pending` deletion past `deletes_at` and does one of three things.
  1. **Carried out**, if the member's account is active: it sets
     `executing` (conditional) and enqueues the operation `delete`
     exactly as for an account cancellation (below;
     `deletion_requested_at`, retries, the 30-day log). The
     `vault_deleted` notice emails the member and deletes the rows; the
     portal then offers **Set up your vault** (a new setup code).
  2. **Held**, if the account is not active: the deletion stays
     `pending`, neither carried out nor cancelled, however long ago
     `deletes_at` was (below).
  3. **Left to the daily retry**, if the vault row already has
     `deletion_requested_at`: the account's own deletion has asked this
     vault to delete itself (the member row is gone by then). The
     5-minute run neither holds it nor sets `executing`; the vault is
     deleted by the account deletion's retries.
- **Held: only an active account's deletion is carried out (2.6.2).**
  Before it sets `executing` the job reads the member's row (a
  consistent read) and holds the deletion for one of three reasons,
  which it writes as metrics at every run (namespace `VettID/MemberApi`,
  no dimensions): `StartOverHeldNotActive` (the account is suspended or
  canceled, or the row is not an account), `StartOverHeldNoMember` (no
  member row, or no owner on the vault row) and
  `StartOverHeldReadError` (the row could not be read). The 24 hours
  exist so that the member can cancel, and suspending an account is
  what support does when it looks taken over. On doubt nothing is
  deleted. `StartOverHeldNoMember` and `StartOverHeldReadError` are
  alarmed after three runs in a row (alarms
  `vettid-org-start-over-held-no-member`, `-read-error`; production:
  the security-alerts topic); a deletion held for a suspended or
  canceled account is not alarmed. A deletion with no member row is
  never carried out by this run; 2.6.5: the daily run marks its vault
  and, if the member row is still missing 7 days later and no operator
  holds the vault, asks it to delete itself as for a canceled account
  ("Vault deletion", Vaults without a member), after which this run
  leaves it to the daily retry (RUNBOOK).
- **What the hold does not cover.** A deletion that is already
  `executing` is not held back by a later suspension, including one
  whose `delete` could not be queued yet. The members table and the
  vaults table are in different AWS accounts, so the job's read and its
  write are not one transaction: a suspension whose status is written
  after the job read the row as active, and before the job's write,
  does not stop that deletion. The admin API's `suspend` writes the
  status before anything else, so the hold begins with that write.
- **Reinstating the account cancels the deletion (2.6.2).** When an
  admin reinstates the account (from suspended or canceled), a deletion
  still `pending` is cancelled first, while the account is still not
  active, and the member is emailed that it was. A deletion that waited
  through a suspension is therefore not carried out on its old date.
  This holds because the admin API's `reinstate` is the only thing that
  makes an account active again; anything added later that does so must
  cancel a pending deletion first. A member who wants to start over
  asks again and gets a new 24 hours and a new link. If the cancel
  cannot be made, the account is not reinstated.
- **A canceled account.** Its pending deletion is held like a suspended
  account's; its vaults are deleted with the account after the 7-day
  grace period, as for every canceled account ("Vault deletion",
  Account cancellation), whether or not a start-over was pending (case
  3 above from then on).
- **An admin can cancel** a pending deletion for the member, whatever
  the account's status (ADMIN-API,
  `POST /admin/members/{user_guid}/vault/deletion/cancel`): removal
  under the same condition as the member's cancel (the same deletion,
  still `pending`), decided from consistent reads of the member's
  pointer row and vault rows; an email to the member; the audit event
  `member.vault_deletion_cancel`. Unlike the member's cancel it does not
  set the vault row's `updated_at`.
- **Rate limits:** request 3 per member per day; cancel 30 per member
  per 15 minutes; the link 20 per source network per 15 minutes.
- **Audit:** `vault.deletion_request`, `vault.deletion_cancel` (`via:
  session | link | app`), `vault.deletion_executed`. Never the token.
  2.6.2: `member.vault_deletion_cancel` (actor: the admin; detail
  `vault_id`, `deletion_id`, and `on: "reinstate"` when a reinstatement
  made it) for a cancel by an admin. The existing events are unchanged.
  A held deletion writes no event; the job's metrics count them. The
  function that makes an admin's cancel also logs
  `{"startOverCancel": {user_guid, vault_id, deletion_id}}` for each
  record it removes, so a record exists if the audit event could not be
  written.

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
notice can delete vault rows. The admin API holds no right in the vault
account: to cancel a member's pending deletion it invokes a second
function of the member API, which runs only that task (event `{task:
"cancel_start_over", user_guid}`; any other task is refused) under the
cleanup job's role `vettid-org-member-cleanup`. The admin API cannot
invoke the cleanup job itself. The cleanup job's role may read a
member's row (`GetItem`) to learn whether the account is active; it can
delete member rows, as before, and cannot put or update one. These limits are enforced twice: by the
three functions' IAM policies here (fixed role names
`vettid-org-member-vault`, `-cleanup`, `-vault-alarms`) and by the vault
account's table, stream and queue resource policies, rendered from the same
matrix (`lib/vault/access.ts`). Table names, the queue prefix and the queue
policy the parent applies are published under `/vettid-org/<stage>/vault/`
in the vault account for the enclave host.
