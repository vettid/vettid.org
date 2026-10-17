---
title: VAULT-RELEASES
status: approved (owner, 2026-10-04)
version: 0.1.30
date: 2026-10-16
owner: Al Liebl (Mesmer)
changelog:
  - 0.1.0: V5 plan. Release pipeline, keys, infrastructure, release
    process, testing and the first production deployment, built around
    the owner decisions of 2026-10-04 that amend D1 (locked keys for
    production only, a release cadence, move-only deprecated releases,
    retirement with key deletion after notice)
  - 0.1.1: W5 as built. Cross-account access by resource policies (no
    assumed role); vault tables in the vault account; accounts per stage;
    role, function and SCP names; owner-only roles trust the Identity
    Center permission set (MFA at sign-in); release-key custom resource
    details; the SCP's break-glass is the management account
  - 0.1.2: W6 as built. Host stack (VPC, DNS Firewall allowlist, separate
    build VPC for Image Builder, scaler, manifest sync, alarms, CloudTrail
    rules); per-release stacks from lib/vault/releases.ts; scaler rules
    (freshness, markers, hands-off for unlisted groups); host files in
    vettid-vault deploy/host; rescue stays release-wide
  - 0.1.3: W7 and W8 as built. Release lists per channel
    (vault/releases/<channel>.json, replacing lib/vault/releases.ts);
    key A and the staging key pinned (key B a placeholder until its token
    exists); scripts/vault/manifest.ts wraps `vaultctl manifest` (sign,
    upload, publish); check:manifest in CI; the release log under
    /security/releases/; nothing served in either channel until its first
    release. Member API: `canary` release rows routed only for flagged
    members (the scaler manages them); the daily notice job (90/30/7/1
    days, ended, urgent security releases); release status in
    GET /api/vault/status
  - 0.1.4: W9 part A as built (CDK only). `-c stage=staging` builds the
    staging copy in vettid-vault-staging under its own zone
    staging.vettid.org (delegated from vettid.org by one NS record):
    member pool, tables, member API, account site, the staging.vettid.org
    manifest host, the vault stacks; no admin, signup, relay or audit
    stacks (§8.1, §11.1)
  - 0.1.5 (editorial, W10 readiness review I1–I11, I18): key B pinned;
    script, tag and release-list names as built; `admitted_pcr0s` lists
    earlier releases only; the admin-site canary switch; enclave memory
    5 GiB throughout; staging served since S1; the "Today" paragraph
    marked as the state when the plan was written
  - 0.1.6 (owner decisions of 2026-10-06; vettid-android #63): how the
    canary phone gets the canary manifest (§10.1): the tester shares the
    signed served-<s>.json to the app, which verifies it under its pinned
    keys, shows serial, key and releases and installs it on confirmation;
    the selection rule (VAULT-MESSAGING 0.14.0 §11.10.1); removal after
    publication (automatic) or a failed canary (Settings); risk 10, a
    leaked canary document (§14)
  - 0.1.7 (editorial; W10-READINESS 0.1.3): §8.8 records the capacity
    measured on staging S3 (2026-10-05) and the owner's O6 decision of
    2026-10-06 (keep 1 vCPU / 5120 MiB for release 1; revisit when unlock
    queueing shows in metrics); §15 O6 updated to match
  - 0.1.8 (editorial; owner decisions of 2026-10-08, VAULT-MESSAGING
    0.22.0 §15 item 30): §11 notes the member's History export as the
    one exception to "no backup or export"; it changes no recovery
    objective
  - 0.1.9 (editorial; push N3, VAULT-MESSAGING 0.24.1 §14.3, vettid.org
    #204, vettid-vault #59): §8.4 adds the push gateway to the egress
    controls. The parent's `DefaultAllow` carries both
    `push.vettid.org` and `push.staging.vettid.org` (one parent binary
    for every channel); each stage's DNS Firewall and the enclave's
    release allowlist admit only their own channel's host; the gateway
    URL is `push_url` in vettid-vault `enclave/releasecfg/<channel>.json`
  - 0.1.10 (owner request 2026-10-10, RELEASE-UPDATES 0.3.0,
    ANDROID-PLAN 0.1.31): release notes on every channel (§7 "Release
    notes on every channel"): a `log` is required for every release in
    every channel from the moment it leaves `candidate`; a release's
    `notes` is its entry in its own channel's log; staging gets a log at
    `https://staging.vettid.org/security/releases/` generated the same
    way; check:manifest checks both logs; staging S1–S9 backfilled with
    short entries; notice emails link the ending and the newest release's
    notes (§3.5). §10.1 steps 4, 5, 10 and 12 and §11.1 follow
  - 0.1.11 (owner decisions of 2026-10-11, STAGING-DEVELOPMENT-PLAN
    0.1.0 §6; approved by the owner 2026-10-11, merged as vettid.org
    #220). **D2:** production
    release 1's window is 90 days, for release 1 only, expressed as
    `ends_after_days: 90` on its entry in `vault/releases/prod.json`;
    the default stays 12 months and the KMS window 30 days (§3.5; §1,
    §7, §10.3, §14, §15 O5 follow). **D4, D5:** the release constants
    `features` and `android_package` (§5.2; VAULT-MESSAGING 0.26.0
    §11.10.8). **D1, D11:** staging is the development channel, not
    parked between releases; its releases are cut by hand, at most two
    a week, and no nightly image exists; the text that said otherwise
    now points to the plan (§1, §3.1, §3.3, §8.9, §11.1, §15 O2)
  - 0.1.12 (owner decision 2026-10-11, ANDROID-PLAN 0.1.36,
    VAULT-MESSAGING 0.27.0 §11.7.1; approved by the owner 2026-10-11):
    O8 amended. Google generates and holds the Play app-signing key;
    VettID's release key (the certificate already pinned, called the
    upload certificate until now) signs the F-Droid and direct builds
    and is never given to Google. **Production release 1 pins that one
    certificate**: `TODO-O8` is removed, not filled in, and O8 no
    longer blocks release 1. The Play certificate is added by a later
    production release, before the Play listing goes live.
    `android_signers` entries become `{digest, class}` and each vault
    is bound to its app's signer (§5.2); C6 says what adding and
    removing a signer does to existing vaults (§3.4); §12.1 and §15 O8
    follow
  - 0.1.13 (editorial, as built; staging release S10, vettid.org #223,
    #228–#230, vettid-vault #62–#65; VAULT-MESSAGING 0.27.1; approved
    by the owner 2026-10-11). §3.5: what `check:manifest` does and does
    not check about `ends_after_days` (an `ends_at` needs release 2's
    `published_at`; only an early `ends_at` is refused; nothing
    requires the member on production release 1; **owner decision
    2026-10-11: it will be required**, not yet implemented). §5.2: the feature list's only-grow
    check runs in the release workflow against the highest lower tag;
    the staging exception for unbound vaults is derived from the
    channel and release number; the key attestation chain rules.
    §3.5 "As built": `security: urgent` first used, by S10. §8.8:
    S10's capacity figures. 0.1.11 marked approved
  - 0.1.14 (editorial, as built; phase 1 of VAULT-RELAY-SCALING 0.1.2,
    vettid-vault #66, for staging release S11; VAULT-MESSAGING 0.27.2).
    §8.7: the parent's first metrics as built (namespace, dimension,
    names, how they are shipped), the alarms they call for (not yet
    built) and what is still to be verified on staging. §8.8: the relay
    connections' capacity per host and the local measurements
  - 0.1.15 (editorial, a reference only): §3.4 C4 and `related` point
    to VAULT-HOST-PROTOCOL (0.1.0, a draft for the owner's review), the
    enclave ↔ parent protocol as built
  - 0.1.16 (errata; VAULT-HOST-PROTOCOL decision H8 and vettid-vault
    #69). §3.4 C2: the `account` operation, in the SQS message since
    VAULT-MESSAGING 0.15.0, was missing from the list. §8.7 "As
    built": the plain field `relay_vault_limit`, from the staging
    release that includes vettid-vault 8f2c8bf (S11). `related` brought
    up to date
  - 0.1.17 (as built, host stack; for staging release S11). §8.7: the
    alarms on the parent's metrics are built in the vault account's
    host stack (not yet verified on staging): how they are keyed
    (the worst instance, by Metrics Insights queries; one log metric
    filter), their thresholds, and where the in-flight alarm differs
    from the text above it (80 % of the 16 connections a host may have,
    not of the connections open: approved by the owner 2026-10-12). The alerts
    topic admits the account's CloudWatch alarms (it admitted the
    CloudTrail rules only, so no alarm of the host or release stacks
    could notify). How the parent's log reaches CloudWatch as built
    (files, not journald) and why the record needs no change to be
    read as metrics
  - 0.1.18 (as built, a correction; vettid.org #240's churn alarm was
    refused by CloudWatch on staging, the stack rolled back). §8.7:
    `relay-connection-churn` is more than 64 relay connections opened
    in an hour over every instance, a fixed number; the comparison
    with the connections open is dropped, since an alarm takes one
    Metrics Insights query only. What is lost is said there. All six
    definitions were accepted by CloudWatch in the staging account
    before this change (created under throwaway names and deleted)
  - 0.1.19 (approved by the owner 2026-10-12, vettid.org #243;
    CALLS-PLAN 0.1.3 §13 D12–D26,
    CALLING-SERVICE 0.2.0, VAULT-MESSAGING 0.28.0): what the staging
    release for calls phase C2 ("release C2", not cut) needs. §5.2: the
    optional release constant `calls_url` and what a release that
    carries it must contain. §8.4: the calling service's credential
    issuer joins the egress controls (the enclave's allowlist, the
    parent's `DefaultAllow`, the stage's DNS Firewall), planned, not
    built. No other section is touched (§8.7 in particular is left
    alone)
  - 0.1.20 (as built, vettid-vault #70, #71 and #72, `main` 392b03c; for
    staging release S11, not cut yet). §8.7: the log records the
    unreachable-parent rule adds, and what S11 is planned to carry.
    `related` brought up to date
  - 0.1.21 (as built, vettid-vault #73 and #74, `main` a852e36; for
    staging release S11, not cut yet; approved by the owner
    2026-10-13). §8.7: what S11 is planned to carry now includes #73
    (the Go version of the enclave image) and #74 (a `Ping` read while
    the vaults are being locked, VAULT-HOST-PROTOCOL 0.1.5 §4.3); no
    log record changes. `related` brought up to date
  - 0.1.22 (owner decision of 2026-10-13: the current version and 3 to
    5 older versions are enough; as built in vettid.org #258; approved
    by the owner 2026-10-13). **The data bucket keeps fewer old
    versions**: two lifecycle rules, one that removes a noncurrent
    version 1 day after it was replaced unless it is one of the 5
    newest noncurrent versions of its object, and the rule the bucket
    always had, which removes every noncurrent version after 7 days.
    §8.2: the bucket's retention. §11.4: the objective for stored state
    after an operator or code error (24 hours for any version, then
    the 5 newest older versions, for at most 7 days), and the sentence
    on deleted vault data. §14: O9. **Nobody gets a shell on a vault
    host** (owner decision of 2026-10-13; vettid.org #252): §8.3, the
    "Instance" bullet: no interactive access, Run Command only; before,
    it said "SSM Session Manager only (sessions logged)". `related`
    brought up to date
  - 0.1.23 (editorial, as built; staging release S11, 2026-10-13;
    approved by the owner 2026-10-13). §8.8: S11's capacity figures
  - 0.1.24 (owner decision of 2026-10-13: rescue must always have a
    target; approved by the owner 2026-10-13. 0.1.23 is the
    staging S11 capacity entry of vettid.org #270). **A new release's
    key also admits every `removed` release that can still be
    rescued** when the key is created, that is, whose `ends_at` plus
    the channel's deletion window has not passed; before, it admitted
    only the releases not `removed`, and since a vault moves only into
    an `active` release, a rescued vault had nowhere to move once a
    release created after the removal was `active` (seen on staging
    2026-10-13). §3.5: the rule, how the window is counted, the check,
    the one case without a target (a release removed while an older
    one is the newest `active`),
    why a move into a `deprecated` release was not chosen, and the
    staging releases whose keys are older than the rule. §6.2: the
    key policy. §7: the checks, and the list member `rescue`. §10.1
    step 5 and the failed canary. §10.3 steps 2 and 3: a check before
    a release is removed or a new one published; **how the release
    stack of a rescue is built**: the entry stays `removed` and
    carries `host` with `rescue: true` (the procedure of 0.1.2 could
    not be carried out: the validation refused `host` on a `removed`
    entry, and a status never goes back). No enclave, key or release
    list entry changes
  - 0.1.25 (editorial, as built; approved by the owner 2026-10-13).
    §3.5: the rescue of staging release 3 was rehearsed on 2026-10-13
    (a vault moved from release 3 into release 10), so its key's
    deletion was scheduled again and falls seven days after that, later
    than the keys of releases 4 to 6; and with release 11 `active`
    since that day, staging 3 to 6 have no rescue target any more
  - 0.1.26 (editorial, as built; staging release S12, 2026-10-14;
    approved by the owner 2026-10-14). §8.8: S12's capacity figures
  - 0.1.27 (approved by the owner 2026-10-15; the wording of
    vettid-vault #79, #88 and #87). §5.1: the enclave kernel blobs are
    not the nitro-cli package's (Linux 4.14): today the lock pins AWS's
    `aws-nitro-enclaves-sdk-bootstrap` v6.6.79 set (#79), what the lock
    records for it, and the kernel blob set version in
    `measurements.json`; a blob set vettid-vault builds from kernel.org
    source (#87) is adopted later, by a change of the toolchain lock
    that no release has yet. New §5.4: the weekly enclave kernel
    currency check, a warning, not a block (#87). §10.1 step 2: the
    kernel warning answered in the release notes. §11.2: the
    self-test's required and informational kernel and system-call
    filter checks (#88), and the checks required on a source-built
    kernel (#87). §14: risks 11 (the allow list, #88) and 12 (no
    current kernels from AWS, #87)
  - 0.1.28 (**wording for the owner's approval**, with VAULT-MESSAGING
    0.33.0 §11.14; for the vault's "release R", not built). §5.2: the
    release constants `recovery_counter`, `recovery_request_keys`,
    `recovery_wait_unit_seconds`, `recovery_quiet_seconds`,
    `recovery_offered` and `android_min_version_code`, and **the build
    rule that keeps staging's short wait unit and any test clock out of
    a production image**, with a test on the production image. §8.2:
    the recovery counter bucket per channel (Object Lock in compliance
    mode, no default retention, no rule that expires a current version
    or a vault's newest present record), the host role's five grants on
    it, the recovery request key in the member API's account, and the
    data bucket's version rule as the window (24 hours safe, up to 7
    days) for repairing the one write fault a DEK replacement cannot
    survive. §8.4: the counter bucket's host in
    the egress controls. §8.8: the heavy key derivation's permit and its
    effect on capacity (estimates). §3.5: an earlier release stays a way
    around a later counter until its key is deleted. §12: production
    release 1 may refuse recovery, never ship the earlier recovery
  - 0.1.29 (editorial, as built; staging release S13, 2026-10-15).
    §8.8: S13's capacity figures, next to S12's
  - 0.1.30 (editorial, as built; staging releases S14 and S15,
    2026-10-16). §8.8: S14's and S15's (release R) capacity figures,
    next to S13's
related:
  - VAULT-PLAN.md (§4 V5 points here; D1–D5)
  - VAULT-MESSAGING.md (0.29.3) §11.10 release updates, §12.5 deletion, §13.5, §13.9
  - RELEASE-UPDATES.md (0.3.3) — member-facing; §3 changes with this plan; §5 the release log
  - ANDROID-PLAN.md (0.1.37) — the app's "What's new" from the log
  - STAGING-DEVELOPMENT-PLAN.md (0.1.2) — staging as the development channel; D1–D11
  - CALLS-PLAN.md (0.1.3) §13, CALLING-SERVICE.md (0.2.0) §5.5, §8 — the calling service's issuer in the egress controls; `calls_url`
  - MEMBER-API.md "Vault", RUNBOOK.md, ARCHITECTURE.md
  - VAULT-HOST-PROTOCOL.md (0.1.6) — the enclave ↔ parent (vsock) protocol as built; §10 what happens if versions meet
  - vettid-vault docs/SMOKE.md (hardware smoke test, 2026-10-02)
classification: public (no secrets; safe for github.com/vettid)
---

# Vault releases and first deployment (V5)

This is the plan for VAULT-PLAN phase V5: how a vault release is built,
keyed, deployed, published, retired and tested, and the exact sequence of
the first production deployment. It replaces the V5 bullets in VAULT-PLAN
§4. It is a plan: the spec changes it needs are listed as work items
(§13) and land in VAULT-MESSAGING, RELEASE-UPDATES and the vettid-vault
code first.

When this plan was written (2026-10-04): the vettid-vault code was
feature complete through V4 and had passed the hardware smoke test
(m7g.large, 1 enclave vCPU / 3 GiB, nitro-cli 1.5.0; seccomp, per-vault
UIDs and attested KMS round trips work; Argon2id at 64 MiB peaks at
about 76 MB per vault process, the supervisor uses about 13 MB). In
vettid.org the member API vault routes, the vault tables and the alarm
and deletion mailers were merged but not deployed; no vault
infrastructure, release key or manifest existed, and the release
constants were empty, so a release image refused every enrollment and
unlock. That state is superseded: W4–W9 are built and deployed (the
*As built* notes in each section), staging has published releases, and
production release 1 is tracked in W10-READINESS.

## 1. Summary

- **Channels.** `dev` (local, fake NSM and KMS), `staging` (its own AWS
  account, own manifest key, deletable keys, cheap) and `production`
  (member-facing, locked keys). A staging image can never open, seal to
  or be listed for production, by construction (§3.1).
- **Lifecycle.** `active` → `deprecated` (move-only) → `retired` (final
  notice) → `removed` (key scheduled for deletion, then deleted). Default
  12 months from supersession to the deadline, configurable (§3.2);
  production release 1: 90 days (§3.5).
- **Cadence.** One production release a month at most, plus security
  hotfixes; a month with nothing member-visible is skipped (§3.3).
- **Spec changes before release 1** (§4): the §11.10.7 key check admits
  exactly one new thing, a pinned retirement role that may schedule
  deletion with a 30-day window, cancel it and re-enable the key; the
  manifest stops travelling inside the unlock request (its 4,096-byte cap
  holds only 7 releases, and the plan needs about 15–25); a `removed`
  status and an `ends_at` date.
- **Build.** CI on an arm64 runner builds the EIF reproducibly with a
  pinned nitro-cli in a pinned Amazon Linux container, twice, and
  publishes EIF, PCRs, binary hashes and GitHub artifact attestations. A
  second, independent build must match before a release is signed (§5).
- **Keys.** Release sealing keys come from a CDK custom resource with
  `BypassPolicyLockoutSafetyCheck`; the enclave host role and the
  retirement role are named in every key policy forever, so they live in
  a stateful stack and must never be deleted (§6). Manifest key A in KMS,
  key B offline; both pinned in every image.
- **Infrastructure.** `VettidOrgVaultStack` (stateful: data bucket, roles,
  release keys), `VettidOrgVaultHostStack` (VPC, egress controls, scaler,
  manifest sync, alarms) and one small `VettidOrgVaultRelease<N>Stack` per
  live release (AMI from EC2 Image Builder, launch template, ASG). Old
  releases run on demand (§8).
- **Cost.** About $90/month in production at steady state with one
  always-on m7g.large; about $30 parked. Staging is the development
  channel and is not parked: about $100–120 a month, an estimate (§8.9;
  STAGING-DEVELOPMENT-PLAN §3 risk 5).
- **First deployment.** Member API vault routes dark first; staging
  release and hardware tests; production release 1 only when the Android
  app's signing key exists, because its digest is pinned in the image
  (§12).

## 2. The owner decisions of 2026-10-04 (amending D1)

| # | Decision | Consequence in this plan |
|---|---|---|
| R1 | Permanent, locked keys (no policy change, ever) only for **production** releases. Development, staging and test builds use deletable keys and are clearly distinguishable. | Channels with separate manifest keys and a separate account (§3.1). Staging keys have the production shape so that the check and the retirement path are tested, but a 7-day window and are deleted after use. |
| R2 | Member-facing releases on a **cadence** (for example monthly) plus security hotfixes, not every merge. | §3.3, §10. |
| R3 | **Deprecated releases are move-only**: they must still unlock and let the member approve a move; nothing more. | The compatibility contract C1–C8 and its tests (§3.4, §11.3). |
| R4 | **Retirement and key deletion** after a long window (12 months to start, configurable), with in-app prompts, emails and a final deadline. Then the release stops and its key is deleted. Confidentiality never changes; members who never move lose access. | §11.10.7 allows only scheduled deletion (and its cancellation) by a pinned principal (§4.1); the notice timeline (§3.5). |

D1 itself stands: a vault opens only in the release its member approved,
and only the member moves it. What changes is availability: VettID now
promises to run a release for a bounded time, not forever.

## 3. Releases

### 3.1 Channels

| | dev | staging | production |
|---|---|---|---|
| Build | `devenclave` tag (fake NSM, dev sealer, TCP) | release build, `CHANNEL=staging` | release build, `CHANNEL=prod` |
| Runs on | laptops, CI (docker compose, LocalStack) | Nitro hardware, staging account | Nitro hardware, vault production account |
| Manifest key | test key in the repo | staging key (KMS, deletable) | key A (KMS) + key B (offline) |
| Manifest URL | none (passed by vaultctl) | `https://staging.vettid.org/.well-known/vettid/pcr-manifest.json` | `https://vettid.org/.well-known/vettid/pcr-manifest.json` |
| Sealing-key account | none | staging account | production account |
| Release keys | dev sealer | §11.10.7 shape, retirement window 7 days, deleted when the release is removed (at most three staging releases are live, STAGING-DEVELOPMENT-PLAN §2.1, §2.5) | §11.10.7 shape, window 30 days, deleted only at retirement |
| Device attestation | test CA | test CA **and** the real vendor roots | real vendor roots only |
| Release numbers | 0 | its own sequence | 1, 2, 3, … |

Why a staging image can never be mistaken for production: its PCR0
differs (the channel's pins are in the measured image), its manifest key
is not pinned in production apps or images, and it refuses sealing keys
outside the staging account. Production keys name production PCR0s only.

The hardware smoke test (vettid-vault SMOKE.md) is a fourth, throwaway
case: a normal deletable KMS key with the administrator statement, which
the §11.10.7 check is expected to refuse.

### 3.2 Statuses

Production statuses, after the spec change of §4.3:

| Status | Enroll | Move into | Unlock and move out | Instances | Apps |
|---|---|---|---|---|---|
| `active` | yes (newest) | yes | yes | newest: always on (owner decision O7); others on demand | normal |
| `deprecated` | no | no | yes, **move-only contract** (§3.4) | on demand | urge the update; show `ends_at` once set |
| `retired` | no | no | yes, move-only | on demand | final warning with the date |
| `removed` | no | no | **no** (key pending deletion or deleted) | none | the vault is gone; enroll afresh |

A release becomes `deprecated` when a newer release becomes `active`.
`retired` starts the final notice period (default 90 days before
`ends_at`). `removed` is set when the key's deletion is scheduled; the
entry stays in the manifest while any live key's sealing policy admits
that release's PCR0 (§4.2), so that §11.10.7 check 6 keeps passing.

### 3.3 Cadence and hotfixes

- **Monthly train.** Code freezes on the first Monday; the release is cut
  from `main` that week, from the commit of a staging release that
  passes the promotion checklist (STAGING-DEVELOPMENT-PLAN §2.4, seven
  quiet days on staging among its conditions), and is
  published in the third week. A month with no member-visible change is
  skipped: every release costs each member an approval.
- **Hotfix.** A security fix ships as the next release number, cut from
  the current release's tag plus the fix, with the short canary (§10.2).
  Its notes carry the urgency; members on affected releases are emailed.
  The fix is prepared in a private fork and the public source is pushed
  when the release is published (AGPL: source with the release).
- **Never** "every merge": only the train or a hotfix creates a
  production release. Staging releases are cut by hand from a tag, at
  most two a week (STAGING-DEVELOPMENT-PLAN §2.1); no nightly staging
  image is built.

### 3.4 The move-only contract

A release that is not `removed` keeps working for **unlock, approve a
move, lock, recovery and deletion by the host**. Nothing else is
promised: no new features, no fixes, messaging and other features only
as long as they happen to keep working. The contract is what VettID's
other components must keep compatible with, and for how long: until
the oldest live release is removed.

| # | Interface | What stays compatible |
|---|---|---|
| C1 | Manifest | Format v1 and its signature label; the pinned manifest keys (rotation only through a key every live release already pins); the status set fixed at release 1 (`active`, `deprecated`, `retired`, `removed`); new fields additive only (old parsers ignore unknown members, but refuse unknown statuses) |
| C2 | Alternate channel (app ↔ member API ↔ queue ↔ enclave) | Routes and their errors; envelope v2, suite 2, the 13,444 / 5,252-byte sizes; descriptor v1; the SQS message v1 and its ops (`enroll`, `unlock`, `lock`, `delete`, `recovery`, `recovery_cancel`, `recovery_register`, and `account`, which 0.1.16 adds to this list: it has been in the message since VAULT-MESSAGING 0.15.0); response slots; the unlock, approval and recovery signing strings. **Apps keep the oldest live release's formats.** |
| C3 | Storage and tables | S3 keys `vaults/<vault_id>/…` and `users/<hash>/vault`, conditional-write semantics; the attributes a release's parent reads and writes (lease, registry row, response slot, lifecycle events, `alarm`); the queue name prefix. Schema changes additive only. |
| C4 | Host | Each release runs **its own tag's parent** on its own AMI, so the vsock protocol never crosses versions (the protocol as built: VAULT-HOST-PROTOCOL; what the code does if versions meet all the same: §10 there). Host OS patches rebuild the AMI with the same EIF and parent. |
| C5 | AWS | The pinned KMS region endpoint, SigV4, IMDS credentials, the pinned Amazon roots (Amazon Root CA 1 runs to 2038) |
| C6 | Device attestation | The Android signing-certificate digests, package name and iOS app ID pinned in the release; the pinned Google, Apple and GrapheneOS roots. Rotating the app signing key needs every live release to pin the new digest first (two digests pinned). 0.1.12: each vault is bound to the signer of its app (VAULT-MESSAGING 0.27.0 §11.7.1). **Adding** a signer to a release changes nothing for existing vaults. **Removing** one strands the vaults bound to it at that release (`signer_refused`, also at the confirming unlock of a move into it) until the member transfers or recovers to an app with a pinned signer: a release drops a signer only with the notice of a retirement (§3.5), and its log entry says so. A release's log entry also says when it adds a signer. |
| C7 | Relay | Not needed for a move (a move locks without collecting). Ordinary unlocks collect from the relay: best effort only. The relay stays backward compatible in practice, but a deprecated release may lose messaging. |
| C8 | Member API vault features | Lock, status, recovery and the host `delete` (account cancellation) keep working for every live release |

Testing the contract is §11.3. The weakest point is C6: a member who
moves to a phone whose attestation chains to a root the old release does
not know cannot unlock that release. Mitigation: pin the vendors'
announced next roots, and keep the window to a year.

### 3.5 Retirement, notices and key deletion

For release N superseded by N+1 at T0, with window W (default 12
months, set per release in the release list, §7):

| When | Manifest | Instances and key | Member notices |
|---|---|---|---|
| T0 | N `deprecated` | on demand | in-app: update available (every unlock) |
| T0 + W − 90 days | N `retired`, `ends_at` = D | on demand | email 1; in-app final warning with the date |
| D − 30, − 7, − 1 days | | | emails 2–4 |
| **D = T0 + W** (the deadline) | N `removed` | instances stopped; API answers `410 release_unavailable`; **`ScheduleKeyDeletion(30 days)`** | email: the release has ended; how to ask for a rescue |
| D … D + 30 | | key `PendingDeletion` | **rescue on request**: `CancelKeyDeletion`, `EnableKey`, start an instance, the member moves into the newest `active` release (its key admits N, below), deletion is scheduled again |
| D + 30 | entry stays while a live key admits N (§4.2) | key deleted | email: the vault could not be opened and its data is erased; enroll a new vault |
| D + 37 | | the stored objects of vaults still sealed to N are deleted (they can never be opened), and their rows | |

Why the KMS window sits after the deadline: a key that is pending
deletion already refuses `Decrypt` and `GenerateDataKey`, so scheduling
deletion *is* the end of service. The 30 days are a buffer to abort a
mistake or rescue a member who writes in, not extra time members are
told to count on. Cancelling leaves the key `Disabled`; `EnableKey`
restores it, which is why the retirement role needs both (§4.1).

**A rescue always has a target** (0.1.24; owner decision of
2026-10-13). A rescued vault can do one thing: move, and only into an
`active` release numbered above N whose key admits N's PCR0 (§3.2; N's
own enclave refuses any other target, and KMS refuses the seal). The
enclave accepts any such release; the release list's checks and the app
choose the newest `active` one. So every key created while N can still
be rescued admits N:

- *The rule.* A new release's key admits every earlier release that is
  not `removed`, and every `removed` release whose rescue window is not
  over when the key is created (§6.2).
- *The window.* It is counted from the release list: N's `ends_at` plus
  the channel's `retirement_window_days` (30 in production, 7 in
  staging). A `removed` entry therefore keeps its `ends_at`, which is
  the time the release ended and is never in the future: the checks
  refuse a `removed` entry whose `ends_at` is after the manifest's
  `issued_at`. The list does not know the day KMS deletes the key, which is later when
  deletion was scheduled late or again after a rescue; nothing is
  promised for that extra time.
- *No `ends_at`.* A `removed` entry without `ends_at` is a release that
  never held a member's vault (a failed canary, §10.1). It cannot be
  rescued, and no later key admits it.
- *The check.* `vault:manifest sign` before a manifest is signed, and
  `check:manifest` on the served one, refuse a manifest in which a
  `removed` release still in its window (at the manifest's `issued_at`)
  is not admitted by the key of the newest `active` release. So neither
  removing a release nor publishing a new one can leave a rescue
  without a target (§7, §10.3). The same two checks, not CDK synth,
  report a candidate's list that names a `removed` release past its
  window: naming it is harmless to the key check, but the manifest
  would have to list it for as long as the new key lives.
- *The one case without a target.* A release that was published and is
  then removed while an older release is the newest `active` one has
  no target: the enclave refuses a move to a lower release number. No
  check reports it; removing such a release ends its vaults and is the
  owner's decision each time.
- *The alternative not chosen:* letting a rescued vault move into the
  newest release whose key admits it, even a `deprecated` one. Every
  published enclave image refuses a move whose target is not `active`,
  and an image cannot change; a release able to do it would have to
  exist before the release to be rescued. It would also leave the
  member on a release that is itself ending, with a second move to
  make.
- *Keys older than the rule (staging).* The keys of staging releases 1
  to 11 were created before it and cannot change. Release 11's key
  admits releases 7 to 10 only. Staging releases 3 to 6 (removed
  2026-10-13) could therefore be rescued only into release 10, and only
  while release 10 was `active`; since release 11 became `active`
  (2026-10-13) they have no target. Their keys are deleted on
  2026-10-20, release 3's some hours later than the others: its rescue
  was rehearsed on 2026-10-13 (a vault moved from release 3 into
  release 10), and its key's deletion was scheduled again afterwards
  with the full seven days. The
  check starts with staging release 12. Production has no release yet,
  so every production key follows the rule.

Every notice email links release notes (owner request 2026-10-10,
RELEASE-UPDATES §3): emails 1–4 and the deadline email link N's `notes`
and the `notes` and log summary of the newest `active` release (the one
the app offers); the hotfix email of §10.2 links the hotfix's `notes`
with its summary and `security_text`. The URLs are the channel's own log
entries (§7 "Release notes on every channel"); a summary the job cannot
read from the log is left out, never the link.

Who is emailed: members whose vault row's `sealed_release` is N, found
through the vaults table's `user-index`. That value is advisory (written
by the host), which is fine for notices. Emails go through the existing
system mailer (SES; members are verified identities). Members in a
recovery are emailed the same way.

Shortened windows: a release with a known exploited vulnerability may get
a shorter window, never under 60 days (owner decision O5).

**Production release 1: 90 days** (0.1.11; owner decision D2 of
2026-10-11, STAGING-DEVELOPMENT-PLAN §6). Release 1 goes early to the
owner and named testers (at most 10) and freezes its wire formats and
pinned signers for as long as it is live (§3.4), so its window W is
**90 days, for release 1 only**. Release 2 and every later release keep
the default of 12 months.

- *What changes.* W for one release, nothing else. The notice period,
  the emails, the rescue and O5's floor of 60 days are as above. The
  30 days of `ScheduleKeyDeletion` after the deadline are a different
  thing (`retirement_window_days`, pinned in the image and in the key's
  policy, §4.1) and stay 30.
- *How it is expressed.* Release 1's entry in
  `vault/releases/prod.json` carries **`ends_after_days: 90`**, from the
  release entry PR on (§10.1 step 5). It is a member of the release list
  only, like `host` and `log`: it is not in the manifest or the image,
  and no enclave or app reads it. An entry without it has the default.
  `check:manifest` accepts the member only on production release 1 and
  only with the value 90, and then refuses an `ends_at` on that entry
  earlier than 90 days after release 2's `published_at`. (No check knew
  W before: `ends_at` is set by hand, §7, §10.3.)
- *The check, as built* (0.1.13; `lib/vault/release-list.ts`).
  - An `ends_at` on the entry is refused while release 2 is not in
    the list or has no `published_at`: there is nothing to count the
    90 days from.
  - Only an **early** `ends_at` is refused. There is no upper bound: a
    later date is a longer window, which is always allowed.
  - The member is kept out of the manifest and out of the log's
    `index.json`; only the release log page's "End date" line reads
    it.
  - **Nothing requires the member.** A production release 1 entry
    without it passes every check, and then has no checked window at
    all: no check knows the default of 12 months either, so its
    `ends_at` would be whatever is typed (after `published_at`), and
    its log page would promise "at least 12 months". The 90 days of D2
    then rest on the release entry PR's review alone (W10-READINESS §3
    step 5). **Decided (owner, 2026-10-11, as recommended; not yet
    implemented):** `check:manifest` must refuse a production release
    1 entry without `ends_after_days: 90`. A small change to the
    validation, to make before the release entry PR (W10-READINESS
    B12).
- *The timeline.* W equals the notice period, so release 1 is never
  `deprecated`: the manifest that makes release 2 `active` (T0) sets
  release 1 `retired` with `ends_at` = T0 + 90 days. `active` to
  `retired` is a forward step, which the manifest checks allow. Email 1
  goes out with the notice job's next run, emails 2–4 at 30, 7 and 1
  days, and the deadline, the rescue and the deletion follow the table.
  The two parts marked "Not built" below are therefore needed by
  T0 + 120 days, not a year later.
- *What members are told.* Before T0 there is no date to show, so the
  window itself is stated: by the owner to each tester with the
  registration code; in release 1's log entry (`changes`: "This first
  release is kept for 90 days after release 2 replaces it, not the
  usual 12 months"); and on its release log page, whose "End date" line
  reads "Not set (90 days after a newer release replaces it)" for an
  entry with `ends_after_days`. From T0 the app, the release log and the
  emails show the date as for any retired release (RELEASE-UPDATES
  0.3.1 §3).

*As built (W8).* The member API's daily `VaultNoticeJob` (MEMBER-API
"Vault release notices") sends emails 1–4 (90, 30, 7, 1 days before
`ends_at`, for `deprecated` and `retired` releases; only the latest
milestone due) and the deadline email (`removed`, up to 14 days after
`ends_at`, not during a rescue), plus the hotfix email of §10.2 (a release
whose log says `security: urgent`, to members on its `affects` releases,
for 30 days; 0.1.13: first used by staging S10, serial 12, whose log
entry is `security: urgent` with `affects` S3–S9). It finds members through a new vaults-table index,
`sealed-release-index` (projects `vault_id`, `user_guid`, `state` only;
the `user-index` cannot answer "who is on release N"), with its own role
(`vettid-org-member-vault-notices`: `Query` on `vault-releases` and that
index, nothing else in the vault account). Each notice is sent once per
member, release, end date and milestone (a claim in the ratelimits table).
In-app: `GET /api/vault/status` carries the release's number, status,
`ends_at` and a `notice`. **Not built:** the D + 30 "erased" email and the
D + 37 deletion of stored objects (they need the cleanup role in the
bucket policy, §8.2); both wait until a release first nears its end.

**A stronger recovery counter does not reach vaults sealed to an
earlier release** (0.1.28; VAULT-MESSAGING 0.33.0 §11.14.13). A vault
that moves to a release with a stronger counter leaves its earlier
header sealed under the earlier key, and the earlier genuine image
still runs and asks only its own counter. Until that key is deleted
(at least 90 days of notice and the 30-day window), VettID can run the
earlier release on the old header. A member without a phone cannot
move the vault at all. That is why production's first release with
recovery carries both S3 and the outside store (release "R2"); the rule
for ending a release once the counter group (release "R3") exists is
decided when R3 is specified. On staging the earlier release is ended
and its key deleted after the 7-day window.

## 4. Spec changes needed before release 1

Release 1's code is frozen once members are on it, and C1/C2 bind every
later component to it. These changes therefore land first (W0, W1).

### 4.1 §11.10.7: scheduled deletion only, by a pinned principal

**New pinned release constants:** `retirementPrincipal` (the role ARN,
e.g. `arn:aws:iam::<account>:role/vettid-org-vault-key-retirement`) and
`retirementWindowDays` (30 in production, 7 in staging).

**Policy delta.** The example policy gains exactly these statements, and
the retirement role may be added to the read-only statement's principals:

```json
{ "Sid": "RetireAfterNotice", "Effect": "Allow",
  "Principal": {"AWS": "arn:aws:iam::111122223333:role/vettid-org-vault-key-retirement"},
  "Action": "kms:ScheduleKeyDeletion", "Resource": "*",
  "Condition": {"NumericEquals": {"kms:ScheduleKeyDeletionPendingWindowInDays": "30"},
                "StringEquals": {"kms:CallerAccount": "111122223333"}} },
{ "Sid": "RescueBeforeDeletion", "Effect": "Allow",
  "Principal": {"AWS": "arn:aws:iam::111122223333:role/vettid-org-vault-key-retirement"},
  "Action": ["kms:CancelKeyDeletion", "kms:EnableKey"], "Resource": "*",
  "Condition": {"StringEquals": {"kms:CallerAccount": "111122223333"}} }
```

**Check changes:**

- **Check 6 (actions).** Three actions move from "disqualifies" to
  "allowed only with":

  | Action | Allowed only with |
  |---|---|
  | `kms:ScheduleKeyDeletion` | a statement whose principal is exactly the pinned retirement principal, with `NumericEquals` `kms:ScheduleKeyDeletionPendingWindowInDays` = the pinned window |
  | `kms:CancelKeyDeletion`, `kms:EnableKey` | a statement whose principal is exactly the pinned retirement principal |

  These actions never share a statement with `Decrypt` or
  `GenerateDataKey`. Everything else in the "disqualifies" list stays,
  notably `PutKeyPolicy`, `CreateGrant`, `DisableKey`, `Encrypt`,
  `ReEncrypt*`, tagging and `kms:*`.
- **Check 7 (conditions).** One more accepted entry, only in the
  `ScheduleKeyDeletion` statement and required there: `NumericEquals` (not
  `…IfExists`, not another numeric operator) on
  `kms:ScheduleKeyDeletionPendingWindowInDays` with the single pinned
  value (string or number). `StringEquals` `kms:CallerAccount` stays
  required in the retirement statements.
- **Check 8 (principals).** In the retirement statements, `Principal` is
  exactly `{"AWS": "<pinned retirement principal>"}`: one ARN, not the
  account root, not the host role, not an array. The retirement principal
  must not appear in a `Decrypt` or `GenerateDataKey` statement.
- **Check 2 (metadata)** is unchanged: `KeyState` must be `Enabled`. A key
  pending deletion, or disabled after a cancellation, is refused for new
  seals until it is enabled again.
- **The once-per-key record** (`seal_key_verified`) stays valid: the policy
  still cannot change; only the key state can, along Enabled →
  PendingDeletion → deleted, or → Disabled → Enabled.

**Variants that must fail** (added to the table):

| Change | Failing check |
|---|---|
| `ScheduleKeyDeletion` without the window condition, or with `NumericGreaterThanOrEquals`, `…IfExists` or another value | 7 |
| `ScheduleKeyDeletion` or `CancelKeyDeletion` for the host role, the account root or a second ARN | 8 |
| `kms:DisableKey` for the retirement principal | 6 |
| `kms:EnableKey` in the `Decrypt` statement | 6 |
| A retirement statement whose principal is not the pinned one | 8 |

**§13.5** gains a row: *Retirement principal* — scheduling deletion of a
release key; 30 days later every vault still sealed to it is permanently
unopenable (availability, never confidentiality). Recovery: cancel within
30 days; a CloudTrail alarm on every `ScheduleKeyDeletion` (§8.7). The
"cannot" list is unchanged; the "can" list gains "end a release after
notice, after which vaults still sealed to it are lost".

The condition key and its 7–30-day range are documented by AWS; W2's
staging drill confirms the behaviour when the request omits
`PendingWindowInDays` (the procedure always passes 30 explicitly).

### 4.2 The manifest outgrows the unlock request

`vault.unlock` carries the whole signed manifest, capped at 4,096 bytes
because the request is padded to 12,288. A realistic entry (three PCRs,
the key ARN, status, date, notes URL) is about 530 bytes: **7 releases
fit**. This plan needs room for the active release, a year of deprecated
and retired releases (12–16 with hotfixes), and `removed` entries that a
live key still admits (another year's worth): 15–30 entries. Release 1's
parser would refuse every manifest after that, and could no longer unlock.

**Recommendation (M1):** the unlock request carries `manifest_sha256` and
`manifest_serial` instead of the document. The app still fetches and
verifies the manifest itself and already signs its hash (the unlock
signing string has `hex(SHA-256(manifest_bytes))`). The parent supplies
the document: the publish step also writes it to the vault data bucket
as `manifests/<sha256>.json`, and the parent passes the one with the
requested hash to the enclave. The enclave verifies the signature, the
hash and the serial exactly as now. A dishonest host can only withhold
it (denial of service, which it can do anyway). `MaxBytes` rises to
64 KiB, and the unlock request gains about 5 KB of slack.

Fallback (M2), if M1 is rejected: a compact entry (`release`, `pcr0`, key
id instead of ARN, `status`; PCR1/2, dates and notes move to the release
log), about 190 bytes, 21 entries, plus a hard cap on live entries, which
in turn caps cadence × window.

### 4.3 Statuses and dates

- New status `removed` (§3.2): not routed, no unlock, never a move target;
  listed only while some live key's sealing policy admits its PCR0, so
  check 6 keeps passing for that key. All four statuses are fixed at
  release 1 (C1).
- New optional field `ends_at` (RFC 3339) on `deprecated` and `retired`
  entries: the deadline apps show. Old parsers ignore it.
- §11.10.5: "VettID keeps each release's image and sealing key while any
  vault is sealed to it" becomes "until the release's `ends_at`", and
  `410 release_unavailable` covers `removed`.

### 4.4 Other text

- RELEASE-UPDATES §3 ("No deadlines") is rewritten: there is a deadline,
  announced at least 90 days ahead, after which an unmoved vault is lost;
  §1's "can never be changed by anyone" becomes "can never be changed,
  only deleted after the release's end date".
- VAULT-PLAN §5.1 and §7 risk 3, RUNBOOK's vault placeholder ("can never
  be deleted"), ARCHITECTURE's release paragraph.

## 5. Build

### 5.1 The EIF in CI

`nitro-cli build-enclave` needs Docker and the enclave kernel, command
line, init and NSM module blobs, not the Nitro Enclaves device (that is
needed only to run an EIF), so a GitHub arm64 runner can build it. The
blobs are part of PCR0, so they are pinned like the toolchain.

The blobs are not the nitro-cli package's (Linux 4.14 in every version
to date, unmaintained). (0.1.27, approved by the owner 2026-10-15.)

- **Today** (vettid-vault #79): the lock pins the set AWS publishes
  with an `aws-nitro-enclaves-sdk-bootstrap` release (`v6.6.79`, Linux
  6.6.79), of which vettid-vault keeps a copy as a release asset.
- **Later, by a change of the toolchain lock** (vettid-vault #87; not
  made yet, so no release uses it): a blob set (kernel, its config,
  command line, init, linuxkit, NSM placeholder) that vettid-vault
  builds from kernel.org source with a pinned compiler and a reviewed
  config, twice, byte for byte (`release/kernel`, `docs/KERNEL.md`),
  published as a vettid-vault release asset together with the
  corresponding source. The lock then pins the set by archive and
  per-file SHA-256 and by the hash of the kernel's input lock, and names
  the kernel release the enclave's self-test requires. The change needs
  the hardware run of §11.2.

The workflow:

- A new `release` workflow in vettid-vault, on `ubuntu-26.04-arm` (moved
  from 24.04 on 2026-10-05; measurements identical), runs
  the build inside `amazonlinux:2023` pinned by digest, with the
  `aws-nitro-enclaves-cli` package at a pinned version (1.5.0 today)
  verified by RPM checksum, and the runner's Docker socket mounted.
  The blob set is downloaded from `blobs_url`, checked by the archive's
  SHA-256 and installed from `blobs_dir` in place of the package's.
  `scripts/build-eif.sh` is reused; `eif-toolchain.lock` records the
  container digest, package version, the blob set's source
  (`blobs_version`, `blobs_url`, `blobs_dir`; for a source-built set
  also the kernel input lock's SHA-256 and the kernel release), the RPM
  checksums and the SHA-256 of the archive and of each blob
  (vettid-vault `docs/RELEASING.md`, "Changing the toolchain", shows
  how to check them by hand).
  `NITRO_CLI_ARTIFACTS` is set per build.
- It builds twice from clean (the existing `enclave-image` job already
  proves byte-identical binaries) and requires identical PCR0/1/2.
- Outputs, per channel (`prod`, `staging`): `vault-enclave.eif`,
  `measurements.json` (commit, binary SHA-256, PCR0–2, nitro-cli version,
  kernel blob set version, toolchain lock hash), the `vault-parent` arm64 binary and its SHA-256.
- **Confirm in W2:** the CI-built EIF's PCR0 equals one built on a
  Graviton host from the same commit with `run-on-host.sh build`. If
  nitro-cli cannot run in the container, the fallback is the same build
  on an Image Builder instance (§8.3), which is slower but equally
  reproducible.

### 5.2 Release configuration without breaking reproducibility

The release constants in `enclave/config.go` move into committed,
embedded files, one per channel: `enclave/releasecfg/prod.json` and
`staging.json` (`go:embed`, selected by the build argument `CHANNEL`,
whose value is recorded in `measurements.json`):

| Constant | Production value | Source |
|---|---|---|
| `release` | N | the release commit |
| `manifest_keys` | SPKI of key A and key B | §6.1 |
| `seal_account`, `seal_region` | the vault production account, `us-east-1` | owner decision O1 |
| `retirement_principal`, `retirement_window_days` | the retirement role ARN, 30 | §4.1 |
| `android_signers` | 1 to 4 entries `{"digest": "<SHA-256 of a signing certificate, 64 lowercase hex>", "class": "vettid" \| "google_play" \| "development"}` (0.1.12; a bare list of digests before) | owner decision O8 as amended 2026-10-11 |
| `android_package` (0.1.11) | `com.vettid.app` (staging: `com.vettid.app.staging`) | VAULT-MESSAGING 0.26.0 §11.10.8, "Android package"; STAGING-DEVELOPMENT-PLAN D5 |
| `features` (0.1.11) | the optional features the image registers: none in release 1 (staging: all seven) | VAULT-MESSAGING 0.26.0 §11.10.8, "Feature allowlist"; STAGING-DEVELOPMENT-PLAN D4 |
| `relay_url` | `https://relay.vettid.org` | |
| `calls_url` (0.1.19; planned for staging "release C2"; approved by the owner 2026-10-12) | absent (staging: `https://calls.staging.vettid.org`) | VAULT-MESSAGING 0.28.0 §11.10.8; CALLING-SERVICE 0.2.0 §5; CALLS-PLAN D4 |
| `recovery_counter` (0.1.28, release R) | `{bucket, account, region}` of production's counter bucket (§8.2); staging: its own bucket in the staging account | VAULT-MESSAGING 0.33.0 §11.14.4; VAULT-HOST-PROTOCOL §8.1 |
| `recovery_request_keys` (0.1.28, release R) | one or two `{key_id, spki}` of the member API's recovery request key (§8.2) | VAULT-MESSAGING 0.33.0 §11.14.8 |
| `recovery_wait_unit_seconds`, `recovery_quiet_seconds` (0.1.28, release R) | 86,400 and 259,200 (staging: 600 and 259,200) | VAULT-MESSAGING 0.33.0 §11.14.6, §11.14.14 |
| `recovery_offered` (0.1.28, release R) | `true`; `false` only for a production release that ships before the outside store (§12) | VAULT-MESSAGING 0.33.0 §11.14.13 |
| `android_min_version_code` (0.1.28, release R) | the first app version code that implements release R | VAULT-MESSAGING 0.33.0 §11.14.14 |

GrapheneOS verified-boot keys and vendor roots stay in `vms/pins` (code).
Everything that defines a release is in the tagged tree, so
`git checkout release/prod/N && make eif CHANNEL=prod` reproduces it; no
`-ldflags -X` and no build-time secrets. A missing or zero value still
fails closed.

**Android signers (0.1.12; owner decision of 2026-10-11, ANDROID-PLAN
0.1.36 §7).** Each entry names a certificate and its class
(VAULT-MESSAGING 0.27.0 §11.7.1, §11.10.8): `vettid` for a key only
VettID holds (the F-Droid and direct builds), `google_play` for the
Play app-signing key, which Google generates and holds, `development`
for a development or automation key. The file is embedded, so the
classes are measured into the image with the digests; the vault labels
a member's app from them and never from anything the app says. The
release build refuses an entry without a class, an unknown class, a
duplicate digest, the bare-string form and, in `prod.json`,
`development`.

- **Production release 1:** one entry,
  `{"digest": "31a19613aa10f209e08945f947f94f7ce3e6e5ac342457ff9969a67986928e65", "class": "vettid"}`,
  the certificate `prod.json` already lists. The `TODO-O8` placeholder
  is deleted. Release 1 is for the owner and at most ten named testers
  (STAGING-DEVELOPMENT-PLAN D7), who install the direct or F-Droid
  build, so it does not wait for a Google Play account.
- **The Play certificate** is added, class `google_play`, by the
  production release cut once the owner has enrolled the app in Play
  App Signing and read the app-signing certificate's digest there (to
  confirm in the Play Console). An app installed from Google Play
  cannot enroll, receive a transfer or register for a recovery on a
  release that does not pin it, so **the Play listing does not go
  live, on any track members can install from, before such a release
  is `active`**. The Play upload certificate is never pinned.
- **Signer binding** (VAULT-MESSAGING §11.7.1) is in release 1 (owner
  decision, 2026-10-11), so that no production vault ever exists
  unbound and none needs the binding-by-chain step.
- **Staging:** the staging signing certificate is `vettid` and the
  automation certificate `development` (STAGING-DEVELOPMENT-PLAN §4).
  S10 carries this with `android_package` and `features` (0.1.11); how
  the binding and the move to `com.vettid.app.staging` compose is in
  VAULT-MESSAGING §11.7.1.
- **As built** (0.1.13; vettid-vault #62–#64, in S10; VAULT-MESSAGING
  0.27.1). The feature list's only-grow check compares with the
  channel file at the **highest existing tag `release/<channel>/<m>`
  below N**, and runs in the release workflow's gate on a release tag
  (`releasecfg check -previous`), not in the image or in a rebuild
  from the tag alone. Staging's acceptance of vaults with no recorded
  signer is **not a constant of the file**: the image derives it from
  its channel and release number (staging, release 10 or lower), so
  `prod.json` cannot express it. Since S10 the images also apply the
  key attestation chain rules of VAULT-MESSAGING §11.7 (the fix that
  made S10 an urgent security release).

**Recovery constants and the production build rule (0.1.28; wording
for the owner's approval; release R).** Staging tests recovery's waits
with a wait unit of 10 minutes; production's is 24 hours. The release
build MUST refuse a `prod.json` whose `recovery_wait_unit_seconds` is
below 86,400 or whose `recovery_quiet_seconds` is below 259,200, MUST
refuse a production image in which a test clock can be set (the
development stack's recovery clock, `RecoveryNow` in vettid-vault, is
compiled out of release images), and MUST refuse a `recovery_counter`
that names another channel's bucket or account. A test run on the
production image itself asserts all three, as for `features`. The
quiet period is the same on staging, so staging tests it in real time.

**The calling service's issuer (0.1.19; planned; approved by the owner
2026-10-12).** `calls_url` is optional, and the release build
refuses it unless `features` lists `calls` and it is an `https` URL of
its own channel's host name alone (VAULT-MESSAGING §11.10.8). A staging
release that carries it ("release C2", CALLS-PLAN §13) must also
contain, from the same tag (C4: the host files and the parent travel
with the release):

- the enclave's release allowlist with the host of `calls_url` (Amazon's
  roots, HTTP/2), as it has the push gateway's;
- a `vault-parent` whose `DefaultAllow` names the issuer (§8.4);
- the `calls` feature with the rules VAULT-MESSAGING §10.10 marks (C2);
- a log entry (§7) that says in the member's words what changes: calls
  can connect across networks through VettID's relay server, which
  cannot hear them; unanswered calls end by themselves; calls can be
  turned off per connection.

Before its hosts start, the staging host stack is deployed with the
issuer's name in the DNS Firewall (§8.4), and the calling service
answers at that name (CALLING-SERVICE §8, §11). A release with
`calls_url` whose issuer cannot be reached still works: its vaults give
their devices no TURN server, as every release before it. Production's
file has no `calls_url` and production's `features` no `calls` until
promotion (STAGING-DEVELOPMENT-PLAN §2.4).

### 5.3 Provenance

- **GitHub artifact attestations** (`actions/attest-build-provenance`,
  Sigstore-backed SLSA provenance) for the EIF, `measurements.json` and the
  parent binary; anyone can check them with `gh attestation verify`.
  Recommended: cheap, and it binds the artifacts to the workflow run and
  commit.
- The release tag is signed (SSH or GPG signing on the tag).
- **Two-builder rule:** before the manifest entry is signed, the owner
  rebuilds the tag on a separate arm64 machine (or a Graviton host) and
  the PCR0s must match. The release log explains how anyone can repeat it.
- The attestations are convenience; the authority members rely on is the
  PCR0 in the signed manifest, checked by attestation and by KMS.

### 5.4 Enclave kernel currency

(0.1.27, approved by the owner 2026-10-15; from vettid-vault #87.)
vettid-vault checks weekly whether the enclave kernel is the newest
point release of its kernel.org longterm series and whether kernel.org
marks the series end of life; when a newer point release exists it
opens an issue with the change to make. When the pinned kernel is more
than 30 days behind the first newer point release, or its series is end
of life, the weekly check and the release workflow show a warning. It is
a warning, not a block: the maintainer moves the kernel at the next
monthly release, or says in the release notes why not. A kernel change
needs the hardware run (§11.2). The check applies to whichever set the
lock pins (§5.1): with AWS's 6.6.79 pinned today it warns on every run.

## 6. Keys

### 6.1 Manifest signing keys

- **Key A**: KMS `ECC_NIST_P256`, `SIGN_VERIFY`, in the vault production
  account (or a separate signing account, O3). `kms:Sign` only for the
  `vettid-org-vault-manifest-signer` role, which only the owner can assume
  with MFA. Ordinary key policy (deletable, an admin statement without
  `kms:Sign`): this key is not checked by the enclave, and losing it is
  covered by key B. *As built (W5):* the role trusts only the owner's IAM
  Identity Center permission-set role in the vault account
  (`AWSReservedSSO_VettIDAdmin_*`); MFA is enforced by Identity Center at
  sign-in. A `aws:MultiFactorAuthPresent` condition cannot be used: that
  key is absent from Identity Center (SAML-federated) sessions, so the
  role would become unassumable. The signer role also writes
  `manifests/*` in the data bucket (the only principal that may).
- **Key B**: P-256 on an offline hardware token (for example a YubiHSM 2
  or a smartcard), kept in a safe, used only if A is lost or compromised.
- Both public keys are pinned in every production image and app
  (`key_id` selects one). Rotating away from A means: sign with B, ship a
  release pinning B and a new A′, and retire releases pinning only A over
  the normal window.
- Signing is a step in the owner's release checklist
  (`scripts/vault/manifest.ts`, `npm run vault:manifest`, which renders
  the manifest from the release list, increments `serial`, signs with KMS
  and writes the served document). A gated workflow with required
  reviewers can replace it once there is a second person to review.
- Staging uses its own deletable KMS key.
- *As built (W7).* `lib/config.ts` `manifestKeys` pins key A in production
  (`alias/vettid-org-vault-manifest`, key_id `4353463f85c4012f`) and the
  staging key (`alias/vettid-org-staging-vault-manifest`, key_id
  `e9b3a403423120ac`), from `aws kms get-public-key`. Key B (key_id
  `1abd49da96970b6e`, P-256 generated on the owner's YubiKey, PIV slot
  9c, 2026-10-04) is pinned too (#100), as it is in vettid-vault's
  `releasecfg/prod.json` and in the app. A served document carries one
  signature and `key_id` selects the pinned key that verifies it
  (VAULT-MESSAGING §11.10.1), so manifests signed with key A alone are
  complete, not weakened; key B had to be pinned before production
  release 1 because a key an image does not pin can only be introduced by
  a new release. Signing is `scripts/vault/manifest.ts sign`,
  which drives vettid-vault's `vaultctl manifest render/check/sign` (not a
  second signer implementation) as the signer role and re-checks the
  result with this repository's renderer and verifier.

### 6.2 Release sealing keys

One key per release, created in `VettidOrgVaultStack` by a custom
resource (`aws-kms.Key` always adds an administrator statement):

- `CreateKey` with `KeySpec SYMMETRIC_DEFAULT`, `KeyUsage
  ENCRYPT_DECRYPT`, `Origin AWS_KMS`, `MultiRegion false`, the policy
  rendered from the release list, `BypassPolicyLockoutSafetyCheck: true`,
  and tags `vettid:release`, `vettid:channel` given at creation. No alias
  (`CreateAlias` would need a key-policy permission). The ARN goes to SSM
  `/vettid-org/<stage>/vault/releases/<n>/seal-key-arn`.
- The policy, from the spec's normative example plus §4.1: `Decrypt` for
  the host role with the release's PCR0; `GenerateDataKey` for the host
  role with the PCR0s of release N, of **every earlier release not
  `removed`** when N's key is created (all of them may still move into
  N) and, from 0.1.24, of **every `removed` release that can still be
  rescued** then (its `ends_at` plus the channel's window has not
  passed, §3.5: a rescued vault moves into N); reads for the
  host role and the retirement role; the two retirement statements.
  `kms:CallerAccount` on every attestation statement.
- **Immutable resource:** an update with changed properties fails the
  deploy; delete is a no-op (the key outlives the stack; only retirement
  deletes it). Only the custom resource's role may call `CreateKey` with
  the bypass flag (IAM condition `kms:BypassPolicyLockoutSafetyCheck`, and
  an SCP in a separate account).
- *As built (W5):* the function `vettid-org-vault-release-key-creator`
  (role of the same name, asynchronous retries off) checks the rendered
  policy against a TypeScript port of the enclave's `keypolicy` rules and
  the stack's pinned account, region, roles and channel window before
  `CreateKey`; a policy the enclave would refuse never reaches KMS. Its
  physical id is `<key ARN>|<SHA-256 of the properties>`, so an update
  with changed properties fails while a rollback to the original
  properties (or a new service token) succeeds. The port is tested against
  vettid-vault's recorded `keycheck` fixtures and every "must fail"
  variant of §11.10.7 (`test/vault-keypolicy.test.ts`). Its role may
  create only symmetric, single-region `AWS_KMS` keys, and tag them only
  with `vettid:release` and `vettid:channel`.
- **Verification, three layers:**
  1. CDK assertion tests compare the rendered policy with the spec
     example's shape for every release in the release list.
  2. `vaultctl keycheck` (new, W2) runs the enclave's own `keypolicy`
     package against the live key's `DescribeKey`, `GetKeyPolicy` and
     `ListGrants`, fetched as the retirement role (a reader in the
     policy), with the draft manifest. The release stops if it fails.
  3. The release enclave itself checks the key at the canary's first
     enrollment (`release_key` on failure).

### 6.3 Roles named in key policies must never change

A key policy that names a role keeps naming it forever. If the role is
deleted, KMS shows its unique id instead of the ARN; a re-created role
with the same name does not match; and the enclave's check 8 then fails
on every such key (a principal not in ARN form). Deleting the **enclave
host role** would make every vault of every release unopenable; deleting
the retirement role would make every key undeletable and fail check 8.

So: both roles have fixed names, live in the stateful
`VettidOrgVaultStack` with `RemovalPolicy.RETAIN` and termination
protection, are covered by a guardrail test (name and retention), and,
in a separate account, by an SCP denying `iam:DeleteRole` and
`iam:UpdateAssumeRolePolicy` on them except for a break-glass role.
Their permissions (IAM policies) may change; their ARNs may not.

*As built (W5):* the names are `vettid-org-vault-host` (with an instance
profile of the same name) and `vettid-org-vault-key-retirement`, the same
in both vault accounts. The SCP is `lib/org/scp-vault.json`, applied to
the Vault OU by `scripts/vault/apply-scp.sh` from the management account.
It has no in-account exception: the break-glass is detaching or editing
the SCP from the management account, which nothing inside a vault account
can do. It also denies the lockout bypass (`CreateKey`, `PutKeyPolicy`)
to every principal but the creator role, denies the creator role
`PutKeyPolicy`, and keeps the creator function's code, configuration and
role (trust, `PassRole`) to CloudFormation's deploy role.

## 7. Manifest and release log

- **Source of truth:** the release list in this repo (as built:
  `vault/releases/<channel>.json`, below): per release its
  number, tag, commit, PCR0–2, binary hash, nitro-cli version, admitted
  PCR0s, seal-key ARN (after creation), status, `published_at`, `ends_at`,
  window, instance settings, notes URL (the release's log entry, below)
  and log text. CDK (keys and release stacks)
  and the manifest renderer both read it.
- **Served document:**
  `website/.well-known/vettid/pcr-manifest.json`, committed and deployed
  with `npm run deploy:site` (JSON is served `no-cache`; `/.well-known/*`
  is already exempt from the hostile-path layer). The git history of that
  file is a public, append-only record of every manifest. The publish step
  also copies the document to `s3://<vault data bucket>/manifests/<sha256>.json`
  (M1).
- **CI check** (`npm run check:manifest`): the signature verifies under a
  pinned key; `serial` is greater than the previous commit's; the bytes
  equal a fresh render of the release list; the size limit; every PCR0
  admitted by a live key is listed; every `removed` release that can
  still be rescued is admitted by the newest `active` release's key
  (0.1.24, §3.5); every listed release has a release-log
  entry, in every channel (below, "Release notes on every channel").
- **`serial`:** increases by one per publication; it is never reused, even
  for a canary manifest that is never published (§10.1).
- **Release log:** `/security/releases/` on each channel's site
  (vettid.org, staging.vettid.org), one page per release with the
  RELEASE-UPDATES §5 fields, generated from the release list so it
  cannot disagree with the manifest. It stays after a release is
  removed.
- **Registry sync:** a `vault-manifest-sync` Lambda (every 5 minutes and
  after each site deploy) fetches the manifest, verifies it against the
  pinned keys, and upserts `vettid-org-vault-releases` (status, number,
  seal key, `ends_at`). `available` comes from the release stacks (SSM).
  The API never trusts the table for security; it only routes.
  *As built (W6):* in the host stack (`lambda/vault/manifest-sync.ts`,
  verification in `lambda/shared/manifest.ts`, tested against
  vettid-vault's recorded manifest vectors). The keys are pinned in
  `lib/config.ts` (`manifestKeys`, empty until the SPKIs are final: the
  sync then does nothing). "After each site deploy" is a manual
  `aws lambda invoke` (the site deploys from another account). It also
  writes `manifest_serial`, `manifest_sha256` and `synced_at`, refuses a
  lower serial (or the same serial with other bytes), deletes rows of
  releases the manifest dropped, and alarms when the bucket copy
  `manifests/<sha256>.json` is missing. The copy itself stays the
  signer's publish step (only the signer role may write `manifests/*`;
  W7's `scripts/vault/manifest.ts`).

*As built (W7).*

- **Release lists:** `vault/releases/prod.json` and `staging.json`
  (`lib/vault/release-list.ts`): per release the manifest fields, `status`
  (`candidate` or a manifest status), `admitted_pcr0s` (fixed at key
  creation; 0.1.24: while `seal_key` is empty the validation refuses
  a list that leaves out a release of §6.2, judged at the time of the
  check, and `check:manifest` and `vault:manifest sign` report one that
  names a `removed` release past its window), an
  optional `host` (the release stack's pins; absent: no stack; 0.1.24:
  on a `removed` entry only together with `rescue: true`, the marker of
  a rescue in progress, §10.3 step 3, which like `host` is never in the
  manifest) and, in production, `log` (summary, changes, `security`: `none`,
  `recommended` or `urgent`, `security_text`, `affects`). Plus
  `signed_serial`, the highest serial ever signed. CDK builds one release
  key per entry and one release stack per entry with `host`; synth fails on
  an invalid file. The files are also valid `vaultctl manifest render
  -releases` input (it ignores the extra members). The window is not a
  field: `ends_at` is set explicitly per §10.3. (0.1.11: one exception,
  `ends_after_days` on production release 1, §3.5.)
- **Served files:** production `website/.well-known/vettid/pcr-manifest.json`;
  staging `vault/staging/pcr-manifest.json`, served byte for byte at
  staging.vettid.org by `VettidOrgStageSiteStack` (W9). Staging has
  served a manifest since S1 was published (W9); production serves
  nothing until release 1: an empty manifest is not valid (it lists at
  least one release), and nothing may be served before the first release is
  published. The URL answers 404 until then; the manifest sync treats 404
  (or a missing host) as "nothing published yet" while it has never synced
  a manifest, and as an error after. The site serves the JSON with the
  existing `no-cache, must-revalidate` pass for `*.json`
  (`application/json`), the site CSP and HSTS; `/.well-known/*` is exempt
  from the hostile-path rules. No CORS: apps are native, and the account
  site reads release status from the member API.
- **Signing and publishing:** `scripts/vault/manifest.ts` (`npm run
  vault:manifest`): `sign` (render through vaultctl with serial =
  max(served, `signed_serial`) + 1, cross-checked against this
  repository's render; `signed_serial` raised in the file first; KMS key A
  as the signer role; written under `local/`), `upload` (the bucket copy
  `manifests/<sha256>.json`, If-None-Match, as the signer role: what a
  canary needs), `publish` (verify again, require an exact render of the
  release file, upload, confirm the bucket copy as the vault account's
  admin, then write the served file and the release log and commit only
  those paths; the site deploy serves it). RUNBOOK "Publishing a manifest".
- **`npm run check:manifest`** (CI, full history): for each channel the
  release file; the served document's signature under the pinned keys and
  its size; manifest bytes exactly a render of the release file; serial ≤
  `signed_serial`; every committed version of the served file a valid
  successor of the one before (serial strictly increasing, gaps allowed for
  unpublished canary serials; no release dropped before `removed`; statuses
  only forward; PCRs, `seal_key` and `published_at` unchanged; the file
  never deleted once published); status and date consistency (an active
  release, deprecated or retired ones older than it, `ends_at` on retired,
  `retired` within 90 days of `ends_at`, nothing past its `ends_at` still
  running); every admitted PCR0 listed; (0.1.24) a rescue target for
  every `removed` release still in its window, an `ends_at` on every
  `removed` release that was ever published as running, none of them
  after the manifest's `issued_at`, no `rescue: true` entry past its
  window, and no candidate without a key that names a `removed`
  release past its window; for production, the release log
  pages current.
- **Release log:** `/security/releases/` (`lib/vault/release-log.ts`,
  `scripts/vault/release-log.ts`): an index (number, publication date,
  channel, PCR0, status, end date) and one page per release (the
  RELEASE-UPDATES §5 fields, rebuild instructions), in the site's design
  and CSP (no scripts beyond the shared nav, no inline style attributes),
  plus `index.json`, which also remembers releases the manifest has
  dropped so their entries stay. Until release 1 the index says that no
  release has been published; it is linked from `/security` and the
  sitemap.

**Release notes on every channel** (owner request 2026-10-10,
RELEASE-UPDATES 0.3.0 §5; to build, replacing the W7 rule that only
production carries `log`):

- **`log` is required for every release in every channel once it leaves
  `candidate`**, that is, from the moment it is signed into a manifest
  (a canary or a published one). The release-list validation
  (`lib/vault/release-list.ts`) enforces it, so `vault:manifest sign`,
  CDK synth and `check:manifest` all refuse a non-candidate entry without
  it. Why there and not at publication: the signed bytes fix the `notes`
  URL, and the text behind it must exist, reviewed, when they are
  signed. A `candidate` may carry `log` already (it is reviewed in the
  release PR, §10.1 steps 4 and 5).
- **Text limits** (validation): `summary` one line, 1–160 characters;
  `changes` 1–20 items, each 1–280 characters; `security_text` at most
  1,000 characters; all plain text (no control characters, no markup;
  the app shows them as written).
- **`notes` is the channel's own log entry**:
  `https://<zoneName>/security/releases/<n>/` (production
  `https://vettid.org/security/releases/<n>/`, staging
  `https://staging.vettid.org/security/releases/<n>/`), required by the
  validation in both channels (`releaseLogUrl(channel, n)`). A new
  successor rule: once a published release's `notes` is its log URL it
  never changes (until now `notes` was not compared between serials,
  which the staging backfill below relies on once).
- **Staging log:** generated by the same code (`lib/vault/release-log.ts`
  and `scripts/vault/release-log.ts`, given the channel) from the staging
  manifest and `vault/releases/staging.json` into
  `sites/staging/security/releases/` (pages and `index.json`), served by
  `VettidOrgStageSiteStack` with the manifest. Its pages say "Staging
  (test builds)" in the title and the intro, and link the staging
  manifest. `vault:manifest publish --channel staging` writes and
  commits it like production's; `check:manifest` checks both channels'
  logs current (today: production only).
- **`index.json`** is what the app reads (ANDROID-PLAN §4 "What's new"):
  the existing entry fields, unchanged in shape (`release`, `pcr0`,
  `status`, `summary`, `changes`, `security`, `security_text`, …). It is
  public and unsigned; the app treats it as information only. Served
  `no-cache` like every `*.json` on the sites.
- **Links per stage:** the notice job's `RELEASE_LOG_URL` and the account
  site's `release_log_url` are `https://<zoneName>/security/releases/`
  (staging today links production's log). The emails take each release's
  link from its `notes` (§3.5).
- **Backfill (staging S1–S9).** S1–S8 are published without `log` and
  with GitHub release URLs as `notes`; S9 is a `candidate`. The
  implementation PR adds to each a short `log`: a one-line summary and
  the changes taken from its existing GitHub release notes, `security:
  none` (staging builds fix nothing for members). S1 and S2 are included
  because they are `removed` but still listed, and the generator needs
  text for every listed release. Their `notes` switch to their staging
  log URLs in the next staging manifest signed after that PR (one
  publication for all of them; S9 too if it is still unpublished then).
  The manifests already signed (serials 1–10, and any signed before the
  change) keep their GitHub URLs in git history; nothing is re-signed or
  rewritten. Production has nothing to backfill: release 1 is not
  published and its entry already needs `log` (W10-READINESS step 5).

## 8. Infrastructure

### 8.1 Accounts

The AWS organization today has one account, which is also the management
account (SCPs cannot restrict it). Every production image pins its
sealing-key account, and a vault can only move to a key in that account,
so the choice is effectively permanent for release 1's vaults (leaving
takes two moves). Recommendation (O1): a new **vault production account**
for the release keys, host role, retirement role, hosts, data bucket and
control queues, decided before release 1; a **staging account** (O2) for
the whole staging copy (`-c stage=staging`, which `lib/config.ts` already
supports).

With a separate vault account, the member API (main account) needs
`sqs:SendMessage` to the vault account's queues (the parent creates each
queue with a policy that allows the member API's roles), and the parent
needs the vault tables. Recommended: the vault tables move into the vault
account's `VettidOrgVaultStack` and the member API's vault, cleanup and
alarm functions assume a narrow cross-account role there. The spec's
"in its own account" (§11.1) becomes "in the pinned vault account".
About 3–5 extra days (W5). If O1 is "one account", everything below
applies unchanged in the current account.

*As built (W5).* Accounts per stage (`lib/config.ts`): `prod` runs the
vault stacks in vettid-vault-prod (369484479783) and everything else in
the management account (449757308783); `staging` runs both in
vettid-vault-staging (347272280361). The vault tables moved to the vault
account as recommended, but instead of an assumed role the access is by
**resource policies**, which is equally narrow and needs no credential
handling in the Lambda code:

- The three member API functions get fixed role names
  (`vettid-org-member-vault`, `vettid-org-member-cleanup`,
  `vettid-org-member-vault-alarms`). One matrix (`lib/vault/access.ts`)
  renders both their identity policies and the vault account's table
  resource policies (account root of the API account narrowed by
  `aws:PrincipalArn`, so neither side must exist first), with the same
  `dynamodb:Attributes` limits. The handlers address the tables by ARN
  (DynamoDB accepts a table ARN as `TableName`).
- The alarm mailer reads the vaults stream across accounts (Lambda
  supports cross-account DynamoDB Streams event sources through the
  stream's resource policy, which admits only that role). The stream ARN
  carries a creation label, so it is context `vaultsStreamArn` set from
  VettidOrgVaultStack's output after its first deploy.
- The control queues: the parent applies the queue policy published as
  SSM `vault/control-queue-policy` (send only, only the vault and cleanup
  roles) when it creates each queue. **vettid-vault follow-up:** the
  parent sets that `Policy` attribute in `CreateQueue`.
- No `Fn::ImportValue`, no cross-account SSM: everything is derived from
  fixed names and account ids, except the stream ARN.

*As built (W9, part A).* `staging` now has a main account too, the same
vettid-vault-staging (`lib/config.ts`), so in staging the "cross-account"
policies above admit roles of the same account. The stream ARN is context
`stagingVaultsStreamArn` (prod keeps `vaultsStreamArn`), so a staging synth
never picks up production's. The staging copy's DNS is its own zone
`staging.vettid.org` in that account; vettid.org delegates to it with one
NS record (`VettidOrgStagingDelegationStack`, management account, context
`stagingZoneNs`). Its system mail comes from `no-reply@staging.vettid.org`
(an SES domain identity in the staging zone; SES stays in the sandbox).

### 8.2 Stacks

| Stack | Kind | Owns | Approx. resources |
|---|---|---|---|
| `VettidOrgVaultStack` | stateful, RETAIN, termination protection | data bucket; host role; retirement role; manifest-signer role and key A; release-key custom resource and one key per release; vault tables (if O1); SSM refs `vault/*` | 40 + 2 per release |
| `VettidOrgVaultHostStack` | stateless | VPC (2 AZs, public subnets, no NAT, S3 + DynamoDB gateway endpoints); host security group; DNS Firewall; DLQ; log groups; scaler and manifest-sync Lambdas; Image Builder infrastructure configuration; smoke test key; alarms | ~70 |
| `VettidOrgVaultRelease<N>Stack` | stateless, one per live release | Image Builder component, recipe and image (the AMI); launch template; ASG (min/max from the release list); termination lifecycle hook; per-release alarms | ~12 |

Recommended over one stack with all release groups: a deploy for release
N+1 cannot touch release N's instances (D1: no fleet instance refresh,
never replace an old release's instances with a new release); retiring a
release is deleting its stack; and each stack stays far below the 200-
resource guardrail. No `Fn::ImportValue`: release stacks read the host
stack's refs through SSM (RUNBOOK conventions).

*As built (W6).* `lib/stacks/vault-host-stack.ts` and
`lib/stacks/vault-release-stack.ts`; the app builds the host stack in each
vault account and one release stack per entry of `lib/vault/releases.ts`
(empty; since W7 the entries with a `host` in
`vault/releases/<channel>.json`, and `lib/vault/releases.ts` keeps only
the spec's shape and checks). Release stacks read
`vault/host-security-group-id`, `host-subnet-ids`, `image-builder-infra-arn`
and `alerts-topic-arn`, and publish `vault/releases/<N>/group-name`. The
host stack also publishes `dlq-arn`, `relay-host`, `host-log-group` and
`smoke-key-arn` for the hosts' boot. The lifecycle hook is inline in the
group (`vault-drain`, 300 s, default CONTINUE); per-release alarm: desired
> in service for 15 minutes. Both stacks stay far below 200 resources
(guardrail test).

**Data bucket** `vettid-org-vault-data-<account>`: block public access,
SSE-S3 (objects are already DEK-encrypted or KMS-sealed), TLS only,
versioned; a noncurrent version expires 1 day after it was replaced
unless it is one of the 5 newest noncurrent versions of its object, and
in any case after **7 days**; a delete marker expires once no version is
left under it (O9). Prefixes: `vaults/`, `users/`, `manifests/`. Conditional writes
(`If-None-Match`, `If-Match`) work on versioned buckets. Host access is
limited to `vaults/*`, `users/*` and reading `manifests/*`; the cleanup job
deletes `vaults/*` and `users/*` (VAULT-PLAN V5 account deletion).
*As built (W5):* the bucket policy denies every object action on
`vaults/*`, `users/*` and `smoke/*` to every principal but the host role,
and writes to `manifests/*` to every principal but the signer role. The
cleanup job's object deletion (D + 37, W8) is not granted yet: W8 adds its
role to that exception. Restoring an older object version (§11.4) means
editing the bucket policy first.

*0.1.28 (release R).* The data bucket's version rule is also what
makes the one write fault of a DEK replacement repairable
(VAULT-MESSAGING §11.14.2): a store that confirmed a header it did not
keep leaves the earlier state as a noncurrent version beside the header
that is still current, and an operator restores it (RUNBOOK). Under the
rule that is **safe within 24 hours** of the failure (rule 2: 1 day unless
among the 5 newest noncurrent versions) and possible up to **7 days**
only while the state was written fewer than 5 times since (rule 1). The
rule MUST NOT be shortened below either: 1 day with the 5 newest kept,
and 7 days at most. It is VettID's own rule and protects nobody against
VettID; members cannot check it.

**Recovery counter bucket** (0.1.28, release R; VAULT-HOST-PROTOCOL
§8.1). One per channel, in `VettidOrgVaultStack` of the vault account
(production: the vault production account; staging: the staging
account), named `vettid-org-vault-recovery-<account>`, RETAIN: Object
Lock enabled at creation, versioning on, block public access, SSE-S3,
TLS only, **no default retention**, and **no lifecycle rule that expires
a current version**. A rule MAY expire noncurrent versions of present
markers whose locks have ended, and MUST NOT remove a vault's newest
present record: after its 96-hour lock its existence rests on VettID,
and a vault with none cannot be recovered. The host role gets
`s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObjectVersion`,
`s3:GetObjectRetention` and `s3:ListBucketVersions` on it and nothing
else; no role used by the hosts gets a delete, bypass-governance,
legal-hold or configuration permission. The bucket's name, account and
region are the release constant `recovery_counter`. No principal can
shorten or delete a compliance-locked version, the root user included;
AWS acting for VettID could, which VAULT-MESSAGING §11.14.12 states.

**Recovery request key** (0.1.28, release R; VAULT-MESSAGING
§11.14.8). An ECDSA P-256 KMS key (`SIGN_VERIFY`) in the account that
runs the member API, alias `alias/vettid-org-recovery-request` (staging
`alias/vettid-org-staging-recovery-request`), RETAIN, whose
policy allows `kms:Sign` to the member API's vault function only and
`kms:GetPublicKey` to the release build; its public key is pinned in
`recovery_request_keys`. A replacement is pinned beside the old key for
one release first.

### 8.3 Hosts and the AMI

- **Instance:** Graviton `m7g.large`, on demand (D2), Nitro Enclaves on,
  IMDSv2 with hop limit 1, encrypted gp3 root (20 GiB), no key pair, no
  inbound, no interactive access (Session Manager sessions, EC2 Instance
  Connect and the serial console are denied to every principal by the
  Vault OU policy); operated through Systems Manager Run Command only
  (each command is recorded in CloudTrail and reported; its content is
  not recorded), public IPv4 in a public subnet.
- **AMI:** EC2 Image Builder, one image per release, built at deploy time
  by the release stack (`CfnImage`; the AMI id feeds the launch template
  directly). The component installs, from pinned sources with checksums:
  AL2023 arm64 (AMI pinned in `cdk.context.json`), nitro-cli and the
  allocator (enclave: 1 vCPU, 5 GiB, O6), the release's `vault-parent`
  and EIF from the GitHub release, **verified against
  `measurements.json`** (the build fails on a mismatch), systemd units, the
  CloudWatch agent. Recommended over a script: no hard-coded VPC or
  builder host (vettid.dev's `deploy-enclave.sh`), the recipe is in CDK,
  and the build runs in our account in the host stack's VPC.
- **Host OS patches:** rebuild the same release's image (new recipe
  version, same EIF and parent) and roll that release's group only. The
  AMI is not measured, so this needs no member approval.
- **Boot:** user data reads `/vettid-org/<stage>/vault/*` refs, starts the
  allocator, `nitro-cli run-enclave` (never `--debug-mode`), then
  `vault-parent` with the region, bucket, table names, queue prefix, DLQ and
  relay host. No secrets exist on the host.
- **Shutdown:** the ASG termination lifecycle hook gives the parent up to
  5 minutes to lock its vaults, release leases, delete its queue and
  deregister, then completes the hook.
- *As built (W6).* The component (`lib/vault/image-component.ts`) pins per
  release: tag, source commit, PCR0, the SHA-256 of `measurements.json`
  (which pins the EIF and parent hashes), the SHA-256 of vettid-vault's
  `deploy/host/SHA256SUMS` at that commit, the nitro-cli package version
  and the base AMI. It checks `nitro-cli describe-eif`'s PCR0 too, then
  runs the commit's `deploy/host/install.sh` (units, allocator 1 vCPU /
  5 GiB = 5120 MiB, `vault-host-config`, `vault-lifecycle`, CloudWatch agent
  template): the host files travel with the release tag (C4). Image
  Builder names carry a content hash (its versions are immutable), so new
  inputs are new resources. **The build runs in a separate build VPC**,
  not the host VPC: the builder needs GitHub and the AL2023 repositories,
  which the host DNS Firewall must not admit. The builder has its own role
  (`vettid-org-vault-image-builder`), never the host role. User data is a
  cloud-config writing only `/etc/vettid/host.env` (SSM prefix, region,
  release, group, hook); `vault-host-config` reads the rest from SSM, and
  the parent reads `vault/control-queue-policy` itself
  (`-queue-policy-param`) and refuses to start without a valid policy.
  The parent's instance id is the EC2 instance id. No update policy on the
  group: a deploy never replaces running hosts; a host patch is an explicit
  instance refresh of that release's group.

### 8.4 Network and egress

Security groups cannot filter by host name. The controls, from the inside
out:

1. The enclave has no network: its only path out is the parent's
   forwarder over vsock, which accepts only exact host names on port 443
   from `DefaultAllow` (the relay, `kms.us-east-1.amazonaws.com`,
   `android.googleapis.com`, and since push N3 the push gateways
   `push.vettid.org` and `push.staging.vettid.org`) and resolves them
   itself, so the enclave cannot choose addresses. The parent binary is
   built once for every channel, so `DefaultAllow` (`parent.PushHosts`)
   names both gateways; the stage's DNS Firewall (control 3) and the
   enclave's own release allowlist each admit only their channel's
   gateway, whose URL is the release constant `push_url` in vettid-vault
   `enclave/releasecfg/<channel>.json` (`https://push.vettid.org` for
   prod, `https://push.staging.vettid.org` for staging; VAULT-MESSAGING
   §11.10.8, §14.3).
2. TLS ends in the enclave against pinned roots (D5): a misroute can only
   fail, never be read.
3. **Route 53 Resolver DNS Firewall** on the VPC: allow-list of the
   enclave's hosts (the relay, KMS, `android.googleapis.com` and the
   stage's own push gateway) plus the AWS endpoints the parent and
   agents use (SQS, DynamoDB, S3, SSM, SSM messages, EC2 messages,
   CloudWatch Logs and metrics, Auto Scaling); block everything else. It limits a
   compromised parent too, including DNS tunnelling.
4. Security group: no inbound; outbound TCP 443 only (plus DNS to the
   resolver). VPC Flow Logs for audit (7–30 days).

(0.1.28, release R) The recovery counter bucket's virtual-hosted name
(`vettid-org-vault-recovery-<account>.s3.us-east-1.amazonaws.com`) is
added to `DefaultAllow`, to the enclave's release allowlist (Amazon's
roots) and, already admitted as S3, to the DNS Firewall. In the VPC the
parent's connection to it goes through the S3 gateway endpoint, like all
S3 traffic in the region; the endpoint's policy admits resources of the
vault account (`aws:ResourceAccount`, below), and the counter bucket is
one. TLS still ends in the enclave. A release that carries the name also
carries the parent that admits it (C4).

**KMS: public endpoint, no interface endpoint.** An interface endpoint
with private DNS would serve the same name and an Amazon certificate, so
the enclave's pinned roots would accept it, but it adds about $15/month
(2 AZs) and no security: the key policy may not carry
`aws:SourceVpce` (check 7 refuses other conditions), and the public path
is TLS terminated in the enclave anyway. S3 and DynamoDB use the free
gateway endpoints. No NAT.

*As built (W6).* The allowlist is `lib/vault/egress.ts` (snapshot-tested):
the relay, `kms`, `android.googleapis.com`, the stage's push gateway
(`pushHost` in `lib/config.ts`: `push.vettid.org` in prod,
`push.staging.vettid.org` in staging; vettid.org #204); `sqs`,
`dynamodb` and the SDK's account endpoint `<account>.ddb`, `s3` and the data bucket's
virtual host, `ssm`; `ssmmessages`, `ec2messages`, `logs`, `monitoring`,
`autoscaling` (all `us-east-1`); `*.ec2.internal`. Allowed names may
redirect (CNAME chains to ELB or S3 names: `TRUST_REDIRECTION_DOMAIN`);
everything else is NXDOMAIN; the association is mutation-protected and the
resolver fails closed (the default). Query logs go to
`/vettid-org/<stage>/vault-dns` (metric `DnsQueriesBlocked`, no alarm until
W9 shows the baseline noise). The gateway endpoints' policies admit only
resources of the vault account (`aws:ResourceAccount`). Flow logs (all
traffic) to `/vettid-org/<stage>/vault-flow-logs`, one month.

*Planned (0.1.19; approved by the owner 2026-10-12; CALLING-SERVICE
0.2.0 §5.5, CALLS-PLAN §13).* The calling service's credential issuer
is the enclave's fifth destination, from the staging release that
carries `calls_url` (§5.2). It follows the push gateway's pattern
exactly:

- **Control 1.** The parent's `DefaultAllow` gains `calls.vettid.org`
  and `calls.staging.vettid.org`, port 443 (one parent binary for every
  channel; both names are listed now, CALLS-PLAN decision D25). The enclave's own release
  allowlist gains only the host of its channel's `calls_url`.
- **Control 2.** TLS 1.3 ends in the enclave against Amazon's roots,
  with HTTP/2; the issuer is deployed behind an Amazon certificate for
  that reason (CALLING-SERVICE §8.2). That the enclave completes this
  handshake with the issuer's front is the first thing the stacks' work
  verifies.
- **Control 3.** `lib/vault/egress.ts` gains the stage's `callsHost`
  (`lib/config.ts`, beside `pushHost`): `calls.staging.vettid.org` in
  staging. **Production's DNS Firewall does not admit a calls host**
  until production has a calling service. The snapshot test changes,
  which is a security review item, as for any change of the allowlist.
- **Control 4** is unchanged: the issuer is reached on TCP 443.
- The TURN server itself (`turn.staging.vettid.org`, UDP) is **not** an
  egress destination: no vault and no host ever talks to it. Only
  members' devices do.
- What the host sees of it: VAULT-HOST-PROTOCOL §11.2 (a connection to
  the issuer's name, its times and sizes), and the parent's connection
  count by destination class gains a class for it or counts it as
  `other` (an implementation choice to record in §8.7 when built).

### 8.5 Registry, leases, queues

Already built and specified (VAULT-MESSAGING §11.1, §11.5; MEMBER-API
"Vault"): per-instance queues `vettid-org-vault-control-<instance_id>`
created and deleted by the parent, a shared DLQ, the instance registry
with a 20 s heartbeat and 90 s liveness, leases on the vault rows. V5 adds
only the host role's grants:

- SQS: `CreateQueue`, `DeleteQueue`, `SetQueueAttributes`,
  `GetQueueAttributes`, `ReceiveMessage`, `DeleteMessage`, `ListQueues` on
  the prefix; `SendMessage` to the DLQ.
- DynamoDB: the vault rows' lease, lifecycle and alarm attributes only
  (`dynamodb:Attributes` conditions, as the member API does);
  `vault-instances` put, update and delete; `vault-requests` conditional
  update.
- S3 as in §8.2; `ssm:GetParameter` on `vault/*`; CloudWatch Logs and
  metrics; `autoscaling:CompleteLifecycleAction` on its own group.
- *As built (W5):* also `s3:ListBucket` (so a missing object is
  `NoSuchKey`, not `AccessDenied`), `smoke/*` for the self-test, the DLQ
  `vettid-org-vault-dlq` (outside the control prefix), log group
  `/vettid-org/<stage>/vault-host`, metric namespace `VettID/Vault`, and
  lifecycle actions on groups named `vettid-org-vault-r*`. All in
  VettidOrgVaultStack; W6 creates the resources these names point to.
- **Not** granted: any KMS action in IAM (the key policies name the role),
  any key management.

### 8.6 The scaler: on-demand start and stop

The member API already records start requests (`start_requested_at` on
the release's `vettid-org-vault-releases` row) and answers `503
release_starting`. The `vault-scaler` Lambda (host stack):

- **Start:** triggered by that table's stream (VaultStack, new and old
  images, ARN in SSM `vault/vault-releases-stream-arn`; filtered to rows
  whose `start_requested_at` changed) and by a 1-minute schedule. The
  member API records a start request at most every 30 s per release and
  only for a routable release. For a release
  with `available` and no live instance, it sets the release group's
  desired capacity to 1 (group name from SSM by release) and records
  `start_issued_at`. Cold start (boot, allocator, enclave, first
  heartbeat) is expected at 2–3 minutes; the app retries every 30 s.
- **Stop:** every 5 minutes, for each group above its minimum: if every
  instance has reported `load` = 0 (no leased vaults) for 30 minutes and
  there was no start request in that time, set desired to the minimum.
  The lifecycle hook drains an instance that took a vault in the race.
- **Limits:** at most 2 instances per release and 6 in total
  (configurable), so a flood of start requests costs at most that.
- **Alarms:** a start request unfulfilled after 10 minutes; a group at its
  cap.
- Never: starting a `removed` release, unless its row has `rescue: true`
  (a rescue, §10.3, which the member API routes as usual), or one whose
  group does not exist.
- **W6 follow-up (rescue scope):** `rescue` is release-wide: while it is
  set, every vault sealed to that release is routed to it, not only the
  vault of the member who asked. That affects availability only (the apps
  offer nothing but the move off a `removed` release, VAULT-MESSAGING
  §11.10.6). A per-vault rescue would need a field on the vault row that
  the member API checks; decide in W6 whether it is worth it.
  *Decided in W6 (recommendation, owner to confirm):* release-wide stays.
  A rescue is rare and short (the member moves, `rescue` is removed and the
  scaler stops the group at once) and affects availability only; a
  per-vault flag would add a member-API code path for no confidentiality
  gain. Revisit if rescues become routine.
- *As built (W6)* (`lambda/vault/scaler.ts`, `scaler-logic.ts`): one full
  reconcile per invocation (stream or the 1-minute schedule), reserved
  concurrency 1. A start needs a request **fresher than 5 minutes** and
  newer than `start_issued_at` (so an idle stop is never undone by an old
  request); the marker is written before the capacity change. Idle =
  30 minutes since the latest of the request, the issued start and
  `busy_at` (written at most every 5 minutes while a live instance has
  `load` > 0). Groups are found by tag (`vettid:vault-scaler=managed`) and
  must carry the row's PCR0 and release number; groups whose PCR0 has no
  row (candidate, canary) are left to the operator. A `removed` release
  without rescue, or `available: false`, goes to its minimum at once. The
  scaler may write only `start_issued_at` and `busy_at` on release rows,
  and `SetDesiredCapacity` only on tagged `vettid-org-vault-r*` groups.
  Metrics (EMF): `StartsIssued`, `StopsIssued`, `StartsBlocked`,
  `StartsUnfulfilled`, `ActiveMinimumUnmet`, `LiveInstances`,
  `DesiredInstances`.
  *W8:* a row with status `canary` (§10.1 step 9) is routable for the
  scaler (started on request, stopped when idle); a group whose PCR0 has
  no row at all (a candidate) stays the operator's.

### 8.7 Observability

- Parent logs (journald → CloudWatch agent; as built, a log file the
  agent ships: "As built (0.1.17)" below) to
  `/vettid-org/<stage>/vault-host`, one month. Release enclaves run without
  a console; their sanitized logs arrive through the parent. Nothing logged
  contains PINs, keys, envelopes or mailbox ids.
- Metrics (EMF from the parent): unlocked vaults per instance, request
  latency, lease conflicts, split-brain locks, KMS errors, egress denials,
  queue age.
- Alarms (SNS to the admin address):
  - no live instance of the newest `active` release while its minimum is
    1; registry heartbeat stale; ASG unhealthy;
  - DLQ depth > 0; queue age > 60 s;
  - start request unfulfilled (§8.6);
  - **CloudTrail rules** (EventBridge, in AuditStack's pattern): any
    `ScheduleKeyDeletion`, `CancelKeyDeletion`, `EnableKey`, `CreateKey`
    with the bypass flag, `PutKeyPolicy` attempt, and `iam:DeleteRole` /
    `UpdateAssumeRolePolicy` on the host or retirement role.
- *As built (W6).* SNS topic `vettid-org[-<stage>]-vault-alerts` in each
  vault account (email to the admin address; confirm once). Alarms: DLQ
  not empty; control-queue age > 60 s (a Metrics Insights query over every
  queue but the DLQ, since queues are per instance); start unfulfilled;
  start blocked (no group or a cap); the newest active release with
  minimum 1 and no live instance for 10 minutes (the registry-heartbeat
  check: live means a heartbeat within 90 s); scaler and manifest-sync
  errors; manifest rejected; manifest missing from the bucket; per release,
  desired > in service for 15 minutes. CloudTrail rules (vault account
  bus, fed by the organization trail): `ScheduleKeyDeletion`,
  `CancelKeyDeletion`, `EnableKey`, `DisableKey`, `PutKeyPolicy` (also on
  the manifest and smoke keys, by deploys), `CreateKey` with the bypass
  flag (expected once per release key), and `DeleteRole`,
  `UpdateAssumeRolePolicy`, `DeleteInstanceProfile`,
  `RemoveRoleFromInstanceProfile` on the pinned roles. Parent EMF metrics
  come with the parent's own instrumentation (not part of W6).
- *As built (0.1.14; vettid-vault #66, from staging release S11;
  VAULT-RELAY-SCALING §6).* The parent's first metrics.
  - **How.** Once a minute the parent writes one log line in
    CloudWatch's embedded metric format (message `metrics`, level INFO)
    to its ordinary log, which the agent ships to
    `/vettid-org/<stage>/vault-host`; CloudWatch is to take the metrics
    from it. No new permission and no new endpoint. Namespace
    `VettID/Vault`; the only dimension is `InstanceId`. Nothing in the
    record names a member, a vault, a mailbox or an address.
  - **The 13 metrics.** `UnlockedVaults`;
    `EgressOpenRelay`, `EgressOpenKMS`, `EgressOpenPush`,
    `EgressOpenOther` (egress connections open, by destination; Other
    is the attestation status list);
    `EgressOpenedRelay`, `EgressOpenedKMS`, `EgressOpenedPush`,
    `EgressOpenedOther` (opened since the record before);
    `RelayRequestsInFlight` (on a stream or waiting for one);
    `RelayStreamWaitMax` (milliseconds; the longest wait for a stream in
    the current minute and the one before);
    `RelayRequestErrors` (relay requests without an answer, since the
    record before);
    `RelayGrowthRefused` (requests that waited while a bound forbade
    another connection, since the record before). The four `Relay…`
    metrics come from the enclave (VAULT-MESSAGING §12.2.1 "Counts") and
    are missing from a record written without an enclave.
  - **Plain fields of the record** (searchable in the log, not
    metrics): `relay_conns`, `relay_dialed`, `relay_streams` (the stream
    limit the relay announced), `relay_waiting`,
    `relay_refused_max_conns`, `relay_refused_min_streams` (all
    six since vettid-vault f3003ed), and, from the staging release that
    includes vettid-vault 8f2c8bf (S11; 0.1.16), `relay_vault_limit`:
    how many vault processes reached their own limit of 8 relay and
    push requests in flight since the enclave started, each counted
    once. For the instance only: it replaces a log record that named the
    vault (VAULT-HOST-PROTOCOL §13 point 2). It is a field, not a 14th
    metric.
  - **Alarms these call for** (built in the host stack, 0.1.17, not yet
    verified on staging: "As built (0.1.17)" below): `UnlockedVaults`
    above 400 on an instance;
    `RelayRequestsInFlight` above 80 % of `relay_conns` × 128;
    `RelayStreamWaitMax` above 1000; any `RelayGrowthRefused`;
    `EgressOpenedRelay` in an hour far above twice `EgressOpenRelay`;
    and `relay_streams` reading 0 or 100 while `relay_waiting` is above
    0 (a relay front end that announces exactly 100 streams,
    VAULT-MESSAGING §12.2.1; a log metric filter, since both are plain
    fields).
  - **Still not built:** request latency, lease conflicts, split-brain
    locks, KMS errors, egress denials and queue age as metrics.
  - **Not yet verified:** that CloudWatch takes the metrics from the
    shipped log line. The record's shape is tested; the extraction is
    phase 1's exit check, to be done on staging with S11. If the parent
    logs above INFO the record is not written.
- *As built (0.1.20; vettid-vault #70, #71 and #72, `main` 392b03c; from
  staging release S11, which is not cut yet).* **The unreachable
  parent in the log** (VAULT-MESSAGING §12.3; VAULT-HOST-PROTOCOL
  §4.3, §7.4). In `/vettid-org/<stage>/vault-host`, none naming a
  vault:
  - from the enclave (`source=enclave`): "no ping from the parent:
    every vault is locked if none comes" (`silent_s`, `limit_s`,
    `vaults`; a warning at 60 s); "parent unreachable: locking every
    vault" (`vaults`) and "parent unreachable: every vault locked"
    (`vaults`, `killed`); "log records dropped: the parent was not
    reading" (`count`); "control connection takes no write timeout"
    (an error: the 60 s write limit then bounds nothing);
  - from the parent: "heartbeat took longer than its interval" (`ms`,
    `interval_ms`), "lease renewal failed; will retry" and "lease lost"
    (these two name the vault, as before).
  - The first enclave record can reach the log only while the parent
    reads; the two "parent unreachable" records are written when the
    parent is, by the rule, not listening, and arrive only if the
    connection still carries them. An alarm should rest on the
    parent's own records and on the registry row going stale, not on
    these. No alarm is built on any of them yet.
  - **What S11 is planned to carry** (vettid-vault, since
    `release/staging/10`): #66 (relay connections and metrics), #69
    (`relay_vault_limit`), #70, #71 and #72 (the unreachable parent);
    and (0.1.21) #73 (the enclave image and the smoke script are built
    with Go 1.26.9) and #74 (a `Ping` read while the vaults are being
    locked does not make the parent reachable; VAULT-HOST-PROTOCOL
    0.1.5 §4.3);
    all merged, `main` a852e36. #67 and #68 are test vectors and
    documentation. `deploy/host/` is
    unchanged since S10, so S11's `host_files_sha256` is S10's.
- *As built (0.1.17; the host stack, `lib/stacks/vault-host-stack.ts`;
  built, not yet verified on staging: RUNBOOK "The parent's metrics and
  their alarms").*
  - **How the record reaches CloudWatch.** Not through journald: the
    parent's unit appends its standard error to
    `/var/log/vettid/vault-parent.log`, and the CloudWatch agent
    (configuration in vettid-vault `deploy/host`, part of each
    release's AMI) ships that file line by line, unparsed, to the
    stream `<instance id>/vault-parent`. The parent logs JSON at INFO
    (`-debug` lowers the level, nothing raises it), so the event's
    message is the record itself: one JSON document with `_aws` at the
    top level beside the logger's own members (`time`, `level`, `msg`,
    `component`), which the format allows. That is the form CloudWatch
    Logs reads metrics from; the host role may already write the log
    events, and the DNS firewall already admits `logs.<region>`. No
    change to the stack or to vettid-vault was needed for the metrics
    to arrive. The relay's name and the one-minute interval reach the
    parent without a stack change (`vault/relay-host` → `-relay-host`;
    the interval is the default).
  - **How the alarms are keyed.** The only dimension is the instance,
    and instances come and go, so no alarm names one. Five alarms ask
    for the worst instance, or the sum over all of them, with a
    Metrics Insights query over `SCHEMA("VettID/Vault", InstanceId)`,
    as the control-queue age alarm does. No second dimension set in
    the record is needed.
  - **The alarms** (`vettid-org[-<stage>]-vault-…`, to the alerts
    topic; missing data is not breaching, so they rest while no host
    of S11 or later runs):
    - `unlocked-vaults`: the highest `UnlockedVaults` above 400 for 5
      minutes;
    - `relay-in-flight`: the highest `RelayRequestsInFlight` above
      1,638 for 3 minutes. **This differs from the text above:** it is
      80 % of 16 × 128, the most a host can have, not of `relay_conns`
      × 128. Connections are filled one after the other, so the
      requests in flight are above 80 % of the open connections'
      streams in ordinary operation (always from the fifth connection
      on, and whenever the newest connection is more than 80 % full
      below that); the alarm as first written would
      come and go with the number of vaults. Approved by the owner 2026-10-12;
    - `relay-stream-wait`: the highest `RelayStreamWaitMax` above
      1,000 ms in one record;
    - `relay-growth-refused`: the sum of `RelayGrowthRefused` above 0
      in one minute;
    - `relay-connection-churn` (0.1.18): more than 64 relay
      connections opened in an hour, the sum of `EgressOpenedRelay`
      over every instance. **This differs from the text above** ("far
      above twice `EgressOpenRelay`"): an alarm takes one Metrics
      Insights query, so the opened and the open connections cannot be
      compared without naming instances (0.1.17 built that comparison;
      CloudWatch refused it). The number: the load balancer closes
      each connection about once an hour, so a host opens 8 an hour at
      900 vaults and 16 at most, 32 when a full set is replaced twice
      (also the burst the pool may dial at once); 64 is twice that,
      and a host whose connections are closed as they open dials 2 a
      second, 7,200 an hour. What is lost: churn on a host with few
      connections that stays under 64 an hour (up to about one
      connection a minute) is not seen, and with five or more hosts
      near 16 connections each the ordinary hourly close alone would
      pass 64, so the number has to grow with the fleet (at most two
      hosts a release, six in all, today);
    - `relay-stream-limit`: a metric filter on the host log
      (`RelayStreamLimitSuspect`, no dimension) counts the records
      with `relay_waiting` above 0 while `relay_streams` reads 0 or
      100; the alarm is 2 such records in 3 minutes.
  - **The alerts topic.** Its policy named `events.amazonaws.com`
    alone (the CloudTrail rules), which also replaced the default that
    lets the account's alarms publish: every alarm of the host stack
    and of the release stacks would have failed to notify (the fault
    #214 fixed on the security-alerts topic). It now also admits this
    account's CloudWatch alarms.

### 8.8 Capacity

From the smoke test: Argon2id peaks at about 76 MB per vault process, the
supervisor about 13 MB. On an m7g.large (2 vCPUs, 8 GiB) the enclave gets
1 vCPU and 5 GiB (5120 MiB, O6; the parent keeps the rest). One vCPU
serializes Argon2id, which bounds unlock bursts. `m7g.xlarge` (3 enclave
vCPUs, ~12 GiB) is the next step.

*Measured (W9, staging S3, 2026-10-05):* `vault-parent -selftest
-capacity` on an S3 host (m7g.large, enclave 1 vCPU / 5120 MiB; RUNBOOK
"Capacity measurement", vettid-vault SMOKE.md), PASS:

| Measure | Result |
|---|---|
| Unlock p50 at concurrency 1 / 2 / 4 | 195 ms / ~400 ms / ~830 ms (the KDF dominates; one vCPU serializes it) |
| Vaults held when the fill stopped (`memory_floor`) | 58 |
| Transient memory per unlock | ~76 MiB |
| Steady marginal memory per unlocked vault | 4.1 MiB |
| Projected idle unlocked vaults per host | ~980 |
| Idle CPU | 0.9 ms per vault per minute |

So the limit is concurrent unlocks (one vCPU for the KDF and ~76 MiB each
for a moment), not steady memory: 58 is the conservative figure for a
burst of unlocks, ~980 the figure for idle unlocked vaults. Record:
W9-REPORT §4.

*Measured again (staging S10, 2026-10-11):* the same run as S10's
canary self-test (`-capacity 400`, same host and enclave size), PASS:
58 vaults held at the memory floor, about 907 idle unlocked vaults
projected per host. The burst figure is unchanged; the projection is
about 7 % lower than S3's.

*Measured again (staging S11, 2026-10-13):* the same run on S11's
canary host after its self-test (`-capacity 400`, same host and enclave
size), PASS: 58 vaults held at the memory floor, about 894 idle
unlocked vaults projected per host (4.5 MiB steady marginal memory per
vault), unlock p50 193 ms / 393 ms / 817 ms at concurrency 1 / 2 / 4,
idle CPU 0.9 ms per vault per minute. S11's hardening of the vault
process (the system call filter, no user namespaces) leaves the figures
where S10's were.

*Measured again (staging S12, 2026-10-14):* the same run on S12's canary
host (same host and enclave size), PASS: 58 vaults held at the memory floor,
about 890 idle unlocked vaults projected per host (4.5 MiB marginal), unlock
p50 197 ms / 403 ms / 840 ms at concurrency 1 / 2 / 4, idle CPU 1.5 ms per
vault per minute. S12 fixes a race that could crash a vault process when
several unlocks ran at once on one vCPU (vettid-vault #85); this run's
concurrent unlocks all completed.

*Measured again (staging S13, 2026-10-15):* the same run on S13's canary
host (same host and enclave size), PASS: 57 vaults held at the memory floor,
about 905 idle unlocked vaults projected per host (4.4 MiB marginal), unlock
p50 219 ms / 452 ms / 912 ms at concurrency 1 / 2 / 4, idle CPU 2.2 ms per
vault per minute. S13's enclave runs the 6.6.158 kernel with its hardened
configuration: unlocks are about 10% slower than S12's on 4.14, as the
hardware run of vettid-vault #87 and #88 measured, and memory capacity is
unchanged.

*Measured again (staging S14, 2026-10-16):* the same run on S14's canary
host (same host and enclave size), PASS: 57 vaults held at the memory floor,
about 933 idle unlocked vaults projected per host, unlock p50 224 ms /
459 ms / 944 ms at concurrency 1 / 2 / 4, idle CPU 2.3 ms per vault per
minute.

*Measured again (staging S15, release R, 2026-10-16):* the same run
(`-capacity 400`) on S15's canary host, instance `i-0a91921ab7de639a3`
(m7g.large, 4921.8 MiB of enclave memory as the self-test read it), from
23:12 to 23:21 UTC, PASS: 57 vaults held at the memory floor, about 938
idle unlocked vaults projected per host (4.2 MiB marginal), unlock p50
222 ms / 457 ms / 941 ms at concurrency 1 / 2 / 4, idle CPU 1.8 ms per
vault per minute. S14 and S15 leave the figures within a few percent of
S13's.

*Relay connections (0.1.14; VAULT-RELAY-SCALING 0.1.2 §3, §10;
vettid-vault #66).* Memory, not the relay path, bounds vaults per host:

| Measure | Value |
|---|---|
| Streams per connection (the relay's load balancer) | 128 |
| Connections per host to the relay, at most | 16 (up to 32 for 30 s while the load balancer closes connections) |
| Concurrent relay requests per host, at most | 2,048 |
| Connections at 900 unlocked vaults | 8 |
| Vault processes per host, at most (`MaxProcs`) | 1,024, so at most 1,024 held long-polls |
| A quick request (deposit, ack) first waits for a stream when | more than 1,024 other requests are in flight at 1,024 vaults |
| Relay and push requests in flight per vault, at most | 8 |

*Measured locally* (2026-10-12; the enclave's egress code against a
local HTTP/2 server at 128 streams per connection, not against the load
balancer; phase 2 of VAULT-RELAY-SCALING measures on staging):

| Measure | Result |
|---|---|
| 900 long-polls held, quick requests beside them | 8 connections; quick requests under 1 ms |
| Every connection lost at once, 900 vaults, three times in a row | all polling again about 0.5 s after each loss (the vaults' own retry delay) |
| The same at 2,000 vaults (above `MaxProcs`) | 0.5 s; 4.4 s for a second loss within 3 s of the first (the dial rate) |
| A connection whose host goes silent without closing it | found and closed after 25 s (ping after 15 s, 10 s to answer) |

*The heavy key derivation (0.1.28, release R; estimates, to be measured
on staging).* A recovery wrap's derivation needs 1 GiB and about 3 to 5
seconds of the enclave's one processor. The supervisor gives one permit
at a time, only while free memory is at least the memory-pressure floor
(15 %, about 768 MiB) plus 1.2 GiB; otherwise the request is answered
`busy` and nothing is reserved (owner decision of 2026-10-14). Reserving
the room always would cost about 270 idle vaults per host (about 620
instead of 894). While a derivation runs, unlocks on that enclave take
several seconds longer; at most about 12 to 20 derivations a minute fit
one enclave, so a burst of enrollments arms in turn. The `m7g.xlarge`
step below removes most of this. The parent records `heavy_kdf_free`
from `Stats` (VAULT-HOST-PROTOCOL §6.6).

*O6 decision (owner, 2026-10-06):* keep the 1 vCPU / 5120 MiB enclave on
m7g.large for release 1; revisit when unlock queueing shows in metrics
(unlock latency above the single-unlock figure under load; the parent's
EMF metrics, §8.7). A change means new host files at a release commit
(the size is pinned by `host_files_sha256`), so it takes effect with a
release, not a redeploy (W10-READINESS R3). Plenty for the preview.

### 8.9 Cost (us-east-1, on demand, approximate)

| Item | Production $/month |
|---|---|
| Current release: one always-on m7g.large ($0.0816/h) | ~60 |
| Its public IPv4 and 20 GiB gp3 | ~5 |
| Older releases on demand (a few hours a month each) | ~1–5 |
| Release keys, $1 each: ~15 live at steady state (12-month window, monthly cadence) | ~15 |
| Manifest key A (asymmetric) | 1 |
| S3, DynamoDB, SQS polling and heartbeats, KMS requests | ~3 |
| CloudWatch logs, metrics, alarms; flow logs; DNS Firewall | ~5 |
| **Total, current release always on** | **~90** |
| Total, parked (minimum 0, on-demand start only) | ~30 |

Staging (0.1.11): no longer parked. As the development channel it is
estimated at about $100–120 a month (one host most of the time, the
fixed parts, three keys, the push gateway; STAGING-DEVELOPMENT-PLAN §3
risk 5 and §8.2), on the shared production relay. Image Builder is free
apart from about 30 minutes of build instance per AMI. GitHub's arm64
runners are free for public repositories. The relay (~$55) is already
running and counted in RUNBOOK. VAULT-PLAN's earlier "keys kept forever"
cost grows without bound; with R4 it levels off at about the window's
worth of releases.

## 9. Deploying the member API vault parts

Merged but not deployed: the vault tables (DataStack), the `vault` route
group, the `vault-alarms` mailer on the vaults stream, and the cleanup
job's vault deletion. Order (W4):

1. `npx cdk diff VettidOrgDataStack`: only the four vault tables, the
   two streams (vaults; vault-releases for the scaler, §8.6) and their SSM
   refs may appear. Deploy. (If O1 moves the tables
   to the vault account, this step becomes part of W5 instead.) *W5:* the
   tables moved to the vault account; the empty copies deployed here in W4
   are dropped from DataStack (retained by CloudFormation, deleted by hand,
   RUNBOOK "Vault").
2. `npx cdk diff VettidOrgMemberApiStack`, deploy. With no `active`
   release, `GET /api/vault/enclave` answers `503 vault_unavailable` and
   nothing can be enrolled, so this is a safe dark launch. Check the
   routes with a test member: status `{vault: null}`, enclave 503.
3. The mailers need no extra setup: members' addresses are SES-verified
   identities (sandbox is fine). Verify with a hand-written test row in
   staging, not production.
4. The cleanup job's S3 deletion and the queue sends only act on vault
   rows, of which there are none yet.
5. After `VettidOrgVaultStack`: the account site's vault status card, if
   wanted (not required for V5).

## 10. Release process

### 10.1 A monthly release, step by step

| # | Step | Who / where | Output |
|---|---|---|---|
| 1 | Freeze; the release commit sets `releasecfg/prod.json` `release: N` (and any pin changes); review; merge to `main`; signed tag `release/prod/N` on that commit (vettid-vault docs/RELEASING.md) | vettid-vault | tag |
| 2 | `release` workflow: EIF ×2 per channel, measurements, parent binaries, attestations; draft GitHub release; the run's enclave kernel warning, if any (§5.4), is answered in the release notes (moved, or why not) | CI, arm64 | artifacts, PCRs |
| 3 | Independent rebuild; PCR0 must match | owner | sign-off |
| 4 | Staging: add the staging release to `vault/releases/staging.json` (with `log` and `notes` = its staging log URL, §7), deploy its key and release stack, hardware self-test, vaultctl end-to-end, compat run incl. a move from the previous staging release (§11) | staging | report |
| 5 | Production PR: add N to `vault/releases/prod.json` (status `candidate`: in CDK, not in the manifest; with `log`, reviewed in this PR, and `notes` = `https://vettid.org/security/releases/N/`), `admitted_pcr0s` = every earlier release not `removed` and every `removed` one that can still be rescued (§6.2; while `seal_key` is empty the validation refuses a list that leaves one out, and `check:manifest` and `vault:manifest sign` one that names a `removed` release past its window; N's own PCR0 is admitted implicitly; `lib/vault/release-list.ts`) | vettid.org | PR |
| 6 | Deploy `VettidOrgVaultStack` (creates the key); `vaultctl keycheck` against the draft manifest | owner | key ARN in `vault/releases/prod.json` |
| 7 | Deploy `VettidOrgVaultRelease<N>Stack` (AMI with EIF verified against measurements; group min 0, canary 1) | owner | instance |
| 8 | Hardware self-test on the canary host (`vault-parent -selftest` against the host stack's deletable smoke key), then normal start | SSM | PASS report |
| 9 | Canary: sign manifest `serial` s+1 with N `active` but **do not publish**; the registry row is `canary`, routed only for flagged test members (W8 adds this to the member API); canary member enrolls into N, unlocks, locks; the oldest live release's canary vault moves into N (§11.3); soak 24 h | owner, test device | canary report |
| 10 | Publish: commit the signed manifest (N `active`, N−1 `deprecated`, any `retired`/`ends_at` changes), the release log entry, `deploy:site`; manifest sync updates routing | owner | live |
| 11 | Previous release group to minimum 0; the always-on minimum moves to N (O7) | owner | |
| 12 | In-app prompts follow from the manifest, with What's new from the log (ANDROID-PLAN §4); no email for a routine release | — | |

*As built (W7, W8).* Step 9: `scripts/vault/manifest.ts sign` then
`upload` (the bucket copy only; nothing is served), and the operator's
`canary` row on `vettid-org-vault-releases` for N's PCR0 (RUNBOOK "Canary
routing"). The member API routes a `canary` release only for members
whose row has `vault_canary: true`: their enrollment goes to the newest
canary release (also before production release 1, when nothing is
`active`), their vaults sealed to it are routed there; for everyone else
it is unknown (410). The scaler manages a `canary` row like any release.
The test device needs the canary manifest out of band (it is not
served); see "The canary manifest on the test phone" below. Until step
10 publishes N's log entry, the canary phone shows "Release notes
unavailable" with the link for N (ANDROID-PLAN §4 "What's new"), which
also exercises that path.
Step 10: `manifest.ts publish` with the same signed document, so the
canary vault's recorded serial is the published one; the manifest sync
turns the row into an `active` one. A test member's flag is an operator
write on the members table, set from the admin site (#95; RUNBOOK
"Canary routing", ADMIN-API "Vault canary"); there is no member-facing
switch.

**The canary manifest on the test phone** (owner decisions of
2026-10-06; vettid-android #63; the app's rules are normative in
VAULT-MESSAGING §11.10.1, 0.14.0):

- *Delivery.* The canary tester shares the signed
  `local/vault/<channel>/served-<s>.json` from step 9 to the VettID app
  as a file (Android share intent). It travels only over a private
  channel (a USB transfer from the owner's machine, for example), never
  from a public URL (RUNBOOK "Canary manifest on the test phone"). The
  path works in release builds: the canary phone runs the release build
  signed with the upload key (W10-READINESS B8).
- *Verification.* The app accepts the document only if it is signed by
  a manifest key that build pins (key A or B in release builds, the
  staging key in staging builds) and is in the strict manifest format.
  It refuses the document if its serial is lower than the highest serial
  the phone has used, or if the published manifest already has that
  serial or a newer one. It shows the serial, the `key_id` and the listed
  releases, and installs the document only after the tester confirms.
  The document is stored encrypted on the phone, is erased by the
  replaced-phone wipe, and can be removed in Settings → Attestation
  ("Stop using the test manifest").
- *Selection.* Before each enroll, unlock and recovery register, the app
  uses whichever manifest has the higher serial; on a tie the published
  one. A 404 on the published manifest (production release 1, when
  nothing is served) falls back to the canary manifest. The app drops the
  canary manifest automatically once the published serial reaches it. A
  canary manifest that no longer verifies is ignored.
- *After step 10* nothing is needed on the phone: the published
  document is the same serial, so the app switches to it and drops the
  canary copy.

If the canary fails before step 10: the manifest s+1 is never published
(the next one is s+2); N's group is deleted; N becomes `removed` in
the release list, without `ends_at` (no member was ever on it, so there
is nothing to rescue and no later key admits it, §3.5), and its
key is scheduled for deletion at once. The
fix ships as N+1. On the test phone the tester removes the canary
manifest (Settings → Attestation). The phone has used serial s+1, so it
refuses the published s: a vault on an older release that it unlocked
during the canary opens again once s+2 is published (N `removed`).
Publish s+2 promptly when such a vault exists.

### 10.2 Hotfix

Same steps, cut from `release/prod/<current>` plus the fix, with the canary
soak shortened to 2 hours and step 4 limited to the self-test, end-to-end
and one move. Release notes carry `security: urgent` and the affected
releases; members sealed to them are emailed (W8 job). The window for an
exploited vulnerability may be shortened (O5).

### 10.3 Retirement, per release

A monthly checklist driven by the release list (`ends_at` per release),
with the notice job sending the emails of §3.5 automatically:

1. At T0 + W − 90 days: set `retired` and `ends_at` = D; publish.
   (Production release 1, W = 90 days: at T0, in the manifest that makes
   release 2 `active`, §3.5.)
2. At D: check that a rescue of N has a target (N's PCR0 is in the
   `admitted_pcr0s` of the newest `active` release; `vault:manifest
   sign` refuses the manifest otherwise, §3.5); set `removed`, keeping
   `ends_at`; publish; delete the release stack (instances
   stop; `available` false; API 410) and drop the entry's `host`; as the
   retirement role,
   `aws kms schedule-key-deletion --key-id <arn> --pending-window-in-days 30`;
   the deadline email goes out.
3. Rescue (D … D+30), on a member's request: as the retirement role,
   `cancel-key-deletion`, `enable-key`; give N's entry in the release
   list its `host` again together with `rescue: true` and deploy the
   release stack (0.1.24: the entry stays `removed`, the manifest does
   not change and nothing is signed; the validation allows `host` on a
   `removed` entry only with `rescue: true`, and that only while the
   key of the newest `active` release admits N); set
   `rescue: true` on its `vault-releases` row (the member API routes a
   `removed` release only then); the member moves into the newest
   `active` release and unlocks there. The rescue is done when an
   unlock in the target release has succeeded, not when the vault
   row's `sealed_release` names the target: the row changes as soon as
   N has sealed the header, before the target has opened the vault,
   and until then N must stay routed. Then remove `rescue` from the
   row; delete the release
   stack and drop `host` and `rescue` from the entry; then schedule the
   deletion again as in step 2. In production both list edits are
   merged to master before the deploy they belong to, like any release
   list change. KMS takes the full window again, so the
   key outlives D+30 by the time the rescue took; the rescue window
   stays D … D+30. While an entry carries `rescue: true`, the
   validation refuses a release list in which the newest `active`
   release does not admit it: end the rescue before publishing such a
   release.
4. D+30: the key is deleted; the final email; D+37 the cleanup job deletes
   the stored objects and rows of vaults still sealed to N.
5. Drop N from the manifest once no live key admits it.

## 11. Testing

### 11.1 Staging

A full copy in the staging account (`-c stage=staging`): member API,
tables, vault stacks, the staging manifest under staging.vettid.org,
staging keys with the production shape and a 7-day window. Relay: the
production relay at first (test mailboxes are harmless and the staging
image pins it), a staging relay deployed on demand when relay changes need
testing. (0.1.11) Staging is the development channel and is not parked
between releases; its rules are STAGING-DEVELOPMENT-PLAN §2.

*As built (W9, part A: CDK).* `-c stage=staging --profile vault-staging`
builds, all in vettid-vault-staging: `VettidOrgStageDnsStack` (zone
staging.vettid.org, CAA, SES domain identity), `VettidOrgAuthStack`,
`VettidOrgDataStack`, `VettidOrgVaultStack`, `VettidOrgVaultHostStack`,
`VettidOrgMemberApiStack` (vault routes, notices, alarm mailer, cleanup),
`VettidOrgAccountSiteStack` (account.staging.vettid.org) and
`VettidOrgStageSiteStack` (https://staging.vettid.org, the staging
manifest at the pinned `manifestUrl`). Left out: the public site, signup,
playbooks, the admin exit node, API and site (test data from
`npm run staging:seed`; the canary flag through the CLI), the relay
(production's), push, and the audit stack (the organization trail and
GuardDuty cover the account). Staging has had no release log, its
notices linking production's; from 0.1.10 it has its own at
`https://staging.vettid.org/security/releases/` (§7 "Release notes on
every channel"). Order and manual steps: RUNBOOK "Staging". Idle cost of
the main stacks about $10/month. A release group with no leased vault
still scales to zero (§8.6), but staging as a whole is no longer parked
(STAGING-DEVELOPMENT-PLAN §2.1, §2.5).

### 11.2 Hardware smoke on every release candidate

`scripts/smoke/run-on-host.sh` and the self-test from SMOKE.md, run on
the release's own AMI (both channels) rather than a host build, with the
deletable smoke key in each account. `VettidOrgVaultSmokeStack` stays as
the ad-hoc tool for testing hardware questions outside a release.

(0.1.27, approved by the owner 2026-10-15; vettid-vault #88 and #87.)
Its required kernel checks (the `kernel.*` checks marked required:
user namespaces, unprivileged bpf, io_uring, the kernel settings the
enclave has, `/proc` hidepid) and the vault process's filter checks
(`vault_process.seccomp_installed`, `vault_process.seccomp_refuses_*`)
must pass; a release whose self-test reports any of them failed is not
published. The informational ones are reported only: `kernel.release`,
`kernel.yama_ptrace_scope` (AWS's arm64 kernel has no Yama), the
settings an older kernel lacks (`absent: …`),
`vault_process.seccomp_unfiltered_*` and
`vault_process.seccomp_allow_list`. On a source-built kernel (once the
lock pins one, §5.1) the self-test's kernel checks are also required:
release and command line as pinned, lockdown, Yama, no module support,
user namespaces, unprivileged BPF; `kernel.release` and
`kernel.yama_ptrace_scope` are then required, not informational.

### 11.3 The move-only contract

- **Compat matrix in vettid-vault CI** (nightly and on PRs touching
  `client/`, `vms/`, `enclave/` wire code or the parent): for every tag in
  `compat/live-releases.txt` (generated from the production manifest),
  build that tag's dev enclave and parent, and with **HEAD's** vaultctl,
  relay and member-API stand-in run: enroll → lock → unlock → recovery
  request and register → unlock with an approval → move to HEAD's build →
  unlock in HEAD → confirm. Run one tag at a time (`-p 1`), to keep memory
  low.
- **Frozen vectors:** each release's alternate-channel vectors
  (`testdata/` at its tag) are checked by the member API's tests and by
  the apps' tests while that release lives.
- **Canary ladder on production hardware:** every release gets a canary
  vault at its canary step (§10.1 step 9); at each new release the oldest
  live release's canary vault is moved into the new one, so the oldest
  supported path is exercised on real hardware and real keys every month.
- **Retirement drill** in staging with each staging release: schedule
  deletion (7 days), cancel, enable, unlock, schedule again, let it
  delete, confirm `410` and the notice emails.

### 11.4 Disaster recovery objectives (proposed, O9)

| Event | Objective | How |
|---|---|---|
| Instance loss | RTO ≤ 10 min; vaults relock | ASG heals; leases expire in 180 s |
| AZ loss | RTO ≤ 15 min | groups span two AZs |
| Region loss (us-east-1) | accepted: vaults unavailable until it returns | keys are single-region (check 2 refuses multi-region keys) |
| Stored state, AWS failure | RPO 0 | S3 durability, conditional writes |
| Stored state, operator or code error | ≤ 24 hours to restore any object version; after that only the 5 newest older versions of an object, for at most 7 days | versioning; noncurrent versions kept 1 day, then the 5 newest, none beyond 7 days; a restored older version is a rollback that apps detect and warn about (§13.2) |
| Key deleted by mistake | 30 days to cancel | KMS window, CloudTrail alarm |
| Host role deleted | catastrophic, prevented | §6.3 |

No backup or export outside the service (owner decision, 2026-10-03).
The one exception, the member's History export of activity metadata
from the app (owner decisions of 2026-10-08, VAULT-MESSAGING 0.22.0
§10.9), is no backup: nothing restores from it, and it changes none of
the objectives above. No noncurrent version is kept longer than 7 days, which also bounds how long deleted vault data lingers.

## 12. First deployment

### 12.1 Sequence

1. **Owner decisions** O1–O10 (§15). O1 and O8 block release 1. (0.1.12:
   O8 as amended on 2026-10-11 no longer does; release 1 pins the
   certificate it already lists.)
2. **W0, W1:** spec and code changes (§4), merged.
3. **Accounts** (W3): staging and vault production accounts, SCPs,
   permission sets; manifest keys A and B, staging manifest key.
4. **Member API dark launch** (§9).
5. **Staging:** VaultStack, HostStack, staging release S1 (a staging
   build of the release-1 candidate) → self-test, vaultctl end-to-end with
   the test CA (enroll, unlock, message through the relay, lock, unlock,
   recovery, delete), negative tests (debug-mode enclave refused by KMS;
   S2 refused before approval; key check refuses a variant key), then
   S2 and a move, then the retirement drill. This is VAULT-PLAN's V5 exit
   test, on staging hardware.
6. **Production infrastructure:** VaultStack, HostStack (no release yet;
   API still `503 vault_unavailable`).
7. **Production release 1:** §10.1 steps 1–11. The canary needs a real
   attested Android device running a build of `com.vettid.app` signed with
   the pinned signing key: either the first Android beta (V6) or a minimal
   enrollment harness built from the app repo and signed with the same key.
   vaultctl cannot enroll into a production image (no genuine device
   attestation), by design.
8. **Publish** manifest serial 1 and the release log; RUNBOOK "Vault"
   section filled in.

### 12.2 What members can do afterwards

Nothing new until the Android app ships (V6): enrollment needs it. The
account site can show vault status. The first production users are the
owner's canary vaults. Recommendation: time production release 1 with the
Android closed beta; until then, staging carries the testing.

**Recovery in production release 1** (0.1.28; owner decision of
2026-10-15; VAULT-MESSAGING 0.33.0 §11.14.13). Release 1 carries
recovery only if it carries release R's recovery **and** the outside
store (release "R2"). Otherwise it ships with `recovery_offered: false`:
every recovery request is refused without locking the vault, and the
account site and the app say that recovery is not available in this
release yet (a member who loses the phone can then only start over,
VAULT-MESSAGING §11.11.9). It never ships the recovery of the releases
before R, because every vault sealed to a release stays open to that
release's method until its sealing key is deleted.

### 12.3 Rollback

- **Member API:** redeploy the previous version; vault routes were dark.
- **Infrastructure:** host and release stacks are stateless and can be
  redeployed or deleted; the data bucket, roles and keys are retained.
- **A bad release** cannot be rolled back by VettID (D1, forward-only):
  ship N+1. Before any member is on it, retire it at once (§10.1, canary
  failure). Members whose move to N failed can abandon the unconfirmed
  move (§11.10.4).
- **Manifest:** never lower `serial`; publish s+1 with the change
  (for example N back out of `active` before anyone enrolled).
- **Pause first** (as built, owner decision 2026-10-05): the operator's
  vault service pause (MEMBER-API "Vault service pause", RUNBOOK
  "Pausing the vault service") stops enrollment, unlock and recovery at
  once without touching vaults, keys or the manifest, and is undone by
  resuming; the manifest change above is for taking a release out for
  good.

## 13. Work items, in order

| # | Item | Repo | Effort |
|---|---|---|---|
| W0 | Spec: VAULT-MESSAGING 0.10.0 (§11.10.7 delta, M1 manifest by hash, `removed`, `ends_at`, §11.10.5, §13.5); RELEASE-UPDATES 0.2.0; VAULT-PLAN §5.1, §7; RUNBOOK placeholder | vettid.org | 1.5–2 d |
| W1 | `keypolicy` delta and variants; retirement constants; `releasecfg` channels (`go:embed`, `CHANNEL`); M1 (parent supplies the manifest by hash; `MaxBytes` 64 KiB); statuses; vectors regenerated | vettid-vault | 3–4 d |
| W2 | `release` workflow (AL2023 container, pinned nitro-cli and blobs, two builds, attestations, GitHub release); `vaultctl keycheck`, `vaultctl manifest`; compat-matrix job | vettid-vault | 3 d |
| W3 | Accounts (vault production, vault staging, and **proteus** for the prote.us website, see AWS-ACCOUNTS.md), SCPs, permission sets; manifest keys A, B and staging; move the Proteus website (AWS-ACCOUNTS §3) | AWS | 2–3 d + owner |
| W4 | Member API dark launch (§9) | vettid.org | 0.5 d |
| W5 | `VettidOrgVaultStack`: bucket, roles (fixed names, guardrails), key A, release-key custom resource, cross-account wiring if O1 | vettid.org | 3–5 d |
| W6 | `VettidOrgVaultHostStack` and the release stack construct: VPC, DNS Firewall, Image Builder, launch template, ASG, lifecycle hook, scaler, manifest sync, alarms; vettid-vault: the parent sets the control-queue policy, `deploy/host` | vettid.org, vettid-vault | 4–5 d |
| W7 | `vault/releases/<channel>.json`, `scripts/vault/manifest.ts`, `check:manifest`, `.well-known` path, release log pages | vettid.org | 2 d |
| W8 | Member API: canary routing for flagged members; notice job (retirement and hotfix emails); `removed` → 410 | vettid.org | 2 d |
| W9 | Staging stand-up, release S1/S2, hardware tests, capacity measurement, retirement drill (7 days wall time) | both | 3 d |
| W10 | Production release 1 with the canary (blocked on the signed Android build), RUNBOOK "Vault" section | both | 2 d |
| W11 | Release notes on every channel (§7, owner request 2026-10-10): `log` and log `notes` required in every channel; the staging log; check:manifest for both logs; notice email links (§3.5) and per-stage log URLs; the S1–S9 backfill; MEMBER-API "Vault release notices" and RUNBOOK ("Staging", "Adding a release") updated as built. The app's side is ANDROID-PLAN 0.1.31 | vettid.org, vettid-android | 1.5 d |

About 25–30 engineering days, plus the Android dependency for W10.
W4 can go any time; W2 and W3 can run beside W1; W5–W8 follow W3.

## 14. Risks

1. **The key-policy principals are forever** (§6.3). One deleted role
   locks every vault. Mitigated by RETAIN, fixed names, guardrails, SCPs
   and alarms; it remains the sharpest edge.
2. **Release 1's code is frozen for a year or more.** Every wire and
   manifest decision in it binds the apps and the member API until it is
   removed. (0.1.11: release 1 itself is removed 90 days after release 2
   is published, §3.5; the risk then passes to release 2.) Hence §4 before release 1, and a deliberately small release-1
   surface.
3. **Approval fatigue.** Monthly prompts may train members to approve
   blindly, or to ignore them until the deadline. Skipping empty months and
   clear notes help; the cadence is an owner decision (O4).
4. **Availability loss is now real** (R4). Members who never act lose
   their vault. The notices, the rescue window and a long default window
   are the mitigation; the confidentiality promise is untouched.
5. **Device attestation drift** (C6) can strand a member on an old
   release with a new phone.
6. **Single always-on instance**: an instance loss relocks every unlocked
   vault for up to 10 minutes.
7. **Cold starts** of old releases take minutes; members on old releases
   see a slow unlock.
8. **nitro-cli in a container** is expected to work but unconfirmed (W2);
   the fallback is building on Image Builder.
9. **Region-bound keys**: a us-east-1 outage takes every vault down.
10. **A leaked canary manifest** (accepted, owner decision 2026-10-06;
    VAULT-MESSAGING §13.9). Anyone holding an unpublished canary
    document could load it into the app and move their own vault into
    the canary release. That vault is then unreachable for them (410)
    until the release is published, and for good if the canary fails.
    The document stays with the owner and the canary tester. A
    canary-only app build with separate signing would close this; it is
    a possible later hardening tied to the canary build's signing
    (W10-READINESS B8), not done now.
11. **The vault process's system-call filter is an allow list**
    (0.1.27; vettid-vault #88). A Go or library update that makes a
    call not on it fails with EPERM in the vault process; the e2e
    suite, the strict-filter workload test and the hardware self-test
    of every release candidate are what catch it.
12. **AWS does not publish current enclave kernels** (0.1.27;
    vettid-vault #87): 4.14 in nitro-cli; one 6.6 build, February 2025.
    VettID builds its own from kernel.org source (§5.1, once the lock
    adopts it); that kernel is tested on Nitro only by VettID's
    hardware runs, so every kernel change needs one.

## 15. Owner decisions

All ten recommendations below were **accepted by the owner on 2026-10-04**.

| # | Question | Recommendation |
|---|---|---|
| O1 | Account for production vault keys and hosts (pinned in every image; blocks release 1) | **A separate vault production account** in the existing organization, with SCPs protecting the roles and the bypass flag. The current account is the management account, which SCPs cannot restrict. (Relays stay where they are.) |
| O2 | Staging | **A separate staging account**, full copy, parked between releases (as ACCOUNT-ADMIN-PLAN §3 already foresees). *2026-10-11: no longer parked; staging is the development channel (STAGING-DEVELOPMENT-PLAN D1)* |
| O3 | Manifest key custody | **Key A in KMS** (vault account, owner-only signer role with MFA), **key B offline** on a hardware token in a safe; both pinned. A separate signing account only if a second operator joins. |
| O4 | Cadence | **Monthly at most**, skipping months without member-visible change; hotfixes any time |
| O5 | Retirement window | **12 months** from supersession, final notice 90 days, KMS window 30 days; for an exploited vulnerability, a shorter window of **no less than 60 days**. *2026-10-11 (STAGING-DEVELOPMENT-PLAN D2): production release 1 only, 90 days (§3.5)* |
| O6 | Instance size | **m7g.large**, enclave 1 vCPU and 5 GiB. Measured on S3 (W9, §8.8); owner 2026-10-06: kept for release 1, revisit when unlock queueing shows in metrics |
| O7 | Always-on minimum for the current release | **0 until production members exist** (on-demand start, ~2–3 min first unlock), **1 from the Android beta** on |
| O8 | Android signing digest(s) to pin (blocked release 1 until 2026-10-11) | Accepted 2026-10-04: pin the **Play app signing certificate and the upload certificate** used for direct builds, decided when the Android signing key is created. **Amended by the owner on 2026-10-11** (ANDROID-PLAN 0.1.36 §7; §5.2): Google generates and holds the Play app-signing key; the certificate called "upload" here is VettID's release key, which signs the F-Droid and direct builds and is never given to Google; a separate key, never pinned, uploads to Play. **Release 1 pins VettID's certificate only**; the Play certificate is pinned by a later release, before the Play listing goes live; each vault is bound to its app's signer |
| O9 | Data bucket retention and DR | Versioned; noncurrent versions kept **1 day, then the 5 newest, none beyond 7 days** (owner, 2026-10-13; before: 7 days); region loss accepted for the preview; no second-region keys |
| O10 | Manifest size | **M1** (manifest by hash, supplied by the host) before release 1 |
