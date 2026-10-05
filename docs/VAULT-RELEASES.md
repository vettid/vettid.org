---
title: VAULT-RELEASES
status: approved (owner, 2026-10-04)
version: 0.1.4
date: 2026-10-04
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
related:
  - VAULT-PLAN.md (§4 V5 points here; D1–D5)
  - VAULT-MESSAGING.md (0.9.1) §11.10 release updates, §12.5 deletion, §13.5
  - RELEASE-UPDATES.md (0.1.0) — member-facing; §3 changes with this plan
  - MEMBER-API.md "Vault", RUNBOOK.md, ARCHITECTURE.md
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

Today: the vettid-vault code is feature complete through V4 and passed
the hardware smoke test (m7g.large, 1 enclave vCPU / 3 GiB, nitro-cli
1.5.0; seccomp, per-vault UIDs and attested KMS round trips work; Argon2id
at 64 MiB peaks at about 76 MB per vault process, the supervisor uses
about 13 MB). In vettid.org the member API vault routes, the vault tables
and the alarm and deletion mailers are merged but **not deployed**. No
vault infrastructure, release key or manifest exists. Release constants
in `enclave/config.go` are empty, so a release image built today refuses
every enrollment and unlock.

## 1. Summary

- **Channels.** `dev` (local, fake NSM and KMS), `staging` (its own AWS
  account, own manifest key, deletable keys, cheap) and `production`
  (member-facing, locked keys). A staging image can never open, seal to
  or be listed for production, by construction (§3.1).
- **Lifecycle.** `active` → `deprecated` (move-only) → `retired` (final
  notice) → `removed` (key scheduled for deletion, then deleted). Default
  12 months from supersession to the deadline, configurable (§3.2).
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
  always-on m7g.large; about $30 parked; staging about $10 parked (§8.9).
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
| Release keys | dev sealer | §11.10.7 shape, retirement window 7 days, deleted after use | §11.10.7 shape, window 30 days, deleted only at retirement |
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
  from `main` that week, spends at least a week in staging, and is
  published in the third week. A month with no member-visible change is
  skipped: every release costs each member an approval.
- **Hotfix.** A security fix ships as the next release number, cut from
  the current release's tag plus the fix, with the short canary (§10.2).
  Its notes carry the urgency; members on affected releases are emailed.
  The fix is prepared in a private fork and the public source is pushed
  when the release is published (AGPL: source with the release).
- **Never** "every merge": `main` builds a staging image nightly; only
  the train or a hotfix creates a production release.

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
| C2 | Alternate channel (app ↔ member API ↔ queue ↔ enclave) | Routes and their errors; envelope v2, suite 2, the 13,444 / 5,252-byte sizes; descriptor v1; the SQS message v1 and its ops (`enroll`, `unlock`, `lock`, `delete`, `recovery`, `recovery_cancel`, `recovery_register`); response slots; the unlock, approval and recovery signing strings. **Apps keep the oldest live release's formats.** |
| C3 | Storage and tables | S3 keys `vaults/<vault_id>/…` and `users/<hash>/vault`, conditional-write semantics; the attributes a release's parent reads and writes (lease, registry row, response slot, lifecycle events, `alarm`); the queue name prefix. Schema changes additive only. |
| C4 | Host | Each release runs **its own tag's parent** on its own AMI, so the vsock protocol never crosses versions. Host OS patches rebuild the AMI with the same EIF and parent. |
| C5 | AWS | The pinned KMS region endpoint, SigV4, IMDS credentials, the pinned Amazon roots (Amazon Root CA 1 runs to 2038) |
| C6 | Device attestation | The Android signing-certificate digests, package name and iOS app ID pinned in the release; the pinned Google, Apple and GrapheneOS roots. Rotating the app signing key needs every live release to pin the new digest first (two digests pinned). |
| C7 | Relay | Not needed for a move (a move locks without collecting). Ordinary unlocks collect from the relay: best effort only. The relay stays backward compatible in practice, but a deprecated release may lose messaging. |
| C8 | Member API vault features | Lock, status, recovery and the host `delete` (account cancellation) keep working for every live release |

Testing the contract is §11.3. The weakest point is C6: a member who
moves to a phone whose attestation chains to a root the old release does
not know cannot unlock that release. Mitigation: pin the vendors'
announced next roots, and keep the window to a year.

### 3.5 Retirement, notices and key deletion

For release N superseded by N+1 at T0, with window W (default 12
months, set per release in `releases.json`, §7):

| When | Manifest | Instances and key | Member notices |
|---|---|---|---|
| T0 | N `deprecated` | on demand | in-app: update available (every unlock) |
| T0 + W − 90 days | N `retired`, `ends_at` = D | on demand | email 1; in-app final warning with the date |
| D − 30, − 7, − 1 days | | | emails 2–4 |
| **D = T0 + W** (the deadline) | N `removed` | instances stopped; API answers `410 release_unavailable`; **`ScheduleKeyDeletion(30 days)`** | email: the release has ended; how to ask for a rescue |
| D … D + 30 | | key `PendingDeletion` | **rescue on request**: `CancelKeyDeletion`, `EnableKey`, start an instance, the member moves, deletion is scheduled again |
| D + 30 | entry stays while a live key admits N (§4.2) | key deleted | email: the vault could not be opened and its data is erased; enroll a new vault |
| D + 37 | | the stored objects of vaults still sealed to N are deleted (they can never be opened), and their rows | |

Why the KMS window sits after the deadline: a key that is pending
deletion already refuses `Decrypt` and `GenerateDataKey`, so scheduling
deletion *is* the end of service. The 30 days are a buffer to abort a
mistake or rescue a member who writes in, not extra time members are
told to count on. Cancelling leaves the key `Disabled`; `EnableKey`
restores it, which is why the retirement role needs both (§4.1).

Who is emailed: members whose vault row's `sealed_release` is N, found
through the vaults table's `user-index`. That value is advisory (written
by the host), which is fine for notices. Emails go through the existing
system mailer (SES; members are verified identities). Members in a
recovery are emailed the same way.

Shortened windows: a release with a known exploited vulnerability may get
a shorter window, never under 60 days (owner decision O5).

*As built (W8).* The member API's daily `VaultNoticeJob` (MEMBER-API
"Vault release notices") sends emails 1–4 (90, 30, 7, 1 days before
`ends_at`, for `deprecated` and `retired` releases; only the latest
milestone due) and the deadline email (`removed`, up to 14 days after
`ends_at`, not during a rescue), plus the hotfix email of §10.2 (a release
whose log says `security: urgent`, to members on its `affects` releases,
for 30 days). It finds members through a new vaults-table index,
`sealed-release-index` (projects `vault_id`, `user_guid`, `state` only;
the `user-index` cannot answer "who is on release N"), with its own role
(`vettid-org-member-vault-notices`: `Query` on `vault-releases` and that
index, nothing else in the vault account). Each notice is sent once per
member, release, end date and milestone (a claim in the ratelimits table).
In-app: `GET /api/vault/status` carries the release's number, status,
`ends_at` and a `notice`. **Not built:** the D + 30 "erased" email and the
D + 37 deletion of stored objects (they need the cleanup role in the
bucket policy, §8.2); both wait until a release first nears its end.

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

`nitro-cli build-enclave` needs Docker and the nitro-cli kernel and init
blobs, not the Nitro Enclaves device (that is needed only to run an
EIF), so a GitHub arm64 runner can build it. The blobs are part of PCR0,
so they are pinned like the toolchain:

- A new `release` workflow in vettid-vault, on `ubuntu-24.04-arm`, runs
  the build inside `amazonlinux:2023` pinned by digest, with the
  `aws-nitro-enclaves-cli` package at a pinned version (1.5.0 today)
  verified by RPM checksum, and the runner's Docker socket mounted.
  `scripts/build-eif.sh` is reused; `eif-toolchain.lock` records the
  container digest, package version and the SHA-256 of each blob.
  `NITRO_CLI_ARTIFACTS` is set per build.
- It builds twice from clean (the existing `enclave-image` job already
  proves byte-identical binaries) and requires identical PCR0/1/2.
- Outputs, per channel (`prod`, `staging`): `vault-enclave.eif`,
  `measurements.json` (commit, binary SHA-256, PCR0–2, nitro-cli version,
  toolchain lock hash), the `vault-parent` arm64 binary and its SHA-256.
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
| `android_signers` | SHA-256 of the app signing certificate(s) | owner decision O8 |
| `relay_url` | `https://relay.vettid.org` | |

GrapheneOS verified-boot keys and vendor roots stay in `vms/pins` (code).
Everything that defines a release is in the tagged tree, so
`git checkout vault-rN && make eif CHANNEL=prod` reproduces it; no
`-ldflags -X` and no build-time secrets. A missing or zero value still
fails closed.

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
  (`scripts/vault/sign-manifest.ts`, which renders the manifest from
  `releases.json`, increments `serial`, signs with KMS and writes the
  served document). A gated workflow with required reviewers can replace
  it once there is a second person to review.
- Staging uses its own deletable KMS key.
- *As built (W7).* `lib/config.ts` `manifestKeys` pins key A in production
  (`alias/vettid-org-vault-manifest`, key_id `4353463f85c4012f`) and the
  staging key (`alias/vettid-org-staging-vault-manifest`, key_id
  `e9b3a403423120ac`), from `aws kms get-public-key`. **Key B is a TODO**
  until the owner's hardware token exists. A served document carries one
  signature and `key_id` selects the pinned key that verifies it
  (VAULT-MESSAGING §11.10.1), so manifests signed with key A alone are
  complete, not weakened; but key B must be pinned in release 1's
  `releasecfg/prod.json` and in the app before production release 1,
  because a key an image does not pin can only be introduced by a new
  release (the prod channel file's B placeholder also keeps the release
  gate closed until then). Signing is `scripts/vault/manifest.ts sign`,
  which drives vettid-vault's `vaultctl manifest render/check/sign` (not a
  second signer implementation) as the signer role and re-checks the
  result with this repository's renderer and verifier.

### 6.2 Release sealing keys

One key per release, created in `VettidOrgVaultStack` by a custom
resource (`aws-kms.Key` always adds an administrator statement):

- `CreateKey` with `KeySpec SYMMETRIC_DEFAULT`, `KeyUsage
  ENCRYPT_DECRYPT`, `Origin AWS_KMS`, `MultiRegion false`, the policy
  rendered from `releases.json`, `BypassPolicyLockoutSafetyCheck: true`,
  and tags `vettid:release`, `vettid:channel` given at creation. No alias
  (`CreateAlias` would need a key-policy permission). The ARN goes to SSM
  `/vettid-org/<stage>/vault/releases/<n>/seal-key-arn`.
- The policy, from the spec's normative example plus §4.1: `Decrypt` for
  the host role with the release's PCR0; `GenerateDataKey` for the host
  role with the PCR0s of release N and of **every release not `removed`**
  when N is created (all of them may still move into N); reads for the
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
     example's shape for every release in `releases.json`.
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

- **Source of truth:** `vault/releases.json` in this repo: per release its
  number, tag, commit, PCR0–2, binary hash, nitro-cli version, admitted
  PCR0s, seal-key ARN (after creation), status, `published_at`, `ends_at`,
  window, instance settings and notes URL. CDK (keys and release stacks)
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
  equal a fresh render of `releases.json`; the size limit; every PCR0
  admitted by a live key is listed; every listed release has a release-log
  entry.
- **`serial`:** increases by one per publication; it is never reused, even
  for a canary manifest that is never published (§10.1).
- **Release log:** `/security/releases/` on vettid.org, one page per
  release with the RELEASE-UPDATES §5 fields, generated from
  `releases.json` so it cannot disagree with the manifest. It stays
  after a release is removed.
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
  W7's `sign-manifest.ts`).

*As built (W7).*

- **Release lists:** `vault/releases/prod.json` and `staging.json`
  (`lib/vault/release-list.ts`): per release the manifest fields, `status`
  (`candidate` or a manifest status), `admitted_pcr0s` (fixed at key
  creation), an optional `host` (the release stack's pins; absent: no
  stack) and, in production, `log` (summary, changes, `security`: `none`,
  `recommended` or `urgent`, `security_text`, `affects`). Plus
  `signed_serial`, the highest serial ever signed. CDK builds one release
  key per entry and one release stack per entry with `host`; synth fails on
  an invalid file. The files are also valid `vaultctl manifest render
  -releases` input (it ignores the extra members). The window is not a
  field: `ends_at` is set explicitly per §10.3.
- **Served files:** production `website/.well-known/vettid/pcr-manifest.json`;
  staging `vault/staging/pcr-manifest.json`, served byte for byte at
  staging.vettid.org by `VettidOrgStageSiteStack` (W9). **Nothing is served in either
  channel today**: an empty manifest is not valid (it lists at least one
  release), and nothing may be served before the first release is
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
  running); every admitted PCR0 listed; for production, the release log
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
| `VettidOrgVaultRelease<N>Stack` | stateless, one per live release | Image Builder component, recipe and image (the AMI); launch template; ASG (min/max from `releases.json`); termination lifecycle hook; per-release alarms | ~12 |

Recommended over one stack with all release groups: a deploy for release
N+1 cannot touch release N's instances (D1: no fleet instance refresh,
never replace an old release's instances with a new release); retiring a
release is deleting its stack; and each stack stays far below the 200-
resource guardrail. No `Fn::ImportValue`: release stacks read the host
stack's refs through SSM (RUNBOOK conventions).

*As built (W6).* `lib/stacks/vault-host-stack.ts` and
`lib/stacks/vault-release-stack.ts`; the app builds the host stack in each
vault account and one release stack per entry of `lib/vault/releases.ts`
(empty; W7's `releases.json` replaces it). Release stacks read
`vault/host-security-group-id`, `host-subnet-ids`, `image-builder-infra-arn`
and `alerts-topic-arn`, and publish `vault/releases/<N>/group-name`. The
host stack also publishes `dlq-arn`, `relay-host`, `host-log-group` and
`smoke-key-arn` for the hosts' boot. The lifecycle hook is inline in the
group (`vault-drain`, 300 s, default CONTINUE); per-release alarm: desired
> in service for 15 minutes. Both stacks stay far below 200 resources
(guardrail test).

**Data bucket** `vettid-org-vault-data-<account>`: block public access,
SSE-S3 (objects are already DEK-encrypted or KMS-sealed), TLS only,
versioned, noncurrent versions and delete markers expire after **7 days**
(O9). Prefixes: `vaults/`, `users/`, `manifests/`. Conditional writes
(`If-None-Match`, `If-Match`) work on versioned buckets. Host access is
limited to `vaults/*`, `users/*` and reading `manifests/*`; the cleanup job
deletes `vaults/*` and `users/*` (VAULT-PLAN V5 account deletion).
*As built (W5):* the bucket policy denies every object action on
`vaults/*`, `users/*` and `smoke/*` to every principal but the host role,
and writes to `manifests/*` to every principal but the signer role. The
cleanup job's object deletion (D + 37, W8) is not granted yet: W8 adds its
role to that exception. Restoring an older object version (§11.4) means
editing the bucket policy first.

### 8.3 Hosts and the AMI

- **Instance:** Graviton `m7g.large`, on demand (D2), Nitro Enclaves on,
  IMDSv2 with hop limit 1, encrypted gp3 root (20 GiB), no key pair, no
  inbound, SSM Session Manager only (sessions logged), public IPv4 in a
  public subnet.
- **AMI:** EC2 Image Builder, one image per release, built at deploy time
  by the release stack (`CfnImage`; the AMI id feeds the launch template
  directly). The component installs, from pinned sources with checksums:
  AL2023 arm64 (AMI pinned in `cdk.context.json`), nitro-cli and the
  allocator (enclave: 1 vCPU, memory O6), the release's `vault-parent`
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
  5 GiB, `vault-host-config`, `vault-lifecycle`, CloudWatch agent
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
   `android.googleapis.com`) and resolves them itself, so the enclave
   cannot choose addresses.
2. TLS ends in the enclave against pinned roots (D5): a misroute can only
   fail, never be read.
3. **Route 53 Resolver DNS Firewall** on the VPC: allow-list of the three
   hosts plus the AWS endpoints the parent and agents use (SQS,
   DynamoDB, S3, SSM, SSM messages, EC2 messages, CloudWatch Logs and
   metrics, Auto Scaling); block everything else. It limits a
   compromised parent too, including DNS tunnelling.
4. Security group: no inbound; outbound TCP 443 only (plus DNS to the
   resolver). VPC Flow Logs for audit (7–30 days).

**KMS: public endpoint, no interface endpoint.** An interface endpoint
with private DNS would serve the same name and an Amazon certificate, so
the enclave's pinned roots would accept it, but it adds about $15/month
(2 AZs) and no security: the key policy may not carry
`aws:SourceVpce` (check 7 refuses other conditions), and the public path
is TLS terminated in the enclave anyway. S3 and DynamoDB use the free
gateway endpoints. No NAT.

*As built (W6).* The allowlist is `lib/vault/egress.ts` (snapshot-tested):
the relay, `kms`, `android.googleapis.com`; `sqs`, `dynamodb` and the
SDK's account endpoint `<account>.ddb`, `s3` and the data bucket's
virtual host, `ssm`; `ssmmessages`, `ec2messages`, `logs`, `monitoring`,
`autoscaling` (all `us-east-1`); `*.ec2.internal`. Allowed names may
redirect (CNAME chains to ELB or S3 names: `TRUST_REDIRECTION_DOMAIN`);
everything else is NXDOMAIN; the association is mutation-protected and the
resolver fails closed (the default). Query logs go to
`/vettid-org/<stage>/vault-dns` (metric `DnsQueriesBlocked`, no alarm until
W9 shows the baseline noise). The gateway endpoints' policies admit only
resources of the vault account (`aws:ResourceAccount`). Flow logs (all
traffic) to `/vettid-org/<stage>/vault-flow-logs`, one month.

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

- Parent logs (journald → CloudWatch agent) to
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

### 8.8 Capacity

From the smoke test: Argon2id peaks at about 76 MB per vault process, the
supervisor about 13 MB. On an m7g.large (2 vCPUs, 8 GiB) the enclave gets
1 vCPU (the parent keeps one) and up to about 6 GiB, so about 60–70
concurrently unlocked vaults if processes stay near their peak; steady
state RSS after the KDF is to be measured (W9). One vCPU serializes
Argon2id (a few hundred milliseconds each), which bounds unlock bursts.
`m7g.xlarge` (3 enclave vCPUs, ~12 GiB) is the next step. Plenty for the
preview.

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

Staging, parked: about $10 (its few keys deleted after use, a parked
group, the shared relay or a parked staging relay). Image Builder is free
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
| 1 | Freeze; open `release/rN` from `main`; the release commit sets `releasecfg/prod.json` `release: N` (and any pin changes); review; signed tag `vault-rN` | vettid-vault | tag |
| 2 | `release` workflow: EIF ×2 per channel, measurements, parent binaries, attestations; draft GitHub release | CI, arm64 | artifacts, PCRs |
| 3 | Independent rebuild; PCR0 must match | owner | sign-off |
| 4 | Staging: add staging release to staging `releases.json`, deploy its key and release stack, hardware self-test, vaultctl end-to-end, compat run incl. a move from the previous staging release (§11) | staging | report |
| 5 | Production PR: add N to `vault/releases.json` (status `candidate`: in CDK, not in the manifest), admitted PCR0s = N plus every release not `removed` | vettid.org | PR |
| 6 | Deploy `VettidOrgVaultStack` (creates the key); `vaultctl keycheck` against the draft manifest | owner | key ARN in `releases.json` |
| 7 | Deploy `VettidOrgVaultRelease<N>Stack` (AMI with EIF verified against measurements; group min 0, canary 1) | owner | instance |
| 8 | Hardware self-test on the canary host (`vault-parent -selftest` against the host stack's deletable smoke key), then normal start | SSM | PASS report |
| 9 | Canary: sign manifest `serial` s+1 with N `active` but **do not publish**; the registry row is `canary`, routed only for flagged test members (W8 adds this to the member API); canary member enrolls into N, unlocks, locks; the oldest live release's canary vault moves into N (§11.3); soak 24 h | owner, test device | canary report |
| 10 | Publish: commit the signed manifest (N `active`, N−1 `deprecated`, any `retired`/`ends_at` changes), the release log entry, `deploy:site`; manifest sync updates routing | owner | live |
| 11 | Previous release group to minimum 0; the always-on minimum moves to N (O7) | owner | |
| 12 | In-app prompts follow from the manifest; no email for a routine release | — | |

*As built (W7, W8).* Step 9: `scripts/vault/manifest.ts sign` then
`upload` (the bucket copy only; nothing is served), and the operator's
`canary` row on `vettid-org-vault-releases` for N's PCR0 (RUNBOOK "Canary
routing"). The member API routes a `canary` release only for members
whose row has `vault_canary: true`: their enrollment goes to the newest
canary release (also before production release 1, when nothing is
`active`), their vaults sealed to it are routed there; for everyone else
it is unknown (410). The scaler manages a `canary` row like any release.
The test device loads the canary manifest out of band (it is not served).
Step 10: `manifest.ts publish` with the same signed document, so the
canary vault's recorded serial is the published one; the manifest sync
turns the row into an `active` one. A test member's flag is an operator
write on the members table; there is no member-facing or admin-UI switch.

If the canary fails before step 10: the manifest s+1 is never published
(the next one is s+2); N's group is deleted; N becomes `removed` in
`releases.json` (it admits nothing, and no later key admits it) and its
key is scheduled for deletion at once (no member was ever on it). The
fix ships as N+1.

### 10.2 Hotfix

Same steps, cut from `vault-r<current>` plus the fix, with the canary
soak shortened to 2 hours and step 4 limited to the self-test, end-to-end
and one move. Release notes carry `security: urgent` and the affected
releases; members sealed to them are emailed (W8 job). The window for an
exploited vulnerability may be shortened (O5).

### 10.3 Retirement, per release

A monthly checklist driven by `releases.json` (`ends_at` per release),
with the notice job sending the emails of §3.5 automatically:

1. At T0 + W − 90 days: set `retired` and `ends_at` = D; publish.
2. At D: set `removed`; publish; delete the release stack (instances
   stop; `available` false; API 410); as the retirement role,
   `aws kms schedule-key-deletion --key-id <arn> --pending-window-in-days 30`;
   the deadline email goes out.
3. Rescue (D … D+30), on a member's request: as the retirement role,
   `cancel-key-deletion`, `enable-key`; redeploy the release stack and set
   `rescue: true` on its `vault-releases` row (the member API routes a
   `removed` release only then); the member moves; remove `rescue`; then
   step 2 again.
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
testing. Everything parked between releases.

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
GuardDuty cover the account). Staging has no release log; its notices link
to production's. Order and manual steps: RUNBOOK "Staging". Idle cost of
the main stacks about $10/month, so parking needs nothing beyond the
scaler's zero groups.

### 11.2 Hardware smoke on every release candidate

`scripts/smoke/run-on-host.sh` and the self-test from SMOKE.md, run on
the release's own AMI (both channels) rather than a host build, with the
deletable smoke key in each account. `VettidOrgVaultSmokeStack` stays as
the ad-hoc tool for testing hardware questions outside a release.

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
| Stored state, operator or code error | ≤ 7 days to restore an object version | versioning, 7-day noncurrent retention; a restored older version is a rollback that apps detect and warn about (§13.2) |
| Key deleted by mistake | 30 days to cancel | KMS window, CloudTrail alarm |
| Host role deleted | catastrophic, prevented | §6.3 |

No backup or export outside the service (owner decision, 2026-10-03).
The 7-day retention also bounds how long deleted vault data lingers.

## 12. First deployment

### 12.1 Sequence

1. **Owner decisions** O1–O10 (§15). O1 and O8 block release 1.
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
| W7 | `releases.json`, `sign-manifest.ts`, `check:manifest`, `.well-known` path, release log pages | vettid.org | 2 d |
| W8 | Member API: canary routing for flagged members; notice job (retirement and hotfix emails); `removed` → 410 | vettid.org | 2 d |
| W9 | Staging stand-up, release S1/S2, hardware tests, capacity measurement, retirement drill (7 days wall time) | both | 3 d |
| W10 | Production release 1 with the canary (blocked on the signed Android build), RUNBOOK "Vault" section | both | 2 d |

About 25–30 engineering days, plus the Android dependency for W10.
W4 can go any time; W2 and W3 can run beside W1; W5–W8 follow W3.

## 14. Risks

1. **The key-policy principals are forever** (§6.3). One deleted role
   locks every vault. Mitigated by RETAIN, fixed names, guardrails, SCPs
   and alarms; it remains the sharpest edge.
2. **Release 1's code is frozen for a year or more.** Every wire and
   manifest decision in it binds the apps and the member API until it is
   removed. Hence §4 before release 1, and a deliberately small release-1
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

## 15. Owner decisions

All ten recommendations below were **accepted by the owner on 2026-10-04**.

| # | Question | Recommendation |
|---|---|---|
| O1 | Account for production vault keys and hosts (pinned in every image; blocks release 1) | **A separate vault production account** in the existing organization, with SCPs protecting the roles and the bypass flag. The current account is the management account, which SCPs cannot restrict. (Relays stay where they are.) |
| O2 | Staging | **A separate staging account**, full copy, parked between releases (as ACCOUNT-ADMIN-PLAN §3 already foresees) |
| O3 | Manifest key custody | **Key A in KMS** (vault account, owner-only signer role with MFA), **key B offline** on a hardware token in a safe; both pinned. A separate signing account only if a second operator joins. |
| O4 | Cadence | **Monthly at most**, skipping months without member-visible change; hotfixes any time |
| O5 | Retirement window | **12 months** from supersession, final notice 90 days, KMS window 30 days; for an exploited vulnerability, a shorter window of **no less than 60 days** |
| O6 | Instance size | **m7g.large**, enclave 1 vCPU and 5 GiB; revisit after the capacity measurement (W9) |
| O7 | Always-on minimum for the current release | **0 until production members exist** (on-demand start, ~2–3 min first unlock), **1 from the Android beta** on |
| O8 | Android signing digest(s) to pin (blocks release 1) | Pin the **Play app signing certificate and the upload certificate** used for direct builds, decided when the Android signing key is created |
| O9 | Data bucket retention and DR | Versioned, **7-day** noncurrent retention; region loss accepted for the preview; no second-region keys |
| O10 | Manifest size | **M1** (manifest by hash, supplied by the host) before release 1 |
