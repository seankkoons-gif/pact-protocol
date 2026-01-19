# PACT Buyer Guide

This guide explains how to use PACT as a buyer to acquire services from providers.

> **v4 is complete and production-ready!** For v4 features (Policy-as-Code, Boundary Runtime, Passport, Credit), see [versions/v4/STATUS.md](../versions/v4/STATUS.md). This guide covers v3 (stable and maintained).

## Minimal acquire() Usage

The core function is `acquire()`:

```typescript
import { acquire, createDefaultPolicy, generateKeyPair } from "@pact/sdk";
import bs58 from "bs58";

const buyerKeyPair = generateKeyPair();
const sellerKeyPair = generateKeyPair();
const buyerId = bs58.encode(Buffer.from(buyerKeyPair.publicKey));
const sellerId = bs58.encode(Buffer.from(sellerKeyPair.publicKey));

const result = await acquire({
  input: {
    intentType: "weather.data",
    scope: "NYC",
    constraints: { latency_ms: 50, freshness_sec: 10 },
    maxPrice: 0.0001,
    saveTranscript: true,
    transcriptDir: ".pact/transcripts",
  },
  buyerKeyPair,
  sellerKeyPair,
  sellerKeyPairsByPubkeyB58: { [sellerId]: sellerKeyPair },
  buyerId,
  sellerId,
  policy: createDefaultPolicy(),
  settlement: new MockSettlementProvider(),
  directory: new InMemoryProviderDirectory(),
  now: () => Date.now(),
});

if (result.ok && result.receipt) {
  console.log("Success!", result.receipt);
} else {
  console.error("Failed:", result.code, result.reason);
}
```

## Requiring Credentials and Trust Tiers

Buyers can require specific credentials and minimum trust tiers:

```typescript
const policy = createDefaultPolicy({
  requireCredential: ["sla_verified", "bonded"],
  minTrustTier: 2,
});
```

### Failure Codes

If no providers meet the requirements:

- `NO_ELIGIBLE_PROVIDERS`: No providers found or none met policy requirements
- `PROVIDER_TRUST_TIER_TOO_LOW`: Provider's trust tier is below `minTrustTier`
- `CREDENTIAL_MISSING`: Provider doesn't have required credentials
- `CREDENTIAL_EXPIRED`: Provider's credential has expired

## ZK-KYA Identity Verification (v2 Phase 5)

Buyers can provide zero-knowledge proof-based identity verification (ZK-KYA) to prove their identity and credentials without revealing sensitive information.

### Enabling ZK-KYA in Policy

To require ZK-KYA proofs, configure your policy:

```typescript
import { createDefaultPolicy } from "@pact/sdk";

const policy = createDefaultPolicy();
policy.base.kya.zk_kya = {
  required: true,                        // Require ZK-KYA proof
  min_tier: "trusted",                    // Minimum trust tier (untrusted, low, trusted)
  require_issuer: true,                   // Require issuer_id to be present
  allowed_issuers: [                     // Whitelist of trusted issuers
    "issuer_pact_registry",
    "issuer_kyc_provider_v1"
  ]
};
```

### Providing ZK-KYA Proof

When ZK-KYA is required, provide the proof in `acquire()` input:

```typescript
const result = await acquire({
  input: {
    intentType: "weather.data",
    scope: "NYC",
    constraints: { latency_ms: 50, freshness_sec: 10 },
    maxPrice: 0.0001,
    identity: {
      buyer: {
        zk_kya_proof: {
          scheme: "groth16",              // Proof scheme (groth16, plonk, halo2, unknown)
          circuit_id: "kyc_v1",           // Circuit identifier
          issuer_id: "issuer_pact_registry", // Issuer identifier (if required)
          public_inputs: {                // Public inputs (will be hashed)
            age: 25,
            verified: true,
            region: "US"
          },
          proof_bytes_b64: "...",         // Base64-encoded proof bytes (will be hashed)
          issued_at_ms: 1704067200000,    // Issuance timestamp
          expires_at_ms: 1704153600000,   // Expiration timestamp
          meta: {                         // Optional metadata
            version: "1.0"
          }
        }
      }
    }
  },
  // ... other acquire() parameters ...
});
```

### Important Notes

- **Raw data is never stored**: Pact automatically hashes `public_inputs` and `proof_bytes_b64` before storing in transcripts
- **Expiry is enforced**: If `expires_at_ms` is provided and has passed, `acquire()` returns `ZK_KYA_EXPIRED`
- **Issuer validation**: If `require_issuer: true` and `allowed_issuers` is set, the `issuer_id` must be in the allowed list
- **Default verifier**: Pact's default verifier returns `ZK_KYA_NOT_IMPLEMENTED` (for deterministic CI). Real ZK verification must be implemented externally.

### Failure Codes

- `ZK_KYA_REQUIRED`: Policy requires ZK-KYA but no proof provided
- `ZK_KYA_NOT_IMPLEMENTED`: Default verifier (no external ZK implementation)
- `ZK_KYA_INVALID`: Proof verification failed
- `ZK_KYA_EXPIRED`: Proof has expired
- `ZK_KYA_TIER_TOO_LOW`: Trust tier below required minimum
- `ZK_KYA_ISSUER_NOT_ALLOWED`: Issuer not in allowed list

See [ZK-KYA Documentation](../security/ZK_KYA.md) for detailed information about proof structure, hashing rules, and security considerations.

## Settlement Providers

Buyers must provide a settlement provider. PACT supports three types:

### 1. Mock Settlement Provider

For testing and demos:

```typescript
import { MockSettlementProvider } from "@pact/sdk";

const settlement = new MockSettlementProvider();
settlement.credit(buyerId, 1.0); // Give buyer funds
settlement.credit(sellerId, 0.1); // Give seller funds
```

### 2. Stripe-like Settlement Provider

Simulates async settlement (like Stripe):

```typescript
import { StripeLikeSettlementProvider } from "@pact/sdk";

const settlement = new StripeLikeSettlementProvider({
  asyncCommit: true, // Enable async commit
  commitDelayTicks: 3, // Resolve after 3 polls
  forcePendingUntilPoll: 5, // Force pending for first 5 polls
});
```

### 3. External Settlement Provider

For integration with real payment rails:

```typescript
import { ExternalSettlementProvider } from "@pact/sdk";

const settlement = new ExternalSettlementProvider({
  // Implement your payment logic
});
```

### 4. Stripe Live Settlement Provider (Boundary Only)

**v2 Phase 3:** Boundary/skeleton implementation for Stripe Live integration.

**What it is:**
- Configuration interface for Stripe Live integration
- Validates environment variables and parameters
- Provides a clear boundary for external integration

**What it's not:**
- **No network calls** - All operational methods return "not implemented" errors
- **No Stripe SDK usage** - This is a skeleton only
- **Not functional** - Must be replaced with actual Stripe API integration in your service

**Configuration:**

Set environment variables:
```bash
export PACT_STRIPE_API_KEY="sk_test_..."  # Required if enabled=true
export PACT_STRIPE_MODE="sandbox"          # Optional: "sandbox" (default) or "live"
export PACT_STRIPE_ENABLED="true"          # Optional: enable provider (requires API key)
```

Use in acquire():
```typescript
const result = await acquire({
  input: {
    // ...
    settlement: {
      provider: "stripe_live",
      params: {
        mode: "sandbox",              // Optional: "sandbox" or "live" (default: "sandbox")
        account_id: "acct_123",       // Optional: Stripe account ID
        idempotency_prefix: "pact-", // Optional: prefix for idempotency keys
        enabled: true,                // Optional: enable provider (requires PACT_STRIPE_API_KEY)
      },
    },
  },
  // ...
});
```

**Important Notes:**
- **No network calls in OSS repo** - This is a boundary only
- **Integrate in your own service** - Replace the skeleton with actual Stripe API calls
- **API key never logged** - Secrets are redacted from error messages and transcripts
- **Deterministic failures** - All methods return "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED" errors

**Validation:**
- `enabled=true` requires `PACT_STRIPE_API_KEY` environment variable
- `mode` must be "sandbox" or "live"
- Unknown properties are rejected

## Transcripts

Transcripts are JSON files that record the entire acquisition process:

- Negotiation steps
- Settlement attempts
- Final outcome
- Receipt (if successful)

### Saving Transcripts

Enable transcript saving:

```typescript
const result = await acquire({
  input: {
    // ...
    saveTranscript: true,
    transcriptDir: ".pact/transcripts",
  },
  // ...
});
```

The transcript path is returned in `result.transcriptPath`.

### Verifying Transcripts

Verify a transcript:

```bash
# Default mode: warnings for pending settlements, expired credentials, and wallet verification failures
pnpm replay:verify -- .pact/transcripts/intent-123.json

# Strict mode: errors for pending settlements (expired credentials and wallet failures still warnings)
pnpm replay:verify --strict -- .pact/transcripts/intent-123.json

# Strict + terminal-only: skip pending, verify only terminal
pnpm replay:verify --strict --terminal-only -- .pact/transcripts
```

**Note**: `CREDENTIAL_EXPIRED` and `WALLET_VERIFY_FAILED` are always treated as warnings (expected for historical transcripts), even in strict mode.

### Replaying Transcripts

Replay a transcript programmatically:

```typescript
import { replayTranscript } from "@pact/sdk";

const transcript = JSON.parse(fs.readFileSync("transcript.json", "utf-8"));
const result = await replayTranscript(transcript);

if (result.ok) {
  console.log("Transcript verified");
} else {
  console.error("Failures:", result.failures);
}
```

## Reconciling Pending Settlements

If a settlement is pending (async settlement timed out), you can reconcile it later:

```typescript
import { reconcile } from "@pact/sdk";

const reconcileResult = await reconcile({
  transcriptPath: ".pact/transcripts/intent-123.json",
  settlement: settlementProvider,
  now: () => Date.now(),
});

if (reconcileResult.ok && reconcileResult.status === "UPDATED") {
  console.log("Settlement updated:", reconcileResult.updatedTranscriptPath);
  console.log("New status:", reconcileResult.reconciledHandles[0].status);
}
```

The reconcile function:
1. Loads the transcript
2. Checks if settlement is pending
3. Polls the settlement provider
4. Updates the transcript with the new status
5. Writes a new reconciled transcript file

## Common Failure Codes

### Discovery / Selection
- `NO_ELIGIBLE_PROVIDERS`: No providers found or none met requirements
- `PROVIDER_TRUST_TIER_TOO_LOW`: Provider trust tier too low
- `CREDENTIAL_MISSING`: Required credential not present
- `CREDENTIAL_EXPIRED`: Credential has expired (treated as warning in replay verification)

### Settlement
- `SETTLEMENT_FAILED`: Settlement execution failed
- `SETTLEMENT_POLL_TIMEOUT`: Async settlement still pending after max polls
- `BOND_INSUFFICIENT`: Provider bond too low
- `FAILED_PROOF`: Commit-reveal proof verification failed

### Other
- `BUYER_STOPPED`: Buyer stopped streaming early
- `NEGOTIATION_TIMEOUT`: Negotiation took too long

## Next Steps

- See [getting-started/QUICKSTART.md](../getting-started/QUICKSTART.md) for end-to-end examples
- See [PROVIDER_GUIDE.md](./PROVIDER_GUIDE.md) for provider setup
- Check [PROTOCOL.md](../reference/PROTOCOL.md) for protocol details
- Explore [examples/](../examples/) for working code



