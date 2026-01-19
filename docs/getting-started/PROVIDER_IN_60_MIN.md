# Provider in 60 Minutes

Build a PACT provider from scratch. No databases, minimal dependencies.

> **v4 is complete and production-ready!** This guide covers v4 (recommended). For v3 (stable and maintained), see [versions/v3/GETTING_STARTED.md](../versions/v3/GETTING_STARTED.md).

## Start a provider server

### Option 1: Express template

Copy the Express template:

```bash
cp -r examples/express-provider my-provider
cd my-provider
npm install
npm run dev
```

Server starts on `http://localhost:3000` with a `/pact` endpoint.

### Option 2: create-pact-provider (Recommended)

Generate a new provider project with interactive prompts:

```bash
# Using pnpm
pnpm create:pact-provider my-provider

# Or using npx
npx create-pact-provider my-provider

# Or using npm
npm create pact-provider my-provider
```

The scaffolder will prompt for:
1. **Project name** (or pass as argument)
2. **Template**: `express` | `worker` | `nextjs`
3. **Settlement mode**: `boundary` (default) | `stripe` | `escrow`
4. **KYA requirement**: `none` (default) | `basic` | `zk`

After generation:
```bash
cd my-provider
pnpm install  # or npm install
pnpm run dev
```

Both options generate:
- HTTP server with `/pact` endpoint
- Health check endpoint (`/health`)
- Pact protocol handler (uses `@pact/sdk`)
- Settlement adapter stub
- KYA verification stub

## Implement quote logic

Edit the quote handler (in `pactHandler.ts` or `handler.ts`):

```typescript
function calculateQuotePrice(intent: IntentMessage, constraints: any): number {
  // Your pricing logic here
  const basePrice = 0.0001;
  const latencyMultiplier = constraints.latency_ms < 50 ? 1.2 : 1.0;
  const price = basePrice * latencyMultiplier;
  return Math.min(price, intent.max_price); // Never exceed buyer's max
}

// Use in handler
const quote = {
  price: calculateQuotePrice(intent, constraints),
  unit: "request",
  latency_ms: 25,
  valid_for_ms: 20000,
  bond_required: calculateQuotePrice(intent, constraints) * 2,
};
```

## Add KYA requirement

Configure KYA in policy (`policy.ts` or handler config):

```typescript
import { createDefaultPolicy } from "@pact/sdk";

const policy = createDefaultPolicy();

// Require specific credentials
policy.counterparty.required_credentials = ["sla_verified", "kyc_verified"];

// Or trust specific issuers
policy.counterparty.trusted_issuers = [
  "issuer-pubkey-1",
  "issuer-pubkey-2",
];
```

Provider credentials are checked automatically when buyer calls `acquire()`.

## Add settlement

### Boundary (default)

Works out of the box for testing:

```typescript
import { MockSettlementProvider } from "@pact/sdk";

const settlement = new MockSettlementProvider();
// No additional setup needed
```

### Stripe

Install dependency:

```bash
npm install stripe
```

Configure settlement:

```typescript
import { StripeSettlementProvider, validateStripeConfig } from "@pact/sdk";

const config = validateStripeConfig({
  mode: "sandbox", // or "live"
  enabled: true,
}).config;

const settlement = new StripeSettlementProvider(config);

// In production, set PACT_STRIPE_API_KEY environment variable
```

Use in handler settlement hooks:

```typescript
async function prepareSettlement(agreement: AgreementMessage) {
  // Settlement is handled by PACT SDK
  // This hook is for provider-side logging/notification
  console.log(`Settlement prepared for intent ${agreement.intent_id}`);
}

async function commitSettlement(receipt: ReceiptMessage) {
  // Settlement committed by PACT SDK
  // This hook is for provider-side fulfillment
  console.log(`Settlement committed for receipt ${receipt.receipt_id}`);
}
```

See [`examples/v3/04-stripe-integration.ts`](../examples/v3/04-stripe-integration.ts) for full example.

## Test locally

### Using canonical buyer agent

Run the v3 quickstart demo (acts as buyer):

```bash
# In repo root
pnpm demo:v3:canonical
```

This will negotiate with your provider if registered in the directory.

### Using curl/Postman

Send INTENT message to your provider:

```bash
curl -X POST http://localhost:3000/pact \
  -H "Content-Type: application/json" \
  -d '{
    "envelope_version": "pact-envelope/1.0",
    "message": {
      "protocol_version": "pact/1.0",
      "type": "INTENT",
      "intent_id": "intent-test-1",
      "intent": "weather.data",
      "scope": "NYC",
      "constraints": { "latency_ms": 50, "freshness_sec": 10 },
      "max_price": 0.0002,
      "settlement_mode": "hash_reveal",
      "sent_at_ms": 1000,
      "expires_at_ms": 10000
    },
    "message_hash_hex": "...",
    "signer_public_key_b58": "...",
    "signature_b58": "...",
    "signed_at_ms": 1000
  }'
```

Provider responds with ASK message (signed quote).

### Register in directory

Add provider to `providers.jsonl`:

```bash
pnpm provider:register -- \
  --intent weather.data \
  --pubkey <your-provider-pubkey> \
  --endpoint http://localhost:3000 \
  --credentials sla_verified \
  --region us-east \
  --baselineLatencyMs 50
```

## Minimal example structure

```
my-provider/
├── src/
│   ├── index.ts       # HTTP server (Express/Fastify/etc)
│   ├── handler.ts     # Pact protocol handler (uses @pact/sdk)
│   ├── policy.ts      # Negotiation policy (optional)
│   └── settlement.ts  # Settlement adapter (optional, defaults to boundary)
├── package.json
└── tsconfig.json
```

**Key separation:**
- Provider logic (HTTP, routing) → `index.ts`
- Pact protocol logic (parsing, signing, validation) → `handler.ts` (uses SDK)
- Pricing/negotiation logic → `handler.ts` (your code)
- Settlement execution → `settlement.ts` or SDK default

## Real-World Examples

**Recommended starting points** (copy/pasteable, full implementations):

- **[Weather Provider](../examples/providers/weather-provider/)** — Complete `weather.data` provider with deterministic pricing, surcharges, and fast_small_purchase policy. Run `pnpm example:provider:weather` from repo root.

- **[LLM Verifier Provider](../examples/providers/llm-verifier-provider/)** — Complete `llm.verify` provider with KYA variants, method-based pricing, and statement length surcharges. Run `pnpm example:provider:llm` from repo root.

Both examples include:
- Deterministic pricing models
- Transcript generation
- Settlement adapters (boundary default, Stripe optional)
- Buyer demo scripts (`pnpm example:buyer:weather`, `pnpm example:buyer:llm`)
- Smoke tests
- Complete README with curl examples

## Next steps

- **Real-world examples**: [`examples/providers/weather-provider/`](../examples/providers/weather-provider/), [`examples/providers/llm-verifier-provider/`](../examples/providers/llm-verifier-provider/)
- **Express template**: [`examples/express-provider/`](../examples/express-provider/)
- **Provider adapter docs**: [`packages/provider-adapter/README.md`](../packages/provider-adapter/README.md)
- **Protocol spec**: [`specs/pact/1.0/negotiation-grammar.md`](../specs/pact/1.0/negotiation-grammar.md)
