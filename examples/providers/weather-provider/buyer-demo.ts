#!/usr/bin/env tsx
/**
 * Buyer Demo for Weather Provider
 * 
 * Demonstrates a buyer agent calling acquire() against the weather provider
 * and printing negotiation rounds, final price, transcript path, and replay command.
 */

import {
  acquire,
  createDefaultPolicy,
  validatePolicyJson,
  generateKeyPair,
  MockSettlementProvider,
  InMemoryProviderDirectory,
  ReceiptStore,
} from "@pact/sdk";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Weather Provider - Buyer Demo");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Generate keypairs
  const buyerKeyPair = generateKeyPair();
  const sellerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
  const sellerId = publicKeyToB58(sellerKeyPair.publicKey);

  // Provider endpoint (default: localhost:3000, override with WEATHER_PROVIDER_URL)
  const providerUrl = process.env.WEATHER_PROVIDER_URL || "http://localhost:3000";

  console.log("📋 Setup:");
  console.log(`   Buyer ID: ${buyerId.substring(0, 16)}...`);
  console.log(`   Provider URL: ${providerUrl}\n`);

  // Create in-memory provider directory
  const directory = new InMemoryProviderDirectory();
  directory.registerProvider({
    provider_id: sellerId,
    intentType: "weather.data",
    pubkey_b58: sellerId,
    endpoint: providerUrl,
    credentials: [],
    baseline_latency_ms: 100,
  });

  // Create receipt store for negotiated regime
  const store = new ReceiptStore();
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

  // Create settlement provider (in-memory, no external dependencies)
  const settlement = new MockSettlementProvider();
  settlement.credit(buyerId, 1.0);
  settlement.credit(sellerId, 0.1);

  // Create policy (fast_small_purchase profile)
  const policy = createDefaultPolicy();
  policy.mode = "fastest";
  policy.counterparty.min_reputation = 0.0;
  policy.negotiation.max_rounds = 2;
  policy.economics.bonding.seller_bond_multiple = 1.5;

  const validated = validatePolicyJson(policy);
  if (!validated.ok) {
    console.error("❌ Policy validation failed:", validated.errors);
    process.exit(1);
  }

  // Ensure transcript directory exists
  const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
  if (!fs.existsSync(transcriptDir)) {
    fs.mkdirSync(transcriptDir, { recursive: true });
  }

  console.log("🔄 Starting negotiation...\n");
  console.log("  Intent: weather.data (NYC)");
  console.log("  Constraints: latency < 50ms, freshness < 10s");
  console.log("  Max price: $0.0002\n");

  // Run acquisition
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
  });

  // Print results
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ✅ Negotiation Complete!");
  console.log("═══════════════════════════════════════════════════════════\n");

  if (result.ok && result.receipt) {
    console.log("📊 Results:");
    console.log(`   Outcome: ✅ Success`);
    console.log(`   Agreed Price: $${result.receipt.agreed_price.toFixed(8)}`);
    console.log(`   Fulfilled: ${result.receipt.fulfilled ? "Yes" : "No"}\n`);

    if (result.transcriptPath) {
      const transcript = JSON.parse(fs.readFileSync(result.transcriptPath, "utf-8"));

      // Print negotiation rounds
      if (transcript.negotiation_rounds && transcript.negotiation_rounds.length > 0) {
        console.log("🔄 Negotiation Rounds:");
        transcript.negotiation_rounds.forEach((round: any, idx: number) => {
          const roundNum = round.round || idx + 1;
          const counter = round.counter_price?.toFixed(8) || "N/A";
          const ask = round.ask_price?.toFixed(8) || "N/A";
          const accepted = round.accepted ? "✅" : "❌";
          console.log(`   Round ${roundNum}: counter=$${counter}, ask=$${ask}, accepted=${accepted}`);
        });
        console.log();
      } else if (transcript.negotiation) {
        console.log("🔄 Negotiation:");
        console.log(`   Strategy: ${transcript.negotiation.strategy || "N/A"}`);
        console.log(`   Rounds used: ${transcript.negotiation.rounds_used || 0}\n`);
      }

      console.log("📄 Transcript:");
      console.log(`   Path: ${result.transcriptPath}\n`);

      console.log("🔄 Replay command:");
      const relativePath = path.relative(process.cwd(), result.transcriptPath);
      console.log(`   pnpm pact:replay ${relativePath}\n`);
    }

    process.exit(0);
  } else {
    console.error("❌ Negotiation failed!");
    console.error(`   Code: ${result.code}`);
    console.error(`   Reason: ${result.reason}`);

    if (result.transcriptPath) {
      console.error(`\n📄 Transcript saved: ${result.transcriptPath}`);
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
