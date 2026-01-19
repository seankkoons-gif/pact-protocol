# Pact v4 Transcript Redaction & View Model

Protocol Identifier: pact-transcript-redaction/4.0  
Status: Draft (Normative)  
Scope: Structural redaction of Pact v4 transcripts for cross-trust-boundary sharing.

## 1. Design Goals

Pact v4 Transcript Redaction enables sharing transcripts and evidence bundles across trust boundaries while preserving:

1. **Cryptographic Integrity**: Redaction does not invalidate transcript root hash, signature chain, or decision artifact verification
2. **Deterministic Replay**: Redacted transcripts can be replayed deterministically (same transcript + view → same redacted output)
3. **Evidentiary Validity**: Redacted transcripts remain admissible as evidence in arbitration and legal proceedings

## 2. Redaction Philosophy

### 2.1 Structural Redaction (Not Encryption)

Redaction is **structural**, not cryptographic:

- Redacted fields are replaced with `{ redacted: true, hash: <hash-of-original> }`
- Original content is not encrypted or obfuscated
- Redaction preserves hash lineage for verification
- Redaction is deterministic (same input → same output)

### 2.2 Non-Negotiable Invariants

Redaction MUST NOT invalidate:

1. **Transcript Root Hash**: `transcript.transcript_id` remains unchanged
2. **Signature Chain**: All signatures remain valid and verifiable
3. **Decision Artifact Verification**: Arbitration decisions remain verifiable
4. **Hash Lineage**: Redacted fields include hash of original content for proof of inclusion

### 2.3 Proof of Inclusion

Redacted fields MUST include:

- `redacted: true` flag
- `hash: <sha256-of-original-content>` for proof of inclusion
- `view: <view-type>` for auditability

This allows:

- **Proof of Inclusion**: Verifier can confirm original content was present
- **Proof of Non-Tampering**: Hash proves original content was not modified
- **Audit Trail**: View type recorded for compliance

## 3. Canonical Views

### 3.1 INTERNAL View

**Purpose**: Full transcript for internal use, debugging, and complete audit.

**Preserves**:
- Full transcript (all rounds, all fields)
- Full policy hash + strategy hash
- All pricing and negotiation detail
- All evidence references
- Complete failure taxonomy
- Full Passport score breakdown

**Redacts**: Nothing (full transcript)

**Use Cases**:
- Internal debugging
- Complete audit trails
- Development and testing
- Full compliance verification

### 3.2 PARTNER View

**Purpose**: Share with counterparty or trusted partner while hiding proprietary details.

**Preserves**:
- Transcript hash lineage (`transcript_id`, round hashes)
- Terminal outcome (success/failure)
- Failure taxonomy (code, stage, fault_domain)
- Arbitration decision (if present)
- Settlement mode and outcome
- Evidence references (structure, not content)

**Redacts**:
- Exact policy values (policy hash preserved, content redacted)
- Internal strategy details (strategy hash preserved, content redacted)
- Non-relevant negotiation branches (failed counteroffers)
- Proprietary pricing logic
- Passport score breakdown (score preserved, breakdown redacted)

**Use Cases**:
- Sharing with counterparty for dispute resolution
- Partner integrations
- Cross-organization audit
- Regulatory reporting (partial)

### 3.3 AUDITOR View

**Purpose**: Share with external auditors or regulators while proving compliance without revealing proprietary information.

**Preserves**:
- Proof of compliance (policy satisfaction, not policy content)
- Transcript hash lineage
- Terminal outcome
- Failure taxonomy
- Arbitration decision
- Passport score snapshot (score only, no breakdown)
- Evidence references (structure)

**Redacts**:
- Policy content (policy hash preserved)
- Strategy identity and details
- Proprietary pricing logic
- Negotiation detail (round-by-round)
- Passport score breakdown
- Internal evidence content

**Use Cases**:
- External audit
- Regulatory compliance
- Public transparency (if applicable)
- Third-party verification

## 4. Redaction Rules

### 4.1 Field-Level Redaction

**Rule 4.1.1: Redacted Field Structure**

Redacted fields MUST be replaced with:

```json
{
  "redacted": true,
  "hash": "<sha256-of-original-content>",
  "view": "<INTERNAL|PARTNER|AUDITOR>"
}
```

**Rule 4.1.2: Hash Computation**

Hash MUST be computed from canonical JSON serialization of original content:

1. Serialize original content to canonical JSON (sorted keys, no whitespace)
2. Compute SHA-256 hash
3. Encode as hex (lowercase)

**Rule 4.1.3: Deterministic Redaction**

Same transcript + same view → identical redacted output (byte-for-byte).

### 4.2 View-Specific Redaction Rules

#### INTERNAL View

- **No redaction**: All fields preserved as-is

#### PARTNER View

**Redacted Fields**:

- `transcript.policy_hash` → `{ redacted: true, hash: "...", view: "PARTNER" }` (if policy content sensitive)
- `transcript.strategy_hash` → `{ redacted: true, hash: "...", view: "PARTNER" }` (if strategy sensitive)
- `rounds[].content_summary.pricing_logic` → redacted (if proprietary)
- `rounds[].content_summary.strategy_details` → redacted
- `failure_event.evidence_refs[]` → structure preserved, content redacted if proprietary
- Passport breakdown (if present) → redacted

**Preserved Fields**:

- `transcript.transcript_id` (unchanged)
- `transcript.intent_id`, `intent_type`
- `transcript.failure_event.code`, `stage`, `fault_domain`
- `transcript.rounds[].round_type`, `timestamp_ms`, `round_hash`
- Settlement outcome

#### AUDITOR View

**Redacted Fields**:

- `transcript.policy_hash` → `{ redacted: true, hash: "...", view: "AUDITOR" }`
- `transcript.strategy_hash` → `{ redacted: true, hash: "...", view: "AUDITOR" }`
- `rounds[].content_summary` → redacted (negotiation detail)
- `rounds[].message_hash` → preserved (for verification)
- `rounds[].signature` → preserved (for verification)
- Passport breakdown → redacted
- Evidence content → redacted (structure preserved)

**Preserved Fields**:

- `transcript.transcript_id` (unchanged)
- `transcript.intent_id`, `intent_type`
- `transcript.failure_event.code`, `stage`, `fault_domain`, `terminality`
- `transcript.rounds[].round_type`, `timestamp_ms`, `round_hash`, `signature`
- Settlement outcome
- Passport score (snapshot only)

## 5. Cryptographic Invariants

### 5.1 Transcript Root Hash

**Invariant 5.1.1**: `transcript.transcript_id` MUST remain unchanged after redaction.

**Rationale**: Transcript ID is computed from transcript content. Redaction must not change this.

**Implementation**: Transcript ID is computed from canonical hash of transcript (excluding `transcript_id` itself). Redaction replaces field values but preserves structure, so hash computation remains valid.

### 5.2 Signature Chain

**Invariant 5.2.1**: All signatures MUST remain valid after redaction.

**Rationale**: Signatures are computed over message/envelope content. Redaction must not invalidate signatures.

**Implementation**: 
- Signatures are preserved as-is (not redacted)
- Signed content (message_hash, envelope_hash) is preserved
- Redaction only affects unsigned metadata (content_summary, etc.)

### 5.3 Decision Artifact Verification

**Invariant 5.3.1**: Arbitration decision artifacts MUST remain verifiable after redaction.

**Rationale**: Decision artifacts reference transcript hashes. Redaction must not break this linkage.

**Implementation**:
- Decision artifact references (`arbiter_decision_ref`) are preserved
- Transcript hash referenced by decision remains unchanged
- Decision signature verification remains valid

## 6. Redaction Function

### 6.1 Function Signature

```typescript
redactTranscript(
  transcript: TranscriptV4,
  view: "INTERNAL" | "PARTNER" | "AUDITOR"
): RedactedTranscriptV4
```

### 6.2 Deterministic Behavior

**Requirement 6.2.1**: Same transcript + same view → identical redacted output (byte-for-byte).

**Implementation**:
- Canonical JSON serialization for hash computation
- Sorted keys (recursive)
- No whitespace
- Deterministic field ordering

### 6.3 Redaction Process

1. **Clone transcript** (deep copy)
2. **Apply view-specific redaction rules** (field-by-field)
3. **Replace redacted fields** with `{ redacted: true, hash: "...", view: "..." }`
4. **Preserve invariants** (transcript_id, signatures, hashes)
5. **Return redacted transcript**

## 7. Verification

### 7.1 Proof of Inclusion

Verifier can:

1. Extract `hash` from redacted field
2. Request original content from trusted source
3. Compute hash of original content
4. Verify hash matches → proof of inclusion

### 7.2 Proof of Non-Tampering

Verifier can:

1. Extract `hash` from redacted field
2. Request original content from trusted source
3. Compute hash of original content
4. Verify hash matches → proof of non-tampering

### 7.3 Replay Verification

Redacted transcripts can be replayed:

1. Load redacted transcript
2. Verify transcript root hash (unchanged)
3. Verify signature chain (preserved)
4. Replay negotiation (using preserved fields)
5. Verify failure taxonomy (preserved)

## 8. Schema Updates

### 8.1 Redacted Field Type

```json
{
  "type": "object",
  "properties": {
    "redacted": { "type": "boolean", "const": true },
    "hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "view": { "type": "string", "enum": ["INTERNAL", "PARTNER", "AUDITOR"] }
  },
  "required": ["redacted", "hash", "view"],
  "additionalProperties": false
}
```

### 8.2 Transcript Schema Extension

Transcript schema MUST allow:

- Redacted fields in place of original fields
- Union type: `originalField | RedactedField`

## 9. Use Cases

### 9.1 Cross-Organization Audit

**Scenario**: Organization A shares transcript with Organization B for audit.

**View**: AUDITOR

**Result**: Organization B can verify compliance without seeing proprietary pricing logic.

### 9.2 Dispute Resolution

**Scenario**: Buyer and provider dispute settlement outcome.

**View**: PARTNER

**Result**: Both parties can see negotiation outcome and failure taxonomy without revealing internal strategy.

### 9.3 Regulatory Reporting

**Scenario**: Organization reports transaction to regulator.

**View**: AUDITOR

**Result**: Regulator can verify compliance and failure handling without proprietary details.

## 10. Limitations

### 10.1 No Encryption

Redaction is **structural**, not cryptographic:

- Original content is not encrypted
- Redaction does not provide secrecy
- Redaction provides privacy through omission, not obfuscation

### 10.2 Trust Requirements

Redaction assumes:

- Redaction is performed by trusted party
- Original content is available for verification (if needed)
- View type is correctly applied

### 10.3 Reversibility

Redaction is **not reversible** from redacted transcript alone:

- Original content must be obtained from trusted source
- Hash allows verification but not reconstruction

---

**Status**: Draft (Normative)  
**Last Updated**: 2025-01-XX  
**Protocol Version**: pact/4.0
