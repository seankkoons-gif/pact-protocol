#!/usr/bin/env node
/**
 * Insurer Summary CLI
 * 
 * Generates a deterministic underwriter-focused summary from a v4 transcript.
 * Combines GC View, DBL judgment, passport data, and contention detection.
 * 
 * Usage:
 *   pact-verifier insurer-summary --transcript <path>
 * 
 * Output: JSON with version "insurer_summary/1.0"
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, isAbsolute, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { TranscriptV4 } from "../util/transcript_types.js";
import { renderGCView } from "../gc_view/renderer.js";
import { resolveBlameV1 } from "../dbl/blame_resolver_v1.js";
import { stableCanonicalize } from "../util/canonical.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../..");

// EPIPE handler for pipe safety
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

// ============================================================================
// Types
// ============================================================================

type Tier = "A" | "B" | "C";
type CoverageDecision = "COVERED" | "COVERED_WITH_SURCHARGE" | "ESCROW_REQUIRED" | "EXCLUDED";

interface SignerInfo {
  signer: string;
  passport_score: number;
  tier: Tier;
}

interface InsurerSummary {
  version: "insurer_summary/1.0";
  constitution_hash: string;
  integrity: string;
  outcome: string;
  fault_domain: string;
  confidence: number;
  buyer?: SignerInfo;
  provider?: SignerInfo;
  risk_factors: string[];
  surcharges: string[];
  coverage: CoverageDecision;
}

// ============================================================================
// Tier Logic (deterministic)
// ============================================================================

function tierFromPassport(score: number): Tier {
  if (score >= 0.20) return "A";
  if (score >= -0.10) return "B";
  return "C";
}

// ============================================================================
// Signer Extraction
// ============================================================================

interface ExtractedSigners {
  buyer?: { signer: string; role: string };
  provider?: { signer: string; role: string };
}

function extractSigners(transcript: TranscriptV4): ExtractedSigners {
  const result: ExtractedSigners = {};
  
  for (const round of transcript.rounds) {
    const signerKey = round.signature?.signer_public_key_b58 || round.public_key_b58;
    if (!signerKey) continue;
    
    const role = round.agent_id?.toLowerCase() || "";
    
    if ((role === "buyer" || round.round_type === "INTENT") && !result.buyer) {
      result.buyer = { signer: signerKey, role: "buyer" };
    } else if ((role === "seller" || role === "provider" || round.round_type === "ASK") && !result.provider) {
      result.provider = { signer: signerKey, role: "provider" };
    }
  }
  
  return result;
}

// ============================================================================
// Passport Score Computation (single transcript context)
// ============================================================================

/**
 * Compute passport score from a single transcript.
 * 
 * For single transcript context, we compute the delta this transaction would apply.
 * In production with history, this would be cumulative score.
 * 
 * Delta rules (simplified):
 * - Success (NO_FAULT): +0.01
 * - Provider at fault: -0.05 for provider, +0.01 for buyer
 * - Buyer at fault: -0.05 for buyer, neutral for provider
 * - Policy abort: -0.02 for buyer
 * - SLA violation: -0.03
 */
function computePassportDelta(
  faultDomain: string,
  outcome: string,
  isProvider: boolean
): number {
  // Base score starts at 0 for single transcript
  let delta = 0;
  
  if (faultDomain === "NO_FAULT") {
    // Success: both parties gain slightly
    delta = 0.01;
  } else if (faultDomain === "PROVIDER_AT_FAULT") {
    delta = isProvider ? -0.05 : 0.01;
  } else if (faultDomain === "BUYER_AT_FAULT") {
    delta = isProvider ? 0.0 : -0.05;
  } else if (outcome.includes("POLICY") || outcome === "ABORTED_POLICY") {
    // Policy abort: buyer takes small hit
    delta = isProvider ? 0.0 : -0.02;
  } else if (outcome.includes("TIMEOUT")) {
    // SLA violation
    delta = -0.03;
  }
  
  return delta;
}

// ============================================================================
// Contention Detection (single transcript)
// ============================================================================

/**
 * Check if transcript indicates a DOUBLE_COMMIT scenario.
 * 
 * For single transcript context, we check:
 * - failure_event.code === "PACT-331"
 * - Or if contention is indicated in evidence_refs
 */
function detectDoubleCommit(transcript: TranscriptV4): boolean {
  if (transcript.failure_event?.code === "PACT-331") {
    return true;
  }
  
  // Check evidence refs for contention indicators
  const evidenceRefs = transcript.failure_event?.evidence_refs || [];
  for (const ref of evidenceRefs) {
    if (typeof ref === "string" && ref.toLowerCase().includes("double")) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// Integrity Status
// ============================================================================

function determineIntegrityStatus(gcView: Awaited<ReturnType<typeof renderGCView>>): string {
  const integrity = gcView.integrity;
  
  if (integrity.hash_chain !== "VALID") {
    return "INVALID";
  }
  
  if (integrity.signatures_verified.verified !== integrity.signatures_verified.total) {
    return "INVALID";
  }
  
  return "VALID";
}

// ============================================================================
// Risk Factors & Surcharges
// ============================================================================

function computeRiskFactors(
  outcome: string,
  faultDomain: string,
  hasDoubleCommit: boolean,
  integrityValid: boolean
): string[] {
  const factors: string[] = [];
  
  if (!integrityValid) {
    factors.push("INTEGRITY_FAILURE");
  }
  
  if (hasDoubleCommit) {
    factors.push("DOUBLE_COMMIT");
  }
  
  if (outcome === "FAILED_PROVIDER_UNREACHABLE") {
    factors.push("PROVIDER_UNREACHABLE");
  }
  
  if (outcome === "FAILED_PROVIDER_API_MISMATCH") {
    factors.push("PROVIDER_API_MISMATCH");
  }
  
  if (outcome === "FAILED_TIMEOUT") {
    factors.push("SLA_TIMEOUT");
  }
  
  if (faultDomain === "PROVIDER_AT_FAULT") {
    factors.push("PROVIDER_FAULT");
  }
  
  if (faultDomain === "BUYER_AT_FAULT") {
    factors.push("BUYER_FAULT");
  }
  
  return factors;
}

function computeSurcharges(
  riskFactors: string[],
  confidence: number,
  buyerTier?: Tier,
  providerTier?: Tier
): string[] {
  const surcharges: string[] = [];
  
  if (riskFactors.includes("PROVIDER_UNREACHABLE")) {
    surcharges.push("PROVIDER_OPS");
  }
  
  if (riskFactors.includes("PROVIDER_API_MISMATCH")) {
    surcharges.push("INTEGRATION");
  }
  
  if (riskFactors.includes("SLA_TIMEOUT")) {
    surcharges.push("SLA");
  }
  
  if (confidence < 0.7) {
    surcharges.push("LOW_CONFIDENCE_50PCT");
  } else if (confidence < 0.9) {
    surcharges.push("REDUCED_CONFIDENCE_25PCT");
  }
  
  if (buyerTier === "B" || providerTier === "B") {
    surcharges.push("TIER_B_PARTY");
  }
  
  return surcharges;
}

// ============================================================================
// Coverage Decision
// ============================================================================

function determineCoverage(
  riskFactors: string[],
  surcharges: string[],
  buyerTier?: Tier,
  providerTier?: Tier
): CoverageDecision {
  // Exclusions (hard stops)
  if (riskFactors.includes("INTEGRITY_FAILURE")) {
    return "EXCLUDED";
  }
  
  if (riskFactors.includes("DOUBLE_COMMIT")) {
    return "EXCLUDED";
  }
  
  // Tier C requires escrow or exclusion
  if (buyerTier === "C" || providerTier === "C") {
    return "ESCROW_REQUIRED";
  }
  
  // Surcharges present
  if (surcharges.length > 0) {
    return "COVERED_WITH_SURCHARGE";
  }
  
  return "COVERED";
}

// ============================================================================
// CLI
// ============================================================================

interface ParsedArgs {
  transcript?: string;
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {};
  let i = 2;

  while (i < process.argv.length) {
    const arg = process.argv[i];

    if (arg === "--transcript" && i + 1 < process.argv.length) {
      args.transcript = process.argv[++i];
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
    i++;
  }

  return args;
}

function printUsage(): void {
  console.error("Insurer Summary - Underwriter-focused transcript analysis");
  console.error("");
  console.error("Usage:");
  console.error("  pact-verifier insurer-summary --transcript <path>");
  console.error("");
  console.error("Output: JSON with version insurer_summary/1.0");
}

function loadTranscript(transcriptPath: string): TranscriptV4 {
  const resolved = isAbsolute(transcriptPath) ? transcriptPath : resolve(process.cwd(), transcriptPath);
  
  if (!existsSync(resolved)) {
    console.error(`Error: Transcript file not found: ${resolved}`);
    process.exit(1);
  }

  try {
    const content = readFileSync(resolved, "utf-8");
    return JSON.parse(content) as TranscriptV4;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error reading transcript: ${message}`);
    process.exit(1);
  }
}

function truncateHash(hash: string, length: number = 16): string {
  if (hash.length <= length) return hash;
  return hash.substring(0, length) + "...";
}

export async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.transcript) {
    printUsage();
    process.exit(1);
  }

  const transcript = loadTranscript(args.transcript);
  
  // Run GC View
  const gcView = await renderGCView(transcript);
  
  // Run DBL judgment
  const judgment = await resolveBlameV1(transcript);
  
  // Extract signers
  const signers = extractSigners(transcript);
  
  // Determine integrity
  const integrityStatus = determineIntegrityStatus(gcView);
  const integrityValid = integrityStatus === "VALID";
  
  // Get outcome and fault domain
  const outcome = gcView.executive_summary.status;
  const faultDomain = judgment.dblDetermination;
  const confidence = judgment.confidence;
  
  // Detect DOUBLE_COMMIT
  const hasDoubleCommit = detectDoubleCommit(transcript);
  
  // Compute passport scores and tiers (single transcript context)
  let buyerInfo: SignerInfo | undefined;
  let providerInfo: SignerInfo | undefined;
  
  if (signers.buyer) {
    const score = computePassportDelta(faultDomain, outcome, false);
    buyerInfo = {
      signer: truncateHash(signers.buyer.signer, 12),
      passport_score: score,
      tier: tierFromPassport(score),
    };
  }
  
  if (signers.provider) {
    const score = computePassportDelta(faultDomain, outcome, true);
    providerInfo = {
      signer: truncateHash(signers.provider.signer, 12),
      passport_score: score,
      tier: tierFromPassport(score),
    };
  }
  
  // Compute risk factors and surcharges
  const riskFactors = computeRiskFactors(outcome, faultDomain, hasDoubleCommit, integrityValid);
  const surcharges = computeSurcharges(riskFactors, confidence, buyerInfo?.tier, providerInfo?.tier);
  
  // Determine coverage
  const coverage = determineCoverage(riskFactors, surcharges, buyerInfo?.tier, providerInfo?.tier);
  
  // Build output
  const output: InsurerSummary = {
    version: "insurer_summary/1.0",
    constitution_hash: truncateHash(gcView.constitution.hash),
    integrity: integrityStatus,
    outcome,
    fault_domain: faultDomain,
    confidence,
    risk_factors: riskFactors,
    surcharges,
    coverage,
  };
  
  if (buyerInfo) {
    output.buyer = buyerInfo;
  }
  
  if (providerInfo) {
    output.provider = providerInfo;
  }
  
  // Output JSON only
  console.log(JSON.stringify(output, null, 2));
}

// Check if running as main module (direct invocation)
// Works for both ESM and tsx/ts-node
const isMainModule = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith("insurer_summary.ts") ||
  process.argv[1].endsWith("insurer_summary.js")
);

if (isMainModule) {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
