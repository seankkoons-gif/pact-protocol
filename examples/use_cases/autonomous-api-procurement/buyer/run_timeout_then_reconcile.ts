#!/usr/bin/env tsx
/**
 * Autonomous API Procurement - Timeout Scenario
 * 
 * Flow:
 * - POST /quote with timeout 3000ms
 * - If timeout occurs, record attempt round (provider request)
 * - failure_event: PACT-404
 * - rounds >= 2
 * - Verify transcript VALID
 * - Evidence bundle PASS
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

/**
 * Fetch with timeout.
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw error;
  }
}

async function main() {
  const providerUrl = getProviderUrl();
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Autonomous API Procurement - Timeout Scenario");
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

  // Create Policy v4
  const policy: PactPolicyV4 = {
    policy_version: "pact-policy/4.0",
    policy_id: "policy-timeout-v4",
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

  // Capture provider attempt details before the fetch
  const providerAttemptDetails = {
    provider_url: providerUrl,
    endpoint: "/quote",
    timeout_ms: 3000,
    request_body: JSON.stringify({}),
    request_hash: "",
    attempt_timestamp_ms: Date.now(),
  };
  providerAttemptDetails.request_hash = crypto
    .createHash("sha256")
    .update(providerAttemptDetails.request_body, "utf8")
    .digest("hex");

  // Run inside Pact Boundary
  let receivedQuote = false;
  const result = await runInPactBoundary(intent, policy, async (context) => {
    // Attempt quote with timeout
    try {
      const quoteResponse = await fetchWithTimeout(
        `${providerUrl}/quote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: providerAttemptDetails.request_body,
        },
        providerAttemptDetails.timeout_ms
      );
      if (!quoteResponse.ok) {
        throw new BoundaryAbortError(`Quote request failed: ${quoteResponse.statusText}`, "PACT-404");
      }
      const quote = await quoteResponse.json();
      receivedQuote = true;
      return {
        success: true,
        offer_price: quote.price,
        bid_price: quote.price,
        settlement_mode: "boundary",
      };
    } catch (error: any) {
      if (error.message === "Request timeout") {
        // Timeout occurred - throw BoundaryAbortError so runInPactBoundary creates failure_event
        throw new BoundaryAbortError("Request timeout", "PACT-404");
      }
      throw error;
    }
  });

  // Add signed rounds to transcript
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

  // Add ASK round (round 1) - capture timeout attempt
  if (!receivedQuote && providerAttemptDetails) {
    const askRoundRaw = createSignedRound("ASK", "buyer", buyerKeypair, baseTimestamp + 1000, intent.intent_id, {
      price: 0,
      error_summary: "Request timeout",
      provider_url: providerAttemptDetails.provider_url,
      endpoint: providerAttemptDetails.endpoint,
      timeout_ms: providerAttemptDetails.timeout_ms,
      request_hash: providerAttemptDetails.request_hash,
    });
    transcript = addRoundToTranscript(transcript, askRoundRaw);
  } else if (receivedQuote) {
    const askRoundRaw = createSignedRound("ASK", "seller", sellerKeypair, baseTimestamp + 1000, intent.intent_id, {
      price: (result as any).offer_price || 0.04,
    });
    transcript = addRoundToTranscript(transcript, askRoundRaw);
  }

  // Assert rounds exist
  if (transcript.rounds.length === 0) {
    throw new Error("Transcript has no rounds");
  }
  if (!receivedQuote && transcript.rounds.length < 2) {
    throw new Error("Timeout transcript must have at least 2 rounds");
  }

  // Update failure_event with evidence_refs if present
  if (transcript.failure_event && !receivedQuote) {
    const attemptRound = transcript.rounds[1];
    transcript.failure_event.evidence_refs = [
      {
        type: "round_hash",
        round_number: 1,
        round_hash: attemptRound.round_hash,
      },
      {
        type: "custom",
        key: "provider_url",
        value: providerAttemptDetails.provider_url,
      },
      {
        type: "custom",
        key: "timeout_ms",
        value: providerAttemptDetails.timeout_ms.toString(),
      },
      {
        type: "custom",
        key: "request_hash",
        value: providerAttemptDetails.request_hash,
      },
    ];
    transcript.failure_event.transcript_hash = computeTranscriptHashUpToFailure(transcript);
  } else if (transcript.failure_event) {
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
  console.log("  ✅ Timeout Scenario Complete!");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
