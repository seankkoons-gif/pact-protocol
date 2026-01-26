/**
 * Passport v1 Delta Computation
 * 
 * Computes incremental passport updates (deltas) from transcript outcomes and DBL judgments.
 * Pure and deterministic: no Date.now, no randomness, no network, no FS.
 */

import type { PassportInputs, PassportDelta, TranscriptSummary, JudgmentArtifact } from "./types";

/**
 * Compute passport delta from inputs.
 * 
 * Scoring rules (simple v1; no recency decay):
 * - score in [-1, +1]
 * - On terminal "success": successful_settlements += 1; total_settlements += 1; score += +0.01
 * - On terminal "policy abort" (PACT-101): policy_aborts += 1; score += -0.01
 * - On SLA timeout/violation (PACT-404 or SLA violation event): sla_violations += 1; score += -0.02
 * - On disputes:
 *   - If judgment indicates signer is responsible (responsibility_actor matches signer key) apply judgment.passportImpact (currently -0.05) and disputes_lost += 1
 *   - If signer is exonerated (NO_FAULT or other actor) no negative applied
 *   - If signer "wins" dispute explicitly, disputes_won += 1 and score += +0.01
 * - Integrity tamper (FINAL_HASH_MISMATCH / integrity invalid):
 *   apply score += -0.2 and increment an existing counter if one exists; if no counter exists in v1 types, do NOT add new fields—just apply the penalty.
 * 
 * @param inputs Passport inputs (transcript summary, DBL judgment, agent_id)
 * @returns Passport delta
 */
export function computePassportDelta(inputs: PassportInputs): PassportDelta {
  const { transcript_summary, dbl_judgment, agent_id } = inputs;
  
  const delta: PassportDelta = {
    agent_id,
    score_delta: 0,
    counters_delta: {},
  };
  
  // Determine outcome
  const outcome = transcript_summary.outcome;
  const failureCode = transcript_summary.failure_code;
  
  // Rule 1: Terminal success
  if (outcome === "success") {
    delta.counters_delta.total_settlements = 1;
    delta.counters_delta.successful_settlements = 1;
    delta.score_delta += 0.01;
    return delta;
  }
  
  // Rule 2: Policy abort (PACT-101)
  if (failureCode === "PACT-101" || outcome === "abort") {
    delta.counters_delta.policy_aborts = 1;
    delta.score_delta -= 0.01;
    return delta;
  }
  
  // Rule 3: SLA timeout/violation (PACT-404)
  if (failureCode === "PACT-404" || outcome === "timeout") {
    delta.counters_delta.sla_violations = 1;
    delta.score_delta -= 0.02;
    return delta;
  }
  
  // Rule 4: Disputes
  if (outcome === "dispute" && dbl_judgment) {
    const judgment = dbl_judgment;
    const { buyer_id, seller_id } = transcript_summary;
    
    // Map DBL determination to agent_id (signer key)
    // Check if agent_id matches buyer or seller, then check dblDetermination
    const isBuyer = agent_id === buyer_id;
    const isSeller = agent_id === seller_id;
    
    // Determine if this agent is at fault based on dblDetermination
    let isAtFault = false;
    if (isBuyer && (judgment.dblDetermination === "BUYER_AT_FAULT" || judgment.dblDetermination === "BUYER_RAIL_AT_FAULT")) {
      isAtFault = true;
    } else if (isSeller && (judgment.dblDetermination === "PROVIDER_AT_FAULT" || judgment.dblDetermination === "PROVIDER_RAIL_AT_FAULT")) {
      isAtFault = true;
    }
    
    // Check if agent is exonerated (NO_FAULT or other actor at fault)
    const isExonerated = judgment.dblDetermination === "NO_FAULT" || 
                         (isBuyer && judgment.dblDetermination === "PROVIDER_AT_FAULT") ||
                         (isSeller && judgment.dblDetermination === "BUYER_AT_FAULT");
    
    if (isAtFault) {
      // Agent is responsible - apply judgment.passportImpact (typically -0.05)
      delta.counters_delta.disputes_lost = 1;
      delta.score_delta += judgment.passportImpact;
    } else if (isExonerated) {
      // Agent is exonerated - no negative impact
      // No counter increment, no score change
    } else if (judgment.passportImpact > 0) {
      // Agent wins dispute (explicit win with positive impact)
      delta.counters_delta.disputes_won = 1;
      delta.score_delta += 0.01;
    }
    
    return delta;
  }
  
  // Rule 5: Integrity tamper (FINAL_HASH_MISMATCH)
  // Check if DBL judgment indicates integrity issues
  if (dbl_judgment?.notes?.includes("final hash mismatch") || 
      dbl_judgment?.notes?.includes("FINAL_HASH_MISMATCH")) {
    delta.score_delta -= 0.2;
    // No counter increment (as per requirements: if no counter exists, just apply penalty)
    return delta;
  }
  
  // Rule 6: Other failures
  if (outcome === "failure") {
    // Generic failure - increment total_settlements but not successful
    delta.counters_delta.total_settlements = 1;
    // No score change for generic failures (specific failures handled above)
    return delta;
  }
  
  // Default: no change
  return delta;
}
