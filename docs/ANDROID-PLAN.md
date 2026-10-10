---
title: ANDROID-PLAN
status: draft
version: 0.1.31
date: 2026-10-10
changelog:
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
| Conversation | Message detail | Bubbles in a card list; pill actions (reply, more). Links in a message (0.1.29, VAULT-MESSAGING 0.24.0 §10.5): only `https://` URLs are tappable; a tap asks "Open link to <host>?" and then hands the URL to Android, so a verified App Link opens its app and any other link the browser; every other scheme, custom app schemes included, stays plain text |
| Connections | Contacts | Initial tiles, status (pending / active / stale / blocked); a star marks favourites (the owner's `favorite` flag, `connection.update`), whose tiles are teal; the floating action button invites a connection (0.1.11: QR or link, or scan the other's QR), the only invite entry point besides empty states. Each is titled "First Last" from the profile's core (VAULT-MESSAGING 0.18.0 §10.8), the display name, if any, as secondary text. Incoming requests show the requester's names the same way. Only between activation and the first `profile.update`, when the request's names are not at hand: "Name not shared yet"; never "Unnamed connection" |
| Connection detail | — | Titled "First Last" (never an alias), the display name secondary. Profile shared with you (the names labelled as the name on their VettID account, never "verified"; display name, photo and items labelled as shared by them), sharing both ways ("You share with <First>": every share rule a row with its own settings, opening its editor or deleted after a confirmation, "Add a rule" up to 64, 0.1.20), a connection's requests (0.1.22, VAULT-MESSAGING 0.23.0 §10.4.1: muted, paused after several declines, declined ones in cooldown, with Mute/Unmute, Resume and "Allow declined requests again"), authenticate, the vault key fingerprint (`ik`, 8 groups of 4 hex digits, §10.8: the lasting identity check). The action bar: message, favourite, History, remove (confirmed). No safety code (it belongs to connecting: the invite and request screens), no alias or notes, no edit or block (0.1.13; blocking stays on an incoming request) |
| Approvals | — (VettID-specific) | Pending connection requests, grant requests, critical-item uses, share-rule decisions; approve/deny; critical items need the credential password. 0.1.22: a connection's asks within 10 minutes are one entry ("Sam asks for 3 things"), a connection whose asks are paused is a notice (resume, or remove the connection), a share question names the rule that asks first and warns when declining stops an item already shared, one question per item and connection |
| Vault | Folder list | Titled "Vault" (0.1.11; was "Items"). Items per VAULT-ITEMS: name, category, typed fields, tags, sensitivity (data / secret / critical); filter by tag (0.1.21: "✕ Clear" ends the filter chips while a filter is on); each tag in its own colour (0.1.21), stored in the vault's tag registry and the same on every device, the least-used of a palette of ten for a new tag, picked by the member on Manage tags (0.1.25; `@profile` always gold); add/edit from templates ("Save item" in the top bar, 0.1.21); share rules by tag, as many per connection as needed (up to 64), each with its own tags, mode (default: ask each time), fetch limit and end (presets or a custom date and time), overlaps shown (0.1.20); one tag per rule, per-hour and per-day limits, `ask` wins, rules named by their tags, "Save rule" in the top bar (0.1.22). Critical items live in the Protean Credential and are never shared by a rule |
| History | — (VettID-specific) | The member's audit log (0.1.11, `audit.list`, VAULT-MESSAGING 0.20.0 §10.9), read-only: a search field (the vault searches, `q`), filter chips (category, connection, date range), a list of entries newest first with infinite scroll, and an entry detail, each entry's icon in its category's colour (0.1.22); a ⋯ menu with **Export…** (0.1.17: CSV or JSON of what the filters show, with the vault PIN, saved through "Save to…"). Details below |
| Notifications | — (Proton has none; a bell as in most apps) | 0.1.23 (owner answers of 2026-10-09): the vault's feed (VAULT-MESSAGING §10.9), opened from the bell in the top bar with the unread count; grouped by day, urgent items first, unread and read, swipe to archive or to mark read, an Archived view; each item opens the screen it is about; system notifications through the member's notification mode (D7). Details below |
| Credential | — | Reached from Settings → Security → Credential (0.1.11; not in the drawer). Critical items inside the Protean Credential; unlock window; password change; the vault-held credential copy (the backup) on/off. Turning it off shows VAULT-MESSAGING §3.5.6's warning and needs a confirmation: "If this phone is lost, broken, reset or replaced without a transfer, your vault **cannot be recovered**. It can only be deleted and replaced by a new one, and **everything in it is lost**." While off, the screen and Settings keep a short "no recovery" notice. Turning it on asks for the password at once (an owner check) so that the copy exists, and says recovery is possible from then on |
| Settings | Settings | At the top, an **account card** (0.1.11): the member's first and last name and full email address (`account.get`, VAULT-MESSAGING 0.20.0 §11.13) and the membership state; tapping it opens the avatar sheet. Vault (status, release, lock, PIN; "Update available" while a newer release can be approved, 0.1.19); Security (credential, recovery, attestation info, the app lock (0.1.19: Biometrics or Phone screen lock) and timeout, the owner-check interval 1–24 h and the hold switch); Privacy (the **Shared profile**, glyph `Badge`, 0.1.12: display name, `@profile` items and the profile photo, **camera only** — "Take a photo" / "Retake photo" opens the app's own camera screen, front camera first with a switch to the rear one, then "Retake" or "Use photo"; no selection of an existing picture and no other camera app; the shot stays in memory, is never saved to the gallery, and is cropped, scaled and re-encoded to a JPEG ≤ 65,536 bytes without EXIF before `profile.set{photo}`; "Remove photo" confirmed; a refused camera permission is explained, with the system settings once Android no longer asks; a phone without a camera is told); App (theme; **Notifications** (0.1.23): the mode, its status, previews and the channels, §4 Notification modes; the local "Vault updates" channel, 0.1.19) |
| Owner check | — (VettID-specific) | One screen: PIN and credential password together (VAULT-MESSAGING §3.6.5); also the "vault held" screen with the waiting counts and the lock action |
| Avatar sheet | Account sheet | The member's first and last name and **full email address** (0.1.11, from `account.get`'s snapshot `first_name`, `last_name` and `email`, VAULT-MESSAGING 0.20.0 §11.13; never the masked hint), the email labelled "Only you see this address" and the names "Your connections see this name"; **Lock vault first** (0.1.12), right under the name and email, before Change name, Shared profile and the email; the sheet scrolls; vault status; **Change name** (0.1.10): the two names (the registration rule: letters, spaces, `'’.-`, ≤ 40), then the owner-check screen's PIN and password, sent as `account.name.set`; then "Name change requested" until `account.get`'s `name_request` is `applied` or `refused`; `too_soon` (from the vault or the member API): "You can change your name once every 30 days. You can change it again on <date>" (VAULT-MESSAGING §10.8), membership and subscription (read-only, from the vault, VAULT-MESSAGING §11.13), open account portal (browser) |
| Recovery (new phone) | — (VettID-specific) | Only with the backup on: scan the portal's recovery QR → claim (`email_hint`) → register → PIN → credential password → the app replaces the old one. No other path: 0.1.6's backup-off choice (new credential or delete) is removed. `no_backup` at register or unlock (a vault whose backup is off): "This vault cannot be recovered: its credential backup was off. Delete it on the account site and start over with a new setup code", with a link to the portal's start-over page (MEMBER-API 2.1.0) and then to onboarding |
| Pending deletion | — | When `GET /api/vault/status` shows `deletion` (a start-over requested on the portal, VAULT-MESSAGING §11.11.9): an urgent banner with the time left and **Cancel deletion** (`POST /api/vault/deletion/cancel {deletion_id}`, signed by the app key, with the `deletion_id` from the status's `deletion: {deletion_id, state, deletes_at}`, MEMBER-API 2.1.1) |
| Vault update | — (VettID-specific) | 0.1.19 (owner decision of 2026-10-09). **Banner** at the top of the shell while the trusted manifest lists an `active` release newer than the vault's: "A new vault release is available (release N)" with Update now and a close button (back after 24 h; a newer release or a change to the end-date warning shows at once), or, for a `retired` release or a `deprecated` one with an `ends_at`, the urgent "Your vault's release ends on <date>. Update now to keep your vault" (also back after 24 h). The offer is read from the manifest at app start, on return to the foreground and after every unlock (no other polling). **Notification**: one local notification per release on the "Vault updates" channel, its tap opens the update screen; the POST_NOTIFICATIONS permission is asked once, when the first banner shows. **Update screen** (banner, notification, Settings → Vault → "Update available"): the release number, the PCR0 fingerprint, "Anyone can rebuild it and compare the fingerprint", the release notes, the vault PIN and **Approve and update** (no credential password: the owner check, when due, comes first through the shell's gate). Then, over every screen: lock → the unlock with the approved `release_update` (built as at the unlock screen) → `update: moved` → the unlock that reaches N+1 with the same PIN ("Updating your vault…", three steps; "Release N is starting. This can take a few minutes." while the API answers `503 release_starting`). Outcomes: done; refused (`target`, `downgrade`, `approval`, `seal_key`, `pending`, `write`, each explained; the vault stays on its release and is open); a wrong PIN or the backoff (the vault is locked, nothing moved; "Approve and update" again or "Unlock without updating"); N+1 does not open (try again, or **Return to release N**, confirmed, only while the move is unconfirmed). The PIN is held only while a step runs. The unlock screen's "Approve the update with this unlock" stays. 0.1.31: the update screen and the unlock offer open with **What's new in release N** (next row), above the fingerprint and the PIN; the bare "Release notes" link becomes that section's "Full release notes" |
| What's new | — (VettID-specific) | 0.1.31 (owner request 2026-10-10; RELEASE-UPDATES 0.3.0 §2, §5). **Where:** at the top of the update screen (reached from the banner's Update now, the notification and Settings → Vault → "Update available": every path to an update passes through it before **Approve and update**) and in the unlock screen's release offer, before "Approve the update with this unlock". There is no update path that skips it. **What:** the heading "What's new in release N"; the log entry's `summary`; its `changes` as a bulleted list; the security line ("No security fix", "Security fix: update recommended" or "Security fix: update urgently", the latter two followed by `security_text`); the label "From <host>" (vettid.org; staging builds staging.vettid.org) with "Release notes are information. What keeps your vault safe is the signed release list and the fingerprint below."; and **Full release notes**, which opens the manifest's `notes` URL in the browser. When the vault is more than one release behind, the summaries of the releases in between follow under "Also in earlier releases" (one line each, from the same `index.json`). **Source:** the channel's log `index.json` (VAULT-RELEASES §7), public and unsigned. The app fetches it only when the trusted manifest's (published or loaded canary) `notes` for release N is exactly `https://<host>/security/releases/<N>/` and `<host>` is the host of the build's pinned manifest URL (vettid.org; staging.vettid.org; the dev stack's manifest host); it then fetches `https://<host>/security/releases/index.json` and no other URL. Any other `notes` (staging S1–S8 still carry GitHub URLs until the backfill is published) means no fetch. GET without cookies or credentials, redirects refused, 10 s timeout, at most 1 MiB, JSON only. The entry used is the one whose `release` is N **and** whose `pcr0` equals the manifest's PCR0 for N; otherwise none. Shown as plain text only (no markup, no tappable links), each field cut with "…" past the RELEASE-UPDATES §5 limits (summary 160 characters, 20 changes of 280, `security_text` 1,000). Kept in memory per host, release and PCR0 until the process ends; nothing is stored on disk or in the vault. **Information only:** nothing in it is used for a decision: which release is offered, its status, `ends_at`, the fingerprint and the approval come from the signed manifest alone. **Fallback:** while loading, a progress line, and **Approve and update** stays enabled; if the fetch fails, the entry is missing or does not match, or `notes` is not a log URL: "Release notes unavailable" with **Full release notes** (when `notes` is an `https` URL, as the manifest parser already requires), and updating stays possible. Opening the screen again retries. **Notification** ("Vault updates"): before posting it the app tries the same fetch (same rules, 10 s); with an entry its text is the summary ("Release N: <summary>"), otherwise the current text; it is not updated afterwards |
| Transfer (new phone) | — (VettID-specific) | Scan the old phone's transfer QR → compare the SAS → wait for the approval → `device.paired{transfer}`: the app stores its `vault_id` and the member's `user_guid` (VAULT-MESSAGING 0.17.0 §6.7.1) like an enrolled phone, so that it unlocks later with the PIN. Without `user_guid` (a vault release before 0.17.0) the transfer still completes and the app warns: "This phone cannot unlock your vault after it locks until your vault is updated" |
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
    | Unlocks and owner checks | `unlocks` | `vault`, `owner_check` |
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
   | `guide` | the item's `title`; `body` in the sheet | Detail sheet |
   | `leash.*`, `action.request`, `intro.request`, `location.shared`, `location.request`, `wallet.signed` | from the app's strings, as History | Detail sheet: "Not available in this version of the app" (agents, shared actions, introductions, location and wallet come later, §6; their asks expire as their sections say) |

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
     configuration and the vault answers `push.register` (below); with
     **"Needs Google Play services, which this phone does not have"**
     when they are missing (GrapheneOS without sandboxed Play, for
     example); "Google Play services need an update" when outdated.
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
   service, or `push.unregister`) and then starts the new one.
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
4. **(b) Google push (FCM)** (PUSH-GATEWAY 0.4.1; VAULT-MESSAGING
   0.24.1 §14, 0.1.29, 0.1.30). Contentless wakes:
   the app's FCM token goes to its vault over the end-to-end session
   (`push.register{platform: "fcm", token, app_id}`, `app_id` the
   application id of the build), the vault registers it with the
   gateway, keeps only the gateway's sealed wake blob (never the
   token), and later triggers `notify` wakes (VAULT-MESSAGING §14.2); the
   gateway sends a high-priority FCM data message with no content; the
   app's `FirebaseMessagingService` then collects from the relay and
   decrypts as in (a), and posts the same notifications, with no
   persistent service. A wake gives up to about 20 s of execution; a longer
   collect runs as expedited `WorkManager` work. Token rotation
   (`onNewToken`) and `push.token-needed` (the gateway reported the
   token gone; 0.1.29 spelled it `push.token_needed`) send `push.register` again; switching away from the
   mode or a wipe sends `push.unregister` (a transfer or a recovery
   that removes the app erases the registration vault-side,
   VAULT-MESSAGING §14.1). The status line (1) reads the `push` state
   on the app's `device.list` entry: "Connected" while `active`
   (`last_result` `gateway_error`: "Push service not reachable, retrying"),
   and "Registering again" after `push.token-needed`; `unavailable`
   from `push.register` keeps "Not available yet", `gateway_error`
   retries with backoff (1 minute doubling to 1 hour). `limit`
   (`push_registrations`: 20 answered registrations in 24 hours, refusals
   included) stops the retries for 24 hours; Settings → Notifications
   shows "Push unavailable, using the on-phone service", and the on-phone
   service (a) runs as the fallback meanwhile (owner decision
   2026-10-10, 0.1.30). Correctness
   never depends on a wake: the app collects at every foreground as
   now.
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
     the app builds and runs as today (CI included). Google Play
     services presence: `GoogleApiAvailability`. A later `foss` build
     flavour without the library (for F-Droid) remains possible and is
     §9 question 12; a flavour now would double every build and test
     for no user yet.
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
   | Security alarms | `credential.alarm` (urgent; also while held), `owner_check.locked`, `owner_check.failed`, `owner_check.hold_changed`, `credential.password_failed`, `credential.reset`, `device.replaced`, `device.transferred`; the event `vault.locking` (Vault locked, 3) |
   | Daily check | the events `vault.held` and the early warning (3) |
   | Vault activity | `connection.added`, `connection.request.peer_declined`, `connection.asks_paused`, `connection.stale`, `connection.removed`, `grant.shared`, `grant.revoked`, `share.rate_limited`, `item.revealed`, `device.paired`, `device.unlinked`, `credential.rotated`, `leash.*`, `location.shared`, `wallet.signed`; unknown kinds of priority `normal` or above |
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
      first; Off stops everything); the Mapping table for every §10.9
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
    - Build: CI builds and tests without any Firebase configuration.
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

## 5. Architecture

Multi-module Gradle, Kotlin, Jetpack Compose + Material3, Hilt, coroutines
and Flow, Room (encrypted with a Keystore-held key) for local caches,
DataStore for preferences, OkHttp for HTTP, strings in resources from day
one (translation-ready), accessibility labels required in review.

| Module | Contents |
|---|---|
| `:core:crypto` | Suite 2 (HPKE MLKEM768X25519 / HKDF-SHA256 / ChaCha20-Poly1305), XChaCha20 sessions, Ed25519, Argon2id; envelope v2; handshake and epochs; credential UTK/reply-key sealing. **Must pass the vettid-vault test vectors byte for byte.** |
| `:core:keystore` | Android Keystore keys (device identity, relay key wrapping, device attestation key with StrongBox/TEE, the biometric-gated app-data key) |
| `:core:attestation` | Ported Nitro attestation + PCR manifest verification; Android key attestation for enrollment/unlock (§11.7) |
| `:core:relay` | Relay client (RELAY-PROTOCOL 0.6): register, signed requests, tokens, deposit, collect (long-poll / WebSocket), ack, claims, blobs |
| `:core:altchan` | Member-API alternate channel: code redeem and recovery claim, requests signed by the app key (no member session), descriptors, sealed enroll/unlock/lock, result polling, release-update approval |
| `:core:vault` | Typed vault client: one function per §10 type, sessions with the vault, dedupe, outbox, sync events → repositories |
| `:core:data` | Repositories and Room caches per feature |
| `:core:notify` | 0.1.23: the notification modes: the on-phone service (`VaultConnectionService`), channels, the Mapping and Content rules, the `PushProvider` interface; `:core:push-fcm` the FCM provider (the only module with Firebase) |
| `:core:ui` | Theme (navy + gold, light/dark), components (top bar, drawer, list row, empty state, pill bar, settings cards, sheets) |
| `:feature:*` | onboarding, messages, connections, approvals, items (the "Vault" screens), credential, settings, history (0.1.11), notifications (0.1.23, the feed) |
| `:app` | Navigation (type-safe routes), DI wiring, notifications |

Rules: features depend only on `:core:*`; no feature touches transport or
crypto directly; one ViewModel per screen with immutable UI state.

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
that order, each as its own phase.

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
    is published on F-Droid.
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
