---
title: AGENT-LINUX-RUNTIME
status: draft design note; the run helper and the key sealing get their independent reviews (AGENT-PLAN §9 rule 6) from it, before their code. Built so far: the channel's Unix-socket end (vettid/vettid-agent#55)
version: 0.1.3
date: 2026-11-22
owner: Al Liebl (Mesmer)
component: vettid-agent (the agent connector): the separate-account mode on Linux (AGENT-PLAN A5.6)
related:
  - AGENT-SEPARATE-ACCOUNT.md (0.1.5) §2, §3, §4, §5, §6, §8
  - AGENT-PLAN.md (0.1.21) AG3, AG14, §4.2, §4.7, §4.9, A3.10a, A3.10d, A5.6, §11
  - VAULT-MESSAGING.md (0.93.2) §10.11 "Files handed in and out"
changelog:
  - 0.1.3: 2026-11-22, erratum (cards GC #16419 and #16565, the lead's
    calls #16589, #16598 and #16601). §11.4 measured on stock desktops
    with a probe (Ubuntu 24.04 and 26.04, Fedora 44 Workstation, Debian
    12 and 13 with GNOME; §13): polkitd is asked about processes only,
    never a `unix-session` subject (polkitd 124 and 127 abort on one);
    a session through one of the member's processes in it, never its
    leader; `manager`-class sessions skipped; the kind of subject
    worked out as polkitd's logind backend does (a seat makes a session
    local, the user's state makes it active), and the helper's
    no-session subject compared with `allow_any`; implied grants judged
    by the implying grant, one level, for the first case only (an
    always-refusing action stays refused); a grant over a default of `no`
    counts as one over `auth_admin*`; each subject's held groups
    compared with the group database; a unit of the member's service
    manager asked as a subject; polkit 122 the floor; gvfs's admin helper allowlisted
    while file operations still ask for an administrator;
    update-notifier's lock check, mutter's backlight helper and
    GNOME's Debian keyboard action with its helper, libmalcontent's
    three read-only actions and gnome-software's two key tests (by
    action id) allowlisted; dnf5daemon's install and key actions always
    refuse and join the rules file; three systemd v259 `yes` defaults
    recorded, per kind of subject, and `machine1.register-machine`'s;
    dnf5daemon's other actions refuse; the rules file returns
    `AUTH_ADMIN` (GC #16676); an `exec.path` action allowed by its id
    with its own program and recorded `exec.argv1`; every allowed helper program held to the
    package check. fwupd's `OnlyTrusted` read from every configuration
    file fwupd reads, and `nsswitch.conf`'s `sudoers` line as sudo reads
    it. How the package records are read: the manager that owns polkitd,
    links and their targets, the cases with no record or more than one
    owner. §1, §11.4 and §12: pacman supported for the package check
    (`pacman -Qqo`, the `mtree` digests, pacman's lock file); xbps, apk
    and portage not until measured, NixOS by its own design; no mode
    without the package check. §11.5 follows; §13 records the
    measurements and their tests, a stale pacman lock file "not
    checked", moves Debian's printer grant and the systemd v259 defaults
    out of what the `install` PR measures, and FirewallD's grants on a
    Fedora Workstation install into it. §2, §11.1 and §11.6 follow
    (the measurements of kind and locality: GC #16634; the review: GC
    #16676)
  - 0.1.2: 2026-11-22, erratum (VAULT-MESSAGING 0.93.2, AGENT-PLAN
    0.1.21; owner-approved card GC #16477). §7: the connector builds
    `VETTID_IN` and `VETTID_OUT` only for a run with non-empty `inputs`
    or an `output` (VAULT-MESSAGING §10.11 "How a program finds them";
    0.93.1: `inputs: []` is the same as none). This only clarifies.
    Related versions brought up to date.
  - 0.1.1: 2026-11-22 (card #16224). §11 rewritten to the owner's a on
    GC #16214 (replacing a on #15946), a on #16258 and a-a on #16331:
    the member is an administrator only when its account can become
    root without a password, or read or type the keystrokes, or read the
    password hashes or the kernel's memory. `sudo`, `wheel`, `admin`,
    `adm` and `systemd-journal` alone no longer refuse. Counted: the
    refusing groups, uid-0 accounts and empty passwords, sudo rules and
    settings that skip the password for any host, `doas nopass`, PAM
    stacks with a passwordless path, polkit grants of an
    administrator's action (inverted, with a measured allowlist; Fedora's
    package and firewall grants until a rules file makes them ask), root services the
    member can command, and inputs it can change. Checked by `install`,
    at every run start and proxy opening in the helper (the `admin` and
    `check` messages, §7) and by the elevated `status` (`admin.json`,
    which also clears a refusal). The helper runs `sudo` as root for
    these checks and nothing else (§6). The caching settings and the
    log-reading groups are reported; what the rule doesn't protect
    against is said plainly; a release gate. The service's own accounts
    keep the stricter list. §2, §3, §7, §12 and §13 follow
  - 0.1.0: 2026-11-21, first draft (card #15760, the lead's call a on
    GC #15918). How A5.6 is built on Linux: names, files and units; the
    channel's Unix-socket end; the connector service; the data key as a
    systemd credential sealed to the TPM 2.0 (and `--no-tpm`); the run
    helper, its protocol and the launcher; a run's cgroup and slot
    cleanup; the Linux side of files in and out; what `member_is_admin`
    means on Linux (owner a, GC #15946, §11). Every "(chosen; not in the
    spec)" item is listed in §12
---

# The separate-account mode on Linux (design note)

## 1. What this note is for

AGENT-SEPARATE-ACCOUNT says what the separate-account mode is, and
AGENT-PLAN A5.6 lists what the Linux half must do and test. Two parts of
A5.6 are reviewed **before any code** (AGENT-PLAN §9 rule 6): the run
helper, the one component that runs as root, and the key sealing, a
key-handling change. This note gives both their design, together with
the parts they touch (the units, the paths, the channel, the launcher's
`cwd` handling of 0.1.17), so that the review sees the whole.

The note decides nothing the specifications decide. Where they are
silent it chooses, marks the choice "(chosen)", and lists it in §12.

**Minimum platform (chosen).**
- **Linux 5.14 or later:** `cgroup.kill` (5.14), `clone3` with
  `CLONE_INTO_CGROUP` (5.7), `openat2` (5.6), `faccessat2` (5.8),
  `close_range` with `CLOSE_RANGE_CLOEXEC` (5.11), `SO_PEERGROUPS`
  (4.13). `vm.memfd_noexec` must be below 2, or no run can start
  (AGENT-PLAN §4.9); `install` checks it.
- **Local accounts only** (chosen): the member, and the groups that
  decide §11, must be in `/etc/passwd` and `/etc/group`. The builds
  are static and read no NSS source (LDAP, sssd, systemd-homed), so
  `install` refuses a member it can't find there, and the channel
  refuses a member holding a group it can't name (§11).
- **cgroup v2 only** (the unified hierarchy).
- **`dpkg`, `rpm` or `pacman`** as the package manager: one that records
  each file's owning package and digest (§11.4's policy-file check;
  chosen). xbps, apk and portage are not supported until measured;
  NixOS, whose policy files live in its store, needs its own design.
  There is no mode without the package check.
- **systemd 252 or later:** encrypted credentials came in 250,
  `systemd-creds has-tpm2` in 251, and `--tpm2-public-key=` in 252 (§5).

`install` checks the kernel, the cgroup hierarchy and systemd's version
itself, and stops with a plain message naming what is missing; it
never judges a system by its name. The distributions measured are
§13's (Ubuntu 24.04 and 26.04, Debian 12 and 13, Fedora 44); Fedora 38
or later meets these requirements too. Ubuntu 22.04 (systemd 249) and Fedora 37 (251) do
not.

## 2. Names, files and units

`<n>` is the pairing's name (AGENT-PLAN A3.10a's pattern). `<h>` is the
first 8 hexadecimal digits of the SHA-256 of `<n>` (A3.10a (8)).
`install` refuses a name whose `<h>` collides with an existing user or
group.

| What | Name or path | Owner, mode |
|---|---|---|
| Connector account | system user `vettid-c-<h>`, primary group `vettid-c-<h>` | shell `/usr/sbin/nologin`, home `/nonexistent`, password locked |
| Runner accounts | system users `vettid-r-<h>-1`, `vettid-r-<h>-2`, each with its own primary group | as the connector's |
| Member group (chosen) | group `vettid-m-<h>`, holding only the member | — |
| Program files | `/usr/local/libexec/vettid-agent/vettid-agent` | root, 0755; every folder up the path root-owned with no group or other write |
| Configuration (chosen) | `/etc/vettid-agent/<n>/service.json` | root:`vettid-c-<h>`, 0640, in `/etc/vettid-agent/<n>/` (root, 0755) |
| Sealed data key | `/etc/vettid-agent/<n>/data-key.cred` | root, 0600 |
| The last administrator check (§11.3) | `/etc/vettid-agent/<n>/admin.json` | root:`vettid-c-<h>`, 0640 |
| The elevated commands' lock (chosen) | `/etc/vettid-agent/<n>/lock` | root, 0600 |
| State | `/var/lib/vettid-agent/<n>/` | `vettid-c-<h>`, 0700, in `/var/lib/vettid-agent/` (root, 0755) |
| Run root (chosen) | `/var/lib/vettid-agent-run/<n>/`: a tmpfs mounted in the helper's namespace only (§6), never on disk | root, 0711, on an empty mount point `/var/lib/vettid-agent-run/<n>/` (root, 0711) that `install` makes |
| The channel | `/run/vettid-agent/<n>.sock` | `vettid-c-<h>`:`vettid-m-<h>`, 0660, in `/run/vettid-agent/` (root, 0755) |
| The helper's socket (chosen) | `/run/vettid-runhelper/<n>.sock` | root:`vettid-c-<h>`, 0660, in `/run/vettid-runhelper/` (root, 0755) |
| Units | `vettid-agent-<n>.socket`, `vettid-agent-<n>.service`, `vettid-runhelper-<n>.socket`, `vettid-runhelper-<n>.service` | in `/etc/systemd/system/` |
| The rules file (chosen; shared, written only on request) | `/etc/polkit-1/rules.d/40-vettid-agent.rules`, written by the elevated `vettid-agent rules-file --write` (§11.4) | root, 0644; uninstall leaves it, since the member's administrator chose it |
| The policy check (chosen; shared by every pairing) | `vettid-agent-polkitcheck.path` (`PathChanged=` on the `actions` and `rules.d` folders, and `polkitd.conf`, under each of `/etc/polkit-1`, `/run/polkit-1`, `/usr/local/share/polkit-1` and `/usr/share/polkit-1`, the folders polkitd reads, and on the allowed helper programs, §11.4) and `vettid-agent-polkitcheck.service` (`Type=oneshot`, root, the helper's hardening, with `ReadWritePaths=/etc/vettid-agent` so it can take each pairing's lock and write its `admin.json`, the package database readable, and `WantedBy=multi-user.target` so it also runs at boot), which writes every installed pairing's `admin.json` | in `/etc/systemd/system/`; the first `install` adds them, the last uninstall removes them |

- **Separate prefixes.** The run root is outside `/var/lib/vettid-agent/`,
  so a pairing named `run` can't meet it. The helper's units have their
  own prefix, so no pairing's name can make one of them
  (`vettid-agent-x-run` is pairing `x-run`'s; chosen).
- **The configuration** holds the member's uid, the uids of the three
  accounts, the `--run-path` folders, the `--run-env` values, whether
  `--no-tpm` was given. It is readable by the connector's account and
  not by the member, since a `--run-env` value may be private. The stub
  needs nothing from it: the socket's path comes from `<n>`, and the
  connector's account from `<h>` (§3).
- **The accounts kept apart.** `install` refuses, and the service and
  the helper check at each start, that:
  - no runner is in `vettid-c-<h>` or `vettid-m-<h>`;
  - the connector's account isn't in `vettid-m-<h>`;
  - the member isn't in `vettid-c-<h>`;
  - each runner's own group has no members and is no other user's
    primary group (a run's inputs are readable through it, §7);
  - the member isn't uid 0.

## 3. The channel's Unix-socket end

It follows A3.10a as merged (vettid-agent 311d86b): the same hellos,
`Op`s, refusal codes and `Admit` rules, with the peer's uid in place of
the Windows token. It is built (vettid/vettid-agent#55, A5.6's first PR).

- **The socket is made by systemd** (`vettid-agent-<n>.socket`):

  ```ini
  [Socket]
  ListenStream=/run/vettid-agent/<n>.sock
  SocketUser=vettid-c-<h>
  SocketGroup=vettid-m-<h>
  SocketMode=0660
  DirectoryMode=0755
  Accept=no
  RemoveOnStop=yes

  [Install]
  WantedBy=sockets.target
  ```

  `install` enables both socket units (this one and the helper's,
  §6), so the channel exists again after a reboot.
  `/run/vettid-agent/` is made by systemd, root-owned, 0755. Only the
  member (through the group) and root can connect.
- **The service** takes the socket from systemd: `LISTEN_FDS` and
  `LISTEN_PID` must name its own pid with exactly one descriptor, fd 3.
  It removes the variables, and checks that fd 3 is a listening
  `AF_UNIX` stream socket bound to `/run/vettid-agent/<n>.sock`. It
  stops otherwise, and never makes or binds a socket itself.
- **Who a client is.** The service reads the client's uid with
  `SO_PEERCRED` on the accepted connection: the credentials the kernel
  recorded at `connect`, never the pid and never anything the client
  says. The client is:
  - **the member** when the uid is the configuration's member uid;
  - **an elevated administrator** when the uid is 0, which on Linux is
    a command under `sudo`;
  - anyone else is refused (`not_allowed`), though the socket's mode
    already keeps them out.

  `Admit` then applies unchanged: tools for the member only, `pair`
  and `forget` for root only, `status` for either. A root client gets
  no tool. `member_is_admin` is §11.
- **The client's checks** (the stub and the elevated `pair`, `forget`
  and `status`), before sending anything:
  1. `lstat` the socket's path. It must be a socket, not a link, and
     owned by `vettid-c-<h>`, the uid looked up in the system's user
     database by the name `<h>` gives.
  2. `lstat` its folder and every folder above it up to `/`. Each must
     be a folder owned by root with no group or other write. Folders
     only root can change mean nobody else can swap the socket between
     this check and the connection.
  3. Connect, then read the server's uid with `SO_PEERCRED`. With
     socket activation it is the uid that called `listen`, systemd's
     (0), so the client accepts 0 or `vettid-c-<h>`, and refuses any
     other.

  The outcomes:
  - **a missing socket or connector account** is `ErrNoService`;
  - **a failed check in 1, 2 or 3** is `ErrNotService` (A3.10a's split);
  - **a socket the account may not open** is `ErrAccessDenied` (§10).

  The stub answers both `ErrNoService` and `ErrNotService` with the
  "No service" text.
- **Sandboxed clients** (the lead's call). The Windows end refuses an
  AppContainer client, since its token says it is sandboxed (A3.10a).
  Linux has no such mark on a connection, and the channel makes no
  check for one:
  - **Flatpak** apps run with a `/run` of their own, in which the host's
    `/run/vettid-agent/` isn't mounted unless the app is granted it
    (`--filesystem=/run/vettid-agent` or a host-wide permission), so
    they can't reach the socket;
  - **strict snaps** see the host's `/run`, but their AppArmor profile
    doesn't allow connecting to the socket, so they can't reach it
    either;
  - a sandbox that does expose the socket is the member's choice, and
    its client, which has the member's uid, **is the member**;
  - so is **any other process with the member's uid**: the uid is the
    only identity the channel reads.
- **Nothing else crosses**: no descriptor, no path, no configuration
  from the client (note §4). Files in and out (A3.10d) are framed
  messages of their own, as on Windows.

## 4. The connector service

`vettid-agent-<n>.service`, started on demand by the socket (Q5 b):

```ini
[Unit]
Description=VettID agent connector (<n>)
Requires=vettid-agent-<n>.socket vettid-runhelper-<n>.socket
After=vettid-agent-<n>.socket vettid-runhelper-<n>.socket
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=vettid-c-<h>
Group=vettid-c-<h>
ExecStart=/usr/local/libexec/vettid-agent/vettid-agent service --name <n>
StateDirectory=vettid-agent/<n>
StateDirectoryMode=0700
LoadCredentialEncrypted=vettid-<n>-data-key:/etc/vettid-agent/<n>/data-key.cred
Restart=on-failure
RestartSec=5
UMask=0077
SyslogIdentifier=vettid-agent-<n>
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectProc=invisible
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
SystemCallArchitectures=native
LimitCORE=1
KeyringMode=private
```

- **The hardening is chosen.** The service reads programs (to hash and
  copy them) but never writes outside its state folder. It reaches the
  relay and the helper's socket, and needs no capability. The service
  starts no program itself, so its sandbox is its own and not a run's
  (contrast §6).
  - `ProtectHome` costs nothing, since a program under `/home` fails the
    administrator-only rule anyway (owner a, GC #15787).
  - `MemoryDenyWriteExecute` doesn't affect `memfd_create`; the code PR
    confirms it with a test.
- **Restart and stop.** `Restart=on-failure`, at most 3 starts a minute
  (AGENT-SEPARATE-ACCOUNT §3). systemd's start limit counts every start,
  those the socket makes included, not only restarts after a crash.
  Since the service stays up while clients come and go and stops only
  after its idle time, a client that reconnects often doesn't reach it;
  a crash loop does, and then §4's "can't start" applies (said
  plainly). The idle stop of AGENT-PLAN §4.9 is the service exiting 0;
  the socket stays, and the next client starts it again.
- **When the service can't start** (its credential can't be unsealed,
  §5), systemd stops trying after the start limit and marks the
  socket failed too (`service-start-limit-hit`). `RemoveOnStop` then
  removes the socket file. The stub gets "No service"; `status` as root
  reads both units' state and their last result and says what failed
  and what to run. The elevated `pair` and `forget` work without the
  service (§5), and end with `systemctl reset-failed` on both units and
  a start of the socket (chosen).
- **Logs** go to the journal through standard error under
  `vettid-agent-<n>`. They hold only the pairing's name, the tool, the
  outcome code and a resolved program path (A5.6).
- **The accounts check** (A5.6, note §8). At each start the service
  reads the configuration and refuses runs and proxies, with `status`
  saying why, if:
  - its own uid, or a runner's, is the member's or 0, or is in an
    administrator's group (§11);
  - the runners' uids aren't two distinct uids other than its own;
  - any check of §2's "The accounts kept apart" fails.
- **Before it sends a secret to the helper**, the service checks the
  helper's socket as a client checks the channel (§3):
  - a socket, not a link, owned by root;
  - every folder up to `/` root-owned with no group or other write;
  - the server's uid 0.

## 5. The data key: a systemd credential (TPM 2.0, or `--no-tpm`)

This is the key-handling change of AGENT-PLAN §4.2 ("In the
separate-account mode", Linux), reviewed here before code.

- **What is sealed.** The state file's data key itself: 32 random bytes,
  sealed as the systemd credential `vettid-<n>-data-key`.
  - The state file keeps its format (`internal/state`). Its header names
    the protector `systemd-cred` (chosen) and has no `wrapped_key`
    member at all (absent, not empty); the code PR adds the vector.
  - The service refuses a state file whose protector is anything else.
- **How it is sealed.** By root, with `systemd-creds`:
  - with a TPM 2.0: `systemd-creds encrypt --name=vettid-<n>-data-key
    --with-key=host+tpm2 --tpm2-pcrs= --tpm2-public-key= - <path>`,
    with the key on standard input (never in an argument). The empty
    `--tpm2-public-key=` keeps a signed-PCR public key the system may
    have (systemd 252 and later look for one by default) from binding
    the key to PCR 11; the code PR tests the key still opens after PCR
    11 changes in swtpm;
  - with `--no-tpm`: the same with `--with-key=host`.

  `<path>` is always a fresh `data-key.cred.new` (any leftover is removed
  first). Then the command opens it, `fsync`s it, renames it over
  `data-key.cred`, and `fsync`s the folder. `systemd-creds` may warn that
  the folder isn't on encrypted media; `install` expects that warning
  and says what it means.

  Three choices here:
  - **`host+tpm2`** (chosen; the spec says "sealed to the TPM 2.0") needs
    both the TPM and the host key in `/var/lib/systemd/credential.secret`.
    So a copy of the disk without that computer's TPM opens nothing,
    and nor does the TPM without the disk.
  - **No PCRs** (`--tpm2-pcrs=` empty; chosen). This matches the
    same-account TPM protector, which has no PCR policy in v1 (chosen
    there too): PCR 7 changes with firmware and Secure Boot updates,
    and the key would then be lost.
  - **The credential's name binds it to the pairing**, since systemd
    refuses one loaded under another name.
- **The elevated commands work without the service** (chosen; see §4,
  "When the service can't start"). `pair`, `forget`, `install
  --upgrade` and uninstall take the lock (`flock` on
  `/etc/vettid-agent/<n>/lock`), so no two of them interleave, and
  `pair` and `forget` stop the socket and the service before they touch
  the state or the key. A stopped service can't write the old state
  back, and a stopped socket can't start it again.
- **`install`** seals a placeholder: a fresh random key that no state
  uses (chosen). `LoadCredentialEncrypted=` fails the unit when the
  file is missing, so without a placeholder the service couldn't start,
  and `status` and `pair` would have no service to talk to.
- **The elevated `pair`** makes the real key: a new key at each pairing,
  as today.
  1. Takes the lock.
  2. **Is there a pairing?** If the service runs, `pair` asks it over the
     channel; if not, it asks `vettid-agent state-wipe --check` (run as
     the connector's account, step 4) whether a state file is there;
     root never looks in the state folder. Without `--restart`, an
     existing pairing is refused before any key is touched, whether or
     not the key still opens it (after the TPM was cleared, say), and
     the refusal says to use `--restart`. `pair` never decrypts the key.
  3. Stops the socket and the service together (`systemctl stop
     vettid-agent-<n>.socket vettid-agent-<n>.service`), so no stub can
     start the service again with the old key while `pair` works. A
     run in flight ends, which discarding a pairing or making the first
     one may do.
  4. With `--restart`, deletes the old state file. Not as root: the
     command starts itself as the connector's account (`vettid-agent
     state-wipe --name <n>`, the same uid drop as the launcher's, §8),
     which opens the state folder with `O_DIRECTORY|O_NOFOLLOW` and the
     file relative to it with `O_NOFOLLOW|O_NONBLOCK`, checks with
     `fstat` that it is a regular file with one link owned by
     `vettid-c-<h>`, overwrites it, and removes it. Root never follows
     a path inside a folder the connector's account can change (chosen;
     a link or a FIFO planted there is refused, §13).
  5. Checks the TPM (below), generates the key (`getrandom`), seals it
     as above, and zeroes it in its memory.
  6. `systemctl reset-failed` on both units, then `systemctl restart`
     on the service (which starts its socket too). A restart, not a
     start: even if something started the service while `pair` worked,
     the one running afterwards is a new one that loaded the new key.
  7. Connects and sends the pairing code (A3.10a's console exchange).
     If the pairing then fails, the new key stays unused, and the next
     `pair` replaces it.
- **The elevated `forget`:**
  1. Takes the lock and stops the socket and the service together, as
     `pair` does.
  2. Overwrites and deletes the state file, as the connector's account,
     as `pair` does.
  3. Seals a new placeholder in place of the key, by the same
     `.new`-then-rename steps, so `data-key.cred` is never missing, even
     if the command stops midway.
  4. `reset-failed` on both units, then starts the socket only, so the
     next service to start loads the placeholder.
- **Rotation.** v1 has only `pair --restart`, which makes a new key
  with a new pairing (AGENT-PLAN §4.2's "any later rotation also goes
  through an elevated command"). A rotation that keeps the pairing is
  not built.
- **The old sealed key.** After the rename, the command overwrites the
  old `data-key.cred`'s bytes through a descriptor it opened before the
  rename, then closes it. On a copy-on-write file system or an SSD that
  is a best effort, said plainly; the sealed key alone opens nothing
  without the TPM.
- **How the service reads the key.** From
  `$CREDENTIALS_DIRECTORY/vettid-<n>-data-key` only. systemd decrypts it
  at each start into a folder only the service's account and root can
  read, outside the state folder. It must be exactly 32 bytes. The service
  never reads the `.cred` file, and takes no key or key path from
  anywhere else.
- **The TPM check.** `install` runs `systemd-creds has-tpm2` and reads
  its first line (`yes`, `no` or `partial`) and its `+`/`-` lines, not
  only its exit code, which is a bitmask:
  - `yes` (exit 0) is a usable TPM 2.0;
  - `+firmware` and `+driver` with `-libraries` is a TPM that systemd
    can't use yet: `install` stops and says to install the TPM 2.0
    libraries;
  - `+firmware` and `+driver` with `-system` is a TPM this systemd was
    built without support for: `install` stops and says so;
  - in both, `--no-tpm` is refused, since a TPM is there;
  - `-firmware` and `-driver` is none;
  - `+driver` with `-firmware` (a TPM that works but that the firmware
    doesn't report, after a legacy-BIOS boot) isn't taken as none:
    `install` tries a seal with the TPM, and allows `--no-tpm` only if
    that seal fails (the lead's call);
  - a TPM that `has-tpm2` reports usable but that then fails to seal
    stops `install` with systemd's error. `--no-tpm` stays refused,
    since a TPM is there. The way out is to repair or clear the TPM in
    the firmware, and the text says so (chosen);
  - output it can't read (an older systemd prints fewer lines) stops
    `install` with a plain message rather than counting as none.
  - Without one, `install` stops with a plain message unless `--no-tpm`
    is given. With one, `--no-tpm` is refused (the lead's call, §11).
  - The choice is recorded in the configuration. `pair` checks again,
    and a pairing installed with a TPM whose TPM is gone is refused
    rather than sealed to the host key. `+driver -firmware` counts as
    there for `pair` too, by the same trial seal. `forget` can't seal a
    `host+tpm2` placeholder then either. `status` says the way out:
    uninstall, then `install --no-tpm` (chosen).
  - `install` says, and `status` shows, when the key is sealed to the
    host key only: readable by root and not bound to hardware.
- **When it can't be unsealed** (the TPM was cleared or replaced, or the
  host key was removed), the unit fails at start (§4). `status` as root
  says the key can't be unsealed on this computer and that
  `pair --restart` makes a new one (chosen; the text is NEW, §12).
  `pair --restart` works then, because it needs no service until step 6.
- **On `device.unlinked`** the service deletes the state file it owns
  and marks the pairing gone. The credential stays until an elevated
  `forget`, and `status` says so (AGENT-PLAN §4.2, "Wipe in the
  separate-account mode").
- **Said plainly.**
  - Root on the computer can unseal the key: it can run `systemd-creds
    decrypt`, or start the unit. The TPM binds the key to this computer
    against a copied disk, not against its own administrator.
  - With no PCRs, anyone who starts that computer from other media and
    can read its disk (a disk without full-disk encryption) can unseal
    the key, as root on it would.
  - With `--no-tpm`, a copy of the disk that includes
    `/var/lib/systemd/credential.secret` opens the state.
  - As with the same-account TPM protector, an old copy of the state
    file and of `data-key.cred`, recovered from a backup or the raw
    disk, opens on the same computer until the TPM is cleared
    (AGENT-PLAN §4.2, accepted for v1).

## 6. The run helper

The one root component (AGENT-SEPARATE-ACCOUNT §3, "Starting a run as
the runner"). The connector can't start a process as another uid, so
the helper does that, and the cleanup that needs root, and nothing
else.

- **One per pairing** (chosen): `vettid-runhelper-<n>.socket` and
  `.service`. It reads only its own pairing's runner uids, so a flaw
  in one pairing's helper connection can't reach another pairing's
  runners.
- **Its sandbox is every run's sandbox.** Runs are the helper's
  children, so they inherit its seccomp filter, mount namespace,
  limits and keyring mode. So every option on the helper's unit is
  chosen for runs, not for the helper (chosen rule):
  - no `RestrictAddressFamilies`, since runs need the network;
  - no `MemoryDenyWriteExecute`, which breaks JIT runtimes;
  - and nothing else that would stop a program working.

  ```ini
  # vettid-runhelper-<n>.socket
  [Socket]
  ListenStream=/run/vettid-runhelper/<n>.sock
  SocketUser=root
  SocketGroup=vettid-c-<h>
  SocketMode=0660
  DirectoryMode=0755
  Accept=no
  RemoveOnStop=yes

  [Install]
  WantedBy=sockets.target

  # vettid-runhelper-<n>.service
  [Unit]
  Description=VettID agent run helper (<n>)
  Requires=vettid-runhelper-<n>.socket
  After=vettid-runhelper-<n>.socket

  [Service]
  Type=simple
  ExecStart=/usr/local/libexec/vettid-agent/vettid-agent runhelper --name <n>
  Restart=on-failure
  RestartSec=5
  Delegate=yes
  KillMode=control-group
  UMask=0077
  NoNewPrivileges=yes
  RestrictSUIDSGID=yes
  RestrictRealtime=yes
  LockPersonality=yes
  ProtectKernelTunables=yes
  ProtectKernelModules=yes
  ProtectKernelLogs=yes
  ProtectClock=yes
  ProtectHostname=yes
  SystemCallFilter=~@mount @module @reboot @swap @raw-io @clock
  SystemCallErrorNumber=EPERM
  PrivateDevices=yes
  KeyringMode=private
  LimitCORE=1
  PrivateTmp=yes
  PrivateIPC=yes
  TemporaryFileSystem=/dev/shm:mode=1777,size=256M
  TemporaryFileSystem=/var/lib/vettid-agent-run/<n>:mode=0711,size=1G,noswap
  ProtectSystem=strict
  ProtectHome=yes
  CapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_CHOWN CAP_FOWNER CAP_DAC_OVERRIDE CAP_KILL
  SyslogIdentifier=vettid-runhelper-<n>
  ```

  It starts when the connector first connects, and exits 0 once that
  connection has closed and both slots are clean, so the next
  connection finds a fresh one (chosen). `Restart=on-failure` brings it
  back after a crash, with the start limit as for the service (§4).

  What each option gives:
  - **The capabilities** are the ones the helper uses: setting the uid
    and groups, owning and removing a run's files, and signalling a
    run's processes. A change to a non-zero uid clears them for the
    child.
  - **`NoNewPrivileges`** holds for the helper and everything it starts,
    the launcher's own `exec` and every program a run starts included.
    It doesn't stop the helper's own `setuid`, which is a capability,
    not a new privilege.
  - **Core dumps.** A crashed run's core holds its secret.
    - **The limit is 1** (`LimitCORE=1`, which sets the hard limit too,
      so a run can lower it but never raise it; chosen, measured). At a
      limit
      of 0 the kernel still hands the core to a piped `core_pattern`
      handler, and on Ubuntu 24.04 apport then wrote a report with it to
      `/var/crash` (measured). At 1 the kernel aborts the dump before any
      handler runs ("has RLIMIT_CORE set to 1, Aborting core"): apport
      wrote nothing, and with a plain file pattern no core file was
      written either (both measured).
    - **Said plainly: a run can lower its own limit to 0**, which needs
      no privilege (and many programs that handle secrets do it on
      purpose). Then a piped handler runs as root, outside the run's
      sandbox. So the limit protects only runs that leave it alone.
    - **The handler** (owner a, GC #15995). `install`, the helper at
      each start, and the helper before each `start` read
      `/proc/sys/kernel/core_pattern`:
      - accepted: systemd-coredump, and a plain file pattern, which
        writes nothing for a run, whose hard limit is 1. If the code
        PR's measurement shows systemd-coredump putting
        `COREDUMP_ENVIRON` in the journal for a run at a limit of 0,
        systemd-coredump is refused like apport;
      - refused: apport, and any handler `install` doesn't know, as are
        the socket forms of Linux 6.16 and later (`@`, `@@`) until
        measured. `install` says how to turn apport off: `sudo
        systemctl disable --now apport`, which sets `core_pattern` back
        to the plain `core` (measured on Ubuntu 24.04). The cost, said
        plainly: a stock Ubuntu desktop needs that one command first.
      - The helper refuses a `start` while the handler is one `install`
        would refuse.
    - **As a backstop**, slot cleanup (§9 step 4) looks in
      `/var/crash` and `/var/lib/systemd/coredump` for files the runner
      owns or that name its uid, and keeps the slot out of use, with
      `status` naming them, until an administrator removes them. The
      code PR measures systemd-coredump at a limit of 0 on Fedora,
      checking its journal entry (`COREDUMP_ENVIRON`, which for the
      `env` way is the secret) and not only the core file (§13).
  - **Devices.** `PrivateDevices=yes` gives runs only the pseudo-devices
    (`/dev/null`, `/dev/zero`, `/dev/full`, `/dev/random`,
    `/dev/urandom`, `/dev/tty` and the pseudo-terminals): a program
    run with a secret needs no hardware, and a device node is a way
    past the sandbox. So a program that needs a GPU or a USB device
    doesn't work here (said plainly; chosen).
  - **The run root is a tmpfs** of the helper's own namespace
    (`TemporaryFileSystem=`, 1 GiB for both slots; chosen). The `file`
    secret and the inputs are never written to disk, a crash leaves
    nothing (the mount goes with the helper's namespace), and no other
    process on the computer sees it. Said plainly: a tmpfs can be
    swapped out, so a secret can reach the swap device as any
    process's memory can. `install` probes whether the kernel takes
    `noswap` by mounting a small tmpfs with it (measured to work on
    6.8), adds it to the mount if so, and the secret stays in RAM;
    otherwise it leaves it out. `install --upgrade` writes the unit again
    for the running kernel. Booted into an older kernel than the unit
    was written for, the helper's mount fails and it doesn't start; the
    elevated `status` says so and that `install --upgrade` fixes it
    (chosen).
  - **`PrivateTmp=yes`** and **`TemporaryFileSystem=/dev/shm`** give
    every run of this pairing the helper's own `/tmp`, `/var/tmp` and
    `/dev/shm`, not the system's, so a run can't leave a file where the
    member's processes look. **`PrivateIPC=yes`** does the same for
    SysV IPC and POSIX message queues. The two slots share them (§9).
    Measured on systemd 255 (a fresh `/dev/mqueue`, private SysV
    objects); the code PR measures it on 252 too, the minimum, and
    `install` refuses a systemd where `/dev/mqueue` isn't private.
  - **`ProtectSystem=strict`** leaves runs only these writable places:
    the helper's `/tmp` and `/var/tmp`, `/dev/shm`, `/dev/mqueue`, and
    their own run folder. Everything else is read-only to them,
    `/var/crash`, `/run/lock` and the cron and `at` spools included.
  - **`ProtectHome=yes`** means a run can't read `/home`, `/root` or
    `/run/user` at all. That agrees with A5.6 until `share` exists
    ("until then runs use `work/` only"). A member whose home is
    elsewhere (`/var/home` on Fedora's image-based systems, `/srv`, an
    NFS mount) would be readable, so `install` adds
    `InaccessiblePaths=-<home>` for the member's home from
    `/etc/passwd` whenever it is outside those (chosen; the `-` so an
    absent NFS or autofs home doesn't stop the helper), and the launcher
    checks it before each run (§8). `install --upgrade` reads the home
    again.
  - **Links in system paths** (Fedora's image-based systems link `/home`
    to `/var/home` and `/usr/local` to `/var/usrlocal`). A program's path
    and a `--run-path` folder are judged by their fully resolved path,
    each real folder up it checked as the `--run-path` rule does
    (AGENT-PLAN §4.9); the member may type either form, and the binding
    records what the connector resolved.

  The `share` card will need to lift `ProtectHome`, and
  `ProtectSystem`'s read-only view, for exactly the shared folders: a
  unit-level change, reviewed with it (§12), following A5.5a's rules
  for Linux. Each `share` then changes the unit and restarts the
  helper, which ends its runs. Under `ProtectSystem` a read-only
  folder gives `EROFS` to `faccessat2`'s `W_OK`, which that card must
  read as "not writable".
- **No `RestrictNamespaces=`** (chosen, measured). systemd's filter for
  it can't inspect `clone3`'s flags, so it blocks `clone3` outright:
  under `RestrictNamespaces=yes` a `clone3` call got `ENOSYS`, which
  would break `CLONE_INTO_CGROUP` (§8). The unit's own filter and
  `SystemCallErrorNumber=EPERM` leave `clone3` working (measured), and
  make a blocked call fail with `EPERM` rather than kill the program.
  Said plainly: a run can still create user namespaces, which reach
  more of the kernel; and with `@mount` blocked and `PrivateDevices`,
  sandboxing tools of their own (bubblewrap, rootless podman) don't run
  in a run.
- **What a run shares with the member's processes, said plainly.** The
  network namespace, so loopback ports and abstract Unix sockets, and
  the system D-Bus. The two slots can reach each other the same ways,
  and pass descriptors over a Unix socket.
- **Per-run limits** (chosen): each run's cgroup gets `pids.max` 512 and
  `memory.max` 2 GiB. Past `pids.max`, `fork` fails with `EAGAIN`; past
  `memory.max`, the kernel's out-of-memory killer ends a process in
  that cgroup. Either way the slot is cleaned as for any end.
- **Shared space, said plainly:** the run root's 1 GiB tmpfs and the
  helper's `/tmp` are shared by both slots, so one run can fill them.
  The other slot's next run then fails to start (its folder or input
  can't be written) and is refused with `run_failed`.
- **If the helper is compromised, said plainly:** it is root, and root
  can unseal the pairing's key (§5). Its small size, its own review and
  its sandbox are what stand between a run and that.
- **Who may talk to it.** The socket's mode admits root and the
  connector's group. The helper then checks `SO_PEERCRED` and accepts
  only the configuration's connector uid. It serves **one connection
  at a time**: the service's. A second one is refused while the first
  is open.
- **What it trusts.** Only its root-owned configuration
  (`service.json`) and the kernel. At start it checks:
  - the file is root-owned with no group or other write, in root-owned
    folders;
  - each runner uid is the uid of the user `vettid-r-<h>-<slot>`;
  - none is 0, the member's or the connector's, the two differ, and
    neither is in an administrator's group (§11.3) or a group §2 keeps
    apart, nor has a sudo, `doas` or polkit grant (§11.3, checked at
    each start).

  Any failure stops it, and `status` says why. It never takes a uid,
  a path, a program path or an environment of its own from the
  connector. It never starts anything as root for a run; the one root
  program it runs is `sudo` (and `cvtsudoers`), for the administrator
  checks (§11.5). The package check runs in a different unit, the
  policy check's oneshot (§2, §11.4).
- **Its own start** is checked as the service's is (§3): exactly one
  descriptor from `LISTEN_FDS` and `LISTEN_PID`, a listening `AF_UNIX`
  stream socket bound to `/run/vettid-runhelper/<n>.sock`.
- **At its start** it first ends every process of both runners (§9,
  steps 1 and 2), and only then runs the rest of the cleanup, so
  nothing still running can write again behind it. Its run root is a
  fresh tmpfs at each start, so nothing a crash left is there
  (AGENT-PLAN §4.9, the run's own directory). Only then does it take a
  connection.

## 7. The helper's protocol

Messages are frames over the helper's socket: a 4-byte big-endian
length (at most 1 MiB), then one JSON object with a `type`. Every
message after `start` names its run (`run`, the same 32 hexadecimal
digits), and a message whose `run` isn't a run of that connection, or
is another slot's, is refused (chosen). `start` and `check` bring a new
`run`; `check`'s is used only for its `admin` answer, holds no slot, and
is refused if it repeats one the connection used. Descriptors travel with
`SCM_RIGHTS` only on `start` (connector to helper) and `outputs`
(helper to connector).

| From | Message | Fields | Descriptors |
|---|---|---|---|
| connector | `start` | `v` (1), `slot` (1 or 2), `run` (32 hex digits), `argv` (`argv[0]` the resolved path), `env` (`NAME=value` strings), `cwd` (absent for `work/`, or a cleaned absolute path), `secret_file` (true for the `file` way), `inputs` (names, A3.10d) | the program's sealed memory file; standard input, output and error; with `secret_file` a sealed memory file holding the value; one sealed memory file per input |
| connector | `check` | `run` (a fresh 32-hex id, for a proxy's opening, §11.3); answered with `admin` only, never `error`, and accepted while both slots are busy | — |
| helper | `admin` | `run`, `at`, `result` (`admin`, `clear` or `not_checked`), `reasons` and `reported` (fixed codes, §11.3) | — |
| helper | `cwd` | `run`, `final` (the folder's path from the held descriptor), `writable` (bool) | — |
| connector | `go` | `run`, `final` (the path it approves, as the helper sent it) | — |
| connector | `refuse` | `run` | — |
| helper | `started` | `run` | — |
| helper | `exited` | `run`, `code` or `signal` | — |
| connector | `terminate` | `run` | — |
| helper | `outputs` | `run`, `files` (names), `dropped` (`{name, reason}`) | one sealed memory file per file in `files` |
| connector | `collected` | `run` | — |
| helper | `ended` | `run`, `clean` (bool), `reason` when false | — |
| helper | `error` | `run` when it concerns one, `code` (a short, fixed code) | — |

- **`admin` comes first.** After `start`'s checks and before it makes
  anything, the helper makes the administrator checks (§11.1) and sends
  their result. Unless it is `clear`, it then sends `error` with the
  code `member_is_admin` and ends the run as for `refuse`. The connector
  keeps the result: `admin` applies to every tool until a later check
  is `clear`; `not_checked` refuses that run only (§11.3).
- **`go` names what it approves.** The helper starts the program only
  if `go`'s `final` is exactly the `final` it sent for that run;
  otherwise it ends the run as for `refuse` (chosen). So a `go` meant
  for one slot's folder can't start the other slot's run.
- **Receiving descriptors.** With `MSG_CMSG_CLOEXEC`, and only with a
  frame's first byte: descriptors that arrive with any other read are
  closed and the connection is ended. A message whose control data was
  cut short (`MSG_CTRUNC`), or with more or fewer descriptors than its
  fields name, is refused. On any refusal or error every received
  descriptor is closed.
- **What the helper checks on `start`, before it makes anything:**
  - `slot` is 1 or 2, and that slot is free (its last run `ended` with
    `clean` true);
  - `run` matches `^[0-9a-f]{32}$`, and no folder of that name exists;
  - the program's descriptor is a memory file whose `F_GET_SEALS`
    succeeds with all four seals, and on Linux 6.3 and later with
    `F_SEAL_EXEC` too, so its mode can't change (AGENT-PLAN 0.1.18
    §4.9 adds it to the connector's seals where the kernel has it); at
    most 512 MiB; starting with the ELF magic. The `/memfd:` name in its
    link is chosen by the connector, so it proves nothing;
  - the program's memory file can be executed by the runner (its mode
    has `S_IXOTH`, since the runner is "other" to it; one made with
    `MFD_NOEXEC_SEAL` can't be);
  - the secret's and each input's descriptor is a sealed memory file:
    the secret at most 64 KiB (chosen), the inputs within A3.10d's caps;
  - each input and output name is **one path element** of at most 255
    bytes: not empty, not `.` or `..`, and with no `/`, `\`, `:` or NUL
    (A3.10d's flat names). The helper checks them itself, as it trusts
    no path from the connector;
  - the standard streams are pipes, or `/dev/null` (character device
    1:3);
  - `cwd`, if present, is absolute with no empty, `.` or `..` element,
    and not under `/tmp`, `/var/tmp` or `/dev/shm` (chosen: in a run's
    view those are the helper's own folders, §6, not the member's, so a
    path there would name another folder than the one approved; it's
    `cwd_not_allowed`);
  - `argv`, `env` and the input names within the connector's own caps
    of AGENT-PLAN §4.9, as a backstop.

  It passes `argv` and `env` on to the launcher unchanged (§8) and never
  reads them for meaning or adds to them. It never logs a frame,
  `argv`, `env`, `cwd` or a name, since `env` carries the secret for
  the `env` way (note §3).
- **How the helper reaches files** (chosen). It holds a descriptor of
  the run root. To reach anything below it, it opens the parent folder
  with `openat2(O_PATH|O_DIRECTORY, RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|
  RESOLVE_NO_MAGICLINKS)`, then:
  - makes a file with `openat` (`O_CREAT|O_EXCL|O_NOFOLLOW`) on that
    descriptor, and a folder with `mkdirat` (which fails with `EEXIST`
    by itself);
  - removes with `unlinkat` (`AT_REMOVEDIR` for a folder).

  Each name is one element, and neither call follows a final link. It
  sets owners and modes with `fchown` and `fchmod` on a descriptor it
  opened that way, never by name. Nothing is reached by a path a run
  could change, and no name can climb out.
- **What the helper makes**, as AGENT-PLAN §4.9 and note §3 have it,
  on the run root's tmpfs (§6): the run's folder `<run root>/<slot>-<run>/`
  (chosen name), owned by the slot's runner, 0700, holding:
  - `home/` (for `HOME`) and `tmp/` (for `TMPDIR`);
  - `work/`, the default `cwd`, with `work/in/` (root:runner, 0750) and
    its files written from the input descriptors (root:runner, 0440),
    and `work/out/` (0700). The run can read its inputs but not change
    them. Since it owns `work/`, it can rename `in/` and put another
    folder there, which only changes what it reads itself (said
    plainly);
  - `secret/` (0700), and with `secret_file`, `secret/value` (0600),
    written from the descriptor. The helper keeps that file's
    descriptor, overwrites the file through it at the end (wherever a
    run moved or linked it), and then removes the run's folder. On the
    tmpfs it never reaches the disk (see §6 on swap).

  The paths follow from `<n>`, the slot and `run`, so the connector
  builds `HOME`, `TMPDIR`, (0.1.2) `VETTID_IN` and `VETTID_OUT` (only
  for a run with non-empty `inputs` or an `output`, VAULT-MESSAGING
  §10.11), the secret's variable and `{secret_file}` in `env` and
  `argv` itself. Two of these
  depart from AGENT-PLAN §4.9's minimal environment, which copies them
  from the connector's environment, and the owner accepted both:
  - `USER` and `LOGNAME` are the runner's name (owner a, GC #15969),
    since the connector's would name the connector's account;
  - `HOME` is the run's own `home/` (owner a, GC #15978), since the
    connector's is `/nonexistent`.

  The helper adds nothing.
- **Order.**
  1. `start`.
  2. The launcher (§8) opens the folder, and the helper sends `cwd`.
  3. On a `go` that matches, the program starts and the helper sends
     `started`. On `refuse`, or a `go` that doesn't match, nothing runs
     and the run ends (from step 5).
  4. `exited` when the program's own process ends.
  5. Once every process of the run is gone (§9, steps 1 and 2), the
     helper collects the outputs the request named:
     - it first checks that the run's folder, `work/` and `work/out/`
       are still the runner's with no group or other bits. A run that
       opened one of them up could have let the other slot's run write
       there, and that run may still be running; then every output is
       dropped (`owner`), and the slot is used again only once the whole
       folder is removed (step 7);
     - it opens each name relative to `work/out/`, with `openat2` as
       above and `O_RDONLY|O_NONBLOCK|O_NOFOLLOW|O_NOCTTY`, so a FIFO or
       a device can't block it, and `fstat`s it. It keeps only regular
       files owned by the slot's runner with a link count of 1. A FIFO,
       a socket or a device is dropped with a new reason, `type`, which
       A3.10d's set (`size`, `link`, `owner`, `binding`, `missing`)
       needs (§12);
     - it **copies** each kept file into a new memory file, counting the
       bytes it copies against the caps (a file that grows past them is
       dropped, `size`), and seals it (the lead's call). It sends those
       in `outputs`, never a descriptor of the run's own file, which a
       descriptor the run passed elsewhere could still change.

     With no `output`, `files` is empty. If step 2 of §9 failed, every
     output is dropped.
  6. The connector reads and redacts them, then sends `collected`.
  7. The helper runs the rest of the cleanup, and sends `ended`.
- **`terminate`** (the connector's time limit, AGENT-PLAN §4.9): the
  helper freezes the run's cgroup, sends SIGTERM to every process in
  it, thaws it, and after 5 s writes `cgroup.kill`.
- **When the connection closes** (the service stopped or crashed), the
  helper kills every run of that connection (`cgroup.kill`) and cleans
  up, dropping any outputs. So a run ends with the service, as note §5
  ("Runs outlive a crash on macOS") says of a systemd unit.
- **What a compromised connector can do, said plainly.** It holds the
  key and the state. Through the helper it can run any ELF it likes as
  either runner, with any `argv` and `env`, in any folder a runner can
  open. It has no way through the helper to root, to any other uid, or
  to another pairing's runners: the helper starts nothing as root,
  reads the runner uids only from root's configuration, and serves only
  its own pairing.

## 8. Starting a run: the launcher, `cwd`, and the program

The helper starts **the launcher**, `vettid-agent run-launcher`, from
the root-owned program folder, as the slot's runner:

- **The start.** Go's `SysProcAttr`:
  - `Credential` with the runner's uid and gid, and the supplementary
    groups reset to none;
  - `Setsid`, so there's no terminal;
  - `UseCgroupFD`, so `clone3` places the child in the run's cgroup
    atomically (§9). There is no moment in which it runs outside it.

  The launcher's environment is empty. Its descriptors are the run's
  standard streams (0, 1, 2), the program's memory file (3), and a
  socket pair to the helper (4). `NoNewPrivileges` already holds for
  every thread, inherited from the helper's unit (§6).
  - **Placement is confirmed.** Before it sends `cwd` on to the
    connector, the helper reads the launcher's `/proc/<pid>/cgroup` and
    checks it names the run's cgroup. A `clone3` that is refused (an
    `ENOSYS` from a seccomp filter, say) is an error that fails the run;
    the helper never falls back to a plain fork and a later move.
  - **Securebits need no change.** The helper doesn't set
    `SECBIT_KEEP_CAPS` or `SECBIT_NO_SETUID_FIXUP`, so the change from
    uid 0 to the runner's clears the child's permitted and effective
    capabilities, as §6 relies on.
- **The launcher, in order** (on one OS thread: `runtime.LockOSThread`
  first, since Linux keeps `no_new_privs` and the session keyring per
  thread; the steps below and the `execve` all run on it):
  1. `prctl(PR_SET_NO_NEW_PRIVS)` (the unit set it already; setting it
     again costs nothing, and step 5 checks it on this thread); then
     `keyctl(KEYCTL_JOIN_SESSION_KEYRING, NULL)`, so the run has a
     session keyring of its own (§6). A failed join (for
     example `EDQUOT` on the runner's key quota) fails the run.
  2. Receives `cwd` (or `work/`'s path), `argv` and `env` from the
     helper. It checks that the member's home, if `install` made it
     inaccessible (§6), can't be opened, and fails the run otherwise
     (an autofs or NFS home that mounted after the helper started
     would otherwise be readable).
  3. Opens the folder **as the runner**, one element at a time from
     `/`: `openat(…, O_PATH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)`. A link
     anywhere in the path, or a folder above it that the runner can't
     search, fails the open (0.1.17: "`O_DIRECTORY|O_NOFOLLOW` at each
     element").
  4. Checks the held folder itself with `faccessat2(fd, "", X_OK,
     AT_EMPTY_PATH|AT_EACCESS)`: an `O_PATH` open doesn't check search
     permission on the last element, and the `fchdir` below would
     otherwise fail after the go. Then it reads:
     - the **final path from the descriptor** (`readlink` of
       `/proc/self/fd/<fd>`, not `realpath` on the name);
     - whether the runner may write there (`faccessat2(fd, "", W_OK,
       AT_EMPTY_PATH|AT_EACCESS)`, the "read only" check of 0.1.17).

     It reports both to the helper, which sends `cwd`. `ENOSYS` from
     `faccessat2` fails the run; it never falls back to `faccessat`.
  5. On the service's `go` only:
     - `fchdir` on the held descriptor, then it closes that and the
       helper's socket;
     - it marks every descriptor above 2 close-on-exec
       (`close_range(3, ~0U, CLOSE_RANGE_CLOEXEC)`), the memory file
       included;
     - it checks `prctl(PR_GET_NO_NEW_PRIVS) == 1` on the same thread;
     - then `execve("/proc/self/fd/3", argv, env)`.

     For an ELF file the kernel opens the image before it closes the
     close-on-exec descriptors, so this works. A script couldn't, and
     scripts are refused anyway (AGENT-PLAN §4.9).
  6. On `refuse`, or any failure, it exits non-zero without starting
     anything.
- **What the program inherits:**
  - only descriptors 0, 1 and 2, the run's standard streams; the code
    PR tests this (A5.6);
  - only the connector's environment;
  - its own session and no terminal;
  - `no_new_privs`, the helper's private keyring mode and core limit,
    and none of the helper's capabilities.
- **Said plainly.** A member folder as `cwd` fails at step 3 until the
  `share` card exists: the runner can't search `/home` (§6), so it is
  `cwd_not_allowed`, as AGENT-PLAN §4.9 says for a folder not shared.

## 9. A run's cgroup, its end, and slot cleanup

- **The cgroups.** The helper's unit has `Delegate=yes`, so the helper
  owns its subtree (cgroup v2).
  - At start the helper moves itself into a leaf, `<unit>/supervisor`
    (the "no internal processes" rule; on systemd 254 or later
    `DelegateSubgroup=supervisor` does it).
  - It makes `<unit>/run-<slot>` fresh for each run and opens it for
    `UseCgroupFD`.
  - A runner can't move a process out, since it can't write any
    `cgroup.procs` (AGENT-SEPARATE-ACCOUNT §2, "each run is its own
    cgroup").
- **The end of a run.** When the program's own process exits, the
  helper sends `exited`, then writes `cgroup.kill`, which ends every
  process left in the run's cgroup, a `setsid nohup` daemon included.
  It waits for `populated 0` in `cgroup.events` (at most 10 s; chosen),
  then removes the cgroup.
- **The sweeper.** Some cleanup can only be done as the runner: another
  uid's SysV IPC objects need `CAP_SYS_ADMIN`, which the helper doesn't
  hold, and a user keyring belongs to its uid. So the helper starts
  `vettid-agent run-sweeper` as the slot's runner, the same way it
  starts the launcher, in a fresh cgroup of its own (chosen). On one
  locked OS thread, as the launcher does, it joins a new session
  keyring and sets `PR_SET_DUMPABLE` to 0 first; a failed join keeps
  the slot out of use. It has
  30 s (chosen); if it hasn't exited 0 by then, it is killed and the
  slot stays out of use. The helper never trusts its exit code alone:
  each step below is confirmed by the helper's own reading.
- **Slot cleanup** comes before `ended`, and the slot is used again only
  when every step succeeds (Q6 a):
  1. The run's cgroup is empty and removed.
  2. **No process of the runner is left anywhere.** The sweeper calls
     `kill(-1, SIGKILL)`, which reaches every process of its uid but
     itself in one walk of the kernel's, so no process can fork past it.
     It repeats, at most 5 times (chosen), until a scan finds none: the
     helper reads the `Uid:` line of every `/proc/<pid>/status` for the
     runner as real, effective, saved or file-system uid. `kill(-1)`
     reaches a process whose real or saved uid is the runner's, not one
     that has it only as its effective or file-system uid. A run can't
     make such a process (`no_new_privs` keeps setuid programs from
     gaining their uid), so one found there is another program's doing: the
     helper doesn't kill it as root, and the slot stays out of use,
     with `status` naming it. Any targeted kill uses a pidfd, never a
     bare pid.
  3. **What the run's uid owns in the kernel goes.** The sweeper:
     - removes every SysV shared memory segment, semaphore set and
       message queue whose owner **or creator** is the runner
       (`IPC_RMID`; a run can give an object to another uid with
       `IPC_SET` and still remove it as its creator), and the POSIX
       message queues it owns in `/dev/mqueue`. The helper confirms
       none is left by reading `/proc/sysvipc/{shm,sem,msg}`, which list
       both;
     - clears its user and user-session keyrings (`@u`, `@us`) and
       invalidates its persistent keyring. A key a run cached there
       (a Kerberos `KEYRING` cache, say) would otherwise be there for
       the next run of the slot, another item's run steered by the
       agent.

     Then the sweeper exits, and step 2's scan runs again.
  4. **Files.** The run's folder is removed from the run root's tmpfs
     (§6). Every file the
     runner owns in the helper's `/tmp`, `/var/tmp` and `/dev/shm` (§6)
     is removed, by a walk that opens only folders
     (`O_DIRECTORY|O_NOFOLLOW`) and removes files with `unlinkat`,
     never opening one, so a FIFO can't block it. The other slot's run
     shares that `/tmp` and could move such a file behind the walk, so
     the walk runs again, and a file of the runner still found keeps
     the slot out of use. These are the only places outside its folder
     a run can write (§6). It also looks in `/var/crash` and
     `/var/lib/systemd/coredump` for a crash report or core of the
     runner (§6, "Core dumps"), which keeps the slot out of use.
  5. **Jobs:** a check only. A run can't make a cron or `at` job: the
     spools are read-only to it, and `crontab` and `at` are setgid or
     setuid programs that run under `no_new_privs` but gain no group or
     uid, and `cron.deny` and `at.deny` list the runner as well
     (`install`; a `cron.allow` that exists overrides them). It can't
     make a systemd user timer either, since a runner never has a user
     manager: no login, and no linger.

     The helper confirms there is no crontab, no `at` job, no linger file
     and no active `user@<uid>.service` for the runner. If any is found,
     the slot stays out of use and `status` says what was found and the
     command that removes it. This **departs from A5.6**, which says
     such jobs "are removed", and the owner accepted it (owner a, GC
     #15969): the helper can't write the spools without making them
     writable to every run too (its sandbox is theirs, §6), and a run
     can't make one in the first place.

  A step that fails, or a process still there after the second scan,
  keeps the slot **out of use**. `ended` says `clean: false` with the
  step, the connector's `status` says so (the tool's text is in
  AGENT-PLAN §11), and the helper tries the cleanup again at its next
  start and at the service's next connection (chosen).
- **Said plainly.**
  - The two slots share the helper's `/tmp`, `/var/tmp`, `/dev/shm` and
    IPC namespace, so a concurrent run of the other slot can read a
    world-readable file or object one run leaves there before it ends.
    A run's own `TMPDIR` and `HOME` are in its own 0700 folder, which
    the other can't read.
  - A run has the network, as a run does today.
  - A run can read anything on the computer that is readable by every
    user, outside `/home`.

## 10. The stub on Linux

`vettid-agent mcp --name <n>` and the elevated commands use §3's checks
and nothing else.
- The stub reads no configuration on Linux, so A3.10a's
  `config_refused` doesn't arise there (chosen).
- The elevated commands run as `/usr/bin/sudo
  /usr/local/libexec/vettid-agent/vettid-agent <command>`, both by
  absolute path (AGENT-SEPARATE-ACCOUNT §5). Run that way they connect
  as uid 0, which the service admits for `pair`, `forget` and `status`
  only.
- **Joining the member group takes a new login.** Until the member logs
  in again after `install`, their processes don't hold `vettid-m-<h>`.
  Their `connect` then fails with `EACCES`, which the stub answers with
  A3.10a's "can't open the channel" text. `install` says to log out and
  in again, and the README says it too (chosen).

## 11. `member_is_admin` on Linux (owner a, GC #16214, #16258 and #16331)

On Windows the service gives no tools to a member whose token holds
Administrators (`member_is_admin`, owner decision a, GC #15862): the
connector's own account protects its keys only from a standard account.
On Linux only root can read the connector's keys (§5), so the question
is whether code running as the member can become root on its own. On
Windows it can, from a split-token administrator, since User Account
Control is not a security boundary. On Linux, `sudo` and polkit asking
for the member's password is one. So the owner chose (a on GC #16214,
replacing a on #15946): **the member is an administrator when its
account can become root without a password, or reach what the keys or
that password pass through.** A member in `sudo`, `wheel` or `admin`
whose `sudo` asks for its password keeps its tools.

**Every check fails closed.** A check that can't be completed (a file
that can't be read, an answer that can't be parsed, a program that fails
or takes too long, an entry or a module the code doesn't know) never
admits the member: it is told as "could not check <what>", naming the
file, entry, module or service, never as a reason the member doesn't
have.

### 11.1 What makes the member an administrator

Any of these:

- **uid 0** (the member's own is refused at `install` in any case,
  §11.3). Another account with uid 0 counts when its password is empty
  (the next item); with a password or locked it is reported, since
  `su` to it asks for that password;
- **a refusing group**, which gives root, or what root reads, with no
  prompt:
  - `docker`, `lxd`, `incus-admin`, `libvirt`, `libvirtd`, `microk8s`,
    `snap_microk8s` and Fedora's `mock` (a container, VM or build-root
    manager can mount the host's disk or run as root);
  - `empower` (recent systemd: polkit says yes to every action for it;
    counted wherever it exists);
  - `disk` (raw access to the disk) and `kmem` (the kernel's memory);
  - `shadow` (the password hashes), `input` and `uinput` (every
    keystroke read or typed, the `sudo` password included; owner a, GC
    #16258);
  - `src` (Debian: it can write `/usr/src`, which root's builds use);
  - the `root` group, gid 0, whatever its name;
  - `staff`, when it can write `/usr/local`, `/usr/local/bin` or
    `/usr/local/sbin` (Debian before 12: early in root's `PATH`). Root
    code decides it from those folders' group and mode; the service's
    own group check doesn't list it (§11.3);
- **an empty password:** a password field that is empty in the
  account's `/etc/shadow` line (not `!`, `*`, `!!` or a `!` before a
  hash, which lock it), or, with no `shadow` line, in `/etc/passwd`.
  The member's, root's and that of any account whose password `sudo`
  asks for (`targetpw`, `runaspw`) count; so does, while a stack of
  `su` or `sudo` takes an empty password (`pam_unix`'s `nullok`,
  Ubuntu's default), that of any account that is uid 0, in a refusing
  group, holds a sudo or `doas` rule, or is one of polkit's
  administrator identities. Only when another account has an empty
  password does the checker read the `addAdminRule` calls in the rules
  folders (the one place this note reads polkit's rules rather than
  asking polkitd), taking the `unix-user:` and `unix-group:` strings they
  name, and, failing
  closed, every member of `sudo`, `wheel` and `admin` (for whose empty
  password counts only; it doesn't make those groups refusing). An
  `addAdminRule` whose return isn't a literal list of strings (built
  from a variable, a concatenation or a call) is then "could not check
  <file>"; §13 tests the stock files; Another account's empty
  password is reported (the lead's call, GC #16374);
- **a sudo rule or setting that asks for no password** (§11.2): any
  rule that applies to the member, directly, through a group, a
  netgroup or `ALL`, **for any host**, tagged `NOPASSWD` or with
  `!authenticate` in its options, **whatever its command and whatever
  user it runs as** (the lead's call, GC #16219: judging which commands
  are safe is open-ended; a rule for a package manager, `systemctl` or
  an editor reaches root through hooks, units or a shell escape). A rule
  for another host counts because a member who can set the host name or
  address (a stock polkit grant, §11.4) can make it apply. Also:
  `exempt_group` naming one of the member's groups; a `timestampdir` or
  `timestampowner` the member can write or is; a negative
  `timestamp_timeout`, or one above a day (chosen: after one use, `sudo`
  doesn't ask again for that long); a policy plugin in `/etc/sudo.conf`
  other than `sudoers_policy`;
- **a `doas` rule with `nopass`** for the member or one of its groups,
  where a setuid `doas` is installed (chosen);
- **an authentication stack that can succeed with no password** (the
  walk below);
- **a polkit action granted without a password** (§11.4; owner a, GC
  #16331);
- **a root service the member can command** (chosen): a socket the
  member's access probe (§11.5) can connect to, links resolved (so
  `/run/docker.sock` pointing at Podman's is Podman's): Docker's (also
  through an access list or a `daemon.json` group), rootful Podman's,
  containerd's, LXD's and Incus's administrator socket. libvirt's isn't
  probed: its sockets are open to every user by design, and
  `org.libvirt.unix.manage` decides (§11.4); a Kubernetes administrator's configuration it can
  read (`/etc/kubernetes/admin.conf`, `/etc/rancher/k3s/k3s.yaml`); and
  a snapd login in the member's `~/.snap/auth.json`, and a Kubernetes
  configuration in its `~/.kube/config` holding a local cluster's
  administrator credentials (both read by `install` and the elevated
  `status` only: the helper can't see home folders, §6, so at a run
  start these keep the last result);
- **an input the checks read that the member can change:** any file of
  §11.5 (the `sudoers` files and their includes, `sudo.conf`,
  `doas.conf`, the PAM files, every polkit folder polkitd reads and the
  old `.pkla` folders (`/etc/polkit-1/localauthority`,
  `/var/lib/polkit-1/localauthority`), the allowed helper programs,
  `pacman.conf` and the package databases, §11.4) that isn't root-owned (or, for the polkit rules folders, owned
  by polkit's own account), or that the member or every user can write, or
  whose folder they can.

**The authentication stack walk.** The `auth` lines of the PAM services
`sudo`, `sudo-i`, `su`, `su-l`, `doas`, `polkit-1`, and every service
named in `/etc/security/console.apps/` (Fedora's `userhelper`), are read
from `/etc/pam.d/`, else `/usr/lib/pam.d/`, else `/usr/share/pam.d/`,
else `other`, with `include`, `substack` and `@include` followed. The
code walks every path through the control values (`required`,
`requisite`, `sufficient`, `optional`, the `[value=action]` form with
its jumps, `bad` and `die`, and a leading `-`, which skips a module
that isn't installed) and counts the stack if some path reaches overall
success without a module that asks for the password or a factor a
program can't supply having succeeded. Modules are in three classes,
and the lists live in the code with a test:
- **always succeeds:** `pam_permit`;
- **always fails for the member:** `pam_deny`, and `pam_rootok` in the
  stacks of `sudo`, `su`, `doas` and the `console.apps` services under
  the setuid `userhelper` (it checks the real uid, which is the
  member's); in `polkit-1` it is counted as always succeeding, since
  polkit's agent helper may run with real uid 0;
- **a caching window:** `pam_timestamp` (vpnc's `config-util` stack on
  Fedora) is walked as failing and reported, like sudo's;
- **the deciders,** which succeed only with the password or a factor:
  `pam_unix`, `pam_sss`, `pam_systemd_home`, `pam_fprintd`, and
  `pam_u2f` without `nouserok` or `userpresence=0`;
- **everything else known,** walked both ways, succeeding and failing,
  since the code can't judge its condition for every caller: `pam_env`,
  `pam_faildelay`, `pam_faillock`, `pam_usertype`, `pam_localuser`,
  `pam_cap`, `pam_gnome_keyring`, `pam_kwallet5`, `pam_ecryptfs`,
  `pam_succeed_if`, `pam_wheel`, `pam_ssh_agent_auth`, and `pam_u2f`
  with `nouserok` or `userpresence=0` (so `auth sufficient
  pam_succeed_if.so user ingroup wheel`, `pam_wheel trust` and
  `pam_ssh_agent_auth` as `sufficient` count).

A module the code doesn't know is "could not check <module>". The stock
stacks of the measured distributions (§13; Ubuntu's trailing `required
pam_permit` after `requisite pam_deny`, Fedora's `pam_usertype` and
`pam_localuser` jumps, Arch's `[default=bad]`) are measured not to
count.

**Reported, not counted.** `status` names each of these, and none
refuses anything:
- `adm` and `systemd-journal` (owner a, GC #16258): they read the logs
  and don't give root. The connector logs no value (§4), runs can't
  dump core (§6, `LimitCORE=1`, apport refused), so what reaches the
  logs is only what a program a run starts writes there itself; the
  README says so;
- `auth_self` and `auth_self_keep` grants (the member's own password)
  aren't counted: they ask for the password a program can't supply;
- `video` (the lead's call, GC #16260): it can read the screen on some
  setups, not the keys; and `tty` (it can write to other terminals);
- another uid-0 account with a password, or locked;
- the caching settings: `timestamp_type=global` or `ppid`,
  `!tty_tickets` (the same as `global`), a `timestamp_timeout` above the
  build's default and up to a day (15 minutes on Debian and Ubuntu, 5
  upstream and on Fedora; read with `sudo -V`), `doas`'s `persist`, a
  polkit action at `auth_admin_keep` or `auth_self_keep`, and a kept
  polkit authorization (§11.4);
- an allowlisted polkit grant (§11.4).

Neither counted nor reported, with the reason: `lpadmin` (CUPS
administration doesn't give root under the stock `cups-files.conf`, its
`SystemGroup` and the filters' user; the lead's call, GC #16260),
`dip` (it starts dial-up connections, a fixed `pppd` configuration),
`wireshark` (it captures network traffic, not the keys), `sambashare`
(it shares the member's own folders).

### 11.2 How the sudo rules are read

Root runs `sudo -V` and `sudo -ll -U <member>`, by the absolute path of
each implementation found (below), with only `LC_ALL=C` and
`PATH=/usr/bin:/bin` in the environment, standard input from
`/dev/null`, at most 4 s each and 1 MiB of output, inside the checks'
overall bound (§11.3; chosen).
- **Which `sudo`.** Every setuid `sudo`, `sudo.ws` and `sudo-rs` in
  `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/usr/local/bin`,
  `/usr/local/sbin` and `/usr/lib/cargo/bin`, each judged by its
  resolved path (`/usr/bin/sudo` is an alternatives link on Ubuntu
  25.10 and 26.04, where `sudo-rs` is the default and the original is
  `sudo.ws`, measured on 26.04.1: `/usr/bin/sudo` resolves to
  `/usr/lib/cargo/bin/sudo`, and the original is a setuid
  `/usr/bin/sudo.ws`), with §6's folder checks on that path. The code knows the
  format of the original `sudo` (1.9 and later) and of `sudo-rs` once
  measured; parsing `sudo-rs` is a condition for the `install` PR
  (§13). One it doesn't know is "could not check <path>".
- **`sudo -V`**, as root, gives the implementation and the compiled-in
  values (the default `timestamp_timeout` and `timestamp_type`). Whether
  it also prints the `Defaults` as parsed is measured in the `install`
  PR (§13).
- **`sudo -ll -U`** answers from every source sudo is configured with
  (the `sudoers` files and their includes, LDAP and sssd), for this
  host. The code reads each rule's options (`NOPASSWD`, `Options:` and
  LDAP's `sudoOption`), the "Matching Defaults entries" and the "Runas
  and Command-specific defaults" blocks.
- **Rules for any host** come from the `sudoers` files themselves,
  read with `cvtsudoers -f json -e` (aliases expanded; the same 4 s and
  1 MiB bound; on Ubuntu 26.04 it is `cvtsudoers.ws`, beside `sudo.ws`,
  measured), which keeps
  every host's rules and `Defaults`: a rule or a host-scoped `Defaults`
  entry there counts by §11.1 whatever host it names, matched to the
  member by user, group, netgroup (one it can't resolve counts) or
  `ALL`. Rules held in LDAP or sssd are seen for this host only
  (§11.6). Without `cvtsudoers` (a system with `sudo-rs` alone) the
  result is "could not check sudoers for other hosts", and `install`
  names the package that brings it (chosen).
- **`Defaults`, and a rule's `Options`**, are judged against one list of
  entries known not to touch authentication (`env_reset`, `env_keep`,
  `env_delete`, `mail_badpass`, `secure_path`, `use_pty`, `lecture`,
  `insults`, `logfile`, `log_*`, `syslog*`, `!visiblepw`,
  `badpass_message`, `passwd_tries`, `passwd_timeout`, `pwfeedback`,
  `editor`, `requiretty`, `always_set_home`, `set_home`,
  `match_group_by_gid`, `always_query_group_plugin`, `rootpw`,
  `targetpw`, `runaspw` (each still asks for a password),
  `timestamp_timeout` and `timestamp_type` within the bounds above). An
  entry's negation is judged as its own entry: `!lecture` is on the list,
  `!authenticate` counts, `!tty_tickets` is reported. The list holds
  every entry of the stock `sudoers` of the measured distributions,
  checked by a test against each one's `sudo -ll -U` output; it lives in
  the code and grows by a revision of this note. Any other entry is
  "could not check <entry>". `pam_service`, `pam_login_service` and
  `pam_askpass_service` stay off it on purpose: they change which PAM
  stack sudo uses.
- **Failures.** A non-zero exit other than sudo's "not allowed to run
  sudo", any output on standard error, a line the code can't classify,
  or a timeout is "could not check sudo", naming what was printed, so a
  common case (`sudo: unable to resolve host`, a host name missing from
  `/etc/hosts`) can be fixed (chosen: no line is let through).
- Without any setuid `sudo`, there is no sudo rule.

### 11.3 Where and when it is checked, and where the result lives

A result is one of three (`result` in §7's `admin` message): **admin**
(the member is an administrator, with the reasons), **clear**, or **not
checked** (with what couldn't be checked). It holds its time, the
reasons and the reported settings as fixed codes, never a rule's or a
file's text.
- **`install`** makes every check of §11.1. It **refuses a member whose
  result is admin or not checked**, with the text of AGENT-PLAN §11
  ("Administrator member, install stops, Linux") naming the reason, and
  for Fedora's package grant the rules file that makes it ask for the
  password (§11.4). It also refuses a member who isn't a local account
  (§1), and a member who is uid 0 or uid 65534. For polkit's session
  kinds (§11.4) it asks about the member's sessions that exist then; an
  active session it couldn't see is asked at the first run start.
- **The run helper, at every run start** (the `admin` message), makes
  the checks of §11.1 before it makes anything for the run, asking only
  what refuses (the reported settings are read by `install` and the
  elevated `status`). **Admin** ends the run with `member_is_admin`,
  and the connector applies it to every tool, proxies included, until a
  later check is clear. **Not checked** (a timeout, polkitd restarting)
  refuses that run only: the next run start or proxy opening checks
  again, at most once a minute (chosen; until then, runs and proxies are
  refused without a check, and the text says to try again in a minute),
  so a passing failure doesn't send the member to the elevated
  `status`.
- **When a proxy opens**, the connector sends `check` (§7), and the
  helper answers with `admin` as at a run start; a proxy opens only on
  a clear result. So a member who only uses proxies is checked too, in
  its session.
- **The elevated `status`** makes them all again, writes the result to
  `/etc/vettid-agent/<n>/admin.json` (owned by root, group the
  connector's account, 0640, the same folder checks as the
  configuration, §2; the member's `status` gets it through the service,
  since a reason such as an empty password would tell another local user
  what to try), and connects to the service, which reads that file again
  whenever root's `status` connects. **This is how a member clears a
  refusal** after removing its cause: no run starts while tools are
  refused, so the member, or its administrator, runs the elevated
  `status` (AGENT-PLAN §11 says so in the refusal's text). After leaving
  a group, the member signs out and in again first, so its processes
  drop the group.
- **The service**, at each connection, checks the refusing groups
  except `staff`, by gid, from the group database (which every user can
  read) and from the groups the client holds (`SO_PEERGROUPS`, and the
  gid it connected with). A held group the local group database can't
  name refuses the member, since it may be an administrator's group from
  an NSS source the build doesn't read (§1). A member in a refusing
  group gets `member_is_admin` for every tool, as on Windows.
- **Between checks**, the service relies on the newest result, from
  `admin.json` or the helper's last `admin` message, and the member's
  `status` says when it was made.

**The cost.** The checks take the `sudo` calls of §11.2 and one
`CheckAuthorization` per action and subject asked. Their time at a run
start and at a proxy's opening is measured in the helper PR and bounded
there (10 s in all, each `sudo` call's 4 s inside it; over that, the
result is not checked); it is not part of the run's own time limit
(§13).

**The service's own accounts are held to more.** The connector's and the
runners' accounts have no password, so no prompt can be their boundary:
one of them in `sudo`, `wheel` or `admin` (sudo's usual groups), in a
refusing group, or with any sudo rule, `doas` rule or polkit grant (no
session, §11.4), refuses runs and proxies (§4, §6). `install` and the
helper at each start check it. Wherever this note says "an
administrator's group" for those accounts, it means all of these.

**Release gate.** No release of the separate-account mode on Linux ships
before the `install` and helper PRs that build these checks have merged
(chosen); until then only the channel's group check exists.

### 11.4 Polkit (owner a, GC #16331)

**The question is put to polkitd itself**, never decided by reading its
rules (they are JavaScript): root calls `CheckAuthorization` on the
system bus, with no user interaction allowed, for each subject and each
action below. A challenge is fine; an error for an action polkit lists,
or no answer, is "could not check polkit". With no polkitd on the
computer (no polkit service unit, no `polkitd` program, and
`org.freedesktop.PolicyKit1` neither on the system bus nor activatable
there) there is no polkit route, and nothing is asked. polkit 122 is the
oldest measured (§13); an older polkitd is "could not check polkit". (A
computer with only the old `.pkla` authority, polkit 0.105 as on Debian
11, also has a systemd below §1's floor.)

**The subjects** (chosen), so that whichever way the member signs in is
covered. Each is a process (`unix-process`, by pid, start time and
uid), never a `unix-session` subject: polkitd 124 (Ubuntu 24.04) and
127 (Ubuntu 26.04, Fedora 44) abort on one, and a few aborts in a row
reach systemd's start limit and leave polkit failed, which breaks the
desktop's password prompts until `reset-failed` (measured; the lead's
calls, GC #16589 and #16598):
- each of the member's logind sessions, active or not, as logind lists
  them then, asked through one of the member's processes that logind
  places in that session (`sd_pid_get_session`), all four of its uids
  the member's; never the session's leader (a tty session's leader is
  `login`, running as root). A session with no such process is "could
  not check", never a pass. A `manager`-class session (systemd 258 and
  later: the member's `user@.service`; Ubuntu 26.04 and Fedora 44 have
  one) isn't asked as a session: logind places none of its processes in
  it, and polkitd judges them by the member's display session (measured
  on all five desktops of §13);
- while the member's service manager runs, a transient unit of it (the
  checker's waiting program, started through that manager's bus as
  `systemd-run --user --machine=<member>@` does): judged by the display
  session's kind, but a rule can tell it apart (`subject.system_unit`,
  `subject.no_new_privileges`, polkit 124 and later), so it is asked
  too;
- a process of the member's in no session: the checker's own program
  started as the member in a mode that only waits (§11.5). Forked by
  the helper, a system service, it is in no session, and polkitd
  judges it with `allow_any`, not by the display session (measured on
  polkit 122, 124, 126 and 127: the five desktops of §13).
  Forked by `install` under `sudo` in a terminal, it sits in that
  terminal's session scope. Its answer is compared as the paragraph on
  comparison says.

**Groups.** polkitd 124 and later fill a `unix-process` subject's
groups from the group database (`getgrouplist`), but a caller on the
bus is judged by the groups its process holds. So each subject's held
groups (`/proc/<pid>/status`) are compared with the database's for the
member; where they differ (a member taken out of `wheel` while signed
in, whose session still holds it), every answer for that subject is
"could not check polkit: sign out and in again" (chosen; to measure,
§13).

With the member signed in nowhere (an `install` over SSH as another
user, say), only the no-session subject is asked, and the active case
waits for the first run start, whose stub runs in the member's session.

**Which actions refuse: every action meant for an administrator**
(owner a, GC #16331, the inverted rule). The checker enumerates the
actions polkit lists (`EnumerateActions`), and asks only those; an
action the list doesn't hold isn't asked. Each answer is compared with
the default **for the kind of subject polkit judged**, worked out as
polkitd's logind backend does (polkitbackendsessionmonitor-systemd.c and
polkitbackendinteractiveauthority.c; measured, GC #16634): the
process's own logind session, else, for a process of the member's
service manager, the member's display session, else none. A session is
local when it has a seat (`sd_session_get_seat`) and active when the
session's own user (`sd_session_get_uid`) is (`sd_uid_get_state`: any
of that user's sessions is active);
`Remote` isn't consulted. A local active session is compared with
`allow_active`, a local inactive one with `allow_inactive`, and a
session that isn't local (an SSH session), or none, with `allow_any`.
So the no-session subject is compared with `allow_any` under the
helper, and with the `sudo` terminal's session's default under
`install`; where it lands in a session already asked as a session
subject, its answer adds nothing and is dropped.

**Which folders.** polkitd reads actions, rules and `polkitd.conf`
from `/etc/polkit-1`, `/run/polkit-1`, `/usr/local/share/polkit-1` and `/usr/share/polkit-1` (polkit 127 on Fedora 44 and Ubuntu 26.04, measured;
Ubuntu 24.04's polkit 124 reads actions from all four and rules from
`/etc` and `/usr/share`). Every check of this section, the path unit,
the package check and the inputs of §11.1 cover every folder polkitd
reads on that computer; a `.policy` file under `/usr/local/share`,
which no package owns, counts as the package check says.

**Which default.** For the actions that refuse whatever their defaults
(below), the default compared with is the one **recorded in the
code** (upstream's, measured), never the
one on disk: a `.policy` file on the computer that makes one of them
weaker (`yes` where the recorded default asks for a password) counts as
a grant to every account, so the member is an administrator. For every
other action, a `.policy` file whose defaults include `yes` for any
kind of subject is checked against the package database (`dpkg
--verify`, `rpm -V`, or pacman's own records: `pacman -Qo` for the
owner, and the SHA-256 digest and size in that package's `mtree` file,
read as root; pacman's database path from `pacman.conf`): one no
package owns, or one whose content the
package manager reports as changed (its digest or size; a changed time
stamp or mode alone doesn't count), counts likewise (except a file
snapd wrote for a snap installed now, as snapd's own records list it;
chosen, measured in §13), and the install text names it (the README
says software installed outside the package manager can ship such a
file). `install` and the elevated `status` make this check, and so does
a root path unit (`vettid-agent-polkitcheck.path`, §2, watching every
folder polkitd reads) that starts a oneshot whenever they change, and
at boot, with no password: so a system update is checked as it happens, and
only a real new grant refuses (the lead's call, GC #16374). The oneshot
waits until the package manager's lock (`dpkg`'s frontend lock, rpm's
transaction lock, pacman's lock file `db.lck`, whose presence is the
lock; one that stays for minutes, as a crashed pacman leaves it, keeps
the result "not checked", and its text names the file) is free and the database is quiet, then checks, and
records a result only when two checks a few seconds apart agree; until
then it records "not checked". So it never judges a file in the middle
of the update that wrote it. It rewrites only the policy part of each
`admin.json`, carrying every other finding forward (the snapd and
Kubernetes items, the sudo, PAM and group findings): it never writes
"clear" for what it didn't check. It and the elevated `status` take the
pairing's lock (§2) before writing `admin.json`, so neither overwrites
the other. A digest mismatch the helper sees that persists starts it
again (a `StartUnit` call on the system bus, no `systemctl` program, at
most once a minute); if it still hasn't settled after a few minutes, the result's
text says to run the elevated `status`. Each check
records the files' digests in `admin.json`; at a run start or a proxy's
opening the helper only compares digests and runs no package manager,
and while the oneshot hasn't caught up with a change the result is "not
checked" ("try again in a minute"). **Every allowed helper program**
(each program on the `exec.path` allowlist, and each allowed with an
action's id, below) is held to the same check, whatever its defaults:
owned by a package and unchanged, watched by the path unit, its digest
recorded; one no package owns or whose content changed makes that
action, when polkit grants it to the member without a password, "could
not check", so it isn't allowed (the lead's condition, GC
#16589).

**How the package records are read.** The package manager used is the
one whose database owns polkitd's own program; none, or more than one,
is "could not check polkit". Each path is resolved through its
symbolic links, and the link and its final target must each be owned
and unchanged (Fedora's FirewallD `.policy` is a link rpm lists as
`%ghost`, which `rpm -V` doesn't verify; measured). "Could not check"
too: a file with no recorded digest (dpkg with no `md5sums` entry for
it, rpm's `%ghost` or `%verify(not filedigest)`, an `mtree` entry with
no `sha256digest`, or no `mtree`), a `?` in `rpm -V`'s output (a file
it couldn't read), and a file more than one package claims. For
pacman: run with `LC_ALL=C`, the owner from `pacman -Qqo <path>`, the
database path from `pacman-conf DBPath`, and the package's `mtree`
(gzip) parsed as mtree(5) says (`/set` defaults, `\ooo` escapes,
continued lines). Its SHA-256 and size are compared and the
modification time ignored (`pacman -Qkk`'s verdict isn't used: it also
flags a changed time alone); a `backup=` file (configuration pacman
keeps across upgrades) whose digest differs still counts as changed. A
package built locally (`makepkg`, the AUR) counts as owned, as pacman
records it, as one installed from a local file does with dpkg or rpm.

A distribution with none of `dpkg`,
`rpm` and `pacman` is not supported by the separate-account mode (§1,
the README). An action **refuses** when polkit
authorizes the member for it without a password and either
- the default for that kind of subject is `auth_admin`,
  `auth_admin_keep` or `no` (a grant the stock defaults don't make), and
  it isn't on the allowlist below (so mounting a USB disk or powering
  off, `yes` for an active session, refuses nothing); or
- it runs code as root, whatever its defaults, except the named ones
  whose recorded default is `yes` for that kind of subject, which are
  reported (and refuse for another kind): `sysupdate1.check`, and, from
  systemd v259's own policy files, `allow_active` `yes` for
  `sysupdate1.update` (a newer signed version only;
  `update-to-version` stays `auth_admin` and refuses),
  `machine1.host-login` (a login prompt only) and
  `home1.update-home-by-owner` (it needs the owner's own password; the
  lead's call, GC #16601), and `machine1.register-machine` (it names to
  machined a machine the caller already runs; reaching into it needs
  `shell` or `login`, which refuse). Those that refuse: `pkexec`
  (`org.freedesktop.policykit.exec`), `org.freedesktop.systemd1.*`
  units and environment (`manage-units`, `manage-unit-files`,
  `set-environment`), `machine1`'s shells, logins, machines and images,
  `portable1.attach-images`, the actions of `import1`, `sysupdate1` and
  `home1`,
  `udisks2`'s `open-device-system`, `modify-device-system` and
  `modify-system-configuration`, `org.libvirt.unix.manage`, PackageKit's
  `package-install-untrusted`, `package-downgrade`,
  `system-sources-configure` and
  `system-trust-signing-key`, aptdaemon's `install-file`,
  `install-or-remove-packages` and `change-repository`,
  `io.snapcraft.snapd.manage`, `org.freedesktop.accounts.user-administration`,
  dnf5daemon's `org.rpm.dnf.v0.rpm.execute_trusted_transaction` and
  `org.rpm.dnf.v0.rpm.Repo.confirm_key` (Fedora's package grant, below),
  and its `org.rpm.dnf.v0.rpm.execute_transaction`,
  `org.rpm.dnf.v0.rpm.Repo.conf_write` and
  `org.rpm.dnf.v0.base.Config.override` (not granted on Fedora 44),
  FirewallD's `all`, `config`, `direct` and `policies` (`direct` and
  `config` are raw rules passed
  to the firewall as root; firewalld passes an iptables
  `--modprobe=<program>` through unfiltered, measured not to run it on
  Fedora 44's kernel, which loads the module itself first, but that is
  the kernel's behavior, not a rule), and every action with the
  `org.freedesktop.policykit.exec.path` annotation whose program isn't
  on the allowlist, and isn't allowed with that action's id (the reason
  then names the program, not a rule).

**Implied grants** (the lead's calls, GC #16589 and #16601). An action
refused only under the first case above (its default `auth_admin*` or
`no`, not on the allowlist), granted while a granted action for the same subject
implies it (`org.freedesktop.policykit.imply`), is judged by that
implying grant: accepted when that grant is accepted on its own
(allowlisted with its condition met, recorded `yes` for that kind, or
`yes` by its own default for that kind, so not counted under the rule;
a kept authorization isn't), refused otherwise. An action that refuses
whatever its defaults stays refused, whatever implies it. One level
only, as polkitd follows an implication: it doesn't follow the implying
action's own. Measured: `login1.set-wall-message` comes with `power-off` and
`reboot` (`yes` for an active session), and `hostname1.set-machine-info`
with the allowlisted `set-static-hostname`.

**The allowlist** holds stock grants measured not to run a program the
member chooses as root (the measurements are in §13; the list lives in
the code with a test that names each, and changes only by a revision of
this note):
- Ubuntu 24.04's `policykit-desktop-privileges` and GNOME's rules for
  `sudo`, `admin` and `wheel` in an active local session: `udisks2`'s
  `filesystem-mount-system`, `encrypted-unlock-system` and
  `filesystem-fstab`; `timedate1`'s `set-time`, `set-timezone`,
  `set-local-rtc` and `set-ntp`, and the desktops' date-and-time
  actions (`org.gnome.controlcenter.datetime.configure`,
  `com.canonical.controlcenter.datetime.configure`,
  `org.kde.kcontrol.kcmclock.save`,
  `org.mate.settingsdaemon.datetimemechanism.settime`); `locale1`'s
  `set-locale` and `set-keyboard`; `bolt`'s
  `enroll`, `authorize` and `manage`; `fwupd.update-internal` only while
  fwupd's `OnlyTrusted` isn't off in any configuration file fwupd reads
  (`/etc/fwupd/fwupd.conf`, its mutable copy under `/var/etc/fwupd/`,
  an older `daemon.conf`; otherwise it installs unsigned system
  firmware, and refuses); the
  hibernate actions (`org.freedesktop.login1.hibernate`,
  `handle-hibernate-key`, `hibernate-multiple-sessions`,
  `org.freedesktop.upower.hibernate`); `org.gnome.cpufreqselector` and
  `org.mate.cpufreqselector`;
  `com.ubuntu.whoopsiepreferences.change`; `cups-pk-helper`'s
  actions for `sudo` and `lpadmin` that can't add a printer from a
  file, by exact id, derived from the methods' own checks in
  cups-pk-helper 0.2.6 (Ubuntu's; GNOME's control center recommends the
  package, so a stock Ubuntu 24.04 desktop has it):
  `org.opensuse.cupspkhelper.mechanism.` `class-edit`, `devices-get`,
  `job-edit`, `job-not-owned-edit`, `printer-enable` and
  `printer-set-default`. `PrinterAddWithPpdFile`
  opens the path the caller gives as root (only the config-file get and
  put switch to the caller's ids), and its check accepts any one of
  `all-edit`, `printeraddremove`, `printer-local-edit` or
  `printer-remote-edit`; so those four refuse until the rules file below
  makes them ask (owner a, GC #16381; the lead's call, #16397).
  `server-settings` refuses with them, and the rules file covers it too
  (chosen): it lets the member replace `cupsd.conf`, read with the
  caller's ids and sent as root, and whether a directive still accepted
  there (`SetEnv` reaching a backend cupsd runs as root, say) gives root
  isn't measured; the cost is a password prompt for print-server
  settings.
  `class-edit` stays: its check falls through to the printer check only
  for a name that isn't a class, so it can't reach that method on its
  own (renaming a class re-adds a printer only for a name that is no
  longer a class, and then from the temporary PPD the helper itself
  fetched, never a path the caller gives);
- `hostname1`'s `set-hostname` and `set-static-hostname`, **only with
  §11.1's rule that a `NOPASSWD` rule for any host counts** (the lead's
  condition, GC #16332): otherwise setting the host name could make a
  host-scoped rule apply. With a network source for sudo rules in
  `nsswitch.conf`'s `sudoers` line (read as sudo reads it, without
  regard to case; LDAP, sssd), whose host-scoped rules can't all be
  read, they leave the allowlist and refuse, and so does
  NetworkManager's `settings.modify.system` (it can set the host name
  and address);
- PackageKit's `upgrade-system`, `system-update`,
  `trigger-offline-update` and `trigger-offline-upgrade`, and
  aptdaemon's `upgrade-packages`, **only while they can neither install
  nor downgrade a package** (the lead's condition): a release that maps
  installs or local files to them takes them off the list, which §13's
  stock test catches. On Fedora too: they update what is installed from
  the configured repositories (chosen);
- NetworkManager's `settings.modify.system` (Fedora, `wheel`), under the
  condition above; ModemManager's `Device.Control` where a stock
  distribution grants it (measured, §13);
- Flatpak's `app-install`, `runtime-install`, `app-uninstall` and
  `runtime-uninstall` (a system install runs apps as the user, with no
  setuid; the lead's calls, GC #16374 and #16382). A system install's
  `apply_extra` step runs as root, but inside bubblewrap with every
  capability dropped, `/usr` and `/app` read-only, only the app's own
  `/app/extra` writable, no `/proc` and no bus (measured in flatpak
  1.14.6's `flatpak-dir.c`): root confined to the app's folder, not root
  on the computer;
- Fedora's `org.fedoraproject.thirdparty.opt-out` with its helper
  `/usr/lib/fedora-third-party/fedora-third-party-opt-out`, and the
  fixed helpers GNOME's settings daemon (48 and earlier, as on Ubuntu
  24.04 and Debian 12 and 13) runs through `exec.path` for the backlight
  and Wacom tablets, and mutter's `/usr/libexec/mutter-backlight-helper`,
  their successor in GNOME 49 and later (GC #16598): fixed programs, not
  chosen by the member. Another desktop's helper not on the list
  refuses, with the program named;
- update-notifier's `com.ubuntu.update-notifier.pkexec.package-system-locked`
  (Ubuntu, `yes` for active and inactive sessions): its helper
  `/usr/lib/update-notifier/package-system-locked` is a fixed script
  that only runs `fuser` on apt's lock files. It is allowed because the
  package check pins the script's digest, so a changed script is "could
  not check", as for every fixed helper (GC #16589);
- gvfs's `org.gtk.vfs.file-operations-helper` (gvfs-backends' rule for
  `sudo`, `admin` and `wheel`, active and local), whose program
  `/usr/libexec/gvfsd-admin` runs as root, **only while**
  `org.gtk.vfs.file-operations`, which `gvfsd-admin` checks for each
  caller and each operation, asks for an administrator of the same
  subject (a challenge where its default for that kind is `auth_admin`
  or `auth_admin_keep`; polkitd's answer doesn't say whose password a
  challenge wants, so a rule returning `AUTH_SELF` can't be told from
  it), and every other subject asked is asked the same way or refused
  outright (a grant, an error or a challenge under another default
  breaks it); otherwise it refuses. `file-operations`' `auth_admin_keep` is reported as a caching
  window, as polkit's is (GC #16589);
- GNOME 50's (Ubuntu 26.04, Fedora 44; GC #16598): libmalcontent's
  `com.endlessm.ParentalControls.AppFilter.ReadAny`,
  `com.endlessm.ParentalControls.SessionLimits.ReadAny` and
  `org.freedesktop.Malcontent.WebFilter.ReadAny`, which read any
  account's parental controls (read-only, never root); and
  `org.gnome.controlcenter.set-keyboard` with its helper
  `/usr/libexec/gnome-control-center-set-debian-keyboard`, a script
  that takes arguments limited to `[a-zA-Z0-9,_:-]`, rewrites only the
  XKB lines of `/etc/default/keyboard` and runs `dpkg-reconfigure
  keyboard-configuration`: the effect of the allowlisted
  `locale1.set-keyboard`, which `org.gnome.controlcenter.set-keyboard`
  implies. The helper is
  allowed by its path, as the other fixed helpers are;
- gnome-software's `org.gnome.software.dkms-test` and `akmods-test`
  (Fedora, `yes` for an active session), **by action id** with their
  own helper `/usr/libexec/gnome-software-dkms-helper` and their
  recorded `exec.argv1` (`--test-dkms`, `--test-akmods`), which only run
  `mokutil --test-key` on a fixed key file; the same helper's
  `--enroll-*` actions (`mokutil --import`) keep refusing, and so does
  either id with another program or mode (GC #16601).

**Fedora's package grant and Ubuntu's printer grant count** (owner a,
GC #16331, B, and #16381). Stock Ubuntu desktops grant `sudo` and
`lpadmin` every cups-pk-helper action without a password, the four that
can add a printer from a file among them (see the allowlist), so a stock Ubuntu desktop member is refused until it
asks for the password, by the same rules file. On Fedora: stock Fedora
gives `wheel` PackageKit's `package-install` and `package-remove`
(beside the updates above) without a password, and a trusted local
RPM file maps to `package-install`, so code running as the member could
install any Fedora-signed package, an old build with a known hole
included, whose scriptlets run as root. Fedora's `dnf5daemon-server-polkit`
gives `wheel` the same through dnf5daemon:
`org.rpm.dnf.v0.rpm.execute_trusted_transaction` installs or removes
signed packages, and `org.rpm.dnf.v0.rpm.Repo.confirm_key` trusts a
repository's signing key (measured on Fedora 44; within the same
decision, the lead's call GC #16601). So a Fedora desktop member is
refused until those actions ask for the password. Stock Fedora also
grants `wheel` FirewallD's actions; `all`, `config`, `direct` and
`policies` refuse. Measured on Fedora 44, whose
`org.fedoraproject.FirewallD1.policy` links to one of two choice files:
in both, those four default to `auth_admin_keep`; in the desktop
variant (a Workstation's) `info`, `config.info`, `direct.info` and
`policies.info` are `yes`, in the server variant (the cloud image's)
only `info` is. The four `.info` actions are reported exceptions,
accepted with either default, and the rules file skips them, so the
firewall's status stays readable (the lead's calls, GC #16382 and
#16397). `install` names the one rules file
that makes all of them ask, `/etc/polkit-1/rules.d/40-vettid-agent.rules`,
written by the elevated `vettid-agent rules-file --write` (§2: root,
mode 0644, through the same folder checks as the configuration, as
`/etc/polkit-1/rules.d` is `root:polkitd 0750`, measured on Ubuntu 24.04
and 26.04 and Fedora 44: root-owned with no group or other write, so
the checks pass; a folder owned by polkit's own account instead makes
`--write` stop and print the file and its path for an administrator to
place; chosen), or printed by
`rules-file` for an administrator to read first
(it returns `polkit.Result.AUTH_ADMIN`, so it adds no kept-password
window where stock had none (the lead's call, GC #16676), for
PackageKit's two
actions, dnf5daemon's two, FirewallD's `all`, `config`, `direct` and `policies`, and
cups-pk-helper's four actions that can add a printer from a file and
`server-settings`, and sorts
before Fedora's own files, so it decides first), and the README gives
it; the member runs `install` again afterwards (the lead's call within
B, GC #16374). Fedora Silverblue and
Kinoite grant rpm-ostree's actions instead; no rules file is offered
for them, and the refusal names the action (chosen; §13 measures
them).

**A kept authorization** (an answer `is_authorized` true carrying a
`polkit.temporary_authorization_id`: the member typed the password in a
polkit dialog a moment ago) is reported as a caching window, not
counted; whether a session subject can return one is measured (§13).

**A limit, said plainly:** a rule that decides on an action's details (a
unit's name, a program's path) is asked without them, so a grant for
some details only can't be seen (§11.6).

### 11.5 The checker inside the run helper

The run helper runs no program as root for a run (§6). For these checks
it does exactly this, and nothing the connector names:
- it runs each `sudo` of §11.2 and `cvtsudoers`, after §6's folder
  checks on their paths (`install` and the elevated `status` also run
  `dpkg --verify`, `rpm -V`, or `pacman -Qqo` and the `mtree` read, for
  §11.4's package check, with the owner lookups of polkitd and of each
  allowed helper and the read of `pacman.conf`; the helper doesn't);
- it reads `/etc/passwd`, `/etc/shadow`, `/etc/sudo.conf`,
  `/etc/doas.conf` (and `/usr/local/etc/doas.conf`), the PAM files of
  §11.1, `/etc/security/console.apps/`, the group database, and the
  owners and modes of `/usr/local`'s folders and of every input it
  reads;
- it asks polkitd and logind over the system bus, and starts §11.4's
  subjects outside a session: its own waiting child, and a transient
  unit of the member's service manager, through that manager's bus;
- it starts the policy check's oneshot (§11.4) with `StartUnit` on the
  system bus, at most once a minute;
- **the access probes** for §11.1's root services run on a locked
  operating-system thread of the helper that sets its supplementary
  groups, file-system gid and file-system uid to the member's by raw
  system calls (`setgroups`, `setfsgid`, `setfsuid`, per thread), makes
  the probes, and is then discarded with its thread, never returned to
  the runtime (so no Go code runs in a forked child of the threaded
  helper; the lead's call, GC #16374). File and socket access is then
  judged as the member's; §13 checks that the thread can't open a
  root-only file. A probe only connects, with a non-blocking connect and
  a time limit (a stalled thread can't be killed as a child could), and
  closes; it sends nothing to the service it reaches. A denial is
  compared with the file's owner, mode and access list: one these would
  allow the member (an SELinux or AppArmor denial of the helper's own
  domain) is "could not check", never a "no". (The connect
  permission is judged with the member's file-system ids, but the
  daemon would see the thread's effective uid 0 in `SO_PEERCRED`: so a
  daemon that judges by peer credentials is judged here by the socket
  file's access alone.)
- **polkit's no-session subject** is the helper's own program (so
  polkitd judges it with `allow_any`, §11.4), started as the member (all its ids, no capabilities, `no_new_privs`, every
  inherited descriptor closed) in a mode that only waits, and exits when
  told or after the bound; its pid and start time are the subject. A
  member that kills it gives "not checked"; one that controls it can
  change nothing polkit answers about that pid.

A probe or subject that dies, stalls past its share of the bound or
answers otherwise is "not checked".

What this needs from the helper's unit (the capabilities `sudo -l` uses
as root, the system bus under its sandbox) is measured in the helper PR
and added there by exactly what is needed, said in that PR (§13).

**The elevated commands drop the member's sudo ticket.** `pair`,
`forget`, `rules-file --write` and the elevated `status` make the member
type the `sudo`
password, which opens sudo's caching window for that terminal. They
remove the invoking member's time stamp when they start and again before
they exit, as a best effort (chosen): the name comes from
`getpwuid(SUDO_UID)`, never from `$SUDO_USER`, and one holding a `/` is
refused; the file is removed with `unlinkat` in an opened
`/run/sudo/ts`, without following links. (A `timestampdir` other than
the default is already counted, §11.1.) The README says to run them in a
terminal where no agent runs.

### 11.6 What it doesn't protect against, said plainly

- **A caught password.** Code running as the member can put a `sudo` of
  its own in the member's shell configuration (also earlier: a program
  that ran before can have changed the shell's start-up files), show a
  polkit dialog of its own, or read the keystrokes where the session
  allows it (an X11 session; `ptrace` of the member's shell where
  `ptrace_scope` is 0, as on Fedora). It then catches the password the
  next time the member types it. That needs the member to act, and no
  check here can see it.
- **The caching windows.** For as long as `sudo` doesn't ask again
  (15 minutes per terminal on Ubuntu and Debian, 5 on Fedora), polkit
  keeps a grant, or a `console.apps` program's `pam_timestamp` holds
  (Fedora's `userhelper`), root is a command away without a prompt in
  that terminal or session. These are reported (§11.1), not detected.
- **A grant made between checks.** A member who adds a `NOPASSWD` rule
  (typing the password once to do it) is not seen until the next run
  start, proxy opening or elevated `status`; until then the service
  applies the last result.
- **What the checks can't see:** a polkit rule that grants an action
  for some details only (§11.4), or that decides on
  `subject.system_unit`, `subject.no_new_privileges` or `subject.pid`
  (polkit 124 and later), for a process of the member's unlike the
  subjects asked; host-scoped sudo rules held in LDAP or
  sssd, seen for this host only (the host-name grants then refuse,
  §11.4, but a rule given by IP address can still be made to apply: a
  member granted NetworkManager's `settings.modify.own`, the default for
  an active session, can bring up a connection of its own with a static
  address); sssd answering `sudo` from a stale
  cache; an inactive session's polkit result changing when the member
  switches to it.
- **Routes no check covers:** root's `authorized_keys` holding a key the
  member has (`ssh root@localhost`); setuid programs and programs with
  file capabilities; files run by root that the member can write
  (cron, units, a writable folder in root's `PATH`) other than the
  checks' own inputs; a root service reachable from the member's session
  other than those of §11.1, and bugs in any of them; an allowlisted
  polkit grant whose release changes what it does before the list does.

The README says the same, under "Running programs on Linux"
(AGENT-PLAN §11, "README, sudo password", Linux).

### 11.7 What it costs, and what is built

A member whose `sudo` asks for its password uses runs and proxies once
the stock grants that skip the password are made to ask: the first
user on a stock Debian desktop; on a stock Ubuntu desktop (in `sudo`
and `adm`), once the rules file of §11.4 makes cups-pk-helper's
printer-from-a-file actions and `server-settings` ask (Debian has no such grant:
`policykit-desktop-privileges` is Ubuntu's; §13 measures it); and
a stock Fedora desktop's first user (`wheel`), once the same file makes
the package installs and the firewall ask (owner a, GC #16331 and
#16381). Refused are the accounts
that can become root silently, or read or type the keystrokes, the
password hashes or the kernel's memory: uid 0, an empty password, a
`NOPASSWD` or `!authenticate` rule for any host, a `doas` `nopass` rule,
an authentication stack that skips the password, a polkit grant of an
administrator's action, a root service the member can command, and the
refusing groups, Docker's included. Ubuntu Server's first user is in
`lxd`, so it is refused there. Those members need a separate standard
account for the agent's work, as Windows administrators do.

The channel's code (vettid/vettid-agent#55) checks the groups; the
change to its list is card #16224's (vettid/vettid-agent#61). Until it
merges, the merged code still refuses a member in `sudo`.

## 12. What this note chooses

**Three choices depart from the plan's text, and the owner accepted
each:**
- slot cleanup **checks** for cron and `at` jobs, a linger file and a
  user manager, and keeps the slot out of use if one is found, where
  A5.6 says they "are removed" (§9 step 5; owner a, GC #15969);
- `USER` and `LOGNAME` are the runner's name, where AGENT-PLAN §4.9
  copies them from the connector's environment (§7; owner a, GC
  #15969);
- `HOME` is the run's own `home/`, where §4.9's minimal set copies it
  (§7; owner a, GC #15978).

A3.10d's set of reasons for a dropped output also needs a new one,
`type`, for a FIFO, a socket or a device (§7); that is A3.10d's to add.

The rest are "(chosen; not in the spec)" until the review and the
owner's go:

1. Linux 5.14, cgroup v2 and systemd 252 as the minimum, checked by
   version; local accounts only; `dpkg`, `rpm` or `pacman` as the
   package manager, with no mode without §11.4's package check (§1).
2. The member group `vettid-m-<h>`; the configuration's path, owner
   and mode; the lock; the run root `/var/lib/vettid-agent-run/<n>/` as
   a tmpfs of the helper's; the helper's socket and unit names; the
   accounts kept apart (§2).
3. `cron.deny` and `at.deny` for the pairing's accounts, as a backstop
   (§2, §9).
4. The service's hardening options; the failed-start recovery through
   `reset-failed` (§4).
5. For the key (§5):
   - the protector name `systemd-cred`, with no `wrapped_key`;
   - `host+tpm2` rather than `tpm2` alone; no PCRs and no signed-PCR
     public key;
   - the placeholder credential at `install` and `forget`, replaced by
     `.new` and a rename, and the old key's bytes overwritten as a best
     effort;
   - the elevated commands working without the service, under a lock;
   - the state file touched only as the connector's account;
   - the order of `pair`'s and `forget`'s steps, stopping the socket
     too, and the restart rather than a start;
   - reading `has-tpm2`'s lines, and a trial seal for `+driver
     -firmware`; the way out when the TPM is gone or fails to seal;
   - rotation only as `pair --restart` in v1;
   - the text for a key that can't be unsealed (NEW text).
6. For the helper (§6):
   - one helper per pairing, started on demand and exiting when idle;
   - the rule that its unit's options are chosen for runs;
   - its capability set and its sandbox options (with `PrivateIPC`, a
     private `/dev/shm`, `PrivateDevices`, a system-call filter failing
     with `EPERM`, `LimitCORE=1`, `noswap` where the kernel has it), a
     session keyring per run, the `core_pattern` check (apport refused,
     owner a, GC #15995) and the crash-report sweep as a backstop,
     `InaccessiblePaths=` for a home outside `/home`;
   - no `RestrictNamespaces=`, for `clone3`'s sake;
   - the per-run limits;
   - the `share` card's unit change for shared folders;
   - one connection at a time;
   - its start order (kill, then clean).
7. For the protocol (§7):
   - the frames and messages, `run` on every one, and `go` naming the
     folder it approves;
   - `F_SEAL_EXEC` required on Linux 6.3 and later, with the plan's
     matching change;
   - the checks on `start`, including the refusal of a `cwd` under
     `/tmp`, `/var/tmp` or `/dev/shm`;
   - the 64 KiB cap on a secret file;
   - the run folder's name; `in/` and its files owned by root;
   - all file work from parents opened with `openat2` beneath a held
     descriptor, owners and modes set through descriptors, and names of
     one element of at most 255 bytes;
   - outputs opened without blocking and copied into sealed memory
     files, after a check that the run's folders weren't opened up.
8. The launcher's thread lock and `no_new_privs` check, its `O_PATH`
   walk with the `X_OK` check, `faccessat2` without fallback, the
   cgroup placement check, the home check, and the descriptor numbers
   (§8).
9. The 10 s wait for an empty cgroup; the sweeper, its 30 s and its
   5 rounds; the retry of a slot out of use (§9).
10. No configuration read by the stub on Linux; the "log in again" step
    after `install` (§10).
11. In §11: the refusing groups beyond the owner's (`mock`, `kmem`,
    `empower`, `snap_microk8s`, `uinput`, `src`, and `staff` decided by
    `/usr/local`); another uid-0 account and other empty passwords; a
    `NOPASSWD` rule for any host (read with `cvtsudoers`); a
    `timestamp_timeout` above a day counted, the lower ones reported;
    `doas`'s `nopass` counted; a policy plugin other than
    `sudoers_policy`; root services the member can command and inputs it
    can change; the PAM walk's three classes and `console.apps`;
    `sudo -V` and `sudo -ll -U` with a fixed environment and limits,
    `Defaults` and `Options` judged against one known list; polkit asked
    through `CheckAuthorization` for each session and a no-session
    child, over the actions polkit lists, the inverted rule's allowlist
    (owner a-a, GC #16331, with the lead's two conditions, #16332) and
    the always-refusing actions, and the Fedora rules file; the three
    results (`admin`, `clear`, `not_checked`) and their use; the checks
    at `install`, every run start, every proxy opening (`check`) and by
    the elevated `status` (`admin.json`); the elevated commands dropping
    the member's sudo time stamp; the release gate. (Any `NOPASSWD` rule
    whatever its command, the negative timeout and the three check
    points are the lead's calls, GC #16219; `adm` and `systemd-journal`
    reported and `input` refusing are the owner's a, GC #16258; `video`
    reported and `lpadmin` unlisted are the lead's calls, GC #16260.)

## 13. The tests (A5.6's list, on Linux)

The code PRs carry these. They run in a Linux VM and on the ubuntu CI
runner under `sudo`, with throwaway users and units removed in cleanup.

- **Owed by the code PRs: the final units measured as written**, with
  every option above: the cgroup made, placed and killed under
  `ProtectKernelTunables=yes`; `/dev/shm` and `/dev/mqueue` private;
  the run root's tmpfs writable under `ProtectSystem=strict`; `clone3`
  and `CLONE_INTO_CGROUP` working under the system-call filter.
- **The channel** (vettid/vettid-agent#55, merged; the group list
  changed by card #16224):
  - another user is refused;
  - root gets `status`, `pair` and `forget` but no tool;
  - the member's normal process can't `pair` or `forget`;
  - a member in a refusing group gets `member_is_admin`, and a member
    in `sudo`, `wheel`, `admin`, `adm` or `systemd-journal` and nothing
    else gets its tools;
  - the stub refuses a link, a socket of another owner, a server of
    another uid, and a folder above the socket that another user can
    change.
- **The helper:**
  - it starts a program only as a runner uid and never as root;
  - it refuses a caller that isn't the connector and a second
    connection;
  - it refuses an unsealed or non-ELF program, a descriptor more or
    fewer than listed, a `run` that isn't 32 hexadecimal digits or
    whose folder exists, a slot other than 1 or 2, and a `cwd` under
    `/tmp`;
  - a run inherits only its standard streams, and runs with
    `no_new_privs`;
  - a run can resolve a name (DNS) and open a TCP connection;
  - a run's cgroup is the one the helper made for it before the go,
    and its `pids.max` and `memory.max` hold;
  - a crashed run leaves no core dump, no apport report and no journal
    entry with its environment, with apport and with systemd-coredump;
  - `install` and the helper refuse apport and an unknown handler, and
    accept systemd-coredump and a file pattern (owner a, GC #15995);
  - a run that lowers its own core limit to 0 and then crashes leaves no
    core and no journal entry with its environment under
    systemd-coredump or a file pattern (to be measured on Fedora in the
    code PR), and a report the backstop finds keeps the slot out of use;
  - a `core_pattern` socket handler (`@`, `@@`) is refused;
  - the helper's tmpfs with and without `noswap`, and the helper's
    refusal to start under a kernel older than its unit, with the
    elevated `status`'s text;
  - two slots at once: a `refuse` for one and a `go` for the other
    start only the other, and a `go` whose `final` doesn't match, or
    that names the other slot's run, starts nothing;
  - a run can write only in its folder, the helper's `/tmp` and
    `/var/tmp`, `/dev/shm` and `/dev/mqueue`.
- **A run's end:**
  - a daemon forked by one run (`setsid nohup`) is gone before the next
    run starts;
  - so are a file it leaves in `/tmp`, `/var/tmp` or `/dev/shm`, a SysV
    segment (also one it gave to another uid), a POSIX message queue,
    and a key in its user keyring;
  - a key one run puts in its session keyring (`@s`) is not found by
    the next run of either slot;
  - a FIFO left in `/tmp` doesn't block the cleanup;
  - an attempt to make a cron job, an `at` job or a systemd user timer
    fails;
  - a cleanup that can't be confirmed keeps the slot out of use, with
    `status` saying so.
- **`cwd`:** a link in the path is refused; a last folder the runner
  can't search is refused before the go; the final path is the
  descriptor's; a writable folder is reported as writable.
- **Files in and out:** a link, a FIFO, a file of another owner or with
  two links, and a name not asked for are dropped with their reasons,
  without blocking, and the rest arrive as descriptors before the run's
  folder is removed, as sealed copies a descriptor kept by the run
  can't change; an output folder a run opened up drops every output;
  an input or output name with `/`, `\`, `:`, `.` or `..` is refused at
  `start`.
- **The key:**
  - `install` without a TPM stops unless `--no-tpm`;
  - with `--no-tpm`, the host-key notice appears in `install` and
    `status`;
  - `--no-tpm` with a TPM is refused;
  - `pair` makes a new key, and `pair --restart` another, also while a
    stub keeps connecting during it;
  - a TPM that systemd can't use for want of its libraries stops
    `install` and refuses `--no-tpm`;
  - `forget` leaves only a placeholder, also when it is stopped
    between its steps;
  - a state file sealed under one pairing's key doesn't open under
    another's;
  - the key still opens after PCR 11 changes (swtpm), with a signed-PCR
    public key present on the system;
  - a link or a FIFO planted where the state file was is refused by
    `pair --restart`, `forget` and uninstall, and root follows neither;
  - after the TPM is cleared, `status` says the key can't be unsealed,
    and `pair --restart` pairs again without any `systemctl` command
    by hand.

  With a TPM, these run against a software TPM (swtpm) in the VM.
- **The accounts:**
  - `install` refuses a member who is an administrator, or who isn't a
    local account, with its text;
  - **the administrator checks (§11)**, on the measured distributions:
    Ubuntu 24.04 and 26.04, Debian 12 and 13, Fedora 44 (and Linux
    Mint, whose stock `sudoers` is said to hold `NOPASSWD` rules for
    every user: measured, and if so said in the README as a refusal).
    Each of these members is refused by `install`, at a run start (the
    `admin` message, then `member_is_admin`) and by the elevated
    `status`:
    - in each refusing group, by name and by an aliased gid; in `staff`
      with `/usr/local/bin` writable by it;
    - with an empty password, with root's empty, with another uid-0
      account, and with another account's empty while `su` has
      `nullok`;
    - a `NOPASSWD` rule for one command only (`/usr/bin/apt`), one
      through a group, one through `ALL`, one through a netgroup, one
      with a run-as user other than root, one for another host;
      `!authenticate` in `Defaults`, in a command's `Defaults` and in a
      rule's options; `exempt_group`; a negative `timestamp_timeout`,
      and one of two days; an unknown `Defaults` entry (told as "could
      not check"); a policy plugin other than `sudoers_policy`;
    - a `doas` `nopass` rule, and an unparseable `doas.conf`;
    - `pam_permit` as `sufficient` in `/etc/pam.d/sudo`, `pam_wheel
      trust` in `su`, `pam_u2f` with `userpresence=0` as `sufficient`,
      a passwordless stack in a `console.apps` service, an unknown
      module in `polkit-1`;
    - a polkit grant, by a `.rules` file, of an `auth_admin` action not
      on the allowlist (asked of the kind of subject whose default is
      `auth_admin`), of each always-refusing action, and of an
      `exec.path` action not on the allowlist, each asked in an active
      session, an inactive one and with no session; Fedora's stock
      package grant without the rules file;
    - the Docker socket reachable through an access list; a readable
      `/etc/kubernetes/admin.conf`;
    - a `sudoers` include, a PAM file or a polkit rules folder that the
      member can write;
    - `sudo -ll` failing, provoked by `sudoers: sss` in
      `nsswitch.conf` with sssd stopped and by a `sudoers` include
      that can't be read; a second setuid `sudo` the code doesn't know.

    And these are **not** refused: a user made with the groups each
    distribution's installer gives its first user (Ubuntu 24.04:
    `adm cdrom sudo dip plugdev users lpadmin`; Debian 12: `cdrom
    floppy sudo audio dip video plugdev users netdev bluetooth lpadmin
    scanner`; Fedora: `wheel`; Ubuntu 26.04 and Debian 13 measured on a
    desktop install in the PR), with the stock `sudoers`, PAM stacks and
    polkit rules (and on Fedora and Ubuntu desktops the rules file of
    §11.4; without it, Fedora's package and firewall grants and Ubuntu's
    printer-from-a-file actions and `server-settings` refuse, with the
    file named; with it in place
    those grants ask for the password, which shows the file sorts
    before the stock ones on each measured distribution),
    in an active session where it can mount a USB disk and power off;
    a rule with `rootpw` and a root password set; a `NOPASSWD` rule for
    another user; a member without `sudo` installed; a computer without
    polkitd. Each stock distribution's `sudo -ll -U` output parses with
    no unknown `Defaults` entry, and every stock grant is on the
    allowlist, which also confirms that Ubuntu's `upgrade-system`
    neither installs nor downgrades. The reported settings (`adm`,
    `systemd-journal`, `video`, `tty`, `timestamp_type=global`,
    `!tty_tickets`, a 60-minute timeout, `persist`, `auth_admin_keep`,
    an allowlisted grant) appear in `status` and refuse nothing. If any
    stock member is refused, it goes back to the owner before the PR
    merges;
  - the probe thread can't open a root-only file and is discarded after
    its probes; a probe to a socket that never answers times out; the
    no-session subject holds no inherited descriptor, and one the member
    kills mid-check gives "not checked";
  - **measured with a probe of this rule** (card GC #16419; the probe
    asks polkitd for every action it lists and every subject below, and
    judges the answers as this section does): stock desktops with the
    first user's groups (`sudo` and `lpadmin` on Ubuntu and Debian,
    `wheel` on Fedora), an active local session from autologin on tty1,
    an inactive one from a VT switch, and the member signed in nowhere;
    each subject asked through a process, a transient system service as
    the member, and a transient unit of the member's own service
    manager:

    | Distribution | polkit | Actions | Active, without the rules file | With it |
    |---|---|---|---|---|
    | Ubuntu 24.04 (`ubuntu-desktop-minimal`) | 124 | 289 | cups-pk-helper's five refuse | every subject passes |
    | Ubuntu 26.04 (`ubuntu-desktop`, GNOME 50) | 127 | 321 | cups-pk-helper's five refuse | every subject passes |
    | Fedora 44, the Workstation group on the cloud image (`VARIANT_ID=cloud`; GNOME 50) | 127 | 519 | PackageKit's and dnf5daemon's two each refuse | every subject passes |
    | Debian 12 (GNOME) | 122 | 256 | passes | passes |
    | Debian 13 (GNOME) | 126 | 278 | passes | passes |

    Inactive and with the member signed in nowhere, every distribution
    passes without the rules file too. On Fedora, FirewallD granted
    nothing: the Workstation group install on the cloud image keeps the
    server choice file, and polkit loads the desktop choice's rule for
    `wheel` only when it is linked, as a Workstation install links it.
    So FirewallD's four refusals on a Workstation are still measured in
    the `install` PR (below). In every run the kind of each
    no-session subject was read back
    from polkitd's own refusals: a kind is taken only when it explains
    at least five refusals the other kind doesn't, and the other
    explains none it doesn't. The system service was judged with
    `allow_any` every time (for example 129 refusals against 0 on Fedora
    44), and the unit of the member's service manager by the display
    session's kind, active or inactive (12 against 0 on Fedora 44, 34
    against 0 inactive on Debian 12). The test repeats this on each
    release's stock desktops, and a stock grant not on the allowlist
    goes back to the owner;
  - polkitd is never asked about a `unix-session` subject; each session
    is asked through one of the member's processes in it, never its
    leader; a session with no such process is "not checked"; a
    `manager`-class session is skipped; a seatless session (SSH) is
    compared with `allow_any`;
  - an action granted only through `imply` by a grant whose own default
    is `no` or `auth_self` refuses, and so does one implied through two
    levels; `login1.set-wall-message` through `power-off` is accepted;
    `manage-units` granted while an accepted grant implies it refuses;
  - gvfs's `file-operations-helper` refuses while `file-operations` is
    granted to any subject asked, answers with an error, or challenges
    where its default for that kind isn't `auth_admin*`;
  - an allowed helper program changed after `install` makes its action
    "could not check"; a stale pacman `db.lck` keeps the result "not
    checked", naming the file;
  - the recorded `yes` defaults count for that kind of subject only: a
    rule that grants `sysupdate1.update` to the no-session subject
    refuses;
  - `dkms-test` or `akmods-test` with another program or `exec.argv1`
    refuses; a grant over a default of `no` refuses;
  - a member taken out of `wheel` or `sudo` while signed in is "could
    not check: sign out and in again" (measured on one desktop with a
    caller on the bus, to show polkitd judges the held groups there);
  - a `.policy` file that is a link (Fedora's FirewallD) is checked
    through to its target; a file with no recorded digest, or more than
    one owner, is "could not check";
  - on a pacman distribution (Arch): a `.policy` file no package owns,
    and one whose content differs from its package's `mtree` digest or
    size, refuse through the package check; the oneshot waits for
    `db.lck`; the stock desktop's grants are measured as above;
  - the stock user is not refused when `install` runs in a desktop
    terminal, nor when a run starts with the member signed in at the
    desktop (the no-session subject, under the helper, compared with
    `allow_any`, §11.4);
  - `org.freedesktop.systemd1.manage-units` or `pkexec` edited to `yes`
    in its `.policy` file refuses; another action's `.policy` file
    changed to `yes` refuses through the package check;
  - the allowlisted updates are upgrade-only on Ubuntu and Fedora:
    PackageKit's `UpdatePackages` with the id of a package that isn't
    installed, of an older version, or of a kernel (an install-only
    package); `UpgradeSystem` and `trigger-offline-upgrade` to an older
    or a branched release; aptdaemon's upgrade with `pkg=version`. Each
    fails or asks for the password; one that doesn't takes its grant off
    the allowlist;
  - a rule that grants an action to an inactive or non-local subject
    only is asked and judged by that subject's default;
  - with `sudoers: sss` in `nsswitch.conf`, the host-name grants and
    NetworkManager's `settings.modify.system` refuse;
  - `fwupd`'s `OnlyTrusted=false` makes `update-internal` refuse;
  - a real package update that rewrites a `.policy` file ends "clear"
    with no elevated command: the oneshot waits for the update to end,
    and runs start again once it has checked;
  - Fedora's firewalld with each choice file (desktop and server): the
    `.info` actions are reported, the four others refuse until the
    rules file is in place; the stock `addAdminRule` files of each
    measured distribution read as literal lists;
  - measured and written in the `install` PR: the owner and mode of `/etc/polkit-1/rules.d`
    on each measured distribution (`root:polkitd 0750` on Ubuntu 24.04
    and 26.04 and Fedora 44, already measured); cups-pk-helper's action
    ids at the version each distribution ships (upstream checks
    `printer-default` where the registered id is `printer-set-default`,
    so the allowlist is checked against the shipped version's checks); ModemManager's
    `Device.Control` on Debian and Ubuntu; FirewallD's grants on a
    Fedora Workstation install (the desktop choice file linked); the
    polkit rules folders' owner on
    each distribution; Silverblue's rpm-ostree
    grants; snapd's policy files on a stock Ubuntu with a snap that
    uses its polkit interface; the package check's time at `install`; the recorded defaults of the named actions; whether
    `sudo -V` prints the parsed `Defaults`; whether a session subject
    can return a kept authorization; parsing `sudo-rs`, a condition
    for that PR;
  - a `NOPASSWD` rule added after `install` refuses the next run, and
    every tool and proxy after it, with `member_is_admin`; removing it
    and running the elevated `status` restores the tools;
  - the checks run inside the helper's unit as written, its sandbox
    and capabilities included (§11.5), within their bound;
  - a proxy opened by a member who never starts a run is checked
    (`check`), and refused once a `NOPASSWD` rule is added;
  - the elevated `pair`, `forget` and `status` leave no sudo time stamp
    for the member, at their start and their end, with the original
    `sudo` and `sudo-rs` (which names its files by uid);
  - a check that can't be completed (polkitd stopped) refuses that run
    only, and the next run after a minute, with polkitd back, starts;
  - the member's account can't read the state, the run root or a run's
    secret, and the run root isn't on any disk;
  - a connector or runner account made the member's, or put in
    `sudo`, `wheel`, `admin`, a refusing group or a group §2 keeps
    apart, or given a sudo, `doas` or polkit grant, refuses runs and
    proxies;
  - `rules-file --write` leaves the file root-owned, 0644, and the
    granted actions then ask for the password (the four printer actions
    and `server-settings` on Ubuntu, the package and firewall actions on
    Fedora);
  - with `class-edit` alone, `PrinterAddWithPpdFile`, and a class method
    on a name that isn't a class, fail or ask for the password;
    `ClassAddPrinter` with a new class name creates nothing that reads a
    file;
  - `install` and uninstall leave nothing behind but the rules file,
    which uninstall leaves (§2). Uninstall removes the
    users, the groups, the `.deny` entries, the run root,
    `/etc/vettid-agent/<n>/`, the credential and the pairing's four
    units, and the last pairing's uninstall the two shared policy-check
    units and the rules file `install` didn't write. It
    overwrites the state file before deleting it and removes the state
    folder as the connector's account (`state-wipe`, never root
    following its contents), runs the sweeper for both slots first,
    and takes the lock. The run root needs no removal: it is a tmpfs
    that goes with the helper.
  - `install --upgrade` keeps the state, regenerates the units and
    restarts the helper (ending its runs).
