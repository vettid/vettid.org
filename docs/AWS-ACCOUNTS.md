---
title: AWS-ACCOUNTS
status: approved plan (owner, 2026-10-04)
version: 0.1.0
date: 2026-10-04
owner: Al Liebl (Mesmer)
related:
  - VAULT-RELEASES.md (O1, O2, work item W3)
  - RUNBOOK.md
classification: public (no secrets; safe for github.com/vettid)
---

# AWS accounts

How the AWS organization is laid out, and the plan for the accounts added
in V5 work item W3.

## 1. Today

One AWS Organizations organization (all features enabled) with a single
account, `VettID`, which is also the **management account**. It runs:

- everything for vettid.org (website, signup, account and admin sites and
  APIs, Cognito, data, relay, audit, DNS for vettid.org and vettid.dev);
- the **Proteus** website (prote.us): S3 + CloudFront + WAF, an ACM
  certificate, and the `prote.us` Route 53 hosted zone (registrar: Hover),
  which also carries the Proton Mail records (MX, SPF, DKIM, DMARC). Its
  code is the separate `proteus-web-site` repository.

Service control policies (SCPs) cannot restrict the management account,
which is why the vault's production keys need an account of their own
(VAULT-RELEASES O1).

## 2. Target (W3)

| Account | Purpose | Notes |
|---|---|---|
| `VettID` (management, existing) | Organization management; vettid.org services as today | Unchanged for now. Moving its workloads out of the management account is a later cleanup, not part of V5. |
| `vettid-vault-prod` (new) | Production vault: release keys, manifest key A, vault data bucket, hosts | Pinned in every production image (O1). SCPs protect the key-policy roles and the policy-lockout bypass. |
| `vettid-vault-staging` (new) | Staging copy of the vault, parked between releases | Own manifest key; keys with a 7-day deletion window (O2). |
| `proteus` (new) | The Proteus website (prote.us) | Moved out of the VettID account so the two projects share nothing but the organization. |

- Accounts are created with AWS Organizations from the management account,
  each with its own root email address (an alias of the owner's mailbox,
  for example `aws+vault-prod@…`), root MFA, and no root access keys.
- Access is through IAM Identity Center permission sets (the existing SSO),
  with separate profiles per account in `~/.aws/config`.
- CDK is bootstrapped in each new account (`cdk bootstrap
  aws://<account>/us-east-1`), with trust limited to the account itself.
- CloudTrail, GuardDuty and the security-alert rules extend to the new
  accounts (an organization trail, or the audit stack deployed per
  account).
- SCPs (organization-level, applied to the new accounts only):
  deny leaving the organization, deny disabling CloudTrail/GuardDuty, and,
  for the vault accounts, deny deleting or modifying the named key-policy
  roles and deny `kms:PutKeyPolicy` with the lockout bypass except by the
  release-key custom resource's role (VAULT-RELEASES §6).

## 3. Moving the Proteus website

The site and its DNS zone move to the `proteus` account with no change for
visitors and no interruption to Proton Mail.

1. **Prepare the repo.** Make the bucket names in `proteus-web-site`
   configurable (S3 names are global: the current `www.prote.us-website`
   and `www.prote.us-logs` stay taken until deleted) and bootstrap CDK in
   the `proteus` account.
2. **Deploy in the new account.** A new stack creates the bucket, a new ACM
   certificate (DNS-validated), the WAF, the CloudFront distribution
   *without* the prote.us aliases yet, and a **new hosted zone** with every
   record copied from the current zone (site aliases, Proton Mail MX,
   SPF/verification TXT, DMARC, the three DKIM CNAMEs, ACM validation).
   Upload the site.
3. **Validate the new certificate.** Add its validation CNAMEs to the
   *current* zone too, so it can issue before the nameservers move.
4. **Move the aliases.** CloudFront allows a domain on only one
   distribution: use CloudFront's alias-move (`associate-alias` with a TXT
   record in the current zone) or remove the aliases from the old
   distribution and add them to the new one immediately after (a gap of a
   few minutes). Point the current zone's apex/www records at the new
   distribution and check the site.
5. **Switch nameservers.** At Hover, replace the four nameservers with the
   new zone's. Mail and site keep resolving from either zone during
   propagation because both hold the same records. Verify MX/DKIM with a
   test message.
6. **Retire the old resources** after 48 hours: delete the old distribution,
   WAF, certificate, zone (after NS propagation), and the old buckets once
   their logs are no longer needed (or copy the logs across first).

The VettID account then holds nothing for Proteus.

## 4. Owner actions

- Choose the root email addresses for the three new accounts.
- Approve each account's creation (an outward action) and set up root MFA.
- Add the Identity Center assignments for the owner.
- Change the prote.us nameservers at Hover (step 5).
- Create the offline hardware token for manifest key B (O3).
