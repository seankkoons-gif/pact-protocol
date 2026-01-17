# Cloudflare Worker Pact Provider

Stateless Pact provider template for Cloudflare Workers demonstrating how to expose a Pact-compatible service at the edge.

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Stateless vs Stateful Design

### Stateless Provider (This Template)

**Characteristics:**
- Each request is independent - no in-memory state between requests
- No negotiation state stored in worker memory
- Each message must be self-contained or state stored externally
- Scales horizontally across multiple worker instances
- Faster cold starts (no state initialization)

**When to Use:**
- Edge deployment (Cloudflare Workers, Vercel Edge)
- High scalability requirements
- Simple negotiation flows (INTENT → ASK is naturally stateless)
- Stateless protocols or single-round negotiations

**Limitations:**
- Multi-round negotiations require external state storage (KV, Durable Objects, DB)
- More complex negotiation flows need coordination between requests

### Stateful Provider (Traditional)

**Characteristics:**
- Maintains in-memory state across requests (e.g., Map of negotiations)
- Worker remembers previous requests in the same execution context
- Easier to implement multi-round negotiations
- No external storage needed for simple flows

**When to Use:**
- Long-running processes (Node.js server, containers)
- Complex multi-round negotiations
- When state coordination is critical
- Lower request volume (fewer instances needed)

**Limitations:**
- Doesn't scale horizontally (state isolated per instance)
- State lost on instance restart
- Requires sticky sessions or state synchronization

## Settlement Delegation

This provider is **stateless** and doesn't custody funds. Settlement is delegated to external systems:

### 1. On-Chain Escrow
```typescript
// Delegate to smart contract via RPC
const tx = await ethereumRpc.sendTransaction({
  to: ESCROW_CONTRACT_ADDRESS,
  data: encodeLockFunction(intentId, amount, proof)
});
```

### 2. Payment Processor
```typescript
// Delegate to Stripe/PayPal
const payment = await stripe.paymentIntents.create({
  amount: amount * 100, // Convert to cents
  metadata: { intentId, bondAmount }
});
```

### 3. Settlement Service
```typescript
// Delegate to separate microservice
const response = await fetch(SETTLEMENT_SERVICE_URL, {
  method: "POST",
  body: JSON.stringify({ intentId, amount, settlementMode })
});
```

**Why Delegate?**
- Workers are lightweight - not designed for fund custody
- Settlement requires persistent state (transaction IDs, locks)
- Separation of concerns: Protocol vs Execution
- Compliance: Settlement systems handle regulatory requirements

## Request/Response Flow

### 1. INTENT → ASK (Stateless)

**Request:**
```http
POST https://your-worker.workers.dev/pact
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

**Response:**
```json
{
  "message": {
    "type": "ASK",
    "intent_id": "intent-123",
    "price": 0.00008,
    ...
  }
}
```

### 2. ACCEPT → Settlement Delegation

**Request:**
```json
{
  "message": {
    "type": "ACCEPT",
    "intent_id": "intent-123",
    "agreed_price": 0.00008,
    ...
  }
}
```

**Response:** Echoed ACCEPT after delegating to settlement service.

### 3. REJECT → Acknowledgment

**Request:**
```json
{
  "message": {
    "type": "REJECT",
    "intent_id": "intent-123",
    "reason": "..."
  }
}
```

**Response:** Echoed REJECT acknowledgment.

## Configuration

### Cloudflare KV (Optional - for state storage)

Uncomment in `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "NEGOTIATIONS"
id = "your-kv-namespace-id"
```

Create namespace:
```bash
wrangler kv:namespace create NEGOTIATIONS
```

### Worker Secrets (Optional - for provider keypair)

Set secret:
```bash
wrangler secret put PROVIDER_SECRET
```

Access in code:
```typescript
const secret = env.PROVIDER_SECRET;
```

## Transcripts

Transcripts are logged to Cloudflare Workers console. In production, also send to:

- **Cloudflare Analytics** - Built-in analytics
- **KV Store** - Persistent audit trail
- **External Logging** - Datadog, LogDNA, etc.

```typescript
// Example: Store transcript in KV
await env.NEGOTIATIONS.put(`transcript:${intentId}`, JSON.stringify(transcript));
```

## Architecture

```
Request Flow:
  Client → Cloudflare Edge → Worker (stateless)
                      ↓
              handlePactRequest()
                      ↓
         Route: INTENT/ACCEPT/REJECT
                      ↓
              Calculate/Sign (no state)
                      ↓
              Delegate Settlement (external)
                      ↓
                   Response
```

## Key Differences from Express Provider

| Feature | Express (Stateful) | Cloudflare Worker (Stateless) |
|---------|-------------------|-------------------------------|
| Runtime | Node.js | Web Standards (V8) |
| State | In-memory Map | External (KV/DB) or none |
| APIs | Node APIs (`process`, `fs`) | Web Standards only |
| Scale | Vertical (single instance) | Horizontal (many instances) |
| Cold Start | Slow (Node init) | Fast (V8 isolate) |
| Settlement | Can handle directly | Must delegate externally |

## Production Considerations

1. **State Storage**: Use KV, Durable Objects, or external DB for multi-round negotiations
2. **Settlement Service**: Implement dedicated settlement service (not in worker)
3. **Keypair Management**: Store provider keypair in Worker Secrets or KV
4. **Monitoring**: Use Cloudflare Analytics + external logging
5. **Rate Limiting**: Configure Cloudflare rate limiting rules

## Documentation

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Pact SDK Docs](../../../packages/sdk/README.md)
- [Pact Protocol Spec](../../../specs/pact/1.0/negotiation-grammar.md)
