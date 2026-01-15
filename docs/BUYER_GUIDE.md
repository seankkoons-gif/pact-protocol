# PACT Buyer Guide

This guide explains how to use PACT as a buyer to acquire services from providers.

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
# Default mode: warnings for pending settlements
pnpm replay:verify -- .pact/transcripts/intent-123.json

# Strict mode: errors for pending settlements
pnpm replay:verify --strict -- .pact/transcripts/intent-123.json

# Strict + terminal-only: skip pending, verify only terminal
pnpm replay:verify --strict --terminal-only -- .pact/transcripts
```

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
- `CREDENTIAL_EXPIRED`: Credential has expired

### Settlement
- `SETTLEMENT_FAILED`: Settlement execution failed
- `SETTLEMENT_POLL_TIMEOUT`: Async settlement still pending after max polls
- `BOND_INSUFFICIENT`: Provider bond too low
- `FAILED_PROOF`: Commit-reveal proof verification failed

### Other
- `BUYER_STOPPED`: Buyer stopped streaming early
- `NEGOTIATION_TIMEOUT`: Negotiation took too long

## Next Steps

- See [QUICKSTART.md](./QUICKSTART.md) for end-to-end examples
- See [PROVIDER_GUIDE.md](./PROVIDER_GUIDE.md) for provider setup
- Check [PROTOCOL.md](../PROTOCOL.md) for protocol details
- Explore [examples/](../examples/) for working code



