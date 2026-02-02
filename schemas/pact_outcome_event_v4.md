# Pact Outcome Event Schema v4

**Protocol Identifier**: pact-outcome-event/4.0  
**Status**: Draft (Normative)  
**Scope**: Time-decoupled outcome evidence; does not mutate transcripts.

## 1. Overview

Outcome events are **append-only** artifacts that reference a **terminal** transcript and record post-settlement outcomes (e.g. T+30, T+180). They enable "compliant but wrong" and third-party assessments without mutating the original transcript.

### 1.1 Don-Safe Rules

- **Record only**: Don never interprets outcome_type or claim; it only stores and verifies signatures.
- **No protocol semantics**: Outcome events do not change PoN semantics, reruns, or settlement.
- **Verifiable offline**: Signature verification uses the same canonical JSON and Ed25519 as transcripts.
- **Bundle section**: Evidence bundles may include an `outcome_events` section; each entry is verified independently.

### 1.2 Identifier

`outcome_event_id` MUST be computed as:

- Payload = canonical JSON of the outcome event with `signature_b58` (and optionally `claim`, `evidence_refs`) excluded per implementation.
- `outcome_event_id = "outcome-" + SHA256(payload).hex`

### 1.3 Normalization (Optional)

For clean analytics, implementations MAY set:

- **outcome_window**: Human-readable label (e.g. `T+30`, `T+180`) for querying and display.
- **relative_ms_from_terminal**: Milliseconds from transcript terminal event (settlement or `failure_event`) to this outcome. Enables normalized bucketing without inferring from raw timestamps.

Both are optional and Don-safe; they do not change verification semantics.

### 1.4 Signature Scope

The signer signs the canonical serialization of the outcome event. Implementations MUST define which fields are included (typically all except `signature_b58`). Verifiers MUST recompute the same payload and verify the signature.

## 2. Evidence Bundle Integration

Bundles MAY include an `outcome_events` array. Each entry:

- `type`: `"outcome_event"`
- `ref`: `outcome_event_id`
- `content_hash`: SHA-256 of canonical JSON of the outcome event

Outcome events are a **separate section** from transcript rounds; they do not modify the transcript hash chain.
