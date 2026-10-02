---
title: VAULT-PLAN
status: draft
version: 0.1.0
date: 2026-10-02
owner: Al Liebl (Mesmer)
related:
  - VAULT-MESSAGING.md (0.3.1) — the wire and behaviour spec this plan implements
  - RELAY-PROTOCOL.md (0.4.0), RELAY-PLAN.md
  - PQC-MIGRATION.md (0.3.0)
  - MEMBER-API.md, RUNBOOK.md
classification: public (no secrets; safe for github.com/vettid)
---

# Vault plan (V1)

How we build the VettID vault described by VAULT-MESSAGING 0.2: where the
code lives, what we reuse from vettid.dev, the order of work, how it's tested
without Nitro hardware, and the infrastructure it lands on. The spec says
*what*; this says *how and in what order*.

## 1. Starting point

- **vettid.dev enclave** (`vettid-dev/enclave`, Go): supervisor 6.4k lines,
  vault-manager 61k (8k tests), parent 8.9k, migration 2.9k. It builds with Go
  1.26. Its transport (NATS), session crypto (static X25519, Lambda-minted
  binding token), routing (NATS KV) and parent role (parses envelopes, holds
  NATS seeds) are all replaced by the spec. Its feature logic — credentials,
  secrets, profile, messaging, calls, devices, agents, LEASH, grants, location,
  wallet, actions — is what we want to keep.
- **No data to migrate.** The vettid.dev KMS keys are gone and members start
  fresh, so wire formats, PCRs and architecture are all free to change.
- **Relay** 0.3.0 is live at relay.vettid.org with a Go client
  (`vettid-relay/internal/client`) and an in-tree PASETO v4.public.
- **Member API** conventions (route groups, cookies, CSRF, origin verify) are
  in place in this repo.

## 2. Approach: new core, ported features

The spec changes everything *around* the feature handlers: envelopes,
sessions, keys, the sealed header, alternate-channel enroll/unlock, leases,
collect, dedupe and ack-after-persist. The earlier analysis proposed pruning
vettid.dev in place and synthesizing legacy NATS subjects in an Ingress shim.
With the spec now settled, that shim would preserve exactly the coupling the
spec removes (subject routing, payload-shape classification, §13.6).

**Plan:** write the core fresh in a new repo against the spec, and port
feature handlers into it one area at a time behind a small handler interface.

| Layer | Source | Notes |
|---|---|---|
| Crypto: suites, HPKE, envelope v2, handshake, epochs | **new** | Go 1.26 `crypto/hpke` (MLKEM768X25519), `crypto/mlkem`, `crypto/ecdh`, `crypto/hkdf`. Test vectors are the deliverable (§16 of the spec). |
| Relay client | **move** `vettid-relay/internal/client` → public `vettid-relay/relayclient` | One implementation for vault, agent and test driver. Needs a pluggable dialer (vsock to the parent). |
| Vault runtime: state store, sealed header, dedupe, outbox, token registry, collect loop, leases | **new** | `state_seq`/`header_seq`, conditional writes, split-brain lock. |
| Supervisor: NSM attestation, KMS sealing via parent, process-per-vault, IPC, memory manager | **port + trim** | Drop the baked vsock secret, the seed/vote/invite/leash proxies and the RSA PKCS#1 v1.5 fallback. Dev mode becomes a build tag. |
| Parent | **rewrite small** (~1.5k) | vsock mux, SQS consumer, TCP forwarder to an allowlist (relay, KMS, Google), S3 conditional get/put, instance-role credentials for the enclave's own KMS calls, lease writes, health. No parsing. |
| Feature handlers | **port** from vault-manager | Re-homed behind `Handler(ctx, Session, Inner) (Inner, error)`; their storage and logic move mostly unchanged, the publish calls change. |
| Removed | — | NATS creds/proxy, service/B2C, combined datastore, votes, org vault, WASM handler registry, `unseal`/`sign` stubs, legacy aliases. |

Estimated size: core 8–10k lines new, feature port ~25–30k carried over,
parent ~1.5k. Roughly half of vettid.dev's vault-manager does not come over.

## 3. Repositories

- **vettid/vettid-vault** (new, public, AGPL-3.0 like the relay): supervisor,
  vault, parent, crypto packages, `vaultctl` test driver, EIF build. CI: vet,
  staticcheck, race tests, fuzz smoke, gitleaks, reproducible EIF build on an
  arm64 runner; publishes the EIF and PCRs per release.
- **vettid/vettid-relay**: gains the public `relayclient` package.
- **vettid/vettid.org** (this repo): member API `vault` route group, tables,
  VaultStack and NitroStack, PCR manifest publishing.
- **Apps** (vettid-android, vettid-ios) and **vettid-desktop / vettid-agent**:
  client work in V6.

## 4. Phases

Each phase ends with a merged PR and a stated exit test. V1–V4 need no AWS
and no Nitro hardware.

### V1 — Crypto and wire (library only)

- `suite`: suite 2 = HPKE(MLKEM768X25519, HKDF-SHA256, ChaCha20-Poly1305),
  XChaCha20-Poly1305 sessions via HPKE Export.
- `envelope`: v2 byte layout, padding buckets, inner plaintext, size limits
  and claim-check.
- `handshake`: 3-message handshake with SAS, key schedule, epochs (24 h /
  10k), rekey; reconnect tokens.
- Relay `relayclient` extraction (relay PR).
- **Exit:** spec §16 vectors generated and checked in (including
  MLKEM768X25519 interop vectors for CryptoKit and BouncyCastle), fuzz targets
  for every parser, 100% of spec MUSTs in §4–§6 covered by named tests.
  Spec follow-up 1 closed.

### V2 — Vault runtime in dev mode

- State store (DEK-encrypted state, sealed header with a dev sealer,
  `state_seq`/`header_seq`, conditional writes), outbox, dedupe and
  ack-after-persist, issued-token registry, collect loop (long-poll and
  WebSocket).
- Owner devices and connections: pairing (§6.7), invitations with open tokens
  and claims (§6.4), reconnects (§6.6), revocation (§7.4).
- First feature: 1:1 messaging (smallest end-to-end slice).
- `vaultctl`: a Go test client that acts as app, desktop, agent or peer
  vault.
- **Exit:** against a real `vettid-relay` binary in CI: pair an app, connect
  two vaults by remote invite, exchange messages, revoke, see a rejected
  deposit, kill and restart the vault process and see redelivery deduped, and
  the split-brain guard locking a second writer.

### V3 — Alternate channel and enclave shell

- Spec: release updates are specified in VAULT-MESSAGING 0.3.0 §11.10 (D1, §5.1).
- Enclave side: ETK and descriptors, enroll/unlock/lock (§11), backoff,
  client-anchored rollback, device attestation (§11.7: Android key
  attestation and App Attest, verified with test CAs in CI and pinned vendor
  roots in release builds), Google attestation revocation list fetch.
- Supervisor port: process-per-vault, NSM behind an interface (fake NSM with a
  test CA in CI), KMS sealing via the parent.
- Parent: vsock mux, per-instance SQS queue, instance registry heartbeat,
  leases, TCP forwarder with relay/KMS/Google allowlist, S3, and role
  credentials for the enclave's KMS calls (TLS ends in the enclave).
- Member API (this repo): `vault` route group (`/api/vault/enclave`, `enroll`,
  `unlock`, `lock`, `requests/{id}`, `status`), vault, instance-registry and
  request tables, rate limits per §11.8.
- **Exit:** docker-compose of relay + parent (TCP instead of vsock) +
  supervisor (dev build) + LocalStack (S3, SQS) + member API handlers invoked
  locally; `vaultctl` enrolls, unlocks, messages, locks, unlocks again, and
  is refused on a replayed unlock, a rolled-back state object and a bad
  attestation.

### V4 — Feature port

In dependency order, each as its own PR with the handler tests carried over:
credential and secrets → profile, settings, personal data → audit and feed →
connections polish (block, authenticate) → calls signalling → device and agent
sessions → LEASH → grants and critical secrets → shared actions → location →
wallet → presence ping. Spec follow-up 2 (per-feature body schemas) is
written alongside each port, in VAULT-MESSAGING §10.

**Exit per area:** its ops are in the §10 registry, their bodies specified,
and `vaultctl` scripts exercise them through the real relay.

### V5 — Infrastructure and first hardware run

- **VettidOrgVaultStack** (stateful, RETAIN, termination protection): vault
  data bucket, one KMS sealing key per active release (decrypt only under
  Nitro attestation with that release's PCR0, §5.1), KMS PCR-manifest signing
  key, SSM refs.
- **DataStack** additions: vaults, instance registry, requests tables.
- **VettidOrgNitroStack**: VPC with public subnets and no NAT, Graviton host
  ASG (min 0), IMDSv2 hop 1, no inbound, SSM-only access, alarms.
- EIF and AMI build (vettid-vault CI + script), PCR manifest published at
  `https://vettid.org/.well-known/vettid/pcr-manifest.json`, signed by the KMS
  key whose public key the apps pin.
- **Exit:** one real enrollment and unlock on hardware through
  relay.vettid.org, with `vaultctl` verifying attestation against the
  published manifest; a release update approved and the vault re-sealed to
  the new release; KMS decrypt refused for a debug-mode enclave and for the
  new release before approval (negative tests).

### V6 — Clients

`vaultctl` and the Go agent first (shared code), then Android (relay
transport, enrollment, unlock, key attestation already exists in
`HardwareAttestationManager`), then iOS, then desktop (pairs; never unlocks).
**Exit:** each client passes a scripted run against the staging vault.

### Later

Push gateway wakes (when APNs/FCM credentials exist), calling service (TURN,
SFrame), backup and recovery, PQC Phase 2 (ML-DSA, Go 1.27).

## 5. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **Sealing across releases: re-seal per release, approved by the member** (§5.1). The member keeps total control: no release can open a vault the member hasn't moved to it. | Decided 2026-10-02 |
| D2 | **Instance:** on-demand (no Spot). Graviton m7g.large proposed; ASG parked at 0 until the preview opens. | Decided 2026-10-02 |
| D3 | **Reproducible builds: required.** Pinned toolchain image, `-trimpath`, no secrets in the image, documented `make eif`; anyone can recompute PCR0 and compare it with the manifest. | Decided 2026-10-02 |
| D4 | **Process model:** one vault manager process per unlocked vault inside the enclave; it dispatches to feature event handlers. | Decided 2026-10-02 |
| D5 | **TLS terminates in the enclave**, over a few shared HTTP/2 connections per instance, with pinned roots for the allowlisted hosts (§5.2). | Decided 2026-10-02 |

### 5.1 D1: re-sealing per release

*Normative protocol: VAULT-MESSAGING §11.10 (manifest, sealing, approval,
the move, routing, app behaviour). This section keeps the decision and the
deployment consequences.*

Each release has its own KMS key whose policy allows `Decrypt` only under a
Nitro attestation with that release's PCR0. A vault's sealed header (and the
sealed secret its DEK derivation depends on) is encrypted under the key of
the release the member last approved. Nothing else can open it, including
any later release VettID ships.

**Moving a vault to a new release:**

1. VettID publishes release N+1: reproducible build, PCRs in the signed
   manifest, a new KMS key, and N+1 instances running alongside N.
2. At the member's next unlock, the app sees a newer release in the manifest
   and asks the member to approve it (release notes, PCR0). Nothing changes
   if they decline.
3. On approval, the unlock request (to the N instance holding the vault)
   carries the app's signature, by its attested device key, over
   `{vault_id, from: PCR0_N, to: PCR0_N+1}` (VAULT-MESSAGING §11.10.3, which
   also binds the request id, the target's release number and the manifest
   serial).
4. After a successful PIN unlock, the N enclave checks the approval and that
   `PCR0_N+1` is in the signed manifest, then writes a header sealed under
   N+1's key (create-only, new `header_seq`) and records `sealed_release`.
   It locks the vault; the next unlock routes to an N+1 instance.

**Consequences:**

- **Several releases run at once.** The instance registry records each
  instance's release; `GET /api/vault/enclave` routes a vault to an instance
  of its `sealed_release`. A release with no running instance is started on
  demand (slow first unlock) rather than deleted: its EIF and KMS key are
  kept for as long as any vault is sealed to it.
- **VettID cannot force security fixes.** The app can urge an update, but a
  vault stays on its release until the member approves. The spec will say so
  in its threat model.
- **No migration machinery** like vettid.dev's (signed migration configs,
  per-user S3 locks, 72-hour deadlines): the move is one sealed write inside
  a normal unlock.
- **Spec:** done in VAULT-MESSAGING 0.3.0 §11.10. Moves are forward-only
  (a fix for a bad release ships as a newer release), and a pending move
  recorded in vault state is completed at the next unlock if the header
  write is interrupted.
- **CDK: one KMS key per release**, rendered from the manifest, with RETAIN.
  The enclave refuses to seal to a key that does not match this shape
  exactly (VAULT-MESSAGING §11.10.7), so this is the only shape to deploy:
  - symmetric (`SYMMETRIC_DEFAULT`, `ENCRYPT_DECRYPT`), origin `AWS_KMS`,
    single-region, in the pinned account and region, no grants;
  - key policy with exactly three `Allow` statements and nothing else:
    1. `kms:Decrypt`, condition `StringEqualsIgnoreCase`
       `kms:RecipientAttestation:ImageSha384` = the release's PCR0 and
       `StringEquals` `kms:CallerAccount` = the account;
    2. `kms:GenerateDataKey`, same conditions with the PCR0s of the release
       and the releases admitted to move vaults into it;
    3. `kms:DescribeKey`, `kms:GetKeyPolicy`, `kms:ListGrants`, no
       condition;

    all with `Principal` = `{"AWS": "<enclave host role ARN in the
    account>"}` (never `"*"` or another account: anyone can run a public
    release image and present its attestation elsewhere) and
    `Resource` = `"*"`.
    The example in VAULT-MESSAGING §11.10.7 is normative.
  - **No administrator statement**: no `kms:*`, no account-root
    delegation, no `PutKeyPolicy`, `CreateGrant`, `Encrypt`, `ReEncrypt*`,
    `ScheduleKeyDeletion`, `DisableKey` or tagging. KMS's lockout safety
    check refuses such a policy, so the key is created with
    `CreateKey(..., BypassPolicyLockoutSafetyCheck: true)` (in CDK, a custom
    resource; `aws-kms.Key` cannot express it). The policy can never be
    changed, the key never disabled or deleted, even by the account root:
    budget for keeping every release key indefinitely.
  - vettid.dev differed here: its host role and a migration function held
    `kms:PutKeyPolicy` and widened policies during migrations, and nothing
    in the enclave checked. That is what the enclave-side check rules out.
- **Manifest signing key:** a KMS ECC_NIST_P256 key, sign-only, in a
  separate account with multi-party approval; apps and release images pin
  its public key.
- **Release registry (member API):** operations render each release's
  manifest status and availability into the `vettid-org-vault-releases`
  table, which the API uses for routing, `410 release_unavailable` and
  enrollment into an `active` release (VAULT-MESSAGING §11.10.5). The API
  only records on-demand start requests (`start_requested_at`) there; a
  scaler (for example a stream- or schedule-triggered function that scales
  the host ASG) acts on them in V5.
- **Control queues:** `vettid-org-vault-control-<instance_id>`, created and
  deleted by the parent; the API's `sqs:SendMessage` is limited to that
  prefix in its own account and region. Instances heartbeat the registry at
  least every 30 s; the API treats an instance as live within 90 s.
- **Account cancellation:** the account lifecycle blocks vault routes
  (except lock) at cancellation, and after the 7-day grace deletes the
  member's vault rows and the stored state and headers (all
  `vaults/<vault_id>/` objects) — an operator power the host already has
  (VAULT-MESSAGING §13.5).
- **Allowlist:** the parent's TCP allowlist gains
  `kms.<region>.amazonaws.com:443`; the enclave terminates TLS to it and
  signs its own SigV4 requests with role credentials the parent supplies
  (§5.2).

### 5.2 D5: where TLS to the relay terminates

The question is whether the enclave runs TLS itself (the parent forwards
only TCP bytes) or hands plain HTTP requests to the parent, which performs
HTTPS (vettid.dev's model). Either way relay requests are signed in the
enclave and payloads are end-to-end encrypted.

**What the host sees in each case:**

| | TLS in the enclave | TLS in the parent |
|---|---|---|
| Content | Nothing | Nothing (end-to-end encrypted) |
| Request metadata | Byte counts and timing per TCP connection | Full requests: method, path, the vault's mailbox id, every **peer mailbox id** it deposits to, signer keys, tokens, timing |
| Social graph | Not directly. Timing correlation is possible with relay logs (VettID runs both; spec §2.2). | **Directly**: each vault's contacts, and how often it messages each |
| Bearer secrets | Not exposed | **Exposed**: one-shot open tokens and claim ids (§5.6, §6.9 of the relay spec). A host could consume an invitation's token or claim before the real recipient. SAS and hash commitments stop impersonation, but not that denial of service. |
| Forgery or replay | No: requests are signed and replays rejected | No (same) |
| Drop, delay | Yes | Yes |

**Costs of TLS in the enclave:**

- **Trusted code base.** Go's `crypto/tls` is already linked into the
  binary (stdlib); the additions are a dialer over vsock and a root store.
- **Root updates force releases.** Under D1 every release needs each member's
  approval, so the root store must change rarely. Pinning only the roots we
  need does that: Amazon Root CA 1 for relay.vettid.org (ACM; valid to 2038)
  and for the regional KMS endpoint (Amazon Trust Services; the exact chain,
  including any Starfield cross-sign, is confirmed in V3), and Google Trust
  Services roots for the attestation revocation list (valid
  to 2036), with backups, rather than a full CA bundle.
- **Clock.** Certificate validation needs time. The enclave clock comes from
  the Nitro hypervisor, not the parent; validate with a margin, as the
  relay's timestamp checks already require a correct clock.
- **Connection pooling.** A TLS connection per vault tells the host which
  vault is talking, even without content. Instead, the enclave keeps a few
  shared HTTP/2 connections per instance that carry every vault's requests,
  so per-vault timing is blurred.
- **Debuggability.** The parent can't log relay errors; the enclave reports
  them in its own sanitized logs.

**Alternatives considered:**

- *Relay-layer encryption* (HPKE to a relay key instead of TLS): custom
  protocol and relay changes for what TLS already provides. Rejected.
- *Parent TLS with padding or batching*: hides nothing structural; paths and
  tokens are still in clear to the host. Rejected.

**Decision:** terminate TLS in the enclave, over a small pool of shared
HTTP/2 connections per instance, with pinned roots for exactly the hosts in
the parent's allowlist. It keeps the host from learning the social graph and
from seeing bearer secrets, at the cost of a few hundred lines and a root
store that changes about once a decade. If the pinned roots must change, that
is a normal release under D1.

## 6. Testing without hardware

- Dev builds use a `devenclave` build tag: fake NSM with a test CA, a dev
  sealer, TCP instead of vsock. Release builds cannot compile these in.
- Real relay binary in CI; LocalStack for S3/SQS (KMS attestation conditions
  are covered by CDK assertion tests instead).
- Spec vectors, fuzzing on every parser, race tests.
- Hardware only in V5, for vsock framing, NSM, KMS policy and sizing.

## 7. Risks

1. **Feature port volume.** ~25–30k lines with uneven tests. Mitigation: port
   area by area with `vaultctl` scripts, not in bulk.
2. **Locked-vault UX.** Locked vaults don't collect, and there are no push
   wakes yet, so mobile delivery depends on the app being open. Acceptable for
   the preview.
3. **Members who never approve updates** keep old releases alive (on-demand
   instances, retained KMS keys) and stay on old code, including unfixed
   vulnerabilities. That is the cost of D1; the app makes it visible.
4. **Single instance** is an availability single point of failure (ASG heals
   in ~5–10 min; vaults relock). Leases already allow a second instance.
5. **Client effort** across Kotlin, Swift, Rust and Go. Mitigation: a small
   spec with vectors, and `vaultctl` as the reference client.
6. **iOS App Attest inside the enclave** needs Apple's root pinned and CBOR/
   COSE parsing in the TCB; budgeted in V3.
