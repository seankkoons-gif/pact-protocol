# Passport v1 + Pact v4 Integration

**Status**: Draft (Normative)  
**Applies to**: Pact Passport v1, Pact v4 transcripts, v4 Failure Taxonomy, v4 Replayer

## Overview

Pact Passport v1 integrates with Pact v4 artifacts (transcript schema, failure taxonomy, replayer) to provide reputation-based policy gating and audit trails for negotiations.

## Architecture

```
Pact v4 Negotiation
    ↓
Transcript (with policy_hash, strategy_hash, identity_snapshot_hash)
    ↓
FailureEvent (with evidence_refs) [if failed]
    ↓
Passport Ingestion → Passport Storage
    ↓
Passport Scoring (deterministic, reproducible)
    ↓
Policy Gate (requirePassport) → PassportPolicyResult
    ↓
Replayer Display (PassportReplayContext)
```

## Transcript Schema Integration

Pact v4 transcripts MUST include the following fields for Passport integration:

### Required Fields

```typescript
interface TranscriptV4 {
  transcript_version: "pact-transcript/4.0";
  transcript_id: string;
  intent_id: string;
  intent_type: string;
  created_at_ms: number;
  
  // Required for Passport integration
  policy_hash: string;              // SHA-256 hash of policy used
  strategy_hash: string;             // SHA-256 hash of negotiation strategy
  identity_snapshot_hash: string;    // SHA-256 hash of identity snapshot
  
  rounds: TranscriptRound[];
  failure_event?: FailureEvent;      // Terminal outcome or failure
  final_hash?: string;
  metadata?: Record<string, unknown>;
}
```

### Policy Hash

The `policy_hash` field enables Passport to determine which policy constraints were active during negotiation. This is critical for:
- Reproducing policy checks at replay time
- Auditing which policy version was used
- Linking policy constraints to Passport score changes

### Strategy Hash

The `strategy_hash` field enables Passport to correlate negotiation strategies with outcomes. This helps:
- Understand if strategy changes affect success rates
- Detect strategic gaming patterns
- Improve strategy recommendations

### Identity Snapshot Hash

The `identity_snapshot_hash` field enables Passport to link agent identity state to negotiation outcomes. This supports:
- Tracking identity changes over time
- Correlating identity verification failures with Passport scores
- Audit trail of identity state at negotiation time

## Failure Event Integration

Pact v4 FailureEvents MUST include `evidence_refs` that the replayer can resolve:

```typescript
interface FailureEvent {
  code: string;                    // PACT-XXX format
  stage: string;                   // Protocol stage at detection
  fault_domain: string;            // Responsible subsystem
  terminality: "terminal" | "non_terminal";
  evidence_refs: string[];         // REQUIRED: References to verifiable artifacts
  timestamp: number;               // Unix timestamp (milliseconds)
  transcript_hash: string;         // SHA-256 hash of transcript up to failure
}
```

### Evidence References

The `evidence_refs` array MUST contain at least one reference that enables independent verification:

- **Transcript IDs**: Reference to related transcripts (e.g., `transcript:abc123`)
- **Envelope Hashes**: SHA-256 hashes of protocol messages (e.g., `envelope:def456`)
- **Round Hashes**: References to specific negotiation rounds (e.g., `round:3:ghi789`)
- **Settlement Rail IDs**: Transaction IDs from settlement providers (e.g., `stripe:ch_xyz`)
- **Credential Proof Hashes**: Hashes of credential verification proofs (e.g., `credential:jkl012`)

The replayer MUST be able to resolve these references to display evidence in audit views.

## Passport Policy Gate Integration

### Stable Reason Codes

Passport policy helper (`requirePassport`) returns stable reason codes for denial:

```typescript
type PassportDenialReason =
  | "LOW_SCORE"                    // Score below minimum threshold
  | "LOW_CONFIDENCE"               // Confidence below minimum threshold
  | "INSUFFICIENT_HISTORY"         // Bootstrap condition: < 3 transactions
  | "DISPUTE_FLAGGED"              // Recent dispute losses detected
  | "RECENT_POLICY_VIOLATION";     // Recent PACT-1xx failures detected
```

These codes are stable across Passport versions and MUST be used by policy gates for denial handling.

### Policy Result Structure

```typescript
interface PassportPolicyResult {
  pass: boolean;
  reason?: PassportDenialReason;
  score?: number;
  confidence?: number;
  min_score_required?: number;
  min_confidence_required?: number;
  triggering_factor?: string;      // Human-readable factor that triggered denial
}
```

The `triggering_factor` field provides a human-readable explanation (e.g., "PACT-101 failure in policy domain (2025-01-15)") that the Replayer can display.

## Replayer Integration

### Passport Replay Context

The Replayer uses `getPassportReplayContext()` to display Passport scores and policy gate triggers:

```typescript
interface PassportReplayContext {
  agent_id: string;
  score_at_negotiation: number | null;      // Score at time of negotiation
  confidence_at_negotiation: number | null; // Confidence at negotiation time
  available: boolean;                        // Whether Passport was available
  policy_check?: PassportPolicyResult;      // Policy check result (if performed)
  triggering_factor?: string;               // Factor that triggered denial
  computed_as_of: number;                   // Timestamp used for score computation
}
```

### Display in Replayer

The Replayer SHOULD display:

1. **Passport Score**: If available at negotiation time, show score and confidence
2. **Policy Gate Trigger**: If policy check was performed, show:
   - Whether check passed or failed
   - Denial reason code (if failed)
   - Triggering factor (human-readable)
3. **Score Breakdown**: Link to full Passport breakdown for audit

### Narrative Generation

Use `narratePassportDenial()` to generate human-readable narratives:

```typescript
const narrative = narratePassportDenial(policyResult);
// Example: "Passport policy gate denied: Agent score 45.2 is below required minimum 60. 
//          Triggering factor: PACT-101 failure in policy domain (2025-01-15)."
```

## Determinism and Reproducibility

### Score Computation Determinism

Passport scores MUST be deterministic and reproducible:

1. **Same Inputs → Same Score**: Given identical event history, the score MUST be identical
2. **Timestamp Reproducibility**: Using `as_of` timestamp, scores MUST be reproducible at any point in time
3. **No Randomness**: Score computation MUST NOT use random number generation or non-deterministic operations

### Evidence Chain Integrity

The integration maintains evidence chain integrity:

1. **Transcript Hash**: Every transcript has a deterministic hash
2. **Failure Event Hash**: Failure events reference transcript hash
3. **Passport Event Hash**: Passport events reference transcript_hash for idempotency
4. **Score Computation**: Scores reference specific timestamps for reproducibility

### Audit Trail

The integration provides complete audit trails:

1. **Transcript → Passport Event**: Each transcript outcome creates Passport events (idempotent)
2. **Passport Event → Score**: Scores are computed from events with full breakdown
3. **Score → Policy Result**: Policy checks reference specific scores and reasons
4. **Policy Result → Replayer**: Replayer displays context and triggering factors

## Example Workflow

### 1. Negotiation with Passport Policy Gate

```typescript
// During negotiation admission phase
const passportCheck = requirePassport(
  storage,
  providerAgentId,
  60,    // min_score: 60
  0.5    // min_confidence: 0.5
);

if (!passportCheck.pass) {
  // Deny negotiation with stable reason code
  return {
    outcome: "REJECTED",
    failure_event: {
      code: "PACT-200", // IDENTITY_VERIFICATION_FAILED
      stage: "admission",
      fault_domain: "identity",
      terminality: "terminal",
      evidence_refs: [`transcript:${transcript_id}`, `passport:${passportCheck.reason}`],
      timestamp: Date.now(),
      transcript_hash: computeTranscriptHash(transcript)
    }
  };
}
```

### 2. Transcript Ingestion

```typescript
// After negotiation completes (success or failure)
const result = ingestTranscriptOutcome(storage, transcript);
// Creates Passport events (idempotent on transcript_hash)
```

### 3. Replayer Display

```typescript
// In Replayer, display Passport context
const context = getPassportReplayContext(
  storage,
  transcript,
  60,    // min_score (if policy was enforced)
  0.5    // min_confidence (if policy was enforced)
);

if (context.available) {
  console.log(`Passport Score: ${context.score_at_negotiation} (confidence: ${context.confidence_at_negotiation})`);
}

if (context.policy_check && !context.policy_check.pass) {
  console.log(narratePassportDenial(context.policy_check));
  // "Passport policy gate denied: Agent score 45.2 is below required minimum 60.
  //  Triggering factor: PACT-101 failure in policy domain (2025-01-15)."
}
```

## Compliance

### Requirements

1. **Transcript Schema**: MUST include `policy_hash`, `strategy_hash`, `identity_snapshot_hash`
2. **Failure Events**: MUST include `evidence_refs` array (non-empty)
3. **Reason Codes**: Policy gates MUST use stable reason codes (`LOW_SCORE`, `LOW_CONFIDENCE`, etc.)
4. **Replayer Integration**: Replayer SHOULD display Passport context when available
5. **Determinism**: Scores MUST be deterministic and reproducible

### Testing

All integrations MUST be tested for:

1. **Determinism**: Same inputs produce same outputs
2. **Stable Output**: Reason codes and triggering factors are stable across versions
3. **Evidence Resolution**: Replayer can resolve all `evidence_refs`
4. **Timestamp Reproducibility**: Scores are reproducible using `as_of` timestamps

## Future Enhancements

Future v2 enhancements MAY include:

- **Real-time Score Updates**: Scores updated during negotiation (not just post-hoc)
- **Multi-Agent Context**: Passport context for both buyer and seller
- **Policy Hash Verification**: Verify policy_hash matches actual policy used
- **Strategy Correlation**: Link strategy_hash to success rates in Passport breakdown

---

**Status**: Draft (Normative)  
**Last Updated**: 2025-01-XX  
**Protocol Versions**: pact/4.0, pact-passport/4.0
