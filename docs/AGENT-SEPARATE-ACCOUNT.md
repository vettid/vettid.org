---
title: AGENT-SEPARATE-ACCOUNT
status: draft; design note for the owner's approval. Nothing here is built; AGENT-PLAN and the code follow once it is approved
version: 0.1.0
date: 2026-11-05
owner: Al Liebl (Mesmer)
component: vettid-agent (the agent connector): install, process model, keys at rest, runs and proxies
related:
  - AGENT-PLAN.md (0.1.9; 0.1.10 in vettid.org #538) AG1a, AG3, §4.2, §4.7, §4.9, A3.8, A3.9, A5
  - VAULT-MESSAGING.md (0.84.0; 0.85.0 in #538) §10.11 "Ways to use a secret"
changelog:
  - 0.1.0: first draft, 2026-11-05. Owner decision of 2026-11-05
    (thread 01M6PDSRYVSZW19F68VE55KWSA): option c, the connector
    runs in an account of its own before runs and proxies ship, as the
    default, with a stub in the agent's account
---

# The agent connector in its own account (design note)

## 1. Why

An agent that runs under the same operating-system account as the
connector can, while a run lasts, open the run's `file` secret, read
the program's environment and memory, and attach to it. The same holds
for a proxy's value in the connector's memory. No check inside the
connector can stop this, since the system treats them as one user
(AGENT-PLAN 0.1.10 §4.9, "A separate account is the only full
protection"). Today the MCP client starts the connector as its own
child (AG1a), so the two always share an account.

**Owner decision of 2026-11-05 (option c, as the default).** The
connector, and the programs it runs, run under an account of their own.
In the agent's account there is only a stub. Runs and proxies ship only
in this mode.

## 2. The shape

```
 agent's account                      the connector's account
 ┌───────────────┐   stdio  ┌──────┐  local channel  ┌──────────────────────┐   relay
 │ MCP client    │ ───────► │ stub │ ──────────────► │ connector service    │ ─────► vault
 │ (the agent)   │          └──────┘  (peer-checked) │ keys, state, run/,   │
 └───────────────┘                                   │ runs, proxies        │
                                                     └──────────────────────┘
```

- **The stub** is `vettid-agent mcp`, as the MCP client starts it
  today. It holds no keys, no state and no values. It passes MCP
  messages between its standard input and output and the local channel,
  unchanged. It exits when the client closes it.
- **The connector service** is the connector as built (pairing, the
  vault session, LEASH, the tools), in its own account, started by the
  system. It holds the state file and `run/`, and starts runs and
  proxies. It reaches the vault's relay as today.
- **What the separation gives.** The agent can still call every tool:
  reaching the tools is its job, and the vault's rules decide what it
  gets. It can no longer read the connector's keys or state, a run's
  secret file, a run's environment or memory, or a proxy's value.

## 3. Accounts and install

The install needs an administrator once. The connector itself never
runs elevated (AGENT-PLAN §4.7).

| Platform | Account | Started by | State |
|---|---|---|---|
| Windows | a virtual service account, `NT SERVICE\vettid-agent-<n>` (no password, no logon) | a Windows service, automatic start | `%ProgramData%\VettID\agent\<n>\`, owner the service SID only; keys under that account's DPAPI (AG3) |
| macOS | a hidden user `_vettid<n>` | a launchd daemon | `/Library/Application Support/VettID/agent/<n>/`, 0700 |
| Linux | a system user `vettid-agent-<n>` | a systemd system service | `/var/lib/vettid-agent/<n>/`, 0700; the TPM or passphrase protector of AG3 |

- **One instance per pairing.** AG1a's "one pairing per MCP client"
  stays: `<n>` names a pairing, and each pairing has its own account,
  service, state and channel. `vettid-agent install --name <n>` makes
  one; the stub takes `--name <n>` where it takes `--state-dir` today.
  A second stub on the same pairing gets "in use by another agent app",
  as today.
- **Bound to one member user.** The installer records the Windows SID,
  or the uid, of the user who ran it (the member's own account, not the
  administrator's). Only that user's processes may use the channel.
- **Uninstall** stops and removes the service, its account and its
  state directory, after overwriting the state file. What is left
  behind is checked on this machine (CLAUDE-windows.md) and listed in
  the README.
- **Upgrade** replaces the program files (administrator-only folders)
  and restarts the service; the state stays.

## 4. The local channel

AG1a rejected a socket because "every process of the operator's user
can reach the socket". That is still true here, and accepted: those
processes include the agent, which may use the tools anyway. What the
channel must stop is any other user reaching the tools, and anyone
standing in for either end.

- **Windows**: a named pipe `\\.\pipe\vettid-agent-<n>`, created by the
  service with `FILE_FLAG_FIRST_PIPE_INSTANCE` (so no other process
  can have created it first). Its DACL admits only the member's SID and
  the service SID. The service checks each client's token
  (`ImpersonateNamedPipeClient`, then the token's user) against the
  recorded SID. The stub checks the server: the pipe's server process
  (`GetNamedPipeServerProcessId`) runs as the service SID, otherwise it
  refuses to connect, so a process that grabbed the name cannot pose as
  the connector.
- **macOS and Linux**: a Unix socket in a root-owned directory
  (`/run/vettid-agent/`, `/var/run/vettid-agent/`), the socket owned by
  the service account. The service checks the peer's uid
  (`SO_PEERCRED`, `getpeereid`) against the recorded uid; the stub
  checks that the server's uid is the service account's.
- **What crosses it**: MCP messages only, framed as on stdio. No file
  descriptors and no handles are passed. The service never reads a
  path or a file the stub names on its behalf except as a tool's
  argument (`cwd`, below).

## 5. Pairing and the terminal commands

`pair`, `status` and `forget` run in the member's account and talk to
the service over the same channel. The SAS and the texts of AGENT-PLAN
§11 are shown by the command, as today. The pairing code is passed once
over the channel and never stored or logged (AGENT-PLAN §4.7).

## 6. Runs under the connector's account

A run's program now runs as the connector's account. That keeps its
secret from the agent, but it also means **the program cannot read the
member's files**. This is the main cost.

- **The default directory** is the run's `work/`, as today.
- **A member's folder** (`cwd` such as a git repository in the member's
  home) is used only if the member has shared it with the connector.
  Proposed: the item's run binding gains `folders` (absolute paths, at
  most 16), set on the phone. The installer, or `vettid-agent share
  <folder>` in the member's account, grants the connector's account
  access to a listed folder. A `cwd` outside the shared folders is
  `cwd_not_allowed` (NEW code), plainly. The vault checks `cwd` against
  `folders` as it checks `program` against `programs`. This needs a
  VAULT-MESSAGING change (§9, question 1).
- **What the account does not fix, said plainly.** A program still
  reads what the agent can write. In a shared folder the agent can
  change the inputs: a repository's `.git/config` can name a command
  (`core.sshCommand`, `core.fsmonitor`) that git then runs, with the
  secret. Git refuses a repository owned by another user unless it is
  marked `safe.directory`, and the connector does not mark it for the
  member. A shared folder that the agent can write remains a way to
  steer a run, as is any argument. A run is still for a member who
  reads the command (AGENT-PLAN §4.9, "The limit").
- **The pin** (VAULT-MESSAGING 0.85.0) still applies, and is stronger
  here: a program in an administrator-only folder, run under an account
  the agent cannot touch, can no longer be attached to or read.

## 7. Proxies

The proxy's listener stays on 127.0.0.1 in the service, with its token
(AGENT-PLAN §4.9). Any local process that has the token can use it, as
today; the value itself stays in the service's memory, which the agent
cannot read.

## 8. No silent fallback

- `leash.run_with_secret` and `leash.open_proxy` work only when the
  stub reaches a service in its own account. Otherwise they answer
  `separate_account_required` (NEW code) with the NEW text "Running
  programs and opening proxies with a secret need the connector
  installed in its own account. Run `vettid-agent install` as an
  administrator, then try again."
- The connector as built today (one process, the agent's account)
  stays available for `use`, the catalog and reveal, which give the
  agent nothing a separate account would keep from it. Its `status`
  says "Runs and proxies are off: the connector runs in this agent's
  account." (NEW).
- A service whose account turns out to be the member's (a wrong
  install) refuses to start runs and proxies, and says why.

## 9. Questions for the owner

1. **Member folders for runs (§6).** a (recommended): `folders` in the
   item's run binding, set on the phone, with a VAULT-MESSAGING change;
   b: runs only in `work/`, no member folders (simplest; `git push` in
   the member's repository then does not work); c: any folder the
   member shares at install, not per item (no spec change, coarser).
2. **The same-account connector (§8).** a (recommended): keep it for
   `use`, the catalog and reveal; b: drop it, the service only.
3. **One instance per pairing (§3).** a (recommended): an account and
   service per pairing, as AG1a's one pairing per client; b: one
   service per member user holding several pairings (fewer accounts,
   but the pairings share an account).

## 10. What changes elsewhere, once approved

- **AGENT-PLAN.**
  - AG1a gains the exception: the stub, the service and their channel.
  - AG10 (daemon and service files) comes back for the service only.
  - §4.2: keys under the service account.
  - §4.7: "never listens" gains the channel.
  - §4.9: runs and proxies only in this mode.
  - New PRs before A3.8a ships: the service and stub (A3.10), the installer and uninstaller per platform (A5), and the channel tests.
  - The dev-stack tests run the service under a test account.
- **VAULT-MESSAGING.** `folders` and `cwd_not_allowed`, if question 1 is a.
- **The Android app.** The binding's folders (AA7), if question 1 is a.
- **Tests on Windows** (this machine):
  - an install and uninstall leave nothing behind;
  - the service account's DPAPI;
  - the pipe refuses another user and a squatted name;
  - an agent in the member's account cannot open a run's process or secret file;
  - sleep, a second Windows user, and Defender or SmartScreen on the service.
