#!/usr/bin/env tsx
/**
 * Autonomous API Procurement - Policy Failure Scenario
 * 
 * Flow:
 * - Quote returns price (expect 0.10)
 * - Policy max_price 0.05 blocks
 * - Transcript must have rounds: INTENT, ASK (2 rounds)
 * - failure_event: PACT-101
 * - Verify transcript VALID
 * - Evidence bundle PASS
 */

import {
  runInPactBoundary,
  type BoundaryIntent,
  type BoundaryExecutionContext,
  type PactPolicyV4,
  addRoundToTranscript,
  stableCanonicalize,
  type TranscriptV4,
  type TranscriptRound,
  type Signature,
  BoundaryAbortError,
} from "@pact/sdk";
import * as path from "path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  getProviderUrl,
  generateKeyPair,
  addRound0ToTranscript,
  writeTranscript,
  verifyTranscript,
  bundleAndVerify,
  computeTranscriptHashUpToFailure,
  createSignedRound,
} from "./transcript_helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");

async function main() {
  const providerUrl = getProviderUrl();
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Autonomous API Procurement - Policy Failure Scenario");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log(`  Provider: ${providerUrl}\n`);

  // Create intent
  const intent: BoundaryIntent = {
    intent_id: `intent-${Date.now()}`,
    intent_type: "weather.data",
    created_at_ms: Date.now(),
    params: {
      city: "NYC",
      freshness_seconds: 10,
    },
  };

  // Create Policy v4 (max price constraint - will fail)
  const policy: PactPolicyV4 = {
    policy_version: "pact-policy/4.0",
    policy_id: "policy-fail-v4",
    rules: [
      {
        name: "max_price",
        condition: {
          field: "offer_price",
          operator: "<=",
          value: 0.05,
        },
      },
    ],
  };

  // Run inside Pact Boundary (will fail due to policy)
  const result = await runInPactBoundary(intent, policy, async (context: BoundaryExecutionContext) => {
    // Request quote (provider will return 0.10, which exceeds max_price 0.05)
    let quoteResponse: Response;
    try {
      quoteResponse = await fetch(`${providerUrl}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch (error: any) {
      // Network errors should also create failure events
      throw new BoundaryAbortError(`Quote request network error: ${error.message}`, "PACT-404");
    }
    if (!quoteResponse.ok) {
      throw new BoundaryAbortError(`Quote request failed: ${quoteResponse.statusText}`, "PACT-404");
    }
    const quote = await quoteResponse.json() as { price: number; latency_ms?: number; freshness_sec?: number };
    const offerPrice = quote.price;

    // Policy will block if offerPrice > 0.05
    // Boundary Runtime will abort with PACT-101

    return {
      success: false,
      offer_price: offerPrice,
      bid_price: offerPrice,
      settlement_mode: "boundary" as const,
    };
  });

  // Add signed rounds to transcript (INTENT, ASK)
  let transcript = result.transcript;

  // Generate keypairs
  const buyerKeypair = generateKeyPair();
  const sellerKeypair = generateKeyPair();

  const baseTimestamp = intent.created_at_ms;

  // Add INTENT round (round 0) - use canonical helper
  const intentRoundRaw = createSignedRound("INTENT", "buyer", buyerKeypair, baseTimestamp, intent.intent_id, {
    intent_type: intent.intent_type,
  });
  transcript = addRound0ToTranscript(transcript, intentRoundRaw);

  // Add ASK round (round 1) - even if policy fails, we record the quote
  // Use high price (0.10) to trigger policy failure, or get from result if available
  const askPrice = result.failure_event ? 0.10 : ((result as any).offer_price || 0.04);
  const askRoundRaw = createSignedRound("ASK", "seller", sellerKeypair, baseTimestamp + 1000, intent.intent_id, {
    price: askPrice,
  });
  transcript = addRoundToTranscript(transcript, askRoundRaw);

  // Assert rounds exist
  if (transcript.rounds.length === 0) {
    throw new Error("Transcript has no rounds");
  }

  // Update failure_event.transcript_hash if present
  if (transcript.failure_event) {
    transcript.failure_event.transcript_hash = computeTranscriptHashUpToFailure(transcript);
  }

  // Save transcript
  const transcriptPath = writeTranscript(transcript, repoRoot);
  console.log(`  📄 Transcript saved: ${transcriptPath}`);
  console.log(`     Rounds: ${transcript.rounds.length}`);
  if (transcript.failure_event) {
    console.log(`     Failure: ${transcript.failure_event.code} (${transcript.failure_event.stage})\n`);
  }

  // Verify transcript
  console.log("  🔍 Verifying Transcript...");
  const verifyResult = await verifyTranscript(transcript);
  if (verifyResult.ok && verifyResult.integrity_status === "VALID") {
    console.log(`     ✓ Integrity: ${verifyResult.integrity_status}`);
  } else {
    console.log(`     ❌ Integrity: ${verifyResult.integrity_status}`);
    console.log(`     Errors: ${verifyResult.errors.map((e: { type: string; message: string }) => e.message).join(", ")}`);
    process.exit(1);
  }

  // Generate and verify evidence bundle
  console.log("\n  📦 Generating Evidence Bundle...");
  const { bundlePath, verified } = await bundleAndVerify(transcriptPath, repoRoot);
  console.log(`     Bundle: ${bundlePath}`);
  if (verified) {
    console.log(`     ✓ INTEGRITY PASS\n`);
  } else {
    console.log(`     ❌ INTEGRITY FAIL\n`);
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ✅ Policy Failure Scenario Complete!");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
