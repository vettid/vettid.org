---
title: VAULT-SERVICE-INDEPENDENCE
status: draft
version: 0.2.1
date: 2026-11-13
owner: Al Liebl (Mesmer)
component: vault manager (enclave), service vault (vettid/service-vault), the vault↔service interface
related:
  - VAULT-MESSAGING.md (0.90.6) §6.3.1, §6.3.2, §10.8, §10.19, §11.10.1, §11.10.8, §11.10.9
  - BALLOT-PROTOCOL.md (0.13.12 on service-vault master, 0.13.13 only in #158; vettid/service-vault `docs/BALLOT-PROTOCOL.md`; not in this repository)
  - VAULT-RELEASES.md (0.1.35) §11.3 (the compatibility matrix for moves)
  - STAGING-TIME-SCALE.md (0.1.8) N16
  - vettid/service-vault `docs/RELEASE-29.md` (0.9.0) §6, §11, §14; `docs/SERVICE-VAULT.md`; `docs/SOURCE.md`; `go.mod`
  - vettid/vettid-vault `vms/altchan/capabilities.go`, `vault/features086.go`, `compat/live-releases.txt`
changelog:
  - 0.2.1: second review round. No new release-to-release sync in R6, S7 and 4.1 (a copy is needed only when roots or site key differ); `contract` named in the downgrade rule and given a send trigger; withdrawable names read from `profile.update` only; R1 retitled and "never a format weaker than the current minimum"; R2 states the deprecated interaction and Q6 decides it; W10 uses the real bundle versions; rotation procedure names `rootwatch` and leaves the site-key change open; table and quote nits.
  - 0.2.0: blind-review revisions (PR #593). Public documents are service-first (R1, R3); 4.2 rewritten honestly and `results_after_close` dropped; downgrade rule, add-only withdrawal and sticky names (R1); contract version on the wire (R2, R4); security fast path in R2; cross-repo CI and `vms` additivity (R4, R5); new couplings S7, S8, W10 (trust-root PRs, Sigstore and site-key rotation, invitation before `features`); corrections to 2.3, W1, 2.6; Q3, Q4, Q5 rewritten.
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

- **Service-facing `features`** (§10.8): `vote` (the image registers the vote feature, §11.10.8) and `approval_document` (the image implements §10.4 and the app lists it in `device.features`). A service keeps the last list per connection, and a later `profile.update` that leaves either out removes it. These two already work the way R1 wants withdrawal to work.
- **Release capabilities** (§11.10.9; `vms/altchan/capabilities.go`) are the image's list: `recovery_r`, `attachments`, `vote_rows`, `hs_confirm` and so on. That file has **no** `relay_follow`. The vault does not advertise or read `relay_follow` yet (0.90.0 allows it only with §3.4.2).
- **To every connection** the vault sends `hs_confirm`. `NotePeerFeatures` keeps only `hs_confirm` (`vault/features086.go:145`).
- **When sent:** in `profile.update` at activation (§9.3), once at the first unlock under an image that adds a name, and in the inner `features` of every message (§10.8 "On every message"). The inner list is **add-only**: a late message removes nothing.
- **When judged:** on any message that authenticates as the peer and passes `acceptFrom` steps 1–4. The service judges `vote` from the last `profile.update` it holds at `record_at` (BALLOT-PROTOCOL §3.2).
- **Gaps:**
  - `hs_confirm` is "advertised only": between vaults §6.3.1 runs both halves always (`RELEASE-29.md` §6).
  - The service advertises `hs_confirm`, not `relay_follow` (its §3.4.2 is later work, GC #9442).
  - `features` is the peer's own claim: authenticated, not verified.
  - `features` has no version and cannot say "I need X from you". Neither side can tell the other's release or contract version.

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
| W1 | **Strict parsing, no version field on service messages.** `profile.update` and the ballot messages are parsed strictly (§5.3, §10.7). Unknown members and unknown `features` names are ignored (§10.1, §10.8); `drop.profile_malformed` is for a bad core (`first_name`, `last_name`, `ik`). There is no per-message or per-interface version. | VAULT-MESSAGING §10.8 "Receiving" |
| W2 | **Vault-side feature data is fail-closed across releases.** A state a later release wrote is refused rather than partly read (0.88.17). This is good for security but makes a vault rollback a hard stop. | VAULT-MESSAGING §3.3 (0.88.17) |
| W3 | **Ballot messages and documents are JCS-exact, with domain-separated signatures.** Both sides must agree on bytes. Test vectors are copied by hand: VAULT-MESSAGING §16 holds "the vote vectors of BALLOT-PROTOCOL 0.11.1, copied from service-vault `dc6a4d2`". The BALLOT-PROTOCOL header says the vectors of §16 are unchanged since 0.11.1. | VAULT-MESSAGING §16; BALLOT-PROTOCOL §11; service-vault `vote/testdata/` |
| W4 | **The service list is chained and write-only-grows.** A vault accepts a list only if it chains to the held one. Catch-up needs write-once per-version files on votes.vettid.org. Needs a votes change that VAULT-MESSAGING calls "not made yet". | VAULT-MESSAGING §10.19.4 "The service list"; BALLOT-PROTOCOL §3.3 |
| W5 | **Relay tokens.** The service issues standing and reconnect tokens and re-mints them below 10 and 60 days. The relay client is also pinned by commit (`vettid-relay` `528df9b0`). Token and rekey rules are part of §6.3.1 and §3.4.1. | `RELEASE-29.md`; `go.mod:17`; service-vault `docs/SERVICE-VAULT.md` ("Tokens") |
| W6 | **`relay_follow` gate.** A vault lists `relay_follow` only if it implements both §3.4.1 and §3.4.2 (0.90.0). The service does not yet, so it does not list it. | VAULT-MESSAGING §11.10.9; `RELEASE-29.md` §6 |
| W7 | **Staging time scale.** The vault scales its own waits by `time_scale` on staging. The service has none. N16 sets an approval TTL (`SV_APPROVAL_TTL`, at most 1 h) in the deployment config instead. A release that changes a wait on either side can break the other's test timing. | STAGING-TIME-SCALE N16 |
| W8 | **Webhooks** carry vault-side reasons (`pre29`, `ended_all`, `key_changed`). The webhook contract is the service's own, but a vault change reaches the application through it. | `RELEASE-29.md` §11; `docs/SERVICE-VAULT.md` |
| W9 | **Peer kind.** A service is declared only in the invitation bundle (`peer_kind`), fixed at connect time. A vault that lacks it treats the service as a person. | VAULT-MESSAGING §6.4 "Service connections (0.69.0)" |
| W10 | **The invitation and the first message come before any `features`.** The invitation bundle (`vms/invite`) and `peer_kind` (W9) cannot be negotiated: the inviter does not yet know the peer. The bundle has `BundleVersion = 1` and the QR has `QRVersion = 2`, matched exactly, so an older vault refuses a bump. | `vms/invite`; VAULT-MESSAGING §6.4 |
| W11 | **Public documents.** Proposals, extensions, results and rows on votes.vettid.org are one signed copy for every member, so a feature cannot choose among members. A stricter vault check of them (as #223) binds the service to the strictest supported vault release. | BALLOT-PROTOCOL §3.3, §8.3; H1 |

### 2.6 More trust-data couplings

| # | Coupling | Where |
|---|---|---|
| S7 | **A copy per vault release.** With #158 merged, `rootscheck` compares each `release-<n>.json` with the release tag, so a copy cannot exist before the tag and a new release shows a missing copy. A missing copy is benign: the service's pre-send check skips that set and vaults still verify themselves. | #158 (`internal/vaultroots`) |
| S8 | **External rotation is a flag day.** `vote_trust_roots` and `vote_site_key` are measured constants. When Sigstore rotates its Rekor log or timestamp authority, or the site key changes, older vault releases cannot verify new bundles (the proposal stays `checking`, `trust_root`). No procedure exists. | §11.10.8; #158 `rootwatch` only detects it |

### 2.7 Already in place

- `features` is additive. The §11.3 matrix (VAULT-RELEASES, `compat/live-releases.txt`) is **production-only and empty today**, with no service row.
- Tags `release/staging/<n>` exist in vettid-vault (29 found); production tags: none seen (**unverified**).

## 3. The rules

### R1. Capability negotiation for behavior changes

- Every **negotiable** behavior change across the interface is gated on a feature the peer advertises. The old behavior stays while the peer lacks it. What is not negotiable is below (public documents, the invitation, external rotation).
- **Public documents are not negotiated (W11).** A change to a public document, and any stricter vault check of what the service signs, is **service-first**: the service ships it and meets the strictest supported vault release, then the vault ships its check. Or it is a planned flag day with an owner go (R3). A feature cannot gate it.
- **Downgrade rule.** `features` is the peer's own claim. A vault's check of what the service signs is never gated on, or relaxed by, the service's features. Features may only choose formats (never a format weaker than the current minimum) or opt in to stricter handling. A name never relaxes a check that protects the member. The same holds for `contract` (R2): it is informational, drives support notices only, never selects behavior and never relaxes a check.
- **Advertising.** Keep today's mechanism: one `features` list (names `[a-z0-9_]{1,32}`) in `profile.update` and in the inner `features`. The **service gets the same duty** and lists what it does. It already lists `hs_confirm`.
- Each name states in its table row whether it describes the sender's behavior or its ability to receive.
- **Judged** at the point of use, per connection, from the last list held. A peer that advertised nothing lacks every feature.
- **Withdrawal.** Withdrawable names are read from `profile.update` only, never from inner lists (add-only, §10.8), so a late older message cannot re-add a withdrawn name. A higher `version` withdraws one. `vote` and `approval_document` already work so.
- **Sticky names** (kept once seen, as `hs_confirm`) are only for receive capabilities a service never drops. A service rollback must not drop a sticky name it advertised; if it must, that is an R3 flag day.
- A registry table in the contract (R4) names each feature, who advertises it, what it gates and the first release of each side that has it.

### R2. A compatibility window

- Each side supports peers from at least the **current and previous release**.
- **Vault release:** a release number in the signed manifest (§11.10.1) with status `active`, or a candidate. `deprecated` is move-only (§11.10.1): a deprecated release still unlocks and moves. #158 counts it as supported today (S5). Whether it counts here is Q6. **Interaction:** if the previous release goes `deprecated` when the next goes active, the window is one release, and members on a deprecated release stay connected until they move. R2 leaves the choice to Q6.
- **Service release:** a semver git tag on service-vault (Q1).
- **The contract version on the wire.** Today neither side can tell the other's release, so "stop accepting" cannot be enforced by version. Proposal, **recommended:** add `contract` (the contract's major.minor, a string) to `profile.update`, from both sides (the vault sends it only on service connections). Old receivers ignore it (§10.1). It is informational (R1). `profile.update` goes out when the contract version changes, with the next `version`. The alternative is to define withdrawal through features only (a name stops being accepted); it works but cannot say "the peer is too old".
- **Withdrawing support is announced:**
  1. The side posts the date and reason in the contract's support table.
  2. The owner gives a signed go.
  3. One release cycle warns (a feed item or alarm).
  4. Only then does it stop accepting.
- **Security fast path.** A security fix may shorten the window, with an owner go. It still announces, and a peer that falls out is held and shown (R3), not ended.
- The vault's window is the long one: phones and vaults are the slow side.

### R3. No flag-day endings without an owner go

- No release ends connections, or refuses a peer's state, on its own. The pre-29 sweep (C1) is what this forbids.
- **A negotiable change rolls out in four steps:**
  1. A new feature name for the new behavior.
  2. Both sides ship it, with the old behavior still the default.
  3. Per connection, the new behavior starts only when both advertise the name, at the next rekey or reconnect, never mid-handshake.
  4. After the window and an owner go, a later release removes the old behavior. A connection that still lacks the name is **held and shown** ("update needed", as `device.update_needed` does), not ended.
- **Not negotiable, so service-first or a planned flag day with an owner go:**
  - changes to public documents and stricter vault checks of what the service signs (R1);
  - a new signature suite;
  - rotation of Sigstore roots, the timestamp authority or `vote_site_key` (S8). Procedure (proposal): the owner go; a vault release carries old and new roots together (earlier roots stay in the list, BALLOT-PROTOCOL §8.5 "Rekor profile"); the service switches only after every supported vault release holds the new roots, and the owner accepts that out-of-window releases show `checking` (`trust_root`). Sigstore sets the timing. `rootwatch` (#158) compares Sigstore's current root daily and is the only source of lead time we have; how early Sigstore announces a change is **unverified**.
  - **`vote_site_key` is open.** `services.json` has one signature, so a key change cannot be dual-signed, and a vault that pins the old key keeps its last list and ignores a list under the new one (not an error, §10.19.4). Options: never change the key while a supported release pins it (recommended); or an owner-approved flag day. No procedure for a key compromise exists yet.
  - A planned flag day has an owner go, a date and notice to members first.
- **The invitation (W10).** The service **always issues the oldest supported format** (bundle version 1, QR version 2 today), because older vaults refuse a bump. A security fix to the invitation is an R3 flag day.
- A service rollback must not need "end every connection first" (C3). An older release ignores names it does not know and never writes a marker that newer code needs.

### R4. A versioned vault↔service contract

- **Where.** Proposal: its own document, `docs/VAULT-SERVICE-CONTRACT.md` in vettid.org. VAULT-MESSAGING is 34,550 lines and the service reads part of it. BALLOT-PROTOCOL stays in service-vault and is linked. VAULT-MESSAGING keeps the vault's rules. The contract does not restate them.
- **Contents:** the messages and fields each side sends and accepts, the feature table (R1), the support table (R2) and its own version.
- **Version:** semver, separate from both repos' releases, and on the wire (R2). Patch: wording. Minor: a new feature name or optional field. Major: an incompatible change, only through R3. Each release note names the contract version it implements and the oldest peer contract it supports.
- **Shared vectors.** One home (proposal: vettid-vault `vms/vectors`, **unverified**), one file per feature, each naming the features that must be present. Today they are copied by hand (W3).
- **CI.** Each repo runs the vectors against the other side's supported releases. To avoid recreating the coupling, **recommended:** the cross-repo job is **advisory** (reported, not blocking). The blocking jobs are each repo's own tests, plus R5's additive-`vms` rule. The alternative is a blocking cross job, which stops a vault merge for a service problem.

### R5. Shared code pinned to vault release tags, not main

- `go.mod` names a **tag** (Q3), not a `main` pseudo-version.
- **Who picks:** the service's own release. A bump stays its own PR with the vectors passing. `SOURCE.md` is generated from `go.mod` (S2).
- **Additive-only.** Within the window, changes to `vms` exported APIs are additive. A removal or a changed shape waits until the window closes and goes through R2's announcement. This keeps the service building against several tags.
- **Several vault releases (votewire).** Go picks one version per module path per build, so the service cannot link two `votewire` versions. It runs the newest `votewire`, and vault CI proves older releases give the same verdict on the shared vectors. A vault release that changes a verdict is a public-document change (R1: service-first).
- **Cost, stated.** A service fix that needs a `vms` change waits for a vault release (a tag). Mitigation: a candidate tag can be cut for the pin.

### R6. Trust data read from the signed release manifests

- No hand copies. For each supported vault release the service gets `vote_trust_roots` and `vote_site_key` from a source verified against the signed manifest, and a copy that differs from the tag is reported by `rootscheck` (advisory, below).
- **No release-to-release sync (S7).** When release n's `vote_trust_roots` and `vote_site_key` equal a set the service already holds, **no service step is needed**. Only a release whose roots or site key differ needs the service to hold a copy, and that is S8's external flag day anyway.
- **A missing copy is benign:** the pre-send check skips that set, and vaults still verify themselves. A bot PR follows the tag, and `rootscheck` stays advisory. Tagging a vault release never waits on a service step.
- **Today:** the manifest (§11.10.1) holds `release`, `pcr0..2`, `seal_key`, `status`, dates and `notes`. It does **not** hold the channel-file constants. #158's test takes the bytes from the release tag and uses the manifest only to vouch for the release.
- **Option (a), recommended (Q4):** a hash of each constants file in the manifest entry.
  - The service pins the manifest signing keys on its own.
  - Release tooling checks the hash against the PCR0-measured constants.
  - Entries 25–29 are backfilled.
- `rootwatch` and `vault-roots.yml` (#158) stay. They detect Sigstore rotation (S8). The procedure is in R3.

## 4. Migration

### 4.1 The work in flight

- **Vault staging release 30** (the next vault release; it waits for
  vettid-vault #251, owner 2026-11-13). Its service-facing content is
  vettid-vault #223 (H1), whose hold is already met on staging (the
  service there runs `bc82fa2`, which has sv #137). Relay-key rotation
  (#246–#249, #252) ships switched off, and the service does not
  advertise `relay_follow` (W6). **Correction:** tagging release 30 needs no service step: its roots are expected to equal the held set (**unverified** until compared). If they differ, S8 applies. The bot PR for `release-30.json` follows the tag (R6).
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

### 4.2 What this does to hold #8169

It does **not** remove it. #223 is a stricter vault check of a public document (W11), so R1 and R3 apply: it is service-first. The hold was right for that class, and it will recur for each such change. A capability name cannot replace it.

If a vault with #223 meets a service without sv #137 anyway (Q5 (a)):

- the vault records the results check as `failed`;
- it raises a high-priority `vote.problem`;
- at 16 problem records per connection, new proposals from that service are answered `limit` (§10.19.2).

The fact is already in the signed evidence: the bundle's `t_tsa` is before `closes_at`. The vault can derive the reason text ("results were stamped before the close") from that. No `results_after_close` name is needed, and none is proposed.

**What the owner is choosing:**

- (i) Keep the order service-first as a standing rule, with a checklist item on any vault PR that tightens a check of service-signed documents. The hold becomes a rule instead of a case-by-case memory. **Recommended.**
- (ii) Allow the vault first and accept the failures above for members of services not yet updated.

GC #8169 closes when the rule is in the contract and the reason text ships.

### 4.3 First cards

Each is small and independent.

1. **Contract skeleton.** `docs/VAULT-SERVICE-CONTRACT.md` with the feature table (today's names, §10.8 and §11.10.9), the support table, the public-document rule (R1) and version 1.0.0. (vettid.org)
2. **Reason text for an early results bundle.** The vault derives it from `t_tsa` and `closes_at`. No feature name. (vettid-vault)
3. **`contract` field in `profile.update`,** both sides (R2). A spec change, so its own PR first. (vettid.org, then vettid-vault, service-vault)
4. **Generate `SOURCE.md` from `go.mod`.** Fixes S2. (service-vault)
5. **Shared vectors in one place.** Move the vote vectors out of the VAULT-MESSAGING copy; both repos read the same file. (vettid-vault, service-vault, vettid.org)
6. **Vault tags.** Decide the tag scheme (Q3), tag, and move `go.mod` from a commit to a tag. (vettid-vault,
   service-vault)
7. **Advisory cross-repo vector job** (R4) and the additive-`vms` check (R5). (both)
8. **R6 bot PR for `release-<n>.json` after the tag,** then the manifest hash after Q4. (vettid-vault,
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
- **Q3. Tags for shared code (R5).** Go picks one version per module path per build, so a split gives no side-by-side `votewire`, and subdirectory tags would need a nested module.
  - (a) Semver-tag the root module per vault release, and use the newest `votewire` with verdict equivalence proven in vault CI.
  - (b) Vendor a copy into service-vault (repeats the hand-copy problem).
  - *Recommendation: (a).* A tag scheme is needed that fits both staging and production numbering (unverified how: `release/staging/<n>` is not semver).
- **Q4. How the roots get from the vault release to the service (R6).**
  - (a) A hash of each constants file in the signed manifest entry; the service pins the manifest keys; release tooling checks the hash against the PCR0-measured constants; entries 25–29 are backfilled.
  - (b) Bot PR from the tag, with CI as now.
  - *Recommendation: (a).* It needs a manifest field (a spec change). (b) until then.
- **Q5. A vault with #223 meets a service without sv #137.**
  - (a) The vault fails the results as now (`failed`, a high-priority `vote.problem`, `limit` at 16 records) with a clear reason from the evidence.
  - (b) The vault warns and accepts. It weakens the check.
  - *Recommendation: (a),* with 4.2's service-first rule so it rarely happens.
- **Q6. The window's length, and deprecated releases.** If the previous release goes `deprecated` when the next goes active, the window is one release, and members on it stay connected until they move.
  - (a) Count `deprecated` as supported for the service's checks while members remain on it (the window follows the members).
  - (b) Two releases or 90 days, whichever is longer, whatever the status.
  - (c) Active only (a one-release window).
  - *Recommendation: (b).* Vault releases may be rare early on, and a count alone could allow a very short window.
- **Q7. Enforcement.** CI fails an interface change with no feature name or contract change?
  - (a) Yes, the vector job plus a checklist item.
  - (b) Reviewer judgment only.
  - *Recommendation: (a).*
- **Q8. Apps.** **Unverified** whether apps are a party to this interface (`device.features` feeds `approval_document`). Check before the contract is final.
- Not checked: production tags and manifest, the votes site's per-version list files (W4), Go's rules for R5's layout.
