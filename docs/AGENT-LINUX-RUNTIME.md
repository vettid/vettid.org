---
title: AGENT-LINUX-RUNTIME
status: draft design note for review (blind pair, then the owner's merge go) before any code for the run helper or the key sealing; nothing here is built
version: 0.1.0
date: 2026-11-21
owner: Al Liebl (Mesmer)
component: vettid-agent (the agent connector): the separate-account mode on Linux (AGENT-PLAN A5.6)
related:
  - AGENT-SEPARATE-ACCOUNT.md (0.1.2) §2, §3, §4, §5, §6, §8
  - AGENT-PLAN.md (0.1.17) AG3, AG14, §4.2, §4.7, §4.9, A3.10a, A5.6, §11
changelog:
  - 0.1.0: 2026-11-21, first draft (card #15760, the lead's call a on
    GC #15918). How A5.6 is built on Linux: names, files and units; the
    channel's Unix-socket end; the connector service; the data key as a
    systemd credential sealed to the TPM 2.0 (and `--no-tpm`); the run
    helper, its protocol and the launcher; a run's cgroup and slot
    cleanup; a proposed meaning of `member_is_admin` on Linux (open,
    §11). Every "(chosen; not in the spec)" item is listed in §12
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

**Minimum platform (chosen).** Linux 5.14 or later (`cgroup.kill`;
`clone3` with `CLONE_INTO_CGROUP` from 5.7; `faccessat2` from 5.8),
cgroup v2 only (the unified hierarchy), and systemd 250 or later
(encrypted credentials). `install` checks each and stops with a plain
message naming what is missing. Ubuntu 22.04 and later, Debian 12 and
later, Fedora 36 and later and RHEL 9 meet it.

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
| State | `/var/lib/vettid-agent/<n>/` | `vettid-c-<h>`, 0700, in `/var/lib/vettid-agent/` (root, 0755) |
| Run root (chosen) | `/var/lib/vettid-agent-run/<n>/` | root, 0711, in `/var/lib/vettid-agent-run/` (root, 0711) |
| The channel | `/run/vettid-agent/<n>.sock` | `vettid-c-<h>`:`vettid-m-<h>`, 0660, in `/run/vettid-agent/` (root, 0755) |
| The helper's socket (chosen) | `/run/vettid-runhelper/<n>.sock` | root:`vettid-c-<h>`, 0660, in `/run/vettid-runhelper/` (root, 0755) |
| Units | `vettid-agent-<n>.socket`, `vettid-agent-<n>.service`, `vettid-runhelper-<n>.socket`, `vettid-runhelper-<n>.service` | in `/etc/systemd/system/` |

- The run root is outside `/var/lib/vettid-agent/`, so a pairing named
  `run` can't meet it, and the helper's units have their own prefix,
  so no pairing's name can make one of them (`vettid-agent-x-run` is
  pairing `x-run`'s; chosen).
- The configuration holds the member's uid, the four account uids, the
  `--run-path` folders, the `--run-env` values and whether `--no-tpm`
  was given. It is readable by the connector's account and not by the
  member (a `--run-env` value may be private). The stub needs nothing
  from it: the socket's path comes from `<n>` and the connector's
  account from `<h>` (§3).
- The runners and the connector's account are listed in
  `/etc/cron.deny` and `/etc/at.deny`, so they can't make cron or `at`
  jobs at all (chosen; §9 still checks).

## 3. The channel's Unix-socket end

It follows A3.10a as merged (vettid-agent 311d86b): the same hellos,
`Op`s, refusal codes and `Admit` rules, with the peer's uid in place of
the Windows token.

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
- **The service** takes the socket from systemd (`LISTEN_FDS` and
  `LISTEN_PID` naming its own pid, exactly one descriptor, fd 3). It
  checks that fd 3 is a listening `AF_UNIX` stream socket bound to
  `/run/vettid-agent/<n>.sock`, and stops otherwise. It never makes or
  binds a socket itself.
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
     owned by `vettid-c-<h>`, the uid looked up from the system's user
     database by the name `<h>` gives.
  2. `lstat` `/run/vettid-agent/`. It must be a folder owned by root
     with no group or other write. A folder only root can change means
     nobody else can swap the socket between this check and the
     connection.
  3. Connect, then read the server's uid with `SO_PEERCRED`. With
     socket activation it is the uid that called `listen`, systemd's
     (0), so the client accepts 0 or `vettid-c-<h>`, and refuses any
     other.

  A failure in 1 or 2 is "No service" for the stub (A3.10a's split),
  as is a missing socket. A failure in 3 is `ErrNotService`.
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
```

- **The hardening is chosen.** The service reads programs (to hash and
  copy them) but never writes outside its state folder. It reaches the
  relay and the helper's socket, and needs no capability. `ProtectHome`
  costs nothing, since a program under `/home` fails the
  administrator-only rule anyway (owner a, GC #15787).
  `MemoryDenyWriteExecute` doesn't affect `memfd_create`; the code PR
  confirms it with a test.
- **Restart and stop.** `Restart=on-failure`, at most 3 starts a minute
  (AGENT-SEPARATE-ACCOUNT §3). The idle stop of AGENT-PLAN §4.9 is the
  service exiting 0; the socket stays, and the next client starts it
  again.
- **Logs** go to the journal through standard error under
  `vettid-agent-<n>`. They hold only the pairing's name, the tool, the
  outcome code and a resolved program path (A5.6).
- **The accounts check** (A5.6, note §8). At each start the service
  reads the configuration and refuses runs and proxies, with `status`
  saying why, if:
  - its own uid, or a runner's, is the member's, is 0, or is in an
    administrator's group (§11);
  - the runners' uids aren't two distinct uids other than its own.

## 5. The data key: a systemd credential (TPM 2.0, or `--no-tpm`)

This is the key-handling change of AGENT-PLAN §4.2 ("In the
separate-account mode", Linux), reviewed here before code.

- **What is sealed.** The state file's data key itself: 32 random bytes,
  sealed as the systemd credential `vettid-<n>-data-key`. The state
  file keeps its format (`internal/state`). Its header names the
  protector `systemd-cred` (chosen) and carries no `wrapped_key`. The
  service refuses a state file whose protector is anything else.
- **How it is sealed.** By root, with `systemd-creds`:
  - with a TPM 2.0: `systemd-creds encrypt --name=vettid-<n>-data-key
    --with-key=host+tpm2 --tpm2-pcrs= - <path>` (the key on standard
    input, never in an argument or a file);
  - with `--no-tpm`: the same with `--with-key=host`.

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
- **When it is sealed.**
  - **`install`** seals a placeholder: a fresh random key that no state
    uses (chosen). `LoadCredentialEncrypted=` fails the unit when the
    file is missing, so without a placeholder the service couldn't
    start, and `status` and `pair` would have no service to talk to.
  - **The elevated `pair`** makes the real one. A new key at each
    pairing, as today:
    1. It asks the service over the channel whether a pairing exists.
       Without `--restart`, an existing pairing is refused before any
       key is touched.
    2. With `--restart`, it asks the service to wipe the old state
       (overwrite and delete, as `forget` does) and waits for the
       answer.
    3. It checks the TPM (below), generates the key (`getrandom`), seals
       it to `data-key.cred.new`, `fsync`s it, renames it over
       `data-key.cred`, `fsync`s the folder, and zeroes the key in its
       memory.
    4. It restarts the service (`systemctl restart`), which loads the
       new key, connects again and sends the pairing code (A3.10a's
       console exchange).

    A run in flight ends with the restart. Discarding a pairing, or
    making the first one, may end it.
  - Any later rotation goes through the same elevated steps
    (AGENT-PLAN §4.2).
- **How the service reads it.** From `$CREDENTIALS_DIRECTORY/vettid-<n>-data-key`
  only. systemd decrypts it at each start into a folder only the
  service's account can read, outside the state folder. It must be
  exactly 32 bytes. The service never reads the `.cred` file, and
  takes no key or key path from anywhere else.
- **The TPM check.** `install` runs `systemd-creds has-tpm2`:
  - exit 0 is a usable TPM 2.0;
  - anything else is none.
  - Without one, `install` stops with a plain message unless `--no-tpm`
    is given. With one, `--no-tpm` is refused (the lead's call, §11).
  - The choice is recorded in the configuration. `pair` checks again,
    and a pairing installed with a TPM whose TPM is gone is refused
    rather than sealed to the host key.
  - `install` says, and `status` shows, when the key is sealed to the
    host key only: readable by root and not bound to hardware.
- **When it can't be unsealed** (the TPM was cleared or replaced, or the
  host key was removed), the unit fails at start. The stub then finds
  no service. `status` run as root reads `systemctl is-failed` and the
  unit's last result, and says the key can't be unsealed on this
  computer and that `pair --restart` makes a new one (chosen; the text
  is NEW, §12).
- **Wipe.**
  - **`forget`** (elevated):
    1. asks the service to wipe the state;
    2. stops the service;
    3. overwrites and deletes `data-key.cred`;
    4. seals a new placeholder, so `status` and `pair` keep working.
  - **On `device.unlinked`** the service deletes the state file it owns
    and marks the pairing gone. The credential stays until an elevated
    `forget`, and `status` says so (AGENT-PLAN §4.2, "Wipe in the
    separate-account mode").
- **Said plainly.**
  - Root on the computer can unseal the key: it can run `systemd-creds
    decrypt`, or start the unit. The TPM binds the key to this computer
    against a copied disk, not against its own administrator.
  - With `--no-tpm`, a copy of the disk that includes
    `/var/lib/systemd/credential.secret` opens the state.
  - As with the same-account TPM protector, an old copy of the state
    file and of `data-key.cred`, recovered from a backup or the raw
    disk, opens on the same computer until the TPM is cleared
    (AGENT-PLAN §4.2, accepted for v1).

## 6. The run helper

The one root component (AGENT-SEPARATE-ACCOUNT §3, "Starting a run as
the runner"). The connector can't start a process as another uid, so
the helper does that and nothing else.

- **One per pairing** (chosen): `vettid-runhelper-<n>.socket` and
  `.service`. It reads only its own pairing's runner uids, so a flaw
  in one pairing's helper connection can't reach another pairing's
  runners.

  ```ini
  # vettid-runhelper-<n>.socket
  [Socket]
  ListenStream=/run/vettid-runhelper/<n>.sock
  SocketUser=root
  SocketGroup=vettid-c-<h>
  SocketMode=0660
  DirectoryMode=0755
  Accept=no

  # vettid-runhelper-<n>.service
  [Service]
  Type=simple
  ExecStart=/usr/local/libexec/vettid-agent/vettid-agent runhelper --name <n>
  Delegate=yes
  KillMode=control-group
  PrivateTmp=yes
  ProtectSystem=strict
  ReadWritePaths=/var/lib/vettid-agent-run/<n> /dev/shm
  ProtectHome=yes
  CapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_CHOWN CAP_FOWNER CAP_DAC_OVERRIDE CAP_KILL
  RestrictAddressFamilies=AF_UNIX
  SyslogIdentifier=vettid-runhelper-<n>
  ```

  - **Capabilities.** The helper keeps only the ones it uses: setting
    the uid and groups, owning and removing a run's files, and
    signalling a run's processes.
  - **`PrivateTmp=yes`** gives every run of this pairing the helper's
    own `/tmp` and `/var/tmp`, not the system's. So a run can't leave a
    file where the member's processes look. The two slots share it, so
    §9 still removes each runner's files.
  - Runs inherit the helper's mount view and its `ProtectHome=yes`:
    a run can't read `/home` at all. That's the same outcome as
    today's rule, since `share` isn't built (A5.6: "until then runs use
    `work/` only"). The `share` card lifts `ProtectHome` for the shared
    folders (§12).
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
    neither is in an administrator's group (§11).

  Any failure stops it, and `status` says why. It never takes a uid,
  a path, a program path or an environment of its own from the
  connector. It never starts anything as root.
- **At its start** it removes everything under the run root, so a crash
  leaves nothing past the next start (AGENT-PLAN §4.9, the run's own
  directory). It also runs the cleanup of §9 for both slots before
  taking a connection.

## 7. The helper's protocol

Messages are frames over the helper's socket: a 4-byte big-endian
length (at most 1 MiB), then one JSON object with a `type`. Descriptors
travel with `SCM_RIGHTS` only on `start`.

| From | Message | Fields | Descriptors |
|---|---|---|---|
| connector | `start` | `v` (1), `slot` (1 or 2), `run` (32 hex digits), `argv` (the program's arguments, `argv[0]` the resolved path), `env` (`NAME=value` strings), `cwd` (absent for `work/`, or a cleaned absolute path), `secret_file` (true for the `file` way) | the program's sealed memory file, standard input, standard output, standard error, and with `secret_file` a sealed memory file holding the value |
| helper | `cwd` | `final` (the folder's path from the held descriptor), `writable` (bool) | — |
| connector | `go` or `refuse` | — | — |
| helper | `started` | — | — |
| helper | `exited` | `code` or `signal` | — |
| connector | `terminate` | — | — |
| helper | `ended` | `clean` (bool), `reason` when false | — |
| helper | `error` | `code` (a short, fixed code) | — |

- **What the helper checks on `start`:**
  - the slot is free (its last run `ended` with `clean` true);
  - exactly the descriptors listed;
  - the program's descriptor is a memory file (`/memfd:` in its
    `/proc/self/fd` link) carrying all four seals (`F_GET_SEALS`), at
    most 512 MiB, starting with the ELF magic;
  - the secret's descriptor is a sealed memory file of at most 64 KiB
    (chosen);
  - `argv`, `env` and `cwd` within the connector's own caps of
    AGENT-PLAN §4.9, as a backstop.

  It passes `argv` and `env` on unchanged and never reads them for
  meaning, logs them or adds to them (note §3).
- **What the helper makes.** The run's folder is
  `/var/lib/vettid-agent-run/<n>/<slot>-<run>/` (chosen), owned by the
  slot's runner, 0700, holding:
  - `home/` (for `HOME`);
  - `tmp/` (for `TMPDIR`);
  - `work/` (the default `cwd`; `in/` and `out/` come with A3.10d);
  - `secret/` (0700);
  - and, with `secret_file`, `secret/value` (0600), written from the
    descriptor.

  The paths follow from `<n>`, the slot and `run`, so the connector
  builds `HOME`, `TMPDIR`, the secret's variable and `{secret_file}`
  in `env` and `argv` itself. The helper adds nothing.
- **Order.** `start`, then the launcher (§8) opens the folder and the
  helper sends `cwd`. On `go` the program starts and the helper sends
  `started`; on `refuse` nothing runs and the run ends. Then `exited`
  when the program's own process ends, and `ended` when everything the
  run started is gone and its slot is clean (§9).
- **`terminate`** (the connector's time limit, AGENT-PLAN §4.9): the
  helper freezes the run's cgroup, sends SIGTERM to every process in
  it, thaws it, and after 5 s writes `cgroup.kill`.
- **When the connection closes** (the service stopped or crashed), the
  helper kills every run of that connection (`cgroup.kill`) and cleans
  up. So a run ends with the service, as note §5 ("Runs outlive a
  crash on macOS") says of a systemd unit.

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
  socket pair to the helper (4).
- **The launcher, in order:**
  1. `prctl(PR_SET_NO_NEW_PRIVS)`, before anything else.
  2. Receives `cwd` (or `work/`'s path) and `env` from the helper.
  3. Opens the folder **as the runner**, one element at a time from
     `/`: `openat(…, O_PATH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC)`. A link
     anywhere in the path, or a folder the runner can't search, fails
     the open (0.1.17: "`O_DIRECTORY|O_NOFOLLOW` at each element").
  4. Reads the **final path from the descriptor** (`readlink` of
     `/proc/self/fd/<fd>`, not `realpath` on the name), and whether the
     runner may write there (`faccessat2(fd, "", W_OK,
     AT_EMPTY_PATH|AT_EACCESS)`, the "read only" check of 0.1.17). It
     reports both to the helper, which sends `cwd`.
  5. On the service's `go` only: `fchdir` on the held descriptor, then
     closes it and the helper's socket. It marks every descriptor above
     2 close-on-exec (`close_range(3, ~0U, CLOSE_RANGE_CLOEXEC)`), the
     memory file included, and calls `execve("/proc/self/fd/3", argv,
     env)`.

     For an ELF file the kernel opens the image before it closes the
     close-on-exec descriptors, so this works. A script couldn't, and
     scripts are refused anyway (AGENT-PLAN §4.9).
  6. On `refuse`, or any failure, it exits non-zero without starting
     anything.
- **What the program inherits:**
  - only descriptors 0, 1 and 2, the run's standard streams; the code
    PR tests this (A5.6);
  - only the connector's environment;
  - its own session, no terminal, no new privileges, and none of the
    helper's capabilities (a `Credential` change to a non-zero uid
    clears them).
- **Said plainly.** A member folder as `cwd` fails at step 3 until the
  `share` card exists: the runner can't search `/home` (§6), so it is
  `cwd_not_allowed`, as AGENT-PLAN §4.9 says for a folder not shared.

## 9. A run's cgroup, its end, and slot cleanup

- **The cgroups.** The helper's unit has `Delegate=yes`, so the helper
  owns its subtree (cgroup v2).
  - At start the helper moves itself into a leaf, `<unit>/supervisor`
    (the "no internal processes" rule).
  - It makes `<unit>/run-<slot>` fresh for each run and opens it for
    `UseCgroupFD`.
  - A runner can't move a process out: it can't write any
    `cgroup.procs` (AGENT-SEPARATE-ACCOUNT §2, "each run is its own
    cgroup").
- **The end of a run.** When the program's own process exits, the
  helper sends `exited`, then writes `cgroup.kill`, which ends every
  process left in the run's cgroup, a `setsid nohup` daemon included.
  It waits for `populated 0` in `cgroup.events` (at most 10 s; chosen),
  then removes the cgroup.
- **Slot cleanup** comes before `ended`, and the slot is used again only
  when every step succeeds (Q6 a):
  1. The run's cgroup is empty and removed.
  2. No process anywhere has the runner's uid as its real, effective,
     saved or file-system uid. The helper reads the `Uid:` line of every
     `/proc/<pid>/status`. A process found there (one that reached
     another cgroup through a service the runner asked for) gets
     SIGKILL, and the scan runs again.
  3. The run's folder is removed, `secret/value` overwritten first.
  4. Every file the runner owns in the helper's `/tmp` and `/var/tmp`
     (§6) and in `/dev/shm` is removed. The walk opens each element
     with `O_NOFOLLOW` and never follows a link.
  5. Jobs:
     - a crontab (`/var/spool/cron/crontabs/<runner>`, or the
       distribution's path) and `at` jobs owned by the runner are
       removed, though `cron.deny` and `at.deny` (§2) should make them
       impossible;
     - systemd user timers would need the runner's user manager. The
       helper checks that `user@<uid>.service` isn't active and that
       the runner has no linger file, and stops the manager if it is.
  6. SysV shared memory, semaphores and message queues owned by the
     runner, and POSIX message queues it owns in `/dev/mqueue`, are
     removed (chosen).

  A step that fails, or a process that is still there after the second
  scan, keeps the slot **out of use**. `ended` says `clean: false` with
  the step, the connector's `status` says so (the tool's text is in
  AGENT-PLAN §11), and the helper tries the cleanup again at its next
  start and at the service's next connection (chosen).
- **Said plainly.**
  - Only those places are swept. A runner can also write in any other
    world-writable folder on the computer (for example `/var/crash` on
    some systems), and a file left there survives the run.
  - A run has the network, as a run does today.
  - A run can read anything on the computer that is readable by every
    user.

## 10. The stub on Linux

`vettid-agent mcp --name <n>` and the elevated commands use §3's checks
and nothing else. The stub reads no configuration on Linux, so A3.10a's
`config_refused` doesn't arise there (chosen). The elevated commands
run as `/usr/bin/sudo /usr/local/libexec/vettid-agent/vettid-agent
<command>`, both by absolute path (AGENT-SEPARATE-ACCOUNT §5). Run that
way they connect as uid 0, which the service admits for `pair`,
`forget` and `status` only.

## 11. Open: `member_is_admin` on Linux

On Windows the service gives no tools to a member whose token holds
Administrators (`member_is_admin`, owner decision a, GC #15862): the
connector's own account protects its keys only from a standard account.
Linux has no token group to read, and nothing says what an
administrator is there.

- **Proposed (a):** the member is an administrator if:
  - its uid is 0;
  - it is in the group `sudo`, `wheel` or `admin`;
  - or `install`'s `sudo -l -U <member>` (run as root) shows any rule
    for it. That result is recorded in the configuration.

  The service checks the groups again at each connection (the group
  database is readable by every user). It can't read `sudoers`, so the
  rule check is `install`'s; `install --upgrade` repeats it. A member
  who is an administrator gets `member_is_admin` for every tool, as on
  Windows.
- **The cost, said plainly:** most desktop Linux users are in `sudo`
  (the first user made on Ubuntu and Fedora is). They'd need a separate
  standard account for the agent's work.
- **(b):** don't treat it as an administrator on Linux, and say in
  `status` that the protection then rests on `sudo` asking for a
  password (AGENT-SEPARATE-ACCOUNT §5 already says that NOPASSWD gives
  no protection).

The owner decides. Recommendation: (a), the same rule as Windows.

## 12. What this note chooses

Each is "(chosen; not in the spec)" until the review and the owner's go:

1. Linux 5.14, cgroup v2 and systemd 250 as the minimum (§1).
2. The member group `vettid-m-<h>`; the configuration's path, owner
   and mode; the run root `/var/lib/vettid-agent-run/<n>/`; the helper's
   socket and unit names (§2).
3. `cron.deny` and `at.deny` for the pairing's accounts (§2).
4. The service's hardening options (§4).
5. The protector name `systemd-cred`; `host+tpm2` rather than `tpm2`
   alone; no PCRs; the placeholder credential at `install` and
   `forget`; the order of `pair`'s steps; the text for a key that can't
   be unsealed (NEW text, §5).
6. One helper per pairing; its capability set; its `PrivateTmp` and
   `ProtectHome` (lifted per folder by the `share` card); one
   connection at a time (§6).
7. The protocol's frames and messages; the 64 KiB cap on a secret
   file; the run folder's name and layout (§7).
8. The launcher's `O_PATH` walk, `faccessat2` and the descriptor
   numbers (§8).
9. The 10 s wait for an empty cgroup; the IPC and message-queue sweep;
   the retry of a slot out of use (§9).
10. No configuration read by the stub on Linux (§10).
11. `member_is_admin`'s meaning (§11), open for the owner.

## 13. The tests (A5.6's list, on Linux)

The code PRs carry these. They run in a Linux VM and on the ubuntu CI
runner under `sudo`, with throwaway users and units removed in cleanup:

- the channel: another user is refused; root gets `status` but no tool;
  the member's normal process can't `pair`; the stub refuses a link,
  a socket of another owner, and a parent another user can change;
- the helper: it starts a program only as a runner uid and never as
  root; it refuses a caller that isn't the connector, a second
  connection, an unsealed or non-ELF program and a descriptor more
  than listed; a run inherits only its standard streams;
- a run's end: a daemon forked by one run (`setsid nohup`) is gone
  before the next run starts. So are a file it leaves in `/tmp`,
  `/var/tmp` or `/dev/shm`, a cron job, an `at` job, a systemd user
  timer and a SysV segment. A cleanup that can't be confirmed keeps the
  slot out of use, with `status` saying so;
- `cwd`: a link in the path is refused; the final path is the
  descriptor's; a writable folder is reported as writable;
- the key:
  - `install` without a TPM stops unless `--no-tpm`;
  - with it, the host-key notice appears in `install` and `status`;
  - `--no-tpm` with a TPM is refused;
  - `pair` makes a new key and `pair --restart` another;
  - `forget` leaves no credential but the placeholder;
  - a state file sealed under one pairing's key doesn't open under
    another's;
  - a TPM that was cleared gives `status`'s "can't be unsealed".

  With a TPM, these run against a software TPM (swtpm) in the VM.
- the accounts: the member's account can't read the state, the run
  root or a run's secret; a connector or runner account made the
  member's, or an administrator's, refuses runs and proxies; `install`
  and uninstall leave nothing behind.
