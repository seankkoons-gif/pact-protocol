# Provider Failure Pilots (PACT-420 / PACT-421)

This document describes two canonical provider-failure scenarios that can be used for GC/insurer review and testing.

## Overview

| Code | Name | Description | Fault Domain |
|------|------|-------------|--------------|
| PACT-420 | Provider Unreachable | Network/connectivity failure - provider endpoint not reachable | PROVIDER_AT_FAULT |
| PACT-421 | Provider API Mismatch | HTTP 404 - provider exists but /pact endpoint not found | PROVIDER_AT_FAULT |

## PACT-420: Provider Unreachable

### Scenario

The buyer attempts to contact a provider endpoint, but the provider is unreachable due to:
- Network failure (ECONNREFUSED)
- DNS resolution failure
- Provider server is down
- Firewall blocking connection

### Generating the Fixture

```bash
# Generate PACT-420 fixture (uses unreachable port 59999)
tsx examples/use_cases/autonomous-api-procurement/buyer/run_provider_unreachable.ts
```

The script:
1. Creates a transcript with an INTENT round
2. Attempts to contact `http://127.0.0.1:59999` (guaranteed unreachable)
3. Creates a `failure_event` with code `PACT-420`
4. Saves to `fixtures/failures/PACT-420-provider-unreachable.json`

### GC View Output

```bash
./bin/pact-verifier gc-view --transcript fixtures/failures/PACT-420-provider-unreachable.json | jq
```

Key fields in the GC view:

```json
{
  "executive_summary": {
    "status": "FAILED_PROVIDER_UNREACHABLE",
    "what_happened": "Provider unreachable during quote request; negotiation could not be completed."
  },
  "gc_takeaways": {
    "approval_risk": "MEDIUM",
    "why": ["Provider unreachable during quote request - network failure or provider endpoint unavailable"],
    "recommended_remediation": ["Retry with same or alternative provider after verifying network connectivity"]
  },
  "responsibility": {
    "judgment": {
      "fault_domain": "PROVIDER_AT_FAULT",
      "required_next_actor": "PROVIDER",
      "required_action": "RETRY",
      "terminal": true
    }
  }
}
```

---

## PACT-421: Provider API Mismatch

### Scenario

The buyer contacts a provider endpoint that exists and is reachable, but the `/pact` route returns HTTP 404:
- Provider is running but doesn't implement Pact protocol
- Provider endpoint URL is misconfigured
- Provider has decommissioned the /pact endpoint

### Generating the Fixture

```bash
# Generate PACT-421 fixture (starts stub server that returns 404 for /pact)
tsx examples/use_cases/autonomous-api-procurement/buyer/run_provider_api_mismatch.ts
```

The script:
1. Starts a stub HTTP server on port 59421 that only serves `/health`
2. Creates a transcript with an INTENT round
3. Attempts to POST to `/pact` and receives HTTP 404
4. Creates a `failure_event` with code `PACT-421`
5. Saves to `fixtures/failures/PACT-421-provider-api-mismatch.json`

### GC View Output

```bash
./bin/pact-verifier gc-view --transcript fixtures/failures/PACT-421-provider-api-mismatch.json | jq
```

Key fields in the GC view:

```json
{
  "executive_summary": {
    "status": "FAILED_PROVIDER_API_MISMATCH",
    "what_happened": "Provider API mismatch - /pact endpoint not found; provider endpoint exists but does not implement Pact protocol."
  },
  "gc_takeaways": {
    "approval_risk": "MEDIUM",
    "why": ["Provider API mismatch - /pact endpoint not found"],
    "open_questions": [
      "Does the provider implement the Pact protocol correctly?",
      "Is the provider endpoint URL configured correctly?"
    ],
    "recommended_remediation": ["Verify provider implements /pact endpoint and retry with correct configuration"]
  },
  "responsibility": {
    "judgment": {
      "fault_domain": "PROVIDER_AT_FAULT",
      "required_next_actor": "PROVIDER",
      "required_action": "RETRY",
      "terminal": true
    }
  }
}
```

---

## GC View Snapshots

Pre-generated GC view snapshots are available for reference:

- `fixtures/gc_view/PACT-420-provider-unreachable.gc_view.json`
- `fixtures/gc_view/PACT-421-provider-api-mismatch.gc_view.json`

To regenerate snapshots:

```bash
node packages/verifier/dist/cli/gc_view.js --transcript fixtures/failures/PACT-420-provider-unreachable.json > fixtures/gc_view/PACT-420-provider-unreachable.gc_view.json
node packages/verifier/dist/cli/gc_view.js --transcript fixtures/failures/PACT-421-provider-api-mismatch.json > fixtures/gc_view/PACT-421-provider-api-mismatch.gc_view.json
```

---

## Verifying with CLI Tools

### Using bin/pact-verifier

```bash
# Extract status
./bin/pact-verifier gc-view --transcript fixtures/failures/PACT-420-provider-unreachable.json | jq -r '.executive_summary.status'
# Output: FAILED_PROVIDER_UNREACHABLE

./bin/pact-verifier gc-view --transcript fixtures/failures/PACT-421-provider-api-mismatch.json | jq -r '.executive_summary.status'
# Output: FAILED_PROVIDER_API_MISMATCH

# Extract fault domain
./bin/pact-verifier judge-v4 --transcript fixtures/failures/PACT-420-provider-unreachable.json | jq -r '.dblDetermination'
# Output: PROVIDER_AT_FAULT

./bin/pact-verifier judge-v4 --transcript fixtures/failures/PACT-421-provider-api-mismatch.json | jq -r '.dblDetermination'
# Output: PROVIDER_AT_FAULT
```

### Using replay:v4

```bash
pnpm replay:v4 fixtures/failures/PACT-420-provider-unreachable.json
pnpm replay:v4 fixtures/failures/PACT-421-provider-api-mismatch.json
```

Both should show:
- Code: PACT-420 or PACT-421
- Fault Domain: PROVIDER_AT_FAULT
- Stage: negotiation

---

## What GC/Insurer Sees

For both PACT-420 and PACT-421:

1. **Approval Risk**: MEDIUM - Transaction failed but cause is deterministic
2. **Fault Domain**: PROVIDER_AT_FAULT - Provider is responsible for the failure
3. **Required Next Actor**: PROVIDER - Provider must fix the issue
4. **Required Action**: RETRY - Retry with fixed provider configuration
5. **Terminal**: true - This transcript is sealed; retry requires new transcript

The key difference:
- **PACT-420**: Provider endpoint not reachable at all (network level)
- **PACT-421**: Provider reachable but doesn't implement /pact (application level)
