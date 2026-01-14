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
  // v2 Phase 2+: Chain and asset awareness
  chain?: string; // Chain identifier (e.g., "ethereum", "solana", "base")
  asset?: string; // Asset symbol (e.g., "USDC", "ETH", "SOL")
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

