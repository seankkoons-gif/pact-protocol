# Pact Passport v4

Protocol Identifier: pact-passport/4.0
Status: Draft (Normative)
Scope: Agent reputation and credit scoring system for Pact protocol v4.

## 1. Design Goals (Normative)

Pact Passport is a **credit bureau for agents**, not an identity system. It provides deterministic reputation scoring based on verifiable transaction outcomes.

Passport MUST:

1. Provide deterministic, reproducible scores for any agent given the same input history
2. Use only structured, verifiable inputs (no free text or raw logs)
3. Weight evidence by recency, counterparty quality, and dispute outcomes
4. Resist gaming through counterparty-weighting and collusion detection
5. Provide confidence intervals or bands for scores
6. Support anti-collusion hooks (even if stubbed in v1)

Passport MUST NOT:

1. Depend on identity verification (Passport scores agents, it does not verify identity)
2. Use raw logs, free text, or unstructured data
3. Require human judgment or subjective quality assessments
4. Depend on external credit bureaus or third-party reputation systems
5. Use machine learning in v1 (deterministic functions only)

## 2. Core Concepts

### 2.1 What Passport Is

Passport is a **credit bureau for agents**: a deterministic scoring system that aggregates verifiable transaction outcomes to produce reputation scores. It enables agents to assess counterparty risk before entering negotiations.

### 2.2 What Passport Is Not

Passport is **not**:

- An identity verification system (identity is handled by KYA/Passport providers)
- A marketplace or order book
- A payment rail or settlement system
- A dispute resolution mechanism (it consumes dispute outcomes, but does not resolve disputes)
- A subjective quality rating system

### 2.3 Passport Score

A **Passport score** is a numeric value between 0 and 100 representing an agent's reputation based on verifiable transaction history. Higher scores indicate better reputation.

### 2.4 Confidence

**Confidence** is a measure of score reliability, expressed as either:
- A value between 0 and 1 (where 1.0 indicates maximum confidence)
- A score band (e.g., `score: 75, confidence: ±5`)

Confidence depends on:
- Number of transactions observed
- Recency of evidence
- Quality of counterparties (weighted by their scores)
- Presence of dispute outcomes

## 3. Inputs (STRICT)

Passport v1 MUST use only the following structured inputs. No other inputs are permitted.

### 3.1 Terminal Settlement Receipts (Success)

A **terminal settlement receipt** is a verifiable record of a successful Pact Intent completion. It MUST include:

```typescript
interface TerminalSettlementReceipt {
  receipt_id: string;                    // Unique receipt identifier
  transcript_id: string;                 // Reference to v4 transcript
  agent_id: string;                      // Agent being scored
  counterparty_id: string;               // Other party in transaction
  intent_type: string;                   // Intent type (e.g., "weather.data")
  price: number;                         // Agreed price
  settled_at_ms: number;                 // Settlement timestamp
  fulfillment_verified: boolean;        // Whether fulfillment was verified
  sla_adherence?: SLAAdherenceEvent;     // Optional SLA adherence data
  signature: string;                     // Cryptographic signature
}
```

**Requirements:**
- Receipts MUST be cryptographically signed
- Receipts MUST reference a valid v4 transcript
- Receipts MUST be terminal (no pending or in-progress receipts)

### 3.2 FailureEvent Tuples

A **FailureEvent** tuple is a structured failure record from the Pact v4 Failure Taxonomy. It MUST conform to the schema defined in `docs/versions/v4/FAILURE_TAXONOMY.md`.

**Requirements:**
- Only terminal failures (terminality: "terminal") are scored
- Non-terminal failures (terminality: "non_terminal") are excluded from scoring
- FailureEvents MUST include valid `fault_domain`, `stage`, and `code` fields
- FailureEvents MUST reference verifiable evidence artifacts

### 3.3 Dispute Outcomes

A **dispute outcome** is a structured record of an arbiter's decision in a dispute resolution process. It MUST include:

```typescript
interface DisputeOutcome {
  dispute_id: string;                    // Unique dispute identifier
  transcript_id: string;                 // Reference to disputed transcript
  agent_id: string;                     // Agent being scored
  counterparty_id: string;              // Other party in dispute
  arbiter_id: string;                   // Arbiter identifier
  outcome: "buyer_wins" | "seller_wins" | "split" | "dismissed";
  fault_attribution: FaultDomain;       // Fault domain assigned by arbiter
  slashed_amount?: number;              // Amount slashed (if any)
  resolved_at_ms: number;                // Resolution timestamp
  evidence_refs: string[];               // References to evidence artifacts
  signature: string;                     // Arbiter's cryptographic signature
}
```

**Requirements:**
- Dispute outcomes MUST be signed by a recognized arbiter
- Dispute outcomes MUST reference valid transcripts
- Dispute outcomes MUST include fault attribution

### 3.4 SLA Adherence Events (Optional)

An **SLA adherence event** is a structured record of whether service level agreements were met. It MAY be included in terminal settlement receipts or provided separately:

```typescript
interface SLAAdherenceEvent {
  transcript_id: string;                 // Reference to transcript
  agent_id: string;                     // Agent being scored
  sla_metrics: {
    latency_ms?: number;                 // Actual latency (if applicable)
    freshness_sec?: number;               // Actual freshness (if applicable)
    max_latency_ms?: number;             // Required max latency
    max_freshness_sec?: number;          // Required max freshness
  };
  adherence_status: "met" | "violated" | "not_applicable";
  verified_at_ms: number;                // Verification timestamp
}
```

**Requirements:**
- SLA adherence events MUST be verifiable (referenced in receipts or transcripts)
- SLA violations MUST be objective and measurable
- Subjective quality assessments are excluded

## 4. Outputs

### 4.1 Pact Score

The **pact_score** is a numeric value between 0 and 100 representing an agent's reputation.

- **0-30**: Poor reputation (high risk)
- **31-60**: Fair reputation (moderate risk)
- **61-80**: Good reputation (low risk)
- **81-100**: Excellent reputation (very low risk)

### 4.2 Confidence

**Confidence** indicates the reliability of the score. It MUST be expressed as either:

1. **Confidence value** (0-1): A single value between 0 and 1 where:
   - `0.0`: No confidence (insufficient data)
   - `1.0`: Maximum confidence (high data quality and volume)

2. **Confidence band**: A tuple `(score, lower_bound, upper_bound)` where:
   - `score`: The computed pact_score
   - `lower_bound`: Minimum plausible score
   - `upper_bound`: Maximum plausible score

**Confidence calculation MUST consider:**
- Number of transactions (more transactions → higher confidence)
- Recency of evidence (more recent evidence → higher confidence)
- Counterparty quality (higher-quality counterparties → higher confidence)
- Presence of dispute outcomes (disputes provide additional signal)

### 4.3 Tier (Optional)

A **tier** is an optional categorical classification of agent reputation:

- **A**: Excellent (pact_score ≥ 80, confidence ≥ 0.8)
- **B**: Good (pact_score ≥ 60, confidence ≥ 0.6)
- **C**: Fair (pact_score ≥ 40, confidence ≥ 0.4)
- **D**: Poor (pact_score < 40 or confidence < 0.4)

Tiers are non-normative and MAY be omitted. If provided, they MUST be computed deterministically from pact_score and confidence.

## 5. Required Properties

### 5.1 Recency Decay

Passport MUST apply **recency decay** to all inputs. More recent evidence MUST be weighted more heavily than older evidence.

**Decay function (v1):**

For an event at timestamp `t_event` and current time `t_now`, the decay weight is:

```
decay_weight = exp(-λ * (t_now - t_event) / T_half)
```

Where:
- `λ = ln(2)` (ensures half-life behavior)
- `T_half` is the half-life period (default: 90 days in milliseconds)
- `t_now - t_event` is the age of the event in milliseconds

**Requirements:**
- Events older than `2 * T_half` MUST have weight < 0.25
- Events older than `4 * T_half` MUST have weight < 0.0625
- Half-life period MUST be configurable but default to 90 days

### 5.2 Counterparty-Weighting (Quality-Adjusted)

Passport MUST weight evidence by the quality of counterparties. Transactions with higher-scoring counterparties MUST contribute more to the score than transactions with lower-scoring counterparties.

**Weighting function (v1):**

For a transaction with counterparty score `cp_score` (0-100), the counterparty weight is:

```
cp_weight = 0.5 + (cp_score / 200)
```

This ensures:
- Counterparty with score 0 → weight 0.5 (minimum)
- Counterparty with score 50 → weight 0.75 (neutral)
- Counterparty with score 100 → weight 1.0 (maximum)

**Requirements:**
- Counterparty scores MUST be computed recursively (counterparty's Passport score at time of transaction)
- If counterparty score is unavailable, default weight MUST be 0.5
- Counterparty-weighting MUST be applied to both success receipts and failure events

### 5.3 Dispute-Outcome Weighting

Dispute outcomes MUST be weighted more heavily than regular transaction outcomes because they represent explicit fault attribution by arbiters.

**Weighting function (v1):**

For a dispute outcome, the weight multiplier is:

```
dispute_weight = 2.0  // Disputes count 2x compared to regular transactions
```

**Requirements:**
- Dispute outcomes where the agent is at fault MUST have negative impact on score
- Dispute outcomes where the agent is not at fault MUST have positive impact on score
- Dismissed disputes MUST have neutral impact (weight 0.5x)
- Split outcomes MUST have neutral impact (weight 0.5x)

### 5.4 Anti-Collusion Hooks

Passport MUST provide an interface for **collusion detection**, even if the implementation is stubbed in v1.

**Collusion detection interface:**

```typescript
interface CollusionDetectionHook {
  detectCluster(
    agent_id: string,
    counterparties: string[],
    transactions: TransactionRecord[]
  ): CollusionSignal;
}

interface CollusionSignal {
  cluster_id?: string;                   // Identified cluster (if any)
  suspicion_score: number;               // 0-1 suspicion level
  evidence: string[];                    // Evidence artifacts
}
```

**Requirements (v1):**
- Collusion detection interface MUST be defined
- v1 implementation MAY be a stub that returns `suspicion_score: 0` for all agents
- Future v2 implementations MUST detect:
  - Circular transaction patterns
  - Excessive self-transactions
  - Coordinated failure injection
  - Sybil agent clusters

**Gaming resistance:**
- If collusion is detected (suspicion_score > threshold), transactions within the cluster MUST be down-weighted or excluded
- Default threshold: `suspicion_score > 0.7`

### 5.5 No Raw Logs or Free Text

Passport MUST NOT use:
- Raw log files
- Free text descriptions
- Unstructured data
- Subjective quality assessments
- Natural language processing

**All inputs MUST be:**
- Structured (JSON schema)
- Verifiable (cryptographically signed or hash-linked)
- Objective (measurable, not subjective)

## 6. v1 Scoring Function

The v1 scoring function MUST be deterministic and use explicit weights. No machine learning is permitted in v1.

### 6.1 Component Scores

The Passport score is computed from three component scores:

1. **Success Score** (0-100): Based on successful terminal settlements
2. **Failure Score** (0-100): Based on failure events (inverted, so fewer failures = higher score)
3. **Dispute Score** (0-100): Based on dispute outcomes

### 6.2 Success Score Calculation

```
success_score = 100 * (weighted_successes / (weighted_successes + weighted_failures + weighted_neutral))
```

Where:
- `weighted_successes = Σ(receipt.decay_weight * receipt.cp_weight * receipt.sla_bonus)`
- `sla_bonus = 1.1 if SLA met, 1.0 otherwise`
- Only terminal settlement receipts are counted

### 6.3 Failure Score Calculation

```
failure_score = 100 * (1 - (weighted_failures / (weighted_successes + weighted_failures + weighted_neutral)))
```

Where:
- `weighted_failures = Σ(failure.decay_weight * failure.cp_weight * failure_severity)`
- `failure_severity` is based on fault_domain:
  - `policy`: 0.5 (less severe, buyer may have misconfigured)
  - `identity`: 0.7 (moderate severity)
  - `negotiation`: 0.6 (moderate severity)
  - `settlement`: 0.9 (high severity, payment issues)
  - `recursive`: 0.8 (high severity, system failure)
- Only terminal failures are counted

### 6.4 Dispute Score Calculation

```
dispute_score = 100 * (wins / (wins + losses + dismissals))
```

Where:
- `wins = Σ(dispute.decay_weight * dispute.cp_weight)` for disputes where agent is not at fault
- `losses = Σ(dispute.decay_weight * dispute.cp_weight * 2.0)` for disputes where agent is at fault
- `dismissals = Σ(dispute.decay_weight * dispute.cp_weight * 0.5)` for dismissed/split disputes

### 6.5 Final Score Aggregation

```
pact_score = (success_weight * success_score) + 
             (failure_weight * failure_score) + 
             (dispute_weight * dispute_score)
```

**Default weights (v1):**
- `success_weight = 0.5`
- `failure_weight = 0.3`
- `dispute_weight = 0.2`

**Requirements:**
- Weights MUST sum to 1.0
- Weights MUST be configurable but have deterministic defaults
- Score computation MUST be deterministic (same inputs → same score)

### 6.6 Confidence Calculation

```
confidence = min(1.0, 
  (transaction_count_factor * 0.4) + 
  (recency_factor * 0.3) + 
  (counterparty_quality_factor * 0.3)
)
```

Where:
- `transaction_count_factor = min(1.0, log10(total_transactions + 1) / log10(100))`
- `recency_factor = weighted_average(decay_weights)` (higher for more recent evidence)
- `counterparty_quality_factor = weighted_average(cp_weights)` (higher for better counterparties)

**Requirements:**
- Confidence MUST be between 0 and 1
- Confidence MUST increase with more transactions
- Confidence MUST increase with more recent evidence
- Confidence MUST increase with higher-quality counterparties

## 7. Gaming Resistance Principles

### 7.1 Default Behaviors When Evidence Missing

**Insufficient data:**
- If an agent has fewer than 3 transactions, `pact_score` MUST be set to 50 (neutral)
- `confidence` MUST be set to 0.0 (no confidence)
- Tier MUST be set to "D" (if tier is provided)

**Missing counterparty scores:**
- If counterparty score is unavailable, default `cp_weight` MUST be 0.5 (neutral)
- This prevents new agents from being penalized for transacting with other new agents

**Missing dispute outcomes:**
- If no dispute outcomes exist, `dispute_score` MUST be set to 50 (neutral)
- `dispute_weight` in final aggregation MUST remain 0.2 (not reduced)

**Missing SLA adherence:**
- If SLA adherence is not provided, `sla_bonus` MUST be 1.0 (no bonus, no penalty)

### 7.2 Gaming Resistance Mechanisms

**Recency decay:**
- Prevents agents from "gaming" by accumulating many old transactions
- Recent failures have more impact than old successes

**Counterparty-weighting:**
- Prevents agents from gaming by transacting only with low-quality counterparties
- Encourages transacting with high-quality agents

**Dispute-outcome weighting:**
- Prevents agents from gaming by avoiding disputes
- Disputes provide explicit fault attribution

**Collusion detection (v1 stub, v2 implementation):**
- Interface exists for detecting coordinated gaming
- v1 stub returns no suspicion; v2 MUST implement detection

**Terminal-only scoring:**
- Non-terminal failures are excluded (prevents gaming through retry spam)
- Only completed transactions are scored

### 7.3 Anti-Gaming Defaults

**New agent handling:**
- Agents with < 3 transactions: score = 50, confidence = 0.0
- Prevents new agents from being unfairly penalized or rewarded

**Failure handling:**
- Terminal failures are scored, non-terminal failures are ignored
- Prevents gaming through strategic non-terminal failures

**Dispute handling:**
- Dismissed/split disputes have neutral impact (0.5x weight)
- Prevents gaming through frivolous disputes

## 8. Future v2

The following features are planned for Passport v2 but are not included in v1:

### 8.1 Undercollateralized Commitments

**Placeholder:**
- v2 MAY score agents based on their history of undercollateralized commitments
- Agents with a history of failing to meet collateral requirements MAY receive lower scores
- Implementation details TBD

### 8.2 Insurer/Underwriter Integrations

**Placeholder:**
- v2 MAY integrate with external insurers or underwriters
- Insurance premiums or underwriting decisions MAY influence Passport scores
- Integration interface TBD

### 8.3 ZK Attestations

**Placeholder:**
- v2 MAY accept zero-knowledge attestations as evidence
- ZK attestations MAY prove transaction history without revealing full details
- ZK proof verification and scoring integration TBD

### 8.4 Machine Learning (Optional)

**Placeholder:**
- v2 MAY include optional ML-based scoring components
- ML components MUST be deterministic and reproducible
- ML models MUST be versioned and auditable
- Deterministic v1 scoring MUST remain available as fallback

## 9. Compliance and Verification

### 9.1 Deterministic Scoring

Passport scoring MUST be deterministic:
- Same input history → same score
- Score computation MUST be reproducible by any compliant implementation
- No randomness or non-deterministic operations are permitted

### 9.2 Verifiability

All inputs to Passport MUST be verifiable:
- Terminal settlement receipts MUST be cryptographically signed
- FailureEvents MUST reference verifiable transcripts
- Dispute outcomes MUST be signed by recognized arbiters
- SLA adherence events MUST be referenced in receipts or transcripts

### 9.3 Auditability

Passport implementations MUST provide:
- Complete audit trail of score computation
- List of all inputs used (with references)
- Intermediate component scores (success, failure, dispute)
- Confidence calculation breakdown

## 10. Normative Requirements Summary

**MUST:**
- Use only structured, verifiable inputs (receipts, FailureEvents, dispute outcomes, SLA events)
- Apply recency decay to all inputs
- Weight evidence by counterparty quality
- Weight dispute outcomes more heavily than regular transactions
- Provide collusion detection interface (even if stubbed)
- Compute scores deterministically
- Provide confidence values or bands
- Exclude raw logs, free text, or unstructured data
- Handle missing evidence with neutral defaults

**MUST NOT:**
- Depend on identity verification (Passport scores, it does not verify identity)
- Use machine learning in v1
- Use subjective quality assessments
- Depend on external credit bureaus
- Require human judgment

**SHOULD:**
- Provide tier classifications (optional but recommended)
- Use confidence bands for better interpretability
- Implement collusion detection in v2
- Support configurable weights and decay parameters

**MAY:**
- Include SLA adherence events (optional input)
- Provide tier classifications (optional output)
- Support future v2 features (undercollateralized commitments, insurer integrations, ZK attestations)
