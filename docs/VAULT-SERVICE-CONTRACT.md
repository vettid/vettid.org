---
title: VAULT-SERVICE-CONTRACT
status: draft
version: 1.0.0
date: 2026-11-13
owner: Al Liebl (Mesmer)
component: the vault↔service interface (member vault ↔ service vault)
related:
  - VAULT-SERVICE-INDEPENDENCE.md (0.2.1): the design this contract follows; owner decision of 2026-11-13 and its recommendations (R1–R6, Q1–Q7, 4.2 (i))
  - VAULT-MESSAGING.md (0.90.10) §6.4, §10.1, §10.8, §10.19, §11.10.1, §11.10.8, §11.10.9
  - BALLOT-PROTOCOL.md (vettid/service-vault `docs/BALLOT-PROTOCOL.md`; not in this repository)
changelog:
  - 1.0.0: 2026-11-13, the skeleton (VAULT-SERVICE-INDEPENDENCE 4.3, card 1): the feature table with today's names, the support table, the rules for public documents (service-first), downgrades, withdrawal, the invitation's format and `vote_site_key`, and the contract version on the wire (`contract` in `profile.update`, VAULT-MESSAGING 0.90.10).
---

# Vault↔service contract

A member vault and a service vault ship independently (owner decision,
2026-11-13). This document is what each side may rely on from the
other, and how that changes. It does **not** restate the vault's rules:
VAULT-MESSAGING keeps them, and BALLOT-PROTOCOL keeps the ballot's. It
names the features, the releases each side supports, and the rules for
changing either.

## 1. Version

- This contract has its own version, **major.minor.patch**, separate from
  both repositories' releases.
  - **Patch:** wording only.
  - **Minor:** a new feature name (§3), a new optional field, or an
    additive rule or section.
  - **Major:** an incompatible change. Only through §6 (a planned flag
    day with an owner go).
- **On the wire.** Each side sends the **major.minor** it implements as
  `contract` in every `profile.update` on a service connection
  (VAULT-MESSAGING §10.8, 0.90.10, which gives its form and how it is
  read). It is **informational**: contract 1.0 only records it, for this
  contract's support table (§4). It never selects behavior, never relaxes
  a check (§5.2), and nothing holds or refuses a connection by it;
  holding by it needs a later contract version. The value kept is the
  peer's last claimed one, and may be stale (VAULT-MESSAGING §10.8). An absent value means a peer from before contract 1.0, which
  is supported until a withdrawal is announced (§4). Notices to members
  based on it (when shown, their words) come in a later minor version;
  their texts are the owner's to approve.
- Each release note of either side names the contract version it
  implements and the oldest peer contract version it supports.

## 2. Releases

- **A vault release** is a release number in the signed release manifest
  (VAULT-MESSAGING §11.10.1), on its channel.
- **A service release** is a semver git tag on service-vault, together
  with the contract version it implements (owner decision, Q1 (a)).

## 3. Features

Behavior that changes across the interface is gated on a feature the
peer advertises (VAULT-SERVICE-INDEPENDENCE R1). Each side advertises
its features in `features` (VAULT-MESSAGING §10.8): in `profile.update`
and in the inner `features` of every message (which only ever add). A peer that advertised
nothing lacks every feature. A feature is judged at its point of use,
per connection, from the last list held.

Each name says whether it describes the **sender's behavior** or its
**ability to receive**, and whether it is **sticky** (kept once seen) or
**withdrawable** (read from `profile.update` only, never from the inner
lists, and withdrawn by a later `profile.update` with a higher `version`
that leaves it out).

| Name | Advertised by | Kind | Gates | Sticky or withdrawable | First: VAULT-MESSAGING / vault release / service release |
|---|---|---|---|---|---|
| `vote` | the member vault, to a service connection | ability to receive: the vault takes part in ballots (its image registers the vote feature, VAULT-MESSAGING §11.10.8) | the service's roster of members who can vote (BALLOT-PROTOCOL §3.2; VAULT-MESSAGING §10.19.1) | withdrawable | 0.81.0 / staging release 25 / — (read only) |
| `approval_document` | the member vault, to a service connection | ability to receive: the vault and the member's app can show an approval's document (VAULT-MESSAGING §10.4 "Approval documents", §11.10.9); the app's `device.features` feeds it | which admins the service may send a `document_required` approval (VAULT-MESSAGING §10.4) | withdrawable | 0.89.0 / — (not implemented yet in vettid-vault) / — (read only) |
| `hs_confirm` | both, to every connection | ability to receive: activation on confirmation (VAULT-MESSAGING §6.3.1, §11.10.9) | advertised only: no rule between vaults depends on it (VAULT-MESSAGING §6.3.1 "Capability", 0.87.0) | sticky | 0.86.0 / release 29 / — (no tag yet, §2) |
| `relay_follow` | both, to every connection | ability to receive: VAULT-MESSAGING §3.4.1 and §3.4.2 (RK0); listed only by a side that implements both (VAULT-MESSAGING §11.10.9) | the relay-key gate (VAULT-MESSAGING §3.4.1 "The gate") | sticky | 0.85.4 (0.90.0 for §3.4.2) / — (not listed yet) / — (not listed yet) |

The last column names the first VAULT-MESSAGING version that defines the
name and each side's first release that lists it ("—" until known). A
side lists a name only if it implements it fully. Names a receiver does
not know are ignored (VAULT-MESSAGING §10.8). The other names of
VAULT-MESSAGING §11.10.9 (`recovery_r`, `attachments`, `item_ways`,
`vote_rows`, `transfer_outcome` and the rest) are between a vault and its
devices only, and are left out on purpose.

**Sticky names** are only for abilities to receive that a side never
drops. A service rollback must not drop a sticky name it advertised; if
it must, that is a planned flag day (§6).

## 4. Support

**The window (owner decision, Q6 (b)).** Each side supports peers of the
other side's **current and previous release, and of every release that
was current at any time in the last 90 days**, whatever the release's
status in the manifest (`deprecated` or `retired`; a `removed` vault
release no longer runs). The vault's window is the long one: phones and
vaults are the slow side.

| Side | Supports | Since | Until |
|---|---|---|---|
| vault | services implementing contract 1.x, and services that send no `contract` (before 1.0) | 1.0.0 | (open) |
| service | for its checks of vault trust roots only (service-vault's pre-send check, today's rule): vault releases listed `active` or `deprecated` on its channel, and candidates, and a `retired` release inside the window above. The wire carries no vault release, so a connection is not mapped to one | 1.0.0 | (open) |

**Withdrawing support** is announced:

1. the side posts the date and the reason in this table;
2. the owner gives a signed go;
3. one release cycle warns (a feed item or an alarm);
4. only then does it stop accepting: from a later contract version that
   defines how (contract 1.0 holds and refuses nothing by `contract`), a
   peer that falls out is held and shown ("update needed"), never ended
   (§6).

A security fix may shorten the window with an owner go. It is still
announced, and a peer that falls out is **held and shown** ("update
needed"), not ended (§6).

## 5. Rules

### 5.1 Public documents are service-first

Proposals, extensions, results and rows on votes.vettid.org are one
signed copy for every member, so a feature cannot choose among members.
A change to a public document, and **any stricter vault check of what the
service signs**, is service-first (owner decision, 4.2 (i)):

- the service ships it, meeting the new check and every supported vault
  release;
- then the vault ships its check;
- or it is a planned flag day with an owner go (§6).

A vault pull request that tightens a check of service-signed documents
carries a checklist item naming the service release that meets it. A
vault that meets an older service anyway fails the check as
VAULT-MESSAGING specifies for that check; for the results check
(VAULT-MESSAGING §10.19.6), with a reason derived from the signed
evidence (owner decision, Q5 (a)).

### 5.2 Downgrades

`features` and `contract` are the peer's own claim: authenticated, not
verified. **A vault's check of what the service signs is never gated on,
or relaxed by, the service's features or `contract`.** A feature may only
choose a format (never one weaker than the current minimum) or opt in to
stricter handling. No name relaxes a check that protects the member.

### 5.3 Withdrawal

A withdrawable name (§3) is read from `profile.update` only. It is
withdrawn only by a `profile.update` with a higher `version` that leaves
it out, so a late older message cannot re-add it.

### 5.4 The invitation's format

The invitation and the first message come before any `features`, so they
cannot be negotiated. The service **always issues the oldest supported
format**: today the invitation bundle version 1 and the QR version 2
(VAULT-MESSAGING §6.4). An older vault refuses a newer one (vettid-vault
`vms/invite` matches the versions exactly). A security fix
to the invitation is a planned flag day (§6).

### 5.5 `vote_site_key`

`vote_site_key` is a measured release constant (VAULT-MESSAGING
§11.10.8), and `services.json` carries one signature. It **does not
change while a supported vault release pins it**, and no procedure for
changing it exists yet: a new release pinning a new key could not read
the list under the old one inside the window. A procedure, including one
for a compromise of the key, comes in a later version, with the owner.

## 6. Flag days

No release ends connections, or refuses a peer's state, on its own. A
change that cannot be negotiated (§5.1, §5.4, §5.5, a new signature
suite, a rotation of Sigstore's roots or timestamp authority) is either
service-first or a **planned flag day**: an owner go, a date, and notice
to members first. A negotiable change rolls out by a new feature name,
both sides shipping it with the old behavior still the default, the new
behavior starting per connection when both advertise it, **at the next
rekey or reconnect, never mid-handshake**, and only after the window and
an owner go a release removing the old behavior; a connection that still
lacks the name is held and shown, not ended. A service rollback never
needs to end every connection: an older release ignores names it does
not know and never writes a marker that newer code needs.

## 7. Not yet in this contract

These follow in later minor versions, with their cards
(VAULT-SERVICE-INDEPENDENCE 4.3):

- the messages and fields each side sends and accepts;
- the shared test vectors and their cross-repository check (R4, R5,
  Q7 (a));
- the trust roots read from the signed manifests (R6, Q4), and the
  procedure for a rotation of Sigstore's roots or timestamp authority
  (old and new roots carried by a vault release, the service switching
  last; R3);
- the support notices of §1 and their texts;
- **shared code on a tag (R5, Q3):** service-vault's `go.mod` names a
  vault release tag, not a `main` commit, and changes to `vms` exported
  APIs stay additive within the window;
- **the handshake rules (Q2).** Until this contract names them, the
  service follows the member vault's rules of VAULT-MESSAGING §6.3.1 for
  service connections, with the vault's release as the trigger; then
  (Q2 (a)) it changes on its own schedule, gated by a feature.
- Apps take part through `device.features`, which feeds
  `approval_document` (VAULT-SERVICE-INDEPENDENCE Q8); whether more of
  the apps belong in this contract is open.
