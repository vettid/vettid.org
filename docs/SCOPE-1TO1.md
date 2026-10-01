---
title: SCOPE-1TO1
status: accepted (pending legal review of §5 rationale)
version: 0.1.0
date: 2026-08-21
owner: Al Liebl (Mesmer)
type: architecture decision record
related:
  - CALLING-SERVICE.md
  - PQC-MIGRATION.md
classification: public (no secrets; safe for github.com/vettid)
review-triggers:
  - a group service reference implementation reaches design stage
  - intermediary-liability law materially changes (DSA/OSA/US federal)
  - counsel review of §5 completes
---

# Decision Record: VettID Core Is 1:1

## 1. Decision

VettID's core — credentials, connections, messaging, and calling — is
**one-to-one between identities**. Group messaging and group calling are not
core features and will not be baked into the vault, relay, credential model,
or calling service. Groups are a category of **connected service**: something
a user's vault connects *to*, built *on* VettID, not *in* it.

## 2. The boundary, precisely

The 1:1 boundary is between **identities, not devices.**

- **In scope (core):** one human identity communicating with one human
  identity, across any number of that human's devices. Multi-device fanout
  (phone + desktop + tablet) superficially resembles group mechanics but is
  a property of a single identity and is squarely core work
  (vettid-android, vettid-desktop). Nothing in this record restricts it.
- **Out of scope (core):** any construct where three or more identities
  share a conversation, membership list, or call — including "just small
  family groups."

## 3. Rationale: architecture

1. **Core surface protection.** Group support would touch the credential
   model (group key agreement, e.g. MLS/RFC 9420), relay design (multi-
   recipient fanout vs. one queue per enclave parent), enclave event
   handlers (membership churn, admin semantics), and the calling service
   (SFU). That is broad core-architecture surface for a feature outside the
   identity-and-trust mission.
2. **Metadata posture.** Group membership graphs are the richest metadata in
   any messaging system. Excluding them from VettID infrastructure keeps the
   claim absolute: VettID cannot see who communicates in what constellations.
   A group service holds its own membership state, under its own policies,
   legible to its own users.
3. **Platform proof.** A group service is the flagship reference
   implementation for vettid.cloud ("Build on Trust"): a relying party that
   connects via LEASH-scoped credentials and a service vault. Groups-as-a-
   service dogfoods the platform thesis; groups-in-core would undercut it.

## 4. Rationale considered and rejected (steelman)

- *"Messaging products live or die on the group chat; a separate service
  adds friction competitors don't have."* This assumes VettID competes as a
  messenger. It does not: 1:1 communication is a property of a verified
  connection on an identity platform. Accepting messenger feature-set
  parity as a requirement lets another category define the product.
- *"MLS now exists; groups are tractable."* Tractable is not free (see
  §3.1), and protocol availability does not change the mission boundary. If
  a group service wants MLS, it can adopt it — on its side of the boundary.

## 5. Rationale: legal shape (flagged for counsel)

Working assumption: intermediary-liability and online-safety regimes
generally attach moderation, reporting, and retention obligations to hosted
group content that do not attach to a blind 1:1 transport. Keeping group
content hosting out of VettID keeps VettID in the narrower category.

**Flag:** this is a design intuition, not legal advice. These regimes (DSA,
OSA, and evolving US law) are moving targets. Counsel review is required
before this rationale is stated publicly as a design driver. Until then,
§3 (architecture and metadata) is the public rationale; §5 is internal.

## 6. Consequences

1. **CALLING-SERVICE.md** is TURN-only. The SFU extension path is relocated:
   an SFU is group-call media plane and belongs to a future group service's
   deployment. This sharpens the calling service never-list.
2. Relay deposit types remain single-recipient. No fanout primitives.
3. Credential model remains pairwise. No group key agreement in core.
4. vettid.cloud roadmap gains "group service reference implementation" as a
   named future platform demonstration (horizon item, not commitment).

## 7. Honesty test

This decision must eventually pass a product test, not just an architectural
one: **a group service built on VettID connections must be good, not merely
possible.** If the reference implementation is clunky, "groups are a
service" reads as an excuse rather than an architecture. Recording this
here so future review judges the decision against that bar.
