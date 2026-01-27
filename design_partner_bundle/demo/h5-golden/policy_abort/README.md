# Scenario B: Policy Abort (PACT-101)

## Overview

This scenario demonstrates the Pact Protocol's policy enforcement mechanism. When a provider's offer fails to satisfy the buyer's pre-declared policy constraints, the negotiation terminates immediately with a documented `PACT-101` failure event.

**This is a protective outcome.** The policy abort prevented the buyer from accepting terms that would have violated their declared constraints.

## Transaction Summary

| Field | Value |
|-------|-------|
| Transcript ID | `transcript-49de44a83bef88f07540e8549f337defd7cd0152c0f462546f30124ae79ef07e` |
| Intent Type | `weather.data` |
| Protocol Version | `pact-transcript/4.0` |
| Negotiation Rounds | 2 (INTENT → ASK) |
| Failure Code | `PACT-101` |
| Terminal State | Aborted (Policy Violation) |

## What Occurred

1. **Round 0 (INTENT)**: Buyer agent initiated negotiation with policy constraints
2. **Round 1 (ASK)**: Provider responded with terms that violated buyer's policy
3. **Termination**: Protocol automatically aborted the negotiation

The negotiation did not proceed to acceptance. No financial commitment was made.

## Policy Abort Prevented Overspend

The `PACT-101` failure code indicates that the buyer's declared policy constraints were not satisfiable by the provider's offer. Common causes include:

- Provider's price exceeded buyer's maximum allowable price
- Provider's terms did not meet required service level agreements
- Provider lacked required credentials or certifications
- Offer structure incompatible with buyer's declared requirements

**The policy abort mechanism is working as designed.** It prevented the buyer from inadvertently accepting terms that would have violated their own declared constraints.

## Fault Determination

| Field | Value | Interpretation |
|-------|-------|----------------|
| **Fault Domain** | `BUYER_AT_FAULT` | Buyer's policy was unsatisfiable |
| **Required Action** | `FIX_POLICY_OR_PARAMS` | Buyer should adjust policy or parameters |
| **Terminal** | `true` | This negotiation cannot be resumed |
| **Passport Impact** | `-0.05` | Minor negative impact to buyer passport score |

### Interpretation of BUYER_AT_FAULT

The designation `BUYER_AT_FAULT` in a policy abort scenario does **not** indicate wrongdoing. It indicates:

- The buyer's policy constraints were too restrictive for the available provider
- The buyer should consider adjusting their policy or seeking alternative providers
- No contractual breach occurred (no contract was formed)

## Financial Status

| Metric | Status |
|--------|--------|
| **Money Moved** | `FALSE` |
| **Escrow Committed** | None |
| **Funds at Risk** | None |
| **Refund Required** | N/A |

**Critical:** No financial transaction occurred. The policy abort terminated the negotiation before any commitment was made. There is no financial exposure to either party.

## Verification Procedure

The `run.sh` script performs a complete verification workflow:

### Step 1: Auditor Pack Generation

```bash
pact-verifier auditor-pack \
    --transcript fixtures/failures/PACT-101-policy-violation.json \
    --out auditor_pack_101.zip
```

### Step 2: Auditor Pack Verification

```bash
pact-verifier auditor-pack-verify --zip auditor_pack_101.zip
```

Expected output: `"ok": true`

### Step 3: GC Summary

```bash
pact-verifier gc-summary --transcript fixtures/failures/PACT-101-policy-violation.json
```

Expected output:
```
Constitution: a0ea6fe329251b8c...
Integrity: VALID
Outcome: ABORTED_POLICY
Fault Domain: BUYER_AT_FAULT
Required Action: FIX_POLICY_OR_PARAMS
Approval Risk: MEDIUM
```

### Step 4: Insurer Summary (Optional)

```bash
pact-verifier insurer-summary --transcript fixtures/failures/PACT-101-policy-violation.json
```

Provides underwriting-relevant information including:
- Party passport scores and tiers
- Risk factors
- Coverage determination

## Execution

```bash
./demo/h5-golden/policy_abort/run.sh
```

## Expected Outcome

| Metric | Expected Value |
|--------|----------------|
| Exit Code | `0` |
| Verification `ok` | `true` |
| Outcome | `ABORTED_POLICY` |
| Fault Domain | `BUYER_AT_FAULT` |
| Required Action | `FIX_POLICY_OR_PARAMS` |
| Money Moved | `FALSE` |

## Regulatory Considerations

A policy abort transaction:

- Requires no financial remediation (no funds were committed)
- May warrant review if the buyer's policy appears misconfigured
- Does not constitute a breach of contract (no contract formed)
- Should be logged for pattern analysis (repeated policy aborts may indicate systematic misconfiguration)

The auditor pack (`auditor_pack_101.zip`) provides complete evidence of the policy violation and termination sequence.

## Recommended Actions

For the **Buyer**:
1. Review policy constraints for reasonableness
2. Consider adjusting maximum price or other thresholds
3. Evaluate alternative providers that may satisfy current policy

For the **Provider**:
1. No action required (provider operated correctly)
2. Consider if pricing or terms could be adjusted for future negotiations

For **Governance/Compliance**:
1. Log the policy abort for audit trail
2. No escalation required (protective outcome)
3. Monitor for repeated policy aborts from same buyer (may indicate misconfiguration)
