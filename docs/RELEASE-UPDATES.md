---
title: RELEASE-UPDATES
status: draft
version: 0.2.0
date: 2026-10-04
owner: Al Liebl (Mesmer)
related:
  - VAULT-PLAN.md (D1 re-sealing per release, D3 reproducible builds)
  - VAULT-MESSAGING.md (0.10.0) §11.10 (normative: manifest, sealing, approval, the move, app behaviour, the key check incl. retirement)
  - VAULT-RELEASES.md (0.1.0) §3 (statuses, cadence, retirement and notices)
  - ARCHITECTURE.md
changelog:
  - 0.2.0: the retirement model (owner decisions of 2026-10-04,
    VAULT-RELEASES R1–R4, O5): releases are kept for 12 months after a
    newer one replaces them, then end after 90 days' notice and emails;
    the release's key is deleted after a 30-day rescue window; members
    who never move lose access; confidentiality never changes. Replaces
    "No deadlines" (§3); §1, §2 and §5 follow; monthly releases
  - 0.1.0: replaces vettid-dev `docs/SECURITY-UPDATES.md`. Member approval
    per D1, no deadlines, declining allowed; the public release log
classification: public (no secrets; safe for github.com/vettid)
---

# Vault release updates

Your vault runs inside an AWS Nitro Enclave. The exact enclave software is
identified by a measurement called **PCR0**. Your vault is sealed so that
only the release you approved can open it. **A new release cannot read
your vault until you approve it.** You decide when to move, within a
long window: each release is kept for at least a year after a newer one
replaces it (§3).

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
  a key policy that can never be changed, by anyone, including VettID and
  the AWS account owner; the key can only be deleted after the release's
  end date (§3, VAULT-PLAN §5.1).

VettID lists every release it runs in a **signed release manifest** at
`https://vettid.org/.well-known/vettid/pcr-manifest.json`. The app pins the
key that signs it.

Builds are **reproducible** (VAULT-PLAN D3): anyone can rebuild an image
from the public vettid-vault source and check that its PCR0 matches the
manifest.

## 2. How approval works

1. VettID publishes a new release, at most once a month plus urgent
   security fixes (months with nothing you would notice are skipped). It
   runs alongside the old ones.
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
4. **Decline, or ignore it**, and nothing changes for now. Your vault stays
   on its release and keeps working until that release's end date (§3).

What the app also does (VAULT-MESSAGING §11.10.6):

- It refuses to send your PIN to a release **older** than the one you last
  used (a rollback) or to a release that is not in the signed manifest.
- If another of your devices approved an update, it tells you that the
  vault software was updated before it asks for your PIN.
- If a release is marked **deprecated** or **retired**, it shows that,
  with the end date once it is set, and offers the newest active release.
  It still unlocks, and you can still move.
- If a release has **ended** (`removed`), your vault can no longer be
  opened in it (§3).
- If a new release repeatedly fails to open your vault right after a
  move, the app can take you back to the previous release, as long as the
  move was not yet confirmed. Otherwise moves are forward only: a fix for
  a bad release ships as a newer release.

## 3. End dates and notices

The vettid.dev design gave members a 72-hour window and then retired the
old enclave automatically. **That is gone.** VettID also does not promise
to run every release forever: each release has a long window, generous
notice, and then an end date (owner decisions of 2026-10-04).

- **12 months.** When a newer release replaces yours, yours becomes
  **deprecated**. It keeps working for 12 months (VettID may announce a
  longer window for a release; the date is in the release log). Old
  releases are started on demand, so your first unlock after a quiet
  period may be slower. A deprecated release is kept working for what you
  need to leave it: unlock, approve a move, lock, recovery. New features
  and fixes go only into newer releases.
- **Notice.** 90 days before the end date the release becomes
  **retired**. The app shows the date at every unlock, and VettID emails
  you 90, 30, 7 and 1 days before it.
- **The end date.** On that day the release stops (it is **removed**) and
  its sealing key is scheduled for deletion. The key is deleted 30 days
  later. Those 30 days are a safety margin, not extra time: if you write
  to VettID in them, it can restart the release once so that you can
  move. After that, a vault still sealed to the release can never be
  opened again, by anyone, and its stored data is erased a week later.
  You would then enroll a new vault.
- **Security fixes.** VettID cannot force an update, not even a security
  fix. The app urges you and the release notes say how urgent an update
  is. For a release with a known, exploited vulnerability VettID may set
  a shorter window, but never shorter than 60 days, with the same
  notices.
- **What never changes: confidentiality.** Nobody, including VettID, can
  open your vault, or move it to another release, without you. An end
  date can only take away access to a vault you never moved; it can never
  give anyone else access to it.

The cost of staying on an old release is real: it keeps that release's
bugs, including unfixed vulnerabilities, until you move. Moving takes one
approval during an ordinary unlock, so the simplest way to keep your
vault is to approve updates when the app offers them.

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
  policy could ever change. The only thing its policy allows besides the
  release itself is deleting the key, with exactly the 30-day window, by
  one fixed VettID role (VAULT-MESSAGING §11.10.7).

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
| Status | `active`, `deprecated`, `retired` or `removed`, with dates, including the end date |

The release notes URL in the manifest points to the entry. The log is
published at `https://vettid.org/security/releases/` and generated from
the signed manifest, so the two cannot disagree; until the first release
it lists nothing. An entry stays after its release has ended.
