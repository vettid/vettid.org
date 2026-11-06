# Release 29: the rule list (draft 3, 2026-11-06)

Step 2 of the cleanup plan (GC plan 01M6R42066TVG74QBM1C619K5Q, approved by
the owner 2026-11-06). Scope: the owner's decision **a** (GC
01M6QDM66N6F7BD94ZEP5H930Y, 10:03Z): release 29 is specified, modelled and
tested **between release-29 vaults**, and between a vault and its devices.
There is no special path toward a vault on an earlier release: our test vaults
upgrade together, and a connection that breaks in the upgrade is re-invited.
S13 is the owner's decision **a** (GC 01M6QB8A3P0S7H2Q86QS3EAV2P).

**Change from draft 2 (the lead's H2, "within decision a"):** draft 2 kept a
per-handshake gate and the release-28 path behind it. The lead showed that
this brings back live bug 1, silently, between two release-29 vaults during
the upgrade (the first handshake of every existing connection would be
unmarked). Draft 3 drops the gate between vaults: both halves always run.
`hs_confirm` is still advertised (G1), so a later release can tell.

Approval order (the lead, GC 01M6R4R897Y14D7NF3MESHJHQV): an Opus review of this
list against the model (done for draft 1), the lead's independent check (done
for draft 2: "go after fixes"; draft 3 makes those fixes), then the owner's
go. **No spec text and no code until the owner's go.** See the review log at
the end.

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

## 1. Capabilities and the upgrade

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-G1 | A release-29 vault advertises `hs_confirm` in `features` to every connection, in the inner `features` of every message it deposits, and in its §11.10.9 list; a device sends it in `device.features` and in every message's inner `features`. It is advertised only; **no rule below depends on seeing it** (Change: 0.86.6 gates the initiator half on it). | §6.3.1 Deployment, §10.8 | `PeerA` M/state_test.go:142 (always true in the both-29 config) | V/vault/features086.go:27, :40-139 | V/vms/envelope/features_test.go:12 |
| R29-G2 | **Receiving features.** A side counts a peer's `features` from any message that passes acceptFrom steps 1–4, even one in a handshake later abandoned; names are only ever added (sticky); unknown names are ignored; a malformed `device.features` is dropped (`drop.features_malformed`). | §10.8, §10.2 | `seeFeatures` M/upgrade_test.go:37 | V/vault/features086.go:96-117; V/vault/inbound.go:433 | *gap*: sticky against a later list without it |
| R29-U1 | **Upgrade migration.** At the first load under release 29, each connection's stored epoch becomes its only epoch record: confirmed = current, signer = the stored `ik`, received flag (F3) clear. An outgoing handshake in flight at the upgrade is restored under these rules if it can be, otherwise dropped as `handshake_not_restored` (vettid-vault #200) and started again; an answer awaiting `hs.fin` runs the responder half (§3). | §6.3.1 (new text) | — (the model starts on 29) | `upgradeEpochs` V/vault/confirm.go:101 | *gap*: migration, and a handshake in flight at the upgrade |

## 2. The initiator: activation on confirmation

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-L1 | **Lifetimes.** Initiator's handshake awaiting `hs.resp`: 16 days (7 after a restore). Responder's answer awaiting `hs.fin` (`L`): 16 days from its `hs.resp`. Pending epoch (`B`): 32 days from `hs.fin`, judged after the first short collect after an unlock. Responder's confirmed epoch while not current: keys up to 48 days from the activation that superseded it and 16 days once it stops being confirmed; its id until it stops being confirmed or the connection ends. | §6.3.1 Lifetimes | M/confirm_test.go:15-19; M/state_test.go:77, :149 | V/vault/confirm.go:34-37 | r29_f_test.go:210, :229 |
| R29-I1 | For **every** rekey and reconnect (toward a vault or a device), after sending `hs.fin` the initiator's new epoch is **pending**: established (signer recorded) but not current. It keeps sending in the current epoch and opens messages under both. | §6.3.1 Initiator (Change: no gate) | `makePending` M/confirm_test.go:84 | `makePending` V/vault/confirm.go:215 (the gate at V/vault/handshakes.go:1323, :1396 goes); keyring V/vms/handshake/epoch.go:298-334 | r29_scenarios_test.go:281; keyring086_test.go:14 |
| R29-I2 | Any message from R **other than `hs.fin`** that opens under the pending epoch's `r2i` key and passes acceptFrom steps 1–4 **confirms** it, before dedupe, the `ts` window, step 5 or the handler. In that write the epoch becomes current and the outbox continues in it (entries already sealed under the old epoch are deposited as they are). An abandoned epoch never confirms. | §6.3.1 Initiator | `beforeAccept` M/confirm_test.go:199 (`steps14` :154; hs.fin out :214) | `beforeAccept` V/vault/confirm.go:411 (hs.fin out :454); `confirmPending` :236 | r29_f_test.go:40, :60, :83; r29_review_test.go:17 |
| R29-I3 | While a **reconnect** is pending, the initiator sends nothing but the handshake (no `hs.confirm` either); its outbox waits. | §6.3.1 Initiator | M/world_test.go:579 (*differs*: lets `hs.confirm` out) | V/vault/outbox.go:259; `pendingReconnectHold` V/vault/confirm.go:627 | *gap* |
| R29-I4 | A side starts no rekey with a peer while its own epoch is pending or one of its answers awaits `hs.fin`. | §6.5, §6.3.1 | M/rotate_test.go:182 | `rekeyBlocked` V/vault/confirm.go:537 | r29_scenarios_test.go:388 |
| R29-I5 | **At `B`** the initiator abandons the pending epoch and reconnects naming its current epoch (a device: rekeys, D1). A pending **reconnect** that reaches `B` makes the connection `stale` with `connection.stale` and its feed item (K6). | §6.3.1 Initiator | `tickA` M/confirm_test.go:313 | `tickPending` V/vault/confirm.go:310 | r29_scenarios_test.go:334; r29_f_test.go:210, :229 |
| R29-I6 | With no valid standing token, or on `token_expired` once the token's `exp` has passed on its own clock, the initiator abandons a pending **rekey** epoch and reconnects. A pending **reconnect** with no valid token left is not abandoned (another could not be deposited either); it ends at `B` as I5 says (Change: written in, with the `stale` bound). | §6.3.1 Initiator | M/world_test.go:685 (*differs*: any `token_expired`) | V/vault/outbox.go:371-384; V/vault/handshakes.go:1358-1369 | r29_f_test.go:123 |
| R29-I7 | **Every abandon** of a pending epoch: at `B`, by I6, by H5/S5 (K2), at a crossing (X1), by a link (K2), when R activates the peer's handshake (R1), and when the side starts a reconnect (a reconnect names the current epoch, never a pending one). In the same write it revokes the tokens its `hs.init` carried (and an abort always revokes them, §6.3). Except after a link, the abandoned epoch's receive keys are kept 16 days and authenticated messages under it are processed **without confirming it**; after a link it is demoted from the start (`ancestor_ik`). A reconnect's abandoned epoch is followed by a fresh reconnect, not a rekey. | §6.3.1 Initiator, §6.3 | M/accept_test.go:1049 (own handshakes only) | V/vault/confirm.go:268-285; `revokeIssued` V/vault/tokens.go:252; V/vault/handshakes.go:1366 | r29_f_test.go:306; r29_review_test.go:172; r29_rr2_test.go:215 |

## 3. The responder

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-R1 | Toward a vault, R activates at a verified `hs.fin` within `L`; in the same write it queues `hs.confirm` (`{}`, session mode under the new epoch, durable, never answered) and abandons its own pending epoch with I. An `hs.confirm` that confirms nothing is acked and ignored without audit. | §6.3.1 Responder | `tableBFin` M/accept_test.go:978 | `responderEstablish` V/vault/handshakes.go:771; `queueConfirm` V/vault/confirm.go:320; V/vault/inbound.go:437-439 | *gap* (r29_f_test.go:170 tests R3's cap) |
| R29-R2 | R's **confirmed epoch** is the newest epoch, in activation order, in which R received from I a message other than `hs.fin`, or that R activated itself at confirmation. It never moves back. | §6.3.1 Responder | `setConf` M/confirm_test.go:116; `beforeAccept` :220 | `setConfirmed` V/vault/confirm.go:166 | r29_scenarios_test.go:281 |
| R29-R3 | While the confirmed epoch is not current, R keeps its receive keys and `rk` (L1), accepts I's messages under it, and re-queues `hs.confirm` for a collected batch holding one, unless one is still in its outbox. | §6.3.1 Responder | `reconfirm` M/confirm_test.go:290 | `reconfirmAll` V/vault/confirm.go:344; `responderActivation` :395 | r29_f_test.go:170 |
| R29-R4 | A rekey or reconnect naming R's confirmed epoch is accepted as if current (a reconnect also after its keys are gone), after the fork checks of F1; R abandons its own open rekey for it. | §6.3.1 Responder, §6.6 | M/accept_test.go:724-755 | `classifyCtx086` V/vault/confirm.go:590; V/vault/handshakes.go:553, :606 | r29_f_test.go:252; r29_scenarios_test.go:436 |
| R29-R5 | **Rule E.** In the write that establishes a rekey's or reconnect's epoch, R destroys every other epoch with I later than the confirmed one (send key and `rk` erased; receive key kept 16 days only to read the inner `ts`), records the accepted `hs.init`'s inner `ts`, and drops any unsent `hs.fin` for them with its outbox entry. | §6.3.1 rule E | `ruleE` M/confirm_test.go:265 | `ruleE` V/vault/confirm.go:360 | r29_round6_test.go:141; r29_f_test.go:252 |
| R29-R6 | An authenticated message under a destroyed epoch with a later inner `ts` than the recorded one is **fork evidence** (suspend, `ref` = `epoch`, the neutral feed item); with an earlier one it is refused (`superseded_epoch`). Its links are checked by rule C first (K8). | §6.3.1 rule E, §3.4.1 acceptFrom | M/accept_test.go:203-224 (the gated branch) | `destroyedEpochMessage` V/vault/confirm.go:474 (the ungated branch :489-492 goes) | r29_scenarios_test.go:744 (gated iteration); r29_oldcopy_test.go:266 |

## 4. Reconnect `ctx`, crossings and timing

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-X1 | I, holding a pending epoch, drops a rekey `hs.init` from R under the current epoch whose inner `ts` is not later than the `hs.resp` it processed; a later one shows R's answer ended without `hs.fin`: I abandons the pending epoch and answers it. | §6.3.1 Crossing | M/accept_test.go:770 | V/vault/handshakes.go:572 | r29_scenarios_test.go:402 |
| R29-X2 | For any two crossing handshakes, whatever their purposes, a verified `hs.fin` comes first (it abandons the side's own open handshake); otherwise the lower `th1` completes at the peer's `hs.resp`. A crossing handshake a side cannot answer is acked and dropped. | §6.5, §6.6 | M/accept_test.go:785, :990 | `crossingRekeyLoses` V/vault/confirm.go:548; V/vault/handshakes.go:804 | r29_scenarios_test.go:670; r29_round6_test.go:514 |
| R29-X3 | **Rule J.** An answer to a rekey that R cannot deposit (no standing token valid by its own clock) is destroyed at once; neither the rekey block nor §6.6 holds R back from reconnecting. | §6.3.1 Lifetimes | M/world_test.go:623; M/rotate_test.go:293 | V/vault/handshakes.go:582 | r29_scenarios_test.go:364 |
| R29-X4 | One reconnect at a time per peer, whatever the trigger. | §6.6 | *not modelled* | `startReconnectCtx` V/vault/handshakes.go:1349 | *gap* (r29_rr2_test.go:104 covers the demotion trigger only) |
| R29-X5 | **Which `ctx` a reconnect may name.** The initiator names its current epoch, except after a demotion (K5's epoch). The responder accepts its current epoch, its own pending epoch, its confirmed epoch (R4), and an epoch it abandoned while pending until a newer one is confirmed; while its own reconnect is pending it accepts only that pending epoch; a side that has sent `hs.fin` for its own reconnect refuses its earlier epoch. Any other `ctx` is refused. A pending or destroyed epoch never enters a service connection's reconnect history. | §6.6 | M/accept_test.go:724-736 | `classifyCtx086` V/vault/confirm.go:590-623 | r29_f_test.go:252 |
| R29-X6 | A sealed-mode `hs.init` with purpose rekey is refused as malformed. | §6.2 (0.86.5) | — | V/vms/handshake/responder.go:64 | *gap* |

## 5. Identity-key links (the second live bug, and demotion)

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-K1 | **S8, the whole chain.** `identity.rotate` and every rekey's `hs.init` and `hs.resp` carry in `rotations` all of P's links from the signer of the epoch they travel in (or rekey) to P's current `ik`, not only the newest. This fixes the second live bug (a lost `identity.rotate` → rekeys refused for good). No exception by peer (Change: 0.86.2's "toward a peer without `features`, none" goes). | §3.4.1 S8 | M/world_test.go:642; M/rotate_test.go:204 | `identityRotateBody`, `rotateLinks` V/vault/iklinks.go:696, :51; V/vault/handshakes.go:1370 (the `advertisedFeatures()` conditions at :635, :1312 go) | r29_scenarios_test.go:535; r29_review_test.go:255; keyring086_test.go:97; V/client/rotate086_test.go:18 |
| R29-K2 | **H5 / S5 with pending epochs.** A change of the current `ik` (by any message, or a suspension) abandons every own handshake and pending epoch pinned to a superseded `ik`; following a link abandons a pending epoch whose `sig_R` the link's `old_ik` made, unless the message carrying the link traveled under it. At its own rotation P abandons its rekeys, reconnects and pending epochs and **drops** its answers awaiting `hs.fin` (revoking their tokens); a later `hs.fin` for one is acked and dropped. | §3.4.1 H5, S5 | M/accept_test.go:1021; M/rotate_test.go:53-78 | `h5` V/vault/iklinks.go:514; `s5` :722, the drop :737-743 (its `aw.Gated` condition goes: always drop) | r29_f_test.go:60; r29_round6_test.go:454; r29_scenarios_test.go:619 |
| R29-K3 | **S5 resend.** P sends `identity.rotate` again (with K1's links) on a session message from Q under an epoch whose P-side signer is an ancestor, inner `ts` > 1 h after P's first `identity.rotate` to Q; at most 3 times per peer per rotation, once per hour. | §3.4.1 S5 Resend | `idResend` M/confirm_test.go:353 | `idResend` V/vault/iklinks.go:752 | *gap* (model only: M/confirm_scenarios_test.go:167) |
| R29-K4 | **Demotion by position.** Following a link at position x concerns an epoch of P signed by that link's `old_ik` or an ancestor and established by a message deposited after x (for Q as initiator, the `hs.resp`). If its received flag (F3) is **set**, P's side used it after the rotation, so a copy did: Q suspends (`ref` = `epoch`, the fork feed item; Change). Otherwise Q demotes it, audits `connection.fork_suspected` `ref` = `epoch` (no feed item, no suspension), and refuses messages under it deposited after x (`ancestor_ik`). | §3.4.1 Epochs after an `ik` link | `followIK` M/accept_test.go:633 (no audit, no flag) | V/vault/iklinks.go:223-247 | r29_oldcopy_test.go:205; r29_round6_test.go:546; *gap*: the flag-set case |
| R29-K5 | **After a demotion of the current epoch**: Q sends only handshake messages (no `hs.confirm`); durable messages are **held**, per peer, unsealed, and sealed with a new `ts` under the next current epoch; entries sealed but undeposited go back to held; expired held ones are discarded (`drop.held_expired`); ephemeral ones are not sent; held ones end when the connection goes `stale`, is removed or replaced (*to settle*: whether that is audited). Q reconnects naming the newest epoch that has been current and is neither demoted nor destroyed (none: `stale`). | §3.4.1 Epochs after an `ik` link | *differs*: the model **rekeys** (M/accept_test.go:646) and blocks `hs.fin` while demoted (M/world_test.go:594) | `holdDemoted`…`sealHeld` V/vault/iklinks.go:306-413; `restartAfterDemotion` :463 | r29_oldcopy_test.go:431, :515, :534; r29_review_test.go:65; r29_round6_test.go:161, :195 |
| R29-K6 | **Every reconnect is bounded** (Change: 0.86.6 bounds only the demotion reconnect): the demotion reconnect (K5) and strict F1's (K7) alike. A try fails only when its handshake expires or at `B` (tokens revoked); a refusal is silent and not counted. The third failure for the same epoch, a relay `quota_exceeded` for its `hs.init`, or no reconnect token left, makes the connection `stale` with `connection.stale` and its feed item. | §3.4.1 The reconnect after a demotion, §6.6 | *not modelled* | V/vault/iklinks.go:415-475 (comment :415-423 is stale), :446-449; V/vault/outbox.go:403-423 | r29_oldcopy_test.go:724, :778, :803; r29_rr2_test.go:135; r29_round6_test.go:563; *gap*: the K7 reconnect |
| R29-K7 | **Strict F1.** A link carried under an epoch E of P, while Q's current epoch is later than E and signed by the link's `old_ik`, shows that P's side never activated the later epoch, or a copy did. If the later epoch's received flag (F3) is **set**, Q suspends (`ref` = `epoch`, the fork feed item; Change). Otherwise Q demotes it and reconnects naming E, which P accepts as its last. | §3.4.1 Epochs after an `ik` link | `f1Demote` M/accept_test.go:1199 (keep branch :1206-1226 goes; no flag) | `f1Demote` V/vault/iklinks.go:260 | r29_oldcopy_test.go:153, :234; `TestR29RR2OwnCopyNoRKLostReconnectWedges` V/vault/r29_rr2_test.go:38 (flips to "suspended"); *gap*: both-29 versions |
| R29-K8 | **Rule C with seen links.** Every valid link that passes step 3 is kept as seen (followed or not; a rekey's only once it would be accepted), at most one per old key and 32 per peer; a second successor suspends. A message under a demoted or destroyed epoch has its links checked first. | §3.4.1 Rule C, acceptFrom | M/accept_test.go:313 | `rotationConflictRec` V/vault/rotateconflict.go:42; `evidenceFirst` V/vault/iklinks.go:160 | r29_review_test.go:223; r29_round6_test.go:302; r29_oldcopy_test.go:296 |

## 6. Old copies

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-F1 | **Fork by `ctx`.** For a rekey or reconnect from P under the new `ik`, a `ctx` naming an epoch older than Q's confirmed epoch, where an epoch after it up to the confirmed one has as P-side signer an ancestor of the `ik` the message reaches, is fork evidence: Q suspends (`ref` = `epoch`, the neutral feed item "<name> or your vault may be running from an old copy. The connection is paused…"). **There is no `own_copy` exception** (Change: fix A goes; between release-29 vaults every epoch Q began that became current was confirmed by P's side, so "P never activated it" cannot hold for an honest P). | §3.4.1 Epochs after an `ik` link | `forkEpoch` M/accept_test.go:653 (fix A :681-683 and `acceptOwnCopy` :1251 go) | `forkEpoch` V/vault/iklinks.go:555 (`acceptOwnCopy` :579, `rekeyOtherEpoch` :624 go) | r29_oldcopy_test.go:153, :296 |
| R29-F3 | **S13, owner decision a: the received flag.** Q keeps one "received from peer" flag per epoch, set by **any** message from P that opens under **that** epoch and passes acceptFrom steps 1–4, `hs.confirm` and handshake messages included (Change: #206 skips `hs.*`; the model sets it before steps 1–4). A set flag turns K4 and K7 into F1's outcome: suspension and the fork feed item. A lost `hs.fin` leaves it clear (P sent nothing under the epoch), so the honest case stays quiet. | §3.4.1 (new text) | `GotFromPeer` M/accept_test.go:60-62 (*to change*) | `GotFromPeer` V/vault/confirm.go:428 (*to change*); `OwnCopyGotFromPeerSuspends` V/vault/iklinks.go:684 goes with F2 | *gap*: set by `hs.confirm` alone; **a handshake message under E0 does not set E1's flag**; a lost `hs.fin` leaves it clear |

(R29-F2, the `own_copy` exception, is withdrawn in draft 3; the ID is not
reused.)

## 7. Devices and agents

| ID | Rule | Spec | Model | Code | Test |
|---|---|---|---|---|---|
| R29-D1 | Toward its device or agent the vault is always the initiator. Where a connection would reconnect (I5, I6, K5), the vault rekeys from its current epoch, also at `B` with no valid token. A vault never demotes an epoch with a device (devices rotate no `ik`). There is **no marker** toward devices (decision a: apps from before release 29 are not supported; a device that sends anything under the new epoch confirms it anyway, I2). | §6.3.1 Initiator, §3.4.1, §6.7 | M/confirm_test.go:142; M/rotate_test.go:182, :253, :377 (*differs*: at `B` with no token the model marks the device `stale`, M/confirm_test.go:146) | V/vault/confirm.go:299; V/vault/outbox.go:374; V/vault/iklinks.go:297, :463 | *gap* on the vault side |
| R29-D2 | The device (reference client) runs **only the responder half** toward its vault: `hs.confirm`, the confirmed epoch, and re-sending `hs.confirm` at most once a minute, unless one is still in its outbox (Change: the spec says per collected batch). It starts no rekey, and applies neither rule E nor Table B's demotion (§15 item 51, deferred past 29). | §6.3.1, §15 item 51 | *differs*: devices run the full rules and start rekeys | V/client/confirm.go:13-112 (:22-25, :31-33); V/client/client.go:258-262, :1595 | V/client/rotate086_test.go:18, :71; V/client/persist_test.go:517 |
| R29-D3 | A rekey `hs.init` from a device or agent is acked, dropped and audited `drop.peer_key` (`ref` = `unexpected`); the vault answers none. The vault's responder-half paths toward a device (rule E's device branch, V/vault/confirm.go:479-482) go. | §6.7 (new text) | — | `handleRekeyInit` V/vault/handshakes.go:527 (*to change*) | *gap* |

## 8. Dropped by decision a and the lead's H2

Removed from the spec (0.87.0), the model and #206:

| What | Spec 0.86.6 | Model | Code (#206) |
|---|---|---|---|
| The gate on the initiator half, and every "toward a peer without the gate / without `hs_confirm`" branch | §6.3.1 Deployment | `initHalf` M/confirm_test.go:60 conditions; mixed modes | `gateFor` V/vault/confirm.go:210 and its uses (V/vault/handshakes.go:1323, :1396); `aw.Gated` |
| Revert keep: copies, the 256 / 1 MiB / 8 MiB caps, 64 KiB claim-check while keeping, revert, `connection.epoch_reverted`, its History line | §6.3.1 Deployment (from "Toward a peer without the gate…") | `revertRule`/`revert` M/confirm_test.go:73-80, :204-263; `RevOld`/`RevSent` | V/vault/ungated.go:12-320 and hooks; keyring `KeepSend`/`Reinstate` V/vms/handshake/epoch.go:274, :355. **Move first** the shared `reconnectNaming` (ungated.go:326) and `markStale` (:391). |
| Activation at `hs.fin` without confirmation; ungated `HoldFor` (0.86.6 S4); `EpochMeta.Unconfirmed` | §3.4.1 "Toward a peer without the gate the reconnect gets no revert keep…" | — | V/vault/handshakes.go:1232-1256; V/vault/confirm.go:432-445; V/vault/iklinks.go:374; V/vault/state.go:368 and writers |
| Rule E's reconnect toward a peer without `hs_confirm` (3 tries, then `stale`) | §6.3.1 rule E (0.86.0) paragraph | M/ungated_test.go | V/vault/confirm.go:489-492 |
| Rule L and its retries | §3.4.1 Rule L | M/ungated_test.go | V/vault/iklinks.go:788-809 and hooks; `RuleLState`; `RuleRC`/`ruleRCExpired` V/vault/ungated.go:363. **Keep** the shared reconnect and quota paths used by K5–K7 (V/vault/handshakes.go:614-623; V/vault/outbox.go:403-416, incl. :408's `RuleRC` check). |
| S5: an answer kept toward an ungated peer, then a rekey | §3.4.1 S5 "To any other peer…" | — | V/vault/handshakes.go:808-812; the drop at V/vault/iklinks.go:737-743 **stays**, unconditional (K2) |
| S8's "no links toward a peer without `features`" | §3.4.1 S8 (0.86.2) | — | V/vault/handshakes.go:635, :1312 |
| Fix A, the `own_copy` exception, and its History line | §3.4.1 "Except…", "When the exception applies" | fix A M/accept_test.go:681-683; `acceptOwnCopy` :1251; `ownCopyStrict` | `acceptOwnCopy` V/vault/iklinks.go:579-612; `rekeyOtherEpoch` :624-649; `OwnCopyGotFromPeerSuspends` :684; `EpochMeta.OwnCopy`; V/vault/handshakes.go:435-438, :844-851 |
| Strict F1's keep branch | — | M/accept_test.go:1206-1226 | the keep hooks in `f1Demote` |
| O3a: `stale` on an ancestor `hs.fin` from a peer without `features`, and the kept `k_i2r` record | §3.4.1 O3a; Table B ancestor/`hs.fin` cell rewritten | not modelled | V/vault/o3a.go; V/vms/handshake/snapshot.go:462-490. Such an `hs.fin` is then acked and audited `unknown_kid` (V/vault/inbound.go:340-344). H5's fork-evidence exempt answer is separate and **stays**. |
| The vault's responder half toward devices | — | — | V/vault/confirm.go:479-482 (D3) |
| The `emu28` stand-in and every emu28 test; the CI step | — | `Rel28`, M/r28_test.go, the upgrade/mixed modes and switches | V/vault/emu28*.go and its branches; ci.yml:36-37 |
| Mixed-pair model invariants: I1-loss/revert, I1-false-revert | — | M/run_test.go:750; M/confirm_test.go:234 | — |

## 9. The model as oracle (step 4)

1. **Configs.** The pass/fail oracle runs these rules with relay-key rotation
   **off** (release 29 builds none and does not advertise `relay_follow`;
   Table A reduces to current/foreign). A second regression config keeps
   relay rotation on.
2. **Divergences to fix:** K5 (reconnect, not rekey; let its `hs.fin` out
   while demoted); I3 (hold `hs.confirm` while a reconnect is pending); I6
   (own-clock `exp`; the reconnect exception; `stale` at `B`); F3 (the flag
   after steps 1–4, `hs.confirm` included, per epoch) and its use in K4 and
   K7; D1 (rekey at `B`, not `stale`); D2 (the device runs only the
   responder half, without rule E or demotion, and starts no rekey); D3.
3. **Not modelled yet:** X4, X6, K6, the K4 audit, the held queue as explicit
   state (K5), U1.
4. **Reach.** In 13,000 both-29 runs of today's model, demotion by position
   and rule E's fork evidence each fired about once, and F1-by-rekey and the
   ancestor `hs.fin` never. So: add action generators for an old copy that
   answers or confirms a handshake and for `hs.fin` loss around a rotation;
   CI requires a minimum hit count for every R29 rule.
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

- **Earlier releases are unsupported.** A vault or app on release 28 or
  earlier may lose a connection with a release-29 vault; it is re-invited (or
  re-paired). Decision a; upgrade compatibility is a requirement again from
  the first production users on.
- An old copy that collects P's live mailbox can confirm Q's pending epoch as
  P until a link arrives (§3.4.1 Residual, unchanged). When the link arrives,
  K4 or K7 sees the epoch's received flag set and suspends.
- The §3.4.1 Residuals list, unchanged.

## 12. Questions (the lead answered Q1–Q6 for draft 2; the owner decides)

- **Q1:** *answered by the lead's H2*: no marker and no gate between
  vaults; none toward devices either (D1).
- **Q2 (O3a):** drop the kept record too. Lead: yes.
- **Q3 (F3):** a set flag means F1's outcome, suspension included, in K4 and
  K7 (the feed wording says "paused"). Lead: yes. The owner confirms, since
  the S13 question said "feed alert", not "suspend".
- **Q4:** oracle with relay rotation off, regression with it on. Lead: yes.
- **Q5 (D2):** a device re-sends `hs.confirm` at most once a minute, unless
  one is still in its outbox. Lead: yes.
- **Q6 (I6, K6):** write in #206's two behaviours, with every reconnect
  bounded by `stale`. Lead: yes.

## Review log

- **Draft 1, Opus review** (2026-11-06; ran the model's both-29 config: 3,000
  + 10,000 + 10,000 runs, 0 violations): 2 High, 7 Medium, Lows; all
  addressed in draft 2.
- **Draft 2, the lead's independent Opus check** (GC 01M6R70DFZGHF1552VDV7TJ0H3,
  "go after fixes"): H1 (K4 and K7 ignored the flag: a copy that confirmed
  Q's epoch ended silently, per `TestR29RR2OwnCopyNoRKLostReconnectWedges`) →
  K4, K7 suspend on a set flag; §11 corrected. H2 (the upgrade window brings
  back live bug 1 between two 29 vaults) → no gate between vaults: G3, the
  28 path, K1's no-links branch and F2/fix A dropped; Q1 answered. M1 (rekeys
  from devices) → D3. M2 (migration) → U1. M3 (F2 tests) → F2 withdrawn. M4
  (bounds) → K6 covers every reconnect; I5/I6 end in `stale`. Lows: X6
  cited; the flag's per-epoch test added to F3.
