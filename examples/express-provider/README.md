# Express Provider Template

Minimal Express-based Pact provider demonstrating how easy it is to expose a Pact-compatible service using `@pact/sdk`.

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm run dev

# Server starts on http://localhost:3000
```

## Request/Response Flow

### 1. INTENT → ASK

**Request:**
```http
POST /pact
Content-Type: application/json

{
  "envelope_version": "pact-envelope/1.0",
  "message": {
    "protocol_version": "pact/1.0",
    "type": "INTENT",
    "intent_id": "intent-123",
    "intent": "weather.data",
    "scope": "NYC",
    "constraints": {
      "latency_ms": 50,
      "freshness_sec": 10
    },
    "max_price": 0.0002,
    "settlement_mode": "hash_reveal",
    "sent_at_ms": 1000,
    "expires_at_ms": 10000
  },
  "message_hash_hex": "...",
  "signer_public_key_b58": "...",
  "signature_b58": "...",
  "signed_at_ms": 1000
}
```

**Response:**
```json
{
  "envelope_version": "pact-envelope/1.0",
  "message": {
    "protocol_version": "pact/1.0",
    "type": "ASK",
    "intent_id": "intent-123",
    "price": 0.00008,
    "unit": "request",
    "latency_ms": 50,
    "valid_for_ms": 20000,
    "bond_required": 0.00016,
    "sent_at_ms": 2000,
    "expires_at_ms": 22000
  },
  "message_hash_hex": "...",
  "signer_public_key_b58": "...",
  "signature_b58": "...",
  "signed_at_ms": 2000
}
```

### 2. BID → ASK (counter-offer)

**Request:**
```json
{
  "message": {
    "type": "BID",
    "intent_id": "intent-123",
    "price": 0.00006,
    ...
  }
}
```

**Response:** New ASK with adjusted price, or ACCEPT if bid is acceptable.

### 3. ACCEPT → AGREEMENT

**Request:**
```json
{
  "message": {
    "type": "ACCEPT",
    "intent_id": "intent-123",
    "price": 0.00008,
    ...
  }
}
```

**Response:**
```json
{
  "message": {
    "type": "AGREEMENT",
    "intent_id": "intent-123",
    "agreement_id": "agreement-intent-123",
    "price": 0.00008,
    "bond": 0.00016,
    ...
  }
}
```

**Settlement Hook:** `prepareSettlement()` is called, demonstrating settlement integration point.

## Key Components

### `server.ts`
- Express HTTP server
- Single `/pact` POST endpoint
- Health check endpoint
- Error handling

### `pactHandler.ts`
- Uses `@pact/sdk` for protocol handling:
  - `parseEnvelope()` - Parse and validate incoming messages
  - `signEnvelope()` - Sign outgoing messages
  - `DefaultPolicyGuard` - Policy validation
  - `createDefaultPolicy()` - Default negotiation policy

**Demonstrates:**
- ✅ Quote generation (ASK messages) - calculates price based on intent/constraints
- ✅ Accept/reject logic - negotiates based on bid acceptance criteria
- ✅ Settlement prepare/commit hooks - integration points for settlement backends
- ✅ Transcript emission - logs all messages to console

## Architecture

```
Request Flow:
  Client → POST /pact → handlePactRequest() → Route by message type
  
  INTENT → handleIntent()
    ├─ Policy validation (SDK)
    ├─ Calculate quote (Provider logic)
    └─ Sign ASK response (SDK)
  
  BID → handleBid()
    ├─ Negotiation strategy (Provider logic)
    └─ Sign ASK/ACCEPT response (SDK)
  
  ACCEPT → handleAccept()
    ├─ prepareSettlement() hook (Provider integration)
    └─ Sign AGREEMENT response (SDK)

Transcripts:
  All messages → emitTranscript() → Console output
```

## Separation of Concerns

**Pact Logic (SDK):**
- Envelope parsing/validation
- Message signing
- Policy enforcement
- Protocol compliance

**Provider Logic (Your Code):**
- Pricing calculations
- Negotiation strategies
- Settlement integration
- Business rules

## Customization

1. **Update pricing logic** in `calculateQuotePrice()`:
   ```typescript
   // Add your pricing model
   const basePrice = getPriceFromDatabase(intent.intent);
   const price = applyDynamicPricing(basePrice, constraints);
   ```

2. **Implement settlement hooks** in `prepareSettlement()` / `commitSettlement()`:
   ```typescript
   // Call your settlement backend
   await escrowContract.lock({ intentId, amount });
   await paymentProcessor.hold({ amount, currency });
   ```

3. **Customize negotiation strategy** in `handleBid()`:
   ```typescript
   // Add ML-based pricing, reputation checks, etc.
   if (bidderReputation > threshold) {
     return acceptWithDiscount(bid);
   }
   ```

## What's NOT Included

- ❌ Negotiation engine internals (handled by SDK)
- ❌ Hardcoded prices (calculated dynamically)
- ❌ Databases (state kept in-memory for demo)

## Next Steps

1. **Add persistent storage** for negotiation state
2. **Implement real settlement backend** (escrow, payment processor)
3. **Add authentication/authorization**
4. **Persist transcripts** to files/database
5. **Add monitoring/metrics**

## Documentation

- [Pact SDK Docs](../../../packages/sdk/README.md)
- [Pact Protocol Spec](../../../specs/pact/1.0/negotiation-grammar.md)
- [Provider Adapter](../../../packages/provider-adapter/README.md)
