import { describe, it, expect } from "vitest";
import { compilePolicy, requiredSellerBond, allowedQuoteRange } from "../compiler";
import type { PactPolicy } from "../types";

// Helper to create a valid default policy
function createDefaultPolicy(overrides?: Partial<PactPolicy>): PactPolicy {
  const now = Date.now();
  const base: PactPolicy = {
    policy_version: "pact-policy/1.0",
    policy_id: "test-policy-12345678",
    name: "test-policy",
    mode: "balanced",
    created_at_ms: now,
    updated_at_ms: now,
    base: {
      kya: {
        trust: {
          require_trusted_issuer: false,
          trusted_issuers: ["self"],
          issuer_weights: { "self": 0.2 },
          min_trust_score: 0.0,
        },
      },
    },
    time: {
      max_clock_skew_ms: 5000,
      require_expires_at: false,
      default_message_ttl_ms: 200,
      min_valid_for_ms: 10,
      max_valid_for_ms: 5000,
    },
    admission: {
      require_one_of: ["bond"],
      min_open_bond: 0.000001,
      refund_open_bond_on_terminal: true,
      open_bond_forfeit_on_timeout_by_initiator: 0.0000002,
      require_session_keys: false,
      session_max_spend_per_hour: 0.05,
      session_intent_allowlist: [],
      new_agent: {
        is_new_below_reputation: 0.6,
        max_rounds: 1,
        bond_multiplier: 2.0,
        max_concurrent_negotiations: 2,
      },
    },
    negotiation: {
      max_rounds: 3,
      max_total_duration_ms: 300,
      require_firm_quotes: false,
      firm_quote_valid_for_ms_range: [20, 200],
      allowed_actions: ["INTENT", "ASK", "BID", "ACCEPT", "REJECT"],
      reject_nonconforming_messages: true,
      counter_rules: {
        max_counters_by_buyer: 1,
        max_counters_by_seller: 1,
        min_step_pct: 0.02,
        max_step_pct: 0.5,
      },
      termination: {
        on_timeout: "TIMEOUT",
        on_invalid_message: "REJECT",
        on_invariant_violation: "REJECT",
      },
    },
    counterparty: {
      min_reputation: 0.75,
      min_age_ms: 0,
      exclude_new_agents: false,
      require_credentials: [],
      trusted_issuers: [],
      max_failure_rate: 0.05,
      max_timeout_rate: 0.05,
      region_allowlist: [],
      intent_specific: {},
    },
    sla: {
      max_latency_ms: 50,
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
        lookback_count: 200,
        band_pct: 0.35,
        allow_band_override_if_urgent: true,
      },
      bonding: {
        seller_bond_multiple: 2.0,
        seller_min_bond: 0.00001,
        buyer_bond_optional: true,
        buyer_bond_pct_of_price: 0.1,
      },
      timeout_fees: {
        buyer_timeout_fee: 0.0000001,
        seller_timeout_fee: 0.0000001,
      },
    },
    settlement: {
      allowed_modes: ["hash_reveal", "streaming"],
      default_mode: "hash_reveal",
      pre_settlement_lock_required: false,
      challenge_window_ms: 150,
      streaming: {
        tick_ms: 20,
        max_spend_per_minute: 0.02,
        cutoff_on_violation: true,
      },
    },
    anti_gaming: {
      rate_limits: {
        per_agent_per_intent_per_min: 30,
        max_concurrent_negotiations: 10,
        probe_retry_cost: 0.00000005,
      },
      quote_accountability: {
        min_honor_rate: 0.95,
        penalty_on_low_honor: {
          increase_bond_multiplier: 0.25,
        },
      },
      collusion: {
        min_economic_substance: 0.00001,
        max_counterparty_concentration_pct: 0.6,
        rep_gain_discount_on_clique: 0.5,
      },
    },
    observability: {
      emit_receipts: true,
      receipt_fields: ["intent_type", "agreed_price"],
      store_full_transcripts: false,
      expose_explanations: {
        enabled: true,
        max_detail: "coarse",
      },
    },
    overrides: {
      allowed: true,
      types: ["policy_swap", "kill_switch", "budget_cap_update"],
      mid_round_intervention: false,
      kill_switch: {
        enabled: true,
        halt_on_trigger: true,
      },
      budgets: {
        max_spend_per_day: 1.0,
        max_spend_per_intent_per_day: {},
      },
    },
  };
  return { ...base, ...overrides } as PactPolicy;
}

describe("compilePolicy", () => {
  it("should compile base policy without intent-specific overrides", () => {
    const policy = createDefaultPolicy();

    const compiled = compilePolicy(policy);
    expect(compiled.base).toBe(policy);
    expect(Object.keys(compiled.perIntent)).toHaveLength(0);
  });

  it("should merge intent-specific overrides", () => {
    const policy = createDefaultPolicy({
      counterparty: {
        min_reputation: 0.75,
        min_age_ms: 0,
        exclude_new_agents: false,
        require_credentials: ["kyc"],
        trusted_issuers: [],
        max_failure_rate: 0.05,
        max_timeout_rate: 0.05,
        region_allowlist: [],
        intent_specific: {
          "buy": {
            min_reputation: 0.85,
            require_credentials: ["kyc", "aml"],
          },
        },
      },
    });

    const compiled = compilePolicy(policy);
    expect(compiled.perIntent["buy"]).toBeDefined();
    expect(compiled.perIntent["buy"].minReputation).toBe(0.85);
    expect(compiled.perIntent["buy"].requiredCredentials).toEqual(["kyc", "aml"]);
    expect(compiled.perIntent["buy"].maxRounds).toBe(3); // From negotiation.max_rounds
  });

  it("should compute normalized firmQuoteRange", () => {
    const policy = createDefaultPolicy({
      time: {
        max_clock_skew_ms: 5000,
        require_expires_at: false,
        default_message_ttl_ms: 200,
        min_valid_for_ms: 2000,
        max_valid_for_ms: 10000,
      },
      negotiation: {
        max_rounds: 3,
        max_total_duration_ms: 300,
        require_firm_quotes: false,
        firm_quote_valid_for_ms_range: [1000, 20000],
        allowed_actions: ["INTENT", "ASK", "BID", "ACCEPT", "REJECT"],
        reject_nonconforming_messages: true,
        counter_rules: {
          max_counters_by_buyer: 1,
          max_counters_by_seller: 1,
          min_step_pct: 0.02,
          max_step_pct: 0.5,
        },
        termination: {
          on_timeout: "TIMEOUT",
          on_invalid_message: "REJECT",
          on_invariant_violation: "REJECT",
        },
      },
    });

    const compiled = compilePolicy(policy);
    expect(compiled.firmQuoteRange).toBeDefined();
    expect(compiled.firmQuoteRange?.min_ms).toBe(2000); // normalized to time.min
    expect(compiled.firmQuoteRange?.max_ms).toBe(10000); // normalized to time.max
  });

  it("should not mutate original policy", () => {
    const policy = createDefaultPolicy();

    const compiled = compilePolicy(policy);
    expect(compiled.base).toBe(policy); // Same reference is ok
    expect(compiled.base.negotiation.max_rounds).toBe(3);
  });
});

describe("requiredSellerBond", () => {
  it("should calculate base bond", () => {
    const bond = requiredSellerBond(1000, { seller_bond_multiple: 0.1, seller_min_bond: 0 }, false);
    expect(bond).toBe(100); // 0.1 * 1000
  });

  it("should apply new-agent multiplier", () => {
    const bond = requiredSellerBond(1000, { seller_bond_multiple: 0.1, seller_min_bond: 0, new_agent_multiplier: 2.0 }, true);
    expect(bond).toBe(200); // 0.1 * 1000 * 2.0
  });

  it("should use seller_bond_multiple as default multiplier if not specified", () => {
    const bond = requiredSellerBond(1000, { seller_bond_multiple: 0.1, seller_min_bond: 0 }, true);
    expect(bond).toBe(100); // 0.1 * 1000 * 1.0 (no new agent multiplier specified)
  });

  it("should respect seller_min_bond", () => {
    const bond = requiredSellerBond(100, { seller_bond_multiple: 0.01, seller_min_bond: 10 }, false);
    expect(bond).toBe(10); // max(1, 10) = 10
  });
});

describe("allowedQuoteRange", () => {
  it("should calculate range from p50 and multiplier", () => {
    const range = allowedQuoteRange(1000, 0.35, false, false);
    // band_pct = 0.35 (35%), so band = 1000 * 0.35 = 350
    expect(range.min_ms).toBe(650); // max(0, 1000 - 350)
    expect(range.max_ms).toBe(1350); // 1000 + 350
  });

  it("should respect urgent override flag (range calculation doesn't change)", () => {
    const range = allowedQuoteRange(1000, 0.35, true, true);
    // Range calculation doesn't change, but guard will allow override
    expect(range.min_ms).toBe(650);
    expect(range.max_ms).toBe(1350);
  });
});
