---
title: ANDROID-PLAN
status: draft
version: 0.1.21
date: 2026-10-09
changelog:
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
    UnifiedPush, plus a foreground-service path without push, §7); no
    backup or export of vault data (§4); location viewer notes for the
    location phase (§6)
owner: Al Liebl (Mesmer)
related:
  - VAULT-MESSAGING.md (0.22.0) — the app's contract with the vault
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

## 3. Design language (from Proton Mail)

Reference screenshots are kept privately (they show a real mailbox); the
patterns:

- **Top bar**: menu button, screen title, search, avatar (initial tile).
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
| Conversation | Message detail | Bubbles in a card list; pill actions (reply, more) |
| Connections | Contacts | Initial tiles, status (pending / active / stale / blocked); a star marks favourites (the owner's `favorite` flag, `connection.update`), whose tiles are teal; the floating action button invites a connection (0.1.11: QR or link, or scan the other's QR), the only invite entry point besides empty states. Each is titled "First Last" from the profile's core (VAULT-MESSAGING 0.18.0 §10.8), the display name, if any, as secondary text. Incoming requests show the requester's names the same way. Only between activation and the first `profile.update`, when the request's names are not at hand: "Name not shared yet"; never "Unnamed connection" |
| Connection detail | — | Titled "First Last" (never an alias), the display name secondary. Profile shared with you (the names labelled as the name on their VettID account, never "verified"; display name, photo and items labelled as shared by them), sharing both ways ("You share with <First>": every share rule a row with its own settings, opening its editor or deleted after a confirmation, "Add a rule" up to 64, 0.1.20), authenticate, the vault key fingerprint (`ik`, 8 groups of 4 hex digits, §10.8: the lasting identity check). The action bar: message, favourite, History, remove (confirmed). No safety code (it belongs to connecting: the invite and request screens), no alias or notes, no edit or block (0.1.13; blocking stays on an incoming request) |
| Approvals | — (VettID-specific) | Pending connection requests, grant requests, critical-item uses, share-rule decisions; approve/deny; critical items need the credential password |
| Vault | Folder list | Titled "Vault" (0.1.11; was "Items"). Items per VAULT-ITEMS: name, category, typed fields, tags, sensitivity (data / secret / critical); filter by tag (0.1.21: "✕ Clear" ends the filter chips while a filter is on); each tag in its own colour (0.1.21); add/edit from templates ("Save item" in the top bar, 0.1.21); share rules by tag, as many per connection as needed (up to 64), each with its own tags, mode (default: ask each time), fetch limit and end (presets or a custom date and time), overlaps shown (0.1.20). Critical items live in the Protean Credential and are never shared by a rule |
| History | — (VettID-specific) | The member's audit log (0.1.11, `audit.list`, VAULT-MESSAGING 0.20.0 §10.9), read-only: a search field (the vault searches, `q`), filter chips (category, connection, date range), a list of entries newest first with infinite scroll, and an entry detail; a ⋯ menu with **Export…** (0.1.17: CSV or JSON of what the filters show, with the vault PIN, saved through "Save to…"). Details below |
| Credential | — | Reached from Settings → Security → Credential (0.1.11; not in the drawer). Critical items inside the Protean Credential; unlock window; password change; the vault-held credential copy (the backup) on/off. Turning it off shows VAULT-MESSAGING §3.5.6's warning and needs a confirmation: "If this phone is lost, broken, reset or replaced without a transfer, your vault **cannot be recovered**. It can only be deleted and replaced by a new one, and **everything in it is lost**." While off, the screen and Settings keep a short "no recovery" notice. Turning it on asks for the password at once (an owner check) so that the copy exists, and says recovery is possible from then on |
| Settings | Settings | At the top, an **account card** (0.1.11): the member's first and last name and full email address (`account.get`, VAULT-MESSAGING 0.20.0 §11.13) and the membership state; tapping it opens the avatar sheet. Vault (status, release, lock, PIN; "Update available" while a newer release can be approved, 0.1.19); Security (credential, recovery, attestation info, the app lock (0.1.19: Biometrics or Phone screen lock) and timeout, the owner-check interval 1–24 h and the hold switch); Privacy (the **Shared profile**, glyph `Badge`, 0.1.12: display name, `@profile` items and the profile photo, **camera only** — "Take a photo" / "Retake photo" opens the app's own camera screen, front camera first with a switch to the rear one, then "Retake" or "Use photo"; no selection of an existing picture and no other camera app; the shot stays in memory, is never saved to the gallery, and is cropped, scaled and re-encoded to a JPEG ≤ 65,536 bytes without EXIF before `profile.set{photo}`; "Remove photo" confirmed; a refused camera permission is explained, with the system settings once Android no longer asks; a phone without a camera is told); App (theme, notifications and push path; the local "Vault updates" channel, 0.1.19) |
| Owner check | — (VettID-specific) | One screen: PIN and credential password together (VAULT-MESSAGING §3.6.5); also the "vault held" screen with the waiting counts and the lock action |
| Avatar sheet | Account sheet | The member's first and last name and **full email address** (0.1.11, from `account.get`'s snapshot `first_name`, `last_name` and `email`, VAULT-MESSAGING 0.20.0 §11.13; never the masked hint), the email labelled "Only you see this address" and the names "Your connections see this name"; **Lock vault first** (0.1.12), right under the name and email, before Change name, Shared profile and the email; the sheet scrolls; vault status; **Change name** (0.1.10): the two names (the registration rule: letters, spaces, `'’.-`, ≤ 40), then the owner-check screen's PIN and password, sent as `account.name.set`; then "Name change requested" until `account.get`'s `name_request` is `applied` or `refused`; `too_soon` (from the vault or the member API): "You can change your name once every 30 days. You can change it again on <date>" (VAULT-MESSAGING §10.8), membership and subscription (read-only, from the vault, VAULT-MESSAGING §11.13), open account portal (browser) |
| Recovery (new phone) | — (VettID-specific) | Only with the backup on: scan the portal's recovery QR → claim (`email_hint`) → register → PIN → credential password → the app replaces the old one. No other path: 0.1.6's backup-off choice (new credential or delete) is removed. `no_backup` at register or unlock (a vault whose backup is off): "This vault cannot be recovered: its credential backup was off. Delete it on the account site and start over with a new setup code", with a link to the portal's start-over page (MEMBER-API 2.1.0) and then to onboarding |
| Pending deletion | — | When `GET /api/vault/status` shows `deletion` (a start-over requested on the portal, VAULT-MESSAGING §11.11.9): an urgent banner with the time left and **Cancel deletion** (`POST /api/vault/deletion/cancel {deletion_id}`, signed by the app key, with the `deletion_id` from the status's `deletion: {deletion_id, state, deletes_at}`, MEMBER-API 2.1.1) |
| Vault update | — (VettID-specific) | 0.1.19 (owner decision of 2026-10-09). **Banner** at the top of the shell while the trusted manifest lists an `active` release newer than the vault's: "A new vault release is available (release N)" with Update now and a close button (back after 24 h; a newer release or a change to the end-date warning shows at once), or, for a `retired` release or a `deprecated` one with an `ends_at`, the urgent "Your vault's release ends on <date>. Update now to keep your vault" (also back after 24 h). The offer is read from the manifest at app start, on return to the foreground and after every unlock (no other polling). **Notification**: one local notification per release on the "Vault updates" channel, its tap opens the update screen; the POST_NOTIFICATIONS permission is asked once, when the first banner shows. **Update screen** (banner, notification, Settings → Vault → "Update available"): the release number, the PCR0 fingerprint, "Anyone can rebuild it and compare the fingerprint", the release notes, the vault PIN and **Approve and update** (no credential password: the owner check, when due, comes first through the shell's gate). Then, over every screen: lock → the unlock with the approved `release_update` (built as at the unlock screen) → `update: moved` → the unlock that reaches N+1 with the same PIN ("Updating your vault…", three steps; "Release N is starting. This can take a few minutes." while the API answers `503 release_starting`). Outcomes: done; refused (`target`, `downgrade`, `approval`, `seal_key`, `pending`, `write`, each explained; the vault stays on its release and is open); a wrong PIN or the backoff (the vault is locked, nothing moved; "Approve and update" again or "Unlock without updating"); N+1 does not open (try again, or **Return to release N**, confirmed, only while the move is unconfirmed). The PIN is held only while a step runs. The unlock screen's "Approve the update with this unlock" stays |
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
  the time. Infinite scroll: `audit.list` with `limit` 50 and
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
  the connection (opens it, if it still exists), the device, the item
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
| `:core:ui` | Theme (navy + gold, light/dark), components (top bar, drawer, list row, empty state, pill bar, settings cards, sheets) |
| `:feature:*` | onboarding, messages, connections, approvals, items (the "Vault" screens), credential, settings, history (0.1.11) |
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
| A6 | Hardening and polish: accessibility pass, notifications, offline behaviour, error states, Play pre-launch report | Internal testing track build |

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
- **Push** (owner decision, 2026-10-03: both paths): FCM when Google Play
  services are present, **UnifiedPush** for phones without them (for
  example GrapheneOS), and, with neither, a foreground service that keeps
  the relay connection, or periodic polling (PUSH-GATEWAY 0.2.0 §11). The
  member can pick the path in notification settings. Until the gateway is
  deployed (FCM needs credentials), v1 collects while the app is open and
  through the foreground-service path.
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
   service; set expectations in the UI.
5. **GrapheneOS and device attestation** (resolved): GrapheneOS reports
   its own verified-boot key (`SelfSigned`); VAULT-MESSAGING 0.9.0 §11.7
   accepts it when the key is one of the pinned GrapheneOS fingerprints.
   Staging accepted GrapheneOS attestation on real phones on 2026-10-05
   (Pixel 10 Pro and Pixel 9 Pro, verified boot yellow / `SelfSigned`).

## 9. Open questions

None at this time (min SDK, search and biometrics decided 2026-10-03).
