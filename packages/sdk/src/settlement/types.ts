export interface SettlementAccount {
  agent_id: string;
  balance: number;
  locked: number;
}

export interface Escrow {
  id: string;
  buyer: string;
  seller: string;
  amount: number;
  bond: number;
}

// Settlement lifecycle types (v1.6.1+)
export interface SettlementIntent {
  intent_id: string;
  from: string;
  to: string;
  amount: number;
  mode: "hash_reveal" | "streaming";
  meta?: Record<string, unknown>;
  idempotency_key?: string; // Optional idempotency key for retries
  // v2 Phase 2C+: Optional chain/asset for multi-asset settlement
  chain?: string; // Chain identifier (e.g., "evm", "solana", "bitcoin")
  asset?: string; // Asset symbol (e.g., "ETH", "USDC", "BTC")
}

export interface SettlementHandle {
  handle_id: string;
  intent_id: string;
  status: "prepared" | "committed" | "aborted" | "pending"; // v1.7.2+: pending for async operations
  locked_amount: number;
  created_at_ms: number;
  meta?: Record<string, unknown>;
  // v1.7.2+: async operation tracking
  attempts?: number;
  last_attempt_ms?: number;
}

export interface SettlementResult {
  ok: boolean;
  status: "prepared" | "committed" | "aborted" | "pending" | "failed"; // v1.7.2+: pending and failed for async
  paid_amount: number;
  handle_id: string;
  meta?: Record<string, unknown>;
  // v1.7.2+: async operation tracking
  attempts?: number;
  last_attempt_ms?: number;
  failure_code?: string;
  failure_reason?: string;
}

