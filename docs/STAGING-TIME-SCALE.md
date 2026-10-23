---
title: STAGING-TIME-SCALE
status: draft, approved by the owner 2026-10-18
version: 0.1.2
date: 2026-10-23
owner: Al Liebl (Mesmer)
component: vault (enclave, release constants), member API, apps (Android, iOS), dev stack
related:
  - VAULT-MESSAGING.md (0.43.0) §3.6, §10.2, §11.10.8, §11.10.9, §11.11, §11.14, §11.14.14
  - VAULT-RELEASES.md (0.1.32) §5.2
  - MEMBER-API.md (2.8.0) "Vault recovery", "Vault deletion: start over", rate limits
  - ANDROID-PLAN.md (0.1.44), IOS-PLAN.md (0.1.2)
  - STAGING-DEVELOPMENT-PLAN.md (0.1.3)
  - VAULT-LOCK.md (0.1.2) (the idle lock), AGENT-PLAN.md (0.1.6) (the dev stack's held-vault test)
  - vettid-vault `main` f0976ee (read only: `enclave/releasecfg/*.json`, `releasecfg.go` and the timer constants)
changelog:
  - 0.1.2: editorial; VAULT-MESSAGING 0.55.10 (owner decision
    2026-10-23). S10: on staging the old phone's check with the vault
    starts at 7 hours; it erases only on the vault's definite answer or
    the notice, so a vault that does not answer keeps the keys past 7 h
  - 0.1.1: owner decision 2026-10-19 ("recovery counter should also be
    scaled in staging"): the app's side of S8 is scaled too, on Android
    and iOS; added to the app timer lists (§5.2, §5.6, §5.7). Built
    in follow-ups to vettid-android #145 and the iOS time-scale PR
  - 0.1.0: first draft, after the owner's request of 2026-10-18 ("for
    testing here on out, i'd like to make the testing windows shorter by
    using hours instead of days (e.g. need to wait 1 day = 1 hour in
    staging)"). Approved by the owner 2026-10-18, with every choice in
    §6 as recommended. Nothing here is built yet
classification: public (no secrets; safe for github.com/vettid)
---

# Staging time scale: 1 day = 1 hour (design)

## 1. What this is

Tests on staging wait in real time: a day for a recovery code, three
days for the quiet period, a week for the idle lock or for the old
phone to delete its keys. This note proposes one number, the **time
scale**, that divides those waits on staging by 24, so that a day
becomes an hour, and that is **1 in production, provably** (§4).

- **One release constant**, `time_scale`, in each channel file of
  vettid-vault (`enclave/releasecfg/<channel>.json`, VAULT-MESSAGING
  §11.10.8): production 1, staging 24, the dev stack anything from 1 up.
  It is measured into PCR0 with the rest of the file.
- **What scales**: the waits of §2 that are 1 hour or longer and that a
  member or a tester waits through (a delay before something is allowed,
  a deadline, a deletion after a delay). Each is divided by `time_scale`
  when its timer starts: 24 h becomes 1 h, 72 h 3 h, 7 days 7 h, 1 h 2.5
  minutes.
- **What does not**: anything AWS imposes, cryptographic freshness, the
  shared production relay's limits, timers another vault relies on, rate
  limits, the short backoff ladders, durations a member chooses and data
  retention (§3).
- **The apps and the member API follow the vault**: the vault tells its
  apps the scale in its attested descriptor (§5.2), and the member API's
  staging stack has the same number as a parameter (§5.3).
- **From the release that ships it, for timers started after it**
  (§5.5): the running tests on staging release 15 keep their real
  times.

## 2. Inventory: the waits of 1 hour or more

Read from the specifications named in the front matter and from
vettid-vault `main` f0976ee (constants, read only). "Staging" is the
value at `time_scale` 24.

### 2.1 Scaled

| # | Wait | Where it runs | Spec | Now | Staging |
|---|---|---|---|---|---|
| S1 | Owner check interval (`owner_check.interval_seconds`, a setting) | vault | VAULT-MESSAGING §3.6.2 | default and max 24 h, min 1 h | default 1 h; 2.5 to 60 min (§6 T5) |
| S2 | Owner check early warning | app (Android, iOS) | §3.6.5; ANDROID-PLAN §6 "Owner check" item 5; IOS-PLAN §6.6 | from 1 h before the deadline | 2.5 min before |
| S3 | Idle lock after an overdue check (`idle_lock.after_seconds`, a setting) | vault | §3.6.8; VAULT-LOCK L11 | default 7 days, 1 h to 30 days | default 7 h; 2.5 min to 30 h |
| S4 | Idle lock after an unlock past its time | vault | §3.6.8 "After an unlock" | 1 h | 2.5 min |
| S5 | Recovery code delay (`not_before` at least request + 24 h) | vault (`RecoveryDelay`); member API estimate | §11.11.2, §11.14.5; MEMBER-API "Vault recovery" | 24 h | 1 h |
| S6 | Recovery code validity (`expires` = `not_before` + 24 h; after a wait, its end + 24 h) | vault (`RecoveryValidity`); member API estimate | §11.11.2, §11.14.5, §11.14.6 | 24 h | 1 h |
| S7 | Recovery quiet period (`recovery_quiet_seconds`) | vault, release constant | §11.14.5, §11.14.14 | 72 h, both channels | 3 h (§6 T6) |
| S8 | Counter unavailable for 24 h: shown as urgent | vault, app | §11.14.5, §11.14.11 | 24 h | 1 h |
| S9 | Replaced phone-secret records deleted | app (Android, iOS) | §11.14.1 rule 6; ANDROID-PLAN §4; IOS-PLAN §6.3 | 7 days after confirmation | 7 h |
| S10 | Old phone keeps its keys after a transfer | app | §11.14.10 "The old phone's keys after a transfer" | 7 days after the approval; from then on the old phone checks with its vault and erases only on a definite answer (0.1.2) | the check starts 7 h after the approval |
| S11 | Pending unlink deleted | vault (`PendingUnlinkTTL`) | same | 7 days | 7 h |
| S12 | Vault unreachable for 7 days: the recover-first screen | Android (vettid-android #142; not yet in the spec text) | (ANDROID-PLAN, with #142) | 7 days | 7 h |
| S13 | Enrollment's provisional window (no `vault.enroll.confirm`) | vault (`EnrollWindow`) | §11.3 | 24 h | 1 h |
| S14 | Start-over deletion (`deletes_at`) | member API | §11.11.9; MEMBER-API "Vault deletion: start over" | 24 h | 1 h |
| S15 | Account site PIN locked after 15 failures in a day | member API | MEMBER-API rate limits | 24 h lock (the day of counting unchanged) | 1 h lock |
| S16 | Vault update banner dismissed | app | ANDROID-PLAN 0.1.19 | at most 24 h | at most 1 h |

Already short on staging and left as is: the **recovery waits** `W(k)`
(§11.14.6), whose unit `recovery_wait_unit_seconds` is 86,400 in
production and **600 on staging** (waits of 10, 20, 40 … minutes); the
scale does not divide it again (§6 T6).

### 2.2 Not scaled

| # | Wait | Where | Now | Why it stays |
|---|---|---|---|---|
| N1 | Recovery counter locks: token, success and close records; present records; a token's wait + 1 day | S3 Object Lock, set by the enclave | staging 1 day (production 100 years); 96 h; `W(n)` + 24 h | AWS retention. Longer than the scaled waits, so still safe; the 96 h bound on the quiet period still holds |
| N2 | Release key deletion window | AWS KMS | staging 7 days, production 30 | AWS minimum is 7 days |
| N3 | Release notices (90, 30, 7, 1 days before `ends_at`); canary soak 24 h; hotfix soak 2 h | member API job; operator | as listed | Dates the operator sets; the soaks are production steps |
| N4 | Data bucket versions (1 day, then the 5 newest, at most 7 days) | S3 lifecycle | as listed | AWS lifecycle |
| N5 | ETK 24 h (rotated at 23 h), attestation age 26 h, device attestation lists 24 h / 7 days, push gateway manifest freshness 7 days | enclave, app, gateway | as listed | Cryptographic freshness |
| N6 | Relay: message TTL 14 days, blob TTL 7 days, open tokens up to 7 days, tokens up to 400 days | shared production relay | as listed | The relay is production's and counts in real time |
| N7 | Tokens and keys: standing tokens 30 days (re-mint under 10, refresh under 3), reconnect tokens 365 days (re-mint under 60), retired KEM keys 400 days, UTK 30 days, epochs 24 h / 7 days, dedupe 16 days | vault, devices | as listed | Lifetimes bound to the relay or to peers |
| N8 | Between vaults: connection requests 7, 8 and 16 days; invitation TTL choices 1 h, 24 h, 7 days; decline cooldown 7 days and pause after 30 days; attachment windows 7 and 30 days, missing turn 24 h; grant requests 7 days; critical-item and action requests 24 h / 25 h; introductions 7 days; location requests 24 h | vault | as listed | The other vault relies on them and may run a release without the scale (§6 T4) |
| N9 | Rate limits counted over a day or more: `push_registrations` 20 a day and the 24 h stop after it, peer attachments a day, a name change once in 30 days, enroll 3 a day, setup codes a day, `per_day` rules, `device.signer_refused` once a day | vault, member API, app | as listed | Rate limits bound load; the counterpart counts in real time |
| N10 | Backoff ladders: unlock (§11.8) and password (§3.5.3) 30 s … 60 min | vault | as listed | Scaling only the 60 min step would break the ladder (§6 T3) |
| N11 | Durations the member chooses: access sessions 60 s to 24 h, grant and rule expiry, location shares, the hold's end date (up to 30 days ahead) | vault | as chosen | The member can already choose a short one (§6 T4) |
| N12 | Retention: audit 730 days, ended grants and introductions 30 days, location history, response cache 24 h, the audit log's addresses 90 days | vault, member API | as listed | Retention is not a wait |
| N13 | Member API daily jobs: a cancelled account deleted after 7 days, an orphaned vault after 7 days, unverified requests after 14, declined after 30 | member API (daily at 07:00 UTC) | as listed | Deletes account data and runs once a day (§6 T8) |
| N14 | Calls: busy for at most 12 h; ICE credentials 6 h | vault, calling service | as listed | The calling service's credentials are real time |
| N15 | Push: blobs 90 days, renewal after 30 days, retired gateway keys 400 days | vault, gateway | as listed | The gateway's lifetimes |

Shorter than an hour, and so never scaled: per-minute rate limits, the
10-minute request windows and 5-minute approvals of access sessions, the
60-second retries, setup codes (5 minutes), the credential's unlock
window, the 120 s parent rule.

## 3. The rule

1. **A wait of 1 hour or more of §2.1** is divided by `time_scale`,
   uniformly, whatever its length: 24 h becomes 1 h, 6 h 15 min, 1 h 2.5
   min. The result is rounded up to a whole second.
2. **It is divided when the timer starts**, and the absolute time is
   kept, as the vault already keeps `owner_check.deadline`,
   `not_before`, `expires` and `idle_lock_at`. A timer that started
   under one scale ends at the time it was given.
3. **Settings keep their real units.** `owner_check.interval_seconds`
   and `idle_lock.after_seconds` are stored and reported as the member
   set them (86,400, 604,800); the vault divides when it computes the
   deadline. The bounds do not change. Settings screens show both: "24
   hours (staging: 1 hour)".
4. **Never scaled** (§2.2): AWS windows, cryptographic freshness, the
   relay's and the gateway's lifetimes, timers between vaults, rate
   limits, backoff ladders, durations the member chooses, retention, and
   the member API's daily deletion jobs. And nothing in production,
   where the scale is 1.

## 4. Why production cannot be affected

1. **The channel file.** `prod.json` has `"time_scale": 1`, and
   `releasecfg check prod` refuses any other value, a missing one and a
   placeholder (a release build fails closed). `staging.json` may say 1
   or 24.
2. **The code ignores it outside staging.** The enclave's accessor
   returns the file's value only when the measured channel is staging
   (or in a development build), and 1 otherwise, as `CounterLock` and
   `AcceptsUnbound` already do in `releasecfg.go`. A wrong `prod.json`
   could not scale a production vault even if the check were bypassed.
3. **Attested.** The channel file is embedded and measured: the value is
   in the tagged tree, in `measurements.json` and in PCR0, and the
   image's descriptor carries it (§5.2), bound by the attestation. Each
   release log entry from the release that ships it says the scale in
   words ("Time scale: 1 day = 1 hour (staging)"; production: "real
   time").
4. **The apps refuse it.** A production build (one that pins the
   production manifest) refuses a descriptor whose `time_scale` is not
   1 as malformed: it sends nothing to that instance and says "This
   vault's software is not for this app. Contact VettID."
5. **The member API.** The production stack is built with 1 in code,
   and the CDK app refuses to synthesise a production stack with any
   other value; the function reads its `TIME_SCALE` only when its stage
   is `staging`.
6. **Recovery keeps its production rules.** The build rule of §11.14.14
   is unchanged for production: a wait unit of at least 86,400 s and a
   quiet period of at least 259,200 s.
7. **Tests** (§5.6) assert 1 on the production image.

## 5. The design

### 5.1 Vault

- `time_scale` in each channel file: a positive integer; production
  exactly 1; staging 1 or 24; the development build any value from 1 to
  86,400 (the dev stack's flag, below).
- One function in the enclave, `Scale(d)`, used by every timer of §2.1
  that the vault runs (S1, S3 to S8, S11, S13) and by nothing else.
- The vault's settings, `vault.status` and the feed keep real units for
  settings and absolute times for deadlines; `vault.status` adds
  `time_scale` (§5.2).
- **Dev stack**: `devstack -time-scale N`. At 3,600 the owner check's
  24 h is 24 s, so the agent connector's held-vault test (AGENT-PLAN,
  `make devstack-hold-test`, about 65 minutes today) runs in under a
  minute without a settable clock.

### 5.2 Apps

- **Where the app learns it**: the descriptor of the instance its vault
  is routed to (VAULT-MESSAGING §11.10.9) carries `time_scale`, read
  every time with the capabilities, before an unlock or a recovery; a
  transfer bundle carries it too. A descriptor without it is a release
  before the scale (1). `vault.status` also returns `time_scale` to the
  app and to desktops.
- The app **stores it per vault** with the record of §11.10.6, and each
  app-side timer (S2, S8, S9, S10, S12, S16) keeps the absolute time it was
  given when it started.
- **Production builds** refuse any value other than 1 (§4 item 4). A
  staging build accepts 1 and 24.
- **Texts show the real, scaled durations** ("in 3 hours", "for at most
  7 hours"), computed from seconds; no text hard-codes "24 hours" or "7
  days" for a scaled wait. Where a staging build shows a scaled wait
  (the owner check, the idle lock, recovery, the old phone's screen,
  the settings), it adds a small note: "Staging: 1 day = 1 hour".

### 5.3 Member API

- A staging stack parameter `timeScale` (1 or 24), the function's
  `TIME_SCALE`; production 1 in code (§4 item 5).
- It scales S14 (start-over `deletes_at`), S15 (the PIN lock) and its
  recovery estimates (S5, S6: request + 1 h and + 2 h at 24, still
  marked `earliest` until the enclave's own times arrive).
- Emails and account site texts take the durations from the same number,
  and on staging say "Staging: 1 day = 1 hour".
- It does not scale its daily jobs (N13).

### 5.4 Recovery

- **Quiet period** (S7): the staging channel file says
  `"recovery_quiet_seconds": 10800` (3 h) itself, and `releasecfg check`
  requires, on staging, that it equals 259,200 / `time_scale`. Today's
  rule that staging keeps the production quiet period
  (`MinQuietSeconds` in both channels) becomes a production-only rule.
- **Wait unit**: unchanged at 600 on staging (§6 T6).
- **Code delay and validity** (S5, S6): divided by the scale in the
  enclave.
- **The counter's locks** (N1) are unchanged.

### 5.5 Transition

- The scale applies **only from the vault release that ships it**, and
  **only to timers started after a vault has moved into that release**.
  Deadlines already set keep their real-time values.
- So the tests running now on staging release 15 are not shortened: the
  two recoveries ending about 2026-10-20 keep their `not_before`,
  `expires` and waits; each test vault's current owner-check deadline
  stays; the old phone's 7-day check ending about 2026-10-24 keeps its
  date (the old app learns the scale only from a vault, and it no longer
  talks to one). The first owner check passed after the move sets a
  deadline 1 hour on; a recovery requested after the move gets a code
  after 1 hour (3 hours after the last owner check).
- A vault moved back to a release without the scale (staging only, not
  expected) uses real time for timers it starts.

### 5.6 Tests

- **Vault**: the production image and `releasecfg check prod` refuse
  `time_scale` ≠ 1 and a missing value; the accessor returns 1 for any
  channel but staging whatever the file says; on staging,
  `recovery_quiet_seconds` ≠ 259,200 / `time_scale` is refused; per
  timer at scale 24 (S1, S3 to S8, S11, S13): the absolute time is the
  start plus the scaled duration; a timer started under scale 1 keeps
  its time after a move into a scaled release; settings report real
  units.
- **Member API**: synth of the production stack with `timeScale` 24
  fails; S14 and S15 at 24; estimates at 24.
- **Apps**: a production build refuses a descriptor with 24; a staging
  build shows scaled texts and the note; S2, S8, S9, S10, S12, S16 at 24 with
  a fake clock; a timer started before the scale was known keeps its
  time.

### 5.7 Implementation rows, in order

| Row | Repository | What | Ships in |
|---|---|---|---|
| T-V | vettid-vault | `time_scale` in both channel files and `releasecfg check`; `Scale`; S1, S3 to S8, S11, S13; quiet period per §5.4; descriptor and `vault.status` member; dev stack flag; tests | the first staging release after 16 (S17, with AV6), if merged before it is cut; otherwise S18 |
| T-M | vettid.org | stack parameter, CDK refusal, S14, S15, estimates, texts | deployed to staging when that release is published |
| T-A | vettid-android | read and store the scale, refuse ≠ 1 in production builds, S2, S8, S9, S10, S12, S16, texts and the note | the next staging app after T-V |
| T-I | vettid-ios | the same, for the iOS rows (S2, S8, S9, S10) | with the first iOS staging build that unlocks |

An app or a member API without its row is safe: it uses real time,
which is only longer than the vault's.

## 6. Choices (decided by the owner 2026-10-18: every recommendation)

| # | Choice | Options | Recommendation |
|---|---|---|---|
| T1 | Where the scale lives | (a) a member of the channel file, checked, and ignored by the code outside staging; (b) derived from the channel alone, like the counter's lock period, with no member | **(a)**: visible in the file and the release log, lets staging run at 1 for a real-time test, and §4 item 2 gives (b)'s guarantee as well |
| T2 | Staging's value | 24; any value from 1 to 24 | **24** as asked; staging accepts 1 or 24 only, so tests know what to expect |
| T3 | Waits between 1 h and 24 h, and the ladders | (a) divide every wait ≥ 1 h uniformly (6 h → 15 min, 1 h → 2.5 min), leave the backoff ladders capped at 60 min; (b) floor at 1 h | **(a)** |
| T4 | Timers between vaults and durations the member chooses (N8, N11) | (a) not scaled; (b) scaled too | **(a)**: a peer may run a release without the scale, and the relay counts in real time; any one of them can be added later by name |
| T5 | Settings (S1, S3) | (a) stored in real units, divided at use; (b) stored scaled | **(a)**: nothing about a setting changes when a vault moves |
| T6 | Recovery's constants | quiet period: (a) the staging file states 10,800 and the check ties it to the scale; (b) the code divides 259,200. Wait unit: (c) stays 600; (d) becomes 3,600 (= a day / 24) | **(a) and (c)**: the measured file shows the real number; the waits are already shorter than the scale would make them |
| T7 | How the apps learn it | (a) the attested descriptor (and the transfer bundle), with `vault.status` too; (b) `vault.status` only; (c) the manifest entry | **(a)**: known before an unlock and a recovery, and bound by the attestation; (c) is the manifest key's word about an image (§11.10.9 "Alternatives not taken") |
| T8 | The member API's daily deletion jobs (N13) | (a) not scaled; (b) scaled, with hourly runs on staging | **(a)** for now: they delete account data, and the RUNBOOK and alarms count in days |
| T9 | The old phone and replaced records on staging (S9, S10) | (a) scaled to 7 h, though an operator restore (N4) can go back up to 7 days; (b) not scaled | **(a)**: staging's vaults are test vaults; the residual is staging's only |
