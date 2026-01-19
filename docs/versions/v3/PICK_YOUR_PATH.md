# Pact v3: Pick Your Path

Three ways to use Pact. Choose based on what you need.

---

## 1. Negotiate Only (No Money)

Use Pact as a deterministic negotiation protocol without settlement.

**When:** You need structured negotiation semantics, but settlement happens elsewhere.

```typescript
import { acquire, createDefaultPolicy, MockSettlementProvider } from "@pact/sdk";

const result = await acquire({
  input: {
    intentType: "weather.data",
    scope: "NYC",
    constraints: { latency_ms: 50, freshness_sec: 10 },
    maxPrice: 0.0002,
  },
  buyerKeyPair,
  sellerKeyPair,
  policy: createDefaultPolicy(),
  settlement: new MockSettlementProvider(),
  directory: myProviderDirectory,
});
```

**Full example:** [`examples/v3/01-basic-negotiation.ts`](../../examples/v3/01-basic-negotiation.ts)

---

## 2. Negotiate + Settle (Stripe / Escrow)

Use Pact with real settlement backends.

**When:** You need negotiation plus fund custody.

```typescript
import { acquire, StripeSettlementProvider, validateStripeConfig } from "@pact/sdk";

const settlement = new StripeSettlementProvider(
  validateStripeConfig({ mode: "sandbox", enabled: true }).config
);

const result = await acquire({
  input: { intentType: "data.query", maxPrice: 0.0001 },
  buyerKeyPair,
  sellerKeyPair,
  policy: createDefaultPolicy(),
  settlement,
  directory: myProviderDirectory,
});
```

**Full examples:**
- Stripe: [`examples/v3/04-stripe-integration.ts`](../../examples/v3/04-stripe-integration.ts)
- Escrow: [`docs/integrations/INTEGRATION_ESCROW.md`](../integrations/INTEGRATION_ESCROW.md)

---

## 3. Multi-Provider Marketplace

Use Pact to negotiate with multiple providers and select the best.

**When:** You need provider selection, comparison, and competitive negotiation.

```typescript
import { acquire, InMemoryProviderDirectory } from "@pact/sdk";

const directory = new InMemoryProviderDirectory();
directory.registerProvider({ provider_id: "provider-1", ... });
directory.registerProvider({ provider_id: "provider-2", ... });

const result = await acquire({
  input: {
    intentType: "weather.data",
    constraints: { latency_ms: 50, freshness_sec: 10 },
    maxPrice: 0.0002,
  },
  buyerKeyPair,
  sellerKeyPair,
  directory,
  negotiation: { strategy: "banded_concession" },
});
```

**Full example:** [`examples/v3/06-weather-api-agent.ts`](../../examples/v3/06-weather-api-agent.ts)

---

## What's the Same

All three paths use the same core:
- Deterministic negotiation protocol
- Transcript generation for audit/replay
- Policy-based decision making
- Cryptographic signatures

## What's Different

| Feature | Negotiate Only | Negotiate + Settle | Multi-Provider |
|---------|---------------|-------------------|----------------|
| Settlement | Mock (no money) | Stripe / Escrow | Optional |
| Provider Selection | Single | Single | Multiple |
| Negotiation Strategy | Basic | Basic | Competitive |
| Transcript | ✅ Yes | ✅ Yes | ✅ Yes |

## Next Steps

1. **Try it:** `pnpm example:v3:01` (negotiate only)
2. **Add settlement:** Install `stripe` → `pnpm example:v3:04`
3. **Build marketplace:** See [`examples/v3/06-weather-api-agent.ts`](../../examples/v3/06-weather-api-agent.ts)
