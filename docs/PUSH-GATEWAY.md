# VettID Push Gateway Protocol

**Version:** 0.1.0 (draft)
**Status:** Pre-implementation draft for review
**Companion to:** VettID Relay Protocol (v0.2.0, Appendix A)

## 1. Purpose & design principles

The push gateway is a small VettID-operated service that delivers **contentless
wake-up pushes** to mobile devices via platform push services (APNs, FCM), so
that apps without persistent connectivity learn to collect from their relay
mailbox. It exists so that relays remain push-unaware and vendor-neutral: no
relay operator ever holds Apple or Google credentials.

Design principles:

1. **Zero content.** Pushes carry no message data, no sender, no mailbox id —
   at most a generic localizable fallback string. All content is collected
   from the relay and decrypted on-device.
2. **Unlinkability.** The gateway MUST NOT be able to associate a wake
   registration with a relay mailbox. This is achieved with a dedicated wake
   keypair (§3) and opaque wake references.
3. **Minimal state.** The gateway stores only:
   `wake_ref → (wake_pubkey, platform, push_token, environment)`.
4. **Same auth grammar as the relay.** Signed requests per Relay Protocol
   §4.1 — identical canonical digest, headers, freshness window, and replay
   rules. No new cryptographic mechanisms.

Conformance keywords MUST, SHOULD, MAY are per RFC 2119.

## 2. Roles

| Role | Description |
|---|---|
| **Owner** | The principal (in VettID: the user's vault) that registers wake references and triggers wakes. Apps never talk to the gateway directly. |
| **Device** | The mobile app installation holding a platform push token. It sends its push token to its vault over OwnerSpace (E2E); it has no gateway credentials. |
| **Gateway** | This service. Holds APNs/FCM credentials and the wake-ref mapping. |

## 3. Wake keypair — REQUIRED unlinkability property

The owner authenticates to the gateway with a dedicated Ed25519 **wake
keypair**.

- The wake key MUST NOT be the owner's relay keypair. Relay mailbox ids are
  derived from relay pubkeys (Relay Protocol §3.2); authenticating to the
  gateway with the relay key would let the gateway compute the mailbox id and
  link push timing to relay identity. A distinct key severs that link.
- The wake key MUST NOT be the protean credential key or any E2E key.
- One wake key MAY own multiple wake_refs (e.g., a user with phone + tablet).
- Vault-side, the wake key is generated inside the vault's trust boundary and
  stored with vault state, like the relay key.

## 4. Endpoints

Base path `/v1`. All requests are signed per Relay Protocol §4.1
(`X-VettID-Key` = wake pubkey, `X-VettID-Timestamp`, `X-VettID-Sig`; 90 s
freshness; replay cache). Error body and canonical-code grammar follow Relay
Protocol §7.1.

### 4.1 Register wake reference

```
POST /v1/wake/register
{ "platform": "apns" | "fcm",
  "push_token": "<platform push token, opaque string>",
  "environment": "production" | "sandbox" }     # apns only; default production
→ 201 { "wake_ref": "<ULID>" }
```

- The wake_ref is bound to the registering wake pubkey: only that key may
  trigger, update, or delete it.
- Registering an identical (pubkey, platform, push_token) tuple is idempotent
  → `200` with the existing wake_ref.
- The gateway MUST treat push tokens as secrets: never logged, never returned
  in any response after registration, encrypted at rest.

### 4.2 Update push token

```
PUT /v1/wake/{wake_ref}
{ "push_token": "<new token>" }
→ 204
```

Platform push tokens rotate (OS updates, reinstall, restore). The device sends
its new token to its vault over OwnerSpace; the vault updates the gateway.
Platform and environment are immutable per wake_ref — register a new one
instead.

### 4.3 Trigger wake

```
POST /v1/wake/{wake_ref}
{ "class": "notify" | "sync",
  "collapse_key": "<string ≤ 64 chars>" }        # optional
→ 202
```

- `class: "notify"` — user-visible wake. APNs: `apns-push-type: alert`,
  priority 10, `mutable-content: 1`, generic localizable fallback body (e.g.,
  loc-key `WAKE_FALLBACK` → "New message"); the app's Notification Service
  Extension collects from the relay, decrypts locally, and rewrites the
  notification. FCM: high-priority data message handled by the app's messaging
  service.
- `class: "sync"` — silent background wake. APNs: `content-available: 1`,
  `apns-push-type: background`, priority 5. Platforms throttle these
  aggressively; owners MUST NOT rely on `sync` for user-visible delivery.
- `collapse_key`: if present, the gateway maps it to APNs `apns-collapse-id` /
  FCM `collapse_key`, so a burst of wakes coalesces into one delivered push.
  Owners SHOULD use a constant collapse_key per device for ordinary message
  wakes — the wake means "collect everything," so coalescing is always safe.
- The push payload contains **no owner-supplied data**. `class` and
  `collapse_key` shape delivery; they are not delivered content.
- `202` means accepted for delivery; platform delivery is best-effort and
  unacknowledged end-to-end. Owners MUST treat push as an optimization:
  correctness comes from the app collecting on next foreground regardless.

### 4.4 Delete wake reference

```
DELETE /v1/wake/{wake_ref}
→ 204    (idempotent)
```

Owners SHOULD delete wake_refs when a device is unlinked from the vault.

## 5. Dead token handling

When a platform reports a token permanently invalid (APNs `410 Unregistered`,
FCM `UNREGISTERED`):

- The gateway marks the wake_ref **dead** (it does not silently delete it).
- Subsequent triggers return `410` with code `wake_ref_gone`.
- The owner reacts by requesting a fresh push token from the device over
  OwnerSpace and registering a new wake_ref (or `PUT` once re-enabled by a
  registration is implementation choice; v1 requires re-registration for
  simplicity).

## 6. Errors

Canonical codes (grammar per Relay Protocol §7.1): `signature_invalid`,
`timestamp_stale`, `replay_detected`, `wake_ref_unknown`, `wake_ref_gone`,
`platform_invalid`, `rate_limited`, `internal`.

`wake_ref_unknown` MUST be returned identically for nonexistent wake_refs and
wake_refs owned by a different key — no existence oracle.

## 7. Rate limiting & abuse

- Per-wake-key and per-wake_ref trigger limits are gateway policy; overload is
  signalled with `429` + `rate_limited` (+ `retry_after`), and clients MUST
  back off with jitter.
- Registration is open with proof-of-possession of the wake key, rate-limited
  per source IP. The gateway cannot validate that a push token belongs to the
  registrant; the abuse case (registering a stolen push token to spam a
  victim's device with wakes) is bounded by trigger rate limits, collapse
  behavior, and the fact that wakes are contentless.
- The gateway SHOULD coalesce triggers for the same (wake_ref, collapse_key)
  arriving within a short window (e.g., 2 s) into a single platform push
  before the platform's own collapsing even applies.

## 8. Privacy & security considerations

1. **What the gateway learns:** push tokens (device-identifying to Apple/
   Google), wake pubkeys, and wake timing. It MUST NOT learn relay mailbox
   ids, message content, sizes, or senders. Wake timing is residual metadata;
   operators SHOULD minimize trigger-log retention (counters over logs).
2. **What platforms learn:** that the app received a contentless wake.
   Notification content is constructed on-device after relay collection and
   local decryption; plaintext never transits APNs/FCM.
3. **Gateway compromise** yields push tokens and the ability to send spurious
   contentless wakes (battery/annoyance, bounded by platform throttling). It
   yields no message content, no mailbox linkage, and no ability to forge
   relay traffic. Recovery: rotate gateway credentials; owners re-register.
4. **APNs/FCM credentials** (Apple .p8 key, FCM service account) are the
   gateway's crown jewels: stored in a secrets manager, never in config files
   or the repo, rotated on schedule.
5. The wake key gives the gateway a stable per-owner pseudonym. Owners wanting
   to reduce long-term linkability MAY rotate wake keys by registering new
   wake_refs under a new key and deleting the old ones; the protocol imposes
   no continuity between them.

## 9. Test vector

Wake keypair uses fixed seed (all-0x03 bytes). **Test use only.**

```
wake seed   (b64): AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=
wake pubkey (b64): 7UkoxijRwsbq6QM4kFmVYSlZJzpcY/k2NsFGFKyHN9E=
```

Signed registration request (canonical digest per Relay Protocol §4.1):

```
method            : POST
path              : /v1/wake/register
body              : {"platform":"apns","push_token":"740f4707bebcf74f9b7c25d48e3358945f6aa01da5ddb387462c7eaf61bb78ad","environment":"production"}
sha256(body) hex  : 1e8558cec45d0ba711d8c2e6e60fef15c93bb31188023a39f620b78f82ea8b66

canonical string (\n are literal newline bytes):
POST\n/v1/wake/register\n2026-06-10T12:00:00Z\n1e8558cec45d0ba711d8c2e6e60fef15c93bb31188023a39f620b78f82ea8b66

X-VettID-Key      : 7UkoxijRwsbq6QM4kFmVYSlZJzpcY/k2NsFGFKyHN9E=
X-VettID-Timestamp: 2026-06-10T12:00:00Z
X-VettID-Sig      : yf2qqEr66S+d6EeD23Y1SxtjZMkP/gtrGFwHYwmanJYbr+ZrT5L/m0I781zXn7oLnpr3qbQsYVG4t49Ik9mUCQ==
```

(The push_token in this vector is a random 64-hex-char placeholder in valid
APNs token shape; it corresponds to no real device.)

## 10. End-to-end flow (informative)

```
1. app obtains APNs/FCM token from OS
2. app ──OwnerSpace (E2E)──▶ vault: { platform, push_token }
3. vault ──POST /v1/wake/register──▶ gateway → wake_ref
4. ... later: peer deposits message for app's mailbox via relay ...
   (in VettID flows this transits the vault: peer → relay → vault →
    relay deposit into app's mailbox)
5. vault ──POST /v1/wake/{wake_ref} {class:"notify"}──▶ gateway
6. gateway ──contentless push──▶ device
7. iOS NSE / FCM handler ──collect (Relay §6.3)──▶ relay
8. device decrypts locally, renders notification, acks (Relay §6.5)
```

## 11. Changelog

- **0.1.0** — initial draft: wake-ref registration/update/delete, notify and
  sync wake classes, collapse behavior, dead-token handling, unlinkability via
  dedicated wake keys, test vector.
