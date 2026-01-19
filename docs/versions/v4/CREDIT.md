# Pact Agent Credit v1 (Undercollateralized Commitments)

Protocol Identifier: pact-credit/1.0  
Status: Draft (Normative)  
Scope: Deterministic, policy- and Passport-gated credit system for undercollateralized commitments in Pact v4.

## 1. Design Goals (Normative)

Pact Agent Credit v1 enables agents to enter commitments with **partial collateral** based on their Passport reputation score and confidence. Credit decisions are **deterministic**, **policy-gated**, and **transcript-embedded**.

Credit v1 MUST:

1. **Be Deterministic**: Same Passport score + confidence + history → same credit terms
2. **Be Policy-Gated**: Credit eligibility enforced by buyer policy constraints
3. **Be Passport-Gated**: Credit terms derived from Passport score and confidence
4. **Be Transcript-Embedded**: Credit decisions referenced in transcripts via evidence_refs
5. **Enforce Exposure Limits**: Hard caps on outstanding exposure per agent and per counterparty
6. **Support Kill Switches**: Automatic credit revocation on policy violations or identity failures
7. **Be Idempotent**: Credit events keyed by transcript_hash prevent double-counting

Credit v1 MUST NOT:

1. **No Lending Markets**: Credit is not a lending market; no interest rate discovery
2. **No External APIs**: Credit decisions depend only on Passport scores and transcript history
3. **No Machine Learning**: Credit terms computed via deterministic functions only
4. **No Network Calls**: Credit evaluation is side-effect free (no web APIs, no external databases)

## 2. Core Concepts

### 2.1 What "Credit" Means in Pact

**Credit** in Pact v1 means a **commitment with partial collateral**. Instead of requiring 100% escrow upfront, agents with sufficient Passport reputation may enter commitments with reduced collateral (e.g., 20%, 50%, or 80% collateral).

**Example:**
- Agent A (Tier A, 20% collateral) agrees to pay $100 for a service
- Agent A escrows $20 (20% collateral)
- Agent A has $80 of **credit exposure** (undercollateralized commitment)
- If Agent A defaults, the counterparty loses up to $80 (the unsecured portion)

### 2.2 Credit vs. Escrow

| Feature | Full Escrow | Credit (Partial Collateral) |
|---------|-------------|----------------------------|
| Collateral Required | 100% | 20-80% (tier-dependent) |
| Risk to Counterparty | None (fully secured) | Partial (unsecured exposure) |
| Eligibility | All agents | Passport-gated (Tier A/B only) |
| Default Impact | None (funds locked) | Counterparty loses unsecured portion |

### 2.3 Credit Terms

**Credit terms** are deterministic limits and requirements derived from Passport score and confidence:

- `max_outstanding_exposure_usd`: Maximum total credit exposure across all commitments
- `max_per_intent_usd`: Maximum credit exposure per single intent
- `max_per_counterparty_usd`: Maximum credit exposure per counterparty
- `collateral_ratio`: Required collateral percentage (e.g., 0.20 = 20% collateral)
- `required_escrow`: Whether escrow is required (false for Tier A, true for Tier C)

## 3. Non-Goals (v1)

The following features are **explicitly out of scope** for Credit v1:

1. **Lending Markets**: No interest rate discovery, no credit markets, no secondary trading
2. **Interest Rates**: No interest charged on credit exposure (v1 is zero-interest)
3. **Credit Insurance**: No insurance or underwriting beyond Passport scoring
4. **Dynamic Pricing**: Credit terms are fixed per tier (no dynamic adjustment based on market conditions)
5. **Cross-Chain Credit**: Credit is rail-agnostic but not cross-chain (single rail per commitment)
6. **Credit Transfer**: Credit exposure cannot be transferred or sold to third parties

## 4. Eligibility Criteria

Credit eligibility is determined by:

1. **Passport Score**: Agent's Passport score (0-100)
2. **Passport Confidence**: Agent's Passport confidence (0-1)
3. **Clean Recent History**: No recent PACT-1xx violations, dispute losses, or identity failures

### 4.1 Tier Assignment

Credit terms are assigned based on **tiers** derived from Passport score and confidence:

**Tier C (No Credit):**
- `score < 70` OR `confidence < 0.6`
- `required_escrow: true` (100% collateral required)
- `max_outstanding_exposure_usd: 0` (no credit allowed)

**Tier B (Limited Credit):**
- `score >= 70 AND score < 85` AND `confidence >= 0.7`
- `required_escrow: true` (escrow still required)
- `collateral_ratio: 0.50` (50% collateral, 50% credit)
- `max_outstanding_exposure_usd: 1000` (example)
- `max_per_intent_usd: 500`
- `max_per_counterparty_usd: 200`

**Tier A (Extended Credit):**
- `score >= 85` AND `confidence >= 0.8`
- `required_escrow: false` (escrow optional, can use credit)
- `collateral_ratio: 0.20` (20% collateral, 80% credit)
- `max_outstanding_exposure_usd: 5000` (example)
- `max_per_intent_usd: 2000`
- `max_per_counterparty_usd: 1000`

**Tier Assignment Rules:**
- Tier assignment MUST be deterministic (same score + confidence → same tier)
- Tier assignment MUST be computed at commitment time (not cached)
- Tier downgrades apply immediately (no grace period)

## 5. Kill Switch Rules

Credit eligibility is **revoked** (kill switch triggered) if any of the following occur:

### 5.1 Policy Violations (PACT-1xx)

**Rule 5.1.1: Recent Policy Violations**

If agent has any **PACT-1xx** failure code within the **kill switch window** (default: 30 days):

- `allowed = false` (credit denied)
- `reason_codes = ["PACT-1xx_VIOLATION"]`
- Tier downgraded to Tier C (no credit)

**PACT-1xx codes that trigger kill switch:**
- `PACT-101`: Policy violation (generic)
- `PACT-102`: Untrusted issuer
- `PACT-103`: Trust tier too low
- `PACT-110`: Failure rate too high
- `PACT-111`: Timeout rate too high
- Any other `PACT-1xx` code

**Window Configuration:**
- Default window: 30 days (configurable per policy)
- Window measured from failure event timestamp to current time
- Kill switch applies to **all** credit requests (not just specific counterparties)

### 5.2 Dispute Losses

**Rule 5.2.1: Recent Dispute Losses**

If agent has a **dispute loss** (agent at fault) within the kill switch window:

- `allowed = false` OR tier downgraded (implementation-dependent)
- `reason_codes = ["DISPUTE_LOSS"]`
- Tier downgraded by one level (A → B, B → C)

**Dispute Loss Definition:**
- Dispute outcome where agent is at fault (e.g., `seller_wins` if agent is buyer)
- Dispute outcome explicitly attributing fault to agent
- Dispute outcome with `fault_attribution` matching agent's role

**Window Configuration:**
- Default window: 60 days (longer than policy violations)
- Dispute losses are less severe than policy violations (may downgrade instead of hard-kill)

### 5.3 Identity Failures

**Rule 5.3.1: Recent Identity Failures**

If agent has a **PACT-2xx** failure code (identity/Passport failure) within the kill switch window:

- `allowed = false` (credit denied)
- `reason_codes = ["IDENTITY_FAILURE"]`
- Tier downgraded to Tier C (no credit)

**PACT-2xx codes that trigger kill switch:**
- `PACT-201`: Signature invalid
- `PACT-202`: Credential expired
- `PACT-205`: Passport required but not provided
- `PACT-206`: Passport invalid
- `PACT-208`: Passport tier too low
- Any other `PACT-2xx` code

**Window Configuration:**
- Default window: 30 days (same as policy violations)
- Identity failures are critical (hard-kill, no downgrade)

### 5.4 Repeated Rail Timeouts (PACT-4xx)

**Rule 5.4.1: Excessive Settlement Failures**

If agent has **excessive PACT-4xx** failures (settlement rail timeouts) within the window:

- Tier downgraded (not hard-kill unless excessive)
- `reason_codes = ["SETTLEMENT_FAILURES"]`
- Limits reduced (e.g., `max_outstanding_exposure_usd` reduced by 50%)

**Excessive Threshold:**
- Default: 3+ PACT-4xx failures in 7 days
- Hard-kill threshold: 10+ PACT-4xx failures in 30 days

**Window Configuration:**
- Downgrade window: 7 days
- Hard-kill window: 30 days
- PACT-4xx failures are less severe than policy violations (downgrade first, hard-kill only if excessive)

## 6. Exposure Limits

### 6.1 Outstanding Exposure

**Outstanding exposure** is the sum of all unsecured credit across all active commitments:

```
outstanding_exposure_usd = Σ(commitment_amount_usd - collateral_amount_usd)
```

Where:
- `commitment_amount_usd`: Total commitment value (agreed price)
- `collateral_amount_usd`: Escrowed collateral amount

**Enforcement:**
- `outstanding_exposure_usd <= max_outstanding_exposure_usd` (hard cap)
- Exposure computed at commitment time (before commitment is accepted)
- Exposure updated when commitments settle or fail

### 6.2 Per-Intent Exposure

**Per-intent exposure** is the unsecured credit for a single commitment:

```
per_intent_exposure_usd = commitment_amount_usd - collateral_amount_usd
```

**Enforcement:**
- `per_intent_exposure_usd <= max_per_intent_usd` (hard cap)
- Checked at commitment time (before ACCEPT)

### 6.3 Per-Counterparty Exposure

**Per-counterparty exposure** is the sum of unsecured credit with a specific counterparty:

```
per_counterparty_exposure_usd = Σ(commitment_amount_usd - collateral_amount_usd)
WHERE counterparty_id = <target_counterparty>
```

**Enforcement:**
- `per_counterparty_exposure_usd <= max_per_counterparty_usd` (hard cap)
- Checked at commitment time (before ACCEPT)
- Counterparty exposure tracked separately per counterparty

## 7. Credit Decision Transcripting

### 7.1 Evidence References

Credit decisions MUST be referenced in transcripts via `evidence_refs`:

```json
{
  "evidence_refs": [
    "credit_decision:agent_id:transcript_hash",
    "passport_score:agent_id:score:confidence",
    "credit_tier:agent_id:tier",
    "exposure_check:agent_id:outstanding:max"
  ]
}
```

### 7.2 Credit Event Recording

Credit events (credit extended, credit denied, exposure updated) MUST be recorded in `credit_events` table:

```typescript
interface CreditEvent {
  id: number;
  agent_id: string;
  ts: number;
  transcript_hash: string;  // Idempotency key
  delta_usd: number;        // Change in exposure (+ or -)
  counterparty_agent_id: string | null;
  reason_code: string;      // "CREDIT_EXTENDED", "CREDIT_DENIED", "SETTLEMENT", "FAILURE"
}
```

**Idempotency:**
- Credit events keyed by `transcript_hash` (prevent double-counting)
- Same transcript_hash → same credit event (idempotent ingestion)

### 7.3 Transcript Hash Embedding

Credit decisions MUST reference transcript hash in evidence:

- `transcript_hash`: SHA-256 hash of transcript up to commitment point
- Credit decision embedded in transcript `evidence_refs`
- Credit event stored with `transcript_hash` for idempotency

## 8. Failure Taxonomy Integration

### 8.1 Credit Denial as Policy Violation

If credit is denied due to **eligibility/policy**, it MUST:

1. **Abort inside Pact Boundary**: Negotiation/settlement blocked immediately
2. **Emit Failure Event**: Canonical failure event with appropriate code
3. **Include Evidence**: Credit decision evidence in `evidence_refs`

### 8.2 Failure Code Mapping

**Credit Denial → Failure Codes:**

| Credit Denial Reason | Failure Code | Fault Domain | Stage |
|---------------------|--------------|--------------|-------|
| Policy violation (PACT-1xx) | `PACT-101` | `policy` | `admission` or `commitment` |
| Identity failure (PACT-2xx) | `PACT-201` | `identity` | `admission` |
| Exposure limit exceeded | `PACT-101` | `policy` | `commitment` |
| Kill switch triggered | `PACT-101` | `policy` | `admission` or `commitment` |
| Tier too low (no credit) | `PACT-101` | `policy` | `commitment` |

**Rule 8.2.1: Credit Denial Evidence**

Credit denial failure events MUST include:

```json
{
  "code": "PACT-101",
  "stage": "commitment",
  "fault_domain": "policy",
  "evidence_refs": [
    "credit_decision:agent_id:transcript_hash",
    "credit_tier:agent_id:tier",
    "exposure_check:agent_id:outstanding:max",
    "kill_switch:agent_id:reason_code"
  ]
}
```

## 9. Deterministic Requirements

### 9.1 Same Ledger State → Same Credit Terms

Credit terms MUST be deterministic:

- Same Passport score + confidence → same tier
- Same tier → same credit terms (limits, collateral ratio)
- Same exposure state → same `canExtendCredit` result

### 9.2 Idempotent Event Ingestion

Credit events MUST be idempotent:

- Same `transcript_hash` → same credit event (no double-counting)
- Credit event ingestion keyed by `transcript_hash + agent_id`
- Duplicate transcript_hash → event ignored (no exposure update)

### 9.3 No External State

Credit evaluation MUST be side-effect free:

- No network calls (no web APIs)
- No external databases (only Passport storage)
- No random numbers (deterministic functions only)
- No system time (use transcript timestamps)

## 10. Storage Schema

### 10.1 Credit Accounts Table

```sql
CREATE TABLE credit_accounts (
  agent_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL CHECK(tier IN ('A', 'B', 'C')),
  updated_at INTEGER NOT NULL,
  disabled_until INTEGER,  -- NULL if enabled, timestamp if disabled
  reason TEXT,              -- Reason for disable (kill switch reason)
  FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
);
```

### 10.2 Credit Exposure Table

```sql
CREATE TABLE credit_exposure (
  agent_id TEXT PRIMARY KEY,
  outstanding_usd REAL NOT NULL DEFAULT 0,
  per_counterparty_json TEXT NOT NULL DEFAULT '{}',  -- JSON: {counterparty_id: exposure_usd}
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
);
```

### 10.3 Credit Events Table

```sql
CREATE TABLE credit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  transcript_hash TEXT NOT NULL,
  delta_usd REAL NOT NULL,
  counterparty_agent_id TEXT,
  reason_code TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(agent_id),
  UNIQUE(transcript_hash, agent_id)  -- Idempotency key
);
```

**Indexes:**
- `CREATE INDEX idx_credit_events_agent_id ON credit_events(agent_id, ts)`
- `CREATE INDEX idx_credit_events_transcript_hash ON credit_events(transcript_hash)`

## 11. Risk Engine API

### 11.1 computeCreditTerms

```typescript
function computeCreditTerms(
  agent_id: string,
  as_of?: number  // Optional timestamp (default: now)
): CreditTerms
```

**Returns:**
```typescript
interface CreditTerms {
  tier: "A" | "B" | "C";
  max_outstanding_exposure_usd: number;
  max_per_intent_usd: number;
  max_per_counterparty_usd: number;
  collateral_ratio: number;  // 0.20 = 20% collateral
  required_escrow: boolean;
  disabled_until?: number;   // Kill switch timestamp
  reason?: string;            // Kill switch reason
}
```

**Deterministic:**
- Same Passport score + confidence → same tier
- Same tier → same credit terms
- Kill switches applied deterministically

### 11.2 canExtendCredit

```typescript
function canExtendCredit(
  agent_id: string,
  counterparty_id: string,
  amount_usd: number,
  as_of?: number
): CreditDecision
```

**Returns:**
```typescript
interface CreditDecision {
  allowed: boolean;
  required_collateral_usd: number;
  reason_codes: string[];  // Empty if allowed, non-empty if denied
}
```

**Checks:**
1. Kill switch status (disabled_until)
2. Tier eligibility (Tier C → no credit)
3. Outstanding exposure cap
4. Per-intent exposure cap
5. Per-counterparty exposure cap

### 11.3 applyCreditEventFromTranscript

```typescript
function applyCreditEventFromTranscript(
  transcript: TranscriptV4
): void
```

**Process:**
1. Extract credit-relevant events from transcript (commitment, settlement, failure)
2. Compute exposure delta (positive for credit extended, negative for settlement/failure)
3. Insert credit event (idempotent on transcript_hash)
4. Update credit_exposure table

**Idempotency:**
- Same transcript_hash → event ignored (no double-counting)
- Exposure updates are additive (delta applied once)

## 12. Versioning

This specification applies to Pact protocol version 4.0 and later.

**Breaking Changes:**
- Tier definitions or credit term calculations require version bump
- Storage schema changes require migration

**Non-Breaking Changes:**
- Additional kill switch rules (additive)
- Additional exposure limit types (additive)
- Additional reason codes (additive)

---

**Status:** Draft (Normative)  
**Last Updated:** 2025-01-XX  
**Protocol Version:** pact/4.0  
**Credit Version:** pact-credit/1.0
