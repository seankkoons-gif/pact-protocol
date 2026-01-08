import type {
  PactPolicy,
  NegotiationPhase,
  FailureCode,
} from "../../types";
import type { PhaseContext, IdentityContext, IntentContext, NegotiationContext, LockContext, ExchangeContext, ResolutionContext } from "../../context";

export interface ComplianceVector {
  name: string;
  phase: NegotiationPhase;
  policy?: Partial<PactPolicy>;
  ctx: PhaseContext;
  expectOk: boolean;
  expectCode?: FailureCode;
}

// Helper to create a valid default policy
function createDefaultPolicy(overrides?: Partial<PactPolicy>): PactPolicy {
  const now = Date.now();
  return {
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
    ...overrides,
  };
}

// Deep merge helper for nested objects
function deepMerge(target: any, source: any): any {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item: any): boolean {
  return item && typeof item === "object" && !Array.isArray(item);
}

export const complianceVectors: ComplianceVector[] = [
  // A) Time semantics
  {
    name: "missing_expires_at_when_required",
    phase: "intent",
    policy: createDefaultPolicy({
      time: {
        max_clock_skew_ms: 5000,
        require_expires_at: true,
        default_message_ttl_ms: 200,
        min_valid_for_ms: 10,
        max_valid_for_ms: 5000,
      },
    }),
    ctx: {
      intent: "buy",
    } as IntentContext,
    expectOk: false,
    expectCode: "MISSING_EXPIRES_AT",
  },
  {
    name: "intent_expired",
    phase: "intent",
    policy: createDefaultPolicy(),
    ctx: {
      intent: "buy",
      expires_at: Date.now() - 1000,
    } as IntentContext,
    expectOk: false,
    expectCode: "INTENT_EXPIRED",
  },
  {
    name: "valid_for_below_min",
    phase: "intent",
    policy: createDefaultPolicy({
      time: {
        max_clock_skew_ms: 5000,
        require_expires_at: false,
        default_message_ttl_ms: 200,
        min_valid_for_ms: 5000,
        max_valid_for_ms: 50000,
      },
    }),
    ctx: {
      intent: "buy",
      valid_for_ms: 1000,
    } as IntentContext,
    expectOk: false,
    expectCode: "VALID_FOR_TOO_SHORT",
  },
  {
    name: "valid_for_above_max",
    phase: "intent",
    policy: createDefaultPolicy({
      time: {
        max_clock_skew_ms: 5000,
        require_expires_at: false,
        default_message_ttl_ms: 200,
        min_valid_for_ms: 10,
        max_valid_for_ms: 3600000,
      },
    }),
    ctx: {
      intent: "buy",
      valid_for_ms: 7200000,
    } as IntentContext,
    expectOk: false,
    expectCode: "VALID_FOR_TOO_LONG",
  },
  {
    name: "clock_skew_too_large",
    phase: "intent",
    policy: createDefaultPolicy({
      time: {
        max_clock_skew_ms: 5000,
        require_expires_at: false,
        default_message_ttl_ms: 200,
        min_valid_for_ms: 10,
        max_valid_for_ms: 5000,
      },
    }),
    ctx: {
      intent: "buy",
      clock_skew_ms: 10000,
    } as IntentContext,
    expectOk: false,
    expectCode: "CLOCK_SKEW_TOO_LARGE",
  },

  // B) Admission & session
  {
    name: "intent_not_in_allowlist",
    phase: "intent",
    policy: createDefaultPolicy({
      admission: {
        require_one_of: ["bond"],
        min_open_bond: 0.000001,
        refund_open_bond_on_terminal: true,
        open_bond_forfeit_on_timeout_by_initiator: 0.0000002,
        require_session_keys: false,
        session_max_spend_per_hour: 0.05,
        session_intent_allowlist: ["sell"],
        new_agent: {
          is_new_below_reputation: 0.6,
          max_rounds: 1,
          bond_multiplier: 2.0,
          max_concurrent_negotiations: 2,
        },
      },
    }),
    ctx: {
      intent: "buy",
    } as IntentContext,
    expectOk: false,
    expectCode: "INTENT_NOT_ALLOWED",
  },
  {
    name: "session_spend_cap_exceeded",
    phase: "intent",
    policy: createDefaultPolicy({
      admission: {
        require_one_of: ["bond"],
        min_open_bond: 0.000001,
        refund_open_bond_on_terminal: true,
        open_bond_forfeit_on_timeout_by_initiator: 0.0000002,
        require_session_keys: false,
        session_max_spend_per_hour: 10000,
        session_intent_allowlist: [],
        new_agent: {
          is_new_below_reputation: 0.6,
          max_rounds: 1,
          bond_multiplier: 2.0,
          max_concurrent_negotiations: 2,
        },
      },
    }),
    ctx: {
      intent: "buy",
      session_spend: 15000,
    } as IntentContext,
    expectOk: false,
    expectCode: "SESSION_SPEND_CAP_EXCEEDED",
  },
  {
    name: "untrusted_issuer_present",
    phase: "identity",
    policy: createDefaultPolicy({
      counterparty: {
        min_reputation: 0.75,
        min_age_ms: 0,
        exclude_new_agents: false,
        require_credentials: [],
        trusted_issuers: ["trusted-issuer"],
        max_failure_rate: 0.05,
        max_timeout_rate: 0.05,
        region_allowlist: [],
        intent_specific: {},
      },
    }),
    ctx: {
      agent_id: "agent1",
      credentials: [{ type: "cred1", issuer: "untrusted-issuer" }],
    } as IdentityContext,
    expectOk: false,
    expectCode: "UNTRUSTED_ISSUER",
  },
  {
    name: "one_of_admission_satisfied_by_sponsor",
    phase: "intent",
    policy: createDefaultPolicy({
      admission: {
        require_one_of: ["sponsor_attestation"],
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
    }),
    ctx: {
      intent: "buy",
      sponsors: ["trusted-sponsor"],
    } as IntentContext,
    expectOk: true,
  },
  {
    name: "one_of_admission_failed",
    phase: "intent",
    policy: createDefaultPolicy({
      admission: {
        require_one_of: ["credential", "sponsor_attestation"],
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
    }),
    ctx: {
      intent: "buy",
    } as IntentContext,
    expectOk: false,
    expectCode: "ONE_OF_ADMISSION_FAILED",
  },

  // C) Negotiation bounds
  {
    name: "round_exceeds_max",
    phase: "negotiation",
    policy: createDefaultPolicy({
      negotiation: {
        max_rounds: 5,
        max_total_duration_ms: 60000,
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
    }),
    ctx: {
      intent: "buy",
      round: 6,
      elapsed_ms: 1000,
    } as NegotiationContext,
    expectOk: false,
    expectCode: "ROUND_EXCEEDED",
  },
  {
    name: "elapsed_exceeds_max_duration",
    phase: "negotiation",
    policy: createDefaultPolicy({
      negotiation: {
        max_rounds: 10,
        max_total_duration_ms: 60000,
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
    }),
    ctx: {
      intent: "buy",
      round: 1,
      elapsed_ms: 70000,
    } as NegotiationContext,
    expectOk: false,
    expectCode: "DURATION_EXCEEDED",
  },
  {
    name: "firm_quote_missing_valid_for",
    phase: "negotiation",
    policy: createDefaultPolicy({
      negotiation: {
        max_rounds: 10,
        max_total_duration_ms: 60000,
        require_firm_quotes: true,
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
    }),
    ctx: {
      intent: "buy",
      round: 1,
      elapsed_ms: 1000,
      firm_quote: {},
    } as NegotiationContext,
    expectOk: false,
    expectCode: "FIRM_QUOTE_MISSING_VALID_FOR",
  },
  {
    name: "firm_quote_out_of_range",
    phase: "negotiation",
    policy: createDefaultPolicy({
      time: {
        max_clock_skew_ms: 5000,
        require_expires_at: false,
        default_message_ttl_ms: 200,
        min_valid_for_ms: 500,
        max_valid_for_ms: 10000,
      },
      negotiation: {
        max_rounds: 10,
        max_total_duration_ms: 60000,
        require_firm_quotes: true,
        firm_quote_valid_for_ms_range: [1000, 5000],
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
    }),
    ctx: {
      intent: "buy",
      round: 1,
      elapsed_ms: 1000,
      firm_quote: {
        valid_for_ms: 100,
      },
    } as NegotiationContext,
    expectOk: false,
    expectCode: "FAILED_POLICY",
  },

  // D) Counterparty filters
  {
    name: "new_agent_excluded",
    phase: "identity",
    policy: createDefaultPolicy({
      counterparty: {
        min_reputation: 0.75,
        min_age_ms: 0,
        exclude_new_agents: true,
        require_credentials: [],
        trusted_issuers: [],
        max_failure_rate: 0.05,
        max_timeout_rate: 0.05,
        region_allowlist: [],
        intent_specific: {},
      },
    }),
    ctx: {
      agent_id: "agent1",
      is_new_agent: true,
      credentials: [],
    } as IdentityContext,
    expectOk: false,
    expectCode: "NEW_AGENT_EXCLUDED",
  },
  {
    name: "region_not_allowed",
    phase: "identity",
    policy: createDefaultPolicy({
      counterparty: {
        min_reputation: 0.75,
        min_age_ms: 0,
        exclude_new_agents: false,
        require_credentials: [],
        trusted_issuers: [],
        max_failure_rate: 0.05,
        max_timeout_rate: 0.05,
        region_allowlist: ["us-east"],
        intent_specific: {},
      },
    }),
    ctx: {
      agent_id: "agent1",
      region: "eu-west",
      credentials: [],
    } as IdentityContext,
    expectOk: false,
    expectCode: "REGION_NOT_ALLOWED",
  },
  {
    name: "failure_rate_too_high",
    phase: "identity",
    policy: createDefaultPolicy({
      counterparty: {
        min_reputation: 0.75,
        min_age_ms: 0,
        exclude_new_agents: false,
        require_credentials: [],
        trusted_issuers: [],
        max_failure_rate: 0.1,
        max_timeout_rate: 0.05,
        region_allowlist: [],
        intent_specific: {},
      },
    }),
    ctx: {
      agent_id: "agent1",
      failure_rate: 0.2,
      credentials: [],
    } as IdentityContext,
    expectOk: false,
    expectCode: "FAILURE_RATE_TOO_HIGH",
  },
  {
    name: "timeout_rate_too_high",
    phase: "identity",
    policy: createDefaultPolicy({
      counterparty: {
        min_reputation: 0.75,
        min_age_ms: 0,
        exclude_new_agents: false,
        require_credentials: [],
        trusted_issuers: [],
        max_failure_rate: 0.05,
        max_timeout_rate: 0.1,
        region_allowlist: [],
        intent_specific: {},
      },
    }),
    ctx: {
      agent_id: "agent1",
      timeout_rate: 0.2,
      credentials: [],
    } as IdentityContext,
    expectOk: false,
    expectCode: "TIMEOUT_RATE_TOO_HIGH",
  },
  {
    name: "missing_required_credentials",
    phase: "identity",
    policy: createDefaultPolicy({
      counterparty: {
        min_reputation: 0.75,
        min_age_ms: 0,
        exclude_new_agents: false,
        require_credentials: ["kyc", "aml"],
        trusted_issuers: [],
        max_failure_rate: 0.05,
        max_timeout_rate: 0.05,
        region_allowlist: [],
        intent_specific: {},
      },
    }),
    ctx: {
      agent_id: "agent1",
      credentials: [{ type: "kyc", issuer: "issuer1" }],
    } as IdentityContext,
    expectOk: false,
    expectCode: "MISSING_REQUIRED_CREDENTIALS",
  },
  {
    name: "per_intent_override_applies_required_credentials",
    phase: "identity",
    policy: createDefaultPolicy({
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
    }),
    ctx: {
      agent_id: "agent1",
      credentials: [{ type: "kyc", issuer: "issuer1" }],
    } as IdentityContext,
    expectOk: true, // Note: per-intent checks happen at negotiation phase
  },

  // E) Reference band
  {
    name: "quote_out_of_band_when_not_urgent",
    phase: "negotiation",
    policy: createDefaultPolicy({
      economics: {
        reference_price: {
          use_receipt_history: true,
          lookback_count: 200,
          band_pct: 0.35, // 35% (as decimal)
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
    }),
    ctx: {
      intent: "buy",
      round: 1,
      elapsed_ms: 10,
      quote_price: 5000,
      urgent: false,
      reference_price_p50: 1000, // p50 for reference band calculation
    } as NegotiationContext,
    expectOk: false,
    expectCode: "FAILED_REFERENCE_BAND",
  },
  {
    name: "quote_out_of_band_allowed_when_urgent",
    phase: "negotiation",
    policy: createDefaultPolicy({
      economics: {
        reference_price: {
          use_receipt_history: true,
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
    }),
    ctx: {
      intent: "buy",
      round: 1,
      elapsed_ms: 10,
      quote_price: 5000,
      urgent: true,
      reference_price_p50: 1000, // p50 for reference band calculation
    } as NegotiationContext,
    expectOk: true,
  },
  {
    name: "urgent_does_not_override_when_flag_false",
    phase: "negotiation",
    policy: createDefaultPolicy({
      economics: {
        reference_price: {
          use_receipt_history: true,
          lookback_count: 200,
          band_pct: 0.35,
          allow_band_override_if_urgent: false,
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
    }),
    ctx: {
      intent: "buy",
      round: 1,
      elapsed_ms: 10,
      quote_price: 5000,
      urgent: true,
      reference_price_p50: 1000, // p50 for reference band calculation
    } as NegotiationContext,
    expectOk: false,
    expectCode: "FAILED_REFERENCE_BAND",
  },

  // F) Lock/escrow/bond
  {
    name: "settlement_mode_not_allowed",
    phase: "lock",
    policy: createDefaultPolicy({
      settlement: {
        allowed_modes: ["hash_reveal"],
        default_mode: "hash_reveal",
        pre_settlement_lock_required: false,
        challenge_window_ms: 150,
        streaming: {
          tick_ms: 20,
          max_spend_per_minute: 0.02,
          cutoff_on_violation: true,
        },
      },
    }),
    ctx: {
      settlement_mode: "streaming",
      price: 1000,
    } as LockContext,
    expectOk: false,
    expectCode: "SETTLEMENT_MODE_NOT_ALLOWED",
  },
  {
    name: "pre_settlement_lock_required_fails",
    phase: "lock",
    policy: createDefaultPolicy({
      settlement: {
        allowed_modes: ["hash_reveal", "streaming"],
        default_mode: "hash_reveal",
        pre_settlement_lock_required: true,
        challenge_window_ms: 150,
        streaming: {
          tick_ms: 20,
          max_spend_per_minute: 0.02,
          cutoff_on_violation: true,
        },
      },
    }),
    ctx: {
      settlement_mode: "hash_reveal",
      price: 1000,
      lock_established: false,
    } as LockContext,
    expectOk: false,
    expectCode: "PRE_SETTLEMENT_LOCK_REQUIRED",
  },
  {
    name: "seller_bond_computed_requirement_fails",
    phase: "lock",
    policy: createDefaultPolicy({
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
    }),
    ctx: {
      settlement_mode: "hash_reveal",
      price: 1000,
      is_new_agent: false,
      bond_amount: 100, // Required would be 1000 * 2.0 = 2000
    } as LockContext,
    expectOk: false,
    expectCode: "BOND_INSUFFICIENT",
  },
  {
    name: "new_agent_bond_multiplier_increases_requirement",
    phase: "lock",
    policy: createDefaultPolicy({
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
          bond_multiplier: 3.0, // Higher multiplier for new agents
          max_concurrent_negotiations: 2,
        },
      },
    }),
    ctx: {
      settlement_mode: "hash_reveal",
      price: 1000,
      is_new_agent: true,
      bond_amount: 4000, // Required would be 1000 * 2.0 * 3.0 = 6000
    } as LockContext,
    expectOk: false,
    expectCode: "BOND_INSUFFICIENT",
  },

  // G) Exchange
  {
    name: "schema_validation_failed",
    phase: "exchange",
    policy: createDefaultPolicy({
      sla: {
        max_latency_ms: 50,
        max_freshness_sec: 10,
        min_accuracy: null,
        verification: {
          require_schema_validation: true,
          schema_id: "test-schema",
          proof_type: "hash_reveal",
        },
        penalties: {
          on_latency_breach: { action: "auto_refund_pct", value: 0.5 },
          on_freshness_breach: { action: "auto_refund_pct", value: 0.5 },
          on_invalid_proof: { action: "slash_seller_bond_pct", value: 1.0 },
        },
      },
    }),
    ctx: {
      schema_valid: false,
    } as ExchangeContext,
    expectOk: false,
    expectCode: "SCHEMA_VALIDATION_FAILED",
  },
  {
    name: "streaming_spend_cap_exceeded",
    phase: "exchange",
    policy: createDefaultPolicy({
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
    }),
    ctx: {
      streaming_spend: 0.03,
    } as ExchangeContext,
    expectOk: false,
    expectCode: "STREAMING_SPEND_CAP_EXCEEDED",
  },
  {
    name: "latency_breach",
    phase: "exchange",
    policy: createDefaultPolicy({
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
    }),
    ctx: {
      latency_ms: 2000,
    } as ExchangeContext,
    expectOk: false,
    expectCode: "LATENCY_BREACH",
  },
  {
    name: "freshness_breach",
    phase: "exchange",
    policy: createDefaultPolicy({
      sla: {
        max_latency_ms: 50,
        max_freshness_sec: 5,
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
    }),
    ctx: {
      freshness_ms: 6000,
    } as ExchangeContext,
    expectOk: false,
    expectCode: "FRESHNESS_BREACH",
  },

  // H) Observability
  {
    name: "transcript_storage_forbidden",
    phase: "resolution",
    policy: createDefaultPolicy({
      observability: {
        emit_receipts: true,
        receipt_fields: ["intent_type", "agreed_price"],
        store_full_transcripts: false,
        expose_explanations: {
          enabled: true,
          max_detail: "coarse",
        },
      },
    }),
    ctx: {
      transcript_stored: true,
    } as ResolutionContext,
    expectOk: false,
    expectCode: "TRANSCRIPT_STORAGE_FORBIDDEN",
  },
  {
    name: "emit_receipts_false_still_allows_success",
    phase: "resolution",
    policy: createDefaultPolicy({
      observability: {
        emit_receipts: false,
        receipt_fields: [],
        store_full_transcripts: false,
        expose_explanations: {
          enabled: true,
          max_detail: "coarse",
        },
      },
    }),
    ctx: {
      success: true,
    } as ResolutionContext,
    expectOk: true,
  },
];
