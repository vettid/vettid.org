---
title: IOS-PLAN
status: approved (owner, 2026-10-17)
version: 0.1.36
date: 2026-10-26
changelog:
  - 0.1.36: editorial (VAULT-MESSAGING 0.62.1, ANDROID-PLAN 0.1.82). §4.9
    "Two identities at most": the contact text's action reads "Email
    support@vettid.org", as Android has it (owner decision of
    2026-10-26); `recover_other_vault` and `recover_undecided_new_code`
    are quoted as Android words them, approved by the owner on
    2026-10-26; "A failed register" judges each POST on its own: only a
    first POST with no `202` is not registered, a failure after a `202`
    is maybe registered, a readable refusal is not registered, and a
    re-post of the same code after a request whose slot showed `expired`
    is a repeat; each POST is recorded before it is posted
  - 0.1.35: **owner decisions of 2026-10-25**; the contact text was approved
    by the owner on 2026-10-26 (VAULT-MESSAGING 0.62.0 §11.14.6, ANDROID-PLAN
    0.1.81, MEMBER-API 2.13.0 unchanged). §4.9 "A phone that could not
    tell": the same additions as Android, including one App Attest key
    per identity and a new one for each register of N (a rule of the
    app; App Attest does not force it), all kept until the handshake completes
  - 0.1.34: **owner decision of 2026-10-24**, wording proposed; the owner
    approved the texts `recover_could_not_tell` and
    `onboarding_open_took_phone` of 0.1.33 on 2026-10-24 (in #418), so
    they are no longer drafts
    (VAULT-MESSAGING 0.60.0 §11.14.6, MEMBER-API 2.13.0, ANDROID-PLAN
    0.1.79). New §4.10 "A recovery that ended without the phone": the
    same rule as Android (a `410 recovery_ended` lets a phone forget its
    pending key only if it was never admitted and has no unanswered
    open)
  - 0.1.33: owner decisions of 2026-10-24 (option A); the user-facing
    texts are DRAFTS for the owner's approval (VAULT-MESSAGING 0.59.0
    §11.14.6, MEMBER-API 2.12.0, ANDROID-PLAN 0.1.78). New §4.9 "A phone
    that could not tell": the same rule as Android, including each
    identity's `recovery_id` as its handshake context
  - 0.1.32: **owner decisions of 2026-10-24** (VAULT-MESSAGING 0.57.0
    §12.5 "What a phone does", MEMBER-API 2.11.0, ANDROID-PLAN 0.1.77). §4.2 "A vault being deleted":
    a phone erases its local vault data because of a deletion only on a
    definite answer, never on a `401`. Point 3: the vault counts as
    gone only on `410 vault_deleted` or `410 account_deleted` to the
    app key, and with the vault's own word (the event, or the `{}` to
    this phone's own `vault.delete`, which now enters the state too)
    the app erases at once; `401` and `{vault: null}` are no longer
    gone signals but "could not tell", like `403`, `429`, `5xx` and
    timeouts. Point 4: from the bound, a confirmed **Remove from this
    phone**. New point 5: a `410` without the vault's word shows "Your
    vault was deleted", keeps reading the status and its own relay
    mailbox (where the vault's event can still arrive), and (owner
    decision 2026-10-24) offers the confirmed Remove only after the same
    10-minute bound; erased only on the member's confirmation, or at
    once if the event arrives.
    "Could not tell" is shown as **unconfirmed** (`{vault: null}`, any
    `401`, `403`) or **unreachable** (network, `5xx`, `429`, timeouts);
    the reads at 5, 15, 45 and 105 s, then every 60 s until the bound
    (not staging-scaled), then at a start, the foreground and Check
    again; Check again described anew. This follows the stop-gap in
    Android #192 (in review), which already holds "being deleted" and
    offers the confirmed Remove; the texts are Android #192's (draft,
    pending owner approval) and are not copied here. Tests follow.
    Not built
  - 0.1.31: approved by the owner (2026-10-23) (VAULT-MESSAGING
    0.55.10, ANDROID-PLAN 0.1.72), from the iOS review. The old iPhone
    of a transfer asks its vault before it erases at day 7, and a vault
    that does not answer means "check again later", never an erase;
    the app re-reads its transfer record after the check's await and
    records "kept, not done" only if the write succeeded; the new
    iPhone waits 11 minutes for the approval. §14: the text
    `data_transfer_signer_body_iphone`; before it sends the approval the
    old iPhone renews the vault's standing token for its own mailbox
    (`relay.token.issued`, VAULT-MESSAGING §11.14.10)
  - 0.1.30: editorial; VAULT-MESSAGING 0.55.9, two decisions approved
    by the owner (2026-10-23). §9.1 VA4 is built (vettid-vault #142):
    the vault keeps the last Android signer in its DEK-encrypted state
    while the app has none, a return under another signer is
    `signer_changed`, the same signer is `device.signer_bound`;
    reaches staging with the next staging release
  - 0.1.29: approved by the owner (2026-10-23) (ANDROID-PLAN 0.1.71
    "Sounds"; PUSH-GATEWAY 0.5.2). §6.7: the four `.caf` sounds are
    bundled; the notification service extension and the app's local
    notifications set `UNNotificationSound(named:)` per category (same
    mapping as Android); `timeSensitive` needs the Time Sensitive
    Notifications capability on the app ID (§10, 2); no `critical`; the
    call ringtone through CallKit comes with iOS calls; a missed call
    uses `vettid_message.caf` (owner decision of 2026-10-23, as on
    Android's `missed_calls_v2`)
  - 0.1.28: editorial; approved by the owner (2026-10-22)
    (VAULT-MESSAGING 0.55.5; ANDROID-PLAN 0.1.70). §4.8, canonical
    forms: a month field refuses any invalid value with
    `items_rule_month` ("Enter a month and year, such as 2033-05",
    Android's string); day fields keep `items_rule_date`
  - 0.1.27: editorial; approved by the owner (2026-10-22)
    (VAULT-MESSAGING 0.55.4; ANDROID-PLAN 0.1.69). §4.8: no cut to 15
    digits (the fallback keeps all digits, bounded by the input
    filter's 32 characters); "Check this number" whenever the number is
    not valid; the port tracks the current libphonenumber metadata
    (PhoneNumberKit bundled 9.0.39 against Android's 9.0.41: no pin,
    validity can change with the metadata)
  - 0.1.26: editorial; found in review (VAULT-MESSAGING 0.55.3;
    ANDROID-PLAN 0.1.68). §4.8, canonical forms: the `date` and `url`
    rules and the `number` input filter (a leading `.5` becomes `0.5`
    and a decimal comma a point while typing, as on Android) as in
    ANDROID-PLAN; the tests are Android's
  - 0.1.25: editorial; approved by the owner (2026-10-22)
    (VAULT-MESSAGING 0.55.2; ANDROID-PLAN 0.1.67). §4.8, canonical
    forms: `number` is stored as typed, with white space trimmed and a
    single leading `+` dropped; the tests are Android's
  - 0.1.24: editorial; approved by the owner (2026-10-22)
    (VAULT-MESSAGING 0.55.1; ANDROID-PLAN 0.1.66). §4.8: an extension
    marker counts only when at least one digit comes before it, and
    the edit text keeps the exact marker text typed until the save;
    `items_share_preview_more` ends with a full stop (Android's string)
  - 0.1.23: approved by the owner (2026-10-22)
    (VAULT-MESSAGING 0.55.0 §10.7, §10.8; ANDROID-PLAN 0.1.65).
    §14: iOS variants of two item texts, `ios_items_sensitivity_secret_note`
    and `ios_items_secret_hidden_body`, which name Face ID, Touch ID or
    the iPhone passcode where Android's name its fingerprint or screen
    lock. §8 I3.1: the item editor, like the item screen, is inside the
    `SecureContainer`, so a screenshot or a recording of it is blocked
    unless "Allow screenshots" is on. §4.8: `phone` values stored as
    VAULT-MESSAGING §10.7 says (after the extension is dropped, E.164
    for a possible number, else the dialable characters, with all its
    digits), with a libphonenumber port for iOS (a dependency the owner
    accepted); the tag preview says "N more may be shared"
    (`items_share_preview_more`, Android's); the phone's extension is
    dropped with the note `items_phone_extension_note` (Android's); the
    region for a number typed without `+` is the device's locale region
    (`Locale.current.region`), as iOS has no reliable network or SIM
    country; the other kinds get their canonical stored form on save
    (VAULT-MESSAGING §10.7 "Canonical forms")
  - 0.1.22: approved by the owner (2026-10-21)
    (VAULT-MESSAGING 0.54.0 §3.5.9; ANDROID-PLAN 0.1.64). §4.1,
    History: `credential.holder_cleared` gets the title "Credential
    holder cleared" and the detail "Your vault found its credential
    holder missing and cleared it. If you didn't remove a phone,
    contact VettID.", category Security, History only. The texts are
    Android's
  - 0.1.21: approved by the owner (2026-10-21)
    (owner decision of 2026-10-21; ANDROID-PLAN 0.1.63). §4.7, Drafts:
    the names of a name request already sent are cleared too, at lock
    and on entering the hold or the due state; while the vault is not
    open nothing about the request is shown; it comes back with
    `account.get`'s `name_request` after the unlock, and an
    `account.name.set` answered after the lock is not kept
  - 0.1.20: approved by the owner (2026-10-21)
    (owner decisions of 2026-10-21; ANDROID-PLAN 0.1.62). §4.7: while
    the vault is not open, the top bar, the avatar sheet and the
    Settings account card show only the initial tile, with no name, no
    email address and not even the masked email hint (the unlock
    screen keeps the hint); the drafts on Change name and in the
    shared-profile editor are cleared at lock and on entering the hold
    or the due state
  - 0.1.19: approved by the owner (2026-10-21)
    (owner decisions of 2026-10-21; ANDROID-PLAN 0.1.61). §4's table:
    the profile photo is **camera only** (row I2.5, ANDROID-PLAN §4
    Settings → Privacy), and `PHPickerViewController` is for photo
    attachments only; camera access "not yet asked" asks, "denied" and
    "restricted" show the iOS-only text
    `ios_settings_photo_capture_permission_blocked` with **Open
    settings** (§14). New §4.7 **"The member's own profile"**: memory
    only, wiped at lock, as on Android; while the vault is not open the
    top bar, the avatar sheet and the Settings account card show the
    initial tile, and the name and photo return after the unlock
  - 0.1.18: approved by the owner (2026-10-21)
    (VAULT-MESSAGING 0.52.0 §3.5.4; ANDROID-PLAN 0.1.60). §4.1, History:
    `credential.utk_resync` gets the title "One-time keys renewed" and
    the detail "This phone's one-time keys were replaced with a fresh
    set.", category Security, History only. The texts are Android's
  - 0.1.17: approved by the owner (2026-10-20)
    (VAULT-MESSAGING 0.53.0; ANDROID-PLAN 0.1.59; owner decision of
    2026-10-20). New §4.6 **"The descriptor's clock allowance"**:
    `EnclaveVerifier` accepts a descriptor whose `not_after` is at most
    **24 h + 5 min** after the attestation document's timestamp (was
    24 h + 1 s, `maxDescriptorLife`); every other check is unchanged.
    Ships without waiting for a vault release. No new text
  - 0.1.16: approved by the owner (2026-10-20)
    (VAULT-MESSAGING 0.52.0; ANDROID-PLAN 0.1.58; owner decisions of
    2026-10-20). New §4.5 **"One-time keys and a vault without a
    holder"**: a UTK is spent when it is sent, whatever the answer
    (`signer_unconfirmed` included); one `{"resync": true}` when
    `credential.utk.get` returns no UTKs while the pool is empty, then
    `error_vault_code` with the code; `credential_required{reason:
    "no_holder"}` shows "This phone can't use your vault" (§4.4). The
    texts are Android's
  - 0.1.15: approved by the owner (2026-10-20), with the behaviour and
    texts as written (owner decision of 2026-10-20) (VAULT-MESSAGING 0.51.2;
    ANDROID-PLAN 0.1.57). New §4.4 **"Vault error codes the app does not
    map"**, as ANDROID-PLAN §4: `credential_required` on an owner-facing
    request gets its own full screen and erases nothing; `forbidden` on
    a holder-only request outside an unresolved change means "not the
    holder" (inside one it keeps 0.1.13); every other unmapped code shows
    the generic text with the code alone. Same texts, same tests
  - 0.1.14: approved by the owner (2026-10-20) (ANDROID-PLAN 0.1.56;
    owner decisions of 2026-10-20; found while building the
    Notifications screen on iOS). §4.1: the Notifications screen shows
    the second line in full in the detail sheet, under the title, for
    every kind that has one, and up to 3 lines of it on a row of
    priority `urgent` (every other row 1 line), as ANDROID-PLAN §4
    Notifications, 3 and 4. No new text. §4.2, 3: the re-reads come
    after waits of 5, 10 and 30 s, each counted from the previous read
    (reads at 5, 15 and 45 s after the event), then every 60 s; what
    both apps already do, now unambiguous
  - 0.1.13: approved by the owner (2026-10-20) (VAULT-MESSAGING 0.51.1;
    ANDROID-PLAN 0.1.55; owner decision of 2026-10-20; found while
    implementing the reset's lost answer on iOS). §6.3: a `forbidden`
    answer from the vault to any request that decides an unresolved
    change or reset ends it (the marker and the candidate cleared, the
    gate open) and shows the existing "Your vault moved to a new phone"
    as the one-time notice; only the vault's own sealed answer counts,
    every transport, relay, member API or host failure and timeout stays
    "unreachable"; nothing is erased. The texts are Android's
  - 0.1.12: approved by the owner (2026-10-20), with the behaviour and
    texts as written (vettid.org #356, #354; ANDROID-PLAN 0.1.54).
    §4.2 **A vault being deleted** and §4.3 **The way back to release N
    after leaving or a restart**: the same behaviour and texts as on
    Android, carried here in full. §4.3 point 6, the owner's choice, is
    what the iPhone app does now for an unlock routed to the old
    release after `moved` (wait, retry, a neutral failure), now bound
    to the stored marker and with "Return to release N" next to it. The
    server side of a deletion that stops between §12.5 steps 1 and 5 is
    left to a later VAULT-MESSAGING change
  - 0.1.11: approved by the owner (2026-10-19, 2026-10-20) (VAULT-MESSAGING 0.50.0;
    ANDROID-PLAN 0.1.52). §4.1 **Event titles**: the same plain titles,
    History details, hidden kinds, de-duplication (one notification per
    recovery; a PIN change in History only), "Daily check" wording and
    the two renamed titles as on Android, carried here in full; the
    urgent recovery notifications on Security alarms (approved by the
    owner 2026-10-19).
    Approved by the owner on 2026-10-20: the texts first written as
    drafts (the `leash.item.run` and `leash.item.proxy` detail lines,
    the `push.unregistered` details, the "Recovery attempts reset"
    fallback, the titles without a name or a number, and "Later
    successful."). Owner decisions of 2026-10-20: (1) the vault splits
    `stale`: `stale` (a next generation only already closed) is hidden;
    the new reason `rollback` (a next generation with used attempts, a
    host serving an older copy of the recovery record) is shown as an
    alarm; (2) the attempting phone's name stays, shown as self-reported
    ("from a phone that calls itself “<name>”") and never affecting
    urgency or any decision (VAULT-MESSAGING 0.50.0 §11.14.11).
    Owner answers of 2026-10-20: `rollback` also notifies (an `urgent`
    feed item, `recovery.generation_closed` with `ref`
    `<generation>/rollback`, on Security alarms), and its title, detail
    and notification title and the phone-name line are approved; no
    drafts remain. §6.4(3) (owner decision of 2026-10-20): the connect
    screens keep capture protection (the invitation QR, its link, the
    pasted link and the safety code)
  - 0.1.10: approved by the owner (2026-10-20) (RELAY-PROTOCOL 0.10.0).
    §6.8, §9.2: the relay's `apple-app-site-association` (the
    `/connect` path, the production and staging App IDs) is served by
    the relay software, as specified in RELAY-PROTOCOL §6.11; the
    account hosts' files stay vettid.org work
  - 0.1.9: owner decisions 2026-10-19 (VAULT-MESSAGING 0.48.0;
    ANDROID-PLAN 0.1.51; vettid.org #358 part 1). §6.3: New credential
    (`credential.reset`) is sent and decided as a change is; it stays
    hidden until then. The texts are Android's
  - 0.1.8: owner decisions 2026-10-19 (VAULT-MESSAGING 0.47.1;
    ANDROID-PLAN 0.1.50; vettid.org #358 part 2). §6.3: no answer to the
    pre-check shows the plain "could not reach the service" text; an
    error, a missing version or `exists: false` counts as "differs";
    the alarm trigger iOS chose for a rotation is now the specification
  - 0.1.7: owner decision 2026-10-19 (STAGING-TIME-SCALE 0.1.1;
    ANDROID-PLAN 0.1.49). §6.6: the recovery counter's "unavailable for
    a day" urgency (S8) is scaled too
  - 0.1.6: approved by the owner 2026-10-19 (VAULT-MESSAGING 0.47.0;
    ANDROID-PLAN 0.1.48; vettid.org #347). §6.3: `credential.version`
    before a change or a renew, with the blob refreshed when it differs;
    a renew's own refusal decides it. The texts are Android's
  - 0.1.5: approved by the owner 2026-10-18 (VAULT-MESSAGING 0.46.0;
    ANDROID-PLAN 0.1.47). §6.3: a renew settled before a PIN change,
    settled on answers only, "Finish the move" refused while a change is
    unresolved or a PIN uncertain. The texts are Android's
  - 0.1.4: approved by the owner 2026-10-18 (VAULT-MESSAGING 0.45.0
    §11.14.9 "A lost answer"; ANDROID-PLAN 0.1.46). §6.3's lost-answer
    paragraph follows the corrections: nothing else in flight when a
    change is sent; the gate refuses at once; release updates refused
    while unresolved; `stale_credential` means not applied; `ok` with
    the previous PIN does not decide; other candidates tried with the
    previous PIN before the new PIN is asked for; the uncertain PIN
    after an ended check; the decision shown once, app-wide. The texts
    are Android's. I1 tests follow
  - 0.1.3: approved by the owner 2026-10-18 (vettid.org #338; VAULT-MESSAGING
    0.44.0 §11.14.9 "A lost answer"). §6.3 gains **a lost answer to a PIN or password
    change**, as on Android (ANDROID-PLAN 0.1.45): the change is decided
    by a resend of the same request and `credential.version`, not
    repeated; it replaces the behaviour iOS chose before a rule existed
    (#338), whose "lock and unlock with the new PIN" could spend an
    attempt when the change had not applied. The texts are Android's
    (§14). I1 tests follow
  - 0.1.2: **approved by the owner 2026-10-18** (STAGING-TIME-SCALE 0.1.0,
    VAULT-MESSAGING 0.43.0). §6.6: the staging time scale, as on
    Android (ANDROID-PLAN 0.1.44 §4 "Staging time scale"): `time_scale`
    from the descriptor and the transfer bundle, stored per vault, the
    app's own waits divided by it (early warning, replaced records,
    the old phone's 7 days), scaled texts with "Staging: 1 day = 1
    hour" in staging builds, and any value other than 1 refused by
    Release builds for production
  - 0.1.1: **approved by the owner 2026-10-17** (vettid.org #320),
    with the stricter protection class as decided, the two §14 texts as
    approved, and replaced records kept 7 days as on Android. ID9 as
    recorded in
    VAULT-MESSAGING 0.35.0 §11.14.1 ("On an iPhone"): §6.3 rewritten
    to match it, with the record of each epoch's public key stored
    before sending, reused on retry, tried after a `device_secret`
    answer, replaced records deleted 7 days after a later epoch is
    confirmed or at a wipe, with an earlier-secret step only when the
    member asks (as Android, VAULT-MESSAGING 0.36.0 §11.14.1 rule 7);
    `key_vault` fixed for the life of the key (`""` for a transfer's
    new phone); the encodings (32-byte x-coordinate, SEC1 uncompressed
    keys, both public keys in `info`); key confirmation at creation and
    a 16-byte check tag; the phone key `WhenUnlockedThisDeviceOnly`
    (§6.1); first-run cleanup and explicit deletes; no software phone
    key in Release or Staging builds; why the alternatives were not
    chosen; a locked iPhone never treated as lost keys; a fifth
    unconfirmed change refused, never by dropping a candidate; the
    stricter class as decided, `AfterFirstUnlockThisDeviceOnly` and its
    residual recorded as not chosen; two §14 texts; "missing" decided by the
    lookup's own answer with protected data available before and after;
    the first-run marker a file read from Application Support and the
    cleanup only while protected data is available; typed secrets
    dropped when the screen locks. The comparison with Android in §6.3 is corrected. §1, §2
    ID9, §6.1, §7 (the `phone_ios` vectors and their plan), I0.7, I1.4,
    "What blocks what" and §9.2 follow
  - 0.1.0: approved by the owner 2026-10-17, with the team ID
    confirmed as `3X25CJ86MV` (ID3). ID9 waits for an independent
    review before it is recorded in VAULT-MESSAGING. First version. The plan that a
    Claude Code instance on the owner's Mac follows to rebuild the
    VettID iOS app in `vettid/vettid-ios` against the current
    architecture, as the Android app was rebuilt (ANDROID-PLAN 0.1.41).
    Starting point (what of the 2026-05 iOS code is worth keeping);
    decisions with recommendations (§2); the Swift package layout mapped
    to the Android modules, with the Android files to mirror (§5); the
    iOS-specific matters: Secure Enclave keys against Android Keystore,
    App Attest, a proposal for the release R phone-held secret on iOS,
    screen-capture protection, no autofill and no third-party keyboards,
    background limits, push before APNs (§6); the shared test vectors
    (§7); phases I0–I4, P and later, each as small PRs with acceptance
    tests (§8); the vault-side App Attest work, done on Linux, and which
    phases it blocks (§9); owner prerequisites (§10); coordination rules
    for the Mac agent (§11); getting started on the Mac (§12). The texts
    in §14 are drafts
owner: Al Liebl (Mesmer)
related:
  - ANDROID-PLAN.md (0.1.41) — the Android app; this plan mirrors it
  - VAULT-MESSAGING.md (0.35.0) — the app's contract with the vault
  - PROTEAN-CREDENTIAL.md (0.1.3), VAULT-LOCK.md (0.1.2),
    ENROLLMENT-CODES.md (0.2.3), VAULT-ITEMS.md (0.1.2)
  - RELAY-PROTOCOL.md (0.9.4), MEMBER-API.md (2.7.1)
  - RELEASE-UPDATES.md (0.3.3), VAULT-RELEASES.md (0.1.30, §3.4 C6)
  - PUSH-GATEWAY.md (0.5.0, §11.2 iOS, §14.1 owner actions)
  - VAULT-PLAN.md (§7 risk 6), STAGING-DEVELOPMENT-PLAN.md (§5 row I)
  - CALLS-PLAN.md (0.1.3), for the later calls phase
classification: public (no secrets; safe for github.com/vettid)
---

# iOS app plan (v1)

The VettID iPhone app, rebuilt in the existing `vettid/vettid-ios`
repository against the current vault, with the screens, texts and
behaviour of the Android app (vettid-android `master`, "2.0") and only
the differences iOS forces. Nothing in this plan changes a protocol:
where iOS needs one, §9 and §13 say so and the change goes through the
owner as a vettid.org specification change.

**Who reads this.** A Claude Code instance on the owner's Mac (the
"Mac agent"), which cannot see the machine this plan was written on.
Everything it needs is in this document, in the public repositories it
can clone (`vettid/vettid-ios`, `vettid/vettid-android`,
`vettid/vettid-vault`, `vettid/vettid.org`), and in the specifications
under `docs/` here. Paths below are relative to those repositories.
Commits read for this version: vettid.org `48cc002`, vettid-android
`3b6a8c4` (2026-10-17), vettid-vault `2c3fe13` (2026-10-16),
vettid-ios `b916ad3` (2026-05-28).

**Android paths.** `core/crypto/…/hpke/Hpke.kt` stands for
`core/crypto/src/main/kotlin/com/vettid/core/crypto/hpke/Hpke.kt` in
vettid-android, and likewise for every `core/<m>/…/` and
`feature/<m>/…/`. The English strings are in each module's
`src/main/res/values/strings.xml`.

## 1. Starting point

- **The existing iOS app** (`vettid-ios` `master`, last changed
  2026-05-28): 393 Swift files, about 124k lines, one Xcode target,
  iOS 16, SwiftUI. It implements the **old architecture**: NATS (33
  files under `VettID/Core/NATS/`, used throughout), "cloud status", the
  old enrollment, the old Protean Credential (LAT/UTK over X25519 and
  XChaCha20), vault services, voting, B2C service connections. None of
  its protocol code talks to the current vault, and its screens follow
  the old Android app, not the Proton-style layout of ANDROID-PLAN §3.
  **Treat all of it as replaced.**
- **Worth reading, not copying** (each is rewritten against the current
  spec and the Android 2.0 code, with its tests):
  - `VettID/Core/Attestation/NitroAttestationVerifier.swift` (CBOR
    COSE_Sign1 parsing, the AWS Nitro root pinned by SPKI, PCR checks)
    and `VettIDTests/NitroAttestationVerifierTests.swift`: a starting
    point for the enclave verifier of I0.9, to be checked line by line
    against vettid-android `core/attestation/…/nitro/` (current) and
    VAULT-MESSAGING §11.2.
  - `VettID/Core/Attestation/AttestationManager.swift`: the
    `DCAppAttestService` wrapper (generate, attest, assert). Small; the
    new one adds the error mapping of §6.2.
  - `VettID/Core/Security/ScreenProtection.swift` (capture detection
    and a privacy overlay), `SecurePasteboard.swift` (local-only,
    expiring clipboard), `SecureMemory.swift`: ideas for §6.4 and §6.5.
  - `VettID/Core/Storage/SecureKeyStore.swift`: how the old app probed
    the Secure Enclave. Its storage of raw private keys in the keychain
    is **not** the model (§6.1).
- **Dropped**: everything under `Core/NATS`, `Features/*` (the screens
  are rebuilt from the Android app), `Core/Crypto/CryptoManager.swift`
  and `ConnectionCryptoManager.swift` (old constructions),
  `PasswordHasher.swift` (its PBKDF2 fallback must not exist),
  `UnlockRateLimiter`/`PinAttemptTracker` (the vault limits attempts),
  the `nkeys.swift` package. `stasel/WebRTC` is not carried over; calls
  use the media stack CALLS-PLAN chooses.
- **When the old code goes**: PR **I0.1** tags the old `master` as
  `legacy-v1-final`, pushes a branch `legacy/v1`, and removes the old
  code from `master` (as vettid-android did, ANDROID-PLAN D1). Nothing
  before I0.1 deletes it.
- **The Android app** is the reference for every screen, text and
  behaviour: ANDROID-PLAN §4 (screens), §5 (modules), §6 (phases) and
  the code on `master`.
- **The vault already verifies App Attest**, contrary to what
  VAULT-PLAN §7 risk 6 and STAGING-DEVELOPMENT-PLAN §5 row I say
  ("not built"). vettid-vault `vms/devattest/ios.go` (since V3a,
  vettid-vault #3, 2026-10-02) parses the CBOR attestation object and
  the assertion, verifies the `x5c` chain to Apple's App Attestation
  root pinned in `vms/pins` (SHA-256 `1cb9823b…c932`), checks the nonce
  extension (OID 1.2.840.113635.100.8.2), the App ID hash, a zero
  counter, the **production** environment aaguid, the key id and the
  COSE key, and at each assertion the signature and an increasing
  counter. The enclave's release configuration (`enclave/config.go`)
  pins `IOSAppID = "3X25CJ86MV.com.vettid.app"` as a **constant in
  code, the same in every channel**. The e2e tests enroll, unlock,
  transfer and approve releases with an iOS TEST attester
  (`internal/enclavetest/devattest.go`, a TEST Apple CA). What is
  missing is listed in §9: it has **never seen a real iPhone's
  attestation**, the staging channel has no App ID of its own, the dev
  stack cannot accept a real iPhone, and two decided rules are not
  implemented.
- **Release R blocks unlocking on iOS today.** Staging releases from
  S15 implement VAULT-MESSAGING §11.14 ("release R"): every enrollment,
  unlock, recovery open and transfer carries a 32-byte `unlock_secret`
  made by a hardware key. §11.14.1 specifies it for Android only (a
  Keystore HMAC key) and says "iOS is not designed … It must be
  designed before an iOS app can unlock a vault of release R (§15 item
  39)". VAULT-MESSAGING 0.35.0 records the iPhone design of §6.3
  (ID9) in §11.14.1, approved by the owner on 2026-10-17; I1.4 merges
  only once that version is on `master`.

## 2. Decisions

Each with the recommendation first. Rows marked **owner** need the
owner's answer before the phase named; the others are recorded so that
the Mac agent does not reopen them.

| # | Decision | Recommendation | Alternatives | Needed by |
|---|---|---|---|---|
| ID1 | **Rewrite in `vettid-ios`** | Fresh rewrite in the same repository; old code tagged `legacy-v1-final` and on branch `legacy/v1`, removed from `master` in I0.1 | Refactor in place (carries NATS and the old credential everywhere) | I0 |
| ID2 | **Bundle ids** (owner) | `com.vettid.app` (release), `com.vettid.app.staging` (staging, never published to the App Store), `com.vettid.app.dev` (debug), `com.vettid.app.devstack` (dev stack); the notification extension `<id>.NotificationService` (phase P). The same names as the Android application ids and PUSH-GATEWAY §14.1 | One id for all builds (staging and production could not be told apart by the vault) | I0 |
| ID3 | **Team ID** (owner) | **`3X25CJ86MV`** (owner, 2026-10-17). The owner's Apple Developer team. Until it is known the project uses `TEAMID_TBD` in **one** file, `Config/Signing.xcconfig` (`DEVELOPMENT_TEAM = TEAMID_TBD`), and nowhere else. The vault currently pins `3X25CJ86MV`, which the 2026-05 Xcode project also used: the owner confirms it or gives the new one, and VA2 (§9) pins it per channel | — | I1 (real iPhone) |
| ID4 | **Minimum iOS** | **iOS 17** (SwiftUI Observation, the `sceneCaptureState` trait, current `NavigationStack`; every iOS 17 iPhone has a Secure Enclave and App Attest) | iOS 16 (the old app; more workarounds), iOS 18 | I0 |
| ID5 | **UI and language** | SwiftUI, Swift 6 language mode with strict concurrency, UIKit only where SwiftUI cannot (camera, the secure layer of §6.4); String Catalogs with the Android English texts, translation-ready; VoiceOver labels required in review | UIKit throughout | I0 |
| ID6 | **Crypto libraries** | CryptoKit for SHA-256, HMAC, HKDF, X25519, ChaCha20-Poly1305 (IETF) and the Secure Enclave; **libsodium** (`swift-sodium`, ISC) for Ed25519 (deterministic signatures: CryptoKit's Ed25519 signatures are randomized and cannot reproduce the vectors), XChaCha20-Poly1305 and Argon2id; **ML-KEM-768 from `mlkem-native`** (PQ Code Package, Apache-2.0/ISC/MIT, C, with derandomized key generation and encapsulation) as a SwiftPM C target; the X-Wing combiner and RFC 9180 base-mode HPKE written in Swift and proven by the vectors | CryptoKit's post-quantum HPKE where the OS offers it (cannot be driven with the vectors' fixed randomness, so a second implementation would be needed for tests); BoringSSL through `swift-crypto` | I0 |
| ID7 | **v1 scope** | As ANDROID-PLAN D3 plus photo attachments: enrollment, unlock, Protean Credential, owner check, lock, settings, release updates; connections, messaging, approvals, the feed, History; photos; items, share rules; recovery and transfer. Later: calls, devices and agents, wallet, presence, location (§8, "Later") | — | — |
| ID8 | **Release R only** | The iOS app supports **only** vaults whose release lists `recovery_r` (VAULT-MESSAGING §11.10.9). It never implements the enroll, unlock, transfer or recovery paths from before release R; a descriptor without `recovery_r` gets "This vault's release is too old for the iPhone app" (§14) | Implementing both paths, as Android did during the change | I1 |
| ID9 | **Phone-held unlock secret on iOS** (owner) | **Approved 2026-10-17.** §6.3, as recorded in VAULT-MESSAGING 0.35.0 §11.14.1: a Secure Enclave P-256 key-agreement key per `key_vault`, `WhenUnlockedThisDeviceOnly`; per epoch, a fresh software key pair whose private half is dropped after a key confirmation, its public key stored before the secret is sent and kept until 7 days after a later epoch is confirmed; `unlock_secret` = HKDF over the ECDH x-coordinate with both public keys in `info`; a 16-byte check tag | (b) a random 32-byte secret stored ECIES-encrypted to a Secure Enclave key (same security, Apple-specific format); (c) ECDH of the enclave key with its own public key (one long-lived value for every epoch: a leak would outlive `vault.secret.renew`); (d) a stateless form with each epoch's point hashed to the curve (code that ran as the app could compute future epochs; no hash-to-curve in CryptoKit or Go's standard library) | I1.4 |
| ID10 | **Screen capture** (owner) | Always: a cover in the app switcher and content hidden while the screen is recorded, mirrored or shared. On the screens Android holds secure individually (`SecureWindow`: the typed recovery code, and the same list as Android; 0.1.23: the item screen and the item editor, I3.1), also the secure-text-field layer that iOS leaves out of screenshots, behind one component with a runtime self-check (§6.4) | Only the cover and capture hiding (screenshots possible everywhere) | I1.5 |
| ID11 | **Keyboards and autofill** | Third-party keyboards refused app-wide; the vault PIN on an in-app keypad; no AutoFill and no "Save Password?" on any secret field; no autocorrect, suggestions or learning (§6.5) | System keyboard for the PIN | I1.5 |
| ID12 | **Notifications before APNs** | None in the background: the app shows activity when open, and schedules **local** notifications for the owner check's early warning (ANDROID-PLAN §6 owner check, item 5). Settings → Notifications says Apple push is not available yet. Apple push (PUSH-GATEWAY §11.2, notification service extension) is phase P, after the owner's APNs actions | Background App Refresh as a stopgap (rare, unpredictable wakes; not worth its code before APNs) | I1 |
| ID13 | **Distribution** (owner) | TestFlight: an App Store Connect record for **VettID Staging** (`com.vettid.app.staging`, internal testers only, never released) and later **VettID** (`com.vettid.app`). Development installs from Xcode on the test iPhones. No ad-hoc builds unless a tester cannot use TestFlight | Ad-hoc distribution with registered UDIDs | I1 exit |
| ID14 | **Navigation** | The Android drawer (Proton Mail's iOS app also uses a side menu), the same destinations and order (ANDROID-PLAN §4 "Drawer"); the system back gesture | A tab bar (diverges from Android and the texts) | I0.2 |
| ID15 | **"Installed from" on iOS** | App Attest reports no signer and an iOS binding has none (VAULT-MESSAGING §11.7.1 "iOS"). Settings → Vault status shows "Installed from: Apple (App Store or TestFlight)" for the release and staging builds and "Installed from: Xcode (development)" for the others, from the build configuration, with the line "Apple App Attest confirms this is the VettID app" | No line | I1.7 |
| ID16 | **Real iPhone on staging before VA2** | Wait for VA2 (a staging release that pins `<team>.com.vettid.app.staging`). Not recommended: pointing a `com.vettid.app` build at staging, which today's staging images would accept | — | I1 exit |
| ID17 | **App lock** | ANDROID-PLAN D6 on iOS: **Face ID / Touch ID** or **iPhone passcode** (`LAPolicy.deviceOwnerAuthentication`), gating a Secure Enclave key that unwraps the app's local data key; a convenience layer, never in place of the PIN or the password | — | I1.6 |
| ID18 | **Contact with Apple at attestation** | Say it in Help → Privacy: "When you set up, move or recover a vault, your iPhone asks Apple to vouch for the VettID app. Apple learns that VettID was set up on an iPhone, nothing about your vault." (`attestKey` reaches Apple's servers; assertions do not.) | Silence | I1.5 |

## 3. Design language

ANDROID-PLAN §3 applies unchanged: Proton Mail's structure, VettID
gold `#FFC125` as the single accent (`#7F640A` for gold on light),
navy surfaces from the website tokens, Plus Jakarta Sans for headings
and Inter for body (both OFL, bundled), connection tiles indigo,
favourites teal, the member's own avatar gold, light and dark themes.
The brand kit's artwork as on Android (0.1.37): the app icon is the
gold rook on a VettID Blue (`#2E2D88`) tile; non-production icons carry
a white band along the bottom. Take the artwork from vettid-android
(`app/src/main/res/`, the launcher and drawer-header drawables) and
export it at the iOS sizes; the kit itself is not in any public
repository.

iOS adaptations, nothing else: SF Symbols in place of Material Icons
Outlined, with the same meaning per glyph (a table in `VettIDUI`);
sheets are iOS sheets with the large detent for the avatar sheet;
Dynamic Type instead of font scale, up to the accessibility sizes;
the floating action button and the filter chip keep their places
(bottom right and bottom left).

## 4. Screens

**Every screen of ANDROID-PLAN §4 exists on iOS with the same title,
content, order and texts**, including the subsections "Locking the
vault (0.1.38)", "Photo attachments (0.1.39)" and "Recovery and unlock
from release R (0.1.40)", the History, Notifications and owner-check
details, and the "As built" notes. Where the Android code and
ANDROID-PLAN differ, the Android code on `master` is what was
approved later: follow it and note the difference in the PR.

Only these differ on iOS:

| Screen | iOS difference |
|---|---|
| Onboarding | The setup link is a Universal Link (`https://account.vettid.org/vault/enroll/…`; the staging build `account.staging.vettid.org`), needing the `apple-app-site-association` file of §9.2. A phone where App Attest is unsupported or the Secure Enclave is missing is refused before anything is sent (§14). |
| Every PIN entry | The in-app keypad (ID11). |
| Every secret or code field | §6.5. |
| Typed recovery code | "Password-class keyboard" on Android: on iOS an ASCII-capable keyboard with autocorrection, spell checking, smart punctuation and inline predictions off, `textContentType` cleared; the screen holds the secure layer (ID10). |
| Settings → App → Allow screenshots | Turns off the secure layer of ID10 only; the app-switcher cover and capture hiding stay (they protect against what the member does not see). Same lifetime rules as Android (`core/data/…/lock/ScreenshotAllowance.kt`). |
| Settings → Notifications | Two modes, **Apple push** and **Off** (PUSH-GATEWAY §11.2); until phase P, Apple push shows "Not available yet" (§14). No on-phone service exists on iOS. |
| Settings → Vault status | ID15. |
| Profile photo | **Camera only**, as on Android (ANDROID-PLAN §4 Settings → Privacy; row I2.5): the app's own AVFoundation camera screen, to memory; no photo picker and no other camera app. Camera access "not yet asked" asks; "denied" and "restricted" show `ios_settings_photo_capture_permission_blocked` (§14) with **Open settings**, which opens the app's page in Settings (Android's text names its phone's Permissions screen). |
| Photo attachments | AVFoundation camera to memory; `PHPickerViewController` (no photo-library permission, like the Android Photo Picker); saving uses the add-only permission and only after the warning. |
| History export | `fileExporter` ("Save to Files") in place of "Save to…". |
| Calls (later) | CallKit, and PushKit to ring (needs APNs). |

### 4.1 Event titles (0.1.11)

Approved by the owner (2026-10-19, 2026-10-20). The same as ANDROID-PLAN §4 "Event titles" (0.1.52),
carried here in full; the two must stay identical, and ANDROID-PLAN §4
governs. Every event the vault sends has a
plain title in the Notifications screen, in system notifications and in
History. "Activity: <kind>" and "Vault event: <kind>" stay only for a
kind a newer vault adds (ANDROID-PLAN §4 Notifications, 4; History). The kinds, `ref`
formats and priorities are VAULT-MESSAGING §10.9 and §11.14.11 (0.50.0),
checked against the vault as built (staging release 19). In the titles,
`n` is read from `ref`, and 10 is the number of recovery attempts per
generation (VAULT-MESSAGING §11.14). The titles below take precedence over earlier
texts for the same kinds; the texts approved before and not listed
here stay as they are.

**Words.** "Daily check", never "daily owner check" or "owner check",
in every text the member reads (owner decision 5). The History category
"Unlocks and owner checks" becomes **"Unlocks and daily checks"** (its
identifier `unlocks` is unchanged), and the History titles of
`owner_check.*` say "daily check".

**Notifications** (feed items: the row of the Notifications screen and
the system notification (from phase P, §6.7); the second line is the row's second line and
the notification's text when names and text are shown). The
Notifications screen shows the second line in full in the detail
sheet, and up to 3 lines of it on a row of priority `urgent`
(ANDROID-PLAN §4 Notifications, 3 and 4; 0.1.14):

| Kind | Title | Second line |
|---|---|---|
| `vault.pin_changed` | not listed and no notification: History only (decision 3) | — |
| `device.secret_renewed` | "Your phone now uses a new secret for your vault" | — |
| `credential.recovered`, `recovery.device_paired` | not listed and no notification: History only (de-duplication, below) | — |
| `recovery.completed` | "Recovery finished: your vault is on your new phone" | — |
| `recovery.attempt`, `urgent`, `not_success` | "Someone tried to recover your vault (attempt n of 10)" (decision 2) | — |
| `recovery.attempt`, `urgent`, `success` | "Your vault was recovered (attempt n of 10)" | — |
| `recovery.attempt`, not `urgent` (the member completed a recovery in that generation since) | "Recovery attempt n of 10" | — |
| `recovery.change_required`, `ref` = `password` | "Choose a stronger password to keep recovery on" | "Your password is too weak for recovery. Recovery stays off until you change it." |
| `recovery.change_required`, `ref` = a generation | "Change your PIN or password to turn recovery back on" | "Recovery attempts were used. A change gives you 10 new attempts." |
| `recovery.counter_unavailable` (`urgent`) | "Your vault cannot check its recovery attempts" | none; Settings → Vault status shows the approved "For a day your vault has not been able to check its recovery attempts …" text (ANDROID-PLAN §4 "Owner check and status"), scaled on a vault with a time scale |
| `recovery.generation_closed`, `ref` `<generation>/rollback` (`urgent`; owner decision of 2026-10-20; needs a vault release) | "Your vault was given an older recovery record" | "A host may have served an older copy of your vault's recovery record, one on which recovery attempts had already been used. Your vault moved past it. If you did not try to recover your vault, change your PIN and your password now, and contact VettID." |
| `identity.rotation_failed` (`high`) | "Your vault could not update its keys" | "Your connections still know your old keys. VettID will offer the update again." |
| `identity.rotate_conflict` (`high`) | "<First Last>: verify again" | "This connection's vault announced two different new keys. That can mean someone holds an old copy of their vault. Nothing is sent or received until you check." (ANDROID-PLAN §4 "Other screens") |
| `leash.item.run`, `leash.item.proxy` | "An agent used <item>" (decision 8); without item names: "An agent used an item" | — |

**Channels** (owner decision of 2026-10-19, approved by the owner):
the urgent recovery notifications notify on **Security alarms** (on iOS from phase P, §6.7): a
failed `recovery.attempt` ("Someone tried to recover your vault …",
`urgent` and `not_success`, or `urgent` with a `ref` that does not
read), `recovery.counter_unavailable` and `recovery.change_required`
(both forms); and the `urgent` feed item of a `rollback` closure (owner
decision of 2026-10-20). Every other kind of this table stays on Vault activity,
including an `urgent` successful attempt and a not `urgent` one.

**De-duplication** (decision 3). One recovery raises one notification:
`recovery.completed`, "Recovery finished: your vault is on your new
phone". The vault also makes feed items for `credential.recovered` and
`recovery.device_paired`; the app does not list them, does not count
them in the bell and raises no notification for them. A PIN change
(`vault.pin_changed`) is History only in the same way. Their audit
entries show in History as usual. The app leaves these feed items as
the vault keeps them (it sends no `feed.update` for them), so the rule
is the app's and needs no vault change.

**History** (audit entries: the row's title, and the detail screen's
**Details**, one line each):

| Kind | Title | Details |
|---|---|---|
| `vault.pin_changed` | "PIN changed" | — |
| `device.secret_renewed` | "New phone secret set" | — (the vault records it without a device) |
| `owner_check.passed`, `.held`, `.failed`, `.locked`, `.hold_changed` | "Daily check passed", "Vault held for the daily check", "Daily check failed", "Vault locked after failed daily checks", "Daily check hold changed" (decision 5) | — |
| `identity.rotated` | "Your vault's keys were renewed" (was "Vault identity key rotated"; decision 7) | — |
| `credential.rotated` | "Your credential was renewed" (was "Credential rotated"; decision 7) | — |
| `credential.utk_resync` (VAULT-MESSAGING 0.52.0 §3.5.4; approved by the owner 2026-10-21) | "One-time keys renewed" | "This phone's one-time keys were replaced with a fresh set." The row's second line names the device from the entry's `device_id`, as for every entry with one (ANDROID-PLAN §4 History). Category Security (`credential`); not urgent: History only, the vault makes no feed item for it |
| `credential.holder_cleared` (VAULT-MESSAGING 0.54.0 §3.5.9; staging release 21; approved by the owner 2026-10-21) | "Credential holder cleared" | "Your vault found its credential holder missing and cleared it. If you didn't remove a phone, contact VettID." The row's second line names the device from the entry's `device_id`, the cleared holder, as for every entry with one (ANDROID-PLAN §4 History); that device is no longer listed, so it shows as "Removed device". Category Security (`credential`); not urgent: History only, the vault makes no feed item for it |
| `recovery.attempt` | "Recovery attempt n of 10" | `success`: "Successful." `not_success`: "Not successful. If this was not you, change your PIN or your password now.", then the outcome of the matching `recovery.open` (below), or "Details not available." when none matches |
| `recovery.attempts_used` (`ref` `<generation>/<used>`) | "Recovery attempts used: n of 10" | "If that was not you, change your password now, and your PIN as well." |
| `recovery.armed` | "Recovery is set up" | "It works with your current PIN and password, with 10 attempts." |
| `recovery.generation_closed`, reason `pin` | "Recovery attempts reset after a PIN change" | "Earlier attempts no longer count." |
| … reason `password` | "Recovery attempts reset after a password change" | "Earlier attempts no longer count." |
| … reason `reset` | "Recovery attempts reset after a credential reset" | "Earlier attempts no longer count." |
| … reason `backup_off` | "Recovery turned off" | "You turned off the credential backup." |
| … reason `exhausted` | "Recovery turned off: all 10 attempts used" | "Change your PIN or your password to turn it back on." |
| … reason `delete` | "Recovery ended" | "Your vault is being deleted." With the suffix `/unconfirmed`, also "The service could not confirm this step." |
| … reason `rollback` (owner decision of 2026-10-20; needs a vault release, VAULT-MESSAGING 0.50.0) | "Your vault was given an older recovery record" | "A host may have served an older copy of your vault's recovery record, one on which recovery attempts had already been used. Your vault moved past it. If you did not try to recover your vault, change your PIN and your password now, and contact VettID." |
| … reason `stale` | hidden (below) | — |
| … a reason this app does not know | "Recovery attempts reset" | — |
| `recovery.presence_unrecorded` | "Your vault could not record that you were here" | "If this lasts three days, your vault is no longer protected against a recovery started by someone else." (scaled on a vault with a time scale) |
| `identity.rotation_failed` | "Key update failed" | "Your connections still know your old keys. VettID will offer the update again." |
| `identity.rotate_conflict` | "Connection with <First Last> paused" | "This connection's vault announced two different new keys. That can mean someone holds an old copy of their vault. Nothing is sent or received until you check." |
| `identity.rotate_resolved` | "Connection with <First Last> checked and resumed" | — |
| `connection.request.approved`, `connection.request.declined` | "You accepted a connection request" / "You declined a connection request" | — |
| `push.registered` | "Notifications turned on for <device>" | `fcm`: "Through Google."; `apns`: "Through Apple." |
| `push.unregistered` | "Notifications turned off for <device>" | `app`: "Turned off on that phone."; `transferred`: "Your vault moved to a new phone."; `replaced`: "That phone was replaced after a recovery." |
| `push.token_gone` | "Notifications stopped reaching <device>" | "Open VettID on that phone to turn them back on." |
| `call.permission_off`, `call.permission_on` | "Calls from <First Last> turned off" / "Calls from <First Last> turned on" | — |
| `leash.item.run` | "An agent used <item>" | "The secret went to your VettID connector for one command on your computer. The agent was not given it." |
| `leash.item.proxy` | "An agent used <item>" | "The secret went to your VettID connector, which added it to the agent's requests to a site you allowed. The agent was not given it." |
| `leash.item.changed` | "You changed how an agent may use <item>" (approved by the owner 2026-10-19 in place of the draft's "An agent changed <item>": the member makes this change, below) | — |
| `drop.call_off` | "Call refused: calls are off" | — |
| `drop.call_rate` | "Call refused: too many calls" | — |
| `drop.call_share` | "Call refused: it could not be verified" | — |
| `drop.one_app` | "Refused: a second phone tried to connect" | — |
| `drop.owner_check` | "Refused: your daily check is due" | — |
| `drop.profile_ik_mismatch` | "Profile refused: it did not match the connection" | — |
| `drop.<x>_malformed` without a title of its own | "Message refused: it was malformed" | — |
| `drop.grant_duplicate` | "Request refused: already asked" | — |
| `drop.grant_limit` | "Request refused: too many waiting" | — |
| `drop.critical_signature` | "Request refused: it could not be verified" | — |
| `drop.rate_limited` | "Message refused: too many messages" | — |

`<First Last>`, `<device>` and `<item>` are the names History already
resolves for the row (ANDROID-PLAN §4 History; "Removed connection", "Removed
device", "Deleted item" once gone). Once the connection, device or
item is gone, or its name is not known, the title drops the name
("Connection paused", "Connection checked and resumed", "Calls
turned off", "Calls turned on", "Notifications turned on",
"Notifications turned off", "Notifications stopped", "An agent used an
item", "You changed how an agent may use an item"); it never reads
"Connection with Removed connection paused". The kinds whose
`ref` is an `item_id` for this purpose also include `leash.item.run`,
`leash.item.proxy` and `leash.item.changed` (VAULT-MESSAGING §10.9).
The two `leash.item.run` and `leash.item.proxy` detail lines say only
what VAULT-MESSAGING §10.11 "Ways to use a secret" states: the value
goes to the connector, for the one process it starts or for the item's
bound host, and the agent's answer holds no value. They do not claim
more: the connector's redaction is not complete, and a command the
agent chose can still send the secret elsewhere (AGENT-PLAN §4.9).
`leash.item.changed` records the member's own `leash.item.set` for that
agent and item (VAULT-MESSAGING §10.11), so its title says "You changed …".

**Hidden in History** (decision 4). The list does not show these
entries; they stay in the log, in the chain check and in an export,
whose count the vault authorises:

- `recovery.open`: its outcome becomes the matching attempt's detail
  (below);
- `device.unlinked_sent`: an internal step of a move; "Vault moved to a
  new phone" already covers it;
- `drop.call_glare`: both people called each other at once;
- `recovery.generation_closed` with the reason `stale` (owner decision
  of 2026-10-20): a next generation the counter shows only as already
  closed, as after a retry of a failed write, and the current generation
  closed with it. A next generation with used attempts has its own
  reason, `rollback`, which is shown (above).

**`rollback`** (owner decision of 2026-10-20). Decision 4 hid `stale`
as an internal tidy-up, but the vault also wrote `stale` when the next
generation already showed used attempts: a host may have served an
older copy of the vault's recovery record, and the attempts of that
generation never become `recovery.attempt` entries, so this entry is
their only trace. The vault now writes the reason `rollback` for that
case (VAULT-MESSAGING 0.50.0 §11.14.11; needs a vault release), and
History shows it with the alarming title and detail above. Until the
vault writes `rollback`, a `stale` entry is hidden like the harmless
one. `rollback` also notifies (owner decision of 2026-10-20): the vault
makes an `urgent` feed item for it (`recovery.generation_closed`, `ref`
`<generation>/rollback`), which notifies on Security alarms with the
title "Your vault was given an older recovery record" (Notifications
table above).

**An attempt's outcome.** As built, the vault writes the details a host
can drop as their own `recovery.open` entries, `ref` =
`<recovery_id>/<outcome>`, or `<recovery_id>/<outcome>/<name>` once the
vault records the phone's name, at the open's time (VAULT-MESSAGING
§11.14.11, 0.50.0); `recovery.attempt` entries carry no `recovery_id`.
The app matches them by time: for each `not_success` attempt, taken in
order of `at`, the nearest `recovery.open` entry within 10 minutes whose
outcome counted an attempt (`wrong`, `attempt_lost`, `quiet`, `wait`,
`exhausted`, `closed`), each open entry used once. The detail screen
reads them with `audit.list{kinds: ["recovery.open",
"recovery.attempt"], since, until}` over the hour on each side of the
attempt, and checks kind and time itself. The outcome lines:

| Outcome | Line |
|---|---|
| `wrong` | "Wrong PIN or password." |
| `attempt_lost` | "Counted as an attempt, but it did not finish." |
| `quiet` | "Refused: you used your vault in the last 3 days." (scaled on a vault with a time scale) |
| `wait` | "Refused: too soon after the last try." |
| `exhausted` | "Refused: all 10 attempts used." |
| `closed` | "Refused: recovery was reset." |

**The attempting phone's name** (owner decision of 2026-10-20). When
the matched `recovery.open` carries a name (base64url in the `ref`'s
third part), the detail adds "From a phone that calls itself
“<name>”." after the outcome line; without one it adds nothing.
Two rules: (a) the name is self-reported by the attempting phone, and
anyone can choose it, so it is shown only in that form, never as the
phone's identity, and never in bold or as a title; (b) it never affects
urgency, the alarming notification, the channel or any decision.
**Cleaning for display.** Before showing the decoded name, the app
removes Unicode format characters (category Cf: the direction controls,
ALM U+061C, zero-width characters, U+FEFF), U+2028 and U+2029, U+FFFD
and the quotation marks “ ” " (so that a name cannot close the quote
and fake a sentence after it), then trims it. It shows at most 64
characters (code points, never splitting a surrogate pair); a name
that is empty after cleaning shows nothing.

`busy` and `wrong_again` count no attempt, so no attempt shows them;
they are hidden with the other `recovery.open` entries. When the read
fails, the outcome line is left out; "Details not available." is shown
only when the read found no matching entry.

**An attempt written again.** The vault writes an attempt again when
the counter later shows it succeeded (§11.14.11), so History has two
rows for the same `<generation>/<n>`. The older `not_success` row shows
"Later successful." instead of the not-success detail, and is
not used in the outcome matching.

**Tests** (vettid-ios, as on Android): every title and detail above from its kind
and `ref`, including an unreadable `ref`; the hidden kinds absent from
the list but kept for the chain check and the export; the three
History-only feed kinds neither listed nor notified; the parsing of
`recovery.attempt`'s `<generation>/<n>/<outcome>/counter`,
`recovery.attempts_used`'s `<generation>/<used>`,
`recovery.generation_closed`'s `<generation>/<reason>[/unconfirmed]`
and `recovery.open`'s `<recovery_id>/<outcome>`; the matching of
outcomes to attempts (nearest, within the window, each used once, the
uncounted outcomes never matched, an attempt later written as
`success` never matched); `stale` hidden and `rollback` shown and
routed to Security alarms; the phone's name decoded, shown in its
self-reported form, absent when the `ref` has none, and never changing
the title, the priority or the channel; titles without a name.

### 4.2 A vault being deleted (0.1.12)

The same as ANDROID-PLAN §4 "A vault being deleted" (0.1.54), carried
here in full; "the app" is the iPhone app.

*Approved by the owner (2026-10-20), with the behaviour and texts as
written, including the 10-minute bound. The decision (show "being
deleted" at once) is the owner's, of 2026-10-20 (vettid.org #356).*

**Why.** In a deletion the vault sends `device.unlinked{reason:
"vault_deleted"}` in step 1 of VAULT-MESSAGING §12.5 "Order", erases
in step 4 and reports `deleted` in step 5. Only then does the member
API read the vault as gone: from MEMBER-API 2.11.0 a `deleted` row
answers the app key `410 vault_deleted`, and later the row itself is
removed, with a record that answers the same for 90 days (MEMBER-API
"Vault deletion", What a phone is told; `{vault: null}` is the
portal's answer, never the app's). Until
step 5 `GET /api/vault/status` still lists the vault, and reads
`unlocked` while a lease is unexpired (MEMBER-API "`state` and the
lease"). An app that re-reads the status once at the event can stay on
the open vault for a vault that can never run again. It shows most
when a `vault.delete` waited in a locked vault's mailbox and applied at
the next unlock.

**What the app does on `device.unlinked{vault_deleted}`.** The event
comes from the vault over its session, so it is trusted as it is: from
step 1 the vault is marked `deleting` and never opens again. The `{}`
answer to this phone's own `vault.delete` counts the same (VAULT-MESSAGING
0.57.0 §12.5 "What a phone does": the vault's own sealed word, signal
(a)); the app enters this state on whichever comes first.

1. **At once, over every screen**: the app closes the open vault (the
   shell, the drawer, every vault screen and dialog, a release update
   or an operation in progress) and shows **"Your vault is being
   deleted"**. It drops the PIN and anything else of the vault it holds
   in memory, sends nothing more to the vault, stops reading the vault's
   messages and removes its posted notifications for this vault. It
   keeps the app key and the device keys until the vault is gone (point 3): it needs
   the app key to read `GET /api/vault/status`.
2. **The marker.** In the same step it stores, with the app's
   settings, the non-secret marker `deleting {vault_id, since, until}`
   (`since`: when the event arrived; `until`: the bound below). A new
   process that finds the marker starts in "being deleted", before it
   reads anything, never on the unlock screen or the open vault.
3. **Waiting for the row.** It re-reads `GET /api/vault/status` at 5,
   15, 45 and 105 s after the event, then every 60 s after the previous
   read, and at every start and return to the foreground, until
   `until`; after `until` only at a start, a return to the foreground
   and **Check again** (0.1.32, as Android #192). **The bound** `until` is 10 minutes after
   `since`, or, when this phone sent the `vault.delete` and its `exp` is
   later, that `exp` plus 2 minutes (as the app bounds its re-check of
   an unanswered `vault.delete`); it is not divided by the staging time
   scale. **The rule** (owner decisions of
   2026-10-24, VAULT-MESSAGING 0.57.0 §12.5 "What a phone does"): the
   vault counts as gone only when the status answers **`410
   vault_deleted`** or **`410 account_deleted`** to the app key
   (signal (b), MEMBER-API 2.11.0). With the event (signal (a)) and that
   answer, the app erases at once: it forgets the vault's keys and
   local data, deletes the marker and moves to "no vault" (onboarding
   with a setup code), with the one-time notice below. Everything else
   is **"could not tell"**, erases nothing and keeps the state and the
   marker: **unconfirmed** for the vault still listed (whatever its
   `state`), `{vault: null}`, any `401` and a `403`; **unreachable** for
   a network fault, a `5xx`, a `429` and a timeout (0.1.32, as Android #192,
   which shows the two apart). A `401` and `{vault: null}` are **no
   longer** signs that the vault is gone (until 0.1.32 they were).
4. **After the bound.** If the vault is still listed at `until`, the
   screen changes to the neutral "still finishing" text below, with
   **Check again** (a re-read now, whose result is shown as
   unconfirmed, unreachable or gone; behaviour and texts as Android
   #192). The
   app also re-reads at every start and return to the foreground. It
   stays there, with the marker, until the vault is gone. Nothing in
   this state starts a new timer or a new bound. A deletion that stops
   between steps 1 and 5 of §12.5 leaves the vault listed until
   something else finishes it (the member API's resume, VAULT-MESSAGING
   0.51.0), and the app keeps this behaviour. (0.1.32) From the bound on,
   the screen also offers **Remove from this phone**, behind a
   confirmation the member gives (texts: Android #192); confirmed, the app erases as in point 3,
   with the same one-time notice. Without the confirmation nothing is
   erased, however long the state lasts.
5. **(0.1.32) The member API's answer alone.** A `410 vault_deleted` or
   `410 account_deleted` to any request the app signs, without the
   vault's own word (no event, no `{}` to this phone's `vault.delete`),
   is signal (b) alone. It rests on the vault row's `state`, which the
   host writes and which the app does not trust by itself (or, for
   `account_deleted`, on the account deletion), and the answer is
   protected by TLS only (the request is what the app key authenticates).
   The app closes the vault's screens and shows **"Your vault was
   deleted"** (texts: Android #192), with **Check again** and **Open the
   account site**; it stores the marker `deleted_api {vault_id, since,
   until, code}` (`since`: the first `410`; `until`: `since` + 10
   minutes, not divided by the staging time scale) so that a restart
   reopens there. Unlike point 1 it keeps the vault's keys and its
   device session, and **tries to reach its vault**: it keeps collecting
   its own relay mailbox, where the vault delivers
   `device.unlinked{vault_deleted}` to every owner device (VAULT-MESSAGING
   §12.5 step 1), so the vault's word can still arrive there. It reads the
   status and collects the mailbox on point 3's schedule (5, 15, 45 and
   105 s after `since`, then every 60 s until `until`; after it, at a
   start, a return to the foreground and Check again). **Owner decision
   (2026-10-24): the same bound as point 4.** Before `until` nothing
   erases and **Remove from this phone** is not offered; from `until` it
   is offered behind the same confirmation, and confirmed erases as in
   point 3. If the event arrives (signal (a)) while a `410` stands, the
   app erases at once as in point 3. A later status that lists the vault
   again (a `200` with the vault) removes the marker and returns to the
   unlock screen; any other answer keeps the screen.

**What the member can do there.** Nothing that changes the vault or
this phone's keys: no unlock, no PIN, no update, no daily check, no
cancel (a deletion that has reached step 1 cannot be cancelled; the
portal's start-over cancel applies only before it, MEMBER-API "Vault
deletion: start over"). The screen offers **Open the account site**
(`https://account.vettid.org`, staging
`https://account.staging.vettid.org`), where the member gets a setup
code for a new vault once the deletion is done and finds how to contact
VettID; and, after the bound, **Check again** and (0.1.32) **Remove
from this phone**, confirmed. The app lock still applies, and also
guards the confirmation.

**What it is not.** The status's `deletion` (a start-over that is
`pending` or `executing`) keeps the "Pending deletion" banner (ANDROID-PLAN §4
table) until the event or the status says otherwise; it does not open
this state by itself.

**Texts.**

| Where | Id | Text |
|---|---|---|
| The state, while waiting | `vault_deleting_title`, `vault_deleting_body` | "Your vault is being deleted" / "VettID is erasing everything in your vault. This usually takes a few minutes. Nothing in it can be opened or restored. You will get an email when it is done." |
| The state, after the bound | `vault_deleting_slow_title`, `vault_deleting_slow_body` | "Still finishing" / "Your vault can no longer be opened, but VettID has not finished deleting it yet. Check back later." Action: **Check again** |
| Check again, still listed | `vault_deleting_still` | "Not finished yet. Try again later." |
| Check again, not reachable | `vault_deleting_unreachable` | "VettID couldn't be reached. Check your connection and try again." |
| Both | `vault_deleting_account_site` | **Open the account site** |
| "No vault", once, after this state | `vault_deleted_notice` | "Your vault was deleted. To start again, get a setup code on the account site." |
| 0.1.32: Remove from this phone and its confirmation, "Your vault was deleted" (point 5), the unconfirmed and unreachable results, and Check again | — | See Android #192 (draft texts pending owner approval); the ids and wording are taken from there once the owner approves them, and the Check again rows above may change with it |

The progress indicator while waiting has no percentage. The title is a
polite live region for screen readers.

**Tests.** The event while the vault is open, while a release update
or an operation runs, and with the app in the background: the open
vault closes at once, the PIN is dropped, nothing more is sent; the
status still listing the vault as `unlocked`, then `locked`, then
`410 vault_deleted`: "no vault" (the erase) only after the `410`, and
only with the event or the `{}` (0.1.32:
`410 account_deleted` the same); `401`, `{vault: null}`,
`403`, `429`, `5xx` and a timeout in this state erase nothing and keep
the state and the marker, shown as unconfirmed (`{vault: null}`,
`401`, `403`) or unreachable (network, `5xx`, `429`, timeout); the reads
at 5, 15, 45 and 105 s and then every 60 s until the bound, none after
it but at a start, a return to the foreground and Check again, and the
bound not scaled on staging; the `{}` to this phone's own `vault.delete`
enters the state as the event does; the bound from `since` and from a
later `vault.delete` `exp`; the "still finishing" text at the bound,
Check again, the vault gone later (at a start, a return to the
foreground and Check again); Remove from this phone offered only from
the bound, cancelled (nothing erased) and confirmed (erased, the
notice); a `410` with no event: "Your vault was deleted", the status
and the mailbox read on the schedule, Remove not offered before
`since` + 10 minutes and offered (confirmed) from then, nothing erased
until confirmed, the event arriving through the mailbox then erases, the vault
listed again returns to the unlock screen, a restart reopens there;
a `401` with no event changes nothing; a process killed in each phase
restarts in "being deleted" (never on the unlock screen) and continues;
the marker deleted with "no vault" and at a wipe; the one-time notice
shown once.

### 4.3 The way back to release N after leaving or a restart (0.1.12)

The same as ANDROID-PLAN §4 "The way back to release N after leaving
or a restart" (0.1.54), carried here in full.

*Approved by the owner (2026-10-20), with the behaviour and texts as
written. The decisions (keep "Return to release N" across leaving the
update screen and a restart, vettid.org #354; wait, retry, then fail
neutrally for point 6) are the owner's, of 2026-10-20.*

**Why.** RELEASE-UPDATES §2 says the app can take the member back "as
long as the move was not yet confirmed", and VAULT-MESSAGING §11.10.4
keeps the move abandonable until release N+1 first opens the vault.
Until now the offer lived only on the update screen, in memory: leaving
the "Release N+1 did not open your vault" screen, or a process killed
after `update: moved`, lost it, although the vault would still accept
the abandonment.

1. **The marker.** When the app takes `update: moved`, it stores, in
   the same write that records the new release (§11.10.6), the
   non-secret marker `move_unconfirmed {vault_id, from: {release,
   pcr0}, to: {release, pcr0}, failed}`, with `failed` false. Release
   numbers and PCR0s are public (the manifest), so the marker is not
   secret; it is kept with the app's other per-vault release records,
   and N's `header_seq` is kept with it (§11.10.6: N's release and
   `header_seq` stay until the move is confirmed or abandoned).
2. **When the new release keeps failing.** `failed` becomes true, and
   is stored, at the first unlock after the move that fails to reach or
   open the vault on N+1 for a reason that is not the member's: N+1 did
   not start (`release_starting` past its waits, `release_unavailable`),
   its instance did not verify, the unlock got no answer or an enclave
   error. A wrong PIN, the backoff and a phone without a connection do
   not set it.
3. **The offer on the unlock screen.** While the marker is stored with
   `failed` true, the unlock screen shows, above the keypad, the notice
   below and the button **Return to release N**, at every start, until
   the marker is cleared. It opens the existing confirmation ("Return
   to release N?"); after **Return**, the unlock screen's PIN is used,
   or the keypad asks for it first. The way back runs as on the update
   screen ("Returning to release N…"): `GET /api/vault/enclave?release=`
   N's PCR0, then the unlock with `release_update.to` = N's PCR0 and
   `to_release` = N, approved like any update, with N's `header_seq`
   (VAULT-MESSAGING §11.10.4, §11.10.5). The update screen keeps its own
   **Return to release N**, now read from the marker, so leaving and
   reopening it keeps the offer too. Before `failed` is set (for
   example after a process killed right after `moved`), the unlock
   screen unlocks as usual; that unlock reaches N+1 and confirms the
   move.
4. **Cleared** (the marker deleted, the offer gone) when:
   - an unlock on N+1 succeeds: N+1 has opened the vault, which
     confirms the move (§11.10.4);
   - the vault says the move is confirmed: the `sync.event` kind
     `vault.release` naming N+1, or N refusing the way back with
     `wrong_release` (the vault is sealed to N+1 for good);
   - the vault says the move is abandoned: `update: abandoned` (the app
     records N as the release it last unlocked into, §11.10.6), or the
     way back opening the vault on N with `update: refused` and code
     `downgrade` (no pending move was left: the move had already been
     abandoned; the app records N as above);
   - N can no longer be reached for it: `410 release_unavailable` for
     `?release=` N's PCR0 (the release ended), or N no longer in the
     trusted manifest;
   - the vault is gone or this phone is wiped.
   A wrong PIN, the backoff, `release_starting`, `vault_busy` and a
   missing connection keep it.
5. **Not cleared by time.** The vault keeps a move abandonable for as
   long as N+1 has not opened it, so the marker has no expiry of its
   own; N's end date (VAULT-RELEASES §3) ends it through point 4.
6. **The unlock routed to release N after `moved`: wait, retry, then
   fail neutrally.** For a short while after `moved` the member API can
   still route the vault to N, until the host records the move
   (§11.10.5). The app then sees a release older than the one it last
   unlocked into and does not send the PIN (§11.10.6). The PIN goes to
   N only when the member chooses **Return to release N**; the rollback
   check is unchanged. When the routed release is the marker's `from`
   (number and PCR0 both), the app does not show the rollback text: it
   keeps the step's progress text, fetches `GET /api/vault/enclave`
   again after 5, 10, 15, 15 and 15 s (about a minute), and sends the
   PIN only once the route names N+1. If it still names N, it reports
   the neutral failure below, sets `failed` (point 2) and offers **Try
   again** and **Return to release N**: going back stays the member's
   choice. Any other older release still gets the rollback text, as
   today.

**Texts.** The confirmation,
the progress and the outcome texts of the way back are the existing
`release_update_return*`, `release_update_returning_title`,
`release_update_step_return` and `release_update_abandoned_*`.

| Where | Id | Text |
|---|---|---|
| Unlock screen, while the marker has `failed` | `unlock_move_unconfirmed` | "Your vault moved to release N+1 and has not opened there yet. You can try again with your PIN, or return to release N." Action: **Return to release N** |
| Update screen and unlock screen, still routed to N after the retries (point 6) | `release_update_route_pending` | "Your vault moved to release N+1, but VettID is not ready to open it there yet. Try again in a minute." Actions: **Try again**, **Return to release N** |
| The way back, the move was already confirmed (`wrong_release`) | `release_update_return_confirmed` | "Release N+1 has already opened your vault, so it can't go back to release N. Unlock it with your PIN." |
| The way back, N no longer available (`410`) | `release_update_return_unavailable` | "Release N is no longer available, so your vault can't go back to it. Try again with your PIN, or contact VettID." |
| The way back, the move had already been abandoned (`refused` `downgrade` on N) | `release_update_abandoned_*` (existing) | "Back on release N" / "Your vault runs release N again and is open. You can update to release N+1 later." |

**Tests.** `moved`, then the process killed before the second unlock:
the next unlock reaches N+1 and clears the marker; `moved`, then N+1
failing (each failure of point 2), then leaving the update screen and
then a restart: the unlock screen offers the way back, which abandons
(the fake vault's `update: abandoned`), records N and clears the
marker; a wrong PIN and the backoff on N+1 neither set `failed` nor
clear it; `wrong_release`, `410` and the `vault.release` sync event
clear it with their texts; the way back answered `refused`
`downgrade` with the vault open on N; (point 6) a route naming N for two
fetches then N+1 sends the PIN only to N+1; a route naming N for
every fetch gives the neutral failure with both actions and never
sends the PIN to N; a route naming an older release that is not the
marker's `from` gives the rollback text.

### 4.4 Vault error codes the app does not map (0.1.15)

The same as ANDROID-PLAN §4 "Vault error codes the app does not map"
(0.1.57): the list of codes, their handling, the texts and the tests
are that section's, by reference; "the app" is the iPhone app, its
error mapping is the port of `VaultManager.opFailure` in `VettIDData`,
and "not a proof for `HolderPolicy`" means it is not a proof for the
holder rules of §6.3 or `HolderWatch`: nothing is erased.

*The decision is the owner's, of 2026-10-20. Approved by the owner
(2026-10-20), with the behaviour and texts as written; the texts are
shared with the Android app.*

In short:

1. **`credential_required`** to an owner-facing request (the daily
   check, a credential operation, a change, `account.name.set`,
   `device.transfer.*`, `vault.delete`, `settings.set`), outside the
   resolution of an unresolved change: the full screen
   `vault_credential_required_*`, with **Try again** (resends; the daily
   check asks for the PIN and the password again, nothing was counted)
   and **Lock vault**. Title "This phone can't use your vault"; body
   "Your vault does not count this phone as the one that holds its
   credential, so it refused the request. Nothing was disclosed, and
   your PIN and password were not checked. This usually means a
   recovery of your vault was started and has not finished. If you
   recovered your vault on another phone, open VettID on that phone and
   unlock it to finish. Otherwise, start a recovery on the account site:
   it takes one to three days, and you need your PIN and your password.
   If another phone of yours now opens your vault, use 'Move to a new
   phone' there instead." Nothing is erased.
2. **Every other code the app does not map**: `error_vault_code`,
   "Something went wrong (code: {code}). Try again. If it keeps
   happening, contact VettID and give this code." `{code}` is the error
   response's `code` alone, shown when it matches `[a-z0-9_]{1,40}`,
   otherwise `unknown`; never its `message` or body. A screen with its
   own text for a code keeps it; failures that are not a vault answer
   keep theirs.
3. **`forbidden`** during an unresolved change or reset keeps 0.1.13
   ("Another phone became the holder", §6.3). On any other holder-only
   request (VAULT-MESSAGING §3.5.9) it means this phone is not the
   holder: `vault_not_holder`, title "Your vault moved to a new phone",
   body "Another phone now holds your vault's credential, so this phone
   can't do this. Nothing was disclosed. Use VettID on the phone that
   holds it now. If you no longer have that phone, start a recovery on
   the account site." Only the vault's own answer counts; nothing is
   erased.

**Tests**: those of the ANDROID-PLAN section, in the iOS test targets
with the fake vault: one case per code of its table, the code's check
(`unknown` for a code that does not match; never a `message` or body),
no erase after `credential_required` or `forbidden`, **Try again** and
**Lock vault**, and transport, relay and host failures keeping their
texts.
### 4.5 One-time keys and a vault without a holder (0.1.16)

*Approved by the owner (2026-10-20) (VAULT-MESSAGING 0.52.0;
ANDROID-PLAN 0.1.58).* The same behaviour as
ANDROID-PLAN §4 "One-time keys and a vault without a holder", carried
here in full:

1. **A UTK is spent when it is sent.** The app removes a UTK from its
   pool when it sends the request that presents it and never puts it
   back, whatever the answer; the vault spends it before any check
   (VAULT-MESSAGING §3.5.4 "Using a UTK"). A retransmission of the same
   request carries the same UTK; a new attempt, **Try again** included,
   takes a fresh one. `signer_unconfirmed` leaves the UTK spent; the
   approval is sent again with a fresh one.
2. **Resync.** When `credential.utk.get` returns no UTKs while the app's
   own pool is empty, the app sends `credential.utk.get{"resync": true}`
   once and keeps the 20 UTKs it returns. If that also fails, it does
   not resync again for that request and shows `error_vault_code` (§4.4)
   with the vault's code (`too_soon` within 10 minutes of the last
   resync, scaled on staging), or `utk_empty` for an empty list.
3. **`no_holder`.** `credential_required` with body `{"reason":
   "no_holder"}` shows "This phone can't use your vault" (§4.4, (1));
   `forbidden` to a holder-only type now means only that another live
   app holds the credential, so §4.4's text (3) is accurate as written.
   Nothing is erased.

The tests are Android's.

### 4.6 The descriptor's clock allowance (0.1.17)

*Approved by the owner (2026-10-20); wording to be confirmed
(VAULT-MESSAGING 0.53.0 §11.2 "Lifetime and clock allowance";
ANDROID-PLAN 0.1.59).* The same change as ANDROID-PLAN §4 "The
descriptor's clock allowance", carried here in full:

1. **The allowance.** `EnclaveVerifier.verifyEnclave` (`VettIDAttestation`)
   refuses a descriptor whose `not_after` is more than **24 h + 5 min**
   after the attestation document's timestamp (`maxDescriptorLife` =
   `24 * 3600 + 300`, was `24 * 3600 + 1`). An attestation timestamp
   about a second behind the enclave's clock made the 1 s limit refuse
   a valid descriptor, and every unlock into that instance failed
   closed until its key rotated. This is the only comparison between
   the descriptor's times and the attestation's.
2. **Everything else is unchanged**: `not_after` must still be after the
   phone's current time; the chain, PCR0–PCR2 against the signed
   manifest, no debug PCRs, `release` = PCR0, `user_data`, and the
   attestation's 26 h age with its 5 min skew. The refusal stays
   `.stale` with the same text.
3. **Why it is safe.** A few minutes on a key that lives 24 hours adds
   no meaningful exposure; the signature, chain, PCR and `user_data`
   checks are untouched, and `not_after` is inside the attested bytes.
4. **Order.** This ships without waiting for a vault release; from
   staging release 21 the enclave sets `not_after` at most 24 h − 60 s
   after its own clock.

The tests are Android's (`EnclaveVerifierTests`).

### 4.7 The member's own profile (0.1.19, 0.1.20, 0.1.21)

*Approved by the owner (2026-10-21) (ANDROID-PLAN 0.1.61, 0.1.62, 0.1.63).* The same
rule as ANDROID-PLAN §4 "The member's own profile", carried here in
full:

**Memory only, wiped at lock.** The account snapshot of `account.get`
(the first and last name, the full email address, the membership, the
name request) and the shared profile of `profile.get` (the names, the
display name, the profile photo) live in memory only: never in the
account record, the Keychain, `UserDefaults`, a file or state
restoration. They are forgotten at lock, on entering the hold or the
due state, at sign-out, at a wipe and when the process ends; an answer
still on its way then is not kept. While the vault is not open, the
top bar, the avatar sheet and the Settings account card show only the
initial tile: no name, no email address (not even the masked email
hint) and no photo. Only the unlock screen shows the masked hint.
The name and photo return after the unlock (after the passed check, in
the hold or the due state), when `account.get` and `profile.get` are
read again. The bytes of the photo decoded for display are zeroed once
the image is made. The masked email hint, which the unlock screen
shows, may stay in the account record.

**Drafts.** (0.1.20) What the member has typed or taken on Change
name (the two names, the PIN, the password) and in the shared-profile
editor (an edited display name, a taken photo not yet saved, whose
bytes are zeroed) is cleared at lock and on entering the hold or the
due state. The member types it again after the unlock. (0.1.21) The
names of a request already sent are cleared too: while the vault is not
open, nothing about the request is shown, neither its names nor its
state. After the unlock, the request comes back from the vault with
`account.get`'s `name_request` (its `seq`, the requested names, its
`state` and `reason`, VAULT-MESSAGING §10.8), and an
`account.name.set` answered after the lock, or while held or due, is
not kept.

The tests are Android's.

### 4.8 Items: phone values and the tag preview (0.1.23)

*Approved by the owner (2026-10-22) (ANDROID-PLAN 0.1.65).*

**Phone values.** The same rule as ANDROID-PLAN §4 "Items: phone values
and the tag preview", VAULT-MESSAGING §10.7 "Phone values": the
extension is dropped; then E.164 for a number that parses as possible
(`isPossibleNumberWithReason` returns `IS_POSSIBLE`, not
`IS_POSSIBLE_LOCAL_ONLY`), else the dialable
characters only (a `+` typed before the first digit, then all its
digits, none cut; no digit left: `""`); "Check this number" shows
whenever the number is not valid (`isValidNumber` is false), stored as
E.164 or not, and never blocks;
national format in the viewer's region, international elsewhere and
as-you-type formatting are display only; a value stored in the earlier
spaced form is shown and stored again only when the member next edits
and saves that field. The iOS app needs a **libphonenumber port**
(the owner accepted the dependency). Which port is the app's choice:
it follows the current libphonenumber metadata and does not pin it
(validity can change with the metadata; the bundled 9.0.39 of
PhoneNumberKit against Android's 9.0.41 is why results are compared on
the shared cases), and it MUST give Android's results on the shared
test cases (Android's
`PhoneInput` tests, as data) and is checked against them. It sits
behind one `PhoneInput` type with Android's functions (`raw`,
`stored`, `doubtful`, `display`, the as-you-type mask). The region for
a number typed without a `+` is the device's locale region
(`Locale.current.region`): iOS has no reliable network or SIM country
(`CTTelephonyNetworkInfo` is deprecated and returns placeholder values
since iOS 16), so the app does not use it. When the locale has no
region (`nil`), the "unknown region" path is taken: a number without a
`+` does not parse and is stored as its dialable characters. An
extension marker (`x`, `ext`, `;ext=`, `#`, `,`, any case, with what
follows), counted only where at least one digit comes before it, is
found in the text as typed, before any character filter, and kept in
the edit text exactly as typed until save, with the note
`items_phone_extension_note` (Android's): "Extensions aren't saved; add
it to the item's notes."

**Canonical forms of the other kinds.** The rules of ANDROID-PLAN §4
"Items: phone values and the tag preview", VAULT-MESSAGING §10.7
"Canonical forms", applied on save to `number`, `date`, `email`, `url`,
`otp`, `address` and `text`, only to a field the member edited or
created (an untouched field, a secret value never revealed included, is
sent exactly as stored); a value stored earlier is read as before and
stored again only when its field is next edited and saved. Case mapping
is ASCII only; white space is the Unicode `White_Space` property;
every canonical result is checked against §10.7's table and size limits
and the save is refused with the existing message if it fails. The
tests are Android's.

**The tag preview.** As ANDROID-PLAN: the shares beyond the listed
ones are not counted as asked; the preview adds
`items_share_preview_more` ("N more may be shared.", with the full stop, Android's string).

### 4.9 A phone that could not tell (0.1.33)

*Owner decisions of 2026-10-24 (option A); the user-facing texts were
approved by the owner on 2026-10-24 (ANDROID-PLAN 0.1.78, VAULT-MESSAGING
§11.14.6 "A phone that could not tell", MEMBER-API 2.12.0).* The same
rule as ANDROID-PLAN §4 "Recovery and unlock from release R", step 5,
carried here in full. K is the iPhone's recovering (app) key in the
Secure Enclave; the phone-secret record is the one of §6.3; "`onSent`"
is the moment the member API accepted the open (`202`).

**When:** only after an open was accepted by the member API (`onSent`)
and its answer was never readable, and its recovery has ended. The
phone reads `GET /api/vault/status` signed with K, twice at least 5
minutes apart with the clock checked:
- `200`: **not proof of adoption** (K may be only the pending
  `app_key_next` of an open that stopped). The phone sends the lost-ok
  unlock ("A lost `ok`"). `ok`: it pairs as there. `transfer_incomplete`:
  it opens again while its recovery shows `registered`; otherwise the
  rule below applies. Any other refusal: it keeps everything and reads
  the status again later.
- `401`, or `410 recovery_ended` (MEMBER-API 2.13.0): the rule below applies.
Never while the recovery shows `registered` (then the phone opens
again).

**What it may do:** show (**approved by the owner 2026-10-24, `recover_could_not_tell`**)
"We could not tell whether your last attempt recovered the vault. You
can start a new recovery on the account site and use this phone for it;
nothing on this phone is deleted." Then: claim the new code with K;
poll the earlier open's `request_id` once, since a readable answer
decides it; register with a **new device identity** (new `device_ik`,
`kem` and relay key) and the same K; and open with the **earlier
open's `unlock_secret`**.
- On `409 key_in_use` at the claim (K is a key in use, normally the vault's `app_key`), or a
  `401` at the register followed by `409 key_in_use` on a new claim:
  the lost-ok unlock, first with the new identity if it registered,
  then with the earlier one. If neither unlock succeeds, keep
  everything, read the status again later, and after a day of refusals
  show (**approved by the owner 2026-10-24, `onboarding_open_took_phone`**) "Your vault took this phone, but it cannot be
  unlocked right now. Contact VettID."
- After the new open's `ok`: `hs.init` with the new identity and `ctx`
  = the new `recovery_id`; if no `hs.resp` arrives within the pairing
  timeout (the vault answers a handshake it does not accept with
  nothing; it never sends `invite_invalid`), the
  lost-ok unlock with the earlier identity and `hs.init` with `ctx` =
  the earlier `recovery_id`.
- Each identity pairs only with `ctx` = the `recovery_id` it registered
  for: the vault stores the invitation under that id and looks
  `hs.init` up by `ctx`.

**What it keeps:** K and the earlier identity, its phone-secret record,
the earlier `recovery_id` (its handshake context), open `request_id`s
and `min_header_seq` / `min_state_seq`, until the vault answers `ok` and
the handshake completes; then the earlier identity and its records may
be deleted.

**Never:** start over or forget K while undecided (also on `410
recovery_ended`); never take a `200` alone as adoption; never forget
either identity or its `recovery_id` before the handshake completes.

The tests are Android's.

**Two identities at most, and what makes the phone decide** (0.62.0; owner decisions of 2026-10-25).
- **At most two device identities**: the earlier one (E) and one new one (N). A phone never registers a third. **Further recoveries reuse N** (owner decision of 2026-10-25): for each new recovery the phone claims its code with K, registers N again (the same K, the same N keys, the new recovery's code) and opens with the earlier open's `unlock_secret`. This is needed because once E's open stored step 1, every later open is a resumed recovery that requires E's secret (§11.14.2), so only this phone can finish it. If N's recovery ends (its open is unanswered, or every answer was a readable refusal), the phone keeps both identities indefinitely, forgets neither, and keeps trying the lost-ok unlock ("A lost `ok`"), N first, then E, whenever it reads the status again, and uses the next recovery the member starts as above (on the screens of a recovery that could not be told, the action that takes a new recovery's code reads **Use a new recovery code**: `recover_undecided_new_code`, approved by the owner on 2026-10-26). It shows the contact text (below) only when even that is impossible: the vault's answers rule it out (`exhausted`, `closed` or `not_armed` answered to a fresh open; none of them can follow a stored step 1, and they rule out recovery of this vault from any phone until its owner's app arms a new generation, which needs the owner's PIN or password change, or backup turned off, and then an owner unlock), or the member gives up. The contact state is **not terminal**: the phone keeps both identities and still uses a later recovery the member starts, even after showing the text. This agrees with the `transfer_incomplete` rule above (open again while the recovery shows `registered`, otherwise a new recovery). The text "Your vault took this phone, but it cannot be unlocked right now. Contact VettID." stays only for the `409 key_in_use` outcome, where K is the vault's `app_key`; there, after a day of refusals, it is shown as before.
- **Contact text** (`recover_could_not_recover`, approved by the owner on 2026-10-26): "This phone could not recover your vault. Nothing on this phone is deleted. Contact VettID at support@vettid.org." with an action **Email support@vettid.org** (Android: `onboarding_open_contact_support`, "Email %1$s" with the address) that opens a mail to `support@vettid.org`.
- **A recovery code for another vault.** A scanned code names its `vault_id`, so the phone refuses it before the claim when that vault is not the one of the earlier open. A typed locator names none, so the phone refuses it as soon as the claim answer's `vault_id` differs. Nothing is registered; E, N and K stay. The phone says (`recover_other_vault`, approved by the owner on 2026-10-26) "This recovery code is for a different vault than the one this phone is recovering. Nothing was registered, and nothing on this phone is deleted." (No API change; status with K is always for K's own vault, so there is nothing to ignore.)
- **App Attest (iOS).** One App Attest key per identity, attested and bound at that identity's own register. **iOS registers N with a new App Attest key each time.** This is a rule of the app, not a limit of App Attest: on iOS 27 `attestKey` also succeeds for a key that was already attested (tested on an iPhone 16e, 2026-10-26), but Apple does not document whether a key may be attested again, so neither the app nor the vault depends on it. Each registration's binding stays tied to its own key. N's identity, KEM and relay keys stay. E's key, and all of N's earlier App Attest keys, are kept until the handshake completes: if an earlier N open was resumed with step 2 stored, the vault's unlock binding is that registration's attestation, so N's lost-ok unlock needs that key's assertion.
- **The two status reads.** Both the wall clock and the monotonic clock show at least 5 minutes between the two reads, and the two measures agree within 2 minutes; a clock that was set, or a reboot, between them restarts the pair. The same pair is required before the phone acts on a `200`.
- **A day of refusals** counts from the first refusal and is staging-scaled (STAGING-TIME-SCALE). `bad_pin`, a backoff, and network or service failures (timeouts, `5xx`, `429`) are not refusals and do not count.
- **A failed register.** Each register POST is judged **on its own**, not once per register flow, and is recorded durably before it is posted. A POST **got no `202`** when it was answered `503 release_starting` or `vault_unavailable`, `429` or `409 recovery_not_available`, or got no answer at all (a network failure or timeout before any answer); any other answer without a `202`, except a `401` (below), keeps N as unknown (it may have registered). Only the **first** POST for a recovery's code that got no `202` counts as not registered. A POST answered `202` was queued and may have reached the vault: a failure after it (the poll fails, times out, answers `retry`, or shows the unsealed slot status `expired`) means **maybe registered**, and the phone confirms it with the status signed with K. A readable refusal (`bad_code`, `too_early`, `attestation`, `no_recovery`, `no_backup`, sealed `expired`) settles that POST as not registered. Every later POST for the same code is a **repeat**, whatever the earlier one's outcome and whether or not it is in the same register flow; a re-post of the same code after a request whose slot showed `expired` is one. To a repeat, `409 recovery_not_available` (the member API's answer to any repeat once the first is recorded) and `used` mean **maybe registered**: the phone keeps the new registration and confirms it with the status signed with K (`registered` = registered for this recovery). Further retries with the same N, the same K and the recovery's code are always allowed; only a new identity is forbidden. A `401` at the register drops N's registration (N's identity and relay key; E and K stay) **only for an N that never had a registration answered `ok`, left maybe registered, or unknown**; a re-registered N may be the identity the vault adopted, so there a `401` drops nothing. An N dropped so no longer counts as one of the two.
- **The codes that prove no step 1 on their own** (`busy`, `wrong_again`, `attempt_lost`, `exhausted`, `not_armed`, `closed`, the counter-down answer, the wait verdicts) settle **only the open they answer**, never an earlier unanswered open; the sticky rule above is unchanged.
- **The history is saved before the open is posted.** Each open's entry in the per-open history is written durably first; if that save fails, the open is not posted. A post failure of any kind keeps the open's entry (a re-sent POST can be queued), and nothing after the post is accepted may remove an entry.
- **Pairing.** Each identity pairs only with its own `recovery_id` as `ctx`; for a re-registered N that is the `recovery_id` it **last** registered for. After a resume in which step 2 was not stored, the invitation is under the current recovery's id; after one in which step 2 was stored, E's invitation stays under E's `recovery_id` (R1) and E pairs with that. N falls back to E (and E's `recovery_id`) when no `hs.resp` arrives.

The tests are Android's, with one more: E's key and N's earlier App Attest keys are still present until the handshake completes; each re-register of N uses a new App Attest key.

### 4.10 A recovery that ended without the phone (0.1.34)

*Owner decision of 2026-10-24; wording proposed (ANDROID-PLAN 0.1.79,
VAULT-MESSAGING §11.14.6, MEMBER-API 2.13.0).* The same rule as
ANDROID-PLAN §4, carried here in full. On `410 recovery_ended` to a
signed request a phone may forget its pending (recovering) key and offer
to start over **only if it was never admitted as the app (it holds no
`ok`, token or vault bundle for this vault) and has no unanswered
open**. Only a code read from the vault's own readable (sealed) answer counts as a refusal, and then only `busy`, `wrong_again`, `attempt_lost`, `exhausted`, `not_armed`, `closed` (which comes only from a fresh open), the counter-down answer and the wait verdicts prove on their own that no step 1 was stored; `wrong` and `expired` count as refusals only for a phone with no earlier unanswered open (the sticky rule below). An unsealed slot status `expired` (written by the parent when the lease is held elsewhere or the answer is unreadable, or by the member API after 5.5 minutes queued), a 404, 410 or 5xx on the poll, no answer, `retry`, `transfer_incomplete` and any error count as unanswered. The rule looks at every open the phone ever sent, not the last one: once an open is unanswered, a later refusal never clears it (a `wrong` on a repeated open proves nothing about adoption). The phone keeps the per-open history; a "last answer" is not enough. A phone that was ever admitted treats the `410` as a `401`. A
phone with an unanswered open keeps K and follows §4.9: it never forgets
K on a `410`. On `401` it never forgets. The tests are Android's.

## 5. Architecture

One Xcode project (`VettID.xcodeproj`) with the app target and local
Swift packages, one per Android module. Pure packages (`VettIDCrypto`,
`VettIDRelay`, the protocol parts of `VettIDAltChan` and `VettIDVault`)
have no UIKit and run `swift test` on macOS without a simulator.
Features depend only on the core packages; no feature touches transport
or crypto; one `@Observable` view model per screen with immutable UI
state.

| Package | Android module and files to mirror | Contents |
|---|---|---|
| `VettIDCrypto` | `:core:crypto` — `Suite.kt`, `Bytes.kt`, `Base64s.kt`, `Kid.kt`, `IkFingerprint.kt`, `Ed25519.kt`, `ClaimBlob.kt`, `aead/XChaCha20Poly1305.kt`, `hpke/Hpke.kt`, `kdf/Argon2id.kt`, `kdf/Hkdf.kt`, `envelope/{Envelope,Inner,Padding,Ulid}.kt`, `session/{Handshake,KeySchedule,Epoch,Messages,Rotation}.kt`, `invite/Invite.kt`, `altchan/{AltChannel,Capabilities,DeviceAttest,PasswordRules,ReleaseR}.kt`, `credential/Credential.kt`, `grant/GrantSeal.kt`, `item/ItemSpec.kt`, `json/{StrictJson,JsonBuilder}.kt`, later `call/*` | Suite 2, envelope v2, handshake and epochs, credential sealing, release R derivations, password rules with the estimator's word lists (`core/crypto/src/main/resources/passwords/`). **Must pass every vector byte for byte (§7).** |
| `VettIDKeys` (iOS only) | `:core:keystore` — `AndroidKeys.kt`, `DeviceKeys.kt`, `PhoneKey.kt`, `SeedWrapper.kt`; `:core:data` — `KeystoreFileStore.kt` | Secure Enclave keys, App Attest, keychain, the encrypted file store (§6.1) |
| `VettIDAttestation` | `:core:attestation` — `EnclaveVerifier.kt`, `nitro/{Cbor,NitroAttestation,NitroRoot}.kt`, `manifest/{ManifestKeys,ReleaseManifest,ReleaseManifestManager}.kt`; `:core:altchan` — `CanaryManifest.kt` | Nitro attestation and PCR checks, the signed release manifest, the canary manifest (§11.2, §11.10, §13.9) |
| `VettIDRelay` | `:core:relay` — all of it (`RelayClient.kt`, `RelayAuth.kt`, `Paseto.kt`, `DepositToken.kt`, `MailboxCollector.kt`, `RelayStream.kt`, `TransportRetry.kt`) | RELAY-PROTOCOL: register, signed requests, deposit tokens, collect (long-poll and WebSocket), ack, claims, blobs; `URLSession` |
| `VettIDAltChan` | `:core:altchan` — `AltChannelFlow.kt`, `AltRequests.kt`, `AltResults.kt`, `AltState.kt`, `AppKey.kt`, `Attester.kt`, `MemberApiClient.kt`, `MemberAuth.kt`, `SetupCode.kt` | The member API alternate channel: code redeem, recovery claim, descriptors, sealed enroll/unlock/lock, result polling, release approval; requests signed by the app key |
| `VettIDVault` | `:core:vault` — `VaultApi.kt`, `VaultApiAsks.kt`, `VaultDevice.kt`, `DeviceState.kt`, `Credential.kt`, `ReleaseRApi.kt`, `AttachmentApi.kt`, `PushApi.kt`, `Models.kt`, `VaultJson.kt` | Typed client, one function per §10 type; sessions, dedupe, outbox, sync events |
| `VettIDData` | `:core:data` — `VaultSession.kt`, `vault/*` (notably `VaultManager.kt`, `OwnerCheck*.kt`, `Lock*.kt`, `PhoneSecrets.kt`, `FinishMoveRunner.kt`, `HolderWatch.kt`, `RefusalWatch.kt`, `ReleaseUpdate.kt`, `ReleaseLog.kt`, `History*.kt`, `Signer.kt`, `Wipe*.kt`), `wipe/LocalWipe.kt`, `social/*`, `items/*`, `feed/*`, `account/*`, `lock/*`, `prefs/Preferences.kt` | Repositories and encrypted caches per feature |
| `VettIDMedia` | `:core:media` — `Photos.kt`, `PhotoLimits.kt`, `ImageFormats.kt`, `SharedPhotos.kt` | Photos in memory: bounds, orientation, downscale, JPEG without metadata, thumbnails, sniffing, bounded decoding (ImageIO) |
| `VettIDNotify` | `:core:notify` — `NotificationContent.kt`, `NotificationMapping.kt`, `FeedNotifier.kt`, `PushRegistrar.kt` (not the on-phone service) | Local notifications now; the content rules shared with the extension in phase P |
| `VettIDUI` | `:core:ui` — `theme/*`, `components/*` (`Drawer.kt`, `TopBars.kt`, `ListRow.kt`, `InitialTile.kt`, `EmptyState.kt`, `FloatingControls.kt`, `PillActionBar.kt`, `Settings.kt`, `AvatarSheet.kt`, `QrCode.kt`, `QrScanner.kt`, `SecureWindow.kt`, `Autofill.kt`, `SecretKeyboard.kt`, …) | Theme and components, the secure-input and capture-protection components (§6.4, §6.5) |
| `VettIDTesting` (TEST ONLY) | `:core:testing` — `FakeVault.kt`, `Fake*.kt`, `DevStack.kt`, `SetupCodes.kt`, `TestAndroidAttester.kt` (the iOS counterpart is a port of vettid-vault `internal/enclavetest/devattest.go`'s iOS attester) | Linked by test targets and the `DevStack` configuration only; never by Release or Staging (checked in CI, I0.1) |
| Features (folders or packages) | `:feature:onboarding`, `messages`, `connections`, `approvals`, `items`, `history`, `credential`, `settings`, `notifications` | The screens of §4 |
| App | `:app` | Navigation, dependency wiring, scene handling, the debug screen catalog (`app/src/debugTools/…/ScreenCatalog.kt`) |

**Build configurations** (mirroring ANDROID-PLAN §5 "Build types"):

| Configuration | Bundle id | Name | Talks to | Attester |
|---|---|---|---|---|
| Release | `com.vettid.app` | VettID | production | App Attest |
| Staging | `com.vettid.app.staging` | VettID Staging | staging (`staging.vettid.org` hosts, staging manifest keys) | App Attest |
| Debug | `com.vettid.app.dev` | VettID Dev | staging or dev stack, chosen at launch | App Attest |
| DevStack | `com.vettid.app.devstack` | VettID Dev Stack | the local dev stack | TEST attester on the simulator; App Attest on a device once VA3 exists |

Endpoints and manifest keys come from per-configuration xcconfig files;
a Release or Staging build carrying the other environment's hosts or
keys, the dev stack's hosts, or any `VettIDTesting` symbol fails CI
(the counterpart of `checkReleaseApk` / `checkStagingApk`).

## 6. iOS-specific matters

### 6.1 Keys: Secure Enclave against Android Keystore

| Key (VAULT-MESSAGING) | Android (`:core:keystore`) | iOS (`VettIDKeys`) |
|---|---|---|
| Device attestation key (§11.7) | Keystore EC P-256, attested with the challenge, StrongBox or TEE | **App Attest key** (`DCAppAttestService.generateKey`, `attestKey` with `clientDataHash` = the challenge); its `keyId` kept in the keychain. Assertions: `generateAssertion(keyId, clientDataHash:)` with the challenge (unlock, recovery open) or SHA-256 of the approval string (§11.10.3) |
| App key (§11.12.2) | Keystore P-256 signing key, no user authentication | **Secure Enclave P-256 signing key** (`SecureEnclave.P256.Signing.PrivateKey`), access control `.privateKeyUsage` only, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, so that lock and polling work in the background; SPKI from `publicKey.derRepresentation`; `akid` = first 16 bytes of SHA-256(SPKI) |
| Phone key (§11.14.1, release R) | Keystore HMAC-SHA-256 key, not bound to authentication | **Secure Enclave P-256 key-agreement key** (`SecureEnclave.P256.KeyAgreement.PrivateKey`), access control `.privateKeyUsage` only, **`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`** (stricter than the app key's class and than Android's rule, as the owner decided; `AfterFirstUnlockThisDeviceOnly` not chosen: it is used only in requests started in the app in the foreground, so never while the iPhone is locked; a refusal while locked is never lost keys); its key blob in the keychain with the same class, not synchronizable, labelled with its `key_vault`; plus one record per epoch in the encrypted file store; §6.3 |
| Identity, relay and session keys (Ed25519, X25519, ML-KEM seeds) | Seeds wrapped by a Keystore AES key (`SeedWrapper.kt`) | Seeds wrapped (AES-GCM) under a key derived from a Secure Enclave key agreement, stored in the keychain `AfterFirstUnlockThisDeviceOnly`; plaintext seeds only in memory, zeroized after use |
| Local data (caches, records) | Files under a Keystore AES-GCM key (`KeystoreFileStore.kt`, format `0x01 ‖ iv ‖ AES-GCM`) | The same file format under a keychain-held key; files `NSFileProtectionCompleteUntilFirstUserAuthentication`, the app's data directory excluded from backups (`isExcludedFromBackup`); atomic replace on write |
| App-lock key (D6/ID17) | Keystore key bound to BiometricPrompt class 3 | Secure Enclave key with `.biometryCurrentSet` or `.devicePasscode` per the member's choice |

Rules, as on Android: every key is per vault and `ThisDeviceOnly`;
none is synchronizable; nothing is in iCloud Keychain or a backup. The
three vault keys (attestation, app, phone) are lost together or not at
all: none is bound to biometry or to the passcode (a passcode change
must not destroy them). **After a restore or migration** keychain items
may come back while the Secure Enclave keys and the App Attest key do
not; the app must test that each key is *usable* (sign or agree once),
not only present, and show ANDROID-PLAN §4's "this phone no longer
holds the keys" path. **Keychain items survive removing the app**
(the app's files do not): on its first run after an install the app
deletes every VettID keychain item and Secure Enclave key it finds
before it does anything else, so that stale keys are never taken for
usable ones. "First run" is decided by reading the content of a marker
file in Application Support (written after the cleanup, by atomic
replace), never from `UserDefaults`, which comes back empty before the
first unlock. The cleanup runs only while
`isProtectedDataAvailable` is true and the marker file's absence is a
"no such file" answer as in §6.3; a launch before the first unlock
(a background launch, for example) deletes nothing and leaves the
check for a later launch. A wipe, and the end of
a transfer's keep period on the old phone (which at or after 7 days
ends only when the vault answers, VAULT-MESSAGING §11.14.10), delete
every key and record explicitly. The simulator has neither a Secure Enclave nor
App Attest: tests there use software keys behind the same protocols
(`PhoneSecretSource`, `Attester`), as Android's tests do; the software
phone key is compiled only into Debug, DevStack and test targets, never
into Release or Staging (§6.3).

### 6.2 App Attest

- **What the app sends** is VAULT-MESSAGING §11.7's iOS forms:
  `device_attest {platform: "ios", key_id, attestation}` at enrollment,
  a transfer's `hs.init` and a recovery's register;
  `device_assertion {platform: "ios", assertion}` at each unlock and
  recovery open; an assertion over SHA-256(approval string) for a
  release approval. With two assertions in one request (unlock and
  approval) generate them one after the other: both counters must
  exceed the stored one and differ (§11.10.3).
- **Environment.** The vault accepts only the production environment
  (aaguid `appattest` + 7 zero bytes). TestFlight and App Store builds
  are always production. Debug and DevStack builds signed in Xcode set
  the entitlement `com.apple.developer.devicecheck.appattest-environment`
  to `production`, so that a development build on a real iPhone makes
  the attestation the vault accepts, once VA2 or VA3 accepts its App ID.
- **App ID.** The attestation's `rpIdHash` is SHA-256 of
  `<team id>.<bundle id>`; the vault compares it with the App ID its
  release pins. Today every image pins `3X25CJ86MV.com.vettid.app`
  only. VA2 makes it per channel.
- **Errors.** `isSupported == false` (simulator, very old devices):
  refuse before anything is sent. `DCError.serverUnavailable`: retry
  with backoff, then "VettID couldn't reach Apple…" (§14).
  `DCError.invalidKey` at assertion: the key is gone (reinstall,
  restore): the "no longer holds the keys" path. A vault answer
  `attestation` shows what Android shows for it.
- **What a debug build cannot do.** The vault has **no relaxed App
  Attest mode**: the dev enclave's device policy file
  (`internal/enclavetest/devpolicy.go`) has Android members only, the
  development aaguid is always refused (`ErrEnvironment`), and the TEST
  policy trusts only the TEST Apple CA. So until VA3: on the dev stack
  only the TEST attester (simulator or device, DevStack configuration);
  on staging only a real attestation of an App ID the staging image
  pins.
- **Never logged**, never written outside the keychain: the key id, the
  attestation object, assertions (stable device identifiers, §11.7
  "Rationale").

### 6.3 The phone-held unlock secret on iOS (ID9)

VAULT-MESSAGING §11.14.1 requires a 32-byte `unlock_secret` that only
the phone's hardware can produce, recomputed for each request, with an
epoch (1 at enrollment, transfer and recovery; +1 at `pin.change` and
`vault.secret.renew`). Android computes
`HMAC-SHA-256(phone key, "vettid/vms/2/unlock-secret" ‖ 0x00 ‖ vault_id ‖ 0x00 ‖ epoch)`
in the Keystore. The Secure Enclave has no HMAC keys. VAULT-MESSAGING
0.35.0 §11.14.1 ("On an iPhone") records the iPhone design, approved
by the owner on 2026-10-17; that text is normative, and this section says how
to build it.

```
phone key P   = a Secure Enclave P-256 key-agreement key, one per key_vault
                (.privateKeyUsage only; WhenUnlockedThisDeviceOnly; not
                synchronizable; not bound to biometry or passcode)
key_vault     = the vault id, or "" for a key made at a transfer to this
                phone; fixed for the life of the key, stored with it
at each new epoch e (enrollment, transfer, recovery, pin.change,
vault.secret.renew), unless a retry reuses a stored record:
  E_e         = a fresh software P-256 key pair
  z_e         = ECDH(priv(E_e), pub(P)): x-coordinate, 32 bytes, big-endian
  require       the Secure Enclave's ECDH(priv(P), pub(E_e)) == z_e
  drop          priv(E_e) (never written, logged or reported)
  store         record (key_vault, epoch, pub(E_e), check_e), atomically,
                BEFORE the first request that carries the secret
each time the secret is needed:
  z_e         = ECDH(priv(P), pub(E_e))   by the Secure Enclave, from the
                stored pub(E_e) parsed with full point validation
  info_e      = "vettid/vms/2/unlock-secret-ios" ‖ 0x00 ‖ key_vault ‖ 0x00
                ‖ epoch (8, big-endian) ‖ pub(P) (65) ‖ pub(E_e) (65)
  unlock_secret = HKDF-SHA-256(ikm = z_e, salt = empty, info = info_e, L = 32)
  check_e     = first 16 bytes of HMAC-SHA-256(unlock_secret,
                "vettid/vms/2/unlock-secret-ios-check")
```

Public keys are SEC1 uncompressed (`x963Representation` in CryptoKit,
`PublicKey.Bytes()` in Go's `crypto/ecdh`); `salt = empty` is
`salt: Data()` in CryptoKit, 32 zero bytes by RFC 5869.

- **The vault is unaffected**: it accepts any 32 bytes (§11.14.1) and
  never learns how they were made. No vault release is needed.
  `pub(E_e)` never leaves the phone.
- **`key_vault`.** A transfer's new phone does not know the vault id
  when it sends `hs.init`, so its key's `key_vault` is `""`, at
  `hs.init` and at every later unlock, exactly as Android
  (`UnlockSecret.message`, `keepPhoneKey("")` in `VaultManager.kt`) and
  vettid-vault's reference client (`client/phonekey.go`) do. The
  keychain label of `P` and the records are bound to `key_vault`, never
  to a vault id the app learns later: filling it in would change every
  secret and lock the member out.
- **Storing and reusing `pub(E)`.** Android's secret for an epoch can be
  computed again at any time (`PhoneSecrets.secret(s, ahead)`), so its
  retries resend the same value and its lost-answer rule simply tries
  `ahead = 1`. On an iPhone the secret of an epoch exists only while
  its record does, so `PhoneSecrets` on iOS keeps, in one file of the
  encrypted file store (§6.1, excluded from backups, atomic replace),
  the **current** record and up to four **candidates**: next-epoch
  records sent in a `pin.change` or `vault.secret.renew` whose answer
  did not arrive. While four are unconfirmed, a new `pin.change` or
  renew is refused before anything is sent, with "Unlock your vault
  first" (§14); the unlock confirms one of them or the current record.
  The oldest candidate is never dropped to make room: it may be the one
  the vault holds.
  1. The record is written **before** the request that carries its
     secret is built. A crash after the write and before the send
     leaves a harmless candidate; the reverse order could leave the
     vault holding a secret the phone can no longer make.
  2. A **retry** of the same request reuses its record. A new `E` is
     made only for a new operation the member starts; an earlier
     unconfirmed record stays a candidate.
     (0.1.3) A lost answer to `pin.change` or
     `credential.password.change` is decided, not repeated, as
     VAULT-MESSAGING 0.44.0 §11.14.9 "A lost answer" says and as on
     Android (ANDROID-PLAN 0.1.45, "A lost answer to a PIN or password
     change"): an unresolved-change marker (type, inner id, blob version,
     `exp`; no secret) in the same atomic write as the candidate; an
     `exp` of 10 minutes by the vault's clock; after no answer, no
     failure shown, the new entries kept, the same request (same id and
     body, kept in memory only) resent while `exp` has not passed, and
     `credential.version` asked: version + 1 is applied (blob fetched,
     candidate made current), the same version after `exp` is not
     applied; nothing else credential-bearing (no new change, no owner
     check, no other credential operation) is sent while unresolved; a
     `stale_credential` to these two types is not retried with the typed
     secrets; and while the vault is locked the unlock asks for the
     previous PIN, then for the new PIN only after `device_secret`. This
     replaces the behaviour chosen before the rule (#338): its "lock and
     unlock with the new PIN" costs an attempt when the change did not
     apply, and its other parts (keep the entries, no second send while
     one may be in flight, `bad_pin` / `bad_password` clear the entry,
     an `epoch_advanced` whose local write fails is still success) stay.
     The texts are Android's, not `ios_` drafts (§14).
     (0.1.4) As corrected in VAULT-MESSAGING 0.45.0 and ANDROID-PLAN
     0.1.46:
     - a change is sent only when no credential operation is queued or
       awaiting its answer, and the marker refuses a second change;
     - the gate refuses other operations at once, with the "still
       checking" or "unreachable" text;
     - a release update, and any flow that unlocks with a PIN typed on
       its own screen, is refused while a change is unresolved;
     - `stale_credential` to the change means not applied, decided
       without `credential.version`;
     - `ok` with the previous PIN leaves the change to the check after
       the unlock;
     - after `device_secret`, other unconfirmed candidates (an
       unanswered renew's) are tried with the previous PIN before the
       new PIN is asked for;
     - a check that ends without a decision offers no retry that sends
       secrets, and after a PIN change keeps the PIN uncertain until a
       two-step unlock settles it;
     - the decision is shown once, wherever the member is.
     (0.1.5) As in VAULT-MESSAGING 0.46.0 and ANDROID-PLAN 0.1.47: an
     unanswered `vault.secret.renew` is recorded and decided by
     `credential.version` before a PIN change is sent, with "Lock and
     unlock now" when the version cannot decide (the PIN is unchanged,
     so that unlock costs nothing); a pending credential request is
     settled only by its answer or a vault answer's `ts`; "Finish the
     move" is refused while a change is unresolved or a PIN uncertain.
     (0.1.6) As in VAULT-MESSAGING 0.47.0 and ANDROID-PLAN 0.1.48: right
     before a change or a renew, inside the serialization of credential
     operations, the app asks `credential.version`; when it differs from
     the held blob, the app fetches the blob and sends with it, or
     refuses with nothing sent. The app already did this while a renew
     was unconfirmed, and now does it before every change. A renew's own
     refusal, `stale_credential` included, decides it not applied.
     (0.1.8) As in VAULT-MESSAGING 0.47.1 and ANDROID-PLAN 0.1.50: no
     answer to that `credential.version` refuses with the plain "could
     not reach the service" text, not the "unreachable" text of a
     pending change, since nothing was sent; an error answer, an answer
     without a version or `exists: false` counts as "differs" (fetch,
     and send only with the vault's current blob). During a credential
     alarm, `credential.version` before a rotation and on
     `rotation_required` / `credential_frozen`, then fetch, keep,
     acknowledge and retry once when the version or the key differs, is
     the trigger iOS chose (#358) and is now the specification (§3.5.9).
     (0.1.9) As in VAULT-MESSAGING 0.48.0 and ANDROID-PLAN 0.1.51
     ("A lost answer to New credential"): the holder's
     `credential.reset` is sent only with nothing else in flight, after
     the pre-check, whose `key` is stored with the marker; it carries
     `exp`, the same request is resent while `exp` has not passed, and
     `credential.version` decides it (another `key` or a lower `version`
     is applied: fetch, keep, acknowledge, top up UTKs; the same `key`
     and `version` after `exp` + 1 minute is not applied). Every other
     credential operation waits for the decision. **New credential
     stays hidden**, as it is now, until this is implemented and tested.
     (0.1.13) As in VAULT-MESSAGING 0.51.1 and ANDROID-PLAN 0.1.55
     ("Another phone became the holder"), for a change, a renew and a
     reset alike: a `forbidden` answer from the vault to any request that
     decides the unresolved change (the resend of the same request,
     `credential.version`, `credential.get`, `credential.ack`,
     `credential.utk.get`, or any other) ends it, also after
     `credential.version` showed "applied": the marker and the change's
     candidate are cleared, the PIN is not left uncertain, and the gate
     opens. The one-time notice is the existing "Your vault moved to a
     new phone" (the title for `device.replaced`, ANDROID-PLAN §4), with no "Try
     again". Only the vault's own answer counts: an error response with
     code `forbidden` opened under the device's session with the vault
     and answering that request's id. A transport error, a timeout, an
     HTTP status, an error of the relay, the member API or the host, or
     an answer that does not open, is no answer: the marker stays and
     the "unreachable" text is shown. Nothing is erased: this answer is
     not a proof that the phone was replaced, and the keys and local
     state stay until the vault's own `device.unlinked{transferred}` or
     `device.unlinked{replaced}`.
  3. A candidate becomes current on its operation's answer, or when an
     unlock answered `device_secret` with the current record is tried
     with the candidates, newest first, and one gets `ok`, `bad_pin` or
     `transfer_incomplete` (`UnlockEpoch.confirmsNext`). Answers decided
     before the secret check prove nothing.
  4. When a candidate is confirmed, the record it replaces and every
     other candidate become **replaced records** (not counted in the
     four). They are deleted **7 days** after that confirmation, or at
     a wipe, whichever comes first, as on Android (VAULT-MESSAGING
     0.36.0 §11.14.1 rule 6): the 7 days count from the confirmation,
     or from when the app notices its clock is behind it, so a clock
     set back never extends them. Nothing is deleted before a later
     record is confirmed. The old phone of a transfer keeps its current
     record through the keep period (§11.14.10).
  5. **The earlier secret, only when the member asks** (rule 7 there):
     while a replaced record exists, the "this phone no longer holds
     the keys" screen offers an explicit step that tries the replaced
     records, newest first, each once, never automatically. Only `ok`,
     or `transfer_incomplete` for an unfinished transfer, makes that
     record current again; `bad_pin` changes nothing. After `ok`: a
     History entry on the phone and an immediate prompt for a new phone
     secret (`vault.secret.renew`). This serves an operator restore of
     the state from before a change (§11.14.2).
  6. Records are **never** kept in Caches or tmp, which iOS may empty:
     a lost record is a lost secret, and with the credential backup off
     a lost vault.
  7. **Epoch 1**: where Android calls `PhoneSecrets.reuseOrCreate`
     (enrollment, a transfer's `hs.init`, a recovery's register, a retry
     whose earlier try may have reached the vault), iOS reuses `P` and
     the epoch-1 record when both exist for the same `key_vault` and
     pass the "keys usable" check, and makes new ones otherwise.
- **Key confirmation and the "keys usable" check** (§6.1). The two-way
  ECDH at creation proves that the Secure Enclave path works before the
  vault holds the secret. `check_e` lets the app test, before sending,
  that `P` and the stored `pub(E_e)` still give that epoch's secret:
  the check recomputes it, compares the tag and discards it. The tag
  tests nothing but guesses at a 256-bit secret.
- **Lost keys against a locked iPhone.** Only these lead to the "this
  phone no longer holds the keys" path (and so to a recovery, which
  replaces `P`): a tag mismatch; a stored `pub(E_e)` that does not
  parse; the keychain item of `P` or the record missing; a key iOS
  reports invalid (the key blob refused as invalid for a reason other
  than the lock state). **Missing** is decided only like this:
  `UIApplication.shared.isProtectedDataAvailable` is true before the
  lookup, the lookup itself answers `errSecItemNotFound` (keychain) or
  `NSFileReadNoSuchFileError` / `ENOENT` (file store), and
  `isProtectedDataAvailable` is still true after it. Any other error,
  or protected data that went away in between, is the locked case. Do
  not replace this with a separate "is storage readable" probe: a
  sentinel item of class `AfterFirstUnlock` reads fine on a locked
  iPhone while `P`'s `WhenUnlocked` item does not, so only the answer
  of the lookup for the item itself counts. A refusal because the iPhone is locked, or has not
  been unlocked since it started (`errSecInteractionNotAllowed`, a
  Secure Enclave or file-protection refusal for that reason; every
  class refuses before the first unlock), is temporary: keep every key
  and record, show "Unlock your iPhone" (§14) and retry once
  `UIApplication.protectedDataDidBecomeAvailableNotification` arrives
  or the member taps again. Treating it as a loss would turn a
  temporary refusal into a real loss. The retry never keeps a typed PIN
  or password in memory while the iPhone is locked: typed secrets are
  dropped on `protectedDataWillBecomeUnavailableNotification` (and when
  the app leaves the foreground), and the member is asked for them
  again before the retry.
- **Why `WhenUnlockedThisDeviceOnly`**, not the app key's
  `AfterFirstUnlockThisDeviceOnly`: the app key must work in the
  background (lock, polling); the phone key is needed only for
  enrollment, unlock, a transfer's `hs.init`, a recovery open,
  `pin.change` and renew, all started in the app in the foreground
  (most of them by typing the PIN; `hs.init` and the candidate retry
  carry the secret without a new PIN entry), so the iPhone is unlocked
  then. With this class, code that runs on a locked iPhone after its
  first unlock cannot make the Secure Enclave compute the secret.
  **This is stricter than Android**, whose rule forbids binding the
  phone key to an unlocked screen, and the owner decided it on
  2026-10-17.
  It keeps the reason behind that rule (VAULT-MESSAGING §15 item 39,
  decision 6: the three keys are lost together or not at all), because
  a passcode change, or turning the passcode off, deletes neither iOS
  class. **Not chosen**: `AfterFirstUnlockThisDeviceOnly`, with the
  residual Android has today: on a locked iPhone after its first
  unlock, code running as the app can have the Secure Enclave compute
  the current and candidate secrets, and with a broken sealing the PIN
  then falls offline cheaply (VAULT-MESSAGING §11.14.12). On an iPhone
  with no passcode the key is usable whenever the phone is on, as on an
  Android phone without a screen lock.
- **Removal, first run and wipes.** Removing the app deletes its files,
  and so the records, but keeps keychain items: the old `P` is then
  useless for every epoch, and the first-run cleanup of §6.1 deletes it.
  A wipe, `PhoneSecrets.delete` and the end of a transfer's keep period
  delete `P` and every record explicitly.
- **No software phone key in Release or Staging builds.** iOS has no
  report of where a key-agreement key lives, unlike the Keystore level
  Android checks (`PhoneKey.holdsPhoneKey`). Release code creates `P`
  only as `SecureEnclave.P256.KeyAgreement.PrivateKey` and refuses to
  enroll, receive a transfer or recover when `SecureEnclave.isAvailable`
  is false (§14, "No secure hardware"). The software
  `PhoneSecretSource` is compiled only into Debug, DevStack and test
  targets (`#if DEBUG` or a test-only target), and I0.1's release check
  fails on its symbol in a Release or Staging archive.
- **Compared with Android.** As on Android, the long-lived key stays in
  hardware and one leaked secret says nothing about another epoch.
  Unlike on Android, code that ran as the app earlier cannot have
  computed the secret of an epoch created after it stopped running,
  because that epoch's `E_e` did not exist yet. As on Android, a
  replaced record is kept 7 days for the earlier-secret step and then
  deleted, after which nothing on the phone can compute that epoch's
  secret again.
- **In memory**: `z_e`, the HKDF output and the secret are overwritten
  after the request is built (`SymmetricKey` or explicitly zeroed
  buffers where possible; Swift may still copy), as Android does with
  `next.fill(0)`.
- **Alternatives, and why not** (ID9):
  - (b) a random secret per epoch stored as
    `SecKeyCreateEncryptedData(pub(P), .eciesEncryptionCofactorVariableIVX963SHA256AESGCM, s_e)`:
    the same security and the same per-epoch record (a ciphertext as
    useless without the Secure Enclave as `pub(E)`); its GCM tag would
    give key confirmation, but Apple's format (X9.63 KDF with the
    ephemeral key as shared info, a variable IV) is harder to specify in
    VAULT-MESSAGING and to reproduce in Go vectors. `check_e` gives the
    same confirmation.
  - (c) ECDH of `P` with its own public key: one static value; even with
    the epoch in `info`, one leak of `z` gives every past and future
    epoch offline, and renew would end nothing.
  - (d) stateless: each epoch's point `H_e` hashed to the curve (RFC
    9380) from `key_vault` and the epoch, `z_e = ECDH(priv(P), H_e)`:
    Android's behaviour with no records, but code that ran as the app
    could compute future epochs, a `P` left by a removed app could
    compute every epoch, and hash-to-curve is in neither CryptoKit's
    public API nor Go's standard library.
  - Never make the design "deterministic" by deriving `priv(E_e)` from
    public inputs: `pub(P)` is not secret, so anyone could compute
    `z_e = priv(E_e)·pub(P)` without the phone. Never move `pub(E_e)` to
    the vault: the Secure Enclave would compute on points a host could
    choose.
- **Where it is decided**: the owner approved ID9 on 2026-10-17 with
  VAULT-MESSAGING 0.35.0; vettid-vault then adds the `phone_ios`
  vectors (§7; the values are already in VAULT-MESSAGING §16). Until
  that version is on `master`, I1.4 implements `PhoneSecretSource`
  with a software key in tests only, and no build may enroll a staging
  vault.

### 6.4 Screen capture and the app switcher (FLAG_SECURE equivalents)

iOS has no `FLAG_SECURE`. Three separate protections:

1. **App switcher snapshot**: when the scene leaves `.active`, cover
   the window with a privacy view (logo on navy) before the snapshot is
   taken; remove it on return. Always on. Test: the snapshot in the
   switcher shows only the cover (checked by hand on the iPhone per
   release, and by a UI test asserting the cover exists while inactive).
2. **Recording, mirroring, AirPlay, screen sharing**: observe
   `sceneCaptureState` (iOS 17 trait; `UIScreen.isCaptured` as the
   fallback) and replace content with "Hidden while your screen is
   being recorded or shared" (§14). Always on.
3. **Screenshots**: no public API prevents them;
   `userDidTakeScreenshotNotification` arrives afterwards. A view
   hosted inside the secure layer of a `UITextField` with
   `isSecureTextEntry = true` is left out of screenshots and
   recordings. That is **undocumented behaviour** that may change with
   any iOS release, so: one `SecureContainer` component, used only on
   the screens Android holds secure individually and wherever ID10 says
   (Android `core/ui/…/components/SecureWindow.kt` and its call
   sites), with a self-check at launch (the layer exists) that falls
   back to protections 1 and 2 and logs nothing. "Allow screenshots"
   (§4) turns off only this one. (0.1.11, owner decision of 2026-10-20)
   The connect screens keep it, as on Android: the invitation QR, its
   link, the pasted link and the safety code. (0.1.23, owner decision
   of 2026-10-22) The item screen and the item editor (I3.1) use it
   too, so a screenshot or a recording of them is blocked unless
   "Allow screenshots" is on.

### 6.5 Secret input: no autofill, no third-party keyboards

Mirrors Android `core/ui/…/components/Autofill.kt` and
`SecretKeyboard.kt` (owner decisions of 2026-10-06 and 2026-10-09).

- **Third-party keyboards refused app-wide**:
  `application(_:shouldAllowExtensionPointIdentifier:)` returns `false`
  for `.keyboard` (an `UIApplicationDelegateAdaptor`). A keyboard
  extension with full access could read every field, including visible
  codes.
- **The vault PIN** on an in-app keypad (no keyboard at all); digits
  kept in a zeroizable buffer, never in a `String` that outlives the
  screen.
- **No AutoFill and no "Save Password?"** on the PIN, the credential
  password, recovery and transfer codes, setup codes and the delete
  confirmation: no `.password` / `.newPassword` / `.username` content
  types, no username field beside a password field, and a device test
  that submits each such screen and asserts that neither the AutoFill
  bar nor the save prompt appears. The technique that passes the test
  is recorded in the component's doc comment.
- Autocorrection, spell checking, smart quotes, dashes and inserts,
  inline predictions off on every secret field; no clipboard copy of
  secrets except where Android allows it, and then local-only and
  expiring (`UIPasteboard` with `.localOnly` and `.expirationDate`).

### 6.6 Background limits

iOS has no foreground service and suspends the app within seconds of
leaving the screen.

- **While open**: the relay WebSocket collects (VettIDRelay), as the
  Android app does in the foreground.
- **On leaving**: `beginBackgroundTask` to finish what is in flight
  (persist then ack, §8.3; a lock request; an outbox send), then close
  the socket. Nothing assumes it ran longer.
- **Lock and app lock**: the app-lock timeout counts from the moment
  the scene went to the background, read on return; the vault's own
  locks (VAULT-LOCK, owner check) are the vault's and need nothing from
  the app in the background.
- **Owner check early warning**: local notifications scheduled for 1 h
  before the deadline whenever the deadline is learned, cancelled on a
  check (ANDROID-PLAN §6 owner check, item 5). These work without APNs.
- **Staging time scale** (0.1.2, approved by the owner 2026-10-18;
  STAGING-TIME-SCALE §5.2): as on Android (ANDROID-PLAN §4 "Staging
  time scale"). `time_scale` comes from the descriptor and a transfer
  bundle (VAULT-MESSAGING §11.10.9), is stored per vault, and divides
  the app's own waits when each starts: the early warning above, the
  replaced records' 7 days (§6.3), the old phone's 7 days after a
  transfer and the recovery counter's "unavailable for a day" urgency
  (S8, 0.1.7). Staging builds show the scaled times and "Staging: 1 day =
  1 hour"; a production build refuses any value other than 1 and sends
  nothing.
- **Calls, presence, location**: not before push; their phases say how.

### 6.7 Push: not before APNs

APNs is not set up (no Apple credentials; PUSH-GATEWAY §14.1 item 2).
Until phase P the app never calls `registerForRemoteNotifications`,
never sends `push.register`, and Settings → Notifications says so (§4,
§14). Phase P implements PUSH-GATEWAY §11.2 as written: Apple push or
Off; the notification service extension collecting **without acking**
from a keychain access group shared with the app; the content rules
of `core/notify/…/NotificationContent.kt`; removal of named
notifications on `vault.locking` and `vault.held`; the filtering
entitlement when Apple grants it.

**Sounds** (0.1.29, owner decision of 2026-10-23; the files, their
licence (AGPL-3.0) and the channel mapping are in ANDROID-PLAN §4
Notification modes, 6, "Sounds"). The app bundles `vettid_general.caf`,
`vettid_message.caf`, `vettid_urgent.caf` and `vettid_ringtone.caf`
(CAF, IMA4; target membership of the app and of the extension: keep the files in both; verify in phase P that a sound set by the extension plays). A notification sound longer than 30 s plays the default instead; ours are at most 8 s. The
notification service extension (PUSH-GATEWAY §11.2) and the app's own
local notifications (the owner check's early warning, release notices)
set `content.sound = UNNotificationSound(named:)` locally, by the
notification's category, never from the payload:

| Category | Sound | Level |
|---|---|---|
| Messages | `vettid_message.caf` | `active` |
| Missed calls | `vettid_message.caf` | `active` |
| Requests (approvals) | `vettid_urgent.caf` | `active` |
| Security alarms, daily check | `vettid_urgent.caf` | `timeSensitive` |
| Releases and vault notices | `vettid_general.caf` | `active` |
| Vault activity | none | `passive` |

`timeSensitive` needs the Time Sensitive Notifications capability on the
app ID (on the app and, if the extension sets it, on the `.NotificationService` id too; check at phase P) and in the entitlements (self-service in the developer portal;
Apple does not grant it, §10, 2). `critical` is not used. A sound name
with no bundled file plays the default sound, so a test checks the
files are in the built `.app`. The fallback notification a push shows
when the extension cannot finish uses `vettid_general.caf` (the
gateway's constant). The ringtone is for CallKit's
`CXProviderConfiguration.ringtoneSound`, with iOS calls (later; PushKit
needs APNs and the owner's Apple Team ID); it is bundled now.

### 6.8 Links

Universal Links for `https://account.vettid.org/vault/enroll/…`
(staging: `account.staging.vettid.org`) and
`https://relay.vettid.org/connect`, and the custom scheme
`vettid://connect` (as on Android, ANDROID-PLAN §5 "App Link hosts per
build"). The `apple-app-site-association` files are vettid.org work
(§9.2); the relay's is built into the relay software, specified in
RELAY-PROTOCOL §6.11 (0.10.0). Message links follow VAULT-MESSAGING §10.5: only `https://`
is tappable, after "Open link to <host>?", handed to the system.

## 7. Test vectors

The vault's vectors are authoritative (VAULT-MESSAGING §16); the Swift
code reproduces every value byte for byte. Copy the files into
`Packages/VettIDCrypto/Tests/…/Resources/vectors/` with a `SOURCE.md`
that records the vettid-vault commit and the `sha256sum` of each file,
as vettid-android `core/crypto/src/test/resources/vectors/SOURCE.md`
does. **A vector that stops matching is a stop-and-report item, never
a skip.**

| File (source) | Checks | Android test to mirror | PR |
|---|---|---|---|
| vettid-vault `testdata/vectors/keys.json` | §3.2 keys, kids, ik fingerprint (§10.8) | `core/crypto/src/test/…/VectorsTest.kt` | I0.3 |
| `…/hpke.json` | §4.3 HPKE suite 2 with fixed 64-byte encapsulation randomness | `VectorsTest.kt` | I0.4 |
| `…/envelope_sealed.json`, `…/envelope_session.json` | §5.2 envelopes, padding | `VectorsTest.kt` | I0.4 |
| `…/handshake.json` | §6.3 handshake 0.10.3, key schedule, SAS | `VectorsTest.kt` | I0.5 |
| `…/invite.json` | §6.4 claim bundle, QR JSON, link | `VectorsTest.kt` | I0.5 |
| vettid-android `core/altchan/src/test/resources/vectors/recovery-qr.json` (generated with vettid-vault code; its `SOURCE.md` says how) | recovery and transfer QR parsing | `core/altchan/src/test/…/RecoveryQrVectorsTest.kt` | I0.5 |
| `…/altchan.json` | §11 ETK descriptor, sealed requests, devatt challenge | `VectorsTest.kt` | I0.6 |
| `…/appkey.json` | §11.12.2 app key and signed requests (Android has no copy yet) | — (new) | I0.6 |
| `…/unlock.json`, `…/recovery.json`, `testdata/passwords/verdicts.json` | §11.14 unlock secret per epoch (the Android HMAC form, `phone`), recovery `secrets` string, the open's signing string, password verdicts | `ReleaseRVectorsTest.kt`, `PasswordRulesTest` | I0.7 |
| `…/unlock.json`, object `phone_ios` (VAULT-MESSAGING 0.35.0 §16; values there until the file has them) | §11.14.1 "On an iPhone": the public keys, `z_e`, `info_e`, `unlock_secret` and `check_e` for epochs 1 and 2, the `key_vault` `""` form, the same secrets through the unlock key, `secret_check` and `dek_wrap`; the refusals | — (new) | I0.7 |
| `…/blob.json`, `…/attachment.json` | §5.5 blob seal, §10.5.1 attachments | `BlobVectorsTest.kt` | I0.8 |
| `…/release.json` | §11.10 release manifest | `core/attestation/src/test/…/ReleaseVectorsTest.kt` | I0.9 |
| RELAY-PROTOCOL §9 (values in the spec) | mailbox ids, PASETO deposit token, signed deposit | `core/relay/src/test/…/VectorsTest.kt` | I0.10 |
| `…/calls.json`, `…/leash.json` | calls, LEASH | `CallVectorsTest.kt` | later |

Also: the estimator word lists from vettid-vault
`vms/recovery/common-passwords.txt` and `estimator-words.txt`, at the
recorded commit. CI runs gitleaks with an allowlist for the public
vector values, like vettid-android's `.gitleaks.toml`.

**The `phone_ios` vectors** (generated in vettid-vault with Go's
standard library only, `crypto/ecdh`, `crypto/hkdf` and `crypto/hmac`,
by a reference function that the vectors use and the vault never
calls):

1. **Full ECDH, not a fixed `z_e`**: `priv(P)` = 32 × 0x46,
   `priv(E_1)` = 32 × 0x47, `priv(E_2)` = 32 × 0x48, `key_vault`
   `test-vault-0001`, epochs 1 and 2. The Swift test imports `priv(E)`
   as a software key and `priv(P)` as a software stand-in for the Secure
   Enclave key, computes ECDH in both directions and compares every
   intermediate value (`info_e` in hex, so that an encoding mistake
   shows).
2. **A transfer's new phone**: `key_vault` `""`, the same keys, epoch 1.
3. **Not the Android form**: the outputs differ from `phone.epoch_*`
   (guards against the wrong label).
4. **End to end**: the iPhone secrets through the existing unlock key,
   `secret_check` and `dek_wrap` derivation, so that one vector shows
   the iPhone secret working with the vault's unchanged formulas.
5. **Refusals**: a `pub(E)` off the curve (x valid, y + 1), the point at
   infinity, compressed and truncated encodings, epoch 0, a `key_vault`
   containing 0x00.

Device and unit tests that go with them are in I1.4.

## 8. Phases and PRs

Small PRs on `vettid-ios`, one topic each, every one with its tests.
Exit tests run on the simulator unless they say "iPhone". "Dev stack"
is vettid-vault's `cmd/devstack` (§12). Spec sections are
VAULT-MESSAGING unless named.
Each phase is tracked as an issue in vettid-ios: I0 #34, I1 #35,
I2 #36, I3 #37, I4/P/later #38.

### I0 — Skeleton, CI, crypto core

| PR | Contents | Spec | Mirror | Acceptance |
|---|---|---|---|---|
| I0.1 | Tag `legacy-v1-final`, branch `legacy/v1`; remove the old code from `master`; new project: app target, four configurations (§5), empty packages, `Config/Signing.xcconfig` with `TEAMID_TBD`; README and CLAUDE.md updated; CI on GitHub's macOS runners (actions pinned by SHA): `swift test` per pure package, `xcodebuild test` on a simulator, SwiftLint, gitleaks, a release-check script (Release and Staging archives built unsigned; fail on TEST symbols, dev-stack or other-environment hosts and keys) | — | vettid-android `.github/workflows/ci.yml`, `app/build.gradle.kts` `check*Apk` tasks | CI green; the four configurations install side by side on a simulator; the release check fails on a planted TEST string |
| I0.2 | `VettIDUI`: tokens, fonts, SF Symbol table, components, the drawer, the debug component gallery and screen catalog | ANDROID-PLAN §3 | `core/ui/…/theme/*`, `components/*`, `app/src/debugTools/…/ScreenCatalog.kt` | Gallery on the iPhone matches the Android gallery in both themes; Dynamic Type at the largest size does not clip |
| I0.3 | Bytes, base64, strict JSON, ULID, SHA-256/HMAC/HKDF, XChaCha20-Poly1305, Ed25519 (libsodium), X25519, Argon2id, kids, ik fingerprint | §3.2, §4.1–§4.4, §10.8 | `core/crypto` files of §5 | `keys.json`; strict JSON refuses duplicates and unknown members as Android does |
| I0.4 | ML-KEM-768 C target, X-Wing, HPKE base mode with a test-only derandomized hook; envelope v2 sealed and session; padding | §4.3, §5 | `hpke/Hpke.kt`, `envelope/*` | `hpke.json`, `envelope_*.json`; the derand hook absent from Release (release check) |
| I0.5 | Handshake, key schedule, epochs, rotation, invite and claim blob, QR parsing | §6.1–§6.6 | `session/*`, `invite/Invite.kt`, `ClaimBlob.kt` | `handshake.json`, `invite.json`, `recovery-qr.json` |
| I0.6 | Alternate channel crypto: descriptor, sealed requests, devatt challenge, capabilities parsing, app key request signing | §11.1–§11.4, §11.7, §11.10.9, §11.12.2 | `altchan/AltChannel.kt`, `Capabilities.kt`, `DeviceAttest.kt` | `altchan.json`, `appkey.json` |
| I0.7 | Release R: unlock secret (the HMAC form behind `PhoneSecretSource`, for the vector; the iPhone form's derivation and record format from software keys), recovery strings, password rules and estimator | §11.14.1, §11.14.6–§11.14.8 | `altchan/ReleaseR.kt`, `PasswordRules.kt` | `unlock.json` (`phone` and `phone_ios`, refusals included), `recovery.json`, `verdicts.json` at the vault's floor and the app's |
| I0.8 | Credential (UTK/LTK sealing, CEK rotation), blob seal, grant seal | §3.5, §5.5, §10.5.1, §10.12 | `credential/Credential.kt`, `grant/GrantSeal.kt` | `blob.json`, `attachment.json`; credential round trips against the Go reference (`vaultctl`) outputs where §16 has none |
| I0.9 | `VettIDAttestation`: Nitro document, PCRs, release manifest, canary manifest | §11.2, §11.10.1, §11.10.7, §13.9 | `core/attestation/*`, `CanaryManifest.kt` | `release.json`; a real staging attestation document (fetched from the staging enclave route) verifies against the pinned Nitro root |
| I0.10 | Relay auth, PASETO v4.public, mailbox ids | RELAY-PROTOCOL §3–§5, §9 | `core/relay/…/RelayAuth.kt`, `Paseto.kt`, `DepositToken.kt` | RELAY-PROTOCOL §9 values |

**Exit I0**: every vector passes byte for byte; CI green on `master`.

### I1 — Transport, keys, enrollment, unlock, settings, lock

| PR | Contents | Spec | Mirror | Acceptance |
|---|---|---|---|---|
| I1.1 | Relay client (HTTP, WebSocket and long-poll collect, ack, blobs, claims) and member API client | RELAY-PROTOCOL §6; MEMBER-API "Vault (alternate channel)" | `core/relay/*`, `core/altchan/MemberApiClient.kt`, `MemberAuth.kt` | Tests against `URLProtocol` fakes for every error of RELAY-PROTOCOL §7 |
| I1.2 | Vault client: typed §10 calls, dedupe, outbox, sync events; `FakeVault` | §8, §10.1–§10.3 | `core/vault/*`, `core/testing/…/FakeVault.kt` | Unit tests per call; retry and dedupe as §8.2/§8.6 |
| I1.3 | `VettIDTesting`: the TEST iOS attester (Swift port of vettid-vault `internal/enclavetest/devattest.go`: TEST Apple CA from `TestKey(P-384, 0x51)` (root) and `TestKey(P-384, 0x52)` (intermediate), as Android ports `TestKey` for its TEST CA, App ID `TESTTEAM00.com.vettid.app`; certificates with `swift-certificates`, test targets only), dev stack helpers and a runner script | §11.7 | `core/testing/…/TestAndroidAttester.kt`, `DevStack.kt` | **A2-equivalent**: an XCTest on the simulator enrolls a vault on the dev stack, unlocks, and exchanges a message with the `vaultctl` peer |
| I1.4 | `VettIDKeys`: Secure Enclave app key, seed wrapping, encrypted file store, the real App Attest attester, the phone key of ID9, the "keys usable" check | §11.7, §11.12.2, §11.14.1; §6.1–§6.3 | `core/keystore/*`, `core/data/…/KeystoreFileStore.kt`, `PhoneSecrets.kt`, `core/altchan/…/Attester.kt` | iPhone tests: the app key and the seed keys sign and agree with the phone locked (after first unlock); the phone key's ECDH fails while the screen is locked and works once it is unlocked; a passcode change, and turning the passcode off, keep the phone key; a deleted key is detected as unusable; after removing and reinstalling the app, the first-run cleanup removes the keychain items and the old phone key is not used; the iPhone locked during a request (and a start before first unlock) gives "Unlock your iPhone" and a retry, never the "no longer holds the keys" path, with every key and record kept, and the typed PIN dropped and asked for again; a launch before first unlock (a background launch after a reboot) deletes nothing in the first-run cleanup; a lookup during which protected data goes away is not "missing"; Release and Staging archives contain no software `PhoneSecretSource` (release check). Unit tests (software source) for every lost-answer case of §6.3: a renew's answer lost then an unlock; a renew's answer lost then a retry; (0.1.3) a lost `pin.change` and a lost `credential.password.change` decided by a resend of the same request and by `credential.version` (applied; not applied after `exp`; undecided before), then after a restart, with no owner check or credential operation sent while unresolved and the two-step unlock prompt; (0.1.4) a credential operation in flight delaying or refusing a change, an update refused while unresolved, `stale_credential` as not applied, `ok` with the previous PIN leaving the change undecided, a renew candidate tried with the previous PIN first, the uncertain PIN after an ended check, and the one-time app-wide notice; two renews with the first answer lost; a crash between storing the record and sending; a fifth change while four candidates are unconfirmed is refused before sending and no candidate is dropped; a replaced record kept 7 days after the confirmation and deleted then (and at a wipe), not extended by a clock set back; the earlier-secret step only from the member's tap, moving back only on `ok` or `transfer_incomplete`, not on `bad_pin`, with the History entry and the new-secret prompt after `ok`; after each, the vault (the Go reference client's rules, or a fake that follows `vault/opendek.go`) is reachable. App Attest attestation verifies with vettid-vault's `devattest` against Apple's root in a test harness (VA1). **Merges only after VAULT-MESSAGING 0.35.0 (ID9, approved 2026-10-17) is on `master`** |
| I1.5 | Secure input and capture protection: keypad, secret fields, keyboard refusal, the three protections of §6.4, backup exclusion | §6.4, §6.5 | `core/ui/…/Autofill.kt`, `SecretKeyboard.kt`, `SecureWindow.kt`, `core/data/…/ScreenshotAllowance.kt` | iPhone: no AutoFill bar or save prompt on any secret screen; a third-party keyboard is not offered; switcher shows the cover; recording hides content |
| I1.6 | Onboarding: setup code by QR, typed or Universal Link; PIN; credential password; enroll; first unlock; Finish setup | §11.3, §11.12.1, §11.14.1, §11.14.7, §3.5.5; ENROLLMENT-CODES §3–§4 | `feature/onboarding/…/OnboardingScreens.kt`, `OnboardingViewModel.kt`, `core/altchan/…/AltChannelFlow.kt`, `SetupCode.kt`, `core/data/…/account/SetupLinkInbox.kt`, `FinishSetupGate.kt` | Screen-catalog entries for every state; ID8's refusal for a pre-R descriptor |
| I1.7 | Unlock, owner check and held screen, lock (VAULT-LOCK as Android implements it), app lock, local wipe rules | §3.6, §11.4, §11.8, §12, VAULT-LOCK §3–§4 (normative in §11.5 and the "release L" rules) | `feature/onboarding/…/UnlockScreen.kt`, `OwnerCheckScreen.kt`, `core/data/…/vault/OwnerCheck*.kt`, `Lock*.kt`, `HolderWatch.kt`, `RefusalWatch.kt`, `wipe/LocalWipe.kt`, `lock/AppLock.kt` | The owner-check tests of ANDROID-PLAN §6 item 9 with the dev stack's clock; wrong PIN, wrong password, ten-failure lock; lock pending and confirmed |
| I1.8 | Settings, account card, avatar sheet, change name, credential screen with backup on/off, vault status with ID15, release updates and What's new, Change PIN, New phone secret, Help | §10.8, §11.10, §11.13, §11.14.9; RELEASE-UPDATES §2–§3 | `feature/settings/*`, `feature/credential/*`, `core/data/…/ReleaseUpdate.kt`, `ReleaseLog.kt`, `feature/onboarding/…/ReleaseUpdateScreen.kt`, `WhatsNew.kt` | Release approval with two assertions in one unlock on the dev stack; texts equal Android's |

**Exit I1**: (a) simulator, DevStack: fresh install → enrolled vault
with credential (TEST attester) → lock → unlock, all through XCUITest.
(b) **iPhone, Staging**: fresh install → enrolled on staging with the
real App Attest and the Secure Enclave phone key → owner check → lock
→ unlock → approve a release update. (b) needs ID3, ID9, VA2 and the
owner prerequisites of §10.

### I2 — Connections, messaging, approvals, feed, History; then photos

| PR | Contents | Spec | Mirror | Acceptance |
|---|---|---|---|---|
| I2.1 | Connections, invitations (QR drawn with Core Image, scanned with AVFoundation; links), safety code, connection detail, favourites | §6.4, §10.4, §10.4.1, §10.8 | `feature/connections/*`, `core/data/…/social/*`, `core/ui/…/QrCode.kt`, `QrScanner.kt` | A4-equivalent on the dev stack with the `vaultctl` peer: invite, same safety code, both approve |
| I2.2 | Messages and conversation, paging, link rule | §10.5, §10.5.2 | `feature/messages/MessagesScreen.kt`, `MessagesViewModels.kt`, `core/data/…/social/MessagePaging.kt` | Messages both ways with the peer; only `https://` links tappable |
| I2.3 | Approvals, the Notifications screen (feed), History with search and export | §10.4.1, §10.9, §10.12, §10.13 | `feature/approvals/*`, `feature/notifications/*`, `feature/history/*`, `core/data/…/feed/*`, `History*.kt` | Approvals of ANDROID-PLAN §4; export via Save to Files |
| I2.4 | Photo attachments and the viewer | §5.5, §10.5.1; ANDROID-PLAN §4 "Photo attachments" | `core/media/*`, `feature/messages/Photo*.kt`, `core/data/…/social/Attachments.kt`, `core/vault/AttachmentApi.kt` | Metadata stripped (EXIF and GPS absent in the sent JPEG); bounded decoding refuses oversized and mistyped files; the memory cache is empty after lock; a data-directory scan finds no image |
| I2.5 | Shared profile and the camera-only profile photo | §10.8 | `feature/settings/ProfileScreens.kt`, `PhotoCapture*.kt`, `PhotoCrop.kt` | JPEG ≤ 65,536 bytes without EXIF |

**Exit I2** (iPhone, Staging): an iPhone and an Android phone connect,
exchange messages and photos both ways, and approve each other's asks.

### I3 — Items, transfer, recovery

| PR | Contents | Spec | Mirror | Acceptance |
|---|---|---|---|---|
| I3.1 | Items: data, secret and critical; templates; tags; TOTP | §10.7, §10.8; VAULT-ITEMS | `feature/items/*`, `core/data/…/items/*` | Critical items need the password; values in the secure container; (0.1.23) the item editor too, inside the `SecureContainer` like the item screen: screenshots and recording of it are blocked unless "Allow screenshots" is on (§6.4); typing, the keyboard and VoiceOver work inside the container (checked on the iPhone) |
| I3.2 | Share rules, grants, critical-item use by a connection | §10.12, §10.13 | `feature/items/RuleEditScreen.kt`, `SharingScreens.kt`, `core/data/…/items/Sharing*.kt` | Rules against a second vault |
| I3.3 | Transfer out and in: QR and pasted code, Finish the move, the old phone keeping its keys until confirmed (after 7 days, until its vault answers), the new phone's 11 minutes, the old phone's token renewal before the approval, the signer-class texts across platforms | §6.7.1, §11.7.1 ("Across an iOS app"), §11.14.10 | `feature/settings/TransferOut*.kt`, `feature/onboarding/MoveScreens.kt`, `TransferInViewModel.kt`, `FinishMove.kt`, `core/data/…/FinishMoveRunner.kt` | iPhone → Android → iPhone on staging; the old phone erases itself on confirmation |
| I3.4 | Recovery: scan or type the code, claim, register, the one screen for PIN and password, the answers, the wait | §11.11, §11.11.10, §11.14.3–§11.14.6, §11.14.11 | `feature/onboarding/RecoverTypeScreen.kt`, `RecoverViewModel.kt`, `RecoveryOpen.kt`, `feature/settings/RecoveryStatusText.kt` | A recovery on staging onto a second iPhone; typed and scanned entries make equal requests |

**Exit I3**: the flows above on staging, with History entries equal to
Android's.

### I4 — Hardening

VoiceOver and Dynamic Type pass on every screen; offline and error
states; an audit like vettid-android `docs/A6-AUDIT.md`; TestFlight
external testing of VettID Staging. Exit: a TestFlight build the owner
accepts.

### P — Apple push (after the owner's APNs actions)

§6.7 and PUSH-GATEWAY §11.2: the notification service extension and
app group, `push.register{platform: "apns"}`, `push.confirm`, the
content rules, removal on lock and hold, interruption levels. Needs
the APNs key in the gateway (PUSH-GATEWAY §14.1 2.3) and the extension
App IDs. Exit: a locked iPhone shows a message notification from a
staging vault, and its named notifications disappear when the vault
locks.

### Later — following Android

In the order STAGING-DEVELOPMENT-PLAN §5 gives them, each when its
Android counterpart is done: **calls** (CALLS-PLAN; CallKit, ringing
by PushKit, which needs APNs; the media stack and frame encryption of
CALLS-PLAN §12; `calls.json`), **devices and agents** (§6.8, §10.11;
`leash.json`), **wallet** (§10.18), **location** (§10.16; ANDROID-PLAN
§6 location notes), **presence** (§10.17).

### What blocks what

| Phase | Blocked by |
|---|---|
| I0 | nothing |
| I1 on the simulator (exit a) | nothing (TEST attester, software phone key) |
| I1.4 merge | VAULT-MESSAGING 0.35.0 (ID9, approved) on `master` |
| I1 on an iPhone against the dev stack | VA3 |
| I1 on an iPhone against staging (exit b), and everything after on a device | ID3 (team ID), VA2 (staging App ID), ID9; VA1 recommended first |
| I3.3 transfers between Android and iOS | VA4 (in the same staging release as VA2 if possible) |
| P, calls ringing | APNs (owner) |
| iOS in production | VA2 and VA4 in a production release (a C6 entry), VA1 passed |

## 9. Work outside vettid-ios

### 9.1 Vault work for App Attest (vettid-vault, on Linux)

Done by an agent on the Linux machine, each its own vettid-vault PR,
reaching staging in a staging release. The Mac agent does none of it;
it may open vettid.org issues when it finds what is needed.

| # | Task | Why | Blocks |
|---|---|---|---|
| VA1 | **A real-device check of `verifyIOS` and `verifyIOSAssertion`**: a test like `TestRealAndroidChains` that reads `vms/devattest/testdata/real/*.ios.json` (key id, attestation, a challenge, assertions; ignored by `.gitignore` unless added on purpose) and verifies them with the pinned Apple root and the production App ID. The Mac agent produces the files from the test iPhone with a DevStack-only export (never in Release or Staging) | The verifier has only seen synthetic chains | Production; recommended before I1 exit (b) |
| VA2 | **The iOS App ID per channel**: a release constant `ios_app_id` in the channel files (`<team>.com.vettid.app` in production, `<team>.com.vettid.app.staging` in staging), replacing the constant `iosAppID` in `enclave/config.go`; exactly one value per channel, the other channel's value malformed (as `android_package`, VAULT-MESSAGING §11.10.8); a C6 line in the release log (VAULT-RELEASES §3.4) | Today staging and production images accept the same App ID; the staging app could not be told apart, and the team ID is not yet confirmed | I1 exit (b), everything on an iPhone against staging |
| VA3 | **iOS members of the dev device policy** (devenclave builds only, `make check-tcb` proves release builds cannot load them): `apple_app_attest_root: true` (the pinned Apple root beside the TEST CA), `ios_app_ids: ["<team>.com.vettid.app.dev", "<team>.com.vettid.app.devstack"]`, `ios_development_environment: true` (accept the `appattestdevelop` aaguid). Strict parsing as for the Android members | No relaxed iOS attestation exists on the dev stack | Device tests against the dev stack |
| VA4 | **Signer continuity across an iOS app**: keep the last recorded Android signer when the vault moves to an app without one, so a later move to an Android app of another signer is `signer_changed`, confirmed and audited (VAULT-MESSAGING §11.7.1 "Across an iOS app"; decided 2026-10-11; **built in vettid-vault #142**, reaches staging with the next staging release; the same signer as the kept one is `device.signer_bound`, the kept signer is in the vault's DEK-encrypted state and not shown by `device.list`) | Decided as a vault change before the first release that accepts an iOS app | I3.3 across platforms; production |
| VA5 | **e2e coverage of release R with the iOS TEST attester**: enroll, unlock, recovery register and open (with `device_assertion`), a transfer's `hs.init` in both directions between Android and iOS attesters, a release approval with two assertions | The e2e iOS tests predate release R | VA2's release |
| VA6 | **No minimum app version on iOS, said explicitly**: App Attest carries no app version, so `android_min_version_code` (§11.14.14) has no iOS counterpart in the enclave; a test that an iOS attestation is not refused by it | Prevents a later surprise | — |

### 9.2 vettid.org work (owner approval)

- VAULT-MESSAGING: the iOS paragraph of §11.14.1 and its vectors (ID9;
  recorded in 0.35.0, approved 2026-10-17), then the `phone_ios` object in
  vettid-vault's `unlock.json`; §11.7's iOS bullet for VA2 and VA3; correct the "not built" wording
  of VAULT-PLAN §7 risk 6 and STAGING-DEVELOPMENT-PLAN §5 row I.
- `apple-app-site-association` on `account.vettid.org`,
  `account.staging.vettid.org` and `relay.vettid.org` (`applinks` for
  the enrollment and connect paths, with the team ID). The relay's
  (`/connect` only) is specified in RELAY-PROTOCOL §6.11 (0.10.0) and
  built into vettid-relay; it reaches `relay.vettid.org` when the owner
  deploys that relay release.
- A staging release with VA2–VA5 (VAULT-RELEASES), and later the
  production release that pins the iOS App ID (C6).
- Phase P: the APNs secrets of PUSH-GATEWAY §14.1.

## 10. Owner prerequisites

1. **Apple Developer Program** (the owner has an account): the **team
   ID** `3X25CJ86MV` (confirmed 2026-10-17) into
   `Config/Signing.xcconfig` (ID3) and into VA2. If the membership later converts to an
   organisation (PUSH-GATEWAY §14.1 question 12), confirm the team ID
   stays the same: a new team ID is a new App ID, and production vaults
   would need a release pinning both (C6) before any build moves.
2. **App IDs** in the developer account: `com.vettid.app`,
   `com.vettid.app.staging`, `com.vettid.app.dev`,
   `com.vettid.app.devstack`, each with App Attest and Associated
   Domains; Push Notifications, App Groups, Time Sensitive
   Notifications and the `.NotificationService` extension ids at
   phase P.
3. **Signing on the Mac**: Xcode signed in to the account, automatic
   signing. The Mac agent never creates, exports, reads or asks for
   certificates, `.p12`, `.p8` or provisioning files.
4. **Distribution** (ID13): App Store Connect records for VettID
   Staging (TestFlight internal only) and later VettID; the tester list.
   The owner archives and uploads, or tells the agent to run the
   upload with the account already signed in to Xcode.
5. **Test iPhones**: the connected one, registered for development;
   a **second iPhone** (or an Android test phone) is needed for
   connections, transfer and recovery. iOS 17 or later, one on the
   newest iOS. Test use only.
6. **Decisions** ID2, ID3, ID9, ID10, ID13 (§2).
7. **Later**: the APNs key (phase P).

## 11. Coordination rules for the Mac agent

1. **It works only in `vettid-ios`.** It clones vettid-android,
   vettid-vault and vettid.org to read; it never pushes, comments or
   opens PRs there, except issues and PR comments on vettid.org (rule 4).
2. **Small PRs**, one per row of §8, each with its tests passing
   locally (`swift test`, `xcodebuild test`) before it is pushed; PR
   titles name the phase (`I1.4: Secure Enclave keys and App Attest`).
   It never merges: the owner merges.
3. **Public text** (commits, PRs, issues, code comments) never mentions
   reviews, finding ids, private files, local paths outside the repo, or
   device serials. It cites specifications by document and section.
4. **Spec questions go to the owner**, as a vettid.org issue (title
   starting `IOS-PLAN:`) or a comment on the relevant vettid.org PR,
   never as an edit to a specification. Where the spec is silent, the
   agent chooses, marks it "(chosen; not in the spec)" in the PR, and
   asks.
5. **Commit trailers and PR bodies**: every commit ends with the
   `Co-Authored-By:` line for the model and the `Claude-Session:` line
   with its session link, as its harness provides them; every PR body
   ends with the "Generated with Claude Code" line and the session
   link. No other attribution.
6. **Secrets**: none in the repository. The team ID appears only in
   `Config/Signing.xcconfig`. No API keys, no signing material, no
   member data, no real attestation objects except where VA1 says.
7. **Vectors**: a vector that fails is a stop-and-report item; the
   agent never edits a vector or skips its test.
8. **Machine load**: one `xcodebuild` at a time, test parallelism
   capped (`-parallel-testing-worker-count 2`), one dev stack at a time,
   torn down when done.

## 12. Getting started on the Mac

1. **Clone** (HTTPS or SSH):
   `vettid/vettid-ios` (work), `vettid/vettid-android` (reference,
   branch `master`), `vettid/vettid-vault` (vectors and the dev stack,
   branch `main`), `vettid/vettid.org` (this plan and the specs,
   branch `master`). Keep the reference clones read-only.
2. **Tools**: the current release of Xcode (26 or later) with its
   command-line tools and an iOS 17+ simulator runtime; Go at the
   version in vettid-vault's `go.mod` and Docker (for the dev stack's
   LocalStack); SwiftLint and gitleaks (Homebrew). Record the Xcode
   version in vettid-ios's README with I0.1.
3. **Team ID**: set `DEVELOPMENT_TEAM` in `Config/Signing.xcconfig`
   (placeholder `TEAMID_TBD` until the owner gives it). Nothing else
   carries it.
4. **Tests on the simulator**:
   `xcodebuild test -project VettID.xcodeproj -scheme VettID -destination 'platform=iOS Simulator,name=iPhone 16' -parallel-testing-worker-count 2`;
   pure packages: `swift test --package-path Packages/VettIDCrypto`.
5. **Tests on the connected iPhone**: unlock it, trust the Mac, enable
   Developer Mode; find it with `xcrun xctrace list devices` (or
   `xcrun devicectl list devices`); then
   `xcodebuild test -project VettID.xcodeproj -scheme VettID -configuration Debug -destination 'platform=iOS,id=<device id>' -allowProvisioningUpdates`.
   Device-only tests (Secure Enclave, App Attest, keyboard and capture
   checks) live in a test plan `Device.xctestplan` and skip on the
   simulator.
6. **Dev stack** (from I1.3): in the vettid-vault clone,
   `go run -tags devenclave ./cmd/devstack` (vettid-vault README "Local
   dev stack for app development"); the simulator reaches it on
   `localhost`. That it runs on macOS is not yet established: the first
   step of I1.3 is to try, and to report in a vettid.org issue if it
   does not.

## 13. Risks

1. **The secure-layer screenshot technique** (§6.4.3) is undocumented
   and can break with an iOS update. Mitigation: one component, a
   self-check, protections 1 and 2 always on.
2. **App Attest depends on Apple** at attestation time (enrollment,
   transfer, recovery). An Apple outage delays those, not unlocks.
3. **App Attest attests the app, not the device's integrity**: a
   jailbroken phone can still produce valid attestations. The same
   trust in the published app as §11.7 "Rationale"; confidentiality
   never depends on it.
4. **Team ID changes** strand vaults unless a release pins both App IDs
   first (§10 item 1).
5. **No background delivery before APNs**: members see activity only
   when they open the app. Said in Settings; phase P resolves it.
6. **Two implementations drift**: every text, rule and state comes from
   the Android code and the specs; screen catalogs on both platforms
   make differences visible.

## 14. Draft texts (iOS-only)

Every other text is the Android app's.
(0.1.3) That includes the lost-answer texts of a PIN or password
change (ANDROID-PLAN 0.1.45); the draft `ios_` texts go once they are
approved.

- **No secure hardware / App Attest unsupported**: "This iPhone can't
  keep your vault's keys in its secure hardware, so VettID can't set up
  a vault on it."
- **Apple unreachable at attestation**: "VettID couldn't reach Apple to
  confirm this is the genuine VettID app. Check your connection and try
  again."
- **Release too old (ID8)**: "This vault's release is too old for the
  iPhone app. It will be updated soon; try again later."
- **Capture hiding**: "Hidden while your screen is being recorded or
  shared."
- **Notifications before APNs**: title "Apple push: not available yet";
  body "Notifications on iPhone need Apple push, which VettID hasn't
  turned on yet. Until then, VettID shows new activity when you open
  it, and reminds you before your daily check is due."
- **Installed from (ID15)**: "Installed from: Apple (App Store or
  TestFlight)" / "Installed from: Xcode (development)"; secondary
  "Apple App Attest confirms this is the VettID app."
- **Help → Privacy (ID18)**: "When you set up, move or recover a vault,
  your iPhone asks Apple to vouch for the VettID app. Apple learns that
  VettID was set up on an iPhone, nothing about your vault."
- **A signer change on a move from an iPhone to Android (§11.7.1 "Across
  an iOS app", VA4; approved 2026-10-23)**, shown on the iPhone before
  the PIN when `device.transfer.pending.signer_changed` is true because
  the vault's kept Android signer differs from the new phone's. Title
  the same as Android's: "The new phone has another
  version of VettID". Body `data_transfer_signer_body_iphone`: "The new
  phone's VettID *A*. That is not the version your vault used on Android
  before. Continue only if you installed it yourself." with *A* as
  Android's, in ANDROID-PLAN "Signing and the two distributions", "As built", "The transfer confirmation": "was
  installed from Google Play (signed by Google)", "was installed from
  F-Droid or direct (signed by VettID)", "is a development build" or
  "has a different signer". Continue and Cancel as there.
- **Phone locked during a request (§6.3; approved 2026-10-17)**:
  "Unlock your iPhone, then try again."
- **Four unconfirmed changes (§6.3; approved 2026-10-17)**: "Unlock your vault first, then
  try again. VettID needs to confirm your last change before it can
  make another."
- **Help → Keyboards (ID11)**: "VettID uses only Apple's keyboard, so
  that other keyboards never see your PIN, password or codes."
- **Camera blocked for the profile photo (§4; approved 2026-10-21)**,
  `ios_settings_photo_capture_permission_blocked`: "The camera is
  turned off for VettID. To take your profile photo, open the app's
  settings and turn on Camera." with the action **Open settings**
  (`settings_photo_capture_open_settings`, Android's), which opens the
  app's page in Settings. Shown when camera access is "denied" or
  "restricted"; "not yet asked" asks (`settings_photo_capture_permission_title`
  and `_body`, Android's).
- **Items: secret items on an iPhone (I3.1; approved 2026-10-22)**, as
  Android's `items_sensitivity_secret_note` and `items_secret_hidden_body`
  with the way of confirming changed:
  `ios_items_sensitivity_secret_note`: "Hidden until you reveal it with
  Face ID, Touch ID or your iPhone passcode; every reveal is recorded";
  `ios_items_secret_hidden_body`: "Its values are hidden. Revealing them
  asks for Face ID, Touch ID or your iPhone passcode and is recorded in
  your history."
