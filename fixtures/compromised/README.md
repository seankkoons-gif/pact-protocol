# Compromised Fixtures

This directory contains intentionally compromised fixtures used for testing error handling and robustness.

## Rules of Evidence

**Replay verifies integrity (container hash must match).**  
**DBL verifies signed rounds (container hash can be stale).**

See [`RULES_OF_EVIDENCE.md`](./RULES_OF_EVIDENCE.md) for detailed constitutional rules.

## Important: Expected Behavior

**These fixtures are expected to fail replay verification** with specific error codes.

**⚠️ CRITICAL FOR CI/VERIFICATION:** 
- `fixtures/compromised/**` fixtures are **EXPECTED** to fail replay (exit code 1)
- This is intentional and correct behavior
- Do not treat these failures as test failures in CI
- See [`../VERIFICATION.md`](../VERIFICATION.md) for verification patterns

**Checklist:**
- [ ] `replay:v4 <path>` → Exit 1 (integrity compromised) ✅ **Expected to fail - this is correct**
- [ ] `replay:v4 --allow-compromised <path>` → Exit 0 (if only FINAL_HASH_MISMATCH, rounds valid)
- [ ] `judge-v4 <path>` → Exit 0 (LVSH established) ✅ **Expected to succeed**

### FINAL_HASH_MISMATCH Fixtures

Fixtures with `-finalhash-mismatch` suffix have intentionally corrupted `final_hash` values that do not match the computed transcript hash.

**Expected behavior:**
- `replay:v4` will exit with non-zero status
- Replay will report `FINAL_HASH_MISMATCH` error
- Integrity status will be `TAMPERED`
- **However**, DBL (Default Blame Logic) should still be able to establish LVSH from signed rounds

**Why these exist:**
- Test DBL's resilience to stale/corrupt final_hash values
- Verify that signed round verification is independent of container hash
- Ensure automated pipelines can distinguish between different failure types

**For automated pipelines:**
When verifying fixtures, treat compromised fixtures separately:
- Regular fixtures: Must pass replay verification (`pnpm replay:v4 <path>`)
- Compromised fixtures: Use `--allow-compromised` flag to allow expected errors:
  ```bash
  pnpm replay:v4 --allow-compromised fixtures/compromised/PACT-404-settlement-timeout-finalhash-mismatch.json
  ```
  - Without flag: exits with code 1 (fails verification)
  - With `--allow-compromised`: exits with code 0 if only `FINAL_HASH_MISMATCH` (and rounds are valid)

## Fixtures

- `PACT-404-settlement-timeout-finalhash-mismatch.json`: Settlement timeout with intentionally mismatched final_hash

## Command Examples

**For DBL (judge_v4.ts):**
```bash
pnpm judge:v4 fixtures/compromised/PACT-404-settlement-timeout-finalhash-mismatch.json
```

**For replay verification:**
```bash
# Without flag: exits with code 1 (fails verification)
pnpm replay:v4 fixtures/compromised/PACT-404-settlement-timeout-finalhash-mismatch.json

# With flag: exits with code 0 if only FINAL_HASH_MISMATCH (and rounds are valid)
pnpm replay:v4 --allow-compromised fixtures/compromised/PACT-404-settlement-timeout-finalhash-mismatch.json
```

## Notes

**Valid PACT-404 fixture:** A valid `PACT-404-settlement-timeout.json` fixture (with correct final_hash) can be generated using:
```bash
pnpm -w tsx fixtures/generate_v4_fixtures.ts
# or
node scripts/generate-v4-fixtures.mjs
```

This will create `fixtures/failures/PACT-404-settlement-timeout.json` with a valid final_hash.

The compromised version in this directory (`PACT-404-settlement-timeout-finalhash-mismatch.json`) is intentionally corrupted for testing DBL's resilience to final_hash mismatches.
