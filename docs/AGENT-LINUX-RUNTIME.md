---
title: AGENT-LINUX-RUNTIME
status: draft design note; the run helper and the key sealing get their independent reviews (AGENT-PLAN §9 rule 6) from it, before their code. Built so far: the channel's Unix-socket end (vettid/vettid-agent#55)
version: 0.1.1
date: 2026-11-22
owner: Al Liebl (Mesmer)
component: vettid-agent (the agent connector): the separate-account mode on Linux (AGENT-PLAN A5.6)
related:
  - AGENT-SEPARATE-ACCOUNT.md (0.1.4) §2, §3, §4, §5, §6, §8
  - AGENT-PLAN.md (0.1.20) AG3, AG14, §4.2, §4.7, §4.9, A3.10a, A3.10d, A5.6, §11
changelog:
  - 0.1.1: 2026-11-22 (card #16224). §11 rewritten to the owner's a on
    GC #16214, replacing a on #15946, and a on #16258: the member is an
    administrator only when its account can become root without a
    password, or read the keystrokes, the password hashes or the
    kernel's memory. `sudo`, `wheel`, `admin`, `adm` and
    `systemd-journal` alone no longer refuse; `adm`, `systemd-journal`
    and `video` are reported. Counted: the refusing groups (`input`,
    `kmem`, `mock` and `staff` added), empty passwords, any `NOPASSWD`
    or `!authenticate` rule whatever its command and the `Defaults`
    that skip the password, a `doas` `nopass` rule, an authentication
    stack that can succeed with no password, and polkit actions meant
    for administrators granted with none, asked of polkitd for each of
    the member's sessions and none. Checked by `install`, at every run
    start in the helper (a new `admin` message, §7) and by the elevated
    `status` (`admin.json`, which also clears a refusal). The helper
    runs `sudo` as root for these checks and nothing else (§6). The
    caching settings are reported; what the rule doesn't protect
    against is said plainly. The service's own accounts keep the
    stricter list. §2, §3, §12 and §13 follow
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
- **systemd 252 or later:** encrypted credentials came in 250,
  `systemd-creds has-tpm2` in 251, and `--tpm2-public-key=` in 252 (§5).

`install` checks the kernel, the cgroup hierarchy and systemd's version
itself, and stops with a plain message naming what is missing; it
never judges a system by its name. Ubuntu 24.04, Debian 12 and Fedora
38 or later meet it. Ubuntu 22.04 (systemd 249) and Fedora 37 (251) do
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
| The elevated commands' lock (chosen) | `/etc/vettid-agent/<n>/lock` | root, 0600 |
| State | `/var/lib/vettid-agent/<n>/` | `vettid-c-<h>`, 0700, in `/var/lib/vettid-agent/` (root, 0755) |
| Run root (chosen) | `/var/lib/vettid-agent-run/<n>/`: a tmpfs mounted in the helper's namespace only (§6), never on disk | root, 0711, on an empty mount point `/var/lib/vettid-agent-run/<n>/` (root, 0711) that `install` makes |
| The channel | `/run/vettid-agent/<n>.sock` | `vettid-c-<h>`:`vettid-m-<h>`, 0660, in `/run/vettid-agent/` (root, 0755) |
| The helper's socket (chosen) | `/run/vettid-runhelper/<n>.sock` | root:`vettid-c-<h>`, 0660, in `/run/vettid-runhelper/` (root, 0755) |
| Units | `vettid-agent-<n>.socket`, `vettid-agent-<n>.service`, `vettid-runhelper-<n>.socket`, `vettid-runhelper-<n>.service` | in `/etc/systemd/system/` |

- **Separate prefixes.** The run root is outside `/var/lib/vettid-agent/`,
  so a pairing named `run` can't meet it. The helper's units have their
  own prefix, so no pairing's name can make one of them
  (`vettid-agent-x-run` is pairing `x-run`'s; chosen).
- **The configuration** holds the member's uid, the uids of the three
  accounts, the `--run-path` folders, the `--run-env` values, whether
  `--no-tpm` was given. It is readable by the connector's account and
  not by the member, since a `--run-env` value may be private. The stub
  needs nothing from it: the socket's path comes from `<n>`, and the
  connector's account from `<h>` (§3). The last administrator check's
  result is beside it in `admin.json`, readable by the connector's
  account and not by the member, like the configuration (§11.3).
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
  program it runs is `sudo`, for the administrator checks (§11.5).
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
is another slot's, is refused (chosen). Descriptors travel with
`SCM_RIGHTS` only on `start` (connector to helper) and `outputs`
(helper to connector).

| From | Message | Fields | Descriptors |
|---|---|---|---|
| connector | `start` | `v` (1), `slot` (1 or 2), `run` (32 hex digits), `argv` (`argv[0]` the resolved path), `env` (`NAME=value` strings), `cwd` (absent for `work/`, or a cleaned absolute path), `secret_file` (true for the `file` way), `inputs` (names, A3.10d) | the program's sealed memory file; standard input, output and error; with `secret_file` a sealed memory file holding the value; one sealed memory file per input |
| connector | `check` | `run` (a fresh 32-hex id, for a proxy's opening, §11.3); answered with `admin` only, never `error`, and accepted while both slots are busy | — |
| helper | `admin` | `run`, `at`, `admin` (bool), `reasons` and `reported` (fixed codes, §11.3) | — |
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
  their result. If the member is an administrator, or a check couldn't
  be completed, it then sends `error` with the code `member_is_admin`
  and ends the run as for `refuse`; the connector keeps the result and
  applies it to every tool (§11.3).
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
  builds `HOME`, `TMPDIR`, `VETTID_IN`, `VETTID_OUT`, the secret's
  variable and `{secret_file}` in `env` and `argv` itself. Two of these
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

## 11. `member_is_admin` on Linux (owner a, GC #16214 and #16258)

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

### 11.1 What makes the member an administrator

Any of these:

- **uid 0** (refused at `install` in any case, §11.3);
- **a group that gives root, or what root reads, with no prompt**
  (these are **the refusing groups** of this note):
  - `docker`, `lxd`, `incus-admin`, `libvirt`, `libvirtd`, `microk8s`
    and Fedora's `mock` (a container, VM or build-root manager can
    mount the host's disk or run as root);
  - `disk` (raw access to the disk) and `kmem` (the kernel's memory);
  - `shadow` (the password hashes) and `input` (every keystroke, the
    `sudo` password included; owner a, GC #16258);
  - `staff` (on Debian it can write `/usr/local`, early in root's
    `PATH`; counted wherever it exists, since the code can't tell);
  - the `root` group, gid 0, whatever its name;
- **an empty password**, the member's or root's: the password field of
  its `/etc/shadow` line is empty (not `!`, `*`, `!!` or a `!` before a
  hash, which lock it), or it has no `shadow` line and the field in
  `/etc/passwd` is empty (`pam_unix`'s `nullok`, Ubuntu's default, lets
  `sudo`, `su` and polkit through with no prompt);
- **a sudo rule or setting that asks for no password** (§11.2): any
  rule that applies to the member, directly, through a group, a
  netgroup or `ALL`, tagged `NOPASSWD` or with `!authenticate` in its
  options, **whatever its command and whatever user it runs as** (the
  lead's call, GC #16219: judging which commands are safe is
  open-ended; a rule for a package manager, `systemctl` or an editor
  reaches root through hooks, units or a shell escape); `exempt_group`
  naming one of the member's groups; a `timestampdir` or
  `timestampowner` the member can write or is; a negative
  `timestamp_timeout`, or one above a day (chosen: after one use,
  `sudo` doesn't ask again for that long); a `Defaults` entry the code
  doesn't know (§11.2);
- **a `doas` rule with `nopass`** for the member or one of its groups,
  where a setuid `doas` is installed (chosen);
- **an authentication stack that can succeed with no password:** the
  `auth` lines of the PAM services `sudo`, `sudo-i`, `su`, `su-l`,
  `doas` and `polkit-1` (from `/etc/pam.d/`, else `/usr/lib/pam.d/`,
  else `/usr/share/pam.d/`, else `other`), with `include`, `substack`
  and `@include` followed. The code walks every path through the
  control values (`required`, `requisite`, `sufficient`, `optional` and
  the `[value=action]` form with its jumps) and counts the stack if
  some path reaches overall success without a module that asks for the
  password or a factor a program can't supply having succeeded
  (`pam_unix`, `pam_sss`, `pam_systemd_home`, `pam_fprintd`, `pam_u2f`
  without `nouserok`). The model: `pam_permit` always succeeds,
  `pam_deny` always fails, and every other module known not to decide
  alone is walked both ways, succeeding and failing, since the code
  can't judge its condition for every caller, so `auth sufficient
  pam_succeed_if.so user ingroup wheel` counts (`pam_env`, `pam_faildelay`, `pam_faillock`,
  `pam_usertype`, `pam_localuser`, `pam_deny`, `pam_permit`,
  `pam_cap`, `pam_gnome_keyring`, `pam_kwallet5`, `pam_ecryptfs`,
  `pam_succeed_if`, `pam_wheel` without
  `trust`, `pam_rootok` in `su` only); `pam_wheel` with `trust` (Fedora ships it commented out in
  `su`), `pam_ssh_agent_auth` (the member's own SSH agent satisfies
  it), `pam_rootok` elsewhere and `pam_u2f` with `nouserok` succeed with
  no password. A module or a control the code doesn't know counts (fail
  closed). Both lists live in the code with a test, and change by a
  revision of this note. The stock stacks of Ubuntu 24.04, Debian 12
  and Fedora (Ubuntu's trailing `required pam_permit` after `requisite
  pam_deny`, Fedora's `pam_usertype` and `pam_localuser` jumps) are
  measured not to count (§13);
- **a polkit action granted without a password** (§11.4).

A check that can't be completed (a file that can't be read, an answer
that can't be parsed, a program that fails or takes too long) counts:
the member is refused with the "could not be checked" reason, never
admitted (fail closed).

**Reported, not counted.** `status` names each of these, and none
refuses anything:
- `adm` and `systemd-journal` (owner a, GC #16258): they read the logs
  and don't give root. The connector logs no value (§4), runs can't
  dump core (§6, `LimitCORE=1`, apport refused), so what reaches the
  logs is only what a program a run starts writes there itself; the
  README says so;
- `video` (the lead's call, GC #16260): it can read the screen on some
  setups, not the keys;
- the caching settings: `timestamp_type=global` or `ppid`, a
  `timestamp_timeout` above the build's default and up to a day (the
  default is 15 minutes on Debian and Ubuntu, 5 upstream and on
  Fedora; read with `sudo -V`), `doas`'s `persist`, and a polkit
  action of §11.4 at `auth_admin_keep` or `auth_self_keep`.

`lpadmin` is neither: printer administration through CUPS doesn't give
root under the stock `cups-files.conf` (its `SystemGroup` and the
filters' user), so it isn't listed (the lead's call, GC #16260).

### 11.2 How the sudo rules are read

Root runs `/usr/bin/sudo -V` and `/usr/bin/sudo -ll -U <member>`, by
absolute path, with only `LC_ALL=C` and `PATH=/usr/bin:/bin` in the
environment, standard input from `/dev/null`, at most 4 s each and
1 MiB of output, inside the checks' overall bound (§11.3; chosen).
- `sudo -V`, as root, gives the compiled-in values (the default
  `timestamp_timeout` and `timestamp_type`) and the implementation.
  The code knows the format of the original `sudo` (1.9 and later) and,
  once measured, `sudo-rs` (Ubuntu 25.10's default, installed beside
  the original as `sudo.ws`). Every setuid `sudo`, `sudo.ws` and
  `sudo-rs` in `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`,
  `/usr/local/bin`, `/usr/local/sbin` and `/usr/lib/cargo/bin` is
  checked, each in its own format; one the code doesn't know counts as
  "could not be checked" (chosen; the `install` PR measures `sudo-rs`).
- `sudo -ll -U` answers from every source sudo is configured with
  (the `sudoers` files and their includes, LDAP and sssd). The code
  reads each rule's options (`NOPASSWD`, `Options: !authenticate`),
  the "Matching Defaults entries" and the "Runas and Command-specific
  defaults" blocks. **`Defaults` are judged against a list of entries
  known not to touch authentication** (`env_reset`, `env_keep`,
  `env_delete`, `mail_badpass`, `secure_path`, `use_pty`, `lecture`,
  `insults`, `logfile`, `log_*`, `syslog*`, `!visiblepw`,
  `badpass_message`, `passwd_tries`, `passwd_timeout`, `pwfeedback`,
  `editor`, `requiretty`, `always_set_home`, `set_home`,
  `match_group_by_gid`, `always_query_group_plugin`, `rootpw`,
  `targetpw`, `runaspw` (each still asks for a password),
  `timestamp_timeout` and `timestamp_type` within the bounds above;
  it holds every entry of the stock `sudoers` of Ubuntu 24.04,
  Debian 12 and Fedora, checked by a test against each one's
  `sudo -ll -U` output). The list lives in the code with a test and
  grows by a revision of this note: any other entry counts.
  `pam_service`, `pam_login_service` and `pam_askpass_service` stay off
  it on purpose: they change which PAM stack sudo uses, so they count.
- A non-zero exit other than sudo's "not allowed to run sudo", any
  output on standard error, a line the code can't classify, or a
  timeout counts as "could not be checked". The text names what was
  printed, so a common case (`sudo: unable to resolve host`, a host
  name missing from `/etc/hosts`) can be fixed by the member (chosen:
  no line is let through). (sssd serving its cache
  without a word is not seen: said plainly in §11.6.)
- Without a setuid `/usr/bin/sudo`, there is no sudo rule; a setuid
  `sudo` elsewhere counts as "could not be checked".

### 11.3 Where and when it is checked, and where the result lives

- **`install`** makes every check of §11.1 and **refuses a member who
  is an administrator**, or whose check couldn't be completed, with the
  text of AGENT-PLAN §11 ("Administrator member, install stops,
  Linux") naming the reason. It also refuses a member who isn't a
  local account (§1), and a member who is uid 0 or uid 65534. For
  polkit's session kinds (§11.4) it checks the member's sessions that
  exist then; an active session it couldn't see is checked at the
  first run start.
- **The run helper, at every run start** (§7, the `admin` message),
  makes the checks of §11.1 again before it makes anything for the
  run. A member found to be an administrator, or a check that can't be
  completed, ends the run with `member_is_admin`. The connector keeps
  the result (in memory and in its state). **A finding that the member
  is an administrator** applies to every tool, proxies included, until
  a later check finds otherwise. **A check that couldn't be completed**
  (a timeout, polkitd restarting) refuses that run or proxy only: the
  next run start or proxy opening checks again, at most once a minute
  (chosen; until then, runs and proxies are refused without a check),
  so a passing failure doesn't send the member to the elevated
  `status`. The `admin` message tells the two apart: a check not
  completed carries the reason code `not_checked`, never with
  `admin` true.
- **The elevated `status`** makes them again, writes the result to
  `/etc/vettid-agent/<n>/admin.json` (owned by root, group the
  connector's account, 0640, the same folder checks as the
  configuration, §2; the member's `status` gets the result through the
  service, since a reason such as an empty password would tell another
  local user what to try), and connects to the service,
  which reads that file again whenever root's `status` connects. **This
  is how a member clears a refusal** after removing its cause: no run
  starts while tools are refused, so the member runs the elevated
  `status` (AGENT-PLAN §11 says so in the refusal's text).
- **The service**, at each connection, checks the refusing groups, from
  the group database (which every user can read) and from the groups
  the client holds (`SO_PEERGROUPS`, and the gid it connected with). A
  held group the local group database can't name refuses the member,
  since it may be an administrator's group from an NSS source the build
  doesn't read (§1). A member in a refusing group gets `member_is_admin`
  for every tool, as on Windows.
- **When a proxy opens**, the connector asks the helper for the checks
  (`check`, §7), and the helper answers with `admin` as at a run start;
  a proxy opens only on a result that finds no administrator. So a
  member who only uses proxies is checked too, in its session.
- **Between checks**, the service relies on the newest result, from
  `install`'s and the elevated `status`'s file or the helper's last
  `admin` message, and the member's `status` says when it was made.

A result holds its time, whether the member is an administrator, the
reasons and the reported settings, as fixed codes, never a rule's or a
file's text.

**The cost.** The checks take two `sudo` calls and one
`CheckAuthorization` per action and subject. Their time at a run start
and at a proxy's opening is measured in the helper PR and bounded there
(10 s in all, the `sudo` calls' 4 s each inside it; a check over that
counts as "could not be checked"); it is not part of the run's own time
limit (§13).

**The service's own accounts are held to more.** The connector's and the
runners' accounts have no password, so no prompt can be their boundary:
one of them in `sudo`, `wheel` or `admin` (sudo's usual groups), in a
refusing group, or with any sudo rule, `doas` rule or polkit grant (no
session, §11.4), refuses runs and proxies (§4, §6). `install` and the
helper at each start check it. Wherever this note says "an
administrator's group" for those accounts, it means all of these.

### 11.4 Polkit

**The question is put to polkitd itself**, never decided by reading its
rules (they are JavaScript): root calls `CheckAuthorization` on the
system bus, with no user interaction allowed, for each subject below
and each action below. An answer `is_authorized` true for any pair makes
the member an administrator; a challenge is fine; an error or no answer
counts as "could not be checked".

**The subjects** (chosen), so that whichever way the member signs in
is covered:
- each of the member's logind sessions (`unix-session`), active or not,
  as logind lists them then;
- a process of the member's in no session (`unix-process`, by pid and
  start time): a child the checker forks, which sets the member's uid
  and gids with `no_new_privs`, runs no program and exits after the
  check.

With the member signed in nowhere (an `install` over SSH as another
user, say), only the no-session subject is asked, and the active case
waits for the first run start, whose stub runs in the member's session.
An inactive session is only as good as logind's view at that moment;
that limit is said in §11.6.

**The actions that refuse** are these, whatever their defaults (the
lead's list, GC #16219, with more added; chosen): they run code as root, make
a root service, or reach the disk or the packages' trust:
- `org.freedesktop.systemd1.manage-units`, `manage-unit-files`,
  `set-environment` (which `run0` and an `LD_PRELOAD` into a root
  service use);
- `org.freedesktop.machine1.host-shell`, `host-login`, `shell`,
  `login`, `manage-machines`, `manage-images`;
- `org.freedesktop.portable1.attach-images`;
- `org.freedesktop.udisks2.open-device-system` and
  `modify-device-system`;
- `org.freedesktop.packagekit.package-install-untrusted`,
  `system-sources-configure`, `repo-enable`,
  `system-trust-signing-key`; aptdaemon's `org.debian.apt.install-file`,
  `install-or-remove-packages`, `change-repository`;
  `io.snapcraft.snapd.manage`;
- `org.freedesktop.policykit.exec` (`pkexec`), and every action with
  the `org.freedesktop.policykit.exec.path` annotation;
- `org.freedesktop.accounts.user-administration`.

**The other actions meant for an administrator** (every action polkit
lists whose shipped `allow_active` default is `auth_admin` or
`auth_admin_keep`) are asked too, and one granted without a password is
**reported, not counted** (chosen). Stock desktops grant several to the
first user with no password: Ubuntu's `policykit-desktop-privileges`
(mounting a system disk's file system, setting the time and the
locale), GNOME's control-center rules on Fedora and Debian (the locale,
the keyboard, the host name, the date and time), and Fedora's rule for
installing signed packages from the configured repositories
(`org.freedesktop.packagekit.package-install`, `package-remove`). None
of them runs a program the member chooses as root; installing a
package that isn't signed by a configured repository, configuring the
repositories or trusting a signing key does, and those are in the
refusing list. The list lives in the code with a test that names each
action, and changes only by a revision of this note. If stock Ubuntu
24.04, Debian 12 or Fedora would refuse a member in `sudo` or `wheel`
whose `sudo` asks for its password, it comes back to the owner before
the `install` PR merges (§13).

**A kept authorization** (an answer `is_authorized` true carrying a
`polkit.temporary_authorization_id`: the member typed the password in a
polkit dialog a moment ago) is reported as a caching window, not
counted; whether a session subject can return one is measured (§13).

**Where the no-session child sits.** Forked by the helper, it is in no
session. Forked by `install` under `sudo` in a terminal, it sits in that
terminal's session scope, so polkit may judge it as that session: the
stricter answer, never a weaker one.

### 11.5 The checker inside the run helper

The run helper runs no program as root for a run (§6). For these checks
it does exactly this, and nothing the connector names:
- it runs `/usr/bin/sudo` as §11.2 says, after the folder checks of
  §8 on its path;
- it reads `/etc/shadow`, `/etc/doas.conf` (and
  `/usr/local/etc/doas.conf`), the PAM files of §11.1 and the group
  database;
- it asks polkitd and logind over the system bus, and forks the
  no-session child of §11.4.

What this needs from the helper's unit (the capabilities `sudo -l`
uses as root, the system bus under its sandbox) is measured in the
helper PR and added there by exactly what is needed, said in that PR
(§13).

**The elevated commands drop the member's sudo ticket.** `pair`,
`forget` and the elevated `status` make the member type the `sudo`
password, which opens sudo's caching window for that terminal. Before
they exit they remove the invoking member's time stamp, as a best
effort (chosen): the name comes from `getpwuid(SUDO_UID)`, never from
`$SUDO_USER`, and one holding a `/` is refused; the file is removed with
`unlinkat` in an opened `/run/sudo/ts`, without following links. (A
`timestampdir` other than the default is already counted, §11.1.) The README says
to run them in a terminal where no agent runs.

### 11.6 What it doesn't protect against, said plainly

- **A caught password.** Code running as the member can put a `sudo` of
  its own in the member's shell configuration, show a polkit dialog of
  its own, or read the keystrokes where the session allows it (an X11
  session; `ptrace` of the member's shell where `ptrace_scope` is 0, as
  on Fedora). It then catches the password the next time the member
  types it. That needs the member to act, and no check here can see it.
- **The caching windows.** For as long as `sudo` keeps the member's
  password (15 minutes per terminal on Ubuntu and Debian, 5 on Fedora)
  or polkit keeps a grant, root is a command away without a prompt in
  that terminal or session. These are reported (§11.1), not detected.
- **A grant made between checks.** A member who adds a `NOPASSWD` rule
  (typing the password once to do it) is not seen until the next run
  start or elevated `status`; until then the service applies the last
  result.
- **Routes no list covers:** root's `authorized_keys` holding a key the
  member has (`ssh root@localhost`); setuid programs and programs with
  file capabilities; files run by root that the member can write
  (cron, units, a writable folder in root's `PATH`); a bug in a root
  service reachable from the member's session; a polkit action from a
  third-party package that gives root but isn't on the refusing list
  (it is only reported); Fedora's signed-package install, which lets a
  program add or remove any package of the configured repositories
  (a setuid program or a root service among them, or a security
  package removed), reported (§11.4); sssd answering `sudo` from a
  stale cache; an inactive session's polkit result changing
  when the member switches to it.

The README says the same, under "Running programs on Linux"
(AGENT-PLAN §11, "README, sudo password", Linux).

### 11.7 What it costs, and what is built

A member whose `sudo` asks for its password (the first user on a stock
Ubuntu or Fedora desktop, in `sudo` and `adm`, or `wheel`) uses runs and
proxies. Refused are the accounts that can become root silently, or
read the keystrokes, the password hashes or the kernel's memory: uid 0,
an empty password, a `NOPASSWD` or `!authenticate` rule, a `doas`
`nopass` rule, an authentication stack that skips the password, a
polkit grant, and the refusing groups, Docker's included. Those members
need a separate standard account for the agent's work, as Windows
administrators do.

The channel's code (vettid/vettid-agent#55) checks the groups; the
change to this list (refusing `input`, `kmem`, `mock` and `staff`; not
`sudo`, `wheel`, `admin`, `adm` or `systemd-journal`) is card #16224's.
Until it merges, the merged code still refuses a member in `sudo`.

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
   version; local accounts only (§1).
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
11. In §11: the refusing groups (`mock`, `kmem`, `staff` added to the
    owner's list); a `timestamp_timeout` above a day counted, and the
    lower ones reported; `doas`'s `nopass` counted; the PAM stacks and
    the empty passwords; `sudo -V` and `sudo -ll -U` with a fixed
    environment and limits, `Defaults` judged against a known list, an
    unknown `sudo` implementation not admitted; polkit asked through
    `CheckAuthorization` for each of the member's sessions and a
    no-session child: a named list refuses, the other actions meant
    for administrators are reported (stock desktops grant several),
    and a kept authorization is reported; the PAM stacks walked path by
    path; the connector's `check` when a proxy opens; the checks made by `install`, at every run
    start in the helper (the `admin` message, §7) and by the elevated
    `status` (`admin.json`), which is how a refusal is cleared; the
    elevated commands dropping the member's sudo time stamp. (Any
    `NOPASSWD` rule whatever its command, the negative timeout, the
    polkit action list and the three check points are the lead's calls,
    GC #16219; `adm` and `systemd-journal` reported and `input` refusing
    are the owner's a, GC #16258; `video` reported and `lpadmin`
    unlisted are the lead's calls, GC #16260.)

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
  - **the administrator checks (§11)**. Each of these members is
    refused by `install`, at a run start (the `admin` message, then
    `member_is_admin`) and by the elevated `status`:
    - in each refusing group (`input` and `docker` among them);
    - with an empty password, and with root's password empty;
    - a `NOPASSWD` rule for one command only (`/usr/bin/apt`), one
      through a group, one through `ALL`, one through a netgroup, one
      with a run-as user other than root; `!authenticate` in `Defaults`
      and in a command's `Defaults`; `exempt_group`; a negative
      `timestamp_timeout`, and one of two days; an unknown `Defaults`
      entry;
    - a `doas` `nopass` rule, and an unparseable `doas.conf`;
    - each stock distribution's `sudo -ll -U` output parsed with no
      unknown `Defaults` entry;
    - `pam_permit` as `sufficient` in `/etc/pam.d/sudo`, `pam_wheel
      trust` in `su`, an unknown module in `polkit-1`;
    - each named polkit action granted by a `.rules` file, asked in an
      active session, an inactive one and with no session; an action
      with the `exec.path` annotation; polkitd stopped (could not be
      checked);
    - `sudo -ll` failing, provoked by `sudoers: sss` in
      `nsswitch.conf` with sssd stopped and by a `sudoers` include
      that can't be read;
    - a second setuid `sudo` on the system.

    And these are **not** refused: a user made with the groups the
    distribution's installer gives its first user (Ubuntu 24.04:
    `adm cdrom sudo dip plugdev users lpadmin`; Fedora: `wheel`), with
    the stock `sudoers`, PAM stacks and polkit rules, on Ubuntu 24.04,
    Debian 12 and Fedora; a rule with `rootpw` and a root password set;
    a `NOPASSWD` rule for another user; a member without `sudo`
    installed. The reported settings (`adm`, `systemd-journal`,
    `video`, `timestamp_type=global`, a 60-minute timeout, `persist`,
    `auth_admin_keep`) appear in `status` and refuse nothing. If any
    stock member is refused, it goes back to the owner before the PR
    merges;
  - a `NOPASSWD` rule added after `install` refuses the next run, and
    every tool and proxy after it, with `member_is_admin`; removing it
    and running the elevated `status` restores the tools;
  - the checks run inside the helper's unit as written, its sandbox
    and capabilities included (§11.5), within their bound;
  - a proxy opened by a member who never starts a run is checked
    (`check`), and refused once a `NOPASSWD` rule is added;
  - an action of the refusing list granted refuses; a stock grant of
    another administrator action (Ubuntu's mount, Fedora's locale and
    signed-package install) is reported and refuses nothing;
  - the elevated `pair`, `forget` and `status` leave no sudo time stamp
    for the member, with the original `sudo` and, once measured,
    `sudo-rs` (which names its files by uid);
  - a check that can't be completed (polkitd stopped) refuses that run
    only, and the next run after a minute, with polkitd back, starts;
  - `sudo-rs`'s output is measured and parsed, or `install` on a system
    using it refuses with "could not be checked", said in the README;
  - the member's account can't read the state, the run root or a run's
    secret, and the run root isn't on any disk;
  - a connector or runner account made the member's, or put in
    `sudo`, `wheel`, `admin`, a refusing group or a group §2 keeps
    apart, or given a sudo, `doas` or polkit grant, refuses runs and
    proxies;
  - `install` and uninstall leave nothing behind. Uninstall removes the
    users, the groups, the `.deny` entries, the run root,
    `/etc/vettid-agent/<n>/`, the credential and the four units. It
    overwrites the state file before deleting it and removes the state
    folder as the connector's account (`state-wipe`, never root
    following its contents), runs the sweeper for both slots first,
    and takes the lock. The run root needs no removal: it is a tmpfs
    that goes with the helper.
  - `install --upgrade` keeps the state, regenerates the units and
    restarts the helper (ending its runs).
