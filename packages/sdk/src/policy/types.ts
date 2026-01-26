// Types matching pact-policy/1.0 schema
import type { SettlementMode } from "../protocol/types";
export type { SettlementMode };
export type NegotiationPhase = "identity" | "intent" | "negotiation" | "lock" | "exchange" | "resolution";
export type PolicyMode = "best_price" | "balanced" | "fastest" | "trusted_only";

export interface KyaTrustConfig {
  require_trusted_issuer: boolean;
  require_credential: boolean;
  trusted_issuers: string[];
  issuer_weights: Record<string, number>;
  min_trust_tier: "untrusted" | "low" | "trusted";
  min_trust_score: number;
}

export interface DisputeConstraints {
  enabled: boolean;
  window_ms: number;
  allow_partial: boolean;
  max_refund_pct: number;
}

export interface ZkKyaConfig {
  /** Whether ZK-KYA proof is required */
  required?: boolean;
  
  /** Minimum trust tier required */
  min_tier?: "untrusted" | "low" | "trusted";
  
  /** Whether issuer ID is required */
  require_issuer?: boolean;
  
  /** Allowed issuer IDs (if require_issuer is true) */
  allowed_issuers?: string[];
}

export interface BaseConstraints {
  kya: {
    trust: KyaTrustConfig;
    /** ZK-KYA configuration (v2 Phase 5) */
    zk_kya?: ZkKyaConfig;
  };
  disputes?: DisputeConstraints;
}

export interface TimeConstraints {
  max_clock_skew_ms: number;
  require_expires_at: boolean;
  default_message_ttl_ms: number;
  min_valid_for_ms: number;
  max_valid_for_ms: number;
}

export interface AdmissionNewAgent {
  is_new_below_reputation: number;
  max_rounds: number;
  bond_multiplier: number;
  max_concurrent_negotiations: number;
}

export interface AdmissionConstraints {
  require_one_of: Array<"bond" | "credential" | "sponsor_attestation">;
  min_open_bond: number;
  refund_open_bond_on_terminal: boolean;
  open_bond_forfeit_on_timeout_by_initiator: number;
  require_session_keys: boolean;
  session_max_spend_per_hour: number;
  session_intent_allowlist: string[];
  new_agent: AdmissionNewAgent;
}

export interface NegotiationCounterRules {
  max_counters_by_buyer: number;
  max_counters_by_seller: number;
  min_step_pct: number;
  max_step_pct: number;
}

export interface NegotiationTermination {
  on_timeout: "TIMEOUT";
  on_invalid_message: "REJECT";
  on_invariant_violation: "REJECT";
}

export interface NegotiationConstraints {
  max_rounds: number;
  max_total_duration_ms: number;
  require_firm_quotes: boolean;
  firm_quote_valid_for_ms_range: [number, number];
  allowed_actions: Array<"INTENT" | "ASK" | "BID" | "ACCEPT" | "REJECT">;
  reject_nonconforming_messages: boolean;
  counter_rules: NegotiationCounterRules;
  termination: NegotiationTermination;
}

export interface CounterpartyIntentSpecific {
  min_reputation: number;
  require_credentials: string[];
}

export interface CounterpartyConstraints {
  min_reputation: number;
  min_age_ms: number;
  exclude_new_agents: boolean;
  require_credentials: string[];
  trusted_issuers: string[];
  max_failure_rate: number;
  max_timeout_rate: number;
  region_allowlist: string[];
  intent_specific: Record<string, CounterpartyIntentSpecific>;
  // Passport v1 constraints (optional)
  passport_v1?: {
    min_score?: number; // Minimum passport score ([-1, +1])
    min_successful_settlements?: number; // Minimum successful settlements
    max_disputes_lost?: number; // Maximum disputes lost
    max_sla_violations?: number; // Maximum SLA violations
    max_policy_aborts?: number; // Maximum policy aborts
  };
}

export interface SLAVerification {
  require_schema_validation: boolean;
  schema_id: string;
  proof_type: "hash_reveal" | "streaming";
}

export interface SLAPenaltyAction {
  action: "auto_refund_pct" | "full_refund" | "slash_seller_bond_pct";
  value: number;
}

export interface SLAPenalties {
  on_latency_breach: SLAPenaltyAction;
  on_freshness_breach: SLAPenaltyAction;
  on_invalid_proof: SLAPenaltyAction;
}

export interface SLAConstraints {
  max_latency_ms: number;
  max_freshness_sec: number;
  min_accuracy: number | null;
  verification: SLAVerification;
  penalties: SLAPenalties;
}

export interface EconomicsReferencePrice {
  use_receipt_history: boolean;
  lookback_count: number;
  band_pct: number;
  allow_band_override_if_urgent: boolean;
}

export interface EconomicsBonding {
  seller_bond_multiple: number;
  seller_min_bond: number;
  buyer_bond_optional: boolean;
  buyer_bond_pct_of_price: number;
}

export interface EconomicsTimeoutFees {
  buyer_timeout_fee: number;
  seller_timeout_fee: number;
}

export interface EconomicsConstraints {
  reference_price: EconomicsReferencePrice;
  bonding: EconomicsBonding;
  timeout_fees: EconomicsTimeoutFees;
}

export interface SettlementStreaming {
  tick_ms: number;
  max_spend_per_minute: number;
  cutoff_on_violation: boolean;
}

export interface SettlementSLAPenalty {
  enabled: boolean;
  provider_penalty: number;
  buyer_penalty: number;
}

export interface SettlementSLA {
  enabled: boolean;
  max_pending_ms: number;
  max_poll_attempts: number;
  poll_interval_ms: number;
  penalty: SettlementSLAPenalty;
}

export interface SettlementConstraints {
  allowed_modes: SettlementMode[];
  default_mode: SettlementMode;
  pre_settlement_lock_required: boolean;
  challenge_window_ms: number;
  streaming: SettlementStreaming;
  settlement_sla?: SettlementSLA;
}

export interface SettlementRoutingRule {
  when?: {
    min_amount?: number;
    max_amount?: number;
    mode?: "hash_reveal" | "streaming";
    min_trust_tier?: "untrusted" | "low" | "trusted";
    min_trust_score?: number;
  };
  use: "mock" | "stripe_like" | "external" | "stripe_live"; // v2 Phase 3: Added stripe_live
}

export interface SettlementRouting {
  default_provider: "mock" | "stripe_like" | "external" | "stripe_live"; // v2 Phase 3: Added stripe_live (but default remains "mock")
  rules: SettlementRoutingRule[];
}

export interface AntiGamingRateLimits {
  per_agent_per_intent_per_min: number;
  max_concurrent_negotiations: number;
  probe_retry_cost: number;
}

export interface AntiGamingQuoteAccountability {
  min_honor_rate: number;
  penalty_on_low_honor: {
    increase_bond_multiplier: number;
  };
}

export interface AntiGamingCollusion {
  min_economic_substance: number;
  max_counterparty_concentration_pct: number;
  rep_gain_discount_on_clique: number;
}

export interface AntiGamingConstraints {
  rate_limits: AntiGamingRateLimits;
  quote_accountability: AntiGamingQuoteAccountability;
  collusion: AntiGamingCollusion;
}

export interface ObservabilityExposeExplanations {
  enabled: boolean;
  max_detail: "none" | "coarse";
}

export interface ObservabilityConstraints {
  emit_receipts: boolean;
  receipt_fields: string[];
  store_full_transcripts: boolean;
  expose_explanations: ObservabilityExposeExplanations;
}

export interface OverridesKillSwitch {
  enabled: boolean;
  halt_on_trigger: boolean;
}

export interface OverridesBudgets {
  max_spend_per_day: number;
  max_spend_per_intent_per_day: Record<string, number>;
}

export interface OverridesConstraints {
  allowed: boolean;
  types: Array<"policy_swap" | "kill_switch" | "budget_cap_update">;
  mid_round_intervention: false;
  kill_switch: OverridesKillSwitch;
  budgets: OverridesBudgets;
}

export interface PaidFeatures {
  fast_lane?: boolean;           // Priority negotiation/settlement (v1: no-op)
  extra_fanout?: number;         // Additional sellers to query beyond default (v1: no-op)
  priority_settlement?: boolean; // Expedited settlement processing (v1: no-op)
  reputation_boost?: boolean;    // Bonded/verified reputation boost (v1: no-op, must be verified not fake)
}

export interface PactPolicy {
  policy_version: "pact-policy/1.0";
  policy_id: string;
  name: string;
  mode: PolicyMode;
  created_at_ms: number;
  updated_at_ms: number;
  base: BaseConstraints;
  time: TimeConstraints;
  admission: AdmissionConstraints;
  negotiation: NegotiationConstraints;
  counterparty: CounterpartyConstraints;
  sla: SLAConstraints;
  economics: EconomicsConstraints;
  settlement: SettlementConstraints;
  settlement_routing?: SettlementRouting; // Optional settlement provider routing rules
  anti_gaming: AntiGamingConstraints;
  observability: ObservabilityConstraints;
  overrides: OverridesConstraints;
  paid?: PaidFeatures;            // Optional paid features (v1: no-ops, reserved for future monetization)
}

// Simplified types for internal use (derived from full policy)
export interface PerIntentConstraints {
  minReputation?: number;
  requiredCredentials?: string[];
  maxRounds?: number;
}

export interface CompiledPolicy {
  base: PactPolicy;
  perIntent: Record<string, PerIntentConstraints>;
  firmQuoteRange?: {
    min_ms: number;
    max_ms: number;
  };
  referenceBand?: {
    min_ms: number;
    max_ms: number;
  };
  trustConfig?: KyaTrustConfig;
}

export type FailureCode =
  | "MISSING_EXPIRES_AT"
  | "INTENT_EXPIRED"
  | "VALID_FOR_TOO_SHORT"
  | "VALID_FOR_TOO_LONG"
  | "CLOCK_SKEW_TOO_LARGE"
  | "INTENT_NOT_ALLOWED"
  | "SESSION_SPEND_CAP_EXCEEDED"
  | "UNTRUSTED_ISSUER"
  | "ONE_OF_ADMISSION_FAILED"
  | "ROUND_EXCEEDED"
  | "DURATION_EXCEEDED"
  | "FAILED_NEGOTIATION_TIMEOUT"
  | "FIRM_QUOTE_MISSING_VALID_FOR"
  | "FIRM_QUOTE_OUT_OF_RANGE"
  | "NEW_AGENT_EXCLUDED"
  | "REGION_NOT_ALLOWED"
  | "FAILURE_RATE_TOO_HIGH"
  | "TIMEOUT_RATE_TOO_HIGH"
  | "MISSING_REQUIRED_CREDENTIALS"
  | "QUOTE_OUT_OF_BAND"
  | "FAILED_REFERENCE_BAND"
  | "SETTLEMENT_MODE_NOT_ALLOWED"
  | "PRE_SETTLEMENT_LOCK_REQUIRED"
  | "BOND_INSUFFICIENT"
  | "SETTLEMENT_FAILED" // v1.7.2+: Settlement provider commit failure
  | "SETTLEMENT_SLA_VIOLATION" // v1.6.7+: Settlement SLA timeout/poll limit exceeded
  | "SCHEMA_VALIDATION_FAILED"
  | "STREAMING_SPEND_CAP_EXCEEDED"
  | "LATENCY_BREACH"
  | "FRESHNESS_BREACH"
  | "TRANSCRIPT_STORAGE_FORBIDDEN"
  | "INVALID_POLICY"
  | "FAILED_POLICY"
  | "FAILED_PROOF"
  | "FAILED_IDENTITY"
  | "ZK_KYA_REQUIRED" // v2 Phase 5: ZK-KYA proof required but not provided
  | "ZK_KYA_NOT_IMPLEMENTED" // v2 Phase 5: ZK-KYA verifier not implemented
  | "ZK_KYA_INVALID" // v2 Phase 5: ZK-KYA proof verification failed
  | "ZK_KYA_EXPIRED" // v2 Phase 5: ZK-KYA proof expired
  | "ZK_KYA_TIER_TOO_LOW" // v2 Phase 5: ZK-KYA trust tier below minimum
  | "ZK_KYA_ISSUER_NOT_ALLOWED" // v2 Phase 5: ZK-KYA issuer not in allowed list
  | "PASSPORT_REQUIRED"; // Passport v1 required but missing

export interface ValidationResult {
  ok: true;
  policy: PactPolicy;
}

export interface ValidationError {
  ok: false;
  errors: Array<{
    path: string;
    message: string;
  }>;
}

export type PolicyValidationResult = ValidationResult | ValidationError;
