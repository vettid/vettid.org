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
    timeline and a dated target (every signing key that protects more than a
    short-lived session is on a PQ or hybrid suite before 2030-12-31); Phase 2
    starts when a maintained ML-DSA exists, no longer only on the Go 1.27 pin;
    §3 and §4 list the keys and channels that were missing (ballot site key,
    service-list anchor key, release manifest keys, release tags, TLS, wallet);
    row 5a corrected to the FrameCryptor (CALLS-PLAN D11); vault messaging
    suite 2 marked done; §9 and §10 updated
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
meet at least Category 1) and is acceptable.

### 2.1 NIST timeline and VettID's alignment

NIST IR 8547 (final, October 2026) sets the timeline for leaving
quantum-vulnerable public-key algorithms:

- RSA, ECDSA, EdDSA (including Ed25519), ECDH (including X25519) and
  finite-field DH/MQV, at 112-bit strength or more, are **deprecated after
  2030** and **disallowed after 2035**.
- ML-KEM is the only approved PQ key establishment. NIST recommends
  ML-KEM-768 as the default. HQC is selected and will be approved later.
- Approved PQ signatures: ML-DSA-44/65/87 (FIPS 204), SLH-DSA (FIPS 205),
  LMS/HSS and XMSS/XMSS^MT (SP 800-208).
- Hybrid key establishment is allowed: SP 800-56C composite `Z' = Z || T`
  (or `T || Z`, order fixed by the protocol) is permitted even if one input
  is from a disallowed algorithm. It is FIPS-140-validatable if one input is
  approved. Combiner guidance is in SP 800-227. Dual or composite signatures
  are allowed; their security properties need careful analysis.
- Symmetric: 112-bit standards are disallowed in 2030.
- Key establishment goes first, as with HNDL above.

US federal high-value, high-impact systems (OMB M-26-15) must use
quantum-resistant key establishment by 2030-12-31 and signatures by
2031-12-31. That does not bind VettID. It is context for the dates below.

Plan statement (for the owner's approval):

- **Every VettID signing key that protects anything beyond a short-lived
  session is on a PQ or hybrid suite before 2030-12-31** (NIST's
  deprecation date).
- Phase 1 (key establishment) is the first step and is under way (§9).
- Phase 2 starts when the toolchain (Go, CryptoKit, Android) has a
  maintained ML-DSA, not only on the Go 1.27 pin, and must finish by the
  date above. Keys held in AWS KMS wait for AWS KMS to offer ML-DSA (§10).
- Phase 3 items are reviewed against the 2035 disallowance. A deferral in
  §4 stands only if the key is short-lived and the item is re-confirmed
  before 2030.
- External dependencies (Nitro, Sigstore/Rekor, WebPKI certificates) follow
  their own timelines and are tracked, not scheduled here.

## 3. Current cryptographic inventory

| Primitive | Where used | Quantum exposure |
|---|---|---|
| X25519 | Vault session key agreement; relay E2E payload encryption | **HNDL — highest risk** |
| Ed25519 | Protean Credential; relay keypairs; wake keypairs; mailbox proof-of-possession; PASETO v4.public deposit tokens | Forgery post-CRQC; risk scales with key lifetime |
| ChaCha20-Poly1305 | Payload and sealed-storage encryption | Safe (Grover only) |
| Argon2id | Key derivation from user secrets | Safe |
| AWS Nitro attestation (LAT trust root) | Enclave PCR attestation | AWS-controlled; not migratable by VettID |
| Ed25519 (KMS, non-exportable) | Ballot (votes) site key; signs the service list (label ‖ SHA-256(list)) | Forgery post-CRQC; long-lived, identity-like |
| ECDSA P-256 (KMS) | Service-list anchor key; logs each list in Rekor (Sigstore hashedrekord) | Forgery post-CRQC; depends on Sigstore/Rekor |
| ECDSA P-256 (KMS `ECC_NIST_P256`, `lib/config.ts`) and an offline token key | Release manifest signing keys A and B; signed manifests are verified by every app | Forgery post-CRQC; high value, long-lived |
| Ed25519 (SSH signatures) | Release tags on vettid-vault | Forgery post-CRQC; long-lived |
| TLS 1.3 key exchange; ECDSA/RSA certificates | VettID endpoints (CloudFront, push gateway, relay) | Key exchange: hybrid already (§4 #14). Certificates: WebPKI timeline |
| secp256k1 ECDSA/Schnorr | Wallet (bitcoin) | Outside NIST; follows the Bitcoin protocol |
| HPKE(MLKEM768X25519, HKDF-SHA256, ChaCha20-Poly1305) | Vault messaging suite 2 (VAULT-MESSAGING §4) | Hybrid; HNDL addressed |
| AES-128-GCM (FrameCryptor) | Call media frames, keyed from `k_call` | Safe (NIST Category 1); `k_call` rides the hybrid messaging |

## 4. Target algorithm map

| # | Component | Current | Target | Phase | Rationale |
|---|---|---|---|---|---|
| 1 | Relay E2E payload encryption | X25519 | **Hybrid X25519 + ML-KEM-768** | 1 (now) | HNDL-exposed; mailbox blobs are the primary quantum target. ML-KEM-768 matches industry consensus (X25519MLKEM768). ~1.2 KB ciphertext overhead is negligible against 8 MB claim-check blobs. Go stdlib `crypto/mlkem` (Go ≥ 1.24). |
| 2 | Vault session key agreement | X25519 | **Hybrid X25519 + ML-KEM-768** | 1 (**done** for vault messaging: suite 2 is HPKE MLKEM768X25519, VAULT-MESSAGING §4) | Same HNDL logic; same construction (§5). Whether relay E2E payload encryption (#1) also uses suite 2 is to confirm. |
| 3 | Protean Credential signing keys | Ed25519 | **Hybrid Ed25519 + ML-DSA-65** | 2 (when a maintained ML-DSA exists; before 2030-12-31) | Longest-lived, highest-value keys → lead the signature migration. Level 3 parameter set appropriate for an identity root. ~3.3 KB signatures live inside vault/enclave exchanges where size does not pinch. Rotation delivers the migration (§7). |
| 4 | Selective disclosure layer | (implicit; full-credential presentation) | **Salted-hash attribute commitments** (SD-JWT pattern) | 2 | Hash-based → post-quantum by construction; well-vetted; algorithm-agnostic (works under Ed25519 or ML-DSA). See §6. |
| 5 | Release/update signing root (vettid-agent) | — (new) | **SLH-DSA-128s** | 2 (before 2030-12-31) | Lattice-independent conservative root; hash-based assumptions only. Offline signing → 7.8 KB / ~274 ms cost irrelevant. |
| 5a | 1:1 call media encryption | AES-128-GCM frame encryption by the media stack's FrameCryptor, keyed from `k_call`; DTLS-SRTP below | **No change to the frame cipher** | done with Phase 1 | Not SFrame (CALLS-PLAN D11 replaced it; this row was stale). `k_call` is carried inside the vault's hybrid messaging (MLKEM768X25519), so the PQ guarantee rides above the transport. AES-128 is NIST Category 1 (§2). A 256-bit option and cipher agility are goals in CALLS-PLAN. TURN providers are untrusted regardless of vendor. |
| 6 | Relay keypairs + PASETO deposit tokens | Ed25519 (PASETO v4.public) | Deferred → ML-DSA-44 wrapper | 3 | Short-lived, verified online → zero HNDL exposure. No PQ PASETO version exists; inventing a token format now violates the well-vetted constraint. Revisit post-Go 1.27; expect a versioned PASERK-style wrapper. |
| 7 | Mailbox proof-of-possession | Ed25519 | Deferred (rides with #6) | 3 | Same online, ephemeral profile as relay keypairs. |
| 8 | Wake keypairs | Ed25519 | **No migration planned** | — | Wake tokens transit APNs (4 KB payload cap); a ≥2.4 KB ML-DSA signature nearly consumes it. Signatures are seconds-lived and gate nothing confidential — payload encryption (#1) protects content. Classical remains the correct engineering answer. |
| 9 | LAT / Nitro attestation | AWS PCR attestation | **AWS timeline** | external | Not migratable by VettID. Mitigation: LAT format carries a signature-suite version field so an AWS PQC attestation rollout is a version bump, not a protocol change. |
| 10 | ChaCha20-Poly1305, Argon2id, CEK sealed storage | — | **No change** | — | Post-quantum safe at 256-bit strength. |
| 11 | Ballot (votes) site key | Ed25519, non-exportable KMS key; signs the service list (label ‖ SHA-256(list)) | **Hybrid Ed25519 + ML-DSA-65, or ML-DSA-65, when AWS KMS offers ML-DSA** | 2 (before 2030-12-31) | Long-lived, identity-like key. A KMS-held key cannot move to a suite KMS does not offer (§10). |
| 12 | Service-list anchor key | ECDSA P-256 in KMS; each list is logged in Rekor (Sigstore hashedrekord) | **Sigstore/Rekor PQ timeline** | external (track) | Depends on Sigstore/Rekor PQ support, like Nitro (#9). Tracked each review cycle. |
| 13 | Release manifest signing keys A (KMS `ECC_NIST_P256`, `lib/config.ts`) and B (offline token) | ECDSA P-256 | **With #5: SLH-DSA or ML-DSA** | 2 (before 2030-12-31) | Manifests are verified by every app; high value, long-lived. Key A also waits on AWS KMS (§10). |
| 14 | TLS on VettID endpoints (CloudFront, push gateway, relay) | TLS 1.3 | **No VettID change for key exchange; certificates follow the WebPKI** | external | **Checked 2026-11-17 with OpenSSL 3.5:** staging.vettid.org, vettid.org, account.vettid.org, account.staging.vettid.org, relay.vettid.org, push.staging.vettid.org, calls.staging.vettid.org and votes.staging.vettid.org all negotiate X25519MLKEM768 in TLS 1.3. Key exchange is hybrid PQ wherever the client supports it. Whether the apps' TLS stacks (Android and iOS platform TLS) offer it is to be confirmed per platform. Certificates (ECDSA/RSA) follow the WebPKI's own timeline. |
| 15 | Release tag signing (vettid-vault) | SSH Ed25519 tag signatures | **With #5** | 2 (before 2030-12-31) | Long-lived signatures on release tags. |
| 16 | Wallet (bitcoin) | secp256k1 ECDSA/Schnorr | **Out of scope** | — | Outside NIST's list; follows Bitcoin protocol changes. Listed for completeness. |

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
  Suite version `1` = classical only (transition); `2` = hybrid.

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
| Go 1.27 | `crypto/mldsa` (ML-DSA-44/65/87) | Released/imminent Aug 2026; preferred over third-party. Phase 2 is not gated on it alone (§2.1) |
| Interim ML-DSA (optional) | Trail of Bits pure-Go ML-DSA/SLH-DSA | Reviewed, constant-time; use only if Phase 2 must start before Go 1.27 is pinned across repos |
| HKDF | `golang.org/x/crypto/hkdf` or stdlib | Already in dependency set |
| SLH-DSA-128s | Go stdlib when available; Trail of Bits interim | Offline signing only |

Dependency policy unchanged: prefer stdlib; `golang.org/x/crypto` acceptable;
no new external agentic/crypto frameworks.

## 9. Phases summary

- **Phase 1 (key establishment):** Hybrid X25519+ML-KEM-768 on relay E2E and
  vault sessions. Direct cutover. Closes the HNDL window. Vault messaging
  suite 2 (HPKE MLKEM768X25519) is done; call media keys (`k_call`) ride on
  it, so calling is no longer a non-PQ transport. TLS to VettID's endpoints
  already negotiates X25519MLKEM768 (checked 2026-11-17; app-side stacks to
  confirm). Relay E2E payload status (#1) is to confirm.
- **Phase 2 (starts when a maintained ML-DSA exists; done before
  2030-12-31):** Hybrid Ed25519+ML-DSA-65 credentials via rotation-carried
  migration; salted-hash selective disclosure; SLH-DSA-128s release-signing
  root; the ballot site key, release manifest keys A and B and release tags
  (#11, #13, #15). KMS-held keys also wait on AWS KMS ML-DSA.
- **Phase 3 (deliberate deferral, reviewed against the 2035 disallowance):**
  Relay keypairs, PASETO deposit tokens, mailbox proof-of-possession →
  ML-DSA-44 wrapper design doc first.
- **External:** LAT/Nitro attestation on AWS timeline (format is
  version-ready); Sigstore/Rekor (#12); WebPKI certificates (#14).
- **Never:** Wake keypairs (APNs constraint, ephemeral, non-confidential);
  symmetric layer (already PQ-safe).

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
5. When AWS KMS offers ML-DSA, for the KMS-held keys (#11, #13). Until then
   those keys cannot meet the 2030 target in KMS. Options if it is late:
   a non-KMS key in the enclave or offline, or a hybrid with an offline
   PQ key. To confirm; decide before 2029.
6. Sigstore/Rekor PQ support for the service-list anchor (#12), and what
   to do if it is not ready before 2030 (to confirm).
7. Whether the apps' platform TLS stacks (Android, iOS) offer X25519MLKEM768
   (to confirm per platform).
8. Whether relay E2E payload encryption (#1) uses VAULT-MESSAGING suite 2
   (to confirm).

## 11. References

- NIST FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), FIPS 205 (SLH-DSA)
- NIST IR 8547 (final, October 2026), Transition to Post-Quantum
  Cryptography Standards; NIST SP 800-56C, SP 800-208, SP 800-227
- Go `crypto/mlkem` (Go 1.24+); Go 1.27 `crypto/mldsa` proposal (golang/go
  #77626)
- draft-irtf-cfrg-bbs-signatures (BBS Signature Scheme)
- X25519MLKEM768 hybrid TLS key exchange (deployed default in OpenSSL,
  Chrome, Cloudflare)
- Trail of Bits pure-Go ML-DSA / SLH-DSA implementations (constant-time
  engineering notes)
