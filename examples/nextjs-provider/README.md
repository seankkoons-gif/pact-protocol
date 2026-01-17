# Next.js App Router - Pact Provider

Backend-only Next.js App Router route handler for Pact negotiation requests.

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# API endpoint: http://localhost:3000/api/pact
```

## File Structure

```
app/
  api/
    pact/
      route.ts    # Pact API route handler
```

## API Endpoint

**POST `/api/pact`**

Handles Pact negotiation requests:
- `INTENT` → Generates `ASK` quote
- `ACCEPT` → Prepares settlement
- `REJECT` → Acknowledges rejection

## Deploy to Vercel

### 1. Deploy Command

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### 2. Environment Variables (Vercel Dashboard)

Set in Vercel project settings:

```
PACT_PROVIDER_SECRET=          # Optional: Provider keypair secret
PACT_SETTLEMENT_WEBHOOK_URL=   # Optional: Settlement service webhook
STRIPE_SECRET_KEY=             # Optional: If using Stripe
ETH_RPC_URL=                   # Optional: If using on-chain escrow
```

### 3. Vercel Features

- ✅ **Serverless Functions**: Automatic serverless execution
- ✅ **Auto-scaling**: Handles traffic spikes automatically
- ✅ **HTTPS**: Zero-config SSL certificates
- ✅ **Edge Network**: Global CDN distribution
- ✅ **Zero Config**: Next.js optimized out of the box

## Settlement Integration

### Stripe Integration

1. **Install dependencies:**
   ```bash
   npm install stripe @pact/sdk
   ```

2. **Set environment variable:**
   ```
   STRIPE_SECRET_KEY=sk_live_...
   ```

3. **Update `delegateSettlement()` in `route.ts`:**
   ```typescript
   import Stripe from "stripe";
   import { StripeSettlementProvider, validateStripeConfig } from "@pact/sdk";

   const stripeConfig = validateStripeConfig({
     mode: "live",
     enabled: true,
   });

   const settlement = new StripeSettlementProvider(stripeConfig.config);
   const handle = await settlement.prepare({
     intent_id: params.intentId,
     buyer_id: "...",
     seller_id: "...",
     amount: params.amount,
   });

   return handle.handle_id;
   ```

### On-Chain Escrow Integration

1. **Install dependencies:**
   ```bash
   npm install ethers
   ```

2. **Set environment variables:**
   ```
   ETH_RPC_URL=https://mainnet.infura.io/v3/...
   PRIVATE_KEY=0x...
   ESCROW_CONTRACT_ADDRESS=0x...
   ```

3. **Update `delegateSettlement()` in `route.ts`:**
   ```typescript
   import { ethers } from "ethers";
   // Import contract ABI from pact-escrow-evm package

   const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
   const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
   const escrow = new ethers.Contract(
     process.env.ESCROW_CONTRACT_ADDRESS!,
     PactEscrowABI,
     wallet
   );

   const tx = await escrow.lock(
     params.intentId,
     buyerAddress,
     sellerAddress,
     ethers.parseEther(params.amount.toString()),
     "ETH",
     proofBytes
   );

   return tx.hash; // Transaction hash as handle ID
   ```

### Custom Settlement Webhook

1. **Set environment variable:**
   ```
   PACT_SETTLEMENT_WEBHOOK_URL=https://settlement.example.com/webhook
   ```

2. **Update `delegateSettlement()` in `route.ts`:**
   ```typescript
   const response = await fetch(process.env.PACT_SETTLEMENT_WEBHOOK_URL!, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       intentId: params.intentId,
       amount: params.amount,
       bondAmount: params.bondAmount,
       settlementMode: params.settlementMode,
     }),
   });

   if (!response.ok) {
     throw new Error(`Settlement webhook failed: ${response.statusText}`);
   }

   const { handleId } = await response.json();
   return handleId;
   ```

## Policy-Based Pricing

The route handler demonstrates **policy-based pricing** (not hardcoded):

- **Intent type**: Different base prices per intent
- **Constraints**: Price adjustments for latency/freshness
- **Urgency**: Premium for urgent requests
- **Policy rules**: Applies policy constraints

**Example:**
```typescript
// Base price for weather.data: 0.00008
// +20% for low latency (< 50ms)
// +10% for fresh data (< 10s)
// +15% for urgent requests
// = Final price: 0.00008 * 1.2 * 1.1 * 1.15 = 0.000121
```

## Transcripts

Transcripts are logged to console (visible in Vercel logs).

**In production, also:**
- Store in database (PostgreSQL, MongoDB)
- Send to analytics (Vercel Analytics, PostHog)
- Write to audit log service

## Request/Response Example

### INTENT Request

```http
POST /api/pact
Content-Type: application/json

{
  "envelope_version": "pact-envelope/1.0",
  "message": {
    "protocol_version": "pact/1.0",
    "type": "INTENT",
    "intent_id": "intent-123",
    "intent": "weather.data",
    "max_price": 0.0002,
    "constraints": { "latency_ms": 50, "freshness_sec": 10 },
    ...
  },
  ...
}
```

### ASK Response

```json
{
  "message": {
    "type": "ASK",
    "intent_id": "intent-123",
    "price": 0.000121,
    ...
  }
}
```

## Architecture

```
Request Flow:
  Client → Next.js API Route → handlePactRequest()
                              ↓
                    Route by message type
                              ↓
          INTENT → calculatePolicyBasedPrice() → ASK
          ACCEPT → delegateSettlement() → ACCEPT
          REJECT → REJECT
```

## Notes

- **Backend-only**: No frontend UI included
- **Serverless**: Each request is independent
- **Stateless**: No in-memory state (use database for persistence)
- **Scalable**: Vercel handles automatic scaling

## Documentation

- [Next.js App Router Docs](https://nextjs.org/docs/app)
- [Vercel Deployment](https://vercel.com/docs)
- [Pact SDK Docs](../../../packages/sdk/README.md)
