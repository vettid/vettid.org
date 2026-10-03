---
title: CALLING-SERVICE
status: draft
version: 0.1.1
date: 2026-10-03
owner: Al Liebl (Mesmer)
component: calling-service (optional, media plane only)
related:
  - PQC-MIGRATION.md
  - RELAY-PROTOCOL.md
  - PUSH-GATEWAY.md
classification: public (no secrets; safe for github.com/vettid)
review-cycle: 6 months or upon WebRTC PQC / AWS milestone, whichever first
---

# VettID Calling Service

## 1. Purpose

Define an **optional, self-hostable media-plane service** for 1:1 voice and
video calling between VettID connections. The service is a blind forwarder of
end-to-end encrypted media frames. It is deployed by vettid.org for its own
users and is available, unchanged, to any self-hosted deployment.

Scope is **1:1 only**. Group calling, and therefore any
SFU role, is explicitly out of scope for this service and belongs to a future
group service built *on* VettID connections, not *in* VettID.

## 2. Position in the architecture

| Plane | Carried by | Sees |
|---|---|---|
| Control (signaling) | Existing relay (E2E deposit types) + push gateway wake | Ciphertext only |
| Media | Calling service (TURN) or direct P2P via ICE | Double-encrypted frames only |
| Keys | Vault ↔ vault via relay (hybrid KEM handshake) | Never leaves E2E envelope |

The calling service passes the established routing heuristic for a separate
service: different protocol (UDP/ICE vs. WebSocket), different trust profile
(untrusted forwarder vs. vault), different scaling shape (bandwidth-heavy,
long-lived allocations vs. ephemeral queues).

## 3. What this service will never do

Mirroring the relay's narrow-job discipline, the calling service will never:

1. Terminate, decrypt, or inspect media (no keys are ever available to it).
2. See or carry signaling (offers/answers/ICE candidates ride the relay).
3. Hold user identity, credentials, or a user database.
4. Record, transcode, or analyze calls ("call quality analytics" included —
   each such feature requires media access or metadata retention and is
   therefore structurally excluded, not merely deferred).
5. Retain per-call metadata beyond operational minimums (ephemeral
   allocations; no call-detail records).
6. Act as an SFU or any multiparty media router (out of scope: 1:1 only).

Any proposed feature that conflicts with this list is a new service, not an
extension of this one.

## 4. Composition

- **coturn** (core): mature, well-vetted C implementation of STUN/TURN
  (RFC 5389/8656). Deliberate exception to the Go-everything pattern —
  hand-rolling UDP media relaying would violate the well-vetted constraint.
  Configured with `use-auth-secret` (time-limited HMAC credentials), TURN
  over UDP/TCP/TLS including TCP/443 fallback for restrictive networks.
- **Sidecar** (thin Go service):
  - Rotating-shared-secret endpoint for the vault-side credential issuer
    (mTLS or private-network only; never public).
  - Health/readiness endpoints.
  - Config templating for coturn.
  - Nothing else. The sidecar is configuration plumbing, not a feature host.
- **Packaging**: single container image (coturn + sidecar) with
  docker-compose profile for appliances and CDK construct for AWS
  deployments.

## 5. Credential model

No static credentials anywhere.

1. Vault issues per-call, short-TTL TURN credentials using the time-limited
   HMAC scheme (`username = expiry:session`, `credential =
   HMAC-SHA1(shared_secret, username)` per coturn `use-auth-secret`).
2. The shared secret lives with the credential issuer (vault side) and the
   calling service; it rotates on a schedule and holds no user information —
   the same isolation pattern as the push gateway (credential-holding
   component separated from traffic-carrying component).
3. **Credential issuer interface** (vault side), one interface, per-provider
   implementations:

   ```go
   type ICECredentialIssuer interface {
       // Issue returns ICE server entries + ephemeral credentials
       // for one call, bound to a TTL.
       Issue(ctx context.Context, callID string, ttl time.Duration) ([]ICEServer, error)
   }
   ```

   Implementations: `coturnIssuer` (HMAC, for self-hosted/vettid.org
   instances), `cloudflareIssuer` (API-issued short-lived credentials, for
   overflow/managed profiles). This shim is the **only** vendor-specific code
   in the entire calling path.

## 6. Vault-signed ICE configuration

Delivered inside the E2E call-setup deposit; never fetched from the calling
service itself.

```json
{
  "v": 1,
  "call_id": "<ephemeral>",
  "exp": "<unix ts>",
  "ice_servers": [
    { "urls": ["stun:<host>:3478"] },
    { "urls": ["turns:<host>:5349?transport=tcp"],
      "username": "<expiry:session>",
      "credential": "<hmac>" }
  ],
  "sig": "<hybrid signature per PQC-MIGRATION §5.2>"
}
```

- The list may contain multiple providers (appliance instance + vettid.org
  fleet + managed overflow). ICE candidate gathering across all entries
  yields automatic cross-provider failover with no failover code.
- Clients accept only vault-signed configs; the calling service cannot
  inject or reorder servers.

## 7. Media encryption (E2E, post-quantum)

DTLS-SRTP is retained as transport encryption but is **not relied upon**
(and is not yet post-quantum). The E2E and PQC guarantees ride above it:

1. During call setup, the two devices of the call run the hybrid
   X25519 + ML-KEM-768 exchange (PQC-MIGRATION §5.1) through their vaults
   over the relay; the info binds the call_id. The vaults relay the KEM
   values and never hold the media key (VAULT-MESSAGING §10.10, 0.5.0).
2. Per-call media base key: `k_call = HKDF(ss, salt="vettid-call-v1",
   info=call_id)`.
3. Frame encryption: SFrame-style per-frame AEAD (ChaCha20-Poly1305) via
   WebRTC encoded transforms / insertable streams, with per-sender frame
   counters; ratchet forward per epoch.
4. Result: TURN (any provider) and any on-path observer see doubly encrypted
   frames and hold no keys. Provider choice is a transport decision, not a
   trust decision.

## 8. Deployment profiles

| Profile | Calling service | Overflow | External transport dependency |
|---|---|---|---|
| vettid.org | Own fleet (this service) | Optional managed anycast (e.g. Cloudflare, $0.05/GB after 1 TB/mo free) | Optional |
| Sovereignty appliance | Local instance (bundled container) | None | **None** |
| Cost-conscious self-host | None | Managed anycast free tier | Managed TURN only |

Notes:
- vettid.org deploys the same artifact it publishes — the deployment is a
  customer of its own component.
- Appliance requirement: public IP or forwarded ports (3478/udp,
  3478/tcp, 5349/tcp); TCP/443 mapping recommended for hostile networks.
- STUN is stateless and near-free; all profiles may share any STUN source
  without trust implications.
- Break-even guidance: managed TURN is cheaper below roughly 5M relayed
  minutes/month; revisit self-hosted fleet economics beyond that.

## 9. Signaling deposit types (relay additions)

New deposit types on the existing relay (E2E encrypted, standard PASETO
deposit-token flow, one queue per enclave parent unchanged):

- `call.offer` — SDP offer + KEM public values; each vault adds its own
  signed ICE config when it passes the offer to its own devices
- `call.answer` — SDP answer + KEM ciphertext
- `call.ice` — trickle ICE candidates
- `call.ringing` — the callee rings
- `call.end` — teardown/busy/decline

Body schemas and rules: VAULT-MESSAGING §10.10.

Callee wake via push gateway (wake keypairs unchanged, per PQC-MIGRATION
component #8). Signaling content is inside the E2E envelope: call metadata
(who calls whom, when) is not visible to relay, push gateway, or calling
service.

## 10. Open questions

1. Shared-secret rotation cadence and delivery channel for appliance
   deployments (pull vs. vault-push).
2. Exact SFrame profile: adopt draft SFrame wire format vs. minimal
   in-house framing over encoded transforms (bias: adopt the draft —
   well-vetted trajectory).
3. Bandwidth/abuse controls on open-registration deployments (per-allocation
   rate limits in coturn; align with relay's proof-of-possession posture).
4. IPv6 and mobile-network (CGNAT) candidate-priority tuning.

## 11. References

- RFC 8656 (TURN), RFC 5389/8489 (STUN), RFC 8445 (ICE)
- coturn `use-auth-secret` time-limited credential mechanism
- SFrame (IETF draft), WebRTC encoded transforms / insertable streams
- PQC-MIGRATION.md §5.1 (hybrid KEM), §5.2 (hybrid signatures)
