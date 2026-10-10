---
title: VAULT-MESSAGING
status: draft
version: 0.23.3
date: 2026-10-10
owner: Al Liebl (Mesmer)
component: vault manager (enclave), parent forwarder, apps, desktops, agents, member API vault routes
related:
  - RELAY-PROTOCOL.md (0.6.0)
  - RELAY-PLAN.md
  - PQC-MIGRATION.md
  - CALLING-SERVICE.md
  - PUSH-GATEWAY.md
  - ACCOUNT-ADMIN-PLAN.md
  - MEMBER-API.md (2.3.1)
  - ANDROID-PLAN.md (0.1.17)
  - ENROLLMENT-CODES.md (0.2.3, design note for 0.15.0)
  - PROTEAN-CREDENTIAL.md (0.1.2)
  - VAULT-ITEMS.md (0.1.2; 0.1.0 approved 2026-10-03)
  - VAULT-RELEASES.md (0.1.6, approved 2026-10-04)
  - RELEASE-UPDATES.md (0.2.0)
changelog:
  - 0.23.3: editorial-normative, from the staging S8 canary of
    2026-10-10 (pending owner approval): an unlock of a vault that is
    already unlocked locks it and opens it again in the same request
    (stated, unchanged; §11.4); the lock that request makes keeps the
    lease the request took, which is released only if the vault does
    not open (§11.1); apps ignore a `vault.locking` whose `ts` is not
    later than that of their latest successful unlock result (§10.2,
    §11.4)
  - 0.23.2: additive (owner decision of 2026-10-09, §15 item 31.14):
    History records which device opened and locked the vault.
    `vault.unlocked` carries `device_id`, the app whose unlock (§11.4)
    opened the vault, also the confirming unlock at a move's new
    release and an abandonment (§11.10.4); `vault.locked` carries
    `device_id` when an owner device's `vault.lock` locked the vault,
    and none for any other lock; `owner_check.held` stays without one.
    Older entries are unchanged; the chain already covers `device_id`
    (§10.9)
  - 0.23.1: editorial-normative, errata to 0.23.0 from its
    implementation (vettid-vault #52; owner decision of 2026-10-09,
    §15 item 31.13): `tag.merge`'s `shares` carry `ask_rule_id` (§10.8);
    a suppressed ask's answer is due at the earlier of the random delay
    and 1 minute before `exp`, never before now, and one due while the
    vault is locked is sent after unlock; a later ask of a batch whose
    feed item is read or archived updates `count` and `seq` and keeps
    the status, and a deleted item starts a new batch;
    `connection.asks.resume` always clears the decline history and
    cooldowns, ends a pause if any, and is audited even when nothing was
    paused; each entry removed for a cooldown is its own
    `drop.ask_cooldown`, even when the reduced request is then
    suppressed; `sync.event{connection.changed}` for ask state carries
    `connection_id` and `version` and goes to every owner device
    (§10.4.1); a suppressed location request does not use location's
    allowance (§10.16); a rule's windows count only fetches through the
    item's rule grants, also while the rule has no limits, so a limit
    set later applies to the open window; a repeated `fetch_id` is
    answered again even while a window is full; `retry_after` is at
    most 86,400; a received `limits: {}` means no limits (§10.12)
  - 0.23.0: normative (owner decisions of 2026-10-09, §15 item 31):
    connection share rules take `per_hour` and `per_day` (1–3,600 and
    1–86,400, optional, no default): the connection's fetches of the
    rule's items in total, in fixed windows from the first fetch as
    for agents; past a limit `data.value{error: "rate_limited",
    retry_after}`, audited, with at most one `share.rate_limited` feed
    item per rule per 24 h; `limits` on grants and descriptors (§10.12).
    Overlapping rules of one subject: `ask` wins; an item is shared
    only after the member's approval if any covering rule is `ask`; one
    answer per item and subject; no silent withdrawal; removing an
    `ask` rule never shares anything; rate limits and `uses` combine
    strictly (a fetch counts a use on every rule grant of the item, all
    spent together); rules named by their tags;
    `ask_rule_id`, `shared` and `outcome` in previews and pending
    entries, and the app explains it (§10.7, §10.11, §10.12). Errata to
    0.22.0 (vettid-vault #50): `audit.export`'s full order of checks,
    the §3.6.3 gate and the holder check before the alarm,
    `bad_request` at once without a spendable UTK, the empty-log
    preview (§10.9); a responder leaves a new epoch's message that
    arrives before `hs.fin` unacked, a MUST for devices too (§6.3,
    §6.5). Owner's review of #181 (§15 item 31.12): a connection's asks
    (grant requests, critical-item uses, `prompt-each-time`
    invocations, authentication challenges, introduction offers,
    location requests) are suppressed while muted or paused, for 7 days
    after a decline of the same ask, beyond 8 pending or 5 per 24 h; 3
    declines in 30 days pause them (one feed item); `connection.asks.mute`
    and `.resume`; 10-minute batches; a suppressed ask gets the decline
    answer after a random delay, so the connection cannot tell them
    apart; `drop.ask_*` audit kinds (§10.4.1). Editorial: `"format":
    "month"` on a template's `date` field (§10.7, VAULT-ITEMS 0.1.2)
  - 0.22.0: normative (owner decisions of 2026-10-08, §15 item 30):
    History export, a deliberate exception to the 2026-10-03 decision
    of no export of vault data, for activity metadata only. The holder's
    app sends `audit.export` with `audit.list`'s filters: a dry run
    counts the entries (at most 10,000, newest first, `more` beyond),
    then the export carries the UTK-sealed PIN, which the vault checks
    under the §11.8 backoff only (not a failed owner check),
    audits `audit.exported` with a summary in `ref` and answers the
    bound `upto_seq`; the app reads the entries with `audit.list` and
    writes CSV or JSON (formats defined here), saved only through the
    platform's "Save to…" and unencrypted. App only: desktops are
    refused, agents never get `audit.*`; refused while a clone alarm
    is open (`credential_frozen`, `rotation_required`) (§3.5.4, §3.5.6, §10, §10.9,
    §10.11, §10.16, §13.5)
  - 0.21.1: editorial-normative, errata to 0.21.0 from its
    implementation (vettid-vault #47; owner decision of 2026-10-08,
    §15 item 29.7): a dry run follows the access rule of the call it
    previews but never needs step-up, so a desktop may dry-run
    `item.tag` of a critical item but not `item.put` (`forbidden`);
    `item.put`'s dry run requires `version` with `item_id`; more than
    64 fields is `bad_request` for every sensitivity (the separate
    critical 64-field limit, which the general check always reached
    first, is gone), and the critical forms are listed exactly (§10.7,
    §10.1); a move to `critical` checks the size of the item as it
    will be stored (§10.7); `kind` may be absent from requests that
    arrived before 0.21.0, and receivers treat it as unknown; an
    incoming use is checked usable, then suitable, then against the
    pending cap (§10.13)
  - 0.21.0: normative (owner decisions of 2026-10-08, §15 item 29),
    gaps found while implementing 0.20.0 (vettid-vault #46) and the
    app's items, sharing and grants (vettid-android A5, #78–#80);
    MEMBER-API 2.3.1: an `item.put` replacing an item of any
    sensitivity keeps the stored value of a field sent without `value`
    and the notes with `keep_notes`, so that editing a critical item is
    one credential operation and a secret item needs no reveal;
    `item.get` returns the item's `size` (§10.7); a field that cannot hold an Ed25519
    seed (by kind, or a wallet's item) is `unsuitable` at once, and
    `critical-secret-use.pending`, `.list` and `.get` carry its `kind`
    (§10.13); every `limit` error names its limit, `{limit, max,
    size?}` (§10.1). Additions: `dry_run` on `item.put` and `item.tag`
    (§10.7); an item's size counted without the members the vault
    assigns, with the exact encoding (§10.7); `share.pending.list`, and
    `share.decide` with `include` and `decline` in one change
    (§10.12); `labels` on received grants in `grant.list`, the item's
    `name`, `category` and `labels` in `grant.pending` entries, the
    shape of `grant.list`'s `requested` (§10.12); the 64 outgoing
    critical-item use requests (§10.13). Editorial: `file` stays
    reserved (§10.7); the 2,000-entry search budget runs out at a
    2,001st entry; `since` and `until` compared in Unix milliseconds;
    `connection.audit.list` takes `after_seq` (§10.9); the snapshot
    `email`'s excluded characters, U+2028 and U+2029 among them, and
    DEL in the names, which the member API refuses at registration too
    (§10.8, §11.13)
  - 0.20.0: normative (owner decisions of 2026-10-07, §15 item 28): the
    account snapshot carries the member's full verified `email` instead
    of `email_hint` (still `v: 1`; `email` required), which the vault
    shows only to the member's app and desktops and never puts in a
    profile, an `hs.init`, an invitation, a feed item or anything a
    connection or an agent receives; the redeem and recovery-claim
    answers keep the masked `email_hint` (§11.13, §10.2, §13.7).
    `audit.list` and `connection.audit.list` gain `q`, a
    case-insensitive substring search the vault runs over each entry's
    kind and the current names of the connection, device and item it
    refers to, and the time range `since`/`until`; a search examines
    at most 2,000 entries per request and returns `partial` with a
    cursor when that budget runs out (§10.9)
  - 0.19.0: normative (owner decisions of 2026-10-07, §15 item 27):
    `vault.status`'s `owner_check` carries the `vault.held` counts as
    `waiting` while `due` or `held`; the first count change after the
    hold starts is sent at once; apps never show unknown counts as zero
    and re-read `vault.status` on returning to the foreground while
    gated (§3.6.3, §3.6.5, §10.2); the 196,608-byte `profile.update`
    limit is checked with maximum-length names (§10.8). Errata to 0.18.0
    from its implementation (vettid-vault #45), MEMBER-API 2.2.1:
    `account.name.set` checks the names before the PIN and the
    password, so that a refused name never costs the blob the CEK
    rotation sealed; `name_change.last.status` is `applied` or
    `refused`, `reason` only with `refused`; a vault without names
    refuses `connection.invite.accept` with `internal`; names are
    trimmed of U+0020 only; `sync.event{account.changed}` for a name
    request alone repeats the snapshot's `version`. Normative addition:
    a still-pending name request is reported again with every
    `unlocked` report (§10.1, §10.2, §10.4, §10.8, §11.5, §11.13)
  - 0.18.0: normative (owner decisions of 2026-10-07, §15 item 26):
    every `profile.update` and connection `hs.init` profile carries the
    account's `first_name` and `last_name` (now required in the account
    snapshot, still `v: 1`, and carried at enrollment) and, in the
    update, the vault's current `ik`; the display name becomes an
    optional extra beside the photo and `@profile` items; re-sent when
    the names change and after an `ik` rotation only in the epoch under
    the new `ik`; receivers drop an update without the core
    (`drop.profile_malformed`) or with another `ik`
    (`drop.profile_ik_mismatch`), title connections "First Last", show
    an `ik` fingerprint and never call the names verified. The member
    changes the names only in the app: `account.name.set` (PIN and
    credential password), the host event `account_name`, applied by the
    member API at most once per 30 days, the result in the snapshot's
    `name_change` (§6.2, §9.3, §10.1, §10.2, §10.4, §10.8, §10.9, §11.5,
    §11.13, §13.7, §16)
  - 0.17.0: normative (owner decisions of 2026-10-06, §15 item 25): a
    transferred app's `device.paired` carries the member's `user_guid`
    from the vault's sealed header, which its later unlocks need (§6.7.1,
    §10.3); a `backoff` error carries `retry_after` in its body, as the
    unlock result's does (§3.6.1, §10.1). Editorial: the app header's
    `nonce` and `sig` are base64url without padding (§11.12.2)
  - 0.16.1: editorial-normative (owner decision of 2026-10-06, MEMBER-API
    2.1.1): the app learns a pending start-over from `deletion:
    {deletion_id, state, deletes_at}` in `GET /api/vault/status`, so that
    its cancel can name the `deletion_id` (§11.11.9). Editorial
    (vettid-vault #42): §11.11.2's slot code `recovery_unavailable`
    marks either refusal, `no_backup` or `no_credential`
  - 0.16.0: normative (owner decisions of 2026-10-06, §15 item 24:
    "if you lose a credential and have backups disabled you should not
    have a path back besides re-enrolling. we don't want to leak
    anything to someone without the credential", and "THERE IS NO
    RECOVERY IF BACKUP IS DISABLED"). **A recovery exists only with the
    credential backup on.** With it off there is no recovery flow at
    all: the vault reports one content-free bit, whether it keeps a
    backup copy of its credential, to its host (`credential_backup` on
    `enrolled`, `unlocked`, `locked` and the new event
    `credential_backup`), the member API refuses a recovery request
    upfront (`409 recovery_unavailable`), and the enclave refuses it
    too (`error: "no_backup"`, before locking the vault), as well as a
    register and a recovering app's unlock. Removed: the recovering
    app's `credential.reset`, its `vault.delete` and `credential_lost`.
    The recovering app may send only `credential.utk.get`,
    `credential.recover`, a reduced `vault.status` and the token and
    address types. New: **"Delete my vault and start over"** from the
    portal (§11.11.9): 24 h, emails and cancel as a recovery, then the
    host's `delete` (§12.5), after which the member enrolls a new vault
    with a setup code. §3.5.6's warning now says a lost or replaced
    phone with the backup off cannot be recovered, only deleted and
    replaced. §12.5 states the 7-day retention of noncurrent stored
    versions
  - 0.15.2: editorial-normative (owner decisions of 2026-10-06). The
    owner check's message type is `vault.owner-check`: 0.13.0 spelled it
    `vault.owner_check`, which §5.3's type grammar forbids and parsers
    reject (vettid-vault already uses the hyphen); settings keys, the
    error code and the audit, feed, sync and lock-reason kinds keep
    `owner_check` (§3.6.1, §10). **Normative: `credential.delete` is
    removed**; a credential is deleted only as the first step of
    `vault.delete`, and a member who wants a new credential uses
    `credential.reset`, which the holder may now send (PIN, current
    and new password; delete and create in one step; restarts the
    clock) (§3.5.5, §10.6, §15 item 23). A vault without a credential
    exists only during enrollment and is not gated by the owner check;
    the first `credential.create` starts the clock and `credential.reset`
    starts it fresh (§3.5.7, §3.6.1). Errata: the recovery QR with `api` is
    181 bytes for a 32-hex `vault_id`, version 10 (was 8) (§11.11.2); §16
    points to `appkey.json` for the 0.15.0 recovery QR; a suspended
    account gets no account snapshot (§11.13)
  - 0.15.1: editorial, from the 2026-10-06 staging recovery test
    (vettid-android #66): §6.7.1 names `403 token_revoked` on a deposit
    to the device's own vault mailbox as the refused relay key; §8.6 says
    what an owner device does on it (counts toward the erase offer, never
    erases on it alone) and that a device SHOULD ack a vault message even
    when its answer is refused
  - 0.15.0: the app and the account portal are separate (owner decision
    of 2026-10-05, approved 2026-10-06; ENROLLMENT-CODES.md; drafted as
    0.11.0 in vettid.org PR #122 and renumbered after 0.14.0). The portal issues a single-use
    5-minute setup code (a 128-bit QR secret, `t: "e"`, and an
    8-character code typed with the member's email; no global limit);
    the app redeems it
    with its new app key and never signs in. Every app request to the
    member API is signed by that per-app P-256 key instead of carrying a
    member session; the enclave records the key (`app.api_key` in
    enroll and register, `api_key` in a transfer's `hs.init`) and reports
    it to the host (`enrolled`, `unlocked`, `locked`, new `app_key`
    event), which keeps the API's view current across transfer and
    recovery. Membership, terms and subscription reach the app only
    through the vault: an account snapshot in every unlock message and
    the new queue op `account`, kept in vault state, `account.get` and
    `sync.event{account.changed}`. Unlock no longer needs the current
    terms. The recovery QR gains `api`; a recovering app claims the
    recovery with its key (§2.2, §6.2, §6.7.1, §10, §10.1, §10.2, §11.1,
    §11.3, §11.5, §11.6, §11.8, §11.11, §11.12, §11.13, §13.5, §13.7,
    §15 item 20). With the daily owner check (0.13.0): enrollment by
    setup code starts the clock, and `account.get` and
    `sync.event{account.changed}` are held like other owner requests
    and fan-out (§3.6, §11.12, §11.13); while the member API's vault
    service is paused, code issue, redeem and claim are refused like
    enroll. Breaking for apps and the member API
  - 0.14.0: the canary manifest (owner decisions of 2026-10-06): an app
    MAY accept an unpublished served manifest shared to it as a file,
    verified under its pinned keys and the serial rule, installed only
    after the member confirms, used while its serial is higher than the
    published one (or nothing is published, 404) and removed once the
    published serial reaches it; the accepted risk of a leaked canary
    document (§11.10.1, §11.10.6, §13.9)
  - 0.13.1: editorial: the related RELAY-PROTOCOL is 0.6.0 and §1.2 lists
    its web endpoints (§6.11, used by §6.4); §15 item 7 is the HTTP action
    only; item 21 records vettid-vault #38
  - 0.13.0: the daily owner check (owner decisions of 2026-10-05): the
    vault records its member's last check, the PIN and the credential
    password verified together by `vault.owner-check` (a credential
    operation, so it rotates the CEK); enrollment, a completed recovery
    and a completed transfer start the clock. Past the interval (the
    setting `owner_check.interval_seconds`, at most and by default 24 h)
    the vault is **held**: it keeps serving its peers and queues what
    needs the member, rings no calls, sends its devices only the
    content-free `vault.held` counts, refuses every other owner-device
    request with `owner_check_required`, suspends desktops' access
    sessions and issues no LEASH status statements. Ten consecutive
    failed checks lock the vault. The member may turn the hold off
    (`owner_check.hold`, optionally until `hold_off_until`, at most 30
    days), but only within a successful check; past the deadline the
    app is gated either way, and the switch frees only desktops, agents,
    calls and presence (owner decisions of 2026-10-06) (§3.6, §3.6.7, §3.5.4, §1.1, §2.2, §3.3, §3.5.3,
    §3.5.9, §6.7.1, §6.8, §9.1, §10, §10.1, §10.2, §10.6, §10.8, §10.9,
    §10.10, §10.11, §10.17, §11.11.5, §12.1, §12.3, §13.5, §13.7, §13.8,
    §15 item 22)
  - 0.12.0: LEASH delegation and status statement in the LEASH paper's §3.5
    format (`iss`, `sub`, `status_issuer`, `scope` object, `limits`,
    `nonce`; RFC 8785; `leash/v1/delegation`, `leash/v1/status`); the
    paper's verifier steps and revocation bound; `leash.json` vectors
    (owner decision of 2026-10-05; §10.11, §15 item 21, §16)
  - 0.10.8: editorial: §6.7.1 failures table — the old app erases its local
    state on `device.unlinked`; a refused relay key alone only offers an erase
    (owner decisions of 2026-10-05; vettid-android #57, #58)
  - 0.10.7: editorial: §11.4 lists `credential_backup` in the unlock result
    (0.10.6, §11.11.5); §16 adds the `recovery.json` vector (vettid-vault #31, #33)
  - 0.10.6: gaps found building the account site's recovery pages and
    the vault's 0.10.5 code. Recovery: the member API's recovery gains
    `vault_id` and the state `registered` (the code is spent), which the
    API learns from the clear marker `recovery_registered` that the
    enclave adds to a successful register's answer and the host copies
    into the slot's `code`; cancels answer `{cancelled}`; the QR's
    parameters are fixed (byte mode, level M or higher, 4-module quiet
    zone, any version) (§11.5, §11.11.2, §11.11.3, §11.11.7). Lock
    reporting: a vault that stops without a `locked` event is written
    `locked` by the host when it releases the lease, and the member API
    reports `unlocked` only under a live lease (§11.5). Wording of
    0.10.5: the decline goes on the peer's request token even after the
    peer's `connection.approved` gave a standing token; the audit `ref`
    of a decline after activation is the `connection_id`; on S2
    receivers the decline stays unacked and is redelivered until expiry
    (§6.4, §10.9, §15 items 18 and 19). From the Android recovery and
    transfer work: a recovered app's unlock result carries
    `credential_backup` (§11.11.5); a transferring app stops waiting for
    `hs.resp` after 60 s (§6.7.1); without an enrolled vault `GET
    /api/vault/recovery` answers `{recovery: null}` (§11.11.7)
  - 0.10.5: a declined connection request is sent to the other party
    (owner decision of 2026-10-05, reversing 0.10.2 decision 2): the
    declining vault sends `connection.declined{}` under the handshake's
    epoch on the request token the peer issued, as `connection.approved`
    travels, whenever its handshake has reached that point; the receiving
    vault ends the request, tells its devices
    (`sync.event{connection.request, state: "peer_declined"}`, and on the
    accepter's side `connection.event{failed, reason: "declined"}`) and
    denylists its tokens; a block of a pending request sends it too; one
    arriving at an active connection removes it (§6.4, §7.1, §7.4, §9.2,
    §10.1, §10.4, §10.9, §13.5, §15 items 16–18). Likewise the owner's
    rejection of a pairing or transfer after its `hs.fin` is sent to the
    new device as `device.pair.rejected{}`, which stops it waiting (owner
    decision of 2026-10-05; §6.7, §6.7.1, §7.1, §7.4, §10, §10.3)
  - 0.10.4: what the vault implementation of 0.10.3 settled
    (vettid-vault PR #26): every `device.paired` carries a fresh standing
    token; a request that ends unactivated denylists every token issued
    to the peer; `connection.decline` in any state, `waiting` included;
    `failed` is not sent for the member's own decline; a request token's
    `relay.token.refresh` before activation; a pairing's or transfer's
    10 minutes count from its `hs.init`; a late `connection.approved` is
    ignored (§6.4, §6.7, §6.7.1, §7.1, §7.4, §10.3, §10.4). The 0.10.3
    handshake vector values (§16)
  - 0.10.3: the SAS is committed (ZRTP-style): `hs.init` carries
    `sas_commit`, `hs.resp` and `hs.fin` carry the nonces `n_R` and
    `n_I`, and `sas` is derived from `prk`, `th` and both nonces, so a
    party in the middle of a remote link can no longer match the codes
    (§6.2, §6.3; §15 item 17 resolved). The handshake now runs before
    approval: `hs.resp` and `hs.fin` are sent at once with request
    tokens, and each member's approval is `connection.approved`, which
    carries the standing and reconnect tokens; a connection is active
    with both (§6.4, §7.1, §7.4, §10.4). Pairing and transfer follow the
    same order; `device.paired` carries the standing token, and a
    transfer completes at its approval (§6.7, §6.7.1, §10.3). The
    handshake vector is regenerated (§16)
  - 0.10.2: connection requests, from the Android A4 build: both members
    see and confirm the safety code; the accepting vault's member approves
    too, and its vault completes the handshake only then (§6.4, §10.4);
    `connection.invite.accept` returns `sas` and answers `exists` for a
    vault already connected or requested; the inviter's drop of such an
    `hs.init` and the accepter's 8-day expiry (`failed`) are specified
    (§6.4); `connection.request.list`, `connection.request.outgoing` and
    the `connection.request` sync kind; `pending_id` in
    `connection.event{added}` (§10.1, §10.4); the link URL
    `<relay>/connect#<payload>` on the invitation's own relay, the QR
    unchanged (§6.4);
    `critical-secret-use.get` returns an incoming request with its payload
    (§10.13); §15 items 16–17
  - 0.10.1: the vault PIN is 6–32 ASCII digits (was 4–32), owner decision
    of 2026-10-04; the enclave refuses shorter PINs everywhere it takes one
    (§11.3, §6.7.1, §10.6)
  - 0.10.0: V5 release model (VAULT-RELEASES, owner decisions of
    2026-10-04): enroll and unlock requests carry the manifest's hash and
    serial instead of the document, which the host supplies from the vault
    data bucket and the enclave verifies (manifest by hash, O10); the
    manifest may grow to 65,536 bytes (§11.3, §11.4, §11.5, §11.10.1,
    §11.10.4); the status `removed` and the optional `ends_at` date
    (§11.10.1, §11.10.5, §11.10.6); the §11.10.7 key check admits a pinned
    retirement role that may schedule the key's deletion with the pinned
    window, cancel it and re-enable the key, and nothing else (§11.10.7,
    §13.5); per-channel release constants (§11.10.8)
  - 0.9.1: vault deletion deletes the vault's relay mailbox
    (RELAY-PROTOCOL 0.5.0 `DELETE /v1/mailbox`, owner decision of
    2026-10-04): right after the marking flush, before the drain; the
    queued revocations and claim deletions are then moot; on a relay
    before 0.5.0 they remain the fallback (§1.2, §12.5, §15 item 12)
  - 0.9.0: one app per vault (owner decisions of 2026-10-03,
    PROTEAN-CREDENTIAL §4): the member's single app is the credential's
    holder and the only app; no second app pairs (`one_app`) (§6.7);
    a credential presented by another device, or a stale copy the
    holder's own retry does not explain, is a clone: refused, an urgent
    alert to the app, audit, a content-free host alarm that the member
    API turns into an email, a freeze of credential operations until the
    app confirms, then a forced rotation (§3.5.9, §11.5); direct transfer
    to a new phone with the PIN and the password, no wait (§6.7.1);
    recovery replaces the old app and keeps desktops and agents; with
    backup off a recovery restores access only, to reset the credential
    or delete the vault (§11.11.5, §11.11.8); no off-device copy of the
    credential (§3.5.6); GrapheneOS accepted through pinned verified-boot
    keys (§11.7); vault deletion (`vault.delete`, crash-safe, the member
    emailed) (§12.5); a vault reports only to its owner (§13.7); a
    holderless vault adopts no app (§3.5.9); `one_app`,
    `credential_frozen`, `rotation_required`, `credential_lost`,
    `transfer_pending` (§10.1)
  - 0.8.0: V4 batch 4: location sharing per connection (once or
    continuous, expiring, precision and cadence enforced by the sending
    vault, positions forwarded from memory and kept by the receiver only
    while the share is active, requests) (§10.16); presence as an
    on-demand ping with a per-connection policy, refusals silent (§9.2,
    §10.17); the member's opt-in location log, owner-only, bounded, shared
    only as a snapshot through a share (§10.16); the Bitcoin wallet: BIP86
    (taproot, the default) and BIP84 accounts of a recovery phrase that is
    a critical item, addresses without the password, PSBT signing as a
    credential operation in the unlock window under a signing policy, the
    member's app as the chain source (owner decision) (§10.18); the wallet
    actions run (catalog version 3, `address` in
    wallet.request-payment) (§10.14); `invalid_psbt` and `unavailable`
    (§10.1); registry, sync.event, audit, feed and threat-model rows
  - 0.7.0: V4 items (VAULT-ITEMS, owner decisions of 2026-10-03): one item
    model (name, category, typed fields, tags, sensitivity data, secret or
    critical) replaces profile fields, vault-held secrets and critical
    secrets (§10.7); critical items' values are encrypted under per-item
    keys that only the Protean Credential holds (§3.5.2, §3.5.4, §10.7); the tag registry with rename and merge,
    and the profile as a name and photo plus `@profile` items (§10.8);
    share rules over tags for connections and agents, `ask` by default
    with remembered declines, `auto` with a preview, per-connection
    catalogs, grants of items with field restrictions, `data.shared`, and
    one-off requests by category (§10.12); agents' rules as signed
    `items.read` delegations (§10.11); critical-item use through rules
    (§10.13); `items.share` (§10.14); `in_use`; owner decisions of 2026-10-03
    on agents' rules (§10.11) and envelope encryption (§10.7)
  - 0.6.0: V4 batch 3: LEASH for the member's agents (grants with scopes,
    approval modes, rate limits and expiry; the AgentPolicy decision;
    agent.request for catalog, retrieval and use without exposure;
    initial grants at pairing; every grant a delegation signed with the
    credential key, so issuing needs the member's app in the unlock
    window; refusal cooldowns, a referral cap and suspension against
    agent spam; agent activity summarised in the audit log) (§10.11); 1:1 grants of profile fields and vault-held
    secrets between connections, values sealed to the fetching device,
    and the secrets catalog (§10.12); critical-secret use by a connection
    with the member's password per use (§10.13); shared actions offered
    to connections as a built-in catalog with permission modes (§10.14);
    introductions started by the member (§10.15); peer flows are events
    correlated by ids; registry, sync.event, audit, feed and threat-model
    rows for all of them
  - 0.5.0: V4 batch 2: access sessions and app approvals for desktops and
    agents, with the LEASH hook (§6.8); the block list, connection
    metadata and member authentication with the credential key (§10.4);
    call signalling with device-held media keys and vault-signed ICE
    configurations (§10.10); fan-out to desktops only within an access
    session (§9.1); credential-key rotation statements followed by
    authenticated connections (§3.5.5, §10.4); removal by jti so peers can
    reconnect through a new invitation (§7.4); desktop calls and signed
    key-exchange shares, no call handoff (§10.10); body schemas, error
    codes, sync.event kinds and audit and feed kinds for all of them
  - 0.4.1: the Protean Credential per the owner's design: the CEK rotates
    at every use, one-time UTK/LTK transaction keys and reply keys, LAT
    superseded by Nitro attestation, a credential required before a vault
    is used (§3.5); recovery when every owner app is lost (§11.11) and its
    member API routes, never without the credential; credential backup
    (§3.5.6); an append-only audit log with fixed retention, client
    anchors and bounded drop entries (§10.9)
  - 0.4.0: V4 batch 1 (owner decision on the Protean Credential): the
    Protean Credential (§3.5) with a hybrid-KEM CEK, a password layer and
    per-use consent, its link to ik/kem rotation (§3.4); body schemas for
    credential, critical secrets, secrets, profile, settings, guides,
    audit and feed (§10.6–§10.9); activity, sync.event kinds and error
    codes (§10.1); the hs.init profile and profile.update (§6.2, §9.3)
  - 0.3.2: V3b implementation (vettid-vault supervisor and parent):
    lease takeover from a non-live holder, lease taken before forwarding,
    host-written expired slots, lifecycle writes only by the lease holder,
    renewal failures, parent restart and loss, KMS over HTTP/1.1, long-poll
    in the enclave, one OS process per vault (§12.4, §13.3, §13.6),
    cleanup of the member index object
  - 0.3.1: V3 implementation fixes (vettid-vault V3a, member API vault
    routes): the response slot and vault.enroll.result, result binding and
    codes, per-release header_seq, re-enrollment of an existing vault_id,
    queue, lease and liveness encodings, access and rate-limit rules, what
    the device key signs, pairing attestation, sealed-object format,
    seal_key_verified.verified_by, stricter policy-check wording, §16 sizes
  - 0.3.0: release updates (VAULT-PLAN D1): per-release sealing, the signed
    release manifest, member-approved moves at unlock, routing by
    sealed_release, enclave-side verification of sealing-key policies,
    threat-model updates; enroll and unlock requests carry the manifest and
    are padded to 12,288 bytes
  - 0.2.3: V2 runtime additions: DEK derivation; §6.6 decides the token
    class by the collect jti (RELAY-PROTOCOL 0.4.0); approval roles; 7-day
    pending connection requests; first-app handshake; refusal of revoked
    relay keys; unknown-type answers; body schemas and error codes (§10)
  - 0.2.2: V1 implementation clarifications: identity.rotate format,
    device_attest replaces app_attest, strict inner/padding rules, blob
    layout, handshake field rules per purpose, epoch and abort rules,
    bundle/QR encodings, §11 encodings, §16 vectors filled in
  - 0.2.1: enclave TLS uses pinned roots and shared connections
  - 0.2.0: suite 2 becomes HPKE with the MLKEM768X25519 hybrid KEM; remote
    invitations with selectable TTL; reconnect tokens; client-anchored rollback
    protection (state_seq); vault_id and instance leases for multiple enclave
    instances; device attestation required at enroll and unlock; shorter
    vault-to-vault epochs
  - 0.1.0: initial draft
classification: public (no secrets; safe for github.com/vettid)
---

# VettID Vault Messaging

## 1. Purpose and scope

This document defines how a VettID vault exchanges messages over the VettID
relay (RELAY-PROTOCOL.md) with its owner's devices, its paired agents and the
vaults of its connections. It covers:

- keys (§3), and the daily owner check that holds a vault whose member
  has not proved their presence for 24 h (§3.6);
- one hybrid post-quantum construction and one envelope for every payload
  (§4, §5);
- sessions, invitations, reconnects, pairing, and the access sessions of
  desktops and agents (§6);
- deposit tokens (§7);
- delivery semantics (§8, §9);
- the message-type registry (§10);
- enrollment, unlock and recovery over an alternate channel (§11);
- locked vaults (§12).

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be read as
described in RFC 2119.

### 1.1 Decisions encoded here

1. **VettID core is 1:1 between identities.** Fan-out to the owner's *own*
   devices is in scope. There are no group primitives: no multi-recipient
   deposits, no group keys and no membership lists.
2. **Feature scope.**
   - In scope:
     - enrollment, PIN and credential;
     - items (the member's data, with tags and share rules), profile
       and settings;
     - 1:1 connections and messaging;
     - calls, with signalling over the relay;
     - device and agent pairing;
     - LEASH;
     - audit and feed;
     - wallet and location;
     - shared actions;
     - grants and critical-item use;
     - presence, as an on-demand ping.
   - Out of scope: votes, B2C service vaults, org vaults and
     transport-credential minting.
3. **The vault relay key exists only in PIN-protected vault state.** The
   enclave generates the key at enrollment. It is stored only in vault state
   encrypted under the PIN-derived DEK; there is no KMS-sealed or otherwise
   PIN-independent copy.
   *Rationale:* no one can collect, ack or delete a user's mailbox without
   the user's PIN. That includes any future enclave release signed by VettID.
4. **A locked vault does not touch the relay.** Enrollment and unlock travel
   an *alternate channel*: member API → per-instance queue → parent →
   enclave (§11). Requests on that channel are encrypted to an
   attestation-bound enclave key. While a vault is locked, peers' messages
   wait in its mailbox, up to the relay TTL, and are collected after unlock.
5. **The parent (host) is an untrusted byte forwarder.** It never holds relay
   keys, never parses app or peer envelopes, and never decides freshness or
   dedupe. All relay requests are built and signed inside the enclave.
6. **Fresh start.** There is no compatibility with the earlier NATS-based wire
   format.
7. **PQC Phase 1 applies to all key agreement.** Every E2E key agreement uses
   a hybrid X25519 + ML-KEM-768 KEM (§4). Signatures stay Ed25519. Every
   structure carries a suite or version field, so PQC Phase 2 (Ed25519 +
   ML-DSA-65) is a suite bump.
8. **One app per vault** (owner decision, 2026-10-03; 0.9.0). A vault has
   exactly one device of role `app`. That app **holds** the Protean
   Credential and is the only one that unlocks. Desktops and agents pair
   as before and never hold the credential. A second copy of the
   credential is treated as theft (§3.5.9); the app moves to a new phone
   by direct transfer (§6.7.1) or by recovery (§11.11).
9. **A daily owner check** (owner decisions, 2026-10-05; 0.13.0). At
   least every 24 h the member gives the vault their PIN and credential
   password together. Without that, the vault holds: it keeps serving its
   peers but serves its owner's devices nothing but the check (§3.6).
   The member may turn the hold of the rest of the vault off, only
   within a check; the app is gated past the deadline regardless
   (§3.6.3, §3.6.7; owner decisions, 2026-10-06).

### 1.2 Relay features used

This document uses the following RELAY-PROTOCOL 0.6.0 features:

- one-shot **open deposit tokens** (§5.6);
- **`sender`** in collect responses (§6.3, §6.4);
- **`jti`** in collect responses: the `jti` of the deposit token a message
  was accepted under (§6.3, §6.4; new in 0.4.0, used by §6.6);
- **claims** (§6.9);
- **mailbox deletion**, `DELETE /v1/mailbox` (§6.10; new in 0.5.0, used
  by §12.5);
- **web endpoints**, `/connect` and `/.well-known/assetlinks.json`
  (§6.11; new in 0.6.0, used by §6.4's invitation URL);
- fractional-second timestamps (§4.1);
- relay **policy values** advertised at registration:
  - `max_token_lifetime_seconds`;
  - `open_token_max_lifetime_seconds`;
  - `claim_ttl_seconds`.

The policy values are relay policy, not protocol constants. Clients MUST read
them from the registration `limits` and MUST NOT exceed them. For reference,
the relay at vettid.org allows:

- open tokens and claims up to 7 days;
- token lifetimes up to 400 days, for the reconnect tokens of §6.6.

## 2. Threat model

### 2.1 Parties

| Party | Trusted for | Not trusted for |
|---|---|---|
| Enclave (attested release) | Confidentiality and integrity of the vaults sealed to it, which are only those whose members approved it (§11.10) | Anything its PCRs don't attest. Apps check the release at every enroll and unlock (§11.2, §11.10.6). |
| Parent / host | Availability | Keys, plaintext, parsing, freshness, dedupe, routing decisions |
| Relay | Availability | Content confidentiality, integrity and authorship |
| Member API, queues, tables | Member session auth, rate limits, routing, availability | PINs, keys, vault contents, relay addresses |
| Push gateway (deferred) | Delivering contentless wakes | Everything else (PUSH-GATEWAY §8) |
| Peer vault | What its owner chose to share | Anything else. It MAY be malicious. |
| Owner device / agent | What its role and grants allow | Agents get least privilege (LEASH) |
| Network | — | Everything. Every hop uses TLS, and payloads are E2E-encrypted regardless. |

### 2.2 Metadata each party learns

| Party | Learns | Does not learn |
|---|---|---|
| Relay | Mailbox ids, depositor relay keys, timing, padded sizes, blob and claim sizes | Message types, content, or which identity, device or connection a relay key belongs to |
| Parent / host | Relay host names; TLS byte counts and timing per instance (connections are shared by all vaults, §12.2); enroll, unlock and lock events; encrypted-state size; `vault_id` ↔ instance | Relay requests (TLS terminates in the enclave, §12.2), mailbox ids, PINs, keys |
| Member API | Which member enrolled, unlocked or locked, and when; `vault_id`, instance lease, `vault_version`, `state_version` (§11.5); the public key of the vault's app key and when it changes, so when a transfer or recovery completed (0.15.0, §11.12); whether the vault keeps a backup copy of its credential (`credential_backup`, one bit, 0.16.0, §11.5), so whether it can be recovered; the member's name change requests (`account_name`, 0.18.0, §11.5), whose names it holds anyway | PINs; why an unlock failed (§11.4); mailbox ids; keys other than app public keys; any stable device identifier (§11.7) |
| Network | Endpoints and timing | Everything else |

The owner check (§3.6) adds nothing to this table. The hold is not
reported to the host or to connections: the host sees the lock after ten
failed checks as an ordinary `locked` event, without a reason; a peer
sees a held vault keep acking, answer with delivered receipts and serve
standing grants, but no presence, ringing or read receipts, as with an
absent member; the relay sees only that an owner's devices exchange
less traffic with the vault, as during any quiet period.

VettID operates both the host and the relay, so in its own deployment it can
correlate their timing. This residual metadata is disclosed here rather than
hidden. Traffic-analysis resistance is a non-goal (as in RELAY-PROTOCOL
§8.2), and padding (§5.4) limits only size leakage.

**Out of scope:**

- compromise of the enclave platform, or side channels inside it, and AWS
  KMS or Nitro attestation not behaving as documented (§11.10.7);
- a malicious release that the member approved and moved their vault into
  (§11.10), or enrolled into, after being shown its release number, notes
  and PCR0. No other release can open the vault, and VettID cannot move it
  there (§13.5);
- loss of the stored vault state itself. Recovery when the app is lost
  is §11.11; it needs the state, the PIN and the credential password,
  and exists only with the credential backup on (§3.5.6);
- a lost or replaced app with the credential backup off (0.16.0, owner
  decision of 2026-10-06). There is no recovery and no path back into
  that vault: nothing in it is ever released to anyone without the
  credential. The member can only delete the vault and enroll a new one
  (§11.11.9).

## 3. Principals and keys

### 3.1 Principals

| Principal | Relay mailbox | Notes |
|---|---|---|
| Vault | yes | One per member, inside the enclave. Identified to VettID by an opaque `vault_id` (§11.5). |
| Owner device, role `app` | yes | A phone or tablet installation. **Exactly one per vault** (§6.7): the holder of the Protean Credential (§3.5) and the only role that may unlock (§11.7). |
| Owner device, role `desktop` | yes | Does not unlock in 0.2. |
| Owner device, role `agent` | yes | Acts under LEASH grants. Never unlocks. |
| Peer vault | yes | A connection's vault |
| Enclave instance | no | Holds the enclave transport key (ETK, §11.2) |

Devices talk only to their own vault. Peer traffic is always vault to vault.

### 3.2 Keys

A **KEM key** is an MLKEM768X25519 key pair (§4.1). The encapsulation (public)
key `ek` is 1,216 bytes. The decapsulation (private) key is stored as its
32-byte seed.

| Key | Holder | Purpose | Lifetime | Stored |
|---|---|---|---|---|
| Relay key (Ed25519) | every mailbox owner | Signing relay requests and minting tokens | Rotated per §3.4 (SHOULD be ≤ 1 year) | Vault: DEK state only. Device: platform keystore. |
| Identity key `ik` (Ed25519) | vault, each device | Signing handshakes, bundles, ICE configs and rotation statements | Vault: rotates with the Protean Credential. Device: life of the pairing. | DEK state / keystore |
| Static KEM key `kem` | vault, each device | Receiving sealed messages and handshake initiations | Same as `ik`. Retired vault keys are kept 400 days for reconnects (§6.6). | DEK state / keystore-wrapped |
| Session epoch keys | both ends | Session-mode envelopes | One epoch (§6.5) | DEK state / device storage |
| Ephemeral KEM key | handshake initiator | Forward secrecy | One handshake | Memory |
| ETK (KEM key) | enclave instance | Alternate channel | ≤ 24 h, regenerated at every start | Enclave memory only |
| DEK | vault | Encrypting vault state | While unlocked | Enclave memory only |
| Device attestation key | app (Android Keystore key, iOS App Attest key) | Device attestation (§11.7) | Life of the installation | StrongBox / TEE / Secure Enclave (platform) |
| Wake key (Ed25519) | vault | Push gateway (§14) | PUSH-GATEWAY §3 | DEK state |
| CEK (KEM key) | vault | Sealing the Protean Credential (§3.5) | Until `credential.rotate`, `credential.reset` or the vault's deletion | DEK state |
| Credential key (Ed25519; hybrid in PQC Phase 2) | the member | Signing what the member approves: member authentication (§10.4), LEASH delegations (§10.11) | Until `credential.rotate` | **Only inside the Protean Credential** held by the member's app; in vault memory only during an unlock window (§3.5) |

Rules for all keys:

- The relay key, the identity key and the KEM key MUST be distinct from each
  other and from the Protean Credential key.
- Device private keys SHOULD be non-exportable. If a platform keystore cannot
  hold them natively, they MUST be stored encrypted under a key that the
  keystore holds.
- Implementations MUST follow FIPS 203 (ML-KEM), RFC 9180 (HPKE) and the
  MLKEM768X25519 KEM definition (§4.1).

### 3.3 Vault state and the sealed header

**Vault state** is encrypted under the DEK. It holds:

- `vault_id` and `state_seq` (§13.2);
- `sealed_release` and any pending `release_move` (§11.10.4);
- the relay key, the mailbox address and the rotation state;
- the vault's current `ik` and `kem`, and its retired `kem`s;
- the vault's rotation chain;
- the wake key;
- the CEK and the credential record (§3.5): the credential's version, the
  SHA-256 of its current blob, the password backoff state, the latest
  blob while kept (§3.5.3, §3.5.6), and the LTKs of each app's UTK pool
  (§3.5.4);
- the owner-check record (§3.6): `last_at`, `deadline` and `failures`;
- the items (§10.7): `data` and `secret` items whole; `critical` items'
  metadata and their values encrypted under item keys that only the
  credential holds (§3.5.2); the tag registry, the profile object and the
  share rules (§10.8, §10.12);
- one **record per owner device and one per connection**, holding:
  - role, relay public key, mailbox address, `ik` and `kem`;
  - the peer's rotation chain;
  - session epochs;
  - the tokens it issued to the vault, and the `jti`s issued to it (standing
    and reconnect);
  - its pinned suite and its state (`pending`, `active` or `stale`);
- the issued-token registry, the dedupe store, the response cache and the
  outbox (§8);
- feature data.

The **sealed header** is a small record sealed to the enclave's attestation,
not to the DEK, so that an unlock can be checked before the DEK exists. It
contains:

- `vault_id` and `user_guid`;
- a `provisional` flag (§11.3);
- the DEK's KDF parameters, salt and pepper (§3.3.1);
- `sealed_release`, the release it is sealed to, and `manifest_serial`, the
  highest release-manifest serial the vault has seen (§11.10);
- `seal_key_verified`: the sealing key's ARN, the SHA-256 of the policy
  the enclave verified before sealing under it, and the PCR0 of the release
  that ran the check (§11.10.7);
- the **unlock keys**: for each app allowed to unlock, its `ik`, its `kem`
  and its device-attestation binding (§11.7);
- the backoff state (§11.8);
- `has_credential`, whether the vault has a Protean Credential (§3.5.7);
- `credential_backup` (0.16.0), whether the vault keeps a backup copy of
  its current blob (§3.5.6), so whether it can be recovered (§11.11.1);
  the vault writes it at every header write and in the flush that
  changes it;
- `state_seq` and `header_seq` (§13.2).

The sealed header MUST NOT contain the relay key, session keys or feature
data.

#### 3.3.1 DEK derivation and at-rest formats

The DEK is derived from the PIN and a secret that only the sealed header
holds, so that stolen vault state cannot be brute-forced against PINs
outside the enclave:

```
x   = Argon2id(PIN, salt, t, m, p, 32)
DEK = HKDF-SHA-256(ikm = x, salt = pepper, info = "vettid/vms/2/dek" || vault_id, L = 32)
```

- The sealed header holds the KDF parameters `{alg: "argon2id", t, m, p,
  salt}` (`salt` 16 random bytes) and `pepper` (32 random bytes).
- New vaults use `t = 3`, `m = 64 MiB`, `p = 1`. The enclave MUST refuse
  parameters below `t = 1`, `m = 8 MiB`.
- A wrong PIN yields a DEK under which the state does not decrypt; that is
  the `bad_pin` outcome (§11.4), counted in the backoff state (§11.8).

The reference implementation stores vault state and the sealed header as:

```
state  = 0x01 || state_seq (8, big-endian) || nonce (24)
         || XChaCha20-Poly1305(DEK, nonce, aad, state_json)
aad    = "vettid/vms/2/state" || 0x00 || vault_id || 0x00 || state[0:9]
header = Seal_R(header_json, aad = "vettid/vms/2/header" || 0x00 || vault_id)   # sealed to release R (§11.10.2)
```

`Seal_R` encrypts under a fresh AES-256 data key from KMS `GenerateDataKey`
on release R's key (§11.10.2), with the key ARN in the object and in the
AAD, all lengths 2 bytes big-endian:

```
sealed = 0x01 || len(key_arn) || key_arn || len(blob) || blob || nonce (24)
         || XChaCha20-Poly1305(data_key, nonce, aad', plaintext)
aad'   = "vettid/vms/2/seal" || 0x00 || release_pcr0 || 0x00 || key_arn || 0x00 || aad
```

`blob` is the KMS `CiphertextBlob`. To unseal, the enclave takes `key_arn`
from the object, requires it to be in the pinned sealing-key namespace
(§11.10.2), calls `Decrypt` with it as `KeyId`, and, once the request's
manifest (§11.10.1, supplied by the host and matched to the request's
`manifest_sha256`) is verified, requires it to equal this release's
`seal_key` (else result code `manifest`). This lets the enclave open the header, and
answer sealed, before the manifest step of §11.10.4.

Both objects are written create-only at enrollment and with version-matched
conditional writes afterwards (§12.3). There is one header object per
release the vault has been sealed to (§11.10.2); a move writes the new one
create-only.

### 3.4 Rotation

- **Vault relay key** rotates per RELAY-PROTOCOL §6.7:
  1. The vault collects from both mailboxes during the grace period.
  2. It mints fresh standing and reconnect tokens for every device and peer.
  3. It sends each of them `relay.address.update`, carrying the new address,
     the new key and the new tokens.
  4. Each recipient answers with `relay.token.issued` for the new `sub`.

  The vault MUST rotate after any suspected exposure of its state.
- **Device relay key.** The device sends `relay.address.update`, and the vault
  denylists the old `sub` after the grace period.
- **Vault `ik` and `kem`** rotate with the Protean Credential (PQC-MIGRATION
  §7). A `credential.rotate` (§3.5.5) MUST rotate them, in the same flush
  as the new credential; the vault MAY also rotate them alone, after a
  suspected exposure of its state:
  1. The vault sends an `identity.rotate` statement, signed by both the old
     and the new `ik`, to every device and peer.
  2. It appends the statement to its **rotation chain**.
  3. It rekeys every session (§6.5).

  The credential rotation is the PQC migration vehicle (PQC-MIGRATION §7):
  the release that introduces suite 3 generates the hybrid credential key
  and the hybrid `ik` at the member's next `credential.rotate`.

  Peers store each other's chains (used in §6.6). PQC Phase 2 arrives this
  way, as a hybrid `ik` under suite 3.

**`identity.rotate` statement.** One link of a rotation chain is the JSON
object

```json
{ "v": 1, "suite": 2, "old_ik": "<b64>", "new_ik": "<b64>", "new_kem": "<b64 ek>",
  "sig_old": "<b64>", "sig_new": "<b64>" }
```

```
m       = old_ik (32) || new_ik (32) || new_kem (1216)
sig_old = Ed25519(old_ik, "vettid/vms/2/rotate" || m)
sig_new = Ed25519(new_ik, "vettid/vms/2/rotate" || m)
```

- Both signatures MUST verify, and `old_ik` MUST differ from `new_ik`.
- A chain is an ordered array of statements. Each link's `old_ik` MUST equal
  the previous link's `new_ik` (the first link's MUST equal the stored `ik`).
  A receiver MUST reject chains longer than 32 links.
- The chain resolves to the last link's `new_ik` and `new_kem`; an empty
  chain resolves to the stored keys.
- **ETK** rotates at least every 24 h and on every enclave start.

### 3.5 The Protean Credential

The **Protean Credential** holds the member's critical keys: the
credential key and the **item keys** of the member's critical items
(§10.7), such as seed phrases, private keys and recovery keys, whose
values the vault keeps encrypted under those keys.

- It is held by the member's one app, the **holder** (§1.1 item 8). The
  vault records which device that is; a direct transfer (§6.7.1) or a
  recovery (§11.11.5) moves it.
- It is sealed so that the vault alone cannot open it.
- Every use needs the member's participation: the app supplies the
  credential **and** the member's password, for that one operation.
- Its contents are never part of vault state.

This section follows the owner's Protean Credential design
([PROTEAN-CREDENTIAL.md](PROTEAN-CREDENTIAL.md)) on the new
transport. Its three rotating mechanisms map as follows:

- **CEK** (credential encryption key): a new CEK after **every** use of
  the credential (§3.5.3). Old blobs become undecryptable by anyone,
  including the vault.
- **UTK/LTK** (one-time transaction keys): every operation's critical
  payload is sealed, inside the §6 session, to a single-use key of the
  vault (§3.5.4).
- **LAT** (ledger authentication token): **superseded**, by decision of
  2026-01-08. The app authenticates the enclave by its Nitro attestation
  (§11.2, §11.3) and the vault's pinned identity (§6.3), which is the
  mutual authentication the LAT provided.

#### 3.5.1 Keys

- **CEK.** A KEM key (MLKEM768X25519, §4.1) generated by the vault. Its
  private seed is kept in DEK state and never leaves the vault. There is
  exactly one live CEK per credential; it is replaced, and the old one
  destroyed, at every use (§3.5.3).
- **Password key** `K_pw`. It is derived from the member's password inside
  the enclave:

  ```
  x    = Argon2id(password, salt, t, m, p, 32)
  K_pw = HKDF-SHA-256(ikm = x, salt = "vettid/vms/2/credential-pw", info = vault_id, L = 32)
  ```

  New seals use `t = 3`, `m = 64 MiB`, `p = 1`; the vault MUST refuse
  parameters below `t = 1`, `m = 8 MiB`. `salt` is 16 random bytes, fresh
  at every seal.
- **Credential key.** An Ed25519 key (a hybrid Ed25519 + ML-DSA-65 key
  from PQC Phase 2).
  - It is generated by the vault, exists only inside the credential, and
    is distinct from the relay, identity and KEM keys (§3.2).
  - It signs what the member approves; the operations that use it are
    defined with the features that need it: member authentication
    (§10.4) and signed LEASH delegations (§10.11).
- **UTK/LTK pairs.** One-time transaction keys, each an MLKEM768X25519 key pair.
  - The vault keeps the private halves (LTKs) in DEK state.
  - It gives the public halves (UTKs) to one app (§3.5.4).
- **Password.** A UTF-8 string of 8–1,024 bytes. It travels only inside a
  UTK-sealed payload. The enclave sees it transiently, as it sees the PIN
  (§12.4), and MUST NOT store or log it.

#### 3.5.2 Format

```
blob   = 0x01 || version (8, big-endian) || kid(CEK) (8) || enc (1,120) || ct
hdr    = blob[0:17]
(enc, ctx) = SetupBaseS(ek_CEK, info = "vettid/vms/2/credential" || vault_id)
ct     = ctx.Seal(aad = hdr, pt = locked)
locked = t (1) || m_KiB (4, big-endian) || p (1) || salt (16) || nonce (24)
         || XChaCha20-Poly1305(K_pw, nonce, aad = hdr || locked[0:22], inner)
```

`inner` is a UTF-8 JSON object (unknown members ignored, strict as in
§5.3), at most 131,072 bytes:

```json
{ "v": 1, "vault_id": "<id>", "version": 3,
  "created_at": "<ts>", "password_changed_at": "<ts>",
  "key": "<b64 32-byte Ed25519 seed>",
  "items": [ { "item_id": "<ULID>", "gen": 4, "key": "<b64 32 bytes>" } ],
  "crypto_keys": [ ] }
```

- `items` holds one entry per critical item (§10.7): its `item_id`, the
  random 32-byte **item key** its values are encrypted under, and that
  key's generation `gen` (≥ 1), which the ciphertext's AAD binds. The
  values (and notes) themselves are not in the credential: the vault
  keeps them in DEK state as ciphertext under the item key (envelope
  encryption, §10.7), with the items' metadata (name, category, tags,
  labels and kinds), so that apps can list them without the password and
  the credential stays small. A credential holds at most 1,000 entries
  (about 90 bytes each; `limit`) (0.7.0 replaced 0.6.0's `secrets` by
  `items`; no blob of an earlier draft exists).
- `crypto_keys` is reserved and empty: wallets keep their recovery
  phrase as a critical item (§10.18, 0.8.0).
- `version` in `inner` MUST equal the header's `version`; `vault_id` MUST
  equal the vault's.

Both layers are needed:

- The outer HPKE layer keeps a thief of the app's copy from guessing the
  password offline: only the enclave holds the CEK.
- The inner password layer keeps the vault, which holds the CEK, from
  opening the credential without the member.

#### 3.5.3 Using the credential: every use rotates the CEK

Every operation that opens the credential comes from the **holder**
(§3.5.9) and carries:

- `credential`: the blob;
- `utk_id` and `sealed`: the operation's critical payload, sealed to a UTK
  (§3.5.4).

The vault:

1. refuses with `credential_frozen` or `rotation_required` while a clone
   alarm is open (§3.5.9), before anything else (the UTK is not spent);
2. **opens `sealed`** with the LTK for `utk_id` and destroys the LTK
   (§3.5.4). A missing, used, expired or foreign UTK is refused with
   `utk_invalid`;
3. **checks the blob.** SHA-256(`credential`) must equal the hash of the
   current blob, and the presenter must be the holder. If not, the vault
   applies the clone rule of §3.5.9: the holder's own retry with the
   previous, unconfirmed version is answered `stale_credential`; anything
   else is a clone, answered `credential_frozen`. The check comes before
   the backoff, so a clone is detected even while the backoff runs;
4. refuses with `backoff` while the password backoff (below) is in effect;
5. **opens it.** The outer layer opens with the current CEK and the inner
   layer with `K_pw`. If the inner AEAD fails, the answer is
   `bad_password`; the failure is counted and recorded as
   `credential.password_failed` (§10.9);
6. **performs the operation** on the plaintext in memory;
7. **rotates the CEK**, after every successful opening, whether or not
   the content changed:
   - it generates a new CEK;
   - it seals the (possibly changed) content under it as `version + 1`,
     with a fresh salt, nonce and HPKE context;
   - it records the new hash, version and blob (the **latest blob**,
     below);
   - it **destroys the old CEK**;
   - every earlier blob is then undecryptable by anyone, the vault
     included;
8. returns the new blob and version, with new UTKs when the app's pool is
   low (§3.5.4);
9. zeroizes the plaintext, `x` and `K_pw` before the response is sent.

The vault MUST NOT keep any plaintext of the credential, `K_pw` or the
password after the operation, except the credential key during an unlock
window.

**Atomicity of a rotation.** The new CEK, the latest blob and the response
are written in the batch's flush, before the request is acked (§8.3). A
lost response therefore never loses the credential:

- **Retransmission.** The response is cached (§8.2). It holds the new blob
  but no secret value in the clear (§3.5.4), so a retransmission of the
  request within 24 h gets the same answer.
- **The latest blob is always kept until the app confirms it.** Even with
  `credential.backup` off (§3.5.6), the vault keeps the latest blob until
  the app either presents that version in a later operation or sends
  `credential.ack{version}`. The holder, answered `stale_credential` for
  its previous version (§3.5.9), fetches it with `credential.get` and
  retries with a fresh UTK. This is the only stale copy that is not a
  clone.
- **A crash.** A crash before the flush leaves the old CEK and blob in
  force: the request is redelivered and re-executed. A crash after the
  flush is covered by the outbox and the two rules above.

**Password backoff.** After 5 consecutive failures, the vault refuses
credential operations:

- for 30 s, then 1 min, 5 min, 15 min and 60 min after each further
  failure (capped at 60 min);
- a success resets the count;
- the count is in DEK state and survives locks;
- a wrong password in an owner check (§3.6) counts like any other.

**Unlock window.** `credential.unlock` keeps the credential key, and only
that key, in the vault process's memory for the
`credential.unlock_ttl_seconds` setting (30–3,600 s, default 300).

- Operations that sign with the credential key may use it within the
  window; each use extends the window to the full TTL.
- The window ends at expiry, `credential.lock`, `credential.rotate`,
  `credential.reset`, vault lock and the start of a hold (§3.6.3).
- The key is never written to state.

#### 3.5.4 One-time transaction keys (UTK/LTK)

The critical payload of every credential operation is sealed to a
single-use vault key, **inside** the session envelope. Its purpose is to
limit what a compromise of the device's session, or its session keys,
can do:

- Someone who reads or alters session traffic still cannot read a
  password or a secret.
- They cannot replay an operation: every UTK works once.
- They cannot move a payload to another operation or request: it is bound
  to both.

**Pool.** The vault keeps a pool of UTKs for each app:

- `credential.utk.get` tops the app's outstanding UTKs up to 20.
- Every credential response adds 10 new UTKs when fewer than 10 remain.
- UTKs are bound to the app they were issued to: another device's
  request naming them is refused.
- A UTK expires 30 days after issue; the vault deletes expired LTKs.
- An app whose pool is empty calls `credential.utk.get` first. It is
  allowed even on a restricted vault (§3.5.7) and for a recovering app
  (§11.11.5).

```
utk    = {"utk_id": "<16 lowercase hex>", "ek": "<b64 1,216 bytes>", "expires_at": "<ts>"}
sealed = enc (1,120) || ct                     (standard base64 in the body)
(enc, ctx) = SetupBaseS(ek_UTK, info = "vettid/vms/2/utk" || 0x00 || vault_id || 0x00 || utk_id)
ct     = ctx.Seal(aad = type || 0x00 || inner id, pt = payload JSON)
```

**Payload.** The payload is a JSON object, strict as in §5.3, of at most
16 KiB. It holds the operation's critical members (§10.6, §10.7):
`password`, `new_password`, `item_id` (which item an operation acts on),
`item` (a critical item's content) and `reply_key`, and, for a
critical-item use (§10.13), `request_id` and `payload_sha256`, which bind
the member's consent to one request and one payload. A wallet spend
(§10.18) binds it with `item_id` (the wallet) and `payload_sha256` (the
PSBT's hash), and `wallet.create` may carry an imported phrase as `item`.
A transfer's approval (§6.7.1) and an owner check (§3.6.1) carry the
`pin` (6–32 ASCII digits, §11.3) with the password; an owner check may
also carry `hold` and `hold_off_until` (§3.6.7). A History export
(`audit.export`, §10.9, 0.22.0) carries the `pin` alone and is not a
credential operation.

**Using a UTK.** The vault looks the UTK up among those issued to the
sending app and removes it from the pool before anything else is checked.
The removal is part of the batch's flush, so the UTK is spent even if the
operation then fails, for example with `bad_password`.

**Critical values in responses.** A response that would carry a critical
item's values seals them to a **one-time reply key** instead:

- The app generates an MLKEM768X25519 key pair for that request and puts
  its `ek` in the UTK-sealed payload as `reply_key`, so a session-level
  attacker can neither read nor replace it.
- The vault seals the value:

  ```
  (enc, ctx) = SetupBaseS(reply_key, info = "vettid/vms/2/reply" || 0x00 || vault_id || 0x00 || inner id)
  value_sealed = enc || ctx.Seal(aad = "", pt = value)
  ```

- Such a response holds no secret in the clear, so it is cached like any
  other (§8.2). A lost response is therefore recovered by retransmission;
  this replaces the volatile-response rule for revealing critical values
  (`item.reveal`, §10.7).
- The reply key's private half lives only in the app's memory for that
  request. The session alone, or a cached response, reveals nothing.

#### 3.5.5 Lifecycle

- **Create.** `credential.create` comes from an app, with
  `{utk_id, sealed{password}}`.
  - The vault generates the CEK and the credential key, seals version 1
    with no items, and returns the blob.
  - A vault has at most one credential.
  - Until a credential exists the vault is restricted (§3.5.7).
- **Distribution.** The app that sent `credential.create` becomes the
  holder. It stores the blob and confirms it (§3.5.3).
  - There are no other apps to distribute it to (§6.7). Only the holder
    may fetch the latest blob (`credential.get`), and only to recover
    from its own lost response (§3.5.9).
  - Desktops learn of each new version through
    `sync.event{kind: "credential.changed", version}`; they never hold
    the blob.
  - The holder changes only by a direct transfer (§6.7.1) or a recovery
    (§11.11.5); both rotate the CEK, so the old holder's copy is dead.
- **Password change.** `credential.password.change` re-seals the content
  under the new password (and, like every use, under a new CEK).
- **Rotate.** `credential.rotate` generates a new credential key.
  - It rotates the vault's `ik` and `kem` in the same flush (§3.4).
  - The vault signs a **credential-key rotation statement** with the old
    and the new credential key, while it holds both, and delivers it to
    the connections that pinned the member's key (§10.4):

    ```json
    { "v": 1, "old_key": "<b64>", "new_key": "<b64>", "sig_old": "<b64>", "sig_new": "<b64>" }
    ```

    ```
    m       = old_key (32) || new_key (32)
    sig_old = Ed25519(old credential key, "vettid/vms/2/credential-rotate" || m)
    sig_new = Ed25519(new credential key, "vettid/vms/2/credential-rotate" || m)
    ```

    Both signatures MUST verify and `old_key` MUST differ from `new_key`.
    A vault keeps its latest 32 statements. A new credential from
    `credential.reset` has no statement.
  - It is the PQC Phase 2 vehicle; the CEK rotates as with every use.
  - Apps SHOULD offer it at least yearly.
  - The vault MUST NOT rotate the credential key without the member.
- **Reset: a new credential** (0.15.2, owner decision of 2026-10-06).
  `credential.reset` deletes the credential and creates a new one in a
  single operation and a single flush, so a vault that has had a
  credential is never without one:
  - it destroys the CEK, the recorded hash, the latest blob, the UTKs
    and every critical item (§10.7); blobs held by apps can no longer be
    opened by anyone;
  - it creates version 1 of a new credential under a new password, with
    a new credential key and no rotation statement, and starts the owner
    check's clock (§3.6.1);
  - the holder sends it as `credential.reset{credential, utk_id,
    sealed{pin, password, new_password}}` (§10.6): the current blob, the
    PIN and the current password are verified as in an owner check
    (§3.6.1 steps 1–7, and the same backoffs; a `bad_pin` or
    `bad_password` is a failed check, §3.6.4), and `new_password` is the
    new credential's. Only the holder sends it: 0.16.0 removed the
    recovering app's form, since there is no recovery with the backup
    off (§11.11.5).
- **No deletion on its own** (0.15.2, owner decision of 2026-10-06).
  There is no `credential.delete`: a credential is deleted only as the
  first step of the vault's deletion (`vault.delete`, §12.5). A member
  who wants a new credential uses `credential.reset`. A vault therefore
  has no credential only during enrollment, before its first
  `credential.create` (§3.5.7).

#### 3.5.6 Backup: the vault's copy of the blob

The vault keeps the latest blob in DEK state while the `credential.backup`
setting (§10.8) is on, which is the default.

- That copy is what `credential.get` returns to the holder after a lost
  response (§3.5.9), and what a recovery hands to the new app after the
  password (§11.11.5). **It is what makes a recovery possible** (0.16.0):
  a vault that keeps no backup copy cannot be recovered (§11.11).
- The vault **has a backup copy** when the setting is on and the latest
  blob it keeps was sealed while the setting was on. After the backup is
  turned on again, the copy exists from the next use of the credential
  (below); until then the vault has none. Whether it has one is the bit
  `credential_backup` that the sealed header records (§3.3) and the
  vault reports to its host (§11.5, §13.7).
- It is sealed to the vault's current CEK outside and to the password
  inside. It is therefore useless anywhere but in the vault, and to anyone
  but the member: no copy that could be guessed offline leaves the vault.
- If the vault keeps its stored state in several versions for durability,
  every version holds the same vault-sealed object. The copies under
  destroyed CEKs are useless.
- The critical items' values are not in the blob but in DEK state,
  encrypted under the item keys the blob holds (§10.7): whichever copy
  of the latest blob a recovery uses (§11.11.5), it opens them, and
  `credential.recover` re-keys every item.

With `credential.backup` off, the vault keeps the latest blob only until
the holder confirms it (§3.5.3), then only its hash and version.

- The credential then lives **only on the holder's phone**. There is no
  off-device copy and no export (owner decision, 2026-10-03): the app
  MUST NOT write the blob anywhere but its own protected storage (no
  cloud or device backup, no file, no QR, no copy to another device).
  History's export of activity metadata (§10.9, 0.22.0), the one
  exception to that decision, never includes the credential.
  A member-supplied blob is never accepted (0.9.0 removed it from
  `credential.recover`).
- **There is no recovery with the backup off** (0.16.0, owner decisions
  of 2026-10-06, §15 item 24). Losing or replacing the phone without a
  direct transfer loses the vault: nothing in it (messages, connections,
  profile, items, the audit log, the feed, nothing) is ever released to
  an app that does not hold the credential, and VettID offers no path
  back into it. The member can only delete the vault and enroll a new,
  empty one with a setup code (§11.11.9).
- The app MUST warn clearly before turning the backup off and MUST ask
  the member to confirm. The warning says exactly that: if the phone is
  lost, broken, reset or replaced without a direct transfer, the vault
  **cannot be recovered**; it can only be deleted and replaced by a new
  one, and **everything in it is lost**, not only the critical items.
  An app approving a desktop's `settings.set` that turns it off (§6.8)
  shows the same warning. The app SHOULD repeat it where it shows the
  setting while it is off.
- Moving to a new phone while holding the old one is a direct transfer
  (§6.7.1), which works with the backup off.
- Turning the backup on again stores the copy at the next use of the
  credential. The app SHOULD ask for the password right after the
  setting changes (an owner check, §3.6.1, is such a use) and SHOULD say
  that recovery is possible only from then on.

#### 3.5.7 A vault without a credential is restricted

A vault MUST have a credential before it is used. Since 0.15.2 a vault
is without one only during enrollment (§3.5.5: no standalone deletion).

- From enrollment until `credential.create` completes, the vault answers
  every request with `credential_required` and drops every other message
  (audited).
- The exceptions are the types needed to create the credential and keep
  the session alive: `vault.status`, `vault.lock`, `credential.utk.get`,
  `credential.create`, `credential.version`, `relay.token.issued`,
  `relay.token.refresh` and `relay.address.update`.
- In particular there is no pairing, no connection or invitation and no
  feature use, and `vault.enroll.confirm` is refused. The vault therefore
  stays **provisional** (§11.3) until it has a credential.
- The sealed header records whether a credential exists (`has_credential`)
  so that a recovery of a vault without one is refused (§11.11.1).
- The owner check does not gate a vault without a credential (§3.6.1,
  0.15.2).

#### 3.5.8 What VettID and the vault can do

- **VettID** (host, API, relay) never sees the CEK, the LTKs, the
  password, `K_pw` or the credential's plaintext. It stores, at most, the
  DEK-encrypted vault state, which contains the current CEK, the LTKs and
  possibly the latest blob.
- **The vault** (an approved release, §11.10) holds the current CEK but
  not the password. It cannot open the credential, use its keys or read
  its critical items unless the member's app sends the password for an
  operation. During that operation, and during an unlock window for the
  credential key, an approved release does see the plaintext. A malicious
  release the member approved is out of scope (§2.2), as for the PIN.
- **A thief of an app's stored blob** needs the current CEK, which
  rotates at every use. The thief can therefore only guess the password
  online, through a paired app session, with a UTK, under the backoff.
  The blob is useless once the member uses the credential again.
- **An attacker reading or altering an app's session** cannot see the
  password or critical values (UTK and reply-key sealing), replay an
  operation (single-use UTKs), or redirect a payload (bound to type and
  request id).
- **An attacker who obtains the decrypted vault state** (the DEK, which
  needs the PIN and the enclave) holds the current CEK and, if kept, the
  latest blob, and can guess the password offline against Argon2id. The
  password, not the PIN, is what protects the credential in that case,
  and with it the critical items: their ciphertext in DEK state opens
  only with the item keys inside the credential (§10.7).
- **A thief who copies the blob and presents it** (through the holder's
  session, or as any other device) is detected unless the copy is
  byte-identical to the current blob and used before the member uses it
  again: every other presentation is a clone (§3.5.9). The vault refuses
  it, alerts the app and the member, and forces a rotation that kills
  every copy. The daily owner check (§3.6.6) rotates the CEK at least
  once per interval, so a copy goes stale within it.

#### 3.5.9 One holder; clone alarm, freeze and forced rotation

The credential is useful only while exactly one copy circulates, on the
holder (owner decision, 2026-10-03; PROTEAN-CREDENTIAL §4). A second
copy is the signal of theft, so the vault treats it as an alarm, not as a
routine refresh.

**The holder.** The credential state records the holder's device id.
`credential.create` sets it to the sender; a completed transfer
(§6.7.1) or recovery (§11.11.5) moves it. Only the holder may send the
types that carry or return a blob: `credential.get`, `.ack`, `.unlock`,
`.rotate`, `.password.change`, the holder's `.reset` (§3.5.5), the critical-item, critical-use
and wallet operations (§10.7, §10.13, §10.18) and `device.transfer.*`
(§6.7.1). **A vault with a credential but no holder** (a state of an
earlier draft) never adopts an app that presents a blob: it refuses
every request with `credential_required` (§3.5.7) except the recovery
path (§11.11.5: a recovering app's `credential.utk.get` and
`credential.recover`) and the types a restricted vault always
accepts. Vaults with several apps from
earlier drafts are not migrated; none exist outside tests.

**Detection.** Whenever a request presents a blob whose SHA-256 differs
from the current hash:

- **The holder's own retry is not a clone.** If the presenter is the
  holder, the blob's header `version` is exactly the current version − 1,
  and the holder has not yet confirmed the current version (by
  `credential.ack`, or by presenting it), the answer is
  `stale_credential`. This is the app re-fetching after a lost response
  or a crash; it fetches the latest blob with `credential.get`.
- **Everything else is a clone:** a presenter other than the holder; an
  older version; the previous version after the holder confirmed the
  current one; the current version with different bytes; a version above
  the current one. (Only the vault can make a valid blob, so the last two
  are tampering. OWNER DECISION, recommended: count them as clones.)

**On a clone,** in the request's flush (the UTK is spent):

1. the vault **refuses** with `credential_frozen`. It does not open the
   blob and returns nothing;
2. it **opens an alarm** `{alarm_id (ULID), kind: "clone", at, state:
   "frozen", presenter, version}` in DEK state, so it survives locks. The
   unlock window ends at once, and an open transfer is aborted (§6.7.1);
3. it sends the holder an **urgent alert**: `credential.alarm{alarm_id,
   kind: "clone", state: "frozen", at, presenter: "holder" | "other",
   version}` (durable), a feed item `credential.alarm` with priority
   `urgent` (`ref` = `alarm_id`), and `sync.event{kind:
   "credential.alarm", alarm_id, state}` to the owner's apps and
   desktops (§9.1);
4. it records `credential.clone_detected` in the audit log (`ref` =
   `alarm_id`, `device_id` = the presenter);
5. it reports the **host alarm** `alarm.credential_clone` (§11.5): a
   content-free event that the parent records on the vault row and the
   member API turns into an **email to the member** (MEMBER-API). The
   vault has no email egress; the event carries no data beyond its kind
   and the vault id. OWNER DECISION (recommended: this path).

Nothing of the alarm reaches a connection (§13.7).

A clone presented while an alarm is open is refused with the current
freeze code and audited (`credential.clone_detected`), but opens no new
alarm and reports nothing to the host.

**Freeze.** While an alarm is open, credential operations wait for the
member:

- In state `frozen`, every credential operation is refused with
  `credential_frozen`; in state `rotation_required`, with
  `rotation_required`. This covers critical items (§10.7), critical-item
  use (§10.13), wallet signing (§10.18), `credential.unlock` (so signed
  LEASH grants and member authentication answer `credential_locked`),
  `device.transfer.create` and `.approve`, and (0.22.0, owner decision
  of 2026-10-08) `audit.export`, its dry run included, although it is
  not a credential operation (§10.9 History export).
- These refusals come before the UTK is spent (§3.5.3, step 1).
- Still allowed: `credential.utk.get`, `credential.version` (which shows
  the alarm), `credential.lock`, `credential.alarm.confirm`; in state
  `rotation_required` the holder's `credential.get`, `credential.ack` and
  `credential.rotate`; and a recovering app's `credential.recover`
  (§11.11.5).
- **Everything else keeps working**: messaging, connections, calls,
  `data` and `secret` items, desktops and agents.
- **The owner check** (§3.6) is a credential operation, so it is refused
  during an alarm. A vault that is held as well keeps the alarm's path
  open (`credential.alarm.confirm`, `credential.get`, `credential.ack`,
  `credential.rotate`, §3.6.3); the check follows the rotation.

**Confirm.** The holder answers `credential.alarm.confirm{alarm_id,
mine}`: `true` for "that was me" (for example a restored phone backup),
`false` for "not me". Both move the alarm to `rotation_required`
(OWNER DECISION, recommended: a "that was me" that skipped the rotation
would keep a known second copy alive). On "not me" the app SHOULD also
suggest changing the password and the PIN. The vault audits
`credential.alarm.confirmed` (`ref` = `<alarm_id>:mine` or
`<alarm_id>:not_mine`) and sends `sync.event{kind:
"credential.alarm", alarm_id, state: "rotation_required"}`.

**Forced rotation.** In state `rotation_required` the only credential
operation is `credential.rotate` (§3.5.5) by the holder, with the current
blob and the password: a new credential key (with its rotation statement
to the connections that pinned it, §10.4), a new CEK, every critical item
re-keyed (§10.7), and the vault's `ik` and `kem` rotated (§3.4). On
success the alarm closes (`state: "resolved"`, audit
`credential.alarm.resolved`, `sync.event`) and credential operations
resume. Every older blob, the clone included, is dead; presenting it later
opens a new alarm.

- If the holder's own blob is stale, because the clone was used first,
  the holder fetches the latest with `credential.get`, allowed in
  `rotation_required`.
- **Residual.** With the backup off and the latest blob already confirmed
  by whoever used the clone, no copy of the latest version exists: the
  credential is lost. There is no recovery with the backup off
  (§11.11.5); the member can only delete the vault and start over
  (§11.11.9).
- A recovery completed during an alarm (`credential.recover`) moves the
  alarm to `rotation_required`: the recovered app is the new holder and
  must rotate.

### 3.6 The daily owner check and the hold

(Owner decisions of 2026-10-05; 0.13.0; §15 item 22.) At least once
every 24 hours the member proves to the vault that they still hold the
app: the **owner check**, the member's PIN and credential password
verified together. When the interval passes without one, the vault
**holds**: it keeps running for its peers but serves its owner's
devices nothing but the check.

The check is vault-enforced. It does not depend on the app behaving: an
app that never asks still meets the hold at the deadline. Past the
deadline **the app is always gated**: it may send only the check and
what the check needs, whatever the settings (§3.6.3). The member
decides whether **the rest of the vault** holds as well (desktops,
agents, calls, presence): the hold is on by default, and only a
successful check can turn it off (§3.6.7; owner decisions of
2026-10-06).

#### 3.6.1 The check

**One operation resets the clock:** `vault.owner-check{credential,
utk_id, sealed{pin, password, hold?, hold_off_until?}}` (§10.2), sent by
the holder (§3.5.9); `hold` and `hold_off_until` change the hold
(§3.6.7). (0.13.0–0.15.1 spelled the type `vault.owner_check`, which
§5.3's type grammar does not allow; 0.15.2 corrected it. The settings
keys, the error code and the audit, feed, sync and lock-reason kinds
keep `owner_check`.) It
is a credential operation (§3.5.3), so every check rotates the CEK. The
vault:

1. refuses with `credential_frozen` or `rotation_required` while a clone
   alarm is open (§3.5.9), before anything else (the UTK is not spent);
2. spends the UTK and opens `sealed` (§3.5.4; `utk_invalid`);
3. checks the blob (§3.5.3 step 3): `stale_credential` for the holder's
   own retry, `credential_frozen` and an alarm for a clone;
4. refuses with `backoff` while the PIN backoff of §11.8 runs, with
   `retry_after` in the error body (§10.1, 0.17.0);
5. **checks the PIN** against the vault's DEK derivation (§3.3.1), as a
   transfer's approval does (§6.7.1): it derives the DEK from `pin` with
   the header's KDF parameters and compares it with the DEK in memory in
   constant time. A mismatch is `bad_pin`, counted in the §11.8 backoff
   (`header_seq` + 1) and audited `vault.pin_failed`; the password is not
   tried;
6. refuses with `backoff` while the password backoff of §3.5.3 runs, with
   `retry_after` as in step 4;
7. **opens the credential** with the password (§3.5.3 step 5):
   `bad_password`, counted in the password backoff and audited
   `credential.password_failed`;
8. on success, in one flush: rotates the CEK (§3.5.3 step 7); resets the
   password backoff and, if it counted failures, the §11.8 backoff (a
   header write, as at a successful unlock); records the check (below);
   applies a hold change the payload carries (§3.6.7); ends the hold if
   the vault was held; audits `owner_check.passed`; and answers
   `{credential, version, utks, deadline, interval_seconds, hold,
   hold_off_until?}`.

A `bad_pin` (step 5) or `bad_password` (step 7) is a **failed check**
(§3.6.4). Other refusals (`backoff`, `utk_invalid`, `stale_credential`,
a clone) are not: they test no guess.

**The record**, in DEK state (§3.3), so it survives locks:
`owner_check = {last_at, deadline, failures}`. A check sets `last_at`
to now, `deadline` to now + the interval (§3.6.2) and `failures` to 0.
The vault measures time with the enclave's own clock, as it does a
recovery code's validity (§11.11.2).

**What else starts the clock.** Each of these verifies the PIN and the
password, or sets them, and writes the record as a check does:

- **enrollment** (since 0.15.0 always after a setup code's redeem,
  §11.12.1): the vault's first `credential.create` (§3.5.5), which
  follows the PIN of `vault.enroll` within the provisional window
  (§11.3). There is no later `credential.create`: a vault that has a
  credential answers it `exists`, and it cannot lose it (§3.5.5);
- **a new credential**: the holder's `credential.reset` (§3.5.5), which
  carries the PIN, the current password and the new one, and starts the
  clock fresh. Its `bad_pin` and `bad_password` are failed checks too;
- **a completed recovery**: `credential.recover` (§11.11.5), after the
  registered app's unlock with the PIN;
- **a completed transfer**: `device.transfer.approve` (§6.7.1), which
  carries the PIN and the password. Its `bad_pin` and `bad_password` are
  failed checks too;
- **a vault from before 0.13.0**: a vault whose state has no record
  starts the clock at its first unlock under a release that implements
  0.13.0.

**A vault without a credential** (0.15.2; owner decisions of
2026-10-06: "we shouldn't have a vault without a credential except
during enrollment", and no standalone credential deletion, §3.5.5)
exists only during enrollment, before its first `credential.create`.
The check needs the credential, so such a vault is **not gated** by the
owner check: it is never held or due, and nothing it is sent is answered
`owner_check_required` or dropped as `drop.owner_check`; it is
restricted instead (§3.5.7), which allows nothing but creating the
credential. `vault.status` reports `owner_check.state: "ok"`. Its first
`credential.create` starts the clock, and every operation that gives
the vault a new credential (`credential.reset`) starts it fresh.

**Nothing else resets it.** An unlock (the PIN only), `credential.unlock`
or any other credential operation (the password only), `pin.change` and
`credential.password.change` do not. *Rationale for one dedicated
operation:*

- The check must work on a running vault, which may stay unlocked for
  weeks; an unlock happens only after a lock.
- The unlock travels the alternate channel through the host (§11). Its
  request is padded to 12,288 bytes, which a blob of up to 131 KiB
  (§3.5.2) does not fit, and it has no UTK, no E2E session and so no
  holder identity for the clone rule (§3.5.9). Carrying the password
  there would widen what the host-routed path carries, for no gain.
- Counting "an unlock plus some credential operation within N minutes"
  would make the clock depend on two requests and a window between them.
  A single request that carries both secrets under one UTK is one place
  to implement, audit and test.

A member whose vault is locked past the deadline still types the PIN and
the password once, on one screen: the app unlocks with the PIN (§11.4)
and sends the check right after (§3.6.5).

#### 3.6.2 The interval

The setting `owner_check.interval_seconds` (§10.8) is 3,600–86,400
seconds, default and maximum **86,400 (24 h)**. A longer value is
`bad_request`. The check and its clock cannot be turned off; the hold
can (§3.6.7).

- **Owner only.** Only the app sets it. A desktop's `settings.set`
  naming it is answered `forbidden` at once, never held for approval
  (§6.8); agents never send `settings.*`.
- **Shortening** takes effect at once: `deadline` becomes the earlier of
  the current deadline and `last_at` + the new interval. That may put the
  vault into the hold at once; the app SHOULD offer a check together with
  the change.
- **Lengthening** takes effect at the next check: the current deadline
  does not move. Only a check moves a deadline later, so someone holding
  an unlocked app cannot buy time with a setting.

#### 3.6.3 The hold

From the deadline until a successful check, while the hold is on
(§3.6.7), the vault is **held**. Held
is not locked (§12.1): the DEK, the relay key and every session stay in
memory. The vault compares the time with the deadline whenever it
handles a request and at every collect cycle (§12.2, at most 30 s
apart), so no owner request is served after the deadline. A locked vault
does nothing; one that unlocks past its deadline is held from the unlock
on.

**The app gate** (owner decision of 2026-10-06). From the deadline
until a successful check, the holder's requests are limited to the
holder's row of the allow list below, and everything else it sends is
answered `owner_check_required` (or dropped and audited
`drop.owner_check`), **whether or not the hold is on**. The app cannot
be used past the deadline without the check; the hold switch (§3.6.7)
never changes that. With the hold off, only the app is gated: it gets no
fan-out but `vault.held` (with its counts) and the messages listed for
it below, and while the app is gated an incoming call rings on it but
its `call.answer` is dropped until a check (desktops may answer).
`vault.status` reports `state: "due"` for a vault past its deadline with
the hold off, `"held"` with it on.

**Entering the hold** (the hold on), in one flush, the vault:

- ends the credential's unlock window (§3.5.3), so nothing is signed
  with the credential key;
- answers every request held for an app's approval (§6.8, §10.11) with
  `owner_check_required`, and drops pending access-session requests;
- stops a ringing incoming call on its devices (`call.end{unavailable}`
  to them; the caller is not told and times out, as with a locked
  callee). A call answered before the deadline continues (below);
- audits `owner_check.held` and sends `vault.held` (below) to the
  owner's app and desktops.

**What keeps running** (the peer side; none of it waits for the member):

- collecting, acking and storing every inbound message, as when unlocked
  (§8.3): messages, receipts, profile updates, rotations, reconnects,
  rekeys and token refreshes. Delivered receipts are sent as usual; read
  receipts need the member and are not;
- the relay mailbox, tokens, sessions and their rekeys, toward devices
  and peers alike;
- **standing authorizations the member already gave a connection**:
  fetches under an issued grant (§10.12), items an `auto` share rule
  includes, actions in an `auto` mode (§10.14). They were the member's
  decisions, and a connection cannot tell a hold from an absent member;
- **everything that would ask the member is queued, not decided**:
  incoming connection requests (the handshake completes, §6.4, but the
  request stays pending; in-person auto-approval does not apply while
  held), grant and share requests, critical-item use requests, actions
  invoked in an `ask` mode, introductions and location requests. They
  keep their own expiries, which run during the hold;
- clone detection and its alarm: a `credential.alarm`, its feed item and
  its `sync.event` are delivered while held (§3.5.9).

**What stops:**

- **Incoming calls do not ring.** An offer that arrives while held rings
  no device. The vault does not answer it (no `busy`, no `call.end`), so
  the caller times out exactly as with a locked callee; the vault records
  a missed call (feed `call.missed`), counted in `vault.held`. Ringing a
  device that may not act before a check would either force the check in
  the middle of answering or ring for nothing, and an answer from a phone
  in someone else's hands would let them speak as the member. A call
  answered before the deadline continues: its device's `call.ice` and
  `call.end` are forwarded until it ends (the check is never forced
  mid-action, §3.6.5).
- **Presence.** A held vault does not answer `presence.ping` (§10.17):
  it looks locked or offline, as any refusal does (§9.2).
- **Owner fan-out.** No `sync.event`, `feed.event`, `message.new` or
  other feature event reaches a device, except those listed below. What
  happened is in vault state; devices catch up after the check
  (`sync.since`, `feed.list{after_seq}`, `message.list`).
- **Desktops' access sessions are suspended** (§6.8). A session's expiry
  keeps running, and an unexpired session resumes after the check.
- **Agents are paused** (§10.11). Their requests are refused, and the
  vault issues and renews no LEASH status statement while held, so each
  agent's statements lapse at their `not_after`: relying parties stop
  accepting its delegations within `status_ttl` + 60 s of the deadline.
  Statements already issued are not revoked early (a status statement
  cannot be). The agents' grants are untouched and resume with the check.
- **Owner-side location.** A device's `location.update` (an outgoing
  share's position or the location log's) is dropped: shares pause
  without ending.

**What the owner's devices may still send.** Every other request from
an owner device is answered `owner_check_required` (§10.1), and every
other message is dropped and audited `drop.owner_check` (bounded like
every `drop.*` entry, §10.9). Allowed while held:

| Sender | Types |
|---|---|
| The holder | `vault.owner-check`; `vault.status` (reports the hold) and `vault.lock`; `credential.utk.get` (UTKs for the check); `credential.get` and `credential.ack` (the latest blob after a lost check response, §3.5.3, and its confirmation); `credential.version`; `credential.lock`; during a clone alarm, `credential.alarm.confirm` and, in `rotation_required`, `credential.rotate` (the check is refused until the alarm closes, so the alarm's own path stays open); for a transfer opened before the hold, `device.transfer.approve` (itself a check, §3.6.1) and `device.transfer.reject`; `call.end`, and `call.ice` of a call answered before the deadline |
| A recovering app (§11.11.5) | Its own set, unchanged by the hold: `credential.utk.get`, `credential.recover`, `vault.status` (reduced) and the token and address types (0.16.0 removed `credential.reset` and `vault.delete` from it). A recovery completes while held and starts the clock (§3.6.1) |
| A desktop | `vault.status`, `vault.lock`, `device.session.end{}` (its own session), `call.end` and `call.ice` of a call it answered before the deadline |
| An agent | `vault.status`, `device.session.end{}` (its own session) |
| Any device | The handshake (`hs.init`, `hs.resp`, `hs.fin`: rekeys and reconnects), `relay.token.issued`, `relay.token.refresh`, `relay.address.update` |

In particular, while held there is no pairing approval (a pending
pairing times out), no new transfer (`device.transfer.create`), no
unlinking, no access-session grant, no `approval.decide`, no
`settings.*` (the interval included: a check ends the hold, a setting
does not), no `vault.delete` by the holder and no `pin.change`. A
deletion or a PIN change waits for the check, which takes seconds.

**What the vault still sends its owner's devices:** responses to the
allowed requests; `vault.held`; `vault.locking`; `credential.alarm`
with its feed item and `sync.event`; `device.transfer.pending` for an
open transfer; `device.unlinked`; and the token, address, rotation and
handshake messages.

**`vault.held`** (V→D, durable) is the content-free notice that lets
the app show that something arrived:

```json
{ "deadline": "<ts>", "waiting": { "messages": 3, "requests": 1, "calls": 0, "other": 2 } }
```

- Since the deadline: `messages` counts messages received, `requests`
  incoming connection requests, `calls` missed calls, and `other` every
  other event that would have created a feed item. Counts only: no
  connection, name, type or time beyond `deadline`.
- It goes to the app, and to desktops with an unexpired access session,
  when the vault enters the hold and then whenever the counts change, at
  most once per device every 10 minutes (with the latest counts). The
  first count change after the start notice is the exception (0.19.0):
  it is sent at once, without waiting out the 10 minutes, so that the
  first thing to arrive shows without delay; the 10 minutes then run
  from that notice. A device keeps the newest by `ts`.
- **In `vault.status`** (0.19.0). The same counts are in
  `vault.status`'s `owner_check.waiting` (§10.2) for each device that
  receives `vault.held`, while the state is `due` or `held`, so that a
  device that missed a notice (or opens after it) reads the current
  counts. A device that has neither a notice nor a `vault.status`
  answer does not know the counts (§3.6.5).
- A successful check ends the hold. The holder learns it from the
  response, the other devices from `sync.event{kind: "owner_check",
  deadline}`. Agents with a session receive `leash.grant.updated` with
  fresh status statements (§10.11). Fan-out resumes; nothing missed is
  replayed as events.

#### 3.6.4 Failed checks lock the vault

Wrong entries are bounded twice:

- each counts in its own backoff: a wrong PIN in the §11.8 backoff (in
  the sealed header), a wrong password in the §3.5.3 password backoff
  (in DEK state);
- `failures` in the record counts consecutive failed checks (§3.6.1),
  whichever entry was wrong. Only a successful check resets it; a lock
  does not.

**At 10 consecutive failed checks the vault locks.** In the flush of the
tenth failure the vault audits `owner_check.locked` (`ref` = the count),
creates the feed item `owner_check.locked` (priority `urgent`), answers
the request (`bad_pin` or `bad_password`), sends `vault.locking{reason:
"owner_check"}` to the owner's app and desktops, and then locks as on an
owner request (§12.3). Each further failed check while `failures` is 10
or more locks it again.

After that lock, the vault opens again only with the PIN (§11.4, under
the unlock backoff), and is still held: someone without the PIN is out
for good, and someone with the PIN but not the password keeps meeting
the password backoff, which survives locks (§3.5.3), and a lock at every
further failure.

Each failed check is also audited `owner_check.failed` (`ref` = `pin` or
`password`) and creates a feed item `owner_check.failed` (priority
`high`, same `ref`), besides `vault.pin_failed` or
`credential.password_failed`. While held, feed items reach devices only
after a check; the lock's `vault.locking` reaches them at once.

The host sees the lock as an ordinary `locked` lifecycle event (§11.5),
without a reason: it learns nothing it would not learn from any lock.
There is no host alarm and no email (§13.7; §15 item 22).

#### 3.6.5 What the apps do

- The app **MUST** ask for the PIN and the password **on one screen**,
  together, and send them in one `vault.owner-check`. It MUST NOT keep
  either beyond the check's answer (for a locked vault, beyond the unlock
  and the check that follows it), and zeroizes both.
- It **SHOULD** show the check at the **first app open** (or return to
  the foreground) after the deadline, before any screen that needs the
  vault. It **MUST NOT** interrupt an action in progress (composing a
  message, a call, an approval, a credential operation) with the prompt:
  a request refused with `owner_check_required` keeps the member's input
  (an unsent message stays a draft), and the prompt appears when the
  member leaves that screen or next opens the app.
- It **MAY** warn ahead, from 1 hour before the deadline in the
  reference app: a banner, or a local notification, with a "check now"
  action. A check is allowed at any time and resets the clock from then.
- While held it **MUST NOT** show cached vault content (messages, items,
  connections, the feed): only the check, the `vault.held` counts
  ("3 new messages waiting") and the lock action. The hold then means
  something on the phone too, not only at the vault.
- (0.19.0) It **MUST NOT** present counts it does not know as zero
  ("nothing new"): without a `vault.held` notice or a `vault.status`
  `owner_check.waiting` it shows that something may be waiting, not that
  nothing is. While gated it **re-reads `vault.status`** whenever it
  returns to the foreground, and shows the counts from it or from a
  newer `vault.held`.
- It shows which entry was wrong (`bad_pin` or `bad_password`), how many
  failed checks remain before the vault locks (10 − `failures`, from
  `vault.status`), and a running backoff's wait.
- For a **locked** vault past its deadline, one screen asks for the PIN
  and the password; the app unlocks (§11.4), reads `vault.status`, and
  sends the check if the vault is held.
- Settings offer the interval (1–24 h, §3.6.2) and the hold (§3.6.7).
  Turning the hold off is part of a check: the app asks for the PIN and
  the password on the same screen as any check, with an optional end
  date (at most 30 days ahead), and warns plainly what it gives up
  (§13.8). Turning it on needs no check.
- With the hold **off**, the app **MUST** show a persistent "hold is
  off" indicator (with the end date, if any) on its main screens. The
  check is **never dismissible**: past the deadline the app is gated by
  the vault whether or not the hold is on (§3.6.3), and the app MUST ask
  for the check before any other use, exactly as when held (the rules
  above, never mid-action, apply unchanged).
- **Desktops** cannot do the check: they hold no credential. A desktop
  SHOULD show the hold, the counts and "open your app to continue", and
  SHOULD hide its cached content likewise.

#### 3.6.6 What the check adds against a copied credential

Every check is a use of the credential, so it rotates the CEK (§3.5.3).
A copied blob therefore goes stale within one interval at most, even if
the member does nothing else with the credential: after the next check
the holder's copy is the only current one, and a later presentation of
the copy is a clone (§3.5.9). Before 0.13.0 a copy stayed current until
the member's next credential operation, which could be weeks away. The
check also bounds the "byte-identical copy used before the member's next
use" residual (§13.5) to one interval for a member who uses the app
(which is gated without a check, §3.6.3); a member away from the app
does no check, so the copy then goes stale at their next check.

#### 3.6.7 Turning the hold off

(Owner decision of 2026-10-06.) The member decides whether their vault
is held: someone travelling and offline for days may not want to come
back to a held vault. The settings `owner_check.hold` (boolean, default
`true`) and `owner_check.hold_off_until` (§10.8) hold the choice.

- **Off only with a check.** The hold is turned off only by a successful
  `vault.owner-check` whose sealed payload carries `hold: false`, and
  optionally `hold_off_until` (RFC 3339, in the future and at most 30
  days ahead; otherwise the whole request is `bad_request`, answered
  once the UTK is opened and before the PIN is tried, so it is not a
  failed check). The change is applied in the
  check's flush (§3.6.1 step 8), so it happens only if the PIN and the
  password were right. A failed check changes nothing. `settings.set`
  naming `owner_check.hold: false` or `owner_check.hold_off_until` is
  answered `owner_check_required` (the change must ride on a check).
  Someone holding only the unlocked phone cannot turn the hold off.
  *Rationale for the same request rather than "a check within the last
  5 minutes":* no window, no extra state, and the secrets that
  authorize the change are sealed to one UTK together with it (§3.5.4),
  so a session-level attacker can neither add nor alter it.
- **On without a check.** `settings.set{owner_check.hold: true}` from the
  holder, or a check with `hold: true`, turns it on at once and clears
  `hold_off_until`. If the deadline has passed, the vault is held at once
  (§3.6.3).
- **Holder only.** A desktop's `settings.set` naming either key is
  `forbidden` at once; a recovering app cannot change them.
- **Back on by itself.** With `hold_off_until`, the hold comes back on at
  that time (the vault compares it as it does the deadline, §3.6.3); if
  the deadline has passed by then, the vault is held at once. Without
  it, the hold stays off until the member turns it on.
- **With the hold off** (owner correction of 2026-10-06): the clock and
  the deadline run as usual, and **the app is still gated** past the
  deadline (§3.6.3): the member must pass the check before using the
  app; the prompt is never dismissible. What the switch turns off is the
  hold of **the rest of the vault**: desktops' access sessions continue,
  agents keep running and their status statements renew as usual
  (§10.11), incoming calls ring (on desktops, and on the app, which must
  pass the check before it can answer), presence is answered, and
  devices other than the app get their usual fan-out. Checks are still
  checks: their failures count in the backoffs and toward the
  ten-failure lock (§3.6.4), and a success resets the clock.
- **Every change is audited and announced:** audit and feed item
  `owner_check.hold_changed` (`ref` = `on`, `off`, `off_until:<ts>` or
  `on:expired` when `hold_off_until` passed; feed priority `high`), and
  `sync.event{kind: "settings.changed"}` to the other devices.
  `vault.status` reports `hold` and `hold_off_until`.
- **What it gives up** is stated in §13.8: with the hold off, a thief
  with the unlocked phone still cannot use the app past the deadline,
  but desktops and agents keep their access until the hold is turned
  back on, the vault locks or a check succeeds.

## 4. Cryptographic construction

### 4.1 Suites

| Suite | Sealed mode and KEM | Session AEAD | KDF | Signatures | Status |
|---|---|---|---|---|---|
| `1` | X25519 only | XChaCha20-Poly1305 | HKDF-SHA-256 | Ed25519 | PQC-MIGRATION's classical transition suite. **MUST NOT be sent or accepted.** |
| `2` | **HPKE** (RFC 9180), base mode, KEM **MLKEM768X25519** (`0x647a`), KDF HKDF-SHA256 (`0x0001`), AEAD ChaCha20-Poly1305 (`0x0003`) | XChaCha20-Poly1305 | HKDF-SHA-256 | Ed25519 | **This document** |
| `3` | As suite 2 | As suite 2 | As suite 2 | Ed25519 + ML-DSA-65 (PQC-MIGRATION §5.2, AND policy) | Reserved for PQC Phase 2 |

MLKEM768X25519 is the X-Wing-style hybrid KEM (draft-connolly-cfrg-xwing-kem
and the HPKE PQ codepoints). Interoperable implementations exist:

- Go 1.26 `crypto/hpke` (`hpke.MLKEM768X25519()`);
- Apple CryptoKit's X-Wing HPKE suite;
- BouncyCastle.

The suite satisfies PQC-MIGRATION §5.1:

- An attacker must break **both** ML-KEM-768 and X25519 to recover the
  shared secret.
- Its combiner binds the X25519 ciphertext and public key, which is the
  transcript binding §5.1 requires. The ML-KEM ciphertext is bound by
  ML-KEM's own CCA security.

It replaces the bespoke combiner of 0.1. The KEM codepoint and all sizes are
pinned by the §16 vectors.

Notation and labels:

- All labels are ASCII strings with no terminator, and embed the suite
  number (`vettid/vms/2/...`), except LEASH's `leash/v1/delegation` and
  `leash/v1/status` (§10.11, 0.12.0), which are the LEASH paper's and
  versioned by its format.
- `||` is concatenation.
- `HKDF-SHA-256(ikm, salt, info, L)` is RFC 5869 extract-then-expand.
- HPKE `SetupBaseS`, `SetupBaseR`, `Seal`, `Open` and `Export` are as defined
  in RFC 9180.

### 4.2 AEADs

- **Sealed mode** uses HPKE's ChaCha20-Poly1305. Every HPKE context seals
  exactly one message, and HPKE derives the nonce.
- **Session mode** uses XChaCha20-Poly1305 with a fresh random 192-bit nonce
  per message. Restored state, device backups and retries make persisted
  nonce counters fragile, and the 96-bit nonce of ChaCha20-Poly1305 is too
  short to draw at random. XChaCha20 is also the AEAD that RELAY-PROTOCOL
  §6.8 recommends for blobs.

### 4.3 Sealing to a KEM key

```
(enc, ctx) = SetupBaseS(pk_R = ek_R, info = "vettid/vms/2/sealed")   # enc: 1120 bytes
ct         = ctx.Seal(aad = envelope header bytes[0:1140], pt = padded_inner)
```

The recipient runs `SetupBaseR(enc, sk_R, info)` and then `Open`. The same
context MAY `Export` secrets for the handshake (§6.3) and for calls (§10).
Implementations MUST NOT reuse a context for a second message.

### 4.4 Key ids

A `kid` is 8 bytes:

- for a static KEM key or the ETK, `SHA-256("vettid/vms/2/kid" || ek)[0:8]`;
- for a session, derived per direction for each epoch (§6.3);
- all-zero for an anonymous sender.

Kids are lookup hints, not authenticators. When decryption under the key a
kid indicates fails, the message is dropped. A receiver MUST NOT
trial-decrypt under other principals' keys.

## 5. The v2 envelope

### 5.1 One format

Every relay payload and every alternate-channel request (§11) is a v2
envelope, and the relay `payload` field is its base64. The message type,
request id, timestamp and sequence number are all **inside the ciphertext**.

### 5.2 Byte layout

```
offset  len    field
0       1      ver            0x02
1       1      suite          0x02
2       1      mode           0x01 session | 0x02 sealed
3       1      flags          0x00 (reserved; non-zero MUST be rejected)
4       8      sender_kid
12      8      recipient_kid
--- session mode ---
20      24     nonce          random (XChaCha20-Poly1305)
44      n+16   ciphertext     XChaCha20-Poly1305(k_epoch_dir, nonce, aad = bytes[0:44], padded_inner)
--- sealed mode ---
20      1120   enc            HPKE encapsulated key (MLKEM768X25519)
1140    n+16   ciphertext     HPKE ctx.Seal(aad = bytes[0:1140], padded_inner)   (§4.3)
```

- The header length `H` is 44 bytes in session mode and 1,140 in sealed mode.
  The AAD is the whole header.
- Overhead is 60 bytes in session mode and 1,156 bytes in sealed mode.
- Sealed mode carries:
  - `hs.init` and `hs.resp` (§6);
  - `vault.enrolled`;
  - `vault.unlock.result`;
  - alternate-channel requests.

### 5.3 Inner plaintext

The inner plaintext is a UTF-8 JSON object, followed by padding:

```json
{ "v": 1, "id": "01JB2Z6V9K3M4N5P6Q7R8S9T0V", "type": "message.send",
  "ts": "2026-10-01T12:00:00.123Z", "seq": 42,
  "re": "<id of request answered>", "exp": "<RFC 3339>",
  "status": "ok", "error": { "code": "not_found", "message": "..." },
  "body": { } }
```

| Field | Req | Meaning |
|---|---|---|
| `v` | MUST | Inner format version, `1` |
| `id` | MUST | ULID. It is both the message id and the **idempotency key**: a retransmission of the same logical message MUST reuse it, in a new envelope. |
| `type` | MUST | Registry name (§10) |
| `ts` | MUST | Sender clock, RFC 3339 UTC with milliseconds |
| `seq` | session mode | Counter per epoch and per direction, starting at 1. An ordering hint and gap detector only. |
| `re` | responses | `id` of the request being answered |
| `exp` | MAY | Discard the message if it is still unprocessed after this time. REQUIRED for ephemeral types (§8.5). |
| `status`, `error` | responses | `ok` or `error` |
| `body` | MUST | Type-specific. The schema is TBD per feature unless this document defines it. |

- Binary values are encoded as standard base64 with padding. Receivers
  MUST reject non-canonical base64 and base64 containing CR or LF.
- Unknown fields are ignored. Known fields MUST have exactly the type and
  form given here; receivers MUST reject anything else.
- Receivers MUST reject an inner plaintext (including its `body`) that is
  not valid UTF-8, that has duplicate member names at any depth, or that
  has any data after the object. Member names are case-sensitive.
- Integers are plain JSON integers (no sign, fraction or exponent) no
  larger than 2^53 − 1.
- `id` and `re` are canonical ULIDs: 26 upper-case Crockford base32
  characters, the first in `0`–`7`.
- `ts` and `exp` both use the format `YYYY-MM-DDTHH:MM:SS.mmmZ`: RFC 3339,
  UTC, exactly three fractional digits, a literal `Z`.
- `seq` MUST be present in session mode and MUST be absent in sealed
  mode. It is an integer ≥ 1.
- `re` and `status` appear together (responses) or not at all (requests and
  events). `error` is present if and only if `status` is `error`;
  `error.code` matches `[a-z_][a-z0-9_]*` (at most 64 bytes) and
  `error.message` is optional.
- `type` matches `[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*` and is at most
  64 bytes.
- `body` MUST be a JSON object (`{}` when empty).
- A receiver cannot tell a request from an event by a `type` it does not
  know. A message **without `re`** whose `type` is unknown is therefore
  answered with `error` code `unsupported_type`; a sender that did not
  expect a response drops it (§8.1). A message with `re` whose `type` is
  unknown is dropped.

### 5.4 Padding

The padded inner plaintext is `json || 0x80 || 0x00*`, padded to:

- the next multiple of 512 bytes, up to 16 KiB;
- above 16 KiB, the next multiple of 16 KiB.

The bucket is computed for `len(json) + 1` (the `0x80` marker counts). The
padded length MUST be exactly that bucket: over-padding to a larger bucket
is malformed.

Alternate-channel plaintexts are padded to exactly 4,096 bytes; a 4,096-byte
inner plaintext produces a 5,252-byte sealed envelope. The exceptions are
the `vault.enroll` and `vault.unlock` requests, which carry the device
attestation and the manifest's hash (§11.3, §11.4) and are padded to exactly **12,288 bytes**
(a 13,444-byte envelope), whether or not an unlock carries a release
update.

Receivers MUST reject malformed padding: a padded length that is not
exactly the bucket for the JSON it contains (or not exactly the fixed size
on the alternate channel), a last non-zero byte other than `0x80`, or no
marker at all. Senders and receivers check the ciphertext length (padded
length + 16) against the bucket sizes before decrypting.

### 5.5 Size limits and claim-check

- The decoded envelope MUST fit the relay's `max_payload_bytes` (262,144 by
  default). Senders MUST keep the padded inner plaintext at or below 245,760
  bytes, which leaves room for either mode's overhead.
- The **claim-check blob flow** (RELAY-PROTOCOL §6.8) SHOULD be used for
  content over 64 KiB, and MUST be used for content that would not otherwise
  fit:
  1. Encrypt the content under a fresh 256-bit key:

     ```
     blob = nonce (24, random) || XChaCha20-Poly1305(key, nonce, aad = "vettid/vms/2/blob", content)
     ```

  2. Upload `blob` with `PUT /v1/blob/{recipient_mailbox}`.
  3. Send a message whose body carries `{"blob": {"id", "key", "sha256",
     "size", "mime", "name"}}`, where `sha256` is SHA-256 of `blob` (the
     uploaded bytes) and `size` is the length of `content`. The receiver
     MUST check `sha256`, in constant time, before decrypting.

  Names and MIME types never leave the ciphertext.
- If the relay does not support blobs, the operation fails with
  `payload_too_large`.

## 6. Sessions, invitations, reconnects and pairing

### 6.1 One handshake

All sessions use the same three messages: vault ↔ device, vault ↔ vault,
rekeys and reconnects. Before the handshake, initiator `I` already knows the
responder's `ik_R` and `ek_R`, from one of:

- attestation (§11.3);
- a claim bundle (§6.4);
- the stored connection (rekey or reconnect).

```
I                                                         R
|--hs.init  [sealed to ek_R]------------------------------>|  K_s = Export(init ctx)
|   {purpose, ctx, from{ik,kem,relay}, eph, token,          |
|    reconnect_token, suites, sas_commit, ...}              |
|<--hs.resp [sealed to eph]--------------------------------|  K_e = Export(resp ctx)
|   {token, reconnect_token, suite, sas_nonce = n_R,       |
|    sig_R, ...}                                           |
|  verify sig_R; sas known                                 |
|--hs.fin   [session mode, new epoch]--------------------->|  check sig_I and n_I;
|   {sig_I, sas_nonce = n_I}                               |  sas known; epoch
|                                                          |  established (§6.3)
```

`sas_commit`, `n_I` and `n_R` exist for purposes `app`, `desktop`, `agent`
and `connection` (0.10.3); rekeys and reconnects carry none and have no SAS.

### 6.2 Bodies

```json
hs.init: { "purpose": "app|desktop|agent|connection|rekey|reconnect",
           "ctx": "<invite_id | pairing_id | previous epoch_id | connection ref>",
           "from": { "ik": "<b64>", "kem": "<b64 ek>",
                     "relay": {"url": "<base>", "mailbox": "<id>", "pk": "<b64>"} },
           "eph": "<b64 ephemeral ek>",
           "token": "<standing token; sub = responder relay key>",
           "reconnect_token": "<connections only; §6.6>",
           "suites": [2],
           "profile": { },
           "rotations": [ ],
           "device_attest": { },
           "api_key": "<b64 SPKI DER, P-256; a transfer's hs.init only>",
           "sas_commit": "<b64 32 bytes>" }
hs.resp: { "token": "...", "reconnect_token": "...", "suite": 2,
           "rotations": [ ], "sas_nonce": "<b64 n_R, 32 bytes>", "sig": "<b64>" }
hs.fin:  { "sig": "<b64>", "sas_nonce": "<b64 n_I, 32 bytes>" }
```

Field rules:

- `profile` is self-asserted and optional (§6.4). It is allowed only for
  purposes `app`, `desktop`, `agent` and `connection`. A vault's `profile`
  (purpose `connection`) carries only `{first_name, last_name, name?}`
  (0.18.0): the core names of its shared profile, always, and its display
  name, if any (§10.8); `ik` is `from.ik`, which the handshake's
  signature binds. A connection `hs.init` from a vault whose `profile`
  lacks either name is dropped and audited `drop.profile_malformed`. The rest of the shared profile follows in
  `profile.update` once the connection is active (§9.3), so nothing more
  is disclosed to a party that has not been approved. The receiving app
  shows the names on the request as §10.8 says for a profile (account
  names, not verified). A device's `profile` is unchanged.
- `rotations` is used only for reconnects (§6.6), in both `hs.init` and
  `hs.resp`; it MUST be absent for every other purpose.
- `device_attest` is used only for purpose `app` (§6.7, §11.7).
- `api_key` (0.15.0) is the new app's app key (§11.12). It is REQUIRED in
  the `hs.init` of a transfer (§6.7.1) and MUST be absent otherwise (an
  enrolling or recovering app gave its key in the sealed request). A
  transfer `hs.init` without a well-formed key is dropped like one with
  an invalid attestation.
- **SAS commitment** (0.10.3, §6.3). For purposes `app`, `desktop`,
  `agent` and `connection`, `hs.init` MUST carry `sas_commit`, and
  `hs.resp` and `hs.fin` MUST carry `sas_nonce`; for `rekey` and
  `reconnect` all three MUST be absent. Each is the standard base64 of
  exactly 32 bytes. `n_I` and `n_R` are fresh output of a CSPRNG for
  each handshake and are never reused; `n_I` is chosen before `hs.init`
  is built, `n_R` only after `hs.init` has been opened. A message that
  breaks these rules is rejected as a malformed body.
- `token` in a `connection` handshake (both `hs.init` and `hs.resp`) is
  a **request token** (0.10.3, §7.1); the standing and reconnect tokens
  follow in `connection.approved` (§6.4). In an `app`, `desktop` or
  `agent` handshake that needs the owner's approval (§6.7, §6.7.1),
  `hs.resp`'s `token` is a request token too, and the standing token
  follows in `device.paired`.
- `ctx`:
  - `connection`: the `invite_id`; `app`, `desktop`, `agent`: the pairing
    id (the bundle's `invite_id`, §6.4);
  - `rekey`: the standard base64 of the 16-byte `epoch_id` of the current
    epoch; the responder MUST reject any other value;
  - `reconnect`: the standard base64 of the stored `epoch_id` of the last
    epoch (§6.6).

  `ctx` is 1–128 bytes of printable ASCII (`0x21`–`0x7e`).
- Tokens, per purpose, in both `hs.init` and `hs.resp`:

  | Purpose | `token` | `reconnect_token` |
  |---|---|---|
  | `app`, `desktop`, `agent` | required | MUST be absent |
  | `connection` | required (a request token) | MUST be absent (0.10.3: in `connection.approved`) |
  | `reconnect` | required | required |
  | `rekey` | optional | optional |

  Both are PASETO v4.public strings (`v4.public.` followed by base64url
  and `.` characters, at most 4,096 bytes).
- `from.relay.url` is an absolute `https` base URL without user info, query
  or fragment (`http` is allowed only for loopback hosts, in development);
  `from.relay.mailbox` MUST equal the mailbox id derived from
  `from.relay.pk` (RELAY-PROTOCOL §3.2).
- `eph` MUST differ from `from.kem`.
- `suites` is 1–8 strictly ascending integers in [2, 255]. An offer that
  contains suite 1 is rejected. Unknown suites above 2 are allowed and not
  chosen.
- `hs.init` uses `sender_kid` = anonymous or the initiator's static kid, and
  `recipient_kid` = kid of `ek_R`. A non-anonymous `sender_kid` MUST equal
  the kid of `from.kem`.
- `hs.resp` uses `sender_kid` = all-zero and `recipient_kid` = kid of
  `eph`.
- On **rekey**, `hs.init` travels in session mode under the current epoch,
  and `K_s` is the current (soon previous) epoch's `rk`. A rekey `hs.init`
  is accepted only under the current epoch.

### 6.3 Key schedule

```
K_s      = init_ctx.Export("vettid/vms/2/hs-ks", 32)       # rekey: K_s = rk of previous epoch
K_e      = resp_ctx.Export("vettid/vms/2/hs-ke", 32)
th1      = SHA-256("vettid/vms/2/th1" || env_init)         # env_init = full hs.init bytes
th       = SHA-256("vettid/vms/2/th"  || env_init || resp_header)   # hs.resp bytes[0:1140]
prk      = HKDF-Extract(salt = "vettid/vms/2/session", ikm = K_e || K_s)
k_i2r    = HKDF-Expand(prk, "vettid/vms/2/i2r"     || th, 32)
k_r2i    = HKDF-Expand(prk, "vettid/vms/2/r2i"     || th, 32)
kid_i2r  = HKDF-Expand(prk, "vettid/vms/2/kid-i2r" || th, 8)
kid_r2i  = HKDF-Expand(prk, "vettid/vms/2/kid-r2i" || th, 8)
rk       = HKDF-Expand(prk, "vettid/vms/2/rk"      || th, 32)
epoch_id = HKDF-Expand(prk, "vettid/vms/2/epoch"   || th, 16)
sig_R    = Ed25519(ik_R, "vettid/vms/2/sig-resp" || th)
sig_I    = Ed25519(ik_I, "vettid/vms/2/sig-fin"  || th)
sas_commit = SHA-256("vettid/vms/2/sas-commit" || n_I)     # in hs.init
sas      = uint32be(HKDF-Expand(prk, "vettid/vms/2/sas" || th || n_I || n_R, 4))
           mod 1,000,000, shown as 6 zero-padded digits    # 0.10.3
```

Session-mode envelopes use the epoch keys and kids:

- In direction `i2r`, the sender uses `k_i2r`, sets `recipient_kid` =
  `kid_i2r` and sets `sender_kid` = `kid_r2i`.
- Direction `r2i` mirrors this.

`th` covers the KEM ciphertexts of both `hs.init` and `hs.resp`, so `K_s` and
`K_e` are bound into both signatures.

Verification and activation:

- `I` MUST verify `sig_R` before using any epoch key, and MUST abort if it
  fails. For a new peer, `sig_R` is checked under the pinned `ik_R`. For a
  reconnect, it is checked under the current key that `rotations` leads to.
- The abort applies once a message has decrypted under `eph`: after that,
  any failure (body, suite, chain or `sig_R`) aborts the handshake and
  destroys its state. A message that does not decrypt under `eph`, or
  whose collect `sender` is wrong, is dropped without affecting the
  handshake.
- `I` processes **one** `hs.resp` per `hs.init`: once it has sent `hs.fin`
  (and so revealed `n_I`), any further `hs.resp` for that handshake is
  acked, dropped and audited. `R` sends one `hs.resp` per `hs.init`;
  its retries resend the same bytes.
- `R` **establishes** the epoch only after `sig_I` verifies and, where
  the purpose has a SAS, SHA-256(`"vettid/vms/2/sas-commit"` || `n_I`)
  equals `sas_commit`. An `hs.fin` whose `sig_I` does not verify is
  dropped; the pending handshake is kept until it expires. An `hs.fin`
  whose `sig_I` verifies but whose `n_I` does not match the commitment
  can only come from `I`: `R` aborts the handshake, destroys its state
  and audits `drop.sas_commit_mismatch`; a connection request or pairing
  it belonged to is dropped (§6.4, §6.7).
- An established epoch is **active** at once for rekeys, reconnects and
  handshakes answered without approval (§11.3, §11.11.5). For a
  connection it becomes active only when both members have approved
  (§6.4); for a pairing or transfer, at the owner's approval (§6.7,
  §6.7.1). Messages for an inactive epoch are left unacked, except as
  §6.4 and §6.7 say for a pending request.
- **A new epoch's messages before `hs.fin`** (0.23.0, owner decision of
  2026-10-09, §15 item 31). `I` may send in the new epoch as soon as it
  has sent `hs.fin`, and the mailbox does not keep order (§8.4), so `R`
  can receive a message of the new epoch while it still awaits `hs.fin`:
  under the handshake's keys it decrypts as a message other than
  `hs.fin`, or it names an epoch `R` has not established. `R` MUST leave
  such a message **unacked**, without processing, dropping or auditing
  it, so that the relay redelivers it after `hs.fin` has established the
  epoch (then it is processed normally, or, if the handshake expired or
  was aborted, it is dropped by the usual rules when it next arrives).
  This binds every responder: the vault (which has always left it
  unacked) and, when the vault initiates a rekey (§6.5: on every unlock
  and every 7 days) or a reconnect, the device, desktop or agent. A
  device that acked or dropped it would lose the message: the relay
  deletes an acked message, and the sender does not send it again.
- The collect `sender` (RELAY-PROTOCOL §6.3) MUST equal `from.relay.pk` for
  `hs.init`. For every later message, `sender` MUST equal the relay key on
  record for the principal whose session decrypts it. A mismatch is acked,
  dropped and audited.
- **The SAS** (0.10.3). `sas` exists only once both nonces are fixed:
  `I` computes it after verifying `sig_R` (it then sends `hs.fin`), `R`
  after checking `hs.fin` as above. Neither side shows a code earlier.
  For a connection both members see it (§6.4); for a pairing or
  transfer, the owner's app and the new device (§6.7, §6.7.1).
- **Why the commitment.** `I` fixes `n_I` (by `sas_commit`) before it
  sees `n_R`; `R` chooses `n_R` before it learns `n_I`; and after `n_I`
  is revealed nothing that enters `sas` can change (`th` and `prk` are
  fixed by `hs.resp`). So neither side, and no party in the middle, can
  steer `sas`. A man in the middle between two members runs two
  handshakes, one with each. In the one where it is the responder it
  must send `n_R` before the victim reveals `n_I`; in the one where it
  is the initiator it must commit to its `n_I` before the victim sends
  `n_R`. Each victim's SAS is therefore uniform over the 10^6 codes and
  independent of the other's, whichever order the attacker runs them
  in, so the two codes match with probability about 10^-6 per attempt
  (the modulo bias is below 2.5 × 10^-13). An attempt costs a fresh
  invitation (single use, §6.4) or a fresh accept by the victim, and a
  failed one shows the members different codes. Before 0.10.3, `sas`
  depended only on `hs.init`, which the initiator alone chooses; an
  attacker could try about 10^6 `hs.init`s offline until the codes
  matched (§15 item 17). `prk` and `th` in the derivation bind the code
  to both identities, both KEM exchanges and this handshake.

### 6.4 Connections and invitations

An invitation combines:

- the QR claim-check of PQC-MIGRATION §6.5;
- an open token (RELAY-PROTOCOL §5.6);
- a claim (§6.9).

**Invite TTL.** The inviter chooses a TTL, which sets the invite's `exp`, the
open token's lifetime and the claim TTL together:

| TTL | Use |
|---|---|
| 10 min | Default. In person. |
| 1 h, 24 h, 7 days | **Remote invites**, for example a link sent through another channel |

The TTL MUST be at or below both of the relay's advertised
`open_token_max_lifetime_seconds` and `claim_ttl_seconds`. The app MUST NOT
offer options above them.

**Bundle**, encrypted before upload:

```json
{ "v": 1, "suite": 2, "kind": "connection", "invite_id": "<ULID>", "remote": false,
  "vault": { "ik": "<b64>", "kem": "<b64 ek>",
             "relay": {"url": "<base>", "mailbox": "<id>", "pk": "<b64>"} },
  "token": "<open token, exp = invite exp>", "exp": "<RFC 3339>",
  "hint": { "name": "<optional>" } }
```

Bundle rules:

- `hint.name`, if present, is the inviter's display name (§10.8). Anyone
  who holds the link can read it.
- `kind` is `connection`, or `app`, `desktop` or `agent` for pairing
  (§6.7); it MUST match the QR `t` (`c`, `p`, `d`, `a` respectively).
  Since 0.9.0, `app` (`p`) is used only by a direct transfer (§6.7.1).
- For pairing, `invite_id` carries the pairing id, and `remote` MUST be
  `false`.
- `exp` is RFC 3339 UTC in **whole seconds** (`YYYY-MM-DDTHH:MM:SSZ`, no
  fraction) and MUST equal the QR `e`. This is the only whole-second
  timestamp in this document; inner timestamps use milliseconds (§5.3).

The bundle is protected and published as follows:

- `blob = nonce(24) || XChaCha20-Poly1305(k_b, nonce, aad = "vettid/vms/2/bundle",
  json)`, where `k_b` is a fresh random 32-byte key.
- The vault PUTs `blob` as a claim whose TTL equals the invite TTL.
- The **QR / link payload** is compact JSON (base64url-encoded in links):

  ```json
  {"v":2,"t":"c","r":"<relay base URL>","c":"<claim_id>","h":"<b64url SHA-256(blob)>","k":"<b64url k_b>","e":<unix exp>}
  ```

  `t` is `c` for a connection; `p` transfers the app to a new phone
  (§6.7.1); `d` and `a` pair a desktop or agent (§6.7). `h`, `k` and the link encoding are base64url **without** padding
  (RFC 4648 §5). `c` is the relay's 26-character claim id.
- The scanner fetches the claim, MUST check `SHA-256(blob)` = `h` in
  constant time before decrypting, decrypts under `k`, and MUST reject a
  bundle whose `kind` does not match `t`, whose `exp` differs from `e`, or
  that has expired.

**Invitation URL** (0.10.2). A connection invitation (`t` = `c`) is shared
as a URL on **the invitation's own relay** (`r` in the payload):

```
<r>/connect#<link>          e.g. https://relay.vettid.org/connect#<link>
```

- `<link>` is the base64url payload above and is the whole fragment: no
  query, no other path, nothing else in the fragment. Apps build the URL
  from `link` (§10.4) and the payload's `r`. The relay that carries the
  connection also hosts its link, so a home appliance or a self-hosted
  relay (owner decision, 2026-10-04) needs nothing from vettid.org.
- The fragment never reaches a server, so the payload stays out of
  requests, access logs and referrers.
- **The relay serves `/connect`** (RELAY-PROTOCOL): a static page, the
  same for every relay, that says to open the link in the VettID app.
  It MUST NOT send the fragment anywhere: no network requests at all
  (`Content-Security-Policy: default-src 'none'`, inline style and one
  inline script allowed by hash), no third-party content,
  `Referrer-Policy: no-referrer`. Its inline script MAY read the fragment
  locally only to build an "Open in VettID" link `vettid://connect#<link>`
  and a copy button.
- **Opening the app.** Every relay serves
  `/.well-known/assetlinks.json` for the VettID app's signing keys (and
  later `apple-app-site-association`), built into the relay software. For
  the relays VettID runs, the app declares the host, so the URL opens the
  app directly as a verified App Link. A self-hosted relay's host cannot
  be declared in advance, so there the page's "Open in VettID" link uses
  the `vettid:` scheme. Another app could register that scheme too and
  receive the payload; it learns nothing it could not get by holding the
  link, and accepting with it is caught by the SAS comparison (§6.3).
- Apps MUST accept the URL form on any relay, the `vettid://connect#`
  form and the bare payload, pasted or opened, and MAY find any of them
  inside surrounding text. The payload inside is authoritative: the host
  of the URL is not trusted, and its `r` decides the relay. Apps pass the
  bare payload to `connection.invite.accept`, which accepts only that.
- **QR codes keep the compact JSON.** It needs a smaller QR version than
  the URL (no base64url growth, no prefix) and is read only by the VettID
  scanner. Scanners MUST also accept a QR holding the bare payload or
  the URL form, so that a later switch to URL QRs, which a phone's camera
  would open, needs no app release.
- Pairing and transfer links (`t` = `p`, `d`, `a`) are used in person
  and stay bare payloads.

```
A app            A vault           Relay            B vault           B app
  |--invite.create{ttl}-->|           |                 |                |
  |                  |--PUT claim---->|                 |                |
  |<--QR / link------|                |                 |<--invite.accept{QR}
  |                  |                |<--GET claim-----|  check h, decrypt, exp
  |                  |                |<--hs.init{sas_commit}------------|
  |                  |                |   (open token)  |--{connection_id, waiting}-->|
  |                  |<--collect------|                 |                |
  |                  |--hs.resp{n_R}->|---------------->|  (at once, no approval)
  |                  |                |<--hs.fin{n_I}---|  (at once)     |
  |                  |<--collect------|                 |--request.outgoing{sas}-->|
  |<--request.pending{profile,sas,remote}               |                |
  |   (each member compares the SAS with the other's screen)             |
  |--approve-------->|--connection.approved{tokens}---->|<--approve------|
  |                  |<------------connection.approved{tokens}-----------|
  |<--connection.event{added}         |                 |--connection.event{added}-->|
```

(0.10.3) The handshake runs to its end before anyone approves; the SAS
exists only after `hs.resp` (at the accepter) and `hs.fin` (at the
inviter), and approval is a separate, authenticated message in each
direction.

Rules:

- **Single use.** Every invite is single-use. The inviting vault accepts at
  most one `hs.init` per `invite_id` and rejects invites that are expired,
  used or revoked. The claim is single-fetch.
- **The handshake first** (0.10.3). The SAS depends on both sides'
  nonces (§6.3), so the vaults complete the handshake before either
  member decides:
  - The **inviting** vault answers a valid `hs.init` for a live
    invitation with `hs.resp` at once, after the checks of this section
    (single use, block list, the inviter's drop, limits). `hs.resp`
    carries only a request token (§7.1) and reveals nothing the bundle
    does not, except that the vault processed the `hs.init`.
  - The **accepting** vault answers `hs.resp` with `hs.fin` at once and
    then knows the SAS. It answers `connection.invite.accept` before
    that, with `state: "waiting"`, and sends the SAS to its apps and
    desktops in `connection.request.outgoing` once it has it.
  - The inviting vault knows the SAS once `hs.fin` checks out (§6.3) and
    only then tells its devices, with `connection.request.pending`. An
    `hs.init` that never gets its `hs.fin` is never shown and is dropped
    at the 7-day expiry below.
- **Safety code (SAS, §6.3), both sides** (0.10.2). Both apps MUST show
  it, as six digits, with the other side's name, and ask their member to
  compare it with the code on the other member's screen (in person, or
  over a channel they trust, such as a call). Each member decides only
  for their own side:
  - The **inviter** approves (`connection.approve{pending_id}`) or
    declines the incoming request, as below.
  - The **accepter** approves (`connection.approve{connection_id}`) or
    declines (`connection.decline{connection_id}`) its outgoing request.
  - **Approval** (0.10.3). On its member's approval a vault sends the
    peer `connection.approved{token, reconnect_token}` (V↔V, session
    mode under the handshake's epoch), carrying the standing and
    reconnect tokens for the peer (§6.6, §7.1). A vault makes the
    connection active, and sends its devices `connection.event{added}`,
    when it holds both its own member's approval and the peer's
    `connection.approved`, in either order; the epoch becomes active
    then (§6.3). Neither side shares a profile or anything else before
    that. An approval of a request whose SAS is not yet known (`waiting`)
    is answered `bad_request`.
  - **Before activation**, a vault accepts from the peer, under the
    handshake's epoch or the request token, only the rest of the
    handshake, `connection.approved` and (0.10.5) `connection.declined`,
    the last whether or not its own member has approved. Before its own member's approval, anything
    else is acked, dropped and audited (`drop.unapproved_peer`); after
    it, anything else is left unacked and processed at activation (the
    peer may already be active and its messages may overtake its
    `connection.approved`).
  - A `connection.approved` that arrives once the connection is active
    is ignored (0.10.4).
  - **Declining** drops the request, its handshake state and the tokens
    held for the peer, and denylists every token the vault issued to the
    peer (§7.4). A member who sees a different code declines.
    `connection.decline` is accepted in any state, `waiting` included
    (0.10.4; an `hs.init` the inviter dropped is never answered, and
    `exists` would otherwise refuse that inviter until expiry);
    `connection.approve` only once the SAS is known.
  - **The decline is sent** (0.10.5; owner decision of 2026-10-05,
    reversing 0.10.2's): requests come only from someone holding an
    invitation the member made, or to an invitation the member accepted,
    so a stranger cannot ask to connect and there is nothing to hide by
    keeping a decline silent. This is an exception, for connection
    requests only, to the silence of other refusals (§9.2).
    - On its member's decline, the vault sends the peer
      `connection.declined{}` (V↔V, session mode under the handshake's
      epoch, deposited on the request token the **peer** issued to it:
      the channel `connection.approved` uses, §7.1), then drops the
      request as above. One flush (§7.4): the message is sealed and its
      deposit queued first, while the epoch still exists; the queued
      deposit carries its own copy of the peer's token, so deleting the
      tokens held for the peer does not cancel it; and the tokens the
      vault denylists are those **it** issued to the peer, which the peer
      would deposit with, not the one it deposits with. Delivery is best
      effort, retried as any deposit (§8.6) until that token expires.
    - **Always the request token** (0.10.6). If the peer's
      `connection.approved` has already arrived, the vault holds the
      peer's standing (and reconnect) token too, but it still deposits
      the decline on the peer's **request** token, which it keeps for
      that purpose until the request ends; it never uses the standing
      token. The receiver accepts `connection.declined` on its request
      token whether or not it sent its own `connection.approved` (above),
      and a deposit on its standing token would reach a connection that
      is not active on the decliner's side.
    - **When it can be sent.** Only once the vault holds both the
      handshake's epoch and a token from the peer:
      - The **inviter** declining an incoming request: always, for any
        request its devices were shown. They are shown only after
        `hs.fin` checked out, when the epoch is established and the
        vault holds the request token of the accepter's `hs.init`, in
        `pending` and in `approved` (auto-approval included). A decline
        of an `hs.init` still awaiting its `hs.fin` (a `pending_id` its
        devices were never given) sends nothing; the accepter's request
        then ends by its 8-day expiry, as before.
      - The **accepter** declining an outgoing request: in `pending` and
        `approved`, that is once `hs.resp` arrived (its request token)
        and `hs.fin` went out (the epoch). In **`waiting`** it cannot:
        it holds no token to the inviter (the open token was spent on
        `hs.init`) and no epoch. Nothing is lost: the inviter shows a
        request only after `hs.fin`, which the accepter never sends, so
        the inviter's member was never shown it; a later `hs.resp` finds
        no handshake and is dropped, and the inviter drops its `hs.init`
        unseen at the 7-day expiry (below).
      - A **block** of a pending request (`block.add{pending_id}`,
        §10.4) is a decline and sends `connection.declined` the same
        way; the peer cannot tell a block from a decline.
      - Nothing is sent for the other ends of a request: expiry, an
        aborted handshake (§6.3), the inviter's drop (below), or the
        member's removal of an active connection (that is
        `connection.removed`, §7.4).
    - **The receiving vault** checks `ts` as for `connection.approved`,
      then ends the request as a drop (below, §7.4): it denylists every
      token it issued to the peer (the request token and, if its member
      approved, the standing and reconnect tokens of its
      `connection.approved`), deletes the tokens held for the peer and
      the handshake state, and the request no longer counts toward the
      256 requests of its kind (§10.4). The invitation stays spent
      (single use); on the accepter's side `exists` no longer refers to
      it, so a new invitation from the same member can be accepted. It
      tells its apps and desktops with `sync.event{kind:
      "connection.request", pending_id | connection_id, state:
      "peer_declined"}`, and on the accepter's side also
      `connection.event{connection_id, event: "failed", reason:
      "declined"}` (an outgoing request that ended other than by its
      member's decline, below), and audits it and creates a feed item
      (`connection.request.peer_declined`, §10.9).
    - **Apps** tell the member whose request was declined, once per
      request, on the `sync.event` (not again on the `failed` that
      accompanies it): the accepter sees "<name> declined your
      connection request", the inviter "<name> declined the
      connection", with the name the request showed (`name` of the
      outgoing request, the profile's name of the incoming one, both
      self-asserted). An app keeps that name from
      `connection.request.list` or the request event, since the request
      has left the list by then.
    - **Late, duplicate and crossing declines.** A `connection.declined`
      that finds no request (a redelivery, one that crossed the
      member's own decline, or one after expiry) has no epoch to open
      it, and its token is denylisted at the relay; whatever still
      arrives is dropped and audited like any message without a
      session. If both members decline, each sees only their own
      decline.
    - **After activation.** The decliner's side is never active (a
      decline of an active connection is `not_found`; that is
      `connection.remove`), but the receiver may be: if the decliner had
      approved, the receiver's approval completes the connection on the
      receiver's side while the decline is in flight. A
      `connection.declined` that arrives, under the session that the
      handshake's epoch began, once the connection is active is handled
      as `connection.removed` from that peer (§7.4 "Connection removed",
      without a notice back; devices get `connection.event{removed}`)
      and audited `connection.request.peer_declined` with `ref` = the
      `connection_id` (0.10.6; the request's `pending_id` no longer
      names anything once the connection is active): the decliner has
      already denylisted every token it issued, so the connection could
      only turn `stale`.
    - **Not forgeable.** Like `connection.approved`, it is sealed under
      the handshake's epoch, whose keys only the two parties to that
      handshake hold, and deposited on a sender-bound request token
      (RELAY-PROTOCOL §5). The relay, VettID and any third party can
      neither forge nor replay one into another request. The party at
      the other end of the handshake can of course decline its own
      request; a party in the middle of a substituted remote link
      (§6.3) is that party for each half and could already end both by
      staying silent.
- **What an unapproved party holds** (0.10.3). A party that completed
  the handshake but that a member has not approved (anyone who saw a
  remote link) holds a pending request on the other side and a request
  token for at most 8 small deposits, which the vault drops (above) and
  revokes when the request ends. It gets no standing or reconnect token,
  no profile and no epoch the vault will use, and it cannot make the
  codes match except by the 10^-6 chance of §6.3.
- **In-person invites (10 min).** Approval is explicit by default; the owner
  MAY enable auto-approval for in-person invites, which skips the
  inviter's approval only. The accepter always approves. With
  auto-approval the inviting vault approves when `hs.fin` checks out and
  still sends `connection.request.pending` (with `state: "approved"`),
  so that its app shows the code for the accepter to compare.
- **Remote invites.** The resulting connection stays **`pending`** until the
  inviter explicitly approves it in the app.
  - Auto-approval MUST NOT apply.
  - The app shows the invitee's presented `profile`, which is self-asserted
    and labelled as such, and the SAS. The app SHOULD suggest comparing the
    SAS over a channel the inviter trusts, such as a call.
  - The vault does not send `connection.approved`, and the connection
    does not become active, while the request is pending. Anyone who saw
    the link could have accepted it, so approval, after comparing the
    SAS, is the control. (Before 0.10.3 the vault held back `hs.resp`;
    it now sends it at once, as above.)
- **Already connected** (0.10.2). After opening the bundle and before
  making an `hs.init`, the accepting vault MUST answer
  `connection.invite.accept` with `exists` (body `{connection_id}`, its
  own id for that peer) if `vault.ik` or `vault.relay.pk` is that of one
  of its connections that is not `stale`, or of one of its outgoing
  requests. The claim has then been fetched, so the link is spent; the
  inviter's invitation stays outstanding until its `exp` or
  `connection.invite.cancel`. A member whose connection is broken
  removes it and asks for a new invitation.
- **The inviter's drop.** An `hs.init` of purpose `connection` whose
  collect `sender` or `from.ik` is that of an active connection or a
  device of the inviting vault is dropped and audited
  (`drop.hs_init_from_known_peer`); the invitation is not used. A peer
  whose record is `stale` is accepted (§7.4). No answer is sent: the
  accepting vault's own check above, and its expiry below, keep its
  member from waiting.
- **Request expiry and retention.**
  - An **incoming** request (the inviter's) that the owner has neither
    approved nor declined **7 days** after its `hs.init` (the longest
    invite TTL) is dropped, whether or not its `hs.fin` came. Once
    approved, it waits for the peer's `connection.approved` until 16 days
    after its `hs.init` (the accepter's 8 days, with room for a vault
    that was locked) and is then dropped. A declined request is dropped
    at once. Every drop denylists every token the vault issued to the
    peer (§7.4).
  - An **outgoing** request (the accepter's) that is not active **8 days**
    after the accept (the inviter's 7 days and a day for delivery) is
    dropped, with its handshake state, and the vault denylists every
    token it issued to the peer and sends `connection.event{connection_id,
    event: "failed"}`, as for an aborted `hs.resp` (§6.3). The member's
    own decline sends no `failed`; it reaches the other devices as
    `sync.event{kind: "connection.request", state: "declined"}` (0.10.4). A later
    `hs.resp` or `connection.approved` finds no handshake and is
    dropped. The peer's `connection.declined` ends either kind at once
    (0.10.5, above).
  - A handshake aborted on a commitment mismatch (§6.3) drops the
    incoming request, which its devices were never shown, and denylists
    every token issued to the peer.
  - `connection.request.list` (§10.4) returns both kinds until they end,
    with their SAS, so an app can show a request again at any time; the
    ends are announced as `sync.event{kind: "connection.request"}` and
    `connection.event`.
- **Who approves.** Connection requests are approved or declined by an
  owner device of role `app` or `desktop`. Agents MUST NOT create, accept,
  approve or decline invitations.
- **Revocation.** The inviter MAY revoke an outstanding invite at any time
  with `connection.invite.cancel`. The vault denylists the open token's `jti`
  and DELETEs the claim. `connection.invite.list` shows outstanding invites.

### 6.5 Epochs and rekey

**Epoch length:**

| Session | Epoch ends after |
|---|---|
| Vault ↔ vault | **24 h or 10,000 messages** in either direction |
| Vault ↔ device or agent | 7 days, and on every unlock |

Either side MAY rekey sooner. The side that hits the limit initiates. A
new connection's or device's first epoch counts from its activation
(§6.3), not from `hs.fin`; a pending one is never rekeyed (0.10.3). If both
sides initiate at once, the `hs.init` with the lower `th1` wins (compared as
big-endian byte strings).

Reaching the limit does not stop sending: both sides keep sending in the
old epoch until the new epoch activates, so that a locked peer does not
block delivery. The initiator's first messages in the new epoch can reach
the responder before its `hs.fin`; the responder leaves them unacked
until the epoch is established (§6.3, 0.23.0).

**Key retention:**

- Receive keys of previous epochs are kept for 16 days (the relay TTL plus a
  margin).
- Send keys of previous epochs, and their `rk`, are deleted when the new
  epoch activates. A rekey is therefore possible only from the current
  epoch.

**Rationale for epochs rather than a per-message ratchet:**

- The mailbox is unordered and at-least-once, so a ratchet would need
  skipped-key stores that weaken its benefit.
- The vault keeps message history in its state anyway, so per-message keys
  would protect little that a vault compromise does not already expose.

Each rekey uses a fresh ephemeral KEM. That bounds the exposure of a
compromised epoch key and restores security after compromise.

### 6.6 Reconnect tokens

Standing tokens expire after 30 days or less. Each side of a connection
therefore also holds a **reconnect token** for the peer. With it, a
connection can be restored without a new invite after a long lock or other
outage.

**Reconnect token properties:**

| Property | Value |
|---|---|
| Binding | Sender-bound: `sub` = the peer's relay key |
| Lifetime | ≤ 365 days, and ≤ the relay's `max_token_lifetime_seconds` |
| `quota` | `{"msgs": 4, "bytes": 65536}` |
| Delivered in | `connection.approved` (a new connection, 0.10.3), `hs.init` and `hs.resp` of a reconnect, `relay.token.issued` |
| Re-minted | After every successful reconnect and every relay-key rotation, and when less than 60 days remain |

**Permitted use.** A reconnect token MAY only be used to deposit an `hs.init`
with `purpose: reconnect`. The receiving vault records the `jti` of every
token it issues, with its kind, and decides the token class of each
collected message by the collect `jti` (RELAY-PROTOCOL 0.4.0 §6.3):

- A message from a connection whose collect `jti` is that of a reconnect
  token MUST be dropped and audited unless it is a sealed `hs.init` with
  purpose `reconnect`.
- A message from a connection that carries **no** `jti` (stored by a
  pre-0.4 relay) MUST be treated as a reconnect-token deposit.

**When to use it.** A vault uses its reconnect token automatically when it
is unlocked and either:

- a deposit to the peer fails with `token_expired`; or
- on unlock (§12.2), its standing token for the peer has already expired.

**Initiating.** The reconnect `hs.init` is sealed to the last known `ek` of
the peer. It carries:

- fresh standing and reconnect tokens;
- `ctx` = the stored `epoch_id` of the last epoch;
- `rotations`: the initiator's rotation statements since the last epoch.

**Authentication.** No SAS or approval is needed when the identities match.
The responder MUST accept the reconnect only if all of these hold:

- the collect `sender` equals the relay key on record for that connection,
  which is also the reconnect token's `sub`;
- `from.ik` equals the stored `ik`, or is reached from it through a valid
  `rotations` chain;
- `sig_I` verifies under that key.

Each link in a rotation chain is an `identity.rotate` statement (§3.4). When
`rotations` is non-empty, `from.kem` MUST equal the chain's final
`new_kem`. The responder answers with its own `rotations`, and the
initiator verifies `sig_R` the same way.

**Retired keys.** Vaults keep retired static `kem` private keys for 400 days
so that they can still open reconnect `hs.init`s sealed to an older key.

**Limits:**

- Messages older than the relay TTL are lost regardless. After a reconnect,
  the vaults exchange `sync.since` (schemas TBD) to resync shared state.
- A peer that rotated its *relay* key while the connection was unreachable
  has its old mailbox deleted after the rotation grace period. The reconnect
  then fails with `mailbox_unknown`, and the connection becomes `stale`. A new
  invite is required. Vaults SHOULD defer relay-key rotation, except after a
  suspected compromise, while any connection's standing token is expired.

### 6.7 Owner device and agent pairing

**One app per vault** (owner decision, 2026-10-03). A vault has exactly
one device of role `app`, the holder of the Protean Credential (§3.5.9).
An app is bound only:

- at enrollment (§11.3), the first and only app;
- by a direct transfer, which replaces it (§6.7.1);
- by a recovery, which replaces it (§11.11.5).

No second app pairs: `device.pair.create{role: "app"}` is answered
`one_app`; the app cannot be unlinked (`device.unlink` of the app is
answered `forbidden`: it leaves only by a transfer or a recovery); and an `hs.init` of purpose `app` that is not one of these
three handshakes is dropped and audited (`drop.one_app`). Desktops and
agents pair from the app as below; they never hold the credential. The QR
(TTL 10 min) is shown on the app; the new device scans it, or the code is
pasted.

```
Paired app            Vault                Relay              New device/agent
  |--device.pair.create{role}-->|              |                     |
  |             PUT claim (kind=p|d|a) ------->|                     |
  |<--QR / code-----------------|              |<--register MB(dev)--|
  |                             |              |<--GET claim---------|
  |                             |<--collect----|<--hs.init{sas_commit} (open)
  |                             |--hs.resp{n_R}->|------------------>|  (at once)
  |                             |<-------------|<--hs.fin{n_I}-------|  shows SAS
  |<--device.pair.pending{name,role,sas}       |                     |
  |   user compares SAS         |              |                     |
  |--device.pair.approve{grants}-->|  epoch active, device record    |
  |                             |--device.paired{role,grants,token}->|
```

Rules:

- **Handshake, then approval** (0.10.3). The vault answers a valid
  `hs.init` for a live pairing with `hs.resp` at once (for an app, after
  the attestation check of §6.7.1); `hs.resp` carries a request token
  (§7.1). The new device sends `hs.fin` at once and shows the SAS. Once
  `hs.fin` checks out (§6.3), the vault sends `device.pair.pending` with
  the SAS. The vault MUST NOT activate the epoch, create the device
  record or give the device anything but the handshake before the
  owner's approval; before it, every other message from the device is
  acked, dropped and audited (`drop.unapproved_peer`). At the approval
  the epoch becomes active and the vault sends `device.paired`, which
  carries the device's standing token. If the owner rejects, or
  10 minutes pass after its `hs.init` without approval (0.10.4), the
  vault drops the pairing and its handshake state and denylists the open
  token's and the request token's `jti`. The new device shows only the
  code; its user compares it on the app, and it waits for `device.paired`
  or (0.10.5) `device.pair.rejected` until 10 minutes after its
  `hs.init`.
- **The rejection is sent** (0.10.5; owner decision of 2026-10-05,
  "include `device.pair.rejected`"). The new device is the member's own,
  in their hand, so there is nothing to hide, and without it the device
  waits out its 10 minutes.
  - On the owner's `device.pair.reject` (or `device.transfer.reject`,
    §6.7.1), the vault sends the new device `device.pair.rejected{}`
    (V→D, session mode under the handshake's epoch, deposited on the
    standing token the **new device** issued in its `hs.init`: the
    channel `device.paired` uses, §7.1), then drops the pairing as
    above. One flush (§7.4): the message is sealed and its deposit queued
    first, while the epoch still exists (the epoch is never activated, so
    it is sealed with the handshake's epoch directly, not the device's
    session); the queued deposit keeps its own copy of the device's
    token; and the tokens the vault denylists (the open token and the
    request token) are those **it** issued, which the device would
    deposit with, not the one it deposits with. Best effort, retried as
    any deposit (§8.6) until the pairing's 10 minutes end.
  - **One type for pairing and transfer.** A transfer is a pairing of
    role `app` (QR `t: "p"`, §6.4) and ends in the same `device.paired`
    (with `transfer: true`); the new device knows which it started, so
    `device.pair.rejected` serves both and needs no
    `device.transfer.rejected`.
  - **When it can be sent.** Only once `hs.fin` has checked out: then
    the vault holds the epoch (§6.3) and the owner has seen the SAS
    (`device.pair.pending`, `device.transfer.pending`). A rejection
    before that (no scan yet, or a handshake still awaiting its
    `hs.fin`) sends nothing: before the scan there is no device, and
    without `hs.fin` the vault has no epoch; that device waits out its
    10 minutes, as before. Only the owner's rejection is sent: an expiry
    (the device's own 10 minutes end too), a commitment mismatch
    (`failed`, §6.3), and a transfer aborted by a clone alarm (`alarm`)
    or a recovery (`replaced`) send nothing, so an unapproved device
    learns nothing of the vault's state.
  - **The new device** accepts, under the handshake's epoch from its
    vault's relay key, `device.paired` and `device.pair.rejected`. On
    `device.pair.rejected` it stops waiting, drops its handshake state
    and the request token it holds, and tells its user: an app or
    desktop shows "Rejected on your phone"; an agent ends its pairing
    with that error. It sends nothing back (its request token is
    denylisted).
  - **Late and duplicate.** The vault sends it once per pairing; an
    approval completes the pairing at once (§6.7.1), so a vault never
    sends both `device.paired` and `device.pair.rejected`. A redelivery,
    or one arriving after the device's 10 minutes, finds no handshake
    state and is dropped.
  - **Not forgeable.** It is sealed under the handshake's epoch, whose
    keys only the vault and the new device hold (the device authenticated
    the vault by the bundle's `ik`, §6.3), and deposited on the device's
    sender-bound token (RELAY-PROTOCOL §5); the relay, VettID and any
    third party can neither forge it nor end a pairing with it.
- **Who pairs.** Only an owner device of role `app` creates
  (`device.pair.create`), approves or rejects pairings. Desktops and agents
  cannot.
- **Agents.** The approval MAY carry the agent's initial LEASH grants
  (`device.pair.approve{grants}`, §10.3, §10.11). The member's credential
  key signs them at the approval, so the app opens the unlock window
  first; they take effect in the flush that completes the pairing, and
  the agent learns them in `leash.grant.updated`. The agent's `ik` is the
  grantee.
- **Apps.** An app pairs only by a direct transfer (§6.7.1). Its
  `hs.init` carries the device attestation in `device_attest` (§11.7),
  over the §11.7 challenge with the `hs.init` inner `id` as `request_id`,
  an empty `vault_id` (the new device does not know it yet) and the
  `hs.init` inner `ts`. The vault drops (and audits) an app's `hs.init`
  without a valid attestation.
  In the same flush as the device record, the vault adds the app's `ik`,
  `kem` and attestation binding to the sealed header's unlock keys, and
  removes the old app's.
- **Re-pairing.** A re-paired device MUST use a new relay key, because its
  old `sub` stays denylisted. The vault MUST refuse an `hs.init` whose
  collect `sender` is a relay key it has denylisted as a whole (an unlinked
  device, §7.4), whatever token it arrived on. Removed connections are
  denylisted by `jti` instead and may connect again (§7.4).

#### 6.7.1 Direct transfer to a new phone

A member who still holds the old phone moves the app, and with it the
credential, to a new phone without the 24 h wait of a recovery (owner
decision, 2026-10-03). The old app's session, the PIN and the credential
password are the proof. The QR is the pairing QR with `t: "p"` and bundle
`kind: "app"` (§6.4), TTL 10 minutes; nothing else uses it.

```
Old app (holder)           Vault                  Relay             New app
  |--device.transfer.create-->|                     |                   |
  |<--{transfer_id, link, exp}|--PUT claim (p)----->|                   |
  |   shows QR                |                     |<--GET claim-------|
  |                           |<--collect-----------|<--hs.init (app,   |
  |                           |  device_attest ok   |   device_attest,  |
  |                           |                     |   sas_commit)     |
  |                           |--hs.resp{n_R}------>|------------------>|  (at once)
  |                           |<--------------------|<--hs.fin{n_I}-----|  shows SAS
  |<--device.transfer.pending{name, sas}            |                   |
  |   compare SAS; PIN + password                   |                   |
  |--device.transfer.approve{credential, utk_id, sealed{password, pin}}->|
  |                           |  PIN; open; CEK rotates (v+1, kept);    |
  |                           |  one flush: new app record + unlock key,|
  |                           |  holder := new app, old app removed     |
  |<--{}----------------------|                     |                   |
  |<--device.unlinked{transferred} (best effort)    |                   |
  |                           |--device.paired{transfer, credential_version, user_guid, token}->|
  |                           |<--credential.get, credential.ack, credential.utk.get--|
```

1. The holder sends `device.transfer.create`. It is refused with
   `credential_frozen` or `rotation_required` during a clone alarm
   (§3.5.9), `exists` while another transfer is open (one at a time),
   and `owner_check_required` while the vault is held (§3.6.3).
   The vault creates the invitation and answers `{transfer_id, link,
   exp}`; audit `device.transfer.started`.
2. The new app scans the QR and sends `hs.init` (purpose `app`) with
   `device_attest`, which is REQUIRED (§11.7), and its app key `api_key`
   (0.15.0, §6.2, §11.12). An invalid attestation drops
   the `hs.init` (audit `device.transfer.attestation_failed`); the holder
   sees no pending transfer. Otherwise the vault answers with `hs.resp`
   at once (0.10.3, as for any pairing, §6.7), the new app answers with
   `hs.fin` and shows the SAS, and once `hs.fin` checks out (§6.3) the
   vault sends the holder `device.transfer.pending{transfer_id, name,
   sas}`.
   A dropped `hs.init` (a spent or expired link, a failed attestation)
   is never answered, so the new app cannot tell it from a slow vault.
   It SHOULD stop waiting for `hs.resp` after **60 seconds** and tell its
   user that the code may already have been used or that this phone
   could not be verified, and offer to scan a new code (0.10.6).
3. The holder compares the SAS and sends `device.transfer.approve` with
   its current blob and, sealed to a UTK (§3.5.4), the `password` and the
   `pin`. The vault:
   - spends the UTK;
   - checks the PIN against the vault's DEK derivation (§3.3.1): `bad_pin`
     on a mismatch, counted in the unlock backoff of §11.8 (and audited
     `vault.pin_failed`), and `backoff` while that backoff runs;
   - opens the credential with the password (§3.5.3: `bad_password`,
     `backoff`, and the clone rule of §3.5.9);
   - **rotates the CEK** (version + 1). Nobody receives the new blob yet:
     the vault keeps it as the latest blob, unconfirmed, whatever
     `credential.backup` says (§3.5.3). The old app's copy is dead;
   - audits `device.transfer.approved` and, since the new app's
     handshake is already complete (0.10.3), completes the transfer in
     the same flush (step 4) and answers `{}`.
4. The approval completes the transfer in **one flush**: the epoch
   becomes active; the new device record (role `app`, attestation
   binding, unlock key); the holder becomes the new app; the old app is
   **removed** as by `device.unlink` (§7.4: `device.unlinked{reason:
   "transferred"}` best effort after the response, relay key denylisted,
   unlock key and UTK pool removed). The new app receives
   `device.paired{…, transfer: true, credential_version, user_guid,
   token}` (`user_guid` since 0.17.0, below); the
   new app's `api_key` becomes the vault's app key and the vault reports
   it to the host (`app_key`, §11.5; 0.15.0), so the old phone's key is
   refused by the member API from then on; the
   vault audits `device.transferred` (`device_id` = the new app, `ref` =
   `transfer_id`), creates the feed item `device.transferred` and sends
   desktops `sync.event{kind: "device.transferred", device_id,
   old_device_id}`. As before 0.10.3, the old app is removed only once
   the new app has completed the handshake; there is no longer an
   approved-but-unfinished state. The approval verified the PIN and the
   password together, so it is an owner check (§3.6.1): it starts the
   new app's clock, and ends a hold.
5. The new app fetches the blob with `credential.get`, confirms it with
   `credential.ack` and fills its UTK pool with `credential.utk.get`.
   It unlocks later with the PIN, like any app (§11.4).

**The member's `user_guid`** (0.17.0, owner decision of 2026-10-06,
§15 item 25). An unlock names the member's `user_guid` and signs it
(§11.4). An enrolled app learns it from the setup code's redeem
(§11.12.1), a recovering app from the claim (§11.11.7). A transferred app
has neither, so the vault gives it: a transfer's `device.paired` carries
`user_guid`, copied from the vault's sealed header (§3.3), and only a
transfer's (`transfer: true`). It is sealed under the handshake's epoch
to the new app alone, like the rest of `device.paired` (§6.7); the relay,
the member API and other devices learn nothing new. The old app sends
nothing for it, so a transfer from an old app of any version gives the
new app its `user_guid`.

- The new app MUST check that it is a string of 1 to 128 printable
  ASCII characters (0x21–0x7E), so that it fits §11.4's signing string,
  and stores it with `vault_id` exactly as an enrolled app stores the
  redeem's: it is the `user_guid` of every later `vault.unlock` (§11.4),
  kept until the app is erased. A value that fails the check is treated
  as absent (below).
- A transfer's `device.paired` without a valid `user_guid` comes only
  from a vault release before 0.17.0 (none is in production). The
  transfer is complete when it arrives (the old app is already removed,
  step 4), so the new app does not refuse it: it keeps the vault and
  tells the member that this phone cannot unlock the vault after it
  locks until the vault runs a release of 0.17.0 or later, which always
  sends it.

**Failures and aborts.** An aborted transfer is audited
`device.transfer.aborted` (`ref` = `transfer_id`) and announced as
`sync.event{kind: "device.transfer", transfer_id, state: "aborted",
reason}` (`reason`: `rejected`, `expired`, `alarm`, `replaced` or
`failed`); the pairing's `jti` and the request token's are denylisted,
and the new app's handshake state is dropped. A commitment mismatch at
`hs.fin` (§6.3) aborts it with `failed`.

| Case | What happens |
|---|---|
| The holder rejects (`device.transfer.reject`), before or after the scan | Aborted. Nothing else changes. After the new app's `hs.fin` the vault tells it with `device.pair.rejected` (0.10.5, §6.7); before that the new app times out. (Since 0.10.3 an approval completes the transfer, so there is nothing to reject after it.) |
| No scan before the link's `exp` (10 minutes after `device.transfer.create`), or no approval within 10 minutes after the new app's `hs.init` (0.10.4) | Aborted. Nothing else changes. |
| The new app's attestation fails | Its `hs.init` is dropped; the transfer stays open until its 10 minutes run out. The new app stops waiting for `hs.resp` after 60 seconds (step 2, 0.10.6). |
| Wrong PIN or password at approval | `bad_pin` / `bad_password`, counted in their backoffs and as a failed owner check (§3.6.4). The transfer stays pending until its 10 minutes run out; the member may retry. |
| The vault becomes held (§3.6.3) while a transfer is open | The transfer stays open: the holder may still approve it (a check in itself) or reject it. A new `device.transfer.create` waits for a check. |
| The new app goes offline before its `hs.fin` | No SAS is shown; the transfer times out after 10 minutes; nothing changes. |
| The new app goes offline after its `hs.fin` | The approval still completes the transfer. `device.paired` waits in the new app's mailbox (relay TTL); if the new app never returns, the member recovers (§11.11), as when a new app is lost after a transfer. |
| The old app goes offline before approving | The transfer times out; nothing changes. |
| The old app goes offline after approving | Nothing is needed from it: the approval completed the transfer. The old app learns of its removal from `device.unlinked` (best effort), and then erases its local state (owner decision, 2026-10-05). A refused relay key alone is not proof of removal: the app offers the member an erase instead of erasing by itself. The refused relay key is a `403 token_revoked` (RELAY-PROTOCOL §5.3 step 6, §7.1) on a deposit to the device's own vault mailbox: the vault has put the device's relay key on its denylist as a `sub` (§7.4). The same holds for the old app of a recovery (§11.11.5). What the device does on that answer: §8.6. |
| A clone alarm opens (§3.5.9) | An open transfer is aborted. |
| The vault locks | The transfer and its pending handshake are kept in vault state; its 10 minutes still run and are checked at the next unlock, which aborts an expired one. |
| A recovery completes (§11.11.5) | An open transfer is aborted (`replaced`). |

OWNER DECISION (recommended: as specified): the transfer does not
re-check the old app's device attestation; its session, the PIN and the
password prove it.

### 6.8 Access sessions and approvals for desktops and agents

Pairing (§6.7) gives a desktop or an agent an E2E session with the vault.
It does not, by itself, let the device act. A desktop or agent acts only
within an **access session**: a time-limited authorization that an owner
app grants. (An access session is unrelated to the E2E session of §6.1;
its end does not end the E2E session or the pairing.) Apps need none.

**Requesting and granting:**

1. The desktop or agent sends `device.session.request{seconds?}` (60 s to
   24 h, default 1 h).
2. The vault asks the owner's apps with `device.session.pending`. A newer
   request from the same device replaces an older one; a request no app
   decides within 10 minutes is dropped.
3. An app answers `device.session.approve{request_id, seconds?}` (the app
   may change the length) or `device.session.deny`. The device is told
   with `device.session.granted{session_id, expires_at}` or
   `device.session.ended{reason: "denied"}`.

`device.pair.approve` MAY carry `session_seconds` to grant the first access
session together with the pairing (§10.3). A grant replaces the device's
current access session, so a request made within a session renews it.

**What a desktop or agent may do:**

- Without an access session, the vault answers every request of a type
  the device's role may send with `session_required` (other types remain
  `forbidden`) and drops every other message (audited), except
  `vault.status`, `device.session.request`, `device.session.end`,
  `relay.token.issued`, `relay.token.refresh`, `relay.address.update` and
  the handshake. Feature messages the vault addresses to one device (such
  as a call's answer) also reach a desktop or agent only within its
  session; responses and the messages of this section always do.
- Within it, a **desktop** may send the types listed for it in §10. Some
  of them are **step-up types**: the vault holds each such request until
  an app approves it (below). They are the types that reveal a secret
  item's values, change items, tags that sharing may depend on, the
  profile or the settings, create or accept an invitation, remove a
  connection or lift a block, or disclose data to a connection or change
  what connections can obtain: `item.put`, `item.reveal`, `item.tag`,
  `item.sensitivity`, `item.delete`, `tag.delete`, `tag.merge`,
  `profile.set`, `settings.set`, `share.rule.set`, `share.decide`,
  `connection.invite.create`, `connection.invite.accept`,
  `connection.remove`, `block.remove`, `grant.decide`,
  `action.configure`, `intro.create`, `intro.accept`,
  `location.share.start`, `location.history.list`, `.delete` and
  `.share`, and `presence.set`. Apps are never held. (Types that use the credential,
  such as `critical-secret-use.approve`, signed `leash.grant.issue`,
  `wallet.create` and `wallet.sign`, are app-only. A step-up type's app-only form, such as a critical
  item's `item.put` or an agent's `share.rule.set`, is answered
  `forbidden` to a desktop at once, never held, §10.7, §10.12.)
- An **agent** may send only the types listed for agents in §10, unless
  its LEASH grants (§10.11) allow more. For an agent's `agent.request`,
  and for its request of a type that a desktop may send but agents are
  not listed for, the vault asks its LEASH policy whether to **allow**
  it, **refer** it to an app (held like a step-up request, below) or
  **refuse** it (`forbidden`). Without a grant that covers it, a request
  is refused. Types only apps may send are never delegated. A referred
  request is executed on approval only if a grant still covers it then
  (otherwise `forbidden`): revoking a grant also stops what it had
  referred.
- Fan-out reaches a desktop only within its access session (§9.1).

**Approvals.** A held request is kept for at most 5 minutes, at most 8 per
device (`limit` beyond that):

1. The vault sends the owner's apps `approval.pending{approval_id,
   device_id, role, name, type, body, exp}` and the requester
   `approval.waiting{approval_id, request_id, exp}`; a requester that
   receives it waits up to `exp` for the response instead of the usual
   30 s (§8.1).
2. An app answers `approval.decide{approval_id, approve}`. On approval the
   vault executes the request then, as the requester's (its access
   session must still be valid), and answers the requester as usual; on
   denial it answers `denied`; at expiry `approval_timeout`.
3. The held request keeps its inner `id`: a retransmission while it is
   held is absorbed by the dedupe of §8.2, and once answered gets the
   cached response.

**Ending.** An app ends a device's access session with
`device.session.end{device_id}`; a desktop or agent ends its own with
`device.session.end{}`. Held requests of the device are answered
`denied`, its pending request is dropped, and the device is told
`device.session.ended{reason: "ended"}` when an app ended it. Unlinking
(§7.4) ends everything of the device. Access sessions also simply expire;
the device knows `expires_at`.

Every grant, end and decision is audited (§10.9), and the owner's other
devices learn of it as `sync.event` (§10.1).

**While the vault is held** (§3.6.3), access sessions are suspended: a
desktop or agent may send only `vault.status`, `device.session.end{}`
and the transport types (a desktop also `vault.lock`, and `call.end` and
`call.ice` of a call it answered before the deadline); everything else is answered
`owner_check_required`. Held requests were answered
`owner_check_required` when the hold began, and no app may grant a
session or decide an approval until a check ends the hold. A session's
expiry keeps running, and an unexpired session resumes after the check.

## 7. Deposit tokens

### 7.1 Issuance

Tokens are PASETO v4.public, signed by the **recipient's** relay key
(RELAY-PROTOCOL §5). `iat` SHOULD be backdated by up to 60 s
(RELAY-PROTOCOL §5.2), and every lifetime below is measured from the
backdated `iat`. Every lifetime is also capped by the relay's advertised
policy (§1.2).

| Mailbox | `sub` | Kind | `exp − iat` | Default `quota` | Delivered in |
|---|---|---|---|---|---|
| Vault | each owner device | standing | ≤ 30 d | none | `device.paired` (0.10.3), `hs.resp` of a handshake answered without approval (§11.3, §11.11.5), `relay.token.issued`, unlock result |
| Vault | each peer vault | standing | ≤ 30 d | 20,000 msgs / 512 MiB | `connection.approved` (0.10.3), reconnect handshake, `relay.token.issued` |
| Vault | each peer vault | **reconnect** (§6.6) | ≤ 365 d | 4 msgs / 64 KiB | `connection.approved` (0.10.3), reconnect handshake, `relay.token.issued` |
| Vault | a requesting peer vault or new device | **request** (0.10.3) | ≤ 16 d (a device: ≤ 10 min) | 8 msgs / 64 KiB | `hs.init` (the accepter's), `hs.resp` of a handshake that needs approval |
| Vault | invitee | open | = invite TTL (10 min default, up to 7 d) | one deposit | claim bundle |
| Vault | new device | open | ≤ 10 min | one deposit | claim bundle |
| Device | its vault | standing | ≤ 30 d | none | `hs.init`, `relay.token.issued`, unlock request |
| Device (app) | the vault being enrolled | open | ≤ 10 min | one deposit | enrollment request, inside the ciphertext |
| Peer vault | this vault | request, then standing and reconnect | as above | peer's choice | handshake, `connection.approved`, `relay.token.issued` |

Devices never hold tokens for peers, and peers never hold tokens for devices.

**Request tokens** (0.10.3) cover only the rest of a handshake that
awaits approval (§6.4, §6.7): a holder may deposit `hs.resp`, `hs.fin`,
`connection.approved` and (0.10.5) `connection.declined` with it, and the
receiving vault, which records each token's kind by `jti` (§6.6), acks,
drops and audits anything else that arrives on one. A
`connection.declined` on a request token is processed also once the
connection is active, under its session (§6.4 "After activation"); the
token is denylisted then. A pairing's `device.pair.rejected` (0.10.5)
goes the other way, on the token the new device issued in its
`hs.init`, as `device.paired` does (§6.7). A request token is not refreshed: its
`relay.token.refresh` is answered `forbidden` once the connection or
device is active; before that it is handled as any other message before
activation (§6.4, §6.7; 0.10.4). It is replaced by the
standing token in `connection.approved` or `device.paired`, and
denylisted when the request or pairing ends without one (§7.4).

### 7.2 Refresh

**Standing tokens:**

- An issuer SHOULD send `relay.token.issued` when an outstanding standing
  token has less than 10 days left.
- A holder MAY send `relay.token.refresh` when its token has less than
  3 days left, or after `token_expired`.

**On unlock**, the vault first:

1. re-mints every standing token it issued that has less than 10 days left;
2. re-mints every reconnect token it issued that has less than 60 days left;
3. starts a reconnect (§6.6) for each connection whose standing token it
   holds has already expired.

**Unlock exchange.** Unlock requests carry a fresh app token, and unlock
results carry a fresh vault token (§11.4). An app that has been offline for a
long time therefore recovers without going through the relay.

### 7.3 Quotas

The relay enforces each token's `quota` and its own per-sender limits. On
top of that, the vault limits each peer to:

- 60 durable messages per minute;
- 1 `presence.ping` answered per minute (§10.17).

Excess messages are acked, dropped and audited.

### 7.4 Revocation

The actions for each event are applied in one flush, in the order listed:

| Event | Actions |
|---|---|
| Connection removed | Send `connection.removed` (best effort). Denylist the `jti` of every token the vault issued to the peer (standing and reconnect, including those minted in handshakes still in flight), so that none of them is accepted again. Delete the tokens held for the peer, its session keys and its outbox entries. |
| Peer blocked | As for connection removed, plus a block entry on the peer's `ik` and relay key (§10.4) |
| Device unlinked | End its access session and drop its held and pending requests (§6.8). Send `device.unlinked` (best effort). Denylist `sub`. Remove the device from the unlock keys. Delete its wake reference. |
| Agent revoked | As for device unlinked, plus revoke all of the agent's LEASH grants |
| Invite or pairing cancelled or expired | Denylist the open token's `jti`. DELETE the claim. |
| Connection request or pairing ended without activation (declined, rejected, expired, aborted; 0.10.3) | If the vault's member declined (or blocked) a connection request whose handshake has given it the epoch and the peer's request token, send `connection.declined` first (0.10.5, §6.4), sealed under the epoch and queued on that token; the queued deposit keeps its own copy of the token, so deleting the held tokens below does not cancel it, and the tokens denylisted below are the vault's own, not the one it deposits with. Likewise, if the owner rejected a pairing or transfer after its `hs.fin`, send `device.pair.rejected` first, on the new device's token (0.10.5, §6.7). Denylist the `jti` of every token the vault issued to the peer in the request: the request token and, if its member approved, the standing and reconnect tokens of its `connection.approved` (0.10.4). Delete the tokens held for the peer and the handshake state. |

The relay retains denylist entries for its maximum token lifetime
(RELAY-PROTOCOL §5.5). This is why reconnect tokens raise denylist retention
at the relay.

**Connecting again after a removal.** A removed connection's tokens are
denylisted by `jti`, not by `sub`, so its relay key itself is not refused:

- The removed peer cannot deposit with any token it held: each is
  denylisted at the relay, and messages that still arrive find no session
  and are dropped and audited.
- A fresh connection with the same peer (the same relay key) is made only
  through the normal flow: a new invitation from one owner and, on the
  inviter's side, the usual pending request and approval (§6.4). The
  removed peer gets no shortcut: reconnect tokens are denylisted, and an
  `hs.init` with purpose `reconnect` from a peer without a record is
  dropped.
- A blocked peer is refused by its block entry (§10.4) until the owner
  lifts it with `block.remove`; then the same applies.
- When the new connection activates, the vault deletes any older record of
  the same peer (same `ik` or relay key), such as a `stale` one left
  after the peer removed it or after refused deposits, without a notice;
  owner devices get `connection.event{removed}` for the old id. An
  `hs.init` of purpose `connection` from a peer whose record is `stale`
  is accepted as a new connection request for that reason.

## 8. Delivery semantics

The relay delivers at least once, in per-mailbox arrival order, with a 60 s
lease and a 14-day TTL (the defaults).

### 8.1 Requests and responses

- Types marked **req** in §10 expect a response. The response:
  - has the same `type`;
  - sets `re` to the request's `id`;
  - carries a `status`;
  - is deposited into the requester's mailbox.
- A response whose `re` matches no pending request is acked and dropped.
- Interactive requests SHOULD time out after 30 s, unless the type defines
  its own timeout.

### 8.2 Dedupe and idempotency

Both of the following layers are REQUIRED:

1. **Relay `msg_id`.** Seen ids are kept for 16 days.
2. **Inner `id`, per principal.** These are kept for 16 days in vault state.
   This layer catches sender retransmissions, which the relay stores under
   different `msg_id`s. Responses are cached for 24 h, so a duplicate request
   gets the cached response again and is not re-executed.

**Exception: responses that carry secret values in the clear.** A type
may mark its responses volatile: they are never cached and never written to
vault state, so they are not in the outbox either. They are deposited from memory after the
batch's flush, behind any queued deposits to the same mailbox, and are
lost if that deposit fails or the vault stops first. A retransmission of
such a request is therefore executed again. This is allowed only for types
whose only side effects are audit and feed entries. No type of this
document needs it today: `item.reveal` of a critical item seals the
values to a one-time reply key instead (§3.5.4), so its response is
cached normally.

Both stores are flushed with the state changes before the ack (§8.3).

### 8.3 Ack after durable persist

For durable types, the vault processes each batch as follows:

1. Collect a batch of up to 32 messages.
2. For each message, in order:
   - dedupe;
   - decrypt;
   - authorize;
   - apply to the in-memory state;
   - record the inner `id`;
   - append any outbound messages to the **outbox**.
3. Increment `state_seq` and **flush** vault state with a conditional write
   (§12.3). The sealed header is then updated to the same `state_seq`
   (§13.2).
4. **Ack** each `msg_id`.
5. Deposit the outbox entries. An entry is removed in a later flush, once the
   relay has answered it with `201`.

If the vault crashes:

| Crash point | Recovery |
|---|---|
| Before step 3 | The batch is redelivered and re-applied cleanly. |
| Between steps 3 and 4 | The batch is redelivered and hits the inner-`id` dedupe. |
| During step 5 | The entries are re-deposited with the same inner `id`, and the recipient dedupes them. |

Flushes SHOULD be coalesced over a window of about 100 ms. Devices apply the
same rule to their local storage.

### 8.4 Ordering

- No global or causal order is provided. `seq` reveals gaps and orders one
  sender's messages for display.
- Handlers MUST tolerate reordering. State that can be edited from several
  devices carries explicit versions, defined per feature schema.
- Receivers MUST reject `ts` more than 5 minutes in the future. For durable
  types, they MUST also reject `ts` more than 16 days in the past.

### 8.5 Durability classes

| Class | Types | Ack | Dedupe | Staleness |
|---|---|---|---|---|
| durable | everything not listed below | after flush | persisted | `ts` window |
| ephemeral | `call.ice`, `call.ringing`, `location.update`, `presence.ping`, `presence.pong`, `presence.result`, `vault.locking` | after handling | in memory, 10 min | `exp` required |

A vault forwards ephemeral messages from memory: they are deposited after
the batch's flush, behind any queued deposits to the same mailbox, once
and best effort, and never written to vault state (they are lost if the
deposit fails or the vault stops first).

### 8.6 Retries

**Transport retries** follow RELAY-PROTOCOL §7.2:

- full jitter, starting at 0.25 s × 2ⁿ and capped at 30 s;
- every attempt is re-signed;
- `retry_after` is honoured.

**Application retries** reuse the inner `id`, at most twice.

How each error is handled:

| Error | Handling |
|---|---|
| `token_expired` | Refresh the token, or reconnect (§6.6). |
| `token_revoked` | Terminal. Stop sending to that mailbox. |
| `token_used` | The open token is already spent. Restart first contact. |
| `mailbox_unknown` | Re-resolve the address, or mark the connection `stale`. |

**An owner device refused by its own vault.** When a deposit by an owner
device to its own vault's mailbox answers `token_revoked`, the device
stops sending to that mailbox, as above, and treats the answer as the
refused relay key of §6.7.1: it counts toward offering the member an
erase. It MUST NOT erase its local state on that answer alone: only
`device.unlinked` (or the member's choice in the erase offer) erases it.
It keeps collecting its own mailbox, where a `device.unlinked` may still
be waiting.

**A refused answer does not block the mailbox.** A device SHOULD ack a
vault message (§8.3) once it has processed it, even when the deposit of
its answer is refused (`token_revoked` or another terminal error): it
records the refusal instead of leaving the message unacked. Otherwise the
message is redelivered and its refused answer retried on every collect,
and the messages queued behind it, such as a `device.unlinked`, are never
read. (Seen on staging 2026-10-06: a replaced phone never reached its
queued `device.unlinked{replaced}`; fixed by vettid-android #66.)

## 9. Fan-out, presence and broadcasts

### 9.1 Owner devices

- The vault makes **one deposit per owner device**, each under that device's
  session. It filters by role: apps receive fan-out; desktops only within
  their access session (§6.8); agents none. An agent receives only
  responses, the messages of §6.8 and its own `leash.grant.updated`
  (§10.11), within its access session.
- A response goes only to the device that sent the request. Side effects
  reach the owner's other devices as `sync.event`, or as feature events.
- A device that has not collected for longer than the relay TTL resyncs
  with `sync.since`.
- While the vault is held (§3.6.3), fan-out stops except for
  `vault.held`, `vault.locking`, the clone alarm and the transfer,
  unlink and transport messages listed there; devices catch up after
  the check.

### 9.2 Presence ping

The relay has no presence, and heartbeats sent into mailboxes that expire
would be wasteful. Presence is on demand instead (§10.17):

1. The app sends `presence.query{connection_id}` to its vault, which
   answers `{ping_id, exp}`.
2. The vault sends `presence.ping{ping_id}` to the peer vault. The ping is
   ephemeral, with `exp` = now + 30 s.
3. The peer vault replies with `presence.pong{ping_id, state,
   last_active?}`, but only if it is unlocked and its owner's policy
   allows it. `last_active` is rounded to 5 minutes. The asking vault
   passes the answer to the asking device as `presence.result`.
4. If no pong arrives before `exp`, presence is `unknown`.

A vault pings each connection, and answers each peer, at most once per
minute. When its policy refuses, it **does not answer** (0.8.0; 0.7.0
answered `unknown`, which told the peer that the vault was unlocked): a
refusal looks like a locked or offline vault.

Silent refusals stay the rule where an answer would tell the asker
something the member keeps from it: presence here, location requests
(§10.16, §10.17), and an introduction, whose `intro.closed` names no
decliner (§10.15). **One exception** (0.10.5): a declined connection
request is sent to the other party as `connection.declined` (§6.4).
Such a request exists only between a member and someone holding an
invitation the member made, or whose invitation the member accepted, so
the decline reveals nothing to a stranger. Other refusals are unchanged.

### 9.3 Broadcasts to connections

Some updates go to every connection, such as `profile.update`,
`identity.rotate` and `relay.address.update`. The vault sends them as **one
deposit per peer**, each under that peer's session. It SHOULD spread the
deposits over a random 0–30 s interval per peer. Because deposits to one
mailbox stay in order (§8.3), a delayed broadcast also delays later
messages to that peer; implementations MAY send without the spread
(the reference implementation does, for now).

When a connection becomes active (`connection.event{added}`), each vault
sends its current shared profile, with its core (0.18.0, §10.8), to the
other as `profile.update`.

There are no multi-recipient primitives.

## 10. Message type registry

**Directions:**

- **D→V:** a device to its own vault.
- **V→D:** a vault to its own device(s).
- **V↔V:** between peer vaults.
- **ACh:** the alternate channel (§11).

**req** marks a request (§8.1). Body schemas for lifecycle, sessions,
devices and access sessions, connections (with blocks and member
authentication), messaging, the credential, items, tags, profile,
settings, audit, feed, calls, LEASH, share rules and grants,
critical-item use, shared actions, introductions, location, presence and
the wallet are in §10.1–§10.18; push is reserved (§14).

Every flow between vaults is a set of **events** correlated by ids in
their bodies (`request_id`, `fetch_id`, `invocation_id`), never a V↔V
request (§8.1): its answer usually waits for a member's decision, far
longer than §8.1's timeout, and must survive a lock of either vault.
Each vault records what it sent and received in its state: an event that
repeats a known id is ignored (beyond the inner-`id` dedupe of §8.2), and
an answer to an unknown or expired id is dropped.

| Group | Type | Dir | req | Purpose |
|---|---|---|---|---|
| Lifecycle | `vault.enroll` | ACh | | Create a vault (§11.3) |
| | `vault.enrolled` | V→D sealed | | Attestation, vault bundle, `vault_id`, token |
| | `vault.enroll.confirm` | D→V | req | End the provisional state |
| | `vault.unlock` / `vault.unlock.result` | ACh | | PIN unlock (§11.4) |
| | `vault.lock`, `vault.status`, `vault.delete` | D→V | req | Lock, status, delete (§7.4 first) |
| | `vault.locking` | V→D | | Graceful lock notice (ephemeral) |
| | `vault.owner-check` | D→V | req | The daily owner check: PIN and credential password together (§3.6, 0.13.0; spelled `vault.owner_check` before 0.15.2) |
| | `vault.held` | V→D | | The vault is held: content-free counts of what is waiting (§3.6.3, 0.13.0) |
| Sessions | `hs.init`, `hs.resp`, `hs.fin` | D↔V, V↔V | | Handshake, rekey, reconnect (§6) |
| | `relay.token.issued` / `relay.token.refresh` | any | — / req | Deliver or request a token |
| | `relay.address.update`, `identity.rotate` | any | | Rotation (§3.4) |
| Credential | `credential.create`, `.get`, `.version`, `.unlock`, `.lock`, `.rotate`, `.password.change`, `.recover`, `.reset` | D→V | req | Protean Credential lifecycle (§3.5, §10.6) |
| | `credential.alarm` / `credential.alarm.confirm` | V→D / D→V | — / req | Clone alarm to the holder; its confirmation (§3.5.9) |
| | `pin.change` | D→V | req | Re-derive the DEK and re-seal the header (§10.6) |
| Items & profile | `item.put`, `.get`, `.reveal`, `.list`, `.tag`, `.sensitivity`, `.delete` | D→V | req | The member's items: `data`, `secret` and `critical` (§10.7) |
| | `tag.list`, `.set`, `.delete`, `.merge` | D→V | req | The tag registry; rename and merge (§10.8) |
| | `profile.get`, `profile.set`, `settings.get`, `settings.set` | D→V | req | Display name and photo, the read-only core; owner policy (§10.8) |
| | `profile.update` | V↔V | | Shared profile (the core `first_name`, `last_name`, `ik`; display name, photo, `@profile` items) to a connection (§9.3, §10.8) |
| | `sync.event` / `sync.since` | V→D, V↔V / D→V, V↔V | — / req | Mirror changes (kinds in §10.1); catch up |
| | `account.get` | D→V | req | The member's account snapshot from the member API, display only (§11.13, 0.15.0) |
| | `account.name.set` | D→V | req | Change the account's first and last name, with the PIN and the credential password; applied by the member API (§10.8, 0.18.0) |
| Connections | `connection.invite.create`, `.list`, `.cancel`, `.accept` | D→V | req | Invitations (§6.4) |
| | `connection.request.pending`, `connection.request.outgoing` | V→D | | An incoming request awaiting approval (profile, `sas`, `remote`); an outgoing one (`sas`) (§6.4) |
| | `connection.request.list` | D→V | req | Pending incoming and outgoing requests with their SAS (§6.4) |
| | `connection.approve`, `.decline`, `.list`, `.get`, `.remove`, `.update` | D→V | req | Approve or decline a request; manage connections; the owner's own metadata |
| | `connection.approved` | V↔V | | The member approved the request after comparing the SAS; the standing and reconnect tokens (§6.4, 0.10.3) |
| | `connection.declined` | V↔V | | The member declined (or blocked) the request (§6.4, 0.10.5) |
| | `connection.removed` | V↔V | | Notify the peer |
| | `connection.event` | V→D | | Added, pending, stale, removed, rekeyed, reconnected |
| | `block.add`, `.remove`, `.list` | D→V | req | Block list (§7.4) |
| | `connection.authenticate.request`, `.approve`, `.deny`, `.list` | D→V | req | Member authentication (§10.4) |
| | `connection.asks.mute`, `connection.asks.resume` | D→V | req | Mute or resume a connection's asks (§10.4.1, 0.23.0) |
| | `connection.authenticate.challenge`, `.response`, `.rotated` | V↔V | | Challenge; the member's signature or refusal; credential-key rotation statements |
| | `connection.authenticate.pending` / `.result` / `.key` | V→D | | Asked to authenticate; the verdict; the pinned key followed a rotation |
| Messaging | `message.send` | D→V | req | Send to a connection |
| | `message.deliver`, `message.receipt` | V↔V | | Message; delivered or read receipt |
| | `message.new` | V→D | | Incoming message |
| | `message.list`, `.get`, `.read`, `.delete` | D→V | req | History and read state |
| Calls | `call.start`, `call.list` | D→V | req | Place a call (the vault issues its signed ICE config, CALLING-SERVICE §6); call history (§10.10) |
| | `call.offer` | V↔V, V→D | | SDP and the caller device's KEM `ek`; to devices with their vault's signed ICE config |
| | `call.answer` | D→V, V↔V, V→D | | SDP and the answering device's KEM `enc` |
| | `call.ice`, `call.ringing` | any | | Trickle ICE; the callee rings (ephemeral) |
| | `call.end` | any | | Hang up, decline, busy, timeout, answered elsewhere |
| Devices & agents | `device.pair.create`, `.approve`, `.reject`, `device.list`, `device.unlink` | D→V | req | Pairing and management (§6.7) |
| | `device.pair.pending` | V→D | | Awaiting approval (`sas`) |
| | `device.transfer.create`, `.approve`, `.reject` | D→V | req | Direct transfer of the app to a new phone (§6.7.1) |
| | `device.transfer.pending` | V→D | | The new phone scanned: name and `sas` |
| | `device.paired`, `device.unlinked` | V→D | | Welcome and removal notices |
| | `device.pair.rejected` | V→D (the new device) | | The owner rejected the pairing or transfer after its `hs.fin` (§6.7, 0.10.5) |
| | `device.session.request`, `.approve`, `.deny`, `.end` | D→V | req | Access sessions of desktops and agents (§6.8) |
| | `device.session.pending`, `.granted`, `.ended` | V→D | | Asked; granted; ended or denied |
| | `approval.pending`, `approval.waiting` / `approval.decide` | V→D / D→V | — / req | A desktop's step-up request or an agent's referred request, held for an app (§6.8) |
| | `agent.request` | D→V (agent) | req | LEASH: the catalog, an item its share rules include, a use of a field without exposure (§10.11) |
| LEASH | `leash.grant.issue`, `.revoke`, `.list` | D→V | req | Manage agent grants (§10.11) |
| | `leash.grant.updated` | V→D (agent) | | The agent's current grants |
| Wallet | `wallet.create`, `.list`, `.get`, `.update`, `.address.new`, `.address.list`, `.address.used`, `.psbt.inspect`, `.sign`, `.history`, `.balance` | D→V | req | BIP86 and BIP84 accounts of a phrase that is a critical item; PSBT signing (§10.18). Between connections: the wallet actions (§10.14) |
| Location | `location.share.start`, `.stop`, `.list`, `location.get`, `location.request` | D→V | req | Share with one connection; ask a connection to share (§10.16) |
| | `location.update` | D→V, V↔V, V→D | | A position: from the source device; reduced, to the connection (ephemeral) |
| | `location.history.list`, `.delete`, `.share` | D→V | req | The member's own location log; a snapshot through a share (§10.16) |
| | `location.shared`, `location.stopped`, `location.requested`, `location.snapshot` | V↔V | | A share started or stopped; a request; a log snapshot |
| | `location.event`, `location.request.pending` | V→D | | Started or stopped; asked to share |
| Actions | `action.list`, `.configure`, `.invoke`, `.respond` | D→V | req | The built-in catalog and its permission modes; invoke an action on a connection's vault; approve one (§10.14) |
| | `action.offered`, `action.invocation`, `action.result` | V↔V | | The actions offered to that connection; an invocation; its result |
| | `action.pending`, `action.result` | V→D | | Invoked and waiting for the owner; a result |
| Introductions | `intro.create`, `.cancel`, `.list`, `.accept`, `.decline` | D→V | req | Introduce two connections; answer an introduction (§10.15) |
| | `intro.offer`, `.answer`, `.connect`, `.invite`, `.link`, `.closed` | V↔V | | Between the introducer and each party |
| | `intro.pending`, `intro.event` | V→D | | Offered; answered, connecting or closed |
| Sharing | `share.rule.set`, `.list`, `.delete`, `share.decide`, `share.pending.list` | D→V | req | Share rules for connections and agents; decide the items they ask about; list the items waiting (§10.12) |
| | `share.pending` | V→D | | Items waiting for the member's decision (§10.12) |
| Grants | `grant.request`, `.decide`, `.revoke`, `.list`, `.fetch`, `.catalog` | D→V | req | 1:1 grants of items; a connection's catalog (§10.12) |
| | `data.request`, `data.decided`, `data.shared`, `data.revoked`, `data.fetch`, `data.value`, `data.catalog.get`, `data.catalog` | V↔V | | Between the two vaults |
| | `grant.pending`, `grant.event`, `grant.value`, `grant.catalog.result` | V→D | | Asked; granted, denied or revoked; a value sealed to the fetching device; a connection's catalog |
| Critical items | `critical-secret-use.request`, `.approve`, `.deny`, `.list`, `.get` | D→V | req | Ask a connection's member to use a critical item; consent with the password (§10.13) |
| | `critical-secret.use`, `critical-secret.result` | V↔V | | The request; the result or refusal |
| | `critical-secret-use.pending`, `critical-secret-use.result` | V→D | | Asked (apps and desktops); the result |
| Presence | `presence.query`, `presence.get`, `presence.set` | D→V | req | Ask; read and set own state and policy (§10.17) |
| | `presence.ping`, `presence.pong` | V↔V | | On demand (§9.2; ephemeral events) |
| | `presence.result` | V→D | | The answer, to the asking device (ephemeral) |
| Audit & feed | `audit.list`, `connection.audit.list` | D→V | req | Audit log, whole or per connection (§10.9) |
| | `audit.export` | D→V | req | The member's History export: count, PIN, audit entry; the app then reads the entries with `audit.list` (§10.9, 0.22.0) |
| | `feed.list`, `.get`, `.update`, `.delete`, `guide.sync` | D→V | req | Activity feed; app guides as feed items (§10.9) |
| | `feed.event` | V→D | | New feed item |
| Push | `push.register`, `push.unregister` | D→V | req | Reserved (§14) |

**Calls** (CALLING-SERVICE §7, §9; §10.10):

- `call.offer` carries a fresh ephemeral KEM `ek`, generated by the
  calling device, which keeps its private half.
- The answering **device** runs
  `SetupBaseS(ek, info = "vettid/vms/2/call" || call_id)` and returns the
  resulting `enc` in `call.answer`. Both devices derive
  `K = ctx.Export("vettid/vms/2/call-key", 32)`, and from it
  `k_call = HKDF-SHA-256(ikm = K, salt = "vettid-call-v1", info = call_id)`.
  The vaults relay `ek` and `enc` and never hold `k_call`.
- Offers carry `exp`, 45 s by default.
- `call.offer`, `call.answer` and `call.end` are durable. `call.ice` and
  `call.ringing` are ephemeral.
- A locked callee cannot answer, so the call times out.

### 10.1 Common rules and `sync.event`

- Bodies are JSON objects (§5.3). Unknown members are ignored. Strings are
  at most 4 KiB unless stated. Timestamps in bodies use the inner `ts`
  format; invite and pairing expiries (`exp` in responses) are RFC 3339 in
  whole seconds.
- Error codes: `bad_request`, `not_found`, `forbidden` (the sender's role may
  not send this type), `unsupported_type` (§5.3), `internal`, `relay_error`,
  `ttl_not_allowed`, `claim_unavailable`, `accept_failed`, `approve_failed`,
  `connection_unavailable`, and (0.4.0):
  - `conflict`: the request's `version` is not the current one (§8.4);
  - `exists`: the object already exists (`credential.create`; since
    0.10.2 also `connection.invite.accept` of a vault already connected
    or requested, with body `{connection_id}`, §6.4);
  - `limit`: a count or size limit of the feature would be exceeded.
    Since 0.21.0 (owner decision of 2026-10-08, §15 item 29) its body
    names the limit: `{limit: <name>, max, size?}`, where `max` is the
    bound (a count, or bytes for a `*_size` limit) and `size`, only for
    a size limit, the size the refused request would have reached as
    the vault counted it. A vault never sends `limit` without this
    body; an app shows a name it does not know as a generic "limit
    reached". The names:

    | `limit` | `max` | Reached by |
    |---|---|---|
    | `items` | 2,000 items, critical ones included | `item.put`, `wallet.create` (§10.7, §10.18) |
    | `critical_items` | 1,000 critical items (also the credential's 1,000 entries, §3.5.2) | critical `item.put`, `item.sensitivity`, `wallet.create` |
    | `item_size` | 65,536 bytes, or 12,288 for a critical item (§10.7 Size) | `item.put`, `item.sensitivity` |
    | `credential_size` | 131,072 bytes of the credential's `inner` (§3.5.2) | a credential operation that adds to it |
    | `profile_items` | 32 items tagged `@profile` | `item.put`, `item.tag` (§10.8) |
    | `profile_size` | 196,608 bytes of `profile.update`, counted with maximum-length names | `profile.set`, `item.put`, `item.tag` (§10.8) |
    | `tag_registry` | 512 registry entries | `tag.set` (§10.8) |
    | `app_settings` | 64 `app.*` keys | `settings.set` (§10.8) |
    | `share_rules_subject` | 64 rules per subject | `share.rule.set` (§10.12) |
    | `share_rules` | 512 rules in all | `share.rule.set` |
    | `share_pending` | 4,096 pending items | `share.rule.set`, `item.put`, `item.tag`, `tag.merge` |
    | `grants_given` | 1,000 active given grants | `grant.decide`, and every change that includes items by an `auto` rule or a decision (`share.rule.set`, `share.decide`, `item.put`, `item.tag`, `tag.merge`), shared actions (§10.12, §10.14) |
    | `grant_requests` | 1,000 requests the asking vault keeps | `grant.request` |
    | `catalog_requests` | 64 outstanding catalog requests | `grant.catalog` |
    | `grant_fetches` | 64 outstanding fetches | `grant.fetch` |
    | `held_approvals` | 8 held requests per device | a request held for approval (§6.8) |
    | `connection_requests` | 256 outgoing connection requests | `connection.invite.accept` (§10.4) |
    | `blocks` | 1,000 block entries | `block.add` (§10.4) |
    | `auth_challenges` | 8 outstanding challenges per connection | `connection.authenticate.request` (§10.4) |
    | `agent_grants` | 32 grants per agent | LEASH grants, agent share rules (§10.11) |
    | `critical_use_requests` | 64 outstanding outgoing requests | `critical-secret-use.request` (§10.13) |
    | `action_invocations` | 256 outstanding outgoing invocations | `action.invoke` (§10.14; the reference's bound, first stated here) |
    | `introductions` | 16 open introductions | `intro.create` (§10.15) |
    | `location_shares` | 64 outgoing shares | `location.share.start` (§10.16) |
    | `location_requests` | 1 per connection per 10 minutes | `location.request` (§10.16) |
    | `wallets` | 16 wallets | `wallet.create` (§10.18) |
    | `wallet_addresses` | 2,000 addresses per wallet | `wallet.address.new` (§10.18) |

    A count that is part of a request's shape is `bad_request`, not a
    `limit`, and has no name: more than 64 fields in an item, for every
    sensitivity (§10.7; 0.21.1), as more than 16 tags or 500 ids in a
    list. Limits on what another vault sends (received grants, pending
    requests per connection, offers) are not error responses: those
    messages are dropped and audited as their sections say, and (0.23.0)
    a connection's asks are bounded by §10.4.1's constants;
  - (0.18.0) `too_soon`: `account.name.set` within 30 days of the last
    applied name change, with body `{allowed_after}` (RFC 3339, §10.8);
  - `bad_password`, `backoff`, `stale_credential`, `utk_invalid`: §3.5.3,
    §3.5.4. Since 0.17.0 a `backoff` error response's body is
    `{retry_after}`: the whole seconds, rounded up and at least 1, until
    the backoff that refused the request ends (the PIN backoff of §11.8
    or the password backoff of §3.5.3), as in the unlock result
    (§11.4). The app shows it as a countdown and does not resend
    before it ends;
  - `credential_required`: the vault has no credential (§3.5.7), or a
    recovery needs one (§11.11.5);
  - `bad_pin`: the current PIN given to `pin.change` is wrong;
  - and (0.5.0):
    - `session_required`: a desktop or agent has no access session
      (§6.8);
    - `denied`: an app denied a held request, or the device's access
      session ended while it was held (§6.8);
    - `approval_timeout`: no app decided a held request in time (§6.8);
    - `busy`: `call.start` while a call is ringing or active (§10.10);
    - `credential_locked`: the operation signs with the credential key
      and the unlock window is closed (§3.5.3, §10.4);
    - `blocked`: `connection.invite.accept` of an invitation from a
      blocked identity (§10.4);
  - and (0.6.0) no new codes: `forbidden` also answers an agent's request
    that no LEASH grant covers (§6.8, §10.11), and `credential_locked` a
    signed LEASH grant outside the unlock window. Refusals between vaults
    are not error responses but `status` or `error` members of the
    answering event (§10.12–§10.14);
  - and (0.7.0) `in_use`: `tag.delete` of a tag a share rule names
    (§10.8), and (0.8.0) `item.put` or `item.sensitivity` of a wallet's
    item (§10.18);
  - and (0.8.0):
    - `invalid_psbt`: a PSBT the wallet refuses to sign; `message` holds a
      short reason (§10.18);
    - `unavailable`: the operation needs something this release does not
      have, such as a vault-side chain source (§10.18);
  - and (0.9.0):
    - `one_app`: `device.pair.create{role: "app"}`; the vault already has
      its app (§6.7);
    - `credential_frozen`: a clone alarm is open and awaits the holder's
      confirmation, or the request presented a clone (§3.5.9);
    - `rotation_required`: the alarm is confirmed; only
      `credential.rotate` runs until the forced rotation (§3.5.9);
    - `credential_lost`: removed in 0.16.0. It answered
      `credential.recover` when the vault kept no copy of the latest blob
      (backup off); there is no recovery with the backup off, which the
      enclave refuses before any recovering app exists (§11.11.1,
      §11.11.5);
    - `transfer_pending`: reserved; unused since 0.10.3, when the
      approval of a transfer completes it at once (§6.7.1);
  - and (0.13.0) `owner_check_required`: the vault is held (§3.6.3); the
    request waits for a successful `vault.owner-check`. Answered to every
    owner-device request outside the hold's allow list, to requests held
    for approval when the hold begins, and to a `settings.set` that
    would turn the hold off, which only a check may do (§3.6.7).
- A request answered with an error changes no state, except the password
  backoff, the spent UTK and the audit log and feed entries of §3.5.3,
  and, for a failed owner check, the PIN backoff and the check's
  `failures` (§3.6.4).
  Objects that several
  owner devices can edit carry a `version` (an integer from 1, `0` before
  the first write); a change MUST name the version it was based on, and
  the vault answers `conflict` if it differs.
- Ids the vault assigns (`item_id`, `rule_id`, `entry_id`) are ULIDs.
- A type sent by a principal whose role is not listed for it is answered
  with `forbidden` (requests) or dropped and audited (other messages).
- Side effects reach the owner's other devices (§9.1) as `sync.event`
  `{kind, ...}`. Kinds:

  | `kind` | Members |
  |---|---|
  | `message.receipt` | `connection_id`, `message_id`, `receipt` (`delivered` \| `read`) |
  | `message.read` | `connection_id`, `message_id` |
  | `device.paired` | `device_id`, `role` |
  | `device.unlinked` | `device_id` |
  | `device.transferred` | `device_id` (the new app), `old_device_id` (§6.7.1) |
  | `device.transfer` | `transfer_id`, `state` (`aborted`), `reason` (§6.7.1) |
  | `credential.alarm` | `alarm_id`, `state` (`frozen`, `rotation_required`, `resolved`) (§3.5.9) |
  | `owner_check` | `deadline`: a check succeeded, and a hold, if any, ended (§3.6, 0.13.0) |
  | `vault.release` | `release` (PCR0 hex), `release_number`; sent once after a vault first runs under a new release (§11.10.6) |
  | `account.changed` | `version`: a newer account snapshot arrived from the host (§11.13, 0.15.0), or (0.18.0) the `name_request` changed (§10.8); for a `name_request` change alone, `version` is the stored snapshot's, unchanged (0.19.0) |
  | `credential.changed` | `version` (§3.5.5) |
  | `item.changed` | `item_id`, `version` (§10.7) |
  | `item.deleted` | `item_id` (§10.7) |
  | `tag.changed` | `version`: the registry, or tags on items, changed (§10.8) |
  | `profile.changed` | `version` |
  | `settings.changed` | `version` |
  | `feed.updated` | `item_id`, `seq` |
  | `feed.deleted` | `item_id`, `seq` |
  | `connection.changed` | `connection_id`, `version` (`connection.update`, §10.4; since 0.23.0 also a change of the connection's ask state, §10.4.1) |
  | `connection.request` | `pending_id` (incoming) or `connection_id` (outgoing), `state` (`approved`, `peer_approved`, `declined`, `peer_declined`, `expired`) (§6.4); `peer_approved`: the peer's `connection.approved` arrived (0.10.3); `declined`: the member declined; `peer_declined`: the peer's `connection.declined` arrived and ended the request (0.10.5) |
  | `block.added`, `block.removed` | `block_id` (§10.4) |
  | `connection.authenticate.decided` | `request_id`, `approved` (§10.4) |
  | `device.session` | `device_id`, `expires_at` (absent when the session ended) (§6.8) |
  | `approval.decided` | `approval_id`, `approved` (§6.8) |
  | `leash.grant.changed` | `grant_id`, `agent_id`, `version` (§10.11) |
  | `leash.grant.revoked` | `grant_id`, `agent_id` (§10.11) |
  | `leash.agent.suspended` | `agent_id`, `suspended` (§10.11) |
  | `grant.changed` | `grant_id`, `state` (`active`, `used`, `expired`, `revoked`) (§10.12) |
  | `grant.request.decided` | `request_id`, `approved` (§10.12) |
  | `share.rule.changed` | `rule_id`, `version` (§10.12) |
  | `share.rule.deleted` | `rule_id` (§10.12) |
  | `share.decided` | `rule_id`, `included`, `declined` (§10.12) |
  | `critical-secret-use.decided` | `request_id`, `approved` (§10.13) |
  | `action.changed` | `action_id`, `version`: its configuration changed (§10.14) |
  | `action.decided` | `invocation_id`, `approved` (§10.14) |
  | `action.offers` | `connection_id`: the actions it offers changed (§10.14) |
  | `intro.changed` | `intro_id`, `state` (§10.15) |
  | `location.share.changed` | `share_id`, `state` (`active`, `ended`): an outgoing share (§10.16) |
  | `location.history.changed` | `count`: positions were deleted from the location log (§10.16) |
  | `presence.changed` | `version` (§10.17) |
  | `wallet.changed` | `wallet_id`, `version` (§10.18) |
  | `wallet.signed` | `wallet_id`, `txid` (§10.18) |
  | `wallet.deleted` | `wallet_id` (§10.18) |

  These go to the owner's app and desktops other than the sender (not agents), never with
  secret values; devices fetch what changed.

### 10.2 Lifecycle and sessions

| Type | Request body | Response / event body |
|---|---|---|
| `vault.enrolled` | — | §11.3 |
| `vault.enroll.confirm` (app) | `{}` | `{}` |
| `vault.status` (app, desktop, agent) | `{}` | `{vault_id, state_seq, header_seq, provisional, devices, connections, owner_check}`; `owner_check` (0.13.0) is `{state: "ok" \| "due" \| "held", deadline, interval_seconds, failures, hold, hold_off_until?, waiting?}` to apps and desktops and `{state}` to agents (§3.6, §3.6.7). `waiting` (0.19.0) is `{messages, requests, calls, other}`, the counts of `vault.held` since the deadline (§3.6.3), present while the state is `due` or `held` for a device that receives `vault.held` (the app; desktops with an access session while `held`) and absent otherwise. A recovering app (§11.11.5) gets only `{vault_id, state_seq, header_seq}` (0.16.0): nothing about the vault's devices, connections or owner check before it has proved the credential password |
| `vault.owner-check` (app: the holder) | `{credential, utk_id, sealed{pin, password, hold?, hold_off_until?}}` | `{credential, version, utks, deadline, interval_seconds, hold, hold_off_until?}` (§3.6.1, §3.6.7); `bad_pin`, `bad_password`, `backoff` (body `{retry_after}`, §10.1), `utk_invalid`, `stale_credential`, `credential_frozen`, `rotation_required`, `forbidden` (not the holder), `bad_request` (a PIN that is not 6–32 digits) |
| `vault.held` (V→D, to the app and desktops in an access session) | — | `{deadline, waiting: {messages, requests, calls, other}}` (§3.6.3) |
| `vault.lock` (app, desktop) | `{}` | `{}`; then `vault.locking` |
| `account.get` (app, desktop) | `{}` | `{account: <snapshot, §11.13> \| null, version, received_at, name_request?}`; `null` (and `version` 0) before any snapshot arrived (0.15.0); the snapshot carries the member's full `email` (0.20.0), which only this type returns and only to the app and desktops (§11.13); `name_request` (0.18.0) is the latest `account.name.set` request (§10.8). A change of `name_request` alone sends `sync.event{kind: "account.changed"}` with the stored snapshot's `version` repeated, not incremented (0.19.0): `version` counts snapshots only, so a device MUST NOT skip an `account.changed` whose `version` it already holds |
| `vault.delete` (app: the holder, or the enrolling app before a credential exists) | `{confirm: "delete my vault", credential?, utk_id, sealed{pin, password?}}` | `{}`; then the deletion of §12.5. `bad_request` without the exact phrase or a needed member; `bad_pin`, `backoff`, `bad_password`, `credential_frozen` / `rotation_required` (holder during an alarm), `forbidden` (a recovering app since 0.16.0: it completes the recovery first, then deletes as the holder; a member without the credential uses §11.11.9) |
| `vault.locking` (ephemeral) | — | `{reason?}`, with `exp` = now + 60 s; an app ignores one whose `ts` is not later than its latest successful unlock result's (§11.4, 0.23.3); `reason` is `"recovery"` when a recovery request locked the vault (§11.11.1), `"owner_check"` when ten consecutive failed owner checks did (§3.6.4, 0.13.0) |
| `relay.token.issued` | — | `{kind: "standing" \| "reconnect", token}` |
| `relay.token.refresh` (req) | `{}` | `{kind: "standing", token}` |
| `identity.rotate` | — | `{rotation: <identity.rotate statement, §3.4>}` |
| `relay.address.update` | — | `{relay: {url, mailbox, pk}, token, reconnect_token?}` |

### 10.3 Devices (§6.7)

| Type | Request body | Response / event body |
|---|---|---|
| `device.pair.create` (app) | `{role: "desktop" \| "agent"}` | `{pairing_id, link, exp}`; `{role: "app"}` is answered `one_app` (§6.7) |
| `device.pair.pending` (to apps) | — | `{pairing_id, pending_id, role, name, sas}`; `name` is the new device's self-asserted `profile.name` |
| `device.pair.approve` (app) | `{pairing_id, session_seconds?, grants?}`; `session_seconds` (60–86,400) only for a desktop or agent: its first access session (§6.8); `grants` only for an agent: 1–32 LEASH grant specifications (§10.11), signed at the approval (`credential_locked` outside the unlock window) | `{}` |
| `device.pair.reject` (app) | `{pairing_id}` | `{}` |
| `device.pair.rejected` (to the new device) | — | `{}`: the owner rejected the pairing or transfer after its `hs.fin` (0.10.5); sealed under the handshake's epoch, on the device's token from `hs.init`, as `device.paired`; the device stops waiting (§6.7) |
| `device.paired` (to the new device) | — | `{device_id, role, vault_id, release, release_number, token, session_expires_at?, transfer?, credential_version?, user_guid?}` (the release the vault runs under); `token`: the device's standing token (§7.1); it replaces the request token of a pairing's or transfer's `hs.resp` (0.10.3), and after enrollment or recovery, whose `hs.resp` already carries one, it is a fresh one (0.10.4); `transfer: true`, the credential's `credential_version` and (0.17.0) the member's `user_guid`, which its unlocks need, for a transferred app only (§6.7.1) |
| `device.list` (app, desktop) | `{}` | `{devices: [{id, kind, state, name, ik, profile?, created_at?, last_active_at?, session_expires_at?}]}` |
| `device.unlink` (app) | `{device_id}` | `{}`; `forbidden` for the app itself (0.9.0: it leaves by a transfer or a recovery) |
| `device.unlinked` (to the unlinked device, best effort) | — | `{reason?}`: `"transferred"` for the old app of a transfer (§6.7.1), `"replaced"` for the old app of a recovery (§11.11.5) |
| `device.transfer.create` (the holder) | `{}` | `{transfer_id, link, exp}`; `exists` while a transfer is open; `credential_frozen` or `rotation_required` during an alarm (§6.7.1) |
| `device.transfer.pending` (to the holder) | — | `{transfer_id, name, sas}`; `name` is the new app's self-asserted `profile.name` |
| `device.transfer.approve` (the holder) | `{transfer_id, credential, utk_id, sealed{password, pin}}` | `{}`: the transfer is complete (0.10.3; was `{exp}`); `bad_pin`, `backoff`, `bad_password`, `stale_credential`, `credential_frozen`, `utk_invalid` |
| `device.transfer.reject` (the holder) | `{transfer_id}` | `{}`; cancels the transfer before or after the scan, until the approval; after the new app's `hs.fin` it gets `device.pair.rejected` (0.10.5) |
| `device.session.request` (desktop, agent) | `{seconds?}` (60–86,400, default 3,600) | `{request_id, exp}` |
| `device.session.pending` (to apps) | — | `{request_id, device_id, role, name, seconds, exp}` |
| `device.session.approve` (app) | `{request_id, seconds?}` | `{device_id, session_id, expires_at}` |
| `device.session.deny` (app) | `{request_id}` | `{}` |
| `device.session.granted` (to the device) | — | `{session_id, expires_at}` |
| `device.session.end` (app: `{device_id}`; desktop, agent: `{}`, its own) | as left | `{}` |
| `device.session.ended` (to the device) | — | `{reason: "denied" \| "ended"}` |
| `approval.pending` (to apps) | — | `{approval_id, device_id, role, name, type, body, exp}`; `body` is the held request's body |
| `approval.waiting` (to the requester) | — | `{approval_id, request_id, exp}` |
| `approval.decide` (app) | `{approval_id, approve: bool}` | `{result}`: `"ok"` or the error code the held request was answered with |

- `last_active_at` is when the vault last processed a durable message from
  the principal, to the minute; `session_expires_at` is present while an
  access session lasts.
- A held request that is approved is executed when the decision arrives,
  so `approval.decide` answers with its outcome; the requester gets the
  request's own response.

### 10.4 Connections (§6.4)

| Type | Request body | Response / event body |
|---|---|---|
| `connection.invite.create` | `{ttl_seconds: 600 \| 3600 \| 86400 \| 604800}` | `{invite_id, link, exp, remote}` |
| `connection.invite.list` | `{}` | `{invites: [{invite_id, exp, remote}]}` |
| `connection.invite.cancel` | `{invite_id}` | `{}` |
| `connection.invite.accept` | `{link}` (the bare payload, §6.4) | `{connection_id, state: "waiting", remote, exp, name?}`: an outgoing request (§6.4); the SAS follows in `connection.request.outgoing` once the handshake has run (0.10.3); `name` is the bundle's `hint.name`. `exists` with body `{connection_id}` for a vault already connected or requested; `blocked`, `limit`, `claim_unavailable`, `bad_request`, `accept_failed`; `internal` from a vault without the account's names (§10.8, 0.19.0) |
| `connection.request.pending` (incoming, to apps and desktops) | — | `{pending_id, invite_id, sas, remote, state, exp, profile?, introduced_by?}`, once `hs.fin` has checked out; `state` is `pending`, or `approved` under in-person auto-approval (§6.4) |
| `connection.request.outgoing` (to apps and desktops, the accepting device included) | — | `{connection_id, sas, remote, exp, name?, introduced_by?}`, once the vault has sent `hs.fin` and knows the SAS (0.10.3), whichever device accepted or for an introduction (§10.15) |
| `connection.request.list` | `{}` | `{incoming: [{pending_id, invite_id, sas, remote, state, peer_approved, created_at, exp, profile?, introduced_by?}], outgoing: [{connection_id, sas?, remote, state, peer_approved, created_at, exp, name?, introduced_by?}]}` |
| `connection.approved` (V↔V, session mode under the handshake's epoch) | — | `{token, reconnect_token}`: the standing and reconnect tokens for the peer (§6.4, §7.1); sent once, at the member's approval; ignored once the connection is active (0.10.4) |
| `connection.declined` (V↔V, as `connection.approved`) | — | `{}`: the member declined (or blocked) the request; sent once, at the decline, when the vault holds the handshake's epoch and the peer's request token; the receiver ends the request (`peer_declined`), or removes the connection if it is already active (§6.4, 0.10.5) |
| `connection.approve`, `.decline` | `{pending_id}` (an incoming request) or `{connection_id}` (an outgoing one), exactly one | `{}`; `not_found` for an unknown or ended request; `bad_request` for an approval while the SAS is not yet known (0.10.3); a decline is accepted in any state, `waiting` included (0.10.4) |
| `connection.list` | `{}` | `{connections: [<connection>]}` |
| `connection.get` | `{connection_id}` | `<connection>` |
| `connection.update` | `{connection_id, version, alias?, note?, tags?, favorite?, archived?}` (at least one) | `{version}` |
| `connection.remove` | `{connection_id}` | `{}` |
| `connection.removed` (V↔V) | — | `{}` |
| `connection.event` | — | `{connection_id, event: "added" \| "removed" \| "stale" \| "rekeyed" \| "reconnected" \| "failed" \| "profile", pending_id?, reason?}`; `profile`: the connection's shared profile changed (§10.8); `failed`: an outgoing request ended without a connection other than by its member's decline (§6.4, 0.10.4); `reason`, only with `failed`: `declined` when the peer declined (0.10.5), absent for an expiry or an aborted handshake; `pending_id` with `added` on the inviter's side names the request it came from (on the accepter's side `connection_id` is the accept's) |
| `block.add` | `{connection_id \| pending_id, note?}` (exactly one of the ids) | `{block_id}` |
| `block.remove` | `{block_id}` | `{}` |
| `block.list` | `{}` | `{blocks: [{block_id, ik, name?, note?, created_at}]}` |

```json
connection: { "id": "<id>", "kind": "connection", "state": "active", "name": "...", "ik": "<b64>",
              "profile": { }, "created_at": "<ts>", "last_active_at": "<ts>",
              "version": 2, "alias": "...", "note": "...", "tags": ["family"],
              "favorite": true, "archived": false,
              "asks": { "muted": false, "paused": false, "cooldowns": 0 } }
```

- **Requests** (0.10.2, §6.4; states 0.10.3). In
  `connection.request.list`, an incoming request is listed once its
  `hs.fin` has checked out; its `state` is `pending` (awaiting the owner)
  or `approved` (the owner approved, awaiting the peer's approval). An
  outgoing request's `state` is `waiting` (no `hs.resp` yet; `sas`
  absent), `pending` (the SAS is known, awaiting the member) or
  `approved`. `peer_approved` is whether the peer's `connection.approved`
  has arrived; a request with both approvals is a connection and leaves
  the list. `exp` is when the request is dropped (§6.4 "Request expiry
  and retention"); `created_at` is when the vault received the `hs.init`
  or sent it. Both lists are newest first; a vault holds at most 256
  requests of each kind (more are refused: an `hs.init` is dropped and
  audited, an accept is answered `limit`). `introduced_by` is the vault's
  connection id of the introducer (§10.15). Approvals, the peer's
  approval and declines reach the other devices as
  `sync.event{kind: "connection.request"}`, and so do an incoming
  request's expiry and (0.10.5) the peer's decline (`peer_declined`, to
  every app and desktop).

The D→V types above are sent by `app` or `desktop` devices (§6.4 "Who
approves"); for desktops, `connection.invite.create`,
`connection.invite.accept`, `connection.remove` and `block.remove` are
step-up types (§6.8).

- **Metadata.** `alias` (at most 128 bytes), `note` (at most 1,024 bytes),
  `tags` (at most 16 distinct tags matching `[a-z0-9_.-]{1,32}`),
  `favorite` and `archived` are the owner's own metadata. They are never
  sent to the peer, are versioned as one object per connection (§10.1;
  `version` is `0` before the first update) and are announced to the
  other devices as `sync.event{kind: "connection.changed"}`. `""` clears
  `alias` or `note`; `tags` replaces the list. `name` and `profile` remain
  the peer's values (§10.8).
- **`name` and `profile`** (0.18.0). `profile` is the peer's latest kept
  `profile.update` body (§10.8): `{version, first_name, last_name, ik,
  name?, photo?, items}`, absent only before the first, in the moment
  after activation; the inviter's side then has the request's
  `{first_name, last_name, name?}`. `name` is the peer's display name,
  from that profile or, before it, from the peer's `hs.init` or the
  bundle's `hint.name`; absent without one. Apps title a connection from
  the names as §10.8 says, never from `name` alone, and show the
  fingerprint of `ik`. In `connection.request.pending` and
  `connection.request.list`, `profile` is the requester's `hs.init`
  profile (`{first_name, last_name, name?}`, §6.2).
- **`last_active_at`** is when the vault last processed a durable message
  from the connection, to the minute; `created_at` is when the connection
  was made.

**Block list.** `block.add` blocks a connection or the sender of a pending
connection request:

- A connection is removed as §7.4 "Peer blocked" says (the peer gets a
  best-effort `connection.removed`, never a reason) and its `ik` and relay
  key are recorded in a block entry.
- A pending request is declined, which sends `connection.declined`
  (§6.4, 0.10.5; never a reason, so a block looks like a decline), and
  its `hs.init` identity (`from.ik`, `from.relay.pk`) recorded.
- An identity already blocked is answered `exists`; the list holds at most
  1,000 entries (`limit`). `note` is at most 256 bytes.
- A vault MUST refuse (drop and audit as `drop.blocked`) a connection
  `hs.init` whose `from.ik` or collect `sender` is on its block list, and
  answers `connection.invite.accept` of a blocked identity's invitation
  with `blocked`.
- A block entry follows neither the peer's identity rotation nor a new
  relay key of the peer: it guards against reconnecting by accident, while
  reaching the vault at all always needs a new invitation from its owner
  (§6.4).
- `block.remove` deletes the entry. The owner may then connect with the
  same peer again through a new invitation and approval (§7.4).
- Changes are announced as `sync.event` `block.added` / `block.removed`,
  and audited (`connection.blocked`, `connection.unblocked`).

**Member authentication.** The handshake (with the SAS, §6.3) authenticates
a connection's *vault*. `connection.authenticate.*` asks the connection's
*member* to prove that they are present now: their app approves, and their
vault signs a fresh challenge with the member's **credential key**
(§3.5.1), which only the member's password unlocks.

| Type | Request body | Response / event body |
|---|---|---|
| `connection.authenticate.request` (app, desktop) | `{connection_id, context?}` | `{request_id, exp}` |
| `connection.authenticate.challenge` (V↔V) | — | `{request_id, nonce, context?}`, with `exp` |
| `connection.authenticate.pending` (V→D, apps and desktops) | — | `{connection_id, request_id, context?, exp}` |
| `connection.authenticate.approve` (app) | `{request_id}` | `{}`; `credential_locked` outside the unlock window |
| `connection.authenticate.deny` (app, desktop) | `{request_id}` | `{}` |
| `connection.authenticate.response` (V↔V) | — | `{request_id, status: "signed", key, sig, signed_at, rotations?}` or `{request_id, status: "denied"}` |
| `connection.authenticate.rotated` (V↔V) | — | `{rotations: [<statement>, ...]}` (1–32 credential-key rotation statements, §3.5.5) |
| `connection.authenticate.key` (V→D, every owner app and desktop) | — | `{connection_id, key}`: the pinned key followed a rotation |
| `connection.authenticate.result` (V→D, every owner app and desktop) | — | `{connection_id, request_id, authenticated, key?, key_changed?, reason?}` |
| `connection.authenticate.list` (app, desktop) | `{}` | `{states: [{connection_id, key?, verified_at?, last_result?, last_at?}]}` |

- `nonce` is 32 random bytes; `context` is at most 256 bytes and shown to
  the member. A challenge lives 10 minutes (`exp`). A vault keeps at most
  8 outstanding challenges it sent per connection (`limit`) and 4 it
  received (more are dropped and audited). Since 0.23.0 a received
  challenge is an ask (§10.4.1).
- To approve, the app opens the credential's unlock window
  (`credential.unlock`, §3.5.3) and sends `connection.authenticate.approve`;
  the use extends the window. The vault signs

  ```
  m   = challenger_ik (32) || responder_ik (32) || nonce (32) || request_id (26) || context
  sig = Ed25519(credential key, "vettid/vms/2/conn-auth" || m)
  ```

  where `challenger_ik` is the requesting vault's `ik` and `responder_ik`
  the signing vault's, each as the other side has it on record. `key` is
  the credential key's public key.
- The requesting vault checks that the response answers an outstanding
  challenge it sent to that connection, verifies `sig` under `key` over
  `m`, and tells every owner device the verdict: `reason` is `denied` or
  `bad_signature`. It pins `key` at the first success. A later success
  under another key sets `key_changed: true` and re-pins, unless the
  pinned key leads to it through valid rotation statements (below); apps
  MUST show a key change.
- **Following a credential-key rotation.** A vault records, per
  connection, the credential key it last signed a response with (the key
  that connection pinned).
  - At `credential.rotate` (§3.5.5) it sends every active connection with
    such a key `connection.authenticate.rotated` carrying its statements
    from that key to the new one, in order.
  - A signed response whose `key` differs from the one recorded for that
    connection carries the same chain as `rotations`, so a requester that
    missed a delivery catches up.
  - The receiver follows the chain from its pinned key: each statement's
    `old_key` MUST equal the previous one's `new_key` (the first's the
    pinned key), both signatures MUST verify, and the chain is at most 32
    statements. On success it pins the last `new_key` and tells every owner
    device with `connection.authenticate.key` (a delivered chain) or with
    `key_changed: false` (a response).
  - **Failure.** A chain that does not verify (forged, unsigned, broken or
    too long) changes nothing: it is dropped and audited
    (`connection.authenticate.rotation_rejected`), and the next
    authentication under the new key reports `key_changed: true`. A
    receiver with no pinned key ignores `rotated`.
- Approvals, denials and verdicts are audited
  (`connection.authenticate.requested`, `.signed`, `.denied`,
  `connection.authenticated`, `connection.authenticate_failed`,
  `connection.authenticate.key_rotated`,
  `connection.authenticate.rotation_rejected`); an incoming challenge is a
  feed item.

#### 10.4.1 Asks from a connection: no approval fatigue

(0.23.0; owner's review of vettid.org #181, 2026-10-09, §15 item 31.)
A connection must not be able to wear the member down with repeated
requests until one is approved by mistake. An agent is bounded by
cooldowns, a referral cap and suspension (§10.11); a connection is
bounded here, in the member's vault, by the same ideas.

**Asks.** An **ask** is a message from a connection that, if accepted,
waits for the member's decision:

| Ask | Arrives as | Reaches the member as | The member's decline answers |
|---|---|---|---|
| A grant request, `item` or `category` entries (§10.12) | `data.request` | `grant.pending`, feed `grant.request` | `data.decided{approved: false}` |
| A critical-item use (§10.13) | `critical-secret.use` | `critical-secret-use.pending`, feed `critical-secret.use.request` | `critical-secret.result{status: "denied"}` |
| An invocation of a `prompt-each-time` action (§10.14) | `action.invocation` | `action.pending`, feed `action.request` | `action.result{status: "denied"}` |
| A member-authentication challenge (§10.4) | `connection.authenticate.challenge` | `connection.authenticate.pending`, feed `connection.authenticate.requested` | `connection.authenticate.response{status: "denied"}` |
| An introduction offer, from the introducer (§10.15) | `intro.offer` | `intro.pending`, feed `intro.request` | `intro.answer{accept: false}` |
| A location request (§10.16) | `location.requested` | `location.request.pending`, feed `location.request` | (none: §10.16 has no decline message) |

Nothing else a connection sends waits for the member. Share-rule
questions (`share.pending`, §10.12) come from the member's own rules,
never from a connection, and are not asks. Actions in `allowlist` or
`default-allow` run without the member and are bounded by §10.14's
limits only. Connection requests (§6.4) come from not-yet-connections
and keep their own limits.

**Constants.** Fixed for v1 by this specification (defaults; a later
version may make them settings):

| Constant | Value |
|---|---|
| Decline cooldown | 7 days |
| Ask rate | 5 asks per connection per 24 hours |
| Pending asks | 8 per connection, all kinds together |
| Pause | after 3 declines from one connection within 30 days |
| Batch | 10 minutes |
| Neutral answer delay | 1–20 minutes, uniformly random (below) |
| Held neutral answers | 16 per connection |

These are not `limit` errors (§10.1): the requester is another vault,
which never gets an error response for them.

**Checks.** For each ask that passes the checks its type already makes
at once (malformed, a duplicate id, an item that is not usable or a
field that is not suitable, an action not offered, the per-type caps;
§10.12–§10.16), the member's vault checks, in this order, and
**suppresses** the ask at the first that applies:

1. **Muted.** The member muted this connection's asks (below).
2. **Paused.** This connection's asks are paused (below).
3. **Cooldown.** The member declined the **same** ask from this
   connection within the last 7 days. The same means: for a grant
   request, an entry with the same `kind` and `ref` (the same `item_id`,
   whatever its `fields`, or the same category); for a critical-item
   use, the same `item_id` and `field_id`, whatever the operation and
   payload; for an action, the same `action_id`; for authentication, any
   challenge; for an introduction, any offer from that introducer. A
   grant request in which only some entries are in cooldown reaches the
   member without those entries (the member's decision, and so the
   answer, covers only the others); one in which all are is suppressed.
   Location requests have no decline and no cooldown.
4. **Pending.** This connection already has 8 asks waiting for the
   member, all kinds together. The per-type caps of §10.12–§10.16 stay
   as a backstop.
5. **Rate.** 5 asks of this connection have reached the member in the
   current window. The window is a fixed 24-hour window that starts at
   the first ask that reaches the member, as §10.12's rate limits are
   (Rate limits for connections); suppressed asks do not count.

An ask that passes reaches the member as before and counts in the
window.

**Declines.** A **decline** is the member's explicit refusal of a whole
ask: `grant.decide{approve: false}`, `critical-secret-use.deny`,
`action.respond{approve: false}`, `connection.authenticate.deny`,
`intro.decline`. An expiry, an approval of only some entries, a
suppressed ask and a desktop's request that an app denied are not
declines. Each decline starts the cooldown of that ask (point 3).

**Pause.** When a connection's third decline falls within 30 days of
the first of those three (the vault keeps the times of its last three
declines; this is a count of events, not of throughput, so it is a
sliding 30 days), its asks are **paused**: later asks are suppressed
until the member resumes them. The member gets **one** high-priority
feed item, `connection.asks_paused` (`connection_id`), and
`sync.event{connection.changed}`; the app says "<First>'s requests are
paused after you declined several" and offers to resume them or to
remove the connection. Asks already waiting stay and can be decided.
Pausing is per connection and has no end of its own.

**Mute.** The member may mute a connection's asks at any time, and
unmute them. While muted every ask is suppressed with no feed item and
no notification; asks already waiting stay. Muting does not pause or
remove the connection: messages, profile updates, grants and shares go
on.

| Type | Request body | Response |
|---|---|---|
| `connection.asks.mute` (app, desktop) | `{connection_id, muted}` (`muted` boolean) | `{}`; `not_found` |
| `connection.asks.resume` (app, desktop) | `{connection_id}` | `{}`; `not_found` |

- `connection.asks.resume` **always** clears the connection's decline
  times and cooldowns, and ends its pause if it is paused (so that a
  member who declined by mistake can be asked again at once, and the
  next three declines are counted afresh). It is audited
  `connection.asks_resumed` and sends `sync.event{connection.changed}`
  every time, also on a connection that is not paused or has no
  cooldown (0.23.1, owner decision of 2026-10-09; 0.23.0 said that it
  changed nothing there). Unmuting does not resume a pause. Neither type
  is delegable (§10.11).
- **State.** Per connection, in DEK state: `muted`, `paused_at`, the
  times of the last three declines, the cooldowns (one per ask
  identity, at most 64 per connection, the oldest dropped first, each
  with its end), the current window's start and count, the open batch
  and the held neutral answers. It goes with the connection (§7.4).
- **Shown on the connection.** `<connection>` carries
  `asks: {muted, paused, paused_at?, cooldowns}` (`cooldowns` the number
  in force), and changes send `sync.event{kind: "connection.changed",
  connection_id, version}` (`version` the connection's, as for
  `connection.update`; 0.23.1) to every owner device (apps, and desktops
  within their access session, §9.1). The app shows a paused or muted
  state on the connection's page with the action that ends it.

**Batching.** Asks from one connection that reach the member within 10
minutes of the first of them form one **batch**: the first creates its
feed item as before; each later ask of the batch creates no feed item
and instead updates the batch's item (a new `seq`, the same `item_id`),
whose `count` (0.23.0, present from 2) is the number of asks in the
batch. If the member has read or archived the batch's item, a later ask
of the batch still updates its `count` and `seq` and leaves its status
as the member set it; if the member deleted it, the batch ends and the
ask starts a new batch with a new item (0.23.1). The per-type `.pending`
events are still sent. Apps MUST present
a batch as one approval entry and one notification ("Dr Lee asks for 3
things"), listing its asks from the per-type lists, and MUST NOT raise a
notification for each ask of a batch in progress.

**What the connection learns: nothing it could tell apart.** A
suppressed ask is answered exactly as the member's decline of that kind
is (the table above: `approved: false`, `denied`, `accept: false`), with
the same members, never with a code or a `retry_after` of its own, and
not at once: after a delay drawn uniformly at random from 1 to 20
minutes, so that its timing does not tell an automatic refusal from a
person's. Exactly (0.23.1): the answer is due at min(now + d, `exp` − 1
minute), d the random delay, and never earlier than now (an ask whose
`exp` is less than a minute away is answered at the vault's next send).
Held answers are kept in DEK state (State, above); one that falls due
while the vault is locked is sent after it is unlocked. A location
request gets no answer, as when the member does not share. The vault
holds at most 16 such answers per connection; asks beyond that are
dropped without an answer, as an unanswered ask. So a connection cannot
tell a decline from a cooldown, a pause, a mute, the pending cap or the
rate. Apps on the asking side MUST show every refusal neutrally ("Not
accepted"), never as "declined by <First>".

**Audit.** Every suppressed ask is audited `drop.ask_muted`,
`drop.ask_paused`, `drop.ask_cooldown`, `drop.ask_pending` or
`drop.ask_rate` (`connection_id`, `ref` = the ask's `request_id`,
`invocation_id` or `intro_id`), and each entry removed from a grant
request its own `drop.ask_cooldown` with the same `ref` (0.23.1: one per
removed entry, written even when the reduced request is then suppressed
by a later check, which adds its own `drop.ask_*`); History shows them
on the connection. The changes are audited `connection.asks_paused`,
`connection.asks_resumed`, `connection.asks_muted` and
`connection.asks_unmuted` (`connection_id`). Only a pause is a feed
item.

### 10.5 Messaging

| Type | Request body | Response / event body |
|---|---|---|
| `message.send` | `{connection_id, text}`; `text` 1 byte to 16 KiB (larger content uses the blob flow, §5.5) | `{message_id, sent_at}` |
| `message.deliver` (V↔V) | — | `{message_id (ULID), text, sent_at}`; idempotent by `message_id` |
| `message.receipt` (V↔V) | — | `{message_id, receipt: "delivered" \| "read", at}` |
| `message.new` | — | `{connection_id, message_id, direction: "in" \| "out", text, sent_at, delivered, read}` |
| `message.list` | `{connection_id, limit?}` (1–500, default 100) | `{messages: [<message.new body>, ...]}`, oldest first |
| `message.get` | `{connection_id, message_id}` | `<message.new body>` |
| `message.read` | `{connection_id, message_id}` | `{}`; the vault sends a read receipt |
| `message.delete` | `{connection_id, message_id}` | `{}`; local only |

The D→V messaging types are sent by `app` or `desktop` devices.

### 10.6 Credential (§3.5)

Every type below is sent by the vault's app, except
`credential.version`, which an `app` or `desktop` may send. The types that
carry or return a blob (`credential.get`, `.ack`, `.unlock`, `.rotate`,
`.password.change`, `vault.owner-check`, §3.6, and `credential.reset`)
and `credential.alarm.confirm` are the **holder's** only (§3.5.9);
`credential.recover` is the recovering app's only (§11.11.5). Critical
items, the member's data inside the credential, are `item.*` types with
`sensitivity: "critical"` (§10.7); they follow the rules of this section
for `credential`, `utk_id` and `sealed`.

- `credential` is the standard base64 of a §3.5.2 blob.
- `utk_id` and `sealed` carry the UTK-sealed payload (§3.5.4). The
  payload members are shown in `{…}` after `sealed`: `password` and
  `new_password` (UTF-8, 8–1,024 bytes), `item_id`, `item`, `reply_key`,
  `request_id`, `payload_sha256`, `pin` (§6.7.1, §3.6.1), and `hold` and
  `hold_off_until` (§3.6.7).
- Types that carry `sealed` can answer `utk_invalid` (§3.5.4). Types that
  carry `credential` follow §3.5.3: they can answer `backoff`,
  `stale_credential` and `bad_password`, and on success they rotate the
  CEK and return the new `credential` and its version. They also follow
  §3.5.9: a clone is answered `credential_frozen`, and during an alarm
  they answer `credential_frozen` or `rotation_required`.
- Every response to a type that spent a UTK carries `utks` (an array of
  §3.5.4 UTKs, possibly empty) to replenish the app's pool.

| Type | Request body | Response body |
|---|---|---|
| `credential.utk.get` | `{}` | `{utks}` (tops the app's pool up to 20) |
| `credential.create` | `{utk_id, sealed{password}}` | `{credential, version, key, utks}`; `exists` if the vault has a credential |
| `credential.get` | `{}` | `{credential, version, updated_at}`: the latest blob, to the holder only (§3.5.9); `not_found` if the vault holds none (§3.5.6) |
| `credential.ack` | `{version}` | `{}`: the app holds this version (§3.5.3) |
| `credential.version` | `{}` | `{exists, version?, key?, updated_at?, alarm?}`; `alarm` = `{alarm_id, state, at}` while a clone alarm is open (§3.5.9) |
| `credential.unlock` | `{credential, utk_id, sealed{password}}` | `{credential, version, expires_at, utks}` (§3.5.3 unlock window) |
| `credential.lock` | `{}` | `{}` |
| `credential.rotate` | `{credential, utk_id, sealed{password}}` | `{credential, version, key, utks}`; the vault also rotates `ik` and `kem` (§3.4) |
| `credential.password.change` | `{credential, utk_id, sealed{password, new_password}}` | `{credential, version, utks}` |
| `credential.recover` | `{utk_id, sealed{password}}` | `{credential, version, utks}` (§11.11.5). 0.9.0 removed the member-supplied `credential`; 0.16.0 removed `credential_lost`: a vault without a backup copy never gets this far (§11.11.1) |
| `credential.reset` | the holder (0.15.2): `{credential, utk_id, sealed{pin, password, new_password}}` | `{credential, version, key, utks}`: a new credential; the old credential and every critical item are destroyed (§3.5.5). Answers as an owner check does (§3.6.1: `bad_pin`, `bad_password`, `backoff`, `credential_frozen`, `rotation_required`, …) and is refused while the vault is held (§3.6.3). 0.16.0 removed the recovering app's form `{utk_id, sealed{password}}`: `forbidden` |
| `credential.alarm` (V→D, to the holder; durable) | — | `{alarm_id, kind: "clone", state: "frozen", at, presenter: "holder" \| "other", version}`: an urgent alert (§3.5.9) |
| `credential.alarm.confirm` | `{alarm_id, mine: bool}` | `{state: "rotation_required"}`; `not_found` if no such alarm is open (§3.5.9) |
| `pin.change` | `{pin, new_pin}` | `{}`; `bad_pin` if `pin` is wrong; `bad_request` if `new_pin` is not 6–32 digits (§11.3) |

- `key` is the credential key's public key (base64). `version` is the
  credential's version (§3.5.2). In the `item.*` types, whose own
  `version` is the item's, the credential's is `credential_version`.
- `reply_key` is a 1,216-byte KEM `ek`.
- **Change notices.** Every new version sends
  `sync.event{kind: "credential.changed", version}` to the owner's other
  devices (also after a `credential.reset`).
- **`pin.change`** re-derives the DEK from `new_pin` (§3.3.1, fresh salt)
  and re-encrypts the state and the header. Its crash-safe write order is
  specified together with its implementation (§15).
- 0.7.0 removed `credential.secret.add`, `.get`, `.list`, `.delete` and
  `.catalog`: critical secrets are critical items (§10.7), and what a
  connection may use is decided by share rules (§10.12).

### 10.7 Items

Everything the member stores is an **item**: a name, a category, typed
**fields**, free-form **tags** (§10.8) and a **sensitivity** that decides
where the vault keeps it. Items replace the profile fields, vault-held
secrets and critical secrets of 0.6.0 (VAULT-ITEMS, owner decisions of
2026-10-03). Templates (a passport, a login, a bank account) belong to
the apps, which pre-fill fields and suggest tags and a sensitivity from
them; a shared registry of recommended templates is kept with the
reference implementation (vettid-vault `docs/item-templates.json`). The
vault validates shape and size only. A template MUST NOT suggest a
reserved tag (§10.8): only the member puts an item into the shared
profile. Because sharing is per item, the registry keeps contact
information as one item per contact point (`email_address`,
`phone_number`, `postal_address`, `website`) so that each can be shared
on its own (VAULT-ITEMS 0.1.1, owner decision of 2026-10-08). A
registry template's `date` field may carry the optional presentation
hint `"format": "month"` (0.23.0, editorial; VAULT-ITEMS 0.1.2): the app
collects a year and a month and stores `YYYY-MM`, which a `date` value
already allows (below), as for a payment card's expiry. The hint lives
in the registry and the apps only: it is not a member of the item or
the field, the vault never sees it, and an app that does not know it
collects a full date. When editing, an app tells a month from the
stored value's form.

```json
item: { "item_id": "<ULID>", "version": 3, "name": "Passport", "category": "identity_document",
        "sensitivity": "data|secret|critical", "template": "passport", "tags": ["identity", "travel"],
        "fields": [ { "field_id": "f1", "label": "Number", "kind": "text", "value": "…" },
                    { "field_id": "f2", "label": "Expires", "kind": "date", "value": "2031-04-30" } ],
        "notes": "…", "created_at": "<ts>", "updated_at": "<ts>" }
```

**Members.**

- `name` is 1–128 bytes. `category` matches `[a-z][a-z0-9_]{0,31}`
  (default `other`); the recommended categories are `identity_document`,
  `login`, `payment_card`, `bank_account`, `medical`, `insurance`,
  `vehicle`, `contact`, `note`, `crypto_wallet` and `other`. `template`
  (optional) matches `[a-z0-9_.-]{1,64}` and is opaque to the vault.
  `notes` is at most 16,384 bytes. `tags` is at most 16 tags (§10.8).
- **Text.** No string member of an item may contain a control character
  (U+0000–U+001F, U+007F), except line feed and tab in `notes` and in
  `multiline` and `password` values.
- **Fields** are ordered, at most 64 for every sensitivity; more is
  `bad_request`, not `limit`: the count is part of the request's shape
  (0.21.1). `label` is 1–64 bytes. `field_id`
  is assigned by the vault (`f1`, `f2`, ... from a counter of the item,
  never reused): in `item.put` a field either names a `field_id` of the
  item's current version (the same field, possibly relabelled) or has
  none (a new field); any other `field_id` is `bad_request`.
- **Kinds** drive the apps' input and display; the vault checks only the
  shape of a `value`. Every kind accepts `""` (not filled in):

  | `kind` | `value` |
  |---|---|
  | `text` | a string of at most 16,384 bytes, without line breaks |
  | `multiline` | a string of at most 16,384 bytes |
  | `number` | a decimal: `-?[0-9]{1,32}(\.[0-9]{1,32})?` |
  | `date` | `YYYY-MM-DD` or `YYYY-MM`, a valid calendar date |
  | `email` | at most 254 bytes: one `@` between a non-empty local part and domain, no white space |
  | `phone` | at most 32 bytes of digits, spaces and `+-().`, with at least one digit |
  | `url` | an absolute URI with a scheme, at most 2,048 bytes, no white space |
  | `password` | a string of at most 16,384 bytes; apps mask it and reveal it on purpose |
  | `otp` | a TOTP seed: an `otpauth://` URI of at most 2,048 bytes, or a base32 secret (RFC 4648 alphabet, case-insensitive, 16–256 characters, optional `=` padding) |
  | `address` | an object `{street?, street2?, city?, region?, postal_code?, country?}` of strings of at most 256 bytes without line breaks; `country` is an ISO 3166-1 alpha-2 code in upper case; other members are refused |
  | `file` | reserved for blob references (owner decision 4: files later); refused with `bad_request`. It stays reserved in 0.21.0: VAULT-ITEMS §3's `file` field shows the later design, not this version, and apps MUST NOT offer it |

- **Size.** An item's **size** is the length in bytes of its content
  encoding: the canonical JSON of `item.get` with every value
  (compact, members in the order of the example above) **without the
  members the vault assigns**, `item_id`, `version`, `created_at`,
  `updated_at` and the fields' `field_id`s (0.21.0, owner decision of
  2026-10-08, §15 item 29; 0.7.0–0.20.0 counted them, so every item
  accepted before is accepted now):

  ```
  {"name":…,"category":…,"sensitivity":…[,"template":…],"tags":[…],
   "fields":[{"label":…,"kind":…,"value":…},…][,"notes":…]}
  ```

  `template` is present only when set and `notes` only when not empty;
  `tags` (normalised and sorted, §10.8) and `fields` always, `[]` when
  empty. Every value is a JSON string except an `address`, the object
  of its non-empty members in the order `street`, `street2`, `city`,
  `region`, `postal_code`, `country` (`{}` when all are empty). Strings
  are raw UTF-8 with exactly these escapes: `"` as `\"`, `\` as `\\`,
  line feed as `\n`, tab as `\t`, U+2028 as `\u2028` and U+2029 as
  `\u2029` (Go's `encoding/json` without HTML escaping; the text rule
  above admits no other control character). An app that holds every
  value therefore computes the size exactly, without knowing the
  vault's ids or timestamps. The size is at most 65,536 bytes (12,288
  for a critical item, below), and a vault holds at most 2,000 items,
  critical ones included: `limit` with `item_size` (and `max`, `size`)
  or `items` (§10.1).

**Sensitivity**, chosen per item at creation (default `data`; owner
decision 1):

| `sensitivity` | Kept in | Owner access | Shared |
|---|---|---|---|
| `data` | DEK state | apps and desktops, values in `item.get` | by share rules and grants (§10.12) |
| `secret` | DEK state | apps; desktops with step-up (§6.8); values only through `item.reveal`, audited | by share rules and grants (§10.12) |
| `critical` | DEK state, its values and notes encrypted under an item key that only the Protean Credential holds (§3.5.2); its metadata (name, category, template, tags, field ids, labels and kinds) in the clear in DEK state | apps only, each read or change a credential operation with the password (§3.5.3) | never readable by anyone else: a share rule can at most make it *usable* (§10.13) |

- A critical item's size (above) is at most 12,288 bytes (its content
  travels in one UTK payload, §3.5.4); a vault holds at most 1,000
  critical items (`limit`: `item_size`, `critical_items`). Its fields
  are limited as every item's (at most 64, `bad_request`, above; 0.21.1:
  0.7.0–0.21.0 also stated a separate 64-field limit for critical items,
  which the general check always reached first). The size is checked on
  the item as it will be stored: an `item.sensitivity` to `critical`
  counts it with `"sensitivity":"critical"` (0.21.1).
- **Envelope encryption** (owner decision of 2026-10-03). A critical
  item's values and notes are encrypted under a random 32-byte item key:

  ```
  sealed = nonce (24) || XChaCha20-Poly1305(item key, nonce, aad, values)
  aad    = "vettid/vms/2/critical-item" || 0x00 || vault_id || 0x00 || item_id
           || 0x00 || uint64be(gen) || (0x00 || field_id)*    (the item's field ids, in order)
  values = {"fields": [{"field_id", "value"}], "notes"?}
  ```

  The ciphertext is kept with the item in DEK state; the key and its
  generation `gen` only inside the credential (§3.5.2). Without the
  credential and the password the vault cannot decrypt the values, so
  every §3.5 property holds as before: the CEK rotates at every use, old
  blobs are dead, inputs are UTK-sealed, outputs reply-key-sealed, and no
  plaintext is retained after the operation.
- **Item keys rotate on every use of the item.** Each operation that
  opens an item (`item.reveal`, `item.put`, a critical-item use, §10.13)
  re-encrypts it under a fresh key with `gen` + 1, in the same flush as
  the CEK rotation; `credential.rotate` and `credential.recover` re-key
  every critical item. Rationale: a key someone once obtained (from an
  old blob opened with its CEK and the password, or from a compromised
  release during an operation) stops opening the item at its next use,
  as an old blob stops opening at the credential's next use; re-keying
  one item costs one AEAD pass of at most 12 KiB. Re-keying every item at
  every credential use would also cover items not used since, at a cost
  that grows with the number of items; `credential.rotate`, which apps
  SHOULD offer at least yearly (§3.5.5), does that on demand.
- `item.sensitivity` changes it. `data` ↔ `secret` is a metadata change.
  Moving to or from `critical` is a credential operation: the vault moves
  the values between DEK state and the credential itself, without them
  crossing the session. Apps MUST warn the member before an item leaves
  `critical`: its values then live in DEK state, readable by the vault
  without the password.
- The tag `@profile` is allowed only on `data` items (§10.8); an item
  carrying it cannot leave `data` (`bad_request`).

| Type | Request body | Response body |
|---|---|---|
| `item.put` (app; desktop: step-up) | `data`, `secret`: `{item_id?, version?, sensitivity?, name, category?, template?, tags?, fields?, notes?, keep_notes?}`; a replacement's fields may omit `value` (Kept values, below; 0.21.0) | `{item_id, version, updated_at}` |
| | `critical` (app): `{version?, sensitivity: "critical", tags?, credential, utk_id, sealed{password, item_id?, item}}`, where `item` is `{name, category?, template?, fields?, notes?, keep_notes?}`; a replacement's fields may omit `value` (Kept values, below; 0.21.0) | `{item_id, version, updated_at, credential, credential_version, utks}` |
| | dry run (0.21.0): `{dry_run: true, item_id?, version?, sensitivity?, tags?}` (Dry run, below) | `{version?, shares, withdrawals}` |
| `item.get` (app, desktop) | `{item_id}` | `<item>`: a `data` item with its values; a `secret` or `critical` item without `value`s and `notes`, with `has_notes`; with `size` (0.21.0, below) |
| `item.reveal` (app; desktop: step-up) | `secret`: `{item_id, fields?: [<field_id>]}` (a `data` item: `{item_id}`, as `item.get`) | `<item>` with its values (only those `fields`, without `notes`, if given) |
| | `critical` (app): `{item_id, credential, utk_id, sealed{password, item_id, reply_key}}` | `{item_id, version, values_sealed, credential, credential_version, utks}` |
| `item.list` (app, desktop) | `{tags?, match?, category?, sensitivity?, after?, limit?}` | `{items: [<item without values and notes>], next?}` |
| `item.tag` (app; desktop: step-up) | `{item_id, version, tags, dry_run?}` | `{version}`; with `dry_run` (0.21.0): `{version, shares, withdrawals}` |
| `item.sensitivity` (app; desktop: step-up, `data` ↔ `secret` only) | `{item_id, version, sensitivity}`; to or from `critical` (app) also `credential, utk_id, sealed{password, item_id}` | `{version}`; with the credential also `{credential, credential_version, utks}` |
| `item.delete` (app; desktop: step-up) | `{item_id}`; `critical` (app): `{item_id, credential, utk_id, sealed{password, item_id}}` | `{}`; `critical`: `{credential, credential_version, utks}` |

- **Critical forms are app-only.** A desktop's request in a critical form
  (one that carries `credential`, `utk_id` or `sealed`, names
  `sensitivity: "critical"`, or is an `item.put` (dry run included),
  `item.reveal`, `item.sensitivity` or `item.delete` of a critical
  item) is answered `forbidden` at once, never held for an app's
  approval it could not pass (§6.8). `item.tag` of a critical item is
  not a critical form: tags are metadata, and a desktop may re-tag it
  with step-up, as any item (0.21.1).
- **Create and replace.** Without `item_id`, `item.put` creates an item
  (`version` absent); with it, it replaces the item's name, category,
  template, tags, fields and notes (`version` required, `not_found`,
  `conflict`, §10.1). A replacement keeps the item's sensitivity
  (`sensitivity`, if given, MUST equal it; `item.sensitivity` changes it).
  `tags` absent leaves the tags as they are. For a critical item the
  content travels in the UTK-sealed `item`, and `item_id` (to replace)
  inside the payload, so that a session attacker can neither read it nor
  redirect it to another item; only `version` and `tags` are outside.
- **Kept values (0.21.0; owner decisions of 2026-10-08, §15 item 29).**
  So that editing an item never needs its values first (for a
  critical item one password entry, not a reveal followed by a
  replacement; for a secret item no `item.reveal` at all), an
  `item.put` that **replaces** an item, of any sensitivity, need not
  carry the values the member did not change. The content is the
  request's (`data`, `secret`) or the sealed `item` (`critical`, with
  `item_id` in the sealed payload):
  - A field that names a `field_id` of the item's current version and
    has no `value` **keeps its stored value**. Its `kind` MUST be the
    stored one (`bad_request` otherwise: the stored value was checked
    for that kind; to change a field's kind the app sends a value for
    it); its `label` and its position may change.
  - `keep_notes: true` keeps the stored notes. `notes` and
    `keep_notes` together are `bad_request`; with neither, the notes
    are removed, as before.
  - A field without `field_id` (a new field) needs a `value`, and so
    does every field of a new item (no `item_id`), where `keep_notes`
    is `bad_request`.
  - A field is removed by leaving it out of `fields`, as before
    (`fields` absent removes every field).
  - The rule is the same for every sensitivity. A `data` item's app
    holds its values from `item.get` and may send them all, as before;
    the rule only makes the three forms consistent.

  The vault takes the kept values from what it stores, checks the
  resulting item as any replacement (every value's shape, 64 fields,
  the size limit with the kept values counted) and stores it. For a
  `secret` item it reads them from DEK state: the edit is not a reveal,
  needs no `item.reveal` and no user-presence step in the app, and is
  recorded as `item.updated` only (a desktop's `item.put` still needs
  step-up, §6.8). For a `critical` item, within the same credential
  operation, it opens the stored values with the item's current key,
  takes the kept ones (a kept field without a stored value keeps `""`,
  or `{}` for an `address`, as `item.sensitivity` does), seals the
  result under a fresh key of the next generation with the AAD of the
  new field ids in their new order, as every critical `item.put` does,
  and wipes the plaintext. In every case no value leaves the vault:
  the response is unchanged and the change is recorded as
  `item.updated`, never `item.revealed`. Apps SHOULD edit `secret` and
  `critical` items this way (the edit form shows each stored value as
  kept, masked and not revealed, and sends a `value` only for a field
  the member typed into), and SHOULD NOT reveal an item only to open
  its edit form (a member who wants to see a value reveals it on
  purpose). The app learns the stored size from `item.get`'s `size`
  (below); the vault's `limit` (`item_size`, with `size`) remains the
  authority.
- **Size in `item.get` (0.21.0; owner decision of 2026-10-08, §15
  item 29).** `item.get` returns `size`, the item's size as defined
  above (Size), for every sensitivity, so that an app that does not
  hold the values (a `secret` or `critical` item) shows the room left
  before the limit. The vault records it whenever it writes the item's
  content (`item.put`, `item.sensitivity`, a tag change, a re-key) and
  whenever it opens a critical item's values (`item.reveal`, a use,
  §10.13); a critical item last written by an earlier release has no
  `size` until then. `size` is metadata of the member's own devices
  only: it is not part of the counted encoding, `item.list` does not
  return it, and it is never in a grant, a catalog, the profile or
  anything a connection or an agent receives.
- **Reading.** `item.get` never returns the values of `secret` or
  `critical` items: the member reveals them on purpose. `item.reveal` of
  a `secret` item returns them in the clear inside the session (the
  response is cached like any other, §8.2) and is recorded as
  `item.revealed`. `item.reveal` of a `critical` item opens the
  credential and returns the values sealed to the request's one-time
  reply key (§3.5.4) as `values_sealed`, whose plaintext is
  `{"fields": [{"field_id", "value"}], "notes"?}`; it is recorded as
  `item.revealed` and is a feed item.
- **Listing.** `item.list` returns items sorted by `item_id`, filtered by
  `tags` (1–16 tags, normalised as in §10.8; `match` `any`, the default,
  or `all`), `category` and `sensitivity`. `limit` is 1–500 (default
  100); the vault returns fewer items when the response would exceed
  131,072 bytes. `next` is present when more items match: the next call
  passes it as `after`.
- **Tags** change with `item.put` or `item.tag` (no password, for every
  sensitivity: tags are metadata). A tag change can include or withdraw
  the item in share rules (§10.12); the apps show the effect before
  saving, from a dry run.
- **Dry run (0.21.0; owner decision of 2026-10-08, §15 item 29).**
  `item.put` and `item.tag` take `dry_run: true`: the vault changes
  nothing and answers what the request would do to sharing.

  ```json
  { "version": 3,
    "shares":      [ { "rule_id": "<ULID>", "subject": { "connection_id": "<id>" }, "mode": "auto", "ask_rule_id": "<ULID>", "usable": true } ],
    "withdrawals": [ { "rule_id": "<ULID>", "subject": { "connection_id": "<id>" }, "state": "pending|included" } ] }
  ```

  `shares` lists the rules the item would **gain** (§10.12: with
  `mode` `ask` the member is asked, with `auto` it is included at
  once, unless the entry carries `ask_rule_id` (0.23.0): an `ask` rule
  of the same subject holds the item, so the member is asked, and the
  app says which rule asks, §10.12 Overlapping rules); `usable: true` marks a critical item, which a connection rule
  makes only usable (§10.13), and is absent otherwise. `withdrawals`
  lists the rules in which the item is pending or included and would
  stop matching. Both are sorted by `rule_id`, connection and agent
  rules alike (subject `{connection_id}` or `{agent_id}`), and empty
  when nothing changes; `version` is the item's current version,
  absent for a new item. The vault plans it as the real request would
  (the rules in force, `match`, earlier declines, items already
  pending), so apps MUST show this answer rather than compute the
  effect from `share.rule.list`.
  - `item.tag{item_id, version, tags, dry_run: true}` previews a re-tag
    of any item, of every sensitivity.
  - `item.put{dry_run: true, item_id?, version?, sensitivity?, tags?}`
    previews a save: without `item_id`, a new item of `sensitivity`
    (default `data`) with `tags` (`version` absent); with it, the item
    with the new `tags` (`tags` absent: no change, empty lists), and
    `version` is required with `item_id`, as in the real `item.put`
    (`bad_request` if only one of them is present; 0.21.1). Only tags and sensitivity
    decide sharing: the content members (`name`, `fields` and the
    others) MAY be present and are ignored; the critical form's
    `credential`, `utk_id` and `sealed` MUST be absent (`bad_request`),
    since a dry run never opens the credential; an existing critical
    item is named by `item_id` in the clear.
  - A dry run answers `bad_request` (tags, `@profile` on a non-`data`
    item), `not_found`, `conflict` (a stale `version`) and the sharing
    and profile limits the change would reach (`limit`:
    `share_pending`, `grants_given`, `profile_items`); it does not
    check the content. It is a read: nothing is recorded or sent, no
    `sync.event` follows.
  - **Desktops (0.21.1).** A dry run follows the access rule of the
    call it previews but never needs step-up, since it changes nothing:
    a desktop's dry run is answered at once, never held. So a desktop
    MAY dry-run `item.tag` of any item, a critical one included (its
    real `item.tag` is allowed with step-up), but a dry run of
    `item.put` for a critical item (named by `item_id`, or with
    `sensitivity: "critical"`) is `forbidden` from a desktop, since a
    critical `item.put` is app-only (above).
- **Deleting** an item withdraws it from every share rule and revokes its
  grants (§10.12). A critical item's values are removed from the
  credential.
- `credential.reset` (§3.5.5) and the vault's deletion (§12.5) delete every
  critical item.
- **Change notices.** `sync.event` `item.changed` (`item_id`, `version`)
  or `item.deleted` (`item_id`), never with values.
- **Audit and feed.** `item.added`, `item.updated` (content or tags),
  `item.deleted`, `item.sensitivity_changed`, `item.revealed`
  (`ref` = `item_id`); revealing a critical item is also a feed item
  (`item.revealed`).

### 10.8 Tags, profile and settings

**Tags.** One namespace of member-defined tags labels items and defines
sharing: a tag means nothing to connections or agents until a share rule
names it (§10.12; owner decision 2).

- **Normalisation.** The vault removes leading and trailing spaces, maps
  `A`–`Z` to `a`–`z` and replaces runs of spaces by one; the result MUST
  match `[a-z0-9][a-z0-9 _-]{0,31}` (`bad_request` otherwise). Tags are
  kept sorted, duplicates after normalisation merged.
- **Reserved tags** start with `@`. The only one is `@profile` (below);
  any other `@` tag is `bad_request`. Reserved tags cannot be named by a
  share rule, merged or deleted.
- **Tag names never leave the vault** in any message to a connection:
  connections see items (name, category, the field labels they may see),
  never tags or rules. The exception is an agent's own signed delegation
  (§10.11), which carries its rule's tags (owner decision of 2026-10-03,
  §10.11).
- **The registry** holds optional presentation per tag, versioned as one
  object (§10.1): `color` (`#rrggbb`), `icon` (`[a-z0-9_.-]{1,64}`, an app
  icon name) and `description` (at most 256 bytes); at most 512 entries
  (`limit`).

| Type | Request body | Response body |
|---|---|---|
| `tag.list` (app, desktop) | `{after?, limit?}` | `{version, tags: [{tag, color?, icon?, description?, items, rules: [<rule_id>]}], next?}` |
| `tag.set` (app, desktop) | `{version, tag, color?, icon?, description?}` | `{version}` |
| `tag.delete` (app; desktop: step-up) | `{version, tag, dry_run?}` | `{version, items}` |
| `tag.merge` (app; desktop: step-up) | `{version, from: [<tag>], into, dry_run?}` | `{version, items, rules, shares: [{rule_id, item_id, mode, ask_rule_id?}], shares_total}` (0.23.1: `ask_rule_id`) |

- `tag.list` lists every tag in the registry, on an item or named by a
  rule, sorted: `items` is the number of items carrying it, `rules` the
  share rules naming it (the apps show both on every tag). It is paged
  like `item.list`: `limit` 1–1,000 (default 500), at most 131,072 bytes,
  `next` (the last tag returned) to pass as `after`.
- `tag.set` creates or replaces a registry entry (members absent are
  cleared).
- `tag.delete` removes the tag from the registry and from every item. A
  tag named by a share rule is refused with `in_use`: removing it from
  the rule could widen what the rule shares.
- `tag.merge` (1–16 `from` tags; `into` new or existing) replaces each
  `from` tag by `into` on every item and in every share rule (duplicates
  removed); registry entries of `from` tags go, and `into` keeps its own
  entry or takes the first `from` tag's. A rename is a merge of one tag.
  Items that then newly match a rule are handled as re-tagged (§10.12);
  `shares` lists them, with the rule's `mode` (`ask`: asked, `auto`:
  included), within 131,072 bytes, and `shares_total` counts them. As in
  the dry runs of `item.put` and `item.tag` (§10.7), an `auto` entry
  carries `ask_rule_id` when an `ask` rule of the same subject holds the
  item, which then stays pending (§10.12 Overlapping rules; 0.23.1: a
  merge can leave an `auto` entry pending). A
  merge of a tag that an agent's rule names is refused with `in_use`:
  the rule's tags are in its signed delegation (§10.11), which only the
  member can sign again (`share.rule.set`).
- With `dry_run: true`, `tag.delete` and `tag.merge` change nothing and
  answer what they would do; `version` is then the current one.
- `tag.set`, `tag.delete` and `tag.merge` send one
  `sync.event{kind: "tag.changed", version}`; the items they change take
  new versions without `item.changed` notices. They are audited as
  `tag.changed` (`ref` = the new version).

**Profile.** What connections see of the member is the **shared
profile**: a fixed **core**, which the member cannot remove or edit as
part of the profile, and optional extras the member chooses (owner
decision 3; owner decisions of 2026-10-07, §15 item 26, 0.18.0):

- the core: `first_name` and `last_name`, the names of the member's
  VettID account from the vault's latest account snapshot (§11.13), and
  `ik`, the sending vault's current identity public key (§3.2);
- the extras: a display name, a photo, and the member's `data` items
  tagged **`@profile`**. Only the member adds that tag: no template
  suggests it (§10.7), and the vault never adds it.

The **profile object** holds the extras' display name and photo. Sent by
`app` or `desktop` (`profile.get` also by an agent it is delegated to,
§10.11). The names themselves change only through `account.name.set`
(below), never through the profile.

| Type | Request body | Response body |
|---|---|---|
| `profile.get` | `{}` | `{version, name?, photo?, first_name, last_name, ik}` |
| `profile.set` | `{version, name?, photo?}` | `{version}` |
| `profile.update` (V↔V) | — | `{version, first_name, last_name, ik, name?, photo?, items: [{item_id, name, category, fields: [{field_id, label, kind, value}]}]}` |

- `name`, the display name, is optional: at most 128 bytes, absent when
  the member has none (the default). `photo` is base64 of a JPEG or PNG
  image of at most 65,536 bytes. In `profile.set`, `""` removes either.
  The version rules of §10.1 apply to the profile object.
- **The core is read-only.** `first_name` and `last_name` are the
  snapshot's, byte for byte; `ik` is the standard base64 of the vault's
  current 32-byte identity public key. `profile.get` returns them. A
  `profile.set` naming `first_name`, `last_name` or `ik` is refused with
  `bad_request` (an exception to §10.1's ignored unknown members, so that
  an app cannot believe it changed them).
- **The shared profile** is the core, `name`, `photo` and every `data`
  item tagged `@profile`, sorted by `item_id`, with all of its fields
  (not its notes, tags or other members). At most 32 items carry
  `@profile`, and a `profile.update` body is at most 196,608 bytes: a
  change that would exceed either is refused with `limit`. The size is
  checked with **maximum-length names** (0.19.0; owner decision of
  2026-10-07, §15 item 27), not the current ones, whenever the display
  name, the photo or the `@profile` items change: the vault computes the
  body with `first_name` and `last_name` each counted as a JSON string
  of 322 bytes, quotes included, and refuses the change with `limit` if
  that body would exceed 196,608 bytes. The 322 bytes are the most a
  name can take: a vault accepts names of at most 160 bytes (§11.13; the
  name rule itself allows at most 120, 40 UTF-16 code units of at most 3
  UTF-8 bytes each), and it encodes a name as raw UTF-8 escaping only
  `"` and `\` (as `\"` and `\\`), since names contain no control
  characters, U+2028 or U+2029 (§11.13; the receiver's rule, below), so
  at most 2 × 160 bytes plus the 2 quotes. `ik` has a fixed size (44
  base64 characters). A later name change therefore never brings a
  `profile.update` over 196,608 bytes, and is never refused or held
  back for size (the member API has applied it already); receivers
  drop any body over 196,608 bytes as before.
- **The core is always there.** Every vault holds a snapshot with names
  from its enrollment on (the `enroll` queue message carries one, §11.5),
  and every `profile.update` and connection `hs.init` profile carries
  them. A vault MUST NOT send a `profile.update` or a connection
  `hs.init` without the complete core; should it ever lack names (which
  the enrollment rule excludes), it sends none and audits
  `profile.core_missing`, rather than an incomplete one. For
  `connection.invite.accept` (0.19.0) it then answers `internal` and
  sends no `hs.init` (§10.4), as it sends no `profile.update`.
- **When it is sent.** After a change of the profile object,
  `sync.event{kind: "profile.changed"}`. The vault sends `profile.update`
  to the peer when a connection becomes active (§9.3) and, whenever the
  shared profile changes, to every active connection (§9.3); its
  `version` is a counter of the shared profile, distinct from the
  profile object's, +1 per change. The shared profile changes when:
  1. the display name, the photo, or an `@profile` item's tag, name,
     category or fields change;
  2. the vault stores a snapshot (§11.13) whose `first_name` or
     `last_name` differ, byte for byte, from the ones it last sent (after
     an `account.name.set` the member API applied, or any other change of
     the account's names); a newer snapshot with the same names changes
     nothing;
  3. `ik` rotates (§3.4), in the order below.
- **After an `ik` rotation** the vault sends each peer the new
  `profile.update`, carrying the new `ik`, only after it has sent that
  peer the `identity.rotate` statement and the epoch it established with
  that peer under the new `ik` (the rekey of §3.4 step 3, or a reconnect,
  §6.6) is active, and it sends it in that epoch, never in an earlier
  one. A peer accepts that handshake only under the key that its pinned
  `ik` leads to through the rotation chain (§6.3, §6.6), so a peer that
  can open the update has already followed the rotation, and the
  update's `ik` equals the one it pinned. An update sent before the
  rotation carries an earlier `ik`; one that arrives after the peer
  followed the rotation is ignored (below, step 3), and the update sent
  after the rotation replaces it.
- **Receiving.** A receiver parses `profile.update` strictly (the field
  rules of §10.7; `first_name` and `last_name` strings of 1–160 bytes
  without control characters (C0, DEL, C1, U+2028, U+2029; DEL since
  0.21.0); `ik` the base64 of
  32 bytes) and then, in this order:
  1. ignores an update whose `version` is not higher than the one it
     keeps for that connection (§8.4);
  2. drops an update that lacks any of `first_name`, `last_name` and
     `ik`, or whose core members break the rules above, and audits
     `drop.profile_malformed` (`ref` = the `connection_id`);
  3. checks that `ik` equals, byte for byte, the connection's pinned `ik`
     (the `ik` of `connection.get`, as followed through `identity.rotate`,
     §3.4, §6.6). An update whose `ik` is an earlier key of that peer
     (an `old_ik` in the peer's rotation chain it stores, §3.4) was sent
     before a rotation it has since followed and is ignored without an
     audit entry. Any other mismatch: it drops the update and audits
     `drop.profile_ik_mismatch` (`ref` = the `connection_id`), keeps the
     profile it had and tells no device;
  4. keeps the update, shows it as the connection's `profile` (§10.4) and
     notifies its owner devices with `connection.event{event:
     "profile"}`.
  A dropped update changes nothing; the next valid one (a higher
  `version`) replaces the kept profile.
- **What apps show.** An app MUST title a connection as `first_name`, one
  space, `last_name`, from its `profile`, and show a non-empty display
  name, if it differs, as secondary text (the owner's own `alias`, §10.4,
  may replace the title on the owner's screens, the names still shown
  with it). Pending requests show the requester's names from its
  `hs.init` profile the same way (§6.2). In the short moment between a
  connection's activation and its first `profile.update`, the app titles
  it with the request's names if it has them (the inviter does) and
  otherwise shows a neutral placeholder, **"Name not shared yet"**; never
  a blank or "Unnamed connection". Connection details MUST show the
  **fingerprint** of the connection's pinned `ik`:

  ```
  fp = SHA-256("vettid/vms/2/ik-fp" || ik)    # ik: the 32 raw bytes
  ```

  shown as its first 16 bytes in lowercase hex, in 8 groups of 4 digits
  separated by spaces (vector in §16). It changes when the peer's `ik`
  rotates; apps show the new one without a warning when the rotation
  chain verified (§3.4), as they do for a credential-key rotation
  (§10.4). Names use Unicode bidirectional isolation wherever an app
  shows them next to other text.
- **What the names are.** `first_name` and `last_name` are the names the
  peer's member gave VettID at registration or later changed from the
  app (`account.name.set`), passed on by the peer's vault from VettID's
  snapshot. VettID does not verify them against any identity document.
  Apps MAY label them as the name on the peer's VettID account; they
  MUST NOT present them as verified, legal or checked (no "verified"
  badge or check mark, no "real name" or "ID-checked" wording), and MUST
  NOT suggest that VettID vouches for the person. The `ik` fingerprint
  identifies the peer's vault, the one the SAS was compared with (§6.3),
  not a person. The display name, the photo and the `@profile` items
  remain the peer's self-asserted data, and apps MUST present them as
  such.
- 0.7.0 removed the profile's own fields, `shared` and `order`: they are
  `@profile` items, and anything else reaches a connection only through
  share rules and grants (§10.12).

**Changing the account's names** (0.18.0; owner decisions of
2026-10-07: "only in the app"). The member changes `first_name` and
`last_name` only from the app, never on the account portal (which shows
them read-only). The vault verifies the member as an owner check does
and hands the request to its host, which records it for the member API;
the member API applies it and pushes the new snapshot, and only then do
connections see the new names.

| Type | Request body | Response body |
|---|---|---|
| `account.name.set` (app: the holder) | `{credential, utk_id, sealed{pin, password, first_name, last_name}}` | `{credential, version, utks, request: <name request>}`; `too_soon` (body `{allowed_after}`), `bad_request`, and the owner check's answers (§3.6.1: `bad_pin`, `bad_password`, `backoff`, `utk_invalid`, `stale_credential`, `credential_frozen`, `rotation_required`) |

```json
name request: { "seq": 3, "first_name": "Ada", "last_name": "King",
                "requested_at": "<ts>", "state": "pending|applied|refused",
                "reason": "too_soon|invalid|account" }
```

- **Names.** Each is trimmed of leading and trailing spaces (U+0020
  only, 0.19.0; no other white space is removed, so a name with any
  other at either end fails the pattern) and MUST
  match `^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$` with at most 40 characters
  counted as UTF-16 code units: the member API's registration rule
  (MEMBER-API `/api/public/request`), which the vault applies first so
  that the API rarely refuses (`bad_request` otherwise; also when both
  equal the current names).
- **The vault**, for the holder only (`forbidden` otherwise) and not
  while held (§3.6.3):
  1. spends the UTK and opens `sealed` (§3.5.4);
  2. answers `too_soon` with `{allowed_after}` while the stored
     snapshot's `name_change.allowed_after` (§11.13) lies in the future;
     nothing is counted;
  3. checks the names (above), answering `bad_request` before any PIN
     or password check (0.19.0), as `vault.owner-check` checks a hold
     change before the PIN is tried (§3.6.7): it is not a failed check,
     nothing is counted, the CEK does not rotate, and the app's blob
     stays current;
  4. checks the blob, the PIN and the password exactly as
     `vault.owner-check` does (§3.6.1 steps 3–7: the same backoffs,
     counts and audit entries), and on success rotates the CEK and
     returns the new `credential` (§3.5.3). Every refusal of the request
     comes before this step, so a rotated CEK is always answered with
     its `credential`;
  5. increments its name-request counter `seq` (DEK state, from 1),
     stores the request as `pending` (replacing one still pending), and
     emits the host event **`account_name`** `{seq, first_name,
     last_name}` (§11.5), handed to the parent with the flush that
     stored the request, as `app_key` is, and again with every
     `unlocked` report while the request is still `pending` (0.19.0,
     §11.5), so that an event lost after the flush is not lost for
     good;
  6. audits `account.name_requested` (`ref` = `seq`; no names) and
     answers with the request.
  A successful `account.name.set` is not an owner check: it does not
  move the deadline (§3.6.1).
- **The result** arrives in the account snapshot (§11.13), which the
  member API pushes after it has processed the request (MEMBER-API
  2.2.0): `name_change.last` names the `seq` and whether it was
  `applied` or `refused` (`reason`: `too_soon` within 30 days of the last
  applied change, `invalid` names, `account` an account that may not
  change them; present only with `refused`, §11.13). When a stored
  snapshot's `name_change.last.seq` equals the pending request's, the vault sets the request's `state` and
  `reason` from it and audits `account.name_applied` or
  `account.name_refused` (`ref` = `seq`); an applied change also brings
  the new names, which update every connection (above). A request still
  `pending` after a snapshot with a higher `last.seq` (which cannot
  happen with an honest host) is `refused` with `reason: "account"`.
  `account.get` (§10.2) returns the latest request as `name_request`;
  every state change sends `sync.event{kind: "account.changed"}`, whose
  `version` for a request change alone is the stored snapshot's,
  unchanged (0.19.0, §10.2).
- **What the app shows.** The account sheet shows the names read-only,
  with "Change name" (the PIN and password screen of the owner check,
  §3.6.5, with the two names), and says that every connection sees them.
  While `pending`: "Name change requested". `refused` with `too_soon`,
  or the vault's `too_soon`: "You can change your name once every 30
  days. You can change it again on <allowed_after>." `invalid`: the
  registration rule; `account`: "Your account cannot change its name
  right now".
- **Trust.** The host and the member API are VettID's, which holds the
  account's names anyway (§11.13): the vault path means that an honest
  VettID changes them only on a request the member approved with the PIN
  and the credential password, not on a phone's signature or a portal
  session alone. A dishonest host could still write the account's names
  directly, as before.

**Settings.** Owner policy, versioned as one object. Sent by `app` or
`desktop`.

| Type | Request body | Response body |
|---|---|---|
| `settings.get` | `{}` | `{version, settings: {<key>: <value>}}`, every known key with its current or default value, plus the `app.*` keys set |
| `settings.set` | `{version, set: {<key>: <value>}}` | `{version}` |

| Key | Value | Default |
|---|---|---|
| `connections.auto_approve_in_person` | boolean (§6.4) | `false` |
| `credential.backup` | boolean (§3.5.6); `false` means the vault cannot be recovered (§11.11, 0.16.0); a change is reported to the host as one bit (§11.5) | `true` |
| `credential.unlock_ttl_seconds` | integer 30–3,600 (§3.5.3) | 300 |
| `feed.retention_days` | integer 1–365 | 30 |
| `location.history.enabled` | boolean: keep the member's own location log (§10.16); turning it off deletes the log | `false` |
| `location.history.retention_days` | integer 1–365 | 30 |
| `location.history.interval_seconds` | integer 60–3,600: the log's cadence | 300 |
| `owner_check.interval_seconds` | integer 3,600–86,400: the longest time between owner checks (§3.6.2); app only (a desktop's `settings.set` naming it is `forbidden`); a shorter value applies at once, a longer one from the next check | 86,400 |
| `owner_check.hold` | boolean: whether the vault holds past the deadline (§3.6.7); holder only; `settings.set` may set it `true` (at once); `false` only in a successful `vault.owner-check` (`settings.set` answers `owner_check_required`) | `true` |
| `owner_check.hold_off_until` | RFC 3339 time at most 30 days ahead, or absent: when a hold turned off comes back on (§3.6.7); set only in a `vault.owner-check` with `hold: false`; cleared when the hold comes back on | — |
| `app.<name>` | string of at most 4,096 bytes, or `null` to remove; `<name>` matches `[a-z0-9_.-]{1,48}`; at most 64 | — |

`app.*` keys are opaque to the vault; apps use them for preferences that
follow the owner across devices. Unknown keys outside `app.*` are refused
with `bad_request`. Changes send `sync.event{kind: "settings.changed"}`.

### 10.9 Audit and feed

The vault keeps two records of what happened:

- the **audit log**, append-only and hash-chained, for security review;
- the **feed**, the owner's activity list, with read and archive state
  shared by the owner's devices.

Neither holds message text, item values, tags or keys. Both are DEK
state.
All types are sent by `app` or `desktop`, except `audit.export`, which
only the app (the holder) sends (History export, below).

**Audit.**

| Type | Request body | Response body |
|---|---|---|
| `audit.list` | `{connection_id?, kinds?: [<prefix>], q?, since?, until?, before_seq? \| after_seq?, limit?}` | `{entries: [<entry>], head, seq, next_before_seq? \| next_after_seq?, partial?}`; newest first, or oldest first with `after_seq`; `q`, `since`, `until` and `partial` since 0.20.0 (Search, below) |
| `connection.audit.list` | `{connection_id, kinds?, q?, since?, until?, before_seq? \| after_seq?, limit?}` | as `audit.list`, for one connection; `after_seq` as in `audit.list` (accepted by every release; stated in 0.21.0) |
| `audit.export` (app: the holder; 0.22.0) | `{format?, connection_id?, kinds?, q?, since?, until?, dry_run?, upto_seq?, utk_id?, sealed?}`; `format` (`csv` or `json`) is required except in a dry run; `sealed` is UTK-sealed `{pin}` (§3.5.4) | `{count, more, upto_seq, upto_hash, oldest_seq?, newest_seq?, oldest_at?, newest_at?}`; the export (not a dry run) also `entry_seq`; `bad_pin`, `backoff` (body `{retry_after}`), `utk_invalid`, `credential_frozen` and `rotation_required` (a clone alarm is open), `not_found` (nothing matches), `bad_request`, `forbidden`, `owner_check_required` (History export, below) |

```json
entry: { "entry_id": "<ULID>", "seq": 812, "at": "<ts>", "kind": "connection.added",
         "connection_id": "<id>?", "device_id": "<id>?", "ref": "<id>?",
         "direction": "in|out?", "prev": "<b64 32>", "hash": "<b64 32>" }
```

- `limit` is 1–500 (default 100). `kinds` holds 1–16 prefixes of at most
  64 bytes; an entry matches if its `kind` equals a prefix or starts with
  the prefix followed by `.`.
- **Search (0.20.0, owner decision of 2026-10-07, §15 item 28).** The
  vault filters the log itself, so that an app need not download it to
  find an entry. An entry is returned when it passes every filter the
  request names:
  - `connection_id` and `kinds`, as above;
  - `since` and `until`: RFC 3339 times (any offset, compared in Unix
    milliseconds, as `at_ms` below); an entry matches if `since` ≤ `at`
    (inclusive) and `at` < `until` (exclusive). Either may be given
    alone. The vault does not assume that `at` grows with `seq` (the
    enclave clock may step back); the range is a filter, not a cursor;
  - `q`: a case-insensitive substring of the entry's **search text**.
    `q` is a string of 1–128 bytes of UTF-8 without control characters
    (C0, DEL, C1) and not only white space. The search text is the
    following fields, each matched separately (a match never spans two
    fields):
    1. the `kind`, and the `kind` with each `.`, `_` and `-` replaced by
       a space (so `password changed` finds
       `credential.password_changed`);
    2. for an entry with `connection_id`, that connection's current
       `name`, `alias`, and its shared profile's `first_name`,
       `last_name` and display name (§10.8; the same values
       `connection.list` returns), and the two names joined by one
       space ("First Last");
    3. for an entry with `device_id`, that device's current `name`
       (`device.list`, §10.3), app, desktop or agent;
    4. for an entry whose `ref` is an `item_id` (`item.added`,
       `item.updated`, `item.deleted`, `item.sensitivity_changed`,
       `item.revealed`, `share.included`, `share.declined`,
       `share.withdrawn`, and `wallet.created`, `wallet.deleted` and
       `wallet.address_issued`, whose `wallet_id` is the item's), that
       item's current `name` (§10.7), also for a critical item, whose
       name is DEK-state metadata.
    Names are those the vault holds **when it answers**: a connection,
    device or item that has been removed, unlinked or deleted (or a
    `connection_id` of a pending request) adds no text, and the entry
    is then found by its kind only. The search never reads field
    labels or values, message text, tags, notes, keys, the account
    snapshot or anything else; the entry itself is unchanged, and so
    is its `hash`. **Comparison:** the vault maps `q` and each field
    through Go's `strings.ToLower` (Unicode simple lower-case mapping,
    per rune; no locale rules) and tests `strings.Contains`. It does
    not normalise Unicode (the enclave carries no normalisation
    tables): apps send `q` in NFC, as they send names, so composed
    characters match. An empty field never matches.
- **Scan budget (0.20.0).** Without `q`, a request examines the log as
  before (at most 10,000 entries). With `q`, the vault evaluates `q` for
  at most **2,000** entries per request: the entries in the request's
  order that pass the other filters (`connection_id`, `kinds`,
  `since`, `until`, the cursor). The budget **runs out** when a
  2,001st such entry would have to be evaluated (0.21.0, stating what
  every 0.20.0 vault does): a request whose entries passing the other
  filters end by the 2,000th evaluated one, or that found `limit`
  matches by then, is not `partial`. If that budget runs out before
  `limit` entries matched, the vault answers with the matches it found
  (possibly none), `partial: true`, and `next_before_seq` (or
  `next_after_seq`) = the `seq` of the last entry it evaluated; the app
  continues with that cursor (it is exclusive, as every cursor). A
  response without a `next_*` cursor is the end of the results.
  `partial` is absent otherwise. The cursors and `limit` are unchanged
  otherwise: with `limit` matches found and more entries left, the
  cursor is the `seq` of the last entry returned.
- **Errors:** `bad_request` for a `q` that is empty, longer than 128
  bytes, not UTF-8, only white space or with a control character; a
  `since` or `until` that is not an RFC 3339 time; `since` ≥ `until`,
  compared in Unix milliseconds (each time truncated to the
  millisecond, as `at` is compared; two times within one millisecond,
  in any offsets, are equal and refused; stated in 0.21.0);
  and, as before, a bad `kinds`, `limit` or cursor, or both cursors.
  `connection.audit.list` takes the same `q`, `since` and `until`, with
  the same rules, for its one connection. Both types stay `app` and
  `desktop` only (above); agents and connections never read the audit
  log (§13.7).
- `seq` starts at 1 and increases by one per entry. `hash` chains the log:

  ```
  hash = SHA-256("vettid/vms/2/audit" || prev || uint64be(seq) || uint64be(at_ms)
                 || lp(kind) || lp(connection_id) || lp(device_id) || lp(ref) || lp(direction))
  ```

  where `lp(x)` is the 2-byte big-endian length of `x` followed by its
  bytes (absent members are empty), `at_ms` is `at` in Unix milliseconds,
  and `prev` is the previous entry's `hash` (32 zero bytes for `seq` 1).
  `head` is the newest entry's `hash`. An app can check that the entries
  it receives chain, and that `head` only moves forward.
- **The log is append-only.** No type changes or deletes an entry, and
  no principal can shorten it: entries are dropped only by the fixed
  retention, 730 days or 10,000 entries, whichever comes first. The oldest
  kept entry's `prev` is the hash of the last dropped one, so the chain
  still links.
- **Tampering and rollback are detectable.** The log is part of DEK
  state, so its integrity rests on the state's AEAD and its freshness on
  `state_seq` (§13.2): a rolled-back log is a rolled-back state. Apps
  additionally anchor it: an app keeps the highest (`seq`, `head`) it has
  verified and, with `after_seq` = that `seq`, checks that the next
  entries chain from that `head`. A log that does not extend the anchor
  MUST be reported to the member as tampered. `seq` in the response is the
  newest entry's.
- **Drop entries are bounded.** At most 60 `drop.*` entries per kind and
  principal per hour; the 61st is written once as `drop.suppressed` with
  `ref` = the suppressed kind. A peer cannot flood the log out.
- Kinds: `vault.unlocked` (`device_id` = the app whose unlock, §11.4,
  opened the vault, also the confirming unlock at a move's new release
  and an abandonment, §11.10.4; absent for an app that has no device
  record yet, the first app before its enrollment handshake, §11.3, or
  a recovered app before its handshake, §11.11.5; 0.23.2),
  `vault.locked` (`device_id` = the app or desktop whose `vault.lock`,
  §10.2, locked the vault; absent for every other lock, §12.3: the
  account site's lock route, ten failed owner checks, a recovery,
  memory pressure, a lease loss, a restart, 0.23.2); `device.paired`,
  `device.unlinked`; `connection.added`, `connection.removed`,
  `connection.stale`, `connection.reconnected`; `identity.rotated`;
  `credential.created`, `credential.rotated`, `credential.password_changed`,
  `credential.password_failed`, `credential.unlocked`;
  `credential.recovered`; `credential.clone_detected` (`ref` =
  `alarm_id`, `device_id` = the presenter), `credential.alarm.confirmed`
  (`ref` = `<alarm_id>:mine` or `<alarm_id>:not_mine`),
  `credential.alarm.resolved` (`ref` = `alarm_id`), `credential.reset`
  (§3.5.9, §11.11.5); `vault.pin_failed` (a wrong PIN at a transfer's
  approval, §6.7.1, or in an owner check, §3.6.1);
  `owner_check.passed` (`device_id` = the app), `owner_check.held`
  (no `device_id`: the vault holds itself), `owner_check.failed`
  (`ref` = `pin` or `password`), `owner_check.locked` (`ref` = the count
  of consecutive failed checks), `owner_check.hold_changed` (`ref` =
  `on`, `off`, `off_until:<ts>` or `on:expired`) (§3.6, 0.13.0); `device.transfer.started`,
  `device.transfer.approved`, `device.transferred`,
  `device.transfer.aborted`, `device.transfer.attestation_failed`
  (`ref` = `transfer_id`), `device.replaced` (`device_id` = the old app a
  recovery removed) (§6.7.1, §11.11.5); `item.added`, `item.updated`, `item.deleted`,
  `item.sensitivity_changed`, `item.revealed` (`ref` = `item_id`),
  `tag.changed` (`ref` = the registry's new version) (§10.7, §10.8);
  `settings.changed` (`ref` = the new version); `account.name_requested`,
  `account.name_applied`, `account.name_refused` (`ref` = the request's
  `seq`; no names), `profile.core_missing` (§10.8, 0.18.0);
  `recovery.requested`, `recovery.replaced`, `recovery.bad_code`,
  `recovery.attestation_failed`, `recovery.registered`,
  `recovery.device_paired`, `recovery.completed`, `recovery.cancelled`,
  `recovery.expired`, `recovery.voided` (§11.11.6); `message.sent`,
  `message.received` (no content; `ref` = `message_id`);
  `connection.blocked`, `connection.unblocked` (`ref` = `block_id`);
  `connection.request.peer_declined` (`ref` = `pending_id` or the
  outgoing request's `connection_id`; for a decline that reaches an
  active connection, the `connection_id`, 0.10.6; §6.4, 0.10.5);
  `connection.authenticate.requested`, `connection.authenticate.signed`,
  `connection.authenticate.denied`, `connection.authenticated`,
  `connection.authenticate_failed` (`ref` = `request_id`);
  `device.session.granted`, `device.session.ended`, `approval.granted`,
  `approval.denied` (`ref` = `approval_id`) (§6.8);
  `connection.authenticate.key_rotated`,
  `connection.authenticate.rotation_rejected` (§10.4);
  `connection.asks_paused`, `connection.asks_resumed`,
  `connection.asks_muted`, `connection.asks_unmuted` (`connection_id`;
  §10.4.1, 0.23.0); `call.outgoing`,
  `call.incoming`, `call.answered`, `call.ended` (`ref` = `call_id`, no
  SDP or keys) (§10.10); `leash.grant.issued`, `leash.grant.updated`,
  `leash.grant.revoked`, `leash.rate_limited` (`device_id` = the agent,
  `ref` = `grant_id`), `leash.agent.suspended`, `leash.agent.resumed`,
  `leash.referrals_limited`, and, summarised per agent and hour,
  `leash.allowed`, `leash.refused`, `leash.item.read`,
  `leash.item.used` and `leash.throttled` with their `<kind>.summary`
  entries (`ref` = the count) (§10.11); `grant.requested`,
  `grant.denied` (`ref` = `request_id`), `grant.issued`,
  `grant.received`, `grant.fetched`, `grant.revoked` (`ref` = `grant_id`)
  (§10.12); `share.rule.created`, `share.rule.updated`,
  `share.rule.deleted` (`ref` = `rule_id`), `share.included`,
  `share.declined`, `share.withdrawn` (`ref` = `item_id`, with the
  subject's `connection_id` or `device_id`) (§10.12);
  `critical-secret.use.requested`, `critical-secret.used`,
  `critical-secret.use.denied`, `critical-secret.use.result`
  (`ref` = `request_id`) (§10.13); `action.configured`
  (`ref` = `action_id`), `action.invoked`, `action.approved`,
  `action.denied`, `action.completed` (`ref` = `invocation_id`)
  (§10.14); `intro.created`, `intro.offered`, `intro.accepted`,
  `intro.declined`, `intro.connecting`, `intro.closed`
  (`ref` = `intro_id`) (§10.15); `location.share.started`,
  `location.share.stopped`, `location.share.received`,
  `location.share.ended`, `location.requested` (`ref` = `share_id` or
  `request_id`), `location.history.deleted` (`ref` = the number
  deleted), `location.history.shared`, `location.history.received`
  (`ref` = `share_id`) (§10.16); `wallet.created`, `wallet.deleted`,
  `wallet.address_issued` (`ref` = `wallet_id`), `wallet.signed`
  (`ref` = `txid`) (§10.18); `audit.exported` (`device_id` = the app,
  `ref` = the export summary; History export, below, 0.22.0);
  `drop.suppressed`;
  and `drop.<reason>` for every message the vault dropped
  or refused (§6.3, §6.6, §7.3, §8.4), with the runtime's reason, such as
  `drop.rate_limited`, `drop.one_app` (§6.7), the suppressed asks
  `drop.ask_muted`, `drop.ask_paused`, `drop.ask_cooldown`,
  `drop.ask_pending` and `drop.ask_rate` (§10.4.1, 0.23.0), `drop.profile_ik_mismatch`
  and `drop.profile_malformed` (§10.8, 0.18.0) or `drop.owner_check`
  (§3.6.3).

**History export** (0.22.0; owner decisions of 2026-10-08, §15 item
30). The member may save the entries History shows to a file, as CSV or
JSON, from the app. It is a **deliberate exception** to the decision of
2026-10-03 that there is no backup or export of vault data out of the
service (§3.5.6, §10.16; VAULT-PLAN §4, VAULT-RELEASES §11,
ANDROID-PLAN §4), and it is limited to **activity metadata**: the audit
entries as the app shows them (time, kind, direction, the names of the
connection, device and item an entry refers to, the identifiers and the
chain fields). An export never holds an item's value, field label,
notes or tags, a secret, message text, credential material, a key, the
account snapshot or its email, or anything else the audit log does not
hold. It is not a backup: nothing can be imported or restored from it,
and the credential, the location log and every other part of the vault
stay without an export.

- **`audit.export` is the holder's only** (§3.5.9): a desktop's request
  is answered `forbidden` at once, never held for approval (§6.8), and
  any other device, including a recovering app, is answered
  `forbidden`. It is not delegable (§10.11). While the app is gated
  (§3.6.3) it is answered `owner_check_required`, as History is gated.
  While a clone alarm is open (§3.5.9) it is refused, the preview
  included, with the alarm's freeze code, `credential_frozen` or
  `rotation_required`, without spending the UTK, as credential
  operations are (owner decision of 2026-10-08): after the §3.6.3 gate
  and the holder check, before the rest (Order of checks, below;
  0.23.0 corrects 0.22.0's "before anything else").
  Desktops keep reading the log with `audit.list` but MUST NOT offer an
  export in this version; an export from a desktop, with step-up, is
  left for a later version (§15 item 30).
- **The filters** are those of `audit.list`, with the same forms and
  `bad_request` rules: `connection_id`, `kinds`, `q`, `since`, `until`
  (no cursor and no `limit`). An export covers the entries that pass
  every filter, **newest first**, at most **10,000** (the export cap);
  `more: true` says that more entries match than the cap. (The log
  keeps at most 10,000 entries, so the cap is reached only by an
  unfiltered export of a full log and `more` stays false today; it
  holds if the retention changes.) `audit.export` evaluates `q` over
  the whole log in one request, without the 2,000-entry scan budget of
  `audit.list`: the log has at most 10,000 entries, and a count must be
  exact.
- **Two steps.**
  1. **The preview**, `dry_run: true`, without `utk_id`, `sealed` or
     `upto_seq` (`bad_request` with any of them; `format` is optional
     and, if present, checked): the vault counts the
     entries that match and answers `count` (0–10,000), `more`,
     `upto_seq` (the newest entry's `seq`, which bounds the export) and
     its `upto_hash`, and, when `count` > 0, `oldest_seq`, `newest_seq`
     and their `oldest_at`, `newest_at` (the `at` of those entries;
     `at` need not grow with `seq`, §10.9 Search). On an empty log
     (0.23.0) `upto_seq` is 0 and `upto_hash` is 32 zero bytes, as
     `audit.list`'s `head` and `seq` are then, and `count` is 0; an
     export can then only be `bad_request` (`upto_seq` ≥ 1 is
     required). It needs no PIN,
     spends nothing and writes no audit entry: it reveals no more than
     `audit.list`. The app shows the count and the range before the
     member confirms.
  2. **The export**, with the same filters and `format`, `upto_seq` from
     the preview, `utk_id` and `sealed` = `{pin}` sealed to that UTK
     (§3.5.4; the PIN is 6–32 ASCII digits, §11.3). The vault:
     1. refuses with `credential_frozen` or `rotation_required` while
        a clone alarm is open (above; the UTK is not spent), and with
        `bad_request` a request without a spendable UTK (below; the
        UTK is not spent), then spends the UTK and opens `sealed`
        (`utk_invalid`); the payload holds `pin` only;
     2. checks the request: `bad_request` for a bad filter, a
        `format` other than `csv` or `json`, a PIN that is not 6–32
        digits, or an `upto_seq` that is not an integer ≥ 1 and at most
        the newest entry's `seq`;
     3. counts the entries that match with `seq` ≤ `upto_seq` and
        answers `not_found` if there are none (the preview said so;
        nothing is counted against the member);
     4. refuses with `backoff` while the PIN backoff of §11.8 runs,
        with `retry_after` (§10.1);
     5. **checks the PIN** as an owner check does (§3.6.1 step 5): it
        derives the DEK from `pin` and compares it with the DEK in
        memory in constant time. A mismatch is `bad_pin`, counted in
        the §11.8 backoff (`header_seq` + 1) and audited
        `vault.pin_failed`, as a wrong PIN at an unlock is bounded. It
        is **not** a failed owner check (owner decision of 2026-10-08):
        it does not count in `failures` toward the lock of §3.6.4 and
        writes no `owner_check.failed` entry or feed item;
     6. on success, in one flush: resets the §11.8 backoff if it counted
        failures (a header write, as a successful check does); appends
        `audit.exported` (below); and answers as the preview, for the
        entries with `seq` ≤ `upto_seq`, with `entry_seq` = the `seq`
        of the `audit.exported` entry.
  A successful export is not an owner check: it moves no deadline and
  resets no `failures` (§3.6.1). It is not a credential operation: no
  password, no CEK rotation, no new blob. Its response adds no UTKs;
  the app tops its pool up with `credential.utk.get` (§3.5.4).
- **Order of checks** (0.23.0, errata to 0.22.0 from its
  implementation, vettid-vault #50; owner decision of 2026-10-09, §15
  item 31). The vault answers the first that applies:
  1. the common gates: a vault without a credential
     (`credential_required`, §3.5.7), then the daily owner check
     (`owner_check_required` while the app, or with the hold every owner
     device, is gated, §3.6.3; a recovering app is not gated there);
  2. the sender: a desktop or an agent (`forbidden`, the registry's
     access rule), then a recovering app or an app that is not the
     holder (`forbidden`, §3.5.9's holder check);
  3. the clone alarm: `credential_frozen` or `rotation_required` while
     one is open, the preview included;
  4. the members that decide what is spent: a body that is not a JSON
     object, a `dry_run` that is not a boolean, a preview with
     `utk_id`, `sealed` or `upto_seq`, or an export whose `utk_id` or
     `sealed` is absent or malformed: `bad_request` at once. Without a
     readable `utk_id` and `sealed` there is no UTK to spend, so the
     answer cannot wait for the spend;
  5. a preview: the other shape checks (the filters, a cursor or `limit`, and `format`,
     `bad_request`), then the answer;
  6. an export: the export's steps 1 (the spend, `utk_invalid`) to 6
     above, in that order; the other shape checks (the export's step 2)
     come after the spend, as 0.22.0 specified, so a malformed filter or
     `format` costs the UTK.
  Nothing before point 6 spends the UTK, writes an audit entry or
  counts in a backoff.
- **The entries.** The app then reads them with `audit.list`, with the
  same filters, `before_seq` = `upto_seq` + 1 for the first page and
  `next_before_seq` after it, and keeps the first `count` entries it
  receives (following `partial` pages, §10.9 Scan budget). The response
  does not carry the entries: 10,000 entries of up to a few hundred
  bytes each are megabytes, far beyond the 245,760-byte inner
  plaintext of §5.5, and a vault-uploaded claim-check blob would be a
  new mechanism for data the app may read anyway. Paging reuses
  `audit.list` unchanged; the app SHOULD use `limit` 100 (the default),
  so that each page stays well under the 64 KiB claim-check threshold
  (§5.5); 10,000 entries are then 100 requests. `upto_seq` keeps the
  export to what the member confirmed: entries written meanwhile,
  `audit.exported` among them, are newer and not included. The
  retention (above) may drop the oldest entries while the app reads; it
  then receives fewer than `count` and says so in the file and on the
  screen (ANDROID-PLAN §4).
- **What the PIN is for.** `audit.list` is open to the app and desktops
  without a PIN, so the vault cannot stop a device that can read the
  log from writing it down. The PIN step makes the export a deliberate
  act of the member, bounded by the PIN backoffs, and the
  `audit.exported` entry records it in the tamper-evident log. The app
  MUST NOT write an export file without a successful `audit.export`
  answer for that export, and MUST include only the entries with
  `seq` ≤ its `upto_seq` that match its filters.
- **`audit.exported`** (`device_id` = the app, no `connection_id`,
  `ref` = the export summary): `ref` is `;`-separated `key=value`
  pairs in this order, the optional ones only when present:
  `format=<csv|json>;count=<n>;seqs=<oldest_seq>-<newest_seq>;filters=<f>`
  then `;since=<t>` and `;until=<t>`, where `<f>` is `none` or the
  filters the request named, comma-separated in the order
  `connection,kinds,q,dates`, and `<t>` is `since` or `until` as UTC in
  the `ts` format (§5.3). Example:
  `format=json;count=812;seqs=1-812;filters=none`, or
  `format=csv;count=40;seqs=700-790;filters=kinds,dates;since=2026-10-01T04:00:00.000Z;until=2026-10-08T04:00:00.000Z`.
  The summary names no connection, kind prefix or search text: the
  entry fields are fixed by the hash (above), and the log holds no
  names. Its `count`, `seqs` and times are those the vault answered.
- **The file** is written by the app, never by the vault, and is **not
  encrypted**. The app saves it only where the member chooses, through
  the platform's own "Save to…" dialog (on Android the Storage Access
  Framework, `ACTION_CREATE_DOCUMENT`); it never writes it to shared
  storage or the gallery on its own, never uploads it, and never hands
  it to another app (no share sheet). Before saving it tells the member
  that the file is unencrypted and that anyone who gets it can read
  it. The file name is `vettid-history-<YYYYMMDD>-<HHMMSS>.<csv|json>`
  (UTC, the time of the export), without a name or an email. Both
  formats carry the same entries, newest first; for each entry:
  - `seq`, `entry_id`, `at` (verbatim from the vault: ISO 8601 / RFC
    3339 UTC with milliseconds, the `ts` format), `kind`, `direction`;
  - the app's `label` for the kind and its History `category` (the
    category's identifier, ANDROID-PLAN §4), as History shows them;
  - for an entry with `connection_id`, the connection's name as History
    shows it ("First Last", or "Removed connection"); with `device_id`,
    the device's name ("Removed device"); with an item's `item_id` as
    `ref` (§10.9 Search point 4), the item's name ("Deleted item"),
    also for a critical item, whose name is metadata;
  - `ref`, and, in JSON, the `connection_id`, `device_id`, `prev` and
    `hash` that the hash covers.
- **JSON** (`application/json`, UTF-8 without a byte order mark, one
  object, RFC 8259):

  ```json
  { "format": "vettid-history", "format_version": 1,
    "exported_at": "2026-10-08T14:03:12.511Z",
    "filters": { "category": "security", "kinds": ["credential", "identity", "recovery", "audit"],
                 "connection_id": "<id>?", "connection_name": "First Last?",
                 "q": "...?", "since": "<RFC 3339>?", "until": "<RFC 3339>?" },
    "count": 40, "more": false, "authorised_count": 40,
    "oldest_seq": 700, "newest_seq": 790,
    "log_head": { "seq": 812, "hash": "<b64 32>" },
    "entries": [
      { "seq": 790, "entry_id": "<ULID>", "at": "<ts>", "kind": "credential.rotated",
        "label": "Credential rotated", "category": "security",
        "direction": "in|out?", "connection_id": "<id>?", "connection_name": "...?",
        "device_id": "<id>?", "device_name": "...?", "ref": "<ref>?", "item_name": "...?",
        "prev": "<b64 32>", "hash": "<b64 32>" } ] }
  ```

  `exported_at` is the time of the vault's answer (`ts` of the
  `audit.export` response); `filters` holds only the filters used
  (`{}` for none), `since` and `until` as sent; `count` is the number
  of `entries`, `authorised_count` the vault's `count` (they differ
  only when the retention dropped entries, above); `log_head` is
  `upto_seq` and `upto_hash`. Optional members are absent, not `null`.
  The header carries nothing that identifies the vault, the account or
  the device: no `vault_id`, `user_guid`, email or app key.
  **Checking an export against the log:** each entry's `hash` can be
  recomputed from its own `prev`, `seq`, `at`, `kind`, `connection_id`,
  `device_id`, `ref` and `direction` (§10.9; `at_ms` from `at`); where
  two entries have consecutive `seq`, the newer one's `prev` is the
  older one's `hash`, so an unfiltered export is one chain ending at
  `log_head`; and the vault's later `audit.list` from `after_seq` =
  `log_head.seq` must chain from `log_head.hash` (§10.9 anchors). Names,
  labels and categories are the app's rendering at export time and are
  not covered by the hash.
- **CSV** (`text/csv; charset=utf-8; header=present`, RFC 4180: CRLF
  line ends, every field that contains a comma, a double quote, CR or
  LF enclosed in double quotes with inner quotes doubled; UTF-8 with a
  byte order mark, so that spreadsheets read non-ASCII names). A header
  row, then one row per entry, with the columns, in this order:
  `seq,time,category,event,kind,direction,connection,device,item,ref,hash`,
  where `time` is `at`, `event` the label, `connection`, `device` and
  `item` the names, and `hash` the entry's hash in lowercase hex (64
  digits). Absent values are empty fields. The CSV carries no
  `prev`, `entry_id` or identifiers other than `ref`: it is for reading;
  the JSON is for checking. **Formula injection:** a field whose first
  character is `=`, `+`, `-`, `@`, a tab (U+0009) or CR (U+000D) is
  written with an apostrophe (`'`) before it, inside the quoting
  (OWASP CSV injection). This changes only such text fields (names,
  labels and a `ref` starting so); `seq`, `time`, `kind` and the hex
  `hash` never start with them.

**Feed.**

| Type | Request body | Response body |
|---|---|---|
| `feed.list` | `{status?, after_seq?, limit?}` | `{items: [<item>], seq}` |
| `feed.get` | `{item_id}` | `<item>` |
| `feed.update` | `{item_id, status?, priority?}` | `<item>` |
| `feed.delete` | `{item_id}` | `{}` |
| `feed.event` (V→D) | — | `<item>`, for each new item, to apps and desktops |
| `guide.sync` | `{guides: [{guide_id, version, title, message, priority?}]}` | `{created, updated}` |

```json
item: { "item_id": "<ULID>", "seq": 41, "kind": "connection.request", "at": "<ts>",
        "status": "active|read|archived|deleted", "priority": "low|normal|high|urgent",
        "connection_id": "<id>?", "device_id": "<id>?", "ref": "<id>?", "count": 3,
        "title": "...?", "body": "...?" }
```

- `seq` is the vault's feed counter; an item takes a new `seq` at every
  change. `feed.list` without `after_seq` returns the items that are not
  deleted, newest first, filtered by `status` (`active`, `read`,
  `archived` or `all`, the default); with `after_seq` it returns every
  item changed after it, in `seq` order, including deleted ones (without
  `title` and `body`), so that a device can catch up. The response `seq`
  is the current counter. `limit` is 1–500 (default 100).
- `count` (0.23.0) is present, from 2, only on the feed item of a batch
  of a connection's asks: the number of asks it stands for (§10.4.1).
- `feed.update` sets `status` (`active`, `read` or `archived`) and/or
  `priority`; changes send `sync.event` `feed.updated` or `feed.deleted`.
- Kinds the vault creates: `connection.request` (`ref` = `pending_id`),
  `connection.request.peer_declined` (`ref` = `pending_id` or
  `connection_id`, the latter always after activation; 0.10.5, 0.10.6), `connection.added`, `connection.removed`, `connection.stale`,
  `device.pair.pending`, `device.paired`, `device.unlinked`,
  `message.received` (`ref` = `message_id`), `credential.password_failed`,
  `item.revealed` (`ref` = `item_id`; critical items), `credential.rotated`,
  `device.session.pending` (`ref` = `request_id`), `approval.pending`
  (`ref` = `approval_id`), `connection.authenticate.requested`
  (`ref` = `request_id`), `call.missed` (`ref` = `call_id`),
  `leash.rate_limited` (`ref` = `grant_id`), `leash.item.read`
  (`ref` = `item_id`; the first per agent and hour),
  `leash.agent.suspended`, `leash.referrals_limited`, `grant.request`
  (`ref` = `request_id`),
  `grant.revoked`, `grant.shared` (`ref` = `grant_id`), `share.pending`
  (`ref` = `rule_id`), `share.rate_limited` (`ref` = `rule_id`; at most
  one per rule per 24 hours; §10.12, 0.23.0), `critical-secret.use.request`
  (`ref` = `request_id`), `action.request` (`ref` = `invocation_id`),
  `intro.request` (`ref` = `intro_id`), `location.shared`
  (`ref` = `share_id`), `location.request` (`ref` = `request_id`),
  `wallet.signed` (`ref` = `txid`), `credential.alarm` (priority
  `urgent`, `ref` = `alarm_id`), `device.transferred` (`ref` =
  `transfer_id`), `device.replaced` (`device_id` = the old app),
  `credential.reset`, `owner_check.failed` (priority `high`, `ref` =
  `pin` or `password`), `connection.asks_paused` (priority `high`;
  §10.4.1, 0.23.0), `owner_check.locked` (priority `urgent`)
  (§3.6.4), `owner_check.hold_changed` (priority `high`, `ref` as in the
  audit log) (§3.6.7, 0.13.0),
  and `guide`. Apps render
  items from `kind` and the references; only `guide` items carry `title`
  and `body`.
- Items older than `feed.retention_days` are dropped, and the feed keeps at
  most 1,000 items.
- **Guides.** The app owns its catalog of welcome and tutorial guides.
  `guide.sync` creates a `guide` feed item for each `guide_id` the vault
  has not seen, and a new item for a higher `version` (so that read state
  is shared across devices); the same or a lower version is a no-op.
  `guide_id` matches `[a-z0-9_.-]{1,64}`, `version` is 1–2^31, `title` at
  most 256 bytes, `message` at most 4,096, `priority` as for items
  (default `normal`); at most 64 guides per request.

### 10.10 Calls

1:1 voice and video calls between connections (CALLING-SERVICE). Signalling
travels over the relay inside the E2E sessions: device → its vault →
the peer vault → the peer's devices. Media flows directly or through TURN,
end-to-end encrypted under `k_call`, which only the two devices of the
call hold. Sent by `app` or `desktop` devices, and by connections where
marked; never by agents. A vault takes part in at most one call at a time.

**Devices.** An app, or a desktop within its access session (§6.8), places
and answers calls, each with its own key exchange. The access session is
the authorization: call types are not step-up types, and placing or
answering a call needs no per-call approval. A desktop without a session
is not rung (§9.1) and its `call.start` is answered `session_required`.
Agents never place or take calls.

**No handoff.** A call stays on the device that placed or answered it for
its whole life. There is no handoff or transfer between devices, and no
message for one: to switch devices the member ends the call and starts a
new one on the other device.

| Type | Request body | Response / event body |
|---|---|---|
| `call.start` (D→V) | `{connection_id, call_id, media: "audio" \| "video", sdp, ek, ek_sig}` | `{call_id, exp, ice_config, ice_sig}`; `busy`, `exists`, `not_found`, `connection_unavailable`, `bad_request` (also for a share signature that does not verify) |
| `call.offer` (V↔V, with `exp`) | — | `{call_id, media, sdp, ek, device_ik, device_sig, vault_sig}` |
| `call.offer` (V→D, with `exp`) | — | `{call_id, connection_id, media, sdp, ek, device_ik, device_sig, vault_sig, peer_ik, exp, ice_config, ice_sig}` |
| `call.ringing` (D→V, V↔V, V→D; ephemeral) | — | `{call_id}` |
| `call.answer` (D→V) | — | `{call_id, sdp, enc, enc_sig}` |
| `call.answer` (V↔V) | — | `{call_id, sdp, enc, device_ik, device_sig, vault_sig}` |
| `call.answer` (V→D) | — | `{call_id, sdp, enc, device_ik, device_sig, vault_sig, peer_ik}` |
| `call.ice` (D→V, V↔V, V→D; ephemeral) | — | `{call_id, candidates: [{candidate, sdp_mid?, sdp_mline_index?}]}` |
| `call.end` (D→V, V↔V, V→D) | — | `{call_id, reason}` |
| `call.list` (D→V) | `{limit?}` (1–200, default 50) | `{calls: [{call_id, connection_id, direction: "in" \| "out", media, state, reason?, started_at, answered_at?, ended_at?}]}`, newest first |

- `call_id` is a ULID chosen by the calling device (it is signed into the
  share before the vault sees it); the vault refuses one already in use
  (`exists`). `media` (`audio` or `video`) is in the offer; video is
  negotiated in the SDP as usual. `sdp` is 1 byte to
  32 KiB; `ek` is a 1,216-byte KEM `ek` and `enc` 1,120 bytes (§10, the
  call key). A `call.ice` carries 1–16 candidates, each `candidate` at most
  1,024 bytes, `sdp_mid` at most 64 bytes, `sdp_mline_index` 0–1,023.
  `reason` is `hangup`, `decline`, `busy`, `timeout`,
  `answered_elsewhere`, `unavailable` or `failed`. `state` is `ringing`,
  `active` or `ended`.
- **Placing a call.** The caller's device generates the ephemeral KEM key,
  signs its share (below) and sends `call.start`. The vault refuses with
  `busy` while another call is ringing or active, checks and vouches for
  the share, sends the connection `call.offer` with `exp` = now + 45 s,
  records the sending device as the call's device, and answers with its
  signed ICE configuration.
- **Ringing.** The callee's vault drops an offer without `exp` or with an
  `exp` more than 90 s ahead, and treats a repeated `call_id` as a
  duplicate. A **held** vault (§3.6.3, 0.13.0) rings no device and does
  not answer, not even `busy`: the caller times out as with a locked
  callee, and the callee's vault records a missed call. A call ringing
  when the hold begins stops ringing on the devices
  (`call.end{unavailable}` to them only); a call answered before it
  continues until it ends. A held caller's `call.start` is answered
  `owner_check_required`. Otherwise, if a call is ringing or active the
  vault answers `call.end{busy}`. Otherwise it sends every owner app and desktop (within its access
  session, §9.1) `call.offer` with the same `exp` and its own signed ICE
  configuration. A ringing device MAY send `call.ringing`, which the vault
  forwards once to the caller's vault, which forwards it to the call's
  device.
- **Answering.** The first answer wins. The first device to send `call.answer` (with `enc`,
  §10, the call key) becomes the callee's call device; the vault forwards
  the answer to the caller's vault and tells its other devices
  `call.end{answered_elsewhere}`. A device answering a call that is no
  longer ringing gets `call.end{unavailable}`. The caller's vault
  forwards the answer to the call's device only; that device derives
  `k_call` with its private KEM key.
- **ICE.** A device's `call.ice` is forwarded to the peer vault, which
  forwards it to its call's device, or to every owner device while its
  call is still ringing. Only the call's device may send it; a vault
  forwards at most 256 per call. `call.ice` and `call.ringing` are
  ephemeral (`exp` = now + 30 s) and forwarded from memory (§8.5).
- **Ending.** The call's device, or any owner device while an incoming
  call rings (declining), sends `call.end`; the vault forwards it to the
  peer vault and tells its other devices. A vault that receives
  `call.end` from the peer tells all its owner devices. An incoming call
  that ends before it was answered (or is answered `busy`) is a missed
  call (feed `call.missed`). Removing or blocking the connection ends its
  live calls (`unavailable`). A ringing call stops counting as busy at its
  `exp`, an active call 12 h after it was answered.
- **Authority.** A vault acts on a call message from a connection only
  for a call with that connection, and on one from a device only as
  stated above; anything else is dropped.
- **History.** The vault keeps the latest 200 calls (no SDP, no keys).

**Signed key-exchange shares.** The device that makes a share (the
caller's `ek`, the answerer's `enc`) signs it with its identity key; its
own vault vouches for it to the peer vault:

```
m          = role || 0x00 || call_id || 0x00 || media || 0x00 || share
             role "offer": share = ek, media = "audio" | "video"
             role "answer": share = enc, media = ""
device_sig = Ed25519(device ik, "vettid/vms/2/call-share" || m)       # ek_sig / enc_sig
vault_sig  = Ed25519(vault ik,  "vettid/vms/2/call-vouch" || device_ik (32) || m)
```

What each party checks:

| Party | Checks | On failure |
|---|---|---|
| The device's own vault (`call.start`, D→V `call.answer`) | `device_sig` under the `ik` of the sending device's paired record | Refuses: `bad_request` for `call.start`; `call.end{unavailable}` to the answering device; audited `drop.call_share` |
| The peer vault (V↔V `call.offer`, `call.answer`) | `vault_sig` under the connection's pinned `ik` (§6.3, followed through `identity.rotate`), and `device_sig` under `device_ik` | Drops (audited `drop.call_share`): an offer rings nobody; an answer is not passed on and the call keeps ringing until it ends or times out |
| The peer device (V→D `call.offer`, `call.answer`) | `vault_sig` under `peer_ik` (the connection's `ik` as its own vault has it on record, the same as `connection.get` returns) and `device_sig` under `device_ik` | MUST NOT use the share (no answer, no media key) |

The relay, the hosts and the peer vault therefore cannot swap a share
unnoticed. **Residual:** each member's own vault can. It vouches for which
`device_ik` is its member's device and tells its own devices `peer_ik`, so
it could substitute a share in either direction of its member's calls (and
then learn `k_call`). A member's own vault is trusted for that member's
calls, as it is for everything else of the member (§2.1).

**Vault-signed ICE configuration** (CALLING-SERVICE §6). Each vault gives
only its own devices an ICE configuration, for each call, signed by its
`ik`:

```
ice_config = standard base64 of the exact bytes
             {"v":1,"call_id":"<id>","exp":<unix s>,"ice_servers":[{"urls":["..."],"username":"...","credential":"..."}]}
ice_sig    = standard base64 of Ed25519(vault ik, "vettid/vms/2/ice" || those bytes)
```

- The JSON is in canonical form: members in the order shown, no
  whitespace, `username` and `credential` both present or both absent; at
  most 8 servers of 1–4 URLs (`stun:`, `stuns:`, `turn:` or `turns:`, at
  most 512 bytes, no spaces or control characters).
- A device MUST verify `ice_sig` under its vault's current `ik`, and that
  `call_id` is the call's and `exp` has not passed, and MUST NOT use
  servers from any other source. The calling service therefore cannot
  inject or reorder servers.
- The servers and short-lived credentials come from the vault's ICE
  issuer (CALLING-SERVICE §5: coturn `use-auth-secret` or a managed
  provider), valid 6 h. Without a calling service the list is empty and
  devices use host and server-reflexive candidates. How the issuer's
  shared secret reaches the vault is open (CALLING-SERVICE §10).

**PQC.** `k_call` comes from MLKEM768X25519 (suite 2, PQC Phase 1).
DTLS-SRTP below the frame encryption is classical and not relied upon
(CALLING-SERVICE §7). The ICE configuration's signature is Ed25519 and
becomes hybrid with suite 3.

### 10.11 LEASH: the member's agents

LEASH (Lightweight Encrypted Agent Secret Handling, `vettid/LEASH`) is
VettID's standard for delegating to AI agents: the member's data stays in the vault,
the member decides what an agent may do, and every access is audited.
The vault implements LEASH's vault interface for its member's own agents.
An agent's LEASH connector is a paired device of role `agent` (§6.7).
LEASH's terms map as follows:

| LEASH | Here |
|---|---|
| Enrollment: a one-time token; the owner reviews and approves | Agent pairing (§6.7): a 10-minute QR; the agent's self-asserted name and the SAS are shown; an app approves |
| Connector key pair; an encrypted channel with forward secrecy | The agent's `ik` and `kem`, and the §6 session (epochs, rekeys) |
| Connection Contract | The agent's **grants** (below), each a delegation signed by the member's credential key; issued with the pairing or later by an app, with the member present (the unlock window) |
| Approval mode | Per grant: `ask` (the default) or `auto`, LEASH's two modes; LEASH has no unrestricted mode |
| Rate limits; suspension and owner notification | Per grant: `per_hour` and `per_day`; past a limit the grant refers requests to an app until its window ends, and the owner is notified. Per agent: refusal cooldowns, a referral cap and suspension after repeated refusals (below) |
| Action permissions | The scope `items.read` (share rules with the agent as subject, §10.12) and the delegable owner types |
| Expiry | Per grant (`expires_at`), and the agent's access session (§6.8) |
| `leash.request_secret` (pattern 1) | `agent.request{op: "item.get"}` |
| `leash.execute_action` (pattern 2) | `agent.request{op: "item.use"}` |
| `leash.check_status` | `approval.waiting`, then the held request's response (§6.8) |
| `leash.list_available` | `agent.request{op: "catalog"}` |
| `leash.connection_info` | `leash.grant.list` from the agent (its own grants) and `vault.status` |
| Delegation and status statement (§3.5) | The grant's `delegation` and `sig`, and the vault's `status` and `status_sig`, in LEASH §3.5's format (below, 0.12.0) |
| Bounded revocation (§3.4) | `leash.grant.revoke`, `device.session.end`, `device.unlink` (§7.4): at once in the vault; elsewhere within `status_ttl` + 60 s (below). The owner-check hold pauses every agent with the same bound (§3.6.3, 0.13.0) |
| Audit with integrity protection | The hash-chained audit log (§10.9), `leash.*` kinds |
| Implementation tier | Tier 1: a hardware-isolated vault (AWS Nitro Enclaves) |

The connector's platform binding and binary attestation (LEASH §3.4) are
the agent's own and out of the vault's scope: the vault knows an agent by
its `ik` and relay key.

**Grants.** A grant gives one agent one scope:

```json
grant: { "grant_id": "<ULID>", "agent_id": "<device id>", "version": 1, "scope": "message.send",
         "approval": "ask", "connections": ["<id>"],
         "per_hour": 60, "per_day": 1000, "expires_at": "<ts>", "issued_at": "<ts>", "status_ttl": 900,
         "delegation": "<b64>", "sig": "<b64>" }
```

- `scope` is one of:

  | Scope | Lets the agent send |
  |---|---|
  | `items.read` | `agent.request` (`catalog`, `item.get`, `item.use`) on the items the grant's share rule includes (below) |
  | `connection.list`, `connection.get`, `message.send`, `message.list`, `message.get`, `message.read`, `profile.get`, `action.list`, `action.invoke` | That owner type: the **delegable** types |

  No other type is delegable. In particular an agent is never given a type
  only apps may send, `item.*`, `tag.*` or `share.*` (it sees items only
  through LEASH), `credential.*`, `device.*`, `approval.*`, `leash.*`
  (agents may send `leash.grant.list` for their own grants),
  `settings.*`, `profile.set`, invitations, `connection.approve`,
  `.decline`, `.remove` or `.update`, `block.*`, `call.*`, `grant.*`,
  `critical-secret-use.*` or `connection.authenticate.*`, nor (0.8.0)
  any `location.*`, `presence.*` or `wallet.*` type, nor any `audit.*`
  type (agents never read the audit log, §10.9; 0.22.0: in particular
  `audit.export`).
- `approval` is `ask` (the default: every request is referred to an app,
  §6.8) or `auto` (allowed without approval, within the rate limits).
- `connections` (1–64 connection ids) restricts the types whose body
  carries `connection_id` (`connection.get`, `message.send`, `.list`,
  `.get`, `.read`, `action.invoke`) to those connections; it is refused
  (`bad_request`) for other scopes. A request matches a grant only if it
  meets its restrictions; a request without the restricted member never
  matches.
- `per_hour` (1–3,600) and `per_day` (1–86,400) bound the requests the
  grant allows without approval, in windows that start at the first such
  request; for an `auto` or `items.read` grant they default to 60 and
  1,000, and they are refused for any other `ask` grant. Requests an app
  approved are not counted.
- `expires_at` is optional, in the future and at most 365 days ahead (an
  `items.read` grant: its rule's `expires_at`, §10.12); an expired grant
  matches nothing and is dropped. `status_ttl` (60–3,600 s,
  default 900) is the lifetime of the grant's status statements (below).
- An agent holds at most 32 grants, its `items.read` grants included
  (`limit`). `version` follows §10.1.

**Agent share rules (`items.read`).** A share rule whose subject is an
agent (§10.12) is that agent's grant of scope `items.read`:

- An app issues, replaces or deletes it with `share.rule.set` and
  `share.rule.delete` (§10.12); issuing or replacing it signs a
  delegation (below), so it needs the unlock window (`credential_locked`
  outside it). It appears among the agent's grants (`leash.grant.list`,
  `leash.grant.updated`) with `grant_id` = its `rule_id`, `approval` =
  its `mode`, and its `tags`, `match`, `access`, `uses`, `per_hour`,
  `per_day`, `expires_at` and `status_ttl`. `leash.grant.issue` and
  `device.pair.approve{grants}` refuse scope `items.read`
  (`bad_request`); `leash.grant.revoke` of it deletes the rule.
- Its `mode` decides **inclusion** as for a connection (§10.12): `ask`,
  the default (owner decision 5), asks the member for each item that
  gains the rule; `auto` includes such items without asking. A rule
  always names its tags, so `auto` covers only items the member tagged
  for it (as 0.6.0 required `auto` reads to name their secrets). Since
  0.23.0 an `ask` rule of the same agent that covers an item wins over
  an `auto` one (§10.12 Overlapping rules).
- Owner decision (2026-10-03): an **included** item is read without a
  further approval within the rule's `per_hour` and `per_day`; past
  them, requests are referred to an app as for any grant (below), so that
  `ask` means one prompt per item rather than one per read.
- It never includes a `critical` item: critical items are never
  reachable by agents. `uses` counts the reads (`item.get` and
  `item.use`) of each included item; an item with no use left is no
  longer included (since 0.23.0 in any of the agent's rules, and a read
  counts in each of them that has `uses`, §10.12 Overlapping rules).

**Decisions** (§6.8). For a request of an agent within its access
session, the vault takes the agent's unexpired grants whose scope is the
request's (for `agent.request`, its `op`'s) and whose restrictions the
request meets:

0. a suspended agent, or a request of a scope in its cooldown (below):
   it **refuses** without looking further (`forbidden`, counted as
   *throttled*);
1. no grant: it **refuses** (`forbidden`, counted as *refused*) and
   starts or extends the scope's cooldown;
2. an `auto` grant, or an `items.read` grant whose rule includes the
   item (for `catalog`, any `items.read` grant), within both of its
   windows: it **allows** the request and counts it on that grant;
   since 0.23.0, for `item.get` and `item.use`, only if **every**
   `items.read` grant of the agent whose rule includes the item is
   within both of its windows, and it counts the read on each of them
   (the strictest applies, §10.12 Overlapping rules);
3. otherwise it **refers** the request to an app (`approval.pending`,
   §6.8), up to the referral cap (below). The first referral of an
   `auto` or `items.read` grant past a limit in a window records
   `leash.rate_limited`,
   in the audit log and as a high-priority feed item.

An `agent.request` whose body does not parse is answered `bad_request`.
When an app approves a referred request, the vault executes it only if a
grant still covers it and the agent is not suspended (§6.8); that check
counts nothing.

**Refusals do not become spam.** Refused requests cost the agent nothing
to repeat but cost the vault work and the member attention, so they are
bounded per agent:

- **Cooldown per scope.** After a refusal, the agent's requests of that
  scope (for an owner type, the type) are throttled for 1 s, then 2 s,
  4 s, ... doubling after each further refusal, up to 5 min. A covered
  request, an hour without refusals, or a new grant of that scope ends
  the cooldown. An agent that retries once loses seconds; a loop is
  slowed to one examined request per scope every 5 minutes (about 19 in
  its first hour).
- **Referral cap.** At most **20 referrals per agent per hour** reach the
  member's apps (besides §6.8's limit of 8 held at once). Further
  requests that would be referred are throttled, and the first time in
  the hour the member gets a high-priority feed item
  (`leash.referrals_limited`). Twenty prompts an hour is already more
  than a person answers with care; more would train the member to
  approve without reading.
- **Suspension.** **30 refusals** (refused or throttled) **within an
  hour** suspend the agent: all of its grants are paused (its requests
  are throttled, and referred ones are not executed on approval), it is
  told in `leash.grant.updated{suspended: true}`, and the member gets a
  high-priority feed item (`leash.agent.suspended`) and
  `sync.event{leash.agent.suspended}`. An app ends it with
  `leash.agent.resume{agent_id}`, which also clears the cooldowns and
  counts. Thirty is above what the cooldown lets one scope reach in an
  hour (about 19), so an agent that only retries a refused request is
  slowed, not suspended; one that keeps sending while throttled, or
  probes many scopes, is suspended within minutes.

**Audit summaries.** Agent activity cannot push older entries out of the
audit log (§10.9). Per agent and window of one hour (from the agent's
first event in it), the first event of each kind is written singly;
later ones are counted, and when the window ends the vault writes one
`<kind>.summary` entry whose `ref` is the count of events not written
singly. The kinds are `leash.allowed` (`ref` = `grant_id`),
`leash.refused` (`ref` = the scope), `leash.item.read` and
`leash.item.used` (`ref` = `item_id`), and `leash.throttled` (only
ever summarised). An agent therefore adds at most two entries per kind
and hour. The vault has no timers: a window's summaries are written when
the agent's next window starts, at its suspension or resumption, or
when it is unlinked.

**`agent.request`** operates only on the items the agent's `items.read`
grants include (above). An item none of them includes (or that has no
use left) is not covered, so the request is refused (`forbidden`, §6.8)
whether or not the item exists. Critical items are never reachable by
agents (§3.5).

- `catalog` lists the included items' metadata: `{items: [{item_id,
  name, category, labels: [{field_id, label, kind}]}]}`, never tags,
  rules or values.
- `item.get{item_id, fields?}` returns `{item_id, name, category,
  fields: [{field_id, label, kind, value}], notes?}` (LEASH pattern 1,
  controlled exposure; `notes` only without `fields`; an unknown field is
  `not_found`), recorded as `leash.item.read` in the audit log and the
  feed (the first per agent and hour; then summarised).
- `item.use{item_id, field_id, action: "hmac-sha256", data}` uses a
  field without exposing it (LEASH pattern 2): HMAC-SHA-256 with the
  value's UTF-8 bytes as the key over `data` (1–16,384 bytes, base64),
  answered `{item_id, field_id, action, result}` (32 bytes); recorded as
  `leash.item.used`. An `address` field cannot be used (`not_found`).
  HTTP requests made by the vault with an injected secret need egress
  beyond the relay and are not offered (§15).

**Every grant is a signed delegation** (LEASH §3.5). The member's
**credential key** (§3.5.1) signs each grant when it is issued, replaced
or given with a pairing: a statement, verifiable without the vault, that
the member delegated the scope to the agent's key. The agent receives it
with its grants and can present it. Since 0.12.0 the delegation, its
signature, the status statement and the verifier's checks are the LEASH
paper's §3.5 format, version 1, byte for byte (owner decision of
2026-10-05: the paper is the neutral reference); what is VettID's own is
named as a binding below.

```
delegation = standard base64 of the exact bytes (RFC 8785, JCS; shown here in that member order)
             {"approval":"auto","exp":<unix s>,"grant_id":"<ULID>","iat":<unix s>,
              "iss":"<b64 credential key>","limits":{"per_day":1000,"per_hour":60},
              "nonce":"<b64, 16 random bytes>",
              "scope":{"access":"read","connections":["<id>"],"match":"any","op":"<scope>",
                       "tags":["<tag>"],"uses":10},
              "status_issuer":"<b64 vault ik>","status_ttl":<s>,"sub":"<b64 agent ik>",
              "v":1,"version":1}
sig        = standard base64 of Ed25519(credential key, "leash/v1/delegation" || those bytes)
```

- **Members** (LEASH §3.5, "Delegation"):

  | Member | Here |
  |---|---|
  | `v` | `1` |
  | `iss` | The member's credential key (§3.5.1), its 32-byte Ed25519 public key in standard base64. (Before 0.12.0 it travelled beside the delegation as `key`.) |
  | `sub` | The agent's `ik` (its connector key, §6.7), likewise (was `agent_ik`) |
  | `grant_id`, `version` | The grant's (§10.1) |
  | `scope` | An object: `op`, the grant's scope (an owner type or `items.read`, below); `connections` when the grant has them; for `items.read`, the rule's `tags`, `match` and `access`, and `uses` when the rule has it. These were top-level members before 0.12.0 (`scope` was the bare string). |
  | `approval` | `ask` or `auto` (an `items.read` grant: its rule's `mode`) |
  | `limits` | `{per_day, per_hour}`, exactly when the grant has rate limits: every `auto` and `items.read` grant (before 0.12.0 only `items.read` carried them) |
  | `status_issuer` | The member's vault: its `ik` when the grant was signed (was `vault_ik`) |
  | `status_ttl` | 60–3,600 s, default 900 (below) |
  | `nonce` | 16 bytes from the vault's random generator, in standard base64 (24 characters), new for each signature, a replacement's included (new in 0.12.0) |
  | `iat` | The signing time, in Unix seconds |
  | `exp` | The grant's `expires_at` in whole seconds; absent when the grant has none (LEASH §3.2: expiry is optional) |

  No other member appears, at the top level or in `scope` or `limits`.
- **Encoding.** The vault produces the bytes in the JSON Canonicalization
  Scheme (RFC 8785): members sorted by name, no whitespace, integers in
  plain decimal. Every value here is an ASCII string without characters
  that need escaping, an array of such strings, or an integer below
  2^53, so JCS is plain sorted compact JSON. The bytes are carried
  base64-encoded and signed as they are; a verifier checks the signature
  over the bytes as received and never re-serializes them (LEASH §3.5).
  The vault re-reads only delegations it produced and requires them to
  be in JCS. Base64 is standard with padding (RFC 4648 §4) throughout,
  as everywhere in this document.
- **Signature.** `sig` is Ed25519 (RFC 8032) by `iss` over the ASCII
  context string `leash/v1/delegation` immediately followed by the
  delegation bytes, with no separator or length (`||` as in §4.1). It replaces `vettid/vms/2/leash`.
- **Tags in the delegation** (owner decision of 2026-10-03). An
  `items.read` delegation carries its rule's tag names in `scope.tags`,
  so a relying party the agent shows it to sees them: the one place tag
  names leave the vault (§10.8), as VAULT-ITEMS §6 asks ("the signed
  delegation carries the rule"). The agent is the member's own and shows
  its delegation only to parties it deals with.
- **Lifetime.** `exp` is absent when the grant has no expiry. (The 24 h
  cap of the first 0.6.0 draft came from vettid.dev's token format, not
  from LEASH, and is gone.)
- **Revocation** follows LEASH §3.4 ("Bounded revocation"): the vault
  stops honoring a revoked grant at once and issues no further status
  statements for it. Here the vault is the enforcement point and never
  relies on a delegation; the agent is told at once in
  `leash.grant.updated`, and its connector MUST stop presenting a
  delegation that is no longer among its current grants. Other
  verifiers stop accepting it within the bound below.
- **The member present.** Signing uses the credential key, so issuing
  needs the member: only an app issues or replaces a grant, and only
  within the credential's unlock window (`credential.unlock`, §3.5.3;
  `credential_locked` outside it), which each signature extends. A
  pairing approval with `grants` likewise needs the window: the grants
  are signed at the approval for the agent's `ik` from its `hs.init`,
  and take effect when the pairing completes. Revoking and resuming
  sign nothing and need no window. This is LEASH §3.5's "issuing a
  delegation needs the owner, and a vault operator cannot issue one":
  the credential key is usable only inside the member's unlock window
  (§3.5).
- A replacement is signed again under its new `version` (and a new
  `nonce`). A `credential.rotate` does not re-sign grants: their `iss`
  is the old key, which verifiers that trust the new one follow through
  the rotation statements (§3.5.5).

**Status statements ("stapling").** A delegation names its **status
issuer**: the member's vault, by its `ik` in `status_issuer`. The vault
signs short-lived statements that the delegation is still in force, and
the agent staples the current one to the delegation it presents. They
need neither the credential nor the member (they grant nothing new), so
the vault issues them on its own:

```
status     = standard base64 of the exact bytes (RFC 8785, JCS)
             {"delegation":"<b64 SHA-256(delegation bytes)>","grant_id":"<ULID>",
              "issued_at":<unix s>,"not_after":<unix s>,"status":"valid","v":1}
status_sig = standard base64 of Ed25519(vault ik, "leash/v1/status" || those bytes)
rotations  = the vault's identity.rotate statements (§3.4) from the delegation's status_issuer
             to the ik that signed, in order; absent when it has not rotated (VettID binding)
```

- **Members and signature** are LEASH §3.5's ("Status statement"); only
  the encoding (JCS, as above) and the context string `leash/v1/status`
  (was `vettid/vms/2/leash-status`) changed in 0.12.0.
- **Lifetime.** `not_after` = `issued_at` + the delegation's
  `status_ttl`, and never past the delegation's `exp`. `status_ttl` is
  set per grant (`leash.grant.issue{status_ttl}`,
  `share.rule.set{status_ttl}`): 60–3,600 s, default 900. The member may
  shorten it to a minute for sensitive scopes, at the cost of more
  frequent refreshes.
- **Only for delegations in force.** The vault issues a statement only
  for an unexpired, unrevoked grant of an agent that is not suspended; a
  revoked grant gets no new statement, so its last one lapses at its
  `not_after`. A locked vault (§12.1) issues none: the mechanism fails
  closed, and an agent whose member's vault stays locked loses its
  statements within `status_ttl`. A **held** vault (§3.6.3, 0.13.0)
  issues none either (with the hold turned off, §3.6.7, the vault is
  never held and statements renew as usual), and refuses the agent's requests
  (`leash.status.get` included) with `owner_check_required`: an agent
  is paused from the deadline, in the vault at once and for relying
  parties within `status_ttl` + 60 s. Statements issued before the
  deadline are not revoked early; the grants stay, and statements resume
  with the next check (`leash.grant.updated` to agents in a session). Refreshing uses the agent's E2E session
  and needs its access session (§6.8).
- **Delivery.** Every grant in `leash.grant.updated` and in an agent's
  `leash.grant.list` carries a fresh `status`, `status_sig` and
  `rotations`; `leash.status.get{grant_id}` returns a fresh one
  (`not_found` for a grant that is not the agent's or not in force,
  `forbidden` while the agent is suspended). The reference client
  refreshes a statement when less than a quarter of its lifetime (at
  least a minute) remains, as LEASH §3.5 suggests.
- **Rotation of the vault's `ik`** (VettID binding; LEASH §3.5 does not
  define key rotation). The delegation is not re-signed when the vault's
  `ik` rotates (that would need the member's credential key for every
  grant): statements are signed by the current `ik` and carry the
  rotation chain from the delegation's `status_issuer`, which each link
  signs with both keys (§3.4), at most 32 links. A VettID verifier
  therefore needs nothing but what the agent presents. A verifier that
  implements only LEASH §3.5 checks `status_sig` under `status_issuer`
  itself, so it rejects statements after a rotation until the grant is
  re-signed: it fails closed, never open (§15 item 21).

**Revocation latency bound** (LEASH §3.5; normative). The vault stops
honoring a revoked grant immediately. For any other verifier, the
longest a revoked grant can still be accepted is `status_ttl` plus the
clock skew of 60 seconds: **15 minutes plus 60 seconds by default, at
most 1 hour plus 60 seconds, at least 1 minute plus 60 seconds.** A
verifier that does not require a status statement (LEASH: SHOULD reject
a delegation without one) can be shown a revoked delegation until its
`exp`, or indefinitely if it has none; VettID's reference verifier
always requires one.

**Verification by a relying party that is not connected to the vault**
(normative; LEASH §3.5, "Verification"). A verifier is given the
delegation, `sig`, the status statement, `status_sig`, `rotations` (a
VettID binding, possibly absent) and a proof of possession. Both
objects MUST parse as JSON objects with `v` = 1, no duplicate member
names, and the members above with their types. It MUST then check, in
order:

1. `sig` over the delegation bytes under `iss` (context
   `leash/v1/delegation`), and that `iss` is a key it trusts for this
   member. Here that is the member's credential key as the verifier
   pinned it (member authentication, §10.4, for a VettID connection), or
   an earlier credential key linked to it by rotation statements
   (§3.5.5);
2. that `now` is before `exp`, if `exp` is present;
3. `status_sig` (context `leash/v1/status`) under the delegation's
   `status_issuer`, or, when `rotations` is present, under the last key
   of the chain that starts at `status_issuer` (each link as in §3.4, at
   most 32);
4. that the statement's `delegation` equals SHA-256 of the delegation
   bytes and that its `grant_id` matches;
5. that `issued_at` − 60 s ≤ `now` ≤ `not_after` + 60 s;
6. that the presenter proves possession of the private key for `sub`
   (the agent's `ik`), for example by signing a challenge from the
   verifier or, over HTTP, with a DPoP proof (RFC 9449);
7. that the requested operation is within `scope`: `scope.op`, and only
   for the connections in `scope.connections` when present. For
   `items.read`, `scope.tags` say which of the member's tags the rule
   names; which items carry them is known only to the vault, which
   enforces inclusion.

It MUST reject the request if any check fails. VettID's reference
verifier, `leashwire.VerifyPresented` in vettid-vault (steps 1–5;
steps 6 and 7 are the caller's), is stricter, never looser: it rejects
members other than those above, a `status_ttl` outside 60–3,600, and a
statement whose `not_after` − `issued_at` exceeds the delegation's
`status_ttl`, and it rejects a delegation presented without a status
statement. How a relying party comes to trust the member's credential
key in the first place (member authentication, §10.4, for a VettID
connection; otherwise LEASH's trust model, an open question there) is
outside this document. The §16 vectors (`leash.json`) are two
delegations and their statements.

| Type | Request body | Response / event body |
|---|---|---|
| `leash.grant.issue` (app, within the unlock window) | `{agent_id, grant_id?, version?, scope, approval?, connections?, per_hour?, per_day?, expires_at?, status_ttl?}` (not `items.read`); without `grant_id` a new grant (`version` absent); with it, a replacement of that grant (`version` required; `conflict`); `credential_locked` outside the window | `<grant>`, with its `delegation` and `sig` |
| `leash.grant.revoke` (app, desktop) | `{grant_id}` | `{}` |
| `leash.grant.list` (app, desktop: `{agent_id?}`; agent: `{}`, its own) | as left | apps and desktops: `{grants: [<grant>], suspended: [<agent_id>]}`; an agent: `{grants: [<grant>], suspended}` |
| `leash.grant.updated` (V→D, to the agent) | — | `{grants: [<grant>], suspended}`: all of its grants, after every change and at suspension and resumption |
| `leash.agent.resume` (app) | `{agent_id}` | `{}`; `not_found` unless the agent is suspended |
| `leash.status.get` (agent) | `{grant_id}` | `{grant_id, status, status_sig, rotations?}`; `not_found`, `forbidden` (suspended), `owner_check_required` (the vault is held, §3.6.3) |
| `agent.request` (agent) | `{op: "catalog"}`, `{op: "item.get", item_id, fields?}` or `{op: "item.use", item_id, field_id, action: "hmac-sha256", data}` | `{items}`, `{item_id, name, category, fields, notes?}` or `{item_id, field_id, action, result}` |

- `agent_id` names an active device of role `agent` (`not_found`
  otherwise). A grant replaced or issued for an agent is sent to it in
  `leash.grant.updated`, within its access session (§6.8); an agent
  fetches its grants with `leash.grant.list` when a session starts.
- `leash.grant.revoke` deletes the grant at once (an `items.read` grant:
  its share rule). Unlinking the agent revokes all of its grants and
  deletes its share rules (§7.4). Removing or blocking a connection
  revokes every grant that names it in `connections`: its delegation
  names the connection (`scope.connections`) and cannot be re-signed
  without the member.
- Changes are announced as `sync.event` `leash.grant.changed`,
  `leash.grant.revoked` or `leash.agent.suspended` (to apps and
  desktops) and audited (`leash.grant.issued`, `.updated`, `.revoked`,
  `leash.agent.suspended`, `.resumed`, `leash.referrals_limited`).

### 10.12 Share rules and grants: sharing with connections

The member shares items with a connection, or with one of their agents
(§10.11), by **share rules** over tags: "Dr Lee may read my items tagged
*medical*". Underneath, every item a rule makes readable to a connection
is a **grant**: the connection fetches the item's current values, sealed
to its fetching device, at most `uses` times and until the grant expires
or is revoked. A connection can also ask for something specific with a
one-off grant request, which the member answers.

**Share rules.**

```json
share_rule: { "rule_id": "<ULID>", "version": 1,
              "subject": { "connection_id": "<id>" },
              "tags": ["medical"], "match": "any", "access": "read", "mode": "ask",
              "uses": 10, "per_hour": 5, "per_day": 20, "expires_at": "<ts>", "include_existing": true,
              "created_at": "<ts>", "updated_at": "<ts>",
              "included": ["<item_id>"], "pending": ["<item_id>"], "declined": ["<item_id>"] }
```

- `subject` is `{connection_id}` (an active connection) or `{agent_id}`
  (an agent, §10.11; `not_found` otherwise). It cannot change.
- `tags` is 1–16 tags (§10.8), none reserved. `match` is `any` (the
  default: an item carrying one of them) or `all` (every one).
- `access` is `read`, the only value: `data` and `secret` items the rule
  includes become readable by the subject. A `critical` item is never
  readable: a connection rule can at most make it **usable** for
  critical-item use (§10.13), and an agent rule never includes it.
- `mode` is `ask` (the default, owner decision 2026-10-03) or `auto`.
- `uses` (1–10,000) bounds the fetches of each included item; absent,
  fetches are not counted against a limit (each is still audited).
  `per_hour` and `per_day` bound how often the subject may fetch (a
  connection) or read (an agent) the items the rule shares: for an agent
  rule as §10.11 says (always present, default 60 and 1,000); for a
  connection rule (0.23.0) they are optional and absent means no rate
  limit (Rate limits for connections, below).
  `expires_at` (in the future, at most 3,650 days ahead) ends the rule;
  absent, it lasts until deleted. `include_existing` (default `true`)
  applies the rule to the items that already match it (below).
- `included`, `pending` and `declined` list the rule's items in each
  state (below). A vault holds at most 64 rules per subject and 512 in
  all, and at most 4,096 pending items (`limit`).

**Matching and inclusion.** An item **matches** a rule while the rule is
in force and the item's tags meet `tags` and `match`; an agent rule
never matches a `critical` item. Each matching item is, for that rule,
**pending** (the member was asked), **included** or **declined**:

- **Mode `ask`.** When an item **gains** the rule (it matches after a
  change and either did not match before or gained one of the rule's
  tags: a new item, a re-tag, a merge, a rule that now names its tag),
  it becomes pending and the member's apps and desktops get
  `share.pending` ("Share *Allergy list* with *Dr Lee*?"). The member
  decides with `share.decide`. A declined item is remembered and not
  asked again until it gains the rule again.
- **Mode `auto`.** An item that gains the rule is included at once,
  without asking. The apps show the impact before a rule or a tag change
  is saved (`dry_run`: `share.rule.set` below, `tag.merge` and
  `tag.delete` §10.8, and since 0.21.0 `item.put` and `item.tag`
  §10.7).
- **`include_existing`.** When a rule is created (or replaced), the items
  that already match it gain it if `include_existing` is `true`; with
  `false` only later gains count. `share.rule.set{dry_run: true}` lists
  them first, so the member confirms the preview either way.
- **Withdrawal.** An included or pending item that stops matching (its
  tag removed, the rule changed, deleted or expired, the item deleted or
  moved to or from `critical`) is withdrawn at once: pending, it is
  dropped; included, its grant is revoked (the connection is told
  `data.revoked`) or, for an agent, its reads end. A move to or from
  `critical` withdraws the item from every rule and then lets it gain
  the rules it matches.
- A rule replaced from `ask` to `auto` includes its pending items. Since
  0.23.0 only those that no other `ask` rule of the subject holds, and
  each of them as the member's inclusion would, in every rule of the
  subject where it is pending (Overlapping rules, below).

**Overlapping rules: `ask` wins** (0.23.0; owner decision of
2026-10-09, §15 item 31). An item can match several rules of the same
subject (one rule for *medical*, another for *insurance*, an item tagged
with both). Until 0.22.x the vault treated each rule on its own, so an
`auto` rule shared the item at once even while an `ask` rule of the same
subject covered it. From 0.23.0 the most restrictive mode applies: if
**any** rule of the subject that covers an item is `ask`, the item is
shared with that subject only after the member approves it. A rule
**covers** an item while the item matches it (above), whatever the
item's state in that rule. Rules of different subjects never affect each
other.

- **Gaining an `auto` rule.** An item that gains an `auto` rule is
  included at once only if every other rule of the same subject that
  covers it is `auto`, or is an `ask` rule that already **includes** it
  (the member approved this item for this subject). Otherwise it becomes
  **pending** in the `auto` rule, as in an `ask` rule, and the pending
  entry names the `ask` rule that holds it (`ask_rule_id`, the lowest
  `rule_id` if several do). Gaining an `ask` rule is unchanged: the item
  is pending.
- **When the vault evaluates it.** Whenever it plans inclusions: a tag
  change (`item.put`, `item.tag`, `tag.merge`, `tag.delete`), a move to
  or from `critical`, `share.rule.set` (a new rule, a replacement, a
  change of `mode`, `tags` or `match`, and `include_existing`), and a
  rule's deletion or expiry. The evaluation uses the rules as they are
  after the change, in the same flush; a change that both adds an `ask`
  rule and lets an item gain an `auto` rule (a merge, say) asks.
- **One answer per item and subject.** An item pending in several rules
  of the same subject is one question for the member. A `share.decide`
  that includes the item in one rule includes it, in the same change, in
  every rule of that subject where it is pending; one that declines it
  declines it in every rule of that subject where it is pending **or
  included**: a decline stops sharing the item with that subject, and an
  included item is withdrawn (its grant revoked, `data.revoked`, or an
  agent's reads ended) and marked declined in those rules. The response's
  `included` and `declined` and `sync.event{share.decided}` (one per
  rule) list every item the decision changed.
- **No silent withdrawal.** An item already included in an `auto` rule
  stays included, and its grant keeps serving it, when an `ask` rule of
  the same subject starts covering it (a new `ask` rule, a replacement
  from `auto` to `ask`, a tag the item gains). If it gains the `ask`
  rule (with `include_existing` `true`, or by a later change) it becomes
  pending there and the member is asked; declining then stops the
  sharing as above. With `include_existing: false` it is not asked and
  stays shared. A grant serves the item's current content (Fetching,
  below): the member decides inclusions, never versions, so a new version
  of an included item is not asked.
- **Removing an `ask` rule never shares anything.** When an `ask` rule is
  deleted, expires, stops covering an item or is replaced by an `auto`
  rule, the items that it held pending in other `auto` rules stay
  pending until the member decides them (their `ask_rule_id` is dropped
  or names another `ask` rule that still holds them), except those that
  a rule replaced from `ask` to `auto` includes (above); declined items
  stay declined. Only an item that gains an `auto` rule afterwards is
  included at once. Deleting or narrowing a rule therefore never makes
  more items readable.
- **Limits: the strictest applies.** Adding a second rule never raises
  how often an item can be fetched or read.
  - **Rate limits.** A fetch (or an agent's read) of an item counts in
    the windows of **every** rule of that subject that includes the
    item, and is refused while any of those windows is full (Rate
    limits for connections, below; §10.11).
  - **`uses`** (owner's review of #181). For a connection and an item,
    the **rule grants of the item** are the grants given to that
    connection for that item by the rules of that connection that
    include it (one per rule; one-off and shared-action grants are not
    among them). A fetch through one of them is answered only if every
    rule grant of the item that has `uses` has a use left (otherwise
    `exhausted`), and it counts **one use on each** of them; a rule
    grant without `uses` counts nothing. When the last use of one of
    them is spent, all of them are spent: the vault sets every rule
    grant of the item to `used` in the same flush, so the item can no
    longer be fetched under any of the connection's rules until it is
    withdrawn and gains one again (or the member grants it one-off).
    `uses_left` in `data.value` and in the catalog is the least of
    them. For an agent, a read of an item counts one use in every rule
    of that agent that includes it and has `uses`; when one has none
    left the item is no longer included in any of them (§10.11).
  - **`expires_at`** stays each grant's own: a grant ends at its
    rule's expiry, and the item then stays readable only through the
    other rules' grants, which are still bound by the above.
- **Previews and explanation.** `share.rule.set{dry_run}` and the
  `dry_run`s of `item.put` and `item.tag` (§10.7) report an item that
  would be asked because of another rule with that rule's `ask_rule_id`;
  `share.pending` and `share.pending.list` carry it on the entries it
  holds. Apps MUST explain it in the member's words wherever such an
  item appears: "Asks you first because your *medical* rule for Dr Lee
  covers it" in a preview, and "Also covered by your *medical* rule,
  which asks you first" on the question. A pending question about an
  item already shared with the subject by another rule says so, and a
  decline says that it stops that sharing.
- **Naming a rule to the member** (owner's review of #181). Rules have
  no names, and the member gives them none: in every member-facing text
  a rule is named by its tags, in the rule's order, as the member's
  tag names (§10.8): one tag, "your *medical* rule"; with `match: all`,
  joined by " + " ("your *medical + id* rule"); with `match: any`,
  joined by " or " ("your *medical or id* rule"); followed by "for
  <subject>" where the subject is not otherwise clear. If two rules of
  the same subject would read the same, the app adds what differs
  (the mode, "asks first" or "shares automatically", or the expiry).

| Type | Request body | Response / event body |
|---|---|---|
| `share.rule.set` (app; desktop: step-up; an agent subject: app within the unlock window) | `{rule_id?, version?, subject, tags, match?, access?, mode?, uses?, expires_at?, include_existing?, per_hour?, per_day?, status_ttl?, dry_run?}` | `<share_rule>` (an agent rule with its delegation, §10.11); with `dry_run`: `{matches: [{item_id, name, category, sensitivity, state?, outcome?, ask_rule_id?}], total}` (0.23.0: `outcome`, `ask_rule_id`) |
| `share.rule.list` (app, desktop) | `{connection_id? \| agent_id?, after?, limit?}` | `{rules: [<share_rule>], next?}` |
| `share.rule.delete` (app, desktop) | `{rule_id}` | `{}` |
| `share.pending` (V→D, apps and desktops) | — | `{rule_id, subject, items: [{item_id, name, category, sensitivity, ask_rule_id?, shared?}], reason: "rule" \| "tagged"}` (0.23.0: `ask_rule_id`, `shared`) |
| `share.pending.list` (app, desktop; 0.21.0) | `{rule_id? \| connection_id? \| agent_id?, after?, limit?}` | `{pending: [{rule_id, subject, item_id, name, category, sensitivity, at, ask_rule_id?, shared?}], next?}` (0.23.0: `ask_rule_id`, `shared`) |
| `share.decide` (app; desktop: step-up) | `{rule_id, items: [<item_id>], approve}`, or (0.21.0) `{rule_id, include?: [<item_id>], decline?: [<item_id>]}` | `{included: [<item_id>], declined: [<item_id>]}` |

- `share.rule.set` without `rule_id` creates a rule (`version` absent);
  with it, it replaces the rule (`version` required, `not_found`,
  `conflict`). `status_ttl` is only for agent rules (§10.11), as
  `per_hour` and `per_day` were until 0.22.x; since 0.23.0 a connection
  rule takes them too (Rate limits for connections, below). With
  `dry_run: true` it changes nothing and lists the
  items the rule would match, with their current `state` for a
  replacement, within 131,072 bytes (`total` counts them all). Since
  0.23.0 each entry also carries `outcome` when the request would change
  the item's state in this rule: `include` (included at once) or `ask`
  (pending), with `ask_rule_id` when an `auto` rule would ask because
  an `ask` rule of the subject holds the item (Overlapping rules,
  above); `outcome` is absent for an item whose state would not change
  (already included, pending or declined, or, with `include_existing:
  false`, not gaining the rule). A
  desktop's request for an agent subject is answered `forbidden` at once
  (the delegation needs the credential key, §6.8).
- `share.rule.list` is sorted by `rule_id` and paged like `item.list`:
  `limit` 1–500 (default 50), at most 131,072 bytes, `next`.
- `share.pending` is sent for each batch of items that became pending
  (split into several messages of at most 131,072 bytes when large):
  `reason` is `rule` when a rule was created or replaced, `tagged` when
  items changed. It is also a feed item (`share.pending`, `ref` =
  `rule_id`). `share.decide` decides the listed pending items of the rule
  (1–500; items not pending are ignored; none pending is `bad_request`).
- **Deciding several items at once (0.21.0; owner decision of
  2026-10-08, §15 item 29).** `share.decide{rule_id, include, decline}`
  includes some of the rule's pending items and declines others in
  **one change**: one flush, one response, one
  `sync.event{share.decided}`, and on an error (a `limit`, say) no
  change at all. `include` and `decline` are each optional, together
  1–500 item ids, and no id may be in both; mixing them with `items` or
  `approve` is `bad_request`. Items not pending are ignored and none
  pending is `bad_request`, as above. The `{items, approve}` form stays
  valid. Apps SHOULD send a mixed decision (some items unticked) in the
  new form.
- **Listing pending decisions (0.21.0).** `share.pending.list` returns
  the items that wait for the member's decision, one entry per rule and
  item: the rule's `rule_id` and `subject`, the item's current
  `item_id`, `name`, `category` and `sensitivity` (as `share.pending`
  carries them), and `at`, when it became pending; since 0.23.0, an
  entry of an `auto` rule that an `ask` rule holds carries
  `ask_rule_id`, and an entry for an item already included in another
  rule of the same subject carries `shared: true` (Overlapping rules,
  above; `share.pending`'s items carry the same members). It is sorted by
  `rule_id`, then `item_id`, optionally for one rule or one subject
  (at most one of `rule_id`, `connection_id`, `agent_id`), and paged
  like `item.list`: `limit` 1–500 (default 100), at most 131,072 bytes,
  `next` present when more entries match, passed back as `after`
  (opaque to apps). An app builds its pending share decisions from this
  list, so that a decision another device left open, or whose
  `share.pending` it missed, is still asked; it does not need to
  resolve the `pending` ids of `share.rule.list` itself.
- Removing or blocking a connection, or unlinking an agent, deletes its
  rules (§7.4).
- **Change notices.** `sync.event` `share.rule.changed` (`rule_id`,
  `version`), `share.rule.deleted` (`rule_id`) and `share.decided`
  (`rule_id`, `included`, `declined`).
- **Audit.** `share.rule.created`, `share.rule.updated`,
  `share.rule.deleted` (`ref` = `rule_id`); `share.included`,
  `share.declined`, `share.withdrawn` (`ref` = `item_id`, with the
  subject's `connection_id` or `device_id`); every fetch as
  `grant.fetched` and every refused fetch as `drop.grant_<error>`
  (below; 0.23.0: `drop.grant_rate_limited`, with the feed item
  `share.rate_limited`).

**Grants.** A grant lets one connection read one item. Grants come from
share rules (one per included readable item, carrying `rule_id`), from
one-off requests the member decides, and from shared actions (§10.14).

```
B app            B vault                   A vault                    A app
  |--grant.request-->|--data.request---------->|--grant.pending---------->|
  |                  |                         |<--grant.decide-----------|
  |<--grant.event----|<--data.decided----------|                          |
  |                  |<--data.shared-----------|  (a share rule included an item)
  |--grant.fetch{reply_key}-->|--data.fetch--->|  checks the grant, counts a use
  |<--grant.value{value_sealed}--|<--data.value|                          |
```

```json
grant: { "grant_id": "<ULID>", "connection_id": "<id>", "direction": "given|received",
         "kind": "item", "ref": "<item_id>", "fields": ["f1"], "label": "...", "rule_id": "<ULID>",
         "name": "...", "category": "...",
         "labels": [ { "field_id": "f1", "label": "Number", "kind": "text" } ],
         "uses": 3, "used": 1, "limits": { "per_hour": 5, "per_day": 20 }, "expires_at": "<ts>",
         "state": "active|used|expired|revoked", "created_at": "<ts>" }
```

- **Items.** A grant's item is `{kind: "item", ref: <item_id>, fields?}`:
  `fields` (1–64 `field_id`s) restricts it to those fields; without it
  the whole item (with its notes) is granted. Only `data` and `secret`
  items are granted; a `critical` item never is (§10.13).
- **Descriptors.** Grants travel between the vaults as
  `{grant_id, kind, ref, fields?, label?, rule_id?, name, category,
  labels: [{field_id, label, kind}], uses?, limits?, expires_at?}`: the item's
  name, category and the labels of the granted fields, never its tags,
  sensitivity or values. `uses` and `expires_at` are absent for a rule
  grant without them. `limits` (0.23.0) is `{per_hour?, per_day?}`, the
  rate limits of the rule that issued the grant as they were at issue,
  present exactly when that rule has one (Rate limits for connections,
  below); a given `<grant>` carries the rule's current ones, a received
  one those of its descriptor. A received `limits: {}` means no limits,
  as an absent `limits` does (0.23.1).
- **One-off requests.** `grant.request` asks for 1–16 items, each
  `{kind: "item", ref: <item_id>, fields?, label?}` (an item the asker
  knows from the catalog or an earlier grant) or
  `{kind: "category", ref: <category>, label?}` ("your insurance card":
  the member picks the item). `label` (at most 128 bytes) is the asker's
  description.

| Type | Request body | Response / event body |
|---|---|---|
| `grant.request` (app, desktop) | `{connection_id, items: [<item>], uses?, expires_in?, reason?}` | `{request_id}` |
| `data.request` (V↔V) | — | `{request_id, items, uses, expires_in, reason?}` |
| `grant.pending` (V→D, apps and desktops) | — | `{request_id, connection_id, items: [{kind, ref, fields?, label?, available, name?, category?, labels?}], uses, expires_in, reason?, exp}` |
| `grant.decide` (app; desktop: step-up) | `{request_id, approve, items?: [<index>], answers?: [{index, item_id, fields?}], uses?, expires_in?}` | `{grants: [{grant_id, kind, ref}]}` |
| `data.decided` (V↔V) | — | `{request_id, approved, grants?: [<descriptor>]}` |
| `data.shared` (V↔V) | — | `{grants: [<descriptor>]}` (1–64) |
| `grant.event` (V→D, apps and desktops) | — | `{connection_id, event: "granted" \| "shared" \| "denied" \| "revoked", request_id?, grant_id?, grants?}` |
| `grant.fetch` (app, desktop) | `{grant_id, reply_key}` | `{fetch_id}` |
| `data.fetch` (V↔V) | — | `{fetch_id, grant_id, reply_key}` |
| `data.value` (V↔V) | — | `{fetch_id, grant_id, value_sealed, uses_left?}` or `{fetch_id, grant_id, error, retry_after?}` (0.23.0: `retry_after` with `rate_limited`) |
| `grant.value` (V→D, to the device that fetched) | — | `{connection_id, fetch_id, grant_id, value_sealed?, uses_left?, error?, retry_after?}` |
| `grant.revoke` (app, desktop) | `{grant_id}` (given or received) | `{}` |
| `data.revoked` (V↔V) | — | `{grant_id}` |
| `grant.list` (app, desktop) | `{}` | `{given: [<grant>], received: [<grant>], pending: [{request_id, connection_id, items: [<grant.pending entry>], uses, expires_in, reason?, exp}], requested: [{request_id, connection_id, items: [{kind, ref, fields?, label?}], state: "pending" \| "granted" \| "denied"}]}` (0.21.0: below) |
| `grant.catalog` (app, desktop) | `{connection_id}` | `{request_id}` |
| `data.catalog.get` (V↔V) | — | `{request_id}` |
| `data.catalog` (V↔V) | — | `{request_id, items: [{item_id, name, category, labels: [{field_id, label, kind}], grant_id?, uses_left?, usable?}], truncated?}` |
| `grant.catalog.result` (V→D, to the device that asked) | — | `{connection_id, request_id, items, truncated?}` |

- **Sizes.** `uses` 1–100 (default 1: one fetch) for one-off grants;
  `expires_in` 60–31,536,000 s (default 604,800, 7 days); `reason` at
  most 256 bytes; `reply_key` a 1,216-byte KEM `ek`.
- **Asking.** The member's vault ignores a `data.request` whose
  `request_id` it already holds from that connection (from another
  connection it is dropped and audited, `drop.grant_duplicate`), keeps
  at most 16 pending requests per connection (more are dropped and
  audited, `drop.grant_limit`) and answers a request undecided after 7
  days as denied. `available` tells the member whether an `item` entry
  resolves now (an existing `data` or `secret` item with those fields);
  a `category` entry is available when the member answers it. A `data.*`
  message that does not parse is dropped and audited
  (`drop.grant_malformed`), never answered. Since 0.23.0 a `data.request`
  is an ask: mute, pause, cooldown (per entry), the pending cap and the
  ask rate of §10.4.1 apply before it reaches the member.
- **What an entry would grant (0.21.0; owner decision of 2026-10-08,
  §15 item 29).** An available `item` entry in `grant.pending` (and in
  `grant.list`'s `pending`) also carries the member's item's current
  `name`, `category` and `labels`, `[{field_id, label, kind}]` of the
  requested `fields` in the item's order (every field without
  `fields`), so that the member sees what each entry would grant
  before deciding; the asker's `label` stays its own words. They come
  from the member's own vault and go only to the member's devices.
  Unavailable entries and `category` entries carry none of them.
- **Deciding.** An approval grants each listed entry (`items` holds
  indices into the request's items; default all): an `item` entry if it
  is available; a `category` entry only through an `answer`, which names
  the member's item (and optionally its fields) for that index. The
  request's `uses` and `expires_in` apply unless the decision sets
  others; `bad_request` if nothing is granted. A vault holds at most
  1,000 active given and 1,000 active received grants (`limit`); ended
  grants and decided requests are kept 30 days for `grant.list`, then
  pruned. The asking vault keeps at most 1,000 requests and 64
  outstanding catalog requests (`limit`). A denial, or no decision in 7
  days, answers `data.decided{approved: false}`.
- **Shared by a rule.** When share rules include readable items for a
  connection, its vault sends `data.shared` with their descriptors (one
  message per change, split so that each holds at most 64 descriptors
  and 131,072 bytes). The receiving vault
  records them as received grants and tells its apps and desktops
  `grant.event{event: "shared"}`; it drops a `data.shared` whose grants it
  already holds.
- **Fetching.** The member's vault answers a `data.fetch` only for a
  grant it gave that connection. `error` is `not_found` (unknown, or
  given to another connection), `revoked`, `expired`, `exhausted` (no
  use left), `unavailable` (the item, or a granted field, no longer
  exists, or the item is now `critical`) or, since 0.23.0, `rate_limited`
  with `retry_after` (a rate limit of a rule that includes the item is
  reached; checked last, Rate limits for connections, below). Otherwise
  it counts one use
  and seals the item's current content: the UTF-8 JSON
  `{"item_id", "version", "name", "category", "fields": [{field_id,
  label, kind, value}], "notes"?}`, restricted to the granted fields
  (and without `notes` when `fields` is given), at most 65,536 bytes:

  ```
  (enc, ctx)   = SetupBaseS(reply_key, info = "vettid/vms/2/grant" || 0x00 || grant_id || 0x00 || fetch_id)
  value_sealed = enc || ctx.Seal(aad = "", pt = content)
  ```

  A `data.fetch` repeating a `fetch_id` it answered is answered again
  without counting a use, even while a rate window is full (0.23.1: it
  is not refused `rate_limited`; the rate check applies to new fetches
  only). A grant whose last use is spent is `used`.
  Every refusal is audited (`drop.grant_<error>`). The asking vault
  forwards a `grant.fetch` whatever its own record says: the member's
  vault decides.
- **Rate limits for connections** (0.23.0; owner decision of
  2026-10-09, §15 item 31). A connection rule may set `per_hour`
  (1–3,600) and `per_day` (1–86,400), the same ranges as an agent's
  (§10.11): there is no reason to differ, since both bound fetches of
  the same items and the vault counts them the same way. Each is
  optional and independent; absent, that window is not limited (unlike
  an agent rule, there is no default: a connection rule without them
  behaves as before 0.23.0). A one-off grant (`grant.decide`) or a
  shared action's grant (§10.14) has no rate limit.
  - **What is counted.** The connection's successful fetches of the
    items the rule includes, **in total**: "this connection can fetch
    items shared by this rule at most N times per hour and M times per
    day", across all of the rule's items and grants, not per item. A
    `data.fetch` answered with a value counts once; a repeated
    `fetch_id` answered again (above) and a refused fetch count nothing.
    Only fetches through **rule grants** count (0.23.1): a fetch counts
    in, and is refused by, the windows of the rules that include the
    item only when it goes through a grant one of those rules issued; a
    fetch through a one-off grant (`grant.decide`) or a shared action's
    grant (§10.14) of the same item is neither counted in nor refused by
    any rule's windows.
    A critical item the rule makes usable is not fetched: each use is
    approved by the member (§10.13) and is not counted.
  - **The windows** are those of an agent's grant (§10.11): fixed
    windows that start at the first counted fetch, one hour long for
    `per_hour` and 24 hours long for `per_day`; the next counted fetch
    after a window ends starts a new one. They are kept per rule in the
    vault's state, survive restarts, and are kept when the rule is
    replaced (a lowered limit applies at once to the open window); they
    end with the rule. The vault counts a rule's fetches in its windows
    whether or not the rule has limits (0.23.1), so a limit added later
    by a replacement applies to the window already open.
  - **Several rules** (Overlapping rules, above): a fetch counts in the
    windows of every rule of that connection that includes the fetched
    item, and is refused while any of them is full.
  - **Past a limit** the fetch is refused, after the other checks
    (above), with `error: "rate_limited"` and `retry_after`, the whole
    seconds, rounded up and at least 1, until every full window that
    refused it ends, and at most 86,400 (a day, the longest window; a
    `data.value` with more is malformed, `drop.grant_malformed`; 0.23.1);
    no use is counted. The asking vault passes both on
    in `grant.value`, and its apps say when the item can be fetched
    again ("You can open this again in 12 minutes"). The refusal is
    audited `drop.grant_rate_limited` (`ref` = `grant_id`, with
    `connection_id`), like every refusal. The member is **not** asked
    and not alerted for each refusal (a connection, unlike an agent, is
    not referred to the member's apps): the first refusal under a rule
    in 24 hours is also a normal-priority feed item `share.rate_limited`
    (`ref` = `rule_id`, with `connection_id`), at most one per rule per
    24 hours, so that the member can raise the limit or ask the
    connection why.
  - **With `uses`** both apply: `uses` bounds the grants' fetches over
    their life (for an item several rules include, on every one of its
    rule grants, Overlapping rules, above), the rate limits bound the
    rules' fetches per window; a fetch needs a use left and room in
    every window.
  - **Shown to both sides.** The rule (`share.rule.list`) carries its
    limits; a given grant carries them as `limits`, and a received
    grant as its descriptor said (above), so that the connection's app
    can show "up to 5 times an hour". A connection's vault that predates
    0.23.0 ignores the unknown `limits` member and sees
    `rate_limited` as an unknown error.
- The asking vault keeps a fetch for 10 minutes (at most 64 outstanding,
  `limit`) and forwards `data.value` only to the device that fetched,
  within its access session (§6.8); it never sees the value. The
  `reply_key`'s private half lives only in that device's memory, for
  that fetch.
- **Per-connection catalog.** A connection's catalog is what the member
  made visible to it: one entry per active grant given to it (rule or
  one-off: `grant_id`, the granted fields' labels, `uses_left` when
  counted) and one per critical item its rules include (`usable: true`,
  §10.13). `grant.catalog` asks the connection's vault, which answers
  `data.catalog` with at most 1,000 entries and 131,072 bytes
  (`truncated: true` when it left entries out). Each connection sees only
  its own catalog; tags and rules are never in it.
- **`grant.list` (0.21.0).** A received `<grant>` carries `labels`,
  the `[{field_id, label, kind}]` of its descriptor as the connection's
  vault sent it (not refreshed), so that an app shows what a grant
  holds before fetching it; a given grant carries none (the app has
  the item). `pending` entries are `grant.pending`'s, with
  `available`, `name`, `category` and `labels` as of the answer.
  `requested` lists this vault's own requests (kept as above): `items`
  are exactly the entries as sent in `grant.request`, `label` being
  the asker's own description, and `state` is `pending`, `granted`
  (the connection granted some entries; the grants arrive as received
  grants) or `denied` (denied, or not decided in 7 days).
- **Revoking.** Either side may revoke: the member's vault stops
  answering for the grant, the other side is told `data.revoked`, and
  both tell their owner devices (`grant.event{revoked}` on the asking
  side, `sync.event{grant.changed}` on both). Revoking a grant that has
  already ended succeeds and changes nothing. Revoking a rule grant does
  not change the rule: the item stays included without a grant until it
  is withdrawn and gains the rule again.
- **Removal.** Removing or blocking a connection drops its grants, both
  ways, its pending requests and its fetches, without notice (§7.4).
- **Audit and feed.** `grant.requested` (both sides), `grant.issued`,
  `grant.denied`, `grant.received`, `grant.fetched` (each use, on the
  member's side), `grant.revoked`; an incoming request is a feed item
  (`grant.request`, high), and so are a revocation by the other side
  (`grant.revoked`) and items shared by a connection's rule
  (`grant.shared`).
- 0.7.0 replaced grant items `{kind: "field" | "secret"}` by
  `{kind: "item"}`, the `cataloged` flag and the one catalog for every
  connection by share rules and per-connection catalogs, and added
  `data.shared`.

### 10.13 Critical-item use by a connection

A connection never receives a critical item's values (§3.5, §10.7). It
may ask the member to **use** one, a signing key for example, for one
operation; the member consents in their app with the credential
password, for that use only, and the connection receives only the
result.

```
B app            B vault                   A vault                      A app
  |--critical-secret-use.request-->|--critical-secret.use-->|--critical-secret-use.pending-->|
  |                  |             |                        |<--critical-secret-use.approve---|
  |                  |             |                        |   {credential, utk_id,          |
  |                  |             |                        |    sealed{password, request_id, payload_sha256}}
  |<--critical-secret-use.result---|<--critical-secret.result{status, signature, public_key}--|
```

| Type | Request body | Response / event body |
|---|---|---|
| `critical-secret-use.request` (app, desktop) | `{connection_id, item_id, field_id, operation: "sign" \| "auth", payload, context?}` | `{request_id}` |
| `critical-secret.use` (V↔V) | — | `{request_id, item_id, field_id, operation, payload, context?}` |
| `critical-secret-use.pending` (V→D, apps and desktops) | — | `{request_id, connection_id, item_id, field_id, name, label, kind?, operation, payload, payload_sha256, context?, exp}` |
| `critical-secret-use.approve` (app) | `{request_id, credential, utk_id, sealed{password, request_id, payload_sha256}}` | `{request_id, status, credential, version, utks}` |
| `critical-secret-use.deny` (app, desktop) | `{request_id}` | `{}` |
| `critical-secret.result` (V↔V) | — | `{request_id, status: "ok", signature, public_key}` or `{request_id, status: "denied" \| "expired" \| "unavailable" \| "unsuitable"}` |
| `critical-secret-use.result` (V→D, apps and desktops) | — | `{connection_id, request_id, status, signature?, public_key?}` |
| `critical-secret-use.list` (app, desktop) | `{}` | `{incoming: [{request_id, connection_id, item_id, field_id, name, label, kind?, operation, payload_sha256, context?, exp}], outgoing: [{request_id, connection_id, item_id, field_id, operation, state, status?}]}` |
| `critical-secret-use.get` (app, desktop) | `{request_id}` (an incoming request) | the `critical-secret-use.pending` body: `{request_id, connection_id, item_id, field_id, name, label, kind?, operation, payload, payload_sha256, context?, exp}`; `not_found` for an unknown, answered or expired request |

- **What can be asked.** Only a critical item that a share rule of that
  connection includes (it is then `usable` in the connection's catalog,
  §10.12), and one of its fields. Any other `item_id` or `field_id` is
  answered `unavailable` at once, without asking the member, and audited
  (`critical-secret.use.requested` and `critical-secret.use.denied`);
  an item the rule does not include is not told apart from a missing
  one. `payload` is 1–4,096 bytes (before its base64) and `context` at
  most 256 bytes; the app MUST show both, the item's name and field
  label, and the connection's name, to the member.
- **Suitability (0.21.0; owner decision of 2026-10-08, §15 item 29).**
  Both operations need an Ed25519 seed. A field is **suitable** only if
  its `kind` is `password`, `text` or `multiline` and its item is not a
  wallet's (§10.18: a recovery phrase and a passphrase). A request for
  an unsuitable field is answered `unsuitable` at once, without asking
  the member and without opening the credential, and audited
  (`critical-secret.use.requested` and `critical-secret.use.denied`).
  It is **not shown to the member** (owner decision of 2026-10-08):
  no `.pending`, no feed item, not in `.list`; the member finds it
  only in the audit log (the app's History);
  the connection already sees the field's kind in its catalog
  (§10.12), so the answer tells it nothing new. A suitable field whose
  value is not a seed is found only at the use, once the credential is
  open (below). `.pending`, `.list` and `.get` carry the field's
  `kind` (0.21.0) beside `name` and `label`, as the vault recorded them
  when the request arrived, so that the app can say what is asked
  before the password; `unsuitable` means exactly these two cases.
  Apps SHOULD keep an Ed25519 seed in a `password` field.
  - **Requests from before 0.21.0 (0.21.1).** A request that arrived
    before the vault ran 0.21.0 was recorded without a kind. Its
    `kind` MAY be absent from `.pending`, `.list` and `.get`; the vault
    MAY fill it in with the field's current kind (the reference does
    while the field is still usable). Such requests expire 24 h after
    they arrived, so `kind` is absent at most 24 h after the upgrade.
    Receivers (apps, desktops) treat an absent `kind` as unknown: they
    show the request without it and show no suitability notice for it;
    the vault still decides suitability at the approval.
  - **Order of checks (0.21.1).** For an incoming `critical-secret.use`
    the vault checks, in this order: that the field is usable by the
    connection (What can be asked, above: `unavailable`), that it is
    suitable (`unsuitable`), and then the 8 pending requests per
    connection (below: `unavailable`). An unsuitable request is
    therefore answered `unsuitable` even when that connection's pending
    requests are at the cap, and an unusable one `unavailable` whatever
    its kind. Then (0.23.0) the ask checks of §10.4.1: mute, pause,
    the cooldown of the same `item_id` and `field_id`, the pending cap
    and the ask rate.
- **Showing a request again** (0.10.2). `critical-secret-use.list` gives
  only `payload_sha256`, which keeps the list small; an app that shows an
  incoming request from the list (or from the feed) fetches it with
  `critical-secret-use.get`. Before showing a payload, from `.pending` or
  `.get`, the app MUST check that SHA-256(`payload`) equals
  `payload_sha256`, and MUST NOT offer the approval otherwise; the
  `payload_sha256` it seals in the approval is the one it computed from
  the payload it showed. A vault keeps at most 8 pending
  requests per connection (more are answered `unavailable`) and answers
  `expired` after 24 h; a repeated `request_id` is ignored. The asking
  vault keeps at most 64 outstanding outgoing requests (`limit`,
  `critical_use_requests`; the reference's bound, first stated in
  0.21.0).
- **Consent per use.** `critical-secret-use.approve` is one use of the
  credential (§3.5.3), from an app: the UTK-sealed payload carries the
  password, the `request_id` and `payload_sha256` = SHA-256(`payload`).
  The vault refuses (`bad_request`) unless both equal the pending
  request's, so the password authorizes exactly this request and this
  payload, and an attacker in the app's session can neither redirect nor
  replay it (§3.5.4). It answers `utk_invalid`, `backoff`,
  `stale_credential` and `bad_password` as §3.5.3 does, and the request
  stays pending for another attempt.
- **The use.** The vault opens the credential, decrypts the field's value
  with the item key (§10.7), performs the operation, re-keys the item and
  rotates the CEK (§3.5.3, the new blob in the response), and wipes the
  plaintext and the keys. Nothing is retained:
  there are no standing allowances, and the next use needs the password
  again. The value MUST be the standard base64 of a 32-byte Ed25519 seed
  in a suitable field (above); otherwise the status is `unsuitable`
  (the credential has still been opened and rotated).
  - `sign`: `signature = Ed25519(seed, payload)`, the payload as is, for
    protocols that need the member's key to sign their own messages.
  - `auth`: `signature = Ed25519(seed, "vettid/vms/2/critical-auth" ||
    requester_ik (32) || owner_ik (32) || request_id (26) || payload)`,
    bound to both vaults' `ik` as each has the other on record, like
    §10.4.

  `public_key` is the seed's Ed25519 public key. If the item or field
  has left the credential, or the item is no longer included for that
  connection, when the member approves, the status is `unavailable`.
  `status` in the approval's response is the result sent to the
  connection; `version` there is the credential's.
- A denial answers `denied`. The asking vault keeps its requests for
  25 h and forwards results to its apps and desktops; later or unknown
  results, and results from another connection, are dropped. It verifies
  an `ok` result first: `signature` under `public_key` over the payload
  (`sign`) or over the `auth` message with both vaults' `ik` as it has
  them on record; one that does not verify is dropped and audited
  (`drop.critical_signature`).
- **Audit and feed.** `critical-secret.use.requested` (both sides),
  `critical-secret.used`, `critical-secret.use.denied`,
  `critical-secret.use.result`; an incoming request is a high-priority
  feed item (`critical-secret.use.request`); `sync.event`
  `critical-secret-use.decided`.
- The type names are kept from 0.6.0; 0.7.0 replaced `secret_id` by
  `item_id` and `field_id`, and `credential.secret.catalog` by share
  rules.

### 10.14 Shared actions

A member lets chosen connections **invoke actions** on their vault: a
fixed catalog of operations built into each release, run by the vault
itself (native code in the vault's process, §12.4, no third-party code),
under a permission mode the member sets per action. A connection learns
which actions it may invoke from the member's offer; an invocation is
answered with the action's result or a refusal.

**The catalog** (catalog version 3). Each action has a fixed `action_id`
and `version`, a parameter and a result schema, and a sensitivity:

| `action_id` (version 1) | Sensitivity | `params` | `result` |
|---|---|---|---|
| `items.share` | sensitive | `{item_id, fields?: [<field_id>]}`; `fields` 1–64 | `{grants: [<grant descriptor>]}` (§10.12) |
| `audit.recent` | normal | `{limit?}`, 1–50, default 20 | `{entries: [{kind, at, direction?}]}` |
| `wallet.request-address` | normal | `{asset: "BTC"}` | `{asset, network, address}` |
| `wallet.request-payment` | critical | `{asset: "BTC", amount_sats, address, memo?}`; `amount_sats` 1–2,100,000,000,000,000, `address` 14–90 alphanumeric characters, `memo` at most 280 bytes | `{status: "signed", txid}` |

- **`items.share` goes through grants (§10.12)**, the same consent and
  delivery as a request the member decided: if the member's
  configuration lists the item (`items`) and it is available (a `data`
  or `secret` item with the requested fields), the action creates, for
  the invoking connection, one grant of it (restricted to `fields` if
  given), with `uses` 1 and an expiry of 10 minutes, and returns its
  descriptor. The connection fetches the values with `grant.fetch`,
  sealed to its fetching device; the invoking vault records the grant as
  received, and either side can revoke it as any grant. Otherwise the
  status is `unavailable`. Critical items are never shared.
- Catalog version 2 (0.7.0) replaced version 1's `profile.fields.read`
  and `secrets.share` by `items.share`: profile fields and vault-held
  secrets are both items now, and the two actions would be the same.
- **`audit.recent`** returns the newest entries of the member's audit log
  (§10.9) whose `connection_id` is the invoking connection, at most
  `limit`: only `kind`, `at` and `direction`, never `ref`, other
  connections' entries or `drop.*` entries.
- **Wallet actions** (§10.18) run on the one wallet the member's
  configuration names (`items` = `[wallet_id]`; without it they are
  `unavailable`):
  - `wallet.request-address` returns a receive address of that wallet's
    receiving account (`address_type`, by default P2TR) for the invoking
    connection, the same one until the member's app
    reports it used (`wallet.address.used`), then a new one; audited as
    `wallet.address_issued`.
  - `wallet.request-payment` asks the member to pay `amount_sats` to
    `address` (the invoking member's choice, usually from their own
    wallet). Its approval is the spend: `action.respond{invocation_id,
    approve: true, psbt, credential, utk_id, sealed{password, item_id,
    request_id, payload_sha256}}` from an app within the unlock window,
    where `item_id` is the wallet, `request_id` the `invocation_id` and
    `payload_sha256` the PSBT's hash. Besides §10.18's signing policy the
    PSBT MUST pay exactly `amount_sats` to `address` (which MUST be of
    the wallet's network) and nothing to anyone but the wallet itself
    (`invalid_psbt` otherwise). An error leaves the invocation pending.
    On success the response holds `txid`, the `summary` and the signed
    `tx` for the app to broadcast, and the connection gets
    `{status: "signed", txid}`: the transaction is signed and handed to
    the member's app, which broadcasts it; the requester watches its
    chain for `txid`.
- Catalog version 3 (0.8.0) makes the wallet actions available and adds
  `address` to `wallet.request-payment` (version 1 was never available,
  so its number is kept).
- `param_schema` and `result_schema` (JSON Schema 2020-12 documents in
  `action.list`) describe the shapes above for apps. The vault checks
  parameters with its own strict parser per action, never with a general
  schema engine; parameters that do not parse are answered
  `unavailable`.

**Permission modes**, per action (`action.configure`); every action
starts in `default-deny`:

| Mode | Offered to | Runs |
|---|---|---|
| `default-deny` | nobody | never: invocations are `unavailable` |
| `allowlist` | the connections in `connections` | at once, without asking |
| `prompt-each-time` | every active connection, or only `connections` if given | after the member approves each invocation (`action.pending`, `action.respond`) |
| `default-allow` | every active connection | at once, without asking |

- A **sensitive** action cannot be `default-allow` (`bad_request`).
- A **critical** action can only be `default-deny` or
  `prompt-each-time`, and is approved only by an **app within the
  credential's unlock window** (§3.5.3; `credential_locked` otherwise):
  the member's phone must be there.
- `items` (1–64 `item_id`s) bounds `items.share`; without it the action
  shares nothing. For a wallet action it names exactly one wallet.

**Offers.** After every configuration change, and when a connection
becomes active, the member's vault sends each affected active connection
`action.offered` with the complete list of actions it may invoke (empty
when none). The receiving vault keeps the latest list per connection
(`action.list{connection_id}`) and tells its owner devices
`sync.event{kind: "action.offers", connection_id}`.

| Type | Request body | Response / event body |
|---|---|---|
| `action.list` (app, desktop) | `{connection_id?}` | without it: `{catalog_version, actions: [{action_id, version, sensitivity, available, param_schema, result_schema, mode, config_version, connections?, items?}]}`; with it, what that connection offers: `{actions: [{action_id, version, prompt}]}` |
| `action.configure` (app; desktop: step-up) | `{action_id, version?, mode, connections?, items?}`; `version` is the configuration version it is based on (`conflict` if stale, §10.1) | `{version}` (the new configuration version) |
| `action.offered` (V↔V) | — | `{actions: [{action_id, version, prompt}]}` (at most 64) |
| `action.invoke` (app, desktop) | `{connection_id, action_id, params}` | `{invocation_id}` |
| `action.invocation` (V↔V) | — | `{invocation_id, action_id, version, params}` |
| `action.pending` (V→D, apps and desktops) | — | `{invocation_id, connection_id, action_id, sensitivity, params, exp}` |
| `action.respond` (app, desktop; critical: app in the unlock window) | `{invocation_id, approve}` | `{status}`: the result sent |
| `action.result` (V↔V) | — | `{invocation_id, status: "ok", result}` or `{invocation_id, status: "denied" \| "expired" \| "unavailable"}` |
| `action.result` (V→D, apps and desktops) | — | `{connection_id, invocation_id, action_id, status, result?}` |

- The member's vault answers `unavailable` for an action that is not in
  its catalog, not offered to that connection, of another `version`,
  whose parameters do not parse, or that cannot run (not told apart);
  and when it already holds 8 pending invocations from that connection,
  or has had 60 invocations from it in the last hour (refused ones
  count, so a connection that keeps invoking stays refused). Since
  0.23.0 an invocation that would wait for the member
  (`prompt-each-time`) is also an ask (§10.4.1). Malformed
  `action.*` messages from a connection are dropped and audited
  (`drop.action_malformed`). A pending
  invocation is answered `expired` after 24 h, and `unavailable` when a
  configuration change stops offering it to that connection. A repeated
  `invocation_id` is ignored.
- `params` is at most 4 KiB, `result` at most 16 KiB.
- `action.invoke` needs an offer for that `action_id` from the
  connection (`not_found` otherwise); the invoking vault keeps its
  invocations 25 h and forwards results to its apps and desktops; later
  or unknown results are dropped.
- A device's `action.invoke` is a request to its own vault; between the
  vaults the invocation is the event `action.invocation`, so that no type
  is both a request and an event (§10).
- Agents: `action.list` and `action.invoke` are delegable (§10.11).
- Removing or blocking a connection removes it from every
  configuration's `connections` and drops its offers and invocations
  (§7.4).
- **Audit and feed.** `action.configured` (`ref` = `action_id`),
  `action.invoked` (both sides), `action.approved`, `action.denied`,
  `action.completed` (`ref` = `invocation_id`); an invocation waiting
  for the member is a high-priority feed item (`action.request`);
  `sync.event` `action.changed` (`action_id`, `version`),
  `action.decided`, `action.offers`.
- In vettid.dev, invocations and results were published to subjects
  that the receiving vault did not listen on. Here they are types inside
  the connection's session, classified like every message by the session
  that decrypts them (§13.6).

### 10.15 Introductions

A member may **introduce** two of their connections to each other. Only
the member can start one: a connection never sees, lists or asks for the
member's other connections, and there is no request to be introduced.

```
A vault             B vault (introducer)              C vault
  |<--intro.offer{peer: what B shows}--|--intro.offer{peer}------------->|
  |--intro.answer{accept}------------->|<--intro.answer{accept}----------|
  |<--intro.connect{peer_ik}-----------|   (only when both accepted)      |
  |--intro.invite{link}--------------->|--intro.link{link}-------------->|
  |<----------------- hs.init (§6.4, remote invitation) -----------------|
  |------------------------------ hs.resp ------------------------------>|
  |<------------------------------ hs.fin -------------------------------|
  |   connection.request.pending{introduced_by}; both members approve (SAS)
```

1. B's app sends `intro.create` naming two active connections, `a` and
   `c`, and what each will be shown of the other (`to_a` is shown to A
   about C, `to_c` to C about A): a `name` and an optional `note`, chosen
   by B and presented as B's words.
2. B's vault sends each an `intro.offer` with only that. Their apps show
   it (`intro.pending`) and their members accept or decline; each answer
   goes back to B only (`intro.answer`).
3. When **both** have accepted, B's vault sends A `intro.connect` with
   C's `ik` as B has it on record. A's vault makes a remote invitation
   (§6.4, TTL 24 h or the relay's maximum if lower) that it accepts only
   from that `ik` (an `hs.init` from another identity is dropped and
   audited, `drop.intro_mismatch`, and the invitation stays usable), and
   returns its link to B (`intro.invite`). B relays it to C
   (`intro.link`), and C's vault accepts it as `connection.invite.accept`
   would. A's member then approves the request as any remote one, with
   the SAS (§6.4); `connection.request.pending` carries
   `introduced_by` (A's connection id of B). C's member approves C's
   outgoing request with the same SAS (§6.4, 0.10.2);
   `connection.request.outgoing` carries `introduced_by` (C's connection
   id of B).
4. If either declines, B cancels, or the introduction has not been
   linked within 7 days, B's vault sends `intro.closed` to each party it
   had offered it to (except one that declined, which has closed its own
   copy), without a reason, and each closes its offer (A also cancels an
   invitation it made and that has not been used). If A cannot make the
   invitation it closes its copy and tells its devices; B's introduction
   then closes at its expiry.
5. **States.** At B: `offered` → `connecting` (both accepted) →
   `linked` (the link relayed) or `closed`. At A and C: `pending` →
   `accepted` → `connecting` or `closed`; a `connecting` offer is no
   longer subject to the 7-day expiry (the invitation's own lifetime
   governs). Ended records are kept 30 days for `intro.list`. Neither A nor C learns anything about the other
   beyond what B chose to show them before they answered: no key, relay
   address, link or answer of the other.

| Type | Request body | Response / event body |
|---|---|---|
| `intro.create` (app; desktop: step-up) | `{a, c, to_a: {name, note?}, to_c: {name, note?}}` | `{intro_id, exp}` |
| `intro.cancel` (app, desktop) | `{intro_id}` | `{}` |
| `intro.list` (app, desktop) | `{}` | `{made: [{intro_id, a, c, state, exp}], received: [{intro_id, connection_id, peer, state, exp}]}` |
| `intro.accept`, `intro.decline` (app; desktop: step-up for accept) | `{intro_id}` | `{}` |
| `intro.offer` (V↔V, B → A, C) | — | `{intro_id, peer: {name, note?}, exp}` |
| `intro.answer` (V↔V, A, C → B) | — | `{intro_id, accept}` |
| `intro.connect` (V↔V, B → A) | — | `{intro_id, peer_ik}` |
| `intro.invite` (V↔V, A → B) | — | `{intro_id, link}` |
| `intro.link` (V↔V, B → C) | — | `{intro_id, link}` |
| `intro.closed` (V↔V, B → A, C) | — | `{intro_id}` |
| `intro.pending` (V→D, apps and desktops of A and C) | — | `{intro_id, connection_id, peer, exp}` |
| `intro.event` (V→D, apps and desktops) | — | `{intro_id, event: "accepted" \| "declined" \| "connecting" \| "closed", connection_id?}`; B's devices get each answer (and `sync.event{intro.changed, state: "linked"}` once the link is relayed); A's and C's only `connecting` and `closed` |

- **Limits.** `a` ≠ `c`, both active connections of B; at most one open
  introduction per pair and 16 open per vault (`limit`); `name` 1–128
  bytes, `note` at most 256. A receiving vault keeps at most 4 open
  offers per introducer and 16 in all (more are dropped and audited,
  `drop.intro_limit`) and ignores a repeated `intro_id`. Since 0.23.0 an
  offer is an ask of the introducer (§10.4.1).
- **Authority.** A vault acts on `intro.answer` and `intro.invite` only
  from the party it sent the offer or `intro.connect` to, on
  `intro.connect`, `intro.link` and `intro.closed` only from the
  introducer of an offer it holds and accepted, and drops anything else
  (`drop.intro`). C's vault accepts the link only once and only while it
  holds the accepted offer.
- **What B learns** is each answer and that the link was relayed; the
  connection itself is between A and C.
- Removing or blocking a connection closes the introductions it takes
  part in (an introducer's offers are dropped without notice).
- Agents never introduce or answer introductions.
- **Audit and feed.** `intro.created`, `intro.offered` (on A and C),
  `intro.accepted`, `intro.declined`, `intro.connecting`, `intro.closed`
  (`ref` = `intro_id`); an offer is a high-priority feed item
  (`intro.request`); `sync.event{kind: "intro.changed", intro_id,
  state}`.

### 10.16 Location

A member shares their location with **one connection at a time**, by an
explicit, expiring share: once (a single position) or continuously
(positions at a cadence until an expiry), at a precision the member
chooses. The member's device sends positions to its own vault, which
reduces them to the share's precision and forwards them to the
connection's vault **from memory**: a position is never written to the
sending vault's state or outbox (§8.5). The receiving vault keeps the
latest position (and the trail, if the sharer allowed it) only while the
share is active. Either side can stop a share. A connection can ask the
member to share. Sent by `app` or `desktop` devices (a desktop within its
access session, §6.8), and by connections where marked; never by agents.

```
A app            A vault                          B vault                 B apps
  |--location.share.start-->|--location.shared{share_id,...}-->|--location.event{started}-->|
  |--location.update(lat,lon,...)-->|  reduce to precision; cadence
  |                         |--location.update{share_id,...} (ephemeral)-->|--location.update-->|
  |--location.share.stop--->|--location.stopped{share_id}----->|--location.event{stopped}-->|
```

| Type | Request body | Response / event body |
|---|---|---|
| `location.share.start` (app; desktop: step-up) | `{connection_id, mode: "once" \| "continuous", precision?, duration_seconds?, interval_seconds?, history?, request_id?}` | `{share_id, expires_at}`; `not_found`, `connection_unavailable`, `limit`, `bad_request` |
| `location.update` (D→V, ephemeral) | — | `<sample>`: `{lat, lon, accuracy_m?, altitude_m?, speed_mps?, heading_deg?, at}` |
| `location.update` (V↔V, ephemeral) | — | `{share_id, lat, lon, accuracy_m, altitude_m?, speed_mps?, heading_deg?, at}` |
| `location.update` (V→D, ephemeral) | — | `{connection_id, share_id, lat, lon, accuracy_m, altitude_m?, speed_mps?, heading_deg?, at}`, to apps and desktops |
| `location.share.stop` (app, desktop) | `{share_id}` (an outgoing or an incoming share) | `{}`; `not_found` |
| `location.share.list` (app, desktop) | `{}` | `{outgoing: [{share_id, connection_id, mode, precision, interval_seconds?, history, device_id, started_at, expires_at, last_sent_at?}], incoming: [{share_id, connection_id, mode, precision, interval_seconds?, history, started_at, expires_at, last?}]}` (active shares, sorted by `share_id`) |
| `location.get` (app, desktop) | `{connection_id, history?}` | `{share_id, mode, precision, expires_at, last?, history?}`; `not_found` without an active incoming share from that connection |
| `location.request` (app, desktop) | `{connection_id, note?}` | `{request_id}`; `limit` (one per connection per 10 minutes) |
| `location.shared` (V↔V) | — | `{share_id, mode, precision, interval_seconds? (continuous), history, expires_at}` |
| `location.stopped` (V↔V) | — | `{share_id}` |
| `location.requested` (V↔V) | — | `{request_id, note?}` |
| `location.event` (V→D) | — | `{event: "started" \| "stopped", direction: "in" \| "out", connection_id, share_id, mode?, precision?, expires_at?}` |
| `location.request.pending` (V→D) | — | `{request_id, connection_id, note?, exp}` |

- **Starting.** `mode` `continuous`: `duration_seconds` 300–604,800
  (default 3,600) and `interval_seconds` 10–3,600 (default 60); `once`:
  neither (`bad_request`), and the share lasts 15 minutes, the window in
  which its single position is delivered and shown. `precision` is
  `approximate` (the default, owner decision of 2026-10-03), `exact` or
  `city`. `history` (default
  `false`) lets the receiving vault keep the trail. `request_id` answers
  a `location.request.pending` (it closes it). A vault keeps one outgoing
  share per connection: a new start ends the old one (`location.stopped`
  first) and at most 64 outgoing shares (`limit`). The device that starts
  a share is its **source**: only that device's positions feed it.
- **Positions.** `lat` −90 to 90 and `lon` −180 to 180 (JSON numbers),
  `accuracy_m` 0–1,000,000, `altitude_m` ±100,000, `speed_mps`
  0–10,000, `heading_deg` 0 to less than 360, and `at` (the fix's time)
  no more than 5 minutes ahead and 1 hour behind. A device's
  `location.update` is ephemeral (no response, `exp` required, §8.5);
  invalid ones are dropped (`drop.location_malformed`).
- **Forwarding.** For each active outgoing share whose source is the
  sender, the vault forwards the position as V↔V `location.update`, from
  memory (§8.5), with `exp` = the earlier of the share's expiry and now +
  max(2 × interval, 60 s) (`once`: the share's expiry):
  - `continuous`: at most one position per 0.9 × `interval_seconds`
    (positions in between are dropped); `once`: the first position, after
    which the share ends;
  - reduced to the share's precision first: `exact` rounds `lat`/`lon` to
    5 decimals (about 1 m); `approximate` replaces them by the centre of
    their 0.01° cell (about 1 km), `accuracy_m` at least 1,000, and drops
    `altitude_m`, `speed_mps` and `heading_deg`; `city` uses a 0.1° cell
    (about 11 km) and `accuracy_m` at least 10,000. Cells are fixed, so a
    connection that sees a member cross a cell boundary learns that the
    member was near it; apps SHOULD say so.
- **Receiving.** A vault accepts `location.shared` from a connection (a
  new share replaces an earlier incoming share from it; at most 256
  incoming shares; a repeated or ended `share_id` is ignored; `expires_at`
  in the future and at most 7 days ahead), tells its apps and desktops
  (`location.event{started}`) and creates a feed item. It accepts a
  position only for an active incoming share **from the connection that
  sent it**, with `exp` at most 24 h ahead, at most one per
  max(5 s, interval / 2), and only one for a `once` share (others are
  dropped: `drop.location`, `drop.location_rate`,
  `drop.location_malformed`). It keeps the latest position as `last`
  (with `received_at`) and, if `history`, a trail of at most 1,000, and
  forwards each position to its apps and desktops from memory
  (`exp` now + 60 s).
- **Stopping and expiry.** `location.share.stop` of an outgoing share
  ends it and tells the connection (`location.stopped`); of an incoming
  share it deletes it and asks the sharer to stop (`location.stopped`),
  which ends it there (`location.event{stopped, direction: out}`). At
  `expires_at` both vaults end the share without a message. The receiving
  vault deletes an incoming share **with its positions** when it stops or
  expires; nothing of it is kept.
- **Requests.** `location.request` sends `location.requested`; the
  receiving vault accepts one per connection per 10 minutes and at most
  16 pending (24 h), tells its apps and desktops
  (`location.request.pending`) and creates a feed item. There is no
  decline message: the member answers by starting a share, or not.
  Since 0.23.0 a request is an ask (§10.4.1): mute, pause, the pending
  cap and the ask rate apply; it has no cooldown. A suppressed request
  does not use the one-per-10-minutes allowance (0.23.1): only a request
  that reaches the member does.
- Removing or blocking a connection drops every share and request with
  it (§7.4).
- **Audit and feed.** `location.share.started`, `location.share.stopped`
  (`direction` out or in), `location.share.received`,
  `location.share.ended`, `location.requested` (both sides) (`ref` =
  `share_id` or `request_id`, never a position); feed items
  `location.shared` and `location.request`; `sync.event`
  `location.share.changed{share_id, state: "active" | "ended"}`.
- **Retention is the peer's.** The receiving vault deletes positions as
  above, but the receiving member's devices have seen them, and a vault
  is only trusted for what its own member decides (§2.1): precision,
  cadence and expiry, which the sending vault enforces, are the
  protection.
- Location is not shared through share rules or grants (§10.12): every
  share is its own consent.

**The member's location log** (owner decision of 2026-10-03). The
member may have their vault keep their **own** location history. It is
separate from sharing: the log is never shared by share rules, grants or
actions, and leaves the vault only as a snapshot the member sends through
one of their existing location shares. There is no export or backup of
it outside the service (owner decision). History's export (§10.9,
0.22.0) holds the `location.*` audit entries, as History shows them,
never a position.

| Type | Request body | Response / event body |
|---|---|---|
| `location.history.list` (app; desktop: step-up) | `{from?, to?, after?, limit?}` | `{enabled, retention_days, interval_seconds, count, points: [{lat, lon, accuracy_m, at}], next?}`, oldest first |
| `location.history.delete` (app; desktop: step-up) | `{from?, to?}` (neither: everything) | `{deleted}` |
| `location.history.share` (app; desktop: step-up) | `{share_id, from, to}` | `{sent}`; `not_found` (no such active outgoing share), `connection_unavailable` |
| `location.snapshot` (V↔V) | — | `{share_id, points: [{lat, lon, accuracy_m, at}]}` (at most 500) |
| `location.event` (V→D) | — | also `{event: "snapshot", direction: "in", connection_id, share_id, points}` |

- **Settings** (§10.8): `location.history.enabled` (default `false`),
  `location.history.retention_days` (1–365, default 30) and
  `location.history.interval_seconds` (60–3,600, default 300).
- **Recording.** While enabled, the vault records the positions its
  member's devices send (`location.update`, D→V; the app sends them at
  the member's cadence whether or not it is sharing), at most one per
  0.9 × `interval_seconds`, with `lat`/`lon` rounded to 5 decimals and
  `accuracy_m`, without altitude, speed or heading. A recorded position
  is a write to DEK state at the batch's flush; because the device's
  message is ephemeral (§8.5) a crash before that flush loses it.
- **Bounds.** Positions older than the retention are dropped. Older
  positions are thinned: all of the last 24 hours are kept, then at most
  one per 15 minutes up to 7 days, then one per 3 hours. The log holds at
  most 5,000 positions (the oldest go first): a year at the finest
  cadence is about 4,900 positions, about 400 KB of state.
- **Access.** Only the member's apps, and desktops with an app's
  approval of each request (§6.8), list, delete or share the log; agents
  and connections never. `list` filters by `from` and `to` (inclusive)
  and pages by `after` (the `at` of the last position returned, `next`);
  `limit` 1–1,000 (default 500).
- **Deleting.** `location.history.delete` removes the positions in a
  range, or all of them. Turning `location.history.enabled` off deletes
  the whole log at once (apps warn first). Deletions are audited
  (`location.history.deleted`, `ref` = the number deleted) and send
  `sync.event{kind: "location.history.changed", count}`.
- **Snapshots.** `location.history.share` sends the connection of an
  active outgoing share the positions between `from` and `to` (the newest
  500 if more), reduced to that share's precision, as
  `location.snapshot`. The receiving vault accepts it only for an active
  incoming share from that connection, keeps it with the share (as
  `snapshot` in `location.get`) and deletes it with the share; it tells
  its apps and desktops (`location.event{snapshot}`). Audited as
  `location.history.shared` and `location.history.received`
  (`ref` = `share_id`).

### 10.17 Presence

Presence is on demand (§9.2): no heartbeats.

| Type | Request body | Response / event body |
|---|---|---|
| `presence.get` (app, desktop) | `{}` | `{version, state, share, except}` |
| `presence.set` (app; desktop: step-up) | `{version, state?, share?, except?}` | `{version}`; `conflict` |
| `presence.query` (app, desktop) | `{connection_id}` | `{ping_id, exp}`; `not_found`, `connection_unavailable` |
| `presence.ping` (V↔V, ephemeral) | — | `{ping_id}` |
| `presence.pong` (V↔V, ephemeral) | — | `{ping_id, state, last_active?}` |
| `presence.result` (V→D, ephemeral) | — | `{connection_id, ping_id, state, last_active?}`, to the asking device |

- **The policy** is one versioned object (§10.1): `state` is
  `available` (the default), `busy`, `away` or `invisible`; `share` is
  `all` (the default) or `none`; `except` (0–1,024 connection ids,
  deduplicated and sorted) inverts `share` for those connections, so a
  member can turn presence off (or on) per connection. Absent members of
  `presence.set` keep their values. Changes send
  `sync.event{kind: "presence.changed", version}`.
- **Asking.** `presence.query` sends the connection `presence.ping` (from
  memory, `exp` = now + 30 s) and answers `{ping_id, exp}`. A vault pings
  each connection at most once a minute: a query within the minute
  returns the earlier `ping_id` and `exp` (and repeats its result if one
  arrived). If no result arrives before `exp`, the app shows presence as
  unknown.
- **Answering.** A vault answers a ping with `presence.pong` (from
  memory, `exp` = now + 30 s) only if its `state` is not `invisible`, its
  policy shares with that connection, it has not answered that
  connection in the last minute, and it is not held (§3.6.3). Otherwise it **does not answer**: a
  refusal is indistinguishable from a locked or offline vault.
  `last_active` is the newest activity of the member's apps and desktops
  (§10.3), rounded down to 5 minutes; it is absent when none is known.
- The asking vault accepts a pong only for a pending ping it sent to that
  connection, before its `exp`, with `state` `available`, `busy` or
  `away` and `last_active` not in the future, and sends the asking device
  `presence.result` from memory (`exp` = now + 60 s). Anything else is
  dropped without an audit entry. Pings are not audited.
- Removing or blocking a connection removes it from `except` and drops
  its pings (§7.4). Agents never ask or answer.

### 10.18 Wallet

The member's Bitcoin wallets. Each wallet is one BIP39 recovery phrase
with **two accounts**: BIP86 (taproot, P2TR key path, BIP340 Schnorr
signatures) and BIP84 (native segwit v0, P2WPKH). The phrase is a
**critical item** (§10.7): its values are encrypted under an item key
that only the Protean Credential holds, so the vault cannot spend
without the member's password. The vault keeps both account keys (the
public halves) in DEK state and derives receive and change addresses
without the password. New wallets receive on P2TR (owner decision).
**The vault never talks to a chain** (owner decision): the member's app
finds the wallet's coins with its own chain source, builds a PSBT
(BIP174), and the vault checks and signs it; the app broadcasts the
transaction.

```
app (chain source)                                   vault
  |-- wallet.create{address_type?, credential, sealed{password, item?{mnemonic}}} -->|  critical item + both account keys
  |   (an imported phrase: scans both accounts' descriptors, then wallet.update{address_type})
  |-- wallet.address.new ------------------------------------------->|  m/86'/c'/0'/0/i (or m/84'/…)
  |   (finds coins and previous transactions on its chain source)
  |-- wallet.psbt.inspect{psbt} ------------------------------------>|  the vault's summary: shown to the member
  |-- credential.unlock, then wallet.sign{psbt, credential, sealed{password, item_id, payload_sha256}} -->|
  |<-- {txid, tx, summary, credential, ...} -------------------------|
  |   (broadcasts tx)
```

| Type | Request body | Response body |
|---|---|---|
| `wallet.create` (app) | `{name, network?, address_type?, tags?, credential, utk_id, sealed{password, item?}}`; `item` = `{mnemonic, passphrase?}` to import a phrase | `<wallet>` and `{credential, credential_version, utks}`; `limit`, `bad_request` |
| `wallet.list` (app, desktop) | `{}` | `{wallets: [<wallet>]}` |
| `wallet.get` (app, desktop) | `{wallet_id}` | `<wallet>` |
| `wallet.update` (app, desktop) | `{wallet_id, version, address_type}` | `{version}`; `conflict` |
| `wallet.address.new` (app, desktop) | `{wallet_id, type?, change?, label?}` | `<address>`; `limit` |
| `wallet.address.list` (app, desktop) | `{wallet_id, type?, change?, after?, limit?}` | `{addresses: [<address>], next?}` |
| `wallet.address.used` (app, desktop) | `{wallet_id, addresses: [<address string>]}` (1–256) | `{marked, version}` |
| `wallet.psbt.inspect` (app, desktop) | `{wallet_id, psbt}` | `<summary>`; `invalid_psbt` |
| `wallet.sign` (app) | `{wallet_id, psbt, broadcast?, credential, utk_id, sealed{password, item_id, payload_sha256}}` | `<summary>` and `{tx, credential, credential_version, utks}`; `credential_locked`, `invalid_psbt`, `unavailable` (`broadcast` without a chain source) |
| `wallet.history` (app, desktop) | `{wallet_id, limit?}` (1–200, default 50) | `{transactions: [{txid, at, sending_sats, change_sats, fee_sats, payees: [{address, amount_sats}], connection_id?, invocation_id?}]}`, newest first |
| `wallet.balance` (app, desktop) | `{wallet_id}` | `{confirmed_sats, unconfirmed_sats}`; `unavailable` without a vault-side chain source (every release) |

```json
wallet:  { "wallet_id": "<item_id>", "version": 4, "name": "Savings", "network": "mainnet",
           "fingerprint": "73c5da0a", "address_type": "p2tr",
           "accounts": [
             { "type": "p2tr", "path": "m/86'/0'/0'", "xpub": "xpub6…",
               "descriptors": { "receive": "tr([73c5da0a/86'/0'/0']xpub6…/0/*)", "change": "tr([…]xpub6…/1/*)" },
               "next_receive": 3, "next_change": 1 },
             { "type": "p2wpkh", "path": "m/84'/0'/0'", "xpub": "xpub6…",
               "descriptors": { "receive": "wpkh([73c5da0a/84'/0'/0']xpub6…/0/*)", "change": "wpkh([…]/1/*)" },
               "next_receive": 0, "next_change": 0 } ],
           "created_at": "<ts>" }
address: { "address": "bc1p…", "type": "p2tr", "index": 2, "change": false, "path": "m/86'/0'/0'/0/2",
           "label": "…?", "connection_id": "<id>?", "used": false, "issued_at": "<ts>" }
summary: { "txid": "<64 hex>", "inputs": [{"txid", "vout", "amount_sats", "type", "path"}],
           "outputs": [{"address", "amount_sats", "change", "type?", "path?"}],
           "total_in_sats", "sending_sats", "change_sats", "fee_sats", "vsize" }
```

- **Networks.** `network` is `mainnet` (the default), `testnet` (testnet3
  and testnet4), `signet` or `regtest`; coin type 0 on mainnet and 1
  otherwise. A release accepts `mainnet`, `testnet` and `signet`;
  `regtest` only development builds. `xpub` is an account key in BIP32
  serialisation (`xpub`/`tpub` versions, for both accounts);
  `fingerprint` is the master key's.
- **Accounts.** Every wallet holds the BIP86 account m/86'/c'/0' (`type`
  `p2tr`: key-path-only outputs, the output key tweaked with no script
  tree as BIP86 says) and the BIP84 account m/84'/c'/0' (`p2wpkh`).
  `address_type` names the account that receives: new addresses
  (`wallet.address.new` without `type`) and `wallet.request-address`
  (§10.14) come from it. It is `p2tr` by default.
- **Imported phrases.** The vault cannot tell which account of an
  imported phrase has history. The app scans both accounts' descriptors
  on its chain source and sets the receiving account, at
  `wallet.create{address_type}` or afterwards with `wallet.update`
  (versioned, §10.1). Coins of either account can be spent, together, in
  any PSBT, and change can go to either account.
- **Create.** One credential operation (§3.5.3). Without `item` the vault
  generates 256 bits of entropy (a 24-word phrase); with it, it imports
  `mnemonic` (12, 15, 18, 21 or 24 BIP39 English words, any case and
  spacing, checksum verified, stored in canonical form) and `passphrase`
  (printable ASCII, at most 256 bytes: the enclave has no Unicode
  normalisation). The vault creates a critical item (`category`
  `crypto_wallet`, `template` `wallet.btc`, `name`, `tags`) with two
  `password` fields, "Recovery phrase" and "Passphrase", and keeps both
  accounts. `wallet_id` is the item's `item_id`. A vault holds at most
  16 wallets.
- **The phrase is the member's.** The member backs it up with
  `item.reveal` of the wallet's item (values sealed to a reply key,
  §10.7). The wallet owns its item: `item.put` and `item.sensitivity` of
  it are refused with `in_use` (a changed phrase would no longer match
  the accounts); `item.tag` works as for any item; `item.delete` of it
  (a credential operation) or `credential.reset` deletes the wallet
  (`sync.event{wallet.deleted}`). A share rule that matches the item can
  make it at most usable (§10.13), for which a phrase is `unsuitable`.
- **Addresses.** `wallet.address.new` issues the next index of an
  account's receive chain (or its change chain with `change: true`); at
  most 2,000 addresses per wallet, both accounts together.
  `wallet.address.used` records addresses the app saw funded, so that a
  connection's address is replaced (`wallet.request-address`, §10.14).
  `wallet.address.list` lists one account and chain (`type` defaults to
  `address_type`); `next` pages by `index`; `limit` 1–500 (default 100).
- **The signing policy.** The vault signs a PSBT (`psbt`: standard base64
  of BIP174 version 0, at most 65,536 bytes) only if:
  - it has 1–64 inputs and 1–64 outputs, transaction version 1 or 2;
  - every input spends an output of **one of the wallet's accounts**,
    shown by a derivation with the wallet's fingerprint, which the vault
    re-derives and checks with the output script:
    - P2WPKH: a BIP32 derivation m/84'/c'/0'/{0,1}/i with the
      compressed key;
    - P2TR: a taproot BIP32 derivation m/86'/c'/0'/{0,1}/i with the
      x-only internal key and no leaf hashes (and `tap_internal_key`, if
      present, MUST equal it); the vault applies the BIP86 tweak and
      compares the output key. Script-path data (`tap_leaf_script`,
      `tap_merkle_root`, script-spend signatures) is refused;
  - every input carries the **full previous transaction**, whose txid
    MUST equal the outpoint's (and `witness_utxo`, if present, MUST equal
    that output), so the amounts the vault signs for are the real ones (a
    lying source cannot make two signatures over misstated amounts,
    CVE-2020-14199). Taproot signature hashes commit to every input's
    amount and script (BIP341), so the vault computes them only from
    these verified outputs; no duplicate inputs, no finalised or
    partially signed inputs; sighash SIGHASH_ALL, or for P2TR
    SIGHASH_DEFAULT (the absent sighash) or SIGHASH_ALL;
  - every output is a standard address (P2PKH, P2SH, P2WPKH, P2WSH or
    P2TR) of the wallet's network, of at least 330 sats; an output with
    one of the accounts' derivations (BIP32 or taproot, as for inputs),
    re-derived and checked, is **change**;
  - the fee (inputs minus outputs) is positive and at most 1,000 sat/vB of
    the signed transaction's virtual size (its stripped size, plus per
    input a P2WPKH witness of 108 weight units or a P2TR one of 66, 67
    with SIGHASH_ALL).

  Otherwise the answer is `invalid_psbt` with a short reason as
  `message` (`malformed`, `foreign_input`, `previous_tx`,
  `derivation_key`, `internal_key`, `input_script`, `fee_rate`,
  `other_payee`, …). `wallet.psbt.inspect` applies the same checks
  without the credential and returns the summary that `wallet.sign`
  would sign for; apps MUST show it (the payees, amounts, change and fee)
  to the member before asking for the password.
- **Spending is a critical action.** `wallet.sign` is app only, needs the
  credential's unlock window (`credential_locked` otherwise, before the
  UTK is spent) and is one credential operation: the UTK payload's
  `item_id` MUST be the wallet and `payload_sha256` the SHA-256 of the
  PSBT's bytes (`bad_request` otherwise), so the password authorises this
  PSBT of this wallet only. The vault decrypts the phrase with the item
  key, derives the keys of both accounts (checking them against the
  stored account keys), signs every input (ECDSA for P2WPKH; a BIP340
  Schnorr key-path signature with the BIP86-tweaked key for P2TR),
  checks each signature with the script engine, re-keys the item
  (§10.7), rotates the CEK and wipes the phrase, seed and keys. It
  returns the final transaction (`tx`, hex) and its `txid`;
  `broadcast: true` is `unavailable` in every release. Signed
  transactions are kept in the history (the latest 200), their inputs'
  and change outputs' addresses marked used, and the change account's
  `next_change` moves past the change the PSBT used.
- Agents never use wallets: no wallet type is delegable (§10.11).
  Desktops read, issue addresses, choose the receiving account and
  inspect, but never create or sign.
- **Change notices.** `sync.event` `wallet.changed{wallet_id, version}`
  (created, receiving account changed, addresses issued or used),
  `wallet.signed{wallet_id, txid}`, `wallet.deleted{wallet_id}`.
- **Audit and feed.** `wallet.created`, `wallet.deleted`
  (`ref` = `wallet_id`), `wallet.address_issued` (to a connection;
  `ref` = `wallet_id`), `wallet.signed` (`ref` = `txid`, also a feed
  item). No address, amount or key is in the audit log.
- **Chain access (§12.2).** The enclave reaches only the relay, KMS and
  the attestation status list. A vault-side chain source (an allowlisted
  chain API) is not part of this version; the reference implementation
  keeps an interface for it (`wallet.balance`, `broadcast`).
- `crypto_keys` in the credential (§3.5.2) stays reserved and empty:
  wallets are critical items.

## 11. Enrollment and unlock (alternate channel)

### 11.1 Path and routing

```
app --HTTPS--> member API /api/vault/* --> SQS queue of the leased instance --> parent --vsock--> enclave
app <--poll--- GET /api/vault/requests/{id} <-- response slot <-------------- parent <---------- enclave
```

**Routes:**

- `POST /api/vault/enroll/redeem` (0.15.0, §11.12)
- `GET /api/vault/enclave`
- `POST /api/vault/enroll`
- `POST /api/vault/unlock`
- `POST /api/vault/lock`
- `GET /api/vault/requests/{id}`
- `GET /api/vault/status`

**Who calls them** (0.15.0). Apps never hold a member session: every app
request is signed by the app's **app key** (§11.12), and the API finds the
vault and the member from it. The account portal keeps its session and
uses only `status`, `lock` and `requests/{id}` of these, plus the recovery
routes (§11.11.7) and the enrollment-code routes (§11.12.1).

The routes follow MEMBER-API conventions; errors use the MEMBER-API error
body `{error, message}` and add `code` (equal to `error`) and any fields
named here. Each request envelope is sealed to
an instance's ETK and padded to a fixed size (12,288 bytes for
`vault.enroll` and `vault.unlock`, 4,096 otherwise, §5.4), and the API, queue and parent see only opaque bytes.
The enroll and unlock bodies also carry `manifest_sha256` in the clear
(64 lowercase hex, REQUIRED; otherwise `400 bad_request`), the hash of the
public manifest the sealed request names, so that the host can supply
that manifest to the enclave (§11.5, "Manifest by hash").

**Access.** Enrollment requires a member in state `member` who has
accepted the current terms: the portal checks it when it issues the
enrollment code, and the redeem checks again that the account is an
active member (§11.12.1). Since 0.15.0 later requests (`enclave` for an
enrolled vault, unlock, register) need an active account but not the
current terms: the vault keeps working when the terms change, and the
portal and the app (through the account snapshot, §11.13) ask the member
to accept. Lock and status stay available for an existing vault
whatever the account state, because locking only reduces exposure.
Cancelling the account blocks vault access (every route but lock) at once;
after the 7-day grace period the API deletes the member's vault rows, the
stored encrypted state and headers (`vaults/<vault_id>/`), and the
enclave's member index object (`users/<hex SHA-256("vettid/vms/2/user" ||
0x00 || user_guid)>/vault`, which holds only a `vault_id`) (§11.5).

**Instances and leases:**

- Each enclave instance owns **one SQS queue**
  (`<deployment prefix>vault-control-<instance_id>`; vettid.org uses the
  prefix `vettid-org-`), which the parent creates at boot and deletes at
  shutdown. `instance_id` matches `[A-Za-z0-9_-]{1,48}`. The API sends only
  to that name in its own account. A sweeper removes queues of instances
  that have gone away.
- The instance publishes `{instance_id, release, queue_url, descriptor,
  attestation, heartbeat_at}` to an **instance registry** and heartbeats at
  least every 30 s. An instance whose `heartbeat_at` is more than 90 s old
  is **not live**.
- A per-instance queue was chosen over a shared queue with message
  attributes, because SQS cannot filter deliveries by attribute. On a shared
  queue, every instance would receive, and have to return, every other
  instance's messages.
- **A vault is held by at most one instance**, recorded as the lease
  `{instance_id, lease_expires_at}` in its vault-table row (§11.5):
  - The parent acquires the lease with a conditional write, which succeeds
    only if the lease is absent, expired, already its own, or held by an
    instance that is not live (below). Taking over a non-live holder's
    lease is conditional on the exact lease value it replaces
    (`instance_id` and `lease_expires_at`), so two instances cannot both
    take it.
  - The parent acquires the lease **before** it forwards an enroll or
    unlock to the enclave. If another instance holds the lease, the
    parent does not forward the request: it deletes the message and marks
    the response slot `expired` (§11.5, §11.9). If the request does not
    leave the vault open (a refused unlock, a failed enrollment), the
    parent releases the lease again.
  - While the vault is unlocked, the parent renews the lease every 60 s,
    with a lease length of 180 s. A renewal that finds another holder, or
    renewals that keep failing until 15 s before the lease expires, mean
    the lease is **lost**: the enclave locks the vault (§12.3).
  - The parent releases the lease on lock, except for the lock that an
    enroll or unlock makes of the vault it is about to open (§11.4):
    that request's lease stays, and the parent releases it only if the
    vault does not open (0.23.3).
- **Routing for `GET /api/vault/enclave`:**
  - If the vault has a live lease, the API returns the descriptor of the
    leased instance.
  - Otherwise, it returns a live instance **of the vault's
    `sealed_release`** chosen by load, or starts one (§11.10.5). That
    instance takes the lease when it processes the request.
  - Enrollment goes to an instance of an `active` release.
- **Routing for posted requests.** A request names the instance whose ETK it
  was sealed to. The API forwards it only if that instance still holds the
  lease, or if there is no live lease. Otherwise it answers `409
  instance_moved`, and the app refetches the descriptor and re-seals.
- A lease is **live** only while it is unexpired and its holder is live.
  `lease_expires_at` and `heartbeat_at` are Unix seconds (numbers); the
  lease is the vault-table map attribute `lease = {instance_id,
  lease_expires_at}`, written only by the parent.
- **Leases are a routing aid.** Correctness still rests on the split-brain
  guard (§12.3). If two instances both believed they held a vault, the second
  conditional state write would fail and that instance would lock it.

### 11.2 Enclave transport key

At start, and then at least every 24 h, each instance generates an ETK and
publishes a **descriptor**:

```json
{ "v": 1, "suite": 2, "instance_id": "<id>", "kid": "<hex>", "etk": "<b64 ek>",
  "release": "<PCR0 hex>", "not_after": "<RFC 3339, ≤ issue + 24 h>" }
```

The enclave obtains a Nitro attestation document whose `user_data` is
`SHA-256("vettid/vms/2/etk" || descriptor_bytes)`. The member API serves the
exact descriptor bytes together with the attestation document.

The app MUST:

1. verify the attestation chain up to the AWS Nitro root, evaluated at the
   document's timestamp (signing certificates are short-lived; step 3
   bounds the document's age);
2. match PCR0, PCR1 and PCR2 against an entry of VettID's signed release
   manifest (§11.10.1), rejecting debug (all-zero) PCRs: an `active` entry
   to enroll, any listed entry to unlock;
3. check `user_data`, check `not_after`, and check that the attestation is
   less than 26 h old;
4. tell the user before sending a PIN if `release` differs from the release
   the app last unlocked into ("vault software was updated"), and never send
   a PIN to an older release than that one (§11.10.6).

The previous ETK stays valid for 1 h after rotation. ETK private keys never
leave enclave memory.

### 11.3 Enrollment

**The `vault.enroll` request** is sealed to the ETK of the instance named by
`GET /api/vault/enclave`:

```json
{ "user_guid": "<from the redeem, §11.12.1>", "request_id": "<ULID>", "nonce": "<b64 32 B>",
  "pin": "<digits>",
  "app": { "ik": "<b64>", "kem": "<b64 ek>",
           "relay": {"url": "<base>", "mailbox": "<id>", "pk": "<b64>"},
           "open_token": "<open token for MB(app), ≤ 10 min>", "name": "<device name>",
           "device_attest": { }, "api_key": "<b64 SPKI DER, P-256>" },
  "manifest_sha256": "<64 hex>", "manifest_serial": 7 }
```

`device_attest` is REQUIRED (§11.7). `app.api_key` (0.15.0) is REQUIRED:
the app key that signs the app's member API requests (§11.12); the vault
keeps it with the app's unlock key in the sealed header (`app_key_seq`
1) and reports it to the host. `manifest_sha256` (64 lowercase hex,
SHA-256 of the exact manifest bytes) and `manifest_serial` (that
manifest's `serial`) are REQUIRED and name the manifest the app verified
(§11.10.1). The request does not carry the document: the host supplies it
(§11.5, "Manifest by hash"), and the enclave verifies it and its match
with these two fields, finds its own release's entry (which must be
`active`) and verifies its own sealing key (§11.10.7) before sealing the
first header. The request is padded to exactly 12,288 bytes (§5.4).

**The vault PIN** is 6–32 ASCII digits (owner decision, 2026-10-04) in
every message that sets or checks one: `vault.enroll`, `vault.unlock`, a
transfer's approval (§6.7.1) and `pin.change` (`pin` and `new_pin`). The
enclave refuses any other value as malformed before deriving anything from
it. Apps also refuse weak PINs (repeats, runs such as 123456, short repeated
patterns, common PINs); the vault does not judge strength. No vault exists
with a shorter PIN, so none is migrated.

```
App               Relay        Member API               SQS/Parent       Enclave
 | gen keys          |               |                    |                 |
 |--register MB(app)->|              |                    |                 |
 |--POST /api/vault/enroll/redeem{secret | email+code, app_key}, §11.12.1
 |<--{vault_id, user_guid, email_hint}-|                    |                 |
 |--GET /api/vault/enclave (signed)-->|  (instance chosen) |                 |
 |<--descriptor + attestation--------|                    |                 |
 | verify (§11.2); attest device key (§11.7, in envelope) |                 |
 |--POST /api/vault/enroll{request_id, instance_id, etk_kid, envelope}|
 |                   |      assign vault_id;              |                 |
 |                   |      row: enrolling                |                 |
 |                   |               |--enqueue{vault_id}->|--vsock bytes-->|
 |<--202{vault_id}-----------------------|                |   decrypt; bind checks; device attestation;
 |                   |               |                    |   gen keys; DEK(PIN); header
 |                   |<======== register MB(vault) (TLS from enclave) =====|
 |                   |               |                    |   persist (create-only)
 |                   |<======== deposit vault.enrolled (open token) =======|
 |                   |               |<--lifecycle{unlocked, versions}-----|
 |--collect--------->|               |                    |                 |
 |<--vault.enrolled--|  verify attestation (nonce, user_data, PCRs); pin bundle
 |--hs.init (purpose=app) ... hs.fin ===================================> vault
 |--credential.utk.get, credential.create, vault.enroll.confirm =========> vault (§3.5.7)
```

**`vault.enrolled`** is sealed to the app's `kem`:

```json
{ "request_id": "<ULID>", "vault_id": "<id>", "state_seq": 1,
  "attestation": "<b64 COSE_Sign1: nonce = app nonce, user_data = SHA-256('vettid/vms/2/vault' || vault_bundle)>",
  "vault_bundle": "<b64 exact bytes of {v, suite, ik, kem, relay{url, mailbox, pk}}>",
  "token": "<standing token for MB(vault), sub = app relay key>" }
```

**`vault.enroll.result`.** Whatever the outcome, the enclave also answers in
the response slot (§11.5) with `vault.enroll.result`, sealed to `app.kem`
and padded to exactly 4,096 bytes, its inner `re` equal to `request_id`:

- `{"ok": true, "vault_id": "<id>"}`; `vault.enrolled` follows over the
  relay;
- `{"ok": false, "code": "vault_exists|release_key|manifest|attestation|bad_request|retry"}`.

A request the enclave cannot read or bind (wrong key, binding failure,
replay, malformed `app.kem`) is answered with random bytes of the same
size (§11.4).

**Rules:**

- **Binding.** The enclave MUST reject the request if `user_guid`,
  `request_id` or (0.15.0) `app.api_key` in the ciphertext differ from
  the queue message (`app_key`, §11.5), or if the
  inner `ts` (§5.3) is more than 5 minutes off. The inner `id` of an
  alternate-channel request equals its `request_id`, and its `sender_kid`
  is all-zero. It records the queue's `vault_id` in the sealed
  header and in vault state.
- **Provisional vaults.** A new vault stays **provisional** until
  `vault.enroll.confirm` arrives. If no confirmation arrives within 24 h, a
  new enrollment for the same member MAY replace it. A confirmed vault MUST
  NOT be replaced: the enclave answers `vault_exists`.
- **Re-enrollment.** The API assigns `vault_id` once per member: a new
  enrollment carries the member's existing `vault_id` unless the vault was
  deleted. For an enrollment whose `vault_id` already holds a vault, the
  enclave answers `vault_exists` if the vault is confirmed, provisional
  for less than 24 h, or sealed to another release (it cannot tell), and
  otherwise replaces it. The enclave also keeps its own index from a member
  to a vault and applies the same rule to a different `vault_id` of the
  same member.
- **App state.** The app stores `vault_id`, the pinned bundle, the release
  and `state_seq` (§13.2).
- **Release.** The enrolling instance's release becomes the vault's
  `sealed_release`; the header is sealed to it (§11.10.2) after the key
  check of §11.10.7. If the check fails, enrollment fails with
  `release_key`.
- **The first app's handshake.** After `vault.enrolled`, the app sends
  `hs.init` with purpose `app` and `ctx` = `vault_id`, deposited with the
  token from `vault.enrolled`. The vault answers it without approval if,
  and only if, `from.ik` and the collect `sender` equal the keys bound at
  enrollment and the 24 h provisional window has not passed.

### 11.4 Unlock

**The `vault.unlock` request** is sealed to the leased instance's ETK:

```json
{ "user_guid": "...", "vault_id": "...", "request_id": "<ULID>",
  "device_ik": "<b64>", "pin": "<digits>",
  "min_state_seq": 1234, "min_header_seq": 1301,
  "token": "<fresh standing token for MB(device), sub = vault relay key>",
  "device_assertion": { },
  "manifest_sha256": "<64 hex>", "manifest_serial": 7,
  "release_update": { "to": "<pcr0 hex>", "to_release": 5, "approval": { } },
  "cancel_recovery": true,
  "sig": "<b64 Ed25519 by device_ik>" }
```

`manifest_sha256` and `manifest_serial` are REQUIRED and name the manifest
the app verified, exactly as in `vault.enroll` (§11.3); the host supplies
the document (§11.5). `release_update` is present only when the member approved a release update
(§11.10.3). The request is padded to exactly 12,288 bytes (§5.4).

`device_assertion` is REQUIRED (§11.7). `sig` covers the following string,
where each `\n` is a literal newline:

```
"vettid/vms/2/unlock" \n user_guid \n vault_id \n request_id \n ts \n etk_kid_hex \n
min_state_seq \n min_header_seq \n hex(SHA-256(pin)) \n hex(SHA-256(token)) \n
hex(SHA-256(manifest_bytes)) \n to_pcr0_hex_or_empty
```

`ts` is the request's inner `ts` (§5.3). The line
`hex(SHA-256(manifest_bytes))` is exactly the request's `manifest_sha256`
(the string is unchanged from 0.9.1). Integers are decimal, hex is
lowercase, and there is no trailing newline. No field may contain CR or LF.
When the request carries `cancel_recovery` (present only as `true`,
§11.11.4), the string has a thirteenth line, the literal
`cancel_recovery`.

```
App        Member API                   SQS/Parent                 Enclave
 |--POST /api/vault/unlock{vault_id, request_id, instance_id, etk_kid, envelope}
 |          check lease             |--enqueue--->|--vsock bytes--->|
 |<--202----|                       |             |  replay check; sealed header;
 |          |                       |             |  vault_id/user_guid; unlock key + sig;
 |          |                       |             |  device attestation sig; backoff; rollback
 |          |                       |             |  (§13.2); derive DEK; load state
 |          |<--response slot{request_id, envelope}----------------|
 |--GET /api/vault/requests/{id} (1 s poll)-->|                    |
 |<--{status: done, envelope}----------------|   on success: §12.2 start order
```

**`vault.unlock.result`** is sealed to the device's `kem` from the sealed
header and padded to 4,096 bytes. Its inner `re` is the request's
`request_id` and its `status` is `ok` (the outcome is in the body), so a
result cannot be presented as the answer to another request. Its body is
one of:

- `{"ok": true, "state_seq": n, "header_seq": m, "token": "<standing token for
  MB(vault)>", "release": "<PCR0 hex>", "release_number": r,
  "release_status": "active|deprecated|retired|removed", "manifest_serial": s,
  "update": {"to": "<pcr0>", "result": "moved|refused|abandoned", "code": "<reason>"},
  "recovery_cancelled": true, "vault_bundle": "<b64>", "credential_backup": true|false}`
  — `update` is present only if the request carried `release_update`, or a
  pending move was completed (§11.10.4). After `moved` the vault is locked
  and sealed to the new release; `header_seq` is the new header's, and
  `token` is absent (the vault did not resume).
  — `recovery_cancelled` is present when the unlock cancelled a recovery
  (§11.11.4); `vault_bundle` and, after it, `credential_backup` (0.10.6) only for the app a recovery registered
  (§11.11.5). Since 0.16.0 `credential_backup` is always `true` there
  (a vault without a backup copy refuses that unlock with `no_backup`);
  apps MUST NOT rely on it and MAY ignore it.
- `{"ok": false, "code": "bad_pin|backoff|unknown_device|attestation|state_rollback|vault_missing|manifest|wrong_release|release_key|retry|recovery_pending|no_backup",
  "header_seq": m, "retry_after": <s>}` — `recovery_pending`: a recovery
  is in progress and the request did not cancel it (§11.11.4); it is
  answered before the PIN is tried and is not a PIN failure.
  `no_backup` (0.16.0): only to the app a recovery registered, when the
  vault, once opened with the PIN, keeps no backup copy of its
  credential (§11.11.5 step 1). Nothing else is in the body: no token,
  no `vault_bundle`; the vault removes the recovery and the registered
  unlock key and locks again.

**Unlock of a running vault (0.23.3).** An unlock of a vault that is
already unlocked is processed like any other: there is no "already
unlocked" answer, because the PIN, the device assertion, the minimum
sequence numbers and any `release_update` are checked by every unlock,
and its result carries a fresh token. The enclave first locks the
running vault as for an owner request (§12.3: the batch, the flush,
`vault.locking`, the lifecycle `locked`), then opens it with the
request; an unlock that fails leaves the vault locked. The lease the
request took stays across that lock (§11.1). The result's inner `ts` is
set after the lock, so the lock's `vault.locking` is never later than
the result. That notice is relayed and can reach the app after the
result (as can the lock before a release update's confirming unlock,
§11.10.6): an app MUST ignore a `vault.locking` whose `ts` is not later
than that of the latest successful unlock result it received.

On `state_rollback`, the app MUST warn the user that the vault's stored state
is older than state this device has already seen (§13.2). `release_key`
means the running release's own sealing key failed its check (§11.10.7);
`retry` covers state write conflicts (§11.9) and KMS or store failures.

When no unlock key in the header matches `device_ik`, the signature does
not verify, or the release holds no header for `vault_id`, there is no key
to seal to: the enclave answers with random bytes of the result's size
(5,252 bytes), indistinguishable to the API and parent. `unknown_device`
and `vault_missing` therefore reach the app only as an unreadable result.

Every outcome has the same size and the same path, so the response reveals
neither the outcome nor the reason for a failure. VettID can still observe a
success, because the vault then starts collecting and the parent reports its
lifecycle (§11.5).

### 11.5 What the member API stores; queue shape

Nothing secret is stored:

| Store | Contents | Retention |
|---|---|---|
| Vault table | **`app_key`** (0.15.0: `{key, kid, seq}`, the public key of the vault's app key as the enclave last reported it, written by the host; and the API's own `app_key_pending` and recovery claim keys, §11.12), `user_guid`, **`vault_id`** (opaque, 128-bit random, 32 lowercase hex characters, assigned by the API at a member's first enrollment; the routing key for alternate-channel requests), `state` (`enrolling`, `locked`, `unlocked`, `deleted`), **lease** (`instance_id`, `lease_expires_at`), **`sealed_release`** (the PCR0 the vault is sealed to; routing aid, §11.10.5), **`vault_version`** (release that last opened the vault), **`state_version`** (vault-state format version), **`alarm`** (`kind`, `alarm_id`, `at`, `emailed_at`; the last host alarm, below) and `alarm_pending`, **`credential_backup`** (0.16.0: whether the vault keeps a backup copy of its credential, as last reported, below; absent until a release of 0.16.0 reports it), the API's own `deletion` record (§11.11.9), **`name_change`** (0.18.0: `{seq, first_name, last_name, at}`, the vault's latest name request, written by the host) and `name_change_pending`, the API's `name_change_result` (§10.8, below), `created_at`, `updated_at` | account lifetime |
| Instance registry | `instance_id`, **`release`** (PCR0 from its descriptor), queue URL, descriptor, attestation, `heartbeat_at` | while the instance is live |
| Request table (response slots) | `request_id`, `vault_id`, `op`, `status` (`queued`, `done`, `expired`), opaque response `envelope` (≤ 8 KiB) and/or a host `code` | TTL 15 min |
| Audit log | enroll, unlock and lock requests: member, time, `vault_id`, request id, never PINs or envelopes | MEMBER-API audit retention |

- **Not stored:** mailbox ids, relay keys, device identifiers, and request
  envelopes beyond the queue's own retention.
- **Lifecycle reporting.** The enclave emits lifecycle events (`enrolled`,
  `unlocked`, `locked`, `deleted`, `moved` with the target release, carrying
  `vault_version` and `state_version`, a number). Since 0.15.0
  `enrolled`, `unlocked` and `locked` also carry the vault's current app
  key (`app_key`: b64 SPKI DER; `app_key_seq`: the header's count of
  app-key changes, 1 at enrollment), and the event **`app_key`** carries
  the same two values when a transfer (§6.7.1) or a recovery (§11.11.5)
  replaces the app. The enclave hands the `app_key` event to the parent
  together with the header write that made the change, and the parent
  writes it after that store succeeds. The parent writes `app_key = {key,
  kid, seq}` on the vault row **whatever the lease**, conditional only on
  `seq` being higher than the row's (a stale instance can only report an
  older one), except that `enrolled` always replaces it (a replaced
  provisional vault starts again at 1, §11.3); it never takes the key
  from anywhere else.
- **The backup bit** (0.16.0, owner decision of 2026-10-06, §15 item
  24). `enrolled`, `unlocked` and `locked` also carry
  `credential_backup` (bool): whether the vault keeps a backup copy of
  its current blob (§3.5.6), the same bit as the sealed header's. When
  it changes on a running vault (the member turns the backup off, or a
  use of the credential stores the copy after it was turned on), the
  vault emits the event **`credential_backup`** with the new value,
  handed to the parent with the header write that recorded it, as for
  `app_key`. The parent writes `credential_backup` on the vault row
  under the lease rule below. It is one bit, about the member's own
  setting, and nothing else: no version, time or device. The member API
  uses it only to refuse a recovery request upfront with a clear answer
  (§11.11.7); the enclave decides from its own header (§11.11.1), so a
  host that misreports the bit can only refuse recoveries it could
  refuse anyway, or forward one the enclave refuses.
- **Name requests** (0.18.0, owner decisions of 2026-10-07, §10.8). After
  a successful `account.name.set` the vault emits the event
  **`account_name`** `{seq, first_name, last_name}`, handed to the parent
  with the flush that stored the request, as for `app_key`. The parent
  writes `name_change = {seq, first_name, last_name, at}` (`at`: its own
  Unix seconds) and `name_change_pending = true` on the vault row
  **whatever the lease**, conditional only on `seq` being higher than the
  row's (absent: 0), so a stale instance can only report an older
  request. **Re-reported on unlock** (0.19.0): an event the parent
  never wrote (lost after the flush, with the instance) is not emitted
  again by that flush, so with every `unlocked` report the vault emits
  `account_name` again for its latest request while that is still
  `pending` (§10.8). The `seq` condition makes this idempotent: a
  request the row already holds fails the condition, which the parent
  treats as done, and a request the member API already processed is
  not reopened. It is the only lifecycle event with member content: the
  member's own instruction about account data VettID already holds. The
  member API processes it (MEMBER-API 2.2.0 "Name changes"), records
  `name_change_result = {seq, status, reason?}` and pushes the snapshot,
  whose `name_change.last` carries that result (§11.13). Only the host
  role writes `name_change` and sets `name_change_pending`.
- **The lease rule.** The parent writes the lifecycle values (other than
  `app_key` and `name_change`, above) to
  the vault table only while it holds the vault's lease or no lease exists
  (a conditional write), so an instance that lost a split brain cannot
  overwrite the holder's values.
- **A stopped vault is locked** (0.10.6). A vault runs only under its
  instance's live lease. When the parent releases a lease because the
  vault stopped (the enclave's "stopped" notice: an owner's
  `vault.lock` over the relay, a lock on lease loss or memory pressure,
  a split brain or an error) it also turns a row's `state = unlocked`
  into `locked` (other states, `enrolling` among them, are left as they
  are), conditional on the lease being its own like the removal itself,
  whether or not a `locked` event arrived first; a `locked` event that
  is lost or late then changes nothing. The member API reports `unlocked` only while the
  row's lease is unexpired; a row that says `unlocked` without one is
  reported `locked` (MEMBER-API "Vault").
- **Host alarms** (0.9.0). The vault reports a clone alarm (§3.5.9) as
  the lifecycle event `alarm.credential_clone`, once per alarm. It
  carries nothing but its kind, the `vault_id` and the usual release
  fields: no device, version or time from the vault. The parent records
  it on the vault row, **whatever the lease** (an alarm is never lost to a
  lease race): `alarm = {kind: "credential_clone", alarm_id, at}`, where
  the parent makes `alarm_id` (a ULID) and `at` (Unix seconds), and
  `alarm_pending = true`. The member API emails the member and clears
  `alarm_pending` (MEMBER-API). Alarm kinds other than those listed here
  are rejected by the parent. A dishonest host can suppress the email but
  not the vault's own alert to the app, its freeze or its audit entry.
- **Deletion notice** (0.9.0). On the lifecycle event `deleted` (§12.5)
  the parent also records `alarm = {kind: "vault_deleted", alarm_id, at}`
  and `alarm_pending = true`, whatever the lease: the vault's own audit
  log is gone, so the member API emails the member and then deletes the
  vault rows (MEMBER-API), after which the member enrolls afresh.
- **Lifecycle values are advisory.** `vault_version` should match the
  `release` in the attested descriptor of the reporting instance, but a
  dishonest parent could misreport any of these values. They therefore serve
  the account site and operations only, never security decisions.

**The SQS message** goes to the leased instance's queue. Retention is 5 min,
with a DLQ after 3 receives:

```json
{ "v": 1, "op": "enroll|unlock|lock|delete|recovery|recovery_cancel|recovery_register|account",
  "vault_id": "...", "user_guid": "...", "request_id": "<ULID>",
  "etk_kid": "<16 hex; enroll, unlock and recovery_register only>",
  "envelope": "<b64; enroll, unlock and recovery_register only>",
  "manifest_sha256": "<64 hex; enroll and unlock only>",
  "browser_key": "<b64 65-byte P-256 point; recovery only>",
  "app_key": "<b64 SPKI DER; enroll and recovery_register only>",
  "account": { "...": "the account snapshot, §11.13; enroll, unlock and account only" },
  "enqueued_at": "<RFC 3339>" }
```

`app_key` (0.15.0) is REQUIRED for `enroll` and `recovery_register` and
absent otherwise: the key the request was signed with at the API, which
the enclave binds to the sealed `app.api_key` (§11.3, §11.11.3).
`account` (0.15.0) is REQUIRED for `account` and, since 0.18.0, for
`enroll`, and OPTIONAL for `unlock` (the API includes it whenever it can
read the member): the enclave passes it to the vault process after a
successful enrollment or unlock, or, for the op `account`, to the
running vault process; with no running vault it drops it. An `enroll`
without a well-formed `account` (§11.13) is answered `bad_request`
(§11.3), so that every vault holds the account's names from its first
moment (§10.8). `account` takes no lease and has no envelope; the parent answers its
slot `done` (§11.13).

`manifest_sha256` is REQUIRED for `enroll` and `unlock` and absent for
every other op. The member API copies it from the request body (§11.1,
MEMBER-API) after checking only its format (64 lowercase hex); it cannot
check it against the sealed request, and does not need to.

The parent forwards the message to the enclave unchanged, for `enroll`
and `unlock` together with the manifest document it names (below). The
enclave answers the parent with

```json
{ "v": 1, "request_id": "<ULID>", "status": "done|etk_unknown", "envelope": "<b64, 5,252 bytes>",
  "code": "recovery_registered|recovery_unavailable" }
```

(`envelope` absent for lock, delete and `etk_unknown`; `code` present
only for a `recovery_register` whose sealed result is `{"ok": true}`
(`recovery_registered`, §11.11.3, 0.10.6), or for a `recovery` the
enclave refused (`recovery_unavailable`, §11.11.2, 0.16.0)). The parent
writes the response slot: `status: "done"`, the `envelope` if any, and
`code: "etk_unknown"` when the enclave reported it, or the enclave's
`recovery_registered` or `recovery_unavailable` (with the envelope) when
its answer carries one; or `status: "expired"`
for a request it did not forward (lease held elsewhere, §11.1) or that
the enclave could not read (no answer). It writes only slots that are
still `queued`, and no other `code`. `GET /api/vault/requests/{id}`
returns `{status, envelope?, code?}`; `code` matches `[a-z_][a-z0-9_]*`
and is a host code. It never carries a sealed outcome, with two
exceptions. `recovery_unavailable` (0.16.0) tells the member API that
the enclave refused a recovery request (§11.11.2), so that it ends the
recovery at once; it says no more than the backup bit the host already
has (§11.5), and a forged or suppressed one changes only what the
portal shows. `recovery_registered` tells the member API, in the clear,
that a recovery's code is spent, so that the API stops releasing it
(§11.11.7). That much is no secret from the host, which sees the
registered app unlock next; a host that forges the marker only hides a
code it could withhold anyway, and one that suppresses it leaves a spent
code on the portal, which the enclave refuses (`used`). Apps read the
envelope as usual and ignore the marker. The parent writes the
lifecycle events to the vault table and deletes the queue message when
the enclave reports completion.

- **Lifecycle events:** `enrolled` and `unlocked` at enrollment; `moved`
  with the target release after a move, and back to the earlier release
  after an abandonment (§11.10.4); `alarm.credential_clone`, since
  0.16.0 `credential_backup`, and since 0.18.0 `account_name` (above;
  since 0.19.0 also with `unlocked` while a request is pending).

**Manifest by hash** (0.10.0, owner decision O10). Enroll and unlock
requests name the manifest by `manifest_sha256` and `manifest_serial`
(§11.3, §11.4) instead of carrying it, so the manifest can outgrow the
12,288-byte request (§11.10.1):

- **Publication.** The step that publishes a manifest first writes the
  exact served document bytes (§11.10.1) to the vault data bucket as
  `manifests/<manifest_sha256>.json`, where `manifest_sha256` is the
  lowercase hex SHA-256 of the manifest bytes (not of the served
  document), and only then lets the site serve it. Objects under
  `manifests/` are never modified; the host role may only read that
  prefix.
- **Parent.** For an `enroll` or `unlock` message, the parent reads
  `manifests/<manifest_sha256>.json`, refusing an object larger than
  90,112 bytes, and forwards the document to the enclave together with
  the message (the vsock queue frame is `[queue message, served document
  or empty]`). It MAY cache a few documents by hash, and MAY skip an
  object whose manifest bytes do not hash to its name (so that a corrupt
  object is not cached). If the object is missing, too large or skipped
  it forwards the message with no document; it never alters the message,
  and there is no host code for this case.
- **Enclave.** Before it uses the manifest (§11.3; §11.10.4 step 1), the
  enclave checks, in this order, and answers the sealed result code
  `manifest` on the first failure: a document is present; it parses as a
  served document (strict format, at most 90,112 bytes); the SHA-256 of
  its manifest bytes equals the request's `manifest_sha256`; the signature
  verifies under a pinned key (`key_id` selects it); the manifest bytes
  parse strictly (§11.10.1); `serial` equals the request's
  `manifest_serial`; for an unlock, `serial` is at least the
  `manifest_serial` recorded in the sealed header (rollback protection is
  unchanged, §13.2); and its own release is listed with its own number,
  PCR1 and PCR2. A `manifest` failure is not a PIN failure and does not
  count toward backoff.
- **What the host can do.** A dishonest host can withhold the document or
  supply another one. Either fails `manifest` (a denial of service it can
  cause anyway); it cannot make the enclave accept a manifest the app did
  not verify, because the hash is inside the sealed, signed request.

`lock`, `delete` and `account` carry no envelope. Locking is harmless, and deletion
through the API is an operator power the host has anyway (§13.5). The API
sends `delete` for an account cancellation (MEMBER-API) and, since
0.16.0, for a member's "delete my vault and start over" once its 24 h
have passed (§11.11.9). The
recovery operations are in §11.11; `recovery_register` carries a
12,288-byte padded request like enroll and unlock, and the response to
`recovery` is the sealed code (5,252 bytes, §11.11.2). None of them takes
the lease: the vault is not left open.

### 11.6 Replay protection

- **Replayed requests.** The enclave remembers every `request_id` it has seen
  for as long as the ETK that request was sealed to is live, and rejects
  repeats. Destroying an ETK (≤ 25 h after creation, or at restart) makes
  every request sealed to it undecryptable. Requests whose `ts` is more than
  5 minutes from enclave time are rejected.
- **Redirected requests.** `user_guid`, `vault_id` and `request_id` appear
  inside the ciphertext as well as in the queue message, and a mismatch is
  rejected. A request therefore cannot be redirected to another vault.
- **Session-only attackers.** Unlock requires both a registered unlock key
  and passing device attestation (§11.7). A member session alone, which
  VettID could obtain, cannot attempt a PIN. Since 0.15.0 a member session
  cannot even submit an unlock: the route takes only app-key-signed
  requests (§11.12).
- **Replayed API requests** (0.15.0). App requests carry a timestamp and a
  single-use nonce under the app key's signature (§11.12.2); the sealed
  request inside keeps its own replay protection above.

### 11.7 Device attestation (REQUIRED for enroll and unlock)

Enroll and unlock MUST carry platform device attestation: **Android hardware
key attestation** or **iOS App Attest**. Only role `app` can produce it,
which is why only apps unlock (§3.1). Both are verified **inside the
enclave**; the attestation data travels inside the sealed envelope, and the
member API sees none of it. The challenge is bound to the request:

```
challenge = SHA-256("vettid/vms/2/devatt" || request_id || vault_id_or_empty || ts)   # inside the envelope
```

`request_id` and `vault_id` are the ASCII strings exactly as carried in
JSON (`vault_id` is empty at enrollment), and `ts` is the request's inner
`ts` (§5.3). Both have fixed lengths, so the concatenation is unambiguous.
Android and iOS use the same challenge.

**Wire fields.** Enrollment (§11.3) and app pairing (§6.7) carry
`device_attest`; unlock (§11.4) carries `device_assertion`:

```json
device_attest:    {"platform": "android", "chain": ["<b64 DER cert, leaf first>", "..."]}
                | {"platform": "ios", "key_id": "<b64>", "attestation": "<b64 CBOR attestation object>"}
device_assertion: {"platform": "android", "sig": "<b64 DER ECDSA P-256 signature over challenge>"}
                | {"platform": "ios", "assertion": "<b64 CBOR assertion>"}
```

**What the device key signs.** Android signs with ECDSA P-256 and SHA-256
(SHA256withECDSA, DER): for `device_assertion` the message is the 32
challenge bytes; for an approval (§11.10.3) it is the approval string's
bytes. iOS asserts with `clientDataHash` = the challenge for
`device_assertion`, and SHA-256(approval string) for an approval; the
signature is checked as ECDSA P-256 with SHA-256 over `nonce` =
SHA-256(authenticatorData || clientDataHash).

`chain` has 1–10 certificates. Unknown members are ignored; a missing or
mistyped member, or another `platform`, is rejected.

Each platform has a **device attestation key**: a hardware-held signing key
that is attested once, when the app enrolls (§11.3), is transferred to
(§6.7.1) or registers for a recovery (§11.11.3), and then signs the
challenge at every unlock.

- **Android (hardware key attestation).**
  - At enrollment or pairing, the app generates a non-exportable EC P-256
    signing key in Android Keystore with `setAttestationChallenge(challenge)`,
    in StrongBox if the device has it and in the TEE otherwise, and sends the
    key's certificate chain.
  - The enclave verifies the chain up to a Google hardware attestation root
    pinned in the image, then checks the attestation extension: the
    challenge; attestation and key security level `TrustedEnvironment` or
    `StrongBox` (never `Software`); `RootOfTrust` with `deviceLocked` true and
    `verifiedBootState` `Verified`, or `SelfSigned` with an allowlisted
    `verifiedBootKey` (GrapheneOS, below); the `attestationApplicationId` package
    name and signing-certificate digest of the VettID app; a signing-only,
    non-exportable key.
  - Certificate revocation uses Google's attestation status list. The
    enclave fetches it over TLS it terminates itself, like relay traffic
    (§12.2; the parent forwards only TCP bytes to an allowlisted host), and
    caches it. Enrollment and pairing need a list fetched in the last 24 h;
    unlock rechecks the stored chain against the cached list and fails if
    the list is more than 7 days old. A parent that blocks the fetch can only
    deny service, which it can do anyway. Every serial the list names counts
    as revoked, whatever its `status` (`SUSPENDED` included); freshness is
    the time the enclave fetched the list. The enclave accepts
    `attestationVersion` 3 or later, and requires the key properties to be
    hardware-enforced: purposes within {SIGN, VERIFY} and including SIGN,
    EC P-256, origin GENERATED.
  - The enclave stores the attested public key with that app's unlock key in
    the sealed header. Each unlock carries a signature over `challenge` by
    that key.
- **GrapheneOS** (owner decision, 2026-10-03; 0.9.0). GrapheneOS runs
  with the device's bootloader locked to its own signing key, so the
  attestation reports `verifiedBootState` `SelfSigned`. The enclave
  accepts `SelfSigned` **only** when `verifiedBootKey` (32 bytes) equals
  one of the GrapheneOS verified boot key fingerprints pinned in the
  release (vettid-vault `vms/pins`); `deviceLocked` true is still
  required, and every other check is unchanged. `Verified` is accepted as
  before; `Unverified` and `Failed` are refused, and so is `SelfSigned`
  with any other key (another custom OS, or a self-built one).
  - Source: the GrapheneOS Attestation Compatibility Guide,
    <https://grapheneos.org/articles/attestation-compatibility-guide>, which
    tells apps to "enforce that `verifiedBootState` is either `Verified`
    or `SelfSigned`" and, for `SelfSigned`, to "check that
    `verifiedBootKey` matches one of the official GrapheneOS verified boot
    keys".
  - The allowlist is part of the release: adding a device family or
    changing a key is a release update (§11.10). Fingerprints as of
    2026-10-03 (SHA-256, lowercase hex):

    | Device | `verifiedBootKey` |
    |---|---|
    | Pixel 10a | `d8f879d10419eddc9fcda6280718be763f6bf12299e1f72df3ea8ad8a8eb7f80` |
    | Pixel 10 Pro Fold | `55a2d44103e56d5ec65496399c417987ba77730e6488fc60ba058d09fc3caee3` |
    | Pixel 10 Pro XL | `141d7fc32af7958a416f2661b37cf6f27bfb376fb5ce616aeaa27a82c7a04f74` |
    | Pixel 10 Pro | `4e8ee8f717754052198ca6d2d3aaa232e2461b4293c0d6f297e519cc778de093` |
    | Pixel 10 | `3f7415ea26f5df5b14ea6d153256071a7a1af9ce7b0970b7311cc463c7ea02c7` |
    | Pixel 9a | `0508de44ee00bfb49ece32c418af1896391abde0f05b64f41bc9a2dfb589445b` |
    | Pixel 9 Pro Fold | `af4d2c6e62be0fec54f0271b9776ff061dd8392d9f51cf6ab1551d346679e24c` |
    | Pixel 9 Pro XL | `55d3c2323db91bb91f20d38d015e85112d038f6b6b5738fe352c1a80dba57023` |
    | Pixel 9 Pro | `f729cab861da1b83fdfab402fc9480758f2ae78ee0b61c1f2137dd1ab7076e86` |
    | Pixel 9 | `9e6a8f3e0d761a780179f93acd5721ba1ab7c8c537c7761073c0a754b0e932de` |
    | Pixel 8a | `096b8bd6d44527a24ac1564b308839f67e78202185cbff9cfdcb10e63250bc5e` |
    | Pixel 8 Pro | `896db2d09d84e1d6bb747002b8a114950b946e5825772a9d48ba7eb01d118c1c` |
    | Pixel 8 | `cd7479653aa88208f9f03034810ef9b7b0af8a9d41e2000e458ac403a2acb233` |
    | Pixel Fold | `ee0c9dfef6f55a878538b0dbf7e78e3bc3f1a13c8c44839b095fe26dd5fe2842` |
    | Pixel Tablet | `94df136e6c6aa08dc26580af46f36419b5f9baf46039db076f5295b91aaff230` |
    | Pixel 7a | `508d75dea10c5cbc3e7632260fc0b59f6055a8a49dd84e693b6d8899edbb01e4` |
    | Pixel 7 Pro | `bc1c0dd95664604382bb888412026422742eb333071ea0b2d19036217d49182f` |
    | Pixel 7 | `3efe5392be3ac38afb894d13de639e521675e62571a8a9b3ef9fc8c44fd17fa1` |
    | Pixel 6a | `08c860350a9600692d10c8512f7b8e80707757468e8fbfeea2a870c0a83d6031` |
    | Pixel 6 Pro | `439b76524d94c40652ce1bf0d8243773c634d2f99ba3160d8d02aa5e29ff925c` |
    | Pixel 6 | `f0a890375d1405e62ebfd87e8d3f475f948ef031bbf9ddd516d5f600a23677e8` |

  - OWNER DECISION (recommended: GrapheneOS only). Other hardened OSes
    (for example CalyxOS) would each be an allowlist entry in a release;
    none is added until requested.
- **iOS (App Attest).**
  - At enrollment or pairing, the app sends an attestation object with
    `clientDataHash` = `challenge`. The enclave verifies it against Apple's
    App Attest root, which is pinned in the image, and checks the App ID and
    the production environment. It then stores the attested public key and
    counter with that app's unlock key in the sealed header.
  - Each unlock carries an assertion over `challenge`. The enclave checks the
    signature and that the counter increases.

**Rationale.** Both checks are local cryptography against pinned vendor
roots, so they need no VettID credentials and no third-party API call (Play
Integrity was rejected for that reason). Attestation keys and certificate
chains are stable device identifiers, so they stay inside the enclave and
never reach the API. The gate is enforced by the attested enclave, not by
VettID's servers; it is an anti-abuse control, and confidentiality never
depends on it.

Desktops and agents have no platform attestation and do not unlock.

### 11.8 Rate limits and backoff

**Member API limits:**

- enroll: 3 per member per day;
- unlock: 10 per member per 15 min; per source network, 10 per 15 min per
  IPv6 /64 and 60 per 15 min per IPv4 address (carrier NAT puts many
  members behind one address);
- polling: 2 per second;
- setup codes (0.15.0, §11.12.1): issue 5 per member per hour and 20 per
  day, one live issuance per member; redeem 10 per 5 min per IPv6 /64
  and 30 per IPv4 address; typed redeems 5 per 5 min per (email, source
  network) and 800 per issuance. No limit is global.

Enroll, unlock and lock requests are audited (§11.5), without PINs or
envelopes.

**Enclave backoff**, kept in the sealed header and counted in `header_seq`:

- after 3 consecutive failures, the delays are 30 s, 1 min, 5 min, 15 min,
  60 min, then 60 min for every further failure;
- a successful unlock resets the backoff;
- failures never wipe the vault.

### 11.9 Failure handling

| Failure | Behaviour |
|---|---|
| Instance gone or lease moved | The API answers `409 instance_moved`, or the request expires (queue retention, or the parent found the lease held elsewhere and marked the slot `expired`). The app refetches `/api/vault/enclave` and re-seals. |
| Unknown or expired `etk_kid` | The enclave reports `etk_unknown`; the response slot carries `code: "etk_unknown"` and no envelope (§11.5). The app refetches and retries. |
| Decryption, binding, signature or attestation failure | Random bytes of the result's size, or the uniform sealed result (`attestation`). The API cannot tell which. |
| Bad PIN, backoff, rollback | The uniform sealed result (§11.4) |
| State write conflict | The vault locks (§12.3) and the result says `retry`. |
| The vault's release is not running | `503 release_starting` with `retry_after`; the app retries (§11.10.5). |
| Stale, invalid or unsigned manifest; the host withheld the document or supplied another; hash or serial mismatch (§11.5) | Result code `manifest`; the app refetches the manifest and retries once. Not counted as a PIN failure. |
| The vault's release is `removed` (§11.10.5) | `410 release_unavailable`; the release has ended. |
| Header or state belongs to another release | Result code `wrong_release` (§11.10.4). |

### 11.10 Release updates

A **release** is one enclave image, identified by its PCR0. The member keeps
total control over which release can open their vault (VAULT-PLAN §5.1,
decision D1):

- A vault's sealed header, which holds the pepper the DEK depends on
  (§3.3.1), is sealed to **one release**: the release the member last
  approved. No other release can open it, including any later release
  VettID ships.
- A vault moves to a newer release only during an unlock in which the member
  approves that release in the app (or back, before the newer release has
  ever run it, §11.10.4). Declining, or not answering, changes nothing.
- VettID cannot move a vault, and cannot force a member to update. It
  runs a release for a bounded time (0.10.0, VAULT-RELEASES §3.5): after
  notice the release ends (`removed`) and its sealing key is deleted, so
  a vault never moved off it is lost. Confidentiality never changes.

#### 11.10.1 The release manifest

VettID publishes the releases it runs in a signed **release manifest** at
`https://vettid.org/.well-known/vettid/pcr-manifest.json`.

**Manifest bytes** are a compact JSON object, parsed with the strict rules
of §5.3, at most **65,536 bytes** (0.10.0; 4,096 before):

```json
{"v":1,"serial":7,"issued_at":"<RFC 3339, whole seconds>","releases":[
  {"release":3,"pcr0":"<96 hex>","pcr1":"<96 hex>","pcr2":"<96 hex>",
   "seal_key":"<sealing-key identifier, ≤ 256 bytes>","status":"deprecated",
   "published_at":"<RFC 3339, whole seconds>","ends_at":"<RFC 3339, whole seconds>",
   "notes":"<https URL>"},
  {"release":4,"pcr0":"<96 hex>","pcr1":"<96 hex>","pcr2":"<96 hex>",
   "seal_key":"<sealing-key identifier, ≤ 256 bytes>","status":"active",
   "published_at":"<RFC 3339, whole seconds>","notes":"<https URL>"}]}
```

An entry is about 530 bytes. The limit leaves room for the active
release, a year of deprecated and retired releases and the `removed`
entries that a live key still admits (VAULT-RELEASES §4.2): 15–30 entries.
The manifest no longer travels inside the enroll and unlock requests;
they carry its hash (§11.5, "Manifest by hash").

- `serial` is an integer that increases with every publication. A manifest
  with a lower `serial` than one already seen MUST be refused (by apps and
  by the enclave, §11.10.4).
- `release` is the release number: a positive integer, unique, assigned in
  publication order. **Every release image embeds its own release number**,
  so it is covered by PCR0. Entries are sorted by `release`; `release` and
  `pcr0` are unique.
- PCR values are lowercase hex SHA-384 (96 characters). Debug (all-zero)
  PCRs MUST NOT appear.
- `seal_key` names the release's sealing key (§11.10.2).
- `status`:

  | Status | Enroll into | Move into | Unlock a vault sealed to it |
  |---|---|---|---|
  | `active` | yes | yes | yes |
  | `deprecated` | no | no | yes, move-only (VAULT-RELEASES §3.4); apps urge an update |
  | `retired` | no | no | yes, move-only; apps give the final warning with `ends_at` |
  | `removed` | no | no | no: not routed (`410 release_unavailable`, §11.10.5); the release has ended and its sealing key is pending deletion or deleted |

  These four statuses are fixed from release 1 on. Parsers MUST refuse
  an unknown status (and so the whole manifest) and ignore unknown
  members (§5.3), so later fields are additive only.
- `ends_at` (0.10.0, optional) is the release's end date, RFC 3339 in
  whole seconds UTC (the format of `published_at`), placed after
  `published_at` and before `notes`. Publishers set it on `deprecated`
  and `retired` entries once the date is known, and MAY keep it on
  `removed` entries. Parsers validate its format wherever it appears and
  do not refuse it because of the entry's status. Apps show it for
  `deprecated` and `retired` releases.
- The manifest MUST list every release that still runs for any vault, and
  every release that the sealing policy of any release key not yet
  deleted admits (§11.10.7, check 6). A `removed` release therefore stays
  listed while some live key still admits its PCR0, and is dropped once
  none does. A release absent from the manifest is unknown: apps refuse
  to send it a PIN.
- `notes` is an `https` URL of human-readable release notes.

**The served document** wraps the exact manifest bytes:

```json
{ "manifest": "<b64 exact manifest bytes>", "sig": "<b64 64 bytes>", "key_id": "<16 hex>" }
```

```
sig    = ECDSA-P256-SHA256(manifest_key, "vettid/pcr-manifest/1" || 0x00 || manifest_bytes)
         encoded as r || s, 32 bytes each, big-endian (IEEE P1363)
key_id = hex(SHA-256(SubjectPublicKeyInfo DER of the public key)[0:8])
```

- Signatures are verified over the exact bytes, so no JSON
  canonicalization is needed.
- The served document is at most **90,112 bytes**.
- **How apps learn the manifest** (unchanged by 0.10.0): before each
  enroll and unlock they fetch the served document from the URL above,
  verify it (signature, strict format, the serial rule), store the
  highest `serial` seen and send `manifest_sha256` = hex(SHA-256(manifest
  bytes)) and `manifest_serial` in the request. On a `manifest` result
  they refetch and retry once. The one exception is a canary manifest
  (next item).
- **A canary manifest** (0.14.0; owner decisions of 2026-10-06;
  VAULT-RELEASES §10.1 step 9). To test a release before it is published,
  VettID signs the next serial with that release `active` and does not
  serve it. The phone used for the canary gets that served document out
  of band. It adds no trust: it is verified exactly as the served one
  is. An app MAY accept one, and if it does:
  - **Delivery.** The member shares the served document to the app as a
    file (on Android a share intent, `application/json`). The app reads
    at most the 90,112-byte limit plus one byte and refuses anything
    larger. It never fetches a canary manifest from a URL. The path
    exists in release builds, because the canary phone runs a normally
    signed release build.
  - **Installation.** The app verifies it as above: a signature under a
    manifest key **this build pins**, selected by `key_id` (keys A and B
    in release builds, the staging key in staging builds), and the
    strict format. It refuses it if its `serial` is lower than the
    highest serial this phone has used, or if the published manifest
    already has that `serial` or a higher one (checked when the app can
    read and verify the published manifest). It then shows the `serial`,
    the `key_id` and the listed releases (number and status), and
    installs it only after the member confirms. One canary manifest is
    installed at a time, and a new one replaces it. It is stored
    encrypted under the app's device key store. It is erased with
    everything else when the phone's local state is wiped (§6.7.1, the
    replaced phone), and the member can remove it at any time (on
    Android: Settings → Attestation, "Stop using the test manifest").
  - **Selection**, before every enroll, unlock and recovery register.
    The app verifies the installed canary manifest again. One that no
    longer verifies is removed and ignored, never used as a fallback.
    The app then fetches the published one and uses the one with the
    higher `serial`. On equal serials it uses the published one (the
    canary document published as it was). When the published URL
    answers 404 (nothing published yet, as before a channel's first
    release), it uses the canary manifest. A published manifest that
    fails verification is an error, as it is without a canary, and the
    canary manifest never masks it. Once the published `serial` reaches
    the canary's, the app removes the canary manifest. The serial rule
    applies to whichever manifest is used, and that manifest's `serial`
    is the one stored and sent.

  A phone that used a canary manifest of serial s+1 has seen s+1, so it
  refuses the published s from then on, also after the canary manifest
  is removed (the enclave refuses s too, since its sealed header records
  s+1, §13.2). If the canary fails, the vault unlocks again once VettID
  publishes s+2 (VAULT-RELEASES §10.1, "If the canary fails"). §13.9
  describes the risk this path leaves.
- The **manifest key** is an ECDSA P-256 key held by VettID in a hardware
  key store and used for nothing else. Its public key is **pinned in every
  app and in every release image**. Apps and images MAY pin two keys to
  allow rotation; `key_id` selects one. Rotating to a key that an image does
  not pin requires a release.

#### 11.10.2 Sealing per release

Each release R has a **sealing key** `SK_R` with two operations:

- **unseal**: decrypt an object sealed to R. It is available **only to an
  enclave attested as release R** (its PCR0).
- **seal**: create an object sealed to R. It is available only to enclaves
  attested as a release that R's sealing policy admits: R itself, and the
  releases allowed to move vaults into R (every release not `removed`
  when R's key is created, VAULT-RELEASES §6.2).

Neither operation gives the host any key material. A sealed object is
authenticated encryption under a fresh data key that only an attested
enclave ever holds in plaintext, so the host can neither read nor forge
sealed objects; it can only store, withhold, or replay them.

This is how release N seals for release N+1 without being able to read
what it sealed: it can seal to `SK_{N+1}`, but only N+1 can unseal.

*Deployment (VAULT-PLAN §5.1):* one AWS KMS key per release. `Decrypt` is
allowed only with a Nitro attestation whose PCR0 is R's;
`GenerateDataKey` is allowed only with a Recipient attestation whose PCR0
is in R's admitted set, so the data key reaches only that enclave. Release
images pin the account and region of the sealing keys and refuse a
`seal_key` outside them, so a manifest alone cannot redirect a vault to a
foreign key. `seal_key` is the key's full ARN. The enclave itself verifies
each key's policy before sealing to it (§11.10.7), so a key whose policy
lets anything other than the release open it, or could ever be changed, is
refused.

Storage: the sealed header is one object **per release**
(`vaults/<vault_id>/header/<pcr0>`); an enclave reads only its own release's
object. Vault state (§3.3) is encrypted under the DEK, which does not
change when a vault moves, so state is never re-encrypted.

#### 11.10.3 Approval

When the manifest lists an `active` release newer than the one the vault is
sealed to, the app MAY offer the update. It shows the release number, the
notes, and a fingerprint of PCR0 (VAULT-PLAN D3: anyone can rebuild the
image and compare). If the member approves, the next unlock carries the
approval.

The **approval signing string**, each `\n` a literal newline, no trailing
newline:

```
"vettid/vms/2/release-approval" \n vault_id \n request_id \n from_pcr0_hex \n
to_pcr0_hex \n to_release \n manifest_serial
```

- `request_id` is the unlock request's, so an approval is good for that one
  unlock only and cannot be replayed.
- `from_pcr0_hex` is the release the vault is sealed to, which is the
  release of the instance the unlock request is sealed to (§11.2); `to_pcr0_hex` and `to_release` are the
  target's manifest entry; `manifest_serial` is the request's
  `manifest_serial`, the serial of the manifest the request names.
  Integers are decimal; hex is lowercase.
- It is signed with the app's **device attestation key** (§11.7), the same
  key and encoding as `device_assertion`:
  - Android: ECDSA P-256 with SHA-256 over the string's bytes, DER-encoded;
  - iOS: an App Attest assertion with `clientDataHash` =
    SHA-256(string); the counter MUST increase. With two assertions in one
    unlock (`device_assertion` and the approval), both counters MUST
    exceed the counter stored before the request and differ; the enclave
    stores the larger.

**In the unlock request** (§11.4):

```json
"release_update": { "to": "<to_pcr0_hex>", "to_release": 5,
                    "approval": { <device_assertion object over the approval string> } }
```

The unlock signing string (§11.4) also covers `to_pcr0_hex`, so the
approval is bound to the app's unlock key as well.

#### 11.10.4 The move

Every unlock request names the current signed manifest by its hash and
serial, and the host supplies the document (§11.4, §11.5). An enclave of
release N processes an unlock in this order:

1. The normal checks of §11.4, in their order, up to and including the
   rollback checks (§13.2). Before deriving the DEK, it verifies the
   manifest as §11.5 ("Manifest by hash") lists: the document is present,
   its hash and serial match the request's `manifest_sha256` and
   `manifest_serial`, the signature verifies under a pinned key, the
   format is strict, `serial` ≥ the `manifest_serial` recorded in the
   sealed header, and its own release is listed. A failure gives the
   result code `manifest`. A manifest failure is not a PIN failure and
   does not count toward backoff. The enclave does not refuse an unlock
   because its own entry is `removed`: a rescue (§11.10.5) reopens the
   release under the same manifest.
2. It derives the DEK and loads the state. If the state records a
   **pending move** (step 6), it never resumes the vault, with one
   exception: an **abandonment** (see "Abandoning an unconfirmed move"
   below), a `release_update` whose `to` is the enclave's own PCR0 and
   `to_release` its own number, with an approval that verifies (step 4,
   check 3). An abandonment clears the pending move and continues as an
   ordinary unlock. Otherwise the enclave skips to step 7.
3. Without `release_update`, the unlock proceeds as before. The enclave
   records the manifest `serial` at its next header write.
4. With `release_update`, it checks, and **refuses the update** (the unlock
   itself still succeeds) with the first failing reason:
   1. `to` is in the manifest with `status` `active`, and `to_release` is
      that entry's number (`target`);
   2. `to_release` is **greater than** the enclave's own release number
      (`downgrade`). Equal or lower is always refused here (abandoning a
      move is step 2's exception, not an update);
   3. the approval verifies under the attested device key bound to this
      app's unlock key (`approval`). The enclave builds the approval string
      itself, with its own PCR0 read from the NSM as `from_pcr0_hex`, so an
      approval for a different source release cannot verify;
   4. `seal_key` is within the pinned sealing-key namespace (`target`), and
      the target key passes the checks of §11.10.7 (`seal_key`);
   5. no move to a different release is pending (`pending`).
5. If an update is refused, the result reports it and the vault runs
   normally under N.
6. **Record the move.** It flushes the state (§8.3) with
   `release_move = {to, to_release, manifest_serial, approved_by: <device
   id>}`. From here on the vault does not resume under N.
7. **Seal to N+1.** It builds the new header from the current one with
   `header_seq` + 1, `sealed_release` = `to` and the manifest serial, seals
   it to `SK_to`, and writes `header/<to>` **create-only**. If that object
   already exists, it can only be a leftover of an interrupted attempt at
   this same recorded move (only admitted enclaves can seal to `SK_to`, and
   moves only go forward): the enclave replaces it with a conditional write
   on the version it read.
8. It returns the result with `update: moved` and **locks** (§12.3) without
   collecting. The parent reports the lifecycle event `moved` with the
   target release. `header/<N>` is kept until N+1 confirms the move (below).

**Failures.**

- Before step 6: nothing has changed; the result says `refused` or the
  unlock failed as usual.
- Step 6 write fails: the state is unchanged; the result says `refused`
  with code `write`, and the vault runs under N.
- Step 7 fails, or the enclave crashes after step 6: the state records the
  pending move, so the next unlock that reaches release N completes it at
  step 2 without a new approval (the member already approved), and reports
  `moved`. Until then the vault stays sealed to N, which is safe.
- A crash after step 7: `header/<to>` exists and the state records the
  move; the next unlock that reaches N reports `moved` again, and one that
  reaches N+1 confirms it.

**Re-approval and idempotency.** An approval for the target already
recorded as pending is accepted and completes the move. An approval for a
different target while a move is pending is refused (`pending`).

**Confirmation at release N+1.** When an N+1 enclave opens a vault whose
state records a pending move to N+1, it clears it, sets
`state.sealed_release` to N+1, flushes, and only then deletes `header/<N>`
(conditional delete; failure is ignored). From this flush on, the move is
**confirmed** and final. An enclave MUST refuse a vault (result code
`wrong_release`) whose state names a different `sealed_release` and no
pending move to its own release: that is a stale header served to a
release the vault has left.

**Abandoning an unconfirmed move.** If N+1 cannot unlock the vault (for
example, a defective release), the member is not stranded: while the move is
unconfirmed, `header/<N>` still exists and the state still records the
pending move. The app MAY then offer to return to release N. It sends an
unlock to an N instance (§11.10.5) with `release_update.to` = N's own PCR0
and `to_release` = N's number, approved like any update. The pending move
is necessarily unconfirmed: had N+1 confirmed it, the state would name N+1
as `sealed_release`, and N would have refused the vault as
`wrong_release`. Release N clears the pending move, deletes `header/<to>`
(conditional delete), resumes the vault, and reports `update: abandoned`;
the parent reports `moved` back to N. This is the only way back to an
earlier release, and only before the newer release has ever run the vault.

**Downgrades.** Apart from abandoning an unconfirmed move, moving to an
older or equal release is never allowed, even with an approval. A defect in
a release is fixed by publishing a newer release, if necessary a rebuild of
older code with a new number, and moving forward. *Rationale:* the member's
approval protects against releases they do not trust, not against being
talked into an old release with known vulnerabilities; forward-only moves
remove that attack, and the host cannot exploit a downgrade path that does
not exist.

#### 11.10.5 Routing and on-demand start

Several releases run at once.

- The vault table records **`sealed_release`** (the PCR0 the vault is sealed
  to), and the instance registry records each instance's **`release`**
  (from its attested descriptor, §11.2). Both are routing aids written by the
  parent from lifecycle events; a wrong value can only misroute, and a
  release that is not sealed to cannot open the vault.
- `GET /api/vault/enclave` returns a live instance of the vault's
  `sealed_release` (the leased one if there is a lease, §11.1). If none is
  running, the API requests one and answers `503` with error
  `release_starting` (MEMBER-API error body plus `code`, `release` and
  `retry_after`); the app retries after `retry_after`. A release that is
  unknown or whose image can no longer be started answers `410` with error
  `release_unavailable`; so does a `removed` release (0.10.0), unless
  operations have reopened it for a rescue. The API learns each release's
  status and availability from the signed manifest, as operations publish
  it (VAULT-PLAN §5.1); `deprecated` and `retired` releases are still
  routed. VettID keeps each release's image and sealing key until the
  release's `ends_at` (VAULT-RELEASES §3.5); then the release is
  `removed`, its instances stop and its key is scheduled for deletion
  with the pinned window (§11.10.7), after which every vault still sealed
  to it is permanently unopenable.
- **Rescue.** During the deletion window, operations MAY reopen a
  `removed` release for a member who asks: cancel the key's deletion,
  enable it, start an instance and route the member's vault to it, with
  the manifest unchanged. The app offers only the move; then the key is
  scheduled for deletion again (VAULT-RELEASES §10.3).
- The `moved` lifecycle event updates `sealed_release`; the next unlock is
  routed to the new release.
- An app MAY ask for a specific release with
  `GET /api/vault/enclave?release=<pcr0>`, which is answered the same way
  for any release listed in the manifest. Apps use it only to abandon an
  unconfirmed move (§11.10.4). If an instance of another release holds a
  live lease on the vault, the API answers `409` with error `vault_busy`
  and `retry_after` (lock the vault first).

#### 11.10.6 What the app shows and stores

The app stores, per vault: the **release it last unlocked into** (PCR0 and
release number), the highest manifest `serial` it has seen, `state_seq`,
and `header_seq` **per release** (§13.2): each release has its own header
object, and a move, or failures under N+1, raise only N+1's `header_seq`.
In every unlock, `min_header_seq` is the value it holds for the release
the request is sealed to; when it abandons a move it therefore sends N's
value, and keeps N's release and `header_seq` until the move is confirmed
or abandoned.

- It fetches the manifest before each unlock (or uses an installed
  canary manifest under the selection rule of §11.10.1), refuses one
  with a lower `serial` than stored, and sends its `manifest_sha256` and
  `manifest_serial` in the unlock request (§11.10.1).
- It MUST NOT send a PIN to a release with a **lower** release number than
  the one it last unlocked into (a rollback; it shows an error).
- If the routed release is **newer** than the stored one and listed in the
  manifest, the vault was moved from another device. The app tells the user
  ("vault software was updated") before sending the PIN, as §11.2 step 4
  requires.
- For a `deprecated` or `retired` release, it shows the status and the
  `ends_at` date if present, and offers the newest `active` release.
- For a `removed` release, it tells the member that the release has ended
  and the vault can no longer be opened (enroll a new vault). Only if the
  API routes the vault anyway (a rescue, §11.10.5) does it unlock, and
  then it offers only the move.
- After `update: moved`, it records the new release and sequence numbers
  and unlocks again, which reaches the new release. If that release
  repeatedly fails to unlock the vault, the app MAY offer to return to the
  previous release while the move is unconfirmed (§11.10.4), and records
  the previous release again after `update: abandoned`. Owner devices also
  learn the release from `device.paired` and from the `sync.event` kind
  `vault.release` that a vault sends after it first runs under a new
  release.

#### 11.10.7 Verifying a release's sealing key

"Only the approved release can open the vault" holds only if the sealing
key's policy says so and can never change. The enclave does not take that on
trust: **before it seals a header to a release key for the first time**, it
reads the key's metadata, policy and grants from AWS KMS itself and checks
them. (vettid.dev had no such check: its host role and a migration function
held `kms:PutKeyPolicy` and widened key policies during migrations, and
nothing in the enclave noticed.)

**When.** Before the first header seal under a key: at enrollment (the
enclave's own release key) and before a move (the target's key,
§11.10.4 step 4). A key whose policy passes these checks can never be
changed again (no principal may call `PutKeyPolicy` or `CreateGrant`), so
one successful check per key is enough. Only the key's state can change,
and only along Enabled → PendingDeletion → deleted, or PendingDeletion →
Disabled → Enabled (a cancelled deletion, then `EnableKey`), by the pinned
retirement principal (below); the record stays valid through all of them,
and check 2 refuses new seals while the key is not `Enabled`. The enclave records it in the
sealed header it writes, as `seal_key_verified = {key_arn,
policy_sha256, verified_by}` (`verified_by` the PCR0 of the release that ran
the check); later header writes under the same key, by the same
release, rely on that record instead of re-checking. A record made by
another release (N's check of N+1's key, written with the move) is
re-checked by the release before its first header write; if that check
fails the unlock fails with `release_key`. A failed check refuses
the enrollment (result code `release_key`) or the update (`seal_key`).

**How.** The enclave calls KMS `DescribeKey`, `GetKeyPolicy` (policy name
`default`) and `ListGrants` on the key ARN from the signed manifest:

- over TLS that **the enclave terminates** (decision D5): the parent's TCP
  allowlist includes the regional endpoint `kms.<region>.amazonaws.com:443`,
  whose certificates chain to the Amazon roots already pinned in the image;
- signed with **SigV4 by the enclave**, using temporary credentials of the
  host's instance role that the parent passes in. The credentials only
  authorize the read; the host cannot forge or alter a TLS-authenticated
  KMS response about a key in the pinned account and region, so at worst it
  can withhold credentials (denial of service). The same path carries the
  enclave's `Decrypt` and `GenerateDataKey` calls.

**Checks.** The enclave fails closed: any failure, error, unknown field
shape or truncated listing refuses the seal.

1. **Key identity.** The ARN is `arn:aws:kms:<region>:<account>:key/<uuid>`
   with the pinned account and region (§11.10.2), and equals the manifest's
   `seal_key`.
2. **Key metadata** (`DescribeKey`): `KeyState` = `Enabled`; `Origin` =
   `AWS_KMS` (not imported key material, not an external or CloudHSM key
   store, and no `CustomKeyStoreId`); `KeySpec` = `SYMMETRIC_DEFAULT`;
   `KeyUsage` = `ENCRYPT_DECRYPT`; `KeyManager` = `CUSTOMER`;
   `MultiRegion` present and `false` (a replica could carry a different
   policy); `AWSAccountId` = the pinned account; no `CustomKeyStoreId`,
   `CloudHsmClusterId` or `XksKeyConfiguration`. Unknown members of the
   responses are ignored; known members with another type fail. A key
   pending deletion, or disabled after a cancelled deletion, is refused
   for new seals until it is enabled again.
3. **No grants** (`ListGrants`): the list is empty and not truncated
   (`Truncated` false, no `NextMarker`). A
   grant is an authorization outside the policy, so none may exist; with
   no `CreateGrant` permission, none can be added later.
4. **Policy shape.** The policy parses with the strict JSON rules of §5.3
   (no duplicate names). Top level: only `Version` (= `"2012-10-17"`),
   `Id` and `Statement` (an object or an array). Statement members: only
   `Sid`, `Effect`, `Principal`, `Action`, `Resource` and `Condition`.
   `NotPrincipal`, `NotAction` and `NotResource` are rejected in any
   statement. `Resource` is a single string. Operators, condition keys and
   action names match case-sensitively: a case variant is refused, never
   treated as equivalent. `Resource` is `"*"` or the key's ARN.
5. **`Deny` statements** are ignored after the shape check: they can only
   remove access, so ignoring them over-approximates what is allowed.
6. **Actions in `Allow` statements** are explicit names, never wildcards
   (no `*` or `?` anywhere, so `kms:*` and `kms:Generate*` fail), from this
   list and nothing else:

   | Action | Allowed only with |
   |---|---|
   | `kms:Decrypt` | an attestation condition whose every value is the **target release's PCR0** |
   | `kms:GenerateDataKey` | an attestation condition whose every value is the PCR0 of a release in the manifest numbered **at or below** the target (the target and the releases admitted to seal for it, §11.10.2) |
   | `kms:DescribeKey`, `kms:GetKeyPolicy`, `kms:ListGrants`, `kms:ListKeyPolicies`, `kms:GetKeyRotationStatus`, `kms:ListResourceTags` | no condition required (read-only metadata) |
   | `kms:ScheduleKeyDeletion` (0.10.0) | a **retirement statement** (below) with `NumericEquals` `kms:ScheduleKeyDeletionPendingWindowInDays` = the pinned window (check 7) |
   | `kms:CancelKeyDeletion`, `kms:EnableKey` (0.10.0) | a retirement statement |

   A **retirement statement** is an `Allow` statement whose actions are
   only `kms:ScheduleKeyDeletion`, `kms:CancelKeyDeletion` and
   `kms:EnableKey` (one or more of them): never with `kms:Decrypt`,
   `kms:GenerateDataKey` or a read-only action. Its principal is the
   pinned retirement principal (check 8). A release image pins two
   **retirement constants** (§11.10.8): `retirement_principal`, an IAM
   role ARN in the pinned account (not the account root; for vettid.org
   `arn:aws:iam::<account>:role/vettid-org-vault-key-retirement`), and
   `retirement_window_days` (30 in production, 7 in staging; 7–30). An
   image without a pinned retirement principal (development builds)
   treats the three actions as disqualifying, as before 0.10.0.

   Every other action disqualifies the key, among them `kms:PutKeyPolicy`,
   `kms:CreateGrant`, `kms:Encrypt` (anyone could then forge sealed
   objects), `kms:ReEncryptFrom` / `kms:ReEncryptTo` (re-encryption to a
   key the caller controls bypasses the attestation gate),
   `kms:GenerateDataKeyWithoutPlaintext`, `kms:DisableKey`,
   `kms:ImportKeyMaterial`, `kms:DeleteImportedKeyMaterial`,
   `kms:UpdatePrimaryRegion`, `kms:ReplicateKey`, `kms:TagResource`,
   `kms:UntagResource`, `kms:UpdateKeyDescription`, and
   `kms:EnableKeyRotation` / `kms:DisableKeyRotation`.
7. **The attestation condition.** In the `Condition` of a `Decrypt` or
   `GenerateDataKey` statement:
   - operator `StringEquals` or `StringEqualsIgnoreCase`, never an
     `…IfExists` form (which matches when the request carries no
     attestation at all), never `ForAnyValue:` / `ForAllValues:`, `Null` or
     a negated operator;
   - key `kms:RecipientAttestation:ImageSha384` or
     `kms:RecipientAttestation:PCR0` (the same measurement on Nitro); if
     both appear, both must satisfy the rule;
   - values: one string or an array of strings, each 96 hex characters,
     compared case-insensitively to the manifest's PCR0s.

   Other condition entries in the same statement can only narrow it, but
   the enclave still accepts only these: `StringEquals` /
   `StringEqualsIgnoreCase` on `kms:RecipientAttestation:PCR1` to `PCR8`
   (PCR1 and PCR2, if present, equal the manifest's) and on
   `kms:EncryptionContext:<key>`; `StringEquals` on `kms:CallerAccount`
   (required, and equal to the pinned account, check 8); and `ArnEquals` on
   `aws:PrincipalArn` with ARNs in the pinned account. Anything else fails.

   **The retirement window condition** (0.10.0). One more entry is
   accepted, only in a retirement statement that contains
   `kms:ScheduleKeyDeletion`, and REQUIRED there: operator `NumericEquals`
   (not `NumericEqualsIfExists`, not another numeric operator) on the key
   `kms:ScheduleKeyDeletionPendingWindowInDays`, with a single value (a
   JSON string or a JSON number, in canonical decimal, not an array) equal
   to the pinned `retirement_window_days`. `NumericEquals` anywhere else,
   or this key under any other operator, fails. KMS documents the key and
   its 7–30-day range; the window applies when the deletion is scheduled,
   so the key can only be deleted after exactly that notice.
8. **Principals.** Releases are public and reproducible, so anyone can run
   a genuine release image in their own AWS account and present a valid
   attestation with its PCR0. The attestation condition alone therefore
   does not keep other accounts out; the principal must. In **every**
   `Allow` statement:
   - `Principal` is `{"AWS": <ARN or array of ARNs>}` and every ARN is in
     the pinned account: the account root `arn:aws:iam::<account>:root` or
     an IAM role `arn:aws:iam::<account>:role/<path/name>`;
   - rejected: `"*"`, `{"AWS": "*"}`, any other account, account ids
     without the ARN form, `Service`, `Federated` or `CanonicalUser`
     principals, and anything else.

   The `Decrypt` and `GenerateDataKey` statements MUST also carry
   `StringEquals` `kms:CallerAccount` = the pinned account, as defence in
   depth against a principal-shape mistake.

   In a **retirement statement** (0.10.0), `Principal` is exactly
   `{"AWS": "<pinned retirement principal>"}`: one ARN string, not an
   array, not the account root, not the host role. Retirement statements
   MUST also carry `StringEquals` `kms:CallerAccount` = the pinned
   account. The retirement principal MUST NOT appear among the principals
   of a `Decrypt` or `GenerateDataKey` statement; it MAY appear in the
   read-only statement's principals (it reads the key's policy for
   `vaultctl keycheck`, VAULT-RELEASES §6.2). Read-only statements are held
   to the same pinned-account rule: foreign reads of a key's metadata would
   be harmless, but there is no reason to allow them.

**Example policy that passes**, for release 4 whose sealing policy admits
release 3, in the pinned account `111122223333`. `<pcr0-4>` and `<pcr0-3>`
stand for the releases' PCR0s:

```json
{
  "Version": "2012-10-17",
  "Id": "vettid-release-4",
  "Statement": [
    { "Sid": "UnsealOnlyInRelease4", "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::111122223333:role/vettid-enclave-host"},
      "Action": "kms:Decrypt", "Resource": "*",
      "Condition": {"StringEqualsIgnoreCase": {"kms:RecipientAttestation:ImageSha384": "<pcr0-4>"},
                    "StringEquals": {"kms:CallerAccount": "111122223333"}} },
    { "Sid": "SealFromAdmittedReleases", "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::111122223333:role/vettid-enclave-host"},
      "Action": "kms:GenerateDataKey", "Resource": "*",
      "Condition": {"StringEqualsIgnoreCase": {"kms:RecipientAttestation:ImageSha384": ["<pcr0-3>", "<pcr0-4>"]},
                    "StringEquals": {"kms:CallerAccount": "111122223333"}} },
    { "Sid": "EnclaveVerifiesThisPolicy", "Effect": "Allow",
      "Principal": {"AWS": ["arn:aws:iam::111122223333:role/vettid-enclave-host",
                            "arn:aws:iam::111122223333:role/vettid-org-vault-key-retirement"]},
      "Action": ["kms:DescribeKey", "kms:GetKeyPolicy", "kms:ListGrants"], "Resource": "*" },
    { "Sid": "RetireAfterNotice", "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::111122223333:role/vettid-org-vault-key-retirement"},
      "Action": "kms:ScheduleKeyDeletion", "Resource": "*",
      "Condition": {"NumericEquals": {"kms:ScheduleKeyDeletionPendingWindowInDays": "30"},
                    "StringEquals": {"kms:CallerAccount": "111122223333"}} },
    { "Sid": "RescueBeforeDeletion", "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::111122223333:role/vettid-org-vault-key-retirement"},
      "Action": ["kms:CancelKeyDeletion", "kms:EnableKey"], "Resource": "*",
      "Condition": {"StringEquals": {"kms:CallerAccount": "111122223333"}} }
  ]
}
```

The example pins `retirement_principal` =
`arn:aws:iam::111122223333:role/vettid-org-vault-key-retirement` and
`retirement_window_days` = 30.

There is no administrator statement, so KMS's lockout safety check rejects
the policy unless the key is created with `BypassPolicyLockoutSafetyCheck`
(VAULT-PLAN §5.1). That is intended: nobody, including the AWS account
root, can change the policy, add grants or disable the key. Only the
pinned retirement principal can end the key, and only by scheduling its
deletion with exactly the pinned window; within that window it can cancel
the deletion and re-enable the key (a rescue, §11.10.5). Ending a key
ends availability for vaults still sealed to it, never confidentiality:
no statement lets anything but the release open what is sealed to it.

**Variants that MUST fail** (each changes one thing in the example):

| Change | Failing check |
|---|---|
| Add the default `{"Principal": {"AWS": "arn:aws:iam::111122223333:root"}, "Action": "kms:*"}` statement | 6 (wildcard) |
| Add `"Action": "kms:PutKeyPolicy"` or `"kms:CreateGrant"` in any `Allow` | 6 |
| `StringEqualsIgnoreCaseIfExists` on the `Decrypt` condition | 7 |
| `Decrypt` condition lists `<pcr0-3>` as well | 6 (`Decrypt` values must all be the target) |
| `Decrypt` without a `Condition` | 6 |
| `"Action": ["kms:Decrypt", "kms:ReEncryptFrom"]` | 6 |
| `"Action": "kms:Encrypt"` | 6 |
| `"NotAction": "kms:PutKeyPolicy"` with `"Effect": "Allow"` | 4 |
| `StringLike` with value `"*"` on `ImageSha384` | 7 |
| A `GenerateDataKey` value that is not a manifest release numbered ≤ 4 | 6 |
| A statement member `"Condition2"`, or a duplicated `"Action"` member | 4 |
| `"Principal": "*"` or `{"AWS": "*"}` on the `Decrypt` statement | 8 |
| `Principal` `arn:aws:iam::444455556666:role/x` (another account) on `GenerateDataKey` | 8 |
| `Principal` `{"Service": "ec2.amazonaws.com"}` on any statement | 8 |
| `"Principal": "*"` on the read-only statement | 8 |
| `Decrypt` without the `kms:CallerAccount` condition, or with another account | 8 |
| `ListGrants` returns one grant | 3 |
| `DescribeKey` shows `Origin` = `EXTERNAL` or `MultiRegion` = `true` | 2 |
| `ScheduleKeyDeletion` without the window condition, or with `NumericGreaterThanOrEquals`, `NumericEqualsIfExists`, another value, or an array value | 7 |
| `ScheduleKeyDeletion` or `CancelKeyDeletion` for the host role, the account root, or a second ARN (an array) | 8 |
| `"Action": "kms:DisableKey"` for the retirement principal | 6 |
| `kms:EnableKey` in the `Decrypt` statement | 6 |
| A retirement statement whose principal is not the pinned retirement principal | 8 |
| A retirement statement that also lists `kms:DescribeKey` | 6 |
| `NumericEquals` (on the window key) in the `Decrypt` statement | 7 |
| A retirement statement without the `kms:CallerAccount` condition | 8 |
| The retirement principal added to the `Decrypt` statement's principals | 8 |
| An image without a pinned retirement principal checks the example | 6 (retirement actions disqualify) |

**What remains trusted.** The check moves the guarantee from VettID's word
to AWS's documented behaviour: that KMS enforces key policies, grants and
attestation conditions as specified, that Nitro attestation documents
cannot be forged, and that AWS itself does not bypass them. It cannot
detect a key-policy evaluation flaw in KMS or an AWS insider.

#### 11.10.8 Channels and release constants

(0.10.0; VAULT-RELEASES §3.1, §5.2.) VettID builds three channels:

| | dev | staging | production |
|---|---|---|---|
| Build | development enclave (fake NSM and KMS) | release build, channel `staging` | release build, channel `prod` |
| Manifest key | a test key | the staging key (deletable) | key A (KMS) and key B (offline) |
| Manifest URL | none | `https://staging.vettid.org/.well-known/vettid/pcr-manifest.json` | `https://vettid.org/.well-known/vettid/pcr-manifest.json` |
| Sealing-key account | none | the staging account | the vault production account |
| Retirement window | none | 7 days | 30 days |
| Release numbers | 0 | its own sequence | 1, 2, 3, … |

**Release constants.** Each release image embeds the constants of exactly
one channel, from a committed per-channel file selected at build time,
so that the image is reproducible from its tag and the channel is
recorded in the build's measurements:

- the release number (§11.10.1);
- the manifest public keys (production: key A and key B; staging: the
  staging key), `key_id` selecting one;
- the sealing-key account and region (§11.10.2);
- `retirement_principal` and `retirement_window_days` (§11.10.7; a
  channel file with another window than its channel's, 30 or 7 days, is
  malformed);
- the Android signing-certificate digests (§11.7);
- the relay URL (§11.3).

GrapheneOS verified-boot keys and the vendor roots stay in code and are
the same for every channel. A release build MUST refuse a channel file
with a placeholder or a missing value, and an image whose configuration
is incomplete refuses every enrollment and unlock (fail closed).

**Channels cannot cross.** A staging image is never mistaken for a
production one: its constants are measured, so its PCR0 differs;
production apps and images never pin the staging manifest key, so no
production manifest can list it and no staging manifest is accepted by
production code; each image refuses sealing keys outside its channel's
account (§11.10.2); and production keys' policies name production PCR0s
only (§11.10.7). Apps pin per channel too: a production app pins only the
production manifest keys and URL.

### 11.11 Recovery

Recovery lets a member who has lost **their app** (the vault's one app,
§6.7) get back into their vault. A member who still holds the old phone
uses a direct transfer instead (§6.7.1). They need:

- their account (member session and email);
- 24 hours during which nobody cancels;
- a new attested app;
- their PIN;
- their Protean Credential password, checked against the vault's backup
  copy of the credential (§3.5.6).

**A recovery exists only with the credential backup on** (0.16.0, owner
decisions of 2026-10-06, §15 item 24: "THERE IS NO RECOVERY IF BACKUP IS
DISABLED"). A vault that keeps no backup copy cannot be recovered: the
member API refuses the request upfront (§11.11.7), and the enclave
refuses it as well, and refuses any register or recovering unlock that
would reach such a vault (§11.11.1, §11.11.3, §11.11.5). Nothing of the
vault is released to anyone without the credential. A member who lost
the phone with the backup off can only delete the vault and start over
(§11.11.9).

The new app **replaces** the old one: the old app is removed and its keys
revoked, and the credential copy it held is dead. Desktops and agents are
kept (owner decision, 2026-10-03).

There is one flow and no bypass:

```
Portal      Member API                   Enclave (vault process)        Owner devices
 |--POST /api/vault/recovery{browser_key}-->|                                |
 |          |--queue: recovery----------------->| lock running vault -------->| vault.locking{recovery}
 |          |   email: requested + cancel link  | mint code; header record   |
 |          |<--slot: code sealed to browser key-|                            |
 |          (24 h; cancel from portal, email link or an owner app's unlock)  |
 |--GET /api/vault/recovery (after available_at)--> sealed code              |
 | decrypt in the browser; show the QR (rendered locally)                    |
New app --scan QR--> POST /api/vault/recovery/claim{app_key} (0.15.0) --> user_guid
New app --POST /api/vault/recovery/register (signed) --queue--> code + device attestation:
         |                                       unlock key added (header)   |
New app --POST /api/vault/unlock (PIN; enclave backoff)--> vault opens; vault_bundle
New app --hs.init (purpose app, ctx = recovery_id) --> device record, restricted
New app --credential.recover{password} (credential backoff)--> credential handed over;
         the app becomes the vault's app (holder); the old app is removed
```

(Backup off, 0.16.0: the API answers the first request `409
recovery_unavailable`; nothing else happens. §11.11.9 is the member's
only path.)

While the vault is locked it has no DEK (§12.1). The recovery record
therefore lives in the **sealed header**, which a vault process can open
without the PIN (§3.3). It holds:

- `recovery_id`;
- the state: `pending` or `registered`;
- `requested_at`, `not_before` and `expires`;
- the code's hash and the count of wrong codes;
- the registered app's `ik`, `kem`, relay key, name and attestation
  binding.

The header also keeps a log of the steps taken while the vault was locked
(at most 64). The vault moves that log into the audit log (§10.9) at the
next unlock.

#### 11.11.1 Request

`POST /api/vault/recovery` (§11.11.7) enqueues the operation `recovery`,
carrying the browser's public key. It goes to the instance holding the
vault's live lease, or else to a live instance of the vault's
`sealed_release`. The queue message's `request_id` is the `recovery_id`.

The enclave:

1. in the vault's process, refuses the recovery if the sealed header has
   no credential (`has_credential` false, §3.5.7) or no backup copy of
   it (`credential_backup` false, §3.3, §3.5.6; 0.16.0). A running
   vault decides from its own state, which the header mirrors. Neither
   vault can be recovered. A refused request **does not lock the vault**
   and records nothing (0.16.0: before, the lock came first);
2. otherwise **locks the vault if it is running.** It finishes the
   batch, flushes, and sends `vault.locking{reason: "recovery"}` to the
   owner's devices. That notice is the only one owner devices can get
   from the vault: once it is locked, the vault does not touch the
   relay;
3. mints the code and writes the recovery record into the sealed
   header (`header_seq` + 1);
4. returns the code, or the refusal, sealed to the browser key (§11.11.2)
   as the response slot's envelope.

A header written before 0.16.0 has no `credential_backup`; the vault
treats it as `true` at this step and decides at the registered app's
unlock, from its state (§11.11.5 step 1). The next header write records
the bit.

If a recovery is already recorded, a new request replaces it and voids
the older code. The API allows only one active recovery per vault.

#### 11.11.2 The code

- **Form.** The code is 20 random bytes (160 bits), written as 32
  Crockford base32 characters (`0-9A-HJKMNP-TV-Z`, upper case, no
  padding). It is single-use and bound to `vault_id` and `recovery_id`.
- **Hash.** The header keeps only

  ```
  SHA-256("vettid/vms/2/recovery-code" || 0x00 || vault_id || 0x00 || recovery_id || 0x00 || code)
  ```

  The code itself is never stored or logged, by the enclave or the API.
- **When it is valid.** The code is valid from `not_before` = request + 24 h
  until `expires` = `not_before` + 24 h. The enclave enforces these times
  with its own clock, independently of the API.
- **Wrong codes.** After 5 wrong codes the recovery is void and its record
  is removed.
- **Sealed to the browser.** The portal makes a P-256 key pair in the
  browser (WebCrypto, non-extractable, kept in IndexedDB) and sends the
  public key with the request. The enclave seals the code to it:

  ```
  out = 0x01 || eph (65) || nonce (12) || AES-256-GCM(k, nonce, aad = out[0:78], pt)
  k   = HKDF-SHA-256(ikm = ECDH(eph, browser_key), salt = eph || browser_key,
                     info = "vettid/vms/2/recovery-code-seal" || 0x00 || vault_id || 0x00 || recovery_id, L = 32)
  pt  = {"v":1,"vault_id","recovery_id","code","not_before","expires_at"} || 0x00 padding
      | {"v":1,"vault_id","recovery_id","error":"no_credential"|"no_backup"} || 0x00 padding
  ```

  The second form tells the portal that the vault cannot be recovered
  (§11.11.1): it has no credential (`no_credential`), or no backup copy
  of it (`no_backup`, 0.16.0); nothing is recorded. The API normally
  refuses a backup-off request before it reaches the enclave
  (§11.11.7), so `no_backup` arrives only when the API's bit was absent
  or stale. The enclave's answer to a refused request, with either
  error (`no_backup` or `no_credential`; a vault without a credential
  exists only during enrollment, §3.5.7), carries the
  clear marker `code: "recovery_unavailable"` (0.16.0), which the host
  copies into the slot as it does `recovery_registered` (§11.5): the
  member API ends the recovery at once and returns the sealed refusal
  to the portal without waiting for `available_at` (§11.11.7). The
  marker says only "not recoverable", which the host learns anyway
  from the backup bit (§11.5).

  `out` is exactly 5,252 bytes, the size of every result in a response
  slot. If the enclave cannot answer (an unknown vault, another member's
  vault, a store failure), the slot holds random bytes of that size and the
  portal cannot decrypt them. The member then requests again.
- **QR.** After `not_before`, the API releases the sealed code to the
  portal. The portal decrypts it and shows the code as a QR rendered in the
  page; no third-party QR service is used. The QR payload is the compact
  JSON

  ```json
  {"v":1,"t":"r","api":"https://account.vettid.org","vault_id":"<id>","recovery_id":"<ULID>","code":"<32 chars>"}
  ```

  `api` (0.15.0) is the member API origin of the portal that made the QR,
  as in the enrollment QR (§11.12.1): an identifier the app compares
  exactly with its own built-in origin, refusing a mismatch, and never an
  address it connects to. Apps of 0.15.0 require it; the portal of
  0.15.0 always writes it.

  The QR (0.10.6) encodes those exact bytes in **byte mode**, with error
  correction **M or higher** and a **quiet zone of 4 modules**, dark
  modules on a light background. The version is whatever fits (the
  account site uses the smallest one at level M). For a 32-hex
  `vault_id` the payload is 181 bytes with 0.15.0's `api`, which needs
  **version 10** (57 × 57 modules) at level M; before `api` it was 146
  bytes, version 8 (49 × 49). The app
  MUST accept any version and any level from M up.
  The portal also shows the code as text, in groups of four, for typing.
- **Why the vault mints the code.** VettID's servers never hold the code
  in a usable form: the API stores only the ciphertext sealed to the
  member's browser. The 24 h delay and the expiry are enforced inside the
  enclave. So a copy of the API's tables, or an operator reading them,
  cannot register a device, and neither can an API that releases the
  ciphertext early.
- **Residual: the portal's code.** A VettID that serves malicious portal
  code to the member's browser can read the code; the browser key protects
  data at rest, not against the page's own author. Such an attacker still
  needs the PIN and the password, guessed online under the enclave's
  backoffs. The same holds for an attacker who controls the member's email
  and account session for 24 h without being noticed.
- **PQC exception.** The browser seal uses P-256 ECDH, the only key
  agreement in WebCrypto. A recorded ciphertext is worthless to a future
  quantum attacker, because the code expires within 48 h and is
  single-use. This is the one place where §1.1 item 7 does not apply.

#### 11.11.3 Register

The new app scans the QR and sends `vault.recovery.register` over the
alternate channel. Like `vault.unlock`, the request is sealed to the ETK
of the instance named by `GET /api/vault/enclave` and padded to 12,288
bytes:

```json
{ "user_guid": "...", "vault_id": "...", "request_id": "<ULID>",
  "recovery_id": "<ULID>", "code": "<32 chars>",
  "app": { "ik": "<b64>", "kem": "<b64 ek>",
           "relay": {"url": "<base>", "mailbox": "<id>", "pk": "<b64>"},
           "name": "<device name>", "device_attest": { },
           "api_key": "<b64 SPKI DER, P-256>" } }
```

`app.api_key` (0.15.0) is REQUIRED: the new app's app key (§11.12),
which the enclave binds to the queue message's `app_key` like
`user_guid`. The app takes `user_guid` from the claim (§11.11.7).

The enclave applies the binding and replay rules of §11.3 and §11.6. It
then checks, in this order:

1. the recovery exists and `recovery_id` matches;
2. the recovery is still `pending`, and the header records a credential
   and a backup copy of it (`has_credential`, `credential_backup`;
   0.16.0). The backup cannot change while a recovery locks the vault,
   so this only catches a header written before 0.16.0 or a damaged
   one; on failure the recovery record is removed and the answer is
   `no_backup`;
3. the code has not expired;
4. `not_before` has passed;
5. the code matches the hash, compared in constant time;
6. the device attestation is valid (§11.7), over the challenge with this
   request's `request_id`, the `vault_id` and the inner `ts`. It is checked
   only after the code matched, so a failure leaves the code usable.

On success it adds the app to the header's unlock keys, with its app key,
and sets the state to `registered`; the code is spent. Its answer to the host then also
carries the clear marker `code: "recovery_registered"` (§11.5, 0.10.6),
which the host copies into the response slot, so that the member API
stops releasing the spent code (§11.11.7). Any other answer, `ok: false`
or random bytes, carries no marker.

The answer is `vault.recovery.result`, sealed to `app.kem` and padded like
unlock results:

- `{"ok": true}`, or
- `{"ok": false, "code": "no_recovery|used|expired|too_early|bad_code|attestation|bad_request|retry|no_backup"}`.

A request the enclave cannot read or bind is answered with random bytes.

#### 11.11.4 Cancel

A recovery is cancelled by any of:

- the portal or the email link: `POST /api/vault/recovery/cancel` and
  `/cancel-link`, which enqueue `recovery_cancel`;
- an owner app's `vault.unlock` with `cancel_recovery: true`. It cancels
  only if the unlock succeeds (PIN, device assertion), and the result says
  `recovery_cancelled: true`;
- expiry, or the fifth wrong code.

Cancelling removes the record and any registered unlock key. A recovered
app that was already paired but has not finished `credential.recover` is
unlinked at the next unlock (§7.4).

While a recovery is in progress, an unlock by any app other than the
registered one is refused with `recovery_pending`, without trying the
PIN. That keeps a thief who holds a lost phone and its PIN out of the
vault for the 24 h, unless they cancel. Cancelling is always allowed,
because it only reduces exposure. Owner apps learn of the recovery from
`vault.locking{reason}`, from `recovery` in `GET /api/vault/status`
(§11.11.7), or from `recovery_pending`, and can cancel from there.

#### 11.11.5 Unlock, password and handover

Only a vault with a backup copy of its credential gets here (§11.11.1,
§11.11.3). Until the password has been proved against that copy, the
recovering app learns nothing of the vault's contents (0.16.0): not its
devices, connections, items, messages, profile, audit log or feed, and
not its owner check's state.

1. **PIN.** The registered app unlocks with `vault.unlock` and the PIN,
   under the normal enclave backoff (§11.8).
   - The app does not know the vault's relay key yet, so its `token` is an
     open token for its own mailbox. The vault ignores the token of a
     device it has no record of.
   - **No backup copy: refused** (0.16.0). If the vault, once opened with
     the PIN, keeps no backup copy of its credential (§3.5.6; possible
     only for a header written before 0.16.0, §11.11.1), it answers
     `{"ok": false, "code": "no_backup"}` with no token and no bundle,
     removes the recovery record and the registered unlock key (as a
     cancel does, §11.11.4), and locks again in the same step, before it
     collects or serves anything. The app tells the member that the
     vault cannot be recovered and points to §11.11.9.
   - Otherwise the result carries `token` (a standing token for the
     vault's mailbox) and `vault_bundle` (`{v, suite, ik, kem, relay}`,
     as in `vault.enrolled`): the vault's public keys and relay address,
     which the app needs for the handshake, and nothing of the vault's
     contents. The bundle is authenticated by being sealed to `app.kem`,
     which only the attested enclave received, inside the register
     request.
   - The result also carries `credential_backup` (bool, 0.10.6), which
     since 0.16.0 is always `true` (above).
2. **Handshake.** The app sends `hs.init` with purpose `app` and `ctx` =
   `recovery_id`. It is accepted without approval, exactly as the first
   app's handshake (§11.3), because its keys were bound at registration.
   The resulting device record is **recovering**:
   - it may send only `credential.utk.get`, `credential.recover`,
     `vault.status` and the token and address types (`relay.token.*`,
     `relay.address.update`); anything else is `forbidden` (0.16.0
     removed `credential.reset` and `vault.delete`);
   - `vault.status` answers it only `{vault_id, state_seq, header_seq}`
     (§10.2, 0.16.0);
   - it receives no fan-out, `sync.event`, feed item, alarm or held
     notice (`vault.held`), and its `relay.token.*` and address messages
     carry only its own tokens;
   - it is not announced to the other devices;
   - the owner-check hold (§3.6.3) does not apply to it: a vault held
     when the recovery began (the usual case after 24 h) still lets the
     recovering app send these types.
3. **Password.** The app first gets UTKs with `credential.utk.get`, which a
   recovering app may send. It then sends `credential.recover{utk_id,
   sealed{password}}`.
   - The vault opens its own backup copy of the latest blob (§3.5.6) with
     the current CEK and the password, under the credential's password
     backoff (§3.5.3). 0.9.0 removed the member-supplied blob: there is
     no off-device copy to supply (§3.5.6).
   - As with every use, the vault then rotates the CEK, re-keys every
     critical item (§10.7) and returns the new blob (`{credential,
     version, utks}`). The copy on the lost phone becomes undecryptable.
   - **The new app replaces the old one,** in the same flush:
     - the device becomes the vault's app and the credential's holder
       (§3.5.9), and the recovery record is removed;
     - its app key becomes the vault's app key (`app_key_seq` + 1), and
       the vault reports it to the host (`app_key`, §11.5; 0.15.0): the
       old app's key is refused by the member API from then on;
     - every other device of role `app` is removed as by `device.unlink`
       (§7.4): `device.unlinked{reason: "replaced"}` best effort, its
       relay key denylisted, its unlock key and UTK pool removed, audit
       `device.replaced` and a feed item, `sync.event{kind:
       "device.unlinked"}`;
     - **desktops and agents are kept**, with their access sessions and
       LEASH grants;
     - the other devices receive `sync.event{kind: "device.paired"}`;
     - the owner check's clock starts (§3.6.1): the registered app's
       unlock verified the PIN and this step the password, and a hold
       ends.
   - Only from here is the app an owner device with the holder's rights;
     everything it learns about the vault, it learns now.
   - A clone alarm that is open (§3.5.9) moves to `rotation_required`:
     the recovered app must rotate before using the credential.
   - A member who recovers in order to delete the vault does so as the
     holder after this step (`vault.delete`, §12.5).
4. **Backup off: no recovery** (0.16.0, owner decisions of 2026-10-06,
   §15 item 24, replacing 0.9.0's "access only" path). With
   `credential.backup` off there is no recovery flow at all: the API
   refuses the request (§11.11.7), the enclave refuses it (§11.11.1),
   a register (§11.11.3) and the registered app's unlock (step 1), so no
   recovering device record is ever created and nothing of the vault is
   released. 0.9.0–0.15.2 let the recovering app reset the credential
   (keeping the rest of the vault: messages, connections, profile,
   `data` and `secret` items, the audit log, the feed, the location log)
   or delete the vault with the PIN alone; both are removed, with
   `credential_lost`. The member's only path is to delete the vault and
   enroll a new one (§11.11.9).
5. **No credential, no recovery.** A vault without a credential is refused
   at the request (§11.11.1). It cannot exist past enrollment (§3.5.7).
   There is no completion on the PIN alone.

#### 11.11.6 Limits and audit

- **Enclave limits:**
  - 5 wrong codes per recovery;
  - the PIN backoff (§11.8);
  - the credential password backoff (§3.5.3);
  - one recovery per vault (a new request replaces the old).
- **Member API limits** (§11.11.7): requests, registrations, cancels and
  status polls are rate-limited.
- **Audit in the vault.** Every step is recorded (`recovery.*` kinds,
  §10.9). Steps taken while the vault was locked are written from the
  header's log at the next unlock.
- **Audit in the API.** The API audits the request, every cancel, the
  release of the sealed code and every register request. It never
  records the code, the browser key or envelopes.

#### 11.11.7 Member API routes

All routes follow MEMBER-API conventions. The first three require a
member session and the current terms (the portal); the last two are the
new app's (0.15.0), signed by its app key (§11.12.2) and needing no
session:

| Route | Body | Answer |
|---|---|---|
| `POST /api/vault/recovery` | `{browser_key}` (b64 of 65 bytes) | `202 {recovery_id, available_at, expires_at}` |
| `GET /api/vault/recovery` | — | `{recovery: {recovery_id, vault_id, state, requested_at, available_at, expires_at, sealed_code?} \| null}` |
| `POST /api/vault/recovery/cancel` | `{recovery_id}` | `200 {cancelled}` |
| `POST /api/vault/recovery/claim` | `{vault_id, recovery_id, app_key}` | `200 {user_guid, email_hint}` (0.15.0) |
| `POST /api/vault/recovery/register` | `{vault_id, request_id, instance_id, etk_kid, envelope}` | `202 {vault_id, request_id}`; the result is polled like unlock (`GET /api/vault/requests/{id}`) |

- **Claim** (0.15.0). The new app, which has no session and no vault
  key at the API yet, presents the QR's `vault_id` and `recovery_id` with
  its app key. The API accepts it only while that recovery is
  `available` (`409 recovery_not_available`; `404` for an unknown pair),
  records the key as one of the recovery's **claim keys** (at most 10, the
  register limit; the oldest is dropped), and answers the member's
  `user_guid` (for the sealed register and unlock bodies) and
  `email_hint` (§11.13), which the app shows. A claim key may call
  `enclave`, `register` and poll its own requests. The API forwards a
  register only if it is signed by a claim key, and puts that key in the
  queue message's `app_key`. When a register's slot carries
  `recovery_registered`, that register's key becomes the recovery's
  **recovering key**, which may also `unlock`, `lock` and read `status`
  until the recovery ends or the vault reports the key as its app key
  (§11.11.5 step 3). Knowing `vault_id` and `recovery_id` (both in the
  QR) lets a stranger claim, which gains nothing: the enclave still
  needs the code and an attestation.

The email link uses its own route, `POST /api/vault/recovery/cancel-link`
with body `{token}`, answered `200 {cancelled}` like the session's
cancel. It needs no session: the token stands in for it.

- **No vault.** Without an enrolled vault (none, `enrolling` or
  deleted), `GET /api/vault/recovery` answers `{recovery: null}`, not
  `404` (0.10.6, as the API always did).
- **`vault_id`** (0.10.6): the vault being recovered, which the portal
  needs for the seal's HKDF `info` (§11.11.2) and the QR payload.
- **State.** `state` is `pending`, `available` (from `available_at`, when
  `sealed_code` is returned), `registered` (0.10.6), `cancelled`,
  `expired` or `unavailable` (0.16.0: the enclave refused it, below). `sealed_code` is the slot's 5,252 bytes; the API returns it
  only between `available_at` and `expires_at`, and only while the state
  is `available`.
- **Registered** (0.10.6). Once a `recovery_register` request for this
  recovery has been answered with the marker `recovery_registered`
  (§11.11.3; the API sees it in that request's slot, whether through the
  app's poll of `GET /api/vault/requests/{id}` or its own check), the
  API records the recovery as `registered`: the code is spent and
  `sealed_code` is no longer returned, so the portal says the code was
  used. A registered recovery stays active (it blocks a new request
  with `409 recovery_active`, it is shown in `GET /api/vault/status` and
  it can still be cancelled, §11.11.4) until `expires_at`, and keeps
  reading `registered` afterwards. The API cannot see the rest of the
  recovery (unlock, `credential.recover`); the vault removes its record
  when it completes.
- **Cancelled.** `{cancelled: true}` when this call ended an active
  recovery (`pending`, `available` or `registered`), `{cancelled: false}`
  when there was nothing to cancel (it had ended already, by a cancel or
  its expiry). The cancel link stays usable until
  the recovery's `expires_at`, so a second use answers `false`.
- **Request.** The API accepts a request only for a vault in a state other
  than `enrolling`, and only when no recovery is `pending` or `available`
  (`409 recovery_active`). **Backup off** (0.16.0): when the vault row's
  `credential_backup` (§11.5) is `false`, the API answers `409
  recovery_unavailable` with `reason: "no_backup"`, enqueues nothing,
  locks nothing and sends no email; the portal says that the vault
  cannot be recovered because its credential backup is off, and offers
  §11.11.9. When the bit is absent (a vault not yet reported by a 0.16.0
  release) the API forwards the request and the enclave decides
  (§11.11.1). The API also answers `409 deletion_pending` while a
  start-over deletion is pending (§11.11.9). It records the recovery on the vault row and
  sends the member an email with a single-use cancel link (a random
  256-bit token; the API stores its SHA-256).
- **Refused by the enclave** (0.16.0). When the request's slot comes
  back with `code: "recovery_unavailable"` (§11.11.2), the API records
  the recovery as `unavailable` (an ended state), returns the slot's
  envelope as `sealed_code` at once, for the portal to decrypt and
  show the reason, and emails nothing further. Claim and register are
  refused for it (`409 recovery_not_available`).
- **Register.** The API forwards a register only while the recovery is
  `available` (`409 recovery_not_available` otherwise). The enclave
  re-checks everything; the API's gate only saves work.
- **Cancel.** A cancel marks the recovery `cancelled`, enqueues
  `recovery_cancel` and emails the member.
- **Status.** `GET /api/vault/status` adds `recovery: {state,
  available_at} | null`, so that owner apps can show the recovery and
  offer to cancel it.

#### 11.11.8 Decisions

- **The recovered app replaces the old app; desktops and agents are
  kept** (owner decision, 2026-10-03, replacing 0.4.1's "old owner devices
  are kept"). The old app is removed at `credential.recover`, its unlock
  key and device keys revoked, and the credential copy it held is under
  a destroyed CEK. A stolen phone:
  - cannot use the vault during the 24 h (`recovery_pending`), though it
    can cancel the recovery;
  - after the recovery, is no longer a device of the vault.
- **No recovery without the credential** (owner decision, 2026-10-03).
  A recovery always ends with the member's credential password against
  the vault's backup copy of the latest blob.
- **No recovery with the backup off** (owner decisions of 2026-10-06,
  §15 item 24, replacing 0.9.0's "access only" recovery): "if you lose a
  credential and have backups disabled you should not have a path back
  besides re-enrolling. we don't want to leak anything to someone
  without the credential", and "THERE IS NO RECOVERY IF BACKUP IS
  DISABLED". The member API refuses the request upfront, from the one
  content-free bit the vault reports (§11.5); the enclave refuses it
  too. The only path is to delete the vault and enroll a new one
  (§11.11.9).
- A vault without a credential is not recoverable. It cannot exist past
  enrollment anyway (§3.5.7).

#### 11.11.9 Starting over: deleting a vault without the app

(0.16.0; owner decision of 2026-10-06, §15 item 24.) A member who has
lost the phone with the backup off, or who does not want to recover,
deletes the vault from the account portal ("Delete my vault and start
over") and then enrolls a new, empty vault with a setup code (§11.12.1).
The deletion needs no app, PIN or credential, because it **reveals
nothing**: it never opens the vault and returns nothing from it; it only
destroys (§12.5). Because it destroys, it has a recovery's delay, emails
and cancel, so that someone holding the member's account session cannot
destroy a vault at once.

| Route | Caller | Body | Answer |
|---|---|---|---|
| `POST /api/vault/deletion` | portal (session) | `{confirm: "delete my vault"}` | `202 {deletion_id, requested_at, deletes_at}` |
| `GET /api/vault/deletion` | portal (session) | — | `{deletion: {deletion_id, state, requested_at, deletes_at} \| null}` |
| `POST /api/vault/deletion/cancel` | portal (session), or the vault's app (signed by its app key, §11.12.2) | `{deletion_id}` | `200 {cancelled}` |
| `POST /api/vault/deletion/cancel-link` | the email's token, no session | `{token}` | `200 {cancelled}` |

- **Request.** A session of an active member with the current terms, as
  for a recovery request. `bad_request` without the exact phrase; `404`
  without a confirmed vault (none, `enrolling` or deleted; a provisional
  vault is replaced by the next setup code anyway, §11.3); `409
  recovery_active` while a recovery is `pending`, `available` or
  `registered`; `409 deletion_pending` while a deletion is pending. A
  recovery request is likewise refused `409 deletion_pending` while one
  is (§11.11.7). The portal offers it whatever the backup bit, and
  first when the API reports the backup off or a recovery was refused;
  with the backup on it says that a recovery would keep the vault.
- **24 hours, emails, cancel.** `deletes_at` = request + 24 h. The API
  emails the member at once (what will be deleted, when, that nothing
  can be restored, and a single-use cancel link,
  `https://account.vettid.org/vault/deletion/cancel#t=<token>`, stored
  as its SHA-256 only), and again on a cancel. A deletion is cancelled
  from the portal, the email link or the vault's app (its app key); the
  app learns of it from `deletion: {deletion_id, state, deletes_at}`
  in `GET /api/vault/status` (0.16.1: the id its cancel names), which it reads after every unlock and whenever
  it shows vault status, and offers to cancel. The vault is not locked
  and not told during the wait: it has nothing to decide.
- **Execution.** At `deletes_at` the API's scheduled job marks the
  deletion `executing` and enqueues the queue operation `delete` (§11.5)
  as for an account cancellation: a running vault deletes itself with
  the full semantics of §12.5, and a locked one has its stored objects
  erased by the instance. Retries follow MEMBER-API until the vault
  reports `deleted`, whose notice emails the member and removes the
  vault rows (§11.5). A cancel after `executing` answers `{cancelled:
  false}`.
- **Then.** With no confirmed vault, the portal issues a setup code
  (§11.12.1) and the member enrolls a new vault with a new `vault_id`.
  Nothing carries over: the new vault has none of the old one's items,
  connections, messages, profile, grants, audit log or feed, and the old
  connections are told only what §12.5 sends (`connection.removed`
  from a running vault; otherwise nothing, and their deposits fail once
  the mailbox is gone or its tokens expire).
- **Who enforces the delay.** The member API. An enclave-enforced delay
  would add nothing: deleting stored state is an operator power VettID
  has anyway (§13.5), and the deletion discloses nothing.
- **Limits and audit.** Requests 3 per member per day; cancels and the
  cancel link as for a recovery (§11.11.7). The API audits
  `vault.deletion_request`, `vault.deletion_cancel` (`via: session |
  link | app`) and `vault.deletion_executed`; never the token.

### 11.12 Enrollment codes and app keys

(0.15.0; owner decision of 2026-10-05: the app and the account portal are
separate. Design and rationale: ENROLLMENT-CODES.md.)

The app never signs in to the member API. The portal, where the member is
signed in, issues a **setup code** (a QR secret, and a short code typed
with the member's email); the app redeems it with its **app key**, which
then signs every app request to the API.

#### 11.12.1 The setup code

(Revised before approval, owner review of 2026-10-05: 5 minutes; a long
QR secret as the primary path; the typed code only with the member's
email; no global limit that one attacker could exhaust for everyone.)

- **Issue.** The portal's "Set up your vault" calls `POST
  /api/vault/enroll-code` with the member session (MEMBER-API). The API
  requires an active account in state `member` with the current terms
  (`403 terms_required` otherwise), revokes the member's live issuance
  if any, and makes one **issuance** with two secrets, both returned
  once:
  - the **QR secret**: 16 bytes from a CSPRNG, written as 22 characters
    base64url without padding (128 bits);
  - the **typed code**: 8 symbols from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`
    (31 symbols: no 0, 1, I, L or O), each chosen uniformly by rejection
    sampling: 31^8 ≈ 8.5 × 10^11, about 39.6 bits; shown as `XXXX-XXXX`.
- **Validity.** 5 minutes from issue, single use, at most one live
  issuance per member. Redeeming either secret spends the issuance, so
  both end together; a new issuance, the portal's cancel or expiry ends
  both too.
- **At rest.** With `k_code`, a secret key held by the API (never in the
  tables):
  - the issuance is stored under `HMAC-SHA-256(k_code, "qr" || 0x00 ||
    secret)`, its lookup key;
  - it holds `user_guid`, `code_mac = HMAC-SHA-256(k_code, "code" || 0x00
    || user_guid || 0x00 || code)`, `expires_at`, `state` and a count of
    typed attempts;
  - the member's pointer names the live issuance.
  Neither secret is stored, logged or audited.
- **QR.** The portal shows the QR secret as the QR payload

  ```json
  {"v":1,"t":"e","api":"<member API origin>","s":"<22 chars base64url>"}
  ```

  encoded as the recovery QR is (§11.11.2: byte mode, level M or higher,
  4-module quiet zone, any version), and the typed code beneath it as
  text. The QR does not carry the typed code. `api` is the portal's
  origin (production `https://account.vettid.org`): an identifier that
  the app compares exactly with its own built-in member API origin,
  refusing a mismatch with a message naming the other environment. An app
  MUST NOT send anything to an origin taken from a QR. On a phone the
  portal also offers the App Link `https://<account host>/vault/enroll/#s=<QR
  secret>`; it never puts the typed code in a link.
- **Redeem.** `POST /api/vault/enroll/redeem`, signed (§11.12.2) by the
  key in `app_key` with an empty `vault`, with exactly one of:
  - `{secret, app_key}` (scanned QR or App Link): the API looks the
    issuance up by `HMAC(k_code, "qr" || 0x00 || secret)`;
  - `{email, code, app_key}` (typed): the API normalises both (email
    trimmed and lower-cased; code without spaces or hyphens, upper case),
    finds the member by email and the member's live issuance through the
    pointer, and compares `code_mac` in constant time. The code is
    compared with that one member's issuance only: there is no space of
    codes shared between members.

  Either way the issuance must be live, unexpired, the member's current
  one, and its member an active `member`; for the typed form also not
  `typed_blocked` (below). Any failure, of either form, is `404
  invalid_code`. Then the API:
  1. marks the issuance used with a conditional write (single use, both
     secrets);
  2. finds the member's vault, or assigns a new `vault_id` (§11.3,
     "Re-enrollment"), and records `app_key` as the vault's **pending app
     key** for 1 hour;
  3. emails the member that a phone used their setup code, with the time;
  4. answers `{vault_id, user_guid, email_hint}`.

  The app shows `email_hint` ("Setting up a vault for m***@example.com")
  before it asks for a PIN, then enrolls (§11.3) with `user_guid` in the
  sealed request and every call signed by the app key. The pending key
  may call `GET /api/vault/enclave`, `POST /api/vault/enroll` and poll its
  own requests, nothing else. The enclave binds the vault to `user_guid`
  as before: the API, which issued the code, remains the authority on
  which member a vault belongs to.
  As for every enrollment, the vault's first `credential.create` starts
  the daily owner check's clock (§3.6.1); redeeming a code does not.
- **Vault service pause.** While the operator has paused the vault
  service (MEMBER-API 1.2.0, "Vault service pause"), issue, redeem and
  recovery `claim` (§11.11) are refused with `503 vault_unavailable` like
  `enroll`, before anything is spent, counted or written; reading and
  revoking the member's code are still served.
- **Limits** (§11.8), none of them global:
  - per source network, both forms: 30 redeems per 5 minutes per IPv4
    address, 10 per IPv6 /64;
  - typed, per (email, source network): 5 per 5 minutes;
  - typed, **per issuance: 800 attempts** across all sources. The chance
    that they find the code is at most 800 / 31^8 ≈ 9.4 × 10^-10 per
    issuance, and with at most 20 issuances a day at most 1.9 × 10^-8 per
    member and day. On reaching it the issuance becomes `typed_blocked`:
    typed redeems of it fail, a QR redeem of it still works, the member
    is emailed and operations are alerted. Flooding therefore costs at
    most one member the typed entry of one issuance;
  - the QR secret (2^128) needs no other limit.
- **No account oracle.** The typed form answers a wrong email, an email
  without a live issuance, a wrong code, and an expired, used, revoked or
  blocked issuance identically (`404 invalid_code`), after the same work
  (a member lookup and a MAC compared against the stored or a dummy
  `code_mac`) and no sooner than 250 ms after receipt. Its limits count
  attempts for every email, existing or not.
- **An existing vault.** A code can be issued and redeemed whatever the
  member's vault; the enclave decides (§11.3: a confirmed vault is never
  replaced, `vault_exists`). A pending key never replaces the vault's
  `app_key` at the API; only the enclave's report does (§11.5).

#### 11.12.2 The app key and signed requests

- **The key.** Each app makes, per vault, a P-256 signing key that never
  leaves its hardware: Android Keystore (StrongBox if present, else the
  TEE; non-exportable; purpose SIGN; no user authentication, so that lock
  and polling work in the background) or an iOS Secure Enclave key. It is
  distinct from the device attestation key (§11.7), whose certificate
  chain stays inside the enclave. Its public form is the b64 of its SPKI
  DER, and its id `akid` the first 16 bytes of SHA-256(SPKI DER), 32
  lowercase hex.
- **The header.** Every app request to `/api/vault/*` carries

  ```
  X-VettID-App: v=1; vault=<vault_id or empty>; kid=<akid>; ts=<Unix s>; nonce=<b64url, 16 bytes>; sig=<b64url DER ECDSA>
  ```

  where `nonce` and `sig` are base64url (RFC 4648 §5) **without
  padding**, canonical (0.17.0, editorial: as the apps send and the
  member API accepts; a padded value fails the header's syntax), and
  `sig` is ECDSA P-256 with SHA-256 over (each `\n` a literal
  newline, no trailing newline):

  ```
  "vettid/member-api/app/1" \n METHOD \n path \n query \n vault_id \n akid \n ts \n nonce \n hex(SHA-256(body))
  ```

  `path` is the request path as sent, `query` the raw query string
  without `?` (or empty), `body` the exact body bytes (empty for a GET).
  (Not `Authorization`, which the account site's CloudFront cannot forward
  through an origin request policy.)
- **Verification** (the member API). `ts` within 300 s of the API's
  clock; `nonce` not seen for this `akid` in the last 600 s (recorded
  with a conditional write); the key is one the vault row allows for the
  route (below); the signature verifies. Otherwise `401 unauthorized`,
  one answer for all. A request with this header is authenticated by it
  alone: cookies are ignored and the CSRF header is not required.
- **Which key may call what:**

  | Key | Recorded by | Routes |
  |---|---|---|
  | The vault's `app_key` | the host, from the enclave's reports (§11.5) | `enclave`, `unlock`, `lock`, `status`, its own `requests/{id}` |
  | The pending key | the API, at redeem; 1 hour | `enclave`, `enroll`, its own `requests/{id}` |
  | A recovery's claim keys | the API, at claim (§11.11.7) | `enclave`, `recovery/register`, their own `requests/{id}` |
  | A recovery's recovering key | the API, from `recovery_registered` | as a claim key, and `unlock`, `lock`, `status` |

  "Its own" requests: the API records the signing `akid` on each response
  slot, and answers a poll signed by another key `404`.
- **What the key cannot do.** The member API holds only public keys, and
  the enclave does not check app-key signatures: they authorize routing,
  rate limits and account checks, not anything in the vault. Every
  operation that matters still needs what only the app has (PIN, unlock
  key signature, device assertion, release approval, recovery code,
  attestation). A dishonest API can therefore do with app keys only what
  it could do already: refuse, misroute, lock.
- **Rotation and revocation.** The vault's app key changes only when the
  app does: a transfer (the new app's `api_key` in its `hs.init`, §6.2,
  §6.7.1) or a recovery (the key of the registered app, §11.11.5). Each
  change increments the header's `app_key_seq` and is reported to the
  host (`app_key`, §11.5); the old app's key is refused from then on.
  There is no other rotation in 0.15.0. A phone that lost its Keystore
  lost its attestation key too, and recovers.

### 11.13 Account status through the vault

(0.15.0.) Apps show the member's membership, terms and subscription
state, read-only, and get it only from their vault; changes are made on
the portal. Since 0.18.0 the snapshot also carries the account's first
and last name, which the vault puts in the core of its shared profile
(§10.8) and which the member changes only from the app
(`account.name.set`, §10.8), never on the portal. Since 0.20.0 it carries the member's full
email address, which the vault shows to the member's own app and
desktops only (owner decision of 2026-10-07, §15 item 28).

- **The snapshot** the member API builds from the member's account:

  ```json
  { "v": 1, "as_of": "<RFC 3339>", "email": "member@example.com",
    "first_name": "Ada", "last_name": "Lovelace",
    "name_change": { "allowed_after": "<RFC 3339>|null",
                     "last": { "seq": 3, "status": "applied|refused",
                               "reason": "too_soon|invalid|account" } | null },
    "state": "member", "account_status": "active|canceled", "deletes_at": "<RFC 3339>|null",
    "terms": { "needs_acceptance": false },
    "subscription": { "type_name": "...", "status": "trial|active|expired|canceled",
                      "paid": false, "expires_at": "<RFC 3339>" } | null,
    "voting_rights": false }
  ```

  `email` (0.20.0, owner decision of 2026-10-07) is the member row's
  address, the one the member verified at registration, as the member
  API stores it (trimmed and lower-cased; at most 254 characters, the
  registration rule, so at most 1,016 bytes of UTF-8 and in practice
  ASCII). It replaces 0.15.0's `email_hint` (the first character of the
  local part, `***`, `@` and the domain), which the snapshot no longer
  carries; the masked `email_hint` remains only in the code-redeem and
  recovery-claim answers (§11.11.7, §11.12.1), which reach an app before
  it has proved anything. `first_name` and `last_name` (0.18.0, owner
  decision of 2026-10-07) are the member row's names, as registered
  (MEMBER-API `/api/public/request`) or last changed from the app
  (§10.8): letters, spaces and `'’.-`, at most 40 characters each, so at
  most 160 bytes each. Every member has them from registration, and
  every snapshot carries them. `name_change` (0.18.0) is the member API's
  state of the name changes: `allowed_after`, when the next change may
  be applied (30 days after the last applied one; `null` when a change
  may be applied now, as before any change: the registration names do
  not count), and `last`, the outcome of this vault's latest
  `account.name.set` request that the API processed (`seq` as the vault
  sent it), or `null`. `last.status` is `"applied"` or `"refused"`
  (0.19.0); `reason` is present only with `"refused"`, as `"too_soon"`,
  `"invalid"` or `"account"` (§10.8), and is absent with `"applied"` (a
  vault ignores one there). Nothing else about the member is sent (no
  `user_guid`). At most 2 KiB, names and email included: the names
  take at most 320 bytes and the email at most 1,016, the rest about
  530 bytes (with a 64-byte subscription `type_name`), so the largest
  snapshot is about 1.9 KiB and a realistic one well under 1 KiB; the
  member API still sends none over 2 KiB (MEMBER-API).
- **The email stays with the member (0.20.0).** The vault returns the
  `email` only in `account.get`, to the member's app and to desktops
  (the member's own devices, a desktop within its access session as
  for every desktop request; §6.8). It MUST NOT put it, or anything
  derived from it (a hash, a hint, its domain), in a `profile.update`,
  an `hs.init` profile, an invitation bundle or its `hint`, a feed
  item, an audit entry, a LEASH statement or any other message to a
  connection or an agent, or in an event to its host, unless a future
  version of this specification says so. Agents never receive it:
  `account.get` is not an agent type and no LEASH grant reaches the
  snapshot (§10.11). Apps and desktops show it only to the member
  (the avatar sheet, Settings) and never include it in anything they
  send.
- **Version (0.18.0).** The snapshot keeps `"v": 1`, with `first_name`,
  `last_name` and `name_change` **required**: VettID has no members'
  vaults to stay compatible with (owner decision of 2026-10-07), so no
  older form is accepted. The vault refuses a snapshot without them, or
  with a name that is not a string of 1–160 bytes without control
  characters (C0, DEL, C1, U+2028, U+2029; DEL since 0.21.0, owner
  decision of 2026-10-08: the member API's names never contain it,
  MEMBER-API 2.3.1), or with a `name_change.last.status` other than
  `"applied"` or `"refused"` (0.19.0), as it refuses a wrong type, and
  keeps the one it had. Since 0.20.0 `email` is **required** too, still
  with `"v": 1`: a string of 3–1,016 bytes of UTF-8, with an `@`,
  without control characters, which for the email are (0.21.0) C0
  (U+0000–U+001F), DEL (U+007F), C1 (U+0080–U+009F), U+2028 and
  U+2029, the names' set (0.20.0 named no set; its reference refuses
  the first three and admits the line and paragraph separators, which
  a 0.21.0 vault refuses too). The member API refuses the same
  characters at registration (MEMBER-API 2.3.1, owner decision of
  2026-10-08), so that a vault never refuses a snapshot built from a
  registered member. A 0.20.0 vault refuses a snapshot without it, and
  ignores an `email_hint` if one is present (an unknown member). Older
  releases need no change to accept the new form: 0.15.0–0.19.0 vaults
  (staging release S4, and vettid-vault #45) check `email_hint` only
  when it is present and ignore unknown members, so they accept a
  snapshot with `email` and without `email_hint`, store it as received
  and return it in `account.get` unchanged; S3 predates the snapshot
  (0.15.0) and never parses one. The member API therefore sends
  `email` only, from MEMBER-API 2.3.0.
- **Delivery.** The API puts the snapshot in every `enroll` (0.18.0) and
  `unlock` queue message (`account`, §11.5) and, when the member's
  account changes (terms accepted, subscription started, cancelled or
  changed, account cancelled, and since 0.18.0 a name change processed,
  applied or refused), sends the op `account` to the vault's live
  leaseholder; with no live lease it sends nothing (the next unlock carries it). A new terms
  version is not fanned out: each vault learns it at its next unlock. A
  trial's expiry needs no message: apps show `expired` once `expires_at`
  has passed.
  A **suspended** account gets no snapshot (0.15.2; `account_status` is
  `active` or `canceled` only): the API sends none, in an unlock or as
  an op, and the vault keeps the last one it stored (MEMBER-API 2.0.1).
- **In the vault.** After a successful enrollment (0.18.0) or unlock, or
  on the op `account` for a running vault, the vault parses the snapshot strictly (unknown members
  ignored, wrong types refused, over 2 KiB refused), ignores it unless its
  `as_of` is later than the stored one, stores it in DEK state with a
  `version` (+1 per change) and its own `received_at`, and sends
  `sync.event{kind: "account.changed", version}` to the app and desktops.
  They read it with `account.get` (§10.2). Agents and connections never
  receive it (§13.7), and never its `email` (above), except its
  `first_name` and `last_name`, which every
  connection receives in the shared profile's core (§10.8, 0.18.0) and an
  agent delegated `profile.get` reads there. A stored snapshot whose names
  differ from the last ones sent triggers the `profile.update` of §10.8,
  and its `name_change.last` settles a pending name request (§10.8).
- **While held** (§3.6.3). The op `account` is still stored (it comes
  from the host, not an owner device), but `account.get` is not on the
  hold's allow list (`owner_check_required`), and
  `sync.event{account.changed}` waits for the check like any other
  fan-out; devices catch up with `sync.since` after it.
- **Display only.** Nothing in the vault depends on the snapshot except
  the profile's core names (0.18.0), and it is not authenticated beyond
  the host path: it is VettID's own data about the member, which VettID
  could equally withhold or change. That is why apps present the names
  as the account's, never as verified (§10.8). Membership and terms are
  enforced by the member API (§11.1).

## 12. Locked vaults and the collect manager

### 12.1 Locked

A locked vault has no DEK in memory, and therefore no relay key. It does not:

- collect;
- ack;
- deposit;
- mint tokens;
- trigger wakes.

Peers' deposits still succeed and wait up to the relay TTL. When the vault
unlocks, messages that expired in the meantime show up as `seq` gaps.
Connections whose standing tokens lapsed recover through reconnect tokens
(§6.6).

A **held** vault (§3.6.3) is not locked: it keeps its keys, collects,
acks and serves its peers, and refuses only its owner's devices until a
check. A held vault may still be locked by any trigger of §12.3.

### 12.2 Collect manager

- **One collect loop per unlocked vault.** The loop runs inside the enclave
  as a signed long-poll (`wait=25`, `max=32`) or a WebSocket. During a
  rotation grace period it also collects from the old mailbox.
- **Batches.** Each vault handles one batch at a time (§8.3).
- **TLS.** The enclave terminates TLS to the relay, and to AWS KMS
  (`kms.<region>.amazonaws.com`, §11.10.7). The parent forwards only TCP
  bytes to its allowlist on port 443. The enclave pins only the
  roots for the allowlisted hosts (VAULT-PLAN §5.2), so root changes are rare
  releases. Each instance carries every vault's relay requests over a few
  shared HTTP/2 connections rather than one connection per vault, so the host
  cannot attribute traffic to a vault by connection. Inside the enclave the
  collect loop therefore uses the long-poll (a WebSocket would need a
  connection of its own). AWS KMS endpoints offer only HTTP/1.1; KMS
  requests use a small pool of keep-alive connections.
- **No chain access.** The wallet (§10.18) adds no egress: the member's
  app is the chain source (owner decision, 0.8.0).
- **On unlock**, in order:
  1. re-mint tokens and start reconnects (§7.2);
  2. rekey due device sessions;
  3. drain the outbox;
  4. start collecting;
  5. renew the lease while unlocked (§11.1).

### 12.3 Lock triggers

| Trigger | Behaviour |
|---|---|
| Owner request (`vault.lock`, API lock route) | Finish the batch, flush, send `vault.locking`, stop the loop, release the lease, zeroize. |
| Ten consecutive failed owner checks (§3.6.4, 0.13.0) | Same as an owner request, with `vault.locking{reason: "owner_check"}`, after the audit entry and the urgent feed item. The host sees an ordinary lock. |
| Memory pressure (the least recently active vault is evicted) | Same as an owner request. |
| Enclave release or restart | Same if signalled. Otherwise all vaults lock through loss of memory, and their leases expire; a parent that sees the enclave restart releases the leases it held. |
| Parent restart (the enclave keeps running) | The enclave locks every vault before it serves the new parent, which holds no leases for them. |
| Parent unreachable for 120 s | Every vault is locked: its lease can no longer be renewed. |
| Lease lost (renewal failed) | Same as an owner request, without the final flush if the state write fails. |
| Split-brain guard: a conditional state write finds a newer version | Zeroize **immediately**, without flushing or acking. |
| Vault deletion | Run the §7.4 revocations, then destroy the state and the header. |
| Account cancelled | Vault routes other than lock are refused at once (§11.1); the vault is locked. After the 7-day grace period the API deletes the vault rows and the stored state and headers. |

There is no idle lock by default; the owner MAY set one. The owner
check's hold (§3.6.3) is not a lock trigger: a held vault keeps running.
Leases left by a lock expire within 60 s (relay) and 180 s (vault
lease). Zeroizing covers the DEK and the relay, identity, KEM and
session keys; with one process per vault (§12.4), locking ends the
vault's process, which releases all of its memory.

### 12.4 Process isolation inside the enclave

The enclave runs a **supervisor** and **one OS process per unlocked
vault**.

- **The supervisor** (the enclave's first process) keeps only shared
  duties: access to the NSM, the ETKs and the outer decryption and routing
  of alternate-channel requests (§11.2, §11.6), the egress (TLS and the
  shared connections of §12.2), the connection to the parent, and the vault
  processes' lifecycle. It holds **no per-vault long-term secret**: no DEK,
  pepper, relay key, identity or KEM key, session key, or vault state in
  plaintext.
- **The supervisor sees the PIN transiently.** As the ETK holder it
  decrypts an enroll or unlock request, hands the decrypted request to the
  vault's process, and zeroizes its copy at once. It is the enclave's
  shared trusted base, as the ETK requires.
- **A vault process** is started for an enroll or unlock and ends on lock.
  Everything else of the vault runs in it: the sealed header is unsealed
  there (it attests its own ephemeral RSA key for the KMS `Recipient`, so
  only that process can read the data key; the supervisor only obtains the
  attestation document and forwards the KMS call), the DEK is derived
  there, relay requests are built and signed there (the relay key never
  leaves it), state objects are encrypted there, and every feature handler
  runs there.
- **A vault process reaches nothing but the supervisor**, over one private
  channel. The supervisor scopes what it brokers to that vault: objects
  under `vaults/<vault_id>/` and the member's index object (reads of the
  member's previous vault at re-enrollment, §11.3), relay requests to the
  allowlisted relay signed by the vault's own relay key, KMS calls, and
  attestation documents that bind the process's own Recipient key or the
  vault bundle of §11.3, never arbitrary `user_data`.
- **Isolation of the processes from each other:** each runs under its own
  user and group id, is not dumpable and cannot be traced, inherits no
  file descriptor but its channel and no writable shared file or
  directory, and runs under resource limits (memory, file descriptors).
- **Locks:** an owner request, memory pressure, a lost lease or a lost
  parent make the supervisor ask the process to lock (flush, `vault.locking`,
  exit); a process that does not exit in time is killed. A process that
  detects a split brain (§12.3) zeroizes and exits without flushing.
  Killing one vault's process affects no other vault.

### 12.5 Vault deletion

A vault is deleted on one of these authorities:

| Authority | Request | What it needs |
|---|---|---|
| The holder (§3.5.9) | `vault.delete` (§10.2) | the phrase `delete my vault`, the PIN and the credential password over the current blob, both UTK-sealed; both backoffs apply; refused (`credential_frozen`, `rotation_required`) while a clone alarm is open |
| The enrolling app of a vault without a credential (§3.5.7) | `vault.delete` | the phrase and the PIN |
| The host | the queue operation `delete` (§11.5): account cancellation (MEMBER-API), or a member's start-over deletion (§11.11.9, 0.16.0) | the member API's own checks; for a start-over, the member's session, the phrase and 24 h without a cancel from the portal, the email link or the app |

0.16.0 removed the recovering app as an authority (it had deleted with
the PIN alone when the backup was off). A member without the app or the
credential deletes through the portal (§11.11.9); a recovering app with
the backup on completes the recovery first and deletes as the holder.

A running vault deletes itself with the full semantics below; the host's
`delete` asks a running vault to do so (as a lock with the reason
`delete`) and otherwise erases the stored objects itself. Desktops and
agents cannot delete a vault.

**Order.** The steps run in this order, so that a crash at any point
converges to "deleted", never to a vault that runs again:

1. **Mark**, in the request's flush: state and sealed header record
   `deleting`. In the same flush the credential (CEK, credential state,
   UTK pools) and the features' secrets are destroyed; every active
   connection is sent `connection.removed`, every owner device
   `device.unlinked{reason: "vault_deleted"}`; every token the vault
   issued is revoked at the relay by `jti` and every peer's relay key by
   `sub` (§7.4); open invitation claims are deleted; a transfer ends. The
   requester's `{}` follows. Nothing else in the batch is handled.
2. **Relay mailbox, then drain** (0.9.1): the vault deletes its own relay
   mailbox (RELAY-PROTOCOL 0.5.0 §6.10, `DELETE /v1/mailbox` signed with
   the vault relay key), once. With it go every message waiting there,
   the denylist, blobs and the vault's claims, and from then on every
   deposit is refused (`mailbox_unknown`), so the revocations and claim
   deletions queued in step 1 are moot and are dropped from the outbox.
   If the request fails (a relay before 0.5.0 answers `not_found`, or
   the relay is unreachable after the client's retries), they stay
   queued as the fallback. Then the outbox is delivered once, best effort:
   the notices go to the connections' and devices' own mailboxes.
3. **Zeroize**: every key and the DEK are wiped; the vault is locked and
   its process exits (§12.4).
4. **Erase**, through the parent's store with conditional deletes, a
   missing object counting as deleted: the state object; the headers of
   every release the vault knew (a pending move's target and source),
   its own release's header last, since that header is the deletion
   marker; and the enclave's member index object if it still names this
   vault (§11.5).
5. **Report** the lifecycle event `deleted` (§11.5). The parent marks the
   row `deleted` and records the `vault_deleted` notice; the member API
   emails the member and deletes the vault rows (MEMBER-API).

**Convergence.** A header that records `deleting` is never opened again:
an unlock, a recovery request, registration or cancellation that reads
it finishes step 4 instead (and answers as for a missing vault). A crash
after step 1 therefore loses at most the best-effort notices, the relay
mailbox deletion and the revocations, never the deletion of the vault.
Deletion is idempotent.

**The relay mailbox.** The relay key exists only in the running vault
(§1.1 decision 3), so only step 2 can delete the mailbox; the relay's
delete is idempotent, so a repeat is harmless. Order: the mailbox goes
after the marking flush (a vault that is not yet marked can still run
again and must keep its mailbox) and before zeroize (which destroys the
key). Deleting it before the drain makes the queued revocations
unnecessary: a deposit into a mailbox that no longer exists is refused
whatever token it carries. The key is never registered again (step 3
destroys it), and the relay keeps a tombstone that would refuse every
token minted before the deletion even if it were (RELAY-PROTOCOL §6.10).
The mailbox stays registered only where step 2 could not delete it: a
crash between steps 1 and 2, a relay before 0.5.0 or one unreachable at
that moment (then the revocations apply, as in 0.9.0), and a vault the
host erases while it is locked (no key; its tokens expire on their own).
There, messages already deposited expire after `message_ttl_seconds` (14
days) and the registration stays, empty, with a key nobody holds.

**What is left.** Nothing of the vault's contents: state, headers and
index are erased, and the DEK, CEK and keys existed only in the
enclave's memory. The member API keeps its own audit records
(MEMBER-API).

- **Stored versions** (0.16.0, stated). The data bucket is versioned and
  keeps noncurrent versions and delete markers for **7 days**
  (VAULT-RELEASES §8.2, §11.4, O9), so the erased state object and
  headers survive as noncurrent versions for up to 7 days after step 4.
  They are the same sealed objects as before: the state under the DEK,
  which needs the PIN and an approved release (§3.3.1), and the headers
  sealed to the release. Nobody but the host role can read them, and
  restoring one needs a bucket-policy change (VAULT-RELEASES §8.2). A
  restored vault would be a rollback that the apps detect (§13.2);
  after a start-over (§11.11.9) no app holds it, and with the backup
  off there is no recovery into it. After 7 days nothing remains.
- The relay mailbox, where step 2 could not delete it, keeps messages
  for at most `message_ttl_seconds` (14 days), all end-to-end
  encrypted to keys that no longer exist (above).

## 13. Security considerations

### 13.1 Why the relay key is PIN-only

A PIN-independent copy of the relay key would let any release that satisfies
the sealing policy collect, ack and delete a user's messages without the
user. With the relay key held only in DEK state, mailbox access requires all
of:

- the PIN;
- a registered, attested device;
- a release the app has checked.

The cost is that a locked vault is offline. Three things soften that cost:
the 14-day relay TTL, reconnect tokens, and (later) push prompts asking the
user to unlock.

### 13.2 Rollback protection

The parent stores the encrypted vault state and the sealed header, so it
could serve older versions of either. Protection is **anchored in the
client**:

- **`state_seq`** is a monotonic counter. It is incremented on every durable
  state write and recorded in two places: inside the DEK-encrypted state, and
  in the sealed header. The header is rewritten after each state flush. The
  state may lead the header by one write if a crash falls between the two
  writes.
- **`header_seq`** is incremented on every header write, including writes
  that only record backoff, which also covers the backoff counter.
- Every unlock result returns `header_seq`. A successful unlock also returns
  `state_seq`. The app stores the highest `state_seq` seen for each vault,
  and the highest `header_seq` seen for each release of the vault (each
  release has its own header, §11.10.2), and sends them as `min_state_seq`
  and `min_header_seq` (the value for the release the request is sealed
  to) in every unlock (§11.4, §11.10.6).
- The enclave refuses to unlock with `state_rollback` if any of these holds:
  - `state.state_seq < header.state_seq`;
  - `state.state_seq < min_state_seq`;
  - `header.header_seq < min_header_seq`.

  The refusal is a sealed result of uniform size, so the API cannot tell it
  apart from other outcomes.

**Residual risks:**

- An app that has never unlocked since the newer state was written cannot
  detect a rollback until it does.
- A consistent rollback of both objects, served to a device that has never
  seen the newer values, goes undetected.
- An attacker holding a registered, attested device can omit the minimums.

The split-brain guard (§12.3) separately catches stale writers.

Manifest by hash (0.10.0, §11.5) changes none of this: the manifest
`serial` recorded in the sealed header still bounds the manifests an
enclave accepts, and the app still refuses a manifest with a lower serial
than it has seen.

### 13.3 Parent and host

The parent can delay, drop, reorder or replay what it forwards. Replays are
absorbed (§11.6) and rollbacks are bounded (§13.2). It can misreport the
advisory lifecycle and lease values, but those affect only routing and
availability.

Inside the enclave, a flaw in one vault's process (a feature handler, a
parser) reaches only that vault: its secrets live in its own process, and
it can read and write only its own objects and use only its own relay key
(§12.4).

### 13.4 Downgrade protection

- The suite appears in every header and AAD, in every HPKE `info`, and in
  every KDF and signature label.
- Records pin the highest suite they have negotiated. Lower suites are then
  rejected, and suite 1 is never accepted.
- `sig_R` covers `th`, which includes the initiator's `suites` list, so
  stripping suites from that list is detected.

### 13.5 Key compromise and VettID's residual powers

| Compromised | Impact | Recovery |
|---|---|---|
| Vault relay key | Collect, ack or delete the vault's mailbox (DoS); deposit as the vault; mint tokens. No plaintext, and no forged content. | Rotate (§3.4) |
| Device relay key | Deposit as the device. Its content remains unforgeable. | Unlink and re-pair |
| Reconnect token | Nothing without the holder's relay key (sender-bound), and even then only a 4-message quota of `hs.init`s that must be signed by the stored `ik` | Denylist its `jti` (removal does, §7.4) |
| A remote invitation link, held or substituted in transit (0.10.3) | Completing a handshake: a pending request on the inviter's side and a request token for 8 small deposits that are dropped until approval (§6.4, §7.1). A party in the middle that substitutes the link makes the two members' codes match with probability about 10^-6 per attempt, one attempt per invitation or accept (§6.3). Since 0.10.5 it also learns when the member declines (`connection.declined`, §6.4): that the request was seen and refused, and roughly when; nothing else. A party in the middle can make either half look declined, which it could already do by staying silent | The members compare the SAS and decline; the request expires; `connection.invite.cancel` |
| Session epoch key | Read and forge messages in that epoch and direction. Vault-to-vault epochs last at most 24 h. | Next rekey |
| Vault `ik` or `kem` | Impersonate the vault in new handshakes and read new `hs.init`s | Credential rotation, `identity.rotate`, rekey |
| ETK | PINs in requests sealed to it (≤ 25 h). Requires breaking the enclave. | Enclave restart |
| Owner app (the vault's one app) | Whatever its role allows, including unlock attempts if the PIN is known; with the PIN and the password, a transfer to another phone (§6.7.1). Since 0.13.0 only until the owner check's deadline (at most 24 h after the member's last check): then nothing but the check, which needs the PIN and the password, under both backoffs, with a lock after 10 consecutive failures (§3.6) | Recovery (§11.11), which replaces it |
| An unlocked app, or a desktop in an access session, in someone else's hands, without the PIN and the password (0.13.0) | What its role allows until the deadline; then nothing: the vault holds, the app hides its cached content, desktops' sessions are suspended; ten wrong guesses lock the vault, which then needs the PIN to open (§3.6) | Recovery; a shorter `owner_check.interval_seconds` |
| A thief who holds the app and knows both the PIN and the password | Everything the app can do: the check passes, and the hold changes nothing (§13.8) | Recovery (§11.11), which replaces the app; change the PIN and the password |
| The vault's desktops and agents, or an unlocked app, in someone else's hands while the member has turned the hold off (§3.6.7) | The app: nothing past the deadline but the check, as with the hold on. Desktops and agents: what their sessions and grants allow, until the hold comes back on (`hold_off_until` or the member), the vault locks or a check succeeds. Nobody can turn the hold off, or keep it off, without the PIN and the password; ten failed checks still lock the vault | Turn the hold on (no check needed); `device.session.end`, `device.unlink`, `leash.grant.revoke`; `vault.lock` through the account site; recovery |
| Desktop | Within an access session, what desktops may send; step-up types (secret items' values, item and tag changes, profile, settings, share rules and decisions, invitations, removals, grant decisions, action configurations, introductions, location shares, the location log, the presence policy) only with an app's approval; never critical items or wallet spends; nothing after the session ends (§6.8) | `device.session.end`; unlink |
| Agent | Paused while the vault is held (§3.6.3): refused in the vault, and its delegations rejected by relying parties within `status_ttl` + 60 s. Otherwise, within its access session, only what its LEASH grants cover: through `ask` grants nothing without an app's approval of each request (at most 20 referrals an hour), through `auto` grants up to their rate limits; LEASH operations only on the `data` and `secret` items its share rules include, never critical ones; never app-only types, invitations, credential, device or grant management. Refused requests are throttled and repeated ones suspend it; its activity is summarised in the audit log, so it cannot push older entries out (§10.11) | `leash.grant.revoke`, `device.session.end`, `device.unlink`; suspension is automatic |
| A LEASH delegation (every grant) | A claim, to relying parties that trust the member's credential key, that the agent holds that scope, until the grant's `expires_at` if any; the vault never relies on it. A relying party that requires a status statement accepts a revoked delegation for at most its `status_ttl` (≤ 1 h, default 15 min) plus 60 s of skew (LEASH §3.5's bound); one that does not can be shown it until `exp` (§10.11) | `leash.grant.revoke` (no new statements); a shorter `status_ttl` |
| The vault's `ik` as status issuer | Signing statements that keep a revoked or suspended agent's delegations "valid" for relying parties; it grants nothing in the vault itself. An approved release does only what §10.11 says (§2.1) | Rotate the `ik` (§3.4): the chain moves the issuer; revoke the grants |
| A status statement | Nothing beyond its `not_after`: it names one delegation by hash and is useless without it and the agent's key | — |
| Issuing grants | Only with the member present: an app within the credential's unlock window, since the credential key signs each grant (§10.11) | — |
| A connection holding a grant | The granted item's current values (the granted fields), at most `uses` times, until expiry or revocation; no other item or field. Values are sealed to the fetching device, so the connection's vault never holds them (§10.12) | `grant.revoke`; removing or blocking the connection |
| A connection named in a share rule | The `data` and `secret` items the rule includes: in `ask` mode only those the member approved, in `auto` mode every item that gains a matching tag; at most usable, never readable, critical items. Its own catalog only; never the member's tags, rules or other connections' catalogs. Removing the tag, deleting the rule or its expiry ends future fetches at once (§10.12) | `item.tag`, `share.rule.delete`, `grant.revoke`; removing the connection |
| A tag change | In `auto` rules, sharing the re-tagged item without a prompt: apps preview the effect (`dry_run`), and desktops need an app's approval for tag changes (§6.8, §10.8) | Remove the tag (the grant is revoked at once) |
| A connection asking to use a critical item | Nothing without the member's password for each use, bound to that request and payload; then one signature (`sign` over the payload as shown to the member, or the domain-separated `auth`), never the key (§10.13) | Deny; remove the tag or the rule that makes it usable |
| A connection offered actions | Only the built-in actions offered to it, under their modes: one-use, 10-minute grants of the items the member configured (values sealed to its device), its own entries of the audit log; nothing at all of a critical action without the member's app in the unlock window; at most 60 invocations an hour and 8 pending (§10.14) | `action.configure` (mode `default-deny`), `grant.revoke`, removing the connection |
| A member's vault code for actions | Actions run natively in the vault's process (§12.4) from a catalog fixed in the release; no third-party or downloaded code (§10.14) | A release update (§11.10) |
| A connection, about the member's other connections | Nothing: no type lists them to a connection or lets it ask for an introduction; it learns of another connection only when the member introduces them, only what the member chose to show, and connects only if both accept and then approve each other with the SAS (§10.15) | Decline; `block.add` |
| The introducer | Each party's answer; it relays the invitation, so it could substitute a party it is connected to, but the parties still approve each other with the SAS, which it cannot steer (about 10^-6 per attempt, §6.3), and the invitation accepts only the `ik` B named (§10.15) | Compare the SAS out of band; decline |
| A connection the member shares location with | Positions at the share's precision (`exact` about 1 m; `approximate` a 0.01° cell; `city` a 0.1° cell), at most one per 0.9 × the interval, until the share's expiry (at most 7 days) or stop; a trail only if the member allowed it; whatever its own member saw. Cells are fixed: crossing a boundary reveals being near it (§10.16) | `location.share.stop`; removing the connection |
| The sending vault's state | No position: positions are forwarded from memory, never stored or queued (§8.5, §10.16) | — |
| A connection asking for location or presence | One location request per 10 minutes (a feed item); one presence answer per minute, only if the policy shares with it; a refusal is silence, like a locked vault (§9.2, §10.17) | `presence.set{except}`, `share: none`, `invisible`; `block.add` |
| Presence | Whether the member's vault is unlocked, the member's chosen `state` and `last_active` to 5 minutes, to connections the policy allows, on demand only (§10.17) | `presence.set` |
| An app's session (wallet) | Inspection, addresses and history; no spend: spending needs the password (UTK-sealed, bound to the wallet and the PSBT's hash) and the unlock window (§10.18) | Unlink the device; change the password |
| The member's chain source (the app's) | It learns the wallet's addresses and spends. Lying, it can withhold coins (a failed spend), offer spent coins (a transaction that never confirms) or raise the fee to the 1,000 sat/vB cap; it cannot misstate input amounts (previous transactions are required and their txids checked), redirect change (re-derived by the vault) or alter a payment request's payee or amount (checked exactly). The app shows the vault's own summary before the member approves (§10.18) | Use another chain source (own node, Electrum server) |
| A connection with `wallet.request-address` | A receive address of the configured wallet, the same one until it is used; addresses link payments to that connection only (§10.14, §10.18) | `action.configure` (mode `default-deny`) |
| A connection with `wallet.request-payment` | A request the member sees and approves with the password per payment; nothing without the member's app in the unlock window (§10.14, §10.18) | Deny; `default-deny` |
| The member's location log | Only the member's own devices see it (desktops with an app's approval each time); it leaves the vault only as a snapshot the member sends through one of their shares, at that share's precision; at most `retention_days` (≤ 365) and 5,000 positions, thinned with age; off by default, deleted when turned off; no export (§10.16) | `location.history.delete`; turn it off |
| Decrypted vault state (location log) | Where the member has been, within the log's retention and thinning, if the member turned it on (§10.16) | Turn the log off (deletes it) |
| Decrypted vault state (wallet) | Each wallet's account keys: every address, past and future, and so the wallet's balance and history on chain; never the phrase or keys, which are a critical item (§10.18) | Move the funds to a new wallet |
| The Bitcoin libraries (btcd) | Parsing PSBTs from the member's own app and deriving keys, in the vault's process only (never the supervisor), so a flaw reaches only that vault (§12.4, §13.3) | A release update |
| A call's media key `k_call` | That call's media; it exists only on the two devices of the call, whose key-exchange shares are signed by the devices and vouched for by their vaults (§10.10) | Hang up |
| PIN alone | Nothing without a registered, attested app | `pin.change` |
| An app's copy of the Protean Credential | Nothing without the current CEK, which only the vault holds and which rotates at every use; password guesses only online, through the holder's session with a UTK, under the backoff (§3.5.8). Presenting it while it is not the current blob is a clone: refused, the app alerted, the member emailed, credential operations frozen until a forced rotation (§3.5.9) | Any use of the credential (a new CEK; the old blob is dead); the forced rotation |
| A clone presented through the holder's session (a stolen session and an old copy, or a restored phone backup) | Nothing: refused with `credential_frozen`, never opened; the alarm freezes credential operations (messaging continues) until the holder confirms and rotates (§3.5.9) | `credential.alarm.confirm`, then `credential.rotate`; change the password and PIN if it was not the member |
| A thief with the app's session and the PIN, without the password | No deletion: the holder's `vault.delete` needs the password too (§12.5) | — |
| The member's account, email and PIN, for 24 h unnoticed, with the backup off | No recovery and nothing of the vault (0.16.0: the request is refused, §11.11.1, §11.11.7). Through a start-over (§11.11.9), the vault's deletion: availability only, never its contents | Cancel the start-over within the 24 h (portal, email link, app) |
| VettID (operator) | Deleting a vault (the host's `delete`, an operator power it had anyway, §13.5 list), never reading it; the member is emailed | — |
| A byte-identical copy of the current blob, used before the member's next use | Undetectable at that moment; a use still needs the password and the holder's session. The member's next use then presents a stale copy and raises the alarm (§3.5.9). The daily owner check is such a use, so the window is at most one interval (§3.6.6) | The alarm and the forced rotation |
| A dishonest host, about clone alarms | Suppressing or delaying the member's email; not the vault's alert to the app, its freeze or its audit entry (§11.5) | — |
| A transfer (§6.7.1) | Moving the app needs the holder's session, the PIN and the password; the new phone must pass device attestation; the old app is removed and its copy dead | Recovery, if the member lost the phone to it |
| A recovery with `credential.backup` off | Does not exist (0.16.0, owner decisions of 2026-10-06): the API and the enclave refuse it, no recovering device is created, and nothing of the vault (items, messages, connections, profile, audit log, feed) is released. Before 0.16.0 it gave a new credential over the rest of the vault, or its deletion, on the account and the PIN alone (§11.11.5 step 4) | — |
| A start-over deletion (§11.11.9) requested by someone with the member's account session | The vault's deletion after 24 h unnoticed: availability only; it opens nothing and returns nothing. The member is emailed at the request | Cancel from the portal, the email link or the app within the 24 h |
| A GrapheneOS device | Treated as any attested app: accepted only with a locked bootloader and a verified boot key pinned in the release (§11.7) | A release update removes a key |
| A History export file the member saved (0.22.0) | Activity metadata only: the exported audit entries with the names of connections, devices and items as the app showed them, their times, kinds, references and chain fields; never values, secrets, message text, credential material or the email. Unencrypted, wherever the member saved it; VettID and the vault cannot reach or delete it. Making one needs the holder's app and the PIN, and is audited `audit.exported` (§10.9) | Delete the file |
| An app's session keys | No password or secret value (UTK and reply-key sealing), no replay (single-use UTKs), no redirected payloads (§3.5.4) | Unlink the device |
| Credential password alone | Nothing without the blob and a paired app | `credential.password.change` |
| Member's email and account session (24 h, unnoticed) | A recovery (backup on only): one new attested app that replaces the member's app. Still needs the PIN and the password, online, under both backoffs (§11.11.2); with the backup off, nothing: no recovery (§11.11.1), only a start-over deletion after another 24 h (§11.11.9) | Cancel; the app sees `recovery_pending` and `vault.locking{recovery}`, or `deletion` in `GET /api/vault/status` |
| VettID's API tables | Nothing: the recovery code is stored only sealed to the member's browser, and the enclave enforces the 24 h (§11.11.2); setup codes only as MACs under a key outside the tables, app keys only as public keys (§11.12) | — |
| A setup code (stolen, shoulder-surfed or phished; 0.15.0) | Before the member uses it, within its 5 minutes (the typed code also needs the member's email): an **empty** vault enrolled into the member's account, with the thief's phone and PIN, whose account snapshot shows the thief the masked email and membership (§11.13). Never an existing vault: a confirmed vault is never replaced (§11.3) | Single use; one live code; the member's own redeem then fails and the portal shows the code used; the member is emailed at every redemption; support deletes the vault (the host `delete`) |
| Guessing setup codes | The QR secret: nothing (128 bits). A typed code: only one named member's, at most 800 guesses per issuance from all sources, 9.4 × 10^-10 per issuance (§11.12.1; ENROLLMENT-CODES §3.3). Flooding one member's typed entry blocks only that issuance's typed form for at most 5 minutes; the QR and every other member are unaffected (no global limit) | The limits of §11.8; the member is emailed and operations alerted at the ceiling |
| A code of someone else's account (reverse phishing) | The member's new vault belongs to that account, whose holder could later request a recovery; it still needs the member's PIN and password after 24 h in which the member's app sees the recovery | The app shows `email_hint` before enrolling and in its account view (§11.12.1, §11.13) |
| An app key (0.15.0) | Member API calls as the vault's app: unlock attempts still need the unlock key, the device assertion and the PIN; lock and status. Hardware-held: in practice, the phone | Transfer or recovery replaces it (§11.12.2) |
| A member session (0.15.0) | No longer any vault request but `status`, `lock` and the recovery routes; issuing a setup code (useful only to an account without a confirmed vault) | Sign out; the redemption email |
| Decrypted vault state (DEK) | Everything in it (`data` and `secret` items included), plus offline guessing of the credential password against the current CEK and the latest blob (§3.5.8); critical items' values stay encrypted under item keys that only the credential, sealed under the password, holds (§10.7) | Rotate the relay key and the credential; change the password |
| A critical item key (from an old blob with its CEK and the password, or from a compromised release during an operation) | That item's ciphertext of that generation only; nothing after the item's next use, which re-keys it (§10.7) | Use the item, or `credential.rotate` (re-keys every item) |
| An old release, after members moved away | Vaults still sealed to it. A moved vault only if the host serves it a stale header and state **and** an app sends it the PIN; apps never send a PIN to an older release than they last unlocked into (§11.10.6). Residual: an owner device that never learned of the move. | Members move forward; the app warns about `deprecated` and `retired` releases; the release ends at its `ends_at` (§11.10.5) |
| Manifest key | Listing a release as `active`, or marking one `removed` (routing only: the API stops routing it). A vault still moves only with the member's approval, and only to a sealing key in the pinned namespace. A manifest the host supplies must match the hash in the sealed request (§11.5). | Rotate the key in a release; apps pin two keys |
| Sealing-key policy (VettID's AWS account) | A key whose policy let anything other than its release decrypt, or could be changed later, would expose the pepper and allow offline PIN guessing against stored state. The enclave refuses to seal to such a key: before sealing it reads the policy, metadata and grants from KMS over TLS it terminates and checks them (§11.10.7). | Nothing to recover: the check runs before any seal, and a passing policy can never change; only the pinned retirement principal can delete the key, after notice (below) |
| Retirement principal (0.10.0) | Scheduling the deletion of a release key, always with the pinned window: 30 days later every vault still sealed to that release is permanently unopenable. Availability only, never confidentiality: it cannot read, open, move or re-key anything, change the policy or add grants. | Cancel the deletion within the 30 days (`CancelKeyDeletion`, `EnableKey`); a CloudTrail alarm on every `ScheduleKeyDeletion` (VAULT-RELEASES §8.7) |

As operator of the host, queues and API, VettID **can**:

- deny service;
- lock vaults;
- delete stored state;
- observe the metadata in §2.2;
- publish new releases and mark old ones `deprecated` or `retired`;
- end a release after notice (`removed`, VAULT-RELEASES §3.5): its
  instances stop and its sealing key is deleted after the pinned window,
  after which vaults still sealed to it are lost.

It **cannot**:

- unlock a vault;
- read or forge a vault's messages;
- act on a vault's mailbox without the PIN;
- move a vault to another release, or **force an update**: only the
  member's approval at unlock moves a vault (§11.10). A vault therefore
  stays on its release, including any unfixed vulnerability, until the
  member approves an update; the app makes that visible. A member who
  never moves loses access when the release ends (its `ends_at`, after at
  least 90 days' notice): that is a loss of availability, never of
  confidentiality.

These "cannot" statements do not rest on VettID's word about its key
policies: the enclave verifies each sealing key's policy before sealing to
it (§11.10.7). They rest on AWS KMS and Nitro attestation behaving as
documented.

### 13.6 Implementation requirements

- **Classification.** Inbound traffic is classified only by `sender`, by
  `recipient_kid`, and by which session decrypts it. Classification MUST NOT
  depend on payload shape or `type`.
- **Parsers.** Envelope and inner parsers MUST be fuzzed.
- **Comparisons.** Tag and key comparisons MUST be constant-time.
- **Dev mode.** Dev-mode attestation and sealing MUST be excluded at compile
  time.
- **Logging.** Keys, PINs, tokens, signatures, attestation tokens and
  plaintext MUST NOT appear in logs, metrics or errors.
- **Process isolation.** Each unlocked vault MUST run in its own process,
  and the supervisor MUST NOT hold a vault's DEK, pepper or keys (§12.4).
  The channel between them MUST be parsed strictly and fuzzed.

### 13.7 A vault reports only to its owner

(Owner decision, 2026-10-03: "real vaults should only ever report to
their owner. Period.")

- A vault MUST send its credential state, alarms, freezes, transfers,
  recoveries, device list, settings, audit log, feed and vault status
  only to its owner's devices (§9.1), each within its role (§6.8).
- To its host it reports only the content-free lifecycle events and
  alarms of §11.5 (`enrolled`, `unlocked`, `locked`, `moved`, `deleted`,
  `alarm.credential_clone`) and, since 0.15.0, its app's public app key
  with its sequence number (on `enrolled`, `unlocked` and `locked`, and
  the event `app_key`, §11.12.2). That key exists for this vault's
  member API requests only and identifies no device; its changes tell
  the host that a transfer or recovery completed, which the next unlock
  would show anyway. Since 0.16.0 (owner decision of 2026-10-06, §15
  item 24) it also reports one bit, `credential_backup`: whether it
  keeps a backup copy of its credential, so whether it can be recovered
  (§11.5). It carries no version, time, device or content, and exists so
  that the member API can refuse a recovery request upfront with a
  clear answer instead of locking the vault and refusing a day later.
  The enclave's refusal of a recovery request adds the clear slot code
  `recovery_unavailable` (§11.11.2), which says the same. Since 0.18.0
  (owner decisions of 2026-10-07, §15 item 26) it also reports the
  member's approved request to change the account's first and last name
  (`account_name`, §10.8, §11.5): content, but the member's own
  instruction to VettID about data VettID holds, sent only after the PIN
  and the credential password. The owner check (§3.6) adds none: the hold is not
  reported, and the lock after ten failed checks is an ordinary
  `locked`.
- From its host it accepts, besides queue operations, only the account
  snapshot (§11.13, 0.15.0), which it shows to its owner's app and
  desktops and to no one else, except the account's first and last name,
  which it sends every connection in its shared profile's core (§10.8;
  0.18.0, owner decision of 2026-10-07). The snapshot's full `email`
  (0.20.0) goes to the app and desktops only, never to a connection, an
  agent or back to the host (§11.13).
- To a connection it sends only what the member's features share with
  that connection by the member's own decisions: messages, calls, the
  shared profile (whose core, the account names and `ik`, goes to every
  connection by the owner decision of 2026-10-07, §10.8), granted and
  shared items, action results,
  introductions, location and presence under their policies, the
  credential key's public rotation statements and the signatures the
  member approved (§10.4, §10.13). A refused or failed credential
  operation (wrong password, backoff, an alarm or freeze) leaves a
  connection's request pending; it never tells the connection why. The
  same holds for the hold (§3.6.3): what waits for the member stays
  pending, calls time out and pings go unanswered, as with an absent
  member.
- It never answers a principal that is not its owner's device, its
  connection or its host; a holderless vault (§3.5.9) adopts no one.

### 13.8 What the owner check protects, and what it does not

The daily owner check (§3.6) bounds how long an owner device can act
without the member: the app always (it is gated past the deadline,
§3.6.3), desktops and agents while the hold is on (the default;
§3.6.7).

**It protects against:**

- **an unlocked phone, or a desktop in an access session, in someone
  else's hands.** Their use of the vault ends at the deadline, at most
  24 h (or the member's shorter interval) after the member's last check.
  Past it they need the PIN and the password together; each wrong entry
  counts in its backoff, and ten consecutive failures lock the vault,
  which then opens only with the PIN. The app's own biometric lock
  (ANDROID-PLAN D6) is local and the vault cannot see it; the check is
  what the vault can see;
- **an absent member's agents.** Agents stop at the deadline: in the
  vault at once, for relying parties within `status_ttl` + 60 s (§10.11).
  A member who stops checking, for any reason, stops their delegations
  within a day, while the hold is on;
- **a copied credential blob.** Every check rotates the CEK, so a copy
  goes stale within one interval, and presenting it raises the clone
  alarm (§3.5.9, §3.6.6);
- **a stolen app session.** Someone with the session keys but not the
  PIN and the password can no longer act past the deadline: the check's
  secrets are UTK-sealed (§3.5.4), so the session alone cannot pass it.

**It does not protect against:**

- **desktops and agents past the deadline, while the member has turned
  the hold off** (§3.6.7). A thief with the unlocked phone still cannot
  use the app past the deadline: the vault gates the app whatever the
  switch says. But desktops and agents keep their access (sessions,
  grants, status statements) until the hold is turned back on (by the
  member or at `hold_off_until`), the vault locks (any §12.3 trigger,
  `vault.lock` from the account site, or ten failed checks) or a check
  succeeds. Nobody can turn the hold off, or extend `hold_off_until`,
  without the PIN and the password, since only a successful check can;
  turning it on needs no check, so it only ever moves toward protection.
  Members who turn it off should set an end date; the app warns and
  shows a persistent indicator (§3.6.5);

- **a thief who holds the app and knows both the PIN and the password.**
  The check is knowledge-based; they pass it every day. Recovery
  (§11.11) is the remedy, as before;
- **anything within the interval.** Until the deadline nothing changes;
  a shorter interval narrows the window at the cost of more checks;
- **an attacker inside the vault.** The hold keeps the DEK and the keys
  in memory (it is not a lock, §12.1). Whoever could read an unlocked
  vault's memory can read a held one's; only a lock zeroizes. The
  ten-failure lock adds that zeroization against guessing;
- **the app's local cache, if the app ignores §3.6.5.** The vault
  enforces the hold for what it serves; what the phone already holds is
  protected by the app hiding it and by the app's own encryption;
- **standing authorizations toward connections.** Issued grants, `auto`
  share rules and `auto` actions keep working while held (§3.6.3): they
  are the member's own earlier decisions, which the member revokes in the
  usual ways;
- **availability.** A held vault can still be locked by the host or by
  memory pressure (§12.3), like any vault that nobody is using; its
  peers' messages then wait in the mailbox up to the relay TTL.

**What VettID can and cannot do with it.** The host cannot start, end
or move a hold: the record and the clock are inside DEK state and the
enclave. Serving an older state (§13.2) can only bring an earlier
deadline, never a later one, so a rollback fails toward the hold. It
could bring a lower `failures` count and password backoff, which is the
rollback residual of §13.2 (the apps' `min_state_seq` bounds it, and the
PIN backoff is in the header, under `min_header_seq`). A dishonest host
can still lock the vault (§13.5), which it could do anyway.

### 13.9 The canary manifest

A canary manifest (§11.10.1, 0.14.0) is verified under the same pinned
keys as the published manifest, so it gives VettID no power it does not
already have: anything VettID could list there, it could also publish.
The serial rule stops it from taking a phone backwards. A phone uses it
only after its member confirmed it, and only until the published
manifest reaches its serial.

**Accepted risk** (owner decision, 2026-10-06). Anyone who obtains an
unpublished canary manifest can load it into a VettID app and approve a
move of their own vault into the canary release (§11.10.3). The member
API routes a canary release only for flagged test members. For anyone
else, the moved vault is unreachable (`410 release_unavailable`) until
VettID publishes the release, and permanently if the canary fails and
the release is never published. Nobody else's vault is affected: a move
still needs the vault's own member, with their PIN and their approval.
The only mitigation is that the document never leaves the owner and the
canary tester. It reaches the test phone over a private channel and is
never served from a public URL (RUNBOOK "Canary manifest on the test
phone"). A canary-only app build would close this risk: a build signed
with its own key, and the only build that accepts canary manifests. That
is a possible later hardening, tied to the signing of the canary
phone's build (W10-READINESS B8), and is not done now.

## 14. Push compatibility (deferred)

An app will send `push.register{platform, push_token, environment}` over its
session. The vault keeps the wake key in DEK state and stores the `wake_ref`
in the device record; `device.unlink` deletes it.

After depositing a user-visible message into an app's mailbox, an unlocked
vault triggers `POST /v1/wake/{wake_ref}` with a constant per-device
`collapse_key`.

A locked vault triggers no wakes. A "vault locked, messages waiting" prompt
would need a wake path that does not depend on the DEK. That is a separate
future decision.

## 15. Open questions and follow-ups

The owner's v0.1 review resolved every design question that v0.1 left open.
Follow-ups:

1. **Vectors.** The §16 vectors are generated (vettid-vault). Still open:
   reproduce them with CryptoKit and BouncyCastle to pin MLKEM768X25519
   interoperability (codepoint `0x647a`, `ek` 1,216 bytes, `enc` 1,120
   bytes).
2. **Schemas.** Lifecycle, sessions, devices and access sessions,
   connections, messaging, the credential, items, tags, profile, settings,
   audit, feed, calls, LEASH, grants, critical-secret use and shared
   actions are in §10.1–§10.14, and location, presence and the wallet
   (0.8.0) in §10.16–§10.18. Still open: the `sync.since` cursor, and the crash-safe write order of
   `pin.change` (with its implementation).
3. **Push.** Specify the push-gateway integration (§14) when that service is
   scheduled.
4. **Desktop unlock.** Revisit if a desktop attestation mechanism becomes
   available.
5. **Release updates.** Implementation in V3: generate the §16 release
   vectors in vettid-vault, the KMS policy shapes in VAULT-PLAN, and an
   app UX review of the approval screen.
6. **ICE issuer secret.** How the coturn shared secret (or a managed
   provider's credentials) reaches the enclave (CALLING-SERVICE §5, §10).
7. **LEASH HTTP action.** LEASH's HTTP action (the vault makes a
   request with an injected secret) needs egress from the enclave beyond
   the relay and KMS allowlist, and waits for a decision on enclave
   egress; until then pattern 2 is `item.use` (HMAC-SHA-256) only
   (§10.11). Revocation status, formerly listed here, is resolved: the
   stapled status statement of §10.11 (since 0.6.0; LEASH §3.5's format
   since 0.12.0, item 21) needs no public status route.
8. **Files in items.** The `file` field kind (§10.7) is reserved until
   blob storage and its size policy are decided (VAULT-ITEMS owner
   decision 4).
9. **Critical item capacity.** Resolved (owner decision of 2026-10-03):
   envelope encryption (§10.7) keeps only item keys in the credential,
   about 90 bytes per item, so 1,000 critical items fit within §3.5.2's
   131,072 bytes and every credential operation still carries the whole
   blob within one message (§5.5).
10. **List sizes.** `grant.list`, `critical-secret-use.list` and
    `action.list` are not paged. With share rules a vault can hold 1,000
    given grants, so `grant.list` can outgrow one message (§5.5); page it
    (`after`, `limit`, `next`, as `item.list`) in its next revision.
11. **Wallet scope.** Multisig and script-path taproot spends, RBF fee
    bumps, and a vault-side chain source (an allowlisted chain API in the
    enclave's egress, with its privacy and trust costs, §10.18) are not in
    0.8.0; the member's app is the chain source (owner decision). The fee
    cap (1,000 sat/vB) is fixed per release.
12. **Relay mailbox deletion.** Resolved (owner decision of 2026-10-04;
    0.9.1): RELAY-PROTOCOL 0.5.0 adds the owner-signed `DELETE
    /v1/mailbox` (§6.10), and a vault deletion uses it in step 2 (§12.5).
    Left: a vault the host erases while it is locked cannot delete its
    mailbox (there is no relay key outside the PIN-protected state, §1.1
    decision 3); its tokens expire on their own.
13. **OWNER DECISIONS of 0.9.0** (each with the recommendation the text
    follows; to confirm at review):
    1. Recovery with the backup off restores access only: reset the
       credential (critical items destroyed) or delete the vault
       (§11.11.5). Decided 2026-10-03. **Superseded** by item 24
       (0.16.0): there is no recovery with the backup off.
    2. "That was me" and "not me" both force the rotation (§3.5.9).
       Recommended: yes.
    3. The clone email goes through a content-free host alarm that the
       member API turns into an email (§3.5.9, §11.5). Recommended: yes;
       the vault has no email egress.
    4. A blob with the current version but other bytes, or a version above
       the current one, is a clone (§3.5.9). Recommended: yes.
    5. A transfer does not re-check the old app's device attestation
       (§6.7.1). Recommended: no re-check.
    6. `SelfSigned` boot is accepted for GrapheneOS only (§11.7).
       Recommended: GrapheneOS only, others on request.
    7. At most 4 alarm emails per vault per day (MEMBER-API).
       Recommended: 4.
    (Items 2–7 were confirmed by the owner on 2026-10-03.)
    8. `vault.delete` from a recovering app with the backup off, or from
       the enrolling app before a credential exists, needs the PIN only
       (§12.5). Recommended: yes: there is no password to check, and the
       recovery's 24 h and the account (or, before a credential, the
       enrollment minutes earlier) gate it; deletion exposes nothing.
       **Superseded in part** by item 24 (0.16.0): a recovering app no
       longer deletes; the enrolling app's case stands.
14. **OWNER DECISIONS of 0.10.0.** The release model itself (VAULT-RELEASES
    R1–R4, O1–O10) was decided on 2026-10-04. These details are new in
    this text; each is written as recommended, to confirm at review:
    1. **OWNER DECISION:** a retirement statement contains only the three
       retirement actions, never a read-only action (§11.10.7).
       Recommended: yes; the read-only actions go in the read-only
       statement, and the stricter shape is simpler to check.
    2. **OWNER DECISION:** `ends_at` is validated wherever it appears but
       not restricted by status in parsers (§11.10.1). Recommended: yes;
       release 1's parser must not refuse a later manifest that keeps the
       date on a `removed` entry (C1, forward compatibility).
    3. **OWNER DECISION:** the enclave does not refuse an unlock because
       its own entry is `removed` (§11.10.4), so a rescue needs no new
       manifest; availability is enforced by routing (`410`) and the key
       state. Recommended: yes.
    4. **OWNER DECISION:** a manifest document the host cannot find is
       answered by the enclave's sealed `manifest` result, not by a new
       host code (§11.5). Recommended: yes; it keeps the outcome
       uniform and the app's handling (refetch, retry once) unchanged.
    5. **OWNER DECISION:** the hash in the clear (`manifest_sha256` in the
       enroll and unlock bodies and the queue message) names a public
       document and reveals only which manifest the app holds.
       Recommended: acceptable.
15. **Member API.** The vault routes' `manifest_sha256` field, its copy
    into the queue message and `410 release_unavailable` for a `removed`
    release are specified here and in MEMBER-API; the member-API code
    follows in VAULT-RELEASES W8.
16. **Connection requests (0.10.2).** Follow-ups: vettid-vault (the SAS
    in the accept response, the accepter's approval gating `hs.fin`,
    `exists`, the `from.ik` check in the inviter's drop, the 8-day
    outgoing expiry, `connection.request.list` and `.outgoing`, the
    `connection.request` sync kind, `pending_id` in `added`,
    `critical-secret-use.get`) and the apps (the `vettid:` scheme, the
    App Link host relay.vettid.org); vettid-relay serves `/connect` and
    `/.well-known/assetlinks.json` (and later
    `apple-app-site-association`), RELAY-PROTOCOL to describe them (§6.4). These land in a staging release after
    S1; nothing in production depends on the 0.10.1 shapes.
    **OWNER DECISIONS of 0.10.2** (each written as recommended, to
    confirm at review):
    1. The accepter's member approves too, always, also when the inviter
       auto-approves in person; the vault sends `hs.fin` only then.
       Recommended: yes; the SAS protects only when both compare. (Since
       0.10.3 `hs.fin` is sent at once and the approval travels in
       `connection.approved`; item 17.)
    2. A decline is not sent to the peer; the peer's request ends by
       expiry (8 days for the accepter). Recommended: yes, as other
       refusals (§9.2); anyone could have accepted a remote link.
       **Superseded by 0.10.5 (owner, 2026-10-05):** a decline is sent
       (`connection.declined`, §6.4, item 18). The owner's reason: "if
       an invite is declined the other party should be notified. random
       people won't be able to ask to connect, so we don't need to hide
       responses."
    3. `exists` spends the link and offers no override; a member whose
       connection is broken removes it and asks for a new invitation.
       Recommended: yes; an override (`replace`, keeping the opened
       bundle until `exp`) can come later if this proves common.
    4. The invitation URL is `<relay>/connect#<link>` on the
       invitation's own relay, with the payload in the fragment, built by
       the apps; QR codes keep the compact JSON. Owner decision
       2026-10-04: the relay hosts it, so home appliances and
       self-hosted relays work without vettid.org.
    5. `critical-secret-use.get` rather than payloads inline in
       `critical-secret-use.list`. Recommended: yes; 8 pending requests
       per connection of up to 4,096 bytes each would let the list
       outgrow one message (§5.5).
17. **SAS strength.** Before 0.10.3, `sas` (§6.3) depended only on
    `hs.init`, which the initiator alone chooses. A party that substitutes a remote invitation
    link (a man in the middle between two members) receives the victim's
    `hs.init`, learns its SAS, and can then try fresh `hs.init`s to the
    real inviter until one yields the same six digits (about 10^6
    handshake constructions, minutes of CPU), so the two codes the
    members compare match. Comparing the SAS therefore did not reliably
    detect a substituted remote link.
    **Resolved in 0.10.3** by a ZRTP-style commitment (§6.3): `hs.init`
    carries `sas_commit` = SHA-256 of the initiator's 32-byte nonce
    `n_I`, `hs.resp` carries the responder's `n_R`, `hs.fin` reveals
    `n_I`, and `sas` is expanded from `prk` over `th`, `n_I` and `n_R`.
    Neither side, and no party in the middle, can steer it: matching
    codes in a substituted link take about 10^-6 per attempt, one
    attempt per invitation or accept. Since the SAS now exists only after
    `hs.fin`, the handshake runs before approval and each approval is a
    `connection.approved` message (§6.4); pairing and transfer follow
    the same order (§6.7, §6.7.1). Rekeys and reconnects have no SAS and
    do not change.
    Follow-ups: vettid-vault (the commitment fields and check, the new
    derivation, `hs.resp` at once and `hs.fin` at once, request tokens
    and their kind, `connection.approved`, activation after both
    approvals, `device.paired{token}`, the transfer completing at the
    approval, `connection.request.list` states, regenerated
    `handshake.json`); vettid-android (the same on the device side, the
    new accept response and `connection.request.outgoing` on the
    accepting device, the vector tests); the desktop later.
    vettid-vault: done (PR #26; what it settled is 0.10.4). Remaining
    there: the compat harness's `TestCompatMoveOnly` starts the previous
    release's parent without `-queue-policy-param`, which every parent
    since vettid-vault #16 requires.
    **OWNER DECISIONS of 0.10.3** (each written as recommended):
    1. A commitment rather than a longer code. Recommended: yes; a
       longer code only raises the attacker's offline work, which stays
       cheap, while the commitment caps every attempt at 10^-6.
    2. The inviting vault (and the vault in a pairing) sends `hs.resp`
       at once, before anyone approves. Recommended: yes; the SAS cannot
       exist earlier, and `hs.resp` carries only a request token.
    3. Request tokens (8 messages / 64 KiB, for the rest of the
       handshake and `connection.approved` only) in the handshake; the
       standing and reconnect tokens move into `connection.approved`
       and `device.paired`. Recommended: yes; otherwise anyone who saw
       a remote link would hold a 20,000-message token before approval.
    4. Each side's approval is sent to the peer (`connection.approved`)
       and a connection is active only with both; a decline is still not
       sent (0.10.2 decision 2). Recommended: yes. (Since 0.10.5 the
       decline is sent too, as `connection.declined`; item 18.)
    5. Pairing and transfer use the same commitment and order, with no
       exception for the in-person QR; a transfer's approval now
       completes it at once (`{}` instead of `{exp}`; `transfer_pending`
       is retired). Recommended: yes; one handshake, and the old app is
       still removed only after the new app finished the handshake.
    6. The SAS stays six digits. Recommended: yes; 10^-6 per attempt,
       with one attempt per invitation or accept, each visible as a
       mismatch to the members.
18. **Declines and rejections sent (0.10.5).** Owner decision of
    2026-10-05, reversing item 16 decision 2: a declined connection
    request is sent to the other party as `connection.declined` (§6.4,
    §7.1, §7.4, §10.4). Owner decision of the same day, "include
    `device.pair.rejected`": the owner's rejection of a pairing or
    transfer is sent to the new device (§6.7, §6.7.1, §10.3).
    Follow-ups: vettid-vault (send it from `connection.decline` and
    `block.add{pending_id}` before the drop, when the epoch and the
    peer's request token exist; accept it on the request token and under
    the request's epoch whether or not the member approved; end the
    request with `peer_declined`, `connection.event{failed, reason:
    "declined"}` on the accepter's side, the audit and feed kind; remove
    an active connection that receives it); vettid-android (show "<name>
    declined your connection request" or "<name> declined the
    connection" on `sync.event{connection.request, peer_declined}`,
    keeping the request's name until then; not again on the `failed`).
    `device.pair.rejected` follow-ups: vettid-vault (in
    `device.pair.reject` and `device.transfer.reject`, once the request
    exists, seal it under the request's epoch and queue it on the new
    device's token before `dropRequest`; nothing for a handshake still
    awaiting `hs.fin`, nor for expiry, `failed`, `alarm` or `replaced`);
    vettid-android (the new app of a transfer, and later the desktop and
    agents: end the wait for `device.paired` on `device.pair.rejected`,
    drop the handshake state, show "Rejected on your phone").
    **Compatibility.** S2, built from vettid-vault main before this
    change, neither sends nor understands it; the code lands in a later
    staging release. Mixed versions behave as 0.10.4: a vault that does
    not send it leaves the peer's request to its expiry, and a 0.10.4
    vault that receives it before activation handles it as any other
    message on a request token or under an unapproved request's epoch:
    before its member's approval it is acked, dropped and audited
    (`drop.unapproved_peer`); after it, it is left **unacked** for an
    activation that never comes, so the relay redelivers it each time
    its relay lease lapses (RELAY-PROTOCOL: at-least-once delivery)
    until the request expires, and it is then dropped with the request
    (0.10.6 wording). It never reaches the unknown-type rule of §5.3, so no
    `unsupported_type` is sent back (the decliner could not open one
    anyway: its epoch is gone). In the after-activation race a 0.10.4
    receiver drops it as a misused request token (§7.1), and its
    connection turns `stale`, as in 0.10.4. `device.pair.rejected` is
    likewise sent only by a release after S2; a new device on older code
    opens it under the handshake's epoch, does not recognise it and keeps
    waiting for `device.paired` until its 10 minutes end, as in 0.10.4.
    It sends no `unsupported_type` back (an event it does not know is
    not answered by the current app; any answer would go on its request
    token, which the vault has denylisted).
    **OWNER DECISIONS of 0.10.5** (approved by the owner as recommended,
    2026-10-05):
    1. The name `connection.declined{}`, empty, on the
       `connection.approved` channel. Recommended: yes; it mirrors
       `connection.approved` and needs no new token or session.
    2. The receiver's devices get `sync.event{connection.request, state:
       "peer_declined"}` in both directions, plus `connection.event
       {failed, reason: "declined"}` on the accepter's side, where every
       other end of an outgoing request already sends `failed`.
       Recommended: yes; one signal for the app's message, and apps that
       know only `failed` still close the request.
    3. A block of a pending request sends `connection.declined` too.
       Recommended: yes; a block is a decline plus a block entry, and the
       peer cannot tell them apart.
    4. A `connection.declined` that reaches an active connection removes
       it, as `connection.removed`. Recommended: yes; the decliner has
       denylisted its tokens, so the connection could only turn `stale`.
    5. An accepter's decline in `waiting`, and an inviter's of an
       `hs.init` without `hs.fin`, send nothing. Recommended: yes; there
       is no token or epoch, and the inviter's member was never shown
       that request.
    6. App copy: the accepter sees "<name> declined your connection
       request", the inviter "<name> declined the connection".
       Recommended: yes; the inviter made no request of its own.
    7. Include `device.pair.rejected` (owner, 2026-10-05). One type for
       pairing and transfer, not a separate `device.transfer.rejected`:
       a transfer is a pairing of role `app` that ends in the same
       `device.paired`, and the device knows what it started. Sent only
       for the owner's rejection after `hs.fin`; not for expiry, a
       commitment mismatch, a clone alarm or a recovery, so an unapproved
       device learns nothing of the vault's state. §13.5 is unchanged:
       the device learns only what its user saw on the phone.
19. **Recovery and lock-state gaps (0.10.6).** Found while building the
    account site's recovery pages (vettid.org PR #114) and checking the
    vault table on staging:
    - The member API's `Recovery` had no `vault_id`, needed for the
      seal's HKDF `info`; it is added (§11.11.7).
    - After a successful register the API kept answering `available`
      with the spent code until `expires_at`. The API cannot open the
      sealed result, so the enclave adds the clear marker
      `recovery_registered` to that answer and the host copies it into
      the slot (§11.5, §11.11.3); the API then records `registered`
      (§11.11.7).
    - The cancel routes answered `200 {}` whether or not they cancelled
      anything; they answer `{cancelled}` (§11.11.7).
    - The QR's parameters were not fixed (§11.11.2).
    - From the Android recovery and transfer work (vettid-android PR
      #56): the recovered app could not know whether to ask for the
      credential password, so the unlock result of a registered app
      carries `credential_backup` (§11.11.5 step 1); a new app of a
      transfer whose `hs.init` was dropped waited for nothing, so it
      stops after 60 s (§6.7.1); and the answer of `GET
      /api/vault/recovery` without a vault was unspecified
      (§11.11.7).
    - **Lock state.** On staging, after the member locked the vault from
      the app (`vault.lock` over the relay), the vault row kept
      `state: unlocked` with no lease. The vault process reports
      `locked` as an asynchronous notification and exits right after;
      the notification can be lost with the process, and the parent,
      seeing only the process stop, removed the lease without touching
      `state`. The rule "a stopped vault is locked" (§11.5) and the
      member API's lease check fix what members see.
    Follow-ups: vettid-vault (the enclave's answer to a successful
    `recovery_register` carries `code: "recovery_registered"` and the
    parent copies it into the slot; the parent's lease release on a
    stopped vault turns `unlocked` into `locked`; the vault process
    delivers its queued notifications before it exits; a recovery vector
    `testdata/vectors/recovery.json` for the seal and the QR payload;
    `credential_backup` in a registered app's unlock result);
    vettid-android (the recovery scanner accepts any QR version and any
    level from M up; it ignores the slot's `recovery_registered`
    marker; it asks for the password only with `credential_backup`
    true; the transfer's 60 s wait for `hs.resp`); vettid.org (the member API and the account site, done with
    this version).
    **OWNER DECISIONS of 0.10.6** (pending):
    1. The enclave states a successful register in the clear
       (`recovery_registered`). Recommended: yes; the host learns
       nothing it would not see at the registered app's unlock, and a
       forged or suppressed marker changes only what the portal shows.
    2. A `registered` recovery stays active until `expires_at` (blocks a
       new request, shown to owner apps, cancellable). Recommended: yes;
       a cancel still removes the registered app's unlock key
       (§11.11.4), and the API cannot see the recovery complete.
    3. The member API reports `unlocked` only under a live lease, and the
       host turns `unlocked` into `locked` when it releases a stopped
       vault's lease. Recommended: yes; a vault cannot run without its
       lease, and the status is advisory anyway.
    4. `credential_backup` in the registered app's unlock result.
       Recommended: yes; the setting is the member's own, revealed only
       to an app that already passed the code, the attestation and the
       PIN, and it spares the member a password prompt that cannot
       succeed.
    5. The 60-second wait for `hs.resp` is a SHOULD for apps, not a
       protocol timer. Recommended: yes; the vault's `hs.resp` is
       immediate (0.10.3), so 60 s covers relay delay with margin.
    6. `attempts_left` in `vault.recovery.result` (`ok: false, code:
       bad_code`), so that apps need not count wrong codes themselves.
       Recommended: not in 0.10.6, revisit in a later revision; the count
       is enforced in the enclave (5 per recovery, §11.11.2) and an
       app's local count only drives its wording, while a new field in
       a sealed result needs the vault and apps to change together.

20. **App and portal separate (0.15.0).** Owner decision of 2026-10-05:
    the app no longer signs in to the member API; the portal issues a
    setup code (revised after the owner's review of the same day: 5
    minutes, a 128-bit QR secret as the primary path, the short code
    typed only with the member's email, no global limit), the app redeems it with a per-app app key that signs
    its requests, and account information reaches the app through the
    vault (§11.12, §11.13; ENROLLMENT-CODES.md).
    Follow-ups: vettid-vault (`app.api_key` in `vault.enroll` and
    `vault.recovery.register` with the binding to the queue's `app_key`;
    `api_key` in a transfer's `hs.init`; the key and `app_key_seq` in the
    header's app record; the key on `enrolled`, `unlocked` and `locked`
    and the event `app_key`, handed over with the header write; the
    parent's sequence-conditional write of `app_key` whatever the lease;
    the queue op `account` and `account` in unlock, routed to the vault
    process; `account.get` and `sync.event{account.changed}`;
    memberapitest with signed requests, redeem, claim and pending keys;
    vectors for the request signing string, the code alphabet and both QR
    payloads); vettid.org (the code routes, redeem, claim, request
    signing and key matrix, the `account` pushes, the redemption email,
    CloudFront forwarding `X-VettID-App`, the portal's setup page and the
    recovery QR's `api`); vettid-android (no sign-in; the app key; the
    scanner's `t: "e"`; redeem and claim; the account view from
    `account.get`).
    Open risk: if the parent dies between storing a transfer's header and
    writing the reported key, the new phone cannot reach the API and the
    member recovers (availability only).
    Migration: production has no vaults; staging vaults of S1 to S3 are
    deleted and re-enrolled after a staging release S4 of 0.15.0; no
    compatibility path exists in production.
    With the daily owner check (0.13.0, item 22): enrollment by setup
    code starts the clock like any enrollment (§3.6); `account.get` is
    not on the hold's allow list and `sync.event{account.changed}` waits
    for the check (§11.13). With the member API's vault service pause
    (MEMBER-API 1.2.0): code issue, redeem and recovery `claim` are
    refused like `enroll` (MEMBER-API 2.0.0).
    **OWNER DECISIONS of 0.15.0** (drafted as 0.11.0; approved as
    recommended, with the owner's changes noted, on 2026-10-06):
    1. The typed code's alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, 8
       symbols (about 39.6 bits), uniform by rejection sampling.
       Recommended: yes (Crockford base32 keeps 0 and 1).
    2. **Changed by the owner, 2026-10-05:** 5 minutes (was 15). Single
       use, one live issuance per member, shown once, stored only as
       MACs: unchanged.
    3. The QR carries the API origin as an identifier the app must match
       exactly, never as an address; the recovery QR gains it too.
       Recommended: yes.
    4. A same-device App Link `https://account.vettid.org/vault/enroll/#s=`
       on the portal for a member using it on the phone, carrying the QR
       secret, never the short code (owner, 2026-10-05). Recommended:
       yes.
    5. A separate per-app P-256 app key signs app requests, rather than
       the device attestation key (a device identifier the API must not
       see) or a bearer token. Recommended: yes.
    6. The enclave is the source of the app key and reports it to the
       host (§13.7 amended). Recommended: yes.
    7. Unlock no longer requires the current terms; only issuing a code
       does. Recommended: yes.
    8. Account information reaches the app only through the vault, as a
       display-only snapshot pushed by the API with the fields of §11.13,
       `email_hint` included. Recommended: yes.
    9. A new terms version reaches running vaults at their next unlock,
       without a fan-out. Recommended: yes.
    10. The member is emailed at every redemption. Recommended: yes.
    11. A vault enrolled with a stolen code is removed by support (host
        `delete`); no self-service deletion on the portal in v1.
        Recommended: yes.
    12. **Changed by the owner, 2026-10-05: removed.** There is no global
        cap or brake on redemptions (it let one attacker stop every
        member's enrollment); decisions 16–19 replace it.
    13. No portal control to revoke the app's key. Recommended: none;
        recovery covers a lost phone.
    14. Staging vaults are re-enrolled, not migrated. Recommended: yes.
    15. The app drops sign-in entirely, including the `/auth/` App Link.
        Recommended: yes.
    16. Each issuance carries a 128-bit QR secret (22 characters
        base64url), the primary path, redeemable alone under the
        per-network limits only. Recommended: yes.
    17. The typed fallback needs the member's email with the 8-character
        code, compared only with that member's live issuance. Recommended:
        yes.
    18. A ceiling of 800 typed attempts per issuance (about 9.4 × 10^-10
        per issuance), with 5 per (email, network) and the per-network
        limits; at the ceiling only that issuance's typed entry is
        blocked, the member is emailed and operations alerted, and the QR
        still works. Recommended: yes.
    19. No account-existence oracle: every typed failure answers `404
        invalid_code` after the same work and no sooner than 250 ms.
        Recommended: yes.

21. **LEASH §3.5 alignment (0.12.0).** Owner decision of 2026-10-05:
    VettID adopts the LEASH paper's §3.5 delegation and status statement
    format; the paper is the neutral reference, and with no production
    users the change is cheap now. The delegation, `sig`, the status
    statement, `status_sig`, the context strings, the encoding, the
    verifier's steps and the revocation latency bound are the paper's;
    the relay transport, the credential key as `iss`, the Protean
    Credential's unlock window, the vault's `ik` as status issuer with its
    rotation chain, and the audit kinds stay VettID's (§10.11).
    Follow-ups: vettid-vault (`vms/leashwire`: the new members, JCS,
    `nonce`, `leash/v1/*` context strings, the §10.11 verifier steps,
    `testdata/vectors/leash.json` reproducing §16 byte for byte;
    `features/leash` and `features/items/share.go`: build `scope` and
    `limits`, the grant object's `sig` without `key`; `client/leash.go`
    and `cmd/vaultctl`: read `sig`, verify with `iss`; the e2e LEASH
    tests); vettid-android (nothing until the agents phase, ANDROID-PLAN;
    it has no LEASH code); LEASH-IMPLEMENTATION (its list of differences
    shrinks to the VettID bindings).
    vettid-vault: done (vettid-vault #38).
    **OWNER DECISIONS of 0.12.0** (each written as recommended, to
    confirm at review):
    1. `scope` is an object: `op` (VettID's one scope per grant) and the
       grant's restrictions (`connections`; for `items.read`, `tags`,
       `match`, `access`, `uses`). Recommended: yes; the paper's `scope`
       is "the operations, the secret categories or items, and the
       permitted targets", without a fixed shape.
    2. `uses` goes in `scope`, not `limits`. Recommended: `scope`; it
       counts reads of each included item, a property of the rule, and
       `limits` stays exactly the paper's `per_hour` and `per_day`.
    3. `limits` appears in every delegation whose grant has limits, so
       `auto` grants of owner types now carry them (before, only
       `items.read`). Recommended: yes; the paper's `auto` is "allowed
       within `limits`", which a verifier can only see if they are there.
    4. VettID's verifier rejects members it does not know, at the top
       level and in `scope` and `limits`. Recommended: yes (fail closed:
       a restriction a verifier cannot read must not be ignored), and ask
       the paper to state the rule for version 1.
    5. Base64 is standard with padding (RFC 4648 §4), for `iss`, `sub`,
       `status_issuer`, `nonce`, the statement's `delegation` and the
       carried bytes. Recommended: yes, as everywhere in VettID, and ask
       the paper to name the alphabet (it says only "base64-encoded").
    6. The vault's `ik` rotation stays a VettID binding: statements after
       a rotation carry `rotations`, and a verifier that implements only
       the paper rejects them until the grant is re-signed (fail closed).
       Recommended: keep the chain, re-sign nothing automatically, and
       propose key rotation to the paper for a later version.
    7. The grant object's `delegation_sig` becomes `sig`, and `key` is
       dropped (it is the delegation's `iss`). Recommended: yes; no
       client reads them yet.
    8. No migration: a stored grant whose delegation is in the 0.6.0
       format is not served; the member re-issues it. Recommended: yes;
       there are no production users and no agent connector.
    9. The verifier no longer checks the delegation's `iat` (it rejected
       one more than 60 s in the future). Recommended: follow the paper;
       the status statement's `issued_at` bounds freshness.
    10. The proof of possession of `sub` is not specified here; it waits
        for the paper's MCP profile. Recommended: wait; no relying party
        outside VettID exists yet.
22. **The daily owner check (0.13.0).** (Item 20 is 0.15.0, drafted as
    0.11.0 in vettid.org PR #122 and merged after this item; 21 is
    0.12.0.) Owner decisions of 2026-10-05, as
    specified in §3.6:
    1. **Vault-enforced.** The vault records the time of the member's
       last successful check, the PIN and the credential password
       verified together, in DEK state. Enrollment, a completed recovery
       and a completed transfer start the clock.
    2. **Hold, not lock.** Past the interval the vault is held: it keeps
       receiving, acking and storing inbound traffic, keeps its mailbox
       and sessions alive and sends content-free counts, but refuses
       every owner-device request except the check, `vault.lock`,
       `vault.status` and what the check strictly needs, with the new
       error `owner_check_required`. Peers' requests that need the
       member are queued; credential alarms are still delivered;
       desktops' access sessions are suspended; recovery and its cancel
       keep working.
    3. **One combined prompt**, at the first app open after the
       deadline, never mid-action; the app may warn ahead.
    4. **Interval:** default and maximum 24 h, shorter by the member's
       setting (at least 1 h); changing it is owner-only.
    5. **Agents paused while held**: no LEASH status statements are
       issued or renewed, so agents stop within `status_ttl` + 60 s;
       existing statements are not revoked early; agents' requests are
       refused.
    6. **Wrong entries** count in the PIN and password backoffs; ten
       consecutive failed checks lock the vault and alert the owner's
       devices.
    7. The check rotates the credential, so a copied blob goes stale
       within the interval.
    8. **The member decides whether the vault holds** (owner decision of
       2026-10-06, §3.6.7): `owner_check.hold` (default on). Turning it
       off rides on a successful `vault.owner-check` (`hold: false`, an
       optional `hold_off_until` at most 30 days ahead, after which it
       comes back on by itself); turning it on needs no check and holds
       at once if the deadline has passed. Corrected the same day: the
       check is never dismissible; past the deadline the vault gates
       the app whether or not the hold is on. With the hold off only
       the rest of the vault keeps running (desktops' sessions, agents
       and their status statements, ringing, presence, fan-out to
       devices other than the app), and attempted checks still count
       toward the backoffs and the ten-failure lock. Every change is audited and a feed item
       (`owner_check.hold_changed`); the app shows a persistent "hold is
       off" indicator.

    Follow-ups: vettid-vault (the owner-check record and its migration
    for existing vaults; `vault.owner-check` reusing the transfer's PIN
    check and §3.5.3; the hold's allow list in the dispatcher, with
    `owner_check_required` and `drop.owner_check`; `vault.held` and its
    counters; the call, presence, approval, access-session, location and
    LEASH status gates; the ten-failure lock; the interval setting with
    its shorten-now, lengthen-later rule; the hold switch
    (`owner_check.hold`, `hold_off_until` and its automatic return,
    `hold`/`hold_off_until` in the check's sealed payload,
    `settings.set` refusing `false`); audit and feed kinds; e2e tests of
    a held vault receiving a message, refusing an app request, passing a
    check and resuming an agent, using an injectable clock;
    `client/` and `cmd/vaultctl`: `owner-check`); vettid-android
    (ANDROID-PLAN §6: the combined check screen, the hold screen with
    counts and hidden cache, the hold switch with its end date and the
    persistent "hold is off" indicator, the early warning, the interval setting,
    the locked-and-past-deadline path, error and lock handling);
    MEMBER-API unchanged (the hold is not reported to the host). Since
    0.15.0 (item 20), `account.get` is not on the hold's allow list and
    `sync.event{account.changed}` waits for the check, like any other
    fan-out (§11.13).

    **OWNER DECISIONS of 0.13.0** (sub-decisions; all twelve approved as
    recommended by the owner on 2026-10-06):
    1. **What resets the clock:** only `vault.owner-check` (a dedicated,
       UTK-sealed `{pin, password}` with the blob), plus enrollment's
       first `credential.create`, a completed recovery and a transfer's
       approval. An unlock never counts, even with a password (§3.6.1:
       the alternate channel cannot carry the blob, has no holder
       session, and the check must work on a vault that stays unlocked).
       Recommended: as specified.
    2. **Calls while held:** no ringing; the caller times out as with a
       locked callee; a missed call is recorded and counted. A call
       answered before the deadline continues. Recommended: as
       specified (an answer would let a phone in other hands speak as
       the member, and a check in the middle of answering is
       mid-action).
    3. **Standing authorizations toward connections continue** while
       held (issued grants, `auto` share rules, `auto` actions), and
       everything that asks the member is queued. Recommended: continue;
       the alternative, pausing all outbound disclosure, would tell
       connections that something changed and break the member's own
       standing decisions.
    4. **Presence:** a held vault does not answer pings (it looks locked
       or offline). Recommended: as specified.
    5. **The failure count** survives a lock and is reset only by a
       successful check; each failure past ten locks again.
       Recommended: as specified.
    6. **No host alarm or email** for the ten-failure lock: the host sees
       an ordinary lock (§13.7). Recommended: none now; revisit with
       push (§14), which could wake desktops.
    7. **Interval changes:** app only; a shorter value applies at once, a
       longer one from the next check. Recommended: as specified.
    8. **Existing vaults** start their clock at the first unlock under a
       0.13.0 release, not held at once. Recommended: as specified
       (there are no production vaults, and a full interval avoids a
       surprise lock-out in staging).
    9. **The app MUST hide cached vault content while held.**
       Recommended: MUST; otherwise the hold protects only what the vault
       serves, not what the phone already shows.
    10. **`vault.held` cadence:** at the start of the hold and on count
        changes, at most once per device per 10 minutes, to the app and
        to desktops with an unexpired access session. Recommended: as
        specified.
    11. **A transfer's approval is a check** (success starts the clock;
        wrong entries count as failed checks); an open transfer survives
        the hold, a new one waits for a check. Recommended: as specified.
    12. **The unlock result does not report the hold**: the app reads
        `vault.status` after unlocking. Recommended: as specified (no
        change to the sealed result's format, §11.4).

23. **No standalone credential deletion (0.15.2).** Owner decisions of
    2026-10-06: "we shouldn't have a vault without a credential except
    during enrollment", and `credential.delete` is removed as a
    standalone operation. A credential is deleted only as the first step
    of `vault.delete` (§12.5); a member who wants a new credential uses
    `credential.reset` (delete and create in one step, with the PIN and
    a new password; it restarts the owner check's clock), which the
    holder may now send (§3.5.5, §10.6). The holder's form also carries
    the current password, as the removed `credential.delete` did, so
    that the PIN alone cannot replace the credential and defeat the
    owner check (§3.6). A vault without a credential exists only during
    enrollment, where the owner check does not gate it (§3.6.1).
    Follow-ups: vettid-vault (remove the `credential.delete` handler and
    the `credential.deleted` kinds; accept the holder's
    `credential.reset` with the owner-check verification, failure
    counting and clock restart; `client/` and `cmd/vaultctl`);
    vettid-android (remove the delete-credential UI; offer "new
    credential" as the holder's reset, with the warning that every
    critical item is destroyed).
24. **No recovery with the backup off; start over instead (0.16.0).**
    Owner decisions of 2026-10-06, verbatim: "if you lose a credential
    and have backups disabled you should not have a path back besides
    re-enrolling. we don't want to leak anything to someone without the
    credential." and, correcting a draft that still let a backup-off
    recovery end in deletion, "NO! THERE IS NO RECOVERY IF BACKUP IS
    DISABLED". Supersedes item 13.1 and, for the recovering app, item
    13.8. Decided with it (2026-10-06):
    1. **The backup bit.** The vault reports one content-free bit to its
       host, `credential_backup` (whether it keeps a backup copy of its
       credential), on `enrolled`, `unlocked`, `locked` and the event
       `credential_backup` (§11.5, §13.7, §2.2), so that the member API
       refuses a recovery request upfront (`409 recovery_unavailable`,
       `reason: "no_backup"`, §11.11.7). The enclave decides from its own
       sealed header (`credential_backup`, §3.3) and refuses as well,
       before locking the vault (`error: "no_backup"` with the clear slot
       code `recovery_unavailable`, §11.11.1, §11.11.2), and refuses a
       register and the registered app's unlock (`no_backup`, §11.11.3,
       §11.11.5).
    2. **"Delete my vault and start over"** from the portal, with a
       recovery's 24 h, emails and cancel (portal, email link, app),
       executed by the host's `delete` (§12.5) without the credential:
       it opens and returns nothing. Then a new vault with a setup code
       (§11.11.9).
    Removed: the recovering app's `credential.reset` and `vault.delete`,
    `credential_lost`, and 0.9.0's "access only" recovery, which let an
    app holding only the account, 24 h and the PIN keep the old vault's
    messages, connections, profile, `data` and `secret` items, audit log,
    feed and location log under a new credential. The recovering app
    (backup on) is also narrowed: `vault.status` reduced to `{vault_id,
    state_seq, header_seq}`, no fan-out of any kind, until
    `credential.recover` succeeds (§11.11.5). The holder's
    `credential.reset` (item 23) stays. §3.5.6's warning now says that
    with the backup off a lost or replaced phone cannot be recovered and
    everything in the vault is lost. §12.5 states the data bucket's
    7-day noncurrent-version retention (VAULT-RELEASES §11.4).
    Follow-ups: vettid-vault (the header's `credential_backup` and its
    lifecycle reporting; refuse a backup-off `recovery` before locking,
    with `no_backup` and `recovery_unavailable`; refuse register and the
    registered app's unlock with `no_backup`; remove the recovering
    app's `credential.reset`, `vault.delete` and `credential_lost`;
    enforce the reduced allow list and `vault.status`; the parent writes
    `credential_backup` and copies `recovery_unavailable`; `client/` and
    `cmd/vaultctl`); vettid-android (the backup-off warning; remove the
    backup-off recovery screens; handle `no_backup` at register and
    unlock; show and cancel a pending deletion from `GET
    /api/vault/status`); vettid.org (MEMBER-API 2.1.0: the bit on the
    vault row, `409 recovery_unavailable`, the `unavailable` recovery
    state, the deletion routes and job, emails; the account site's
    recovery page copy and the start-over page).
    **Not decided, recommended as written** (to confirm at review):
    the start-over is offered whatever the backup bit (it reveals
    nothing, and the API cannot see a stale bit); the vault is not locked
    during the start-over's 24 h (nothing in it is at risk from the
    deletion request, and the member's app can still cancel); the delay
    is enforced by the member API, not the enclave (§11.11.9).
25. **A transferred app learns `user_guid` from `device.paired`; `backoff`
    carries `retry_after` (0.17.0).** Owner decisions of 2026-10-06.
    1. **The gap.** A phone set up by a direct transfer (§6.7.1) never
       received the member's `user_guid`, which every unlock names and
       signs (§11.4): it paired, but could not unlock after the vault
       next locked. An enrolled app has it from the redeem (§11.12.1), a
       recovering app from the claim (§11.11.7).
    2. **The decision: option 1.** The vault puts `user_guid`, from its
       own sealed header (§3.3), in a transfer's `device.paired`, sealed
       under the handshake's epoch to the new app (§6.7.1, §10.3). The
       old app sends nothing new, so it works whatever the old app's
       version; the new app stores it as an enrolled app stores the
       redeem's. This **supersedes** the first instruction of the same
       day, that the old phone hand `user_guid` to the new phone inside
       "the transfer's existing sealed handoff": no such old-to-new
       payload exists (the approval's sealed part is sealed to a UTK,
       for the vault; the new app's `api_key` travels in its own
       `hs.init`; the new app receives only `device.paired` and the
       blob, from the vault). Rejected alternatives: the old app's
       approval carrying it for the vault to forward (still
       `device.paired`, and the vault already knows it); the transfer QR
       or link (not sealed: anyone who saw the code would learn the
       member's `user_guid`); a new member API route.
    3. **Old releases.** A transfer's `device.paired` without
       `user_guid` comes only from a vault release before 0.17.0; the
       transfer is already complete, so the new app keeps the vault and
       warns that it cannot unlock after the vault locks until the vault
       runs 0.17.0 or later (§6.7.1).
    4. **`backoff` carries `retry_after`** (whole seconds, rounded up, at
       least 1) in its error body, for the owner check (§3.6.1) as the
       unlock result already does (§11.4). Decided with it, recommended
       as written (to confirm at review): every `backoff` error response
       carries it, since the PIN and password backoffs are shared with
       the transfer's approval and the other credential operations
       (§10.1); additive, as unknown members are ignored.
    5. **Editorial:** the app header's `nonce` and `sig` are base64url
       without padding (§11.12.2, MEMBER-API 2.1.2), as vettid-android
       sends and the member API already requires.
    Follow-ups: vettid-vault (`user_guid` in a transfer's
    `device.paired`; `{retry_after}` on `backoff`; `client/`);
    vettid-android (store `user_guid` from a transfer's `device.paired`
    and unlock with it, warn when it is absent; the owner check's
    backoff countdown from `retry_after`).
26. **Connections always get the account's names and the vault's
    identity key; names change only in the app (0.18.0).** Owner
    decisions of 2026-10-07, in two rounds (the second answering the
    review of vettid.org #155).
    1. **The gap.** Connections in the new app showed "Unnamed
       connection": the shared profile's only name was the optional,
       empty-by-default display name (§10.8), and the account snapshot
       carried no name (§11.13). The old vettid.dev published profile
       carried the first and last name, the email address and the vault
       identity key.
    2. **Account names.** The member API adds the member row's
       `first_name` and `last_name` to the account snapshot (MEMBER-API
       2.2.0); the email address stays out of the snapshot and the
       profile.
    3. **A fixed core.** Every `profile.update` carries `first_name`,
       `last_name` and `ik`, which the member cannot remove or edit as
       part of the profile; the display name ("allow a display name
       too"), photo and `@profile` items are optional extras.
    4. **Re-sent on change**: a name change from a newer snapshot and
       an `ik` rotation, ordered after `identity.rotate` and in the
       epoch under the new `ik` (§10.8).
    5. **Answers of 2026-10-07 (owner):**
       - **Name changes only in the app**, not on the portal, which
         shows the names read-only. Chosen design: the vault verifies
         the member with the PIN and the credential password, as an
         owner check, and hands the request to its host
         (`account.name.set`, the event `account_name`, §10.8, §11.5);
         the member API accepts a change only from that path. Rejected:
         a member API route signed by the app key (MEMBER-API 2.0.0),
         which is simpler (no new host event, an immediate HTTP answer)
         but proves only possession of the phone, not the member's PIN
         and password, and would be the one account change an app makes
         without its vault.
       - **Placeholder** "Name not shared yet": approved, for the short
         moment between a connection's activation and its first
         `profile.update` only, since peers always carry names.
       - **The names in the connection request** (`hs.init` profile):
         approved. The bundle's `hint.name`, which anyone holding the
         link can read, stays the display name only.
       - **"First Last"** ordering: approved. **Rate limit: once a
         month**, made precise as one applied change per 30 days per
         member (the registration names do not count; refused requests
         do not count).
       - **No backward compatibility: VettID has no users today.**
         Every `profile.update` and `hs.init` profile MUST carry the
         names (and the update `ik`); an update without them is dropped
         as malformed. The snapshot always carries the names; it keeps
         `"v": 1` with them required, and the `enroll` message carries
         it, so that no vault is ever without names. 0.18.0's first
         draft's allowances (profiles from releases before 0.18.0,
         a vault without names that sends no profile, a display name
         always present for older receivers) are removed; the display
         name is optional (absent when none).
    6. **Admin.** The admin API shows member names but has no route to
       change them; none is added.
    **Not decided, recommended as written** (to confirm at review): a
    successful `account.name.set` does not count as the daily owner
    check (it does not move the deadline); a new request replaces one
    still pending; the vault checks the 30 days itself from the
    snapshot's `allowed_after` before asking for the PIN and password,
    and the member API checks them again; the fingerprint's form (16
    bytes of a domain-separated SHA-256, 8 groups of 4 hex digits); the
    defensive `profile.core_missing` audit for a vault that somehow
    lacks names.
    Follow-ups: vettid-vault (names required in the snapshot and the
    `enroll` message; the core in `profile.get`, `profile.update` and
    `hs.init`; refuse the core in `profile.set`; send on name change
    and after a rotation's rekey; the receiver's checks and the
    `drop.*` kinds; `account.name.set`, the `account_name` event, the
    parent's row write, `name_request`; the fingerprint in
    `keys.json`; `client/`); vettid-android ("First Last" titles,
    display name secondary, the placeholder, the fingerprint, no
    "verified" wording; the change-name screen with PIN and password
    and its states); vettid.org (MEMBER-API 2.2.0: the names and
    `name_change` in the snapshot, `account` in `enroll`, the
    vault-row fields and their IAM, the name-change job with its audit,
    email and push; the account site shows the names read-only;
    RUNBOOK "The account snapshot").
27. **The held counts in `vault.status`; the profile size check (0.19.0).** Owner decisions of
    2026-10-07. A `vault.held` notice can be missed (an app that was not
    running, a notice dropped as older), and before 0.19.0 nothing else
    carried the counts, so an app could show a gated vault as having
    nothing new. Decided: `vault.status`'s `owner_check.waiting` carries
    the same counts while `due` or `held` (§10.2); the first count
    change after the start notice is not delayed by the 10-minute
    spacing (§3.6.3); apps never show unknown counts as zero and re-read
    `vault.status` when they return to the foreground while gated
    (§3.6.5). Also decided by the owner on 2026-10-07 (from the review
    of vettid.org #156): the shared profile's 196,608-byte limit is
    checked against maximum-length names (each counted as a 322-byte
    JSON string) whenever the display name, photo or `@profile` items
    change, so that a later name change, which the vault cannot refuse
    once the member API applied it, never brings a `profile.update` over
    the limit receivers enforce (§10.8). Rejected: checking with the
    current names (an update near the limit would be dropped by every
    receiver after a longer name) and a receiver margin over 196,608
    bytes. Follow-ups: vettid-vault (`waiting` in `vault.status`, the
    first-change exception, the worst-case size check; on vettid-vault
    #45); vettid-android (the unknown-counts state and the foreground
    re-read).
28. **The full email in the app; audit search in the vault; the app's
    navigation and History (0.20.0).** Owner decisions of 2026-10-07,
    from hands-on testing of the staging app.
    1. **The full email address in the app.** The member's own avatar
       sheet and Settings show the account's first and last name and
       the full email address, not the masked hint. The account
       snapshot carries `email` (the member's verified address) instead
       of `email_hint`, which is removed from the snapshot without a
       transition: VettID has no users, the vaults that run today (S4,
       0.15.0–0.17.0, and #45's 0.18.0) check `email_hint` only when
       present and ignore unknown members, so none refuses the new form,
       and S3 never parses a snapshot (§11.13). The redeem and
       recovery-claim answers keep `email_hint`: they reach an app that
       has proved nothing yet (§11.11.7, §11.12.1). **The email stays
       inside the member's own vault and devices**: only `account.get`
       returns it, to the app and desktops; it never goes into a
       profile, an `hs.init`, an invitation hint, a feed item, an audit
       entry or anything a connection, an agent or the host receives,
       unless a future version of this specification says so (§11.13,
       §13.7). Agents never get it (`account.get` is not delegable,
       §10.11).
    2. **Audit search in the vault.** `audit.list` and
       `connection.audit.list` gain `q` (a case-insensitive substring
       search the vault runs over the entry's kind and the current
       names of its connection, device and item, never secret values),
       `since` and `until` (RFC 3339), beside `kinds` and
       `connection_id`; a search evaluates at most 2,000 entries per
       request and answers `partial` with a cursor when that budget runs
       out before `limit` matches (§10.9). Chosen in the draft, then
       confirmed by the owner (point 4): the searched fields; Go's
       `strings.ToLower` per rune without Unicode normalisation (the
       enclave has no normalisation tables; apps send NFC); kinds also
       matched with `.`, `_` and `-` read as spaces; names as they are
       when the vault answers (a removed connection's entries are found
       by kind only); the 2,000-entry budget; `since` inclusive, `until`
       exclusive; who may call the types is unchanged (app, desktop).
    3. **App navigation and naming** (ANDROID-PLAN 0.1.11): the drawer
       drops "Credential" (reached from Settings → Security) and
       "Invite a connection" (the floating action button invites on
       Connections and starts a new message on Messages); the "Items"
       section is called **"Vault"** in the app's interface, while the
       specifications keep "items" as the technical term; a new drawer
       entry **"History"** shows the audit log with the vault-side
       search, filters by category, connection and date, infinite scroll
       with the cursors and an entry detail, read-only.
    4. **Review of vettid.org #158 (owner, 2026-10-07).** The owner
       agreed to the choices above that were open: the searched fields,
       `strings.ToLower` without normalisation and the kind separators
       read as spaces, current names only, the 2,000-entry budget with
       `q` only, `since` inclusive and `until` exclusive; desktops keep
       the full email (`account.get` stays app and desktop); History's
       category filter is single-choice (so a request never exceeds 16
       `kinds` prefixes), with ANDROID-PLAN's category table; translated
       kind labels are not searchable in the vault. One change: the
       app's drawer has no "create" group at all, since the floating
       action button creates everywhere (ANDROID-PLAN 0.1.11 §3, §4).
    Follow-ups: vettid-vault (`email` required in the snapshot parser;
    `q`, `since`, `until`, `partial` and the scan budget in
    `features/audit`, with a name resolver over connections, devices
    and items; `client/` and `vaultctl audit`; tests); vettid.org
    (MEMBER-API 2.3.0: `email` instead of `email_hint` in
    `accountSnapshot`, tests; the redeem and claim answers unchanged);
    vettid-android (the account card in the avatar sheet and Settings,
    the drawer and FAB changes, "Vault" strings, the History screen).
29. **Gaps from implementing 0.20.0 and the app's vault items, sharing
    and grants (0.21.0).** Owner decision of 2026-10-08: the owner asked
    for these fixes before staging release S5, from the gaps vettid-vault
    #46 (0.20.0) and vettid-android A5 (#78–#80: items, tags and
    sharing, grants and critical-item approvals) reported. The details
    marked "chosen in the draft" are open for the owner's review of this
    revision.
    1. **Editing a critical item with one password entry.** Until 0.20.0
       an edit was two credential operations: `item.reveal`, then an
       `item.put` that sent every value back. A critical `item.put`
       that replaces an item now keeps the stored value of a field sent
       with its `field_id` and without `value`, and the stored notes
       with `keep_notes: true`; the vault opens the old values inside
       the same operation and re-seals the result under the next item
       key (§10.7 Kept values). Chosen in the draft: a kept field keeps
       its kind (a kind change needs a value); its label and position
       may change; a field is removed by leaving it out, as before.
       The draft kept the rule to critical items; the owner extended
       it to secret items (point 6), and so to every replacement.
    2. **Suitability before the password.** `critical-secret-use.pending`,
       `.list` and `.get` carry the field's `kind`; a field is suitable
       only if it is a `password`, `text` or `multiline` field of an
       item that is not a wallet's, and a request for any other is
       answered `unsuitable` at once, without the member and without a
       credential operation (§10.13). A suitable field whose value is
       not a seed is still found only at the use.
    3. **Which limit.** Every `limit` error carries `{limit, max,
       size?}`, with one name per limit of this specification (§10.1),
       so that apps say which limit was reached.
    4. **Additions for the apps** (chosen in the draft): `dry_run` on
       `item.put` and `item.tag`, answering the rules the item would
       gain or leave, so that apps never compute the sharing effect from
       the rules themselves (§10.7); an item's size counted without the
       members the vault assigns (ids, version, timestamps), with the
       exact encoding, so that an app computes it (§10.7 Size);
       `share.pending.list` (§10.12); `share.decide` with `include` and
       `decline` in one atomic change (§10.12); field `labels` on
       received grants in `grant.list` and the member's item `name`,
       `category` and `labels` on available `grant.pending` entries;
       the shape of `grant.list`'s `requested` (§10.12); the bound of
       64 outgoing critical-item use requests (§10.13).
    5. **Editorial.** `file` fields stay reserved (§10.7); the search
       budget runs out when a 2,001st entry would be evaluated;
       `since` ≥ `until` is compared in Unix milliseconds;
       `connection.audit.list` takes `after_seq`, as every release did
       (§10.9); the snapshot `email` excludes C0, DEL, C1, U+2028 and
       U+2029 (§11.13).
    6. **Review of vettid.org #161 (owner, 2026-10-08).** The owner
       agreed to the choices above and decided the open points:
       1. Kept values apply to `secret` items too, so that editing one
          needs no `item.reveal`; the draft extends the rule to every
          replacement, `data` included, since it only makes the forms
          consistent (§10.7 Kept values).
       2. A kept field may not change its kind (confirmed).
       3. Requests refused at once as `unsuitable` are not shown to
          the member, only recorded in the audit log, which the app's
          History shows (§10.13).
       4. The `limit` table keeps every limit of this specification
          (confirmed).
       5. `item.get` reports the item's `size` now, for every
          sensitivity; `item.list` does not (§10.7).
       6. The member API's registration refuses an email with C0, DEL,
          C1, U+2028 or U+2029, the snapshot `email`'s set, and its
          names rule is stated to refuse DEL; the vault's names rule
          adds DEL, so that a vault never refuses a snapshot built from
          a registered member (MEMBER-API 2.3.1, §10.8, §11.13).
       7. Agent share rules stay deferred: v1 pairs no agents (D3).
    7. **Errata from implementing 0.21.0 (0.21.1).** vettid-vault #47
       found six points where 0.21.0 was contradictory, ambiguous or
       unreachable; the owner (2026-10-08): "agreed, fix all 6".
       1. A dry run follows the access rule of the call it previews but
          never needs step-up: a desktop may dry-run `item.tag` of a
          critical item (its real `item.tag` is allowed with step-up),
          while a dry run of `item.put` for a critical item is
          `forbidden` (critical puts are app-only). 0.21.0 said both
          that a desktop's dry run needs no step-up and that "a
          critical item stays app-only", which read as forbidding every
          dry run of a critical item, and its list of critical forms
          ("acts on a critical item") covered `item.tag`, which is
          metadata (§10.7).
       2. `item.put`'s dry run requires `version` with `item_id`, as the
          real `item.put` does (§10.7).
       3. More than 64 fields is `bad_request` for every sensitivity, a
          shape error without a `limit` name; the separate 64-field
          bound for critical items could never be reached and is
          removed (§10.7, §10.1).
       4. A move to `critical` checks the 12,288-byte size on the item
          as it will be stored, with `"sensitivity":"critical"` (§10.7).
       5. `kind` may be absent from `critical-secret-use.pending`,
          `.list` and `.get` for a request that arrived before 0.21.0
          (at most 24 h after the upgrade); receivers treat an absent
          `kind` as unknown (§10.13).
       6. An incoming `critical-secret.use` is checked usable, then
          suitable, then against the 8 pending requests per connection,
          so an unsuitable request is answered `unsuitable` even at the
          cap (§10.13).
    Follow-ups: vettid-vault (kept values and `keep_notes` in
    `features/items` for every replacement, critical and secret
    included; `size` in `item.get`, recorded for critical items; the
    size without assigned members in `itemspec`; `dry_run` on `item.put`/`item.tag` from the existing
    share plan; the `limit` body in every feature; `share.pending.list`
    and `share.decide{include, decline}`; `labels` on received grants,
    `name`/`category`/`labels` on available `grant.pending` and
    `grant.list` pending entries; `kind` and the early `unsuitable` in
    `features/critical`, the early refusals kept off the feed and
    `.list`; U+2028/U+2029 in `ValidAccountEmail` and DEL in
    `ValidAccountName` and the profile receiver; `client/` and
    `vaultctl`; tests); vettid.org (MEMBER-API 2.3.1: the registration
    email check refuses C0, DEL, C1, U+2028 and U+2029; tests);
    vettid-android (critical edit in one password operation and secret
    edit without a reveal, with kept values; the room left from
    `item.get`'s `size`; the size computed without ids; the dry run instead of the local computation; the `limit`
    names in the member's words; pending shares from
    `share.pending.list`; one `share.decide` with both lists; grant
    labels and entry names from the vault; the suitability notice).
    For 0.21.1: vettid-vault #47 (the six points as implemented, with
    tests for an absent `kind`); vettid-android (an absent `kind` is
    unknown: no suitability notice).
30. **History export (0.22.0).** Owner decisions of 2026-10-08.
    1. **A deliberate exception to "no export".** The member may export
       History (the audit log as the app shows it) to a file. This is
       an exception to the decision of 2026-10-03 that there is no
       backup or export of vault data out of the service, recorded
       wherever that rule is stated (§3.5.6, §10.16; VAULT-PLAN 0.1.4
       §4, VAULT-RELEASES 0.1.8 §11, ANDROID-PLAN 0.1.17 §4). It covers
       **activity metadata only**: time, kind, direction, the
       connection's, device's and item's names, `ref`, `seq` and the
       chain fields; never item values, secrets, message text,
       credential material or the account email. The rule stands for
       everything else (§10.9 History export).
    2. **CSV and JSON**, chosen by the member. JSON carries each
       entry's chain fields so that an export can be checked against
       the log, with a header (format version, `exported_at`, the
       filters, the count, the first and last `seq`) and nothing that
       identifies the vault; CSV has a header row, RFC 4180 quoting,
       UTF-8, ISO 8601 UTC times and the apostrophe against formula
       injection (§10.9).
    3. **Scope**: what History's filters show (category, connection,
       dates, search), newest first, at most 10,000 entries; if more
       match the app says so and suggests narrowing the dates; the
       count and the range are shown before the member confirms.
    4. **The vault PIN** confirms it, checked by the vault under the
       existing backoffs, in a new request that carries the sealed
       PIN; the vault audits the export and then authorises it.
    5. **Saving** only through the platform's "Save to…" (Android's
       Storage Access Framework): never to shared storage or the
       gallery on its own, never uploaded; the file is unencrypted and
       the app says so before saving.
    6. **Agents never** get it (§10.11).
    Chosen in the draft (owner's review below, point 8):
    1. **App only.** Desktops are answered `forbidden` and MUST NOT
       offer an export; an export from a desktop with step-up (§6.8) is
       left for later.
    2. **The PIN alone, UTK-sealed** (§3.5.4), as the enrolling app's
       `vault.delete` carries it: no password and no credential
       operation, so no CEK rotation. A wrong PIN is `bad_pin` in the
       §11.8 backoff, audited `vault.pin_failed`; the draft also made
       it a failed owner check (§3.6.4), which the owner's review
       dropped (point 8.2).
    3. **A preview and an export, then paging.** `audit.export` with
       `dry_run` counts without the PIN; the export answers the count
       and the bound `upto_seq` but not the entries, which the app reads
       with `audit.list` below `upto_seq` + 1. Carrying up to 10,000
       entries in one response would need megabytes, beyond §5.5's
       inner plaintext, and a claim-check blob from the vault would be
       new machinery; paging needs nothing new, since the app may read
       the log anyway. The PIN is therefore an intent check and an
       audit record, not access control: the app MUST NOT write a file
       without a successful export.
    4. **The kind `audit.exported`**, named after the request (as
       `account.name_requested` after `account.name.set`), with
       `device_id` = the app and a `key=value` summary in `ref`
       (`format`, `count`, `seqs`, `filters`, `since`, `until`): the
       entry's members are fixed by the hash formula, so the summary
       does not get members of its own; it names no connection, kind
       prefix or search text. History lists it under **Security**
       (ANDROID-PLAN §4).
    5. **No feed item** for an export; the draft did not refuse it
       during a clone alarm (it is not a credential operation), which
       the owner's review changed (point 8.4).
    6. `q` is evaluated over the whole log by `audit.export`, without
       the 2,000-entry budget, so that the count is exact; the log has
       at most 10,000 entries.
    7. CSV with a byte order mark (spreadsheets read UTF-8 names then)
       and `hash` in hex (so that no cell needs the apostrophe); JSON
       without one; the file name `vettid-history-<UTC time>`.
    8. **Review of vettid.org #174 (owner, 2026-10-08).**
       1. App only in this version (confirmed); an export from a
          desktop with step-up may come later.
       2. A wrong export PIN counts **only** in the §11.8 PIN backoff
          and is audited `vault.pin_failed`; it is **not** a failed
          owner check and never counts toward the lock after ten
          failed checks (§3.6.4).
       3. The 10,000-entry cap and `more` stay as written (the app
          handles `more` though the retention makes it unreachable
          today).
       4. The export is **refused while a clone alarm is open**, as
          the other sensitive actions are: `credential_frozen` or
          `rotation_required`, the alarm's freeze code, before the UTK
          is spent, the dry run included (§3.5.9, §10.9). No feed item
          for an export (confirmed).
       5. The `ref` summary as written (confirmed).
       6. CSV with a byte order mark and `hash` in hex; JSON with
          base64 (confirmed).
       7. The website's use-cases page ("There is no export file to
          steal or misuse", about the credential) stays as it is.
    Follow-ups: vettid-vault (`audit.export` in `features/audit`: dry
    run, the PIN check with the §11.8 backoff only (no failed-check
    count), the refusal during a clone alarm, `upto_seq`, the whole-log `q`, `audit.exported` and its
    `ref`; holder only, `forbidden` for desktops, not delegable, gated
    while held; `client/` and `vaultctl audit export`; tests, among
    them the backoff, no `failures` change on a wrong PIN, the alarm
    refusal without a spent UTK, `not_found`, `upto_seq` bounds
    and the summary format); vettid-android (History ⋯ → "Export…",
    the confirm sheet with count, range and format, the PIN step,
    paging, the CSV and JSON writers with the injection rule, the
    Storage Access Framework save, the unencrypted-file notice; tests
    with a chain check of the JSON); vettid.org (none beyond these
    documents).
31. **Share-rule rate limits, overlapping rules and 0.22.0 errata
    (0.23.0).** Owner decisions of 2026-10-09.
    1. **Rate limits on connection rules.** A connection's share rule
       may set `per_hour` and `per_day`, as an agent's rule does; until
       0.22.x they were `bad_request` on a connection rule (§10.12 Rate
       limits for connections).
    2. **`ask` wins when rules overlap.** When an item is covered by
       more than one rule of the same subject (connection or agent),
       the most restrictive mode applies: if any covering rule is
       `ask`, the item is shared only after the member approves it,
       even if another covering rule is `auto`. Until 0.22.x the spec
       was silent and the vault treated the rules independently, so
       `auto` won (§10.12 Overlapping rules).
    3. **Errata from implementing 0.22.0** (vettid-vault #50, its four
       spec notes, plus the device side of an early new-epoch message):
       1. the clone-alarm refusal of `audit.export` comes after the
          §3.6.3 gate, not "before anything else";
       2. a request without a spendable UTK (`utk_id` or `sealed`
          absent or malformed, or a `dry_run` that is not a boolean)
          is `bad_request` at once; the other shape checks follow the
          spend, as specified;
       3. the holder check (`forbidden`) comes before the alarm's code;
          the full order is stated (§10.9 Order of checks);
       4. the preview of an empty log answers `upto_seq` 0 and
          `upto_hash` 32 zero bytes;
       5. a responder that receives a message of a new epoch before
          `hs.fin` leaves it unacked for redelivery, as the vault does;
          a MUST for devices, desktops and agents (§6.3, §6.5).
    4. **A month hint for card expiry dates**: a template's `date`
       field may carry `"format": "month"` (editorial; VAULT-ITEMS
       0.1.2, §10.7).
    Chosen in the draft (open for the owner's review of this revision):
    1. **Ranges** as for agents (`per_hour` 1–3,600, `per_day`
       1–86,400): there is no reason to differ, since both bound
       fetches of the same items counted the same way. Both optional
       and independent, **no default** (a connection rule without them
       behaves as before), unlike an agent rule's 60 and 1,000; a
       one-off or shared-action grant has none.
    2. **What is counted**: the connection's successful fetches of the
       rule's items **in total**, across its items and grants ("this
       connection can fetch items shared by this rule at most N times
       per hour"); repeats of a `fetch_id` and refused fetches count
       nothing; critical-item uses (each approved, §10.13) are not
       counted.
    3. **Windows**: fixed windows that start at the first counted
       fetch, one hour and 24 hours, exactly as an agent grant's
       (§10.11); kept when the rule is replaced (a lowered limit
       applies at once), ended with the rule. Not calendar windows,
       which would let 2 × N fetches through around a boundary, and not
       rolling windows, which would differ from agents and need a log
       of fetch times.
    4. **Past a limit**: `data.value{error: "rate_limited",
       retry_after}`, checked after the other refusals, no use counted;
       passed on in `grant.value`; audited `drop.grant_rate_limited`
       as every refusal; the member is not asked (a connection is not
       referred to the apps as an agent is) and gets at most one
       normal-priority feed item `share.rate_limited` per rule per 24
       hours.
    5. **`uses` and the rate limits both apply.** Grants carry the
       rule's limits as `limits {per_hour?, per_day?}` (the LEASH
       delegation's name), in the `<grant>` and its descriptor, so the
       connection's app can show them; a received grant's are as of
       issue.
    6. **Coverage** is evaluated whenever the vault plans inclusions
       (tag changes, sensitivity moves, rule set, replacement,
       deletion and expiry, `include_existing`), on the rules as they
       are after the change. An item that gains an `auto` rule is
       included at once only if every other covering rule of the
       subject is `auto` or already includes it (the member approved
       this item for this subject); otherwise it is pending in the
       `auto` rule with `ask_rule_id`.
    7. **One answer per item and subject**: including an item in one
       rule includes it in every rule of the subject where it is
       pending; declining it declines it everywhere for that subject,
       withdrawing it from rules that included it (an explicit act of
       the member, not a silent withdrawal).
    8. **No silent withdrawal**: an item already shared by an `auto`
       rule stays shared when an `ask` rule starts covering it; it is
       asked when it gains the `ask` rule (`include_existing: true`, or
       a later change), and stays shared without a question with
       `include_existing: false`. New versions are never asked: a grant
       serves the current content, and the member decides inclusions,
       not versions. Asking per version would need versioned grants
       and would ask the member about every edit.
    9. **Removing an `ask` rule never shares anything**: items it held
       pending in `auto` rules stay pending until the member decides.
    10. **Limits across overlapping rules: the strictest applies.** A
        fetch, or an agent's read, counts in the windows of every rule
        of the subject that includes the item and is refused while any
        is full, so a second rule never raises the rate. The draft
        kept each grant's own `uses`; the owner's review tightened it
        (point 12.1).
    11. **Previews and app text**: the dry runs of `share.rule.set`
        (`outcome`, `ask_rule_id`), `item.put` and `item.tag`
        (`ask_rule_id` on an `auto` entry) and the pending entries
        (`ask_rule_id`, `shared`) name the rule that asks; apps MUST
        explain it ("Asks you first because your *medical* rule for Dr
        Lee covers it"), naming rules by their tags since rules have no
        names.
    12. **Review of vettid.org #181 (owner, 2026-10-09).** Approved, with
        these changes:
        1. **`uses` across overlapping rules: tightened.** A fetch
           through a rule grant counts one use on every rule grant of
           that item to that connection that has `uses`, is refused
           `exhausted` if any has none left, and spending the last use
           of one spends them all (`used`); `uses_left` is the least.
           For an agent a read counts in every including rule with
           `uses`, and an item with none left in one is included in
           none (§10.12 Overlapping rules, §10.11).
        2. **Rule names are their tags** in member-facing text, with no
           member label: one tag "your *medical* rule", `match: all`
           joined by " + " ("your *medical + id* rule"), `match: any`
           by " or "; two rules that read the same are told apart by
           mode or expiry (§10.12).
        3. The ANDROID-PLAN entry follows later (confirmed).
        4. **No approval fatigue from connections** (§10.4.1). A
           connection's **asks** (grant requests, critical-item uses,
           `prompt-each-time` invocations, authentication challenges,
           introduction offers, location requests; share-rule
           questions are the member's own and are not asks) are checked
           for mute, pause, a 7-day **cooldown** after the member
           declined the same ask, **8 pending** per connection and **5
           per 24 hours** (a fixed window from the first ask that
           reaches the member, as §10.12's), and suppressed at the
           first that applies. **3 declines within 30 days** pause the
           connection's asks, with one feed item
           (`connection.asks_paused`) until the member resumes
           (`connection.asks.resume`); the member can **mute** and
           unmute (`connection.asks.mute`). Asks within **10 minutes**
           form one batch: one feed item with `count`, one approval
           entry and one notification. The constants are fixed for v1.
        Chosen in the draft for point 4 (open for review):
        1. **The asks** are the six listed; connection requests (§6.4)
           keep their own limits; `allowlist` and `default-allow`
           actions are not asks.
        2. **"The same" ask**: a grant entry's `kind` and `ref` (fields
           ignored); a use's `item_id` and `field_id`; an action's
           `action_id`; any challenge; any offer from that introducer.
           A grant request loses only the entries in cooldown. Location
           requests have no decline, so no cooldown.
        3. **A decline** is an explicit refusal of a whole ask; expiries,
           partial approvals and suppressed asks are not. The 30 days
           are sliding (three timestamps kept); the 24 hours are a
           fixed window, as §10.12's, counting only asks that reached
           the member.
        4. **No oracle**: a suppressed ask gets exactly the member's
           decline answer of its kind (`approved: false`, `denied`,
           `accept: false`; a location request none), never a code or
           `retry_after` of its own, after a random delay of 1–20
           minutes (before the ask's `exp`), at most 16 held per
           connection (beyond: no answer). The suggested `rate_limited`
           or `unavailable` with `retry_after` would tell the connection
           which mechanism refused it, so they are not used; asking
           apps show every refusal as "Not accepted".
        5. **Mute** suppresses silently (audited only); unmuting does
           not resume a pause; `connection.asks.resume` also clears the
           decline times and cooldowns. Both types are app and desktop
           (no step-up: both only reduce or restore what reaches the
           member), not delegable.
        6. **Audit**: `drop.ask_muted`, `drop.ask_paused`,
           `drop.ask_cooldown`, `drop.ask_pending`, `drop.ask_rate`,
           and `connection.asks_paused`, `_resumed`, `_muted`,
           `_unmuted`; the state is in `<connection>.asks`.
    13. **Errata from implementing 0.23.0 (0.23.1).** vettid-vault #52
        (merged as 46c7297) found eleven points where 0.23.0 was silent,
        ambiguous or, for one, decided otherwise by the owner:
        1. `tag.merge`'s `shares` carry `ask_rule_id`, as the dry runs of
           `item.put` and `item.tag` do: a merge can leave an `auto`
           entry pending (§10.8).
        2. A suppressed ask's answer is due at min(now + the random 1–20
           minute delay, `exp` − 1 minute), never earlier than now;
           answers due while the vault is locked are sent after unlock
           (§10.4.1).
        3. A later ask of a batch whose feed item the member read or
           archived updates its `count` and `seq` and keeps the status;
           a deleted item ends the batch, and the ask starts a new one
           (§10.4.1 Batching).
        4. A rule's windows count only fetches through the rule grants
           of the item; a fetch through a one-off or shared-action grant
           of the same item is neither counted nor refused by them
           (§10.12 What is counted).
        5. A repeated `fetch_id` while a window is full is answered again
           (idempotent), not refused (§10.12 Fetching).
        6. Windows count a rule's fetches even while the rule has no
           limits, so a limit set later applies to the open window
           (§10.12 The windows).
        7. **Owner decision (2026-10-09): `connection.asks.resume` always
           clears the connection's decline history and cooldowns** and
           ends a pause if any; it is audited `connection.asks_resumed`
           (and sends `sync.event{connection.changed}`) even when nothing
           was paused. 0.23.0 said that it changed nothing on a
           connection without a pause or cooldown, which left a member
           unable to reset a decline history that had not yet paused
           the connection (§10.4.1).
        8. Each grant entry removed for a cooldown is its own
           `drop.ask_cooldown`, written even if the reduced request is
           then suppressed by a later check; a suppressed location
           request does not use location's one-per-10-minutes allowance
           (§10.4.1 Audit, §10.16).
        9. `retry_after` is at most 86,400 seconds (a day, the longest
           window); a `data.value` with more is malformed (§10.12).
        10. A received `limits: {}` means no limits (§10.12
            Descriptors).
        11. `sync.event{kind: "connection.changed"}` for an ask-state
            change carries `{connection_id, version}`, as for
            `connection.update`, and goes to every owner device
            (§10.4.1, §10.1).
    14. **Owner decision (2026-10-09): History records which device
        opened the vault (0.23.2).** Until 0.23.1, `vault.unlocked`,
        `vault.locked` and `owner_check.held` carried no `device_id`,
        so History could not say which phone opened the vault and a
        search by a device's name did not find these entries, while
        `owner_check.passed`, `settings.changed` and `audit.exported`
        named their device. From 0.23.2:
        1. `vault.unlocked` carries `device_id`, the device record of
           the app whose unlock (§11.4) opened the vault: the vault
           knows it at the unlock, from the unlock key the request's
           `device_ik` selects, after the signature and the device
           assertion verified. The confirming unlock at a move's new
           release and an abandonment (§11.10.4) are unlocks of the app
           as well and name it. An app without a device record (the
           first app before its enrollment handshake, §11.3, or a
           recovered app before its handshake, §11.11.5) has no
           `device_id` to name, and the entry has none.
        2. `vault.locked` carries `device_id` when an owner device's
           `vault.lock` (§10.2) locked the vault. Every other lock
           (§12.3) has none: the account site's lock route (the
           account's, not a device's), ten failed owner checks (whose
           own entries precede it), a recovery, memory pressure, a lease
           loss, a restart. If a `vault.lock` and the owner check's lock
           fall in one batch, the lock is the owner check's. Neither
           entry gains a reason.
        3. `owner_check.held` stays without `device_id`: the vault holds
           itself (§3.6.3).
        4. Additive only: entries written before are unchanged, and the
           chain is unchanged, since `lp(device_id)` was always hashed
           (empty when absent). New entries hash their `device_id`. The
           search's device name (§10.9 Search, field 3), `audit.list`,
           `audit.export` and the export's device name apply to these
           entries as to any other. No type or member changes; an app
           names the device as for any entry with `device_id`, through
           `device.list` (ANDROID-PLAN History: the row and the entry
           page; follow-up there).
    Open points:
    1. **ANDROID-PLAN** gains the rule editor's per-hour and per-day
       fields, the overlap explanation, and the connection page's
       paused and muted states once #179 and #180 are merged, to avoid
       conflicting with them.
    2. **Settings for the constants.** §10.4.1's numbers are fixed for
       v1; making them member settings is left for later.
    Follow-ups: vettid-vault (`per_hour`/`per_day` on connection rules
    in `features/items/share.go`, the per-rule windows in state, the
    `rate_limited` refusal with `retry_after` in `features/grants`, the
    `limits` member, `drop.grant_rate_limited`, the
    `share.rate_limited` feed item at most once per rule per 24 h; the
    ask-wins planning, `ask_rule_id`, `shared` and `outcome` in the
    plans and dry runs, one answer per item and subject in
    `share.decide`, the strictest windows and `uses` across rule
    grants (one use on each, all spent together) and for agents'
    reads; the asks of §10.4.1 across `features/grants`,
    `features/critical`, `features/actions`, `features/intro`,
    `features/location` and the authentication handler: the checks in
    order, cooldowns, pending cap, window, pause and mute state,
    `connection.asks.mute`/`.resume`, `<connection>.asks`, batching
    with the feed `count`, the delayed neutral answers, the `drop.ask_*`
    and `connection.asks_*` entries; the `audit.export` errata as
    implemented in #50, with the order stated; `client/`, `vaultctl`;
    tests for each, among them that a suppressed ask's answer is
    byte-identical in shape to a decline's); vettid-android (the rule
    editor's "at most N times an hour / a day" fields for connections,
    the "try again in" message on `rate_limited`, `limits` on received
    grants, the overlap explanation in previews and questions with the
    tag naming rule, the one-question-per-item decision and the
    decline warning; one approval entry and notification per batch;
    the connection page's paused and muted states with Resume, Mute and
    Unmute; refusals shown as "Not accepted"; the early new-epoch MUST
    is already met since #75; the month picker for `"format":
    "month"`); vettid.org (none beyond these documents; the registry's
    `payment_card` template in vettid-vault `docs/item-templates.json`
    version 3). For 0.23.1: vettid-vault (`ask_rule_id` in
    `tag.merge`'s `shares`; `connection.asks.resume` always clears and
    is always audited; tests pinning points 2–6, 8, 10 and 11; the
    `retry_after` bound was already enforced; docs/MUST-COVERAGE.md
    0.23.1 section); vettid-android (the merge preview explains an
    `auto` entry held by an `ask` rule from `ask_rule_id`; `limits: {}`
    shown as no limits; Resume may be offered whenever the connection
    has declines, not only while paused).

## 16. Test vectors

These vectors use fixed seeds and are for **test use only**. The complete
vectors, with every input, are the JSON files in
[vettid-vault `testdata/vectors/`](https://github.com/vettid/vettid-vault/tree/main/testdata/vectors);
the values below are excerpts, and the files are authoritative. The Go,
Kotlin, Swift and Rust clients MUST reproduce them byte for byte.

- HPKE encapsulation randomness is 64 bytes: bytes [0:32] are the ML-KEM-768
  encapsulation randomness `m`, bytes [32:64] the X25519 ephemeral secret
  (X-Wing `EncapsulateDerand`). Implementations supply it through a
  deterministic test hook.
- A KEM key's 32-byte seed is the RFC 9180 serialized private key; it is
  expanded with SHAKE256 as in draft-ietf-hpke-pq.
- The session vector's inner plaintext is the sealed one with `"seq":1`
  after `ts`.
- Tokens, ids, PIN and claim ids in the vectors are dummy values.

```
§3.2 keys                                                       (keys.json)
  vault ik seed               : 32 x 0x04
  vault ik pk (b64)           : ypOsFwUYcHHWe4PH/w7+gQjo7EUwV113JoeTM9vavnw=
  vault MLKEM768X25519 seed   : 32 x 0x05   vault ek: 1216 B (keys.json)
  vault static kid (hex)      : 40d6c2c8471844a9

§4.3 sealing (HPKE base, suite 2)                               (hpke.json)
  encapsulation randomness    : 64 x 0x07
  enc (1120 B)                : hpke.json
  shared_secret               : 3239a1c6d8d76895e408c7e65ee38d8b43f4732c7a74c5ccfbac6bd63f743bce
  key                         : f8cfa15ec73bf1031bc50dfc462438a3d6a3d933f7edf6b28bc149fd7400e2a6
  base_nonce                  : 6666ec691911c5f6f1161207
  exporter_secret             : 1d7856a1a77eee3accf4e69fb2353f2421e3f15584739e5c6df73d487b4b66b4

§5.2 sealed envelope                                            (envelope_sealed.json)
  inner : {"v":1,"id":"01JB2Z6V9K3M4N5P6Q7R8S9T0V","type":"test.ping","ts":"2026-10-01T12:00:00.000Z","body":{}}
  padded length : 512     envelope length : 1668     sender_kid : 0000000000000000

§5.2 session envelope                                           (envelope_session.json)
  k_i2r : 32 x 0x08   nonce : 24 x 0x09   sender_kid : 8 x 0x02   recipient_kid : 8 x 0x01
  envelope length : 572

§6.3 handshake 0.10.2, purpose connection (superseded by 0.10.3 below)
  initiator ik / kem / eph seeds 32 x 0x0a / 0x0b / 0x0c; relay seeds vault 0x10, initiator 0x11
  randomness hs.init 64 x 0x0d, hs.resp 64 x 0x0e; hs.fin nonce 24 x 0x0f
  K_s      : 3e3921cbc2a89f56741ac74c5cb2a10db0dc327c80d113ece000ecdf55eabe2d
  K_e      : 91bc195aaff1d13d0e8044800c42127df94fcf4231207adc9a84a1be29e0f866
  th1      : 2999a1fe3626e7fe57ac901c35ee2b7ba7e2e6b92f85596a6a49aa96fa888bd7
  th       : fd53f877211806d1f4fc0cfa30821d20201e44686e18fe1d222a5f2bd99c29d7
  prk      : 4cf5ffe8a9d849d312f7313365f3a1fa583e17863cda7a43f97c1b8f84b94345
  k_i2r    : cf67963c38497b503ebbcdfa8d78924395fe765f5dc37e8d18adeb472b26d379
  k_r2i    : fe388025380567d3c310943e0352a374b0d0f890f98533fb47f667ee0148fa99
  kid_i2r  : 1c14c8b40b51f614      kid_r2i : 752c20e9d8f53948
  rk       : caf3de4dd468f538464963fdbfaa4eb549558ef03cfc1220879f43c2bb41e6dd
  epoch_id : 42abe40a9588c5d779aebd3b7a3cc2b8
  sas      : 696599
  sig_R, sig_I, all three envelopes : handshake.json

§6.4 claim bundle                                               (invite.json)
  k_b : 32 x 0x14   nonce : 24 x 0x15   blob, h, QR JSON, link : invite.json

§10.8 ik fingerprint (0.18.0; computed for this document, to be added to keys.json)
  ik     : the vault ik pk above
  SHA-256("vettid/vms/2/ik-fp" || ik) : 9a1fbb7d873eeafb494bef94f0727b2539c2faf27783d46d4e6862673f6216c3
  shown  : 9a1f bb7d 873e eafb 494b ef94 f072 7b25

§11 alternate channel                                           (altchan.json)
  ETK seed 32 x 0x06; descriptor bytes and user_data, devatt challenges
  (enrollment and unlock), unlock signing string (0.3.0, 12 fields) and
  signature, vault.unlock padded to 12,288 B in a 13,444 B envelope
  (randomness 64 x 0x13) : altchan.json
```

**§11.10 release updates (0.3.0).** These values were computed with Go 1.26
(ECDSA P-256 with RFC 6979 deterministic nonces). vettid-vault generates
them in `testdata/vectors/release.json` (phase V3a), byte for byte equal
to the values below, together with the signing string of the unlock that
carries the approval; `altchan.json` is regenerated for 0.3.0.

```
§11.10.1 manifest signature
  manifest key (test only): P-256 private scalar 32 x 0x21
  public key SPKI (b64) : MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERi26GuT8GpaLTazyDN1tvh+uNKqXFRSmPTQFw9HP04O1i7sIwTODQoxYU8ccTIUeE0sFaCHkaP4Kl3q/QxPd4Q==
  key_id                : 1edbb48b6669decd
  manifest bytes (1,060 B; one line, broken here after commas):
    {"v":1,"serial":7,"issued_at":"2026-10-02T12:00:00Z","releases":[{"release":3,"pcr0":"ab"x48,
    "pcr1":"11"x48,"pcr2":"22"x48,"seal_key":"arn:aws:kms:us-east-1:000000000000:key/test-release-3",
    "status":"deprecated","published_at":"2026-09-01T00:00:00Z","notes":"https://vettid.org/releases/3"},
    {"release":4,"pcr0":"cd"x48,"pcr1":"33"x48,"pcr2":"44"x48,
    "seal_key":"arn:aws:kms:us-east-1:000000000000:key/test-release-4","status":"active",
    "published_at":"2026-10-01T00:00:00Z","notes":"https://vettid.org/releases/4"}]}
    ("ab"x48 = 96 hex characters; no spaces or line breaks in the real bytes)
  SHA-256(manifest bytes)                       : d3fc1be2ce9358815863eeae15bebf5c755f168a7ab161c8e5c66500be1288f1
  SHA-256("vettid/pcr-manifest/1" 00 manifest)  : 9b086ab99783d85706fdacf3dd36f496c16e30f05468450f1efd946fae1ddfad
  sig (r||s, b64) : 3AyvBQGEjYFOYLlmp+EwyEbvd/34cnEB9jcAA5o691JRXj6eKTHcZHUZw36FgLtpEpYRLAsLlpGYYZWwQZE46w==

§11.10.3 approval (vault_id test-vault-0001, request_id 01JB2Z6V9K3M4N5P6Q7R8S9T22,
          from "ab"x48 to "cd"x48, to_release 4, manifest_serial 7)
  signing string  : "vettid/vms/2/release-approval\ntest-vault-0001\n01JB2Z6V9K3M4N5P6Q7R8S9T22\n"
                    "ab"x48 "\n" "cd"x48 "\n4\n7"
  SHA-256(string) : 1217fb681eb6a11899ff5ab2ab1a620f179bb942088dc2b79e9b0466380d10b5
  Android device attestation key (test only): P-256 private scalar 32 x 0x22
  public key SPKI (b64) : MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE1lqTl3yqPRsIGFL/V6eeRl8WYFdzBLrq1QXdOkhYnPNQGF6JU3LfYiHqOhN1V+Rz/dtnVfBb1QfDxTP86ckShQ==
  approval sig (DER, b64) : MEQCIH8lw3H0EdOnkuiH6yMEMR/zIh16+kPuacXjK77FnYf+AiBGvXMyQ6vhmpA1JRJYd804f5qw9Dtyo7kXZZ/TTSMCSA==
```

**0.10.0.** `altchan.json` is regenerated: the `vault.unlock` request
carries `manifest_sha256` and `manifest_serial` instead of the served
manifest (§11.4); the unlock signing string is unchanged.
`release.json` gains a 0.10.0 manifest vector (`manifest_0_10_0`) with a
`removed` and a `retired` entry carrying `ends_at`, its SHA-256 and its
signature under the test manifest key (vettid-vault phase V5 W1). The
values in the files are authoritative.

```
§11.10.1 manifest 0.10.0 (serial 8, releases 2 removed, 3 retired, 4 active)
  manifest bytes : 1,619 B (release.json manifest_0_10_0)
  SHA-256        : 1076917dbc01969c1dedaaaa0ec81d711a7d4babc184a834aa8d3fe275c97c9d
  bucket object  : manifests/1076917dbc01969c1dedaaaa0ec81d711a7d4babc184a834aa8d3fe275c97c9d.json
```

**0.10.2.** No vector changes: the invitation URL (§6.4) is the
payload's `r`, `/connect#`, then `invite.json`'s `link`.

**0.10.3.** `handshake.json` is regenerated for the SAS commitment
(§6.3). New inputs: `n_I` = 32 x 0x16 and `n_R` = 32 x 0x17, carried in
`hs.init` (`sas_commit`), `hs.resp` and `hs.fin` (`sas_nonce`); every
other input is unchanged, except that `hs.init` and `hs.resp` no longer
carry `reconnect_token` (§6.2: a connection handshake carries only a
request token). The scripted randomness draws `n_I` after the ephemeral
key seed and before the `hs.init` encapsulation randomness, and `n_R`
before the `hs.resp` encapsulation randomness. `K_s`, `K_e` and `prk`
depend only on the KEM randomness and keys, not on the bodies, so they
keep the values above; the envelope bytes change, and with them `th1`,
`th` and everything expanded from `th`. The 0.10.2 values above for
those lines, and its `sas` (696599, the old derivation), are no longer
valid vectors. The values below were generated by vettid-vault's
reference implementation (0.10.4).

```
§6.3 handshake 0.10.3, purpose connection                       (handshake.json)
  inputs as above, plus n_I 32 x 0x16, n_R 32 x 0x17; the tokens are request
  tokens (the same dummy strings) and hs.init and hs.resp carry no reconnect_token
  n_I (b64)  : FhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhY=
  n_R (b64)  : FxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxc=
  sas_commit : 8e1e9d648451f0f78b42a5df826d753e0fc7d26350385e315ab0b2ac87069ada
               = SHA-256("vettid/vms/2/sas-commit" || n_I)
  K_s      : 3e3921cbc2a89f56741ac74c5cb2a10db0dc327c80d113ece000ecdf55eabe2d   (unchanged)
  K_e      : 91bc195aaff1d13d0e8044800c42127df94fcf4231207adc9a84a1be29e0f866   (unchanged)
  th1      : 9c8c7d1bab70e3168bcf059b37c7eb3f955e688fab76baa546d005cfec0c6292
  th       : b55b4418b1682f39233a00d39cbe5611fe11046bdb7979ffe37bc1534266e606
  prk      : 4cf5ffe8a9d849d312f7313365f3a1fa583e17863cda7a43f97c1b8f84b94345   (unchanged)
  k_i2r    : 0d8e45152d6ddef7f81e8ce687a49828681b105f6cd659897381d1835c154373
  k_r2i    : d45cee46842eed98fd70a4eae4ee4faebebe69095c3ee201425ca0b71b565624
  kid_i2r  : 6349e099da936da3      kid_r2i : bbc389b64572164d
  rk       : e36fe85affcdcc0f30f0e9ebe24edb1e5c09311a4fc8965a3afcd5a04f11f39c
  epoch_id : 3332049cb10c9f4d590822dca82883a8
  sas      : 564218
  sig_R, sig_I, all three envelopes : handshake.json
```

**0.10.6.** New file `recovery.json` (§11.11.2): the recovery code sealed
to the portal's browser key, and the `no_credential` refusal, with every
intermediate value, the header's code hash and the QR payload. Generated
by vettid-vault (#31) through the enclave's own sealing code; the values
in the file are authoritative. The browser key is test only (the portal's
real key is a non-extractable WebCrypto key). The ephemeral scalar is
drawn before the nonce.

```
§11.11.2 recovery code                                          (recovery.json)
  browser key (test only): P-256 private scalar 32 x 0x23
  browser_key (65 B, hex) : 042464a2f8813e007299b9c0beef9c8d6d8d17470b32bba0329c145f0cfc60b683
                            f831a35205868db984da728a6a0e1129e8940e8b735798e65360dada93457645
  vault_id    : test-vault-0001        recovery_id : 01JB2Z6V9K3M4N5P6Q7R8S9T30
  code bytes  : 20 x 0x28              code        : 50M2GA1850M2GA1850M2GA1850M2GA18
  not_before  : 2026-10-02T12:00:00.000Z   expires_at : 2026-10-03T12:00:00.000Z
  code_hash   : 0aa336f542592f05a7c72081fa955cd7a8a22a7b3595fdb5d1f9c5cad7c80a72
                = SHA-256("vettid/vms/2/recovery-code" 00 vault_id 00 recovery_id 00 code)

  sealed code: eph scalar 32 x 0x24, nonce 12 x 0x25
    ECDH (x)  : b49383585922137d268863642bc701246272d84c8a93072905e25b65e9f457da
    k         : 14878c75a9e9cdac52a7d9d7f477d42a1e5a8270709ee503e37334f40c9aa261
    pt        : {"v":1,"vault_id":"test-vault-0001","recovery_id":"01JB2Z6V9K3M4N5P6Q7R8S9T30",
                 "code":"50M2GA1850M2GA1850M2GA1850M2GA18","not_before":"2026-10-02T12:00:00.000Z",
                 "expires_at":"2026-10-03T12:00:00.000Z"} (one line), 00 padding to 5,158 B
    out       : 5,252 B, SHA-256 f8dc9c8dc69b4cbf64c5e6bcc61df6c76e488f03e1f3223b07dff755aba57c91

  no_credential: eph scalar 32 x 0x26, nonce 12 x 0x27
    ECDH (x)  : f57b8af7a79e75c5c841cce2d24bb02c5ca61a9ceceadb23d4f3324bac9af655
    k         : a3a4c5eadb9bdc06f48189dd81795a2eb34d1ae5783de14c25d057b421902126
    pt        : {"v":1,"vault_id":"test-vault-0001","recovery_id":"01JB2Z6V9K3M4N5P6Q7R8S9T30","error":"no_credential"},
                00 padding to 5,158 B
    out       : 5,252 B, SHA-256 c7120dd27a8bbfe190789fe1cf316fbb8a04da0133993761f294cc0a9b809631

  QR payload (129 B): {"v":1,"t":"r","vault_id":"test-vault-0001","recovery_id":"01JB2Z6V9K3M4N5P6Q7R8S9T30",
                       "code":"50M2GA1850M2GA1850M2GA1850M2GA18"} (one line)
  salt, aad, eph public keys, full out (b64) : recovery.json
```

**0.15.2.** The QR payload of `recovery.json` above predates the `api`
member (0.15.0) and is no longer what a portal writes or an app of
0.15.0 accepts. The 0.15.0 form, with `api`, is `recovery_qr` in
`appkey.json` (164 B for the same `vault_id`, `recovery_id` and code),
next to the enrollment QR `enroll_qr` (79 B):

```
§11.11.2 recovery QR, 0.15.0                                    (appkey.json)
  recovery_qr (164 B): {"v":1,"t":"r","api":"https://account.vettid.org","vault_id":"test-vault-0001",
                        "recovery_id":"01JB2Z6V9K3M4N5P6Q7R8S9T30","code":"50M2GA1850M2GA1850M2GA1850M2GA18"} (one line)
```

**0.12.0.** New file `leash.json` (§10.11): two LEASH delegations in
the LEASH paper's §3.5 format and their status statements. These values
were computed for this revision with two independent implementations
(Python `cryptography` 50 with `json.dumps(sort_keys)`, and Go 1.26
`crypto/ed25519` with `encoding/json` maps), which agree byte for byte;
vettid-vault's `leash.json` is to reproduce them (§15 item 21). Times are
Unix seconds; `iat` is 2026-10-01T12:00:00Z.

```
§10.11 LEASH delegation and status statement                     (leash.json)
  credential key seed (iss) : 32 x 0x30   pk : G6QHW3fJ4/s+zeFc2vUiHzwQNz5iP3sOHvdjZrCvcTc=
  agent ik seed (sub)       : 32 x 0x31   pk : SAdaWX5yGhVuLgeZ3lzAxTJNxufq8c3UYlCGjsUyFd0=
  vault ik seed (status)    : 32 x 0x04   pk : ypOsFwUYcHHWe4PH/w7+gQjo7EUwV113JoeTM9vavnw=  (§3.2 above)

  A: items.read, auto, with exp; nonce 16 x 0x32
    delegation (467 B; one line, broken here after commas):
      {"approval":"auto","exp":1798632000,"grant_id":"01JB2Z6V9K3M4N5P6Q7R8S9T41",
      "iat":1790856000,"iss":"G6QHW3fJ4/s+zeFc2vUiHzwQNz5iP3sOHvdjZrCvcTc=",
      "limits":{"per_day":1000,"per_hour":60},"nonce":"MjIyMjIyMjIyMjIyMjIyMg==",
      "scope":{"access":"read","match":"any","op":"items.read","tags":["api-keys","work"],
      "uses":10},"status_issuer":"ypOsFwUYcHHWe4PH/w7+gQjo7EUwV113JoeTM9vavnw=",
      "status_ttl":900,"sub":"SAdaWX5yGhVuLgeZ3lzAxTJNxufq8c3UYlCGjsUyFd0=","v":1,"version":1}
    SHA-256   : 82403562f0a1b62c520c468d46f58a473eefc0cae0ac6a0d8d8bdaef225ea436
    sig       : xGYxdD9lhE27/4NjTmDl1L+9/UJRv3cdRdWp3yOVxCOPgicdwrL+lv9A7lP4RNkE47XVEpAjAvh7Dc0z9dBKCw==
    status    : {"delegation":"gkA1YvChtixSDEaNRvWKRz7vwMrgrGoNjYva7yJepDY=",
                "grant_id":"01JB2Z6V9K3M4N5P6Q7R8S9T41","issued_at":1790856060,"not_after":1790856960,
                "status":"valid","v":1}
    status_sig: aSkNJrcIZmkYLzpX5Z7jb/1tHXkwrcNHBZURMycInB9vWdwEpGJB3RDzPmzUscKL6H3tRaOSyZID653kpcgACg==
    accepted for now in [1790856000, 1790857020] (issued_at − 60, not_after + 60)

  B: message.send, ask, one connection, version 2, no exp, status_ttl 300; nonce 16 x 0x33
    delegation (389 B; one line, broken here after commas):
      {"approval":"ask","grant_id":"01JB2Z6V9K3M4N5P6Q7R8S9T42","iat":1790856000,
      "iss":"G6QHW3fJ4/s+zeFc2vUiHzwQNz5iP3sOHvdjZrCvcTc=","nonce":"MzMzMzMzMzMzMzMzMzMzMw==",
      "scope":{"connections":["01JB2Z6V9K3M4N5P6Q7R8S9T43"],"op":"message.send"},
      "status_issuer":"ypOsFwUYcHHWe4PH/w7+gQjo7EUwV113JoeTM9vavnw=","status_ttl":300,
      "sub":"SAdaWX5yGhVuLgeZ3lzAxTJNxufq8c3UYlCGjsUyFd0=","v":1,"version":2}
    SHA-256   : 36ce9294e797cf1eecff1c61b8a21647e45a20eedd6acdb2abe2a591e322bacc
    sig       : PS1c/aT/OAMyYaPhSudMMJX7TjCaXVrkjk6zOmjoFfZR9ZxjkzjTgfMg6smbq6KCDRoqh4AmXwUAtnJivESDBw==
    status    : {"delegation":"Ns6SlOeXzx7s/xxhuKIWR+RaIO7das2yq+KlkeMiusw=",
                "grant_id":"01JB2Z6V9K3M4N5P6Q7R8S9T42","issued_at":1790856060,"not_after":1790856360,
                "status":"valid","v":1}
    status_sig: AcQTmAdY8UpkeDssy4iHgHo8hKPZxwq1FJI8YHOwSUOgHRlCEc+SV4VVZr7fTn/jzKrFo9EilExC3XwKJKW1Bw==
    accepted for now in [1790856000, 1790856420]

  statements are one line too, broken here after commas
  signing inputs: "leash/v1/delegation" || delegation bytes; "leash/v1/status" || status bytes
  base64 of the delegation and status bytes : leash.json
```

Cross-implementation checks against Apple CryptoKit and BouncyCastle are
pending (§15, follow-up 1).

**0.16.0.** The `no_backup` refusal (§11.11.2) is sealed exactly as the
`no_credential` one above, with `"error":"no_backup"` in `pt`; vettid-vault
adds it to `recovery.json` (eph scalar 32 × 0x28, nonce 12 × 0x29) with
the 0.16.0 implementation.

## 17. Changelog

- **0.23.2** (2026-10-09): additive, owner decision of 2026-10-09
  (§15 item 31.14).
  - §10.9: `vault.unlocked` carries `device_id`, the app whose unlock
    (§11.4) opened the vault, also at a move's confirmation or
    abandonment (§11.10.4); none for an app without a device record
    yet.
  - §10.9: `vault.locked` carries `device_id` when an owner device's
    `vault.lock` locked the vault, and none for any other lock (§12.3).
  - §10.9: `owner_check.held` stays without `device_id`;
    `owner_check.passed` names the app, as before.
  - Older entries and the chain are unchanged (`device_id` was always
    hashed, empty when absent).
  - §15 item 31.14.

- **0.23.1** (2026-10-09): editorial-normative, errata to 0.23.0 from
  its implementation (vettid-vault #52); owner decision of 2026-10-09
  on `connection.asks.resume` (§15 item 31.13).
  - §10.8: `tag.merge`'s `shares` carry `ask_rule_id`, as the dry runs
    of `item.put` and `item.tag` do.
  - §10.4.1: a suppressed ask's answer is due at min(now + the random
    delay, `exp` − 1 minute), never earlier than now, and one due while
    the vault is locked is sent after unlock.
  - §10.4.1: a later ask of a batch whose feed item is read or archived
    updates `count` and `seq` and keeps the status; a deleted item
    starts a new batch.
  - §10.4.1: `connection.asks.resume` always clears the decline history
    and cooldowns, ends a pause if any, and is audited
    `connection.asks_resumed` even when nothing was paused (owner
    decision).
  - §10.4.1, §10.16: each grant entry removed for a cooldown is its own
    `drop.ask_cooldown`, even when the reduced request is then
    suppressed; a suppressed location request does not use location's
    allowance.
  - §10.4.1, §10.1: `sync.event{connection.changed}` for ask state
    carries `connection_id` and `version` and goes to every owner
    device.
  - §10.12: a rule's windows count only fetches through the item's rule
    grants, and count them also while the rule has no limits, so a
    limit set later applies to the open window; a repeated `fetch_id`
    is answered again even while a window is full; `retry_after` is at
    most 86,400; a received `limits: {}` means no limits.
  - §15 item 31.13.

- **0.23.0** (2026-10-09): normative, owner decisions of 2026-10-09
  (§15 item 31): rate limits on connection share rules, `ask` wins
  when rules overlap, and errata to 0.22.0 from its implementation
  (vettid-vault #50); VAULT-ITEMS 0.1.2.
  - §10.12: a connection rule takes `per_hour` (1–3,600) and `per_day`
    (1–86,400), optional and without default; they count the
    connection's successful fetches of the rule's items in total, in
    fixed windows that start at the first counted fetch (as §10.11);
    past a limit the fetch is refused with `rate_limited` and
    `retry_after` (after the other refusals, no use counted), audited
    `drop.grant_rate_limited`, with the feed item `share.rate_limited`
    at most once per rule per 24 hours; `uses` applies as well; grants
    and descriptors carry `limits`; `data.value` and `grant.value`
    carry `retry_after`.
  - §10.12: Overlapping rules: if any rule of a subject that covers an
    item is `ask`, the item is shared with that subject only after the
    member approves it; an item that gains an `auto` rule is pending
    there (`ask_rule_id`) unless every other covering rule is `auto` or
    already includes it; one answer per item and subject (a decline
    withdraws the item from that subject's rules); no silent
    withdrawal and no question per version; removing an `ask` rule
    never shares anything; rate limits combine strictly, and so does
    `uses` (owner's review): a fetch through a rule grant counts one use
    on every rule grant of the item to that connection, is `exhausted`
    if any has none left, and spending one spends all; a rule is named
    to the member by its tags (" + " for `all`, " or " for `any`);
    `outcome` and
    `ask_rule_id` in `share.rule.set`'s dry run, `ask_rule_id` and
    `shared` in `share.pending` and `share.pending.list`; apps MUST
    explain which rule asks. A rule replaced from `ask` to `auto`
    includes only the pending items no other `ask` rule holds.
  - §10.7: `item.put` and `item.tag` dry-run `shares` entries carry
    `ask_rule_id`. Editorial: a registry template's `date` field may
    carry `"format": "month"` (VAULT-ITEMS 0.1.2).
  - §10.11: an agent's read counts in every including rule's windows
    and is referred while any is full; `ask` wins for agent rules too.
  - §10.9 (errata): the order of `audit.export`'s checks: the common
    gates (§3.5.7, §3.6.3), the sender and holder (`forbidden`), the
    clone alarm, then `bad_request` at once for a request without a
    spendable UTK, then the steps as specified; the empty-log preview
    answers `upto_seq` 0 and `upto_hash` of 32 zero bytes. §10.9 feed
    kinds: `share.rate_limited`.
  - §6.3, §6.5: a responder MUST leave a message of a new epoch that
    arrives before `hs.fin` unacked for redelivery; devices, desktops
    and agents as the vault.
  - §10.4.1 (new; owner's review of #181): asks from a connection and
    their checks (mute, pause, a 7-day cooldown of the same ask after
    a decline, 8 pending, 5 per 24 h fixed window), the pause after 3
    declines in 30 days with one `connection.asks_paused` feed item,
    `connection.asks.mute` and `connection.asks.resume`,
    `<connection>.asks`, 10-minute batches with the feed item's
    `count`, suppressed asks answered as a decline after a random
    1–20-minute delay (no oracle), `drop.ask_*` and `connection.asks_*`
    audit kinds; pointers in §10.4, §10.12–§10.16; §10 registry; §10.1;
    §10.9 feed `count`.
  - §15 item 31 (with 31.12, the owner's review of #181).

- **0.22.0** (2026-10-08): normative, owner decisions of 2026-10-08
  (§15 item 30): History export, a deliberate exception to the
  2026-10-03 decision of no export of vault data, for activity metadata
  only.
  - §10.9: `audit.export` (the holder's app only): a dry run counts the
    entries matching `audit.list`'s filters (at most 10,000, newest
    first, `more` beyond, `q` over the whole log); the export carries
    the UTK-sealed `{pin}`, checked under the §11.8 backoff only (a
    wrong PIN is `bad_pin` and `vault.pin_failed`, not a failed owner
    check); refused with the freeze code while a clone alarm is open,
    appends `audit.exported` (`ref` = the export summary) and answers
    `upto_seq`; the app reads the entries with `audit.list` below it.
    The CSV and JSON formats, the file's name, the "Save to…" rule and
    the unencrypted-file notice.
  - §10 registry: `audit.export`. §10.11: no `audit.*` type is
    delegable. §3.5.4: the payload may be the PIN alone. §3.5.6,
    §10.16: the export is the one exception and holds neither the
    credential nor positions. §3.5.9: `audit.export` is refused during
    a clone alarm. §13.5: a saved export file.
  - §15 item 30.8: the owner's review of vettid.org #174.

- **0.21.2** (2026-10-08): editorial, owner decision of 2026-10-08
  (VAULT-ITEMS 0.1.1).
  - §10.7: templates never suggest a reserved tag; the registry keeps
    contact information as one item per contact point (`contact_card`
    replaced by `email_address`, `phone_number`, `postal_address`,
    `website`). No message, limit or vault behaviour changes; `template`
    stays opaque to the vault, so items created with `contact_card` keep
    loading and editing.
  - §10.8: the shared profile holds only items the member tagged
    `@profile`.

- **0.21.1** (2026-10-08): editorial-normative, errata to 0.21.0 from
  its implementation (vettid-vault #47); owner decision of 2026-10-08
  (§15 item 29.7: "agreed, fix all 6").
  - §10.7: a dry run follows the access rule of the call it previews
    but never needs step-up; a desktop may dry-run `item.tag` of a
    critical item, and a dry run of `item.put` for a critical item is
    `forbidden` from a desktop; the critical forms are listed exactly
    (`item.tag` is not one).
  - §10.7: `item.put`'s dry run requires `version` together with
    `item_id`.
  - §10.7, §10.1: more than 64 fields is `bad_request` for every
    sensitivity, without a `limit` name; the unreachable separate
    critical 64-field limit is removed.
  - §10.7: a move to `critical` checks the size of the item as it will
    be stored, with `"sensitivity":"critical"`.
  - §10.13: `kind` may be absent for requests that arrived before
    0.21.0 (at most 24 h after the upgrade); receivers treat it as
    unknown.
  - §10.13: an incoming use is checked usable, then suitable, then
    against the per-connection pending cap.

- **0.21.0** (2026-10-08): normative, owner decisions of 2026-10-08
  (§15 item 29), from gaps found while implementing 0.20.0
  (vettid-vault #46) and the app's items, sharing and grants
  (vettid-android #78–#80); MEMBER-API 2.3.1.
  - §10.7: an `item.put` replacing an item of any sensitivity keeps
    the stored value of a field sent with its `field_id` and without
    `value` (same `kind`), and the stored notes with `keep_notes: true`,
    so a critical edit is one credential operation and a secret edit
    needs no reveal; `item.get` returns `size`; `item.put` and `item.tag` take
    `dry_run`, answering `{version?, shares, withdrawals}`; an item's
    size is its content encoding without `item_id`, `version`,
    `created_at`, `updated_at` and `field_id`s, with the exact string
    escapes; `file` stays reserved.
  - §10.1: every `limit` error has the body `{limit, max, size?}`,
    with a table of the limit names.
  - §10.12: `share.pending.list`; `share.decide{rule_id, include,
    decline}` in one change; `labels` on received grants in
    `grant.list`; `name`, `category` and `labels` on available `item`
    entries of `grant.pending` and of `grant.list`'s `pending`; the
    shape and states of `grant.list`'s `requested`.
  - §10.13: a field is suitable for a use only if it is a `password`,
    `text` or `multiline` field of an item that is not a wallet's;
    other requests are answered `unsuitable` at once;
    `critical-secret-use.pending`, `.list` and `.get` carry `kind`;
    the refusals at once are shown only in the audit log; at most 64
    outgoing requests (`limit`).
  - §10.9 (editorial): the 2,000-entry budget runs out at a 2,001st
    evaluated entry; `since` ≥ `until` in Unix milliseconds;
    `connection.audit.list` takes `after_seq`.
  - §11.13, §10.8: the snapshot `email` excludes C0, DEL, C1, U+2028
    and U+2029, and names exclude DEL too; MEMBER-API 2.3.1 refuses the
    same characters at registration.
  - §15 item 29.6: the owner's review of vettid.org #161.

- **0.20.0** (2026-10-07): normative, owner decisions of 2026-10-07
  (§15 item 28); MEMBER-API 2.3.0, ANDROID-PLAN 0.1.11.
  - §11.13: the account snapshot carries the member's full `email`
    (required, still `"v": 1`) instead of `email_hint`; the snapshot's
    size budget with the email; 0.15.0–0.19.0 vaults accept the new
    form unchanged, so the member API sends `email` only. The masked
    `email_hint` stays in the redeem and recovery-claim answers.
  - §11.13, §13.7, §10.2: the email is returned only by `account.get`,
    to the app and desktops; it never goes into a profile, an
    `hs.init`, an invitation, a feed item, an audit entry, a LEASH
    statement or a host event, and agents never receive it.
  - §10.9: `audit.list` and `connection.audit.list` take `q` (1–128
    bytes; a case-insensitive substring of the kind and the current
    names of the entry's connection, device and item; `strings.ToLower`,
    no normalisation), `since` and `until` (RFC 3339; inclusive,
    exclusive); with `q` at most 2,000 entries are evaluated per
    request, and a page the budget cut short carries `partial: true`
    and the cursor of the last evaluated entry; `bad_request` for a bad
    `q`, time or range.

- **0.19.0** (2026-10-07): normative, owner decisions of 2026-10-07
  (§15 item 27), and errata to 0.18.0, found while implementing it
  (vettid-vault #45); MEMBER-API 2.2.1.
  - §10.2, §3.6.3: `vault.status`'s `owner_check` carries `waiting`
    (`{messages, requests, calls, other}`, the `vault.held` counts)
    while the state is `due` or `held`, for the devices that receive
    `vault.held`; absent otherwise.
  - §3.6.3: the first count change after the hold starts is sent at
    once; later changes keep the at-most-once-per-10-minutes rule.
  - §3.6.5: apps never present unknown counts as zero and re-read
    `vault.status` when they return to the foreground while gated.
  - §10.8: `account.name.set` checks the names (step 3) before the
    blob, the PIN and the password (step 4), as `vault.owner-check`
    checks a hold change first (§3.6.7). Before, a `bad_request` for the
    names came after the CEK rotation and returned no `credential`, so
    the app lost the blob just sealed.
  - §11.13: `name_change.last.status` is `applied` or `refused`;
    `reason` (`too_soon`, `invalid`, `account`) only with `refused`; a
    vault refuses a snapshot with any other `status`.
  - §10.8, §10.4: a vault without names (which enrollment rules out)
    answers `connection.invite.accept` with `internal`, sends no
    `hs.init` and audits `profile.core_missing`, as for
    `profile.update`.
  - §10.8, §11.5 (normative addition): the vault emits `account_name`
    again with every `unlocked` report while its latest request is
    still `pending`, so that an event lost after the flush is
    recovered; the parent's `seq` condition makes it idempotent.
  - §10.8, MEMBER-API: names are trimmed of U+0020 only, at
    registration as in a name change.
  - §10.1, §10.2: `sync.event{account.changed}` for a name request
    alone repeats the stored snapshot's `version`; devices do not skip
    it.
  - §10.8 (owner decision, §15 item 27): the 196,608-byte limit is
    checked, when the display name, photo or `@profile` items change,
    with each name counted as its largest encoding (a 322-byte JSON
    string: 160 bytes, `"` and `\` escaped, quotes), so that a later
    name change can never bring an update over the limit, which
    receivers keep enforcing.

- **0.18.0** (2026-10-07): normative, owner decisions of 2026-10-07
  (§15 item 26). Connections always get the account's names and the
  vault's identity key; the member changes the names only in the app.
  - §11.13, §11.5: the account snapshot carries `first_name`,
    `last_name` and `name_change`, all required (still `"v": 1`; VettID
    has no vaults to stay compatible with); the `enroll` queue message
    carries the snapshot too (`bad_request` without it), so a vault
    always holds the names. The email address stays out of the snapshot
    and the profile.
  - §10.8: the shared profile is a read-only core (`first_name`,
    `last_name`, `ik`) plus the optional display name, photo and
    `@profile` items; `profile.get` returns the core, `profile.set`
    refuses it (`bad_request`). The vault never sends an update without
    the core (`profile.core_missing` as a defensive error); it re-sends
    the profile when the names change and, after an `ik` rotation, only
    after `identity.rotate` and in the epoch under the new `ik`.
    Receivers parse strictly, drop an update without the full core
    (`drop.profile_malformed`), ignore an earlier `ik` of the peer's
    chain and drop any other mismatch (`drop.profile_ik_mismatch`),
    title the connection "First Last" with the display name secondary,
    show "Name not shared yet" only between activation and the first
    update (when the request's names are not at hand), show the `ik`
    fingerprint (new, vector in §16), and never present the names as
    verified.
  - §10.8 (new): `account.name.set` (the holder; PIN and credential
    password as an owner check; `too_soon` within 30 days of the last
    applied change); the host event `account_name` (§11.5); the member
    API applies or refuses it and pushes the snapshot, whose
    `name_change.last` settles the request; `account.get` returns
    `name_request`. The portal shows the names read-only.
  - §6.2: a vault's `hs.init` profile is `{first_name, last_name,
    name?}`; §9.3, §10.4: the activation update and the `name` and
    `profile` of connections and requests; §10.1: `too_soon`; §10.9:
    the new audit and `drop.*` kinds; §2.2, §13.7: the names reach
    connections, and the host learns name requests.

- **0.17.0** (2026-10-06): normative, owner decisions of 2026-10-06
  (§15 item 25).
  - §6.7.1, §10.3: a transfer's `device.paired` carries the member's
    `user_guid`, from the vault's sealed header; the new app checks it
    and stores it as an enrolled app stores the redeem's, and its
    unlocks use it (§11.4). Without it a transferred phone could pair
    but not unlock. A `device.paired` without it (a release before
    0.17.0) still completes the transfer; the app warns.
  - §10.1, §3.6.1, §10.2: a `backoff` error response's body is
    `{retry_after}` (seconds until the backoff ends), as the unlock
    result's `retry_after`.
  - §11.12.2 (editorial): `nonce` and `sig` in `X-VettID-App` are
    base64url without padding.

- **0.16.1** (2026-10-06): editorial-normative, owner decision of
  2026-10-06. §11.11.9: `GET /api/vault/status` shows a pending
  start-over as `deletion: {deletion_id, state, deletes_at}`; the app's
  `POST /api/vault/deletion/cancel` names that `deletion_id`
  (MEMBER-API 2.1.1). Before, the app had no way to learn the id.
  Editorial: §11.11.2 states that the clear `recovery_unavailable`
  marks either sealed refusal (`no_backup` or `no_credential`), as
  vettid-vault #42 implements.

- **0.16.0** (2026-10-06): normative, owner decisions of 2026-10-06
  (§15 item 24). **No recovery with the credential backup off; start
  over instead.** Breaking for apps and the account site that offered
  the backup-off recovery path.
  - §11.11, §11.11.1–§11.11.3, §11.11.5, §11.11.7, §11.11.8: a recovery
    exists only when the vault keeps a backup copy of its credential.
    With the backup off the member API refuses the request (`409
    recovery_unavailable`, `reason: "no_backup"`); the enclave refuses
    it before locking the vault (`error: "no_backup"`, clear slot code
    `recovery_unavailable`, the recovery state `unavailable`), and
    refuses a register and the registered app's unlock (`no_backup`).
    Removed: the recovering app's `credential.reset` (§3.5.5, §10.6) and
    `vault.delete` (§10.2, §12.5), the error `credential_lost` (§10.1)
    and §11.11.5 step 4's "access only" recovery.
  - Found while checking what a recovering app sees before the password
    (§11.11.5): `vault.status` gave it the full body (devices,
    connections, owner check); it now gets `{vault_id, state_seq,
    header_seq}`. Its other pre-password inputs are the unlock result's
    `token`, release fields and `vault_bundle` (the vault's public keys
    and relay address, needed for the handshake) and UTKs. With the
    backup off, 0.15.2's path gave an app holding only the account, 24 h
    and the PIN the rest of the vault after `credential.reset`
    (messages, connections, profile, `data` and `secret` items, audit
    log, feed, location log); that path is gone.
  - §3.3, §11.5, §13.7, §2.2: the sealed header's `credential_backup`
    and the one content-free bit the vault reports to its host
    (`enrolled`, `unlocked`, `locked`, new event `credential_backup`);
    the vault row's `credential_backup`.
  - §11.11.9 (new): "Delete my vault and start over" from the portal:
    24 h, emails, cancel from the portal, the email link or the app;
    then the host's `delete` (§12.5); then a new vault with a setup
    code. §12.5 lists it as a host authority.
  - §3.5.6: the vault "has a backup copy" defined; the warning before
    turning the backup off says a lost or replaced phone cannot be
    recovered and everything in the vault is lost. §2 out-of-scope,
    §3.5.9, §3.6.1, §3.6.3, §11.4 (`no_backup`; `credential_backup`
    always true for a registered app), §13.5 rows updated.
  - §12.5: noncurrent stored versions remain for 7 days (VAULT-RELEASES
    §11.4).
  - §15 item 24; items 13.1 and 13.8 marked superseded.

- **0.15.2** (2026-10-06): editorial-normative, owner decisions of
  2026-10-06. Makes 0.13.0 consistent with §5.3, and removes
  `credential.delete` (normative; breaking for apps that offered it).
  - §3.6.1, §10, §10.2 and every mention: the owner check's type is
    **`vault.owner-check`**. 0.13.0–0.15.1 wrote `vault.owner_check`,
    which §5.3's type grammar `[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*`
    forbids and receivers reject; vettid-vault implements the hyphen.
    Not renamed, not being message types (§5.3's grammar covers only the
    `type` field; error codes allow `_` by §5.3): the settings keys `owner_check.interval_seconds`,
    `owner_check.hold` and `owner_check.hold_off_until`; the error code
    `owner_check_required`; the audit and feed kinds `owner_check.*` and
    `drop.owner_check`; `sync.event{kind: "owner_check"}`;
    `vault.locking{reason: "owner_check"}`; the `owner_check` member of
    `vault.status`.
  - **Normative: `credential.delete` removed** (owner decision of
    2026-10-06; §15 item 23). A credential is deleted only as the first
    step of `vault.delete` (§12.5, unchanged). A member who wants a new
    credential uses `credential.reset`, which deletes and creates in one
    operation and one flush. The holder may now send it:
    `credential.reset{credential, utk_id, sealed{pin, password,
    new_password}}`, verified like an owner check (failed entries count
    as failed checks) and refused while held; the recovering app's form
    is unchanged. Removed with it: the `credential.deleted` sync and
    audit kinds. Updated: §3.2 (CEK lifetime), §3.5.3 (unlock window),
    §3.5.5, §3.5.7, §3.5.9 (holder types), §10 registry, §10.1, §10.6,
    §10.7, §10.9, §10.18 (wallet), §11.11.5.
  - §3.6.1, §3.5.7: a vault without a credential exists only during
    enrollment (owner decision: "we shouldn't have a vault without a
    credential except during enrollment") and is not gated by the owner
    check; the first `credential.create` starts the clock and
    `credential.reset` (the holder's, or after a backup-off recovery)
    starts it fresh, as do recovery and transfer as before.
  - §11.11.2: with 0.15.0's `api` the recovery QR for a 32-hex
    `vault_id` is 181 bytes, QR version 10 (57 × 57) at level M, up
    from version 8.
  - §16: the QR payload of `recovery.json` predates `api`; the 0.15.0
    form is `recovery_qr` in vettid-vault `testdata/vectors/appkey.json`
    (164 B), excerpted.
  - §11.13: a suspended account gets no snapshot (`account_status` is
    `active` or `canceled` only); MEMBER-API 2.0.1.
- **0.15.1** (2026-10-06): editorial, from the staging recovery test of
  2026-10-06 (W9; vettid-android #66). No wire, enclave or member API
  change.
  - §6.7.1: the "refused relay key" is named: `403 token_revoked`
    (RELAY-PROTOCOL §5.3 step 6, §7.1) on a deposit to the device's own
    vault mailbox, the device's relay key being a `sub` on the vault's
    denylist; the same for the old app of a recovery.
  - §8.6: an owner device that gets `token_revoked` from its own vault's
    mailbox stops sending, counts it toward the erase offer of §6.7.1,
    never erases on it alone and keeps collecting; a device SHOULD ack a
    vault message even when its answer is refused, so a refused answer
    cannot block reading a queued `device.unlinked`.
- **0.15.0** (2026-10-06): the app and the account portal are separate
  (owner decision of 2026-10-05; approved 2026-10-06; ENROLLMENT-CODES.md;
  §15 item 20). Breaking for apps and the member API. Drafted as 0.11.0
  (vettid.org PR #122) and renumbered after 0.14.0 at merge; the "open
  0.11.0" that the 0.12.0 and 0.13.0 entries mention is this release,
  and §15 keeps the item number 20 that 0.13.0 left for it.
  - §11.12 (new): the portal-issued setup code (one issuance per member,
    5 minutes, single use, MACs at rest: a 128-bit QR secret, QR `t: "e"`
    with `api`, and an 8-symbol code typed with the member's email and
    compared with that member's issuance only; 800 typed attempts per
    issuance; no global limit; no account oracle), its redeem, and the app key: a per-app
    P-256 key whose signature (`X-VettID-App`) authorizes every app
    request to the member API, with the matrix of keys and routes.
  - §11.13 (new): the account snapshot, in every unlock message and the
    new queue op `account`; kept in vault state; `account.get` and
    `sync.event{account.changed}`; display only.
  - §11.1: apps hold no member session; enrollment needs the current
    terms at code issue; later requests need an active account only.
  - §11.3: `app.api_key` in `vault.enroll`, bound to the queue's
    `app_key`; `user_guid` from the redeem.
  - §11.5: `app_key` and `account` in the queue message; the key on
    `enrolled`, `unlocked` and `locked` and the event `app_key`; the
    parent writes it whatever the lease, by sequence.
  - §11.6, §11.8: a session cannot submit an unlock; replay of signed
    requests; code limits.
  - §11.11: the recovery QR's `api`; `app.api_key` in the register;
    `POST /api/vault/recovery/claim`; claim and recovering keys; the
    recovered app's key reported at completion.
  - §6.2, §6.7.1: `api_key` in a transfer's `hs.init`; reported at the
    approval.
  - §2.2, §10, §10.1, §10.2, §13.5, §13.7: what the API learns;
    `account.get`; `account.changed`; threats; what the vault reports to
    and accepts from its host.
  - With the daily owner check (0.13.0, §3.6): enrollment by setup code
    starts the clock at the enrollment's first `credential.create`, as
    any enrollment does (§3.6, §11.12); `account.get` is not on the
    hold's allow list and `sync.event{account.changed}` waits for the
    check like other fan-out, while the queue op `account` is still
    stored (§11.13); §15 item 22's note on 0.11.0 updated.
  - With the member API's vault service pause (MEMBER-API 1.2.0): code
    issue, redeem and recovery `claim` are refused like `enroll` (§11.12.1,
    MEMBER-API 2.0.0).
- **0.14.0** (2026-10-06): the canary manifest (owner decisions of
  2026-10-06; VAULT-RELEASES 0.1.6 §10.1; vettid-android #63). Normative
  for apps that accept one; no wire, enclave or member API change.
  - §11.10.1: "How apps learn the manifest" names its one exception; the
    new item "A canary manifest": delivery as a shared file (release
    builds too), installation (pinned keys of this build, strict format,
    not below the phone's highest serial, not already published, the
    member's confirmation, encrypted storage, erased by the wipe,
    removable by the member), and the selection rule (higher serial wins,
    the published one on a tie, the canary on a 404, removed once
    published, a canary that no longer verifies ignored, a failing
    published manifest never masked); a used canary serial raises the
    phone's floor.
  - §11.10.6: the unlock uses the manifest the selection rule chooses.
  - §13.9 (new): what a canary manifest can and cannot do; the accepted
    risk of a leaked document (a self-inflicted move into an unpublished
    release, 410 until published); a canary-only build as later hardening.
- **0.13.1** (2026-10-06): editorial. Front matter: RELAY-PROTOCOL 0.6.0
  (was 0.5.0). §1.2: the relay features are 0.6.0's and include the web
  endpoints (§6.11) that §6.4's invitation URL uses. §15: item 7 is the
  HTTP action only, with revocation status recorded as resolved (item
  21); item 21 records the vettid-vault follow-up as done (#38).
- **0.13.0** (2026-10-06): the daily owner check (owner decisions of
  2026-10-05 and 2026-10-06; §15 item 22). Independent of the open
  0.11.0 (PR #122).
  - §3.6.3: the app gate, past the deadline whatever the hold switch
    says; `vault.status` `state: "due"`.
  - §3.6.7 (new): the member's hold switch, `owner_check.hold` and
    `owner_check.hold_off_until`; off only within a successful check,
    on at any time; with it off only the app is gated; `owner_check.hold_changed`; `hold` and
    `hold_off_until` in `vault.status`, the check's payload and answer
    (§3.5.4, §10.2, §10.6, §10.8, §10.9, §10.11, §13.5, §13.8).
  - §3.6 (new): `vault.owner-check{credential, utk_id, sealed{pin,
    password}}`, a credential operation; the record `{last_at, deadline,
    failures}` in DEK state; what starts the clock; the interval; the
    hold (what keeps running, what stops, the owner devices' allow
    list, `vault.held`); the ten-failure lock; what the apps do; the
    copied-blob benefit.
  - §1, §1.1 item 9; §2.2: what the hold shows, and to whom; §3.3: the
    record in vault state; §3.5.3: the unlock window ends at a hold, a
    wrong password in a check counts; §3.5.8, §3.5.9: the check and the
    clone alarm.
  - §6.7.1: a transfer's approval is a check; `device.transfer.create`
    waits for one while held; §6.8: access sessions suspended; §9.1:
    fan-out while held.
  - §10: `vault.owner-check`, `vault.held`; §10.1: `owner_check_required`
    and the `owner_check` sync kind; §10.2: the bodies, `owner_check` in
    `vault.status`, `vault.locking{reason: "owner_check"}`; §10.6: the
    check is the holder's; §10.8: `owner_check.interval_seconds`; §10.9:
    `owner_check.*` audit and feed kinds, `drop.owner_check`; §10.10:
    no ringing while held; §10.11: no status statements while held;
    §10.17: no pongs while held.
  - §11.11.5: recovery is not held, and its completion starts the clock.
  - §12.1, §12.3: held is not locked; the ten-failure lock trigger.
  - §13.5: rows for a device in other hands and a thief with both
    secrets; §13.7: nothing new to the host; §13.8 (new).
  - §15: item 22. §16: no new vectors (no new cryptography).
- **0.12.0** (2026-10-05): LEASH delegations and status statements in
  the LEASH paper's §3.5 format (owner decision of 2026-10-05; §15
  item 21). Independent of the open 0.11.0 (enrollment codes, vettid.org
  PR #122), which touches no LEASH text.
  - §10.11: the delegation's members are the paper's: `iss` (the
    credential key, formerly `key` beside it), `sub` (formerly
    `agent_ik`), `status_issuer` (formerly `vault_ik`), `scope` as an
    object (`op`, `connections`, `tags`, `match`, `access`, `uses`,
    formerly top-level), `limits` (`per_hour`, `per_day`, now for every
    grant that has limits), a new 128-bit `nonce`; `grant_id`,
    `version`, `approval`, `status_ttl`, `iat`, `exp` unchanged. The
    delegation and the status statement are RFC 8785 (JCS) rather than a
    fixed member order. Context strings `leash/v1/delegation` and
    `leash/v1/status` replace `vettid/vms/2/leash` and
    `vettid/vms/2/leash-status`. The verifier's checks are the paper's
    seven, in its order, with the rotation chain as a VettID binding,
    and without the old `iat` check. The revocation latency bound is
    stated as the paper states it. The grant object carries `sig`
    (formerly `delegation_sig`) and no `key`. The mapping table uses the
    paper's dotted MCP tool names.
  - §4.1: the `leash/v1/*` labels are the one exception to suite-numbered
    labels.
  - §13.5: the bound names its 60 s skew.
  - §15: item 7 no longer lists revocation status as open; item 21.
  - §16: `leash.json`.
- **0.10.8** (2026-10-05): editorial. §6.7.1: a replaced app erases its local
  state on `device.unlinked`; a refused relay key alone only offers an erase.
- **0.10.7** (2026-10-05): editorial. §11.4 shows `credential_backup` in
  the unlock result's ok body, after `vault_bundle`; §16 adds `recovery.json`.
- **0.10.6** (2026-10-05): recovery and lock-state gaps, and the wording
  of 0.10.5 (§15 item 19).
  - §6.4: a decline always goes on the request token the peer issued,
    which the vault keeps until the request ends, even after the peer's
    `connection.approved` gave it a standing token; never on the
    standing token.
  - §6.4 "After activation", §10.9: the audit and feed `ref` of a
    decline that reaches an active connection is the `connection_id`.
  - §11.5: a vault that stops is written `locked` when its lease is
    released, whether or not its `locked` event arrived; the member API
    reports `unlocked` only under a live lease. The enclave's answer to
    a successful `recovery_register` carries the clear marker
    `recovery_registered`, which the host copies into the slot's `code`
    (the one host code that reflects a sealed outcome).
  - §11.11.2: the QR is byte mode, error correction M or higher, with a
    4-module quiet zone; the app accepts any version.
  - §11.11.3: the marker on a successful register.
  - §11.11.7: `Recovery` gains `vault_id` and the state `registered` (no
    `sealed_code` after it); both cancel routes answer `{cancelled}`.
  - §15 item 18 Compatibility: on S2 receivers, after their member's
    approval, the decline stays unacked and is redelivered at each relay
    lease until the request expires.
  - §11.11.5 step 1: a registered app's unlock result carries
    `credential_backup`.
  - §6.7.1 step 2 and failures: the new app stops waiting for `hs.resp`
    after 60 s and says the code may have been used or the phone could
    not be verified.
  - §11.11.7: `{recovery: null}` without an enrolled vault.
  - §15 item 19: follow-ups and owner decisions (pending; decision 6,
    `attempts_left`, recommended for a later revision).

- **0.10.5** (2026-10-05): declines are sent (owner decision of
  2026-10-05, reversing 0.10.2 decision 2; §15 item 18).
  - §6.4: on its member's decline (or a block of a pending request) a
    vault sends `connection.declined{}` under the handshake's epoch on the
    request token the peer issued, then drops the request; when it can
    be sent (not by an accepter in `waiting`, nor for an `hs.init`
    without `hs.fin`); what the receiver does (ends the request,
    `peer_declined`, `failed` with `reason: "declined"` on the
    accepter's side, denylisting, audit and feed); late, duplicate and
    crossing declines; one reaching an active connection removes it; why
    it cannot be forged; what apps show.
  - §7.1: `connection.declined` may be deposited on a request token,
    also after activation.
  - §7.4: the decline is sent first in the flush that ends the request.
  - §9.2: silent refusals stay the rule; connection-request declines are
    the one exception.
  - §10, §10.4: the `connection.declined` type; `reason` in
    `connection.event{failed}`; a block sends it.
  - §10.1: the `peer_declined` state of the `connection.request` sync
    kind.
  - §10.9: the `connection.request.peer_declined` audit and feed kinds.
  - §13.5: what a link holder learns from a decline.
  - §6.7, §6.7.1, §7.1, §7.4, §10, §10.3: the owner's rejection of a
    pairing or transfer after its `hs.fin` is sent to the new device as
    `device.pair.rejected{}` (one type for both), under the handshake's
    epoch on the token the device issued in `hs.init`, as `device.paired`
    travels; when it is and is not sent; the device stops waiting and
    shows "Rejected on your phone"; late and duplicate copies; why it
    cannot be forged (owner decision of 2026-10-05, "include
    `device.pair.rejected`").
  - §15: item 16 decision 2 and item 17 decision 4 superseded; item 18
    (follow-ups, compatibility, owner decisions, all approved
    2026-10-05).

- **0.10.4** (2026-10-04): what the vault implementation of 0.10.3
  settled (vettid-vault PR #26).
  - §6.4, §7.4: a request that ends without activation denylists every
    token the vault issued to the peer, including the standing and
    reconnect tokens of a `connection.approved` it already sent.
  - §6.4, §10.4: `connection.decline` is accepted in any state, `waiting`
    included; the member's own decline of an outgoing request sends no
    `connection.event{failed}` (the other devices get
    `sync.event{connection.request, declined}`); a `connection.approved`
    that arrives once the connection is active is ignored.
  - §6.7, §6.7.1: a pairing's or transfer's 10 minutes for approval count
    from the new device's `hs.init`; the new device waits for
    `device.paired` until then.
  - §7.1: `relay.token.refresh` on a request token is answered
    `forbidden` once the connection or device is active, and handled as
    any message before activation until then.
  - §10.3: every `device.paired` carries a standing token (a fresh one
    after enrollment or recovery); the stale `device.transfer.reject`
    row is corrected.
  - §15 item 17: vettid-vault done; the compat harness follow-up.
  - §16: the 0.10.3 handshake vector values (`th1`, `th`, `k_i2r`,
    `k_r2i`, the kids, `rk`, `epoch_id`, `sas` 564218), the dropped
    `reconnect_token` and the order of the scripted randomness.

- **0.10.3** (2026-10-04): the SAS commitment (§15 item 17).
  - §6.1, §6.2, §6.3: `sas_commit` in `hs.init`, `sas_nonce` (`n_R`) in
    `hs.resp`, `sas_nonce` (`n_I`) in `hs.fin`, for purposes `app`,
    `desktop`, `agent` and `connection`; `sas` =
    HKDF-Expand(`prk`, label || `th` || `n_I` || `n_R`) mod 10^6; the
    responder checks the commitment at `hs.fin` (a mismatch aborts,
    `drop.sas_commit_mismatch`); the initiator processes one `hs.resp`
    per `hs.init`; an epoch is established at `hs.fin` and activated at
    approval; why a party in the middle succeeds with about 10^-6.
  - §6.4: the handshake runs before approval (`hs.resp` and `hs.fin` at
    once); the accept answers `state: "waiting"` without `sas`, which
    follows in `connection.request.outgoing` on every device; the
    inviter is told only after `hs.fin`; `connection.approved` in each
    direction, activation with both approvals; what an unapproved party
    holds; in-person auto-approval still shows the code; expiry and
    retention restated.
  - §6.5: a first epoch counts from activation.
  - §6.6, §7.1, §7.4: request tokens (8 messages / 64 KiB) in the
    connection handshake and in `hs.resp` of a pairing that needs
    approval; standing and reconnect tokens in `connection.approved`
    and `device.paired`; the request token is denylisted when a request
    or pairing ends without activation.
  - §6.7, §6.7.1, §10.3: pairing and transfer: `hs.resp` at once, the SAS
    after `hs.fin`, activation at the approval; a transfer completes at
    its approval (`{}` instead of `{exp}`), `transfer_pending` retired
    (§3.5.3, §10.1, §10.6).
  - §10, §10.1, §10.4: `connection.approved` (V↔V); `state` in
    `connection.request.pending`; `connection.request.list` states and
    `peer_approved`; the `peer_approved` sync state; the accept
    response.
  - §10.15, §13.5: the introduction diagram; threat rows for a remote
    link and the introducer.
  - §15 item 17 resolved, with owner decisions; §16: new handshake vector
    inputs (`n_I`, `n_R`, `sas_commit`), values to be regenerated.

- **0.10.2** (2026-10-04): connection requests, from the Android A4
  build (vettid-android).
  - §6.3, §6.4: both members see the SAS: the accepting vault returns it
    in the `connection.invite.accept` response. Each side approves its
    own request after comparing; the accepting vault holds `hs.fin` (and
    stores an early `hs.resp`) until its member approves; in-person
    auto-approval skips only the inviter's approval.
  - §6.4: an accepting vault already connected to the inviter (or with
    an outgoing request to it) answers `exists{connection_id}` before any
    `hs.init`; the inviter's drop of an `hs.init` from a known peer
    (sender or `from.ik`) is specified; outgoing requests expire after
    8 days with `connection.event{failed}`; retention of incoming
    requests after approval (16 days).
  - §6.4: the invitation URL `<relay>/connect#<link>` on the
    invitation's own relay, the relay's `/connect` page rules, App Links
    and the `vettid:` fallback; QR codes unchanged; apps accept every
    form and pass the bare payload.
  - §10, §10.1, §10.4: `connection.request.list`,
    `connection.request.outgoing`, `connection.approve` / `.decline` with
    `{connection_id}` for an outgoing request, `exp` and `introduced_by`
    in `connection.request.pending`, `pending_id` in
    `connection.event{added}`, the `connection.request` sync kind,
    `exists` for `connection.invite.accept`.
  - §10.13: `critical-secret-use.get` (an incoming request with its
    payload); the app checks the payload against `payload_sha256`;
    `payload`'s 4,096 bytes are before base64.
  - §10.15: the introduced party approves its outgoing request with the
    SAS.
  - §15 items 16 (follow-ups and owner decisions) and 17 (SAS strength).

- **0.10.0** (2026-10-04): the V5 release model (VAULT-RELEASES 0.1.0,
  owner decisions of 2026-10-04, R1–R4, O1–O10).
  - §11.1, §11.3, §11.4, §11.5, §11.10.1, §11.10.4: manifest by hash
    (O10). Enroll and unlock requests carry `manifest_sha256` and
    `manifest_serial` instead of the served document; the request bodies
    and the queue message carry `manifest_sha256` in the clear; the
    publish step writes the served document to
    `manifests/<manifest_sha256>.json` in the vault data bucket first;
    the parent forwards it with the message; the enclave checks presence,
    format, hash, signature, serial match and rollback, else `manifest`.
    The unlock signing string is unchanged.
  - §11.10.1: manifest bytes up to 65,536 (was 4,096); served document up
    to 90,112 bytes; status `removed`; optional `ends_at`; the four
    statuses are fixed; a `removed` release stays listed while a live key
    admits it.
  - §11.10.2, §11.10.5, §11.10.6, §11.9: admitted releases are those not
    `removed`; a release is kept until its `ends_at`; `removed` answers
    `410 release_unavailable`; rescue; what apps show.
  - §11.10.7: the pinned retirement principal and window; retirement
    statements (`ScheduleKeyDeletion` with `NumericEquals` on the pinned
    window, `CancelKeyDeletion`, `EnableKey`); checks 2, 6, 7 and 8; the
    example policy and nine must-fail variants.
  - §11.10.8 (new): channels and per-channel release constants.
  - §13.2: unchanged by manifest by hash. §13.5: the retirement
    principal row, ending a release after notice, availability versus
    confidentiality. §15 items 14–15, §16.

- **0.9.1** (2026-10-04): vault deletion deletes the relay mailbox (owner
  decision of 2026-10-04).
  - §1.2: RELAY-PROTOCOL 0.5.0; mailbox deletion (§6.10).
  - §12.5: step 2 deletes the vault's relay mailbox (`DELETE
    /v1/mailbox`) after the marking flush and before the drain; on
    success the queued revocations and claim deletions are dropped (moot);
    on failure (a relay before 0.5.0, an unreachable relay) they remain the
    fallback. Why this order, and where the mailbox can remain (a crash
    between steps 1 and 2, an old or unreachable relay, a locked vault the
    host erases).
  - §15 item 12: resolved.

- **0.9.0** (2026-10-03): one app per vault (owner decisions of
  2026-10-03, PROTEAN-CREDENTIAL §4).
  - §1.1 item 8, §3.1, §6.7: a vault has exactly one app, the holder of
    the credential; apps are bound only at enrollment, by a transfer or by
    a recovery; `device.pair.create{role: "app"}` answers `one_app`; any
    other app `hs.init` is dropped (`drop.one_app`). Desktops and agents
    are unchanged.
  - §3.5.3, §3.5.5, §3.5.9 (new): the holder; only it sends blob-carrying
    types; the clone rule (only the holder's retry with the previous,
    unconfirmed version is `stale_credential`); on a clone: refusal
    (`credential_frozen`), alarm, urgent `credential.alarm` to the app,
    feed item, audit, host alarm; freeze of credential operations while
    messaging continues; `credential.alarm.confirm`; forced
    `credential.rotate` (state `rotation_required`).
  - §3.5.6: no off-device copy and no export of the credential; losing
    the phone with the backup off loses the credential and every critical
    item; the app MUST warn before turning the backup off.
  - §6.4, §6.7.1 (new), §10.3: direct transfer to a new phone
    (`device.transfer.create`, `.pending`, `.approve` with PIN and
    password, `.reject`; CEK rotated at approval; one flush at `hs.fin`
    moving the holder and removing the old app; failure and abort cases).
  - §11.11, §11.11.5, §11.11.8: the recovered app replaces the old app
    (removed, keys revoked; desktops and agents kept); `credential.recover`
    without the member-supplied blob; backup off: `credential_lost`, then
    `credential.reset` or `vault.delete`; with the backup off the recovery
    restores access only and returns no credential content.
  - §11.5: the lifecycle event `alarm.credential_clone` and the vault-row
    `alarm` and `alarm_pending`; MEMBER-API emails the member. The
    `deleted` event also records a `vault_deleted` notice.
  - §10.2, §12.5 (new): `vault.delete` from the holder (phrase, PIN,
    password; refused during an alarm), a recovering app (PIN, and the
    password when the vault keeps the blob) or the enrolling app before a
    credential exists (PIN), and the host's `delete`: mark, notify and
    revoke, drain, zeroize, erase (own header last), report; any later
    touch of a marked header finishes it. The relay mailbox cannot be
    deleted (RELAY-PROTOCOL 0.4.0): everything is denylisted; a relay
    route is recommended (§15).
  - §3.5.9, §13.7 (new): a holderless vault never adopts an app; a vault
    reports only to its owner's devices, its host (content-free events)
    and, as the member's features decide, its connections.
  - §11.7: `SelfSigned` accepted with a GrapheneOS verified boot key pinned
    in the release (deviceLocked still required); `Unverified` and
    `Failed` refused.
  - §10.1: `one_app`, `credential_frozen`, `rotation_required`,
    `credential_lost`, `transfer_pending`; `sync.event` kinds
    `credential.alarm`, `device.transferred`, `device.transfer`. §10.6:
    `credential.alarm`, `.alarm.confirm`, `.reset`, the holder-only types,
    `alarm` in `credential.version`. §10.9: audit and feed kinds. §13.5:
    rows for clones, transfers, backup-off recovery, the host and
    GrapheneOS. §15: follow-ups 12 and 13 (owner decisions).
- **0.8.0** (2026-10-03): V4 batch 4 (vettid-vault): location, presence
  and the wallet.
  - §10.16 (new): location shares with one connection: `once` or
    `continuous` (5 minutes to 7 days, cadence 10 s–1 h), precision
    `approximate` (the default), `exact` or `city` applied by the sending
    vault,
    positions ephemeral and forwarded from memory (never in the sender's
    state), kept by the receiver only while the share is active (trail
    only if allowed), either side stops, `location.request`; limits,
    audit and feed kinds. The member's own location log (owner
    decision): opt-in settings, recording from the devices' positions at
    the member's cadence, retention, thinning and a 5,000-position cap,
    owner devices only, deletion, snapshots through a share
    (`location.history.*`, `location.snapshot`), no export.
  - §9.2, §10.17 (new): presence: `presence.query` → `ping` → `pong` →
    `presence.result`, the policy (`state`, `share`, `except`), one ping
    and one answer per peer per minute; a refusal is silence (0.7.0
    answered `unknown`); ping and pong are events, not a request.
  - §10.18 (new): wallets: a BIP86 (P2TR key path, BIP340) and a BIP84
    (P2WPKH) account per BIP39 phrase kept as a critical item, P2TR
    receiving by default, the app choosing the receiving account of an
    imported phrase (`address_type`, `wallet.update`) (generated or imported; owned by the wallet:
    `item.put`/`item.sensitivity` `in_use`; `item.delete` deletes the
    wallet); addresses from the account key; the PSBT signing policy
    (own inputs and change of either account re-derived, taproot
    derivations and the BIP86 tweak checked, no script paths, previous
    transactions required for every input,
    standard outputs of the network, fee cap); spending as a credential
    operation bound to the wallet and the PSBT's hash, in the unlock
    window; the app as the chain source (owner decision); history;
    `mainnet`, `testnet`, `signet` (`regtest` in development builds).
  - §10.14: catalog version 3: `wallet.request-address` (`network` in the
    result) and `wallet.request-payment` (`address` added; approval is
    the spend; result `{status: "signed", txid}`) run on the configured
    wallet.
  - §10.1: `invalid_psbt`, `unavailable`; `in_use` for a wallet's item;
    `sync.event` kinds `location.share.changed`, `location.history.changed`, `presence.changed`,
    `wallet.changed`, `wallet.signed`, `wallet.deleted`. §10.9: audit and
    feed kinds. §10 registry: the wallet, location and presence rows
    (the placeholders `wallet.address.share` and `wallet.payment.request`
    are dropped: the wallet actions replace them). §6.8: step-up for
    `location.share.start`, `location.history.*` and `presence.set`.
    §10.8: `location.history.*` settings. §7.3, §8.5:
    `location.update` and the presence events are ephemeral. §3.5.2:
    `crypto_keys` stays empty. §3.5.4: the wallet's payload members.
    §10.11: no location, presence or wallet type is delegable. §12.2: no
    chain egress. §13.5: location, location log, presence and wallet
    rows. §15: follow-up 11.
- **0.7.0** (2026-10-03): V4 items (vettid-vault): one item model with
  tags and share rules (VAULT-ITEMS, owner decisions 1–5 of 2026-10-03).
  - §10.7 (new): items: name, category (recommended list), template,
    typed fields (`text`, `multiline`, `number`, `date`, `email`, `phone`,
    `url`, `password`, `otp`, `address`; `file` reserved) with vault
    assigned, never reused field ids, notes, tags and a sensitivity per
    item (`data`, `secret`, `critical`); `item.put`, `.get`, `.reveal`,
    `.list` (filters by tags, category and sensitivity; paged), `.tag`,
    `.sensitivity`, `.delete`; limits (64 fields, 16 KiB per value, 64 KiB
    per item, 2,000 items; critical: 12 KiB per item, 1,000 items);
    `secret` values only revealed on purpose (audited); critical items
    envelope-encrypted (values in DEK state under per-item keys that only
    the credential holds, re-keyed at every use of the item and at
    `credential.rotate` and `.recover`); critical operations are
    credential operations with the content and the item id sealed to a
    UTK and values returned sealed to a reply key; moves to and from `critical` done by the vault without values
    crossing the session; app-only forms refused to desktops at once.
    Replaces §10.7 secrets and `credential.secret.*`.
  - §10.8: tags (normalisation, one namespace, reserved `@profile`, never
    sent to connections), the tag registry (`tag.list`, `.set`, `.delete`,
    `.merge`, with `dry_run`); the profile is a display name and photo
    plus the `data` items tagged `@profile` (at most 32), sent in
    `profile.update` with its own counter; profile fields, `shared` and
    `order` removed.
  - §10.12: share rules (`share.rule.set`, `.list`, `.delete`,
    `share.pending`, `share.decide`) for a connection or an agent: tags
    with `any` or `all`, `read` access, `ask` (default) or `auto`, uses,
    expiry, `include_existing` with a preview; inclusion, gains, remembered
    declines, withdrawal on tag removal, rule change, deletion or expiry;
    readable inclusions are grants (`rule_id`, no use limit or expiry
    unless the rule has one) announced by `data.shared`; grants of items
    with optional field lists; one-off requests by item or by category,
    answered by the member; descriptors carry name, category and labels,
    never tags; per-connection catalogs (granted and usable items).
    Replaces the `cataloged` flag and the one catalog for everyone.
  - §10.11: the data scopes (`secrets.catalog`, `.get`, `.use`) become an
    agent's share rules (scope `items.read`, signed delegations carrying
    the rule's tags, match, access, uses and rate limits; owner
    decisions of 2026-10-03: reads of included items within the rule's
    limits; tags in the delegation); `agent.request` ops `catalog`, `item.get`,
    `item.use`; audit kinds `leash.item.read`, `leash.item.used`.
  - §10.13: critical-item use names `item_id` and `field_id` and needs a
    rule that makes the item usable for that connection;
    `credential.secret.catalog` removed.
  - §10.14: catalog version 2: `items.share` replaces
    `profile.fields.read` and `secrets.share`; configurations bound by
    `items`.
  - §3.3, §3.5, §3.5.2, §3.5.4, §6.8 (step-up types), §8.2, §10 registry,
    §10.1 (`in_use`, ids, `sync.event` kinds `item.*`, `tag.changed`,
    `share.*`), §10.6, §10.9 (audit and feed kinds), §13.5 (share-rule
    and tag-change rows, a critical item key), §15 (follow-ups 8–10;
    9 resolved by envelope encryption).

- **0.6.0** (2026-10-03): V4 batch 3 (vettid-vault): LEASH, grants,
  critical-secret use, shared actions.
  - §10.11 (new): LEASH for the member's agents, mapped onto pairing,
    access sessions and approvals: grants per agent with a scope (three
    LEASH operations and nine delegable owner types), `ask` or `auto`
    approval, restrictions to connections or secrets, hourly and daily
    limits that fall back to referral, and expiry; the decision (allow,
    refer, refuse) behind §6.8's hook; `agent.request` for the catalog,
    retrieval and HMAC use of cataloged secrets; `leash.grant.issue`,
    `.revoke`, `.list`, `.updated`, `leash.agent.resume`; every grant is
    a delegation signed by the credential key, with short-lived status
    statements signed by the vault's `ik` ("stapling": a 15-minute
    default lifetime, at most an hour, none for revoked or suspended
    grants or from a locked vault, the `ik` rotation chain carried,
    normative offline verification for relying parties) (issuing and pairing with
    grants need an app within the unlock window; lifetime and revocation
    from LEASH §3.2 and §3.4); per-agent refusal cooldowns (1 s doubling
    to 5 min), at most 20 referrals an hour, suspension after 30
    refusals in an hour until an app resumes the agent; per-agent hourly
    audit summaries of allowed, refused, throttled, read and used
    events.
  - §6.7, §10.3: `device.pair.approve{grants}` carries an agent's initial
    grants. §6.8: `agent.request` goes through the policy; a referred
    request runs on approval only while a grant covers it; `grant.decide`
    `action.configure`, `intro.create` and `intro.accept` are step-up
    types. §9.1: agents get no fan-out.
  - §10.12 (new): grants of profile fields (the per-connection profile
    overrides deferred in 0.4.0) and cataloged vault-held secrets: ask,
    decide, fetch with uses and expiry, revoke from either side; values
    sealed to a one-time key of the fetching device; the catalog.
  - §10.13 (new): critical-secret use: a connection asks, the member
    consents with the password for each use (UTK payload bound to the
    request and the payload's hash), the CEK rotates, only a signature
    (`sign` or the domain-separated `auth`) leaves the vault;
    `credential.secret.catalog`. §3.5.4: the payload members.
  - §10.14 (new): shared actions as a built-in catalog run by the vault
    (`profile.fields.read` and `secrets.share` through one-use grants,
    `audit.recent`, `wallet.request-address`, `wallet.request-payment`
    defined and `unavailable` until the wallet), permission modes per
    action (`default-deny`, `allowlist`, `prompt-each-time`,
    `default-allow`; none for sensitive, critical only with an app in the
    unlock window), offers, invocations, results and limits, without the
    vettid.dev mis-routing (owner decision 2026-10-03).
  - §10.15 (new): introductions started only by the member: both parties
    accept, then the first makes an invitation bound to the other's `ik`
    that the introducer relays; the parties approve each other as usual.
  - §10: flows between vaults are events correlated by ids (the registry's
    V↔V `req` entries for actions and grants are gone); registry rows.
    §10.7: `discoverability` takes effect. §10.1: `sync.event` kinds;
    `forbidden` and `credential_locked` uses. §10.9: audit and feed kinds.
    §13.5: agent, delegation, grant, critical-use and action rows. §15:
    schemas; follow-up 7.

- **0.5.0** (2026-10-03): V4 batch 2 (vettid-vault): connections polish,
  calls, device and agent sessions.
  - §6.8 (new): access sessions for desktops and agents, requested by the
    device and granted by an app (or with the pairing approval); step-up
    types a desktop sends only with an app's approval; the LEASH hook for
    agents (allow, refer to an app, refuse; never app-only types);
    approvals (`approval.pending`, `.waiting`, `.decide`), expiry and
    ending. Replaces `agent.approval.pending` / `.decide` in the registry;
    `agent.request` is reserved for LEASH.
  - §9.1: fan-out reaches desktops only within their access session.
  - §10.4: `connection.update` (the owner's alias, note, tags, favorite,
    archived; versioned, never sent to the peer); `created_at` and
    `last_active_at` in listings; the block list (`block.add` of a
    connection or a pending request, `block.remove`, `block.list`) and its
    refusal of blocked identities; member authentication
    (`connection.authenticate.*`), signed with the member's credential key
    within the unlock window, pinned by the requester.
  - §10.10 (new): call signalling: `call.start`, `call.offer`,
    `call.ringing`, `call.answer`, `call.ice`, `call.end`, `call.list`; one
    call at a time (`busy`); the media key agreed by the two devices (the
    KEM in §10 is now run by the answering device, not its vault); each
    vault signs the ICE configuration for its own devices.
  - §8.5: `call.ringing` is ephemeral; ephemeral forwards are memory-only.
  - §7.4: unlinking ends the device's access session.
  - §10.1: error codes `session_required`, `denied`, `approval_timeout`,
    `busy`, `credential_locked`, `blocked`; `sync.event` kinds
    `connection.changed`, `block.added`, `block.removed`,
    `connection.authenticate.decided`, `device.session`,
    `approval.decided`. §10.3: `device.pair.approve{session_seconds}`,
    `device.list` fields. §10.9: audit and feed kinds. §13.5: desktop and
    call-key rows. §15: follow-up 6.
  - Owner review of the first 0.5.0 draft:
    - §3.5.5, §10.4: credential-key rotation statements, signed by the old
      and the new credential key at `credential.rotate`, delivered
      (`connection.authenticate.rotated`, and `rotations` in responses) to
      the connections that pinned the member's key, which follow the
      chain instead of reporting a key change; forged or broken chains
      are rejected and audited.
    - §7.4, §6.7: a removed or blocked connection's tokens are denylisted
      by `jti`, not by relay key, so the owner can connect with the same
      peer again through a new invitation and approval (after
      `block.remove` for a block); a fresh connection replaces an older
      record of the same peer.
    - §10.10: desktops within an access session place and answer calls
      (no per-call approval); first answer wins; no call handoff between
      devices; the calling device chooses `call_id`; key-exchange shares
      are signed by the device and vouched for by its vault, and checked
      by the peer vault and the peer device (residual: each member's own
      vault).

- **0.4.1** (2026-10-03): the owner's Protean Credential design,
  recovery and backup, audit immutability.
  - §3.5 (rewritten, owner corrections of 0.4.0):
    - the CEK rotates at every use, and the old CEK is destroyed, so old
      blobs are undecryptable;
    - the latest blob is kept until the app confirms it (`credential.ack`),
      so a lost response never loses the credential;
    - UTK/LTK one-time transaction keys (hybrid suite 2, a pool of 20 per
      app) seal every operation's critical payload inside the session,
      single-use and bound to type and request;
    - secret values return sealed to a one-time reply key, so those
      responses are cached normally;
    - LAT is superseded by Nitro attestation (decision 2026-01-08);
    - a vault without a credential is restricted and stays provisional
      (§3.5.7); `has_credential` is in the sealed header.
  - §10.6: every credential type rewritten around `utk_id`/`sealed`, new
    `credential.utk.get` and `credential.ack`; §10.1: `utk_invalid`,
    `credential_required`; §8.2: no type needs volatile responses now.
  - §11.3: `credential.create` before `vault.enroll.confirm`.
  - §11.11 (new): recovery when every owner app is lost. The request locks
    the vault; a vault-minted, single-use code sealed to the member's
    browser key becomes valid after 24 h (enforced by the enclave) for
    24 h; a new attested app registers with it, unlocks with the PIN and
    receives the credential only after the password (with the member's own
    blob when the backup is off); a vault without a credential is refused;
    old devices are kept; cancel by the portal, the email link or an owner
    app's unlock; limits, audit, member API routes.
  - §3.5.6: the vault's copy of the credential is normative, under the
    `credential.backup` setting (on by default).
  - §10.9: the audit log is append-only with fixed retention (the
    `audit.retention_days` setting is removed), anchored by apps through
    `after_seq`, rollback-protected by `state_seq`; `drop.*` entries are
    bounded; recovery and settings kinds.
  - §10.2: `vault.locking{reason}`. §10.6: `credential.recover`. §10.8:
    `credential.backup`. §11.4: `cancel_recovery` (13th signing line),
    `recovery_pending`, `recovery_cancelled`, `vault_bundle`. §11.5: the
    recovery queue operations. §13.5: recovery rows.

- **0.4.0** (2026-10-02): V4 batch 1 (vettid-vault) and the owner's
  decision to keep the full Protean Credential.
  - §3.5 (new): the Protean Credential, held by the member's app, sealed to
    a vault-held hybrid-KEM CEK and under a password key, usable only with
    the member's password per operation; the blob format, use rules,
    password backoff, unlock window, lifecycle, and what VettID and the
    vault can and cannot do with it. (0.4.0 dropped the UTK/LTK
    transaction keys; 0.4.1 restores them.)
  - §3.2, §3.3, §3.4: the CEK and the credential key; `credential.rotate`
    rotates the vault's `ik` and `kem` in the same flush, which carries the
    PQC Phase 2 migration.
  - §6.2, §6.4, §9.3: a vault's `hs.init` profile is `{name}` only; the
    bundle hint is the display name; `profile.update` on activation; the
    broadcast spread is optional because of per-mailbox ordering.
  - §8.2: responses carrying secret values are neither cached nor written
    to state; their requests are re-executed on retransmission.
  - §10: registry entries; §10.1 error codes (`conflict`, `exists`,
    `limit`, `bad_password`, `backoff`, `stale_credential`, `bad_pin`),
    versioned objects, `sync.event` kinds; `connection.event` `profile`;
    §10.6 credential and critical secrets, §10.7 secrets, §10.8 profile
    and settings, §10.9 the hash-chained audit log, the feed and guides.
  - §13.5: the credential's compromise rows. §15: follow-ups.

- **0.3.2** (2026-10-02): from the V3b implementation (vettid-vault
  supervisor and parent) and owner decisions.
  - §11.1: a lease held by an instance that is not live may be taken over,
    conditional on the exact old lease; the parent takes the lease before
    forwarding, does not forward when another instance holds it, and gives
    it back if the vault did not open; renewal failures until 15 s before
    expiry mean a lost lease; account deletion also removes the member
    index object.
  - §11.5, §11.9: the parent writes `expired` slots for requests it did not
    forward or the enclave could not read, and only answers `queued` slots;
    lifecycle writes only by the lease holder (or with no lease);
    `state_version` is a number.
  - §12.2: long-poll collect inside the enclave; KMS over HTTP/1.1
    keep-alive (no HTTP/2 at AWS KMS).
  - §12.3: parent restart and parent loss lock every vault.
  - §12.4 (new), §13.3, §13.6: one OS process per vault; the supervisor
    holds no per-vault secrets and sees the PIN only transiently;
    per-process users, non-dumpable, resource limits, a scoped channel.

- **0.3.1** (2026-10-02): fixes from the V3 implementations (vettid-vault
  V3a, the member API vault routes).
  - §11.1, §11.5: the response slot (`status`, sealed `envelope`, host
    `code` such as `etk_unknown`) and the enclave's response to the parent;
    queue name `<prefix>vault-control-<instance_id>`, `instance_id`
    pattern; `etk_kid` and `envelope` absent for lock and delete; lease
    and heartbeat encodings (Unix seconds, `lease` map written only by the
    parent); liveness (heartbeat ≤ 30 s, live within 90 s, a lease counts
    only while unexpired and its holder is live); `vault_id` is 32
    lowercase hex; MEMBER-API error bodies plus `code`; audit of enroll,
    unlock and lock.
  - §11.1, §11.8, §12.3 (owner decisions): enroll and unlock need state
    `member` with the current terms (`403 terms_required`), lock and status
    stay available; unlock limits per IPv6 /64 (10/15 min) and per IPv4
    address (60/15 min); account cancellation blocks vault access at once
    and deletes vault rows and stored state after the 7-day grace.
  - §11.3: `vault.enroll.result` in the response slot; re-enrollment
    reuses the member's `vault_id` and the enclave replaces a provisional
    vault older than 24 h or answers `vault_exists`; the diagram no longer
    has the API write a lease.
  - §11.4: results bind `re` = `request_id`; codes `release_key` and
    `retry`; requests the enclave cannot answer get random bytes of the
    result's size; no `token` after `moved`.
  - §11.4, §11.10.6, §13.2: `header_seq` is tracked per release, so that
    abandoning a move does not trip the rollback check.
  - §6.7, §11.7, §11.10.3: the pairing challenge; what the device key signs
    on each platform; two iOS counters in one unlock; status-list and
    Android acceptance details.
  - §11.10.5: `409 vault_busy` for `?release=` while another release holds
    the lease; release status comes from the signed manifest.
  - §3.3, §3.3.1, §11.10.7: the sealed-object format with the key ARN;
    `seal_key_verified.verified_by` and re-checks by another release;
    NotX members refused in any statement, case-sensitive matching,
    `Resource` a string, `MultiRegion` present, no `NextMarker`.
  - §11.2: chains evaluated at the document's timestamp.
  - §16: the 0.3.0 altchan sizes (13,444-byte unlock envelope) and the
    release vectors as generated.

- **0.3.0** (2026-10-02): release updates (VAULT-PLAN §5.1, decision D1).
  - §11.10: the signed release manifest (format, ECDSA P-256 signature over
    exact bytes, monotonic serial, statuses, pinned key), per-release
    sealing keys (seal for another release without being able to unseal),
    the approval statement, the move at unlock with its failure handling,
    confirmation by the new release and abandonment of unconfirmed moves,
    the forward-only rule, routing by `sealed_release` with on-demand
    start, and what the app shows and stores.
  - §11.10.7: before sealing to a release key, the enclave reads its
    metadata, policy and grants from KMS over TLS it terminates and checks
    them against a strict allow-list (only that release, in the pinned
    account, can decrypt; no grants, no policy changes, no re-encryption or
    other escape hatches),
    with a passing example policy and variants that must fail.
  - §11.3, §11.4: enroll and unlock requests carry the manifest and are
    padded to 12,288 bytes (§5.4); the unlock also carries an optional
    `release_update`, and its signing string covers both; results report
    the release, its status and moves.
  - §2, §13.5: VettID cannot force updates; the sealing-key guarantee is
    verified by the enclave and rests on AWS behaving as documented;
    residual risks of old releases and the manifest key.
  - §3.3, §10, §11.1–§11.5, §11.9: `sealed_release`, `manifest_serial`,
    `release_move`, the `vault.release` sync kind, routing and failures.
  - §16: release-update vectors.
- **0.2.3** (2026-10-02): additions from the V2 runtime (vettid-vault).
  - §1.2, §6.6: RELAY-PROTOCOL 0.4.0 `jti` in collect results; the token
    class is decided by the collect `jti`, and a connection's message
    without `jti` is treated as a reconnect-token deposit.
  - §3.3.1: DEK derivation (Argon2id with a sealed-header pepper and HKDF)
    and the at-rest formats.
  - §5.3: unknown types are answered with `unsupported_type` when the
    message has no `re`.
  - §6.4: pending connection requests expire after 7 days; apps or
    desktops approve; agents never.
  - §6.7: only apps create and approve pairings; `hs.init` from a
    denylisted relay key is refused.
  - §7.1: `iat` backdated by up to 60 s; lifetimes measured from it.
  - §10.1–§10.5: body schemas, error codes and `sync.event` kinds.
  - §11.3: the first app's handshake.
- **0.2.2** (2026-10-02): clarifications from the V1 implementation
  (vettid-vault).
  - `identity.rotate` statement format and chain rules (§3.4, §6.6).
  - Strict inner-plaintext rules: types, duplicate names, ULIDs, timestamp
    format, `seq` only in session mode, `re`/`status`/`error`, `type`
    grammar, `body` an object (§5.3).
  - Exact-bucket padding; over-padding is malformed (§5.4).
  - Claim-check blob layout, AAD and `sha256` coverage (§5.5).
  - Per-purpose handshake field rules: `ctx` encoding, tokens, relay
    address, `suites`, kids; `hs.resp` `sender_kid` is all-zero (§6.2).
  - Abort scope for the initiator; a bad `sig_I` leaves the responder
    pending (§6.3).
  - Bundle `kind` for pairing, whole-second bundle `exp` equal to QR `e`,
    unpadded base64url in QR and links (§6.4).
  - Sending continues in the old epoch until the new one activates; `rk`
    is deleted with the send keys (§6.5).
  - `device_attest` (Android and iOS) replaces `app_attest`, and
    `device_assertion` replaces `app_attest_assertion` (§6.7, §11.3,
    §11.4, §11.7); encodings of the devatt challenge and the unlock
    signing string (§11).
  - §16 filled in, with the complete vectors in vettid-vault.
- **0.2.1** (2026-10-02): enclave TLS pins only the allowlisted hosts'
  roots and shares a few HTTP/2 connections per instance across vaults
  (§2.2, §12.2; VAULT-PLAN D5).
- **0.2.0** (2026-10-01): owner review of 0.1.
  - Suite 2 is now HPKE (RFC 9180) with the MLKEM768X25519 KEM, KDF
    HKDF-SHA256 and AEAD ChaCha20-Poly1305. It replaces the bespoke combiner
    for sealed mode and handshake encapsulation. The handshake uses HPKE
    `Export`.
  - Sizes changed: sealed header 1,140 bytes, sealed overhead 1,156 bytes,
    `ek` 1,216 bytes.
  - Remote invitations with a selectable TTL (10 min, 1 h, 24 h or 7 d),
    bounded by relay policy. Remote invites stay pending until the inviter
    approves them.
  - Reconnect tokens (≤ 365 d, 4 messages) restore a connection without a
    new invite.
  - Client-anchored rollback protection (`state_seq`, `header_seq`).
  - `vault_id`, per-instance queues and instance leases for multiple enclave
    instances. The vault table gains `vault_version` and `state_version`.
  - Device attestation is required at enroll and unlock: Android hardware
    key attestation and iOS App Attest, both verified in the enclave (no
    Lambda, no Google credentials). Desktops no longer unlock.
  - Vault-to-vault epochs are now 24 h or 10,000 messages.
  - The open questions from 0.1 are resolved.
- **0.1.0** (2026-10-01): initial draft.
