---
title: CALLING-SERVICE
status: approved by the owner 2026-10-12 (D12–D26 of CALLS-PLAN §13.5; D23 as (c))
version: 0.2.0
date: 2026-10-12
owner: Al Liebl (Mesmer)
component: calling-service (optional, media plane only): a STUN/TURN server and a credential issuer
related:
  - CALLS-PLAN.md (0.1.3) §3, §5, §7, §9 D1–D11, §12, §13 (phase C2; D12–D26, decided 2026-10-12)
  - VAULT-MESSAGING.md (0.28.0) §10.10 calls, §11.10.8 `calls_url`
  - PUSH-GATEWAY.md (0.4.4) §5.1 (the attestation check this service reuses), §10 (the deployment it is modelled on)
  - RELAY-PROTOCOL.md (0.7.1) §4.1 signed requests, §7.1 error bodies
  - VAULT-RELEASES.md (0.1.19) §5.2, §8.4 egress
  - VAULT-HOST-PROTOCOL.md (0.1.2) §8 egress, §11.2 what the parent sees
  - PQC-MIGRATION.md
changelog:
  - 0.1.1 (2026-10-03): first draft, written before the push gateway,
    the release channels and the egress controls existed: coturn with a
    sidecar in one container, the shared secret inside the vault,
    ChaCha20-Poly1305 SFrame
  - 0.2.0 (2026-10-12): rewritten so that phase C2 of CALLS-PLAN can be
    built from it. **Approved by the owner 2026-10-12** on vettid.org
    #243 ("d23 should be c, all other d recommendations are approved":
    D12–D22 and D24–D26 as recommended; D23, an app-side pin of a
    connection's identity key, never). Follows the owner's
    decisions of 2026-10-11 and 2026-10-12 (CALLS-PLAN §9 D1, D3, D4,
    D8, D11 and §12). **The shared secret never enters a vault:** a
    small issuer gives short-lived TURN credentials to attested vaults
    only, with the attestation check of PUSH-GATEWAY §5.1 (§5).
    Usernames are `<expiry>:<random>` and name nobody (§5.3). The
    server is coturn on one small instance in the staging account
    (§8). What C2 deploys and what waits (§4.3, §12). Limits, caps and
    what happens at each (§7). What every party sees (§9). Logging:
    counters only (§10). Stacks, names, secrets made by the operator,
    alarms, the runbook outline, cost (§8, §11). Media encryption is
    the media stack's AES-GCM frame format under keys from `k_call`,
    specified in VAULT-MESSAGING §10.10 and only summarised here (§6);
    the SFrame text is gone. "Relay additions" is gone: the relay
    carries no call-specific type (CALLS-PLAN §6.2)
classification: public (no secrets; safe for github.com/vettid)
review-cycle: 6 months or upon WebRTC PQC / AWS milestone, whichever first
---

# VettID Calling Service

Conformance keywords MUST, SHOULD, MAY are per RFC 2119.

## 1. Purpose

An **optional, self-hostable service for the media plane** of 1:1 voice
and video calls between VettID connections. It does two things:

1. **STUN:** it tells a phone its own public address, so that two phones
   behind routers can find a direct path.
2. **TURN:** it forwards a call's packets when no direct path exists.
   What it forwards is encrypted twice (§6) and it holds no key.

Media goes directly between the two devices whenever it can, and through
TURN only as the fallback (owner decision D1, CALLS-PLAN §3 and §3.1:
members who are connected seeing each other's IP address is accepted;
an "Always relay" switch is deferred). STUN and TURN are both needed and
are one server.

Scope is **1:1 only**. Group calls need a media router, which is a
different service and never this one.

This version describes what **phase C2** builds on staging. §12 lists
what is not in C2.

**Decided.** Where a number or a choice here carries a decision's
number (D12–D26), the owner decided it on 2026-10-12 (CALLS-PLAN
§13.5). Earlier decisions are cited the same way (D1, D3, D4, D8, D11;
CALLS-PLAN §9 and §12). Nothing here is built yet; what is still to be
verified is in §13.

## 2. Position in the architecture

| Plane | Carried by | Sees |
|---|---|---|
| Signalling | The relay, inside the end-to-end sessions (device → its vault → the peer's vault → the peer's devices; VAULT-MESSAGING §10.10) | The relay: ciphertext. The two vaults: the signalling |
| Media | Device to device, or through this service's TURN server | Frames encrypted under the call's keys inside DTLS-SRTP |
| Keys | Agreed between the two devices; the vaults pass the public halves and vouch for them | `k_call` never reaches a vault, the relay or this service |
| TURN credentials | Issued by this service to attested vaults; given by each vault to its own devices in a signed ICE configuration | The issuer: a vault host's address and the release. The TURN server: a random username |

It is a separate service because it differs from everything else VettID
runs: UDP instead of HTTPS, bandwidth instead of requests, a public
relay that will be probed, and no trust placed in it.

## 3. What this service will never do

1. Terminate, decrypt or inspect media. No key is ever available to it.
2. See or carry signalling: offers, answers and candidates travel over
   the relay.
3. Hold a member's identity, a vault's identity, credentials of members
   or any database of users.
4. Record, transcode or analyse calls. "Call quality analytics" is
   included: it would need media access or per-call records.
5. Keep per-call records: no call-detail records, no log line per
   allocation, per credential or per request (§10).
6. Route media between more than two parties.
7. Hold a VettID signing key of any kind, or any credential of Google's
   or Apple's (owner: Google must never hold a VettID key; this service
   has nothing to do with app distribution or push).

A feature that conflicts with this list is a new service.

## 4. Parts

### 4.1 The TURN/STUN server

**coturn**, a mature C implementation of STUN and TURN (RFC 8489,
RFC 8656), at a pinned version, in a container image built reproducibly
in this service's repository. It is the one place in VettID's own
services that is not Go: writing a UDP media relay would break the rule
of using well-tested components. Its configuration is §7.2.

### 4.2 The credential issuer

A small Go program (§5): one HTTPS endpoint that verifies a Nitro
attestation and answers with TURN credentials. It keeps no state and
writes nothing. It shares the attestation and manifest code of
`vettid/vettid-push` (PUSH-GATEWAY §5.1) rather than a second
implementation of it.

### 4.3 What C2 deploys, and what waits

| | C2 | Waits for |
|---|---|---|
| STUN, UDP 3478 | yes | |
| TURN over UDP 3478 | yes | |
| TURN over TCP 3478 | yes (it costs nothing extra and helps networks that block UDP) | |
| TURN over TLS on TCP 443 (`turns:`) | **no** (D18) | C5, the hostile-network phase: it needs a certificate on the instance and its renewal, and C2's exit test does not need it |
| Relayed addresses over IPv4 and IPv6 | yes; IPv6 is tested as far as the test networks allow (§7.4) | |
| The issuer | yes | |
| A second server, a second region, a managed overflow provider | no | load that staging does not have |
| A production deployment | no | promotion (CALLS-PLAN §7); its home is decided then (D3) |

### 4.4 Repository

`vettid/vettid-calls`, public, AGPL-3.0 like the vault and the push
gateway (CALLS-PLAN §5.2). It holds: the issuer (`cmd/vettid-calls`);
the coturn image (a pinned coturn, the configuration template of §7.2,
and `turn-agent`, a small Go program beside coturn that reads the
secret, renders the configuration and turns coturn's counters into
metrics, §10); `callsctl` for the operator (§8.3); a README for
self-hosters. Reproducibility is checked in CI as in vettid-push
(`make image-repro`, and the same for the issuer's archive).

## 5. Credentials

No static credential exists anywhere, and **the shared secret never
enters a vault** (owner decision D4, CALLS-PLAN §5.1). 0.1.1 had the
vault compute credentials from the secret; that would have put one
fleet-wide secret into every enclave.

### 5.1 Who may get one

**An attested vault, and nobody else.** A vault proves that it is a
VettID vault release listed in its channel's signed manifest, exactly as
it does when it registers with the push gateway. An app, a desktop, a
member and an agent never talk to the issuer: a device gets servers and
credentials only from its own vault, inside the signed ICE configuration
(VAULT-MESSAGING §10.10).

### 5.2 The request

```
POST /v1/credentials
X-VettID-Key:         <base64 Ed25519 public key, made for this one request>
X-VettID-Timestamp:   <RFC 3339, fractional seconds allowed>
X-VettID-Sig:         <signature per RELAY-PROTOCOL §4.1>
X-VettID-Attestation: <base64 Nitro attestation document>
{ "count": 1..4 }

→ 200 { "stun": ["stun:<host>:3478"],
        "turn": ["turn:<host>:3478?transport=udp", "turn:<host>:3478?transport=tcp"],
        "credentials": [ { "username": "<expiry>:<random>",
                           "credential": "<base64>",
                           "exp": <Unix seconds> } ] }
```

`GET /v1/health` is unauthenticated and returns `200 {}`. A request body
is at most 1 KiB. Error bodies follow RELAY-PROTOCOL §7.1.

The issuer, in order:

1. checks the signature and that the timestamp is within 90 s
   (RELAY-PROTOCOL §4.1; `401 signature_invalid`, `timestamp_stale`);
2. **verifies the attestation** with the rules of PUSH-GATEWAY §5.1
   step 2, unchanged: a COSE_Sign1 Nitro attestation document whose
   certificate chain ends at the pinned AWS Nitro Enclaves root;
   `timestamp` within 300 s; `public_key` = the 32 bytes of
   `X-VettID-Key`; `user_data` = the request's 32-byte digest;
   `pcrs[0]` equal to the `pcr0` of a release in the channel's trusted
   manifest whose status is `active` or `deprecated`. The issuer fetches
   and verifies the manifest itself under the channel's pinned manifest
   keys, refuses a lower `serial`, refreshes every 10 minutes, and
   trusts a manifest it could not refresh for at most 7 days
   (`403 attestation_invalid` in every failing case, identically);
3. checks the body (`400 bad_request`);
4. makes `count` credentials (§5.3) under the current secret and
   answers. Nothing is written anywhere.

Where this differs from the push gateway, and why:

- **An attestation on every request, and a fresh key each time.** The
  push gateway attests once and then recognises a wake key. Here there
  is nothing to recognise: two requests of one vault share no key, so
  the issuer cannot tell that they came from the same vault. A request
  is rare (§5.4), so the cost of an attestation per request is small.
- **No replay cache.** The issuer keeps no state. A replayed request
  would yield another credential, to someone who already holds a valid
  request; only the vault does, because TLS ends inside the enclave.
- **The manifest's age** is measured on the wall clock, since an issuer
  that runs as a function is frozen between requests (the gateway uses
  a monotonic clock).

The key of `X-VettID-Key` MUST be made for the one request and discarded
after it. It MUST NOT be the vault's relay key, an identity key, a wake
key, the credential key or any end-to-end key (as PUSH-GATEWAY §3 says
of the wake key).

### 5.3 The credential, and what a username says (V8)

The TURN REST form that coturn's `use-auth-secret` checks:

```
username   = <expiry> ":" <random>
             expiry: Unix seconds, decimal; the moment the credential stops being accepted
             random: 16 bytes from the issuer's random source, base64url without padding (22 characters)
credential = standard base64 of HMAC-SHA-1(shared secret, username)
```

- **A username identifies nobody.** It holds a time and random bytes
  that the issuer makes and does not keep. It carries no `call_id` (as
  0.1.1 had it), no vault, no member, no device and no connection, so a
  TURN session cannot be tied to a call record or to a person through
  it. The vault does not choose any part of it.
- **One credential serves one call on one side** (VAULT-MESSAGING
  §10.10: a vault retires a credential once a call that carried it was
  placed or answered). The two sides of a call use credentials from
  their own vaults, which have nothing in common. So the TURN server
  cannot link two calls of one member by username. It can still link
  them by the phone's address, as any server can.
- **Lifetime: 6 hours** (D14; the vault code's `ICETTL` today, and the
  limit of CALLS-PLAN §5.3). A vault does not give a device a
  credential in its last 2 hours. Whether coturn ends an allocation
  when its credential expires during a long call is **not established**
  (CALLS-PLAN §11); C2 tests it (§13).
- **HMAC-SHA-1** is what coturn computes here, and TURN's own message
  integrity is HMAC-SHA-1 keyed with an MD5 digest (RFC 8489 long-term
  credentials). Neither is a choice of ours, and neither protects a
  call: they gate who may use the relay. The owner's rule "known-good
  algorithms only" (CALLS-PLAN §12.3) is about what protects members'
  data, which here is the frame encryption of §6. Said plainly so that
  nobody reads SHA-1 and MD5 as protecting media.

### 5.4 How a vault uses the issuer

Normative in VAULT-MESSAGING §10.10 ("Vault-signed ICE configuration");
in short:

- The channel's release constant `calls_url` names the issuer
  (`https://calls.staging.vettid.org` on staging; absent in production,
  where calls stay off). Without it the vault gives its devices an empty
  server list, as every vault does today.
- A vault keeps a **pool of up to 4 credentials in memory**, fetched
  once after unlock and refilled when calls have used them or they have
  aged (D13). A call never waits for the issuer except when the pool is
  empty, and then at most 2 s. The pool is never written to the vault's
  state.
- The vault's own limit is 4 requests an hour and 24 a day. It is part
  of the measured release, which is what the attestation proves.
- If the issuer cannot be reached the vault gives its devices the STUN
  URL it last learned and no TURN entry. Direct calls still connect.

### 5.5 How a vault reaches the issuer

Through the parent's forwarder, as it reaches the relay and the push
gateway (VAULT-HOST-PROTOCOL §8; VAULT-RELEASES §8.4):

- the enclave's release allowlist gains the host of `calls_url`, with
  Amazon's roots, TLS 1.3 and HTTP/2;
- the parent's allowlist (`DefaultAllow`) gains `calls.vettid.org` and
  `calls.staging.vettid.org` (one parent binary serves every channel,
  as for the push gateways; D25);
- each stage's DNS Firewall admits only its own channel's name
  (`lib/vault/egress.ts`). Production's does not admit either until
  production has a calling service.

So the issuer MUST present a certificate that chains to an Amazon root,
MUST accept TLS 1.3 and HTTP/2, and MUST answer on port 443. This
decides how it is deployed (§8.2).

## 6. Media encryption (summary; normative in VAULT-MESSAGING §10.10)

The service forwards media it cannot read:

1. The two devices agree `k_call` with MLKEM768X25519 through their
   vaults; each share is signed by its device and vouched for by that
   device's vault. No vault holds `k_call`.
2. From `k_call` each device derives two direction keys, bound to the
   negotiated **media suite**, to the caller's whole list of suites and
   to the `call_id`. Suite 1 is AES-128-GCM in the media stack's frame
   format; suite 2 (AES-256-GCM) is registered and offered by no build
   until the media stack can do it (owner decisions of 2026-10-12,
   CALLS-PLAN §12.3: 128 bits accepted for now, cipher agility as a
   goal). **With suite 1 the frame cipher is the weakest part of a
   call**, below the key agreement.
3. Every audio and video frame is encrypted under those keys before it
   is packetised. DTLS-SRTP below it is kept and **not relied upon**:
   the SDP is not signed, so DTLS alone would not bind a call to the
   connection.
4. So this service, and anyone on the path, sees SRTP packets whose
   payload is already ciphertext under keys they do not have. Choosing
   a TURN provider is a transport decision, not a trust decision.

0.1.1's item 3 (SFrame with ChaCha20-Poly1305 and a ratchet) is replaced
by the above (owner decision D11).

## 7. Limits and abuse

### 7.1 Who can use the relay

Whoever holds a credential that has not expired: a device of a member
whose attested vault is unlocked, and anyone that device passes the
credential to. A credential gives its holder a relay address and the
right to exchange UDP with peers it names, within the caps below. It
gives no access to anything of VettID's.

### 7.2 The server's configuration

coturn is configured as follows. The option names are coturn's as known
when this was written; they are to be confirmed against the pinned
version when the image is built (§13).

| Rule | Setting | Why |
|---|---|---|
| Credentials | `use-auth-secret`; realm = the server's name; no static users | §5 |
| No TCP relaying | `no-tcp-relay` | Calls are UDP; a TCP relay is a general proxy |
| Where a relay may send | `denied-peer-ip` for loopback, link-local, private (RFC 1918), shared (100.64.0.0/10), multicast, reserved and documentation ranges, the instance metadata address, IPv6 loopback, unique-local, link-local and IPv4-mapped ranges, and the service's own network range; `no-multicast-peers` | A TURN server is otherwise a door into its own network. **The server's own public addresses stay allowed**: a call in which both sides are relayed is one allocation sending to another on the same server (CALLS-PLAN §10 risk 6) |
| Bandwidth per allocation | `max-bps`: **256 kbit/s** in each direction while calls are voice only; 3 Mbit/s when video arrives in C4 (D15) | A voice call with frame encryption uses about 60–90 kbit/s each way. A low cap makes the relay useless for anything else |
| Allocations per credential | `user-quota`: **10** | One device may allocate once per network interface, address family and transport; 10 covers that and stops one credential serving a crowd |
| Allocations in total | `total-quota`: **100** on staging (D16) | |
| Bandwidth in total | `bps-capacity`: **4 Mbit/s** on staging (D16) | Bounds the cost of the worst day (§7.3) |
| Allocation lifetime | coturn's default (10 minutes, refreshed by the client) | A dead client's allocation goes within 10 minutes |
| STUN | no RFC 5780 behaviour discovery, no pre-RFC 5389 compatibility, no software attribute | Smaller answers, nothing to fingerprint |
| Management | no CLI listener, no web admin | |
| Transport security | no TLS or DTLS listener in C2 (§4.3) | |

### 7.3 What happens at each cap

| Cap | What the server does | What the member sees |
|---|---|---|
| Bandwidth per allocation | Drops the packets above the rate | Voice is far below it. Video above it degrades as on a poor network |
| Allocations per credential | Refuses the allocation (TURN error 486) | Nothing, unless that device needed more than 10 |
| Allocations in total, bandwidth in total | Refuses new allocations; calls already relayed continue | A new call that needs the relay does not connect: the app says the call could not be connected. Direct calls are not affected. An alarm fires (§10) |
| Traffic per day (D16) | An alarm at **5 GB** out in a day. At **30 GB** in a day the instance group is set to zero: **the relay is off** until the operator turns it on again | As the row above, for every call that needs the relay, until the operator acts |
| The vault's own request limit (§5.4) | The vault gives STUN only | As above for calls that need the relay |

In C2 the app does not say why a relayed call failed beyond "could not
connect"; its call diagnostics record the TURN error. A specific text is
C6's (D15).

The daily stop exists because the bandwidth caps alone do not bound
cost: 4 Mbit/s for a whole day is about 43 GB. At 30 GB a day's traffic
beyond the account's free allowance costs under $3.

### 7.4 IPv6

The instance has an IPv4 address and an IPv6 address, both fixed, both
in DNS. coturn listens on both and gives relayed addresses of either
family (RFC 8656). Many mobile networks give phones IPv6 only and reach
IPv4 through the carrier's translation; a phone there reaches the server
over IPv6 directly. What C2 verifies is limited to the networks the test
phones are on, and is written into CALLS-PLAN with the exit test.
Candidate priorities are left to the media stack.

### 7.5 The issuer's limits

- **Unattested callers get nothing.** The signature is checked before
  the attestation, so a flood without a valid signature costs one
  Ed25519 check per request.
- **In total:** the issuer runs at most 4 requests at once on staging;
  more are answered `429`. An attacker can therefore keep vaults from
  getting credentials while the flood lasts. What that costs members is
  the relay, not calls: vaults keep their pools and their STUN URL.
- **Per source address:** not in C2 (it needs a stateful rule in front
  of the issuer, about $6 a month). Required before production.
- **Per vault:** the issuer cannot count per vault, and that is
  intended (§5.2). The vault's own limit (§5.4) is in the measured code
  the attestation proves. What a credential can do is bounded at the
  TURN server (§7.2).

### 7.6 What a compromise yields

| Compromised | The attacker gets | Recovery |
|---|---|---|
| The TURN server (its memory, its secret) | Free relaying within the caps; the addresses and traffic volumes of calls relayed while it lasts; the ability to drop or delay relayed media. **No content**, and no way to change it unnoticed | Rotate the secret (§8.3), rebuild the instance from the image |
| The issuer | The same secret, so the same | The same |
| A vault's enclave (not this service's concern, stated for completeness) | Credentials within that vault's limit | A vault release |

## 8. Deployment on staging

### 8.1 Account and names

**The staging account** (vettid-vault-staging, 347272280361), one
region (us-east-1), in a network of its own (owner decision D3: a public
UDP relay is the piece most likely to be probed, so it stays away from
the relay and from production's data in the management account).

| Name | What |
|---|---|
| `turn.staging.vettid.org` | The TURN/STUN server: A and AAAA records to the instance's fixed addresses, in the staging zone |
| `calls.staging.vettid.org` | The issuer, behind an Amazon certificate |

Production's names would be `turn.vettid.org` and `calls.vettid.org`;
nothing serves them.

### 8.2 Stacks

Two stacks, after what the push gateway's first deployment taught
(PUSH-GATEWAY §10.1 "As built": a stateful stack first, so that a failed
service deployment leaves the log that says why). Both are built only in
the staging app (`-c stage=staging`) and only when context `callsStages`
names the stage, as `pushStages` does for the gateway. CALLS-PLAN §5.2
named one stack, `VettidOrgStageCallsStack`; these two replace it.

| Stack | Kind | Owns |
|---|---|---|
| `VettidOrgCallsDataStack` | **stateful**, retained, termination protection | The key `alias/vettid-org-calls`; the Elastic IP and the fixed IPv6 address of the server (they are in DNS and in no vault release, but phones cache them); the log groups; the alarm topic `vettid-org-calls-alerts` |
| `VettidOrgCallsStack` | stateless | A small VPC with one public subnet (IPv4 and IPv6), no NAT, **no flow logs** (§10); the security group; an Auto Scaling group of one `t4g.small` (arm64, Amazon Linux 2023, IMDSv2, no key pair, no inbound but the ports below, Systems Manager sessions only) that takes the fixed addresses at boot and runs the coturn image, pinned by digest; the issuer and what fronts it; the DNS records; the alarms |

**What is stateful:** only the addresses, the key, the secret and the
log groups. The instance holds nothing: replacing it loses the calls
being relayed at that moment and nothing else.

**Inbound to the instance:** UDP 3478, TCP 3478 and UDP 49152–65535,
IPv4 and IPv6, from anywhere. Nothing else; TCP 443 is not open in C2.
**Outbound:** UDP to anywhere (that is the relay), TCP 443 (the image
registry, Secrets Manager, CloudWatch, Systems Manager).

**The issuer** is the Go program of §4.2 as a function (arm64, at most
4 at once), behind a CloudFront distribution with the name
`calls.staging.vettid.org` and an ACM certificate (D17). Reasons:

- the enclave's egress requires TLS 1.3, HTTP/2 and an Amazon root
  (§5.5). CloudFront gives all three for certain. CALLS-PLAN §5.2
  proposed an API Gateway custom domain; whether that meets the
  enclave's TLS 1.3 and HTTP/2 requirement was not established, so it
  is not relied on. **The first implementation step is a handshake from
  a development enclave against the deployed name** (§13);
- it costs nothing while idle and needs no load balancer (about $16 a
  month, as much as the server);
- it is **a stated exception** to the repository's convention that
  functions are Node through `ApiFunction` (RUNBOOK "CDK conventions"):
  the attestation verifier exists in Go and is security-critical, and a
  second implementation in TypeScript would be the larger risk. The
  function's archive is built reproducibly in `vettid-calls` and pinned
  by SHA-256 in `cdk.json`, as images are pinned by digest.

**Context** (`cdk.json`): `callsStages`; `stagingCallsTurnImage` (the
coturn image by digest); `stagingCallsIssuer` (the issuer's archive: a
release URL and its SHA-256). Until each value is committed it must be
on every staging deploy command (RUNBOOK "Push gateway" says why).

**Vault side** (VAULT-RELEASES §5.2, §8.4): the release constant
`calls_url`; the parent's allowlist; `callsHost` beside `pushHost` in
`lib/config.ts` and `lib/vault/egress.ts`. A host stack deploy and a
vault release.

### 8.3 The secret

One secret, `vettid-org/staging/calls/turn-secret`, in Secrets Manager
under `alias/vettid-org-calls`:

```
{ "current": "<id>", "secrets": { "<id>": "<base64 of 32 random bytes>", … } }
```

- **No stack creates it; the operator does** (the lesson of
  vettid.org #216, PUSH-GATEWAY §10.2): the owner's administrator role
  creates it with its value and is the only principal with
  `kms:GenerateDataKey` under the key. The issuer's role and the
  instance's role may `kms:Decrypt` through Secrets Manager for this
  secret only. A secret is never deleted and created again.
- `callsctl secret new | rotate | drop <id> | list` prepares the value;
  its output goes straight into Secrets Manager.
- The issuer signs with `current`. The server accepts every secret
  listed. **Rotation, monthly:** `rotate` adds a secret and makes it
  current; after a day (longer than a credential's 6 hours) `drop`
  removes the old one. Whether the pinned coturn accepts more than one
  secret at a time, and takes a change without a restart, is to be
  confirmed when the image is built (§13); a restart ends the calls
  being relayed, which staging can accept.
- The issuer reads the secret when it starts and again every 10
  minutes. `turn-agent` does the same for the server.

### 8.4 Cost (estimate, us-east-1 list prices; not a measurement)

| | USD a month |
|---|---|
| `t4g.small`, always on | 12.3 |
| One public IPv4 address | 3.7 |
| Key, secret | 1.4 |
| Alarms (about 8) and custom metrics (about 8) | 3.2 |
| Disk, logs, the issuer, CloudFront, DNS records | under 1 |
| **Idle total** | **about 21** |
| Relayed voice (about 60–90 kbit/s each way, both directions leave the server: 55–80 MB an hour, at $0.09/GB after the account's first 100 GB) | under 0.01 per call hour |

CALLS-PLAN §5.4 estimated 18; the difference is the alarms, the metrics
and the key. A `t4g.micro` would save about 6 and would carry staging;
D3 says a small instance, and the difference is not worth a second
decision. The ceiling stays **$30 a month** (D8), held by a budget on
this service's cost tag with an alarm, and by the daily stop of §7.3.
The share of calls that need TURN is not known (general experience: one
in five to ten on mobile networks) and is measured in C5.

## 9. What each party sees and can do

After C2, for a call between members A and B.

| Party | Sees | Can do | Cannot |
|---|---|---|---|
| **The TURN server and its operator (VettID)**, relayed call | The public address of each phone that uses it, the address it relays to (the other phone, or the other phone's relay address), the times, and the size and timing of every packet. With both sides relayed: both phones' addresses and that they are in one call | Drop, delay or refuse media; stop the service | Read or change media (frame encryption under `k_call`, inside DTLS-SRTP); learn who the members are from the service's own data: a username is random |
| The same, direct call | For STUN: the phone's public address and the time of each binding request. Not the peer's address | Refuse to answer | Know whether a call followed, or with whom |
| **The issuer and its operator (VettID)** | For each request: the vault host's address (shared by every vault on the host), the release (PCR0) and the enclave's module id, the time. It makes the usernames | Refuse credentials; issue credentials to itself | Know which vault asked (a fresh key per request); know when calls happen (a vault fetches at unlock and to refill, not per call) |
| **VettID as the operator of everything** | Could, with request logs of the issuer, session logs of the server and the hosts' records together, link a username to a vault host and, by timing, guess the vault. On staging one host carries a handful of vaults, so there the guess is easy | | Not from what is kept: the issuer keeps no request log and the server no session log (§10) |
| **The vault host (the parent)** | That the enclave opened a connection to the issuer's name, when, and the sizes of the ciphertext (VAULT-HOST-PROTOCOL §11.2). With one vault unlocked on the host, that is that vault's | Refuse or cut the connection: the vault then gives STUN only | Read the credentials (TLS ends in the enclave); learn anything about a call from this that it does not already see from the relay traffic and the vault's state writes |
| **The relay** | Nothing of this service. Of a call: the bursts of deposits (CALLS-PLAN §3), and from C2 one small deposit every 30 s from the device in a call to its vault (the keep-alive of VAULT-MESSAGING §10.10), which shows how long a call lasts | Delay or drop signalling | Read it |
| **The other member's vault** | The signalling: SDP and candidates, hence both members' addresses during setup (accepted, D1) and whether a relay candidate was offered | Change the unsigned SDP so that a call fails; it cannot make media play that is not encrypted under the call's keys (VAULT-MESSAGING §10.10) | Learn `k_call`; get the other side's TURN credential (each vault gives credentials to its own devices only) |
| **The other member** | Direct call: the member's public address and local addresses. Relayed on this member's side: the TURN server's address instead | | |
| **A network observer** | That a phone exchanges UDP with the TURN server or with another address, and how much | Block it: the call fails, or falls back to TCP 3478 (and in C5 to TLS on 443) | Read or change media |

## 10. Observability, logging and retention

**Counters only** (D19; CALLS-PLAN §5.3). Nothing that names an
address, a username or a single request is kept anywhere.

- **The server.** coturn's own log, which has a line per session with
  the client's address and username, is **discarded on the instance**
  (the container runs with no log driver) and never shipped. `turn-agent`
  reads coturn's counters on the loopback interface and emits, once a
  minute, in namespace `vettid-org/<stage>/calls`: `allocations`
  (current), `allocations_refused{reason}` (`quota_user`, `quota_total`,
  `capacity`), `auth_failures`, `bytes_relayed`, `stun_bindings`, and a
  heartbeat. No dimension holds an address or a username.
- **No VPC flow logs** on this network: they would be a record of which
  address used the relay when, that is, of who called when.
- **The issuer.** Metrics `requests{outcome}`,
  `attestation_failures{reason}`, `manifest_refresh{outcome}`,
  `internal_errors`; every value from a closed set. Logs: starts and
  errors only, 14 days, at most one line a minute per kind, never a
  key, an attestation document, a username or a source address.
  CloudFront's access log stays off for this name.
- **Retention:** metrics as CloudWatch keeps them; the two log groups
  14 days. There is nothing else to retain.
- **During an incident** the operator may keep coturn's log on the
  instance for at most 24 hours to find an abuser. That is a manual
  step, written in the runbook, and the log is deleted when it ends.

**Alarms** (to `vettid-org-calls-alerts`, mail to the admin address):

| Alarm | Fires when |
|---|---|
| `no-turn-heartbeat` | no heartbeat from the server for 5 minutes (and on recovery) |
| `relay-volume-day` | more than 5 GB sent in a day |
| `relay-stopped` | the daily stop of §7.3 acted |
| `relay-capacity` | allocations at 80 % of the total, or any refusal for `quota_total` or `capacity`, for 10 minutes |
| `turn-auth-failures` | more than a baseline in an hour; a public TURN server is probed constantly, so the baseline is set from the first week's numbers |
| `issuer-errors` | any `internal`; more than 25 refused attestations in an hour |
| `issuer-manifest` | manifest refresh failing for an hour |
| the cost budget | this service's tagged cost forecast above $30 for the month |

## 11. Runbook outline

To be written into RUNBOOK as a section "Calling service" with the
stacks' pull request (not in this one). Its parts:

1. **What is where:** the two stacks, the names, the context values,
   the secret, the log groups, the alarm topic.
2. **First deployment:** the data stack; the operator creates the secret
   (`callsctl secret new`); the service stack with the image and the
   issuer's archive; the DNS records; then the host stack (the DNS
   Firewall entry); then the vault release with `calls_url`.
3. **Checks after a deployment:** a STUN binding request from outside;
   an allocation with a credential made by `callsctl` (a test mode that
   signs with the secret, for the operator only); `GET /v1/health`; a
   request without an attestation is `403`; the handshake from an
   enclave (§13).
4. **Rotating the secret** (§8.3), monthly, and at once after any
   suspicion.
5. **Replacing the instance:** what members notice (relayed calls drop);
   the addresses stay.
6. **After the daily stop:** read the metrics, decide, set the group
   back to one.
7. **An abuse incident:** the 24-hour log (§10), rotating the secret,
   lowering the caps.
8. **Changing a cap or the server's name:** the caps are in the image's
   configuration; the URLs are in the issuer's configuration, so moving
   the server needs no vault release.
9. **Alarms:** what each means and what to do.

## 12. Not in C2

- TURN over TLS on 443 (C5), and with it the certificate on the
  instance.
- "Always relay calls" (deferred by the owner, CALLS-PLAN §3.1; V9).
- Video's bandwidth cap and anything else of video (C4).
- A per-address limit in front of the issuer (before production).
- A production calling service; a second server or region; a managed
  overflow provider (0.1.1's Cloudflare profile); an appliance profile.
  The artifacts are published so that a self-hoster can run them, and
  nothing more is promised for self-hosting in C2.
- The push wake for a ringing call (V4) is not this service's: it is a
  vault rule, and it rides in C2's vault release (D24) once its
  VAULT-MESSAGING §14.2 text is written and approved.
- Any measurement of how often TURN is needed (C5).

## 13. Not established, and how C2 finds out

| Question | How |
|---|---|
| That the enclave's egress (TLS 1.3, HTTP/2, Amazon roots) completes a handshake with the issuer's front | The first step of the stacks' work: a development enclave against the deployed name. If it fails, the issuer moves behind a load balancer |
| Whether coturn ends an allocation when its credential expires during a call | A test with a credential of a few minutes and a relayed call that outlasts it |
| Whether the pinned coturn accepts several secrets and a change without a restart; the exact option names of §7.2 | Reading the pinned version's source and a test when the image is built |
| Whether a call relayed on both sides through this one server connects (CALLS-PLAN §10 risk 6) | C5's test; C2 only keeps the configuration from ruling it out (§7.2) |
| IPv6 on the test phones' mobile network | The exit test records which address family each call used |
| The load of an attestation per request on the enclave's supervisor at production scale | Measured on staging with the capacity test's vault count before promotion |
| The share of calls that need TURN | C5 |

## 14. References

- RFC 8656 (TURN), RFC 8489 (STUN), RFC 8445 (ICE)
- coturn, `use-auth-secret` (the TURN REST credential form)
- PUSH-GATEWAY.md §5.1 (attestation), §10 (deployment)
- VAULT-MESSAGING.md §10.10 (signalling, media suites and keys, the
  signed ICE configuration)
- PQC-MIGRATION.md §5.1 (hybrid KEM), §5.2 (hybrid signatures)
