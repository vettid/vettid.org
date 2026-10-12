---
title: VAULT-RELAY-SCALING
status: approved by the owner 2026-10-12 (D1–D6 as recommended)
version: 0.1.1
date: 2026-10-12
owner: Al Liebl (Mesmer)
related:
  - VAULT-PLAN.md §5.2 (D5: TLS in the enclave, shared HTTP/2 connections), §5.3 (D4: one process per vault)
  - VAULT-MESSAGING.md §12.2 (shared connections, long-poll in the enclave), §12.4
  - RELAY-PROTOCOL.md §6.3, §6.4; 0.7.0 draft §7.2 (PR #233: limits per key, flood guard)
  - VAULT-RELEASES.md §8.7 (monitoring), §8.8 (capacity); STAGING-DEVELOPMENT-PLAN.md §3 row 6, D11
  - vettid-vault docs/V3-NOTES.md, docs/SMOKE.md
changelog:
  - 0.1.1: approved by the owner 2026-10-12; D1–D6 decided as recommended (§8)
  - 0.1.0: first draft after the owner's request of 2026-10-12 ("plan the
    enclave fix"); code read at vettid-vault and vettid-relay
    `origin/main`, AWS read-only, and two local measurements (§9)
classification: public (no secrets; safe for github.com/vettid)
---

# How many vaults one host can keep connected to the relay (plan)

## 1. Summary

The report behind this plan said: the enclave shares 4 HTTP/2 connections
to the relay, the load balancer allows 128 requests at a time on each, so
only about 500 vaults per host can hold their long-poll, while a host has
memory for about 900.

The numbers are right; the conclusion is not. **There is no wall at 500
today.** When all streams of a connection are in use, the enclave's HTTP
client opens another connection, and the next vault's collect goes out at
once. Measured with the enclave's own egress code (§9.2): 900 parked
long-polls at 128 per connection all ran, on 8 to 11 connections, with no
errors and no waiting, and message sends were not delayed.

What is wrong is smaller, and worth fixing before there are hundreds of
vaults on a host:

1. **It works by accident.** The code and the notes say each pool holds
   "exactly one connection" and that requests queue at about 500
   (`enclave/egress/egress.go:153-156`, `docs/V3-NOTES.md:235-240`). The
   growth comes from an undocumented detail of Go's standard library and
   no test covers it. A Go update could turn it into the wall the report
   described.
2. **The relay, not the enclave, decides how many connections there are.**
   D5 shares connections so the host cannot tell vaults apart by
   connection. A relay that announced a limit of 1 would get one
   connection per request. The enclave should set its own bounds.
3. **Nothing measures it.** No metric shows connections, requests in
   flight or requests waiting, so the first sign of trouble would be
   members' messages arriving late.
4. **All vaults poll in step** after a relay deploy, and stay in step.
   Under the relay limit deployed today (20 requests a second per address,
   burst 40) that is the real first limit: about 40 vaults (§3).

Recommendation: a small change in the next vault release (tests, bounds,
jitter, metrics; no protocol change), then a load test on a staging
relay. The large change (one multiplexed "watch" for all vaults of a
host) is designed in outline here and **not** recommended now: no
per-host limit calls for it before memory runs out at about 900.

Today: four staging vaults; production starts with at most ten members.
Nothing here is urgent.

## 2. What happens today

**The path.** A vault process builds and signs its relay request and
hands it over its channel to the supervisor
(`enclave/vaultproc/deps.go:167`); the supervisor checks it and sends it
with one shared client (`enclave/supervisor/prochost.go:556-617`,
`supervisor.go:286`); the egress transport opens TLS inside the enclave
over a vsock connection to the parent (`cmd/vault-enclave/release.go:107`),
and the parent's forwarder copies bytes to the relay's load balancer
(`parent/forwarder.go`).

**The numbers.**

| Fact | Value | Source |
|---|---|---|
| Relay pools in a release build | 4, one connection each to start (`Conns: 4`; `MaxConnsPerHost = 1`). Why 4: no reason is recorded beyond "a few" (D5) | `cmd/vault-enclave/release.go:34`; `enclave/egress/egress.go:156`; VAULT-PLAN D5 |
| Which pool a request uses | The next one in turn, whatever its load | `egress.go:189` |
| Streams per connection | 128, set by the load balancer; not configurable (no such attribute exists) | AWS documentation; the live `SETTINGS` frame of relay.vettid.org (§9.3) |
| Long-poll | 25 s, always long-poll in the enclave (`WebSocket: false`) | `vault/relay.go:151`; `enclave/vaultproc/vaultproc.go:196` |
| Timeouts | Vault process 75 s; supervisor 75 s per request, 80 s client | `vaultproc.go:196`; `prochost.go:590`; `supervisor.go:286` |
| What shares the connections | Everything a vault sends to the relay: collects, acks, deposits, registration, claims; every vault's. The push gateway has its own 4 pools (another host name) | `prochost.go:601`; `release.go:64-77` |
| Idle request rate | One collect per 25 s: 2.4 a minute per vault | `vault/inbound.go:66-83` |

**When a connection's 128 streams are in use.** Go's HTTP/2 client will
not put a 129th request on it. Go's `http.Transport` then drops the
connection from its own list *and from its count*, so `MaxConnsPerHost =
1` no longer stops a new dial; it dials, and the request goes out on the
new connection. The full connection stays in use and is found again when
it has room. So vault N+1's collect neither blocks nor times out, and
deposits and acks are not stuck behind parked collects: at worst they pay
for one TLS handshake. Measured, §9.2. Connections are not handed out
evenly (the pools take turns regardless of load): 900 requests used up to
11 connections where 8 would do.

**Why not the WebSocket.** The relay has a WebSocket collect
(RELAY-PROTOCOL §6.4, optional). A WebSocket needs a TLS connection of its
own: the load balancer upgrades HTTP/1.1 connections only, and does not
announce WebSocket over HTTP/2 (RFC 8441; §9.3). One connection per vault
is what D5 rules out (VAULT-MESSAGING §12.2; `docs/V3-NOTES.md:423-429`).
The protocol has no collect for several mailboxes on one connection.

**The other hops.**

| Hop | Limit | At 900 vaults |
|---|---|---|
| Enclave → parent (vsock) | Listen backlog 64 (`internal/vsock/vsock_linux.go:107`); no cap on connections | 8–11 connections |
| Parent forwarder | No cap; two goroutines and two descriptors per connection; allowlist and port 443 only (`parent/forwarder.go:55-94`) | Negligible |
| Host → load balancer | Two addresses (one per zone); ephemeral ports and connection tracking are per connection, not per request | Negligible |
| Load balancer | Idle timeout 75 s (above the 25 s park); closes each client connection after 3,600 s; target group speaks HTTP/1.1 to the relay | About 900 connections from the load balancer to the relay tasks |
| Relay | A parked collect is a goroutine, a timer and an entry in an in-memory map; no subscription per mailbox (one wake channel per process) (`internal/api/handlers.go:279-366`, `hub.go`, `internal/coord/wake.go`). 4 collectors per mailbox: not a per-host limit, each vault has its own mailbox | 2 tasks of 0.25 vCPU and 512 MiB, scaling 2–8. Memory per parked collect: not measured |

## 3. Capacity: where each limit sits

H is the number of unlocked vaults on a host. Every running vault is
unlocked and holds one collect; a locked vault has no process. Idle
requests are H ÷ 25 a second; parked streams are H; connections needed
are H ÷ 128, rounded up.

| Limit | Value | Bites at about | What happens there |
|---|---|---|---|
| Relay per-address burst, **deployed today** | burst 40 (`RELAY_RATE_IP`, vettid-relay `internal/config/config.go:146-147`) | **40 vaults** polling in the same instant (after a relay deploy, or a restart of the host) | `429` with `retry_after`; the vaults retry and recover, late by seconds |
| Relay per-address rate, **deployed today** | 20/s | **500 idle vaults**, fewer when messages flow | Lasting `429`s; delivery slows for every vault on the host |
| Streams on the first 4 connections | 4 × 128 = 512 | 500 | **Nothing visible**: a fifth connection opens (§2). The report's wall |
| Memory (S10 self-test) | 5 GiB enclave on m7g.large | **about 900** (907 projected; 980 on S3) | The enclave locks vaults at its memory floor |
| Burst of unlocks | ~76 MiB each for a moment | 58 at once | Unlocks queue (VAULT-RELEASES §8.8) |
| Vault processes | `MaxProcs` 1024 (`enclave/supervisor/prochost.go`, `ProcConfig`) | 1,024 | Further unlocks refused |
| Flood guard, **after PR #233 / vettid-relay #8** | burst 2,000 | 2,000 polling in the same instant | `429` with a random `retry_after` |
| Flood guard, same | 200/s | **5,000 idle vaults**; about 2,200 if each also receives and sends a message a minute | Lasting `429`s |

So the order is: the old address limit (going away), then memory. The
stream limit is not in the list once it is tested and bounded. Until the
relay change is deployed, the host limit is the address limit, not
streams. (The report cited the new limits as §8.5; they are §7.2 of
RELAY-PROTOCOL 0.7.0.)

## 4. Options

| | Option | Streams | Requests/s | Relay load | Changes | Verdict |
|---|---|---|---|---|---|---|
| A | More shared connections, grown on demand, with the enclave's own bounds | Fixed | Same | Same | Vault release only | **Do (phase 1).** It is what happens already; make it deliberate |
| B | One connection per vault process | Fixed | Same | Same, plus 900 TLS sessions | Vault release | **No.** Undoes D5: the host sees each vault's traffic separately. Vault processes have no network access by design and 64 descriptors |
| C | One multiplexed watch per host | Almost none | Idle rate falls from H ÷ 25 to near zero | 900 parked requests become one | Protocol 0.8, relay release, vault release | **Not now** (§4.1) |
| D | Longer parks (say 55 s; the load balancer's idle timeout is 75 s) | Same | Halved | Halved idle work | Protocol cap, relay, vault timeouts | No: does not touch streams, and requests/s is not the limit after PR #233 |
| E | Raise the load balancer's stream limit | n/a | n/a | n/a | n/a | **Not possible.** 128 is fixed |
| F | Lock idle vaults to free memory | n/a | n/a | n/a | Product decision | Out of scope; it is what would lift the memory limit |
| G | Jitter (new): each vault asks for a random wait of 20–25 s, and waits a random moment before its first poll and after an error | Same | +10 % | Spreads bursts | Vault release only | **Do (phase 1).** Stops vaults polling in step |

Costs of A. One more connection per 128 vaults: one TLS 1.3 handshake
each (and again hourly, when the load balancer closes it), and memory in
the supervisor that I estimate at well under 100 KiB per connection (not
measured; against 4.1 MiB per vault). Failure: one lost connection
interrupts up to 128 vaults' requests at once; each retries with backoff
and jitter (relayclient: 3 attempts) and then every second
(`vault/inbound.go:76`: fixed, no jitter; G fixes that). Security: fewer
vaults per connection than "all of them", but never fewer than the bound
the enclave sets (§5). The supervisor and the host learn nothing new.

### 4.1 The multiplexed watch (C), in outline

The supervisor keeps one stream to the relay on which the relay names
mailboxes that have mail; the supervisor wakes that vault's process,
which collects with `wait=0` as now. D4 holds if each vault signs, in its
own process, a short-lived watch grant (its mailbox, an expiry of minutes,
the relay as audience, bound to a key the supervisor made for this
stream) and hands it to the supervisor. The supervisor holds no vault key
and can only learn that a mailbox has mail, which it sees already: it
carries every vault's requests and answers in the clear inside the
enclave (`prochost.go:556-617`). The host sees less than today (one
stream instead of a request per vault every 25 s). The relay learns
nothing new (it already sees one address).

Costs: a new endpoint and limit rules in the protocol, a relay and a
vault release, grant renewal, and a new single point: if the stream
drops, every vault on the host is deaf until it is back, so the long-poll
must remain as the fallback. It pays off in relay work per idle vault
across all hosts, not in any per-host limit. Revisit when the relay's
idle cost or task count becomes a concern (§6, trigger).

### 4.2 Reconnect storms

A relay task that shuts down answers every parked collect at once
(`handlers.go:353`), so a rolling deploy makes about half the vaults
re-poll in the same instant, twice, and they then stay in step. With 4
vaults (2026-10-11) that is nothing; I did not examine that deploy's
logs. With 900 it is two bursts of about 450: inside the new flood
guard's burst (2,000), eleven times the burst deployed today (40). G
removes the lasting synchrony; the first burst after a deploy remains and
is what the flood guard's burst is sized for.

## 5. Recommendation and phases

| Phase | What | Releases | Exit test |
|---|---|---|---|
| 0 | Nothing in production. Correct the notes when phase 1 lands (§7). Deploy the relay limit change (PR #233, vettid-relay #8) on its own schedule: it removes today's real limit | None for this plan | n/a |
| 1 | **Make growth deliberate** (vettid-vault, next staging release): (a) a test in `enclave/egress` that parks more requests than the server allows streams and requires every one to run, quick requests not to wait, and connections to stay within a bound (the measurement of §9.2 as a test), run on every Go update; (b) bounds owned by the enclave: a maximum of connections per host (16: room for 2,048 streams, above `MaxProcs`) and a refusal to grow when the relay announces fewer than 32 streams (requests then wait, and it is counted); (c) jitter (G); (d) counters from the supervisor to the parent, and from the parent as metrics (§6) | One vault staging release, then the next production release. No relay release, no protocol change | Tests pass; on staging, counters visible; S-release canary self-test unchanged |
| 2 | **Load test.** Extend the self-test's synthetic vaults so each makes a throwaway relay key, registers a mailbox and holds real long-polls (today they only make a channel round trip, `enclave/vaultproc/capacity.go:107-126`), deletes its mailbox at the end; run 400 to 900 against a **staging relay** | A staging relay while the test runs (about $55 a month while up; D11) and a staging release that pins it (the relay URL is measured into the image) | 900 held for 30 minutes: no request error, wait under 1 s, connections ≤ 12; a relay rolling deploy during the run: all vaults collecting again within 60 s, no lasting `429` |
| 3 | The multiplexed watch (C) | Protocol 0.8, relay, vault | Only on a trigger of §6 |

Why the load test must not use the production relay, which staging
vaults pin today: 900 synthetic vaults would register 900 mailboxes (the
new-mailbox limit allows 100 at once, then one a second: 15 minutes),
send 36 requests a second for the whole run from one address, and hold
900 connections on two 0.25 vCPU tasks that carry production members.
Under the limit deployed today most of it would simply be refused.
STAGING-DEVELOPMENT-PLAN §3 row 6 (d) forbids load tests on shared
pieces.

How (b) reads the relay's announced limit with the standard library only
(the enclave links no other HTTP/2 code, `docs/V3-NOTES.md:311`) is an
implementation question for phase 1; if it cannot, the fallback is a
fixed cap on connections alone.

## 6. What to watch

No dimension identifies a member, vault, mailbox or address; per host at
most.

| Where | Metric | Alarm |
|---|---|---|
| Parent (EMF, `VettID/Vault`) | Unlocked vaults per instance (specified, VAULT-RELEASES §8.7) | Above 400: time to look, long before 900 |
| Parent | Egress connections open and opened, by destination class (relay, KMS, push). Today only on `/healthz` (`parent/health.go:22-23`) | Opened per hour far above open × 2 (churn) |
| Supervisor → parent (new) | Relay requests in flight; longest wait for a stream in the last minute; relay request errors; times growth was refused | In flight above 80 % of connections × 128; wait above 1 s; any refusal |
| Relay | `relay_parked_collectors`, `relay_active_collectors` (exist, `internal/api/server.go:97,158`); `relay_ratelimit_peak_permille` and `_refused_total` by limiter (vettid-relay #8) | Flood-guard peak above 500 ‰; any flood-guard refusal |
| Load balancer | `ActiveConnectionCount`, `NewConnectionCount`, `RejectedConnectionCount`, `HTTPCode_ELB_5XX_Count`, `TargetResponseTime` | Rejected > 0; 5xx above the usual |

Triggers for phase 3: relay tasks scaled above 4 by idle collects alone,
or more than 2,000 unlocked vaults in total.

## 7. Edits this plan would require elsewhere

None is made by this document.

| Document | Edit | When |
|---|---|---|
| vettid-vault `docs/V3-NOTES.md:235-240`, `enclave/egress/egress.go:57-59,153-156` | Replace "about 500 unlocked vaults before requests queue" and "exactly one connection": say that connections grow, and the bounds | Phase 1 |
| VAULT-MESSAGING §12.2 (and the "Parent / host" row of its who-sees-what table) | "A few shared connections" becomes: shared connections, at least 32 vaults' worth of streams each once a host has that many, at most 16; long-poll wait jitter | Phase 1, with the release's spec version |
| VAULT-PLAN §5.2 "Connection pooling" | The same wording; the bound is the enclave's | Phase 1 |
| VAULT-RELEASES §8.7, §8.8 | The new metrics and alarms; the capacity table of §3 | Phase 1 |
| vettid-vault `docs/SMOKE.md`; RUNBOOK "Staging" | The self-test's relay option; standing up and removing a staging relay | Phase 2 |
| RELAY-PROTOCOL (after PR #233) | Nothing for phases 1–2. Phase 3: a watch endpoint and its place in §7.2 | Phase 3 |

## 8. Owner decisions

Decided by the owner on 2026-10-12: all six as recommended.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Accept that the report's wall does not exist, and fix the four points of §1 instead | Yes |
| D2 | Phase 1 in the next vault staging release | Yes; small, no protocol change |
| D3 | The enclave's bounds: at most 16 relay connections per host, no growth when the relay announces fewer than 32 streams | Yes. Lower numbers blur better but 16 must cover `MaxProcs` |
| D4 | Phase 2: a staging relay for the load test, taken down afterwards | Yes, but only when a host is expected to pass about 100 vaults; not before production release 1 |
| D5 | The multiplexed watch (C) | Not now; revisit on the triggers of §6 |
| D6 | Locking idle vaults to free memory (F) | A separate product decision; it, not the relay path, sets vaults per host |

## 9. Facts

### 9.1 Sources

vettid-vault and vettid-relay at `origin/main`, 2026-10-12 (file and line
as cited). vettid.org `origin/spec/relay-rate-limits` for RELAY-PROTOCOL
0.7.0 §7.2. vettid-relay #8 (`origin/ratelimit-per-key`) is not merged:
`origin/main` still has the address limit of 20/s, burst 40.
Capacity: VAULT-RELEASES §8.8 (S3: 58 held, 4.1 MiB per vault, about 980
projected; S10: 58 held, about 907). The report's 4.4 MiB is not in the
record; 4.1 MiB is.

### 9.2 Measurement: the egress transport at the stream limit

A copy of `enclave/egress/egress.go` (unchanged, `Conns: 4`), Go 1.26.9,
against a local Go HTTP/2 server with TLS 1.3 and a set stream limit;
requests parked by the server, as the relay parks collects.

| Stream limit | Parked requests | Result | Connections (least possible) |
|---|---|---|---|
| 8 | 20 | all served together | 4 (3) |
| 8 | 100 | all served together; 8 quick requests meanwhile: under 1 ms each | 16 (13) |
| 128 | 900 | all served together; quick requests under 1 ms | 11 dialed (8) |
| 128 | 900, re-polling for 12 s (10,241 polls) | no error; 899–900 in flight throughout | 8 open, 11 dialed, no further dials |

### 9.3 AWS (management account, default profile, read-only)

- relay.vettid.org: one Application Load Balancer, two zones, two
  addresses. Live HTTP/2 `SETTINGS`: `MAX_CONCURRENT_STREAMS` 128; no
  `ENABLE_CONNECT_PROTOCOL` (so no WebSocket over HTTP/2).
- Attributes: `idle_timeout.timeout_seconds` 75,
  `client_keep_alive.seconds` 3600, `routing.http2.enabled` true. No
  attribute concerns streams. AWS: "You can send up to 128 requests in
  parallel using one HTTP/2 connection."
- Target groups: HTTP/1.1 to port 8080, round robin, deregistration
  delay 30 s. Relay service: 2 Fargate tasks, 0.25 vCPU, 512 MiB, ARM64,
  stop timeout 40 s, scaling 2–8, no `ulimits` set.

### 9.4 Not established

- The behaviour against the real load balancer above 128 streams. The
  client never exceeds the announced limit, so the balancer's answer to a
  129th stream should not matter; phase 2 tests it.
- Whether the load balancer ends an HTTP/2 connection after a fixed
  number of requests (often reported as 10,000; not in the documentation
  I read). At 128 vaults a connection carries about 300 requests a
  minute, so it would be replaced about every half hour; harmless if the
  client handles it, which phase 2 would show.
- Memory per connection in the supervisor and per parked collect in the
  relay; the relay's scaling metric; whether today's address limit is
  shared between the two relay tasks; the descriptor limit of the parent
  and of the relay tasks (neither is set explicitly).
- Whether the parent emits the egress counters as metrics (I found them
  only on `/healthz`).
- The note that a serverless relay was rejected because of WebSockets: I
  did not find it in RELAY-PLAN or the V3 notes. What the notes give as
  the reason for long-poll in the enclave is §2.
- How the relay deploy of 2026-10-11 looked from the four staging vaults.
- vsock throughput with many connections; conntrack settings of the host.
