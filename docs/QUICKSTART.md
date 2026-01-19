# PACT Quickstart

Get PACT running from zero to demo in under 5 minutes.

> **v4 is complete and production-ready!** For the latest features (Policy-as-Code, Passport, Evidence Bundles), see [v4/STATUS.md](./v4/STATUS.md) and run `pnpm demo:v4:canonical`. This guide covers v3 (stable and maintained).

## Clone and install

```bash
git clone https://github.com/seankkoons-gif/pact_.git
cd pact
pnpm install

# Remove any previous transcripts for a clean demo
rm -rf .pact
```

## Run the canonical demo

```bash
pnpm demo:v3:canonical
```

This demo:
- Generates buyer and seller keypairs
- Registers a weather data provider
- Creates receipt history (triggers negotiated regime)
- Negotiates price using `banded_concession` strategy
- Saves a complete transcript to `.pact/transcripts/`
- Uses in-memory settlement (no external dependencies)

**What happened:**
- Buyer declared intent: `weather.data` for NYC with latency/freshness constraints
- Provider returned quote: price negotiated through banded concession rounds
- Agreement reached: both parties agreed on final price
- Settlement coordinated: in-memory balance transfers (boundary mode)
- Transcript saved: complete audit trail of all decisions

**Expected output:**
```
✅ Negotiation Complete!
  Agreed Price: $0.0001
  Transcript: .pact/transcripts/intent-*.json

🎉 Demo Complete!
```

## Switch settlement rails

### Boundary (default)

Works out of the box. In-memory settlement for testing.

```typescript
import { MockSettlementProvider } from "@pact/sdk";

const settlement = new MockSettlementProvider();
settlement.credit(buyerId, 1.0);
settlement.credit(sellerId, 0.1);
```

See [`examples/v3/01-basic-negotiation.ts`](../examples/v3/01-basic-negotiation.ts).

### Stripe (optional)

Install `stripe` package:

```bash
npm install stripe
```

Use `StripeSettlementProvider`:

```typescript
import { StripeSettlementProvider, validateStripeConfig } from "@pact/sdk";

const config = validateStripeConfig({
  mode: "sandbox", // or "live"
  enabled: true,
}).config;

const settlement = new StripeSettlementProvider(config);
```

See [`examples/v3/04-stripe-integration.ts`](../examples/v3/04-stripe-integration.ts).

### Escrow (optional)

Implement your own escrow boundary. PACT provides `intentId` and proofs; you lock/release funds.

```typescript
// 1. PACT negotiates
const result = await acquire({ /* ... */ });
const intentId = result.receipt.intent_id;
const proof = `transcript:${path.basename(result.transcriptPath)}`;

// 2. Lock funds (your escrow implementation)
await escrowContract.lock(intentId, buyerAddress, sellerAddress, amount, proof);

// 3. Release funds (your escrow implementation)
const fulfillmentProof = `receipt:${result.receipt.receipt_id}:fulfilled:${result.receipt.fulfilled}`;
await escrowContract.release(intentId, fulfillmentProof);
```

See [`docs/INTEGRATION_ESCROW.md`](./INTEGRATION_ESCROW.md) and [`pact-escrow-evm/`](../pact-escrow-evm/).

## Replay transcripts

Replay the most recent transcript:

```bash
pnpm replay:last
```

Verify transcript integrity (strict mode skips pending and treats expired credentials as warnings):

```bash
pnpm replay:verify --strict --terminal-only -- .pact/transcripts
```

**Note**: Expired credentials and wallet verification failures are treated as warnings (expected for historical transcripts), not errors.

Transcripts are deterministic: same inputs → same transcript. Use them for debugging, auditing, and training ML models.

## Next steps

- **Provider setup**: See [`docs/PROVIDER_IN_60_MIN.md`](./PROVIDER_IN_60_MIN.md)
- **Pick your path**: See [`docs/v3/PICK_YOUR_PATH.md`](./v3/PICK_YOUR_PATH.md)
- **v3 examples**: Run `pnpm example:v3:01` through `pnpm example:v3:06`
- **Full docs**: See [`docs/v3/GETTING_STARTED.md`](./v3/GETTING_STARTED.md)
