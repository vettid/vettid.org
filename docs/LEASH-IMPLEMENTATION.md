# LEASH: VettID Implementation Status

**Status:** in development, not in production (October 2026)

[LEASH](https://github.com/vettid/LEASH) is a vendor-neutral position paper on
how AI agents use secrets. VettID's vault is one LEASH implementation. This
document maps the paper onto the vault and records what is and is not built.
It was Appendix B of the paper until the paper was made vendor-neutral.

The vault's normative specification is [VAULT-MESSAGING](VAULT-MESSAGING.md)
(version 0.10.8, draft). Its §10.11 maps the paper's terms onto the vault. The
code is in [vettid/vettid-vault](https://github.com/vettid/vettid-vault). Section
numbers in the right-hand column refer to VAULT-MESSAGING unless stated.

| The paper | VettID's vault |
|-----------|----------------|
| Implementation tier (§6) | Tier 1: each member's vault runs as its own process inside an AWS Nitro Enclave. |
| Encrypted channel (§3.4) | The vault and the agent exchange end-to-end-encrypted messages through mailboxes on a relay ([RELAY-PROTOCOL](RELAY-PROTOCOL.md) 0.6.0, `relay.vettid.org`) that stores only ciphertext. Sessions use epochs and rekeys (§6). |
| Enrollment (§3.1) | Agent pairing (§6.7): the owner's app shows a QR code that is valid for 10 minutes. The owner compares a committed short authentication string (§6.3) and approves in the app. |
| Connection Contract (§3.2) | The agent's grants. Each grant is a delegation signed with the owner's credential key, which is held in the owner's Protean Credential, so the owner must be present to issue one (§10.11, §3.5). The approval mode is per grant: `ask` (the default) or `auto`, within per-hour and per-day limits, matching the paper's two modes. |
| Access window | Besides its grants, an agent acts only within a time-limited access session that the owner's app grants: 60 seconds to 24 hours, 1 hour by default (§6.8). |
| Delegations and status statements (§3.5); revocation (§3.4) | Revoking a grant takes effect in the vault at once. For relying parties outside the vault, the vault signs short-lived status statements that the agent staples to its delegation. A statement lives 60 seconds to 1 hour, 15 minutes by default, so a revoked delegation is accepted for at most that long plus 60 seconds of clock skew (§10.11). The reference verifier is `leashwire.VerifyPresented` in vettid-vault. |
| Pattern 1: retrieval (§2.3) | `agent.request{op: "item.get"}` on the items the owner has shared with the agent (§10.11, §10.12). |
| Pattern 2: action execution (§2.3) | `agent.request{op: "item.use"}`, currently limited to HMAC-SHA-256 keyed with a stored value. The HTTP action, in which the vault makes a request with an injected secret, is not offered yet because it needs egress from the enclave beyond the relay (§10.11, §15 item 7). |
| Secret scope | Critical items, VettID's highest sensitivity class, are never reachable by agents (§10.11). |
| Rate limits and suspension (§3.2) | Per-grant hourly and daily limits, a cooldown after each refusal, at most 20 referrals to the owner per agent per hour, and suspension after 30 refusals within an hour (§10.11). |
| Audit logging (§3.4) | A hash-chained audit log with `leash.*` entry kinds (§10.9, §10.11). |
| Platform binding and binary attestation (§3.4) | Left to the agent's connector; outside the vault's scope (§10.11). |

## Alignment with the paper's §3.5

The paper's §3.5 defines a generic version 1 format. VettID's current format
(VAULT-MESSAGING §10.11) has the same structure and the same bounds. VettID is
aligning §10.11 to the paper's §3.5 in a separate VAULT-MESSAGING change, and
the reference implementation will follow. Until then, the current format
differs in these ways:

- **Same:** a delegation signed by the owner's key and a status statement
  signed by the status issuer; the status statement's fields (`v`,
  `delegation` = SHA-256 of the delegation bytes, `grant_id`, `status`,
  `issued_at`, `not_after`); `status_ttl` of 60 to 3,600 seconds, default 900;
  60 seconds of clock skew; Ed25519 signatures over the exact bytes; proof of
  possession of the agent's key.
- **Different names:** the agent's key is `agent_ik` (the paper's `sub`), and
  the status issuer is the vault's identity key `vault_ik` (the paper's
  `status_issuer`). The owner's key is sent beside the delegation as `key`
  rather than inside it as `iss`.
- **Different scope fields:** VettID carries `scope`, `approval`,
  `connections`, `tags`, `match`, `access`, `uses`, `per_hour` and `per_day`
  as top-level members. The paper groups the limits under `limits`.
- **No `nonce`:** `grant_id` (a ULID) and `version` make each VettID
  delegation unique.
- **Encoding:** VettID requires a fixed member order with no whitespace. The
  paper recommends RFC 8785 and has verifiers check the signature over the
  bytes as received.
- **Context strings:** `vettid/vms/2/leash` and `vettid/vms/2/leash-status`,
  where the paper uses `leash/v1/delegation` and `leash/v1/status`.
- **Rotation:** VettID statements carry a chain of `identity.rotate`
  statements when the vault's key has rotated since the delegation was
  issued. The paper does not define key rotation.

## Cryptography

Key exchange and sealing use HPKE (RFC 9180) with the hybrid post-quantum KEM
ML-KEM-768 + X25519 (X-Wing style). Encryption uses ChaCha20-Poly1305 and
XChaCha20-Poly1305, and key derivation uses HKDF-SHA-256. Keys derived from a
PIN or password use Argon2id (VAULT-MESSAGING §4.1). Signatures, including the
signatures on LEASH delegations and status statements, are Ed25519. They are
classical, not post-quantum. A hybrid Ed25519 + ML-DSA-65 suite is reserved for
a later phase ([PQC-MIGRATION](PQC-MIGRATION.md)).

## Connector

VettID has not yet rebuilt its agent-side connector on this design. The public
[vettid/vettid-agent](https://github.com/vettid/vettid-agent) repository holds
the connector from VettID's first implementation, which used vettid.dev and
NATS messaging. That connector exposes a local REST and WebSocket API rather
than an MCP server, and it does not work with the current vault.
