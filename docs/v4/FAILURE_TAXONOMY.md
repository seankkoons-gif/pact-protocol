# Pact Failure Taxonomy v4

Protocol Identifier: pact/4.0
Status: Draft (Normative)
Scope: Failure event classification, attribution, and anti-griefing rules for Pact protocol negotiations.

## 1. Design Goals (Normative)

Pact v4 introduces a structured failure taxonomy to enable:

1. **Deterministic Attribution**: Every failure MUST be attributed to a specific agent and fault domain
2. **Anti-Griefing**: Default blame rules prevent strategic failure injection
3. **Recursive Debugging**: Failure events reference evidence artifacts for post-hoc analysis
4. **Rail Independence**: Failure classification is independent of settlement rail implementation

The taxonomy MUST:

1. Provide exactly one FailureEvent per failed Intent
2. Attribute failures to unambiguous fault domains
3. Support evidence collection for dispute resolution
4. Prevent griefing through deterministic blame assignment

The taxonomy MUST NOT:

1. Allow multiple competing failure events for the same Intent
2. Leave failures unclassified or ambiguous
3. Depend on external settlement rail semantics
4. Require human judgment for blame assignment

## 2. Core Concepts

### 2.1 Failure Event

A **FailureEvent** is a structured record emitted when a Pact Intent terminates without successful completion. Every failed Intent MUST emit exactly one FailureEvent.

### 2.2 Stage

The **Stage** indicates the protocol phase at which failure was detected. Failures are detected at specific points in the protocol state machine.

### 2.3 Fault Domain

The **Fault Domain** identifies the responsible subsystem: Policy, Identity, Negotiation, Settlement, or Recursive/Dependency.

### 2.4 Terminality

The **Terminality** indicates whether the failure is terminal (Intent cannot proceed) or non-terminal (Intent may be retried or recovered).

## 3. FailureEvent Schema

Every FailureEvent MUST conform to the following schema:

```typescript
interface FailureEvent {
  code: string;                    // Canonical error code (PACT-XXX format)
  stage: Stage;                    // Protocol stage at detection
  fault_domain: FaultDomain;       // Responsible subsystem
  terminality: Terminality;        // Terminal or non-terminal
  evidence_refs: string[];         // References to evidence artifacts
  timestamp: number;               // Unix timestamp (milliseconds)
  transcript_hash: string;         // SHA-256 hash of transcript up to failure point
}
```

### 3.1 Field Definitions

**code** (string, required)
- MUST be in format `PACT-XXX` where XXX is a three-digit numeric code
- MUST be drawn from the canonical error families defined in Section 5
- MUST uniquely identify the failure condition

**stage** (Stage, required)
- MUST be one of the values defined in Section 4.1

**fault_domain** (FaultDomain, required)
- MUST be one of the values defined in Section 4.2

**terminality** (Terminality, required)
- MUST be one of the values defined in Section 4.3

**evidence_refs** (string[], required)
- Array of references to evidence artifacts (transcript IDs, envelope hashes, etc.)
- MUST include at least one reference to a verifiable artifact
- SHOULD include references to all relevant protocol messages leading to failure

**timestamp** (number, required)
- Unix timestamp in milliseconds when failure was detected
- MUST be non-negative integer

**transcript_hash** (string, required)
- SHA-256 hash (hex-encoded) of the canonical transcript up to and including the failure point
- MUST include all protocol messages and state transitions up to failure
- Enables deterministic replay and verification

## 4. Enumerations

### 4.1 Stage

The **Stage** enumeration identifies the protocol phase at which failure was detected:

- `admission`: Failure during identity verification, credential checks, or admission requirements (bond, trust tier, etc.)
- `discovery`: Failure during provider discovery or selection
- `negotiation`: Failure during price negotiation, quote exchange, or counteroffer rounds
- `commitment`: Failure during commitment phase (commit hash exchange, escrow preparation)
- `reveal`: Failure during reveal phase (nonce disclosure, commitment verification)
- `settlement`: Failure during settlement execution (payment processing, rail errors)
- `fulfillment`: Failure during service fulfillment (SLA violations, delivery errors)
- `verification`: Failure during verification or validation (receipt verification, proof checks)

### 4.2 Fault Domain

The **Fault Domain** enumeration identifies the responsible subsystem:

- `policy`: Failure due to policy constraints, rules, or guard checks
- `identity`: Failure due to identity verification, credential validation, or passport checks
- `negotiation`: Failure due to negotiation deadlock, timeout, or protocol violations
- `settlement`: Failure due to settlement rail errors, payment processing, or escrow failures
- `recursive`: Failure due to recursive dependency failures, cascading errors, or external system failures

### 4.3 Terminality

The **Terminality** enumeration indicates whether the failure prevents further progress:

- `terminal`: Failure is terminal; Intent cannot proceed and MUST be abandoned
- `non_terminal`: Failure is non-terminal; Intent MAY be retried or recovered (retry policy dependent)

**Normative Rules:**

- Policy violations MUST be `terminal`
- Settlement rail failures MAY be `non_terminal` (implementation-dependent)
- Negotiation timeouts MUST be `terminal`
- Identity verification failures MUST be `terminal`
- SLA violations during fulfillment MAY be `non_terminal` (policy-dependent)

## 5. Canonical Error Families

All error codes MUST follow the format `PACT-XXX` where XXX is a three-digit code. The first digit indicates the error family:

### 5.1 PACT-1xx: Policy Violations

Policy-related failures occur when Intent or negotiation violates configured policy constraints.

**PACT-100**: `POLICY_VIOLATION` - Generic policy constraint violation
**PACT-101**: `POLICY_MISSING_REQUIRED_CREDENTIAL` - Required credential not present
**PACT-102**: `POLICY_UNTRUSTED_ISSUER` - Credential issuer not in trusted set
**PACT-103**: `POLICY_TRUST_TIER_TOO_LOW` - Provider trust tier below minimum
**PACT-104**: `POLICY_REGION_NOT_ALLOWED` - Provider region not in allowlist
**PACT-105**: `POLICY_MAX_PRICE_EXCEEDED` - Negotiated price exceeds max_price
**PACT-106**: `POLICY_ROUND_LIMIT_EXCEEDED` - Negotiation round count exceeds max_rounds
**PACT-107**: `POLICY_DURATION_EXCEEDED` - Negotiation duration exceeds max_total_duration_ms
**PACT-108**: `POLICY_SESSION_SPEND_CAP_EXCEEDED` - Session spend exceeds hourly cap
**PACT-109**: `POLICY_NEW_AGENT_EXCLUDED` - New agent exclusion policy triggered
**PACT-110**: `POLICY_FAILURE_RATE_TOO_HIGH` - Provider failure rate exceeds threshold
**PACT-111**: `POLICY_TIMEOUT_RATE_TOO_HIGH` - Provider timeout rate exceeds threshold
**PACT-112**: `POLICY_SETTLEMENT_MODE_NOT_ALLOWED` - Settlement mode not permitted by policy
**PACT-113**: `POLICY_BOND_INSUFFICIENT` - Required bond amount not met
**PACT-114**: `POLICY_INVALID` - Policy structure or validation error

**Stage**: `admission`, `negotiation`, `commitment`
**Fault Domain**: `policy`
**Terminality**: `terminal`

### 5.2 PACT-2xx: Identity / Passport Violations

Identity-related failures occur when identity verification, credential validation, or passport checks fail.

**PACT-200**: `IDENTITY_VERIFICATION_FAILED` - Generic identity verification failure
**PACT-201**: `IDENTITY_SIGNATURE_INVALID` - Cryptographic signature verification failed
**PACT-202**: `IDENTITY_CREDENTIAL_EXPIRED` - Credential has expired
**PACT-203**: `IDENTITY_CREDENTIAL_MISSING` - Required credential not provided
**PACT-204**: `IDENTITY_CREDENTIAL_INVALID` - Credential structure or content invalid
**PACT-205**: `IDENTITY_PASSPORT_REQUIRED` - Passport proof required but not provided
**PACT-206**: `IDENTITY_PASSPORT_INVALID` - Passport proof verification failed
**PACT-207**: `IDENTITY_PASSPORT_EXPIRED` - Passport proof has expired
**PACT-208**: `IDENTITY_PASSPORT_TIER_TOO_LOW` - Passport trust tier below minimum
**PACT-209**: `IDENTITY_PASSPORT_ISSUER_NOT_ALLOWED` - Passport issuer not in allowed list
**PACT-210**: `IDENTITY_ZK_KYA_REQUIRED` - Zero-knowledge KYA proof required but not provided
**PACT-211**: `IDENTITY_ZK_KYA_INVALID` - Zero-knowledge KYA proof verification failed
**PACT-212**: `IDENTITY_ZK_KYA_EXPIRED` - Zero-knowledge KYA proof expired
**PACT-213**: `IDENTITY_ZK_KYA_TIER_TOO_LOW` - Zero-knowledge KYA trust tier too low

**Stage**: `admission`
**Fault Domain**: `identity`
**Terminality**: `terminal`

### 5.3 PACT-3xx: Negotiation / Deadlock

Negotiation-related failures occur when price negotiation deadlocks, times out, or violates protocol rules.

**PACT-300**: `NEGOTIATION_DEADLOCK` - Negotiation reached deadlock (no progress possible)
**PACT-301**: `NEGOTIATION_TIMEOUT` - Negotiation exceeded maximum duration
**PACT-302**: `NEGOTIATION_ROUND_EXCEEDED` - Maximum negotiation rounds reached
**PACT-303**: `NEGOTIATION_QUOTE_OUT_OF_BAND` - Quote price violates reference band constraints
**PACT-304**: `NEGOTIATION_QUOTE_INVALID` - Quote structure or validation error
**PACT-305**: `NEGOTIATION_FIRM_QUOTE_OUT_OF_RANGE` - Firm quote valid_for_ms outside allowed range
**PACT-306**: `NEGOTIATION_FIRM_QUOTE_MISSING_VALID_FOR` - Firm quote missing required valid_for_ms
**PACT-307**: `NEGOTIATION_COUNTER_INVALID` - Counteroffer violates protocol rules
**PACT-308**: `NEGOTIATION_PROTOCOL_VIOLATION` - Protocol message sequence or structure violation
**PACT-309**: `NEGOTIATION_NO_PROVIDERS` - No eligible providers found during discovery
**PACT-310**: `NEGOTIATION_PROVIDER_UNAVAILABLE` - Provider endpoint unreachable or unresponsive

**Stage**: `discovery`, `negotiation`
**Fault Domain**: `negotiation`
**Terminality**: `terminal`

### 5.4 PACT-4xx: Settlement / Rail Failures

Settlement-related failures occur when settlement rail (payment processing, escrow, etc.) encounters errors.

**PACT-400**: `SETTLEMENT_FAILED` - Generic settlement execution failure
**PACT-401**: `SETTLEMENT_RAIL_ERROR` - Settlement rail returned error (provider-specific)
**PACT-402**: `SETTLEMENT_COMMIT_FAILED` - Commitment phase failed (escrow preparation, payment intent creation)
**PACT-403**: `SETTLEMENT_REVEAL_FAILED` - Reveal phase failed (nonce verification, payment execution)
**PACT-404**: `SETTLEMENT_INSUFFICIENT_FUNDS` - Insufficient funds for settlement
**PACT-405**: `SETTLEMENT_TIMEOUT` - Settlement operation exceeded timeout
**PACT-406**: `SETTLEMENT_REFUND_FAILED` - Refund operation failed
**PACT-407**: `SETTLEMENT_SLA_VIOLATION` - Settlement SLA (latency, freshness) violated
**PACT-408**: `SETTLEMENT_STREAMING_SPEND_CAP_EXCEEDED` - Streaming payment exceeded spend cap
**PACT-409**: `SETTLEMENT_PRE_LOCK_REQUIRED` - Pre-settlement lock required but not provided
**PACT-410**: `SETTLEMENT_RECONCILE_FAILED` - Settlement reconciliation failed (pending settlement resolution)

**Stage**: `commitment`, `reveal`, `settlement`
**Fault Domain**: `settlement`
**Terminality**: `non_terminal` (MAY be `terminal` if retry policy prohibits retry)

### 5.5 PACT-5xx: Recursive / Dependency Failures

Recursive failures occur when external dependencies, cascading errors, or recursive system failures prevent progress.

**PACT-500**: `DEPENDENCY_FAILED` - Generic dependency failure
**PACT-501**: `DEPENDENCY_TIMEOUT` - Dependency operation exceeded timeout
**PACT-502**: `DEPENDENCY_UNAVAILABLE` - Dependency service unavailable
**PACT-503**: `DEPENDENCY_CASCADE` - Cascading failure from upstream dependency
**PACT-504`: `RECURSIVE_FAILURE` - Recursive system failure (internal error, infinite loop detection)
**PACT-505`: `TRANSCRIPT_STORAGE_FAILED` - Transcript storage or persistence failed
**PACT-506`: `EVIDENCE_COLLECTION_FAILED` - Evidence artifact collection failed

**Stage**: Any stage (implementation-dependent)
**Fault Domain**: `recursive`
**Terminality**: `terminal` (MAY be `non_terminal` for transient dependency failures)

## 6. Core Invariant

**Invariant 6.1: One Failure Event Per Failed Intent**

Every failed Pact Intent MUST emit exactly one FailureEvent.

**Normative Rules:**

1. An Intent that terminates without success MUST emit exactly one FailureEvent before termination
2. An Intent that succeeds MUST NOT emit a FailureEvent
3. Multiple FailureEvents for the same Intent MUST be treated as a protocol violation
4. FailureEvents MUST be emitted atomically with Intent termination
5. The FailureEvent MUST be included in the Intent transcript

**Rationale**: Deterministic failure attribution requires unambiguous failure classification. Multiple competing failure events would make blame assignment ambiguous and enable griefing.

## 7. Anti-Griefing & Default Blame Rules

This section defines default blame assignment rules to prevent strategic failure injection and griefing attacks.

### 7.1 Blame Assignment Principles

**Principle 7.1.1: Fail-Fast Attribution**

Failures MUST be attributed to the earliest detectable fault. Blame is assigned at the point of first detection, not at Intent termination.

**Principle 7.1.2: Default to Initiator**

When blame is ambiguous between buyer and seller, default blame MUST be assigned to the buyer (Intent initiator), unless evidence clearly indicates seller fault.

**Principle 7.1.3: Verifiable Evidence Required**

Blame assignment MUST be supported by verifiable evidence artifacts referenced in `evidence_refs`. Blame assignment without evidence is invalid.

### 7.2 Default Blame Rules

**Rule 7.2.1: Policy Violations**

Policy violations are attributed to the agent that violated the policy:
- Buyer policy violations: `fault_domain: policy`, blame: buyer
- Seller policy violations: `fault_domain: policy`, blame: seller
- Admission policy violations: `fault_domain: policy`, blame: seller (admission requirements apply to seller)

**Rule 7.2.2: Identity Failures**

Identity verification failures are attributed to the agent whose identity failed verification:
- Buyer identity failures: `fault_domain: identity`, blame: buyer
- Seller identity failures: `fault_domain: identity`, blame: seller

**Rule 7.2.3: Negotiation Deadlocks**

Negotiation deadlocks are attributed by timeout allocation:
- Buyer-initiated timeout: `fault_domain: negotiation`, blame: buyer
- Seller-initiated timeout: `fault_domain: negotiation`, blame: seller
- Mutual timeout: `fault_domain: negotiation`, blame: buyer (default to initiator per 7.1.2)

**Rule 7.2.4: Settlement Failures**

Settlement failures are attributed to the settlement rail provider:
- Buyer-funded settlements: `fault_domain: settlement`, blame: buyer
- Seller-funded settlements: `fault_domain: settlement`, blame: seller
- Escrow settlements: `fault_domain: settlement`, blame: escrow provider (if escrow failure) or default to buyer

**Rule 7.2.5: Dependency Failures**

Recursive dependency failures default to buyer unless evidence indicates seller fault:
- External dependency failures: `fault_domain: recursive`, blame: buyer (default per 7.1.2)
- Seller endpoint failures: `fault_domain: recursive`, blame: seller (evidence: endpoint unreachable)
- Buyer endpoint failures: `fault_domain: recursive`, blame: buyer (evidence: endpoint unreachable)

### 7.3 Griefing Prevention

**Rule 7.3.1: Invalid Failure Events**

An agent that emits an invalid FailureEvent (code mismatch, missing evidence, protocol violation) MUST be blamed for the failure, regardless of root cause.

**Rule 7.3.2: Evidence Tampering**

An agent that tampers with evidence artifacts referenced in `evidence_refs` MUST be blamed for the failure.

**Rule 7.3.3: Strategic Timeouts**

An agent that strategically times out to avoid unfavorable outcomes (detected via pattern analysis) MAY be blamed for the failure, even if timeout is technically valid.

**Implementation Note**: Strategic timeout detection is heuristic-based and SHOULD be conservative to avoid false positives.

## 8. Evidence Requirements

**Requirement 8.1: Minimum Evidence**

Every FailureEvent MUST include at least one evidence reference that enables independent verification of the failure condition.

**Requirement 8.2: Evidence Types**

Evidence references MAY include:
- Transcript IDs or hashes
- Envelope message hashes
- Settlement rail transaction IDs
- Credential proof hashes
- External system error logs (referenced, not included)

**Requirement 8.3: Evidence Verifiability**

Evidence artifacts MUST be verifiable by third parties without access to private keys or internal system state.

## 9. Protocol Compliance

**Compliance 9.1: Failure Event Emission**

Implementations MUST emit exactly one FailureEvent for every failed Intent, conforming to the schema defined in Section 3.

**Compliance 9.2: Error Code Assignment**

Implementations MUST assign error codes from the canonical families defined in Section 5. Custom error codes outside the PACT-XXX format are prohibited.

**Compliance 9.3: Blame Assignment**

Implementations MUST follow the default blame rules defined in Section 7.2, unless overridden by explicit policy.

**Compliance 9.4: Evidence Collection**

Implementations MUST collect and reference evidence artifacts sufficient to verify failure attribution, as specified in Section 8.

## 10. Arbitration Integration

### 10.1 Arbitration Terminality

When a Pact Intent enters arbitration, the transcript MUST include a `failure_event` with `terminality: "NEEDS_ARBITRATION"`. The transcript MUST also include an `arbiter_decision_ref` field (initially `null`, populated after decision).

**Rule 10.1.1: Arbitration Terminality State**

A transcript in `NEEDS_ARBITRATION` state:
- MUST NOT accept further rounds (transcript is append-only and terminal)
- MUST include `failure_event` with `terminality: "NEEDS_ARBITRATION"`
- Escrow funds are frozen pending arbiter decision
- No further negotiation rounds may be appended

### 10.2 Arbitration Decision Mapping

Arbitration outcomes (from `pact_arbiter_decision_v4.json` decision artifacts) MUST map deterministically to Failure Taxonomy codes:

| Arbitration Decision | Primary Reason Code | Failure Code | Rationale |
|---------------------|---------------------|--------------|-----------|
| RELEASE (policy violation by buyer confirmed) | `POLICY_VIOLATION_CONFIRMED` | PACT-101 | Policy violation confirmed by arbiter |
| REFUND (policy violation by provider confirmed) | `POLICY_VIOLATION_CONFIRMED` | PACT-101 | Policy violation confirmed by arbiter |
| RELEASE (provider delivered, buyer non-payment) | `BUYER_NON_PAYMENT` | PACT-404 | Settlement rail timeout confirmed |
| REFUND (provider non-delivery) | `PROVIDER_NON_DELIVERY` | PACT-404 | Settlement rail timeout confirmed |
| RELEASE (identity snapshot invalid at negotiation) | `IDENTITY_SNAPSHOT_INVALID` | PACT-201 | Identity/KYA failure confirmed |
| REFUND (identity snapshot invalid at settlement) | `IDENTITY_SNAPSHOT_INVALID` | PACT-201 | Identity/KYA failure confirmed |
| SPLIT (quality mismatch, partial delivery) | `QUALITY_MISMATCH` | PACT-404 | Settlement outcome ambiguous |
| REJECT_ARBITRATION (insufficient evidence) | `INSUFFICIENT_EVIDENCE` | PACT-303 | Deadlock leading to arbitration |

**Rule 10.2.1: Failure Code Selection**

The arbiter MUST select the failure code based on the **primary fault domain** identified in transcript evidence:

- **Policy violations** (buyer or provider) → PACT-1xx (typically 101)
- **Identity/KYA failures** → PACT-2xx (typically 201)
- **Deadlock/negotiation failures** → PACT-3xx (typically 303)
- **Settlement/timeout failures** → PACT-4xx (typically 404)
- **Recursive dependency failures** → PACT-5xx (typically 505)

### 10.3 Transcript Requirements for Arbitration

Any transcript that enters arbitration MUST:

1. Terminate with `failure_event` having `terminality: "NEEDS_ARBITRATION"`
2. Include `arbiter_decision_ref` field (initially `null`, populated after decision)
3. Reference escrow contract hash (if applicable)

**Rule 10.3.1: Decision Reference Attachment**

After arbiter issues decision:

- Decision artifact is stored (off-chain or on-chain registry)
- Transcript is updated to include `arbiter_decision_ref: <decision_id_hash>`
- Transcript MUST NOT be modified further (append-only invariant preserved)
- Transcript terminality is updated to reflect arbitration outcome (`arbitrated_release`, `arbitrated_refund`, `arbitrated_split`)

**Note:** The `arbiter_decision_ref` update does NOT invalidate transcript hash chain because it is appended after terminal `failure_event` and does not modify prior rounds.

### 10.4 Evidence Bundle Integration

Arbitration decisions reference evidence bundles via `evidence_refs` in the decision artifact. Evidence bundles MUST be hash-verifiable and conform to `EVIDENCE_BUNDLE.md` specification.

## 11. Versioning

This specification applies to Pact protocol version 4.0 and later.

Backward compatibility with v1, v2, and v3 failure codes is maintained via translation layer. Implementations MUST map legacy failure codes to PACT-XXX format during protocol migration.

---

**Status**: Draft (Normative)
**Last Updated**: 2025-01-XX
**Protocol Version**: pact/4.0
