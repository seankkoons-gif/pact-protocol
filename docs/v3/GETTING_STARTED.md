# Getting Started with PACT v3

## What PACT Does

PACT is a deterministic negotiation protocol for autonomous agents. Given an intent (what you want), constraints (latency, freshness, trust requirements), and a maximum price, PACT discovers providers, negotiates terms, selects a counterparty, and coordinates settlement—all while producing a complete, replayable transcript of every decision. PACT negotiates and coordinates; execution (wallets, escrow, payments) happens outside PACT through pluggable interfaces.

## Installation

```bash
npm install @pact/sdk
# or
pnpm add @pact/sdk
```

TypeScript types are included. No additional type definitions needed.

## Minimal Negotiation Example

```typescript
import { acquire, createDefaultPolicy, validatePolicyJson, generateKeyPair, MockSettlementProvider, InMemoryProviderDirectory, ReceiptStore } from "@pact/sdk";
import bs58 from "bs58";

// Generate keypairs
const buyerKeyPair = generateKeyPair();
const sellerKeyPair = generateKeyPair();
const buyerId = bs58.encode(Buffer.from(buyerKeyPair.publicKey));
const sellerId = bs58.encode(Buffer.from(sellerKeyPair.publicKey));

// Register provider
const directory = new InMemoryProviderDirectory();
directory.registerProvider({
  provider_id: sellerId,
  intentType: "weather.data",
  pubkey_b58: sellerId,
  region: "us-east",
  credentials: ["sla_verified"],
  baseline_latency_ms: 50,
});

// Setup settlement and policy
const settlement = new MockSettlementProvider();
settlement.credit(buyerId, 1.0);
settlement.credit(sellerId, 0.1);

const store = new ReceiptStore();
// Add 5+ receipts to trigger negotiated regime
for (let i = 0; i < 5; i++) {
  store.ingest({
    receipt_id: `receipt-${i}`,
    intent_id: `intent-${i}`,
    intent_type: "weather.data",
    buyer_agent_id: buyerId,
    seller_agent_id: sellerId,
    agreed_price: 0.0001,
    fulfilled: true,
    timestamp_ms: Date.now() - (5 - i) * 1000,
  });
}

const policy = createDefaultPolicy();
const validated = validatePolicyJson(policy);

// Negotiate
const result = await acquire({
  input: {
    intentType: "weather.data",
    scope: "NYC",
    constraints: { latency_ms: 50, freshness_sec: 10 },
    maxPrice: 0.0002,
    saveTranscript: true,
    negotiation: {
      strategy: "banded_concession",
      params: { band_pct: 0.1, max_rounds: 3 },
    },
  },
  buyerKeyPair,
  sellerKeyPair,
  buyerId,
  sellerId,
  policy: validated.policy,
  settlement,
  store,
  directory,
  sellerKeyPairsByPubkeyB58: { [sellerId]: sellerKeyPair },
});

if (result.ok) {
  console.log(`Agreed price: ${result.receipt.agreed_price}`);
  console.log(`Transcript: ${result.transcriptPath}`);
}
```

This example:
- Negotiates price using `banded_concession` strategy
- Saves a transcript to `.pact/transcripts/`
- Returns an agreed price or failure reason
- Uses in-memory components (no external dependencies)

## Where Wallets Fit

Wallets are external boundaries. PACT uses wallets to sign intents and provide proofs, but does NOT custody assets or manage keys.

```typescript
import { EthersWalletAdapter } from "@pact/sdk";

// Create wallet adapter (external - NOT part of PACT core)
const wallet = await EthersWalletAdapter.create(privateKey);
const addressInfo = await wallet.getAddress();

// Use wallet in acquisition
const result = await acquire({
  input: {
    // ... intent, constraints, etc.
    wallet: {
      provider: "ethers",
      params: { privateKey },
      requires_signature: true,
      signature_action: {
        action: "authorize",
        asset_symbol: "USDC",
      },
    },
  },
  // ... other params
});

// Wallet signature is recorded in transcript
// PACT provides proof, but does NOT manage wallet keys
```

**Key point**: PACT records wallet signatures in transcripts. Wallet key management, asset custody, and transaction signing are your responsibility.

## Where Escrow Fits

Escrow is an external execution boundary. PACT provides intent IDs and proofs; you implement escrow (on-chain contracts, payment processors, custom services).

```typescript
// 1. PACT negotiates
const result = await acquire({ /* ... */ });
const intentId = result.receipt.intent_id;
const proof = `transcript:${path.basename(result.transcriptPath)}`;

// 2. You lock funds in escrow (external - NOT part of PACT)
await escrowContract.lock(intentId, buyerAddress, sellerAddress, amount, "ETH", proof);

// 3. PACT completes acquisition
// (acquisition logic continues...)

// 4. You release funds from escrow (external - NOT part of PACT)
const fulfillmentProof = `receipt:${result.receipt.receipt_id}:fulfilled:${result.receipt.fulfilled}`;
await escrowContract.release(intentId, fulfillmentProof);
```

**Key point**: PACT provides `intentId` (authority identifier) and `proof` (opaque bytes). Escrow implementation (smart contracts, payment processors) is your responsibility.

See `pact-escrow-evm/` for an example Ethereum escrow contract interface.

## Where ML Fits

ML is advisory, not decisive. ML scores candidates, but decision logic remains deterministic. If ML fails, negotiation falls back to deterministic strategies.

```typescript
// Use ML strategy
const result = await acquire({
  input: {
    // ... intent, constraints, etc.
    negotiation: {
      strategy: "ml_stub", // ML strategy with stub scorer
      params: {
        scorer: "stub",
        candidate_count: 3,
      },
    },
  },
  // ... other params
});

// ML metadata recorded in transcript
const transcript = JSON.parse(fs.readFileSync(result.transcriptPath, "utf-8"));
console.log(transcript.negotiation.ml.scorer); // "stub"
console.log(transcript.negotiation.ml.selected_candidate_idx); // 1
console.log(transcript.negotiation.ml.top_scores); // [{idx, score, reason}, ...]

// Export training row for offline ML training
import { transcriptToTrainingRow } from "@pact/sdk";
const trainingRow = transcriptToTrainingRow(transcript);
// Save to JSONL for batch training
```

**Key points**:
- ML scores candidates, doesn't decide outcomes
- Fallback is mandatory: ML failure → deterministic fallback
- Training is offline: Models trained on historical transcripts
- Determinism preserved: Same inputs → same outputs (even with ML)

## How to Debug with Transcripts

Transcripts are executable specifications. Replay them to verify correctness, debug failures, and audit decisions.

```typescript
import { replayTranscript, verifyTranscriptFile } from "@pact/sdk";

// Verify transcript integrity
const verification = await verifyTranscriptFile(transcriptPath);
if (!verification.ok) {
  console.error("Transcript verification failed:", verification.errors);
}

// Replay transcript to reconstruct state
const replay = await replayTranscript(transcriptPath);
console.log(`Replay outcome: ${replay.outcome.ok ? "success" : "failure"}`);
console.log(`Final price: ${replay.receipt?.agreed_price}`);

// Inspect negotiation rounds
const transcript = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
transcript.negotiation_rounds?.forEach(round => {
  console.log(`Round ${round.round}: counter=${round.counter_price}, ask=${round.ask_price}, accepted=${round.accepted}`);
});

// Check why provider was selected/rejected
transcript.explain?.decisions?.forEach(decision => {
  console.log(`Provider ${decision.provider_id}: ${decision.code} - ${decision.reason}`);
});
```

**Key points**:
- Transcripts are deterministic: Same inputs → same transcript
- Transcripts are replayable: Reconstruct state from transcript alone
- Transcripts are auditable: Every decision is explained and traceable

## When You Should NOT Use PACT

**Don't use PACT if:**

1. **You need a marketplace**: PACT is a negotiation protocol, not a market. If you need order books, limit orders, or price discovery through competition, use a marketplace.

2. **You need high-liquidity, standardized goods**: Markets are better for high-volume, standardized transactions. PACT is for low-liquidity, bespoke services.

3. **You need human UX**: PACT is machine-to-machine. If you're building a human-facing application, PACT's protocol semantics won't help.

4. **You need a payment processor**: PACT doesn't move money. If you just need to accept payments, use Stripe, PayPal, or similar.

5. **You need a wallet or custody solution**: PACT doesn't custody assets or manage keys. If you need wallet functionality, use wallet libraries or custody services.

6. **You need a blockchain**: PACT is chain-agnostic. If you need blockchain-specific features (smart contracts, on-chain state), use blockchain tooling directly.

7. **You need real-time price feeds**: PACT negotiates prices through back-and-forth, not real-time feeds. If you need live market prices, use price oracles.

**Use PACT when:**
- You're building autonomous agents that need to negotiate with other agents
- Value is uncertain and requires negotiation to resolve
- You need deterministic, auditable negotiation outcomes
- You need to coordinate settlement without prior trust
- You need explainable decision-making (why was this provider selected?)

PACT is a protocol layer for agent-to-agent negotiation. If that's not your problem, PACT isn't your solution.
