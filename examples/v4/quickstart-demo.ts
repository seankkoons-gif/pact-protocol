#!/usr/bin/env tsx
/**
 * PACT v4 Quickstart Demo
 * 
 * One-command demo showing v4 features:
 * - Pact Boundary Runtime (policy enforcement)
 * - v4 Transcripts (hash-linked, replayable)
 * - Policy-as-Code v4 (deterministic evaluation)
 * 
 * Run: pnpm demo:v4:canonical
 */

import { runInPactBoundary, type BoundaryIntent, type PactPolicyV4 } from "@pact/sdk";
import { replayTranscriptV4 } from "@pact/sdk";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  PACT v4 Quickstart Demo");
  console.log("  Institution-Grade Autonomous Commerce Infrastructure");
  console.log("═══════════════════════════════════════════════════════════\n");

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
    policy_id: "policy-demo-v4",
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

  console.log("📋 Setup:");
  console.log("   ✓ Created intent: weather.data (NYC)");
  console.log("   ✓ Created Policy v4: max_price <= $0.05");
  console.log("   ✓ Initialized Pact Boundary Runtime\n");

  // Ensure transcript directory exists
  const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
  if (!fs.existsSync(transcriptDir)) {
    fs.mkdirSync(transcriptDir, { recursive: true });
  }

  // Run inside Pact Boundary
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🔄 Negotiation Starting...");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log("  Intent: weather.data (NYC)");
  console.log("  Max price: $0.05 (enforced by Policy v4)");
  console.log("  Settlement: boundary (in-memory)\n");

  const result = await runInPactBoundary(intent, policy, async (context) => {
    // Simulate negotiation: buyer offers $0.04 (within policy)
    const offerPrice = 0.04;
    
    // Policy is evaluated automatically by Boundary Runtime
    // If offerPrice > 0.05, boundary would abort with PACT-101
    
    return {
      success: true,
      offer_price: offerPrice,
      bid_price: offerPrice,
      settlement_mode: "boundary",
      data: {
        temperature: 72,
        humidity: 65,
        city: "NYC",
      },
    };
  });

  // Print results
  console.log("═══════════════════════════════════════════════════════════");
  if (result.success) {
    console.log("  ✅ Negotiation Complete!");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  📊 Result:");
    console.log(`     Outcome: ✅ Success`);
    console.log(`     Agreed Price: $0.04`);
    console.log(`     Policy Hash: ${result.policy_hash.substring(0, 16)}...`);
    console.log(`     Transcript ID: ${result.transcript.transcript_id}`);
    console.log(`     Evidence Refs: ${result.evidence_refs.length}\n`);

    // Save transcript
    const transcriptPath = path.join(transcriptDir, `${result.transcript.transcript_id}.json`);
    fs.writeFileSync(transcriptPath, JSON.stringify(result.transcript, null, 2));
    console.log("  📄 Transcript:");
    console.log(`     Path: ${transcriptPath}\n`);

    // Replay transcript to verify
    console.log("  🔍 Verifying Transcript...");
    const replayResult = await replayTranscriptV4(result.transcript);
    if (replayResult.ok && replayResult.integrity_status === "VALID") {
      console.log("     ✓ Integrity: VALID");
      console.log(`     ✓ Signatures verified: ${replayResult.signature_verifications}`);
      console.log(`     ✓ Hash chain verified: ${replayResult.hash_chain_verifications} rounds\n`);
    } else {
      console.log(`     ❌ Integrity: ${replayResult.integrity_status}`);
      console.log(`     Errors: ${replayResult.errors.map(e => e.message).join(", ")}\n`);
    }

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  🎉 Demo Complete!");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  What you just saw:");
    console.log("    • Pact Boundary Runtime (non-bypassable policy enforcement)");
    console.log("    • Policy-as-Code v4 (deterministic evaluation)");
    console.log("    • v4 Transcript (hash-linked, cryptographically verifiable)");
    console.log("    • Evidence embedded (policy hash, evaluation traces)\n");
    console.log("  Next steps:");
    console.log("    • Replay: pnpm replay:v4 " + transcriptPath);
    console.log("    • Evidence bundle: pnpm evidence:bundle " + transcriptPath);
    console.log("    • Read: docs/v4/STATUS.md\n");

    process.exit(0);
  } else {
    console.log("  ❌ Negotiation Failed");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  📊 Failure Event:");
    if (result.failure_event) {
      console.log(`     Code: ${result.failure_event.code}`);
      console.log(`     Stage: ${result.failure_event.stage}`);
      console.log(`     Fault Domain: ${result.failure_event.fault_domain}`);
      console.log(`     Evidence Refs: ${result.failure_event.evidence_refs.length}\n`);
    }

    // Save transcript even on failure
    const transcriptPath = path.join(transcriptDir, `${result.transcript.transcript_id}.json`);
    fs.writeFileSync(transcriptPath, JSON.stringify(result.transcript, null, 2));
    console.log("  📄 Transcript saved (includes failure event):");
    console.log(`     Path: ${transcriptPath}\n`);

    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
