# LLM Verifier Provider Example

A complete Pact v3 provider example demonstrating LLM verification with deterministic pricing.

## Product

- **Product**: `llm.verify`
- **Params**: `statement`, `method` ("quick" | "thorough")
- **Returns**: `verdict` ("true" | "false" | "uncertain"), `confidence`, `rationale`

## Pricing Model (Deterministic)

- **Quick method**: $0.00005 per request (cheaper)
- **Thorough method**: $0.00012 per request (more expensive)
- **Surcharge if `statement.length > 500`**: +$0.00001 per 100 extra chars

**Example prices:**
- Quick verification (100 chars): $0.00005
- Thorough verification (100 chars): $0.00012
- Quick verification (600 chars): $0.00006 (500 base + 100 extra)
- Thorough verification (1000 chars): $0.00017 (500 base + 500 extra)

## KYA Variant

- **Default**: None (all agents accepted)
- **Optional**: Basic KYA (set `REQUIRE_KYA=1` environment variable)
  - Requires at least one credential
  - Basic verification (accepts all agents with credentials)

## Policy

- **Mode**: `balanced` (default)
- **Trust requirements**: Relaxed (min_reputation=0.0 by default)
- **Negotiation**: Standard (max 3 rounds)

## Settlement

- **Default**: Boundary mode (no external dependencies)
- **Optional**: Stripe (if `stripe` package installed and `PACT_STRIPE_API_KEY` set)

## 5-Minute Run

### 1. Install dependencies

```bash
cd examples/providers/llm-verifier-provider
pnpm install
```

### 2. Start provider

```bash
pnpm dev
```

Server starts on `http://localhost:3001` with:
- Health: `http://localhost:3001/health`
- Pact: `http://localhost:3001/pact`

### 3. Test with curl

```bash
curl -X POST http://localhost:3001/pact \
  -H "Content-Type: application/json" \
  -d '{
    "envelope_version": "pact-envelope/1.0",
    "message": {
      "protocol_version": "pact/1.0",
      "type": "INTENT",
      "intent_id": "test-intent-1",
      "intent": "llm.verify",
      "scope": { "statement": "The sky is blue.", "method": "quick" },
      "constraints": { "latency_ms": 200 },
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
pnpm example:buyer:llm
```

Or from this directory:

```bash
tsx buyer-demo.ts
```

**Expected output:**
```
✅ Negotiation Complete!
   Agreed Price: $0.00005
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

### 6. Test KYA variant (optional)

Set `REQUIRE_KYA=1` to enable basic KYA:

```bash
REQUIRE_KYA=1 pnpm dev
```

## Project Structure

```
llm-verifier-provider/
├── src/
│   ├── server.ts         # Express HTTP server
│   ├── pactHandler.ts    # Pact protocol handler (pricing logic)
│   ├── policy.ts         # Negotiation policy
│   ├── kya.ts            # KYA verification (none/basic)
│   ├── settlement.ts     # Boundary/Stripe settlement adapter
│   └── smoke.ts          # Smoke test script
├── buyer-demo.ts         # Buyer agent demo script
├── package.json
└── README.md
```

## Customization

1. **Update pricing logic** in `src/pactHandler.ts` → `calculatePrice()`
2. **Modify KYA requirements** in `src/kya.ts`
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

- **Add real LLM API**: Replace `verifyStatement()` with actual LLM call
- **Persist transcripts**: Store in database or external service
- **Add authentication**: Require API keys or KYA credentials
- **Deploy**: Deploy to production (Heroku, Railway, etc.)
