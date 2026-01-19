# ZK-KYA (Zero-Knowledge Know Your Agent)

## Overview

ZK-KYA (Zero-Knowledge Know Your Agent) is an identity verification interface in Pact v2 that allows buyers to prove their identity and credentials using zero-knowledge proofs without revealing sensitive information.

**Important:** Pact v2 Phase 5 provides the ZK-KYA *interface* only. The actual zero-knowledge cryptography (proof generation, verification algorithms) must be implemented externally. Pact's default verifier returns `ZK_KYA_NOT_IMPLEMENTED` for deterministic CI behavior.

## What ZK-KYA Is (and Isn't)

### What ZK-KYA Is

- **An interface** for zero-knowledge proof-based identity verification
- **Policy-gated** verification that can be required or optional
- **Transcript metadata** recording (hashes only, never raw proofs)
- **Deterministic** in CI (default verifier always returns "not implemented")

### What ZK-KYA Is Not

- **Not a ZK proof system**: Pact does not implement Groth16, PLONK, Halo2, or any other ZK scheme
- **Not a credential issuer**: Pact does not issue or validate credentials
- **Not a trust authority**: Pact does not assign trust tiers or scores (these come from the verifier)

## Proof Structure

A ZK-KYA proof in Pact has the following structure:

```typescript
interface ZkKyaProof {
  scheme: "groth16" | "plonk" | "halo2" | "unknown";
  circuit_id: string;                    // e.g., "kyc_v1", "reputation_v2"
  issuer_id?: string;                    // Optional issuer identifier
  public_inputs_hash: string;            // SHA-256 hash (hex) of canonicalized public inputs
  proof_hash: string;                     // SHA-256 hash (hex) of proof bytes
  issued_at_ms?: number;                  // Issuance timestamp (milliseconds)
  expires_at_ms?: number;                 // Expiration timestamp (milliseconds)
  meta?: Record<string, unknown>;         // Non-sensitive metadata
}
```

## Hashing Rules

Pact enforces strict hashing rules to ensure deterministic verification and prevent secret leakage:

### Public Inputs Hashing

1. **Canonicalization**: Public inputs are canonicalized using stable JSON serialization (sorted keys, deterministic array order)
2. **SHA-256**: The canonical JSON string is hashed using SHA-256
3. **Hex encoding**: The hash is stored as a 64-character hex string

```typescript
import { canonicalizePublicInputs, sha256Hex } from "@pact/sdk";

const publicInputs = { age: 25, verified: true, region: "US" };
const canonical = canonicalizePublicInputs(publicInputs);
const hash = sha256Hex(canonical); // 64-char hex string
```

### Proof Bytes Hashing

1. **Base64 decode**: Proof bytes are provided as base64-encoded strings
2. **SHA-256**: The raw proof bytes are hashed using SHA-256
3. **Hex encoding**: The hash is stored as a 64-character hex string

```typescript
import { sha256Hex } from "@pact/sdk";

const proofBytesB64 = "dGVzdCBwcm9vZiBieXRlcw==";
const proofBytes = Buffer.from(proofBytesB64, "base64");
const hash = sha256Hex(proofBytes); // 64-char hex string
```

### Why Only Hashes?

- **Security**: Raw proof bytes and public inputs may contain sensitive information
- **Transcript integrity**: Hashes allow verification that the same proof was used without storing secrets
- **Auditability**: Hashes provide a tamper-evident record without exposing private data

## Issuer Allow-Listing

Pact supports issuer allow-listing to restrict which credential issuers are trusted:

```typescript
const policy = {
  // ... other policy fields ...
  base: {
    kya: {
      trust: { /* ... */ },
      zk_kya: {
        required: true,
        require_issuer: true,              // Require issuer_id to be present
        allowed_issuers: [                 // Whitelist of trusted issuers
          "issuer_pact_registry",
          "issuer_kyc_provider_v1",
          "issuer_reputation_service"
        ],
        min_tier: "trusted"                 // Minimum trust tier required
      }
    }
  }
};
```

### Issuer Validation Flow

1. If `require_issuer: true`, the proof must include `issuer_id`
2. If `allowed_issuers` is non-empty, `issuer_id` must be in the list
3. If validation fails, `acquire()` returns `ZK_KYA_ISSUER_NOT_ALLOWED`

## Transcript Policy

Pact enforces a strict "hashes only" policy for ZK-KYA in transcripts:

### What Is Stored

- `scheme`: Proof scheme identifier (e.g., "groth16")
- `circuit_id`: Circuit identifier (e.g., "kyc_v1")
- `issuer_id`: Issuer identifier (if provided)
- `public_inputs_hash`: SHA-256 hash of canonicalized public inputs
- `proof_hash`: SHA-256 hash of proof bytes
- `issued_at_ms`: Issuance timestamp
- `expires_at_ms`: Expiration timestamp
- `verification`: Verification result (ok, tier, trust_score, reason)
- `meta`: Non-sensitive metadata

### What Is Never Stored

- ❌ Raw `public_inputs` object
- ❌ Raw `proof_bytes` (base64 or otherwise)
- ❌ Any decrypted or decoded proof data
- ❌ Private keys or secrets

### Example Transcript Entry

```json
{
  "zk_kya": {
    "scheme": "groth16",
    "circuit_id": "kyc_v1",
    "issuer_id": "issuer_pact_registry",
    "public_inputs_hash": "a1b2c3d4e5f6...",
    "proof_hash": "f6e5d4c3b2a1...",
    "issued_at_ms": 1704067200000,
    "expires_at_ms": 1704153600000,
    "verification": {
      "ok": true,
      "tier": "trusted",
      "trust_score": 0.95,
      "reason": null
    },
    "meta": {
      "version": "1.0",
      "source": "external_kyc_service"
    }
  }
}
```

## Recommended Metrics

When implementing ZK-KYA verification, track these metrics:

### Verification Success Rate

- **Metric**: `zk_kya_verification_success_rate`
- **Calculation**: `(successful_verifications / total_verification_attempts) * 100`
- **Use case**: Monitor overall ZK-KYA adoption and verification reliability

### Issuer Distribution

- **Metric**: `zk_kya_issuer_distribution`
- **Calculation**: Count of proofs by `issuer_id`
- **Use case**: Understand which issuers are most trusted/used

### Expiry Failures

- **Metric**: `zk_kya_expiry_failures`
- **Calculation**: Count of `ZK_KYA_EXPIRED` failures
- **Use case**: Monitor proof freshness and renewal needs

### Tier Distribution

- **Metric**: `zk_kya_tier_distribution`
- **Calculation**: Count of verified proofs by `tier` (untrusted, low, trusted)
- **Use case**: Understand trust distribution across buyers

### Verification Latency

- **Metric**: `zk_kya_verification_latency_ms`
- **Calculation**: Time from proof submission to verification result
- **Use case**: Monitor performance impact of ZK-KYA verification

### Example Metrics Dashboard

```typescript
// Pseudo-code for metrics collection
const metrics = {
  zk_kya_verification_success_rate: 0.95,
  zk_kya_issuer_distribution: {
    "issuer_pact_registry": 1200,
    "issuer_kyc_provider_v1": 800,
    "issuer_reputation_service": 400
  },
  zk_kya_expiry_failures: 15,
  zk_kya_tier_distribution: {
    "untrusted": 50,
    "low": 300,
    "trusted": 2050
  },
  zk_kya_verification_latency_ms: {
    p50: 45,
    p90: 120,
    p99: 250
  }
};
```

## Policy Configuration

### Enabling ZK-KYA

To require ZK-KYA proofs in your policy:

```typescript
import { createDefaultPolicy } from "@pact/sdk";

const policy = createDefaultPolicy();
policy.base.kya.zk_kya = {
  required: true,                        // Require ZK-KYA proof
  min_tier: "trusted",                    // Minimum trust tier
  require_issuer: true,                   // Require issuer_id
  allowed_issuers: [                     // Allowed issuers
    "issuer_pact_registry",
    "issuer_kyc_provider_v1"
  ]
};
```

### Complete Policy Example

Here's a complete policy example with ZK-KYA enabled:

```typescript
import { createDefaultPolicy } from "@pact/sdk";

const policy = createDefaultPolicy();
policy.base.kya.zk_kya = {
  required: true,
  min_tier: "trusted",
  require_issuer: true,
  allowed_issuers: [
    "issuer_pact_registry",
    "issuer_kyc_provider_v1",
    "issuer_reputation_service"
  ]
};

// Use this policy in acquire()
const result = await acquire({
  input: {
    intentType: "weather.data",
    scope: "NYC",
    constraints: { latency_ms: 50, freshness_sec: 10 },
    maxPrice: 0.0001,
    identity: {
      buyer: {
        zk_kya_proof: {
          scheme: "groth16",
          circuit_id: "kyc_v1",
          issuer_id: "issuer_pact_registry",
          public_inputs: { verified: true, age: 25 },
          proof_bytes_b64: "...",
          issued_at_ms: Date.now() - 86400000, // 1 day ago
          expires_at_ms: Date.now() + 86400000  // 1 day from now
        }
      }
    }
  },
  // ... other parameters ...
});
```

### Disabling ZK-KYA (Default)

By default, ZK-KYA is disabled (backwards compatible):

```typescript
const policy = createDefaultPolicy();
// policy.base.kya.zk_kya.required === false (default)
```

## Failure Codes

Pact returns specific failure codes for ZK-KYA verification:

- `ZK_KYA_REQUIRED`: Policy requires ZK-KYA but no proof provided
- `ZK_KYA_NOT_IMPLEMENTED`: Default verifier (no external ZK implementation)
- `ZK_KYA_INVALID`: Proof verification failed
- `ZK_KYA_EXPIRED`: Proof has expired (`expires_at_ms < now`)
- `ZK_KYA_TIER_TOO_LOW`: Trust tier below required minimum
- `ZK_KYA_ISSUER_NOT_ALLOWED`: Issuer not in allowed list

## Implementation Notes

### Default Verifier

Pact's default `DefaultZkKyaVerifier` always returns:

```typescript
{
  ok: false,
  reason: "ZK_KYA_NOT_IMPLEMENTED"
}
```

This ensures deterministic CI behavior. To use real ZK-KYA verification, you must:

1. Implement a custom `ZkKyaVerifier` that performs actual proof verification
2. Inject it into `acquire()` (future enhancement: verifier injection API)

### Test Verifier

For testing, use `createTestZkKyaVerifier()`:

```typescript
import { createTestZkKyaVerifier } from "@pact/sdk";

const testVerifier = createTestZkKyaVerifier({
  shouldPass: true,
  tier: "trusted",
  trustScore: 0.9
});
```

## Security Considerations

1. **Never log raw proofs**: Always hash proof bytes and public inputs before logging
2. **Validate expiry**: Always check `expires_at_ms` before accepting proofs
3. **Issuer allow-listing**: Use `allowed_issuers` to restrict trusted issuers
4. **Tier enforcement**: Set `min_tier` to enforce minimum trust requirements
5. **Transcript sanitization**: Pact automatically hashes proofs in transcripts; ensure your verifier does the same

## Future Enhancements

- Verifier injection API for custom ZK implementations
- Support for multiple proof schemes in a single acquisition
- Proof caching and reuse
- Integration with external ZK proof services
