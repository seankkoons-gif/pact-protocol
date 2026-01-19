# Autonomous API Procurement — Canonical Flow

**Use Case:** Autonomous agents procuring API capabilities on behalf of applications or users  
**Protocol Version:** `pact-transcript/4.0`  
**Audience:** Enterprise architects, API platform teams, integration engineers  
**Status:** Flow Specification (Phase A)

> **Note:** This flow relies on the guarantees defined in [`docs/versions/v4/IMMUTABILITY_AND_GUARANTEES.md`](../versions/v4/IMMUTABILITY_AND_GUARANTEES.md).

---

## Problem

### Why Enterprises Can't Let Agents Buy APIs Today

Enterprises face a **responsibility gap** when considering autonomous agent procurement:

1. **No Audit Trail**: When an agent purchases an API, there is no cryptographically verifiable record of:
   - What was negotiated
   - Why a provider was selected
   - Whether policy constraints were respected
   - Who is responsible if something goes wrong

2. **No Policy Enforcement**: Agents can violate spending limits, trust requirements, or SLA constraints with no enforcement mechanism. Policy exists in code, but agents can bypass it through bugs, prompt drift, or runtime errors.

3. **No Blame Attribution**: When a transaction fails, it's unclear:
   - Whether the buyer violated policy
   - Whether the provider failed to deliver
   - Whether the settlement rail timed out
   - Whether a sub-agent dependency failed

4. **No Legal Defensibility**: In disputes or regulatory audits, there is no evidence bundle that can be:
   - Shared with auditors
   - Presented in legal proceedings
   - Verified independently without trusting logs

5. **No Deterministic Replay**: Decisions cannot be replayed to verify correctness. "Why did the agent pay $0.10 when the max was $0.05?" cannot be answered definitively.

**The Responsibility Gap**: Enterprises cannot deploy autonomous agents to purchase APIs because they cannot prove the agent acted within policy, cannot attribute blame when failures occur, and cannot defend decisions in audits or disputes.

**Pact's Solution**: Pact provides a non-bypassable execution boundary (Pact Boundary Runtime) that enforces policy, records every decision in a cryptographically verifiable transcript, classifies failures with unambiguous blame attribution, and produces evidence bundles suitable for legal proceedings.

---

## Actors

### Buyer Agent

- **Role**: Autonomous agent that needs API capabilities
- **Responsibilities**:
  - Declares intent (what API capability is needed)
  - Defines policy constraints (max price, trust requirements, SLA constraints)
  - Executes negotiation strategy (when to ACCEPT, BID, COUNTER, REJECT)
  - Initiates settlement after agreement
- **Example**: Enterprise agent that procures weather data, LLM inference, or payment processing APIs

### Provider Agent/API

- **Role**: API service that offers capabilities
- **Responsibilities**:
  - Receives intent
  - Generates quotes (ASK rounds)
  - Delivers service after settlement
- **Example**: Weather API provider, LLM service, payment gateway

### Settlement Rail (Abstract)

- **Role**: Payment execution mechanism
- **Responsibilities**:
  - Receives settlement instruction from Pact
  - Executes payment
  - Returns settlement result (success or failure)
- **Implementations**: Boundary mode (mock), Stripe, escrow contracts, custom payment processors

### Optional: Verifier/Observer Agent

- **Role**: Third-party verifier or auditor
- **Responsibilities**:
  - Verifies transcript integrity
  - Validates evidence bundles
  - Replays transcripts for audit
- **Example**: Enterprise auditor, insurer, regulatory compliance officer

---

## Happy Path Sequence

### Step 1: Intent Declaration

**Buyer Agent Action:**
```
"I need weather.data for NYC with:
 - Max price: $0.05
 - Max latency: 50ms
 - Min freshness: 10 seconds
 - Settlement: boundary mode"
```

**Pact Intervention:**
- Pact Boundary Runtime initializes
- Policy is loaded: `{ max_price: 0.05, max_latency_ms: 50, min_freshness_sec: 10 }`
- Policy hash is computed: `policy_hash = sha256(canonical(policy))`
- Transcript initialized with `transcript_version: "pact-transcript/4.0"`
- INTENT round created (round 0):
  - Signed by buyer
  - Hash-linked (uses `intent_id + created_at_ms` as initial hash)
  - Policy hash embedded

**Artifact:** Transcript initialized with INTENT round

---

### Step 2: Provider Discovery (Out-of-Scope Discovery)

**Buyer Agent Action:**
- Queries provider directory (out-of-scope discovery: manual list, registry, or discovery service)
- Finds provider: `weather-api-provider-1` offering `weather.data`
- Provider has:
  - Passport score: 85
  - SLA credential: verified
  - Endpoint: `https://api.weather.example.com`

**Pact Intervention:**
- Policy evaluation: Does provider meet trust requirements?
  - If policy requires `min_passport_score: 80` → ✅ Pass (85 >= 80)
  - If policy requires `sla_credential: true` → ✅ Pass
- If policy check fails → Abort with PACT-101

**Artifact:** Provider selected (or rejection with policy violation)

---

### Step 3: Negotiation

**Provider Action:**
- Receives intent
- Generates quote: ASK round (round 1)
  - Price: $0.04
  - Latency: 45ms
  - Freshness: 8 seconds
- Signs ASK round
- Sends to buyer

**Buyer Agent Action:**
- Receives ASK
- Evaluates quote:
  - Price: $0.04 <= $0.05 (max) → ✅
  - Latency: 45ms <= 50ms (max) → ✅
  - Freshness: 8s >= 10s (min) → ❌ (does not meet freshness requirement)
- Decision: COUNTER (round 2)
  - Price: $0.04 (accept)
  - Freshness: require 10s minimum
- Signs COUNTER round

**Provider Action:**
- Receives COUNTER
- Evaluates: Can deliver 10s freshness? → ✅
- Decision: ACCEPT (round 3)
  - Price: $0.04
  - Freshness: 10s
- Signs ACCEPT round

**Pact Intervention:**
- Each round is:
  - Cryptographically signed
  - Hash-linked to previous round
  - Policy re-evaluated (if policy violation → abort with PACT-101)
- After ACCEPT:
  - Agreement confirmed
  - Settlement instruction prepared

**Artifacts:**
- Round 1: ASK (signed, hash-linked)
- Round 2: COUNTER (signed, hash-linked)
- Round 3: ACCEPT (signed, hash-linked)

---

### Step 4: Policy Gate (Pre-Settlement)

**Pact Intervention:**
- Final policy check before settlement:
  - Re-evaluate policy against final agreed terms:
    - Price: $0.04 <= $0.05 → ✅
    - Latency: 45ms <= 50ms → ✅
    - Freshness: 10s >= 10s → ✅
  - If any constraint violated → Abort with PACT-101, stage: SETTLEMENT
- **Non-bypassable enforcement**: Settlement cannot occur unless policy evaluation succeeds inside the Pact Boundary. The boundary is non-bypassable—agents cannot skip policy checks or execute settlement outside the boundary.
- If policy passes:
  - Settlement instruction generated
  - Settlement instruction includes:
    - Amount: $0.04
    - Recipient: `weather-api-provider-1`
    - Settlement mode: boundary
    - Proof: `transcript_hash: <hash>`

**Artifact:** Settlement instruction (embedded in transcript)

---

### Step 5: Settle

**Settlement Rail Action:**
- Receives settlement instruction
- Executes payment (boundary mode: in-memory balance transfer)
- Returns settlement result:
  - Status: `success`
  - Receipt: `{ receipt_id: "...", amount: 0.04, currency: "USD" }`

**Pact Intervention:**
- Settlement result recorded in transcript
- Receipt embedded in transcript
- Transcript finalized

**Artifact:** Settlement receipt (embedded in transcript)

---

### Step 6: Receipt

**Pact Intervention:**
- Receipt is generated and embedded in transcript
- Receipt includes:
  - `receipt_id`
  - `amount`
  - `currency`
  - `settlement_mode`
  - `transcript_hash` reference

**Artifact:** Receipt object in transcript

---

### Step 7: Transcript

**Pact Intervention:**
- Transcript is finalized:
  - All rounds are hash-linked
  - `final_hash` is computed (hash of entire transcript)
  - Transcript is cryptographically sealed
- Transcript is written to disk: `.pact/transcripts/transcript-<hash>.json`

**Artifact:** Complete v4 transcript with:
- `transcript_version: "pact-transcript/4.0"`
- `transcript_id`
- `intent_id`
- `policy_hash`
- `strategy_hash`
- `identity_snapshot_hash`
- `rounds`: [INTENT, ASK, COUNTER, ACCEPT] (all signed, hash-linked)
- `final_hash` (cryptographic seal)

---

### Step 8: Evidence Bundle

**Pact Intervention (Optional):**
- Evidence bundle can be generated:
  ```bash
  pnpm evidence:bundle .pact/transcripts/transcript-*.json --out ./evidence-bundle --view auditor
  ```
- Bundle includes:
  - `ORIGINAL.json` (if internal view) or `VIEW.json` (if auditor/partner view)
  - `MANIFEST.json` (hash manifest of all files)
  - `SUMMARY.md` (machine-generated narrative)
  - Policy schema (if referenced)
  - Identity snapshots (if referenced, no secrets)
  - Settlement receipt

**Artifact:** Evidence bundle directory with tamper-evident manifest

---

## Failure Paths

### Failure Path 1: Policy Violation (PACT-101)

**Scenario:** Buyer policy requires max price $0.05, but provider quotes $0.10

**Flow:**
1. Intent declared: max price $0.05
2. Provider ASK: price $0.10
3. **Pact Intervention**: Policy evaluation detects violation
   - `offer_price: 0.10 > max_price: 0.05` → Violation
4. **Pact Action**: Negotiation aborted immediately
5. **Failure Event Emitted**:
   ```json
   {
     "code": "PACT-101",
     "stage": "NEGOTIATION",
     "fault_domain": "BUYER",
     "terminality": "terminal",
     "evidence_refs": ["policy_rule:max_price"],
     "timestamp": 1234567890,
     "transcript_hash": "..."
   }
   ```
6. Transcript is terminal (no further rounds)

**Verification:**
```bash
pnpm replay:v4 .pact/transcripts/transcript-*.json
# Output: INTEGRITY VALID, Failure Event: PACT-101 (Policy violation)
```

---

### Failure Path 2: Settlement Timeout (PACT-404)

**Scenario:** Settlement rail times out after 30 seconds

**Flow:**
1. Negotiation completes: ACCEPT at $0.04
2. Policy gate passes
3. Settlement instruction emitted
4. Settlement rail receives instruction
5. **Settlement Rail**: Payment execution times out (30s)
6. **Settlement Rail**: Returns failure: `{ status: "timeout", error: "Rail timeout after 30s" }`
7. **Pact Intervention**: Settlement failure detected
8. **Failure Event Emitted**:
   ```json
   {
     "code": "PACT-404",
     "stage": "SETTLEMENT",
     "fault_domain": "RAIL",
     "terminality": "terminal",
     "evidence_refs": ["settlement_instruction", "rail_error:timeout"],
     "timestamp": 1234567890,
     "transcript_hash": "..."
   }
   ```
9. Transcript is terminal

**Verification:**
```bash
pnpm replay:v4 .pact/transcripts/transcript-*.json
# Output: INTEGRITY VALID, Failure Event: PACT-404 (Settlement timeout)
```

---

### Failure Path 3: Provider Credential Expiry (PACT-202)

**Scenario:** Provider's KYA credential expires during negotiation

**Flow:**
1. Intent declared
2. Provider discovered: has KYA credential (expires in 5 minutes)
3. Negotiation starts: ASK round sent
4. **Time passes**: 6 minutes
5. Buyer sends COUNTER round
6. **Pact Intervention**: Provider credential check detects expiry
   - Credential `expires_at_ms: <current_time` → Expired
7. **Pact Action**: Negotiation aborted
8. **Failure Event Emitted**:
   ```json
   {
     "code": "PACT-202",
     "stage": "NEGOTIATION",
     "fault_domain": "PROVIDER",
     "terminality": "terminal",
     "evidence_refs": ["credential_expiry", "round:1"],
     "timestamp": 1234567890,
     "transcript_hash": "..."
   }
   ```
9. Transcript is terminal

**Verification:**
```bash
pnpm replay:v4 .pact/transcripts/transcript-*.json
# Output: INTEGRITY VALID, Failure Event: PACT-202 (KYA credential expired)
```

---

### Failure Path 4: Deadlock (PACT-303)

**Scenario:** Buyer and provider cannot reach agreement after maximum rounds

**Flow:**
1. Intent declared: max price $0.05
2. Provider ASK: $0.08 (too high)
3. Buyer COUNTER: $0.04 (too low)
4. Provider COUNTER: $0.07 (still too high)
5. Buyer COUNTER: $0.05 (at max)
6. Provider COUNTER: $0.06 (above max)
7. **Maximum rounds reached**: 10 rounds, no agreement
8. **Pact Intervention**: Strategic deadlock detected
9. **Failure Event Emitted**:
   ```json
   {
     "code": "PACT-303",
     "stage": "NEGOTIATION",
     "fault_domain": "NEGOTIATION",
     "terminality": "terminal",
     "evidence_refs": ["round:10", "strategy_hash", "max_rounds_reached"],
     "timestamp": 1234567890,
     "transcript_hash": "..."
   }
   ```
10. Transcript is terminal

**Verification:**
```bash
pnpm replay:v4 .pact/transcripts/transcript-*.json
# Output: INTEGRITY VALID, Failure Event: PACT-303 (Strategic deadlock)
```

---

### Failure Path 5: Dispute/Refund Path (Arbiter Artifact)

**Scenario:** Transaction completes, but buyer disputes quality of service

**Flow:**
1. Happy path completes: Settlement successful, receipt generated
2. Service delivered: Provider returns weather data
3. **Buyer Dispute**: Data quality does not meet SLA (latency was 60ms, not 45ms)
4. **Dispute Opened**: Buyer opens dispute with arbiter
5. **Arbiter Action**:
   - Loads transcript
   - Reviews evidence:
     - SLA commitment: 45ms
     - Actual latency: 60ms (from service logs)
     - Evidence: Service delivery logs, transcript rounds
   - Decision: REFUND (provider violated SLA)
6. **Arbiter Decision Artifact Generated**:
   ```json
   {
     "decision_id": "arbiter-decision-...",
     "transcript_hash": "<transcript_hash>",
     "decision": "REFUND",
     "amounts": {
       "buyer_amount": 0.04,
       "provider_amount": 0.00
     },
     "reason_codes": ["SLA_VIOLATION"],
     "evidence_refs": [
       { "type": "round_hash", "ref": "<ASK_round_hash>" },
       { "type": "receipt_hash", "ref": "<receipt_hash>" }
     ],
     "arbiter_id": "arbiter-1",
     "arbiter_pubkey": "...",
     "issued_at": 1234567890,
     "signature": { ... },
     "schema_version": "pact-arbiter-decision/4.0"
   }
   ```
7. **Transcript Updated**: `arbiter_decision_ref` field added (points to decision artifact hash)
8. **Failure Event Updated** (if not already present):
   - Transcript may have `failure_event` with `code: "PACT-404"` (SLA violation maps to settlement failure)
   - Or new failure event added with arbitration outcome

**Verification:**
```bash
pnpm evidence:bundle .pact/transcripts/transcript-*.json --out ./evidence-bundle --view auditor
pnpm evidence:verify ./evidence-bundle
# Output: INTEGRITY PASS, Decision Artifact: REFUND (SLA_VIOLATION)
```

---

## Artifacts Produced

### 1. PoN Transcript (v4)

**File:** `.pact/transcripts/transcript-<hash>.json`

**Schema:** `schemas/pact_transcript_v4.json`

**Contents:**
- `transcript_version: "pact-transcript/4.0"`
- `transcript_id`: Unique identifier
- `intent_id`: Intent identifier
- `intent_type`: API capability type (e.g., `weather.data`)
- `created_at_ms`: Timestamp
- `policy_hash`: SHA-256 hash of policy (deterministic)
- `strategy_hash`: SHA-256 hash of negotiation strategy (if applicable)
- `identity_snapshot_hash`: SHA-256 hash of identity snapshots (if KYA required)
- `rounds`: Array of negotiation rounds (INTENT, ASK, BID, COUNTER, ACCEPT, etc.)
  - Each round: signed, hash-linked, includes `content_summary`
- `failure_event`: (if failed) Canonical failure event with code, stage, fault_domain
- `final_hash`: SHA-256 hash of entire transcript (cryptographic seal)
- `arbiter_decision_ref`: (if dispute resolved) Hash of arbiter decision artifact

**Verification:**
```bash
pnpm replay:v4 .pact/transcripts/transcript-*.json
# Output: INTEGRITY VALID (or INTEGRITY FAIL with specific errors)
```

---

### 2. Evidence Bundle (Auditor View)

**Directory:** `./evidence-bundle/`

**Contents:**
- `VIEW.json`: Redacted transcript view (auditor perspective)
  - Policy content redacted (replaced with "Policy satisfied" / "Policy violated")
  - Strategy hash redacted (replaced with "Verified strategy adherence")
  - Pricing logic redacted (preserves proof of compliance)
  - Cryptographic integrity preserved (redacted fields include hashes)
- `MANIFEST.json`: Hash manifest of all files
  - `bundle_version: "pact-evidence-bundle/4.0"`
  - `transcript_hash`: Original transcript hash
  - `view: "auditor"`
  - `entries`: Array of files with content hashes
  - `integrity`: Verification status fields
- `SUMMARY.md`: Machine-generated narrative
  - What was attempted
  - What happened
  - Where failure occurred (if applicable)
  - Arbitration outcome (if applicable)
  - No secrets, no PII
- Supporting artifacts (if referenced):
  - Policy schema (if policy hash referenced)
  - Identity snapshots (no secrets)
  - Settlement receipt
  - Arbiter decision artifact (if dispute resolved)

**Generation:**
```bash
pnpm evidence:bundle .pact/transcripts/transcript-*.json --out ./evidence-bundle --view auditor
```

**Verification:**
```bash
pnpm evidence:verify ./evidence-bundle
# Output: INTEGRITY PASS (or INTEGRITY FAIL with list of failing files)
```

---

### 3. Replay Output (Human Narrative)

**Command:** `pnpm replay:v4 <transcript.json>`

**Output Format:**
```
═══════════════════════════════════════════════════════════
  PACT v4 Transcript Replay
  Transcript: transcript-abc123...
═══════════════════════════════════════════════════════════

🟢 INTEGRITY VALID

📋 Intent:
   Type: weather.data
   Scope: NYC
   Created: 2025-01-27T10:00:00.000Z

🔗 Hash Chain:
   Round 0 (INTENT): hash-abc123... ✓
   Round 1 (ASK): hash-def456... ✓ (linked to round 0)
   Round 2 (COUNTER): hash-ghi789... ✓ (linked to round 1)
   Round 3 (ACCEPT): hash-jkl012... ✓ (linked to round 2)

✍️  Signatures:
   Round 0: ✓ Verified (buyer)
   Round 1: ✓ Verified (provider)
   Round 2: ✓ Verified (buyer)
   Round 3: ✓ Verified (provider)

📖 Narrative:
   Round 0: Buyer declares intent: "buyer-agent" initiated a negotiation for "weather.data" at 2025-01-27T10:00:00.000Z.
   Round 1: Seller asks: "provider-1" proposed a price of $0.04 via ASK message at 2025-01-27T10:00:01.000Z.
   Round 2: Buyer counters: "buyer-agent" proposed a counteroffer via COUNTER message at 2025-01-27T10:00:02.000Z.
   Round 3: Buyer accepts: "buyer-agent" accepted the offer via ACCEPT message at 2025-01-27T10:00:03.000Z.

✅ Outcome: Agreement reached
   Final Price: $0.04
   Settlement: boundary mode
   Receipt: receipt-xyz789...

🎉 Transcript verified successfully
```

**If Failure:**
```
🔴 INTEGRITY VALID (with failure)

❌ Failure Event:
   Code: PACT-101
   Stage: NEGOTIATION
   Fault Domain: BUYER
   Terminality: terminal
   
   Narrative: Policy violation detected: offer_price ($0.10) exceeds max_price ($0.05).
   
   Evidence References:
   - policy_rule:max_price
   - round:1 (ASK round)
```

---

### 4. Passport/Credit Inputs (Policy Conditions)

**Note:** Passport scores and credit decisions are **not** top-level transcript fields. They are:

1. **Policy Conditions**: Policy may require:
   - `require_passport: { min_score: 80, min_confidence: 0.7 }`
   - `require_credit: { min_tier: "A" }`
2. **Policy Evaluation**: During provider discovery and negotiation, policy evaluation:
   - Queries Passport for provider score
   - Queries Credit for provider credit tier
   - Evaluates conditions: `provider_passport_score >= 80` → Pass/Fail
3. **Evidence References**: If Passport/Credit check fails:
   - Failure event includes `evidence_refs: ["passport_check", "credit_check"]`
   - Policy evaluation trace references Passport/Credit queries

**Example Policy:**
```json
{
  "max_price": 0.05,
  "require_passport": {
    "min_score": 80,
    "min_confidence": 0.7
  },
  "require_credit": {
    "min_tier": "A"
  }
}
```

**Policy Evaluation:**
- Provider discovered: Passport score = 85, Credit tier = "A"
- Policy check: `85 >= 80` → ✅, `"A" >= "A"` → ✅
- Provider passes policy gate

**If Provider Fails:**
- Policy evaluation fails
- Failure event: `PACT-101` (Policy violation)
- `evidence_refs: ["passport_check:score_too_low", "policy_rule:require_passport"]`

---

## Verification Steps

### Step 1: Verify Transcript Integrity

**Command:**
```bash
pnpm replay:v4 .pact/transcripts/transcript-*.json
```

**Expected Output (Success):**
```
🟢 INTEGRITY VALID
✓ Signatures verified: 4
✓ Hash chain verified: 4 rounds
✓ Transcript verified successfully
```

**Expected Output (Failure):**
```
🔴 INTEGRITY TAMPERED
✗ Hash chain broken at round 2: expected hash-abc123..., got hash-xyz789...
✗ Transcript verification failed
```

**Exit Code:** 0 on success, 1 on failure

---

### Step 2: Generate Evidence Bundle

**Command:**
```bash
pnpm evidence:bundle .pact/transcripts/transcript-*.json --out ./evidence-bundle --view auditor
```

**Expected Output:**
```
✅ Evidence bundle generated: ./evidence-bundle
   Transcript: VIEW.json (auditor view)
   Manifest: MANIFEST.json
   Summary: SUMMARY.md
   Integrity: PASS
```

**Bundle Contents:**
- `VIEW.json`: Redacted transcript (auditor view)
- `MANIFEST.json`: Hash manifest
- `SUMMARY.md`: Narrative summary
- Supporting artifacts (if referenced)

---

### Step 3: Verify Evidence Bundle

**Command:**
```bash
pnpm evidence:verify ./evidence-bundle
```

**Expected Output (Success):**
```
INTEGRITY PASS

Verified files:
  ✓ VIEW.json (hash matches)
  ✓ MANIFEST.json (hash matches)
  ✓ SUMMARY.md (hash matches)
  ✓ policy-schema.json (hash matches, if present)
  ✓ receipt.json (hash matches, if present)
  ✓ arbiter-decision.json (hash matches, if present)

Transcript verification: PASS
Decision artifact verification: PASS (if present)
```

**Expected Output (Failure):**
```
INTEGRITY FAIL

Failed files:
  ✗ SUMMARY.md (hash mismatch: expected abc123..., got xyz789...)
  ✗ VIEW.json (hash mismatch: expected def456..., got uvw012...)

Transcript verification: FAIL
```

**Exit Code:** 0 on success, 1 on failure

---

### Step 4: Verify Recent Transcripts (Optional)

**Command:**
```bash
pnpm replay:verify:recent
# or
pnpm replay:verify --no-historical -- .pact/transcripts
```

**Purpose:** Skip historical transcripts (v1/v2 or older than 30 days) to avoid expired credential warnings

**Expected Output:**
```
ℹ️  Filtered out 5 historical transcript(s) due to --no-historical (v1/v2 or older than 30 days)

Verifying 10 transcript(s)...

transcript-abc123.json: ✅ PASS
transcript-def456.json: ✅ PASS
...

✅ All transcripts verified successfully
```

---

## Non-Goals

This flow specification does **NOT** include:

### No Marketplace

- **Not included**: Order books, limit orders, market orders, price discovery through competition
- **What it is**: 1:1 negotiation protocol between buyer and provider
- **Rationale**: Markets require liquidity and standardization. API procurement is typically 1:1, bespoke contracts.

### No New Payment Rail

- **Not included**: Pact does not implement payment rails
- **What it is**: Settlement rail is abstract; integrators provide implementation (Stripe, escrow, boundary mode)
- **Rationale**: Pact coordinates settlement but does not execute payments. Payment execution is an integration concern.

### No Escrow Expansion

- **Not included**: Pact does not expand escrow functionality beyond coordination
- **What it is**: Pact generates settlement instructions; escrow contracts execute them
- **Rationale**: Escrow is chain-specific and implementation-specific. Pact provides coordination, not execution.

### No ML Negotiation

- **Not included**: ML-based negotiation strategies are not part of this flow
- **What it is**: Negotiation strategy is pluggable; ML can be used, but it's not required
- **Rationale**: ML is non-deterministic. This flow focuses on deterministic policy enforcement and evidence recording. ML can enhance negotiation but does not control it.

---

## Integration Checklist

For enterprise architects implementing this flow:

- [ ] **Buyer Agent**: Implement intent declaration, negotiation strategy, policy definition
- [ ] **Provider**: Implement quote generation (ASK rounds), service delivery
- [ ] **Settlement Rail**: Implement payment execution, receipt generation
- [ ] **Policy Definition**: Define max price, trust requirements, SLA constraints
- [ ] **Transcript Storage**: Configure transcript output directory (`.pact/transcripts`)
- [ ] **Evidence Bundle Generation**: Configure evidence bundle output (optional)
- [ ] **Verification**: Set up transcript verification pipeline (CI/CD or manual)

---

**Document Status:** Flow Specification (Phase A)  
**Protocol Version:** `pact-transcript/4.0`  
**Last Updated:** 2025-01-27
