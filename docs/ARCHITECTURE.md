---
title: ARCHITECTURE
status: overview (as built and planned, 2026-10-03)
version: 0.1.1
date: 2026-10-04
owner: Al Liebl (Mesmer)
changelog:
  - 0.1.1: the V5 release model (VAULT-RELEASES, VAULT-MESSAGING
    0.10.0): channels, monthly cadence, retirement after notice with key
    deletion, manifest by hash; VAULT-RELEASES in the docs index
  - 0.1.0: first system overview for vettid.org, replacing vettid-dev
    `docs/vettid-architecture-diagram.md`; includes the docs index and
    the roadmap after the owner decisions of 2026-10-03
classification: public (no secrets; safe for github.com/vettid)
---

# VettID architecture

A one-document overview of the VettID system at vettid.org: what the parts
are, who trusts whom, how data moves, and what is planned. Each section
links to the detailed documents; when they disagree with this overview,
they win. The full list of documents is in §10.

## 1. The idea in one paragraph

Every member has a **vault**: a small program, one per member, running
inside an AWS Nitro Enclave, holding the member's data and keys. Only the
enclave release the member approved can open it, and only with the
member's PIN. Apps, desktops, agents and other members' vaults talk to it
through a **relay** that stores ciphertext it cannot read. The member's
most critical keys are not even in the vault: they are in the **Protean
Credential**, which the member's phone holds and which works only with
the member's password, once per use. Everything around that (website,
account and admin sites, APIs) handles membership and routing, never
contents.

## 2. Components

```
                         Internet (TLS 1.3, hybrid PQ key exchange where offered)
 ┌──────────────┐   ┌──────────────┐   ┌───────────────┐   ┌───────────────┐
 │ Member's     │   │ Desktop      │   │ Agent         │   │ Other members'│
 │ phone app    │   │ (pairs,      │   │ (LEASH grants)│   │ vaults        │
 │ (holds the   │   │ never        │   │               │   │               │
 │ credential)  │   │ unlocks)     │   │               │   │               │
 └──┬────────┬──┘   └──────┬───────┘   └──────┬────────┘   └──────┬────────┘
    │        │             │ E2E envelopes (HPKE MLKEM768X25519)  │
    │        └─────────────┴──────────┬───────┴───────────────────┘
    │ enroll / unlock /               ▼
    │ recovery (sealed to   ┌───────────────────────┐
    │ the enclave)          │ Relay                  │  relay.vettid.org
    ▼                       │ Fargate tasks behind   │  DynamoDB (state), S3 (blobs),
 ┌──────────────────────┐   │ an ALB                 │  Valkey (replay, limits, wakes)
 │ account.vettid.org   │   └──────────┬────────────┘
 │ Account site +       │              │ signed requests, built inside the enclave;
 │ Member API (Lambda)  │              │ TLS ends inside the enclave
 │ Cognito member pool  │              ▼
 │ DynamoDB tables      │   ┌──────────────────────────────────────────────┐
 └──────────┬───────────┘   │ Enclave host (EC2, Graviton, ASG)            │
            │ per-instance  │  parent: untrusted byte forwarder, SQS, S3,  │
            │ SQS queue ───▶│  leases; never parses envelopes              │
            │ (alternate    │ ┌──────────────────────────────────────────┐ │
            │  channel)     │ │ Nitro Enclave (one approved release)     │ │
            │               │ │  supervisor: attestation, ETK, egress TLS│ │
            │               │ │  one OS process per unlocked vault       │ │
            │               │ └──────────────────────────────────────────┘ │
            │               └───────────┬───────────────────┬──────────────┘
            │                           ▼                   ▼
            │                 S3 vault data          KMS: one sealing key per
            │                 (DEK-encrypted state,   release, usable only by
            │                  sealed headers)        that release's PCR0
            ▼
 Admin site + Admin API (reachable only through a private tailnet exit node; Cognito admin pool, TOTP)

 vettid.org website (static, CloudFront + S3), mailing list, playbooks; signed release manifest
 at /.well-known/vettid/pcr-manifest.json
```

| Component | What it does | State | Details |
|---|---|---|---|
| **Website** vettid.org | Static site, mailing-list sign-up, playbooks, security page, signed release manifest | Live | RUNBOOK "Stacks", `website/`, playbooks-design-spec.md, logs-analysis.md |
| **Account site + Member API** | Request membership (with an optional registration code), magic link + PIN sign-in, terms, trial subscriptions, cancel; vault routes for the alternate channel and recovery | Live (vault routes built, waiting for V5) | ACCOUNT-ADMIN-PLAN §5, MEMBER-API |
| **Cognito** | Member pool (custom auth: magic link, optional PIN) and admin pool (TOTP MFA) | Live | ACCOUNT-ADMIN-PLAN §3, §4 |
| **Admin site + Admin API** | Requests queue, members, registration codes, terms, subscription types, admins, audit | Live, private | ACCOUNT-ADMIN-PLAN §4, §6, ADMIN-API |
| **Data** | `vettid-org-*` DynamoDB tables (members, registration codes, subscriptions, terms, audit, rate limits, magic links), terms PDF bucket; the vault tables (vault, instance registry, requests, releases) are in the vault account's VettidOrgVaultStack | Live | ACCOUNT-ADMIN-PLAN §3.4, VAULT-RELEASES §8.1, RUNBOOK |
| **Relay** | Mailboxes for opaque ciphertext: deposit tokens issued by the recipient, collect by long-poll or WebSocket, claims, blobs, owner-signed mailbox delete, the invitation page `/connect` and `assetlinks.json` | Live, protocol 0.6.0 (option B: 2–8 Fargate tasks, DynamoDB, S3, Valkey) | RELAY-PROTOCOL 0.6.0, RELAY-PLAN, RUNBOOK "Relay", vettid-relay |
| **Vault** | Supervisor plus one OS process per unlocked vault inside a Nitro Enclave; items, connections, messages, credential, LEASH, grants, audit and more | In development (vettid-vault; V5 hardware next) | VAULT-MESSAGING, VAULT-PLAN, VAULT-ITEMS |
| **Parent** | On the enclave host, outside the enclave: vsock mux, SQS consumer, S3 conditional reads and writes, TCP forwarding to an allowlist, leases, health. No keys, no parsing. | In development | VAULT-PLAN §2, §5 |
| **Alternate channel** | Enroll, unlock, lock and recovery requests sealed to an attested enclave key, carried Member API → per-instance SQS → parent → enclave. A locked vault never touches the relay. | Specified, built | VAULT-MESSAGING §11, MEMBER-API "Vault" |
| **App** | Android (fresh rewrite), iOS (later). **One app per vault** (owner decision, 2026-10-03): the app is the Protean Credential holder and the only device that may unlock | Android planned | ANDROID-PLAN, VAULT-PLAN V6, PROTEAN-CREDENTIAL §4 |
| **Desktop** | Pairs with the phone; access sessions with step-up approvals; never unlocks | Later | VAULT-MESSAGING §6.7, §6.8 |
| **Agents** | Act under LEASH grants signed with the member's credential key | Vault side specified; client later | VAULT-MESSAGING §10.11, LEASH |
| **`vaultctl`** | Go reference client and test driver (app, desktop, agent or peer vault) | Built | vettid-vault |
| **Push gateway** | Contentless wakes through FCM/APNs or UnifiedPush | Planned | PUSH-GATEWAY 0.2.0 |
| **Calling service** | Optional, self-hostable TURN media plane for end-to-end encrypted 1:1 calls | Planned | CALLING-SERVICE |

**LEASH** (Lightweight Encrypted Agent Secret Handling) is the open
standard VettID proposes for AI agents' access to secrets: secrets never
leave the vault, humans approve access, everything is audited. VettID's
vault implements it for the member's own agents (github.com/vettid/LEASH).

## 3. Trust boundaries

| Party | Trusted for | Never trusted with |
|---|---|---|
| Enclave release the member approved | Confidentiality and integrity of the vaults sealed to it | Anything its measurements do not attest |
| Parent / enclave host | Availability | Keys, plaintext, parsing, freshness, routing decisions |
| Relay | Availability | Content, integrity, authorship, who owns a mailbox |
| Member API, queues, tables | Member sessions, rate limits, routing | PINs, keys, vault contents, mailbox ids |
| Account site and Cognito | Membership and sign-in | Anything in the vault |
| Admin site and API | Membership administration | Anything in the vault; admins cannot reach vault contents |
| Push gateway (planned) | Delivering contentless wakes | Everything else; it cannot link a wake to a mailbox |
| Another member's vault | What its owner shares | Anything else; it may be malicious |
| Owner devices and agents | What their role and grants allow | Agents get least privilege |

The full threat model, including what is out of scope (enclave platform
compromise, a malicious release the member approved), is
VAULT-MESSAGING §2. What VettID can still do with its residual powers is
§13.5.

**Three locks.** The member's data sits behind three locks, one per item
sensitivity (VAULT-ITEMS §4):

| Lock | Sensitivity | Where | Who can use it |
|---|---|---|---|
| 1. Data that describes you | `data` | Vault state, under the PIN-derived DEK | Any owner device; shared by share rules and grants |
| 2. Secrets that act for you | `secret` | Vault state; reads audited | Apps, desktops with step-up; shared by rules and grants |
| 3. Critical secrets, irreversible if exposed | `critical` | Values encrypted under item keys that only the Protean Credential holds | Apps only, with the credential password, per use; connections can ask for a *use*, never the value |

## 4. Data flows

**Join.** Request membership on the account site, with a registration
code (2 uses by default) or admin approval; verify the email (SES sandbox
opt-in); sign in; accept the terms (ACCOUNT-ADMIN-PLAN §5.1).

**Enroll** (VAULT-MESSAGING §11.3). The app fetches an enclave instance's
transport key (ETK) and attestation through the Member API, checks the
attestation against the signed release manifest, and sends a request
sealed to the ETK, with Android key attestation (or App Attest) and the
member's chosen PIN. The enclave creates the vault, its keys and its relay
mailbox; the app then creates the Protean Credential with the member's
password. The PIN and password are set in the app, never on the web.

**Unlock** (§11.4). The same sealed path, with the PIN and a device
assertion. The vault process derives the DEK, opens its state, and starts
collecting from the relay. Locked vaults do nothing on the relay; peers'
messages wait in the mailbox.

**Messaging and connections** (§6.4, §10.5). Two vaults connect through an
invitation (QR or link) and a safety code; afterwards each vault deposits
end-to-end encrypted envelopes into the other's mailbox, using deposit
tokens the recipient issued. Owner devices talk only to their own vault;
peer traffic is always vault to vault.

**Sharing** (§10.12). Share rules over tags decide what a connection or
agent may read; underneath, each shared item is a grant whose values are
sealed to the fetching device.

**Critical use** (§3.5, §10.13). The app sends the credential blob and the
password, sealed to a one-time key; the vault uses the key inside the
enclave and rotates the credential.

**Release update** (§11.10). At an unlock, the app offers a newer release;
with the member's signed approval, the vault is re-sealed for that release
(RELEASE-UPDATES.md).

**Recovery** (§11.11). From the account portal, with a 24-hour delay that
the member's app can cancel, then the PIN and the credential password on
a new attested app, which replaces the old one; with the credential
backup off the credential and critical items are lost and only a new
credential or deletion remains. A member who still has the old phone
transfers directly instead: the old app shows a QR, the new app scans it,
the old app approves with the PIN and password, no wait (VAULT-MESSAGING
§6.7.1). A second copy of the credential raises a clone alarm: refused,
the app alerted, the member emailed, credential use frozen until a forced
rotation (§3.5.9).

## 5. Keys, attestation and releases

- **Attestation.** Apps verify the enclave's Nitro attestation and the
  release's PCR0 against a manifest signed by a key pinned in every app
  and release image (§11.2, §11.10.1). Enroll and unlock requests carry
  the manifest's hash; the host supplies the document, which the enclave
  verifies (§11.5).
- **Channels (VAULT-RELEASES §3.1).** `dev` (fake NSM and KMS), `staging`
  (its own AWS account, manifest key and deletable keys) and `production`
  (locked keys); each image embeds one channel's constants, so a staging
  image can never open, seal to or be listed for production (§11.10.8).
- **Sealing per release (VAULT-PLAN D1).** Each release has its own KMS key
  whose immutable policy lets only that release's PCR0 decrypt. A vault is
  sealed to the release the member last approved; no later release, and
  nobody at VettID, can open it until the member approves a move.
- **Releases and retirement (D1a, VAULT-RELEASES).** At most one
  production release a month plus security hotfixes. A superseded release
  is `deprecated` (move-only) for 12 months, `retired` for its last 90
  days (in-app warnings and emails), then `removed`: its instances stop
  and its key is scheduled for deletion with a 30-day window, the only
  deletion its policy allows, by one pinned retirement role (§11.10.7).
  Members who never move lose access; confidentiality never changes.
- **Reproducible builds (D3).** Anyone can rebuild the image and compare
  PCR0.
- **Process per vault (D4).** Each unlocked vault is its own OS process
  inside the enclave, holding all of its secrets; locking ends the process.
  The supervisor holds no per-vault secret.
- **TLS in the enclave (D5).** The host sees byte counts and timing on a
  few shared connections, not the vault's contacts.
- **DEK.** Derived from the PIN with Argon2id and a pepper only the sealed
  header holds; a wrong PIN simply fails to decrypt.
- **Protean Credential.** PROTEAN-CREDENTIAL.md; normative in
  VAULT-MESSAGING §3.5.

## 6. Post-quantum cryptography

PQC-MIGRATION is the plan. In short:

- **Phase 1 (now):** every end-to-end key agreement is hybrid X25519 +
  ML-KEM-768 (HPKE MLKEM768X25519): envelopes, handshakes, the credential,
  one-time keys. The relay's ALB uses a post-quantum TLS policy; hybrid
  TLS on the CloudFront sites is to be confirmed (ACCOUNT-ADMIN-PLAN §7).
  The one exception is the recovery code's browser
  seal (P-256, short-lived; VAULT-MESSAGING §11.11.2).
- **Phase 2:** signatures move to Ed25519 + ML-DSA-65, carried by
  `credential.rotate` and suite bumps (every structure has a suite or
  version field). Calling media moves to SFrame over a hybrid KEM.

## 7. What VettID does not do

- No backup or export of vault data outside the service (owner decision,
  2026-10-03). Losing the stored state itself is out of scope
  (VAULT-MESSAGING §2.2).
- No votes, B2C service vaults, org vaults or group primitives in the
  vault (VAULT-MESSAGING §1.1).
- No parsing of envelopes outside the enclave, and no transport
  credentials minted for clients.

## 8. Roadmap

| Item | Status | Where |
|---|---|---|
| Vault on Nitro hardware (V5), then clients (V6: `vaultctl`, Go agent, Android, iOS, desktop) | Next | VAULT-PLAN |
| **Push, both paths** (owner decision, 2026-10-03): FCM/APNs **and** a path without Google services (UnifiedPush, or relay polling by a foreground service), so phones such as GrapheneOS get messages | Designed | PUSH-GATEWAY 0.2.0, ANDROID-PLAN §7 |
| GrapheneOS enrollment: accept its verified-boot key in device attestation (it reports `SelfSigned`, which VAULT-MESSAGING §11.7 refuses today) | Follow-up | VAULT-MESSAGING §11.7 |
| One app per vault, holding the credential; a second or stale copy is refused, alerted, emailed and freezes credential operations until a forced rotation; direct transfer to a new phone (owner decision, 2026-10-03) | Spec change after V4 batch 4 | PROTEAN-CREDENTIAL §4 |
| Calling service (TURN, SFrame end-to-end media) | Planned | CALLING-SERVICE |
| Governance voting for paid members (outside the vault; paid members are the voting members) | Coming soon | ACCOUNT-ADMIN-PLAN §5.1, §9 |
| Payments for paid subscriptions | Later | ACCOUNT-ADMIN-PLAN §10 |
| Vault-to-vault transfer within the service (move a member's data from an old vault to a new one) | Future | VAULT-PLAN "Later" |
| Self-hosted vaults / a home appliance (verified against the published release measurements) | Future direction, not a current design | this section |
| PQC Phase 2 (hybrid signatures) | Later | PQC-MIGRATION |
| Public release log | With the first vault release | RELEASE-UPDATES §5 |
| Technical preview | When V5 and the first Android release are ready | TECH-PREVIEW |

**Self-hosted vaults.** The goal of letting members run their vault on
their own hardware, or a VettID home appliance, remains, "down the road".
Reproducible builds and published measurements make a self-hosted enclave
verifiable, and the relay and calling service are already designed to be
self-hostable. Today's sealing model (per-release keys in VettID's AWS
account) assumes VettID hosting; a self-hosted design would need its own
answer for sealing, attestation and recovery. Nothing in the current
documents specifies it.

## 9. Repositories

| Repository | Contents |
|---|---|
| vettid/vettid.org | Website, account and admin sites, Member and Admin APIs, all CDK stacks, the design docs (`docs/`) |
| vettid/vettid-vault | Enclave supervisor, vault, parent, crypto, `vaultctl`, test vectors, reproducible image build |
| vettid/vettid-relay | The relay server and Go client (`relayclient`) |
| vettid/vettid-android | Android app (fresh rewrite per ANDROID-PLAN) |
| vettid/vettid-ios | iOS app (later) |
| vettid/vettid-desktop, vettid/vettid-agent | Desktop and agent clients (later, rebuilt on the relay) |
| vettid/LEASH | The LEASH position paper |
| vettid/vettid-dev | **Archived.** The first implementation (vettid.dev, NATS). Kept for history only. |

## 10. Documents

All in `docs/` of this repository unless noted.

| Document | One line |
|---|---|
| ARCHITECTURE.md | This overview: components, trust boundaries, flows, roadmap |
| VAULT-MESSAGING.md | Normative vault spec: keys, envelope, sessions, delivery, message registry, enrollment, unlock, release updates, recovery |
| VAULT-PLAN.md | How the vault is built: repos, phases V1–V6, decisions D1–D5 |
| VAULT-ITEMS.md | Design note: one item model with tags, sensitivity and share rules |
| PROTEAN-CREDENTIAL.md | The Protean Credential's design and rationale (normative in VAULT-MESSAGING §3.5) |
| VAULT-RELEASES.md | V5 plan: channels, release lifecycle and retirement, build, keys, infrastructure, first deployment |
| RELEASE-UPDATES.md | How members approve vault releases; end dates and notices; the public release log |
| RELAY-PROTOCOL.md | Relay wire protocol: mailboxes, tokens, deposit, collect, claims |
| RELAY-PLAN.md | Relay implementation plan and history |
| PUSH-GATEWAY.md | Contentless wake-up pushes: FCM/APNs and UnifiedPush, plus a no-push polling path |
| CALLING-SERVICE.md | Optional TURN media plane and end-to-end encrypted 1:1 calls |
| PQC-MIGRATION.md | Post-quantum migration plan, phases 1 and 2 |
| LEASH-IMPLEMENTATION.md | How the vault implements the LEASH paper: status, mapping, wire-format differences |
| ACCOUNT-ADMIN-PLAN.md | Account and admin sites: lifecycle, registration codes, voting rights, private admin access |
| MEMBER-API.md | Member API routes, including the vault alternate channel and recovery |
| ADMIN-API.md | Admin API routes |
| ANDROID-PLAN.md | Android app rewrite plan |
| TECH-PREVIEW.md | Guide for preview testers: status, sign-up, what the operator can see |
| RUNBOOK.md | Operating vettid.org: deploys, stacks, admin access, relay, DNS, costs |
| logs-analysis.md | Website traffic logs and TLS fingerprints: where they are and how to query them |
| playbooks-design-spec.md | Design of the /playbooks section and the /why page |
| vettid-relay `docs/` | Relay protocol copy and client notes |
| vettid-vault `docs/` | Implementation notes per phase (V2–V4), spec coverage, smoke tests |
