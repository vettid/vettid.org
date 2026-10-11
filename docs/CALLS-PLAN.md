---
title: CALLS-PLAN
status: draft for the owner's review
version: 0.1.0
date: 2026-10-11
owner: Al Liebl (Mesmer)
related:
  - STAGING-DEVELOPMENT-PLAN.md (0.1.1) §2 rules, §2.4 promotion, §5 phase 2
  - CALLING-SERVICE.md (0.1.1)
  - VAULT-MESSAGING.md (0.27.0) §10.10 calls, §7.3, §8.5, §10.4.1, §11.10.8, §14.2
  - RELAY-PROTOCOL.md (0.6.1) §6.2–§6.4, §7.2
  - PUSH-GATEWAY.md (0.4.3) §6, §14.2 item 13
  - ANDROID-PLAN.md (0.1.36) §4 Notification modes, §5, §6
  - VAULT-RELEASES.md (0.1.12) §8.4 egress
changelog:
  - 0.1.0: first draft. State read 2026-10-11 from vettid-vault
    `origin/main` (6b50425), vettid-relay `origin/main`, vettid-android
    `origin/master` (4e793592) and this repository (3a0f740); §11 has the
    references and what was not established
classification: public (no secrets; safe for github.com/vettid)
---

# 1:1 voice and video calls (plan)

## 1. Purpose and where we are

This is the plan for phase 2 of STAGING-DEVELOPMENT-PLAN §5: calls
between two connected members, built and proven on staging, reaching
production only through §2.4 there. It changes no code and no
infrastructure, and edits no other document: the edits it would need are
listed in §6.6. The owner's choices are in §9.

| Piece | State today | Where |
|---|---|---|
| Signalling spec | Written: seven `call.*` types, signed key shares, vault-signed ICE configuration | VAULT-MESSAGING §10.10 |
| Vault signalling | **Built and tested**, in every staging image (`calls` is on in S10, off in `prod.json`) | vettid-vault `features/calls`, `vms/callwire`, `features/all/all.go`, `enclave/releasecfg/*.json` |
| TURN credentials in the vault | The coturn issuer exists but **is not wired**: release builds pass no issuer, so every ICE configuration has an empty server list (no TURN, no STUN) | `cmd/vault-enclave/release.go:102`; `calls.NoServers` |
| Calling service (TURN) | **Specified, not built.** No repository, no stack | CALLING-SERVICE 0.1.1 |
| Relay | Nothing call-specific, and none needed (§6.2) | vettid-relay |
| Push wake for a ringing call | **Not built**: call signalling wakes nothing | VAULT-MESSAGING §14.2; `vault/push.go` `wakeClass` |
| Android app | **No call code.** Only the `calls` notification channel and the "Missed call from …" text exist | ANDROID-PLAN §4; `:core:notify` |
| Old implementations (reference only) | Old Android app (tag `legacy-v1-final`): `features/calling/*` on the prebuilt `io.getstream:stream-webrtc-android:1.3.10`, frame encryption through its `FrameCryptor`. Old iOS: `Features/Calling` with CallKit and PushKit. Old desktop: Rust `webrtc` 0.17 behind a feature flag. Old backend (vettid-dev): coturn on EC2 with Elastic IPs (`cdk/lib/turn-stack.ts`). None works with today's vault | the archived repositories |

Two facts shape everything below. **A locked vault cannot be called**: it
does not collect its mailbox (VAULT-MESSAGING §1.1 rule 4), so the offer
waits and the caller times out. And **the media key never reaches a
vault**: the two devices agree it, the vaults only pass the public halves
along and vouch for which device made them.

## 2. How a call works end to end

A = caller, B = callee. "Exists" means in vettid-vault `origin/main`.

| # | Step | Who does it | Exists? |
|---|---|---|---|
| 1 | A taps Call. The app makes a `call_id`, a fresh KEM key pair and an SDP offer, signs the public half with the device key, sends `call.start` | A's app | No |
| 2 | A's vault checks it is not busy, checks and vouches for the share, makes its signed ICE configuration, sends B's vault `call.offer` (expires in 45 s), answers the app | A's vault | Yes; the ICE list is empty (§1) |
| 3 | B's vault checks the vouched share against A's pinned key; if held, does nothing; if busy, answers `busy`; otherwise sends `call.offer` with **its own** ICE configuration to B's app and desktops in a session | B's vault | Yes |
| 4 | B's phone rings. How the offer reaches it depends on the notification mode (§2.1) | B's app | No |
| 5 | B's app sends `call.ringing`; A hears a ring-back tone | both vaults forward once | Vault yes, apps no |
| 6 | B answers. Only now does B's app open a peer connection and gather addresses (so that calling someone never reveals their IP address unanswered). It encapsulates to A's key, signs, sends `call.answer` | B's app | No |
| 7 | B's vault vouches, forwards to A's vault, tells B's other devices `answered_elsewhere`; A's vault checks and passes the answer to A's calling device only | both vaults | Yes |
| 8 | Both apps derive `k_call`, exchange `call.ice` candidates (batched, at most 16 per message, 256 messages a call) | apps; vaults forward from memory | Vault yes, apps no |
| 9 | Media flows device to device, or through TURN when no direct path exists (or when the member chose "always relay", §3). Every audio and video frame is encrypted under `k_call` on top of DTLS-SRTP | apps; the calling service | No |
| 10 | Either side hangs up: `call.end{hangup}` through both vaults; both record `call.ended` in the audit log | apps, vaults | Vault yes |

**The other endings.**

| Case | What happens | Exists? |
|---|---|---|
| Declined | Any of B's devices sends `call.end{decline}` while it rings; A sees "Declined"; B gets no missed call | Yes |
| Not answered | A's app sends `call.end{timeout}` at 45 s; B's vault records `call.missed` in the feed | Only if A's app sends it. **The vault has no timer**: if A's app dies first, B's devices stop ringing at `exp` by themselves but no missed call is recorded and the record stays `ringing` (§6.1 V2) |
| Busy | B's vault answers `call.end{busy}` and records a missed call | Yes |
| Callee held (daily check overdue) | No ring, no answer; A times out; B gets a missed call | Yes |
| Callee locked, or calls off in B's release | Nothing; A times out. B learns of it only if the offer is still meaningful after unlock (it is expired: no missed call today) | Yes (by absence) |
| Both call at once (glare) | Each vault is busy with its own outgoing call when the other's offer arrives, so **both calls end `busy`** and both get a missed call | That is what the code does; a tie-break is proposed (V6) |
| Network change mid-call (Wi-Fi to mobile) | ICE restart: a new offer/answer inside the same call | **Not specified**: `call.offer`/`call.answer` are once per call. Proposed: `call.update` (V7) |
| App killed mid-call | The peer's media stops; its app ends the call after ICE fails (about 30 s). The dead side's vault keeps the call `active`, and so **busy, for up to 12 h** unless the peer's `call.end` arrives | Gap (V3) |
| Connection removed or blocked during a call | Both sides' calls end `unavailable` | Yes |

### 2.1 Ringing, by notification mode

| B's phone | Path of the offer | Expected time to ring | State |
|---|---|---|---|
| App open | relay WebSocket the app already holds | under 1 s (§6.2) | Transport exists; no call UI |
| App closed, **on-phone service** (the default) | the same collector, in `VaultConnectionService` | under 1 s when awake. In Doze without "Allow in background" Android suspends the network and the call is missed (ANDROID-PLAN §4, 3) | Service exists; ringing from it does not |
| App closed, **Google push** | B's vault asks the push gateway for a wake; FCM high priority; the app starts, collects, rings | 2–5 s typical, more on a sleeping phone; **not measured**, and no Firebase project exists yet | Vault wake for calls not built (V4); gateway unchanged |
| Notifications off | none | never rings; a missed call when the app is next opened | By design |

The push stays content-free: the gateway and Google learn that a wake
happened, not that it was a call (§6.5 for what iOS will force later).

## 3. Privacy and security

**Who learns what.**

| Party | Learns | Does not learn |
|---|---|---|
| Relay | That a mailbox received deposits, their sizes and times, the depositor's relay key. A call is a burst of 10–30 small deposits; a traffic observer could guess "a call started" | Who, content, keys; message types are inside the envelope |
| Vault hosts (parent) | The same bursts for a vault | Anything inside the enclave |
| The vaults | Who called whom, when, how long, audio or video; SDP and candidates pass through in memory, so both members' IP addresses are visible to both vaults during setup. History: 200 calls, no SDP, no keys | `k_call`, media |
| Calling service (TURN) | Client IP addresses, allocation times and byte counts; with "always relay" on both sides, both members' addresses | Who the members are (credentials name no one, V8), content |
| Google (push mode only) | That VettID was woken, and when | That it was a call; from whom |
| The other member | With a direct path: the member's public IP address (roughly city and provider) and local network addresses. With relay only: nothing but the TURN server's address | — |
| Networks on the path | That the phone talks to a TURN server or to another address by UDP | Content |

**Direct or relayed.** A direct path is faster, keeps working if the
TURN service is down and costs nothing; it shows each member's IP address
to the other. Relaying hides it and costs bandwidth (§5.4) and some
delay. Connections are people the member approved one by one, so the
recommendation (D1) is **direct when possible by default, with one
switch "Always relay calls"** in Settings → Privacy, stored in the vault
so that it holds on every device; a per-connection override can follow.
Either way the callee gathers no addresses before answering (§2 step 6).

**Annoyance.** Today any active connection may ring, and the only limit
is 60 durable messages a minute per connection (VAULT-MESSAGING §7.3).
Calls are not "asks", so the cooldown and pause machinery of §10.4.1 does
not cover them, and muting a connection's asks does not mute its calls.
A connection could ring every 45 s without end, and while one call rings
every further offer becomes a high-priority missed-call item (and a push
wake). Proposed (V5): a per-connection **Calls: allowed / off** (off
answers nothing, like a locked callee, so it cannot be told from
absence), a limit on unanswered calls per connection (proposal: 3 in 10
minutes, 10 a day; beyond it no ring and one merged missed-call item with
a count), and blocking as today.

**Verification.** A call is bound to the connection's pinned identity:
each device checks the peer vault's signature under `peer_ik`, the same
key the connection's verification code (the SAS of §6.4) covers. No
separate per-call safety number is needed. **Rule for the app:** media
that does not decrypt under `k_call` is never played, because the SDP
itself is not signed (DTLS alone would not bind the call to the
connection). Residual, as specified: a member's own vault could swap
that member's shares.

**Never in the vault, logs or pushes:** media, `k_call`, SDP after
forwarding. The audit log and feed hold kinds and ids only (tested:
`calls.TestCallFlow`). The app has no recording feature; it cannot stop
the other side recording, and says nothing that suggests it can.
Android's own microphone and camera indicators show during a call.

## 4. The media stack on Android

No proprietary SDK is possible (F-Droid `foss` build, GrapheneOS). In
practice the choice is which build of libwebrtc (BSD-3-Clause with a
patent grant) to use; versions and sizes below were read from Maven
Central on 2026-10-11.

| Option | What it is | Frame encryption | F-Droid and reproducibility |
|---|---|---|---|
| **A. `io.github.webrtc-sdk:android` 150.7871.01** (2026-09-05; BSD-3-Clause; arm64 library 12.3 MB) | libwebrtc with the webrtc-sdk patches (the webrtc-sdk project; by its own description also built for iOS and desktop, not checked here) | **Built in**: `org.webrtc.FrameCryptor` (AES-GCM), the same API the old app used | A pinned Maven Central artifact is a fixed input, so the APK stays reproducible. F-Droid's policy admits free-licensed binaries from Maven Central; whether its reviewers accept this one is **not established** |
| B. `im.conversations.webrtc:webrtc-android` 149.0.0 (2026-09-09; Apache-2.0/MIT packaging; arm64 9.0 MB) | Unpatched libwebrtc, built for the Conversations app | Only the bare `FrameEncryptor`/`FrameDecryptor` hooks: VettID would write and maintain the cipher in C++ (NDK, JNI) | Same input rule. Conversations is distributed on F-Droid, so there is precedent; our own C++ would have to build reproducibly too |
| C. `io.getstream:stream-webrtc-android` 1.3.10 | What the old app used | `FrameCryptor` present | Last published 2025-09-11: stale, not proposed |
| D. Build libwebrtc ourselves | Google's source, our own artifact | As B, or carry patches | Over 20 GB of downloads and about an hour per build (F-Droid admin issue 364); the toolchain itself is downloaded prebuilt. Bit-for-bit reproducibility **not established**. Much work for little gain while A and B exist |
| E. Signal's RingRTC (`org.signal:ringrtc-android` 2.61.0) | Rust on a patched libwebrtc, shaped around Signal's signalling | Its own | AGPL (to be confirmed); a large adaptation; not proposed |
| F. No libwebrtc (Pion via gomobile, webrtc-rs, GStreamer) | Transport libraries without a phone-grade audio engine (echo cancellation, jitter buffer, hardware codecs) | — | Not realistic on a phone; webrtc-rs stays a candidate for the desktop later |

**Recommendation (D2): option A**, with B as the fallback if F-Droid
refuses A. A gives ready-made frame encryption (iOS and desktop later must
interoperate frame for frame, so one shared implementation matters) and
no security-critical C++ of our own. Its cost is trusting a
patched fork and a larger library (about 12 MB added per architecture).
It also means CALLING-SERVICE §7 changes from "ChaCha20-Poly1305,
SFrame-style" to the FrameCryptor's AES-GCM format, keyed from `k_call`.

**Codecs.** Audio: Opus (royalty-free, in every build). Video: VP8 as the
baseline every device can do in software; H.264 only through the phone's
own hardware codec (no codec code of ours, no licence question); VP9 and
AV1 off at first (AV1 software encoding is heavy on phones; hardware
support on the test phones not established).

**Android integration.**

| Topic | Proposal |
|---|---|
| Permissions | `RECORD_AUDIO`; `CAMERA` (already declared for QR scanning); `BLUETOOTH_CONNECT`; `MODIFY_AUDIO_SETTINGS`; `FOREGROUND_SERVICE_PHONE_CALL` with `MANAGE_OWN_CALLS` (Android requires the latter, or the dialer role, for the `phoneCall` service type); `USE_FULL_SCREEN_INTENT` |
| Service and ringing | A `CallService` foreground service of type `phoneCall` for the life of a call; ringing as a `CallStyle` notification on the existing `calls` channel, full screen when the phone is locked |
| Telecom | **Yes**, as a self-managed call through Jetpack `androidx.core:core-telecom` (part of Android, no Google services): VettID calls then behave beside mobile calls (hold, busy), Bluetooth and car buttons work, and the `phoneCall` rule is met |
| Audio routing | Earpiece, speaker, wired, Bluetooth through `AudioManager.setCommunicationDevice` (minimum SDK is 31, so only the current API); proximity sensor at the ear |
| Play | A declaration and a video per foreground service type. Since Android 14 the full-screen intent is granted by default only to apps whose main purpose is calling or alarms, so VettID may have to ask the member for it (to be confirmed at submission); without it the call rings as a banner |

**The spike (C0) must prove, before anything is committed:**

1. the `foss` flavour builds twice to the same APK with the library in
   it, and F-Droid's scanner (`fdroid scanner`, `fdroid build`) passes;
2. two test phones exchange Opus audio with `FrameCryptor` keyed from a
   32-byte key, and a wrong key gives silence, not noise or plain audio;
3. the exact key and frame format the `FrameCryptor` uses, written down
   well enough that iOS and a desktop can match it later;
4. `core-telecom`, the `phoneCall` service, microphone access after
   answering from a notification, and Bluetooth routing all work on
   GrapheneOS without Google services and on stock Android;
5. APK size and cold-start cost of the library.

## 5. The calling service

### 5.1 What CALLING-SERVICE 0.1.1 says, and what to change

It specifies coturn with a small sidecar in one container, time-limited
HMAC credentials issued **inside the vault** from a shared secret, a
vault-signed ICE configuration, and frame encryption above DTLS-SRTP.
It was written before the push gateway, the release channels and the
egress controls existed. Proposed changes:

| 0.1.1 | Proposed | Why |
|---|---|---|
| The shared secret lives in the vault; how it gets there is open (§10 q1; VAULT-MESSAGING §15 item 6) | **The secret never enters a vault.** A small issuer in the calling service gives short-lived credentials to **attested vaults only**, checked against the channel's signed manifest exactly as the push gateway checks registrations (PUSH-GATEWAY §5.1). The vault fetches a credential at unlock and renews it hourly (not per call, so call setup never waits on it), and puts it in its signed ICE configuration as today | One pattern for both services; no fleet-wide secret in every enclave; rotation touches one place. The app still gets servers only from its own vault, so the service never sees who a member is |
| `username = expiry:call_id` | `expiry:<random>` | The TURN log line can then be tied to nothing |
| "Relay additions": five new deposit types | Remove: the relay sees only ciphertext and has no notion of types | §6.2 |
| One container behind a CDK construct | coturn on an instance with its own public address; the issuer separately behind an Amazon certificate | TURN needs UDP and a relay port range that no load balancer fronts; the enclave pins Amazon's roots (VAULT-RELEASES §8.4), so the issuer cannot use the Let's Encrypt certificate coturn would |
| ChaCha20-Poly1305 SFrame | The media stack's FrameCryptor format (§4) | Interoperability across platforms |
| Managed overflow (Cloudflare) | Not now | One provider until there is load |

### 5.2 Shape on staging

- **Repository** `vettid/vettid-calls` (AGPL-3.0 like the others): the
  issuer (Go; the attestation verifier is shared with vettid-push), the
  coturn configuration and a reproducible image; README for
  self-hosters.
- **Account: staging** (347272280361), not the main account. The push
  gateway went to the main account only to share the relay's load
  balancer; TURN shares nothing, and a public UDP relay is the piece
  most likely to be probed, so it stays away from the relay and the
  production data (D3).
- **Stack** `VettidOrgStageCallsStack`, us-east-1, one region: its own
  small VPC; one `t4g.small` with an Elastic IP, IPv4 and IPv6, in an
  Auto Scaling group of one; coturn on 3478 UDP and TCP, 443 TCP with
  TLS (for networks that allow nothing else), relay ports 49152–65535
  UDP; the issuer as a Lambda function behind an API Gateway custom
  domain (`calls.staging.vettid.org`, ACM certificate); the shared
  secret in Secrets Manager, read by both, rotated monthly with the
  previous one accepted for a day. Names: `turn.staging.vettid.org`.
- **Vault side:** a release constant `calls_url` per channel; the host
  name added to the parent's allowlist and to `lib/vault/egress.ts`; the
  STUN and TURN URLs come back from the issuer, so moving servers needs
  no vault release.

### 5.3 Abuse and observability

- coturn: `use-auth-secret`; no TCP relaying; peers in private,
  loopback, link-local and metadata ranges denied (a TURN server is
  otherwise a door into its own network); per-allocation bandwidth cap
  (proposal 3 Mbit/s), a total cap and a per-address allocation limit.
- Issuer: attested callers only; a rate limit per source address; a
  credential lives 6 h at most.
- Logs: counters only (allocations, bytes relayed, authentication
  failures, issuer requests and refusals). No client addresses or
  usernames kept, no flow logs on this VPC (they would be a record of
  who called when). Alarms on bandwidth and on authentication failures.

### 5.4 Cost (estimate, us-east-1 list prices; not a measurement)

| | USD |
|---|---|
| `t4g.small`, always on ($0.0168/h, read from the price API 2026-10-11) | 12.3 a month |
| Public IPv4 ($0.005/h, as on the staging bill) | 3.7 a month |
| Disk, secret, DNS, issuer, logs | about 2 a month |
| **Idle total** | **about 18 a month** |
| Relayed voice: about 50–80 kbit/s each way, both directions leave the server; 45–72 MB an hour at $0.09/GB | under 0.01 per call hour |
| Relayed video (720p, 1–2.5 Mbit/s each way): 0.9–2.3 GB an hour | 0.08–0.20 per call hour |

The first 100 GB a month of an account's outbound data is free, which
covers roughly 45 hours of relayed video: on staging the traffic cost is
expected to be zero. Direct calls cost nothing. Proposed ceiling (D8):
$30 a month, with a billing alarm.

## 6. What changes in each component

### 6.1 Vault (all need a staging release; `calls` stays off in production)

| # | Change | Why (found by reading the code) |
|---|---|---|
| V1 | Wire an ICE issuer that fetches credentials from the calling service (§5.1); `calls_url` constant | `release.go:102` passes none; `Coturn` assumes a secret in the vault |
| V2 | End a ringing call at its `exp` from housekeeping: `timeout`, `call.end` to the devices, a missed call for incoming | No timer exists; housekeeping runs with every collect, at least every 25 s |
| V3 | A liveness rule for active calls: the call's device sends a keep-alive (proposal: every 30 s; the call ends after 90 s of silence), and an app that restarts ends its stale call | Today a dead device leaves the vault busy for up to 12 h |
| V4 | A push wake for `call.offer` to the app, exempt from the 5 s debounce and counted separately from the hourly cap | `wakeClass` wakes only for feed items, `vault.held` and the alarm |
| V5 | Per-connection call permission, a limit on unanswered calls, missed calls merged per connection (§3) | No call-specific limit exists |
| V6 | Glare: when an offer arrives from the connection the vault is itself calling, the call with the lower `call_id` wins and the other ends quietly | Both end `busy` today |
| V7 | `call.update` (a new offer/answer inside an active call) for network changes and for adding or dropping video | Not in §10.10 |
| V8 | TURN usernames carry a random part, not the `call_id` | §5.1 |
| V9 | "Always relay" as a vault setting, carried in the signed ICE configuration as a policy the devices obey | So one switch covers every device |

Not changed: the key agreement, the signatures, one call at a time, no
handoff, desktops ring within a session (already in the code and tested
by `e2e.TestDesktopCalls`, so nothing here designs desktops out).

**What a connection can do today to a staging vault whose owner never
used calls:** send `call.offer`; the vault records it, sends the offer to
an app that ignores it, and after the caller gives up records a missed
call, which the app already shows as "Missed call from …". In production
(`calls` off) the same message is an unknown type and nothing happens.

### 6.2 Relay: no change

Call signalling is ordinary deposits. The relay never sees message types,
an offer (SDP at most 32 KiB plus a 1.2 KiB key) is far below the 256 KiB
payload limit, order per mailbox is arrival order, and a parked collector
is woken the moment a deposit commits (`internal/api/hub.go`; across
relay processes through the wake bus). CALLING-SERVICE §9's "relay
additions" is a misnomer. No relay release is needed.

**Latency.** An offer makes four relay hops (A's app → A's vault → B's
vault → B's app) and two vault state writes. A request to the relay took
18–20 ms on a warm connection from the workstation on 2026-10-11; a
phone adds its own network time at each end. Reasoned, not measured:
**0.3–1 s from tap to ring** when B's app or on-phone service is
connected, so ringing within two seconds is achievable there. C1's exit
test measures it.

Two limits to watch, neither needing a code change: the relay's
per-sender limit is 5 deposits a second with a burst of 20, so the app
must batch ICE candidates (the vault already caps them); and the per-IP
limit of 20 requests a second covers every vault on one host, since the
enclave's traffic leaves through the host's one address. Fine on
staging; to be checked against a full production host before calls reach
production (no exemption for vault hosts was found in
`internal/api/middleware.go`).

### 6.3 Member API and portal: nothing

Calls need no account route. The only backend work is the new stack and
the egress entry (§5.2).

### 6.4 Android

New modules: `:core:calls` (the media stack behind an interface, call
state machine, `CallService`, Telecom, audio routing; no UI) and
`:feature:calls` (screens). `:core:vault` gains the seven call types and
`callwire` (the share signatures and the key derivation, against the
vault's vectors); `:core:notify` rings from the on-phone service and
from a push wake.

| Screen or surface | States | Texts to specify later |
|---|---|---|
| Call buttons on a connection and in a conversation | enabled; disabled (vault locked, calls off for this connection, no microphone permission) | reasons for each disabled state |
| Outgoing call | calling; ringing; connecting; declined; busy; no answer; failed | one line per ending |
| Incoming call (full screen and notification) | ringing; answered on another device | "<First Last> is calling", Answer, Decline |
| In call | audio; video; reconnecting; relayed or direct indicator; muted; speaker, Bluetooth | the encryption line; "Reconnecting…" |
| Permission prompts | microphone, camera, Bluetooth, full-screen intent | why each is asked |
| Call history (in the conversation; a list later) | outgoing, incoming, missed, with duration | — |
| Settings → Privacy → Calls | Always relay calls; per connection: Calls allowed / off | the explanation of what relaying hides |
| Settings → Notifications | "Calls ring only while the vault is unlocked"; the battery line for the on-phone service | — |

### 6.5 Push gateway

Android: nothing; the fixed payload is already high priority and a wake
means "collect everything". Its 24 h lifetime is harmless: a late wake
finds an expired offer and a missed call. **iOS later** needs a second,
distinct wake: a PushKit VoIP push, which Apple requires to be reported
to CallKit at once. That makes "this wake is a call" visible to the
gateway and to Apple, and is a PUSH-GATEWAY change for the iOS phase;
V4's wake class in the vault is named so that it can carry over.

### 6.6 Proposed edits to other documents (not made in this PR)

- **VAULT-MESSAGING**: §10.10 (V2–V9: timeouts, keep-alive, glare,
  `call.update`, permission and limits, the relay policy in the ICE
  configuration, the issuer; "the callee gathers no candidates before
  answering"; "media not decrypted under `k_call` is never played");
  §10.4 `connection.update` (the calls permission); §10.9 (merged missed
  calls); §11.10.8 (`calls_url`); §14.2 (the call wake); §15 item 6
  (closed by §5.1) and item 32.
- **CALLING-SERVICE**: the table of §5.1; §10's open questions answered
  or restated.
- **ANDROID-PLAN**: §4 (the screens of §6.4, the Mapping row for
  ringing), §5 (two modules, permissions, the `phoneCall` service), §6
  (phases C0–C6), §8 risks.
- **RELAY-PROTOCOL**: nothing normative; Appendix A may note that call
  wakes use the same pattern.
- **PUSH-GATEWAY**: §14.2 item 13 answered for Android ("no change");
  the iOS VoIP wake recorded as future work.
- **VAULT-RELEASES** §8.4 and `lib/vault/egress.ts`: the calling
  service's issuer host. **RUNBOOK**: a "Calling service" section.
  **STAGING-DEVELOPMENT-PLAN** §5 row 2 and §8.4: the relay question is
  answered (no change).

## 7. Phasing on staging

Test phones: Pixel 10 Pro (GrapheneOS, no Google services), Pixel 7
(stock Android), the owner's Pixel 9 Pro (GrapheneOS). Effort is working
days of implementation and review, as ranges; owner testing is extra.

| Phase | Contents | Exit test on real phones | Needs | Effort |
|---|---|---|---|---|
| C0 | Spike (§4): library in the `foss` flavour, audio between two phones on one Wi-Fi with hard-coded signalling, frame encryption, Telecom | The five proofs of §4, written up; the owner confirms D2 | Nothing deployed | 5–8 |
| C1 | Voice calls through two staging vaults, app open, same network (the vault gives no servers yet) | Pixel 10 Pro ↔ Pixel 7 on S10: call, ring-back, answer, hang up, decline, busy, no answer; time from tap to ring measured 20 times | **No vault release** (S10 as it is) | 12–18 |
| C2 | The calling service on staging; vault fixes V1–V3, V5, V6, V8 | The same calls with one phone on mobile data and one on Wi-Fi; app killed mid-call frees both vaults within 2 minutes; glare connects one call | New service and stack; **a vault release**; host stack deploy (egress) | 12–20 |
| C3 | Ringing with the app closed | On-phone service: rings within 2 s on both kinds of phone, screen off, including after a reboot; behaviour in Doze recorded. Google push on the Pixel 7 once Firebase exists (does not block the phase) | **A vault release** for V4 (can ride with C2's) | 6–10 |
| C4 | Video: camera, switching cameras, adding video to a voice call, network change (V7) | Video both ways for 10 minutes; walk from Wi-Fi to mobile data without the call dropping | A vault release (V7) | 8–14 |
| C5 | "Always relay" (V9) and hostile networks | A call with relay forced on both sides (both on one TURN server: the old backend ran two servers because this case failed there); a call from a network allowing only TCP 443; neither side's address visible to the other in a packet capture | A vault release (V9) | 5–8 |
| C6 | Hardening: call limits and spam, battery over 24 h idle and an hour's call, Bluetooth and wired headsets, a mobile call arriving during a VettID call, accessibility, texts | A written test sheet passed on all three phones | App only | 8–12 |
| Promotion | STAGING-DEVELOPMENT-PLAN §2.4: specs merged, a published staging release, both kinds of phone, a move to the next release with call history intact, seven quiet days, the production calling service deployed, the owner's approval | — | A production vault release with `calls` listed; a production calling service | 3–5 plus the seven days |

Total: roughly 60–95 working days. No phase needs a relay release.
At most two staging releases a week (§2.1 there) is not a constraint:
three or four vault releases cover C2–C5.

## 8. Out of scope for now

- **Group calls.** A different service (a media router), never this one.
- **Desktop calls.** Required later. Already kept open: the vault rings
  desktops within a session, first answer wins, shares are device-signed
  and vault-vouched. Not to be designed out: the frame format must be
  one a desktop can implement (§4 proof 3), and nothing in the app may
  assume the member has one device.
- **Call handoff between devices.** Never (owner, 2026-10-03): end the
  call and start a new one.
- **iOS.** Later. To keep in mind: CallKit must show every VoIP push as
  a call, so iOS cannot use a content-free generic wake for ringing
  (§6.5); the media stack must exist for iOS (to be checked
  for option A in C0).
- **Phone-network calls**, voicemail, call recording, calls with
  non-connections.

## 9. Owner decisions

Answer "all good" or name the exceptions.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Direct or always-relayed media by default | **Direct when possible**, with a switch "Always relay calls" that hides the IP address. Connections are people you approved; direct is faster and free. |
| D2 | The media stack | **`io.github.webrtc-sdk:android`** (libwebrtc with built-in frame encryption), confirmed or replaced after the C0 spike; fallback the Conversations build with our own cipher. |
| D3 | Where the calling service runs on staging | **The staging account**, one small instance in us-east-1, in its own network. The production home is decided at promotion. |
| D4 | Who issues TURN credentials | **The calling service, to attested vaults only**; the shared secret never enters a vault. This adds one host name to the vaults' egress list. |
| D5 | Voice before video | **Yes**: voice is usable from C1–C3; video follows in C4 on the same plumbing. |
| D6 | Call permission for a new connection | **Allowed**, with "Calls: off" per connection and the limit on unanswered calls. "Ask each time" adds nothing: ringing is the ask. |
| D7 | Missed calls in the feed with the caller's name | **Yes**, as the app already does ("Missed call from <First Last>"), following the member's "Show in notifications" choice; repeated ones merge into one item with a count. |
| D8 | Ring timeout, and the TURN cost ceiling on staging | **45 s** (as built; the spec allows up to 90). **$30 a month**, with a billing alarm. |
| D9 | Telecom integration and the full-screen ringing permission | **Yes to both**: calls behave like calls beside mobile calls; if Android does not grant the full-screen permission the call rings as a banner. |
| D10 | "Busy" tells a connection that the member is on another call | **Keep** (it is what callers expect); the alternative is to answer nothing, as a held vault does. |
| D11 | Change CALLING-SERVICE §7's cipher to the media stack's built-in one (AES-GCM) | **Yes**, if the spike documents the format; writing our own cipher in C++ is the larger risk. |

## 10. Risks

| # | Risk | Answer |
|---|---|---|
| 1 | F-Droid refuses the prebuilt library, or the `foss` build stops being reproducible | C0 proves it first; fallback option B, then D. Nothing else starts before C0 ends |
| 2 | Ringing is unreliable when the phone sleeps (on-phone service in Doze; FCM delays; no Firebase project yet) | Measured in C3; the app says plainly when background use is not allowed. This is the weakest point of a no-Google design and may stay imperfect |
| 3 | A locked vault cannot be called, and members will not expect that | Said in the app (§6.4); an enclave restart locks every vault on the host, so calls stop until each member unlocks |
| 4 | The fork behind option A slows down or changes its frame format | Version pinned; the format written down (C0 proof 3); B remains possible |
| 5 | The TURN server is abused as a free relay or as a way into its network | §5.3; its own account-level alarm and ceiling (D8) |
| 6 | Relay-only calls fail when both sides use the same TURN server (seen in the old backend) | Tested in C5; a second server costs about $16 a month |
| 7 | Android or Play policy on `phoneCall` services and full-screen intents changes | Confirmed at submission; the F-Droid and direct builds are unaffected |
| 8 | Calls add bursts to the shared production relay from staging | Small (tens of deposits a call); no load testing against it (STAGING-DEVELOPMENT-PLAN §3 risk 6) |
| 9 | Effort: the app side is the bulk and has no code to start from | Phases are cut so that each ends in something the owner can use |

## 11. Facts

Read 2026-10-11, at the commits in the changelog.

| Claim | Source |
|---|---|
| Types and roles: `call.start`, `call.list` (app, desktop); `call.offer` (connections only); `call.answer`, `call.end`, `call.ice`, `call.ringing` (devices and connections; the last two ephemeral) | vettid-vault `features/calls/calls.go` `Types()` |
| Limits: offer 45 s, ephemeral 30 s, ICE credentials 6 h, busy for at most 12 h, SDP 32 KiB, 16 candidates of 1,024 bytes, 256 ICE messages a call, 200 calls kept | same file, constants |
| State: one record per call, no SDP or keys. Audit `call.outgoing`, `.incoming`, `.answered`, `.ended`, `drop.call_share`; feed `call.missed` (high) | same file; `calls_test.go` `TestCallFlow` |
| No timers; glare ends `busy` | nothing time-driven in `features/calls`; `start` then `offer` → `busyExcept`. `housekeeping` (`vault/outbox.go:327`) runs per batch; long-poll wait 25 s (`vault/relay.go:151`) |
| ICE issuer not wired | `cmd/vault-enclave/release.go:102`; `features/all/all.go` (`ICE` nil → `calls.NoServers`); `docs/V4-NOTES.md` "Not in batch 2" |
| Calls wake nothing | `vault/push.go` `wakeClass`; VAULT-MESSAGING §14.2 |
| 60 durable messages a minute per connection; ephemeral not counted | `vault/inbound.go` `PeerRateLimit`, `dispatch` |
| A locked vault does not collect | VAULT-MESSAGING §1.1 rule 4 |
| The vault collects by long-poll | `enclave/vaultproc/vaultproc.go:196` |
| Relay limits (payload 262,144 bytes; per IP 20/s burst 40; per sender 5/s burst 20), none overridden in deployment; wake-on-deposit | vettid-relay `internal/config/config.go`, `internal/api/hub.go`, `internal/coord/wake.go`; `lib/stacks/relay-stack.ts` here |
| Egress: exact host names, Amazon roots pinned | `lib/vault/egress.ts`; VAULT-RELEASES §8.4 |
| App: no call code; service type `specialUse`; minimum SDK 31 | vettid-android `core/notify/…/VaultConnectionService.kt`, `build-logic/…/VettIdBuild.kt` |
| Library versions, dates, licences, sizes, `FrameCryptor` present or not | `maven-metadata.xml`, POMs and archive listings on repo1.maven.org |
| F-Droid policy; libwebrtc build cost; `phoneCall` rule; Play declarations | f-droid.org/en/docs/Inclusion_Policy; gitlab.com/fdroid/admin/-/issues/364; developer.android.com "Foreground service types"; support.google.com/googleplay/android-developer/answer/13392821 (read as search summaries, not in full) |

**Not established** (and how to find out):

- Whether F-Droid accepts option A, and whether today's Conversations
  build on F-Droid uses the Maven artifact: fdroiddata's metadata and
  F-Droid's own tools (C0).
- The FrameCryptor's key derivation and frame layout: the webrtc-sdk
  source (C0).
- RingRTC's licence; hardware AV1 on the test phones; whether coturn
  re-checks a credential's expiry during a long call (6 h credential,
  12 h call): upstream sources and a C2 test.
- Every latency here except the one relay round trip; the vault's state
  write was not timed. FCM wake delivery times (no Firebase project).
- The exact Android 14+ rule for full-screen intents, and `core-telecom`
  on GrapheneOS: the Play article in full, and C0.
- Prices other than the instance's are list prices as known, not read
  from the price API.
