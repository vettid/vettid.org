---
title: TECH-PREVIEW
status: draft (the preview opens when VAULT-PLAN V5 and the Android app's first release are ready)
version: 0.1.2
date: 2026-10-08
owner: Al Liebl (Mesmer)
related:
  - ARCHITECTURE.md
  - ACCOUNT-ADMIN-PLAN.md, MEMBER-API.md (membership, registration codes)
  - VAULT-PLAN.md (V5 infrastructure, V6 clients), ANDROID-PLAN.md
  - RELEASE-UPDATES.md, PROTEAN-CREDENTIAL.md
changelog:
  - 0.1.2: the History export (activity metadata only) is the one
    exception to "no backup or export" and is no backup
    (VAULT-MESSAGING 0.22.0, owner decisions of 2026-10-08)
  - 0.1.1: recovery needs the credential backup; with it off a lost
    phone means deleting the vault and starting over (VAULT-MESSAGING
    0.16.0, owner decisions of 2026-10-06)
  - 0.1.0: rewritten for the vettid.org system; replaces vettid-dev
    `docs/TECH-PREVIEW.md`
classification: public (no secrets; safe for github.com/vettid)
---

# VettID Technical Preview

VettID is a privacy-first identity and communications platform. Your data
lives in your own **vault**, which runs inside an AWS Nitro Enclave: a
hardware-isolated environment that the operator cannot see into. Your vault
is your root of trust. You control it with your phone, your PIN and your
**Protean Credential** (PROTEAN-CREDENTIAL.md).

The **Technical Preview** is the first round of outside testing of the
vettid.org system. Testers will enroll a vault from their phone, connect
with other testers, message them, store items and critical secrets, share
by tags, and tell us where it breaks.

## 1. Where things stand (2026-10-03)

This guide is written ahead of the preview, so it is honest about what
exists:

| Part | State today |
|---|---|
| Website (vettid.org), mailing list, playbooks | **Live** |
| Account site: request membership, registration codes, sign-in (magic link + PIN), terms, free-trial subscriptions | **Live** |
| Relay (relay.vettid.org), the mailbox service between apps and vaults | **Live**, multi-task, no members yet |
| Vault (vettid-vault): crypto, runtime, enclave shell, feature port | **In development.** Runs in development mode and in CI against a real relay; reproducible enclave image builds. Not yet running on Nitro hardware for members (VAULT-PLAN V5). |
| Android app | **Being rewritten** for the new vault (ANDROID-PLAN). Not yet available. |
| iOS app, desktop app, agent connector | **Later.** Not part of the first preview. |
| Push notifications | **Not yet.** Messages arrive while the app is open (§6). |
| Calls | **Later** (CALLING-SERVICE). |

The preview opens when the vault runs on hardware and the Android app's
first release (enrollment, unlock, credential, connections, messages,
items) is ready. Until then, the rest of this guide describes how it will
work.

## 2. Before you start

- **Use test data only.** Do not put real funds, real seed phrases, real
  private keys, real passwords or anything you cannot afford to lose or
  expose into a preview vault. The cryptography is designed conservatively,
  but the code is new, and a preview exists to find what is wrong with it.
- **Data loss is possible.** VettID offers no backup or export of vault
  data outside the service (owner decision, 2026-10-03). The app can
  export your History (when and with whom things happened, never item
  values, secrets or messages), but that is no backup and nothing can be
  restored from it (owner decisions of 2026-10-08). Treat everything
  in a preview vault as disposable, and keep your own copy of anything that
  matters somewhere else.
- **Remember your PIN and your credential password.** VettID cannot reset
  either. If you lose your phone, recovery takes 24 hours and needs both
  (PROTEAN-CREDENTIAL §3.7). Without them, the vault cannot be opened, by
  you or by us.
- **Keep the credential backup on** unless you mean it. Recovery works
  only while it is on (the default). With it off, a lost or replaced
  phone cannot be recovered at all: the vault can only be deleted from
  the account site and replaced by a new, empty one.
- **This is a small project.** Expect rough edges in the apps and slow
  answers at times. There is no SLA and no support contract; bug reports
  get a best-effort response.
- **Security findings: do not file public issues.** Email
  `security@vettid.org`. PGP is supported; the key and fingerprint are on
  https://vettid.org/security. Responsible disclosure is required for
  anything that affects the confidentiality, integrity or availability of
  members' data.

## 3. How to sign up

1. Go to **account.vettid.org** and choose **Request membership**.
2. Enter your name and email. If you were given a **registration code**,
   enter it too.
   - A valid code makes your account straight away.
   - Each code is good for **2 uses** by default, for example you and one
     family member or colleague.
   - Without a code, the request waits for an administrator to approve it.
     Preview places are limited, so expect a wait.
3. Click the verification email from **Amazon Web Services** ("Email
   Address Verification Request"). That is how you opt in to VettID email;
   without it we cannot send you anything, not even a sign-in link.
4. Sign in with the link we email you (you can add a sign-in PIN as a
   second step), accept the membership terms, and start the free trial.

Enrolling a vault needs an account in the `member` state that has accepted
the current terms (MEMBER-API).

## 4. Install and enroll

### Android

- Android 12 or newer, with a hardware-backed keystore. Enrollment and
  unlock require Android key attestation of a locked bootloader with
  verified boot (VAULT-MESSAGING §11.7).
- GrapheneOS reports its own verified-boot key, which the current check
  does not accept yet. Supporting it is a planned follow-up
  (ARCHITECTURE.md, roadmap).
- Builds will be published on the vettid-android releases page (and
  later through a store). Install, open the app, and sign in with your
  member account.
- Enrollment runs in the app: it checks the enclave's attestation against
  the signed release manifest, then you choose your **vault PIN** and your
  **credential password**. Both are set in the app, never on the web.
- **One phone per vault.** Your app holds your Protean Credential, and
  there can be only one. To move to a new phone, transfer directly from
  the old one (scan its QR, approve with your PIN and password). If the
  old phone is lost, use recovery (24 hours; only with the credential
  backup on, otherwise delete the vault and start over).

### iOS, desktop and agents

Not in the first preview. The desktop app will pair with your phone but
never unlock the vault on its own; agents will act under LEASH grants that
you approve (ARCHITECTURE.md).

## 5. What will work in the first preview

| Capability | Expected state |
|---|---|
| Enrollment, unlock, lock | Core of the preview |
| Protean Credential: create, use, change password | Core |
| Connections by invitation (QR or link), safety codes | Core |
| 1:1 messages | Core |
| Items with tags; secrets; critical items inside the credential | Core |
| Sharing by tags with connections (share rules), one-off requests | Beta |
| Vault release updates with your approval | Core (RELEASE-UPDATES.md) |
| Recovery after losing your phone (24 h, PIN and password) | Beta |
| Push notifications | Not yet: open the app to receive |
| Calls, desktop, agents, wallet, location | Later phases |
| Vault data backup or export | Not offered (by decision); History export (activity metadata only, CSV or JSON) once the vault release with VAULT-MESSAGING 0.22.0 ships |

A broken Beta feature is a useful report. A broken Core feature is a
high-priority one.

## 6. What the operator can and cannot see

VettID runs the website, the account site, the relay and the enclave
hosts. In plain terms:

**Your vault's contents** (items, messages, connections, keys, your PIN,
your credential password) are encrypted end to end and only ever decrypted
inside the enclave release you approved. VettID cannot read them.

**What VettID's systems do see:**

- **Enclave host** (outside the enclave): it forwards encrypted bytes and
  never parses them. TLS to the relay ends inside the enclave, so the host
  sees only byte counts and timing on a few connections shared by all
  vaults, plus when a vault is enrolled, unlocked or locked, and the size
  of its encrypted state. The enclave's own logs are sanitized and contain
  no content, keys or identifiers of your connections.
- **Relay**: mailbox identifiers, the keys that sign requests, timing and
  padded message sizes. Not who a mailbox belongs to, and not what is in
  a message.
- **Member API**: which member enrolled, unlocked or locked a vault, and
  when; never your PIN, why an unlock failed, or anything inside the vault.
- **Account site**: your name, email, membership state, terms acceptance,
  subscription and sign-in events, kept in an audit log.
- **Website**: standard access logs and TLS fingerprints for traffic
  analysis; email addresses are never logged.

Because VettID runs both the hosts and the relay, it could correlate their
timing. That residual metadata is disclosed rather than hidden
(VAULT-MESSAGING §2.2).

## 7. Network requirements

The app needs outbound HTTPS (port 443) to:

- `account.vettid.org`: membership, and enrollment and unlock requests,
  which travel sealed to the enclave;
- `relay.vettid.org`: messages, by long-poll or WebSocket;
- `vettid.org`: the signed release manifest.

Networks that intercept TLS can break the app's certificate checks.

## 8. Updates

- **Vault releases** need your approval and never have a deadline
  (RELEASE-UPDATES.md).
- **App updates** are published with release notes. Protocol changes are
  versioned (every structure carries a suite or version field), so an app
  that is too old says so rather than failing silently.
- Preview builds may need you to re-enroll after a breaking change; that
  will be announced with the release.

## 9. Feedback

- **Bugs, features, UX**: GitHub issues on the relevant repository
  (vettid-android for the app, vettid-vault for the vault, vettid.org for
  the account site and website).
- **Security**: `security@vettid.org`, never a public issue.
- **Discussion and announcements**: GitHub Discussions under
  github.com/vettid.

## 10. Looking for collaborators

- **Zero-knowledge proofs.** Selective disclosure of identity attributes
  is on the roadmap (PQC-MIGRATION §6). If you have worked with Groth16,
  PLONK, Bulletproofs, Halo2 or proof-carrying data, please start a
  Discussion. Design notes are in the Zero-Knowledge-Trust repository.
- **Vault features (TEE work).** Vault features are Go handlers inside the
  attested enclave image, behind one small interface
  (`Handler(ctx, Session, Inner)`, VAULT-PLAN §2). Proposals start from
  VAULT-MESSAGING (the message registry) and the vettid-vault repository.
  New handlers ship only in a new release, which members approve.

## 11. About the developer

VettID is built by its founder, Al Liebl (vettid.org/about), at the time of
writing largely alone and alongside a full-time job. That means:

- the cryptography, enclave isolation, attestation and storage layers are
  designed conservatively and reviewed;
- the surrounding code (UI, error handling, edge cases) is honest
  preview quality: expect rough edges, and please report them;
- response times vary. Security reports come first, then bugs, then
  polish;
- if you would like to contribute code, the door is open.

Thanks for trying it.
