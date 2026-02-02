/**
 * Shared verification helpers (no Node deps). Used by CLI and verify_auditor_pack_core.
 */

import type { TranscriptV4 } from "./util/transcript_types.js";
import type { GCView } from "./gc_view/renderer.js";
import type { JudgmentArtifact } from "./dbl/blame_resolver_v1.js";

type ArtifactKind = "gc_view" | "judgment" | "insurer_summary";

function extractDeterministicGcView(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const deterministicFields = [
    "version", "constitution", "gc_takeaways", "subject", "executive_summary",
    "integrity", "policy", "responsibility", "responsibility_trace", "evidence_index", "timeline",
  ];
  for (const field of deterministicFields) {
    if (field in obj) result[field] = obj[field];
  }
  if (obj.chain_of_custody && typeof obj.chain_of_custody === "object") {
    const coc = { ...(obj.chain_of_custody as Record<string, unknown>) };
    delete coc.evidence_bundle_hash;
    result.chain_of_custody = coc;
  }
  return result;
}

function extractDeterministicJudgment(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const deterministicFields = [
    "version", "status", "failureCode", "lastValidRound", "lastValidSummary", "lastValidHash",
    "requiredNextActor", "requiredAction", "terminal", "dblDetermination", "passportImpact",
    "confidence", "recommendation", "evidenceRefs", "claimedEvidenceRefs", "notes", "recommendedActions",
  ];
  for (const field of deterministicFields) {
    if (field in obj && obj[field] !== undefined) result[field] = obj[field];
  }
  return result;
}

export function stripNondeterministic(obj: Record<string, unknown>, kind: ArtifactKind): Record<string, unknown> {
  const normalized = JSON.parse(JSON.stringify(obj));
  if (kind === "gc_view") return extractDeterministicGcView(normalized);
  if (kind === "judgment") return extractDeterministicJudgment(normalized);
  if (kind === "insurer_summary") {
    const result = { ...normalized };
    delete result.generated_from;
    delete result.created_at_ms;
    delete result.issued_at_ms;
    delete result.tool_version;
    return result;
  }
  return normalized;
}

export async function generateInsurerSummary(
  transcript: TranscriptV4,
  gcView: GCView,
  judgment: JudgmentArtifact
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
    if (outcome === "COMPLETED" || outcome.includes("SUCCESS")) return 0.01;
    if (faultDomain === "NO_FAULT") return 0.01;
    if (faultDomain === "INDETERMINATE_TAMPER") return 0;
    if (isProvider && (faultDomain === "PROVIDER_AT_FAULT" || faultDomain === "PROVIDER_RAIL_AT_FAULT")) return -0.05;
    if (!isProvider && (faultDomain === "BUYER_AT_FAULT" || faultDomain === "BUYER_RAIL_AT_FAULT")) return -0.05;
    return 0;
  }
  const signers = extractSigners(transcript);
  const outcome = gcView.executive_summary.status;
  const faultDomain = gcView.responsibility.judgment.fault_domain ?? "NO_FAULT";
  const confidence = judgment.confidence;
  const buyerScore = computePassportScoreDelta(faultDomain, outcome, false);
  const providerScore = computePassportScoreDelta(faultDomain, outcome, true);
  const riskFactors: string[] = [];
  const surcharges: string[] = [];
  if (outcome.includes("FAILED") || outcome.includes("TIMEOUT")) riskFactors.push(outcome);
  if (faultDomain !== "NO_FAULT") riskFactors.push(faultDomain);
  if (confidence < 0.7) surcharges.push("LOW_CONFIDENCE");
  const auditTier = transcript.metadata?.audit_tier as "T1" | "T2" | "T3" | undefined;
  if (auditTier === "T2") riskFactors.push("TIER_T2");
  if (auditTier === "T3") riskFactors.push("TIER_T3");
  const buyerTier = tierFromPassport(buyerScore);
  const providerTier = tierFromPassport(providerScore);
  let coverage: "COVERED" | "COVERED_WITH_SURCHARGE" | "ESCROW_REQUIRED" | "EXCLUDED" = "COVERED";
  if (gcView.integrity.hash_chain === "INVALID") coverage = "EXCLUDED";
  else if (buyerTier === "C" || providerTier === "C") coverage = "ESCROW_REQUIRED";
  else if (surcharges.length > 0 || buyerTier === "B" || providerTier === "B") coverage = "COVERED_WITH_SURCHARGE";
  const result: Record<string, unknown> = {
    version: "insurer_summary/1.0",
    constitution_hash: gcView.constitution.hash.substring(0, 16) + "...",
    integrity: gcView.integrity.hash_chain === "VALID" ? "VALID" : "INVALID",
    outcome,
    fault_domain: faultDomain,
    confidence,
    buyer: signers.buyer ? { signer: signers.buyer.substring(0, 12) + "...", passport_score: buyerScore, tier: buyerTier } : null,
    provider: signers.provider ? { signer: signers.provider.substring(0, 12) + "...", passport_score: providerScore, tier: providerTier } : null,
    risk_factors: riskFactors,
    surcharges,
    coverage,
  };
  if (auditTier != null) result.audit_tier = auditTier;
  if (transcript.metadata?.audit_sla != null) result.audit_sla = transcript.metadata.audit_sla;
  return result;
}
