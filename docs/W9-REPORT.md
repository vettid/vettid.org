---
title: W9-REPORT
status: draft (results through 2026-10-05; TBD sections close on 2026-10-06 and 2026-10-12)
version: 0.1.0
date: 2026-10-06
owner: Al Liebl (Mesmer)
related:
  - VAULT-RELEASES.md (0.1.5) §8.8 capacity, §11 testing, §12.1 step 5, §13 W9, §15 O6
  - W10-READINESS.md (0.1.1) P20–P28b, B1, B3, B9, R2, R6
  - RUNBOOK.md "Staging", "Adding a release", "Capacity measurement", "Pausing the vault service", "Retirement"
  - vettid-vault docs/SMOKE.md "Capacity measurement (W9)", docs/RELEASING.md
classification: public (no secrets; vault ids abbreviated to 8 hex digits)
---

# W9: staging stand-up and tests (report)

W9 (VAULT-RELEASES §13) stands up the staging copy in vettid-vault-staging
(347272280361), runs staging releases through the full release pipeline,
tests the vault on real phones, measures capacity for O6 and runs the
retirement drill. VAULT-RELEASES §12.1 step 5 calls these the V5 exit
test; this page is their written record (W10-READINESS B9, R6).

Sources: the merged PRs of vettid/vettid.org, vettid/vettid-vault and
vettid/vettid-android since 2026-09-28, the staging release list
(`vault/releases/staging.json`), the release workflow runs, and the
owner's test session of 2026-10-05. Times are UTC. Sections marked
**TBD** are not done yet.

## 1. Summary

| Area | Result |
|---|---|
| Staging stand-up (part A, CDK) | done 2026-10-04 (#98, #99); test mail #107 |
| Release pipeline end to end, three times (S1, S2, S3) | pass: two CI builds + independent rebuild MATCH, keycheck pass, AMI, self-test PASS |
| Enrollment on real phones (stock Android and GrapheneOS) | pass |
| Lock / unlock | pass |
| S1 → S2 move (deprecated release, member approval) | pass |
| Two members: connect (commit-then-reveal SAS), messaging, declines, `device.pair.rejected` | pass |
| Capacity on S3 (1 vCPU / 5 GiB enclave) | PASS; see §4 |
| Kill switch (vault service pause) | deployed (staging and production); staging pause/resume and phone unlock refusal pass |
| Recovery (24 h wait, code, new phone) | pass; old phone wipe passed after vettid-android #66 |
| S2 → S3 move, manifest serial 4 | **TBD (2026-10-06)** |
| Retirement drill with a vault and notice emails (on S2) | **TBD (2026-10-06)** |
| S1 key deletion confirmed | **TBD (2026-10-12)** |

## 2. Staging releases

| Release | Tag / commit | PCR0 | Status | Evidence |
|---|---|---|---|---|
| S1 | `release/staging/1` | `cbaf7412…b61bf8e5` | **removed** (serial 3, `ends_at` 2026-10-05 15:27); stack deleted; key `9e24fe29…` PendingDeletion until 2026-10-12 ~15:34 | vettid.org #103 (rebuild MATCH), #104 (keycheck pass), #105 (self-test PASS, serial 1), #111 (serial 2: deprecated), #112 (serial 3: removed) |
| S2 | `release/staging/2`, vettid-vault `bf0cc31` | `49cb5aa0…dea8b0e6` | **active** since serial 2 (2026-10-05 14:55) | vettid-vault #28; vettid.org #109 (rebuild MATCH, admits S1), #110 (keycheck pass), #111 (self-test PASS) |
| S3 | `release/staging/3`, vettid-vault `5cd11db` | `80a58002…0f19d289` | **candidate**; serial 4 (S3 active, S2 deprecated) waits for the recovery test | vettid-vault #30; release run 37383081168 (published 2026-10-05 22:42); vettid.org #128 (rebuild MATCH, admits S2), #129 (keycheck pass, policy sha256 `85a574d2…8078`); AMI built; self-test + capacity PASS (§4) |

S3 is the first release built on `ubuntu-26.04-arm` (vettid-vault #35;
both build jobs of run 37383081168). Reproducibility across the runner
change was checked first with dry runs on 24.04 and 26.04 (same PCR0 and
hashes; W10-READINESS P17). S3's host files (`host_files_sha256`
`c0b36aca…`) are the same as S2's, so the enclave size is unchanged
(1 vCPU, 5120 MiB).

S3 contains, over S2: VAULT-MESSAGING 0.10.5 (declines and pairing
rejects sent, vettid-vault #29), the W9 fixes (#31), the capacity
self-test (#32), 0.10.6 (`recovery_registered` marker,
`credential_backup`, #33) and the test fix #34.

## 3. Phone tests (owner session, 2026-10-05)

| Member | Vault | Phone | Path |
|---|---|---|---|
| Test member 1 | `93f722a8…` | Pixel 7, stock Android 17, verified boot green | enrolled on S1, moved S1 → S2 |
| Test member 2 | `88a5240d…` | Pixel 10 Pro, GrapheneOS, verified boot `SelfSigned` | enrolled on S2 |

App: the vettid-android `staging` build type (#53; `com.vettid.app`,
signed with a staging key pinned in `staging.json` `android_signers`).

Passed:

- Enrollment on both phones, including the GrapheneOS `SelfSigned`
  attestation path (VAULT-MESSAGING 0.9.0 allowlist).
- Lock and unlock.
- The S1 → S2 move: S1 `deprecated` (move-only), member approval, unlock
  in S2. S1 then held no vaults, which allowed its removal (#112).
- Connection between the two members with the commit-then-reveal SAS
  (0.10.3), messaging both ways.
- Declines and `device.pair.rejected` (0.10.5; vettid-vault #29,
  vettid-android #55).

## 4. S3 self-test and capacity (2026-10-05)

Run on an S3 host (m7g.large, enclave 1 vCPU / 5 GiB) with
`vault-parent -selftest -capacity N` (RUNBOOK "Capacity measurement";
vettid-vault SMOKE.md). Result: **PASS**, clean teardown.

| Measure | Result |
|---|---|
| Unlock p50, concurrency 1 | 195 ms |
| Unlock p50, concurrency 2 | ~400 ms |
| Unlock p50, concurrency 4 | ~830 ms |
| Latency source | the Argon2id KDF dominates; one vCPU serializes it |
| Vaults held when the fill stopped (`memory_floor`) | 58 |
| Transient memory per unlock | ~76 MiB |
| Steady marginal memory per vault | 4.1 MiB |
| Projected idle vaults per host | ~980 |
| Idle CPU | 0.9 ms per vault per minute |

Reading: the fill stopped at the memory floor at 58 because each unlock
needs about 76 MiB for a moment and the floor rule keeps room for one
more; once unlocked, a vault costs about 4.1 MiB. So for O6 the limit is
**concurrent unlocks** (vCPU for the KDF and transient memory), not
steady memory. SMOKE.md takes `held` (58) as the O6 answer when the run
stops at the memory floor; that is the conservative figure for a burst
of unlocks, and ~980 is the figure for idle unlocked vaults. The O6
decision (W10-READINESS B3) should state which one it sizes for.
VAULT-RELEASES §8.8 still shows the pre-measurement estimate and should
get these numbers.

## 5. Kill switch (vault service pause)

Owner decision 2026-10-05 (W10-READINESS R2). Spec #126 (MEMBER-API
1.2.0), code #127 (member API, admin API and site, alerts), merged
2026-10-05 23:34 and deployed. Staging smoke test (RUNBOOK "Pausing the
vault service", CLI): pause and resume worked, and the
`VaultServicePaused` metric went 1 → 0 on resume.

**Unlock refused on a phone (2026-10-06): pass.** Member 2's vault on the
Pixel 10 Pro was locked from the app (09:55:18 UTC), staging was paused
(09:55:28), and an unlock 66 s later was refused within 6 s with "The
vault service is not available yet. Try again later." Staging was
resumed at 09:56:48 (paused about 80 s) and the next unlock succeeded
(09:57:46). The member API's Vault function log showed no errors and no
"switch unreadable" line. The account site's paused notice was not
checked (it needs a member sign-in). Follow-ups: the app's wording says
"not available yet" for a pause (Android PR replaces it with "paused for
maintenance"); the app showed "cannot connect" once after the phone had
dozed, cleared by one retry.

Production: deployed 2026-10-05; switch parameter absent (service on),
both alarms OK with the security-alerts topic, watch job reports 0. Not
paused in production.

## 6. Recovery test (2026-10-06): pass

Requested for test member 1 on 2026-10-05 15:23 UTC (vault `93f722a8…`
on S2). Code available 2026-10-06 15:23, expires 2026-10-07 15:23.
Target: Pixel 10 Pro Fold, staging build `8f5e962` signed with the
automation key.

- 15:25: the portal's recovery status read `available` with a sealed
  code; opened with the browser key (§11.11.2 ECDH/HKDF/AES-GCM) into a
  32-character code. Secrets went from `local/` to the phone only.
- On the Fold: "I lost my phone" → account sign-in (magic link from
  test mail, pasted; the link did not open the app directly) → "Your
  code is ready" → the code typed (not scanned) → "The code was
  accepted" → PIN → vault unlocked → credential password → "Your vault
  is on this phone now" (15:35).
- The recovered vault showed the existing conversation with member 2.
  Credential version 2 (rotated by the recovery).

Findings, fixed the same day:
- A password manager (Proton Pass) offered to save the credential
  password. vettid-android #65 excludes every secret field (PIN,
  credential password, recovery and transfer codes, sign-in link,
  invitation, delete phrase) from autofill; re-checked on the Fold:
  opening the credential unlock window with the password raised no
  prompt.

### 6.1 Pixel 7 replaced-app wipe: pass after a fix

- First check (build from 2026-10-05, then current master `68bbfc7`):
  **fail**. The old app crashed on every launch with an uncaught
  `relay: 403 token_revoked` (its answer to a vault message queued
  before the recovery was refused by the relay, the exception escaped
  the mailbox collector, and the message was never acked, so the queued
  `device.unlinked{replaced}` behind it was never read).
- Fix: vettid-android #66 (relay errors never kill the app; a refused
  answer is acked and counted; `token_revoked` from the own vault's
  mailbox counts toward the erase offer per §6.7.1; a process-wide
  safety net for network errors).
- Retest with `0aa8fd1` (updated in place, owner's staging key, data
  kept): the app read `device.unlinked{replaced}` and erased VettID's
  own data by itself, then showed the welcome screen. No crash.
- Spec follow-ups (editorial): name `403 token_revoked` as the "refused
  relay key" of §6.7.1; say what an owner device does when its own
  vault's mailbox answers `token_revoked` (§8.6); consider requiring a
  device to ack a vault message even when its answer is refused.

## 7. S2 → S3 move — TBD (2026-10-06)

After the recovery test: publish manifest serial 4 (S3 active, S2
deprecated), deploy `VettidOrgStageSiteStack`, run the staging manifest
sync, then move both test vaults S2 → S3 with member approval and check
unlock, messaging and the 0.10.5/0.10.6 behaviour on S3. (W10-READINESS
B6 also asks for one run of the canary path, a `canary` row and flagged
member with nothing `active`; S3 or S4.) Result: _TBD_.

## 8. Retirement drill — TBD

### 8.1 S1 (no vaults), 2026-10-05

Done (#112): the retirement role was refused a 30-day window and the
admin role was refused outright; the retirement role scheduled deletion
with the pinned 7 days, cancelled it and re-enabled the key, and
keycheck passed again; S1 marked `removed` (serial 3), its stack
deleted, deletion scheduled (7 days). The "unlock after re-enable" step
of VAULT-RELEASES §11.3 could not run, since S1 held no vaults.

### 8.2 S1 key deletion — TBD (2026-10-12)

Confirm key `9e24fe29…` is deleted after 2026-10-12 ~15:34 (read-only
`kms describe-key` as the retirement role; the CloudTrail `DeleteKey`
event). Result: _TBD_.

### 8.3 S2 with a vault and notice emails — TBD (2026-10-06 onward)

Once serial 4 makes S2 deprecated: keep one vault on S2, run the notice
job's emails (staging SES sandbox: verified recipients only), retire S2,
cancel → enable → unlock → reschedule, then delete and confirm `410`.
Result: _TBD_.

## 9. Issues found and fixed during W9

| Issue | Fix |
|---|---|
| `build-eif.sh` overwrote the output directory variable `out` with the release gate's message, failing the first `release/staging/1` build (run 37240475945) | vettid-vault #25: variable renamed; CI now runs build-eif for every complete channel; S1 re-tagged |
| Manifest publish did not create the served file's directory; upload's create-only PUT did not recognise `412`, so a re-run failed | vettid.org #105 (`scripts/vault/manifest.ts`) |
| Self-test procedure: the enclave unit is `PartOf` the parent, so stopping the parent stopped it; it must be started on its own for the self-test | vettid.org #105 (RUNBOOK) |
| Parent restarted within 60 s of a clean stop could not recreate its SQS queue (`QueueDeletedRecently`) and restart-looped | vettid.org #105 (RUNBOOK 60 s wait); vettid-vault #31 (parent retries up to 90 s) |
| App lock left the vault row `unlocked` (lifecycle `locked` dropped before the channel closed) | vettid-vault #31 (flush before close; lease release writes `locked`); MEMBER-API 1.1.0 reports `unlocked` only under a live lease (#116, #117) |
| A normal lock was logged at WARN | vettid-vault #31 |
| devstack lost events a peer received during its own request | vettid-vault #27 |
| Flaky parent test (raced a log line) failed CI once on the S3 PR | vettid-vault #34 |
| Recovery pages and 0.10.5 code exposed gaps: no `registered` state, cancel results, lock state, `credential_backup` | VAULT-MESSAGING 0.10.6, MEMBER-API 1.1.0 (#116); #117; vettid-vault #33; vettid-android #61 |
| ZXing's single-code reader misses some valid recovery QR codes (certain versions and scales) | vettid-android #61 (fallback to `QRCodeMultiReader`; tests for versions 1–40 at M, Q, H) |
| A phone replaced while offline, or while the vault stayed unlocked, never learned it was replaced | vettid-android #57 (wipe on `device.unlinked`), #58 (manual erase on an unrecognised unlock), #61 (refusal watch) |
| No operator off switch for the vault routes after publication (W10-READINESS R2) | MEMBER-API 1.2.0 (#126), #127 |

## 10. Spec changes driven by W9

| Spec | Version | PR | What |
|---|---|---|---|
| VAULT-MESSAGING | 0.10.1 | #96 | vault PIN 6–32 digits |
| | 0.10.2 | #101 | connection requests (SAS both sides, `exists`, request list, invite URL), from the Android A4 build |
| | 0.10.3 | #102 | commit-then-reveal SAS |
| | 0.10.4 | #106 | what the vault implementation of 0.10.3 settled |
| | 0.10.5 | #108 | declines and pairing rejects are sent |
| | 0.10.6 | #116 | recovery `registered` marker, cancel results, lock state, `credential_backup`, QR parameters, 60 s transfer wait |
| | 0.10.7 | #120 | editorial: `credential_backup` in §11.4, recovery vector |
| | 0.10.8 | #123 | editorial: replaced-phone erase (§6.7.1) |
| | 0.11.0 | #122 (open, on hold) | enrollment codes; app and portal separate (S4) |
| | 0.12.0 | #133 | LEASH delegation and status statement in the paper's §3.5 format (not from staging; vault #38 merged, rides with S4) |
| | 0.13.0 | #135 | daily owner check and the held state (owner decision 2026-10-05/06; code not started, S4) |
| RELAY-PROTOCOL | 0.6.0 | #113, #115 | web endpoints `/connect` and `assetlinks.json` for invitation links |
| MEMBER-API | 1.1.0 | #116, #117 | registered recoveries, cancel results, lock state |
| | 1.2.0 | #126, #127 | vault service pause |

## 11. Open items before production

The production checklist is [W10-READINESS.md](W10-READINESS.md). From
W9 specifically:

- Close the TBD sections above (recovery, Pixel 7 wipe, S2 → S3,
  retirement drill with notices, S1 key deletion, kill-switch phone
  check) and update this page.
- O6 decision from §4 (B3), before the release-1 tag; update
  VAULT-RELEASES §8.8.
- Canary path never exercised (P28a, B6); app support for an unpublished
  canary manifest (P31, B5).
- Negative tests of VAULT-RELEASES §12.1 step 5 not recorded (P28b):
  debug-mode enclave refused by KMS; a release refused before approval.
- S4: #122 enrollment codes and #135 daily owner check implemented
  together (vettid-vault, member API and portal, Android), proven on a
  staging release (B2).
- W10-READINESS P26 says the cancel → enable cycle is not done; #112
  records it as done for S1 (without the unlock); align it.
