import type { SettlementProvider } from "./provider";
import type { SettlementIntent, SettlementHandle, SettlementResult } from "./types";
import * as crypto from "crypto";
import bs58 from "bs58";

type Account = { balance: number; locked: number };

export class MockSettlementProvider implements SettlementProvider {
  private accounts = new Map<string, Account>();
  private handles = new Map<string, SettlementHandle>();
  // v1.6.8+: Track processed refund idempotency keys (C2)
  private processedRefunds = new Map<string, { refunded_amount: number; timestamp_ms: number }>();

  private acct(agentId: string): Account {
    const a = this.accounts.get(agentId);
    if (a) return a;
    const created = { balance: 0, locked: 0 };
    this.accounts.set(agentId, created);
    return created;
  }

  // --- test helpers ---
  setBalance(agentId: string, balance: number): void {
    if (!Number.isFinite(balance) || balance < 0) throw new Error("balance must be >= 0");
    const a = this.acct(agentId);
    // balance represents available balance
    a.balance = balance;
    // locked can be independent of available balance
  }

  getAccount(agentId: string): { balance: number; locked: number } {
    const a = this.acct(agentId);
    return { balance: a.balance, locked: a.locked };
  }

  /**
   * Copy account balances from another MockSettlementProvider.
   * Used when creating a new mock provider via factory but preserving existing balances.
   * @param other Another MockSettlementProvider instance
   */
  copyFrom(other: MockSettlementProvider): void {
    // Use type assertion to access private accounts (both are MockSettlementProvider)
    const otherAccounts = (other as any).accounts as Map<string, Account>;
    if (otherAccounts) {
      for (const [agentId, account] of otherAccounts.entries()) {
        const a = this.acct(agentId);
        a.balance = account.balance;
        a.locked = account.locked;
      }
    }
  }

  // --- core interface ---
  getBalance(agentId: string, _chain?: string, _asset?: string): number {
    // v2 Phase 2+: chain/asset parameters accepted but ignored in mock implementation
    return this.acct(agentId).balance;
  }

  getLocked(agentId: string, _chain?: string, _asset?: string): number {
    // v2 Phase 2+: chain/asset parameters accepted but ignored in mock implementation
    return this.acct(agentId).locked;
  }

  // ============================================================================
  // Core Settlement Operations (Formalized)
  // ============================================================================

  lock(agentId: string, amount: number, _chain?: string, _asset?: string): void {
    // v2 Phase 2+: chain/asset parameters accepted but ignored in mock implementation
    const success = this.lockFunds(agentId, amount);
    if (!success) {
      throw new Error(`Insufficient balance to lock ${amount} for agent ${agentId}`);
    }
  }

  release(agentId: string, amount: number, _chain?: string, _asset?: string): void {
    // v2 Phase 2+: chain/asset parameters accepted but ignored in mock implementation
    this.unlock(agentId, amount);
  }

  pay(from: string, to: string, amount: number, _chain?: string, _asset?: string, meta?: Record<string, unknown>): void {
    // v2 Phase 2+: chain/asset parameters accepted but ignored in mock implementation
    if (!(amount > 0)) throw new Error("amount must be > 0");
    const fromAcct = this.acct(from);
    if (fromAcct.balance < amount) {
      throw new Error(`Insufficient balance to pay ${amount} from ${from} to ${to}`);
    }
    fromAcct.balance -= amount;
    this.acct(to).balance += amount;
    // meta is ignored in mock implementation but available for external providers
  }

  slashBond(providerId: string, amount: number, beneficiaryId: string, _chain?: string, _asset?: string, meta?: Record<string, unknown>): void {
    // v2 Phase 2+: chain/asset parameters accepted but ignored in mock implementation
    this.slash(providerId, beneficiaryId, amount);
    // meta is ignored in mock implementation but available for external providers
  }

  credit(agentId: string, amount: number, _chain?: string, _asset?: string): void {
    // v2 Phase 2+: chain/asset parameters accepted but ignored in mock implementation
    if (!(amount >= 0)) throw new Error("amount must be >= 0");
    // balance represents available balance
    this.acct(agentId).balance += amount;
  }

  debit(agentId: string, amount: number, _chain?: string, _asset?: string): void {
    // v2 Phase 2+: chain/asset parameters accepted but ignored in mock implementation
    if (!(amount >= 0)) throw new Error("amount must be >= 0");
    const a = this.acct(agentId);
    // balance represents available balance
    if (a.balance < amount) throw new Error("insufficient available balance");
    a.balance -= amount;
  }

  lockFunds(agentId: string, amount: number): boolean {
    if (!(amount >= 0)) return false;
    const a = this.acct(agentId);
    // balance represents available balance
    if (a.balance < amount) return false;
    a.balance -= amount; // decrease available
    a.locked += amount;  // increase locked
    return true;
  }

  lockBond(agentId: string, amount: number): boolean {
    return this.lockFunds(agentId, amount);
  }

  unlock(agentId: string, amount: number): void {
    if (!(amount >= 0)) throw new Error("amount must be >= 0");
    const a = this.acct(agentId);
    const unlockAmount = Math.min(amount, a.locked);
    a.locked -= unlockAmount; // decrease locked
    a.balance += unlockAmount; // increase available
  }

  releaseFunds(toAgentId: string, amount: number): void {
    if (!(amount >= 0)) throw new Error("amount must be >= 0");
    // balance represents available balance
    this.acct(toAgentId).balance += amount;
  }

  slash(fromAgentId: string, toAgentId: string, amount: number): void {
    if (!(amount >= 0)) throw new Error("amount must be >= 0");
    const from = this.acct(fromAgentId);
    const totalAvailable = from.balance + from.locked;
    if (totalAvailable < amount) throw new Error("insufficient balance to slash");
    
    // Remove from locked first (if possible), otherwise from balance
    const fromLocked = Math.min(amount, from.locked);
    const fromBalance = amount - fromLocked;
    
    from.locked -= fromLocked;
    from.balance -= fromBalance;
    
    // Credit to available balance
    this.acct(toAgentId).balance += amount;
  }

  /**
   * Streaming tick: pay-as-you-go from buyer AVAILABLE balance
   * balance already represents available, no need to subtract locked
   */
  streamTick(buyerId: string, sellerId: string, amount: number): boolean {
    if (!(amount > 0)) return false;
    const buyer = this.acct(buyerId);
    const seller = this.acct(sellerId);
    // balance represents available balance
    if (buyer.balance < amount) return false;
    buyer.balance -= amount;
    seller.balance += amount;
    return true;
  }

  // ============================================================================
  // Settlement Lifecycle API (v1.6.1+)
  // ============================================================================

  /**
   * Generate deterministic handle_id from intent_id + idempotency_key.
   * Uses SHA-256 hash and base58 encoding for deterministic, short IDs.
   */
  private generateHandleId(intent_id: string, idempotency_key?: string): string {
    const key = idempotency_key || "";
    const combined = `${intent_id}:${key}`;
    const hash = crypto.createHash("sha256");
    hash.update(combined, "utf8");
    const hashBytes = hash.digest();
    // Use first 16 bytes for shorter IDs (base58 encodes to ~22 chars)
    const shortHash = hashBytes.slice(0, 16);
    return bs58.encode(shortHash);
  }

  async prepare(intent: SettlementIntent): Promise<SettlementHandle> {
    if (intent.amount < 0) {
      throw new Error("amount must be >= 0");
    }

    // Generate deterministic handle_id
    const handle_id = this.generateHandleId(intent.intent_id, intent.idempotency_key);

    // Check for existing handle (idempotency)
    const existing = this.handles.get(handle_id);
    if (existing) {
      // Return existing handle if already prepared
      return existing;
    }

    // Validate funds and lock amount
    const fromAcct = this.acct(intent.from);
    if (fromAcct.balance < intent.amount) {
      throw new Error(`Insufficient balance to lock ${intent.amount} for agent ${intent.from}`);
    }

    // Lock funds (decrease available, increase locked)
    fromAcct.balance -= intent.amount;
    fromAcct.locked += intent.amount;

    // Create handle
    const now = Date.now();
    const handle: SettlementHandle = {
      handle_id,
      intent_id: intent.intent_id,
      status: "prepared",
      locked_amount: intent.amount,
      created_at_ms: now,
      // Store from/to and chain/asset in meta for commit/abort operations
      meta: {
        ...intent.meta,
        from: intent.from,
        to: intent.to,
        // v2 Phase 2+: Store chain/asset in handle metadata
        chain: intent.chain,
        asset: intent.asset,
      },
    };

    // Store handle
    this.handles.set(handle_id, handle);

    return handle;
  }

  async commit(handle_id: string): Promise<SettlementResult> {
    const handle = this.handles.get(handle_id);
    if (!handle) {
      throw new Error(`Settlement handle not found: ${handle_id}`);
    }

    // Idempotency: if already committed, return same result
    if (handle.status === "committed") {
      return {
        ok: true,
        status: "committed",
        paid_amount: handle.locked_amount,
        handle_id: handle.handle_id,
        meta: handle.meta,
      };
    }

    // Can only commit from "prepared" status
    if (handle.status !== "prepared") {
      throw new Error(`Cannot commit handle in status "${handle.status}"`);
    }

    // Get intent info from handle meta or use default (for mock, we store intent info in handle)
    // For mock, we need to track from/to in handle - let's add it to meta or create a mapping
    // Actually, for mock implementation, we can store from/to in handle.meta during prepare
    // But for now, let's use a simpler approach: store intent in handle
    // We'll need to extend the handle or store intent data separately
    
    // For now, we'll get from/to from handle.meta if stored, otherwise use handle itself
    // But actually, we need to know from/to to commit. Let's store it in handle.
    // Actually, looking at the interface, we don't have from/to in handle.
    // We need to either:
    // 1. Store intent in a separate map
    // 2. Store from/to in handle.meta during prepare
    // 3. Extend handle to include from/to
    
    // For mock implementation, let's store the intent in handle.meta
    // But that's not ideal. Let's create a separate map to store intents.
    // Actually, let's just extend handle to store from/to - but that changes the type.
    // Or we can store from/to in meta.
    
    // Simplest: Store from/to in handle.meta during prepare, then retrieve during commit.
    // But handle.meta is optional. Let's create an internal map to store intent data.
    
    // Let me refactor: store a map of handle_id -> intent data
    // Actually, let's just store from/to in handle.meta as part of prepare.
    
    // For mock, we can store intent fields in handle.meta:
    const intentFrom = (handle.meta?.from as string) || "";
    const intentTo = (handle.meta?.to as string) || "";
    
    if (!intentFrom || !intentTo) {
      throw new Error(`Handle missing from/to information (should be stored in meta during prepare)`);
    }

    // Release locked funds from buyer
    const fromAcct = this.acct(intentFrom);
    fromAcct.locked -= handle.locked_amount;

    // Credit funds to seller
    const toAcct = this.acct(intentTo);
    toAcct.balance += handle.locked_amount;

    // Update handle status
    handle.status = "committed";

    return {
      ok: true,
      status: "committed",
      paid_amount: handle.locked_amount,
      handle_id: handle.handle_id,
      meta: handle.meta,
    };
  }

  async abort(handle_id: string, reason?: string): Promise<void> {
    const handle = this.handles.get(handle_id);
    if (!handle) {
      throw new Error(`Settlement handle not found: ${handle_id}`);
    }

    // Idempotency: if already aborted, return successfully
    if (handle.status === "aborted") {
      return;
    }

    // Can only abort from "prepared" status
    if (handle.status !== "prepared") {
      // If already committed, cannot abort
      throw new Error(`Cannot abort handle in status "${handle.status}"`);
    }

    // Get from from handle.meta
    const intentFrom = (handle.meta?.from as string) || "";
    if (!intentFrom) {
      throw new Error(`Handle missing from information (should be stored in meta during prepare)`);
    }

    // Release locked funds back to available balance
    const fromAcct = this.acct(intentFrom);
    fromAcct.locked -= handle.locked_amount;
    fromAcct.balance += handle.locked_amount;

    // Update handle status
    handle.status = "aborted";
    
    // Store reason in meta if provided
    if (reason) {
      handle.meta = { ...handle.meta, abort_reason: reason };
    }
  }

  /**
   * Poll settlement status (v1.7.2+).
   * For MockSettlementProvider, returns current status immediately (synchronous).
   */
  async poll(handle_id: string): Promise<SettlementResult> {
    const handle = this.handles.get(handle_id);
    if (!handle) {
      throw new Error(`Settlement handle not found: ${handle_id}`);
    }

    // Return current status (mock is synchronous, so status is always final)
    if (handle.status === "committed") {
      return {
        ok: true,
        status: "committed",
        paid_amount: handle.locked_amount,
        handle_id: handle.handle_id,
        meta: handle.meta,
      };
    } else if (handle.status === "aborted") {
      return {
        ok: false,
        status: "aborted",
        paid_amount: 0,
        handle_id: handle.handle_id,
        meta: handle.meta,
      };
    } else if (handle.status === "prepared") {
      return {
        ok: true,
        status: "prepared",
        paid_amount: 0,
        handle_id: handle.handle_id,
        meta: handle.meta,
      };
    } else {
      // pending or other status
      return {
        ok: false,
        status: handle.status as "pending" | "failed",
        paid_amount: 0,
        handle_id: handle.handle_id,
        meta: handle.meta,
      };
    }
  }

  // First-class refund API (v1.6.8+, C2) with idempotency
  async refund(refund: {
    dispute_id: string;
    from: string;
    to: string;
    amount: number;
    reason?: string;
    idempotency_key?: string;
  }): Promise<{ ok: boolean; refunded_amount: number; code?: string; reason?: string }> {
    const { dispute_id, from, to, amount } = refund;
    
    if (!(amount > 0)) {
      return {
        ok: false,
        refunded_amount: 0,
        code: "INVALID_AMOUNT",
        reason: "Refund amount must be > 0",
      };
    }

    // Use dispute_id as idempotency key (or provided idempotency_key)
    const idempotencyKey = refund.idempotency_key || dispute_id;
    
    // Check idempotency: if already processed, return same result
    const existing = this.processedRefunds.get(idempotencyKey);
    if (existing) {
      return {
        ok: true,
        refunded_amount: existing.refunded_amount,
      };
    }

    const fromAcct = this.acct(from);
    // Check if seller has sufficient balance (balance + locked)
    const totalAvailable = fromAcct.balance + fromAcct.locked;
    if (totalAvailable < amount) {
      return {
        ok: false,
        refunded_amount: 0,
        code: "REFUND_INSUFFICIENT_FUNDS",
        reason: `Seller has insufficient funds for refund of ${amount}`,
      };
    }

    // Prioritize refunding from available balance, then locked
    let remainingAmount = amount;
    if (fromAcct.balance >= remainingAmount) {
      fromAcct.balance -= remainingAmount;
      remainingAmount = 0;
    } else {
      remainingAmount -= fromAcct.balance;
      fromAcct.balance = 0;
      if (fromAcct.locked >= remainingAmount) {
        fromAcct.locked -= remainingAmount;
        remainingAmount = 0;
      } else {
        // Should not happen if total balance check passed, but for safety
        return {
          ok: false,
          refunded_amount: 0,
          code: "REFUND_INSUFFICIENT_FUNDS",
          reason: `Seller has insufficient locked funds for refund`,
        };
      }
    }

    // Credit buyer
    this.acct(to).balance += amount;

    // Record processed refund for idempotency
    this.processedRefunds.set(idempotencyKey, {
      refunded_amount: amount,
      timestamp_ms: Date.now(),
    });

    return {
      ok: true,
      refunded_amount: amount,
    };
  }
}

