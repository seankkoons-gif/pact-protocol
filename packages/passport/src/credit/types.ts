/**
 * Credit v1 Types
 * 
 * Type definitions for Pact Agent Credit (undercollateralized commitments).
 */

export type CreditTier = "A" | "B" | "C";

export interface CreditTerms {
  tier: CreditTier;
  max_outstanding_exposure_usd: number;
  max_per_intent_usd: number;
  max_per_counterparty_usd: number;
  collateral_ratio: number; // 0.20 = 20% collateral, 0.50 = 50% collateral
  required_escrow: boolean;
  disabled_until?: number; // Kill switch timestamp (undefined if enabled)
  reason?: string; // Kill switch reason
}

export interface CreditDecision {
  allowed: boolean;
  required_collateral_usd: number;
  reason_codes: string[];
}

export type CreditEventReasonCode =
  | "CREDIT_EXTENDED"
  | "CREDIT_DENIED"
  | "SETTLEMENT"
  | "FAILURE"
  | "KILL_SWITCH_TRIGGERED";

export interface CreditEvent {
  id: number;
  agent_id: string;
  ts: number;
  transcript_hash: string;
  delta_usd: number; // Positive for credit extended, negative for settlement/failure
  counterparty_agent_id: string | null;
  reason_code: CreditEventReasonCode;
}

export interface CreditAccount {
  agent_id: string;
  tier: CreditTier;
  updated_at: number;
  disabled_until: number | null;
  reason: string | null;
}

export interface CreditExposure {
  agent_id: string;
  outstanding_usd: number;
  per_counterparty_json: string; // JSON: {counterparty_id: exposure_usd}
  updated_at: number;
}

export interface PerCounterpartyExposure {
  [counterparty_id: string]: number;
}
