# PACT Quickstart

Get PACT running from zero to demo in under 5 minutes.

> **v4 is complete and production-ready!** This guide covers v4 (recommended). For v3 (stable and maintained), see [versions/v3/GETTING_STARTED.md](../versions/v3/GETTING_STARTED.md).

## Clone and install

```bash
git clone https://github.com/seankkoons-gif/pact_.git
cd pact
pnpm install

# Remove any previous transcripts for a clean demo
rm -rf .pact
```

## Run the canonical demo (v4)

```bash
pnpm demo:v4:canonical
```

This demo demonstrates:
- Pact Boundary Runtime (non-bypassable policy enforcement)
- Policy-as-Code v4 (deterministic evaluation)
- v4 Transcript (hash-linked, cryptographically verifiable)
- Evidence embedded (policy hash, evaluation traces)

**What happened:**
- Buyer declared intent: `weather.data` for NYC
- Policy enforced: max_price constraint evaluated before settlement
- Negotiation rounds: INTENT → ASK → ACCEPT (all signed and hash-linked)
- Agreement reached: both parties agreed on final price ($0.04, within policy)
- Transcript saved: complete v4 audit trail with Proof of Negotiation (PoN)

**Expected output:**
```
✅ Negotiation Complete!
  Agreed Price: $0.04
  Policy Hash: 356a1323ec60b2d9...
  Transcript ID: transcript-...
  Rounds: 3
  Integrity: VALID

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

See [`docs/integrations/INTEGRATION_ESCROW.md`](../integrations/INTEGRATION_ESCROW.md) and [`pact-escrow-evm/`](../../pact-escrow-evm/).

## Replay transcripts

Replay the most recent transcript:

```bash
pnpm replay:last
```

Verify transcript integrity (strict mode skips pending and treats expired credentials as warnings):

```bash
pnpm replay:verify --strict --terminal-only -- .pact/transcripts

To skip historical transcripts (v1/v2 or older than threshold) and avoid expired credential warnings:

```bash
pnpm replay:verify:recent
# or
pnpm replay:verify --no-historical -- .pact/transcripts
# Custom threshold (default: 30 days)
pnpm replay:verify --no-historical --historical-days 7 -- .pact/transcripts
```
```

**Note**: Expired credentials and wallet verification failures are treated as warnings (expected for historical transcripts), not errors.

Transcripts are deterministic: same inputs → same transcript. Use them for debugging, auditing, and training ML models.

## Next steps

- **v4 features**: See [`docs/versions/v4/STATUS.md`](../versions/v4/STATUS.md) for complete feature list
- **Use cases**: See [`docs/versions/v4/USE_CASES.md`](../versions/v4/USE_CASES.md) for what you can build
- **Provider setup**: See [`docs/PROVIDER_IN_60_MIN.md`](./PROVIDER_IN_60_MIN.md)
- **v3 examples**: Run `pnpm example:v3:01` through `pnpm example:v3:06` (v3 stable and maintained)
- **Full docs**: See [`docs/versions/v3/GETTING_STARTED.md`](../versions/v3/GETTING_STARTED.md) for v3 documentation
