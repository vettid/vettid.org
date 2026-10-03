---
title: PROTEAN-CREDENTIAL
status: design rationale (normative spec is VAULT-MESSAGING §3.5)
version: 0.1.0
date: 2026-10-03
owner: Al Liebl (Mesmer)
related:
  - VAULT-MESSAGING.md (0.7.0): §3.5 Protean Credential, §3.3.1 DEK, §10.6 credential, §10.7 items, §10.13 critical-item use, §11.11 recovery
  - VAULT-ITEMS.md (item sensitivity)
  - VAULT-PLAN.md (D1 release approval)
  - ARCHITECTURE.md
changelog:
  - 0.1.0: ported from vettid-dev `docs/protean_credential_system_design.md`
    and the decision log of `docs/NITRO-ENCLAVE-VAULT-ARCHITECTURE.md`
    §15.1, updated to the current design and to the owner decisions of
    2026-10-03 (one app per vault holding the credential; no export of
    vault data)
classification: public (no secrets; safe for github.com/vettid)
---

# The Protean Credential

This is the owner's design for the **Protean Credential**, and the reasons
behind it. It replaces the vettid.dev design document
(`docs/protean_credential_system_design.md` in the archived vettid-dev
repository, last revised at commit `e87fd20`).

**The normative specification is VAULT-MESSAGING §3.5.** It defines the
formats, messages and checks. This document explains what the credential
is for, why it is built this way, and which parts of the original design
still hold. Where the two disagree, VAULT-MESSAGING wins, except for the
intended model in §4, which VAULT-MESSAGING will be updated to match.

## 1. What it is

The Protean Credential is a small encrypted blob that the **member holds**.
It contains the member's most critical keys and secrets:

- the **credential key**, which signs what the member approves (member
  authentication to connections, LEASH delegations to agents);
- the **item keys** of the member's critical items, such as seed phrases,
  private keys and recovery codes (VAULT-ITEMS §4). The values of those items
  stay in the vault, encrypted under the item keys (envelope encryption).
  The credential holds only the keys, about 90 bytes per item;
- later, the wallet's keys (`crypto_keys`, reserved).

The vault cannot open the credential by itself, and the member cannot open
it outside the vault. Every use needs both.

## 2. Principles

1. **The member holds the critical keys.** They are never part of vault
   state. VettID stores, at most, ciphertext it cannot open.
2. **Consent and participation on every use.** Each operation that opens
   the credential carries the blob **and** the member's credential password,
   for that one operation. There is no standing authorization for critical
   items: a share rule can at most make one *usable* by a connection,
   never readable (VAULT-ITEMS §4); each use is a request that the member
   approves with the password, and the connection receives only the
   result (VAULT-MESSAGING §10.13). Agents never reach critical items
   (§10.11).
3. **Secrets never leave the vault; the vault acts on them.** Signing,
   decrypting or (later) signing a wallet transaction happens inside the
   attested enclave. The result leaves; the key does not. A critical value
   is shown to the member only when they ask for it, sealed to a one-time
   reply key that only the asking app holds.
4. **Every use changes the credential.** The key that seals it (the CEK)
   is replaced after every use, so each copy works once. This is the
   "protean" part.
5. **One app, one credential.** A vault has exactly one app, and it holds
   the credential. See §4.

## 3. How it works today

### 3.1 Two layers

The blob is sealed twice (VAULT-MESSAGING §3.5.2):

- **Outside**, to the vault's current **CEK** (credential encryption key), a
  hybrid post-quantum KEM key (MLKEM768X25519) that only the vault holds.
  A thief of the member's copy cannot guess the password offline, because
  only the enclave can remove this layer.
- **Inside**, under a key derived from the member's **credential password**
  with Argon2id (t = 3, m = 64 MiB, p = 1). The vault, which holds the CEK,
  still cannot read the content without the member.

### 3.2 The CEK rotates on every use

Every successful opening ends with a new CEK and a new blob, version + 1,
and the old CEK is destroyed (VAULT-MESSAGING §3.5.3). Old copies become
undecryptable by anyone, the vault included. The rotation is written
before the request is acknowledged, and the response is cached, so a lost
response never loses the credential.

### 3.3 One-time transaction keys (UTK/LTK)

The critical part of each request (the password, a critical value, a reply
key, the hash of a payload being approved) is sealed to a **single-use
vault key** (a UTK; the vault keeps the private half, the LTK) **inside**
the already end-to-end encrypted session (VAULT-MESSAGING §3.5.4). An
attacker who can read or alter the session still cannot read the password,
replay an operation, or move a payload to another request. Apps hold a pool
of up to 20 UTKs, each good for 30 days.

### 3.4 Unlock window

`credential.unlock` keeps the credential key, and only that key, in the
vault process's memory for a short window (default 5 minutes, at most an
hour), so that a burst of signatures needs one password entry. Item keys
are never kept. The window ends on expiry, on lock, or when the member
closes it. This is the original design's "trust window", narrowed to one
key.

### 3.5 Two secrets: PIN and password

- The **vault PIN** unlocks the vault: it derives the key (DEK) that
  decrypts vault state. It is entered rarely, once per unlock.
- The **credential password** authorizes each critical operation.

Compromising one does not give the other. A thief with the PIN can open
the vault but not use the credential; a thief with the password and no
unlocked vault has nothing to use it on.

### 3.6 Backup: a copy sealed to the vault, inside the service

The vault keeps the latest blob in its own encrypted state (the
`credential.backup` setting, on by default; VAULT-MESSAGING §3.5.6). That
copy is sealed to the vault's current CEK outside and to the password
inside, so it is useless anywhere but in the vault and to anyone but the
member. It exists so that a member who loses their phone can be handed the
credential again through recovery (§3.7).

The backup stays **optional**. With it off, the credential lives only on
the member's phone: there is no off-device copy and no export, so losing
the phone loses the credential and every critical item permanently. The
app warns clearly before the backup is turned off (VAULT-MESSAGING
0.9.0 §3.5.6).

There is **no member backup or export of vault data outside the service**
(owner decision, 2026-10-03). Moving a vault from an old vault to a new one
within the service is a planned future capability (ARCHITECTURE.md,
roadmap), not an export.

### 3.7 Recovery

A member who has lost their app recovers through the account portal
(VAULT-MESSAGING §11.11):

1. They request a recovery while signed in. The vault is locked, the owner's
   devices are told, and the member is emailed a cancel link.
2. **24 hours** pass, during which the request can be cancelled from the
   portal, the email link, or any owner app that unlocks. The vault itself
   mints the recovery code and enforces the delay with its own clock.
3. A new, attested app scans the code, then unlocks with the **PIN** and
   receives the credential only after the **credential password** opens the
   vault's copy. The CEK rotates at that moment, so the copy on the lost
   phone dies. The new app replaces the old one, whose keys are revoked;
   desktops and agents are kept (§4).

With the backup off there is no copy to hand over: the credential and the
critical items are lost, and the recovery can only create a new
credential or delete the vault (VAULT-MESSAGING §11.11.5; an owner
decision to confirm). There is no other recovery of a credential and no
bypass that VettID can operate.

### 3.8 Lifecycle

`credential.create` (a vault has no other use until it exists),
password change, `credential.rotate` (a new credential key, announced to
connections with a statement signed by the old and new keys; the vehicle
for post-quantum signatures in PQC Phase 2), and `credential.delete`
(VAULT-MESSAGING §3.5.5).

## 4. One app per vault: "there can be only one"

**Owner decision, 2026-10-03:** a vault has **exactly one app**, and that
app **is** the Protean Credential holder. Only one credential is usable at
a time, and only by that app.

### 4.1 One app

- No second app can pair with a vault. Pairing (VAULT-MESSAGING §6.7)
  is for desktops and agents only.
- **Desktops and agents are unaffected.** They never hold the credential:
  desktops work in access sessions with step-up approvals on the app, and
  agents act under LEASH grants signed with the credential key by the app.
- The app's own retries are not a second copy. Re-fetching its latest
  version, for example after a crash or a lost response, is normal (the
  cached response and the "keep the latest blob until confirmed" rule,
  VAULT-MESSAGING §3.5.3).

### 4.2 A second copy is a big deal

Any credential presented by another device, or a stale copy (a version
older than the current one, from anywhere other than the app's own
retry), is treated as **theft**, not as a routine refresh. The vault:

1. **refuses** the operation and does not hand the latest blob to the
   presenter;
2. sends an **urgent alert** to the current app;
3. **emails the member**;
4. records it in the **audit log**;
5. **freezes credential operations** until the current app confirms it
   has seen the alert;
6. then **forces a credential rotation**: new credential key, new CEK, new
   item keys, so every other copy is dead.

**Normal messaging keeps working** throughout: the freeze covers
credential operations only, not the vault.

### 4.3 Changing phones

- **New phone, old phone in hand: direct transfer.** The old app shows a
  QR code; the new app scans it; the old app approves with the **PIN and
  the credential password**. The credential moves to the new app, the old
  app is removed, and there is no waiting period.
- **Lost phone: recovery** through the account site with the **24-hour
  wait** (§3.7). The new app receives the current credential and
  **replaces** the old app: the old app is removed and its keys revoked.
  Desktops and agents are kept.

### 4.4 Why

This restores the original design's theft detection (decision #14, §5):
with one copy in circulation, a thief who steals the blob races the
member, and the first use by either side makes the other's copy stale.
That stale or foreign presentation is the signal. If several owner apps
may fetch the latest blob (VAULT-MESSAGING 0.7.0: `credential.get` after
`stale_credential`, §3.5.3, §3.5.5), a stale copy is normal and the signal
is lost.

### 4.5 Status

**VAULT-MESSAGING 0.9.0 specifies this model** (implemented in
vettid-vault together with it):

- **One app.** `device.pair.create{role: "app"}` answers `one_app`; apps
  are bound only at enrollment, by a transfer or by a recovery (§6.7).
  Only the holder fetches the latest blob, and only to recover from its
  own lost response.
- **Clone alarm** (§3.5.9). Every presentation that is not the current
  blob, except the holder's retry with its previous, unconfirmed version,
  is refused (`credential_frozen`) and raises `credential.alarm` to the
  app (urgent), an audit entry, and a content-free host alarm that the
  member API turns into an email. Credential operations stay frozen until
  the app answers `credential.alarm.confirm` ("that was me" or "not me"),
  then until a forced `credential.rotate`; messaging continues.
- **Transfer** (§6.7.1): `device.transfer.create`, `.pending`,
  `.approve` (with the PIN and the password), `.reject`; no wait.
- **Recovery** (§11.11.5): the new app replaces the old one; desktops and
  agents are kept.
- **Backup off survives decision 3** as an option: no off-device copy, no
  export, and losing the phone loses the credential and the critical
  items. A recovery then can only reset the credential or delete the
  vault (an owner decision to confirm). 0.9.0 removed the member-supplied
  blob of earlier drafts.
- **GrapheneOS** is accepted through its pinned verified boot keys
  (§11.7).

## 5. Decision log (carried over)

From the vettid.dev decision log (NITRO-ENCLAVE-VAULT-ARCHITECTURE §15.1,
2026-01-08), with their status in the current design:

| # | Decision | Status now |
|---|---|---|
| 7 | **Two factors: vault PIN for unlock, credential password for operations.** Compromising one does not compromise the other. | **Kept** (§3.5; VAULT-MESSAGING §3.3.1, §3.5.1). |
| 8 | **The PIN is created in the mobile app, never in the web portal.** The app is sandboxed and attested; the web has XSS and extensions. | **Kept.** The vault PIN and the credential password are set in the app during enrollment over the alternate channel (VAULT-MESSAGING §11.3). The account site's sign-in PIN (MEMBER-API) is a separate secret that protects the portal session only. |
| 10 | **CEK / UTK / LTK key model.** The CEK rotates per operation; UTK/LTK are single-use keys for app-to-vault payloads. | **Kept**, now hybrid post-quantum (MLKEM768X25519) and inside the session envelope (§3.2, §3.3). |
| 12 | **Nitro attestation replaces the LAT.** The ledger authentication token gave mutual authentication; hardware attestation is stronger. | **Kept.** Apps verify the enclave's attestation and the vault's pinned identity (VAULT-MESSAGING §11.2, §6.3). |
| 13 | **A wrong PIN fails decryption; there is no PIN hash to compare.** Each guess needs the enclave. | **Kept** for the PIN (`bad_pin`, VAULT-MESSAGING §3.3.1) and applied to the password (`bad_password` when the inner layer fails), both under backoff. |
| 14 | **One credential with CEK rotation is intentional theft detection.** First use invalidates the other copy. | **Restored** by the owner decision of 2026-10-03 (§4). |
| 15 | **The owner's identity is bound into DEK derivation.** Prevents cross-vault confusion. | **Kept** in another form: `vault_id` is in the HKDF info of the DEK, of the password key, and of the credential's HPKE context (VAULT-MESSAGING §3.3.1, §3.5.1, §3.5.2). |

Other parts of the original design and where they went:

- **Device attestation** (Android key attestation, iOS App Attest): kept and
  required for enrollment and unlock (VAULT-MESSAGING §11.7). The original
  allowed GrapheneOS by whitelisting its verified-boot key; the current
  spec requires `verifiedBootState` `Verified`, which GrapheneOS does not
  report (it reports `SelfSigned` with a locked bootloader). Supporting
  GrapheneOS needs a pinned-key allowance in §11.7; it is listed as a
  follow-up in ARCHITECTURE.md.
- **Per-operation policies** (`require_reauth`, `rate_limit`, `max_amount`,
  `allowed_endpoints`):
  - re-authentication is now unconditional for critical items: every use
    needs the password;
  - rate limits exist for agents' grants (VAULT-MESSAGING §10.11);
  - **spend caps** (`max_amount`) are a requirement for the wallet batch
    (VAULT-PLAN, V4 wallet note);
  - endpoint allowlists belong to LEASH's HTTP action, which waits on the
    enclave egress decision (VAULT-MESSAGING §15, item 7).
- **Concurrent-session detection** (row locks in a central ledger, deny and
  alert): replaced by single-writer leases inside the service (VAULT-PLAN
  §5.3) and, for the credential, by one app per vault and the freeze on a
  second copy (§4).

## 6. What was dropped, and why

- **The central ledger** (Postgres tables of users, CEKs, TKs, LATs,
  sessions and alerts). Each vault keeps its own state, encrypted under a
  key derived from the member's PIN, in an enclave release the member
  approved. There is no central place that holds everyone's keys.
- **Key storage in RDS, KMS or CloudHSM.** Keys live only in the vault's
  encrypted state; KMS holds per-release sealing keys whose policies only
  that release can use (VAULT-PLAN D1).
- **Per-action REST endpoints.** Operations are typed messages over the
  relay (VAULT-MESSAGING §10).
- **Per-user EC2 vault deployment.** Shared Nitro hosts run one OS process
  per unlocked vault (VAULT-PLAN D4).
- **X25519-only ECIES.** Every key agreement is hybrid post-quantum
  (PQC-MIGRATION Phase 1); signatures move to Ed25519 + ML-DSA-65 in
  Phase 2.

## 7. What VettID can and cannot do

Summarized from VAULT-MESSAGING §3.5.8 and §13.5:

- VettID never sees the CEK, the LTKs, the password or the credential's
  plaintext. It stores encrypted vault state it cannot open without the
  member's PIN and an approved enclave release.
- An approved release does see the plaintext during an operation the
  member started. That is why releases need the member's approval
  (RELEASE-UPDATES.md): VettID cannot move a vault to code the member has
  not accepted.
- A thief of a stored blob holds a copy that dies at the member's next use.
  Presenting it at all freezes credential operations and alerts the member
  (§4.2), and the password can only be guessed online, under backoff.
