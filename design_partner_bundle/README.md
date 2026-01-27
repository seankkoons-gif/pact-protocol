# Pact Design Partner Bundle

Self-contained bundle for GC/insurer review of Pact verification artifacts.

## Contents

### Documentation

| File | Description |
|------|-------------|
| `CONSTITUTION_v1.md` | Pact Rules of Evidence & Responsibility Attribution |
| `GC_5_MINUTE_APPROVAL_CHECKLIST.md` | Quick legal approval checklist |
| `INSURER_UNDERWRITING_VIEW.md` | Underwriting guidelines and risk model |
| `PROVIDER_FAILURES.md` | Canonical failure scenarios (PACT-420, PACT-421) |
| `PACT_COMPLIANCE_CHECKLIST.md` | Institutional compliance checklist (8 criteria) |

### Auditor Packs

Pre-generated, verifiable evidence bundles in `packs/`:

| Pack | Fixture | Outcome | Description |
|------|---------|---------|-------------|
| `auditor_pack_success.zip` | SUCCESS-001 | COMPLETED | Successful transaction |
| `auditor_pack_101.zip` | PACT-101 | ABORTED_POLICY | Policy violation |
| `auditor_pack_420.zip` | PACT-420 | FAILED_PROVIDER_UNREACHABLE | Provider unreachable |

### H5 Golden Demo

Interactive demonstration suite in `demo/h5-golden/`:

| Scenario | Description |
|----------|-------------|
| `success/` | Successful transaction (Scenario A) |
| `policy_abort/` | Policy violation abort (Scenario B - PACT-101) |
| `tamper/` | Tamper detection demonstration (Scenario C) |

Each scenario includes:
- `run.sh` - Executable scenario script
- `README.md` - Customer-facing documentation
- `CUSTOMER_MESSAGE.txt` - Plain-English customer notification
- `INSURER_MESSAGE.txt` - Underwriting summary
- `auditor_pack_*.zip` - Generated evidence bundle

### Verifier

| File | Description |
|------|-------------|
| `verifier/pact-verifier-0.2.0.tgz` | Bundled verifier CLI (npm tarball) |

---

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- jq (for JSON parsing)

### Option 1: Install Verifier Globally (if published)

```bash
npm install -g @pact/verifier
```

### Option 2: Use Included Tarball (recommended for review)

The bundle includes a pre-built verifier tarball. The verification script will automatically use it.

---

## Verify Everything

Run the verification script from this directory:

```bash
bash verify_all.sh
```

This will:
1. Install the verifier from the included tarball (if not globally installed)
2. Verify checksums for all auditor packs in `packs/`
3. Verify demo packs in `demo/h5-golden/*/`
4. Recompute derived artifacts and compare
5. Print PASS/FAIL for each pack

**Expected output:**

```
═══════════════════════════════════════════════════════════
  Pact Design Partner Bundle - Verification
═══════════════════════════════════════════════════════════

Installing pact-verifier from included tarball...
   ✓ Installed pact-verifier from tarball

Verifying auditor packs...

  Verifying: auditor_pack_101.zip
    ✓ PASS: ok=true, checksums_ok=true, recompute_ok=true
  Verifying: auditor_pack_420.zip
    ✓ PASS: ok=true, checksums_ok=true, recompute_ok=true
  Verifying: auditor_pack_success.zip
    ✓ PASS: ok=true, checksums_ok=true, recompute_ok=true

═══════════════════════════════════════════════════════════
  ✅ All 3 packs verified successfully!
═══════════════════════════════════════════════════════════
```

---

## What to Look At

Each auditor pack contains a `gc_view.json` with the following key fields:

### 1. Constitution Hash

```json
"constitution": {
  "version": "constitution/1.0",
  "hash": "a0ea6fe329251b8c92112fd7518976a031eb8db76433e8c99c77060fc76d7d9d",
  "rules_applied": ["DBL-1", "DBL-2", "DET-1", "EVD-1", "INT-1", "LVSH-1"]
}
```

**What this means:** The rules used to judge responsibility are immutable. Same inputs → same outputs.

### 2. Integrity

```json
"integrity": {
  "hash_chain": "VALID",
  "signatures_verified": { "verified": 3, "total": 3 },
  "final_hash_validation": "MATCH"
}
```

**What to check:**
- `hash_chain: VALID` → No transcript tampering
- `signatures_verified` → All parties signed their actions
- `final_hash_validation: MATCH` → Container hash verified

### 3. Outcome

```json
"executive_summary": {
  "status": "COMPLETED | ABORTED_POLICY | FAILED_PROVIDER_UNREACHABLE | ...",
  "money_moved": true | false,
  "final_outcome": "No action required | Refund required | Retry required"
}
```

**What this means:** The legal bottom line for this transaction.

### 4. Responsibility

```json
"responsibility": {
  "judgment": {
    "fault_domain": "NO_FAULT | BUYER_AT_FAULT | PROVIDER_AT_FAULT",
    "required_next_actor": "NONE | BUYER | PROVIDER",
    "required_action": "NONE | RETRY | REFUND | FIX_POLICY",
    "terminal": true,
    "confidence": 0.85
  }
}
```

**Key guarantees:**
- Exactly one fault domain
- Exactly one required next actor
- Exactly one required action
- Deterministic confidence score

---

## Manual Verification

To manually inspect a pack:

```bash
# Extract and view gc_view
unzip -p packs/auditor_pack_success.zip derived/gc_view.json | jq .

# View the transcript
unzip -p packs/auditor_pack_success.zip source/transcript.json | jq .

# View the manifest
unzip -p packs/auditor_pack_success.zip manifest.json | jq .
```

To verify with the CLI:

```bash
# Install verifier from tarball
npm install -g ./verifier/pact-verifier-0.2.0.tgz

# Verify a pack
pact-verifier auditor-pack-verify --zip packs/auditor_pack_success.zip
```

---

## Questions?

See the included documentation files for detailed explanations of:
- Evidence rules (CONSTITUTION_v1.md)
- Legal approval workflow (GC_5_MINUTE_APPROVAL_CHECKLIST.md)
- Insurance underwriting (INSURER_UNDERWRITING_VIEW.md)
- Provider failure scenarios (PROVIDER_FAILURES.md)
- Compliance requirements (PACT_COMPLIANCE_CHECKLIST.md)
- Interactive demo (demo/h5-golden/README.md)
