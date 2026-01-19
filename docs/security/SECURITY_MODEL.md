# Security Model (v2)

This document describes the security model, threat model, and trust boundaries for Pact v2, including the security framework foundation added in Phase 4.

---

## Overview

Pact is a **coordination and settlement protocol**, not a custody system, exchange, or trusted execution environment. Its security model is deliberately narrow and explicit.

This document extends the base security model described in `SECURITY.md` with v2-specific considerations, including:

- Transcript sanitization
- Secure storage
- Secret redaction
- Trust boundaries

---

## Threat Model

### Attacker Goals

Pact assumes the following adversarial behaviors are possible:

1. **Malicious Counterparties**
   - Providers that attempt to extract value without delivering
   - Buyers that attempt to avoid payment
   - Strategic early exits to maximize advantage

2. **Network-Level Attacks**
   - Message interception and replay
   - Man-in-the-middle attacks
   - Denial-of-service

3. **Key Compromise**
   - Stolen private keys
   - Compromised key storage
   - Side-channel attacks on key material

4. **Secret Leakage**
   - Accidental logging of private keys, API keys, or mnemonics
   - Transcripts containing sensitive wallet data
   - Error messages exposing secrets

5. **Storage Attacks**
   - Unencrypted credential storage
   - Weak encryption keys
   - File system access to sensitive data

### What Pact Defends Against

Pact is designed to remain correct and secure under these conditions:

- ✅ **Deterministic Outcomes**: Same inputs produce same results, preventing hidden manipulation
- ✅ **Message Authenticity**: All messages are signed with Ed25519, preventing tampering and impersonation
- ✅ **Fair Exchange**: Commit/reveal flows and streaming caps prevent one-sided advantage
- ✅ **Secret Sanitization**: Transcripts and logs are automatically sanitized to prevent secret leakage
- ✅ **Encrypted Storage**: Secure store uses AES-256-GCM with scrypt key derivation
- ✅ **Secret Detection**: CI scans prevent accidental secret commits

### Explicitly Out of Scope

Pact does **not** attempt to defend against:

- ❌ **Compromised Private Keys**: If a private key is stolen, the attacker can impersonate that identity
- ❌ **Malicious Host Machines**: If the host is compromised, all security guarantees are void
- ❌ **Side-Channel Attacks**: Timing attacks, power analysis, etc. are not mitigated
- ❌ **Denial-of-Service**: Transport-layer DoS is not prevented
- ❌ **Economic Griefing**: Off-protocol coordination attacks are not prevented
- ❌ **Custody Guarantees**: Pact does not hold or custody any assets
- ❌ **Key Management**: Key generation, rotation, and backup are application responsibilities

These must be handled by the surrounding system.

---

## Trust Boundaries

### In-Scope (Trusted)

1. **Protocol Execution**
   - Deterministic message processing
   - Signature verification
   - Policy enforcement
   - Settlement coordination

2. **Transcript Generation**
   - Audit trail creation
   - Secret sanitization
   - Outcome recording

3. **Secure Storage** (v2 Phase 4)
   - Encrypted credential storage
   - Passphrase-protected stores
   - File-backed encryption

### Out-of-Scope (Untrusted)

1. **Transport Layer**
   - HTTP/TLS (assumed but not enforced)
   - Network availability
   - Message delivery guarantees

2. **Key Storage**
   - Private key protection
   - Key rotation
   - Key backup/recovery

3. **Settlement Providers**
   - External payment processors
   - Wallet implementations
   - Blockchain interactions

4. **Host Environment**
   - Operating system security
   - File system permissions
   - Process isolation

---

## What Pact Does Not Do

### No Custody Guarantees

Pact **does not**:
- Hold or custody any assets
- Manage wallets or private keys
- Execute transactions on blockchains
- Guarantee payment finality
- Provide escrow services

Pact coordinates **who** to transact with and **on what terms**, but actual asset movement happens outside the protocol.

### No Key Management

Pact **does not**:
- Generate keys
- Store keys (except via SecureStore if explicitly used)
- Rotate keys
- Backup keys
- Recover lost keys

Applications must handle key lifecycle management.

### No Network Security

Pact **does not**:
- Enforce TLS
- Prevent DoS attacks
- Guarantee message delivery
- Provide network-level authentication

Transport security is assumed but not enforced.

### No Side-Channel Protection

Pact **does not**:
- Mitigate timing attacks
- Prevent power analysis
- Protect against cache attacks
- Defend against speculative execution vulnerabilities

These require hardware or OS-level mitigations.

### No Economic Guarantees

Pact **does not**:
- Prevent griefing attacks
- Guarantee market fairness
- Enforce pricing rules
- Prevent collusion

Economic security is application-level.

---

## Transcript Sanitization

### Overview

Transcripts are audit trails of acquisition operations. They must never contain secrets, private keys, or sensitive wallet data.

### Sanitization Process

When transcripts are created in `acquire.ts`, the following sanitization occurs:

1. **Wallet Parameter Sanitization**
   ```typescript
   // Sensitive fields are explicitly removed:
   - privateKey
   - secretKey
   - keypair
   - wallet (object containing sensitive data)
   - mnemonic
   ```

2. **Allowed Fields**
   - `address` (public wallet address)
   - `chain_id` (public chain identifier)
   - `injected` (test-only, non-sensitive)

3. **Deep Redaction** (v2 Phase 4)
   - The `redactSecrets()` function recursively scans objects
   - Keys matching secret patterns are replaced with `[REDACTED]`
   - Patterns include: `secret`, `private`, `seed`, `mnemonic`, `api_key`, `token`, `passphrase`, `password`

### Secret Patterns

The following patterns trigger redaction:

- `secret*` (e.g., `secretKey`, `secret_key`)
- `private*` (e.g., `privateKey`, `private_key`)
- `seed*` (e.g., `seed`, `seedPhrase`)
- `mnemonic*`
- `api_key`, `apikey`
- `token*`
- `passphrase*`
- `password*`, `pwd*`

**Note**: `public_key` is **not** redacted (it's public by design).

### Validation

The `assertNoSecretsInTranscript()` function validates that transcripts contain no secrets:

```typescript
const result = assertNoSecretsInTranscript(transcript);
if (!result.ok) {
  throw new Error(`Transcript contains secrets: ${result.reason}`);
}
```

This should be called before:
- Saving transcripts to disk
- Sending transcripts over the network
- Logging transcripts

### Example

**Before sanitization:**
```json
{
  "wallet": {
    "params": {
      "privateKey": "0xabcdef...",
      "address": "0x1234..."
    }
  }
}
```

**After sanitization:**
```json
{
  "wallet": {
    "params": {
      "address": "0x1234..."
    }
  }
}
```

---

## Secure Storage (v2 Phase 4)

### Overview

The `FileSecureStore` provides encrypted key-value storage for sensitive data.

### Security Properties

1. **Encryption**: AES-256-GCM with random IV per record
2. **Key Derivation**: scrypt (N=16384, r=8, p=1) from passphrase + salt
3. **Salt Management**: Random 16-byte salt per store instance (stored in `.salt` file)
4. **No Logging**: Secrets and decrypted payloads are never logged

### Usage

```typescript
import { FileSecureStore } from "@pact/sdk";

// Production: require encryption
const store = new FileSecureStore({
  baseDir: ".pact/secure",
  requirePassphrase: true, // Enforces encryption
  // Passphrase from PACT_LOCAL_KEY or PACT_SECURESTORE_PASSPHRASE
});

// Testing: encryption disabled if no env var (convenient for tests)
const testStore = new FileSecureStore({
  baseDir: ".pact/secure",
  // No passphrase = plaintext storage (tests can run without setup)
});

await store.put("api_key", "sk_live_...");
const key = await store.get<string>("api_key");
```

### Environment Variables

- `PACT_LOCAL_KEY`: Passphrase for encryption (convenience alias, checked first)
- `PACT_SECURESTORE_PASSPHRASE`: Passphrase for encryption (fallback)
- `PACT_SECURESTORE_DIR`: Base directory for storage (default: `.pact/secure`)

**Encryption Modes**:
- **Encryption enabled**: If `PACT_LOCAL_KEY` or `PACT_SECURESTORE_PASSPHRASE` is set, data is encrypted
- **Encryption disabled**: If no passphrase is provided, data is stored in plaintext (for testing convenience)
- **Production**: Always use `requirePassphrase: true` to enforce encryption

### Security Considerations

1. **Passphrase Strength**: Use strong, randomly generated passphrases
2. **Storage Location**: Store encrypted files in a secure location (not in git)
3. **Access Control**: Ensure file system permissions restrict access to `.pact/secure/`
4. **Backup**: Backup the `.salt` file along with encrypted data (losing salt = data loss)

---

## Secret Detection

### CI Scanning

The `secret:scan` script scans git-tracked files for accidental secrets:

- `sk_live_*` (Stripe live keys, 24+ chars)
- `sk_test_*` (Stripe test keys, 24+ chars)
- `rk_live_*` (Stripe restricted keys)
- `AKIA*` (AWS access key IDs)
- `xoxb-*` (Slack bot tokens)
- `AIza*` (Google API keys)
- `-----BEGIN (EC|RSA|PRIVATE) KEY-----` (Private keys in PEM format)
- `mnemonic` / `seed phrase` (with context)

### Allowlist

Test files are automatically allowlisted:
- `__tests__/**/*.test.ts`
- `*.test.ts` / `*.spec.ts`
- Documentation files
- Script files

### Running

```bash
pnpm secret:scan
```

Exits non-zero if secrets are found.

---

## Cryptography

Pact uses:

- **Ed25519** for message signatures
- **SHA-256** for content-addressed hashes
- **AES-256-GCM** for secure storage encryption (v2 Phase 4)
- **scrypt** for key derivation (v2 Phase 4)

No custom cryptography is introduced. All operations use well-established libraries (Node.js `crypto`, tweetnacl).

---

## Key Management

Key generation, storage, and rotation are **out of scope** for Pact.

Applications are responsible for:

- Protecting private keys
- Rotating keys when compromised
- Associating reputation with keys intentionally
- Using `FileSecureStore` for encrypted credential storage (optional)

Pact treats keys as identities, not accounts.

---

## Security Philosophy

Pact does not try to be:

- "Trustless"
- "Fully decentralized"
- "Secure against everything"

It aims to be:

- **Correct**: Deterministic and verifiable
- **Transparent**: Clear about what it does and doesn't do
- **Honest**: Explicit about security boundaries
- **Practical**: Usable in real-world applications

Security comes from **clarity**, not marketing.

---

## Common Failure Modes and Mitigations

### Secret Leakage in Logs

**Failure Mode**: Developers accidentally log objects containing secrets:
```typescript
logger.info("Processing request", { api_key: "sk_live_...", user: "alice" });
```

**Mitigation**:
- ✅ Logger automatically sanitizes secrets via `redactSecrets()` (v2 Phase 4)
- ✅ All `log()` calls automatically redact secret fields
- ✅ Secret patterns: `secret`, `private`, `seed`, `mnemonic`, `api_key`, `token`, `passphrase`, `password`

**Rule**: **Never log secrets**. The logger will redact them, but don't rely on it—avoid logging sensitive data entirely.

### Secret Leakage in Transcripts

**Failure Mode**: Transcripts contain private keys, API keys, or mnemonics from wallet params.

**Mitigation**:
- ✅ `acquire()` sanitizes wallet params before creating transcripts
- ✅ Removed fields: `privateKey`, `secretKey`, `keypair`, `wallet`, `mnemonic`
- ✅ `assertNoSecretsInTranscript()` validates transcripts before saving
- ✅ Transcript store only receives sanitized data

**Rule**: **Never commit secrets to transcripts**. Sanitization happens automatically, but verify with `assertNoSecretsInTranscript()`.

### Secret Leakage in Git

**Failure Mode**: Developers accidentally commit API keys, private keys, or secrets to git.

**Mitigation**:
- ✅ CI secret scan (`pnpm secret:scan`) blocks obvious patterns
- ✅ Scans for: Stripe keys, AWS keys, private keys (PEM and hex), mnemonics
- ✅ Test files are allowlisted (but patterns must be short enough to not match)
- ✅ Fast (< 2s) and runs in CI

**Rule**: **Never commit secrets to git**. The CI scan will catch obvious patterns, but use environment variables or secure store.

### Unencrypted Credential Storage

**Failure Mode**: Credentials stored in plaintext files (e.g., `~/.pact/credentials.json`).

**Mitigation**:
- ✅ `FileSecureStore` provides encrypted-at-rest storage
- ✅ AES-256-GCM encryption with scrypt key derivation
- ✅ Random salt per store, random IV per record
- ✅ Passphrase required (from env or explicit)

**Rule**: **Always encrypt credentials at rest**. Use `FileSecureStore` for any sensitive data.

### Error Messages Exposing Secrets

**Failure Mode**: Error messages include API keys or secrets, or error objects contain full config:
```typescript
throw new Error(`API call failed with key: ${apiKey}`);
throw new Error(`Config invalid: ${JSON.stringify(config)}`); // config might contain secrets
```

**Mitigation**:
- ✅ `sanitizeErrorMessage()` function redacts API key patterns from error messages
- ✅ `sanitizeError()` function redacts secrets from error objects
- ✅ `createSanitizedError()` helper for error packaging functions
- ✅ Used in `stripe_live` and other providers
- ✅ Patterns: `sk_live_*`, `sk_test_*`, `rk_live_*`, `AKIA*`

**Rule**: **Never include secrets in error messages**. Use `sanitizeError()` or `createSanitizedError()` when packaging errors with config objects.

---

## Security Rules

### Don't Log Secrets

**Rule**: Never log secrets, private keys, API keys, or mnemonics.

**Enforcement**:
- Logger automatically redacts secrets via `redactSecrets()`
- But: Don't rely on automatic redaction—avoid logging sensitive data entirely
- Use `assertNoSecretsInTranscript()` to validate before logging transcripts

**Examples**:
```typescript
// ❌ BAD
logger.info("API key", { api_key: "sk_live_123..." });

// ✅ GOOD (will be redacted automatically, but still avoid)
logger.info("API call", { api_key: "sk_live_123..." }); // Redacted to [REDACTED]

// ✅ BETTER
logger.info("API call", { api_key: "[REDACTED]" });
```

### Never Commit Secrets

**Rule**: Never commit secrets, API keys, private keys, or mnemonics to git.

**Enforcement**:
- CI secret scan (`pnpm secret:scan`) runs on every commit
- Scans for: Stripe keys, AWS keys, private keys, mnemonics
- Fails CI if secrets found
- Test files are allowlisted (but use short fake keys)

**Examples**:
```typescript
// ❌ BAD - Will be caught by CI scan
const API_KEY = "sk_live_REDACTED";

// ✅ GOOD - Use environment variables
const API_KEY = process.env.PACT_STRIPE_API_KEY;

// ✅ GOOD - Use secure store
const store = new FileSecureStore({ passphrase: process.env.PACT_SECURESTORE_PASSPHRASE });
const apiKey = await store.get<string>("api_key");
```

### Always Encrypt Credentials at Rest

**Rule**: Always encrypt credentials when storing to disk.

**Enforcement**:
- Use `FileSecureStore` for any credential storage
- Never store credentials in plaintext JSON files
- Passphrase required (from env or explicit)

**Examples**:
```typescript
// ❌ BAD
fs.writeFileSync("credentials.json", JSON.stringify({ api_key: "sk_live_..." }));

// ✅ GOOD
const store = new FileSecureStore({ passphrase: process.env.PACT_SECURESTORE_PASSPHRASE });
await store.put("api_key", "sk_live_...");
```

### Redact Secrets from Error Messages

**Rule**: Never include secrets in error messages or exceptions.

**Enforcement**:
- Use `redactApiKey()` for API key patterns
- Use `redactSecrets()` for general secret redaction
- Provider implementations should redact secrets in errors

**Examples**:
```typescript
// ❌ BAD
throw new Error(`Stripe API failed with key: ${apiKey}`);

// ✅ GOOD
throw new Error(redactApiKey(`Stripe API failed with key: ${apiKey}`));
```

---

## Reporting Vulnerabilities

If you discover a security issue:

- **Do not** open a public issue
- Contact the maintainers directly
- Provide a minimal reproduction if possible

Responsible disclosure is expected.

---

## References

- `SECURITY.md`: Base security model and protocol security
- `docs/SECURITY_CHECKLIST.md`: Pre-release security checklist
- `packages/sdk/src/security/`: Security framework implementation
