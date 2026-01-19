# Pact Verifier

**Purpose:** Read-only transcript verification and replay for Pact v4  
**Audience:** Auditors, insurers, compliance teams, General Counsel, enterprise risk officers  
**Status:** Logical package (may be distributed independently)

---

## What Is the Pact Verifier?

The **Pact Verifier** is a read-only verification system for Pact transcripts and evidence bundles. It provides cryptographic verification, deterministic replay, and human-readable narratives without requiring any agent runtime, negotiation logic, or settlement code.

The verifier is designed as a **logical package** that may be distributed independently from the full Pact SDK. It contains **zero negotiation, settlement, or wallet code**—only verification and replay functionality.

### Core Principle

**The verifier is read-only by design.** It cannot:
- Create new transcripts
- Modify existing transcripts
- Execute negotiations
- Process payments
- Manage wallets

It can only:
- Verify cryptographic integrity
- Replay transcripts deterministically
- Generate human-readable narratives
- Validate evidence bundles
- Check arbitration decision artifacts

---

## Who Uses the Verifier?

### Auditors

**Use Case:** Verify that agent transactions complied with policy and that transcripts are cryptographically intact.

**Typical Workflow:**
1. Receive evidence bundle from enterprise
2. Run `replay:v4` to verify transcript integrity
3. Run `evidence:verify` to validate bundle manifest
4. Review narrative output to understand what happened
5. Check policy compliance (via evidence references)
6. Generate audit report

**Key Benefit:** Auditors can verify transactions without trusting enterprise logs or requiring access to agent infrastructure.

---

### Insurers

**Use Case:** Assess risk from agent transaction history and validate claims.

**Typical Workflow:**
1. Receive transcripts from insured party
2. Replay transcripts to verify authenticity
3. Analyze failure patterns (PACT-101, PACT-404, etc.)
4. Check Passport scores (if referenced in transcripts)
5. Validate arbitration decisions (if disputes occurred)
6. Calculate risk scores based on failure taxonomy

**Key Benefit:** Insurers can independently verify claims and assess risk without relying on insured party's systems.

---

### Compliance Teams

**Use Case:** Ensure agent transactions comply with regulatory requirements and internal policies.

**Typical Workflow:**
1. Monitor transcript directory for new transactions
2. Batch verify transcripts using `replay:verify:recent`
3. Flag transcripts with policy violations (PACT-101)
4. Generate compliance reports
5. Archive evidence bundles for regulatory audits

**Key Benefit:** Compliance teams can enforce policy adherence without blocking agent operations.

---

### General Counsel

**Use Case:** Verify evidence bundles for legal proceedings and dispute resolution.

**Typical Workflow:**
1. Receive evidence bundle from opposing party
2. Run `evidence:verify` to check bundle integrity
3. Verify arbitration decision artifacts (if present)
4. Review narrative summary
5. Validate that redacted fields map to original hashes
6. Present verified evidence in legal proceedings

**Key Benefit:** General Counsel can independently verify evidence without trusting opposing party's systems.

---

### Enterprise Risk Officers

**Use Case:** Monitor agent spending and transaction patterns for risk management.

**Typical Workflow:**
1. Set up automated transcript verification pipeline
2. Monitor for settlement failures (PACT-404)
3. Track policy violations (PACT-101)
4. Analyze negotiation deadlocks (PACT-303)
5. Generate risk dashboards from verified transcripts

**Key Benefit:** Risk officers can monitor agent behavior without running agents or accessing sensitive infrastructure.

---

## What the Verifier Can Do

### 1. Transcript Replay (`replay:v4`)

**Functionality:**
- Load a Pact v4 transcript (JSON file)
- Verify all cryptographic signatures (Ed25519)
- Verify hash chain integrity (each round links to previous)
- Detect tampering (any byte change breaks verification)
- Generate human-readable narrative

**Output:**
- `INTEGRITY VALID` or `INTEGRITY FAIL`
- Signature verification count
- Hash chain verification count
- Narrative explanation of each round
- Failure event explanation (if present)

**Example:**
```bash
pnpm replay:v4 .pact/transcripts/transcript-abc123.json
```

**Output:**
```
🟢 INTEGRITY VALID

📋 Intent:
   Type: weather.data
   Scope: NYC
   Created: 2025-01-27T10:00:00.000Z

🔗 Hash Chain:
   Round 0 (INTENT): hash-abc123... ✓
   Round 1 (ASK): hash-def456... ✓ (linked to round 0)
   Round 2 (ACCEPT): hash-ghi789... ✓ (linked to round 1)

✍️  Signatures:
   Round 0: ✓ Verified (buyer)
   Round 1: ✓ Verified (provider)
   Round 2: ✓ Verified (buyer)

📖 Narrative:
   Round 0: Buyer declares intent: "buyer-agent" initiated a negotiation...
   Round 1: Seller asks: "provider-1" proposed a price of $0.04...
   Round 2: Buyer accepts: "buyer-agent" accepted the offer...

✅ Outcome: Agreement reached
   Final Price: $0.04
```

---

### 2. Evidence Bundle Verification (`evidence:verify`)

**Functionality:**
- Load evidence bundle directory (or `MANIFEST.json` path)
- Verify all file hashes match manifest
- Verify transcript integrity (if `ORIGINAL.json` present)
- Verify arbitration decision artifacts (if present)
- Validate redacted transcript views (if `VIEW.json` present)

**Output:**
- `INTEGRITY PASS` or `INTEGRITY FAIL`
- List of verified files
- List of failed files (if any)
- Transcript verification status
- Decision artifact verification status (if present)

**Example:**
```bash
pnpm evidence:verify ./evidence-bundle
```

**Output:**
```
INTEGRITY PASS

Verified files:
  ✓ VIEW.json (hash matches)
  ✓ MANIFEST.json (hash matches)
  ✓ SUMMARY.md (hash matches)
  ✓ arbiter-decision.json (hash matches)

Transcript verification: PASS
Decision artifact verification: PASS
```

---

### 3. Batch Verification (`replay:verify`)

**Functionality:**
- Verify multiple transcripts in a directory
- Support v1/v2/v3/v4 transcripts (legacy compatibility)
- Filter historical transcripts (optional)
- Generate summary report

**Output:**
- Per-transcript verification results
- Summary statistics
- List of failed transcripts (if any)

**Example:**
```bash
pnpm replay:verify --no-historical -- .pact/transcripts
```

**Output:**
```
ℹ️  Filtered out 5 historical transcript(s) due to --no-historical

Verifying 10 transcript(s)...

transcript-abc123.json: ✅ PASS
transcript-def456.json: ✅ PASS
transcript-ghi789.json: ❌ FAIL (signature verification failed)

✅ 9 of 10 transcripts verified successfully
```

---

### 4. Narrative Generation

**Functionality:**
- Translate negotiation rounds into plain English
- Explain failure events in human-readable terms
- Generate summaries for evidence bundles

**Output:**
- Human-readable descriptions of each round
- Failure explanations with context
- Evidence references explained

**Example (Programmatic):**
```typescript
import { narrateRound, narrateFailure } from "@pact/verifier";

// Narrate a round
const narrative = narrateRound(round);
console.log(narrative.narrative);
// Output: "Buyer declares intent: 'buyer-agent' initiated a negotiation for 'weather.data'..."

// Narrate a failure
if (transcript.failure_event) {
  const failureNarrative = narrateFailure(transcript.failure_event);
  console.log(failureNarrative.narrative);
  // Output: "Policy violation detected: offer_price ($0.10) exceeds max_price ($0.05)..."
}
```

---

### 5. Redaction View Validation

**Functionality:**
- Validate redacted transcript views (INTERNAL, PARTNER, AUDITOR)
- Verify redacted fields map to original hashes
- Ensure redaction preserves cryptographic integrity

**Output:**
- Validation status for redacted views
- Hash mapping verification
- Integrity check results

**Note:** The verifier can validate redacted views but does not perform redaction itself. Redaction is performed by the SDK during evidence bundle generation.

---

### 6. Arbitration Decision Verification

**Functionality:**
- Verify arbitration decision artifact signatures
- Validate decision-to-transcript linkage
- Map reason codes to failure taxonomy
- Verify evidence references

**Output:**
- Decision artifact verification status
- Signature verification result
- Transcript hash linkage check
- Reason code mapping

**Example:**
```typescript
import { validateDecisionArtifact } from "@pact/verifier";

const result = validateDecisionArtifact(decision, transcript);
if (result.ok) {
  console.log("✅ Decision artifact verified");
  console.log(`Decision: ${decision.decision}`);
  console.log(`Reason codes: ${decision.reason_codes.join(", ")}`);
} else {
  console.error("❌ Decision artifact verification failed");
  result.errors.forEach(err => console.error(`  - ${err.message}`));
}
```

---

## What the Verifier Does NOT Do

### ❌ No Negotiation

**Explicitly Excluded:**
- Creating new negotiation rounds
- Generating ASK/BID/COUNTER messages
- Executing negotiation strategies
- Managing negotiation state

**Rationale:** The verifier is read-only. It can only verify existing transcripts, not create new ones.

---

### ❌ No Settlement

**Explicitly Excluded:**
- Processing payments
- Executing settlement instructions
- Managing payment rails (Stripe, escrow, etc.)
- Generating receipts

**Rationale:** Settlement requires access to payment infrastructure and sensitive credentials. The verifier operates in a read-only, audit-safe environment.

---

### ❌ No Wallets

**Explicitly Excluded:**
- Managing cryptographic keys
- Signing transactions
- Wallet operations
- Key derivation

**Rationale:** The verifier only verifies signatures; it does not create them. Wallet management is outside the verifier's scope.

---

### ❌ No Policy Evaluation

**Explicitly Excluded:**
- Evaluating policies against context
- Enforcing policy constraints
- Generating policy evaluation traces
- Blocking transactions based on policy

**Rationale:** The verifier can verify that policy hashes match and that policy evaluation traces are present, but it does not evaluate policies. Policy evaluation is the SDK's responsibility during negotiation.

---

### ❌ No Agent Runtime

**Explicitly Excluded:**
- Running agents
- Executing agent logic
- Managing agent state
- Processing agent requests

**Rationale:** The verifier operates independently of agent infrastructure. It can verify transcripts produced by agents but does not run agents itself.

---

### ❌ No Database Operations

**Explicitly Excluded:**
- Storing transcripts
- Querying Passport scores
- Managing credit exposure
- Tracking agent history

**Rationale:** The verifier is stateless. It operates on transcript files and evidence bundles, not databases.

---

## Distribution Model

### Logical Package

The verifier is designed as a **logical package** that may be distributed independently from the full Pact SDK. This separation provides:

1. **Security:** Auditors, insurers, and compliance teams can install only verification code, reducing attack surface
2. **Simplicity:** Minimal dependencies (no `ethers`, `stripe`, or database libraries)
3. **Independence:** Verification can occur without access to agent infrastructure
4. **Compliance:** Read-only design satisfies audit and regulatory requirements

### Current Status

The verifier exists as a logical package within the Pact monorepo. It may be:
- Distributed as a standalone package
- Bundled with the SDK
- Provided as a separate tool

**No commitment is made at this time to publish the verifier as an independent npm package.** The distribution model will be determined based on user needs and integration requirements.

---

## Dependencies

### Minimal Dependencies

The verifier has minimal dependencies:
- `bs58` - Base58 encoding/decoding (for signature verification)
- `tweetnacl` - Ed25519 signature verification
- `minimist` - CLI argument parsing

### Optional Peer Dependencies

- `@pact/sdk` - Required only for `replay:verify` (v1/v2/v3 transcript verification). Not required for v4 transcript verification.

### Explicitly Excluded

The verifier does **not** depend on:
- `ethers` or other blockchain libraries
- `stripe` or payment processing libraries
- Database libraries (SQLite, PostgreSQL, etc.)
- Agent runtime libraries
- Policy evaluation engines

---

## Use Cases Summary

| Use Case | Primary Users | Key Functionality |
|----------|---------------|-------------------|
| **Audit Verification** | Auditors | Transcript replay, evidence bundle verification |
| **Risk Assessment** | Insurers | Failure pattern analysis, arbitration decision verification |
| **Compliance Monitoring** | Compliance teams | Batch verification, policy violation detection |
| **Legal Evidence** | General Counsel | Evidence bundle verification, redaction validation |
| **Risk Management** | Enterprise risk officers | Transaction monitoring, failure tracking |

---

## Integration Examples

### Example 1: Auditor Workflow

```bash
# 1. Receive evidence bundle
cd ./evidence-bundle

# 2. Verify bundle integrity
pnpm evidence:verify .

# 3. Replay transcript (if ORIGINAL.json present)
pnpm replay:v4 ORIGINAL.json

# 4. Review narrative
cat SUMMARY.md
```

### Example 2: Compliance Pipeline

```bash
# 1. Monitor transcript directory
watch -n 60 'pnpm replay:verify:recent'

# 2. Flag policy violations
pnpm replay:verify:recent | grep "PACT-101"

# 3. Generate compliance report
pnpm replay:verify:recent > compliance-report-$(date +%Y%m%d).txt
```

### Example 3: Insurer Risk Assessment

```typescript
import { replayTranscriptV4, narrateFailure } from "@pact/verifier";
import fs from "fs";

// Load transcript
const transcript = JSON.parse(fs.readFileSync("transcript.json", "utf-8"));

// Verify integrity
const result = await replayTranscriptV4(transcript);
if (!result.ok) {
  throw new Error("Transcript verification failed");
}

// Analyze failure (if present)
if (transcript.failure_event) {
  const narrative = narrateFailure(transcript.failure_event);
  console.log(`Failure: ${transcript.failure_event.code}`);
  console.log(`Stage: ${transcript.failure_event.stage}`);
  console.log(`Fault Domain: ${transcript.failure_event.fault_domain}`);
  console.log(`Narrative: ${narrative.narrative}`);
  
  // Risk assessment logic
  if (transcript.failure_event.code === "PACT-101") {
    console.log("⚠️  Policy violation detected - high risk");
  } else if (transcript.failure_event.code === "PACT-404") {
    console.log("⚠️  Settlement failure - medium risk");
  }
}
```

---

## Determinism Guarantees

The verifier provides **deterministic verification**:

- **Same Input → Same Output**: Identical transcript files produce identical verification results
- **No Randomness**: Verification is deterministic; no nonces, timestamps, or random values affect results
- **Reproducible**: Verification results can be reproduced across different machines and environments
- **Audit-Safe**: Deterministic verification ensures audit results are reproducible and defensible

---

## Security Model

### Read-Only Design

The verifier is **read-only by design**:
- Cannot modify transcripts
- Cannot create new transactions
- Cannot access sensitive credentials
- Cannot execute payments

### Cryptographic Verification

The verifier uses **cryptographic verification**:
- Ed25519 signature verification (industry-standard)
- SHA-256 hash chain verification
- Deterministic canonicalization
- Tamper-evident design

### No Network Access

The verifier operates **offline**:
- No network calls required
- No external API dependencies
- No cloud services
- Works in air-gapped environments

---

## Future Considerations

### Potential Enhancements

Future versions of the verifier may include:
- **Batch Processing**: Optimized verification of large transcript archives
- **Streaming Verification**: Verify transcripts as they are generated
- **Custom Views**: Support for additional redaction views beyond INTERNAL/PARTNER/AUDITOR
- **Export Formats**: Export verification results in standard formats (JSON, CSV, PDF)

### Distribution Model

The distribution model for the verifier will be determined based on:
- User feedback and requirements
- Integration patterns
- Security and compliance needs
- Maintenance and support considerations

**No commitment is made at this time to publish the verifier as an independent npm package.**

---

**Document Status:** Specification  
**Protocol Version:** `pact-transcript/4.0`  
**Last Updated:** 2025-01-27
