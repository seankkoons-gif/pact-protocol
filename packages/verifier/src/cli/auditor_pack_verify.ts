#!/usr/bin/env node
/**
 * Auditor Pack Verification CLI
 *
 * Verifies the integrity and correctness of an auditor pack ZIP.
 *
 * Usage:
 *   pact-verifier auditor-pack-verify --zip <path.zip> [--out <report.json>]
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { renderGCView } from "../gc_view/renderer.js";
import { resolveBlameV1 } from "../dbl/blame_resolver_v1.js";
import type { TranscriptV4 } from "../util/transcript_types.js";
import { stableCanonicalize } from "../util/canonical.js";

// Version constants
const PACKAGE_VERSION = "auditor_pack_verify/1.0";
const VERIFIER_VERSION = "0.2.0";

// EPIPE handler for pipe safety
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

interface VerifyArgs {
  zip?: string;
  out?: string;
}

interface VerifyReport {
  version: string;
  ok: boolean;
  checksums_ok: boolean;
  recompute_ok: boolean;
  mismatches: string[];
  tool_version: string;
}

function parseArgs(): VerifyArgs {
  const args: VerifyArgs = {};
  let i = 2;
  while (i < process.argv.length) {
    const arg = process.argv[i];
    if (arg === "--zip" && i + 1 < process.argv.length) {
      args.zip = process.argv[++i];
    } else if (arg === "--out" && i + 1 < process.argv.length) {
      args.out = process.argv[++i];
    }
    i++;
  }
  return args;
}

function printUsage(): void {
  console.error("Usage: pact-verifier auditor-pack-verify --zip <path.zip> [--out <report.json>]");
  console.error("");
  console.error("Options:");
  console.error("  --zip <path>    Path to auditor pack ZIP file (required)");
  console.error("  --out <path>    Optional path to write verification report");
  console.error("");
  console.error("Examples:");
  console.error("  pact-verifier auditor-pack-verify --zip evidence.zip");
  console.error("  pact-verifier auditor-pack-verify --zip evidence.zip --out report.json");
}

function sha256(content: string | Buffer): string {
  const hash = createHash("sha256");
  if (typeof content === "string") {
    hash.update(content, "utf8");
  } else {
    hash.update(content);
  }
  return hash.digest("hex");
}

/**
 * Artifact types for stripping non-deterministic fields
 */
type ArtifactKind = "gc_view" | "judgment" | "insurer_summary";

/**
 * Extract only deterministic fields from gc_view for comparison.
 * Uses an allowlist approach to ensure only truly deterministic fields are compared.
 */
function extractDeterministicGcView(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  // Copy only deterministic top-level fields
  const deterministicFields = [
    "version",
    "constitution",
    "gc_takeaways",
    "subject",
    "executive_summary",
    "integrity",
    "policy",
    "responsibility",
    "responsibility_trace",
    "evidence_index",
    "timeline",
  ];
  
  for (const field of deterministicFields) {
    if (field in obj) {
      result[field] = obj[field];
    }
  }
  
  // Strip chain_of_custody.evidence_bundle_hash (path-derived)
  if (obj.chain_of_custody && typeof obj.chain_of_custody === "object") {
    const coc = { ...(obj.chain_of_custody as Record<string, unknown>) };
    delete coc.evidence_bundle_hash;
    result.chain_of_custody = coc;
  }
  
  // Note: appendix is intentionally NOT included (contains paths and tool versions)
  
  return result;
}

/**
 * Extract only deterministic fields from judgment for comparison.
 */
function extractDeterministicJudgment(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  const deterministicFields = [
    "version",
    "status",
    "failureCode",
    "lastValidRound",
    "lastValidSummary",
    "lastValidHash",
    "requiredNextActor",
    "requiredAction",
    "terminal",
    "dblDetermination",
    "passportImpact",
    "confidence",
    "recommendation",
    "evidenceRefs",
    "claimedEvidenceRefs",
    "notes",
    "recommendedActions",
  ];
  
  for (const field of deterministicFields) {
    if (field in obj && obj[field] !== undefined) {
      result[field] = obj[field];
    }
  }
  
  return result;
}

/**
 * Strip non-deterministic fields from an artifact before comparison.
 * Each artifact type has specific fields that may vary between runs.
 * 
 * Uses JSON.parse(JSON.stringify()) to normalize the object first,
 * which removes undefined values and ensures consistent structure.
 */
function stripNondeterministic(obj: Record<string, unknown>, kind: ArtifactKind): Record<string, unknown> {
  // Deep clone via JSON to normalize (removes undefined, converts to plain object)
  const normalized = JSON.parse(JSON.stringify(obj));

  if (kind === "gc_view") {
    return extractDeterministicGcView(normalized);
  }

  if (kind === "judgment") {
    return extractDeterministicJudgment(normalized);
  }

  if (kind === "insurer_summary") {
    // For insurer_summary, strip common non-deterministic fields
    const result = { ...normalized };
    delete result.generated_from;
    delete result.created_at_ms;
    delete result.issued_at_ms;
    delete result.tool_version;
    return result;
  }

  return normalized;
}

/**
 * Required files in the auditor pack
 */
const REQUIRED_FILES = [
  "checksums.sha256",
  "manifest.json",
  "input/transcript.json",
  "derived/gc_view.json",
  "derived/judgment.json",
  "derived/insurer_summary.json",
  "constitution/CONSTITUTION_v1.md",
];

/**
 * Generate insurer summary (simplified inline version - same as auditor_pack.ts)
 */
async function generateInsurerSummary(
  transcript: TranscriptV4,
  gcView: Awaited<ReturnType<typeof renderGCView>>,
  judgment: Awaited<ReturnType<typeof resolveBlameV1>>
): Promise<Record<string, unknown>> {
  type Tier = "A" | "B" | "C";

  function tierFromPassport(score: number): Tier {
    if (score >= 0.20) return "A";
    if (score >= -0.10) return "B";
    return "C";
  }

  function extractSigners(t: TranscriptV4): { buyer: string | null; provider: string | null } {
    const intentRound = t.rounds.find((r) => r.round_type === "INTENT");
    const buyerKey = intentRound?.signature?.signer_public_key_b58 || intentRound?.public_key_b58 || null;

    const providerRound = t.rounds.find((r) => {
      const roundKey = r.signature?.signer_public_key_b58 || r.public_key_b58;
      return roundKey && roundKey !== buyerKey &&
        (r.round_type === "ASK" || r.round_type === "COUNTER" || r.round_type === "ACCEPT");
    });
    const providerKey = providerRound?.signature?.signer_public_key_b58 || providerRound?.public_key_b58 || null;

    return { buyer: buyerKey, provider: providerKey };
  }

  function computePassportScoreDelta(faultDomain: string, outcome: string, isProvider: boolean): number {
    if (outcome === "COMPLETED" || outcome.includes("SUCCESS")) {
      return 0.01;
    }
    if (faultDomain === "NO_FAULT") {
      return 0.01;
    }
    if (isProvider && (faultDomain === "PROVIDER_AT_FAULT" || faultDomain === "PROVIDER_RAIL_AT_FAULT")) {
      return -0.05;
    }
    if (!isProvider && (faultDomain === "BUYER_AT_FAULT" || faultDomain === "BUYER_RAIL_AT_FAULT")) {
      return -0.05;
    }
    return 0;
  }

  const signers = extractSigners(transcript);
  const outcome = gcView.executive_summary.status;
  const faultDomain = gcView.responsibility.judgment.fault_domain;
  const confidence = judgment.confidence;

  const buyerScore = computePassportScoreDelta(faultDomain, outcome, false);
  const providerScore = computePassportScoreDelta(faultDomain, outcome, true);

  const riskFactors: string[] = [];
  const surcharges: string[] = [];

  if (outcome.includes("FAILED") || outcome.includes("TIMEOUT")) {
    riskFactors.push(outcome);
  }
  if (faultDomain !== "NO_FAULT") {
    riskFactors.push(faultDomain);
  }
  if (confidence < 0.7) {
    surcharges.push("LOW_CONFIDENCE");
  }

  const buyerTier = tierFromPassport(buyerScore);
  const providerTier = tierFromPassport(providerScore);

  let coverage: "COVERED" | "COVERED_WITH_SURCHARGE" | "ESCROW_REQUIRED" | "EXCLUDED" = "COVERED";
  if (gcView.integrity.hash_chain === "INVALID") {
    coverage = "EXCLUDED";
  } else if (buyerTier === "C" || providerTier === "C") {
    coverage = "ESCROW_REQUIRED";
  } else if (surcharges.length > 0 || buyerTier === "B" || providerTier === "B") {
    coverage = "COVERED_WITH_SURCHARGE";
  }

  return {
    version: "insurer_summary/1.0",
    constitution_hash: gcView.constitution.hash.substring(0, 16) + "...",
    integrity: gcView.integrity.hash_chain === "VALID" ? "VALID" : "INVALID",
    outcome,
    fault_domain: faultDomain,
    confidence,
    buyer: signers.buyer ? {
      signer: signers.buyer.substring(0, 12) + "...",
      passport_score: buyerScore,
      tier: buyerTier,
    } : null,
    provider: signers.provider ? {
      signer: signers.provider.substring(0, 12) + "...",
      passport_score: providerScore,
      tier: providerTier,
    } : null,
    risk_factors: riskFactors,
    surcharges,
    coverage,
  };
}

/**
 * Main entry point
 */
export async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.zip) {
    printUsage();
    process.exit(1);
  }

  const report: VerifyReport = {
    version: PACKAGE_VERSION,
    ok: false,
    checksums_ok: false,
    recompute_ok: false,
    mismatches: [],
    tool_version: `@pact/verifier ${VERIFIER_VERSION}`,
  };

  let tempDir: string | null = null;

  try {
    // Resolve zip path
    const zipPath = isAbsolute(args.zip) ? args.zip : resolve(process.cwd(), args.zip);

    if (!existsSync(zipPath)) {
      report.mismatches.push(`ZIP file not found: ${args.zip}`);
      outputReport(report, args.out);
      process.exit(1);
    }

    // Load and extract ZIP
    const zipBuffer = readFileSync(zipPath);
    const zip = await JSZip.loadAsync(zipBuffer);

    // Create temp directory
    tempDir = mkdtempSync(join(tmpdir(), "auditor-pack-verify-"));

    // Check required files exist
    const missingFiles: string[] = [];
    for (const requiredFile of REQUIRED_FILES) {
      if (!zip.file(requiredFile)) {
        missingFiles.push(requiredFile);
      }
    }

    if (missingFiles.length > 0) {
      report.mismatches.push(`Missing required files: ${missingFiles.join(", ")}`);
      outputReport(report, args.out);
      process.exit(1);
    }

    // Verify checksums
    const checksumsContent = await zip.file("checksums.sha256")!.async("string");
    const checksumLines = checksumsContent.trim().split("\n");
    const checksumMismatches: string[] = [];

    for (const line of checksumLines) {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
      if (!match) {
        checksumMismatches.push(`Invalid checksum line: ${line}`);
        continue;
      }

      const [, expectedHash, relativePath] = match;
      const file = zip.file(relativePath);

      if (!file) {
        checksumMismatches.push(`File in checksums not found in ZIP: ${relativePath}`);
        continue;
      }

      const fileContent = await file.async("nodebuffer");
      const actualHash = sha256(fileContent);

      if (actualHash !== expectedHash) {
        checksumMismatches.push(`Checksum mismatch for ${relativePath}: expected ${expectedHash.substring(0, 16)}..., got ${actualHash.substring(0, 16)}...`);
      }
    }

    report.checksums_ok = checksumMismatches.length === 0;
    if (!report.checksums_ok) {
      report.mismatches.push(...checksumMismatches);
    }

    // Recompute derived artifacts
    const transcriptContent = await zip.file("input/transcript.json")!.async("string");
    const transcript: TranscriptV4 = JSON.parse(transcriptContent);

    const recomputeMismatches: string[] = [];

    // Recompute gc_view
    const recomputedGcView = await renderGCView(transcript);
    const originalGcViewContent = await zip.file("derived/gc_view.json")!.async("string");

    // Strip non-deterministic fields and compare by canonical hash
    const strippedRecomputedGcView = stripNondeterministic(recomputedGcView as Record<string, unknown>, "gc_view");
    const strippedOriginalGcView = stripNondeterministic(JSON.parse(originalGcViewContent), "gc_view");

    const recomputedGcViewCanonical = stableCanonicalize(strippedRecomputedGcView);
    const originalGcViewCanonical = stableCanonicalize(strippedOriginalGcView);
    const recomputedGcViewHash = sha256(recomputedGcViewCanonical);
    const originalGcViewHash = sha256(originalGcViewCanonical);

    if (recomputedGcViewHash !== originalGcViewHash) {
      recomputeMismatches.push(`derived/gc_view.json mismatch after canonicalization (recomputed: ${recomputedGcViewHash.substring(0, 16)}..., original: ${originalGcViewHash.substring(0, 16)}...)`);
    }

    // Recompute judgment
    const recomputedJudgment = await resolveBlameV1(transcript);
    const originalJudgmentContent = await zip.file("derived/judgment.json")!.async("string");

    const strippedRecomputedJudgment = stripNondeterministic(recomputedJudgment as unknown as Record<string, unknown>, "judgment");
    const strippedOriginalJudgment = stripNondeterministic(JSON.parse(originalJudgmentContent), "judgment");

    const recomputedJudgmentCanonical = stableCanonicalize(strippedRecomputedJudgment);
    const originalJudgmentCanonical = stableCanonicalize(strippedOriginalJudgment);
    const recomputedJudgmentHash = sha256(recomputedJudgmentCanonical);
    const originalJudgmentHash = sha256(originalJudgmentCanonical);

    if (recomputedJudgmentHash !== originalJudgmentHash) {
      recomputeMismatches.push(`derived/judgment.json mismatch after canonicalization (recomputed: ${recomputedJudgmentHash.substring(0, 16)}..., original: ${originalJudgmentHash.substring(0, 16)}...)`);
    }

    // Recompute insurer_summary
    const recomputedInsurerSummary = await generateInsurerSummary(transcript, recomputedGcView, recomputedJudgment);
    const originalInsurerSummaryContent = await zip.file("derived/insurer_summary.json")!.async("string");

    const strippedRecomputedInsurerSummary = stripNondeterministic(recomputedInsurerSummary, "insurer_summary");
    const strippedOriginalInsurerSummary = stripNondeterministic(JSON.parse(originalInsurerSummaryContent), "insurer_summary");

    const recomputedInsurerSummaryCanonical = stableCanonicalize(strippedRecomputedInsurerSummary);
    const originalInsurerSummaryCanonical = stableCanonicalize(strippedOriginalInsurerSummary);
    const recomputedInsurerSummaryHash = sha256(recomputedInsurerSummaryCanonical);
    const originalInsurerSummaryHash = sha256(originalInsurerSummaryCanonical);

    if (recomputedInsurerSummaryHash !== originalInsurerSummaryHash) {
      recomputeMismatches.push(`derived/insurer_summary.json mismatch after canonicalization (recomputed: ${recomputedInsurerSummaryHash.substring(0, 16)}..., original: ${originalInsurerSummaryHash.substring(0, 16)}...)`);
    }

    report.recompute_ok = recomputeMismatches.length === 0;
    if (!report.recompute_ok) {
      report.mismatches.push(...recomputeMismatches);
    }

    // Final verdict
    report.ok = report.checksums_ok && report.recompute_ok;

    // Output report
    outputReport(report, args.out);

    // Exit with appropriate code
    process.exit(report.ok ? 0 : 1);

  } catch (error) {
    report.mismatches.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
    outputReport(report, args.out);
    process.exit(1);
  } finally {
    // Cleanup temp directory
    if (tempDir && existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

function outputReport(report: VerifyReport, outPath?: string): void {
  const reportJson = JSON.stringify(report, null, 2);

  // Always output to stdout
  console.log(reportJson);

  // Optionally write to file
  if (outPath) {
    const resolvedPath = isAbsolute(outPath) ? outPath : resolve(process.cwd(), outPath);
    writeFileSync(resolvedPath, reportJson);
    console.error(`Report written to: ${resolvedPath}`);
  }
}

main();
