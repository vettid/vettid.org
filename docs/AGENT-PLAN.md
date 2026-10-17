---
title: AGENT-PLAN
status: draft
version: 0.1.3
date: 2026-10-17
changelog:
  - 0.1.3: owner decisions of 2026-10-17 during A1: the TPM protector
    keeps no key on the TPM, so `forget` cannot make an old copy of the
    state file recovered from the disk unopenable on the same computer
    (accepted; §4.2); a Windows passphrase file, or a regular file given
    by descriptor, must pass the same owner-only check as the state file.
  - 0.1.2: the owner's answers of 2026-10-17 to §7.3: Q1 recorded as a
    known difference in LEASH-IMPLEMENTATION; Q2 waits; Q3, Q4 and Q5
    in VAULT-MESSAGING 0.40.0 (a bound on access-session prompts, then
    AV6; re-pairing after a long absence; grants fetched when a session
    starts). AV6 is now planned vault work.
  - 0.1.1: owner decisions of 2026-10-17: AG0 agreed (agent first);
    AG1a decided as the simplest and most secure form: stdio only, one
    process started by the MCP client, no daemon, no local socket, no
    network listener and no service files; one pairing per MCP client;
    AG10 withdrawn; AG2–AG9, AG11 and AG12 accepted as recommended.
  - 0.1.0: first draft, for the owner's approval before any code is
    written. The plan for rebuilding the VettID agent connector in
    `vettid/vettid-agent` (Go) on the current architecture: a paired
    device of role `agent` (VAULT-MESSAGING §6.7), acting within access
    sessions and approvals (§6.8) under LEASH grants (§10.11). Starting
    point (what of the 2026-05 connector is worth keeping, and how the
    old code is retired); decisions with recommendations (§2); the
    package layout and its use of vettid-vault's reference client (§3);
    connector-specific matters: the agent-facing interface, keys at
    rest per platform, the process model, sessions and approvals, offline and
    locked vaults (§4); test vectors (§5); phases A0–A6 as small PRs
    with acceptance tests (§6); the work outside the repository in
    vettid-vault, vettid-android and vettid.org (§7); owner
    prerequisites (§8); coordination rules (§9); risks (§10); draft
    texts (§11). The agent-facing interface is an MCP server (owner
    decision of 2026-10-17, AG1); its transports are recommended in
    AG1a. Nothing in this plan changes a protocol
owner: Al Liebl (Mesmer)
related:
  - VAULT-MESSAGING.md (0.40.0) — §6.7, §6.8, §7, §8, §9.1, §10.3,
    §10.11, §10.12; the connector's contract with the vault
  - LEASH-IMPLEMENTATION.md — "Connector"; the LEASH paper
    (`vettid/LEASH`), §3.3 MCP binding and §3.4
  - RELAY-PROTOCOL.md (0.9.4), RELAY-PLAN.md ("vettid-agent")
  - ARCHITECTURE.md (0.1.4), TECH-PREVIEW.md
  - STAGING-DEVELOPMENT-PLAN.md (0.1.2, §5 row 3)
  - ANDROID-PLAN.md (0.1.43) — "Devices & agents" (later), the
    `agents` History category, agent share-rule limits
  - PQC-MIGRATION.md (§4 row 5, release signing root)
  - IOS-PLAN.md (0.1.1) — the model for this plan's form
classification: public (no secrets; safe for github.com/vettid)
---

# Agent connector plan (v1)

The VettID agent connector, rebuilt in the existing `vettid/vettid-agent`
repository against the current vault: a small Go program that runs next
to an AI agent, pairs with the member's vault as a device of role
`agent`, and gives the agent a narrow, audited way to use what the
member has delegated to it. Nothing in this plan changes a protocol:
where the connector needs one, §7.3 says so and the change goes through
the owner as a vettid.org specification change.

**Who reads this.** The owner, to approve or change the decisions of §2;
then a Claude Code instance (the "implementing agent") that builds it.
Everything it needs is in this document, in the public repositories
(`vettid/vettid-agent`, `vettid/vettid-vault`, `vettid/vettid-relay`,
`vettid/vettid-android`, `vettid/vettid.org`, `vettid/LEASH`) and in the
specifications under `docs/` here. Paths below are relative to those
repositories. Commits read for this version: vettid.org `ccb7b20`,
vettid-vault `1ef2dd9` (2026-10-17), vettid-android `b54685f`
(2026-10-17), vettid-agent `11b5956` (2026-05-26), LEASH `85075df`
(2026-10-12).

**Words.** The *agent* is the AI program (an MCP client such as an IDE
assistant or an agent framework). The *connector* is this program; in
the vault it is the device of role `agent`, and VAULT-MESSAGING calls it
"the agent" too. The *operator* is whoever installs and runs the
connector on a computer; usually the member.

## 1. Starting point

- **The existing connector** (`vettid-agent` `main`, last changed
  2026-05-26): about 11,900 lines of Go under `cmd/vettid-agent` and
  `internal/`. It implements the **old architecture**: NATS messaging
  to vettid.dev (`internal/nats`), the old enrollment by a 12-character
  invite code (`internal/registration`), its own X25519/ChaCha20
  constructions (`internal/crypto`), an encrypted `connection.enc`
  sealed with Argon2id over a passphrase and a *platform key* derived
  from machine attributes (`internal/credential`,
  `internal/fingerprint`), a local REST and WebSocket API
  (`internal/api`), and LEASH JWT helpers against vettid.dev's demo
  endpoints (`internal/leash`, `cmd/vettid-agent/leash.go`, `demo.go`).
  None of its protocol code talks to the current vault (LEASH-IMPLEMENTATION
  "Connector"; STAGING-DEVELOPMENT-PLAN §5 row 3). **Treat all of it as
  replaced.**
- **Worth keeping as ideas** (each rewritten against the current spec,
  with its tests):
  - *No secret caching*: item values pass through to the agent and are
    never written to disk or logs (old `CLAUDE.md` "Key Design
    Decisions"). Kept as a rule (§4.7).
  - *One connector, one vault*; several vaults or several agents on one
    computer are several state directories (`--state-dir`). Kept.
  - *A local rate limit in front of the vault* (old
    `internal/api/rate_limit.go`): a token bucket that fails fast before
    a request costs a vault round trip. Kept for the MCP tools (§4.1).
  - *Owner-only files on Windows* (draft PR #4, `internal/ownerfile`): a
    protected DACL with one entry for the current user, written beside
    the target and renamed over it, and checked on load. The design is
    reused in A1.1; the code is rewritten there.
  - *Passphrase strength rules* (old `internal/credential/passphrase.go`:
    at least 12 characters and 3 of 4 classes), for the passphrase
    protector only (§4.2).
  - The CI points of issue #3: actions pinned by commit SHA,
    `go-version-file: go.mod`, a gitleaks job, a Windows job, and
    `govulncheck` (old `Makefile` target `vuln`).
- **Dropped**: `internal/nats`, `internal/registration`,
  `internal/crypto` (the vault's own packages replace it, §3),
  `internal/credential` and its file format, `internal/fingerprint`
  (the machine-attribute platform key, §2 AG3), `internal/api` (REST and
  WebSocket; the interface is an MCP server, owner decision of
  2026-10-17, §2 AG1), `internal/leash` and the `leash`/`demo`
  subcommands (vettid.dev JWTs; the current format is VAULT-MESSAGING
  0.12.0's delegation and status statement), the `extend` and `rebind`
  subcommands, and the dependencies `nats.go`, `gorilla/websocket`,
  `zerolog`, `BurntSushi/toml` and `cobra` (the standard library's
  `flag` and `log/slog` suffice, as in vettid-vault's `vaultctl`).
- **Open issues and draft PRs on vettid-agent** (all opened 2026-10-13,
  Windows): #1 file-mode checks fail on Windows; #2 the machine
  fingerprint collects only the hostname on Windows; #3 a Windows CI job;
  #5 Smart App Control blocks unsigned test binaries; draft PRs #4
  (owner-only files via a DACL) and #6 (Windows machine attributes).
  Disposition, done in A0.1 by the implementing agent with a short
  comment pointing at this plan: **#1** closed by the rewrite (the new
  state store has Windows owner-only files from A1.1, with a test that
  runs on the Windows job); **#2** closed as not planned (the
  machine-attribute key is dropped, AG3); **#3** adopted in A0.1;
  **#5** kept open as the input to AG4 (Windows signing) and closed
  when signed builds run under Smart App Control (A5.3); **PR #4**
  closed, its design carried into A1.1; **PR #6** closed (AG3).
- **When the old code goes**: PR **A0.1** tags the old `main` as
  `legacy-v1-final`, pushes a branch `legacy/v1`, and removes the old
  code from `main` (as vettid-android did, ANDROID-PLAN D1, and as
  IOS-PLAN I0.1 does). The old GitHub releases are edited to say they
  are for the retired vettid.dev service. Nothing before A0.1 deletes
  anything.
- **The vault side is built.** Agent pairing with initial grants and a
  first access session (`vault/core.go` `hPairApprove`,
  `vault/handshakes.go`), access sessions and held approvals
  (`vault/access.go`: 60 s–24 h, 10-minute requests, 5-minute approvals,
  8 held per device), the agent role gate and the LEASH hook
  (`vault/inbound.go`), and LEASH itself (`features/leash/leash.go`:
  grants, delegations, status statements with rotation chains,
  cooldowns, the 20-referral cap, suspension after 30 refusals,
  summaries, `agent.request`) are in vettid-vault `main` and in staging
  images (staging's `enclave/releasecfg/staging.json` lists `leash`;
  production's `prod.json` lists no optional feature, so **no
  production vault answers agent pairing today**, VAULT-MESSAGING
  §11.10.8). `e2e/leash_test.go` and `e2e/leash_status_test.go` pair an
  agent through a real relay and exercise it with the reference client.
  A read of those files against §6.7, §6.8 and §10.11 for this plan
  found no difference in the enclave; the gaps are in the reference
  client and the dev stack (§7.1) and in what the spec leaves open
  (§7.3).
- **The reference client is the best evidence of what a connector
  does.** vettid-vault `client/` (package `client`, "the reference client
  for a vault's owner devices: an app, desktop or agent") pairs from a
  link, runs the handshake and shows the SAS, keeps the session through
  vault-initiated rekeys, refreshes tokens, follows identity rotation,
  and has the agent side of LEASH (`client/leash.go`: `AgentRequest`,
  `LeashGrants`, `LeashStatus`, `LeashPresent` with the quarter-lifetime
  refresh, `VerifyDelegation`). `cmd/vaultctl` drives it from the
  command line (`vaultctl pair -link`, `vaultctl agent request|grants|present`).
- **The Android app has no pairing or LEASH screens.** It parses agent
  QR kinds (`core/crypto/…/invite/Invite.kt`) and lists
  `device.session.pending` and `approval.pending` in Approvals, but can
  only decline them ("This version of the app does not pair desktops or
  agents, so it can only decline.", `feature/approvals` strings); the
  feed has `leash.*` texts and the History category `agents`
  (ANDROID-PLAN §4), and the share-rule model knows an agent subject
  (`core/data/…/items/Sharing.kt` `ShareSubject`). ANDROID-PLAN lists
  "Devices & agents" as later. Without the Android work of §7.2 no
  member can pair a connector with a staging vault; everything before
  that runs on the dev stack.

## 2. Decisions

All decided or accepted by the owner on 2026-10-17; recorded so that
the implementing agent does not reopen them.

| # | Decision | Recommendation | Alternatives | Needed by |
|---|---|---|---|---|
| AG0 | **Agent before desktop** | **Decided (owner, 2026-10-17): agent first.** It has no UI of its own, LEASH is the published differentiator, and the Android screens it needs (pairing, SAS, devices list, approvals) are the ones a desktop needs too, so the desktop then reuses them | — | — |
| AG1 | **Agent-facing interface** | **Decided (owner, 2026-10-17): an MCP server.** The local REST and WebSocket API of the old connector is dropped as the agent interface. This matches the LEASH paper's first binding (§3.3: "In the MCP binding it is an MCP server") and VAULT-MESSAGING §10.11's mapping (`leash.request_secret` → `agent.request{op: "item.get"}`, etc.); the tool set is in §4.1 | — | — |
| AG1a | **MCP transport and process model** | **Decided (owner, 2026-10-17): stdio only, one process.** The MCP client starts `vettid-agent mcp` itself and talks to it over its standard input and output; the process holds the state file's lock, talks to the vault directly, and exits when the client closes it. No daemon, no local socket or named pipe, no network listener, no service files: nothing on the computer but the client that started it can reach the tools. **One pairing per MCP client**: each client gets its own state directory (`--state-dir`), so the phone lists each separately with its own grants and can remove one without the others; a second process on the same state exits with "in use by another agent app". The connector reaches the vault only while a client runs it; it catches up on start (§4.6) | Rejected: a shared daemon behind an owner-only socket (more to build, install and protect; every process of the operator's user can reach the socket); Streamable HTTP on `127.0.0.1` (a listener, DNS rebinding exposure, a token file to protect); a plain CLI for agents to shell out to (needs shell access, no tool schema) | — |
| AG2 | **Language and reuse** | **Accepted (owner, 2026-10-17).** **Go, importing vettid-vault's packages**: `github.com/vettid/vettid-vault/client` for pairing, the session, tokens and LEASH, and `vms/leashwire` for verification, pinned to a vettid-vault commit. Established for this plan (§3.2): the module is public, AGPL-3.0 like vettid-agent, the packages are outside `internal/` (their own `internal/` imports are allowed transitively), the import graph has no AWS SDK, and a stripped binary importing `client` builds to about 5 MB. What the client lacks for a long-running connector is added **in vettid-vault's `client` package** by small PRs (§7.1 AV1–AV5), not forked | (a) Import only the `vms/*` wire packages and write the session runtime in vettid-agent (about 1,000 lines of protocol code that would drift from the reference); (b) reimplement everything from the spec and the §16 vectors (largest; a second protocol implementation to keep equal); (c) Rust (no shared code with the vault) | A0.2 |
| AG3 | **Keys and pairing state at rest** (a security path, §9 rule 6) | **Accepted (owner, 2026-10-17).** The device's secrets (its `ik`, `kem` and relay-key seeds, the vault record and session keyring: the client's `Save()` output) in **one state file**, XChaCha20-Poly1305 under a random 256-bit data key, the data key wrapped by a **platform protector**: **Linux**: TPM 2.0 (`/dev/tpmrm0`, a sealed object bound to the TPM) when present, else the passphrase protector; **macOS**: a Keychain item `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (never synced); **Windows**: DPAPI (user scope) plus the owner-only DACL of A1.1; **headless or containers**: the passphrase protector (Argon2id), from a prompt, a file descriptor or a credential file, with a warning that it is not machine-bound. The **machine-attribute platform key is dropped** (§4.2) | (a) Keep the fingerprint key (hostname, machine id, CPU, disk serial, MAC; 3 of 5): readable by any local process, partly visible on the network, breaks on hardware changes, and failed on Windows (#2); (b) OS secret services only (GNOME Keyring/KWallet): absent on servers; (c) plain 0600 file (what `vaultctl` does; fine for tests only) | A1 |
| AG4 | **Platforms, distribution and signing** | **Accepted (owner, 2026-10-17).** **Linux amd64/arm64 first, then macOS arm64 and Windows amd64** (A5). Static, `CGO_ENABLED=0` builds where possible (macOS needs cgo for the Keychain and is built on a macOS runner or the owner's Mac), **reproducible** (`-trimpath`, fixed toolchain from `go.mod`, `SOURCE_DATE_EPOCH`, build ids stripped), with a script that rebuilds a release and compares hashes. **The owner signs**: a release signing key held offline by the owner signs `SHA256SUMS` (Ed25519 now; PQC-MIGRATION §4 row 5 names SLH-DSA-128s for this root in phase 2, so the signature format carries an algorithm id); macOS binaries with the owner's Apple Developer ID and notarized; Windows binaries with an Authenticode certificate whose key is on a hardware token the owner holds. **No third party holds a VettID signing key**: no cloud signing service that keeps the key (for example a CA-hosted or cloud-HSM signing service), no keyless signing that rests on a third party's identity. No auto-update in v1 | Linux only for v1 (most agents run on Linux or macOS; Windows users wait); unsigned Windows builds (Smart App Control may block them outright, #5); Sigstore keyless (trust in a third party's CA and log) | A5 |
| AG5 | **v1 scope** | **Accepted (owner, 2026-10-17).** **Pairing** (pasted code, SAS, approval or rejection, unlink); **access sessions** (request, granted, ended, expiry); **grants** (list, updates, suspension, status statements kept fresh); **items through LEASH**: `catalog`, `item.get`, `item.use` (`hmac-sha256`), with referred requests and `leash.check_status`; **connection info**. **v1.1**: the delegable owner types as MCP tools (`connection.list`, `.get`, `message.send`, `.list`, `.get`, `.read`, `profile.get`, `action.list`, `.invoke`; §10.11 scope table). **Later**: presenting delegations to other tool servers with a proof of possession (waits for the LEASH MCP profile, §7.3 Q2), the vault's HTTP action (needs enclave egress, §10.11, §15 item 7), binary attestation (Q1) | All delegable types in v1 (messaging on the member's behalf is the most sensitive delegation and deserves its own review of texts and defaults) | A3 |
| AG6 | **Vault changes** | **Accepted (owner, 2026-10-17).** **One small enclave change for v1**: the bound on access-session prompts (AV6, VAULT-MESSAGING 0.40.0, §7.3 Q3), in a staging release. Otherwise small changes in vettid-vault's **reference client** (`client/`) and **dev stack** docs (§7.1), which need no vault release | Forking the client into vettid-agent | A2 |
| AG7 | **Testing** | **Accepted (owner, 2026-10-17).** Three layers: **unit** tests with fakes (MCP, the session runtime, state store, protectors, no network); **dev-stack integration** tests behind a build tag, against vettid-vault's `cmd/devstack` with `vaultctl` playing the member's app (§4.8); **staging** tests with **staging test accounts only**, the Android staging app on a test phone, and a written checklist (A6). Never real member data, never a production vault | Integration tests only through the vault's in-process e2e helpers (they are under `internal/`, not importable); staging only (slow, needs the Android work first) | A2 |
| AG8 | **When the connector asks for an access session** | **Accepted (owner, 2026-10-17).** **On the first tool call that needs one**, the connector sends `device.session.request{seconds}` (the operator's configured default, 1 h if unset) and answers the tool "Access requested on your phone". At most one request outstanding; after a denial or a request that expired unanswered, no new automatic request for 10 minutes; at most 6 automatic requests an hour. The vault answers a request within 10 minutes of the last accepted one `too_soon` (VAULT-MESSAGING 0.40.0, AV6); the connector keeps its own bound as well and waits for `allowed_after` | Only on the operator's explicit command (safer for the member's attention, but an agent then fails until a human runs a command) | A2.3 |
| AG9 | **Long approvals and MCP timeouts** | **Accepted (owner, 2026-10-17).** A tool call waits up to 20 s for its response. A request the vault holds (`approval.waiting`, up to 5 minutes) or that is still in flight returns `{status: "pending", request_id}`; `leash.check_status{request_id}` returns `pending`, the result, `denied`, `approval_timeout` or `expired`. The process keeps waiting for the response in the background while it runs and keeps results for 10 minutes (memory only; a secret's value is dropped once returned) | Blocking the tool call for up to 5 minutes (many MCP clients time out tool calls well before that) | A3.2 |
| AG10 | **Daemon lifetime and service files** | **Withdrawn (owner, 2026-10-17)** with AG1a: there is no daemon and no service file | — | — |
| AG11 | **What the connector reports about itself** | **Accepted (owner, 2026-10-17).** Its self-asserted name only (the operator chooses it; default "Agent on <host name>", editable before pairing). No machine attributes and no binary hash are sent: the vault does not accept them (§10.11 "out of the vault's scope") | Sending a binary hash in the `hs.init` profile (the vault would ignore or refuse unknown members) | A2.1 |
| AG12 | **Unlinked or refused** | **Accepted (owner, 2026-10-17).** On `device.unlinked`, the connector stops, deletes its state file (and the protector's key), and says so. On `token_revoked` for its own vault's mailbox without `device.unlinked`, it stops and tells the operator, and deletes only on the operator's `vettid-agent forget` (as an app offers an erase rather than erasing, §6.7.1, §8.6). A behaviour-changing fix here takes the independent review of §9 rule 6 | Erase on any refusal (a relay mistake would destroy a working pairing) | A2.2 |

## 3. Architecture

### 3.1 Package layout

One Go module, `github.com/vettid/vettid-agent`, Go at vettid-vault's
`go.mod` version or later, one binary `vettid-agent`.

| Package | Contents |
|---|---|
| `cmd/vettid-agent` | Subcommands: `pair`, `mcp`, `status`, `forget`, `version`; flags only, no logic |
| `internal/state` | The state file (§4.2): format, atomic write, owner-only files (POSIX modes; Windows DACL), an exclusive lock per state directory, wipe |
| `internal/protect` | Protectors behind one interface: `passphrase`, `tpm` (Linux), `keychain` (macOS, cgo), `dpapi` (Windows); build tags per OS |
| `internal/vaultconn` | The connector's use of `client.Device`: one goroutine that owns it, collects and dispatches (until AV2 exists in the client), persists before acking (AV1), token and rekey maintenance, `device.unlinked`, `token_revoked` |
| `internal/access` | Access sessions (§6.8): request policy (AG8), granted, ended, expiry, `session_required`, `owner_check_required` |
| `internal/leash` | Grants, suspension, status statements (cache and refresh), `agent.request` with referred requests, pending results (AG9) |
| `internal/mcp` | The MCP server: tool definitions and handlers, the local rate limit, the stdio transport |
| `internal/pairing` | Code parsing (bare payload, `https://…/connect#…`, `vettid://connect#…`, inside surrounding text, §6.4), the pairing flow and its texts |
| `internal/devstack` (test only, build tag `devstack`) | Starting or finding a dev stack, driving `vaultctl` as the member's app, the dev relay mapping (§4.8) |
| `testdata/vectors/` | Copies of the vault's vectors used here, with `SOURCE.md` (§5), and the connector's own (`statefile.json`) |

Rules: only `internal/vaultconn` touches `client.Device`; only
`internal/state` and `internal/protect` touch keys at rest; `internal/mcp`
sees results, never keys. Logs (`log/slog`) carry ids, types, sizes and
error codes, never bodies, item values, codes or SAS.

### 3.2 Reusing vettid-vault's client (AG2)

Established on vettid-vault `1ef2dd9`:

- Module `github.com/vettid/vettid-vault`, public, AGPL-3.0 (vettid-agent
  is AGPL-3.0 too). No tags: depend on a pseudo-version of a `main`
  commit, recorded in `docs/SOURCE.md`, updated by its own PR.
- `client` and `vms/*` are not under `internal/`. They import
  `internal/strictjson`, `internal/cbor` and `internal/der`, which Go
  allows because the importing package is inside the vault module; a
  test build of an external module importing `client` and
  `vms/leashwire` compiles.
- Non-standard dependencies compiled in: `vettid-relay`'s `relayclient`
  and `relayauth`, `coder/websocket`, `golang.org/x/crypto` and
  `x/text`, and **btcsuite/btcd and decred secp256k1**, which come only
  from `client/wallet.go` (AV4 would remove them). No AWS SDK
  (the parent's dependencies stay out). About 5 MB stripped.
- Exported signatures return `strictjson.Object`, an internal type:
  usable through type inference (`o, err := d.Op(...)`), not nameable.
  The connector uses `Request`/`Send` with its own JSON types where it
  must name them.
- Limits for a long-running process: every waiting call (`Request`, `Op`, `WaitEvent`,
  `LeashPresent`) collects from the relay itself; `Poll` acknowledges
  each message right after handling it, before the caller can save the
  state; `approval.waiting` does not extend a wait; no application
  retries (§8.6); `device.unlinked` is an ordinary event. §7.1 lists
  the client changes; until they land, `internal/vaultconn` owns the
  device in one goroutine and uses only `Send`, `SendWithID`, `Poll`,
  `Events` and `Save`.

### 3.3 Runtime

```
MCP client ──stdio──> vettid-agent mcp ──relay (HTTPS)──> vault mailbox
                        │ started and stopped by the MCP client
                        │ owns the state file (locked) and client.Device (one goroutine)
```

`vettid-agent mcp`: loads the state (protector), takes the lock (or
exits with "in use by another agent app"), collects what arrived while
it was not running, then collects by long poll, dispatches responses by
`re` to waiting tool calls, handles events (`device.session.granted`,
`.ended`, `approval.waiting`, `leash.grant.updated`, `relay.token.*`,
`identity.rotate`, `device.unlinked`), saves the state before
acknowledging a batch, and refreshes status statements. It writes only
MCP messages to standard output and logs to standard error. `pair`,
`status` and `forget` are run by the operator in a terminal and take the
same lock (`status` while a client runs says so and shows what the state
file holds).

## 4. Connector-specific matters

### 4.1 The MCP tools (AG1, AG1a, AG5)

Names follow LEASH §3.3 where it has one; VAULT-MESSAGING §10.11 gives
the mapping. Every tool returns MCP tool errors with a stable `code`
(the vault's error code, or the connector's own: `not_paired`,
`access_requested`, `access_denied`, `vault_unreachable`,
`owner_check_required`, `suspended`, `rate_limited_local`).

| Tool | Vault request | Input | Result |
|---|---|---|---|
| `leash.list_available` | `agent.request{op: "catalog"}` | — | `{items: [{item_id, name, category, labels}]}` (never values, tags or rules) |
| `leash.request_secret` | `agent.request{op: "item.get"}` | `{item_id, fields?}` | the item, or `{status: "pending", request_id}` (AG9) |
| `leash.execute_action` | `agent.request{op: "item.use", action: "hmac-sha256"}` | `{item_id, field_id, data}` (`data` as text, or base64 with `data_encoding: "base64"`; 1–16,384 bytes) | `{result}` (base64 HMAC-SHA-256), or pending |
| `leash.check_status` | (the held request's response, §6.8) | `{request_id}` | `pending`, the result, or the error |
| `leash.connection_info` | `vault.status`, `leash.grant.list` (cached) | — | paired vault id, last contact, access session and its expiry, grants (scope, approval, limits, expiry, connections), `suspended` |
| v1.1: `vettid.connections.list`, `.get`, `vettid.messages.send`, `.list`, `.get`, `.read`, `vettid.profile.get`, `vettid.actions.list`, `.invoke` | the delegable owner types (§10.11) | as §10.4, §10.5, §10.8, §10.14 | as there; a message's attachment is never shown (§10.5.1 "Agents") |

Tool descriptions say plainly that values come from the member's vault
and that `leash.execute_action` is preferred where it suffices (the
value never enters the agent's context). The local rate limit (a token
bucket, 120 burst, 2 per second, per process) answers
`rate_limited_local` before anything reaches the vault. After a
`forbidden`, the connector does not retry on its own; the vault's
cooldowns (§10.11) make repeated refusals slower and can suspend the
connector.

### 4.2 Keys at rest (AG3)

- **What is secret**: the client's state (`client.State`: `ik_seed`,
  `kem_seed`, `relay_seed`, the vault record with tokens and the session
  keyring). Ed25519 and X-Wing keys cannot live in a TPM, the Secure
  Enclave or DPAPI as non-exportable keys, so the seeds are software
  keys wrapped by a key that the platform protects.
- **Format** (`internal/state`, vectors in `statefile.json`): a small
  JSON header `{v: 1, protector, wrapped_key, nonce, created_at}`,
  then XChaCha20-Poly1305 of the state under the data key with the
  header bytes as associated data. Written to a temporary file in the
  same directory, synced, renamed. A new data key at each pairing.
- **Owner-only**: directory 0700 and file 0600 on POSIX, checked on load
  (refuse a group- or world-readable state); on Windows the DACL of PR
  #4's design, checked on load.
- **Why not the old platform key.** It was an HMAC over attributes any
  local process can read (and the MAC address is visible on the local
  network), so it added obscurity, not a secret; it broke on hardware
  changes (hence `rebind`) and failed on Windows. A TPM-sealed key,
  a this-device-only Keychain item or DPAPI give what LEASH §3.4 asks
  ("Copying credentials to another machine MUST render them
  undecryptable") with keys the attacker cannot recompute.
- **Headless.** The passphrase protector (Argon2id, at least the
  vault's parameters for passwords, VAULT-MESSAGING §4.1; the strength
  rules of §1) is portable by nature: the file and the passphrase open
  it anywhere. `vettid-agent status` says "not bound to this computer"
  for it, and the plan records that this mode does not meet LEASH
  §3.4's platform binding.
  (Owner decision, 2026-10-17.) A passphrase file, or a regular file
  given by descriptor, must be owner-only on every platform: mode 0600
  or 0400 and owned by the operator on POSIX, and on Windows the same
  owner-only DACL check as the state file.
- **Wipe** (`forget`, `device.unlinked`): overwrite and delete the state
  file, delete the protector's key (the Keychain item; the TPM and
  DPAPI protectors keep none outside the file), drop the
  in-memory device. A behaviour change here is a §9 rule 6 path.
  (Owner decision, 2026-10-17.) The TPM protector keeps no object on
  the TPM: the sealed object lives only in the state file. So after
  `forget`, an old copy of the state file recovered from the disk (a
  backup, a snapshot, an SSD's remapped blocks) can still be opened on
  the same computer until its TPM is cleared. Opening such a copy needs
  the copy (from a backup, a snapshot or the raw disk) and access to
  that computer's TPM; DPAPI behaves the same way. Accepted for v1, and said in the README.

### 4.3 Pairing (§6.7)

1. The member opens Devices & agents on the phone and chooses "Pair an
   agent" (§7.2); the app sends `device.pair.create{role: "agent"}` and
   shows the QR and the code (the bare payload; pairing links stay bare,
   §6.4). A connector runs on a computer without a camera as a rule, so
   the member copies the code to it; the SAS comparison is what makes
   that safe (§6.4 "accepting with it is caught by the SAS comparison").
2. `vettid-agent pair` reads the code (argument, prompt or standard
   input; never logged), checks `t = "a"`, the hash and the expiry
   (§6.4), creates fresh keys (`client.New`, role `agent`, the AG11
   name), sends `hs.init`, and prints the six-digit SAS.
3. It waits for `device.paired` or `device.pair.rejected` until 10
   minutes after its `hs.init` (0.10.4, 0.10.5), saving the state after
   each step. On `device.paired` it records the device id and, if
   `session_expires_at` is present, the first access session; it then
   asks for its grants (`leash.grant.list`). A re-pairing always uses
   new keys (a re-paired device's old relay key stays denylisted, §6.7).

### 4.4 Access sessions and approvals (§6.8)

- Without a session the vault answers the connector's requests
  `session_required` or `forbidden` and drops other messages; only
  `vault.status`, `device.session.request`, `device.session.end` and the
  transport types pass. The connector checks its known session expiry
  before sending, and asks per AG8.
- A grant replaces the current session, so a request within a session
  renews it; the connector renews on request only, never silently.
- Referred and held requests: `approval.waiting{approval_id,
  request_id, exp}` makes the connector wait until `exp` (+ 30 s) for
  the response instead of the usual 30 s (§8.1); a retransmission reuses
  the inner `id` (at most twice, §8.6), and the vault's dedupe answers
  it.
- **Held vault** (§3.6.3): `owner_check_required` for everything but
  `vault.status` and `device.session.end`; status statements lapse within
  `status_ttl`. The connector reports "Your vault is waiting for your
  daily check" and does not retry until a `leash.grant.updated` or a
  successful `vault.status` shows the hold ended.
- **Locked vault** (§12.1): requests wait in the vault's mailbox and get
  no answer; after 30 s the tool answers `vault_unreachable` with the
  request kept in flight (AG9), and statements lapse.

### 4.5 Grants and status statements (§10.11)

The connector keeps its grants from `leash.grant.updated` and
`leash.grant.list` (fetched at every session start: the vault sends
`leash.grant.updated` only within a session, and initial grants reach
the connector at pairing only when the approval also granted a session).
It never presents a delegation that is not among its current grants, and
presents none while `suspended` is true (chosen; not in the spec:
the vault issues no statements then anyway). Status statements are
refreshed when less than a quarter of their lifetime (at least a minute)
remains, as `client.LeashPresent` does.

### 4.6 Offline, tokens and relay retention

The vault's standing token for the connector lasts at most 30 days and
the relay keeps messages 14 days (RELAY-PROTOCOL `message_ttl_seconds`
1,209,600). The vault re-mints tokens with under 10 days left at each
unlock and sends `relay.token.issued` (§7.2); the client also re-issues
its own token to the vault before it ends. A connector whose MCP client
runs it at least every two weeks never lapses: on start it collects what
waited at the relay. One that stays off longer can miss a re-issued
token (the relay keeps it 14 days), and after about a month can find
its token expired and the re-issued one gone from the relay; then it
re-pairs. §7.3 Q4 asks the owner to confirm that this is the intended
recovery.

### 4.7 What the connector never does

Stores or logs an item value, an SAS or a pairing code; caches a
secret beyond the one tool result; retries a `forbidden`; sends
anything to a service other than the vault's relay; runs as root or
SYSTEM; listens on a network interface or a local socket.

### 4.8 The dev-stack harness (AG7)

- vettid-vault's `cmd/devstack` (README "Local dev stack for app
  development"): the real relay, LocalStack, the parent, the dev enclave
  with all optional features (`-features all`, `leash` included), the
  member API stand-in and the control port. One stack at a time; it
  refuses to start below `-wait-free-mem` (8 GB by default).
- **The member's app is `vaultctl`** (dev build, which the dev stack
  builds into its data directory): `vaultctl init -role app`, `api-enroll`
  with a fresh test GUID and PIN (as the dev stack enrolls its peer),
  `credential create` and `credential unlock` (grants need the unlock
  window), `device.pair.create{role: "agent"}`, `device.pair.approve`
  with `session_seconds` and `grants`, `share set -agent` for
  `items.read`, `approval.decide`, `leash revoke|resume`,
  `device.unlink`. The first step of A2.4 is to confirm this sequence on
  the dev stack; if a step is missing, it becomes a vettid-vault PR
  (AV5) and is reported in a vettid.org issue.
- **Relay origin**: tokens name `https://relay.vettid.test`; test builds
  of the connector map it to the dev stack's TLS front with the test
  root from `GET /dev/trust` (as `vaultctl` does with
  `VAULTCTL_DEV_RESOLVE`), through `client.Config.HTTP`. That code
  exists only under the `devstack` build tag, and a release check fails
  if it is linked into a release binary.

## 5. Test vectors

The vault's vectors are authoritative (VAULT-MESSAGING §16). Reusing the
vault's packages means the connector does not re-derive them; it still
runs the ones its own code depends on, against the pinned vault commit,
so that a dependency update that changes a format fails here. Copies in
`testdata/vectors/` with a `SOURCE.md` recording the vettid-vault commit
and each file's `sha256sum`. **A vector that stops matching is a
stop-and-report item, never a skip.**

| File (source) | Checks | PR |
|---|---|---|
| vettid-vault `testdata/vectors/invite.json` | the pairing code forms of §6.4 (bare, URL, `vettid://`), `t`, hash and expiry checks in `internal/pairing` | A2.1 |
| `…/handshake.json` | the SAS shown equals the vector's (through the imported handshake) | A2.1 |
| `…/leash.json` | `leashwire.VerifyPresented` accepts the two delegations and statements and refuses the altered ones; the connector's presentation output is byte-identical to the vector's members | A3.1 |
| `testdata/vectors/statefile.json` (new, generated by a test-only function with fixed keys and nonces) | the state file format of §4.2 for the passphrase protector; tampered header, wrong key, truncated file refused | A1.1 |
| `testdata/mcp/*.json` (new, golden files) | `tools/list` output and each tool's input schema, so that a change to the agent-facing contract is visible in review | A3.3 |

CI runs gitleaks with an allowlist for the public vector values.

## 6. Phases and PRs

Small PRs on `vettid-agent`, one row each, every one with its tests.
Spec sections are VAULT-MESSAGING unless named. Each phase is tracked
as an issue in vettid-agent, opened in A0.1.

### A0 — Retire the old code, skeleton, CI

| PR | Contents | Acceptance |
|---|---|---|
| A0.1 | Tag `legacy-v1-final`, branch `legacy/v1`; remove the old code; new `go.mod`, `cmd/vettid-agent` with `version`; README and CLAUDE.md rewritten (what the connector is, that it needs a staging vault until production lists `leash`); CI on Linux, macOS and Windows runners (actions pinned by SHA, `go-version-file`, `go vet`, `go test -race` where cgo exists, gitleaks, govulncheck); issue dispositions of §1; old releases marked | CI green on all three runners; `vettid-agent version` prints version, commit and Go version |
| A0.2 | The vettid-vault and vettid-relay dependencies at a pinned commit; `docs/SOURCE.md`; a compile test importing `client` and `vms/leashwire`; the `leash.json` check of §5 | CI green; `go mod verify`; the binary size recorded in the PR |

**Exit A0**: CI green on `main` on three platforms.

### A1 — State and protectors (a §9 rule 6 path)

| PR | Contents | Acceptance |
|---|---|---|
| A1.1 | `internal/state`: format, atomic write, lock, owner-only files (POSIX; Windows DACL), wipe; `statefile.json` | Vectors; a second process cannot take the lock; a group-readable file (POSIX) or a DACL with another user's entry (Windows job) is refused; a crash between write and rename leaves the old state readable |
| A1.2 | `internal/protect`: the interface and the passphrase protector (Argon2id, strength rules, prompt / fd / file sources) | Round trip; weak passphrases refused; the passphrase never reaches logs (a test greps the captured log) |
| A1.3 | Linux TPM 2.0 protector (pure-Go TPM library, resource manager device), with the fallback rule of AG3 | On a TPM machine: sealed key unseals; the state copied to another machine does not open; without a TPM, the passphrase protector is chosen and `status` says so. CI uses a software TPM simulator where available |
| A1.4 | Windows DPAPI protector (user scope, `golang.org/x/sys/windows`) | Windows job: round trip; another user cannot open (manual check recorded in the PR) |
| A1.5 | macOS Keychain protector (cgo, `ThisDeviceOnly`, not synchronizable) | macOS job: round trip; the item is not synchronizable; deleting the item makes the state unopenable |

### A2 — Pairing, the vault session, access sessions

| PR | Contents | Acceptance |
|---|---|---|
| A2.1 | `vettid-agent pair`: code parsing, name, `client.New` + `Pair`, SAS, wait for `device.paired` / `device.pair.rejected` / 10 minutes, state saved per step | `invite.json`, `handshake.json`; unit tests with recorded messages for paired, rejected and expired; texts of §11 |
| A2.2 | `internal/vaultconn`, run inside `vettid-agent mcp`: one owning goroutine, long-poll collect, dispatch by `re`, save before ack, token and rekey maintenance, identity rotation, `device.unlinked` and `token_revoked` (AG12) | Unit tests: a crash after save and before ack replays without harm; a crash before save does not lose a rekey (the batch is collected again); `device.unlinked` wipes; `token_revoked` alone stops without wiping |
| A2.3 | `internal/access`: AG8's policy, `device.session.request`, `.granted`, `.ended`, expiry, `session_required`, `owner_check_required`; `status` | Unit tests for every branch of AG8 (one outstanding, 10-minute quiet period after a denial, 6 an hour) |
| A2.4 | `internal/devstack` harness (build tag `devstack`): find or start one dev stack, `vaultctl` as the app (§4.8), the relay mapping; `make devstack-test` running with `-p 1` | **Exit A2 test**: enroll a test vault with `vaultctl`, create and unlock its credential, pair the connector with `session_seconds: 600`, compare the SAS on both sides, see `vault.status` answered, end the session from the app, request a new one and approve it, unlink, see the connector wipe itself. A rejected pairing ends with "Rejected on your phone" |

### A3 — LEASH and the MCP server

| PR | Contents | Acceptance |
|---|---|---|
| A3.1 | `internal/leash`: grants from `leash.grant.updated` and `leash.grant.list` at each session start, `suspended`, status statement cache and refresh; grants shown by `vettid-agent status` and `leash.connection_info` | `leash.json`; unit tests: a revoked grant is never presented; nothing is presented while suspended; refresh at a quarter of the lifetime |
| A3.2 | `agent.request` (`catalog`, `item.get`, `item.use`) with `approval.waiting`, retries reusing the inner id, pending results kept 10 minutes (AG9), no retry after `forbidden` | Unit tests for allow, refer-then-approve, refer-then-deny, `approval_timeout`, `forbidden`, `owner_check_required`, locked vault |
| A3.3 | `internal/mcp` and `vettid-agent mcp`: the five LEASH tools over stdio, the local rate limit, golden files; README section for configuring MCP clients | Golden files; an MCP client library test drives `tools/list` and every tool against a fake vault connection; a second `mcp` on the same state exits with "in use by another agent app"; nothing is written to standard output but MCP messages |
| A3.4 | Dev-stack LEASH tests | **Exit A3 test**: with `vaultctl` as the app: a share rule for the agent (`share set -agent`, `ask`) → `leash.list_available` empty until the member approves the item → `leash.request_secret` returns the value; an `auto` rule within limits returns at once; past `per_hour` the request is referred and approved; `leash.execute_action` returns the HMAC the test computes; a critical item is never listed or readable; revoking the rule stops reads at once; a loop of refused requests suspends the connector and `leash.connection_info` shows it; `leash.agent.resume` restores it; the hold (dev stack clock) gives `owner_check_required` |

### A4 — Delegable owner types (v1.1, after the owner confirms AG5)

| PR | Contents | Acceptance |
|---|---|---|
| A4.1 | `vettid.connections.*`, `vettid.profile.get` | Dev stack: grants with and without `connections` restrictions; a request outside them refused |
| A4.2 | `vettid.messages.*` | Dev stack with the dev stack's peer: `message.send` under an `ask` grant is referred and, once approved, reaches the peer; a message with only an attachment is invisible; `message.send` with an attachment is refused |
| A4.3 | `vettid.actions.*` | Dev stack: `action.invoke` under a grant; the connector's `action.respond{approve: true}` refused (§6.8) |

### A5 — Platforms, packaging, signing

| PR | Contents | Acceptance |
|---|---|---|
| A5.1 | Reproducible release build script and workflow (unsigned artifacts, `SHA256SUMS`), and a `verify-reproducible` script | Two clean builds produce identical hashes on Linux amd64 and arm64 |
| A5.2 | Signing procedure for the owner: the release key's signature over `SHA256SUMS` (algorithm id in the format, AG4), verification instructions and the public key's place on vettid.org | The owner signs a release candidate offline; the verification instructions succeed on a clean machine |
| A5.3 | macOS notarization and Windows Authenticode steps, run by the owner with the owner's own keys | Gatekeeper accepts the notarized binary; a signed Windows binary runs under Smart App Control in enforcement mode (#5 closed) |

### A6 — Staging with the Android app (after AA1–AA5, §7.2)

Checklist in `docs/STAGING-CHECKLIST.md` in vettid-agent, run with a
**staging test account** on the Android staging app on a test phone:
pair by copying the code, compare the SAS, approve with a session and a
grant; read an item shared with the agent (ask, then auto); approve and
deny referred requests in Approvals; see the agent's activity in History
(`agents`); end the session, revoke, resume after a suspension, unlink.
**Exit A6** is the owner running the checklist in person.

### What blocks what

| Phase | Blocked by |
|---|---|
| A0, A1 | AG0–AG3 answered |
| A2.2 (without the owning-goroutine workaround) | AV1, AV2 (§7.1); not blocking: the workaround of §3.2 |
| A2.4, A3.4 | a dev stack that runs on the implementing machine (memory, §9 rule 8) |
| A4 | AG5's v1.1 confirmed |
| A5.2, A5.3 | AG4 and the owner's keys (§8) |
| A6 | Android AA1–AA5 on staging (§7.2), ANDROID-PLAN's "Devices & agents" approved |
| Production | a production release whose channel lists `leash` (§11.10.8, STAGING-DEVELOPMENT-PLAN §2.4) and the Android work in a production app |

## 7. Work outside vettid-agent

### 7.1 vettid-vault (reference client and dev stack; AV6 in the enclave)

Each its own small vettid-vault PR, by an agent working in that
repository. AV1–AV5 do not change the enclave or need a release; AV6
changes the enclave and ships in a staging release.

| # | Task | Spec | Why | Blocks |
|---|---|---|---|---|
| AV1 | **Save before acknowledging**: a `Config.Persist func(state []byte) error` called after a collected batch is handled and before its acks (an error leaves the batch unacknowledged, to be collected again) | §8.3 (the vault's rule; the same reasoning for a device) | `client.Poll` acks each message right after handling it; a crash before the caller's `Save` loses a rekey, a token or `device.paired` that the relay will not deliver again | — (workaround in A2.2) |
| AV2 | **One collecting loop**: `(*Device).Run(ctx)` collects (long poll or WebSocket) and dispatches; `Request`, `Op`, `WaitEvent` and `LeashPresent` wait on it when it runs, instead of collecting themselves | §8.1 | Concurrent tool calls in a daemon each collect today, and whichever collects first consumes the others' messages into the shared buffer | — (workaround in A2.2) |
| AV3 | **Approvals and retries**: `AwaitResponse` extends its wait to `approval.waiting`'s `exp` for its request and exposes the `approval_id`; an optional application retry reusing the inner id, at most twice | §6.8 step 1, §8.1, §8.6 | Today a referred request times out on the caller's deadline and is never retransmitted | — |
| AV4 | **Wallet out of the import graph**: move `client/wallet.go` (and its `vms/btc` use) to `client/wallet` | — | Importers of `client` compile btcsuite and decred secp256k1 for nothing | — |
| AV5 | **Dev stack for a non-phone app**: document (README "Local dev stack") how `vaultctl` enrolls a second test vault, creates and unlocks its credential and pairs an agent with grants; add a control endpoint only if a step cannot be done with `vaultctl` | §6.7, §10.11 | The connector's integration tests need a member's app that can sign grants; the dev stack's peer has no credential | A2.4 |
| AV6 | **The bound on access-session prompts** (VAULT-MESSAGING 0.40.0, §7.3 Q3): a `device.session.request` within 10 minutes of the device's last accepted one is answered `too_soon` (`{allowed_after}`), notifies no app and records no feed item, and does not replace a pending request; tests for each case. An enclave change: in the next staging release | §6.8, §10.3 | `hSessionRequest` (`vault/access.go`) notifies the apps and records a high-priority feed item for every request; only "newest replaces older" bounded them | — |

### 7.2 vettid-android (ANDROID-PLAN "Devices & agents", owner approval)

ANDROID-PLAN lists Devices & agents as a later drawer entry and a later
phase (§4 "Drawer", §6 "Calls, devices/agents/LEASH, … follow v1").
Before any of this is built, ANDROID-PLAN needs a "Devices & agents"
section with screens and texts, approved by the owner (§7.4). The
connector's staging phase A6 needs AA1–AA5.

| # | Work | Spec | Today |
|---|---|---|---|
| AA1 | **Devices & agents screen**: `device.list` (name, role, last active, access session and its end), unlink (`device.unlink`, with a confirmation), end an access session (`device.session.end{device_id}`) | §10.3, §6.8 | none |
| AA2 | **Pair an agent**: `device.pair.create{role: "agent"}`, the QR and the code with Copy and Share (the code expires in 10 minutes), `device.pair.pending` → the SAS comparison screen ("Does the agent show 123 456?"), reject (`device.pair.reject`), approve with a first access session length (`session_seconds`) and optional initial grants; grants need the credential's unlock window (`credential_locked` → ask for the password, then approve) | §6.7, §10.3, §10.11 | QR kinds parsed only |
| AA3 | **An agent's permissions**: list (`leash.grant.list{agent_id}`), add or change (`leash.grant.issue`, within the unlock window: scope, Ask me each time / Allow automatically, connections, per hour / per day for `auto`, ends, status lifetime), revoke (`leash.grant.revoke`), resume after a suspension (`leash.agent.resume`); `sync.event` `leash.grant.changed`, `.revoked`, `leash.agent.suspended` | §10.11 | none |
| AA4 | **Agent share rules** (`items.read`): the share-rule editor with an agent as subject, including `per_hour` and `per_day` (agent rules only, ANDROID-PLAN §4 rule editor note; VAULT-MESSAGING 0.23.0) | §10.12, §10.11 | model only (`ShareSubject.agentId`) |
| AA5 | **Approvals for agents**: approve (not only decline) `device.session.pending` with a changeable length, and `approval.pending` for an agent's `agent.request` (say which item, "read" or "use", and which agent) and for delegable owner types; replace "This version of the app does not pair desktops or agents, so it can only decline." | §6.8, §10.3 | decline only |
| AA6 | **Feed and History**: details for `leash.*` (`leash.rate_limited`, `leash.referrals_limited`, `leash.agent.suspended`, `leash.item.read`, `leash.item.used`, summaries), which today open "Not available in this version of the app" (ANDROID-PLAN §4 feed table); the `agents` History category | §10.9, §10.11 | texts only |

IOS-PLAN places devices and agents in its "Later" list, following
Android; nothing here blocks on iOS.

### 7.3 Spec questions (answered by the owner, 2026-10-17)

| # | Question | Where | Answer |
|---|---|---|---|
| Q1 | LEASH §3.4 says the connector "MUST report a cryptographic hash of its binary to the vault during enrollment and periodically thereafter", while VAULT-MESSAGING §10.11 puts binary attestation "out of the vault's scope", so no message carries it | LEASH §3.4; §10.11 | **Recorded as a known difference** in LEASH-IMPLEMENTATION ("Platform binding and binary attestation"): a self-reported hash proves little without hardware attestation. Revisited with reproducible, signed builds (A5) |
| Q2 | The proof of possession a relying party asks for (§10.11 verification step 6) has no defined format, and LEASH §3.3 leaves the MCP carriage "to be specified" | §10.11; LEASH §3.3 | **Waits**: presentation to other tool servers stays out of v1 (AG5) |
| Q3 | Nothing bounded how often a paired desktop or agent may send `device.session.request`; each one is a high-priority prompt on the member's phone | §6.8 | **VAULT-MESSAGING 0.40.0**: at most one accepted request per device every 10 minutes, others answered `too_soon` with `allowed_after` and shown to no app; built in AV6. The connector keeps AG8's own bound and treats `too_soon` as "ask again after `allowed_after`" |
| Q4 | A device offline longer than its standing token and the relay's message retention cannot deposit to its vault again | §7.1, §7.2 | **VAULT-MESSAGING 0.40.0 §7.2**: re-pairing is the way back (§4.6) |
| Q5 | §6.7 said an agent "learns [its initial grants] in `leash.grant.updated`", which the vault sends only within an access session (§10.11) | §6.7, §10.11 | **VAULT-MESSAGING 0.40.0 §6.7**: the agent fetches its grants with `leash.grant.list` whenever a session starts (as §4.5 does) |

### 7.4 vettid.org (owner approval)

- ANDROID-PLAN: the "Devices & agents" section of §7.2 (screens, texts,
  the History details), as its own version.
- STAGING-DEVELOPMENT-PLAN §5 row 3: record AG0 and this plan.
- LEASH-IMPLEMENTATION "Connector": rewritten when A3 is on staging (an
  MCP server; the platform binding of AG3; Q1's deviation).
- PQC-MIGRATION §4 row 5: name the connector's release signing as the
  first user of the release root (AG4).
- A page for the connector's downloads and signature verification, with
  the release public key, when A5 ships (the site's logs and their
  readers are unchanged).
- The spec questions of §7.3.

## 8. Owner prerequisites

1. **Decisions**: all of §2 decided or accepted (2026-10-17); the §7.3 questions remain.
2. **Release signing key** (AG4): generated and held offline by the
   owner; its public key published on vettid.org. The implementing agent
   never creates, reads or asks for signing material.
3. **Apple**: a Developer ID Application certificate in the owner's team
   for the connector, and notarization credentials, used on the owner's
   Mac (A5.3).
4. **Windows**: an Authenticode code-signing certificate whose key is on
   a hardware token the owner holds (A5.3).
5. **Staging**: a staging test account and the Android staging app on a
   test phone (A6); real member data is never used.
6. **GitHub**: the phase issues; branch protection on `main` with the
   three CI jobs required.

## 9. Coordination rules

1. **Scope.** The implementing agent works in `vettid-agent`. It reads
   vettid-vault, vettid-relay, vettid-android and vettid.org; it never
   pushes, comments or opens PRs there, except issues on vettid.org
   (rule 4) and the vettid-vault PRs of §7.1 when the owner assigns them.
2. **Small PRs**, one per row of §6, each with its tests passing locally
   before it is pushed; titles name the row (`A2.1: pairing`). The owner
   merges; the agent never merges.
3. **Public text** (commits, PRs, issues, code comments, this plan)
   never mentions reviews, finding ids, private
   files, local paths outside the repository, or device serials. It
   cites specifications by document and section.
4. **Spec questions go to the owner** as a vettid.org issue (title
   starting `AGENT-PLAN:`), never as an edit to a specification. Where
   the spec is silent, the agent chooses, marks it "(chosen; not in the
   spec)" in the PR, and asks.
5. **No secrets in the repository**: no keys, tokens, pairing codes,
   state files, passphrases or member data; test keys only from fixed,
   public test seeds; gitleaks in CI.
6. **Independent review before merge** for behaviour-changing fixes on
   the lock, unlock, erase and recovery paths, which here are: the state
   store and protectors (A1), wiping on `device.unlinked` and `forget`
   (AG12), pairing (A2.1) and the save-before-ack rule (A2.2). The owner
   arranges it; such fixes fail secure, retry where safe, and tell the
   operator plainly.
7. **Vectors** are stop-and-report items; never edited or skipped.
8. **Machine load**: one heavy command at a time; `go test -p 1` for
   integration packages and `-p 2` at most otherwise; one dev stack at a
   time, torn down when done; no parallel test runs from several agents
   on one machine.
9. **Commit trailers and PR bodies**: as the harness provides them; no
   other attribution.

## 10. Risks

1. **Prompt injection reads secrets into an agent's context.** Pattern 1
   (`item.get`) hands the value to the agent by design. Mitigation:
   `ask` defaults, per-item inclusion, rate limits and suspension in the
   vault; tool texts steer to `item.use`; values never cached.
2. **Dependency on vettid-vault's code.** A change in the client or the
   wire packages lands in the connector at the next pin update.
   Mitigation: pinned commits, vectors (§5), update PRs with the
   dev-stack tests.
3. **Weak binding in headless mode.** The passphrase protector is not
   machine-bound (§4.2). Mitigation: said in `status` and the docs;
   TPM where present.
4. **Malware running as the operator.** It could read the state file
   with the operator's rights (where no hardware protector binds it) or
   start the connector itself. Mitigation: no listener of any kind, so
   only a process that starts the connector reaches its tools; the TPM,
   Keychain or DPAPI protector; and the vault, not the connector,
   enforces grants, limits and approvals.
5. **Vault locked or held.** Agents stall; status statements lapse
   (fail closed, as designed). Mitigation: clear tool errors (§11).
6. **Long-offline connectors** need re-pairing (§4.6, Q4).
7. **Unsigned or unknown binaries blocked** on Windows (Smart App
   Control) and macOS (Gatekeeper). Mitigation: AG4 signing before
   those platforms are offered.
8. **MCP churn.** Transports and client behaviour change. Mitigation:
   the MCP layer is one package with golden files.
9. **Member attention.** Session requests and referrals are prompts on
   the phone. Mitigation: the vault's referral cap and its bound on session prompts (Q3, AV6); AG8's bound.

## 11. Draft texts

Connector (terminal and MCP tool errors):

- **Pairing, start**: "Paste the pairing code from Devices & agents on
  your phone. It expires 10 minutes after the phone showed it."
- **SAS**: "Check that your phone shows the same code: 123 456. Approve
  on your phone only if it matches."
- **Waiting**: "Waiting for you to approve on your phone…"
- **Paired**: "Paired with your vault. Your phone decides what this
  agent may do."
- **Rejected** (§6.7): "Rejected on your phone."
- **Expired**: "The pairing timed out. Start again from your phone."
- **Access requested** (AG8): "This agent needs access to your vault.
  Allow it on your phone, then try again."
- **Access denied**: "Access was declined on your phone."
- **Waiting for approval** (AG9): "Waiting for your approval on your
  phone. Check again with leash.check_status."
- **Denied** (`denied`): "Declined on your phone."
- **Not allowed** (`forbidden`): "Your vault does not allow this agent
  to do that. You can change its permissions on your phone."
- **Vault locked or unreachable**: "Your vault did not answer. It may be
  locked; unlock it on your phone."
- **Daily check** (`owner_check_required`): "Your vault is waiting for
  your daily check. Open VettID on your phone."
- **Suspended**: "Your vault paused this agent after repeated refused
  requests. You can resume it on your phone."
- **Unlinked** (AG12): "This agent was removed from your vault. Its
  keys have been deleted from this computer."
- **Refused by the relay** (AG12): "Your vault's relay refused this
  agent. If you removed it on your phone, run `vettid-agent forget`."
- **Not machine-bound** (`status`, passphrase protector): "Keys are
  protected by your passphrase only, not bound to this computer."

Android (drafts for the ANDROID-PLAN section of §7.4; Android's own
wording rules apply):

- **Pair an agent, code screen**: title "Pair an agent"; body "Copy this
  code to the computer where the agent runs. It works once and expires
  in 10 minutes."
- **Compare**: "Does the agent show 123 456? Approve only if the codes
  match."
- **Approve with access**: "Allow access for 1 hour" (with a length
  picker); "Agents act only while you allow access, and only within the
  permissions you give them."
- **Grant, ask mode**: "Ask me each time" / "Allow automatically, up to
  60 times an hour".
- **Agent request in Approvals**: "<agent> wants to read <item>" /
  "<agent> wants to use <item> without seeing it".
