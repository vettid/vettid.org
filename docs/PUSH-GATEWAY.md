# VettID Push Gateway Protocol

**Version:** 0.4.5 (draft)
**Status:** Draft for review (N2; owner request of 2026-10-10: "we can
start to design the push service for google play and apple ios").
Implemented by `vettid/vettid-push` (the gateway) and vettid-android #109
(the app's Google push mode), N4; 0.4.2 carries their errata. 0.4.2
and 0.4.3 approved by the owner 2026-10-11. Deployed for staging since
2026-10-11 (§10.4); 0.4.4 writes down the deployment as built; 0.4.5
moves the replay check behind the authenticating checks and caps the
replay records of one key (vettid-push #2), approved by the owner
2026-10-13
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
   rule (a request seen before, while its timestamp is fresh, is
   refused). Where the replay check sits among the gateway's checks is
   the gateway's own (§5.1, §5.2; 0.4.5). No new signature mechanism.

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
  the other). `nonce` is random. A blob is at most **6,144** bytes. The
  record is JSON, so a token's `"` and `\` double inside it: a
  registration whose sealed blob would exceed 6,144 bytes is refused
  `400 token_invalid` (§5.1 step 3). Only a token of nearly 4,096 bytes
  made mostly of those two characters gets there; no real token does
  (0.4.2).
- `key_id` is 4 random bytes; in the blob-keys secret (§10.2) it is
  written as **8 lowercase hex digits** (0.4.2).
- **Blob keys** are 32-byte random keys generated by the gateway, stored
  only as ciphertext under the gateway's KMS key (§10.2) and decrypted
  into memory at task start. One key is current; it rotates **yearly**.
  A retired key still opens blobs for **400 days**; a wake whose blob was
  sealed under a non-current key is answered with a `reseal` (a fresh blob
  of the same record under the current key, §5.2), which the vault stores.
  After 400 days the old key is deleted, and its blobs answer
  `blob_invalid`. The secret holds no dates, so the gateway deletes
  nothing by itself: rotating and deleting are operator steps
  (`pushctl blob-keys rotate` and `pushctl blob-keys drop <key_id>`,
  §10.2), and either takes effect when the tasks next start (0.4.2).
- The vault treats the blob as opaque; it never sees inside it. The vault
  does not keep the token (only a hash, VAULT-MESSAGING §14.1).

## 5. Endpoints

Base path `/v1`. Requests are signed per Relay Protocol §4.1
(`X-VettID-Key` = the wake public key, `X-VettID-Timestamp`,
`X-VettID-Sig`; 90 s freshness; a replay cache, consulted at the step
§5.1 and §5.2 name). Error bodies follow Relay Protocol §7.1. `GET /v1/health` is unauthenticated and returns `200 {}`.

`X-VettID-Timestamp` is RFC 3339 and **may carry fractional seconds**
(the vault's client sends them); the canonical digest uses the header's
string exactly as sent, never a re-formatted time (0.4.2; §15). A request
body is at most 16 KiB. When the replay cache is full the request is
answered `429 rate_limited` with `retry_after` 1 rather than admitted
unrecorded, as the relay does (0.4.2). (0.4.5) The gateway consults the
replay cache later than the relay does: only after the check that ties
the request's key to a registration (§5.1 step 2, §5.2 step 2), so only
such a request is recorded, answered `replay_detected`, or shed because
the cache is full. Freshness and the replay check use one reading of the
clock. One key has at most 32 live records in the cache (§8); a request
beyond that is `429 rate_limited` with the time until the first of them
expires. The cap is judged first: a request from a key at its cap is
`429` even if it was seen before, not `replay_detected`.

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

The gateway, in order (0.4.2: the per-address registration limit of §8
comes first, before the body is read or the signature checked, as on the
relay; a request over it is `429 rate_limited` and nothing else of it is
looked at):

1. checks the signature and freshness (Relay §4.1);
2. **verifies the attestation** (`attestation_invalid` otherwise): a
   COSE_Sign1 Nitro attestation document whose certificate chain ends at
   the pinned AWS Nitro Enclaves root; `timestamp` within 300 s of now;
   `public_key` = the 32 raw bytes of `X-VettID-Key`; `user_data` = the
   request's 32-byte digest (Relay §4.1, `SHA-256(canonical)`); `pcrs[0]`
   equal to the `pcr0` of a release in the channel's **trusted release
   manifest** (VAULT-MESSAGING §11.10.1) whose status is `active` or
   `deprecated`. The gateway fetches the manifest itself, verifies it with
   the channel's pinned manifest keys exactly as apps do, refuses a lower
   `serial`, and refreshes it every 10 minutes. (0.4.2) The manifest's
   checks come last, after the document's own. While the gateway holds
   **no trusted manifest** (the site could not be reached when the task
   started, or the channel has not published its first release, as
   production before release 1), every registration is
   `403 attestation_invalid` (metric reason `no_manifest`, §10.5) and the
   fetch is tried again **every minute** until one is trusted; wakes need
   no manifest and are not affected. A refresh that fails keeps the
   manifest already trusted, for at most **7 days** since the last
   successful refresh (0.4.3; owner, 2026-10-11, §14.2 question 15): at
   7 days and after, every registration is `403 attestation_invalid`
   (metric reason `manifest_stale`, the answer itself as any other
   attestation refusal) until a refresh succeeds, which restores trust
   at once. A successful refresh is a fetch whose manifest verifies and
   passes the serial rule, the same manifest served again included; a
   `404` once a manifest is held is a failed refresh. Wakes of blobs
   already sealed are not affected. While stale the refresh stays at
   every 10 minutes (0.4.4: so once the site is back, registrations
   can stay refused for up to 10 minutes more; the one-minute retry is
   only for a gateway that holds no manifest at all). The age is
   measured on the task's monotonic clock, so a step of the wall
   clock neither ages nor renews a manifest (0.4.4). The `manifest_refresh` metric raises the alarm
   after an hour (§10.5), so the limit is not reached in normal
   operation. The lower-`serial` rule (a lower serial, or the same
   serial with other bytes, is refused) is held **in memory only** and
   starts again with the task, because the gateway keeps no state; a
   restarted task has a fresh 7 days from the manifest it then trusts.
   (0.4.5) Once the attestation has verified, and before the body is
   checked, the request is checked against the replay cache and recorded
   in it (`replay_detected`; `429 rate_limited` when the key has its cap
   of records or the cache is full). A request refused at step 1 or 2 is
   not recorded, so a signed request from a stranger takes no place in
   the cache; sent again it is checked afresh. A request refused at step
   3 or 4 is recorded: the same bytes sent again are `replay_detected`.
3. checks the body: `platform` known; `token` 1–4,096 bytes of printable
   ASCII for `fcm`, 64–200 lowercase hex digits (even count) for `apns`;
   `environment` present for `apns` and absent for `fcm`; `app_id` in the
   channel's configured list for that platform (`app_invalid`);
   `sandbox` accepted only where the channel allows it (§10.4).
   (0.4.2) Precisely, and in this order: a body that is not one strict
   JSON object, or lacks a string `platform`, is `bad_request`; a
   `platform` other than `fcm` and `apns`, **or one the channel has no
   credentials for** (not in `PUSH_PLATFORMS`), is `platform_invalid`; a
   bad `token` is `token_invalid` ("printable ASCII" is 0x21–0x7E, so no
   space); **every fault of `environment`** (missing for `apns`, present
   for `fcm`, another value) and `sandbox` on a channel that refuses it
   are **`bad_request`**; an `app_id` that is malformed (1–255 bytes of
   `[A-Za-z0-9][A-Za-z0-9._-]*`) or not in the list is `app_invalid`; an
   unknown or repeated member is `bad_request`. A well-formed body is
   accepted or refused by the vault's own parser
   (vettid-vault `vms/pushwire`), so the vault, which validates before it
   calls, and the gateway cannot disagree. (The vault's test stand-in
   answers an `environment` fault `token_invalid`; no vault depends on
   the difference.);
4. seals and returns the blob. Nothing is written anywhere. A record too
   large for a blob is `400 token_invalid` (§4, 0.4.2).

Registering never contacts the platform: a bad token shows up at the first
wake (§7). The same body registered twice yields two different blobs; both
work (the vault keeps one).

### 5.2 Wake

```
POST /v1/wake
{ "wake_blob": "<blob>", "class": "notify" }
→ 202 { "reseal": "<blob>"? }
```

0. (0.4.2) The per-address wake limit of §8, before the body is read or
   the signature checked, as on the relay.
1. Signature and freshness. (0.4.5) Then the body: one that is not a
   wake, or whose `class` is not `notify`, is `bad_request` before the
   blob is opened.
2. Open the blob; its `k` MUST equal `X-VettID-Key`. A blob that does not
   open, has another channel, an unknown or deleted key, or another key
   than the signer is answered `blob_invalid`, identically in every case
   (no oracle). (0.4.2) So is a blob whose record the gateway would no
   longer seal: a platform it has no credentials for now, an `app_id`
   since removed from the channel's list, or `sandbox` where it is no
   longer accepted. (0.4.5) Once the blob has passed this step, and
   before step 3, the request is checked against the replay cache and
   recorded in it (`replay_detected`; `429 rate_limited` when the key
   has its cap of records or the cache is full). The cap is judged
   before the lookup: a request from a key at its cap is
   `429 rate_limited` even if it was seen before. A request refused at
   step 1 or 2 is not recorded, so a signed request from a stranger
   takes no place in the cache; sent again it is checked afresh (it may
   by then be `timestamp_stale`, or over the per-address limit). A
   request refused from step 3 on (`rate_limited` at the per-token
   limit, `provider_unavailable`, `token_gone`, `token_invalid`) is
   recorded: the same bytes sent again are `replay_detected`, so a retry
   must be signed anew.
3. Rate limits (§8): the **per-token** limit (0.4.2: the per-address
   limit is step 0).
4. Coalescing: a wake for the same token within 2 s of the previous one
   is answered `202` without a second platform send. (0.4.2) "The
   previous one" is the previous wake that was **sent** to the platform,
   counted from when its request arrived. A wake whose send failed is
   not one to coalesce into: the next wake for the token is sent, even
   within the 2 s. A coalesced wake has already passed step 3, so it
   **still consumes one** of the token's 60 per hour.
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
| 401 | `signature_invalid`, `timestamp_stale`, `replay_detected` | Auth | At registration `gateway_error`, no retry; at a wake retried like a `5xx` (owner decision 2026-10-10) |
| 403 | `attestation_invalid` | Registration only | `gateway_error`; the app may retry later |
| 400 | `bad_request`, `platform_invalid`, `app_invalid`, `token_invalid` | Body (§5.1 step 3). `token_invalid` also at a wake, when the platform refuses the token itself: FCM `INVALID_ARGUMENT` **and every other FCM `400`**, FCM `SENDER_ID_MISMATCH` (the token is another Firebase project's); APNs `BadDeviceToken` and `DeviceTokenNotForTopic` (the token is another app's) (0.4.2) | Registration refused; at a wake, `token_invalid` as `token_gone` and the other codes retried like a `5xx` (owner decision 2026-10-10) |
| 410 | `token_gone` | FCM `UNREGISTERED` (whatever its status) and any FCM `404`; **any APNs `410`** (`Unregistered`, `ExpiredToken`) (0.4.2) | Drop the registration, ask the app for a new token |
| 410 | `blob_invalid` | §5.2 step 2 | Same as `token_gone` |
| 429 | `rate_limited` (+ `retry_after`) | §8; a full replay cache (§5, `retry_after` 1); a key at its cap of replay records (§8; `retry_after` up to 181); or the platform's own `429` (APNs `TooManyRequests`, FCM `QUOTA_EXCEEDED`), with the platform's `Retry-After` capped at 3,600 s (0.4.2) | Wait, merge triggers |
| 502 | `provider_unavailable` (+ `retry_after`?) | Platform 5xx, timeout or no connection. (0.4.2) Also when the platform refuses **the gateway**, not the token: APNs `403` (`InvalidProviderToken`, `ExpiredProviderToken`, …), FCM `401`/`403`, a failed Google access-token fetch; and any other refusal a fixed payload should never meet (APNs `BadTopic`, `TopicDisallowed`, another `400`; an unknown answer). These raise the alarm of §10.5; no vault loses its registration over a fault of the gateway's | Retry with backoff |
| 500 | `internal` | | Retry with backoff |
| 404 | `not_found` | Any other path or method (0.4.2) | Not sent by a vault |

The gateway keeps no record of dead tokens: the vault drops its blob, so a
dead token is never sent again.

(0.4.2) Inside the 5 s of a send the gateway tries once more, with fresh
credentials, when FCM answers `401` (a new access token) or APNs answers
`403 ExpiredProviderToken` (a new provider token, if Apple's 20-minute
minimum between tokens allows). An error body's `message` is fixed per
code and never repeats anything of the request; a wait is given both as
`retry_after` in the body and as the `Retry-After` header.

The vault's side is normative in VAULT-MESSAGING §14.1 and §14.2
(0.24.1). A `429` or `5xx` may carry the wait in the body's `retry_after`
or in the HTTP `Retry-After` header (delta-seconds); the vault uses the
header only when the body has none, and caps either at 3,600 s (owner
decision 2026-10-10). The vault gives one wake attempt at most 10 s (the
lock wake: what is left of its 3 s budget), longer than this gateway's
5 s platform send (§5.2).

## 8. Rate limiting & abuse

- **Per token** (keyed by an HMAC of the token under a per-process random
  key, in memory only, never persisted or logged): at most **60 wakes per
  hour**, burst 10. The vault's own limits are lower (VAULT-MESSAGING
  §14.2), so this bounds only a misbehaving or compromised caller.
- **Per source address**: registrations 30 per minute; wakes 6,000 per
  minute (vault hosts carry many vaults behind one address). (0.4.2)
  Applied **before the signature check**, as on the relay, so an
  unsigned flood costs no signature or attestation work; the address is
  the hop the load balancer appended to `X-Forwarded-For` (an IPv4
  address, or the IPv6 /64). The per-token limit needs the opened blob,
  so it comes at §5.2 step 3, and a coalesced wake counts toward it.
- A full replay cache (200,000 entries) answers `429 rate_limited`
  (§5, 0.4.2). (0.4.5) Only requests that passed §5.1 step 2 or §5.2
  step 2 are recorded, so requests signed by keys the gateway does not
  know cannot fill it.
- (0.4.5) **Per key**: at most **32 live replay records** for one
  `X-VettID-Key`, registration and wakes together. A key belongs to one
  registration and so to one token (§3); a record lives at most 181 s,
  in which the per-token limit admits at most 14 wakes (the burst of 10
  and 4 of refill), and every further wake is refused at that limit
  whatever the vault does. With the registration that is 15 requests of
  any use; the cap is twice that, rounded up to 32 (and follows the
  per-token limit if an operator raises it). A request over the cap is
  `429 rate_limited` with `retry_after` set to the time until the key's
  first record expires; it is not recorded, the token's allowance is not
  charged, and no other key's request is affected. The cap is judged
  first: a request from a key at its cap is `429` even if it was seen
  before. The count is kept only for keys that passed step 2 and hold a
  record, at most 32 entries a key, so a stranger's key never enters it;
  like the cache it lives in the task's memory.
- Counters live in each task's memory; with N tasks the effective limits
  are up to N times higher, which is acceptable for an abuse bound and
  avoids any shared store. (0.4.5) So does the replay cache, unlike the
  relay's: a request is accepted at most once by each task, so a
  captured wake can be sent once more per further task within its 90 s,
  each a contentless wake that counts against the token's limit on that
  task.
- **Abuse model.** Without a genuine vault's attestation nobody can
  register, and without the blob and its wake key nobody can wake. A
  stolen token alone is useless. A compromised vault enclave could wake
  only the tokens it holds blobs for (its own app), within the limits.
  (0.4.5) Filling the replay cache, which has every wake and
  registration answered `429`, takes 200,000 live records of requests
  that passed step 2, at most 32 to a key: at least 6,250 registered
  wake keys, each with its blob, sending within the per-address limits.
  Only a compromised vault enclave holds such keys (a member's own app
  never sees a wake key), and one such enclave is enough: every
  registration it makes has a new key, so at 30 registrations a minute
  from one address it has 6,250 of them in about 3.5 hours, and blobs do
  not expire. Less is needed to degrade the service than to stop it. The
  cache is in 32 shards of 6,250 records, and a record's shard is
  derived from its key and signature, which the signer can steer by its
  choice of timestamp: about 196 registered keys can keep one shard
  full, and then roughly 1 request in 32, from any vault, is shed with
  `429` (`retry_after` 1); the retry, signed anew, falls in another
  shard 31 times in 32.

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
  context `pushImage`, as the relay). (0.4.2) Reproducibility is checked
  by **`make image-repro`** (two clean builds must give the same image
  id), which the repository's CI runs.
- (0.4.2) **Runtime contract.** The container serves plain HTTP on port
  **8080** (`PUSH_LISTEN_ADDR`) behind the load balancer; the target
  group's health check is `GET /v1/health` and the container's is
  `/vettid-push -healthcheck` (the image has no shell). It runs as uid
  65532 and needs no volume and no writable file system. Configuration
  is by `PUSH_*` environment variables, none of them secret; the
  repository's README is their reference (`PUSH_CHANNEL`,
  `PUSH_PLATFORMS`, `PUSH_FCM_APP_IDS`, `PUSH_APNS_APP_IDS`,
  `PUSH_FCM_PROJECT`, `PUSH_TRUST_PROXY`, the limits of §8). A platform
  left out of `PUSH_PLATFORMS` has no credentials and is answered
  `platform_invalid` (§5.1 step 3).
- **ECS Fargate in the main VettID account** (where the relay runs), stack
  `VettidOrgPushStack`, **2 tasks** in two AZs (stateless, so scaling is
  adding tasks), 0.25 vCPU / 0.5 GB each. Behind the **relay's ALB** with a
  host rule for `push.vettid.org` and the same post-quantum TLS policy (D5:
  the enclave terminates TLS and pins Amazon's roots, as for the relay).
  Its own target group, task role, log group and security group; no
  access to the relay's DynamoDB, S3 or Valkey. About $20 a month.
- (0.4.4) **As built** (vettid.org #213, #216, #217, #223; RUNBOOK
  "Push gateway" is the operator's reference):
  - **Two stacks, not one.** `VettidOrgPushDataStack` is stateful and
    deployed first: the KMS key, one log group per channel, the staging
    zone and the alarm topic. `VettidOrgPushStack` holds the services
    and everything that can be rebuilt; it exists only once a channel
    has an image. A failed service deployment then leaves the log that
    says why.
  - **A certificate per gateway**, added to the relay load balancer's
    HTTPS listener beside the relay's (selected by SNI), with a host
    rule and a target group per gateway. The relay's own certificate
    is not reissued, and requests for any other host still reach the
    relay.
  - **Staging's name** is served from a small zone of its own,
    `push.staging.vettid.org`, in the main account, delegated from
    `staging.vettid.org` by one NS record in the staging account
    (`VettidOrgStagePushDelegationStack`). The certificate validates
    in that zone, so nothing in the main account writes to the staging
    account's zone. Production's record is in `vettid.org` itself.
  - **Network.** The tasks have public addresses in the relay's public
    subnets; their only egress is tcp/443, and their only ingress is
    from the load balancer.
  - **Context** (`cdk.json`): `pushStages` (the channels whose gateway
    exists), `stagingPushImage` / `pushImage` (the image by digest;
    separate so a new image runs on staging first),
    `stagingPushPlatforms` / `pushPlatforms` (default none),
    `stagingPushFcmProject` / `pushFcmProject`, and `stagingPushZoneNs`
    (the staging zone's name servers, for the delegation).
  - **Cost:** about $25 a month per channel (two tasks about $15, their
    two public IPv4 addresses about $7, three secrets, six alarms and
    four filter metrics), plus once the key ($1) and the staging zone
    ($0.50); the load balancer is the relay's. 0.4.0's $20 left out
    the addresses and the alarms.
- Vault side: the vault hosts' DNS firewall and the parent's forwarder
  allowlist gain the gateway's host name (`lib/vault/egress.ts`); the
  release constants gain the gateway URL (VAULT-MESSAGING §11.10.8).

### 10.2 Secrets

In the main account, `us-east-1`, encrypted with a customer-managed KMS
key `alias/vettid-org-push` whose policy allows `kms:Decrypt` only to the
gateway task role (and the account's break-glass admin; 0.4.4: as built
that is the owner's administrator role, below):

| Secret (Secrets Manager) | Content |
|---|---|
| `vettid-org/<stage>/push/apns` | `{team_id, key_id, p8}` (the .p8 PEM) |
| `vettid-org/<stage>/push/fcm` | Workload identity federation config (no secret, §14 question 4), or the service-account JSON key as the fallback |
| `vettid-org/<stage>/push/blob-keys` | `{current, keys: {<key_id>: <b64 32 bytes>}}` |

(0.4.4) **No stack creates these secrets; the operator does.** The
first deployment that had a stack create them failed (2026-10-11):
under a customer-managed key, Secrets Manager requires `kms:Decrypt`
and `kms:GenerateDataKey` of whoever creates a secret or puts a value,
and a deployment role holding those could read every secret. So:

- The owner's administrator role (Identity Center) creates each secret
  **with its value**, under the key (`aws secretsmanager create-secret
  --name vettid-org/<stage>/push/<name> --kms-key-id
  alias/vettid-org-push …`), and is the **only** principal with
  `kms:GenerateDataKey` under the key, hence the only one that can
  create a secret or change a value. The key's administrator statement
  has no cryptographic action and no grant.
- Each gateway's task role may `kms:Decrypt` only through Secrets
  Manager and only for its own channel's secrets (the key policy
  conditions on the secret's ARN, `vettid-org/<stage>/push/*`), and
  may read only `blob-keys` and the secrets of the platforms its
  channel lists. Staging's gateway cannot read production's secrets,
  nor the reverse.
- The first use of a name is `create-secret`; every later change is
  `put-secret-value` on the same secret. **A secret is never deleted
  and created again**: the task role's permission is on the name, and
  a deleted secret's name stays taken for its recovery window (7 to
  30 days).
- A secret that does not exist is no error for a deployment; only a
  service that needs it does not start. A gateway with no platform
  listed needs `blob-keys` alone.

`<stage>` is `prod` or `staging`. Tasks read them at start; nothing is
written back. The APNs key is rotated yearly (Apple allows two active
keys, so rotation has no gap).

(0.4.2) In `blob-keys`, a `<key_id>` and `current` are the blob's 4 key
id bytes as **8 lowercase hex digits**; no other member is accepted, so
the secret carries no dates. The operator prepares it with the
repository's `pushctl` (`blob-keys new`, `rotate`, `drop <key_id>`,
`list`; its output is the secret and goes straight into Secrets
Manager): the yearly rotation is `rotate`, and deleting a retired key
after its 400 days (§4) is `drop`, a step on the operator's calendar.
Because tasks read secrets only at start, a rotation or a drop takes
effect when the tasks are next started (a new deployment of the
service).

(0.4.2) The Firebase project id the gateway sends to is
`PUSH_FCM_PROJECT`, or else the `project_id` member of the `fcm` secret.
A service-account key has that member; a federation configuration as
Google generates it has none, so with federation either the variable is
set or `project_id` is added to the secret. Neither: the task does not
start.

### 10.3 FCM access without a key (recommended)

GCP **workload identity federation** for AWS: a workload identity pool in
the Firebase project trusts the main account and the gateway task role;
the gateway exchanges its AWS role credentials for a short-lived Google
access token that impersonates a service account with only the
**Firebase Cloud Messaging API Admin** role. No long-lived Google key
exists anywhere. Fallback, if federation proves impractical: a JSON key
for that service account in the secret above.

(0.4.2) The federation secret is Google's `external_account`
configuration for AWS (`environment_id` `aws1`, the standard
`regional_cred_verification_url`, Google's STS `token_url`, a
`service_account_impersonation_url`). The gateway builds the AWS subject
token itself: it signs the `GetCallerIdentity` request with the
credentials of the AWS SDK's default chain (the ECS task role) for
`AWS_REGION`. It does **not** read `credential_source.url` or
`credential_source.region_url` (the EC2 metadata addresses Google's own
libraries use); they may be present and are ignored. A configuration
with any other token or impersonation host is refused at start.

### 10.4 Staging and production

| | staging | production |
|---|---|---|
| URL | `https://push.staging.vettid.org` | `https://push.vettid.org` |
| ECS service | a second service in the same cluster | |
| Trusted manifest | the staging manifest and key | the production manifest, keys A and B |
| Firebase project | `vettid-staging` | `vettid-prod` |
| APNs environments | `sandbox` and `production` | `production` only |
| App ids (Android) | the staging build's application id (0.4.4: `com.vettid.app.staging` since staging release S10, VAULT-MESSAGING 0.26.0 §11.10.8; `com.vettid.app` before) | `com.vettid.app` |
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

(0.4.4) **State, 2026-10-11.** The staging gateway is live at
`https://push.staging.vettid.org` (two tasks) with **no platform
enabled**: the Firebase project does not exist yet (owner: hold), so
every registration is answered `platform_invalid` (§5.1 step 3).
Production has no gateway
(`pushStages` is `staging`). vettid.org's open source page lists
`vettid-push`.

A staging vault image embeds the staging URL; channels cannot cross
(VAULT-MESSAGING §11.10.8). The dev stack uses a **gateway stand-in**
(`vettid-push -dev`) that accepts the dev enclave's test attestation and
records wakes instead of sending them (N3). (0.4.2) `-dev` takes the dev
enclave's **test** Nitro root from `PUSH_DEV_NITRO_ROOT` (base64 DER; the
vault's dev stack publishes it as `nitro_root`) or
`PUSH_DEV_NITRO_ROOT_FILE` (PEM), and the accepted PCR0s from
`PUSH_DEV_PCR0S` in place of a manifest. It refuses the real AWS Nitro
root, runs only as channel `dev` (its blobs open nowhere else), and the
`PUSH_DEV_*` variables are refused without `-dev`.

### 10.5 Observability without personal data

- **Metrics** (CloudWatch EMF): `registrations{platform,outcome}`,
  `wakes{platform,environment,outcome}`, `provider_latency_ms{platform}`,
  `attestation_failures{reason}`, `rate_limited{scope}`, `blob_resealed`.
  No dimension identifies a token, key, vault or address. (0.4.2) Also
  **`manifest_refresh{outcome}`** (`ok`, `error`, `not_published`; the
  "manifest refresh failing" alarm reads it) and **`internal_errors`**
  (every `500 internal`; the "any `internal`" alarm reads it). The EMF
  namespace is **`vettid-org/<channel>/push`**. Every dimension value
  comes from a closed set: `reason` includes `no_manifest` (§5.1 step
  2); `scope` is `address_register`, `address_wake`, `token`,
  `replay_cache` or (0.4.5) `key` (a key at its cap of replay records,
  §8); a wake's `outcome` is `sent`, `coalesced`, an error
  code of §7, or `provider_auth`, `provider_rejected`,
  `provider_rate_limited`, `provider_unavailable`.
- **Logs**: errors and starts only, 14 days, in
  `/vettid-org/<stage>/push-service`; never a token, blob, wake key,
  attestation document, source address or per-request line. ALB access
  logs stay off for the push host. (0.4.2) "Starts" includes the two
  shutdown lines ("shutdown signal received; draining" and "push gateway
  stopped"). One warning is logged, once, while the channel has no
  manifest published ("registrations are refused until one is"). Error
  lines are limited to one a minute per kind and carry only values from
  closed sets (a platform's reason by name, never its text).
- **Alarms** (SNS to admin@vettid.org): provider auth failures (APNs
  `403 InvalidProviderToken`, FCM `401/403`), `provider_unavailable` above
  5 % for 10 minutes, any `internal`, manifest refresh failing for 1 hour,
  attestation failures above a baseline. (0.4.4, as built) The alarms
  go to a topic of their own, `vettid-org-push-alerts` (the security
  alerts topic takes EventBridge events only). "Above a baseline" is a
  fixed **more than 25 refused attestations in an hour** to start
  with, to be adjusted once real traffic shows a baseline. A sixth
  alarm, **`no-healthy-task`**, fires when the load balancer has had
  no healthy task for 3 minutes, and reports the recovery too. The
  sums the alarms need across platforms come from metric filters on
  the gateway's own metric lines.

## 11. Client behaviour (informative)

### 11.1 Android: Google push mode (ANDROID-PLAN §4 Notification modes)

1. The member chooses **Google push**; the app gets its FCM token
   (Firebase initialised at runtime, ANDROID-PLAN) and sends
   `push.register{platform: "fcm", token, app_id}`; then it stops the
   on-phone service. (0.4.2, as ANDROID-PLAN 0.1.32 now also says.) The
   service stops only once the vault answers that it holds the
   registration, so there is no gap. Leaving Google push for the
   on-phone service, the app starts `push.unregister` and then the
   service without waiting for the answer. While the vault cannot
   register (`unavailable`, `limit`, another refusal, `gateway_error`
   retries) the on-phone service runs as the fallback and the member's
   choice stays Google push (ANDROID-PLAN §4 Notification modes, 4;
   the fallback beyond `limit` was approved by the owner on 2026-10-11).
2. A wake arrives as a high-priority data message in
   `FirebaseMessagingService.onMessageReceived`. The app collects from its
   relay mailbox over its normal vault session (Relay §6), decrypts on the
   phone, persists and acks as when open, and posts notifications through
   the existing channels, Mapping and Content rules (ANDROID-PLAN §4,
   items 6–8). A wake gives about 20 s; a longer collect continues as
   expedited `WorkManager` work. `onDeletedMessages` triggers a collect.
   (0.4.2) The app collects for at most **15 s** of the 20 and then
   hands over; the message's content is never read (ANDROID-PLAN §4
   Notification modes, 4 has the details).
3. FCM may downgrade high-priority messages that show no notification.
   The vault wakes only for what the Mapping notifies (VAULT-MESSAGING
   §14.2), so nearly every wake shows one.
4. `onNewToken` and `push.token-needed` send `push.register` again;
   leaving the mode sends `push.unregister`. (0.4.2) A **wipe or erase
   sends none** (0.4.1 said it did): by then the vault has removed the
   app and erased the registration itself, or was deleted with it
   (VAULT-MESSAGING §14.1), and the phone has no session left to send it
   over. The app deletes its FCM token locally and at Google.

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
      the downloaded file. (0.4.4) Either way the secret does not exist
      beforehand: you create it with its value (`create-secret` under
      `alias/vettid-org-push`, §10.2; the commands are in RUNBOOK
      "Filling the FCM and APNs secrets").
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
      delete the file. (0.4.4) Here too the secret is created with its
      value, in your own session (§10.2).
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
   (0.4.4, as built: not quite nothing. Production's name is added by
   the stack. Staging's needed one step by hand, done on 2026-10-11:
   the four name servers of the new zone `push.staging.vettid.org`
   copied into `cdk.json` (`stagingPushZoneNs`) and the delegation
   stack deployed in the staging account, §10.1. Each gateway has its
   own certificate; the relay's is untouched.)

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
15. **A maximum age for the trusted manifest** (0.4.2, from the gateway
    implementation; §5.1 step 2). Today there is none: a gateway that
    cannot refresh keeps the manifest it has until it restarts, and a
    restarted task trusts whatever correctly signed manifest the site
    then serves, because its serial rule is in memory. The risk of no
    limit: a release removed from the manifest after the last good
    refresh can still register, for as long as the gateway is cut off
    from the site. What that gives an attacker is small (a registration
    lets a vault wake only tokens it already holds, §8) but it is open
    ended. The risk of a short limit: every new registration fails
    whenever the site is down (wakes do not; Android falls back to the
    on-phone service, iOS has no fallback). **Recommended: a long
    limit, 7 days** since the last successful refresh, then
    `403 attestation_invalid` (reason `manifest_stale`) until a refresh
    succeeds. The alarm fires after 1 hour, so 7 days is never reached
    in normal operation, and apps fetch the same manifest at enrolment
    and unlock, so a week without the site is an incident of its own;
    the limit only closes the open-ended case. **Not recommended: persisting the serial** across
    restarts; it would give the gateway its first stored state, and
    serving an older signed manifest needs control of the site, which
    apps' first fetch trusts in the same way. **Answered as
    recommended** (owner, 2026-10-11) and implemented (vettid-push #1,
    0.4.3; §5.1 step 2).

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

(0.4.2) The vector's timestamp has whole seconds; one with fractional
seconds (`2026-06-10T12:00:00.123456789Z`, as the vault's client sends)
is equally valid. The canonical string takes the `X-VettID-Timestamp`
header **verbatim**: a verifier that parses the time and formats it
again computes another digest and refuses a good signature.

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

- **0.4.5** — the replay cache holds only requests whose key the
  gateway knows (vettid-push #2; approved by the owner 2026-10-13).
  Until now a request was recorded as soon as its signature verified,
  so signed requests from any key could fill the cache and have every
  wake and registration answered `429`. **Order (§5, §5.1, §5.2):**
  step 1 is the signature and freshness only. A registration is checked
  against the replay cache and recorded after its attestation has
  verified (step 2) and before its body is checked (step 3); a wake
  after its blob has opened for the signer and its record is one the
  gateway would still seal (step 2), and before the per-token limit
  (step 3). A wake body that is not a wake, or whose class is not
  `notify`, is `bad_request` before the blob is opened. **Answers:** a
  request refused before the replay check (`signature_invalid`,
  `timestamp_stale`, `attestation_invalid`, `blob_invalid`, a wake's
  `bad_request`) leaves no record and, sent again, is checked afresh;
  it is no longer answered `replay_detected`. A request refused after
  it (a registration's body faults, a wake's `rate_limited` at the
  per-token limit, `provider_unavailable`, `token_gone`,
  `token_invalid`) is recorded as before, so a retry must be signed
  anew. `replay_detected` and a full cache's `429 rate_limited`
  (`retry_after` 1) are now answered only to a request that passed
  step 2. Freshness and the replay check use one reading of the clock.
  **Abuse (§8):** one key has at most 32 live replay records (twice
  what the per-token limit can admit in a record's 181 s, with the
  registration); beyond that the key's own requests are
  `429 rate_limited` until a record expires, and no other key is
  affected, so one registered wake key cannot fill the cache either.
  The cap is judged before the replay lookup, so a request from a key
  at its cap is `429` even if it was seen before. What remains is
  written down: a compromised enclave with 6,250 registered keys can
  fill the cache, and one with about 196 can fill one of its 32 shards.
  The cache is per task, like the counters, so a request can be
  accepted once by each task. §7: the `429` row names the per-key cap.
  §10.5: `rate_limited` has the new `scope` value `key`. §1 principle
  5: the replay rule is the relay's, its place in the order is not. No
  change to the wire format, the codes, the payloads or the vault's
  side.
- **0.4.4** — the deployment as built (vettid.org #213, #216, #217,
  #223; vettid-push #1; approved by the owner 2026-10-11). No change to
  the wire format or to the gateway's behaviour. §10.1: two stacks
  (`VettidOrgPushDataStack`, `VettidOrgPushStack`), a certificate per
  gateway on the relay's listener, staging through a delegated zone
  `push.staging.vettid.org`, egress tcp/443 only, the context keys,
  about $25 a month per channel. §10.2: no stack creates a secret; the
  owner's administrator role creates each with its value and is the
  only principal that can; each gateway decrypts only its channel's;
  `create-secret` once, `put-secret-value` after, never delete and
  recreate (the first deployment, which had a stack create them,
  failed on 2026-10-11). §10.4: staging's Android app id is
  `com.vettid.app.staging`; the staging gateway is live with no
  platform enabled. §10.5: the topic `vettid-org-push-alerts`, the
  attestation-failures threshold of 25 an hour, the `no-healthy-task`
  alarm. §14.1 items 1.4, 2.3 and 3 follow. §5.1 step 2: while stale
  the refresh stays at 10 minutes, so recovery can take that long;
  the age is on a monotonic clock. 0.4.2 marked approved.
- **0.4.3** — the trusted manifest's maximum age (§5.1 step 2, §14.2
  question 15; owner, 2026-10-11; vettid-push #1): 7 days since the
  last successful refresh, then registrations are refused with the
  metric reason `manifest_stale` until a refresh succeeds; wakes are
  not affected; the serial is still not persisted. No change to the
  wire format.
- **0.4.2** — errata from the gateway and Android N4 implementations
  (vettid-push; vettid-android #109; approved by the owner 2026-10-11,
  merged as vettid.org #211).
  Implemented behaviour written down where 0.4.1 was silent or
  ambiguous. **Requests** (§5, §15): timestamps may carry fractional
  seconds and the digest uses the header string verbatim; a full replay
  cache is `429 rate_limited`. **Register** (§4, §5.1): the per-address
  limit comes before the signature check; without a trusted manifest
  every registration is `403 attestation_invalid` (reason `no_manifest`)
  and the fetch is retried every minute; no maximum age for a manifest
  that cannot be refreshed, and the serial rule is in memory only; the
  code for each body fault (`environment` faults and a refused `sandbox`
  are `bad_request`, a platform without credentials is
  `platform_invalid`, a record too large for a blob is `token_invalid`).
  **Wake** (§5.2, §8): the per-address limit first, the per-token limit
  at step 3; a blob whose record would no longer be sealed is
  `blob_invalid`; "the previous one" is the previous sent wake, a wake
  after a failed send is sent, and a coalesced wake counts toward the
  token's 60 per hour. **Platform answers** (§7): FCM
  `SENDER_ID_MISMATCH`, every FCM `400` and APNs
  `DeviceTokenNotForTopic` are `token_invalid`; any APNs `410` is
  `token_gone`; APNs `403`, FCM `401`/`403`, `BadTopic`,
  `TopicDisallowed` and other refusals of the gateway itself are
  `502 provider_unavailable`; `404 not_found`. **Deployment** (§10):
  `make image-repro`; the runtime contract (port 8080, `GET /v1/health`,
  `-healthcheck`); blob key ids are 8 lowercase hex digits, the secret
  has no dates, so dropping a retired key is an operator step
  (`pushctl blob-keys drop`) and a rotation takes effect at the next
  task start; the Firebase project id comes from `PUSH_FCM_PROJECT` or
  `project_id`; federation signs with the task role and ignores
  `credential_source.url` and `region_url`; `-dev` takes the test root
  from `PUSH_DEV_NITRO_ROOT`; metrics `manifest_refresh{outcome}` and
  `internal_errors`, the namespace `vettid-org/<channel>/push`, the
  shutdown lines and the no-manifest warning. **Android** (§11.1, with
  ANDROID-PLAN 0.1.32): the on-phone service stops only after the vault
  holds the registration; a wipe sends no `push.unregister` (0.4.1 said
  it did; VAULT-MESSAGING §14.1 already erases the registration); the
  collect takes at most 15 s of a wake. **Owner decision pending**:
  §14.2 question 15, a maximum age for the trusted manifest
  (recommended: 7 days; not implemented). No change to the wire format,
  the payloads or the vault's side (VAULT-MESSAGING stays 0.24.1).
- **0.4.1** — errata from the vault's N3 implementation (vettid-vault
  #59; approved, owner decision 2026-10-10): the event asking the app
  for a fresh token is `push.token-needed` (§11.1, §11.2), as VAULT-MESSAGING 0.24.1
  corrects it; 0.4.0's `push.token_needed` broke VAULT-MESSAGING §5.3's
  type grammar. The vault's handling of each gateway answer is
  VAULT-MESSAGING 0.24.1 §14.1 and §14.2. Owner decision 2026-10-10
  (§7): a `401` is `gateway_error` at registration with no retry and is
  retried like a `5xx` at a wake (0.4.0: "retry once"); at a wake only
  `400 token_invalid` is handled as `token_gone`, and the other `400`
  codes are retried like a `5xx`; the `Retry-After` header is used when
  the body has no `retry_after`, capped at 3,600 s; a wake attempt waits
  at most 10 s.
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
