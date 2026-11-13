---
title: VAULT-SERVICE-INDEPENDENCE
status: draft
version: 0.1.0
date: 2026-11-13
owner: Al Liebl (Mesmer)
component: vault manager (enclave), service vault (vettid/service-vault), the vault↔service interface
related:
  - VAULT-MESSAGING.md (0.90.6) §6.3.1, §6.3.2, §10.8, §10.19, §11.10.1, §11.10.8, §11.10.9
  - BALLOT-PROTOCOL.md (0.13.13 in vettid/service-vault `docs/BALLOT-PROTOCOL.md`; not in this repository)
  - VAULT-RELEASES.md (0.1.34) §11.3 (the compatibility matrix for moves)
  - STAGING-TIME-SCALE.md (0.1.8) N16
  - vettid/service-vault `docs/RELEASE-29.md` (0.9.0) §6, §11, §14; `docs/SERVICE-VAULT.md`; `docs/SOURCE.md`; `go.mod`
  - vettid/vettid-vault `vms/altchan/capabilities.go`, `vault/features086.go`, `compat/live-releases.txt`
changelog:
  - 0.1.0: first draft (2026-11-13). Owner decision of 2026-11-13: member vaults and service vaults ship independently.
---

# Vault↔service independence

Status: draft for the lead's review. Nothing here is decided beyond the
owner's one decision in section 1. Everything else is a proposal.
Facts were read on 2026-11-13 from vettid.org master (9105edc),
service-vault master (31dc502) and a depth-50 clone of vettid-vault.
Anything not confirmed is marked **unverified**.

## 1. Goal and scope

**The decision (owner, 2026-11-13).** A member vault and a service vault
must be able to ship independently. There is no release-to-release
syncing between them.

**What it relaxes.** The earlier "no backward compatibility before
users" decision (R29 rebuild plan, 2026-11-06). It is relaxed for the
**vault↔service interface only**.

**In scope.** Everything a member vault and a service vault exchange or
share:

- the connection protocol between them (VAULT-MESSAGING §6, §7, §8, §10);
- the service-specific messages: sign-in and approval challenges
  (§10.4), `profile.update` with `features` (§10.8), the ballot messages
  (§10.19, BALLOT-PROTOCOL §4);
- relay use and tokens (`relay.token.issued`, `relay.token.refresh`);
- trust data the vault pins for the service's documents (the service
  list, anchor keys, Sigstore roots);
- Go code the service vault imports from vettid-vault;
- release and deploy order.

**Out of scope (unchanged).**

- Member↔member connections and device pairing. They keep the
  clean-start approach for now (release 29's "No upgrade", §6.3.1).
- The service vault ↔ application interface (the SDK, signed webhooks).
  It is the service's own API. It is only touched where a vault change
  shows through it (for example the `pre29` reason on
  `connection.removed`).
- Member API, relay and push gateway releases.
- Rules that live entirely inside one vault (lock, unlock, recovery,
  transfer).

## 2. Inventory of today's couplings

Each row says what binds the two sides and where it is written.

### 2.1 Protocol flag days

| # | Coupling | Where |
|---|---|---|
| C1 | **Release 29 ends pre-29 connections.** A vault refuses a state without `messaging_release` 29 or more (`state_unsupported`). The service writes the same marker and, at every start, ends every connection record that lacks it: `connection.removed` to the member, tokens revoked, `connection_pre29_ended`. Members must connect again. | VAULT-MESSAGING §6.3.1 "No upgrade" (0.87.1); service-vault `docs/RELEASE-29.md` §11 |
| C2 | **Deploy order is vault, then service, then re-invite.** The service's four changes are "deployed to staging together, after the fourth", because the rules are partial in between. On staging the deploy needs its own owner go. | `RELEASE-29.md` §11 (last bullet), §14 |
| C3 | **Rollback across release 29 ends every connection first** (`SV_END_ALL_CONNECTIONS`). | `RELEASE-29.md` §11 "A rollback" |
| C4 | **§6.3.1 asks the service to follow the member vault's rules** "on either side as a member vault does". Every change to those rules is a service change, and `RELEASE-29.md` restates each rule for a service ("chosen; not in the spec"). | VAULT-MESSAGING §6.3.1, §6.3.2 (R29-* rule IDs); `RELEASE-29.md` intro, §1–§13 |

### 2.2 Release holds and one-way assumptions

| # | Coupling | Where |
|---|---|---|
| H1 | **GC #8169.** No vault release with vettid-vault #223 until a deployed service vault has sv #137. The vault fails results whose bundle time is before the `closes_at` in force. The service used to publish at its own clock plus a minute, never checking the timestamp authority's time. Nothing on the wire says which side has the fix. | vettid-vault #223 ("Deploy order"); service-vault #137; BALLOT-PROTOCOL §8.3 step 2 (0.13.11, 0.13.12). Memory note "Vault release hold for #223" |
| H2 | **The service's fix must precede the vault's.** The same shape will recur whenever a vault check gets stricter. | same |
| H3 | **A record kept by an older vault release can fail a later parse** (colliding choice labels under the folded-label rule). Accepted as a release note in #223. | vettid-vault #223 "Release note" |

### 2.3 Capability advertising today (what R1 builds on)

- **Service-facing `features`** (§10.8): `vote` (the image registers the vote feature, §11.10.8) and `approval_document` (the image implements §10.4 and the app lists it in `device.features`).
- **Receiving-side capabilities,** sent to every connection: `relay_follow`, `hs_confirm` (§11.10.9; `vms/altchan/capabilities.go`).
- **When sent:** in `profile.update` at activation (§9.3), once at the first unlock under an image that adds a name, and in the inner `features` of every message (§10.8 "On every message").
- **When judged:** on any message that authenticates as the peer and passes `acceptFrom` steps 1–4. The vault keeps `relay_follow` and `hs_confirm` once seen (`vault/features086.go:145`). The service judges `vote` from the last `profile.update` it holds at `record_at` (BALLOT-PROTOCOL §3.2).
- **Gaps:**
  - `hs_confirm` is "advertised only": between vaults §6.3.1 runs both halves always (`RELEASE-29.md` §6).
  - The service advertises `hs_confirm` but not `relay_follow` (its §3.4.2 is later work, GC #9442).
  - No name exists for "results are published only at or after the close" (H1).
  - `features` has no version and cannot say "I need X from you".

### 2.4 Shared code and trust data

| # | Coupling | Where |
|---|---|---|
| S1 | **The service imports vettid-vault `vms/*` at a `main` commit** (`credwire`, `envelope`, `handshake`, `invite`, `peerwire`, `strictjson`, `suite`). Now `v0.0.0-20261112163356-425a5aeaef1b`. `deps_test.go` fails to compile if an API moves. Each bump is its own PR. | `go.mod:18`; `docs/SOURCE.md`; `deps_test.go` |
| S2 | **`docs/SOURCE.md` is stale.** It still pins `eda711ff0a13` (2026-10-30) while `go.mod` has `425a5aea`. Shows the manual pin is not self-checking. | `docs/SOURCE.md:12` vs `go.mod:18` |
| S3 | **`votewire` is pinned to one commit.** PR #158 (open) uses `vms/votewire` at that one commit to verify proposal bundles against **every** supported release's roots. It is "one verifier for every release; nothing here keeps it so". | service-vault #158 "Not covered here" |
| S4 | **Per-release trust roots copied by hand.** #158 adds `internal/vaultroots/roots/<channel>/release-<n>.json`, one copy per supported vault release (staging 25–29, all identical today). A `rootscheck`-tagged test compares each copy with the release tag and the signed manifest. A daily workflow (`vault-roots.yml`, `tools/rootwatch`) compares against Sigstore's current root. | service-vault #158 |
| S5 | **Supported releases are decided by the manifest status** ("registers `vote` and is `active` or `deprecated`, or a candidate"). Support is implied, not announced. | #158 |
| S6 | **Pinned keys in the release constants:** `vote_site_key` and `vote_trust_roots` are in each tagged channel file, so they are measured (PCR0) and change only with a new release. A vault verifies a proposal only under its own release's roots. | VAULT-MESSAGING §11.10.8 (0.81.0, 0.81.3), §10.19.4 |

### 2.5 Wire formats, tokens, relay, ballots, webhooks

| # | Coupling | Where |
|---|---|---|
| W1 | **Strict parsing, no version field on service messages.** `profile.update` and the ballot messages are parsed strictly (§5.3, §10.7). An unknown member is dropped and audited (`drop.profile_malformed`). The vault ignores `features` names it does not read. There is no per-message or per-interface version. | VAULT-MESSAGING §10.8 "Receiving" |
| W2 | **Vault-side feature data is fail-closed across releases.** A state a later release wrote is refused rather than partly read (0.88.17). This is good for security but makes a vault rollback a hard stop. | VAULT-MESSAGING §3.3 (0.88.17) |
| W3 | **Ballot messages and documents are JCS-exact, with domain-separated signatures.** Both sides must agree on bytes. Test vectors are copied by hand: VAULT-MESSAGING §16 holds "the vote vectors of BALLOT-PROTOCOL 0.11.1, copied from service-vault `dc6a4d2`". The BALLOT-PROTOCOL header says the vectors of §16 are unchanged since 0.11.1. | VAULT-MESSAGING §16; BALLOT-PROTOCOL §11; service-vault `vote/testdata/` |
| W4 | **The service list is chained and write-only-grows.** A vault accepts a list only if it chains to the held one. Catch-up needs write-once per-version files on votes.vettid.org. Needs a votes change that VAULT-MESSAGING calls "not made yet". | VAULT-MESSAGING §10.19.4 "The service list"; BALLOT-PROTOCOL §3.3 |
| W5 | **Relay tokens.** The service issues standing and reconnect tokens and re-mints them below 10 and 60 days. The relay client is also pinned by commit (`vettid-relay` `528df9b0`). Token and rekey rules are part of §6.3.1 and §3.4.1. | `RELEASE-29.md`; `go.mod:17`; service-vault `docs/SERVICE-VAULT.md` ("Tokens") |
| W6 | **`relay_follow` gate.** A vault lists `relay_follow` only if it implements both §3.4.1 and §3.4.2 (0.90.0). The service does not yet, so it does not list it. | VAULT-MESSAGING §11.10.9; `RELEASE-29.md` §6 |
| W7 | **Staging time scale.** The vault scales its own waits by `time_scale` on staging. The service has none. N16 sets an approval TTL (`SV_APPROVAL_TTL`, at most 1 h) in the deployment config instead. A release that changes a wait on either side can break the other's test timing. | STAGING-TIME-SCALE N16 |
| W8 | **Webhooks** carry vault-side reasons (`pre29`, `ended_all`, `key_changed`). The webhook contract is the service's own, but a vault change reaches the application through it. | `RELEASE-29.md` §11; `docs/SERVICE-VAULT.md` |
| W9 | **Peer kind.** A service is declared only in the invitation bundle (`peer_kind`), fixed at connect time. A vault that lacks it treats the service as a person. | VAULT-MESSAGING §6.4 "Service connections (0.69.0)" |

### 2.6 Already in place

- `features` is additive. The compatibility matrix (VAULT-RELEASES §11.3, `compat/live-releases.txt`) tests live vault releases but has no service vault row.
- Tags `release/staging/<n>` exist in vettid-vault (29 found); production tags: none seen (**unverified**).

## 3. The rules

### R1. Capability negotiation is the only coupling

- Every behavior change across the interface is gated on a feature the peer advertises. The old behavior stays while the peer lacks it.
- A change that cannot be gated is a flag day and falls under R3.
- **Advertising.** Keep today's mechanism: one `features` list (names `[a-z0-9_]{1,32}`, only ever added) in `profile.update` and in the inner `features` of every message. The **service gets the same duty:** it lists what it does, so a vault can tell. It already lists `hs_confirm`. New example: `results_after_close` (the sv #137 behavior).
- Each name states in its table row whether it describes the sender's behavior or its ability to receive.
- **Judged** at the point of use, per connection, from the last list held. A peer that advertised nothing lacks every feature. Never judge from another connection's list.
- **Withdrawal.** Today the vault keeps `relay_follow` and `hs_confirm` once seen. Keep that for rules that cannot be undone mid-connection. For behavior a service can stop doing (such as `results_after_close`), the next list replaces the held one.
- A registry table in the contract (R4) names each feature, who advertises it, what it gates and the first release of each side that has it.

### R2. A compatibility window

- Each side supports peers from at least the **current and previous release**.
- **Vault release:** a release number in the signed manifest (§11.10.1), status `active` or `deprecated`, as #158 counts it.
- **Service release:** a semver git tag on service-vault. The unit the peer judges is the contract version (R4), not the tag (Q1).
- **Withdrawing support is announced:**
  1. The side posts the date and reason in the contract's support table.
  2. The owner gives a signed go.
  3. One release cycle warns (a feed item or alarm).
  4. Only then does it stop accepting.
- The vault's window is the long one: phones and vaults are the slow side.

### R3. No flag-day endings without an owner go

- No release ends connections, or refuses a peer's state, on its own. The pre-29 sweep (C1) is what this forbids.
- **Instead, an incompatible change rolls out in four steps:**
  1. A new feature name for the new behavior.
  2. Both sides ship it, with the old behavior still the default.
  3. Per connection, the new behavior starts only when both advertise the name, at the next rekey or reconnect, never mid-handshake.
  4. After the window and an owner go, a later release removes the old behavior. A connection that still lacks the name is **held and shown** ("update needed", as `device.update_needed` does), not ended.
- A change that cannot be negotiated (for example a new signature suite) is a planned flag day: owner go, date, notice to members first.
- A service rollback must not need "end every connection first" (C3). An older release ignores names it does not know and never writes a marker that newer code needs.

### R4. A versioned vault↔service contract

- **Where.** Proposal: its own document, `docs/VAULT-SERVICE-CONTRACT.md` in vettid.org. VAULT-MESSAGING is 34,550 lines and the service reads part of it; both repos must pin the contract; BALLOT-PROTOCOL stays in service-vault and is linked. VAULT-MESSAGING keeps the vault's rules. The contract does not restate them.
- **Contents:** the messages and fields each side sends and accepts, the feature table (R1), the support table (R2) and its own version.
- **Version:** semver, separate from both repos' releases. Patch: wording. Minor: a new feature name or optional field. Major: an incompatible change, only through R3. Each release note names the contract version it implements and the oldest peer contract it supports.
- **Shared vectors.** One home for the vectors (proposal: vettid-vault `vms/vectors`, **unverified** as the right place), one file per feature, each naming the features that must be present for it to apply. Today they are copied by hand (W3).
- **CI in both repos** runs the vectors against the other side's supported releases: service-vault CI through the vault packages at each supported vault tag (R5); vettid-vault CI through the service's `vote` and `peer` packages at each supported service tag. This extends the matrix of VAULT-RELEASES §11.3.

### R5. Shared code pinned to vault release tags, not main

- `go.mod` names a **tag**, not a `main` pseudo-version. Go needs semver tags, so vettid-vault would tag `vms` per release (layout: Q3).
- **Who picks:** the service's own release. A bump stays its own PR with the vectors passing. `SOURCE.md` is generated from `go.mod`, so it cannot go stale (S2).
- **Several vault releases at once (votewire).** Go allows one version of a module path per build (**unverified** for this layout). Options:
  - Split `vms` into its own module so versions can be vendored side by side or wrapped by a thin per-release shim.
  - Or run the newest `votewire` and prove in vault CI (R4) that older releases give the same verdict on the shared vectors. A vault release that changes a verdict must add a feature name (R1); the service then picks the verdict by the member's advertised features.
- A vault change that breaks the service's build or vectors fails vault CI before it merges. Today the service finds out at its next bump.

### R6. Trust data read from the signed release manifests

- No hand copies. For each supported vault release the service gets `vote_trust_roots` and `vote_site_key` from a source verified against the signed manifest, and a missing or differing copy **fails the build**.
- **Today:** the manifest (§11.10.1) holds `release`, `pcr0..2`, `seal_key`, `status`, dates and `notes`. It does **not** hold the channel-file constants (**unverified** that another signed file does). #158's test takes the bytes from the release tag and uses the manifest only to vouch for the release.
- **Options (Q4):** (a) a hash of each constants file in the manifest entry; (b) keep reading the tag, generate the embedded copies and commit them by bot PR; (c) the vault publishes the constants, signed, beside the manifest.
- `rootwatch` and `vault-roots.yml` (#158) stay: they catch Sigstore rotating its roots, a different change.

## 4. Migration

### 4.1 The work in flight

- **Vault staging release 30** (the next vault release; it waits for
  vettid-vault #251, owner 2026-11-13). Its service-facing content is
  vettid-vault #223 (H1), whose hold is already met on staging (the
  service there runs `bc82fa2`, which has sv #137). Relay-key rotation
  (#246–#249, #252) ships switched off, and the service does not
  advertise `relay_follow` (W6), so nothing in 30 needs a service
  change. It ships as planned; cards 2 and 3 below replace H1's hold
  for later releases.
- **Service-vault release-29 deploy** (the four changes, then the
  deploy). This is the last planned flag day. It stays as designed
  (C1 to C3), because members already re-enrolled and R3 applies to
  future releases. Two small additions under this note:
  - the service advertises a `features` name for its release-29 rules
    only if a vault needs to tell (none today: `hs_confirm` is already
    advertised both ways);
  - nothing in the deploy is rolled back by ending connections once the
    marker is in (C3 stays as an operator-only step).
- **#158** (open). Merge as written. It is the first copy-by-hand
  mechanism that R6 later replaces. Its supported-release rule (S5)
  becomes the R2 support table. Its "one verifier for every release"
  limit is R5's job.

### 4.2 Hold #8169 becomes a capability check

Today: no vault release with vettid-vault #223 until a deployed service
has sv #137 (H1).

After this note:

- The service advertises `results_after_close` in `features` (sv #137's
  behavior: publish results only after the authority's time reaches the
  close).
- The vault's check in #223 stays, but is relaxed for a service that
  lacks the name: the vault still fails the results (it must, for
  safety), and the app shows "this service publishes results too early",
  not a bare failure. **Unverified:** whether the vault should fail or
  warn. A vault that warns would accept results the vault cannot verify
  as at or after the close, which weakens the check (Q5).
- The hold is lifted when the name is in the contract and both repos
  ship it. After that, a vault release no longer waits for any
  particular service deploy: the worst case is members seeing the
  warning for a service that has not updated.
- GC #8169 can then be closed. The memory entry "Vault release hold for
  #223" is removed when the first vault release ships with the name.

### 4.3 First cards

Each is small and independent.

1. **Contract skeleton.** `docs/VAULT-SERVICE-CONTRACT.md` with the
   feature table (today's names, from §10.8 and §11.10.9), the support
   table and version 1.0.0. No behavior change. (vettid.org)
2. **Service advertises features.** The service's `features` list gains
   `results_after_close`; test that vault ignores it (vault already
   ignores unknown names). (service-vault)
3. **Vault reads it.** `NotePeerFeatures` keeps `results_after_close` and
   the #223 check reports the new reason. (vettid-vault)
4. **Generate `SOURCE.md` from `go.mod`.** Fixes S2. (service-vault)
5. **Shared vectors in one place.** Move the vote vectors out of the
   VAULT-MESSAGING copy; both repos read the same file. (vettid-vault,
   service-vault, vettid.org)
6. **Vault tags for the shared packages.** Decide module layout (Q3),
   tag, and move `go.mod` from a commit to a tag. (vettid-vault,
   service-vault)
7. **Cross-repo CI job.** Each repo runs the other's vectors at the
   other's supported releases. (both)
8. **R6 source decision, then the generator.** After Q4. (vettid-vault,
   service-vault)
9. **Support-withdrawal procedure.** The announcement and owner-go steps
   (R2) as a short section in the contract and the runbook. (vettid.org)

## 5. Risks and open questions for the owner

**Risks**

- Cross-repo CI cost: keep it to the vectors, not full integration.
- A feature name is a promise for the whole window.
- Compatibility can keep a weak behavior alive. A security fix that must remove one is an exception to R2 and goes to the owner.
- Staging has no real members, so a rule tested only there can be wrong in production.
- C4: while member↔member keeps flag days, the service still has to follow them.

**Open questions** (each with a recommendation)

- **Q1. What is a "release" for the service?**
  - (a) A git tag with a semver, plus the contract version.
  - (b) The contract version only.
  - (c) A number in a signed manifest like the vault's.
  - *Recommendation: (a).* The service ships often and has no enclave
    measurement. The contract version is what the other side judges.
- **Q2. §6.3.1 and the service (C4).** The service follows the member
  vault's handshake rules. Next time those rules change:
  - (a) The service gets its own copy of the rules in the contract and
    changes on its own schedule, gated by a feature.
  - (b) The service keeps following the vault's rules, with the vault's
    release as the trigger.
  - *Recommendation: (a),* but only for rules that are not tied to
    member↔member. Keep (b) until the contract has the feature names.
- **Q3. Module layout for shared code (R5).**
  - (a) Keep `vms` in the vault module; add subdirectory tags.
  - (b) Split `vms` into its own module (`vettid-vault/vms` or a new
    repo), tagged per release.
  - (c) Vendor a copy into service-vault.
  - *Recommendation: (b).* It allows one tag per release and several
    versions of `votewire` side by side. (c) repeats the hand-copy
    problem.
- **Q4. How the roots get from the vault release to the service (R6).**
  - (a) A hash of each constants file in the signed manifest entry.
  - (b) Bot PR from the tag, with CI as now.
  - (c) The vault publishes the constants, signed, beside the manifest.
  - *Recommendation: (a).* It makes the manifest the single signed
    source and needs a manifest field (a spec change, version bump).
    (b) is acceptable until then.
- **Q5. #223 for a service without `results_after_close`.**
  - (a) The vault fails the results as now and says why.
  - (b) The vault warns and accepts.
  - (c) The vault holds the proposal's results until the service
    advertises the name.
  - *Recommendation: (a).* It keeps the check, and the member still sees
    a clear reason.
- **Q6. The window's length.** "Current and previous" is a floor.
  - (a) Two releases.
  - (b) Time-based (for example, 90 days) or two releases, whichever is
    longer.
  - *Recommendation: (b).* Vault releases may be rare early on, and a
    count alone could allow a very short window.
- **Q7. Enforcement.** CI fails an interface change with no feature name or contract change?
  - (a) Yes, the vector job plus a checklist item.
  - (b) Reviewer judgment only.
  - *Recommendation: (a).*
- **Q8. Apps.** **Unverified** whether apps are a party to this interface (`device.features` feeds `approval_document`). Check before the contract is final.
- Not checked: production tags and manifest, the votes site's per-version list files (W4), Go's rules for R5's layout.
