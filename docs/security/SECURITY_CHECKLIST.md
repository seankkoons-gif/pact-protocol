# Security Checklist (v2)

Pre-release security checklist for Pact v2. Run this checklist before every release.

---

## Pre-Release Checklist

### 1. Secret Scanning ✅

**Command:**
```bash
pnpm secret:scan
```

**Verification:**
- ✅ No secrets found in git-tracked files
- ✅ Test files are properly allowlisted
- ✅ No `sk_live_*`, `rk_live_*`, `xoxb-*`, `AIza*`, private keys, or mnemonics in tracked files

**Failure Action:**
- Remove secrets from tracked files
- Add to `.gitignore` if needed
- Update allowlist in `scripts/secret-scan.mjs` if test vectors are needed

---

### 2. Transcript Verification ✅

**Command:**
```bash
pnpm replay:verify:strict-terminal
```

**Verification:**
- ✅ All transcripts pass strict verification
- ✅ No secrets in transcript files
- ✅ Transcript structure is valid
- ✅ Terminal-only verification passes (no network calls)

**Failure Action:**
- Fix transcript generation issues
- Ensure secret sanitization is working
- Verify `assertNoSecretsInTranscript()` is called

---

### 3. Pack Check ✅

**Command:**
```bash
pnpm pack:check
```

**Verification:**
- ✅ Packages pack successfully
- ✅ No secrets in packaged files
- ✅ Only `dist/`, `README.md`, `LICENSE` included (check `package.json` `files` field)
- ✅ No `.pact/secure/` directories in packages
- ✅ No source files with secrets

**Failure Action:**
- Verify `package.json` `files` field is correct
- Check for accidental source file inclusion
- Ensure `.gitignore` excludes sensitive directories

---

### 4. Secure Store Passphrase ✅

**Verification:**
- ✅ `FileSecureStore` requires passphrase (from env or explicit)
- ✅ No hardcoded passphrases in code
- ✅ Documentation mentions `PACT_SECURESTORE_PASSPHRASE` requirement
- ✅ Tests use explicit passphrases (not env-dependent)

**Failure Action:**
- Ensure `FileSecureStore` constructor throws if no passphrase
- Update documentation if needed
- Verify tests don't rely on env vars

---

### 5. Transcript Sanitization ✅

**Verification:**
- ✅ `acquire.ts` sanitizes wallet params before transcript creation
- ✅ Removed fields: `privateKey`, `secretKey`, `keypair`, `wallet`, `mnemonic`
- ✅ `redactSecrets()` is available and tested
- ✅ `assertNoSecretsInTranscript()` is available and tested

**Manual Check:**
```typescript
// In packages/sdk/src/client/acquire.ts, verify:
const sanitizedInput = { ...input };
if (sanitizedInput.wallet?.params) {
  // Should exclude: privateKey, secretKey, keypair, wallet, mnemonic
}
```

**Failure Action:**
- Update sanitization logic
- Add missing fields to exclusion list
- Run `assertNoSecretsInTranscript()` in tests

---

### 6. Build and Tests ✅

**Command:**
```bash
pnpm build
pnpm test
```

**Verification:**
- ✅ All packages build successfully
- ✅ All tests pass (including security tests)
- ✅ No TypeScript errors
- ✅ No linter errors

**Security-Specific Tests:**
```bash
pnpm -C packages/sdk exec vitest run src/security
```

**Verification:**
- ✅ Crypto tests pass (encrypt/decrypt, wrong key fails, tampered tag fails)
- ✅ Store tests pass (put/get/del/list, can't read without passphrase)
- ✅ Redact tests pass (redacts nested secrets, transcript assertion works)

**Failure Action:**
- Fix failing tests
- Address TypeScript errors
- Resolve linter warnings

---

### 7. Release Gate ✅

**Command:**
```bash
pnpm release:gate
```

**Verification:**
- ✅ All release gate steps pass:
  1. Clean .pact directory
  2. Build packages
  3. Run tests
  4. **Secret scan** (v2 Phase 4)
  5. Pack check
  6. Run all examples
  7. Verify transcripts (strict + terminal-only)

**Failure Action:**
- Fix any failing step
- Ensure all steps are green before release

---

### 8. Documentation ✅

**Verification:**
- ✅ `docs/SECURITY_MODEL.md` exists and is up-to-date
- ✅ `docs/SECURITY_CHECKLIST.md` exists (this file)
- ✅ `SECURITY.md` is up-to-date
- ✅ Security features are documented
- ✅ Threat model is clearly described

**Failure Action:**
- Update documentation
- Add missing security considerations
- Clarify trust boundaries

---

### 9. No Hardcoded Secrets ✅

**Manual Check:**
```bash
# Search for potential hardcoded secrets
grep -r "sk_live_" packages/ --exclude-dir=node_modules --exclude="*.test.ts" || echo "OK"
grep -r "sk_test_" packages/ --exclude-dir=node_modules --exclude="*.test.ts" || echo "OK"
grep -r "BEGIN.*PRIVATE.*KEY" packages/ --exclude-dir=node_modules --exclude="*.test.ts" || echo "OK"
```

**Verification:**
- ✅ No hardcoded API keys
- ✅ No hardcoded private keys
- ✅ No hardcoded passphrases
- ✅ Test files may contain fake keys (allowlisted)

**Failure Action:**
- Remove hardcoded secrets
- Use environment variables
- Use `FileSecureStore` for sensitive data

---

### 10. Environment Variable Handling ✅

**Verification:**
- ✅ No secrets in default values
- ✅ Environment variables are documented
- ✅ Required env vars throw clear errors if missing
- ✅ Optional env vars have sensible defaults

**Check:**
- `PACT_SECURESTORE_PASSPHRASE`: Required for `FileSecureStore`, no default
- `PACT_SECURESTORE_DIR`: Optional, defaults to `.pact/secure`
- Other env vars: Check documentation

**Failure Action:**
- Update env var handling
- Document required vs optional
- Add clear error messages

---

## Quick Verification Script

Run all checks in sequence:

```bash
#!/bin/bash
set -e

echo "🔍 Running security checklist..."

echo "1. Secret scan..."
pnpm secret:scan

echo "2. Build..."
pnpm build

echo "3. Tests..."
pnpm test

echo "4. Security tests..."
pnpm -C packages/sdk exec vitest run src/security

echo "5. Pack check..."
pnpm pack:check

echo "6. Transcript verification..."
pnpm replay:verify:strict-terminal

echo "7. Release gate..."
pnpm release:gate

echo "✅ All security checks passed!"
```

---

## Post-Release

After release, verify:

- ✅ Published packages don't contain secrets (check `.tgz` files)
- ✅ Documentation is published
- ✅ Security advisories are up-to-date
- ✅ Changelog mentions security improvements

---

## Emergency Response

If a secret is accidentally committed:

1. **Immediately** rotate the compromised secret
2. Remove from git history (if possible) or mark as compromised
3. Update `scripts/secret-scan.mjs` to catch similar patterns
4. Review access logs for the compromised secret
5. Document the incident (without exposing the secret)

---

## References

- `SECURITY.md`: Base security model
- `docs/SECURITY_MODEL.md`: v2 security model and threat model
- `scripts/secret-scan.mjs`: Secret scanning implementation
- `packages/sdk/src/security/`: Security framework code
