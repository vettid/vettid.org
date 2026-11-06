# Release 29: the rule list (draft 2, 2026-11-06)

Step 2 of the cleanup plan (GC plan 01M6R42066TVG74QBM1C619K5Q, approved by
the owner 2026-11-06). Scope: the owner's decision **a** (GC
01M6QDM66N6F7BD94ZEP5H930Y, 10:03Z): release 29 is specified, modelled and
tested **between two vaults that both advertise `hs_confirm`** (and a vault
and its devices). Toward a peer without it, a release-29 vault keeps the
release-28 path; mixed pairs are not a design goal. S13 is the owner's
decision **a** (GC 01M6QB8A3P0S7H2Q86QS3EAV2P).

Approval order (the lead, GC 01M6R4R897Y14D7NF3MESHJHQV): an Opus review of this
list against the model (done for draft 1: 2 High, 7 Medium, fixed here; see
"Review log" at the end), the lead's independent check, then the owner's go.
**No spec text and no code until the owner's go.**

Sources: spec VAULT-MESSAGING 0.86.6 (vettid.org #548 at 8ee7dc2); model
vettid-vault #205 at ad36a6f (`internal/trustmodel`); code vettid-vault #206 at
e19f99c. IDs here are **new** (`R29-…`): the code's S-numbers collide (§3.4.1
S1–S9 vs the 0.86.6 review's S1–S13), and the model's "F3" means rule E's
reconnect, so none is reused.

Columns: **Spec** = where 0.87.0 states it (0.86.6 section today). **Model** =
the model rule (M = `internal/trustmodel/`). **Code** = #206 (V = vettid-vault).
**Test** = the test that must fail without the rule; *gap* = none yet.
**Change** marks where this list changes 0.86.6 or #206.

---

## 1. The gate

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-G1 | A release-29 vault advertises `hs_confirm` in `features` to every connection and in the inner `features` of every message it deposits, and in its §11.10.9 list; a device sends it in `device.features` and in every message's inner `features`. | §6.3.1 Deployment, §10.8 | `PeerA`, `seeFeatures` M/upgrade_test.go:37 | V/vault/features086.go:27, :40-139 | V/vms/envelope/features_test.go:12 |
| R29-G2 | **Receiving features.** A side counts a peer's `features` from any message that passes acceptFrom steps 1–4, even one in a handshake later abandoned; names are only ever added (sticky); unknown names are ignored; a malformed `device.features` is dropped (`drop.features_malformed`). | §10.8, §10.2 | `seeFeatures` M/upgrade_test.go:37 | V/vault/features086.go:96-117; V/vault/inbound.go:433 | *gap*: sticky against a later list without it |
| R29-G3 | **Per-handshake gate (Change).** The initiator runs the pending half (§2) only if it has seen the peer's `hs_confirm` when it sends `hs.init`, and then marks that `hs.init` with `confirm: true` inside the signed body. The responder runs the responder half (§3) **if and only if** the `hs.init` carries the marker. Without it both sides take the release-28 path: activation at `hs.fin`, no `hs.confirm`, no confirmed-epoch move, no rule E. So both sides always agree for each handshake. The marker goes only to a peer that advertised `hs_confirm`, so it never reaches a release-28 parser. | §6.3.1 Deployment (replaces "toward every peer it applies the responder half") | `initHalf` M/confirm_test.go:60 (both-29 config `TRUSTMODEL_OPT=1`, no MIXED/ALL28/UPGRADE/UNSEEN); *gap*: the marker | `gateFor` V/vault/confirm.go:210; fixed at V/vault/handshakes.go:1323, :1396; responder side to change: handshakes.go:456, :655, :789, `responderEstablish`, `queueConfirm`, `setConfirmed` in `beforeAccept`, `classifyCtx086` | *gap*: both orders of seeing features; the 28 path toward a peer without `hs_confirm` |

An epoch activated on the 28 path is current at both sides on activation, but
it was **not confirmed** (§6, F2 depends on this). It does not move R's
confirmed epoch (R2 counts it only once a message other than `hs.fin`
arrives under it).

## 2. The initiator: activation on confirmation

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-L1 | **Lifetimes.** Initiator's handshake awaiting `hs.resp`: 16 days (7 after a restore). Responder's answer awaiting `hs.fin` (`L`): 16 days from its `hs.resp`. Pending epoch (`B`): 32 days from `hs.fin`, judged after the first short collect after an unlock. Responder's confirmed epoch while not current: keys up to 48 days from the activation that superseded it and 16 days once it stops being confirmed; its id until it stops being confirmed or the connection ends. | §6.3.1 Lifetimes | M/confirm_test.go:15-19; M/state_test.go:77, :149 | V/vault/confirm.go:34-37 | r29_f_test.go:210, :229 |
| R29-I1 | After sending `hs.fin`, the initiator's new epoch is **pending**: established (signer recorded) but not current. It keeps sending in the current epoch and opens messages under both. | §6.3.1 Initiator | `makePending` M/confirm_test.go:84 | `makePending` V/vault/confirm.go:215; keyring V/vms/handshake/epoch.go:298-334 | r29_scenarios_test.go:281; keyring086_test.go:14 |
| R29-I2 | Any message from R **other than `hs.fin`** that opens under the pending epoch's `r2i` key and passes acceptFrom steps 1–4 **confirms** it, before dedupe, the `ts` window, step 5 or the handler. In that write the epoch becomes current and the outbox continues in it (entries already sealed under the old epoch are deposited as they are). An abandoned epoch never confirms. | §6.3.1 Initiator | `beforeAccept` M/confirm_test.go:199 (`steps14` :154; hs.fin out :214) | `beforeAccept` V/vault/confirm.go:411 (hs.fin out :454); `confirmPending` :236 | r29_f_test.go:40, :60, :83; r29_review_test.go:17 |
| R29-I3 | While a **reconnect** is pending, the initiator sends nothing but the handshake (no `hs.confirm` either); its outbox waits. | §6.3.1 Initiator | M/world_test.go:579 (*differs*: lets `hs.confirm` out) | V/vault/outbox.go:259; `pendingReconnectHold` V/vault/confirm.go:627 | *gap* |
| R29-I4 | A side starts no rekey with a peer while its own epoch is pending or one of its answers awaits `hs.fin`. | §6.5, §6.3.1 | M/rotate_test.go:182 | `rekeyBlocked` V/vault/confirm.go:537 | r29_scenarios_test.go:388 |
| R29-I5 | **At `B`** the initiator abandons the pending epoch and reconnects naming its current epoch (a device: rekeys, D1). | §6.3.1 Initiator | `tickA` M/confirm_test.go:313 | `tickPending` V/vault/confirm.go:310 | r29_scenarios_test.go:334; r29_f_test.go:210, :229 |
| R29-I6 | With no valid standing token, or on `token_expired` once the token's `exp` has passed on its own clock, the initiator abandons a pending **rekey** epoch and reconnects. A pending **reconnect** with no valid token left is not abandoned (another reconnect could not be deposited either); it ends at `B`. | §6.3.1 Initiator (Change: the reconnect exception, as #206 builds it) | M/world_test.go:685 (*differs*: any `token_expired`) | V/vault/outbox.go:371-384; V/vault/handshakes.go:1358-1369 | r29_f_test.go:123 |
| R29-I7 | **Every abandon** of a pending epoch: at `B`, by I6, by H5/S5 (K2), at a crossing (X1), by a link (K2), when R activates the peer's handshake (R1), and when the side starts a reconnect (a reconnect names the current epoch, never a pending one). In the same write it revokes the tokens its `hs.init` carried (and an abort always revokes them, §6.3). Except after a link, the abandoned epoch's receive keys are kept 16 days and authenticated messages under it are processed **without confirming it**; after a link it is demoted from the start (`ancestor_ik`). A reconnect's abandoned epoch is followed by a fresh reconnect, not a rekey. | §6.3.1 Initiator, §6.3 | M/accept_test.go:1049 (own handshakes only) | V/vault/confirm.go:268-285; `revokeIssued` V/vault/tokens.go:252; V/vault/handshakes.go:1366 | r29_f_test.go:306; r29_review_test.go:172; r29_rr2_test.go:215 |

## 3. The responder

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-R1 | For a marked handshake (G3), R activates at a verified `hs.fin` within `L`; in the same write it queues `hs.confirm` (`{}`, session mode under the new epoch, durable, never answered) and abandons its own pending epoch with I. An `hs.confirm` that confirms nothing is acked and ignored without audit. | §6.3.1 Responder | `tableBFin` M/accept_test.go:978 | `responderEstablish` V/vault/handshakes.go:771; `queueConfirm` V/vault/confirm.go:320; V/vault/inbound.go:437-439 | *gap* (r29_f_test.go:170 tests R3's cap) |
| R29-R2 | R's **confirmed epoch** is the newest epoch, in activation order, in which R received from I a message other than `hs.fin`, or that R activated itself at confirmation. It never moves back. | §6.3.1 Responder | `setConf` M/confirm_test.go:116; `beforeAccept` :220 | `setConfirmed` V/vault/confirm.go:166 | r29_scenarios_test.go:281 |
| R29-R3 | While the confirmed epoch is not current, R keeps its receive keys and `rk` (L1), accepts I's messages under it, and re-queues `hs.confirm` for a collected batch holding one, unless one is still in its outbox. | §6.3.1 Responder | `reconfirm` M/confirm_test.go:290 | `reconfirmAll` V/vault/confirm.go:344; `responderActivation` :395 | r29_f_test.go:170 |
| R29-R4 | A rekey or reconnect naming R's confirmed epoch is accepted as if current (a reconnect also after its keys are gone), after the fork checks of F1; R abandons its own open rekey for it. | §6.3.1 Responder, §6.6 | M/accept_test.go:724-755 | `classifyCtx086` V/vault/confirm.go:590; V/vault/handshakes.go:553, :606 | r29_f_test.go:252; r29_scenarios_test.go:436 |
| R29-R5 | **Rule E.** In the write that establishes a marked handshake's epoch, R destroys every other epoch with I later than the confirmed one (send key and `rk` erased; receive key kept 16 days only to read the inner `ts`), records the accepted `hs.init`'s inner `ts`, and drops any unsent `hs.fin` for them with its outbox entry. | §6.3.1 rule E | `ruleE` M/confirm_test.go:265 | `ruleE` V/vault/confirm.go:360 | r29_round6_test.go:141; r29_f_test.go:252 |
| R29-R6 | An authenticated message under a destroyed epoch with a later inner `ts` than the recorded one is **fork evidence** (suspend, `ref` = `epoch`, the neutral feed item); with an earlier one it is refused (`superseded_epoch`). Its links are checked by rule C first (K8). | §6.3.1 rule E, §3.4.1 acceptFrom | M/accept_test.go:203-224 (gated branch) | `destroyedEpochMessage` V/vault/confirm.go:474 | r29_scenarios_test.go:744 (gated iteration); r29_oldcopy_test.go:266 |

## 4. Reconnect `ctx`, crossings and timing

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-X1 | I, holding a pending epoch, drops a rekey `hs.init` from R under the current epoch whose inner `ts` is not later than the `hs.resp` it processed; a later one shows R's answer ended without `hs.fin`: I abandons the pending epoch and answers it. | §6.3.1 Crossing | M/accept_test.go:770 | V/vault/handshakes.go:572 | r29_scenarios_test.go:402 |
| R29-X2 | For any two crossing handshakes, whatever their purposes, a verified `hs.fin` comes first (it abandons the side's own open handshake); otherwise the lower `th1` completes at the peer's `hs.resp`. A crossing handshake a side cannot answer is acked and dropped. | §6.5, §6.6 | M/accept_test.go:785, :990 | `crossingRekeyLoses` V/vault/confirm.go:548; V/vault/handshakes.go:804 | r29_scenarios_test.go:670; r29_round6_test.go:514 |
| R29-X3 | **Rule J.** An answer to a rekey that R cannot deposit (no standing token valid by its own clock) is destroyed at once; neither the rekey block nor §6.6 holds R back from reconnecting. | §6.3.1 Lifetimes | M/world_test.go:623; M/rotate_test.go:293 | V/vault/handshakes.go:582 | r29_scenarios_test.go:364 |
| R29-X4 | One reconnect at a time per peer, whatever the trigger. | §6.6 | *not modelled* | `startReconnectCtx` V/vault/handshakes.go:1349 | *gap* (r29_rr2_test.go:104 covers the demotion trigger only) |
| R29-X5 | **Which `ctx` a reconnect may name.** The initiator names its current epoch, except: after a demotion, K5's epoch; in F2's rekey case, the rekey's named epoch. The responder accepts its current epoch, its own pending epoch, its confirmed epoch (R4), and an epoch it abandoned while pending until a newer one is confirmed (I-side, §6.3.1); while its own reconnect is pending it accepts only that pending epoch; a side that has sent `hs.fin` for its own reconnect refuses its earlier epoch. Any other `ctx` is refused. A pending or destroyed epoch never enters a service connection's reconnect history. | §6.6 | M/accept_test.go:724-736 | `classifyCtx086` V/vault/confirm.go:590-623 | r29_f_test.go:252 |
| R29-X6 | A sealed-mode `hs.init` with purpose rekey is refused as malformed. | §6.2 (0.86.5) | — | (check) | *gap* |

## 5. Identity-key links (the second live bug, and demotion)

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-K1 | **S8, the whole chain.** `identity.rotate` and every rekey's `hs.init` and `hs.resp` carry in `rotations` all of P's links from the signer of the epoch they travel in (or rekey) to P's current `ik`, not only the newest. This fixes the second live bug (a lost `identity.rotate` → rekeys refused for good). Toward a peer that has advertised **no `features` at all** (release 28 or earlier) a rekey carries none, as release 28 parses (the 28 path; `identity.rotate` still carries its links). | §3.4.1 S8 | M/world_test.go:642; M/rotate_test.go:204 | `identityRotateBody`, `rotateLinks` V/vault/iklinks.go:696, :51; V/vault/handshakes.go:635, :1312, :1370 (keyed on `advertisedFeatures()`) | r29_scenarios_test.go:535; r29_review_test.go:255; keyring086_test.go:97; V/client/rotate086_test.go:18 |
| R29-K2 | **H5 / S5 with pending epochs.** A change of the current `ik` (by any message, or a suspension) abandons every own handshake and pending epoch pinned to a superseded `ik`; following a link abandons a pending epoch whose `sig_R` the link's `old_ik` made, unless the message carrying the link traveled under it. At its own rotation P abandons its rekeys, reconnects and pending epochs and **drops** its answers awaiting `hs.fin` to peers whose `hs.init` was marked (revoking their tokens); a later `hs.fin` for one is acked and dropped. | §3.4.1 H5, S5 | M/accept_test.go:1021; M/rotate_test.go:53-78 | `h5` V/vault/iklinks.go:514; `s5` :722, the drop **:737-743 stays** | r29_f_test.go:60; r29_round6_test.go:454; r29_scenarios_test.go:619 |
| R29-K3 | **S5 resend.** P sends `identity.rotate` again (with K1's links) on a session message from Q under an epoch whose P-side signer is an ancestor, inner `ts` > 1 h after P's first `identity.rotate` to Q; at most 3 times per peer per rotation, once per hour. | §3.4.1 S5 Resend | `idResend` M/confirm_test.go:353 | `idResend` V/vault/iklinks.go:752 | *gap* (model only: M/confirm_scenarios_test.go:167) |
| R29-K4 | **Demotion by position.** Following a link at position x demotes an epoch of P signed by that link's `old_ik` or an ancestor and established by a message deposited after x (for Q as initiator, the `hs.resp`). It audits `connection.fork_suspected` `ref` = `epoch` (no feed item, no suspension). Messages under it deposited after x are refused (`ancestor_ik`). | §3.4.1 Epochs after an `ik` link | `followIK` M/accept_test.go:633 (no audit) | V/vault/iklinks.go:223-247 | r29_oldcopy_test.go:205; r29_round6_test.go:546 |
| R29-K5 | **After a demotion of the current epoch**: Q sends only handshake messages (no `hs.confirm`); durable messages are **held**, per peer, unsealed, and sealed with a new `ts` under the next current epoch; entries sealed but undeposited go back to held; expired held ones are discarded (`drop.held_expired`); ephemeral ones are not sent; held ones end when the connection goes `stale`, is removed or replaced (*to settle*: whether that is audited; 0.86.6 does not say). Q reconnects naming the newest epoch that has been current and is neither demoted nor destroyed (none: `stale`). An `ancestor_ik` refusal under an epoch demoted by F2 writes no History line. | §3.4.1 Epochs after an `ik` link | *differs*: the model **rekeys** (M/accept_test.go:646) and blocks `hs.fin` while demoted (M/world_test.go:594) | `holdDemoted`…`sealHeld` V/vault/iklinks.go:306-413; `restartAfterDemotion` :463; V/vault/confirm.go:499-503 | r29_oldcopy_test.go:431, :515, :534; r29_review_test.go:65; r29_round6_test.go:161, :195 |
| R29-K6 | The demotion reconnect fails only when its handshake expires or at `B` (tokens revoked); a refusal is silent and not counted. The third failure for the same demoted epoch, a relay `quota_exceeded` for its `hs.init`, or **no reconnect token left** (Change: in #206, not in 0.86.6) makes the connection `stale` with `connection.stale` and its feed item. | §3.4.1 The reconnect after a demotion | *not modelled* | V/vault/iklinks.go:415-475 (comment :415-423 is stale), :446-449; V/vault/outbox.go:403-423 | r29_oldcopy_test.go:724, :778, :803; r29_rr2_test.go:135; r29_round6_test.go:563 |
| R29-K7 | **Strict F1.** A link carried under an epoch E of P, while Q's current epoch is later than E and signed by the link's `old_ik`, shows that P never activated the later epoch: Q demotes it and reconnects naming E, which P accepts as its last. | §3.4.1 Epochs after an `ik` link | `f1Demote` M/accept_test.go:1199 (keep branch :1206-1226 goes) | `f1Demote` V/vault/iklinks.go:260 | r29_oldcopy_test.go:153, :234; *gap*: a both-29 TestR29F1StrictDemotion (today emu28) |
| R29-K8 | **Rule C with seen links.** Every valid link that passes step 3 is kept as seen (followed or not; a rekey's only once it would be accepted), at most one per old key and 32 per peer; a second successor suspends. A message under a demoted or destroyed epoch has its links checked first. | §3.4.1 Rule C, acceptFrom | M/accept_test.go:313 | `rotationConflictRec` V/vault/rotateconflict.go:42; `evidenceFirst` V/vault/iklinks.go:160 | r29_review_test.go:223; r29_round6_test.go:302; r29_oldcopy_test.go:296 |

## 6. Old copies

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-F1 | **Fork by `ctx`.** For a rekey or reconnect from P under the new `ik`, a `ctx` naming an epoch older than Q's confirmed epoch, where an epoch after it up to the confirmed one has as P-side signer an ancestor of the `ik` the message reaches, is fork evidence: Q suspends (`ref` = `epoch`, the neutral feed item "<name> or your vault may be running from an old copy. The connection is paused…"). | §3.4.1 Epochs after an `ik` link | `forkEpoch` M/accept_test.go:653 | `forkEpoch` V/vault/iklinks.go:555 | r29_oldcopy_test.go:153, :296 |
| R29-F2 | **Fix A, `own_copy`, narrowed.** F1 does not suspend only when every such epoch is one Q began **and none of them has its received flag set (F3)**: then P can only have missed it (an epoch on the 28 path whose `hs.fin` was lost). Q demotes them, takes the `ctx` as its last epoch, audits `connection.fork_suspected` `ref` = `own_copy` with the History line and no feed item. A reconnect: Q answers as if the `ctx` were its last and demotes only at the verified `hs.fin`. A rekey: Q never answers; it demotes, takes the named epoch as its last by id, and reconnects naming it; the rekey `hs.init` is acked and dropped. | §3.4.1 Except…, When the exception applies | fix A M/accept_test.go:681; `acceptOwnCopy` :1251 (*differs*: answers a rekey :760-767; demotes a reconnect at `hs.init` :743) | `acceptOwnCopy` V/vault/iklinks.go:579; `rekeyOtherEpoch` :624 | r29_oldcopy_test.go:665; r29_rr2_test.go:38, :166 |
| R29-F3 | **S13, owner decision a.** Q keeps one "received from peer" flag per epoch, set by **any** message from P that opens under it and passes acceptFrom steps 1–4, `hs.confirm` and handshake messages included (Change: #206 skips `hs.*`, the model sets it before steps 1–4). If F2's check finds a flag set, F2 does not apply: Q takes F1's outcome, suspension and the fork feed item included. | §3.4.1 (new text) | `GotFromPeer` M/accept_test.go:60-62 (*to change*) | `GotFromPeer` V/vault/confirm.go:428 (*to change*); `OwnCopyGotFromPeerSuspends` V/vault/iklinks.go:591, :684 | r29_round6_test.go:643; r29_oldcopy_test.go:296; *gap*: an old copy that confirmed Q's epoch with `hs.confirm` only, then reconnects (M/blind_test.go:256 TestLeadFixAOwnCopyCannotHideFork as the scenario) |

**Why F2 and F3 changed (review H1).** Between two marked peers, every epoch
Q began that became current was confirmed by a message under it (I2). An
honest P therefore always sent something under it, so F2's premise ("P never
activated it") is false for every confirmed epoch. With #206's flag, which
skips `hs.*`, an old copy that confirmed Q's epoch with `hs.confirm` alone
and then reconnected under a forked `ik` would be taken as `own_copy`: the
original's messages refused with no History line, and Q talking to the copy.
Counting `hs.confirm` in the flag is what decision a says ("record whether
anything was received from the peer under each epoch"), so this needs no new
decision; F2 is left only for epochs activated on the 28 path.

## 7. Devices and agents

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-D1 | Toward its device or agent the vault is always the initiator: the reference client starts no rekey. Where a connection would reconnect (I5, I6, K5), the vault rekeys from its current epoch, also at `B` with no valid token. A vault never demotes an epoch with a device (devices rotate no `ik`). The vault's responder-half paths toward a device (rule E's device branch, V/vault/confirm.go:479-482) are unreachable and are removed. | §6.3.1 Initiator, §3.4.1, §6.7 | M/confirm_test.go:142; M/rotate_test.go:182, :253, :377 (*differs*: at `B` with no token the model marks the device `stale`, M/confirm_test.go:146) | V/vault/confirm.go:299; V/vault/outbox.go:374; V/vault/iklinks.go:297, :463 | *gap* on the vault side |
| R29-D2 | The device (reference client) runs **only the responder half** toward its vault: `hs.confirm`, the confirmed epoch, re-sending `hs.confirm` at most once a minute (Change: the spec says per collected batch). It applies neither rule E nor Table B's demotion (§15 item 51, deferred past 29). | §6.3.1, §15 item 51 | *differs*: devices run the full rules and start rekeys | V/client/confirm.go:13-112 (:22-25, :31-33); V/client/client.go:258-262, :1595 | V/client/rotate086_test.go:18, :71; V/client/persist_test.go:517 |

## 8. Dropped by decision a

Removed from the spec (0.87.0), the model and #206:

| What | Spec 0.86.6 | Model | Code (#206) |
|---|---|---|---|
| Revert keep: copies, the 256 / 1 MiB / 8 MiB caps, 64 KiB claim-check while keeping, revert, `connection.epoch_reverted`, its History line | §6.3.1 Deployment (from "Toward a peer without the gate…") | `revertRule`/`revert` M/confirm_test.go:73-80, :204-263; `RevOld`/`RevSent` | V/vault/ungated.go:12-320 and hooks; keyring `KeepSend`/`Reinstate` V/vms/handshake/epoch.go:274, :355. **Move first** the shared `reconnectNaming` (ungated.go:326) and `markStale` (:391). |
| Ungated `HoldFor` (0.86.6 S4) | §3.4.1 "Toward a peer without the gate the reconnect gets no revert keep…" | — | V/vault/handshakes.go:1232-1245; V/vault/confirm.go:432-445; V/vault/iklinks.go:374 |
| `EpochMeta.Unconfirmed` (written, never read) | — | — | V/vault/state.go:368 and writers |
| Rule E's reconnect toward a peer without `hs_confirm` (3 tries, then `stale`) | §6.3.1 rule E (0.86.0) paragraph | M/ungated_test.go | V/vault/confirm.go:489-492 |
| Rule L and its retries | §3.4.1 Rule L | M/ungated_test.go | V/vault/iklinks.go:788-809 and hooks; `RuleLState`; `RuleRC`/`ruleRCExpired` V/vault/ungated.go:363. **Keep** the shared reconnect and quota paths used by K5–K7 and F2 (V/vault/handshakes.go:614-623; V/vault/outbox.go:403-416, incl. :408's `RuleRC` check). |
| S5's immediate rekey after keeping an answer toward an ungated peer | §3.4.1 S5 "To any other peer…" (keeping the answer is the 28 path) | — | V/vault/handshakes.go:808-812 only. The gated drop at V/vault/iklinks.go:737-743 **stays** (K2). |
| Strict F1's keep branch | — | M/accept_test.go:1206-1226 | the keep hooks in `f1Demote` |
| O3a: `stale` on an ancestor `hs.fin` from a peer without `features`, and the kept `k_i2r` record | §3.4.1 O3a; Table B ancestor/`hs.fin` cell rewritten | not modelled | V/vault/o3a.go; V/vms/handshake/snapshot.go:462-490 (Q2). Such an `hs.fin` is then acked and audited `unknown_kid` (V/vault/inbound.go:340-344). H5's fork-evidence exempt answer is separate and **stays**. |
| The vault's responder half toward devices | — | — | V/vault/confirm.go:479-482 (D1) |
| The `emu28` stand-in and every emu28 test; the CI step | — | `Rel28`, M/r28_test.go, the upgrade/mixed modes and switches | V/vault/emu28*.go and its branches; ci.yml:36-37 |
| Mixed-pair model invariants: I1-loss/revert, I1-false-revert | — | M/run_test.go:750; M/confirm_test.go:234 | — |

## 9. The model as oracle (step 4)

1. **Configs.** The pass/fail oracle runs the both-29 rules with relay-key
   rotation **off** (release 29 builds none and does not advertise
   `relay_follow`; Table A reduces to current/foreign). A second regression
   config keeps relay rotation on. A third starts with `features` **unseen**,
   so G2/G3 are exercised, with an invariant that both sides of every
   handshake agree on the gate.
2. **Divergences to fix:** K5 (reconnect, not rekey; let its `hs.fin` out
   while demoted); I3 (hold `hs.confirm` while a reconnect is pending); I6
   (own-clock `exp`; the reconnect exception); F2 (never answer a rekey;
   demote a reconnect only at its verified `hs.fin`); F3 (the flag after
   steps 1–4, `hs.confirm` included); D1 (rekey at `B`, not `stale`); D2
   (the device runs only the responder half, without rule E or demotion, and
   starts no rekey).
3. **Not modelled yet:** X4, X6, K6, the K4 audit, G3's marker, the held queue
   as explicit state (K5).
4. **Reach.** In 13,000 both-29 runs of today's model, demotion by position
   and rule E's fork evidence each fired about once, and F1-by-rekey,
   `own_copy` and the ancestor `hs.fin` never. So: add action generators for
   an old copy that answers or confirms a handshake and for `hs.fin` loss
   around a rotation; CI requires a minimum hit count for every R29 rule.
5. **Invariants, added:** after an `ik` rotation, a rekey under the new `ik`
   completes (catches the weak "same epoch" test, finding H1 of the code
   review); every split, and every pair the old-copy actor touched, ends
   **visibly** or is a residual listed in §11.
6. **Code conformance (step 5):** every *gap* above gets a test on the real
   code; the model-driven runs on the real vaults check the same invariants.

## 10. What counts as High (agreed before step 6)

A finding is High if, between two release-29 vaults (or a vault and its
device), it shows: a fork or split that does not end **visibly** (suspended,
`stale`, or a feed item; a History line or an audit entry alone is not
visible); a way around a key, a link check, the lock or an erase; data loss
(an outbox entry or a received message lost without a recorded reason); or a
violation of I1–I5 or of §9's new invariants. ("A mixed pair worse than 28"
is gone with decision a.)

## 11. Residuals (accepted, listed in 0.87.0)

- **The upgrade window.** Until a vault has seen its peer's `hs_confirm`, its
  handshakes are unmarked and take the 28 path at both sides (G3), with
  release 28's lost-`hs.fin` split; F2 covers what follows. Every deposited
  message carries `features`, so the window ends at the first message. Test
  vaults upgrade together; a broken test connection is re-invited.
- An old copy that collects P's live mailbox can confirm Q's pending epoch as
  P until a link arrives (§3.4.1 Residual, unchanged); F3 then suspends at the
  fork instead of taking it as `own_copy`.
- The §3.4.1 Residuals list, unchanged.

## 12. Questions for the lead (then the owner)

- **Q1 (G3):** the per-handshake marker in `hs.init`, so the responder half
  runs only for marked handshakes? Recommended: yes. Both sides then agree on
  every handshake, and nothing new runs toward a release-28 vault.
- **Q2 (O3a):** drop the kept record too, so such an `hs.fin` is acked and
  audited `unknown_kid`? Recommended: yes. Between gated peers its only
  effect is one audit kind, and its lifetime took three errata.
- **Q3 (F3):** decision a means F1's outcome, suspension included (the feed
  wording says "paused")? Recommended: yes, as #206 builds it.
- **Q4 (§9.1):** release 29 builds no relay-key rotation: oracle with it
  off, regression with it on? Recommended: yes.
- **Q5 (D2):** `hs.confirm` re-sent at most once a minute from a device
  (as built) rather than per batch? Recommended: yes, written into the spec.
- **Q6 (K6, I6):** write #206's two extra behaviours into the spec (`stale` at
  once with no reconnect token left; a pending reconnect with no token is not
  abandoned)? Recommended: yes.

## Review log

- **Draft 1, Opus review** (2026-11-06; ran the model's both-29 config: 3,000
  + 10,000 + 10,000 runs, 0 violations): 2 High, 7 Medium, Lows.
  H1 (`own_copy` hides a fork between gated peers) → F2/F3 narrowed, flag
  counts `hs.confirm`. H2 (§8 cited the gated S5 drop for removal) → row
  fixed, :737-743 stays. M1 (gate disagreement) → G3 marker. M2 (devices) →
  D1/D2 rewritten. M3 (F2 model divergences) → §9.2. M4 (model reach) →
  §9.1, §9.4, §10 "visibly". M5 (missing rules) → G2, L1, I7, R1, R4, X5,
  X6, K5, K6. M6 (K1 vs §8) → K1 states the 28 path. M7 → I2. Lows: citations
  fixed, shared helpers flagged, "F3" name clash avoided.
