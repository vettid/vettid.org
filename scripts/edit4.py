def sub(path, old, new, count=1):
    s=open(path).read()
    assert s.count(old)==count, (path, old[:70], s.count(old))
    open(path,'w').write(s.replace(old,new))
A='ANDROID-PLAN.md'; I='IOS-PLAN.md'
BODY='''"So an older copy of your vault, opened with your old PIN or password, can't be used to reach your connections. Your connections are told about your new keys."'''

# Android section
s=open(A).read()
a=s.index('**Replacing the vault\'s keys, once**'); b=s.index('**A lost answer to a PIN or password change** (0.1.45')
SEC='''**Replacing the vault's keys, once** (0.1.88; owner decisions
2026-10-27; VAULT-MESSAGING 0.68.0 §3.5.5, §11.14.9, §15 item 42). A PIN
change or a password change leaves the vault's keys as they were, so an
older copy of the vault (an old phone with the old PIN, an old header
and state a replaying host presents) still runs. The member decides
whether to end that, because the rotation sends every connection a
notice. `credential.rotate` now replaces the whole set: the relay key
and tokens, the identity and KEM keys, the wake key and the credential
key (vault: a staging release after 23).

- *When.* On the success screen of a PIN change or a password change:
  after the answer that decided it applied, and after a lost answer
  settled "went through" **while the member is still on the change
  screen**. Not when a lost answer resolves in the background or at a
  later start, and never after "didn't go through". A prompt, not a
  banner: shown once for that change, over that screen only. One prompt
  for both kinds of change.
- *Texts (all DRAFT, for the owner).* Title: "Also replace your vault's
  keys?" Body: '''+BODY+''' Buttons: **Replace keys** and **Not now**.
- **Replace keys** opens the rotation of Settings → Security →
  Credential, whose row and screen title become (DRAFT) "Replace your
  vault's keys" (they were "Rotate the credential key" and "Rotate your
  credential key"), with the password asked there as before. **Not now**,
  a back press or any other way out means no: nothing is stored, no
  banner follows, and the app does not ask again for that change. The
  member can still replace the keys from the credential screen at any
  time; nobody is reminded.
- *Removed.* The persistent banner over every screen (release R,
  `rotate_offer`, "You can now rotate your vault's keys: every older
  copy of your credential stops working.", "Rotate now") and the offer
  after a transfer.
- Tests: the prompt after an applied PIN change and an applied password
  change; after a lost answer settled "went through" on the change
  screen; none after "didn't go through", after a settlement in the
  background or at a later start, or after a transfer; "Not now" and back
  store nothing and show nothing at the next start; "Replace keys" opens
  the rotation; no banner anywhere.

'''
s=s[:a]+SEC+s[b:]
open(A,'w').write(s)

# Android transfer bullet
s=open(A).read()
a=s.index('- (0.1.88, VAULT-MESSAGING 0.68.0 §11.14.10) **A transfer rotates the'); b=s.index('- (0.1.50; VAULT-MESSAGING 0.47.1 §3.5.9)')
s=s[:a]+'''- (0.1.88, VAULT-MESSAGING 0.68.0 §11.14.10) **A transfer rotates the
  vault's keys by itself**, as a completed recovery does: the credential
  key at the approval, and the relay key, identity and KEM keys and wake
  key after the new phone's first unlock ("Finish the move") and after
  the relay accepted `device.unlinked{transferred}` (anyway from day 7).
  The apps have no step for it and no longer offer a rotation after a
  transfer (the shell banner of release R is removed). The new phone's
  screens do not change (History only); History shows `identity.rotated`
  with the DRAFT detail below, or `identity.rotation_failed`, which the
  vault tries again at the next unlock. The old phone sees nothing new.
  A PIN change and a password change are asked once: §4 "Replacing the
  vault's keys, once". Vault: a staging release after 23.
'''+s[b:]
open(A,'w').write(s)
sub(A,'''**Rotate the credential key** (`credential.rotate`) stays here; the one-time prompt after a PIN or password change (§4 "Replacing the vault's keys, once") opens it |''','''**Replace your vault's keys** (DRAFT title, was "Rotate the credential key"; `credential.rotate`, now the whole set) stays here; the one-time prompt after a PIN or password change (§4 "Replacing the vault's keys, once") opens it |''')
# changelog android
sub(A,'''credential key". Texts are DRAFT for the owner. Vault: a staging
    release after 23.
''','''credential key". Texts are DRAFT for the owner. Vault: a staging
    release after 23. (Review, same day: `credential.rotate` now
    replaces the whole set; the prompt also follows a lost answer
    settled "went through" on the change screen; one prompt text for
    both changes; the Credential row and screen are titled "Replace your
    vault's keys"; `identity.rotation_failed` DRAFT text reworded.)
''')

# iOS
s=open(I).read()
a=s.index('### 4.11 Keys after'); b=s.index('## 5. Architecture')
S='''### 4.11 Keys after a transfer, a PIN change and a password change (0.1.41)

Owner decisions of 2026-10-27 (VAULT-MESSAGING 0.68.0 §11.14.10,
§11.14.9, §15 item 42); the screens and texts are ANDROID-PLAN 0.1.88's
("Replacing the vault's keys, once"), mirrored on iOS.

- **A transfer rotates the vault's keys by itself**, as a recovery does:
  the credential key at the approval; the relay key, identity and KEM
  keys and wake key after the new iPhone's first unlock ("Finish the
  move") and after the relay accepted `device.unlinked{transferred}`.
  Neither phone has a step for it, and the app no longer offers a
  rotation after a transfer. The transfer screens are unchanged
  (History only); History shows `identity.rotated` (with the DRAFT
  detail in §4.1's table) or `identity.rotation_failed`, which the vault
  tries again at the next unlock. The old iPhone sees nothing new.
- **After a PIN change or a password change** the success screen asks
  once (a sheet over that screen, not a banner), the same for both:
  title "Also replace your vault's keys?", body '''+BODY+''', buttons
  "Replace keys" / "Not now" (all **DRAFT**, for the owner). "Replace
  keys" opens Settings → Security → Credential, "Replace your vault's
  keys" (DRAFT title; `credential.rotate`, which now replaces the whole
  set and asks the password). "Not now", or leaving the sheet any other
  way, means no: nothing is stored, nothing is shown later, and the
  member can still do it from the credential screen. The prompt follows
  an applied change and a lost answer settled "went through" while the
  member is still on the change screen; not a settlement in the
  background or at a later start, and never "didn't go through".
- `identity.rotation_failed` has the DRAFT text of ANDROID-PLAN 0.1.88:
  "Your connections still know your old keys. Your vault will try again
  the next time you unlock it."
- Phase: I1.8 (Change PIN, credential screen) and I3.3 (transfer). Tests
  as ANDROID-PLAN 0.1.88's. Vault: a staging release after 23.

'''
s=s[:a]+S+s[b:]
open(I,'w').write(s)
sub(I,'''rotation in Settings → Security → Credential. The texts are
    Android's, DRAFT for the owner. Vault: a staging release after 23.
''','''rotation in Settings → Security → Credential. The texts are
    Android's, DRAFT for the owner. Vault: a staging release after 23.
    (Review, same day: as ANDROID-PLAN 0.1.88's review note.)
''')
