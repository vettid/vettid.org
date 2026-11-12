# Relay-key rotation without wait cycles: design note (draft 7)

For the owner and the lead. This note is read against VAULT-MESSAGING
0.89.1 (origin/master); the two errata of 0.89.1 change nothing below.
Every quoted section reads as in 0.88.18. RELAY-PROTOCOL is read on the
same master.

The owner decided every open question on 2026-11-12 (§7). This draft
describes the chosen design only. Options the owner did not choose appear
once each, as "not chosen", in §7.

Sections 1 to 5 and "Spec changes this implies" are meant to move into the
spec. Sections 6 and 7 are internal.

**Names used throughout.**
- **P** rotates its relay key from K to K′. **Q** is one recipient.
- **P's key for Q** is S1's term: the key P deposits to Q with. It never
  moves back.
- **Q has followed** means Q has applied the link K→K′. From then on, K is
  "earlier" at Q and has a **cut-off**.
- **S1 toward Q** is the time during which P's key for Q is not P's current
  key.
- **Acknowledged** (§3.4 "The signal") is unchanged: Q's
  `relay.token.issued` for K′. It is the same as S2's advance (owner
  decision 2026-11-12, 7.4 c).

## Changes since draft 6

| Change | Where |
|---|---|
| **Draft 7: owner decisions folded in** (owner decision 2026-11-12, all fifteen questions). §7 is now a record of the decisions. Rules, cases and table rows that applied only under choices not taken are removed, among them G2-H's advance sources, waits, restarts and resends (7.4 a not chosen) and contested relay forwarding (7.6 d not chosen) | 1–7 |
| G2 under 7.4 c: closed by G2-B (rule 1) plus Q's prompt `relay.token.issued`; S2 and "acknowledged" stay one signal | 2.1; 4 |
| The liveness table, the bound and the residuals are restated for the chosen set | 4; 5; 6 |
| New: "Spec changes this implies" | after 5 |
| §6 becomes the next steps under 7.13 a | 6 |
| Interactions between the chosen answers that need a look are listed, not resolved | 7.16 |

The draft 6 changes table is kept at the end of this note, for the record.

---

## 1. The gaps

### 1.1 What "demoted" means

"Demoted" is a state of an epoch (§3.4.1). An epoch is demoted in three
ways:
- by position ("Epochs after an `ik` link");
- by "Strict F1";
- from the start, by a link ("Pending epochs at a link").

A **demoted Q** is in the state of "After a demotion of the current
epoch":
- it has no current epoch with P;
- it sends "nothing but handshake messages";
- it holds its durable messages, `relay.token.issued` included.

That message also has no epoch to be sealed under, because earlier send
keys are erased (§6.5).

A Q whose own reconnect is **pending** is in the same position (§6.3.1
Initiator). Honest demotions happen around `ik` rotations.

### 1.2 The rules involved

- **§3.4 "The signal".** "Nothing else counts". This is the owner's
  decision "gap 1" of 2026-11-05 (the 0.85.0 draft, vettid.org at c7ee8f7;
  built in vettid-vault #203), on the premise of vettid.org #536 O1a. The
  recorded reason is **liveness**: a peer that "acknowledges" only by
  depositing never sends a new token. The owner kept this rule on
  2026-11-12.
- **S1, S2, S3, S9, rule U, rule T**, as in §3.4.1. Rule U revokes "the
  reconnect tokens it issued to the passed keys" and leaves the standing
  tokens to expire.
- **§3.4.1 "The reconnect bound".** The connection becomes `stale` "when Q
  cannot start a try because it holds no reconnect token for P". The
  shipped code does this too (`noReconnectToken`, then `markStale`).
- **§6.2.** A reconnect's `token` and `reconnect_token` are "required".
- **§6.3.** The collect `sender` "MUST equal `from.relay.pk` for
  `hs.init`".
- **§6.6.**
  - "Initiating": "`from.relay` names the relay key it is deposited
    with".
  - "Authentication": "the collect `sender` equals the relay key on
    record".
- **§6.3.1.** Carried tokens serve only their own handshake. They are
  adopted at confirmation, and discarded at H5, at `B` or at
  `token_revoked`.
- **RELAY-PROTOCOL §5.3 step 7.** The deposit key must equal the token's
  `sub`.
- **RELAY-PROTOCOL §6.2.** A deposit is answered `201 {msg_id}`. The ULID is
  in arrival order per mailbox.
- **Table A, "Earlier, after its cut-off".** Everything is refused except:
  - the update;
  - the tokens of `relay.token.issued`;
  - an `identity.rotate` that is already followed.
- **The update carries only relay links.** §8.4 does not order it against
  `identity.rotate`.
- **RELAY-PROTOCOL §6.7.** The old mailbox lives for the grace, counted
  from the **rotate**. It is 7 days today, and becomes 14 days (owner
  decision 2026-11-12, 7.6 c).
- **§8.6.** `mailbox_unknown`: "Re-resolve the address, or mark the
  connection `stale`".

### 1.3 G1: a rekey's `hs.fin` against a demoted Q

The sequence:
1. P's first write sends `identity.rotate`. S5 restarts P's rekey, whose
   `hs.init` goes out with K.
2. Strict F1 demotes Q.
3. Q answers P's rekey.
4. P's second write turns S1 on. The update goes out with K.
5. Q follows. Its `relay.token.issued` is held, because Q is demoted.
6. S1 holds P's rekey `hs.fin`. Even if S1 let it out, it would land
   after the cut-off.

**Under the spec text the cycle closes.**
- Rule J ("Then neither the rekey block of §6.5 nor §6.6's holds `R`
  back") reads as "a rekey answer holds Q's reconnect".
- §6.5's lower-`th1` rule makes Q's demotion reconnect yield to P's rekey
  about half the time.

**The shipped vault does otherwise** (vettid-vault main):
- `reconnectNaming`, once `canReconnect` passes, abandons the vault's own
  rekeys, drops its open answers to the peer's rekeys, and abandons its
  pending epoch.
- While a reconnect naming an epoch other than the current one is open,
  a peer's rekey `hs.init` is discarded (`rekey_replaced_by_reconnect`).
- Between persons, `startReconnectCtx` and `canReconnect` hold a
  reconnect only behind answers to reconnects (`answeredReconnects`).
- `makePending` records `FinAt` in the write that queues the `hs.fin`.
- `tickDemoted` retries a demotion reconnect only when there is no
  pending epoch of its own.

With the model aligned to this (6), G1 + G2 fell from 58 to 0 stale ends
in 10,000 runs (seed 1). Under the shipped behaviour, G1 closes only
together with G2 and G3. The spec now follows the shipped behaviour
(owner decision 2026-11-12, 7.1 a).

### 1.4 G2: the answer to Q's reconnect

1. Q has followed. So its `hs.init`'s tokens name K′, which is P's key as
   Q has it on record (rule 0).
2. Today P deposits its `hs.resp` with K (S1), and the relay refuses it
   (§5.3 step 7).
3. Even if the relay accepted it, Q would refuse it (`superseded_relay`).
4. Each try expires after 16 days unanswered. The third failed try for
   the same named epoch makes the pair `stale`.

This is the main gap. Before the fix it occurs in almost every stale end
of the model (6). The chosen fix is in 2.1.

### 1.5 Device pairs

**G1, G2, G3 and G6 occur only between two vaults.** A vault never
demotes a device's epochs and never reconnects to one, and a device does
neither.

**A late `hs.confirm` is a delay, not a cycle.** Suppose a device's
`hs.confirm` lands after the vault's cut-off. The vault refuses it, but
still has a current epoch and sends its token, so S2 advances. The device
then sends `hs.confirm` again with K′ at its 12-day resend.

**A device offline past the grace (14 days) still meets the grace
losses.** Its deposits to the old mailbox end `mailbox_unknown`, and a
device cannot reconnect. §6.6 "Limits" already accepts this: the device is
paired again. This is a residual of the chosen design (5).

### 1.6 G6: the revoked reconnect token, and S9

When Q follows, rule U revokes Q's reconnect tokens for K. Suppose that,
during S1, P has no current epoch with Q, or its standing token has
expired. Then:
- P's reconnect on the revoked K token gets `token_revoked`, which counts
  as a failed try (§8.6).
- With that token unusable, P holds no reconnect token, so "The reconnect
  bound" makes the pair `stale`.
- With Q demoted, Q's token waits more than 24 hours, so S9 shows its
  fork text in an honest run.

### 1.7 G7: P has no current epoch at its second write

- The update is held, because it is a session message.
- P's reconnect announces K and is answered into K's mailbox, which ends
  when the grace does.
- After that, nothing carries K′ to Q.

§6.6 "Limits" accepts this today. The chosen design changes that limit
(2.4).

### 1.8 G9: a refused reconnect `hs.init` waits its whole life

Both sides rotate. Q is demoted by strict F1, starts its reconnect, then
fails a write and stays down past P's grace. Then:
- P's `relay.token.issued` expires at the relay.
- Q's update resends and its own `relay.token.issued` are held.
- Q's reconnect `hs.init` is refused with `mailbox_unknown` by P's old
  mailbox. The shipped vault, on a definite refusal of an entry with its
  own token, only ends that entry. The reconnect stays open for 16 days,
  and P's S1 ends the pair first.

Two more things hold the cycle:
- Q refuses P's update under its demoted epoch without following its
  links.
- §3.4.1's sentence "P's next resend replaces it" assumes a resend that
  no one makes while the sender is demoted or pending.

---

## 2. The chosen design

None of this changes behaviour that release 29 builds (A5), with three
exceptions, which change shipped code:
- writing the shipped behaviour into the spec (2.2 S), which changes no
  behaviour;
- 2.5's no-stale rule;
- 2.7's refusal path.

### 2.1 G2: G2-B, with the signal unchanged (owner decision 2026-11-12, 7.4 c)

0. **The `sub` of Q's tokens.** Every token Q puts in any message to P
   names P's relay key **on Q's record**. It never names a key the
   message only announces (`from.relay.pk`). This is S3's rule applied to
   Q.
   - Rule 0 is still needed under 7.4 c, because rule 1 deposits with the
     token's `sub`.
   - Under 2.4, Q's `hs.resp` to P's reconnect must name K until Q's
     follow write. Then P's `hs.fin` goes with K, which Q accepts. If it
     named K′, Q would refuse that `hs.fin` as `foreign_sender`.
1. **Deposit key (G2-B).** A message P sends on a carried token is
   deposited with the key that token's `sub` names, if P still holds that
   key. This covers `hs.resp`, `hs.fin`, `hs.confirm` and its resends. If
   P no longer holds the key, the answer is dropped, as under rule J.
2. **S2 and "acknowledged" are unchanged.** P's key for Q advances only
   when Q's `relay.token.issued` for the newer key arrives (§3.4 "The
   signal", S2). Nothing else moves it.
3. **S2's re-deposit** ("deposited again (the same bytes) with the new
   key") covers only entries on held tokens. Entries on carried tokens
   keep their token's key (rule 1). An update is never re-deposited as
   the same bytes (2.6).
4. **Tokens in P's handshake messages during S1** are minted by K′'s
   mailbox (2.4, owner decision 2026-11-12, 7.5 a). §3.4 (a)'s old-key
   minting exception then goes unused for reconnects.

**How G2 now closes.**
1. Q's reconnect `hs.init` carries tokens naming K′ (rule 0).
2. P's `hs.resp` goes with K′ (rule 1), and both the relay and Q accept
   it.
3. Q's `hs.fin` establishes the epoch at P. P's `hs.confirm` goes with K′
   on the `hs.init`'s carried token.
4. Q confirms, and its prompt `relay.token.issued` (§6.3.1 "The prompt to
   adopt") carries tokens naming K′. That is S2's signal, so S2 advances
   and the pair is acknowledged.
5. Q's own `relay.token.issued` under rule U, held while Q was demoted,
   goes out under the new epoch.

**Its cost.** Until Q's prompt arrives, P's other traffic to Q waits under
S1. That is one hop more than an earlier advance would take.

**What it does to O1a's premise.** O1a's premise is that P deposits only
with a key Q is known to accept. Rule 1 deposits a handshake's own
messages with K′ before P knows that Q has followed. The evidence is the
carried token's `sub`. That token was minted by a holder of Q's relay
key, but it is not yet authenticated by Q's handshake.
- If an old copy of Q sent the `hs.init`, the answer goes to Q's mailbox
  with K′. The real Q, which has not followed, refuses it as
  `foreign_sender`. Only that one handshake is lost.
- Nothing else moves earlier, and gap 1 stands.

**Security.** An unauthenticated token picks only the deposit key for its
own handshake's messages. S2, the resends and the deletion of K are
untouched.

### 2.2 G1 and G3: G1-N, with the shipped behaviour written into the spec (owner decisions 2026-11-12, 7.1 a, 7.3 a)

**S. The shipped behaviour, now the spec.**
- **S-a.** A reconnect after a demotion, or by strict F1, starts once it
  can (`canReconnect`). It then:
  - abandons the side's own rekeys;
  - drops its open answers to the peer's rekeys (release-29 rekeys carry
    no tokens, so nothing is revoked);
  - abandons its pending epoch.
- **S-a's guard.** A side with a pending epoch of its own does not retry
  the demotion reconnect until that epoch is confirmed (which ends the
  demotion) or abandoned, at `B` at the latest. This is shipped:
  `tickDemoted` returns while a pending epoch exists, and the epoch ends
  at `B`, after which `restartAfterDemotion` runs.
  - The wait can reach `B` = 32 days.
  - In the model, a demoted record with its own pending reconnect occurs
    in 91 and 111 of 10,000 runs, and 3 and 2 of those end `stale`.
  - S1's pause (7.10 b) is what lets this wait finish (4).
- **S-b.** While a reconnect naming an epoch other than the current one
  is open, a rekey `hs.init` from the peer is discarded
  (`rekey_replaced_by_reconnect`).
- **S-c.** A pending epoch, and `B`, start at the write that queues its
  `hs.fin`.
- **S-d.** Between persons, only an answer to a peer's **reconnect**
  holds a side's own reconnect.

**Amendments to the spec text:**
- **Rule J** ends: "Then the rekey block of §6.5 does not hold `R`
  back."
- **§6.5's crossing sentence** gains: "except that a reconnect after a
  demotion or by strict F1 replaces the side's rekeys and its answers to
  the peer's (§3.4.1)".

**N1. Q's mirror of S2.**
- When Q follows a relay link, it abandons and restarts each of its own
  open reconnects that meets both conditions:
  - its `hs.init` carried tokens naming the passed key;
  - it has sent no `hs.fin`.
- The reconnect whose message made the follow is not restarted.
- The abandonment is Q's own step, so it revokes the carried tokens.
- The restart uses the update's fresh K′ reconnect token.
- N1 runs after any establishment in the same write.

**N2. Two messages pass the cut-off.** This applies between two vaults
only, and only while Q has accepted no message from P's newer key. In
Table A, row "Earlier, after its cut-off", Q processes:
- an **`hs.confirm`** under an epoch whose keys were established under a
  handshake signed by Q's current `ik` for P;
- an **`hs.fin` to an answer Q has open**, whose `sig_I` verifies under
  the pinned `ik`, when that `ik` is Q's current `ik` for P.

Binding L makes both safe (2.6). A device rotates no `ik`, so N2 does not
apply to a device's relay key.

**The G3 cases.**

| Q followed | Q is | Covered by |
|---|---|---|
| before its `hs.init` | initiator | rule 1 |
| after its `hs.init`, before `hs.fin` | initiator | N1 |
| after its `hs.fin` (its reconnect pending) | initiator | N2 (`hs.confirm`) |
| after answering P's reconnect, by an update processed late | responder | N2 (`hs.fin`) |

**The held rekey `hs.fin`.**
- If Q has an epoch, Q's token comes and S2 re-deposits the `hs.fin`.
- If Q is demoted, S-a drops Q's answer. P's pending rekey epoch ends
  when Q's reconnect is established at P, and the held `hs.fin` goes with
  it.

**What this reverses.** #536 O1a, for these two messages.

**I3's wording.** "... except tokens that pass rule T, duplicates of
followed links, and, until Q first accepts a message from P's newer key,
an `hs.confirm` or an `hs.fin` to an answer Q has open, authenticated
under Q's current `ik` for P, which a copy taken before that `ik` was
written cannot make."

**The decoupled-rotation residual.** In some rotations the relay key is
generated after the current `ik`: a gate-owed key, or the next key after a
pending one. A copy taken between that `ik`'s write and the relay key's
first write holds both. It can confirm, or finish a reconnect that Q
answered, through K until the narrowing closes. That is within the
existing residual "An old copy ... can confirm Q's pending epoch as P",
and within §11.14.2.

### 2.3 Binding L: the update carries P's `ik` links (owner decision 2026-11-12, 7.2 a)

- The update carries `rotations`, as S8 says for `identity.rotate`.
- Every deposit of an update is **sealed afresh under the then-current
  epoch**, with its links made again: each resend, each held update when
  it goes out, and after S2's advance.
- Q applies the update's links first, in the same write:
  - rule C;
  - Table B;
  - H5;
  - the demotion rules;
  - R29-K9, on a duplicate update too.
- If Table B refuses a link, Q follows no relay link from that update.
- **The guarantee.** No copy taken before the write of the `ik` current
  at the relay link's first write can pass N2 or 2.4. It is not absolute
  for decoupled rotations (2.2).
- **K9 at the update** is sound on the same argument as at
  `identity.rotate`: every copy of the update is sealed under P's current
  epoch at its deposit. This is to be modelled.
- **Side effect.** The update can demote Q (strict F1).

### 2.4 G7, and the answer past the grace: links in reconnects (owner decision 2026-11-12, 7.5 a)

**What P sends.** During S1, two messages **announce K′**:
- P's reconnect `hs.init` does, in `from.relay`;
- P's `hs.resp` to Q's reconnect does, in a new field.

Each of the two carries:
- `relay_links` from K to K′;
- P's `ik` links (binding L);
- `token` and `reconnect_token`, minted by K′'s mailbox (rule 4).

Each is still deposited with K (rule 1).

**When Q accepts them.** Q accepts these from K, before or after K's
cut-off, when all three hold:
- the links connect the `sender` to the announced key;
- the links pass rule C;
- the announced key is Q's current key, or is reached through the links.

Without the links, a reconnect `hs.init` from K after the cut-off stays
refused.

**When Q follows.**
- For an `hs.init`: at the verified `hs.fin` that establishes it. That
  `hs.fin` is the cut-off, and it counts as before it.
- For an `hs.resp`: at its verified `sig_R`. The `hs.resp` is the
  cut-off.
- In that write Q applies the `ik` links first, then the relay links,
  then takes the tokens by rule T.

**Other effects.**
- At the second write, P abandons and restarts, by these rules, its open
  reconnects that announced K and have sent no `hs.fin`.
- The Q-side hold (3.3) also ends at such a follow.

**How Q gets a usable K′-mailbox token.**
1. Q's `hs.confirm` goes into K′'s mailbox on the `hs.init`'s carried
   token.
2. P confirms and sends its prompt `relay.token.issued` with K.
3. That prompt reaches Q after the cut-off, so Table A takes only its
   tokens, by rule T. Q keeps them as held tokens; there is no adoption.
4. Q's own `relay.token.issued` for K′ goes into K′'s mailbox on one of
   those tokens. That is S2's signal at P: acknowledged.

**Safety.** The design rests on `sig_I` or `sig_R` verifying under an
`ik` that Q reaches, together with binding L.
- A copy taken before the rotation's first write holds only an ancestor
  `ik`, which Table B refuses.
- A copy taken after that write counts as P.
- The cap on answers opens only to messages that carry valid links.

**The bound.** About 6`U`, with one `U` per hop:
1. the `hs.init`;
2. the `hs.resp`;
3. the `hs.fin`, at which Q follows;
4. the `hs.confirm`;
5. P's prompt;
6. Q's token.

If P must first wait for its own demotion to resolve, add a round. That
needs a rotation by Q, so it is covered in 4 under "both sides rotate".

### 2.5 G6: the revoked reconnect token during S1

- **No failed try, no stale.** During S1 toward Q, take a `token_revoked`
  on a **reconnect** token issued for an earlier key of P.
  - It is not a failed try.
  - It does not trigger "The reconnect bound"'s "no reconnect token"
    judgement. That judgement is suspended while P is in S1 toward Q and
    holds no reconnect token only because of such a revocation. S1
    bounds the suspension (7.10).
  - P stops using that token.
  - This changes the shipped `noReconnectToken` path, for relay-key
    rotation only.
- **S9 at S1's end** (owner decision 2026-11-12, 7.12 b).
  - A reconnect-token revocation is what an honest follow looks like, so
    it no longer starts S9's 24-hour clock.
  - When S1 ends a recipient `stale` and a reconnect token for an earlier
    key was revoked, the member gets S9's fork text instead of the plain
    stale text.
- **What P waits for.** Q's reconnect, or Q's `relay.token.issued`.
  - If P is demoted, it refuses Q's messages under the demoted epoch.
    Q's token then arrives only under the epoch that P's demotion
    reconnect (2.4) makes.
  - That reconnect goes on a K′ reconnect token once Q's
    `relay.token.issued` has delivered one.
  - An oracle checks this (6).

### 2.6 Updates are never re-deposited as the same bytes

S2's same-bytes re-deposit does not apply to updates. An update is sealed
afresh at each deposit (2.3), so K9 at the update always judges a copy
sealed under P's then-current epoch.

### 2.7 G9: a refused reconnect, and the links of a refused update (owner decision 2026-11-12, 7.11 a)

- **A refused reconnect is a failed try at once.**
  - A definite refusal of a reconnect `hs.init` ends that try at once:
    `mailbox_unknown`, `token_revoked` on its own token, or another `4xx`
    other than `429`.
  - It counts as a failed try under "The reconnect bound".
  - The next try starts as soon as a newer mailbox or token for P is
    known.
  - Exception: a `mailbox_unknown` for an earlier mailbox of P is not
    counted while Q knows no newer one. Q waits for the links instead,
    bounded by the hold's limit (60 days).
  - This changes the shipped outbox refusal path.
- **The links of a refused update.** Q may refuse an update only because
  its epoch is demoted or destroyed. Its links are still applied, in the
  write that refuses it, after rule C: binding L's `ik` links first, then
  the relay links. This mirrors §6.6 "The links of a refused reconnect".
  - Q then knows P's new mailbox, and its next try goes there under 2.4.
  - Its tokens are not taken.
  - *Unsure:* which K′-mailbox token Q's try then uses. It may be the
    reconnect token of a later accepted message, or one that P's own 2.4
    messages carry. To be checked in the model.
- **Safety.**
  - The relay links carry K's and K′'s signatures, made in the rotation's
    first write.
  - The `ik` links are checked by Table B before any relay link is
    followed.

---

## 3. The crash order between the relay's rotate and the state write

### 3.1 What §3.4 says

"Stores first, then rotates, and retries with the same key." The three
paths follow it. The one exception is a recovery's fresh key after a
refused registration.

### 3.2 What each crash point leaves

"Grace loss" (3.3) means deposits the relay accepted into K's mailbox
after P's last collect of it. The telling (3.3) re-deposits them.

| Crash point | State | Relay | Next unlock | Lost |
|---|---|---|---|---|
| C0: before the first write | K current; an owed mark, if written | old mailbox | the mark retries | nothing |
| C1: after the first write, before the rotate | K current, K′ pending; new `ik`; `identity.rotate` sent | old mailbox | the rotate, same K′ | nothing |
| C2: after the rotate, before the second write | as C1 | both; the grace has started | the rotate again, then the second write; past the grace, the registration (`200` continues; `201` re-mints all) | grace loss, widened by `U`; re-deposited by the telling |
| C3: after the second write, before the updates leave | K′ current; K for deposits | both | the outbox sends them | grace loss, as without a crash; re-deposited |
| C2′: after K1's second write, which also stores K2 | K1 current, K2 pending | K1's mailbox; K's in its grace | as C1, for K2 | grace loss for K's mailbox; re-deposited |
| CR: a definite refusal, before its write | as C1 or C2 | unchanged | refused again, then written | as C1 or C2 |
| CF: a recovery's fresh key, registered before any state holds it | the inherited key, refused | an empty mailbox nobody was told of | the open is retried | an orphaned mailbox (within the relay's limit of 3) |

### 3.3 The old mailbox's end (owner decisions 2026-11-12, 7.6 c, 7.7 a, 7.8 b, 7.9 a)

Q keeps depositing to K's mailbox until it follows, and P collects that
mailbox only when it unlocks.

**When the old mailbox goes quiet.** Counted from the rotate, under A3,
Q has stopped depositing to K and P has collected it:
- on the **update path**, after 2`U`;
- on **2.4**, after 4`U`;
- on **2.4 with P first waiting a round**, after 8`U`.

A C2 crash adds `U` to each of these.

**G8: both sides' old mailboxes end.** Each side's update, or its 2.4
`hs.init`, must reach the other before the other's grace ends:
- on the update path, about 3`U` from the later rotate;
- on 2.4 with a demoted side, up to 8`U`.

**The grace: 14 days.**
- This is 3`U` plus a margin. It covers G8 on the update path. On the
  2.4 path, accepted deposits after P's last collect are re-deposited by
  the telling, and refused ones are held.
- The grace is a relay setting, so this changes the deployed relay
  configuration and the default in RELAY-PROTOCOL §6.7. It applies to
  every mailbox, devices' rotations included.
- An old copy keeps the live old mailbox for 14 days at every rotation,
  where it was 7 (§3.4.1 Residuals).

**The Q-side hold: 60 days.**
- **What is held.** A deposit to P's mailbox that is refused
  `mailbox_unknown`. It is held while all three are true:
  - the connection is active;
  - since the first refusal, no update from P has named a newer mailbox;
  - Q has not followed by 2.4.
- **What holding means.** The deposit is not ended
  (`drop.undelivered_mailbox_unknown`). It is not a failed try, and not a
  reason for `stale`.
- **When the hold ends.**
  - At a follow, which re-addresses the deposit.
  - At the connection's end.
  - At 60 days. The message is then told by the existing
    `message.not_delivered`, and §8.6 applies as today.
- **What the member sees.** A held message shows as held, never as sent:
  "Waiting to reach <First Last> at their vault's new address." (approved
  2026-11-12).
- **What a copy sees.** A refused deposit is not stored at the relay, so
  an old copy that collects K cannot read it.

**The telling (`relay.mailbox.closed`).**
1. P stops collecting K's mailbox: when it gets `mailbox_unknown` on a
   collect of K, or when it acks its last collect there.
2. P records the largest `msg_id` it collected from K. All the times
   compared are relay times: the ULID is in arrival order per mailbox
   (RELAY-PROTOCOL §6.2).
3. P sends each recipient a **separate** durable message,
   `relay.mailbox.closed {mailbox, last_msg_id}`.
   - It is sealed under P's then-current epoch with Q.
   - It goes on every path: the update path, 2.4, and after a crash.
   - While P has no epoch with Q, it is held like any durable message.
4. Q keeps each of its **outbox entries** deposited to K, with the
   `msg_id` of its `201`, until that message comes or the hold's limit
   ends. These are the entries themselves, not a log.
5. On `relay.mailbox.closed`, Q re-deposits every kept entry whose
   `msg_id` is greater than `last_msg_id`, to P's current mailbox, with
   the same inner `id`. Q drops the rest.
6. P dedupes the re-deposits by inner `id` (§8.2).
7. An entry still kept at the hold's limit is told as
   `message.delivery_unconfirmed`. Its text was approved 2026-11-11 and
   is reused for this trigger (approved 2026-11-12).

No clock skew is involved, because only relay `msg_id`s are compared.

**The second write** lists its S1 state: P's key for each Q, and the start
of S1's clock.

---

## 4. Liveness argument sketch (the chosen design)

**The design argued.**
- G2-B with the signal unchanged (2.1);
- G1-N with S (2.2);
- binding L (2.3);
- 2.4, 2.5 and 2.7;
- the 14-day grace, the 60-day hold and the telling (3.3);
- S1's pause (7.10 b).

It covers pairs of vaults. Device pairs are in 1.5.

### Assumptions

- **A1 to A4:** as in 0.88.2.
- **`t_r`:** the last write, by either side, that stores an `ik` or a
  relay key. That includes a gate-owed key, at most 30 days after the
  gate's mark, and the next key after a pending one.
- **A5′:** relay keys rotate, and both sides advertise `relay_follow`.
- **A6:** the grace is 14 days. The hold and the telling apply.
- **A7:** no rotate is definitively refused.

### Progress measure

Φ = (π, ν, μ, λ, δ, ρ), compared in that order:
- **π:** the pending relay keys;
- **ν:** the (side, recipient) pairs where the recipient has not
  followed;
- **μ:** the pairs where the side's key for the recipient is not its
  current key, that is, not yet acknowledged;
- **λ, δ, ρ:** as in 0.88.2.

Why Φ decreases:
- A pending key's second write raises ν and μ, but π falls in that same
  write.
- Under binding L, δ and ρ rise only where ν or λ falls.
- The restarts of S2 and N1 happen only where μ or ν falls.

### Steps

- **Step 0.** π reaches 0 within `U` of `t_r`.
- **Step 1.** ν reaches 0 within 2`U` of the second write on the update
  path, or about 3`U` on 2.4. λ reaches 0 by `t_r` + 3`U`.
- **Step 2.** μ reaches 0. Every wait names what ends it:

| Wait | Ended by | Bound | Why no cycle |
|---|---|---|---|
| The update reaching Q | S1 lets it through; §3.4 (b) resends it at each unlock. While P has no epoch, 2.4 carries the links instead | `U`; 2.4: three hops | needs nothing from Q's acknowledgment |
| Q following | rule U or 2.4, with binding L. If the links demote Q, the next row's (b) applies. An update refused under a demoted epoch still has its links applied (2.7) | one hop | needs nothing more from P |
| Q's acknowledgment (μ) | (a) Q has an epoch: rule U's `relay.token.issued`. (b) Q is demoted: its reconnect runs (S-a, S-d), N1 restarts it if needed, rule 1 delivers P's answer and `hs.confirm`, and Q's prompt `relay.token.issued` advances S2. (c) Q is pending: N2 lets P's `hs.confirm` through, then (a). (d) Q is responding: N2 lets P's `hs.fin` through, then (a) | (a) one hop; (b) about 6`U` from `w`; (c), (d) one hop more / "The reconnect bound" | Q never waits for a message that P holds for want of Q's acknowledgment: every message Q needs passes S1 and the cut-off |
| A demoted Q with its own pending reconnect | S-a's guard: retried at `B` | 32 days | S1 is paused while P has Q's authenticated `hs.fin` (7.10 b) |
| P with no usable reconnect token after a revocation | the no-token judgement suspended during S1 (2.5); the previous rows | within S1 | the revocation is Q's own follow |
| A refused reconnect `hs.init` | a failed try at once; the next try once a newer mailbox is known (2.7) | one hop after the links | — |
| P's held rekey messages | S2's re-deposit, or dropped (S-a, §6.3.1); `B` from the queued `hs.fin` (S-c) | one round / `B` | not needed for progress under G1-N |
| P's other entries held by S1 | S2's advance (Q's `relay.token.issued`) | as μ | — |
| Q's refused deposits to K | the hold, until the follow | the first two rows; 60 days at most | — |
| Q's accepted deposits after P's last collect | the telling | one hop after P's last collect | — |

### The bound, counted from P's second write `w`

**One side rotates:** about 6`U` at worst, which is 24 days at `U` = 4.
- Q has an epoch: 2`U`.
- Q is demoted: about 6`U`. That is one hop more than an advance on the
  `hs.fin` would take; it is the cost of 7.4 c.
- 2.4: about 6`U`.
- S-a's guard can add up to `B` while Q's pending reconnect waits.

**Both sides rotate.** Q may have no current epoch until 0.88.2's
settling at `t_r` + 12`U`. So the bound is `t_r` + 13`U`, with no ceiling
counted from `w`.
- S1's pause (7.10 b) covers both waits whenever P keeps receiving Q's
  authenticated messages.
- The cap of 60 days bounds S1 in all cases.

### What still ends `stale`, visibly

- 0.88.2's list;
- S1, at 30 days of S1 time and 60 days at the cap;
- the gate's deadline;
- G8 on the 2.4 path, past the 14-day grace;
- the open interaction of 7.16 (1), if the model shows it.

---

## 5. Other wait cycles, and the residuals of the chosen design

### Wait cycles

- **G3.** Closed by 2.2 (N1, N2).
- **G4: both sides rotate.**
  - **How common it is.** In the aligned model, G4 occurs in almost half
    of the stale ends: 53 of 118 (seed 1) and 51 of 111 (seed 2). It is
    an ordinary case (6).
  - **Within one hop.** Q's `relay.token.issued` names an `iss` that P
    does not know yet. It is deferred, then refused, and the next resend
    replaces it.
  - **After P followed Q.** P's later update names Q's new key (S3),
    while Q, in its own S1, deposits only with its old key. P's rule U
    has also revoked Q's reconnect token for the old key. So a demoted Q
    has no usable reconnect token. The fix proposed in draft 6, an update
    as an S2 source, went with 7.4 a. This case is open (7.16 (1)).
- **G5.** S2's restart, as specified today, uses the reconnect token that
  Q's `relay.token.issued` delivers.
- **G6, G7, G9.** Closed by 2.5, 2.4 and 2.7.
- **G8: both sides' old mailboxes end.**
  - On the update path, the 14-day grace covers it under A3.
  - On the 2.4 path it remains: both sides hold until the hold's limit,
    then end `stale`. The member sees: "<First Last> and your vault both
    moved to new addresses and couldn't reach each other. Connect again
    with a new invitation." (approved 2026-11-12).
- **H5 and the reconnect token's quota.**
  - N1 uses the update's fresh K′ reconnect token.
  - 2.5 removes the failed tries on a revoked token.
- **The gate, rule U, H5.** No other cycle found.

### The residuals of the chosen design

The owner accepted these by choosing this set (owner decision
2026-11-12).

1. **G8 on the 2.4 path, past the 14-day grace.** Both sides end `stale`
   at the hold's limit, and the member sees G8's text.
2. **The old copy's window grows.** An old copy keeps the live old
   mailbox for 14 days at every rotation, instead of 7.
3. **Deposits after P's last collect of K.** The telling re-deposits
   them. If the telling does not arrive within 60 days, they are told as
   `message.delivery_unconfirmed`, which is visible but not delivered.
4. **A deleted peer whose `connection.removed` was lost.** The member
   sees up to 60 days of "Waiting to reach …" before `message.not_delivered`.
5. **A recipient that does not follow within S1.** This covers 30 days of
   S1 time, or up to 60 days while paused on its messages. Such a
   recipient ends `stale`. If a reconnect token for an earlier key was
   revoked, the member sees S9's fork text.
6. **A real relay fork is shown at S1's end**, not after 24 hours (7.12
   b).
7. **A device offline past the grace** is paired again, as §6.6 "Limits"
   says.
8. **The decoupled-rotation copy** can confirm, or finish a reconnect Q
   answered, until the narrowing closes (2.2). This is within the
   existing residuals.
9. **P's other traffic during S1 waits for Q's `relay.token.issued`.** In
   the demoted case that is about one hop longer than an earlier advance
   (7.4 c).
10. **The rapid-rotation rate** is to be measured again under rotation.

---

## Spec changes this implies

**VAULT-MESSAGING**

- **§3.4 "The order of a relay-key rotation".** The second write lists its
  S1 state.
- **§3.4 (a).** Exception 2 (old-key minting for a reconnect `hs.init`) is
  dropped for reconnects.
- **§3.4.1 Table A.**
  - The preamble: a reconnect `hs.init` or `hs.resp` from an earlier key,
    with links to its announced key, is accepted (2.4).
  - The row "Earlier, after its cut-off": an `hs.confirm`, and an `hs.fin`
    to an open answer, between vaults, until Q accepts from the newer key
    (N2). The 2.4 reconnect messages with links.
- **§3.4.1 rule U.**
  - Binding L: the update carries `rotations`; its links are applied
    first; K9 runs on it and on a duplicate; it is sealed afresh at each
    deposit.
  - Following by 2.4's links.
  - The links of a refused update (2.7).
- **§3.4.1 rule T.** The reconnect clause: `iss` is the announced key's
  mailbox.
- **§3.4.1 S1 to S3.**
  - S1's clock pauses on Q's authenticated messages (16, 30 and 60 days).
  - S2's same-bytes re-deposit covers only held-token entries, never an
    update.
  - Rule 0, S3's rule applied to Q.
  - Rule 1: messages on carried tokens use their token's key.
- **§3.4.1 S9.** S9 at S1's end. A reconnect-token revocation no longer
  starts it.
- **§3.4.1 "The reconnect bound".**
  - A revoked reconnect token for an earlier key is not a failed try, and
    the no-token judgement is suspended during S1 (2.5).
  - A refused reconnect `hs.init` is a failed try at once (2.7).
- **§3.4.1 "After a demotion".** S-a, with its guard, and N1.
- **§3.4.1 elsewhere.**
  - The lost-token sentence is qualified.
  - I3's wording.
  - The liveness argument's A5 is replaced (4).
  - The Residuals list (5).
  - The 0.88.2 `hs.confirm` paragraph is corrected (owner decision
    2026-11-12, 7.14 a).
- **§6.2.**
  - `from.relay` during S1.
  - New `relay_links` field, in `hs.init` and in a reconnect's `hs.resp`.
  - The announced key in `hs.resp`.
  - The tokens stay required.
- **§6.3.**
  - The `sender` check gives way to linked keys.
  - Verification: S-c (pending at the queued `hs.fin`).
- **§6.3.1.**
  - Rule J amended.
  - `B` starts at the queued `hs.fin` (S-c).
- **§6.5.** The crossing sentence gets its exception.
- **§6.6.**
  - "Initiating" and "Authentication" for linked keys.
  - "Between two persons" (S-d).
  - "Limits": the G7 sentence goes.
- **§8.3 and §8.6.**
  - `mailbox_unknown` on a peer's earlier mailbox: the 60-day hold, the
    held state, and `message.not_delivered` at the limit.
  - The refused reconnect path (2.7).
  - The re-deposit after `relay.mailbox.closed`.
- **The message tables.** New type `relay.mailbox.closed {mailbox,
  last_msg_id}`, vault to vault, durable.
- **Member texts** (approved 2026-11-12), with the apps' plans updated:
  - the held state;
  - G8's stale text;
  - S9's text at S1's end;
  - `message.delivery_unconfirmed` for the hold's limit.

**RELAY-PROTOCOL**

- **§6.7.** The rotation grace's default goes from 7 to 14 days, and so
  does the deployed relay configuration. It applies to every mailbox.

---

## 6. Next steps (owner decision 2026-11-12, 7.13 a)

### What exists

- **The vault code has no rotating side.**
  - `rotateIdentity` leaves the relay key alone, and a test pins A5.
  - `Relay` has no rotate call.
  - `hAddressUpdate` predates 0.85.
- **The random-pair harness has no relay-key mode.** Its modes are the
  default, `R29RP_BURST`, `R29RP_SHUFFLE`, `R29RP_REFRESH`,
  `R29RP_SPENT` and `R29RP_LOSTANS`, replayed with `R29RP_TRACE` and
  `R29RP_REPEAT`.
- **The trust model.**
  - `TRUSTMODEL_RELAYROT=1`, aligned with S-a to S-d.
  - Every stale end is labelled with the wait it was stuck in.
  - It has one own-handshake slot (see "A model limitation").

### The trust model's numbers (before the chosen fixes)

These are stale ends per 10,000 runs per seed, with relay-key rotation
on. The classifier is a heuristic: each row lists gaps that occurred
together.

**Before and after aligning the model with S-a, S-b and S-d.**

| Wait class | Seed 1 | Seed 2 |
|---|---|---|
| G1 + G2 | 58 → 0 | 53 → 1 |
| G2 alone | 44 → 99 | 41 → 90 |
| G2 with G3, G6 or G7 (no G1) | 2 → 8 | 6 → 11 |
| G1 + G2 + G3 | 1 → 0 | 0 → 0 |
| G1 + G7 | 1 → 0 | 0 → 0 |
| G1 + G2 + G7 | 2 → 0 | 1 → 0 |
| G1 + G6 | 0 → 0 | 1 → 0 |
| G3 | 1 → 1 | 0 → 0 |
| G6 | 1 → 1 | 1 → 1 |
| G7 | 7 → 7 | 6 → 6 |
| other | 2 → 2 | 2 → 2 |
| **Total** | **119 → 118** | **111 → 111** |

**After the alignment, with the G4 and G8 labels.** G4 means both sides
are in S1. A reconnect `hs.init` keeps the mailbox it was queued for, as
`startReconnectCtx` does.

| Wait class | Seed 1 | Seed 2 |
|---|---|---|
| G2 | 63 | 56 |
| G2 + G4 + G6 | 30 | 30 |
| G2 + G3 + G4 | 6 | 6 |
| G2 + G4 | 3 | 4 |
| G2 + G4 + G7 | 3 | 0 |
| G2 + G4 + G6 + G7 | 2 | 3 |
| G2 + G3 + G4 + G6 | 2 | 1 |
| G4 + G7 + G8 | 5 | 5 |
| the rest | G2 + G7: 1; G3: 1; G4 + G6: 1; G4 + G7: 1 | G1 + G2: 1; G2 + G3: 2; G2 + G4 + G6 + G7 + G8: 1; G4 + G7: 1; G6: 1 |
| other | 0 | 0 |
| **Total** | **118** | **111** |

**What the numbers show.**
- Runs with a violation: 109 and 96 with rotation on; 0 and 2 with
  rotation off. The two with rotation off predate this work.
- Seed 2 has one I1 loss, of class G3 + G4 + G7.
- One I2 per run set is not classified yet.
- One finding in the default configuration was a model error and is
  resolved. The vault makes it visible at the honest side's reconnect
  `hs.fin`, through Fork by ctx. The test is vettid-vault `ab9beb8`, on
  branch `i7-realcode`, test only, and the model now does the same
  (`0cbab85`). The exposure before that point is the release-29 residual
  of VAULT-MESSAGING §3.4.1.

**A model limitation.**
- The model blocks a reconnect beside an open own rekey. The shipped
  vault does not: `startReconnectCtx` checks only for an open own
  reconnect.
- This happens in about 40% of rotation-on runs.
- An experiment that abandons the rekey instead leaves the stale counts
  unchanged.

### Steps

1. **The model, with the chosen rules, each behind its own switch.**
   - The switches:
     - rule 0 and rule 1 (G2-B);
     - rules 3 and 4 (S2's re-deposit; tokens from K′'s mailbox);
     - N1 and N2;
     - S-a's guard;
     - binding L, with K9 on the update, on a duplicate and on every
       resend, and every update sealed afresh;
     - 2.4, both `hs.init` and `hs.resp`;
     - 2.5, with the suspended judgement and S9 at S1's end;
     - 2.7, with the immediate failed try and the links of a refused
       update;
     - the 14-day grace, the 60-day hold, and the telling;
     - S1's pause (16, 30 and 60 days).
   - Two concurrent own handshakes per side, as the vault allows.
   - The open case of 7.16 (1), measured.
   - Run with `TRUSTMODEL_RELAYROT=1`, with and without ROTBURST, at
     10,000 runs, then at 100,000.
   - The old-copy actor must break I3 when binding L is off.
   - A device-pair configuration.
2. **The code branch, not merged.**
   - The rotating side, rule U with binding L, Table A's earlier rows,
     and every rule above.
   - A stub relay with:
     - an idempotent rotate;
     - the 14-day grace, with collects from both mailboxes;
     - tombstones;
     - `mailbox_unknown` after the grace;
     - step 7 of §5.3;
     - the denylist.
3. **The harness mode `R29RP_RELAYROT`.**
   - **Rotations:** all three paths, and the decoupled keys.
   - **Crashes:** C1, C2, C3, C2′, CR, CF.
   - **Schedules:**
     - locks around the grace;
     - P demoted at its second write (G7);
     - Q following at each point of a reconnect, as initiator and as
       responder;
     - G4 within one hop, and after P has followed Q;
     - G8 with locks around both graces;
     - G9: a demoted side down past the peer's grace.
   - **Oracles:**
     - I1 extended (ν = μ = 0; nothing held by S1);
     - I2, I5, and I3-lite;
     - S2 advances only on `relay.token.issued`;
     - rule 0: no token of Q's names a key it only saw announced;
     - no S9 fork text in an honest run;
     - no `stale` from "no reconnect token" while in S1 after a
       revocation for an earlier key;
     - a demoted P takes Q's token only under a new epoch;
     - every `201`'d deposit is collected, re-deposited or told;
     - every held message is shown as held.
   - **Counters:**
     - reconnect-token deposits per rotation;
     - the time from `w` to μ = 0, against S1's clock;
     - S-a's guard waits.
4. **The bar.**
   - 0 honest runs end `stale`, diverged or suspended outside the
     residuals of §5, at 10,000 runs per mode: `R29RP_RELAYROT` crossed
     with every mode, plus every mode alone.
   - Counted from the `-v` class table and the counters (`-test.v` for a
     prebuilt binary), never from a PASS.
   - Each new oracle is shown to fire before its zero is reported.

---

## 7. Owner decisions (2026-11-12)

Each question is listed with the decision taken; the options that were
not chosen get one line each.

### 7.1 The shipped release-29 behaviour, written into the spec

- **Decided: a, `spec follows shipped`** (owner decision 2026-11-12). S-a
  to S-d go into the spec, and Rule J and §6.5 are amended (2.2).
- Not chosen: b, `code follows the spec`.

### 7.2 Binding the `ik` to the relay link

- **Decided: a, `ik links in the update`** (owner decision 2026-11-12).
  This is binding L (2.3).
- Not chosen: b, `ik in the relay link`.

### 7.3 What passes Q's cut-off

- **Decided: a, `confirm+fin, Q restart`** (owner decision 2026-11-12).
  This is G1-N: N1 and N2 (2.2). It reverses #536 O1a for those two
  messages.
- Not chosen:
  - b, `signed hs msgs pass` (G1-A);
  - c, `nothing passes`.

### 7.4 The acknowledgment rule

- **Decided: c, `signal unchanged + G2-B`** (owner decision 2026-11-12).
  "Gap 1" (2026-11-05) stands. S2 waits for `relay.token.issued`, and only
  messages on carried tokens pick their token's key (2.1).
- Not chosen:
  - a, `ack needs held K′ token`: G2-H's extra S2 sources, its bounded
    wait, its restarts, its resends on carried tokens, and the §3.4 (b)
    amendment;
  - b, `ack at S2's advance`.

### 7.5 Reaching Q when the old mailbox cannot

- **Decided: a, `links in reconnects`** (owner decision 2026-11-12). This
  is 2.4, with rule 4 (tokens from K′'s mailbox) and rule T's reconnect
  clause.
- Not chosen:
  - b, `grace while unacked`;
  - c, `accept as residual`.

### 7.6 The old mailbox's end

- **Decided: c, `14 days, hold and tell`** (owner decision 2026-11-12).
  The relay's grace goes from 7 to 14 days, in the deployed configuration
  and in RELAY-PROTOCOL §6.7, devices included. G8 is covered on the
  update path only, and the 2.4-path G8 is a residual (5).
- Not chosen:
  - a, `grace 36 days`;
  - b, `7 days, hold and tell`;
  - d, `forwarding, contested`. This was not chosen and is not designed;
    relay forwarding as first written was unsafe.

### 7.7 The Q-side hold

- **Decided: a, `hold refused deposits`** (owner decision 2026-11-12).
- Not chosen: b, `no hold, stale as today`.

### 7.8 The hold's limit, and how a held message is shown

- **Decided: b, `hold 60 days`** (owner decision 2026-11-12). A held
  message is shown as held. At the limit it becomes
  `message.not_delivered`.
- Not chosen: a, `hold 30 days`.

### 7.9 The telling

- **Decided: a, `tell and re-deposit`** (owner decision 2026-11-12). This
  is `relay.mailbox.closed` (3.3).
- Not chosen: b, `no telling`.

### 7.10 S1's clock

- **Decided: b, `pause on Q, cap 60`** (owner decision 2026-11-12), with
  16, 30 and 60 days. S1's 30 days do not run while P has accepted an
  authenticated message from Q in the last 16 days, capped at 60 days
  after the second write.
- Not chosen:
  - a, `restart on Q, cap 60`;
  - c, `S1 of 60 days`;
  - d, `keep 30 days`.

### 7.11 A refused reconnect `hs.init` (G9)

- **Decided: a, `fail now, follow links`** (owner decision 2026-11-12).
  This is 2.7, and it changes the shipped refusal path.
- Not chosen: b, `keep the 16-day wait`.

### 7.12 S9

- **Decided: b, `S9 at S1's end`** (owner decision 2026-11-12) (2.5).
- Not chosen:
  - a, `S9 on standing only`;
  - c, `Q revokes on relay fork`.

### 7.13 How to meet "search on the real code"

- **Decided: a, `model, then code branch`** (owner decision 2026-11-12)
  (6).
- Not chosen: b, `code branch only`.

### 7.14 0.88.2's `hs.confirm` paragraph

- **Decided: a, `fix in the redesign PR`** (owner decision 2026-11-12).
- Not chosen: b, `erratum now`.

### 7.15 Member-facing texts (all approved 2026-11-12)

1. **The held state:** "Waiting to reach <First Last> at their vault's
   new address."
2. **The hold's limit:** `message.delivery_unconfirmed`, reusing its
   approved text.
3. **G8's stale:** "<First Last> and your vault both moved to new
   addresses and couldn't reach each other. Connect again with a new
   invitation."
4. **S9 at S1's end:** "<connection name> may have connected to an old
   copy of your vault. Contact <connection name>."

### 7.16 Interactions to look at (not decided here)

1. **7.4 c leaves the G4 "after P followed Q" case without a fix.**
   - The case: P's rule U revokes Q's reconnect token for Q's old key,
     and P's later tokens name Q's new key. Q, in its own S1, deposits
     with its old key, so a demoted Q has no usable reconnect token.
   - Draft 6's fix was an update as an S2 source, and it went with 7.4 a.
     It may not have worked anyway: a demoted Q refuses that update under
     its demoted epoch.
   - G4 appears in about half of the model's stale ends. This case's
     share is not known.
   - A fix would be either G2-B extended to held reconnect tokens, or a
     residual. Either one goes beyond the decisions taken. To be measured
     in the model before the spec PR.
2. **The hold's 60 days against S1's clock.**
   - For a peer that cannot be reached (G9's waiting case, G8 on 2.4), P
     ends the connection `stale` at 30 days of S1 time. S1 does not pause,
     because nothing authenticated arrives from Q.
   - Meanwhile Q shows "Waiting to reach …" for up to 60 days. The two
     sides show different states for up to 30 days.
3. **S-a's guard and S1's pause.**
   - A demoted Q with a pending reconnect waits up to `B` (32 days).
   - S1 pauses for 16 days after Q's last authenticated message (its
     `hs.fin`), then runs again.
   - The 60-day cap covers the wait. Whether 30 days of S1 time can run
     out within it depends on when Q's `hs.fin` came. The model counts
     this (S-a's guard waits).
4. **Three answers change shipped vault behaviour:** 2.5 (the no-token
   judgement), 2.7 (the refusal path) and 7.6 (the relay's deployed
   grace). 7.1 a is about S-a to S-d only, so this is not a conflict,
   but these changes need their own code review.

---

## Draft 6 changes (for the record)

| Concern in draft 5 | Change | Where (draft 6) |
|---|---|---|
| The "telling" did not work as specified | Specified in full as a separate message after P's last collect of K, with Q re-depositing | 3.3 |
| G6's fix still ended the pair `stale` | The no-token judgement suspended during S1 | 2.5 |
| Rules 7–8 against §3.4 (b); K9 at the update | Amended; updates sealed afresh | 2.1; 2.6 |
| S9; the hold and "show held as held"; the §7 order | S9 at S1's end added; the held state shown; the questions reordered | 2.5; 3.3; 7 |
| The model's rows | Recounted, with G4 and G8 labels | 6 |
| G9 | A real gap; 2.7 | 1.8; 2.7 |
| `tickDemoted`'s guard | Written into S-a | 2.2 |
| Relay forwarding as first written was unsafe | Replaced by a contested form (later not chosen) | 3.3 |
