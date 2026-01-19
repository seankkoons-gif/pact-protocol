# Pact Policy v4

Protocol Identifier: pact-policy/4.0  
Status: Draft (Normative)  
Scope: Deterministic, machine-enforceable constraint system for Pact v4 negotiations.

## 1. Design Goals (Normative)

Pact Policy v4 provides a compliance-grade constraint system that:

1. **Prevents Unsafe Spending**: Policies block unauthorized or risky transactions before settlement
2. **Deterministic Evaluation**: Policy evaluation is side-effect free and produces identical results for identical inputs
3. **Transcript-Embedded**: Policy hashes are embedded in transcripts for auditability
4. **Failure Taxonomy Aligned**: Policy violations map directly to Canonical Failure Taxonomy (PACT-1xx codes)
5. **Human-Authorable**: Policies are written in a minimal, declarative DSL
6. **Machine-Enforceable**: Policies are evaluated by deterministic engines (no probabilistic reasoning)

## 2. Core Concepts

### 2.1 Purpose

**What Policies DO:**

- Block negotiations that violate buyer constraints (price limits, counterparty requirements, etc.)
- Enforce Passport score/confidence thresholds
- Require specific settlement modes (escrow, Stripe, etc.)
- Prevent transactions with agents that have recent policy violations
- Set time windows and SLA constraints

**What Policies DO NOT Do (Non-Goals):**

- **NO Probabilistic Reasoning**: Policies do not use ML models or probability distributions
- **NO Runtime Learning**: Policies do not adapt or learn from past transactions
- **NO External State**: Policy evaluation depends only on transcript state, not external APIs
- **NO Free-Text Rules**: All constraints are expressed in structured DSL, not natural language
- **NO Ambiguity**: Policy evaluation is deterministic (same policy + context → same result)

### 2.2 Policy Lifecycle

**1. Policy Authoring:**

- Policies are authored in Pact Policy DSL v4 (declarative JSON)
- Policies are validated against `pact_policy_v4.json` schema
- Policy hashes are computed using canonical JSON serialization

**2. Policy Embedding:**

- Policy hash is embedded in transcript `policy_hash` field
- Policy evaluation traces are included in `evidence_refs` (for violations)
- Policy violations block negotiation/settlement immediately

**3. Policy Evaluation:**

- Evaluation occurs at specific protocol stages (admission, negotiation, settlement)
- Evaluation is side-effect free (no network calls, no mutable state)
- Evaluation results are deterministic and replayable

**4. Arbitration Integration:**

- Arbitration decisions reference policy constraints via `evidence_refs` (policy sections)
- Policy violations are confirmed or rejected by arbiters using transcript evidence

### 2.3 Deterministic Evaluation Requirement

**Requirement 2.3.1: Side-Effect Free**

Policy evaluation MUST:

- NOT make network calls (no web APIs)
- NOT access external databases (only transcript state)
- NOT generate random numbers (unless explicitly seeded)
- NOT depend on system time (use transcript timestamps only)
- NOT modify external state (evaluation is read-only)

**Requirement 2.3.2: Reproducibility**

Policy evaluation MUST:

- Produce identical results for identical inputs (policy + context)
- Generate identical policy hashes for identical policies (canonical serialization)
- Include evaluation traces in transcript `evidence_refs` (for violations)

**Requirement 2.3.3: Transcript Embedding**

Policy evaluation MUST:

- Compute policy hash from canonical JSON serialization (sorted keys, no whitespace)
- Embed policy hash in transcript `policy_hash` field
- Include policy evaluation traces in `evidence_refs` when violations occur

## 3. Policy DSL v4

### 3.1 Primitive Types

**Numbers:**

- Integer: `123`
- Float: `123.45`
- Currency: `0.05` (USD or native units)

**Strings:**

- Literal: `"weather.data"`
- Pattern: regex (future version)

**Booleans:**

- `true`, `false`

**Enums:**

- `"RELEASE" | "REFUND" | "SPLIT" | "REJECT_ARBITRATION"`
- `"boundary" | "stripe" | "escrow"`

### 3.2 Comparators

**Equality:**

- `==` (equal)
- `!=` (not equal)

**Ordering (numbers):**

- `<` (less than)
- `<=` (less than or equal)
- `>` (greater than)
- `>=` (greater than or equal)

**Membership:**

- `IN` (value is in array): `price IN [0.05, 0.10, 0.15]`
- `NOT IN` (value is not in array)

### 3.3 Logical Operators

**Conjunction:**

- `AND` (all conditions must be true)

**Disjunction:**

- `OR` (at least one condition must be true)

**Negation:**

- `NOT` (condition must be false)

### 3.4 Policy Structure

Policies are JSON objects with the following structure:

```json
{
  "policy_version": "pact-policy/4.0",
  "policy_id": "policy-abc123...",
  "rules": [
    {
      "name": "max_price",
      "condition": {
        "field": "offer_price",
        "operator": "<=",
        "value": 0.05
      }
    },
    {
      "name": "require_passport",
      "condition": {
        "AND": [
          {
            "field": "counterparty_passport_score",
            "operator": ">=",
            "value": 80
          },
          {
            "field": "counterparty_passport_confidence",
            "operator": ">=",
            "value": 0.7
          }
        ]
      }
    },
    {
      "name": "disallow_failure_codes",
      "condition": {
        "field": "counterparty_recent_failures",
        "operator": "NOT IN",
        "value": ["PACT-101", "PACT-202"]
      }
    }
  ]
}
```

### 3.5 Context Fields

Policy evaluation context includes ONLY:

- `offer_price`: Current offer/ask price
- `bid_price`: Current bid price
- `counterparty_agent_id`: Counterparty identifier
- `counterparty_passport_score`: Counterparty Passport score (0-100)
- `counterparty_passport_confidence`: Counterparty Passport confidence (0-1)
- `counterparty_recent_failures`: Array of recent failure codes
- `settlement_mode`: Settlement mode (boundary, stripe, escrow)
- `intent_type`: Intent type identifier
- `negotiation_round`: Current round number
- `transcript_created_at_ms`: Transcript creation timestamp

**PROHIBITED Context Fields:**

- External API data
- Real-time market prices
- Random numbers
- System time (use transcript timestamps)
- User input (beyond what's in transcript)

## 4. Policy Schema and Hashing

### 4.1 Canonical Serialization

Policy hashing uses canonical JSON serialization:

1. All keys sorted alphabetically (recursive)
2. No whitespace (compact JSON)
3. UTF-8 encoding
4. SHA-256 hash of serialized string
5. Hex encoding of hash (lowercase)

**Rule 4.1.1: Policy Hash Determinism**

Two policies with identical structure MUST produce identical hashes, regardless of:
- Key ordering in source JSON
- Whitespace in source JSON
- File location or name
- Timestamp of creation

### 4.2 Policy Hash Embedding

Policy hash MUST be embedded in:

1. **Transcript**: `transcript.policy_hash` field
2. **Arbitration Decisions**: Referenced in `evidence_refs` when policy violation is relevant
3. **Failure Events**: Included in `evidence_refs` for PACT-101 violations

## 5. Policy Evaluation Engine

### 5.1 Evaluation Function

```typescript
evaluatePolicy(
  policy: PactPolicyV4,
  context: PolicyEvaluationContext
): PolicyResult
```

**PolicyResult Structure:**

```typescript
{
  allowed: boolean;
  violated_rules: Array<{
    rule_name: string;
    condition: any;
    failure_code?: "PACT-101";
  }>;
  mapped_failure_code?: "PACT-101";
  evidence_refs: string[]; // References to policy sections, evaluation traces
}
```

### 5.2 Evaluation Process

**Step 1: Rule Evaluation**

For each rule in `policy.rules`:

1. Evaluate rule condition using context fields
2. If condition is false, add rule to `violated_rules`
3. If any rule is violated, set `allowed = false`

**Step 2: Failure Code Mapping**

If `allowed === false`:

- Set `mapped_failure_code = "PACT-101"` (Policy violation)
- Add policy rule references to `evidence_refs`

**Step 3: Evidence Collection**

For each violated rule:

- Add rule name and condition to `violated_rules`
- Add policy section reference to `evidence_refs`

### 5.3 Evaluation Timing

Policy evaluation occurs at:

1. **Admission Stage**: Before negotiation starts (counterparty eligibility, Passport checks)
2. **Negotiation Stage**: During negotiation (price limits, round constraints)
3. **Settlement Stage**: Before settlement (settlement mode requirements, final price checks)

**Rule 5.3.1: Immediate Blocking**

If policy evaluation fails at any stage:

- Negotiation/settlement MUST be blocked immediately
- FailureEvent MUST be emitted with `code: "PACT-101"`
- FailureEvent MUST include policy evaluation traces in `evidence_refs`

## 6. Failure Mapping

### 6.1 Policy Violations → Failure Codes

**Mapping Rule 6.1.1:**

Any policy violation MUST:

1. Block negotiation or settlement immediately
2. Emit FailureEvent with `code: "PACT-101"` (or relevant 1xx code)
3. Include policy evaluation traces in `evidence_refs`

**Exception:** If violation is due to invalid identity/KYA:

- Map to `PACT-201` (Identity failure) instead of `PACT-101`

**Exception:** If violation is due to deadlock/negotiation failure:

- Map to `PACT-303` (Negotiation deadlock) if applicable

### 6.2 Evidence References

Policy evaluation traces MUST include:

- Policy hash: `"policy_hash": "abc123..."`
- Violated rule name: `"rule": "max_price"`
- Condition that failed: `"condition": {"field": "offer_price", "operator": ">", "value": 0.05}`
- Evaluation timestamp: `"evaluated_at_ms": 1234567890`

## 7. Relationship to Transcripts

### 7.1 Transcript Embedding

Policy hash MUST be embedded in transcript:

- `transcript.policy_hash`: SHA-256 hash of canonical policy JSON
- Policy evaluation traces in `failure_event.evidence_refs` (if violation)

### 7.2 Replay Verification

Transcript replay MUST:

- Verify policy hash matches policy used during negotiation
- Re-evaluate policy using transcript state (deterministic verification)
- Confirm policy violations are correctly attributed

## 8. Relationship to Arbitration

### 8.1 Arbitration Evidence

Arbitration decisions reference policies via:

- `evidence_refs`: Include `policy_section` references to violated rules
- `reason_codes`: Include `POLICY_VIOLATION_CONFIRMED` for policy violations

### 8.2 Policy Confirmation

Arbiters MUST:

- Verify policy hash matches transcript `policy_hash`
- Re-evaluate policy using transcript state
- Confirm or reject policy violations based on transcript evidence

## 9. Relationship to Passport

### 9.1 Passport as Policy Input

Policies MAY require:

- `counterparty_passport_score >= 80`
- `counterparty_passport_confidence >= 0.7`

**Rule 9.1.1:** Passport scores are queried at evaluation time and included in context (not stored in policy).

### 9.2 Policy Violations in Passport

Policy violations are recorded in Passport as:

- `PACT-101` failure events (policy domain)
- Evidence includes policy hash and violated rule names

## 10. Versioning

This specification applies to Pact protocol version 4.0 and later.

**Breaking Changes:**

- Schema version updates require protocol version bump
- New comparator/operator types require schema version update
- Changes to canonical serialization require schema version update

**Non-Breaking Changes:**

- Additional optional fields in policy schema
- New context fields (additive)
- Additional rule types (additive)

---

**Status:** Draft (Normative)  
**Last Updated:** 2025-01-XX  
**Protocol Version:** pact/4.0
