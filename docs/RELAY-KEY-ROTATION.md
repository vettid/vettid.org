# Relay-key rotation without wait cycles: design note (draft 3)

For the owner and the lead. This note is checked against VAULT-MESSAGING
0.89.0 (origin/master). The quoted sections are the same text as in
0.88.18; they are only 35 lines further down. RELAY-PROTOCOL is read on the
same master. Sections 1 to 5 are written to move into the spec; sections 6
and 7 are internal.

Words used throughout:
- **P** rotates its relay key from K to K′. **Q** is one of P's
  recipients.
- **P's key for Q** is S1's term: the key P deposits to Q with.
- **Q has followed** means Q has applied a relay link K→K′, by rule U or
  by 2.4 below. From then on K is "earlier" at Q, with a **cut-off**.
- **S1 toward Q** is the time during which P's key for Q is not P's
  current key.

## Changes since draft 2

| Item | Change | Where |
|---|---|---|
| High 1 (S9 and the failed try) | New gap G6. During S1, `token_revoked` on a reconnect token for K is no failed try. S9 waits one round. Added to the liveness table and the harness stub, and asked as an owner question | 1.6; 2.5; 4; 6; 7.7 |
| High 2 (P has no epoch at its second write) | New gap G7. P's reconnect carries the relay links and announces K′ (2.4); a longer grace is the alternative. Asked as an owner question | 1.7; 2.4; 4; 7.5 |
| Medium 3 (G1-A widens a residual) | The pass is narrowed to messages from K before the first message Q accepts from K′. The residual that remains is stated | 2.2; 2.3 |
| Medium 4 (the bound; whether a rekey answer holds the reconnect) | Checked in the vault code: only answers to **reconnects** hold Q's reconnect (B is right). The bound is recomputed for one rotation and for both sides rotating (A's case). The recommendation moves to G1-N. 7.8 is now "spec follows the shipped code" | 1.3; 2.2; 4; 7.2; 7.8 |
| Medium 5 (7.4 a was unbounded) | The pause now needs evidence from Q, with a cap; the cost is corrected | 7.4 |
| Medium 6 (`t_r`, A2, Φ) | `t_r` is redefined and the gate deadline added. A2 now reads A3. Φ gains ν ("Q followed") | 4 |
| Medium 7 (the Q-side hold) | It is conditioned on no newer update. Held entries are no failed tries. The silent loss of deposits P never collected is listed, with a proposed way to tell Q | 3.3; 7.6 |
| Low: "same bar" wording; `hs.resp` tokens bound by HPKE | Fixed | 2.1 |
| Low: G4 with an unknown `iss` | Argued, and put in the G4 harness mode | 5; 6 |
| Low: part 3 restart | Restarts only if no epoch was established since the rekey began (G1-A) | 2.3 |
| Low: binding L can demote Q | Stated in the "Q following" row | 4 |
| Low: the order of S2's restart in the establishing write | Stated | 2.1, rule 6 |
| Low: rule 5 after the grace | The `hs.resp` carries no tokens | 2.1, rule 5 |
| Low: rule U revokes the carried reconnect token of Q's open reconnect | The mirror restart makes that Q's own abandonment; P never adopts it | 2.2 |
| Low: G2-B covers most of G3 | Stated; it shapes 7.2 | 2.2 |
| Low: the device's refused `hs.confirm` | It resolves; not a cycle | 1.5 |
| Nits | I3 wording, the 1.1 citation, the `hs.fin` links wording, and a crash row for the recovery's fresh key | 2.3; 1.1; 2.3; 3.2 |
| Resolved: the deployed grace; the reason for "Nothing else counts"; K9 at the update | Folded in, with the owner told plainly what 7.1 and 7.2 re-decide | 3.3; 2.1; 2.2; 2.6; 7.1; 7.2 |

---

## 1. The gaps

### 1.1 What "demoted" means

"Demoted" is a state of an epoch (§3.4.1). An epoch is demoted in three
ways:
- by position: "Epochs after an `ik` link", where the epoch "stops being
  current (if it was)";
- by "Strict F1";
- from the start, by a link: §3.4.1 "Pending epochs at a link" ("Such an
  epoch is demoted from the start").

A **demoted Q** is a Q in the state of §3.4.1 "After a demotion of the
current epoch". Q has no current epoch with P, sends "nothing but
handshake messages", and holds its durable messages. That includes
`relay.token.issued`, which also has no epoch to be sealed under, because
earlier epochs' send keys are erased (§6.5 "Key retention").

A Q whose own reconnect is **pending** is in the same position (§6.3.1
Initiator), and usually has no valid standing token either.

These demotions are honest, and they happen around `ik` rotations. For
example: P's rekey is pending at P and active at Q, and then P rotates.
S5 abandons the pending epoch, P's `identity.rotate` travels under the
earlier epoch E, and strict F1 demotes Q's epoch.

### 1.2 The rules involved

- **§3.4 "The signal".** "received from it `relay.token.issued` for the
  new `sub` ... Nothing else counts". This is owner decision "gap 1" of
  2026-11-05 (the 0.85.0 draft, vettid.org at c7ee8f7, built in
  vettid-vault #203), on the premise of vettid.org #536 decision O1a.
- **S1.** "P deposits to Q only with it", and S1's list of messages that
  may still go out.
- **S2.** P's key for Q advances "when Q's token arrives".
- **S3.** Tokens name "Q's relay key as P knows it".
- **S9.** If P gets `token_revoked` on a token Q issued to an earlier key
  of P that is still P's key for Q, and Q's token for P's current key has
  not arrived "24 hours after" P's next short collect, P raises a fork
  alarm.
- **Rule U.** Q sends `relay.token.issued` "After that write", and
  "revokes the reconnect tokens it issued to the passed keys".
- **§6.3.1.** The handshake's own messages are "each deposited with the
  carried standing token".
- **RELAY-PROTOCOL §5.3 step 7.** "`X-VettID-Key` == token `sub`".
- **Table A, row "Earlier, after its cut-off".** Everything is refused
  (`superseded_relay`) except the update, the tokens of
  `relay.token.issued`, and an `identity.rotate` whose links are all
  already followed.
- **Table A's preamble.** An `hs.init` whose `sender` is not its
  `from.relay.pk` is refused.
- **The update carries relay links only.** `identity.rotate` travels
  separately, and §8.4 does not order the two.
- **RELAY-PROTOCOL §6.7.** The old mailbox lives for the grace after the
  **rotate**. The relay's default is 7 days, and the deployment does not
  override it.

### 1.3 G1: a rekey's `hs.fin` against a demoted Q

1. **P's first write.** P's new `ik` is current and K′ is pending.
   `identity.rotate` goes out. S5 restarts P's rekey under the new `ik`;
   its `hs.init` is deposited with K.
2. **Q is demoted.** Q follows the `ik` link, and strict F1 demotes Q's
   current epoch.
3. **Q answers P's rekey.** The rekey names Q's confirmed epoch, which is
   "accepted as if it were current".
4. **P's second write.** S1 is now active toward Q, and P deposits the
   update with K.
5. **Q follows the update.** Q's `relay.token.issued` for K′ is **held**,
   because Q is demoted.
6. **P's `hs.fin` is held.** S1 holds the rekey's `hs.fin`; it would also
   land after the cut-off if it were let out.

Q gets a current epoch either from that `hs.fin` (held), or from its own
demotion reconnect.

**Whether the rekey answer holds Q's reconnect.** In the shipped vault it
does not. `startReconnectCtx` refuses to start only while
`answeredReconnects` is non-empty, which lists answers to **reconnects**
only; `canReconnect` does the same. So Q's demotion reconnect starts at
once, and G2 (and, in some orders, G3) is what breaks it. G1 is therefore
a cycle only together with G2 and G3; G1 alone is a held message.

**How it ends.** At P, nothing bounds the held `hs.fin`. `B` runs "from
`hs.fin`" and starts "Once `I` has sent `hs.fin`", and the 16-day initiator
lifetime covers only "awaiting `hs.resp`". This is confirmed unbounded.
At Q, the answer expires at `L`, and Q's reconnect tries fail by G2. The
pair ends `stale` by "The reconnect bound", or by S1's 30 days.

### 1.4 G2: the answer to Q's reconnect

- Q has followed, so Q's `hs.init` carries tokens with `sub` = K′ (S3).
- P deposits its `hs.resp` with the carried token, using K (S1).
- The relay refuses it (`signature_invalid`, §5.3 step 7).
- Even if it did not, Q would refuse it (`superseded_relay`).

Every try expires after 16 days, and the third failure makes the pair
`stale`.

### 1.5 Device pairs

- A vault never demotes a device's epochs and never reconnects to a
  device. A device demotes nothing and starts no rekey or reconnect. So G1,
  G2, G3, G6 and G7 occur only between two vaults.
- **A device as P.** The device's `hs.resp` to the vault's rekey is not on
  S1's list. It waits for the vault's `relay.token.issued`, which comes at
  once (the vault always has a current epoch with the device).
- **The device's `hs.confirm`.** It is on S1's list. If it lands after the
  vault's cut-off, the vault refuses it. The vault's rekey epoch then stays
  pending, but the vault still sends its token. S2 advances, and the
  device re-sends `hs.confirm` (per batch, or after 12 days) with K′. That
  is a delay, not a cycle.
- **A device as Q.** It is never demoted and never pending, so its token
  goes out at once.

### 1.6 G6: the revoked reconnect token and S9 (new)

Q follows P's update, and rule U revokes the reconnect tokens Q issued to
K. Suppose P now has no current epoch with Q, or its standing token has
expired, during S1. P reconnects with the reconnect token for K and gets
`token_revoked`.
- §8.6 makes that a failed try under "The reconnect bound".
- If Q is demoted, its `relay.token.issued` stays held for more than 24
  hours, so S9 raises "may have connected to an old copy of your vault"
  in an honest run.
- After three such tries, P makes the pair `stale`.

### 1.7 G7: P has no current epoch at its second write (new)

- The update is a session message, so P holds it while P is demoted or
  its reconnect is pending.
- P's only way back to an epoch is a reconnect. Today that reconnect
  announces K and is deposited with K, so Q answers into K's mailbox.
- That mailbox dies 7 days after the rotate, while a round can take up to
  16 days (A3).
- After that, nothing carries K′ to Q. The resends of §3.4 (b) are updates
  and are still held. Q's deposits to K's mailbox fail with
  `mailbox_unknown`.
- This is not a crash case, and a 14-day grace does not cover it either.

---

## 2. The design

None of this changes behaviour that release 29 builds (A5). The places
where it extends a release-29 rule are named below.

### 2.1 G2: the hybrid G2-H (recommended)

1. **Deposit key of a carried token.** A message on a carried token
   (`hs.resp`, `hs.fin`, `hs.confirm` and its re-sends) is deposited with
   the key that token's `sub` names, if P still holds that key. This is
   G2-B. If P no longer holds it, the answer is dropped, as under rule J,
   and Q's next try names K′.
2. **When S2 advances.** S2 also advances, to the newest of P's keys
   named by a token from Q, when the token comes in:
   - a reconnect `hs.init` from Q whose `hs.fin` P has verified (`sig_I`,
     at establishment);
   - an `hs.resp` from Q that P accepts. Its tokens are bound to the
     handshake by its HPKE context (sealed to P's ephemeral key), not by
     `sig_R`. P accepts the `hs.resp` only after `sig_R` verifies;
   - an adoption, or `relay.token.issued`.

   Tokens are matched to Q by the connection, not by `iss`.
3. **No reconnect while carried tokens wait (P's side).** While P holds
   undiscarded carried tokens from Q that name a key P holds, P does not
   take §8.6's "no valid standing token" path. This extends a release-29
   rule, and only during S1.
4. **S2's re-deposit.** It re-deposits only entries on held tokens.
   Entries on carried tokens keep their own token's key (rule 1). An entry
   that needs a held token for K′ waits for one.
5. **Tokens P puts in a handshake message during S1.** They are minted by
   the mailbox of the key the message is deposited with. Past the grace,
   K's mailbox no longer exists, so an `hs.resp` deposited with K carries
   **no** tokens: Q keeps its held tokens and adopts none. P's tokens for
   K′ then reach Q with the update or with P's reconnect (2.4).
6. **Order in an establishing write.** In the write that establishes Q's
   reconnect at P, the establishment runs first: it ends P's own crossing
   reconnect and pending epoch (§6.3.1, §6.6). S2's advance runs after, and
   any restart it makes applies only to handshakes still open then.

**Security.** An advance needs Q's `ik` or Q's epoch keys: the same bar as
an authenticated handshake with Q. It is not quite the bar of
`relay.token.issued`. A copy of Q taken after Q's last `ik` rotation but
before Q's last rekey can sign a handshake, but cannot seal under Q's
current epoch. Such a copy already counts as Q (§3.4.1 Residuals, the
case of a copy taken after a rotation's first write). An unauthenticated
token only picks the deposit key for its own handshake's messages. G2-A
(any verified token advances S2) stays rejected: it lets an old copy of Q
split the pair silently.

**What this re-decides.** "Gap 1" (2026-11-05) said nothing but
`relay.token.issued` counts. Its premise, from #536 O1a, is read here as
"the acknowledgment must prove that Q followed". A token Q minted that
names K′ proves that, and G2-H accepts one only at an authenticated
point. The owner is asked to re-decide gap 1 in this form (7.1).

### 2.2 G1 and G3: G1-N (recommended now)

The shipped vault does not hold Q's demotion reconnect behind a rekey
answer (1.3). So G1 already has an exit through Q's reconnect once G2 is
fixed. What remains is G3 and the bound at P. G1-N:

**N1. Q's mirror of S2.** When Q follows a relay link, it abandons each of
its open reconnects whose `hs.init` carried tokens naming the passed key
and that has not yet sent `hs.fin`, and starts it again.
- The abandonment revokes that handshake's carried tokens, as Q's own step
  (§6.3.1 "Revocation by the issuer"). So rule U's revocation of the
  reconnect tokens issued to K and Q's own abandonment are one act. P
  never adopts the revoked token.
- The new `hs.init`'s tokens name K′.
- Cost: one more deposit on Q's held reconnect token for each relay-key
  rotation that Q follows mid-reconnect. *Unsure* how this interacts with
  the rapid-rotation residual; the harness counts it.

**N2. `hs.confirm` passes the cut-off.** In Table A, row "Earlier, after
its cut-off", an `hs.confirm` goes on to processing (it confirms) when
both of these hold:
- the epoch it travels under was established with epoch keys signed under
  Q's current `ik` for P (binding L, 2.6);
- Q has accepted no message from P's newer key yet (2.3's narrowing).

**N3. A held `hs.fin` starts `B`.** The epoch becomes pending, and `B`
runs, from the write that queues the `hs.fin`. This is needed; 1.3 shows
the wait is otherwise unbounded.

**N4. Q's stale answers to P's rekeys.** In the write that confirms its
reconnect, Q drops its open answers to P's rekeys. This mirrors "A
reconnect ends R's rekey answers" (§6.3.1), which is the responder's rule.
Otherwise the answer from 1.3 step 3 holds Q's rekeys back until `L`
(liveness only, like the stated residual "A stale rekey `hs.init`
redelivered after a reconnect").

**Which G3 cases G1-N covers:**
- Q followed **before** its `hs.init`: the tokens name K′, and G2-B sends
  P's answer and `hs.confirm` with K′.
- Q followed **after** its `hs.init` and before its `hs.fin`: N1 restarts
  the reconnect.
- Q followed **after** its `hs.fin` (pending): P's `hs.confirm` rides a
  token naming K, after the cut-off. That needs N2. It is the only case
  that does.
- P's own rekey `hs.fin` stays held until S2 (not on S1's list).
  - If Q has an epoch, Q's token comes and S2's existing re-deposit sends
    the `hs.fin`.
  - If Q is demoted, Q reconnects. Its establishment at P ends P's
    pending rekey epoch, and the held `hs.fin` is dropped with it (§6.3.1:
    "drops its `hs.fin` for the epoch that it does not know to have been
    accepted").
- A narrow order stays slow, and is bounded by one try. Q processes P's
  update between answering P's reconnect and receiving P's `hs.fin`, so
  P's `hs.fin` with K lands after the cut-off. Under 2.4, P's reconnect
  carries the links, and Q follows only at that `hs.fin`. This order
  arises only when an update deposited earlier is processed late.

**What this reverses.** O1a ("refuse what comes from an earlier key after
its cut-off") is reversed for `hs.confirm` only. The owner is told so
in 7.2.

### 2.3 G1-A (the broader alternative)

- **Part 1.** S1 also lets out a rekey's `hs.init`, `hs.resp` and `hs.fin`.
- **Part 2.** These pass the cut-off when the epoch they travel under, or
  their handshake, is authenticated by epoch keys signed under Q's current
  `ik` for P:
  - an `hs.resp` or `hs.fin` for a handshake Q has open (its `sig_R`
    verifies, or its `sig_I` verifies under the `ik` Q's answer pinned
    after the `hs.init`'s links were applied);
  - an `hs.confirm`;
  - a session-mode rekey `hs.init`.
- **Part 3.** When S2 advances, P restarts its rekeys that went with K and
  have had no `hs.resp`. It does this only if no epoch with Q has been
  established since that rekey began, so that Q's in-flight answer is not
  stranded.
- **Part 4.** As N3.

**The narrowing (applies to G1-A and to N2).** The pass holds only until Q
first accepts a message from P's newer key. After S2, P deposits with K′
using a held K′ token, so an honest P no longer needs the pass.

**The residual G1-A leaves.** Take a decoupled rotation: the gate-owed
key, or the next key K2, generated after the `ik` that is current. A copy
taken between that `ik`'s write and the relay key's first write holds
both that `ik` and K. Until the narrowing closes the pass, it can run a
whole session-mode rekey with Q through K after the cut-off. It already
counts as P (§3.4.1 Residuals), and the next `ik` rotation ends it. Under
G1-N the same copy can only confirm an epoch, which the existing residual
"An old copy ... can confirm Q's pending epoch as P" already covers.

**I3's wording, if G1-A or N2 is taken.** "... except tokens that pass
rule T, duplicates of followed links, and (until Q first accepts a
message from P's newer key) a handshake message or `hs.confirm` under
epoch keys signed under Q's current `ik` for P, which a copy taken before
that `ik` was written cannot make." Under G1-N the text is the same, with
`hs.confirm` only.

### 2.4 G7: P's reconnect carries the relay links (recommended)

- **Spec change.** During S1, P's reconnect `hs.init` names its **current**
  key in `from.relay` (K′), and carries `relay_links` from its `sender`
  (K) to K′, plus binding L's `ik` links (`rotations` already carries
  those). It is still deposited with K.
- **Table A.** The preamble's sender check gives way when the links
  connect `sender` to `from.relay.pk` and pass rule C. Table A then
  accepts the message from K **before or after** K's cut-off, whenever
  `from.relay.pk` is Q's current key for P, or is reached by these links.
- **When Q follows.** Under rule U's checks, Q follows these links at the
  verified `hs.fin`, when the reconnect is established; a reconnect
  `hs.init` changes no state before `sig_I` (§6.6). The cut-off is that
  `hs.fin`'s position, so the `hs.fin` itself, deposited with K, is
  accepted.
- **Where Q answers.** Q answers into K′'s mailbox (`from.relay`), using
  the `hs.init`'s carried tokens, which K′'s mailbox minted (rule T: `iss`
  = the mailbox of `from.relay`).
- **Safety.** Both of a link's signatures are made by P's relay keys in
  the rotation's first write. A copy taken before that write cannot make
  them. A copy taken after it counts as P. A reconnect `hs.init` from K
  after the cut-off that does **not** carry the links stays refused, so
  the cap on answers is not opened to copies taken earlier.
- **Effect.** P no longer needs K's mailbox, or a current epoch, to tell
  Q the new address.
- **Alternative.** The relay keeps the old mailbox while a recipient has
  not acknowledged. Cost: an old copy keeps the live old mailbox for that
  whole time, at every rotation. It is also a change to the relay
  protocol.

### 2.5 G6: the revoked reconnect token during S1

- **Spec change.** During S1 toward Q, `token_revoked` on a reconnect
  token for an earlier key of P is no failed try under "The reconnect
  bound", and does not start S9 on its own. P stops trying on that
  token and waits for Q's reconnect or Q's token. That wait is bounded by
  4's table.
- **S9.** S9's wait becomes one round (16 days, `L`) instead of 24 hours,
  counted as today. An honest demoted Q acknowledges within a round
  (G2-H, N1). A real fork is still seen, two weeks later. And S1's stale
  catches a Q that never acknowledges anyway.
- **Owner question:** 7.7.

### 2.6 Binding L: the update carries P's `ik` links (recommended)

- **Spec change.**
  - The update carries `rotations` as S8 gives an `identity.rotate`: P's
    links from the signer of the epoch it travels in up to P's current
    `ik`. They are made again at each resend.
  - Q applies them first, in the same write, exactly as an
    `identity.rotate`'s links: rule C, Table B, H5, the demotion rules,
    and R29-K9's judgment.
  - If Table B refuses one, Q follows no relay link from that update.
- **What it guarantees.** At every cut-off, Q's current `ik` for P is at
  least the one P held when it made the update. That is at least the one
  current at the relay link's first write. So no copy taken before that
  write passes N2, G1-A's part 2, or 2.4.
- **R29-K9 at the update.** It is probably sound: the update is sealed
  under P's current epoch, as `identity.rotate` is, so K9's argument
  carries over. To be modelled (6).
- **Effect on Q.** Q may itself be demoted by these links (strict F1).
- **Alternative, binding R.** The relay link's signed body names the
  `ik`. It needs a new format and vectors, and does not deliver the links.

---

## 3. The crash order between the relay's rotate and the state write

### 3.1 What §3.4 says

"The vault **stores first, then rotates, and retries with the same
key**". This holds for all three paths. The one exception is a recovery's
fresh key after a refused registration, which is registered before any
state holds it.

### 3.2 What each crash point leaves

| Crash point | State | Relay | Next unlock | Lost |
|---|---|---|---|---|
| C0: before the first write | K current; an owed mark, if one was written | the old mailbox | the mark retries; a `credential.rotate` is the member's to ask again | nothing |
| C1: after the first write, before the rotate | K current, K′ pending; new `ik` current, `identity.rotate` sent | the old mailbox | the rotate, with the same K′ | nothing |
| C2: after the rotate, before the second write | as C1 | both mailboxes; the grace runs from the rotate | the rotate again, then the second write; past the grace, `mailbox_unknown`, then register (`200` goes on; `201` re-mints every token) | locked past the grace: the old mailbox's uncollected deposits, and later deposits refused until the second write (3.3) |
| C3: after the second write, before the updates go out | K′ current, K kept for deposits only | both mailboxes | the outbox delivers the updates | nothing |
| C2′: after K1's second write, which also stores K2 (a relay-key rotation owed) | K1 current, K2 pending, the relay-key mark cleared | K1's mailbox; K's in its grace | as C1 for K2 (the rotate signed by K1) | nothing |
| CR: after a definite refusal, before the write that records it | as C1 or C2 | unchanged | refused again, then that write | nothing; the audit comes one unlock later |
| CF: a recovery's fresh key, registered before any state holds it; crash before step 2's write | the inherited key, refused | an empty mailbox nobody announced | the open is retried; a new fresh key | an orphaned empty mailbox (within the relay's limit of 3; stated in §3.4) |

### 3.3 Is the rule complete?

**Safety: yes.** I5 holds and the key is the same at every retry.

**Liveness: the deposits to the old mailbox need a rule.** The grace runs
from the rotate. The updates go out at the second write, which can come
`U` later, and Q needs one more hop to follow.

**Proposed hold on Q's side (recommended).** While the connection is
active, and Q has received no update from P naming a mailbox newer than
the refused one since the first refusal:
- a deposit to P's mailbox refused `mailbox_unknown` is **held**: not
  ended (`drop.undelivered_mailbox_unknown`, §8.3), no failed try, and no
  reason for `stale`;
- the hold ends when an update re-addresses the entries (rule U), when the
  connection ends, or 30 days after the first refusal. Then §8.6 applies
  as today.

**A residual the hold cannot fix (new).** Q's deposits that the relay
accepted (`201`) into K's mailbox, which P never collected before the
mailbox died (C2 followed by a lock past the grace), are lost **silently**.
Proposed way to tell Q:
- After a C2 that ran past the grace (the rotate answered
  `mailbox_unknown`), the update carries `old_collected_to`: the time up
  to which P collected K's mailbox.
- Q tells its member of every durable deposit into K's mailbox made after
  that time and not answered, as `message.delivery_unconfirmed` (§8.3).
- *Unsure* that P can know the time exactly. It is its last short collect
  of K's mailbox before the crash, which P stores.
- Owner question: 7.6.

**The grace.** The deployment does not set it, so the relay's code default
of 7 days applies. A longer grace doubles the time an old copy holds the
live old mailbox, at every rotation, and still does not cover G7.

The second write should also list its S1 state: P's key for Q per
recipient, and the start of S1's clock.

---

## 4. Liveness argument sketch (G2-H, G1-N, binding L, 2.4, 2.5, the Q-side hold)

This is in the style of §3.4.1 "Liveness between honest vaults (0.88.2)",
for pairs of vaults. Device pairs are covered by 1.5.

*Assumptions.*
- A1 to A4 as in 0.88.2. **`t_r`** is the last write by either side that
  stores a key: an `ik`, or a relay key, including a gate-owed key and the
  next key after a pending one.
- **A5′.** Relay keys rotate, both sides advertise `relay_follow`, and the
  gate's deadline (30 days after its mark) bounds when a gate-owed key is
  stored. So `t_r` is at most the deadline after the last `ik` rotation.
- **A6.** The Q-side hold (3.3).
- **A7.** No definite refusal of a rotate (that is the refused state,
  which is visible).

*Progress measure.* Φ = (π, ν, μ, λ, δ, ρ), compared in that order:
- π: pending relay keys;
- ν: (side, recipient) pairs where the recipient has not followed the
  side's current relay key;
- μ: pairs where the side's key for the recipient is not its current key;
- λ, δ, ρ: as in 0.88.2.

After `t_r`, nothing adds to π, ν or μ: following and S2 only advance.

*Why the order is sound.* Every step that raises a later component lowers
an earlier one:
- Under binding L, following a relay link also follows the `ik` links, so
  δ and ρ rise only when ν or λ falls.
- H5, the demotion rules and N1's restart fire only at a link (ν or λ
  falls).
- S2's restarts fire only at an advance (μ falls).

*Step 0.* π reaches 0 within `U` of `t_r`: one attempt is made at every
unlock (A3), and the relay answers it (A2).

*Step 1.* ν reaches 0 within 2`U` after the second write, or within one
round if P has no epoch:
- The update is let through by S1, and resent at each unlock.
- While P has no epoch, P's reconnect carries the links (2.4).
- Q follows them with their `ik` links (binding L), so λ also reaches 0 by
  `t_r` + 3`U`, as in 0.88.2.

*Step 2.* μ reaches 0. Every wait names what ends it:

| Wait | Ended by | Bound | Why no cycle |
|---|---|---|---|
| The update reaching Q | S1 lets it through; resent at each unlock. While **P** has no current epoch it is held, and P's reconnect carries the links instead (2.4) | `U`; with no epoch at P, one round | needs nothing from Q's acknowledgment |
| Q following | rule U or 2.4, with binding L. The `ik` links can demote Q (strict F1); Q then acknowledges by the next row's (b) | one hop (2.4: at the reconnect's `hs.fin`) | needs nothing more from P |
| Q's acknowledgment | (a) `relay.token.issued`, if Q has an epoch; (b) a demoted Q reconnects at once (no hold behind a rekey answer, 1.3), N1 restarts that reconnect if Q followed mid-reconnect, G2-H rule 1 makes the answer deliverable, and S2 advances at the verified `hs.fin` (rule 2); (c) a pending Q confirms on P's `hs.confirm` (N2), then (a) | one round + one hop / "The reconnect bound" | Q never waits for a message P holds for want of Q's acknowledgment |
| P's reconnect on the revoked K token | not a try (2.5); P waits for the row above | the row above | the revocation is Q's own act of following |
| P's held rekey `hs.fin` | S2's re-deposit; or dropped when Q's reconnect ends P's pending epoch; `B` from the queued write (N3) | one round / `B` | — |
| P's entries held by S1 | S2's advance | above | every handshake message passes S1, or else is not needed (the held rekey `hs.fin`) |
| P's entries needing a held K′ token | Q's `relay.token.issued` (the prompt, or rule U) | one hop after the advance | P starts no reconnect meanwhile (rule 3) |
| Q's deposits to K's mailbox past the grace | held until the update (3.3) | as the first row | — |
| S9 | waits a round (2.5) | 16 days | not a wait of the pair |

*The bound.* Counted from P's second write `w`, the clock S1 uses:
- **One side rotates.** The update takes ≤ `U` and Q's token ≤ `U`, so 2`U`.
  With Q demoted: the update `U`, then a reconnect round of 4`U` whose
  `hs.fin` advances S2 at its third hop, so about 4`U`. With P demoted
  (2.4): one round plus a hop, about 5`U`. Worst case about 5`U`, which is
  20 days at `U` = 4, inside 30.
- **Both sides rotate `ik`s, and P's relay key.** Q may lack a current
  epoch until 0.88.2's settling. That ends by `t_r` + 12`U`, then a hop for
  the token: `t_r` + 13`U`. P's `w` can be as early as the first of these
  rotations, so `w` + 13`U` or more, past 52 days at `U` = 4.
- So S1's fixed 30 days cannot be shown to hold under A3 when both sides
  rotate. That is 7.4.

*What still ends `stale`, visibly.*
- 0.88.2's list;
- S1's clock, as decided in 7.4;
- the gate's deadline;
- G4's slow path, if the harness finds one.

---

## 5. Other wait cycles with rotation on

- **G3.** S1's list does not get past the cut-off. Covered by 2.2 (N1,
  N2) or 2.3.
- **G4: both sides rotate within one hop.**
  - Q's `relay.token.issued` comes from Q's new mailbox, which P does not
    know yet. Rule T defers it, then refuses it, and P's resend replaces it.
  - Under G2-H, an authenticated handshake advances S2 even when the K′
    tokens it carries have an `iss` P does not know. Rule 2 matches them
    to Q by the connection.
  - P cannot yet use such a token: rule T keeps it only once P has
    followed Q's update. Q's update is let through by Q's own S1, so the
    wait is one more hop. Argued as bounded; it is checked in the harness's
    G4 mode.
- **G5: S2's restart without a K′ reconnect token.** Kept, not restarted
  (G2-H rules 4 and 6).
- **G6, G7.** Section 1, fixed in 2.5 and 2.4.
- **H5 and the reconnect token's quota.**
  - N1 adds at most one restart per followed relay link mid-reconnect.
  - 2.5 removes the failed tries on revoked K tokens.
  - *Unsure* about the effect on the rapid-rotation residual; the harness
    counts it.
- **The gate, rule U, H5.** No further cycle found. The gate ends at its
  deadline (visibly). Rule U abandons no handshake except N1's restart,
  which is Q's own. Binding L makes an update an `ik`-link carrier, which
  0.88.2 already argues.

---

## 6. The harness plan (internal)

**What exists.**
- The vault code has no rotating side. `rotateIdentity` leaves the relay
  key alone, a test pins A5, the `Relay` interface has no rotate, and the
  receiving `hAddressUpdate` is pre-0.85.
- The random-pair harness's modes: default, `R29RP_BURST`,
  `R29RP_SHUFFLE`, `R29RP_REFRESH`, `R29RP_SPENT`, `R29RP_LOSTANS`, plus
  `R29RP_TRACE` and `R29RP_REPEAT` for replay. None rotates a relay key.
- The ~90 in 10,000 came from the trust model, `TRUSTMODEL_RELAYROT=1`, on
  the vettid-vault branch `r29-oracle` (#207). Its S1 list is
  `allowedWhileUnacked`, its Table A refuses an earlier key's `hs.confirm`
  after the cut-off (G3), and its `mintPass` mints an `hs.resp`'s tokens
  from P's current mailbox (G2-H rule 5).

**Steps.**
1. **The model first.**
   - Classify the `stale` runs by mechanism: G1, G2, G3, G6, G7, the held
     `hs.fin`, other.
   - Put each fix behind its own switch: G2-H rules 1 to 6, N1 to N4,
     G1-A parts 1 to 4 with the narrowing, 2.4, 2.5, binding L (with K9 at
     the update), and the Q-side hold.
   - Model the shipped reading that a rekey answer holds no reconnect.
   - Run `TRUSTMODEL_RELAYROT=1`, with and without ROTBURST, at 10,000
     runs, then 100,000.
   - The old-copy actor must break I3 with binding L off, and hold with it
     on.
   - Add a device-pair config (1.5).
2. **The real code on a branch that is not merged.**
   - The rotating side, rule U with binding L, Table A's earlier rows,
     G2-H, G1-N, 2.4, 2.5 and the hold.
   - The stub relay needs: rotate (idempotent with the same key), the grace
     with collects from both mailboxes, tombstones, `mailbox_unknown`
     after the grace, §5.3 step 7, and **the denylist**. Without the
     denylist rule U's revocation and G6 cannot show.
3. **Mode `R29RP_RELAYROT`.**
   - Rotations on all three paths, plus the decoupled ones (a gate-owed
     key, K2 after a pending key).
   - Crashes at C1, C2, C2′, CR and CF.
   - Locks around the grace; P demoted at its second write (G7).
   - A G4 sub-mode: both sides rotate within one hop, including K′ tokens
     with an unknown `iss`.
   - Oracles: I1 extended (ν = μ = 0, nothing held by S1); I2; I5; I3-lite
     (nothing from an earlier key after its cut-off is accepted beyond N2
     or part 2, and never after Q accepted from the newer key); no S9 feed
     item in an honest run; counters of S2 advances by kind, reconnect-token
     deposits per rotation, and `w` to μ = 0 against S1's clock.
4. **The bar.** 0 honest runs `stale`, diverged or suspended outside
   accepted residuals, at 10,000 runs per mode, for `R29RP_RELAYROT`
   crossed with every existing mode, and every mode without it. Counted
   from the `-v` class table and the counters (`-test.v` for a prebuilt
   binary); a PASS exit status is not enough. Every new oracle is first
   shown to fire.
5. **Likely residuals.**
   - S1's clock, per 7.4.
   - A recipient away beyond it.
   - G4, if it fails.
   - The rapid-rotation rate, measured again.
   - The decoupled-rotation copy (2.3, narrower under G1-N).
   - The C2 deposits P never collected, unless 7.6 a is taken.
   - The 30-day hold when `connection.removed` is lost.

---

## 7. Owner questions

Each has choices of 24 characters or fewer, what each costs, and a
recommendation.

**7.1 How P learns that Q followed. This re-decides "gap 1" (2026-11-05).**
- a = `hybrid: advance on auth`
  - S2 also advances on a token from Q in an authenticated handshake
    (G2-H).
  - Cost: "Nothing else counts" becomes "nothing unauthenticated counts".
    The bar is an authenticated handshake with Q.
- b = `signal unchanged + G2-B`
  - Only the deposit key of carried-token messages changes.
  - Cost: P's other traffic waits one more hop, for Q's prompt.
- Recommendation: **a**. **b** is acceptable if gap 1 is to stand as
  decided.

**7.2 What passes Q's cut-off. This reverses O1a (#536) for the messages
named.**
- a = `hs.confirm + Q restart` (G1-N)
  - Cost: one more reconnect deposit per followed link mid-reconnect. One
    rare order waits one try.
- b = `signed hs msgs pass` (G1-A)
  - Cost: a larger Table A change, and the wider decoupled-copy residual
    (2.3).
- c = `nothing passes`
  - Cost: G3 stays; a pending Q ends `stale` at `B`.
- Recommendation: **a**. The shipped no-hold makes G1-A's extra reach
  unnecessary.

**7.3 Binding the `ik` to the relay link.**
- a = `ik links in the update` (binding L)
  - Cost: the update's handler runs the identity path.
- b = `ik in the relay link` (binding R)
  - Cost: a new signed format and vectors, and the links are not
    delivered.
- Recommendation: **a**.

**7.4 S1's 30 days against the convergence bound (past 52 days when both
sides rotate).**
- a = `pause S1 on Q evidence`
  - S1's clock does not run while P has accepted an authenticated message
    from Q (a verified handshake message, or a session message under an
    epoch) within the last 16 days.
  - Hard cap: 60 days after the second write.
  - Cost: an active Q that never follows is ended at most at 60 days
    instead of 30. An absent Q is still ended at 30. The kept old key
    costs nothing against a copy, which has it.
- b = `S1 of 60 days`
  - Cost: every unreached recipient is ended twice as late.
- c = `tighten A3`
  - Cost: with `U` ≤ 2 days, a member who stays locked 2 to 4 days can see
    connections end.
- Recommendation: **a**. These are member-facing numbers, so the owner
  sets the 16 and the 60.

**7.5 P has no current epoch at its second write (G7).**
- a = `links in P's reconnect` (2.4)
  - Cost: Table A's sender check gives way to linked keys; one more field
    in the `hs.init`.
- b = `grace while unacked`
  - Cost: an old copy keeps the live old mailbox until every recipient
    acknowledges, at every rotation. It is a relay protocol change.
- c = `accept as residual`
  - Cost: a demoted P that rotates can lose connections, which end
    `stale`.
- Recommendation: **a**.

**7.6 Deposits into the old mailbox (a crash before the second write,
then a long lock).**
- a = `Q holds, P tells cutoff`
  - The Q-side hold, plus `old_collected_to`, so lost deposits are told
    (3.3).
  - Cost: a new field, and up to 30 days of held messages if a
    `connection.removed` is lost.
- b = `Q holds only`
  - Cost: the C2 deposits are lost silently, against the rule that no
    loss is silent.
- c = `grace of 14 days`
  - Cost: an old copy holds the old mailbox twice as long. G7 is not
    covered either.
- Recommendation: **a**.

**7.7 S9 and the failed try during S1 (G6).**
- a = `S9 after 16 days`
  - S9 waits one round, and a revoked K reconnect token is no failed try.
  - Cost: a real fork is shown up to two weeks later.
- b = `S9 at 24 h, no try`
  - Only the failed try is fixed.
  - Cost: an honest false "old copy" alarm whenever Q is demoted.
- c = `S9 off during S1`
  - Cost: forks are seen only through S1's stale.
- Recommendation: **a**.

**7.8 Does an open answer to P's rekey hold Q's reconnect? The shipped
vault says no; the spec text is ambiguous.**
- a = `no hold (as shipped)`
  - Write the shipped behaviour into §6.6.
  - Cost: none; G1 then exits through Q's reconnect.
- b = `hold (change the code)`
  - Cost: changes shipped release-29 behaviour, and needs G1-A or G1-C for
    G1.
- Recommendation: **a**.

**7.9 How to meet "search on the real code".**
- a = `model, then code branch`
  - Cost: the model's switches first.
- b = `code branch only`
  - Cost: slower attribution.
- Recommendation: **a**. The real code has no rotating side to search yet.

**7.10 0.88.2's `hs.confirm` paragraph, which is wrong after the cut-off
(G3).**
- a = `fix in the redesign PR`
  - Cost: none in release 29 (A5).
- b = `erratum now`
  - Cost: a spec round.
- Recommendation: **a**.
