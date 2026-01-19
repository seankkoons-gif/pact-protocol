# Pact Compatibility Specification

**Protocol Version:** `pact-transcript/4.0`  
**Document Version:** 1.0  
**Last Updated:** 2025-01-27  
**Status:** Normative

This document defines what it means for a system to be "Pact-compatible" and specifies the requirements and verification procedures for compatibility.

---

## 1. Scope

This specification defines:

1. The meaning of "Pact-compatible"
2. Required artifacts that must be produced
3. Verification requirements that must be satisfied
4. Explicit non-requirements (what is not required for compatibility)

This specification applies to systems that implement the Pact protocol, regardless of implementation language, framework, or deployment model.

---

## 2. Definitions

### 2.1 Pact-Compatible System

A system is **Pact-compatible** if it:

1. Produces artifacts that conform to the Pact v4 specification
2. Produces artifacts that pass Pact v4 verification
3. Implements the required protocol semantics (negotiation, policy evaluation, failure attribution)

A system MAY be Pact-compatible without using the Pact SDK or any reference implementation.

### 2.2 Required Artifacts

The following artifacts MUST be produced by a Pact-compatible system:

- **Proof of Negotiation (PoN) Transcript**: A transcript file conforming to `pact-transcript/4.0` schema
- **Policy Hash**: A deterministic hash of the policy that governed the transaction
- **Failure Codes**: Canonical failure codes (if transaction failed) conforming to the Failure Taxonomy

### 2.3 Verification

Verification is the process of validating that artifacts conform to the Pact v4 specification and pass all required checks.

---

## 3. Required Artifacts

### 3.1 Proof of Negotiation (PoN) Transcript

A Pact-compatible system MUST produce a transcript file that:

1. **Conforms to Schema**: The transcript MUST conform to `schemas/pact_transcript_v4.json`
2. **Contains Required Fields**: The transcript MUST include:
   - `version: "pact-transcript/4.0"`
   - `transcript_id`: Unique identifier for the transcript
   - `intent`: The intent that initiated the negotiation
   - `rounds`: Array of negotiation rounds (minimum 1 round)
   - `policy_hash`: Hash of the policy that governed the transaction
   - `strategy_hash`: Hash of the negotiation strategy (if applicable)
   - `identity_snapshot_hash`: Hash of identity snapshots (if applicable)
   - `final_hash`: Hash of the complete transcript

3. **Hash-Linked Rounds**: Each round MUST:
   - Include `previous_round_hash` (except round 0, which uses initial hash)
   - Include `round_hash` computed from the round's canonical serialization
   - Include `signature` with `signer_public_key_b58`, `signature_b58`, and `scheme`

4. **Failure Event (if applicable)**: If the transaction failed, the transcript MUST include:
   - `failure_event` with `code`, `stage`, `fault_domain`, `terminality`, and `evidence_refs`
   - No further rounds after `failure_event` is present

**Verification**: The transcript MUST pass `pnpm replay:v4 <transcript_path>` with result `INTEGRITY: VALID`.

### 3.2 Policy Hash

A Pact-compatible system MUST:

1. **Compute Policy Hash**: Compute a deterministic hash of the policy that governed the transaction
2. **Embed in Transcript**: Include the policy hash in the transcript's `policy_hash` field
3. **Use Canonical Serialization**: Policy hash MUST be computed using canonical JSON serialization (sorted keys, deterministic formatting)

**Verification**: The policy hash MUST be present in the transcript and MUST match the hash computed from the policy object using canonical serialization.

### 3.3 Failure Codes (if applicable)

If a transaction fails, a Pact-compatible system MUST:

1. **Emit Canonical Failure Code**: Use a failure code from the canonical taxonomy:
   - `PACT-101` through `PACT-199`: Policy violations
   - `PACT-201` through `PACT-299`: Identity/Passport failures
   - `PACT-301` through `PACT-399`: Negotiation deadlocks
   - `PACT-401` through `PACT-499`: Settlement/rail failures
   - `PACT-501` through `PACT-599`: Recursive/dependency failures

2. **Include Required Fields**: The failure event MUST include:
   - `code`: Canonical failure code
   - `stage`: Stage at which failure occurred
   - `fault_domain`: Responsible party (BUYER, PROVIDER, RAIL, SYSTEM)
   - `terminality`: Whether failure is terminal (TERMINAL) or recoverable (RECOVERABLE)
   - `evidence_refs`: Array of evidence references

3. **Conform to Taxonomy**: Failure codes MUST conform to `docs/versions/v4/FAILURE_TAXONOMY.md`

**Verification**: The failure event MUST be present in the transcript (if transaction failed) and MUST conform to the failure taxonomy schema.

---

## 4. Verification Requirements

### 4.1 Transcript Verification

A Pact-compatible system MUST produce transcripts that pass the following verification checks:

1. **Schema Validation**: Transcript MUST conform to `schemas/pact_transcript_v4.json`
2. **Hash Chain Verification**: All rounds MUST form a valid hash chain (each `round_hash` must match the computed hash of the round)
3. **Signature Verification**: All round signatures MUST be valid (signature must verify against the round's envelope hash using the signer's public key)
4. **Policy Hash Verification**: `policy_hash` MUST match the hash computed from the policy object
5. **Failure Event Verification** (if applicable): `failure_event` MUST conform to the failure taxonomy schema

**Verification Command**: `pnpm replay:v4 <transcript_path>`

**Required Result**: `INTEGRITY: VALID` with no errors

### 4.2 Deterministic Replay

A Pact-compatible system MUST produce transcripts that are deterministically replayable:

1. **Identical Replay Results**: Replaying the same transcript multiple times MUST produce identical results
2. **Hash Stability**: Hash computations MUST be stable (same inputs → same hashes)
3. **No Non-Deterministic Behavior**: Replay MUST not depend on external state, random numbers, or timestamps

**Verification**: Run `pnpm replay:v4 <transcript_path>` multiple times and verify identical output.

### 4.3 Policy Evaluation Determinism

A Pact-compatible system MUST evaluate policies deterministically:

1. **Same Policy + Context → Same Result**: Identical policy and context MUST produce identical evaluation results
2. **Policy Hash Stability**: Identical policies MUST produce identical policy hashes
3. **Evidence References**: Policy violations MUST include `evidence_refs` pointing to violated rules

**Verification**: Evaluate the same policy with the same context multiple times and verify identical results and hashes.

---

## 5. Explicit Non-Requirements

The following are **NOT** required for Pact compatibility:

### 5.1 SDK Dependency

A system does NOT need to use the Pact SDK (`@pact/sdk`) or any reference implementation to be Pact-compatible. A system MAY implement the protocol directly in any language or framework.

**Rationale**: Compatibility is defined by artifact conformance and verification, not by implementation choice.

### 5.2 Specific Implementation Language

A system does NOT need to be implemented in TypeScript, JavaScript, or any specific language. A system MAY be implemented in any language that can produce conformant artifacts.

**Rationale**: The protocol is language-agnostic; compatibility is defined by artifact format, not implementation language.

### 5.3 Specific Deployment Model

A system does NOT need to be deployed in a specific way (cloud, on-premise, edge, etc.). A system MAY be deployed in any environment that can produce conformant artifacts.

**Rationale**: Compatibility is defined by artifact conformance, not deployment model.

### 5.4 Specific Settlement Rail

A system does NOT need to use a specific settlement rail (Stripe, escrow, boundary mode, etc.). A system MAY use any settlement mechanism, provided that:

1. Settlement coordination is recorded in the transcript
2. Settlement outcomes are deterministic
3. Settlement failures are classified using canonical failure codes

**Rationale**: The protocol is settlement-rail agnostic; compatibility is defined by transcript conformance, not settlement implementation.

### 5.5 Specific Identity Provider

A system does NOT need to use a specific identity provider or KYA (Know Your Agent) system. A system MAY use any identity mechanism, provided that:

1. Identity snapshots are hashed and embedded in transcripts
2. Identity verification failures are classified using canonical failure codes (PACT-2xx)
3. Identity information is included in `identity_snapshot_hash`

**Rationale**: The protocol is identity-provider agnostic; compatibility is defined by transcript conformance, not identity implementation.

### 5.6 Specific Policy Language

A system does NOT need to use a specific policy language or DSL. A system MAY use any policy representation, provided that:

1. Policies are serialized canonically for hashing
2. Policy evaluation is deterministic
3. Policy violations are classified using canonical failure codes (PACT-1xx)
4. Policy hash is embedded in transcripts

**Rationale**: The protocol is policy-language agnostic; compatibility is defined by policy hash and evaluation determinism, not policy representation.

### 5.7 Specific Negotiation Strategy

A system does NOT need to use a specific negotiation strategy (banded concession, ML-assisted, etc.). A system MAY use any negotiation strategy, provided that:

1. Negotiation rounds are recorded in the transcript
2. Rounds are hash-linked and signed
3. Negotiation failures are classified using canonical failure codes (PACT-3xx)

**Rationale**: The protocol is strategy-agnostic; compatibility is defined by transcript conformance, not negotiation strategy.

---

## 6. Compatibility Verification Procedure

To verify that a system is Pact-compatible, perform the following procedure:

### 6.1 Artifact Generation

1. Execute a transaction using the system under test
2. Collect the generated transcript file
3. Collect the policy object that governed the transaction (if applicable)
4. Collect any failure events (if transaction failed)

### 6.2 Transcript Verification

1. Run `pnpm replay:v4 <transcript_path>`
2. Verify result is `INTEGRITY: VALID`
3. Verify no errors are reported
4. Verify all signatures are valid
5. Verify hash chain is valid

### 6.3 Policy Hash Verification

1. Extract `policy_hash` from transcript
2. Compute hash of policy object using canonical JSON serialization
3. Verify hashes match

### 6.4 Failure Code Verification (if applicable)

1. Extract `failure_event` from transcript
2. Verify `code` is from canonical taxonomy
3. Verify `stage`, `fault_domain`, and `terminality` are valid
4. Verify `evidence_refs` are present and valid

### 6.5 Deterministic Replay Verification

1. Run `pnpm replay:v4 <transcript_path>` multiple times
2. Verify identical output across all runs
3. Verify hash values are identical
4. Verify signature verification results are identical

### 6.6 Compatibility Declaration

If all verification steps pass, the system is **Pact-compatible**.

---

## 7. Compatibility Levels

This specification defines a single compatibility level: **Full Compatibility**.

A system is **Fully Compatible** if it:

1. Produces all required artifacts (PoN transcript, policy hash, failure codes if applicable)
2. Passes all verification requirements (transcript verification, deterministic replay, policy evaluation determinism)
3. Conforms to all protocol semantics (hash-linking, signature verification, failure attribution)

There are no partial compatibility levels. A system is either fully compatible or not compatible.

---

## 8. Specification Authority

The following documents constitute the authoritative specification for Pact compatibility:

- **Transcript Schema**: `schemas/pact_transcript_v4.json`
- **Failure Taxonomy**: `docs/versions/v4/FAILURE_TAXONOMY.md`
- **Protocol Guarantees**: `docs/architecture/PACT_GUARANTEES.md`
- **Protocol Stability**: `docs/versions/v4/STATUS.md` (Protocol Stability & Guarantees section)

These documents, as of the v4.0.0 release date, define the compatibility requirements.

---

## 9. Versioning

This compatibility specification applies to:

- **Protocol Version**: `pact-transcript/4.0`
- **Compatibility Version**: `1.0`

Future versions of the protocol (e.g., `pact-transcript/5.0`) will have separate compatibility specifications.

Systems that are compatible with `pact-transcript/4.0` remain compatible with all v4.x releases (v4.0.0 through v4.99.0, if such releases exist).

---

## 10. Conformance Claims

A system that claims Pact compatibility MUST:

1. Produce artifacts that pass all verification requirements
2. Document which protocol version it implements (`pact-transcript/4.0`)
3. Provide evidence of verification (transcript files, verification results)

A system MAY claim compatibility without:
- Using the Pact SDK
- Being implemented in a specific language
- Using a specific deployment model
- Using a specific settlement rail
- Using a specific identity provider
- Using a specific policy language
- Using a specific negotiation strategy

---

**Document Status:** Normative  
**Protocol Version:** `pact-transcript/4.0`  
**Compatibility Version:** `1.0`
