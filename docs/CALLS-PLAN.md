---
title: CALLS-PLAN
status: approved by the owner 2026-10-11 (D1–D11 as recommended; D1 with the owner's position of §3.1) and 2026-10-12 (§13, D12–D26 as recommended; D23 as (c))
version: 0.1.3
date: 2026-10-12
owner: Al Liebl (Mesmer)
related:
  - STAGING-DEVELOPMENT-PLAN.md (0.1.2) §2 rules, §2.4 promotion, §5 phase 2
  - CALLING-SERVICE.md (0.2.0, approved by the owner 2026-10-12; 0.1.1 is what §5.1 describes)
  - VAULT-MESSAGING.md (0.28.0) §10.10 calls, §7.3, §8.5, §10.4.1, §11.10.8, §14.2
  - RELAY-PROTOCOL.md (0.7.1) §6.2–§6.4, §7.2 (rewritten in 0.7.0: limits per key)
  - PUSH-GATEWAY.md (0.4.4) §6, §14.2 item 13
  - ANDROID-PLAN.md (0.1.37) §4 Notification modes, §5, §6
  - VAULT-RELEASES.md (0.1.19) §5.2 `calls_url`, §8.4 egress
  - vettid-android #123 (the C0 spike, not for merge) and its docs/calls/C0-FRAME-FORMAT.md
changelog:
  - 0.1.0: first draft. State read 2026-10-11 from vettid-vault
    `origin/main` (6b50425), vettid-relay `origin/main`, vettid-android
    `origin/master` (4e793592) and this repository (3a0f740); §11 has the
    references and what was not established
  - 0.1.1: approved by the owner 2026-10-11 ("i am good with it with
    the recommendations"). His question, "do we need stun and turn? i
    am not concerned about connected users seeing each other's IP",
    is answered in the new §3.1: both are still needed, TURN only as
    the fallback. Following from his position: direct media is the
    default with no reservation; the "Always relay calls" switch (V9)
    is deferred; C5 becomes the fallback and hostile-network phase and
    measures how often TURN is needed (§3, §6.1, §6.4, §7, §9, §10)
  - 0.1.2: decisions and findings since approval, in the new §12: the
    results of C0 (vettid-android #123 and its two-phone test of
    2026-10-12); the media stack confirmed (D2); AES-128-GCM frames
    for now, and cipher agility as a goal (D11); a universal APK, no
    ABI splits (owner, 2026-10-12); calls code in non-production builds
    only, and one `call.list` after unlock to learn whether a vault has
    calls; Telecom and its GrapheneOS proof move to C3. Sentences that
    had become false are corrected in place, each marked "0.1.2" (§4,
    §6.2, §6.4, §7, §8, §9, §11). The plan is otherwise unchanged and
    stays approved
  - 0.1.3 (2026-10-12): phase C2, in the new §13: its work by
    repository, the order, the exit test in measurable steps, and the
    owner decisions it needs (D12–D26), each with options and a
    recommendation. Written because the owner said on 2026-10-12 to
    start the C2 design so that C2 can begin as soon as C1's two-phone
    test passes. The edits that §6.6 and §12.7 listed for
    CALLING-SERVICE, VAULT-MESSAGING §10.10 and VAULT-RELEASES are made
    with this version (CALLING-SERVICE 0.2.0, VAULT-MESSAGING
    0.28.0, VAULT-RELEASES 0.1.19). Sentences that C2's design changes
    are marked "0.1.3" (§5.2, §6.6, §7, §12.7). **Approved by the
    owner 2026-10-12** on vettid.org #243 ("d23 should be c, all other
    d recommendations are approved"): D12–D22 and D24–D26 as
    recommended; D23 as (c), the app never pins a connection's identity
    key itself (§13.5)
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
| 9 | Media flows device to device, or through TURN when no direct path exists Every audio and video frame is encrypted under `k_call` on top of DTLS-SRTP | apps; the calling service | No |
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
| Calling service (TURN) | Client IP addresses, allocation times and byte counts | Who the members are (credentials name no one, V8), content |
| Google (push mode only) | That VettID was woken, and when | That it was a call; from whom |
| The other member | With a direct path: the member's public IP address (roughly city and provider) and local network addresses. When a call falls back to TURN: only the TURN server's address | — |
| Networks on the path | That the phone talks to a TURN server or to another address by UDP | Content |

**Direct or relayed (decided, D1).** Media goes directly between the
two phones whenever a direct path exists, and through TURN only when
none does. Each member's IP address is then visible to the other; the
owner accepts that between connections (2026-10-11: "they are connected
and should be trusted"). The callee still gathers no addresses before
answering (§2 step 6), which costs nothing.

### 3.1 Are STUN and TURN still needed? Yes, both

- **STUN** is how a phone behind a home router or a mobile network
  learns its own public address, so that the two phones can find a
  direct path at all. Without it only two phones on the same network
  can connect. It reveals the address to the phone itself and, through
  the signalling, to the other party, which is accepted above. It
  carries no media and costs nothing to run.
- **TURN** is the fallback for calls where no direct path exists: both
  sides behind strict (symmetric or carrier-grade) NAT, restrictive
  firewalls, some mobile and office networks. Without it those calls do
  not connect at all; they do not degrade, they fail. How often: it is
  commonly cited as roughly one call in five to ten on mobile networks.
  That is general experience, **not measured for VettID**; measuring it
  is an exit criterion of C5 (§7).
- Both are the same coturn server (§5): nothing extra is deployed for
  STUN.

What the owner's position changes:

1. Direct by default is confirmed without a privacy reservation, so TURN
   carries only fallback traffic. The cost of §5.4 is then mostly the
   idle $18 a month, and the $30 ceiling is comfortable.
2. **"Always relay calls" is deferred** (V9 and its setting are not
   built now). It is not free: a vault setting, a policy in the signed
   ICE configuration, a vault release, and the relay-to-relay case that
   failed in the old backend (§10 risk 6) to make work. With no privacy
   need behind it, that is not worth it yet. It can be added later
   without changing anything built here; the app keeps a forced-relay
   option in debug builds only, to test the fallback.
3. Same-network calls (C1) can go to staging testers before the calling
   service exists, as §7 already has it. Calls across networks wait for
   C2: today's vault gives its devices no servers at all, not even
   STUN (§1), and the app may use only servers its vault signs.

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
| **A. `io.github.webrtc-sdk:android` 150.7871.01** (2026-09-05; BSD-3-Clause; arm64 library 12.3 MB) | libwebrtc with the webrtc-sdk patches (the webrtc-sdk project; 0.1.2: it also publishes iOS/macOS, desktop C++ and Rust builds with the frame cryptor, §12.1) | **Built in**: `org.webrtc.FrameCryptor` (AES-GCM; 0.1.2: AES-128-GCM only, §12.3), the same API the old app used | A pinned Maven Central artifact is a fixed input, so the APK stays reproducible. F-Droid's policy admits free-licensed binaries from Maven Central; whether its reviewers accept this one is **not established** |
| B. `im.conversations.webrtc:webrtc-android` 149.0.0 (2026-09-09; Apache-2.0/MIT packaging; arm64 9.0 MB) | Unpatched libwebrtc, built for the Conversations app | Only the bare `FrameEncryptor`/`FrameDecryptor` hooks: VettID would write and maintain the cipher in C++ (NDK, JNI) | Same input rule. Conversations is distributed on F-Droid, so there is precedent; our own C++ would have to build reproducibly too |
| C. `io.getstream:stream-webrtc-android` 1.3.10 | What the old app used | `FrameCryptor` present | Last published 2025-09-11: stale, not proposed |
| D. Build libwebrtc ourselves | Google's source, our own artifact | As B, or carry patches | Over 20 GB of downloads and about an hour per build (F-Droid admin issue 364); the toolchain itself is downloaded prebuilt. Bit-for-bit reproducibility **not established**. Much work for little gain while A and B exist |
| E. Signal's RingRTC (`org.signal:ringrtc-android` 2.61.0) | Rust on a patched libwebrtc, shaped around Signal's signalling | Its own | AGPL (to be confirmed); a large adaptation; not proposed |
| F. No libwebrtc (Pion via gomobile, webrtc-rs, GStreamer) | Transport libraries without a phone-grade audio engine (echo cancellation, jitter buffer, hardware codecs) | — | Not realistic on a phone; webrtc-rs stays a candidate for the desktop later |

**Recommendation (D2): option A**, with B as the fallback if F-Droid
refuses A. A gives ready-made frame encryption (iOS and desktop later must
interoperate frame for frame, so one shared implementation matters) and
no security-critical C++ of our own. Its cost is trusting a
patched fork and a larger library (about 12 MB added per architecture;
0.1.2: 48.5 MB for the universal APK that is built, §12.4).
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

*0.1.2:* proofs 2, 3 and 5 are done, proof 1 in part, proof 4 not: it
moves to C3 (§12.1, §12.6).

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
- *0.1.3:* two stacks, `VettidOrgCallsDataStack` and
  `VettidOrgCallsStack`; the issuer behind CloudFront, not API Gateway;
  TLS on 443 in C5, not C2 (CALLING-SERVICE 0.2.0 §8.2, §4.3; D17, D18).
  The paragraph below is as approved.
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
| V9 | **Deferred (0.1.1, §3.1).** "Always relay" as a vault setting, carried in the signed ICE configuration as a policy the devices obey | So one switch covers every device; not needed while direct media is accepted |

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
`internal/api/middleware.go`). *0.1.2:* RELAY-PROTOCOL 0.7.0 (§7.2
there) replaces the per-address limit by limits per key, so a host's
vaults no longer share one budget; this paragraph describes a relay
before it.

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
| Call buttons on a connection and in a conversation | enabled; disabled (vault locked, calls off for this connection, no microphone permission); 0.1.2: **absent** in a build without calls code, and hidden for a vault that answers `call.list` with `unsupported_type` (§12.5) | reasons for each disabled state |
| Outgoing call | calling; ringing; connecting; declined; busy; no answer; failed | one line per ending |
| Incoming call (full screen and notification) | ringing; answered on another device | "<First Last> is calling", Answer, Decline |
| In call | audio; video; reconnecting; relayed or direct indicator; muted; speaker, Bluetooth | the encryption line; "Reconnecting…" |
| Permission prompts | microphone, camera, Bluetooth, full-screen intent | why each is asked |
| Call history (in the conversation; a list later) | outgoing, incoming, missed, with duration | — |
| Connection settings | Calls allowed / off ("Always relay calls" is deferred, §3.1) | — |
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

*0.1.3:* the edits to CALLING-SERVICE, to VAULT-MESSAGING §10.10,
§11.10.8 and §15 item 6, and to VAULT-RELEASES §8.4 are now made and
approved (2026-10-12), for C2's part (V1–V3, V5, V6, V8). V4 (§14.2) is
C2's first spec follow-up: it rides in C2's vault release (D24) and its
text is to be written and approved before that release is cut. V7 (`call.update`), ANDROID-PLAN, PUSH-GATEWAY, RUNBOOK and
STAGING-DEVELOPMENT-PLAN are still to do.

- **VAULT-MESSAGING**: §10.10 (V2–V8: timeouts, keep-alive, glare,
  `call.update`, permission and limits, the issuer; "the callee gathers no candidates before
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
| C0 | Spike (§4): library in the `foss` flavour, audio between two phones on one Wi-Fi with hard-coded signalling, frame encryption, Telecom (0.1.2: done except Telecom, which moves to C3; results in §12.1) | The five proofs of §4, written up; the owner confirms D2 | Nothing deployed | 5–8 |
| C1 | Voice calls through two staging vaults, app open, same network (the vault gives no servers yet) | Pixel 10 Pro ↔ Pixel 7 on S10: call, ring-back, answer, hang up, decline, busy, no answer; time from tap to ring measured 20 times | **No vault release** (S10 as it is) | 12–18 |
| C2 | The calling service on staging; vault fixes V1–V3, V5, V6, V8; 0.1.3: also the media suites as signed members and key confirmation (§12.3), detailed in §13 | The same calls with one phone on mobile data and one on Wi-Fi; app killed mid-call frees both vaults within 2 minutes; glare connects one call (0.1.3: in measurable steps, §13.4) | New service and stack; **a vault release**; host stack deploy (egress) | 12–20 (0.1.3: 14–22, for the added scope, §13.6) |
| C3 | Ringing with the app closed; 0.1.2: Telecom (`core-telecom`, the `phoneCall` service, `CallStyle`, answering from a notification) and its proof on GrapheneOS and stock, moved here from C0 and C1 (§12.6) | On-phone service: rings within 2 s on both kinds of phone, screen off, including after a reboot; behaviour in Doze recorded. Google push on the Pixel 7 once Firebase exists (does not block the phase) | **A vault release** for V4 (can ride with C2's) | 6–10 |
| C4 | Video: camera, switching cameras, adding video to a voice call, network change (V7) | Video both ways for 10 minutes; walk from Wi-Fi to mobile data without the call dropping | A vault release (V7) | 8–14 |
| C5 | The TURN fallback and hostile networks | A call from a network allowing only TCP 443; a call with relay forced on one side and on both (debug option; both on one TURN server: the old backend ran two servers because this case failed there); **the share of calls that needed TURN, counted over at least 50 real calls on mobile data and home networks** (the app records direct or relayed per call, locally) and written into this plan | App only (0.1.3: and a stack deploy for TURN over TLS on 443, which D18 puts here) | 4–7 |
| C6 | Hardening: call limits and spam, battery over 24 h idle and an hour's call, Bluetooth and wired headsets, a mobile call arriving during a VettID call, accessibility, texts | A written test sheet passed on all three phones | App only | 8–12 |
| Promotion | STAGING-DEVELOPMENT-PLAN §2.4: specs merged, a published staging release, both kinds of phone, a move to the next release with call history intact, seven quiet days, the production calling service deployed, the owner's approval | — | A production vault release with `calls` listed; a production calling service | 3–5 plus the seven days |

Total: roughly 60–95 working days. No phase needs a relay release.
At most two staging releases a week (§2.1 there) is not a constraint:
two or three vault releases cover C2–C4.

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
  (§6.5); the media stack must exist for iOS (0.1.2: it does for
  option A, §12.1; its option parity was not read).
- **Phone-network calls**, voicemail, call recording, calls with
  non-connections.

## 9. Owner decisions

**Answered (owner, 2026-10-11): all as recommended**, with one position
on D1: seeing each other's IP address is not a concern between
connections (§3.1).

| # | Decision | Recommendation |
|---|---|---|
| D1 | Direct or always-relayed media by default | **Decided: direct when possible**, TURN as the fallback only. STUN and TURN are both still needed (§3.1). The "Always relay calls" switch recommended in 0.1.0 is deferred: no privacy need, and it is not cheap. |
| D2 | The media stack | **`io.github.webrtc-sdk:android`** (libwebrtc with built-in frame encryption), confirmed or replaced after the C0 spike; fallback the Conversations build with our own cipher. *0.1.2: confirmed after C0 (§12.2).* |
| D3 | Where the calling service runs on staging | **The staging account**, one small instance in us-east-1, in its own network. The production home is decided at promotion. |
| D4 | Who issues TURN credentials | **The calling service, to attested vaults only**; the shared secret never enters a vault. This adds one host name to the vaults' egress list. |
| D5 | Voice before video | **Yes**: voice is usable from C1–C3; video follows in C4 on the same plumbing. |
| D6 | Call permission for a new connection | **Allowed**, with "Calls: off" per connection and the limit on unanswered calls. "Ask each time" adds nothing: ringing is the ask. |
| D7 | Missed calls in the feed with the caller's name | **Yes**, as the app already does ("Missed call from <First Last>"), following the member's "Show in notifications" choice; repeated ones merge into one item with a count. |
| D8 | Ring timeout, and the TURN cost ceiling on staging | **45 s** (as built; the spec allows up to 90). **$30 a month**, with a billing alarm. |
| D9 | Telecom integration and the full-screen ringing permission | **Yes to both**: calls behave like calls beside mobile calls; if Android does not grant the full-screen permission the call rings as a banner. |
| D10 | "Busy" tells a connection that the member is on another call | **Keep** (it is what callers expect); the alternative is to answer nothing, as a held vault does. |
| D11 | Change CALLING-SERVICE §7's cipher to the media stack's built-in one (AES-GCM) | **Yes**, if the spike documents the format; writing our own cipher in C++ is the larger risk. *0.1.2: the format is documented; it is AES-128-GCM, accepted for now (§12.3).* |

## 10. Risks

| # | Risk | Answer |
|---|---|---|
| 1 | F-Droid refuses the prebuilt library, or the `foss` build stops being reproducible | C0 proves it first; fallback option B, then D. Nothing else starts before C0 ends |
| 2 | Ringing is unreliable when the phone sleeps (on-phone service in Doze; FCM delays; no Firebase project yet) | Measured in C3; the app says plainly when background use is not allowed. This is the weakest point of a no-Google design and may stay imperfect |
| 3 | A locked vault cannot be called, and members will not expect that | Said in the app (§6.4); an enclave restart locks every vault on the host, so calls stop until each member unlocks |
| 4 | The fork behind option A slows down or changes its frame format | Version pinned; the format written down (C0 proof 3); B remains possible |
| 5 | The TURN server is abused as a free relay or as a way into its network | §5.3; its own account-level alarm and ceiling (D8) |
| 6 | A call where both sides need the relay fails when both use the same TURN server (seen in the old backend) | Rare with direct by default (both sides must lack a direct path); tested in C5; a second server costs about $16 a month |
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
  source (C0). *0.1.2: established, §12.1.*
- RingRTC's licence; hardware AV1 on the test phones; whether coturn
  re-checks a credential's expiry during a long call (6 h credential,
  12 h call): upstream sources and a C2 test.
- Every latency here except the one relay round trip; the vault's state
  write was not timed. FCM wake delivery times (no Firebase project).
- The exact Android 14+ rule for full-screen intents, and `core-telecom`
  on GrapheneOS: the Play article in full, and C0.
- Prices other than the instance's are list prices as known, not read
  from the price API.

## 12. Decisions and findings since approval (2026-10-12)

Added in 0.1.2. The plan above stands as approved on 2026-10-11; this
section records what C0 found and what was decided for C1 and after.
Where it differs from a sentence above, this section holds, and the
sentence is marked "0.1.2".

### 12.1 What C0 found

Source: vettid-android #123 ("Spike: calls C0", a draft that is not
merged, build `fefa1d02`) and the two-phone test recorded on it on
2026-10-12: Pixel 7 (stock Android 17) calling Pixel 10 Pro
(GrapheneOS, Android 17), same Wi-Fi, different subnets, no vault and
no server involved.

| §4 proof | Result |
|---|---|
| 1. The `foss` build is reproducible with the library in it; F-Droid's tools pass | **In part.** Three builds of `fossRelease` on one machine gave the same APK (57,618,195 bytes). The artifact has no Google Play services, Firebase or Play name in its classes or native libraries. **Not done:** `fdroid scanner` and `fdroid build`, a second machine. F-Droid's main repository already carries an app built against exactly this artifact (FluffyChat 2.10.0); whether a reviewer accepts it for VettID is still not established |
| 2. Two phones exchange Opus audio under a typed key; a wrong key gives silence | **Yes.** Connected on a direct path (host candidates, UDP, 9–10 ms round trip), Opus both ways, frame cryptor OK both ways. Sound from the Pixel 7 arrived and decrypted at the level it was recorded. The other direction is weaker evidence (the sound source hardly registered on the Pixel 10's microphone) and is to be repeated with a voice. With a wrong key, and with one side sending unencrypted, the receiver reported a decryption failure and played **silence** |
| 3. The key and frame format written down | **Yes:** vettid-android `docs/calls/C0-FRAME-FORMAT.md`, checked against the native library by a self-check on both phones. AES-128-GCM, 16-byte tag, 12-byte IV built from the SSRC and the RTP timestamp (no randomness); the frame key is the first 16 bytes of HKDF-SHA-256 of the key; 30 bytes added per frame; one byte of each audio frame stays clear and authenticated; no replay protection of its own |
| 4. `core-telecom`, the `phoneCall` service, the microphone after answering from a notification, Bluetooth, on GrapheneOS and stock | **Not done** on a phone; read from documentation and AOSP only. Moves to C3 (§12.6). Read: `core-telecom` 1.0.1 has no Google services in it; a call service needs the types `phoneCall` and `microphone` together; a `microphone` service cannot start at ring time from the background, so the app rings as `phoneCall` and adds `microphone` after the Answer tap |
| 5. APK size and start-up cost | Universal `fossRelease`: 9.1 MB → 57.6 MB (+48.5 MB); arm64 alone would add 12.7 MB. The library is not loaded until a call screen opens (confirmed on both phones); load and factory creation took 55 + 27 ms (Pixel 7) and 39 + 22 ms (Pixel 10 Pro). Process memory in a call, debug build: 221 MB and 270 MB |

Also found:

- **Both screens off for 75 s:** audio kept flowing.
- **GrapheneOS with the Network permission off:** the engine waits for
  addresses for ever, with no error. The app needs a timeout and a
  message that names the permission.
- **A receiver that failed decryption stays deaf** after the sender's
  key is corrected, until its own key is set again. The app must set
  the key again or end the call on a decryption failure.
- **The library can log key material** (the input key, the salt, the
  derived key) when its logging is at INFO or below. The app never
  turns that logging on; no key line appeared in `logcat` on either
  phone with it off.
- **One key for both directions** makes IV uniqueness rest on the two
  senders' random SSRCs differing: the app uses two keys derived from
  `k_call`, one per direction.
- **Received frames are not length-checked** in the library (read from
  the source, not tested): a peer in the call could crash the receiver.
  A denial of service by a connection; to be reported upstream.
- The same project publishes builds for iOS and macOS, a desktop C++
  wrapper and Rust bindings, each with the frame cryptor. That they
  exist was verified; whether their options match was not read.
- Not tested in C0: speech, Bluetooth and the route chips, a mobile
  network.

### 12.2 D2: the media stack is confirmed

`io.github.webrtc-sdk:android` 150.7871.01, pinned by SHA-256 in the
build. The spike's conditions: the two-phone test passes (it did, with
the one direction to repeat); the owner accepts AES-128 for media
frames (§12.3); `fdroid scanner` and `fdroid build` are run on the
recipe before C1 ends (open; risk 1 of §10 stays until then).

### 12.3 D11: AES-128-GCM for now; cipher agility as a goal

- **Frames are encrypted with AES-128-GCM.** The library's key provider
  cannot reach 256-bit keys today. The app moves to 256 bits when the
  upstream option ships (webrtc-sdk/webrtc pull request 302; its state
  was not re-read for this document).
- **128 bits is acceptable for a first production calls release**
  (decision recorded 2026-10-12). It is said plainly where the cipher is
  specified: the frame cipher is then the weakest part of a call, below
  the key agreement's MLKEM768X25519 (CALLING-SERVICE §7, when that
  section is rewritten for D11).
- **Known-good algorithms only.** Nothing experimental is on in a
  build that members use: in particular the media stack's post-quantum
  DTLS field trial stays off outside a debug switch. Calls do not
  depend on DTLS for their secrecy; the frame encryption under `k_call`
  is what protects them (§3).
- **Cipher agility is a goal.** Media suites are versioned and
  negotiated, and the chosen suite is bound into the keys derived from
  `k_call`, so that a suite cannot be swapped under a call and a
  stronger one can be added without a flag day. On S10 the suite
  travels as an SDP attribute, which nothing signs (§3 "the SDP itself
  is not signed"): binding it into the keys is what protects it there.
  From C2's vault release it is a signed field of the call's
  signalling. Both go into VAULT-MESSAGING §10.10 with C2's edits
  (§6.6).

### 12.4 One universal APK

Owner decision of 2026-10-12: **no ABI splits.** Every distribution
ships one APK with all four architectures, as today. With calls
compiled in, that APK is about 57.6 MB where it was 9.1 MB (§12.1); the
spike's proposal of per-architecture APKs is not taken. Production
builds are not affected until promotion (§12.5).

### 12.5 Where calls code is, and how the app knows a vault has calls

- **Calls code is compiled into non-production builds only.**
  Production release builds carry **no calls code, no media library
  and none of the calls permissions** (§4 "Permissions") until calls
  are promoted (§7 "Promotion"; STAGING-DEVELOPMENT-PLAN §2.4). So a
  production APK does not grow, asks for no microphone, and has nothing
  to hide. A build check has to hold this, as the spike's own check
  does for its code (vettid-android #123, `check<Variant>NoCallsSpike`).
- **The app cannot read a feature list, because there is none.**
  VAULT-MESSAGING §11.10.8 ("No list in the protocol"): no message
  carries a release's features, and an app learns that a feature is
  absent from `unsupported_type`. A rule of the form "show the call
  button when the vault's release lists `calls`" cannot be built as
  written, and this plan does not ask for one.
- **Decision for C1: one probe.** A build that has calls code sends one
  `call.list` after each unlock. An answer means the vault has calls,
  and the call buttons are shown (§6.4). `unsupported_type` means it
  does not: the buttons are hidden for that vault until the next
  unlock. Nothing is cached across releases, since a later release may
  turn the feature on (§11.10.8 "Turning a feature on").
- This costs one request per unlock and tells the vault nothing it
  does not know. Read from vettid-vault at the S10 tag by the Android
  work for C1: `call.list` is an app and desktop type of the `calls`
  feature (§11), and an unregistered feature's types are unknown types.

### 12.6 Telecom moves to C3

Telecom integration (D9 stays "yes") and proof 4 of §4, on GrapheneOS
and on stock Android, move **from C0 and C1 to C3**, the phase that
rings with the app closed. C1 is calls with the app open (§7): it needs
a `microphone` foreground service started from the visible call screen,
which C0 showed working, and no `phoneCall` service, no `CallStyle`
notification and no Telecom registration. Those matter when a call
arrives with the app in the background, which is C3. C1's exit test is
unchanged.

### 12.7 Edits this leaves for other documents

Not made here, in addition to §6.6 (*0.1.3:* the first item is made,
approved 2026-10-12, in VAULT-MESSAGING 0.28.0 §10.10 and CALLING-SERVICE 0.2.0 §6;
the media section of CALLING-SERVICE is §6 there, not §7):

- **VAULT-MESSAGING §10.10** and **CALLING-SERVICE §7**: the frame keys
  (two direction keys from `k_call`, the provider's fixed options, test
  vectors), ending or re-keying a call on a decryption failure, the
  versioned media suite and where it is carried and signed (§12.3).
- **ANDROID-PLAN** §4 to §6: the probe (§12.5), the build rule for
  calls code, the universal APK's size, Telecom in C3.

## 13. Phase C2 (0.1.3; approved by the owner 2026-10-12)

Added in 0.1.3. The owner said on 2026-10-12: start the C2 design now,
so that C2 can begin as soon as C1's two-phone test passes. This
section is that design at the level of the plan. The specifications are
CALLING-SERVICE 0.2.0 and VAULT-MESSAGING 0.28.0 §10.10. The owner
approved it on 2026-10-12 with the decisions of §13.5. Nothing here is
built yet.

State when written: C1's first three pull requests are merged
(vettid-android #124–#126); the fourth and the two-phone exit test are
not done. What C1 has found so far is in §13.7.

### 13.1 C2 in plain words

After C1 two phones can call each other only on the same network,
because the vault gives its devices no servers. C2 makes a call work
across networks, and makes the vault look after a call by itself.

1. **A server.** One small machine in the staging account runs the
   standard open-source STUN/TURN server. STUN tells a phone its own
   public address so that two phones can find a direct path. TURN
   forwards the call when there is no direct path. It forwards audio it
   cannot hear: the audio is encrypted between the two phones before it
   leaves them.
2. **Who may use it.** Only a phone whose vault gave it a short-lived
   pass. Only genuine VettID vaults can get passes, by proving what
   software they run, the way they already prove it to the push
   gateway. The pass names nobody. The server's secret is never in a
   vault.
3. **The vault ends calls by itself.** A call nobody answers ends when
   its ring time is over and is recorded as missed, even if the
   caller's app has died. A call whose phone has died is noticed within
   two minutes, and both vaults are free again (today: busy for up to
   12 hours).
4. **Two people calling each other at the same moment** get one call
   instead of two "busy".
5. **Calls can be turned off per connection**, and a connection that
   keeps ringing without being answered stops ringing the phone.
6. **The cipher choice is signed.** Which media cipher a call uses is
   signed by both phones and both vaults, and each phone proves to the
   other that it holds the call's key before any microphone audio is
   sent. This is the owner's condition for ever offering a second
   cipher (§12.3).

What does not change: direct media by default (D1); AES-128-GCM frames
(suite 1) until the media stack has the 256-bit option; calls off in
production; the staging vaults use the production relay; no Google
code or key is involved anywhere in this.

### 13.2 Work, by repository

| Repository | Work | Spec |
|---|---|---|
| **vettid-vault** (a staging release, "release C2") | **V1, V8:** an issuer client: a request with a fresh key and an attestation, the pool of 4, one credential per call, the limits and backoff; the release constant `calls_url` and its checks; the enclave's allowlist entry; the parent's `DefaultAllow`; remove the `Coturn` issuer that holds a secret. **V2:** the ring timer in housekeeping. **V3:** `call.keepalive`, watched calls, the 90 s rule. **V5:** `call.permission.set` and `.list`, the unanswered-call counts, merged missed calls. **V6:** glare. **Signed suites:** form 2 of the shares, both forms vouched, the form checks. `call.list`'s new members. Vectors for `m2` and the confirmation in `calls.json`. **V4** (the push wake for a ringing call; D24), once its §14.2 text is approved. MUST-COVERAGE for all of it | VAULT-MESSAGING 0.28.0 §10.10, §11.10.8; VAULT-RELEASES 0.1.19 §5.2 |
| **vettid-calls** (new, AGPL-3.0) | The issuer (Go; the attestation and manifest code shared with vettid-push); the coturn image with its configuration and `turn-agent`; `callsctl`; reproducible builds in CI; a README | CALLING-SERVICE 0.2.0 §4, §5, §7, §10 |
| **vettid.org** | `VettidOrgCallsDataStack` and `VettidOrgCallsStack` in the staging app; `callsHost` in `lib/config.ts` and `lib/vault/egress.ts` (snapshot test); the host stack deploy; RUNBOOK "Calling service"; the release list entry and log text for release C2; the open source page lists `vettid-calls` | CALLING-SERVICE §8, §10, §11; VAULT-RELEASES §8.4 |
| **vettid-android** | Learn the vault's level from `call.list` (`v`); form 2 (`suites`, `ek_sig2`, `suite`, `offered`), key confirmation with the microphone held back on the callee; `keepalive` and `call.keepalive`; the stale sweep by `device_id`, `exp` and `now`; glare (`superseded_by`); "Calls: allowed / off" on a connection and the limited state; relay or direct recorded per call; a debug-only forced-relay switch to test the fallback (§3.1); all of it while still working against S10. No pin of a connection's identity key (D23): `docs/calls/CALL-MEDIA.md` §7 rule 6 stops calling that an open question | VAULT-MESSAGING §10.10 "Call forms", "Key confirmation", "Liveness", "Glare", "Mixed releases" |

No relay change, no member API change, no push gateway change.

### 13.3 Order

1. **Done 2026-10-12:** the owner answered §13.5 and the
   specifications say what was decided. **First spec follow-up:** the
   VAULT-MESSAGING §14.2 text for the push wake of a ringing call (V4),
   which rides in release C2 (D24); it is written and approved before
   step 6.
2. **The handshake test first** (stacks, a day): the issuer's front
   deployed with a stub behind it, and a development enclave completes
   a TLS 1.3, HTTP/2 handshake against it under the pinned Amazon
   roots. If that fails, the issuer's deployment changes (CALLING-SERVICE
   §13) before anything is built on it.
3. In parallel: **vettid-calls** (issuer and image); **vettid-vault**
   (the items of §13.2, against the issuer's development stand-in);
   **vettid-android** (everything that can be tested against the
   development vault).
4. **The calling service on staging:** the data stack, the secret (by
   the operator), the service stack, the checks of CALLING-SERVICE §11.
5. **The host stack** with the issuer's name in the DNS Firewall.
6. **Release C2** cut, rebuilt independently, published as a staging
   release; each test vault moves to it with its member's approval, as
   every move does.
7. **The exit test** (§13.4), on the released staging build.
8. A later staging release refuses S10's unsigned form (D20). It is not
   part of C2.

Steps 2 to 5 need no vault release. Step 6 is the one release of C2;
V4 (C3's push wake) rides in it (D24).

### 13.4 Exit test

On the released staging build and release C2, Pixel 10 Pro (GrapheneOS)
and Pixel 7 (stock), **one phone on mobile data and the other on
Wi-Fi**, both vaults on release C2. Each step passes or fails; numbers
are written into this plan.

| # | Step | Passes when |
|---|---|---|
| 1 | Call, ring-back, answer, talk for 2 minutes, hang up; in both directions | Both hear each other; both vaults record `call.ended`; each phone's diagnostics say direct or relayed and which address family |
| 2 | Decline; busy (a third call during a call); no answer | The endings of §2; a missed call where §2 says so |
| 3 | Time from tap to ring, 20 calls | Recorded (§6.2 reasons that under 2 s is achievable; C1 measures the same on one network) |
| 4 | **No answer with the caller's app killed** right after the tap | The callee stops ringing at `exp`; its vault records one missed call; both vaults show the call `ended` within 30 s after `exp` |
| 5 | **App killed mid-call**, on the caller's side, then on the callee's side | The surviving phone's vault shows the call `ended` **within 2 minutes** of the kill, and that phone can place a new call then. The killed phone's vault shows, when its app is next opened, reason `failed` and an `ended_at` within 2 minutes of the kill and before the restart (so the vault ended it, not the app's sweep) |
| 6 | **Glare:** both members tap Call within a second, 5 times | Each time exactly one call connects, with audio both ways, and no missed call remains on either phone |
| 7 | **Forced relay** (the debug switch) on one phone | The call connects through `turn.staging.vettid.org`; audio both ways; the server's `allocations` counter moves; no address or username appears in any log group |
| 8 | **Signed suites and confirmation:** a test build that sends a wrong `confirm`; one that changes `suites` after signing | The caller ends the first call as not encrypted before any audio; the second never rings (`drop.call_share` in the callee's History) |
| 9 | **Calls off** for the connection; then **4 unanswered calls in 10 minutes** | Off: no ring, nothing in the feed, the caller sees "no answer". Limit: the fourth does not ring; one missed-call item with a count |
| 10 | **Mixed:** the C2 app against a vault still on S10; the last C1 app build against a vault on release C2 | Calls connect on one network in the first case and across networks in the second, with S10's known gaps and nothing worse |
| 11 | The issuer made unreachable (the DNS Firewall entry removed on a test host) | Calls on one network still connect; a call that needs the relay fails with "could not connect"; nothing else of the vault is affected |
| 12 | A relayed call that outlasts a short-lived test credential | Recorded whether the server cuts it (CALLING-SERVICE §13); the credential lifetime (D14) is confirmed or changed |

Not in C2's exit test: ringing with the app closed (C3), video (C4),
networks that allow only TCP 443 and relay on both sides (C5), the
share of calls that need TURN (C5).

### 13.5 Owner decisions for C2

**Answered (owner, 2026-10-12, on vettid.org #243): "d23 should be c,
all other d recommendations are approved."** So D12–D22 and D24–D26 are
decided as recommended, and **D23 is decided as (c): never.** The last
column says what holds. D12–D26 continue §9's numbering. What earlier decisions already settle is not
asked again: D1 (direct by default, "Always relay" deferred), D3 (the
staging account, one small instance), D4 (credentials from the calling
service to attested vaults), D8 (45 s, $30), D11 and §12.3 (suite 1 now,
suite 2 registered, signed suites in C2's release, key confirmation
before a second suite).

| # | Decision | Options | Recommendation | Decided (2026-10-12) |
|---|---|---|---|---|
| D12 | How a vault learns that a call's device is gone (V3) | (a) The device sends `call.keepalive` every 30 s; the vault ends the call after 90 s without one. (b) The vault asks and the device answers: the same traffic, more state. (c) Nothing new: rely on the other phone noticing and hanging up, which already frees both vaults when that phone is alive. (d) Tie it to the device's session: not buildable, an app has no session and the relay does not tell a vault who is connected | **(a)**, as §6.1 V3 proposed. It is the only one that meets "within 2 minutes" when both phones die. Its cost, said plainly: the relay then sees one small deposit every 30 s during a call, so a call's length is visible to it as a pattern | **As recommended** |
| D13 | TURN credentials per call or per unlock window | (a) One credential per unlock window, renewed hourly (the approved §5.1 text): every call of the window shows the server the same username. (b) A fetch per call: call setup waits for the issuer, and the issuer and the host see when calls happen. (c) **A pool of 4 fetched at unlock and refilled in the background, one credential used per call** | **(c)**. It keeps what (a) was chosen for (a call never waits, the issuer does not learn call times) and gives each call its own username, which is what V8 wants | **As recommended** |
| D14 | How long a credential lives | 2 h; **6 h** (the vault's constant today, and §5.3's limit); 13 h (longer than the longest call) | **6 h**, with a credential never handed out in its last 2 h, and exit test step 12 to find out whether the server cuts a call at expiry. If it does, the lifetime is revisited before C4 | **As recommended** |
| D15 | The relay's bandwidth cap per call, and what the member sees at it | (a) 3 Mbit/s now (§5.3's proposal, sized for video). (b) **256 kbit/s while calls are voice only, 3 Mbit/s with C4.** At the cap packets are dropped: voice never reaches it. Text for a call that could not get a relay: (i) the plain "could not connect" in C2, the reason in the call diagnostics, a specific text in C6; (ii) a specific text now | **(b)** and **(i)**. A relay that carries only voice-sized streams is of no use to an abuser | **As recommended** |
| D16 | Total caps on staging, and whether the relay stops by itself | Caps: 100 allocations and 4 Mbit/s in total. (a) Alarms only. (b) **An alarm at 5 GB in a day, and at 30 GB in a day the relay is switched off until the operator turns it on** | **(b)**. The bandwidth caps alone do not bound cost (4 Mbit/s all day is 43 GB); the stop does, at under $3 for the worst day. While it is off, direct calls work and relayed ones do not connect | **As recommended** |
| D17 | Where the credential issuer lives | (a) **Its own small service from `vettid-calls`, in the staging account**, as a Go function behind CloudFront (D4 and §5.2, with CloudFront in place of API Gateway). (b) In the push gateway's process: no new egress name, no host deploy, 2–3 days saved; but the TURN secret then lives in the management account beside the push credentials, two services release together, and D3's separation is given up. (c) In the member API: it knows members, and the enclave does not reach it. (d) On the TURN instance: the most probed machine would parse HTTPS and attestations, and it cannot have an Amazon certificate | **(a)**. It is a stated exception to "functions are Node": the attestation verifier exists in Go and should not be written twice | **As recommended** |
| D18 | TURN over TLS on 443 in C2 or in C5 | (a) C2: C5 then stays app-only as §7 has it, at the price of a certificate and its renewal on the instance now. (b) **C5** | **(b)**. C2's exit test does not need it; C5 gains a small stack deploy | **As recommended:** C5, which therefore needs a stack deploy |
| D19 | Logging and retention on the TURN server | (a) **Counters only; coturn's own log discarded on the instance; no flow logs; the issuer logs starts and errors for 14 days.** (b) The session log kept on the instance for 24 h. (c) Shipped to CloudWatch for 14 days | **(a)**, as §5.3 has it, with (b) as a manual step during an abuse incident only, written in the runbook | **As recommended** |
| D20 | S10's unsigned form beside C2's signed one | (a) **Both in C2:** an offer carries both signatures so that an S10 vault or a C1 app on the other side still works; only suite 1 while that lasts; the first staging release cut after every release without C2 is removed refuses the unsigned form; **production never accepts it**. (b) A hard cut at C2: simpler, but calls between a moved and an unmoved staging vault fail silently, and the app needs both forms anyway to keep working against S10. (c) Keep both for good: then no second suite, ever | **(a)** | **As recommended** |
| D21 | Glare (V6) | (a) **The lower `call_id` wins; the phone whose call lost answers the winning call by itself**, while its outgoing-call screen is still showing. (b) The same, but that phone rings and the member taps Answer. (c) As today: both busy | **(a)**. The member asked for this call seconds earlier; (b) makes two people who are calling each other wait for each other | **As recommended** |
| D22 | The call limits (V5) | The proposal of §3: **3 unanswered calls in 10 minutes or 10 in 24 hours** per connection, then no ring and one merged missed-call item. To confirm: a declined call counts as unanswered; an answered call or a call back clears the counts; "Calls: off" stops both directions (the member's own calls to that connection too) | **As proposed**, with those three points | **As recommended** |
| D23 | Should the app pin a connection's identity key itself, so that the call's `peer_ik` check also holds against the member's own vault | What it would take: a store on each device of every connection's key, taken at the first sight or when the member compares the verification code; the vault handing the device each key rotation with its proof, and the device checking it; a warning screen for a changed key and a way to accept it; re-pinning after a transfer, a recovery or a new desktop, where the store starts empty and the vault must be believed again. What it would give: the member's own vault could no longer listen to a call by swapping key shares without the phone noticing, provided the other member's vault is honest. It would protect calls only: the member's own vault still reads every message and holds the member's identity key. Options: (a) in C2; (b) later, as a design of its own across calls and messages, if the threat model is changed to distrust the member's own enclave; (c) **never** | Recommended was (b). The owner chose otherwise | **(c) Never.** The app does not pin a connection's identity key itself, keeps no pin store and shows no changed-key warning. The member's own vault is trusted, for calls and messages alike (VAULT-MESSAGING §2.1). The `peer_ik` check binds a call to the connection the vault names and to the fingerprint shown; it is not a defence against the member's own vault, by design |
| D24 | Does the push wake for a ringing call (V4, a C3 item) ride in C2's vault release | (a) **Yes, if its text for VAULT-MESSAGING §14.2 is approved before the release is cut**: one release and one round of moves fewer. (b) Its own release with C3 | **(a)** | **As recommended:** it rides in release C2. Its §14.2 text is still to be written and approved before the release is cut |
| D25 | The parent's allowlist names the issuer of both channels now | (a) **`calls.staging.vettid.org` and `calls.vettid.org`**, as it names both push gateways: production's DNS Firewall does not admit the name, and production has no `calls_url`. (b) Staging's only: production's name then needs another parent change later | **(a)** | **As recommended** |
| D26 | Key confirmation in every signed-form call, or only when more than one suite is offered | (a) **Every call.** (b) Only with two or more suites offered | **(a)**: one path, tested from the first day, and audio is never sent to a device that has not shown it holds the key | **As recommended** |

### 13.6 Effort

The ranges of §7 are kept as they are. The record does not support
changing them: C0 and three of C1's four pull requests were done within
two days of the plan's approval, far faster than the ranges, but the
work that remains in every phase is bounded by other things than
writing code: the owner's tests on real phones, vault releases (at most
two a week, each with a rebuild and a move on every test phone), and
new infrastructure. C1's own exit test is not done, so even C1 has no
actual figure yet.

C2's row alone changes, **from 12–20 to 14–22**, and for scope, not for
speed: the signed suites, the key confirmation and the two forms were
not in the row when the plan was approved (§12.3 added them).

| | Days |
|---|---|
| vettid-vault | 5–8 |
| vettid-calls | 3–4 |
| vettid.org (stacks, egress, runbook, release) | 3–5 |
| vettid-android | 3–5 |
| **C2** | **14–22** |

### 13.7 What the code and C1 showed

Found while writing this, by reading vettid-vault `origin/main`
(`079cde7`) and vettid-android `origin/master` (`19a60a7a`):

1. **"Host and server-reflexive candidates"** in VAULT-MESSAGING §10.10
   (and in the vault's comment on `NoServers`) was wrong: without a
   STUN server a device has no server-reflexive candidate. §3.1 item 3
   of this plan had it right. Corrected in 0.28.0.
2. **The vault's `Coturn` issuer puts the `call_id` into the TURN
   username** and holds the secret. It was never wired; C2 removes it.
3. **256 `call.ice` messages a call** are counted for both directions
   together in the code; the specification read as if per vault.
   Written as built.
4. **`call.start`'s errors** in the specification's table lacked
   `owner_check_required` and `internal`, which the code and the app
   know.
5. **§5.2's API Gateway for the issuer**: the enclave's egress accepts
   only TLS 1.3 and requires HTTP/2 of hosts it shares connections to
   (`enclave/egress`). Whether an API Gateway custom domain gives both
   was not established, so 0.2.0 puts the issuer behind CloudFront and
   tests the handshake first.
6. **§5.2's Go issuer as a function** meets the repository's convention
   that functions are Node through `ApiFunction` (RUNBOOK). D17 grants
   the exception.
7. **§5.1's "a credential at unlock, renewed hourly"** gives every call
   of an hour the same TURN username, which works against V8's aim.
   D13's pool answers it.
8. **An S10 vault drops members it does not know** from `call.start`,
   `call.offer` and `call.answer` (it rebuilds each message from named
   members) **and refuses an unknown `call.end` reason** as
   `bad_request`. So new signed members cannot pass an S10 vault, and
   C2 adds no reason. This is what shaped D20.
9. **C1's findings**, all answered in 0.28.0: no ring timer (the caller
   sends the timeout, the callee must not); no liveness (a stale sweep
   by the phone's clock, right only for one call device); `call.list`
   without `exp` and device; ring time from the phone's clock; glare;
   no ICE servers; no signed suite field; a failed `call.start` leaves
   a call ringing unless the device sends a hang-up.
10. **PQC-MIGRATION row 5a** still says SFrame. Not edited here; it
    should follow D11 when that document is next touched.

### 13.8 Not settled

- Everything in CALLING-SERVICE 0.2.0 §13: the enclave's handshake with
  the issuer's front; whether coturn cuts a call when its credential
  expires; whether the pinned coturn takes several secrets and a change
  without a restart, and its exact option names; relay on both sides
  through one server; IPv6 on the test networks; the cost of an
  attestation per request at production scale.
- The share of calls that need TURN (C5), and so the real traffic cost.
- Whether C1's last pull request and its two-phone test change anything
  written here. They are not done; the specifications are corrected
  if they do.
- The state of the media stack's 256-bit option (webrtc-sdk/webrtc pull
  request 302) was not re-read.
- The vectors for the key confirmation in VAULT-MESSAGING §16 were
  computed by one script only; the vault's and the app's
  implementations must reproduce them.
- F-Droid's acceptance of the media library (§10 risk 1) is still open
  and is not a C2 item.
