# Pact v3 Threat Model

Security analysis of Pact's negotiation protocol, settlement boundaries, and execution layers.

---

## Trust Assumptions

**Cryptographic Security:**
- Ed25519 signatures are secure and unforgeable
- Message hash collisions are computationally infeasible
- Private keys are not exposed to negotiation parties

**Protocol Determinism:**
- Negotiation outcomes are deterministic given identical inputs
- Transcript replay produces the same results as original execution
- Policy enforcement is consistent across runs

**Execution Boundaries:**
- Settlement providers (Stripe, escrow contracts) operate as trusted execution backends
- Wallet adapters correctly implement signature generation and verification
- Provider directories maintain accurate provider information

**Network Assumptions:**
- Message delivery is eventually reliable (at-least-once delivery acceptable)
- Clock skew between parties is bounded (< 5 minutes typical)
- Network partitions are transient

---

## Attacker Models

### Malicious Buyer

**Capabilities:**
- Controls buyer private key
- Can generate arbitrary INTENT messages
- Can send BID messages with any price/terms
- Can attempt to replay old negotiation messages

**Attack Goals:**
- Negotiate lower prices through gaming
- Replay successful negotiations without new settlement
- Refuse settlement after agreement (renege)
- Drain provider resources via spam

**Mitigations:**
- **Rate limiting:** In-memory rate limits per agent identity prevent spam
- **Rejection penalties:** Repeated bad-faith rejections increase price penalties
- **Intent ID uniqueness:** Each negotiation uses a unique intent_id; replays are rejected
- **Commit-reveal scheme:** Agreement uses nonce-based commit/reveal preventing bid manipulation
- **Reputation weighting:** Providers can adjust acceptance based on buyer reputation

### Malicious Provider

**Capabilities:**
- Controls provider private key
- Can generate arbitrary ASK/ACCEPT/REJECT messages
- Can manipulate quote prices
- Can refuse fulfillment after agreement

**Attack Goals:**
- Charge higher prices than negotiated
- Accept payment without delivering service
- Replay old ASK messages to lock buyers into stale prices
- Collude with other providers to fix prices

**Mitigations:**
- **Policy enforcement:** Buyers define max_price constraints enforced deterministically
- **Transcript audit:** All negotiations produce transcripts for dispute resolution
- **Settlement phases:** Settlement separates prepare/commit phases; funds only committed after verification
- **Escrow protection:** On-chain escrow holds funds until fulfillment proof; slash() enables disputes
- **Intent expiration:** INTENT messages expire, preventing stale quote acceptance

### Replay Attacks

**Attack Vector:**
- Attacker intercepts a valid signed envelope from a past negotiation
- Replays the envelope to trigger duplicate settlement or state changes

**Mitigations:**
- **Intent ID uniqueness:** Each negotiation requires a unique intent_id; duplicate intent_ids are rejected
- **Signed timestamps:** Envelopes include `signed_at_ms`; providers can reject stale messages
- **Expiration windows:** INTENT messages have `expires_at_ms`; expired intents are rejected
- **Settlement handles:** Settlement operations use unique handle_ids per transaction; duplicate handles are rejected
- **Nonce-based commits:** Agreement phase uses commit-reveal with nonces; old commits cannot be replayed

---

## Wallet Signing Risks

### Key Exposure

**Risk:** Private key leakage allows attacker to impersonate agent.

**Mitigation:** Private keys are never transmitted in messages. Wallet adapters (ethers.js, etc.) handle key storage. Pact SDK does not manage keys.

### Signature Verification Bypass

**Risk:** Attacker forges signatures or bypasses verification.

**Mitigation:** 
- Ed25519 signature verification on all envelopes (`verifyEnvelope()`)
- Message hash recomputed from message body; hash mismatch rejects envelope
- Public key must match signer's agent_id; mismatches reject

### Message Tampering

**Risk:** Attacker modifies message content after signing.

**Mitigation:**
- Envelope includes `message_hash_hex`; recomputed hash must match
- Signature verified over hash bytes; tampered messages fail verification
- Canonical JSON encoding ensures deterministic hashing

### Replay via Wallet Proof

**Risk:** Attacker replays old wallet identity proofs.

**Mitigation:**
- Wallet proofs include timestamp in signed message
- Providers can reject proofs older than a threshold (e.g., 5 minutes)

---

## Escrow Risks

### Reentrancy Attacks

**Risk:** Attacker calls `release()` recursively to drain escrow.

**Mitigation:** Explicit `ReentrancyGuard` modifier on all state-changing functions (`lock`, `release`, `refund`, `slash`). Status updated before external transfers.

### Unauthorized Slashing

**Risk:** Attacker calls `slash()` to steal funds.

**Mitigation:** `slash()` requires `msg.sender == escrow.buyer`. Only the buyer who locked funds can initiate slashing. Beneficiary must be non-zero address.

### Double-Spending

**Risk:** Attacker locks same intent_id multiple times or calls `release()` twice.

**Mitigation:**
- `lock()` checks `escrow.status == EscrowStatus.None`; duplicate locks revert
- `release()` updates status to `EscrowStatus.Released` before transfer; second call reverts
- Status checks use `require()` with custom errors for gas efficiency

### Insufficient Balance

**Risk:** Contract does not hold sufficient funds for transfer.

**Mitigation:** Balance checks before all transfers (`address(this).balance >= amount`). Custom `InsufficientBalance` error if check fails.

### Zero Address Transfers

**Risk:** Funds sent to `address(0)` are permanently lost.

**Mitigation:** Zero address checks on buyer, seller, and beneficiary parameters. `InvalidAddress` error reverts transaction.

---

## Transcript Integrity Risks

### Tampering After Generation

**Risk:** Attacker modifies transcript JSON to hide violations or fabricate outcomes.

**Mitigation:**
- Transcripts include cryptographic hashes of negotiation rounds
- Replay verification (`replayTranscript()`) recomputes hashes and compares
- Mismatched hashes cause replay to fail with explicit errors

### Replay Verification Bypass

**Risk:** Attacker convinces system that invalid transcript is valid.

**Mitigation:**
- Replay is deterministic: same inputs produce same outputs
- All decision points (policy checks, strategy outputs) are replayed and compared
- Commit-reveal nonces are verified; mismatched commits fail replay

### Incomplete Transcripts

**Risk:** Provider generates partial transcripts hiding failed negotiations.

**Mitigation:**
- Transcripts must include all rounds, even rejected ones
- Replay verification checks for terminal states (AGREEMENT, REJECTED, FAILED)
- Incomplete transcripts fail replay validation

### Timestamp Manipulation

**Risk:** Attacker backdates timestamps to bypass expiration.

**Mitigation:**
- Timestamps are advisory; replay uses deterministic time progression
- Intent expiration checked during negotiation, not replay
- Transcript replay does not re-validate expiration (transcript is historical record)

---

## Mitigations Already Implemented

### Protocol Layer

- **Ed25519 signatures:** All messages cryptographically signed and verified
- **Deterministic negotiation:** Same inputs produce same outputs (replayable)
- **Intent ID uniqueness:** Prevents duplicate negotiations
- **Commit-reveal scheme:** Prevents bid manipulation in agreement phase
- **Expiration windows:** Prevents stale message replay

### Settlement Layer

- **ReentrancyGuard:** Escrow contract protects against reentrancy
- **Authorization checks:** Buyer-only slash, buyer-only lock
- **Balance validation:** Defensive checks before all transfers
- **Event emission:** All state changes emit events for audit

### Anti-Gaming Layer

- **Rate limiting:** In-memory limits per agent identity (configurable)
- **Reputation weighting:** Quote acceptance adjusted by agent reputation
- **Rejection penalties:** Bad-faith rejections increase price penalties
- **Transcript flagging:** Suspicious behavior flagged in transcripts for audit

### Transcript Layer

- **Hash-based verification:** Replay verifies transcript integrity
- **Deterministic replay:** Same transcript produces same validation result
- **Canonical encoding:** JSON encoding ensures deterministic hashing

---

## Known Non-Goals

**Not Protected Against:**

- **Network-level attacks:** DDoS, packet loss, routing attacks (assumes network reliability)
- **Key management:** Private key generation, storage, rotation (delegated to wallet adapters)
- **Provider directory attacks:** Sybil attacks, directory poisoning (assumes trusted directory)
- **Oracle manipulation:** Price feeds, external data sources (assumes oracles are trusted)
- **Smart contract bugs:** Escrow contract audits are separate (assumes contract correctness)
- **Social engineering:** Phishing, key theft via social means (out of protocol scope)
- **Quantum attacks:** Post-quantum cryptography not implemented (assumes classical security)
- **Long-term key compromise:** No key rotation mechanism (assumes keys remain secure)

**Out of Scope:**

- **Dispute resolution:** Pact produces transcripts for disputes; actual resolution is external
- **Settlement finality:** Settlement providers (Stripe, escrow) handle finality guarantees
- **Multi-party consensus:** Current protocol is two-party (buyer/seller)
- **Cross-chain settlement:** Escrow is chain-specific; cross-chain is future work

---

**Last Updated:** January 2026
