#!/usr/bin/env tsx
/**
 * Example: Basic Negotiation
 * 
 * What this example demonstrates and why it matters:
 * 
 * This example shows how PACT enables deterministic negotiation between autonomous agents
 * without requiring wallets, complex settlement, or external dependencies. It demonstrates:
 * 
 * 1. Negotiation without wallets: Agents can negotiate terms (price, constraints) using
 *    in-memory components, proving that negotiation is a protocol layer independent of
 *    execution (settlement, wallets, chains).
 * 
 * 2. Deterministic pricing: Given the same inputs (intent, policy, directory, clock),
 *    PACT produces the same negotiation outcome. This enables reproducible testing,
 *    audit trails, and verifiable decision-making.
 * 
 * 3. Transcript generation and replayability: Every negotiation produces a complete,
 *    deterministic transcript that can be replayed to verify correctness, debug failures,
 *    and train ML models. Transcripts are the source of truth, not a side effect.
 * 
 * This matters because autonomous agents need verifiable, explainable negotiation
 * protocols that work independently of execution backends (chains, wallets, payment rails).
 * PACT provides that protocol layer.
 */

import {
  acquire,
  createDefaultPolicy,
  validatePolicyJson,
  generateKeyPair,
  publicKeyToB58,
  MockSettlementProvider,
  InMemoryProviderDirectory,
  ReceiptStore,
} from "@pact/sdk";
import { startProviderServer } from "@pact/provider-adapter";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

async function main() {
  console.log("=== PACT Example: Basic Negotiation ===\n");

  // Generate keypairs for buyer and seller
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

    // Create deterministic clock (for reproducibility)
    let now = 1000;
    const nowFn = () => {
      const current = now;
      now += 100;
      return current;
    };

    // Ensure transcript directory exists
    const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
    if (!fs.existsSync(transcriptDir)) {
      fs.mkdirSync(transcriptDir, { recursive: true });
    }

    // Run acquisition with banded_concession negotiation strategy
    console.log("Running acquisition with banded_concession strategy...");
    console.log("  Intent: weather.data (NYC)");
    console.log("  Max price: 0.0002");
    console.log("  Constraints: latency < 50ms, freshness < 10s\n");

    const result = await acquire({
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0002,
        saveTranscript: true,
        transcriptDir: transcriptDir,
        negotiation: {
          strategy: "banded_concession",
          params: {
            band_pct: 0.1,
            max_rounds: 3,
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
      sellerKeyPairsByPubkeyB58: {
        [sellerId]: sellerKeyPair,
      },
      now: nowFn,
    });

    // Print results
    if (result.ok && result.receipt) {
      console.log("✅ Acquisition successful!");
      console.log(`\n📊 Final agreed price: ${result.receipt.agreed_price.toFixed(8)}`);
      
      if (result.transcriptPath) {
        console.log(`\n📄 Transcript saved to: ${result.transcriptPath}`);
        
        // Verify transcript exists and is valid JSON
        if (fs.existsSync(result.transcriptPath)) {
          const transcriptContent = fs.readFileSync(result.transcriptPath, "utf-8");
          const transcript = JSON.parse(transcriptContent);
          
          console.log(`\n📋 Transcript summary:`);
          console.log(`  Strategy: ${transcript.negotiation?.strategy || "N/A"}`);
          console.log(`  Rounds used: ${transcript.negotiation?.rounds_used || 0}`);
          console.log(`  Outcome: ${transcript.outcome?.ok ? "✅ Success" : "❌ Failed"}`);
          
          if (transcript.negotiation_rounds && transcript.negotiation_rounds.length > 0) {
            console.log(`\n  Negotiation rounds:`);
            transcript.negotiation_rounds.forEach((round: any, idx: number) => {
              console.log(`    Round ${round.round}: counter=${round.counter_price.toFixed(8)}, ask=${round.ask_price.toFixed(8)}, accepted=${round.accepted}`);
            });
          }
        }
      }
      
      process.exit(0);
    } else {
      console.error("\n❌ Acquisition failed!");
      console.error(`Code: ${result.code}`);
      console.error(`Reason: ${result.reason}`);
      
      if (result.transcriptPath) {
        console.error(`\n📄 Transcript saved to: ${result.transcriptPath}`);
      }
      
      process.exit(1);
    }
  } finally {
    // Clean up: close provider server
    await server.close();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
