/**
 * Settlement Provider Routing
 * 
 * Policy-driven settlement provider selection based on deterministic rules.
 */

import type { CompiledPolicy } from "../policy/types";
import type { SettlementMode } from "../protocol/types";

export interface SettlementRoutingContext {
  amount: number;
  mode: SettlementMode;
  trustTier: "untrusted" | "low" | "trusted";
  trustScore: number;
}

export interface SettlementRoutingResult {
  provider: "mock" | "stripe_like" | "external";
  matchedRuleIndex?: number;
  reason: string;
}

/**
 * Select settlement provider based on policy routing rules.
 * 
 * Rules:
 * - Start with default_provider
 * - Iterate rules in order; if all 'when' constraints match, return rule.use
 * - Amount comparisons inclusive; treat undefined as no constraint
 * 
 * @param compiledPolicy The compiled policy containing routing rules
 * @param context Routing context (amount, mode, trust tier/score)
 * @returns Selected provider and metadata about the selection
 */
export function selectSettlementProvider(
  compiledPolicy: CompiledPolicy,
  context: SettlementRoutingContext
): SettlementRoutingResult {
  const routing = compiledPolicy.base.settlement_routing;
  
  // If no routing config, default to mock
  if (!routing) {
    return {
      provider: "mock",
      reason: "No settlement_routing configured, using default 'mock'",
    };
  }

  // Validate input context (defensive programming)
  // Handle invalid amounts (NaN, Infinity, negative)
  if (!Number.isFinite(context.amount) || context.amount < 0) {
    return {
      provider: routing.default_provider,
      reason: `Invalid amount for routing: ${context.amount}, using default '${routing.default_provider}'`,
    };
  }

  // Clamp trust score to valid range [0.0, 1.0] for safety
  const validTrustScore = Math.max(0.0, Math.min(1.0, context.trustScore || 0));
  
  // Validate trust tier is one of the valid values
  const validTrustTiers: Array<"untrusted" | "low" | "trusted"> = ["untrusted", "low", "trusted"];
  const validTrustTier: "untrusted" | "low" | "trusted" = 
    validTrustTiers.includes(context.trustTier) ? context.trustTier : "untrusted";

  // Start with default provider
  let selected = routing.default_provider;
  let matchedRuleIndex: number | undefined;
  let reason = `Using default_provider: ${routing.default_provider}`;

  // Iterate rules in order
  for (let i = 0; i < routing.rules.length; i++) {
    const rule = routing.rules[i];
    const when = rule.when;

    // If no 'when' conditions, rule always matches (though this is unusual)
    if (!when) {
      selected = rule.use;
      matchedRuleIndex = i;
      reason = `Matched rule ${i} (no conditions) -> ${rule.use}`;
      break; // First match wins
    }

    // Check all conditions (all must match)
    let matches = true;

    // Amount checks (inclusive)
    if (when.min_amount !== undefined) {
      if (context.amount < when.min_amount) {
        matches = false;
      }
    }
    if (when.max_amount !== undefined) {
      if (context.amount > when.max_amount) {
        matches = false;
      }
    }

    // Mode check
    if (when.mode !== undefined) {
      if (context.mode !== when.mode) {
        matches = false;
      }
    }

    // Trust tier check (tier hierarchy: untrusted < low < trusted)
    // Defensive: validate both tier values exist in tierOrder to prevent undefined comparisons
    if (when.min_trust_tier !== undefined) {
      const tierOrder: Record<"untrusted" | "low" | "trusted", number> = {
        untrusted: 0,
        low: 1,
        trusted: 2,
      };
      const contextTierOrder = tierOrder[validTrustTier];
      const minTierOrder = tierOrder[when.min_trust_tier];
      // If either tier is invalid (undefined), don't match
      if (contextTierOrder === undefined || minTierOrder === undefined) {
        matches = false;
      } else if (contextTierOrder < minTierOrder) {
        matches = false;
      }
    }

    // Trust score check (use validated/clamped value)
    if (when.min_trust_score !== undefined) {
      if (validTrustScore < when.min_trust_score) {
        matches = false;
      }
    }

    // If all conditions match, use this rule (first match wins)
    if (matches) {
      selected = rule.use;
      matchedRuleIndex = i;
      reason = `Matched rule ${i} (conditions: ${JSON.stringify(when)}) -> ${rule.use}`;
      break; // First match wins
    }
  }

  return {
    provider: selected,
    matchedRuleIndex,
    reason,
  };
}

