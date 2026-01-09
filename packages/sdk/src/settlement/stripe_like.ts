/**
 * Stripe-like Settlement Provider (v1.7.1+)
 * 
 * Simulated Stripe payment provider that uses authorize/capture/void semantics.
 * Maps to real Stripe adapter in future implementations.
 * 
 * Behavior:
 * - prepare = "authorize" (lock funds, create payment_intent)
 * - commit = "capture" (move locked funds from buyer to seller)
 * - abort = "void authorization" (release locked funds back)
 * 
 * All operations are idempotent and use underlying MockSettlementProvider for accounting.
 */

import type { SettlementProvider } from "./provider";
import type { SettlementIntent, SettlementHandle, SettlementResult } from "./types";
import { MockSettlementProvider } from "./mock";
import * as crypto from "crypto";
import bs58 from "bs58";

export class StripeLikeSettlementProvider implements SettlementProvider {
  private mockProvider: MockSettlementProvider;
  private handles = new Map<string, SettlementHandle>();
  private captureIds = new Map<string, string>(); // handle_id -> capture_id

  constructor() {
    this.mockProvider = new MockSettlementProvider();
  }

  // ============================================================================
  // Core Settlement Provider Interface (delegate to mock)
  // ============================================================================

  getBalance(agentId: string): number {
    return this.mockProvider.getBalance(agentId);
  }

  getLocked(agentId: string): number {
    return this.mockProvider.getLocked(agentId);
  }

  lock(agentId: string, amount: number): void {
    this.mockProvider.lock(agentId, amount);
  }

  release(agentId: string, amount: number): void {
    this.mockProvider.release(agentId, amount);
  }

  pay(from: string, to: string, amount: number, meta?: Record<string, unknown>): void {
    this.mockProvider.pay(from, to, amount, meta);
  }

  slashBond(providerId: string, amount: number, beneficiaryId: string, meta?: Record<string, unknown>): void {
    this.mockProvider.slashBond(providerId, amount, beneficiaryId, meta);
  }

  credit(agentId: string, amount: number): void {
    this.mockProvider.credit(agentId, amount);
  }

  debit(agentId: string, amount: number): void {
    this.mockProvider.debit(agentId, amount);
  }

  lockFunds(agentId: string, amount: number): boolean {
    return (this.mockProvider as any).lockFunds(agentId, amount);
  }

  lockBond(agentId: string, amount: number): boolean {
    return (this.mockProvider as any).lockBond(agentId, amount);
  }

  unlock(agentId: string, amount: number): void {
    this.mockProvider.unlock(agentId, amount);
  }

  releaseFunds(toAgentId: string, amount: number): void {
    (this.mockProvider as any).releaseFunds(toAgentId, amount);
  }

  slash(fromAgentId: string, toAgentId: string, amount: number): void {
    (this.mockProvider as any).slash(fromAgentId, toAgentId, amount);
  }

  streamTick(buyerId: string, sellerId: string, amount: number): boolean {
    return this.mockProvider.streamTick(buyerId, sellerId, amount);
  }

  // ============================================================================
  // Settlement Lifecycle API (Stripe-like semantics)
  // ============================================================================

  /**
   * Generate deterministic handle_id (payment_intent_id) from intent_id + idempotency_key.
   * Uses SHA-256 hash and base58 encoding (same as MockSettlementProvider).
   */
  private generateHandleId(intent_id: string, idempotency_key?: string): string {
    const key = idempotency_key || "";
    const combined = `${intent_id}:${key}`;
    const hash = crypto.createHash("sha256");
    hash.update(combined, "utf8");
    const hashBytes = hash.digest();
    const shortHash = hashBytes.slice(0, 16);
    return bs58.encode(shortHash);
  }

  /**
   * Generate capture_id (deterministic from handle_id + timestamp).
   * For idempotency, use handle_id as base (same handle_id always gets same capture_id).
   */
  private generateCaptureId(handle_id: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(`${handle_id}:capture`, "utf8");
    const hashBytes = hash.digest();
    const shortHash = hashBytes.slice(0, 16);
    return `capt_${bs58.encode(shortHash)}`;
  }

  /**
   * Prepare settlement (Stripe: "authorize" / create payment_intent).
   * Locks funds and creates a payment authorization handle.
   * 
   * Idempotent: Same (intent_id, idempotency_key) returns same handle with same auth_id.
   */
  async prepare(intent: SettlementIntent): Promise<SettlementHandle> {
    if (intent.amount < 0) {
      throw new Error("amount must be >= 0");
    }

    // Generate deterministic handle_id (payment_intent_id)
    const handle_id = this.generateHandleId(intent.intent_id, intent.idempotency_key);

    // Check for existing handle (idempotency)
    const existing = this.handles.get(handle_id);
    if (existing) {
      // Return existing handle if already prepared
      return existing;
    }

    // Validate funds and lock amount (using mock provider)
    const fromAcct = this.mockProvider.getAccount(intent.from);
    if (fromAcct.balance < intent.amount) {
      throw new Error(`Insufficient balance to authorize ${intent.amount} for agent ${intent.from}`);
    }

    // Lock funds (authorize)
    this.mockProvider.lock(intent.from, intent.amount);

    // Generate auth_id (simulate Stripe payment_intent id)
    // For idempotency, use handle_id as base (same handle_id = same auth_id)
    const auth_id = `pi_${handle_id}`;

    // Create handle (payment_intent)
    const now = Date.now();
    const handle: SettlementHandle = {
      handle_id,
      intent_id: intent.intent_id,
      status: "prepared",
      locked_amount: intent.amount,
      created_at_ms: now,
      meta: {
        ...intent.meta,
        from: intent.from,
        to: intent.to,
        auth_id, // Stripe-like payment_intent id
        payment_intent_id: auth_id, // Alias for clarity
      },
    };

    // Store handle
    this.handles.set(handle_id, handle);

    return handle;
  }

  /**
   * Commit settlement (Stripe: "capture" payment_intent).
   * Moves authorized funds from buyer to seller.
   * 
   * Idempotent: Same handle_id returns same result with same capture_id (no double-payment).
   */
  async commit(handle_id: string): Promise<SettlementResult> {
    const handle = this.handles.get(handle_id);
    if (!handle) {
      throw new Error(`Settlement handle not found: ${handle_id}`);
    }

    // Idempotency: if already committed, return same result
    if (handle.status === "committed") {
      const capture_id = this.captureIds.get(handle_id) || this.generateCaptureId(handle_id);
      return {
        ok: true,
        status: "committed",
        paid_amount: handle.locked_amount,
        handle_id: handle.handle_id,
        meta: {
          ...handle.meta,
          capture_id,
          payment_intent_id: handle.meta?.auth_id || handle.meta?.payment_intent_id,
        },
      };
    }

    // Can only commit from "prepared" status
    if (handle.status !== "prepared") {
      throw new Error(`Cannot capture handle in status "${handle.status}"`);
    }

    // Get from/to from handle.meta
    const intentFrom = (handle.meta?.from as string) || "";
    const intentTo = (handle.meta?.to as string) || "";

    if (!intentFrom || !intentTo) {
      throw new Error(`Handle missing from/to information (should be stored in meta during prepare)`);
    }

    // Capture: Transfer locked funds from buyer to seller
    // First release locked (unlock decreases locked, increases balance)
    this.mockProvider.unlock(intentFrom, handle.locked_amount);
    // Then debit from buyer and credit to seller (transfer)
    this.mockProvider.debit(intentFrom, handle.locked_amount);
    this.mockProvider.credit(intentTo, handle.locked_amount);

    // Generate capture_id (deterministic for idempotency)
    const capture_id = this.generateCaptureId(handle_id);
    this.captureIds.set(handle_id, capture_id);

    // Update handle status
    handle.status = "committed";

    return {
      ok: true,
      status: "committed",
      paid_amount: handle.locked_amount,
      handle_id: handle.handle_id,
      meta: {
        ...handle.meta,
        capture_id,
        payment_intent_id: handle.meta?.auth_id || handle.meta?.payment_intent_id,
      },
    };
  }

  /**
   * Abort settlement (Stripe: "void authorization" / cancel payment_intent).
   * Releases authorized funds back to buyer's available balance.
   * 
   * Idempotent: Safe to call multiple times (no-op if already aborted).
   * 
   * Note: Cannot abort after commit (throws error).
   */
  async abort(handle_id: string, reason?: string): Promise<void> {
    const handle = this.handles.get(handle_id);
    if (!handle) {
      throw new Error(`Settlement handle not found: ${handle_id}`);
    }

    // Idempotency: if already aborted, return successfully
    if (handle.status === "aborted") {
      return;
    }

    // Cannot abort after commit (void after capture not allowed in Stripe semantics)
    if (handle.status === "committed") {
      throw new Error(`Cannot void authorization after capture (handle already committed)`);
    }

    // Can only abort from "prepared" status
    if (handle.status !== "prepared") {
      throw new Error(`Cannot void handle in status "${handle.status}"`);
    }

    // Get from from handle.meta
    const intentFrom = (handle.meta?.from as string) || "";
    if (!intentFrom) {
      throw new Error(`Handle missing from information (should be stored in meta during prepare)`);
    }

    // Void authorization: Release locked funds back to available balance
    this.mockProvider.unlock(intentFrom, handle.locked_amount);

    // Update handle status
    handle.status = "aborted";

    // Store reason in meta if provided
    if (reason) {
      handle.meta = { ...handle.meta, void_reason: reason };
    }
  }

  // ============================================================================
  // Test Helpers (for compatibility with MockSettlementProvider tests)
  // ============================================================================

  /**
   * Set balance for testing (delegates to mock provider).
   */
  setBalance(agentId: string, balance: number): void {
    this.mockProvider.setBalance(agentId, balance);
  }

  /**
   * Get account for testing (delegates to mock provider).
   */
  getAccount(agentId: string): { balance: number; locked: number } {
    return this.mockProvider.getAccount(agentId);
  }
}

