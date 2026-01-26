/**
 * Passport v1 Policy Integration Tests
 * 
 * Tests passport v1 gating in DefaultPolicyGuard with full policy evaluation.
 */

import { describe, it, expect } from "vitest";
import { DefaultPolicyGuard } from "../defaultGuard";
import { compilePolicy } from "../compiler";
import type { PactPolicy, IdentityContext, NegotiationContext } from "../types";
import type { PassportState } from "@pact/passport/src/v1/types";

function createDefaultPolicy(overrides?: Partial<PactPolicy>): PactPolicy {
  return {
    policy_version: "pact-policy/1.0",
    policy_id: "test-policy",
    name: "Test Policy",
    mode: "balanced",
    created_at_ms: 1000000000000,
    updated_at_ms: 1000000000000,
    base: {
      kya: {
        trust: {
          require_trusted_issuer: false,
          require_credential: false,
          trusted_issuers: [],
          issuer_weights: {},
          min_trust_tier: "untrusted",
          min_trust_score: 0,
        },
      },
    },
    time: {
      max_clock_skew_ms: 5000,
      require_expires_at: true,
      default_message_ttl_ms: 30000,
      min_valid_for_ms: 1000,
      max_valid_for_ms: 300000,
    },
    admission: {
      require_one_of: [],
      min_open_bond: 0,
      refund_open_bond_on_terminal: true,
      open_bond_forfeit_on_timeout_by_initiator: 0,
      require_session_keys: false,
      session_max_spend_per_hour: 1000,
      session_intent_allowlist: [],
      new_agent: {
        is_new_below_reputation: 0.5,
        max_rounds: 3,
        bond_multiplier: 2,
        max_concurrent_negotiations: 1,
      },
    },
    negotiation: {
      max_rounds: 5,
      max_total_duration_ms: 300000,
      require_firm_quotes: false,
      firm_quote_valid_for_ms_range: [1000, 300000],
      allowed_actions: ["INTENT", "ASK", "BID", "ACCEPT", "REJECT"],
      reject_nonconforming_messages: true,
      counter_rules: {
        max_counters_by_buyer: 2,
        max_counters_by_seller: 2,
        min_step_pct: 0.05,
        max_step_pct: 0.5,
      },
      termination: {
        on_timeout: "TIMEOUT",
        on_invalid_message: "REJECT",
        on_invariant_violation: "REJECT",
      },
    },
    counterparty: {
      min_reputation: 0,
      min_age_ms: 0,
      exclude_new_agents: false,
      require_credentials: [],
      trusted_issuers: [],
      max_failure_rate: 1.0,
      max_timeout_rate: 1.0,
      region_allowlist: [],
      intent_specific: {},
      ...overrides?.counterparty,
    },
    sla: {
      max_latency_ms: 1000,
      max_freshness_sec: 10,
      min_accuracy: null,
      verification: {
        require_schema_validation: false,
        schema_id: "test-schema",
        proof_type: "hash_reveal",
      },
      penalties: {
        on_latency_breach: { action: "auto_refund_pct", value: 0.5 },
        on_freshness_breach: { action: "auto_refund_pct", value: 0.5 },
        on_invalid_proof: { action: "slash_seller_bond_pct", value: 1.0 },
      },
    },
    economics: {
      reference_price: {
        use_receipt_history: false,
        lookback_count: 10,
        band_pct: 0.2,
        allow_band_override_if_urgent: false,
      },
      bonding: {
        seller_bond_multiple: 0,
        seller_min_bond: 0,
        buyer_bond_optional: true,
        buyer_bond_pct_of_price: 0,
      },
      timeout_fees: {
        buyer_timeout_fee: 0,
        seller_timeout_fee: 0,
      },
    },
    settlement: {
      allowed_modes: ["hash_reveal", "streaming"],
      default_mode: "hash_reveal",
      pre_settlement_lock_required: false,
      challenge_window_ms: 1000,
      streaming: {
        tick_ms: 100,
        max_spend_per_minute: 1.0,
        cutoff_on_violation: true,
      },
    },
    anti_gaming: {
      rate_limits: {
        per_agent_per_intent_per_min: 10,
        max_concurrent_negotiations: 5,
        probe_retry_cost: 0.01,
      },
      quote_accountability: {
        min_honor_rate: 0.8,
        penalty_on_low_honor: {
          increase_bond_multiplier: 1.5,
        },
      },
      collusion: {
        min_economic_substance: 0.01,
        max_counterparty_concentration_pct: 50,
        rep_gain_discount_on_clique: 0.5,
      },
    },
    observability: {
      emit_receipts: true,
      receipt_fields: ["intent_type", "agreed_price"],
      store_full_transcripts: true,
      expose_explanations: {
        enabled: true,
        max_detail: "coarse",
      },
    },
    overrides: {
      allowed: false,
      types: [],
      mid_round_intervention: false,
      kill_switch: {
        enabled: false,
        halt_on_trigger: false,
      },
      budgets: {
        max_spend_per_day: 1000,
        max_spend_per_intent_per_day: {},
      },
    },
    ...overrides,
  };
}

function createPassportState(overrides?: Partial<PassportState>): PassportState {
  return {
    version: "passport/1.0",
    agent_id: "test-signer-key",
    score: 0.5,
    counters: {
      total_settlements: 10,
      successful_settlements: 8,
      disputes_lost: 1,
      disputes_won: 0,
      sla_violations: 2,
      policy_aborts: 1,
    },
    ...overrides,
  };
}

describe("Passport v1 Policy Integration", () => {
  describe("missing passport_v1 => deterministic PACT-1xx failure", () => {
    it("should fail with PASSPORT_REQUIRED when passport is missing and constraints are required", () => {
      const policy = createDefaultPolicy({
        counterparty: {
          min_reputation: 0,
          min_age_ms: 0,
          exclude_new_agents: false,
          require_credentials: [],
          trusted_issuers: [],
          max_failure_rate: 1.0,
          max_timeout_rate: 1.0,
          region_allowlist: [],
          intent_specific: {},
          passport_v1: {
            min_score: 0.0, // Any score required
          },
        },
      });

      const compiled = compilePolicy(policy);
      const guard = new DefaultPolicyGuard(compiled);

      const ctx: IdentityContext = {
        credentials: [],
        agent_id: "test-agent",
        signer_public_key_b58: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
        passport_v1: null, // Missing passport
      };

      const result = guard.check("identity", ctx);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("PASSPORT_REQUIRED");
    });

    it("should pass when passport is missing but no constraints are defined", () => {
      const policy = createDefaultPolicy({
        counterparty: {
          min_reputation: 0,
          min_age_ms: 0,
          exclude_new_agents: false,
          require_credentials: [],
          trusted_issuers: [],
          max_failure_rate: 1.0,
          max_timeout_rate: 1.0,
          region_allowlist: [],
          intent_specific: {},
          // No passport_v1 constraints
        },
      });

      const compiled = compilePolicy(policy);
      const guard = new DefaultPolicyGuard(compiled);

      const ctx: IdentityContext = {
        credentials: [],
        agent_id: "test-agent",
        signer_public_key_b58: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
        passport_v1: null,
      };

      const result = guard.check("identity", ctx);

      expect(result.ok).toBe(true);
    });
  });

  describe("low score => deterministic policy abort and evidence included", () => {
    it("should fail when passport score is below minimum", () => {
      const policy = createDefaultPolicy({
        counterparty: {
          min_reputation: 0,
          min_age_ms: 0,
          exclude_new_agents: false,
          require_credentials: [],
          trusted_issuers: [],
          max_failure_rate: 1.0,
          max_timeout_rate: 1.0,
          region_allowlist: [],
          intent_specific: {},
          passport_v1: {
            min_score: 0.8, // High threshold
          },
        },
      });

      const compiled = compilePolicy(policy);
      const guard = new DefaultPolicyGuard(compiled);

      const lowScorePassport = createPassportState({ score: 0.3 }); // Below threshold

      const ctx: IdentityContext = {
        credentials: [],
        agent_id: "test-agent",
        signer_public_key_b58: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
        passport_v1: lowScorePassport,
      };

      const result = guard.check("identity", ctx);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("PASSPORT_REQUIRED");
    });

    it("should pass when passport score meets minimum", () => {
      const policy = createDefaultPolicy({
        counterparty: {
          min_reputation: 0,
          min_age_ms: 0,
          exclude_new_agents: false,
          require_credentials: [],
          trusted_issuers: [],
          max_failure_rate: 1.0,
          max_timeout_rate: 1.0,
          region_allowlist: [],
          intent_specific: {},
          passport_v1: {
            min_score: 0.3,
          },
        },
      });

      const compiled = compilePolicy(policy);
      const guard = new DefaultPolicyGuard(compiled);

      const goodPassport = createPassportState({ score: 0.5 }); // Above threshold

      const ctx: IdentityContext = {
        credentials: [],
        agent_id: "test-agent",
        signer_public_key_b58: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
        passport_v1: goodPassport,
      };

      const result = guard.check("identity", ctx);

      expect(result.ok).toBe(true);
    });
  });

  describe("replay/live parity (same outcome)", () => {
    it("should produce same result when called multiple times with same inputs", () => {
      const policy = createDefaultPolicy({
        counterparty: {
          min_reputation: 0,
          min_age_ms: 0,
          exclude_new_agents: false,
          require_credentials: [],
          trusted_issuers: [],
          max_failure_rate: 1.0,
          max_timeout_rate: 1.0,
          region_allowlist: [],
          intent_specific: {},
          passport_v1: {
            min_score: 0.4,
            max_disputes_lost: 2,
          },
        },
      });

      const compiled = compilePolicy(policy);
      const guard = new DefaultPolicyGuard(compiled);

      const passport = createPassportState({
        score: 0.3, // Below min_score
        counters: {
          total_settlements: 10,
          successful_settlements: 8,
          disputes_lost: 1, // Within max
          disputes_won: 0,
          sla_violations: 2,
          policy_aborts: 1,
        },
      });

      const ctx: IdentityContext = {
        credentials: [],
        agent_id: "test-agent",
        signer_public_key_b58: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
        passport_v1: passport,
      };

      // Call multiple times
      const result1 = guard.check("identity", ctx);
      const result2 = guard.check("identity", ctx);
      const result3 = guard.check("identity", ctx);

      // Should be identical
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
      expect(result1.ok).toBe(false);
      expect(result1.code).toBe("PASSPORT_REQUIRED");
    });
  });

  describe("negotiation phase passport gating", () => {
    it("should check passport v1 in negotiation phase", () => {
      const policy = createDefaultPolicy({
        counterparty: {
          min_reputation: 0,
          min_age_ms: 0,
          exclude_new_agents: false,
          require_credentials: [],
          trusted_issuers: [],
          max_failure_rate: 1.0,
          max_timeout_rate: 1.0,
          region_allowlist: [],
          intent_specific: {},
          passport_v1: {
            min_successful_settlements: 10,
          },
        },
      });

      const compiled = compilePolicy(policy);
      const guard = new DefaultPolicyGuard(compiled);

      const passport = createPassportState({
        counters: {
          total_settlements: 10,
          successful_settlements: 5, // Below minimum
          disputes_lost: 1,
          disputes_won: 0,
          sla_violations: 2,
          policy_aborts: 1,
        },
      });

      const ctx: NegotiationContext = {
        now_ms: 1000000000000,
        intent_type: "weather.data",
        round: 1,
        elapsed_ms: 1000,
        message_type: "ASK",
        valid_for_ms: 5000,
        is_firm_quote: false,
        quote_price: 0.0001,
        reference_price_p50: null,
        counterparty_signer_key_b58: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
        passport_v1: passport,
      };

      const result = guard.check("negotiation", ctx);

      expect(result.ok).toBe(false);
      expect(result.code).toBe("PASSPORT_REQUIRED");
    });
  });
});
