# Relay-key rotation without wait cycles: design note (draft 5)

For the owner and the lead. This note is read against VAULT-MESSAGING
0.89.1 (origin/master). The two errata of 0.89.1 change nothing below.
Every quoted section reads as in 0.88.18. RELAY-PROTOCOL is read on the
same master.

Sections 1 to 5 are meant to move into the spec. Sections 6 and 7 are
internal.

**Names used throughout.**
- **P** rotates its relay key from K to K′. **Q** is one recipient.
- **P's key for Q** is S1's term: the key P deposits to Q with.
- **Q has followed** means Q has applied the link K→K′. From then on, K is
  "earlier" at Q, and K has a **cut-off**.
- **S1 toward Q** is the time during which P's key for Q is not P's
  current key.
- **Acknowledged** (§3.4 "The signal") is a separate state. It ends the
  resends and allows the old key to be deleted. It is no longer the same
  as S2's advance (2.1 rule 7).

## Changes since draft 4

| Concern in draft 4 | Change | Where |
|---|---|---|
| the advance comes before P holds a K′ token | S2's advance (the deposit key) is split from "acknowledged". Acknowledged still needs a K′ token from Q that P holds. Resends go on until then, with K′ once it is P's key for Q. The reason recorded for gap 1 is now cited correctly (liveness, plus O1a's premise). New owner question | 1.2; 2.1 rules 7, 8; 7.7 |
| G3 with Q as the responder | N2 is extended to an `hs.fin` for an answer Q has open. 7.2's comparison is updated | 2.2 (N2); 7.3 |
| the 14-day grace is not complete on the 2.4 path | The grace is sized per path (5`U` and 9`U`). The 2.4-path loss is stated, and so are the changes to the deployed relay configuration and to RELAY-PROTOCOL §6.7, devices included | 3.3; 7.5 |
| both sides rotating relay keys | The stranding is stated, with what it needs from the grace, a harness schedule, and a residual for when that is not met | 5 (G8); 6; 7.5 |
| the both-sides bound has no ceiling | S1's clock restarts when P follows a link of Q's, under a hard cap. The numbers are in the choices of 7.6 | 4; 7.6 |
| the trust model is aligned with S-a to S-d | Numbers before and after the alignment. G2 is the main real gap. A finding without rotation is listed as under investigation | 1.3; 6 |
| §7 | Reordered, with each question's dependencies in its choice text. 7.6 has its numbers. S9 has one choice. New questions on the acknowledgment rule and on the hold's length | 7 |
| the 2.4 prompt arrives from K after the cut-off | Q keeps its tokens by rule T as held tokens, and uses them for its own `relay.token.issued` | 2.4 |
| G4 with an unknown `iss` | Says which key a kept reconnect uses. Rule 3 now covers deferred tokens | 2.1 rule 3; 5 |
| 7.1 oversold | Softened | 7.7 |
| 2.4's change list | Adds §6.6 "Initiating" and "Authentication" | 2.4 |
| 2.4's safety | Now rests on `sig_I` and `sig_R` under the reached `ik`, plus binding L | 2.4 |
| the order inside Q's follow write | Links first, then rule T | 2.4; 2.6 |
| 2.5's assumption | Stated: a demoted P takes Q's token only under a new epoch. Added as an oracle | 2.5; 6 |
| Nits | S-a's conditions, the pending epoch and its empty revocation clause; `rekey_replaced_by_reconnect`'s condition; "Q demoted" is about 5`U`; the device's 12-day resend; N1's exemption; the 2.4 cut-off counts the `hs.fin` | 2.2; 1.5; 4; 2.4 |

---

## 1. The gaps

### 1.1 What "demoted" means

"Demoted" is a state of an epoch (§3.4.1). An epoch is demoted in three
ways: by position ("Epochs after an `ik` link"), by "Strict F1", or from
the start, by a link ("Pending epochs at a link").

A **demoted Q** is in the state of "After a demotion of the current
epoch". It has no current epoch with P and sends "nothing but handshake
messages". It holds its durable messages, `relay.token.issued` included.
That message has no epoch to be sealed under, because earlier send keys
are erased (§6.5).

A Q whose own reconnect is **pending** is in the same position (§6.3.1
Initiator). Honest demotions happen around `ik` rotations.

### 1.2 The rules involved

- **§3.4 "The signal".** "Nothing else counts". This is the owner's
  decision "gap 1" of 2026-11-05 (the 0.85.0 draft, vettid.org at c7ee8f7;
  built in vettid-vault #203), on the premise of vettid.org #536 O1a. The
  reason recorded is **liveness**. A peer that "acknowledges" only by
  depositing to the new mailbox never sends P a new token. P would then
  delete its old key and could no longer reach that peer.
- **S1, S2, S3, S9, rule U, rule T.** As in §3.4.1.
  - Rule U makes Q revoke "the reconnect tokens it issued to the passed
    keys".
  - S9 waits "24 hours" after a `token_revoked`.
- **§6.2.** A reconnect's `token` and `reconnect_token` are "required".
- **§6.3.** The collect `sender` "MUST equal `from.relay.pk` for
  `hs.init`".
- **§6.6.** "Initiating": "`from.relay` names the relay key it is
  deposited with". "Authentication": "the collect `sender` equals the
  relay key on record".
- **§6.3.1.** Carried tokens serve only their own handshake. They are
  adopted at confirmation, and discarded at H5, at `B`, or at
  `token_revoked`.
- **RELAY-PROTOCOL §5.3 step 7.** The deposit key must equal the token's
  `sub`.
- **Table A, "Earlier, after its cut-off".** Everything is refused except
  the update, the tokens of `relay.token.issued` ("tokens by rule T
  only"), and an `identity.rotate` that is already followed.
- **The update carries only relay links.** §8.4 does not order it against
  `identity.rotate`.
- **RELAY-PROTOCOL §6.7.** The old mailbox lives for the grace, counted
  from the **rotate**. The grace is a relay setting. It is 7 days today:
  the relay's default, which the deployment does not override.
- **§8.6.** `mailbox_unknown`: "Re-resolve the address, or mark the
  connection `stale`".

### 1.3 G1: a rekey's `hs.fin` against a demoted Q

1. P's first write sends `identity.rotate`. S5 restarts P's rekey, and its
   `hs.init` goes out with K.
2. Strict F1 demotes Q.
3. Q answers P's rekey.
4. P's second write activates S1, and the update goes out with K.
5. Q follows. Its `relay.token.issued` is held, because Q is demoted.
6. S1 holds P's rekey `hs.fin`. If it were let out, it would land after
   the cut-off.

**Under the spec text the cycle closes.**
- Rule J ("Then neither the rekey block of §6.5 nor §6.6's holds `R`
  back") reads as "a rekey answer holds Q's reconnect".
- §6.5's lower-`th1` rule ("any two crossing handshakes ... whatever their
  purposes") makes Q's demotion reconnect yield to P's rekey about half
  the time.

**The shipped vault does otherwise** (vettid-vault main):
- `reconnectNaming` is the reconnect after a demotion or by strict F1.
  Once `canReconnect` passes, it abandons the vault's own rekeys, drops
  its open answers to the peer's rekeys, and abandons its pending epoch.
- While a reconnect naming an epoch other than the current one is open, a
  peer's rekey `hs.init` is discarded and audited
  `rekey_replaced_by_reconnect`.
- `startReconnectCtx` and `canReconnect` hold a reconnect only behind
  answers to reconnects (`answeredReconnects`).
- `makePending` records `FinAt` in the write that queues the `hs.fin`.

**The trust model, aligned with this** (6), shows the effect. With
relay-key rotation on, G1 together with G2 fell from 58 to 0 stale ends in
10,000 runs (seed 1). The same pairs now end through G2 alone. Under the
shipped behaviour, G1 closes only together with G2 and G3.

**At P.** Under the spec text, a held `hs.fin` has no bound. `B` starts
"Once `I` has sent `hs.fin`". The shipped code bounds it.

### 1.4 G2: the answer to Q's reconnect

1. Q has followed, so its `hs.init`'s tokens name K′ (S3).
2. P deposits its `hs.resp` with K (S1), and the relay refuses it (§5.3
   step 7).
3. Even if the relay accepted it, Q would refuse it (`superseded_relay`).
4. Each try expires after 16 days, and the third makes the pair `stale`.

This is the main gap. In the aligned model it alone ends about 1 run in
100 (99 and 90 in 10,000, on two seeds).

### 1.5 Device pairs

A vault never demotes a device's epochs and never reconnects to one, and
a device does neither. So G1, G2, G3, G6, G7 and G8 occur only between two
vaults.

A device's `hs.confirm` landing after the vault's cut-off is refused. The
vault still has a current epoch and sends its token, and S2 advances. The
device then sends `hs.confirm` again with K′ on its 12-day resend
("`hs.confirm` again"). That is a delay of up to 12 days, not a cycle.

### 1.6 G6: the revoked reconnect token, and S9

Q follows, and rule U revokes Q's reconnect tokens for K. Suppose that,
during S1, P has no current epoch with Q or its standing token has
expired. Then:
- P's reconnect on the revoked K token gets `token_revoked`, which is a
  failed try (§8.6).
- With Q demoted, Q's token waits more than 24 hours, so S9 raises "may
  have connected to an old copy of your vault" in an honest run.
- Three such tries end the pair `stale`.

### 1.7 G7: P has no current epoch at its second write

The update is a session message, so it is held while P is demoted or
pending. P's reconnect announces K and is answered into K's mailbox. That
mailbox ends 7 days after the rotate, while a round can take 16 days.
After that, nothing carries K′ to Q.

§6.6 "Limits" accepts this today ("After the grace, or for a device, it
needs a new invite or pairing"), so 2.4 changes a stated limit.

---

## 2. The design

None of this changes behaviour that release 29 builds (A5), except for
writing the shipped behaviour into the spec (2.2 S).

### 2.1 G2: the hybrid G2-H, and the acknowledgment kept separate

0. **The `sub` of Q's tokens.** Every token Q puts in any message to P
   names P's relay key **on Q's record**, never a key the message only
   announces (`from.relay.pk`). This mirrors S3.
1. **Deposit key.** A message P sends on a carried token is deposited with
   the key that token's `sub` names, if P still holds that key (G2-B).
   Otherwise the answer is dropped, as under rule J.
2. **When S2 advances** (the deposit key only). S2 advances to the newest
   of P's keys named by a token from Q in any of these:
   - a reconnect `hs.init` from Q, at the verified `hs.fin` that
     establishes it;
   - an `hs.resp` from Q that P accepts. Its tokens are bound to the
     handshake by its HPKE context, and P accepts it after `sig_R`;
   - an adoption;
   - `relay.token.issued`.

   Tokens are matched to Q by connection. When a token's `iss` is a
   mailbox P does not know yet, the advance rests on the handshake's
   authentication, not on verifying the token.
3. **No reconnect while carried or deferred tokens wait (P's side).** P
   does not take §8.6's "no valid standing token" path while it holds
   either of these from Q, naming a key P holds:
   - undiscarded carried tokens;
   - a token rule T has deferred for its unknown `iss`.

   The wait is bounded by the token's `exp`, by the handshake's lifetime
   (`L` for an answer, `B` for a pending epoch), and by rule T's deferral
   bound, whichever comes first. This extends a release-29 rule, and only
   during S1.
4. **S2's re-deposit** covers only entries on held tokens.
5. **Tokens in P's handshake messages during S1** are minted by K′'s
   mailbox (2.4). §3.4 (a)'s exception for minting with the old key goes
   unused for reconnects.
6. **S2's restarts.** At an advance, S2 restarts P's open reconnects that
   went with K and have sent no `hs.fin`. Two limits apply:
   - The handshake whose message made the advance is not restarted ("other
     than the one whose message made the change", as H5 says).
   - Each restart needs a reconnect token naming K′. Without one, the
     reconnect is kept, on the key its held reconnect token names.

   In an establishing write, the order is: the establishment, then the
   advance, then any restart.
7. **Acknowledged** (§3.4 "The signal") needs a token from Q whose `sub`
   is K′, held by P: from `relay.token.issued`, from an adoption, or kept
   by rule T. It does not come from an advance alone. Until then:
   - P keeps resending the update at each unlock (§3.4 (b)), with P's key
     for Q. After an advance that is K′, and each resend rides the newest
     standing token naming it, held or carried. This extends §6.3.1's use
     of carried tokens to this one message.
   - P does not delete K on Q's account.
   - Rule U's duplicate path then makes Q send `relay.token.issued`
     again.

   This keeps gap 1's liveness reason: P never stops resending to a peer
   from which it holds no token for K′.
8. **Resends while P has no held K′ token.** If P's carried token is
   discarded too (H5, `B`, `token_revoked`), P has nothing for K′. It
   resends with K on its held standing token for K, if one is still
   valid. Q accepts that as a duplicate update from an earlier key (Table
   A: "rule U"). Otherwise P waits for Q's own messages (row 3 in 4).
   *Unsure* whether this leaves a window; it goes to the harness.

**Security.** An advance needs Q's `ik` or Q's epoch keys, which is the
bar of an authenticated handshake with Q. A copy of Q taken after Q's
last `ik` rotation meets that bar, and already counts as Q (§11.14.2; the
copy residuals of §3.4.1). An unauthenticated token only picks the
deposit key for its own handshake. Under G2-A, any verified token would
advance S2. That is a lower bar, because a copy of Q that read P's update
could then move P's deposit key.

**What this re-decides.** Gap 1 stands as written for "acknowledged"
(rule 7). The deposit key (rules 1 and 2) moves earlier, on authenticated
evidence. 7.7 asks the owner to confirm this.

### 2.2 G1 and G3: G1-N, with the shipped behaviour written into the spec

**S. The shipped behaviour (7.1).**
- **S-a.** A reconnect after a demotion or by strict F1, once it can
  start (`canReconnect`), does three things:
  - abandons the side's own rekeys;
  - drops its open answers to the peer's rekeys. Release-29 rekeys carry
    no tokens, so nothing is revoked;
  - abandons its pending epoch.
- **S-b.** While a reconnect naming an epoch other than the current one
  is open, a rekey `hs.init` from the peer is discarded
  (`rekey_replaced_by_reconnect`).
- **S-c.** A pending epoch, and with it `B`, starts at the write that
  queues its `hs.fin`.
- **S-d.** Only an answer to a peer's **reconnect** holds a side's own
  reconnect.

Two amendments follow:
- **Rule J** ends: "Then the rekey block of §6.5 does not hold `R`
  back."
- **§6.5's crossing sentence** gains: "except that a reconnect after a
  demotion or by strict F1 replaces the side's rekeys and its answers to
  the peer's (§3.4.1)".

These amend release-29 text to match release-29 code.

**N1. Q's mirror of S2.** When Q follows a relay link, it abandons and
restarts each of its own open reconnects that meets both conditions:
- its `hs.init` carried tokens naming the passed key;
- it has sent no `hs.fin`.

It does not restart the reconnect whose message made the follow (2.4,
"at `sig_R`"). The abandonment is Q's own step, so it revokes the carried
tokens, and P never adopts them.

The restart uses the update's fresh K′ reconnect token, so it adds
nothing to the rapid-rotation residual. N1 runs after any establishment
in the same write.

**N2. Two messages pass the cut-off.** In Table A, row "Earlier, after
its cut-off", these are processed, but only while Q has accepted no
message from P's newer key:
- an **`hs.confirm`** under an epoch whose keys were established under a
  handshake signed by Q's current `ik` for P;
- an **`hs.fin` for an answer Q has open**, when `sig_I` verifies under
  the `ik` Q's answer pinned, and that `ik` is Q's current `ik` for P.

Binding L makes both safe (2.6).

**The G3 cases.**

| Q followed | Q is | Covered by |
|---|---|---|
| before its `hs.init` | initiator | G2-B (rule 1) |
| after its `hs.init`, before `hs.fin` | initiator | N1 |
| after its `hs.fin` (its reconnect pending) | initiator | N2 (`hs.confirm`) |
| after answering P's reconnect, by an update processed late (its tokens named K) | responder | N2 (`hs.fin`) |

**The held rekey `hs.fin`.** If Q has an epoch, Q's token comes and S2
re-deposits it. If Q is demoted, S-a drops Q's answer. P's pending rekey
epoch ends when Q's reconnect is established at P (§6.3.1), and the held
`hs.fin` is dropped with it.

**What this reverses.** #536's O1a, for an `hs.confirm`, and for an
`hs.fin` to an answer Q has open.

### 2.3 G1-A (the broader alternative)

**What G1-A adds.**
- S1 also lets out a rekey's `hs.init`, `hs.resp` and `hs.fin`.
- After the cut-off, these pass when authenticated under Q's current `ik`
  for P:
  - an `hs.resp`, by `sig_R`;
  - an `hs.fin`, by `sig_I`, under the pinned `ik`;
  - an `hs.confirm` or a session-mode rekey `hs.init`, by epoch keys
    established under a handshake signed by that `ik`.
- At S2's advance, P restarts the rekeys that went with K and got no
  `hs.resp`, but only if no epoch was established since each began.
- The same narrowing as N2: no pass once Q has accepted a message from
  K′.

**The residual.** Decoupled rotations generate the relay key after the
current `ik`: a gate-owed key, or the next key after a pending one. A copy
taken between that `ik`'s write and the relay key's first write holds
both. Until the narrowing closes, such a copy can run a whole rekey
through K. It counts as P already, and the next `ik` rotation ends it.
Under G1-N the same copy can confirm, or finish a reconnect Q answered.
Both are within the existing residual "An old copy ... can confirm Q's
pending epoch as P", and within §11.14.2.

**I3's new wording.** "... except tokens that pass rule T, duplicates of
followed links, and, until Q first accepts a message from P's newer key,
[G1-N: an `hs.confirm`, or an `hs.fin` to an answer Q has open; G1-A: a
handshake message or `hs.confirm`] authenticated under Q's current `ik`
for P, which a copy taken before that `ik` was written cannot make."

### 2.4 G7, and the answer past the grace: links in reconnects

**The rules.**
- During S1, P's reconnect `hs.init`, and its `hs.resp` to Q's reconnect,
  each **announce K′**. The `hs.init` does it in `from.relay`; the
  `hs.resp` does it in a new field. Each carries:
  - `relay_links` from K to K′;
  - P's `ik` links (`rotations`, binding L);
  - `token` and `reconnect_token` minted by K′'s mailbox.

  Each is still deposited with K (rule 1).
- **Q accepts them from K**, before or after K's cut-off, when all of
  these hold:
  - the links connect the `sender` to the announced key;
  - the links pass rule C;
  - the announced key is Q's current key for P, or is reached through
    those links.

  Without the links, a reconnect `hs.init` from K after the cut-off stays
  refused.
- **Q follows the links.**
  - For P's `hs.init`, at the verified `hs.fin` that establishes the
    reconnect. That `hs.fin` is the cut-off, and it counts as before the
    cut-off, so it is accepted.
  - For P's `hs.resp`, at its verified `sig_R`. The `hs.resp` is the
    cut-off.
  - In that write, Q first applies the `ik` links, then the relay links,
    then takes the tokens by rule T, against the new key.
- **At the second write**, P abandons its open reconnects that announced
  K and have sent no `hs.fin`, and restarts them by these rules.
- **The Q-side hold** (3.3) also ends at such a follow.

**How Q gets a K′-mailbox token it can use.**
1. Q's `hs.confirm` goes into K′'s mailbox on the `hs.init`'s carried
   token.
2. P confirms and sends its prompt `relay.token.issued` with K, its key
   for Q. That prompt reaches Q after the cut-off, so Table A takes only
   its tokens, by rule T. Q does not adopt them; it **keeps them as held
   tokens** for K′'s mailbox.
3. Q's own `relay.token.issued` for K′ then goes into K′'s mailbox on one
   of those held tokens.
4. P now holds a K′ token from Q, so the pair is acknowledged (rule 7).

**The changes to the spec.**
- §6.2: `from.relay` during S1, `relay_links`, and the announced key in
  `hs.resp`. Tokens stay required.
- §6.3: the collect `sender` check gives way to linked keys.
- §6.6 "Initiating": `from.relay` names the announced key, not the
  deposit key.
- §6.6 "Authentication": the collect `sender` may be an earlier key
  linked to the key on record.
- Table A's preamble.
- §3.4 (a): exception 2 is dropped for reconnects.
- Rule T's reconnect clause: `iss` is the announced key's mailbox.
- Rule U: following by these links.
- §6.6 "Limits": the sentence that accepts G7 goes.

**Safety.** It rests on two things: `sig_I` (at the `hs.fin`) or `sig_R`
verifying under an `ik` that Q reaches, and binding L. The links are
signed in the rotation's first write. A copy taken after that write
counts as P. A copy taken before it holds only an ancestor `ik`, which
Table B refuses. The cap on answers opens only to messages that carry
valid links.

**The bound for the 2.4 path.** About 6`U`, in hops:
1. `hs.init`;
2. `hs.resp`;
3. `hs.fin`, at which Q follows;
4. `hs.confirm`;
5. P's prompt;
6. Q's token.

Add up to a round when P must first wait for its own demotion to resolve.
That case needs a rotation by Q, so it belongs to "both sides rotate" in
4.

**The alternative.** The relay keeps the old mailbox until every
recipient has acknowledged. That widens the old-copy window, and it
changes the relay protocol.

### 2.5 G6: the revoked reconnect token during S1

- During S1 toward Q, a `token_revoked` on a **reconnect** token for an
  earlier key of P is not a failed try. P stops using that token.
- **S9 counts only revocations of standing tokens** (7.9). Rule U leaves
  standing tokens to expire, so an honest follow never revokes one, and a
  reconnect-token revocation is exactly what an honest follow looks like.
- **What P waits for.**
  - Q's reconnect, or Q's `relay.token.issued`.
  - If P itself is demoted, it refuses Q's messages under the demoted
    epoch, so Q's token arrives only under the epoch P's demotion
    reconnect (2.4) makes. That reconnect runs on a K′ reconnect token
    once P has one (an advance, or Q's token), and on the update's tokens
    before that.
  - This is assumption A1's "no rule demotes an honest pair" applied to
    the new epoch. An oracle checks it (6).

### 2.6 Binding L: the update carries P's `ik` links

- The update carries `rotations`, as S8 says for `identity.rotate`. They
  are made again at each resend.
- Q applies them first, in the same write:
  - rule C;
  - Table B;
  - H5;
  - the demotion rules;
  - R29-K9, on a duplicate update too.
- If Table B refuses a link, Q follows no relay link from that update.
- **The guarantee.** No copy taken before the write of the `ik` that was
  current at the relay link's first write passes N2, G1-A's pass, or
  2.4. This is not absolute for decoupled rotations (2.3).
- **K9 at the update.** Probably sound: the update is sealed under P's
  current epoch, as `identity.rotate` is. To be modelled.
- **Side effect.** The update can demote Q itself (strict F1).
- **Alternative: binding R.** Put the `ik` into the relay link's signed
  body. That needs a new format and test vectors, and it does not deliver
  the links.

---

## 3. The crash order between the relay's rotate and the state write

### 3.1 What §3.4 says

"Stores first, then rotates, and retries with the same key." The three
paths follow it. The exception is a recovery's fresh key after a refused
registration.

### 3.2 What each crash point leaves

"Grace loss" (3.3): deposits the relay accepted into K's mailbox after
P's last collect of it are lost silently when the mailbox ends.

| Crash point | State | Relay | Next unlock | Lost |
|---|---|---|---|---|
| C0: before the first write | K current; an owed mark, if written | old mailbox | the mark retries | nothing |
| C1: after the first write, before the rotate | K current, K′ pending; new `ik`; `identity.rotate` sent | old mailbox | the rotate, same K′ | nothing |
| C2: after the rotate, before the second write | as C1 | both; the grace has started | the rotate again, then the second write; past the grace, the registration (`200` goes on; `201` re-mints all) | grace loss, widened by the time to the next unlock |
| C3: after the second write, before the updates leave | K′ current; K for deposits | both | the outbox sends the updates | grace loss, as without a crash |
| C2′: after K1's second write, which also stores K2 | K1 current, K2 pending | K1's mailbox; K's in its grace | as C1, for K2 | grace loss, for K's mailbox |
| CR: a definite refusal, before its write | as C1 or C2 | unchanged | refused again, then written | as C1 or C2 |
| CF: a recovery's fresh key, registered before any state | the inherited key, refused | an empty mailbox no one was told of | the open is retried | an orphaned mailbox (within the relay's limit of 3) |

### 3.3 Is it complete?

**Safety:** yes. **Liveness:** no.

**Grace loss without a crash.** Q keeps depositing to K's mailbox until
it follows, and P collects that mailbox only at its unlocks. Deposits
made between P's last collect and the mailbox's end are lost silently.
The time from the rotate until Q stops depositing to K, plus P's next
collect, is:
- **with Q reached by the update:** at most `U` (rotate to second write)
  + `U` (the update) + `U` (P's collect) = 3`U`;
- **on the 2.4 path, P reconnecting at its second write:** `U` + 3`U`
  (Q follows at the `hs.fin`) + `U` = 5`U` = 20 days at `U` = 4;
- **on the 2.4 path, P first waiting a round:** about 9`U` = 36 days;
- **both sides rotating relay keys** (G8, 5): each side needs the other's
  update before the other's grace ends.

A crash at C2 adds up to `U`. A lock outside A3 adds its length.

**The options (7.5).**
- **A longer grace.** The grace is a relay setting, today 7 days. A
  longer one changes the deployed relay's configuration and RELAY-PROTOCOL
  §6.7's default. It applies to every mailbox, so to devices' rotations
  too.
  - 3`U` + margin (14 days) closes the update path only.
  - 5`U` + margin (21 days) closes the 2.4 path without the waiting round.
  - 9`U` (36 days) closes all of these under A3.
  - Cost: an old copy keeps the live old mailbox that long, at every
    rotation (§3.4.1 Residuals: "During the grace an old copy holding the
    old key can collect, ack or delete the old mailbox").
- **The Q-side hold.**
  - **What it holds:** a deposit to P's mailbox refused `mailbox_unknown`,
    while all of these hold:
    - the connection is active;
    - since the first refusal, no update from P has named a newer mailbox;
    - Q has not followed by 2.4.
  - **How it treats the deposit:** it is not ended
    (`drop.undelivered_mailbox_unknown`), not a failed try, and no reason
    for `stale`.
  - **When it ends:** at a follow, at the connection's end, or at the
    hold's limit (7.10).
  - **What it saves:** only deposits the relay **refused**.
  - **Cost:** for a deleted peer whose `connection.removed` was lost, the
    member gets silence for the limit's length instead of "not
    delivered".
- **Telling the loss** (`old_collected_to`). P tells Q, in the update, up
  to when it collected K's mailbox. Q then reports the deposits after
  that time as `message.delivery_unconfirmed`.
  - P must persist the collected-to time of each acked collect, not only
    of the leased ones.
  - Q must keep a per-peer log of `201`'d deposits with `deposited_at`.
  - Clock skew needs a margin (§4.1's 90 seconds).
  - *Unsure* that it can be exact.

**The second write** should list its S1 state: P's key for each Q, and
the start of S1's clock.

---

## 4. Liveness argument sketch

This argument covers the design: G2-H with rule 7, G1-N with S, binding
L, 2.4, 2.5, a grace from 7.5, and the hold. It covers pairs of vaults.
Device pairs are covered in 1.5.

### Assumptions

- **A1 to A4.** As in 0.88.2.
- **`t_r`.** The last write, by either side, that stores an `ik` or a
  relay key. This includes a gate-owed key, which comes at most 30 days
  after the gate's mark, and the next key after a pending one.
- **A5′.** Relay keys rotate, and both sides advertise `relay_follow`.
- **A6.** The grace covers the path in use (3.3), and the hold applies.
- **A7.** No rotate is definitively refused.

### Progress measure

Φ = (π, ν, μ, α, λ, δ, ρ), compared in that order:
- **π:** the number of pending relay keys.
- **ν:** the number of (side, recipient) pairs where the recipient has
  not followed.
- **μ:** the number of pairs where the side's key for the recipient is not
  its current key.
- **α:** the number of pairs not yet acknowledged.
- **λ, δ, ρ:** as in 0.88.2.

**Why Φ only goes down.**
- A pending key's second write raises ν, μ and α, but π falls in that
  same write, so Φ goes down.
- Under binding L, δ and ρ rise only where ν or λ falls.
- S2's and N1's restarts happen only where μ or ν falls.

### Steps

- **Step 0.** π reaches 0 within `U` of `t_r` (A3, A2).
- **Step 1.** ν reaches 0:
  - within 2`U` of the second write through the update;
  - within about 3`U` through 2.4;
  - λ reaches 0 by `t_r` + 3`U`.
- **Step 2.** μ, then α, reach 0. Every wait names what ends it:

| Wait | Ended by | Bound | Why no cycle |
|---|---|---|---|
| The update reaching Q | S1 lets it through, and resends it (rules 7, 8). While P has no epoch, 2.4 carries the links instead | `U`; 2.4: three hops | needs nothing from Q's acknowledgment |
| Q following | rule U or 2.4, with binding L. A demotion of Q by those links leads to the next row (b) | one hop | needs nothing more from P |
| Q's evidence (μ) | (a) `relay.token.issued`, if Q has an epoch; (b) Q demoted: its reconnect runs at once (S-a, S-d), N1 restarts it if Q followed mid-reconnect, rule 1 delivers P's answer, and S2 advances at the verified `hs.fin`; (c) Q pending: N2 lets P's `hs.confirm` through, then (a); (d) Q responding: N2 lets P's `hs.fin` through | (a) one hop; (b) about 5`U` from `w`; (c), (d) one hop more / "The reconnect bound" | Q never waits for a message P holds for want of Q's evidence |
| Acknowledged (α) | a K′ token from Q held by P: (a); the prompt path of 2.4; or a duplicate update's answer (rule 7) | one hop after μ; resends at each unlock | resends ride P's key for Q, so they need nothing more from Q |
| P's reconnect on a revoked K token | not a try (2.5); then the "Q's evidence" row, then a restart on a K′ token | as that row | the revocation is Q's own follow |
| P's held rekey messages | S2's re-deposit, or dropped (S-a, §6.3.1); `B` from the queued `hs.fin` (S-c) | one round / `B` | not needed for progress under G1-N |
| P's other entries held by S1 | S2's advance | as above | — |
| P's entries needing a held K′ token | α | as α | P starts no reconnect meanwhile (rule 3, bounded) |
| Q's refused deposits to K's mailbox | held until the follow (3.3) | rows 1–2 | — |

### The bound, counted from P's second write `w`

- **One side rotates.**
  - Q has an epoch: 2`U`.
  - Q is demoted: about 5`U` (the update, then the reconnect's hops up to
    its verified `hs.fin`).
  - The 2.4 path: about 6`U`.
  - Worst case about 6`U`, which is 24 days at `U` = 4.
- **Both sides rotate.** Q may have no current epoch until 0.88.2's
  settling at `t_r` + 12`U`. Its token follows a hop later, so the bound
  is `t_r` + 13`U`.
  - Each new rotation by Q moves `t_r`, so this bound has no ceiling
    counted from `w`. A4 makes the number of rotations finite, but not
    their spacing.
  - Hence 7.6: S1's clock restarts when P follows a link of Q's, under a
    hard cap.

### What still ends `stale`, visibly

- 0.88.2's list.
- S1's clock, as decided in 7.6.
- The gate's deadline.
- G4 and G8, if the harness finds a failure.

---

## 5. Other wait cycles with relay-key rotation on

- **G3.** Closed by 2.2 (N1, N2), or by 2.3.
- **G4: both sides rotate within one hop.**
  - Q's `relay.token.issued` names an `iss` that P does not know yet. It
    is deferred, then refused, and replaced at the next resend.
  - An authenticated handshake still advances S2 (rule 2).
  - P can use the token only once rule T keeps it, after P follows Q's
    update. Until then, P's held entries wait for that token (rule 3), and
    a kept reconnect goes on the key its held reconnect token names.
  - Argued to be bounded. Checked in the harness's G4 mode.
- **G5.** S2's restart without a K′ reconnect token: the reconnect is
  kept as it is (rule 6).
- **G6, G7.** Closed by 2.5 and 2.4.
- **G8: both sides' old mailboxes end (new).** P rotates K→K′ and Q
  rotates J→J′. Each knows the other only at the old address. If neither
  side's update reaches the other before the other's grace ends, then:
  - each deposit to the other fails `mailbox_unknown`;
  - 2.4's reconnect goes to that same dead mailbox;
  - both sides hold until the hold's limit, and both end `stale`.

  No fallback exists without a relay that tells a sender a rotated
  mailbox's successor. That would also need a token from the successor,
  which the sender does not have. So the grace must cover each side's
  update path, in the both-rotate schedule too. Otherwise this is a
  residual (7.5), and the harness gets a schedule for it (6).
- **H5 and the reconnect token's quota.** N1 uses the update's fresh K′
  reconnect token. 2.5 removes the failed tries on a revoked token.
- **The gate, rule U, H5.** No other cycle found.

---

## 6. Harness plan, and the trust model's numbers (internal)

### What exists

- **The vault code has no rotating side.**
  - `rotateIdentity` leaves the relay key alone, and a test pins A5.
  - `Relay` has no rotate call.
  - `hAddressUpdate` predates 0.85.
- **The random-pair harness has no relay-key mode.** It has the default
  mode, `R29RP_BURST`, `R29RP_SHUFFLE`, `R29RP_REFRESH`, `R29RP_SPENT`
  and `R29RP_LOSTANS`, plus `R29RP_TRACE` and `R29RP_REPEAT`.
- **The trust model.** `TRUSTMODEL_RELAYROT=1`, now on a model branch
  that is aligned with S-a, S-b and S-d. S-c was already modelled. Each
  stale end is labelled with the wait it was stuck in.

### The trust model's numbers

These are stale ends in 10,000 runs per seed, with relay-key rotation
on, before and after the alignment. The classifier is a heuristic and
reports the gaps that occurred together.

| Wait class | Seed 1 | Seed 2 |
|---|---|---|
| G1 + G2 | 58 → 0 | 53 → 1 |
| G2 alone | 44 → 99 | 41 → 90 |
| G2 with G3, G6 or G7 | 4 → 7 | 6 → 11 |
| G1 + G7 | 1 → 0 | 0 → 0 |
| G1 + G2 + G7 | 2 → 0 | 1 → 0 |
| G1 + G6 | 0 → 0 | 1 → 0 |
| G3 | 1 → 1 | 0 → 0 |
| G6 | 1 → 1 | 1 → 1 |
| G7 | 7 → 7 | 6 → 6 |
| other (both sides rotating: G4, G8) | 2 → 2 | 2 → 2 |
| **Total** | **119 → 118** | **111 → 111** |

What these numbers say:
- Under the shipped behaviour, the G1 wait no longer forms. The same
  pairs end through G2, so G2 is the main real gap, at about 1% of runs.
- One I1 loss (G3 + G7) also occurs in the default configuration, which
  suggests it is a coincidence. One I2 per run set is not yet classified.
- One finding in the default configuration (no relay-key rotation) is
  under investigation; see the residuals in step 5.

### Steps

1. **The model.**
   - Put each fix behind its own switch:
     - G2-H rules 0 to 8;
     - N1 and N2 (both of its messages);
     - G1-A with the narrowing;
     - 2.4 (`hs.init` and `hs.resp`);
     - 2.5;
     - binding L (K9 on the update and on a duplicate);
     - the hold;
     - the grace lengths of 7.5.
   - Run each at 10,000 runs, then 100,000, with and without ROTBURST.
   - The old-copy actor must break I3 with binding L switched off.
   - Add a device-pair configuration.
2. **The real code, on a branch that is not merged.**
   - The rotating side, rule U with binding L, and Table A's earlier rows.
   - G2-H, G1-N, 2.4, 2.5 and the hold.
   - A stub relay with: rotate (idempotent with the same key), the grace
     with collects from both mailboxes, tombstones, `mailbox_unknown`
     after the grace, step 7 of §5.3, and the denylist.
3. **Mode `R29RP_RELAYROT`.**
   - **Rotations:** all three paths, and the decoupled keys.
   - **Crashes:** C1, C2, C3, C2′, CR, CF.
   - **Schedules:**
     - locks around the grace;
     - P demoted at its second write (G7);
     - Q following at each point of a reconnect, as initiator and as
       responder (G3's four cases);
     - a G4 sub-mode with an unknown `iss`;
     - a G8 schedule, with both sides rotating and locks around both
       graces.
   - **Oracles:**
     - I1 extended (ν = μ = α = 0, and nothing held by S1);
     - I2 and I5;
     - I3-lite (nothing from an earlier key after its cut-off beyond N2
       or 2.4, and nothing after Q has accepted from the newer key);
     - S2 never advances before Q's follow write;
     - acknowledgment only with a held K′ token;
     - no S9 feed item in an honest run;
     - a demoted P takes Q's token only under a new epoch (2.5);
     - every `201`'d deposit is collected or told.
   - **Counters:**
     - S2 advances by kind;
     - reconnect-token deposits per rotation;
     - `w` to α = 0, against S1's clock.
4. **The bar.**
   - 0 honest runs end `stale`, diverged or suspended outside accepted
     residuals.
   - 10,000 runs per mode: `R29RP_RELAYROT` crossed with every existing
     mode, plus every mode without it.
   - Counted from the `-v` class table and the counters (`-test.v` for a
     prebuilt binary), never from a PASS.
   - Each new oracle is shown to fire before its zero is reported.
5. **Likely residuals.**
   - S1's cap (7.6).
   - A recipient away beyond it.
   - G4 and G8 outside the grace (7.5).
   - The rapid-rotation rate.
   - The decoupled-rotation copy.
   - The grace loss beyond the chosen grace, unless it is told.
   - The hold's limit when a `connection.removed` is lost.
   - *Under investigation:* one finding in the default configuration
     (no relay-key rotation), seen after the alignment with the shipped
     behaviour. It is being checked against the vault code and is not
     classified here.

---

## 7. Owner questions

In the order to decide them. Each gives its choices (24 characters or
fewer), what each costs, what it depends on, and a recommendation.

### 7.1 The shipped release-29 behaviour, written into the spec (S-a to S-d; Rule J and §6.5 amended)

- **a = `spec follows shipped`**
  - Cost: two amended sentences, no code change.
- **b = `code follows the spec`**
  - Cost: changes shipped behaviour. G1 then cycles about half the time.
  - **Forces 7.3 b.**
- **Recommendation: a.**

### 7.2 Binding the `ik` to the relay link

- **a = `ik links in the update`** (binding L)
  - Cost: the update's handler runs the identity path, K9 included.
  - **I3's safety under 7.3 and 7.4 rests on this, or on b.**
- **b = `ik in the relay link`** (binding R)
  - Cost: a new signed format and vectors. It does not deliver the links.
- **Recommendation: a.**

### 7.3 What passes Q's cut-off (reverses #536 O1a for what is named)

- **a = `confirm+fin, Q restart`** (G1-N)
  - What passes: an `hs.confirm`, or an `hs.fin` to an answer Q has open,
    plus N1.
  - Cost: two Table A cells.
  - **Needs 7.1 a and 7.2.**
- **b = `signed hs msgs pass`** (G1-A)
  - Cost: a wider Table A change, and a wider decoupled-copy residual.
  - **Needs 7.2.**
- **c = `nothing passes`**
  - Cost: G3 stays; a pending Q, or a responding Q, ends `stale` at `B`.
  - **Rules out 7.4 a's `hs.resp` variant.**
- **Recommendation: a.** The two now cover the same G3 cases. a passes
  fewer messages.

### 7.4 Reaching Q when the old mailbox cannot (G7, and the answer past the grace)

- **a = `links in reconnects`** (2.4)
  - Cost: changes to §6.2, §6.3, §6.6 "Initiating" and "Authentication",
    Table A's preamble and rule T. It removes a limit §6.6 states.
  - **Its `hs.resp` variant needs 7.3 a or b.**
- **b = `grace while unacked`**
  - Cost: an old copy keeps the live mailbox until every recipient
    acknowledges. It changes the relay protocol.
- **c = `accept as residual`**
  - Cost: a demoted P, or a P reached only past the grace, loses the
    connection (`stale`).
- **Recommendation: a.**

### 7.5 The relay's grace (a relay setting; today 7 days; devices included)

- **a = `grace 36 days`**
  - Closes the grace loss, G7's waiting case and G8 under A3.
  - Cost: an old copy keeps the live old mailbox 36 days at every
    rotation.
- **b = `21 days + tell the rest`**
  - Closes the update path and 2.4 without a wait. The rest is told by
    `old_collected_to` (3.3).
  - Cost: a new field, P's collected-to log, and Q's deposit log. G8
    with long waits remains a residual.
- **c = `7 days + tell losses`**
  - Cost: losses on every slower path, told, not prevented. G8 remains.
- **d = `14 days, no telling`**
  - Cost: the 2.4 path's deposits are lost silently, which breaks the
    "no silent failures" rule.
- **Depends on 7.4.** Under 7.4 b, the grace is per recipient instead.
- **Recommendation: b**, with the 21 days the owner's number.
  *Unsure*: it trades the old-copy window against the size of the
  telling path.

### 7.6 S1's clock (member-facing numbers)

- **a = `restart on Q, cap 60`**
  - S1's 30 days restart whenever P follows a link of Q's (an `ik` or a
    relay key), never past 60 days after the second write.
  - Cost: a Q that rotates and never follows is ended at up to 60 days.
- **b = `pause on Q, cap 60`**
  - S1 does not run while P has accepted an authenticated message from Q
    in the last 16 days, capped at 60 days.
  - Cost: as a; an active Q that never follows waits up to 60 days.
- **c = `S1 of 60 days`**
  - Cost: every unreachable recipient is ended twice as late.
- **d = `keep 30 days`**
  - Cost: both sides rotating can end honest pairs `stale` (4).
- **Depends on 7.3 and 7.4.** Under 7.4 c the one-side bound already
  breaks; under 7.3 c, G3 ends pairs anyway.
- **Recommendation: a**, 30 and 60.

### 7.7 The acknowledgment rule (re-decides part of "gap 1", 2026-11-05)

- **a = `ack needs held K′ token`**
  - S2 may advance on an authenticated handshake (deposit key only).
    "Acknowledged" keeps gap 1's rule: a K′ token P holds. Resends go on
    until then (rules 7 and 8).
  - Cost: resends ride a carried token, which is new.
- **b = `ack at S2's advance`**
  - Cost: gap 1's liveness failure comes back. P stops resending and may
    delete K while it holds no K′ token.
- **c = `signal unchanged + G2-B`**
  - S2 waits for `relay.token.issued`. Only the deposit key of
    carried-token messages changes (G2-B, which itself moves part of
    O1a's premise).
  - Cost: P's other traffic waits a hop longer.
- **Recommendation: a.** c is acceptable if gap 1 is to stand untouched.

### 7.8 The Q-side hold's limit (member-facing number)

- **a = `hold 30 days`**
  - Cost: shorter than 7.6's cap, so a slow follow can still end in "not
    delivered".
- **b = `hold 60 days`**
  - Aligned with 7.6's cap.
  - Cost: a deleted peer whose `connection.removed` was lost shows 60
    days of silence.
- **Depends on 7.6.**
- **Recommendation: b**, if 7.6 is a or b.

### 7.9 S9 during S1 (G6)

- **a = `S9 on standing only`**
  - A revoked reconnect token is never S9, and never a failed try during
    S1.
  - Cost: a fork is seen only through a revoked standing token, or
    through S1's `stale`.
- **b = `S9 after 16 days`**
  - Cost: still a false alarm when both sides rotate, and a real fork is
    shown later.
- **c = `S9 at 24 h, no try`**
  - Cost: an honest false alarm whenever Q is demoted.
- **Recommendation: a.**

### 7.10 How to meet "search on the real code"

- **a = `model, then code branch`**
  - Cost: the model's switches come first.
- **b = `code branch only`**
  - Cost: attribution is slower.
- **Recommendation: a.** The model is already aligned (6).

### 7.11 0.88.2's `hs.confirm` paragraph (wrong after the cut-off)

- **a = `fix in the redesign PR`**
  - Cost: none for release 29.
- **b = `erratum now`**
  - Cost: a spec round.
- **Recommendation: a.**
