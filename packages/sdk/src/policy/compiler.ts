import type {
  PactPolicy,
  CompiledPolicy,
  PerIntentConstraints,
} from "./types";

export function compilePolicy(policy: PactPolicy): CompiledPolicy {
  const compiled: CompiledPolicy = {
    base: policy,
    perIntent: {},
    trustConfig: policy.base.kya.trust,
  };

  // Compute per-intent constraints by merging counterparty.intent_specific overrides
  if (policy.counterparty.intent_specific) {
    for (const [intent, override] of Object.entries(policy.counterparty.intent_specific)) {
      const constraints: PerIntentConstraints = {};

      // Use intent-specific values, fallback to base counterparty values
      constraints.minReputation = override.min_reputation ?? policy.counterparty.min_reputation;
      constraints.requiredCredentials = override.require_credentials.length > 0
        ? override.require_credentials
        : policy.counterparty.require_credentials;

      // Get max_rounds from negotiation (base) and apply new-agent friction if needed
      // New-agent friction is applied at guard time based on context
      constraints.maxRounds = policy.negotiation.max_rounds;

      // Apply new-agent friction: reduce max_rounds by admission.new_agent.max_rounds
      // This will be further adjusted at guard time if is_new_agent is true
      if (policy.admission.new_agent.max_rounds < constraints.maxRounds) {
        // The actual reduction happens at guard time, but we can note it here
        // For now, we keep the base max_rounds
      }

      compiled.perIntent[intent] = constraints;
    }
  }

  // Compute normalized firmQuoteRange (ensuring within time min/max)
  const firmRange = policy.negotiation.firm_quote_valid_for_ms_range;
  const minValidFor = policy.time.min_valid_for_ms;
  const maxValidFor = policy.time.max_valid_for_ms;

  compiled.firmQuoteRange = {
    min_ms: Math.max(firmRange[0], minValidFor),
    max_ms: Math.min(firmRange[1], maxValidFor),
  };

  // Compute reference band from economics.reference_price
  // Note: p50_ms would come from receipt history in practice
  // For compilation, we compute the band structure but p50 is runtime
  // The band_multiplier is in band_pct (as percentage, e.g., 0.35 = 35%)
  // We'll compute the range when p50 is provided at runtime
  // For now, we just store the configuration
  if (policy.economics.reference_price.band_pct !== undefined) {
    // The actual range will be computed at guard time with p50
    // We store the multiplier here for reference
  }

  return compiled;
}

export function requiredSellerBond(
  price: number,
  bondConfig: { seller_bond_multiple: number; seller_min_bond: number; new_agent_multiplier?: number },
  isNewAgent: boolean
): number {
  let bond = price * bondConfig.seller_bond_multiple;
  
  // Apply new-agent multiplier if applicable
  if (isNewAgent && bondConfig.new_agent_multiplier !== undefined) {
    bond = bond * bondConfig.new_agent_multiplier;
  }
  
  // Ensure bond meets minimum requirement
  return Math.max(bond, bondConfig.seller_min_bond);
}

export function allowedQuoteRange(
  p50: number,
  bandPct: number,
  urgent: boolean,
  allowOverride: boolean
): { min_ms: number; max_ms: number } {
  // band_pct is a percentage value (0-10 range in schema)
  // Schema example shows 0.35 which means 35%, so we treat it as a decimal multiplier
  // If value is > 1, assume it's a percentage (e.g., 35 = 35%) and divide by 100
  // Otherwise, use as decimal directly (e.g., 0.35 = 35%)
  const bandDecimal = bandPct > 1 ? bandPct / 100 : bandPct;
  const band = p50 * bandDecimal;
  const range = {
    min_ms: Math.max(0, p50 - band),
    max_ms: p50 + band,
  };

  // Urgent flag doesn't override if allow_band_override_if_urgent is false
  // The range calculation doesn't change; the guard will check if quote is out of band
  // and allow if urgent+override enabled
  return range;
}

export function computeReferenceBand(
  policy: PactPolicy,
  p50: number,
  urgent: boolean
): { lo: number; hi: number; enforced: boolean } {
  const use = policy.economics.reference_price.use_receipt_history;
  const allowOverride = policy.economics.reference_price.allow_band_override_if_urgent;

  if (!use) {
    return { lo: -Infinity, hi: Infinity, enforced: false };
  }

  const band = policy.economics.reference_price.band_pct;
  const lo = p50 * (1 - band);
  const hi = p50 * (1 + band);

  if (urgent && allowOverride) {
    return { lo, hi, enforced: false };
  }
  return { lo, hi, enforced: true };
}
