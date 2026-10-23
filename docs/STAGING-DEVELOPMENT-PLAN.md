---
title: STAGING-DEVELOPMENT-PLAN
status: approved by the owner 2026-10-11 (D1–D11 as recommended; D3 as in ANDROID-PLAN 0.1.36, which replaced 0.1.34's answer the same day)
version: 0.1.4
date: 2026-10-23
owner: Al Liebl (Mesmer)
related:
  - VAULT-RELEASES.md (0.1.10) §3 releases, §8.6 scaler, §8.9 cost, §11.1 staging, §15 O2
  - W10-READINESS.md (0.1.5): production release 1
  - RUNBOOK.md "Staging", "Parking", "Production drift", "Push gateway"
  - ANDROID-PLAN.md (0.1.33) §6 phases; CALLING-SERVICE.md (0.1.1); LEASH-IMPLEMENTATION.md
changelog:
  - 0.1.0: first draft after the owner's question of 2026-10-11 ("keep
    using staging for adding the calling, agents, etc."); state measured
    2026-10-11 about 15:30 UTC (read-only AWS and repository checks, §8)
  - 0.1.1: D3 corrected (owner decision 2026-10-11, ANDROID-PLAN 0.1.36
    §7): Google generates and holds the Play app-signing key, VettID's
    own key signs the F-Droid and direct builds and is never given to
    Google, so there are two signers, not one. Release 1 pins only
    VettID's key and does not wait for the Play account (§2.2, §5 rows
    0a and 1, §6, §7 row 9, §8.4)
  - 0.1.2: state after staging release S10 (2026-10-11; approved by
    the owner 2026-10-11). D4 (feature allowlist), D5 (the staging
    application id) and the signer binding are in S10, which is
    published; §4, §5 row 1, §7 and §8 say what is now done. New
    §8.5, the S10 record. Nothing else in the plan changes
  - 0.1.3: **approved by the owner 2026-10-18** (owner's request of
    2026-10-18). §2.1 rule 6: staging's waits run on a time scale, 1 day
    = 1 hour (STAGING-TIME-SCALE 0.1.0); production's scale is 1
  - 0.1.4: editorial (status as of 2026-10-23); no rule changes. §5
    gets a status column and the "state today" cells that events had
    overtaken say so (rows 0a, 2, 3, 4, I); §8.5 notes that its release
    counts are those of 2026-10-11
classification: public (no secrets; safe for github.com/vettid)
---

# Staging as the development channel (plan)

## 1. Purpose and decision

Staging stops being a rehearsal that is "parked between releases" and
becomes the channel where every feature after v1 (calls, agents and the
rest) is built and tested first. Production release 1 ships early and
small, to the owner and named testers, so that the production pipeline is
proven once while features keep landing on staging. Production's member
API and portal are deployed on a fixed rhythm so they never fall far
behind, and a feature reaches production members only through a
production vault release that passed the promotion checklist (§2.4).

This document changes no code and no infrastructure. If accepted, it
amends the documents listed in §7; they are not edited in this PR.

## 2. Rules

Each rule is a proposal. Those that need the owner's choice are in §6.

### 2.1 Staging is the development channel

1. Every vault, member API, portal and app change is deployed to staging
   first and used there from a real phone before anything else happens
   to it.
2. **At most three staging releases are not `removed`**: the `active`
   one and the two before it. Today seven are (S3–S9, §8.2).
3. **At most two staging releases a week**, cut on fixed days (proposal:
   Tuesday and Friday); fixes that can wait are batched. S1–S9 took seven
   days; each release costs a key, an AMI, a stack and a move on every
   test phone.
4. Staging keeps its 7-day key deletion window
   (`retirement_window_days`, pinned in the image; production's is 30).
5. Staging vaults are disposable, including the one on the owner's phone.
   Nothing kept only in a staging vault is safe.
6. (0.1.3, approved by the owner 2026-10-18) **Staging's waits run on a time
   scale: 1 day = 1 hour** (STAGING-TIME-SCALE). The release constant
   `time_scale` is 24 on staging and exactly 1 in production; the waits
   of an hour or more that a tester waits through (the owner check, the
   idle lock, recovery's delays, the old phone's 7 days) are divided by
   it, from the vault release that ships it and for timers started
   after a vault moves into it. AWS windows, such as rule 4's 7 days,
   are not scaled.

### 2.2 Production release 1: early and small

1. It is cut from the newest staging release that has passed §2.4. It
   does not wait for calls, agents or FCM, nor (0.1.1) for the Google
   Play account: it pins only VettID's own signing key, and the Play
   certificate comes with a later release (D3; W10-READINESS 0.1.7
   P9).
2. Members: the owner and named testers only (proposal: at most 10),
   through registration codes as today. No public announcement.
3. It exists to exercise what staging cannot: signing with offline key B,
   keys that cannot be deleted early, the 30-day window,
   production SES and the admin site, real member data.
4. Its cost must be accepted knowingly: **release 1 freezes its wire
   formats and its pinned app signers** for as long as it is live
   (VAULT-RELEASES §3.4 C2 and C6), by default 12 months. A shorter first
   window is decision D2.

### 2.3 Production's backend stays in step

1. Production's member API, portal and admin stacks are deployed from
   master **once a week** (proposal: Monday), after `cdk diff` is read,
   and at once for a security fix. RUNBOOK already says "deploy what you
   merge"; today production is five days behind and the daily drift check
   has failed since at least 2026-10-08 (§8.3).
2. Before the first such deploy, the operator creates the missing SSM
   parameter `/vettid-org/prod/member/enroll-code-key` (RUNBOOK "Setup
   codes and app keys"); without it setup codes cannot work in production.
3. **"Switched off" for a vault feature** means: no production release
   contains it. There is no feature flag inside a vault image today; an
   image answers every operation its source registers
   (`features/all/all.go`). Until a production release is `active`, the
   production member API answers `503 vault_unavailable` on the vault
   routes. Whether release 1 should carry an allowlist is decision D4.
4. **"Switched off" for a member API or portal feature** means: the code
   is deployed, and a route or page that needs a vault feature production
   does not have yet is behind a stage context value that is absent in
   production (the pattern of `androidAppUrl`, `pushStages`,
   `<stage>VaultLegacySessionAuth` in `lib/config.ts`). A change that
   cannot be gated this way does not merge until its production release
   is planned.
5. Shared stacks (§3 risk 6) are deployed to production in the same
   weekly slot, never as a side effect of a staging deploy.

### 2.4 Promotion: what a feature passes on staging first

A feature may go into a production release when all of these are true:

1. Its spec is merged with a version number, and the code cites it.
2. It is in a **published** staging release whose independent rebuild
   matched PCR0 and whose key check passed.
3. It was used on both kinds of test phone (GrapheneOS and stock Android)
   with the released staging build, not the local dev stack.
4. A vault holding the feature's data moved to the next staging release
   and the data and the feature still worked (the move-only contract).
5. Seven days on staging since the last change to it, with no open bug
   that loses data, locks a member out or weakens a security property.
6. Its member API and portal parts are deployed in production, switched
   off (§2.3), and the drift check is green.
7. It needs no staging-only shortcut (§4).
8. Its release-log text is written (VAULT-RELEASES §7).
9. The owner approves the production release PR that lists the features.

Production releases stay on the monthly train of VAULT-RELEASES §3.3 once
release 1 exists; staging no longer follows that cadence.

### 2.5 Cleanup

1. When S(N) becomes `active`: S(N−1) stays, S(N−2) and older go. For
   each: move or delete its test vaults, set `removed`, publish the
   manifest, delete its release stack. The assistant prepares this as one
   PR per staging release.
2. Key deletion is always run by the owner (retirement role), **batched
   once a week** from a list the assistant prepares; the assistant
   confirms each deletion after its 7 days.
3. A vault left unlocked keeps its release's host running (about $2 a
   day, §8.2). Lock test vaults at the end of a session.
4. Test members: automated runs use a fresh `@test.staging.vettid.org`
   address and delete the member at the end. Named test members (the
   phones) are kept; the assistant lists the members table monthly and
   the owner says which rows go. Today: 10 members, 8 vault rows.
5. A staging-only switch gets an end date when it is added (§4).

### 2.6 A separate dev channel: not yet

Not now. A third account means a third copy of every stack, key and
manifest to keep in step, and the rehearsal it would free staging for is
covered by production release 1 shipping early. The local dev stack
(vettid-vault integration stack, the app's `devStack` build) stays the
place for work that needs no hardware.

It becomes worth it when any one of these is true: staging has members
who are not VettID's own testers; two people need incompatible vault
builds on hardware in the same week; or a production release has to be
rehearsed while staging is deliberately broken for more than a few days.

### 2.7 Feature order

See §5. The order after v1 stays as ANDROID-PLAN §6 has it (calls,
devices/agents/LEASH, wallet, location, presence); §5 adds where the
other open work fits.

## 3. Risks and answers

| # | Risk | Answer |
|---|---|---|
| 1 | **Production drift.** Production backend falls behind master and one day's deploy carries weeks of change. | Weekly deploy (§2.3.1); the daily drift check already exists and must be green by Tuesday. Staging itself is not drift-checked (RUNBOOK "Production drift"); it is deployed with every merge, so that is accepted. |
| 2 | **Things only production has are never rehearsed**: key B signing, 30-day keys, Play signing, production SES, the admin site's vault pages, the canary path with no published release. | Release 1 early, with testers only (§2.2). Until then these stay unproven; say so in W10-READINESS. |
| 3 | **Staging does two jobs**, development and the rehearsal of a production release. | The rehearsal is a named staging release: the production candidate is cut from the same commit as a staging release that then gets seven quiet days (§2.4.5) while development continues on the next one. Two live staging releases beside the active one (§2.1.2) make room for that. |
| 4 | **No path from staging to production.** Channels cannot cross: a staging vault is sealed to staging keys and a production app does not trust the staging manifest. | Accepted, and stated to every tester: moving to production is a fresh enrollment. The owner's own vault becomes a production vault at release 1 and its staging contents are re-entered by hand. Nothing is built to migrate. |
| 5 | **Cost and clutter.** | The numbers are in §8.2: about $5–8 a day at the current pace, four fifths of it host hours. Rules §2.1.2, §2.1.3 and §2.5 should bring staging to about $100–120 a month (one host most of the time, fixed parts, three keys, the push gateway). An estimate, not a measurement. |
| 6 | **Shared pieces** (§8.1): staging vaults and the staging app use the production relay; the staging push gateway runs in the management account behind the relay's load balancer; one `cdk.json` and one repository serve both channels. | (a) No relay change is tested on `relay.vettid.org`: a relay change gets a staging relay first, as VAULT-RELEASES §11.1 foresaw (about $55 a month while up), and a staging release that pins it. (b) Push: channels have separate services, secrets and task roles; a staging push deploy must show no change to the relay's listener default action or service in `cdk diff`. (c) Shared stacks deploy in the production slot only (§2.3.5). (d) No load or abuse testing against anything shared. |
| 7 | **Release 1 freezes too early**: formats and signers proven for days, supported for a year. | Decision D2 (a shorter first window) and D3 (which signers release 1 pins). This is the main cost of "early". |

## 4. Staging-only shortcuts

| Shortcut | State (2026-10-11) | Decision proposed |
|---|---|---|
| `stagingVaultLegacySessionAuth` (portal sessions accepted on app routes) | **On**: not in `cdk.json`, passed at every staging member API deploy as `-c stagingVaultLegacySessionAuth=true`; the staging Vault function has `VAULT_LEGACY_SESSION_AUTH=1` (checked 2026-10-11). The drill's member 1 (S3, old app) needs it | **Remove** after the S3 drill ends (2026-10-13): redeploy without the flag, then delete the context key, the env switch and its test in one PR. Until then a staging member API deploy without the flag breaks member 1 |
| Automation signing key among staging `android_signers` (second digest, added at S2) | Pinned in every staging image | **Keep for development.** Never in `prod.json` (reviewed in the release commit, W10-READINESS §3 step 1) |
| Test mail `*@test.staging.vettid.org` (SES inbound, staging account) | Deployed (`VettidOrgStageTestMailStack`) | **Keep.** Never built for production |
| Canary flags on staging members | None set today (0 of 10 rows) | **Keep the mechanism**, set only for a canary run and cleared in the same session |
| Staging app has the production application id `com.vettid.app` (the vault pins one package for both channels, `enclave/config.go`) | Staging and production builds cannot be on one phone; switching means uninstalling, which removes the app's keys, so the vault must be recovered (24 h wait) or re-enrolled. **Ended at S10 (0.1.2):** the staging build is `com.vettid.app.staging` and S10 accepts only that package in key attestation | **Time-box**: decision D5 (done) |
| Staging SES in the sandbox | Every recipient is a verified identity | **Keep** (RUNBOOK: never request production access for staging) |
| No admin site on staging; test data by `npm run staging:seed` and the CLI | As built | **Keep**; consequence: the admin site's vault pages are only ever exercised in production (risk 2) |
| Device attestation: test CA accepted beside the vendor roots on staging | As built (VAULT-RELEASES §3.1) | **Keep** |

## 5. Feature order

"Vault code exists" means the feature is in `vettid-vault` `main`
(`features/…`) and so in current staging images; it does not mean it was
ever used from a phone. (Written 2026-10-11: no app code existed for any row from 2 on. The last column is the status of 2026-10-23.)

| # | Phase | State today | Repos | Needs a vault release? | Depends on | Owner input needed | Status (2026-10-23) |
|---|---|---|---|---|---|---|---|
| 0 | Finish v1 on staging: A6 hardening, S3 retirement drill, cleanup to three releases | A6 open (ANDROID-PLAN §6); S3 ends 2026-10-13 | android, vettid.org | No (staging manifest changes only) | — | Key deletions (S1 due 10-12, S2 due 10-13, then the batch) | Partly: the S3 retirement drill ran 2026-10-13 (S3 to S6 removed, manifest serial 13, vettid.org #260; key deletions scheduled, due 2026-10-20; deletion not recorded); the S1 and S2 keys are deleted; A6 is partly done (ANDROID-PLAN §6); staging lists 14 releases (7–15, 17–21; 1–6 removed): not yet down to three |
| 0a | F-Droid `foss` build | Branch `build/fdroid-foss` (2026-10-11); merged 2026-10-11 as vettid-android #111 (full and foss distributions) | android | No: it is signed with VettID's own key, already pinned (D3) | Reproducible build | F-Droid submission | Done: vettid-android #111 (merged 2026-10-11) |
| 0b | Push N4 (Google push) | Gateway deployed for staging without platforms; app side merged (vettid-android #109); vault side in S9 | vettid.org, push | No | A Firebase project | Firebase project (owner: hold) | App side merged (#109, #129); vault side merged (vettid-vault push N3, 2026-10-10); the staging gateway is deployed; no platform enabled (Firebase on hold) |
| 1 | **Production release 1** | Not blocked on Google Play (0.1.1, D3): it pins only VettID's own key (W10-READINESS 0.1.7 P9). 0.1.2: the feature allowlist, the per-channel package and the signer binding are in vettid-vault `main` and proven on S10; what still blocks it is in W10-READINESS 0.1.8 §2 | vault, vettid.org, android | It is one | Phase 0; §2.4; the production backend deploy | D2, D4; the tester list; the signer binding of VAULT-MESSAGING 0.27.0 §11.7.1 (W10-READINESS P9a) | Not released; what blocks it is the checklist in W10-READINESS |
| 2 | Calls (1:1) | Vault code exists (`features/calls`, `vms/callwire`; VAULT-MESSAGING §10.10). Calling service **specified in CALLING-SERVICE 0.1.1**; its code was built later (vettid-calls `main`, committed 2026-10-17; see the status column). App code was not started on 2026-10-11 | android, vault, a new calling-service repo, vettid.org (stacks), relay if `call.*` needs relay work (not established) | Very likely: the vault issues ICE credentials and its egress list would gain the calling service; not established in detail | A wake for the callee: the on-phone service works today, FCM needs 0b | Own TURN fleet or a managed one (CALLING-SERVICE §8); its §10 open questions | Partly: the calling service is built (vettid-calls `main`, committed 2026-10-17, follow-ups #1 to #3 to 2026-10-20); the app's C1 is partly built (vettid-android #124 to #126, #175, #178; #128 open); no vault work; see CALLS-PLAN §7 |
| 3 | Devices, agents, LEASH | Vault code exists (`features/leash`, 0.12.0 format, in S4 and later). Connector rebuilt since 2026-10-11 as `vettid-agent` (see the status column; on 2026-10-11 it was not rebuilt, LEASH-IMPLEMENTATION "Connector", and `vettid-agent` and `vettid-desktop` had last changed 2026-05 and did not work with this vault) | android, agent, desktop, vault (fixes) | Only for fixes found | — | Whether desktop or agent comes first | Partly: `vettid-agent` A0 to A3 and A5 are built (vettid-agent #7 to #40, 2026-10-17 to 2026-10-20); the app's devices and agents section (AA1 to AA5) is specified, not built; `vettid-desktop` #8 and #10 are open |
| 4 | Wallet | Vault code exists (`features/wallet`; §10.18). No app code | android, vault | For fixes | — | Networks to support (decided 2026-10-17, ANDROID-PLAN D8: signet and testnet4 on staging, mainnet for production later) | Not started in the app; networks decided |
| 5 | Location | Vault code exists (`features/location`; §10.16). No app code | android, vault | For fixes | Background location policy on Play and F-Droid | — | Not started |
| 6 | Presence | Vault code exists (`features/presence`; §10.17). No app code | android, vault | For fixes | — | — | Not started |
| S | Service vault | **No specification in this repository**; `vettid-service-vault` last changed 2026-04 (the first implementation). Named as the place services come from (PUSH-GATEWAY §12) | spec first | Not known | Proposal: specify during phase 2, build after phase 3 (it reuses grants and delegations) | Scope ("soon", owner 2026-10-10): confirm the slot | No change found |
| I | iOS | `vettid-ios` last changed 2026-05 (first implementation) when this row was written; the rewrite started 2026-10-17 (IOS-PLAN). App Attest in the enclave was not built (VAULT-PLAN §7 risk 6) | ios, vault, push | Yes: the iOS app ID and Apple roots are pinned per release (C6) | APNs; proposal: after phase 3 | Apple developer account; when | Under way: `vettid-ios` I0 to I3.2d and I3.3a are merged (IOS-PLAN); the enclave pins Apple's App Attest root and the iOS app id per release (vettid-vault `enclave/config.go`; #104, #118, #119) and VA4, the signer continuity across an iOS app, in vettid-vault #142 |

Phases 2–6 run on staging under §2; each reaches production through
§2.4 on the next monthly train after it passes.

## 6. Owner decisions

**Answered (owner, 2026-10-11): all as recommended**, with two additions: the shared relay stays (D11: "let's use production for the relay"), and for D3 the owner first chose VettID's own key for Play installs as well (ANDROID-PLAN 0.1.34, option (b)) and replaced that the same day with option (a) (ANDROID-PLAN 0.1.36 §7 "Signing and the two distributions"): giving Google the key would let a build signed by Google replace F-Droid and direct installs too. Google Play installs are signed by Google; F-Droid and direct builds by VettID; two signers.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Adopt §2: staging is the development channel; at most three live staging releases; at most two releases a week | Yes |
| D2 | Release 1's retirement window. Default 12 months (VAULT-RELEASES §3.5); the notice sequence needs 90 days | **90 days for release 1 only**, told to the testers when they join; later releases 12 months. Needs a line in VAULT-RELEASES §3.5 (O5 sets 60 days as the floor for shortened windows) |
| D3 | Which Android signers release 1 pins (one to four are allowed) | **Decided (owner, 2026-10-11; 0.1.1):** only VettID's own key, whose digest `prod.json` already lists; it signs the F-Droid APK (reproducible builds) and direct builds and is never given to Google, so release 1 needs nothing from Play. Google generates and holds the Play app-signing key; its certificate is pinned by a later release, before the Play listing goes live, and each vault is bound to its app's signer (ANDROID-PLAN 0.1.36 §7, option (a); VAULT-MESSAGING 0.27.0 §11.7.1). 0.1.0 recorded option (b), one shared signer, withdrawn the same day |
| D4 | Does release 1's image answer calls, agent, wallet, location and presence operations that no production app uses? Today every image does | **Add a per-channel feature allowlist to the release configuration** (measured into the image; production lists only what passed §2.4). A vault spec and code change, before release 1. Not checked: which of these operations a peer can reach on a vault whose owner never used them |
| D5 | Staging application id | **Change to `com.vettid.app.staging`** with the next staging release that can carry it (the package becomes a per-channel value in the vault), before release 1, so the owner's phone can hold both. Until then: production on the owner's phone, staging on the test phones only |
| D6 | Production backend rhythm | Weekly, Monday, by the assistant after the owner approves the diff; the first one as soon as the owner lifts "the prod deploy waits" and creates the enroll-code key |
| D7 | Who releases 1 is for | The owner plus named testers, at most 10 |
| D8 | Key deletions | Owner, one batch a week, from a prepared list |
| D9 | Separate dev channel | Not yet; revisit on the triggers of §2.6 |
| D10 | Where the service vault and iOS go | Service vault: specify during calls, build after agents. iOS: after agents |
| D11 | A staging relay | Only when a relay change needs testing; not kept running |

## 7. What changes now

| # | Action | Who |
|---|---|---|
| 1 | Answer §6 | owner |
| 2 | Lock the vault still unlocked on S3 after the drill, or accept its host until 2026-10-13 15:30 UTC | owner |
| 3 | Confirm the S1 (2026-10-12) and S2 (2026-10-13) key deletions; record in W9-REPORT §8 | owner runs, assistant records |
| 4 | After 2026-10-13: one PR setting S3–S6 `removed` and deleting their stacks, leaving S7–S9; the key list for the owner's batch | assistant, then owner |
| 5 | Remove the legacy session auth switch (§4) | assistant |
| 6 | Create `/vettid-org/prod/member/enroll-code-key`; first weekly production deploy | owner, then assistant |
| 7 | If D4 or D5 is accepted: spec changes in VAULT-MESSAGING / VAULT-RELEASES and vettid-vault, on a staging release. **Done (0.1.2):** VAULT-MESSAGING 0.26.0 and 0.27.0, VAULT-RELEASES 0.1.11 and 0.1.12; vettid-vault #62–#64; staging release S10, published 2026-10-11 (§8.5); the app's `.staging` build (vettid-android #116) | assistant |
| 8 | Amend the stale text below in one docs PR once §6 is answered | assistant |
| 9 | Play account and the Play certificate's digest (after release 1, D3); Firebase project; Apple account when iOS is scheduled | owner |
| 10 | (0.1.2) Move the remaining staging vaults to the `com.vettid.app.staging` app while S10 is the newest release: the staging release after S10 refuses a vault with no recorded signer (VAULT-MESSAGING §11.7.1). Done on 2026-10-11 for test member 4's vault and the owner's (§8.5); the others by transfer, recovery or a new enrollment | owner, on the phones |

Text this plan makes stale (not edited here):

- VAULT-RELEASES.md:139 "staging about $10 parked"; :1128 "Staging,
  parked: about $10 (its few keys deleted after use, a parked group, …)".
- VAULT-RELEASES.md:169 staging release keys "deleted after use" (true,
  but they now live for weeks, not days).
- VAULT-RELEASES.md:201–203 "spends at least a week in staging" and :210
  "`main` builds a staging image nightly" (staging releases are cut by
  hand, up to two a week; no nightly image was found, §8.4).
- VAULT-RELEASES.md:1274–1277 "Relay: the production relay at first …
  Everything parked between releases"; :1293–1295 "so parking needs
  nothing beyond the scaler's zero groups"; :1456 O2 "parked between
  releases".
- AWS-ACCOUNTS.md:40 "parked between releases".
- RUNBOOK.md:1285–1286 staging is "a copy of what the vault's end-to-end
  tests need"; :1473–1481 "Parking"; :1179–1184 "The staging
  switch-over" (once action 5 is done).
- W10-READINESS.md §3 "Before starting": "S4 (the 0.15.0 staging
  release) is built from the same source as the release commit" (the
  twin is now whichever staging release passed §2.4); §2 B1 (the S3
  drill and key confirmations).
- W9-REPORT.md §11 first bullet (the S3 drill and key confirmations move
  to §7 here).
- ANDROID-PLAN.md:1117–1118 and :1505–1506 "a later `foss` build … only
  if VettID is published on F-Droid" (it is being written).

## 8. Facts

Measured 2026-10-11. Profiles: `vault-staging` (347272280361), default
(management, 449757308783). Repositories at `origin/main` or
`origin/master`.

### 8.1 Shared pieces

| Piece | Shared? | Source |
|---|---|---|
| Relay | **Shared.** `relay_url` is `https://relay.vettid.org` in both `enclave/releasecfg/staging.json` and `prod.json` (vettid-vault); the staging app says "the production relay (the staging images pin it)" (`app/src/staging/kotlin/com/vettid/app/env/CurrentEnvironment.kt`) | `git show origin/main:enclave/releasecfg/{staging,prod}.json` |
| Push gateway | Separate service, secrets and task role per channel, **in the management account**, in the relay's cluster behind the relay's load balancer; one KMS key for both. Running: `vettid-org-staging-push` 2/2 tasks; no production service (`pushStages: staging`) | RUNBOOK "Push gateway"; PUSH-GATEWAY §10.4; `aws ecs describe-services`; `cdk.json` |
| DNS | `staging.vettid.org` is delegated from the production zone; `push.staging.vettid.org` is a zone in the management account | RUNBOOK "Staging", "Push gateway" |
| Member API, portal, pool, tables | Separate (staging account) | RUNBOOK "Staging" |
| SES | Separate; staging stays in the sandbox | RUNBOOK "Staging" |
| Test mail | Staging only | RUNBOOK "Test mail" |
| Manifest site, manifest keys, release keys | Separate | VAULT-RELEASES §3.1 |
| Admin site and API | Production only | RUNBOOK "Staging" |
| Repository, `cdk.json`, CI, tag-signing key, image registry | Shared | `cdk.json` |
| Organization trail, GuardDuty, alert topic | Shared (staging alerts arrive with production's) | RUNBOOK "Security alerts" |
| Android package name | Same (`com.vettid.app`); signing keys differ. **0.1.2: separate since S10**, `com.vettid.app.staging` in staging (the channel file's `android_package`; the app's `staging` build type) | `app/build.gradle.kts` lines 43, 90–99; `enclave/config.go:57`; 0.1.2: `enclave/releasecfg/staging.json` |

What calls would add: a TURN service (coturn and a sidecar) and five
`call.*` deposit types on the relay, per CALLING-SERVICE §4 and §9;
specified, not built. What agents would add: nothing shared beyond relay
mailboxes; the HTTP action that needs enclave egress is not offered
(LEASH-IMPLEMENTATION).

### 8.2 Staging cost and live state

`aws ce get-cost-and-usage --profile vault-staging`, 2026-10-01 to
2026-10-11, unblended, still marked estimated:

| | USD |
|---|---|
| Total, 2026-10-05 to 2026-10-10 (nothing before the 5th) | 31.29 |
| By day | 2.36, 4.26, 3.89, 5.70, 8.31, 6.69 |
| EC2 hosts (`m7g.large`, 307 hours at $0.0816) | 25.06 |
| Public IPv4 | 1.54 |
| WAF (account site) | 1.55 |
| KMS (keys and requests) | 0.99 |
| EBS volumes and snapshots | 0.78 |
| Route 53, DynamoDB, Secrets Manager, S3, CloudWatch, SES | 1.37 |

- 307 host hours in six days is 2.1 hosts running on average. At the
  last three days' rate staging costs about $200 a month.
- A running host: $0.0816 an hour, about $60 a month, plus about $5 for
  its address and disk. A release at zero instances costs its key ($1 a
  month) and its AMI snapshot (under $1).
- Release groups (`aws autoscaling describe-auto-scaling-groups`):
  `vettid-org-staging-vault-r3` … `r9`, each minimum 0, maximum 2. Running
  now: r3 (one host, up since 2026-10-05 23:07 UTC) and r9 (one host).
  r4–r8 are at zero.
- Why r3 runs: the vaults table has one vault sealed to S3 in state
  `unlocked` (the retirement-drill vault) and three on S9. The scaler
  stops a group 30 minutes after its hosts report no leased vault
  (VAULT-RELEASES §8.6), so an unlocked vault holds its host.
- `vault/releases/staging.json` (serial 11): S1, S2 `removed`; S3
  `retired`, ends 2026-10-13T15:30Z; S4–S8 `deprecated`; S9 `active`.
- Nine release keys exist (S1–S9; S1 and S2 scheduled for deletion per
  W9-REPORT §8). Their state could not be read: `kms:DescribeKey` is
  denied to the admin role by design.
- Fixed parts with every group at zero: about $10 a month for the main
  stacks and $6–8 for the host stack (RUNBOOK "Parking", "Expected
  monthly cost"); not re-measured.
- Staging push gateway: about $25 a month (RUNBOOK estimate). It started
  on 2026-10-11, so there is no measured figure. The management account's
  whole bill for 2026-10-01 to 2026-10-10 was $28.04.
- Members table: 10 rows, none with a canary flag. Vaults table: 8 rows.

### 8.3 Production

- `VettidOrgMemberApiStack` last updated 2026-10-06 09:57 UTC,
  `VettidOrgAccountSiteStack`, `VettidOrgAdminApiStack` and
  `VettidOrgAdminSiteStack` 2026-10-06 00:18–00:21
  (`aws cloudformation list-stacks`). The staging member API was last
  deployed 2026-10-11.
- The scheduled drift check failed on 2026-10-08, -09 and -10
  (`gh run list --workflow drift.yml`).
- `/vettid-org/prod/member/enroll-code-key` does not exist; the staging
  parameter does (`aws ssm describe-parameters`, names only).
- `vault/releases/prod.json` has no release; `prod.json` in vettid-vault
  has `release: 0` and the `TODO-O8` placeholder. (0.1.2: the
  placeholder is gone. `prod.json` now lists the one `vettid` signer,
  `android_package` `com.vettid.app` and `features: []`; `release: 0`
  is the only value the release gate still reports missing.)

### 8.4 Not established

- Whether anything builds a staging image nightly (VAULT-RELEASES §3.3
  says so; the staging releases were all cut by tag).
- Whether calls need a relay code change or only new opaque deposit
  types, and exactly what a staging vault would need to reach a TURN
  service.
- The F-Droid build's signer follows from D3 (VettID's own key, called the upload key before 0.1.1); the build's reproducibility is being established on `build/fdroid-foss`.
- Which vault operations of the unused features a peer can reach (D4).
- Whether an automated test run deletes its test member today (§2.5.4
  states the rule, not the current behaviour).
- The cost estimate of risk 5 after cleanup; it is arithmetic from §8.2.

### 8.5 After S10 (0.1.2)

*Status note (2026-10-23): this section is the record of 2026-10-11 and
its counts are not current. Staging is at release S21, S22 is being cut
(vettid-vault #143) and S23 is the release that carries release L. The
"eight are now" count below was true on 2026-10-11 only.*

State of 2026-10-11, about 23:00 UTC. From the repositories unless
marked; nothing here was measured again in AWS.

- **S10**: tag `release/staging/10` at vettid-vault `8678752f`; PCR0
  `a9e3defc8bfa4c3c6f89a87afac67bc245f1ef8ac331de88505d8d4928a4bc0d9e793fb928050ba02c9f3b915ffbfb0e`;
  the independent rebuild matched (vettid.org #228); key check passed
  (#229). As reported from the release session: self-test PASS with
  the capacity run (58 vaults held, about 907 projected, VAULT-RELEASES
  §8.8), canary on a test phone at 22:29 UTC.
- **Manifest serial 12** (#230, merged about 23:00 UTC): S10 `active`,
  S9 `deprecated` with S4–S8, S3 `retired` (ends 2026-10-13 15:30
  UTC), S1 and S2 `removed`. S10's log entry is `security: urgent`,
  the first use of that level on either channel (the key attestation
  chain fix; it affects S3–S9), which is what the notice job's urgent
  mail is for.
- **In S10**: the feature allowlist (staging lists all seven, so no
  behaviour changes there), `android_package`
  `com.vettid.app.staging`, per-vault signer binding, the key
  attestation chain rules (VAULT-MESSAGING 0.26.0, 0.27.0, 0.27.1).
- **Vaults** (as reported by the owner, 2026-10-11): test member 4's
  vault and the owner's are on S10 and attached to the
  `com.vettid.app.staging` app; the owner's moved on the same phone by
  a pasted transfer code. Vaults still attached to the old app unlock
  on S10 unbound and must move before the next staging release (§7
  action 10).
- **Rule §2.1.2** (at most three staging releases not `removed`): eight
  are now (S3–S10). The cleanup of §7 action 4 follows the S3 drill.
- **Push**: the staging gateway's Android app id is configured as
  `com.vettid.app.staging` (vettid.org #223); no platform is enabled
  (the Firebase project is on hold).
