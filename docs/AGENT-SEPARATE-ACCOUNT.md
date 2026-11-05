---
title: AGENT-SEPARATE-ACCOUNT
status: draft; design note for the owner's approval. Nothing here is built; AGENT-PLAN and the code follow once it is approved
version: 0.1.0
date: 2026-11-05
owner: Al Liebl (Mesmer)
component: vettid-agent (the agent connector): install, process model, keys at rest, runs and proxies
related:
  - AGENT-PLAN.md (0.1.9; 0.1.10 in vettid.org #538) AG1a, AG3, AG4, AG11, §4.2, §4.6, §4.7, §4.9, A3.8, A3.9, A5
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
connector, and the programs it runs, run under accounts of their own.
In the agent's account there is only a stub. Runs and proxies ship only
in this mode.

## 2. The shape: three accounts

```
 member's account          connector account (per pairing)       runner account (per pairing)
 ┌────────────┐  stdio ┌──────┐  channel  ┌───────────────────┐ starts ┌─────────────────────┐
 │ MCP client │ ─────► │ stub │ ────────► │ connector service │ ─────► │ a run's program      │
 │ (agent)    │        └──────┘ (checked) │ keys, state, the  │        │ (its secret only)    │
 └────────────┘                           │ vault session,    │        └─────────────────────┘
                                          │ proxies           │ ──► relay ──► vault
                                          └───────────────────┘
```

- **The stub** is `vettid-agent mcp`, as the MCP client starts it
  today. It holds no keys, no state and no values. It passes MCP
  messages between its standard input and output and the local channel,
  unchanged, and exits when the client closes it.
- **The connector service** is the connector as built (pairing, the
  vault session, LEASH, the tools, proxies), in its own account,
  started by the system. It holds the state file. It reaches the
  vault's relay as today.
- **The runner account.** A run's program is chosen by the agent and
  steered by its arguments, so it must not run where the keys are: as
  the connector's account it could read the state file and unwrap it,
  open the connector and read every other run's secret and every
  proxy's value, or change the profile later runs use. So programs run
  under a third account, one per pairing, that can read none of the
  connector's state, profile or process. The connector starts each run
  as that account (below) and gives it only that run's secret.
- **What the separation gives.** The agent can still call every tool:
  reaching the tools is its job, and the vault's rules decide what it
  gets. It can no longer read the connector's keys or state, a run's
  secret file, a run's environment or memory, or a proxy's value. A run
  can read its own secret, which it was given, and nothing else the
  connector holds.
- **What it does not give, said plainly.** A run is still steered by
  what the agent can write (its arguments, and the files in a shared
  folder, §6). Any agent app in the member's account can use any of
  the member's pairings through the channel, including `forget`, as
  before. The vault cannot tell which mode a pairing runs in (AG11 is
  self-asserted): "runs and proxies only in this mode" is the
  connector's own policy, and an agent that pairs a connector of its
  own making can ask for `item.run` itself. So the member approves only
  pairings they made, and the phone shows each pairing as today.

## 3. Accounts and install

The install needs an administrator once. The connector never runs
elevated or as SYSTEM (AGENT-PLAN §4.7).

| Platform | Connector account | Runner account | Started by | State |
|---|---|---|---|---|
| Windows | `NT SERVICE\vettid-agent-<n>` (a virtual service account) | a local user `vettid-run-<n>`, no logon right, random password kept only as the service's LSA secret | a Windows service | `%ProgramData%\VettID\agent\<n>\`, owner the service SID only |
| macOS | a hidden user `_vettid<n>` | a hidden user `_vettidrun<n>` | a launchd daemon | `/Library/Application Support/VettID/agent/<n>/`, 0700 |
| Linux | a system user `vettid-agent-<n>` | a system user `vettid-run-<n>` | a systemd system service | `/var/lib/vettid-agent/<n>/`, 0700 |

- **Windows privileges.** Services get `SeImpersonatePrivilege` by
  default, and code holding it has known ways to SYSTEM. The service is
  installed with its privileges cut to `SeChangeNotifyPrivilege` and
  the two that `CreateProcessAsUser` needs (`SeAssignPrimaryTokenPrivilege`,
  `SeIncreaseQuotaPrivilege`), and every run starts
  under the runner account with a restricted token, in a job object.
  Identifying the pipe's client does not need the impersonation
  privilege.
- **Starting a run as the runner.** Windows: `CreateProcessAsUser` with
  the runner's token, the handle list limited to the run's standard
  handles (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`), suspended, then the
  image check of AGENT-PLAN §4.9. POSIX: starting a process as another
  user needs root, which the connector never holds. Linux: the service
  manager starts each run as a transient unit with the runner's uid
  (`systemd-run --uid`), allowed to the connector's account by a polkit
  rule that permits nothing else. macOS: a small root helper, installed
  with the daemon, whose only job is to start a run as the runner and
  report its exit. Either is settled in A3.10, with its own review. Every other descriptor is
  close-on-exec; tests check that a run inherits only its standard
  streams.
- **Keys at rest (AG3).**
  - Windows: DPAPI of the connector's virtual account. Its master key is
    protected by LSA secrets, so any SYSTEM process can decrypt it. The
    roaming-profile and domain-account notices of §4.2 no longer apply.
  - macOS: the data protection keychain needs a logged-in user, which a
    daemon user never has. The protector is the system keychain, with
    an access list naming only the connector's binary, or the
    passphrase protector (question 4).
  - Linux: a system service cannot prompt. Use the TPM (the service
    user in the `tss` group) or a `systemd-creds` credential
    (`LoadCredential=`), not a passphrase typed at start.
- **One instance per pairing.** AG1a's "one pairing per MCP client"
  stays: `<n>` names a pairing, and each pairing has its own two
  accounts, service, state and channel. `vettid-agent install --name
  <n> --member <user>` makes one; the stub takes `--name <n>` where it
  takes `--state-dir` today. Names are unique on the computer, and a
  second install with the same name is refused. A second stub on the
  same pairing gets "in use by another agent app", as today.
- **Bound to one member user.** Under UAC the user who ran the
  installer is the administrator, so the member is named explicitly
  (`--member`) and confirmed. Only that user's processes may use the
  channel.
- **The operator's flags.** `--run-path` and `--run-env` are no longer
  the stub's: an agent could set them by editing its own MCP
  configuration. They live in the service's configuration file, which
  only an administrator can change, and the `--run-path` check of
  AGENT-PLAN §4.9 tests whether the **member's** account, the runner
  account, or any non-administrator can change the folder.
- **Uninstall** stops and removes the service, both accounts and the
  state directory, after overwriting the state file. What is left
  behind is checked on Windows here and listed in the README.
- **Upgrade** replaces the program files (administrator-only folders)
  and restarts the service; the state stays. The stub and the service
  exchange their versions on connect; a mismatch is refused with a
  plain text (NEW, §8) rather than half working.
- **Logs** go to the system log (Windows Event Log, `os_log`, the
  journal) under the pairing's name, readable by the member, never with
  a value, code, SAS or email address in them (AGENT-PLAN §4.7).
  `vettid-agent status` shows the latest refusal reasons, so the member
  never needs to read the service's state.
- **Crash restart** by the service manager (Windows recovery actions,
  systemd `Restart=on-failure`, launchd `KeepAlive`), at most a few
  times a minute.
- **Unsigned builds.** Windows Authenticode waits for the business
  entity (AGENT-PLAN 0.1.6). Smart App Control or SmartScreen may block
  an unsigned service; tested on Windows here before A5.

## 4. The local channel

AG1a rejected a socket because "every process of the operator's user
can reach the socket". That stays true, and is accepted: those
processes include the agent, which may use the tools anyway. What the
channel must stop is any other user reaching the tools, and anyone
standing in for either end. Every failed check refuses the connection,
and the service never takes another name.

- **Windows**: a named pipe `\\.\pipe\vettid-agent-<n>`.
  - The service creates it with `FILE_FLAG_FIRST_PIPE_INSTANCE`. If the
    name is taken (another user created it first, at boot or during a
    restart), the service does not start: it logs it and `status` says
    so (NEW text, §8). That is a denial of service by a local user, not
    a disclosure.
  - Its DACL gives the member's SID read and write of data only, never
    `FILE_CREATE_PIPE_INSTANCE` (the same bit as `FILE_APPEND_DATA`, so
    not `GENERIC_WRITE`). Only the service SID may create instances.
  - The service identifies each client from its token at
    identification level and compares it with the recorded member SID.
    A client at anonymous level is refused.
  - The stub, `pair`, `status` and `forget` open the pipe with
    `SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION`, so a server that
    is not the service cannot act as the member. They check the server
    by the pipe object's owner SID, read through the open handle
    (`GetSecurityInfo`), which must be the service SID. This is not
    by process id, which can be reused.
- **macOS and Linux**: a Unix socket in a directory owned by root and
  0755 (`/var/run/vettid-agent/`, made by the installer; on Linux not
  systemd's `RuntimeDirectory=`, which belongs to the service). The
  socket is owned by the connector's account, group a group holding
  only the member, mode 0660. The service checks the peer's uid
  (`SO_PEERCRED`, `getpeereid`) against the recorded uid. The stub
  checks that the socket's owner and the server's uid are the
  connector's account.
- **What crosses it**: MCP messages only, framed as on stdio. No file
  descriptors and no handles are passed. The service never opens a path
  the stub names except as a tool's argument (`cwd`, §6).

## 5. Pairing, sessions and the service's life

- `pair`, `status` and `forget` run in the member's account and talk to
  the service over the channel. The SAS and the texts of AGENT-PLAN §11
  are shown by the command, as today. The pairing code is passed once
  over the channel and never stored or logged (AGENT-PLAN §4.7).
- **When the service runs** (question 5). Proposed: always, as a
  service. Then the connector reaches the vault while no client runs
  it, and AGENT-PLAN §4.6 (catching up on start) and AG1a's "reaches
  the vault only while a client runs it" change. The alternative is to
  start it on demand when a stub connects and stop it a while after the
  last one leaves.
- **When the stub leaves** (the client closes, the member logs off or
  locks the computer): runs started for that stub go on to their own
  time limit, and their redacted answers are kept for AG9's 10 minutes.
  Proxies close, since only the agent that opened them uses them.
- **Sleep and resume, and a wrong clock.** After a resume, or a jump in
  the system clock, the service treats its access session as unknown
  until a `vault.status` answers. It never shows or uses it as live on
  its own clock alone (AGENT-PLAN §4.4, VAULT-MESSAGING §6.8). Runs and
  proxies wait for that answer.
- **Runs outlive a crash on macOS.** Windows job objects and systemd
  units end a run's processes with the service. On macOS a run started
  in its own session survives a crash of the daemon, so each run is its
  own launchd job, which the service removes, and on restart the
  service ends any run job it finds.

## 6. Runs: what the runner account can reach

A run's program runs as the runner account. That keeps the connector's
secrets from it and from the agent, but it also means **the program
cannot read the member's files**. This is the main cost.

- **The default directory** is the run's `work/`, as today, owned by
  the runner for that run.
- **A member's folder** as `cwd` (question 1). Proposed: the item's run
  binding gains `folders` (absolute paths, at most 16), set on the
  phone, and `vettid-agent share <folder>` in the member's account
  grants the runner account access to a listed folder. A `cwd` outside
  the shared folders is `cwd_not_allowed` (NEW code), plainly. The
  vault checks `cwd` against `folders` as it checks `program` against
  `programs`. This needs a VAULT-MESSAGING change.
- **What this does not fix, said plainly.**
  - A program reads what the agent can write. In a shared folder the
    agent can change the inputs.
  - Git refuses a repository owned by another user unless it is marked
    `safe.directory`. So `git push` in the member's repository fails
    under the runner account unless it is marked. Marking it turns
    `.git/config` back on as a way to run commands (`core.sshCommand`,
    `core.fsmonitor`, hooks), with the secret.
  - Other tools have no such check: npm scripts, `make`, cargo's
    `build.rs`, Python's import path, and on Windows a DLL in `cwd` all
    run what the folder holds.
  - On macOS, privacy controls (TCC) keep a daemon user out of
    Documents and Desktop even with permissions granted. On Linux,
    sharing a folder in a home directory makes the home traversable.
  - A shared folder on a redirected network path is reached as the
    computer's account on Windows. Such folders are refused.

  So a shared folder the agent can write remains a way to steer a run,
  as is any argument. A run is still for a member who reads the command
  (AGENT-PLAN §4.9, "The limit").
- **The pin** (VAULT-MESSAGING 0.85.0) still applies, and is stronger
  here. A program in an administrator-only folder, run under an account
  the agent cannot touch, can no longer be attached to or read.

## 7. Proxies

The proxy's listener stays on 127.0.0.1 in the connector service, with
its token (AGENT-PLAN §4.9). Any local process that has the token can
use it, as today. The value itself stays in the service's memory, which
neither the agent nor a run can read. A proxy closes when the stub that
opened it leaves (§5).

## 8. No silent fallback, and the texts

- `leash.run_with_secret` and `leash.open_proxy` work only in a service
  whose accounts are not the member's. A stub started with `--name`
  never falls back to running the connector in its own process.
  Without the service, those tools answer `separate_account_required`
  (NEW code) with the NEW text "Running programs and opening proxies
  with a secret need the connector installed in its own account. Run
  `vettid-agent install` as an administrator, then try again."
- A service whose connector or runner account turns out to be the
  member's, or an administrator's, refuses runs and proxies and says
  why in `status`.
- The connector as built today (one process, the member's account)
  stays available for `use`, the catalog and reveal (question 2). Its
  `status` says "Runs and proxies are off: the connector runs in this
  agent's account." (NEW)
- Other NEW texts:
  - "The connector service is not running. Start it, or run `vettid-agent install` again." (no channel);
  - "The connector service and this program are different versions. Run `vettid-agent install` again." (version mismatch);
  - "Another program took the connector's channel name, so the service did not start. Restart the computer; if it happens again, tell your administrator." (name taken);
  - "That folder is not shared with the connector for this item. Share it on your phone and with `vettid-agent share`." (`cwd_not_allowed`).

## 9. Questions for the owner

1. **Member folders for runs (§6).**
   - a (recommended): `folders` in the item's run binding, set on the phone, with a VAULT-MESSAGING change. Git works there only once a folder is marked `safe.directory`, which re-opens `.git/config`.
   - b: runs only in `work/`, no member folders. This is the simplest, but `git push` in the member's repository then does not work.
   - c: folders shared at install, not per item. No spec change, but coarser.
2. **The same-account connector (§8).**
   - a (recommended): keep it for `use`, the catalog and reveal, with §2's statement that the vault cannot enforce the mode.
   - b: drop it, the service only.
3. **One instance per pairing (§3).**
   - a (recommended): two accounts and a service per pairing, as AG1a's one pairing per client.
   - b: one service and runner per member user, holding several pairings. Fewer accounts, but the pairings share them.
4. **macOS keys (§3).**
   - a (recommended): the system keychain, with an access list naming only the connector.
   - b: the passphrase protector, typed by an administrator at each start.
5. **When the service runs (§5).**
   - a (recommended): always, as a service, catching up continuously.
   - b: on demand, while a stub is connected.

## 10. What changes elsewhere, once approved

- **AGENT-PLAN.**
  - A new decision, AG14 (AG10 stays withdrawn, as 0.1.5 said). AG1a gains the exception: the stub, the service and their channel, and (question 5) the vault reached while no client runs.
  - §4.2 and AG3: the keys under the connector's account, per platform.
  - §4.6: catching up.
  - §4.7: "never listens" gains the channel.
  - §4.9:
    - runs under the runner account, and only in this mode;
    - the `--run-path` check against the member's and runner's accounts;
    - where the environment's `HOME`, `USERPROFILE` and `APPDATA` come from (the runner's profile, made empty for each run);
    - "when the connector exits, it kills its runs" read per §5.
  - New PRs before A3.8a ships:
    - the service, runner and stub (A3.10);
    - the installer and uninstaller per platform (moved forward from A5);
    - the channel tests.

    This changes "What blocks what" and AG4's platform order. The dev-stack tests run the service under test accounts.
- **VAULT-MESSAGING.** `folders` and `cwd_not_allowed`, if question 1 is a.
- **The Android app.** The binding's folders (AA7), if question 1 is a.
- **Tests on Windows (this machine).**
  - An install and uninstall leave nothing behind.
  - The service account's DPAPI.
  - The pipe refuses another user, an anonymous client and a squatted name.
  - The member's account cannot open a run's process or secret file.
  - A run cannot read the connector's state or open its process.
  - The service holds no impersonation privilege.
  - Sleep, a second Windows user, and Defender or SmartScreen on the service.
