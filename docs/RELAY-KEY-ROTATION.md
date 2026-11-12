# Relay-key rotation without wait cycles: design note (draft 6)

For the owner and the lead. This note is read against VAULT-MESSAGING
0.89.1 (origin/master); the two errata of 0.89.1 change nothing below.
Every quoted section reads as in 0.88.18. RELAY-PROTOCOL is read on the
same master.

Sections 1 to 5 are meant to move into the spec. Sections 6 and 7 are
internal.

**Names used throughout.**
- **P** rotates its relay key from K to K′. **Q** is one recipient.
- **P's key for Q** is S1's term: the key P deposits to Q with. It never
  moves back.
- **Q has followed** means Q has applied the link K→K′. From then on, K is
  "earlier" at Q and has a **cut-off**.
- **S1 toward Q** is the time during which P's key for Q is not P's
  current key.
- **Acknowledged** (§3.4 "The signal") ends the resends and allows the
  old key to be deleted. It is separate from S2's advance (2.1 rule 7).

## Changes since draft 5

| Concern in draft 5 | Change | Where |
|---|---|---|
| The "telling" in the grace option did not work as specified | Specified in full as a separate message after P's last collect of K, on every path, with Q re-depositing. The relay forwards to the successor as a new option. The options are compared fairly, with G8's bound in `U` for each | 3.3; 7.6; 7.9 |
| G6's fix still ended the pair `stale` (no reconnect token) | "The reconnect bound"'s no-token judgement is suspended during S1 for a token revoked for an earlier key. Added to the liveness table and as an oracle | 2.5; 4; 6 |
| Both sides rotating: P's later tokens name Q's new key | Rule 2 gains a source: an update Q accepts whose tokens name Q's newer key. Added to the G4 schedule | 2.1 rule 2; 5; 6 |
| Rules 7–8 against §3.4 (b) | (b) is amended for S1. A `token_revoked` on a carried token that carried an update is specified | 2.1 rule 9 |
| K9 at the update | Every deposit of an update is sealed under the then-current epoch. S2's same-bytes re-deposit excludes updates | 2.6 |
| S9 under the old 7.9 a | Stated plainly. "S9 at S1's end" is added and recommended | 2.5; 7.12 |
| The hold and "show held as held" | The held state is shown. Every new member-facing text is listed for approval | 3.3; 7.8; 7.15 |
| The acknowledgment question's costs | Its choice a lists all the machinery it needs | 7.4 |
| §7 order and missing questions | The acknowledgment question follows 7.2–7.3. The S1 clock depends on it. New questions: whether the hold exists, and the telling. 7.10 b covers rule 8's window | 7 |
| The "both sides rotating" model row | Now "unattributed", with figures to come, and a question on why Q never retried | 6 |
| Seed 1's G2-with-G3/G6/G7 row | Recounted (before 2, after 8). The missing G1 + G2 + G3 row is added. The after-table now carries the G4 and G8 labels | 6 |
| The run where Q never retried | A real gap, G9: a refused reconnect `hs.init` waits its whole 16-day life. New rule and owner question. The lost-token sentence of §3.4.1 is qualified | 1.8; 2.7; 5; 7.11 |
| A model limitation | Stated: one own-handshake slot. An experiment leaves the stale counts unchanged | 6 |
| Device text | Corrected: G7- and G8-like losses do occur for long-offline devices | 1.5 |
| The scope of N2 and G1-A | Pairs of vaults only (a device rotates no `ik`, so binding L binds nothing) | 2.2; 2.3 |
| `tickDemoted`'s guard | Written into S-a. Its wait reaches `B` (32 days), longer than S1's 30, so 7.10's recommendation moves to b | 2.2; 4; 7.10 |
| 3.3's `U` counting | Recounted: no crash, then +`U` for a C2 crash | 3.3 |
| Nits | S-d is between persons; dependency wording in 7; rule 5 depends on 7.5; 1.4's wording; the rule-0 citation; "never moves back"; the model's non-naming reconnect noted; `ab9beb8` is on branch `i7-realcode` | throughout |

---

## 1. The gaps

### 1.1 What "demoted" means

"Demoted" is a state of an epoch (§3.4.1). An epoch is demoted:
- by position ("Epochs after an `ik` link");
- by "Strict F1";
- from the start, by a link ("Pending epochs at a link").

A **demoted Q** is in the state of "After a demotion of the current epoch":
- It has no current epoch with P.
- It sends "nothing but handshake messages".
- It holds its durable messages, `relay.token.issued` included. That
  message also has no epoch to be sealed under, because earlier send keys
  are erased (§6.5).

A Q whose own reconnect is **pending** is in the same position (§6.3.1
Initiator). Honest demotions happen around `ik` rotations.

### 1.2 The rules involved

- **§3.4 "The signal".** "Nothing else counts": the owner's decision
  "gap 1" of 2026-11-05 (the 0.85.0 draft, vettid.org at c7ee8f7; built
  in vettid-vault #203), on the premise of vettid.org #536 O1a. The
  recorded reason is **liveness**. A peer that "acknowledges" only by
  depositing to the new mailbox never sends P a new token, so P would
  delete its old key and could no longer reach that peer.
- **S1, S2, S3, S9, rule U, rule T**, as in §3.4.1.
  - Rule U revokes "the reconnect tokens it issued to the passed keys"
    and leaves the standing tokens to expire.
- **§3.4 (b).** "a deposit refused with a definite answer (token expired
  or revoked, mailbox gone) ends the resends to that recipient".
- **§3.4.1 "The reconnect bound".** The connection becomes `stale` "when Q
  cannot start a try because it holds no reconnect token for P". The
  shipped vault does the same (`noReconnectToken`, then `markStale`).
- **§6.2.** A reconnect's `token` and `reconnect_token` are "required".
- **§6.3.** The collect `sender` "MUST equal `from.relay.pk` for
  `hs.init`".
- **§6.6.**
  - "Initiating": "`from.relay` names the relay key it is deposited
    with".
  - "Authentication": "the collect `sender` equals the relay key on
    record".
- **§6.3.1.** Carried tokens serve only their own handshake. They are
  adopted at confirmation. They are discarded at H5, at `B` and at
  `token_revoked`.
- **RELAY-PROTOCOL §5.3 step 7.** The deposit key must equal the token's
  `sub`.
- **RELAY-PROTOCOL §6.2.** A deposit is answered `201 {msg_id}`. The
  ULID is in arrival order per mailbox.
- **Table A, "Earlier, after its cut-off".** Everything is refused except:
  - the update;
  - the tokens of `relay.token.issued` ("tokens by rule T only");
  - an `identity.rotate` that is already followed.
- **The update carries only relay links.** §8.4 does not order it
  against `identity.rotate`.
- **RELAY-PROTOCOL §6.7.** The old mailbox lives for the grace, counted
  from the **rotate**. The grace is a relay setting, today 7 days: the
  relay's default, which the deployment does not override.
- **§8.6.** `mailbox_unknown`: "Re-resolve the address, or mark the
  connection `stale`".

### 1.3 G1: a rekey's `hs.fin` against a demoted Q

1. P's first write sends `identity.rotate`. S5 restarts P's rekey, and
   its `hs.init` goes out with K.
2. Strict F1 demotes Q.
3. Q answers P's rekey.
4. P's second write turns S1 on, and the update goes out with K.
5. Q follows. Its `relay.token.issued` is held, because Q is demoted.
6. S1 holds P's rekey `hs.fin`. If S1 let it out, it would land after the
   cut-off.

**Under the spec text the cycle closes.**
- Rule J ("Then neither the rekey block of §6.5 nor §6.6's holds `R`
  back") reads as "a rekey answer holds Q's reconnect".
- §6.5's lower-`th1` rule ("any two crossing handshakes ... whatever
  their purposes") makes Q's demotion reconnect yield to P's rekey about
  half the time.

**The shipped vault does otherwise** (vettid-vault main):
- `reconnectNaming` is the reconnect after a demotion or by strict F1.
  Once `canReconnect` passes, it:
  - abandons the vault's own rekeys;
  - drops its open answers to the peer's rekeys;
  - abandons its pending epoch.
- While a reconnect naming an epoch other than the current one is open,
  a peer's rekey `hs.init` is discarded (`rekey_replaced_by_reconnect`).
- Between persons, `startReconnectCtx` and `canReconnect` hold a
  reconnect only behind answers to reconnects (`answeredReconnects`).
- `makePending` records `FinAt` in the write that queues the `hs.fin`.
- `tickDemoted` retries a demotion reconnect only when the vault holds no
  pending epoch of its own.

**The trust model, aligned with this (6).** With relay-key rotation on,
G1 + G2 fell from 58 to 0 stale ends in 10,000 runs (seed 1). The same
pairs end through G2 alone. So under the shipped behaviour, G1 closes
only together with G2 and G3.

**At P.** Under the spec text a held `hs.fin` has no bound: `B` starts
"Once `I` has sent `hs.fin`". The shipped code bounds it.

### 1.4 G2: the answer to Q's reconnect

1. Q has followed. So the tokens in its `hs.init` name K′. They name P's
   key as Q has it on record, the rule S3 gives P, applied to Q (2.1
   rule 0).
2. P deposits its `hs.resp` with K (S1). The relay refuses it (§5.3 step
   7).
3. Even if the relay accepted it, Q would refuse it (`superseded_relay`).
4. Each try expires after 16 days unanswered. The third failed try for
   the same named epoch makes the pair `stale`.

This is the main gap. In the aligned model it occurs in almost every
stale end. It is alone in 63 and 56 of 10,000 runs (two seeds), and in
most of the others it occurs together with G4, both sides being in S1
(6).

### 1.5 Device pairs

A vault never demotes a device's epochs and never reconnects to one. A
device does neither. So G1, G2, G3 and G6 occur only between two vaults.

A device's `hs.confirm` that lands after the vault's cut-off is refused.
The vault still has a current epoch and sends its token, so S2 advances.
The device then sends `hs.confirm` again with K′ at its 12-day resend
("`hs.confirm` again"). That is a delay of up to 12 days, not a cycle.

The losses tied to the grace (G7-like and G8-like) **do** occur for a
device that is offline past the grace. Its deposits to the old mailbox
end `mailbox_unknown`, and a device cannot reconnect. §6.6 "Limits"
already accepts this: the device is paired again. The relay-side option
of 7.6 would close it.

### 1.6 G6: the revoked reconnect token, and S9

When Q follows, rule U revokes Q's reconnect tokens for K. Suppose P,
during S1, has no current epoch with Q, or its standing token has
expired. Then:
- P's reconnect on the revoked K token gets `token_revoked`. That is a
  failed try (§8.6).
- With the token unusable, P holds no reconnect token. "The reconnect
  bound" makes the pair `stale` at once.
- With Q demoted, Q's token waits more than 24 hours, so S9 shows "may
  have connected to an old copy of your vault" in an honest run.

### 1.7 G7: P has no current epoch at its second write

- The update is a session message, so it is held while P is demoted or
  pending.
- P's reconnect announces K, and Q answers it into K's mailbox. That
  mailbox ends 7 days after the rotate, while a round can take 16 days.
- After that, nothing carries K′ to Q.

§6.6 "Limits" accepts this today. 2.4 changes that stated limit.

### 1.8 G9: a refused reconnect `hs.init` waits its whole life

Both sides rotate. Q is demoted by strict F1 and starts its reconnect.
Then a write fails, and Q stays down past P's grace.
- P's `relay.token.issued` for Q's new key expires at the relay while Q
  is down. Q is demoted, so its update resends and its own
  `relay.token.issued` are held.
- Q's reconnect `hs.init` goes to P's old mailbox and is refused
  `mailbox_unknown`.
- On a definite refusal of an entry that has its own token, the shipped
  vault only ends that outbox entry. This covers `mailbox_unknown`,
  `token_revoked`, and any other refusal of a reconnect `hs.init` on the
  held reconnect token. The reconnect stays open for its 16-day life.
- The next try comes after P's S1 has already ended the pair `stale`.

Two more things hold this cycle closed:
- Q does not know P's new mailbox. P's update reaches Q under an epoch Q
  has demoted, so Q refuses it (`ancestor_ik`) without following its
  links.
- §3.4.1's lost-token sentence ("A deferred token message that is refused
  is lost; P's next resend replaces it") assumes a resend. Nothing resends
  `relay.token.issued` while its sender is demoted or pending, because its
  update resends are held too.

---

## 2. The design

None of this changes behaviour that release 29 builds (A5). The one
exception is writing the shipped behaviour into the spec (2.2 S).

### 2.1 G2: the hybrid G2-H, with the acknowledgment kept separate

0. **The `sub` of Q's tokens.** Every token Q puts in any message to P
   names P's relay key **on Q's record**. It never names a key the
   message only announces (`from.relay.pk`). This is S3's rule applied to
   Q.
1. **Deposit key.** A message P sends on a carried token is deposited
   with the key that token's `sub` names, if P still holds that key
   (G2-B). Otherwise the answer is dropped, as under rule J.
2. **When S2 advances** (this moves the deposit key only). S2 advances to
   the newest of P's keys named by a token from Q, in any of:
   - a reconnect `hs.init` from Q, at the verified `hs.fin` that
     establishes it;
   - an `hs.resp` from Q that P accepts. Its tokens are bound to the
     handshake by its HPKE context, and P accepts it after `sig_R`;
   - an adoption;
   - `relay.token.issued`;
   - **an update from Q that P accepts** (under an epoch), when its
     tokens name a newer key of P. This is the case where both sides
     rotate: Q has followed P and rotated its own key.

   Tokens are matched to Q by connection. When a token's `iss` is a
   mailbox P does not know yet, the advance rests on the authentication
   of the handshake or the epoch, not on verifying the token.
3. **No reconnect while carried or deferred tokens wait.** On P's side:
   P does not take §8.6's "no valid standing token" path while it holds,
   from Q, naming a key P holds, either:
   - undiscarded carried tokens, or
   - a token that rule T deferred for its unknown `iss`.

   The wait is bounded by whichever comes first:
   - the token's `exp`;
   - the handshake's lifetime (`L` for an answer, `B` for a pending
     epoch);
   - rule T's deferral bound.

   This extends a release-29 rule, and only during S1.
4. **S2's re-deposit** covers only entries on held tokens, and never an
   update (2.6).
5. **Tokens in P's handshake messages during S1** are minted by K′'s
   mailbox. This rule exists only under 2.4 (7.5 a). §3.4 (a)'s
   old-key minting exception then goes unused for reconnects.
6. **S2's restarts.** At an advance, S2 restarts P's open reconnects that
   went with K and have sent no `hs.fin`. Two exceptions:
   - The handshake whose message made the advance is not restarted
     (as H5 says: "other than the one whose message made the change").
   - A restart needs a reconnect token naming K′. Without one, the
     reconnect is kept, on the key its held reconnect token names.

   In a write that establishes, the order is: the establishment, then the
   advance, then any restart.
7. **Acknowledged** needs a token from Q whose `sub` is K′ and which P
   holds: from `relay.token.issued`, from an adoption, or kept by rule T.
   Until then:
   - P resends the update at each unlock, with its key for Q. After an
     advance that key is K′, and the resend rides the newest standing
     token naming K′, held or carried. A carried token is used for this
     one message, which extends §6.3.1.
   - P does not delete K on Q's account.
   - Q answers each duplicate update with `relay.token.issued` (rule U).
8. **When P has no token for K′.** If P's carried token is discarded too
   (H5, `B`, `token_revoked`), P resends with K on its held standing
   token for K, if one is still valid. Q takes that as a duplicate update
   from an earlier key (Table A: "rule U"). Otherwise P waits for Q's own
   messages (4, row "Q's evidence").
9. **§3.4 (b) during S1.** A definite refusal of a resend ends that
   token's use, not the resends. P moves to the next usable token, in
   this order: a held one for K′, a carried one for K′, a held one for K.
   The resends end at acknowledgment or at S1's end.
   - A `token_revoked` on a carried token that carried an update does
     two things. It ends that handshake, as §6.3.1 "A carried token
     refused" says, with its carried tokens. And it drops that one
     deposit of the update. The update is not dropped: the next resend
     uses the next token.

**Security.**
- An advance needs Q's `ik` or Q's epoch keys. That is the bar of an
  authenticated handshake with Q.
- A copy of Q taken after Q's last `ik` rotation meets that bar. Such a
  copy already counts as Q (§11.14.2; the copy residuals of §3.4.1).
- An unauthenticated token only picks the deposit key for its own
  handshake.
- Under G2-A, any verified token would advance S2. That bar is lower: a
  copy of Q that read P's update could then move P's deposit key.

**What this re-decides.** Gap 1 stands as written for "acknowledged"
(rule 7). The deposit key moves earlier, on authenticated evidence
(rules 1 and 2). That is 7.4.

### 2.2 G1 and G3: G1-N, with the shipped behaviour written into the spec

**S. The shipped behaviour (7.1).**
- **S-a.** A reconnect after a demotion, or by strict F1, starts once it
  can (`canReconnect`). It then:
  - abandons the side's own rekeys;
  - drops its open answers to the peer's rekeys (release-29 rekeys carry
    no tokens, so nothing is revoked);
  - abandons its pending epoch.

  A side with a pending epoch of its own does not **retry** the demotion
  reconnect until that epoch is confirmed (which ends the demotion) or
  abandoned (at `B` at the latest). This is shipped: `tickDemoted`
  returns while a pending epoch exists. It cannot wait forever: the
  pending epoch ends at `B`, and the demotion reconnect then starts
  (`tickPending`, `restartAfterDemotion`). But the wait can reach `B` =
  32 days, which is longer than S1's 30 (4, 7.10). In the model, a
  demoted record with its own pending reconnect occurs in 91 and 111 of
  10,000 runs, and 3 and 2 of those end `stale`. A pending rekey never
  occurs there.
- **S-b.** While a reconnect naming an epoch other than the current one
  is open, a rekey `hs.init` from the peer is discarded
  (`rekey_replaced_by_reconnect`).
- **S-c.** A pending epoch, and `B`, start at the write that queues its
  `hs.fin`.
- **S-d.** Between persons, only an answer to a peer's **reconnect**
  holds a side's own reconnect.

Two amendments to the spec text:
- **Rule J** ends: "Then the rekey block of §6.5 does not hold `R`
  back."
- **§6.5's crossing sentence** gains: "except that a reconnect after a
  demotion or by strict F1 replaces the side's rekeys and its answers to
  the peer's (§3.4.1)".

**N1. Q's mirror of S2.** When Q follows a relay link, it abandons and
restarts each of its own open reconnects whose `hs.init` carried tokens
naming the passed key and which has sent no `hs.fin`.
- The reconnect whose message made the follow is not restarted.
- The abandonment is Q's own step, so it revokes the carried tokens.
- The restart uses the update's fresh K′ reconnect token.
- N1 runs after any establishment in the same write.

**N2. Two messages pass the cut-off.** This holds between two vaults
only, and only while Q has accepted no message from P's newer key. In
Table A, row "Earlier, after its cut-off", these are processed:
- an **`hs.confirm`** under an epoch whose keys were established under a
  handshake signed by Q's current `ik` for P;
- an **`hs.fin` to an answer Q has open**, whose `sig_I` verifies under
  the pinned `ik`, when that `ik` is Q's current `ik` for P.

Binding L makes both safe (2.6). A device rotates no `ik`, so for a
device's relay key binding L binds nothing, and N2 does not apply.

**The G3 cases.**

| Q followed | Q is | Covered by |
|---|---|---|
| before its `hs.init` | initiator | G2-B (rule 1) |
| after its `hs.init`, before `hs.fin` | initiator | N1 |
| after its `hs.fin` (its reconnect pending) | initiator | N2 (`hs.confirm`) |
| after answering P's reconnect, by an update it processed late | responder | N2 (`hs.fin`) |

**The held rekey `hs.fin`.**
- If Q has an epoch, Q's token comes and S2 re-deposits the `hs.fin`.
- If Q is demoted, S-a drops Q's answer. P's pending rekey epoch ends
  when Q's reconnect is established at P (§6.3.1), and the held `hs.fin`
  goes with it.

**What this reverses.** #536 O1a, for these two messages.

### 2.3 G1-A (the broader alternative)

This also applies between two vaults only.
- S1 also lets out a rekey's `hs.init`, `hs.resp` and `hs.fin`.
- After the cut-off, these pass when they are authenticated under Q's
  current `ik` for P:
  - an `hs.resp`, by `sig_R`;
  - an `hs.fin`, by `sig_I`;
  - an `hs.confirm` or a session-mode rekey `hs.init`, by epoch keys from
    a handshake signed by that `ik`.
- At S2's advance, P restarts its unanswered rekeys that went with K,
  unless an epoch was established since each began.
- The narrowing of N2 applies here too.

**The residual.** Decoupled rotations (a gate-owed key, or the next key
after a pending one) generate the relay key after the current `ik`. A
copy taken between that `ik`'s write and the relay key's first write
holds both. It can run a whole rekey through K until the narrowing
closes. Under G1-N it can only confirm, or finish a reconnect Q
answered. Both are within the existing residual "An old copy ... can
confirm Q's pending epoch as P", and §11.14.2.

**I3's wording.** "... except tokens that pass rule T, duplicates of
followed links, and, until Q first accepts a message from P's newer key,
[G1-N: an `hs.confirm`, or an `hs.fin` to an answer Q has open; G1-A: a
handshake message or `hs.confirm`] authenticated under Q's current `ik`
for P, which a copy taken before that `ik` was written cannot make."

### 2.4 G7, and the answer past the grace: links in reconnects

**What P sends.** During S1, two messages **announce K′**:
- P's reconnect `hs.init`, in `from.relay`;
- P's `hs.resp` to Q's reconnect, in a new field.

Each carries:
- `relay_links` from K to K′;
- P's `ik` links (binding L);
- `token` and `reconnect_token`, minted by K′'s mailbox.

Each is still deposited with K (rule 1).

**When Q accepts them.** Q accepts these from K, before or after K's
cut-off, when all three hold:
- the links connect the `sender` to the announced key;
- the links pass rule C;
- the announced key is Q's current key, or is reached through those
  links.

Without the links, a reconnect `hs.init` from K after the cut-off stays
refused.

**When Q follows.**
- For an `hs.init`: at the verified `hs.fin` that establishes it. That
  `hs.fin` is the cut-off, and it is counted as before it.
- For an `hs.resp`: at its verified `sig_R`. The `hs.resp` is the
  cut-off.
- In the write that follows, Q applies the `ik` links first, then the
  relay links, then takes the tokens by rule T.

**Other effects.**
- At the second write, P abandons and restarts, by these rules, its open
  reconnects that announced K and have sent no `hs.fin`.
- The Q-side hold (3.3) also ends at such a follow.

**How Q gets a usable K′-mailbox token.**
1. Q's `hs.confirm` goes into K′'s mailbox on the carried token of the
   `hs.init`.
2. P confirms and sends its prompt `relay.token.issued` with K. That
   prompt reaches Q after the cut-off, so Table A takes only its tokens,
   by rule T. Q keeps them as held tokens; there is no adoption.
3. Q's own `relay.token.issued` for K′ goes into K′'s mailbox on one of
   those tokens.
4. P now holds a K′ token: acknowledged (rule 7).

**Spec changes.**
- §6.2: `from.relay` during S1, `relay_links`, and the announced key in
  `hs.resp`. The tokens stay required.
- §6.3: the `sender` check gives way to linked keys.
- §6.6 "Initiating": `from.relay` names the announced key.
- §6.6 "Authentication": the collect `sender` may be an earlier key
  linked to the key on record.
- Table A's preamble.
- §3.4 (a): exception 2 is dropped for reconnects.
- Rule T's reconnect clause: `iss` is the announced key's mailbox.
- Rule U: following by these links.
- §6.6 "Limits": the G7 sentence goes.

**Safety.** It rests on `sig_I` or `sig_R` verifying under an `ik` Q
reaches, together with binding L. A copy taken before the rotation's
first write holds only an ancestor `ik`, which Table B refuses. A copy
taken after that write counts as P. The cap on answers opens only to
messages that carry valid links.

**The bound.** About 6`U`, one `U` per hop:
1. the `hs.init`;
2. the `hs.resp`;
3. the `hs.fin`, at which Q follows;
4. the `hs.confirm`;
5. P's prompt;
6. Q's token.

Add a round if P must first wait for its own demotion to resolve. That
needs a rotation by Q, so it belongs under "both sides rotate" (4).

### 2.5 G6: the revoked reconnect token during S1

- **No failed try, no stale.** During S1 toward Q, a `token_revoked` on a
  **reconnect** token issued for an earlier key of P:
  - is not a failed try;
  - does not trigger "The reconnect bound"'s "no reconnect token"
    judgement. That judgement is suspended while P is in S1 toward Q and
    holds no reconnect token only because of such a revocation. The
    suspension is bounded by S1 (7.10).

  P stops using that token. This changes the shipped `noReconnectToken`
  path for relay-key rotation only.
- **S9.** Rule U never revokes standing tokens. So a reconnect-token
  revocation is what an honest follow looks like, and is no fork sign.
  The choice of what S9 then means is 7.12.
- **What P waits for.**
  - Q's reconnect, or Q's `relay.token.issued`.
  - If P is demoted, it refuses Q's messages under the demoted epoch.
    Q's token then arrives only under the epoch that P's demotion
    reconnect (2.4) makes. That reconnect goes on a K′ reconnect token
    once P has one (an advance, or Q's token).
  - Both waits are bounded by the "Q's evidence" row of 4. This is A1's
    "no rule demotes an honest pair", applied to the new epoch; it is
    checked by an oracle (6).

### 2.6 Binding L: the update carries P's `ik` links

- The update carries `rotations`, as S8 says for `identity.rotate`.
- Every deposit of an update is **sealed afresh under the then-current
  epoch**, with its links made again: each resend, each held update when
  it goes out, and after S2's advance. S2's same-bytes re-deposit does
  not apply to updates.
- Q applies the update's links first, in the same write:
  - rule C;
  - Table B;
  - H5;
  - the demotion rules;
  - R29-K9, on a duplicate update too.
- If Table B refuses a link, Q follows no relay link from that update.
- **The guarantee.** No copy taken before the write of the `ik` current
  at the relay link's first write passes N2, G1-A's pass, or 2.4. This
  is not absolute for decoupled rotations (2.3).
- **K9 at the update** is sound on the same argument as at
  `identity.rotate`: every copy of the update is sealed under P's current
  epoch at its deposit. To be modelled.
- **Side effect.** The update can demote Q (strict F1).
- **Alternative: binding R.** Put the `ik` into the relay link's signed
  body. This needs a new format and test vectors, and it does not
  deliver the links.

### 2.7 G9: a refused reconnect, and the links of a refused update

- **A refused reconnect is a failed try at once.** A definite refusal of
  a reconnect `hs.init` (`mailbox_unknown`, `token_revoked` on its own
  token, or another `4xx` other than `429`) ends that try at once. It
  counts as a failed try under "The reconnect bound". The next try
  starts as soon as a newer mailbox or token for P is known (below), not
  after 16 days.
  - A `mailbox_unknown` for an earlier mailbox of P, while Q knows no
    newer one, is not counted. Q waits for the links instead, bounded by
    the hold's limit (7.8).
  - This changes shipped behaviour (the outbox's refusal path).
- **The links of a refused update.** An update that Q refuses only
  because its epoch is demoted or destroyed still has its links applied,
  in the write that refuses it, after rule C. These are binding L's `ik`
  links first, then the relay links. This mirrors §6.6 "The links of a
  refused reconnect". Q then knows P's new mailbox, and its next try
  goes there under 2.4. Its tokens are not taken: the message is refused.
  Q's try uses the update's reconnect token only once a later accepted
  message delivers it.
  - *Unsure:* the try also needs a token for K′'s mailbox. Under 2.4 it
    could instead ride the reconnect token that P's own 2.4 messages
    carry. To be checked in the model.
- **Safety.** The relay links carry K's and K′'s signatures, made in the
  rotation's first write. The `ik` links are checked by Table B before
  any relay link is followed, so no copy taken before that write gains
  anything.
- **Under relay forwarding (7.6 d)**, Q's `hs.init` to P's old id lands
  in P's successor, and the gap does not arise.

---

## 3. The crash order between the relay's rotate and the state write

### 3.1 What §3.4 says

"Stores first, then rotates, and retries with the same key." The three
paths follow it. The exception is a recovery's fresh key after a refused
registration.

### 3.2 What each crash point leaves

"Grace loss" (3.3) means: deposits the relay accepted into K's mailbox
after P's last collect of it are lost silently when the mailbox ends.

| Crash point | State | Relay | Next unlock | Lost |
|---|---|---|---|---|
| C0: before the first write | K current; an owed mark, if written | old mailbox | the mark retries | nothing |
| C1: after the first write, before the rotate | K current, K′ pending; new `ik`; `identity.rotate` sent | old mailbox | the rotate, same K′ | nothing |
| C2: after the rotate, before the second write | as C1 | both; the grace has started | the rotate again, then the second write; past the grace, the registration (`200` continues; `201` re-mints all) | grace loss, widened by `U` |
| C3: after the second write, before the updates leave | K′ current; K for deposits | both | the outbox sends them | grace loss, as without a crash |
| C2′: after K1's second write, which also stores K2 | K1 current, K2 pending | K1's mailbox; K's in its grace | as C1, for K2 | grace loss, for K's mailbox |
| CR: a definite refusal, before its write | as C1 or C2 | unchanged | refused again, then written | as C1 or C2 |
| CF: a recovery's fresh key, registered before any state holds it | the inherited key, refused | an empty mailbox nobody was told of | the open is retried | an orphaned mailbox (within the relay's limit of 3) |

### 3.3 Is it complete?

**Safety:** yes. **Liveness:** no.

#### What is lost

Q keeps depositing to K's mailbox until it follows. P collects that
mailbox only when it unlocks. Measured from the rotate, under A3, Q has
stopped depositing to K and P has collected it:
- on the **update path:** after `U` (the update) + `U` (P's collect) =
  2`U`;
- on **2.4:** after 3`U` (Q follows at the `hs.fin`) + `U` = 4`U`;
- on **2.4 when P must first wait a round:** after 8`U`.

A C2 crash adds `U` to each, and a lock outside A3 adds its length.
- Deposits the relay accepted after P's last collect are lost silently.
- Deposits refused after the end hit §8.6's `mailbox_unknown`, which
  today makes the connection `stale`.

#### G8: both sides' old mailboxes end

Each side's update, or its 2.4 `hs.init`, must reach the other before the
other's grace ends. From the later rotate that takes about 2`U` + `U`
(3`U`) on the update path. On 2.4 with a demoted side it takes up to
8`U`.

#### The mechanisms

**The grace.**
- It is a relay setting, today 7 days. Changing it changes the deployed
  relay's configuration and RELAY-PROTOCOL §6.7's default.
- It applies to every mailbox, devices' rotations included.
- A longer grace keeps an old copy on the live old mailbox for that long
  at every rotation (§3.4.1 Residuals).

**The Q-side hold.**
- **What is held.** A deposit to P's mailbox refused `mailbox_unknown`.
  It is held while all three are true:
  - the connection is active;
  - since the first refusal, no update from P has named a newer mailbox;
  - Q has not followed by 2.4.
- **What being held means.** The deposit is not ended
  (`drop.undelivered_mailbox_unknown`). It is not a failed try, and not a
  reason for `stale`.
- **When the hold ends.** At a follow, which re-addresses it. Or at the
  connection's end. Or at the hold's limit (7.8), after which §8.6
  applies as today.
- **What the member sees.** A held message shows as held, not as sent:
  "Waiting to reach <name> at its new address." (new text, 7.15).
- **What a copy can see.** A refused deposit is not stored at the relay,
  so an old copy that collects K cannot read it.
- **What the hold cannot save.** Deposits the relay already **accepted**.

**The telling (`relay.mailbox.closed`), specified in full.**
1. P stops collecting K's mailbox, either when it gets `mailbox_unknown`
   on a collect of K or when it acks its last collect there. P then
   records the largest `msg_id` it collected from K. All times here are
   relay times: the ULID is in arrival order per mailbox (RELAY-PROTOCOL
   §6.2).
2. P sends each recipient a **separate** durable message,
   `relay.mailbox.closed {mailbox, last_msg_id}`. It is sealed under P's
   then-current epoch with Q, and goes on every path: the update path,
   2.4, after a crash. While P has no epoch with Q, it is held like any
   durable message.
3. Q keeps each of its **outbox entries** deposited to K, with the
   `msg_id` of its `201`, until it gets that message or the hold's limit
   ends. This is the entries themselves, not a log.
4. On `relay.mailbox.closed`, Q re-deposits every kept entry whose
   `msg_id` is greater than `last_msg_id`. It deposits them to P's
   current mailbox, with the same inner `id`. Q drops the rest.
5. P dedupes the re-deposits by inner `id` (§8.2).
6. An entry still kept at the hold's limit is told as
   `message.delivery_unconfirmed`.

Its cost:
- a new message type;
- Q keeping its deposits to K for up to the hold's limit;
- P recording `last_msg_id`.

No clock skew is involved, because only relay `msg_id`s are compared.

**Relay forwarding (new option).**
- The relay links a rotated mailbox to its successor at the rotate. It
  already knows the link, since the rotate is signed by K.
- During and after the grace, the successor honours the predecessor's
  deposit tokens, its denylist included, until those tokens expire.
- A deposit to the predecessor's id, after the predecessor ends, lands in
  the successor. When the predecessor ends, its uncollected messages move
  to the successor.
- A sender learns `mailbox_moved {successor}` only as a hint. It still
  follows only by signed links.
- What it closes: the grace loss, G7, G8 and the refused deposits, all
  without lengthening an old copy's hold on K. A copy cannot collect the
  successor without K′.
- Cost: a RELAY-PROTOCOL change and a relay release.

#### The options compared (7.6, 7.7, 7.9)

| Option | Accepted deposits | Refused deposits | G8 covered | Copy's hold on K |
|---|---|---|---|---|
| A long grace, 9`U` (36 days) | kept, read by P | none refused under A3 | yes, under A3 | 36 days |
| 7 days + the hold + the telling | re-deposited | held, then re-addressed | no: both sides hold until the hold's limit, then `stale` | 7 days |
| A grace of at least 3`U` (14 days) + the hold + the telling | re-deposited | held | on the update path only (3`U`) | 14 days |
| Relay forwarding | moved to the successor | none | yes | 7 days |

The **second write** should also list its S1 state.

---

## 4. Liveness argument sketch

This argument covers the design as a whole:
- G2-H with rules 7 to 9;
- G1-N with S;
- binding L;
- 2.4 and 2.5;
- the options of 7.6 to 7.9.

It covers pairs of vaults. Device pairs are covered in 1.5.

### Assumptions

- **A1 to A4:** as in 0.88.2.
- **`t_r`:** the last write by either side that stores an `ik` or a relay
  key. That includes a gate-owed key, at most 30 days after the gate's
  mark, and the next key after a pending one.
- **A5′:** relay keys rotate, and both sides advertise `relay_follow`.
- **A6:** the chosen option of 7.6 covers the path in use (3.3).
- **A7:** no rotate is definitively refused.

### Progress measure

Φ = (π, ν, μ, α, λ, δ, ρ), compared in that order:
- **π:** the pending relay keys;
- **ν:** the (side, recipient) pairs where the recipient has not
  followed;
- **μ:** the pairs where the side's key for the recipient is not its
  current key;
- **α:** the pairs not yet acknowledged;
- **λ, δ, ρ:** as in 0.88.2.

Why it decreases:
- A pending key's second write raises ν, μ and α, but π falls in that
  same write.
- Under binding L, δ and ρ rise only where ν or λ falls.
- The restarts of S2 and N1 happen only where μ or ν falls.

### The steps

- **Step 0.** π reaches 0 within `U` of `t_r`.
- **Step 1.** ν reaches 0 within 2`U` of the second write (the update),
  or about 3`U` (2.4). λ reaches 0 by `t_r` + 3`U`.
- **Step 2.** μ, then α, reach 0. Every wait names what ends it:

| Wait | Ended by | Bound | Why no cycle |
|---|---|---|---|
| The update reaching Q | S1 lets it through, and resends it (rules 7–9). While P has no epoch, 2.4 carries the links instead | `U`; 2.4: three hops | needs nothing from Q's acknowledgment |
| Q following | rule U or 2.4, with binding L. A demotion of Q by those links leads to the next row's (b) | one hop | needs nothing more from P |
| Q's evidence (μ) | (a) `relay.token.issued` when Q has an epoch; (b) Q demoted: its reconnect runs (S-a, S-d), N1 restarts it if needed, rule 1 delivers P's answer, and S2 advances at the verified `hs.fin`; (c) Q pending: N2 lets P's `hs.confirm` through, then (a); (d) Q responding: N2 lets P's `hs.fin` through; (e) both sides rotate: Q's update naming P's newer key (rule 2) | (a) one hop; (b) about 5`U` from `w`; (c)–(e) one hop more / "The reconnect bound" | Q never waits for a message P holds for want of Q's evidence |
| Acknowledged (α) | a K′ token from Q that P holds: (a), 2.4's prompt path, or a duplicate update's answer | one hop after μ; resends at each unlock | resends ride P's key for Q (rules 7–9) |
| P with no usable reconnect token after a revocation | the no-token judgement is suspended during S1 (2.5); the "Q's evidence" row; then a restart on a K′ token | as that row, within S1 | the revocation is Q's own follow |
| P's held rekey messages | S2's re-deposit, or dropped (S-a, §6.3.1); `B` from the queued `hs.fin` (S-c) | one round / `B` | not needed for progress under G1-N |
| P's other entries held by S1 | S2's advance | as above | — |
| P's entries needing a held K′ token | α | as α | P starts no reconnect meanwhile (rule 3, bounded) |
| Q's refused deposits to K | the hold, until the follow (3.3) | the first two rows | — |

### The bound, counted from P's second write `w`

**One side rotates.** About 6`U` at worst, which is 24 days at `U` = 4:
- Q has an epoch: 2`U`.
- Q is demoted: about 5`U`.
- 2.4: about 6`U`.

**Both sides rotate.** Q may have no current epoch until 0.88.2's
settling at `t_r` + 12`U`, so the bound is `t_r` + 13`U`.
- Each new rotation by Q moves `t_r`, so the bound has no ceiling counted
  from `w`.
- Hence 7.10: S1's clock must stop or restart while Q makes progress,
  under a hard cap.
- **The `tickDemoted` wait.** A demoted Q with its own pending reconnect
  retries only after `B` (32 days, S-a). S1's 30 days are then too short
  unless S1 pauses on Q's authenticated messages. P has accepted Q's
  `hs.fin`, so 7.10 b pauses. Under 7.10 a, S1 restarts only on a link,
  and this wait brings no link. A cap of at least `B` plus a hop (7.10's
  60 days) covers it.

### What still ends `stale`, visibly

- 0.88.2's list;
- S1's clock (7.10);
- the gate's deadline;
- G8 under the options of 7.6 that do not cover it;
- G4, if the harness finds a failure.

---

## 5. Other wait cycles with relay-key rotation on

- **G3.** Closed by 2.2 (N1, N2), or by 2.3.
- **G4: both sides rotate.**
  - **Within one hop.** Q's `relay.token.issued` names an `iss` that P
    does not know yet. It is deferred, then refused, and the next resend
    replaces it. An authenticated handshake still advances S2 (rule 2).
    P can use the token only once rule T keeps it. Until then:
    - P's held entries wait (rule 3);
    - a kept reconnect goes on the key its held reconnect token names.
  - **After P followed Q.** P's later update names Q's new key (S3), while
    Q, in its own S1, deposits only with its old key. A demoted Q's
    reconnect then has no token and ends `stale`. Rule 2's update source
    advances Q's S2 on that update, so Q deposits with its new key.
  - Both are argued as bounded, and checked in the G4 schedule.
  - **How common.** In the aligned model, G4 occurs in almost half of
    the stale ends: 53 of 118 in seed 1 and 51 of 111 in seed 2. So the
    case where both sides are in S1 is not a corner case for this design
    (6).
- **G5.** S2's restart without a K′ reconnect token: the reconnect is
  kept (rule 6).
- **G6, G7.** Closed by 2.5 and 2.4.
- **G9.** Closed by 2.7, or by relay forwarding.
- **G8: both sides' old mailboxes end.** P rotates K→K′ and Q rotates
  J→J′. Each knows the other only at the old address. If neither update
  arrives before the other's grace ends:
  - every deposit fails;
  - 2.4's reconnect goes to the same dead mailbox;
  - both sides hold until the hold's limit, then end `stale`.

  Its bound per option is in 3.3. Only relay forwarding closes it without
  a long grace. Where it remains, the member sees a new text (7.15).
- **H5 and the reconnect token's quota.**
  - N1 uses the update's fresh K′ reconnect token.
  - 2.5 removes the failed tries on a revoked token.
- **The gate, rule U, H5.** No other cycle found.

---

## 6. Harness plan, and the trust model's numbers (internal)

### What exists

- **The vault code has no rotating side.**
  - `rotateIdentity` leaves the relay key alone, and a test pins A5.
  - `Relay` has no rotate call.
  - `hAddressUpdate` predates 0.85.
- **The random-pair harness has no relay-key mode.** Its modes are the
  default, `R29RP_BURST`, `R29RP_SHUFFLE`, `R29RP_REFRESH`,
  `R29RP_SPENT` and `R29RP_LOSTANS`. Replays use `R29RP_TRACE` and
  `R29RP_REPEAT`.
- **The trust model.** `TRUSTMODEL_RELAYROT=1`, on a model branch aligned
  with S-a, S-b and S-d; S-c was already modelled. Each stale end is
  labelled with the wait it was stuck in.
  - It has one own-handshake slot; see "A model limitation" below.

### The trust model's numbers

Stale ends per 10,000 runs per seed, with relay-key rotation on. The
classifier is a heuristic: each row lists gaps that occurred together.

**Before → after aligning the model with S-a, S-b and S-d**, in the
classes used before G4 and G8 were labelled:

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

**After the alignment, with the G4 and G8 labels.** G4 here means both
sides in S1. In this model a reconnect `hs.init` keeps the mailbox it was
queued for, as `startReconnectCtx` does.

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

**What these numbers say.**
- **G2 is the main real gap.** Under the shipped behaviour the G1 wait no
  longer forms, and the same pairs end through G2.
- **G4 is common.** It appears in 53 of 118 and 51 of 111 stale ends,
  almost half, so both sides being in S1 at once is an ordinary case.
- **G8 occurs** in 5 and 6 runs, always with G4 and G7.
- **The runs with any violation:** 109 and 96 with rotation on; 0 and 2
  with rotation off (the two that predate this work).
- **Smaller findings.** Seed 2 also has one I1 loss, class G3 + G4 + G7.
  One I2 per run set is not yet classified.
- **The traced run that used to be "other" is a real gap,** G9 (1.8). It
  is now classed G4 + G7, and 2.7 addresses it.
- **One finding in the default configuration was a model error.** It is
  resolved; see the residuals in step 5.

**A model limitation.**
- The model has one slot per side for its own handshakes, so it blocks a
  reconnect beside an open own rekey. The shipped vault does not:
  `startReconnectCtx` checks only for an open own reconnect. This happens
  in about 40% of rotation-on runs.
- An experiment that abandons the rekey so the reconnect can start leaves
  the stale counts unchanged (109 and 96; 0 with rotation off at seed 1).
- Full alignment needs two concurrent own handshakes in the model. That is
  listed as model work (step 1).

### Steps

1. **The model.**
   - Put each fix behind its own switch:
     - G2-H rules 0–9 (rule 2's update source included);
     - N1 and N2;
     - G1-A with the narrowing;
     - 2.4 (`hs.init` and `hs.resp`);
     - 2.5 with the suspended judgement;
     - binding L (K9 on the update, a duplicate, and every resend);
     - the hold;
     - the telling;
     - the grace lengths;
     - relay forwarding.
   - Run each at 10,000 runs, then at 100,000, with and without
     ROTBURST.
   - Model two concurrent own handshakes per side (a reconnect beside an
     own rekey), as the vault allows.
   - Add 2.7's rules: a refused reconnect as an immediate try, and the
     links of a refused update.
   - Check that the old-copy actor breaks I3 when binding L is off.
   - Add a device-pair configuration.
2. **The real code, on a branch that is not merged.**
   - The rotating side, rule U with binding L, and Table A's earlier
     rows.
   - G2-H, G1-N, 2.4 and 2.5, plus the chosen 7.6–7.9 mechanisms.
   - A stub relay with: an idempotent rotate, the grace with collects
     from both mailboxes, tombstones, `mailbox_unknown` after the grace,
     step 7 of §5.3, and the denylist. Add forwarding if 7.6 picks it.
3. **Mode `R29RP_RELAYROT`.**
   - **Rotations:** all three paths and the decoupled keys.
   - **Crashes:** C1, C2, C3, C2′, CR, CF.
   - **Schedules:**
     - locks around the grace;
     - P demoted at its second write (G7);
     - Q following at each point of a reconnect, as initiator and as
       responder;
     - **G4**: within one hop with an unknown `iss`, and after P has
       followed Q, so that P's update names Q's new key;
     - **G8**: both sides rotate, with locks around both graces.
   - **Oracles:**
     - I1 extended (ν = μ = α = 0; nothing held by S1);
     - I2, I5;
     - I3-lite;
     - S2 never advances before Q's follow write;
     - acknowledgment only with a held K′ token;
     - no S9 fork text in an honest run;
     - **no `stale` from "no reconnect token" while in S1 after a
       revocation for an earlier key**;
     - a demoted P takes Q's token only under a new epoch;
     - every `201`'d deposit is collected, re-deposited or told.
   - **Counters:**
     - S2 advances by kind;
     - reconnect-token deposits per rotation;
     - the time from `w` to α = 0, against S1's clock.
4. **The bar.**
   - 0 honest runs end `stale`, diverged or suspended outside accepted
     residuals, at 10,000 runs per mode: `R29RP_RELAYROT` crossed with
     every mode, plus every mode alone.
   - Counted from the `-v` class table and counters (`-test.v` for a
     prebuilt binary), never from a PASS.
   - Each new oracle is shown to fire before its zero is reported.
5. **Likely residuals.**
   - S1's cap (7.10).
   - A recipient away beyond it.
   - G8 under the options that do not cover it.
   - G4, if it fails.
   - The rapid-rotation rate.
   - The decoupled-rotation copy.
   - Grace loss beyond the chosen option.
   - The hold's limit when a `connection.removed` is lost.
   - *Resolved, a model error:* a finding in the default configuration,
     where an old copy's reconnect replacing the peer's rekey went
     unseen.
     - The vault code makes it visible at the honest side's reconnect
       `hs.fin`, through Fork by ctx. The test is vettid-vault `ab9beb8`,
       on branch `i7-realcode`, test only.
     - The model now does the same (`0cbab85`).
     - The exposure before that point is the release-29 residual of
       VAULT-MESSAGING §3.4.1.

---

## 7. Owner questions

The questions are in the order to decide them. Each gives:
- its choices, 24 characters or fewer;
- what each costs;
- what it depends on;
- a recommendation.

New member-facing texts are collected in 7.15.

### 7.1 The shipped release-29 behaviour, written into the spec

This covers S-a to S-d, with Rule J and §6.5 amended.
- **a = `spec follows shipped`**
  - Cost: two amended sentences, and no code change.
- **b = `code follows the spec`**
  - Cost: changes shipped behaviour. G1 then cycles about half the time.
  - Forces 7.3 b.
- **Recommendation: a.**

### 7.2 Binding the `ik` to the relay link

- **a = `ik links in the update`** (binding L)
  - Cost: the update's handler runs the identity path, K9 included.
  - Every deposit of an update is sealed afresh.
- **b = `ik in the relay link`** (binding R)
  - Cost: a new signed format and test vectors. It does not deliver the
    links.
- I3's safety under 7.3 and 7.5 rests on this choice, whichever is
  taken.
- **Recommendation: a.**

### 7.3 What passes Q's cut-off (reverses #536 O1a for what is named)

- **a = `confirm+fin, Q restart`** (G1-N)
  - What passes: an `hs.confirm` and an `hs.fin` to an answer Q has
    open, between vaults; plus N1.
  - Needs 7.1 a.
- **b = `signed hs msgs pass`** (G1-A)
  - Cost: a wider Table A change, and a wider decoupled-copy residual.
- **c = `nothing passes`**
  - Cost: G3 stays. A pending Q, or a responding Q, ends `stale` at `B`.
  - Under c, 7.5 a uses only its `hs.init` variant.
- **Recommendation: a.**

### 7.4 The acknowledgment rule (re-decides part of "gap 1", 2026-11-05)

- **a = `ack needs held K′ token`** (G2-H)
  - S2 may advance on authenticated evidence; that moves the deposit key
    only. "Acknowledged" keeps gap 1's rule.
  - Cost, the whole machinery:
    - rule 0 (Q's `sub`);
    - rule 2's five advance sources;
    - rule 3's bounded wait;
    - rule 6's restarts and their exemption;
    - rules 7–9: resends on carried tokens, the fallback to K, and §3.4
      (b) amended.
- **b = `ack at S2's advance`**
  - Cost: gap 1's liveness failure comes back. P stops resending, and
    may delete K, while it holds no K′ token.
- **c = `signal unchanged + G2-B`**
  - S2 waits for `relay.token.issued`. Only messages on carried tokens
    pick their token's key (rule 1).
  - Cost: P's other traffic waits a hop longer. G2-B by itself moves
    part of O1a's premise.
- **Recommendation: a.** c is the conservative choice and also closes
  G2 when combined with 7.3 a. a reaches acknowledgment sooner.

### 7.5 Reaching Q when the old mailbox cannot (G7, and the answer past the grace)

- **a = `links in reconnects`** (2.4)
  - Cost: changes to §6.2, §6.3, §6.6 "Initiating" and "Authentication",
    Table A's preamble, rule T, and §3.4 (a). It removes a limit stated
    in §6.6. Rule 5 exists only under a.
  - Its `hs.resp` variant needs 7.3 a or b.
- **b = `grace while unacked`**
  - Cost: an old copy keeps the live mailbox until every recipient has
    acknowledged. It is a relay protocol change.
- **c = `accept as residual`**
  - Cost: a demoted P, or a P that Q reaches only past the grace, loses
    the connection (`stale`).
- **Recommendation: a.**

### 7.6 The old mailbox's end (a relay setting, today 7 days; devices included)

- **a = `grace 36 days`**
  - Covers the grace loss, the 2.4 waits and G8 under A3, with no new
    message.
  - Cost: an old copy keeps the live old mailbox 36 days at every
    rotation. Slow recipients' deposits sit where the copy can read them.
- **b = `7 days, hold and tell`**
  - Cost: needs 7.7 a and 7.9 a. G8 is not covered: both sides end
    `stale` at the hold's limit.
- **c = `14 days, hold and tell`**
  - Cost: needs 7.7 a and 7.9 a. Covers G8 on the update path (3`U`)
    only.
- **d = `relay forwards to new`**
  - Covers the grace loss, G7, G8 and refused deposits, with no longer
    hold on K. Devices are covered too.
  - Cost: a RELAY-PROTOCOL change and a relay release. 7.7 to 7.9 then
    matter only for refusals from relays that lack it.
- Depends on 7.5.
- **Recommendation: d.** If no relay change is wanted now, c.

### 7.7 The Q-side hold: does it exist?

- **a = `hold refused deposits`**
  - Cost: held messages need a shown state (7.8).
- **b = `no hold, stale as today`**
  - Cost: every refusal after the grace ends the connection `stale`.
- Depends on 7.6. Under 7.6 d, it covers only relays without
  forwarding.
- **Recommendation: a.**

### 7.8 The hold's limit, and how a held message is shown

These are member-facing; the texts are in 7.15.
- **a = `hold 30 days`**
  - Cost: shorter than 7.10's cap, so a slow follow can still end in
    "not delivered".
- **b = `hold 60 days`**
  - Aligned with 7.10's cap.
  - Cost: a deleted peer whose `connection.removed` was lost shows 60
    days of "waiting" instead of "not delivered".
- With either choice, a held message shows as held, with the new text,
  never as sent. At the limit it is told by the existing
  `message.not_delivered`.
- Depends on 7.7 a and 7.10.
- **Recommendation: b.**

### 7.9 The telling (`relay.mailbox.closed`; only under 7.6 b or c)

- **a = `tell and re-deposit`** (3.3)
  - Cost: a new message type. Q keeps its deposits to K until told or
    until the hold's limit.
- **b = `no telling`**
  - Cost: accepted deposits after P's last collect are lost silently.
    That breaks the "no silent failures" rule.
- **Recommendation: a.**

### 7.10 S1's clock (member-facing numbers)

Depends on 7.4: under 7.4 a, rule 8's window must also fit inside it.
- **a = `restart on Q, cap 60`**
  - S1's 30 days restart whenever P follows a link of Q's, never past 60
    days after the second write.
  - Cost: a Q that rotates and never follows is ended at up to 60 days.
- **b = `pause on Q, cap 60`**
  - S1 does not run while P has accepted an authenticated message from Q
    in the last 16 days, capped at 60 days. This also covers rule 8's
    window.
  - Cost: as a. An active Q that never follows waits up to 60 days.
- **c = `S1 of 60 days`**
  - Cost: every unreachable recipient is ended twice as late.
- **d = `keep 30 days`**
  - Cost: both sides rotating can end honest pairs `stale` (4).
- Also depends on 7.3 and 7.5: under 7.5 c the one-side bound already
  breaks.
- A demoted Q with its own pending reconnect can wait up to `B` (32
  days) before it retries (S-a). b's pause covers that wait; a's restart
  does not, because the wait brings no link; c and d leave it to chance.
- **Recommendation: b**, with 16, 30 and 60.

### 7.11 A refused reconnect `hs.init` (G9)

- **a = `fail now, follow links`** (2.7)
  - A definite refusal is a failed try at once, and the next try starts
    when a newer mailbox is known. An update refused only for its demoted
    epoch still has its links applied.
  - Cost: changes the shipped refusal path, and adds one more "links of a
    refused message" rule.
- **b = `keep the 16-day wait`**
  - Cost: G9 stays. A demoted side that missed the grace ends `stale` by
    S1 before its next try.
- Under 7.6 d (relay forwarding) G9 does not arise, but b would still
  hold a try for 16 days after any other refusal.
- **Recommendation: a.**

### 7.12 S9 (G6)

- **a = `S9 on standing only`**
  - A revoked reconnect token is never S9. Rule U never revokes standing
    tokens, so **S9 then never fires for a relay fork**. A fork is seen
    only through S1's `stale`, shown as a plain stale.
- **b = `S9 at S1's end`**
  - When S1 ends a recipient `stale` and a reconnect token for an
    earlier key was revoked, the member gets S9's fork text instead of
    the plain stale text.
  - Cost: the fork is shown at S1's end (7.10), not after 24 hours.
- **c = `Q revokes on relay fork`**
  - Q revokes the passed key's standing tokens when it suspends for a
    relay fork, so a standing-token S9 can fire.
  - Cost: a change to Q's fork handling.
- **Recommendation: b.**

### 7.13 How to meet "search on the real code"

- **a = `model, then code branch`**
  - Cost: the model's switches come first.
- **b = `code branch only`**
  - Cost: slower attribution.
- **Recommendation: a.**

### 7.14 0.88.2's `hs.confirm` paragraph (wrong after the cut-off)

- **a = `fix in the redesign PR`**
  - Cost: none for release 29.
- **b = `erratum now`**
  - Cost: a spec round.
- **Recommendation: a.**

### 7.15 New member-facing texts, for approval

Each applies only under the choice named.

1. **The held state** of a message (7.7 a, 7.8): "Waiting to reach
   <name> at its new address."
2. **`message.delivery_unconfirmed`** (7.9 a, at the hold's limit). This
   reuses the approved text ("A message to <name> may not have been
   delivered: …"). Confirm that it fits this new trigger.
3. **G8's stale** (both sides moved, under 7.6 b or c): "<name> and your
   vault both moved to new addresses and couldn't reach each other.
   Connect again with a new invitation."
4. **S9 at S1's end** (7.12 b). This reuses S9's text, which is still
   awaiting approval: "<connection name> may have connected to an old
   copy of your vault. Contact <connection name>."
