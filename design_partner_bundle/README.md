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
| `auditor_pack_tier3.zip` | SUCCESS-001-tier3 | COMPLETED | Tier T3 + SLA "daily digest" (informational only; fully verifiable) |

### H5 Golden Demo

Interactive demonstration suite in `demo/h5-golden/`:

| Scenario | Description |
|----------|-------------|
| `success/` | Successful transaction (Scenario A) |
| `policy_abort/` | Policy violation abort (Scenario B - PACT-101) |
| `tamper/` | Tamper detection demonstration (Scenario C) |
| `tier3/` | Tier T3 + SLA "daily digest" (Scenario D; optional Merkle digest) |

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

**Recommended:** Use the verifier from the repo via `node packages/verifier/dist/bin/pact-verifier.js` (see "Verify Everything" below). Do **not** use global `pact-verifier` in docs or workflows—it may point to a different version. See [docs/WORKFLOW_CONVENTIONS.md](../docs/WORKFLOW_CONVENTIONS.md).

The bundle includes a pre-built verifier tarball (`verifier/pact-verifier-0.2.0.tgz`). The verification script will use it when run from this directory.

---

## Verify Everything

### From repo root (version-pinned)

Run this exact set from the **repository root** for a reproducible run:

```bash
pnpm install
pnpm -C packages/verifier build

./design_partner_bundle/verify_all.sh

node packages/verifier/dist/bin/pact-verifier.js auditor-pack-verify --zip design_partner_bundle/packs/auditor_pack_101.zip
node packages/verifier/dist/bin/pact-verifier.js auditor-pack-verify --zip design_partner_bundle/packs/auditor_pack_420.zip
node packages/verifier/dist/bin/pact-verifier.js auditor-pack-verify --zip design_partner_bundle/demo/h5-golden/tamper/auditor_pack_semantic_tampered.zip

pnpm --filter @pact/evidence-viewer build
pnpm --filter @pact/evidence-viewer dev
```

Then open the URL Vite prints for the Evidence Viewer.

**Important:** Run viewer dev from the **same repo root** where you built and verified. Running from a different clone can cause port conflicts and wrong-repo confusion. See [docs/WORKFLOW_CONVENTIONS.md](../docs/WORKFLOW_CONVENTIONS.md).

### From this directory

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

Verifying auditor packs...

  Verifying: auditor_pack_101.zip
    ✓ PASS: ok=true, checksums_ok=true, recompute_ok=true
  Verifying: auditor_pack_420.zip
    ✓ PASS: ok=true, checksums_ok=true, recompute_ok=true
  Verifying: auditor_pack_success.zip
    ✓ PASS: ok=true, checksums_ok=true, recompute_ok=true
  Verifying: auditor_pack_tier3.zip
    ✓ PASS: ok=true, checksums_ok=true, recompute_ok=true

Verifying demo packs...
  ...

═══════════════════════════════════════════════════════════
  ✅ All packs verified successfully!
═══════════════════════════════════════════════════════════
```

When run from a repo checkout, the script prefers the repo-built verifier so tier/Merkle support matches the packs. See [docs/gc/TIERED_VERIFICATION_NOTE.md](../docs/gc/TIERED_VERIFICATION_NOTE.md) for prevention vs evidence vs tier.

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

To verify with the CLI (from repo root; do **not** use global `pact-verifier`):

```bash
# From repo root, after: pnpm -C packages/verifier build
node packages/verifier/dist/bin/pact-verifier.js auditor-pack-verify --zip design_partner_bundle/packs/auditor_pack_success.zip
```

See [docs/WORKFLOW_CONVENTIONS.md](../docs/WORKFLOW_CONVENTIONS.md) for conventions.

---

## Tier (additive metadata)

- **Tier metadata** (T1/T2/T3) and **audit SLA** (e.g. "daily digest") are informational only; they affect audit cadence, not verification or admissibility. See [docs/gc/TIERED_VERIFICATION_NOTE.md](../docs/gc/TIERED_VERIFICATION_NOTE.md) and [docs/TIERED_VERIFICATION_SPEC.md](../docs/TIERED_VERIFICATION_SPEC.md).
- **Merkle digest** is a doc-only future spec (see [docs/MERKLE_DIGEST_v1.md](../docs/MERKLE_DIGEST_v1.md)); not implemented in v4.0.5-rc1.

## Questions?

See the included documentation files for detailed explanations of:
- Evidence rules (CONSTITUTION_v1.md)
- Legal approval workflow (GC_5_MINUTE_APPROVAL_CHECKLIST.md)
- Insurance underwriting (INSURER_UNDERWRITING_VIEW.md)
- Provider failure scenarios (PROVIDER_FAILURES.md)
- Compliance requirements (PACT_COMPLIANCE_CHECKLIST.md)
- Tier and verification (docs/gc/TIERED_VERIFICATION_NOTE.md)
- Interactive demo (demo/h5-golden/README.md)
