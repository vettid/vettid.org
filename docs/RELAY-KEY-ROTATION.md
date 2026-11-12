# Relay-key rotation without wait cycles: design note (draft 1)

For the owner and the lead. Read against VAULT-MESSAGING 0.88.18. Origin
is now at 0.89.0 (approval documents); that change does not touch §3.4,
§3.4.1, §6.3.1, §6.6, §7 or §8, so every quote below holds for 0.89.0 too.
RELAY-PROTOCOL as on the same master.

Sections 1 to 5 are written so that they can move into the spec. Sections 6
and 7 are internal.

Words used below:
- **P** is the side that rotates its relay key from K to K' (and, by S4,
  its `ik` at the same time). **Q** is one recipient.
- **P's key for Q** is S1's term: the newest of P's relay keys whose
  `relay.token.issued` from Q has arrived.
- **Q has followed** means Q has applied P's `relay.address.update` by
  rule U. From then on, K is an "earlier" key at Q, with a **cut-off** at
  the update's position in Q's mailbox.

---

## 1. The two gaps, exactly

### 1.1 What "demoted" means

"Demoted" is an epoch state, defined in §3.4.1:
- "Epochs after an `ik` link": an epoch of P whose signer is the link's
  `old_ik` (or an ancestor), established by a message deposited after the
  link, "is **demoted by position**: it stops being current (if it was)".
- "Strict F1": a link carried under an earlier epoch E while Q's current
  epoch is later and signed by the link's `old_ik`. Q "demotes all of
  them and reconnects naming E".
- "Pending epochs at a link" and §6.3.1 ("An epoch abandoned by a link is
  demoted from the start").

A **demoted Q** is Q in the state of §3.4.1 "After a demotion of the
current epoch": Q has no current epoch with P. The rules for that state:
- "Q sends P nothing but handshake messages (its reconnect below, an
  `hs.resp`, an `hs.fin`)."
- "Q's durable messages to P are **held** in the outbox ... and sealed,
  with a new `ts`, under the new epoch once it is current."
- Q starts "the reconnect after a demotion", naming E or "the newest epoch
  of P that has been current at Q and is neither demoted nor destroyed".

`relay.token.issued` is a durable session message, so a demoted Q holds
it. It also has no epoch to seal it under. The trust model does the same:
it holds every session message, `relay.token.issued` included, while Q
has no current epoch.

A demotion is honest when P rotates its `ik` while Q holds an epoch P
never activated. Example: P's rekey is pending at P and active at Q, and P
then rotates (S5 abandons P's pending epoch). P's `identity.rotate` then
travels under the earlier epoch E, and strict F1 demotes Q's current epoch.
Every relay-key rotation is also an `ik` rotation (S4), so honest
demotions happen exactly around relay-key rotations.

A Q whose own reconnect is **pending** is in the same position.
§6.3.1 Initiator: "While a pending epoch is a reconnect's, `I` sends `R`
nothing but the handshake". 0.88.2's closing paragraph already treats the
two cases together: "A side whose reconnect is pending, or that is
demoted, sends nothing but handshake messages, so it holds
`relay.token.issued` for P's new relay key".

### 1.2 The rules that cause them

- §3.4 "The signal": "A recipient ... has **acknowledged** the new address
  when the vault has received from it `relay.token.issued` for the new
  `sub` (step 4). (0.85.0) Nothing else counts, not even a message
  deposited with a token the vault issued for the new `sub`; until then
  the vault holds what it sends that recipient (§3.4.1 S1)."
- §3.4.1 S1: "P deposits to Q only with it. While it is not P's current
  key, P sends Q only the update, ..., `relay.token.issued`, the messages
  of a reconnect (its `hs.init` announcing that key, its `hs.fin`, an
  `hs.resp` to Q's reconnect), ... `hs.confirm`, and those of a first
  contact ...; everything else for Q waits in P's outbox."
- §3.4.1 S2: P's key for Q advances only "when Q's token arrives".
- §3.4.1 S3: "Every token P puts in a message to Q names as `sub` Q's
  relay key as P knows it when the message is deposited".
- §3.4.1 rule U: Q sends `relay.token.issued` "After that write" (the
  write that follows the update). It is a session message, so a demoted or
  pending Q holds it (1.1).
- §6.3.1 "What they are used for before": the handshake's own messages
  are "each deposited with the carried standing token: `R`'s `hs.resp`
  ..., `I`'s `hs.fin`, and `R`'s `hs.confirm`".
- RELAY-PROTOCOL §5.3 step 7: "`X-VettID-Key` == token `sub` ... else
  `signature_invalid`".
- §3.4.1 Table A, row "Earlier, after its cut-off": every kind is refused
  (`superseded_relay`) except the update (rule U), the tokens of
  `relay.token.issued` (rule T), and an `identity.rotate` whose links are
  all followed (ignored).

### 1.3 G1: the rekey's `hs.fin` and the demoted Q

One honest sequence. The trust model's traces are not available to me, so
this is reconstructed from the rules; *unsure* whether it is the model's
most common path.

1. P starts the rotation's first write: the new `ik` is current, K' is
   pending, and the updates are held. S5 abandons P's open rekeys and
   pending epoch with Q. P sends `identity.rotate` under its current epoch
   E (notices follow the first write, §3.4). S5 restarts P's rekey under
   the new `ik`. Its `hs.init` is deposited with K: S1 is not active yet,
   because K is still current.
2. Q follows the `ik` link. Q's current epoch was the one P abandoned in
   step 1, so strict F1 demotes it. **Q is demoted.**
3. Q answers P's rekey (it names E, Q's confirmed epoch, which "is accepted
   as if it were current", §6.3.1 Responder). Q's `hs.resp` waits for
   `hs.fin`.
4. P's rotate succeeds and the second write makes K' current. P's key for
   Q is still K, so **S1 is active**. P deposits the update with K.
5. Q follows the update: K becomes "earlier" for P, with its cut-off at
   the update. Rule U says Q now sends `relay.token.issued` for K'.
   **Q is demoted, so the token is held** until Q has a current epoch.
6. P processes Q's `hs.resp` and makes `hs.fin`. **S1 holds it**: only "a
   reconnect's" `hs.fin` is on S1's list.

Who waits for what:
- P's `hs.fin` waits for S2 (Q's `relay.token.issued` for K').
- Q's `relay.token.issued` waits for a current epoch at Q.
- Q gets a current epoch from P's `hs.fin` (held at P), or from Q's own
  reconnect after the demotion, which G2 breaks (below).

The cycle ends only at the timers: Q's answer expires at `L` (16 days),
and P's pending rekey reaches `B` (32 days). Then the reconnects meet G2
(and G3, section 5). The pair ends `stale` by "The reconnect bound", or
by S1's 30 days.

Note: adding the rekey's `hs.fin` to S1's list does **not** fix this on
its own. In step 6 the `hs.fin` is deposited with K after the update, so
it lands after K's cut-off at Q, and Table A refuses it
(`superseded_relay`, "handshake kept"). See G3.

### 1.4 G2: the answer to Q's reconnect

1. P is in S1 toward Q (P's key for Q is K; K' is current).
2. Q has followed P's update, so Q's relay key on record for P is K'.
   Q has no current epoch (demoted), or has no valid standing token, so it
   starts a reconnect.
3. Q's reconnect `hs.init` carries fresh standing and reconnect tokens
   for P. By S3 their `sub` is P's relay key as Q knows it: **K'**. Their
   `iss` is Q's mailbox.
4. P answers. By §6.3.1 its `hs.resp` is deposited "with the carried
   standing token" (`sub` = K'). By S1, P deposits to Q "only with" its
   key for Q: **K**.
5. The relay refuses the deposit: `X-VettID-Key` (K) ≠ `sub` (K')
   (RELAY-PROTOCOL §5.3 step 7, `signature_invalid`).
6. Even if the relay accepted it, Q would refuse it. It comes from K
   after K's cut-off, and Table A answers "refuse (`superseded_relay`),
   handshake kept".

Q's try expires unanswered after 16 days and counts as a failed try. The
next try carries the same kind of tokens and fails the same way. At the
third failure the pair is `stale`.

The spec is self-contradictory here: S1 fixes the deposit key to K, while
S3 together with §6.3.1 fixes the token to K', and the relay needs the
two to match.

---

## 2. Candidate fixes

None of the candidates changes a rule that release 29 builds. Release 29
has only Table A's Current and Foreign rows (A5): S1 never holds anything,
and rule U and the gate never run. The one release-29 rule they extend is
§6.3.1 "No reconnect while carried tokens wait" (G2-A, last bullet), and
only while a relay-key rotation is in flight.

### 2.1 G2

**G2-A: a verified token from Q naming P's newer key advances S2.**
- *Spec change.* S2 also fires when P verifies a token from Q:
  - it carries `sub` = a relay key of P newer than P's key for Q;
  - `iss` = Q's mailbox on record, and it passes rule T;
  - it arrives in any message from Q that P accepts at `acceptFrom`
    steps 1 to 4, or takes tokens from. That includes the carried tokens
    of a reconnect `hs.init` or `hs.resp`, before the handshake is
    authenticated.

  The advance only changes the key P deposits with. It adopts nothing
  (§6.3.1's adoption is unchanged). The 0.85.0 sentence "Nothing else
  counts" is replaced.
- *Why it breaks the cycle.* At step 4 of 1.4, P's key for Q is already
  K'. P deposits the `hs.resp` with K', the token's `sub`, so the relay
  accepts it. K' is Q's current key for P, so Table A accepts it too. The
  reconnect completes. Q's `hs.fin`, P's `hs.confirm` (on the carried
  token, `sub` K') and Q's prompt `relay.token.issued` (§6.3.1 "The prompt
  to adopt") all follow.
- *Security.* A token is signed by Q's mailbox key, so it is evidence on
  its own, before `sig_I`. Only a holder of Q's relay key can mint one
  that names K'. The same holders can already send `relay.token.issued`
  for K': Q, or an old copy of Q that read P's update from Q's live
  mailbox. So G2-A gives no one a power they lack today. A false
  advancement (a copy of Q that read P's update) makes P deposit with K'
  while the real Q still knows only K. Q refuses that as `foreign_sender`,
  and P stops resending the update. That is the harm a forged
  `relay.token.issued` already does; S9 and the 30-day stale already
  bound it, and it falls under the existing old-copy residuals (§3.4.1
  Residuals, "Until Q follows P's update"; "A false advertisement harms
  only the advertiser's own connection"). *Unsure:* why 0.85.0 excluded
  "a message deposited with a token the vault issued for the new `sub`".
  I found no stated reason. The owner's O-decisions of 2026-11-05 should
  be checked before this is proposed.
- *Liveness cost and needed care.*
  - After an advance by a carried token, P holds no adopted token whose
    `sub` is K'. P's other entries wait, as for any entry with no valid
    held standing token, until Q's `relay.token.issued` or the adoption at
    confirmation. That is at most one round. P must not read this as
    §8.6's "no valid standing token" case and start a reconnect. Rule:
    while P holds undiscarded carried tokens from Q naming its key for Q,
    "No reconnect while carried tokens wait" holds for P as well (a
    release-29 rule, extended).
  - S2's "an open reconnect whose `hs.init` announced the earlier key ...
    is abandoned and started again with the new key" needs a reconnect
    token naming K'. After an advance by a carried token P may hold none
    (the carried one is not adopted). So S2 restarts only when P holds an
    adopted reconnect token for the new key. Otherwise the open reconnect
    is kept: its answer comes back to the mailbox its `from.relay`
    names, the old mailbox, while that mailbox lives.
- *Complexity.* Small: one more trigger for S2, and two clarifications.

**G2-B: deposit each handshake message with the key its token names.**
- *Spec change.* A deposit made with a carried token (`hs.resp`,
  `hs.fin`, `hs.confirm` and its re-sends) uses the relay key that the
  token's `sub` names, if P holds that key. S1 and S2 stay as they are.
- *Why it breaks the cycle.* The `hs.resp` goes with K', the relay accepts
  it, and Q accepts it (K' is current at Q). The confirmation's
  `relay.token.issued` then advances S2 the ordinary way.
- *Security.* No new acknowledgment signal. P sends nothing with K' that
  it would not send after S2. The handshake's own messages are sealed and
  carry no address.
- *Cost.* It handles only messages on carried tokens. It does not help a
  pending Q whose `hs.init` was made before it followed (its tokens name
  K): see G3. The deposit key now depends on the token, which is a second
  meaning beside S1's "key for Q".
- *Complexity.* Smallest.

**G2-C: Q names P's old key until P confirms.** Q keeps minting for K
until P has seen Q's acknowledgment. This is rejected: Q cannot know when
P has seen it, and rule T at P would then hold tokens for a key that P
stops depositing with after S2.

**Recommendation for G2: G2-A.** It removes the root cause: P learns that
Q has followed from evidence that is exactly as strong as
`relay.token.issued`. G2-B follows from it, because after G2-A the key
for Q always equals the carried token's `sub`. G2-A also gives G1 a second
exit through Q's reconnect. Keep G2-B as the fallback if the owner wants
the signal of "The signal" (§3.4) unchanged.

### 2.2 G1

**G1-A: rekey messages on S1's list, and Table A's cut-off exception for
authenticated handshake messages.**
- *Spec change, part 1.* S1's list gains a rekey's `hs.init`, `hs.resp`
  and `hs.fin`. Today it has a reconnect's only.
- *Spec change, part 2.* Table A, row "Earlier, after its cut-off": an
  `hs.resp` or `hs.fin` for a handshake Q has open, or an `hs.confirm`
  under an epoch, is passed to Table B instead of being refused. This
  holds only when its `ik` is Current or Reached at Q: for `hs.resp` and
  `hs.fin` the key that `sig_R` or `sig_I` verifies under; for
  `hs.confirm` the epoch's P-side signer. A reconnect `hs.init` is **not**
  included: it is not authenticated before `hs.fin`, and a copy could use
  it to make Q answer and so push out honest answers (the cap of 4).
- *Why it breaks the cycle.* P's `hs.fin` goes out with K. Q accepts it
  after the cut-off because `sig_I` verifies under Q's current `ik` for P.
  Q establishes the epoch, has a current epoch again, and releases
  `relay.token.issued`. S2 advances.
- *Security.* The cut-off exists so that an old copy of P holding K is
  refused once Q has followed (I3). By S4, a relay-key rotation always
  rotates the `ik` too. A copy taken before the rotation's first write
  holds K and the old `ik`, never the new one, so it cannot make a
  `sig_R`, a `sig_I` or an epoch signed by an `ik` that is Current at Q.
  A copy taken after the first write holds the new `ik` and already
  "counts as P" (§3.4.1 Residuals, third bullet). This holds for chains
  too: the test is Q's current `ik`, not "newer than K's". So I3's
  substance holds, but its wording must change. Today it says "Q accepts
  nothing the copy deposits after the cut-off except tokens ... and
  duplicates of followed links". It needs "or a handshake message or
  `hs.confirm` authenticated by Q's current `ik` for P, which a copy taken
  before R's first write cannot make". *Unsure:* whether a relay-key
  rotation can complete without its `ik` link being followable. S4 says
  never, and the refused state keeps the new `ik` current from the first
  write, but this should be checked against "A recovery's inherited key".
- *Liveness.* It also closes G3 (section 5) and makes 0.88.2's
  `hs.confirm` argument true after the cut-off.
- *Complexity.* Medium: one Table A cell, S1's list, and I3's wording.

**G1-B: Q never holds `relay.token.issued` behind an unconfirmed or
missing epoch.**
- *Spec change.* Exempt `relay.token.issued` from the demotion hold and
  from the pending-reconnect hold.
- *Why it does not work alone.* A demoted Q has no current epoch to seal
  it under, and its earlier epochs' send keys are gone (§6.5 "Key
  retention"; *unsure* whether every case erases them). A Q with a pending
  reconnect usually has no valid standing token for P, which is why it
  reconnected, and a reconnect token may carry only a reconnect `hs.init`
  (§6.6). The acknowledgment can only travel inside the handshake, which
  is G2-A.
- *Variant G1-B'.* Rekey `hs.resp`s carry a fresh standing token (release
  29 has none), so Q's answer to P's rekey is evidence under G2-A. Cost:
  rekey answers become token-carrying handshakes, with §6.3.1's adoption,
  revocation and rule J consequences, a release-29 rule area. It also
  misses the order where Q answered before it followed.

**G1-C: a demoted Q drops its answers to P's rekeys.** When Q is demoted,
it drops its open answers to P's rekeys and runs its demotion reconnect
at once. With G2-A that reconnect completes.
- *Cost.* It wastes P's rekey, which then runs to `B` or ends at the
  reconnect (Initiator: "when it activates `R`'s handshake as
  responder"). It changes a release-29 responder rule. It relies on
  G2-A. *Unsure* whether an open rekey answer holds Q's demotion
  reconnect at all. §6.5 holds Q's rekeys only, §6.6 "Between two
  persons" speaks of answers to reconnects, and the liveness table says
  "An open answer stops only its own side from starting a rekey or
  reconnect". If it does not hold it, G2-A alone already gives G1 an exit
  through Q's reconnect.

**Recommendation for G1: G1-A, together with G2-A.**
- G2-A gives the demoted or pending Q a way to acknowledge (its handshake
  carries the token).
- G1-A gives P's handshake messages a way past Q's cut-off.

Neither side then waits for a message that the other holds for want of
the first one. G1-B cannot work without G2-A, and G1-C costs rekeys and
touches release-29 rules.

---

## 3. The crash order between the relay's rotate and the state write

### 3.1 What §3.4 already says

"The order of a relay-key rotation" (0.84.0): "The vault **stores first,
then rotates, and retries with the same key**":
1. A first write stores K' as **pending**, with the new tokens and the
   held updates. K stays current. `ik`, `kem` and the wake key are current
   from this write, and their notices follow it.
2. The rotate (`POST /v1/mailbox/rotate`, signed by K, `new_pubkey` = K').
3. A second write makes K' current. K becomes deposit-only, the held
   updates are released, near-end held tokens are re-minted, and the
   recipients are taken again.

The same order applies to all three paths ("The three paths"):
- A transfer: its first write follows the relay's `201` for the old
  phone's notice (§11.14.10).
- A recovery: K' is stored as pending in step 2's write under the new DEK
  (§11.14.6). The one exception is a fresh key after a refused
  registration, which is registered before any state holds it ("A
  recovery's inherited key"; I5's one exception).
- `credential.rotate`: its flush is the first write (§3.5.5).

### 3.2 What each crash point leaves

| Crash point | State | Relay | Next unlock | What is lost |
|---|---|---|---|---|
| C0: before the first write | K current, nothing pending; the event's owed mark if one was written earlier (transfer, recovery) | old mailbox only | the mark retries the whole rotation; a `credential.rotate` is the member's to ask again (§11.14.2) | nothing |
| C1: after the first write, before the rotate | K current, K' pending with tokens and held updates; new `ik`/`kem` current, `identity.rotate` sent | old mailbox only | the rotate with the same K' (in place of registering K); after a definite refusal, the refused state | nothing; no update was announced |
| C2: after a successful rotate, before the second write | as C1 | both mailboxes; the grace runs from the rotate | the rotate again (idempotent, same mailbox), then the second write; past the grace, `mailbox_unknown`, then register K' (`200`: continue; `201`: re-mint every held token) | if the vault stays locked past the grace: the old mailbox's uncollected deposits, and deposits to it from then until the second write (§3.4 "Collecting while a key is pending") |
| C3: after the second write, before the updates are deposited | K' current, K deposit-only, updates in the outbox | both | the outbox deposits them; resends at each unlock | nothing |

Old key only: C0 and C1. New key pending, with the relay holding both:
C2. Both keys held, K' current: C3 and after.

### 3.3 Is it complete?

For safety, yes:
- Nothing is announced before the relay has K' and the state holds it
  (I5).
- A retry always uses the same key, so no successor mailbox is orphaned.
- The refused state and a recovery's fresh key are covered.

For liveness, three points are missing:

1. **The grace runs from the rotate, the recipients' clock from the second
   write.** At C2 the old mailbox's grace (relay-wide; RELAY-PROTOCOL §6.7
   default 7 days) starts at the rotate. The updates go out only after the
   second write, which can come one presence interval `U` later (the next
   unlock). Q then needs up to one hop `U` to follow. Until it does, Q
   deposits to K's mailbox, and past the grace that is refused
   `mailbox_unknown`. §8.6 then says "mark the connection `stale`" for
   Q's deposits. Under A3 (`U` ≤ 4 days) the worst case is 2`U` = 8 days,
   more than 7. Proposed rule: the vault makes the second write in the
   same run as a successful rotate (already so). And either the grace is at
   least 2`U` plus a margin (for example 14 days = `T`), or a C2 crash
   followed by a long lock is a stated residual. This is the owner's call
   (7.3). *Unsure:* the grace the staging and production relays are
   configured with.
2. **Which S1 state the second write stores.** It should say that the
   second write records, per recipient, P's key for Q = K and starts the
   30-day S1 clock. Both are implied by S1 ("30 days after the second
   write") but are not listed with step 3.
3. **A recipient's `mailbox_unknown` for an earlier mailbox.** §8.6
   "Re-resolve the address, or mark the connection `stale`" has no
   re-resolve for a peer. With rotation on, Q should keep the connection
   and wait for P's update (resend (b)) until S1's 30 days, rather than
   end it at once. *Unsure* whether the vault's §8.6 path would fire here
   for Q's held deposits. To be checked against the code when it is built.

---

## 4. Liveness argument sketch (recommended design: G2-A + G1-A)

The style of §3.4.1 "Liveness between honest vaults (0.88.2)". It extends
that argument, it does not replace it.

*Assumptions.*
- A1 to A4 as in 0.88.2.
- **A5'** (replaces A5): either side may rotate its relay key, always
  with its `ik` (S4), and both advertise `relay_follow`, so the gate is
  open.
- **A6, the grace:** the relay's grace is at least 2`U` plus a margin
  (3.3, point 1).
- **A7:** no definite refusal of a rotate. A refused rotate is the
  refused state, which is visible (`relay: "refused"`) and outside this
  argument.

*Progress measure.* Φ = (π, μ, λ, δ, ρ):
- π: the number of pending relay keys;
- μ: the number of (side, recipient) pairs whose key for the recipient is
  not the side's current relay key;
- λ, δ, ρ: as in 0.88.2.

π and μ never grow after the last rotation `t_r`. A rotation is the only
thing that adds either; S2 only advances, and the 30-day stale is an end,
not a wait.

*Step 0: π reaches 0 within `U` of `t_r`.* Each unlock makes one attempt.
Under A2 the relay answers, and the `200` or `201` path (3.2, C2) ends in
the second write.

*Step 1: λ reaches 0 by `t_r` + 3`U`.* As in 0.88.2. `identity.rotate`
leaves after the first write, before S1 exists. A rekey's or reconnect's
`hs.init` and `hs.resp` carry the links (S8). Under G1-A, S1 no longer
holds a rekey's `hs.init`, so the links reach Q in every case 0.88.2
lists.

*Step 2: μ reaches 0. Every wait names what ends it.*

| Wait | Ended by | Bound | Why it cannot form a cycle |
|---|---|---|---|
| The update reaching Q | S1 lets it through; it is deposited after the earlier deposits' definite answers (§8.6 bounds them); resent at each unlock (b) | `U` after the second write; hard bound S1's 30 days | needs nothing from Q |
| Q following | rule U in the write that processes it; an honest update is refused only for `token_unusable`, and every resend re-mints the token (S3) | one hop | needs nothing from P beyond the update |
| Q's acknowledgment reaching P | (a) `relay.token.issued` when Q has a current epoch (rule U); (b) when Q is demoted or reconnect-pending: Q's next reconnect `hs.init`, or its `hs.resp` to P's reconnect, which carries tokens naming P's key as Q knows it (S3), and those advance S2 (G2-A); (c) Q's confirmation of a pending reconnect, after which (a) holds (§6.3.1 "The prompt to adopt") | one round; hard bound "The reconnect bound" / `B` | never waits on a message P holds: P's handshake messages pass S1 (G1-A, part 1) and Q's cut-off (G1-A, part 2) |
| P's handshake messages to Q during S1 | deposited with P's key for Q, which equals the `sub` of the carried token (G2-A); accepted by Q before the cut-off as today, and after it when authenticated by Q's current `ik` (G1-A) | one hop | the relay's sender check and Table A both pass, so no `signature_invalid` or `superseded_relay` turns a round into an expiry |
| P's other entries held by S1 | S2's advance | the row above | no handshake needs a held message: `hs.confirm`, `hs.init`, `hs.resp`, `hs.fin` and `relay.token.issued` all pass S1 |
| P's entries waiting for an adopted token for K' after a carried-token advance | Q's `relay.token.issued` (prompt or rule U), or adoption at confirmation | one round | P starts no reconnect meanwhile (G2-A, care 1), so no second round begins |
| Q's held messages while demoted or pending | as in 0.88.2 (the next current epoch) | one round | unchanged |
| The old key's deletion | §3.4 "When the old key is deleted" | not a wait between the sides | — |

*Why there is no cycle now.* The cycle needed both:
- P holds a message that would give Q a current epoch, until Q
  acknowledges;
- Q holds its acknowledgment until it has a current epoch.

G2-A makes Q's acknowledgment travel in the handshake messages that a Q
without a current epoch still sends. G1-A makes P's handshake messages
reach Q whatever P's key for Q is. Each side's progress then depends on
messages that the other side does not hold.

*The bound.* By `t_r` + `U` π = 0. By `t_r` + 3`U` λ = 0. Each recipient
then acknowledges within one round, so μ = 0 by about `t_r` + 8`U`. From
there 0.88.2's argument applies unchanged, ending by about `t_r` + 16`U`.
*Unsure*: this should be tightened once the harness gives real
distributions. It is within S1's 30 days only if `U` is smaller than A3
allows. With `U` = 4 days the bound passes 30 days, so a pair at A3's
limit can reach S1's stale before converging. Either S1's 30 days count
from the second write plus the time Q needed (S1 already says "30 days
after the second write"), or this is a residual. The harness will tell how
often.

*What still ends `stale`, visibly.*
- 0.88.2's list;
- S1's 30 days, for a recipient away longer than A3;
- the gate's deadline;
- the C2-and-long-lock case if A6 is not adopted;
- G4 (section 5) if both sides rotate in step and the deferral loses the
  token message.

---

## 5. Other wait cycles with rotation on

**G3: S1's list does not get past the cut-off.** This is found by reading;
*unsure* how much of the ~90 it accounts for.
- S1 lets a reconnect's messages and `hs.confirm` out with K. Once Q has
  followed, anything P deposits with K after the update is "after its
  cut-off", and Table A refuses every handshake message and every session
  message there.
- So 0.88.2's `hs.confirm` fix holds only when the `hs.confirm` reached
  Q's mailbox before the update. Its text says so ("which Q accepts
  before that key's cut-off"). But the case it is meant for, a Q that
  holds `relay.token.issued`, is a Q that has followed. A P `hs.confirm`
  queued after the second write then lands after the cut-off and is
  refused. Q's pending reconnect then waits for `B`.
- The same holds for P's `hs.resp` to a reconnect `hs.init` that Q sent
  before it followed (tokens naming K, so the relay accepts it), when Q
  follows before the `hs.resp` is deposited. The try expires and counts as
  a failed one.
- And for P's own reconnect `hs.init` during S1. Q refuses it after the
  cut-off. It ends only if Q's acknowledgment reaches P by another route.
- The trust model shows the same refusal (its Table A refuses an
  `hs.confirm` from an earlier key after the cut-off).
- Fix: G1-A part 2 (authenticated `hs.resp`/`hs.fin`/`hs.confirm` pass
  the cut-off). P's reconnect `hs.init` stays refused. Its way out is
  Q's acknowledgment (G2-A), or Q's own reconnect, which a refused P
  answers.

**G4: both sides rotate at once.** A possible slow path, not a proven
cycle.
- Q's `relay.token.issued` for P's K' is issued (`iss`) by Q's new
  mailbox, which P does not know yet. Rule T defers it for "at most two of
  the relay's visibility timeouts", then refuses it, and it is lost ("A
  deferred token message that is refused is lost; P's next resend replaces
  it").
- The resend comes only at P's next unlock, at most hourly. Each side's
  S1 then holds the other's ordinary traffic.
- It converges if one update is processed before the other's token. The
  order is the relay's choice, so it should converge, but slowly.
- *Unsure* whether a loop is possible in which each side's token keeps
  arriving before the other's update. The harness should run a mode in
  which both sides rotate inside one hop.

**G5: S2's restart needs a reconnect token for the new key.** Introduced
by G2-A and covered by its care point 2. Without that care, an advance by
a carried token restarts P's open reconnect with no reconnect token whose
`sub` is K'. The reconnect bound then makes the pair `stale` ("no
reconnect token").

**H5 and the reconnect token's quota.**
- Each relay-key rotation is an `ik` rotation, so H5 restarts the
  reconnects. S2 may restart one again with the new key; that restart
  goes on Q's new reconnect token (rule U sends one), so it does not spend
  the old token's 4 deposits.
- Under G2-A without care point 2 it would, which points the same way as
  G5.
- Otherwise rotation adds no deposits on the held reconnect token beyond
  0.88.2's rapid-rotation residual. *Unsure*, and worth a harness counter.

**The gate.** It never waits on the peer: a closed gate rotates the other
keys and owes the relay key until the deadline (30 days), then makes the
connection `stale`, which is visible. No cycle.

**Rule U and H5 themselves.** Rule U abandons no handshake ("No handshake
is abandoned when Q follows a relay link (S2)"), and H5 runs only on `ik`
changes. Apart from G1, G3 and G5, I found no cycle between them.

---

## 6. The harness plan (internal)

**What exists today.**
- **The real code rotates no relay key.** `rotateIdentity` (vault/core.go)
  rotates `ik`, `kem` and the wake key only, and a test pins A5
  (vault/r29_a5_test.go). The `Relay` interface has no rotate call. The
  receiving side `hAddressUpdate` is the pre-0.85 handler: it reads
  `relay` and `token` and replaces the address, with no `links`, no rule
  U or C, and no earlier-key rows in Table A.
- **The R29 random-pair harness** (vault/r29_random_test.go on main) has
  the modes default, `R29RP_BURST`, `R29RP_SHUFFLE`, `R29RP_REFRESH`,
  `R29RP_SPENT` and `R29RP_LOSTANS`. **None of them models relay-key
  rotation.** Its `rotate` action is `credential.rotate`, transfer or
  recovery, all relay-key-free.
- **The ~90 in 10,000 came from the trust model**, not the harness:
  `internal/trustmodel` on vettid-vault branch `r29-oracle` (PR #207),
  config `TRUSTMODEL_RELAYROT=1`. It is abstract: integer keys, signatures
  trusted by construction. Its S1 list is `allowedWhileUnacked`
  (world_test.go). It already carries 0.88.2's `hs.confirm` entry, and its
  Table A refuses an earlier key's `hs.confirm` after the cut-off (G3).

**Steps.**
1. **Attribute the ~90 in the trust model first** (cheap). Classify each
   `stale` run by mechanism: G1, G2, G3, G4, other. Then add G2-A (an S2
   trigger on carried tokens, with care points 1 and 2) and G1-A (S1 list;
   the Table A cell for authenticated `hs.resp`/`hs.fin`/`hs.confirm`),
   each behind its own env switch so that each can be attributed alone.
   Run `TRUSTMODEL_RELAYROT=1` with and without `TRUSTMODEL_ROTBURST` at
   10,000 runs, then the owner's earlier 100,000 bar for the deadlock
   search. Also run the I3 old-copy actor: G1-A must not let it through.
   Prove each new check can fire by turning the fix off: the G1 and G2
   seeds must come back.
2. **Real code on a branch, not merged.** "Search the design on the real
   code" needs the rotating side to exist. Build it on a branch behind the
   gate:
   - the relay rotate call;
   - the pending key, the two writes and the retry;
   - S1 to S3, S7 and S9, rule U with links, rule T, Table A's earlier
     rows, the gate;
   - G2-A and G1-A.

   The harness relay stub needs a rotate (idempotent with the same key),
   the grace with two-mailbox collect, the tombstone, `mailbox_unknown`
   after the grace, and the step-7 sender check (`X-VettID-Key` == `sub`).
   Without that check G2 cannot show.
3. **A new harness mode `R29RP_RELAYROT`.** The `rotate` action rotates
   the relay key in all three paths, and these are added:
   - crash points C1 and C2 (3.2) as `crash` placements;
   - locks around the grace (shorter and longer than it);
   - a both-sides-in-one-hop rotation (G4);
   - the refused state (a definite refusal fault on the rotate).

   New oracles:
   - I1 extended (each side's relay key for the other is current and μ =
     0 at quiescence; no S1-held entry);
   - I2 (token form);
   - I5 (nothing announced before the second write; a C2 crash loses no
     outbox entry);
   - an I3-lite (nothing from an earlier key after the cut-off is
     accepted unless G1-A's authentication holds);
   - a counter of S2 advances by carried token versus by
     `relay.token.issued`;
   - reconnect-token deposits per rotation (H5).
4. **The bar.** 0 `stale`, diverged or suspended honest runs outside
   residuals the owner has accepted, at **10,000 runs per mode**. That
   means `R29RP_RELAYROT` combined with each existing mode (default,
   BURST, SHUFFLE, REFRESH, SPENT, LOSTANS), plus the existing modes
   without it, to show no regression.
   - Counted from `go test -v` output: the class table's `diverged:` and
     non-`converged` lines, and each mode's counters. Use `-test.v` for a
     prebuilt binary.
   - **A PASS exit status is not enough**: the harness exits PASS even
     when runs diverge.
   - Every new oracle is first shown to fire (a known-bad seed, or the fix
     turned off).
5. **Residuals likely to need the owner's acceptance.**
   - A C2 crash and then a lock past the grace (if A6 is not adopted).
   - A recipient away beyond S1's 30 days (already the design; it is
     visible as `stale`).
   - G4's slow path if any run fails on it.
   - The rapid-rotation residual's rate under rotation, re-measured.
   - "A copy using an epoch Q abandoned while pending" and the other
     old-copy residuals, re-checked with earlier relay keys in play.
   - A false S2 advance by an old copy of Q (G2-A security note), as an
     old-copy residual.

---

## 7. Open questions for the owner

Each choice label is 24 characters or fewer.

**7.1 How P learns that Q followed (G2).**
- a = `token is enough (G2-A)`: any verified token from Q naming P's newer
  key advances S2, the handshake's carried tokens included. It replaces
  0.85.0's "Nothing else counts".
- b = `key from token (G2-B)`: keep the signal; only messages on a carried
  token go with the key its `sub` names.
- not yet.

Recommendation: **a**. It is exactly as strong as `relay.token.issued`,
and it is the only option that lets a demoted or pending Q acknowledge
at all.

**7.2 Handshake messages past the cut-off (G1, G3).**
- a = `pass if signed by ik`: S1 lets a rekey's messages out; Table A
  passes an earlier key's `hs.resp`, `hs.fin` and `hs.confirm` after the
  cut-off when authenticated by Q's current `ik` (G1-A). I3 is reworded.
- b = `drop rekey answers (G1-C)`: a demoted Q drops its rekey answers
  and reconnects. Slower; touches a release-29 rule; leaves G3.
- not yet.

Recommendation: **a**. It closes G1 and G3, and its safety rests on S4
(a relay-key rotation always rotates the `ik`).

**7.3 The relay's grace against a crash between rotate and second write.**
- a = `grace at least 14 days`: the relays' rotation grace is at least `T`
  for vault mailboxes. A relay setting that every member's rotation
  depends on.
- b = `accept as a residual`: a C2 crash followed by a lock long enough to
  pass the grace may lose deposits and end `stale`. Visible.
- not yet.

Recommendation: **a** if the relay operator agrees, else **b**. Ask
together with the relays' real grace setting (*unsure*).

**7.4 How to meet "search on the real code".**
- a = `model, then code branch`: attribute and fix in the trust model,
  then build the rotating side on an unmerged branch and run the new
  `R29RP_RELAYROT` mode to 0, then merge.
- b = `code branch only`: skip the model.
- not yet.

Recommendation: **a**. The model gives attribution in hours. The real code
has no rotating side yet, so the harness search needs the code built
first in any case.

**7.5 0.88.2's `hs.confirm` sentence (G3).** It is right only before the
cut-off.
- a = `fix in the redesign PR`: no erratum now, since release 29 builds no
  rotation (A5).
- b = `erratum now`.

Recommendation: **a**.
