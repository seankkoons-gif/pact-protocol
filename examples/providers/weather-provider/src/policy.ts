/**
 * Negotiation Policy - Fast Small Purchase Profile
 * 
 * Configured for fast, small transactions with relaxed requirements.
 */

import type { PactPolicy } from "@pact/sdk";
import { createDefaultPolicy } from "@pact/sdk";

/**
 * Fast small purchase policy profile
 * 
 * Optimized for:
 * - Fast negotiation (fewer rounds)
 * - Small transaction values (lower bonds)
 * - Relaxed trust requirements (faster onboarding)
 */
export const defaultPolicy: PactPolicy = (() => {
  const policy = createDefaultPolicy();

  // Fast mode: prioritize speed
  policy.mode = "fastest";

  // Relaxed trust requirements for small purchases
  policy.counterparty.min_reputation = 0.0;
  policy.counterparty.exclude_new_agents = false;

  // Faster negotiation (fewer rounds)
  policy.negotiation.max_rounds = 2;
  policy.negotiation.max_total_duration_ms = 150;

  // Lower bonds for small purchases
  policy.economics.bonding.seller_bond_multiple = 1.5;
  policy.economics.bonding.seller_min_bond = 0.000005;

  // Relaxed SLA (for small/fast transactions)
  policy.sla.max_latency_ms = 500;
  policy.sla.max_freshness_sec = 300;

  // Allow max_price from buyer policy
  // (policy enforcement happens via policyGuard.checkIntent())

  return policy;
})();
