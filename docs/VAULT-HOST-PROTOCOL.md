---
title: VAULT-HOST-PROTOCOL
status: approved by the owner 2026-10-12 (H1–H9 as recommended)
version: 0.1.1
date: 2026-10-12
owner: Al Liebl (Mesmer)
component: vault enclave (supervisor), parent (host process)
related:
  - VAULT-MESSAGING.md (0.27.3) §2 (threat model, who sees what), §11.1, §11.5, §11.6, §12 (collect manager, shared connections, lock triggers, process isolation), §13.2, §13.3, §13.5
  - VAULT-PLAN.md (0.1.7) §5.2 (D5: TLS in the enclave), §5.3 (D4: one process per vault)
  - VAULT-RELEASES.md (0.1.15) §3.4 (C3, C4), §8.4 (network and egress), §8.7 (observability)
  - VAULT-RELAY-SCALING.md (0.1.2) §6, §10
  - vettid-vault `internal/hostproto`, `enclave/supervisor`, `enclave/egress`, `parent`, docs/V3-NOTES.md "Enclave ↔ parent", docs/SMOKE.md
changelog:
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
vettid-vault f3003ed. Statements in the present tense are what the code
does. The key words MUST, MUST NOT, SHOULD and MAY (RFC 2119) appear
only where this document repeats a rule another specification already
makes, with the reference, and in §12, whose rules are normative since
0.1.1 (the code at f3003ed already satisfies each of them).

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
  all wait (§13, point 6).
- **Notifications are handled in the order they were sent**, on the
  reader, before the next frame is read.
- **Replies** may arrive in any order.
- A notification queued before a reply is written before it. The
  enclave relies on that: the lifecycle events of a queue request
  (§7.2) are queued before the request's reply, so the parent has them
  first (VAULT-MESSAGING §11.5).
- **Outgoing frames** wait in a queue of 256. When it is full, a sender
  blocks until the writer has written one. Writes have no deadline.

### 3.5 The end of a connection

A read or write error, a malformed frame or a close ends the
connection. Every call still waiting on it fails; frames still queued
are dropped. Requests are never re-sent by this layer. What each side
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
- **No connection for 120 s.** While it runs vaults, the enclave locks
  every one (VAULT-MESSAGING §12.3 "Parent unreachable for 120 s"): the
  parent can no longer renew their leases. The check runs every 10 s.
  It measures the time **without a connection**. A connection that
  stays open while the parent does not answer is not counted (§13,
  point 1).
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

### 6.2 `LeaseLost` (0x11)

| | Fields |
|---|---|
| Request | `vault_id` |
| Reply | `ok` (also when that vault is not running); `invalid` |

The enclave locks the vault (VAULT-MESSAGING §12.3 "Lease lost"). The
parent sends it when a lease renewal finds another holder, or renewals
keep failing until 15 s before the lease ends. It waits 60 s.

### 6.3 `Ping` (0x12)

| | Fields |
|---|---|
| Request | none |
| Reply `ok` | `count`: the number of vaults running, decimal |

The parent sends it every 20 s, before it writes the instance's
registry row, and waits 5 s. Without an `ok` it does not write the
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

### 7.4 `Log` (0x23)

Fields: `level`, `message`, then pairs `key`, `value`.

The enclave's log records (VAULT-MESSAGING §13.6; VAULT-RELEASES
§8.7). A release enclave has no console, so this is its only log. The
enclave sends at most 31 pairs; the parent logs at most 16, with the
message and each value cut to 200 bytes, marked `source=enclave`.

The supervisor logs fixed messages with ids, counts, reasons and error
classes: never keys, PINs, tokens, envelopes, plaintext or mailbox
ids. Some records name a vault by its `vault_id` (§11.2).

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
  (VAULT-RELEASES §8.4). The parent resolves the name; the enclave
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
| Lock every vault when there is no connection | after 120 s, checked every 10 s | enclave |
| `Queue` answer | 100 s | parent |
| `Queue` requests at once | 8 sent (parent); 1 handled (enclave) | each |
| Queue message read | 24,576 bytes (enclave); 32,768 bytes (parent, routing members) | each |
| Manifest document | 90,112 bytes | both |
| `Ping`, `Stats` answer | 5 s | parent |
| `LeaseLost`, `Shutdown` answer | 60 s | parent |
| `Stats` answer renewed | at most once a second | enclave |
| Heartbeat (`Ping`, then the registry row) | every 20 s | parent |
| Metrics (`Stats`, then the record) | every 60 s | parent |
| Lease | 180 s, renewed every 60 s | parent |
| Store key | 256 bytes, the characters of §5.2 | both; the prefixes by the parent |
| Store version | 1 to 256 bytes | enclave |
| Descriptor, attestation | 4,096 and 32,768 bytes | parent |
| Log record | 16 pairs, 200 bytes a value | parent |
| Egress header, connect, answer | 10 s, 10 s (parent); 15 s (enclave) | each |
| Egress destination | the allowlist, port 443 | both |

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
  (VAULT-MESSAGING §11.5);
- every lifecycle event (§7.2): that the vault was enrolled, unlocked,
  locked, moved or deleted, and when; its release and state version;
  its app key's public key and count; the backup bit; a name change
  request with both names; a clone alarm;
- that a vault's process stopped, and why (§7.3);
- **every store request**: the object's key, which names the vault and
  the release of a header; the size of the ciphertext; the version;
  and the moment of every read, write and delete. A vault writes its
  state when something durable changed, so the times of its writes
  are a record of when that vault was active;
- log records that name it: that it was locked and by which trigger
  (`lease_lost`, `shutdown`, `vault_cap`, `memory_pressure`), that its
  final flush failed, that its process ended and with what code, and
  that it reached its limit of 8 relay requests in flight
  (§13, point 2).

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
| `Queue`, operations without an envelope (`lock`, `delete`, `account`, `recovery`, `recovery_cancel`) | **forge them** for any `vault_id` | `lock`: the vault locks. `delete`: a running vault deletes itself with the full semantics of VAULT-MESSAGING §12.5, otherwise its stored objects are erased; an operator power stated in §13.5. `account`: a running vault takes the snapshot, so the parent can make a vault show its owner, and put in the core of its shared profile, **names and account details of the parent's choosing**; the snapshot is display only and "not authenticated beyond the host path" (VAULT-MESSAGING §11.13, §10.8). `recovery`: with a browser key of its own the parent **starts a recovery**: a running vault locks and tells its devices why, unlocks are refused `recovery_pending`, and after the enclave's 24 h the parent can open the code. A recovery still needs an attested app, the PIN and the credential password under both backoffs, and exists only with the credential backup on (VAULT-MESSAGING §11.11). `recovery_cancel`: ends a member's recovery |
| `Queue`, the manifest document | withhold it, or give another | The request fails `manifest`. It cannot make the enclave accept a manifest the app did not verify (VAULT-MESSAGING §11.5) |
| `Queue` reply (seen by the parent) | drop it, or write another slot | The app gets no result or a result it cannot open; results are sealed. The two host codes can be forged or suppressed with the effects VAULT-MESSAGING §11.5 lists |
| `LeaseLost` | send it for any vault, at any time; never send it | The vault locks. Never sending it leaves a vault running without a lease; if a second instance then opens the vault, the two meet at the conditional state write, and the one that finds a newer version is zeroized (the split-brain guard does not depend on leases) |
| `Ping` | not ask; ignore the answer | Learns the number of running vaults, which it has from the lifecycle events. Routing only |
| `Shutdown` | send it at any time | Every vault locks, with its flush |
| `Selftest` | send it to an enclave it put in self-test mode | §6.5: no vault, no ETK, no secret in the report |
| `Stats` | ask as often as it likes | The same snapshot for a second; asking changes nothing; instance-wide counts only (§6.6, §11.2) |
| `Descriptor` | withhold it, publish an old one, publish another enclave's | Apps verify the attestation, the measurements and the expiry (VAULT-MESSAGING §11.2, §11.10.6). A request sealed to a key this enclave does not hold is answered `etk_unknown` |
| `Lifecycle`, `Stopped` | drop, change or invent what it writes to the tables | The values are advisory and serve routing and the account site only (VAULT-MESSAGING §11.5 "Lifecycle values are advisory"). It can suppress the member's email about a clone alarm, not the vault's own alert, freeze and audit entry |
| `Log` | read, drop | Sees what §11.2 lists |
| Egress | refuse or fail a connect; connect elsewhere; drop, delay, cut or change bytes; hold a connection open and silent; close connections to make the enclave open more | Anything but the named host with a certificate under the pinned roots fails the TLS handshake. Changed bytes end the TLS session. A silent connection is pinged after 15 s and closed after 10 s more, and closed after 90 s without an answer in any case. The number of connections is bounded by the enclave whatever the host does (VAULT-MESSAGING §12.2.1). It cannot tell from a connection which vault a request belongs to |
| The control connection itself | close it; keep it open and silent; send malformed or very large frames; send more than 128 requests at once | Closed: the enclave dials again, and locks every vault after 120 s without a connection. Malformed: the enclave closes it. The rest: §13, points 1, 5 and 6 |

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
4. **Start or cancel a recovery** (`recovery`, `recovery_cancel`). It
   gets the code after the enclave's 24 h. It does not get a device:
   that needs device attestation, and then the PIN and the credential
   password, guessed online under the enclave's backoffs. The owner's
   devices are told when the vault locks for it, and cannot unlock
   without seeing it.
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
f3003ed satisfies each of these.*

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
  record MAY name a vault by `vault_id`.
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

Found while writing this document. Each is described where it occurs
above; the pull request that adds this document lists them with file
and line. None lets the parent read or forge anything it could not
before. Points 1 and 2 are the ones that matter.

1. **A parent that stays connected but silent is not "unreachable".**
   The 120 s rule of VAULT-MESSAGING §12.3 is measured from the loss
   of the connection (§4.3). The enclave sends nothing that the parent
   must answer in time except its own store and credential requests,
   and their timeouts lock nothing. Vaults then keep running without
   lease renewals until the connection breaks. Notifications also
   block once 256 frames are queued (§3.4), and with them any enclave
   code that logs.
2. **One log record tells the parent something per vault about relay
   requests:** that a named vault reached its limit of 8 in flight
   (§11.2). VAULT-MESSAGING §2.2 says the host learns "nothing per
   vault" of the relay counts.
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
   (§3.4). An honest parent sends about a dozen at most.
7. Smaller: the `Hello` comment in the code names fewer fields than
   are sent; the enclave and the parent read queue messages up to
   different sizes (§6.1); VAULT-RELEASES §3.4 C2 does not list the
   `account` operation.

## 14. Sources

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
