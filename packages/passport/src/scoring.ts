/**
 * Passport Scoring
 * 
 * Deterministic reputation scoring for Pact agents.
 */

import type { PassportEvent, PassportScore } from "./types";
import type { PassportStorage } from "./storage";

export type ScoreBreakdown = {
  success_score: number;
  failure_score: number;
  dispute_score: number;
  final_score: number;
  confidence: number;
  factors: {
    positive: Array<{ factor: string; contribution: number }>;
    negative: Array<{ factor: string; contribution: number }>;
  };
  warnings: string[];
};

export type ScoreResult = {
  score: number;
  confidence: number;
  breakdown: ScoreBreakdown;
};

// Constants from Passport spec
const HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const LAMBDA = Math.log(2); // ln(2) for half-life

const SUCCESS_WEIGHT = 0.5;
const FAILURE_WEIGHT = 0.3;
const DISPUTE_WEIGHT = 0.2;

// Failure severity by fault domain (from spec)
const FAILURE_SEVERITY: Record<string, number> = {
  policy: 0.5,
  identity: 0.7,
  negotiation: 0.6,
  settlement: 0.9,
  recursive: 0.8,
};

// Failure severity by code family (PACT-1xx worse than 4xx)
const FAILURE_FAMILY_SEVERITY: Record<string, number> = {
  "1xx": 1.2, // Policy violations (worse)
  "2xx": 1.0, // Identity failures
  "3xx": 1.0, // Negotiation failures
  "4xx": 0.8, // Settlement failures (less severe than policy)
  "5xx": 0.9, // Recursive failures
};

// Dispute outcome weights (losses penalize more)
const DISPUTE_OUTCOME_WEIGHT: Record<string, number> = {
  wins: 1.0, // Agent not at fault
  losses: 2.0, // Agent at fault (penalize more)
  dismissals: 0.5, // Dismissed/split (neutral)
};

/**
 * Compute recency decay weight.
 */
function computeRecencyDecay(eventTimestamp: number, now: number = Date.now()): number {
  const age = now - eventTimestamp;
  if (age < 0) return 1.0; // Future events (shouldn't happen)

  const decayWeight = Math.exp(-LAMBDA * (age / HALF_LIFE_MS));
  return decayWeight;
}

/**
 * Compute counterparty quality weight.
 * Returns bootstrap weight (0.5) if counterparty score unavailable.
 */
function computeCounterpartyWeight(
  counterpartyId: string | null,
  eventTimestamp: number,
  storage: PassportStorage,
  agentScores: Map<string, { score: number; computed_at: number }>
): number {
  if (!counterpartyId) return 0.5; // Bootstrap weight if no counterparty

  // Get counterparty score at time of event (use most recent score before event)
  let counterpartyScore = 50; // Default bootstrap score
  let hasScore = false;

  if (agentScores.has(counterpartyId)) {
    const cpScoreData = agentScores.get(counterpartyId)!;
    // Use score if computed before or at event time
    if (cpScoreData.computed_at <= eventTimestamp) {
      counterpartyScore = cpScoreData.score;
      hasScore = true;
    }
  }

  // If no historical score, use bootstrap weight
  if (!hasScore) {
    return 0.5; // Bootstrap weight
  }

  // Counterparty weight: 0.5 + (cp_score / 200)
  const cpWeight = 0.5 + counterpartyScore / 200;
  return Math.max(0.5, Math.min(1.0, cpWeight)); // Clamp to [0.5, 1.0]
}

/**
 * Extract failure family from failure code (PACT-XXX).
 */
function getFailureFamily(failureCode: string | null): string {
  if (!failureCode || !failureCode.startsWith("PACT-")) {
    return "unknown";
  }
  const match = failureCode.match(/PACT-(\d)(\d{2})/);
  if (!match) return "unknown";
  return `${match[1]}xx`;
}

/**
 * Compute failure severity with family penalty.
 */
function computeFailureSeverity(failureCode: string | null, faultDomain: string | null): number {
  const baseSeverity = faultDomain ? FAILURE_SEVERITY[faultDomain] || 0.8 : 0.8;
  const family = getFailureFamily(failureCode);
  const familyMultiplier = FAILURE_FAMILY_SEVERITY[family] || 1.0;
  return baseSeverity * familyMultiplier;
}

/**
 * Detect collusion patterns (v1 simple heuristics).
 */
function detectCollusion(
  events: PassportEvent[],
  counterpartyFrequency: Map<string, number>
): { suspicion_score: number; warnings: string[] } {
  const warnings: string[] = [];
  let suspicionScore = 0.0;

  // Heuristic 1: Cap contribution from repeated counterparties (>30% of events)
  const totalEvents = events.length;
  const counterpartyThreshold = 0.3; // 30% threshold

  for (const [counterparty, count] of counterpartyFrequency.entries()) {
    const frequency = count / totalEvents;
    if (frequency > counterpartyThreshold) {
      const excess = frequency - counterpartyThreshold;
      // Increase suspicion score more aggressively for wash trading
      suspicionScore += excess * 0.8; // Scale suspicion by excess frequency (increased from 0.5)
      warnings.push(`High frequency with counterparty ${counterparty}: ${(frequency * 100).toFixed(1)}%`);
    }
  }

  // Heuristic 2: Detect tight clusters (same 3 counterparties repeatedly)
  if (counterpartyFrequency.size <= 3 && totalEvents > 5) {
    const concentration = 1 - (counterpartyFrequency.size / totalEvents);
    // Increase suspicion for tight clusters (increased from 0.3)
    suspicionScore += concentration * 0.5;
    warnings.push(`Tight cluster detected: only ${counterpartyFrequency.size} unique counterparties`);
  }

  return {
    suspicion_score: Math.min(1.0, suspicionScore),
    warnings,
  };
}

/**
 * Compute wash trading penalty for events from same counterparty.
 */
function computeWashPenalty(counterpartyId: string | null, counterpartyFrequency: Map<string, number>, totalEvents: number): number {
  if (!counterpartyId) return 1.0;

  const count = counterpartyFrequency.get(counterpartyId) || 0;
  const frequency = count / totalEvents;

  // Penalize if >30% of events with same counterparty
  if (frequency > 0.3) {
    const excess = frequency - 0.3;
    // Reduce weight linearly: at 30% = 1.0, at 100% = 0.5
    return Math.max(0.5, 1.0 - (excess / 0.7) * 0.5);
  }

  return 1.0;
}

/**
 * Compute Passport score for an agent.
 */
export function computePassportScore(
  agentId: string,
  storage: PassportStorage,
  now: number = Date.now()
): ScoreResult {
  // Get all events for agent
  const events = storage.getEventsByAgent(agentId);

  // Separate events by type to check bootstrap conditions
  const hasSuccess = events.some((e) => e.event_type === "settlement_success");
  const hasFailure = events.some((e) => e.event_type === "settlement_failure");
  const hasDispute = events.some((e) => e.event_type === "dispute_resolved");

  // Bootstrap: insufficient data - require at least 3 events OR at least 1 success + 1 failure
  // Allow 2 events if they're different types (success + failure) so scoring can happen
  const hasMinimalData = events.length >= 3 || (hasSuccess && hasFailure);
  if (!hasMinimalData) {
    return {
      score: 50,
      confidence: 0.0,
      breakdown: {
        success_score: 50,
        failure_score: 50,
        dispute_score: 50,
        final_score: 50,
        confidence: 0.0,
        factors: { positive: [], negative: [] },
        warnings: ["Insufficient data: fewer than 3 transactions"],
      },
    };
  }

  // Compute counterparty frequency for collusion detection
  // Only count settlement events (successes/failures) for collusion detection, not disputes
  // Disputes are outcomes, not indicators of wash trading
  const counterpartyFrequency = new Map<string, number>();
  const settlementEvents: PassportEvent[] = [];
  for (const event of events) {
    if (event.event_type === "settlement_success" || event.event_type === "settlement_failure") {
      settlementEvents.push(event);
      if (event.counterparty_agent_id) {
        const count = counterpartyFrequency.get(event.counterparty_agent_id) || 0;
        counterpartyFrequency.set(event.counterparty_agent_id, count + 1);
      }
    }
  }

  // Detect collusion based on settlement events only
  const collusion = detectCollusion(settlementEvents, counterpartyFrequency);

  // Get all agent scores for counterparty weighting (recursive)
  // In v1, we'll use a simple approximation: score all agents first (would need recursion in production)
  // For MVP, we'll use bootstrap weights for unknown counterparties
  const agentScores = new Map<string, { score: number; computed_at: number }>();

  // Separate events by type
  const successEvents: PassportEvent[] = [];
  const failureEvents: PassportEvent[] = [];
  const disputeEvents: PassportEvent[] = [];

  for (const event of events) {
    switch (event.event_type) {
      case "settlement_success":
        successEvents.push(event);
        break;
      case "settlement_failure":
        failureEvents.push(event);
        break;
      case "dispute_resolved":
        disputeEvents.push(event);
        break;
    }
  }

  // Use settlement events count for wash penalty calculation (disputes don't count for wash trading)
  const settlementEventsCount = settlementEvents.length;

  // Compute weighted components
  let weightedSuccesses = 0;
  let weightedFailures = 0;
  let weightedDisputesWins = 0;
  let weightedDisputesLosses = 0;
  let weightedDisputesDismissals = 0;

  const positiveFactors: Array<{ factor: string; contribution: number }> = [];
  const negativeFactors: Array<{ factor: string; contribution: number }> = [];

  // Process success events
  for (const event of successEvents) {
    const decayWeight = computeRecencyDecay(event.ts, now);
    const cpWeight = computeCounterpartyWeight(event.counterparty_agent_id, event.ts, storage, agentScores);
    const washPenalty = computeWashPenalty(event.counterparty_agent_id, counterpartyFrequency, settlementEventsCount);
    const collusionPenalty = 1.0 - collusion.suspicion_score * 0.5; // Reduce weight if collusion detected

    // Value weighting (normalize by median, cap at 10x for anti-gaming)
    const value = event.value_usd || 0;
    const values = successEvents.map((e) => e.value_usd || 0).filter((v) => v > 0);
    const medianValue =
      values.length > 0
        ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
        : 0.00005; // Default median for weather.data
    const valueRatio = medianValue > 0 ? value / medianValue : 1.0;
    const valueWeight = Math.min(10.0, Math.max(0.1, valueRatio)); // Cap between 0.1x and 10x

    const contribution = decayWeight * cpWeight * washPenalty * collusionPenalty * valueWeight;

    weightedSuccesses += contribution;

    if (contribution > 0.1) {
      positiveFactors.push({
        factor: `Success transaction with ${event.counterparty_agent_id || "unknown"} (${new Date(event.ts).toISOString().split("T")[0]})`,
        contribution: contribution * SUCCESS_WEIGHT * 100,
      });
    }
  }

  // Process failure events
  for (const event of failureEvents) {
    // Only terminal failures
    if (event.terminality !== "terminal") continue;

    const decayWeight = computeRecencyDecay(event.ts, now);
    const cpWeight = computeCounterpartyWeight(event.counterparty_agent_id, event.ts, storage, agentScores);
    const washPenalty = computeWashPenalty(event.counterparty_agent_id, counterpartyFrequency, settlementEventsCount);
    const collusionPenalty = 1.0 - collusion.suspicion_score * 0.5;
    const severity = computeFailureSeverity(event.failure_code, event.fault_domain);

    const contribution = decayWeight * cpWeight * washPenalty * collusionPenalty * severity;

    weightedFailures += contribution;

    // Always add failures to negative factors (failures are significant events)
    // Add even if contribution is 0 (failures should always be tracked)
    negativeFactors.push({
      factor: `${event.failure_code || "Unknown"} failure in ${event.fault_domain || "unknown"} domain (${new Date(event.ts).toISOString().split("T")[0]})`,
      contribution: contribution * FAILURE_WEIGHT * 100,
    });
  }

  // Process dispute events
  for (const event of disputeEvents) {
    const decayWeight = computeRecencyDecay(event.ts, now);
    const cpWeight = computeCounterpartyWeight(event.counterparty_agent_id, event.ts, storage, agentScores);
    const washPenalty = computeWashPenalty(event.counterparty_agent_id, counterpartyFrequency, settlementEventsCount);
    const collusionPenalty = 1.0 - collusion.suspicion_score * 0.5;

    const outcome = event.dispute_outcome || "unknown";
    let outcomeWeight = 1.0;
    let outcomeCategory: "wins" | "losses" | "dismissals" = "dismissals";

    // Determine if agent won or lost based on outcome
    // Outcomes: "buyer_wins", "seller_wins", "split", "dismissed", "wins", "losses"
    if (outcome === "buyer_wins") {
      // If agent is buyer, they won; if seller, they lost
      outcomeCategory = agentId.includes("buyer") || agentId === "buyer" ? "wins" : "losses";
      outcomeWeight = outcomeCategory === "wins" ? DISPUTE_OUTCOME_WEIGHT.wins : DISPUTE_OUTCOME_WEIGHT.losses;
    } else if (outcome === "seller_wins") {
      // If agent is seller, they won; if buyer, they lost
      outcomeCategory = agentId.includes("seller") || agentId === "seller" ? "wins" : "losses";
      outcomeWeight = outcomeCategory === "wins" ? DISPUTE_OUTCOME_WEIGHT.wins : DISPUTE_OUTCOME_WEIGHT.losses;
    } else if (outcome === "dismissed" || outcome === "split") {
      outcomeCategory = "dismissals";
      outcomeWeight = DISPUTE_OUTCOME_WEIGHT.dismissals;
    } else if (outcome === "wins") {
      // Direct wins outcome (for test compatibility)
      outcomeCategory = "wins";
      outcomeWeight = DISPUTE_OUTCOME_WEIGHT.wins;
    } else if (outcome === "losses") {
      // Direct losses outcome (for test compatibility)
      outcomeCategory = "losses";
      outcomeWeight = DISPUTE_OUTCOME_WEIGHT.losses;
    } else {
      // Unknown outcome - treat as dismissal
      outcomeCategory = "dismissals";
      outcomeWeight = DISPUTE_OUTCOME_WEIGHT.dismissals;
    }

    const contribution = decayWeight * cpWeight * washPenalty * collusionPenalty * outcomeWeight * 2.0; // 2x multiplier

    switch (outcomeCategory) {
      case "wins":
        weightedDisputesWins += contribution;
        // Always add dispute wins to positive factors (no threshold - disputes are significant events)
        positiveFactors.push({
          factor: `Dispute win (${new Date(event.ts).toISOString().split("T")[0]})`,
          contribution: contribution * DISPUTE_WEIGHT * 100,
        });
        break;
      case "losses":
        weightedDisputesLosses += contribution;
        // Always add dispute losses to negative factors (no threshold - disputes are significant events)
        negativeFactors.push({
          factor: `Dispute loss (${new Date(event.ts).toISOString().split("T")[0]})`,
          contribution: contribution * DISPUTE_WEIGHT * 100,
        });
        break;
      case "dismissals":
        weightedDisputesDismissals += contribution;
        break;
    }
  }

  // Compute component scores
  // Use success/failure weighted sum for success/failure score calculation (disputes calculated separately)
  const successFailureWeighted = weightedSuccesses + weightedFailures;
  const totalWeighted = weightedSuccesses + weightedFailures + weightedDisputesWins + weightedDisputesLosses + weightedDisputesDismissals;

  const successScore = successFailureWeighted > 0 ? (100 * weightedSuccesses) / successFailureWeighted : 50;
  // failureScore: 0 = all failures, 100 = no failures
  // Formula: 100 * (1 - weightedFailures / successFailureWeighted)
  // If weightedFailures = successFailureWeighted, then failureScore = 0
  // If weightedFailures = 0, then failureScore = 100
  // Equivalent to: 100 * (weightedSuccesses / successFailureWeighted)
  const failureScore = successFailureWeighted > 0 ? 100 * (1 - weightedFailures / successFailureWeighted) : 50;
  const totalDisputeWeight = weightedDisputesWins + weightedDisputesLosses + weightedDisputesDismissals;
  const disputeScore =
    totalDisputeWeight > 0
      ? (100 * weightedDisputesWins) / (weightedDisputesWins + weightedDisputesLosses + weightedDisputesDismissals)
      : 50;

  // Final score aggregation
  let finalScore = SUCCESS_WEIGHT * successScore + FAILURE_WEIGHT * failureScore + DISPUTE_WEIGHT * disputeScore;
  
  // Apply wash trading/collusion penalty to final score (reduce score more aggressively for high suspicion)
  if (collusion.suspicion_score > 0.3) {
    // At suspicion 0.7: penalty = 1.0 - 0.4*0.5 = 0.8 (20% reduction)
    // At suspicion 1.0: penalty = 1.0 - 0.7*0.5 = 0.65 (35% reduction)
    const collusionPenaltyFactor = 1.0 - (collusion.suspicion_score - 0.3) * 0.5;
    finalScore = finalScore * collusionPenaltyFactor;
  }

  // Compute confidence
  const independentCounterparties = counterpartyFrequency.size;
  const totalEvents = events.length;
  const recentFailures = failureEvents.filter((e) => now - e.ts < 30 * 24 * 60 * 60 * 1000).length; // Last 30 days
  const recentDisputes = disputeEvents.filter((e) => now - e.ts < 30 * 24 * 60 * 60 * 1000).length;

  // Confidence factors
  const transactionCountFactor = Math.min(1.0, Math.log10(totalEvents + 1) / Math.log10(100));
  const counterpartyDiversityFactor = Math.min(1.0, independentCounterparties / 10);
  const recentEventCount = events.filter((e) => now - e.ts < HALF_LIFE_MS).length;
  const recencyFactorDenom = Math.max(1, totalEvents); // Fix: use totalEvents, not max(10, totalEvents)
  const recencyFactor = Math.min(1.0, recentEventCount / recencyFactorDenom);

  // Decrease confidence with recent failures/disputes
  const failurePenalty = Math.max(0, 1.0 - (recentFailures / Math.max(10, totalEvents)) * 0.3);
  const disputePenalty = Math.max(0, 1.0 - (recentDisputes / Math.max(10, totalEvents)) * 0.2);

  const confidence =
    transactionCountFactor * 0.4 +
    counterpartyDiversityFactor * 0.3 +
    recencyFactor * 0.3;

  const adjustedConfidence = Math.max(0, Math.min(1.0, confidence * failurePenalty * disputePenalty));

  // Sort factors by contribution (top 5 positive and negative)
  // But ensure dispute wins/losses are always included (they're significant events)
  const disputeWinFactors = positiveFactors.filter((f) => f.factor.includes("Dispute win"));
  const disputeLossFactors = negativeFactors.filter((f) => f.factor.includes("Dispute loss"));
  const otherPositiveFactors = positiveFactors.filter((f) => !f.factor.includes("Dispute win"));
  const otherNegativeFactors = negativeFactors.filter((f) => !f.factor.includes("Dispute loss"));

  otherPositiveFactors.sort((a, b) => b.contribution - a.contribution);
  otherNegativeFactors.sort((a, b) => b.contribution - a.contribution);

  // Combine: dispute factors first (they're significant), then top other factors (up to 5 total)
  const topPositive = [...disputeWinFactors, ...otherPositiveFactors].slice(0, 5);
  const topNegative = [...disputeLossFactors, ...otherNegativeFactors].slice(0, 5);

  const breakdown: ScoreBreakdown = {
    success_score: successScore,
    failure_score: failureScore,
    dispute_score: disputeScore,
    final_score: finalScore,
    confidence: adjustedConfidence,
    factors: {
      positive: topPositive,
      negative: topNegative, // Always exists (even if empty)
    },
    warnings: collusion.warnings || [],
  };

  return {
    score: Math.max(0, Math.min(100, finalScore)),
    confidence: adjustedConfidence,
    breakdown,
  };
}
