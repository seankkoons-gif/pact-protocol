# SECURITY.md

This document describes the security model, assumptions, and non-goals of the PACT protocol and its reference implementations.

PACT is a **coordination and settlement protocol**, not a custody system, exchange, or trusted execution environment. Its security model is deliberately narrow and explicit.

---

## Scope

This document applies to:

- `@pact/sdk`
- `@pact/provider-adapter`
- Protocol message formats
- Settlement and receipt semantics
- Deterministic execution guarantees

It does **not** attempt to cover application-level security beyond the protocol boundary.

---

## Security Goals

PACT is designed to guarantee the following:

### 1. Deterministic Outcomes
Given the same inputs (messages, timestamps, policy, receipts), compliant agents must converge on the same result.

This prevents:
- Hidden manipulation
- Non-reproducible settlements
- “He said / she said” disputes

---

### 2. Message Authenticity
All protocol messages are signed.

The protocol guarantees:
- Messages are attributable to a specific agent key
- Tampering is detectable
- Impersonation is prevented (assuming key secrecy)

---

### 3. Fair Exchange Semantics
PACT prevents one-sided advantage through:

- Commit / reveal flows
- Streaming payment with enforced caps
- Buyer-initiated stop conditions
- Receipt-based settlement

No party can unilaterally extract value beyond what was agreed.

---

### 4. Explicit Failure
All failures are explicit and classifiable.

PACT favors:
- Early rejection
- Typed failure codes
- Verifiable receipts

Silent failure or ambiguous partial success is considered a bug.

---

### 5. Explainability
When enabled, PACT can explain **why** a provider was selected or rejected.

This allows:
- Auditability
- Post-mortem analysis
- Trust calibration between agents

Explainability does **not** override correctness.

---

### 6. Signed Dispute Decisions (v1.6.0-alpha)
Dispute resolution decisions can be cryptographically signed by arbiters using Ed25519 signatures.

This provides:
- **Non-repudiation**: Signed decisions cannot be denied by the arbiter
- **Verification**: Anyone can verify decision authenticity using the arbiter's public key
- **Audit trails**: Decision hashes link disputes to signed artifacts

Security relies on:
- Arbiter keypair secrecy (private key must be protected)
- Canonical JSON serialization for deterministic hashing
- Ed25519 signature verification

---

## Threat Model

PACT assumes the following adversarial behaviors are possible:

- Malicious counterparties
- Dishonest providers
- Strategic early exits
- Network-level interference
- Replay attempts
- Invalid or malformed messages

PACT is designed to remain correct under these conditions.

---

### Explicitly Out of Scope

PACT does **not** attempt to defend against:

- Compromised private keys
- Malicious host machines
- Side-channel attacks
- Timing attacks outside protocol time bounds
- Denial-of-service at the transport layer
- Economic griefing via off-protocol coordination

These must be handled by the surrounding system.

---

## Cryptography

PACT uses:

- Ed25519 signatures
- Content-addressed hashes
- Deterministic serialization

No custom cryptography is introduced.

All cryptographic operations rely on well-established libraries.

---

## Key Management

Key generation, storage, and rotation are **out of scope** for PACT.

Agents are responsible for:
- Protecting their private keys
- Rotating keys when compromised
- Associating reputation with keys intentionally

PACT treats keys as identities, not accounts.

---

## Streaming-Specific Considerations

Streaming settlement introduces unique risks:

### Buyer Protections
- Spending is capped per tick
- Buyer can halt at any time
- Overpayment is impossible by design

### Seller Protections
- Payment is incremental
- Chunks are paid only when processed
- Buyer stops are recorded explicitly

Streaming receipts encode partial fulfillment clearly.

---

## HTTP Provider Adapters

HTTP providers are **untrusted transports**.

Security relies on:
- Signed messages
- Verified public keys
- Envelope validation
- Deterministic execution on the buyer side

Transport integrity (TLS, availability) is assumed but not enforced by the protocol.

---

## Schema Integrity

PACT validates messages against a canonical schema.

The schema:
- Is versioned
- Is included in published artifacts
- Is enforced at runtime

Invalid messages are rejected deterministically.

---

## Reporting Vulnerabilities

If you discover a security issue:

- **Do not** open a public issue
- Contact the maintainers directly
- Provide a minimal reproduction if possible

Responsible disclosure is expected.

---

## Security Philosophy

PACT does not try to be:
- “Trustless”
- “Fully decentralized”
- “Secure against everything”

It aims to be:
- Correct
- Verifiable
- Predictable
- Honest about its limits

Security comes from **clarity**, not marketing.

---

## Final Note

PACT’s strongest security property is **determinism**.

If two honest agents disagree about an outcome, that is a protocol failure.

If an adversary behaves maliciously and the protocol records it transparently, that is expected.

Design systems accordingly.
