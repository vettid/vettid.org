---
title: ANDROID-PLAN
status: draft
version: 0.1.52
date: 2026-10-20
changelog:
  - 0.1.52: approved by the owner (2026-10-19, 2026-10-20) (VAULT-MESSAGING
    0.50.0). §4 **"Event titles"**: a plain title for every event the
    vault sends, in Notifications, system notifications and History,
    with History's detail lines; hidden in History: `recovery.open`
    (its outcome becomes the matching attempt's detail, matched by
    time), `device.unlinked_sent` and `drop.call_glare`; one notification per
    recovery (`recovery.completed`; `credential.recovered` and
    `recovery.device_paired` History only, as is `vault.pin_changed`);
    a failed recovery attempt notifies "Someone tried to recover your
    vault (attempt n of 10)"; "Daily check" in every text, so the
    category "Unlocks and owner checks" becomes "Unlocks and daily
    checks"; "Vault identity key rotated" becomes "Your vault's keys
    were renewed" and "Credential rotated" "Your credential was
    renewed"; "An agent used <item>" for `leash.item.run` and
    `leash.item.proxy`, with detail lines limited to what
    VAULT-MESSAGING §10.11 states; `leash.item.changed` reads "You
    changed how an agent may use <item>", since the member makes that
    change (approved by the owner 2026-10-19). Channels (approved by the
    owner 2026-10-19): a failed `recovery.attempt`,
    `recovery.counter_unavailable` and `recovery.change_required` notify
    on Security alarms (§4 Notification modes, 7). §4 Notifications, 4
    and "Owner check and status" point to it.
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
    drafts remain. §4 "Recovery and unlock from release R": "Cancelling
    the recovery…" (`unlock_recovery_cancelling`) while a cancel from the
    app runs, approved by the owner 2026-10-20
  - 0.1.51: owner decisions 2026-10-19 (VAULT-MESSAGING 0.48.0;
    vettid.org #358 part 1). §4 "A lost answer to New credential": the
    holder's `credential.reset` is sent and decided as a change is
    (nothing else in flight, the pre-check with its `key` recorded, an
    `exp`, the same request resent, decided by `credential.version`);
    every other credential operation waits for the decision; draft
    texts. "New credential" is hidden in Settings → Security →
    Credential until this is implemented and tested. Tests follow
  - 0.1.50: owner decisions 2026-10-19 (VAULT-MESSAGING 0.47.1;
    vettid.org #358 part 2). §4 "A lost answer to a PIN or password
    change", "Sent with the vault's current blob": no answer to the
    pre-check shows the plain `data_failure_network` text, not the
    "unreachable" text (nothing was sent); an error answer, an answer
    without a version or `exists: false` counts as "differs". §4
    "Transfer": during a credential alarm, `credential.version` before
    a rotation and on `rotation_required` / `credential_frozen`, then
    fetch, keep, acknowledge and retry the rotation once. Tests follow
  - 0.1.49: owner decision 2026-10-19 (STAGING-TIME-SCALE 0.1.1). §4
    "Staging time scale": the recovery counter's "unavailable for a
    day" urgency (S8, 24 h) is one of the app's scaled waits, and its
    text computes both durations
  - 0.1.48: approved by the owner 2026-10-19 (VAULT-MESSAGING 0.47.0;
    vettid.org #347). §4 "A lost answer to a PIN or password change":
    `credential.version` before a change or a renew, with the blob
    refreshed when it differs; a renew's own refusal decides it. No new
    text. Tests follow
  - 0.1.47: approved by the owner 2026-10-18 (VAULT-MESSAGING 0.46.0).
    §4 "A lost answer to a PIN or password change": an unanswered
    `vault.secret.renew` is recorded and decided by `credential.version`
    before a PIN change is sent, with "Lock and unlock now" when the
    version cannot decide (approved text); a pending credential request
    is settled only by its answer or a vault answer's `ts`, with one
    `credential.version` allowed to obtain a vault time; "Finish the
    move" is refused while a change is unresolved or a PIN uncertain.
    Tests follow
  - 0.1.46: approved by the owner 2026-10-18 (VAULT-MESSAGING 0.45.0
    §11.14.9 "A lost answer"). §4 "A lost answer to a PIN or password
    change", corrected and completed:
    - a change is sent only with no credential operation in the outbox
      or awaiting its answer, and the marker refuses a second change;
    - the gate refuses at once with the right text;
    - release updates (and every lock-and-unlock flow outside the
      two-step unlock) are refused while a change is unresolved;
    - `stale_credential` to a change means not applied;
    - `ok` with the previous PIN no longer decides;
    - after `device_secret`, the other candidates are tried with the
      previous PIN before the new PIN is asked for;
    - "ended without a decision" offers no retry that sends secrets, and
      after a PIN change keeps the PIN uncertain until a two-step unlock;
    - the decision is shown once, app-wide.
    New draft texts. Tests follow
  - 0.1.45: approved by the owner 2026-10-18 (vettid.org #338; VAULT-MESSAGING
    0.44.0 §11.14.9 "A lost answer"). §4 "Recovery and unlock from release R": **a
    lost answer to a PIN or password change** is decided, not repeated:
    an unresolved-change marker in `account.bin` before the send, an
    `exp` of 10 minutes by the vault's clock, the same request resent
    while `exp` has not passed, `credential.version` to decide applied
    (version + 1) or not applied (same version after `exp`), no other
    change, owner check or credential operation while unresolved, no
    `stale_credential` retry with typed secrets for these two types, and
    an unlock that asks for the previous PIN, then for the new one only
    after `device_secret`. Draft texts, shared with the iPhone app. Tests
    follow. Today's app (master b54685f) shows a generic failure, and
    the member's retry spends an owner-check or password attempt
  - 0.1.44: **approved by the owner 2026-10-18** (STAGING-TIME-SCALE 0.1.0,
    VAULT-MESSAGING 0.43.0). New §4 "Staging time scale": the app reads
    `time_scale` from the descriptor and the transfer bundle, stores it
    per vault, divides its own waits by it (the owner check's early
    warning, replaced records' 7 days, the old phone's 7 days, the
    7-day unreachable screen, the update banner's 24 h), shows the
    scaled times and "Staging: 1 day = 1 hour" in staging builds, and
    in production builds refuses any value other than 1
  - 0.1.43: approved by the owner 2026-10-17, texts as drafted (owner decisions of
    2026-10-17; VAULT-MESSAGING 0.36.0). §4 "Recovery and unlock from
    release R": the phone key's secret gets 32 fresh random bytes per
    epoch (form 2, the same Keystore key), kept in `account.bin` with
    the epoch in one atomic write, and nothing sent unless that write is
    durable; at epoch 1 the key, then the record, then the request;
    current, candidate (at most four; a fifth change refused until the
    member unlocks again) and replaced records; the unlock order;
    replaced records deleted 7 days after confirmation; "Try the earlier
    secret" on the "no longer holds the keys" screen, only from its
    button, moved by `ok` and never by `bad_pin`, followed by a History
    entry and a prompt for a new phone secret; only a definite loss of
    the key or of `account.bin` counts as lost keys; a build refuses a
    record format it does not know without writing or wiping anything;
    staging phones keep form 1 until their next renew or PIN
    change, with no prompt. "New phone secret" corrected: a new secret
    alone does not end what code that ran as the app could reach, and
    on Android before form 2 it did not end that code's hold on the
    secret either; the text lands in the app before the formula. Tests
    follow
  - 0.1.42: approved by the owner 2026-10-17, questions 16–27 as
    recommended (§9). (Owner decisions of 2026-10-17, D8; VAULT-MESSAGING 0.34.0 §10.16–§10.18; CALLS-PLAN
    0.1.3). New §4 "Wallet, presence, location and video": the app's
    plans for the four features whose vault side is built but never
    used from a phone. **Wallet** (W0 library spike, W1 create,
    import, recovery phrase and its check, receive and balance, W2
    send and transactions): signet and testnet4 on staging, mainnet
    for production later; the **chain source is the member's**, an
    Esplora server per network with mempool.space as the default for
    both test networks, the member's own URL checked against the
    network's genesis block, Electrum later, and a privacy note; how
    the app combines it with `wallet.address.list`,
    `wallet.address.used`, `wallet.psbt.inspect` and `wallet.sign`;
    phrase screens with `FLAG_SECURE`, nothing of a wallet on disk but
    three settings. **Presence** (P1): the policy in Settings →
    Privacy, the avatar sheet and a per-connection switch, asked only
    when a connection's page opens. **Location** (L1–L3): sharing
    through a `location` foreground service started by the member,
    without background location; positions never stored; no map in
    L1. **Video** (C4): what it adds to voice calls, after C2 and C3.
    How the app learns that a vault has each feature; screens, local
    state, permissions, notifications, History, texts, tests and PRs;
    thirteen questions and vault follow-ups from the vault code; §9
    questions 16–27 for the owner. §2 D8, §5 modules, §6 order and the
    feed row follow. The texts are drafts
  - 0.1.41: **approved by the owner 2026-10-16** (owner decisions of
    2026-10-16; VAULT-MESSAGING 0.34.0). §4 "Recovery and unlock from
    release R": **recovery is on by default**; the app learns whether
    the vault implements release R from the **release capabilities**
    (`recovery_r`) in the attested ETK descriptor, or in a transfer's
    bundle, before it chooses the enroll, unlock, transfer or recovery
    path; once it has seen `recovery_r` for a vault it never takes a
    path from before release R for it. The recovery answers' texts
    follow the result's **`attempt_used`**, not the code
  - 0.1.40: **wording for the owner's approval** (owner decisions of
    2026-10-13 to 2026-10-15; VAULT-MESSAGING 0.33.0 §11.14, which
    needs the vault's "release R"). New §4 "Recovery and unlock from
    release R": the **phone key** (a non-exportable Keystore HMAC key,
    StrongBox or TEE, not bound to user authentication) and the unlock
    secret with its epoch in every enrollment, unlock, recovery open
    and transfer; "this phone no longer holds the keys"; recovery on the
    new phone as **one screen for the PIN and the password**, a
    check-before-sending step, the answers with their texts and the
    wait countdown; the presence notice, the Recovery status line and
    History's attempt entries; **Change PIN** as one flow with the
    password; **passwords** of 12 characters checked against a shared
    list and an on-device guessability estimate, with the texts and the
    test with real people; **transfer**: the new phone's Finish the move
    and the old phone keeping its keys until the vault confirms the new
    phone's first unlock or for at most 7 days, decided by the owner on
    2026-10-15 (no Delete now), with "The move didn't finish";
    `stored_mismatch`; New phone secret; the backup warning; the
    minimum app version. The table rows Recovery (new phone) and
    Transfer (new phone) point there; `:core:keystore` gains the
    phone key. The texts are drafts
  - 0.1.39: **approved by the owner 2026-10-15** (vettid.org #288;
    owner decisions of 2026-10-15; VAULT-MESSAGING 0.32.0
    §10.5.1, which needs the vault's "release A"). New §4
    "Photo attachments": photos from the app's own camera screen or the
    Android Photo Picker, with no media or storage permission (the
    profile photo stays camera-only); prepared in memory: EXIF and
    location removed, re-encoded as JPEG, long edge 2,560 pixels, a
    thumbnail of at most 32 KiB; sent through the vault; fetched on
    demand and checked before decoding (sniffed type, bounded
    dimensions, sanitized names); a memory-only cache wiped at lock;
    a warning before saving or sharing, and sharing without a file;
    History labels; a data-directory scan test. §4 Conversation row
    and §5 modules (`:core:media`) follow. Revised the same day:
    the camera captures to memory only;
    `message.send` is answered after its checks and the transfer
    follows by `sync.event`; Retry re-sends the same request and never
    uploads again; Cancel discards the upload at the vault
    (`message.attachment.discard`); thumbnails decoded under bounds too,
    and only the first frame of an animated image; the viewer is
    excluded from screenshots and the recent-apps snapshot
    (`FLAG_SECURE`). The texts are drafts.
  - 0.1.38: approved by the owner 2026-10-12 (vettid.org #247;
    VAULT-LOCK L9, L14, L16: the texts approved as drafts). New §4
    "Locking the vault": (1) the member's lock as built by
    vettid-android #127, which is **open, not merged at the time of
    writing**: the
    pending state, what confirms a lock, the rules while pending, the
    texts as drafts; (2) what changes when the vault's release
    supports bound locks and the idle lock (VAULT-MESSAGING 0.29.0,
    VAULT-LOCK 0.1.0, "release L"; decided, not built). Nothing
    else changes
  - 0.1.37: errata from the app's implementations of 2026-10-11
    (vettid-android #113 typed recovery code, #115 brand kit, #116
    staging application id and signer binding; staging release S10;
    VAULT-MESSAGING 0.27.1; approved by the owner 2026-10-11).
    Implemented behaviour written down. **Signer binding** (§7 Signing
    and the two distributions, "As built"): when the app sends its
    key's certificate chain; the `signer_refused` screen; the transfer
    confirmation's texts for every class and the answer to
    `signer_unconfirmed`; the History and feed texts; the "Installed
    from" row is in Settings → Vault status and opens an inline card.
    The texts the specification did not give are the app's own and
    open to the owner's rewording. **Typed recovery code** (§4
    Screens, "Recovery: type the code"): a password-class keyboard; a
    refused character names its group; fewer than 48 characters; the
    "No camera" notice; the wait after a `429`; when the typed
    characters are cleared. **Build types** (§5): the App Link hosts
    each build claims (the staging build no longer claims
    `account.vettid.org`); moving a vault to the staging application
    id on the same phone by a pasted transfer code. **Brand** (§3):
    the brand kit's logo artwork (owner, 2026-10-11). 0.1.32–0.1.35
    marked approved
  - 0.1.36: owner decision 2026-10-11, reversing 0.1.34's signing
    decision the day it was made (approved by the owner 2026-10-11).
    **The key that signs Play installs is Google's, option (a)**, not
    VettID's (option (b), chosen in 0.1.34). The owner's question: "it
    feels like giving my key to google will let them have access into
    my app if they chose to try and insert a backdoor"; the decision:
    "yeah, we need to go back to option a." With Play App Signing,
    Google can sign and deliver a modified build to Play installs
    under either option; under (b) the same key signs F-Droid and
    direct installs, so that build could replace them too; under (a)
    Android refuses it there. VettID's release key (digest
    `31a19613…8e65`, already pinned in production) signs the F-Droid
    and direct builds and is never given to Google; Google generates
    and holds the Play app-signing key; a dedicated upload key, pinned
    nowhere, authenticates uploads to Play. Moving between Google Play
    and F-Droid or direct is a transfer or the 24-hour recovery, never
    an update; the sentences the app, the account site and the store
    listings carry; the app's "Installed from" line and the transfer
    warning (VAULT-MESSAGING 0.27.0 §11.7.1, per-vault signer
    binding). Production release 1 pins only VettID's release key and
    no longer waits for the Play account; the Play certificate comes
    with a later release, before which the Play listing does not go
    live. What can and cannot be compared for a Play install; code
    transparency for app bundles as a follow-up to evaluate (§7
    Signing and the two distributions; §9 question 15)
  - 0.1.35: owner decision D5 of 2026-10-11 (STAGING-DEVELOPMENT-PLAN
    0.1.0 §6; VAULT-MESSAGING 0.26.0 §11.10.8, "Android package";
    approved by the owner 2026-10-11, merged as vettid.org #220): the
    `staging` build type's
    application id becomes `com.vettid.app.staging`
    (`applicationIdSuffix ".staging"`), from the build that goes with
    staging release S10, so the production and staging apps install
    side by side (§5, "Build types and application ids"). 0.1.34 is the
    two distributions (vettid.org #219)
  - 0.1.34: owner request 2026-10-11 (the app is to be on F-Droid;
    signing route decided by the owner the same day: F-Droid's
    reproducible builds, which publish the VettID-signed APK;
    vettid-android #111; approved by the owner 2026-10-11, merged as
    vettid.org #219). **Two
    distributions replace "one build"** (§9 question 12): `full`
    (Google Play and VettID's own releases) links Firebase Messaging as
    before; `foss` (F-Droid) contains no Google code. Same application
    id and version. In `foss`, Google push is shown disabled with "Not
    available in this build of VettID, which contains no Google
    software." (§4 Notification modes, 1); the `distribution` flavour
    dimension, the reproducible FOSS release and `checkFossReleaseApk`
    (4); `:core:push-fcm` is `full` only (§5); versions and tags (§7).
    The rule for Google push chosen but the push service later
    unavailable on the phone is **approved (owner, 2026-10-11) and
    implemented** (vettid-android #112), with the `foss` distribution
    among its causes (4). **Owner decision (2026-10-11): VettID's own
    key signs Play installs** (§7 Signing and the two distributions;
    §9 question 15): which key signs Play installs is
    chosen once at Play App Signing enrolment; it decides whether
    members can move between Google Play and F-Droid without
    uninstalling, and what production release 1 pins in
    `android_signers`
  - 0.1.33: owner decision 2026-10-11 ("we should allow a typed
    recovery code"; VAULT-MESSAGING 0.25.0 §11.11.10, MEMBER-API 2.4.0;
    approved by the owner 2026-10-11, merged as vettid.org #212): the
    recover screens gain **Type
    the code instead**, as onboarding has for the setup code (§4
    Screens, Recovery). The member types the 48 characters the account
    site shows (12 groups of four: locator, code, check characters);
    the app normalizes them (case, spaces, hyphens, I and L as 1, O as
    0; U and anything else refused in the field), verifies the check
    characters with its own member API origin before sending anything,
    claims by locator and then registers, unlocks and recovers exactly
    as after a scan, with the same messages and the same count of wrong
    codes. No account session, no email typed, nothing persisted
  - 0.1.32: errata from the Android and gateway N4 implementations
    (vettid-android #109; vettid-push; PUSH-GATEWAY 0.4.2; approved by
    the owner 2026-10-11, merged as vettid.org #211). Implemented
    behaviour written down (§4
    Notification modes, 1 and 4). Changing the mode no longer "stops the
    old path first" in every case; it follows PUSH-GATEWAY §11.1: to
    Google push, the on-phone service runs until the vault holds the
    registration; back to the service, `push.unregister` is started and
    the service starts without waiting for it. A wipe sends no
    `push.unregister` (0.1.29 said it did): the vault has already erased
    the registration (VAULT-MESSAGING §14.1); the app deletes its token.
    `unavailable` keeps Google push selected with "Not available yet"
    under it. A wake's collect takes at most 15 s before expedited
    `WorkManager` work, and how "collect finished" is decided; a
    `vault.locking` met during a wake posts "Your vault is locked";
    `feed.event`s collected before a wake-started process knows the
    vault is open are held in memory (64 at most). The Firebase options
    are four Gradle properties per build type, all or none; the build
    guard `check<Variant>PushManifest`. **Owner decisions pending**
    (marked in 4): the fallback to the on-phone service beyond `limit`
    (implemented for `unavailable`, refusals and `gateway_error`
    retries; recommended: keep), and Google push chosen but the push
    service later unavailable on the phone (today nothing runs;
    recommended: fall back to the on-phone service; not implemented)
  - 0.1.31: owner request 2026-10-10 ("when we let users know about new
    vault updates we need to provide them with some way to see the
    change log so they know what is changing"; RELEASE-UPDATES 0.3.0,
    VAULT-RELEASES 0.1.10): **What's new in release N** (§4 Screens,
    "What's new"): before any update, on the update screen (which the
    banner's Update now, the notification and Settings open) and at the
    unlock screen's release offer, the app shows the release's summary,
    changes and security line from the channel's release log
    `index.json`, labelled "From vettid.org", with "Full release notes"
    opening the manifest's `notes` URL. It is fetched only from the host
    of the trusted manifest's `notes` URL when that is the channel's log
    entry; it is information only (trust stays the signed manifest and
    the PCR0 fingerprint); a failed fetch or a missing entry shows
    "Release notes unavailable" with the link and never blocks the
    update. The "Vault updates" notification shows the summary when the
    log has it
  - 0.1.30: errata from the vault's N3 implementation (VAULT-MESSAGING
    0.24.1, PUSH-GATEWAY 0.4.1; vettid-vault #59; approved, owner
    decision 2026-10-10): the vault asks for a fresh token with
    `push.token-needed`, not 0.1.29's `push.token_needed`, which broke
    VAULT-MESSAGING §5.3's type grammar; the app listens for the hyphen.
    Owner decision 2026-10-10: when `push.register` answers `limit`, the
    app stops retrying for 24 hours, Settings → Notifications shows
    "Push unavailable, using the on-phone service", and the on-phone
    service keeps running as the fallback (§4 Notification modes, 4)
  - 0.1.29: the N2 spec step (owner request of 2026-10-10, a draft for
    review): Google push (§4 Notification modes, 4) follows
    VAULT-MESSAGING 0.24.0 §14 and PUSH-GATEWAY 0.4.0: `push.register`
    `{platform: "fcm", token, app_id}`, the gateway's sealed wake blob
    instead of a `wake_ref`, `push.token-needed` re-registers, the
    status line reads the `push` state from `device.list`; the protocol
    gaps of item 9 are answered there. Owner review of 2026-10-10: links
    in a conversation (§4 Screens, Conversation): only `https://` URLs are
    tappable, opened through Android after "Open link to <host>?";
    other schemes stay text
  - 0.1.28: staging S8 canary of 2026-10-10 (VAULT-MESSAGING 0.23.3,
    pending owner approval): after a release update ("Your vault is
    updated", Continue) and after an unlock of an open vault, the app
    showed the unlock screen although the vault was open: the
    `vault.locking` of the lock before the unlock arrived over the
    relay after the result. The app keeps the inner `ts` of each
    successful unlock result and drops a `vault.locking` that is not
    later (vettid-android #107); a later lock still locks the app
  - 0.1.27: History names the device of an entry (VAULT-MESSAGING
    0.23.2 §15 item 31.14 follow-up: `vault.unlocked` and a device's
    `vault.locked` carry `device_id`). The names come from `device.list`
    (§10.3), as in the export: read when History opens and again when
    it is shown again, kept for the session; a failed read names no
    device (not "Removed device"). A row's second line adds the
    device's name after the item and connection names ("Vault unlocked"
    over "Pixel 10 Pro"; "Removed device" once unlisted); an entry
    without `device_id` is unchanged. The entry page's **Device** line
    shows the name, with "(this phone)" when `device_id` is this app's
    own (from its pairing), and the id below it as **Device ID**; the
    search is unchanged (the vault already matches device names, §10.9)
  - 0.1.26: owner feedback of 2026-10-10 ("viewing the notifications
    doesn't clear them unless you look at the details. this is bad
    UX"): **viewing the Notifications screen marks its items read**.
    While the screen is in view (resumed), every unread item that is
    not `urgent` is marked read (`feed.update{status: "read"}`, at most
    4 in flight, shared with Mark all as read): those unread when it
    opens and those that arrive while it is open; the bell's count
    falls with them. Urgent items (Needs attention:
    `credential.alarm`, `owner_check.locked`) stay unread, and keep the
    badge red, until tapped or marked read. What was read by viewing
    keeps its gold dot, and stays under the Unread chip, until the
    member leaves the screen. Each item is marked read by viewing at
    most once while the screen lives: one the member marks unread, or
    that another device marks unread while it is in view, stays unread.
    The Archived view marks nothing (§4 Notifications, 3 and 4)
  - 0.1.25: owner decision of 2026-10-09: **tag colours are distinct
    and stored in the vault** (supersedes 0.1.21's hash-only colours).
    A tag's colour is the registry's `color` (VAULT-MESSAGING §10.8,
    `#rrggbb`), the same on every device; a tag without one gets the
    palette colour least used among the member's tags (ties: the tag's
    hash slot, then palette order), assigned in sorted-name order when
    a tag is created or first used and when the registry is loaded, and
    saved with `tag.set` (the registry `version`; on a conflict the app
    lists again and keeps what is stored; description and icon passed
    unchanged, as `tag.set` clears members left out); only while the
    vault is open and not held; the hash colour until one is stored. A
    stored colour outside the palette is shown as is, with text in black
    or white for contrast. A new palette of ten clearly different hues
    (red, orange, green, teal, blue, indigo, violet, pink, brown, slate;
    no gold, AA in both themes), stored as the light theme's fill. The
    member picks a tag's colour on Manage tags (the row's colour button:
    ten swatches, the current one checked); `@profile` stays gold and
    is never stored ("Your shared profile always uses your colour") (§4)
  - 0.1.24: owner decision of 2026-10-09: **no UnifiedPush** ("we're not
    doing unified push. the vettid service is our solution. and apps
    connected to vettid get to use our notification channel"). §9
    question 10 answered otherwise; the on-phone service (D7) is the
    path for phones without Google services, Google push (FCM through
    the push gateway, which stays) the platform path; `unifiedpush` and
    `webpush` keys dropped from the `push.register` gaps (§4 item 9);
    §7 Push rewritten; PUSH-GATEWAY 0.3.0
  - 0.1.23: the Notifications screen, the vault's feed (VAULT-MESSAGING
    0.23.1 §10.9) in the app: a bell in the top bar of the drawer
    screens with the unread count, a list grouped by day with urgent
    items first, unread and read, swipe to archive (Undo) and to mark
    read or unread, an Archived view; every feed kind of §10.9 mapped to
    a label and a tap target, batches of a connection's asks (`count`)
    as one row; `feed.list` at open and after a check,
    `feed.event` and `sync.event{feed.updated, feed.deleted}` live,
    `feed.list{after_seq}` to catch up; nothing while held or due but
    the `vault.held` counts; the feed only in memory while the vault is
    open; the release banner stays separate (releases are not feed
    items). Owner answers of 2026-10-09 (§9: questions 1, 2 and 4–9 as
    recommended; 3 replaced): **notification modes** (D7, §4
    Notification modes): an on-phone service (a foreground service
    holding the app's own relay connection, PUSH-GATEWAY §11; the
    default), Google push (FCM through the push gateway; plumbing now,
    "not available yet" until the gateway and FCM credentials exist) or
    off (not recommended); eight notification channels, private on the
    lock screen, previews of names only by default; which feed kinds
    and events notify; FCM optional at build time; the VAULT-MESSAGING
    gaps for `push.register` (§14 is reserved); an implementation order
    (N1–N4, §6); UnifiedPush (answered otherwise in 0.1.24) and
    four more open questions (§9);
    VAULT-MESSAGING 0.23.1 under related
  - 0.1.22: VAULT-MESSAGING 0.23.0 and owner requests of 2026-10-09:
    one tag per share rule ("Select the tag to share", the chosen chip
    in its colour with a gold outline and a check mark, a tag that
    already has a rule for the connection opens that rule, Save once a
    tag is chosen; a rule naming several tags, made before, is shown
    read-only and can be deleted); "Save rule" in the editor's top bar
    with a discard prompt; per-hour (1–3,600) and per-day (1–86,400)
    limits on connection rules, shown on rules and received grants, and
    "Try again in …" on a `rate_limited` fetch; `ask` wins when rules
    overlap, rules named by their tags ("your “medical” rule"), the dry
    run's `outcome` and `ask_rule_id` explained per item, share
    questions with `ask_rule_id` and `shared`, one question per item and
    connection, and a decline warning for an item already shared; a
    connection's asks (§10.4.1) muted, paused and in cooldown on its
    page with Mute/Unmute, Resume and "Allow declined requests again",
    paused connections in Approvals (resume or remove), a connection's
    asks within 10 minutes as one Approvals entry, and the member's own
    refused asks shown as "Not accepted"; the month picker follows a
    template field's `"format": "month"` (VAULT-ITEMS 0.1.2); History's
    icons coloured by category (unlocks green, security amber, blocked
    and dropped red, connections teal, messages blue, vault gold,
    devices purple, agents orange, location indigo, account grey; AA in
    both themes), with titles for `drop.ask_*`, `connection.asks_*` and
    `drop.grant_rate_limited` (§4)
  - 0.1.21: owner requests of 2026-10-09: one clear action for filters,
    a "✕ Clear" chip at the end of the filter chips while a filter is on
    (Vault and History; the no-match empty state only points to it);
    the item editor saves from "Save item" in the top bar, with no Save
    bar above the keyboard (Next moves to the next input, Done on the
    last closes the keyboard, neither saves; back with unsaved changes
    asks "Discard changes to this item?"); every tag has its own colour,
    from a fixed palette of ten (AA in both themes) picked by FNV-1a of
    the normalised tag, the same on every device, the shared profile's
    `@profile` always gold, not chosen by the member; phone numbers are
    formatted while typed (libphonenumber, the phone's region until a +
    and country code), stored in international format, kept as typed
    with a "Check this number" hint when unknown (never a block), and
    shown in national format in their own country, international
    elsewhere (§4)
  - 0.1.20: owner feedback of 2026-10-09 (staging): a connection has as
    many share rules as the member needs, each with its own settings
    (VAULT-MESSAGING §10.12, up to 64 per connection). "You share with
    <First>" lists every rule as a row (its tags, any or all, "Shared
    automatically" or "Asks you each time", its fetch limit and end, the
    items it shares now, and "Also covered by" when another rule names
    the same tag or holds the same item), each opening its editor or
    deleted after a confirmation, and "Add a rule" (disabled at 64, with
    the named limit). The editor: tags (any or all), "Ask me each time"
    (default) or "Share automatically", fetches of each item (1–10,000,
    optional), Ends (Never, 1 day, 1 week, 1 month, 3 months, 1 year or
    "Custom…": a date and a time in local time, future only, sent as UTC
    `expires_at`), include existing items, the other rules covering the
    same tags or items and how they combine (as of VAULT-MESSAGING
    0.22.0, no precedence: each rule shares on its own, so an item is
    shared while any rule shares it),
    and the dry-run preview. Per-hour and per-day limits are for agent
    rules only in §10.12 and are not offered for connections (§4).
    Follow-up: VAULT-MESSAGING 0.23.0 allows `per_hour` and `per_day` on
    connection rules and makes "ask" win where rules overlap; the app
    side of that is a separate, later change
  - 0.1.19: owner decision of 2026-10-09: proactive vault release
    updates. When the manifest the app trusts (the published one or a
    loaded canary) lists an `active` release newer than the vault's, the
    shell shows a banner ("A new vault release is available (release
    N)", Update now, dismissed for 24 h at most), or for a `retired`
    release or a `deprecated` one with an `ends_at` the warning "Your
    vault's release ends on <date>. Update now to keep your vault"; one
    local notification per release (channel "Vault updates", the
    permission asked once in context on API 33+, no push); Settings →
    Vault → "Update available". "Update now" opens one screen (release,
    fingerprint, notes, the vault PIN, "Approve and update"); the app
    then locks the vault itself, sends the unlock with the approved
    `release_update`, and after `update: moved` unlocks again with the
    same PIN (progress "Updating your vault…", waits for `503
    release_starting`); refusals, a wrong PIN and "Return to release N"
    (VAULT-MESSAGING §11.10.4, only while the move is unconfirmed) are
    explained. The owner check, when due, comes first. No protocol
    change: moves stay as §11.10 describes, and the approval at unlock
    stays. The manifest has no security flag, so a security release is
    not told apart. Also (owner request of 2026-10-09): Settings →
    Security "Biometric app lock" becomes **App lock** with a method,
    **Biometrics** (fingerprint or face, the phone's screen lock as the
    fallback, as before) or **Phone screen lock** (the phone's PIN,
    pattern or password only: BiometricPrompt with DEVICE_CREDENTIAL, a
    Keystore key for the device credential only); no VettID passcode.
    Still a convenience lock only (D6). The "new fingerprint added"
    notice is the Biometrics method's only; without a screen lock on
    the phone, Phone screen lock is unavailable, with the reason and the
    system security settings; a lock turned on before is Biometrics.
  - 0.1.18: owner requests of 2026-10-08: the connection detail shows
    sharing as two cards, "You share with <First>" (gold, its rules and
    the items shared, "Share items…") and "<First> shares with you"
    (neutral, read-only, "Ask for something"), each with a count and an
    empty state; nothing is pre-typed in the item editor (a template's
    name is the placeholder and is used when the name is left empty);
    formats are enforced while typing (dates masked to YYYY-MM-DD with a
    calendar, a card's expiry as month and year YYYY-MM, numbers, phones,
    emails, web addresses and one-time code keys filtered and normalised
    on paste); an existing item's protection changes in the editor (the
    content saved first, then item.sensitivity; leaving critical warns
    first); and Vault, Messages and Connections hide their search behind a
    search icon in the top bar (open while a query is set; History keeps
    its search field; Approvals has none) (§4)
  - 0.1.17: owner decisions of 2026-10-08 (VAULT-MESSAGING 0.22.0 §15
    item 30): History export, a deliberate exception to "no export" for
    activity metadata only. History's ⋯ menu "Export…" opens a confirm
    sheet with the count and date range of what the filters show (at
    most 10,000 entries, newest first; more is said and narrower dates
    suggested), the format (CSV or JSON) and the unencrypted-file
    notice; the vault PIN (`audit.export`), then the platform's "Save
    to…" (Storage Access Framework) only; the category table gains
    identifiers and `audit` under Security; after the owner's review of
    vettid.org #174, a wrong PIN counts only in the PIN backoff and the
    export is refused while a credential alarm is open (§4, §6)
  - 0.1.16: owner decision of 2026-10-08 (VAULT-ITEMS 0.1.1): contact
    information is one item per contact point (templates Email address,
    Phone number, Postal address and Website replace Contact details), no
    template adds @profile, "Shared profile" is a built-in tag choice for
    standard items only, and a blank item starts with no field (§4)
  - 0.1.15: owner feedback of 2026-10-08: value-first item fields (one input
    captioned by the field's label, its type as a hint; a ⋯ menu to rename,
    change an unsaved field's type, move or remove; the label asked for when
    adding), a short explanation of tags under Tags, and member-defined
    categories ("New category…" derives the §10.7 identifier from a typed
    name, custom ones shown humanized and offered in the picker and the
    Vault filter) (§4)
  - 0.1.14: owner, 2026-10-08: the profile photo's review step shows
    the shot in a circular frame to crop/zoom (pinch, drag, zoom buttons
    or slider, Reset); "Use photo" keeps the square under the circle
  - 0.1.13: owner decisions of 2026-10-08: the connection detail is
    simpler. No safety code (SAS) there: it protects the moment of
    connecting only and stays on the invite and request screens; the
    vault key fingerprint is the lasting identity check. No alias or
    note: the app neither shows nor sets them (no `connection.update`
    alias or note), and a connection is always titled "First Last",
    never by an alias; aliases and notes a vault already holds stay
    there, unshown. The detail's action bar loses edit and block;
    remove stays, and an incoming request can still be blocked (§4)
  - 0.1.12: owner feedback of 2026-10-08, from testing the S5 staging
    app: **Lock vault** is the first entry of the avatar sheet, right
    under the name and email (it was at the bottom, cut off on a phone),
    and the sheet scrolls so every entry is reachable; the profile photo
    is **camera only**: taken with the app's own camera screen (CameraX,
    the front camera first with a switch to the rear one, "Retake" and
    "Use photo"), never selected from the gallery (no Photo Picker) and
    never taken by another camera app (no system camera intent), kept
    in memory only, never saved to the gallery or shared storage, then
    cropped, scaled and re-encoded as before (≤ 65,536 bytes, no EXIF);
    the shared profile's glyph is Material Icons Outlined `Badge` (an ID
    card), on its screen and on the rows that open it (§3, §4)
  - 0.1.11: owner decisions of 2026-10-07, from testing the staging
    app (VAULT-MESSAGING 0.20.0 §15 item 28, MEMBER-API 2.3.0): the
    avatar sheet and a Settings account card show the member's first
    and last name and full email address (the snapshot's `email`, shown
    only to the member); the drawer drops "Credential" (Settings →
    Security → Credential) and "Invite a connection" (the floating
    action button invites on Connections and starts a new message on
    Messages; the drawer's planned "create" group is dropped, as the
    button creates everywhere); the Items section is called **"Vault"** in the interface
    ("items" stays the technical term); a new drawer entry **"History"**:
    the audit log, searched by the vault (`q`), filtered by category,
    connection and date, with infinite scroll and an entry detail,
    read-only (§3, §4, §5, §6)
  - 0.1.10: connections are titled with the account's first and last
    name from the profile's core, the display name secondary, a
    placeholder only until the first profile arrives, and the
    identity-key fingerprint in the details, never called verified; the
    member changes their own names only here, in the avatar sheet, with
    the PIN and the credential password (`account.name.set`, at most
    once every 30 days) (VAULT-MESSAGING 0.18.0 §10.8, MEMBER-API
    2.2.0) (§4)
  - 0.1.9: a phone set up by a direct transfer stores the member's
    `user_guid` from the vault's `device.paired` and unlocks with it,
    and warns when an older vault release sent none; the owner check's
    backoff countdown comes from `retry_after` (VAULT-MESSAGING 0.17.0)
    (§4, §6)
  - 0.1.8: the pending-deletion banner cancels with the `deletion_id`
    from `GET /api/vault/status` (MEMBER-API 2.1.1, VAULT-MESSAGING
    0.16.1) (§4)
  - 0.1.7: no recovery with the credential backup off (VAULT-MESSAGING
    0.16.0, owner decisions of 2026-10-06): the backup-off warning, the
    recovery screens without the backup-off path, `no_backup`, and
    "delete and start over" with a new setup code (§4)
  - 0.1.6: the owner check's message type is `vault.owner-check`
    (VAULT-MESSAGING 0.15.2: §5.3's type grammar has no underscore); the
    settings keys, `owner_check_required` and the `owner_check` sync,
    lock-reason and feed kinds keep their spelling
  - 0.1.5: the app never signs in (VAULT-MESSAGING 0.15.0 §11.12–§11.13,
    MEMBER-API 2.0.0; ENROLLMENT-CODES.md): onboarding by setup code, the
    avatar sheet's account view from the vault (§4), `:core:altchan`
    (§5), membership (§7)
  - 0.1.4: the daily owner check (VAULT-MESSAGING 0.13.0 §3.6, owner
    decisions of 2026-10-05 and 2026-10-06): follow-ups for A3 and A6
    (§6), the Settings and owner-check rows (§4), the hold switch
  - 0.1.3 (editorial): D2 gold #FFC125 as in §3; GrapheneOS risk closed
    (staging accepted GrapheneOS attestation on 2026-10-05); current
    VAULT-MESSAGING and RELAY-PROTOCOL versions
  - 0.1.2: Secrets → Items per VAULT-ITEMS (drawer, screens, modules, A5);
    favourite connections; the drawer "create" group (§4); brand gold
    #FFC125 and the website fonts (§3), owner decisions of 2026-10-04
  - 0.1.1: owner decisions of 2026-10-03: push on both paths (FCM and
    UnifiedPush, plus a foreground-service path without push, §7;
    UnifiedPush dropped in 0.1.24); no
    backup or export of vault data (§4); location viewer notes for the
    location phase (§6)
owner: Al Liebl (Mesmer)
related:
  - VAULT-MESSAGING.md (0.23.1) — the app's contract with the vault
  - VAULT-ITEMS.md — items, tags and share rules (the Vault screens)
  - VAULT-PLAN.md (V6 clients)
  - RELAY-PROTOCOL.md (0.6.0), MEMBER-API.md
  - CALLS-PLAN.md (0.1.3) — calls; video in C4 (§4, 0.1.42)
classification: public (no secrets; safe for github.com/vettid)
---

# Android app plan (v1)

The first mobile client for the new vault. A fresh rewrite in the
existing `vettid/vettid-android` repository, with a deliberately smaller
surface than the vettid.dev app and a layout modelled on Proton Mail.

## 1. Starting point

- **Existing app** (`vettid-android`): about 158k lines of Kotlin in one
  Gradle module (Compose + Material3, Hilt, EncryptedSharedPreferences,
  Retrofit, jnats). NATS is used directly by about 90 files; a 4.4k-line
  client object owns transport, crypto and ~30 event handlers; navigation is
  one 2.9k-line file; several flows exist twice (enrollment, secrets, calls,
  credential stores); ~19k lines are dead B2C service code; all strings are
  hard-coded. Refactoring it in place would carry that complexity forward.
- **Worth carrying over** (with their tests): hardware key attestation
  (`HardwareAttestationManager`), Nitro attestation verification and PCR
  handling (`NitroAttestationVerifier`, `PcrConfigManager`), crypto and
  security helpers (`CryptoManager` minus the old UTK code, `SecureMemory`,
  `RuntimeProtection`, `UnlockRateLimiter`), the WebRTC layer and frame
  encryption (`WebRTCClient`, `CallFrameCryptor`) for when calls arrive,
  and a few components (QR scanner).
- **The vault side is defined**: VAULT-MESSAGING lists every message type
  the app sends and receives, with body schemas, roles and error codes, and
  vettid-vault ships test vectors and a Go reference client (`client/`,
  `vaultctl`).

## 2. Decisions (owner, 2026-10-03)

| # | Decision |
|---|---|
| D1 | **Fresh rewrite in `vettid-android`**, same package name `com.vettid.app` (keeps the Play listing and signing key). The old code is preserved on a branch/tag and removed from `main`. |
| D2 | **Proton Mail layout, VettID brand**: dark navy surfaces and Proton's structure; VettID gold (`#FFC125`, owner 2026-10-04, §3) as the single accent; the rook logo stays gold with a black keyhole; a light theme as on the website. |
| D3 | **v1 scope**: enrollment, unlock, Protean Credential, settings (always), plus **connections + messaging** and **items** (data, secret and critical items per VAULT-ITEMS; originally "secrets + critical secrets"). Calls, desktop/agent pairing and LEASH, wallet, location and presence come later. |
| D4 | **Minimum Android 12 (API 31)**; target the current API level. |
| D5 | **Message search later** (not in v1). |
| D6 | **Biometric app lock in v1**: opening the app (and returning to it after a timeout) can require a biometric or device credential via BiometricPrompt (class 3), gating a Keystore key that unlocks the app's local data. 0.1.19: called **App lock**, with the method Biometrics (as described) or Phone screen lock (the device credential only). It is a convenience layer only: it never replaces the vault PIN (unlocking the vault) or the credential password (critical actions). |
| D7 | **Notification modes** (owner, 2026-10-09; 0.1.23): the member picks how notifications reach the phone: **On-phone service** (recommended, most private; the default), **Google push** (FCM through the VettID push gateway; offered once the gateway and FCM credentials exist) or **Off** (not recommended). Feed items raise notifications through the chosen mode (§4 Notification modes). Supersedes PUSH-GATEWAY 0.2.0 §11's default order (FCM first) for this app (PUSH-GATEWAY 0.3.0 follows it). No UnifiedPush (owner, 2026-10-09; 0.1.24; §9, question 10): the on-phone service is the path for phones without Google services. |
| D8 | **Wallet, presence, location and video** (owner, 2026-10-17; 0.1.42; §4 "Wallet, presence, location and video"). All four are wanted, in the order **wallet, presence, location**, with **video after the calling service** (CALLS-PLAN C2 and C3). Wallet networks on staging: **signet and testnet4**; mainnet for production later. The wallet's **chain source is the member's choice**: the app reads balances and coins and broadcasts through a server the member can set. |

## 3. Design language (from Proton Mail)

Reference screenshots are kept privately (they show a real mailbox); the
patterns:

- **Top bar**: menu button, screen title, search, avatar (initial tile);
  0.1.23: a bell before the avatar (Notifications, §4).
- **Navigation drawer** as the main navigation (no bottom tabs): primary
  destinations, then Settings / Help, version at the bottom. No "create"
  group (0.1.11, owner decision of 2026-10-07; Proton's Create folder /
  label is not adopted): the floating action button creates.
- **List rows**: rounded-square initial tile, two lines (name, preview),
  date and a trailing action icon; generous spacing.
- **Empty states**: one illustration, a title and one line.
- **Floating controls**: a filter chip bottom-left (e.g. Unread), a primary
  action button bottom-right (compose / add). The floating action button
  is the place to create (0.1.11): on Messages it starts a new message,
  on Connections it invites a connection, on Vault it adds an item.
- **Detail screens**: back arrow, centred title, content in a card, a
  floating pill of actions at the bottom.
- **Settings**: grouped rounded cards, rows with icon + label + chevron,
  section headers.
- **Avatar sheet**: a bottom sheet with the account and its options,
  opened fully expanded and scrolling (0.1.12), **Lock vault** first.
- **VettID brand** (owner, 2026-10-04): gold `#FFC125` (the website's
  `--gold`) as the single accent, `--gold-ink-light` `#7F640A` for gold
  text and icons on light surfaces; navy surfaces from the website tokens;
  Plus Jakarta Sans for headings and Inter for body, as on the website;
  Material Icons Outlined. Connection tiles are one indigo, favourite
  connections teal, the member's own avatar gold.
- **Brand kit** (0.1.37; owner, 2026-10-11; vettid-android #115,
  vettid.org #225 and #226). The app and the sites use the kit's logo
  artwork: the launcher icon is the gold rook on a VettID Blue
  (`#2E2D88`) tile with the keyhole cut out, and the drawer's header
  is the horizontal lockup, in the light theme its on-light version
  (VettID Blue wordmark, gold rook). Non-production launcher icons
  (`debug`, `devStack`, `staging`) carry a white band along the bottom
  so they can be told apart beside the production app; the band is
  VettID's addition, not part of the kit. The kit changes nothing
  else here: the fonts stay Inter and Plus Jakarta Sans, the sites'
  backgrounds are unchanged, the tagline is "Secure. Private.
  Trusted." (the sites'; no app screen shows a tagline), and the name
  "VettID Cloud" is not used. The kit itself is not reproduced in
  this repository's documents.

## 4. Screens (v1)

**Drawer** (0.1.11, owner decisions of 2026-10-07): Messages ·
Connections · Approvals (badge) · Vault · History · Settings · Help —
later: Calls, Devices & agents, Shared actions & introductions, Wallet,
Location. "Credential" is not in the drawer: it is reached from Settings →
Security → Credential. "Invite a connection" is not in the drawer either:
the floating action button invites on Connections and starts a new
message on Messages (§3). The drawer has **no "create" group** (owner
decision of 2026-10-07; 0.1.2 planned one with Invite a connection and
New item): the floating action button creates on every screen that
creates something (§3), so the drawer holds only destinations.
Notifications (0.1.23) is not a drawer entry either: it opens from the
bell in the top bar (below; owner answer of 2026-10-09, §9 question 1).

**"Vault", not "Items", in the interface** (0.1.11, owner decision of
2026-10-07). The member's stored data (VAULT-ITEMS) is called **Vault**
in everything the member sees: the drawer label, screen titles ("Vault",
"Vault: Passport" or the item's name), empty states ("Your vault is
empty"), the add button ("Add to vault") and messages. The
specifications, the code (`:feature:items`, `item.*` types, `item_id`)
and this plan's technical text keep **item** as the technical term; the
rows below say "Vault" for the screens and "item" for the data.

| Screen | Proton analogue | Notes |
|---|---|---|
| Messages | Inbox | Conversations by connection; Unread chip; the floating action button starts a new message (pick a connection, then the conversation) |
| Conversation | Message detail | Bubbles in a card list; pill actions (reply, more). Links in a message (0.1.29, VAULT-MESSAGING 0.24.0 §10.5): only `https://` URLs are tappable; a tap asks "Open link to <host>?" and then hands the URL to Android, so a verified App Link opens its app and any other link the browser; every other scheme, custom app schemes included, stays plain text. (0.1.39) Photos: a photo button in the composer, thumbnails in bubbles, a viewer (§4 "Photo attachments") |
| Connections | Contacts | Initial tiles, status (pending / active / stale / blocked); a star marks favourites (the owner's `favorite` flag, `connection.update`), whose tiles are teal; the floating action button invites a connection (0.1.11: QR or link, or scan the other's QR), the only invite entry point besides empty states. Each is titled "First Last" from the profile's core (VAULT-MESSAGING 0.18.0 §10.8), the display name, if any, as secondary text. Incoming requests show the requester's names the same way. Only between activation and the first `profile.update`, when the request's names are not at hand: "Name not shared yet"; never "Unnamed connection" |
| Connection detail | — | Titled "First Last" (never an alias), the display name secondary. Profile shared with you (the names labelled as the name on their VettID account, never "verified"; display name, photo and items labelled as shared by them), sharing both ways ("You share with <First>": every share rule a row with its own settings, opening its editor or deleted after a confirmation, "Add a rule" up to 64, 0.1.20), a connection's requests (0.1.22, VAULT-MESSAGING 0.23.0 §10.4.1: muted, paused after several declines, declined ones in cooldown, with Mute/Unmute, Resume and "Allow declined requests again"), authenticate, the vault key fingerprint (`ik`, 8 groups of 4 hex digits, §10.8: the lasting identity check). The action bar: message, favourite, History, remove (confirmed). No safety code (it belongs to connecting: the invite and request screens), no alias or notes, no edit or block (0.1.13; blocking stays on an incoming request) |
| Approvals | — (VettID-specific) | Pending connection requests, grant requests, critical-item uses, share-rule decisions; approve/deny; critical items need the credential password. 0.1.22: a connection's asks within 10 minutes are one entry ("Sam asks for 3 things"), a connection whose asks are paused is a notice (resume, or remove the connection), a share question names the rule that asks first and warns when declining stops an item already shared, one question per item and connection |
| Vault | Folder list | Titled "Vault" (0.1.11; was "Items"). Items per VAULT-ITEMS: name, category, typed fields, tags, sensitivity (data / secret / critical); filter by tag (0.1.21: "✕ Clear" ends the filter chips while a filter is on); each tag in its own colour (0.1.21), stored in the vault's tag registry and the same on every device, the least-used of a palette of ten for a new tag, picked by the member on Manage tags (0.1.25; `@profile` always gold); add/edit from templates ("Save item" in the top bar, 0.1.21); share rules by tag, as many per connection as needed (up to 64), each with its own tags, mode (default: ask each time), fetch limit and end (presets or a custom date and time), overlaps shown (0.1.20); one tag per rule, per-hour and per-day limits, `ask` wins, rules named by their tags, "Save rule" in the top bar (0.1.22). Critical items live in the Protean Credential and are never shared by a rule |
| History | — (VettID-specific) | The member's audit log (0.1.11, `audit.list`, VAULT-MESSAGING 0.20.0 §10.9), read-only: a search field (the vault searches, `q`), filter chips (category, connection, date range), a list of entries newest first with infinite scroll, and an entry detail, each entry's icon in its category's colour (0.1.22); a ⋯ menu with **Export…** (0.1.17: CSV or JSON of what the filters show, with the vault PIN, saved through "Save to…"). Details below |
| Notifications | — (Proton has none; a bell as in most apps) | 0.1.23 (owner answers of 2026-10-09): the vault's feed (VAULT-MESSAGING §10.9), opened from the bell in the top bar with the unread count; grouped by day, urgent items first, unread and read, swipe to archive or to mark read, an Archived view; each item opens the screen it is about; system notifications through the member's notification mode (D7). Details below |
| Credential | — | Reached from Settings → Security → Credential (0.1.11; not in the drawer). Critical items inside the Protean Credential; unlock window; password change; the vault-held credential copy (the backup) on/off. Turning it off shows VAULT-MESSAGING §3.5.6's warning and needs a confirmation: "If this phone is lost, broken, reset or replaced without a transfer, your vault **cannot be recovered**. It can only be deleted and replaced by a new one, and **everything in it is lost**." While off, the screen and Settings keep a short "no recovery" notice. Turning it on asks for the password at once (an owner check) so that the copy exists, and says recovery is possible from then on. (0.1.51) **New credential** (`credential.reset`) is hidden until §4 "A lost answer to New credential" is implemented |
| Settings | Settings | At the top, an **account card** (0.1.11): the member's first and last name and full email address (`account.get`, VAULT-MESSAGING 0.20.0 §11.13) and the membership state; tapping it opens the avatar sheet. Vault (status, with the "Installed from" line of §7 "Signing and the two distributions" (0.1.36), release, lock, PIN; "Update available" while a newer release can be approved, 0.1.19); Security (credential, recovery, attestation info, the app lock (0.1.19: Biometrics or Phone screen lock) and timeout, the owner-check interval 1–24 h and the hold switch); Privacy (the **Shared profile**, glyph `Badge`, 0.1.12: display name, `@profile` items and the profile photo, **camera only** — "Take a photo" / "Retake photo" opens the app's own camera screen, front camera first with a switch to the rear one, then "Retake" or "Use photo"; no selection of an existing picture and no other camera app; the shot stays in memory, is never saved to the gallery, and is cropped, scaled and re-encoded to a JPEG ≤ 65,536 bytes without EXIF before `profile.set{photo}`; "Remove photo" confirmed; a refused camera permission is explained, with the system settings once Android no longer asks; a phone without a camera is told); App (theme; **Notifications** (0.1.23): the mode, its status, previews and the channels, §4 Notification modes; the local "Vault updates" channel, 0.1.19) |
| Owner check | — (VettID-specific) | One screen: PIN and credential password together (VAULT-MESSAGING §3.6.5); also the "vault held" screen with the waiting counts and the lock action |
| Avatar sheet | Account sheet | The member's first and last name and **full email address** (0.1.11, from `account.get`'s snapshot `first_name`, `last_name` and `email`, VAULT-MESSAGING 0.20.0 §11.13; never the masked hint), the email labelled "Only you see this address" and the names "Your connections see this name"; **Lock vault first** (0.1.12), right under the name and email, before Change name, Shared profile and the email; the sheet scrolls; vault status; **Change name** (0.1.10): the two names (the registration rule: letters, spaces, `'’.-`, ≤ 40), then the owner-check screen's PIN and password, sent as `account.name.set`; then "Name change requested" until `account.get`'s `name_request` is `applied` or `refused`; `too_soon` (from the vault or the member API): "You can change your name once every 30 days. You can change it again on <date>" (VAULT-MESSAGING §10.8), membership and subscription (read-only, from the vault, VAULT-MESSAGING §11.13), open account portal (browser) |
| Recovery (new phone) | — (VettID-specific) | (0.1.40, release R: after the register, one screen for the PIN and the password, a check-before-sending step and `vault.recovery.open`; §4 "Recovery and unlock from release R".) Only with the backup on: scan the portal's recovery QR, or type its code (0.1.33, below) → claim (`email_hint`) → register → PIN → credential password → the app replaces the old one. No other path: 0.1.6's backup-off choice (new credential or delete) is removed. `no_backup` at register or unlock (a vault whose backup is off): "This vault cannot be recovered: its credential backup was off. Delete it on the account site and start over with a new setup code", with a link to the portal's start-over page (MEMBER-API 2.1.0) and then to onboarding |
| Recovery: type the code (new phone) | — (VettID-specific) | 0.1.33 (owner decision of 2026-10-11; VAULT-MESSAGING 0.25.0 §11.11.10). **Where:** **Type the code instead**, a text button on the recover intro (under **Scan the code**) and on the scan screen, and the primary action when the camera permission is refused or the phone has no working camera; **Scan instead** leads back. **The screen:** title "Type your recovery code"; body "On the account site, under the QR code, there are 12 groups of four characters. Type them all, in order."; one text field, monospace, drawn in groups of four in three rows as it fills, with "*n* of 12 groups" under it; **Continue**, enabled at 48 characters. **Input:** paste accepted; spaces, hyphens and line breaks dropped; lower case accepted and shown upper case; `I` and `L` become `1` and `O` becomes `0` as typed (the code never contains them); `U` is refused with "The code has no letter U. Check whether it is a V." and any other character with "The code uses only digits and letters."; a forty-ninth character is ignored. The keyboard is text, capital letters, with no autocorrect, no suggestions and no personalized learning. **Before anything is sent:** the app recomputes the 4 check characters with its own built-in member API origin. On a mismatch: "That code doesn't match. Compare it with the account site group by group, and check that the site is <account host>." Nothing is sent and nothing is counted; the entry stays for correction. A paste of exactly 32 valid characters (the bare code an account page showed before MEMBER-API 2.4.0) says "That is the short code of an older page. Reload the recovery page on the account site: it shows 12 groups." **Then:** `POST /api/vault/recovery/claim {locator, app_key}` signed with an empty `vault` → `vault_id`, `recovery_id`, `user_guid`, `email_hint` → the same `RecoveryCode` a scan produces → register → PIN → credential password, the row above. **Answers:** every answer shows the text the scan shows for it, and returns to the typed entry: the claim's `404` ("This recovery is no longer active…"; with the check passed, a mistyped locator is not a likely cause), `409 recovery_not_available`, `429` and the register's `bad_code` ("That code is not right. After 5 wrong codes the recovery is cancelled. Wrong codes from this phone: *n* of 5."), voided, `expired`, `too_early`, `used`, `attestation`, `retry` and `no_backup`. The characters are kept for correction, and cleared when the recovery has ended (the fifth wrong code, `expired`, `used`, `no_backup`). **Never:** an account session, the member's email typed or shown beyond `email_hint`, the code or the locator written to disk, logs, the clipboard or saved state that outlives the process; the screen is excluded from screenshots and the recent-apps preview (`FLAG_SECURE`; the first screen of the app to set it, an open point for the owner). **Accessibility:** TalkBack reads the field group by group, character by character; the count and every refusal are announced (a live region), a refused character naming its group ("group 4"); the layout holds at the largest font scale (the groups wrap to more rows); the entry survives rotation; nothing times out but the code's own 24 hours. **Tests:** `RecoveryCodes.normalize` extended to 48 characters and its `U` refusal; the check against VAULT-MESSAGING §16's vector for production and staging, and a staging string refused by a production build; a failed check makes no request; typed and scanned entry of the same recovery produce equal register requests; `bad_code` text and count equal either way; screen-catalog entries for empty, partial, refused character, failed check, `404` and `bad_code`; an end-to-end typed recovery on staging. **As built (0.1.37; vettid-android #113):** the keyboard is the **password-class** text keyboard with capital letters (Android has no flag that turns off suggestions and personalized learning on a plain text keyboard; the password class does, and the characters stay visible). A refused character's message **names its group on screen**, not only to TalkBack: "The code has no letter U. Check whether it is a V. Look at group 4." (likewise for any other character). **Continue** stays disabled below 48 characters; the keyboard's Done key with fewer says "The code has 12 groups of four characters. Type them all." The "short code of an older page" text appears when a paste leaves exactly 32 characters, and on Done with a bare code. On a phone with no camera at all (no camera feature) the scan screen shows **"No camera"**, "This phone has no camera that VettID can use. Type the code instead.", and typing is the primary action. A `429` that carries `Retry-After` (in seconds) shows "Too many attempts. Try again in *wait*." and counts down, on the intro, scan and type screens alike; it does not disable the retry, and without the header the general "Too many attempts" text is shown. The typed characters live in the screen's view model only: kept when switching to the scan and back and through refusals that can be corrected, and cleared **when the register succeeds** (before the PIN step), on `no_backup` and when the recovery has ended (voided, `expired`, `used`). A scanned claim reads the answer's `vault_id` and `recovery_id` as optional (a member API before 2.4.0 did not send them; the QR has both); the claim by locator requires them |
| Pending deletion | — | When `GET /api/vault/status` shows `deletion` (a start-over requested on the portal, VAULT-MESSAGING §11.11.9): an urgent banner with the time left and **Cancel deletion** (`POST /api/vault/deletion/cancel {deletion_id}`, signed by the app key, with the `deletion_id` from the status's `deletion: {deletion_id, state, deletes_at}`, MEMBER-API 2.1.1) |
| Vault update | — (VettID-specific) | 0.1.19 (owner decision of 2026-10-09). **Banner** at the top of the shell while the trusted manifest lists an `active` release newer than the vault's: "A new vault release is available (release N)" with Update now and a close button (back after 24 h; a newer release or a change to the end-date warning shows at once), or, for a `retired` release or a `deprecated` one with an `ends_at`, the urgent "Your vault's release ends on <date>. Update now to keep your vault" (also back after 24 h). The offer is read from the manifest at app start, on return to the foreground and after every unlock (no other polling). **Notification**: one local notification per release on the "Vault updates" channel, its tap opens the update screen; the POST_NOTIFICATIONS permission is asked once, when the first banner shows. **Update screen** (banner, notification, Settings → Vault → "Update available"): the release number, the PCR0 fingerprint, "Anyone can rebuild it and compare the fingerprint", the release notes, the vault PIN and **Approve and update** (no credential password: the owner check, when due, comes first through the shell's gate). Then, over every screen: lock → the unlock with the approved `release_update` (built as at the unlock screen) → `update: moved` → the unlock that reaches N+1 with the same PIN ("Updating your vault…", three steps; "Release N is starting. This can take a few minutes." while the API answers `503 release_starting`). Outcomes: done; refused (`target`, `downgrade`, `approval`, `seal_key`, `pending`, `write`, each explained; the vault stays on its release and is open); a wrong PIN or the backoff (the vault is locked, nothing moved; "Approve and update" again or "Unlock without updating"); N+1 does not open (try again, or **Return to release N**, confirmed, only while the move is unconfirmed). The PIN is held only while a step runs. The unlock screen's "Approve the update with this unlock" stays. 0.1.31: the update screen and the unlock offer open with **What's new in release N** (next row), above the fingerprint and the PIN; the bare "Release notes" link becomes that section's "Full release notes" |
| What's new | — (VettID-specific) | 0.1.31 (owner request 2026-10-10; RELEASE-UPDATES 0.3.0 §2, §5). **Where:** at the top of the update screen (reached from the banner's Update now, the notification and Settings → Vault → "Update available": every path to an update passes through it before **Approve and update**) and in the unlock screen's release offer, before "Approve the update with this unlock". There is no update path that skips it. **What:** the heading "What's new in release N"; the log entry's `summary`; its `changes` as a bulleted list; the security line ("No security fix", "Security fix: update recommended" or "Security fix: update urgently", the latter two followed by `security_text`); the label "From <host>" (vettid.org; staging builds staging.vettid.org) with "Release notes are information. What keeps your vault safe is the signed release list and the fingerprint below."; and **Full release notes**, which opens the manifest's `notes` URL in the browser. When the vault is more than one release behind, the summaries of the releases in between follow under "Also in earlier releases" (one line each, from the same `index.json`). **Source:** the channel's log `index.json` (VAULT-RELEASES §7), public and unsigned. The app fetches it only when the trusted manifest's (published or loaded canary) `notes` for release N is exactly `https://<host>/security/releases/<N>/` and `<host>` is the host of the build's pinned manifest URL (vettid.org; staging.vettid.org; the dev stack's manifest host); it then fetches `https://<host>/security/releases/index.json` and no other URL. Any other `notes` (staging S1–S8 still carry GitHub URLs until the backfill is published) means no fetch. GET without cookies or credentials, redirects refused, 10 s timeout, at most 1 MiB, JSON only. The entry used is the one whose `release` is N **and** whose `pcr0` equals the manifest's PCR0 for N; otherwise none. Shown as plain text only (no markup, no tappable links), each field cut with "…" past the RELEASE-UPDATES §5 limits (summary 160 characters, 20 changes of 280, `security_text` 1,000). Kept in memory per host, release and PCR0 until the process ends; nothing is stored on disk or in the vault. **Information only:** nothing in it is used for a decision: which release is offered, its status, `ends_at`, the fingerprint and the approval come from the signed manifest alone. **Fallback:** while loading, a progress line, and **Approve and update** stays enabled; if the fetch fails, the entry is missing or does not match, or `notes` is not a log URL: "Release notes unavailable" with **Full release notes** (when `notes` is an `https` URL, as the manifest parser already requires), and updating stays possible. Opening the screen again retries. **Notification** ("Vault updates"): before posting it the app tries the same fetch (same rules, 10 s); with an entry its text is the summary ("Release N: <summary>"), otherwise the current text; it is not updated afterwards |
| Transfer (new phone) | — (VettID-specific) | (0.1.40, release R: the phone key and its secret in `hs.init`, then **Finish the move**; the old phone keeps its keys until then, for at most 7 days; §4 "Recovery and unlock from release R".) Scan the old phone's transfer QR → compare the SAS → wait for the approval → `device.paired{transfer}`: the app stores its `vault_id` and the member's `user_guid` (VAULT-MESSAGING 0.17.0 §6.7.1) like an enrolled phone, so that it unlocks later with the PIN. Without `user_guid` (a vault release before 0.17.0) the transfer still completes and the app warns: "This phone cannot unlock your vault after it locks until your vault is updated" |
| Onboarding | Sign-in flow | Scan the setup QR from the account portal, or type its short code with the account's email (no sign-in in the app, VAULT-MESSAGING 0.15.0 §11.12) → confirm the account (`email_hint`) → enroll vault (PIN, credential password) → first connection guide |

**History** (0.1.11, owner decision of 2026-10-07). The member's audit
log, as the vault keeps it (VAULT-MESSAGING §10.9), read-only: nothing on
the screen changes or deletes an entry.

- **List.** Rows newest first: an icon and label per kind (from the
  app's string resources; an unknown kind shows the kind itself), the
  connection's "First Last", the device's or the item's name where the
  entry refers to one (resolved from the app's caches; a removed one
  shows "Removed connection" / "Removed device" / "Deleted item"), and
  the time. The device (0.1.27) is any entry's `device_id`, since
  VAULT-MESSAGING 0.23.2 also on `vault.unlocked` and a device's
  `vault.locked`: its name from `device.list` (read when History opens
  and when it is shown again; without an answer no device is named),
  after the item and connection names on the row's second line, which
  is the category's name only when the entry names none of the three. Infinite scroll: `audit.list` with `limit` 50 and
  `before_seq` = the previous page's `next_before_seq`; no
  `next_before_seq` is the end of the log ("Start of your history"). A
  page with `partial: true` (a search that ran out of its scan budget)
  may hold few or no entries: the app keeps loading with the cursor
  while the list is short of the screen, and shows "Searching older
  entries…" until it has a full page or the end.
- **Search.** A search field in the top bar sends `q` (trimmed, NFC,
  at most 128 bytes; the field stops there) after a 300 ms pause, and
  restarts the list. The vault matches the kind and the current names
  of the connection, device and item (§10.9); the hint text says so:
  "Search by name or event". It does not search the app's own labels,
  which may be translated: searching "unlocked" finds
  `vault.unlocked`, searching a translated label may not.
- **Filters** (chips under the search field, combined with each other
  and with the search):
  - **Category**, one at a time ("All" by default), sent as `kinds`
    prefixes:

    | Category | Identifier (0.1.17) | `kinds` prefixes |
    |---|---|---|
    | Unlocks and daily checks (0.1.52; was "Unlocks and owner checks") | `unlocks` | `vault`, `owner_check` |
    | Security | `security` | `credential`, `identity`, `recovery`, `audit` (0.1.17: `audit.exported`, a History export) |
    | Devices | `devices` | `device`, `approval` |
    | Connections | `connections` | `connection`, `intro`, `profile` |
    | Messages and calls | `messages` | `message`, `call` |
    | Vault (items, sharing, wallet) | `vault` | `item`, `tag`, `share`, `grant`, `critical-secret`, `wallet` |
    | Agents | `agents` | `leash`, `action` |
    | Location | `location` | `location` |
    | Account and settings | `account` | `account`, `settings` |
    | Blocked and dropped | `dropped` | `drop` |

    The identifier is the category's stable name in an export file
    (below); it is never translated. An entry whose kind falls in no
    category has the identifier `other`.

    Every audit kind of §10.9 falls in exactly one category (blocks are
    `connection.blocked` / `.unblocked`, so under Connections). A kind
    a newer vault adds outside these prefixes appears under "All" only.
  - **Connection**: pick one from the connection list; sent as
    `connection_id` (`audit.list`; the connection's detail screen opens
    the same History screen with it preset, using
    `connection.audit.list`).
  - **Date range**: presets (today, last 7 days, last 30 days) and a
    custom range from the date picker, sent as `since` (the start of
    the first day, local time, as RFC 3339 with offset) and `until`
    (the start of the day after the last).
- **Entry detail** (tap a row): the label and kind, the exact time,
  the connection (opens it, if it still exists), the device (0.1.27:
  its name, "Removed device" once unlisted, "(this phone)" when it is
  this app's own `device_id`, then the id as **Device ID**), the item
  (opens it, if it still exists and is not critical; a critical item
  opens only with the credential password as elsewhere), `direction`,
  `ref` (copyable), `seq` and the entry's `hash`. Nothing in the detail
  is editable.
- **Integrity.** Unfiltered pages chain (`prev` = the next older
  entry's `hash`); the app checks the chain where pages are contiguous
  and keeps its anchor as VAULT-MESSAGING §10.9 says (an
  `after_seq` read from the anchor in the background, never from a
  filtered list). A log that does not extend the anchor shows a red
  banner "Your vault's history does not match what this phone saw
  before" at the top of History and in Settings → Security; filtered and
  searched lists are not chain-checked.
- **States.** Empty log: "No history yet". No results: "Nothing
  matches" with "Clear filters". While held or due (§3.6), History is
  gated like every vault screen.
- **Export** (0.1.17, owner decisions of 2026-10-08; VAULT-MESSAGING
  0.22.0 §10.9 History export). History's top bar has a ⋯ menu with
  **Export…**, also on a connection's History. It exports what the list
  shows: the current category, connection, date range and search, never
  more. Only the app offers it (VettID desktops do not, in this version).
  1. **Confirm sheet.** On opening, the app sends the preview
     (`audit.export{dry_run: true}` with the list's filters) and shows
     "40 entries, 1 Oct 2026 – 8 Oct 2026" (the count, and the dates of
     `oldest_at` and `newest_at` in local time), the filters in words,
     the format choice **CSV** ("for a spreadsheet") or **JSON** ("for
     checking against your vault"; neither is preselected), and the
     notice: "The file is not encrypted. Anyone who
     gets it can see who you connected with, your devices and item
     names, and when. It holds no item values, passwords or messages."
     With `count` 0: "Nothing to export" and no Continue. While a
     credential alarm is open the preview is refused
     (`credential_frozen` / `rotation_required`) and the sheet says so
     (below), with no Continue. With `more`:
     "Only the newest 10,000 of the matching entries can be exported.
     Narrow the dates to export older ones", with Continue still
     offered for the newest 10,000.
  2. **PIN.** Continue asks for the **vault PIN** (not the credential
     password, not the biometric app lock), on its own step, and sends
     `audit.export` with the same filters, the format, the preview's
     `upto_seq` and the PIN sealed to a UTK (topping the pool up first
     if it is empty). `bad_pin`: "Wrong PIN" (it counts only in the
     vault's PIN backoff, not as a failed owner check);
     `credential_frozen` / `rotation_required`: "Export is not
     available while a credential alarm is open", with a link to the
     alarm; `backoff`: the countdown; `not_found`: "Nothing to export"
     (the entries are gone); `owner_check_required`: the owner-check
     screen.
  3. **Reading.** A progress sheet ("Preparing 40 entries…") pages
     `audit.list` with `limit` 100 from `before_seq` = `upto_seq` + 1
     with the same filters, keeps the first `count` entries, and
     resolves the names as the list does. The entries are held in
     memory only. Cancel drops them; the `audit.exported` entry stays
     (the vault recorded the authorised export).
  4. **Saving.** The system's "Save to…" dialog (Storage Access
     Framework, `ACTION_CREATE_DOCUMENT`, MIME `text/csv` or
     `application/json`), suggested name
     `vettid-history-<YYYYMMDD>-<HHMMSS>.<csv|json>` (UTC). The app
     writes straight to the chosen document through its stream: no
     copy in shared storage, the gallery, the cache or the clipboard,
     no upload, no share sheet. A dismissed dialog discards the data.
     After saving: "History exported" with the count; fewer entries
     than authorised (the log's retention dropped old ones meanwhile):
     "38 of 40 entries exported; 2 older entries were removed by your
     vault's history limit meanwhile".
  - **Writers**: CSV and JSON exactly as VAULT-MESSAGING §10.9 defines
    them (columns, quoting, the byte order mark for CSV, the apostrophe
    before `=`, `+`, `-`, `@`, tab and CR, `hash` in hex in CSV;
    the JSON header and entries with `prev` and `hash`); unit tests
    recompute the hash chain of a JSON export.
  - The new entry `audit.exported` shows in History under Security as
    "History exported" with its format and count from `ref`.

**Notifications** (0.1.23; the owner's answers of 2026-10-09 in §9).
The vault's **feed** (VAULT-MESSAGING §10.9): the owner's
activity list, with read and archive state shared by the owner's
devices. "Notifications" in everything the member sees; "feed" in the
specifications, the code and this plan's technical text (as Vault and
item, above).

*Today.* The app already has the transport: `VaultApi.feedList`,
`feedGet`, `feedUpdate`, `feedDelete`, the `feedEvents` flow and the
`FeedItem` and `FeedPage` models (`:core:vault`). Only
`OwnerCheckManager` uses them, for the `owner_check.*` notices of the
shell's gate (§6 Owner check); 0.1.22's notices (paused asks, rate
limits) show only on the connection page and in Approvals. There is no
feed repository and no screen.

1. **Where it lives.**
   - A **bell** (`Notifications` outlined) in the top bar of every drawer
     screen (Messages, Connections, Approvals, Vault, History, Settings,
     Help), between search and the avatar, with the existing
     `CountBadge`: the number of `active` (unread) items, "99+" above 99;
     no badge at 0. Detail screens have no bell.
   - An urgent unread item (`credential.alarm`, `owner_check.locked`)
     turns the badge red (the error colour); otherwise it is gold.
   - No drawer entry (§9 question 1). Approvals keeps its own badge:
     Approvals is the to-do list (what waits for a decision), Notifications
     the record of what happened, so an ask is in both.
2. **Repository** (`:core:data`, `FeedManager`, the pattern of
   `ItemsManager`): a `StateFlow` of the items by `item_id`, the cursor
   (the highest `seq` applied) and a load state; one per open vault.
   - **Open** (unlock, app start with the vault open, a passed owner
     check): `feed.list{after_seq: 0, limit: 500}`, repeated with
     `after_seq` = the last item's `seq` until a page is shorter than the
     limit; items with `status: "deleted"` are dropped; the cursor is the
     response `seq`. This reads the whole feed (at most 1,000 live items,
     §10.9) and its state in one pass; `feed.list` without `after_seq`
     has no cursor for older pages (§9 question 7).
   - **Live**: `feed.event` (a new item) is upserted. `sync.event`
     `feed.updated` / `feed.deleted` (another device read, archived or
     deleted an item; a batch's `count` changed, §10.4.1) and any
     `feed.event` whose `seq` is not cursor + 1 trigger a **catch-up**:
     `feed.list{after_seq: cursor}`, paged as above, coalesced (one in
     flight, one queued); each returned item replaces the cached one,
     `deleted` removes it. The app's own `feed.update` / `feed.delete`
     apply the response at once (the vault sends no `sync.event` to the
     sender, §10.1).
   - **Return to the foreground** and a relay **reconnect**: a catch-up.
   - **Retention**: items older than `feed.retention_days` (§10.8,
     default 30) are dropped locally as well (§9 question 7).
   - **Clear**: on lock, on entering `held` or `due`, on a wipe, and with
     the process; the next open reads again (below, 7).
3. **The list.** Newest first by `at` (not by `seq`, which changes at
   every read; a batch keeps its first ask's `at`).
   - **Needs attention** at the top: unread items of priority `urgent`,
     newest first, each on the error container colour with a red leading
     bar; reading one moves it to its day.
   - **Day groups** below, by `at` in local time: Today, Yesterday, then
     the date ("Mon 5 Oct"; with the year when not the current one).
   - **Row**: the kind's icon in its History category colour (0.1.22),
     the connection's tile instead where the item names a connection
     ("First Last", or "Removed connection"); a title from the kind (2,
     below) and a second line (the device's or item's name, or the
     batch's "3 things"); the time; a gold dot while unread. Unread
     rows bold, read rows regular. Priority: `urgent` as above; `high`
     an amber icon tile and "Important" for screen readers; `normal`
     plain; `low` the secondary text colour.
   - **Filter chip** bottom-left (the design language's floating chip,
     §3): **Unread** (`status: "active"`). The ⋯ menu: **Mark all as
     read**, **Archived**.
   - **Swipe** (each also a screen-reader custom action and in the row's
     long-press menu): end-to-start **Archive** (`feed.update{status:
     "archived"}`) with an **Undo** snackbar that restores the previous
     status (`active` or `read`); start-to-end **Mark as read** /
     **Mark as unread** (`read` ↔ `active`).
   - **Archived** view (from ⋯): the archived items, the same rows;
     swipe **Move to Notifications** (`status: "read"`) and **Delete**
     (`feed.delete`, confirmed: "Delete this notification on all your
     devices?"; for a batch's item: "Later requests from <First> will
     start a new notification", §10.4.1, 0.23.1). Nothing is deleted
     from the main list (§9 question 5).
   - **Mark all as read**: `feed.update{status: "read"}` for each
     `active` item, at most 4 in flight, the count falling as they
     land; there is no bulk type (§9 question 4).
   - **Viewing marks read** (0.1.26, owner feedback of 2026-10-10):
     while the screen is in view (resumed), every unread item that is
     not `urgent` is marked read, without waiting for the answers and
     past the screen's end, the 4 in flight shared with Mark all as
     read: those unread when the screen comes into view and those that
     arrive while it is in view (an item not seen before; not one
     another device marked unread meanwhile). The bell's count falls
     with them. **Urgent** items (Needs attention) stay unread, and the
     badge red, until tapped or marked read: a security alarm never
     goes by a glance. The items read by viewing keep the gold dot and
     the bold text, and stay under the Unread chip, until the member
     leaves the screen (stopped: back, a target opened, the app in the
     background); on return they show as read. Each item is marked read
     by viewing at most once while the screen lives: one the member
     marks unread (swipe), or that another device marks unread while
     the screen is in view, stays unread. On a row still dotted after
     viewing, the swipe reads Mark as read and only takes the dot away.
     The Archived view marks nothing. `feed.updated` on other devices
     as for any read; their system notifications are cancelled (9).
   - **Empty states**: "No notifications" / "Nothing unread" (with
     "✕ Clear" for the chip, 0.1.21) / "Nothing archived".
4. **Tapping an item** marks it read (`feed.update{status: "read"}`, not
   waiting for the answer) and opens its target. When the target is gone
   (a removed connection, a deleted item, an ask already decided or
   expired), a **detail sheet** opens instead: the label, the exact
   time, the connection, device or item as History resolves them, and
   "This is no longer waiting" for an ask. Unknown kinds (a newer vault)
   show the kind itself with a generic icon and open the sheet; they are
   never hidden. Deciding an ask in Approvals also marks its feed item
   read (matched by kind and `ref`; §9 question 2).

   | Kind (§10.9) | Label (en) | Opens |
   |---|---|---|
   | `connection.request` | "<First Last> wants to connect" | Approvals: the request (`ref` = `pending_id`) |
   | `connection.request.peer_declined` | "<First Last> did not accept your request" | The connection (`connection_id`), else Connections |
   | `connection.added` | "You are now connected with <First Last>" | The connection |
   | `connection.removed` | "<First Last> was removed" | Detail sheet |
   | `connection.stale` | "<First Last> has not been reachable" | The connection |
   | `connection.asks_paused` | "<First>'s requests are paused" (§10.4.1) | The connection, its requests (Resume, remove) |
   | `connection.authenticate.requested` | "<First Last> asks you to confirm it is you" | Approvals: the challenge |
   | `message.received` | "New message from <First Last>" | The conversation |
   | `call.missed` | "Missed call from <First Last>" | The conversation (calls come later, §6) |
   | `grant.request` | "<First> asks for <item>"; with `count`: "<First> asks for N things" | Approvals: the request, or the batch's entry (0.1.22) |
   | `grant.shared` | "<First> shared <item> with you" | The connection's "Shared with you" |
   | `grant.revoked` | "<First> stopped sharing <item>" | The connection's "Shared with you" |
   | `share.pending` | "Your <tag> rule for <First> needs a decision" | Approvals: the share decision (`ref` = `rule_id`) |
   | `share.rate_limited` | "<First> reached the limit of your <tag> rule" (§10.12) | The rule's editor (`ref` = `rule_id`) |
   | `critical-secret.use.request` | "<First> asks to use <item>" | Approvals: the use (credential password there) |
   | `item.revealed` | "<item> was revealed" | The item (a critical item asks for the credential password, as elsewhere) |
   | `device.pair.pending`, `device.paired`, `device.unlinked`, `device.transferred`, `device.replaced` | "A device asks to pair" / "<device> was paired" / "<device> was removed" / "Your vault moved to this phone" / "Your vault moved to a new phone" | Settings → Vault (devices) |
   | `device.session.pending`, `approval.pending` | "<device> asks for access" / "<device> asks to approve a request" | Approvals |
   | `credential.alarm` (urgent) | "Your credential was used somewhere else" | The alarm screen (as the shell's banner) |
   | `credential.password_failed` | "Wrong credential password entered" | History, Security |
   | `credential.rotated`, `credential.reset` | "Your credential was renewed" / "Your credential was reset" | Settings → Security → Credential |
   | `owner_check.failed` (high) | "A daily check failed: wrong PIN" / "…wrong password" (`ref`) | Settings → Security (the check) |
   | `owner_check.locked` (urgent) | "Your vault locked after 10 failed checks" | Settings → Security |
   | `owner_check.hold_changed` (high) | "Hold turned off until <date>" / "Hold turned on" / "Hold back on" (`ref`) | Settings → Security (the hold) |
   | `device.secret_renewed`, `recovery.completed`, `recovery.attempt`, `recovery.change_required`, `recovery.counter_unavailable`, `identity.rotation_failed`, `identity.rotate_conflict`, `leash.item.run`, `leash.item.proxy` | as §4 "Event titles" (0.1.52) | Detail sheet |
   | `vault.pin_changed`, `credential.recovered`, `recovery.device_paired` | not listed and no notification (§4 "Event titles", de-duplication; 0.1.52) | — |
   | `guide` | the item's `title`; `body` in the sheet | Detail sheet |
   | `leash.*`, `action.request`, `intro.request`, `location.shared`, `location.request`, `wallet.signed` | from the app's strings, as History | Detail sheet: "Not available in this version of the app" (agents, shared actions, introductions, location and wallet come later, §6; their asks expire as their sections say). 0.1.42: `wallet.signed` opens the transaction from W1, `location.shared` the connection and `location.request` Approvals from L1 (§4 "Wallet, presence, location and video") |

   Names come from the app's caches as in History (§4 History);
   `<item>` is the item's name, never a value; `<tag>` names the rule by
   its tag (0.1.22). The labels live in string resources.
5. **Batches** (§10.4.1). An item with `count` is one row and one
   Approvals entry; a later ask of the batch updates the row's count in
   place (catch-up), without moving it, and leaves its read state as the
   member set it (0.23.1).
6. **Owner-check notices.** The shell's gate keeps its `owner_check.*`
   banner (§6 Owner check, 8); the items are also in the list. Closing
   the banner marks them read, as today, and reading them in the list
   closes the banner (one source: `FeedManager`; `OwnerCheckManager`
   reads the notices from it instead of its own `feed.event` handler).
7. **While held or due** (VAULT-MESSAGING §3.6.3, §3.6.5). The vault
   sends no `feed.event` and no `sync.event` (except the clone alarm),
   and the app MUST NOT show cached feed content: the feed is cleared
   on entering the hold, the bell is not shown, and the held screen
   shows only the `vault.held` counts (`other` covers what would have
   been feed items). The credential alarm's `feed.event`, which does
   arrive while held, opens the alarm path (allowed while held) but is
   not listed. After the check: a full read (2, Open), never replayed
   events; the bell then counts what arrived.
8. **The release banner** (0.1.19) **stays separate.** Releases are not
   feed items (§10.9's kinds; the app learns of a release from the
   manifest and `sync.event{vault.release}`, §11.10.6), so the
   Notifications screen does not list them, and the "Vault updates"
   channel keeps its one notification per release (§9 question 6).
   The credential-alarm and pending-deletion banners stay as they are.
9. **System notifications** (0.1.23, owner answer to question 3):
   feed items raise Android notifications through the member's
   notification mode (§4 Notification modes, Mapping): one per item,
   one per batch, never one per ask of a batch in progress (§10.4.1, a
   MUST), cancelled when the item is read, archived or deleted on any
   device. Opening a notification marks its item read and opens the
   item's target (4).
10. **Privacy.** Nothing from the feed is kept outside an open vault,
    the same as item metadata: the items, the cursor and the counts are
    in memory only (no Room table, no file, no DataStore, no
    `SavedStateHandle` beyond an `item_id`), cleared as in 2; nothing
    from the feed goes to logs or crash reports (kinds and `seq` in
    debug logs only, never names, titles or bodies); system
    notifications follow §4 Notification modes, Content.
11. **Tests.**
    - Unit (`FeedManager`, fake `VaultApi`): the paged open read and its
      cursor; `deleted` dropped; `feed.event` upsert; a `seq` gap and
      `feed.updated` / `feed.deleted` each cause one coalesced catch-up;
      a batch's `count` update keeps the status; the own `feed.update`
      applied from the response; retention; clear on lock, held, due and
      wipe; the unread count; Mark all as read with an error midway;
      viewed items marked read except urgent ones (0.1.26).
    - Unit (ViewModel, 0.1.26): viewing marks the unread non-urgent
      items read, urgent ones kept; arrivals in view marked, not while
      paused; the dots and the Unread chip kept until leaving; an item
      marked unread (here or on another device) not marked again; the
      Archived view marks nothing.
    - Unit (labels and targets): every kind of §10.9 has a label, an
      icon, a category colour and a target; an unknown kind falls back;
      a missing connection, device or item resolves to "Removed …" or
      "Deleted item" and the sheet.
    - Compose UI: the bell and badge (0, 1, 99+, red for urgent);
      Needs attention, day groups, unread and read styles, the four
      priorities; swipe archive and Undo, mark read and unread; the
      Archived view and confirmed delete; the Unread chip and "✕ Clear";
      the empty states; TalkBack custom actions; both themes, AA.
    - Screen catalog (debug tools): each state above, plus a batch and an
      unknown kind.
    - Instrumented, dev stack: a `vaultctl` peer's connection request and
      grant request show live with the bell; a desktop (`vaultctl`)
      reads and archives and the phone follows; a batch of three asks is
      one row with count 3; the vault driven past its deadline (the
      injectable clock) clears the list and shows only counts, and after
      the check the list holds what arrived; lock and unlock re-read it.
    - Privacy: after a lock, the app's files and databases hold no
      `item_id`, kind, name or `seq` of a feed item (a test that scans
      the app's data directory, as for item metadata).
    - Manual: the test phones (Pixel 10 Pro, Pixel 7) against staging.

**Notification modes** (0.1.23; owner answer of 2026-10-09 to
Notifications question 3, D7). "I'd like to get the current app working
with notifications via a service on the phone … the ability to enable
service based notifications (more private) or Google push based
notifications or disable notifications (not recommended)." Settings →
App → **Notifications** replaces today's line "Messages arrive while
VettID is open. Push comes later." (the app today collects only while
its process runs; nothing keeps it running in the background).

1. **The setting.** One choice, "How notifications reach this phone":
   - **On-phone service** — "Recommended. Most private: your phone keeps
     its own connection, and no Google or VettID push service is
     involved. Uses a little more battery." **The default for new
     installs**, and for the update to this version.
   - **Google push** — "Uses Google's push service to wake VettID. Google
     learns only that VettID was woken, never who or what." Shown
     disabled with **"Not available yet"** until the build has FCM
     configuration and the vault answers `push.register` (below; 0.1.32:
     disabled only in a build without the configuration. When it is the
     vault that answers `unavailable`, the choice can be made and stays
     selected, with "Not available yet" under it, 4); with
     **"Needs Google Play services, which this phone does not have"**
     when they are missing (GrapheneOS without sandboxed Play, for
     example); "Google Play services need an update" when outdated.
     (0.1.34) In the `foss` distribution (4) it is shown disabled, not
     hidden, with **"Not available in this build of VettID, which
     contains no Google software."**
   - **Off** — "Not recommended. You see messages, requests, calls and
     security alarms only when you open VettID." Choosing it asks to
     confirm with the same text.

   Under the choice: a **status line** (Connected; Waiting for network;
   Your vault is locked: notifications resume after you unlock it; Daily
   check due; Notifications are blocked in Android settings, with a
   button to them; Battery optimisation may delay notifications, with
   "Allow in background"), **Show in notifications** (Content, below)
   and **Notification categories** (the system's channel settings).
   The mode is a device preference (DataStore), not a vault setting:
   it describes this phone. Changing it stops the old path first (the
   service, or `push.unregister`) and then starts the new one, with one
   exception (0.1.32, so that this plan and PUSH-GATEWAY §11.1 say the
   same): **to Google push**, the app registers first and the on-phone
   service keeps running until the vault answers that it holds the
   registration (`push` `active`), then stops, so no notification falls
   into a gap. **From Google push to the service**, `push.unregister` is
   started first and the service then starts without waiting for its
   answer. **To Off**, both stop. When the vault cannot be told now
   (locked, no network), the app deletes its token all the same and
   sends `push.unregister` when the vault next opens on this phone; a
   wake that still arrives for a registration the phone no longer wants
   collects nothing and drops it.
2. **Permission.** POST_NOTIFICATIONS (Android 13+) is asked when a mode
   other than Off is chosen, and on first start in the default mode
   after the onboarding's last step ("Allow VettID to notify you about
   messages, requests and security alarms"); 0.1.19's first-banner ask
   then finds it decided. Refused: the mode stays, the status line says
   "blocked", and the system settings are one tap away once Android no
   longer asks. With the permission refused the service still runs (Android 13+ then shows its notification only in the
   task manager), so the app is current when opened.
3. **(a) On-phone service.** A foreground service (`VaultConnectionService`
   in `:core:notify`) keeps the app's own relay connection as
   PUSH-GATEWAY §11 "Devices without push" describes: the
   `MailboxCollector` the app already uses (RELAY-PROTOCOL §6: WebSocket,
   long-poll fallback) runs in the service instead of only while the
   app is open; messages are decrypted on the phone with the device's
   session keys, acked after persist as today (§8.3), and turned into
   local notifications (Mapping, below). No wake_ref, no gateway, no
   Google: the relay sees only this device's usual collects.
   - **Foreground-service type.** `specialUse` with the
     `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` "Keeps the user's own end-to-end
     encrypted message connection open to show notifications on
     devices without a push service", and the Play Console declaration
     (description and video). Not `dataSync`: Android 15 limits it to 6
     hours a day and forbids starting it from `BOOT_COMPLETED`. Not
     `remoteMessaging`: it is for continuing a messaging task on another
     device, which this is not, and Play reviews it against that use.
     `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_SPECIAL_USE` in the
     manifest. To be confirmed against the Play policy at the time of
     submission (§9 question 11).
   - **Its notification** (required by Android): on the "Connection"
     channel, importance MIN (no icon in the status bar, collapsed at
     the bottom of the shade), not dismissible on Android < 14 (14+ lets
     the member swipe it away; the service keeps running): "VettID is
     connected" / "Waiting for network" / "Vault locked". The tap opens
     Settings → App → Notifications. It never names a connection.
   - **Start.** When the mode is chosen; at process start
     (`Application.onCreate`) when the app has a vault and the mode is
     the service; on `BOOT_COMPLETED` (`RECEIVE_BOOT_COMPLETED`; sent after
     the member first unlocks the phone, when the credential-encrypted
     storage holding the device state is readable; no direct-boot
     receiver); on
     `MY_PACKAGE_REPLACED` (after an app update). These broadcasts are
     exemptions from Android 12's background-start limit. Not started
     on a phone without an enrolled vault, or after a wipe.
   - **Connection and backoff.** One connection for the process (the
     app's screens use the service's collector while it runs). On a
     drop: reconnect with exponential backoff and full jitter, 1 s
     doubling to 5 minutes; reset after 5 minutes connected; an
     immediate retry when `ConnectivityManager` reports a validated
     network, and none while there is none. Relay `429` follows its
     `retry_after`. Token or address changes (`relay.token.issued`,
     `relay.address.update`) are handled as when open.
   - **Battery and Doze.** The WebSocket idles between frames; the
     service holds no wake lock beyond handling a batch (at most 10 s
     per batch). In Doze, Android suspends network access for apps not
     exempt from battery optimisation, so delivery can wait for a
     maintenance window: the status line offers "Allow in background"
     (`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`, no special
     permission; Play restricts `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`)
     and explains the delay without it. On return to the foreground the
     app collects at once as today, so nothing is lost, only late.
   - **Vault locked** (VAULT-MESSAGING §12.1). A locked vault collects,
     deposits and wakes nothing: nothing new reaches the device's
     mailbox, so the service has nothing to show. On `vault.locking` (unless the
     member locked it on this phone) it posts "Your vault is locked. You won't be notified until you unlock
     it" (Security channel, one at a time) and its own notification says
     "Vault locked". Locks that send no `vault.locking` (an unsignalled
     enclave restart, a lost lease, §12.3) are found by
     `GET /api/vault/status` (MEMBER-API, signed by the app key) at
     every reconnect and at most every 60 minutes while the relay
     brings nothing. While locked the service keeps no relay
     connection open (a status read each 60 minutes only); after an
     unlock in the app it reconnects. What a locked vault's phone can
     still decrypt: only messages the vault deposited before it locked
     and the device has not yet collected; they are collected and
     notified as usual.
   - **Vault held or due** (§3.6.3). The vault keeps running but sends
     this device only `vault.held` (the counts), `vault.locking`,
     `credential.alarm` (with its `feed.event` and `sync.event`),
     `device.transfer.pending`, `device.unlinked`, and the token,
     address, rotation and handshake messages; no `feed.event`,
     `message.new` or other `sync.event`. The service shows one "Daily
     check due" notification on the Daily check channel with the counts
     only ("3 messages and 1 request are waiting"; never names), updated
     in place as `vault.held` arrives (at most every 10 minutes after
     the first change, §3.6.3), and the credential alarm on the Security
     channel. When the counts are unknown (§3.6.5, 0.19.0): "Something
     may be waiting", never "nothing new". On entering the hold it
     cancels the notifications that carry names (Content). The 1-hour
     early warning (§6 Owner check, 5) is a local notification on the
     same channel, scheduled by `AlarmManager` from the known deadline
     (inexact; no exact-alarm permission). After the check the app
     catches up (§6 Owner check, 4) and normal notifications resume;
     nothing missed is replayed as notifications, the bell counts it.
4. **(b) Google push (FCM)** (PUSH-GATEWAY 0.4.2; VAULT-MESSAGING
   0.24.1 §14, 0.1.29, 0.1.30, 0.1.32). Contentless wakes:
   the app's FCM token goes to its vault over the end-to-end session
   (`push.register{platform: "fcm", token, app_id}`, `app_id` the
   application id of the build), the vault registers it with the
   gateway, keeps only the gateway's sealed wake blob (never the
   token), and later triggers `notify` wakes (VAULT-MESSAGING §14.2); the
   gateway sends a high-priority FCM data message with no content; the
   app's `FirebaseMessagingService` then collects from the relay and
   decrypts as in (a), and posts the same notifications, with no
   persistent service. A wake gives up to about 20 s of execution; a longer
   collect runs as expedited `WorkManager` work (0.1.32: the app
   collects for at most 15 s of them, "A wake" below). Token rotation
   (`onNewToken`) and `push.token-needed` (the gateway reported the
   token gone; 0.1.29 spelled it `push.token_needed`) send `push.register` again; switching away from the
   mode sends `push.unregister`. A wipe or erase sends none (0.1.32;
   0.1.29 said it did): the vault has already erased the registration
   when it removed the app (a transfer or a recovery) or was deleted
   with it (VAULT-MESSAGING §14.1, §12.5), and the phone has no session
   left. The app deletes its FCM token, on the phone and at Google, and
   forgets what it remembered of the registration. The status line (1) reads the `push` state
   on the app's `device.list` entry: "Connected" while `active`
   (`last_result` `gateway_error`: "Push service not reachable, retrying"),
   and "Registering again" after `push.token-needed`; `unavailable`
   from `push.register` keeps "Not available yet" (0.1.32: under the
   choice, which stays selected; the vault is asked again when it next
   opens on this phone), `gateway_error`
   retries with backoff (1 minute doubling to 1 hour; 0.1.32: the
   vault's `retry_after` is used when it gives one, and a token the push
   service could not supply, or a request without an answer, is retried
   on the same schedule). `limit`
   (`push_registrations`: 20 answered registrations in 24 hours, refusals
   included) stops the retries for 24 hours; Settings → Notifications
   shows "Push unavailable, using the on-phone service", and the on-phone
   service (a) runs as the fallback meanwhile (owner decision
   2026-10-10, 0.1.30). Correctness
   never depends on a wake: the app collects at every foreground as
   now.
   - **The fallback beyond `limit`** (0.1.32; implemented in
     vettid-android #109; **approved by the owner 2026-10-11** with
     vettid.org #211: "good with your recommendations"). The decision of
     2026-10-10 names the on-phone service as the fallback for `limit`
     only. As implemented, it also runs while the phone has **no
     working registration for any other reason**: `unavailable`, another
     refusal (`bad_request`, `forbidden`, or a `push` state that is not
     `active`), and while `gateway_error` (or a missing token or
     answer) is being retried. Without it the member would get no
     notifications at all in those states, without having chosen Off.
     The status line says so: "Push unavailable, using the on-phone
     service" (`limit`, `unavailable`, a refusal) or "Push service not
     reachable, retrying" (retries). The service stops again as soon as
     the vault holds the registration. **The mode preference is never
     changed automatically**: the choice stays Google push.
     Privacy, plainly: the member chose Google push, and the fallback
     keeps the phone's own connection to the relay instead. That is the
     more private of the two paths (Google is not involved), so it
     reveals nothing new to anyone. Its cost is what the member did not
     choose: a little more battery and the service's "VettID is
     connected" notification, for as long as the fallback lasts.
     **Recommended: approve as implemented.** If refused, the app falls
     back for `limit` only and shows "Not available yet" or "Push
     service not reachable, retrying" with no notifications meanwhile.
   - **Google push chosen, the push service later unavailable on the
     phone** (0.1.32; **approved by the owner, 2026-10-11, and
     implemented**, vettid-android #112, 0.1.34). The choice can only
     be made while Google push is available, but it can stop being so
     afterwards: Google Play services disabled, removed or outdated, an
     update to a build without the Firebase options, or an update to
     the `foss` distribution (below; possible only where both
     distributions carry the same signing certificate, §7). Then the
     on-phone service runs as the fallback, as for `unavailable`, and
     **the mode preference is never changed**: the choice stays Google
     push. A registration the vault may still hold is dropped with
     `push.unregister`, at once if the vault is open, otherwise at its
     next open, so that the vault stops waking a phone that cannot be
     woken (a phone that never registered sends nothing); the local
     token is deleted. Registration resumes by itself when the provider
     is available again. The status line says "Google push is not
     available on this phone, using the on-phone service"; the note
     under the choice gives the reason ("Needs Google Play services…",
     "…need an update", "Not available yet", "Not available in this
     build of VettID…"). The app notices at a cold start and, while
     running, at the next phase change, registration status change or
     return to the foreground: there is no package-change broadcast to
     hear of it sooner.
   - **A wake** (0.1.32, as implemented). The push message's content is
     never read. The process's one mailbox collector does the work, as
     when the app is open (decrypt, persist, ack). The collect runs for
     at most **15 s** (0.1.29: "about 20 s", which is all Android
     gives); if it has not finished, it continues as expedited
     `WorkManager` work (needs a network, at most 3 minutes, one at a
     time, never retried, since the app collects at every start and
     foreground anyway). **"Finished" is a heuristic**: the relay
     answers a collect at once when messages wait, so the collect is
     taken as done when its long poll has been outstanding for 2.5 s
     and no read that the collected events started is still in flight
     (the feed's read, the held events below); checked every 250 ms. A
     process that cannot learn whether its vault is open (no network)
     hands over to the work at once.
   - **A lock met during a wake** (0.1.32). The vault wakes the phone
     for `vault.locking` (VAULT-MESSAGING §14.2). A process started by
     that wake never saw the vault open, so it has no open-to-locked
     change to react to: when `vault.locking` arrives during a wake, and
     the lock was not made on this phone, the app posts "Your vault is
     locked. You won't be notified until you unlock it" (Security
     channel), as the on-phone service does (3).
   - **Events collected before the vault is known to be open**
     (0.1.32). A process started by a wake collects its mailbox while it
     is still reading the vault's status. `feed.event`s that arrive
     meanwhile cannot notify yet (nothing is shown of a vault not known
     to be open), so they are **held in memory, at most 64** (the oldest
     dropped first) and notified once the vault is known to be open; if
     it turns out locked, or there is no vault any more, they are
     dropped. Nothing is written to disk.
   - **Plumbing now**: the setting, a `PushProvider` interface
     (`available()`, `token()`, `onWake`), the FCM provider behind it,
     and the registration path through the vault, written against
     VAULT-MESSAGING's `push.register` once it is specified (Protocol
     gaps, below); until then the provider reports "not available yet".
   - **FCM optional at build time** (recommended): no
     `google-services.json` and no Google Services Gradle plugin. The
     `firebase-messaging` library is a dependency of `:core:push-fcm`
     only; `FirebaseInitProvider` is removed from the merged manifest
     and auto-init is off; the provider initialises `FirebaseApp` at
     runtime from `FirebaseOptions` (application id, project id, API key,
     sender id) read from Gradle properties into `BuildConfig`, absent
     by default. No properties: the provider is "not available yet" and
     the app builds and runs as today (CI included). (0.1.32) The
     properties are **four per build type**:
     `vettidFcm<Type>ApplicationId`, `vettidFcm<Type>ProjectId`,
     `vettidFcm<Type>ApiKey` and `vettidFcm<Type>SenderId`, `<Type>`
     being `Debug`, `DevStack`, `Staging` or `Release`. **All four or
     none**: a partial set fails the build. In CI they are secrets
     exported as `ORG_GRADLE_PROJECT_<property>`. `checkReleaseApk` and
     `checkStagingApk` also fail if an APK carries the other
     environment's Firebase application id. Google Play
     services presence: `GoogleApiAvailability`. (0.1.34; §9 question 12;
     vettid-android #111) The app has **two distributions**, a
     `distribution` flavour dimension: `full` (Google Play and VettID's
     own releases) and `foss` (F-Droid), with the same application id,
     version and source. Of `foss` only `fossRelease` exists; debug,
     devStack and staging are `full` only, so nothing is built or
     tested twice. `:core:push-fcm` and WorkManager are `full` only
     (an F-Droid build deletes the module's directory before building);
     `foss` binds a provider that reports "not in this build" (1). The
     FOSS release build **must be reproducible**: the unsigned
     `fossRelease` APK is byte-identical across clean builds of the
     same commit with the same JDK (21), because F-Droid publishes the
     VettID-signed APK only if its own build is the same apart from the
     signature (§7). For that the release APK carries no VCS info, and
     no build carries the dependency metadata block. Checked by hand
     with two clean builds, not by CI.
   - **The build guard** (0.1.32). `check<Variant>PushManifest`, run by
     `checkReleaseApk` and `checkStagingApk`, reads the merged manifest
     and fails on anything of Firebase or Google beyond Messaging's: a
     Google component or Firebase registrar Messaging does not need
     (Analytics, Crashlytics, `FirebaseInitProvider`, …), a
     `com.google.*` permission other than
     `com.google.android.c2dm.permission.RECEIVE`, an advertising-id
     permission, or WorkManager's start-up initialiser. Google push adds
     two permissions to the app, `WAKE_LOCK` and that
     `c2dm.permission.RECEIVE`, and no other. `FirebaseInitProvider` and
     the WorkManager initializer are removed from the manifest
     (WorkManager starts on first use, which a build without the options
     never reaches). Automatic token creation
     (`firebase_messaging_auto_init_enabled`), Analytics collection
     (`firebase_analytics_collection_enabled`) and BigQuery export of
     delivery metrics (`delivery_metrics_exported_to_big_query_enabled`)
     must be `false`, so Google is first contacted when the member
     chooses Google push. The messaging service and Firebase's receiver
     are in every `full` build's manifest but **enabled only in a build
     that carries the options**; the guard fails on a mismatch either
     way. (0.1.34) **`checkFossReleaseApk`** fails if the `foss` release
     carries anything of Google. Four checks: the variant's resolved
     dependency graph, the APK's dex, the APK's file list and the
     merged manifest. None may show Firebase, Google Play services,
     datatransport, Play, ML Kit, install referrer, billing or
     `androidx.work`, and the manifest no `com.google.*` permission or
     component (nor a registrar, package query or intent action of
     Google's). One Google name is allowed in the dex: the string
     `com.google.android.gms.org.conscrypt`, which OkHttp carries to
     look for a TLS provider by reflection; it is no Google code.
   - Unavailable when Google Play services are missing (said in the UI,
     1), and until the gateway is deployed with FCM credentials (the
     owner has no FCM service account yet, §7).
5. **(c) Off.** No service, no registration. The app collects while
   open, as today. The Notifications screen and the bell work as
   always; the release notification (0.1.19) is still posted when the
   app learns of a release, since it is local. Settings shows the
   warning of 1 under the choice.
6. **Channels** (created at first start; ids are stable, names
   translated; the member can change each in Android settings):

   | Channel (id) | Importance | Carries |
   |---|---|---|
   | Messages (`messages`) | High | New messages |
   | Requests (`requests`) | High | Asks waiting for a decision (Approvals) |
   | Calls (`calls`) | High | Missed calls now; ringing later (full-screen intent with the calls phase) |
   | Security alarms (`security`) | High, alarms marked urgent | The clone alarm, the ten-failure lock, failed checks, the vault locked, the vault moved |
   | Daily check (`owner_check`) | High | The early warning and "check due" with the held counts |
   | Vault activity (`activity`) | Low (silent, in the shade) | Other feed items |
   | Vault updates (`vault_updates`, 0.1.19) | Default | One per release; its text is the release's log summary when the log has it (0.1.31) |
   | Connection (`connection`) | Min | The service's own notification |

7. **Mapping** (feed kinds of VAULT-MESSAGING §10.9 and events; this
   replaces the earlier answer to question 3). Feed items are the one
   source of notifications, so read state stays shared: the
   notification's id is the item's `item_id`, a later `seq` updates it
   in place without sound (`setOnlyAlertOnce`), and `feed.updated` to
   `read` or `archived`, or `feed.deleted`, cancels it. Opening a
   conversation marks its `message.received` items read; deciding an
   ask marks its item read (question 2). Items of priority `low` and
   `guide` items never notify.

   | Notifies on | Feed kinds (and events) |
   |---|---|
   | Messages | `message.received` (text from `message.new` only with previews on) |
   | Requests | `connection.request`, `connection.authenticate.requested`, `grant.request` (a batch: one, "Sam asks for 3 things", updated), `share.pending`, `critical-secret.use.request`, `device.pair.pending`, `device.session.pending`, `approval.pending`; `action.request`, `intro.request`, `location.request` with "Open VettID on a newer version" until their phases |
   | Calls | `call.missed` |
   | Security alarms | `credential.alarm` (urgent; also while held), `owner_check.locked`, `owner_check.failed`, `owner_check.hold_changed`, `credential.password_failed`, `credential.reset`, `device.replaced`, `device.transferred`; (0.1.52, approved by the owner 2026-10-19) a failed `recovery.attempt` (`urgent`, `not_success` or a `ref` that does not read), `recovery.counter_unavailable`, `recovery.change_required`; (owner decision of 2026-10-20) a `rollback` closure's `urgent` item; the event `vault.locking` (Vault locked, 3) |
   | Daily check | the events `vault.held` and the early warning (3) |
   | Vault activity | `connection.added`, `connection.request.peer_declined`, `connection.asks_paused`, `connection.stale`, `connection.removed`, `grant.shared`, `grant.revoked`, `share.rate_limited`, `item.revealed`, `device.paired`, `device.unlinked`, `credential.rotated`, `leash.*`, `location.shared`, `wallet.signed`; (0.1.52) `device.secret_renewed`, `recovery.completed`, any other `recovery.attempt`, `identity.rotation_failed`, `identity.rotate_conflict`; unknown kinds of priority `normal` or above |
   | none | priority `low`, `guide`; anything while the app is in the foreground on the Notifications screen or the item's own target (the bell and the screen show it) |

   A muted connection's asks create no item (§10.4.1), so they never
   notify.
8. **Content** (privacy). Every notification is
   `VISIBILITY_PRIVATE`, with a public version "New activity in VettID"
   (the Security and Daily check channels: "VettID needs your
   attention"), so nothing of it shows on the lock screen until the
   phone is unlocked. **Show in notifications**:
   - **Names** (default): the connection's "First Last" or the device's
     name and the kind ("Message from Sam Lee", "Sam Lee asks for
     3 things"); never message text, item names or values, tags or
     amounts.
   - **Names and message text**: adds the message text (from
     `message.new`, decrypted on the phone) and item names; never
     item values or secrets, which the vault never sends a device
     unasked.
   - **Nothing**: "New activity in VettID" for everything; the channel
     still says what kind it is.

   The member's email never appears (VAULT-MESSAGING §11.13). Nothing
   from a notification is stored by the app: the text is built in
   memory from the event and the in-memory caches (the service reads
   `connection.list` once per vault open when the process starts in
   the background), and is not written to disk by the app. Android's
   notification shade and history keep what was posted; therefore
   notifications that carry names are cancelled when the vault locks
   or is held, at a wipe and at an unlink, and posted notifications
   never outlive the vault being open (the rule "nothing kept outside
   an open vault"). Android's "Notification history" setting, when the
   member turns it on, keeps them outside the app's control; the
   Notifications setting says so.
9. **Protocol gaps for (b)**: **answered by VAULT-MESSAGING 0.24.0 §14**
   (0.1.29, a draft for the owner's review): 1 by §14.1 (the holder
   only; `{push}` or `unavailable`; `fcm` and `apns`; sizes); 2 by a new
   `push.register` replacing the old registration; 3 by
   `push.token-needed` and `push` in `device.list`; 4 by §14.2 (feed
   items of priority `normal` and above except guides, `vault.held`,
   `vault.locking`, the alarm; FCM's constant `collapse_key` is set by the
   gateway); 5 yes, for those only; 6 by §11.10.8 and §12.2; 7 a fresh
   wake key at each registration and the audit kinds of §10.9. As
   first written (VAULT-MESSAGING 0.23.1; this PR does not
   change it). §10's registry lists `push.register` and
   `push.unregister` as **reserved**, and §14 is a sketch
   (`push.register{platform, push_token, environment}`, the wake_ref in
   the device record, `device.unlink` deletes it, a wake after "a
   user-visible message", none while locked). Missing before the app
   can register:
   1. The bodies, responses and errors of `push.register` and
      `push.unregister` (the holder only, or desktops too; the answer,
      e.g. `{registered: true}` or `unavailable` when the vault has no
      gateway configured); `platform` value `fcm` (PUSH-GATEWAY 0.3.0;
      no `unifiedpush`, 0.1.24) and the size limits.
   2. Token rotation: whether a second `push.register` replaces the
      first (the vault then `PUT`s or re-registers, PUSH-GATEWAY §4.2).
   3. A dead token (PUSH-GATEWAY §5: "the owner requests a fresh push
      token from the device"): a V→D message for it (e.g.
      `push.token-needed`) and how the app learns its registration's
      state (e.g. `push` in `device.list` or `vault.status`).
   4. Which events trigger a wake and of which class: §14 says a
      user-visible message; the app needs a wake for every item the
      Mapping notifies (feed items of priority `normal` and above,
      batches once), `vault.held`, `vault.locking` and the
      credential alarm, with the constant `collapse_key`.
   5. Wakes while held: §3.6.3 stops owner fan-out; whether the vault
      wakes the app for the messages it still sends (`vault.held`, the
      alarm). Recommended: yes, for those only.
   6. Enclave egress to the gateway: §12.2 allows only the relay and
      AWS KMS through the parent; the gateway's host needs adding (and
      VAULT-PLAN's allowlist), with the gateway URL in the release
      constants.
   7. When the wake key is created (at the first `push.register`) and
      the audit kinds (`push.registered`, `push.unregistered`).
10. **Implementation order** (§6, N1–N4; each its own PR, the owner
    approves this plan first):
    - **N1 app, now:** the Notifications setting (three modes, status
      line, previews, categories), the channels, the Mapping and
      Content rules, the on-phone service fully working (start on
      boot and after updates, backoff, Doze advice, locked and held
      behaviour), Off; the Notifications screen (above); the
      `PushProvider` interface with the FCM provider stubbed ("not
      available yet"), FCM optional at build time.
    - **N2 spec:** VAULT-MESSAGING `push.register` / `push.unregister`
      (the gaps in 9), PUSH-GATEWAY's default order updated by D7.
    - **N3 vault:** the push ops, the wake key, wakes after deposits,
      the egress allowlist (vettid-vault), against a gateway stand-in in
      the dev stack.
    - **N4 gateway, later:** deployment with an FCM service account
      (and APNs for iOS), then the app's FCM provider enabled with the
      Firebase configuration; end-to-end tests on the Pixel 7 (Play
      services) and "not available" on the Pixel 10 Pro (GrapheneOS).
11. **Tests** (in addition to the Notifications screen's).
    - Unit: the mode state machine (switching stops the old path
      first, except to Google push, where the service runs until the
      registration is active, 0.1.32; Off stops everything); the Mapping table for every §10.9
      kind and unknown kinds; batch updates in place and cancel on
      read, archive, delete and from other devices; Content per
      preview choice (no text with Names, nothing with Nothing; never
      an email or value); cancel on lock, hold, wipe and unlink; the
      backoff schedule with a fake clock and network; the FCM provider
      "not available yet" without configuration and without Play
      services.
    - Instrumented (dev stack): with the app in the background and the
      screen off, a `vaultctl` peer's message and grant request post
      notifications on their channels; reading on a `vaultctl` desktop
      cancels them; the vault locked (`vault.locking`) and an
      unsignalled lock (the dev enclave restarted) show "Vault locked";
      the vault past its deadline shows "Daily check due" with counts
      and no names; reboot and `adb install -r` restart the service;
      Doze forced (`adb shell dumpsys deviceidle force-idle`) with and
      without the battery exemption; POST_NOTIFICATIONS refused.
    - Build: CI builds and tests without any Firebase configuration,
      and (0.1.34) builds the FOSS release and runs
      `checkFossReleaseApk` on it.
    - Manual on the test phones: a day of normal use for battery
      (Settings → Battery usage), the service notification, lock-screen
      privacy.

Every list has an empty state; every destructive action has a confirmation;
every critical action asks for the credential password.

There is no backup or export of vault data out of the service (owner
decision, 2026-10-03); no screen offers one. The one exception is
History's export of activity metadata (0.1.17, owner decisions of
2026-10-08, above): it never holds item values, secrets, message text,
credential material or the email, and is no backup (nothing imports
it).

### Locking the vault (0.1.38)

*Two parts. Part 1 describes vettid-android #127 ("The member's lock
fails secure"), read from its description at 78f741a0. It is open, not
merged at the time of writing: part 1 is a draft until it merges, and
follows whatever its review changes. Part 2 is the app's side of
VAULT-MESSAGING 0.29.0 (approved by the owner 2026-10-12), for the
vault's release L, which is not built. The texts of both parts are
approved as drafts (VAULT-LOCK L16) and become final when #127 and the
release L work merge.*

**1. As built by #127 (pending its merge).**

- **The phone locks at once, in every outcome.** Lock vault (avatar
  sheet, Settings, the held screen, the release update's lock step,
  the background lock) sets the app to locked first, and makes the
  lock **pending**, durably, before anything is sent. A new process
  that finds a pending lock starts locked and tries again.
- **Pending until confirmed.** What confirms: the vault's own answer
  to `vault.lock` over the relay; a `vault.locking` from after this
  phone's last unlock; `GET /api/vault/status` not saying `unlocked`.
  **The member API's answer to the lock request never confirms**:
  before release L it is `done` whether or not the vault locked
  (VAULT-LOCK F8).
- **While pending:** locked on this phone whatever the status says;
  nothing is sent to the vault but the lock and a pending `call.end`;
  nothing the vault sends is taken into the app. An unlock is allowed
  and, when it succeeds, ends the pending lock.
- **Retries:** after 1, 2, 5, 10 s, four times 30 s, then every 60 s,
  through the member API, within the route's limit, while the app's
  process lives (a job that survives the process is the follow-up PR).
- **No late lock, as far as the app can see to it:** `vault.lock` goes
  over the relay once, with `exp` 30 s, never through the outbox; and
  every unlock first waits out an unanswered relay lock (up to 40 s).
  A phone clock ahead of the vault's by more than 10 s, and a lock
  still in the member API's queue, leave a window the app cannot close
  (VAULT-LOCK F6, F7).

**Texts (drafts; catalog ids as in #127).**

| Where | Id | Text |
|---|---|---|
| Unlock screen, the first try running | `unlock.lock_locking` | "Locking your vault…" |
| Unlock screen, from the first failed try | `unlock.lock_unconfirmed` | "Your vault may still be open" / "Your vault could not be reached, so it may still be open. This phone is locked, and VettID keeps trying to lock the vault." Action: **Try again** |
| Unlock screen, confirmed after having been in doubt | `unlock.lock_confirmed` | "Your vault is locked." |
| Release update, "The update did not go through", the lock unconfirmed | `release_update_failed_body_lock_pending` | "Nothing changed: your vault stays on release N. It could not be reached to lock it, so it may still be open. This phone is locked, and VettID keeps trying to lock the vault." |

A lock the first try confirms shows no warning and no "confirmed".
All three unlock-screen texts are live regions for screen readers (the
warning assertive, the others polite).

**2. With a vault that supports bound locks (release L; decided, not
built).** The app knows from `unlock_id` in the unlock result; for a
vault without it, part 1 applies unchanged.

- The app keeps `unlock_id` with the pending-lock record and sends
  `vault.lock {unlock_id}` and `POST /api/vault/lock {…, unlock_id}`.
  If it does not hold the value (an install from before this version,
  a lost record) it sends the member API lock without it.
- **Dropped:** the wait before an unlock; "send the relay lock once"
  (it may be retried, never through the outbox, `exp` at most 60 s).
- **Confirms as well:** the slot's `locked` and `not_running`; the
  vault's `stale_lock` and the slot's `stale` end the pending lock
  too: this phone's unlock is over, and the app reads the status to
  show what is true now.
- A `vault.locking` is taken only if its `unlock_id` is the current
  one (VAULT-MESSAGING §10.2 "Locks").
- **The idle lock** (VAULT-MESSAGING §3.6.8). Settings → Security,
  beside the check's interval: "Lock my vault by itself after" with
  1 hour, 1 day, 7 days (default), 14 days, 30 days; a longer choice
  says "This takes effect after your next check." The held screen says
  when (from `idle_lock_at`). Texts, drafts:

  | Where | Text |
  |---|---|
  | Held screen | "Your vault locks itself on <date> if you don't check in." |
  | Notification (Security channel) and the unlock screen, after `vault.locking{reason: "idle"}` | "Your vault locked itself" / "You hadn't checked in for <N> days, so your vault locked. Unlock it with your PIN to carry on. New messages wait for up to 14 days." |
  | History | "Vault locked itself (not checked in)" for `vault.locked` with `ref` `idle` |
  | Settings, under the choice | "If you don't pass the daily check for this long, your vault locks itself and stops receiving until you unlock it." |

### Staging time scale (0.1.44)

*For the owner's approval (STAGING-TIME-SCALE §5.2; VAULT-MESSAGING
0.43.0 §11.10.8, §11.10.9). Not built.*

- **Learning it.** The app reads `time_scale` from the descriptor of its
  vault's routed instance, with the capabilities, and from a transfer
  bundle; absent means 1. It stores it per vault in `account.bin`.
  **A production build refuses any value other than 1**: it sends
  nothing to that instance and shows "This vault's software is not for
  this app. Contact VettID." A staging build accepts 1 and 24.
- **The app's own waits** are divided by it when each starts, and the
  absolute time is kept: the owner check's early warning (1 h before
  the deadline), replaced records' deletion (7 days), the old phone's
  keys after a transfer (7 days after the approval), the recovery
  counter's "unavailable for a day" urgency (24 h, S8), the screen for a
  vault unreachable for 7 days (vettid-android #142), and the update
  banner's dismissal (24 h). A timer started before the app knew the
  scale keeps its time. Rate limits and retries (the push registration
  stop of 24 h) are not scaled.
- **Texts** compute every such duration from seconds ("in 3 hours",
  "for at most 7 hours", "You hadn't checked in for 7 hours"); none
  hard-codes "24 hours" or "7 days" for a scaled wait. Settings keep
  their real units and show both ("24 hours (staging: 1 hour)").
  Staging builds add a small "Staging: 1 day = 1 hour" where a scaled
  wait is shown: the owner check, the idle lock, recovery, the old
  phone's screen and Settings → Security.

### Photo attachments (0.1.39)

*Approved by the owner 2026-10-15 (vettid.org #288); the app's side
of VAULT-MESSAGING 0.32.0 §10.5.1, which needs the vault's "release
A". Not built. The texts are drafts, open to the owner's rewording.*

**Availability.** After each unlock the app sends
`message.attachment.get{}` once: `unsupported_type` means the vault has
no attachments, and the conversation shows no attach button;
`bad_request` means it has. The relay must advertise `max_blob_bytes`
and `blob_ttl_seconds` (VAULT-MESSAGING §1.2). The app never sends
`message.send` with an attachment to a vault without release A.

**Choosing a photo.** The conversation's composer gets a photo button
with two choices:

- **Take a photo**: the app's own camera screen (CameraX, as for the
  profile photo, but the rear camera first, with a switch), "Retake"
  and "Use photo". No system camera intent. The shot is taken into
  memory (`ImageCapture.takePicture` with an `OnImageCapturedCallback`),
  never with `OutputFileOptions`: no file is written, not even
  briefly.
- **Choose photos**: the Android **Photo Picker**
  (`ActivityResultContracts.PickMultipleVisualMedia`, images only, at
  most 10), which hands the app only the photos the member picks. The
  app asks for **no** media or storage permission
  (`READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED`,
  `READ_EXTERNAL_STORAGE` stay out of the manifest; a build check
  fails if one appears). Where the system has no Photo Picker (Android
  12 without the Google Play system update), the contract falls back
  to the system document picker, which needs no permission either.
- **The profile photo stays camera-only** (0.1.12, 0.1.14): this
  extends the rule for message photos only. The profile photo is the
  member's face shown to every connection, taken fresh; a message photo
  is a chosen picture, and the Photo Picker shares only what is
  chosen.

**Preparing it, in memory.** For each photo, before anything is sent:

1. Read it from the picker's URI or the camera into memory; no copy in
   the cache directory or anywhere else on disk.
2. Read its bounds first (`ImageDecoder` header or
   `inJustDecodeBounds`) and refuse a picture larger than 16,384 pixels
   on a side or 100 megapixels ("This photo is too large to send").
3. Decode with a sample size, apply the EXIF orientation to the pixels,
   downscale so the long edge is at most **2,560 pixels**, and
   re-encode as **JPEG** (quality 85, lowered in steps until the result
   is at most 8,257,532 bytes, VAULT-MESSAGING's `attachment_max_bytes`).
   The encoder writes pixels only: **no EXIF, XMP, ICC profile beyond
   sRGB, GPS or camera data** survives (owner decision 4). Nothing of
   the original file is sent.
4. Make the thumbnail from the same pixels: long edge 320 pixels,
   JPEG, quality lowered until it is at most 32,768 bytes.
5. The preview shows the prepared photo (not the original) with
   "Location and camera details are removed before sending", the
   caption field, **Send** and **Cancel**.

**Sending.** Seal the photo as a VAULT-MESSAGING §5.5 blob under a
fresh key (`:core:crypto`: the versioned, padded layout, with the §16
vector), upload it to the vault's mailbox with `PUT /v1/blob`, then
send `message.send` with the attachment (`name` absent). The vault
answers once its checks pass (`{message_id, sent_at, att_id}`); the
bubble then follows the attachment's state from
`sync.event{message.attachment}`: "Preparing", "Sending", "Delivered".

- **Cancel** before `message.send` sends
  `message.attachment.discard{blob_id}`, so that the vault deletes the
  upload at once instead of leaving 8 MiB in its mailbox's shared blob
  storage for 7 days.
- **Retry** after a lost or late answer (a timeout, `busy`, a relay
  error) re-sends **the same request, with the same inner id**: the
  vault answers it from its cache or handles it once. It **never
  uploads again**: every abandoned upload fills the mailbox's shared
  storage, and a few would lock the member out of sending for a week.
  The prepared bytes stay in memory until the answer arrives or the
  member cancels, and are dropped at a lock.
- The upload itself refused with `quota_exceeded` (the vault's mailbox
  is full) is not retried by the app: "Your vault can't take more
  photos right now. Try again later." The app tries the upload again
  only when the member taps Send again.
- A photo whose upload the vault rejected (`failed`, `bad` or `type`)
  shows the whole message as not sent, "This photo couldn't be sent";
  its caption was not delivered either (VAULT-MESSAGING §10.5.1). The
  member sends it again as a new message from the picker.

Several photos are sent one after another, each as its own message,
the caption with the first, the next upload starting after the
previous message's answer. A `limit` `attachment_storage` or
`attachments` answer says "Your vault is full. Delete messages with
photos to make room." with the store's use from `vault.status`.

**The bubble.** A photo shows its thumbnail (from `message.new`, or
fetched with `message.attachment.get{part: "thumb"}` as it scrolls into
view), with the caption under it. Outgoing: "Sending", "Delivered",
"Not delivered" with the reason ("Sam's VettID can't receive photos
yet", "Couldn't be delivered" for any refusal by Sam's vault (it does not say
why when Sam's vault is full, VAULT-MESSAGING §10.5.1), "Not confirmed
after 7 days"). Incoming: "Receiving…", the photo, or "Not received"
with the reason ("Your vault is full", "Too many photos from Sam
today", "This file type isn't supported", "It never arrived", "Sam's vault can no longer send it" for `withdrawn`). A
missing thumbnail shows a neutral placeholder sized from `width` and
`height`, clamped. A thumbnail is decoded only after the same checks as
a photo (below), with tighter bounds: its type sniffed, its header read
first, and anything over **1,024 pixels on a side** refused (the
sender makes 320). TalkBack reads "Photo from Sam", the caption and the
state.

**Viewing.** Tapping a photo sends `message.attachment.get{part:
"content"}`, fetches the blob from the app's own mailbox, checks
`sha256` (constant time) and the length, decrypts, deletes the blob at
the relay, and then, before decoding:

- **sniffs the type** from the first bytes against JPEG, PNG and WebP
  and ignores the `mime` the peer sent; anything else shows "This file
  type isn't supported" and is not decoded;
- **bounds the decode**: reads the header first and refuses more than
  8,192 pixels on a side or 40 megapixels (VAULT-MESSAGING
  `photo_max_side`), then decodes with a target size no larger than the
  screen; of an animated WebP or PNG (APNG) only the **first frame** is
  decoded, for photos and thumbnails alike;
- **sanitizes the name** when one was sent: control and bidirectional
  formatting characters, path separators and leading dots removed, at
  most 64 characters shown, and never used as a file name.

The viewer offers zoom, **Save to phone** and **Share**. It sets
`FLAG_SECURE`: Android writes the recent-apps snapshot of a screen to
disk, and a photo must not end up there; screenshots of the viewer are
blocked with it.

**Memory only, wiped at lock.** Attachments follow the rule "nothing
kept outside an open vault" (§4 Notifications, 10): thumbnails, photos (encoded
and decoded) and prepared uploads live in an in-memory cache only (at
most 64 MiB of photos and 8 MiB of thumbnails, least recently used out
first), never in Room, a file, DataStore or `SavedStateHandle` (beyond
`message_id`), and never in an image library's disk cache (if one is
used, its disk cache is off). The cache is cleared at lock, on entering
the hold or the due state, at a wipe, at an unlink and when the process
ends. Nothing from a photo goes to logs or crash reports (ids at debug
level only). Notifications say "Photo from Sam Lee" (with previews on,
also the caption) and never carry the image or the thumbnail.

**Saving and sharing leave VettID.** **Save to phone** and **Share**
each first show: "This puts the photo outside VettID. Other apps on
this phone, and anyone you share it with, can keep it." with
**Continue** and **Cancel**. Save writes through
`MediaStore` to Pictures/VettID, named `VettID_<yyyyMMdd_HHmmss>` with
the extension of the sniffed type, without asking for a permission.
Share hands the bytes to the chosen app through the app's own content
provider, streamed from memory through a pipe (no file is written);
the provider refuses every read once the vault is locked. What another
app does with it is outside VettID; History does not record a save or a
share (they are phone-side).

**History and the feed.** New labels for the audit kinds of
VAULT-MESSAGING §10.9: "Photo sent to <First Last>", "Photo received
from <First Last>", "Photo not delivered" or "Photo not received"
(with the reason), "Photo refused (vault full)" and, for the drops,
"Photos from <First Last> refused (too many today)". The feed items
`message.attachment_failed` and `message.attachment_refused` open the
conversation at the message. While held or due, nothing of the above
is shown (§6 Owner check, 4).

**Module.** `:core:media` (new): reading picker and camera input into
memory, bounds, orientation, downscale, JPEG encoding without metadata,
thumbnails, sniffing and bounded decoding; no Android permission, no
disk. `:core:crypto` gains the §5.5 blob seal and open, `:core:relay`
already has the blob calls.

**Tests.**

- Unit: the §16 blob vector both ways, and a flipped byte refused
  before decryption; a JPEG with GPS, camera EXIF and an orientation
  tag comes out with **no APP1 or APP13 segment, no XMP and no GPS**,
  correctly rotated, long edge 2,560 at most, under the size bound;
  the thumbnail under 32 KiB; sniffing (JPEG, PNG, WebP accepted; GIF,
  HEIC, SVG, text and a JPEG named `.png` with `mime` `image/png`
  treated by its bytes); a decompression bomb (a small PNG declaring
  60,000 × 60,000 pixels) refused from its header before any
  allocation; names with `../`, right-to-left overrides and control
  characters sanitized; the cache's bound and its clearing at lock,
  hold, wipe and unlink; a thumbnail declaring 4,000 pixels refused
  from its header; an animated WebP and an APNG decoded to their first
  frame only; Retry re-sends the same inner id and makes no upload;
  Cancel sends `message.attachment.discard`; the camera path writes no
  file (a test that watches the app's directories during a capture);
  the viewer's window has `FLAG_SECURE`.
- Manifest check: no media or storage permission in any build type or
  distribution.
- **Privacy, data directory scan:** after sending, receiving, viewing,
  saving (cancelled) and sharing (cancelled) photos, lock the vault
  and scan the app's files, cache, databases, `no_backup`, code cache
  and its external app directories: no JPEG, PNG or WebP signature,
  no byte run of the test photo or its thumbnail, no blob id, `att_id`
  or blob key is found (as for item metadata and the feed).
- Instrumented, dev stack: a photo both ways with a `vaultctl` peer;
  the recipient's vault locked past the blob's 7 days (the injectable
  clock) and the photo still arriving after its unlock; a full store;
  a peer without release A (`unsupported_type`); held: the photo
  arrives and shows only after the check.
- Manual: both test phones against staging; the Photo Picker on
  GrapheneOS and on stock Android.

### Recovery and unlock from release R (0.1.40)

*Wording for the owner's approval, with VAULT-MESSAGING 0.33.0 §11.14.
For vaults of release R, which is not built; nothing changes for a vault
of an earlier release. The texts are drafts for the owner's wording.
The old phone's keys after a transfer were decided by the owner on
2026-10-15.*

**Which path, and recovery on by default** (0.1.41; owner decision of
2026-10-16; VAULT-MESSAGING 0.34.0 §11.10.9).

- Recovery is **on by default** in every build; there is no switch that
  turns release R's paths off.
- Before every enrollment, unlock, recovery register and recovery open,
  the app reads `capabilities` from the descriptor it has just verified
  (`:core:altchan`, `EnclaveVerifier`); before a transfer's `hs.init`
  the new phone reads it from the bundle. With `recovery_r`: release R's
  requests (the phone key and `unlock_secret`, `vault.recovery.open`).
  Without it: the requests of the earlier release, unchanged, **with that
  release's earlier recovery** (owner decision of 2026-10-16). With
  `recovery_r` but without `recovery_offered`: recovery is hidden for
  that vault (no recovery entry point, Settings → Vault status shows
  "This vault's release does not offer recovery."). Never one path and
  then the other after a refusal.
- **Remembered per vault**: once a verified descriptor of the vault's
  instance or a transfer bundle listed `recovery_r`, or a request of
  release R's shape succeeded, the app stores the mark with `vault_id`
  (erased only with the vault's local state). From then on, an instance
  without `recovery_r` is refused before anything is sent: "This
  vault's software is older than the software this phone last used with
  it. Contact VettID."
- A descriptor whose `capabilities` member is malformed is refused like
  any malformed descriptor; unknown names are ignored; a missing member
  is an empty list.
- Tests: a descriptor without the member, with `recovery_r`, malformed,
  and with an unknown name; the mark set by each of its three sources
  and kept across restarts; a marked vault offered an instance without
  `recovery_r` sends nothing; a transfer bundle with and without it.

**The phone key** (`:core:keystore`; VAULT-MESSAGING §11.14.1).

- At enrollment, at a transfer (the new phone) and at a recovery the app
  creates a new HMAC-SHA-256 key in the Android Keystore, alias
  `vault-unlock-<vault_id>`: non-exportable, StrongBox first and the
  trusted execution environment otherwise (`generateStrongBoxFirst`, as
  for the device attestation key and the app key), **not bound to user
  authentication or to an unlocked screen**, so that it is lost
  together with the other two keys or not at all.
- It reads the key's security level back. `Software`: the app refuses to
  enroll, to receive a transfer or to recover, with "This phone cannot
  keep your vault's keys in its secure hardware."
- (0.1.43; VAULT-MESSAGING 0.36.0) `unlock_secret = HMAC-SHA-256(phone
  key, "vettid/vms/2/unlock-secret-2" || 0x00 || key_vault || 0x00 ||
  epoch (8 bytes, big-endian) || r (32))`, computed by the hardware each
  time it is needed, held in memory only while a request is built and
  zeroized after. `key_vault` is the vault id the key was made for, `""`
  for a transfer's new phone. `r` is 32 fresh bytes from `SecureRandom`
  for each epoch, so that code that once ran as the app cannot have
  computed a later epoch's secret. `epoch` is 1 after enrollment, a
  transfer or a recovery, one higher at each `pin.change` and
  `vault.secret.renew`.
- **The records** (`LocalAccount` in `account.bin`, the Keystore-encrypted
  file store in `noBackupFilesDir`): the current record
  `(key_vault, epoch, r)`, up to four candidates, and the replaced records
  with the time they were replaced. A candidate is written in the same
  atomic write as its epoch, and the request that carries its secret is
  built only after that write is known to be durable: `RecordStore.update`
  returns `false` and writes nothing for a stale, closed or unreadable
  record, and the phone-secret callers of `updateLocal` must check it
  (today they ignore it). A failed or dropped write stops the operation:
  nothing is sent, and the member sees "This phone could not save what it
  needs for this change. Nothing was sent. Try again." A retry of the
  same request reuses the candidate; a new change the member starts
  makes a new one. `pin.change` and `vault.secret.renew` use a new
  candidate instead of the next counter value under the old rule.
- **Epoch 1** (enrollment, a transfer to this phone, a recovery's
  register): create the Keystore key, then write the record
  (`key_vault`, epoch 1, `r`), then send. A phone key that no record
  names, found at start-up or at the next attempt, was never sent: the
  app deletes it and makes a new key and a new record.
- **Unlock order.** The current record; after `device_secret`, the
  candidates newest first, each once, `UnlockEpoch.confirmsNext`
  deciding (`ok`, `bad_pin`, `transfer_incomplete` make that candidate
  current; an answer decided before the secret check stops the tries
  with nothing changed). An `ok` with the current record makes the
  candidates replaced records. When the current record and every
  candidate are answered `device_secret`, the app shows "no longer holds
  the keys" (below).
- **Never dropped.** No answer but a confirmation moves the current
  record; `retry`, `busy`, `bad_pin`, `bad_password`, `backoff`,
  `counter_unavailable`, a refusal or no answer leave it in place.
- **Deletion.** Replaced records are deleted 7 days after the
  confirmation that replaced them (the clock rule of the old phone's keep
  period: a clock set back never extends it), or at a wipe. The wipe
  removes the phone key and every record.
- **Keystore errors.** Only a definite loss leads to "no longer holds
  the keys": the phone key missing, or `KeyPermanentlyInvalidatedException`;
  for `account.bin`, the file missing, or a decryption that fails while
  its Keystore AES key works. Any other Keystore or StrongBox refusal,
  the record's AES key included, is shown as "Your phone's secure
  hardware did not answer. Nothing was sent. Try again." and changes no
  record. (Today every Keystore error of the phone key is treated as a
  lost key; this changes with the formula.)
- **An older build.** The account record gains a format number; a build
  that meets a format it does not know refuses to start ("This version
  of VettID is older than the one that set up this phone. Install the
  current version.") rather than compute a secret by an older rule. The
  refusal writes nothing, wipes nothing and makes no key. Builds before
  this change ignore unknown fields: they cannot apply the rule, and
  their next write of the record would drop `r`. Android refuses to
  install a release build over a newer `versionCode`, so this concerns
  debug and test builds only. A test installs an older debug build over
  a form 2 record and checks that nothing is wiped and no new key is
  made.
- **Staging phones** hold form 1 records (no `r`, the label
  `vettid/vms/2/unlock-secret`). They keep them, with no prompt, and the
  app computes each record with its own rule; the next renew, PIN change
  or new phone key makes a form 2 record.
- It is sent in `vault.enroll`, `vault.unlock` and
  `vault.recovery.open` (sealed to the ETK), in a transfer's `hs.init`
  (sealed to the vault), and as `new_unlock_secret` in the UTK-sealed
  payload of `pin.change` and `vault.secret.renew`. Never logged, never
  in a crash report, never to the member API.
- The app's data stays excluded from backups (`allowBackup="false"`):
  the phone key cannot be restored, like the other two.
- **No iOS unlock** for a vault of release R until the secret is designed
  for iOS (VAULT-MESSAGING §15 item 39).
- Tested on both test phones: the key in StrongBox or the fallback, its
  level read back, the same secret twice for the same record and a
  different one for a different `r` (the 85-byte message of form 2), and
  that no screen-lock change removes it.
- Modules: `:core:keystore` unchanged (the same HMAC key);
  `:core:crypto` `UnlockSecret` takes `r` under the new label and keeps
  the form 1 function for old records; `:core:data` `PhoneSecretState`
  becomes the list of records, with `PhoneSecrets` making a candidate
  (stored first) and confirming one; `keepPhoneKey` and the recovery's
  register store `r` with the new key.

**"This phone no longer holds the keys"** (an unlock answered
`device_secret` with the current record and every candidate, or a
definite loss of the phone key while the app holds a `vault_id`): "This phone no longer holds the keys of your vault. That
happens when the app's data was cleared or the phone was set up again
from a backup. Nothing was disclosed. Whether you can get back into the
vault depends on one of its settings. If its credential backup was on
(the usual case), you can recover it: start a recovery on the account
site. It takes one to three days, and you need your PIN and your
password. If you had turned credential backup off, this vault cannot be
brought back; you can delete it on the account site and start a new
one. If you still have a phone on which VettID works, use 'Move to a
new phone' there instead. The account site tells you which of these
applies." The app cannot ask the vault; the account site reads the
backup bit.

(0.1.43) **Try the earlier secret.** While a replaced record exists
(at most 7 days after a PIN change or a new phone secret), the screen
also shows: "Use this only if your vault was put back to how it was
before your last PIN change or new phone secret. This phone can then
try the secret it used before that change. Enter the PIN you had before
that change." with **Try the earlier secret**. Only this button tries a
replaced record, never the app on its own: newest first, each once.
Only `ok` (or `transfer_incomplete`, for a transfer that did not
finish) makes it current again. **`bad_pin` changes nothing**: it shows
only that a header the host served matched the secret, and nothing
opened. The app then says "That PIN did not open your vault with the
earlier secret. Nothing was changed. Enter the PIN you had before your
last change and try again." On `ok` the app adds a History entry, shown on the phone for now (a
vault History event may follow in a later release)
("Opened with this phone's earlier secret on {date} at {time}. Your
vault had been put back to how it was before your last change.") and
asks for a new phone secret at once: "Your vault is open as it was
before your last change. It is back on an older secret, which something
that once ran as VettID on this phone may have known. Get a new phone
secret now." with **New phone secret** (the PIN and the password, as in
Settings) and **Later**; the app asks again at each start until it is
done. If no earlier secret opens it: "The earlier secret did not open
your vault either." and the screen above.

**Recovery on the new phone** (replaces the PIN step and the password
step of the "Recovery (new phone)" row).

1. Scan or type the code → claim → register, as before (the phone key is
   made before the register).
2. **One screen** with both fields, the owner-check screen's layout, each
   field with a show-and-hide control, and under them: "Enter both. You
   have 10 attempts in total for this vault, not 10 a day."
3. **Check before sending**, a step that cannot be skipped: "This is
   what will be sent. PIN: {pin}. Password: {password}. Look at both. A
   wrong entry uses one of your attempts." with **Send** and **Change**.
   The screen is excluded from screenshots and the recent-apps preview
   (`FLAG_SECURE`), and neither entry is written to disk.
4. Before the second attempt: "This is your second attempt. If it is
   wrong too, you can try again in 24 hours, and the wait gets longer
   after every further wrong attempt." At three or fewer left: "You have
   {n} attempts left. If they are all wrong, this vault cannot be
   recovered and you would have to start over with an empty one. Check
   both entries before you go on."
5. `vault.recovery.open` through `POST /api/vault/recovery/open`, then
   the answer. (0.1.41) Whether this attempt was used comes **only**
   from the result's `attempt_used`: "with one more used" in the table
   means `attempt_used: true`, "nothing was used" means `false`, and
   `{n}` is `attempts.used` subtracted from 10. A `retry` with
   `attempt_used: true`: "Something went wrong on the way. One attempt
   was used, and your PIN and password were not judged wrong. {n} of 10
   left. Try again." An answer the app
   cannot read: "We could not read the vault's answer. This attempt may
   have been used." and the count from the next answer:

| Answer | Text |
|---|---|
| `ok` | The vault is recovered. Then: "You used {n} of your 10 attempts. They do not come back. Change your PIN or your password now to get 10 new ones." |
| `wrong` | "PIN or password is wrong. The vault does not tell us which. {n} of 10 attempts left." With a wait: "Your next attempt is possible on {retry_at}. The wait after the next wrong attempt would be {next_wait}." |
| `wrong_again` | "That is the same PIN and password as your last attempt, and they are still wrong. This was not counted. Change one of them before you try again." |
| `attempt_lost` | "Something went wrong on the way and one attempt was used without being tested. {n} of 10 left. Your PIN and password were not judged wrong. A slow or interrupted service can cause this." |
| `quiet` (nothing used) | "This vault's app was used with its PIN and password on {date}. A vault can be recovered three days after that at the earliest: from {retry_at}. Nothing was used." |
| `quiet` with one more used | "The vault's app was used with its PIN and password while this attempt was on its way, or the service recorded that it was. One attempt was used without being tested. {n} left." |
| `wait` | "You can try again on {retry_at}. Nothing was used." (with one more used: as `attempt_lost`) |
| `busy` | "The service is busy right now. Nothing was used. Try again in a minute." |
| `retry` | "The service was too slow just now. Nothing was used. Try again." |
| `stored_mismatch` | Before an attempt: "The vault's stored data could not be opened. Nothing was used. Contact VettID." After a right attempt: "Your entry was right, but the vault's stored data could not be opened. Contact VettID." |
| `exhausted` | "All 10 attempts for this vault have been used. It cannot be recovered. You can delete it on the account site and start over." |
| `closed` | "The PIN or the password of this vault was changed, or its recovery was turned off, after this recovery began. This recovery cannot continue." |
| `not_armed` | "Recovery was not set up for this vault." |
| `counter_unavailable` | "We cannot check the attempt record now. Nothing was used. Try again later." |

   **A lost `ok`** (0.1.41; owner decision of 2026-10-16): when the open's
   answer never arrives or cannot be read (an open sent again gets no
   readable answer either, since the recovery record is gone), the app
   asks for the PIN and sends `vault.unlock` with
   the phone's secret. A result with `vault_bundle` gives it the vault and
   a token, and means the app **must send `hs.init` again**: the unlock
   dropped any handshake in progress, so a pending `hs.fin` is refused.
   The unlock can be repeated until the handshake completes.

   While a wait runs the screen shows the date and time of the next
   possible attempt with a countdown, and the app keeps the registered
   recovery, so that the member comes back to this screen. After `ok`:
   `hs.init` with `ctx` = `recovery_id`, then `credential.get` as the
   holder; no `credential.recover`.

**Owner check and status.**

- The owner-check screen shows the presence notice when the answer says
  `present_recorded: false`: "Your vault could not record that you were
  here. If this stays for three days, your vault is no longer protected
  against a recovery started by someone else. Try again later. If it
  does not go away, contact VettID."
- Settings → Vault status gains **Recovery**, from `vault.status`:
  "Recovery: on. Attempts used: 0 of 10."; with attempts used: "Recovery
  attempts used: {n} of 10. If that was not you, change your password
  now, and your PIN as well. That gives you 10 new attempts and ends the
  old ones."; with ten used: "All 10 recovery attempts were used.
  Recovery is off until you change your PIN or your password.";
  `needs_check`: "Recovery: set up at your next check."; `off`:
  "Recovery: off (credential backup is off)."; unknown: "Recovery:
  cannot be checked right now." — never "0 of 10". Unknown for 24 hours,
  with the urgency of a used attempt: "For a day your vault has not been
  able to check its recovery attempts or record that you were here. If
  this goes on for three days, your vault is no longer protected against
  a recovery started by someone else, and until it ends you cannot
  change your PIN or password. This is a fault of the VettID service or
  an attack on it. Contact VettID."
- History shows `recovery.attempt` entries: "Recovery attempt 3 of 10",
  at the counter's time, with "Successful." or "Not successful. If this
  was not you, change your PIN or your password now." and the outcome
  of the matching `recovery.open` entry ("Wrong PIN or password."), or
  "Details not available." when the vault has none, and the phone's
  name in its self-reported form, "From a phone that calls itself
  “Pixel 7”." (0.1.52: the titles, details, the matching and the name's
  rules are §4 "Event titles"; the vault records the name from
  VAULT-MESSAGING 0.50.0). Notifications: `recovery.attempt`
  (urgent), `recovery.change_required`, `recovery.counter_unavailable`.

**Change PIN** (Settings → Vault → PIN; `pin.change`, now a credential
operation). One flow: the current PIN, the new PIN twice (the app's
weak-PIN rules as at enrollment), then the credential password, sent
together with a new epoch's secret (0.1.43: a new candidate, stored
first). Texts: success "Your PIN was
changed. Your vault's recovery now has 10 new attempts for the new PIN
and your password."; `busy`: "The service is busy right now. Nothing
was changed. Try again in a minute."; `counter_unavailable`: "Your PIN
cannot be changed right now, because your vault cannot reach its
recovery record. Nothing was changed. Try again later."; `bad_pin` and
`bad_password` as at the owner check (they count as failed checks). The
app moves to the next epoch only with the answer. Refused while the
vault is held, as before. (0.1.43) Refused before anything is sent
while four earlier changes are unanswered, for a PIN change and a new
phone secret alike: "Lock your vault and unlock it again first. Earlier
changes from this phone got no answer, and this phone needs to learn
which one your vault holds before it makes another. Nothing was
changed." When the member came from a "not you" notice
about attempts, the app says first: "Changing only the PIN gives
whoever is guessing ten new tries at the same password. Change your
password too."

**A lost answer to a PIN or password change** (0.1.45, for the owner's
approval; VAULT-MESSAGING 0.44.0 §11.14.9 "A lost answer"). Today
(master b54685f) `VaultDevice.requestWithId` sends the same id three
times and then throws "no response", which the screen shows as a
generic failure; the member's retry is a new request with the old blob,
`Credential.credOp` turns the vault's `stale_credential` into a fetch
and a resend with the same typed PIN or password, and after an applied
change that resend is answered `bad_pin` or `bad_password` and counted.
From this version:

- **Before the send**, in the same atomic write of `account.bin` as the
  PIN change's candidate (or alone, for a password change), an
  `UnresolvedChange(type, innerId, sentVersion, exp)`; a write that is
  refused stops the operation with the existing "could not save" text.
  The request carries `exp` 10 minutes after the vault's clock as last
  seen (the `ts` of the newest sealed answer plus the elapsed
  `SystemClock.elapsedRealtime()`). The sent request (id and body) stays
  in the view model's memory only.
- **No answer** after the three sends: no failure is shown, the new
  entries stay, and a `ChangeResolver` runs at once, at every
  reconnection and at start-up: it resends the same request (same id
  and body) while `exp` has not passed and asks `credential.version`;
  version + 1 → `credential.get`, UTKs topped up, the candidate made
  current, the success text; the same version in an answer stamped more
  than 1 minute after `exp` → "not changed"; earlier → resend or ask
  again (30 s doubling to 5 min); anything else → the candidate left to
  the next unlock and that answer's own path. While a change is
  unresolved, `changePin`, `changePassword`, `renewPhoneSecret`, the
  owner check and every other `credOp` are refused at once (0.1.46: no
  waiting for the resolver), with the "still checking" text while the
  vault can be reached and the "unreachable" text while it cannot.
- **`stale_credential`** to `pin.change` or `credential.password.change`
  is not retried by `credOp` with the typed secrets. (0.1.46) It decides
  **not applied**: the marker is cleared, the blob fetched, and the
  "not changed" text shown. The resolver is not asked, because the
  version moved for the earlier operation that made the blob stale.
- **An answer** decides by itself: success even when the confirmation
  write fails (the marker then stays and the resolver or the next unlock
  confirms); `bad_pin` / `bad_password` clear the entry that was wrong
  and keep the new ones; the other refusals keep their texts.
- **Unlock while a PIN change is unresolved** (or its PIN uncertain,
  below): the PIN screen asks for the previous PIN and sends it with the
  current record. (0.1.46) `ok` does not decide the change: the marker
  stays and the resolver decides once the vault runs, since a queued
  copy may still apply until `exp`. On `device_secret`, the other
  unconfirmed candidates (an unanswered renew's) are tried first with
  the previous PIN already typed, newest first. Only when they all
  answer `device_secret` does the screen ask for the new PIN and try the
  change's candidate (the typed PIN is never reused for it). A password
  change does not change the unlock; the resolver runs after it.
- **Texts (draft, shared with the iPhone app)**:
  - checking: "Your vault hasn't answered yet, so VettID is checking
    whether your PIN was changed. Keep your new PIN at hand." (password:
    "… whether your password was changed. Keep your new password at
    hand.")
  - applied: the usual success text.
  - not applied: "Your PIN was not changed. You can try again." (password:
    "Your password was not changed. You can try again.")
  - unreachable: "VettID can't reach your vault right now, so it doesn't
    know yet whether your PIN was changed. It will check as soon as it
    can. Keep both your old and your new PIN at hand." (password: the
    same with "password")
  - another action while unresolved and unreachable: "VettID is still
    checking whether your last change went through. Try again when your
    vault can be reached."
  - unlock, first step: "Enter your previous PIN" with "Your last PIN
    change got no answer. If it went through, VettID will ask for your
    new PIN next."
  - unlock, after `device_secret`: "Your PIN change went through. Enter
    your new PIN."

(0.1.46, approved by the owner 2026-10-18; VAULT-MESSAGING 0.45.0) In addition:

- **Nothing else in flight.** Before `UnresolvedChange` is stored, the
  outbox holds no entry of a credential type and no credential request
  is waiting for its answer. Otherwise the app flushes and waits for
  those answers for up to 30 s, then refuses with "VettID is still
  finishing an earlier request to your vault. Nothing was changed. Try
  again in a minute." The `account.bin` update that stores the marker
  refuses when a marker with another `innerId` exists, so a double
  submit or the PIN and password screens together cannot overwrite it.
  (0.1.47) A pending request is settled only by its answer, or by the
  `ts` of a vault answer more than 1 minute after its `exp`; events and
  other vault messages settle nothing. When every pending request should
  have expired by the phone's estimate, the app may send one
  `credential.version` to obtain a vault time.
- (0.1.47) **A renew is settled before a PIN change.**
  `renewPhoneSecret` stores an `UnresolvedChange` for
  `vault.secret.renew` before sending, as for a change. (0.1.48) An
  answer to the renew's own request decides it, any refusal
  (`stale_credential` included) as not applied; only a renew with no
  answer goes to the resolver, which decides by `credential.version` with
  the same table.
  `changePin` is sent only once no renew is unresolved: while one could
  still apply, it is refused with the "earlier request" text above; when
  the version cannot decide, it is refused with "VettID couldn't confirm
  your last new phone secret. Before you change your PIN, lock your
  vault and unlock it again: your PIN hasn't changed, so this doesn't
  use an attempt." and a "Lock and unlock now" button. That unlock
  confirms the renew's candidate or the current record. Trying other
  candidates with the previous PIN at an unlock stays only as the
  fallback for a renew candidate left from before this rule.
- (0.1.48) **Sent with the vault's current blob.** Under
  `credentialLock`, after the pending requests are settled and before the
  marker is stored, `changePin`, `changePassword` and `renewPhoneSecret`
  ask `credential.version`. When it differs from the held blob's version
  they run `credential.get`, keep the blob, and continue with it when its
  version equals the vault's. Otherwise they stop with nothing sent and
  the "earlier request" text. (0.1.50) With no answer they stop with
  the plain network failure text, "VettID could not reach the service.
  Check your connection and try again." (`data_failure_network`), not
  the "unreachable" text above, which is for a change that may be
  pending: here nothing was sent. An error answer, an answer without a
  `version`, or `exists: false` counts as "differs": they run
  `credential.get` and continue only with the vault's current blob (the
  version the answer gave, or, when it gave none, the blob
  `credential.get` returned); otherwise the "earlier request" text.
  Tests: an owner check, a name change and a `credential.unlock` whose
  answers are lost, then a PIN change sent with the refreshed blob, and
  a lost `stale_credential` that is never read as applied.
- **No lock-and-unlock flow while unresolved.** `ReleaseUpdate` refuses
  to start, retry or abandon an update while a marker exists or a PIN is
  uncertain, with the "still checking" text. Every other flow that would
  unlock with a PIN typed on its own screen does the same, (0.1.47) "Finish
  the move" on a transfer's new phone included. Only the unlock screen's
  two-step prompts send a PIN with a candidate. A PIN typed
  outside the two-step unlock screen is never sent with a candidate.
  Locking stays possible.
- **Ended without a decision** (another version, no credential, an
  alarm): no "Try again" button. After a PIN change the PIN is marked
  **uncertain** in `account.bin`: the owner check and the other
  PIN-carrying operations are refused, and the app offers "Lock and
  unlock now", which uses the two-step unlock. That unlock's `ok` (the
  previous PIN) or a candidate's confirmation (the new PIN) settles it.
- **Telling the member.** The resolver's decision is published
  app-wide: a notice on the main screen until dismissed, and a
  notification while the app is in the background. A change screen
  opened later ignores a decision it did not start.
- **Any failure after the marker is stored** other than a vault answer
  (cancellation, an error while opening the answer) is handled as no
  answer: the request is kept when available, the resolver runs, and the
  "checking" text is shown. The send runs in the manager's scope, not
  the screen's.
- **Texts (draft, shared with the iPhone app)**:
  - gate, vault reachable: "VettID is still checking whether your last
    PIN change went through. This can take up to about 10 minutes. Try
    again then." (password: "… your last password change …")
  - gate, vault unreachable: the existing "still checking … when your
    vault can be reached" text.
  - something else in flight: as above.
  - ended without a decision, PIN: "VettID couldn't confirm whether your
    PIN was changed, because something else changed in your vault at the
    same time. To find out without using an attempt, lock your vault and
    unlock it again: VettID will ask for each PIN in turn." Button "Lock
    and unlock now".
  - ended without a decision, password: "VettID couldn't confirm whether
    your password was changed, because something else changed in your
    vault at the same time. Either your previous or your new password
    may be the current one."
  - one-time notice, applied: "Your PIN change went through. Use your
    new PIN from now on." (password: "Your password change went through.
    Use your new password from now on.")
  - one-time notice, not applied: "Your PIN change didn't go through.
    Your previous PIN is still your PIN." (password: "Your password
    change didn't go through. Your previous password is still your
    password.")

**A lost answer to New credential** (0.1.51; owner decisions of
2026-10-19; VAULT-MESSAGING 0.48.0 §11.14.9 "A lost answer to
`credential.reset`"; vettid.org #358). A reset that applied without its
answer reaching the phone leaves the vault at version 1 under a new key
while the phone holds the old blob, and the next credential operation
would raise a clone alarm.

- **Hidden until done** (owner decision 2026-10-19). Settings →
  Security → Credential does not show the **New credential** row
  (`new_credential_row`), and `CredentialNewRoute` cannot be reached,
  until the rest of this section is implemented and tested. The
  repository method stays.
- **Sent as a change is.** `newCredential` runs under `credentialLock`:
  the pending requests are settled, then `credential.version` as in
  "Sent with the vault's current blob" above. The `key` of that answer
  is stored with the marker: `UnresolvedChange` of type
  `credential.reset` gets a `heldKey` field. An answer without `key`
  stops with nothing sent and the "earlier request" text. The request
  carries `exp` (10 minutes, the vault's clock as for a change) and is
  kept in memory, the same `innerId` and body, until decided.
- **The gate.** While the marker exists, every other credential
  operation (owner check, renew, PIN and password changes, rotation,
  critical items, wallet signing, transfer approval, vault deletion) is
  refused at once with the gate's texts, reset wording. Unlocking is
  not affected: a reset changes neither the PIN nor the phone secret.
- **The resolver** resends the same request while `exp` has not passed
  and asks `credential.version`:
  - another `key` than `heldKey`, or a lower `version`: applied. It runs
    `credential.get`, keeps the blob (opened with the new password),
    sends `credential.ack`, tops up with `credential.utk.get`, drops
    the local copies of critical items, clears the marker;
  - the same `key` and `version` in an answer stamped more than 1
    minute after `exp`: not applied; clears the marker;
  - the same in an earlier answer: resend or ask again (30 s, doubling
    to 5 minutes);
  - anything else (no credential, the same key with another version,
    an alarm): ended without a decision, no "Try again" button; an
    alarm opens the alarm screen.
- **An answer that arrives** decides by itself: the new blob is
  success; every refusal, `stale_credential` included, is not applied,
  and `stale_credential` fetches the blob without retrying the typed
  secrets.
- **Tests**: a reset whose answer is dropped and that applied (decided
  by the new `key`, no alarm, the next owner check sent with the
  fetched blob); a dropped reset that never reached the vault (decided
  after `exp` + 1 minute); a reset from a held blob of version 1
  (decided by the `key` alone); a resend answered from the vault's
  cache; an owner check refused by the gate while the marker exists;
  the hidden row.
- **Texts (draft, shared with the iPhone app)**:
  - checking: "Your vault hasn't answered yet, so VettID is checking
    whether your new credential was made. Keep your new password at
    hand."
  - unreachable: "VettID can't reach your vault right now, so it
    doesn't know yet whether your new credential was made. It will
    check as soon as it can. Keep both your old and your new password
    at hand."
  - gate, vault reachable: "VettID is still checking whether your new
    credential was made. This can take up to about 10 minutes. Try
    again then."
  - ended without a decision: "VettID couldn't confirm whether your new
    credential was made, because something else changed in your vault
    at the same time. Either your previous or your new password may be
    the current one."
  - one-time notice, applied: "Your new credential was made. Use your
    new password from now on. Your critical items were deleted with the
    old credential."
  - one-time notice, not applied: "Your new credential wasn't made.
    Your credential, its password and your critical items are
    unchanged."

**Passwords** (enrollment, password change, reset; VAULT-MESSAGING
§11.14.7). The meter that scored length and character classes, and the
25-entry list, are replaced:

- the rules as the member types: at least 12 characters (counted as
  characters, not bytes), not one character repeated, not on the shared
  common-password list, not the PIN, and an estimated guessability of
  at least the vault's minimum, from an on-device estimator with its
  word lists in the app (no network). The app's threshold is a little
  above the vault's, so that a password the app accepts is rarely
  refused;
- under the field, the reason, in words: "Use at least 12 characters.",
  "That is one character repeated.", "That is a very common password.",
  "Don't use your PIN as your password.", "This is easy to guess. Add
  more words or make it less predictable." and a short hint from the
  estimator ("Avoid names, dates and keyboard runs."); a positive line
  when it passes: "Strong enough.";
- the vault's `weak_password{reason}` shown with the same texts;
- the password is normalized to NFC before it is used or sent, as the
  vault does;
- a shared test file of passwords with expected verdicts is run against
  the app's estimator in CI. Before production, the minimum is tried
  with real people typing on phones; if many honest choices are refused,
  the owner decides the figure again;
- the estimator's and the lists' licences are read before they are used.

**Transfer** (VAULT-MESSAGING §11.14.10).

- *New phone.* It makes its phone key and sends `unlock_secret` in its
  `hs.init`. After `device.paired` and the credential, one screen:
  **Finish the move**, "Enter your PIN on this phone to finish moving
  your vault." It sends `vault.lock` and then `vault.unlock` with the
  new secret; on success: "Your vault is on this phone now." If the
  unlock is answered `transfer_incomplete`: "The move to this phone did
  not finish. Approve it again on your old phone." The step can be
  postponed ("Later"); the app asks again at its next start until it is
  done.
- *Old phone, approving.* As before, the PIN and the password together.
  `busy`: "The service is busy right now. Nothing was moved. Try again
  in a minute." (the transfer stays open).
- *Old phone, after the approval* (decided by the owner on
  2026-10-15). The approval answer `{"unlink": "after_new_unlock"}`
  means: keep the keys, and record the approval's time. The app shows,
  and keeps showing at every start: "Finish the move on your new phone.
  This phone keeps your vault's keys until your new phone has finished
  the move, for at most 7 days. Before you give this phone away, remove
  VettID from it or reset it." It sends nothing to the vault. On
  `device.unlinked{reason: "transferred"}`, or at its first start 7 days
  or more after the approval, whichever comes first, it deletes the
  phone key, the device key and the app key and erases its local state,
  then shows "Your vault has moved to your new phone. VettID has removed
  its keys from this phone." Until then it offers **The move didn't
  finish**: "Use this if your new phone cannot open your vault. If your
  new phone opens the vault, ignore this." It asks
  for the PIN and unlocks with this phone's own keys; on success: "This
  phone is your vault's phone again. Start the move again when you are
  ready."; otherwise: "Your vault could not be opened from this phone.
  Contact VettID within a day of the failed move: it may be repairable."
  There is no "Delete now" button.
- After a transfer, a PIN change or a password change the app offers to
  rotate the vault's keys (`credential.rotate`), which a completed
  recovery does by itself.
- (0.1.50; VAULT-MESSAGING 0.47.1 §3.5.9) **A rotation during a
  credential alarm.** Before "Rotate now" while an alarm is open, and
  when a rotation is answered `rotation_required` or
  `credential_frozen`, the app asks `credential.version`. When the
  `version` or the `key` differs from those of the blob it holds, it
  runs `credential.get`, keeps the blob, sends `credential.ack` and
  retries the rotation once. While the answer shows the alarm `frozen`,
  it asks for the member's confirmation first. (The vault answers a
  superseded blob in `rotation_required` with `rotation_required`, not
  `stale_credential`, and spends the UTK.) Tests: a clone used first,
  then the holder's rotation succeeding after one fetch; a second
  `rotation_required` after the retry is shown, not retried again.

**Other screens.**

- **A connection suspended for two successors** (`identity.rotate_conflict`):
  the connection's tile shows "Suspended: verify again" and its detail
  explains "This connection's vault announced two different new keys.
  That can mean someone holds an old copy of their vault. Nothing is sent
  or received until you check." It shows both candidates' fingerprints
  (8 groups of 4 hex digits each) and asks the member to compare them
  with the fingerprint the other person reads from their own app, in
  person or on a call; **This one matches** (for either) sends
  `connection.rotation.resolve`, after a confirmation; **Neither matches**
  offers to remove the connection and invite again with a safety code.

- Settings → Security → **New phone secret** (`vault.secret.renew`): the
  PIN and the password; "Your phone now uses a new secret for this
  vault." It replaces the vault's DEK, so a secret that leaked by
  another route opens no later stored state. (0.1.43) The screen says,
  before the PIN: "If something ran as VettID on this phone, a new
  secret alone is not enough: move your vault to another phone, or
  recover it." Until the form 2 secret ships, code that ran as the app
  could have computed the next secret in advance, so on Android only a
  new phone key (a transfer or a recovery) ended that exposure; from
  form 2 a new secret made after such code is gone ends it for the
  secret, but not for the device's other keys. This text lands in the
  app before the formula change. The four-unanswered refusal of "Change
  PIN" applies here too.
- The credential backup's off-warning gains: "With this off, clearing
  the app's data or losing this phone ends the vault."
- **A right entry that could not be completed** (an open after a run
  that ended without `ok` answered `wait` or `attempt_lost`): "The last
  attempt was right but could not be completed. {n} of 10 left. You can
  try again on {retry_at}."
- **After a cancel from the app** (an unlock with `cancel_recovery`), the
  app sends an owner check at once (the PIN and the password on one
  screen), which records that the member is present. While the cancel
  runs, the unlock screen shows "Cancelling the recovery…"
  (`unlock_recovery_cancelling`; approved by the owner 2026-10-20).
- The minimum app version: an app older than the release's
  `android_min_version_code` is refused at enrollment, a transfer and a
  recovery's register with `attestation`; the app shows "Update VettID
  to continue."

**Tests.** Unit: the secret's formula against VAULT-MESSAGING §16's
vectors (`phone` for form 1, `phone_2` for form 2); the epoch after a
lost answer; (0.1.43) the records against a fake vault that follows the
vault's order of writes: store before send (a stop after the store and
before the send leaves a candidate that a retry reuses and a new change
keeps; a store that drops or refuses the write stops the operation with
nothing sent), epoch 1 (a key with no record at start-up is replaced
by a new key and record), the earlier secret moved by `ok` but not by
`bad_pin`, with its History entry and the new-secret prompt, a temporary
refusal of `account.bin`'s Keystore key that changes nothing, a renew answer lost then an unlock, two lost renews then an
unlock (newest first), a lost renew then a PIN change, an unlock with
the current record that drops the vault's `next` part, (0.1.45) a lost
PIN change and a lost password change decided by a resend of the same
request (cached answer, no attempt counted), by `credential.version`
(applied; not applied after `exp`; undecided before it), a lost answer
then a restart, `stale_credential` not retried with the typed secrets,
no owner check or credential operation sent while unresolved, the
two-step unlock prompt (previous PIN; new PIN only after
`device_secret`), (0.1.46) a credential operation in the outbox that
delays or refuses a change, a double submit refused by the marker, an
update refused while a change is unresolved, `stale_credential` decided
as not applied, `ok` with the previous PIN leaving the marker, a renew
candidate tried with the previous PIN before the new PIN is asked for,
the uncertain PIN after an ended check, the app-wide notice, all on the
real `VaultManager` paths and not only on the fake, every non-`ok`
answer leaving the current record, the fifth change refused, replaced
records deleted after 7 days and not later with the clock set back, the
earlier secret tried only from its button, a temporary Keystore error
that changes nothing, a form 1 record moving to form 2, the wipe leaving
no record and no key, and no `r` or secret in any log or crash report; the password rules and the
shared verdict file; NFC. Instrumented, dev stack: enrollment, unlock,
recovery to `ok`, every answer of the table, the check-before-sending
step (no entry on disk; `FLAG_SECURE`), a transfer with Finish the move
and the old phone's deletion on the notice, a PIN change, the presence
notice, the "no longer holds the keys" screen after clearing data.
Manual: both test phones against staging release R.

### Event titles (0.1.52)

Approved by the owner (2026-10-19, 2026-10-20). Every event the vault sends has a
plain title in the Notifications screen, in system notifications and in
History. "Activity: <kind>" and "Vault event: <kind>" stay only for a
kind a newer vault adds (§4 Notifications, 4; History). The kinds, `ref`
formats and priorities are VAULT-MESSAGING §10.9 and §11.14.11 (0.50.0),
checked against the vault as built (staging release 19). In the titles,
`n` is read from `ref`, and 10 is the number of recovery attempts per
generation (§11.14). The titles below take precedence over earlier
texts for the same kinds; the texts approved before and not listed
here stay as they are.

**Words.** "Daily check", never "daily owner check" or "owner check",
in every text the member reads (owner decision 5). The History category
"Unlocks and owner checks" becomes **"Unlocks and daily checks"** (its
identifier `unlocks` is unchanged), and the History titles of
`owner_check.*` say "daily check".

**Notifications** (feed items: the row of the Notifications screen and
the system notification; the second line is the row's second line and
the notification's text when names and text are shown):

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
| `recovery.counter_unavailable` (`urgent`) | "Your vault cannot check its recovery attempts" | none; Settings → Vault status shows the approved "For a day your vault has not been able to check its recovery attempts …" text (§4 "Owner check and status"), scaled on a vault with a time scale |
| `recovery.generation_closed`, `ref` `<generation>/rollback` (`urgent`; owner decision of 2026-10-20; needs a vault release) | "Your vault was given an older recovery record" | "A host may have served an older copy of your vault's recovery record, one on which recovery attempts had already been used. Your vault moved past it. If you did not try to recover your vault, change your PIN and your password now, and contact VettID." |
| `identity.rotation_failed` (`high`) | "Your vault could not update its keys" | "Your connections still know your old keys. VettID will offer the update again." |
| `identity.rotate_conflict` (`high`) | "<First Last>: verify again" | "This connection's vault announced two different new keys. That can mean someone holds an old copy of their vault. Nothing is sent or received until you check." (§4 "Other screens") |
| `leash.item.run`, `leash.item.proxy` | "An agent used <item>" (decision 8); without item names: "An agent used an item" | — |

**Channels** (owner decision of 2026-10-19, approved by the owner):
the urgent recovery notifications notify on **Security alarms**: a
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
resolves for the row (§4 History; "Removed connection", "Removed
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
agent and item (§10.11), so its title says "You changed …".

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

**Tests** (vettid-android): every title and detail above from its kind
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

### Wallet, presence, location and video (0.1.42)

*Wording for the owner's approval. The app's side of VAULT-MESSAGING
0.34.0 §10.18 Wallet (with §10.7 critical items), §10.17 Presence and
§10.16 Location, and of CALLS-PLAN 0.1.3 §4, §6.4 and §7 C4 for video.
The vault side of the first three is built (vettid-vault `main`,
features `wallet`, `presence` and `location`, on in staging and off in
production, VAULT-MESSAGING §11.10.8) but has never been used from a
phone. Nothing here is built in the app. The owner decided on
2026-10-17 the wallet's networks on staging, that the chain source is
the member's choice, and the order (D8); the other choices are open
(§9, questions 16–27), each with a recommendation. The texts are
drafts for the owner's wording. Vault code read at vettid-vault
`2c3fe13`.*

**Order** (D8). Wallet (W0–W2), then presence (P1), then location
(L1–L3), each on staging under STAGING-DEVELOPMENT-PLAN §2 and promoted
through its §2.4. Video in calls (C4) comes after the calling service
and ringing (CALLS-PLAN C2 and C3).

**Does this vault have the feature?** As for calls (CALLS-PLAN §12.5)
and photos: after each unlock the app sends one `wallet.list`, one
`presence.get` and one `location.share.list`. An answer means the
feature is there; `unsupported_type` hides its screens, drawer entry
and buttons for that vault until the next unlock. Nothing is cached
across releases. Production release 1 lists none of the three
(VAULT-MESSAGING §11.10.8), so a production build shows none of them
until a production release lists them.

#### Wallet

**What the member gets.** Bitcoin wallets in the vault: the recovery
phrase is a critical item in the Protean Credential, so nothing can be
spent without the credential password; the vault derives addresses
without it. The app is the wallet's eyes on the chain: it reads
balances and coins from a server the member chooses, builds the
transaction, and broadcasts what the vault signed. **The vault never
talks to a chain** (VAULT-MESSAGING §10.18).

**Networks** (D8; owner decision of 2026-10-17). The staging build
offers **signet** and **testnet4**. The production build will offer
mainnet, with its own approval before production; test networks are
not offered there. The vault's `network` member knows `signet` and
`testnet`, and `testnet` covers testnet3 and testnet4, whose addresses
and keys look the same (vettid-vault `vms/btc/account.go`). The app
must therefore know which test chain a `testnet` wallet is on. The
options:

| Option | How | For | Against |
|---|---|---|---|
| (a) App-side label | The app stores `testnet4` with the `wallet_id` in its own encrypted settings | No vault change; invisible to the member | Lost with the app's data: after a transfer or a recovery the new phone does not know it, and has to ask |
| (b) A wallet tag | `tags: ["testnet4"]` in `wallet.create`; read back from the item (`item.get`, since `<wallet>` has no tags) | Kept in the vault, on every device; no vault change | Tags are the member's: they drive sharing, show on the Vault screens, and can be removed, renamed or merged (`tag.merge`) by the member, which silently loses the marker |
| (c) A vault field | The vault accepts `network: "testnet4"` as its own name (testnet encodings and coin type 1), and `testnet` keeps meaning testnet3 | Exact, durable, the same on every device and in desktops later | A vault change and a staging release |

**Recommendation (question 16): (c)**, a small vault fix for the next
staging release, and **(a) until then**: the app writes the label when
it creates or imports a testnet4 wallet, and a `testnet` wallet the
phone has no label for opens on "Which test network is this wallet
on?" (testnet4, or testnet3 with "VettID's staging app does not
connect to testnet3"). A wallet whose network the vault names exactly
never asks.

**The chain source** (D8; owner decision of 2026-10-17: member-chosen).

- **What it is.** An **Esplora** server (the HTTP API of Blockstream's
  esplora, which mempool.space also serves). The app uses: the tip
  height, an address's (or script hash's) transactions and unspent
  outputs, a transaction's raw hex, the fee estimates
  (`/fee-estimates`), and the broadcast (`POST /tx`).
- **Defaults per network:** signet `https://mempool.space/signet/api`,
  testnet4 `https://mempool.space/testnet4/api` (question 17). The
  mainnet default is chosen with the production approval.
- **The member's own server.** "Use my own server": an Esplora URL,
  `https` only, no credentials in the URL, redirects refused. Before it
  is saved the app tests it: the server must answer and its block 0
  must be the genesis block of that network (the app has the four
  genesis hashes built in), so that a testnet3 server is never used for
  a testnet4 wallet, or a mainnet server for a test one. **Electrum**
  servers (the protocol of Electrum, Electrs and Fulcrum, which is what
  most members' own nodes run) come later, after W2, if members ask
  (question 18); a proxy or Tor setting is out of scope here.
- **Where it lives.** Wallet → ⋯ → **Chain server**, one setting per
  network (not per wallet), also reachable from each wallet's details
  ("Using mempool.space"). Stored in the app's encrypted settings on
  this phone only (it is not a vault setting: a new phone starts from
  the defaults). "Reset to default" restores the network's default.
- **Privacy note** (shown under the setting, and once before a
  wallet's first look-up): "To show your balance and send, VettID asks
  this server about your wallet's addresses. The server sees those
  addresses, and can tell they belong together, and it sees this
  phone's internet address and when you look. VettID's own servers see
  none of it. Use your own server to keep this to yourself."
- **How the app uses it with the vault:**
  - *Which addresses.* The app derives the wallet's addresses itself
    from the account descriptors in `<wallet>` (`wallet.get`): both
    accounts (P2TR and P2WPKH), receive and change chains, up to the
    higher of the vault's `next_receive`/`next_change` and the last
    address with history, plus a gap of 20. Before using its own
    derivation it compares the first addresses of each chain with the
    vault's (`wallet.address.list`) and stops on any difference ("This
    wallet's addresses don't match your vault's. Nothing was sent.").
  - *Balance and coins.* From the server: confirmed and unconfirmed
    totals and the unspent outputs. `wallet.balance` is not used: it
    answers `unavailable` in every release.
  - *Receive.* The address comes from the vault (`wallet.address.new`,
    the receiving account), so that the vault knows every address it
    handed out (also to connections, §10.14). The app shows the newest
    issued receive address that has not been used, and asks for a new
    one only when that one has received funds or the member taps "New
    address", to keep the gap small.
  - *Used.* Addresses the server shows funded are reported with
    `wallet.address.used` (at most 256 per request) once per look-up,
    so that a connection's address is replaced (§10.14). The vault
    marks only addresses it issued (below, vault follow-up 4).
  - *Imported phrases.* After `wallet.create` with the phrase, the app
    scans both accounts on the server, sets the receiving account to
    the one with the newer history (P2TR if neither has any, or both
    equally) with `wallet.update{address_type}`, and then has the vault
    issue addresses up to the last used index of each chain (one
    `wallet.address.new` per index; vault follow-up 5), so that it
    never hands out an address that was used before.
  - *Send.* The app builds the PSBT from the server's coins
    (below), the vault checks it (`wallet.psbt.inspect`) and signs it
    (`wallet.sign`); the app broadcasts the returned `tx` to the server.
    `broadcast: true` is never sent (`unavailable` in every release).

**Library** (question 19). The app needs BIP39 words (import and the
check before sending), BIP32 derivation from account keys, bech32 and
bech32m addresses, the BIP86 tweak, PSBT version 0 with taproot
fields, coin selection and an Esplora client. A short spike (W0)
compares **BDK** (`bdk-android`, a Rust library with Kotlin bindings,
MIT or Apache-2.0, which takes the vault's descriptors as they are and
has an Esplora client and coin selection) with ACINQ's
**bitcoin-kmp** and `secp256k1-kmp` (Kotlin, Apache-2.0). The spike
must show, against the dev stack's `wallet.psbt.inspect`: a PSBT with
the **full previous transaction on every input, taproot inputs too**
(the vault refuses anything else: `previous_tx`), taproot BIP32
derivations without leaf hashes and with the wallet's fingerprint, a
change output carrying its derivation (or the vault counts it as a
payment), one PSBT spending from both accounts, and a reproducible
`foss` build with the library in it. Recommendation: BDK, if it passes;
bitcoin-kmp otherwise.

**Screens.**

| Screen | Proton analogue | Notes |
|---|---|---|
| Wallet (drawer) | Folder list | The wallets (`wallet.list`), each a row: name, network chip ("Signet", "Testnet4"; gold-ink, never on mainnet), balance in BTC with sats underneath, "Not backed up" in the error colour while the phrase is not confirmed. The floating action button: **New wallet** / **Import a wallet**. Empty state: "No wallets yet". A test network shows a banner: "Test network: these coins have no value." Up to 16 wallets (`limit`: "Your vault holds 16 wallets, the most it can.") |
| Wallet detail | Message detail | Balance (confirmed; "+ 0.001 incoming" while unconfirmed), the last look-up's time and the server's host, pull to refresh; **Receive** and **Send** in the pill (Send from W2); the transactions (W2, below); ⋯: Show recovery phrase (question 21), Receiving address type (P2TR "Taproot (recommended)" or P2WPKH "Native SegWit"), Chain server, Details (fingerprint, network, account paths, descriptors, each copyable), Delete wallet |
| New wallet | — | Name (1–128 characters, no control characters), network (signet or testnet4 on staging), then the credential password ("Your password protects this wallet. You will need it for every payment."); `wallet.create` without `item`; then the phrase (below) |
| Import a wallet | — | Name, network, the words (12, 15, 18, 21 or 24), and an optional passphrase behind "Advanced" ("Only if you set one when the wallet was made. Letters, digits and symbols from a standard keyboard only."; printable ASCII, at most 256 bytes, as the vault requires). Each word is checked against the BIP39 English list as typed, and the checksum before anything is sent ("These words aren't a valid recovery phrase. Check each word and the order."). Then the password and `wallet.create` with `item: {mnemonic, passphrase?}`, then the scan above ("Looking for this wallet's history…") |
| Recovery phrase | — | After creating (and from ⋯ → Show recovery phrase): `item.reveal` of the wallet's item with a reply key; the words in a numbered grid of two columns, the passphrase (if any) under it; "Write these words on paper, in order, and keep them somewhere safe. Anyone with them can take your coins. VettID never shows them to anyone else." **No copy button**; Continue goes to the check |
| Check the phrase | — | Three positions chosen at random ("Word 4", "Word 11", "Word 19"), each picked from four candidate words or typed; a wrong one: "That's not word 11. Look at your paper again." with **Show the words again**. When all three are right: "Backed up" |
| Receive | — | The address as a QR code (a BIP21 `bitcoin:` URI, upper case for a denser code) and as text in groups of four; Copy (the clipboard marked sensitive), Share; an optional amount; "New address"; the account ("Taproot address") and "Only send <network> bitcoin to this address." A wallet whose phrase is not confirmed shows the phrase check instead (question 20) |
| Send (W2) | Compose | Below |
| Transaction detail (W2) | Message detail | Below |

**Creating and backing up** (W1).

1. The password is typed once and used for `wallet.create` and, at
   once after its answer, `item.reveal` of the new item: two credential
   operations (two UTKs), the password held in memory only between
   them and zeroized after the second answer.
2. `item.reveal` answers `values_sealed`; the app opens it with the
   reply key's private half, which lives only in memory for that
   request; the two `password` fields are "Recovery phrase" and
   "Passphrase" (vettid-vault `features/wallet/wallet.go`, `create`).
3. The phrase screen and the check set `FLAG_SECURE` (no screenshots,
   no recent-apps snapshot), are excluded from autofill and from
   Android's content capture (TalkBack still reads them), and hold the
   words in a `CharArray`
   that is wiped when the screen leaves. Leaving before the check: the
   wallet stays, "Not backed up", and the check is offered from its row.
4. **Confirmed** is a flag the app keeps per `wallet_id` in its
   encrypted settings (not a secret; the vault has no such flag, vault
   follow-up 7). An imported wallet starts confirmed (the member typed
   the words).
5. Every reveal is a credential operation, audited as `item.revealed`
   and a feed item (History: "Recovery phrase shown: <wallet>").

**Never** (both phases): the words or the passphrase on disk, in
`SavedStateHandle`, in logs, crash reports, analytics or the clipboard;
the import field is a password-class field without suggestions or
personalized learning (`IME_FLAG_NO_PERSONALIZED_LEARNING`), as the
typed recovery code (§4, "Recovery: type the code"); no word list
lookup over the network.

**Sending** (W2).

1. **Who and how much.** Paste, type or scan (QR, a BIP21 URI's
   address and amount; other URI parameters ignored) the address. The
   app checks it for the wallet's network first: a mainnet address in a
   test wallet (or the reverse) is refused, "This is a <network>
   address. This wallet is on <network>." The amount in BTC or sats,
   or **Send all**. One payee per send in W2.
2. **Fee.** From the server's `/fee-estimates`: **Slow** (about a
   day, 144 blocks), **Normal** (about an hour, 6), **Fast** (about 20
   minutes, 2), and **Custom** in sat/vB. Never below 1 sat/vB, never
   above 1,000 sat/vB (the vault's cap, `fee_rate`), and above twice the
   Fast rate the app asks "This fee is much higher than needed right
   now. Pay it anyway?". The transaction signals replacement (BIP125,
   sequence `0xfffffffd`) so that a later version can raise a fee; W2
   has no fee bump.
3. **Building.** Coin selection over both accounts' confirmed coins
   (unconfirmed coins only with "Include unconfirmed coins", off by
   default), branch and bound and then largest first; change to the
   next change address of the receiving account (the vault records
   whatever change index it signs for, `recordSpend`); outputs below
   330 sats are not made (the vault refuses them, `output_amount`): the
   remainder goes to the fee and the review says so. Each input gets
   its full previous transaction (fetched from the server) and its
   derivation with the wallet's fingerprint; the change output gets
   its derivation.
4. **The vault's summary.** `wallet.psbt.inspect`. The review screen
   shows **the vault's summary, not the app's own figures**: each payee
   with its amount, the change, the fee (in sats and sat/vB from
   `vsize`) and the total leaving the wallet. The app compares it with
   what it built: if a payee's address string differs from the one the
   member entered (the vault re-encodes an output script for the
   wallet's network, vettid-vault `vms/btc/psbt.go`, `Inspect`), or any
   amount differs, it stops: "Your vault saw a different payment from
   the one you entered. Nothing was signed." An `invalid_psbt` answer
   shows its text (below) and signs nothing.
5. **Approve.** "Send 0.0012 tBTC to tb1q…" with **Approve with
   password**. The password is typed once and used for
   `credential.unlock` (when the unlock window is closed; spending needs
   it, `credential_locked` otherwise) and then `wallet.sign` with
   `sealed{password, item_id: wallet_id, payload_sha256}`, where
   `payload_sha256` is the SHA-256 of the PSBT's **decoded bytes**, not
   of the base64 text. A lost or late answer is retried with **the same
   inner id**, which the vault answers from its cache, never by
   building again. The new credential and UTKs are stored and
   acknowledged like any credential response.
6. **Broadcast.** `POST /tx` with the returned `tx`. Success: "Sent.
   It will confirm in about <time>." Failure: the signed transaction
   stays in memory and **Try again** resends it (also after choosing
   another server); it is dropped at lock, and a later send simply
   spends the same coins again (only one of two can ever confirm). The
   app never writes `tx` to disk.

**`invalid_psbt` texts** (the reasons of vettid-vault
`vms/btc/psbt.go` and `features/wallet/wallet.go`; any other: "Your
vault would not sign this payment (<reason>)."): `fee_rate` "The fee is
above the most your vault will sign (1,000 sat/vB)."; `output_amount`
"One amount is below 330 sats, too small to send."; `previous_tx`,
`witness_utxo`, `foreign_input`, `derivation_path`, `derivation_key`,
`derivation_script`, `internal_key`, `input_script`, `duplicate_input`,
`malformed`, `shape`, `size`, `version`, `sighash`, `amount`, `fee`,
`no_account`, `output_script`: "VettID built a payment your vault
won't sign. Nothing was signed. Please report this." with the reason
under "Details"; `wrong_seed`: "Your vault's recovery phrase for this
wallet doesn't match its addresses. Nothing was signed. Contact
VettID." (an alarm-level text: it should never happen).

**Transactions** (W2). The list merges two sources by `txid`:
`wallet.history` (what this vault signed, with payees, change, fee and
the connection for a payment request) and the server's transactions
for the wallet's addresses (received payments, confirmations). A row:
"Sent to tb1q…" or "Received", the amount, "Confirmed" / "Waiting for
confirmation" / "Not broadcast" (signed by the vault, unknown to the
server after 24 hours); detail: amounts, fee, confirmations, block
time, `txid` (copyable) and "Open in a block explorer" (the chain
server's site when it has one; a confirmation that this leaves VettID).

**Local state.** The wallets, account keys, descriptors, addresses,
coins, balances and transactions are in memory only, cleared at lock,
on entering the hold or the due state, at a wipe and with the process
(the rule "nothing kept outside an open vault", §4 Notifications, 10);
an account key reveals every address and payment of the wallet. With
BDK, its persistence is not used (an in-memory wallet), so each open
looks the wallet up again. On disk, in the app's encrypted settings:
the chain server per network, the testnet4 label (option (a)) and the
backed-up flag per `wallet_id`. Nothing from a wallet goes to logs or
crash reports (ids at debug level only).

**The wallet's item elsewhere.** It is a critical item, so the
Credential screen lists it ("Bitcoin wallet: <name>"); tapping it opens
the wallet. Its edit and sensitivity actions are not offered (`in_use`).
Deleting it, from the wallet's ⋯ or the item, warns: "Delete
<name>? Your vault forgets this wallet and its recovery phrase. Coins
on it are lost unless you have the recovery phrase written down." and
needs the password (`item.delete` is a credential operation;
`sync.event{wallet.deleted}` follows).

**Notifications.** `wallet.signed` (Vault activity): "Bitcoin payment
signed" opens the transaction; `item.revealed` of a wallet as for any
critical item. No notification for coins received: the app looks at
the chain only while it is open.

**History** (category Vault). `wallet.created` "Wallet created:
<name>"; `wallet.deleted` "Wallet deleted"; `wallet.address_issued`
"Address given to <First Last>" (a connection's request, §10.14);
`wallet.signed` "Bitcoin payment signed" with the `txid` as `ref`;
`item.revealed` of a wallet's item "Recovery phrase shown: <name>".
No address or amount is in the audit log, so none is in History.

**Out of scope here:** mainnet (its own approval), shared actions'
`wallet.request-address` and `wallet.request-payment` (with shared
actions), fee bumping, several payees per send, coin control, Electrum,
labels on addresses, a fiat value.

**Texts (drafts).**

| Where | Text |
|---|---|
| Wallet, empty | "No wallets yet" / "Keep bitcoin in your vault. Payments need your password." |
| Test network banner | "Test network: these coins have no value." |
| New wallet, password | "Your password protects this wallet. You will need it for every payment." |
| Recovery phrase | "Write these words on paper, in order, and keep them somewhere safe. Anyone with them can take your coins. VettID never shows them to anyone else." |
| Recovery phrase, below | "No screenshots: this screen is hidden from screenshots and the app switcher." |
| Check | "Which is word {n}?"; wrong: "That's not word {n}. Look at your paper again." |
| Not backed up | "Not backed up. If your vault is lost, these coins are lost too." |
| Import, invalid | "These words aren't a valid recovery phrase. Check each word and the order." |
| Import, scanning | "Looking for this wallet's history on {host}…" |
| Unknown test network | "Which test network is this wallet on?" |
| Address mismatch (derivation check) | "This wallet's addresses don't match your vault's. Nothing was sent." |
| Wrong network address | "This is a {network} address. This wallet is on {other network}." |
| Summary mismatch | "Your vault saw a different payment from the one you entered. Nothing was signed." |
| Approve | "Send {amount} to {address}? Fee {fee}." Button: "Approve with password" |
| Broadcast failed | "Signed, but {host} didn't accept it: {reason}. Try again, or choose another server." |
| Chain server privacy | as above, "To show your balance and send, VettID asks this server…" |
| Server check failed | "That server isn't on {network}." / "That server didn't answer." |
| Delete | "Delete {name}? Your vault forgets this wallet and its recovery phrase. Coins on it are lost unless you have the recovery phrase written down." |

**Tests.**

- Unit: address derivation from the vault's descriptors against the
  BIP84 and BIP86 test vectors and against `wallet.address.list` from
  the dev stack; BIP39 word and checksum checks and the vault's
  normalisation (any case and spacing); the passphrase rule; the
  network check of a pasted address (mainnet, testnet, signet, a
  BIP21 URI); `payload_sha256` over the decoded bytes; the fee bounds;
  a PSBT whose change output lacks its derivation shows up as a payee
  in the vault's summary and is caught by the comparison; a summary
  with a re-encoded address is caught; the Esplora client against a
  recorded server (balance, unspent, raw transactions, fee estimates,
  broadcast errors) and the genesis check (a testnet3 server refused
  for testnet4); the retry of `wallet.sign` with the same inner id; the
  testnet4 label kept and asked for.
- Instrumented, dev stack (`regtest`, a development build of the
  vault, with a local Esplora): create, back up and check; receive;
  import a phrase with history on both accounts (the receiving account
  and the issued indices follow); a send through inspect, sign and
  broadcast that confirms; every `invalid_psbt` text; the phrase and
  check screens have `FLAG_SECURE`.
- **Privacy, data directory scan:** after creating, revealing, checking
  and importing a wallet and sending from it, lock and scan the app's
  files, databases, caches and `no_backup`: none of the test phrase's
  words in sequence, no account key, address, `txid` or signed
  transaction.
- Phone test, both test phones on staging: a signet wallet and a
  testnet4 wallet each created, backed up and checked; coins from a
  public faucet; the balance; a send to the other wallet confirmed;
  the member's own server set and refused for the wrong network; an
  import of a known test phrase.

**PRs.** W0: the library spike, written up (no screens). W1: the chain
source and its setting, wallet list and detail, create, import,
recovery phrase and check, receive, balance, `wallet.address.used`,
History and feed labels. W2: send (building, inspect, approve, sign,
broadcast) and the transactions. Each against the dev stack first,
then staging.

#### Presence

**What it is.** Whether a connection is around, on demand
(VAULT-MESSAGING §10.17): no heartbeats, no list of who is online. The
member's vault answers a connection's ping only if the member's policy
shares presence with that connection; otherwise it stays silent, which
looks the same as a locked or offline vault.

**Screens.**

| Screen | Notes |
|---|---|
| Settings → Privacy → **Presence** | The member's status: **Available**, **Busy**, **Away**, **Invisible** ("You appear offline to everyone"); **Who can see it**: "All my connections" (`share: all`) or "No one" (`share: none`), and **Exceptions**: the connections for whom it is the other way round ("Except…" under all, "Only…" under no one), picked from the connection list (at most 1,024). `presence.get`, `presence.set` with the policy's `version`; `conflict` reloads and re-applies the member's change once |
| Avatar sheet | One row under the name: "Status: Available" opening a short picker of the four states (the same `presence.set`) |
| Connection detail | A line under the name: "Available", "Busy", "Away", each with "· active {age}" from `last_active` ("active 10 min ago"; "active today" past an hour; nothing without it), or "Status unknown"; a refresh icon; and a switch **Share my status with <First>** (adds or removes the connection in `except`) |
| Conversation | The same line under the title, smaller |

**When the app asks.** `presence.query{connection_id}` when a
connection's detail or conversation opens and on refresh, never from a
list, and at most once a minute per connection (the vault's own rate:
a second query within the minute returns the first `ping_id` and
repeats its result). The line shows "Checking…" until a
`presence.result` with that `ping_id` arrives, or "Status unknown" at
`exp` (30 s). Nothing is shown on the Connections list (question 22).
While the vault is due or held, presence is not asked (the hold allows
no `presence.*` from the app).

**The first time** (question 23). The vault's default is Available,
shared with all connections, so once the feature is on every
connection can see "Available" and a last-active time without the
member having chosen it. The app shows a one-time card on Connections:
"Let your connections see when you're around? They see Available, Busy
or Away and roughly when you last used VettID." **Share with
everyone** / **Not now** (`share: none`), and "Change this in Settings
→ Privacy → Presence".

**Local state.** Results in memory only, per connection, until the
screen leaves or one minute passes; the policy in memory, re-read at
unlock and on `sync.event{presence.changed}`. Nothing on disk.

**Notifications and History.** None: pings and policy changes are not
audited or put in the feed.

**Texts (drafts).**

| Where | Text |
|---|---|
| Unknown | "Status unknown" / detail: "{First}'s vault didn't answer. They may be offline or locked, or not sharing their status with you." |
| Invisible | "Invisible: you appear offline to everyone." |
| Share switch, off | "{First} sees 'Status unknown' for you, as if your vault were offline." |
| Last active | "active {n} min ago" (rounded down to 5 minutes by the vault) |
| First-time card | as above |

**Tests.** Unit: the policy editor (all/none with exceptions, the
switch on the connection page, `conflict`), the one-minute reuse, the
unknown state at `exp`, `last_active` formatting and its absence.
Instrumented, dev stack: two vaults, each state, a connection
excepted (unknown), the other vault locked (unknown), held (unknown).
Phone test: Pixel 10 Pro and Pixel 7 on staging, each other's status
both ways.

**PR.** P1: one PR (settings, avatar sheet, connection and conversation
lines, the first-time card).

#### Location

**What it is.** A member shares their location with one connection at
a time, by an explicit, expiring share, once or continuously, at a
precision they choose; the vault reduces each position to that
precision and forwards it from memory (VAULT-MESSAGING §10.16). This
supersedes the location phase notes of §6, whose three layers (an
event, a glance, a detail) are kept.

**Screens.**

| Screen | Notes |
|---|---|
| Share my location (a sheet from the connection detail, the conversation's ⋯, a request, or Location's button) | **Once** ("Sends one position now; ends after 15 minutes") or **For a while**: 15 min, 1 hour (default), 8 hours, 1 day, 7 days; **Precision**: Approximate (default, owner decision of 2026-10-03: "within about 1 km"), Exact ("within a few metres"), City ("within about 10 km"); **Update every** (for a while): 30 s, 1 min (default), 5 min, 15 min; **Let <First> keep the trail** (off by default: "Without this, <First> sees only your latest position"). Under the precision: "Approximate and City show the centre of a fixed area. If you move across an area's edge, <First> may see that you were near it." **Start sharing** → `location.share.start` |
| Location (drawer) | **You're sharing with**: each outgoing share (connection, precision, until, "Last sent 2 min ago", **Stop**); **Shared with you**: each incoming share (connection, age of the latest position, until); **Requests**: pending requests from connections (below). From `location.share.list`, kept current by `location.event` and `sync.event{location.share.changed}` |
| Connection detail | While <First> shares with you: a card with the latest position (below), its age and precision, until when, **Stop receiving** (`location.share.stop` of the incoming share). While you share with <First>: "Sharing your location until 15:30" with **Stop**. **Ask for location** (`location.request`, optional note up to 256 bytes) |
| Connections list | The glance: a small location icon and the age ("5 min") on the row of a connection that shares with you |
| A position (the detail) | L1: the coordinates, the accuracy circle as text ("within 1 km"), the age, the distance and direction from this phone when the member has allowed location, and **Open in maps app** (a `geo:` intent, after "This hands the position to another app."). L2: an embedded map (question 25) with the trail when shared |
| Approvals | A request: "<First> asks where you are" with the note, **Share once**, **Share for a while…** (the sheet, with the request's `request_id`) and **Not now** (no message is sent: the vault has no decline). It expires after 24 hours (question 27) |

**Sending positions** (`:core:location`).

- **Provider.** The platform's `LocationManager` (the `fused` provider
  of Android 12 and later, GPS otherwise), in both distributions: no
  Google Play services location API, so the `foss` build and GrapheneOS
  without Google work the same. Indoors on a phone without a network
  location provider a first fix can take minutes; the share sheet says
  "Finding your location…" and a **once** share waits up to 60 s for
  an accuracy of 100 m or better, then sends the best it has.
- **A foreground service** of type `location`
  (`FOREGROUND_SERVICE_LOCATION`), started by the member's tap on
  **Start sharing**, runs while this phone is the source of at least
  one active outgoing share. Its ongoing notification on a new
  **Location sharing** channel (low importance, silent) says "Sharing
  your location with Sam until 15:30" (several: "with 2 people") with
  **Stop all** and opens Location. The member's tap starts it while the
  app is visible, so the while-in-use permission is enough and the
  service keeps receiving positions with the screen off (question 24).
- **Cadence.** The provider is asked for the shortest interval among
  this phone's continuous shares; each fix is sent as an ephemeral
  `location.update` (`exp` = now + max(2 × interval, 60 s)) with `lat`,
  `lon`, `accuracy_m`, and `altitude_m`, `speed_mps` and
  `heading_deg` only when some share is exact (the vault drops them
  otherwise). `at` is the fix's time; a fix older than 5 minutes is not
  sent.
- **Stopping.** At the share's `expires_at` **by the app's own timer**
  (the vault ends it without telling this phone, vault follow-up 9), on
  Stop, on `location.event{stopped, direction: out}` (the receiver
  stopped it), on `sync.event{location.share.changed, ended}`, and when
  the vault locks. Nothing is sent when no share has this phone as its
  source (and, before L3, never for the log).
- **Locked, due, held.** The member's lock stops the service (a
  locked vault forwards nothing); after the next unlock, a share still
  active with this phone as source (`location.share.list`, `device_id`)
  resumes with a notice "Sharing your location with Sam again, until
  15:30". The app lock does not stop it. While the daily check is due
  or held, the vault drops this phone's positions and refuses
  `location.share.stop` (vault follow-up 10): the service pauses with
  "Paused until your daily check" and **Check now**.
- **After the process ends** (a reboot, the system killing the app):
  the share stays active at the vault until its expiry but receives
  nothing. At the next start with the vault open, the app resumes as
  after an unlock. Without background location it cannot restart by
  itself.

**Receiving.** `location.event{started}` (and the feed item
`location.shared`) adds the incoming share; positions arrive as
ephemeral `location.update` while the app is connected, and
`location.get{connection_id, history}` reads the latest (`last`, with
`received_at`), the trail when shared, and a snapshot when one was
sent, when the screen opens. A share's `expires_at` ends it on the
app's side too.

**Local state.** **Positions are never stored** by the app: not the
member's own fixes (held only until sent), not a connection's (in
memory while the screen or the vault is open, cleared at lock, hold,
wipe and with the process); never in Room, files, DataStore,
`SavedStateHandle`, logs, crash reports or a map's tile cache (if L2
adds a map, its disk cache is off or holds tiles only, never
positions). The app keeps on disk, in its encrypted settings, only
what it needs to resume or stop sending: the outgoing `share_id`s with
their `connection_id` and `expires_at`, cleared when they end.

**Permissions** (question 24). `ACCESS_COARSE_LOCATION` and
`ACCESS_FINE_LOCATION`, asked at the first share ("To share your
location, VettID needs to know where this phone is. It asks only while
you share, and sends nothing to anyone else."); with only approximate
access granted, Exact is unavailable ("Exact needs precise location
in Android settings"), Approximate and City work. `POST_NOTIFICATIONS`
for the ongoing notification (already asked for notifications).
**No `ACCESS_BACKGROUND_LOCATION`** in L1 and L2:

- *Play:* background location needs a permission declaration, a
  prominent in-app disclosure, a video and Google's review, granted
  only when it is core to the app; a `location` foreground service
  needs the foreground-service declaration (as `specialUse` did, §4
  Notification modes) but not that review.
- *F-Droid:* no rule against it; the listing would show it.
- *What it costs:* a share is started only from the app (a request
  opens the app first), it does not restart after a reboot by itself,
  and the member's own location log (below) is not possible.

**The member's own location log** (L3, question 26). The vault can
keep the member's own history (`location.history.*`, settings
`location.history.enabled`, off by default). It needs the phone to send
positions all the time, so background location, the Play review and a
second always-on service. Recommendation: not before members ask, and
then only with the owner's decision on background location. When
built: Settings → Privacy → **My location history** (on/off with the
warning that turning it off deletes it, retention, interval), a list
and day view, delete a range, and **Send to <First>** for an active
share (`location.history.share`).

**Notifications.** `location.request` (Requests): "<First> asks where
you are" opens Approvals. `location.shared` (Vault activity): "<First>
is sharing their location with you" opens the connection. The ongoing
sharing notification (above). A connection stopping its share: no
notification; the row updates.

**History** (category Location). `location.share.started` "Started
sharing your location with <First Last>"; `location.share.stopped`
out "Stopped sharing your location with <First Last>", in "Stopped
receiving <First Last>'s location"; `location.share.received` "<First
Last> started sharing their location"; `location.share.ended` in
"<First Last>'s location share ended", out "<First Last> stopped
receiving your location"; `location.requested` out "Asked <First
Last> for their location", in "<First Last> asked for your location";
`location.history.deleted` "Location history deleted ({n}
positions)"; `location.history.shared` / `.received` "Location
history sent to / received from <First Last>"; `drop.location`,
`drop.location_rate`, `drop.location_malformed`,
`drop.location_limit` (category Blocked and dropped) "Location from
<First Last> dropped". History never shows a position.

**Texts (drafts).**

| Where | Text |
|---|---|
| Share sheet, precision note | "Approximate and City show the centre of a fixed area. If you move across an area's edge, {First} may see that you were near it." |
| Share sheet, trail | "Let {First} keep the trail" / "Without this, {First} sees only your latest position." |
| Started | "Sharing your location with {First} until {time}." |
| Ongoing notification | "Sharing your location with {First} until {time}" / "with {n} people"; action "Stop all" |
| Paused (due or held) | "Paused until your daily check." |
| Resumed | "Sharing your location with {First} again, until {time}." |
| Request | "{First} asks where you are"; "Share once", "Share for a while…", "Not now" |
| Ask, limit | "You asked {First} a few minutes ago. You can ask again in {n} minutes." |
| Incoming card | "{First}'s location · {age} · within {accuracy}" / "Until {time}" |
| Open in maps | "This hands the position to another app." |
| Permission | "To share your location, VettID needs to know where this phone is. It asks only while you share, and sends nothing to anyone else." |
| Exact unavailable | "Exact needs precise location in Android settings." |

**Tests.**

- Unit: the share sheet's bounds (once has no duration or interval;
  5 minutes to 7 days; 10 s to 1 hour); the app's timer ends a share at
  `expires_at`; cadence takes the shortest interval; optional members
  sent only for exact shares; a fix older than 5 minutes not sent;
  pause and resume around due, held and lock; resume after a process
  restart from the stored `share_id`s; no position in any persisted
  type (a check over the stored settings' schema).
- **Privacy, data directory scan:** after sharing both ways for some
  minutes with the trail and a snapshot, lock and scan the app's files,
  databases, caches and `no_backup`: no coordinate of the test route
  in text or binary form.
- Instrumented, dev stack: two vaults; once, continuous, stop from
  either side, a new share replacing the old, a request answered by a
  share, `limit` on a second request, the incoming share ended at
  expiry.
- Phone test, staging: Pixel 10 Pro (GrapheneOS, no Google location)
  and Pixel 7 (stock); a continuous share for 30 minutes with the
  screen off on each; a once share indoors; the approximate position
  shown at its area's centre; Stop from the notification; permission
  refused and approximate-only.

**PRs.** L1: sharing (sheet, service, notification), receiving
without a map, requests in Approvals, Location screen, History and
feed labels. L2: the map, per question 25. L3: the member's own log,
only after question 26.

#### Video in calls (C4)

*Short by design: the detail belongs to the calls sections of this
plan that CALLS-PLAN §6.6 still asks for. C4 depends on the calling
service (C2) and ringing with the app closed (C3), and needs the vault
release with `call.update` (V7, not yet in VAULT-MESSAGING §10.10).*

On top of voice calls, C4 adds:

- **The camera**: `call.start{media: "video"}`, the front camera first,
  VP8 always and H.264 through the phone's hardware codec only, VP9 and
  AV1 off (CALLS-PLAN §4); frame encryption covers the video track as
  it does audio; the "one audio section" rule of VAULT-MESSAGING §10.10
  is replaced by C4's own text before any video SDP is accepted.
- **Switching** between the front and rear camera, camera off and on,
  and a small self-view.
- **Adding or dropping video** in a voice call, and **a network change**
  (Wi-Fi to mobile data) without dropping the call: both are a new
  offer and answer inside the call, `call.update` (V7).
- The `CAMERA` permission at the first video call ("To show your face
  in a call, VettID needs the camera. It's used only while you're in a
  video call."), the camera in the call's foreground service, and the
  in-call screen's video states of CALLS-PLAN §6.4.
- The exit test of CALLS-PLAN §7: video both ways for 10 minutes, and a
  walk from Wi-Fi to mobile data without the call dropping.

#### Questions and vault follow-ups (0.1.42)

Read in vettid-vault at `2c3fe13`. None blocks W0, W1 or P1; the app
works around each as written above until it is answered. None of them
changes vault code here.

1. **The test network** (question 16). `testnet` covers testnet3 and
   testnet4 (`vms/btc/account.go:20`), so a wallet does not say which
   chain it is on. Proposed: accept `testnet4` as a `network` name.
2. **Every `invalid_psbt` reason.** §10.18 lists eight and "…"; the
   code has 24 (`vms/btc/psbt.go`, `refuse(…)` calls;
   `features/wallet/wallet.go:1231` `payee_network`; `psbt.go:339`
   `wrong_seed`). Proposed: list them all in §10.18, so that apps can
   give each a text.
3. **Output addresses and the network.** §10.18 says every output is
   "a standard address … of the wallet's network", but an output is a
   script: the vault re-encodes it for the wallet's network
   (`vms/btc/psbt.go:240-244`), so a mainnet address pasted into a test
   wallet is shown as a test address. The app checks the network
   itself and compares; proposed: say so in §10.18.
4. **`wallet.address.used` marks only issued addresses**
   (`features/wallet/wallet.go:847-852`); an address the app derived
   and the vault never issued is ignored without an error. Proposed:
   say so, or return the addresses not found.
5. **No way to move an imported wallet's indices.** The vault issues
   addresses only in order (`wallet.go:675-697`), so after an import the
   app must call `wallet.address.new` once per used index to avoid
   handing out a used address again. Proposed: `wallet.update` with
   `next_receive`/`next_change` per account (only forward).
6. **`<wallet>` has no tags** (`wallet.go:586-602`): the app reads them
   from the item. Minor.
7. **No "backed up" mark.** The vault does not record that the member
   confirmed the phrase, so another phone (a transfer, a recovery)
   asks again. Proposed: leave it to the app, or a boolean on the
   wallet; owner's choice, not needed for W1.
8. **Presence's `last_active` counts background traffic.** It is the
   newest non-ephemeral message from any of the member's apps and
   desktops (`vault/inbound.go:428-430`, `vault/host.go:181-189`), so the
   on-phone service's catch-ups make a member look active who was not.
   Proposed: count only messages the member caused (or a foreground
   flag from the app), or say in §10.17 what it means.
9. **A share's expiry is not told to the source device**
   (`features/location/location.go:236-243`: the sweep runs only when a
   message is handled and sends a `sync.event` then). The app keeps its
   own timer; proposed: say so in §10.16.
10. **Stopping a share while due or held.** The hold's allow list has no
    `location.*` type (`vault/ownercheck.go:503-518`), so the member
    cannot stop disclosing their location until they pass the check
    (positions do not flow meanwhile). Proposed: allow
    `location.share.stop` in the hold, as `vault.lock` is: stopping a
    disclosure should always be possible.
11. **Answered location requests stay pending on other devices.** A
    share that answers a request closes it silently
    (`location.go:317-319`); there is no event or list of pending
    requests (`location.go:530-561`). Proposed: a `sync.event` when a
    request closes, and its feed item marked read.
12. **Presence `last_active` in the future.** §10.17: the asking vault
    accepts a pong only with `last_active` not in the future; the code
    allows 5 minutes (`features/presence/presence.go:412`). Proposed: say
    the tolerance in §10.17.
13. **Removing a connection edits the presence policy without a new
    version** (`presence.go:427-435`): an app holding the old version
    can still `presence.set` with it. Harmless (an unknown id in
    `except` does nothing), but §10.1's versioning says otherwise.
    Proposed: bump the version and send `presence.changed`.

## 5. Architecture

Multi-module Gradle, Kotlin, Jetpack Compose + Material3, Hilt, coroutines
and Flow, Room (encrypted with a Keystore-held key) for local caches,
DataStore for preferences, OkHttp for HTTP, strings in resources from day
one (translation-ready), accessibility labels required in review.

| Module | Contents |
|---|---|
| `:core:crypto` | Suite 2 (HPKE MLKEM768X25519 / HKDF-SHA256 / ChaCha20-Poly1305), XChaCha20 sessions, Ed25519, Argon2id; envelope v2; handshake and epochs; credential UTK/reply-key sealing; (0.1.39) the §5.5 blob seal and open. **Must pass the vettid-vault test vectors byte for byte.** |
| `:core:media` | (0.1.39) Photos in memory: picker and camera input, bounds, orientation, downscale, JPEG without metadata, thumbnails, type sniffing, bounded decoding (§4 "Photo attachments") |
| `:core:keystore` | Android Keystore keys (device identity, relay key wrapping, device attestation key with StrongBox/TEE, the biometric-gated app-data key; 0.1.40, release R: the phone key, an HMAC key that computes the unlock secret) |
| `:core:attestation` | Ported Nitro attestation + PCR manifest verification; Android key attestation for enrollment/unlock (§11.7) |
| `:core:relay` | Relay client (RELAY-PROTOCOL 0.6): register, signed requests, tokens, deposit, collect (long-poll / WebSocket), ack, claims, blobs |
| `:core:altchan` | Member-API alternate channel: code redeem and recovery claim, requests signed by the app key (no member session), descriptors, sealed enroll/unlock/lock, result polling, release-update approval |
| `:core:vault` | Typed vault client: one function per §10 type, sessions with the vault, dedupe, outbox, sync events → repositories |
| `:core:data` | Repositories and Room caches per feature |
| `:core:notify` | 0.1.23: the notification modes: the on-phone service (`VaultConnectionService`), channels, the Mapping and Content rules, the `PushProvider` interface; `:core:push-fcm` the FCM provider (the only module with Firebase; 0.1.34: in the `full` distribution only, `foss` binds a provider that reports "not in this build") |
| `:core:ui` | Theme (navy + gold, light/dark), components (top bar, drawer, list row, empty state, pill bar, settings cards, sheets) |
| `:core:chain` | (0.1.42) The wallet's chain source: the Esplora client, the per-network server setting and its genesis check, the Bitcoin library chosen in W0 (descriptors, PSBT building, coin selection); no Google code (§4 "Wallet, presence, location and video") |
| `:core:location` | (0.1.42) Positions from the platform's `LocationManager` (no Play services), the `location` foreground service and its ongoing notification, the share timers; no storage of positions |
| `:feature:*` | onboarding, messages, connections, approvals, items (the "Vault" screens), credential, settings, history (0.1.11), notifications (0.1.23, the feed); 0.1.42: wallet, location (presence lives in connections and settings) |
| `:app` | Navigation (type-safe routes), DI wiring, notifications |

Rules: features depend only on `:core:*`; no feature touches transport or
crypto directly; one ViewModel per screen with immutable UI state.

**Build types and application ids** (0.1.35; STAGING-DEVELOPMENT-PLAN
D5).

| Build type | Application id | Launcher label |
|---|---|---|
| `release` | `com.vettid.app` | VettID |
| `staging` | `com.vettid.app.staging` (0.1.35; it was `com.vettid.app`) | VettID Staging |
| `debug` | `com.vettid.app.dev` | VettID Dev |
| `devStack` | `com.vettid.app.devstack` | VettID Dev Stack |

The staging build gets `applicationIdSuffix ".staging"` with the build
that goes with staging release S10, whose images accept exactly that
package in key attestation (VAULT-MESSAGING 0.26.0 §11.10.8, which also
lists what follows the package and how an existing staging vault moves
to the new build: Android treats it as another app, so nothing is
carried over by an update). The label and the signing key do not
change. From then on the production and staging apps install side by
side on one phone. `checkStagingApk` asserts the id; the staging
manifest's App Link host (`account.staging.vettid.org`) is verified once
that site's `assetlinks.json` names the new package; the app's
`push.register` `app_id` is its application id and follows by itself.
The staging id is never published to a store.

(0.1.37, as built in vettid-android #116.) **App Link hosts per
build.** Each build claims one account host for the same-device setup
link (`https://<host>/vault/enroll/…`, verified): the `staging` build
`account.staging.vettid.org` **only** (until #116 it claimed
`account.vettid.org` as well, which a build with another package and
signer could never verify), every other build `account.vettid.org`
(`debug` and `devStack` claim it too and are in no `assetlinks.json`,
so there it stays an unverified link). `https://relay.vettid.org/connect`
(verified where the relay's `assetlinks.json` names the build) and
`vettid://connect` are claimed by every build, so on a phone with the
production and the staging app Android asks which one opens an
invitation (VAULT-MESSAGING §11.10.8, "What follows the package").
`checkReleaseApk` and `checkStagingApk` fail on the other
environment's account host as on its application id.

(0.1.37) **Moving a vault to the staging id on the same phone.** The
old and the new staging build are two apps on one phone, and a direct
transfer between them needs no second phone: the old app's transfer
screen shows, under the QR, "Or paste this code on the new phone" with
**Copy**; the new app's transfer-in screen has **Paste the code
instead**; then approve in the old app with the PIN and the
credential password. Done by the owner on 2026-10-11; it is the
simplest of the paths in VAULT-MESSAGING §11.10.8 ("Moving the
existing staging vaults"), and it binds the vault to the new app's
signer (§7).

## 6. Phases

| Phase | Contents | Exit |
|---|---|---|
| A0 | Spec + this plan approved; old code tagged and moved off `main`; empty multi-module skeleton, CI (build, unit tests, lint, detekt), theme and component gallery screen | CI green; component gallery matches the design language on a phone |
| A1 | `:core:crypto` + vectors; `:core:keystore`; `:core:attestation` port | All vettid-vault vectors pass (incl. MLKEM768X25519 HPKE interop) |
| A2 | `:core:relay` + `:core:altchan` + `:core:vault` against a local dev stack (vettid-vault integration stack: relay + parent + dev enclave + member-API stand-in) | Instrumented test enrolls, unlocks, exchanges a message with a `vaultctl` peer |
| A3 | Onboarding, unlock, credential, settings screens (with the account card, 0.1.11), biometric app lock; History (0.1.11), once the vault release with VAULT-MESSAGING 0.20.0's search is in staging; History export (0.1.17), once a release with 0.22.0's `audit.export` is | Fresh install → enrolled vault with credential on a real phone (dev stack) |
| A4 | Connections, messages, approvals | Invite/QR connect, SAS, messages both ways, approvals |
| A5 | Items (data, secret, critical), tags, share rules, grants and critical-item approvals | Flows against the dev stack and a second vault |
| A6 | Hardening and polish: accessibility pass, notifications (0.1.23: the Notifications screen and N1 below), offline behaviour, error states, Play pre-launch report | Internal testing track build |
| N1–N4 | 0.1.23, notification modes (§4 Notification modes, 10): N1 app (setting, channels, on-phone service, FCM stubbed); N2 spec (`push.register`); N3 vault (push ops, wakes); N4 gateway with FCM credentials, then FCM on | N1: notifications in the background on both test phones without Google; N4: FCM wakes on the Pixel 7 |

Calls, devices/agents/LEASH, wallet, location and presence follow v1 in
that order, each as its own phase. 0.1.42 (D8, owner 2026-10-17): of the
last three, the order is **wallet (W0–W2), presence (P1), location
(L1–L3)**; video (C4) follows the calling service and ringing (C2, C3).
Their PRs are listed in §4 "Wallet, presence, location and video".

**Owner check** (VAULT-MESSAGING 0.13.0 §3.6, owner decisions of
2026-10-05). The vault holds when the member has not given the PIN and
the credential password together for 24 h (or the member's shorter
interval). Follow-ups, in A3 unless noted:

1. `:core:vault`: `vault.owner-check` (UTK-sealed `{pin, password}` with
   the blob; the new blob is stored and acked like any credential
   response), `vault.held`, `owner_check` in `vault.status`,
   `owner_check_required`, `vault.locking{reason: "owner_check"}`,
   `sync.event{owner_check}`, the `owner_check.*` feed kinds.
2. **One check screen**: PIN and password on one screen, sent together;
   both zeroized after the answer. Shows which entry was wrong, the
   checks left before the lock (10 − `failures`) and a running backoff,
   counted down from the `backoff` error's `retry_after` (VAULT-MESSAGING
   0.17.0 §10.1); the send button stays off until it ends.
3. **When to ask**: at the first app open or return to the foreground
   after the deadline, before any vault screen; never over an action in
   progress. A refused request keeps its input (drafts stay drafts) and
   the prompt follows when the member leaves the screen.
4. **Held screen**: no cached vault content (messages, items,
   connections, feed) while held; only the check, the `vault.held`
   counts ("3 new messages waiting") and the lock action. After the
   check, catch up (`sync.since`, `feed.list`, `message.list`).
5. **Early warning** (A6, with notifications): from 1 h before the
   deadline, a banner and a local notification with "check now".
6. **Locked and past the deadline**: one screen for PIN and password;
   unlock, read `vault.status`, then send the check without asking again.
7. **Settings**: the interval (1–24 h); shortening may hold the vault at
   once, so the app offers a check with the change.
   **Hold switch** (owner decision of 2026-10-06, §3.6.7): turning the
   hold off is part of a check (the same PIN-and-password screen, with
   `hold: false` and an optional end date up to 30 days ahead in the
   sealed payload) and comes with a plain warning of what it gives up;
   turning it on is a plain `settings.set`. While off: a persistent
   "hold is off" indicator (with the end date) on the main screens. The
   check is never dismissible: past the deadline the vault gates the app
   (`vault.status` `state: "due"`) exactly as when held, so the same
   check screen comes first; only desktops, agents, calls (which may
   ring, but the app answers only after the check) and presence keep
   running. Show `owner_check.hold_changed` feed items.
8. **Lock after ten failures**: show the locked state and the urgent
   feed item after the next unlock.
9. Tests: an injectable clock in the dev stack (vettid-vault) to drive a
   vault past its deadline; instrumented tests for the held screen, the
   check, a wrong PIN, a wrong password and the ten-failure lock.

**Location phase notes** (from vettid-dev `docs/plans/location-sharing-ux.md`,
input for when the location batch is specified in VAULT-MESSAGING): show a
shared location in three layers: an event when a connection **starts
sharing** with you (a feed item, once), a **glance** on the connection's row
(last-seen place and age), and **detail** on the connection screen (map with
accuracy and time). The viewer shows the latest location the vault cached
for that connection rather than tracking live, and offers a **request
location** action that asks the connection to share once. The vault
schema for the cache and the request verb belong to the location batch.

## 7. Dependencies on other work

- **Running vault**: v1 development uses the local dev stack; real devices
  need the V5 deployment (release pipeline, member API vault routes
  deployed, enrollment/recovery portal pages).
- **Push** (D7, owner 2026-10-09): three modes, the on-phone service
  (a foreground service that keeps the relay connection, PUSH-GATEWAY
  0.3.0 §11) the default and recommended, and the path for phones
  without Google services (for example GrapheneOS); Google push (FCM
  through the VettID push gateway) once the gateway, FCM credentials and
  VAULT-MESSAGING's `push.register` exist; and Off. No UnifiedPush
  (owner, 2026-10-09; replaces the "both paths" decision of 2026-10-03).
  Until the gateway is deployed (FCM needs credentials), v1 collects
  while the app is open and through the on-phone service.
- **Release notes** (0.1.31): What's new needs the release log on the
  build's channel: production's exists; staging's, and `log` text for
  every staging release, come with VAULT-RELEASES 0.1.10 (W11). Until
  then staging builds show "Release notes unavailable" with the link.
- **Membership**: enrollment requires an account.vettid.org member who has
  accepted the current terms; the portal checks it when it issues the
  setup code (MEMBER-API 2.0.0). The app itself never signs in.

### Signing and the two distributions (0.1.36; decided: option (a))

**Versions.** Both distributions of a release have the same
`versionCode` and `versionName`, and each release is a tag
`v<versionName>` on the commit that sets them (F-Droid's update check
reads them from the tag). The signed `foss` APK of a release is
published at a stable address (a release asset,
`vettid-<versionName>-foss.apk`), where F-Droid fetches it to compare
with its own build. The F-Droid metadata is a draft in vettid-android
(`docs/fdroid/com.vettid.app.yml`); nothing has been submitted.

**History of the decision.** 0.1.34 (2026-10-11) recorded the owner's
choice of option (b): VettID supplies its own app-signing key to Google
Play, so that Play, F-Droid and direct builds share one signer. The
same day the owner asked: "it feels like giving my key to google will
let them have access into my app if they chose to try and insert a
backdoor (it is open source code). if this is possible we need to
rethink the keys". It is possible, as set out below, and the owner
decided: "yeah, we need to go back to option a." **0.1.36 replaces (b)
with (a).** 0.1.34's argument for (b), "Google holds the key that signs
Play installs under either option, so (b) adds no party that can sign",
was true of Play installs and wrong about the others: under (b) the
key Google holds is also the key of every F-Droid and direct install.

**The two options.** The choice is made when the app is first enrolled
in Play App Signing and cannot be changed afterwards for that app.
Every statement about Play in this section is to confirm in the Play
Console at enrolment; nothing in this repository verifies it.

- **(a) Google generates the Play app-signing key and is the only
  holder of it.** VettID's own key signs the F-Droid APK and direct
  builds and is never given to Google. Two signers. **Decided.**
- **(b) VettID supplies its own app-signing key to Play.** One signer
  for every install, and Google holds a copy of it. Chosen in 0.1.34,
  withdrawn the same day.

**What Google can do, under either option.** With Play App Signing
(required for new apps on Google Play), Google holds the key that
signs what Play installs. Google can therefore sign a build that
differs from VettID's source and deliver it to Play installs as an
ordinary update. The vault would accept it: the vault checks the app's
signing certificate through key attestation (VAULT-MESSAGING §11.7),
not the app's contents, and a build signed with the same key has the
same certificate and keeps the installed app's keys. Such an app holds
the credential and sees the PIN and the credential password as they
are typed. This is inherent to distributing through Google Play; no
choice of key removes it, and VettID being open source does not: the
source shows what VettID built, not what Play delivered (below, "What
can be checked about a Play install").

**What differs between the options.** Android installs an update only
over an app with the same signing certificate (or one the old key
itself has signed over to, by key rotation, which only the holder of
the old key can do). This is the package manager's rule on an honest
operating system; a hostile operating system is outside what any app
signature can address.

- Under (b) the key Google holds is the key of every install. A build
  signed by Google could replace an F-Droid or direct install as well
  as a Play install. (b) removes the one group of members who do not
  depend on Google's signing.
- Under (a) Google's key signs only Play installs. Google does not
  hold VettID's key, so Android refuses anything Google signs as an
  update to an F-Droid or direct install. Those installs are out of
  Google's reach.

The cost of (a), which 0.1.34 weighed the other way: a member cannot
move between Google Play and F-Droid or direct by updating (below).
The owner accepts that cost.

**The keys.**

| Key | Who holds it | What it signs | Pinned by vaults |
|---|---|---|---|
| **VettID's release key** (certificate SHA-256 `31a19613aa10f209e08945f947f94f7ce3e6e5ac342457ff9969a67986928e65`; "the upload key" in documents before 0.1.36) | The owner, as a file (confirmed 2026-10-11), kept off line; never given to Google | The F-Droid APK (F-Droid's reproducible builds publish the VettID-signed APK) and direct builds | Yes, class `vettid`: already in `enclave/releasecfg/prod.json` (W10-READINESS P8), and the only signer of production release 1 |
| **Play app-signing key** | Google, which generates it at enrolment; VettID never has it | Everything Google Play installs | Not by release 1. Added, class `google_play`, by the production release cut when the Play listing is prepared (below) |
| **Play upload key** (new, made for this purpose only) | The owner | Only the app bundle uploaded to the Play Console | Never |

**The Play upload key is a dedicated key, not VettID's release key**
(owner decision, 2026-10-11).
The upload key authenticates an upload to Play. Play checks it and
re-signs with the app-signing key, so nothing a member installs is
signed by the upload key. Reusing the release key as the upload key
would not give Google the key (Google would see its certificate and
signatures made with it, both public anyway), and it would not let
Google sign for F-Droid or direct installs. It is still the wrong
choice, for three reasons:

1. The upload key is used in the routine of every Play release, on a
   machine that talks to the Play Console. The release key is the one
   key that every F-Droid and direct install and every production
   vault trusts; it should be used only to sign releases, off line.
   One key for both jobs puts the trusted key in the routine one's
   place.
2. An upload key that is lost or exposed can be replaced by asking
   Google to reset it (to confirm in the Play Console). A release key
   cannot be reset: every install signed with it would have to be
   replaced. If they are the same key, an incident in the upload
   routine is an incident with the release key.
3. Two certificates keep the Play Console unambiguous: its "upload
   certificate" is then a certificate that no vault pins, so it cannot
   be pinned by mistake for the app-signing certificate.

If the Play Console turns out to require something else at enrolment,
that is reported to the owner before enrolling; the release key is not
uploaded to Google in any form.

**F-Droid.** F-Droid publishes the VettID-signed APK only while its own
build reproduces it. If a version fails to reproduce, F-Droid publishes
nothing for it (to confirm against F-Droid's reproducible-build policy
when the app is submitted); an APK signed with F-Droid's own key would
be a third signer, which no vault pins.

**Moving between Google Play and F-Droid or direct.** It is never an
update. Android refuses to install one over the other, and removing
the app erases its keys. The member either transfers the vault to the
other version on a second phone (VAULT-MESSAGING §6.7.1; no wait) or
uninstalls, installs the other version and recovers the vault (24
hours, §11.11). Both need the PIN and the credential password, and
both rebind the vault to the new app's signer (VAULT-MESSAGING 0.27.0
§11.7.1). F-Droid and direct builds share a signer, so moving between
those two is an ordinary update (a `full` direct build updated by
F-Droid's `foss` build loses Google push, which the fallback rule
covers, §4 Notification modes, 4).

**What members are told** (one sentence each; the wording is the
requirement, approved by the owner 2026-10-11):

- **The app**, Settings → Vault, under the vault's status, from the
  app's own entry in `device.list` (`signer.class`, VAULT-MESSAGING
  0.27.0 §10.3): "Installed from: Google Play (signed by Google)" or
  "Installed from: F-Droid or direct (signed by VettID)" (class
  `development`: "Development build"; no line when the vault reports
  no signer). Tapping the line shows: "The Google Play version is
  signed by Google, so it trusts Google's signing; the F-Droid and
  direct versions are signed by VettID and do not. To change version,
  transfer your vault to the other version on another phone, or
  reinstall and recover it, which takes 24 hours."
- **The app, approving a transfer** to an app with another signer,
  before the PIN (§6.7.1, `device.transfer.pending.signer_changed`):
  "The new phone's VettID was installed from Google Play (signed by
  Google); this one is from F-Droid or direct (signed by VettID).
  Continue only if you installed it yourself." (or the reverse), with
  Continue and Cancel.
- **As built** (0.1.37; vettid-android #116; staging S10). The two
  sentences above are in the app as written. Where the specification
  gave no text, the app has its own, listed here so the owner can
  reword them (they are requirements only once approved):
  - **Where the line is.** A row of Settings → Vault status, not of
    the devices screen. Tapping it opens a card in place with the
    explanation above and "Signing certificate (SHA-256): …", the
    digest in groups of eight. For class `development` the whole row
    reads "Development build", without "Installed from:". No row
    while the vault is not open, has no recorded signer, or reports a
    class this build does not know.
  - **The transfer confirmation.** Title "The new phone has another
    version of VettID". The sentence is built from two halves, "The
    new phone's VettID *A*; this one *B*. Continue only if you
    installed it yourself.": *A* is "was installed from Google Play
    (signed by Google)", "was installed from F-Droid or direct (signed
    by VettID)", "is a development build" or, for a class the build
    does not know, "has a different signer"; *B* is "is from Google
    Play (signed by Google)", "is from F-Droid or direct (signed by
    VettID)", "is a development build" or "has another signer".
    **Continue** and **Cancel**; Cancel leads to the question whether
    to reject the transfer. The app then sends the new app's class as
    `signer` in the approval.
  - **`signer_unconfirmed`** (the vault asked for a confirmation the
    approval did not carry): "Your vault asked you to confirm the new
    phone's version of VettID first. Nothing was counted; enter your
    PIN and password again." The one-time key of that attempt goes
    back to the pool.
  - **`signer_refused` at unlock.** Title "This installation is not
    accepted"; body, VAULT-MESSAGING §11.7.1's message ("This vault no
    longer accepts this installation of VettID. Update the app, or
    recover your vault with a current version."); a button "How to
    recover your vault" opening "Recovering or moving your vault":
    update first and try again, the PIN was not counted as wrong;
    otherwise start a recovery on the account site and recover with a
    current version, on this phone after removing this one or on
    another phone (24 hours, the PIN and the credential password); and
    "Moving your vault to a new phone directly is not possible while
    this phone cannot open it." The PIN field is cleared and no
    backoff is shown. The same body text answers a refused update
    approval and a refused unlock during a recovery.
  - **History** (titles): `device.signer_bound` "Version of VettID
    recorded for this vault"; `device.signer_changed` "Vault moved to
    another version of VettID"; `device.signer_refused` "An
    installation of VettID was refused". Second line: the class
    ("F-Droid or direct (signed by VettID)", "Google Play (signed by
    Google)", "A development build"); "From *old* to *new*"; and for a
    refusal "This vault release does not accept its signer"
    (`unpinned`) or "No signer was recorded for it" (`unbound`). A
    class the build does not know reads "another signer".
  - **Feed and notification.** Only `device.signer_changed` is a feed
    kind (VAULT-MESSAGING §10.9): "Your vault moved to another version
    of VettID", "From *old* to *new*", opening Devices, notified in
    the Security channel. `device.signer_bound` and
    `device.signer_refused` are audit entries only and appear in
    History.
  - **The chain** (VAULT-MESSAGING §11.7.1, "Vaults enrolled before
    0.27.0"). The app sends its key's certificate chain with every
    unlock until it has seen a `signer` on its own `device.list`
    entry, which it reads after every unlock. It starts sending again
    after every new attestation (enrollment, a recovery's register, a
    transfer's handshake) and after an unlock answered
    `signer_refused`, since a host could have served an older header.
    A `signer` it cannot read (a class it does not know, a malformed
    digest) counts as bound, and no row is shown. The chain is left
    out, and the unlock sent without it, when Android Keystore returns
    none, when it has more than 10 certificates or one above 16 KiB,
    or when the request would not fit its 12,288 bytes with it. It is
    not part of what the unlock signature covers.
- **The account site**, where it links to the Android app: "The Google
  Play version is signed by Google and trusts Google's signing; the
  F-Droid and direct versions are signed by VettID and do not, and
  moving between them means transferring or recovering your vault, not
  updating."
- **The Google Play listing**: "This version is signed by Google
  through Play App Signing; a version signed only by VettID is on
  F-Droid and vettid.org, and moving to it means transferring or
  recovering your vault."
- **The F-Droid listing and the direct download page**: "Signed by
  VettID from a reproducible build; it cannot update, or be updated
  by, the Google Play version, so moving between them means
  transferring or recovering your vault."

**Production release 1 pins only VettID's release key.** Release 1 is
for the owner and at most ten named testers (STAGING-DEVELOPMENT-PLAN
D7), who install the direct or F-Droid build. Its `android_signers` is
the one existing digest; the `TODO-O8` placeholder is removed, not
filled in; release 1 does not wait for the Google Play account
(W10-READINESS P9, P30, B4; VAULT-RELEASES O8).

**The Play certificate comes with a later release.** When the owner
has a Play account and enrols the app, Play shows the app-signing
certificate's SHA-256 (to confirm in the Play Console), and the next
production vault release pins it with class `google_play`. Until a
release that pins it is `active`, an app installed from Google Play
cannot enroll, receive a transfer or register for a recovery (the
vault refuses its attestation). So **the Play listing does not go live, on any
track that members can install from, before such a release is
active**; the same digest is added to the App Links document
(RELAY-PROTOCOL, "The Play app-signing key will be added when it
exists"). Per-vault signer binding (VAULT-MESSAGING 0.27.0 §11.7.1) is
in the release that first pins the Play certificate at the latest;
decided (owner, 2026-10-11): in release 1 already, so that no
production vault ever exists unbound.

**What can be checked about a Play install.** The F-Droid and direct
APKs can be compared with a build from source by anyone, byte for
byte apart from the signature: that is what reproducible builds give.
A Play install is different in kind:

- VettID uploads an app bundle; Play generates the APKs a phone
  receives from it (split by device configuration) and signs them with
  the key Google holds (to confirm in the Play Console). The files on
  a member's phone are therefore not the files VettID built, and they
  differ from phone to phone.
- What can be compared: the installed APKs can be pulled from a phone
  (`adb shell pm path`, `adb pull`) and their code and resources
  compared with the same version's reproducible build. It is a manual
  comparison of contents, not a byte comparison of files, and no tool
  for it exists in this project.
- What cannot be established: that every phone received the same
  thing. A build delivered to one account or one device would be seen
  only by someone who inspects that device. Nothing on the phone and
  nothing in the vault detects it: the signature is valid, and
  attestation reports the certificate, not the contents.
- **To evaluate, not a rule:** Google Play's "code transparency for
  app bundles", described as a transparency file signed with a key the
  developer holds, added to the bundle and verifiable with
  `bundletool` against the delivered APKs, and not enforced by
  Android. To verify against Google's current documentation: whether
  it still exists, what it covers (code only, or resources too), and
  whether a check could run inside the app or only from outside it. A
  check an altered app performs on itself proves nothing, so its value
  would be for outside inspection. Listed as a follow-up (§9 question
  15); nothing here depends on it.

The honest summary for members is the sentence the listings carry: the
Google Play version trusts Google's signing, and the F-Droid and direct
versions do not.

## 8. Risks

1. **Post-quantum crypto on Android**: Android has no platform ML-KEM; the
   suite needs BouncyCastle (or another library) supporting HPKE with
   MLKEM768X25519 (codepoint 0x647a) — the cross-implementation vectors are
   an open follow-up in VAULT-MESSAGING §15. Verify early (A1); fall back to
   a small audited implementation only if no library fits.
2. **Scope creep from the old app**: v1 is deliberately small; resist
   porting screens without a v1 need.
3. **Device attestation in the field**: key attestation varies by vendor;
   test on several devices before release.
4. **Background delivery without push**: until the gateway exists,
   messages arrive while the app is open or through the foreground
   service; set expectations in the UI. 0.1.23: the service's
   `specialUse` type needs Play's approval of the declaration, and
   some vendors' battery managers stop foreground services regardless;
   the status line and "Allow in background" are the mitigation, and
   collection at every foreground keeps nothing from being lost.
5. **GrapheneOS and device attestation** (resolved): GrapheneOS reports
   its own verified-boot key (`SelfSigned`); VAULT-MESSAGING 0.9.0 §11.7
   accepts it when the key is one of the pinned GrapheneOS fingerprints.
   Staging accepted GrapheneOS attestation on real phones on 2026-10-05
   (Pixel 10 Pro and Pixel 9 Pro, verified boot yellow / `SelfSigned`).

## 9. Open questions

Min SDK, search and biometrics decided 2026-10-03. The Notifications
screen's questions (0.1.23) were answered by the owner on 2026-10-09;
of the notification modes' questions, 10 was answered otherwise on
2026-10-09 (0.1.24) and 11–14 were answered as recommended when the
owner approved 0.1.23 (#188) on 2026-10-09.

### Notifications screen (answered)

Owner, 2026-10-09: 1, 2 and 4–9 as recommended; 3 replaced by the
notification modes (D7, §4 Notification modes).

1. **Bell, drawer entry, or both?** **Answered: the bell only**, in the
   top bar of every drawer screen.
2. **Should deciding an ask mark its feed item read?** **Answered: yes,
   by the app** (kind and `ref`, through `feed.update`); 0.1.23 also
   marks `message.received` items read when their conversation opens.
3. **System notifications for feed items before push.** **Answered
   otherwise:** the owner wants notifications now, through a service on
   the phone, Google push, or off (not recommended). Feed items notify
   through the chosen mode (§4 Notification modes, Mapping).
4. **"Mark all as read" without a bulk type.** **Answered: one
   `feed.update` per item**, no protocol change.
5. **Delete in the main list?** **Answered: no**; archive there,
   delete only from Archived, confirmed.
6. **Releases in the Notifications list?** **Answered: no**; the
   banner and the "Vault updates" channel carry them.
7. **Reading the whole feed, and retention drops.** **Answered: no
   protocol change**; the app drops items past retention itself, and a
   VAULT-MESSAGING 0.23.x erratum states that dropped items appear as
   `deleted` and that deleted entries are kept no longer than
   `feed.retention_days`.
8. **A setting for `feed.retention_days`?** **Answered: not now.**
9. **Kinds with no screen in v1.** **Answered: list them** with the
   "Not available in this version of the app" sheet.

### Open questions for the owner (notification modes)

Each with the recommended answer.

10. **UnifiedPush.** **Answered otherwise: no UnifiedPush** (owner,
    2026-10-09: "we're not doing unified push. the vettid service is
    our solution. and apps connected to vettid get to use our
    notification channel"). No fourth mode; the on-phone service is the
    path for phones without Google. The push gateway stays, for FCM and
    APNs; PUSH-GATEWAY 0.3.0 drops `unifiedpush` and "both paths".
11. **Foreground-service type.** **Answered (2026-10-09): `specialUse`** with the
    Play Console declaration (above); fall back to `remoteMessaging`
    only if Play refuses it, and never `dataSync` (6 hours a day on
    Android 15, no start from boot). Approve submitting the
    declaration and its video with the first build that has the
    service.
12. **FCM at build time.** **Answered (2026-10-09): one build**, Firebase
    initialised at runtime from Gradle properties (no
    `google-services.json`, no plugin), "not available yet" without
    them; a `foss` flavour without the Firebase library only if VettID
    is published on F-Droid. **Replaced (2026-10-11): two
    distributions.** `full` (Google Play and VettID's own releases)
    links Firebase Messaging as before; `foss` (F-Droid) contains no
    Google code. Same application id and version for both; F-Droid
    publishes the VettID-signed APK through reproducible builds (§4
    Notification modes, 4; §7).
13. **Default for existing installs.** **Answered (2026-10-09): the on-phone
    service for every install**, new and updated (the app has no other
    background path today), with POST_NOTIFICATIONS asked at the next
    open and a one-time note "VettID now notifies you in the
    background. Change this in Settings → Notifications".
14. **Notifications while the vault is locked.** A locked vault sends
    nothing (VAULT-MESSAGING §12.1, §14: "a 'vault locked, messages
    waiting' prompt would need a wake path that does not depend on the
    DEK"). **Answered (2026-10-09): accept it for now**: the app says "Vault
    locked: notifications resume after you unlock it" (status read
    from the member API at most hourly); a DEK-free "messages waiting"
    signal stays the separate future decision §14 names.
15. **The key that signs Play installs** (0.1.34; **answered
    2026-10-11: VettID's own key, option (b); replaced the same day by
    option (a)**, 0.1.36). The question was: let Google generate the
    Play app-signing key, or supply VettID's own at enrolment so that
    Google Play and F-Droid installs share a signer and members can
    move between them without uninstalling? 0.1.34 recommended, and
    the owner first chose, VettID's own key. The owner then asked
    whether giving the key to Google would let Google insert a
    backdoor, and on the answer (yes: under (b) a build signed by
    Google could replace F-Droid and direct installs too, not only
    Play installs) decided: "yeah, we need to go back to option a."
    **Answer: (a).** Google generates and holds the Play app-signing
    key; VettID's release key signs the F-Droid and direct builds and
    is never given to Google; a dedicated upload key authenticates
    uploads to Play; moving between Google Play and F-Droid or direct
    is a transfer or a recovery, never an update (§7 Signing and the
    two distributions). Follow-ups, none blocking: evaluate Google
    Play's code transparency for app bundles (to verify against
    Google's current documentation); a documented procedure for
    comparing a Play install's contents with the reproducible build.

### Open questions for the owner (wallet, presence, location; 0.1.42)

Owner, 2026-10-17: 16–27 as recommended.

Each with the recommended answer first. D8 (2026-10-17) already
decided the order, the staging networks and that the chain source is
the member's; these are the choices it left open (§4 "Wallet,
presence, location and video").

16. **How the app knows a `testnet` wallet is on testnet4.**
    **Recommended: a vault field** (the vault accepts `network:
    "testnet4"`, a small fix in the next staging release), **and an
    app-side label until then**, with "Which test network is this
    wallet on?" on a phone that lacks it. Not a wallet tag: the member
    can remove or merge tags, and they drive sharing.
17. **Default chain servers.** **Recommended: mempool.space's Esplora**
    for signet (`https://mempool.space/signet/api`) and testnet4
    (`https://mempool.space/testnet4/api`); the mainnet default is
    decided with the production approval.
18. **The member's own server.** **Recommended: an Esplora URL in W1**
    (`https` only, checked against the network's genesis block);
    **Electrum later**, after W2, if members ask; no proxy or Tor
    setting in these phases.
19. **The Bitcoin library.** **Recommended: BDK (`bdk-android`)** if
    the W0 spike shows that its PSBTs pass the vault's policy (the full
    previous transaction on every input, taproot included; both
    accounts in one PSBT) and that the `foss` build stays reproducible
    with it; ACINQ's bitcoin-kmp otherwise.
20. **Receiving before the phrase is backed up.** **Recommended: no.**
    A new wallet shows no receive address until its phrase has been
    written down and checked (three words); the member may leave and
    come back, and the wallet says "Not backed up" until then. An
    imported wallet counts as backed up.
21. **Showing the phrase again.** **Recommended: yes**, from the
    wallet's ⋯ → Show recovery phrase, with the password each time
    (`item.reveal`, audited and in the feed).
22. **Presence on the Connections list.** **Recommended: no**; only on
    a connection's page and in the conversation, asked when they open.
    A list would ping every connection each time it is shown.
23. **Presence the first time.** The vault's default answers every
    connection with "Available". **Recommended: a one-time card** asking
    "Let your connections see when you're around?" with **Share with
    everyone** and **Not now** (which sets "No one").
24. **Location permissions.** **Recommended: foreground only** in L1
    and L2: while-in-use location, and a `location` foreground service
    started by the member's tap, which keeps sharing with the screen
    off; **no `ACCESS_BACKGROUND_LOCATION`**, so no Play
    background-location review (the foreground-service declaration
    only). The cost: shares start only from the app and do not restart
    by themselves after a reboot. F-Droid has no rule against either.
    Background location only if L3 (question 26) is wanted, as its own
    decision.
25. **A map.** **Recommended: no map in L1** (the position as text,
    its age and accuracy, the distance from this phone, and "Open in
    maps app" after a warning); **in L2 an embedded map** (MapLibre,
    no Google code) whose tile server the member can set, with a
    default to be chosen then and the same kind of privacy note as the
    chain server (a tile server learns which area is being looked at).
26. **The member's own location log.** **Recommended: not now**; L3
    only when members ask, and only with background location
    (question 24).
27. **A connection's location request.** **Recommended: in Approvals**,
    as the ask it is (VAULT-MESSAGING §10.4.1), with Share once, Share
    for a while and Not now; no answer is sent for Not now.
