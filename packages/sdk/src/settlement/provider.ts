/**
 * SettlementProvider Interface
 * 
 * Defines the contract for payment settlement in PACT. This interface is payment-rail agnostic:
 * implementations can use custodial wallets, on-chain smart contracts, or other payment systems.
 * 
 * Core invariants:
 * - All amounts must be >= 0
 * - Balance queries return available (unlocked) balance
 * - Locked funds are not available for payment until unlocked
 * - Operations are atomic (all-or-nothing)
 * 
 * Error behavior:
 * - Invalid amounts (< 0) should throw Error
 * - Insufficient balance should return false (for lock operations) or throw Error (for pay/slash)
 * - External providers may throw network/API errors
 */

import type { SettlementIntent, SettlementHandle, SettlementResult } from "./types";

export interface SettlementProvider {
  /**
   * Get available (unlocked) balance for an agent.
   * @param agentId Agent identifier (pubkey_b58 or similar)
   * @param chain Optional chain identifier (e.g., "ethereum", "solana")
   * @param asset Optional asset symbol (e.g., "USDC", "ETH", "SOL")
   * @returns Available balance (>= 0)
   */
  getBalance(agentId: string, chain?: string, asset?: string): number;

  /**
   * Get locked balance for an agent.
   * @param agentId Agent identifier
   * @param chain Optional chain identifier (e.g., "ethereum", "solana")
   * @param asset Optional asset symbol (e.g., "USDC", "ETH", "SOL")
   * @returns Locked balance (>= 0)
   */
  getLocked(agentId: string, chain?: string, asset?: string): number;

  // ============================================================================
  // Core Settlement Operations (Formalized)
  // ============================================================================

  /**
   * Lock funds from available balance.
   * Moves funds from available to locked state.
   * 
   * @param agentId Agent identifier
   * @param amount Amount to lock (must be >= 0)
   * @param chain Optional chain identifier (e.g., "ethereum", "solana")
   * @param asset Optional asset symbol (e.g., "USDC", "ETH", "SOL")
   * @throws Error if amount < 0 or if insufficient balance
   * 
   * Invariants:
   * - getBalance(agentId, chain, asset) decreases by amount
   * - getLocked(agentId, chain, asset) increases by amount
   * - Total (balance + locked) remains constant
   * - locked cannot go negative
   */
  lock(agentId: string, amount: number, chain?: string, asset?: string): void;

  /**
   * Release locked funds back to available balance.
   * Moves funds from locked to available state.
   * 
   * @param agentId Agent identifier
   * @param amount Amount to release (must be >= 0)
   * @param chain Optional chain identifier (e.g., "ethereum", "solana")
   * @param asset Optional asset symbol (e.g., "USDC", "ETH", "SOL")
   * @throws Error if amount < 0 or if amount > locked balance
   * 
   * Invariants:
   * - getLocked(agentId, chain, asset) decreases by amount
   * - getBalance(agentId, chain, asset) increases by amount
   * - Total (balance + locked) remains constant
   * - Release restores locked → balance
   */
  release(agentId: string, amount: number, chain?: string, asset?: string): void;

  /**
   * Transfer funds from one agent to another.
   * Moves funds from available balance of 'from' to available balance of 'to'.
   * 
   * @param from Source agent identifier
   * @param to Destination agent identifier
   * @param amount Amount to transfer (must be > 0)
   * @param chain Optional chain identifier (e.g., "ethereum", "solana")
   * @param asset Optional asset symbol (e.g., "USDC", "ETH", "SOL")
   * @param meta Optional metadata for the payment (intent_id, receipt_id, etc.)
   * @throws Error if amount <= 0 or if insufficient balance
   * 
   * Invariants:
   * - getBalance(from, chain, asset) decreases by amount
   * - getBalance(to, chain, asset) increases by amount
   * - Total balance across all agents remains constant
   * - Requires sufficient locked or balance (match current behavior)
   */
  pay(from: string, to: string, amount: number, chain?: string, asset?: string, meta?: Record<string, unknown>): void;

  /**
   * Slash a provider's bond and transfer to beneficiary.
   * Removes funds from provider (from locked first, then available) and credits beneficiary.
   * Used for penalty enforcement (e.g., FAILED_PROOF).
   * 
   * @param providerId Provider agent identifier (bond holder)
   * @param amount Amount to slash (must be > 0)
   * @param beneficiaryId Beneficiary agent identifier (typically buyer)
   * @param chain Optional chain identifier (e.g., "ethereum", "solana")
   * @param asset Optional asset symbol (e.g., "USDC", "ETH", "SOL")
   * @param meta Optional metadata for the slash (failure_code, receipt_id, etc.)
   * @throws Error if amount <= 0 or if provider has insufficient total balance
   * 
   * Invariants:
   * - getBalance(providerId, chain, asset) + getLocked(providerId, chain, asset) decreases by amount
   * - getBalance(beneficiaryId, chain, asset) increases by amount
   * - Prefers slashing from locked funds first
   * - Reduces provider funds and credits beneficiary (buyer)
   */
  slashBond(providerId: string, amount: number, beneficiaryId: string, chain?: string, asset?: string, meta?: Record<string, unknown>): void;

  // ============================================================================
  // Legacy/Convenience Methods (for backward compatibility)
  // ============================================================================

  /**
   * Credit funds to an agent's available balance.
   * Legacy method - equivalent to external deposit.
   * 
   * @param agentId Agent identifier
   * @param amount Amount to credit (must be >= 0)
   * @param chain Optional chain identifier (e.g., "ethereum", "solana")
   * @param asset Optional asset symbol (e.g., "USDC", "ETH", "SOL")
   * @throws Error if amount < 0
   */
  credit(agentId: string, amount: number, chain?: string, asset?: string): void;

  /**
   * Debit funds from an agent's available balance.
   * Legacy method - use pay() for transfers between agents.
   * 
   * @param agentId Agent identifier
   * @param amount Amount to debit (must be >= 0)
   * @param chain Optional chain identifier (e.g., "ethereum", "solana")
   * @param asset Optional asset symbol (e.g., "USDC", "ETH", "SOL")
   * @throws Error if amount < 0 or if insufficient balance
   */
  debit(agentId: string, amount: number, chain?: string, asset?: string): void;

  /**
   * Lock funds (legacy alias for lock()).
   * @deprecated Use lock() instead
   */
  lockFunds(agentId: string, amount: number): boolean;

  /**
   * Lock bond (legacy alias for lock()).
   * @deprecated Use lock() instead
   */
  lockBond(agentId: string, amount: number): boolean;

  /**
   * Unlock funds (legacy alias for release()).
   * @deprecated Use release() instead
   */
  unlock(agentId: string, amount: number): void;

  /**
   * Release funds to an agent (legacy alias for credit()).
   * @deprecated Use credit() or pay() instead
   */
  releaseFunds(toAgentId: string, amount: number): void;

  /**
   * Slash funds (legacy alias for slashBond()).
   * @deprecated Use slashBond() instead
   */
  slash(fromAgentId: string, toAgentId: string, amount: number): void;

  /**
   * Streaming tick payment (legacy method).
   * Transfers funds from buyer to seller for a single streaming tick.
   * 
   * @param buyerId Buyer agent identifier
   * @param sellerId Seller agent identifier
   * @param amount Amount to transfer (must be > 0)
   * @returns true if payment succeeded, false if insufficient balance
   * @throws Error if amount <= 0
   * 
   * Note: This is equivalent to pay(buyerId, sellerId, amount) but kept for clarity.
   */
  streamTick(buyerId: string, sellerId: string, amount: number): boolean;

  // ============================================================================
  // Settlement Lifecycle API (v1.6.1+)
  // ============================================================================

  /**
   * Prepare settlement by locking funds.
   * Creates a settlement handle for idempotent settlement operations.
   * 
   * @param intent Settlement intent with idempotency_key
   * @returns Settlement handle with handle_id and status "prepared"
   * @throws Error if amount < 0 or if insufficient balance
   * 
   * Idempotency: If called multiple times with the same (intent_id, idempotency_key),
   * returns the same handle (no double-locking).
   * 
   * Invariants:
   * - getBalance(from) decreases by amount
   * - getLocked(from) increases by amount
   * - Handle status is "prepared"
   * - handle_id is deterministic (derived from intent_id + idempotency_key)
   */
  prepare(intent: SettlementIntent): Promise<SettlementHandle>;

  /**
   * Commit prepared settlement by transferring locked funds.
   * Moves locked funds from buyer to seller.
   * 
   * @param handle_id Settlement handle identifier
   * @returns Settlement result with status "committed" and paid_amount
   * @throws Error if handle not found or if handle is not in "prepared" status
   * 
   * Idempotency: If called multiple times with the same handle_id,
   * returns the same result (no double-payment).
   * 
   * Invariants:
   * - getLocked(from) decreases by amount
   * - getBalance(to) increases by amount
   * - Handle status changes from "prepared" to "committed"
   */
  commit(handle_id: string): Promise<SettlementResult>;

  /**
   * Abort prepared settlement by releasing locked funds.
   * Releases locked funds back to buyer's available balance.
   * 
   * @param handle_id Settlement handle identifier
   * @param reason Optional reason for abort
   * @returns void (resolves on success)
   * @throws Error if handle not found
   * 
   * Idempotency: If called multiple times with the same handle_id,
   * returns successfully (idempotent abort is safe).
   * 
   * Invariants:
   * - getLocked(from) decreases by amount
   * - getBalance(from) increases by amount
   * - Handle status changes to "aborted"
   * - Safe to call multiple times (idempotent)
   */
  abort(handle_id: string, reason?: string): Promise<void>;

  /**
   * Poll settlement status for async operations (v1.7.2+).
   * Checks if a pending settlement has been resolved (committed or failed).
   * 
   * @param handle_id Settlement handle identifier
   * @returns Settlement result with current status (pending, committed, or failed)
   * @throws Error if handle not found
   * 
   * Idempotency: Repeated calls return the same result once resolved.
   * 
   * Default implementation: Throws NotImplemented (providers that don't support async can ignore).
   */
  poll?(handle_id: string): Promise<SettlementResult>;

  /**
   * Refund funds from seller to buyer (v1.6.8+, C2).
   * First-class refund API with idempotency support.
   * 
   * @param refund Refund parameters
   * @returns Promise resolving to refund result with ok status and refunded_amount
   * 
   * Idempotency: If called multiple times with the same dispute_id (as idempotency_key),
   * returns ok=true with the same refunded_amount without changing balances twice.
   * 
   * Invariants:
   * - getBalance(from) decreases by amount (if sufficient)
   * - getBalance(to) increases by amount
   * - Total balance across all agents remains constant
   * - Idempotent: repeated calls with same dispute_id return same result
   */
  refund?(refund: {
    dispute_id: string;
    from: string;        // seller
    to: string;          // buyer
    amount: number;
    reason?: string;
    idempotency_key?: string;
  }): Promise<{ ok: boolean; refunded_amount: number; code?: string; reason?: string }>;
}




