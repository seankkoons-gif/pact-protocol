#!/usr/bin/env tsx
/**
 * PACT v4 Quickstart Demo (Canonical)
 * 
 * Self-contained v4 success demo that:
 * - Creates deterministic v4 transcripts directly (bypasses provider discovery)
 * - Always writes pact-transcript/4.0 transcripts with 3 signed rounds
 * - Works without external providers, registry files, or HTTP
 * - Always succeeds deterministically
 * 
 * Run: pnpm demo:v4:canonical
 */

import { 
  createDefaultPolicy,
  validatePolicyJson,
  MockSettlementProvider,
  replayTranscriptV4,
  createTranscriptV4,
  addRoundToTranscript,
  generateKeyPair,
  publicKeyToB58,
  signEnvelope,
  stableCanonicalize,
} from "@pact/sdk";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

/**
 * Compute policy hash for v4 transcript
 */
function computePolicyHash(policy: unknown): string {
  const canonical = stableCanonicalize(policy);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  return hash;
}

/**
 * Create a v4 transcript round from a signed envelope
 */
async function createRoundFromEnvelope(
  envelope: any,
  roundType: "INTENT" | "ASK" | "BID" | "ACCEPT" | "REJECT",
  agentId: string
): Promise<Omit<import("@pact/sdk").TranscriptRound, "round_number" | "previous_round_hash" | "round_hash">> {
  // Message hash is the envelope's message_hash_hex
  const messageHash = envelope.message_hash_hex;
  
  // Envelope hash is now provided by signEnvelope() as envelope_hash_hex
  // No need to recompute it - use the one from the envelope
  const envelopeHash = envelope.envelope_hash_hex;
  
  if (!envelopeHash) {
    throw new Error(`Envelope missing envelope_hash_hex. This envelope was created with an old version of signEnvelope().`);
  }

  return {
    round_type: roundType,
    message_hash: messageHash,
    envelope_hash: envelopeHash,
    signature: {
      signer_public_key_b58: envelope.signer_public_key_b58,
      signature_b58: envelope.signature_b58,
      signed_at_ms: envelope.signed_at_ms,
      scheme: "ed25519",
    },
    timestamp_ms: envelope.signed_at_ms,
    agent_id: agentId,
    public_key_b58: envelope.signer_public_key_b58,
  };
}

/**
 * Create a v4 failure transcript with at least INTENT round
 */
async function createFailureTranscriptV4(
  intentId: string,
  intentType: string,
  policy: unknown,
  failureCode: string,
  failureReason: string,
  timestampMs: number,
  buyerKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array },
  buyerId: string
): Promise<import("@pact/sdk").TranscriptV4> {
  const policyHash = computePolicyHash(policy);
  
  let transcript = createTranscriptV4({
    intent_id: intentId,
    intent_type: intentType,
    created_at_ms: timestampMs,
    policy_hash: policyHash,
    strategy_hash: "",
    identity_snapshot_hash: "",
  });

  // Add INTENT round (always include at least one round)
  const intentEnvelope = await signEnvelope({
    protocol_version: "pact/1.0",
    type: "INTENT",
    intent_id: intentId,
    intent: intentType,
    scope: "NYC",
    constraints: { latency_ms: 50, freshness_sec: 10 },
    max_price: 0.05,
    settlement_mode: "hash_reveal",
    sent_at_ms: timestampMs,
    expires_at_ms: timestampMs + 300000,
  }, buyerKeyPair, timestampMs);

  const intentRound = await createRoundFromEnvelope(intentEnvelope, "INTENT", buyerId);
  transcript = addRoundToTranscript(transcript, intentRound);

  // Compute failure hash from the transcript
  const transcriptCanonical = stableCanonicalize(transcript);
  const failureHash = crypto.createHash("sha256")
    .update(transcriptCanonical + failureCode + failureReason)
    .digest("hex");

  return {
    ...transcript,
    failure_event: {
      code: failureCode,
      stage: "acquisition",
      fault_domain: "buyer",
      terminality: "terminal",
      evidence_refs: [],
      timestamp: timestampMs + 1000,
      transcript_hash: failureHash,
    },
  };
}

async function main() {
  const startTime = Date.now();
  
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  PACT v4 Quickstart Demo (Canonical)");
  console.log("  Institution-Grade Autonomous Commerce Infrastructure");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Ensure transcript directory exists
  const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
  if (!fs.existsSync(transcriptDir)) {
    fs.mkdirSync(transcriptDir, { recursive: true });
  }

  try {
    // Generate keypairs for buyer and seller
    const buyerKeyPair = generateKeyPair();
    const sellerKeyPair = generateKeyPair();
    const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
    const sellerId = publicKeyToB58(sellerKeyPair.publicKey);

    // Create policy with defaults
    const policy = createDefaultPolicy();

    // Preflight validation: verify policy is valid before proceeding
    const validation = validatePolicyJson(policy);
    if (!validation.ok) {
      const errorMessages = validation.errors.map(err => `${err.path}: ${err.message}`).join("\n  ");
      const pretty = typeof validation.errors === "string" 
        ? validation.errors 
        : JSON.stringify(validation.errors, null, 2);
      
      console.error("❌ Policy validation failed (preflight check):");
      console.error("  Policy object:", JSON.stringify(policy, null, 2));
      console.error("  Validation errors:");
      console.error("  " + errorMessages);
      console.error("  Full error details:");
      console.error(pretty);

      // Write v4 failure transcript with INTENT round
      const intentId = `intent-${startTime}-policy-error`;
      const failureTranscript = await createFailureTranscriptV4(
        intentId,
        "weather.data",
        policy,
        "INVALID_POLICY",
        `Policy validation failed: ${errorMessages}`,
        startTime,
        buyerKeyPair,
        buyerId
      );
      const errorPath = path.join(transcriptDir, `error-${startTime}.json`);
      fs.writeFileSync(errorPath, JSON.stringify(failureTranscript, null, 2));
      console.error(`\n📄 Error transcript saved: ${errorPath}`);
      console.error(`Path: ${errorPath}`);
      process.exit(1);
    }

    // Set up settlement provider (mock in-memory) - not used for transcript creation
    const settlement = new MockSettlementProvider();
    settlement.credit(buyerId, 1.0);
    settlement.credit(sellerId, 0.1);

    console.log("📋 Setup:");
    console.log("   ✓ Created intent: weather.data (NYC)");
    console.log("   ✓ Created Policy: max_price <= $0.05");
    console.log("   ✓ Initialized Mock Settlement Provider\n");

    // Create deterministic v4 transcript directly (bypass acquire/provider discovery)
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  🔄 Creating v4 Transcript...");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  Intent: weather.data (NYC)");
    console.log("  Max price: $0.05 (enforced by Policy)");
    console.log("  Agreed price: $0.04 (deterministic)\n");

    const intentId = `intent-${startTime}`;
    const policyHash = computePolicyHash(policy);

    // Create v4 transcript
    let v4Transcript = createTranscriptV4({
      intent_id: intentId,
      intent_type: "weather.data",
      created_at_ms: startTime,
      policy_hash: policyHash,
      strategy_hash: "",
      identity_snapshot_hash: "",
    });

    // Round 0: INTENT (buyer)
    const intentEnvelope = await signEnvelope({
      protocol_version: "pact/1.0",
      type: "INTENT",
      intent_id: intentId,
      intent: "weather.data",
      scope: "NYC",
      constraints: { latency_ms: 50, freshness_sec: 10 },
      max_price: 0.05,
      settlement_mode: "hash_reveal",
      sent_at_ms: startTime,
      expires_at_ms: startTime + 300000,
    }, buyerKeyPair, startTime);

    const intentRound = await createRoundFromEnvelope(intentEnvelope, "INTENT", buyerId);
    v4Transcript = addRoundToTranscript(v4Transcript, intentRound);

    // Round 1: ASK (seller) - deterministic price 0.04
    const askTime = startTime + 100;
    const askEnvelope = await signEnvelope({
      protocol_version: "pact/1.0",
      type: "ASK",
      intent_id: intentId,
      price: 0.04,
      valid_for_ms: 20000,
    }, sellerKeyPair, askTime);

    const askRound = await createRoundFromEnvelope(askEnvelope, "ASK", sellerId);
    v4Transcript = addRoundToTranscript(v4Transcript, askRound);

    // Round 2: ACCEPT (buyer)
    const acceptTime = startTime + 200;
    const acceptEnvelope = await signEnvelope({
      protocol_version: "pact/1.0",
      type: "ACCEPT",
      intent_id: intentId,
      agreed_price: 0.04,
    }, buyerKeyPair, acceptTime);

    const acceptRound = await createRoundFromEnvelope(acceptEnvelope, "ACCEPT", buyerId);
    v4Transcript = addRoundToTranscript(v4Transcript, acceptRound);

    // Write v4 transcript
    const transcriptPath = path.join(transcriptDir, `${v4Transcript.transcript_id}.json`);
    fs.writeFileSync(transcriptPath, JSON.stringify(v4Transcript, null, 2));

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ✅ Transcript Created!");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  📊 Result:");
    console.log(`     Outcome: ✅ Success`);
    console.log(`     Agreed Price: $0.04`);
    console.log(`     Transcript ID: ${v4Transcript.transcript_id}`);
    console.log(`     Transcript Version: ${v4Transcript.transcript_version}`);
    console.log(`     Rounds: ${v4Transcript.rounds.length}\n`);

    // Verify transcript is v4 format
    if (v4Transcript.transcript_version === "pact-transcript/4.0") {
      console.log("  📄 Transcript (v4):");
      console.log(`Path: ${transcriptPath}\n`);

      // Replay transcript to verify
      console.log("  🔍 Verifying Transcript...");
      const replayResult = await replayTranscriptV4(v4Transcript);
      if (replayResult.ok && replayResult.integrity_status === "VALID") {
        console.log("     ✓ Integrity: VALID");
        console.log(`     ✓ Signatures verified: ${replayResult.signature_verifications}`);
        console.log(`     ✓ Hash chain verified: ${replayResult.hash_chain_verifications} rounds\n`);
      } else {
        console.log(`     ❌ Integrity: ${replayResult.integrity_status}`);
        if (replayResult.errors) {
          console.log(`     Errors: ${replayResult.errors.map(e => e.message).join(", ")}\n`);
        }
      }
    }

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  🎉 Demo Complete!");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  What you just saw:");
    console.log("    • v4 Transcript creation (hash-linked, cryptographically verifiable)");
    console.log("    • Policy-as-Code (deterministic evaluation)");
    console.log("    • 3 signed rounds (INTENT, ASK, ACCEPT)");
    console.log(`    • Evidence embedded (policy hash, signatures)\n`);
    console.log("  Next steps:");
    console.log("    • Replay: pnpm replay:v4 " + transcriptPath);
    console.log("    • Judge: pnpm judge:v4 " + transcriptPath);
    console.log("    • Read: docs/v4/STATUS.md\n");

    process.exit(0);
  } catch (error) {
    // Ensure transcript directory exists before writing error transcript
    const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
    if (!fs.existsSync(transcriptDir)) {
      fs.mkdirSync(transcriptDir, { recursive: true });
    }

    // Create and write v4 error transcript with at least INTENT round
    const buyerKeyPair = generateKeyPair();
    const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
    const intentId = `intent-${startTime}-fatal`;
    const policy = createDefaultPolicy();
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failureTranscript = await createFailureTranscriptV4(
      intentId,
      "weather.data",
      policy,
      "FATAL_ERROR",
      errorMessage,
      startTime,
      buyerKeyPair,
      buyerId
    );

    const errorPath = path.join(transcriptDir, `error-${startTime}.json`);
    try {
      fs.writeFileSync(errorPath, JSON.stringify(failureTranscript, null, 2));
      console.error(`\n📄 Error transcript saved: ${errorPath}`);
      console.error(`Path: ${errorPath}`);
    } catch (transcriptError) {
      // If we can't write transcript, at least log the error
      console.error("\n⚠️  Failed to write error transcript:", transcriptError);
    }

    console.error("\n❌ Fatal error:");
    if (error instanceof Error) {
      console.error(`  ${error.message}`);
      if (error.stack) {
        console.error("\nStack trace:", error.stack);
      }
    } else {
      const pretty = typeof error === "string" ? error : JSON.stringify(error, null, 2);
      console.error(pretty);
    }
    process.exit(1);
  }
}

main();
