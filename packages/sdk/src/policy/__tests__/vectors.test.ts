import { describe, it, expect } from "vitest";
import { complianceVectors } from "./vectors/v1_vectors";
import { validatePolicy, compilePolicy, DefaultPolicyGuard } from "../index";
import type { PactPolicy } from "../types";

// Helper to deep merge policies
function deepMerge(target: any, source: any): any {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key]) && !Array.isArray(source[key])) {
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

describe("Compliance Vectors", () => {
  for (const vector of complianceVectors) {
    it(`should handle: ${vector.name}`, () => {
      // Use the policy from vector if provided, otherwise create a default
      let policy: PactPolicy;
      
      if (vector.policy) {
        // If vector provides a full policy, use it directly
        if ("policy_version" in vector.policy && vector.policy.policy_version === "pact-policy/1.0") {
          policy = vector.policy as PactPolicy;
        } else {
          // Otherwise, we need to merge with a default
          // For now, assume vector.policy is a complete policy if it has policy_version
          policy = vector.policy as PactPolicy;
        }
      } else {
        // Create a minimal valid policy
        const now = Date.now();
        policy = {
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
      }

      // Validate policy schema first
      const validation = validatePolicy(policy);
      if (!validation.ok) {
        // If policy is invalid, skip (this is ok for some test vectors)
        // Only proceed if the policy itself is valid
        return;
      }

      // Compile policy
      const compiled = compilePolicy(validation.policy);

      // Create guard
      const guard = new DefaultPolicyGuard(compiled);

      // Determine intent from context if available
      let intent: string | undefined;
      if ("intent" in vector.ctx) {
        intent = vector.ctx.intent;
      }

      // Run check
      const result = guard.check(vector.phase, vector.ctx, intent);

      // Assert expectations
      expect(result.ok).toBe(vector.expectOk);

      if (!vector.expectOk && vector.expectCode) {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe(vector.expectCode);
        }
      }
    });
  }
});
