---
title: W10-READINESS
status: living checklist (update as items close; not a plan)
version: 0.1.3
date: 2026-10-06
owner: Al Liebl (Mesmer)
related:
  - VAULT-RELEASES.md (0.1.6) §10.1 release steps, §12 first deployment, §13 W9/W10, §15 O1–O10
  - RUNBOOK.md "Vault", "Adding a release", "Publishing a manifest", "Canary routing", "Canary manifest on the test phone", "Staging", "Security alerts", "Production drift"
  - VAULT-MESSAGING.md (0.15.0) §11.10 release updates, §13.9 canary manifest, §11.12 enrollment codes
  - MEMBER-API.md (2.0.0), ENROLLMENT-CODES.md (0.2.1), ANDROID-PLAN.md
  - vettid-vault docs/RELEASING.md, docs/SMOKE.md
changelog:
  - 0.1.0: first readiness review for production release 1 (W10), state
    as of 2026-10-05 21:40 UTC (read-only AWS checks in the management
    account, vettid-vault-prod and vettid-vault-staging)
  - 0.1.1: the §4.2 inconsistencies fixed in the documents they name;
    staging release names: S3 = the W9 release, S4 = the 0.11.0 release
  - 0.1.2: P31/B5 done (vettid-android #63; VAULT-RELEASES 0.1.6 §10.1,
    VAULT-MESSAGING 0.14.0 §11.10.1 and §13.9, RUNBOOK "Canary manifest on
    the test phone"); I18 resolved; B6 still open
  - 0.1.3: #122 approved 2026-10-06 and merged as VAULT-MESSAGING 0.15.0
    and MEMBER-API 2.0.0 (drafted as 0.11.0; renumbered after 0.14.0 and
    the kill switch, MEMBER-API 1.2.0): P19a, B2, B6, I12; staging
    release S4 is the 0.15.0 release
classification: public (no secrets; safe for github.com/vettid)
---

# Production release 1: readiness checklist (W10)

VAULT-RELEASES is the approved plan for how releases work. This page is
the opposite kind of document: a dated status board for one event,
production vault release 1, which changes daily until the release is out
and is then finished. It is kept separate so that the approved plan's
version history does not churn with status updates. Once release 1 is
published, the durable parts (the release-day steps that apply to every
release) move into RUNBOOK "Vault" (a W10 deliverable, VAULT-RELEASES
§12.1 step 8) and this page is marked historical.

Legend: **done** (with evidence), **pending** (work or waiting time
remains, nobody is blocked), **blocked** (waits on a named owner action or
dependency), **on hold** (deliberately paused by the owner).

## 1. Status

### 1.1 Decisions, keys and configuration

| # | Prerequisite | Status | Evidence / what remains |
|---|---|---|---|
| P1 | Owner decisions O1–O10 | **done** | Accepted 2026-10-04 (VAULT-RELEASES §15). O6 (instance size) is to be revisited after the capacity measurement (P20). |
| P2 | Manifest key A (KMS `ECC_NIST_P256`, `SIGN_VERIFY`, vettid-vault-prod) | **done** | `alias/vettid-org-vault-manifest` → key `5197fbf9…`, Enabled, created 2026-10-04 (read-only `kms describe-key`). key_id `4353463f85c4012f`, pinned in `lib/config.ts`. |
| P3 | Manifest key B (offline YubiKey, PIV slot 9c, P-256) pinned | **done** | key_id `1abd49da96970b6e`, generated on the token 2026-10-04; pinned in `lib/config.ts` (#100, merged 2026-10-04 22:40), in vettid-vault `enclave/releasecfg/prod.json` and in the app (vettid-android #52). |
| P4 | Manifest-signer role `vettid-org-vault-manifest-signer` | **done** | Exists in vettid-vault-prod (created 2026-10-04 16:29); SSM `/vettid-org/prod/vault/manifest-signer-role-arn`. |
| P5 | Owner's CLI profiles for the prod signer and retirement roles | **blocked (owner)** | `~/.aws/config` has `vault-staging-key-retirement` and `vault-staging-manifest-signer` only. Add the prod pair before release day (RUNBOOK "Accounts and profiles" / "Publishing a manifest"; note the profile-name mismatch in §4, I3). |
| P6 | Tag-signing key registered on GitHub | **done** | The release workflow's gate refuses unverified tags; `release/staging/1` and `/2` passed it (2026-10-04/05). |
| P7 | `releasecfg/prod.json`: account, retirement principal and window, manifest keys, relay URL | **done** | `go run ./cmd/releasecfg check prod` (vettid-vault `721c3ad`, read-only) reports only `release, android_signers` missing. |
| P8 | `releasecfg/prod.json`: Android **upload** certificate digest | **done** | `31a19613…8e65`, pinned by vettid-vault #20. |
| P9 | `releasecfg/prod.json`: **Play app-signing** certificate digest (O8) | **on hold (owner)** | Still `TODO-O8: …`; the release gate refuses a prod build until it is set. Waits for the Play Console setup, which the owner has put on hold. |
| P10 | `releasecfg/prod.json`: `release: 1` | **pending** | Set in the release commit (§3, step 1); release 0 is a deliberate placeholder. |
| P11 | Enclave size fixed for release 1 (O6) | **pending (P20)** | The allocator size (1 vCPU, 5120 MiB) is in vettid-vault `deploy/host/` at the release commit and pinned by `host_files_sha256`, so it cannot change for release 1 after the tag. Decide O6 before tagging. |

### 1.2 Production infrastructure (vettid-vault-prod 369484479783)

| # | Prerequisite | Status | Evidence / what remains |
|---|---|---|---|
| P12 | `VettidOrgVaultStack` (tables, data bucket, fixed roles, key A, release-key creator) | **done** | UPDATE_COMPLETE 2026-10-04 18:21, termination protection on; roles `vettid-org-vault-host`, `-key-retirement`, `-release-key-creator`, `-image-builder` exist; 22 SSM refs under `/vettid-org/prod/vault/`; `vettid-org-vault-releases` and `vettid-org-vaults` empty; data bucket empty. |
| P13 | `VettidOrgVaultHostStack` (VPC, DNS Firewall, scaler, manifest sync with keys A+B, alarms) | **done** | UPDATE_COMPLETE 2026-10-04 22:40 (after #100); Image Builder service-linked role present; SNS `vettid-org-vault-alerts` email subscription **confirmed**. No release groups yet. |
| P14 | Vault OU SCP `vettid-vault-key-protection` | **done** | Attached to OU `ou-kuf0-plfg393o` (Workloads/Vault). Workloads OU carries `vettid-workloads-baseline`, `-deny-root`, `vettid-alert-forwarder-protection`. |
| P15 | Security alerts for the member accounts | **done** | #119 merged 2026-10-05 18:03; `VettidOrgVaultAlertForwardStack` deployed in vault-prod (18:09) and vault-staging (18:08); `VettidOrgAuditStack` updated 18:04. |
| P16 | Daily production drift check | **done** | #118 merged 2026-10-05; `VettidOrgCiReadOnlyStack` and `VettidOrgVaultCiReadOnlyStack` deployed; run 37355100189 (2026-10-05 18:19, manual) **green**: every production stack equals master, including the vault stacks. The first scheduled run is 2026-10-06 13:23 UTC. |
| P17 | Ubuntu 26.04 CI | **done** | vettid.org #121, vettid-vault #35, vettid-android #59 (all 2026-10-05). Reproducibility across the runner change confirmed: the `staging` dry runs on `ubuntu-24.04-arm` (main, run 37371921288) and `ubuntu-26.04-arm` (run 37371927341) produced the same PCR0 `e15d835d…`, enclave binary `de899a49…`, parent `ae27dbf7…` and measured-EIF hash `23d3f7f3…`. drift.yml has not yet run on 26.04 (first scheduled run 2026-10-06). |

### 1.3 Member API and account portal (production, management account)

| # | Prerequisite | Status | Evidence / what remains |
|---|---|---|---|
| P18 | Member API vault routes, dark in production | **done** | `VettidOrgMemberApiStack` updated 2026-10-05 18:35 (#117, MEMBER-API 1.1.0); with no `active` release `GET /api/vault/enclave` answers `503 vault_unavailable` (MEMBER-API "Dark launch"). There is no separate switch: the routes light up when the manifest sync writes an `active` row (§3 step 12). Production manifest URL answers 404 (checked 2026-10-05). |
| P19 | Account portal: vault tab, recovery request/QR page, cancel link | **done** | #114 (vault tab and recovery) and #117 (registered recoveries, cancel results, lock state); `VettidOrgAccountSiteStack` updated 2026-10-05 18:33 in prod and 18:32 in staging. (An earlier note that the portal had no recovery UI is out of date.) `androidAppUrl` is still unset (P29). |
| P19a | Enrollment-code redesign (#122: VAULT-MESSAGING 0.15.0, MEMBER-API 2.0.0) | **spec approved 2026-10-06 and merged; implementation next; must land before release 1** | Spec drafted as 0.11.0 and renumbered at merge (0.12.0–0.14.0 and MEMBER-API 1.2.0 landed first). It changes the enroll wire format (app key in enroll and register, `X-VettID-App` request signing, account snapshot in unlock), which release 1 freezes for at least a year (VAULT-RELEASES §14 risk 2). So: spec merged (done) → vettid-vault 0.15.0 → member API + portal → Android → staging release S4 on 0.15.0 → only then the release-1 tag. |

### 1.4 Staging proof (W9, vettid-vault-staging 347272280361)

| # | Feature | Status | Evidence |
|---|---|---|---|
| P20 | Capacity measurement (→ O6) | **pending (needs S3)** | `vault-parent -selftest -capacity N` landed in vettid-vault #32 (`fe84231`), after S2's commit `bf0cc31`; the self-test runs the release's own image, so the measurement needs a staging release containing it (S3). |
| P21 | Release pipeline end to end (tag, two builds, independent rebuild, key, keycheck, AMI, self-test, sign, publish) | **done** | S1: #103 (rebuild MATCH), #104 (keycheck pass), #105 (self-test PASS, serial 1), 2026-10-04/05. S2: #109 (rebuild MATCH), #110 (keycheck pass), #111 (self-test PASS, serial 2), 2026-10-05. |
| P22 | Enrollment on real phones, incl. GrapheneOS (`SelfSigned` boot key) and stock Android | **done** | Owner's W9 session 2026-10-05 (two test members, one per phone). Not yet written up in the repository (§4, R6). |
| P23 | Lock / unlock | **done** | Same session. |
| P24 | S1 → S2 move (deprecated release, member approval) | **done** | Same session; manifest serial 2 (#111) made S1 `deprecated`. |
| P25 | Two-phone connect, commit-then-reveal SAS, messaging both ways | **done** | Same session (VAULT-MESSAGING 0.10.2–0.10.4 on S2). |
| P26 | Retirement drill (VAULT-RELEASES §11.3) | **partly done** | S1 `removed` (#112, serial 3), its stack deleted, its key **PendingDeletion until 2026-10-12 15:34 UTC** (read-only check as the retirement role). Not yet done: confirm deletion after 2026-10-12; the cancel → enable → unlock → reschedule cycle; a drill with a vault still on the retiring release and the notice emails (planned on S2 once S3 makes it deprecated). |
| P27 | Recovery test (lost phone, 24 h wait, QR, new phone) | **pending** | Requested 2026-10-05 15:23 UTC for test member 1; code available 2026-10-06 15:23 UTC, expires 2026-10-07 15:23 UTC; target is a third test phone. |
| P28 | S3 (vettid-vault ≥ `ca10a72`: 0.10.5 declines, 0.10.6 recovery marker, capacity self-test; vettid-android #55) | **blocked (owner tag)** | Needs the owner's signed tag `release/staging/3`. #122's re-enrollment on 0.15.0 is S4, not S3 (I12). |
| P28a | Canary routing (a `canary` row, flagged member, no `active` release) | **not yet exercised** | Staging S1 and S2 were published directly; the release-1 canary path (MEMBER-API "Canary releases": enrollment into the newest canary release while nothing is `active`) has only unit tests. Exercise it with S3 (§2, B6). |
| P28b | Negative tests of VAULT-RELEASES §12.1 step 5 (debug-mode enclave refused by KMS; S2 refused before approval; keycheck refuses a variant key) | **not recorded** | The keycheck variants are covered by fixtures (vettid-vault, `test/vault-keypolicy.test.ts`); no staging record of the other two. |

### 1.5 Android and push

| # | Prerequisite | Status | Evidence / what remains |
|---|---|---|---|
| P29 | Android release build signed with the upload key (direct install) | **pending** | `:app:assembleRelease` is built unsigned in CI; release builds are signed outside the repository (vettid-android README). The upload digest is pinned (P8), so a direct build signed with the upload key can enroll into release 1 once it exists. |
| P30 | Play app signing and a Play track (closed testing) | **on hold (owner)** | Gives the P9 digest and the `androidAppUrl` link (RUNBOOK "The Android app link"). |
| P31 | App support for an unpublished canary manifest | **done** (2026-10-06; not yet run on a phone) | vettid-android #63 (`da72029`): the tester shares the signed `served-<s>.json` to the app, which verifies it under the build's pinned keys, shows serial, key and releases and installs it on confirmation; it is used while newer than the published manifest, also on a 404 (release 1), and dropped on publication. Spec: VAULT-RELEASES 0.1.6 §10.1, VAULT-MESSAGING 0.14.0 §11.10.1, §13.9 (accepted risk). Procedure: RUNBOOK "Canary manifest on the test phone". First end-to-end run is B6. |
| P32 | Push gateway (FCM, UnifiedPush) | **deferred, not blocking** | No FCM credentials (on hold with Play). ANDROID-PLAN §7: v1 collects while the app is open and through the foreground-service path. |

## 2. Blockers

Everything that must close before step 1 of §3. "Owner" = an action only
the owner can take; "engineering" = an agent or developer can do it once
unblocked.

| # | Blocker | Unblocked by | Kind |
|---|---|---|---|
| B1 | W9 staging tests finish: recovery (P27, code from 2026-10-06 15:23 UTC), S3 (P28), capacity (P20), retirement drill (P26, key deletion 2026-10-12) | owner signs `release/staging/3`; then engineering runs the tests; wall-clock waits | owner + engineering |
| B2 | Enrollment-code redesign (#122) approved, implemented in all three repos, proven on a staging release | approved 2026-10-06 (merged as VAULT-MESSAGING 0.15.0, MEMBER-API 2.0.0); implementation next: engineering (estimate in #122: about 11–16 days), proven on staging release S4 | engineering |
| B3 | O6 instance and enclave size confirmed from the capacity result | owner decision after P20; engineering changes `deploy/host/allocator.yaml` and `VAULT_HOST_INSTANCE_TYPE` if needed **before** the release-1 tag | owner + engineering |
| B4 | Play app-signing digest (O8) in `releasecfg/prod.json` | owner sets up Play App Signing (on hold); engineering pins the digest in vettid-vault (and the app's own pins if any) | owner |
| B5 | ~~Canary manifest on the test phone (P31)~~ **done** 2026-10-06 | app: vettid-android #63; spec: VAULT-RELEASES 0.1.6 §10.1, VAULT-MESSAGING 0.14.0 §11.10.1, §13.9; RUNBOOK "Canary manifest on the test phone". Exercised on a phone only by B6. | — |
| B6 | The canary path itself never ran (P28a) | engineering: run S3 (or S4, the 0.15.0 staging release) through the canary procedure (row + flag, nothing `active`) before publishing it, with the canary manifest loaded on a staging build (RUNBOOK "Canary manifest on the test phone"; the staging channel has a published manifest, so this exercises "canary newer than published", not the release-1 404 case) | engineering |
| B7 | Prod CLI profiles for the signer and retirement roles (P5) | owner edits `~/.aws/config` | owner |
| B8 | A signed Android build for the canary phone (P29): direct build signed with the upload key | owner (the upload key never leaves the owner's machine) | owner |
| B9 | W9 results written up (enrollment, moves, messaging, recovery, drill, capacity) as the V5 exit-test record (VAULT-RELEASES §12.1 step 5) | engineering, after B1 | engineering |

Not blocking release 1, but blocking **first members** (§3 step 14): a
way for members to get the app (P30, or a direct-download page for named
testers) and `androidAppUrl` set.

## 3. Release-day runbook

Release 1 is the canary release of an empty production: no member can be
affected until step 12, so the sequence favours stopping early. Steps
follow VAULT-RELEASES §10.1 (numbers in brackets); commands are in the
referenced RUNBOOK and vettid-vault RELEASING sections and are not
repeated here. Every vettid.org change goes through a PR and is deployed
**from master** right after its merge (the daily drift check flags
anything merged and not deployed, or deployed and not merged). Rollback
per step follows VAULT-RELEASES §12.3; the rule throughout: before a
member is on release 1, retire it at once and ship release 2.

Before starting: §2 is empty; `aws sso login` (default, vault-prod);
`free -g` shows room for builds; S3 (or S4, the 0.15.0 staging release)
is built from the same source as the release commit except the channel
files.

| Step | What | Verify | Rollback |
|---|---|---|---|
| 1 [1] | **Release commit** (vettid-vault): `enclave/releasecfg/prod.json` `release: 1` and the Play digest replacing `TODO-O8`; review; merge. | `go run ./cmd/releasecfg check prod` exits 0; CI green. | Revert the PR. Nothing exists yet. |
| 2 [1] | **Owner signs the tag**: `git tag -s release/prod/1 -m "Vault production release 1"`, push (RELEASING "A release, step by step" 1). | GitHub shows the tag *Verified*. | Until step 6 nothing references release 1: delete the tag and any draft release, fix, re-tag (owner's call). |
| 3 [2] | **Release workflow** runs on the tag: gate, two arm64 builds, compare, attest, draft release. | All jobs green; `measurements.json` says `channel: prod`, `release: 1`; note PCR0. | Delete the draft release; as step 2. |
| 4 [3] | **Independent rebuild** by the owner on a separate arm64 machine (RELEASING "Rebuild and match"); then publish the draft GitHub release. | `eifinfo match`/`compare` MATCH: same PCR0–2, binaries, measured sections. | Mismatch: stop, do not publish; investigate (toolchain lock, runner image). |
| 5 [5] | **Release entry PR** (vettid.org): release 1 in `vault/releases/prod.json`, `status: candidate`, PCR0–2, `seal_key: ""`, `admitted_pcr0s: []` (no earlier release), `notes: https://vettid.org/security/releases/1/`, `log`, and `host` with `min_instances: 0`, `max_instances: 2` (RUNBOOK "Adding a release" 1–2, "Creating a release key"). | `npm test`, `npm run check:manifest`; `npx cdk diff VettidOrgVaultStack --profile vault-prod` shows exactly one `Custom::VettidReleaseKey` and its SSM parameter, policy of the §11.10.7 shape with the 30-day window. | Revert the PR (no key yet). |
| 6 [6] | **Release key**: deploy `VettidOrgVaultStack` (prod) from master; read the ARN from SSM `…/vault/releases/1/seal-key-arn`; PR with `seal_key`; **keycheck** as the retirement role against the draft manifest, `-record keycheck/1` (RUNBOOK "Creating a release key" 2–4). | Deploy succeeds (the custom resource re-checks the policy); keycheck exits 0; VaultStack diff after the `seal_key` PR is empty. | The key is immutable and permanent. If keycheck fails: release 1 → `removed` (no `host`), schedule the key's deletion as the retirement role with the pinned 30 days (RUNBOOK "Retirement"), ship release 2. |
| 7 [7] | **Host + release stacks (AMI)**: `npx cdk diff VettidOrgVaultHostStack VettidOrgVaultRelease1Stack --profile vault-prod` (host: only the smoke key gains PCR0; release stack new), deploy both (RUNBOOK "Adding a release" 4). Image build 20–40 min. | Stack CREATE_COMPLETE; group `vettid-org-vault-r1` (min 0, max 2); SSM `vault/releases/1/group-name`; Image Builder log clean (hash and PCR0 checks passed). | Destroy `VettidOrgVaultRelease1Stack` (stateless); redeploy the host stack from master. A hash or PCR0 mismatch fails the build: stop and investigate. |
| 8 [8] | **Canary self-test**: desired capacity 1; through SSM the self-test sequence with the 60 s wait (RUNBOOK "Adding a release" 5). Optionally the capacity run on production hardware while no member exists (SMOKE "Capacity measurement"). | `"result": "PASS"` with `key_policy_check: 6` (the deletable smoke key is refused by design); parent restarts cleanly; no alarm, DLQ empty. | Desired 0. A FAIL is a canary failure: as step 6 rollback. |
| 9 [9] | **Sign manifest serial 1** (key A, signer role): edit `prod.json` (release 1 `active`, `published_at`, `log`), `npm run vault:manifest -- sign --channel prod`, commit the raised `signed_serial`; `upload` the bucket copy (RUNBOOK "Publishing a manifest" 1–3). | Output `local/vault/prod/served-1.json` verifies under key_id `4353463f85c4012f`; `manifests/<sha256>.json` in the data bucket; nothing served (URL still 404). | Never publish this document; the next signature uses serial 2. |
| 10 [9] | **Canary row + flag**: put the `canary` row for release 1's PCR0 (RUNBOOK "Canary routing"); flag the owner's test member on the admin site. | Row present without `manifest_serial`; the member appears under "Vault canary testers"; an unflagged member still gets `503 vault_unavailable`. | Delete the row; clear the flag (no vault yet). |
| 11 [9] | **Canary vault on a real phone**: the upload-key-signed app with the canary manifest `served-1.json` loaded (B5; RUNBOOK "Canary manifest on the test phone") enrolls into release 1, unlocks, locks, unlocks again; a second canary phone connects (SAS) and messages; recovery request and cancel; soak 24 h. (No older release exists, so the move step of §11.3 starts with release 2.) | Status shows release 1 `canary`; the enclave's own key check passed at first enrollment (no `release_key` error); scaler started and later stopped the group; no alarm; DLQ and queue age 0; the host log holds no secrets. | Canary failure: delete the canary vaults from the app (PIN + password) **before** clearing the flag, then remove the canary manifest (Settings → Attestation) (a cleared member's canary vault is unreachable, 410); delete the row; destroy the release stack; release 1 → `removed`; schedule the key's deletion (30 days); ship release 2 (VAULT-RELEASES §10.1, "If the canary fails"). |
| 12 [10] | **Publish serial 1**: `npm run vault:manifest -- publish --channel prod --in local/vault/prod/served-1.json` (commits the served file and the release log), PR (CI `check:manifest`), merge, `npm run deploy:site`, invoke the manifest sync (RUNBOOK "Publishing a manifest" 4, "Manifest sync"). This is the step that turns the member API's vault routes on for production. | `https://vettid.org/.well-known/vettid/pcr-manifest.json` 200, serial 1, key_id `4353463f85c4012f`; `/security/releases/1/` live and linked; the `vault-releases` row is `active` with `manifest_serial` 1; an unflagged test member gets `GET /api/vault/enclave` 200; the canary vault still unlocks. | A published manifest cannot be withdrawn or lowered. Before anyone else enrolls: publish serial 2 with release 1 `removed` (§12.3); the routes go dark again (503). |
| 13 [11] | **Always-on minimum** (O7): stays 0 until the Android beta opens; then `min_instances: 1` on release 1 (PR, deploy `VettidOrgVaultRelease1Stack`). | One instance in service; the "newest active release, minimum 1, no live instance" alarm stays OK. | Set it back to 0. |
| 14 | **First members**: set `androidAppUrl` (cdk.json, PR, deploy `VettidOrgAccountSiteStack`); distribute the app (Play closed track when P30 is unblocked, or a direct build to named testers); registration codes as usual. Clear the owner's canary flag once their vault is on the published release. | Account site Vault tab shows the app link; first enrollments in the audit log; no alarms. | Stop distribution; unset `androidAppUrl`. Members' vaults stay; they can only be removed by the member (or support's `delete` op under #122). |
| 15 | **After publishing** (vettid-vault RELEASING "After publishing"): freeze `testdata/releases/1`, add `release/prod/1` to `compat/live-releases.txt`. vettid.org: fill in RUNBOOK "Vault" (intro, "Still to come") and mark this page historical. | Compat matrix green with release 1. | — |

## 4. Open risks and inconsistencies

### 4.1 Risks

- **R1. Release 1 freezes the enrollment wire for a year or more**
  (VAULT-RELEASES §14 risk 2). Shipping before #122 would leave the cookie-
  signed enrollment in a release that must keep working, move-only, until
  it is removed. Hence B2 before the tag.
- **R2. No kill switch for the vault routes after publication.** The
  member API lights up from the manifest; the only way back is a new
  manifest serial with release 1 `removed`, which also strands anyone
  already on it. Until first members, the real gate is app distribution
  (step 14). *Owner decision 2026-10-05: add one.* The vault service
  pause (MEMBER-API "Vault service pause", RUNBOOK "Pausing the vault
  service") is the off switch; deploy it before step 12 and try it on
  staging (pause, an unlock refused, resume).
- **R3. Enclave size is per release.** The allocator size is in the release
  commit's host files (P11), so a wrong O6 guess costs a release, not a
  redeploy; and `VAULT_HOST_INSTANCE_TYPE` is one constant for every
  release stack, so changing it later also changes old releases' hosts.
- **R4. The canary path is new in production** (P28a, P31): nothing that
  ran on staging used a `canary` row with no `active` release.
- **R5. Parent EMF metrics** (unlocked vaults, latency, lease conflicts,
  KMS errors) are still "with the parent's own instrumentation" (VAULT-
  RELEASES §8.7 as built); the production alarms watch the scaler, queues,
  DLQ and registry only.
- **R6. W9 evidence is not in the repository.** The phone tests of
  2026-10-05 exist only in the owner's notes; B9 asks for a written record
  before release 1, since VAULT-RELEASES §12.1 step 5 calls them the V5
  exit test.
- **R7. Play app-signing timing.** Release 1 cannot be built without the
  Play digest (P9). Dropping the placeholder and pinning only the upload
  certificate would let release 1 ship, but then no Play-installed app
  could enroll until a later release pins the Play certificate; not
  recommended. If the timing matters, Play App Signing can be set up with
  an app signing key the owner provides, so its digest is known before
  the listing goes live (owner decision).
- **R8. Single always-on instance, cold starts, region-bound keys**:
  unchanged from VAULT-RELEASES §14 (6, 7, 9).

### 4.2 Inconsistencies found

Fixed on 2026-10-05 in the documents named (vettid.org, vettid-vault
RELEASING.md, vettid-android README), except I12, which is a naming rule
(S3 = the W9 release, S4 = the 0.15.0 release, formerly drafted as 0.11.0), which #122 adopted.

| # | Where | What | Suggested fix |
|---|---|---|---|
| I1 | docs/VAULT-RELEASES.md:465 | "**Key B is a TODO** until the owner's hardware token exists" | Key B was pinned by #100 (key_id `1abd49da96970b6e`, YubiKey PIV 9c); say so (RUNBOOK:612 already does). |
| I2 | docs/VAULT-RELEASES.md:457 and :590, :1209 | `scripts/vault/sign-manifest.ts` | The script is `scripts/vault/manifest.ts` (`npm run vault:manifest`), as §7 "As built (W7)" says. |
| I3 | docs/RUNBOOK.md:346 vs :572 | Signer profile is `vault-manifest-signer` in "Accounts and profiles" but `vault-prod-manifest-signer` in "Publishing a manifest" (vettid-vault RELEASING.md:199 uses `vault-manifest-signer`) | Pick one; `vault-prod-manifest-signer` matches the staging name `vault-staging-manifest-signer`. Same for `vault-key-retirement` → `vault-prod-key-retirement` if renamed. |
| I4 | docs/RUNBOOK.md:315, :323 | "No release and no release key exist yet"; release stacks "one per entry in `lib/vault/releases.ts` (none yet)" | Staging has releases S1 (removed) and S2; release stacks come from `vault/releases/<channel>.json`. |
| I5 | docs/RUNBOOK.md:704–707 "Still to come" | Lists "Publishing a release (manifest signing, W7)" | Done (W7, "Publishing a manifest"); keep the remaining items, link this checklist. *(This PR only adds the link.)* |
| I6 | docs/VAULT-RELEASES.md:1047 | "there is no member-facing or admin-UI switch" for the canary flag | The admin site has one since #95 (RUNBOOK "Canary routing", ADMIN-API "Vault canary"). |
| I7 | docs/VAULT-RELEASES.md:1022, :416 | Tag `vault-rN`, `git checkout vault-rN` | The workflow uses `release/<channel>/<n>` (RELEASING.md notes this). Also "from `main`": the release commit is merged to `main` and tagged there. |
| I8 | docs/VAULT-RELEASES.md:551, :1026 | `vault/releases.json` | `vault/releases/<channel>.json` (§7 as built). Also :728 `lib/vault/releases.ts`. |
| I9 | docs/VAULT-RELEASES.md:1026 | "admitted PCR0s = N plus every release not `removed`" | `admitted_pcr0s` lists only earlier releases (`lib/vault/release-list.ts:164`); N's own PCR0 is implicit. RUNBOOK "Creating a release key" has it right. |
| I10 | docs/VAULT-RELEASES.md:41, :60–65 | `related` cites VAULT-MESSAGING 0.9.1; "Today" says the member API vault routes and tables are "not deployed" and no vault infrastructure exists | Current: VAULT-MESSAGING 0.10.7; W4–W9 deployed. A one-line "superseded by the as-built notes" would do. |
| I11 | docs/VAULT-RELEASES.md:762 (§8.3) vs :962 (§8.8) vs :1253 (O6) | Allocator "memory O6", "up to about 6 GiB", O6 "5 GiB" | 5120 MiB as built (vettid-vault `deploy/host/allocator.yaml`); align §8.8. |
| I12 | PR #122 rollout vs W9 plan | #122 re-enrolls staging vaults "under a staging release S3" on 0.11.0; the W9 plan's S3 is 0.10.5/0.10.6 + capacity, used for the retirement drill on S2 | Name them apart: S3 = the W9 release (now), S4 = 0.15.0. **Resolved:** #122 merged (2026-10-06) as VAULT-MESSAGING 0.15.0 with S4 (VAULT-MESSAGING §15 item 20, ENROLLMENT-CODES §8). |
| I13 | docs/ANDROID-PLAN.md:55 vs :9 | D2 says gold `#F4B942`; the 0.1.2 changelog says brand gold `#FFC125` (owner, 2026-10-04) | Update D2 to `#FFC125`. |
| I14 | docs/ANDROID-PLAN.md:192–195 (risk 5) | GrapheneOS "does not accept yet" | VAULT-MESSAGING 0.9.0 added the SelfSigned allowlist; staging enrolled a GrapheneOS phone on 2026-10-05. Mark resolved. |
| I15 | docs/ANDROID-PLAN.md:16, :127 | VAULT-MESSAGING "(0.6.x)", RELAY-PROTOCOL "(0.4.0)" / "RELAY-PROTOCOL 0.4" | 0.10.7 and 0.6.0. Also :107 "Onboarding — Sign-in flow" changes with #122 (which edits ANDROID-PLAN). |
| I16 | vettid-vault docs/RELEASING.md:20–34, :82 | "Today: dry runs only … placeholders"; "two `ubuntu-24.04-arm` runners" | Staging releases 1 and 2 were built for real; runners are `ubuntu-26.04-arm` since #35 (its body lists the follow-up). |
| I17 | vettid-android README.md:8 | "Status: phase A2" | A4 and the recovery/transfer work are merged. |
| I18 | VAULT-RELEASES §10.1 (as built) vs vettid-android | "The test device loads the canary manifest out of band" | No such path exists in the app (P31, B5). *Resolved 2026-10-06: vettid-android #63; VAULT-RELEASES 0.1.6.* |
