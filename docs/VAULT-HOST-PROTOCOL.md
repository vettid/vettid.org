---
title: VAULT-HOST-PROTOCOL
status: approved by the owner 2026-10-12 (H1–H9 as recommended)
version: 0.1.10
date: 2026-10-15
owner: Al Liebl (Mesmer)
component: vault enclave (supervisor), parent (host process)
related:
  - VAULT-MESSAGING.md (0.33.0) §2 (threat model, who sees what), §11.14 (release R: recovery and the attempt counter), §11.1, §11.5, §11.6, §12 (collect manager, shared connections, lock triggers, process isolation), §13.2, §13.3, §13.5
  - VAULT-PLAN.md (0.1.8) §5.2 (D5: TLS in the enclave), §5.3 (D4: one process per vault)
  - VAULT-RELEASES.md (0.1.16) §3.4 (C3, C4), §8.4 (network and egress), §8.7 (observability)
  - VAULT-RELAY-SCALING.md (0.1.2) §6, §10
  - vettid-vault `internal/hostproto`, `enclave/supervisor`, `enclave/egress`, `parent`, docs/V3-NOTES.md "Enclave ↔ parent", docs/SMOKE.md
changelog:
  - 0.1.10: **wording for the owner's approval**, with VAULT-MESSAGING
    0.33.0 §11.14 (recovery rebuilt; owner decisions of 2026-10-13 to
    2026-10-15); binds nothing before the vault release that
    implements it ("release R"). No new control-connection request.
    New §8.1: **the recovery attempt counter** in an S3 bucket under
    Object Lock in compliance mode, reached from the enclave over its
    own TLS through the egress like KMS: the bucket, the instance
    role's five permissions (no delete or bypass), the virtual-hosted
    name with the expected owner signed, the object names keyed with
    the vault's counter key, retention and read-back, the reading
    rules and each operation's calls. §6.6: `Stats` gains
    `heavy_kdf_free`. §6.1: the queue operation `recovery_open`, and
    the signature members of `recovery` and `recovery_cancel`, the
    lifecycle event `app_key_pending`, and a clear `reason` on
    `recovery_unavailable`. §8: the
    counter bucket's host on both allowlists. §9: the S3 timeouts.
    §11.2, §11.3, §11.4 item 4: what the parent sees of the counter
    and what it can do; a recovery started by the parent alone is
    refused, and one started with the member API's key is bounded by
    the counter. §12: P16 to P18
  - 0.1.9: **approved by the owner 2026-10-15** (vettid.org #288),
    with VAULT-MESSAGING 0.32.0, the message
    attachments of its §10.5.1 (owner decisions of 2026-10-15); binds
    nothing before the vault release that implements them ("release
    A"). No wire change. §5.2: two key rows, an attachment's content
    and thumbnail under `vaults/<vault_id>/att/`. §9: an attachment
    object is at most 8,257,577 bytes. §11.2: what the parent sees of
    them. §12: a new requirement **P15: the parent deletes every
    object under `vaults/<vault_id>/att/` after a vault is reported
    `deleted`**, because an erase without the vault's DEK cannot read
    the attachment index (VAULT-MESSAGING §12.5); it needs the host
    role to list that prefix
  - 0.1.8: as built in vettid-vault #77 (the parent only); approved by
    the owner 2026-10-14. §2: the parent closes a connection on the
    control or egress port whose peer is not its enclave's context id
    (16 as deployed) before reading from it; a development build on TCP
    answers loopback peers only. No wire change.
  - 0.1.7: correction of the document to the system as built; approved
    by the owner 2026-10-13. No wire change and no code change. §11.4
    item 4: **the enclave's PIN and password backoffs do not limit a
    parent that also replays stored objects**; the item said that a
    recovery started by the parent is guessed "online under the
    enclave's backoffs", and that the owner's devices cannot unlock
    without seeing it. Both counters are kept in objects the parent
    stores, and the owner's devices see a recovery only while the
    parent serves them the header that records it. §11.3, the
    `recovery` part of the row of operations without an envelope, says
    the same (VAULT-MESSAGING 0.29.7 §11.11.2, §11.11.6, §13.2)
  - 0.1.6: as built in vettid-vault #75 (the parent only; the enclave
    and its measurements do not change); approved by the owner
    2026-10-13. No wire change. §9: **a stored object is at most
    67,108,583 bytes**, the largest a `StoreGet` reply can carry; the
    parent answers `error` for a larger one, on read and on write (it
    read back at most 48 MiB before, a limit the table did not have).
    §13 point 12: **the parent creates its queue again** after a
    receive that finds the queue gone, and checks that the queue
    exists, with a limit of 10 s, before the first registry row after
    a disconnection (VAULT-MESSAGING 0.29.3 §11.1)
  - 0.1.5: erratum, as built at vettid-vault `main` a852e36 (#74, for
    staging release S11, not cut yet); approved by the owner
    2026-10-13. No wire change. §4.3: **a `Ping` read while the vaults
    are being locked is counted and leaves the parent unreachable**;
    the first `Ping` read after the lock tells the parent which vaults
    ended, and only then is it reachable again. A vault that appears
    under an unreachable parent is locked at the next check only if no
    `Ping` was read meanwhile; otherwise 120 to 130 s after that
    `Ping`, unless the parent becomes reachable first. §6.3 and §7.3
    follow. §12: P13 also names the `Stopped` reports; the statement
    under P10–P14 names a852e36 and what S11 is planned to carry (#66,
    #69, #70, #71, #72, #73, #74). §14: what was read
  - 0.1.4: as built at vettid-vault `main` 392b03c (#70, 93f32ca; #71,
    2daa9e4; #72, 392b03c; for staging release S11, not cut yet): **a parent that is
    connected but silent is unreachable** (owner decision H3). §4.3:
    every vault is locked 120 s after the parent's last `Ping`,
    connected or not; the lock takes 10 s at most; the vaults ended are
    reported at the next `Ping`. §3.4: a write deadline of 60 s on the
    enclave's side; `Log` records are dropped, not waited for, when the
    queue is full; the reader's wait at its limit is not silence. §6.2,
    §6.3, §7.3, §7.4, §9, §11.3 follow. **§12: five new requirements
    P10–P14**, each satisfied by that code. §13: point 1 closed; point 6
    narrowed; new points 9–13, of which 11 is closed by #72. §3.5: an
    ended connection takes no frame
  - 0.1.3: approved by the owner 2026-10-12 (vettid.org #247;
    VAULT-LOCK 0.1.0, VAULT-MESSAGING 0.29.0): what the `lock` queue operation would
    carry and answer from the vault's release L (§6.1), and what that
    changes for a dishonest parent (§11.3: nothing it could not do).
    Planned, not built: the rest of this document still describes the
    code at f3003ed and 8f2c8bf
  - 0.1.2: errata after vettid-vault #69 (main 8f2c8bf) and the
    errata of VAULT-MESSAGING 0.27.4. §6.6: `relay_vault_limit`. §7.4,
    §11.2: the log record that named a vault at its request limit is
    gone; what the remaining records that name a vault carry. §12 P5:
    its last sentence narrowed to that. §13: points 2, 3, 4 and part of
    7 closed, with where; a new point 8 (a vault process's log text
    reaches the parent with the vault id). §4.3: the row of
    VAULT-MESSAGING §12.3 under its new name. Each statement that
    differs between the two commits says which commit it describes
  - 0.1.1: approved by the owner 2026-10-12, decisions H1–H9 as
    recommended: the requirements of §12 (P1–P9) are normative; the
    open points of §13 are to be handled as decided there
  - 0.1.0: first draft, written from the code as built at vettid-vault
    `main` f3003ed (#66, for staging release S11). It describes; it
    changes nothing. Proposed requirements are in §12 and marked as
    such; open points are in §13
classification: public (no secrets; safe for github.com/vettid)
---

# The protocol between the vault enclave and its parent

## 1. Purpose and scope

A vault instance is an EC2 instance that runs a Nitro Enclave. Inside
the enclave runs the **supervisor** with one process per unlocked vault
(VAULT-MESSAGING §12.4). Outside it, on the instance, runs the
**parent**: the host process that gives the enclave its only way to the
outside (VAULT-RELEASES §8.4). The two talk over vsock.

The parent is **untrusted by design** (VAULT-MESSAGING §2.1: trusted
for availability only). This document says what crosses the boundary
between them, and what an untrusted parent can and cannot do with it.

It covers:

- the two channels and their framing (§2, §3, §8);
- the session: hello, restarts, loss of the parent (§4);
- every request and notification, with its number, direction, fields
  and limits (§5 to §7);
- timeouts, limits and ordering (§9);
- versions and unknown kinds (§10);
- trust: per kind, what the parent sees and what it can withhold,
  delay, replay, reorder or forge, and what protects the vault (§11).

It does not cover what is inside the frames where another document
already does: the queue message and the response (VAULT-MESSAGING
§11.5), the descriptor (§11.2), the stored objects (§3.3, §13.2), the
relay and push requests inside the TLS connections (RELAY-PROTOCOL,
PUSH-GATEWAY), or the channel between the supervisor and a vault
process, which never leaves the enclave (vettid-vault
`internal/vaultipc`).

**How to read it.** This version describes the protocol **as built** at
vettid-vault f3003ed (#66), which staging release S11 is to be built
from, with the two changes of 8f2c8bf (#69, also for S11): the count
`relay_vault_limit` (§6.6) and the log record it replaces (§7.4, §11.2,
§13 point 2), and with the changes of 93f32ca (#70), 2daa9e4 (#71) and
392b03c (#72), all for S11: the unreachable-parent rule and what goes with it
(0.1.4; §3.4, §4.3, §6.2, §6.3, §7.3, §7.4, §9), and with the change
of a852e36 (#74, also for S11): a `Ping` read while the vaults are
being locked (0.1.5; §4.3, §6.3, §7.3). Where the commits
differ, the text names the commit.
Statements in the present tense are what the code does. The key words MUST, MUST NOT, SHOULD and MAY (RFC 2119) appear
only where this document repeats a rule another specification already
makes, with the reference, and in §12, whose rules are normative since
0.1.1 (the code at f3003ed already satisfies each of them; P5 as
narrowed in 0.1.2 is satisfied from 8f2c8bf).

## 2. Parties and channels

| | Enclave | Parent |
|---|---|---|
| Runs | the supervisor (PID 1 of the enclave image) | `vault-parent` on the instance |
| Trusted for | the vaults sealed to its release | availability only |
| Holds | ETKs, the NSM, TLS sessions; per vault, in that vault's process only, its keys and state | the instance role's AWS credentials; the queue, the tables, the bucket; no vault key |

There are two channels, both opened **by the enclave** to the parent's
context id 3:

| Channel | vsock port | Carries | Connections |
|---|---|---|---|
| Control | 5000 | framed requests, replies and notifications (§3) | one at a time |
| Egress | 5001 | one outbound TCP stream each, after a short header (§8) | one per outbound TCP connection |

The parent listens on both ports; it never dials the enclave.
Development builds use TCP in place of vsock, with the same bytes.

Neither channel is authenticated or encrypted, on purpose: vsock
connects the enclave to its own parent instance and to nothing else,
and the parent is the party that is not trusted. A secret shared with
it would add nothing (vettid-vault docs/V3-NOTES.md).

The parent closes a connection on either port whose peer context id is not
its enclave's (16 as deployed) before reading from it; a development build
on TCP answers loopback peers only (0.1.8, as built in vettid-vault #77).
This keeps an unprivileged process on the host from taking the enclave's
place as the parent's session, from the store calls and from the egress
forwarder. It does not bind root or anyone who can run an enclave or a
guest with that context id, and it does not protect the instance role's
credentials, which the host's metadata service gives to any process on the
host. The enclave relies on none of it.

**Writes.** Every write on a vsock connection, in both directions and
on both channels, is at most **16 KiB** (16,384 bytes). Larger data is
written in pieces. The Nitro vsock transport has lost data in single
writes beyond 32 KiB.

## 3. The control connection

### 3.1 Frame

```
u32 length || kind (1) || id (8) || count (2) || count × ( u32 length || bytes )
```

All integers are big-endian. The first `length` covers everything after
itself. `count` is the number of fields; each field is a length and
that many bytes. A frame with bytes missing or bytes left over is
malformed.

| Limit | Value |
|---|---|
| Frame body (`length`) | 11 bytes (the header alone) to 64 MiB (67,108,864 bytes) |
| Fields per frame | at most 64 |
| Field | any length that fits the frame; may be empty |

A frame that breaks a limit, or is malformed, **ends the connection**
on the side that read it. There is no error frame.

Fields are byte strings. Text fields are UTF-8 or ASCII as each kind
says; numbers are decimal ASCII.

### 3.2 Requests, replies, notifications

- A **request** has a non-zero `id` chosen by its sender. Each side
  counts its own ids from 1 on each connection.
- A **reply** has kind `0x7f` and the `id` of the request it answers.
  Its first field is the **status** (§3.3); further fields depend on
  the request. A reply to an id that is not waiting (never sent,
  already answered, or given up after its timeout) is dropped without
  an error.
- A **notification** is a frame with `id` 0. It gets no reply. Any
  frame with `id` 0 that is not a reply is handled as a notification,
  whatever its kind.

Both sides send requests on the same connection, each with its own id
space.

### 3.3 Status

The first field of every reply:

| Status | Meaning |
|---|---|
| `ok` | done; the kind's reply fields follow |
| `not_found` | the object does not exist (store requests) |
| `conflict` | a conditional write or delete found another version (store requests) |
| `invalid` | the request was not understood: an unknown kind, or the wrong number or form of fields |
| `error` | understood but not done (a backend failure; the enclave before its instance has started) |

A handler that returns nothing is answered `invalid` by the connection
layer. That is how a kind the receiver does not know is answered
(§10). A reply with no fields at all is treated by the caller as a
failed call. Any status but the ones a caller expects is a failure.

### 3.4 Concurrency and order

- **One reader, one writer** per side. Frames are written whole, one
  after another, in the order they were queued.
- **Requests are handled concurrently**, each on its own thread of
  execution, at most **128 at a time per connection and direction**.
  When 128 requests of the peer are being handled, the receiver stops
  reading the connection until one ends. It then reads nothing:
  further requests, notifications and **replies to its own requests**
  all wait (§13, point 6). The enclave does not count the time its
  own reader waits there as the parent's silence (§4.3), for up to
  120 s of it between two pings (93f32ca).
- **Notifications are handled in the order they were sent**, on the
  reader, before the next frame is read.
- **Replies** may arrive in any order.
- A notification queued before a reply is written before it. The
  enclave relies on that: the lifecycle events of a queue request
  (§7.2) are queued before the request's reply, so the parent has them
  first (VAULT-MESSAGING §11.5).
- **Outgoing frames** wait in a queue of 256.
  - *The enclave's side (93f32ca).* A frame that is not written within
    **60 s** ends the connection. When the queue is full, a `Log`
    record is **dropped and counted**, never waited for; the count is
    sent later in a record of its own (§7.4). Every other sender
    (`Lifecycle`, `Stopped`, `Descriptor`, requests, replies) waits
    until the writer has written one, so for 60 s at most. Nothing the
    parent acts on is dropped while the connection lives.
  - *The parent's side.* A sender blocks until the writer has written
    one. Its writes have no deadline.
  - Before 93f32ca neither side had a deadline and every sender
    waited, logging included.

### 3.5 The end of a connection

A read or write error, a malformed frame or a close ends the
connection. Every call still waiting on it fails; frames still queued
are dropped. An ended connection accepts no further frame, also when
its queue has room, and a wait for queued frames to be written
(a flush) reports success only if they were written to a connection
that has not ended (392b03c; before, a frame could be queued onto an
ended connection and a flush could report it written). Requests are never re-sent by this layer. What each side
does next is §4.

## 4. The session

### 4.1 Hello

The enclave dials the control port and sends `Hello` (§5.1) as its
first request. It carries the enclave's release (its PCR0) and a
**boot id**: 16 random bytes as 32 hex characters, made once when the
supervisor starts. The parent answers with the **instance id** and a
**mode**:

| Mode | When the parent sends it | What the enclave does |
|---|---|---|
| `fresh` | the parent has seen no enclave since it started | if it runs vaults, it locks every one before it serves (the new parent holds no leases for them; VAULT-MESSAGING §12.3 "Parent restart") |
| `resume` | otherwise | carries on |
| `selftest` | the parent was started for the hardware self-test (§6.5) | if it has never been given an instance id and has started no instance: enters self-test mode. Otherwise the mode is ignored |

The enclave waits 30 s for the answer. A hello that fails (no answer, a
status other than `ok`, not exactly three fields, an instance id that
is not 1 to 48 characters of `[A-Za-z0-9_-]`) closes the connection,
and the enclave dials again after 200 ms, doubling to 5 s.

**The parent names the instance.** The instance id comes from the
parent (in production, the EC2 instance id) and goes into the
enclave's attested descriptors (VAULT-MESSAGING §11.2). The enclave
keeps the first id it is given. If a later hello names another, the
enclave **exits**: its descriptors would be wrong.

**What the parent does with a hello.** It makes the connection the
enclave's session, closing any earlier one. If the boot id differs from
the last one it saw, the enclave restarted and its vaults are gone with
its memory: the parent drops its record of running vaults and releases
their leases.

### 4.2 After the hello

The enclave starts its instance (the ETKs), sends its descriptor
(§7.1), and serves. Until the instance has started it answers every
request but `Selftest` with `error`.

The parent forwards queue messages only while an enclave is connected
and has sent a descriptor.

### 4.3 Loss

- **The connection ends.** The enclave notes the time and dials again
  (200 ms, doubling to 5 s, for as long as it runs). Calls to the
  parent fail at once while there is no connection. After each
  successful hello it sends its current descriptor again. The parent
  deletes the instance's registry row at once, so the member API stops
  routing to it.
- **No `Ping` for 120 s: the parent is unreachable** (93f32ca;
  VAULT-MESSAGING §12.3 "Parent unreachable for 120 s"). Through
  8f2c8bf the enclave measured the time without a connection, and a
  parent that stayed connected and silent was never unreachable (§13
  point 1). Now:
  - **One clock:** the time since the parent's last `Ping` (§6.3),
    counted when the enclave reads the request, before it answers. A
    new connection, a hello or any other frame does not restart it.
  - **Checked every 10 s, while a vault runs.** With no vault running
    there is nothing to lock and the count restarts at each check, so
    a vault opened later has the whole 120 s. More than 120 s without
    a `Ping`: the parent is unreachable. The decision so falls 120 to
    130 s after the last `Ping`.
  - **Then, at once:** the enclave makes **no call to the parent**
    until its next `Ping` is read, whether or not there is a
    connection (calls fail immediately); it closes the connection it
    has (it dials again as usual, and a hello changes nothing); and it
    locks **every vault in parallel**. A vault process that has not
    locked after **10 s** is killed. Every vault has locked or been
    killed at most 140 s after the last `Ping` (a vault that appears
    afterwards: see the next point but one).
  - **What a vault loses:** nothing that was stored. Its final flush
    fails at once (no call is made); its last durable state is its
    last successful write, and nothing taken from the relay since was
    acked. A failed flush is not a conflict: nothing is zeroized as a
    split brain. A vault that is killed sends its devices no
    `vault.locking`.
  - **It stays unreachable until it pings and has been told** (next
    point), also when no vault runs. A vault that appears meanwhile
    (an unlock that was half way) is locked at the next check,
    provided no `Ping` was read since the parent was found
    unreachable. A `Ping` that is read and leaves the parent
    unreachable (read while the vaults were being locked, or its
    reports could not be written) still restarts the one clock: such a
    vault is then locked 120 to 130 s after that `Ping`, unless a
    later `Ping` makes the parent reachable first. Until then every
    call it makes to the parent fails.
  - **The parent is told which vaults ended, and is reachable again
    only then** (392b03c; a852e36). When a `Ping` is read, it is
    counted first. A `Ping` read while the vaults are still being
    locked or killed (up to 10 s, and until each has been recorded as
    ended) is only counted: there is nothing to tell yet and the
    parent stays unreachable. That is the usual case for the first
    `Ping` on the new connection, which a live parent sends as soon as
    it has the descriptor. At the first `Ping` read after that, the
    enclave sends one `Stopped` (§7.3) for
    each vault it locked or killed (`locked`, `split_brain`, or
    `error` for a killed one) and waits until they have been
    **written** to the connection. Only if they were written, and that
    connection is still the current one, are calls to the parent let
    through again.
    - Otherwise every report is kept, the parent stays unreachable,
      and the `Ping` of the next connection tries again.
    - A report may so reach the parent twice. That is harmless: no
      vault can open while the parent is unreachable, so the second is
      a report for a vault the parent no longer counts as running.
    - A report for a vault that runs again by then is not sent.
    - Vaults that ended while the reports were being written keep the
      parent unreachable until the following `Ping` reports them.
    - The `Ping`'s reply waits while the reports are written. At
      recovery the parent's `Ping` call (5 s) can therefore time out,
      and the parent then skips that tick's registry write (§6.3).
    - Written is not read: a connection that ends after the write and
      before the parent has read the frame still loses the report
      (§13 point 10).
    - At 2daa9e4 the reports were only queued, and a `Ping` handled
      while its connection ended could lose one, or let a call through
      before one was sent (§13 point 11).
    - At 392b03c a `Ping` read while the vaults were being locked
      found no report to write and made the parent reachable, so a
      call could go through before the parent had been told anything
      (corrected in a852e36, #74).
  - **The reader's own wait** at its 128-request limit (§3.4) is not
    counted as silence, up to 120 s between two pings: a `Ping` the
    parent sent would be waiting unread.
  - **Warning.** After 60 s without a `Ping` while a vault runs the
    enclave logs once (§7.4).
  - A `Ping` shows that the peer of the socket is alive, not that
    leases are renewed; the enclave cannot see the lease table (§11.3).
- **The parent shuts down** (SIGTERM). It sends `Shutdown` (§6.4),
  waits up to 60 s for the enclave to lock every vault, deletes the
  registry row and the queue, and closes.

## 5. Requests from the enclave to the parent

The enclave waits 30 s for the answer to `Hello` and 60 s for each of
the others. Field sizes are bounded only by the frame unless a limit is
given.

### 5.1 `Hello` (0x01)

| | Fields |
|---|---|
| Request | `release` (PCR0: 96 lowercase hex characters), `boot_id` (1 to 64 bytes; the enclave sends 32 hex characters) |
| Reply `ok` | `instance_id`, `mode` (`fresh`, `resume` or `selftest`) |
| Reply `invalid` | the fields are not as above |

See §4.1.

### 5.2 `StoreGet` (0x02)

| | Fields |
|---|---|
| Request | `key` |
| Reply `ok` | `data`, `version` |
| Other replies | `not_found`; `invalid` (key refused); `error` |

Reads one object of the vault data bucket. `version` is an opaque
token of the stored object (the S3 ETag), 1 to 256 bytes; the enclave
refuses an `ok` reply whose version is outside that or that does not
have exactly these fields.

**Keys.** At most 256 bytes; segments separated by `/`, none empty,
`.` or `..`; characters `a-z`, `0-9`, `.`, `_`, `-` only. The parent
serves only keys under `vaults/` and `users/` and answers `invalid`
for any other. The enclave uses:

| Key | Object |
|---|---|
| `vaults/<vault_id>/state` | the vault's state, encrypted under its DEK |
| `vaults/<vault_id>/header/<pcr0>` | the header sealed to that release (VAULT-MESSAGING §11.10.2) |
| `vaults/<vault_id>/att/<att_id>` | (0.1.9, release A) an attachment's content, encrypted under its own key, which only the vault's state holds (VAULT-MESSAGING §10.5.1). `att_id` is a ULID written in lower case, as keys allow |
| `vaults/<vault_id>/att/<att_id>.t` | (0.1.9, release A) the same attachment's thumbnail |
| `users/<hex SHA-256 of the member's user_guid, labelled>/vault` | which vault the member enrolled; holds only a `vault_id` |
| `smoke/<run id>/object` | the self-test only, with a parent started for it (§6.5) |

Inside the enclave the supervisor lets a vault process reach only its
own `vaults/<vault_id>/` objects and its member's index object
(VAULT-MESSAGING §12.4).

### 5.3 `StorePut` (0x03)

| | Fields |
|---|---|
| Request | `key`, `data`, `if_match` |
| Reply `ok` | `version` (of the object as written) |
| Other replies | `conflict`; `invalid`; `error` |

`if_match` empty: create only (the write fails with `conflict` if the
object exists). Otherwise: write only if the stored object's version
equals `if_match`.

The enclave never abandons a `StorePut` or `StoreDelete` half way: it
waits the full 60 s for the reply even if the vault that asked is
being locked. A write whose outcome it never learns makes the vault's
next write conflict with its own, and a conflict on the state object is
the split-brain guard: the vault is zeroized without a flush
(VAULT-MESSAGING §12.3).

### 5.4 `StoreDelete` (0x04)

| | Fields |
|---|---|
| Request | `key`, `if_match` |
| Reply | `ok`; `not_found`; `conflict`; `invalid`; `error` |

### 5.5 `Credentials` (0x05)

| | Fields |
|---|---|
| Request | none |
| Reply `ok` | `access_key_id`, `secret_access_key`, `session_token`, `expiration` (RFC 3339, or empty) |
| Other replies | `error` |

The instance role's temporary AWS credentials, which the parent has
from the instance metadata service. The enclave signs its own KMS
requests with them (SigV4) and sends those over TLS that it terminates
(§8, VAULT-MESSAGING §11.10.7). It keeps them until 5 minutes before
`expiration` and asks again once when KMS says they are expired or
unknown.

## 6. Requests from the parent to the enclave

### 6.1 `Queue` (0x10)

| | Fields |
|---|---|
| Request | `message` (one queue message, VAULT-MESSAGING §11.5, byte for byte as the parent received it), `manifest` (the served manifest document an enroll or unlock names by hash, or empty) |
| Reply `ok` | `response` (the enclave's answer, VAULT-MESSAGING §11.5; **empty** when the message did not parse or its handling failed inside the enclave) |
| Reply `invalid` | not exactly two fields |

- The enclave handles **one queue message at a time**; further ones
  wait. The parent sends at most **8** at a time and waits **100 s**
  for each.
- The enclave reads a message of at most 24,576 bytes and a manifest
  document of at most 90,112 bytes (a larger document is treated as
  none). The parent reads the routing members (`v`, `op`, `vault_id`,
  `request_id`, `manifest_sha256`) of a message of at most 32,768
  bytes, to take the lease and to answer the response slot; it does not
  look inside the envelope.
- Lifecycle notifications (§7.2) that the message causes are sent
  before the reply.
- With no reply (a timeout, a lost connection) the parent leaves the
  message on the queue; a redelivery of a sealed request is caught by
  the replay set, or answered `etk_unknown` after an enclave restart
  (VAULT-MESSAGING §11.6, §11.9).
- **The `lock` operation, as built (through 8f2c8bf).** The enclave
  sets the response's status to `done` before it locks and discards
  what the lock did; the response carries no code. Nothing protects a
  `lock` against redelivery or late delivery: one that waited in the
  queue (up to its 5 minutes) is carried out when it arrives, also
  after an unlock that was queued later.
- **The `lock` operation from release L (0.1.3; decided, not built:
  VAULT-MESSAGING 0.29.0 §11.5).** The message may carry `unlock_id`.
  With it, the vault's process locks only if the value names its
  current unlock; without it, the enclave locks only if the message's
  `enqueued_at` is later than that of the message that opened the
  vault, which it keeps with the running vault. The response is made
  **after** the lock and carries `code`: `locked`, `not_running` or
  `stale`. The parent copies those three codes into the slot of a
  `lock` and of no other operation. The parent of a release before L
  writes no code; each release runs its own parent (§10).
- **Recovery from release R (0.1.10; wording for the owner's approval:
  VAULT-MESSAGING 0.33.0 §11.5, §11.14).** A new operation
  `recovery_open` carries a sealed envelope like `recovery_register`
  (the parent leases nothing for it and treats it as it treats a
  register). `recovery` and `recovery_cancel` carry `signed_at`,
  `key_id` and `sig`, which the enclave verifies before anything else
  and the parent passes on unread. The parent copies `recovery_attempt`
  (with `retry_at` and `expires`) from a `recovery_open` answer into its
  slot, `not_before`, `expires` and `earliest` from a `recovery` answer,
  and a `recovery_unavailable`'s clear `reason`, as it copies
  `recovery_registered`. It writes the lifecycle event `app_key_pending`
  (sent with the first header write of a replacement of the app) as the
  row's `app_key_pending`, and clears it when `app_key` reaches its
  `seq` (VAULT-MESSAGING §11.5, §11.14.2).

### 6.2 `LeaseLost` (0x11)

| | Fields |
|---|---|
| Request | `vault_id` |
| Reply | `ok` (also when that vault is not running); `invalid` |

The enclave locks the vault (VAULT-MESSAGING §12.3 "Lease lost"). The
parent sends it when a lease renewal finds another holder, or renewals
keep failing until 15 s before the lease ends. It waits 60 s.

*93f32ca, 2daa9e4:* a renewal that gets **no answer** now counts as
failed, after 10 s and never later than 15 s before the lease ends
(before, it waited for ever and nobody was told). Once one renewal of
a pass was given up, the rest of the pass makes no call and judges
each lease by its age alone. While renewals fail the next pass comes
after 5 s, not 60. `LeaseLost` is still sent **one vault at a time**,
each waiting for its lock (§13 point 9).

### 6.3 `Ping` (0x12)

| | Fields |
|---|---|
| Request | none |
| Reply `ok` | `count`: the number of vaults running, decimal |

The parent sends it every 20 s, and once whenever a descriptor
arrives (§7.1), before it writes the instance's
registry row, and waits 5 s. The registry write that follows has 10 s
(93f32ca; before, a table that did not answer stopped the pings that
follow). The enclave counts each `Ping` it reads on the one clock of
§4.3; nothing else counts. (0.1.5: a parent that was found unreachable
is reachable again only when §4.3 says so, not at every `Ping`
read.) Without an `ok` it does not write the
row, so an instance whose enclave does not answer stops being routed
to (the row's heartbeat goes stale, VAULT-MESSAGING §11.1). `count`
becomes the row's `load`.

### 6.4 `Shutdown` (0x13)

| | Fields |
|---|---|
| Request | none |
| Reply | `ok`, once every vault is locked |

The enclave locks every vault, one after another, each with its final
flush and `vault.locking` (VAULT-MESSAGING §12.3 "Enclave release or
restart"). The enclave itself keeps running.

### 6.5 `Selftest` (0x14)

| | Fields |
|---|---|
| Request | `request` (JSON, at most 4,096 bytes: a run id, a test KMS key with its account and region, optionally capacity parameters) |
| Reply `ok` | `report` (JSON) |
| Reply `invalid` | not in self-test mode, already run once, or a malformed request |

The hardware self-test (vettid-vault docs/SMOKE.md; VAULT-RELEASES
§8.2, §8.3). It is answered only by an enclave that entered self-test mode at
its first hello (§4.1), and only once. Such an enclave starts no
instance: it has no ETK and serves no vault, and it stops after the
report. The test takes an attestation, reaches the relay's health
route and the attestation status list through the egress, reads the
test key's policy from KMS and runs the key-policy check on it, starts
a vault process that round-trips a data key under the test key, writes
and deletes `smoke/<run id>/object` through the store requests, and
reports memory figures. The report holds results and sizes, **no
secret**; the attestation it takes has `user_data` under its own label
(`vettid/vms/2/selftest`), so it can never pass for a descriptor's or
a vault's.

### 6.6 `Stats` (0x15)

Added by vettid-vault #66 (staging release S11).

| | Fields |
|---|---|
| Request | none |
| Reply `ok` | pairs of `name`, `value`: the names below, each once; values decimal |

| Name | Kind | Meaning |
|---|---|---|
| `relay_conns` | gauge | open connections to the relay |
| `relay_dialed` | counter | connections to the relay opened |
| `relay_streams` | gauge | concurrent streams per connection, as the relay announced (0: not known) |
| `relay_in_flight` | gauge | relay requests on a stream or waiting for one |
| `relay_waiting` | gauge | of those, waiting for a stream |
| `relay_wait_max_ms` | gauge | the longest wait for a stream in the current minute and the one before, milliseconds |
| `relay_errors` | counter | relay requests that got no answer (not counted: a request its vault process gave up) |
| `relay_refused_max_conns` | counter | requests that waited because the bound on connections forbade another (VAULT-MESSAGING §12.2.1) |
| `relay_refused_min_streams` | counter | requests that waited because the relay announced too few streams for another connection |
| `relay_vault_limit` | counter | **from 8f2c8bf (0.1.2):** vault processes that reached their own limit of 8 relay and push requests in flight (VAULT-MESSAGING §12.2.1 "Per vault"), each counted once, however often it is at the limit. Not in the reply at f3003ed |
| `heavy_kdf_free` | gauge | **(0.1.10, release R)** 1 if the instance could give a permit for the heavy key derivation of a recovery wrap now (VAULT-MESSAGING §11.14.3), else 0. The parent writes it into the registry row with its metrics, and the member API prefers such an instance for a recovery open |

- Counters count from the enclave's start. Gauges are summed over the
  relay hosts (one, in a release), except `relay_streams` (the
  smallest) and `relay_wait_max_ms` (the largest).
- **For the whole instance only.** Nothing in the reply names a vault,
  a mailbox or an address, and no count is kept per vault.
- **A snapshot.** The enclave renews the answer at most **once a
  second**; asked more often, it gives the same answer again. Asking
  changes nothing in the enclave.
- The parent asks once a minute, waits 5 s, and takes only the names it
  knows, as numbers; anything else in the reply is dropped. It writes
  them into its metrics record (VAULT-RELEASES §8.7). Without an `ok`
  the record is written without them.

## 7. Notifications from the enclave to the parent

The parent sends no notifications. The enclave has no handler for
them: a frame with `id` 0 from the parent is dropped.

A notification the parent cannot use (wrong number of fields, a value
out of its bounds, a kind it does not know) is dropped without an
error.

### 7.1 `Descriptor` (0x20)

Fields: `release` (PCR0, 96 hex), `descriptor` (1 to 4,096 bytes),
`attestation` (1 to 32,768 bytes); VAULT-MESSAGING §11.2.

Sent after every hello, and whenever the descriptor changes (an ETK
rotation; checked every 10 s). The parent keeps the latest and
publishes it in the instance's registry row with the next heartbeat.

### 7.2 `Lifecycle` (0x21)

Fields, eleven: `event`, `vault_id`, `release`, `vault_version`,
`state_version`, `app_key`, `app_key_seq`, `credential_backup`,
`name_seq`, `first_name`, `last_name` (VAULT-MESSAGING §11.5).

| Field | Form |
|---|---|
| `event` | `enrolled`, `unlocked`, `locked`, `moved`, `deleted`, `app_key`, `credential_backup`, `account_name`, `alarm.credential_clone` |
| `vault_id` | 1 to 128 characters of `a-z`, `0-9`, `-`, `_`, `.` |
| `release`, `vault_version` | 96 lowercase hex characters |
| `state_version` | decimal |
| `app_key`, `app_key_seq` | the app key's public key (SPKI DER, at most 256 bytes) and its count (decimal, from 1); empty and `0` when not reported |
| `credential_backup` | `1`, `0`, or empty (not reported) |
| `name_seq`, `first_name`, `last_name` | `0`, empty, empty, except for `account_name`: a count from 1 and two names of 1 to 160 bytes |

The parent also accepts the first five, seven or eight fields alone,
as enclaves before VAULT-MESSAGING 0.15.0, 0.16.0 and 0.18.0 sent
them.

The parent keeps its set of running vaults from these (`unlocked` adds
a vault; `locked` and `deleted` remove it), renews the leases of that
set, and writes each event to the vault table in the order received
(VAULT-MESSAGING §11.5).

### 7.3 `Stopped` (0x22)

Fields: `vault_id`, `reason`.

A vault's process ended on its own. Reasons: `locked`, `moved`,
`deleted`, `idle` (expected endings); `split_brain`; `error`. The
parent removes the vault from its running set, releases its lease if
it held one, and counts split brains.

*93f32ca:* the enclave also sends `Stopped` for each vault it locked or
killed while the parent was unreachable, at the parent's next `Ping`
(§4.3): `locked`, `split_brain`, or `error` for a killed process.
*392b03c:* such a report is kept until it has been written to a
connection that is still the current one, so the parent may receive
one twice; a report whose vault runs again is not sent.
*a852e36:* the reports are not sent at a `Ping` read while those
vaults are still being locked or killed, but at the first `Ping` read
after that (§4.3).
*2daa9e4:* the parent does not release the lease on a `Stopped` while
an enroll or unlock of that vault is under way (the request took the
lease; if it does not open the vault, it gives the lease back).

### 7.4 `Log` (0x23)

Fields: `level`, `message`, then pairs `key`, `value`.

The enclave's log records (VAULT-MESSAGING §13.6; VAULT-RELEASES
§8.7). A release enclave has no console, so this is its only log. The
enclave sends at most 31 pairs; the parent logs at most 16, with the
message and each value cut to 200 bytes, marked `source=enclave`.

The supervisor logs fixed messages with ids, counts, reasons and error
classes: never keys, PINs, tokens, envelopes, plaintext or mailbox
ids. Some records name a vault by its `vault_id`. At 8f2c8bf they are
exactly these, and each reports how a vault's run **ended**:

| Record | Carries, with the `vault_id` |
|---|---|
| "vault locked", "vault locked; final flush failed", "vault locked without final flush: newer state written elsewhere" | the trigger (`lease_lost`, `shutdown`, `vault_cap`, `memory_pressure`); for a failed flush the class of the error |
| "vault process ended" | the reason (as in `Stopped`, §7.3) and the exit code |
| "vault: …" | **whatever the vault's own process logged**, passed on by the supervisor with the vault's id: the message cut to 120 bytes and up to 8 pairs. A vault process logs two things today: "split brain: newer state written elsewhere; zeroized without flushing", and "vault run loop ended" with the first 80 bytes of the error that ended it. Only an error of the vault's start or of a state write ends the loop on its own; a relay error is retried and never does (§13 point 8) |

At f3003ed there was one more, "vault at its limit of concurrent relay
requests; further ones wait", with the `vault_id`. 8f2c8bf removed it
(§13 point 2).

*New records (93f32ca), none naming a vault:*

| Record | Pairs | When |
|---|---|---|
| "no ping from the parent: every vault is locked if none comes" | `silent_s`, `limit_s`, `vaults` | once, at the first check after 60 s without a `Ping` while a vault runs |
| "parent unreachable: locking every vault" | `vaults` | when the parent is found unreachable |
| "parent unreachable: every vault locked" | `vaults`, `killed` | when the lock has ended |
| "log records dropped: the parent was not reading" | `count` (since the enclave's start) | when the count has grown and a record can be sent |
| "control connection takes no write timeout" | `error` | once, if the socket refuses a write deadline (the 60 s then bound nothing) |

The parent's own log gains "heartbeat took longer than its interval"
(`ms`, `interval_ms`) when a `Ping` and its registry write take more
than the heartbeat interval.

## 8. Egress connections

For each outbound TCP connection the enclave opens a new connection to
the egress port and sends:

```
version 0x01 || len (1) || host (len bytes) || port (2, big-endian)
```

`host` is 1 to 253 bytes (the parent reads up to 255). The parent
answers **one byte**:

| Byte | Meaning |
|---|---|
| `0x00` | connected: from here on the connection carries the TCP stream to `host:port`, unchanged, both ways |
| `0x01` | refused: the port is not 443, or `host` is not on the parent's allowlist |
| `0x02` | failed: the parent could not connect |

After `0x01` or `0x02` the parent closes. A header with another
version, or with `len` 0, is closed without an answer.

- **Timeouts.** The parent waits 10 s for the header and 10 s for its
  own connect. The enclave waits 15 s from sending the header to the
  answer byte.
- **End.** When either side ends its half of the stream, the parent
  passes that on (half close) and closes when both halves have ended.
- **Allowlists, twice.** The parent's: exact host names, port 443
  only: the relay, `kms.<region>.amazonaws.com`,
  `android.googleapis.com`, and both push gateways
  (VAULT-RELEASES §8.4); (0.1.10, release R) also the recovery
  counter bucket's virtual-hosted name (§8.1). The parent resolves the name; the enclave
  cannot choose an address. The enclave's own: the same hosts for its
  channel, fixed in the measured image; it asks for no other.
- **TLS is the enclave's.** Inside the stream the enclave runs TLS 1.3
  only, against the roots pinned for that host and no others, checks
  the host name, requires HTTP/2 (ALPN `h2`) of the hosts it shares
  connections to, and follows no redirects (VAULT-PLAN §5.2;
  VAULT-MESSAGING §12.2). The parent carries ciphertext.
- **How many.** The enclave decides how many connections each host
  gets (VAULT-MESSAGING §12.2.1): for an HTTP/2 host one until its
  streams are in use, at most 16, up to 32 for 30 s at most once in 5
  minutes; for KMS (HTTP/1.1) at most 16 keep-alive connections. The
  parent does not limit their number.
- The parent counts the connections it has open and has opened, by
  destination class (relay, KMS, push, other), for its metrics.

### 8.1 The recovery attempt counter (0.1.10, release R)

*Wording for the owner's approval, with VAULT-MESSAGING 0.33.0
§11.14.4. Normative from release R; it binds nothing before.*

The enclave keeps the recovery attempt counter of VAULT-MESSAGING
§11.14.4 as objects in an S3 bucket under Object Lock in compliance
mode. It reaches S3 like KMS: over an egress connection (§8) on which it
runs its own TLS, signing its own requests (SigV4) with the instance
role's credentials (§5.5). The parent carries the ciphertext and takes
no part. **The counter is not in the data bucket and never goes through
`StoreGet`, `StorePut` or `StoreDelete`.**

**The bucket.** One per channel, in the vault's AWS account (production:
the vault production account; staging: the staging account), named in
the release constant `recovery_counter` `{bucket, account, region}`
(VAULT-MESSAGING §11.10.8): Object Lock enabled, versioning enabled (it
cannot be suspended once Object Lock is on), Block Public Access fully
on, **no default retention** and no lifecycle rule that expires current
versions (VAULT-RELEASES §8.2). The enclave never relies on a bucket
setting: it sets and reads back the lock of every object it writes.

**The instance role** may call, on that bucket only: `s3:PutObject`,
`s3:PutObjectRetention`, `s3:GetObjectVersion`,
`s3:GetObjectRetention` and `s3:ListBucketVersions`. It has no delete,
bypass-governance or legal-hold permission, and no permission on the
bucket's configuration. The parent holds the same credentials (§5.5) and
can therefore make the same calls; what it can do with them is in §11.3.

**Every call** goes to the bucket's virtual-hosted name
(`<bucket>.s3.<region>.amazonaws.com`, on both allowlists of §8), with
`x-amz-expected-bucket-owner` set to the pinned account and signed, so
that the signature covers the bucket name and the owner. The enclave
refuses an access-point or other alias and follows no redirect.

**Object names.** All names of a vault share one prefix and are keyed
with the vault's `recovery.counter_key` (from its sealed header), so
that nobody outside an enclave of the vault's release can compute a
name before it is first written:

```
vault_tag = hex(first 16 bytes of HMAC-SHA-256(counter_key, "vettid/vms/2/counter/vault" || 0x00 || vault_id))
mac(kind, g, n) = hex(first 16 bytes of HMAC-SHA-256(counter_key,
                  "vettid/vms/2/counter/name" || 0x00 || vault_id || 0x00 || g (8, big-endian)
                  || 0x00 || kind || 0x00 || n (8, big-endian)))

recovery/v1/<vault_tag>/present-<mac("present", 0, 0)>                 the present marker (one key, many versions)
recovery/v1/<vault_tag>/g<g, 16 hex>/t<nn>-<mac("t", g, n)>            the token of attempt n (nn = 01 … 10)
recovery/v1/<vault_tag>/g<g, 16 hex>/w<nn>-<mac("w", g, n)>            the wait record after attempt n
recovery/v1/<vault_tag>/g<g, 16 hex>/s<nn>-<mac("s", g, n)>            the success record of attempt n
recovery/v1/<vault_tag>/g<g, 16 hex>/c-<mac("c", g, 0)>                the close record of generation g
```

`kind` is the ASCII string shown. An entry under a vault's prefix whose
name does not match a name the enclave computes is ignored. Each body
is 32 fresh random bytes. The vectors are in VAULT-MESSAGING §16.

**Retention.** Every object is written with
`x-amz-object-lock-mode: COMPLIANCE` and a retain-until date: tokens,
success and close records **100 years** from the write; a wait record
the counter time of the attempt's listing plus `W(n)`; a present marker
version **96 hours**. After every write the enclave reads the lock of
the version it wrote back (`GetObjectRetention` by version id) and goes
on only if the mode is `COMPLIANCE` and the date is not earlier than the
one asked for. It never treats "mode is `COMPLIANCE`" alone as locked:
a lock whose date has passed still reads `COMPLIANCE`.

**Reading.** The enclave decides from **complete versions listings**
only (`ListObjectVersions` with a prefix, following the markers to the
end; every version and every delete marker counts), never from
`HeadObject`, `GetObject` or `ListObjectsV2` without a version id. The
counter's time of a listing is the `Date` header of its last page; the
time of a record is its `LastModified`.

- *A name is used* if the listing holds any version or delete marker
  with exactly that name.
- *The present time* is the greatest `LastModified` over every entry of
  the marker's name. No entry means no present record (refused, not
  "never present").
- *A wait is running* while any version of a wait record's name is
  locked by the listing's time, unless the attempt has a success record;
  and, binding, while any attempt without a success record is younger
  than its `W(n)` (VAULT-MESSAGING §11.14.6).

**The operations** of VAULT-MESSAGING §11.14.4:

| Operation | Calls |
|---|---|
| `Status`, `Confirm` | One complete versions listing of `recovery/v1/<vault_tag>/` (the marker and every generation). `Confirm` is sent only after `Spend`'s step 4 below has answered |
| `Spend(g, n)` | (1) The listing, and a refusal from it: closed, used up, or a wait running by its time. (2) `PutObject` of token `n` with `If-None-Match: *`, the lock headers and a random body. `200` with a version id: go on; `412`: answer `wait`, and **never try another name**; any other answer (`409`, `5xx`, a timeout): the outcome is unknown, go on without a version id and never write that name again. (3) A complete versions listing of the token's name: go on only if there is **exactly one** entry, a version and not a delete marker, and it is the enclave's own (its version id from step 2, or, without one, `GetObject` by that version id returns the enclave's random body). (4) The lock read back. (5) The wait record `w<nn>`, written and read back the same way (create-only; `412` means another caller's, which is fine). Any step after (2) that does not end in "exactly one, mine, locked" is `lost`. Then `spent`, with `at` = the token's `LastModified` |
| `Succeed(g, n)` | Create-only write of `s<nn>`, lock read back |
| `Close(g)` | Create-only write of the close record (`412`: closed already), lock read back. Any entry under that name means closed |
| `MarkPresent` | One `PutObject` (not multipart, never a copy) of a new version of the marker, lock read back; `recorded{at}` with its `LastModified` |

- A conditional create can succeed over a delete marker, so the listing
  after the write, not the condition, is the safeguard. A write answered
  with an error may have been stored. A multipart upload or a replica
  can carry a time earlier than its arrival, which can only make a
  record look older; that is why the newest time is taken for presence
  and why no rule uses "the earliest version wins".
- **Timeouts.** Each S3 request: 15 s for the answer's headers and 30 s
  in all; the enclave does not retry a `Spend` by itself (a retry is the
  member's next open). The 60-second and 10-minute limits of
  VAULT-MESSAGING §11.14.6 are judged as written there.
- **Cost.** About five requests per attempt and two per owner check:
  at 100,000 vaults, a few hundred US dollars a year, dominated by the
  daily present marker (estimate).

## 9. Timeouts and limits, in one place

| What | Value | Who enforces |
|---|---|---|
| Single write on vsock | 16 KiB | both |
| Frame body | 64 MiB | both, on read and on write |
| Fields per frame | 64 | both |
| Requests of the peer handled at once | 128 per connection | both |
| Outgoing frames queued | 256 | both |
| Hello answer | 30 s | enclave |
| Reconnect | 200 ms, doubling to 5 s | enclave |
| Any enclave request (store, credentials) | 60 s | enclave |
| Parent unreachable: lock every vault | 120 s without a `Ping`, checked every 10 s (through 8f2c8bf: without a connection) | enclave |
| Lock of every vault, then kill | 10 s | enclave |
| Frame write, enclave → parent | 60 s, then the connection ends | enclave |
| `Queue` answer | 100 s | parent |
| `Queue` requests at once | 8 sent (parent); 1 handled (enclave) | each |
| Queue message read | 24,576 bytes (enclave); 32,768 bytes (parent, routing members) | each |
| Manifest document | 90,112 bytes | both |
| `Ping`, `Stats` answer | 5 s | parent |
| `LeaseLost`, `Shutdown` answer | 60 s | parent |
| `Stats` answer renewed | at most once a second | enclave |
| Heartbeat (`Ping`, then the registry row) | every 20 s | parent |
| Registry row write | 10 s | parent |
| Lease renewal without an answer; the next pass after a failed one | 10 s (never later than 15 s before the lease ends); 5 s | parent |
| Metrics (`Stats`, then the record) | every 60 s | parent |
| Lease | 180 s, renewed every 60 s | parent |
| Store key | 256 bytes, the characters of §5.2 | both; the prefixes by the parent |
| Store version | 1 to 256 bytes | enclave |
| Stored object (`data` of a `StoreGet` reply and of a `StorePut`) | 67,108,583 bytes: the frame body less 281 (a reply's kind, id and field count, three field lengths, the status and a 256-byte version) | parent; a larger object is answered `error`, on read and on write |
| Attachment object (0.1.9, release A) | 8,257,577 bytes: 41 plus the padded plaintext of the largest content (VAULT-MESSAGING §5.5, §10.5.1), so no larger than the relay's `max_blob_bytes`; a thumbnail at most 34,857 | enclave (it writes no larger one); within the stored-object limit above |
| Descriptor, attestation | 4,096 and 32,768 bytes | parent |
| Log record | 16 pairs, 200 bytes a value | parent |
| Egress header, connect, answer | 10 s, 10 s (parent); 15 s (enclave) | each |
| Egress destination | the allowlist, port 443 | both |
| Recovery counter request (0.1.10, release R) | 15 s to the answer's headers, 30 s in all; no retry of a `Spend` | enclave |

## 10. Versions and unknown kinds

The control protocol has **no version number** and no negotiation. The
egress header has a version byte, `0x01`, the only one.

Each release runs the parent built from its own tag (VAULT-RELEASES
§3.4, C4), so an enclave and a parent of different versions are not
meant to meet. What the code does if they do:

| Case | Behaviour |
|---|---|
| A request kind the receiver does not know | answered `invalid`. An enclave before `Stats` answers `0x15` with `invalid`; the parent then writes its metrics record without the relay counts |
| A request the sender's version does not have | never sent. A parent before `Stats` never sends `0x15` |
| A request to an enclave whose instance has not started | `error` (any kind but `Selftest`) |
| A notification kind the parent does not know | dropped |
| Any notification from the parent | dropped |
| A reply status the caller does not know | a failure |
| A known request with another number of fields | `invalid`; for the hello, a failed hello (the enclave requires exactly three reply fields, the parent exactly two request fields) |
| Extra pairs in a `Stats` reply | dropped by the parent |
| A `Lifecycle` with five, seven or eight fields | accepted by the parent (§7.2) |
| An egress header with another version | closed without an answer |

So a new request kind can be added without breaking either side, and
a change to the hello's fields cannot.

## 11. Trust

### 11.1 The starting point

**Nothing the parent sends is authenticated, and nothing the enclave
sends it is hidden from it.** The enclave treats every frame, every
reply and every byte of an egress stream as host input. What protects
a vault is above this protocol:

| Protection | Where | Against |
|---|---|---|
| TLS 1.3 ending in the enclave, pinned roots, host name | egress streams (§8) | reading, changing or redirecting relay, KMS, push and status-list traffic |
| Signed relay requests; end-to-end encrypted payloads | inside that TLS (RELAY-PROTOCOL; VAULT-MESSAGING §4, §5) | anyone between a vault and its peers, the relay included |
| Requests sealed to an attested ETK, bound to `vault_id`, `user_guid` and `request_id`; the replay set; the 5-minute time window | `Queue` (VAULT-MESSAGING §11.2, §11.3, §11.6) | forging, changing, redirecting or replaying an enroll, an unlock or a recovery register |
| Results sealed to the requester | `Queue` replies (VAULT-MESSAGING §11.4, §11.11.2) | reading or forging an outcome |
| State encrypted under the vault's DEK; the header sealed through KMS to the release's measurements, the data key readable only by the vault process that attested its own key | stored objects (VAULT-MESSAGING §3.3, §11.10.7, §12.4) | reading or changing stored state |
| `state_seq` and `header_seq`, with the minimums the app sends | stored objects (VAULT-MESSAGING §13.2) | serving an old state or header, within the residual risks listed there |
| Conditional writes; a conflict zeroizes | `StorePut` (VAULT-MESSAGING §12.3) | two instances writing one vault |
| The manifest's hash inside the sealed request; its signature | the manifest document (VAULT-MESSAGING §11.5) | a manifest the app did not verify |
| KMS key policy bound to the attested measurements; the key-policy check before any seal | KMS calls (VAULT-MESSAGING §11.10.7) | credentials of the parent's choosing opening a sealed header |
| The enclave's clock comes from the hypervisor, not from the parent | everywhere time is checked (VAULT-PLAN §5.2) | a parent setting the time |

### 11.2 What the parent sees

**For the instance:**

- the enclave's release (PCR0), boot id, every descriptor and
  attestation (public anyway: the registry serves them);
- how many vaults run (`Ping`), and the relay counts of `Stats`, no
  finer than once a second;
- for each egress connection: the host name, when it opened and
  closed, and the size and time of every piece of ciphertext in both
  directions. On HTTP/2 connections every vault's requests share
  connections, and the enclave, not the host, decides how many there
  are, so a connection does not belong to a vault
  (VAULT-MESSAGING §2.2, §12.2.1). The HTTP/2 pings on quiet
  connections are visible as small records;
- the instance role's credentials, which are its own.

**For each vault**, by its `vault_id`:

- every queue message in the clear, except the sealed envelope:
  the operation (`enroll`, `unlock`, `lock`, `delete`, `recovery`,
  `recovery_cancel`, `recovery_register`, `account`) and when; the
  member's `user_guid`; the request id; the ETK id; the manifest hash;
  the app key's public key (enroll, recovery register); the browser
  key of a recovery; and the **account snapshot** when the message
  carries one (enroll, unlock, `account`): the member's email address,
  first and last name, membership, terms and subscription state
  (VAULT-MESSAGING §11.13);
- of each answer: its status, its size (fixed), and the two host
  codes `recovery_registered` and `recovery_unavailable`
  (VAULT-MESSAGING §11.5); (0.1.10, release R) also
  `recovery_attempt` with `retry_at` and `expires`, the clear
  `not_before`, `expires` and `earliest` of a recovery, the member API's
  signature on `recovery` and `recovery_cancel`, and the `recovery_open`
  operation;
- (0.1.10, release R) the recovery counter's connections (§8.1): when
  the enclave opens one and the sizes and times of its ciphertext. They
  are not shared with other hosts' traffic, so each burst marks a
  recovery open, a change of secret or an owner check of some vault on
  the instance. VettID, which owns the bucket, also reads every
  object's name and time there: which records belong to one vault (not
  which vault), every attempt's time and outcome class, and every
  present time;
- every lifecycle event (§7.2): that the vault was enrolled, unlocked,
  locked, moved or deleted, and when; its release and state version;
  its app key's public key and count; the backup bit; a name change
  request with both names; a clone alarm;
- that a vault's process stopped, and why (§7.3);
- **every store request**: the object's key, which names the vault and
  the release of a header; the size of the ciphertext; the version;
  and the moment of every read, write and delete. A vault writes its
  state when something durable changed, so the times of its writes
  are a record of when that vault was active. (0.1.9, release
  A) Attachment objects (§5.2) add: when the vault stored, read or
  deleted an attachment or its thumbnail, the size of each (padded:
  VAULT-MESSAGING §5.5), and so how many attachments the vault
  holds and when its member opened one. Not what they show, their
  type or name, or which connection or message they belong to;
- log records that name it: that it was locked and by which trigger
  (`lease_lost`, `shutdown`, `vault_cap`, `memory_pressure`), that its
  final flush failed, that its process ended and with what code, and
  what its own process logged when its run loop ended (§7.4). At
  f3003ed also that it reached its limit of 8 relay requests in
  flight; not from 8f2c8bf (§13 point 2).

**What it does not see:** PINs, credential passwords, any key but
public app keys and browser keys, vault contents, the sealed requests
and results, relay requests (methods, paths, mailbox ids, tokens,
signer keys), which peers a vault talks to, KMS requests and answers,
push tokens and wake blobs.

**Per instance is per vault when one vault runs.** The counts of
`Stats` and the traffic on the shared connections are sums over the
vaults unlocked on the instance, and the parent knows which those are.
With one vault unlocked they describe that vault. Sharing hides a
vault among the others on its instance and gives nothing when there
are none. The parent's own view of the TLS streams is finer than
`Stats` in any case.

### 11.3 Per kind

"Forge" means: send it without any cause outside the parent. In every
row the parent can also **withhold** (not send, not answer) and
**delay**; the result of that is in the last column only where it is
more than "the operation does not happen, or happens late".

| Kind | What a dishonest parent can do | What the enclave does about it; what it comes to |
|---|---|---|
| `Hello` reply | name any well-formed instance id; say `fresh` at any hello; say `selftest` at an enclave's first hello; name another id later | The id is attested in the descriptor but is a routing label only: requests are bound to the ETK and the vault, not to the id. `fresh` locks every vault. `selftest` makes that enclave serve no vault until it is restarted, and tells nothing secret (§6.5). Another id later: the enclave exits. **Denial of service only** |
| `StoreGet` reply | return other bytes, an older object, another vault's object, `not_found`, any version | Objects are authenticated and bound to the vault; rollback is bounded by the sequence numbers and the app's minimums (VAULT-MESSAGING §13.2, with its residual risks). `not_found` for a vault that exists: an unlock fails (`vault_missing`), and an **enrollment sees no vault to protect**: "a confirmed vault MUST NOT be replaced" (VAULT-MESSAGING §11.3) is decided from the parent's answers, so it holds against a member API and an app, not against the parent. Replacing a vault this way gives the parent no more than deleting it does: the old state stays sealed |
| `StorePut` reply | not write and say `ok`; write and say `conflict` or nothing; return any version | A lost write is a rollback (above). A false `conflict`, or a version that will not match, makes the vault zeroize as a split brain: no key leaves, and nothing is acked that was not stored (VAULT-MESSAGING §8.3, §12.3), so the relay still holds what the vault had not flushed |
| `StoreDelete` reply | keep the object and say `ok`; delete anything it can reach in the bucket at any time | The parent's role can delete stored state anyway (VAULT-MESSAGING §13.5). A kept object cannot be opened without the PIN and a registered device |
| `Credentials` reply | give no, expired, or another principal's credentials | KMS answers come over the enclave's TLS. Sealing keys release data keys only to the release's attested measurements, and the enclave checks the key's policy itself before sealing. Wrong credentials are failed unlocks |
| `Queue`, sealed operations (`enroll`, `unlock`, `recovery_register`) | drop, delay, reorder, replay, send to another instance; change the clear members | Replays and redirected requests are refused (VAULT-MESSAGING §11.6). It cannot make one: it has no ETK and no device key. A changed `account` member reaches the vault (below) |
| `Queue`, operations without an envelope (`lock`, `delete`, `account`, `recovery`, `recovery_cancel`) | **forge them** for any `vault_id` | `lock`: the vault locks. *From release L (0.1.3, planned):* a `lock` carries `unlock_id` or is ordered by `enqueued_at`, both of which the parent can read and set, and the parent writes the `code` of the answer: it can still lock any vault, drop any lock, and report `locked` for a vault it left open. The members protect an honest path against late delivery, not against the parent. What bounds a parent that keeps a vault open is the idle lock, decided in the enclave by its own clock (VAULT-MESSAGING §3.6.8). `delete`: a running vault deletes itself with the full semantics of VAULT-MESSAGING §12.5, otherwise its stored objects are erased; an operator power stated in §13.5. `account`: a running vault takes the snapshot, so the parent can make a vault show its owner, and put in the core of its shared profile, **names and account details of the parent's choosing**; the snapshot is display only and "not authenticated beyond the host path" (VAULT-MESSAGING §11.13, §10.8). `recovery` (0.1.10, release R: signed by the member API, VAULT-MESSAGING §11.14.8; the parent alone can no longer start or cancel one, and a forged one locks nothing): with a browser key of its own the parent **starts a recovery**: a running vault locks and tells its devices why, unlocks are refused `recovery_pending`, and after the enclave's 24 h the parent can open the code. The devices are told only if the vault was running when the recovery began, and see `recovery_pending` only while the parent serves them the header that records it; a parent that serves an earlier header shows them nothing (§11.4 item 4). A recovery still needs an attested app, the PIN and the credential password, and exists only with the credential backup on (VAULT-MESSAGING §11.11); the two backoffs do not limit a parent that also replays stored objects (§11.4 item 4). `recovery_cancel`: ends a member's recovery |
| `Queue`, the manifest document | withhold it, or give another | The request fails `manifest`. It cannot make the enclave accept a manifest the app did not verify (VAULT-MESSAGING §11.5) |
| `Queue` reply (seen by the parent) | drop it, or write another slot | The app gets no result or a result it cannot open; results are sealed. The two host codes can be forged or suppressed with the effects VAULT-MESSAGING §11.5 lists |
| `LeaseLost` | send it for any vault, at any time; never send it | The vault locks. Never sending it leaves a vault running without a lease; if a second instance then opens the vault, the two meet at the conditional state write, and the one that finds a newer version is zeroized (the split-brain guard does not depend on leases) |
| `Ping` | not send it; send it and renew no lease; ignore the answer | Not sending it locks every vault after 120 s (§4.3): **denial of service only**. Sending it proves only that the peer is alive: a parent can ping and renew nothing, and what then stops two instances writing one vault is the conditional state write, as before. It learns the number of running vaults, which it has from the lifecycle events |
| `Shutdown` | send it at any time | Every vault locks, with its flush |
| `Selftest` | send it to an enclave it put in self-test mode | §6.5: no vault, no ETK, no secret in the report |
| `Stats` | ask as often as it likes | The same snapshot for a second; asking changes nothing; instance-wide counts only (§6.6, §11.2) |
| `Descriptor` | withhold it, publish an old one, publish another enclave's | Apps verify the attestation, the measurements and the expiry (VAULT-MESSAGING §11.2, §11.10.6). A request sealed to a key this enclave does not hold is answered `etk_unknown` |
| `Lifecycle`, `Stopped` | drop, change or invent what it writes to the tables | The values are advisory and serve routing and the account site only (VAULT-MESSAGING §11.5 "Lifecycle values are advisory"). It can suppress the member's email about a clone alarm, not the vault's own alert, freeze and audit entry |
| `Log` | read, drop | Sees what §11.2 lists |
| Egress, to the recovery counter (0.1.10, release R) | as for any egress; and, with the instance role's credentials, call the bucket itself: add versions to names it has seen (a present marker version makes a member look present, which blocks recoveries and, between a member's spend and its read, uses that attempt up; a token or wait version uses attempts up), write names it can compute (none it has not seen), lengthen locks | Never fewer attempts used, a shorter wait, an older presence or a tested guess it was not entitled to: the enclave reads complete listings, takes the newest presence, requires "exactly one, mine, locked", and decides each attempt against its own time within 10 minutes (§8.1; VAULT-MESSAGING §11.14.6). Denial of service and the use of a vault's attempts only. What no permission gives, removing a locked version, AWS could do for the account owner (VAULT-MESSAGING §11.14.12) |
| Egress | refuse or fail a connect; connect elsewhere; drop, delay, cut or change bytes; hold a connection open and silent; close connections to make the enclave open more | Anything but the named host with a certificate under the pinned roots fails the TLS handshake. Changed bytes end the TLS session. A silent connection is pinged after 15 s and closed after 10 s more, and closed after 90 s without an answer in any case. The number of connections is bounded by the enclave whatever the host does (VAULT-MESSAGING §12.2.1). It cannot tell from a connection which vault a request belongs to |
| The control connection itself | close it; keep it open and silent; send malformed or very large frames; send more than 128 requests at once | Closed, or open and silent: every vault is locked 120 s after the last `Ping` (§4.3). A peer that stops reading loses the connection after 60 s (§3.4). Malformed: the enclave closes it. The rest: §13, points 5 and 6 |

### 11.4 What a dishonest parent can do, at most

1. **Deny service**, wholly or per vault: not forward, not answer,
   close, lock vaults (`lock`, `LeaseLost`, `Shutdown`, `fresh`), make
   a vault zeroize its memory (a false `conflict`), fail unlocks
   (wrong objects, wrong credentials, no manifest), cut egress.
2. **Destroy stored state** it can reach, and ask a running vault to
   delete itself (`delete`). Availability, never confidentiality
   (VAULT-MESSAGING §13.5).
3. **Roll a vault back** to an older stored state, within what
   VAULT-MESSAGING §13.2 leaves open: toward a device that has not
   seen the newer values, or consistently for both objects.
4. **Start or cancel a recovery** (`recovery`, `recovery_cancel`).
   (0.1.10, release R: only with the member API's signature, so only
   as VettID as a whole; and then its attempts are the ten of
   VAULT-MESSAGING §11.14.6, at the PIN and the password together,
   counted outside what it stores, none tested against a member whose
   presence was recorded in the 72 hours before the attempt. The rest
   of this item describes the releases before R.) It
   gets the code after the enclave's 24 h. A register then needs a
   genuine phone running the published app (device attestation), which
   an operator can supply. After it, the PIN and then the credential
   password are guessed online. **The enclave's backoffs do not limit
   a parent that also replays stored objects (item 3):** both counters
   are kept in objects the parent stores, a newly registered app holds
   no minimums to refuse an older copy, and an app learns of a counted
   failure only from an answer the host delivers (VAULT-MESSAGING
   §13.2). Against such a parent the vault is protected by the
   strength of the PIN and then of the credential password, not by a
   rate. The owner's devices are told only if the vault was running
   when the recovery began, and see `recovery_pending` only while the
   parent serves them the header that records it; a parent that serves
   them the earlier header shows them nothing, and can undo a cancel
   the same way. A vault that has never kept a backup copy of its
   credential cannot be recovered and is not exposed to this.
5. **Give a vault a false account snapshot** (`account`, or the member
   of an enroll or unlock): false names in the vault's shared profile
   core, false membership details shown to the owner. VettID holds
   those names anyway (VAULT-MESSAGING §10.8 "Trust").
6. **Misreport** to the tables what the enclave reported: leases,
   lifecycle values, app keys, the backup bit, name requests, alarms.
   Routing and the account site only.
7. **Observe** what §11.2 lists: per vault, who the member is and when
   the vault is enrolled, unlocked, locked and written; per instance,
   the timing and volume of encrypted traffic to each host. With the
   relay's own logs (VettID runs both) the timing can be correlated;
   that is disclosed in VAULT-MESSAGING §2.2, and resistance to traffic
   analysis is a non-goal there.

### 11.5 What it cannot do

- read a PIN, a key, a vault's contents, a sealed request or a result;
- read, change or make a relay, KMS or push request, or learn a
  mailbox id or a peer;
- unlock a vault, or make an enclave unlock one: every unlock needs a
  request sealed by a registered, attested device with the PIN;
- replay an enroll, an unlock or a recovery register, or turn one
  vault's request into another's;
- make the enclave accept a release manifest the app did not verify,
  or move a vault to another release;
- get an attestation document with `user_data` of its choosing (the
  only one it can cause outside normal operation is the self-test's,
  under its own label);
- choose how many connections the enclave opens to a host, or get a
  connection per vault;
- learn anything per vault from `Stats`, beyond what one vault alone
  on an instance gives away (§11.2).

## 12. Requirements

*Normative since 0.1.1 (approved by the owner 2026-10-12). The code at
f3003ed satisfies each of these; P5's last sentence, narrowed in 0.1.2,
is satisfied from 8f2c8bf.*

- **P1.** The enclave MUST treat every frame, reply and egress byte
  from the parent as untrusted input, and MUST NOT base a security
  decision on a value the parent supplied (an instance id, a lease, a
  version, a status, a credential, a count).
- **P2.** The enclave MUST NOT send in a `Stats` reply, or in any
  future count for the parent, anything that names or is kept for a
  single vault, mailbox, device, connection or address.
- **P3.** The enclave MUST NOT answer `Stats` from a snapshot renewed
  more often than once a second, and answering MUST NOT change any
  state in the enclave.
- **P4.** The enclave MUST NOT let the parent choose the number of
  egress connections, their destination addresses, or which vault's
  requests share which connection (VAULT-MESSAGING §12.2.1 already
  says the first).
- **P5.** The enclave MUST NOT send to the parent, in any frame, a
  PIN, a private or symmetric key, a token, plaintext of a vault, a
  mailbox id, or the content of a relay, KMS or push request. A log
  record MAY name a vault by `vault_id` only to report how that
  vault's run ended: that it was locked and by which trigger, that a
  final flush failed, that its process ended and how, a split brain,
  or the error that ended its run loop (§7.4). A record that names a
  vault MUST NOT carry a count, a state or a time of that vault's
  relay, KMS or push requests, or anything else about what that vault
  did while it ran (0.1.2; before: "A log record MAY name
  a vault by `vault_id`").
- **P6.** The enclave MUST answer a request kind it does not know with
  `invalid` and MUST keep the connection; the parent MUST treat any
  status but `ok` to `Stats` and `Ping` as "no answer" and carry on.
- **P7.** A new parent-to-enclave request kind MUST NOT be added
  without an entry in §11.3 saying what a dishonest parent gains from
  sending it, and MUST NOT let the parent cause an attestation, a KMS
  call or a relay request with content of its choosing.
- **P8.** The enclave MUST NOT answer `Selftest` once it has started
  an instance, and an enclave in self-test mode MUST NOT start one.
- **P9.** The parent MUST forward a queue message byte for byte and
  MUST NOT parse, log or store an envelope, a sealed result or a
  stored object (VAULT-MESSAGING §2.1 already says "not trusted for
  parsing").

*P10–P14: added in 0.1.4; P13 extended in 0.1.5. The code at
vettid-vault a852e36 satisfies each (what staging release S11 is
planned to carry: #66, #69, #70, #71, #72, #73, #74). P13 as extended
is satisfied from a852e36 (#74); as first written it was satisfied at
392b03c.*

- **P10.** The parent MUST send `Ping` at least every 30 s while an
  enclave is connected, and MUST NOT let a table write delay the next
  one. (As built: every 20 s, and the registry write has 10 s. No code
  refuses a larger `-heartbeat` setting; it is an operator's error.)
- **P11.** The parent MUST treat a lease renewal that gets no answer
  as a failed renewal.
- **P12.** While a vault runs, the enclave MUST lock every vault once
  120 s have passed without a `Ping`, and MUST NOT count a connection,
  a hello or any other frame as a `Ping`.
- **P13.** The enclave MUST NOT call a parent it has found unreachable
  before it has read that parent's next `Ping` and has written the
  `Stopped` reports (§4.3).
- **P14.** The enclave MUST NOT let a log record wait for the parent.

*P15: added in 0.1.9 (approved by the owner 2026-10-15, vettid.org
#288, with VAULT-MESSAGING 0.32.0); normative from release A, not
built.*

- **P15.** After the parent records a vault's `deleted` lifecycle
  event (§7.2), whether the vault deleted itself or its stored objects
  were erased without it, and only once its own conditional update has
  marked the vault's row `deleted` (not when that update is refused,
  for instance because another instance holds the lease), the parent
  MUST delete every object whose
  key starts with `vaults/<vault_id>/att/` (listing that prefix, a
  missing object counting as deleted), and MUST retry until the prefix
  is empty. The enclave deletes the attachments it has indexed
  (VAULT-MESSAGING §12.5 step 4), but an erase without the vault's
  DEK cannot read that index; this sweep is what leaves no attachment
  behind then. Every path that erases a vault reports `deleted`,
  also one that finishes an erase from a header that records
  `deleting` (VAULT-MESSAGING §12.5 "Convergence"; as built, those
  paths do not report it). The host role needs `s3:ListBucket` on the data bucket
  for the prefixes `vaults/*/att/*` only (today it may list
  `manifests/*` only). A dishonest parent gains nothing: it sees every
  attachment object's key when it is written, and could always keep
  or delete the objects it stores; skipping the sweep leaves only
  objects encrypted under keys that the deletion destroyed.

*P16–P18: added in 0.1.10 (wording for the owner's approval, with
VAULT-MESSAGING 0.33.0); normative from release R, not built.*

- **P16.** The enclave MUST reach the recovery counter only over its
  own TLS to the bucket's virtual-hosted name pinned in the release,
  with `x-amz-expected-bucket-owner` signed on every call, and MUST
  NOT reach it through the store requests of §5.
- **P17.** The enclave MUST decide every counter question from complete
  versions listings and read-back locks as §8.1 says, MUST NOT retry a
  `Spend` by itself, and MUST treat any outcome it cannot classify as an
  attempt used.
- **P18.** The instance role MUST NOT hold a delete, bypass-governance,
  legal-hold or bucket-configuration permission on the counter bucket.

## 13. Open points

Decided by the owner on 2026-10-12, as recommended: point 1 is to be
fixed in vettid-vault in a release after S11 (the enclave times the
parent's `Ping`; a write deadline on the control connection), and
VAULT-MESSAGING §12.3 corrected meanwhile; the `vault_id` of point 2 is
to be dropped from that record, after which P5's last sentence is
narrowed; the disclosures (the host row of VAULT-MESSAGING §2.2; the
operations the host can originate, §13.3 and §11.11) go into an
erratum with no code change; per-kind frame limits and the reader at
the request limit follow at low priority; the rest with the next change
to each place.

**State at 0.1.2.** Point 2 is fixed in vettid-vault 8f2c8bf (#69) and
P5 narrowed. Points 3 and 4 are disclosed in VAULT-MESSAGING 0.27.4
(§2.2; §13.3, §11.3, §11.11.2). Point 1 is worded as built in
VAULT-MESSAGING 0.27.4 §12.3; its fix is still to come. Of point 7,
the `Hello` comment is corrected (8f2c8bf) and VAULT-RELEASES 0.1.16
lists `account`. Points 5 and 6 are open. Point 8 is new.

**State at 0.1.4.** Point 1 is **closed** (vettid-vault #70 and #71,
for S11). Point 11 was found and **closed** the same day (#72, `main`
392b03c, for S11). Point 6 stays open, narrowed. Points 9, 10, 12 and
13 are new and open.

**State at 0.1.5.** No point changes. vettid-vault #74 (`main`
a852e36, for S11) brought the code to §4.3's rule that the parent is
reachable again only once it has been told.

**State at 0.1.6.** Point 12 is reworded for vettid-vault #75 (the
queue is created again when a receive finds it gone; the check before
the first registry row after a disconnection has a limit of 10 s). It
stays open.

**State at 0.1.7.** No point changes.

**State at 0.1.8.** No point changes.

Found while writing this document. Each is described where it occurs
above; the pull request that adds this document lists them with file
and line. None lets the parent read or forge anything it could not
before. Points 1 and 2 are the ones that matter.

1. **A parent that stays connected but silent is not "unreachable".**
   *Closed in 0.1.4 (vettid-vault #70, #71): §4.3, §3.4. What follows
   describes the code through 8f2c8bf.*
   The 120 s rule of VAULT-MESSAGING §12.3 is measured from the loss
   of the connection (§4.3). The enclave sends nothing that the parent
   must answer in time except its own store and credential requests,
   and their timeouts lock nothing. Vaults then keep running without
   lease renewals until the connection breaks. Notifications also
   block once 256 frames are queued (§3.4), and with them any enclave
   code that logs.
2. **One log record told the parent something per vault about relay
   requests** (f3003ed): that a named vault reached its limit of 8 in
   flight. VAULT-MESSAGING §2.2 says the host learns "nothing per
   vault" of the relay counts. *Fixed in 8f2c8bf:* the record is gone;
   the instance-wide count `relay_vault_limit` (§6.6) takes its place,
   and a test holds that no log record and no count names the vault.
3. **VAULT-MESSAGING §2.2 does not list everything the parent sees per
   vault** (§11.2): the `user_guid`, the account snapshot with the
   email address and names, the browser key, and above all the key,
   size and time of every state write, which give the times a vault
   was active.
4. **VAULT-MESSAGING §13.3 says the parent can "delay, drop, reorder
   or replay".** It can also originate the five operations without an
   envelope (§11.3). §11.5 says so for `lock`, `delete` and `account`;
   nothing says that the host can start a recovery with a browser key
   of its own. And "a confirmed vault MUST NOT be replaced" (§11.3) is
   decided from store answers the parent gives (§11.3 here, `StoreGet`).
5. **Frames from the parent are bounded only at 64 MiB,** whatever
   their kind, and up to 128 requests are held in memory at once
   before the enclave looks at them.
6. **At 128 requests in flight the reader stops reading replies too**
   (§3.4). An honest parent sends about a dozen at most. *0.1.4:* still
   open; but the time the enclave's reader waits there no longer
   counts against the parent as silence (up to 120 s, §4.3).
7. Smaller: the `Hello` comment in the code names fewer fields than
   are sent; the enclave and the parent read queue messages up to
   different sizes (§6.1); VAULT-RELEASES §3.4 C2 does not list the
   `account` operation.
8. **A point to watch (0.1.2): what a vault process logs reaches the
   parent with the vault's id.** The supervisor passes on every log
   record of a vault process as "vault: …" with the `vault_id` (§7.4),
   and the text is the vault process's own: for "vault run loop ended",
   the first 80 bytes of the error, not reduced to a class as the
   supervisor's own records are. At 8f2c8bf this carries nothing about
   relay requests: a vault process logs only its ending, and only an
   error of its start or of a state write ends it. But any log line
   added to a vault process later, and any error text that later ends
   a run loop, goes to the parent with the vault id. P5 binds such a
   change; nothing in the code enforces it.
9. **`LeaseLost` goes one vault at a time (0.1.4).** The parent tells
   the enclave of each lost lease in turn and waits for each lock (up
   to 60 s). With hundreds of vaults whose leases are lost together
   (the lease table not answering) the last are told after their
   leases have ended. The conditional state write guards those. To
   close it: one request that locks them together.
10. **Lifecycle events lost with a connection (0.1.4, narrowed).**
    Frames queued on a connection that ends are lost, and so is an
    event raised while there is none. The vaults ended by the
    unreachable lock are now reported (§4.3), so the parent's running
    set and the leases come right. What a `locked` event carries
    besides (the app key, the backup bit) is not sent again, and any
    other event lost with a connection stays lost. To close it: the
    enclave reports its running set at the hello, a wire change for a
    later release.
11. **A `Ping` handled as its connection ends (0.1.4). Closed in
    vettid-vault #72 (392b03c).** At 2daa9e4 a `Stopped` report could
    be queued onto a connection that had just ended and be lost, or be
    kept while the parent was made reachable all the same, so that an
    unlock opened the vault before the stale report went out and the
    parent then released a running vault's lease. Now a report counts
    as told only when written to the connection that is still the
    current one, and a report whose vault runs again is dropped
    (§4.3). Written is still not read: point 10.
12. **The parent's other AWS calls have no time limit of their own
    (0.1.4).** None decides a lock, and none was changed: the queue's
    long poll, message delete, manifest read, slot write, and lease
    acquire, read and take-over on the request path (a hang holds one
    of the 8 request workers; the message comes back after its
    visibility time); the store get, put and delete and the
    credentials the enclave asks for (the enclave gives up after 60 s;
    the parent's handler stays, one of 128); the sweeper's list,
    heartbeat read and queue delete; the queue's creation at start and
    after a receive that finds the queue gone. With a limit: the
    registry write and the lease renewal (10 s, new), the check that
    the queue exists before the first registry row after a
    disconnection (10 s), lifecycle and lease-release writes (30 s),
    the registry row's delete (10 s; 60 s at shutdown).
13. **The wait for the reports has no bound of its own (0.1.4; low).**
    After a `Ping` the enclave waits until its whole outgoing queue is
    written, not only the reports, and that wait has no time limit
    beyond the 60 s each frame has. At realistic rates it is
    immediate, and while the parent is unreachable the enclave makes
    no calls, so little is queued. A parent that reads slowly delays
    its own return and its `Ping`'s reply.

## 14. Sources

*0.1.5:* also read at a852e36: `enclave/supervisor/link.go` (`ping`,
`hear`, `lost`, `locked`), `supervisor.go` (`checkParent`, `maintain`),
`prochost.go` (`LockAllWithin`), `parent/parent.go` (the `Ping` sent
when a descriptor arrives), and the description of vettid-vault #74.

*0.1.4:* also read at 392b03c: `enclave/supervisor/supervisor.go`
(`checkParent`), `link.go` (`ping`, `hear`, `lost`), `prochost.go`
(`LockAllWithin`), `internal/hostproto/conn.go` (`Options`),
`parent/parent.go` (`publish`, `renew`, the `Stopped` branch),
`enclave/cms`, and the descriptions of vettid-vault #70, #71 and #72.

Read at vettid-vault `main` f3003ed:

- `internal/hostproto/frame.go`, `conn.go`, `egress.go`: framing,
  kinds, statuses, the connection, the egress header;
- `internal/vsock/`: the socket, the chunked writes, the context id;
- `enclave/supervisor/supervisor.go`, `link.go`, `log.go`,
  `selftest.go`, `prochost.go`: the enclave's side;
- `enclave/egress/egress.go`, `h2pool.go`: TLS and the connections;
- `enclave/instance.go`, `wire.go`, `etk.go`, `host.go`: queue
  messages, the replay set, lifecycle fields;
- `parent/parent.go`, `consumer.go`, `forwarder.go`, `metrics.go`,
  `health.go`, `config.go`, `selftest.go`: the parent's side;
- `cmd/vault-enclave/`, `cmd/vault-parent/`: ports, allowlists;
- `docs/V3-NOTES.md` "Enclave ↔ parent", "Parent".
