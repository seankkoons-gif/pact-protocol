# Rules of Evidence: Compromised Container Hash Handling

## Executive Summary

**Replay verifies integrity (container hash must match).**  
**DBL verifies signed rounds (container hash can be stale).**

When a transcript's `final_hash` doesn't match the recomputed container hash, this indicates:
- **Container-level tampering** (replay MUST fail integrity check)
- **Signed rounds may still be valid** (DBL can establish LVSH from signed rounds)

## Rules of Evidence

### Rule 1: Container Hash Integrity

**Replay (`replay:v4`) MUST fail on `FINAL_HASH_MISMATCH`**

- **Default behavior:** Exit code 1 (integrity compromised)
- **Integrity status:** `TAMPERED`
- **Rationale:** Container hash mismatch indicates the transcript file was modified after signing rounds

**Implementation:**
```bash
pnpm replay:v4 fixtures/compromised/PACT-404-settlement-timeout-finalhash-mismatch.json
# Exits: 1 (integrity check failed)
# Output: "🔴 INTEGRITY COMPROMISED - TRANSCRIPT HAS BEEN TAMPERED"
```

### Rule 2: Signed Round Verification Independence

**DBL (`judge-v4`) CAN succeed on `FINAL_HASH_MISMATCH`**

- **Behavior:** Establish LVSH from signed rounds, regardless of container hash
- **Rationale:** Signed rounds have their own hash chain. Container hash is a convenience check, not a source of truth.

**Implementation:**
```bash
pnpm judge:v4 fixtures/compromised/PACT-404-settlement-timeout-finalhash-mismatch.json
# Exits: 0 (LVSH established successfully)
# Output: Judgment artifact with notes about final_hash mismatch
# Confidence: Reduced by 0.05 (e.g., 0.85 → 0.80 for PACT-404)
```

### Rule 3: Compromised Fixture Workflow

**For intentionally compromised fixtures (testing/staging):**

Use `--allow-compromised` flag to allow replay to exit 0 when:
- Only error is `FINAL_HASH_MISMATCH`
- Signed rounds validate (signatures + hash chain valid)
- No other integrity issues

**Implementation:**
```bash
pnpm replay:v4 --allow-compromised fixtures/compromised/PACT-404-settlement-timeout-finalhash-mismatch.json
# Exits: 0 (allowed compromise, rounds valid)
# Output: "⚠️  FINAL_HASH_MISMATCH detected (allowed by --allow-compromised flag)"
# Integrity status: Still reports TAMPERED (correct), but exit code is 0
```

**Without flag:**
```bash
pnpm replay:v4 fixtures/compromised/PACT-404-settlement-timeout-finalhash-mismatch.json
# Exits: 1 (integrity compromised)
# Output: "🔴 INTEGRITY COMPROMISED - TRANSCRIPT HAS BEEN TAMPERED"
```

## Expected Behavior Checklist

### Regular Fixtures (`fixtures/failures/`, `fixtures/success/`)

- [ ] `replay:v4 <path>` → Exit 0 (integrity valid) ✅ **Must pass**
- [ ] `judge-v4 <path>` → Exit 0 (LVSH established) ✅ **Must pass**
- [ ] Integrity status: `VALID` or `TAMPERED` (depends on fixture)

### Compromised Fixtures (`fixtures/compromised/`)

**⚠️ IMPORTANT:** These fixtures are **EXPECTED** to fail replay. This is correct behavior.

- [ ] `replay:v4 <path>` → Exit 1 (integrity compromised) ✅ **Expected to fail - this is correct**
- [ ] `replay:v4 --allow-compromised <path>` → Exit 0 (if only FINAL_HASH_MISMATCH, rounds valid) ✅
- [ ] `judge-v4 <path>` → Exit 0 (LVSH established) ✅ **Expected to succeed**
- [ ] Integrity status: `TAMPERED` (always, even with --allow-compromised)

**For CI/Verification Scripts:**
- Treat `fixtures/compromised/**` replay failures as **expected** (exit code 1 is correct)
- See [`../VERIFICATION.md`](../VERIFICATION.md) for verification script patterns

## Legal/Constitutional Rationale

### Why Replay Fails

Container hash mismatch indicates:
1. Transcript was modified after rounds were signed
2. Possible tampering or corruption
3. Cannot trust transcript as a whole

**Legal standard:** "Beyond reasonable doubt" - any container tampering invalidates trust in the transcript as evidence.

### Why DBL Succeeds

Signed rounds have independent cryptographic guarantees:
1. Each round is signed by its actor
2. Hash chain links rounds cryptographically
3. Container hash is a convenience check, not a source of truth

**Legal standard:** "Preponderance of evidence" - signed rounds provide sufficient evidence for blame attribution, even if container hash is stale/corrupt.

**Constitutional rule:** DBL must not "brick" on container-level final hash mismatches. LVSH is computed from signed rounds, not container hash.

## Implementation Details

### Replay Exit Code Logic

```typescript
// Default: Any integrity issue → Exit 1
if (integrityStatus === "TAMPERED" || integrityStatus === "INVALID") {
  exitCode = 1;
}

// With --allow-compromised: Only FINAL_HASH_MISMATCH is acceptable
if (allowCompromised) {
  const hasOnlyFinalHashMismatch = 
    replayResult.errors.length === 1 &&
    replayResult.errors[0].type === "FINAL_HASH_MISMATCH" &&
    replayResult.rounds_verified > 0; // Rounds must be valid
  
  if (hasOnlyFinalHashMismatch) {
    exitCode = 0; // Allow compromise, but still report TAMPERED status
  } else {
    exitCode = 1; // Other errors still fail
  }
}
```

### DBL Confidence Downgrade

When `FINAL_HASH_MISMATCH` is detected:
- Base confidence reduced by exactly **0.05**
- Notes added: "Container final hash mismatch; LVSH computed from signed rounds only."

**Confidence downgrade table:**
- PACT-101: 0.95 → 0.85
- PACT-404: 0.85 → 0.80
- PACT-505: 0.80 → 0.75
- Default continuity: 0.70 → 0.65

## Testing Requirements

### Unit Tests

- [x] Replay fails on FINAL_HASH_MISMATCH (exit code 1)
- [x] Replay with --allow-compromised succeeds on FINAL_HASH_MISMATCH (exit code 0, if rounds valid)
- [x] DBL establishes LVSH even with FINAL_HASH_MISMATCH
- [x] DBL confidence downgraded by 0.05 when FINAL_HASH_MISMATCH present
- [x] DBL notes mention final_hash mismatch when present

### Integration Tests

- [ ] CI pipeline verifies regular fixtures pass replay
- [ ] CI pipeline verifies compromised fixtures fail replay (expected)
- [ ] CI pipeline verifies compromised fixtures pass DBL (expected)
- [ ] CI pipeline verifies compromised fixtures pass replay with --allow-compromised

## References

- `packages/sdk/src/cli/replay_v4.ts` - Replay implementation
- `packages/verifier/src/dbl/blame_resolver_v1.ts` - DBL implementation
- `fixtures/compromised/README.md` - Compromised fixture documentation
