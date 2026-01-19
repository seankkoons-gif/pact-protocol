#!/usr/bin/env tsx
/**
 * Autonomous API Procurement - Success Scenario
 * 
 * Flow:
 * - Request quote
 * - Ensure price <= 0.05 (policy)
 * - Deliver
 * - Create PoN rounds: INTENT, ASK, ACCEPT (3 rounds)
 * - Verify transcript VALID
 * - Generate evidence bundle PASS
 */

import {
  runInPactBoundary,
  type BoundaryIntent,
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
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const DEBUG_LOG = "/Users/seankoons/Desktop/pact/.cursor/debug.log";
function debugLog(location: string, message: string, data: any) {
  try {
    const logEntry = JSON.stringify({location, message, data, timestamp: Date.now(), sessionId: 'debug-session'}) + '\n';
    fs.appendFileSync(DEBUG_LOG, logEntry);
  } catch {}
}
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
  console.log("  Autonomous API Procurement - Success Scenario");
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

  // Create Policy v4 (max price constraint)
  const policy: PactPolicyV4 = {
    policy_version: "pact-policy/4.0",
    policy_id: "policy-success-v4",
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

  // Run inside Pact Boundary
  const result = await runInPactBoundary(intent, policy, async (context) => {
    // Request quote
    let quoteResponse: Response;
    try {
      quoteResponse = await fetch(`${providerUrl}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch (error: any) {
      // Network errors (ECONNREFUSED, etc.) should also create failure events
      throw new BoundaryAbortError(`Quote request network error: ${error.message}`, "PACT-404");
    }
    if (!quoteResponse.ok) {
      throw new BoundaryAbortError(`Quote request failed: ${quoteResponse.statusText}`, "PACT-404");
    }
    const quote = await quoteResponse.json();
    const offerPrice = quote.price;

    // Manual freshness check (policy engine doesn't support freshness_sec field)
    const minFreshnessSec = 10;
    const providerFreshnessSec = quote.freshness_sec;
    if (typeof providerFreshnessSec !== "number" || providerFreshnessSec < minFreshnessSec) {
      throw new BoundaryAbortError(`Freshness check failed: ${providerFreshnessSec} < ${minFreshnessSec}`, "FRESHNESS_BREACH");
    }

    // Policy is evaluated automatically by Boundary Runtime
    // If offerPrice > 0.05, boundary would abort with PACT-101

    // Deliver
    let deliverResponse: Response;
    try {
      deliverResponse = await fetch(`${providerUrl}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch (error: any) {
      // Network errors should also create failure events
      throw new BoundaryAbortError(`Deliver request network error: ${error.message}`, "SETTLEMENT_FAILED");
    }
    if (!deliverResponse.ok) {
      throw new BoundaryAbortError(`Deliver request failed: ${deliverResponse.statusText}`, "SETTLEMENT_FAILED");
    }
    const data = await deliverResponse.json();

    return {
      success: true,
      offer_price: offerPrice,
      bid_price: offerPrice,
      settlement_mode: "boundary",
      data,
    };
  });

  // Add signed rounds to transcript (INTENT, ASK, ACCEPT)
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

  // Add ASK round (round 1) - use canonical helper
  // CRITICAL: Filter out undefined values to prevent hash mismatch
  // (JSON serialization omits undefined, but stableCanonicalize includes them as null)
  const offerPrice = result.success ? (result as any).offer_price : 0.04;
  const askContentSummary: Record<string, unknown> = {};
  if (offerPrice !== undefined) {
    askContentSummary.price = offerPrice;
  }
  debugLog('run_success.ts:185', 'askContentSummary before createSignedRound', {askContentSummary, success: result.success});
  const askRoundRaw = createSignedRound("ASK", "seller", sellerKeypair, baseTimestamp + 1000, intent.intent_id, askContentSummary);
  debugLog('run_success.ts:188', 'askRoundRaw after createSignedRound', {content_summary: askRoundRaw.content_summary, round_type: askRoundRaw.round_type});
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'run_success.ts:152',message:'before addRoundToTranscript round1',data:{round0_hash:transcript.rounds[0]?.round_hash,askRoundRaw:JSON.parse(JSON.stringify(askRoundRaw))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  transcript = addRoundToTranscript(transcript, askRoundRaw);
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'run_success.ts:156',message:'after addRoundToTranscript round1',data:{round1:JSON.parse(JSON.stringify(transcript.rounds[1])),round1_hash:transcript.rounds[1]?.round_hash,round0_hash:transcript.rounds[0]?.round_hash},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  debugLog('run_success.ts:191', 'transcript after addRoundToTranscript', {round1_content_summary: transcript.rounds[1]?.content_summary, rounds_length: transcript.rounds.length});

  // Add ACCEPT round (round 2) - always add for narrative clarity (matches canonical demo)
  // CRITICAL: Filter out undefined values to prevent hash mismatch
  const acceptPrice = result.success ? (result as any).offer_price : 0.04;
  const acceptContentSummary: Record<string, unknown> = {};
  if (acceptPrice !== undefined) {
    acceptContentSummary.price = acceptPrice;
  }
  const acceptRoundRaw = createSignedRound("ACCEPT", "buyer", buyerKeypair, baseTimestamp + 2000, intent.intent_id, acceptContentSummary);
  transcript = addRoundToTranscript(transcript, acceptRoundRaw);

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
  console.log(`     Rounds: ${transcript.rounds.length}\n`);

  // Verify transcript
  console.log("  🔍 Verifying Transcript...");
  const verifyResult = await verifyTranscript(transcript);
  if (verifyResult.ok && verifyResult.integrity_status === "VALID") {
    console.log(`     ✓ Integrity: ${verifyResult.integrity_status}`);
  } else {
    console.log(`     ❌ Integrity: ${verifyResult.integrity_status}`);
    console.log(`     Errors: ${verifyResult.errors.map((e) => e.message).join(", ")}`);
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
  console.log("  ✅ Success Scenario Complete!");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
