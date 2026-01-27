# Scenario C: Tamper Detection (Semantic Attack)

## Overview

This scenario demonstrates the Pact Protocol verifier's resistance to sophisticated tampering attacks. Unlike naive checksum verification, the Pact verifier **recomputes derived artifacts from source data**, making it cryptographically impossible for an attacker to falsify records without detection.

## Attacker Model

**Threat Actor:** Rogue provider or compromised intermediary

**Objective:** Modify the historical record to change the outcome of a transaction (e.g., change `COMPLETED` to `FAILED`, or vice versa)

**Capabilities:**
- Full read/write access to the auditor pack after generation
- Ability to modify any file within the package
- Ability to recompute checksums
- No access to private keys (cannot forge signatures)

**Attack Vector:** Semantic tamper with checksum recalculation

## The Attack Sequence

This demonstration executes the following attack:

### Step 1: Obtain Valid Auditor Pack
The attacker obtains a legitimate auditor pack (`auditor_pack_success.zip`) containing a completed transaction.

### Step 2: Extract and Modify
The attacker extracts the pack and modifies `derived/gc_view.json`:

```json
// Before (legitimate)
{
  "executive_summary": {
    "status": "COMPLETED"
  }
}

// After (tampered)
{
  "executive_summary": {
    "status": "TAMPERED_STATUS"
  }
}
```

### Step 3: Recompute Checksums
The attacker recalculates `checksums.sha256` to include the hash of the modified file:

```bash
# Attacker recomputes all checksums
shasum -a 256 derived/gc_view.json > checksums.sha256
# ... (all other files)
```

### Step 4: Repackage
The attacker creates a new ZIP with the tampered content and valid checksums.

### Step 5: Attempt Verification
The attacker presents the tampered pack for verification.

## Why Checksum-Only Verification Fails

A naive verifier that only checks:

```bash
sha256sum -c checksums.sha256
```

Would **pass** this attack because:
- All files have valid checksums
- The checksums.sha256 file is internally consistent
- No file corruption is detectable

**Checksum verification proves:** "These files have not changed since the checksums were computed"

**Checksum verification does NOT prove:** "These files were correctly derived from the source transcript"

## Why Recompute Verification Succeeds

The Pact verifier performs **recompute verification**:

1. Extract `input/transcript.json` (the source of truth)
2. Recompute `derived/gc_view.json` using the same deterministic algorithm
3. Compare the recomputed result with the packaged version
4. If they differ → **TAMPER DETECTED**

```
Verification Report:
{
  "ok": false,
  "checksums_ok": true,      ← Checksums pass (attacker succeeded here)
  "recompute_ok": false,     ← Recompute fails (attacker cannot defeat this)
  "mismatches": [
    "derived/gc_view.json mismatch after canonicalization"
  ]
}
```

## Sovereign Proof

**Sovereign proof** means verification that does not depend on trusting any third party:

| Verification Type | Depends On | Defeatable By |
|-------------------|------------|---------------|
| Checksum-only | Integrity of checksums file | Anyone with write access |
| Signature-only | Signer's private key | Key compromise |
| **Recompute** | **Deterministic algorithm + source transcript** | **Nothing short of breaking cryptography** |

The Pact verifier achieves sovereign proof because:

1. The transcript contains cryptographic signatures that cannot be forged
2. The derivation algorithm is deterministic and publicly known
3. Anyone can recompute the derived artifacts independently
4. No trust in the pack creator is required

## Execution

```bash
./demo/h5-golden/tamper/run.sh
```

**Prerequisites:** Run `demo/h5-golden/success/run.sh` first to generate the source auditor pack.

## Expected Outcome

| Metric | Expected Value |
|--------|----------------|
| Exit Code | `0` (tamper correctly detected) |
| `ok` | `false` |
| `checksums_ok` | `true` (attacker's checksums are valid) |
| `recompute_ok` | `false` (recompute detected the tamper) |

## Security Implications

### For Auditors
- Never rely on checksum verification alone
- Always use `auditor-pack-verify` which performs recompute verification
- A passing checksum check with failing recompute indicates tampering

### For Providers
- Tampering with auditor packs is cryptographically detectable
- Even with full access to the pack, records cannot be falsified
- The transcript's signed rounds are the immutable source of truth

### For Governance
- Auditor packs provide tamper-evident, self-verifiable evidence
- No trust in the pack creator is required for verification
- Verification can be performed offline with no network access

## Technical Details

### What Makes Recompute Verification Work

1. **Deterministic Derivation**: `gc_view.json` is computed from `transcript.json` using a deterministic algorithm with no random inputs

2. **Canonical Serialization**: JSON is canonicalized before hashing to eliminate formatting differences

3. **Field Stripping**: Non-deterministic fields (timestamps, tool versions) are stripped before comparison

4. **Cryptographic Binding**: The transcript's `final_hash` cryptographically binds all rounds together

### Attack Variations That Also Fail

| Attack | Why It Fails |
|--------|--------------|
| Modify transcript + recompute gc_view | Signature verification fails |
| Modify only metadata | Recompute detects mismatch |
| Modify checksums only | Checksum verification fails |
| Modify constitution | Constitution hash mismatch |

The only way to successfully tamper with an auditor pack is to compromise the private keys of all signers and recreate the entire transcript — which is equivalent to creating a new, legitimate transaction.
