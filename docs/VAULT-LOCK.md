---
title: VAULT-LOCK
status: approved by the owner 2026-10-12 (L1–L16 as recommended); design note; the normative text is in VAULT-MESSAGING 0.29.0, MEMBER-API 2.5.0 and VAULT-HOST-PROTOCOL 0.1.3, each rule marked "release L" (not released, not built)
version: 0.1.1
date: 2026-10-12
owner: Al Liebl (Mesmer)
component: vault (enclave), member API, account site, apps
related:
  - VAULT-MESSAGING.md (0.29.1) §3.6 (owner check, hold; new §3.6.8), §8.6, §10.2, §10.8, §11.4, §11.5, §12.3, §13.3, §15 item 37
  - MEMBER-API.md (2.5.0) "Vault": the lock route, the response slot, `VaultStatus`
  - VAULT-HOST-PROTOCOL.md (0.1.4) §6.1, §11.3
  - ANDROID-PLAN.md (0.1.38) §4 "Locking the vault"
  - VAULT-RELEASES.md (0.1.19) §3.4 (C2, C4)
  - vettid-android #127 (open, not merged at the time of writing; read at 78f741a0), vettid-vault `main` 079cde7
changelog:
  - 0.1.1: §8, the point about `no_lease`: the silent-parent fix is
    merged in vettid-vault (#70, #71, #72, `main` 392b03c; S11 not
    released yet), and what it does and does not settle. No decision changes
  - 0.1.0: first draft, after the owner's request of 2026-10-12
    ("please draft the specs for both vault decisions"). Code read at
    vettid-vault `main` 079cde7, this repository's `master` 64d24ff and
    the description of vettid-android #127. Nothing here is built.
    **Approved by the owner 2026-10-12** on vettid.org #247 ("247 is
    approved with your recommendations"): L1–L16 as recommended (§7).
    No version change: it was not merged as a draft
classification: public (no secrets; safe for github.com/vettid)
---

# Locking a vault: a lock that belongs to its unlock, and a lock by itself (design)

## 1. What this is

Two decisions, taken by the owner on 2026-10-12 (§7), with the
specification text each needs. The text is written into the documents
themselves and marked **release L**, a placeholder for the vault
release that will carry it (as "release C2" is for calls): the
staging release after S11. Nothing changes for a vault or an app until
that release is built and running.

1. **A lock belongs to the unlock it ends, and says truthfully whether
   it locked.** Today a lock is "lock whatever is running", it can
   arrive late and lock a vault the member has just opened again, and
   the answer "done" is given before the vault has locked.
2. **A vault locks by itself when its member has been away long
   enough.** Today a vault that is not told to lock stays open until it
   is told, restarted or loses its lease.

**For a member**, once release L runs:

- Locking the vault from the phone gives a plain answer at once in the
  usual case: "Your vault is locked." The wait of up to 40 seconds
  before an unlock that follows a lock goes away, and a vault is never
  locked again by an old lock right after it was opened.
- "Lock my vault" on the account site keeps working without the phone,
  and now says truthfully whether the vault locked.
- Nothing changes day to day for a member who opens the app and passes
  the daily check. A vault whose member has not passed the check for
  **7 days** after it was due locks itself. The member then unlocks
  with the PIN and passes the check, on one screen, as today for a
  vault that was locked while they were away. The member can make the
  7 days shorter or longer (1 hour to 30 days).

## 2. What is there today

Read from the code and the specifications named in the front matter.

| # | Fact | Where |
|---|---|---|
| F1 | **No idle lock.** "There is no idle lock by default; the owner MAY set one." No setting for it is defined, and the vault has no code for it; only the name of a stop reason, `idle`, which nothing produces | VAULT-MESSAGING §12.3, §10.8; vettid-vault `internal/hostproto/frame.go` (`StopExpected`) |
| F2 | The "5-minute window" is the credential's unlock window, not the vault's | §3.5.3; `credential.unlock_ttl_seconds` |
| F3 | **The owner check already bounds what an absent member's devices can do.** Past the deadline (24 h at most after the last check) the app is gated to the check, and with the hold on (the default) desktops are suspended and agents paused. The vault itself keeps running: it collects, stores, and serves the standing grants the member gave connections | §3.6.2, §3.6.3 |
| F4 | The vault measures the deadline with the enclave's own clock, at every request and every collect cycle (at most 30 s apart). The clock comes from the Nitro hypervisor, not from the parent | §3.6.1, §3.6.3; VAULT-PLAN §5.2 |
| F5 | `vault.lock` (app, desktop) has an empty body; the vault locks after the batch. Nothing ties it to an unlock | §10.2; `vault/core.go` `hLock` |
| F6 | A message's `exp` is judged by the vault's clock with no allowance (`now.After(exp)`), and a `ts` up to 5 minutes ahead is accepted. A phone whose clock runs ahead keeps a lock alive for that much longer | `vms/envelope/inner.go` `CheckTime` |
| F7 | **The queue is not ordered.** A `lock` operation can be delivered up to 5 minutes after it was queued (the queue's retention), and after an unlock queued later (the parent has 8 in flight) | §11.5; `parent/consumer.go` |
| F8 | **`done` proves nothing.** The enclave sets the lock's answer to `done` before it locks, and discards the lock's result. The member API writes `done` itself when no instance holds the vault's lease | `enclave/instance.go` (`Status: StatusDone`, then `_, _ = in.host.Lock(…)`); `lambda/member/vault.ts`, the lock route |
| F9 | The account site shows "Your vault is locked." on `done` | `sites/account/js/vault.js` |
| F10 | `GET /api/vault/status` says `locked` whenever the vault row has no live lease, whatever the vault last reported. It is the member API's view; nothing in it is authenticated by the vault | `lambda/member/vault.ts`; §11.5 "A stopped vault is locked" |
| F11 | The host can originate `lock` for any vault (availability only), and can drop a lock, a `locked` event, or all of a vault's traffic | §13.3; VAULT-HOST-PROTOCOL §11.3 |
| F12 | Inside the enclave a lock cannot fail to lock: a vault process that does not exit in time is killed. What can fail is the final flush (then nothing unflushed was acked, §8.3) | `enclave/supervisor/prochost.go` `LockReason` |
| F13 | The Android app (vettid-android #127, not merged) works around F5 to F8: the phone locks at once; the lock stays **pending** until something confirms it; `vault.lock` is sent once with `exp` 30 s and never through the outbox; every unlock first waits out an unanswered relay lock (up to 40 s); the member API's answer to a lock never confirms | the pull request's description |

Where the specifications and the code disagree is listed in §9.

## 3. Decision 1: a lock that belongs to its unlock

### 3.1 The value

Each time a vault opens (a successful enrollment or unlock), its
process makes an **`unlock_id`**: 16 random bytes, written as 32
lowercase hex characters.

- **In memory only.** It is not in the vault's state or header. When
  the vault locks, restarts or moves, the process ends and the value
  with it; the next unlock makes a new one. So every earlier value is
  stale after any lock, with nothing to store or migrate.
- **Not a secret.** It names an unlock; it authorizes nothing. A lock
  still needs what it needs today: a device's session with the vault,
  or a request the member API accepts. The host sees it on the member
  API path and gains nothing: it can lock any vault already (F11).
- **Random, not a counter or a time.** A counter would have to be
  stored to survive a restart, and a time is what F6 shows cannot be
  compared across clocks. Two unlocks never share a value in practice
  (128 bits).
- **Where a device gets it:** in the sealed `vault.unlock.result` and
  `vault.enroll.result` (the app), and in `vault.status` (the app, and
  a desktop, which locks but does not unlock).

### 3.2 Two kinds of lock

| | **Bound** ("lock this unlock") | **Unconditional** ("lock this vault") |
|---|---|---|
| Carries | `unlock_id` | no `unlock_id` |
| The vault acts if | the value is its current unlock's | the request is newer than its current unlock (§3.3) |
| Otherwise | answers `stale_lock` and does nothing | answers `stale` and does nothing |
| Used by | the app and a desktop over the relay (`vault.lock`); the app through the member API | the account site's "Lock my vault"; a recovering app; an app that does not hold the value; the member API for a cancelled account; apps from before release L |
| Why it exists | the device that opened the vault ends exactly that opening | a member without the phone must be able to lock: that is the lost-phone case, and it must work |

Locks that do not come from a request are unchanged and are neither
kind: ten failed checks, the idle lock (§4), a lost lease, memory
pressure, a restart, a recovery, deletion (§12.3).

### 3.3 An unconditional lock must not land after a newer unlock

An unconditional lock names no unlock, so something else has to say
whether it is older or newer than the vault's current opening. Every
queue message already carries `enqueued_at`, the member API's time when
it queued the request (§11.5). The rule:

> The enclave keeps, with the running vault, the `enqueued_at` of the
> enroll or unlock that opened it. An unconditional `lock` is carried
> out only if its own `enqueued_at` is **later**. Otherwise it is
> answered `stale` and nothing is locked.

- Both times come from the same party (the member API), so no clock of
  the phone or of the enclave is compared with another.
- **Residue.** Two member API processes can differ by a few
  milliseconds. A lock and an unlock queued within that of each other
  may be ordered wrongly: a lock is then either refused as stale (the
  member asks again) or locks a vault opened in the same instant. An
  equal time counts as stale.
- The host can alter `enqueued_at`, as it can alter anything in a
  message without an envelope. It gains nothing: it can lock any vault.
- A bound lock needs no such rule, and neither does the relay path: a
  `vault.lock` over the relay always carries the value from release L
  on (§3.6 for older apps).

The alternative, a per-vault counter that the member API increments for
every unlock and lock it queues, is exact but adds a write and a
counter to every request for the sake of that residue; it was not
chosen (decision L3).

### 3.4 A true answer

**Over the relay**, `vault.lock {unlock_id}` is answered by the vault
itself, inside the device's session:

| Answer | Meaning |
|---|---|
| `{}` | The value names the current unlock. The vault locks after this batch and sends `vault.locking {unlock_id}` |
| error `stale_lock` | The value names another unlock. Nothing was done; the vault is open under an unlock this device does not hold the value of |

A locked vault answers nothing: it does not collect (§12.1). The
request then waits at the relay until its `exp`.

**Through the member API** the enclave answers after the lock, with
what happened, as a `code` beside the status `done`:

| `code` | Meaning | Who writes it |
|---|---|---|
| `locked` | The vault was running on this instance and is now locked (also when the final flush failed: the process is gone either way, F12) | the enclave, through the parent |
| `not_running` | No vault process for this vault on this instance: it was locked already, or was never opened here | the enclave; and the member API itself when no instance holds the lease |
| `stale` | The vault is running under a newer unlock (bound: another `unlock_id`; unconditional: §3.3). Nothing was done | the enclave |

The status stays `queued`, `done` or `expired`: releases keep the
alternate channel's formats (VAULT-RELEASES §3.4 C2), and a `code` is
something an older app already ignores. A `done` **without** a code is
a release before L and still proves nothing.

### 3.5 What confirms a lock, and how far to trust it

| Evidence | Who vouches | Proves |
|---|---|---|
| The vault's `{}` to `vault.lock` | the vault, in the device's session | the vault is locking this unlock |
| `vault.locking {unlock_id}` naming this device's unlock | the vault | the same, for a lock from anywhere |
| `stale_lock` | the vault | the device's unlock is over (a newer one exists); nothing of this device's is open |
| Slot `code: locked` or `not_running` | the host and the member API | that they say so. A host that lies can keep a vault open whatever it reports (F11) |
| `GET /api/vault/status` not `unlocked` | the member API | the same |

The first three are the vault's own word. The last two are the host's.
A phone can never get the vault's word from a vault that is already
locked, because a locked vault does not speak. So the app has to accept
the host's word to end "may still be open" (decision L6); what bounds a
host that lies is §4, not the answer.

`VaultStatus` gains `locked_basis`, so that the two things the member
API calls "locked" can be told apart: `reported` (the host recorded
that the vault locked or stopped) and `no_lease` (no instance holds a
live lease; nothing was reported). Both are the host's view.

### 3.6 Older apps and older releases

| App | Vault release | What happens |
|---|---|---|
| before L | L or later | The unlock result has a member the app ignores. Its `vault.lock {}` and its API lock carry no value: the relay one is carried out as today (decision L2); the API one is unconditional, so it can no longer land after a newer unlock |
| L or later | before L (S10, S11) | The unlock result has no `unlock_id`: that is how the app knows. It behaves as vettid-android #127 does: one relay lock with a short `exp`, the wait before an unlock, no trust in `done` |
| L or later | L or later | Bound locks; retries over the relay; no wait before an unlock; codes read |

The app keeps the older behaviour until no release without `unlock_id`
can hold a member's vault (staging: when S11 is removed).

### 3.7 What the app may drop

With a vault that announced `unlock_id`:

- **The wait before an unlock.** An old lock names an old unlock and is
  answered `stale_lock`.
- **"Send once."** `vault.lock` may be sent again while pending: a
  repeat is harmless for the same reason. It still never goes through
  the durable outbox, and still carries a short `exp` (it should not
  wait at the relay for days).
- **"The member API's answer never confirms."** `locked` and
  `not_running` confirm (decision L6); `stale` ends the pending lock
  too: this phone's unlock is over.

The pending state itself stays: locked on the phone at once, durable,
retried, told plainly.

## 4. Decision 2: a vault that locks by itself

### 4.1 What "the member is away" can mean to a vault

A vault sees its devices only through what they send it. It does not
see whether a phone collects its mailbox (the relay does), and most of
what a phone sends needs no person: token refreshes, rekeys, the
on-phone service's reconnects, a push registration.

| Signal | Does the vault see it? | Does it mean the member? |
|---|---|---|
| A device collected or is connected | No | No |
| Any request from a device | Yes | No: background traffic keeps a phone in a drawer "active" for ever |
| A request sent when the app is in front (a new `vault.touch`) | Yes | Only that someone holds the unlocked phone |
| **A passed owner check** (PIN and credential password) | Yes | **Yes** |

Only the last is the member. It exists, is enforced in the enclave by
the enclave's clock, and already has a deadline (F3, F4).

### 4.2 Options

| | What it is | For the member | What it stops that today does not | What it costs |
|---|---|---|---|---|
| **A** | Lock after T (say 12 or 24 h) without **activity** from a device | A PIN every T of not using the app; or never, if background traffic counts | With background traffic counted: nothing for a phone that is on. Without it: a new message type and a rule the phone's holder satisfies by opening the app | A locked vault does not collect: no notifications, no calls, standing grants refused, until the member unlocks. Every member pays it every day |
| **B** | Lock when **no device was reachable** for T | Nothing while the phone is on | A dead or offline phone's vault | The vault cannot see reachability (§4.1); it would need a ping the phone answers by itself, which says the phone is on, not that the member has it. A stolen phone that is on keeps the vault open |
| **C** | Nothing new: the owner check and the hold | As today | Nothing new | Nothing. A vault whose member never returns runs, held, for ever |
| **D** | **The owner check stays the idle rule; a vault that has been overdue for X locks** | Nothing for a member who passes the daily check. Away longer than X past the deadline: unlock with the PIN, then the check | The vault leaves memory: its keys, its relay mailbox, its standing grants, and (with the hold off) its desktops and agents | After the lock, messages wait at the relay for 14 days and are lost after that; while only held they are collected and kept |

**Decided: D** (L10). The exposure a lost phone creates is already
bounded at the owner's side by the check (F3): after at most 24 hours
the app, the desktops and the agents get nothing without the PIN and
the password. What is not bounded is the vault itself: it stays open in
the enclave for as long as the host keeps it, serving what the member
once allowed. D bounds that, by a rule the enclave enforces alone, and
costs a present member nothing. A and B make every member unlock more
often, or rest on a signal that is not the member.

### 4.3 The rule (D)

- **When.** A vault locks itself when the time is past its owner-check
  `deadline` plus `idle_lock.after_seconds`. It looks where it looks for
  the hold: at every request and every collect cycle, by the enclave's
  clock (F4).
- **Default 604,800 (7 days); 3,600 to 2,592,000 (1 hour to 30 days).**
  With the default interval a vault is open at most 8 days after its
  member's last check. 7 days keeps an ordinary absence (a week away, a
  phone in for repair) from costing anything; the relay keeps messages
  14 days, so a member back within 21 days of the deadline has lost
  nothing. The upper bound is the longest the hold can be turned off
  with an end date (§3.6.7). There is no "never" (decision L12).
- **The setting** is the holder's, like the interval: a shorter value
  applies at once, a longer one from the next successful check, so
  someone holding an unlocked app cannot buy time with it.
- **Whatever the hold switch says.** With the hold off, desktops and
  agents keep running past the deadline; the idle lock is what ends
  that when the member does not come back.
- **After an unlock.** A vault unlocked when it is already past that
  time is not locked again at once: the idle lock waits one hour from
  the unlock, in which the member passes the check (the app asks for it
  on the same screen, §3.6.5). An unlock alone, without a check, buys
  one hour of a held vault each time, and needs the PIN each time.
- **A call in progress** is not cut: the lock waits for it to end (a
  call ends within 12 hours, §10.10).
- **A vault without a credential** has no deadline and no idle lock; it
  exists only during enrollment (§3.5.7).

### 4.4 What the member sees

- **Before.** `vault.status` and `vault.held` carry `idle_lock_at`. The
  app's held screen says when the vault will lock itself.
- **At the lock.** `vault.locking {reason: "idle"}`, which wakes the
  app (§14.2) like any lock the app did not ask for. The notification
  and the unlock screen say why (texts in ANDROID-PLAN, drafts).
- **After.** History shows `vault.locked` with the reference `idle`.
  The host sees an ordinary lock, as for the ten failed checks.

### 4.5 What stops while locked, and what was stopped already

| | Held (past the deadline, hold on) | Idle-locked |
|---|---|---|
| The app | The check only | Unlock (PIN), then the check |
| Incoming messages | Collected and kept; counts shown | Wait at the relay, 14 days at most, then lost |
| Incoming calls | Do not ring; a missed call is recorded | Do not ring; nothing is recorded (the offer expires) |
| Desktops, agents (LEASH) | Suspended and paused (running, with the hold off) | Nothing: sessions resume after an unlock and a check; LEASH statements lapse as when held |
| Standing grants to connections | Served | Refused: the vault looks offline |
| Push wakes | For `vault.held`, the alarm | One, for the lock; then none |
| A release update, a transfer, a recovery | A transfer opened before the hold can be approved; a recovery proceeds | As for any locked vault: a release notice still reaches the member by email and the account site; an open transfer ends; a recovery works on a locked vault (§11.11) |

### 4.6 What it is worth against whom

| Against | Today | With D |
|---|---|---|
| A lost phone, app unlocked, before the deadline | Whoever passes the phone's and the app's lock uses the vault: the vault answers its device without a PIN. Up to 24 h (the member can set 1 h) | The same. This is the interval's job, not the idle lock's; a shorter default interval is a separate question (L13) |
| A lost, dead or offline phone, after the deadline | App, desktops and agents get nothing. The vault runs on, indefinitely | The vault locks 7 days later. Nothing of it is in memory; the PIN is needed again |
| The hold turned off, and the member gone | Desktops and agents run until the end date, or for ever without one | Until the idle lock |
| A host that drops the phone's lock, or cuts the vault off | The vault stays open in memory for as long as the host runs it. The phone cannot know | The same until the idle lock, which the host cannot suppress: it is decided inside the enclave, by a clock the parent does not set. A host that stops the enclave locks the vault too |
| A compromise of a running enclave | Every open vault, however long its member has been gone | Only vaults whose members were recently there |

Not helped by either decision: someone who has the PIN and the
password.

## 5. Rollout

- **Not in S11** (L15). S11 is being cut with the scaling work and the
  silent-parent fix. This needs a vault change, a member API change
  and review first.
- **Release L = the staging release after S11 (S12), with both
  decisions.** They touch the same code (the lock path, `vault.status`,
  `vault.locking`), and the idle lock is small once the owner check's
  clock is there.
- **Before calls C2, and not coupled to it.** A lock that can land on a
  newer unlock is a defect members can meet today; C2 is a feature.
  If C2 is ready first, it goes first: neither needs the other.
- **Order of work:** vault (release L on
  staging); member API (it may deploy before the release: older
  enclaves ignore the new members, and it writes `not_running` itself);
  account site; Android (#127 first, then the bound lock behind the
  `unlock_id` check); production with the release that follows the
  usual promotion (STAGING-DEVELOPMENT-PLAN §2.4).

**Effort** (working days of implementation and review; estimates):

| Repository | Decision 1 | Decision 2 |
|---|---|---|
| vettid-vault (enclave, parent, client, vectors, MUST-COVERAGE) | 4–6 | 2–3 |
| vettid.org (member API, account site, tests) | 2–3 | 0 |
| vettid-android (after #127) | 3–5 | 2–3 (setting, texts, History) |
| iOS, desktop | later, the same rules | later |

## 6. Tests

**vettid-vault.** Unit: `unlock_id` differs at every open and is in
neither state nor header; `vault.lock` with the current value locks,
with another answers `stale_lock` and changes nothing, without one
behaves as before L; `vault.locking` carries the value. Enclave: a
`lock` operation answers `locked`, `not_running`, `stale` (bound and
unconditional, with `enqueued_at` before, equal to and after the
unlock's); the answer is written after the lock. Parent: the codes
reach the slot for `lock` only. End to end with the real relay: a
relay lock delayed past a new unlock is refused; a queued API lock
delivered after a newer unlock is refused; the idle lock fires at the
deadline plus the setting on a stepped clock, waits an hour after an
unlock and for a call, and obeys shortening and lengthening as
specified. Compatibility: the previous release's client against this
tree and the reverse (the `compat` workflow).

**Member API.** The lock route with and without `unlock_id`; the slot
codes passed through for `lock` and refused for other operations;
`not_running` without a lease; `locked_basis`.

**Phones** (Pixel 10 Pro on GrapheneOS, Pixel 7 on stock Android,
staging release L): lock in the app, airplane mode on before the lock
and off after a new unlock (the vault stays open); lock from the
account site with the phone off (the site says locked; the phone, back
on, shows it); unlock immediately after a lock (no wait); an app from
before L against release L, and the new app against S11; the idle lock
with the setting at its minimum (1 h) and the interval at 1 h: the
notice, the unlock and the check on one screen, History.

## 7. Owner decisions

**Decided by the owner 2026-10-12** (vettid.org #247: "247 is approved
with your recommendations"): every decision as recommended.

| # | Decision | Options | Recommendation | Decided |
|---|---|---|---|---|
| L1 | What names an unlock | (a) a random `unlock_id`, in memory only; (b) a counter in the vault's state; (c) the unlock result's time | **(a).** Nothing to store; every earlier value dies with the process; no clocks | (a) |
| L2 | A `vault.lock` over the relay without `unlock_id` (apps before L) | (a) carried out as today, until no supported app sends it, then `bad_request`; (b) refused from release L | **(a).** (b) would stop older apps locking over the relay the day the release lands | (a) |
| L3 | How an unconditional lock is kept from landing after a newer unlock | (a) compare `enqueued_at` with the unlock's (the member API's clock for both); (b) a per-vault counter kept by the member API; (c) no rule | **(a).** No new state; the residue is milliseconds between two member API processes | (a) |
| L4 | Who may lock unconditionally | (a) the account site's session, a recovering app, the app when it does not hold the value, the member API for a cancelled account; (b) the account site only | **(a).** Locking only reduces exposure, and the lost-phone lock from the web must not depend on a value only the phone had | (a) |
| L5 | How the true result is reported | (a) a `code` beside `done`: `locked`, `not_running`, `stale`; (b) new slot statuses | **(a).** The slot's statuses are frozen for live releases; older apps ignore a code | (a) |
| L6 | What ends "may still be open" on the phone | (a) the vault's word, or the host's (`locked`, `not_running`, a status that is not `unlocked`); (b) the vault's word only | **(a).** A locked vault cannot speak, so (b) could never be confirmed after any lock not made over the relay. The idle lock is what bounds a host that lies | (a) |
| L7 | The status route | (a) add `locked_basis`: `reported` or `no_lease`; (b) leave it | **(a).** It costs one member and makes the answer honest about what it rests on | (a) |
| L8 | Lost `locked` events | (a) nothing new: the stop notice and the lease rule already cover them, and the lock's own answer now does too; (b) the vault repeats the event | **(a)** | (a) |
| L9 | The Android workaround (#127) | (a) kept for vaults without `unlock_id`, dropped for those with it; removed when no such release remains; (b) kept everywhere | **(a)** | (a) |
| L10 | Whether a vault locks by itself, and on what | A activity; B reachability; C the owner check only; D the owner check, then a lock after X overdue (§4.2) | **D** | D |
| L11 | The default and the bounds of X | 24 h; **7 days**; 14 days. Bounds 1 h to 30 days | **7 days**, 1 h to 30 days. 24 h would lock the vault of anyone away for a weekend and gain little over the hold; 14 days leaves no margin before the relay drops messages | 7 days; 1 hour to 30 days |
| L12 | "Never" | (a) not offered; (b) offered, set only in a successful check, with a permanent indicator like "hold is off" | **(a).** A member who wants agents to run unattended passes a check once in 30 days; a vault nobody has vouched for in a month should not be open | (a): no "never" |
| L13 | The owner check's default interval (24 h) | (a) leave it; (b) shorten it | **(a).** Not asked; noted because it, not the idle lock, is what limits an unlocked phone in the wrong hands (§4.6) | (a): unchanged |
| L14 | Telling the member | (a) `idle_lock_at` in `vault.status` and `vault.held`, `vault.locking{reason: "idle"}` with a wake, History `idle`; (b) the lock notice only | **(a)** | (a) |
| L15 | Which release | (a) both in the release after S11, before calls C2 and not coupled to it; (b) decision 1 first, decision 2 later; (c) into S11 | **(a).** (c) is too late for a reviewed change | (a) |
| L16 | The texts (ANDROID-PLAN, drafts; the account site's two lines) | approve, or change | Approve as drafts; they are final when #127 and the release L work merge | approved as drafts; final when #127 and the release L work merge |

## 8. What could not be settled

- **How often the `enqueued_at` residue would be met** (§3.3). It needs
  a lock and an unlock for one vault within milliseconds; no
  measurement exists.
- **Whether a `no_lease` status always means "not running".**
  *0.1.1:* the silent-parent fix is merged in vettid-vault (#70, #71,
  #72, `main` 392b03c) and goes out with S11, which is not released yet.
  With it, a parent that hangs or stops sends no `Ping`, and its
  enclave locks or kills every vault within 140 s (VAULT-MESSAGING
  §12.3), before a lease of 180 s runs out; a parent that lives but
  cannot renew tells the enclave "lease lost" 15 s before the lease
  ends. So with an honest host, no live lease means no vault running,
  with two residues: the parent tells lost leases one vault at a time,
  so with hundreds of vaults the last are told late; and a dishonest
  parent can ping and renew nothing (VAULT-HOST-PROTOCOL §11.3, §13
  point 9). On releases through S10 a vault could run under a
  connected, silent parent without a live lease. `locked_basis` says
  which the answer rests on; the app treats both as locked.
- **The app side was read from the description of vettid-android #127**
  and a look at `LockGuard.kt` at 78f741a0, not from a full reading of
  the code, and #127 is open, not merged, at the time of writing (it
  has moved on since that commit). The ANDROID-PLAN text about it is
  marked draft for that reason.
- **Relay time to live.** "14 days" is VAULT-MESSAGING §13.1's figure
  for the relay's TTL; it was not checked against the relay itself,
  and the default of L11 leans on it.
- **iOS and desktop** follow the same rules; nothing of theirs was
  read.

## 9. Where the specifications and the code disagree today

| Specification | Code |
|---|---|
| §12.3: "the owner MAY set" an idle lock | No setting exists in §10.8 or in the code (F1). The sentence promised something that was never specified |
| §11.5: the parent "deletes the queue message when the enclave reports completion"; a lock's slot is `done` | The enclave reports `done` before it locks and whatever the lock did (F8) |
| MEMBER-API: the lock route answers `202` and its slot becomes `done` | Also when no instance holds the vault: the member API writes `done` itself (F8). True as far as it goes; it is not "the vault locked" |
| Account site (MEMBER-API "The account site's vault pages") | "Your vault is locked." on `done` (F9) |
| §10.2: `vault.locking` has `exp` = now + 60 s, and an app ignores one not later than its last unlock | As written; but a `vault.lock` has no such rule, which is the gap (F5, F6) |
