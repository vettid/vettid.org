---
title: STAGING-TESTING
status: draft, for the owner's approval
version: 0.1.0
date: 2026-10-18
owner: Al Liebl (Mesmer)
related:
  - STAGING-DEVELOPMENT-PLAN.md (0.1.3) §2.5 test members, §2.1 rule 6
  - STAGING-TIME-SCALE.md (0.1.0): staging's waits from release 18 on
  - RUNBOOK.md "Staging" (test data, "Test mail"), "Canary routing",
    "Canary manifest on the test phone"
  - VAULT-RELEASES.md §10.1 steps 9–10 (canary, publication)
  - MEMBER-API.md "Enrollment codes" (`/api/vault/enroll-code`)
  - ANDROID-PLAN.md, IOS-PLAN.md: each app's own acceptance tests
changelog:
  - 0.1.0: first draft (owner's request of 2026-10-18: "i'd like ios to
    be in sync with android in terms of how we test and how the testing
    is done"). One way of testing on staging for both apps: test
    members, enrollment codes, canary releases, results and secrets
classification: public (no secrets; safe for github.com/vettid)
---

# Testing on staging (Android and iOS)

How the apps are tested against staging, the same way on every
platform. Staging is `account.staging.vettid.org`, the staging vault
releases listed at `staging.vettid.org`, and the apps' Staging builds
(`com.vettid.app.staging` on Android and iOS). Real member data is never
used: every account on staging that a test touches is a test member.

## 1. Who does what

| Who | Does |
|---|---|
| The owner | Approves new test members and canary testers; holds the AWS sign-in; passes secrets between machines (never through GitHub) |
| The vettid.org assistant (Linux) | Staging releases, canary rows and flags, registration codes, the Android phones, release notes |
| The iOS assistant (Mac) | The iPhones: Staging and Debug builds, its own test members (below), the iOS acceptance tests |

## 2. Test members

- **One test member per phone**, so phones can be tested side by side
  and, later, a transfer can go from one to the other.
- **Address**: a fresh address at `test.staging.vettid.org`, for example
  `ios15-<random>@test.staging.vettid.org`. Every address there receives
  mail with no setup: staging's mail for it lands in a private bucket
  that only the owner's AWS sign-in can read (RUNBOOK "Test mail"). A
  new address is made with
  `npm run -s staging:mail -- new-address --prefix ios15`.
- **A registration code** lets a membership request become a member at
  once, with no admin approval. The vettid.org assistant makes one with
  `npm run staging:seed -- invite --uses N --days D` and gives it to the
  owner, who passes it on privately.
- **Making the member** (about five minutes, in a browser on the
  machine that reads the mail):
  1. Request membership at https://account.staging.vettid.org/request/
     with the address and the registration code.
  2. Open the verification link Amazon sends:
     `npm run -s staging:mail -- link --to ADDRESS --match 'email-verification\.'`.
  3. Sign in at https://account.staging.vettid.org with the sign-in link:
     `npm run -s staging:mail -- link --to ADDRESS --match '/auth/#t='`.
     Follow the site's steps and accept the membership terms.
  - Always pass `--match` (and `--subject` when needed) to `link`: one
    address gets several mails in a row (RUNBOOK "Test mail").
- **Reading the mail** needs the AWS profile `vault-staging-test-mail`
  (the read-only role on the test mail bucket) and a vettid.org
  checkout with its packages installed. The owner signs in
  (`aws sso login --profile vault-staging`) on the machine that runs it.
- **Record** each test member (address, phone, PIN, password) in a
  private file on that machine only. A test member's PIN and password
  are test data, but they are never posted on GitHub.
- Test members are kept while their phone is in use; the owner says
  when a row goes (STAGING-DEVELOPMENT-PLAN §2.5 item 4).

## 3. Enrolling a phone

1. Signed in on the account site as the test member, choose
   **Enroll a phone**. The site shows a QR code and an 8-character code.
2. On the phone, in the Staging app, scan the QR code or type the code
   with the member's address. **The code lives 5 minutes** and works
   once; a new one revokes the old.
3. Choose the PIN and the credential password the app asks for, and
   record them (§2).

## 4. Canary releases

Every staging vault release runs first as a canary (VAULT-RELEASES
§10.1 step 9), for flagged test members only:

1. The vettid.org assistant signs the next manifest (not published),
   adds the canary row and flags the chosen test members (the owner
   approves which). It sends the signed file `served-<serial>.json` to
   the testers privately: to an Android phone over USB, to the Mac by
   the owner.
2. On the phone, open the file with VettID (Android: share it to the
   app; iPhone: open it with VettID from Files or AirDrop, or Settings →
   Attestation → Load a test release manifest). The app shows the
   serial and the releases, and installs it only after the tester
   confirms.
3. Test on the canary: a new vault enrolls into the new release, an
   existing vault moves into it with an unlock ("Approve the update with
   this unlock"), then lock, unlock, and each app's acceptance steps.
4. Report the results (§5). On publication the app drops the test
   manifest by itself; flags are cleared by the vettid.org assistant.

Canary testers' email addresses are given to the vettid.org assistant
privately (through the owner), not on GitHub.

## 5. Results and secrets

- **Results** go to the GitHub issue of the test (for a release, the
  issue that asked for it; otherwise the platform's phase issue): what
  was tested, on which phone and build, PASS or FAIL with the text the
  app showed. Test member addresses are written shortened
  (`ios15-…@test.staging`).
- **Never on GitHub**: registration codes, enrollment codes and QR
  secrets, sign-in and verification links, PINs, passwords, recovery
  codes, and the signed canary file before it is published.
- **At the end of a session**, lock the test vaults: a vault left
  unlocked keeps its release's host running (STAGING-DEVELOPMENT-PLAN
  §2.5 item 3).

## 6. Waits

Staging's waits are real time up to release 17. From the release that
carries the time scale (release 18 at the earliest), waits of an hour or
more run 24 times faster on staging: a day is an hour, the daily owner
check comes every hour, recovery's quiet period is 3 hours
(STAGING-TIME-SCALE). The apps show the shortened times and "Staging:
1 day = 1 hour".
