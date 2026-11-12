# Relay-key rotation without wait cycles: design note (draft 2)

For the owner and the lead. This draft was checked against VAULT-MESSAGING
0.89.0 (origin/master). 0.89.0 adds 35 lines of front matter and the
approval documents of §10.4. Every section quoted below has the same text
as in 0.88.18, only moved by those 35 lines. RELAY-PROTOCOL is read on the
same master.

Sections 1 to 5 are written so that they can move into the spec. Sections 6
and 7 are internal.

## Changes since draft 1

| Item | What changed | Where |
|---|---|---|
| High 1: G1-A must not let a pre-rotation copy through | The update now carries P's identity links (S8) and Q applies them before it follows the relay links ("binding L"). An `ik` link in the relay link's signed body is kept as the alternative. The pass condition is restated against the bound `ik` | 2.2 (G1-A, "The binding"); 4; 7.3 |
| High 2: the claim "S4: a relay-key rotation always rotates the `ik`" is false | The decoupled cases are named: the gate-owed key, the next key stored at a pending key's second write, and a device's relay key. G1-A is limited to pairs of vaults. Device pairs are argued free of G1 to G3. Vault safety in the decoupled cases is argued | 1.5; 2.2 ("Decoupled rotations"); 5 |
| Medium 3: G2-A is weaker than the current signal | The hybrid (G2-H) is the recommendation. Before authentication, a carried token's `sub` only picks the deposit key for that handshake's own messages. S2 advances only at authenticated points. The key is looked up by connection, not by `iss` | 2.1; 4; 7.1 |
| Medium 4: the claim "G2-B follows from G2-A" is false | The claim is removed. The reverse case is stated and handled: G2-B uses the token's `sub` (K), and G1-A lets the message past the cut-off. The mirror restart on Q's side is offered as an option | 2.1 (G2-B, "Reverse case"); 2.2 (G1-N) |
| Medium 5: a rekey `hs.init` after the cut-off is not covered | A session-mode rekey `hs.init` now passes under the epoch-signer test. S2's advance restarts a rekey that has had no answer. §4 Step 1 and its table row are rewritten | 2.2 (G1-A part 2, part 3); 4 Step 1 |
| Medium 6: 7.1 was framed unfairly | "Signal unchanged + G2-B" is offered as a full option, with what it costs | 7.1 |
| Medium 7: the bound runs past S1's 30 days | The bound is recomputed from the second write: 5`U` normally, 9`U` at worst. This is now an owner question | 4 ("The bound"); 7.4 |
| Medium 8: the costs of the grace option | The main proposal is now a rule on Q's side: hold deposits on `mailbox_unknown` for P's mailbox. The cost of a longer grace is stated. The deployed grace was checked: no value is set, so the default applies | 3.3; 7.5 |
| Low: a held `hs.fin` and `B` | Corrected. The spec does not say whether a held `hs.fin` starts `B`. A rule is proposed | 1.3; 2.2 (part 4) |
| Low: S2's re-deposit has no token for K′ | S2 now re-deposits only messages on held tokens. Messages on a carried token keep their token's key (G2-B) | 2.1 (G2-H, rule 4) |
| Low: the "update" row when P is demoted or pending | The row is fixed | 4, table |
| Low: G2-A's `iss` check when both sides rotate | The key is looked up by connection. The G4 harness mode covers this case | 2.1; 5 (G4); 6 |
| Low: rule T against P's `hs.resp` during S1 | Proposed: tokens are minted for the mailbox of the key the message is deposited with. Listed for a check in the model | 2.1 (G2-H, rule 5); 6 |
| Low: the crash table | K1's second write that also stores K2 is added, and so is the refused-state write | 3.2 |
| Nits | Labels are 24 characters or fewer. `R29RP_REPEAT` is added. The ordering of Φ is argued | 7; 6; 4 |
| Answered unsure points | Send keys are always erased: G1-B is updated. An open rekey answer holds Q's demotion reconnect: this is decided, see 7.8. "Nothing else counts" now reads as "must prove Q followed" | 2.2; 7.8; 2.1 |
| Narrower alternative to G1-A | Added as G1-N, and as an option in 7.2 | 2.2; 7.2 |

Words used below:
- **P** is the side that rotates its relay key from K to K′. **Q** is one
  recipient.
- **P's key for Q** is the term S1 uses.
- **Q has followed** means Q has applied P's `relay.address.update` by
  rule U. From then on K is "earlier" at Q, and its **cut-off** is the
  update's position.

---

## 1. The gaps, exactly

### 1.1 What "demoted" means

"Demoted" is a state of an epoch (§3.4.1).
- "Epochs after an `ik` link": an epoch of P is "**demoted by position**:
  it stops being current (if it was)".
- "Strict F1": Q "demotes all of them and reconnects naming E".
- An epoch abandoned by a link "is demoted from the start" (§6.3.1).

A **demoted Q** is a Q in the state of §3.4.1 "After a demotion of the
current epoch". Q has no current epoch with P, and:
- "Q sends P nothing but handshake messages (its reconnect below, an
  `hs.resp`, an `hs.fin`)";
- Q's durable messages are "**held** in the outbox".

`relay.token.issued` is a durable session message. So a demoted Q holds
it, and has no epoch to seal it under. The send keys of earlier epochs are
erased (§6.5 "Key retention").

A Q whose own reconnect is **pending** is in the same position (§6.3.1
Initiator: "`I` sends `R` nothing but the handshake"). Such a Q usually has
no valid standing token for P either.

Demotions are honest around rotations of the `ik`. Example: P's rekey is
pending at P and active at Q, and then P rotates. S5 abandons the pending
epoch, P's `identity.rotate` travels under the earlier epoch E, and
strict F1 demotes Q's current epoch.

### 1.2 The rules that cause the gaps

- §3.4 "The signal": acknowledged means "received from it
  `relay.token.issued` for the new `sub` ... Nothing else counts, not even
  a message deposited with a token the vault issued for the new `sub`".
- S1: "P deposits to Q only with it. While it is not P's current key, P
  sends Q only the update, ..., `relay.token.issued`, the messages of a
  reconnect (its `hs.init` announcing that key, its `hs.fin`, an `hs.resp`
  to Q's reconnect), ... `hs.confirm`, ...; everything else for Q waits in
  P's outbox."
- S2: P's key for Q advances "when Q's token arrives".
- S3: "Every token P puts in a message to Q names as `sub` Q's relay key
  as P knows it when the message is deposited".
- Rule U: Q sends `relay.token.issued` "After that write". It is a session
  message, so a demoted or pending Q holds it.
- §6.3.1 "What they are used for before": the handshake's own messages are
  "each deposited with the carried standing token".
- RELAY-PROTOCOL §5.3 step 7: "`X-VettID-Key` == token `sub` ... else
  `signature_invalid`".
- Table A, row "Earlier, after its cut-off". Everything is refused
  (`superseded_relay`), with three exceptions: the update (rule U), the
  tokens of `relay.token.issued` (rule T), and an `identity.rotate` whose
  links are all already followed.
- `relay.address.update` carries only relay links (rule U). P's identity
  links travel separately, and §8.4 does not order them.

### 1.3 G1: a rekey's `hs.init` and `hs.fin` against a demoted Q

This sequence is reconstructed from the rules. It is *unsure* whether it
is the trust model's most common path.

1. **P's first write.** P's new `ik` is current and K′ is pending.
   `identity.rotate` goes out under E. S5 restarts P's rekey under the new
   `ik`, and its `hs.init` is deposited with K. S1 is not active yet.
2. **Q is demoted.** Q follows the `ik` link, and strict F1 demotes Q's
   current epoch.
3. **Q answers P's rekey.** The rekey names E, which is Q's confirmed
   epoch, "accepted as if it were current". Q's `hs.resp` then waits for
   P's `hs.fin`.
4. **P's second write.** K′ becomes current, and S1 is active toward Q.
   P deposits the update with K.
5. **Q follows the update** (cut-off at the update). Rule U says Q now
   sends `relay.token.issued` for K′, but Q is demoted, so the message is
   **held**.
6. **P's `hs.fin` is held.** P processes Q's `hs.resp` and makes its
   `hs.fin`. S1 **holds** it, because only "a reconnect's" `hs.fin` is on
   S1's list. Even if S1 let it go, it would be deposited with K after the
   cut-off, and Table A would refuse it.

The waits now form a cycle:
- P's `hs.fin` waits for Q's `relay.token.issued`.
- Q's token waits for Q to have a current epoch.
- Q gets a current epoch from P's `hs.fin`, or from Q's own demotion
  reconnect. That reconnect is held while Q's answer to P's rekey is open
  (§6.6, read in 7.8), and once it runs, G2 and G3 break it.

**How it ends.** Q's answer expires at `L` (16 days), and then Q's
reconnect meets G2. At P, the spec does not say what bounds a handshake
whose `hs.fin` is held:
- `B` runs "from `hs.fin`" and starts "Once `I` has sent `hs.fin`".
- The 16-day initiator lifetime is for a handshake "awaiting `hs.resp`".

So P's side has **no stated bound**. *Unsure* what the trust model does
here; it appears to make the epoch pending when the `hs.fin` is queued.
The pair ends `stale` by "The reconnect bound" on Q's side, or by S1's 30
days.

### 1.4 G2: the answer to Q's reconnect

1. P is in S1 toward Q: P's key for Q is K, and its current key is K′.
2. Q has followed, so Q's relay key on record for P is K′. Q is demoted,
   or has no valid standing token, and reconnects.
3. Q's `hs.init` carries tokens with `sub` = K′ (S3).
4. P's `hs.resp` is deposited with the carried token (`sub` K′), using
   P's key for Q, which is K (S1). The relay refuses it with
   `signature_invalid` (§5.3 step 7).
5. Even if the relay accepted it, Q would refuse it: it comes from K after
   the cut-off (`superseded_relay`).

Each try expires after 16 days. The third failure makes the pair `stale`.
S1 fixes the deposit key, while S3 and §6.3.1 fix the token's `sub`, and
the relay needs the two to be equal.

### 1.5 Who can meet these gaps

- **G1 and G3 need a Q that is demoted or has a pending reconnect.** A
  vault never demotes a device's epochs and never reconnects to a device.
  A device applies no demotion and starts no rekey or reconnect (§6.3.1
  "Devices and agents"). So G1 and G3 occur only between two vaults.
- **G2 needs a reconnect,** which happens only between vaults.
- **A device as P (rotating its own relay key):**
  - The vault (Q) always has a current epoch with it, so the vault's
    `relay.token.issued` is never held.
  - The device's `hs.resp` to the vault's rekey is not on S1's list. It
    waits for that token and then goes with the new key.
- **A device as Q:** it is never demoted and never pending, so it sends
  `relay.token.issued` at once. The existing S2 re-deposit covers P's
  `hs.fin`.

So device pairs see delay, but no cycle. *Unsure:* the device side of S1
toward a vault rekey still pending at the vault. The harness should cover
it.

---

## 2. Candidate fixes

None of these changes a rule that release 29 builds: release 29 has no
earlier-key rows, no S1 and no rule U (A5). The release-29 rules they
extend are named where they come up.

### 2.1 G2

**G2-A: any verified token naming P's newer key advances S2.** This was
draft 1's recommendation and is now **not recommended**.
- It fires on the carried tokens of a reconnect `hs.init`, which is not
  authenticated until `hs.fin`.
- An old copy of Q that read P's update from Q's live mailbox can mint
  such a token. A forged `relay.token.issued` needs Q's epoch keys as well.
  The copy can then make P advance, stop resending the update, and deposit
  with K′. The real Q, which never followed, refuses those deposits as
  `foreign_sender`. That is a silent split.
- So G2-A is weaker than the current signal.

**G2-B: a message on a carried token goes with the key that token names.**
- **Spec change.** `hs.resp`, `hs.fin`, `hs.confirm` and its re-sends,
  deposited on a carried token, use the relay key that the token's `sub`
  names. P must still hold that key: its current key, or a kept earlier
  key (§3.4 (a)). S1 and S2 are otherwise unchanged.
- **Effect on G2.** The `hs.resp` goes with K′, and both the relay and Q
  accept it.
- **Reverse case.** Q made its `hs.init` before it followed, so the token
  names K. It reaches P after P has advanced. G2-B deposits the `hs.resp`
  with K, the token's `sub`. If Q followed in the meantime, the message
  lands after the cut-off, and G1-A part 2 lets it in (an authenticated
  `hs.resp`). Without G1-A, the try fails; G1-N's mirror restart is the
  alternative.
- **If P no longer holds the named key** (the old key was deleted, §3.4
  "When the old key is deleted"), the answer cannot be deposited. It is
  dropped as under rule J, and Q's next try names K′. That costs one
  failed try.
- **Security.** Nothing new is announced, and the signal is unchanged.
  The message is sealed and carries no address.

**G2-H, the hybrid (recommended).** G2-B, plus one more trigger for S2 that
fires only at authenticated points.
1. **Before authentication,** a carried token only picks the deposit key
   for its own handshake's messages (G2-B). It changes nothing else.
2. **S2 advances** to the newest key of P named by a token from Q, when
   that token reaches P at one of these points:
   - in `relay.token.issued` (as today);
   - in a reconnect `hs.init` from Q whose `hs.fin` P has verified
     (`sig_I`) — that is, at establishment;
   - in an `hs.resp` from Q whose `sig_R` P has verified;
   - in a token P adopts (§6.3.1).

   The key must be one P still holds. Tokens are matched to Q by the
   connection, and the key is P's key, so this works even when Q's
   mailbox (`iss`) has itself moved (G4). Rule T still checks `iss`
   against what P knows of Q's mailbox before the token is kept for any
   other use.
3. **"No reconnect while carried tokens wait" extends to P.** While P holds
   undiscarded carried tokens from Q that name a key P holds, P does not
   treat "no valid held token for my key for Q" as §8.6's "no valid
   standing token" case. This extends a release-29 rule, only while a
   relay-key rotation is in flight.
4. **S2's re-deposit** ("deposited again (the same bytes) with the new
   key") applies only to entries on held tokens. Entries on carried tokens
   keep their token's key (rule 1). An entry that needs a held token for
   K′ waits for one (from `relay.token.issued` or an adoption).
5. **Tokens P puts in a handshake message during S1** are minted by the
   mailbox of the key the message is deposited with. This extends §3.4
   (a)'s exception for the old key ("it mints the standing and reconnect
   tokens of a reconnect `hs.init` it deposits with the old key") to the
   `hs.resp`. Without it, Q, which has not followed, ignores a token
   issued by K′'s mailbox (rule T: "`iss` the mailbox of P's current relay
   key"). To be checked in the model.

- **Why the cycle ends.** The `hs.resp` goes out with the right key (rule
  1). Q's `hs.fin` authenticates Q's `hs.init`, and with it the K′ token,
  so S2 advances. Q's prompt `relay.token.issued` (§6.3.1 "The prompt to
  adopt") then gives P held tokens for K′.
- **Security.** An advance needs Q's `ik` (`sig_I` or `sig_R`) or Q's
  epoch keys (`relay.token.issued`, an adoption). That is the same bar as
  today's signal. The only extra thing an unauthenticated token can do is
  pick the key for the messages of the handshake it travels in. If a copy
  of Q makes P answer with K′, the real Q (which has not followed) refuses
  that answer, and the answer belonged to the copy's handshake anyway.
- **"Nothing else counts".** No reason for it is recorded. It reads as:
  "the acknowledgment must prove that Q followed". A token minted by Q
  that names K′ proves it. G2-H adds only the authentication bar, so it
  meets that reading.

### 2.2 G1 (and G3)

**The binding (needed by G1-A and G1-N).** "Authenticated by Q's current
`ik`" is enough only if Q's current `ik` for P, at any cut-off, is at
least as new as the `ik` P held when it made the relay link. Today the
update carries only relay links. Q can follow K→K′ while its `ik` for P is
still the old one, and then a copy taken before the rotation passes with
the old `ik`. Two ways to bind them:

- **L (recommended): the update carries P's identity links.**
  - The update carries `rotations`, as S8 gives an `identity.rotate`: P's
    links from the signer of the epoch the update travels in, up to P's
    current `ik`. They are made again at each resend.
  - In the write that processes the update, Q applies them **before** the
    relay links, exactly as it would apply an `identity.rotate`'s links:
    rule C, Table B, H5, the demotion rules and R29-K9.
  - If Table B refuses any of them, Q follows **no** relay link from that
    update.
  - So at every cut-off, Q's current `ik` for P is at least P's `ik` when
    the update was made. The relay link of a rotation is signed in its
    first write, and that write makes the new `ik` current, or the `ik`
    was already current. Either way, the bound `ik` is at least the one
    current at the link's first write.
  - It reuses machinery that already exists and is already tested. As a
    side effect the `ik` links reach Q with the update, which strengthens
    §4 Step 1.
  - Cost: the update's handler runs the identity follow path. *Unsure:*
    whether processing an update under a demoted epoch then needs R29-K9's
    judgment, as `identity.rotate` does. Probably yes, the same way.
- **R: the relay link's signed body names the new `ik`.**
  - `m` = `"vettid/vms/2/relay-rotate" || old || new || ik`. Q passes the
    cut-off only for messages authenticated by an `ik` that is current at
    Q and is the link's `ik` or a successor of it.
  - Cost: a new signed format and test vectors, plus a rule for a link
    whose `ik` Q has not reached yet: Q follows the relay link but grants
    the exception only once that `ik` is reached.
  - It does not deliver the `ik` links, so §4 Step 1 still depends on the
    order of messages.

**Decoupled rotations, where a relay key is generated without a new
`ik`.**
- **The gate-owed key.** The relay key is generated at a later unlock, up
  to 30 days after the `ik` changed (§3.4.1 "The gate").
- **The next key.** It is stored at a pending key's second write (§3.4 "A
  rotation made while a relay key is pending").
- **A device's relay key.** A device has no `ik` to rotate (§6.7).
- **Why the vault side stays safe in the first two cases.**
  - Under L, the bound `ik` is P's `ik` when the update was made. A copy
    taken before that `ik`'s rotation wrote it holds only an ancestor
    `ik`: Table B refuses it, and it cannot pass the cut-off.
  - A copy taken after that write, but before the relay key's first
    write, holds the current `ik` and K. Under G1-A it could pass the cut-off
    with a message authenticated by that `ik`.
  - Such a copy "counts as P" already (§3.4.1 Residuals: "A copy taken
    after R's first write holds R's new keys ...; only a later rotation
    ends it"). It can already sign every handshake as P, and deposit with
    K until Q follows.
  - What G1-A adds for it is narrow: handshake messages and `hs.confirm`
    deposited with K after the cut-off. This is a stated extension of that
    residual (listed in 6, step 5), and the next `ik` rotation ends it.
  - The relay-only rotation still ends the copy's control of the old
    mailbox, which is what the gate-owed key is for.
- **Device keys.** By 1.5, G1-A is not needed for devices. It is **limited
  to pairs of vaults**: a vault does not apply the exception to its own
  devices' earlier relay keys.

**G1-A, recommended.** Pairs of vaults only, with binding L.
- **Part 1, S1's list.** S1 also lets out a rekey's `hs.init`, `hs.resp`
  and `hs.fin`.
- **Part 2, the cut-off exception.** In Table A, row "Earlier, after its
  cut-off", these messages go on to Table B instead of being refused:
  - an `hs.resp` or `hs.fin` for a handshake Q has open, whose `sig_R` or
    `sig_I` verifies under an `ik` that is Current (or Reached through
    links the message carries) at Q;
  - an `hs.confirm`, and a **session-mode rekey `hs.init`**, under an
    epoch whose P-side signer is Q's current `ik` for P.

  A reconnect `hs.init` stays refused. It is not authenticated before
  `hs.fin`, and a copy could use it to take Q's answer slots (the cap of
  4).
- **Part 3, a rekey refused at the cut-off.** P's first rekey after a
  rotation travels under an epoch signed by the old `ik`, so part 2 does
  not pass it. When S2 advances, P abandons each of its open rekeys whose
  `hs.init` went with an earlier key and that has had no `hs.resp`, and
  starts it again with the new key. This mirrors S2's rule for
  reconnects. Until S2 advances, the rekey's 16-day lifetime bounds it,
  and S2's advance is bounded (§4).
- **Part 4, a held `hs.fin` starts `B`.** The epoch is pending, and `B`
  runs, from the write that queues the `hs.fin`, not from its deposit.
  This closes the unbounded wait of 1.3 whatever S1 holds.
- **Why it breaks G1.** P's rekey `hs.fin` leaves with K. `sig_I` verifies
  under Q's current `ik`, so Q accepts it after the cut-off and
  establishes the epoch. Q then has a current epoch again, releases
  `relay.token.issued`, and S2 advances.
- **Security.** With binding L, a copy taken before the bound `ik` cannot
  make `sig_R`, `sig_I` or an epoch signed by Q's current `ik`, so I3
  holds. Copies taken later are covered by the decoupled-rotation
  argument above. I3's wording becomes: "Q accepts nothing the copy
  deposits after the cut-off except tokens that pass rule T, duplicates of
  followed links, and a handshake message or `hs.confirm` authenticated by
  Q's current `ik` for P, which a copy taken before that `ik` was written
  cannot make".
- **It also closes G3.**

**G1-N, the narrower alternative.**
- **Spec change.**
  - Only `hs.confirm` passes the cut-off (part 2 for `hs.confirm` alone,
    with binding L).
  - **Q's mirror of S2:** when Q follows a relay link, Q abandons its open
    reconnect whose `hs.init` carried tokens naming the passed key and that
    has sent no `hs.fin`, and starts it again. The new `hs.init`'s tokens
    then name K′, and G2-B or G2-H handles the answer.
  - Rekey messages stay off S1's list.
- **Effect on G1.** P's rekey `hs.fin` is still held. Q's demotion
  reconnect waits behind Q's open rekey answer until `L` (16 days, 7.8),
  unless Q drops that answer at the demotion (G1-C).
- **Cost.**
  - G1 still costs up to 16 days.
  - Each mirror restart spends one deposit of P's reconnect token. *Unsure*
    whether it counts against the bound, since the restart is not a
    failed try.
  - The `hs.resp` case of G3 is handled by the restart. A P `hs.resp` to a
    reconnect whose `hs.init` came after Q followed is still refused if Q
    follows again (a second rotation). That case is rare.
- **What it keeps.** A smaller change to Table A.

**G1-B: Q never holds `relay.token.issued`.** This cannot work. A demoted
Q has nothing to seal the message under (send keys are erased, §6.5), and
a Q with a pending reconnect usually has no standing token. Its variant,
"rekey `hs.resp`s carry tokens", brings §6.3.1's adoption and revocation
machinery into rekeys and misses the case where Q answered before it
followed. Not recommended.

**G1-C: a demoted Q drops its rekey answers.** With G2-H, Q's reconnect
then completes. It wastes P's rekey and changes a release-29 responder
rule. It remains an option with G1-N.

---

## 3. The crash order between the relay's rotate and the state write

### 3.1 What §3.4 says

"The order of a relay-key rotation": "The vault **stores first, then
rotates, and retries with the same key**".
1. The first write stores K′ as pending, with its tokens and the held
   updates. The `ik`, `kem` and wake key are current from this write.
2. The rotate call.
3. A second write makes K′ current.

All three paths use it (transfer: §11.14.10; recovery: §11.14.6 step 2;
`credential.rotate`: §3.5.5). There is one exception: a recovery's fresh
key after a refused registration is registered before any state holds it.

### 3.2 What each crash point leaves

| Crash point | State | Relay | Next unlock | Lost |
|---|---|---|---|---|
| C0: before the first write | K current, nothing pending; an owed mark if one was written earlier | the old mailbox | the mark retries the rotation; a `credential.rotate` is the member's to ask again | nothing |
| C1: after the first write, before the rotate | K current, K′ pending; the new `ik`; `identity.rotate` sent | the old mailbox | rotate with the same K′ | nothing; no update was announced |
| C2: after a successful rotate, before the second write | as C1 | both mailboxes; the grace runs from the rotate | rotate again (same mailbox), then the second write; past the grace, `mailbox_unknown`, then register (`200`: go on; `201`: re-mint every held token) | if the vault stays locked past the grace: the old mailbox's uncollected deposits, and deposits refused to it until the second write |
| C3: after the second write, before the updates go out | K′ current, K deposit-only, updates in the outbox | both mailboxes | the outbox delivers them; resends | nothing |
| C2′: a relay key K1 completed while a rotation is owed; crash after K1's second write, which also stores K2 as pending | K1 current, K2 pending, the relay-key mark cleared; the other marks stay | K1's mailbox (K's in its grace) | as C1 for K2 (rotate signed by K1); K1's updates are already out | nothing; K1's announcement and K2's retry are independent |
| CR: a definite refusal; crash before the write that marks the key refused | as C1 or C2 | unchanged | the attempt is made again and refused again; then the refused write | nothing; the audit comes one unlock later |

- **Old key only:** C0 and C1.
- **New key pending, relay holding both mailboxes:** C2.
- **Both keys, K′ current:** C3 and later.

### 3.3 Is the rule complete?

**For safety, yes.** I5 holds, retries use the same key, and the refused
state and a recovery's fresh key are covered.

**For liveness, three things are missing.**

1. **The grace runs from the rotate, while recipients learn the address
   only at the second write.**
   - At C2 the second write can come one presence interval `U` after the
     rotate, and Q needs up to one more hop `U` to follow. Until then Q
     deposits to K's mailbox.
   - Past the grace those deposits are refused `mailbox_unknown`. Since
     0.88.7, Q then ends its waiting durable messages
     (`drop.undelivered_mailbox_unknown`, §8.3 "Not delivered", §8.6).
   - 2`U` = 8 days, more than the default grace.

   **Proposed rule on Q's side (recommended).**
   - While Q's connection with P is active and Q has had no update from
     P, a deposit to P's mailbox refused `mailbox_unknown` is **held**:
     not ended, and not a reason to mark the connection `stale`.
   - It is held until P's update arrives. Rule U then re-addresses the
     held entries to the new mailbox with the update's tokens.
   - Q stops holding when the connection is removed or replaced, or 30
     days after the first such refusal (Q's own clock). After that, §8.6
     applies as today.
   - Q cannot tell a rotated mailbox from a deleted one. A deleted peer
     sends `connection.removed` first (§7.4), so the 30-day hold costs
     only a delay in the rare case where that notice is lost.

   **Longer grace (not recommended as the main fix).** It would double, for
   every rotation, the time during which an old copy keeps the live old
   mailbox (the Residuals: "During the grace an old copy holding the old
   key can collect, ack or delete the old mailbox").

   **The deployed value.** The relay's task definition in vettid.org
   (`lib/stacks/relay-stack.ts`, environment block) sets no rotation-grace
   variable, so the relay's default applies. RELAY-PROTOCOL §6.7 gives
   "default 7 days", read as 168 h. The relay's source
   is not checked out locally, so I could not confirm the variable or its
   default in the code (*unsure*).
2. **The second write's S1 state** should be listed with step 3: per
   recipient, P's key for Q = K, and the start of S1's clock.
3. **§8.6 "Re-resolve the address".** Point 1 replaces it for a peer's
   mailbox during a rotation.

---

## 4. Liveness argument sketch (G2-H + G1-A + binding L + the Q-side `mailbox_unknown` hold)

This uses the style of §3.4.1 "Liveness between honest vaults (0.88.2)",
and extends it.

*Assumptions.*
- A1 to A4 as in 0.88.2.
- **A5′:** either vault may rotate its relay key, and both advertise
  `relay_follow`.
- **A6:** the Q-side `mailbox_unknown` hold of 3.3, so the grace does not
  enter the argument.
- **A7:** no definite refusal. The refused state is visible and outside
  the argument.
- This argument covers pairs of vaults. Device pairs are covered by 1.5,
  with no cycle.

*Progress measure.* Φ = (π, μ, λ, δ, ρ), compared in that order.
- π: the number of pending relay keys;
- μ: the number of (side, recipient) pairs whose key for the recipient is
  not the side's current key;
- λ, δ, ρ: as in 0.88.2.

*Why the order is sound.*
- After `t_r` no rotation happens, so nothing adds to π or μ (S2 only
  advances).
- Under binding L, following an update also follows its `ik` links, so
  that step lowers λ.
- Every rule that raises δ, or restarts a handshake (raising or keeping
  ρ), fires only at an `ik` link (as in 0.88.2) or at an S2 advance (part
  3, the restart of S2), each of which lowers λ or μ.
- So every step that raises a later component lowers an earlier one, and
  the lexicographic order still decreases.

*Step 0. π reaches 0 within `U` of `t_r`.* Each unlock makes one attempt
(A2).

*Step 1. λ reaches 0 by `t_r` + 3`U`.*
- `identity.rotate` leaves after the first write, before S1.
- Under binding L, every update and every resend carries the links, and
  S1 always lets the update through.
- Rekey and reconnect messages carry the links (S8). Under G1-A, S1 no
  longer holds them, and part 2 lets them past the cut-off when they are
  authenticated.
- A rekey `hs.init` that part 2 refuses (its epoch is signed by the old
  `ik`) does not carry the links to Q. It is not needed, because the update
  already did.

*Step 2. μ reaches 0. Every wait names what ends it.*

| Wait | Ended by | Bound | Why it cannot form a cycle |
|---|---|---|---|
| The update reaching Q | S1 lets it through, after the earlier deposits' definite answers; resends at each unlock (b). It is a session message: while **P** is demoted or has a pending reconnect it is held until P's next current epoch, which 0.88.2's rows bound (P's reconnect goes with K before Q's cut-off, since Q has not followed yet) | `U` after the second write, or one round more if P has no current epoch / S1's 30 days | needs nothing from Q's acknowledgment |
| Q following | rule U, with binding L, in one write | one hop | needs nothing more from P |
| Q's acknowledgment reaching P | (a) `relay.token.issued` when Q has a current epoch; (b) when Q has none: P's open rekey `hs.fin` passes the cut-off (G1-A), which gives Q one, then (a); or Q's reconnect, answered with the token's key (G2-H rule 1), and at its `hs.fin` S2 advances (rule 2); (c) a pending Q confirms on P's `hs.confirm` (G1-A part 2), then (a) | one round, plus one hop / "The reconnect bound", and `B` from the queued `hs.fin` (part 4) | Q's acknowledgment never waits for a message P holds for want of it: P's handshake messages pass S1 (part 1) and the cut-off (part 2) |
| P's handshake messages during S1 | deposited with the carried token's key (G2-H rule 1) or P's key for Q; accepted before the cut-off as today, and after it when authenticated (part 2); a rekey refused there is restarted at S2's advance (part 3) | one hop; a refused rekey: until the advance / 16 days | neither the relay's sender check nor Table A turns a round into an expiry |
| P's other entries held by S1 | S2's advance | the row above | every message a handshake needs passes S1 |
| P's entries that need a held K′ token after an advance | Q's `relay.token.issued` (the prompt, or rule U), or an adoption | one round | P starts no reconnect meanwhile (G2-H rule 3) |
| Q's deposits to P's old mailbox past the grace | held (3.3) until the update arrives | as the first row | needs nothing from P beyond the update |
| Q's held messages while demoted or pending | as in 0.88.2 | one round | unchanged |

*The bound.* It is counted from P's second write, as S1 counts.
- **Normally,** Q has an epoch: the update arrives within `U`, and the
  token within `U` more. That is 2`U`.
- **With Q demoted,** add one round (4`U`) for the rekey or reconnect that
  gives Q an epoch. That is 5`U`.
- **The worst case** is a demotion reconnect that first waits one round
  behind Q's open rekey answer (7.8) and then runs a round of its own:
  about 9`U`.
- At `U` = 4 days that is 20 days normally and about 36 days at worst,
  which is past S1's 30 days.

So a pair at A3's limit can be made `stale` by S1 while it is still
converging. This is owner question 7.4. *Unsure* how often it happens; the
harness will tell. After μ = 0, 0.88.2's argument runs unchanged.

*What still ends `stale`, visibly.*
- 0.88.2's list;
- S1's 30 days, both for a recipient away longer than A3 and, unless 7.4
  changes it, for the worst case above;
- the gate's deadline;
- G4's slow path, if the harness finds it.

---

## 5. Other wait cycles with rotation on

**G3: S1's list does not get past the cut-off.**
- Once Q has followed, Table A refuses everything P deposits with K after
  the update (`superseded_relay`), including what S1 lets out: a
  reconnect's messages and `hs.confirm`.
- So 0.88.2's `hs.confirm` paragraph holds only "before that key's
  cut-off". The case it was written for, a Q that holds
  `relay.token.issued`, is a Q that has followed, so its `hs.confirm` is
  refused and Q's pending reconnect waits for `B`.
- The same happens to P's `hs.resp` to a reconnect `hs.init` that Q sent
  before it followed, when the `hs.resp` is deposited after the update.
  The try is lost.
- The trust model refuses an earlier key's `hs.confirm` after the cut-off
  in the same way.
- G1-A part 2 closes it, and G1-N closes part of it.
- It occurs only between two vaults (1.5).

**G4: both sides rotate within one hop (possible, not proven).**
- Q's `relay.token.issued` comes from Q's new mailbox, which P does not
  know yet. Rule T defers it, then refuses it, and it is lost until P's
  next resend.
- G2-H's rule 2 looks tokens up by connection, so an authenticated
  handshake still advances S2. *Unsure* whether Q's held tokens are then
  usable by P: rule T needs their `iss` to be known.
- This goes in the harness's G4 mode.

**G5: S2's restart needs a reconnect token for the new key.**
- Under G2-H, S2 advances at authenticated points, and the reconnect
  then completes or is established, so no restart is needed there.
- Rule 4 keeps carried-token entries on their own key.
- S2's own reconnect restart still needs an adopted reconnect token for
  K′. Without one, the reconnect is kept, not restarted (S2, clarified).

**H5 and the reconnect token's quota.**
- Each rotation of the `ik` restarts reconnects (H5).
- G1-N's mirror restart adds one deposit per relay rotation.
- G1-A adds none.
- A counter in the harness will confirm this (*unsure*).

**The gate.** It is bounded by its deadline, which ends in a visible
`stale`.

**Rule U and H5.** Rule U abandons no handshake. Under binding L, an
update can now trigger H5, because it carries `ik` links. That is the
same as an `identity.rotate`, which 0.88.2 argues. No further cycle found.

---

## 6. The harness plan (internal)

**What exists.**
- **The real code rotates no relay key.** `rotateIdentity` leaves it
  alone, `r29_a5_test.go` pins that, the `Relay` interface has no rotate
  call, and `hAddressUpdate` is the pre-0.85 receiving side.
- **The R29 random pair** (`vault/r29_random_test.go`) has these modes:
  default, `R29RP_BURST`, `R29RP_SHUFFLE`, `R29RP_REFRESH`, `R29RP_SPENT`
  and `R29RP_LOSTANS`. Replay uses `R29RP_TRACE` and `R29RP_REPEAT`. None
  of them rotates a relay key.
- **The ~90 in 10,000 came from the trust model:** `internal/trustmodel`
  on branch `r29-oracle` (PR #207), run with `TRUSTMODEL_RELAYROT=1`.
  - Its S1 list is `allowedWhileUnacked`, and its Table A refuses an
    earlier key's `hs.confirm` after the cut-off (G3).
  - `mintPass` mints a `hs.resp`'s tokens from P's current mailbox, which
    is G2-H rule 5's question.

**Steps.**
1. **Model first.**
   - Classify each `stale` run by mechanism: G1, G2, G3, G4, held-`hs.fin`
     without `B`, other.
   - Add each fix behind its own switch, so that each can be attributed:
     binding L, G2-B, G2-H rules 2 to 5, G1-A parts 1 to 4, and G1-N with
     the mirror restart.
   - Run `TRUSTMODEL_RELAYROT=1`, with and without `TRUSTMODEL_ROTBURST`,
     at 10,000 runs. Then run the deadlock-search scale of 100,000 per
     config.
   - Run the old-copy actor against G1-A with the binding switched off.
     It must break I3, which proves that the binding is load-bearing. It
     must hold with the binding on.
   - Add a device-pair config to confirm 1.5.
2. **The real code, on a branch that is not merged.**
   - The rotating side: the rotate call, the two writes and retries, S1 to
     S3, S7, S9, rule U with links and binding L, rule T, Table A's earlier
     rows, the gate, G2-H, G1-A, and the Q-side hold.
   - The stub relay needs: rotate (repeatable with the same key), the
     grace with collects from both mailboxes, tombstones,
     `mailbox_unknown` after the grace, and §5.3 step 7. Without step 7,
     G2 cannot appear.
3. **Mode `R29RP_RELAYROT`.**
   - The rotate action also rotates the relay key, on all three paths and
     in the decoupled cases: a gate-owed key and the next key after a
     pending one.
   - Crashes at C1, C2 and C2′, and a refusal fault (CR).
   - Locks around the grace.
   - A sub-mode where both vaults rotate within one hop (G4).
   - Oracles: I1 extended (μ = 0, nothing held by S1); I2; I5; an I3-lite
     (no message from an earlier key after its cut-off is accepted unless
     part 2's test holds); counters of S2 advances by kind, of
     reconnect-token deposits per rotation, and of the bound against S1's
     30 days.
4. **The bar.**
   - 0 `stale`, diverged or suspended honest runs outside accepted
     residuals, at 10,000 runs per mode: `R29RP_RELAYROT` crossed with
     every existing mode, and every existing mode without it, to show no
     regression.
   - Count from the `-v` class table (the `diverged:` lines and the lines
     that are not `converged`), and from each mode's counters, with
     `-test.v` for a prebuilt binary. A PASS exit status is not enough.
   - Before any zero is reported, show that each new oracle can fire: a
     known-bad seed, or the fix switched off.
5. **Residuals likely to go to the owner.**
   - S1's 30 days against the worst-case bound (7.4).
   - A recipient away beyond S1.
   - G4, if it fails.
   - The rapid-rotation rate under rotation, measured again.
   - The widened copy-counts-as-P window in the decoupled rotations (2.2).
   - The 30-day `mailbox_unknown` hold when a `connection.removed` notice
     is lost (3.3).

---

## 7. Owner questions

Each question gives its choices (labels of 24 characters or fewer), what
each costs, and a recommendation.

**7.1 How P learns that Q followed (G2).**
- a = `hybrid: advance on auth` (G2-H)
  - Cost: S2 gains authenticated triggers, and "Nothing else counts" is
    replaced by "nothing unauthenticated counts".
  - Same strength as today's signal.
- b = `signal unchanged + G2-B`
  - G2-B only; S2 still waits for `relay.token.issued`.
  - Closes G2 together with G1-A or G1-N. P's other traffic waits one
    more hop, for the prompt.
  - No change to the signal.
- c = `any token advances` (G2-A)
  - Cost: an old copy of Q can make a silent split.
- Recommendation: **a**. It is as safe as **b** and acknowledges sooner.
  **b** is acceptable if the owner wants the signal untouched.

**7.2 What passes Q's cut-off (G1, G3).**
- a = `signed hs msgs pass` (G1-A)
  - Cost: one Table A cell, S1's list, and I3's wording, for pairs of
    vaults only.
  - Closes G1 and G3.
- b = `hs.confirm + Q restart` (G1-N)
  - Cost: G1 still waits up to 16 days unless combined with c.
  - Smaller change to Table A; one more reconnect deposit per rotation.
- c = `drop rekey answers` (G1-C)
  - Cost: wasted rekeys, and a change to a release-29 responder rule.
- Recommendation: **a**.

**7.3 Binding the `ik` to the relay link (needed by 7.2 a or b).**
- a = `ik links in the update` (binding L)
  - Cost: the update's handler runs the identity follow path.
  - It also delivers the links.
- b = `ik in the relay link` (binding R)
  - Cost: a new signed format and vectors, and a rule for an `ik` Q has
    not reached yet.
- Recommendation: **a**.

**7.4 S1's 30 days against the convergence bound (worst case about 36
days at `U` = 4).**
- a = `pause S1 during a hs`: S1 does not judge while a handshake with Q
  is open or pending. Those are bounded by `L` and `B`.
  - Cost: a late `stale` can come up to 30 + 32 days.
- b = `S1 of 45 days`: a longer clock for every rotation.
  - Cost: P keeps the old key longer (no cost against a copy, which
    already has it). Visible ends come later.
- c = `tighten A3`: assume `U` ≤ 3 days. Nothing changes in the spec.
  - Cost: members locked 3 to 4 days in a row end `stale`.
- Recommendation: **a**. *Unsure* until the harness has a distribution.

**7.5 The relay's grace against a crash between the rotate and the second
write.**
- a = `Q holds mailbox_unknown`: the Q-side hold of 3.3.
  - Cost: up to 30 days of held messages if a `connection.removed` is
    lost.
- b = `grace of 14 days`
  - Cost: an old copy keeps the old mailbox twice as long, at every
    rotation. It is a relay-wide setting.
- c = `accept as residual`
  - Cost: a C2 crash followed by a long lock loses deposits and can end
    `stale`.
- Recommendation: **a**.

**7.6 How to meet "search on the real code".**
- a = `model, then code branch`
  - Cost: the model's switches first.
  - Attribution in hours.
- b = `code branch only`
  - Cost: slower attribution.
- Recommendation: **a**. The real code has no rotating side, so the code
  has to be built before any search on it.

**7.7 0.88.2's `hs.confirm` paragraph, wrong after the cut-off (G3).**
- a = `fix in the redesign PR`
  - Cost: none in release 29, which builds no rotation.
- b = `erratum now`
  - Cost: a spec round now.
- Recommendation: **a**.

**7.8 Does an open answer to P's rekey hold Q's demotion reconnect?**

The text of §6.6 "Between two persons" ("starts no reconnect of its own
while an answer of its awaits `hs.fin`") is read both ways.
- a = `yes, keep the hold`: state it.
  - Cost: none under G1-A, whose `hs.fin` ends the answer within a round.
  - Under G1-N, up to `L`.
- b = `drop answer at demotion`: G1-C.
  - Cost: wasted rekeys.
- Recommendation: **a** with 7.2 a; **b** if 7.2 is b.
