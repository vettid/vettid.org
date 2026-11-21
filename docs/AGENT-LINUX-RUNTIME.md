---
title: AGENT-LINUX-RUNTIME
status: draft design note for review (blind pair, then the owner's merge go) before any code for the run helper or the key sealing; nothing here is built but the channel's Unix-socket end (vettid-agent, A5.6 PR 1)
version: 0.1.0
date: 2026-11-21
owner: Al Liebl (Mesmer)
component: vettid-agent (the agent connector): the separate-account mode on Linux (AGENT-PLAN A5.6)
related:
  - AGENT-SEPARATE-ACCOUNT.md (0.1.2) §2, §3, §4, §5, §6, §8
  - AGENT-PLAN.md (0.1.17) AG3, AG14, §4.2, §4.7, §4.9, A3.10a, A3.10d, A5.6, §11
changelog:
  - 0.1.0: 2026-11-21, first draft (card #15760, the lead's call a on
    GC #15918). How A5.6 is built on Linux: names, files and units; the
    channel's Unix-socket end; the connector service; the data key as a
    systemd credential sealed to the TPM 2.0 (and `--no-tpm`); the run
    helper, its protocol and the launcher; a run's cgroup and slot
    cleanup; the Linux side of files in and out; a proposed meaning of
    `member_is_admin` on Linux (open, §11). Every "(chosen; not in the
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
  `CLONE_INTO_CGROUP` (5.7), `faccessat2` (5.8), `close_range` with
  `CLOSE_RANGE_CLOEXEC` (5.11), `SO_PEERGROUPS` (4.13).
- **cgroup v2 only** (the unified hierarchy).
- **systemd 251 or later:** encrypted credentials came in 250, and
  `systemd-creds has-tpm2` in 251.

`install` checks the kernel, the cgroup hierarchy and systemd's version
itself, and stops with a plain message naming what is missing; it
never judges a system by its name. Ubuntu 24.04, Debian 12 and Fedora
37 or later meet it. Ubuntu 22.04 (systemd 249) does not.

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
| Run root (chosen) | `/var/lib/vettid-agent-run/<n>/` | root, 0711, in `/var/lib/vettid-agent-run/` (root, 0711); made by `install` |
| The channel | `/run/vettid-agent/<n>.sock` | `vettid-c-<h>`:`vettid-m-<h>`, 0660, in `/run/vettid-agent/` (root, 0755) |
| The helper's socket (chosen) | `/run/vettid-runhelper/<n>.sock` | root:`vettid-c-<h>`, 0660, in `/run/vettid-runhelper/` (root, 0755) |
| Units | `vettid-agent-<n>.socket`, `vettid-agent-<n>.service`, `vettid-runhelper-<n>.socket`, `vettid-runhelper-<n>.service` | in `/etc/systemd/system/` |

- **Separate prefixes.** The run root is outside `/var/lib/vettid-agent/`,
  so a pairing named `run` can't meet it. The helper's units have their
  own prefix, so no pairing's name can make one of them
  (`vettid-agent-x-run` is pairing `x-run`'s; chosen).
- **The configuration** holds the member's uid, the uids of the three
  accounts, the `--run-path` folders, the `--run-env` values, whether
  `--no-tpm` was given, and whether `install` found the member to be an
  administrator (§11). It is readable by the connector's account and
  not by the member, since a `--run-env` value may be private. The stub
  needs nothing from it: the socket's path comes from `<n>`, and the
  connector's account from `<h>` (§3).
- **The accounts kept apart.** `install` refuses, and the service and
  the helper check at each start, that:
  - no runner is in `vettid-c-<h>` or `vettid-m-<h>`;
  - the connector's account isn't in `vettid-m-<h>`;
  - the member isn't in `vettid-c-<h>`;
  - the member isn't uid 0.

## 3. The channel's Unix-socket end

It follows A3.10a as merged (vettid-agent 311d86b): the same hellos,
`Op`s, refusal codes and `Admit` rules, with the peer's uid in place of
the Windows token. It is built (A5.6 PR 1).

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
  ```

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
LimitCORE=0
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
  (AGENT-SEPARATE-ACCOUNT §3). The idle stop of AGENT-PLAN §4.9 is the
  service exiting 0; the socket stays, and the next client starts it
  again.
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
    --with-key=host+tpm2 --tpm2-pcrs= - <path>`, with the key on
    standard input (never in an argument);
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
  "When the service can't start"). `pair` and `forget` take the lock
  (`flock` on `/etc/vettid-agent/<n>/lock`), so two of them never
  interleave, and stop the service before they touch the state or the
  key. A stopped service can't write the old state back.
- **`install`** seals a placeholder: a fresh random key that no state
  uses (chosen). `LoadCredentialEncrypted=` fails the unit when the
  file is missing, so without a placeholder the service couldn't start,
  and `status` and `pair` would have no service to talk to.
- **The elevated `pair`** makes the real key: a new key at each pairing,
  as today.
  1. Takes the lock.
  2. **Is there a pairing?** If the service runs, `pair` asks it over the
     channel; if not, it looks for the state file itself. Without
     `--restart`, an existing pairing is refused before any key is
     touched. A state file that can't be opened with the current key
     (for example after the TPM was cleared) counts as an existing
     pairing, and the refusal says to use `--restart`.
  3. Stops the service (`systemctl stop`; a run in flight ends, which
     discarding a pairing or making the first one may do).
  4. With `--restart`, overwrites and deletes the old state file itself,
     as root.
  5. Checks the TPM (below), generates the key (`getrandom`), seals it
     as above, and zeroes it in its memory.
  6. `systemctl reset-failed` on both units, then starts the service,
     which loads the new key.
  7. Connects and sends the pairing code (A3.10a's console exchange).
     If the pairing then fails, the new key stays unused, and the next
     `pair` replaces it.
- **The elevated `forget`:**
  1. Takes the lock and stops the service.
  2. Overwrites and deletes the state file.
  3. Seals a new placeholder in place of the key, by the same
     `.new`-then-rename steps, so `data-key.cred` is never missing, even
     if the command stops midway.
  4. `reset-failed` on both units, then starts the socket.
- **Any later rotation** goes through the same elevated steps
  (AGENT-PLAN §4.2).
- **How the service reads the key.** From
  `$CREDENTIALS_DIRECTORY/vettid-<n>-data-key` only. systemd decrypts it
  at each start into a folder only the service's account can read,
  outside the state folder. It must be exactly 32 bytes. The service
  never reads the `.cred` file, and takes no key or key path from
  anywhere else.
- **The TPM check.** `install` runs `systemd-creds has-tpm2`:
  - exit 0 is a usable TPM 2.0; anything else is none.
  - Without one, `install` stops with a plain message unless `--no-tpm`
    is given. With one, `--no-tpm` is refused (the lead's call, §11).
  - The choice is recorded in the configuration. `pair` checks again,
    and a pairing installed with a TPM whose TPM is gone is refused
    rather than sealed to the host key.
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

  # vettid-runhelper-<n>.service
  [Service]
  Type=simple
  ExecStart=/usr/local/libexec/vettid-agent/vettid-agent runhelper --name <n>
  Delegate=yes
  KillMode=control-group
  NoNewPrivileges=yes
  RestrictSUIDSGID=yes
  LockPersonality=yes
  KeyringMode=private
  LimitCORE=0
  PrivateTmp=yes
  ProtectSystem=strict
  ReadWritePaths=/var/lib/vettid-agent-run/<n>
  ProtectHome=yes
  CapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_CHOWN CAP_FOWNER CAP_DAC_OVERRIDE CAP_KILL
  SyslogIdentifier=vettid-runhelper-<n>
  ```

  What each option gives:
  - **The capabilities** are the ones the helper uses: setting the uid
    and groups, owning and removing a run's files, and signalling a
    run's processes. A change to a non-zero uid clears them for the
    child.
  - **`NoNewPrivileges`** holds for the helper and everything it starts,
    the launcher's own `exec` and every program a run starts included.
    It doesn't stop the helper's own `setuid`, which is a capability,
    not a new privilege.
  - **`KeyringMode=private`** and **`LimitCORE=0`** keep a run's keys and
    core dumps from outliving it (§9).
  - **`PrivateTmp=yes`** gives every run of this pairing the helper's own
    `/tmp` and `/var/tmp`, not the system's, so a run can't leave a file
    where the member's processes look. The two slots share it (§9).
  - **`ProtectSystem=strict`** leaves runs only these writable places:
    the helper's `/tmp` and `/var/tmp`, `/dev/shm`, `/dev/mqueue`, and
    their own run folder. Everything else is read-only to them,
    `/var/crash`, `/run/lock` and the cron and `at` spools included.
  - **`ProtectHome=yes`** means a run can't read `/home` at all. That
    agrees with A5.6 until `share` exists ("until then runs use `work/`
    only").

  The `share` card will need to lift `ProtectHome`, and
  `ProtectSystem`'s read-only view, for exactly the shared folders: a
  unit-level change, reviewed with it (§12).
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
    neither is in an administrator's group (§11) or a group §2 keeps
    apart.

  Any failure stops it, and `status` says why. It never takes a uid,
  a path, a program path or an environment of its own from the
  connector. It never starts anything as root.
- **At its start** it first ends every process of both runners (§9,
  steps 1 and 2), and only then removes everything under the run root
  and runs the rest of the cleanup, so nothing still running can write
  again behind it. A crash then leaves nothing past the next start
  (AGENT-PLAN §4.9, the run's own directory). Only then does it take a
  connection.

## 7. The helper's protocol

Messages are frames over the helper's socket: a 4-byte big-endian
length (at most 1 MiB), then one JSON object with a `type`. Descriptors
travel with `SCM_RIGHTS` only on `start` (connector to helper) and
`outputs` (helper to connector).

| From | Message | Fields | Descriptors |
|---|---|---|---|
| connector | `start` | `v` (1), `slot` (1 or 2), `run` (32 hex digits), `argv` (`argv[0]` the resolved path), `env` (`NAME=value` strings), `cwd` (absent for `work/`, or a cleaned absolute path), `secret_file` (true for the `file` way), `inputs` (names, A3.10d) | the program's sealed memory file; standard input, output and error; with `secret_file` a sealed memory file holding the value; one sealed memory file per input |
| helper | `cwd` | `final` (the folder's path from the held descriptor), `writable` (bool) | — |
| connector | `go` or `refuse` | — | — |
| helper | `started` | — | — |
| helper | `exited` | `code` or `signal` | — |
| connector | `terminate` | — | — |
| helper | `outputs` | `files` (names), `dropped` (`{name, reason}`) | one read-only descriptor per file in `files` |
| connector | `collected` | — | — |
| helper | `ended` | `clean` (bool), `reason` when false | — |
| helper | `error` | `code` (a short, fixed code) | — |

- **Receiving descriptors.** With `MSG_CMSG_CLOEXEC`. A message whose
  control data was cut short (`MSG_CTRUNC`), or with more or fewer
  descriptors than its fields name, is refused. On any refusal or
  error every received descriptor is closed.
- **What the helper checks on `start`, before it makes anything:**
  - `slot` is 1 or 2, and that slot is free (its last run `ended` with
    `clean` true);
  - `run` matches `^[0-9a-f]{32}$`, and no folder of that name exists;
  - the program's descriptor is a memory file whose `F_GET_SEALS`
    succeeds with all four seals, at most 512 MiB, starting with the
    ELF magic (the `/memfd:` name in its link is chosen by the
    connector, so it proves nothing);
  - the secret's and each input's descriptor is a sealed memory file:
    the secret at most 64 KiB (chosen), the inputs within A3.10d's caps;
  - the standard streams are pipes, or `/dev/null` (character device
    1:3);
  - `cwd`, if present, is absolute with no empty, `.` or `..` element,
    and not under `/tmp`, `/var/tmp` or `/dev/shm` (chosen: those
    folders are the helper's own in a run's view, §6, not the member's,
    so a path there would name another folder than the one approved;
    it's `cwd_not_allowed`);
  - `argv`, `env` and the input names within the connector's own caps
    of AGENT-PLAN §4.9, as a backstop.

  It passes `argv` and `env` on unchanged and never reads them for
  meaning or adds to them. It never logs a frame, `argv`, `env`, `cwd`
  or a name, since `env` carries the secret for the `env` way (note
  §3).
- **What the helper makes**, all with `openat`, `mkdirat` and
  `unlinkat` relative to a descriptor of the run root it holds, each
  element opened with `O_NOFOLLOW`, each new file or folder with
  `O_EXCL` (chosen). Nothing is reached by a path a run could change.
  The run's folder is `<run root>/<slot>-<run>/` (chosen), owned by the
  slot's runner, 0700, holding:
  - `home/` (for `HOME`) and `tmp/` (for `TMPDIR`);
  - `work/`, the default `cwd`, with `work/in/` (owned by root, 0755)
    and its files written from the input descriptors (owned by root,
    0444), so the run can read them but not change, replace or remove
    them; and `work/out/` (owned by the runner, 0700);
  - `secret/` (0700), and with `secret_file`, `secret/value` (0600),
    written from the descriptor.

  The paths follow from `<n>`, the slot and `run`, so the connector
  builds `HOME`, `TMPDIR`, `VETTID_IN`, `VETTID_OUT`, the secret's
  variable and `{secret_file}` in `env` and `argv` itself, and sets
  `USER` and `LOGNAME` to the runner's name (chosen; AGENT-PLAN §4.9
  copies them from the connector's environment, which would name the
  connector). The helper adds nothing.
- **Order.**
  1. `start`.
  2. The launcher (§8) opens the folder, and the helper sends `cwd`.
  3. On `go` the program starts and the helper sends `started`. On
     `refuse` nothing runs and the run ends (from step 5).
  4. `exited` when the program's own process ends.
  5. Once every process of the run is gone (§9, steps 1 and 2), the
     helper opens each output the request named, relative to `work/out/`
     with `O_NOFOLLOW`. It keeps only regular files owned by the slot's
     runner with a link count of 1, within the caps, and sends their
     descriptors in `outputs` with the dropped ones and why (AGENT-PLAN
     §4.9, files in and out). With no `output`, `files` is empty.
  6. The connector reads and redacts them, then sends `collected`.
  7. The helper runs the rest of the cleanup, and sends `ended`.
- **`terminate`** (the connector's time limit, AGENT-PLAN §4.9): the
  helper freezes the run's cgroup, sends SIGTERM to every process in
  it, thaws it, and after 5 s writes `cgroup.kill`.
- **When the connection closes** (the service stopped or crashed), the
  helper kills every run of that connection (`cgroup.kill`) and cleans
  up, dropping any outputs. So a run ends with the service, as note §5
  ("Runs outlive a crash on macOS") says of a systemd unit.

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
  socket pair to the helper (4). `NoNewPrivileges` already holds,
  inherited from the helper's unit (§6).
- **The launcher, in order** (on one OS thread: `runtime.LockOSThread`
  first, since Linux keeps `no_new_privs` per thread):
  1. `prctl(PR_SET_NO_NEW_PRIVS)`, a second time on this thread, after
     the unit's.
  2. Receives `cwd` (or `work/`'s path) and `env` from the helper.
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
  starts the launcher, in a fresh cgroup of its own (chosen).
- **Slot cleanup** comes before `ended`, and the slot is used again only
  when every step succeeds (Q6 a):
  1. The run's cgroup is empty and removed.
  2. **No process of the runner is left anywhere.** The sweeper calls
     `kill(-1, SIGKILL)`, which reaches every process of its uid but
     itself in one walk of the kernel's, so no process can fork past it.
     It repeats until a scan finds none: the helper reads the `Uid:`
     line of every `/proc/<pid>/status` for the runner as real,
     effective, saved or file-system uid. Any targeted kill uses a
     pidfd, never a bare pid.
  3. **What the run's uid owns in the kernel goes.** The sweeper:
     - removes the SysV shared memory, semaphores and message queues it
       owns (`IPC_RMID`) and the POSIX message queues it owns in
       `/dev/mqueue`;
     - clears its user and user-session keyrings (`@u`, `@us`) and
       invalidates its persistent keyring. A key a run cached there
       (a Kerberos `KEYRING` cache, say) would otherwise be there for
       the next run of the slot, another item's run steered by the
       agent.

     Then the sweeper exits, and step 2's scan runs again.
  4. **Files.** The run's folder is removed, `secret/value` overwritten
     first. Every file the runner owns in the helper's `/tmp` and
     `/var/tmp` (§6) and in `/dev/shm` is removed, by a walk that opens
     each element with `O_NOFOLLOW` and never follows a link. These
     are the only places outside its folder a run can write (§6).
  5. **Jobs:** a check only. A run can't make a cron or `at` job: the
     spools are read-only to it, `crontab` and `at` are setgid or
     setuid programs that `no_new_privs` keeps from gaining their
     group, and `cron.deny` and `at.deny` list the runner as well
     (`install`; a `cron.allow` that exists overrides them). It can't
     make a systemd user timer either, since a runner never has a user
     manager: no login, and no linger.

     The helper confirms there is no crontab, no `at` job, no linger file
     and no active `user@<uid>.service` for the runner. If any is found,
     the slot stays out of use and `status` says what was found
     (chosen: the helper doesn't write the spools).

  A step that fails, or a process still there after the second scan,
  keeps the slot **out of use**. `ended` says `clean: false` with the
  step, the connector's `status` says so (the tool's text is in
  AGENT-PLAN §11), and the helper tries the cleanup again at its next
  start and at the service's next connection (chosen).
- **Said plainly.**
  - The two slots share the helper's `/tmp` and `/var/tmp`, so a
    concurrent run of the other slot can read a world-readable file one
    run leaves there before it ends. A run's own `TMPDIR` and `HOME`
    are in its own 0700 folder, which the other can't read.
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

## 11. Open: `member_is_admin` on Linux

On Windows the service gives no tools to a member whose token holds
Administrators (`member_is_admin`, owner decision a, GC #15862): the
connector's own account protects its keys only from a standard account.
Linux has no token group to read, and nothing says what an
administrator is there.

- **Proposed (a):** the member is an administrator if any of these
  holds:
  - **sudo's usual groups:** it is in `sudo`, `wheel` or `admin`;
  - **groups that give root in all but name:** `docker`, `lxd`,
    `incus-admin`, `libvirt` (a container or VM manager can mount the
    host's disk) or `disk` (raw access to it);
  - **sudo rules:** `install`'s `sudo -l -U <member>`, run as root, shows
    any rule for it. The result is recorded in the configuration.
  - **polkit:** `install` finds the member, or one of its groups, among
    polkit's administrator identities.

  `install --upgrade` repeats the `install` checks. At each connection
  the service checks the groups again, from the group database (which
  every user can read) and from the groups the client holds
  (`SO_PEERGROUPS`). The service can't read `sudoers`. A member who is
  an administrator gets `member_is_admin` for every tool, as on Windows.

  The channel's code (A5.6 PR 1) does this already, failing closed,
  until the owner decides.
- **The cost, said plainly:** most desktop Linux users are in `sudo`
  (the first user made on Ubuntu and Fedora is). They'd need a separate
  standard account for the agent's work.
- **(b):** don't treat it as an administrator on Linux, and say in
  `status` that the protection then rests on `sudo` asking for a
  password (AGENT-SEPARATE-ACCOUNT §5 already says that NOPASSWD gives
  no protection).
- **Under either:** `install` refuses a member who is uid 0, and the
  service refuses a configuration that names one (otherwise root would
  be the member and get tools).

The owner decides. Recommendation: (a), the same rule as Windows.

## 12. What this note chooses

Each is "(chosen; not in the spec)" until the review and the owner's go:

1. Linux 5.14, cgroup v2 and systemd 251 as the minimum, checked by
   version (§1).
2. The member group `vettid-m-<h>`; the configuration's path, owner
   and mode; the lock; the run root `/var/lib/vettid-agent-run/<n>/`;
   the helper's socket and unit names; the accounts kept apart (§2).
3. `cron.deny` and `at.deny` for the pairing's accounts, as a backstop
   (§2, §9).
4. The service's hardening options; the failed-start recovery through
   `reset-failed` (§4).
5. For the key (§5):
   - the protector name `systemd-cred`, with no `wrapped_key`;
   - `host+tpm2` rather than `tpm2` alone, and no PCRs;
   - the placeholder credential at `install` and `forget`, replaced by
     `.new` and a rename;
   - the elevated commands working without the service, under a lock;
   - the order of `pair`'s and `forget`'s steps;
   - the text for a key that can't be unsealed (NEW text).
6. For the helper (§6):
   - one helper per pairing;
   - the rule that its unit's options are chosen for runs;
   - its capability set and its sandbox options;
   - the `share` card's unit change for shared folders;
   - one connection at a time;
   - its start order (kill, then clean).
7. For the protocol (§7):
   - the frames and messages;
   - the checks on `start`, including the refusal of a `cwd` under
     `/tmp`, `/var/tmp` or `/dev/shm`;
   - the 64 KiB cap on a secret file;
   - the run folder's name and layout, and `in/` owned by root;
   - all file work relative to a held descriptor;
   - `USER` and `LOGNAME` set to the runner's;
   - outputs handed over as descriptors before cleanup.
8. The launcher's thread lock and second `no_new_privs`, its `O_PATH`
   walk with the `X_OK` check, `faccessat2` without fallback, and the
   descriptor numbers (§8).
9. The 10 s wait for an empty cgroup; the sweeper; the jobs check
   without writes; the retry of a slot out of use (§9).
10. No configuration read by the stub on Linux; the "log in again" step
    after `install` (§10).
11. `member_is_admin`'s meaning (§11), open for the owner.

## 13. The tests (A5.6's list, on Linux)

The code PRs carry these. They run in a Linux VM and on the ubuntu CI
runner under `sudo`, with throwaway users and units removed in cleanup.

- **The channel** (built, A5.6 PR 1):
  - another user is refused;
  - root gets `status`, `pair` and `forget` but no tool;
  - the member's normal process can't `pair` or `forget`;
  - a member in an administrator's group gets `member_is_admin`;
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
  - a run can open a TCP connection;
  - a run can write only in its folder, the helper's `/tmp` and
    `/var/tmp`, `/dev/shm` and `/dev/mqueue`.
- **A run's end:**
  - a daemon forked by one run (`setsid nohup`) is gone before the next
    run starts;
  - so are a file it leaves in `/tmp`, `/var/tmp` or `/dev/shm`, a SysV
    segment, a POSIX message queue, and a key in its user keyring;
  - an attempt to make a cron job, an `at` job or a systemd user timer
    fails;
  - a cleanup that can't be confirmed keeps the slot out of use, with
    `status` saying so.
- **`cwd`:** a link in the path is refused; a last folder the runner
  can't search is refused before the go; the final path is the
  descriptor's; a writable folder is reported as writable.
- **Files out:** a link, a file of another owner or with two links, and
  a name not asked for are dropped with their reasons, and the rest
  arrive as descriptors before the run's folder is removed.
- **The key:**
  - `install` without a TPM stops unless `--no-tpm`;
  - with `--no-tpm`, the host-key notice appears in `install` and
    `status`;
  - `--no-tpm` with a TPM is refused;
  - `pair` makes a new key, and `pair --restart` another;
  - `forget` leaves only a placeholder, also when it is stopped
    between its steps;
  - a state file sealed under one pairing's key doesn't open under
    another's;
  - after the TPM is cleared, `status` says the key can't be unsealed,
    and `pair --restart` pairs again without any `systemctl` command
    by hand.

  With a TPM, these run against a software TPM (swtpm) in the VM.
- **The accounts:**
  - the member's account can't read the state, the run root or a run's
    secret;
  - a connector or runner account made the member's, or an
    administrator's, or put in a group §2 keeps apart, refuses runs
    and proxies;
  - `install` and uninstall leave nothing behind. Uninstall removes the
    users, the groups, the `.deny` entries, the run root,
    `/etc/vettid-agent/<n>/`, the credential and the four units.
  - `install --upgrade` keeps the state, regenerates the units and
    restarts the helper (ending its runs).
