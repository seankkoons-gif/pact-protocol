#!/usr/bin/env tsx
/**
 * Example: Reconcile Pending
 * 
 * Creates an async stripe_like settlement in pending state,
 * then calls reconcile() to update the transcript.
 */

import {
  acquire,
  createDefaultPolicy,
  validatePolicyJson,
  generateKeyPair,
  publicKeyToB58,
  StripeLikeSettlementProvider,
  InMemoryProviderDirectory,
  reconcile,
} from "@pact/sdk";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

async function main() {
  console.log("=== PACT Example: Reconcile Pending ===\n");

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

  // Create stripe_like settlement provider with async commit (will be pending initially)
  // forcePendingUntilPoll: 101 forces it to return pending for first 101 polls (higher than max attempts of 100)
  // This ensures acquire() times out with pending status, then reconcile() can poll and transition to committed
  const settlement = new StripeLikeSettlementProvider({
    asyncCommit: true,
    commitDelayTicks: 1, // Will resolve after commitDelayTicks polls (after forcePendingUntilPoll)
    forcePendingUntilPoll: 101, // Force pending for first 101 polls (higher than max attempts)
    failCommit: false,
  });
  settlement.credit(buyerId, 1.0);
  settlement.credit(sellerId, 0.1);

  // Create and validate policy
  const policy = createDefaultPolicy();
  const validated = validatePolicyJson(policy);
  if (!validated.ok) {
    console.error("❌ Policy validation failed:", validated.errors);
    process.exit(1);
  }

  // Step 1: Run acquisition with async settlement (will be pending)
  console.log("Step 1: Running acquisition with async settlement...");
  console.log("   (Settlement will be pending initially)\n");
  
  const nowFn = () => Date.now();
  const result = await acquire({
    input: {
      intentType: "weather.data",
      scope: "NYC",
      constraints: { latency_ms: 50, freshness_sec: 10 },
      maxPrice: 0.0001,
      settlement: {
        provider: "stripe_like",
        params: {
          asyncCommit: true,
          commitDelayTicks: 1, // Will resolve after commitDelayTicks polls (after forcePendingUntilPoll)
          forcePendingUntilPoll: 101, // Force pending for first 101 polls (higher than max attempts)
          failCommit: false,
        },
        // Set auto_poll_ms to allow pending settlements (required by acquire())
        // With forcePendingUntilPoll: 101, acquire() will timeout after 100 polls, leaving it pending
        auto_poll_ms: 0, // Immediate polling (will timeout after max attempts)
      },
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

  // Handle pending settlement timeout (expected for reconcile example)
  if (!result.ok && result.code === "SETTLEMENT_POLL_TIMEOUT") {
    console.log(`⚠️  Acquisition timed out (settlement still pending - expected)`);
    console.log(`   This is expected for the reconcile example\n`);
    
    // Try to get transcript path from error result
    if (!result.transcriptPath) {
      console.error("❌ No transcript path returned on timeout");
      process.exit(1);
    }
  } else if (!result.ok) {
    console.error("❌ Acquisition failed:", result.code, result.reason);
    process.exit(1);
  } else {
    console.log(`✅ Acquisition completed`);
  }

  // Get transcript path (either from success or timeout)
  const transcriptPath = result.transcriptPath;
  if (!transcriptPath) {
    console.error("❌ No transcript path returned");
    process.exit(1);
  }

  console.log(`   Transcript: ${transcriptPath}\n`);

  // Step 2: Check initial transcript status
  console.log("Step 2: Checking initial transcript status...");
  const transcriptContent = fs.readFileSync(transcriptPath, "utf-8");
  const transcript = JSON.parse(transcriptContent);
  const initialStatus = transcript.settlement_lifecycle?.status;
  console.log(`   Initial status: ${initialStatus || "unknown"}\n`);

  // Step 3: Reconcile pending settlement
  console.log("Step 3: Reconciling pending settlement...");
  const reconcileResult = await reconcile({
    transcriptPath: transcriptPath,
    now: nowFn,
    settlement,
    disputeDir: path.join(repoRoot, ".pact", "disputes"),
  });

  if (!reconcileResult.ok) {
    console.error("❌ Reconciliation failed:", reconcileResult.reason);
    process.exit(1);
  }

  console.log(`✅ Reconciliation ${reconcileResult.status}`);
  if (reconcileResult.updatedTranscriptPath) {
    console.log(`   Updated transcript: ${reconcileResult.updatedTranscriptPath}\n`);
  }

  // Step 4: Check updated transcript status
  if (reconcileResult.updatedTranscriptPath) {
    console.log("Step 4: Checking updated transcript status...");
    const updatedContent = fs.readFileSync(reconcileResult.updatedTranscriptPath, "utf-8");
    const updatedTranscript = JSON.parse(updatedContent);
    const finalStatus = updatedTranscript.settlement_lifecycle?.status;
    console.log(`   Final status: ${finalStatus || "unknown"}`);
    
    if (updatedTranscript.reconcile_events && updatedTranscript.reconcile_events.length > 0) {
      const lastEvent = updatedTranscript.reconcile_events[updatedTranscript.reconcile_events.length - 1];
      console.log(`   Reconciliation event: ${lastEvent.from_status} → ${lastEvent.to_status}`);
    }
  }

  console.log("\n✅ Reconcile example completed!");
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

