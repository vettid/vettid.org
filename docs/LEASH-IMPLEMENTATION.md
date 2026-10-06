# LEASH: VettID Implementation Status

**Status:** in development, not in production (October 2026)

[LEASH](https://github.com/vettid/LEASH) is a vendor-neutral position paper on
how AI agents use secrets. VettID's vault is one LEASH implementation. This
document maps the paper onto the vault and records what is and is not built.
It was Appendix B of the paper until the paper was made vendor-neutral.

The vault's normative specification is [VAULT-MESSAGING](VAULT-MESSAGING.md)
(version 0.12.0, draft). Its §10.11 maps the paper's terms onto the vault. The
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

Since VAULT-MESSAGING 0.12.0, VettID's delegation and status statement use the
paper's §3.5 format. That covers the members, `sig` and `status_sig`, the
`leash/v1/delegation` and `leash/v1/status` context strings, the encoding
(RFC 8785, standard base64 with padding), the verifier's steps and the
revocation latency bound (§10.11, §15 item 21). The vault code has not caught up
yet: `vms/leashwire` and the LEASH features in vettid-vault still produce the
pre-0.12.0 format, and that change is a pending vettid-vault follow-up.

What stays VettID-specific are bindings the paper leaves open:

- **Transport:** delegations, status statements and agent requests travel over
  end-to-end-encrypted relay mailboxes ([RELAY-PROTOCOL](RELAY-PROTOCOL.md)).
- **Signer:** `iss` is the member's credential key, held in the Protean
  Credential. It signs only within the credential's unlock window, so the
  member must be present (§3.5).
- **Status issuer key rotation:** `status_issuer` is the vault's `ik`. When
  that key rotates, VettID statements carry a chain of `identity.rotate`
  statements (`rotations`, at most 32 links). The paper's version 1 does not
  define rotation, so a verifier that implements only the paper rejects
  statements after a rotation until the grant is re-signed. It fails closed.
- **Audit:** the hash-chained audit log uses `leash.*` entry kinds, with
  hourly summaries per agent (§10.9, §10.11).
- **Rate limits and suspension:** these go beyond the paper's `limits`. They
  are refusal cooldowns per scope, at most 20 referrals per agent per hour,
  and suspension after 30 refusals in an hour (§10.11).

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
