#!/usr/bin/env tsx
/**
 * Example: ML-Assisted Negotiation
 * 
 * What this example demonstrates and why it matters:
 * 
 * This example shows how ML can enhance negotiation while maintaining determinism
 * and safety. It demonstrates:
 * 
 * 1. ML as advisory: ML scores candidates but doesn't decide outcomes. The negotiation
 *    strategy uses ML scores to rank candidates, but decision logic remains deterministic.
 * 
 * 2. Mandatory fallback: If ML fails (model unavailable, timeout, error), negotiation
 *    falls back to deterministic strategies (banded_concession, baseline). ML enhances
 *    but never controls negotiation.
 * 
 * 3. Training data export: Transcripts are converted to training rows for offline ML
 *    model training. This creates a feedback loop: negotiate → record → train → improve.
 * 
 * This matters because it shows how to integrate ML safely: bounded, fallback-enabled,
 * and training-data-driven. ML improves outcomes without breaking determinism or
 * introducing failure modes.
 */

import {
  acquire,
  createDefaultPolicy,
  validatePolicyJson,
  generateKeyPair,
  MockSettlementProvider,
  ReceiptStore,
  InMemoryProviderDirectory,
  transcriptToTrainingRow,
  type MLScorer,
  type MLScorerInput,
  type MLScorerOutput,
  publicKeyToB58,
} from "@pact/sdk";
import { startProviderServer } from "@pact/provider-adapter";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

// FakeMLScorer: Demonstrates ML Scorer Interface
// In production: trained ML model (TensorFlow/PyTorch), remote service, or on-chain contract
// Requirements: deterministic, error-handling, fast (negotiation can't wait)

class FakeMLScorer implements MLScorer {
  async score(input: MLScorerInput): Promise<MLScorerOutput> {
    // Simple heuristic: prefer candidates closer to reference_price
    const ref = input.reference_price ?? input.quote_price;
    const scored = input.candidates.map((price, idx) => {
      const distance = Math.abs(price - ref);
      const score = 100 - (distance / ref) * 50; // Higher score for closer to reference
      return { idx, price, score: Math.max(0, score), reason: `distance_from_ref:${distance.toFixed(4)}` };
    });

    // Sort by score descending, then by price ascending (stable tie-breaking)
    scored.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.01) return b.score - a.score;
      return a.price - b.price;
    });

    return {
      ranked_candidates: scored,
      best_idx: scored[0].idx,
      best_price: scored[0].price,
      explanation: `Selected candidate ${scored[0].idx} with score ${scored[0].score.toFixed(2)}`,
    };
  }
}

// ML Integration Pattern: ML SCORES candidates, doesn't DECIDE outcomes
// Flow: Generate candidates (deterministic) → Score with ML (advisory) → Select best (deterministic) → Fallback if ML fails
// Ensures: Determinism, safety (ML failure doesn't break negotiation), explainability

async function main() {
  console.log("=== PACT Example: ML-Assisted Negotiation ===\n");
  console.log("Demonstrates: ML as advisory scorer with mandatory fallback\n");

  // Generate keypairs
  const buyerKeyPair = generateKeyPair();
  const sellerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
  const sellerId = publicKeyToB58(sellerKeyPair.publicKey);

  // Start HTTP provider server (required for negotiated regime)
  const server = startProviderServer({
    port: 0,
    sellerKeyPair: sellerKeyPair,
    sellerId: sellerId,
  });

  try {
    // Create in-memory provider directory and register a provider with HTTP endpoint
    const directory = new InMemoryProviderDirectory();
    directory.registerProvider({
      provider_id: sellerId,
      intentType: "weather.data",
      pubkey_b58: sellerId,
      endpoint: server.url,
      credentials: [],
      baseline_latency_ms: 25,
    });

    // Create in-memory receipt store (needed for negotiated regime)
    const store = new ReceiptStore();
    // Add some historical receipts to trigger negotiated regime
    // (negotiated regime requires tradeCount >= 5)
    for (let i = 0; i < 5; i++) {
      store.ingest({
        receipt_id: `receipt-${i}`,
        intent_id: `intent-${i}`,
        intent_type: "weather.data",
        buyer_agent_id: buyerId,
        seller_agent_id: sellerId,
        agreed_price: 0.0001,
        fulfilled: true,
        timestamp_ms: 1000 + i * 1000, // Deterministic timestamps
      });
    }

    // Create settlement provider (in-memory, no external dependencies)
    const settlement = new MockSettlementProvider();
    settlement.credit(buyerId, 1.0); // Buyer has enough for maxPrice
    settlement.credit(sellerId, 0.1); // Seller has enough for bond

    // Create and validate policy
    const policy = createDefaultPolicy();
    // Lower min_reputation for example (providers with limited history)
    policy.counterparty.min_reputation = 0.0;
    const validated = validatePolicyJson(policy);
    if (!validated.ok) {
      console.error("❌ Policy validation failed:", validated.errors);
      process.exit(1);
    }

    const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
    if (!fs.existsSync(transcriptDir)) fs.mkdirSync(transcriptDir, { recursive: true });

    // Demonstrate FakeMLScorer (for illustration)
    console.log("📊 FakeMLScorer demonstration:");
    const fakeScorer = new FakeMLScorer();
    const testOutput = await fakeScorer.score({ round: 1, quote_price: 0.0001, max_price: 0.0002, reference_price: 0.00009, candidates: [0.00008, 0.00009, 0.0001], intent_type: "weather.data", buyer_id: buyerId, provider_id: sellerId });
    console.log(`  Best: idx=${testOutput.best_idx}, price=${testOutput.best_price.toFixed(8)}, score=${testOutput.ranked_candidates[0].score.toFixed(2)} [In production: trained ML model]\n`);

    // Run acquisition with ML strategy (ml_stub uses StubMLScorer internally)
    console.log("Step 1: Negotiate with ML strategy (ml_stub)");
    console.log("  [ML scores candidates, decision logic is deterministic, fallback if ML fails]\n");

    // Create deterministic clock (for reproducibility)
    let now = 1000;
    const nowFn = () => {
      const current = now;
      now += 100;
      return current;
    };

    const result = await acquire({
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0002,
        saveTranscript: true,
        transcriptDir: transcriptDir,
        negotiation: {
          strategy: "ml_stub", // Uses ML strategy with stub scorer
          params: {
            scorer: "stub",
            candidate_count: 3,
          },
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
      now: nowFn,
    });

    if (!result.ok || !result.receipt) {
      console.error(`\n❌ Acquisition failed: ${result.code} - ${result.reason}`);
      if (result.transcriptPath) {
        console.error(`📄 Transcript saved to: ${result.transcriptPath}`);
      }
      process.exit(1);
    }

    console.log(`  ✅ Negotiation complete`);
    console.log(`  Agreed price: ${result.receipt.agreed_price.toFixed(8)}\n`);

    // Step 2: Verify ML involvement in transcript
    console.log("Step 2: Verify ML involvement in transcript");
    if (result.transcriptPath) {
      const transcript = JSON.parse(fs.readFileSync(result.transcriptPath, "utf-8"));
      if (transcript.negotiation?.ml) {
        console.log(`  ✅ ML metadata: scorer=${transcript.negotiation.ml.scorer}, selected_idx=${transcript.negotiation.ml.selected_candidate_idx}`);
        if (transcript.negotiation.ml.top_scores) {
          console.log(`     Top scores: ${transcript.negotiation.ml.top_scores.map((s: any) => `${s.idx}:${s.score.toFixed(2)}`).join(", ")}`);
        }
        console.log(`  [ML scores are advisory - decisions remain deterministic]\n`);
      }
    }

    // Step 3: Export training row
    console.log("Step 3: Export training row for ML model training");
    if (result.transcriptPath) {
      const transcript = JSON.parse(fs.readFileSync(result.transcriptPath, "utf-8"));
      const trainingRow = transcriptToTrainingRow(transcript);
      if (trainingRow) {
        console.log(`  ✅ Training row: strategy=${trainingRow.negotiation_strategy}, outcome=${trainingRow.outcome}, ml_scorer=${trainingRow.ml_scorer || "N/A"}`);
        const trainingDir = path.join(repoRoot, ".pact", "training");
        if (!fs.existsSync(trainingDir)) fs.mkdirSync(trainingDir, { recursive: true });
        const trainingFile = path.join(trainingDir, "training.jsonl");
        fs.appendFileSync(trainingFile, JSON.stringify(trainingRow) + "\n");
        console.log(`     Saved to: ${trainingFile} [Used for offline ML training]\n`);
      }
    }

    // Summary: ML Integration Principles
    console.log("=== ML Integration Principles ===");
    console.log("✅ ML is advisory: Scores candidates, doesn't decide outcomes");
    console.log("✅ Fallback is mandatory: ML failure → deterministic fallback");
    console.log("✅ Determinism preserved: Same inputs → same outputs");
    console.log("✅ Training offline: Models trained on historical transcripts\n");

    console.log("💡 Scaling to Real ML Models:");
    console.log("  1. Replace StubMLScorer with trained model (TensorFlow/PyTorch)");
    console.log("  2. Ensure determinism (fixed seed, no dropout at inference)");
    console.log("  3. Add timeout/error handling (fallback if unavailable)");
    console.log("  4. Train offline on exported training rows");
    console.log("  5. Version models (record version in transcript for replay)\n");

    if (result.transcriptPath) console.log(`📄 Transcript: ${result.transcriptPath}\n`);
    process.exit(0);
  } finally {
    // Clean up: close provider server
    await server.close();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
