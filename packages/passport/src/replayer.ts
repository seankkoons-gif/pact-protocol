/**
 * Passport Replayer Integration
 * 
 * Provides interfaces for displaying Passport scores and policy gate triggers in transcript replays.
 */

import type { PassportStorage } from "./storage";
import { queryPassport, requirePassport, type PassportQueryResponse, type PassportPolicyResult } from "./query";
import type { TranscriptV4 } from "./types";
import { computeCreditTerms, canExtendCredit } from "./credit/riskEngine";
import type { CreditTerms, CreditDecision } from "./credit/types";

/**
 * Credit context at time of negotiation.
 */
export type CreditReplayContext = {
  /**
   * Agent ID that was checked
   */
  agent_id: string;
  
  /**
   * Credit tier at time of negotiation
   */
  tier: "A" | "B" | "C" | null;
  
  /**
   * Credit terms (limits, collateral ratio)
   */
  terms: CreditTerms | null;
  
  /**
   * Credit decision (allowed/denied)
   */
  decision: CreditDecision | null;
  
  /**
   * Required collateral amount (USD)
   */
  required_collateral_usd: number | null;
  
  /**
   * Credit exposure amount (USD)
   */
  credit_exposure_usd: number | null;
  
  /**
   * Outstanding exposure after decision
   */
  outstanding_exposure_usd: number | null;
  
  /**
   * Whether credit check was available at negotiation time
   */
  available: boolean;
  
  /**
   * Timestamp used for credit computation
   */
  computed_as_of: number;
};

/**
 * Passport context at time of negotiation.
 * This is what the Replayer displays to explain Passport-based policy gates.
 */
export type PassportReplayContext = {
  /**
   * Agent ID that was checked
   */
  agent_id: string;
  
  /**
   * Passport score at time of negotiation (as_of timestamp from transcript)
   */
  score_at_negotiation: number | null;
  
  /**
   * Confidence at time of negotiation
   */
  confidence_at_negotiation: number | null;
  
  /**
   * Whether Passport check was available at negotiation time
   */
  available: boolean;
  
  /**
   * If Passport check was performed, the policy result
   */
  policy_check?: PassportPolicyResult;
  
  /**
   * If policy check failed, the triggering factor that caused denial
   */
  triggering_factor?: string;
  
  /**
   * Timestamp used for score computation (transcript created_at_ms or negotiation time)
   */
  computed_as_of: number;
  
  /**
   * Credit context (if credit was evaluated)
   */
  credit?: CreditReplayContext;
};

/**
 * Extract Passport context from a v4 transcript.
 * 
 * This function queries Passport storage for scores at the time of negotiation
 * and determines if Passport policy gates were triggered.
 * 
 * @param storage Passport storage instance
 * @param transcript Pact v4 transcript
 * @param minScore Optional minimum score threshold (if policy was enforced)
 * @param minConfidence Optional minimum confidence threshold (if policy was enforced)
 * @returns Passport replay context for display in Replayer
 */
export function getPassportReplayContext(
  storage: PassportStorage,
  transcript: TranscriptV4,
  minScore?: number,
  minConfidence?: number
): PassportReplayContext {
  // Extract agent IDs from transcript
  const intentRound = transcript.rounds.find((r) => r.round_type === "INTENT");
  if (!intentRound) {
    // No INTENT round - can't determine agent
    return {
      agent_id: "unknown",
      score_at_negotiation: null,
      confidence_at_negotiation: null,
      available: false,
      computed_as_of: transcript.created_at_ms,
    };
  }

  // For now, check the buyer (INTENT initiator)
  // In production, would check both buyer and seller
  const agentId = intentRound.agent_id;
  const negotiationTime = transcript.created_at_ms;

  // Query Passport score at time of negotiation (using created_at_ms as as_of)
  let queryResponse: PassportQueryResponse | null = null;
  try {
    queryResponse = queryPassport(storage, agentId, negotiationTime);
  } catch {
    // Passport not available at negotiation time (agent not yet scored)
    return {
      agent_id: agentId,
      score_at_negotiation: null,
      confidence_at_negotiation: null,
      available: false,
      computed_as_of: negotiationTime,
    };
  }

  // Check if Passport was available at negotiation time (confidence > 0 indicates sufficient history)
  const wasAvailable = queryResponse.confidence > 0;

  // If policy thresholds were provided, check if they would have been met
  let policyCheck: PassportPolicyResult | undefined;
  if (minScore !== undefined) {
    policyCheck = requirePassport(storage, agentId, minScore, minConfidence, negotiationTime);
  }

  // Extract credit context from transcript evidence_refs (if present)
  let creditContext: CreditReplayContext | undefined = undefined;
  
  // Check if transcript has credit evidence (from failure_event or rounds)
  const failureEvent = transcript.failure_event;
  const hasCreditEvidence = failureEvent?.evidence_refs.some((ref) => ref.startsWith("credit_")) ||
    transcript.rounds.some((r) => r.content_summary && "credit_evidence" in r.content_summary);

  if (hasCreditEvidence && wasAvailable && queryResponse.score !== null && queryResponse.confidence !== null) {
    // Extract commitment amount from transcript (look for ACCEPT round with price)
    const acceptRound = transcript.rounds.find((r) => r.round_type === "ACCEPT");
    const commitmentAmount = acceptRound?.content_summary && typeof acceptRound.content_summary.price === "number"
      ? acceptRound.content_summary.price
      : null;

    // Extract counterparty ID (seller from first ASK/ACCEPT)
    const sellerRound = transcript.rounds.find(
      (r) => r.round_type === "ASK" || r.round_type === "ACCEPT"
    );
    const counterpartyId = sellerRound?.agent_id || null;

    if (commitmentAmount !== null && commitmentAmount > 0 && counterpartyId) {
      // Compute credit terms
      const terms = computeCreditTerms(agentId, storage, queryResponse.score, queryResponse.confidence, negotiationTime);
      
      // Check credit eligibility
      const decision = canExtendCredit(
        agentId,
        counterpartyId,
        commitmentAmount,
        storage,
        queryResponse.score,
        queryResponse.confidence,
        negotiationTime
      );

      // Get current exposure
      const exposure = storage.getCreditExposure(agentId);
      const outstanding_usd = exposure?.outstanding_usd || 0;
      const credit_exposure_usd = decision.allowed ? (commitmentAmount - decision.required_collateral_usd) : 0;
      const new_outstanding_usd = outstanding_usd + credit_exposure_usd;

      creditContext = {
        agent_id: agentId,
        tier: terms.tier,
        terms,
        decision,
        required_collateral_usd: decision.required_collateral_usd,
        credit_exposure_usd: decision.allowed ? credit_exposure_usd : 0,
        outstanding_exposure_usd: new_outstanding_usd,
        available: true,
        computed_as_of: negotiationTime,
      };
    }
  }

  return {
    agent_id: agentId,
    score_at_negotiation: wasAvailable ? queryResponse.score : null,
    confidence_at_negotiation: wasAvailable ? queryResponse.confidence : null,
    available: wasAvailable,
    policy_check: policyCheck,
    triggering_factor: policyCheck?.triggering_factor,
    computed_as_of: negotiationTime,
    credit: creditContext,
  };
}

/**
 * Generate human-readable narrative for Passport policy gate denial.
 * Used by Replayer to explain why a Passport check failed.
 * 
 * @param policyResult Policy check result
 * @returns Human-readable narrative string
 */
export function narratePassportDenial(policyResult: PassportPolicyResult): string {
  if (policyResult.pass) {
    return "Passport check passed: agent met score and confidence thresholds.";
  }

  const reason = policyResult.reason;
  const score = policyResult.score ?? 0;
  const confidence = policyResult.confidence ?? 0;
  const minScore = policyResult.min_score_required ?? 0;
  const minConfidence = policyResult.min_confidence_required;

  let narrative = "Passport policy gate denied: ";

  // Handle backward compatibility: "LOW_SCORE" maps to "SCORE_TOO_LOW"
  if (reason === "SCORE_TOO_LOW" || reason === ("LOW_SCORE" as any)) {
    narrative += `Agent score ${score.toFixed(1)} is below required minimum ${minScore}.`;
  } else {
    switch (reason) {
      case "LOW_CONFIDENCE":
        narrative += `Agent confidence ${confidence.toFixed(2)} is below required minimum ${minConfidence?.toFixed(2) ?? "unknown"}.`;
        break;
      case "INSUFFICIENT_HISTORY":
        narrative += "Agent has insufficient transaction history to compute reliable score.";
        break;
      case "DISPUTE_FLAGGED":
        narrative += "Agent has recent dispute losses that flag risk.";
        break;
      case "RECENT_POLICY_VIOLATION":
        narrative += "Agent has recent policy violations (PACT-1xx failures).";
        break;
      default:
        narrative += `Reason: ${reason}.`;
    }
  }

  if (policyResult.triggering_factor) {
    narrative += ` Triggering factor: ${policyResult.triggering_factor}.`;
  }

  return narrative;
}

/**
 * Generate human-readable narrative for credit eligibility.
 * Used by Replayer to explain credit decisions.
 * 
 * @param creditContext Credit replay context
 * @returns Human-readable narrative string
 */
export function narrateCreditDecision(creditContext: CreditReplayContext | undefined): string {
  if (!creditContext || !creditContext.available) {
    return "Credit evaluation not available at time of negotiation.";
  }

  if (!creditContext.terms || !creditContext.decision) {
    return "Credit terms or decision not available.";
  }

  const { tier, terms, decision, required_collateral_usd, credit_exposure_usd, outstanding_exposure_usd } = creditContext;

  let narrative = `Credit eligibility: `;

  if (decision.allowed) {
    narrative += `ALLOWED (Tier ${tier}). `;
    narrative += `Required collateral: $${required_collateral_usd?.toFixed(2) || "0.00"}. `;
    narrative += `Credit exposure: $${credit_exposure_usd?.toFixed(2) || "0.00"}. `;
    narrative += `Outstanding exposure after: $${outstanding_exposure_usd?.toFixed(2) || "0.00"}. `;
    narrative += `Limits: max outstanding $${terms.max_outstanding_exposure_usd}, max per intent $${terms.max_per_intent_usd}, max per counterparty $${terms.max_per_counterparty_usd}.`;
  } else {
    narrative += `DENIED (Tier ${tier}). `;
    narrative += `Required collateral: $${required_collateral_usd?.toFixed(2) || "0.00"} (100% - no credit). `;
    if (decision.reason_codes.length > 0) {
      narrative += `Reasons: ${decision.reason_codes.join(", ")}.`;
    }
    if (terms.disabled_until) {
      narrative += ` Credit disabled until ${new Date(terms.disabled_until).toISOString()}.`;
      if (terms.reason) {
        narrative += ` Reason: ${terms.reason}.`;
      }
    }
  }

  return narrative;
}
