# Pact Transcript Schema v4

**Protocol Identifier**: pact-transcript/4.0  
**Status**: Draft (Normative)  
**Legal Admissibility**: Designed for court and arbitration proceedings

## 1. Overview

Pact v4 transcripts are **append-only**, **hash-linked**, and **deterministic**. Every transcript is an immutable audit trail of a Pact Intent negotiation, suitable for legal evidence and dispute resolution.

### 1.1 Core Properties

1. **Append-Only**: Once a round is appended to `rounds[]`, it MUST NOT be modified or removed
2. **Hash-Linked**: Each round references the hash of the previous round, forming a cryptographic chain
3. **Deterministic**: Two identical negotiations MUST produce identical transcript hashes
4. **Signed**: Every round includes a cryptographic signature enabling non-repudiation
5. **Terminal on Failure**: If `failure_event` exists, transcript is terminal and immutable

### 1.2 Legal Requirements

This schema is designed for legal admissibility:

- **Immutable**: Transcript structure prevents tampering
- **Verifiable**: Cryptographic hashes enable independent verification
- **Traceable**: Hash chain enables audit of all modifications
- **Non-Repudiable**: Signatures prevent denial of round creation
- **Deterministic**: Identical negotiations produce identical hashes (enables comparison)

## 2. Deterministic Serialization

To ensure two identical negotiations produce identical transcript hashes, serialization MUST follow strict rules.

### 2.1 Canonical JSON Serialization

**Rule 2.1.1: JSON Serialization**

All transcript data MUST be serialized using **canonical JSON** with the following constraints:

1. **No Whitespace**: JSON MUST be serialized with no whitespace between tokens (no spaces, no newlines)
2. **Sorted Keys**: Object keys MUST be sorted lexicographically (UTF-8 byte order)
3. **No Trailing Zeros**: Floating-point numbers MUST NOT include trailing zeros (e.g., `1.0` → `1`, but `1.01` → `1.01`)
4. **No Precision Loss**: Numeric precision MUST be preserved (use sufficient decimal places)
5. **UTF-8 Encoding**: All strings MUST be UTF-8 encoded

**Example Canonical JSON:**

```json
{"a":1,"b":2,"c":3}
```

**NOT Canonical:**

```json
{
  "a": 1,
  "b": 2,
  "c": 3
}
```

### 2.2 Hash Computation Order

**Rule 2.2.1: Transcript Hash Computation**

The `final_hash` of a transcript MUST be computed as:

```
SHA-256(canonical_json(transcript_without_final_hash))
```

Where `transcript_without_final_hash` is the complete transcript object with the `final_hash` field excluded.

**Rule 2.2.2: Round Hash Computation**

The `round_hash` of a round MUST be computed as:

```
SHA-256(canonical_json(round_without_round_hash))
```

Where `round_without_round_hash` is the complete round object with the `round_hash` field excluded.

**Rule 2.2.3: Previous Round Hash**

The `previous_round_hash` field in round `i` MUST be:

- **Round 0**: `SHA-256(canonical_json(intent_id + created_at_ms))`
- **Round i > 0**: `round_hash` from round `i-1`

This creates a hash chain: `round[i].previous_round_hash === round[i-1].round_hash`

### 2.3 Policy, Strategy, and Identity Hash Computation

**Rule 2.3.1: Policy Hash**

`policy_hash` MUST be computed as:

```
SHA-256(canonical_json(policy_object))
```

Where `policy_object` is the complete buyer policy at negotiation start, serialized canonically.

**Rule 2.3.2: Strategy Hash**

`strategy_hash` MUST be computed as:

```
SHA-256(canonical_json(strategy_config))
```

Where `strategy_config` includes all strategy parameters affecting negotiation behavior:
- Strategy type (e.g., "banded_concession", "baseline")
- Strategy parameters (e.g., concession rates, band widths)
- Round limits
- Timeout values

**Rule 2.3.3: Identity Snapshot Hash**

`identity_snapshot_hash` MUST be computed as:

```
SHA-256(canonical_json(identity_snapshot))
```

Where `identity_snapshot` includes all identity attributes relevant to policy evaluation:
- Credentials (type, issuer, expiration)
- Trust scores
- Trust tiers
- Reputation signals
- Passport data (if applicable)

**Note**: Identity snapshot MUST be captured at negotiation start and MUST NOT change during negotiation. Changes to identity during negotiation MUST result in new Intent.

### 2.4 Field Exclusion for Hash Computation

**Rule 2.4.1: Metadata Exclusion**

The `metadata` field MUST NOT be included in hash computations. Metadata is for human readability and MUST NOT affect deterministic behavior.

**Rule 2.4.2: Content Summary Exclusion**

The `content_summary` field in rounds MUST NOT be included in `round_hash` computation. Content summary is for human readability only.

**Rule 2.4.3: Final Hash Exclusion**

The `final_hash` field MUST NOT be included in `final_hash` computation (prevents circular dependency).

## 3. Transcript Lifecycle

### 3.1 Creation

**Step 3.1.1: Initial Transcript**

When an Intent is created, initialize transcript:

```json
{
  "transcript_version": "pact-transcript/4.0",
  "transcript_id": "transcript-<SHA256(intent_id + created_at_ms)>",
  "intent_id": "<intent_id>",
  "intent_type": "<intent_type>",
  "created_at_ms": <timestamp>,
  "policy_hash": "<SHA256(canonical_policy)>",
  "strategy_hash": "<SHA256(canonical_strategy)>",
  "identity_snapshot_hash": "<SHA256(canonical_identity)>",
  "rounds": []
}
```

### 3.2 Round Appending

**Step 3.2.1: Round Creation**

When a protocol message (INTENT, ASK, BID, COUNTER, ACCEPT, REJECT, ABORT) is received:

1. Compute `message_hash = SHA-256(canonical_json(message_content))`
2. Compute `envelope_hash = SHA-256(canonical_json(complete_envelope))`
3. Extract signature from envelope
4. Compute `previous_round_hash`:
   - If `rounds.length === 0`: `SHA-256(intent_id + created_at_ms)`
   - Otherwise: `rounds[rounds.length - 1].round_hash`
5. Create round object (excluding `round_hash`)
6. Compute `round_hash = SHA-256(canonical_json(round))`
7. Append round to `rounds[]` array

**Rule 3.2.1: Append-Only Invariant**

Once a round is appended to `rounds[]`, it MUST NOT be:
- Modified
- Removed
- Reordered

### 3.3 Termination

**Step 3.3.1: Successful Termination**

When negotiation completes successfully:

1. Final round (ACCEPT) is appended
2. Compute `final_hash = SHA-256(canonical_json(transcript_without_final_hash))`
3. Set `final_hash` field
4. Transcript is terminal and immutable

**Step 3.3.2: Failure Termination**

When negotiation fails:

1. Create `FailureEvent` object (see FAILURE_TAXONOMY.md)
2. Compute `failure_event.transcript_hash = SHA-256(canonical_json(transcript_up_to_failure))`
3. Set `failure_event` field
4. Compute `final_hash = SHA-256(canonical_json(transcript_without_final_hash))`
5. Set `final_hash` field
6. Transcript is terminal and immutable

**Rule 3.3.1: Terminal Invariant**

Once `failure_event` is set, no further rounds MAY be appended. Transcript MUST be terminal.

## 4. Validation Rules

### 4.1 Structural Validation

**Rule 4.1.1: Required Fields**

Transcript MUST include all required fields:
- `transcript_version`
- `transcript_id`
- `intent_id`
- `intent_type`
- `created_at_ms`
- `policy_hash`
- `strategy_hash`
- `identity_snapshot_hash`
- `rounds`

**Rule 4.1.2: Final Hash Requirement**

If transcript is terminal (`failure_event` exists or negotiation completed), `final_hash` MUST be present.

### 4.2 Hash Chain Validation

**Rule 4.2.1: Round Sequence**

`rounds[i].round_number` MUST equal `i` (zero-indexed, sequential, no gaps).

**Rule 4.2.2: Previous Round Hash Validation**

For `i > 0`, `rounds[i].previous_round_hash` MUST equal `rounds[i-1].round_hash`.

**Rule 4.2.3: First Round Hash**

`rounds[0].previous_round_hash` MUST equal `SHA-256(canonical_json(intent_id + created_at_ms))`.

**Rule 4.2.4: Timestamp Monotonicity**

`rounds[i].timestamp_ms >= rounds[i-1].timestamp_ms` for all `i > 0` (timestamps MUST be non-decreasing).

### 4.3 Signature Validation

**Rule 4.3.1: Signature Verification**

For each round, the signature MUST verify:
- `verify_signature(round.signature, round.envelope_hash, round.public_key_b58)` MUST return `true`
- Signature scheme MUST be Ed25519
- Public key MUST match `signature.signer_public_key_b58`

### 4.4 Failure Event Validation

**Rule 4.4.1: Failure Event Terminality**

If `failure_event` exists:
- `rounds[]` array MUST NOT be modified after `failure_event` is set
- `final_hash` MUST be present
- `failure_event.code` MUST match pattern `^PACT-[1-5][0-9]{2}$`
- `failure_event.stage` MUST be valid Stage enumeration
- `failure_event.fault_domain` MUST be valid FaultDomain enumeration
- `failure_event.terminality` MUST be valid Terminality enumeration

**Rule 4.4.2: Failure Event Hash**

`failure_event.transcript_hash` MUST equal the hash of the transcript up to and including the failure point (excluding `failure_event` and `final_hash`).

### 4.5 Deterministic Hash Validation

**Rule 4.5.1: Transcript Hash Verification**

If `final_hash` is present, it MUST equal:
```
SHA-256(canonical_json(transcript_without_final_hash))
```

**Rule 4.5.2: Round Hash Verification**

For each round, `round.round_hash` MUST equal:
```
SHA-256(canonical_json(round_without_round_hash))
```

## 5. v3 to v4 Upgrade Path

### 5.1 Overview

Pact v3 transcripts (TranscriptV1) can be upgraded to v4 format. The upgrade process MUST preserve all original data and enable backward compatibility.

### 5.2 Upgrade Process

**Step 5.2.1: Extract Core Fields**

From v3 transcript, extract:
- `intent_id`
- `intent_type`
- `timestamp_ms` (from `timestamp_ms` or first protocol message)
- Policy object (reconstruct from negotiation context)
- Strategy config (reconstruct from `negotiation.strategy` and parameters)
- Identity snapshot (reconstruct from `credential_checks`, `zk_kya`, `wallet`)

**Step 5.2.2: Compute Hash Fields**

Compute v4 hash fields:
- `policy_hash = SHA-256(canonical_json(reconstructed_policy))`
- `strategy_hash = SHA-256(canonical_json(reconstructed_strategy))`
- `identity_snapshot_hash = SHA-256(canonical_json(reconstructed_identity))`

**Step 5.2.3: Reconstruct Rounds**

From v3 transcript, reconstruct rounds:

1. **Round 0 (INTENT)**: From `input` field, create INTENT round
2. **Round 1+ (ASK/BID/COUNTER)**: From `negotiation_rounds[]` array, create ASK/BID/COUNTER rounds
3. **Final Round (ACCEPT/REJECT/ABORT)**: From `outcome` and `negotiation` fields, determine final round type

**Step 5.2.4: Extract Envelopes and Signatures**

From v3 `explain.decisions[]`, extract envelope data:
- Extract `envelope` or `quote_envelope` from decision `meta`
- Extract signature from envelope
- Compute `message_hash` and `envelope_hash`

**Step 5.2.5: Build Hash Chain**

For each round `i`:
- Compute `previous_round_hash` (round 0 uses intent_id, others use previous round hash)
- Compute `round_hash`
- Verify hash chain integrity

**Step 5.2.6: Handle Failure Events**

If v3 `outcome.ok === false`:
- Map v3 `outcome.code` to PACT-XXX format (see mapping below)
- Determine `stage` from negotiation phase
- Determine `fault_domain` from failure code
- Create `FailureEvent` object
- Compute `failure_event.transcript_hash`

**Step 5.2.7: Compute Final Hash**

After all rounds are reconstructed:
- Compute `final_hash = SHA-256(canonical_json(transcript_without_final_hash))`
- Set `final_hash` field

### 5.3 Failure Code Mapping

v3 failure codes MUST be mapped to v4 PACT-XXX format:

| v3 Code | v4 Code | Notes |
|---------|---------|-------|
| `INTENT_EXPIRED` | `PACT-101` | Policy violation |
| `MISSING_REQUIRED_CREDENTIALS` | `PACT-201` | Identity violation |
| `CREDENTIAL_EXPIRED` | `PACT-202` | Identity violation |
| `ROUND_EXCEEDED` | `PACT-306` | Negotiation violation |
| `DURATION_EXCEEDED` | `PACT-301` | Negotiation timeout |
| `SETTLEMENT_FAILED` | `PACT-400` | Settlement failure |
| `LATENCY_BREACH` | `PACT-407` | Settlement SLA violation |
| `ZK_KYA_REQUIRED` | `PACT-210` | Identity requirement |
| `ZK_KYA_INVALID` | `PACT-211` | Identity verification failure |

**Note**: Complete mapping table to be maintained in v4 implementation documentation.

### 5.4 Backward Compatibility

**Rule 5.4.1: v3 Transcript Preservation**

Original v3 transcripts MUST be preserved unmodified. Upgrade creates new v4 transcript alongside v3 transcript.

**Rule 5.4.2: Upgrade Verification**

Upgraded v4 transcripts MUST be verifiable:
- Hash chain MUST be valid
- Signatures MUST verify
- All v3 data MUST be preserved (may be in `metadata` or `content_summary` fields)

**Rule 5.4.3: Data Loss Prevention**

Upgrade process MUST NOT lose information. All v3 fields MUST be preserved, either in v4 structure or in `metadata` field.

### 5.5 Upgrade Limitations

**Limitation 5.5.1: Missing Envelope Data**

If v3 transcript lacks envelope data (e.g., `explain.decisions` is empty), upgrade MAY be incomplete:
- `envelope_hash` may be missing or reconstructed
- Signature verification may be impossible

**Limitation 5.5.2: Round Order**

If v3 `negotiation_rounds[]` is incomplete or out of order, upgrade MAY produce incorrect hash chain.

**Limitation 5.5.3: Policy Reconstruction**

If policy was not stored in v3 transcript, policy reconstruction MAY be inaccurate. Upgrade SHOULD include policy source reference in `metadata`.

## 6. Legal Considerations

### 6.1 Admissibility

This schema is designed for legal admissibility:

- **Immutable Structure**: Append-only design prevents tampering
- **Cryptographic Verification**: Hashes enable independent verification
- **Non-Repudiation**: Signatures prevent denial of authorship
- **Deterministic**: Identical negotiations produce identical hashes

### 6.2 Evidence Chain

Transcripts provide a complete evidence chain:

1. **Intent Origin**: `intent_id`, `created_at_ms`, `policy_hash`, `strategy_hash`
2. **Negotiation History**: `rounds[]` array with signatures and hash chain
3. **Termination**: `final_hash` or `failure_event` with evidence references
4. **Verification**: Hash chain enables independent verification of transcript integrity

### 6.3 Audit Trail

Every modification to transcript (round appending) is recorded:
- `round_hash` in each round
- `previous_round_hash` linking to previous round
- `final_hash` for complete transcript

Any tampering attempt will break the hash chain and be detectable.

## 7. Implementation Notes

### 7.1 Canonical JSON Libraries

Implementations SHOULD use well-tested canonical JSON libraries:
- **Rust**: `serde_json` with custom serializer
- **JavaScript/TypeScript**: Custom serializer or `json-stable-stringify` with modifications
- **Python**: Custom serializer or `ujson` with modifications

**Warning**: Standard JSON libraries (e.g., `JSON.stringify`) are NOT canonical and MUST NOT be used for hash computation.

### 7.2 Hash Computation Performance

For large transcripts:
- Hash computation may be expensive (O(n) where n is transcript size)
- Consider caching intermediate hashes
- `final_hash` computation MUST happen after transcript is complete

### 7.3 Storage Considerations

- Transcripts are append-only but may grow large
- Consider separate storage for `rounds[]` array if size is a concern
- `final_hash` enables incremental verification (verify hash chain, then verify final_hash)

---

**Status**: Draft (Normative)  
**Last Updated**: 2025-01-XX  
**Protocol Version**: pact-transcript/4.0
