#!/usr/bin/env tsx
/**
 * Example: Timeout Streaming
 * 
 * Forces streaming mode with buyer stop after 1 tick.
 * Demonstrates partial fulfillment and early exit.
 */

import {
  acquire,
  createDefaultPolicy,
  validatePolicyJson,
  generateKeyPair,
  publicKeyToB58,
  MockSettlementProvider,
  InMemoryProviderDirectory,
} from "@pact/sdk";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

async function main() {
  console.log("=== PACT Example: Timeout Streaming ===\n");

  // Generate keypairs
  const buyerKeyPair = generateKeyPair();
  const sellerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
  const sellerId = publicKeyToB58(sellerKeyPair.publicKey);

  // Create in-memory provider directory and register a provider
  const directory = new InMemoryProviderDirectory();
  directory.registerProvider({
    provider_id: sellerId,
    intentType: "weather.data",
    pubkey_b58: sellerId,
    region: "us-east",
    credentials: ["sla_verified"],
    baseline_latency_ms: 50,
  });

  // Create settlement provider
  const settlement = new MockSettlementProvider();
  settlement.credit(buyerId, 1.0);
  settlement.credit(sellerId, 0.1);

  // Create and validate policy
  const policy = createDefaultPolicy();
  const validated = validatePolicyJson(policy);
  if (!validated.ok) {
    console.error("❌ Policy validation failed:", validated.errors);
    process.exit(1);
  }

  // Run acquisition with streaming mode and buyer stop after 1 tick
  console.log("Running streaming acquisition (buyer stops after 1 tick)...");
  const nowFn = () => Date.now();
  const result = await acquire({
    input: {
      intentType: "weather.data",
      scope: "NYC",
      constraints: { latency_ms: 50, freshness_sec: 10 },
      maxPrice: 0.0001,
      modeOverride: "streaming", // Force streaming mode
      buyerStopAfterTicks: 1, // Stop after 1 tick
      saveTranscript: true,
      transcriptDir: path.join(repoRoot, ".pact", "transcripts"),
    },
    buyerKeyPair,
    sellerKeyPair,
    buyerId,
    sellerId,
    policy: validated.policy,
    settlement,
    directory,
    sellerKeyPairsByPubkeyB58: {
      [sellerId]: sellerKeyPair,
    },
    now: nowFn,
  });

  // Print results
  if (result.ok && result.receipt) {
    console.log("\n✅ Streaming acquisition completed!");
    console.log(`Receipt ID: ${result.receipt.receipt_id}`);
    console.log(`Fulfilled: ${result.receipt.fulfilled}`);
    console.log(`Paid Amount: ${result.receipt.paid_amount || 0}`);
    console.log(`Ticks: ${result.receipt.ticks || 0}`);
    console.log(`Chunks: ${result.receipt.chunks || 0}`);
    
    if (result.transcriptPath) {
      console.log(`\n📄 Transcript: ${result.transcriptPath}`);
    }
    
    // Show balances
    const buyerBalance = settlement.getBalance(buyerId);
    const sellerBalance = settlement.getBalance(sellerId);
    console.log(`\n💰 Balances:`);
    console.log(`  Buyer:  ${buyerBalance.toFixed(8)}`);
    console.log(`  Seller: ${sellerBalance.toFixed(8)}`);
    
    process.exit(0);
  } else {
    console.error("\n❌ Acquisition failed!");
    console.error(`Code: ${result.code}`);
    console.error(`Reason: ${result.reason}`);
    
    if (result.transcriptPath) {
      console.error(`\n📄 Transcript: ${result.transcriptPath}`);
    }
    
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

