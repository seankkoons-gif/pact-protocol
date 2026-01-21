# Weather Provider Example

A complete Pact v3 provider example demonstrating real agent commerce with deterministic pricing.

## Product

- **Product**: `weather.data`
- **Params**: `city`, `freshness_seconds`
- **SLA**: `max_latency_ms`

## Pricing Model (Deterministic)

- **Base price**: $0.00008 per request
- **Surcharge if `freshness_seconds < 120`**: +$0.00002 (real-time data premium)
- **Surcharge if `max_latency_ms < 500`**: +$0.00001 (low latency premium)

**Example prices:**
- Standard request (NYC, freshness=300s, latency=1000ms): $0.00008
- Real-time request (NYC, freshness=10s, latency=1000ms): $0.00010
- Low latency request (NYC, freshness=300s, latency=50ms): $0.00009
- Real-time + low latency (NYC, freshness=10s, latency=50ms): $0.00011

## Policy

- **Profile**: Fast small purchase
- **Mode**: `fastest` (prioritizes speed)
- **Trust requirements**: Relaxed (min_reputation=0.0)
- **Negotiation**: Max 2 rounds, 150ms timeout
- **Bonds**: Lower multiples for small purchases

## Settlement

- **Default**: Boundary mode (no external dependencies)
- **Optional**: Stripe (if `stripe` package installed and `PACT_STRIPE_API_KEY` set)

## 5-Minute Run

### 1. Install dependencies

```bash
cd examples/providers/weather-provider
pnpm install
```

### 2. Start provider

```bash
pnpm dev
```

Server starts on `http://localhost:3000` with:
- Health: `http://localhost:3000/health`
- Pact: `http://localhost:3000/pact`

**Note:** The endpoint in `providers.jsonl` must match the port the provider runs on (port 3000). The registry entry's `endpoint` field should be `http://127.0.0.1:3000` or `http://localhost:3000`.

### 3. Test with curl

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
      "expires_at_ms": 60000
    },
    "message_hash_hex": "test",
    "signer_public_key_b58": "test",
    "signature_b58": "test",
    "signed_at_ms": 1000
  }'
```

**Expected output:**
- Signed ASK message with price calculation
- Transcript file created in `.pact/transcripts/`

### 4. Run buyer demo

In another terminal:

```bash
# From repo root
pnpm example:buyer:weather
```

Or from this directory:

```bash
tsx buyer-demo.ts
```

**Expected output:**
```
✅ Negotiation Complete!
   Agreed Price: $0.00010
   Rounds: 1
   Transcript: .pact/transcripts/intent-*.json
   Replay: pnpm pact:replay .pact/transcripts/intent-*.json
```

### 5. Run smoke test

```bash
pnpm smoke
```

Verifies:
- Server starts successfully
- Pact request works
- Transcript is written

## Project Structure

```
weather-provider/
├── src/
│   ├── server.ts         # Express HTTP server
│   ├── pactHandler.ts    # Pact protocol handler (pricing logic)
│   ├── policy.ts         # Fast small purchase policy profile
│   ├── settlement.ts     # Boundary/Stripe settlement adapter
│   └── smoke.ts          # Smoke test script
├── buyer-demo.ts         # Buyer agent demo script
├── package.json
└── README.md
```

## Customization

1. **Update pricing logic** in `src/pactHandler.ts` → `calculatePrice()`
2. **Modify policy** in `src/policy.ts`
3. **Change settlement** in `src/settlement.ts`

## Transcripts

All negotiations write transcripts to `.pact/transcripts/`. Each transcript includes:
- Negotiation rounds
- Pricing decisions
- Final agreed price
- Settlement status

**Replay transcript:**
```bash
pnpm pact:replay .pact/transcripts/intent-*.json
```

## Settlement Modes

### Boundary (Default)

Works out of the box. Settlement is handled externally or by SDK.

```bash
pnpm dev
```

### Stripe (Optional)

1. Install Stripe:
   ```bash
   pnpm add stripe
   ```

2. Set API key:
   ```bash
   export PACT_STRIPE_API_KEY=sk_test_...
   ```

3. Start server (Stripe detected automatically)

## Next Steps

- **Add real weather API**: Replace `generateWeatherData()` with actual API call
- **Persist transcripts**: Store in database or external service
- **Add authentication**: Require API keys or KYA credentials
- **Deploy**: Deploy to production (Heroku, Railway, etc.)
