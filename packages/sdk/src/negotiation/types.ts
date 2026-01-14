/**
 * Negotiation Types
 * 
 * Types for negotiation strategies and negotiation logs.
 */

export type NegotiationRound = {
  round: number;
  timestamp_ms: number;
  decision: NegotiationDecision;
};

export type NegotiationDecision = 
  | { type: "start"; quote_price: number; max_price: number }
  | { type: "counteroffer"; buyer_price: number; provider_price: number }
  | { type: "accepted_quote"; price: number }
  | { type: "rejected"; reason: string }
  | { type: "timeout"; reason: string }
  | { type: "done"; final_price: number };

export type NegotiationLogEntry = {
  round: number;
  timestamp_ms: number;
  decision: NegotiationDecision;
};

export type NegotiationInput = {
  intent_type: string;
  buyer_id: string;
  provider_id: string;
  reference_price?: number; // Optional reference price (e.g., P50 from history)
  quote_price: number; // Provider's quote price
  max_price: number; // Buyer's maximum price
  band_pct?: number; // Percentage band for negotiation (default: 0, meaning no negotiation)
  max_rounds?: number; // Maximum negotiation rounds (default: 1)
  max_total_duration_ms?: number; // Maximum total duration for negotiation
  urgent?: boolean; // Whether this is an urgent request
};

export type NegotiationResult = {
  ok: boolean;
  agreed_price: number;
  rounds_used: number;
  log: NegotiationLogEntry[];
  reason?: string; // Reason if ok=false
};

