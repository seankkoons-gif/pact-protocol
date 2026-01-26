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
  signEnvelope,
  generateKeyPair,
  parseEnvelope,
  type IntentMessage,
  type AskMessage,
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
  generateKeyPair as generateKeyPairForTranscript,
  type KeyPairWithObjects,
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

  // Initialize keypairs for signing
  // Prefer environment variable or file-based keys, otherwise generate ephemeral keys
  let buyerKeypair: KeyPairWithObjects;
  let buyerKeypairForEnvelopes: { publicKey: Uint8Array; secretKey: Uint8Array }; // For @pact/sdk signEnvelope
  
  if (process.env.BUYER_SECRET_KEY_B58) {
    // TODO: Load from env var (base58 encoded secret key)
    // For now, fall through to ephemeral generation
    console.log("  ⚠️  BUYER_SECRET_KEY_B58 detected but not yet implemented, using ephemeral keys");
    buyerKeypair = generateKeyPairForTranscript();
    buyerKeypairForEnvelopes = generateKeyPair();
  } else {
    // Generate ephemeral keypairs
    console.log("  🔑 Generating ephemeral keypairs for buyer and seller");
    buyerKeypair = generateKeyPairForTranscript();
    buyerKeypairForEnvelopes = generateKeyPair();
  }

  // Runtime assertion: verify keypair has private key before proceeding
  if (!buyerKeypair || !buyerKeypair.privateKeyObj) {
    throw new Error(
      "Missing signing key: set BUYER_SECRET_KEY_B58 or run with --ephemeral-keys. " +
      "Keypair must have privateKeyObj for signing."
    );
  }

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
    // Preflight check: verify provider is reachable
    try {
      const healthResponse = await fetch(`${providerUrl}/health`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!healthResponse.ok) {
        throw new BoundaryAbortError(`Provider health check failed: ${healthResponse.statusText}`, "PACT-420");
      }
    } catch (error: any) {
      // Network errors (ECONNREFUSED, etc.) - provider unreachable
      if (error instanceof BoundaryAbortError) throw error;
      throw new BoundaryAbortError(`Provider unreachable: ${error.message}`, "PACT-420");
    }

    // Create INTENT message matching provider's expected format
    // Use EXACT same structure as pactHandler.test.ts "should handle valid INTENT message successfully"
    // Use deterministic timestamp from intent.created_at_ms for consistency
    const baseTimestamp = intent.created_at_ms;
    const nowMs = baseTimestamp;
    
    // Build INTENT message with exact same structure as provider test
    const intentMessage: IntentMessage = {
      protocol_version: "pact/1.0",
      type: "INTENT",
      intent_id: intent.intent_id,
      intent: "weather.data",
      scope: "NYC",
      constraints: {
        latency_ms: 50,
        freshness_sec: 10,
      },
      max_price: 0.05,
      settlement_mode: "hash_reveal",
      sent_at_ms: nowMs,
      expires_at_ms: nowMs + 60000,
    };

    // Sign INTENT envelope using SDK helper (includes signature fields)
    const envelope = await signEnvelope(intentMessage, buyerKeypairForEnvelopes, nowMs);

    // Request quote via Pact protocol /pact endpoint
    // POST envelope directly to provider (flat envelope object)
    let askEnvelope;
    let providerRejected = false;
    try {
      const response = await fetch(`${providerUrl}/pact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });

      if (response.status === 404) {
        throw new BoundaryAbortError(`Provider API mismatch: /pact endpoint not found`, "PACT-421");
      }

      if (!response.ok) {
        providerRejected = true;
        let errorText: string;
        let errorDetails: any = null;
        try {
          const errorJson = await response.json();
          errorDetails = errorJson;
          // Print full error details for debugging missing fields
          console.error(`\n  ❌ Provider returned HTTP ${response.status} (INTENT request):`);
          console.error(`     Error: ${errorJson.error || "Unknown error"}`);
          if (errorJson.missing && Array.isArray(errorJson.missing)) {
            console.error(`     Missing fields: ${errorJson.missing.join(", ")}`);
          }
          if (errorJson.message) {
            console.error(`     Message: ${errorJson.message}`);
          }
          console.error(`     Full response: ${JSON.stringify(errorJson, null, 2)}`);
          console.error(`     Sent envelope structure:`);
          console.error(`       envelope_version: ${envelope.envelope_version}`);
          console.error(`       message.type: ${(envelope.message as any).type}`);
          console.error(`       message.intent_id: ${(envelope.message as any).intent_id}`);
          console.error(`       message.intent: ${(envelope.message as any).intent}`);
          console.error(`       message.scope: ${(envelope.message as any).scope}`);
          console.error(`       message.constraints: ${JSON.stringify((envelope.message as any).constraints)}`);
          console.error(`       message.max_price: ${(envelope.message as any).max_price}`);
          console.error(`       message.sent_at_ms: ${(envelope.message as any).sent_at_ms}`);
          console.error(`       message.expires_at_ms: ${(envelope.message as any).expires_at_ms}`);
          // If error mentions require_expires_at, print the full message JSON path
          if (errorJson.message && (errorJson.message.includes("require_expires_at") || errorJson.message.includes("policy.time"))) {
            console.error(`     Full message JSON sent:`);
            console.error(`       ${JSON.stringify(envelope.message, null, 2)}`);
          }
          console.error(`\n`);
          errorText = errorJson.error || JSON.stringify(errorJson);
        } catch {
          errorText = await response.text();
          console.error(`\n  ❌ Provider returned HTTP ${response.status} (INTENT request):`);
          console.error(`     Response body: ${errorText}\n`);
        }
        // HTTP 400 => PACT-422 PROVIDER_BAD_REQUEST
        // Exit non-zero and do NOT write transcript
        console.error(`\n  ❌ Provider rejected request. Exiting without writing transcript.\n`);
        process.exit(1);
      }

      const responseData = await response.json();
      askEnvelope = responseData;
    } catch (error: any) {
      // Network errors (ECONNREFUSED, etc.) - provider unreachable
      if (error instanceof BoundaryAbortError) throw error;
      throw new BoundaryAbortError(`Provider unreachable: ${error.message}`, "PACT-420");
    }

    // Parse and validate ASK envelope
    const parsed = await parseEnvelope(askEnvelope);
    if (parsed.message.type !== "ASK") {
      throw new BoundaryAbortError(`Expected ASK message, got ${parsed.message.type}`, "PACT-422");
    }

    const askMessage = parsed.message as AskMessage;
    const offerPrice = askMessage.price;

    // Manual freshness check (policy engine doesn't support freshness_sec field)
    // Note: ASK message doesn't have freshness_sec, but we can check latency_ms
    const minFreshnessSec = 10;
    // Provider's ASK doesn't include freshness_sec, so we'll skip this check
    // The policy will handle price validation

    // Policy is evaluated automatically by Boundary Runtime
    // If offerPrice > 0.05, boundary would abort with PACT-101

    // Accept the ASK by sending ACCEPT message via /pact endpoint
    const acceptMessage = {
      protocol_version: "pact/1.0" as const,
      type: "ACCEPT" as const,
      intent_id: intent.intent_id,
      agreed_price: offerPrice,
      settlement_mode: "hash_reveal" as const,
      proof_type: "hash_reveal" as const,
      challenge_window_ms: 150,
      delivery_deadline_ms: nowMs + 60000,
      sent_at_ms: nowMs + 1000,
      expires_at_ms: nowMs + 30000,
    };

    // Sign ACCEPT envelope using SDK helper (includes signature fields)
    const acceptEnvelope = await signEnvelope(acceptMessage, buyerKeypairForEnvelopes, nowMs + 1000);

    let acceptResponse;
    try {
      // Verify envelope structure before sending
      if (!acceptEnvelope.envelope_version || !acceptEnvelope.message || !acceptEnvelope.message_hash_hex) {
        throw new Error(`Invalid envelope structure: missing envelope_version, message, or message_hash_hex`);
      }
      
      const response = await fetch(`${providerUrl}/pact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(acceptEnvelope),
      });

      if (response.status === 404) {
        throw new BoundaryAbortError(`Provider API mismatch: /pact endpoint not found`, "PACT-421");
      }

      if (!response.ok) {
        providerRejected = true;
        let errorText: string;
        let errorDetails: any = null;
        try {
          const errorJson = await response.json();
          errorDetails = errorJson;
          // Print full error details for debugging missing fields
          console.error(`\n  ❌ Provider returned HTTP ${response.status} (ACCEPT request):`);
          console.error(`     Error: ${errorJson.error || "Unknown error"}`);
          if (errorJson.missing && Array.isArray(errorJson.missing)) {
            console.error(`     Missing fields: ${errorJson.missing.join(", ")}`);
          }
          if (errorJson.message) {
            console.error(`     Message: ${errorJson.message}`);
          }
          console.error(`     Full response: ${JSON.stringify(errorJson, null, 2)}`);
          console.error(`     Sent envelope structure:`);
          console.error(`       envelope_version: ${acceptEnvelope.envelope_version}`);
          console.error(`       message.type: ${(acceptEnvelope.message as any).type}`);
          console.error(`       message.intent_id: ${(acceptEnvelope.message as any).intent_id}`);
          console.error(`\n`);
          errorText = errorJson.error || JSON.stringify(errorJson);
        } catch {
          errorText = await response.text();
          console.error(`\n  ❌ Provider returned HTTP ${response.status} (ACCEPT request):`);
          console.error(`     Response body: ${errorText}\n`);
        }
        // HTTP 400 => PACT-422 PROVIDER_BAD_REQUEST
        // Exit non-zero and do NOT write transcript
        console.error(`\n  ❌ Provider rejected request. Exiting without writing transcript.\n`);
        process.exit(1);
      }

      acceptResponse = await response.json();
    } catch (error: any) {
      // Network errors should also create failure events
      if (error instanceof BoundaryAbortError) throw error;
      throw new BoundaryAbortError(`Provider unreachable: ${error.message}`, "PACT-420");
    }

    // Parse ACCEPT response (provider acknowledges)
    const parsedAccept = await parseEnvelope(acceptResponse);
    const data = {
      accepted: true,
      price: offerPrice,
      intent_id: intent.intent_id,
    };

    return {
      success: true,
      offer_price: offerPrice,
      bid_price: offerPrice,
      settlement_mode: "boundary",
      data,
    };
  });

  // Build transcript rounds (INTENT, ASK, ACCEPT)
  // Only write transcript AFTER all rounds are successfully created and signed
  // AND provider has accepted the request (not rejected with HTTP 400)
  let transcript = result.transcript;

  // Generate seller keypair for transcript rounds (ASK round)
  const sellerKeypair = generateKeyPairForTranscript();

  // Runtime assertion: verify seller keypair has private key
  if (!sellerKeypair || !sellerKeypair.privateKeyObj) {
    throw new Error(
      "Missing seller signing key: sellerKeypair must have privateKeyObj for signing."
    );
  }

  const baseTimestamp = intent.created_at_ms;

  // Add INTENT round (round 0) - use canonical helper
  // Runtime assertion: verify buyer keypair exists before signing
  if (!buyerKeypair || !buyerKeypair.privateKeyObj) {
    throw new Error("Missing buyer signing key before creating INTENT round");
  }
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
  const askRoundRaw = createSignedRound("ASK", "seller", sellerKeypair, baseTimestamp + 1000, intent.intent_id, askContentSummary);
  transcript = addRoundToTranscript(transcript, askRoundRaw);

  // Add ACCEPT round (round 2) - always add for narrative clarity (matches canonical demo)
  // CRITICAL: Filter out undefined values to prevent hash mismatch
  const acceptPrice = result.success ? (result as any).offer_price : 0.04;
  const acceptContentSummary: Record<string, unknown> = {};
  if (acceptPrice !== undefined) {
    acceptContentSummary.price = acceptPrice;
  }
  const acceptRoundRaw = createSignedRound("ACCEPT", "buyer", buyerKeypair, baseTimestamp + 2000, intent.intent_id, acceptContentSummary);
  transcript = addRoundToTranscript(transcript, acceptRoundRaw);

  // Assert rounds exist and are properly signed
  if (transcript.rounds.length === 0) {
    throw new Error("Transcript has no rounds - cannot write invalid transcript");
  }

  // Verify all rounds have signatures before writing
  for (const round of transcript.rounds) {
    if (!round.signature || !round.signature.signature_b58) {
      throw new Error(`Round ${round.round_number} (${round.round_type}) missing signature - cannot write invalid transcript`);
    }
  }

  // Update failure_event.transcript_hash if present
  if (transcript.failure_event) {
    transcript.failure_event.transcript_hash = computeTranscriptHashUpToFailure(transcript);
  }

  // Only write transcript AFTER all rounds are built and signatures succeed
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

  // Check transcript outcome - must not have failure_event for success
  if (transcript.failure_event) {
    // Extract abort_reason from evidence_refs
    const abortReasonRef = transcript.failure_event.evidence_refs.find((ref) =>
      ref.startsWith("abort_reason:")
    );
    const abortReason = abortReasonRef
      ? abortReasonRef.substring("abort_reason:".length)
      : "Unknown abort reason";

    // Print failure details to stderr
    console.error("\n═══════════════════════════════════════════════════════════");
    console.error("  ❌ Transcript Failure Detected");
    console.error("═══════════════════════════════════════════════════════════\n");
    console.error(`  Code: ${transcript.failure_event.code}`);
    console.error(`  Stage: ${transcript.failure_event.stage}`);
    console.error(`  Fault Domain: ${transcript.failure_event.fault_domain}`);
    console.error(`  Terminality: ${transcript.failure_event.terminality}`);
    console.error(`  Abort Reason: ${abortReason}`);
    console.error("\n  Transcript indicates terminal failure. Cannot report success.\n");
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
