# Relay-key rotation without wait cycles: design note (draft 4)

For the owner and the lead. This note is read against VAULT-MESSAGING
0.89.1 (origin/master). 0.89.1 makes two errata to §6.2 and §6.5 (a rekey
carries links toward every peer; no rekey is started while a side's own
rekey `hs.init` awaits `hs.resp`). Neither changes anything below. Every
section quoted reads as in 0.88.18. RELAY-PROTOCOL is read on the same
master.

Sections 1 to 5 are meant to move into the spec. Sections 6 and 7 are
internal.

**Names used throughout.**
- **P** rotates its relay key from K to K′. **Q** is one recipient.
- **P's key for Q** is S1's term.
- **Q has followed** means Q has applied the link K→K′. From then on, K is
  "earlier" at Q, and K has a **cut-off**.
- **S1 toward Q** is the time during which P's key for Q is not P's
  current key.

## Changes since draft 3

| Item | Change | Where |
|---|---|---|
| 1. Token `sub` | Rule 0: every token Q issues names P's key on Q's record, never `from.relay.pk`. New harness oracle: S2 never advances before Q's follow write | 2.1 rule 0; 6 |
| 2. Rule 5 against 2.4 | During S1, the tokens in P's handshake messages are minted by K′'s mailbox. §3.4 (a)'s old-key exception goes unused for reconnects | 2.1 rule 5; 2.4 |
| 3. S2's restart | The handshake whose message made the advance is exempt | 2.1 rule 6 |
| 4. Spec against shipped code | Checked in the vault. The shipped behaviour is written into the design (N3 is shipped, N4 is replaced by the shipped drop), and Rule J and §6.5's crossing sentence are amended. 7.8 is restated | 1.3; 2.2; 7.8 |
| 5. P's `hs.resp` past the grace | During S1, P's reconnect `hs.resp` also carries the relay links and K′ tokens, and Q follows at `sig_R`. The §6.2 changes are listed | 2.4 |
| 6. The 2.4 bound | About 6`U`, through the prompt path. This is spelled out, and "P demoted" is moved under "both sides rotate" | 2.4; 4 |
| 7. P's open reconnects at the second write | They are restarted per 2.4 | 2.4 |
| 8. The grace loss | It now covers the case without a crash, and C3 and C2′ are corrected. A grace of at least 14 days is the only complete option. The cost of the Q-side hold for a deleted peer is added. 7.6 is restated | 3.2; 3.3; 7.6 |
| Lows and nits | The binding-L guarantee is restated. The hold ends at a 2.4 follow. 2.5 says which token the restart uses. The liveness table states that rekeys are not needed. Φ is reworded. An unknown `iss` rests on the handshake's authentication. N1 comes after establishment. Rule 3 gets a bound. 7.1 b is reframed. 2.4's spec list is completed. §11.14.2 is cited. 1.7 cites §6.6 "Limits" | throughout |
| Resolved | N1 adds no rapid-rotation cost. K9 also runs on a duplicate update. The reason for "Nothing else counts" is kept by G2-H | 2.2; 2.6; 2.1 |

---

## 1. The gaps

### 1.1 What "demoted" means

"Demoted" is a state of an epoch (§3.4.1). An epoch is demoted:
- by position ("Epochs after an `ik` link");
- by "Strict F1";
- from the start, by a link ("Pending epochs at a link").

A **demoted Q** is in the state of "After a demotion of the current
epoch":
- it has no current epoch with P;
- it sends "nothing but handshake messages";
- it holds its durable messages, `relay.token.issued` included, which
  also has no epoch to be sealed under (earlier send keys are erased,
  §6.5).

A Q whose own reconnect is **pending** is in the same position (§6.3.1
Initiator).

Honest demotions happen around `ik` rotations.

### 1.2 The rules involved

- **§3.4 "The signal".** "Nothing else counts". This is owner decision
  "gap 1" (2026-11-05; the 0.85.0 draft, vettid.org c7ee8f7; vettid-vault
  #203), on the premise of vettid.org #536 O1a. The reason recorded for
  it: the alternative signal, a deposit seen under a `jti`, was not
  authenticated and gave P no token for K′.
- **S1, S2, S3.** As quoted in the spec.
- **S9.** A fork alarm "24 hours after" a `token_revoked` on a token Q
  issued to P's earlier key.
- **Rule U.** Q sends `relay.token.issued` "After that write". Q "revokes
  the reconnect tokens it issued to the passed keys".
- **Rule T.** For a reconnect `hs.init`, the tokens' `iss` must be "the
  mailbox its `from.relay` names".
- **§6.2.** A reconnect's `hs.init` and `hs.resp` carry `token` and
  `reconnect_token` ("required").
- **§6.3.** "The collect `sender` ... MUST equal `from.relay.pk` for
  `hs.init`".
- **§6.3.1.** Carried tokens are used only for the handshake's own
  messages, and are adopted at confirmation.
- **RELAY-PROTOCOL §5.3 step 7.** The deposit key must equal the token's
  `sub`.
- **Table A, "Earlier, after its cut-off".** Everything is refused except
  the update, the tokens of `relay.token.issued`, and an `identity.rotate`
  that is already followed.
- **Table A's preamble.** An `hs.init`'s `sender` must equal its
  `from.relay.pk`.
- **The update carries relay links only.** §8.4 gives no order between it
  and `identity.rotate`.
- **RELAY-PROTOCOL §6.7.** The old mailbox lives for the grace, counted
  from the **rotate**. The default is 7 days, and the deployment does not
  override it.
- **§8.6.** `mailbox_unknown`: "Re-resolve the address, or mark the
  connection `stale`".

### 1.3 G1: a rekey's `hs.fin` against a demoted Q

1. **P's first write.** `identity.rotate` goes out. S5 restarts P's rekey,
   whose `hs.init` is deposited with K.
2. **Strict F1 demotes Q.**
3. **Q answers P's rekey.** It names Q's confirmed epoch.
4. **P's second write.** S1 is active, and the update leaves with K.
5. **Q follows.** Its `relay.token.issued` is held, because Q is demoted.
6. **S1 holds P's rekey `hs.fin`.** It would also land after the cut-off.

**What the spec says next.** The spec text lets the cycle close:
- Rule J: "Then neither the rekey block of §6.5 nor §6.6's holds `R`
  back, and it may reconnect". This reads as "a rekey answer holds Q's
  reconnect".
- §6.5: "The lower-`th1` rule applies to any two crossing handshakes of a
  connection, whatever their purposes". Under it, Q's demotion reconnect
  yields to P's rekey when the rekey's `th1` is lower. That is about half
  the time, and Q then waits for the held `hs.fin`.

**What the shipped vault does.** It reads otherwise. Checked on
vettid-vault main:
- `reconnectNaming` (vault/reconnect.go), the reconnect started after a
  demotion or by strict F1, abandons the vault's own rekeys and drops its
  open answers to the peer's rekeys ("they would block it").
- While such a reconnect is open, a rekey `hs.init` from the peer is
  discarded and audited `rekey_replaced_by_reconnect`
  (vault/handshakes.go).
- `startReconnectCtx` and `canReconnect` hold a reconnect only behind
  answers to **reconnects** (`answeredReconnects`).
- `makePending` makes the epoch pending, with `FinAt`, at the write that
  queues the `hs.fin` (vault/confirm.go). So `B` runs from the queued
  `hs.fin`.

Under the shipped behaviour, Q's demotion reconnect runs at once. G1
closes only together with G2 and G3, which break that reconnect.

**At P.** Under the spec text, the held `hs.fin` has no bound. `B` starts
"Once `I` has sent `hs.fin`". The shipped code already bounds it.

### 1.4 G2: the answer to Q's reconnect

1. Q has followed, so its `hs.init`'s tokens name K′ (S3).
2. P deposits its `hs.resp` with K (S1). The relay refuses it (§5.3 step
   7).
3. Even if the relay accepted it, Q would refuse it (`superseded_relay`).
4. Each try expires after 16 days. The third makes the pair `stale`.

### 1.5 Device pairs

A vault never demotes a device's epochs and never reconnects to one. A
device does neither either. So G1, G2, G3, G6 and G7 occur only between
two vaults.

A device's `hs.confirm` landing after the vault's cut-off is refused.
This resolves:
1. The vault still has a current epoch and sends its token.
2. S2 advances.
3. The device re-sends `hs.confirm` with K′.

So it is a delay, not a cycle.

### 1.6 G6: the revoked reconnect token and S9

Q follows P's update, and rule U revokes Q's reconnect tokens for K. Now
suppose that, during S1, P has no current epoch with Q, or its standing
token has expired.
- P reconnects on the revoked K token and gets `token_revoked`. That is a
  failed try (§8.6).
- With Q demoted, Q's token waits more than 24 hours, so S9 raises the
  "old copy of your vault" alarm in an honest run.
- Three such tries make the pair `stale`.

### 1.7 G7: P has no current epoch at its second write

- The update is a session message, so it is held while P is demoted or
  pending.
- P's reconnect announces K and is answered into K's mailbox. That mailbox
  dies 7 days after the rotate, while a round can take 16 days.
- After that, nothing carries K′ to Q.

§6.6 "Limits" accepts this today: "After the grace, or for a device, it
needs a new invite or pairing". So 2.4 changes a stated limit.

---

## 2. The design

Nothing here changes behaviour that release 29 builds (A5), except as
named in 2.2 (writing the shipped behaviour into the spec).

### 2.1 G2: the hybrid G2-H (recommended)

0. **The `sub` of Q's tokens.** Every token Q puts in any message to P
   (`hs.init`, `hs.resp`, `relay.token.issued`, `connection.approved`)
   names as `sub` P's relay key **on Q's record**, never a key the message
   only announces (`from.relay.pk`). This mirrors S3. Under 2.4 it keeps
   Q's `hs.resp` naming K until Q's follow write, so that P's `hs.fin`
   goes with K, which Q accepts.
1. **Deposit key.** A message P sends on a carried token is deposited with
   the key that token's `sub` names, if P still holds it (G2-B). Otherwise
   the answer is dropped, as under rule J, and Q's next try names K′.
2. **When S2 advances.** S2 advances to the newest of P's keys named by a
   token from Q in any of:
   - a reconnect `hs.init` from Q, at the verified `hs.fin` that
     establishes it;
   - an `hs.resp` from Q that P accepts. Its tokens are bound to the
     handshake by its HPKE context, not by `sig_R`. P accepts it after
     `sig_R` verifies;
   - an adoption;
   - `relay.token.issued`.

   Tokens are matched to Q by connection. When a token's `iss` is a
   mailbox P does not know yet (both sides rotating), the advance rests on
   the handshake's authentication, not on verifying the token. P uses the
   token only once rule T keeps it (5, G4).
3. **No reconnect while carried tokens wait (P's side).** While P holds
   undiscarded carried tokens from Q that name a key P holds, P does not
   take §8.6's "no valid standing token" path. This is bounded by the
   carried standing token's `exp`, and by the handshake's own lifetime
   (`L` for an answer, `B` for a pending epoch), whichever ends first.
   Then it is §8.6 as today. This extends a release-29 rule, and only
   during S1.
4. **S2's re-deposit** applies only to entries on held tokens. Entries on
   carried tokens keep their own key (rule 1).
5. **Tokens in P's handshake messages during S1** are minted by the
   mailbox of P's **current** key K′:
   - in a reconnect `hs.init`, that is the mailbox `from.relay` names
     (2.4), as rule T requires;
   - in an `hs.resp`, they travel with the relay links (2.4), which let Q
     keep them.

   §3.4 (a)'s exception ("it mints the standing and reconnect tokens of a
   reconnect `hs.init` it deposits with the old key ... for the old
   mailbox") then goes unused for reconnects, and can be dropped.
6. **S2's restarts.** At an advance, S2 restarts P's open reconnects that
   went with K and have sent no `hs.fin`. The handshake whose message made
   the advance is exempt ("other than the one whose message made the
   change", as H5 says). Each restart uses a reconnect token naming K′;
   without one, the reconnect is kept as it is. In a write that
   establishes Q's reconnect at P, the order is:
   1. the establishment, which ends P's crossing reconnect and pending
      epoch;
   2. the advance;
   3. any restart, of what is still open.

**Security.** An advance needs Q's `ik` or Q's epoch keys. That is the
bar of an authenticated handshake with Q. A copy of Q taken after Q's
last `ik` rotation can meet that bar. Such a copy already counts as Q
(§11.14.2; the copy residuals of §3.4.1). An unauthenticated token only
picks the deposit key for its own handshake. G2-A, under which any
verified token advances S2, is weaker: an old copy of Q could then make
P stop resending and deposit with K′ while the real Q never followed.

**What this re-decides.** The reason recorded for gap 1 was that the old
signal was not authenticated and gave no K′ token. G2-H keeps that
reason: its advances are authenticated, and each one delivers K′ tokens.
It re-decides gap 1 in that form (7.1).

### 2.2 G1 and G3: G1-N (recommended), with the shipped behaviour written into the spec

**S. The shipped behaviour, written into the spec (7.8).**
- **S-a.** A reconnect after a demotion, or by strict F1, abandons the
  side's own rekeys and drops its open answers to the peer's rekeys,
  revoking any tokens they carried.
- **S-b.** While such a reconnect is open, a rekey `hs.init` from the peer
  is discarded (`rekey_replaced_by_reconnect`).
- **S-c.** A pending epoch, and `B`, start at the write that queues the
  `hs.fin`. This was N3 in draft 3.
- **S-d.** Only an answer to a peer's **reconnect** holds a side's own
  reconnect (§6.6 "Between two persons").

Two amendments follow from S:
- **Rule J.** Its last sentence becomes "Then the rekey block of §6.5
  does not hold `R` back". The §6.6 hold applies only to reconnect
  answers.
- **§6.5's crossing sentence** gains an exception: "... whatever their
  purposes, except that a reconnect after a demotion or by strict F1
  replaces the side's rekeys and its answers to the peer's (§3.4.1)".

This amends release-29 spec text to match the release-29 code. It changes
no behaviour.

**N1. Q's mirror of S2.**
- **The rule.** When Q follows a relay link, it abandons each of its own
  open reconnects whose `hs.init` carried tokens naming the passed key and
  that has not sent `hs.fin`, and starts it again with tokens naming K′.
  The abandonment revokes that handshake's carried tokens as Q's own step,
  so rule U's revocation and the abandonment are one act. P never adopts
  the revoked token.
- **The token.** The restart is deposited on the update's fresh K′
  reconnect token (rule U keeps it), not on the held K token. So it adds
  nothing toward the rapid-rotation residual.
- **The order.** In a write that also establishes a handshake, N1 runs
  after the establishment, as rule 6 does.

**N2. `hs.confirm` passes the cut-off.** In Table A, row "Earlier, after
its cut-off", an `hs.confirm` is processed (it confirms) when:
- its epoch's keys were established under a handshake signed by Q's
  current `ik` for P, which binding L makes safe (2.6); and
- Q has accepted no message from P's newer key yet.

**The G3 cases.**
- Q followed before its `hs.init`: G2-B covers it.
- Q followed after its `hs.init` and before `hs.fin`: N1 covers it.
- Q followed after its `hs.fin`: N2 covers it.

**The held rekey `hs.fin`.**
- If Q has an epoch, Q's token comes, and S2 re-deposits the `hs.fin`.
- If Q is demoted, Q's reconnect drops its answer to the rekey (S-a), and
  P's pending rekey epoch ends when Q's reconnect is established at P.
  P's held `hs.fin` is dropped with it (§6.3.1).

**What this reverses.** O1a, for `hs.confirm` only (7.2).

### 2.3 G1-A (the broader alternative)

**The parts.**
- **Part 1.** S1 also lets out a rekey's `hs.init`, `hs.resp` and
  `hs.fin`.
- **Part 2.** Each of these passes the cut-off when it is authenticated
  under Q's current `ik` for P:
  - an `hs.resp`, by its `sig_R`;
  - an `hs.fin`, by its `sig_I` under the `ik` that Q's answer pinned,
    after the `hs.init`'s links were applied;
  - an `hs.confirm` or a session-mode rekey `hs.init`, by epoch keys
    established under a handshake signed by Q's current `ik`.
- **Part 3.** At S2's advance, P restarts the rekeys that went with K and
  got no `hs.resp`, but only if no epoch was established since each rekey
  began.

**The narrowing.** N2 shares it: a pass holds only until Q first accepts
a message from P's newer key.

**The residual.** Some rotations are decoupled: a gate-owed key, or the
next key after a pending one, is generated after the current `ik`. A copy
taken between that `ik`'s write and the relay key's first write holds
both. Until the narrowing closes, such a copy can run a whole rekey
through K after the cut-off. It counts as P already, and the next `ik`
rotation ends it. Under G1-N, that copy can only confirm, which is the
existing residual "An old copy ... can confirm Q's pending epoch as P".

**I3's wording.** "... except tokens that pass rule T, duplicates of
followed links, and, until Q first accepts a message from P's newer key,
[G1-N: an `hs.confirm`; G1-A: a handshake message or `hs.confirm`] under
epoch keys established under a handshake signed by Q's current `ik` for
P, which a copy taken before that `ik` was written cannot make."

### 2.4 G7 and the past-the-grace answer: links in reconnects (recommended)

**The rules.**
- **Announcing K′ during S1.** P's reconnect messages toward Q announce
  K′:
  - its `hs.init` names K′ in `from.relay`;
  - its `hs.resp` to Q's reconnect does too, in a new field.

  Both carry `relay_links` from K up to K′, P's `ik` links (`rotations`,
  binding L), and `token` and `reconnect_token` minted by K′'s mailbox.
  Both are still deposited with K (rule 1).
- **Q accepts them** from K before or after K's cut-off, when the links
  connect the `sender` to the announced key and pass rule C, and the
  announced key is Q's current key for P or is reached through them.
  Without the links, a reconnect `hs.init` from K after the cut-off stays
  refused.
- **When Q follows.** Q follows the links:
  - for P's `hs.init`, at the verified `hs.fin` that establishes it (no
    state changes before `sig_I`, §6.6). The cut-off is that `hs.fin`'s
    position, so the `hs.fin` itself, deposited with K by rule 0 and rule
    1, is accepted;
  - for P's `hs.resp`, at its verified `sig_R`, in the write that
    processes it. The cut-off is the `hs.resp`'s position. Q's `hs.fin`
    then goes to K′'s mailbox on the `hs.resp`'s carried token.
- **The second write.** In it, P abandons its open reconnects that
  announced K and have sent no `hs.fin`, and starts them again by these
  rules. Otherwise each of them, past the grace, costs a failed try of 16
  days.
- **The Q-side hold** (3.3) also ends at a follow by these rules.

**How Q gets a K′-mailbox token it can use.**
- **Today's machinery (the "prompt path").** The tokens carried in the
  `hs.init` are adopted when Q's confirmed epoch reaches the reconnect's.
  That happens at P's prompt `relay.token.issued` (§6.3.1 "The prompt to
  adopt"). Until then they carry only the handshake's own messages, among
  them Q's `hs.confirm` into K′'s mailbox. Q's `relay.token.issued` for
  K′ then waits for the adoption.
- **The alternative.** Keep the `hs.init`'s K′ tokens as held tokens at
  the follow: `sig_I` covers them through `th`. This saves two hops, but
  changes R29-T1's adoption rule.
- **Recommendation.** The prompt path. No release-29 rule changes.

**The changes to the spec.**
- §6.2: `from.relay` during S1, the new `relay_links` field, and the
  announced key in `hs.resp`. Tokens stay required in both messages, as
  today.
- §6.3: the collect `sender` check gives way to linked keys.
- Table A's preamble.
- S1's list: no change in kind, but the content changes.
- §3.4 (a) exception 2 is dropped for reconnects.
- Rule T's reconnect clause: `iss` = the mailbox of the announced key.
- Rule U: following by these links.
- §6.6 "Limits": the sentence that accepts G7 is removed.

**Safety.** A link's two signatures are made by P's relay keys in the
rotation's first write. A copy taken before that write cannot make them.
A copy taken after it counts as P. The cap on answers is opened only to
messages that carry valid links.

**The bound for the 2.4 path.** It is about 6`U`: `hs.init`, `hs.resp`,
`hs.fin` (Q follows), `hs.confirm` (P confirms and sends its prompt), the
prompt (Q adopts and sends its token), then the token (S2). Add up to a
round when P must first wait, for example for its own demotion to be
resolved. That case needs Q to have rotated its `ik` as well, so it
belongs under "both sides rotate" in 4.

**The alternative to 2.4.** The relay keeps the old mailbox until every
recipient has acknowledged. That widens the old-copy window, and needs a
change to the relay protocol.

### 2.5 G6: the revoked reconnect token during S1

- **Spec change.** During S1 toward Q, a `token_revoked` on a reconnect
  token for an earlier key of P is no failed try, and it does not start
  S9 by itself. P stops using that token.
- **What P waits for.** Q's reconnect, or Q's token. P's own reconnect is
  started again, by 2.4, on the K′ reconnect token, once one arrives:
  from S2's advance, or from Q's `relay.token.issued`.
- **S9.** S9's wait becomes one round (16 days) instead of 24 hours (7.7).

### 2.6 Binding L: the update carries P's `ik` links (recommended)

**The rules.**
- The update carries `rotations`, as S8 says for `identity.rotate`, and
  they are made again at each resend.
- Q applies those links first, in the same write: rule C, Table B, H5,
  the demotion rules, and R29-K9's judgment. K9 runs on a **duplicate**
  update too, as it does on an `identity.rotate` that is already
  followed.
- If Table B refuses a link, Q follows no relay link from that update.

**What it guarantees.** No copy taken before the write of the `ik`
current at the relay link's first write passes N2, part 2 of G1-A, or
2.4's ik check. It is not absolute for the decoupled rotations (2.3).

**K9 at the update.** Probably sound: the update is sealed under P's
current epoch, as `identity.rotate` is. To be modelled.

**Side effect.** The update can demote Q itself, by strict F1.

**The alternative, binding R.** Put the `ik` in the relay link's signed
body. That needs a new format and test vectors, and it does not deliver
the links.

---

## 3. The crash order between the relay's rotate and the state write

### 3.1 What §3.4 says

"stores first, then rotates, and retries with the same key". The three
paths follow it. The exception is a recovery's fresh key after a refused
registration.

### 3.2 What each crash point leaves

"Grace loss" means: the deposits the relay accepted into K's mailbox
after P's last collect of it are lost, without anyone being told, when
the mailbox ends (3.3).

| Crash point | State | Relay | Next unlock | Lost |
|---|---|---|---|---|
| C0: before the first write | K current; an owed mark, if one was written | old mailbox | the mark retries the rotation | nothing |
| C1: after the first write, before the rotate | K current, K′ pending; the new `ik`; `identity.rotate` sent | old mailbox | the rotate again, with the same K′ | nothing |
| C2: after the rotate, before the second write | as C1 | both mailboxes; the grace has started | the rotate again, then the second write; past the grace, the registration (`200`: continue; `201`: re-mint every token) | grace loss, widened by the time to the next unlock |
| C3: after the second write, before the updates go out | K′ current; K kept for deposits | both | the outbox sends the updates | grace loss (as without a crash) |
| C2′: after K1's second write, which also stores K2 | K1 current, K2 pending | K1's mailbox, and K's in its grace | as C1, for K2 | grace loss for K's mailbox, as C3 |
| CR: a definite refusal, before the write that records it | as C1 or C2 | unchanged | refused again; then the refused write | nothing more than C1 or C2 |
| CF: a recovery's fresh key, registered before any state holds it | the inherited key, refused | an empty mailbox nobody was told of | the open is retried | an orphaned mailbox (within the relay's limit of 3) |

### 3.3 Is it complete?

**Safety: yes.**

**Liveness: no.**

**Grace loss without any crash.** Under A3:
- Q goes on depositing to K's mailbox until it follows: up to `U` after
  the second write, and longer on the 2.4 path.
- P collects K's mailbox only at its unlocks, at least once every `U`.
- Deposits made after P's last collect, and before the mailbox ends, are
  lost silently.
- A crash before the second write widens this, and so does a lock outside
  A3.
- Q's deposits that the relay refuses after the mailbox ends hit §8.6's
  `mailbox_unknown`, which today makes the connection `stale`.

**The options.**
- **(a) A relay grace of at least 3`U` plus a margin.** 14 days closes the
  loss under A3, with or without a crash. The rotate is at most `U`
  before the second write, Q follows within `U`, and P's next collect
  comes within one more `U`. The grace is a relay configuration value.
  - Cost: an old copy keeps the live old mailbox twice as long, at every
    rotation (§3.4.1 Residuals).
  - It is the only complete option within A3.
- **(b) A hold on Q's side.**
  - The rule. While the connection is active, and since the first refusal
    no update from P has named a mailbox newer than the refused one, a
    deposit to P's mailbox refused `mailbox_unknown` is held:
    - it is not ended (`drop.undelivered_mailbox_unknown`), not a failed
      try, and not a reason for `stale`;
    - it ends at a follow (rule U or 2.4), at the connection's end, or 30
      days after the first refusal.
  - It saves the deposits that were **refused**, not those the relay
    accepted.
  - Cost: for a peer whose vault was deleted and whose
    `connection.removed` was lost, the member gets 30 days of silence
    instead of an immediate "not delivered".
- **(c) `old_collected_to`.** P tells Q, in the update, up to when it
  collected K's mailbox, so that Q can report lost deposits
  (`message.delivery_unconfirmed`).
  - Cost: P persists the collected-to time of every acked collect (not
    only the leased ones). Q keeps a per-peer log of the deposits the
    relay accepted, with their `deposited_at`. Clock skew needs a margin
    (§4.1's 90 seconds).
  - *Unsure* that it can be made exact.

**Recommendation.** (a) together with (b). (a) closes the loss within A3;
(b) covers what is refused, including outside A3. Outside A3, a lost
deposit that the relay accepted remains a residual, unless (c) is also
built.

**The second write** should also list its S1 state.

---

## 4. Liveness argument sketch

The design argued: G2-H, G1-N with S, binding L, 2.4, 2.5, and 3.3 (a)
with (b). Only pairs of vaults are argued here; device pairs are 1.5.

### Assumptions

- **A1 to A4** as in 0.88.2.
- **`t_r`** is the last write, by either side, that stores an `ik` or a
  relay key. That includes a gate-owed key and the next key after a
  pending one.
- **A5′.** Relay keys rotate, and both sides advertise `relay_follow`. The
  gate's deadline (30 days) bounds a gate-owed key.
- **A6.** The grace is at least 14 days, and the Q-side hold applies.
- **A7.** No rotate is definitively refused.

### The progress measure

Φ = (π, ν, μ, λ, δ, ρ), compared in that order:
- **π**: the number of pending relay keys;
- **ν**: the number of (side, recipient) pairs where the recipient has
  not followed;
- **μ**: the number of pairs where the side's key for the recipient is
  not its current key;
- **λ, δ, ρ**: as in 0.88.2.

**Why Φ only goes down.**
- A pending key's second write raises ν and μ. But π falls in that same
  write, so Φ still decreases.
- Binding L ties the `ik` links to the follow, so δ and ρ rise only where
  ν or λ falls.
- S2's and N1's restarts happen only where μ or ν falls.

**Step 0.** π reaches 0 within `U` of `t_r`. One attempt is made at each
unlock (A3), and the relay answers (A2).

**Step 1.** ν reaches 0:
- within 2`U` of the second write by the update;
- within about 3`U` by the 2.4 path.

λ reaches 0 by `t_r` + 3`U`.

**Step 2.** μ reaches 0. Every wait names what ends it:

| Wait | Ended by | Bound | Why no cycle |
|---|---|---|---|
| The update reaching Q | S1 lets it through, with resends. While P has no epoch, the 2.4 path carries the links instead | `U`; 2.4: three hops | needs nothing from Q's acknowledgment |
| Q following | rule U or 2.4, with binding L. A demotion of Q by those links leads to row 3 (b) | one hop | needs nothing more from P |
| Q's acknowledgment | (a) `relay.token.issued`, when Q has an epoch; (b) Q demoted: its reconnect runs at once (S-a, S-d), N1 restarts it if Q followed mid-reconnect, G2-H rule 1 delivers P's answer, and S2 advances at the verified `hs.fin`; (c) Q pending: N2 lets P's `hs.confirm` through, then (a) | one round plus a hop / "The reconnect bound" | Q never waits for a message P holds for want of Q's acknowledgment |
| P's reconnect on a revoked K token | not a try (2.5); P waits for row 3, then restarts on a K′ token | row 3 | the revocation is Q's own follow |
| P's held rekey messages | S2's re-deposit, or dropped by S-a and §6.3.1; `B` from the queued `hs.fin` (S-c) | one round / `B` | rekeys are not needed for progress under G1-N: each wait ends through a reconnect or S2 |
| P's other entries held by S1 | S2's advance | above | — |
| P's entries needing a held K′ token | Q's `relay.token.issued` (the prompt, or rule U) | one hop | P starts no reconnect meanwhile (rule 3, bounded) |
| Q's refused deposits to K's mailbox | held until the follow (3.3 (b)) | rows 1 and 2 | — |
| S9 | waits one round | 16 days | not a wait of the pair |

### The bound, counted from P's second write `w`

- **One side rotates.**
  - Q has an epoch: 2`U`.
  - Q is demoted: `U` for the update, then the reconnect's three hops to
    the verified `hs.fin`, so about 4`U`.
  - 2.4, when Q could not reach P: about 6`U`.
  - The worst case, about 6`U` = 24 days at `U` = 4, is inside 30.
- **Both sides rotate.** Q may have no current epoch until 0.88.2's
  settling at `t_r` + 12`U`, and only then send its token: `t_r` + 13`U`.
  P demoted at its second write needs Q to have rotated an `ik`, and adds
  up to a round before its 2.4 reconnect runs. P's `w` can be as early as
  the first of these rotations. So the wait from `w` is 52 days or more at
  `U` = 4, past S1's 30.
- **Hence 7.4.**

### What still ends `stale`, visibly

- 0.88.2's list;
- S1's clock, as 7.4 decides it;
- the gate's deadline;
- G4's slow path, if the harness finds one.

---

## 5. Other wait cycles with relay-key rotation on

- **G3.** S1's list does not get past the cut-off. Closed by 2.2 (or
  2.3).
- **G4: both sides rotate within one hop.**
  - Q's `relay.token.issued` names an `iss` that P does not know yet. It is
    deferred, then refused, and P's next resend replaces it.
  - Under G2-H, an authenticated handshake still advances S2 (rule 2). P
    can use the token only once rule T keeps it, that is, once P has
    followed Q's own update, which goes out under Q's S1. That is one hop
    more.
  - Argued to be bounded; to be checked in the harness's G4 mode.
- **G5: S2's restart without a K′ reconnect token.** The reconnect is
  kept as it is, not restarted (rule 6).
- **G6 and G7.** Closed by 2.5 and 2.4.
- **H5 and the reconnect token's quota.**
  - N1 restarts on the update's fresh K′ reconnect token, so it adds
    nothing to the rapid-rotation residual.
  - 2.5 removes the failed tries on a revoked token.
- **The gate, rule U and H5.** No other cycle found.

---

## 6. Harness plan (internal)

### What exists

- **The vault code has no rotating side.**
  - `rotateIdentity` leaves the relay key unchanged, and a test pins
    assumption A5.
  - `Relay` has no rotate call.
  - `hAddressUpdate` is the receiving side from before 0.85.
- **The random-pair harness has no relay-key mode.** Its modes are the
  default, `R29RP_BURST`, `R29RP_SHUFFLE`, `R29RP_REFRESH`,
  `R29RP_SPENT` and `R29RP_LOSTANS`, plus `R29RP_TRACE` and
  `R29RP_REPEAT`.
- **The ~90 in 10,000 come from the trust model.** That is
  `TRUSTMODEL_RELAYROT=1` on vettid-vault branch `r29-oracle` (#207).
  - Its S1 list is `allowedWhileUnacked`.
  - Its Table A refuses an earlier key's `hs.confirm` after the cut-off
    (G3).
  - Its `mintPass` mints an `hs.resp`'s tokens from the current mailbox,
    which is rule 5's question.
  - *Unsure*: whether it models S-a to S-d. Its `startReconnect` paths
    must match the shipped code.

### Steps

1. **The model first.**
   - Classify the `stale` runs by mechanism: G1, G2, G3, G6, G7, other.
   - Add each fix behind its own switch:
     - G2-H rules 0 to 6;
     - S-a to S-d;
     - N1 and N2;
     - G1-A, with its narrowing;
     - 2.4, with both `hs.init` and `hs.resp`;
     - 2.5;
     - binding L, with K9 run on the update and on a duplicate update;
     - 3.3 (a) and (b).
   - Run it with `TRUSTMODEL_RELAYROT=1`, with and without ROTBURST, at
     10,000 runs and then at 100,000.
   - The old-copy actor must break I3 with binding L off.
   - Add a device-pair configuration.
2. **The real code, on a branch that is not merged.**
   - Build the rotating side, rule U with binding L, Table A's
     earlier-key rows, G2-H, G1-N, 2.4, 2.5 and the hold.
   - The stub relay needs:
     - a rotate that is idempotent when repeated with the same key;
     - the grace, with collects from both mailboxes;
     - tombstones;
     - `mailbox_unknown` after the grace;
     - the step-7 check of RELAY-PROTOCOL §5.3;
     - the denylist.
3. **A new mode, `R29RP_RELAYROT`.**
   - **What it rotates.** All three paths, and the decoupled keys.
   - **Crashes.** At C1, C2, C3, C2′, CR and CF.
   - **Schedules.**
     - locks around the grace;
     - P demoted at its second write (G7);
     - Q followed at each point of a reconnect (G3's three cases);
     - a G4 sub-mode with an unknown `iss`.
   - **Oracles.**
     - I1 extended (ν = μ = 0, and nothing held by S1);
     - I2 and I5;
     - an I3-lite: nothing from an earlier key after its cut-off beyond
       N2 or 2.4, and nothing after Q has accepted a message from the
       newer key;
     - **S2 never advances before Q's follow write**;
     - no S9 feed item in an honest run;
     - grace loss: every deposit the relay accepted is collected or told.
   - **Counters.**
     - S2 advances, by kind;
     - reconnect-token deposits per rotation;
     - the time from `w` to μ = 0, compared with S1's clock.
4. **The bar.**
   - 0 honest runs that end `stale`, diverged or suspended outside the
     accepted residuals, at 10,000 runs per mode.
   - The modes: `R29RP_RELAYROT` crossed with every existing mode, and
     every existing mode without it.
   - Counted from the `-v` class table and the counters (`-test.v` for a
     prebuilt binary), never from a PASS.
   - Each new oracle is shown to fire before its zero is reported.
5. **Likely residuals.**
   - S1's clock, per 7.4;
   - a recipient away beyond it;
   - G4, if it fails;
   - the rapid-rotation rate, measured again;
   - the decoupled-rotation copy;
   - grace loss outside A3, without (c);
   - the hold's 30 days when a `connection.removed` is lost.

---

## 7. Owner questions (final)

Each question gives its choices (24 characters or fewer), what each
costs, and a recommendation.

### 7.1 How P learns that Q followed (re-decides "gap 1", 2026-11-05)

- **a = `hybrid: advance on auth`** (G2-H)
  - S2 also advances on Q's token inside an authenticated handshake.
  - Cost: "Nothing else counts" becomes "nothing unauthenticated counts".
    Gap 1's reason (authentication, and a K′ token) is kept.
- **b = `signal unchanged + G2-B`**
  - Only the deposit key of messages on carried tokens changes.
  - Cost: P's other traffic waits one more hop. G2-B on its own still
    deposits with a key Q has not yet confirmed to P, which re-decides
    part of O1a's premise. A held pending `hs.confirm` then still needs
    N2.
- **Recommendation: a.**

### 7.2 What passes Q's cut-off (reverses #536 O1a for what is named)

- **a = `hs.confirm + Q restart`** (G1-N)
  - Cost: one Table A cell for `hs.confirm`, and N1.
  - No rapid-rotation cost.
- **b = `signed hs msgs pass`** (G1-A)
  - Cost: a wider Table A change.
  - A wider copy residual in the decoupled rotations.
- **c = `nothing passes`**
  - Cost: G3 stays, and a pending Q ends `stale` at `B`.
- **Recommendation: a.**

### 7.3 Binding the `ik` to the relay link

- **a = `ik links in the update`** (binding L)
  - Cost: the update's handler runs the identity path, K9 included.
- **b = `ik in the relay link`** (binding R)
  - Cost: a new signed format and test vectors.
  - It does not deliver the links.
- **Recommendation: a.**

### 7.4 S1's 30 days against the convergence bound (52 days or more when both sides rotate)

- **a = `pause S1 on Q evidence`**
  - S1's clock does not run while P has accepted an authenticated message
    from Q within the last 16 days, capped at 60 days after the second
    write.
  - Cost: an active Q that never follows is ended at 60 days instead of
    30. An absent Q is still ended at 30.
- **b = `S1 of 60 days`**
  - Cost: every recipient that cannot be reached is ended twice as late.
- **c = `tighten A3`**
  - Assume `U` ≤ 2 days.
  - Cost: members who stay locked for 2 to 4 days lose connections.
- **Recommendation: a.** The 16 and the 60 are member-facing numbers, so
  they are the owner's to set.

### 7.5 Reaching Q when the old mailbox cannot (G7, and the answer past the grace)

- **a = `links in reconnects`** (2.4)
  - Cost: changes to §6.2 and §6.3, to Table A's preamble and to rule T.
  - It removes a limit §6.6 states.
- **b = `grace while unacked`**
  - The relay keeps the old mailbox until every recipient acknowledges.
  - Cost: an old copy keeps the live mailbox that long, at every
    rotation.
  - It changes the relay protocol.
- **c = `accept as residual`**
  - Cost: a P that is demoted, or that is reached only past the grace,
    loses the connection, which ends `stale`.
- **Recommendation: a.**

### 7.6 Deposits that the old mailbox loses at its end

- **a = `grace 14 d + Q hold`**
  - Cost: an old copy keeps the old mailbox twice as long.
  - A deleted peer whose `connection.removed` is lost shows 30 days of
    silence instead of "not delivered".
  - Complete within A3.
- **b = `Q hold + collected-to`**
  - Cost: a new field.
  - P persists its collected-to times, and Q logs every deposit the relay
    accepted.
  - Exactness under clock skew is *unsure*.
- **c = `Q hold only`**
  - Cost: deposits the relay accepted are lost silently. That breaks the
    "no silent failures" rule.
- **Recommendation: a.** The grace is a relay configuration value.

### 7.7 S9 and the failed try during S1 (G6)

- **a = `S9 after 16 days`**, and no failed try.
  - Cost: a real fork is shown up to two weeks later.
- **b = `S9 at 24 h, no try`**
  - Cost: an honest false "old copy" alarm whenever Q is demoted.
- **c = `S9 off during S1`**
  - Cost: forks are seen only through S1's `stale`.
- **Recommendation: a.**

### 7.8 Write the shipped release-29 behaviour into the spec (S-a to S-d), amending Rule J and §6.5's crossing sentence

- **a = `spec follows shipped`**
  - Cost: two amended sentences. No code change.
  - Without it, G1 cycles about half the time under the text.
- **b = `code follows the spec`**
  - Cost: changes shipped behaviour.
  - G1 then needs G1-A, plus a crossing rule.
- **Recommendation: a.**

### 7.9 How to meet "search on the real code"

- **a = `model, then code branch`**
  - Cost: the model's switches come first.
- **b = `code branch only`**
  - Cost: attribution is slower.
- **Recommendation: a.**

### 7.10 0.88.2's `hs.confirm` paragraph (wrong after the cut-off)

- **a = `fix in the redesign PR`**
  - Cost: none for release 29.
- **b = `erratum now`**
  - Cost: a spec round.
- **Recommendation: a.**
