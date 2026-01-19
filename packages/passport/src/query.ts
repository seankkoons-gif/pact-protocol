/**
 * Passport Query Interface
 * 
 * Provides query functions for Passport scores with caching and reproducibility.
 */

import type { PassportStorage } from "./storage";
import { computePassportScore, type ScoreResult, type ScoreBreakdown } from "./scoring";
import type { PassportScore } from "./types";

export type PassportQueryResponse = {
  agent_id: string;
  score: number;
  confidence: number;
  breakdown: ScoreBreakdown;
  updated_at: number; // computed_at timestamp
};

/**
 * Stable reason codes for Passport policy denials.
 * These codes are stable across versions for policy gate integration.
 */
export type PassportDenialReason =
  | "SCORE_TOO_LOW"
  | "LOW_CONFIDENCE"
  | "INSUFFICIENT_HISTORY"
  | "DISPUTE_FLAGGED"
  | "RECENT_POLICY_VIOLATION";

export type PassportPolicyResult = {
  pass: boolean;
  reason?: PassportDenialReason | "INVALID_MIN_SCORE" | "INVALID_MIN_CONFIDENCE";
  score?: number;
  confidence?: number;
  min_score_required?: number;
  min_confidence_required?: number;
  /**
   * Factor that triggered denial (from breakdown.factors if available).
   * Used by Replayer to display which Passport factor caused the policy gate.
   */
  triggering_factor?: string;
};

// Cache keyed by (agent_id, computed_at) for safety
type CacheKey = string; // `${agent_id}:${computed_at}`
type CacheEntry = {
  result: ScoreResult;
  computed_at: number;
};

// Simple in-memory cache (can be extended to Redis/other in production)
const scoreCache = new Map<CacheKey, CacheEntry>();

/**
 * Generate cache key from agent_id and computed_at timestamp.
 * Cache is keyed by computed_at for safety and reproducibility.
 */
function getCacheKey(agentId: string, computedAt: number): string {
  // Round computed_at to minute for cache key (1 minute cache window)
  const cacheWindowMs = 60000; // 1 minute
  const cacheKeyTime = Math.floor(computedAt / cacheWindowMs) * cacheWindowMs;
  return `${agentId}:${cacheKeyTime}`;
}

/**
 * Query Passport score for an agent.
 * 
 * @param storage Passport storage instance
 * @param agentId Agent ID to query
 * @param asOf Optional timestamp for reproducibility (queries score computed at or before this time)
 * @returns Passport query response
 */
export function queryPassport(
  storage: PassportStorage,
  agentId: string,
  asOf?: number
): PassportQueryResponse {
  // For as_of queries, we need to find the most recent score computed at or before asOf
  // For current queries, we compute fresh or use cached

  const now = asOf || Date.now();

  // Check cache first (for current queries)
  if (!asOf) {
    const cacheKey = getCacheKey(agentId, now);
    const cached = scoreCache.get(cacheKey);
    if (cached) {
      // Verify cached score is still within cache window (1 minute)
      const age = now - cached.computed_at;
      if (age < 60000) {
        // Cache valid for 1 minute
        return {
          agent_id: agentId,
          score: cached.result.score,
          confidence: cached.result.confidence,
          breakdown: cached.result.breakdown,
          updated_at: cached.computed_at,
        };
      }
    }
  }

  // For as_of queries, try to find stored score computed at or before asOf
  if (asOf) {
    const storedScore = storage.getScore(agentId);
    if (storedScore && storedScore.computed_at <= asOf) {
      // Parse breakdown from JSON
      const breakdown = JSON.parse(storedScore.breakdown_json) as ScoreBreakdown;
      return {
        agent_id: agentId,
        score: storedScore.score,
        confidence: storedScore.confidence,
        breakdown,
        updated_at: storedScore.computed_at,
      };
    }
    // If no stored score at or before asOf, compute using events up to asOf
    // This ensures reproducibility
    const result = computePassportScore(agentId, storage, asOf);
    return {
      agent_id: agentId,
      score: result.score,
      confidence: result.confidence,
      breakdown: result.breakdown,
      updated_at: asOf,
    };
  }

  // Compute fresh score for current query
  const result = computePassportScore(agentId, storage, now);

  // Store in scores table
  storage.upsertScore({
    agent_id: agentId,
    computed_at: now,
    score: result.score,
    confidence: result.confidence,
    breakdown_json: JSON.stringify(result.breakdown),
  });

  // Cache the result (keyed by computed_at for safety)
  const cacheKey = getCacheKey(agentId, now);
  scoreCache.set(cacheKey, {
    result,
    computed_at: now,
  });

  return {
    agent_id: agentId,
    score: result.score,
    confidence: result.confidence,
    breakdown: result.breakdown,
    updated_at: now,
  };
}

/**
 * Policy helper: require Passport score and confidence thresholds.
 * 
 * @param storage Passport storage instance
 * @param agentId Agent ID to check
 * @param minScore Minimum required score (0-100)
 * @param minConfidence Optional minimum required confidence (0-1)
 * @param asOf Optional timestamp for reproducibility
 * @returns Policy result with pass/fail and reason codes
 */
export function requirePassport(
  storage: PassportStorage,
  agentId: string,
  minScore: number,
  minConfidence?: number,
  asOf?: number
): PassportPolicyResult {
  // Validate inputs
  if (minScore < 0 || minScore > 100) {
    return {
      pass: false,
      reason: "INVALID_MIN_SCORE",
      min_score_required: minScore,
    };
  }

  if (minConfidence !== undefined && (minConfidence < 0 || minConfidence > 1)) {
    return {
      pass: false,
      reason: "INVALID_MIN_CONFIDENCE",
      min_confidence_required: minConfidence,
    };
  }

  // Query score
  const queryResult = queryPassport(storage, agentId, asOf);

  // Check for insufficient history (bootstrap condition)
  // Insufficient history is indicated by confidence = 0.0
  if (queryResult.confidence === 0.0) {
    // Find the top negative factor that caused insufficient history
    const topNegativeFactor = queryResult.breakdown.factors.negative[0]?.factor;
    return {
      pass: false,
      reason: "INSUFFICIENT_HISTORY",
      score: queryResult.score,
      confidence: queryResult.confidence,
      min_score_required: minScore,
      min_confidence_required: minConfidence,
      triggering_factor: topNegativeFactor || "Insufficient transaction history",
    };
  }

  // Check score threshold FIRST (before policy violations) - if score is below minScore, that's the primary reason
  if (queryResult.score < minScore) {
    // Find top negative factor that contributed to low score
    const topNegativeFactor = queryResult.breakdown.factors.negative[0]?.factor;
    return {
      pass: false,
      reason: "SCORE_TOO_LOW",
      score: queryResult.score,
      confidence: queryResult.confidence,
      min_score_required: minScore,
      min_confidence_required: minConfidence,
      triggering_factor: topNegativeFactor,
    };
  }

  // Check for recent policy violations (PACT-1xx failures in last 30 days)
  // Only check if score threshold is already met (score >= minScore)
  // Look for recent policy failures in breakdown warnings or negative factors
  const recentPolicyViolation = queryResult.breakdown.factors.negative.find(
    (f) => f.factor.includes("PACT-1") || f.factor.toLowerCase().includes("policy")
  );
  const recentViolationWindow = 30 * 24 * 60 * 60 * 1000; // 30 days
  const now = asOf || Date.now();
  // If there's a recent policy violation mentioned in factors, check recency
  // This is heuristic-based - in production, would check actual event timestamps
  if (recentPolicyViolation && queryResult.score < 60) {
    // If score is low and there's a policy violation factor, likely recent
    return {
      pass: false,
      reason: "RECENT_POLICY_VIOLATION",
      score: queryResult.score,
      confidence: queryResult.confidence,
      min_score_required: minScore,
      min_confidence_required: minConfidence,
      triggering_factor: recentPolicyViolation.factor,
    };
  }

  // Check for dispute flags (dispute losses in negative factors)
  const disputeLoss = queryResult.breakdown.factors.negative.find((f) =>
    f.factor.toLowerCase().includes("dispute loss")
  );
  if (disputeLoss && queryResult.score < 50) {
    // If score is below neutral and there's a dispute loss, flag it
    return {
      pass: false,
      reason: "DISPUTE_FLAGGED",
      score: queryResult.score,
      confidence: queryResult.confidence,
      min_score_required: minScore,
      min_confidence_required: minConfidence,
      triggering_factor: disputeLoss.factor,
    };
  }

  // Check confidence threshold (use stable reason code)
  if (minConfidence !== undefined && queryResult.confidence < minConfidence) {
    return {
      pass: false,
      reason: "LOW_CONFIDENCE",
      score: queryResult.score,
      confidence: queryResult.confidence,
      min_score_required: minScore,
      min_confidence_required: minConfidence,
      triggering_factor: "Insufficient transaction history for confidence",
    };
  }

  // Pass all checks
  return {
    pass: true,
    score: queryResult.score,
    confidence: queryResult.confidence,
    min_score_required: minScore,
    min_confidence_required: minConfidence,
  };
}

/**
 * Clear cache for an agent (useful for testing or manual invalidation).
 */
export function clearCache(agentId?: string): void {
  if (agentId) {
    // Clear specific agent
    const keysToDelete: string[] = [];
    for (const key of scoreCache.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      scoreCache.delete(key);
    }
  } else {
    // Clear all
    scoreCache.clear();
  }
}
