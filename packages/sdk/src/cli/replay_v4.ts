#!/usr/bin/env tsx
/**
 * PACT v4 Transcript Replayer CLI
 * 
 * Validates signatures, verifies hash chains, and renders human-readable output.
 * 
 * Usage:
 *   pnpm replay:v4 <transcript.json>
 *   tsx packages/sdk/src/cli/replay_v4.ts <transcript.json>
 * 
 * This command:
 * - Validates all cryptographic signatures
 * - Verifies transcript hash chain
 * - Renders scrubbable timeline of negotiation rounds
 * - Displays failure events if present
 * - Provides narrative view (plain English)
 * - Shows critical integrity indicator (RED if tampered)
 * - Produces deterministic output (same input → same output)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { replayTranscriptV4, type TranscriptV4 } from "../transcript/v4/replay";
import { narrateRound, narrateFailure } from "../transcript/v4/narrative";
import {
  validateDecisionArtifact,
  mapReasonCodeToFailureCode,
  type ArbiterDecisionV4,
} from "../disputes/v4/arbitration";
import { isRedacted, type RedactedTranscriptV4 } from "../transcript/v4/redaction";

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

function renderIntegrityIndicator(status: "VALID" | "TAMPERED" | "INVALID"): string {
  switch (status) {
    case "VALID":
      return "🟢 INTEGRITY VALID";
    case "TAMPERED":
      return "🔴 INTEGRITY COMPROMISED - TRANSCRIPT HAS BEEN TAMPERED";
    case "INVALID":
      return "🔴 INTEGRITY INVALID - TRANSCRIPT STRUCTURE IS INVALID";
  }
}

function renderTimeline(transcript: TranscriptV4): void {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Timeline of Negotiation Rounds");
  console.log("═══════════════════════════════════════════════════════════\n");

  for (let i = 0; i < transcript.rounds.length; i++) {
    const round = transcript.rounds[i];
    const elapsed = i > 0 ? round.timestamp_ms - transcript.rounds[0].timestamp_ms : 0;
    
    console.log(`Round ${round.round_number} [${round.round_type}]`);
    console.log(`  Time: ${formatTimestamp(round.timestamp_ms)} (${formatDuration(elapsed)} elapsed)`);
    console.log(`  Agent: ${round.agent_id}`);
    console.log(`  Previous Hash: ${round.previous_round_hash.substring(0, 16)}...`);
    if (round.round_hash) {
      console.log(`  Round Hash: ${round.round_hash.substring(0, 16)}...`);
    }
    console.log("");
  }
}

function renderFailureEvent(failure: TranscriptV4["failure_event"]): void {
  if (!failure) return;

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Failure Event");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log(`Code: ${failure.code}`);
  console.log(`Stage: ${failure.stage}`);
  console.log(`Fault Domain: ${failure.fault_domain}`);
  console.log(`Terminality: ${failure.terminality}`);
  console.log(`Timestamp: ${formatTimestamp(failure.timestamp)}`);
  console.log(`Transcript Hash: ${failure.transcript_hash.substring(0, 16)}...`);
  console.log("");

  if (failure.evidence_refs.length > 0) {
    console.log("Evidence References:");
    for (const ref of failure.evidence_refs) {
      console.log(`  - ${ref}`);
    }
    console.log("");
  }
}

function renderNarrativeView(transcript: TranscriptV4): void {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Narrative View");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Narrate each round
  for (const round of transcript.rounds) {
    const narrative = narrateRound(round);
    console.log(`Round ${narrative.round_number}: ${narrative.narrative}`);
  }

  // Narrate failure event if present
  if (transcript.failure_event) {
    console.log("");
    const failureNarrative = narrateFailure(transcript.failure_event);
    console.log(`Failure: ${failureNarrative.narrative}`);
  }

  console.log("");
}

/**
 * Load and validate evidence bundle (Courtroom Mode).
 */
function loadEvidenceBundle(bundleDir: string): {
  transcript: TranscriptV4 | RedactedTranscriptV4;
  decision: ArbiterDecisionV4 | null;
  manifest: any;
  integrity: "PASS" | "FAIL";
  errors: string[];
  view?: string;
  redactedFields?: Array<{ path: string; hash: string }>;
} {
  const manifestPath = path.join(bundleDir, "MANIFEST.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`MANIFEST.json not found in bundle directory: ${bundleDir}`);
  }

  const manifestContent = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestContent);

  const errors: string[] = [];
  let integrity: "PASS" | "FAIL" = "PASS";

  // Load transcript
  const transcriptEntry = manifest.entries.find((e: any) => e.type === "transcript");
  if (!transcriptEntry) {
    throw new Error("Transcript entry not found in manifest");
  }

  const transcriptPath = path.join(bundleDir, transcriptEntry.path);
  const transcriptContent = fs.readFileSync(transcriptPath, "utf-8");
  const transcript: TranscriptV4 | RedactedTranscriptV4 = JSON.parse(transcriptContent);
  
  // Detect redaction
  const view = manifest.view;
  const redactedFields = manifest.redacted_fields || [];

  // Verify transcript hash
  const transcriptHash = crypto.createHash("sha256").update(transcriptContent, "utf8").digest("hex");
  if (transcriptHash !== transcriptEntry.content_hash) {
    integrity = "FAIL";
    errors.push(`Transcript hash mismatch: expected ${transcriptEntry.content_hash}, got ${transcriptHash}`);
  }

  // Load decision if present
  let decision: ArbiterDecisionV4 | null = null;
  const decisionEntry = manifest.entries.find((e: any) => e.type === "decision");
  if (decisionEntry) {
    const decisionPath = path.join(bundleDir, decisionEntry.path);
    const decisionContent = fs.readFileSync(decisionPath, "utf-8");
    decision = JSON.parse(decisionContent);

    // Verify decision hash
    const decisionHash = crypto.createHash("sha256").update(decisionContent, "utf8").digest("hex");
    if (decisionHash !== decisionEntry.content_hash) {
      integrity = "FAIL";
      errors.push(`Decision hash mismatch: expected ${decisionEntry.content_hash}, got ${decisionHash}`);
    }
  }

  // Verify all entry hashes
  for (const entry of manifest.entries) {
    const entryPath = path.join(bundleDir, entry.path);
    if (!fs.existsSync(entryPath)) {
      integrity = "FAIL";
      errors.push(`Entry file not found: ${entry.path}`);
      continue;
    }

    const entryContent = fs.readFileSync(entryPath, "utf8");
    const entryHash = crypto.createHash("sha256").update(entryContent, "utf8").digest("hex");
    if (entryHash !== entry.content_hash) {
      integrity = "FAIL";
      errors.push(`Entry hash mismatch for ${entry.path}: expected ${entry.content_hash}, got ${entryHash}`);
    }
  }

  return { transcript, decision, manifest, integrity, errors, view, redactedFields };
}

/**
 * Render arbitration outcome in Courtroom Mode.
 */
function renderArbitrationOutcome(
  transcript: TranscriptV4,
  decision: ArbiterDecisionV4 | null,
  mapReasonCodeToFailureCode: (code: string) => string
): void {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Arbitration Outcome");
  console.log("═══════════════════════════════════════════════════════════\n");

  if (decision) {
    console.log(`Decision: ${decision.decision}`);
    console.log(`Arbiter: ${decision.arbiter_id}`);
    console.log(`Issued: ${formatTimestamp(decision.issued_at)}\n`);

    console.log("Reason Codes (Failure Taxonomy Mapping):");
    for (const code of decision.reason_codes) {
      const failureCode = mapReasonCodeToFailureCode(code);
      console.log(`  - ${code} → ${failureCode}`);
    }
    console.log("");

    if (decision.amounts) {
      console.log("Split Amounts:");
      console.log(`  - Buyer: ${decision.amounts.buyer_amount} ${decision.amounts.currency || "units"}`);
      console.log(`  - Provider: ${decision.amounts.provider_amount} ${decision.amounts.currency || "units"}`);
      console.log("");
    }

    if (decision.evidence_refs.length > 0) {
      console.log("Evidence References:");
      for (const ref of decision.evidence_refs) {
        if (ref.type === "round_hash") {
          console.log(`  - Round: ${ref.ref.substring(0, 16)}...`);
        } else if (ref.type === "receipt_hash") {
          console.log(`  - Receipt: ${ref.ref}`);
        } else if (ref.type === "policy_section") {
          console.log(`  - Policy: ${ref.section} (${ref.ref.substring(0, 16)}...)`);
        } else if (ref.type === "evidence_bundle") {
          console.log(`  - Bundle: ${ref.bundle_id}`);
        }
      }
      console.log("");
    }
  } else if (transcript.failure_event?.terminality === "NEEDS_ARBITRATION") {
    console.log("Status: NEEDS_ARBITRATION");
    console.log("Escrow funds frozen pending arbiter decision.");
    console.log("");
  }
}

async function main() {
  // Get __dirname for path resolution (ESM equivalent)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: replay:v4 <transcript.json> [--bundle <dir>] [--allow-compromised]");
    console.error("");
    console.error("Examples:");
    console.error("  replay:v4 .pact/transcripts/transcript-abc123.json");
    console.error("  replay:v4 --bundle fixtures/arbitration/bundle-001");
    console.error("  replay:v4 --allow-compromised fixtures/compromised/transcript.json");
    console.error("  replay:v4 transcript.json");
    console.error("");
    console.error("Options:");
    console.error("  --allow-compromised  Allow FINAL_HASH_MISMATCH errors (for intentionally compromised fixtures)");
    console.error("                       Exit code 0 if only FINAL_HASH_MISMATCH, non-zero for other errors");
    process.exit(1);
  }
  
  // Check for flags
  const allowCompromised = args.includes("--allow-compromised");
  const bundleIndex = args.indexOf("--bundle");
  const bundleDir = bundleIndex >= 0 && args[bundleIndex + 1] ? args[bundleIndex + 1] : null;
  
  // Filter out flags to find transcript path
  const filteredArgs = args.filter((arg, i) => {
    if (arg === "--allow-compromised") return false;
    if (arg === "--bundle") return false;
    if (i > 0 && args[i - 1] === "--bundle") return false; // Skip bundle dir value
    return true;
  });
  
  let transcript: TranscriptV4;
  let decision: ArbiterDecisionV4 | null = null;
  let integrityStatus: "PASS" | "FAIL" = "PASS";
  
  if (bundleDir) {
    // Courtroom Mode: Load evidence bundle
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  PACT v4 Transcript Replayer - Courtroom Mode");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log(`Bundle: ${path.resolve(bundleDir)}\n`);
    
    try {
      const bundleResult = loadEvidenceBundle(bundleDir);
      transcript = bundleResult.transcript;
      decision = bundleResult.decision;
      integrityStatus = bundleResult.integrity;
      
      if (bundleResult.errors.length > 0) {
        console.error("❌ Bundle integrity check failed:");
        for (const error of bundleResult.errors) {
          console.error(`  - ${error}`);
        }
        integrityStatus = "FAIL";
      }
    } catch (error: any) {
      console.error(`Error loading evidence bundle: ${error.message}`);
      process.exit(1);
    }
  } else {
    // Normal mode: Load transcript directly
    let transcriptPath = filteredArgs[0];
    
    if (!transcriptPath) {
      console.error("Error: Transcript file path required");
      console.error("Usage: replay:v4 <transcript.json> [--allow-compromised]");
      process.exit(1);
    }
    
    // Resolve path: if absolute, use as-is; if relative and exists in cwd, use as-is;
    // otherwise try relative to repo root (for fixtures)
    if (!path.isAbsolute(transcriptPath)) {
      const cwdPath = path.resolve(process.cwd(), transcriptPath);
      if (!fs.existsSync(cwdPath)) {
        // Try relative to repo root (4 levels up from packages/sdk/src/cli/replay_v4.ts)
        // __dirname = packages/sdk/src/cli/ → repo root = ../../../../..
        const repoRoot = path.resolve(__dirname, "../../../..");
        const repoRootPath = path.resolve(repoRoot, transcriptPath);
        if (fs.existsSync(repoRootPath)) {
          transcriptPath = repoRootPath;
        } else {
          console.error(`Error: File not found: ${transcriptPath}`);
          console.error(`  Tried: ${cwdPath}`);
          console.error(`  Tried: ${repoRootPath}`);
          process.exit(1);
        }
      } else {
        // Exists relative to current working directory
        transcriptPath = cwdPath;
      }
    }
    
    // Final check that file exists
    if (!fs.existsSync(transcriptPath)) {
      console.error(`Error: File not found: ${transcriptPath}`);
      process.exit(1);
    }
    
    // Validate file is JSON
    if (!transcriptPath.endsWith(".json")) {
      console.error(`Error: File must be a .json file: ${transcriptPath}`);
      console.error(`Hint: Transcript files must have .json extension.`);
      process.exit(1);
    }
    
    // Load transcript
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
    
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  PACT v4 Transcript Replayer");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log(`File: ${path.resolve(transcriptPath)}\n`);
  }
  
  // Validate transcript version
  if (transcript.transcript_version !== "pact-transcript/4.0") {
    console.error(`Error: Invalid transcript version: ${transcript.transcript_version}`);
    console.error(`Hint: This tool is for Pact v4 transcripts only.`);
    process.exit(1);
  }
  
  // Basic info
  console.log("Transcript:");
  console.log(`  ID: ${transcript.transcript_id}`);
  console.log(`  Intent ID: ${transcript.intent_id}`);
  console.log(`  Intent Type: ${transcript.intent_type}`);
  console.log(`  Created: ${formatTimestamp(transcript.created_at_ms)}`);
  console.log(`  Rounds: ${transcript.rounds.length}`);
  if (transcript.failure_event) {
    console.log(`  Status: FAILED (${transcript.failure_event.code})`);
  } else {
    console.log(`  Status: ${transcript.rounds[transcript.rounds.length - 1]?.round_type === "ACCEPT" ? "COMPLETED" : "IN PROGRESS"}`);
  }
  console.log("");
  
  // Replay and verify
  console.log("Verification:");
  const replayResult = await replayTranscriptV4(transcript);
  
  // Critical integrity indicator
  console.log(`  ${renderIntegrityIndicator(replayResult.integrity_status)}\n`);
  
  if (replayResult.ok) {
    console.log(`  ✅ All signatures verified (${replayResult.signature_verifications} rounds)`);
    console.log(`  ✅ Hash chain intact (${replayResult.hash_chain_verifications} links verified)`);
    console.log(`  ✅ Transcript integrity verified`);
  } else {
    console.log(`  ❌ Verification failed:`);
    for (const error of replayResult.errors) {
      console.log(`    - ${error.type}: ${error.message}`);
    }
  }
  
  if (replayResult.warnings.length > 0) {
    console.log(`\n  Warnings:`);
    for (const warning of replayResult.warnings) {
      console.log(`    - ${warning}`);
    }
  }
  
  console.log("");
  
  // Render timeline
  renderTimeline(transcript);
  
  // Render failure event if present
  if (transcript.failure_event) {
    renderFailureEvent(transcript.failure_event);
  }
  
  // Render arbitration outcome (Courtroom Mode)
  if (bundleDir) {
    if (decision) {
      renderArbitrationOutcome(transcript, decision, mapReasonCodeToFailureCode);
    } else if (transcript.failure_event?.terminality === "NEEDS_ARBITRATION") {
      renderArbitrationOutcome(transcript, null, mapReasonCodeToFailureCode);
    }
  }
  
  // Render narrative view
  renderNarrativeView(transcript);
  
  // Summary
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Summary");
  console.log("═══════════════════════════════════════════════════════════\n");
  
  // Bundle integrity status (Courtroom Mode)
  if (bundleDir) {
    console.log(`Bundle Integrity: ${integrityStatus === "PASS" ? "🟢 PASS" : "🔴 FAIL"}`);
    console.log("");
  }
  
  console.log(`Integrity Status: ${renderIntegrityIndicator(replayResult.integrity_status)}`);
  console.log(`Rounds Verified: ${replayResult.rounds_verified}/${transcript.rounds.length}`);
  console.log(`Signatures Verified: ${replayResult.signature_verifications}`);
  console.log(`Hash Chain Links Verified: ${replayResult.hash_chain_verifications}`);
  if (transcript.failure_event) {
    console.log(`Failure Code: ${transcript.failure_event.code}`);
    console.log(`Fault Domain: ${transcript.failure_event.fault_domain}`);
    console.log(`Stage: ${transcript.failure_event.stage}`);
  }
  if (decision) {
    console.log(`Arbitration Decision: ${decision.decision}`);
    console.log(`Decision Failure Mapping: ${decision.reason_codes.map((c) => mapReasonCodeToFailureCode(c)).join(", ")}`);
  }
  console.log("");
  
  // Exit with appropriate code
  let exitCode: number;
  if (replayResult.ok && integrityStatus === "PASS") {
    exitCode = 0;
  } else if (allowCompromised) {
    // With --allow-compromised, only FINAL_HASH_MISMATCH is acceptable
    const hasOnlyFinalHashMismatch = replayResult.errors.length === 1 &&
      replayResult.errors[0].type === "FINAL_HASH_MISMATCH" &&
      replayResult.rounds_verified > 0; // Rounds must be valid
    
    if (hasOnlyFinalHashMismatch) {
      console.log("⚠️  FINAL_HASH_MISMATCH detected (allowed by --allow-compromised flag)");
      console.log("   Rounds verified: signed rounds are valid, container hash mismatched");
      console.log("");
      exitCode = 0;
    } else {
      // Other errors or no valid rounds = still fail
      exitCode = 1;
    }
  } else {
    // Default: any integrity issue = fail
    exitCode = 1;
  }
  
  process.exit(exitCode);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
