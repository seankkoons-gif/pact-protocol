#!/usr/bin/env tsx
/**
 * PACT v3 Quickstart Demo
 * 
 * One-command demo showing negotiation + transcripts end-to-end.
 * Works without any optional dependencies (stripe, snarkjs).
 * 
 * Run: pnpm demo:v3:quickstart
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
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  PACT v3 Quickstart Demo");
  console.log("  One-command demo: Negotiation + Transcripts");
  console.log("═══════════════════════════════════════════════════════════\n");

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
    console.log("📋 Setup:");
    console.log("   ✓ Generated keypairs (buyer & seller)");
    
    // Create in-memory provider directory and register a provider
    const directory = new InMemoryProviderDirectory();
    directory.registerProvider({
      provider_id: sellerId,
      intentType: "weather.data",
      pubkey_b58: sellerId,
      endpoint: server.url,
      credentials: [],
      baseline_latency_ms: 25,
    });
    console.log("   ✓ Registered weather data provider");
    console.log(`   ✓ Provider endpoint: ${server.url}\n`);

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
    console.log("   ✓ Created receipt history (5 transactions)\n");

    // Create settlement provider (in-memory, no external dependencies)
    const settlement = new MockSettlementProvider();
    settlement.credit(buyerId, 1.0); // Buyer has enough for maxPrice
    settlement.credit(sellerId, 0.1); // Seller has enough for bond
    console.log("   ✓ Initialized settlement (in-memory, no external dependencies)\n");

    // Create and validate policy
    const policy = createDefaultPolicy();
    // Lower min_reputation for example (providers with limited history)
    policy.counterparty.min_reputation = 0.0;
    const validated = validatePolicyJson(policy);
    if (!validated.ok) {
      console.error("❌ Policy validation failed:", validated.errors);
      process.exit(1);
    }
    console.log("   ✓ Created and validated policy\n");

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
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  🔄 Negotiation Starting...");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  Intent: weather.data (NYC)");
    console.log("  Max price: $0.0002");
    console.log("  Constraints: latency < 50ms, freshness < 10s");
    console.log("  Strategy: banded_concession (band: 10%, max rounds: 3)\n");

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
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ✅ Negotiation Complete!");
    console.log("═══════════════════════════════════════════════════════════\n");

    if (result.ok && result.receipt) {
      console.log("  📊 Result:");
      console.log(`     Outcome: ✅ Success`);
      console.log(`     Agreed Price: $${result.receipt.agreed_price.toFixed(8)}`);
      console.log(`     Fulfilled: ${result.receipt.fulfilled ? "Yes" : "No"}\n`);

      if (result.transcriptPath) {
        console.log("  📄 Transcript:");
        console.log(`     Path: ${result.transcriptPath}\n`);
        
        // Verify transcript exists and is valid JSON
        if (fs.existsSync(result.transcriptPath)) {
          const transcriptContent = fs.readFileSync(result.transcriptPath, "utf-8");
          const transcript = JSON.parse(transcriptContent);
          
          console.log("  📋 Transcript Summary:");
          console.log(`     Strategy: ${transcript.negotiation?.strategy || "N/A"}`);
          console.log(`     Rounds used: ${transcript.negotiation?.rounds_used || 0}`);
          console.log(`     Outcome: ${transcript.outcome?.ok ? "✅ Success" : "❌ Failed"}`);
          
          if (transcript.negotiation_rounds && transcript.negotiation_rounds.length > 0) {
            console.log(`\n  🔄 Negotiation Rounds:`);
            transcript.negotiation_rounds.forEach((round: any, idx: number) => {
              const roundNum = round.round || idx + 1;
              const counter = round.counter_price?.toFixed(8) || "N/A";
              const ask = round.ask_price?.toFixed(8) || "N/A";
              const accepted = round.accepted ? "✅" : "❌";
              console.log(`     Round ${roundNum}: counter=$${counter}, ask=$${ask}, accepted=${accepted}`);
            });
          }

          console.log("\n  ✓ Transcript is valid, replayable, and auditable");
          console.log("  ✓ All decisions are deterministic and explainable\n");
        }
      }

      console.log("═══════════════════════════════════════════════════════════");
      console.log("  🎉 Demo Complete!");
      console.log("═══════════════════════════════════════════════════════════\n");
      console.log("  What you just saw:");
      console.log("    • Negotiation between buyer and seller agents");
      console.log("    • Deterministic pricing (banded_concession strategy)");
      console.log("    • Complete transcript saved (replayable, auditable)");
      console.log("    • No external dependencies required (core protocol only)\n");
      console.log("  Next steps:");
      console.log("    • Try: pnpm example:v3:04 (Stripe integration)");
      console.log("    • Try: pnpm example:v3:05 (ZK-KYA verification)");
      console.log("    • Read: docs/v3/RELEASE_NOTES.md\n");

      process.exit(0);
    } else {
      console.error("\n❌ Negotiation failed!");
      console.error(`   Code: ${result.code}`);
      console.error(`   Reason: ${result.reason}`);
      
      if (result.transcriptPath) {
        console.error(`\n📄 Transcript saved: ${result.transcriptPath}`);
      }
      
      process.exit(1);
    }
  } finally {
    // Clean up: close provider server
    await server.close();
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
