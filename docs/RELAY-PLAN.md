# VettID Relay — Implementation Plan

**Goal:** Replace NATS/JetStream with a small, vendor-neutral mailbox relay (`vettid-relay`).
Direct cutover — no parallel run, no migration shims. The relay is dumb transport for
opaque ciphertext; all trust remains end-to-end between vaults, apps, and agents.

**Non-goals (explicitly out of scope for v1):** clustering, replication, relay-to-relay
federation, message search/history APIs, push notification delivery (FCM/APNs hook is a
v1.1 candidate), payloads > 256 KB (claim-check convention instead).

---

## Phase 1 — Protocol Specification (`docs/RELAY-PROTOCOL.md`)

The durable asset. Everything else is an implementation of this document.

### 1.1 Identities & keys

- Every mailbox owner (vault or app) holds a dedicated **ed25519 relay keypair**.
  - This is NOT the protean credential key and NOT the messaging E2E keys. It is a
    transport-layer identity only, rotatable without touching anything else.
  - Vault-side: generated inside the enclave at enrollment, stored in the vault's
    SQLite datastore (sealed with the rest of vault state).
  - App-side: generated on device, stored in platform keystore (Android Keystore /
    iOS Secure Enclave / desktop OS keychain).
- **Mailbox ID** = base32(SHA-256(pubkey))[0:26] or similar — derived from the key,
  so registration is self-authenticating (no allocation authority needed).

### 1.2 Mailbox registration

```
POST /v1/register
Body: { pubkey, proof }        # proof = signature over (relay_url || timestamp)
→ 201 { mailbox_id, relay_limits }
```

- Open registration with proof-of-possession for v1 (matches non-custodial posture —
  no account approval gate). Abuse control is rate limiting + storage quotas, not
  identity gating.
- Decision point: if open registration proves abusable, v1.1 adds an optional
  invite-token mode (relay operator policy, not protocol change).

### 1.3 Deposit tokens (the NKeys/JWT model, preserved)

The mailbox owner is the sole issuer of permission to deposit into its mailbox.

- **Format recommendation: PASETO v4.public** (ed25519-signed, misuse-resistant,
  good Go support via `aidantwoods/go-paseto`).
  - Alternative considered: JWT/EdDSA — acceptable, maximally interoperable, but
    JWT's algorithm-agility footguns argue against it for a greenfield protocol.
  - Alternative considered: custom NKeys-style compact token — smallest, but costs
    us interop and audit familiarity. Rejected for v1.
- **Claims:**

| Claim | Meaning |
|---|---|
| `iss` | issuing mailbox_id (the recipient) |
| `sub` | sender identity — sender's relay pubkey (binds token to sender) |
| `aud` | relay base URL (prevents cross-relay replay) |
| `exp` | expiry; recommend ≤ 30 days for connection tokens, ≤ 5 min for one-shots |
| `jti` | unique token id (revocation handle) |
| `scope` | `deposit` (v1 only scope; reserves room for future) |
| `quota` | optional: max deposits and max bytes per window |

- **Sender binding:** every deposit request is signed by the sender's relay key
  (detached signature over a canonical request digest in an `X-VettID-Sig` header).
  Relay verifies (a) token signature against issuer's registered pubkey,
  (b) request signature against `sub` pubkey. A leaked token alone is useless.
- **Revocation:** owner pushes `jti` (or `sub`) entries to its denylist:

```
POST /v1/mailbox/denylist        # authenticated as mailbox owner
Body: { revoke: [{jti | sub}], ttl }
```

  Denylist entries expire with the longest possible token lifetime — bounded memory.

### 1.4 Message endpoints

```
POST   /v1/mailbox/{mailbox_id}            # deposit (token + sender sig)
GET    /v1/mailbox?wait=25                 # collect: long-poll, owner-authenticated
GET    /v1/mailbox/ws                      # collect: WebSocket (same auth)
DELETE /v1/mailbox/{msg_id}                # ack (idempotent)
```

- **Payloads are opaque** — relay never parses, max 256 KB. Larger content uses
  claim-check: deposit a small pointer envelope; blob storage is out of relay scope.
- **Delivery semantics: at-least-once.** Messages have ULID ids (sortable = arrival
  order per mailbox). Collect returns up to N oldest unacked messages. Unacked
  messages reappear after a visibility timeout (default 60 s). Receivers dedupe by
  ULID — vault and app clients MUST treat redelivery as normal.
- **Owner authentication for collect/ack/denylist:** signed request (same detached
  ed25519 signature scheme), timestamp within ±90 s to bound replay; no session
  state on the relay.
- **TTL:** unclaimed messages deleted after `message_ttl` (default 14 days,
  per-relay config).

### 1.5 Errors, limits, versioning

- Structured error body: `{ code, message, retry_after? }`. Canonical codes:
  `token_invalid`, `token_revoked`, `mailbox_unknown`, `payload_too_large`,
  `quota_exceeded`, `rate_limited`, `signature_invalid`.
- Rate limits are per-token and per-source-IP; spec states limits are relay policy,
  protocol only defines the `429 + retry_after` contract.
- `/v1/` path versioning; spec carries a semver and a changelog section from day one.
- Spec includes test vectors: sample keypair, sample token, sample signed request
  (makes client implementations and security review mechanical).

**Deliverable:** `docs/RELAY-PROTOCOL.md` in the new repo.
**Commit checkpoint:** spec reviewed + committed before any code.

---

## Phase 2 — Repo & Scaffold (`vettid-relay`)

### 2.1 Repo layout

```
vettid-relay/
├── cmd/relay/main.go            # flag/env config, wiring, graceful shutdown
├── internal/
│   ├── api/                     # HTTP handlers, routing, middleware chain
│   ├── auth/                    # token verify, request signatures, denylist
│   ├── store/                   # SQLite access layer (interface + impl)
│   └── sweep/                   # TTL sweeper
├── docs/RELAY-PROTOCOL.md
├── Makefile                     # build, test, lint, scan targets
└── .github/workflows/ci.yml    # test + lint + gitleaks on every push
```

### 2.2 Stack decisions

- Go stdlib `net/http` (1.22+ mux is sufficient — no framework dependency).
- **SQLite driver: `modernc.org/sqlite`** (pure Go, no CGO) → trivial
  cross-compilation for future appliance targets (arm64). WAL mode on.
- `nhooyr.io/websocket` for the WS collect path; `oklog/ulid/v2` for message ids.
- Config: env vars with a single optional config file; NO secrets in config —
  the relay holds no long-term secrets beyond its TLS key (or runs behind a
  TLS-terminating proxy; both modes supported).

### 2.3 Schema (v1)

```sql
CREATE TABLE mailboxes (
  mailbox_id TEXT PRIMARY KEY,
  pubkey     BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  quota_bytes INTEGER, quota_msgs INTEGER
);
CREATE TABLE messages (
  msg_id     TEXT PRIMARY KEY,          -- ULID
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(mailbox_id),
  payload    BLOB NOT NULL,
  deposited_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  leased_until INTEGER,                 -- visibility timeout
  sender_sub  TEXT NOT NULL             -- for abuse attribution
);
CREATE INDEX idx_messages_collect ON messages(mailbox_id, msg_id);
CREATE INDEX idx_messages_expiry  ON messages(expires_at);
CREATE TABLE denylist (
  mailbox_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('jti','sub')),
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (mailbox_id, kind, value)
);
```

**Commit checkpoints (each preceded by `git diff` review + gitleaks scan):**
1. Repo init: module, layout, Makefile, CI with lint + gitleaks
2. Store layer + schema + store unit tests
3. HTTP server skeleton with health endpoint, graceful shutdown, structured logging
   (zero payload contents in logs — log msg ids and sizes only)

---

## Phase 3 — Auth Middleware

Order of the chain matters: cheap checks first.

1. **Body size limit** (256 KB + envelope headroom) — before reading anything else.
2. **Rate limit** (token bucket per source IP; second bucket per `jti`/`sub` after
   token parse). In-memory for v1; SQLite-backed counters only if needed.
3. **Request signature verification** — canonical digest = method ‖ path ‖
   timestamp ‖ SHA-256(body); verify against the relevant pubkey; reject if
   |now − timestamp| > 90 s. Short-window in-memory nonce cache to kill replays
   inside the window.
4. **Deposit-token verification** (deposit route only): PASETO signature against
   issuer mailbox's registered pubkey → `aud` match → `exp` → denylist lookup
   (jti, then sub) → quota counters.
5. **Owner verification** (collect/ack/denylist routes): request signature must
   verify against the mailbox's own registered pubkey.

Testing requirements before this phase closes:
- Unit tests with the spec's test vectors (must pass byte-for-byte)
- Negative tests: expired, wrong-aud, revoked-jti, revoked-sub, tampered body,
  stale timestamp, replayed nonce, oversized body, sig/key mismatch
- Fuzz test on token parsing and the canonical-digest builder

**Commit checkpoints:** (4) signature verification + tests, (5) token verification +
denylist + tests, (6) rate limiting + tests.

---

## Phase 4 — Handlers & Sweeper

1. **Deposit:** validate (middleware already did auth) → ULID → quota check →
   single INSERT → 201 `{ msg_id }`. Notify any active collector for that mailbox
   via in-process channel (instant wake for long-poll/WS).
2. **Collect (long-poll):** lease up to N oldest unleased, unexpired messages
   (`leased_until = now + visibility_timeout`) → return immediately if any; else
   park on the mailbox's wake channel up to `wait` seconds (cap 25 s) → re-check →
   return `[]` on timeout. Single-writer discipline via SQLite WAL +
  `BEGIN IMMEDIATE` for the lease transaction.
3. **Collect (WebSocket):** same lease mechanics, pushed as deposits arrive; acks
   arrive as WS frames mapping to the same DELETE path. WS is an optimization —
   long-poll is the mandatory baseline and the appliance fallback.
4. **Ack:** DELETE by msg_id, scoped to authenticated mailbox; idempotent (204
   whether or not the row existed).
5. **Sweeper goroutine:** every 60 s — delete expired messages, expire denylist
   rows, release stale leases. Jittered start; one batched transaction per pass.
6. **Operability:** `/healthz`; Prometheus `/metrics` (deposits, collects, acks,
   parked collectors, sweep counts, per-code error counts); SQLite online backup
   hook (`VACUUM INTO` on schedule) for relay state — losing it loses only
   undelivered ciphertext + registrations (re-registration is self-service by design).

**Integration test before closing:** two simulated principals (sender + owner)
exercising the full loop — register → mint token → deposit → long-poll collect →
ack → revoke → rejected deposit — against a relay instance in CI.

**Commit checkpoints:** (7) deposit + collect long-poll + ack, (8) WS path,
(9) sweeper + metrics + backup hook, (10) integration test + README.

---

## Phase 5 — Required Changes Elsewhere (notes only; not in this build)

### vettid-dev (infra + enclave vault-manager)

- **Remove:** NATS/JetStream cluster resources from CDK; NATS client, NKey seed
  handling, and JWT/account config from the vault-manager and parent-instance code.
- **Add — parent instance:** a relay client (long-poll or WS) replacing the NATS
  connection. Parent remains a byte forwarder: it transports relay frames over
  vsock; it does NOT hold the vault's relay key. Collect/ack requests are signed
  inside the enclave and proxied out, preserving the existing trust boundary.
- **Add — vault-manager (in-enclave):**
  - Relay keypair generation at enrollment; persisted in vault SQLite.
  - Token mint/revoke functions (PASETO issue, denylist push) — exposed as event
    handlers, consistent with handlers being baked into the enclave build.
  - Dedupe-by-ULID on inbound (at-least-once semantics).
- **Enrollment flow change:** the "vault running via NATS" step becomes "vault
  registers its relay mailbox and opens collect." Sequence stays
  PIN+DEK → vault up (now: mailbox registered) → password setup; still never
  through Lambda. The mailbox_id becomes part of what the user's app learns
  about its vault during enrollment.
- **Connections feature hook:** approving a connection now mints a deposit token
  for the counterparty (and stores its mailbox address); revoking a connection
  pushes the denylist entry. This is the natural home of "who may message me."
- **CDK:** add a small relay deployment (single instance or Fargate task + EBS/EFS
  for the SQLite file) so the first relay runs adjacent to the current stack.

### vettid-android / vettid-desktop / vettid-agent (app & agent side)

- **Remove:** NATS client libraries and credentials plumbing.
- **Add:** relay HTTP client (deposit with token + request signing; collect
  long-poll on foreground/wake), relay keypair in platform keystore, token cache
  with expiry-aware refresh (request new tokens from the vault over OwnerSpace
  before expiry), ULID dedupe store.
- **OwnerSpace unchanged in shape:** app still talks only to OwnerSpace — what
  changes is the pipe underneath it (relay mailbox instead of NATS subject).
- **Push wake (v1.1):** relay-side FCM/APNs webhook so mobile apps don't poll in
  background; not required for cutover since desktop/agent can long-poll.

### Docs/positioning

- Publish `RELAY-PROTOCOL.md` (vendor-neutral, vault-sovereign authorization) —
  feeds the LEASH/AAIF narrative and the vettid.org "neutral infrastructure" story.

---

## Working agreements for this build

- Discrete, reviewable commits at each checkpoint above; `git diff` review before
  each commit; **gitleaks scan locally + in CI before every push**.
- No secrets anywhere in the repo by construction: the relay's only sensitive
  material at runtime is its TLS key, which lives outside the repo and outside
  the SQLite file.
- No payload contents in logs, errors, or metrics — ids and sizes only.
- Spec changes after Phase 1 require a spec commit before the code commit that
  implements them.
