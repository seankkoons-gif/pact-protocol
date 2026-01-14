import type { NegotiationPhase } from "./types";
import type { SettlementMode } from "../protocol/types";

export interface IdentityContext {
  credentials: Array<{
    type: string;
    issuer: string;
    [key: string]: unknown;
  }>;
  agent_id: string;
  is_new_agent?: boolean;
  region?: string;
  reputation?: number;
  failure_rate?: number;
  timeout_rate?: number;
  // v2 Phase 2+: Wallet information for on-chain identity binding
  wallet_address?: string;
  wallet_chain?: string;
  wallet_proof?: {
    signature: string;
    message: string;
    scheme: string;
  };
}

export interface IntentContext {
  now_ms: number;
  intent_type: string;
  expires_at_ms: number;
  urgent?: boolean;
  admission?: {
    has_bond?: boolean;
    has_credential?: boolean;
    has_sponsor?: boolean;
  };
  rate_limit_ok?: boolean;
  concurrency_ok?: boolean;
  budgets_ok?: boolean;
  kill_switch_triggered?: boolean;
  // Legacy fields for backward compatibility (may be removed)
  intent?: string;
  expires_at?: number;
  valid_for_ms?: number;
  session_id?: string;
  session_spend?: number;
  clock_skew_ms?: number;
  sponsors?: string[];
}

export interface NegotiationContext {
  now_ms: number;
  intent_type: string;
  round: number;
  elapsed_ms: number;
  message_type: "ASK" | "BID";
  valid_for_ms: number;
  is_firm_quote: boolean;
  quote_price: number;
  reference_price_p50: number | null;
  urgent?: boolean;
  counterparty?: {
    reputation: number;
    age_ms: number;
    region: string;
    has_required_credentials: boolean;
    failure_rate: number;
    timeout_rate: number;
    is_new: boolean;
  };
  // v2 Phase 2+: Wallet information for wallet-aware negotiation
  buyer_wallet_address?: string;
  buyer_wallet_chain?: string;
  buyer_wallet_balance?: number;
  seller_wallet_address?: string;
  seller_wallet_chain?: string;
  seller_wallet_balance?: number;
  // Legacy fields for backward compatibility (may be removed)
  intent?: string;
  firm_quote?: {
    valid_for_ms?: number;
  };
  quote_ms?: number;
  p50_ms?: number;
}

export interface LockContext {
  settlement_mode: SettlementMode;
  price: number;
  is_new_agent?: boolean;
  lock_established?: boolean;
  bond_amount?: number;
  // v2 Phase 2+: Wallet information for Phase 3 wallet-based locking (on-chain escrow)
  buyer_wallet_address?: string;
  buyer_wallet_chain?: string;
  seller_wallet_address?: string;
  seller_wallet_chain?: string;
  wallet_lock_tx_hash?: string; // Transaction hash if wallet-based locking was used
}

export interface ExchangeContext {
  schema_valid?: boolean;
  streaming_spend?: number;
  latency_ms?: number;
  freshness_ms?: number;
}

export interface ResolutionContext {
  success?: boolean;
  transcript_stored?: boolean;
  receipt_emitted?: boolean;
}

export type PhaseContext =
  | IdentityContext
  | IntentContext
  | NegotiationContext
  | LockContext
  | ExchangeContext
  | ResolutionContext;

