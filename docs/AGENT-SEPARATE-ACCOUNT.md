---
title: AGENT-SEPARATE-ACCOUNT
status: approved by the owner 2026-11-05 (§9); design note. Nothing here is built; AGENT-PLAN and the code follow
version: 0.1.5
date: 2026-11-22
owner: Al Liebl (Mesmer)
component: vettid-agent (the agent connector): install, process model, keys at rest, runs and proxies
related:
  - AGENT-LINUX-RUNTIME.md (0.1.1, draft) §11 — who counts as an administrator on Linux
  - AGENT-PLAN.md (0.1.9; 0.1.10 in vettid.org #538) AG1a, AG3, AG4, AG11, §4.2, §4.6, §4.7, §4.9, A3.8, A3.9, A5
  - VAULT-MESSAGING.md (0.84.0; 0.85.0 in #538) §10.11 "Ways to use a secret"
changelog:
  - 0.1.5: 2026-11-22, erratum (VAULT-MESSAGING 0.93.2, AGENT-PLAN
    0.1.21; owner-approved card GC #16477). §6 "Outputs": the reserved
    Windows names are VAULT-MESSAGING §10.11's list, which the note now
    points at instead of "`CON`, `NUL`, `COM1` and the like". This only
    clarifies (the list refuses more than the examples suggested).
  - 0.1.4: 2026-11-22 (card #16224; owner a, GC #16214). §5: on Linux a
    member with password-less `sudo` is now refused (`member_is_admin`,
    AGENT-LINUX-RUNTIME §11), rather than only left without the
    elevation's protection. Nothing else changes
  - 0.1.3: 2026-11-21, erratum with AGENT-PLAN 0.1.19, the owner's
    decision (GC #15936), with the facts measured by the CI probe on
    windows-2025 (vettid/vettid-agent#53 at 1842446). §3: the
    connector's account on Windows is always the virtual service
    account; the local-user fallback is removed. The service's
    required-privileges list is cut to `SeChangeNotifyPrivilege` only,
    with no LSA grant (route A, granting `SeAssignPrimaryTokenPrivilege`,
    is rejected: that privilege alone is widely treated as enough to
    reach SYSTEM), and the service refuses to run if its token holds any
    other privilege. Runs start through the secondary-logon service
    (`CreateProcessWithLogonW`). The runner accounts are allowed console
    interactive logon and denied RDP and network logon, with no batch
    logon right. The plain statements about Interactive users, a leaked
    runner password and the logon audit are added. **Fix round after two
    blind reviews (the lead's calls):** runs start in two stages (the
    service starts a launcher with `CreateProcessWithLogonW`; the
    launcher, as the runner, builds a restricted token and starts the
    program with `CreateProcessAsUser`, in the same job); a per-run
    desktop in place of a claimed per-run window station; INTERACTIVE and
    the leaked-password statement made accurate; the runners' rights,
    password and lockout stated; the service's self-check also refuses
    membership in Administrators or any group beyond the defaults;
    handles are non-inheritable; unmeasured claims (type 2 audits, `STARTF_USESTDHANDLES`, breakaway,
    the errno mapping, the client SKUs) are documented.
    **Measured by vettid/vettid-agent#57 (68794ee, windows-2025, all
    asserted):** each run gets its own desktop in the service's window
    station (a window station cannot be created), with the runner's
    entry of 0x20060, never 0xF037F; the job's UI limits are mandatory,
    and so is the job; the launcher starts with `CREATE_NO_WINDOW`,
    locks its own token and process (required: without the lock the
    program copies a token with INTERACTIVE enabled, even from an exited
    launcher), starts the program suspended and `DETACHED_PROCESS`,
    reports its ids and exits, and the service resumes the program only
    when the job holds only the program and its image is the pinned
    file; DCOM classes whose launch permission grants Authenticated
    Users, Everyone or Users pass the launch check (treat as launchable); git, node, npm, ssh and
    python run; errors 1385, 1907 and 1058. Gaps: window messages on the
    run's desktop are untried, and the holder of the dead launcher's
    object is unknown. **Second review round (two more blind reviewers, NOT READY; the lead's calls marked):** the launcher's token is INTERACTIVE enabled, LOCAL absent and BATCH absent (measured, vettid/vettid-agent#57); the service's pipes reaching the program through `STARTF_USESTDHANDLES`, the launcher's conhost gap, its requirement and the report channel (all measured, below); failure handling with a NEW §11 text (the lead's call); the DCOM wording (the launch check passes, treat as launchable); the launcher builds its token before the lock; the deny re-check by the elevated `status`; the per-run desktop's access list; the service's own image read decides and the launcher's is a pre-check; one kill-on-close job per run; the inferred TOKEN_QUERY read and the documented sign-in log are marked as not measured. Nothing else changes
    **Measured by vettid/vettid-agent#60 (at 380958b, windows-2025, all
    asserted):** (1) the launcher's conhost: with `CREATE_NO_WINDOW` it
    holds an INTERACTIVE-enabled copy of the unlocked token; it was gone
    by the time the program ran in every run, which depends on timing
    and is no guarantee. **Design (the lead's call):** the launcher is a
    GUI-subsystem executable built with `-ldflags -H=windowsgui` (not a
    patched binary, which would break an Authenticode signature); it has
    no conhost (measured with an equivalent subsystem-2 binary), and the
    lock, handoff, resume, output and report work the same;
    `CREATE_NO_WINDOW` is ignored for it. Fallbacks: `FreeConsole` ends
    the conhost at once, or the launcher locks its process and token
    (both measured). The belt stays: the service resumes only once the
    job's process list is exactly the program. (2) Output pipes: the
    service creates the program's standard pipes non-inheritable and
    passes them with `STARTF_USESTDHANDLES`; they reach the launcher as
    inheritable handles either way, the launcher passes them in the
    program's handle list, and output from both reaches the service
    after the launcher exits. (3) Report pipe (tightened, the lead's
    call): a random name of at least 48 bits, first instance, one
    instance, remote clients rejected; its access list gives the service
    and that runner only, the runner write-only (no
    `FILE_CREATE_PIPE_INSTANCE`, 0x4); the service checks
    `GetNamedPipeClientProcessId` against the launcher's id; the launcher
    opens it with `SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION`; it
    carries the `cwd` final path, whether it is listable, the lock's
    result, and the program's process and thread ids (measured); another
    runner and a plain local user are refused read and write (measured);
    the report is a claim the service verifies. (4) Order: after the
    lock, `OpenProcessToken` on itself is denied, so the launcher opens
    its token handle before the lock and builds the restricted token from
    it. (5) The deny re-check: the service, with ChangeNotify only,
    cannot read the runners' rights (`LsaEnumerateAccountRights` returns
    STATUS_ACCESS_DENIED, 0xC0000022), so the RDP and network-logon
    denies are re-checked only by the elevated `status` and at
    install and upgrade, not at each run. (6) The virtual account's
    default groups were not read by step 3: still to be read. (7) The desktop's own access mask is measured (at 380958b): the runner's entry is exactly 0x83 (DESKTOP_READOBJECTS, DESKTOP_CREATEWINDOW and DESKTOP_WRITEOBJECTS), the narrowest that lets user32 and ole32 initialize; the body has it. (8) Gaps, unchanged: the
    holder of the dead launcher's process object is unknown, and window
    messages are untried.
  - 0.1.2: 2026-11-21, erratum with AGENT-PLAN 0.1.16. §4: an elevated
    administrator or root is also admitted to the channel, only for
    `pair`, `forget` and `status` (the lead's call). §3 "Keys at rest":
    Linux without a TPM 2.0 only with `--no-tpm` (the owner's c, GC
    #15786). §3 "The operator's flags" and §6 "The pin": in this mode
    every program, pinned or not, must be in an administrator-only
    folder (the owner's a, GC #15787). Nothing else changes
  - 0.1.1: 2026-11-05, with AGENT-PLAN 0.1.11 (A5.4). §5: the elevated
    commands' absolute path per platform (macOS: inside the app, a path
    with a space). §4: on macOS the socket's parent is a persistent
    root-owned folder, since launchd's `Sockets` doesn't create parents
    and `/var/run` is cleared at boot. No decision changes
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
  under runner accounts that can read none of the connector's state,
  profile or process. Two runs may overlap (AGENT-PLAN §4.9: at most
  2), and a run must not reach another's secret either, so each
  pairing has two runner accounts, one per run slot (question 6). A
  slot's account runs one run at a time. Its profile is never loaded
  (§3): each run gets fresh folders of its own for `HOME` or
  `USERPROFILE`, `APPDATA` and the temporary folders, removed when the
  run ends, so nothing one run leaves steers the next. The
  connector starts each run as a free slot's account (below) and gives
  it only that run's secret.
- **A run ends with everything it started.** A slot's account is used
  again, so a process left over from one run (`setsid nohup`, a
  scheduled task) could read the next run's secret or attach to it.
  When a run ends, the slot is not used again until every process of
  its account is gone: on Linux each run is its own cgroup (the run
  helper's service with `Delegate=yes`), killed as a whole; on macOS
  every process of the runner uid is killed and the kill confirmed; on
  Windows the run's job refuses breakaway, and every process whose
  token has the runner's SID is ended. Then the runner's scheduled
  tasks, its Run keys, and its files in `/tmp`, `/var/tmp`, `/dev/shm`
  and `C:\Users\Public` are removed. A slot whose cleanup cannot be
  confirmed stays out of use, and `status` says so. Tests: a daemon
  forked by one run is gone before the next run starts.
- **What the separation gives.** The agent can still call every tool:
  reaching the tools is its job, and the vault's rules decide what it
  gets. It can no longer read the connector's keys or state, a run's
  secret file, a run's environment or memory, or a proxy's value. A run
  can read its own secret, which it was given, and nothing else the
  connector holds.
- **What it does not give, said plainly.** A run is still steered by
  what the agent can write (its arguments, and the files in a shared
  folder, §6). Any agent app in the member's account can use any of
  the member's pairings through the channel, as before. `pair`,
  `forget` and `share` need an administrator (§5). The vault cannot tell which mode a pairing runs in (AG11 is
  self-asserted): "runs and proxies only in this mode" is the
  connector's own policy, and an agent that pairs a connector of its
  own making can ask for `item.run` itself. So the member approves only
  pairings they made, and the phone shows each pairing as today.

## 3. Accounts and install

The install needs an administrator once. The connector never runs
elevated or as SYSTEM (AGENT-PLAN §4.7).

| Platform | Connector account | Runner account | Started by | State |
|---|---|---|---|---|
| Windows | `NT SERVICE\vettid-agent-<n>` (a virtual service account) | local users `vtdr-<8 hex>-1` and `-2`: console interactive logon allowed, RDP and network logon denied, no batch logon right, hidden from the sign-in screen, a random password kept only under the connector's DPAPI | a Windows service | `%ProgramData%\VettID\agent\<n>\`, owner the service SID only |
| macOS | a hidden user `_vettid<n>` | hidden users `_vettidrun<n>a` and `b` | a launchd daemon | `/Library/Application Support/VettID/agent/<n>/`, 0700 |
| Linux | a system user `vettid-agent-<n>` | system users `vettid-run-<n>-1` and `-2` | a systemd system service | `/var/lib/vettid-agent/<n>/`, 0700 |

- **Windows privileges.** Services get `SeImpersonatePrivilege` by
  default, and code holding it has known ways to SYSTEM. The service is
  installed with its privileges cut to `SeChangeNotifyPrivilege` only,
  and every run starts under the runner account through the
  secondary-logon service, in a job object. Identifying the pipe's
  client does not need the impersonation privilege. The connector's
  account is always the virtual service account (0.1.3, the owner's
  decision, GC #15936; measured on windows-2025,
  vettid/vettid-agent#53). By default it holds `SeImpersonatePrivilege`
  and lacks `SeAssignPrimaryTokenPrivilege` and
  `SeIncreaseQuotaPrivilege`, so the installer sets the service's
  required-privileges list to exactly `SeChangeNotifyPrivilege`, with no
  LSA grant, and sets `SidType` unrestricted. Measured: the service then
  starts holding only that privilege, and `CreateProcessAsUser` is
  refused (error 1314). It must hold no `SeImpersonatePrivilege`,
  `SeAssignPrimaryTokenPrivilege`, `SeIncreaseQuotaPrivilege` or
  `SeTcbPrivilege`; the service checks its own token at start and
  refuses to run, with an Event Log entry and `status` saying why, if it
  holds any privilege beyond `SeChangeNotifyPrivilege`, or if its account is in Administrators or any group beyond the defaults (the virtual account's default groups are still to be read: step 3 of vettid/vettid-agent#60 did not read them; the self-check compares with that list) (the lead's call, 0.1.3 fix round). When the service refused to start, the stub answers `status`: it reads the service's state and the Event Log entry. **Route A is
  rejected:** granting `SeAssignPrimaryTokenPrivilege` to the service
  SID through LSA works (it alone is enough; `SeIncreaseQuotaPrivilege`
  is not needed), but that privilege alone is widely treated as enough
  to reach SYSTEM (the public potato-family tools), so a compromised
  connector could likely become SYSTEM.
- **Starting a run as the runner.** Windows, in stages (the lead's
  call, 0.1.3 fix round; measured by vettid/vettid-agent#57 at
  68794ee on windows-2025, every value asserted). (a) The service starts
  the **launcher** (in an administrator-only folder) through the
  secondary-logon service: `CreateProcessWithLogonW` with the runner's
  name and password (the password the connector keeps under its DPAPI),
  `dwLogonFlags` exactly 0 (never `LOGON_NETCREDENTIALS_ONLY`, which
  would run as the connector; no profile), `CREATE_NO_WINDOW` (seclogon refuses `DETACHED_PROCESS` for it; the launcher is a GUI-subsystem executable, so the flag is ignored and not relied on, measured by vettid/vettid-agent#60), the run's own desktop (`lpDesktop`
  is never null), suspended, assigned to the run's kill-on-close job (one job per run),
  then resumed. **The job is mandatory** (the service cannot end a
  program without it), with no breakaway and the UI limits
  `JOB_OBJECT_UILIMIT_HANDLES`, `GLOBALATOMS`, `DESKTOP`,
  `READCLIPBOARD`, `WRITECLIPBOARD`, `EXITWINDOWS`, `SYSTEMPARAMETERS`
  and `DISPLAYSETTINGS`, **set before the resume**. Measured:
  CreateDesktop is denied only with them, and global atoms are separate
  only with them. A run whose job or limits cannot be set is refused.
  (b) The launcher **locks its own token and process**: their access
  lists become SYSTEM full plus OWNER RIGHTS with only TOKEN_QUERY
  (token) and SYNCHRONIZE and QUERY_LIMITED_INFORMATION (process); the
  token is owned by the runner, so OWNER RIGHTS applies to it. **The
  lock is required.** Measured: without it the program can open the
  launcher's process (VM_WRITE, CREATE_THREAD, WRITE_DAC) and token
  (DUPLICATE, IMPERSONATE, READ_CONTROL, WRITE_DAC, WRITE_OWNER) and
  copy a token with INTERACTIVE enabled, even after the launcher has
  exited and the service has closed its handles to it. Something keeps
  the dead launcher's object alive (not a conhost; the holder is
  unknown). With the lock every open is refused. (c) The launcher opens
  and holds `cwd` (AGENT-PLAN §4.9) and builds a restricted token from
  its own: every privilege removed but `SeChangeNotifyPrivilege`, and
  INTERACTIVE deny-only (LOCAL is absent on the run's desktop, so no
  LOCAL step is needed). It starts the program with `CreateProcessAsUser`
  on that token, **suspended** and **`DETACHED_PROCESS`**, with
  `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` limited to the standard handles,
  in the held folder. The program token's default access list also grants the service's SID SYNCHRONIZE, QUERY_LIMITED_INFORMATION and TERMINATE (0x101001), and the launcher sets the program thread's access list to give the service SYNCHRONIZE, QUERY_LIMITED_INFORMATION and THREAD_SUSPEND_RESUME (not through the default list, since 0x2 on a process is CREATE_THREAD). The default list (0x101001 to the service) also applies to objects the program creates without an access list; that is harmless. (d) The launcher reports the program's
  process and thread ids to the service and **exits**. The service waits
  for the launcher's exit, closes its handles to it, and **waits until
  the job's process list is exactly the program** (a belt: the GUI-subsystem launcher has no conhost). It checks `GetProcessIdOfThread(th) == pid`, `IsProcessInJob` and the program's image (`QueryFullProcessImageNameW`, measured possible) against the pinned file, and only then resumes the program. The service's own read of the image decides; the launcher's check is a pre-check. **Output:** the
  service creates the standard pipes and passes them through the
  launcher's standard handles to the program (measured by vettid/vettid-agent#60: the service creates them non-inheritable and passes them with `STARTF_USESTDHANDLES` to `CreateProcessWithLogonW`; they arrive at the launcher as inheritable handles either way, and the launcher passes them in the program's handle list; output from the launcher and the program reaches the service after the launcher exits); with `DETACHED_PROCESS`
  there is no console, and no conhost exists while the program runs
  (measured: the job holds only the program). (e) The read-only folder
  check (`AccessCheck`) uses the program's token, not the launcher's. (f) **Order in the launcher (0.1.19, second review round):** after the lock, `OpenProcessToken` on itself is denied (measured by vettid/vettid-agent#60), so it opens its token handle, with the rights `CreateRestrictedToken` needs, **before** the lock and builds the program's restricted token from that handle (measured: INTERACTIVE deny-only, `SeChangeNotifyPrivilege` only). **The launcher's conhost (0.1.19; measured by vettid/vettid-agent#60 at 380958b, windows-2025, asserted):** with `CREATE_NO_WINDOW` the launcher has a conhost, and it holds an INTERACTIVE-enabled copy of the unlocked token (measured). It was gone by the time the program ran in every run, but that depends on timing, not a guarantee. **Design (the lead's call):** the launcher is a **GUI-subsystem executable, built with `-ldflags -H=windowsgui`** (not a patched binary, which would break an Authenticode signature). It has no console and no conhost (measured with an equivalent subsystem-2 binary), and the lock, the handoff, the resume, the output and the report work the same (measured). `CREATE_NO_WINDOW` is ignored for a GUI image, so nothing relies on it. Fallbacks, if ever needed: `FreeConsole` ends the conhost at once (measured), or the launcher locks the conhost's process and token (measured). **The belt (keep):** the service resumes the program only once the job's process list is exactly the program. **The report channel (the lead's call, with the tightening; only the content and the two refusals were measured, by vettid/vettid-agent#60 at 380958b):** a per-run named pipe the service creates before the launcher starts: a random name of at least 48 bits, `FILE_FLAG_FIRST_PIPE_INSTANCE`, one instance, `PIPE_REJECT_REMOTE_CLIENTS`; its name is on the launcher's command line. Its access list grants the service and that runner only, the runner with write-only rights (no `FILE_CREATE_PIPE_INSTANCE`, 0x4). The service checks that `GetNamedPipeClientProcessId` equals the launcher's process id, and the launcher opens the pipe with exactly `FILE_WRITE_DATA|SYNCHRONIZE` and `SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION`, never `GENERIC_WRITE`: on a pipe GENERIC_WRITE includes 0x4 (FILE_APPEND_DATA, the same bit as `FILE_CREATE_PIPE_INSTANCE`), which the runner's entry withholds, so the open would be refused. The 48-bit name, the one instance, the write-only runner entry, the `GetNamedPipeClientProcessId` check and the SQOS flags are the lead's design, not measured. The launcher reports through it the `cwd` final path and whether it is listable, the lock's result, and the program's process and thread ids (these four measured), and the read-only `AccessCheck` result and the image's volume serial number and file index (§4.9; design, not measured). Another runner and a plain local user are refused both read and write (measured). The report is a claim: the service verifies the ids through the job, `GetProcessIdOfThread`, the creation time and the image. The standard handles are the program's alone. **Failure handling (the lead's call):** the launcher never starts the program unless the lock, the default access list and the thread's access list all succeeded, and it reports each result. On any failure, or on a timeout, the service closes the job (which kills everything in it), removes the station entry and the desktop, and refuses the run with the NEW §11 text "The program could not be started safely (<step>)."; `status` and the Event Log name the step. The failures covered: the lock or an access list failing; the restricted token or `CreateProcessAsUser` failing; the launcher exiting without a report; ids that fail `GetProcessIdOfThread`, `IsProcessInJob` or the image check; the job not coming down to exactly the program within 5 s; `ResumeThread` returning a count other than 1. Then the slot goes through its usual cleanup. **The setup steps before the launcher starts (the lead's call):** the desktop, the station entry, the report pipe (its creation, or a client process id that is not the launcher's), the output pipes, and the job with its assignment and its UI limits. A failure in any of them refuses the run with the same NEW text, naming the step, and whatever was made is removed. If removing the 0x20060 station entry or closing the desktop after a run fails, the slot stays out of use and `status` names it.
  Every handle the connector creates is non-inheritable. Measured: the
  launcher builds the restricted token and starts the program on it with
  no privilege; the program runs as exactly the runner, and git, node,
  npm (through `cmd.exe`), ssh and python run as the program. The call starts
  `seclogon` on demand, so the installer leaves it alone (Manual is its
  default), and its default access list lets the virtual account start it
  (`OpenService(SERVICE_START)` succeeded in the probe; client
  `StartService` and a trigger start were not told apart). If the
  service cannot be started (Disabled, or an access list that does not
  allow the connector's service account, `vettid-agent-<n>`), runs are
  refused with a text telling the member's administrator to set it to
  Manual and check who may start it, and `install` warns. A runner that
  cannot sign in is refused with a text naming the reason by Windows
  error number (1385 the right is missing, 1330 the password expired,
  1909 locked, 1326 the password is wrong, 1907 the password must be
  changed, 1058 the secondary logon service is disabled, others by
  number; 1385, 1907 and 1058 measured, the rest documented). Measured:
  a runner with no batch right starts a launcher; the "never expires"
  flag overrides "must change" (1907); and the explicit
  `SeInteractiveLogonRight` grant is not strictly needed on a default
  image (Users holds it), so the grant and the check of the effective
  right stay for hardened machines. The
  runner accounts are granted `SeInteractiveLogonRight` explicitly
  (`install` checks the effective right), denied RDP logon
  (`SeDenyRemoteInteractiveLogonRight`) and network logon
  (`SeDenyNetworkLogonRight`), re-checked only by the elevated `status` and at install and upgrade (an administrator can read LSA rights; the service, with ChangeNotify only, cannot: `LsaEnumerateAccountRights` returns STATUS_ACCESS_DENIED, 0xC0000022, measured by vettid/vettid-agent#60; not measured: a network-logon attempt with the runner's password should fail with 1385, and RDP denial cannot be checked that way), not
  denied interactive logon (a runner also denied it was refused in the
  probe, error 1385) and not granted the batch logon right (measured: a
  run starts without it). Their passwords are random, meet the local complexity policy
  (`install` checks it) and never expire. A process that guesses a
  password can lock a runner, a denial of service only; `status` says the
  runner is locked. **Said plainly:** the launcher's token has INTERACTIVE enabled, LOCAL absent and BATCH absent (measured, vettid/vettid-agent#57). The program gets INTERACTIVE as deny-only, which closes
  Windows' default DCOM launch for "Interactive User" servers (a
  cross-session path to the member's session) and anything else granted
  to Interactive users. **It does not close every such server
  (measured):** a class with the machine's default launch permission is
  refused (0x80070005), but a class whose launch permission grants
  Authenticated Users, Everyone or Users passes the launch check (0x80080005, measured); treat it as launchable, as the Interactive User, in the member's session. The program
  can read the launcher's token groups through TOKEN_QUERY (inferred from the lock's grant, not measured), which is information only. No VettID access list uses Interactive users to
  mean the member. A console or `runas` session as a runner (a leaked
  password) reaches what any standard local account reaches, the
  pairing's shares, and the secrets and processes of runs in progress for
  that account; it does not reach the connector's keys, and keeping the
  runner's processes alive keeps the slot out of use (it fails secure).
  Denying network logon blocks loopback NTLM as the runner (`\\localhost`
  shares, WMI over the network). The logon audit is documented to show
  type 2 logons for runs (not measured). Its profile is never
  loaded: resetting a profile and its registry hive needs an
  administrator. Instead `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
  `TEMP` and `TMP` point at fresh folders of that run, removed after
  it. Each run gets its own **desktop in the service's window
  station** (measured: the connector's virtual account cannot create a
  window station; access denied, and a create with a null name returns
  the service's own). The runner's entry on that station is **0x20060**
  (READ_CONTROL, WINSTA_ACCESSGLOBALATOMS, WINSTA_EXITWINDOWS), the
  measured minimum (0x37F, 0x2003A and 0x2005A fail), removed after the
  run; it is never 0xF037F, which would give WRITE_DAC and WRITE_OWNER
  on the shared station. The job's UI limits stop clipboard, atom and handle sharing. The per-run desktop's access list is SYSTEM, the service's SID, and that runner's SID, with the runner's entry exactly 0x83 (DESKTOP_READOBJECTS, DESKTOP_CREATEWINDOW and DESKTOP_WRITEOBJECTS; measured by vettid/vettid-agent#60 at 380958b as the narrowest that lets user32 and ole32 initialize: without READOBJECTS or WRITEOBJECTS user32 fails, and without CREATEWINDOW ole32 is refused; no standard right is needed, and HOOKCONTROL, JOURNALRECORD, JOURNALPLAYBACK, ENUMERATE, CREATEMENU and SWITCHDESKTOP are never granted). The desktop is closed after the run, and the connector creates no windows on the shared station. Window messages between processes on the run's
  desktop are untried (low risk: a detached program has no peer window
  in its job, and other desktops are out of reach). Without a desktop, programs that
  load user32 fail at start (0xC0000142). `lpDesktop` is never null; a
  null desktop is documented to add the run's logon SID to the
  connector's desktop access list (documented, not measured). Without a
  loaded profile, the run's `HKEY_CURRENT_USER`
  falls back to `.DEFAULT`, and programs that ask Windows for their
  known folders (rather than reading the variables) may fail; such
  programs are noted as unsupported until a profile mechanism is
  tested.
  POSIX: starting a process as another user needs root, which the
  connector never holds. On both Linux and macOS a small **run helper**
  does it: a root service installed with the connector, listening on a
  root-owned socket that only the connector's account may open (peer
  uid checked). The connector passes it, over `SCM_RIGHTS`, the
  program's sealed copy (Linux, the memfd of AGENT-PLAN §4.9; macOS,
  the copy's descriptor), the run's standard streams and the secret's
  descriptor; the helper starts the program as the slot's runner uid in
  its own session, and reports its exit. It takes no path, no
  environment and no argument it does not pass on unchanged, and never
  starts anything as root. It reads the runner uids from root-owned
  configuration, never from the connector; it resets supplementary
  groups, sets `no_new_privs`, and starts the program with only the
  environment the connector built (AGENT-PLAN §4.9), nothing of its
  own. On macOS, which has no `fexecve`, the connector's copy of the
  program goes into a root-owned folder of that run that the helper
  makes, and the helper starts it from there.
- **Where a run's files live.** A run's `work/`, `tmp/` and `secret/`
  folders, and on macOS its program copy, are never in a folder the
  member's account can read, and are removed when the run ends.
  - On POSIX the run helper makes them, under a run root of their own
    (0711, owned by root, outside the connector's 0700 state folder,
    which a runner can't traverse), owned by the slot's runner, 0700.
  - The helper writes the `file` secret there from the descriptor the
    connector passed: the connector can't chown to the runner, or write
    into the runner's 0700 folder.
  - On Windows the service makes them under its state folder, with an
    access list for that run's runner account only. Not `systemd-run`: polkit sees only the unit
  name and verb, so a rule for it would also let the connector start a
  unit as root, and a unit's environment and command line can be read
  by any local user (`systemctl show`). The helper is the one root
  component; it is small and gets its own review in A3.10. Every other
  descriptor is close-on-exec; tests check that a run inherits only its
  standard streams.
- **Keys at rest (AG3).**
  - Windows: DPAPI of the connector's virtual account. Its master key is
    protected by LSA secrets, so any SYSTEM process can decrypt it. The
    roaming-profile and domain-account notices of §4.2 no longer apply.
  - macOS: the data protection keychain needs a logged-in user, which a
    daemon user never has (question 4). The system keychain may not
    work for a daemon that is not root either (`/var/db/SystemKey` is
    readable by root only); to be checked on a Mac before question 4
    is settled.
  - Linux: a system service cannot prompt. Prefer
    `LoadCredentialEncrypted=` sealed to the TPM2 (systemd-creds) over
    putting the service user in the `tss` group; never a passphrase
    typed at start. (0.1.2, the owner's c, GC #15786) On a machine
    without a TPM 2.0, `install` stops with a clear message unless
    `--no-tpm` is given; then the credential is sealed to systemd's host
    key, which root can read and which is not bound to hardware, and
    `install` and `status` say so. (The lead's call, 2026-11-21) `--no-tpm`
    on a machine that has a TPM 2.0 is refused.
  - The accounts are fixed system users made at install, not systemd's
    `DynamicUser=` (whose uids change, which breaks ACL-based shares).
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
  channel. (0.1.2: plus an elevated administrator or root, only for
  `pair`, `forget` and `status`; §4.)
- **The operator's flags.** `--run-path` and `--run-env` are no longer
  the stub's: an agent could set them by editing its own MCP
  configuration. They live in the service's configuration file, which
  only an administrator can change, and the `--run-path` check of
  AGENT-PLAN §4.9 tests whether the **member's** account, the runner
  accounts, or any non-administrator can change the folder. So does the
  "unchangeable program" fallback of AGENT-PLAN 0.1.10 for a program
  with no pin yet. (0.1.2, the owner's a, GC #15787) In this mode the
  fallback's exemption for a pinned program is gone: every program,
  pinned or not, must be in an administrator-only folder, each folder
  up its path checked the same way. `--run-env` values come from that configuration too,
  never from the service's own environment.
- **Uninstall** stops and removes the service, the runner accounts and
  their processes, the logon-right entries, the shares' ACL entries and
  the state directory, after overwriting the state file. The virtual
  account's profile stays "in use" for over a minute after the service
  is deleted, so the uninstaller retries its removal later or says it is
  left. What is left
  behind is checked on Windows here and listed in the README.
- **Program files** go in an administrator-only place: `Program Files`
  on Windows (the service's `ImagePath` quoted), `/usr/local/libexec`
  (root-owned) on Linux, `/Library` on macOS. The installer checks every
  folder up the path, as the `--run-path` rule does.
- **Upgrade** replaces the program files (administrator-only folders)
  and restarts the service; the state stays. The stub and the service
  exchange their versions on connect; a mismatch is refused with a
  plain text (NEW, §8) rather than half working.
- **Logs** go to the system log (Windows Event Log, `os_log`, the
  journal) under the pairing's name. Other users of the computer can
  read those logs, so they hold only the pairing's name, the tool,
  the outcome code and a resolved program path, never arguments,
  `cwd`, variable names or values. They are readable by the member, never with
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
standing in for either end. (0.1.2, the lead's call of 2026-11-21) An
elevated administrator, or root, is also admitted, only for `pair`,
`forget` and `status`, never for tools: on Windows by the client's
token (the Administrators group enabled, high integrity or above,
System included), on Linux and macOS by peer uid 0. The service refuses
`pair` and `forget` from the member's normal process (`status` needs no
elevation, §5). Every failed check refuses the connection,
and the service never takes another name.

- **Windows**: a named pipe `\\.\pipe\vettid-agent-<n>-<random>`.
  - The service creates it with `FILE_FLAG_FIRST_PIPE_INSTANCE`. If the
    name is taken (another user created it first, at boot or during a
    restart), the service does not start: it logs it and `status` says
    so (NEW text, §8). That is a denial of service by a local user, not
    a disclosure.
  - Its DACL gives the member's SID read and write of data and
    `READ_CONTROL` (for the owner check below) only, never
    `FILE_CREATE_PIPE_INSTANCE` (the same bit as `FILE_APPEND_DATA`, so
    not `GENERIC_WRITE`). Only the service SID may create instances.
  - The service identifies each client from its token at
    identification level and compares it with the recorded member SID.
    A client at anonymous level, and an AppContainer token, are
    refused. The client's process id (`GetNamedPipeClientProcessId`) is
    never used for identity.
  - The pipe is made with `PIPE_REJECT_REMOTE_CLIENTS`, and its DACL
    denies NETWORK. Its name has a random suffix, kept in a
    configuration file only administrators can change, readable by the
    member (the stub needs it). With on-demand start (question 5), the
    name can be taken while the service is stopped. The stub's owner-SID
    check still refuses a server that isn't the service, so the cost is
    a denial of service, not a disclosure.
  - The stub, `pair`, `status` and `forget` open the pipe with
    `SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION`, so a server that
    is not the service cannot act as the member. They check the server
    by the pipe object's owner SID, read through the open handle
    (`GetSecurityInfo`), which must be the service SID. This is not
    by process id, which can be reused.
- **macOS and Linux**: a Unix socket made by the service manager, not
  by the service (which could not create it in a root-owned folder):
  systemd socket activation (`ListenStream=/run/vettid-agent/<n>.sock`,
  `SocketUser=` the connector's account, `SocketGroup=` a group holding
  only the member, `SocketMode=0660`), and launchd's `Sockets` with the
  same owner and mode. On macOS the socket's parent is a persistent
  root-owned folder, `/Library/Application Support/VettID/agent/run/`
  (0755): launchd's `Sockets` doesn't create parents, and `/var/run` is
  cleared at boot (AGENT-PLAN A5.4). The gate is the peer check, not the mode: the
  service compares the peer's uid (`SO_PEERCRED`, `getpeereid`, never
  the pid) with the recorded uid. The stub `lstat`s the socket (a
  symbolic link is refused) and checks that its owner is the
  connector's account and its parent folder is root-owned. The
  server's uid it reads (`SO_PEERCRED`, `getpeereid`) may be root, since
  with socket activation the uid that called `listen()` is systemd's or
  launchd's, so it accepts root or the connector's account.
- **What crosses it**: MCP messages, framed as on stdio, and (question
  9) the contents of files handed in and out of a run, as length-framed
  messages of their own (§6). No file descriptors and no handles are
  passed. The service never opens a path the stub names except as a
  tool's argument (`cwd`, §6).

## 5. Pairing, sessions and the service's life

- **`pair`, `forget` and `share` need an administrator** (question 7).
  The agent can shadow `vettid-agent` in the member's account (its
  `PATH`, an alias, a shell rc file, an npm or brew copy) with a program
  of its own. Its own connector would then show its own SAS, the member
  would approve it, and that connector could ask for `item.run` itself.
  So these three run elevated, from the administrator-only absolute
  path, with `sudo` by its absolute path too, since an rc file can alias
  it: on Linux `/usr/bin/sudo /usr/local/libexec/vettid-agent/vettid-agent
  pair`; on macOS `/usr/bin/sudo "/Library/Application
  Support/VettID/agent/vettid-agent.app/Contents/MacOS/vettid-agent" pair`
  (quoted: the path has a space; AGENT-PLAN A5.4); on Windows the Start
  menu's elevated shortcut. The README gives these lines as written, and
  says to start them only that way. Said plainly: a member with password-less
  `sudo` (NOPASSWD), or UAC set to "never notify", gets no protection
  from this elevation, since the agent can elevate the same way. On
  Linux such a member is refused (`member_is_admin`, AGENT-LINUX-RUNTIME
  §11); on Windows an administrator member is refused whatever UAC's
  setting (AGENT-PLAN §11, "Administrator member"). `status` needs no elevation. The SAS and the
  texts of AGENT-PLAN §11 are shown by the command, as today. The
  pairing code is passed once over the channel and never stored or
  logged (AGENT-PLAN §4.7).
- **When the service runs** (question 5). Proposed: on demand. Socket
  activation (or, on Windows, a service the stub starts) starts it when
  a stub connects, and it stops a while after the last one leaves. So,
  as AG1a has it today, the connector reaches the vault only while a
  client runs it, and catches up on start (AGENT-PLAN §4.6). The
  alternative is always running, which changes both.
- **Locking the computer** does not end a stub (the agent app keeps
  running). Nothing changes: runs and proxies go on, and the vault's
  own lock and hold rules (AGENT-PLAN §4.4) still apply.
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
  phone, and `vettid-agent share <folder>`, run as an administrator
  (§5), grants the runner accounts access to a listed folder. A share
  run from the member's account would let the agent share the whole
  home folder, `~/.ssh` included. Shares are ACL entries for the
  runners' own uids or SIDs, never `o+x` or a world-readable mode
  (note that 0755 home folders on older Ubuntu already expose
  world-readable files). A share can be read-only, which is offered
  first. Files a runner writes in a shared folder get an inheritable
  entry giving the member full control. `status` lists the shares,
  and uninstall removes them. A `cwd` outside
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

  - Arguments steer too: `git -c core.sshCommand=…` runs a command
    given in `argv`. The phone shows every argument, and a bound
    program with `each: false` runs what the agent passes.
  - The pin still matters: a shared folder may be one the agent can
    write, so a program in it is caught when it changes.

  So a shared folder the agent can write remains a way to steer a run,
  as is any argument. A run is still for a member who reads the command
  (AGENT-PLAN §4.9, "The limit").
- **Narrowing the steering through shared folders** (question 8). The
  agent runs as the member, so anything the member can write, the agent
  can write too. No account boundary separates them. What can be done
  is to make the program not act on what the agent wrote, or to make a
  change to it visible on the phone:
  - **Hardened profiles for common programs.** For a program the
    connector knows, a profile fixes how it may be run in a shared
    folder. The profile limits what the agent may ask for, overrides what
    the folder says, and pins the rest. For git:
    - **An allowlist of subcommands and options.** The agent's own
      options can beat the profile's: a later `-c`, `--config-env`, `-C`,
      `--git-dir`, `--work-tree` or `--exec-path`. So can options that
      name a program: `push --receive-pack`, `fetch --upload-pack`,
      `clone -u`, `rebase --exec`, `difftool -x`, `bisect run`,
      `--recurse-submodules`. A run in a shared folder may use only the
      profile's subcommands (to start: `status`, `fetch`, `pull`, `push`,
      `commit`, `add`, `log`, `diff`, `checkout`, `switch`, `branch`,
      `tag`, `merge`, `rebase` without `--exec`), each with its
      allowlisted options. Anything else is `program_not_allowed`, or is
      referred, as the binding says.
    - **Overrides on the command line**, placed by the connector before
      the agent's arguments: neutral values for every fixed-name
      setting that runs a command or redirects traffic (`core.sshCommand`,
      `core.fsmonitor`, `core.hooksPath` set to an empty runner-owned
      folder, `core.pager`, `core.editor`, `core.askPass`, `diff.external`,
      `gpg.program`, `http.proxy`, `http.sslVerify` true, and others on
      the profile's list).
    - **Its own credential helper.** Emptying `credential.helper` would
      also remove the way the secret reaches git. So the profile first
      resets the list (`-c credential.helper=`, which clears every
      helper configured before it), then adds its own, which hands git
      the run's secret (from the `file` secret) for the bound host
      only.
    - `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` set to the null
      device (`/dev/null`; `NUL` on Windows), by the connector itself,
      not by the request (whose `GIT_` names stay refused). And
      `safe.directory` for that one folder, on the command line, for
      that one run.
    - **What `-c` can't neutralize:** settings with names the agent
      chooses: `filter.<x>.*`, `diff.<x>.textconv` and `.command`,
      `merge.<x>.driver`, `hook.<x>.command`, `url.<x>.insteadOf` and
      `.pushInsteadOf` (which would send the push, and the token, to the
      agent), `remote.<x>.url` with `ext::`, `http.<x>.extraHeader`. Only
      the pin below catches these, which is why profiles without pins
      (question 8 b) are unsafe.

    ssh's profile: `-F none`, the options given, a `UserKnownHostsFile`
    managed by the connector, and `StrictHostKeyChecking=yes`. curl's:
    `-q` (no `.curlrc`), with `-K` and `-d @file` refused, since they
    read the agent's files as instructions. A program with a profile is
    marked "hardened" in the binding and on the phone. Each profile's
    lists are reviewed, and a new version of the program is checked
    against them before its profile covers it.
  - **Pinning the folder's control files.** The vault records the
    SHA-256 of every file that steers a known program, as it pins the
    program (VAULT-MESSAGING 0.85.3). A change sends the next run to the
    phone, saying which file changed. For git that means:
    - the resolved git folder's `config`, as a normalized projection:
      every setting except exactly these, which change in everyday use:
      `branch.<x>.remote`, `branch.<x>.merge`, `branch.<x>.rebase` and
      `branch.<x>.description`. Otherwise every `push -u` or
      `checkout -b` would ask. (`branch.<x>.pushRemote` stays pinned,
      since it chooses where a push goes);
    - the common folder's `config` and `config.worktree` for a worktree;
    - every file pulled in by `include` or `includeIf`, resolved, or
      else includes are refused;
    - `.gitmodules` and `.git/modules/**/config`, or else submodule
      recursion is refused;
    - `.gitattributes`, `.git/info/attributes`, `.lfsconfig` (or else
      LFS is refused), and the hooks folder.

    Pins catch what a profile misses, at the cost of one more approval
    after the member's own changes to these files.
  - **Programs that run the folder's code by design** (npm scripts,
    `make`, cargo's `build.rs`, a test runner) can't be hardened: running
    the repository's code is what they do. In a shared folder they are
    always referred, every run, and the phone says the program runs code
    from a folder the agent can change.
  - **Profiles in general.** A profile is data shipped with the
    connector (in its administrator-only program folder, versioned with
    each release). It lists a program's override flags and settings,
    and the control files to pin. It is not a git special case: git,
    ssh and curl come first, then the cloud and file tools agents use
    most (`aws`, `gcloud`, `az`, `rclone`). Their own configuration
    already comes from the runner's empty profile, never the member's.
    Each profile also has two more lists:
    - **Refused configuration steering:** the variables and flags that
      point the program at other configuration, refused in the request
      and in `argv`. Examples: `AWS_CONFIG_FILE` and
      `AWS_SHARED_CREDENTIALS_FILE` (an AWS profile's `credential_process`
      runs a command), `CLOUDSDK_CONFIG`, `AZURE_CONFIG_DIR`,
      `RCLONE_CONFIG`, and `--config`/`--profile` flags that name a file.
    - **An endpoint allowlist:** options that send the credential
      elsewhere (`--endpoint-url`, `az rest --url`, gcloud's
      `api_endpoint_overrides`, rclone's endpoint settings) are refused
      unless the value is on the binding's list of hosts. They're handled
      as git's `insteadOf` is.

    A program without a profile runs in `work/` as usual. In a shared
    folder, it is referred every run.
  - **Handing files in and out** (for agents that work on documents
    rather than code; question 9). A run then reads the member's
    documents without any shared folder, so the steering above doesn't
    arise: what the run reads is a copy made before it started. This
    needs a VAULT-MESSAGING change for `item.run`: the file names and
    sizes in the request and the approval.
    - **Who moves the files: the stub.** It runs as the member, the only
      account that can read and write the member's folders; the service
      and the runners can't. It reads the inputs and sends their
      contents over the channel (§4). After the run it receives the
      outputs and writes them. Nothing is shared by ACL.
    - **Inputs** add no new exposure: the agent can already read every
      file it names. The service writes them read-only into the run's
      `work/in/`. Caps: at most 16 files, 16 MiB each, 64 MiB in all.
    - **Outputs**: the service reads `work/out/` after the run ends.
      - It accepts only regular files owned by the slot's runner, with a
        link count of 1, opened with `O_NOFOLLOW`, never a reparse point
        or a symbolic link. A run can't link an output to the
        connector's state, and macOS has no `protected_hardlinks`.
      - Flat names only: no folders, no `..`, no absolute paths, no
        stream names (`:`), and no reserved Windows names: (0.1.5) the
        list of VAULT-MESSAGING §10.11's flat-name rule (`CON`, `PRN`,
        `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9`, the superscript
        forms, `CONIN$` and `CONOUT$`, any case, judged up to the first
        dot with trailing spaces dropped).
      - Caps: at most 16 files, 16 MiB each, 64 MiB in all; past them, the
        rest is dropped, and the answer says so.
    - **Writing them**: the stub writes into the folder the member chose
      for that item (in the binding). It creates each file new
      (`O_CREAT|O_EXCL`, `CREATE_NEW`) and never overwrites; a name taken
      gets a numbered suffix. It never follows a link in the destination.
    - **Redaction**: output files would bypass the redaction of standard
      output, so a steered run could write the secret into `out/`. Each
      output file is redacted the same way (AGENT-PLAN §4.9), over its
      bytes, before it leaves the service. A binary file in which the
      value happens to appear is changed by that, and the answer says
      which files were redacted. The limit stays as for standard output:
      an encoding the redaction doesn't know gets through.
  - **Not covered, said plainly:** file contents a program reads as data
    (a file the agent wrote that git then pushes, for example) still
    go where the command sends them. And a program with no profile, run
    in a shared folder, is only as safe as what it reads there.
- **What a runner cannot use, said plainly.** The member's own tool
  installs (nvm, pyenv, cargo or rustup in the home folder), the
  member's SSH agent, Git Credential Manager and `known_hosts`. A run
  that needs them fails. The README says which programs work, and
  how to install them for all users.
- **The pin** (VAULT-MESSAGING 0.85.0) still applies, and is stronger
  here. A program in an administrator-only folder, run under an account
  the agent cannot touch, can no longer be attached to or read.
  (0.1.2, the owner's a, GC #15787) In this mode the pin no longer
  stands in for the folder check: a program, pinned or not, runs only
  from an administrator-only folder.

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

## 9. Owner decisions (2026-11-05)

The owner answered "rec" to questions 1–8 (thread
01M6PJBQ3EDEM96YVN5VETNT17) and "both" to questions 8 and 9 (thread
01M6PJBE4MSPWMVSKD6CD8VX8M):

- **1 a:** member folders per item, through an administrator-only
  `share`, read-only offered first;
- **2 a:** the same-account connector kept for `use`, the catalog and
  reveal only;
- **3 a:** three accounts (the connector and two runners) and a service
  per pairing;
- **4 c:** macOS runs and proxies wait for signed builds;
- **5 b:** the service starts on demand;
- **6 a:** two runner slots, a slot reused only once every process of
  the previous run is confirmed gone;
- **7 a:** `pair`, `forget` and `share` need an administrator;
- **8 a:** hardened profiles plus pinned control files, as a general
  mechanism for non-coding agents too;
- **9 a:** handing files in and out, with the hardened copy-back of §6.

The questions as they were asked follow, for the record.


1. **Member folders for runs (§6).**
   - a (recommended): `folders` in the item's run binding, set on the phone, with a VAULT-MESSAGING change, shared by an administrator-only `share` with per-runner ACL entries, read-only offered first. Git works there only once a folder is marked `safe.directory`, which re-opens `.git/config`.
   - b: runs only in `work/`, no member folders. This is the simplest, but `git push` in the member's repository then does not work.
   - c: folders shared at install, not per item. No spec change, but coarser.
2. **The same-account connector (§8).**
   - a (recommended): keep it for `use`, the catalog and reveal, with §2's statement that the vault cannot enforce the mode.
   - b: drop it, the service only.
3. **One instance per pairing (§3).**
   - a (recommended): three accounts (the connector and two runners) and a service per pairing, as AG1a's one pairing per client.
   - b: one service and runner per member user, holding several pairings. Fewer accounts, but the pairings share them.
4. **macOS keys (§3).** Neither choice is free.
   - a: the system keychain, with an access list naming the connector
     by its code-signing requirement. AG3 (§4.2) rejected the
     file-based keychain because its items travel with Migration
     Assistant, and the access list needs signed builds (A5.2).
   - b: the passphrase protector, typed by an administrator at each
     start. Then the service cannot restart unattended after a crash
     or a reboot.
   - c (recommended): macOS runs and proxies wait until signed builds
     exist, and then a. Until then macOS gets the same-account connector
     (§8) only.
5. **When the service runs (§5).**
   - a: always, as a service, catching up continuously.
   - b (recommended): on demand, started by socket activation (Windows:
     a service the stub starts), stopped a while after the last stub
     leaves. Closest to AG1a's "reaches the vault only while a client
     runs it".
6. **Runner accounts (§2).**
   - a (recommended): two per pairing, one per run slot, with fresh
     per-run folders in place of a profile, and a slot used again only
     once every process of the previous run is gone.
   - b: one per run, made at its start and removed at its end
     (Linux `DynamicUser=`-like; slower, and on Windows a profile is
     made for every run).
   - c: one per pairing, with one run at a time instead of two.

   With a, a slot is used again only after every process of the
   previous run is gone (§2).
7. **Elevation for `pair`, `forget` and `share` (§5).**
   - a (recommended): yes, from the administrator-only path, since the
     agent can shadow the command in the member's account.
   - b: no, run from the member's account (the agent can then pair a
     connector of its own and share any folder).
8. **Steering through shared folders (§6).** *Decided: a (above).*
   - a (recommended): hardened profiles for git, ssh and curl
     (allowlisted subcommands and options, overrides, their own
     credential helper), plus pinned control files for git. Programs
     that run the folder's code are always referred in a shared folder,
     and so is any program without a profile.
   - b: profiles only, no pinned control files. This is **unsafe**:
     settings with names the agent chooses (`url.<x>.insteadOf`,
     `filter.<x>.*` and others) can't be overridden, and only the pin
     catches them.
   - c: no shared folders at all (question 1 b). Runs use `work/` only,
     and the steering doesn't arise.
9. **Handing files in and out (§6).** *Decided: a (above).*
   - a (recommended): yes. Input files are copied read-only into
     `work/`, outputs go back to a folder the member chose. Document and
     data agents then need no shared folder. This needs a VAULT-MESSAGING
     change.
   - b: not now. Such agents use shared folders, under question 8.

## 10. What changes elsewhere, once approved

- **AGENT-PLAN.**
  - A new decision, AG14 (AG10 stays withdrawn, as 0.1.5 said). AG1a gains the exception: the stub, the service and their channel, and (question 5) the vault reached while no client runs.
  - §4.2 and AG3: the keys under the connector's account, per platform.
  - §4.6: catching up.
  - §4.7: "never listens" gains the channel.
  - §4.9:
    - runs under the runner account, and only in this mode;
    - the `--run-path` check against the member's and runner's accounts;
    - where the environment's `HOME`, `USERPROFILE` and `APPDATA` come from (fresh per-run folders, the profile never loaded);
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
  - The full Windows test list is in AGENT-PLAN's A3.10b, A3.10c and A5.5 rows (Tests cells); this list defers to them.
