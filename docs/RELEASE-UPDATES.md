---
title: RELEASE-UPDATES
status: draft
version: 0.1.0
date: 2026-10-03
owner: Al Liebl (Mesmer)
related:
  - VAULT-PLAN.md (D1 re-sealing per release, D3 reproducible builds)
  - VAULT-MESSAGING.md (0.7.0) §11.10 (normative: manifest, sealing, approval, the move, app behaviour)
  - ARCHITECTURE.md
changelog:
  - 0.1.0: replaces vettid-dev `docs/SECURITY-UPDATES.md`. Member approval
    per D1, no deadlines, declining allowed; the public release log
classification: public (no secrets; safe for github.com/vettid)
---

# Vault release updates

Your vault runs inside an AWS Nitro Enclave. The exact enclave software is
identified by a measurement called **PCR0**. Your vault is sealed so that
only the release you approved can open it. **A new release cannot read
your vault until you approve it**, and you never have to.

This page explains how that works for members, and why. The protocol is
specified in VAULT-MESSAGING §11.10; the decision and its operational
costs are VAULT-PLAN D1.

## 1. What a release is

A **release** is one build of the vault enclave, with:

- a release number (1, 2, 3, …), built into the image so the measurement
  covers it;
- its PCR0 and the other measurements;
- release notes at a public URL;
- its own sealing key, which AWS KMS lets **only that release** use, under
  a key policy that can never be changed by anyone, including VettID and
  the AWS account owner (VAULT-PLAN §5.1).

VettID lists every release it runs in a **signed release manifest** at
`https://vettid.org/.well-known/vettid/pcr-manifest.json`. The app pins the
key that signs it.

Builds are **reproducible** (VAULT-PLAN D3): anyone can rebuild an image
from the public vettid-vault source and check that its PCR0 matches the
manifest.

## 2. How approval works

1. VettID publishes a new release. It runs alongside the old ones.
2. The next time you unlock your vault with your PIN, the app notices the
   newer release in the manifest and offers it. It shows:
   - the release number;
   - a link to the release notes;
   - a fingerprint of the release's PCR0, which you (or anyone) can compare
     with an independent rebuild.
3. **Approve**, and that same unlock carries your approval, signed by your
   phone's hardware-attested key. Inside the current release, after your
   PIN is checked, the vault is re-sealed for the new release, then locked.
   Your next unlock opens it in the new release. Your data is not
   re-encrypted; only the small sealed header that guards it moves.
4. **Decline, or ignore it**, and nothing changes. Your vault stays on its
   release and keeps working.

What the app also does (VAULT-MESSAGING §11.10.6):

- It refuses to send your PIN to a release **older** than the one you last
  used (a rollback) or to a release that is not in the signed manifest.
- If another of your devices approved an update, it tells you that the
  vault software was updated before it asks for your PIN.
- If a release is marked **deprecated** or **retired**, it shows that and
  offers the newest active release. It still unlocks.
- If a new release repeatedly fails to open your vault right after a
  move, the app can take you back to the previous release, as long as the
  move was not yet confirmed. Otherwise moves are forward only: a fix for
  a bad release ships as a newer release.

## 3. No deadlines

The vettid.dev design gave members a 72-hour window and then retired the
old enclave automatically. **That is gone.**

- There is no deadline. No release is switched off while any vault is
  sealed to it; a release with no running instance is started on demand,
  so your first unlock after a quiet period may be slower.
- VettID **cannot** force an update, not even a security fix. The app can
  urge you, and the release notes will say how urgent an update is, but
  the choice is yours.
- The cost of that choice is real: a vault that stays on an old release
  keeps that release's bugs, including unfixed vulnerabilities. VettID
  keeps old releases' images and keys for as long as any vault needs them
  (VAULT-PLAN §7, risk 3).

No deprecation policy of the form "unsupported after N months" exists.
Adding one would be a new owner decision, and even then it could only
change what the app recommends, never which release can open a vault.

## 4. Why it works this way

- **You keep total control of who can read your vault.** A release is
  code that will see your data in memory while it runs. The only way to
  guarantee that VettID cannot slip in code you did not accept is to make
  your approval a cryptographic requirement, enforced by the enclave and
  KMS, not a promise.
- **No migration machinery.** vettid.dev moved vaults with signed migration
  configurations, per-user locks and widened KMS policies, and lost data
  twice doing it. Here a move is one sealed write inside a normal unlock.
- **The enclave checks its own keys.** Before sealing your vault to a
  release's key, the enclave reads that key's policy from KMS and refuses
  any key that something other than the release could use, or whose
  policy could ever change (VAULT-MESSAGING §11.10.7).

## 5. The public release log

VettID keeps a public, human-readable **release log**, one entry per
release, so that members can decide with the facts in front of them. It
starts fresh at the first vettid-vault release; the vettid.dev update log
is not carried over.

Each entry gives:

| Field | Content |
|---|---|
| Release | Number and publication date |
| Measurements | PCR0 (and PCR1, PCR2), as in the signed manifest |
| Source | The vettid-vault tag and commit it was built from, and how to rebuild it |
| Changes | What changed, in plain language: features, fixes, and anything that touches how your data is handled |
| Security | Whether the release fixes a vulnerability, and how urgent updating is |
| Status | `active`, `deprecated` or `retired`, with dates |

The release notes URL in the manifest points to the entry. The log will be
published on vettid.org (a page under `/security/`) and fed from the
signed manifest, so the two cannot disagree; until the first release it
does not exist yet.
