/**
 * Passport v1 Delta Application
 * 
 * Applies passport deltas to state with score clamping.
 * Pure and deterministic: no side effects.
 */

import type { PassportState, PassportDelta } from "./types";

/**
 * Apply a passport delta to state.
 * Clamps score to [-1, +1] range.
 * 
 * @param state Current passport state
 * @param delta Delta to apply
 * @returns New passport state
 */
export function applyDelta(state: PassportState, delta: PassportDelta): PassportState {
  // Create new state with updated score
  const newScore = state.score + delta.score_delta;
  
  // Clamp score to [-1, +1]
  const clampedScore = Math.max(-1, Math.min(1, newScore));
  
  // Apply counter deltas
  const newCounters = {
    total_settlements: state.counters.total_settlements + (delta.counters_delta.total_settlements || 0),
    successful_settlements: state.counters.successful_settlements + (delta.counters_delta.successful_settlements || 0),
    disputes_lost: state.counters.disputes_lost + (delta.counters_delta.disputes_lost || 0),
    disputes_won: state.counters.disputes_won + (delta.counters_delta.disputes_won || 0),
    sla_violations: state.counters.sla_violations + (delta.counters_delta.sla_violations || 0),
    policy_aborts: state.counters.policy_aborts + (delta.counters_delta.policy_aborts || 0),
  };
  
  return {
    version: "passport/1.0",
    agent_id: state.agent_id,
    score: clampedScore,
    counters: newCounters,
  };
}
