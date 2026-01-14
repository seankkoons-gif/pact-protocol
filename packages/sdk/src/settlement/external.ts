/**
 * ExternalSettlementProvider
 * 
 * Stub implementation of SettlementProvider for external payment rails.
 * This class throws NotImplemented errors for all operations, serving as a
 * template for real implementations.
 * 
 * Real implementations would integrate with:
 * 
 * 1. Custodial API (e.g., Stripe, PayPal, bank APIs):
 *    - getBalance: GET /accounts/{agentId}/balance
 *    - lock: POST /escrow/lock with {agentId, amount, intent_id}
 *    - pay: POST /transfers with {from, to, amount, metadata}
 *    - slashBond: POST /penalties/slash with {providerId, amount, beneficiaryId, reason}
 * 
 * 2. On-chain wallet (e.g., Ethereum, Solana):
 *    - getBalance: query contract balanceOf(agentId)
 *    - lock: call escrow.lock(agentId, amount) - requires transaction signing
 *    - pay: call payment.transfer(from, to, amount) - requires transaction signing
 *    - slashBond: call penalty.slash(providerId, amount, beneficiaryId) - may require governance
 * 
 * 3. Streaming meter (e.g., usage-based billing):
 *    - getBalance: query current credit balance
 *    - lock: reserve credit allocation
 *    - pay: deduct from meter, credit to seller meter
 *    - slashBond: apply penalty chargeback
 * 
 * Implementation notes:
 * - All operations should be atomic (all-or-nothing)
 * - Network/API errors should be wrapped in appropriate Error types
 * - Balance queries may require async operations (consider async interface in future)
 * - Lock/release operations may need to interact with escrow services
 * - Slash operations may require multi-signature or governance approval
 * - Meta parameters can carry intent_id, receipt_id, failure_code for audit trails
 */

import type { SettlementProvider } from "./provider";
import type { SettlementIntent, SettlementHandle, SettlementResult } from "./types";

export interface ExternalSettlementProviderConfig {
  rail: string; // e.g., "stripe", "ethereum", "solana", "custodial"
  network?: string; // e.g., "mainnet", "testnet", "sandbox"
  credentials?: unknown; // API keys, wallet seeds, etc. (type-safe in real implementations)
}

export class ExternalSettlementProvider implements SettlementProvider {
  private readonly config: ExternalSettlementProviderConfig;
  private readonly errorMessage = "ExternalSettlementProvider: NotImplemented";

  constructor(config: ExternalSettlementProviderConfig) {
    this.config = config;
  }

  getBalance(agentId: string, _chain?: string, _asset?: string): number {
    // v2 Phase 2+: chain/asset parameters accepted (real implementation would use them)
    // Read-only: return 0 for consistency (real implementation would query rail)
    return 0;
  }

  getLocked(agentId: string, _chain?: string, _asset?: string): number {
    // v2 Phase 2+: chain/asset parameters accepted (real implementation would use them)
    // Read-only: return 0 for consistency (real implementation would query rail)
    return 0;
  }

  // Core operations
  lock(agentId: string, amount: number, _chain?: string, _asset?: string): void {
    // v2 Phase 2+: chain/asset parameters accepted (real implementation would use them)
    throw new Error(this.errorMessage);
  }

  release(agentId: string, amount: number, _chain?: string, _asset?: string): void {
    // v2 Phase 2+: chain/asset parameters accepted (real implementation would use them)
    throw new Error(this.errorMessage);
  }

  pay(from: string, to: string, amount: number, _chain?: string, _asset?: string, meta?: Record<string, unknown>): void {
    // v2 Phase 2+: chain/asset parameters accepted (real implementation would use them)
    throw new Error(this.errorMessage);
  }

  slashBond(providerId: string, amount: number, beneficiaryId: string, _chain?: string, _asset?: string, meta?: Record<string, unknown>): void {
    // v2 Phase 2+: chain/asset parameters accepted (real implementation would use them)
    throw new Error(this.errorMessage);
  }

  // Legacy methods (for backward compatibility)
  credit(agentId: string, amount: number, _chain?: string, _asset?: string): void {
    // v2 Phase 2+: chain/asset parameters accepted (real implementation would use them)
    throw new Error(`NotImplemented: credit() - ${this.errorMessage}`);
  }

  debit(agentId: string, amount: number, _chain?: string, _asset?: string): void {
    // v2 Phase 2+: chain/asset parameters accepted (real implementation would use them)
    throw new Error(`NotImplemented: debit() - ${this.errorMessage}`);
  }

  lockFunds(agentId: string, amount: number): boolean {
    try {
      this.lock(agentId, amount);
      return true;
    } catch {
      return false;
    }
  }

  lockBond(agentId: string, amount: number): boolean {
    try {
      this.lock(agentId, amount);
      return true;
    } catch {
      return false;
    }
  }

  unlock(agentId: string, amount: number): void {
    this.release(agentId, amount);
  }

  releaseFunds(toAgentId: string, amount: number): void {
    this.credit(toAgentId, amount);
  }

  slash(fromAgentId: string, toAgentId: string, amount: number): void {
    this.slashBond(fromAgentId, amount, toAgentId);
  }

  streamTick(buyerId: string, sellerId: string, amount: number): boolean {
    try {
      this.pay(buyerId, sellerId, amount);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Settlement Lifecycle API (v1.6.1+)
  // ============================================================================

  async prepare(intent: SettlementIntent): Promise<SettlementHandle> {
    throw new Error(
      `${this.errorMessage}: prepare() - Real implementations should integrate with ${this.config.rail} payment rail`
    );
  }

  async commit(handle_id: string): Promise<SettlementResult> {
    throw new Error(
      `${this.errorMessage}: commit() - Real implementations should integrate with ${this.config.rail} payment rail`
    );
  }

  async abort(handle_id: string, reason?: string): Promise<void> {
    throw new Error(
      `${this.errorMessage}: abort() - Real implementations should integrate with ${this.config.rail} payment rail`
    );
  }

  // First-class refund API (v1.6.8+, C2)
  async refund(refund: {
    dispute_id: string;
    from: string;
    to: string;
    amount: number;
    reason?: string;
    idempotency_key?: string;
  }): Promise<{ ok: boolean; refunded_amount: number; code?: string; reason?: string }> {
    return {
      ok: false,
      refunded_amount: 0,
      code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
      reason: `${this.errorMessage}: refund() - Real implementations should integrate with ${this.config.rail} payment rail`,
    };
  }
}

