# PACT v1.0 Contract

This document defines the **exact guarantees** for PACT v1.0. These are contracts that will not change within the v1 major version.

---

## What PACT v1.0 Is

PACT v1.0 is a **two-agent acquire + settlement protocol** with:

- **Directory-based provider discovery** (JSONL registry or in-memory)
- **Cryptographic verification** (Ed25519 signatures, signer must match directory pubkey)
- **Deterministic negotiation** (same inputs → same outcome)
- **Settlement execution** (hash-reveal or streaming)
- **Receipt generation** (verifiable, immutable outcomes)

PACT v1.0 enables autonomous agents to:
1. Discover counterparties via a directory
2. Negotiate terms under policy constraints
3. Select the best provider deterministically
4. Execute settlement with cryptographic guarantees
5. Produce verifiable receipts for accounting/reputation

---

## Supported Settlement Modes

PACT v1.0 supports **exactly two** settlement modes:

### 1. `hash_reveal` (Required)

**What it is:**
- Atomic commit-reveal settlement
- Provider commits to `SHA256(payload + nonce)`
- Provider reveals `payload + nonce`
- Buyer verifies hash before payment release

**Success criteria:**
- Provider commits a valid hash
- Provider reveals matching payload + nonce
- Hash verification succeeds
- Payment is released to provider
- Receipt is generated with `fulfilled: true`

**Failure modes:**
- `FAILED_PROOF` — hash verification failed
- `FAILED_ESCROW` — insufficient funds
- Timeout — deadline exceeded

### 2. `streaming` (Optional)

**What it is:**
- Continuous pay-as-you-go settlement
- Provider streams chunks incrementally
- Buyer pays per tick
- Either side may stop early

**Success criteria:**
- Provider streams chunks with valid signatures
- Buyer pays incrementally per tick
- Either side may stop gracefully
- Receipt reflects partial fulfillment (`paid_amount`, `ticks`, `chunks`)

**Failure modes:**
- `BUYER_STOPPED` — buyer halted early (not necessarily a failure)
- `SELLER_STOPPED` — seller halted early
- `HTTP_STREAMING_ERROR` — HTTP endpoint failed
- `STREAMING_SPEND_CAP_EXCEEDED` — budget exhausted

**Guarantee**: These are the only settlement modes in v1.0. No additional modes will be added without a major version bump.

---

## Protocol Invariants

The following **must always hold** in PACT v1.0:

1. **No payment without verification**
   - Funds are never released without cryptographic proof
   - Hash-reveal: hash must verify before payment
   - Streaming: signatures must verify for each chunk

2. **Signer must match directory pubkey**
   - Provider's `signer_public_key_b58` must exactly match `pubkey_b58` in directory
   - Mismatch results in `PROVIDER_SIGNER_MISMATCH` rejection
   - This is a security requirement, not optional

3. **Timeouts are enforced**
   - `expires_at_ms` on messages is checked
   - `delivery_deadline_ms` on agreements is enforced
   - Timeout results in `FAILED_PROOF` or settlement failure

4. **Deterministic outcomes**
   - Same inputs (intent, providers, policy, time) → same result
   - No hidden randomness
   - All clocks are injected explicitly

5. **Receipts are immutable**
   - Once created, receipts cannot be modified
   - Receipts are deterministic (same settlement → same receipt)
   - Receipts are verifiable (can be validated independently)

**Violation of any invariant indicates a bug in the implementation.**

---

## Know Your Agent (KYA)

PACT v1.0+ includes identity verification mechanisms to ensure providers are who they claim to be.

### Signer Verification

All provider messages (quotes, commits, reveals, stream chunks) must be signed, and the signer's public key must match the provider's `pubkey_b58` in the directory. This is enforced at the protocol level (see Protocol Invariant #2).

### Provider Credentials (v1.5+)

v1.5 adds credential-based identity verification for HTTP providers, enabling buyers to verify provider capabilities before negotiation begins.

#### Credential Format

Credentials are signed capability attestations presented as signed envelopes:

```typescript
{
  protocol_version: "pact/1.0",
  credential_version: "1",
  credential_id: string;              // Unique identifier
  provider_pubkey_b58: string;        // Provider's public key
  issuer: string;                     // For v1.5, allows "self" for self-signed
  issued_at_ms: number;
  expires_at_ms: number;
  capabilities: Array<{
    intentType: string;               // e.g., "weather.data"
    modes: ("hash_reveal" | "streaming")[];
    region?: string;
    credentials?: string[];            // e.g., ["sla_verified"]
  }>;
  nonce: string;                      // Random nonce
}
```

#### Credential Verification Steps

For HTTP providers, `acquire()` automatically fetches and verifies credentials:

1. **Fetch credential**: `GET /credential?intent=<intentType>` returns a signed envelope
2. **Verify signature**: Credential envelope signature must be valid (Ed25519)
3. **Verify signer match**: Credential signer must match provider's directory `pubkey_b58`
4. **Check expiration**: Credential must not be expired (`expires_at_ms >= now`)
5. **Verify capability**: Credential must support the requested intent type

If any step fails, the provider is marked ineligible with `PROVIDER_CREDENTIAL_INVALID`.

#### Graceful Degradation

For backward compatibility with v1.0 providers:
- **404 Not Found**: Credential endpoint missing → Provider is allowed (legacy support)
- **Other errors**: Credential fetch/parse errors → Provider is marked ineligible

#### Explain Codes for Credential Failures

When credential verification fails, the explain log includes:

- `PROVIDER_CREDENTIAL_INVALID`: Credential verification failed
  - Signature verification failed
  - Signer doesn't match provider pubkey
  - Credential expired
  - Credential doesn't support requested intent type
  - Credential fetch/parse error (non-404)

These codes appear in the `explain.log` when `explain !== "none"`, allowing buyers to understand why providers were rejected.

---

## Receipt Schema

A buyer **always** receives a Receipt after settlement completes (or fails). The receipt schema is:

```typescript
{
  receipt_id: string;           // Format: "receipt-{intent_id}-{timestamp_ms}"
  intent_id: string;             // Matches the intent_id from negotiation
  buyer_agent_id: string;        // Buyer's agent identifier
  seller_agent_id: string;       // Seller's agent identifier (pubkey_b58)
  agreed_price: number;          // Price agreed in ACCEPT (positive number)
  fulfilled: boolean;            // true if delivery succeeded, false if failed
  latency_ms?: number;           // Optional: actual delivery latency
  failure_code?: FailureCode;    // Optional: present if fulfilled=false
  paid_amount?: number;          // Optional: actual amount paid (for streaming)
  ticks?: number;                // Optional: number of ticks (for streaming)
  chunks?: number;               // Optional: number of chunks (for streaming)
  timestamp_ms: number;          // Receipt generation timestamp
}
```

### Receipt Verification Rules

1. **Completeness**: All receipts include `receipt_id`, `intent_id`, `buyer_agent_id`, `seller_agent_id`, `agreed_price`, `fulfilled`, `timestamp_ms`
2. **Failure codes**: If `fulfilled: false`, `failure_code` must be present and be a valid `FailureCode`
3. **Streaming fields**: For streaming settlements, `paid_amount`, `ticks`, and `chunks` are present
4. **Immutability**: Receipts are immutable once created
5. **Determinism**: Same settlement outcome produces the same receipt

**Guarantee**: The receipt schema is stable in v1.0. Fields will not be removed or change meaning without a major version bump.

---

## Failure Modes and Codes

PACT v1.0 defines explicit failure codes. All failures are deterministic and enumerable.

### Discovery / Selection
- `DIRECTORY_EMPTY` — No providers available for the intent type
- `NO_PROVIDERS` — Directory returned no providers
- `NO_ELIGIBLE_PROVIDERS` — Providers existed but all were rejected

### Identity / Verification
- `PROVIDER_SIGNATURE_INVALID` — Provider envelope signature verification failed
- `PROVIDER_SIGNER_MISMATCH` — Signer pubkey doesn't match expected provider pubkey
- `PROVIDER_CREDENTIAL_INVALID` — (v1.5+) Credential verification failed (signature, signer mismatch, expired, or intent not supported)
- `UNTRUSTED_ISSUER` — Provider credential issuer not in trusted issuers list
- `FAILED_IDENTITY` — Identity verification failed

### Policy / Constraints
- `PROVIDER_MISSING_REQUIRED_CREDENTIALS` — Provider lacked required credentials
- `PROVIDER_QUOTE_POLICY_REJECTED` — Quote rejected by policy guard
- `PROVIDER_QUOTE_OUT_OF_BAND` — Price violated reference band constraints
- `FAILED_REFERENCE_BAND` — Quote price outside acceptable reference price band

### Settlement
- `FAILED_ESCROW` — Insufficient funds or lock failure
- `FAILED_PROOF` — Commit/reveal hash verification failed
- `BUYER_STOPPED` — Buyer halted streaming early (not necessarily a provider fault)
- `HTTP_STREAMING_ERROR` — HTTP streaming endpoint failed
- `HTTP_PROVIDER_ERROR` — HTTP provider endpoint error
- `STREAMING_NOT_CONFIGURED` — Streaming policy not configured
- `NO_AGREEMENT` — No agreement found after ACCEPT
- `NO_RECEIPT` — No receipt generated after settlement

### Other
- `INVALID_POLICY` — Policy validation failed

**Guarantee**: These failure codes are stable in v1.0. New codes may be added, but existing codes will not change meaning or be removed without a major version bump.

---

## Non-Goals / Excluded

PACT v1.0 **explicitly does not**:

- **Move money or custody assets** — PACT coordinates settlement but does not execute payments
- **Clear trades or settle payments** — Payment execution is external to PACT
- **Provide wallet functionality** — Wallets are out of scope
- **Implement market-making or order books** — PACT is pre-market, not a market
- **Handle subjective quality disputes** — Only objective failures are supported
- **Support human-in-the-loop arbitration** — Fully autonomous agents only
- **Provide cross-chain settlement** — Single-chain/rail only in v1.0

**Guarantee**: Features outside this scope will not be added to v1.0 without a major version bump.

---

## Deterministic Dev Identity

For **development and testing only**, PACT provides a deterministic provider identity:

- **Seed**: `"pact-provider-default-seed-v1"` (default)
- **Generation**: `nacl.sign.keyPair.fromSeed(SHA256(seed))`
- **Result**: Same seed → same keypair → same `sellerId` every run

**This is NOT for production use.**

Production providers **must**:
- Use cryptographically secure random keypairs
- Store keypairs securely (HSMs, key management systems)
- Never use predictable or hardcoded seeds
- Follow proper KYA (Know Your Agent) identity management

**Guarantee**: The deterministic dev identity is a development convenience only. It will not be used in production deployments.

---

## Stable Public Entrypoints (v1.7.2+)

The following APIs are **stable** and will not change in v1.x:

### Core Acquisition
- `acquire(input, buyerKeyPair, sellerKeyPair, buyerId, sellerId, policy, settlement, directory, ...)` — Main entrypoint for negotiation and settlement
  - Returns: `AcquireResult` with `ok`, `receipt`, `code`, `reason`, `transcriptPath`
  - Input schema: `AcquireInput` (stable fields: `intentType`, `scope`, `constraints`, `maxPrice`, `modeOverride`, `saveTranscript`)
  - **Guarantee**: Input/output schema will not change in v1.x (new optional fields may be added)

### Settlement Providers
- `SettlementProvider` interface — Base interface for settlement execution
  - Required methods: `getBalance()`, `lock()`, `release()`, `pay()`, `prepare()`, `commit()`, `abort()`
  - Optional methods: `poll()` (for async settlement), `refund()` (for disputes)
  - **Guarantee**: Interface methods will not be removed or change signatures in v1.x
- `MockSettlementProvider`, `StripeLikeSettlementProvider`, `ExternalSettlementProvider` — Concrete implementations
  - **Guarantee**: Constructor signatures and core behavior stable in v1.x

### Dispute Resolution
- `openDispute(params)` — Opens a dispute against a receipt
  - Returns: `DisputeRecord`
  - **Guarantee**: Function signature and return type stable in v1.x
- `resolveDispute(params)` — Resolves a dispute with outcome and optional refund
  - Returns: `{ ok: boolean; record?: DisputeRecord; code?: string; reason?: string }`
  - **Guarantee**: Function signature and return type stable in v1.x

### Reconciliation
- `reconcile(input)` — Polls pending settlement handles and updates transcripts
  - Input: `ReconcileInput` with `transcriptPath` or `transcript`, `now`, `settlement`
  - Returns: `ReconcileResult` with `ok`, `status`, `updatedTranscriptPath`, `reconciledHandles`
  - **Guarantee**: Function signature and return type stable in v1.x

### Transcript Replay
- `replayTranscript(transcript)` — Replays a transcript and validates invariants
  - Returns: `ReplayResult` with `ok`, `failures[]`
  - **Guarantee**: Function signature and return type stable in v1.x
- `verifyTranscriptFile(path)` — Verifies a transcript file with stronger invariants
  - Returns: `{ ok: boolean; errors: string[]; warnings: string[] }`
  - **Guarantee**: Function signature and return type stable in v1.x

### Policy
- `createDefaultPolicy()` — Creates a default policy configuration
- `validatePolicyJson(policy)` — Validates policy JSON
- `compilePolicy(policy)` — Compiles policy for execution
- **Guarantee**: Policy schema and compilation behavior stable in v1.x

---

## Transcript Invariants (v1.7.2+)

Transcripts (`TranscriptV1`) must satisfy the following invariants:

### Schema Version
- `transcript_version?: "1.0"` — Schema version (defaults to "1.0" if missing)
- **Guarantee**: New transcripts must include `transcript_version: "1.0"`

### Settlement Attempts
- If `settlement_attempts` exists and is non-empty:
  - Last attempt's `outcome` must match overall `outcome.ok` status
  - If overall outcome is failure, last attempt's `failure_code` must match overall `outcome.code` (if present)

### Streaming Attempts
- If `streaming_attempts` and `streaming_summary` exist:
  - Sum of successful attempt `paid_amount` values must equal `streaming_summary.total_paid_amount` (within epsilon)
  - `streaming_summary.total_paid_amount` must not exceed `receipt.agreed_price + epsilon`

### Settlement Segments (Split Settlement)
- If `settlement_split_summary.enabled` is true:
  - Sum of committed segment `amount` values must equal `settlement_split_summary.total_paid` (within epsilon)
  - `settlement_split_summary.total_paid` must not exceed `settlement_split_summary.target_amount + epsilon`

### Dispute Events
- If `dispute_events` exists:
  - Each resolved dispute's `refund_amount` must not exceed `receipt.paid_amount` or `receipt.agreed_price`
  - No duplicate `dispute_id` entries should sum to more than the paid amount

### Reconcile Events
- If `reconcile_events` exists:
  - Each event must have `handle_id` matching `settlement_lifecycle.handle_id`
  - Status transitions must be valid (e.g., `pending` → `committed` or `failed`)

**Guarantee**: These invariants are enforced by `verifyTranscriptFile()` and will not change in v1.x.

---

## Stable Failure Codes (v1.7.2+)

The following failure codes are **stable** and will not change meaning or be removed in v1.x:

### Discovery / Selection
- `DIRECTORY_EMPTY` — No providers available for the intent type
- `NO_PROVIDERS` — Directory returned no providers
- `NO_ELIGIBLE_PROVIDERS` — Providers existed but all were rejected

### Identity / Verification
- `PROVIDER_SIGNATURE_INVALID` — Provider envelope signature verification failed
- `PROVIDER_SIGNER_MISMATCH` — Signer pubkey doesn't match expected provider pubkey
- `PROVIDER_CREDENTIAL_INVALID` — (v1.5+) Credential verification failed
- `UNTRUSTED_ISSUER` — Provider credential issuer not in trusted issuers list
- `FAILED_IDENTITY` — Identity verification failed

### Policy / Constraints
- `PROVIDER_MISSING_REQUIRED_CREDENTIALS` — Provider lacked required credentials
- `PROVIDER_QUOTE_POLICY_REJECTED` — Quote rejected by policy guard
- `PROVIDER_QUOTE_OUT_OF_BAND` — Price violated reference band constraints
- `FAILED_REFERENCE_BAND` — Quote price outside acceptable reference price band
- `PROVIDER_TRUST_TIER_TOO_LOW` — Provider trust tier below minimum required

### Settlement
- `FAILED_ESCROW` — Insufficient funds or lock failure
- `FAILED_PROOF` — Commit/reveal hash verification failed
- `BUYER_STOPPED` — Buyer halted streaming early (not necessarily a provider fault)
- `SELLER_STOPPED` — Seller halted streaming early
- `HTTP_STREAMING_ERROR` — HTTP streaming endpoint failed
- `HTTP_PROVIDER_ERROR` — HTTP provider endpoint error
- `STREAMING_NOT_CONFIGURED` — Streaming policy not configured
- `STREAMING_SPEND_CAP_EXCEEDED` — Budget exhausted during streaming
- `NO_AGREEMENT` — No agreement found after ACCEPT
- `NO_RECEIPT` — No receipt generated after settlement
- `SETTLEMENT_PENDING` — Settlement is pending (async mode)

### Other
- `INVALID_POLICY` — Policy validation failed

**Guarantee**: These codes are stable. New codes may be added in v1.x, but existing codes will not change meaning or be removed without a major version bump.

---

## What Can Change in v1.7.x vs v2.0.0

### v1.7.x (Backward-Compatible Changes)

The following may change in v1.7.x without breaking compatibility:

- **New optional fields** in `AcquireInput`, `AcquireResult`, `TranscriptV1`, `Receipt`, `DisputeRecord`
- **New failure codes** (existing codes remain stable)
- **New optional methods** in `SettlementProvider` interface
- **New optional parameters** in function signatures (with defaults)
- **New transcript fields** (optional, backward-compatible)
- **New settlement provider implementations** (additive only)
- **Performance improvements** (behavior unchanged)
- **Bug fixes** (correcting incorrect behavior)
- **New utility functions** (additive only)
- **Enhanced error messages** (same codes, better descriptions)

**Guarantee**: v1.7.x changes will not break existing code that uses stable APIs.

### v2.0.0 (Breaking Changes)

The following changes **require** a major version bump to v2.0.0:

- **Removal or renaming** of stable public entrypoints
- **Signature changes** to stable functions (removing required parameters, changing return types)
- **Removal of failure codes** or changes to their meaning
- **New required fields** in stable input/output types
- **New settlement modes** (beyond `hash_reveal` and `streaming`)
- **Changes to protocol invariants** (e.g., removing signer verification)
- **Breaking changes to transcript schema** (removing required fields, changing field types)
- **Breaking changes to receipt schema** (removing required fields, changing field types)
- **Breaking changes to policy schema** (removing required fields, changing validation rules)
- **Removal of methods** from `SettlementProvider` interface

**Guarantee**: v2.0.0 will include migration guides for all breaking changes.

---

## Versioning

PACT follows semantic versioning:

- **v1.0.0** — Initial stable release with these exact guarantees
- **v1.x.x** — Backward-compatible additions (new optional fields, new error codes)
- **v1.7.2+** — API freeze: stable public entrypoints documented and guaranteed
- **v2.0.0** — Breaking changes (new settlement modes, schema changes, invariant changes)

**Guarantee**: All guarantees in this document hold for the entire v1 major version.

