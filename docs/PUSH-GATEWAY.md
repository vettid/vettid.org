# VettID Push Gateway Protocol

**Version:** 0.4.1 (draft)
**Status:** Pre-implementation draft for review (N2; owner request of
2026-10-10: "we can start to design the push service for google play and
apple ios")
**Companion to:** VettID Relay Protocol (Appendix A), VAULT-MESSAGING
0.24.1 §14 (`push.register`, the vault's wake rules), ANDROID-PLAN D7

## 1. Purpose & design principles

The push gateway is a small VettID-operated service that delivers
**contentless wake-up pushes** to the VettID app through the platform push
services: Firebase Cloud Messaging (FCM, Android) and the Apple Push
Notification service (APNs, iOS). A wake tells the app only "collect from
your mailbox"; the app then fetches over its normal end-to-end session,
decrypts on the phone and builds the notification itself. The gateway exists
so that no vault and no relay ever holds Apple or Google credentials.

**No UnifiedPush** (owner decision, 2026-10-09: "we're not doing unified
push. the vettid service is our solution. and apps connected to vettid get
to use our notification channel"). Phones without Google services
(GrapheneOS without sandboxed Play services, for example) use the app's
on-phone service (§13; ANDROID-PLAN D7) and never touch the gateway.

**Push is opt-in per device.** On Android the on-phone service stays the
default and Google push is a choice the member makes. iOS has no
persistent service, so Apple push is iOS's main path; it starts only when
the member allows notifications (§11.2).

Design principles:

1. **Zero content.** Pushes carry no message data, no sender, no name, no
   count, no cursor and no mailbox id. The platform payload is **fixed per
   platform** (§6): every wake of a channel is byte-identical apart from
   the identifiers the platform adds itself. Google and Apple learn that
   VettID woke a device, and when; nothing else.
2. **Unlinkability.** The gateway cannot associate a push token with a
   member, a vault or a relay mailbox. Each registration has its own wake
   key (§3), unrelated to every relay, identity or credential key.
3. **No per-member state.** The gateway stores **nothing** about any
   registration. It seals what it needs into a **wake blob** (§4) that only
   it can open and only the registering vault keeps (in its DEK state). A
   breach of the gateway's storage yields no tokens, because there is no
   token storage.
4. **Only genuine vaults register.** Registration carries a Nitro Enclaves
   attestation document of a VettID vault release listed in the channel's
   signed release manifest (§5.1). Wakes are signed by the wake key bound
   inside the blob.
5. **Same auth grammar as the relay.** Signed requests per Relay Protocol
   §4.1: identical canonical digest, headers, freshness window and replay
   rules. No new signature mechanism.

Conformance keywords MUST, SHOULD, MAY are per RFC 2119.

## 2. Roles

| Role | Description |
|---|---|
| **Vault** | The member's vault (enclave). Registers the app's push token, keeps the wake blob and wake key in DEK state, decides when to wake (VAULT-MESSAGING §14.2). The only caller of the gateway. |
| **App** | The VettID app installation (one per vault). Obtains its FCM or APNs token from the OS and sends it to its vault over its end-to-end session (`push.register`). Never talks to the gateway. |
| **Gateway** | This service. Holds the FCM and APNs credentials and the blob keys; verifies attestations; opens blobs per send and forgets them. |
| **Platform** | FCM or APNs. Delivers the fixed payload to the device. |

Desktops and agents never register: desktop clients keep their own relay
connection while they run, and agents are servers.

## 3. Wake key

- The vault generates a fresh Ed25519 **wake key** inside the enclave for
  **every registration** (each `push.register` that reaches the gateway)
  and discards the previous one with the previous blob. One key, one
  token, one blob.
- The wake key MUST NOT be the vault's relay key (relay mailbox ids derive
  from relay public keys, Relay Protocol §3.2), an identity key, the
  credential key or any end-to-end key.
- Since the token itself is already a stable device identifier towards the
  gateway, a per-registration key adds no linkability; it only proves that
  the caller is the vault that registered.
- A vault has **at most one push registration** (owner review of
  2026-10-10): the holder's, the phone that holds the credential
  (VAULT-MESSAGING §3.5.9), which is the only device to wake. A new
  registration replaces the previous one (VAULT-MESSAGING §14.1). There
  is no list of registrations or wake keys, per member or per vault.

## 4. Wake blobs

A wake blob is the gateway's sealed record of one registration:

```
wake_blob = base64url-nopad( 0x01 || key_id(4) || nonce(24) || ct )
ct        = XChaCha20-Poly1305(blob_key[key_id], nonce,
                aad = "vettid/push/1/blob" || 0x00 || channel,
                pt  = JSON {"p":"fcm|apns", "e":"production|sandbox"?,
                            "a":"<app_id>", "t":"<platform token>",
                            "k":"<b64 wake pubkey>", "i":<issued, Unix s>})
```

- `channel` is `prod` or `staging` (a blob of one channel never opens in
  the other). `nonce` is random. A blob is at most **6,144** bytes.
- **Blob keys** are 32-byte random keys generated by the gateway, stored
  only as ciphertext under the gateway's KMS key (§10.2) and decrypted
  into memory at task start. One key is current; it rotates **yearly**.
  A retired key still opens blobs for **400 days**; a wake whose blob was
  sealed under a non-current key is answered with a `reseal` (a fresh blob
  of the same record under the current key, §5.2), which the vault stores.
  After 400 days the old key is deleted, and its blobs answer
  `blob_invalid`.
- The vault treats the blob as opaque; it never sees inside it. The vault
  does not keep the token (only a hash, VAULT-MESSAGING §14.1).

## 5. Endpoints

Base path `/v1`. Requests are signed per Relay Protocol §4.1
(`X-VettID-Key` = the wake public key, `X-VettID-Timestamp`,
`X-VettID-Sig`; 90 s freshness; replay cache). Error bodies follow Relay
Protocol §7.1. `GET /v1/health` is unauthenticated and returns `200 {}`.

### 5.1 Register

```
POST /v1/register
X-VettID-Attestation: <base64 Nitro attestation document>
{ "platform": "fcm" | "apns",
  "token": "<platform push token>",
  "app_id": "<Android package / iOS bundle id>",
  "environment": "production" | "sandbox" }     # apns only; required there
→ 201 { "wake_blob": "<blob>" }
```

The gateway, in order:

1. checks the signature, freshness and replay cache (Relay §4.1);
2. **verifies the attestation** (`attestation_invalid` otherwise): a
   COSE_Sign1 Nitro attestation document whose certificate chain ends at
   the pinned AWS Nitro Enclaves root; `timestamp` within 300 s of now;
   `public_key` = the 32 raw bytes of `X-VettID-Key`; `user_data` = the
   request's 32-byte digest (Relay §4.1, `SHA-256(canonical)`); `pcrs[0]`
   equal to the `pcr0` of a release in the channel's **trusted release
   manifest** (VAULT-MESSAGING §11.10.1) whose status is `active` or
   `deprecated`. The gateway fetches the manifest itself, verifies it with
   the channel's pinned manifest keys exactly as apps do, refuses a lower
   `serial`, and refreshes it every 10 minutes;
3. checks the body: `platform` known; `token` 1–4,096 bytes of printable
   ASCII for `fcm`, 64–200 lowercase hex digits (even count) for `apns`;
   `environment` present for `apns` and absent for `fcm`; `app_id` in the
   channel's configured list for that platform (`app_invalid`);
   `sandbox` accepted only where the channel allows it (§10.4);
4. seals and returns the blob. Nothing is written anywhere.

Registering never contacts the platform: a bad token shows up at the first
wake (§7). The same body registered twice yields two different blobs; both
work (the vault keeps one).

### 5.2 Wake

```
POST /v1/wake
{ "wake_blob": "<blob>", "class": "notify" }
→ 202 { "reseal": "<blob>"? }
```

1. Signature, freshness, replay cache.
2. Open the blob; its `k` MUST equal `X-VettID-Key`. A blob that does not
   open, has another channel, an unknown or deleted key, or another key
   than the signer is answered `blob_invalid`, identically in every case
   (no oracle).
3. Rate limits (§8).
4. Coalescing: a wake for the same token within 2 s of the previous one
   is answered `202` without a second platform send.
5. Send the fixed payload (§6) to the platform **synchronously**, with a
   5 s timeout, and answer with its outcome (§7). The opened record is
   dropped from memory when the request ends.

`class` is `notify` only in this version; any other value is
`bad_request`. (0.3.0's `sync`, a silent background push, is withdrawn:
platforms throttle it to a few per hour and drop it after a force-quit, so
nothing could rely on it.)

There is no update and no delete endpoint: a token change is a new
registration, and unregistering is the vault discarding its blob.

## 6. Platform payloads (fixed)

**FCM** (HTTP v1 `messages:send`, project of the channel):

```json
{ "message": { "token": "<t>",
    "data": { "w": "1" },
    "android": { "priority": "HIGH", "collapse_key": "w", "ttl": "86400s" } } }
```

A data message only (no `notification` block, so Google never renders
anything). The constant `collapse_key` is safe because every wake means
"collect everything": a phone that was offline gets one wake, not a queue.

**APNs** (HTTP/2, token-based auth, `api.push.apple.com` or
`api.sandbox.push.apple.com` per the blob's environment):

```
apns-push-type: alert
apns-priority: 10
apns-topic: <app_id>
apns-expiration: <now + 86400>
{ "aps": { "alert": { "loc-key": "WAKE_FALLBACK" },
           "mutable-content": 1, "sound": "default" } }
```

`WAKE_FALLBACK` is localised in the app as **"New activity in VettID"**
(0.3.0: "New message"): it is what shows if the app's notification
service extension cannot finish (§11.2). No `apns-collapse-id` and no
`thread-id`: on iOS each wake becomes one visible notification, and a
collapse would replace a notification the member has not read yet; the
extension sets grouping on the phone. No `interruption-level` in the
payload: the extension sets it on the phone (§11.2), so Apple does not
learn which wakes are security alarms.

## 7. Errors and failure feedback

Codes (grammar per Relay Protocol §7.1):

| Status | `code` | Meaning | The vault |
|---|---|---|---|
| 401 | `signature_invalid`, `timestamp_stale`, `replay_detected` | Auth | Fix clock / retry once |
| 403 | `attestation_invalid` | Registration only | `gateway_error`; the app may retry later |
| 400 | `bad_request`, `platform_invalid`, `app_invalid`, `token_invalid` | Body (`token_invalid`: also APNs `BadDeviceToken` or FCM `INVALID_ARGUMENT` for the token at a wake) | Registration refused; at a wake, as `token_gone` |
| 410 | `token_gone` | FCM `UNREGISTERED` / 404, APNs `410 Unregistered` | Drop the registration, ask the app for a new token |
| 410 | `blob_invalid` | §5.2 step 2 | Same as `token_gone` |
| 429 | `rate_limited` (+ `retry_after`) | §8, or the platform's own `429`/`TooManyRequests` | Wait, merge triggers |
| 502 | `provider_unavailable` (+ `retry_after`?) | Platform 5xx or timeout | Retry with backoff |
| 500 | `internal` | | Retry with backoff |

The gateway keeps no record of dead tokens: the vault drops its blob, so a
dead token is never sent again.

## 8. Rate limiting & abuse

- **Per token** (keyed by an HMAC of the token under a per-process random
  key, in memory only, never persisted or logged): at most **60 wakes per
  hour**, burst 10. The vault's own limits are lower (VAULT-MESSAGING
  §14.2), so this bounds only a misbehaving or compromised caller.
- **Per source address**: registrations 30 per minute; wakes 6,000 per
  minute (vault hosts carry many vaults behind one address).
- Counters live in each task's memory; with N tasks the effective limits
  are up to N times higher, which is acceptable for an abuse bound and
  avoids any shared store.
- **Abuse model.** Without a genuine vault's attestation nobody can
  register, and without the blob and its wake key nobody can wake. A
  stolen token alone is useless. A compromised vault enclave could wake
  only the tokens it holds blobs for (its own app), within the limits.

## 9. Privacy & security considerations

1. **What the gateway learns**, per wake and in memory only: the token,
   platform, environment, app id, the wake public key, the time, and the
   source address (a vault host's, shared by every vault on it). At
   registration also the release's PCRs and the enclave's module id from
   the attestation (which host ran the vault then). It never learns a
   member, a vault id, a mailbox, a sender, a message or a size, and it
   **stores none** of the above.
2. **What platforms learn**: that the VettID app on a device was woken at
   a time, with a fixed payload. Content is fetched and decrypted on the
   phone.
3. **Timing correlation.** VettID operates the relay, the vault hosts and
   the gateway; with request logs of all three it could correlate a relay
   deposit with a wake a second later. Mitigations: the gateway keeps
   **no per-request logs** (§10.5), shares no datastore with the relay,
   and the vault's debounce (VAULT-MESSAGING §14.2) blurs bursts.
4. **Gateway compromise** (live memory, credentials): the attacker can
   send contentless pushes to the tokens of wakes passing through while
   it lasts (annoyance, battery), and read nothing. Stored data yields
   nothing: there is none. Recovery: rotate the APNs key, the FCM access,
   and the blob keys (all vaults' blobs then answer `blob_invalid`, and
   apps re-register automatically, VAULT-MESSAGING §14.2).
5. **Credentials** (APNs .p8, FCM access) and blob keys live in AWS
   Secrets Manager under a dedicated KMS key readable only by the
   gateway's task role (§10.2); never in config, images or the repo.

## 10. Deployment (AWS)

### 10.1 Service

- A new public repository `vettid/vettid-push` (Go, AGPL like the vault;
  reproducible distroless image on ghcr.io, digest pinned in `cdk.json`
  context `pushImage`, as the relay).
- **ECS Fargate in the main VettID account** (where the relay runs), stack
  `VettidOrgPushStack`, **2 tasks** in two AZs (stateless, so scaling is
  adding tasks), 0.25 vCPU / 0.5 GB each. Behind the **relay's ALB** with a
  host rule for `push.vettid.org` and the same post-quantum TLS policy (D5:
  the enclave terminates TLS and pins Amazon's roots, as for the relay).
  Its own target group, task role, log group and security group; no
  access to the relay's DynamoDB, S3 or Valkey. About $20 a month.
- Vault side: the vault hosts' DNS firewall and the parent's forwarder
  allowlist gain the gateway's host name (`lib/vault/egress.ts`); the
  release constants gain the gateway URL (VAULT-MESSAGING §11.10.8).

### 10.2 Secrets

In the main account, `us-east-1`, encrypted with a customer-managed KMS
key `alias/vettid-org-push` whose policy allows `kms:Decrypt` only to the
gateway task role (and the account's break-glass admin):

| Secret (Secrets Manager) | Content |
|---|---|
| `vettid-org/<stage>/push/apns` | `{team_id, key_id, p8}` (the .p8 PEM) |
| `vettid-org/<stage>/push/fcm` | Workload identity federation config (no secret, §14 question 4), or the service-account JSON key as the fallback |
| `vettid-org/<stage>/push/blob-keys` | `{current, keys: {<key_id>: <b64 32 bytes>}}` |

`<stage>` is `prod` or `staging`. Tasks read them at start; nothing is
written back. The APNs key is rotated yearly (Apple allows two active
keys, so rotation has no gap).

### 10.3 FCM access without a key (recommended)

GCP **workload identity federation** for AWS: a workload identity pool in
the Firebase project trusts the main account and the gateway task role;
the gateway exchanges its AWS role credentials for a short-lived Google
access token that impersonates a service account with only the
**Firebase Cloud Messaging API Admin** role. No long-lived Google key
exists anywhere. Fallback, if federation proves impractical: a JSON key
for that service account in the secret above.

### 10.4 Staging and production

| | staging | production |
|---|---|---|
| URL | `https://push.staging.vettid.org` | `https://push.vettid.org` |
| ECS service | a second service in the same cluster | |
| Trusted manifest | the staging manifest and key | the production manifest, keys A and B |
| Firebase project | `vettid-staging` | `vettid-prod` |
| APNs environments | `sandbox` and `production` | `production` only |
| App ids (Android) | the staging build's application id | `com.vettid.app` |
| App ids (iOS) | `com.vettid.app.staging`, extension `com.vettid.app.staging.NotificationService` | `com.vettid.app`, extension `com.vettid.app.NotificationService` |
| iOS App Group | `group.com.vettid.app.staging` | `group.com.vettid.app` |
| iOS keychain access group | `<team id>.com.vettid.app.staging` | `<team id>.com.vettid.app` |

The APNs environment of a registration follows how the iOS build is
signed (its `aps-environment` entitlement, §11.2): builds installed from
Xcode with a development profile use **`sandbox`**; TestFlight and App
Store builds use **`production`**. A staging build from TestFlight
therefore registers `production` against the staging gateway, which is
why staging accepts both. The staging and production iOS apps have
separate bundle ids, App Groups and keychain access groups, so a staging
install never shares storage with a production one on the same phone.

A staging vault image embeds the staging URL; channels cannot cross
(VAULT-MESSAGING §11.10.8). The dev stack uses a **gateway stand-in**
(`vettid-push -dev`) that accepts the dev enclave's test attestation and
records wakes instead of sending them (N3).

### 10.5 Observability without personal data

- **Metrics** (CloudWatch EMF): `registrations{platform,outcome}`,
  `wakes{platform,environment,outcome}`, `provider_latency_ms{platform}`,
  `attestation_failures{reason}`, `rate_limited{scope}`, `blob_resealed`.
  No dimension identifies a token, key, vault or address.
- **Logs**: errors and starts only, 14 days, in
  `/vettid-org/<stage>/push-service`; never a token, blob, wake key,
  attestation document, source address or per-request line. ALB access
  logs stay off for the push host.
- **Alarms** (SNS to admin@vettid.org): provider auth failures (APNs
  `403 InvalidProviderToken`, FCM `401/403`), `provider_unavailable` above
  5 % for 10 minutes, any `internal`, manifest refresh failing for 1 hour,
  attestation failures above a baseline.

## 11. Client behaviour (informative)

### 11.1 Android: Google push mode (ANDROID-PLAN §4 Notification modes)

1. The member chooses **Google push**; the app gets its FCM token
   (Firebase initialised at runtime, ANDROID-PLAN) and sends
   `push.register{platform: "fcm", token, app_id}`; then it stops the
   on-phone service.
2. A wake arrives as a high-priority data message in
   `FirebaseMessagingService.onMessageReceived`. The app collects from its
   relay mailbox over its normal vault session (Relay §6), decrypts on the
   phone, persists and acks as when open, and posts notifications through
   the existing channels, Mapping and Content rules (ANDROID-PLAN §4,
   items 6–8). A wake gives about 20 s; a longer collect continues as
   expedited `WorkManager` work. `onDeletedMessages` triggers a collect.
3. FCM may downgrade high-priority messages that show no notification.
   The vault wakes only for what the Mapping notifies (VAULT-MESSAGING
   §14.2), so nearly every wake shows one.
4. `onNewToken` and `push.token-needed` send `push.register` again;
   leaving the mode or a wipe sends `push.unregister`.

### 11.2 iOS: Apple push (the iOS default)

**Modes.** iOS has no persistent background connection, so it offers two
modes: **Apple push** (the default) and **Off**.

- **Opt-in**: onboarding explains notifications ("VettID's notifications
  are built on your phone. Apple only learns that VettID was woken"), then
  shows the system permission prompt. Allowed: the app calls
  `registerForRemoteNotifications` and sends
  `push.register{platform: "apns", token (hex, lowercase), app_id: bundle
  id, environment}` (`environment` from the build's `aps-environment`
  entitlement). Refused: no registration (alerts could not show), and
  Settings explains how to allow them later.
- **Off**: `push.unregister` and `unregisterForRemoteNotifications`; the
  app fetches only while open, as on Android. The same warning ("Not
  recommended…").
- The app re-registers whenever the OS gives a token different from the
  one last registered, and on `push.token-needed`.

**How a wake is handled: a notification service extension (recommended).**

| | Notification service extension (mutable-content alert) | Background push (`content-available`) |
|---|---|---|
| Delivery | Every push, also after a force-quit or reboot (after first unlock) | Throttled to a few per hour, at the system's discretion; none after a force-quit |
| Time | ~30 s, ~24 MB memory | ~30 s |
| Visible | Always shows a notification (the fallback text if the extension fails) | Shows nothing by itself; the app must schedule a local notification |
| Fit | Built for end-to-end encrypted messengers | Unreliable for messages and alarms |

**Decision (recommended): the extension.** It is the only reliable path.
The extension, in its ~30 s:

1. reads the device's session keys and relay token from the keychain
   access group shared with the app
   (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`);
2. collects from the relay **without acking** (Relay §6.3; the messages
   reappear after their lease, `visibility_timeout_seconds`, 60 s, and
   the app collects, persists and acks them when opened), and decrypts
   in memory. An app opened within that minute finds them a little
   later; the alternative, an extension that persists and acks into the
   app group, would put message state outside the app's open vault
   session and is not recommended;
3. builds the notification with the same Content rules as Android
   (previews: Names by default; Names and message text; Nothing): for
   several new items, one summary ("3 new messages from Sam Lee");
4. sets locally `interruptionLevel` (`timeSensitive` for security alarms
   and the daily check, which needs the Time Sensitive Notifications
   capability; `passive` and no sound for vault activity; `active`
   otherwise), `threadIdentifier` per category, and the sound;
5. remembers what it notified as HMACs of the item ids (keyed by a device
   key, 7 days, in the app group) so a later wake does not repeat it.
   Nothing else is written.

**What shows when the extension cannot finish**: the payload's fallback
"New activity in VettID" (timeout, no network, phone not yet unlocked
since boot, any error). For a wake that finds nothing new (the app already
fetched it), the extension needs Apple's **notification filtering
entitlement** (`com.apple.developer.usernotifications.filtering`) to show
nothing; until Apple grants it, it shows the fallback, and the vault's
debounce keeps such wakes rare. Foreground: the app's
`willPresent` delegate suppresses notifications for the screen in use.

**Removing notifications on a lock or hold.** On the `vault.locking` and
`vault.held` wakes the extension removes delivered notifications that
carry names (`removeDeliveredNotifications`), mirroring Android's rule
(to be verified on device in the iOS phase, with the interruption level
set from the extension).

**Beyond push.** iOS client work other than push (onboarding, the vault
session, keychain storage, Universal Links for enrollment and connection
links, message links per §12) is planned in a future **IOS-PLAN**, the
counterpart of ANDROID-PLAN.

## 12. Apps and services connected to VettID

Owner direction: "apps connected to vettid get to use our notification
channel." **No new protocol is needed for this** (owner review of
2026-10-10): a connection already reaches the member through VettID
messaging, and that is the notification channel.

1. **Through the vault, never the token.** A connection sends a message
   (`message.send` → `message.deliver`, VAULT-MESSAGING §10.5),
   end-to-end encrypted, to the member's vault. The vault stores it,
   creates a `message.received` feed item (VAULT-MESSAGING §10.9), and
   its wake rules (§14.2 there) decide whether the phone is woken. The sender
   never sees a push token, a wake blob or the gateway, and the wake is
   the same fixed payload (§6).
2. **Same privacy as VettID's own.** The text lives only in the vaults and
   on the phone. The notification is built on the phone, under the
   member's preview setting, and names its source ("New message from
   <First Last>", ANDROID-PLAN §4 Notifications).
3. **Bounded by the existing rules.** The vault creates the feed item and
   sets its priority; a connection cannot raise it, and the Security and
   Daily check channels carry only the vault's own kinds. A connection's
   messages are limited per peer (VAULT-MESSAGING §7.3); its asks can be
   muted and are paused after abuse (VAULT-MESSAGING §10.4.1); the member
   can remove or block it (§10.4).
4. **Links in messages** (VAULT-MESSAGING §10.5). Message text is plain
   text. Clients make only **`https://`** URLs tappable. Before opening
   one the app shows its domain and asks; it then hands the URL to the
   operating system, so an Android App Link or an iOS Universal Link
   opens the installed app verified for that domain, and any other link
   opens the browser. **Custom schemes** (`someapp://`) and all other
   schemes are shown as text and never opened: any app can claim a
   custom scheme, so such a link could open an impostor. A notification
   holds no links; tapping it opens the conversation.
5. **Services** without a member vault come with the **service vault**
   (owner, 2026-10-10: designed soon). A service gets its own vault and
   becomes a connection like any other, so 1–4 apply unchanged. Whether
   a service may send more than messages (for example a notice with a
   title and a link) is decided in that design. VettID never wakes a
   third-party app (that would make VettID a distributor, which the
   no-UnifiedPush decision rules out); a third-party app is opened only
   by the member tapping its link.

## 13. Devices without push (informative)

The gateway is an optimisation: correctness never depends on a wake. An
app without a platform push service, or whose member does not choose it,
still receives everything:

- **While open,** it collects from the relay by long-poll or WebSocket
  (Relay §6), as every app does.
- **In the background on Android,** the VettID app keeps that connection
  in its on-phone service, a foreground service with a persistent
  notification (ANDROID-PLAN D7, the default). No registration and no
  gateway; the relay sees only its usual collects.
- **iOS** has no comparable path: background delivery needs APNs (§11.2).

## 14. Owner actions and open questions

### 14.1 Owner actions (when ready; nothing is needed for N3)

1. **Firebase / Google**
   1. Create two Firebase projects, `vettid-prod` and `vettid-staging`
      (Google account of the VettID organisation, not a personal one).
   2. In each, add the Android app(s): `com.vettid.app` in prod; the
      staging build's application id in staging. Record each app's
      Firebase options (application id, project id, API key, sender id):
      they are not secrets, and go into the vettid-android CI secrets as
      the Gradle properties of ANDROID-PLAN §4 (no `google-services.json`).
   3. Enable the **Firebase Cloud Messaging API (V1)**; leave the legacy
      API off.
   4. Create a service account `vettid-push` with only **Firebase Cloud
      Messaging API Admin**. Then either set up workload identity
      federation for the AWS main account and the gateway role (an agent
      can script it with you), or create one JSON key and paste it into
      Secrets Manager (`vettid-org/<stage>/push/fcm`) yourself, deleting
      the downloaded file.
2. **Apple**
   1. An **Apple Developer Program** membership: an individual one now,
      under the organisation's Apple ID, converted to an organisation
      membership once the entity has a D-U-N-S number (question 12).
   2. Register the App ID `com.vettid.app` (the bundle id the earlier iOS
      app used), with Push Notifications, App Groups, Associated Domains
      and Time Sensitive Notifications; and the extension's App ID
      `com.vettid.app.NotificationService`. The same for staging:
      `com.vettid.app.staging` and
      `com.vettid.app.staging.NotificationService`. App Groups
      `group.com.vettid.app` and `group.com.vettid.app.staging` (§10.4).
      They stay with the team when it is converted (question 12).
   3. Create an **APNs authentication key (.p8)** (Keys → +, Apple Push
      Notifications service). Note the Key ID and the Team ID. The .p8
      downloads **once**: put it straight into Secrets Manager
      (`vettid-org/prod/push/apns`, and the same key for staging) and
      delete the file.
   4. Request the **notification service extension filtering**
      entitlement (Apple's request form) for `com.vettid.app`.
   5. **Universal Links**: give an agent the Team ID. The stacks then serve
      `/.well-known/apple-app-site-association` on the account and relay
      hosts (production and staging), listing the team's bundle ids and
      the paths the Android App Links already cover (enrollment and
      connection links); nothing manual beyond the Associated Domains
      capability of item 2.
3. **DNS/TLS**: nothing manual; the stack adds `push.vettid.org` and
   `push.staging.vettid.org` to the zone and the ALB certificate.

### 14.2 Open questions (each with the recommendation)

1. **Who may register.** Attested registration (a vault release's Nitro
   attestation, checked against the signed manifest) or open
   proof-of-possession as in 0.3.0? **Recommended: attested**; it keeps
   the gateway VettID-vault-only at the cost of an attestation verifier
   in the gateway.
2. **Gateway state.** Stateless sealed blobs (this draft) or 0.3.0's
   stored `wake_ref → token` map? **Recommended: stateless**: nothing to
   leak, nothing to back up, no delete path to get wrong.
3. **Where it runs.** Main account, its own stack and role, on the
   relay's ALB; or a dedicated AWS account for the crown-jewel
   credentials? **Recommended: main account** (single-account preference
   of 2026-10-03; secrets locked to one role by a dedicated KMS key);
   revisit if third-party senders arrive.
4. **FCM access.** Workload identity federation (no Google key exists)
   or a service-account JSON key? **Recommended: federation**, with the
   key as the fallback.
5. **Firebase projects.** One per channel? **Recommended: yes**, so
   staging credentials can never push to production installs.
6. **iOS wake handling.** **Recommended: notification service extension
   with mutable-content alert pushes**; no background pushes.
7. **iOS default and modes.** **Recommended: Apple push by default once
   the member allows notifications; Off as the only other mode** (no
   "background refresh only" mode in v1: iOS runs it hours apart).
8. **Filtering entitlement.** **Recommended: request it now**; it can take
   weeks.
9. **Security alarms on iOS.** **Recommended: `timeSensitive`, set by the
   extension**, never in the APNs payload; no Critical Alerts (Apple
   grants them only for health, safety and public-safety apps).
10. **APNs collapse.** **Recommended: none** (§6); FCM collapses with a
    constant key.
11. **Desktops.** **Recommended: no push for desktops**; they connect
    while running.
12. **Apple membership.** **Decided** (owner, 2026-10-10): an
    **individual** membership now, under the organisation's Apple ID,
    to build and test; it is **converted** to an organisation
    membership (Apple's "Switch to organization membership", with the
    entity's D-U-N-S number) for release. A conversion keeps the team,
    its App IDs and its keys, so `com.vettid.app`, its staging ids and
    the APNs key are registered on the individual team from the start;
    no app transfer is needed. The earlier iOS app was signed by team
    3X25CJ86MV (Xcode automatic signing); if `com.vettid.app` is still
    registered there, it is removed from that team first.
13. **Calls.** Ringing calls need FCM high priority with a full-screen
    intent on Android and PushKit (VoIP pushes, which must report a
    CallKit call at once) on iOS. **Recommended: leave to the calls
    phase**; missed calls already notify as feed items.
14. **Connected apps** (§12). **Answered** (owner review of 2026-10-10):
    connections already use the channel through messaging; links are
    `https://` only; services come with the service vault.

## 15. Test vector

Wake keypair from the fixed seed (all-0x03 bytes). **Test use only.**

```
wake seed   (b64): AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=
wake pubkey (b64): 7UkoxijRwsbq6QM4kFmVYSlZJzpcY/k2NsFGFKyHN9E=
```

Signed registration request (canonical digest per Relay Protocol §4.1;
the `X-VettID-Attestation` header is not part of the signature and is
omitted here):

```
method            : POST
path              : /v1/register
body              : {"platform":"apns","token":"740f4707bebcf74f9b7c25d48e3358945f6aa01da5ddb387462c7eaf61bb78ad","environment":"production","app_id":"com.vettid.app"}
sha256(body) hex  : b7c8170d637df5d636f997d15ac1e16f5900c18f6271f838d7f9e6c8a722881b

canonical string (\n are literal newline bytes):
POST\n/v1/register\n2026-06-10T12:00:00Z\nb7c8170d637df5d636f997d15ac1e16f5900c18f6271f838d7f9e6c8a722881b

X-VettID-Key      : 7UkoxijRwsbq6QM4kFmVYSlZJzpcY/k2NsFGFKyHN9E=
X-VettID-Timestamp: 2026-06-10T12:00:00Z
X-VettID-Sig      : 3K+q6jDs868+0XetrLQXlddh8iZtKYeu5GRq6RZajyxRPIdDVh0dCYlkX59qFgL/wEhxs+sSzsOyH02gpsBQDA==
```

The attestation's `user_data` for this request is
`SHA-256(canonical string)`. (The push token is a random placeholder in
APNs token shape; it corresponds to no device.)

## 16. End-to-end flow (informative)

```
1. app obtains an FCM/APNs token from the OS (after the member opted in)
2. app ──session (E2E)──▶ vault: push.register{platform, token, app_id, env?}
3. vault: new wake key; ──POST /v1/register + attestation──▶ gateway
4. gateway verifies, seals ──▶ vault keeps {wake key, wake_blob}; drops the token
5. ... a peer's message reaches the vault; the vault deposits feed.event /
   message.new into the app's mailbox (relay) ...
6. vault (debounced) ──POST /v1/wake {wake_blob}──▶ gateway
7. gateway opens the blob, sends the fixed payload ──▶ FCM / APNs ──▶ phone
8. Android FCM service / iOS extension ──collect──▶ relay; decrypt on the phone
9. local notification (names per the member's preview setting)
```

## 17. Changelog

- **0.4.1** — errata from the vault's N3 implementation (vettid-vault
  #59; pending owner approval): the event asking the app for a fresh
  token is `push.token-needed` (§11.1, §11.2), as VAULT-MESSAGING 0.24.1
  corrects it; 0.4.0's `push.token_needed` broke VAULT-MESSAGING §5.3's
  type grammar. The vault's handling of each gateway answer is
  VAULT-MESSAGING 0.24.1 §14.1 and §14.2.
- **0.4.0** — N2 design (owner request of 2026-10-10; revised after the
  owner's review of 2026-10-10: §12 rewritten, connections already use
  the channel through messaging, `https://`-only links, services with the
  service vault; at most one registration per vault, §3; iOS staging
  bundle ids, App Groups and keychain groups, the APNs environment of each
  build, Universal Links and a future IOS-PLAN, §10.4, §11.2, §14.1;
  questions 12 and 14 answered). **Stateless
  gateway**: 0.3.0's `wake_ref` registry is replaced by **wake blobs**
  sealed by the gateway and kept only by the vault (§4); endpoints are
  `POST /v1/register` and `POST /v1/wake` (no update, no delete); one
  wake key per registration (§3). **Attested registration**: a vault
  release's Nitro attestation checked against the signed release manifest
  (§5.1). **Fixed payloads** for FCM and APNs (§6): no content, no count,
  no cursor; APNs fallback "New activity in VettID", no collapse id and no
  interruption level in the payload; the `sync` class withdrawn.
  Synchronous failure feedback (`token_gone`, `blob_invalid`, §7);
  per-token and per-address limits in memory (§8); privacy section with
  timing correlation (§9); AWS deployment, secrets, FCM workload identity
  federation, staging and production, observability without personal
  data (§10); client behaviour for Android and iOS with the notification
  service extension (§11); principles for apps connected to VettID (§12);
  owner actions and open questions (§14); new test vector (§15). The vault
  side is VAULT-MESSAGING 0.24.0 §14.
- **0.3.0** — owner decision of 2026-10-09: no UnifiedPush. Removes the
  `unifiedpush` platform, the `webpush` keys, the distributor role, the
  Web Push wake, `Topic` collapse, the SSRF rules and the distributor's
  view in §8. Phones without Google services use the app's on-phone
  service (§11, ANDROID-PLAN D7), whose default order replaces 0.2.0's.
  The gateway stays for FCM and APNs. Adds the future direction (§1):
  apps and services connected to VettID use VettID's notification
  channel; no protocol yet.
- **0.2.0** — owner decision of 2026-10-03: both push paths are supported.
  Adds the `unifiedpush` platform (endpoint URL as the token, optional Web
  Push encryption keys, SSRF rules, `Topic` collapse, dead endpoints) and
  the distributor's view in §8; adds §11, devices without push (relay
  connection in a foreground service, or polling) and how the Android app
  chooses. VAULT-MESSAGING §14 (`push.register`) gains the new platform
  when push is specified there (VAULT-MESSAGING §15, item 3).
- **0.1.0** — initial draft: wake-ref registration/update/delete, notify and
  sync wake classes, collapse behavior, dead-token handling, unlinkability via
  dedicated wake keys, test vector.
