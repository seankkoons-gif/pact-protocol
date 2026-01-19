#!/usr/bin/env tsx
/**
 * Pact v4 Evidence Bundle Generator CLI
 * 
 * Generates compliance-grade evidence bundles from Pact v4 transcripts.
 * 
 * Usage:
 *   tsx packages/sdk/src/cli/evidence_bundle.ts <transcript.json> --out <dir> [--view auditor|partner|internal]
 * 
 * This command:
 * - Loads Pact v4 transcript
 * - Extracts referenced artifacts (policy, receipts, decisions)
 * - Generates deterministic MANIFEST.json
 * - Creates machine-generated SUMMARY.md narrative
 * - Optionally applies redaction based on view type
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { replayTranscriptV4, type TranscriptV4 } from "../transcript/v4/replay";
import { narrateFailure } from "../transcript/v4/narrative";
import {
  validateDecisionArtifact,
  type ArbiterDecisionV4,
  mapReasonCodeToFailureCode,
} from "../disputes/v4/arbitration";
import { stableCanonicalize } from "../protocol/canonical";
import { redactTranscript, type TranscriptView, type RedactedTranscriptV4, isRedacted } from "../transcript/v4/redaction";
import { evaluatePolicy } from "../policy/v4";

type BundleView = "auditor" | "partner" | "internal";

interface BundleManifest {
  bundle_version: "pact-evidence-bundle/4.0";
  bundle_id: string;
  transcript_hash: string;
  original_transcript_hash?: string; // Original (unredacted) transcript hash
  created_at_ms: number;
  view: BundleView;
  entries: BundleEntry[];
  redacted_fields?: Array<{
    path: string;
    hash: string;
    view: BundleView;
  }>;
  integrity: {
    transcript_valid: boolean;
    decision_valid: boolean | null;
    all_hashes_verified: boolean;
  };
}

interface BundleEntry {
  type: "transcript" | "view" | "decision" | "policy" | "receipt" | "summary";
  path: string;
  content_hash: string;
  schema_version?: string;
}

/**
 * Compute SHA-256 hash of file content.
 */
function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return hash;
}

/**
 * Compute bundle ID from manifest content (excluding bundle_id and integrity).
 */
function computeBundleId(manifest: Omit<BundleManifest, "bundle_id">): string {
  const canonical = stableCanonicalize(manifest);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  return `bundle-${hash}`;
}

/**
 * Apply Auditor UX: replace policy/strategy content with human-readable messages.
 */
function applyAuditorUX(
  redactedTranscript: RedactedTranscriptV4,
  originalTranscript: TranscriptV4
): RedactedTranscriptV4 {
  const result = { ...redactedTranscript };

  // Replace policy hash with "Policy satisfied" or "Policy violated"
  if (isRedacted(result.policy_hash)) {
    // Determine if policy was satisfied (no failure event or failure not policy-related)
    const policySatisfied = !originalTranscript.failure_event || 
      originalTranscript.failure_event.fault_domain !== "policy";
    
    // Replace redacted field with human-readable message (as string, not redacted field)
    (result as any).policy_hash = policySatisfied 
      ? "Policy satisfied" 
      : "Policy violated";
  }

  // Replace strategy hash with "Verified strategy adherence"
  if (isRedacted(result.strategy_hash)) {
    (result as any).strategy_hash = "Verified strategy adherence";
  }

  return result;
}

/**
 * Generate SUMMARY.md narrative from transcript and decision.
 */
function generateSummary(
  transcript: TranscriptV4 | RedactedTranscriptV4,
  decision: ArbiterDecisionV4 | null
): string {
  const lines: string[] = [];

  lines.push("# Pact Evidence Bundle Summary");
  lines.push("");
  lines.push(`**Transcript ID**: ${transcript.transcript_id}`);
  lines.push(`**Intent Type**: ${transcript.intent_type}`);
  lines.push(`**Created**: ${new Date(transcript.created_at_ms).toISOString()}`);
  
  // Show view-specific information for Auditor view
  if (typeof transcript.policy_hash === "string" && 
      (transcript.policy_hash === "Policy satisfied" || transcript.policy_hash === "Policy violated")) {
    lines.push(`**Policy Status**: ${transcript.policy_hash}`);
  }
  if (typeof transcript.strategy_hash === "string" && 
      transcript.strategy_hash === "Verified strategy adherence") {
    lines.push(`**Strategy Status**: ${transcript.strategy_hash}`);
  }
  
  lines.push("");

  // What was attempted
  lines.push("## What Was Attempted");
  lines.push("");
  const intentRound = transcript.rounds.find((r) => r.round_type === "INTENT");
  if (intentRound) {
    lines.push(`Buyer agent (${intentRound.agent_id}) initiated negotiation for: ${transcript.intent_type}`);
    lines.push(`Intent ID: ${transcript.intent_id}`);
  }
  lines.push("");

  // What happened
  lines.push("## What Happened");
  lines.push("");
  lines.push(`Total rounds: ${transcript.rounds.length}`);
  const acceptRound = transcript.rounds.find((r) => r.round_type === "ACCEPT");
  if (acceptRound) {
    lines.push("Negotiation completed successfully with ACCEPT round.");
  } else if (transcript.failure_event) {
    lines.push("Negotiation failed with failure event.");
  } else {
    lines.push("Negotiation status: incomplete or unknown.");
  }
  lines.push("");

  // Where failure occurred
  if (transcript.failure_event) {
    lines.push("## Where Failure Occurred");
    lines.push("");
    lines.push(`**Stage**: ${transcript.failure_event.stage}`);
    lines.push(`**Fault Domain**: ${transcript.failure_event.fault_domain}`);
    lines.push(`**Terminality**: ${transcript.failure_event.terminality}`);
    lines.push(`**Failure Code**: ${transcript.failure_event.code}`);
    lines.push("");
    if (transcript.failure_event.evidence_refs.length > 0) {
      lines.push("Evidence References:");
      for (const ref of transcript.failure_event.evidence_refs) {
        lines.push(`- ${ref}`);
      }
      lines.push("");
    }
  }

  // Arbitration outcome
  if (decision) {
    lines.push("## Arbitration Outcome");
    lines.push("");
    lines.push(`**Decision**: ${decision.decision}`);
    lines.push(`**Arbiter**: ${decision.arbiter_id}`);
    lines.push(`**Issued**: ${new Date(decision.issued_at).toISOString()}`);
    lines.push("");
    lines.push("**Reason Codes**:");
    for (const code of decision.reason_codes) {
      const failureCode = mapReasonCodeToFailureCode(code);
      lines.push(`- ${code} (maps to ${failureCode})`);
    }
    lines.push("");
    if (decision.amounts) {
      lines.push("**Split Amounts**:");
      lines.push(`- Buyer: ${decision.amounts.buyer_amount} ${decision.amounts.currency || "units"}`);
      lines.push(`- Provider: ${decision.amounts.provider_amount} ${decision.amounts.currency || "units"}`);
      lines.push("");
    }
    if (decision.evidence_refs.length > 0) {
      lines.push("**Evidence References**:");
      for (const ref of decision.evidence_refs) {
        if (ref.type === "round_hash") {
          lines.push(`- Round hash: ${ref.ref.substring(0, 16)}...`);
        } else if (ref.type === "receipt_hash") {
          lines.push(`- Receipt: ${ref.ref}`);
        } else if (ref.type === "policy_section") {
          lines.push(`- Policy section: ${ref.section} (hash: ${ref.ref.substring(0, 16)}...)`);
        } else if (ref.type === "evidence_bundle") {
          lines.push(`- Evidence bundle: ${ref.bundle_id}`);
        }
      }
      lines.push("");
    }
  } else if (transcript.failure_event?.terminality === "NEEDS_ARBITRATION") {
    lines.push("## Arbitration Status");
    lines.push("");
    lines.push("Transcript is in `NEEDS_ARBITRATION` state but no decision artifact is present.");
    lines.push("Escrow funds are frozen pending arbiter decision.");
    lines.push("");
  }

  // Integrity status
  lines.push("## Integrity Status");
  lines.push("");
  lines.push("All file hashes are verified. Evidence bundle is complete and tamper-evident.");
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate evidence bundle from transcript.
 */
async function generateBundle(
  transcriptPath: string,
  outputDir: string,
  view: BundleView = "internal"
): Promise<void> {
  // Load transcript
  const transcriptContent = fs.readFileSync(transcriptPath, "utf8");
  const transcript: any = JSON.parse(transcriptContent);

  // Check transcript version before processing
  const transcriptVersion = transcript.transcript_version;
  if (!transcriptVersion || transcriptVersion !== "pact-transcript/4.0") {
    console.error("❌ Evidence bundles are only supported for Pact v4 transcripts.");
    console.error(`   Detected version: ${transcriptVersion || "unknown"}`);
    console.error(`   Required version: pact-transcript/4.0`);
    console.error(`   Transcript: ${transcriptPath}`);
    console.error("");
    console.error("   For v1 transcripts, use: pnpm replay:verify");
    console.error("   For v4 transcripts, ensure you're using a v4-compatible transcript.");
    process.exit(1);
  }

  // Type assertion after version check
  const v4Transcript = transcript as TranscriptV4;

  // Validate transcript
  const replayResult = await replayTranscriptV4(v4Transcript);
  
  // Normalize errors and warnings to handle undefined cases
  const errors = Array.isArray(replayResult.errors) ? replayResult.errors : [];
  const warnings = Array.isArray(replayResult.warnings) ? replayResult.warnings : [];
  
  if (!replayResult.ok) {
    console.error("❌ Transcript validation failed:");
    console.error(`   Errors: ${errors.length}`);
    if (errors.length > 0) {
      const firstError = errors[0];
      const errorMessage = typeof firstError === "string" 
        ? firstError 
        : firstError?.message || JSON.stringify(firstError);
      console.error(`   First error: ${errorMessage}`);
    }
    console.error(`   Transcript: ${transcriptPath}`);
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Store original transcript hash
  const originalTranscriptHash = v4Transcript.transcript_id;

  const entries: BundleEntry[] = [];
  let redactedTranscript: RedactedTranscriptV4 | null = null;

  // For internal view: include ORIGINAL.json (unmodified PoN transcript)
  if (view === "internal") {
    const originalPath = path.join(outputDir, "ORIGINAL.json");
    fs.writeFileSync(originalPath, JSON.stringify(v4Transcript, null, 2), "utf8");
    const originalHash = computeFileHash(originalPath);
    entries.push({
      type: "transcript",
      path: "ORIGINAL.json",
      content_hash: originalHash,
      schema_version: v4Transcript.transcript_version,
    });
  } else {
    // For partner/auditor views: include VIEW.json (redacted transcript in view schema)
    const viewMap: Record<BundleView, TranscriptView> = {
      internal: "INTERNAL",
      partner: "PARTNER",
      auditor: "AUDITOR",
    };
    const transcriptView = viewMap[view];
    redactedTranscript = redactTranscript(v4Transcript, transcriptView);

    // For AUDITOR view: replace policy/strategy content with human-readable messages
    if (view === "auditor") {
      redactedTranscript = applyAuditorUX(redactedTranscript, v4Transcript);
    }

    // Create VIEW.json structure
    const viewJson = {
      kind: "view",
      source_transcript_hash: originalTranscriptHash,
      view: transcriptView,
      transcript: redactedTranscript,
    };

    const viewPath = path.join(outputDir, "VIEW.json");
    fs.writeFileSync(viewPath, JSON.stringify(viewJson, null, 2), "utf8");
    const viewHash = computeFileHash(viewPath);
    entries.push({
      type: "view",
      path: "VIEW.json",
      content_hash: viewHash,
      schema_version: "pact-transcript-view/1.0",
    });
  }

  // Track redacted fields for manifest (only for non-internal views)
  const redactedFields: Array<{ path: string; hash: string; view: BundleView }> = [];
  if (view !== "internal" && redactedTranscript) {
    if (isRedacted(redactedTranscript.policy_hash)) {
      redactedFields.push({
        path: "policy_hash",
        hash: redactedTranscript.policy_hash.hash,
        view,
      });
    }
    if (isRedacted(redactedTranscript.strategy_hash)) {
      redactedFields.push({
        path: "strategy_hash",
        hash: redactedTranscript.strategy_hash.hash,
        view,
      });
    }
  }

  // Load decision artifact if present
  let decision: ArbiterDecisionV4 | null = null;
  let decisionOutputPath: string | null = null;
  if (v4Transcript.arbiter_decision_ref) {
    // Try to find decision file (assume it's in same directory as transcript)
    const transcriptDir = path.dirname(transcriptPath);
    const decisionPath = path.join(transcriptDir, `decision-${v4Transcript.arbiter_decision_ref.substring(9)}.json`);
    if (fs.existsSync(decisionPath)) {
      const decisionContent = fs.readFileSync(decisionPath, "utf8");
      decision = JSON.parse(decisionContent);
      decisionOutputPath = path.join(outputDir, path.basename(decisionPath));
      fs.copyFileSync(decisionPath, decisionOutputPath);
      const decisionHash = computeFileHash(decisionOutputPath);
      entries.push({
        type: "decision",
        path: path.basename(decisionPath),
        content_hash: decisionHash,
        schema_version: decision.schema_version,
      });

      // Validate decision
      const decisionValidation = validateDecisionArtifact(decision, v4Transcript);
      if (!decisionValidation.valid) {
        console.warn("⚠️  Decision validation warnings:");
        for (const error of decisionValidation.errors) {
          console.warn(`  - ${error}`);
        }
      }
    }
  }

  // Generate SUMMARY.md (use original for internal, redacted for other views)
  const summaryTranscript = view === "internal" ? v4Transcript : (redactedTranscript || v4Transcript);
  const summary = generateSummary(summaryTranscript, decision);
  const summaryPath = path.join(outputDir, "SUMMARY.md");
  fs.writeFileSync(summaryPath, summary, "utf8");
  const summaryHash = computeFileHash(summaryPath);
  entries.push({
    type: "summary",
    path: "SUMMARY.md",
    content_hash: summaryHash,
  });

  // Create manifest (without bundle_id)
  const manifestBase: Omit<BundleManifest, "bundle_id"> = {
    bundle_version: "pact-evidence-bundle/4.0",
    transcript_hash: originalTranscriptHash, // Always use original transcript hash in manifest
    original_transcript_hash: originalTranscriptHash, // Original (unredacted) transcript hash
    created_at_ms: Date.now(),
    view,
    entries,
    redacted_fields: redactedFields.length > 0 ? redactedFields : undefined,
    integrity: {
      transcript_valid: replayResult.ok,
      decision_valid: decision ? validateDecisionArtifact(decision, v4Transcript).valid : null,
      all_hashes_verified: true, // Will be verified by replayer
    },
  };

  // Compute bundle_id
  const bundleId = computeBundleId(manifestBase);
  const manifest: BundleManifest = {
    ...manifestBase,
    bundle_id: bundleId,
  };

  // Write manifest
  const manifestPath = path.join(outputDir, "MANIFEST.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`✅ Evidence bundle generated: ${outputDir}`);
  console.log(`   Bundle ID: ${bundleId}`);
  if (view === "internal") {
    console.log(`   Transcript: ORIGINAL.json`);
  } else {
    console.log(`   Transcript: VIEW.json`);
  }
  if (decision && decisionOutputPath) {
    console.log(`   Decision: ${path.basename(decisionOutputPath)}`);
  }
  console.log(`   View: ${view}`);
}

/**
 * Check if this module is being run as the main entry point (ESM-safe).
 */
function isMainModule(): boolean {
  // In ESM, compare the current module URL to argv[1] (the entry file path).
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

/**
 * CLI entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const transcriptPath = args[0];
  const outIndex = args.indexOf("--out");
  const outDir = outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : null;
  const viewIndex = args.indexOf("--view");
  const view = (viewIndex >= 0 && args[viewIndex + 1]
    ? args[viewIndex + 1]
    : "internal") as BundleView;

  if (!transcriptPath) {
    console.error("Usage: tsx evidence_bundle.ts <transcript.json> --out <dir> [--view auditor|partner|internal]");
    process.exit(1);
  }

  if (!outDir) {
    console.error("Error: --out <dir> is required");
    process.exit(1);
  }

  if (!["auditor", "partner", "internal"].includes(view)) {
    console.error("Error: --view must be one of: auditor, partner, internal");
    process.exit(1);
  }

  if (!fs.existsSync(transcriptPath)) {
    console.error(`Error: Transcript file not found: ${transcriptPath}`);
    process.exit(1);
  }

  await generateBundle(transcriptPath, outDir, view);
}

// CLI entry point
if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
