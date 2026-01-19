# Pact Arbitration v4

Protocol Identifier: pact-arbitration/4.0  
Status: Draft (Normative)  
Scope: Deterministic arbitration process for Pact v4 disputes with transcript-constrained evidence.

## 1. Design Goals (Normative)

Pact v4 arbitration provides a compliance-grade dispute resolution mechanism that:

1. **Transcript-Constrained**: Arbiters MUST base decisions solely on transcript data and attached evidence bundles
2. **Deterministic Validation**: Decision artifacts MUST be verifiable without external context
3. **Legally Admissible**: Decision artifacts include cryptographic signatures and hash references for court/arbitration proceedings
4. **Replay-Compatible**: Decision artifacts can be validated against transcripts using deterministic replay
5. **Taxonomy-Aligned**: Arbitration outcomes map deterministically to Canonical Failure Taxonomy (PACT-xxx codes)

## 2. Core Concepts

### 2.1 Arbitration Scope

**What Arbiters CAN Decide:**

- Release escrow funds to provider (RELEASE)
- Refund escrow funds to buyer (REFUND)
- Split escrow funds between parties (SPLIT)
- Reject arbitration request due to insufficient evidence or invalid transcript (REJECT_ARBITRATION)

**What Arbiters MUST NOT Decide:**

- Policy interpretation beyond what is explicit in the transcript
- Quality judgments beyond objective evidence in receipts/bundles
- Penalties or damages beyond the escrow amount
- Outcomes that contradict deterministic transcript replay validation

### 2.2 Inputs (STRICT)

Arbiters MUST base decisions ONLY on:

1. **Transcript**: Complete Pact v4 transcript (hash-verified)
2. **Policy**: Buyer policy referenced by `policy_hash` in transcript
3. **Objective Receipts**: Settlement receipts, delivery confirmations, or SLA adherence records referenced in transcript
4. **Observer Signatures**: Optional cryptographic attestations from third-party observers (if present in transcript)

**PROHIBITED Inputs:**

- External web APIs
- Non-transcript logs or telemetry
- Subjective testimony not captured in transcript
- Information not referenced in `evidence_refs` within transcript
- Real-time market data or external pricing

### 2.3 Deterministic Validation Requirements

Every decision artifact MUST be:

1. **Hash-Verified**: Transcript hash in decision MUST match actual transcript `transcript_id`
2. **Signature-Verified**: Decision signature MUST be valid using arbiter's public key
3. **Schema-Valid**: Decision MUST conform to `pact_arbiter_decision_v4.json` schema
4. **Replay-Consistent**: Decision outcome MUST be consistent with deterministic transcript replay
5. **Canonical-Serialization**: Signature verification MUST use canonical JSON serialization (sorted keys, no whitespace, deterministic encoding)

### 2.4 Terminality Rules

**When Escrow is FROZEN:**

- Transcript enters `NEEDS_ARBITRATION` terminality state
- Escrow funds are locked pending arbiter decision
- No further rounds may be appended to transcript
- Transcript MUST include `failure_event` with `terminality: "NEEDS_ARBITRATION"`

**When Escrow is RELEASED (to Provider):**

- Arbiter decision is `RELEASE`
- Decision artifact is attached to transcript via `arbiter_decision_ref`
- Escrow funds are transferred to provider
- Transcript terminality becomes `arbitrated_release`

**When Escrow is REFUNDED (to Buyer):**

- Arbiter decision is `REFUND`
- Decision artifact is attached to transcript via `arbiter_decision_ref`
- Escrow funds are returned to buyer
- Transcript terminality becomes `arbitrated_refund`

**When Escrow is SPLIT:**

- Arbiter decision is `SPLIT` with `amounts` specified per party
- Decision artifact is attached to transcript via `arbiter_decision_ref`
- Escrow funds are distributed according to `amounts`
- Transcript terminality becomes `arbitrated_split`

**When Arbitration is REJECTED:**

- Arbiter decision is `REJECT_ARBITRATION`
- Transcript remains in `NEEDS_ARBITRATION` state (may allow retry with different arbiter)
- Escrow remains frozen until valid decision is issued

### 2.5 Failure Code Mapping Rules

Arbitration outcomes MUST map deterministically to Canonical Failure Taxonomy codes:

| Arbitration Outcome | Failure Code | Rationale |
|---------------------|--------------|-----------|
| RELEASE (policy violation by buyer confirmed) | PACT-101 | Policy violation confirmed |
| REFUND (policy violation by provider confirmed) | PACT-101 | Policy violation confirmed |
| RELEASE (provider delivered, buyer non-payment) | PACT-404 | Settlement rail timeout confirmed |
| REFUND (provider non-delivery) | PACT-404 | Settlement rail timeout confirmed |
| RELEASE (identity snapshot invalid at negotiation) | PACT-201 | Identity/KYA failure |
| REFUND (identity snapshot invalid at settlement) | PACT-201 | Identity/KYA failure |
| SPLIT (quality mismatch, partial delivery) | PACT-404 | Settlement outcome ambiguous |
| REJECT_ARBITRATION (insufficient evidence) | PACT-303 | Deadlock leading to arbitration |

**Mapping Rule:**

The arbiter MUST select the failure code based on the **primary fault domain** identified in the transcript evidence:

- **Policy violations** (buyer or provider) → PACT-1xx (typically 101)
- **Identity/KYA failures** → PACT-2xx (typically 201)
- **Deadlock/negotiation failures** → PACT-3xx (typically 303)
- **Settlement/timeout failures** → PACT-4xx (typically 404)
- **Recursive dependency failures** → PACT-5xx (typically 505)

The arbiter MUST include the mapped failure code in `reason_codes` array using the enum value (e.g., `POLICY_VIOLATION_CONFIRMED` maps to PACT-101).

### 2.6 Evidence References

Decision artifacts MUST reference specific transcript sections using `evidence_refs`:

- **Round hashes**: `"round_hash": "ea3f6652..."` (reference specific negotiation round)
- **Receipt hashes**: `"receipt_hash": "abc123..."` (reference settlement receipt)
- **Policy sections**: `"policy_section": "max_price"` (reference specific policy constraint)
- **SLA adherence records**: `"sla_metric": "max_latency_ms", "actual": 750, "sla": 500` (reference objective SLA violation)

All `evidence_refs` MUST be hash-verifiable against transcript content.

## 3. Decision Artifact Schema

Decision artifacts MUST conform to `schemas/pact_arbiter_decision_v4.json`.

**Required Fields:**

- `decision_id`: Unique decision identifier (deterministic from transcript_hash + arbiter_id + issued_at)
- `transcript_hash`: Exact `transcript_id` from transcript (MUST match exactly)
- `decision`: Enum (`RELEASE`, `REFUND`, `SPLIT`, `REJECT_ARBITRATION`)
- `amounts`: Object with party amounts (required if `decision` is `SPLIT`)
- `reason_codes[]`: Array of canonical reason codes (enum, NOT free text)
- `evidence_refs[]`: Array of hash pointers into transcript/receipts
- `arbiter_id`: Arbiter identifier (e.g., "arbiter-001")
- `arbiter_pubkey`: Arbiter's public key (base58 or hex)
- `issued_at`: Unix timestamp (milliseconds) when decision was issued
- `signature`: Cryptographic signature over canonical serialization
- `schema_version`: `"pact-arbiter-decision/4.0"`

**Canonical Serialization:**

For signature generation/verification, decision artifacts MUST be serialized as:

1. All fields sorted alphabetically by key
2. JSON with no whitespace (compact)
3. UTF-8 encoding
4. Signature computed over: `SHA256(compact_json)`

## 4. Transcript Integration

### 4.1 Transcript Requirements for Arbitration

Any transcript that enters arbitration MUST:

1. Terminate with `failure_event` having `terminality: "NEEDS_ARBITRATION"`
2. Include `arbiter_decision_ref` field (initially `null`, populated after decision)
3. Reference escrow contract hash (if applicable)

### 4.2 Decision Attachment

After arbiter issues decision:

1. Decision artifact is stored (off-chain or on-chain registry)
2. Transcript is updated to include `arbiter_decision_ref: <decision_id_hash>`
3. Transcript MUST NOT be modified further (append-only invariant preserved)
4. Transcript terminality is updated to reflect arbitration outcome

**Note:** The `arbiter_decision_ref` update does NOT invalidate transcript hash chain because it is appended after terminal `failure_event` and does not modify prior rounds.

## 5. Compliance and Legal Considerations

### 5.1 Admissibility

Decision artifacts are designed for legal admissibility by:

- Including cryptographic signatures (non-repudiation)
- Hash-linking to transcripts (tamper-evidence)
- Deterministic validation (reproducibility)
- Schema versioning (future-proofing)

### 5.2 Audit Trail

All decision artifacts MUST be:

- Immutable (signed, hash-verifiable)
- Timestamped (`issued_at`)
- Arbiter-attributed (`arbiter_id`, `arbiter_pubkey`)
- Evidence-linked (`evidence_refs[]`)

### 5.3 Redaction (Future)

For partner/auditor views, decision artifacts may include:

- `redaction_mask`: Optional field indicating which `evidence_refs` are redacted
- `auditor_view`: Optional field containing redacted evidence bundle hash

Full redaction implementation is deferred to future versions.

## 6. Versioning and Stability

This specification is versioned as `pact-arbitration/4.0`.

**Breaking Changes:**

- Schema version updates (e.g., `pact-arbiter-decision/5.0`) require protocol version bump
- New decision types require schema version update
- Changes to canonical serialization require schema version update

**Non-Breaking Changes:**

- Additional optional fields in decision artifact schema
- New reason codes (additive)
- New evidence reference types (additive)

---

**Status:** Draft - Subject to review and ratification by Pact governance.
