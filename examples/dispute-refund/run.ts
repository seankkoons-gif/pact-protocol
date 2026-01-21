#!/usr/bin/env tsx
/**
 * Example: Dispute & Refund
 * 
 * Creates a dispute, resolves it, executes a refund, and verifies balances.
 */

import {
  acquire,
  createDefaultPolicy,
  validatePolicyJson,
  generateKeyPair,
  publicKeyToB58,
  MockSettlementProvider,
  InMemoryProviderDirectory,
  openDispute,
  resolveDispute,
} from "@pact/sdk";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

async function main() {
  console.log("=== PACT Example: Dispute & Refund ===\n");

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
  const initialBuyerBalance = 1.0;
  const initialSellerBalance = 0.1;
  settlement.credit(buyerId, initialBuyerBalance);
  settlement.credit(sellerId, initialSellerBalance);

  // Create and validate policy with disputes enabled
  const policy = createDefaultPolicy();
  // Enable disputes
  policy.base.disputes = {
    enabled: true,
    window_ms: 86400000, // 24 hours
    allow_partial: true,
    max_refund_pct: 1.0,
  };
  
  const validated = validatePolicyJson(policy);
  if (!validated.ok) {
    console.error("❌ Policy validation failed:", validated.errors);
    process.exit(1);
  }

  // Step 1: Run acquisition
  console.log("Step 1: Running acquisition...");
  const nowFn = () => Date.now();
  const result = await acquire({
    input: {
      intentType: "weather.data",
      scope: "NYC",
      constraints: { latency_ms: 50, freshness_sec: 10 },
      maxPrice: 0.0001,
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

  if (!result.ok || !result.receipt) {
    console.error("❌ Acquisition failed:", result.code, result.reason);
    process.exit(1);
  }

  const receipt = result.receipt;
  console.log(`✅ Acquisition successful! Receipt: ${receipt.receipt_id}`);
  console.log(`   Paid: ${receipt.paid_amount || receipt.agreed_price}\n`);

  // Step 2: Open dispute
  console.log("Step 2: Opening dispute...");
  const dispute = openDispute({
    receipt,
    reason: "Service not delivered as promised",
    now: nowFn(),
    policy: validated.policy,
    transcriptPath: result.transcriptPath,
    disputeDir: path.join(repoRoot, ".pact", "disputes"),
  });
  console.log(`✅ Dispute opened: ${dispute.dispute_id}\n`);

  // Step 3: Resolve dispute with full refund
  console.log("Step 3: Resolving dispute with full refund...");
  const refundAmount = receipt.paid_amount || receipt.agreed_price || 0;
  const resolveResult = await resolveDispute({
    dispute_id: dispute.dispute_id,
    outcome: "REFUND_FULL",
    refund_amount: refundAmount,
    notes: "Refund approved after review",
    now: nowFn(),
    policy: validated.policy,
    settlementProvider: settlement,
    receipt,
    disputeDir: path.join(repoRoot, ".pact", "disputes"),
    transcriptPath: result.transcriptPath,
  });

  if (!resolveResult.ok) {
    console.error("❌ Dispute resolution failed:", resolveResult.code, resolveResult.reason);
    process.exit(1);
  }
  console.log(`✅ Dispute resolved: ${resolveResult.record?.status}\n`);

  // Step 4: Verify balances
  console.log("Step 4: Verifying balances...");
  const finalBuyerBalance = settlement.getBalance(buyerId);
  const finalSellerBalance = settlement.getBalance(sellerId);
  
  console.log(`💰 Balances:`);
  console.log(`  Buyer:  ${finalBuyerBalance.toFixed(8)} (initial: ${initialBuyerBalance.toFixed(8)})`);
  console.log(`  Seller: ${finalSellerBalance.toFixed(8)} (initial: ${initialSellerBalance.toFixed(8)})`);
  
  // Verify refund was processed
  const buyerRefunded = finalBuyerBalance >= initialBuyerBalance;
  const sellerDebited = finalSellerBalance <= initialSellerBalance;
  
  if (buyerRefunded && sellerDebited) {
    console.log("\n✅ Refund verified: Buyer received refund, seller was debited");
    process.exit(0);
  } else {
    console.error("\n❌ Refund verification failed!");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

