# Passport Registry Specification v0

**Status:** Draft (Specification Only)  
**Version:** `passport-registry/0.0`  
**Applies to:** Passport v1 state computation and distribution

---

## Overview

The Passport Registry is a read-only, append-only distribution mechanism for agent reputation scores derived from Pact Protocol transcripts. It provides deterministic, recomputable reputation states without requiring a centralized write API.

**Key Principles:**
- **Deterministic:** Same transcripts → same passport states
- **Constitution-bound:** Updates only valid under recognized constitution hashes
- **Privacy-preserving:** No PII; only signer public keys
- **Read-only distribution:** Append-only broadcast; no write API in v0

### Non-Goals (v0)

The Passport Registry v0 explicitly does NOT provide:

- **No Marketplace:** Not a provider discovery or matching service
- **No Public Profiles:** Not a public-facing reputation display system
- **No Ranking UI:** Not a leaderboard or ranking interface
- **No Mutable Scores:** Scores are immutable once computed from transcripts
- **No Centralized Adjudication:** Beyond verifier outputs (DBL judgments), no centralized dispute resolution or score adjustments

**Rationale:** v0 focuses solely on deterministic state computation and distribution. Higher-level services (marketplaces, UIs, ranking systems) may be built on top of passport states, but are out of scope for the registry itself.

---

## 1. PassportState Schema

### 1.1 Core Schema

```json
{
  "version": "passport/1.0",
  "agent_id": "string (signer public key in base58)",
  "score": "number (bounded [-1, +1])",
  "counters": {
    "total_settlements": "number (non-negative integer)",
    "successful_settlements": "number (non-negative integer)",
    "disputes_lost": "number (non-negative integer)",
    "disputes_won": "number (non-negative integer)",
    "sla_violations": "number (non-negative integer)",
    "policy_aborts": "number (non-negative integer)"
  }
}
```

### 1.2 Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `version` | `"passport/1.0"` | Schema version identifier |
| `agent_id` | `string` | Canonical signer public key (base58-encoded Ed25519) |
| `score` | `number` | Reputation score bounded to [-1, +1] |
| `counters` | `object` | Transaction counters (all non-negative integers) |

### 1.3 Identity Rule

**Canonical identity for scoring and grouping is the signer public key:**
- Primary: `rounds[].signature.signer_public_key_b58`
- Fallback: `rounds[].public_key_b58`
- **NEVER** group by `rounds[].agent_id` (that is role/display only)

---

## 2. Update Event Schema

### 2.1 Update Event Structure

An update event is derived from a transcript and its DBL judgment:

```json
{
  "transcript_id": "string",
  "transcript_stable_id": "string",
  "constitution_hash": "string (SHA-256 hex)",
  "constitution_version": "string (e.g., 'constitution/1.0')",
  "signer_public_key_b58": "string",
  "transcript_summary": {
    "transcript_id": "string",
    "intent_id": "string",
    "created_at_ms": "number",
    "outcome": "success" | "abort" | "timeout" | "dispute" | "failure",
    "failure_code": "string (optional)",
    "failure_stage": "string (optional)",
    "failure_fault_domain": "string (optional)",
    "buyer_id": "string",
    "seller_id": "string"
  },
  "dbl_judgment": {
    "version": "string (e.g., 'dbl/2.0')",
    "status": "string",
    "dblDetermination": "string",
    "passportImpact": "number",
    "confidence": "number"
  },
  "delta": {
    "agent_id": "string",
    "score_delta": "number",
    "counters_delta": {
      "total_settlements": "number (optional)",
      "successful_settlements": "number (optional)",
      "disputes_lost": "number (optional)",
      "disputes_won": "number (optional)",
      "sla_violations": "number (optional)",
      "policy_aborts": "number (optional)"
    }
  }
}
```

### 2.2 Derivation Rules

1. **Transcript Summary:** Extracted from `TranscriptV4` using deterministic rules
2. **DBL Judgment:** Computed via `resolveBlameV1()` (Default Blame Logic v2)
3. **Delta:** Computed via `computePassportDelta()` using transcript summary + DBL judgment
4. **Constitution Hash:** From `gc_view.constitution.hash` (must be recognized/accepted)

---

## 3. Deterministic Recomputation Rules

### 3.1 Transcript Ordering

Transcripts MUST be processed in deterministic order:

1. Sort by `transcript_stable_id` (lexicographic)
   - Primary: `transcript.final_hash`
   - Fallback: `transcript.transcript_id`
   - Last resort: Canonical hash of transcript JSON

2. Deduplicate by `(transcript_stable_id, signer_public_key_b58)`
   - Prevents double-counting same transcript for same signer
   - Ensures idempotency

### 3.2 State Initialization

Initial state for any signer:

```json
{
  "version": "passport/1.0",
  "agent_id": "<signer_public_key_b58>",
  "score": 0,
  "counters": {
    "total_settlements": 0,
    "successful_settlements": 0,
    "disputes_lost": 0,
    "disputes_won": 0,
    "sla_violations": 0,
    "policy_aborts": 0
  }
}
```

### 3.3 Delta Application

For each transcript (in deterministic order):

1. Extract `transcript_summary` via `extractTranscriptSummary()`
2. Compute `dbl_judgment` via `resolveBlameV1()` (if available)
3. Compute `delta` via `computePassportDelta(transcript_summary, dbl_judgment, agent_id)`
4. Apply delta: `new_state = applyDelta(current_state, delta)`

### 3.4 Score Bounds

Score MUST be clamped to [-1, +1] after each delta application:

```typescript
newScore = currentScore + delta.score_delta
clampedScore = Math.max(-1, Math.min(1, newScore))
```

### 3.5 Recomputability Guarantee

**Invariant:** Given the same set of transcripts (same stable IDs, same order), the same initial state, and the same constitution hash, recomputation MUST produce identical passport states.

**Verification:** Use `pact-verifier passport-v1-recompute --transcripts-dir <dir>` to recompute and compare state hashes.

---

## 4. Constitution Binding

### 4.1 Constitution Hash Requirement

Every update event MUST include:
- `constitution_hash` — SHA-256 hash of the canonicalized CONSTITUTION_v1.md
- `constitution_version` — Version identifier (e.g., `"constitution/1.0"`)

### 4.2 Accepted Constitution Hashes

Only updates derived from transcripts verified under **accepted constitution hashes** are valid:

- `a0ea6fe329251b8c92112fd7518976a031eb8db76433e8c99c77060fc76d7d9d` (constitution/1.0)

### 4.3 Validation Rule

**Update events with non-standard constitution hashes MUST be rejected** unless explicitly allowed (e.g., via `--allow-nonstandard` flag in recompute CLI).

**Rationale:** Constitution hash determines the rules used for DBL judgment. Non-standard hashes indicate unknown or modified rules, making passport updates unreliable.

### 4.4 Constitution Hash in State

The passport state itself does NOT store the constitution hash (privacy/portability). However, update events MUST include it for validation.

---

## 5. Privacy Stance

### 5.1 No PII

The Passport Registry contains **no personally identifiable information**:
- ✅ Signer public keys (cryptographic identifiers)
- ✅ Transaction counters (aggregate statistics)
- ✅ Reputation scores (derived metrics)
- ❌ No names, emails, addresses, or other PII
- ❌ No transaction content or payloads
- ❌ No IP addresses or network identifiers

### 5.2 Signer Public Keys Only

Identity is established solely via signer public keys:
- `rounds[].signature.signer_public_key_b58` (primary)
- `rounds[].public_key_b58` (fallback)

**Agent IDs (`agent_id` field in rounds) are display/role labels only** and are NOT used for identity grouping.

### 5.3 Transcript Privacy

Passport computation requires transcript access, but:
- Passport states can be computed locally from transcripts
- No requirement to transmit transcripts to a central registry
- States can be shared without exposing underlying transcripts

---

## 6. Read-Only Distribution (v0)

### 6.1 Append-Only Broadcast

The Passport Registry v0 is a **read-only, append-only distribution mechanism**:

- ✅ **Read:** Query passport states by signer public key
- ✅ **Append:** New states broadcast as update events
- ❌ **No Write API:** No centralized endpoint to submit updates
- ❌ **No Mutations:** States are immutable once computed

### 6.2 Distribution Model

**Conceptual model (v0):**

1. **Local Computation:** Each party computes passport states from their transcript collection
2. **State Broadcast:** Computed states are broadcast (via any channel: file, API, blockchain, etc.)
3. **Independent Verification:** Recipients can recompute states from transcripts to verify broadcasts
4. **Consensus via Recompute:** Disagreements resolved by recomputing from source transcripts

### 6.3 No Central Authority

v0 does NOT require:
- Centralized registry server
- Write permissions or authentication
- Consensus protocol for state updates
- Transaction ordering service

**Any party with transcripts can compute and broadcast passport states.**

### 6.4 Future Evolution (v1+)

Future versions may introduce:
- Write APIs with authentication
- Consensus mechanisms for state ordering
- Centralized or decentralized registry infrastructure

**v0 establishes the foundation:** deterministic recomputation enables any distribution model.

---

## 7. CLI Reference

### 7.1 Recompute Command

```bash
pact-verifier passport-v1-recompute --transcripts-dir <dir> [--signer <pubkey>] [--out <file>]
```

**Output format:**

```json
{
  "version": "passport/1.0",
  "generated_from": {
    "transcripts_dir": "string",
    "count": "number"
  },
  "states": {
    "<signer_public_key_b58>": {
      "agent_id": "string",
      "score": "number",
      "counters": {
        "total_settlements": "number",
        "successful_settlements": "number",
        "disputes_lost": "number",
        "disputes_won": "number",
        "sla_violations": "number",
        "policy_aborts": "number"
      },
      "included_transcripts": ["string (stable IDs)"],
      "state_hash": "string (SHA-256 hex)"
    }
  }
}
```

### 7.2 State Hash Computation

The `state_hash` is computed via canonical JSON serialization:

```typescript
state_hash = SHA256(canonicalJSON({
  version: state.version,
  agent_id: state.agent_id,
  score: state.score,
  counters: state.counters
}))
```

**Purpose:** Enables deterministic comparison of passport states across different recomputations.

---

## 8. Update Event Examples

### 8.1 Success Transaction

```json
{
  "transcript_id": "transcript-...",
  "transcript_stable_id": "...",
  "constitution_hash": "a0ea6fe329251b8c...",
  "constitution_version": "constitution/1.0",
  "signer_public_key_b58": "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
  "transcript_summary": {
    "outcome": "success",
    "buyer_id": "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
    "seller_id": "HBUkwmmQVFX3mGF6ris1mWDATY27nAupX6wQNXgJD9j9"
  },
  "dbl_judgment": {
    "dblDetermination": "NO_FAULT",
    "passportImpact": 0.01
  },
  "delta": {
    "agent_id": "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
    "score_delta": 0.01,
    "counters_delta": {
      "total_settlements": 1,
      "successful_settlements": 1
    }
  }
}
```

### 8.2 Policy Abort

```json
{
  "transcript_id": "transcript-...",
  "constitution_hash": "a0ea6fe329251b8c...",
  "constitution_version": "constitution/1.0",
  "signer_public_key_b58": "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
  "transcript_summary": {
    "outcome": "abort",
    "failure_code": "PACT-101"
  },
  "dbl_judgment": {
    "dblDetermination": "BUYER_AT_FAULT",
    "passportImpact": -0.05
  },
  "delta": {
    "agent_id": "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
    "score_delta": -0.01,
    "counters_delta": {
      "policy_aborts": 1
    }
  }
}
```

---

## 9. Compliance Requirements

### 9.1 Deterministic Recomputability

Any passport state MUST be recomputable from transcripts using:
- Same transcript set (by stable ID)
- Same processing order (lexicographic by stable ID)
- Same constitution hash
- Same initial state (all zeros)

**Verification:** Run `pact-verifier passport-v1-recompute` and compare `state_hash` values.

### 9.2 Constitution Hash Validation

Update events MUST be rejected if:
- `constitution_hash` is missing
- `constitution_hash` is not in the accepted list
- `constitution_version` does not match expected version

**Exception:** `--allow-nonstandard` flag may bypass this check for testing/debugging.

### 9.3 Privacy Compliance

Passport states MUST NOT contain:
- PII (names, emails, addresses, etc.)
- Transaction content or payloads
- Network identifiers (IP addresses, etc.)

**Only signer public keys and aggregate counters are permitted.**

---

## 10. Future Considerations

### 10.1 Write API (v1+)

Future versions may introduce:
- Authenticated write endpoints
- Update event submission API
- Real-time state synchronization

### 10.2 Consensus Mechanisms

Future versions may require:
- Transaction ordering consensus
- State conflict resolution
- Multi-party state validation

### 10.3 Extended Metadata

Future versions may include:
- Timestamps for state snapshots
- Update event provenance chains
- Cross-registry state references

**v0 establishes the foundation:** deterministic recomputation enables any future evolution.

---

## References

- **CLI Implementation:** `pact-verifier passport-v1-recompute` (see `packages/verifier/src/cli/passport_v1_recompute.ts`)
- **Constitution:** `CONSTITUTION_v1.md` — Rules of evidence and responsibility attribution
- **DBL v2:** Default Blame Logic v2 judgment artifacts
- **Transcript v4:** `pact-transcript/4.0` format specification
