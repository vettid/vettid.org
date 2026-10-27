import re
def sub(path, old, new, count=1):
    s=open(path).read()
    assert s.count(old)==count, (path, old[:70], s.count(old))
    open(path,'w').write(s.replace(old,new))
VM='VAULT-MESSAGING.md'; A='ANDROID-PLAN.md'; I='IOS-PLAN.md'
s=open(VM).read()

# 1. remove old block
i=s.index('**The vault\'s keys after a transfer** (0.68.0;')
j=s.index("- **Vault:** a staging release after 23 (not release L's 23).\n\n")+len("- **Vault:** a staging release after 23 (not release L's 23).\n\n")
s=s[:i]+s[j:]
NEW='''
**The vault's keys after a transfer** (0.68.0; owner decisions
2026-10-27). A transfer rotates the vault's keys by itself, as a
completed recovery does (§11.14.6 step 6, §3.4, §14): the credential key
at the approval, and the relay key (new mailbox and tokens), `ik`, `kem`
and wake key after the new phone's first unlock. The old phone is exactly
the old copy of §11.14.2, and the member gains nothing by choosing.

- **The credential key, at the approval.** The approval carries the
  password, and already opens the credential to hand the holder to the
  new phone and rotate the CEK. In the **step-2 state write** (the new
  device record, the old app's removal), atomic with the move, the vault
  also generates a new credential key and re-seals the credential and
  its critical items under it (§3.5.5, §10.7); the new phone takes that
  blob over. The **rotation statement** (§10.4) is made in the same
  write but **held back in the state**, and sent to the connections that
  pinned the member's key only with the rest of the rotation, after the
  first unlock (below). *The residual this closes:* the old phone, the
  PIN, the password and a replaying host, which could otherwise open an
  old header, state and credential blob and sign as the member under the
  current credential key. *"The move didn't finish"* is possible only
  when the step-2 write was not stored (or an operator restored the
  earlier state, §11.14.2); then the new credential key and its held
  statement were never stored either, the old phone's blob is still the
  credential, and **nothing needs undoing**. Nothing leaves the vault
  before the statement is sent.
- **The rest, after the new phone's first unlock.** The relay key,
  identity and KEM keys and wake key rotate (§3.4) in the state write of
  the then-current app's first successful unlock from the stored objects
  under the transfer's `dek_version` or a later one ("Finish the move"),
  **after the relay has accepted the old phone's
  `device.unlinked{transferred}` notice** (its `201`). The vault first
  deposits the notice, signed with the old relay key and sealed as above,
  and waits for the `201`; only then does it rotate. The notice is the
  old phone's way to erase its keys, and the old relay key, which the
  vault keeps in memory for it during the rotation's grace period, is
  what signs it. Not at the approval: until the new phone has unlocked
  the old phone is the way back from the one write fault no order can
  fix (above), and a rotation announced to the connections could not be
  taken back. After the state write the notices go out (§3.4 notices,
  the held credential-key statement, `relay.address.update`); a
  connection that cannot be reached delays its own notice only. The new
  phone's session follows the rotation as a recovered phone's does.
- **If the notice is not accepted.** The vault keeps the mark and tries
  again at each unlock: nothing rotates while the notice can still be
  delivered. **From 7 days after the approval** (the old app's day-7
  check), at the next unlock the vault rotates anyway, with or without
  the notice. The result is stated, not left open: the pending unlink may
  live as long as its token (at most 30 days), but a rotation made on
  day 7 or later ends the old key's signing after its grace period, so a
  notice still undelivered then is deposited only during that grace
  period and then deleted unsent. The old phone then erases at its
  day-7 check (result 1) or when the member removes VettID, as for a
  notice withheld by a host (above). The cost of rotating anyway is that
  such an old phone may not hear of the move; the benefit is that an old
  copy cannot stay current against everyone else for a month.
- **The owed mark.** At the approval the vault records, in the step-2
  state, that a rotation is owed (`ref` = the `transfer_id`). It lives in
  that state: a state that was not stored, or was restored to an earlier
  one, never holds it, so "The move didn't finish" needs no step to clear
  it. The mark outlives the pending unlink (a pending unlink deleted
  unsent because its token expired does not cancel the rotation). **One
  rotation clears every owed mark**: the transfer's, a recovery's
  (below), and a `credential.rotate`, which rotates the same full set
  (§3.5.5). A pending unlink written by a release before the mark
  existed is treated as owing a rotation.
- **Failure.** A rotation that cannot be made is audited
  (`identity.rotation_failed`, `ref` = the `transfer_id`), the mark is
  kept, and it is tried again at the next unlock: **it never fails the
  unlock, never delays the notice and never fails the move.** A
  successful rotation is audited `identity.rotated` with `ref` = the
  `transfer_id` and appears in History.
- **What the old phone sees.** Nothing new. It was removed at the
  approval (§7.4), so it receives neither the rotation notices nor the
  new address; it learns of the move from `device.unlinked{transferred}`
  as above, or at the day-7 check, and erases. Until it does, its copy
  of the vault is the residual of "The residual until then": a replaying
  host can still run it against the connections, and the rotation is
  what ends that against everyone but the carrier (§11.14.2, last
  sentences). The old phone's last screen and the notice do not change.
- **An unfinished transfer** never rotates the relay key, identity keys
  or wake key: with no unlock by the new phone there is no rotation and
  no notice, and the old phone keeps its way back.
- **What the new phone shows.** The move's screens are unchanged ("Your
  vault is on this phone now."): the rotation follows the unlock by a
  moment and can fail without the move failing, so the screen does not
  promise it. History shows `identity.rotated` ("Your vault's keys were
  renewed") with a line saying the keys were replaced for the move, and
  `identity.rotation_failed` shows its existing text.
- **Vault:** a staging release after 23 (not release L's 23).
'''
k=s.index("backup.\n\n#### 11.14.11")+len("backup.\n")
s=s[:k]+NEW+s[k:]
open(VM,'w').write(s)

# recovery step 6 mark
sub(VM,'''cannot be made never fails the recovery, §11.14.2). The notices to''','''cannot be made never fails the recovery, §11.14.2: the state holds a rotation owed with `ref` = the `recovery_id`, which a failed rotation leaves and the next unlock retries, audited `identity.rotation_failed`; one rotation clears every owed mark, §11.14.10). The notices to''')

# 11.14.2 wording
sub(VM,'''success screen whether to replace the vault's keys (`credential.rotate`,
§3.5.5); the member can also do it later from the credential screen.''','''success screen whether to replace the vault's keys (`credential.rotate`,
§3.5.5, which rotates the whole set: relay key and tokens, `ik`, `kem`,
wake key and the credential key); the member can also do it later from
the credential screen.''')
sub(VM,'''and tried again (a recovery's or a transfer's at the next
unlock; after a PIN or password change the app asks again only if the
member asks)''','''and tried again (a recovery's or a transfer's at the next
unlock, from an owed mark, §11.14.10; a `credential.rotate` that failed
is the member's to ask again)''')
sub(VM,'''  The change's success screen asks the member once whether to replace
  the vault's keys (`credential.rotate`, §3.5.5); a "no" is final for
  that change.''','''  The change's success screen asks the member once whether to replace
  the vault's keys (`credential.rotate`, §3.5.5, which ends the whole old
  copy: relay key and tokens, `ik`, `kem`, wake key and credential key);
  a "no" is final for that change.''')

# 3.4
sub(VM,'''- **Vault `ik` and `kem`** rotate with the Protean Credential (PQC-MIGRATION
  §7). A `credential.rotate` (§3.5.5) MUST rotate them, in the same flush
  as the new credential;''','''- **Vault `ik` and `kem`** rotate at a completed recovery, at a transfer
  (§11.14.10) and with the Protean Credential (PQC-MIGRATION §7). (0.68.0)
  A `credential.rotate` (§3.5.5) MUST rotate them, **and the vault relay
  key** (new mailbox, new tokens, `relay.address.update`, as above)
  **and the wake key**, in the same flush as the new credential;''')
sub(VM,'''| Vault: rotates with the Protean Credential. Device: life of the pairing. |''','''| Vault: rotates at a completed recovery, a transfer and `credential.rotate` (§3.4). Device: life of the pairing. |''')

# 3.5.5
sub(VM,'''  - It rotates the vault's `ik` and `kem` in the same flush (§3.4).''','''  - (0.68.0, owner decision 2026-10-27) It rotates the whole set the
    vault holds, in the same flush (§3.4): the relay key (a new mailbox
    and new tokens, `relay.address.update`), `ik`, `kem` and the wake
    key, so that after a PIN or password change it ends the whole old
    copy (§11.14.2). It clears every owed rotation mark (§11.14.10).''')
sub(VM,'''  - Apps SHOULD offer it at least yearly.
''','''  - Apps offer it in Settings; there is no yearly prompt (0.68.0).
''')
sub(VM,'''  SHOULD offer at least yearly (§3.5.5), does that on demand.''','''  offer in Settings (§3.5.5), does that on demand.''')
sub(VM,'''re-keyed (§10.7), and the vault's `ik` and `kem` rotated (§3.4). On''','''re-keyed (§10.7), and the vault's relay key, `ik`, `kem` and wake key rotated (§3.4). On''')
sub(VM,'''the vault also rotates `ik` and `kem` (§3.4) |''','''the vault also rotates its relay key, `ik`, `kem` and wake key (§3.4, §3.5.5) |''')

# changelog
s=open(VM).read()
a=s.index('  - 0.68.0: **owner decisions 2026-10-27**'); b=s.index('  - 0.67.0:')
CL='''  - 0.68.0: **owner decisions 2026-10-27** (ANDROID-PLAN 0.1.88, IOS-PLAN
    0.1.41; §15 item 42). **A transfer rotates the vault's keys by
    itself**, as a completed recovery does (§11.14.10 "The vault's keys
    after a transfer"): the credential key at the approval (step-2
    write, its statement held back), and the relay key, `ik`, `kem` and
    wake key after the new phone's first unlock and after the relay
    accepted the old phone's notice (rotating anyway from day 7); an
    owed mark in the state, also for a recovery (§11.14.6 step 6).
    **`credential.rotate` now also rotates the relay key and tokens and
    the wake key** (§3.4, §3.5.5, §3.2 table, forced rotation, §10.6
    row), so it ends the whole old copy. **A PIN change or a password
    change does not rotate by itself**: the app asks once, on that
    change's success screen, whether to replace the vault's keys
    (`credential.rotate`); "Not now" ends it, with no banner and no
    repeat. "Apps SHOULD offer it at least yearly" is dropped (the
    banner that carried the offer is gone; the Settings path stays).
    Vault: a staging release after 23.
'''
s=s[:a]+CL+s[b:]
open(VM,'w').write(s)

# item 42
s=open(VM).read()
a=s.index('42. **Keys after a transfer'); b=s.index('## 16. Test vectors')
ITEM='''42. **Keys after a transfer, a PIN change and a password change (0.68.0;
    owner decisions 2026-10-27).** Until now a completed recovery rotated
    the vault's relay, identity and KEM keys and wake key by itself, and
    the app offered `credential.rotate` after a transfer, a PIN change
    or a password change through a banner over every screen, although
    that rotation did not touch the relay key, tokens or wake key.
    Decided:
    - *D1.* `credential.rotate` also rotates the relay key (new mailbox,
      new tokens, `relay.address.update`) and the wake key, so "Replace
      keys" after a PIN or password change ends the whole old copy.
    - *D2.* *A transfer rotates automatically*: the credential key at the
      approval (step-2 state write, atomic with the move; its statement
      held back until the first unlock), the rest in the state write of
      the new phone's first unlock, after the relay accepted the old
      phone's notice, and anyway from day 7. An owed mark in the state
      (also for a recovery) makes a failed rotation retry at the next
      unlock.
    - *After a PIN change or a password change the app asks once, on that
      change's success screen*; a "no" is final, and the rotation stays
      in Settings → Security → Credential. The banner goes. Texts are
      DRAFT (ANDROID-PLAN 0.1.88).
    - *Why:* after a transfer the old phone is exactly the old copy, so
      there is nothing to choose. After a PIN or password change the
      member may be changing it for routine reasons, and a rotation sends
      every connection a notice, so the member decides, once, while
      looking at the result. The credential key moves at the approval
      because the approval carries the password, and a replaying host
      with the old phone, PIN and password would otherwise hold the
      current credential key.
    - *Not chosen:* keeping the banner (over every screen, nags a member
      who said no); rotating automatically after a PIN or password change
      too (a notice to every connection for a change that may be
      routine); rotating the relay and identity keys at the approval (the
      old phone must stay the way back until the new phone has unlocked,
      §11.14.2); rotating before the relay accepts the old phone's
      notice (the old phone could then never hear of the move, and the
      old key that signs the notice would be gone); waiting for the
      notice for the pending unlink's whole life (30 days of a current
      old copy); leaving the credential key to the member's later
      choice (the residual of D2); a yearly prompt (dropped with the
      banner).
    - *Safety:* a rotation that fails never fails the move; the mark is
      kept and retried. A host that replays can still withhold the
      notices (§11.14.2); the rotation ends the old keys against
      everyone else.
    Follow-ups: vettid-vault (a staging release after 23), the apps
    (remove the banner, add the prompt).

'''
s=s[:a]+ITEM+s[b:]
open(VM,'w').write(s)

# Plans: rotation_failed text
for P in (A,I):
    s=open(P).read()
    old='"Your connections still know your old keys. VettID will offer the update again."'
    assert s.count(old)==2
    s=s.replace(old,'"Your connections still know your old keys. Your vault will try again the next time you unlock it." (**DRAFT**, owner decision 2026-10-27)')
    open(P,'w').write(s)
