/**
 * Credit v1 Integration for Pact Boundary
 * 
 * Evaluates credit eligibility before settlement and writes evidence to transcript.
 */

import type { PassportStorage } from "@pact/passport";
import {
  computeCreditTerms,
  canExtendCredit,
  mapCreditDenialToFailureEvent,
} from "@pact/passport";
import type { CreditDecision, CreditTerms } from "@pact/passport";
import type { TranscriptV4, FailureEvent } from "../transcript/v4/replay";

/**
 * Credit evaluation context for Boundary
 */
export interface CreditEvaluationContext {
  agent_id: string;
  counterparty_id: string;
  commitment_amount_usd: number;
  passport_score: number;
  passport_confidence: number;
  as_of_ms: number;
}

/**
 * Credit evaluation result
 */
export interface CreditEvaluationResult {
  decision: CreditDecision;
  terms: CreditTerms;
  evidence_refs: string[];
  required_collateral_usd: number;
  credit_exposure_usd: number;
}

/**
 * Evaluate credit eligibility before settlement.
 * 
 * This function:
 * 1. Computes credit terms from Passport score + confidence
 * 2. Checks if credit can be extended
 * 3. Returns evidence refs for transcript embedding
 * 
 * @param storage Passport storage instance
 * @param context Credit evaluation context
 * @returns Credit evaluation result with evidence
 */
export function evaluateCreditBeforeSettlement(
  storage: PassportStorage,
  context: CreditEvaluationContext
): CreditEvaluationResult {
  const { agent_id, counterparty_id, commitment_amount_usd, passport_score, passport_confidence, as_of_ms } = context;

  // Compute credit terms
  const terms = computeCreditTerms(agent_id, storage, passport_score, passport_confidence, as_of_ms);

  // Check if credit can be extended
  const decision = canExtendCredit(
    agent_id,
    counterparty_id,
    commitment_amount_usd,
    storage,
    passport_score,
    passport_confidence,
    as_of_ms
  );

  // Compute required collateral and credit exposure
  const required_collateral_usd = decision.required_collateral_usd;
  const credit_exposure_usd = commitment_amount_usd - required_collateral_usd;

  // Get current exposure for evidence
  const exposure = storage.getCreditExposure(agent_id);
  const outstanding_usd = exposure?.outstanding_usd || 0;
  const new_outstanding_usd = outstanding_usd + (decision.allowed ? credit_exposure_usd : 0);

  // Build evidence references
  const evidence_refs: string[] = [
    `credit_tier:${agent_id}:${terms.tier}`,
    `credit_decision:${agent_id}:${decision.allowed ? "ALLOWED" : "DENIED"}`,
    `credit_required_collateral:${required_collateral_usd}`,
    `credit_exposure:${credit_exposure_usd}`,
    `credit_outstanding_after:${new_outstanding_usd}`,
    `credit_max_outstanding:${terms.max_outstanding_exposure_usd}`,
    `credit_max_per_intent:${terms.max_per_intent_usd}`,
    `credit_max_per_counterparty:${terms.max_per_counterparty_usd}`,
  ];

  // Add reason codes if denied
  if (!decision.allowed && decision.reason_codes.length > 0) {
    evidence_refs.push(...decision.reason_codes.map((code: string) => `credit_denial_reason:${code}`));
  }

  // Add kill switch info if disabled
  if (terms.disabled_until) {
    evidence_refs.push(`credit_disabled_until:${terms.disabled_until}`);
    if (terms.reason) {
      evidence_refs.push(`credit_disable_reason:${terms.reason}`);
    }
  }

  return {
    decision,
    terms,
    evidence_refs,
    required_collateral_usd,
    credit_exposure_usd,
  };
}

/**
 * Map credit denial to failure event for transcript.
 * 
 * If credit is denied, this returns a failure event that should be
 * attached to the transcript and cause an abort.
 */
export function createCreditFailureEvent(
  creditResult: CreditEvaluationResult,
  transcript: TranscriptV4,
  timestamp: number
): FailureEvent | null {
  if (creditResult.decision.allowed) {
    return null; // No failure if credit allowed
  }

  // Extract agent_id from evidence_refs (first ref contains agent_id)
  const agentIdMatch = creditResult.evidence_refs.find((ref) => ref.startsWith("credit_tier:"));
  const agentId = agentIdMatch ? agentIdMatch.split(":")[1] : "unknown";

  // Map credit denial to failure event
  const failureEvent = mapCreditDenialToFailureEvent(
    creditResult.decision,
    agentId,
    transcript.transcript_id,
    timestamp
  );

  if (!failureEvent) {
    return null;
  }

  // Merge evidence refs
  failureEvent.evidence_refs = [
    ...failureEvent.evidence_refs,
    ...creditResult.evidence_refs,
  ];

  return failureEvent;
}
