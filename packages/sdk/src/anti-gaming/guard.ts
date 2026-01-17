/**
 * Lightweight Anti-Gaming Guard for Pact v3
 * 
 * Implements in-memory anti-gaming protections:
 * - Rate limiting per agent identity
 * - Reputation-weighted quote acceptance
 * - Rejection penalties for bad-faith bids
 * - Transcript flagging for suspicious behavior
 * 
 * Constraints:
 * - No databases (in-memory state only)
 * - No external services
 * - Deterministic behavior (same inputs = same outputs)
 * - All logic transcript-backed and explainable
 * 
 * Design:
 * - State stored in Maps keyed by agent_id
 * - Time-based cleanup (expire old entries)
 * - All decisions recorded in transcripts
 */

import type { SignedEnvelope, ParsedPactMessage } from "../protocol/index";
import type { TranscriptV1 } from "../transcript/types";

/**
 * Rate limit tracker per agent
 */
interface AgentRateLimit {
  agentId: string;
  intentType?: string;
  requests: number[]; // Timestamps of requests (ms)
  lastCleanup: number; // Last cleanup timestamp (ms)
}

/**
 * Bad-faith rejection tracker
 */
interface AgentRejectionHistory {
  agentId: string;
  recentRejections: Array<{
    intentId: string;
    timestamp: number;
    reason: string;
    priceOffered?: number;
    priceAsked?: number;
  }>;
  badFaithScore: number; // 0.0 (good) to 1.0 (bad)
  lastPenaltyApplied: number; // Timestamp of last penalty
}

/**
 * Quote acceptance decision with reputation weighting
 */
export interface QuoteAcceptanceDecision {
  accept: boolean;
  reason: string;
  reputationWeight: number;
  adjustedPrice?: number;
  flags?: string[]; // Suspicious behavior flags
}

/**
 * Anti-Gaming Guard Configuration
 */
export interface AntiGamingConfig {
  // Rate limiting
  rateLimitPerMinute: number; // Requests per agent per minute
  rateLimitWindowMs: number; // Rolling window (default: 60000 = 1 minute)
  
  // Reputation weighting
  enableReputationWeighting: boolean;
  reputationWeightMultiplier: number; // How much reputation affects acceptance (0.0 = no effect, 1.0 = full effect)
  
  // Bad-faith penalties
  badFaithThreshold: number; // Rejections before penalty kicks in (e.g., 3)
  badFaithWindowMs: number; // Time window for counting rejections (e.g., 300000 = 5 minutes)
  rejectionPenaltyMultiplier: number; // Price multiplier for bad-faith agents (e.g., 1.1 = 10% penalty)
  penaltyDecayMs: number; // Time for penalty to decay (e.g., 3600000 = 1 hour)
  
  // Suspicious behavior detection
  suspiciousBehaviorThresholds: {
    rapidRejections: number; // Rejections per minute considered suspicious
    lowPriceOffers: number; // Percentage below ask considered suspicious (e.g., 0.5 = 50% below)
  };
}

/**
 * Default anti-gaming configuration
 */
export const DEFAULT_ANTI_GAMING_CONFIG: AntiGamingConfig = {
  rateLimitPerMinute: 30,
  rateLimitWindowMs: 60000, // 1 minute
  
  enableReputationWeighting: true,
  reputationWeightMultiplier: 0.3, // 30% reputation influence
  
  badFaithThreshold: 3, // 3 rejections trigger penalty
  badFaithWindowMs: 300000, // 5 minute window
  rejectionPenaltyMultiplier: 1.1, // 10% price penalty
  penaltyDecayMs: 3600000, // 1 hour decay
  
  suspiciousBehaviorThresholds: {
    rapidRejections: 5, // 5 rejections per minute
    lowPriceOffers: 0.5, // Offers 50%+ below ask are suspicious
  },
};

/**
 * Lightweight Anti-Gaming Guard
 * 
 * In-memory implementation for provider-side anti-gaming protections.
 * All decisions are deterministic and explainable.
 */
export class AntiGamingGuard {
  private config: AntiGamingConfig;
  
  // In-memory state (cleaned up periodically)
  private rateLimits: Map<string, AgentRateLimit> = new Map();
  private rejectionHistory: Map<string, AgentRejectionHistory> = new Map();
  
  constructor(config: Partial<AntiGamingConfig> = {}) {
    this.config = { ...DEFAULT_ANTI_GAMING_CONFIG, ...config };
  }
  
  /**
   * Check rate limit for agent
   * 
   * Returns: { ok: true } if within limit, { ok: false, reason } if exceeded
   * 
   * Deterministic: Same agent_id + same time window = same result
   */
  checkRateLimit(agentId: string, intentType?: string, nowMs: number = Date.now()): {
    ok: boolean;
    reason?: string;
    currentCount?: number;
    limit?: number;
  } {
    const key = `${agentId}:${intentType || "*"}`;
    const limit = this.rateLimits.get(key) || {
      agentId,
      intentType,
      requests: [],
      lastCleanup: nowMs,
    };
    
    // Cleanup old requests (outside rolling window)
    const cutoff = nowMs - this.config.rateLimitWindowMs;
    limit.requests = limit.requests.filter((ts) => ts > cutoff);
    
    // Check if limit exceeded
    if (limit.requests.length >= this.config.rateLimitPerMinute) {
      this.rateLimits.set(key, limit);
      return {
        ok: false,
        reason: `Rate limit exceeded: ${limit.requests.length}/${this.config.rateLimitPerMinute} requests in ${this.config.rateLimitWindowMs}ms`,
        currentCount: limit.requests.length,
        limit: this.config.rateLimitPerMinute,
      };
    }
    
    // Record this request
    limit.requests.push(nowMs);
    limit.lastCleanup = nowMs;
    this.rateLimits.set(key, limit);
    
    return {
      ok: true,
      currentCount: limit.requests.length,
      limit: this.config.rateLimitPerMinute,
    };
  }
  
  /**
   * Calculate reputation-weighted quote acceptance
   * 
   * Deterministic: Same inputs (reputation, price, bid) = same acceptance decision
   * 
   * Returns acceptance decision with explanation
   */
  calculateReputationWeightedAcceptance(params: {
    agentId: string;
    reputation: number; // 0.0 to 1.0
    bidPrice: number;
    askPrice: number;
    nowMs?: number;
  }): QuoteAcceptanceDecision {
    const { agentId, reputation, bidPrice, askPrice, nowMs = Date.now() } = params;
    
    // Base acceptance: bid must be >= ask
    const baseAccept = bidPrice >= askPrice;
    
    if (!this.config.enableReputationWeighting) {
      return {
        accept: baseAccept,
        reason: baseAccept ? "Bid price acceptable" : "Bid price below ask",
        reputationWeight: 0.0,
      };
    }
    
    // Reputation weighting: Lower reputation requires higher bid
    // Formula: adjusted_ask = ask * (1 - reputation_weight_multiplier * (1 - reputation))
    // Example: rep=0.5, multiplier=0.3 → adjusted_ask = ask * (1 - 0.3 * 0.5) = ask * 0.85
    const reputationWeight = this.config.reputationWeightMultiplier * (1.0 - reputation);
    const adjustedAsk = askPrice * (1.0 - reputationWeight);
    
    // Apply bad-faith penalty if applicable
    const penalty = this.getBadFaithPenalty(agentId, nowMs);
    const finalAsk = adjustedAsk * penalty;
    
    const accept = bidPrice >= finalAsk;
    
    const flags: string[] = [];
    if (reputation < 0.5) {
      flags.push("low_reputation");
    }
    if (penalty > 1.0) {
      flags.push("bad_faith_penalty");
    }
    
    return {
      accept,
      reason: accept
        ? `Bid ${bidPrice} >= adjusted ask ${finalAsk.toFixed(8)} (reputation: ${reputation.toFixed(2)}, penalty: ${penalty.toFixed(2)})`
        : `Bid ${bidPrice} < adjusted ask ${finalAsk.toFixed(8)} (reputation: ${reputation.toFixed(2)}, penalty: ${penalty.toFixed(2)})`,
      reputationWeight,
      adjustedPrice: finalAsk,
      flags: flags.length > 0 ? flags : undefined,
    };
  }
  
  /**
   * Record rejection and check for bad-faith pattern
   * 
   * Deterministic: Same rejection history = same penalty calculation
   */
  recordRejection(params: {
    agentId: string;
    intentId: string;
    reason: string;
    priceOffered?: number;
    priceAsked?: number;
    nowMs?: number;
  }): {
    badFaithDetected: boolean;
    penaltyMultiplier: number;
    rejectionCount: number;
    flags?: string[];
  } {
    const { agentId, intentId, reason, priceOffered, priceAsked, nowMs = Date.now() } = params;
    
    let history = this.rejectionHistory.get(agentId) || {
      agentId,
      recentRejections: [],
      badFaithScore: 0.0,
      lastPenaltyApplied: 0,
    };
    
    // Cleanup old rejections (outside window)
    const cutoff = nowMs - this.config.badFaithWindowMs;
    history.recentRejections = history.recentRejections.filter((r) => r.timestamp > cutoff);
    
    // Add new rejection
    history.recentRejections.push({
      intentId,
      timestamp: nowMs,
      reason,
      priceOffered,
      priceAsked,
    });
    
    // Calculate bad-faith score (0.0 = good, 1.0 = bad)
    const rejectionCount = history.recentRejections.length;
    const badFaithDetected = rejectionCount >= this.config.badFaithThreshold;
    
    // Calculate score: increases with rejection count, capped at 1.0
    // Formula: rawScore = min(1.0, rejectionCount / (threshold * 2))
    // Example: threshold=3 → score reaches 1.0 at 6 rejections
    const rawScore = Math.min(1.0, rejectionCount / (this.config.badFaithThreshold * 2));
    
    // Apply decay if penalty was previously applied
    if (history.lastPenaltyApplied > 0) {
      const timeSinceLastPenalty = nowMs - history.lastPenaltyApplied;
      const decayFactor = Math.min(1.0, timeSinceLastPenalty / this.config.penaltyDecayMs);
      // Decay reduces score by up to 50%
      history.badFaithScore = Math.max(rawScore, history.badFaithScore * (1.0 - decayFactor * 0.5));
    } else {
      // First time: use raw score
      history.badFaithScore = rawScore;
    }
    
    // Apply penalty multiplier
    const penaltyMultiplier = badFaithDetected
      ? 1.0 + (history.badFaithScore * (this.config.rejectionPenaltyMultiplier - 1.0))
      : 1.0;
    
    if (badFaithDetected) {
      history.lastPenaltyApplied = nowMs;
    }
    
    this.rejectionHistory.set(agentId, history);
    
    // Detect suspicious behavior
    const flags: string[] = [];
    if (badFaithDetected) {
      flags.push("bad_faith_rejections");
    }
    
    // Check for rapid rejections (suspicious pattern)
    const recentRejections = history.recentRejections.filter(
      (r) => nowMs - r.timestamp < 60000 // Last minute
    );
    if (recentRejections.length >= this.config.suspiciousBehaviorThresholds.rapidRejections) {
      flags.push("rapid_rejections");
    }
    
    // Check for low-price offers (suspicious: trying to game pricing)
    if (priceOffered !== undefined && priceAsked !== undefined && priceAsked > 0) {
      const offerRatio = priceOffered / priceAsked;
      if (offerRatio < this.config.suspiciousBehaviorThresholds.lowPriceOffers) {
        flags.push("low_price_offer");
      }
    }
    
    return {
      badFaithDetected,
      penaltyMultiplier,
      rejectionCount,
      flags: flags.length > 0 ? flags : undefined,
    };
  }
  
  /**
   * Get current bad-faith penalty multiplier for agent
   * 
   * Deterministic: Same agent + same time = same penalty
   */
  private getBadFaithPenalty(agentId: string, nowMs: number): number {
    const history = this.rejectionHistory.get(agentId);
    if (!history || history.badFaithScore < 0.01) {
      return 1.0; // No penalty
    }
    
    // Apply decay only if penalty was previously applied
    let currentScore = history.badFaithScore;
    if (history.lastPenaltyApplied > 0) {
      const timeSinceLastPenalty = nowMs - history.lastPenaltyApplied;
      const decayFactor = Math.min(1.0, timeSinceLastPenalty / this.config.penaltyDecayMs);
      // Decay reduces score by up to 50%
      currentScore = history.badFaithScore * (1.0 - decayFactor * 0.5);
    }
    
    if (currentScore < 0.01) {
      return 1.0; // Penalty decayed to near-zero
    }
    
    return 1.0 + (currentScore * (this.config.rejectionPenaltyMultiplier - 1.0));
  }
  
  /**
   * Flag transcript with suspicious behavior indicators
   * 
   * Adds anti-gaming flags to transcript for audit/debugging.
   * Deterministic: Same inputs = same flags
   * 
   * Returns flags array and explanation. Caller should add to transcript metadata.
   */
  flagTranscript(
    transcript: TranscriptV1,
    agentId: string,
    nowMs: number = Date.now()
  ): {
    flags: string[];
    explanations: Record<string, string>;
    agentStatus: ReturnType<AntiGamingGuard["getAgentStatus"]>;
  } {
    const flags: string[] = [];
    const explanations: Record<string, string> = {};
    
    // Check rate limit status (don't modify transcript, just check)
    const rateLimitCheck = this.checkRateLimit(agentId, transcript.intent_type, nowMs);
    if (!rateLimitCheck.ok) {
      flags.push("rate_limit_exceeded");
      explanations.rate_limit_exceeded = `Agent exceeded rate limit: ${rateLimitCheck.currentCount}/${rateLimitCheck.limit} requests`;
    }
    
    // Check rejection history
    const history = this.rejectionHistory.get(agentId);
    if (history && history.badFaithScore > 0.1) {
      flags.push("bad_faith_history");
      explanations.bad_faith_history = `Bad-faith score: ${history.badFaithScore.toFixed(3)}, ${history.recentRejections.length} recent rejections`;
    }
    
    // Check for suspicious patterns in negotiation rounds
    if (transcript.negotiation_rounds) {
      const rounds = transcript.negotiation_rounds;
      if (rounds.length > 0) {
        // Check for consistently low counter-offers
        const lowOffers = rounds.filter((r) => {
          if (r.ask_price > 0) {
            return r.counter_price / r.ask_price < this.config.suspiciousBehaviorThresholds.lowPriceOffers;
          }
          return false;
        });
        if (lowOffers.length >= 2) {
          flags.push("suspicious_low_offers");
          explanations.suspicious_low_offers = `${lowOffers.length} rounds with offers ${(this.config.suspiciousBehaviorThresholds.lowPriceOffers * 100).toFixed(0)}%+ below ask`;
        }
        
        // Check for rapid rejection pattern
        if (rounds.length >= 3 && rounds.every((r) => !r.accepted)) {
          flags.push("rapid_rejection_pattern");
          explanations.rapid_rejection_pattern = `All ${rounds.length} rounds rejected`;
        }
      }
    }
    
    // Get agent status for explanation
    const agentStatus = this.getAgentStatus(agentId, nowMs);
    
    return {
      flags,
      explanations,
      agentStatus,
    };
  }
  
  /**
   * Get current agent status (for debugging/explanations)
   * 
   * Deterministic: Same agent + same time = same status
   */
  getAgentStatus(agentId: string, nowMs: number = Date.now()): {
    rateLimitCount: number;
    rateLimitLimit: number;
    badFaithScore: number;
    rejectionCount: number;
    penaltyMultiplier: number;
    flags?: string[];
  } {
    const rateLimitCheck = this.checkRateLimit(agentId, undefined, nowMs);
    const history = this.rejectionHistory.get(agentId);
    const penalty = this.getBadFaithPenalty(agentId, nowMs);
    
    const flags: string[] = [];
    if (!rateLimitCheck.ok) {
      flags.push("rate_limited");
    }
    if (history && history.badFaithScore > 0.1) {
      flags.push("bad_faith");
    }
    if (penalty > 1.01) {
      flags.push("penalty_active");
    }
    
    return {
      rateLimitCount: rateLimitCheck.currentCount || 0,
      rateLimitLimit: rateLimitCheck.limit || this.config.rateLimitPerMinute,
      badFaithScore: history?.badFaithScore || 0.0,
      rejectionCount: history?.recentRejections.length || 0,
      penaltyMultiplier: penalty,
      flags: flags.length > 0 ? flags : undefined,
    };
  }
  
  /**
   * Cleanup old entries (call periodically to prevent memory leak)
   * 
   * Removes entries older than configured windows.
   */
  cleanup(nowMs: number = Date.now()): { rateLimitsRemoved: number; rejectionsRemoved: number } {
    let rateLimitsRemoved = 0;
    let rejectionsRemoved = 0;
    
    // Cleanup rate limits (older than window)
    const rateLimitCutoff = nowMs - this.config.rateLimitWindowMs * 2; // Keep 2x window for safety
    for (const [key, limit] of this.rateLimits.entries()) {
      if (limit.lastCleanup < rateLimitCutoff && limit.requests.length === 0) {
        this.rateLimits.delete(key);
        rateLimitsRemoved++;
      }
    }
    
    // Cleanup rejection history (older than window * 2)
    const rejectionCutoff = nowMs - this.config.badFaithWindowMs * 2;
    for (const [agentId, history] of this.rejectionHistory.entries()) {
      const activeRejections = history.recentRejections.filter((r) => r.timestamp > rejectionCutoff);
      if (activeRejections.length === 0 && history.badFaithScore < 0.01) {
        this.rejectionHistory.delete(agentId);
        rejectionsRemoved++;
      } else {
        history.recentRejections = activeRejections;
      }
    }
    
    return { rateLimitsRemoved, rejectionsRemoved };
  }
}
