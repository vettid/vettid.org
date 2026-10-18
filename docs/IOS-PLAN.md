---
title: IOS-PLAN
status: approved (owner, 2026-10-17)
version: 0.1.2
date: 2026-10-18
changelog:
  - 0.1.2: **for the owner's approval** (STAGING-TIME-SCALE 0.1.0,
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
| ID10 | **Screen capture** (owner) | Always: a cover in the app switcher and content hidden while the screen is recorded, mirrored or shared. On the screens Android holds secure individually (`SecureWindow`: the typed recovery code, and the same list as Android), also the secure-text-field layer that iOS leaves out of screenshots, behind one component with a runtime self-check (§6.4) | Only the cover and capture hiding (screenshots possible everywhere) | I1.5 |
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
| Profile photo, photo attachments | AVFoundation camera to memory; `PHPickerViewController` (no photo-library permission, like the Android Photo Picker); saving uses the add-only permission and only after the warning. |
| History export | `fileExporter` ("Save to Files") in place of "Save to…". |
| Calls (later) | CallKit, and PushKit to ring (needs APNs). |

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
a transfer's keep period on the old phone, delete every key and record
explicitly. The simulator has neither a Secure Enclave nor
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
   (§4) turns off only this one.

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
- **Staging time scale** (0.1.2, for the owner's approval;
  STAGING-TIME-SCALE §5.2): as on Android (ANDROID-PLAN §4 "Staging
  time scale"). `time_scale` comes from the descriptor and a transfer
  bundle (VAULT-MESSAGING §11.10.9), is stored per vault, and divides
  the app's own waits when each starts: the early warning above, the
  replaced records' 7 days (§6.3) and the old phone's 7 days after a
  transfer. Staging builds show the scaled times and "Staging: 1 day =
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

### 6.8 Links

Universal Links for `https://account.vettid.org/vault/enroll/…`
(staging: `account.staging.vettid.org`) and
`https://relay.vettid.org/connect`, and the custom scheme
`vettid://connect` (as on Android, ANDROID-PLAN §5 "App Link hosts per
build"). The `apple-app-site-association` files are vettid.org work
(§9.2). Message links follow VAULT-MESSAGING §10.5: only `https://`
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
| I1.4 | `VettIDKeys`: Secure Enclave app key, seed wrapping, encrypted file store, the real App Attest attester, the phone key of ID9, the "keys usable" check | §11.7, §11.12.2, §11.14.1; §6.1–§6.3 | `core/keystore/*`, `core/data/…/KeystoreFileStore.kt`, `PhoneSecrets.kt`, `core/altchan/…/Attester.kt` | iPhone tests: the app key and the seed keys sign and agree with the phone locked (after first unlock); the phone key's ECDH fails while the screen is locked and works once it is unlocked; a passcode change, and turning the passcode off, keep the phone key; a deleted key is detected as unusable; after removing and reinstalling the app, the first-run cleanup removes the keychain items and the old phone key is not used; the iPhone locked during a request (and a start before first unlock) gives "Unlock your iPhone" and a retry, never the "no longer holds the keys" path, with every key and record kept, and the typed PIN dropped and asked for again; a launch before first unlock (a background launch after a reboot) deletes nothing in the first-run cleanup; a lookup during which protected data goes away is not "missing"; Release and Staging archives contain no software `PhoneSecretSource` (release check). Unit tests (software source) for every lost-answer case of §6.3: a renew's answer lost then an unlock; a renew's answer lost then a retry; two renews with the first answer lost; a crash between storing the record and sending; a fifth change while four candidates are unconfirmed is refused before sending and no candidate is dropped; a replaced record kept 7 days after the confirmation and deleted then (and at a wipe), not extended by a clock set back; the earlier-secret step only from the member's tap, moving back only on `ok` or `transfer_incomplete`, not on `bad_pin`, with the History entry and the new-secret prompt after `ok`; after each, the vault (the Go reference client's rules, or a fake that follows `vault/opendek.go`) is reachable. App Attest attestation verifies with vettid-vault's `devattest` against Apple's root in a test harness (VA1). **Merges only after VAULT-MESSAGING 0.35.0 (ID9, approved 2026-10-17) is on `master`** |
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
| I3.1 | Items: data, secret and critical; templates; tags; TOTP | §10.7, §10.8; VAULT-ITEMS | `feature/items/*`, `core/data/…/items/*` | Critical items need the password; values in the secure container |
| I3.2 | Share rules, grants, critical-item use by a connection | §10.12, §10.13 | `feature/items/RuleEditScreen.kt`, `SharingScreens.kt`, `core/data/…/items/Sharing*.kt` | Rules against a second vault |
| I3.3 | Transfer out and in: QR and pasted code, Finish the move, the old phone keeping its keys until confirmed or 7 days, the signer-class texts across platforms | §6.7.1, §11.7.1 ("Across an iOS app"), §11.14.10 | `feature/settings/TransferOut*.kt`, `feature/onboarding/MoveScreens.kt`, `TransferInViewModel.kt`, `FinishMove.kt`, `core/data/…/FinishMoveRunner.kt` | iPhone → Android → iPhone on staging; the old phone erases itself on confirmation |
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
| VA4 | **Signer continuity across an iOS app**: keep the last recorded Android signer when the vault moves to an app without one, so a later move to an Android app of another signer is `signer_changed`, confirmed and audited (VAULT-MESSAGING §11.7.1 "Across an iOS app"; decided 2026-10-11, not implemented) | Decided as a vault change before the first release that accepts an iOS app | I3.3 across platforms; production |
| VA5 | **e2e coverage of release R with the iOS TEST attester**: enroll, unlock, recovery register and open (with `device_assertion`), a transfer's `hs.init` in both directions between Android and iOS attesters, a release approval with two assertions | The e2e iOS tests predate release R | VA2's release |
| VA6 | **No minimum app version on iOS, said explicitly**: App Attest carries no app version, so `android_min_version_code` (§11.14.14) has no iOS counterpart in the enclave; a test that an iOS attestation is not refused by it | Prevents a later surprise | — |

### 9.2 vettid.org work (owner approval)

- VAULT-MESSAGING: the iOS paragraph of §11.14.1 and its vectors (ID9;
  recorded in 0.35.0, approved 2026-10-17), then the `phone_ios` object in
  vettid-vault's `unlock.json`; §11.7's iOS bullet for VA2 and VA3; correct the "not built" wording
  of VAULT-PLAN §7 risk 6 and STAGING-DEVELOPMENT-PLAN §5 row I.
- `apple-app-site-association` on `account.vettid.org`,
  `account.staging.vettid.org` and `relay.vettid.org` (`applinks` for
  the enrollment and connect paths, with the team ID).
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
- **Phone locked during a request (§6.3; approved 2026-10-17)**:
  "Unlock your iPhone, then try again."
- **Four unconfirmed changes (§6.3; approved 2026-10-17)**: "Unlock your vault first, then
  try again. VettID needs to confirm your last change before it can
  make another."
- **Help → Keyboards (ID11)**: "VettID uses only Apple's keyboard, so
  that other keyboards never see your PIN, password or codes."
