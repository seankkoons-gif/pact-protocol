#!/usr/bin/env tsx
/**
 * PACT Replay CLI
 * 
 * Replays a transcript and prints human-readable output.
 * 
 * Usage:
 *   pnpm pact replay <transcript.json>
 *   tsx packages/sdk/src/cli/replay.ts <transcript.json>
 * 
 * This command:
 * - Never mutates state (read-only)
 * - Only reads transcript file
 * - Prints human-readable output
 * - Produces deterministic output (same transcript → same output)
 */

import * as fs from "fs";
import * as path from "path";
import { replayTranscript } from "../transcript/replay";

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: pact replay <transcript.json>");
    console.error("");
    console.error("Examples:");
    console.error("  pact replay .pact/transcripts/intent-123.json");
    console.error("  pact replay transcript.json");
    process.exit(1);
  }
  
  const transcriptPath = args[0];
  
  // Validate file exists
  if (!fs.existsSync(transcriptPath)) {
    console.error(`Error: File not found: ${transcriptPath}`);
    console.error(`Hint: Use an absolute path or a path relative to the current directory.`);
    process.exit(1);
  }
  
  // Validate file is JSON
  if (!transcriptPath.endsWith(".json")) {
    console.error(`Error: File must be a .json file: ${transcriptPath}`);
    console.error(`Hint: Transcript files must have .json extension.`);
    process.exit(1);
  }
  
  // Load and replay transcript
  let transcript: any;
  try {
    const content = fs.readFileSync(transcriptPath, "utf-8");
    transcript = JSON.parse(content);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.error(`Error: File not found: ${transcriptPath}`);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in transcript file: ${transcriptPath}`);
      console.error(`Details: ${error.message}`);
    } else {
      console.error(`Error: Failed to load transcript: ${error.message}`);
    }
    process.exit(1);
  }
  
  // Validate transcript structure
  if (!transcript.intent_id || !transcript.intent_type) {
    console.error(`Error: Invalid transcript format: missing required fields (intent_id, intent_type)`);
    console.error(`Hint: Ensure the file is a valid PACT transcript JSON file.`);
    process.exit(1);
  }
  
  console.log("=== PACT Transcript Replay ===\n");
  console.log(`File: ${path.resolve(transcriptPath)}\n`);
  
  // Basic info
  console.log("Intent:");
  console.log(`  ID: ${transcript.intent_id}`);
  console.log(`  Type: ${transcript.intent_type}`);
  console.log(`  Scope: ${transcript.input?.scope || "N/A"}`);
  console.log(`  Timestamp: ${formatTimestamp(transcript.timestamp_ms)}`);
  console.log(`  Max Price: ${transcript.input?.maxPrice || "N/A"}`);
  console.log(`  Constraints: latency=${transcript.input?.constraints?.latency_ms || "N/A"}ms, freshness=${transcript.input?.constraints?.freshness_sec || "N/A"}s`);
  console.log("");
  
  // Outcome
  console.log("Outcome:");
  if (transcript.outcome?.ok) {
    console.log(`  ✅ Success`);
  } else {
    console.log(`  ❌ Failed`);
    console.log(`  Code: ${transcript.outcome?.code || "N/A"}`);
    console.log(`  Reason: ${transcript.outcome?.reason || "N/A"}`);
  }
  console.log("");
  
  // Replay and verify
  console.log("Replay Verification:");
  const replayResult = await replayTranscript(transcriptPath);
  
  if (replayResult.ok) {
    console.log(`  ✅ Replay successful`);
  } else {
    console.log(`  ❌ Replay failed`);
    for (const failure of replayResult.failures) {
      console.log(`    - ${failure.code}: ${failure.reason}`);
    }
  }
  console.log("");
  
  // Replay summary
  const summary = replayResult.summary;
  console.log("Verification Summary:");
  console.log(`  Envelopes: ${summary.envelopes_verified} verified, ${summary.envelopes_failed} failed`);
  console.log(`  Credentials: ${summary.credentials_verified} verified, ${summary.credentials_expired} expired`);
  console.log(`  Commit-Reveal: ${summary.commit_reveal_verified} verified, ${summary.commit_reveal_failed} failed`);
  if (summary.settlement_lifecycle_verified > 0 || summary.settlement_lifecycle_failed > 0) {
    console.log(`  Settlement Lifecycle: ${summary.settlement_lifecycle_verified} verified, ${summary.settlement_lifecycle_failed} failed`);
  }
  if (summary.wallet_signatures_verified > 0 || summary.wallet_signatures_failed > 0) {
    console.log(`  Wallet Signatures: ${summary.wallet_signatures_verified} verified, ${summary.wallet_signatures_failed} failed`);
  }
  console.log("");
  
  // Negotiation
  if (transcript.negotiation) {
    console.log("Negotiation:");
    console.log(`  Strategy: ${transcript.negotiation.strategy || "N/A"}`);
    console.log(`  Rounds Used: ${transcript.negotiation.rounds_used || 0}`);
    
    if (transcript.negotiation_rounds && transcript.negotiation_rounds.length > 0) {
      console.log(`  Rounds:`);
      for (const round of transcript.negotiation_rounds) {
        const status = round.accepted ? "✅ Accepted" : "⏳ Counteroffer";
        console.log(`    Round ${round.round}: ${status}`);
        console.log(`      Ask: ${round.ask_price.toFixed(8)}, Counter: ${round.counter_price.toFixed(8)}`);
        console.log(`      Reason: ${round.reason}`);
      }
    }
    
    if (transcript.negotiation.ml) {
      console.log(`  ML Scorer: ${transcript.negotiation.ml.scorer}`);
      console.log(`  Selected Candidate: idx=${transcript.negotiation.ml.selected_candidate_idx}`);
      if (transcript.negotiation.ml.top_scores) {
        console.log(`  Top Scores:`);
        for (const score of transcript.negotiation.ml.top_scores) {
          console.log(`    idx=${score.idx}: ${score.score.toFixed(2)} ${score.reason ? `(${score.reason})` : ""}`);
        }
      }
    }
    console.log("");
  }
  
  // Receipt
  if (transcript.receipt) {
    console.log("Receipt:");
    console.log(`  ID: ${transcript.receipt.receipt_id}`);
    console.log(`  Agreed Price: ${transcript.receipt.agreed_price.toFixed(8)}`);
    console.log(`  Fulfilled: ${transcript.receipt.fulfilled ? "✅ Yes" : "❌ No"}`);
    console.log("");
  }
  
  // Settlement lifecycle
  if (transcript.settlement_lifecycle) {
    console.log("Settlement Lifecycle:");
    console.log(`  Status: ${transcript.settlement_lifecycle.status || "N/A"}`);
    console.log(`  Provider: ${transcript.settlement_lifecycle.provider || "N/A"}`);
    if (transcript.settlement_lifecycle.settlement_events) {
      console.log(`  Events: ${transcript.settlement_lifecycle.settlement_events.length}`);
      for (const event of transcript.settlement_lifecycle.settlement_events) {
        console.log(`    ${event.status} at ${formatTimestamp(event.timestamp_ms)}`);
      }
    }
    console.log("");
  }
  
  // Exit with appropriate code
  process.exit(replayResult.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
