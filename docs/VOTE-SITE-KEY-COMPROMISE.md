---
title: VOTE-SITE-KEY-COMPROMISE
status: draft
version: 0.3.1
date: 2026-11-13
owner: Al Liebl (Mesmer)
component: vault manager (enclave), votes.vettid.org (vettid/votes), service vault, release process
related:
  - VAULT-MESSAGING.md (0.90.10) §10.19.4 "The service list", "On `vote.extended`"; §10.19.6; §10.19.8 "Reconnecting for votes"; §11.10.1 (manifest, key A); §11.10.4; §11.10.8
  - VAULT-SERVICE-INDEPENDENCE.md (0.2.1) S6, S8, R3 ("`vote_site_key` is open"), R6 (the service's per-release copies)
  - BALLOT-PROTOCOL.md §3.3, §8.5 (vettid/service-vault `docs/BALLOT-PROTOCOL.md`; not in this repository)
  - vettid/votes `docs/VOTES-SITE.md` §3, `site/services.go`
changelog:
  - 0.3.1: Opus round 3 (MERGE WITH NITS). 7.2 is limited to digest and signature mismatches, so a bundle that verifies with a bad time keeps its final outcome; a site bundle never moves an accepted record back to `checking`; a held list with no recorded key counts as verified under another key; §11.10.1 for the pinned manifest keys.
  - 0.3.0: blind review round 2 (both MERGE WITH NITS once the Mediums were fixed):
    - step 4.4 applies once, to a list verified under another site key, and later releases carry it (Opus, Fable);
    - fix 7.2 covers every bundle the site supplies (proposal, extension, results), says which bundle wins and how its `checking` ends, and keeps the site's bundle as evidence (Opus, Fable);
    - 7.3 dropped, moot once 7.2 ships (Opus, Fable);
    - 7.1 accepts a cert under any `ik` in the connection's rotation chain and states the cases it gives up (Opus, Fable);
    - renaming and the problem cap added to section 2 (Fable);
    - references corrected to the independence note's R3 and R6 (Opus);
    - nits.
  - 0.2.0: blind review round 1 (Opus, reviewer of record, and Fable; both CHANGES). Section 2 rewritten:
    - a forged list can name a member's real contacts as services and make the app prompt their removal (Opus High, Fable Medium);
    - extensions and result checks are affected too (Opus, Fable);
    - a forged site can make an `…:anchor` rejection final (Opus, Fable).

    Other changes:
    - the restart rule in 4 is simplified to keep-only-the-last-good-list (Fable; Opus's hash-chain point is moot);
    - the Rekor log is a precondition for knowing the last good list (Opus, Fable);
    - option b corrected: older releases ignore an unknown manifest member (§11.10.1), and b gives key A, now "used for nothing else", a new power without member approval (Opus, Fable);
    - the service's per-release copy is updated;
    - three spec fixes are proposed that hold with or without a theft (7);
    - smaller fixes: `deprecated` defined, `vote.list_rejected` noise, audit-kind entry, §11.10.1 reference.
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
for months, because a vault moves to a new release only when its member
approves (§11.10.4).

This note covers the site key only. Sigstore's roots (`vote_trust_roots`)
change on Sigstore's schedule; the independence note's rotation proposal
(R3) covers them.

## 2. What a stolen site key can do

The site key signs only the service list. To use it, the attacker must
get a list to the app's `vote.site.sync`. That means controlling
votes.vettid.org, its hosting or DNS, or the member's app or network
path.

**What it cannot do: get a forged proposal accepted.** `service` must be
the connection's pinned `ik` or one in its rotation chain, and
`proposal_sig` must verify under it (§10.19.4 step 3). An anchor key
counts only if its `anchor_cert` verifies under that same `ik` (step 6,
and the parse rule that each anchor key's cert verifies under its
service's `ik`). Results and the mismatch rule also rest on the `ik`
signature (§10.19.6). Both reviewers confirmed this.

**What it can do:**

1. **Prompt members to drop real contacts (the worst effect).** Under
   "Reconnecting for votes" (§10.19.8), a person connection whose pinned
   `ik` is a listed service `ik` is returned in `reconnect`. The app then
   tells the member to remove the connection and accept a fresh
   invitation. An `ik` in the list needs no proof, and `anchor_keys` may
   be empty. A forged list can therefore name a member's real contacts as
   a "service" under any `name`, and the app prompts removal. Since
   "names may change" under `Extends`, a forged list can also rename a real
   service wherever the app shows the list's name. That is a
   phishing prompt, and it needs only a contact's `ik`, which every
   connection of that contact holds. Fix 7.1 closes it whether or not
   the key is ever stolen.
2. **Fork the chain: a lasting denial of service on votes.** A vault keeps
   a list only if it chains to the one it holds. One forged version puts a
   vault on a branch, and real later versions are refused (`vote.list_rejected`).
   Then any anchor key a real service adds is never named in that vault,
   and so:
   - its new proposals stay `checking` (`service_list`);
   - extensions under that key fail their bundle check. The spec doesn't
     say whether an unnamed key gives `checking` or a rejection; with a
     rejection, the old `closes_at` stays in force and casting is refused
     during the extension;
   - result checks stay `pending` (`service_list`), then `gave_up`. Once
     `gave_up` checks reach the problem cap (§10.19.6), new proposals are
     answered `limit`, so the vault stops taking votes at all.

   Today nothing brings such a vault back to the real chain. A vault with
   no held list accepts any list that verifies (§10.19.4 "The first
   list"), so in a vault that holds no list the fork can start at any
   version.
3. **Turn "checking" into a final rejection, with the site.** A proposal
   that is `checking` is re-checked against the site's bundle at each
   `vote.site.sync`. A site that serves a real bundle of another proposal
   under a key the list names makes "the digest contradicts the document
   under a key the list names", which is `…:anchor`, and "a rejection for
   `…:anchor` is final" (§10.19.4 steps 5 and 6). The fork makes more
   proposals `checking`, but this needs only control of the site, not the
   key. Fix 7.2 addresses it.

## 3. The exception to "never change the key"

Proposed text for VAULT-SERVICE-INDEPENDENCE R3 (the paragraph
"`vote_site_key` is open"):

> A **suspected or confirmed compromise** of `vote_site_key` overrides the
> rule. On the owner's go, it is a flag day: a release with a new key
> ships at once, and the next manifest marks the releases that pin the old
> key `deprecated` (move-only, no new enrollments; §11.10.1), whatever the
> support window says. The site stops serving lists under the old key.

The same edit corrects R3's line "a vault that pins the old key … ignores
a list under the new one (not an error)". The spec rejects such a list and
audits it as `vote.list_rejected` (§10.19.4). After a flag day, every
old-release vault therefore logs a rejection at each sync until it moves.
This is acceptable, and step 6 below tells members why.

## 4. The response, in steps

The options for how vaults leave the old key are in 5. Every option
starts with these steps:

1. **Contain.** Revoke the stolen key where it is held, and stop
   publishing lists.
2. **Find the last good list.** This is the newest version that we
   published ourselves. It can be known only from a record the attacker
   could not write. **The Rekor log of each published version (6) is a
   precondition.** Without it, the choice is a guess, and an attacker who
   also controlled the site may have put forged versions into the public
   chain itself.
3. **New key.** Generate it under the custody decided in 6. Publish its
   public key and the last good list's hash in an incident note.
4. **Emergency release.** Build a vault release whose release constants
   carry the new `vote_site_key` and the **last good list's hash**
   (proposed constant: `vote_site_restart`). The vault records, with each
   held list, the site key it verified under; a list held from before
   this release has no recorded key and counts as verified under another
   key. **Once**, when a vault of
   this release first finds a held list verified under a key other than
   its pinned `vote_site_key`:
   - it keeps that list only if its hash **equals** `vote_site_restart`.
     It drops any other one, including an older real list (an older one
     loses nothing; the vault takes the newer list next), audited as
     `vote.list_reset` (a new kind, added to the §10.9 audit kinds);
   - after a drop, it accepts the first list it is given under the new
     key, as a vault with no held list does. A list kept or accepted this
     way is recorded under the new key, so the rule never fires on it
     again, and `Extends` applies from then on;
   - it re-checks, against the new list, its `checking` proposals, its
     extensions refused for `anchor`, and its `pending` and `gave_up`
     result checks. `…:anchor` rejections are not re-checked: a forged
     list can't name a key the service never certified, so a rejection on
     the service's own message stands under any list, and fix 7.2 stops a
     site-supplied bundle from making one final. Rejections made through
     a site bundle **before** 7.2 ships stay final: a residual.

   **Every later release carries `vote_site_restart` and this rule**, until
   every release that pins the old key is `removed`. A vault on an old
   release can move straight to any `active` release (§11.10.4) and skip
   the emergency release.
5. **Re-sign and update the copies.** The site re-signs the last good
   list's content under the new key as the next version, chained to it,
   and publishes from there. The service's pre-send check holds a
   `vote_site_key` copy for each release (VAULT-SERVICE-INDEPENDENCE R6).
   It adds the new key for the emergency release and stops treating lists
   under the old key as good.
6. **Move the vaults.** The manifest lists the emergency release and marks
   the old releases `deprecated`. Each vault moves at its member's next
   approved update.
7. **Tell members.** Members whose vault is still on an old release see a
   notice that votes may show as "checking" until they update, and that a
   "reconnect" prompt seen since the incident should be ignored.

## 5. Options for how vaults leave the old key

**a. Emergency release only (the steps in 4, nothing built in advance).**
Exposure: until a member approves the move, their vault can still be
forked, and the attacker keeps the reconnect prompt of 2.1 unless fix 7.1
has shipped.

**b. A revocation carried in the signed manifest (built in advance).**
Every unlock verifies the manifest under a pinned manifest key (§11.10.4
step 1; production pins A and B, staging its own key, §11.10.1). A new optional member, proposed `vote_site_revoked: [{key,
replacement, last_good}]`, lets each release that knows it switch at its
next unlock, with step 4's keep-or-drop rule, without a move.
- **Cost:** a vault change (parse the member and switch keys) and a spec
  change. Manifest parsers ignore unknown members (§11.10.1, "later
  fields are additive only"), so older releases accept such a manifest
  and simply don't act on it. No per-release split is needed.
- **Trust, stated plainly:** the manifest key is today "used for nothing
  else" (§11.10.1), its scope is routing (the §13 key table), and the spec
  avoids resting on its word (§11.10.4's moves need the member's
  approval). Option b gives the manifest key a new power that member approval doesn't gate: changing which site key a
  vault trusts. That power reaches only the service list, so it is small,
  but it is the owner's call.
- **Limit:** it takes effect only once the app hands the vault the newer
  manifest. The enclave requires only `serial` ≥ the recorded serial, so a
  network attacker who can deliver forged lists may also withhold the
  manifest. Best effort.
- **Gain:** closes the exposure at each vault's next unlock with a fresh
  manifest, instead of its next approved move.

**c. A pre-committed successor key, offline (built in advance).** The
release constants pin a second site key, kept offline and never used
until a compromise. A list signed by it makes the vault switch. This is
a second key to guard for years, and it needs the same vault change as b.
It avoids widening the manifest key's scope.

**Recommendation:**
- **Make a the written procedure now.**
- **Ship fixes 7.1 and 7.2 in the next vault release.** They remove the
  phishing prompt and the forced final rejection, the two effects worse
  than a denial of service.
- **Decide between b and c later**, since neither is urgent once 7.1 and
  7.2 are in. b is simpler, and c keeps the manifest key's scope as it
  is.

## 6. Prevention and detection (whatever option is chosen)

- **Custody.** The key should be usable only by the site's publish step,
  ideally a non-exportable KMS key with a narrow policy, never a file.
  **Unverified:** where the key lives today and who can use it. The votes
  repository's owner (claude-services) should answer.
- **Detection, a precondition for 4.2.** Log each published list version
  (its version and hash) to Rekor, the way proposals are anchored. A daily
  monitor, like `rootwatch`, fetches the site's list and alarms on any
  version whose hash is not in the log.
- **Vault signal.** Vaults audit `vote.list_rejected` in the member's
  History. VettID does not see it, and that stays so: no audit leaves the
  vault.

## 7. Spec fixes that hold with or without a theft

These are proposals for VAULT-MESSAGING errata. Each gets its own blind
review.

1. **Reconnect only with proof.** List a person connection in `reconnect`
   only if the listed service entry has an anchor key whose `anchor_cert`
   verifies under an `ik` in that connection's rotation chain (§3.4,
   §6.6). It must be the connection's own chain, not any key in the
   entry: `Extends` lets a forger add a contact's `ik` to a real
   service's entry. The `"vettid/vote/1/anchor-key\x00"` domain keeps a
   person's vault from ever signing such a cert. **Given up:** a real
   service with no anchor key yet can no longer find its old person
   connections this way, and must certify one first. The prompt still
   shows the list's `name`; the app should label it as VettID's list's
   name, not as proof of who runs the service.
2. **A site-supplied contradiction is not final.** For every bundle the
   site supplies (a proposal's bundle at `vote.site.sync`, an extension
   learned from the site's entries, and the results bundle the app
   submits, §10.19.6), a **digest or signature** mismatch under a named
   key gives a new `checking` reason (proposed: `site_contradiction`),
   not `rejected`, `failed` or an `anchor` refusal. That is all a site can
   fabricate, by swapping in a real bundle of another document. A bundle
   that verifies over the right digest but carries a bad time (`t_tsa`
   past `t_relay` + 300 s, §10.19.4 step 6; results anchored before the
   close, §10.19.6 step 2) only the anchor key's holder can make, so it
   keeps its final outcome.
   - A site bundle never moves an accepted record (`open`, `closed`,
     `verified`) back into `checking`.
   - A bundle from the service's own message that verifies wins over any
     site bundle.
   - The new reason ends on any later bundle that verifies, so "only
     information ends the state" (§10.19.4) still holds.
   - The vault keeps the site's contradicting bundle as evidence
     (`vote.evidence`), so a real contradiction that reaches the vault
     only through the site stays visible.
   - Only a contradiction in the service's own message stays final.
     Nothing can be cast while a proposal is `checking`, so no vote is at
     risk.

   **To check when the erratum is written:** whether a swapped results
   bundle gives `failed` today.

## 8. Questions for the owner

- **Q1.** Accept the exception in 3 (a compromise overrides "never change
  the key")? Recommended: yes.
- **Q2.** Card fixes 7.1 and 7.2 for the vault (with spec errata)?
  Recommended: yes.
- **Q3.** How vaults leave the old key: a now with b or c decided later
  (recommended), a + b now, or a + c now.
- **Q4.** Card the custody check and the list log and monitor (6) to the
  votes repository's owner? Recommended: yes. The response in 4 depends
  on the log.

## 9. Not covered

- Theft of the manifest key (key A) or a service's `ik`. Each is a larger
  incident with its own response.
- The votes change that serves every list version write-once.
- Whether an extension under an unnamed anchor key is `checking` or
  rejected (2.2). The spec should say, as a separate erratum.
