---
title: VAULT-PLAN
status: draft
version: 0.1.4
date: 2026-10-08
changelog:
  - 0.1.4: owner decisions of 2026-10-08 (VAULT-MESSAGING 0.22.0 §15
    item 30): History export of activity metadata is the one exception
    to "no backup or export of vault data" (§4 Later)
  - 0.1.3: W0 of VAULT-RELEASES: §5.1 and §7 risk 3 follow D1a
    (retirement after notice, deletable release keys by scheduled
    deletion only, the retirement statements, manifest by hash), as
    specified in VAULT-MESSAGING 0.10.0
  - 0.1.2: V5 moves to VAULT-RELEASES.md (owner decisions of 2026-10-04
    amending D1: production-only locked keys, cadence, move-only
    deprecated releases, retirement with key deletion)
  - 0.1.1: notes ported from the vettid.dev archive review and the owner
    decisions of 2026-10-03: wallet spend caps (V4), DR objectives and a
    RUNBOOK vault section (V5), no backup or export of vault data and
    vault-to-vault transfer as a future item (Later), follow-ups (§8)
owner: Al Liebl (Mesmer)
related:
  - VAULT-MESSAGING.md (0.10.0) — the wire and behaviour spec this plan implements
  - RELAY-PROTOCOL.md (0.4.0), RELAY-PLAN.md
  - PQC-MIGRATION.md (0.3.0)
  - MEMBER-API.md, RUNBOOK.md
  - VAULT-RELEASES.md (0.1.0) — the V5 plan
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
- Supervisor port: one process per vault (D4, §5.3), NSM behind an interface (fake NSM with a
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
sessions → LEASH → grants and critical secrets → shared actions → items (one
item model with tags and share rules, replacing profile fields, secrets and
critical secrets; VAULT-ITEMS, VAULT-MESSAGING 0.7.0) → location → wallet →
presence ping. Spec follow-up 2 (per-feature body schemas) is
written alongside each port, in VAULT-MESSAGING §10.

**Exit per area:** its ops are in the §10 registry, their bodies specified,
and `vaultctl` scripts exercise them through the real relay.

**Wallet note (for the wallet batch).** The original design let members set
per-operation policies on critical keys; the spend part is a requirement
here: member-set **spend caps** per transaction and per period (per day,
per week), enforced by the vault before it signs, with raising a cap a
credential operation (password, CEK rotation) and every refusal audited.
Caps apply to every caller, including connections' critical-item uses and
any future agent path. (vettid-dev `protean_credential_system_design.md`,
"Policy-Based Authorization"; PROTEAN-CREDENTIAL §5.)

### V5 — Releases, infrastructure and first deployment

Planned in **VAULT-RELEASES.md** (0.1.0), which replaces the bullets that
stood here and builds on the owner decisions of 2026-10-04 that amend D1
(R1–R4 there): locked keys for production releases only, a release
cadence, move-only deprecated releases, and retirement with key deletion
after a notice window. In short:

- spec changes before release 1: §11.10.7 allows scheduled deletion (and
  its cancellation) of a release key by one pinned principal; the
  manifest no longer travels inside the unlock request; a `removed`
  status and an `ends_at` date;
- reproducible EIF builds in CI with provenance, release constants in
  committed per-channel files, staging and production channels;
- `VettidOrgVaultStack` (data bucket, host and retirement roles, release
  keys), `VettidOrgVaultHostStack` (network, egress controls, scaler,
  manifest sync, alarms) and one stack per live release (AMI, ASG);
- the member API vault routes deployed dark first; the release, hotfix
  and retirement processes; staging, hardware smoke, compatibility and DR
  testing; the first production deployment and its owner decisions.

**Exit:** as before, one real enrollment and unlock on hardware with
`vaultctl` verifying attestation against the published (staging)
manifest; a release update approved and the vault re-sealed; KMS decrypt
refused for a debug-mode enclave and for the new release before approval;
plus a retirement drill (schedule, cancel, delete) in staging.

### V6 — Clients

`vaultctl` and the Go agent first (shared code), then Android (relay
transport, enrollment, unlock, key attestation already exists in
`HardwareAttestationManager`), then iOS, then desktop (pairs; never unlocks).
**Exit:** each client passes a scripted run against the staging vault.

### Later

Push gateway wakes on both paths (FCM/APNs when credentials exist, and
UnifiedPush for phones without Google services; PUSH-GATEWAY 0.2.0),
calling service (TURN, SFrame), PQC Phase 2 (ML-DSA, Go 1.27).

- **No backup or export of vault data outside the service** (owner
  decision, 2026-10-03). Recovery after losing the app is specified
  (VAULT-MESSAGING §11.11). The one exception (owner decisions of
  2026-10-08): the member's History export, activity metadata only
  (the audit entries, never values, secrets, messages, credential
  material or the email), from the app with the vault PIN, as CSV or
  JSON (VAULT-MESSAGING 0.22.0 §10.9). It is no backup.
- **Vault-to-vault transfer** (future): a member moves their data from an
  old vault to a new one within the service.
- **Self-hosted vaults / home appliance**: a future direction only
  (ARCHITECTURE §8).

## 5. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **Sealing across releases: re-seal per release, approved by the member** (§5.1). The member keeps total control: no release can open a vault the member hasn't moved to it. | Decided 2026-10-02 |
| D2 | **Instance:** on-demand (no Spot). Graviton m7g.large proposed; ASG parked at 0 until the preview opens. | Decided 2026-10-02 |
| D3 | **Reproducible builds: required.** Pinned toolchain image, `-trimpath`, no secrets in the image, documented `make eif`; anyone can recompute PCR0 and compare it with the manifest. | Decided 2026-10-02 |
| D4 | **Process model:** one OS process per unlocked vault inside the enclave, holding all of that vault's secrets and running its feature handlers; the supervisor keeps only shared duties and no per-vault secrets (§5.3). | Decided 2026-10-02; isolation requirements of §5.3 added after the V3b review |
| D5 | **TLS terminates in the enclave**, over a few shared HTTP/2 connections per instance, with pinned roots for the allowlisted hosts (§5.2). | Decided 2026-10-02 |
| D1a | **D1 amended:** locked keys only for production releases; a release cadence; deprecated releases are move-only; releases retire after a notice window (12 months to start) and their keys are then deleted. Confidentiality is unchanged; members who never move lose access. Details and the §11.10.7 change: VAULT-RELEASES §2–§4. | Decided 2026-10-04 |

### 5.1 D1: re-sealing per release

*Normative protocol: VAULT-MESSAGING §11.10 (manifest, sealing, approval,
the move, routing, app behaviour). This section keeps the decision and the
deployment consequences.*

*Amended 2026-10-04 (D1a, VAULT-RELEASES R1–R4): locked keys for
production releases only; release keys become deletable by scheduled
deletion only, by a pinned retirement role, after a release's notice
window (12 months from supersession, 90 days' final notice, a 30-day KMS
window). Specified in VAULT-MESSAGING 0.10.0 (§11.10.5, §11.10.7); the
text below follows it.*

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
  demand (slow first unlock). Its EIF and KMS key are kept until the
  release's end date (`ends_at`), at least 12 months after it was
  superseded (VAULT-RELEASES §3.5); then it is `removed` and its key is
  scheduled for deletion.
- **VettID cannot force security fixes.** The app can urge an update, but a
  vault stays on its release until the member approves (VAULT-MESSAGING
  §13.5). A vault never moved is lost when its release ends: availability,
  never confidentiality.
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
  - key policy with exactly these `Allow` statements and nothing else:
    1. `kms:Decrypt`, condition `StringEqualsIgnoreCase`
       `kms:RecipientAttestation:ImageSha384` = the release's PCR0 and
       `StringEquals` `kms:CallerAccount` = the account;
    2. `kms:GenerateDataKey`, same conditions with the PCR0s of the release
       and the releases admitted to move vaults into it;
    3. `kms:DescribeKey`, `kms:GetKeyPolicy`, `kms:ListGrants`, no
       condition (the host role and the retirement role);
    4. `kms:ScheduleKeyDeletion` for the retirement role only, with
       `NumericEquals` `kms:ScheduleKeyDeletionPendingWindowInDays` = the
       pinned window (30 in production, 7 in staging) and `StringEquals`
       `kms:CallerAccount`;
    5. `kms:CancelKeyDeletion` and `kms:EnableKey` for the retirement role
       only, with `StringEquals` `kms:CallerAccount`;

    statements 1–3 with `Principal` = `{"AWS": "<enclave host role ARN in
    the account>"}` (never `"*"` or another account: anyone can run a
    public release image and present its attestation elsewhere), 4 and 5
    with exactly the retirement role, and `Resource` = `"*"`.
    The example in VAULT-MESSAGING §11.10.7 is normative.
  - **No administrator statement**: no `kms:*`, no account-root
    delegation, no `PutKeyPolicy`, `CreateGrant`, `Encrypt`, `ReEncrypt*`,
    `DisableKey` or tagging, and no deletion except statement 4. KMS's
    lockout safety check refuses such a policy, so the key is created with
    `CreateKey(..., BypassPolicyLockoutSafetyCheck: true)` (in CDK, a custom
    resource; `aws-kms.Key` cannot express it). The policy can never be
    changed and the key never disabled, even by the account root; the key
    is deleted only by the retirement role, with the pinned window, at the
    release's end (VAULT-RELEASES §6.2). Both roles named in the policy
    must never be deleted (VAULT-RELEASES §6.3). Key cost levels off at
    about the window's worth of releases.
  - vettid.dev differed here: its host role and a migration function held
    `kms:PutKeyPolicy` and widened policies during migrations, and nothing
    in the enclave checked. That is what the enclave-side check rules out.
- **Manifest signing keys:** key A in KMS (ECC_NIST_P256, sign-only,
  owner-only signer role) and key B offline; apps and release images pin
  both (VAULT-RELEASES §6.1). Enroll and unlock requests carry the
  manifest's hash; the host supplies the document from the vault data
  bucket (`manifests/<sha256>.json`, VAULT-MESSAGING §11.5).
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
  and for the regional KMS endpoint (Amazon Trust Services), and Google
  Trust Services roots for the attestation revocation list (valid to 2036),
  with backups, rather than a full CA bundle. Confirmed 2026-10-02 (V3b):

  | Host | Chain verified against the pinned pool | ALPN |
  |---|---|---|
  | relay.vettid.org | leaf → Amazon RSA 2048 M01 → Amazon Root CA 1 | h2 |
  | kms.us-east-1 / eu-west-1.amazonaws.com | leaf → Amazon RSA 2048 M04 → Amazon Root CA 1 | HTTP/1.1 only |
  | android.googleapis.com | leaf → WR2 → GTS Root R1 | h2 |

  Both Amazon hosts also send Amazon Root CA 1 cross-signed by Starfield
  Services Root CA – G2, and Google sends GTS Root R1 cross-signed by
  GlobalSign Root CA; neither cross-certificate is needed and neither
  Starfield nor GlobalSign is pinned. Pinned: Amazon Root CA 1–4 (2–4
  cover the other key types ACM issues under) and GTS Root R1, R3, R4.
  KMS offers no HTTP/2, so KMS calls use a small HTTP/1.1 keep-alive pool.
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

### 5.3 D4: one process per vault

The owner's requirement is that no flaw in one vault's code can leak
another vault's secrets, and that locking a vault leaves none of its
secrets behind in memory. Inside the enclave:

- **Supervisor** (PID 1): the NSM broker, the ETKs and the outer
  decryption and routing of alternate-channel requests, the egress (TLS
  and the shared HTTP/2 pool, D5), the parent link, and the vault
  processes' lifecycle. It holds **no per-vault long-term secret**: no DEK,
  pepper, relay key, identity or KEM key, session key, or plaintext vault
  state.
- **One OS process per unlocked vault**, started on enroll or unlock (a
  re-executed mode of the enclave binary, so no second measured image) and
  exiting on lock, which frees all of its memory. All feature handlers run
  in it.
- **Secrets reach the vault process directly.** After the supervisor
  decrypts an alternate-channel request with the ETK, it hands the
  decrypted request to the vault process over the channel and zeroizes its
  copy at once; as the ETK holder it sees the PIN transiently (it is the
  shared trusted base, as in vettid.dev). The sealed header and its pepper
  are unwrapped inside the vault process: the process generates its own
  ephemeral RSA key; the supervisor only obtains an NSM attestation
  document binding that public key and forwards the KMS call, so KMS's
  `CiphertextForRecipient` is readable only by that process. The
  §11.10.7 key-policy check runs in the vault process, which is the one
  that decides to seal.
- **Relay and storage:** requests are built and Ed25519-signed in the vault
  process (the relay key never leaves it); the supervisor carries them over
  the shared TLS/HTTP/2 pool and sees only signed requests with end-to-end
  encrypted payloads. State objects are DEK-encrypted in the vault process.
- **Channel:** one socketpair per vault process, a narrow, versioned,
  length-prefixed protocol, parsed strictly and fuzzed. The supervisor
  scopes everything it brokers to the process's vault: objects under
  `vaults/<vault_id>/` (plus the member index object, and read-only access
  to the member's previous vault at re-enrollment), relay requests to the
  allowlisted relay signed by the vault's own key, KMS calls, and
  attestation documents that bind only the process's Recipient key or the
  vault bundle hash, never arbitrary `user_data`.
- **Hardening per vault process:** its own UID/GID (allocated by the
  supervisor), `PR_SET_DUMPABLE=0` (the supervisor too), no ptrace, no
  inherited file descriptors but the channel, no shared writable files or
  directories, a minimal environment, rlimits (address space, open files,
  no core dumps), killed with its parent (`PDEATHSIG`). Seccomp is a
  follow-up.
- **Locks:** eviction (memory pressure, a vault cap), a lost lease or a lost
  parent → the supervisor tells the process to lock (flush, exit) and kills
  it if it does not exit in time; a process that detects a split brain
  zeroizes and exits without flushing.
- **Build rules (`make check-tcb`):** the vault and feature packages cannot
  import the supervisor's internals and vice versa, and use neither
  `unsafe` nor cgo.

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
3. **Members who never approve updates** stay on old code, including
   unfixed vulnerabilities, until their release ends (at least 12 months
   after it was superseded, with 90 days' notice and emails); then they
   lose access to their vault (D1a, VAULT-RELEASES §3.5, §14 risk 4). The
   app makes this visible; confidentiality is unaffected.
4. **Single instance** is an availability single point of failure (ASG heals
   in ~5–10 min; vaults relock). Leases already allow a second instance.
5. **Client effort** across Kotlin, Swift, Rust and Go. Mitigation: a small
   spec with vectors, and `vaultctl` as the reference client.
6. **iOS App Attest inside the enclave** needs Apple's root pinned and CBOR/
   COSE parsing in the TCB; budgeted in V3.

## 8. Follow-ups

From the vettid.dev archive review (2026-10-03):

1. **Retention of data received from connections.** Grant values are
   sealed to the fetching device (VAULT-MESSAGING §10.12), so the vault
   never holds them and cannot sweep them, as vettid.dev's in-enclave
   retention sweep did. Decide whether grants carry a retention hint that
   apps honour (delete cached values on expiry, revocation or removal),
   and specify it in §10.12.
2. **One app per vault, holding the credential** (owner decision,
   2026-10-03): a second or stale copy is refused, alerted and freezes
   credential operations until a forced rotation; direct transfer between
   phones; recovery replaces the old app. Specified in VAULT-MESSAGING
   0.9.0 (§3.5.9, §6.7.1, §11.11.5) and implemented in vettid-vault
   (branch `one-app`), with GrapheneOS attestation (§11.7).
