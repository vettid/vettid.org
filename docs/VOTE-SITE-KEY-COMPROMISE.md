---
title: VOTE-SITE-KEY-COMPROMISE
status: draft
version: 0.1.0
date: 2026-11-13
owner: Al Liebl (Mesmer)
component: vault manager (enclave), votes.vettid.org (vettid/votes), service vault, release process
related:
  - VAULT-MESSAGING.md (0.90.10) §10.19.4 "The service list", §11.10.4, §11.10.8
  - VAULT-SERVICE-INDEPENDENCE.md (0.2.1) S6, S8, section 4.1 ("`vote_site_key` is open")
  - BALLOT-PROTOCOL.md §3.3, §8.5 (vettid/service-vault `docs/BALLOT-PROTOCOL.md`; not in this repository)
  - vettid/votes `docs/VOTES-SITE.md` §3, `site/services.go`
changelog:
  - 0.1.0: first draft (2026-11-13). Raised after the owner's "a" on the independence note, which keeps `vote_site_key` unchanged while any supported vault release pins it. That rule needs an exception and a procedure for a stolen key.
---

# What to do if the ballot site key is stolen

## 1. Why this note exists

`vote_site_key` signs `services.json`, the list of services and their
anchor keys on votes.vettid.org. Each vault release pins it in its
measured release constants (VAULT-MESSAGING §11.10.8), so only a new
release changes it. With the owner's "a" on VAULT-SERVICE-INDEPENDENCE,
the key never changes while a supported release pins it, and the support
window is now two releases or 90 days. That note also says that **no
procedure exists for a key compromise**. Without one, a leak forces a
choice between breaking that rule and trusting a stolen key, possibly
for months.

This note covers the site key only. Sigstore's roots (`vote_trust_roots`)
change on Sigstore's schedule, a separate case covered by the
independence note's rotation proposal (4.1).

## 2. What a stolen site key can do (reading of the spec, to be checked)

This is my reading of VAULT-MESSAGING 0.90.10 §10.19.4. The reviewers
should check it, because the urgency of everything below rests on it.

The site key signs **only** the service list. A vault checks a proposal
against the list only at step 6 ("The anchor"); steps 3 and 6 bind the
proposal to the connection:

- `service` must be the connection's pinned `ik` or one in its rotation
  chain (step 3), and `proposal_sig` must verify under it.
- An anchor key counts only if its `anchor_cert` verifies under that same
  `ik` (step 6).

So a forged list **cannot** make a vault accept a forged proposal, or a
real service's proposal under a key the service never certified. Both
still need the service's own `ik`.

What a forged list **can** do:

- **Fork the chain (lasting denial of service on votes).** The vault keeps
  a list only if it chains to the one it holds (`previous` = `H` of the
  held bytes, a higher `version`). An attacker who gets one forged
  version into a vault puts that vault on a branch. Real later versions
  no longer chain, and are refused as `vote.list_rejected`. Then any
  anchor key a real service adds afterwards is never named, so its
  proposals stay `checking` (`service_list`) in that vault for good.
  Today nothing brings such a vault back to the real chain.
- **Seed a vault that holds no list yet.** A vault with no held list
  accepts any list that verifies and parses (§10.19.4 "The first list").
  The fork can therefore start at version 1.
- **Add junk entries** (services nobody is connected to, extra `iks`).
  They are inert, because nothing reaches a vault through them, but they
  stay in that vault's branch for good.
- **Mislead people who read the public list** if the attacker also
  controls the site. The list is also the public record of which
  services exist.

To deliver a forged list, the attacker must get it to the app's
`vote.site.sync`. That means controlling votes.vettid.org, its hosting
or DNS, or the member's app or network path. A stolen key alone does
nothing.

**Unverified:** where the site key is kept today (KMS, a file on a build
machine, or a CI secret) and who can use it. That custody decides how
likely a theft is. The votes repository's owner (claude-services) should
answer.

## 3. The exception to "never change the key"

Proposed text for VAULT-SERVICE-INDEPENDENCE 4.1:

> A **suspected or confirmed compromise** of `vote_site_key` overrides the
> rule. On the owner's go, it is a flag day: a release with a new key
> ships at once, and releases that pin the old key are marked
> `deprecated` in the next manifest, whatever the support window says.
> The service and the site stop serving lists under the old key.

## 4. The response, in steps

The options for how vaults move off the old key are in 5. Every option
starts with these steps:

1. **Contain.** Revoke the stolen key where it is held. Stop publishing
   lists. Keep the last good version, and its hash, as the **last good
   list**. Every version should already be write-once on the site
   (§10.19.4 "Catch-up"; that votes change is not made yet).
2. **New key.** Generate it under the custody decided in 6. Publish its
   public key and the last good list's hash in the incident note.
3. **Emergency release.** Build a vault release whose release constants
   carry the new `vote_site_key` **and the last good list's hash**
   (new constant, proposed: `vote_site_restart`). A vault of this release
   that holds a list verified under a different site key:
   - keeps it if its hash is the last good list's hash or one of its
     ancestors. The vault cannot check ancestry alone, so the app sends the
     chain from the held version to the last good one, as in catch-up;
   - otherwise drops it, audited `vote.list_reset` (new kind), and takes
     the first list it is given under the new key, as a vault with no
     held list does.

   Proposals held `checking` (`service_list`) are re-checked against the
   new list.
4. **Re-sign.** The site re-signs the last good list's content under the
   new key as the next version, and publishes from there.
5. **Move the vaults.** The manifest lists the emergency release and marks
   the old releases `deprecated`. Each vault moves at its member's next
   approved update (§11.10.4). Moves need the member's approval, which is
   why a vault of an old release can stay on the old key for a long time.
6. **Tell members.** Members whose vault is still on an old release see a
   notice that votes may show as "checking" until they update.

## 5. Options for how vaults leave the old key

**a. Emergency release only (the steps in 4, nothing built in advance).**
Works with what exists today, apart from the new restart constant in the
emergency release itself. Exposure: until a member approves the move,
their vault can be forked (votes stuck in `checking`), and the attacker
can keep forking it. Since the worst effect is a denial of service on
votes, not forged votes, this may be acceptable.

**b. A revocation carried in the signed manifest (built in advance).**
Every unlock already verifies the manifest under a pinned key (§11.10.4
step 1). A new optional member, proposed `vote_site_revoked: [{key,
replacement, last_good}]`, lets every release that knows the member, at
its next unlock, stop accepting lists under the revoked key, switch to
the replacement, and apply step 3's keep-or-drop rule. No move is needed.
- **Cost:** a vault change (manifest parse plus the switch) and a spec
  change (§11.5 manifest format, §10.19.4). The manifest is parsed
  strictly, so releases older than the one that adds the member refuse a
  manifest that carries it. The member can be used only once every
  supported release knows it, or the manifest is split per release
  (needs checking).
- **Trust:** whoever holds the manifest key can then also change the site
  key. Both are VettID's, and the manifest key already decides which code
  runs, so this adds no new party.
- **Gain:** closes the exposure at each vault's next unlock instead of its
  next approved move.

**c. A pre-committed successor key, offline (built in advance).** The
release constants pin a second key, kept offline and never used until a
compromise. A list signed by the successor makes the vault switch.
- **Cost:** a second key to guard for years, and the same vault change as
  b.
- **Gain over b:** none that matters here, since the manifest key is
  already pinned and verified at every unlock.

**Recommendation: a as the written procedure now, b as a card for a
release after 30.** With no real users yet, b is cheap to add before the
support window fills with releases that cannot read it. Not c.

## 6. Prevention and detection (whatever option is chosen)

- **Custody.** The key should be usable only by the site's publish step,
  ideally a KMS key with no export and a narrow policy, never a file.
  First, verify where it lives today (2, "Unverified").
- **Detection.** Log each published list version (its hash and version)
  to Rekor, the way proposals are anchored. A daily monitor, like
  `rootwatch`, fetches the site's list and alarms on any version whose
  hash is not in the log. A signature we did not make is then visible
  within a day.
- **Vault signal.** Vaults already audit `vote.list_rejected`. A member
  whose vault rejects real lists after a fork sees it in History, but
  VettID does not. That stays so: no audit leaves the vault.

## 7. Questions for the owner

- **Q1.** Accept the exception in 3 (a compromise overrides "never change
  the key")? Recommended: yes.
- **Q2.** How vaults leave the old key: a, a + b later (recommended), or
  a + c.
- **Q3.** Card the custody check and the list monitor (6) to the votes
  repository's owner? Recommended: yes.

## 8. Not covered

- Theft of the **manifest** key or a service's `ik`. Each is a larger
  incident with its own response.
- The votes change that serves every list version write-once. Step 1
  relies on it, and it is not made yet.
