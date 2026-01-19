# Pact v4 — Immutability & Guarantees

**Status:** Canonical (Normative)  
**Version:** pact/4.0  
**Last Updated:** 2025-01-XX  
**Do Not Revise Lightly**

## Purpose

Pact v4 is designated as an **immutable, compliance-grade release**. This document defines the guarantees Pact v4 provides and the invariants that will not change within the v4 line.

These guarantees exist so that:

1. **Enterprises** can deploy Pact without fear of semantic drift
2. **Auditors** can rely on Pact artifacts as evidence
3. **Future versions** can extend Pact without invalidating past decisions

## Versioning & Immutability Policy

### Pact v4 Artifacts Are Append-Only by Design

- Pact v4 guarantees apply to all versions `>= v4.0.0` and `< v5.0.0`
- No v4 patch or minor release may:
  - Change transcript semantics
  - Alter failure code meanings
  - Weaken policy enforcement
  - Invalidate previously generated evidence
- **Breaking changes require v5.**

## Core Guarantees

### 1. Deterministic Negotiation & Settlement

**Pact v4 guarantees that:**

- Identical inputs (intent, policy, strategy, identity snapshots) produce **identical transcripts**
- All negotiation rounds are:
  - Cryptographically signed
  - Hash-linked
  - Replayable
- Transcripts are **terminal** once completed and cannot be extended or modified

**Guarantee:**
> A Pact v4 transcript is a complete and deterministic record of what occurred.

**Evidence:**
- Transcripts use canonical JSON serialization (sorted keys, deterministic hashing)
- Hash chains link rounds immutably
- Signatures verify agent identity and message integrity
- Transcripts include `final_hash` for tamper detection

**Enforcement:**
- Transcript schema (`pact-transcript/4.0`) is immutable
- Round sequence is enforced (no gaps, no reordering)
- Timestamps are monotonic (no time travel)
- Failure events are terminal (no continuation after failure)

### 2. Canonical Failure Semantics

**Pact v4 guarantees that:**

- Every failed intent emits **exactly one** canonical `FailureEvent`
- `FailureEvent`s include:
  - `stage` of failure (admission, negotiation, commitment, settlement, etc.)
  - `fault_domain` (responsible party: policy, identity, negotiation, settlement, recursive)
  - `terminality` (terminal or non-terminal)
  - `evidence_refs` (verifiable artifacts)
- Failure codes are **stable and versioned** (PACT-1xx → PACT-5xx)

**Guarantee:**
> Responsibility is computable, not inferred.

**Evidence:**
- Failure taxonomy (`docs/versions/v4/FAILURE_TAXONOMY.md`) defines canonical codes
- Each failure code maps to unambiguous fault domain and stage
- Evidence references enable independent verification
- Failure events are embedded in transcripts (immutable)

**Enforcement:**
- One failure event per failed intent (invariant)
- Failure codes follow PACT-XXX format (no custom codes)
- Blame assignment is deterministic (default rules, no ambiguity)
- Failure events are terminal (no continuation after failure)

### 3. Policy-Enforced Execution (Pact Boundary)

**Pact v4 guarantees that:**

- All settlement-capable actions occur **inside a Pact Boundary**
- Policies are evaluated deterministically:
  - During negotiation (per round)
  - Immediately before settlement (final check)
- Policy violations:
  - Block execution immediately
  - Produce terminal transcripts
  - Emit canonical failure codes (PACT-101)

**Guarantee:**
> Agents cannot spend outside declared policy.

**Evidence:**
- Policy hash is embedded in transcript (`policy_hash` field)
- Policy evaluation traces are included in `evidence_refs` (for violations)
- Boundary runtime enforces policy before settlement
- Policy violations abort with terminal failure events

**Enforcement:**
- Policy evaluation is side-effect free (no network calls, no external state)
- Policy evaluation is deterministic (same policy + context → same result)
- Policy violations map to PACT-101 (or relevant 1xx code)
- Policy evidence is embedded in transcripts (auditable)

### 4. Transcript-Constrained Arbitration

**Pact v4 guarantees that:**

- Arbitration decisions:
  - Consume **only transcript-contained evidence**
  - Produce **signed decision artifacts**
  - Are **verifiable** without trusting the arbiter
- Arbitration outcomes map deterministically into failure taxonomy
- Escrow release/refund semantics are explicit and replayable

**Guarantee:**
> Disputes are resolved by evidence, not discretion.

**Evidence:**
- Arbitration decisions reference transcript hashes (`arbiter_decision_ref`)
- Decision artifacts conform to `pact_arbiter_decision_v4.json` schema
- Decisions map to failure codes (PACT-1xx, PACT-2xx, etc.)
- Escrow outcomes are deterministic (RELEASE, REFUND, SPLIT)

**Enforcement:**
- Arbiters cannot access evidence outside transcripts
- Decision artifacts are cryptographically signed
- Decisions are append-only (no modification after issuance)
- Escrow semantics are explicit (no ambiguity)

### 5. Identity, Reputation, and Credit Determinism

**Pact v4 guarantees that:**

- **Passport scores** and confidence values are:
  - Derived **only from canonical events** (terminal receipts, failure events, dispute outcomes)
  - **Reproducible** at any point in time (same inputs → same score)
- **Credit decisions**:
  - Are **policy-gated** (enforced by buyer policy)
  - Are **Passport-gated** (derived from score + confidence)
  - Are **transcripted as evidence** (embedded in `evidence_refs`)
- **Kill switches** for unsafe behavior are enforced deterministically

**Guarantee:**
> Trust and credit are earned, explainable, and revocable.

**Evidence:**
- Passport scoring is deterministic (no ML, no randomness)
- Credit terms are computed from Passport score + confidence (tier-based)
- Credit decisions are embedded in transcripts (`credit_tier`, `credit_decision`, etc.)
- Kill switches are triggered by canonical failure codes (PACT-1xx, PACT-2xx)

**Enforcement:**
- Passport scoring uses only structured inputs (receipts, failures, disputes)
- Credit terms are deterministic (same score + confidence → same tier)
- Credit denials emit canonical failure events (PACT-101, PACT-201)
- Kill switches are enforced at commitment time (before settlement)

### 6. Evidence Portability & Redaction Safety

**Pact v4 guarantees that:**

- **Evidence bundles** are:
  - Deterministic (canonical serialization)
  - Tamper-evident (hash-linked)
  - Self-verifying (signatures, hash chains)
- **Redacted views** preserve:
  - Cryptographic integrity (hash chains remain valid)
  - Blame assignment (fault domains unchanged)
  - Arbitration validity (decisions remain verifiable)
- **Auditor views** expose compliance outcomes without revealing proprietary logic

**Guarantee:**
> Pact evidence can cross organizational boundaries safely.

**Evidence:**
- Evidence bundles conform to `EVIDENCE_BUNDLE.md` specification
- Redaction preserves hash chain integrity (redacted fields marked, not removed)
- Auditor views show policy compliance without exposing strategy internals
- Evidence references enable independent verification

**Enforcement:**
- Evidence bundles are hash-verifiable (tamper detection)
- Redaction markers preserve cryptographic integrity
- Auditor views exclude proprietary fields (strategy, internal state)
- Evidence references are stable (no breaking changes)

## Explicit Non-Guarantees (By Design)

**Pact v4 does not guarantee:**

- **Optimal pricing** (agents may negotiate suboptimal deals)
- **Market efficiency** (no guarantee of best prices or fastest execution)
- **Profitable outcomes** (agents may lose money)
- **Agent correctness or intelligence** (agents may make mistakes)
- **Absence of failure** (failures are expected and handled)

**Rationale:**
> Pact guarantees **defensibility**, not success.

Pact ensures that:
- Actions are **auditable** (transcripts are complete)
- Failures are **attributable** (fault domains are explicit)
- Outcomes are **verifiable** (evidence is tamper-evident)
- Policies are **enforced** (spending is constrained)

Pact does **not** ensure that:
- Agents make optimal decisions
- Negotiations result in favorable prices
- Transactions are profitable
- Failures never occur

## Forward Compatibility

### Future Versions of Pact

**MAY:**
- Add new failure codes (PACT-6xx, PACT-7xx, etc.)
- Add new policy primitives (new rule types, new constraints)
- Extend Passport scoring (new inputs, new factors)
- Add new settlement modes (new rails, new protocols)

**MUST NOT:**
- Invalidate v4 transcripts or evidence
- Change v4 failure code meanings
- Alter v4 transcript semantics
- Break v4 policy evaluation

**Guarantee:**
> v4 artifacts are valid forever.

### Migration Path

- **v4 → v5**: Breaking changes require new protocol version
- **v4 artifacts**: Remain valid and verifiable in v5+
- **v4 transcripts**: Can be replayed in v5+ runtimes
- **v4 evidence**: Can be used in v5+ arbitration

## Compliance & Verification

### For Enterprises

**You can rely on:**
- Transcripts are immutable (no modification after completion)
- Policies are enforced (spending is constrained)
- Failures are attributable (blame is computable)
- Evidence is portable (cross-organizational auditability)

**You must ensure:**
- Policies are correctly configured (buyer responsibility)
- Agents follow protocol (no protocol violations)
- Settlement providers are compatible (rail requirements)

### For Auditors

**You can verify:**
- Transcript integrity (hash chains, signatures)
- Policy compliance (policy hash, evaluation traces)
- Failure attribution (fault domains, evidence refs)
- Arbitration validity (decision signatures, transcript refs)

**You can trust:**
- Transcripts are tamper-evident (hash chains break on modification)
- Policies are deterministic (same inputs → same results)
- Failures are canonical (one failure event per failed intent)
- Evidence is verifiable (references enable independent verification)

### For Developers

**You can extend:**
- New failure codes (PACT-6xx, PACT-7xx, etc.)
- New policy primitives (new rule types)
- New Passport factors (new scoring inputs)
- New settlement rails (new providers)

**You must preserve:**
- Transcript immutability (append-only, no modification)
- Failure semantics (one failure event per failed intent)
- Policy determinism (same inputs → same results)
- Evidence verifiability (hash chains, signatures)

## Summary

**If an action occurred inside a Pact v4 Boundary,**
**it can be explained, audited, disputed, and defended — indefinitely.**

### Core Principles

1. **Determinism**: Same inputs → same outputs (transcripts, scores, decisions)
2. **Immutability**: Transcripts are append-only (no modification after completion)
3. **Attribution**: Failures are attributable (fault domains are explicit)
4. **Verifiability**: Evidence is verifiable (hash chains, signatures)
5. **Enforcement**: Policies are enforced (spending is constrained)
6. **Portability**: Evidence is portable (cross-organizational auditability)

### Guarantees Summary

| Guarantee | What It Means | Evidence |
|-----------|---------------|----------|
| **Deterministic Negotiation** | Same inputs → same transcript | Hash chains, canonical serialization |
| **Canonical Failures** | One failure event per failed intent | Failure taxonomy, evidence refs |
| **Policy Enforcement** | Spending is constrained by policy | Policy hash, evaluation traces |
| **Transcript-Constrained Arbitration** | Disputes resolved by evidence | Decision artifacts, transcript refs |
| **Identity/Reputation Determinism** | Scores and credit are reproducible | Passport scoring, credit terms |
| **Evidence Portability** | Evidence crosses boundaries safely | Evidence bundles, redaction safety |

### Non-Guarantees Summary

| Non-Guarantee | What It Means | Rationale |
|---------------|---------------|-----------|
| **Optimal Pricing** | No guarantee of best prices | Agents may negotiate suboptimally |
| **Market Efficiency** | No guarantee of efficiency | No market mechanism in v4 |
| **Profitable Outcomes** | No guarantee of profit | Agents may lose money |
| **Agent Correctness** | No guarantee of agent intelligence | Agents may make mistakes |
| **Absence of Failure** | Failures are expected | Failures are handled, not prevented |

---

**Status:** Canonical (Normative)  
**Version:** pact/4.0  
**Protocol Identifier:** `pact/4.0`  
**Do Not Revise Lightly**
