# Pact: Insurer Underwriting View

**Audience:** Underwriters, Risk Officers, Compliance  
**Goal:** Price and underwrite risk for autonomous agent transactions using Pact evidence.

---

## 1. What is being underwritten

You are underwriting **operational and counterparty risk** of autonomous transactions executed inside a Pact Boundary.

Pact does not eliminate risk. It makes risk:

- measurable
- attributable
- auditable
- repeatable

The underwriting unit is not "the AI." It is the **Pact identity** (signer pubkey / Passport) and the **provider identity** that signed the transaction.

---

## 2. What Pact gives an insurer

### A) Proof of evidence integrity

- Hash chain validity
- Round signatures verified
- Replayable transcript (`pact-transcript/4.0`)

### B) Deterministic responsibility attribution

DBL v2 assigns:

- `fault_domain`
- `required_next_actor`
- `required_action`
- `terminal`
- `confidence`

### C) Standardized rules (Constitution hash)

All decisions and outputs reference:

```json
"constitution": { "version": "constitution/1.0", "hash": "…" }
```

This turns "trust us" into "verify the rulebook."

### D) A portable claim artifact

The GC View is the insurer-readable summary, derived deterministically from transcript + evidence.

---

## 3. Underwriter decision flow (5 minutes)

### Step 1 — Verify Constitution (rulebook)

Approve/accept the constitution hash (and version).  
If not accepted → do not underwrite.

### Step 2 — Verify integrity

If integrity is invalid, coverage defaults to denial or exclusion:

- `integrity.hash_chain != VALID` → deny
- `signatures_verified.verified != total` → deny or exclude (unless explicitly allowed)

### Step 3 — Classify outcome type

Use `executive_summary.status`:

| Status | Risk Category |
|--------|---------------|
| `COMPLETED` | normal |
| `ABORTED_POLICY` | guardrails working (buyer-side risk) |
| `FAILED_PROVIDER_UNREACHABLE` | infra/provider ops risk |
| `FAILED_PROVIDER_API_MISMATCH` | integration risk |
| `FAILED_TIMEOUT` | SLA/settlement ops risk |
| `FAILED_INTEGRITY` | tamper/fraud risk (high severity) |

### Step 4 — Check DBL v2 responsibility

Underwriting should anchor to:

```json
"responsibility": { "judgment": { ... } }
```

If `confidence < 0.7`, treat the claim as "shared/indeterminate" for pricing unless policy says otherwise.

---

## 4. Rating model (practical, deterministic)

Pact enables a deterministic base premium model per identity pair:

### A) Base risk tier (from Passport + history)

Compute a tier for both buyer and provider:

**Tier A (low risk):**
- Passport score ≥ +0.20
- disputes_lost ≤ 1% of settlements
- SLA violations ≤ 2% of settlements

**Tier B (medium risk):**
- Passport score between −0.10 and +0.20
- disputes_lost ≤ 5%
- SLA violations ≤ 5%

**Tier C (high risk):**
- Passport score < −0.10 OR disputes_lost > 5% OR integrity incidents > 0

**Policy recommendation:** if either side is Tier C, require escrow or deny underwriting.

### B) Outcome-based surcharges (per failure category)

If the covered population shows:

- high `FAILED_PROVIDER_UNREACHABLE` rate → provider ops surcharge
- high `FAILED_PROVIDER_API_MISMATCH` rate → integration surcharge
- high `FAILED_TIMEOUT` rate → SLA surcharge
- any integrity failures → fraud surcharge or exclusion

### C) Confidence discount

If DBL confidence is low, increase premium because causality is less clear:

| Confidence | Adjustment |
|------------|------------|
| ≥ 0.9 | no surcharge |
| 0.7–0.9 | +10–25% surcharge |
| < 0.7 | +50% surcharge or exclude |

---

## 5. Coverage language: what Pact supports

### Recommended covered events

- Provider non-performance when DBL says `PROVIDER_AT_FAULT`
- Buyer policy violation when DBL says `BUYER_AT_FAULT` (optional)
- Settlement failures and SLA timeouts when `required_action` indicates refund/retry

### Recommended exclusions

- `FAILED_INTEGRITY` or invalid signatures (tamper risk)
- Transactions outside Pact Boundary (no transcript)
- Any transaction whose GC view is produced under an unapproved Constitution hash

---

## 6. What evidence an insurer needs at claim time

**Minimum claim packet:**

- Transcript (`pact-transcript/4.0`)
- GC View (`gc_view/1.0`)
- DBL judgment artifact (`dbl/2.0`)
- Evidence bundle (if available)
- Constitution hash used

**Claim evaluation is deterministic:**

- insurer can replay transcript
- verify hash chain + signatures
- verify DBL judgment logic under constitution version

---

## 7. Underwriter "go / no-go" checklist

- ✅ Accept constitution hash
- ✅ Integrity valid (hash chain + signatures)
- ✅ DBL confidence ≥ threshold
- ✅ Passport tier acceptable
- ✅ Status category within covered events
- ✅ `required_next_actor` / `required_action` enforceable under policy

**If all pass → underwrite.**

---

## 8. Practical underwriting knobs (policy conditions)

Pact makes underwriting enforceable via policy gates:

- Minimum provider passport score
- Maximum dispute rate
- SLA threshold requirements
- Mandatory wallet signature requirements
- Deny known contention/double-commit risk

**Example underwriting gate:**

- Require provider passport score ≥ 0.0
- Require `integrity.signatures_verified == total`
- Deny if contention scan indicates `DOUBLE_COMMIT`

---

## 9. Why this is insurable

Insurers underwrite what they can measure and attribute.

**Without Pact:**
- agent failures are ambiguous
- logs are mutable
- counterparties deny responsibility

**With Pact:**
- evidence is immutable
- attribution is deterministic
- required remediation is explicit

**That's the core underwriting unlock.**
