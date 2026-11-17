---
title: PQC-MIGRATION
status: draft
version: 0.4.0
date: 2026-11-17
owner: Al Liebl (Mesmer)
component: cross-cutting (vettid-agent, relay, vault manager, credential format)
related:
  - RELAY-PLAN.md
  - RELAY-PROTOCOL.md
  - PUSH-GATEWAY.md
  - CALLING-SERVICE.md
  - CALLS-PLAN.md
  - VAULT-MESSAGING.md
changelog:
  - 0.4.0: after NIST IR 8547 (final, October 2026): new §2.1 with the NIST
    timeline and a dated target (every VettID-controlled signing key trusted
    for longer than an online check is on a PQ or hybrid suite by
    2030-12-31); Phase 2 start is a proposed date, not a toolchain wait (an
    owner decision); AWS KMS already offers ML-DSA, so the real constraints
    are the verifiers, Rekor and hardware tokens (§10); §3 and §4 list the
    keys and channels known on 2026-11-17 (new keys must be added when
    introduced); row 5a corrected to the FrameCryptor (CALLS-PLAN D11);
    vault messaging (#1, #2) marked done; §9 and §10 updated
  - 0.3.1: §6.5 defers the QR and bundle format to VAULT-MESSAGING §6.4
  - 0.3.0: §5.1 names a standardized instantiation (HPKE with MLKEM768X25519,
    in the Go 1.26 standard library) as the preferred way to meet the hybrid
    KEM requirements
  - 0.2.0: calling media encryption added to Phase 2 (SFrame over hybrid KEM,
    closes the DTLS-SRTP gap); open question 3 resolved via QR claim-check
    (new section 6.5)
  - 0.1.0: initial draft
classification: public (no secrets; safe for github.com/vettid)
review-cycle: 6 months or upon NIST (incl. IR 8547 updates)/AWS/Go milestone, whichever first
---

# Post-Quantum Cryptography Migration Plan

## 1. Purpose

Define the target post-quantum cryptographic algorithm set for VettID, the
rationale for each selection, the hybrid constructions to be used during the
transition, and the explicit list of components that are deliberately deferred
or excluded — with reasons. This document is the authoritative reference for
all PQC-related implementation work.

Guiding constraint: **only well-vetted algorithms.** In practice this means
NIST FIPS 203/204/205 parameter sets, implemented via the Go standard library
where available, with hybrid (classical + PQ) constructions so that security
holds if *either* component survives. No research-stage schemes ship in
production paths.

## 2. Threat model and prioritization principle

Two distinct quantum threats drive different timelines:

1. **Harvest-Now-Decrypt-Later (HNDL).** Encrypted traffic or stored
   ciphertext captured today can be decrypted once a cryptographically
   relevant quantum computer (CRQC) exists. This applies to **key
   exchange / encryption paths only**. These migrate **first**.

2. **Signature forgery.** A signature only needs to remain unforgeable while
   the thing it authorizes is still trusted. Short-lived tokens carry no HNDL
   exposure; long-lived identity keys carry the most. Signature migration
   priority is therefore ordered by **key lifetime**, not uniformly urgent.

Symmetric cryptography (ChaCha20-Poly1305) and password hashing (Argon2id) at
256-bit strength are reduced at most to ~128-bit effective security by
Grover's algorithm and are considered post-quantum safe. **No changes.**
AES-128, which the call media frames use (CALLS-PLAN D11), is NIST Category 1
under NIST IR 8547 (approved primitives at 128-bit classical strength or more
meet at least Category 1) and is acceptable. It is the floor of a call and
its weakest part.

### 2.1 NIST timeline and VettID's alignment

NIST IR 8547 (final, October 2026) sets the timeline for leaving
quantum-vulnerable public-key algorithms:

- RSA, ECDSA, EdDSA, ECDH and finite-field DH/MQV are **deprecated after
  2030** and **disallowed after 2035**. The threshold is 112-bit strength
  or more; for EdDSA it is 128 bits or more (Table 2).
- NIST does not name Ed25519 or X25519. VettID's Ed25519 is EdDSA. X25519 is
  elliptic-curve DH, not an SP 800-56A scheme; it is treated the same here.
- ML-KEM is the only approved PQ key establishment. NIST recommends
  ML-KEM-768 as the default. HQC is selected and will be approved later.
- Approved PQ signatures: ML-DSA-44/65/87 (FIPS 204), SLH-DSA (FIPS 205),
  LMS/HSS and XMSS/XMSS^MT (SP 800-208).
- Hybrid key establishment is allowed: SP 800-56C composite `Z' = Z || T`
  is permitted even if one input is from a disallowed algorithm; `T || Z`
  is allowed once SP 800-56C is updated; the order is fixed by the
  protocol. It is FIPS-140-validatable if one input is approved. Combiner
  guidance is in SP 800-227.
- Dual or composite signatures are allowed if at least one component is
  NIST-approved and all components must verify. That supports §5.2's AND
  policy. Their security properties need careful analysis.
- Symmetric: 112-bit standards are disallowed in 2030.
- Key establishment goes first, as with HNDL above.

US federal high value assets and high impact systems (OMB M-26-15) must use
quantum-resistant key establishment by 2030-12-31 and signatures by
2031-12-31. That does not bind VettID. It is context for the dates below.

VettID aligns to NIST's timeline, not to FIPS approval. ChaCha20-Poly1305,
Argon2id, X25519 and the X-Wing combiner are not NIST-approved.

Plan statement (for the owner's approval):

- **Every VettID-controlled signing key whose signatures are trusted for
  longer than an online check (credentials, releases, manifests, recovery
  requests, the ballot site key, service and anchor keys) is on a PQ or
  hybrid suite by 2030-12-31.**
- Keys whose signatures are checked online and expire in minutes (#6-#8),
  and keys bound to platform hardware or to third-party formats without PQ
  support (marked "platform" or "external" in §4), are listed with their
  reason and re-confirmed at each review against 2030 and 2035.
- A deferral stands only if what the signature authorizes is short-lived and
  checked online.
- Phase 1 (key establishment) is done for vault messaging and calls (§9).
- Phase 2 (signatures) starts no later than 2027-06-30 and finishes by the
  date above. **The start date is an owner decision (proposed date).**
  What exists today, by platform:
  - Go: the repos pin Go 1.26 (toolchain 1.26.10 in vettid-vault; relay
    and push `go 1.26.0`; vettid-agent `go 1.24.0`). Go 1.26 has no
    `crypto/mldsa`. Release date of a Go with `crypto/mldsa`: to confirm.
  - AWS KMS: ML-DSA is available (key specs ML_DSA_44/65/87, signing
    algorithm ML_DSA_SHAKE_256, in aws-cdk-lib's `kms.KeySpec` and the AWS
    SDK). KMS has no SLH-DSA and no composite key; a hybrid is two KMS
    keys and two Sign calls.
  - Apple CryptoKit, BouncyCastle, Android platform: ML-DSA support to
    confirm.
- Phase 3 items are reviewed against the 2035 disallowance.
- External dependencies (Nitro, Sigstore/Rekor, WebPKI certificates, platform
  hardware) follow their own timelines and are tracked, not scheduled here.
- This is a list of the keys known on 2026-11-17. A new key must be added to
  §3 and §4 when it is introduced.

## 3. Current cryptographic inventory

| Primitive | Where used | Quantum exposure |
|---|---|---|
| X25519 alone (suite 1) | Retired: vault messaging suite 1 MUST NOT be sent or accepted (VAULT-MESSAGING §4.1) | None in use |
| HPKE(MLKEM768X25519, HKDF-SHA256, ChaCha20-Poly1305) | Vault messaging suite 2: every E2E key agreement, including relay payloads (VAULT-MESSAGING §1.1 item 7, §4) | Hybrid; HNDL addressed |
| Ed25519 | Protean Credential; relay keypairs; wake keypairs; mailbox proof-of-possession; PASETO v4.public deposit tokens | Forgery post-CRQC; risk scales with key lifetime |
| ChaCha20-Poly1305 | Payload and sealed-storage encryption | Safe (Grover only) |
| AES-128-GCM (FrameCryptor) | Call media frames, keyed from `k_call` | Safe (NIST Category 1) |
| Argon2id | Key derivation from user secrets | Safe |
| AWS Nitro attestation (LAT trust root) | Enclave PCR attestation | AWS-controlled; not migratable by VettID |
| Ed25519 (KMS, non-exportable) | Ballot (votes) site key; signs the service list (label ‖ SHA-256(list)) | Forgery post-CRQC; long-lived, identity-like |
| ECDSA P-256 (KMS) | Service-list anchor key; logs each list in Rekor (Sigstore hashedrekord) | Forgery post-CRQC; depends on Sigstore/Rekor |
| ECDSA P-256 (KMS `ECC_NIST_P256`, `lib/config.ts`) | Release manifest signing key A; manifests are verified by every app | Forgery post-CRQC; high value, long-lived |
| ECDSA P-256 (YubiKey PIV slot 9c, `lib/config.ts`) | Release manifest signing key B (offline standby) | Forgery post-CRQC; hardware token |
| Ed25519 (SSH signatures) | Release tags on vettid-vault | Forgery post-CRQC; long-lived |
| SSH ed25519-sk (YubiKey) | vettid-agent release signing (AGENT-PLAN A5.2) | Forgery post-CRQC; hardware token |
| ECDSA P-256 (KMS) | Recovery request key; signs `recovery` and `recovery_cancel`, pinned in releases (`lib/stacks/data-stack.ts`; VAULT-MESSAGING §11.14.8) | Forgery post-CRQC; long-lived |
| ECDSA P-256 (KMS) | service-vault per-service ballot anchor key (service-vault `cdk/lib/anchor-signer-stack.ts`; BALLOT-PROTOCOL §2, §3.3) | Forgery post-CRQC; depends on Rekor |
| Ed25519 | Service identity key (signs proposals, receipts, results); per-proposal voting key `vk` (BALLOT-PROTOCOL §5) | Permanent public records |
| Ed25519 | LEASH delegation and status signatures (LEASH README) | Forgery post-CRQC; follows `ik` |
| P-256 ECDH (WebCrypto) | Recovery code browser seal (VAULT-MESSAGING §11.11.2 "PQC exception"; `sites/account/js/recovery-keys.js`, `recovery-code.js`; vettid-vault `vms/altchan/recovery.go`) | Classical; documented exception (code expires in 48 h, single-use) |
| RSA-2048 RSAES-OAEP | KMS Recipient key transport to the enclave (vettid-vault `enclave/sealer.go`, `enclave/cms/cms.go`) | AWS-defined; carried inside the enclave's TLS 1.3 to KMS, which negotiates X25519MLKEM768 (`enclave/egress/egress.go` uses Go defaults) |
| P-256 ECDH (iPhone Secure Enclave) | Unlock secret and seed wrap (VAULT-MESSAGING §11.14.1 "On an iPhone") | Local only; Apple hardware timeline |
| P-256 (Android Keystore/StrongBox, Secure Enclave) | App key and Android device key (VAULT-MESSAGING §11.7, §11.12.2) | Hardware-bound; platform timeline |
| Android app signing certificate | Pinned by vault releases (`android_signers`) | APK Signature Scheme has no PQ; platform |
| TLS 1.3 key exchange; ECDSA/RSA certificates | VettID endpoints (CloudFront, push gateway, relay) | Servers support hybrid (apps' TLS to confirm). Certificates: WebPKI timeline |
| secp256k1 ECDSA/Schnorr | Wallet (bitcoin) | Outside NIST; follows the Bitcoin protocol |
| Short-lived or third-party (one group) | APNs ES256 and FCM RS256 provider JWTs (vettid-push); service-vault pinned P-256 TLS identity; Sigstore TSA and Rekor roots pinned in the vault; Cognito tokens; WebPKI leaves (RSA-2048 on all 8 hosts checked); Android key attestation and iOS App Attest roots (with Nitro) | External or minutes-lived; tracked |

## 4. Target algorithm map

| # | Component | Current | Target | Phase | Rationale |
|---|---|---|---|---|---|
| 1 | Relay E2E payload encryption | Hybrid (vault messaging suite 2) | **Hybrid X25519 + ML-KEM-768** | 1 (**done**) | The relay carries only opaque E2E payloads (RELAY-PROTOCOL). VAULT-MESSAGING §1.1 item 7 and §4.1: every E2E key agreement is hybrid; suite 1 MUST NOT be sent or accepted. ~1.2 KB ciphertext overhead is negligible against 8 MB claim-check blobs. |
| 2 | Vault session key agreement | Hybrid (suite 2) | **Hybrid X25519 + ML-KEM-768** | 1 (**done**: HPKE MLKEM768X25519, VAULT-MESSAGING §4) | Same HNDL logic; same construction (§5). |
| 3 | Protean Credential signing keys | Ed25519 | **Hybrid Ed25519 + ML-DSA-65** | 2 (by 2030-12-31) | Longest-lived, highest-value keys → lead the signature migration. Level 3 parameter set appropriate for an identity root. ~3.3 KB signatures live inside vault/enclave exchanges where size does not pinch. Rotation delivers the migration (§7). VAULT-MESSAGING suite 3 is reserved for it. |
| 4 | Selective disclosure layer | (implicit; full-credential presentation) | **Salted-hash attribute commitments** (SD-JWT pattern) | 2 | Hash-based → post-quantum by construction; well-vetted; algorithm-agnostic (works under Ed25519 or ML-DSA). See §6. |
| 5 | Release/update signing root (vettid-agent) | SSH ed25519-sk on a YubiKey (AGENT-PLAN A5.2; `release/allowed_signers`) | **SLH-DSA-128s** | 2 (by 2030-12-31) | Lattice-independent conservative root; hash-based assumptions only. Offline signing → 7.8 KB / ~274 ms cost irrelevant. The SSH signature format and the token must support it (to confirm). |
| 5a | 1:1 call media encryption | AES-128-GCM frame encryption by the media stack's FrameCryptor, keyed from `k_call`; DTLS-SRTP below | **No change to the frame cipher** | specified; on staging; production when calls ship | Not SFrame (CALLS-PLAN D11 replaced it; this row was stale). `k_call` is agreed between the two devices for each call with HPKE MLKEM768X25519 (VAULT-MESSAGING §10, §10.10); the vaults relay only the public `ek` and `enc` and never hold it. Media confidentiality is therefore PQ, bounded by AES-128 (Category 1, the floor and the weakest part of a call). The share signatures are Ed25519 and move with suite 3. DTLS-SRTP below is classical and not relied upon. TURN providers are untrusted regardless of vendor. |
| 6 | Relay keypairs + PASETO deposit tokens | Ed25519 (PASETO v4.public) | Deferred → ML-DSA-44 wrapper | 3 | Short-lived, verified online → zero HNDL exposure. No PQ PASETO version exists; inventing a token format now violates the well-vetted constraint. Revisit when a maintained ML-DSA is in the toolchain; expect a versioned PASERK-style wrapper. |
| 7 | Mailbox proof-of-possession | Ed25519 | Deferred (rides with #6) | 3 | Same online, ephemeral profile as relay keypairs. |
| 8 | Wake keypairs | Ed25519 | **No migration planned; reviewed against 2035** | — | Wake tokens transit APNs (4 KB payload cap); a ≥2.4 KB ML-DSA signature nearly consumes it. Signatures are seconds-lived and gate nothing confidential — payload encryption (#1) protects content. Classical remains the correct engineering answer. |
| 9 | LAT / Nitro attestation | AWS PCR attestation | **AWS timeline** | external | Not migratable by VettID. Mitigation: LAT format carries a signature-suite version field so an AWS PQC attestation rollout is a version bump, not a protocol change. Android key attestation and iOS App Attest roots go with it. |
| 10 | ChaCha20-Poly1305, Argon2id, CEK sealed storage | — | **No change** | — | Post-quantum safe at 256-bit strength. |
| 11 | Ballot (votes) site key | Ed25519, non-exportable KMS key; signs the service list (label ‖ SHA-256(list)) | **Hybrid Ed25519 + ML-DSA-65**: a second `ML_DSA_65` KMS key, two Sign calls, both signatures required | 2 (by 2030-12-31) | Long-lived, identity-like key. KMS offers ML-DSA; the constraint is the verifiers (§10 item 5). |
| 12 | Service-list anchor key | ECDSA P-256 in KMS; each list is logged in Rekor (Sigstore hashedrekord) | **Sigstore/Rekor PQ timeline** | external (track) | Depends on the algorithms Rekor accepts, like Nitro (#9). Tracked each review cycle. |
| 13 | Release manifest signing keys A and B | A: KMS `ECC_NIST_P256` (`lib/config.ts`). B: YubiKey PIV slot 9c, P-256 (`lib/config.ts`) | A: **ML-DSA-65 in KMS**. B: a new offline token or an accepted software offline key (PIV has no PQ algorithm) | 2 (by 2030-12-31) | Manifests are verified by every app; high value, long-lived. Key B is hardware-bound (§10 item 5). |
| 14 | TLS on VettID endpoints (CloudFront, push gateway, relay) | TLS 1.3 | **No VettID change for key exchange; certificates follow the WebPKI** | external | **Checked 2026-11-17 with OpenSSL 3.5:** staging.vettid.org, vettid.org, account.vettid.org, account.staging.vettid.org, relay.vettid.org, push.staging.vettid.org, calls.staging.vettid.org and votes.staging.vettid.org accept X25519MLKEM768 in TLS 1.3 when it is offered. Not covered: turn.staging.vettid.org gave no TLS answer on 443; push.vettid.org and relay.staging.vettid.org did not connect. Whether the apps' TLS stacks (Android and iOS platform TLS) offer it is to confirm per platform. Certificates (ECDSA/RSA) follow the WebPKI's own timeline. **Rule:** never set `CurvePreferences` without X25519MLKEM768 (the enclave's egress uses Go defaults, which include it). |
| 15 | Release tag signing (vettid-vault) | SSH Ed25519 tag signatures | **With #5** | 2 (by 2030-12-31) | Long-lived signatures on release tags. |
| 16 | Wallet (bitcoin) | secp256k1 ECDSA/Schnorr | **Out of scope** | — | Outside NIST's list; follows Bitcoin protocol changes. Listed for completeness. |
| 17 | Recovery request key | ECDSA P-256 in KMS (`lib/stacks/data-stack.ts`) | **ML-DSA-65 in KMS** | 2 (by 2030-12-31) | Signs `recovery` and `recovery_cancel`; pinned in releases (VAULT-MESSAGING §11.14.8), so a change is a release change. |
| 18 | service-vault per-service ballot anchor key | ECDSA P-256 in KMS | **With #12** | external (track) | Anchored in Rekor (BALLOT-PROTOCOL §2, §3.3). |
| 19 | Service identity key; per-proposal voting key `vk` | Ed25519 | **With suite 3 / #3** | 2 (by 2030-12-31) | Signatures on proposals, receipts and results are permanent public records (BALLOT-PROTOCOL §5). |
| 20 | LEASH delegation and status signatures | Ed25519 | **With #3** | 2 (by 2030-12-31) | The status issuer is the vault's `ik`; it moves with suite 3. |
| 21 | Recovery code browser seal | P-256 ECDH (WebCrypto) | **Accepted exception** | — | The only key agreement WebCrypto offers. The code expires in 48 h and is single-use (VAULT-MESSAGING §11.11.2 "PQC exception"). Reviewed against 2035. |
| 22 | KMS Recipient key transport | RSA-2048 RSAES-OAEP | **AWS-defined** | external | Protected in transit by the enclave's Go TLS 1.3 to kms.us-east-1.amazonaws.com, which negotiates X25519MLKEM768. Rule in #14. |
| 23 | iPhone Secure Enclave P-256 ECDH | P-256 | **Apple hardware timeline** | platform | Local only: unlock secret and seed wrap (VAULT-MESSAGING §11.14.1 "On an iPhone"). |
| 24 | App key and Android device key | P-256 in Android Keystore/StrongBox, Secure Enclave | **Platform timeline** | platform | Hardware-bound (VAULT-MESSAGING §11.7, §11.12.2). |
| 25 | Android app signing certificate | APK signing, pinned by vault releases (`android_signers`) | **Platform** | platform | APK Signature Scheme has no PQ algorithm. |
| 26 | Short-lived or third-party keys (grouped) | APNs ES256 and FCM RS256 provider JWTs; service-vault pinned P-256 TLS identity; Sigstore TSA and Rekor roots pinned in the vault; Cognito tokens; WebPKI leaves (RSA-2048) | **External** | external | Minutes-lived or owned by others. Re-confirmed each review. |

## 5. Hybrid constructions

### 5.1 Hybrid KEM (components #1, #2)

Both key agreements run per session; the shared secret is derived from both:

```
ss_x25519  = X25519(sk_c, pk_x25519_r)
(ct, ss_mlkem) = ML-KEM-768.Encaps(pk_mlkem_r)

ss = HKDF-SHA-256(
       ikm  = ss_x25519 || ss_mlkem,
       salt = protocol_label,
       info = transcript_hash   # binds both public keys + ct
     )
```

Requirements:

- The KDF `info` **must** bind the full handshake transcript (both public
  keys and the ML-KEM ciphertext) to prevent mix-and-match attacks.
- Concatenation order is fixed (classical first) and versioned in the
  protocol label.
- An attacker must break **both** X25519 and ML-KEM-768 to recover `ss`.
- Recipient key bundles advertise `{pk_x25519, pk_mlkem, suite_version}`.
  Suite version `1` was never deployed and MUST NOT be sent or accepted; `2` = hybrid.

**Standardized instantiation (preferred).** The construction above states the
security requirements; implementations SHOULD meet them with a standardized
hybrid rather than a hand-rolled combiner. HPKE (RFC 9180) with the
`MLKEM768X25519` KEM — the X-Wing-style hybrid, available in Go's standard
library (`crypto/hpke`, Go ≥ 1.26), Apple CryptoKit and BouncyCastle —
satisfies them: its combiner hashes both shared secrets together with the
ciphertext and public key, so an attacker must break both X25519 and
ML-KEM-768, and HPKE's `info` carries the protocol label and transcript
binding. VettID's vault messaging suite 2 uses HPKE(MLKEM768X25519,
HKDF-SHA256, ChaCha20-Poly1305) (VAULT-MESSAGING §4).

### 5.2 Hybrid signatures (component #3)

Credential signing produces a composite signature:

```
sig = { v: 2,
        ed25519:  Sign_Ed25519(sk_ed, msg),
        mldsa65:  Sign_MLDSA65(sk_ml, msg) }
```

- Verification policy during transition: **both must verify** when both are
  present (`AND` composition — strongest binding).
- `v: 1` (Ed25519-only) accepted only for credentials issued before the
  rotation epoch in which hybrid keys were introduced (§7).
- Key generation for both components occurs inside the enclave; the CEK
  sealing model is unchanged.

## 6. Selective disclosure layer

**Now (Phase 2):** salted-hash attribute commitments, SD-JWT pattern.

- The vault signs a credential whose body contains
  `H(salt_i || attr_name_i || attr_value_i)` per attribute (per-attribute
  random salts; hash = SHA-256).
- Disclosure of attribute *i* = revealing `(salt_i, name_i, value_i)`; the
  verifier recomputes the hash against the signed commitment.
- Properties: post-quantum by construction; signature-algorithm agnostic;
  trivially implementable in Go with the standard library.
- Known limitation: presentations are **linkable** across verifiers via the
  signature bytes. Partial mitigation is inherent to the Protean Credential —
  rotation breaks linkability across time in a way static-credential systems
  cannot. This is stated, not hidden.

**Horizon (tracked, not shipped):** BBS signatures (IETF CFRG draft) provide
true zero-knowledge selective disclosure with unlinkable presentations, but
are pairing-based (BLS12-381) and explicitly **not post-quantum**. Lattice
based anonymous-credential schemes exist only at research stage with no
complete libraries. Decision: the credential format carries a
`disclosure_mechanism` version field so a BBS presentation mode (or a future
PQ-ZK scheme) can be added without a format break. Revisit at each review
cycle.

### 6.5 Key bundle distribution: QR claim-check

Hybrid key bundles are too large for QR-carried exchange (an ML-KEM-768
public key alone is 1,184 bytes). Resolution: QR codes carry a **claim-check
with a commitment**, never the bundle itself.

The normative QR / link payload, bundle format and bundle encryption are
defined in **VAULT-MESSAGING §6.4**, which supersedes the sketch in earlier
versions of this section. In outline:

- The QR carries the relay, a claim id, `h` = SHA-256 of the encrypted
  bundle blob, the bundle key and the expiry (~200 bytes, unchanged by
  bundle size).
- The bundle (the inviter's `ik`, hybrid KEM `ek`, relay address, open
  token) is encrypted under the QR's key and left on the relay as a
  single-fetch claim; the scanner fetches it by claim id, recomputes
  SHA-256, and rejects on mismatch before decrypting.
- The commitment keeps the relay untrusted for integrity (a compromised
  relay cannot substitute a bundle) — consistent with the no-inbound-path
  posture where relays move bytes but vouch for nothing.
- Deposits are single-fetch with short TTL; claim IDs are ephemeral and
  unlinkable to persistent mailbox identity.
- The QR shape is size-invariant: future bundle growth (ML-DSA public keys,
  BBS presentation keys) never changes the QR.

**Terminology discipline:** "Zero-Knowledge Trust (ZKT)" is VettID's
*architectural* claim — the provider never holds user keys. It is distinct
from *zero-knowledge proofs* (the cryptographic primitive). Public materials
and specs must not conflate the two. Cryptographic ZK selective disclosure is
roadmapped via BBS pending post-quantum maturity.

## 7. Rollout mechanism: rotation-carried migration

The Protean Credential's rotation cycle is the migration vehicle:

1. Enclave build N+1 ships hybrid keygen (Ed25519 + ML-DSA-65) and hybrid
   KEM support.
2. On each credential rotation event, the vault issues the new hybrid
   keypair alongside the rotation; the returned credential copy the user
   stores locally (per the backup model — no seed phrases) is the hybrid
   credential.
3. Within one full rotation cycle, all active users are migrated with **zero
   user-visible ceremony**.
4. `v: 1` acceptance is disabled one full rotation cycle after enclave N+1
   reaches 100% deployment.

Relay hybrid KEM (Phase 1) uses direct cutover — no production users yet —
consistent with the relay migration approach in RELAY-PLAN.md.

## 8. Implementation dependencies

| Dependency | Requirement | Notes |
|---|---|---|
| Go ≥ 1.24 | `crypto/mlkem` (ML-KEM-768) | Available now; stdlib, no new third-party deps |
| A Go with `crypto/mldsa` | ML-DSA-44/65/87 | Not in Go 1.26 (the repos' pin); proposal golang/go #77626; release date to confirm. Preferred over third-party. Phase 2 is not gated on it (§2.1) |
| AWS KMS | `ML_DSA_44/65/87`, signing algorithm `ML_DSA_SHAKE_256` | Available (aws-cdk-lib `kms.KeySpec`, AWS SDK). No SLH-DSA, no composite key |
| Interim ML-DSA (optional) | Trail of Bits pure-Go ML-DSA/SLH-DSA | Reviewed, constant-time; use if Phase 2 must start before a Go with `crypto/mldsa` is pinned across repos |
| HKDF | `golang.org/x/crypto/hkdf` or stdlib | Already in dependency set |
| SLH-DSA-128s | Go stdlib when available; Trail of Bits interim | Offline signing only; not offered by KMS |

Dependency policy unchanged: prefer stdlib; `golang.org/x/crypto` acceptable;
no new external agentic/crypto frameworks.

## 9. Phases summary

- **Phase 1 (key establishment):** Hybrid X25519+ML-KEM-768 on relay E2E and
  vault sessions (#1, #2): done, as vault messaging suite 2 (HPKE
  MLKEM768X25519; suite 1 MUST NOT be sent or accepted). It closes the HNDL
  window for vault messaging and calls; the exceptions are in §3 (recovery
  code seal, KMS Recipient transport, platform hardware). Call media
  secrecy no longer depends on a classical key exchange (`k_call` comes from
  suite 2). Servers accept X25519MLKEM768 in TLS (checked 2026-11-17; the
  apps' TLS stacks to confirm).
- **Phase 2 (starts no later than 2027-06-30, an owner decision; done by
  2030-12-31):** Hybrid Ed25519+ML-DSA-65 credentials via rotation-carried
  migration (suite 3); salted-hash selective disclosure; SLH-DSA-128s
  release-signing root; the ballot site key, release manifest keys A and B,
  release tags, the recovery request key, service identity and voting keys,
  LEASH signatures (#11, #13, #15, #17, #19, #20).
- **Phase 3 (deliberate deferral, reviewed against the 2035 disallowance):**
  Relay keypairs, PASETO deposit tokens, mailbox proof-of-possession →
  ML-DSA-44 wrapper design doc first.
- **External or platform:** LAT/Nitro attestation on AWS timeline (format is
  version-ready); Sigstore/Rekor (#12, #18); WebPKI certificates (#14, #26);
  KMS Recipient transport (#22); platform hardware and signing (#23-#25).
- **Accepted exception:** the recovery code browser seal (#21).
- **No migration planned, reviewed against 2035:** Wake keypairs (APNs
  constraint, ephemeral, non-confidential). The symmetric layer is already
  PQ-safe.

## 10. Open questions

1. Exact PASERK-style wrapper design for ML-DSA-44 deposit tokens (Phase 3
   design doc; do not improvise in code).
2. Whether hybrid verification policy relaxes from AND to OR at any defined
   future point (current position: no — AND until classical deprecation).
3. ~~ML-KEM public key size impact on QR-encoded exchange paths.~~
   **Resolved (v0.2.0):** QR claim-check with hash commitment, §6.5. Bundles
   move to relay bootstrap deposits; QR size is invariant to bundle growth.
4. FIPS 140-3 Go Cryptographic Module version pinning, if compliance ever
   becomes a sales requirement.
5. Which verifiers gate each KMS key's move to ML-DSA, and what to do about
   hardware tokens. KMS already offers ML-DSA, so the constraints are:
   - the verifiers: apps, the enclave, votesctl, and the push and calls
     manifest checks must all accept the new algorithm before a key moves;
   - Rekor's accepted algorithms (#12, #18);
   - hardware tokens: key B (YubiKey PIV, P-256) and the release keys (SSH
     ed25519-sk) have no PQ algorithm. Options: a new offline token that
     supports one, or an accepted software offline key. To confirm; decide
     before 2029.
6. Sigstore/Rekor PQ support for the service-list anchor (#12, #18), and what
   to do if it is not ready before 2030 (to confirm).
7. Whether the apps' platform TLS stacks (Android, iOS) offer X25519MLKEM768
   (to confirm per platform).
8. Phase 2 start date: 2027-06-30 is proposed. The owner decides.

## 11. References

- NIST FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), FIPS 205 (SLH-DSA)
- NIST IR 8547 (final, October 2026), Transition to Post-Quantum
  Cryptography Standards; NIST SP 800-56C, SP 800-208, SP 800-227
- Go `crypto/mlkem` (Go 1.24+); `crypto/mldsa` proposal (golang/go #77626)
- draft-irtf-cfrg-bbs-signatures (BBS Signature Scheme)
- X25519MLKEM768 hybrid TLS key exchange (deployed default in OpenSSL,
  Chrome, Cloudflare)
- Trail of Bits pure-Go ML-DSA / SLH-DSA implementations (constant-time
  engineering notes)
