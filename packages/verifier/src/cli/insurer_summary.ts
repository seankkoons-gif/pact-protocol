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
import { resolve, isAbsolute, join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { TranscriptV4 } from "../util/transcript_types.js";
import { renderGCView } from "../gc_view/renderer.js";
import { resolveBlameV1 } from "../dbl/blame_resolver_v1.js";
import { stableCanonicalize } from "../util/canonical.js";
import { isAcceptedConstitutionHash } from "../util/constitution_hashes.js";
import { findConstitutionInZip } from "../verify_auditor_pack_core.js";

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
  constitution_warning?: string;
  /** Audit tier (informational only; default T1). Does not affect verification. */
  audit_tier?: "T1" | "T2" | "T3";
  audit_sla?: string;
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
  } else if (faultDomain === "INDETERMINATE_TAMPER") {
    // Tamper/integrity failure: do not penalize agent; increases scrutiny only
    delta = 0;
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
  
  if (faultDomain === "INDETERMINATE_TAMPER") {
    factors.push("INDETERMINATE_TAMPER");
  }
  
  return factors;
}

function computeSurcharges(
  riskFactors: string[],
  confidence: number,
  buyerTier?: Tier,
  providerTier?: Tier,
  hasNonStandardConstitution?: boolean
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
  
  if (riskFactors.includes("INDETERMINATE_TAMPER")) {
    surcharges.push("TAMPER_SCRUTINY");
  }
  
  if (hasNonStandardConstitution) {
    surcharges.push("NON_STANDARD_CONSTITUTION");
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
  pack?: string;
  allowNonstandard?: boolean;
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {};
  let i = 2;

  while (i < process.argv.length) {
    const arg = process.argv[i];

    if (arg === "--transcript" && i + 1 < process.argv.length) {
      args.transcript = process.argv[++i];
    } else if ((arg === "--pack" || arg === "--zip") && i + 1 < process.argv.length) {
      args.pack = process.argv[++i];
    } else if (arg === "--allow-nonstandard") {
      args.allowNonstandard = true;
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
  console.error("  pact-verifier insurer-summary --transcript <path> [--allow-nonstandard]");
  console.error("  pact-verifier insurer-summary --pack <path.zip> [--allow-nonstandard]");
  console.error("  pact-verifier insurer-summary --zip <path.zip> [--allow-nonstandard]");
  console.error("");
  console.error("Options:");
  console.error("  --transcript <path>        Path to transcript JSON file");
  console.error("  --pack <path>              Path to auditor pack ZIP file");
  console.error("  --zip <path>               Path to auditor pack ZIP file (alias for --pack)");
  console.error("  --allow-nonstandard        Allow non-standard constitution hashes (not recommended)");
  console.error("");
  console.error("Output: JSON with version insurer_summary/1.0");
}

function truncateHash(hash: string, length: number = 16): string {
  if (hash.length <= length) return hash;
  return hash.substring(0, length) + "...";
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
 * Extract and compute constitution hash from auditor pack
 */
async function computeConstitutionHashFromPack(packPath: string): Promise<string | null> {
  try {
    const resolved = isAbsolute(packPath) ? packPath : resolve(process.cwd(), packPath);
    
    if (!existsSync(resolved)) {
      return null;
    }

    const zipBuffer = readFileSync(resolved);
    const zip = await JSZip.loadAsync(zipBuffer);

    const constitutionFile = findConstitutionInZip(zip);
    if (!constitutionFile) {
      return null;
    }

    // Load constitution content and canonicalize (same method as auditor_pack_verify.ts)
    // Note: Canonicalization normalizes whitespace only - it does NOT erase semantic changes
    // Changes like "constitution/1.0" -> "constitution/1.0X" will still produce different hashes
    const constitutionContent = await constitutionFile.async("string");
    const canonicalConstitutionContent = constitutionContent
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n");
    
    // Compute SHA-256 hash of canonicalized constitution (matches expected hash computation)
    return sha256(canonicalConstitutionContent);
  } catch {
    return null;
  }
}

/**
 * Load transcript from either a JSON file or an auditor pack ZIP
 */
async function loadTranscriptOrPack(inputPath: string): Promise<{ transcript: TranscriptV4; constitutionHash?: string }> {
  const resolved = isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);
  
  if (!existsSync(resolved)) {
    console.error(`Error: Input file not found: ${resolved}`);
    process.exit(1);
  }

  // Check if it's a ZIP file (auditor pack)
  if (extname(resolved).toLowerCase() === ".zip" || resolved.toLowerCase().endsWith(".zip")) {
    try {
      const zipBuffer = readFileSync(resolved);
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const transcriptFile = zip.file("input/transcript.json");
      if (!transcriptFile) {
        console.error("Error: Auditor pack missing input/transcript.json");
        process.exit(1);
      }

      const transcriptContent = await transcriptFile.async("string");
      const transcript = JSON.parse(transcriptContent) as TranscriptV4;
      
      // Compute constitution hash from pack
      const constitutionHash = await computeConstitutionHashFromPack(resolved);
      
      return { transcript, constitutionHash: constitutionHash || undefined };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error reading auditor pack: ${message}`);
      process.exit(1);
    }
  }

  // Otherwise, treat as transcript JSON
  try {
    const content = readFileSync(resolved, "utf-8");
    const transcript = JSON.parse(content) as TranscriptV4;
    return { transcript };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error reading transcript: ${message}`);
    process.exit(1);
  }
}

export async function main(): Promise<void> {
  const args = parseArgs();

  const inputPath = args.pack || args.transcript;
  if (!inputPath) {
    printUsage();
    process.exit(1);
  }

  // Load transcript (and constitution hash if from pack)
  const { transcript, constitutionHash: packConstitutionHash } = await loadTranscriptOrPack(inputPath);
  
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
  let confidence = judgment.confidence;
  
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
  
  // Check constitution hash
  // If we have a pack hash (from --zip/--pack), use it; otherwise use the hash from GC View
  // For transcript-only mode, we cannot verify constitution from pack, so set warning
  const constitutionHash = packConstitutionHash || gcView.constitution.hash;
  const isStandardConstitution = packConstitutionHash ? isAcceptedConstitutionHash(packConstitutionHash) : null;
  const canVerifyConstitution = packConstitutionHash !== undefined;
  
  // Compute risk factors and surcharges
  const riskFactors = computeRiskFactors(outcome, faultDomain, hasDoubleCommit, integrityValid);

  // Informational audit tier (only when present in transcript; does not affect verification)
  const auditTier = transcript.metadata?.audit_tier as "T1" | "T2" | "T3" | undefined;
  if (auditTier === "T2") riskFactors.push("TIER_T2");
  if (auditTier === "T3") riskFactors.push("TIER_T3");
  
  // Handle constitution verification
  let constitutionWarning: string | undefined;
  const hasNonStandardConstitution = isStandardConstitution === false;
  
  if (!canVerifyConstitution) {
    // Transcript-only mode: cannot verify constitution from pack
    constitutionWarning = "UNVERIFIABLE (transcript-only mode)";
  } else if (hasNonStandardConstitution) {
    // Pack mode: constitution hash is non-standard
    riskFactors.push("NON_STANDARD_RULES");
    constitutionWarning = "Verifier detected non-standard constitution rules";
  }
  
  const surcharges = computeSurcharges(riskFactors, confidence, buyerInfo?.tier, providerInfo?.tier, hasNonStandardConstitution);
  
  // CRITICAL: Non-standard constitution hash forces EXCLUDED coverage unless --allow-nonstandard
  // Also set confidence to 0 if non-standard (unless flag is set)
  if (hasNonStandardConstitution && !args.allowNonstandard) {
    confidence = 0;
  }
  
  // Determine coverage
  let coverage = determineCoverage(riskFactors, surcharges, buyerInfo?.tier, providerInfo?.tier);
  
  // CRITICAL: Non-standard constitution hash forces EXCLUDED coverage unless --allow-nonstandard
  if (hasNonStandardConstitution && !args.allowNonstandard) {
    coverage = "EXCLUDED";
  }
  
  // Build output
  const output: InsurerSummary = {
    version: "insurer_summary/1.0",
    constitution_hash: truncateHash(constitutionHash),
    integrity: integrityStatus,
    outcome,
    fault_domain: faultDomain,
    confidence,
    risk_factors: riskFactors,
    surcharges,
    coverage,
  };
  if (auditTier != null) output.audit_tier = auditTier;
  if (transcript.metadata?.audit_sla != null) output.audit_sla = transcript.metadata.audit_sla as string;
  
  // Add constitution warning if present
  if (constitutionWarning) {
    output.constitution_warning = constitutionWarning;
  }
  
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
