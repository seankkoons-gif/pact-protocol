/**
 * Reusable Provider Policy Profiles for Pact v3
 * 
 * These are pure configuration objects - no logic, just composable policy definitions.
 * 
 * Usage:
 *   import { fastSmallPurchaseProfile } from "@pact/sdk/policy/profiles";
 *   const policy = createDefaultPolicy().merge(fastSmallPurchaseProfile);
 * 
 * Design Goal: Make negotiation behavior composable and hard to copy.
 * Each profile encodes a specific negotiation strategy that can be reused across providers.
 */

import type { PactPolicy, Partial<PactPolicy> } from "./types";
import { createDefaultPolicy } from "./defaultPolicy";

/**
 * Fast Small Purchase Profile
 * 
 * Optimized for:
 * - Fast negotiation (minimal rounds)
 * - Low friction (minimal KYA requirements)
 * - Small transaction amounts
 * - Consumer-friendly experience
 * 
 * Use Case: E-commerce, micro-payments, consumer services
 */
export const fastSmallPurchaseProfile: Partial<PactPolicy> = {
  name: "fast-small-purchase",
  mode: "fastest", // Prioritize speed over price

  negotiation: {
    max_rounds: 1, // Single round: INTENT → ASK → ACCEPT (no counter-offers)
    max_total_duration_ms: 30000, // 30 seconds max
    require_firm_quotes: true,
    firm_quote_valid_for_ms_range: [5000, 30000], // 5-30 seconds
    allowed_actions: ["INTENT", "ASK", "ACCEPT", "REJECT"], // No BID (no counter-offers)
    reject_nonconforming_messages: true,
    counter_rules: {
      max_counters_by_buyer: 0, // No counter-offers allowed
      max_counters_by_seller: 0,
      min_step_pct: 0.0,
      max_step_pct: 0.0,
    },
    termination: {
      on_timeout: "TIMEOUT",
      on_invalid_message: "REJECT",
      on_invariant_violation: "REJECT",
    },
  },

  settlement: {
    allowed_modes: ["hash_reveal"], // Only hash_reveal (simpler, faster)
    default_mode: "hash_reveal",
    pre_settlement_lock_required: false, // Skip lock for speed (small amounts)
    challenge_window_ms: 60, // Short challenge window (60ms)
    streaming: {
      tick_ms: 10,
      max_spend_per_minute: 0.01, // Low spend cap
      cutoff_on_violation: true,
    },
  },

  base: {
    kya: {
      trust: {
        require_trusted_issuer: false,
        require_credential: false,
        trusted_issuers: [],
        issuer_weights: {},
        min_trust_tier: "untrusted", // No minimum trust requirement
        min_trust_score: 0.0, // Accept any trust score
      },
      zk_kya: {
        required: false, // No ZK-KYA required
        min_tier: "untrusted",
      },
    },
    disputes: {
      enabled: true,
      window_ms: 300000, // 5 minute dispute window (short for fast resolution)
      allow_partial: true,
      max_refund_pct: 1.0, // Allow full refunds
    },
  },

  counterparty: {
    min_reputation: 0.0, // Accept any reputation
    min_age_ms: 0, // No minimum age requirement
    exclude_new_agents: false, // Allow new agents
    require_credentials: [], // No credentials required
    trusted_issuers: [],
    max_failure_rate: 0.2, // Allow up to 20% failure rate
    max_timeout_rate: 0.2, // Allow up to 20% timeout rate
    region_allowlist: [], // No region restrictions
    intent_specific: {},
  },

  economics: {
    bonding: {
      seller_bond_multiple: 1.0, // Lower bond (1x price) for small amounts
      seller_min_bond: 0.000001, // Very low minimum bond
      buyer_bond_optional: true,
      buyer_bond_pct_of_price: 0.0, // No buyer bond
    },
  },
};

/**
 * Low Trust High Risk Profile
 * 
 * Optimized for:
 * - High security requirements
 * - Strict KYA verification
 * - Large dispute windows
 * - Risk mitigation for untrusted parties
 * 
 * Use Case: High-value transactions, untrusted counterparties, risk-sensitive operations
 */
export const lowTrustHighRiskProfile: Partial<PactPolicy> = {
  name: "low-trust-high-risk",
  mode: "trusted_only", // Only negotiate with trusted parties

  negotiation: {
    max_rounds: 5, // More rounds for careful negotiation
    max_total_duration_ms: 600000, // 10 minutes max
    require_firm_quotes: true,
    firm_quote_valid_for_ms_range: [60000, 300000], // 1-5 minutes
    allowed_actions: ["INTENT", "ASK", "BID", "ACCEPT", "REJECT"],
    reject_nonconforming_messages: true,
    counter_rules: {
      max_counters_by_buyer: 3, // Allow multiple counter-offers
      max_counters_by_seller: 3,
      min_step_pct: 0.05, // Minimum 5% step for meaningful negotiation
      max_step_pct: 0.3, // Maximum 30% step (prevent wild swings)
    },
    termination: {
      on_timeout: "TIMEOUT",
      on_invalid_message: "REJECT",
      on_invariant_violation: "REJECT",
    },
  },

  settlement: {
    allowed_modes: ["hash_reveal"], // Only hash_reveal (more secure, auditable)
    default_mode: "hash_reveal",
    pre_settlement_lock_required: true, // Require pre-lock (funds must be locked first)
    challenge_window_ms: 3600000, // 1 hour challenge window (long for disputes)
    streaming: {
      tick_ms: 60,
      max_spend_per_minute: 0.5, // Higher spend cap
      cutoff_on_violation: true,
    },
  },

  base: {
    kya: {
      trust: {
        require_trusted_issuer: true, // Require trusted issuer
        require_credential: true, // Require credentials
        trusted_issuers: ["pact-official", "verifiable-credentials"], // Only trusted issuers
        issuer_weights: {
          "pact-official": 1.0,
          "verifiable-credentials": 0.8,
        },
        min_trust_tier: "trusted", // Require "trusted" tier minimum
        min_trust_score: 0.8, // Require 80% trust score
      },
      zk_kya: {
        required: true, // Require ZK-KYA proof
        min_tier: "trusted", // Minimum "trusted" tier
        require_issuer: true,
        allowed_issuers: ["pact-zk-issuer"], // Only specific ZK issuers
      },
    },
    disputes: {
      enabled: true,
      window_ms: 86400000, // 24 hour dispute window (long for risk mitigation)
      allow_partial: false, // No partial refunds (all-or-nothing)
      max_refund_pct: 1.0,
    },
  },

  counterparty: {
    min_reputation: 0.85, // High reputation requirement (85%)
    min_age_ms: 604800000, // 7 days minimum age (1 week)
    exclude_new_agents: true, // Exclude brand new agents
    require_credentials: ["identity_verified", "kyc_complete"], // Require specific credentials
    trusted_issuers: ["pact-official"],
    max_failure_rate: 0.01, // Max 1% failure rate (very strict)
    max_timeout_rate: 0.01, // Max 1% timeout rate (very strict)
    region_allowlist: [], // Can add region restrictions if needed
    intent_specific: {},
  },

  economics: {
    bonding: {
      seller_bond_multiple: 5.0, // High bond (5x price) for risk mitigation
      seller_min_bond: 0.001, // Higher minimum bond
      buyer_bond_optional: false, // Require buyer bond
      buyer_bond_pct_of_price: 0.2, // 20% buyer bond
    },
  },
};

/**
 * Enterprise Compliance Profile
 * 
 * Optimized for:
 * - Maximum auditability and compliance
 * - Strict regulatory requirements
 * - Long retention windows
 * - Enterprise-grade security
 * 
 * Use Case: Enterprise services, regulated industries, compliance-critical applications
 */
export const enterpriseComplianceProfile: Partial<PactPolicy> = {
  name: "enterprise-compliance",
  mode: "balanced", // Balance between speed, price, and security

  negotiation: {
    max_rounds: 3, // Moderate rounds (3 rounds standard)
    max_total_duration_ms: 300000, // 5 minutes max
    require_firm_quotes: true, // All quotes must be firm
    firm_quote_valid_for_ms_range: [30000, 180000], // 30 seconds to 3 minutes
    allowed_actions: ["INTENT", "ASK", "BID", "ACCEPT", "REJECT"],
    reject_nonconforming_messages: true, // Strict message validation
    counter_rules: {
      max_counters_by_buyer: 2, // Allow 2 counter-offers max
      max_counters_by_seller: 2,
      min_step_pct: 0.03, // 3% minimum step
      max_step_pct: 0.2, // 20% maximum step
    },
    termination: {
      on_timeout: "TIMEOUT",
      on_invalid_message: "REJECT",
      on_invariant_violation: "REJECT",
    },
  },

  settlement: {
    allowed_modes: ["hash_reveal"], // Only hash_reveal (most auditable)
    default_mode: "hash_reveal",
    pre_settlement_lock_required: true, // Require pre-lock for compliance
    challenge_window_ms: 7200000, // 2 hour challenge window (compliance window)
    streaming: {
      tick_ms: 30,
      max_spend_per_minute: 0.1,
      cutoff_on_violation: true,
    },
  },

  base: {
    kya: {
      trust: {
        require_trusted_issuer: true, // Require trusted issuer
        require_credential: true, // Require credentials
        trusted_issuers: ["enterprise-issuer", "compliance-issuer"], // Compliance-approved issuers
        issuer_weights: {
          "enterprise-issuer": 1.0,
          "compliance-issuer": 1.0,
        },
        min_trust_tier: "trusted", // Require "trusted" tier
        min_trust_score: 0.9, // High trust score requirement (90%)
      },
      zk_kya: {
        required: true, // Require ZK-KYA for compliance
        min_tier: "trusted", // Minimum "trusted" tier
        require_issuer: true,
        allowed_issuers: ["enterprise-zk-issuer", "compliance-zk-issuer"], // Compliance-approved ZK issuers
      },
    },
    disputes: {
      enabled: true,
      window_ms: 259200000, // 72 hour dispute window (3 days for enterprise review)
      allow_partial: true, // Allow partial refunds
      max_refund_pct: 1.0,
    },
  },

  counterparty: {
    min_reputation: 0.9, // Very high reputation requirement (90%)
    min_age_ms: 2592000000, // 30 days minimum age (1 month)
    exclude_new_agents: true, // Exclude new agents
    require_credentials: [
      "enterprise_verified",
      "kyc_complete",
      "compliance_approved",
      "audit_trail_enabled",
    ], // Enterprise credentials required
    trusted_issuers: ["enterprise-issuer", "compliance-issuer"],
    max_failure_rate: 0.005, // Max 0.5% failure rate (very strict)
    max_timeout_rate: 0.005, // Max 0.5% timeout rate (very strict)
    region_allowlist: [], // Can restrict to specific regions for compliance
    intent_specific: {},
  },

  economics: {
    bonding: {
      seller_bond_multiple: 3.0, // High bond (3x price) for enterprise
      seller_min_bond: 0.01, // Higher minimum bond
      buyer_bond_optional: false, // Require buyer bond
      buyer_bond_pct_of_price: 0.15, // 15% buyer bond
    },
  },

  observability: {
    emit_receipts: true, // Emit receipts for audit trail
    receipt_fields: [
      "intent_type",
      "agreed_price",
      "seller_id",
      "buyer_id",
      "timestamp_ms",
      "settlement_mode",
    ], // Full receipt fields for compliance
    store_full_transcripts: true, // Store full transcripts (compliance requirement)
    expose_explanations: {
      enabled: true,
      max_detail: "coarse", // Detailed explanations for audit (coarse is max level)
    },
  },

  anti_gaming: {
    rate_limits: {
      per_agent_per_intent_per_min: 10, // Lower rate limit (10/min vs default 30/min)
      max_concurrent_negotiations: 5, // Lower concurrency (5 vs default 10)
      probe_retry_cost: 0.0000001, // Higher probe cost
    },
    quote_accountability: {
      min_honor_rate: 0.98, // Very high honor rate requirement (98%)
      penalty_on_low_honor: {
        increase_bond_multiplier: 0.5, // Higher penalty
      },
    },
    collusion: {
      min_economic_substance: 0.0001, // Higher minimum economic substance
      max_counterparty_concentration_pct: 0.4, // Lower concentration (40% vs default 60%)
      rep_gain_discount_on_clique: 0.3, // Higher discount for collusion detection
    },
  },
};

/**
 * Helper function to create a policy from a profile
 * 
 * Usage:
 *   import { createPolicyFromProfile, fastSmallPurchaseProfile } from "@pact/sdk";
 *   const policy = createPolicyFromProfile(fastSmallPurchaseProfile, { policy_id: "custom-123" });
 * 
 * Note: This performs a deep merge. Nested objects are merged, not replaced.
 */
export function createPolicyFromProfile(
  profile: Partial<PactPolicy>,
  overrides?: Partial<PactPolicy>
): PactPolicy {
  const base = createDefaultPolicy();
  const now = Date.now();

  // Deep merge profile into base policy
  // Note: Partial merge means only provided fields are overridden
  const merged: PactPolicy = {
    ...base,
    ...profile,
    policy_id: overrides?.policy_id || profile.policy_id || base.policy_id,
    name: profile.name || base.name,
    mode: profile.mode || base.mode,
    created_at_ms: overrides?.created_at_ms || now,
    updated_at_ms: overrides?.updated_at_ms || now,
    negotiation: profile.negotiation
      ? { ...base.negotiation, ...profile.negotiation }
      : base.negotiation,
    settlement: profile.settlement
      ? { ...base.settlement, ...profile.settlement }
      : base.settlement,
    base: {
      ...base.base,
      ...profile.base,
      kya: profile.base?.kya
        ? {
            ...base.base.kya,
            ...profile.base.kya,
            trust: {
              ...base.base.kya.trust,
              ...profile.base.kya.trust,
            },
            zk_kya: {
              ...base.base.kya.zk_kya,
              ...profile.base.kya.zk_kya,
            },
          }
        : base.base.kya,
      disputes: profile.base?.disputes
        ? { ...base.base.disputes, ...profile.base.disputes }
        : base.base.disputes,
    },
    counterparty: profile.counterparty
      ? { ...base.counterparty, ...profile.counterparty }
      : base.counterparty,
    economics: profile.economics
      ? {
          ...base.economics,
          ...profile.economics,
          bonding: profile.economics.bonding
            ? { ...base.economics.bonding, ...profile.economics.bonding }
            : base.economics.bonding,
        }
      : base.economics,
    observability: profile.observability
      ? { ...base.observability, ...profile.observability }
      : base.observability,
    anti_gaming: profile.anti_gaming
      ? { ...base.anti_gaming, ...profile.anti_gaming }
      : base.anti_gaming,
    ...overrides,
  };

  return merged;
}
