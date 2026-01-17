# Scaffolding

The `create-pact-provider` tool generates production-ready Pact provider projects from templates.

## Quick Start

```bash
# Using pnpm (recommended)
pnpm create:pact-provider my-provider

# Or using npx
npx create-pact-provider my-provider

# Or using npm
npm create pact-provider my-provider
```

Interactive prompts guide you through:
- **Project name**
- **Template** (express, worker, nextjs)
- **Settlement mode** (boundary, stripe, escrow)
- **KYA requirement** (none, basic, zk)

## Templates

### Express

Minimal Express.js server with `/pact` endpoint.

**Best for:**
- Traditional Node.js servers
- Docker deployments
- Full control over HTTP stack

**Generated structure:**
```
my-provider/
├── src/
│   ├── server.ts         # Express HTTP server
│   ├── pactHandler.ts    # Pact protocol handler
│   ├── policy.ts         # Negotiation policy
│   ├── settlement.ts     # Settlement adapter
│   └── kya.ts            # KYA verification
├── package.json
└── tsconfig.json
```

**Start:**
```bash
pnpm run dev
# Server starts on http://localhost:3000
```

### Cloudflare Worker

Stateless Cloudflare Worker with `/pact` endpoint.

**Best for:**
- Edge deployments
- Serverless architecture
- Global distribution

**Generated structure:**
```
my-provider/
├── src/
│   ├── worker.ts         # Cloudflare Worker entrypoint
│   ├── pactHandler.ts    # Pact protocol handler
│   ├── policy.ts         # Negotiation policy
│   ├── settlement.ts     # Settlement adapter
│   └── kya.ts            # KYA verification
├── wrangler.toml         # Cloudflare Worker config
├── package.json
└── tsconfig.json
```

**Start:**
```bash
pnpm run dev
# Worker starts on http://localhost:8787
```

**Deploy:**
```bash
pnpm run deploy
```

### Next.js

Next.js App Router with `/api/pact` route.

**Best for:**
- Vercel deployments
- React/Next.js ecosystems
- API routes with serverless functions

**Generated structure:**
```
my-provider/
├── app/
│   └── api/
│       └── pact/
│           └── route.ts  # Next.js API route
├── src/
│   ├── pactHandler.ts    # Pact protocol handler
│   ├── policy.ts         # Negotiation policy
│   ├── settlement.ts     # Settlement adapter
│   └── kya.ts            # KYA verification
├── next.config.js
├── package.json
└── tsconfig.json
```

**Start:**
```bash
pnpm run dev
# Server starts on http://localhost:3000
```

**Deploy:**
```bash
pnpm run build
pnpm run start
# Or deploy to Vercel
```

## Settlement Modes

### Boundary (Default)

Settlement is handled externally or by the SDK. No additional dependencies.

**Use when:**
- Testing and development
- Settlement is handled by external service
- SDK handles settlement internally

**Generated code:**
```typescript
// src/settlement.ts
export async function prepareSettlement(params) {
  // Boundary mode: Settlement handled externally or by SDK
  console.log(`[Settlement] Boundary mode: ${params.intentId}`);
  return `boundary-${params.intentId}-${Date.now()}`;
}
```

### Stripe

Real Stripe payment integration. Requires `stripe` package.

**Use when:**
- Production payment processing
- Credit card payments
- Subscription-based services

**Setup:**
```bash
pnpm add stripe
```

**Configure:**
```typescript
// src/settlement.ts
import { StripeSettlementProvider, validateStripeConfig } from "@pact/sdk";

const config = validateStripeConfig({
  mode: process.env.PACT_STRIPE_MODE === "live" ? "live" : "sandbox",
  enabled: true,
});
```

**Environment variables:**
```bash
PACT_STRIPE_API_KEY=sk_live_...
PACT_STRIPE_MODE=live  # or sandbox
```

### Escrow

On-chain escrow integration. Requires `ethers` package.

**Use when:**
- Blockchain-based settlement
- Smart contract escrow
- Decentralized payments

**Setup:**
```bash
pnpm add ethers
```

**Configure:**
```typescript
// src/settlement.ts
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
// ... escrow contract integration
```

**Environment variables:**
```bash
ETH_RPC_URL=https://mainnet.infura.io/...
PRIVATE_KEY=0x...
```

## KYA Modes

### None (Default)

No KYA verification. All agents are accepted.

**Use when:**
- Testing and development
- Open marketplace
- Trust is handled externally

### Basic

Credential-based verification without ZK proofs.

**Use when:**
- Simple credential checks
- Issuer-based trust
- No privacy requirements

**Generated code:**
```typescript
// src/kya.ts
export async function verifyKya(params) {
  // Check credentials against issuer registry
  if (params.credentials && params.credentials.length > 0) {
    return { ok: true, tier: "verified" };
  }
  return { ok: true, tier: "unknown" };
}
```

### ZK (Boundary Only)

Zero-knowledge proof verification. Requires `snarkjs` package.

**Note:** ZK-KYA only works with boundary settlement mode.

**Use when:**
- Privacy-preserving verification
- Zero-knowledge proofs
- Trust tier verification

**Setup:**
```bash
pnpm add snarkjs
```

**Configure:**
```typescript
// src/kya.ts
import { DefaultZkKyaVerifier } from "@pact/sdk";

const zkKyaVerifier = new DefaultZkKyaVerifier();

export async function verifyKya(params) {
  if (!params.zkProof) {
    return { ok: false, reason: "ZK-KYA proof required" };
  }
  // Use verifier.verify() when SDK API is available
  return { ok: true, tier: "trusted" };
}
```

## Transcripts

All templates emit transcripts to `.pact/transcripts/` directory (except Cloudflare Workers, which log to console).

**Transcript format:**
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "provider_id": "provider_public_key...",
  "message_type": "INTENT",
  "intent_id": "intent-123",
  "price": 0.0001
}
```

**Transcript path:**
Transcripts are printed to console:
```
📄 Transcript: .pact/transcripts/intent-123-1234567890.json
```

## Testing

### Smoke Test

Test all templates locally:

```bash
pnpm scaffold:smoke
```

This creates each template in `.tmp/`, installs dependencies, runs a test request, and verifies transcript creation.

### Manual Testing

**Express/Next.js:**
```bash
curl -X POST http://localhost:3000/pact \
  -H "Content-Type: application/json" \
  -d '{
    "envelope_version": "pact-envelope/1.0",
    "message": {
      "protocol_version": "pact/1.0",
      "type": "INTENT",
      "intent_id": "test-intent-1",
      "intent": "weather.data",
      "scope": "NYC",
      "constraints": { "latency_ms": 50, "freshness_sec": 10 },
      "max_price": 0.0002,
      "settlement_mode": "hash_reveal",
      "sent_at_ms": 1000,
      "expires_at_ms": 10000
    },
    "message_hash_hex": "test",
    "signer_public_key_b58": "test",
    "signature_b58": "test",
    "signed_at_ms": 1000
  }'
```

**Cloudflare Worker:**
```bash
curl -X POST http://localhost:8787/pact \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

**Expected output:**
- Signed ASK message (JSON response)
- Transcript file in `.pact/transcripts/` (or console log for Workers)
- Console message: `📄 Transcript: .pact/transcripts/intent-...-...json`

## Customization

### Update Pricing Logic

Edit `src/pactHandler.ts`:

```typescript
function calculateQuotePrice(intent: IntentMessage): number {
  // Your pricing logic here
  const basePrice = 0.00008; // Default price
  let price = basePrice;

  // Adjust for constraints
  if (intent.constraints.latency_ms < 50) {
    price *= 1.2; // 20% premium for low latency
  }

  return Math.min(price, intent.max_price);
}
```

### Update Policy

Edit `src/policy.ts`:

```typescript
import { createDefaultPolicy } from "@pact/sdk";

export const defaultPolicy = createDefaultPolicy();

// Customize negotiation constraints
defaultPolicy.negotiation.max_rounds = 5;
defaultPolicy.counterparty.min_reputation = 0.5;
defaultPolicy.settlement.allowed_modes = ["hash_reveal", "streaming"];
```

### Update Settlement

Edit `src/settlement.ts` based on your settlement mode.

### Update KYA

Edit `src/kya.ts` based on your KYA requirements.

## Project Structure

All templates follow the same structure:

```
my-provider/
├── src/                    # Source code (or app/ for Next.js)
│   ├── pactHandler.ts     # Pact protocol handler (uses @pact/sdk)
│   ├── policy.ts          # Negotiation policy
│   ├── settlement.ts      # Settlement adapter
│   └── kya.ts             # KYA verification
├── .pact/
│   └── transcripts/       # Transcript storage (auto-created)
├── package.json
└── tsconfig.json
```

**Key separation:**
- **Provider logic** (HTTP, routing) → `server.ts` / `worker.ts` / `route.ts`
- **Pact protocol logic** (parsing, signing, validation) → `pactHandler.ts` (uses SDK)
- **Pricing/negotiation logic** → `pactHandler.ts` (your code)
- **Settlement execution** → `settlement.ts` (your integration)
- **KYA verification** → `kya.ts` (your integration)

## Next Steps

- **Provider Guide**: [`PROVIDER_IN_60_MIN.md`](./PROVIDER_IN_60_MIN.md)
- **Protocol Spec**: [`../specs/pact/1.0/negotiation-grammar.md`](../specs/pact/1.0/negotiation-grammar.md)
- **SDK Documentation**: [`../packages/sdk/README.md`](../packages/sdk/README.md)

## Troubleshooting

### CLI not found

```bash
# Build the CLI first
pnpm -C packages/create-pact-provider build

# Then run
pnpm create:pact-provider my-provider
```

### Template fails to start

Check that dependencies are installed:
```bash
cd my-provider
pnpm install
```

### Transcript not created

- **Express/Next.js**: Check that `.pact/transcripts/` directory exists and is writable
- **Worker**: Transcripts are logged to console (no file system access)

### Settlement not working

- **Stripe**: Ensure `stripe` package is installed and `PACT_STRIPE_API_KEY` is set
- **Escrow**: Ensure `ethers` package is installed and `ETH_RPC_URL` is set
- **Boundary**: Works out of the box (no additional setup)