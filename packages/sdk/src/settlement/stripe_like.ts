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

export interface StripeLikeSettlementProviderConfig {
  asyncCommit?: boolean; // v1.7.2+: enable async commit (default: false)
  commitDelayTicks?: number; // v1.7.2+: number of poll calls before commit resolves (default: 3)
  failCommit?: boolean; // v1.7.2+: if true, poll resolves to failed instead of committed (default: false)
  forcePendingUntilPoll?: number; // v1.7.3+: force pending until this many polls (overrides commitDelayTicks for first N polls)
}

export class StripeLikeSettlementProvider implements SettlementProvider {
  private mockProvider: MockSettlementProvider;
  private handles = new Map<string, SettlementHandle>();
  private captureIds = new Map<string, string>(); // handle_id -> capture_id
  private config: StripeLikeSettlementProviderConfig;
  // v1.7.2+: track pending commits (handle_id -> poll count)
  private pendingCommits = new Map<string, { pollCount: number; last_attempt_ms?: number; committedAtMs?: number; failedAtMs?: number }>();

  constructor(config?: StripeLikeSettlementProviderConfig) {
    this.mockProvider = new MockSettlementProvider();
    this.config = {
      asyncCommit: false,
      commitDelayTicks: 3,
      failCommit: false,
      ...config,
    };
  }

  // ============================================================================
  // Core Settlement Provider Interface (delegate to mock)
  // ============================================================================

  getBalance(agentId: string, chain?: string, asset?: string): number {
    // v2 Phase 2+: chain/asset parameters passed through to mock provider
    return this.mockProvider.getBalance(agentId, chain, asset);
  }

  getLocked(agentId: string, chain?: string, asset?: string): number {
    // v2 Phase 2+: chain/asset parameters passed through to mock provider
    return this.mockProvider.getLocked(agentId, chain, asset);
  }

  lock(agentId: string, amount: number, chain?: string, asset?: string): void {
    // v2 Phase 2+: chain/asset parameters passed through to mock provider
    this.mockProvider.lock(agentId, amount, chain, asset);
  }

  release(agentId: string, amount: number, chain?: string, asset?: string): void {
    // v2 Phase 2+: chain/asset parameters passed through to mock provider
    this.mockProvider.release(agentId, amount, chain, asset);
  }

  pay(from: string, to: string, amount: number, chain?: string, asset?: string, meta?: Record<string, unknown>): void {
    // v2 Phase 2+: chain/asset parameters passed through to mock provider
    this.mockProvider.pay(from, to, amount, chain, asset, meta);
  }

  slashBond(providerId: string, amount: number, beneficiaryId: string, chain?: string, asset?: string, meta?: Record<string, unknown>): void {
    // v2 Phase 2+: chain/asset parameters passed through to mock provider
    this.mockProvider.slashBond(providerId, amount, beneficiaryId, chain, asset, meta);
  }

  credit(agentId: string, amount: number, chain?: string, asset?: string): void {
    // v2 Phase 2+: chain/asset parameters passed through to mock provider
    this.mockProvider.credit(agentId, amount, chain, asset);
  }

  debit(agentId: string, amount: number, chain?: string, asset?: string): void {
    // v2 Phase 2+: chain/asset parameters passed through to mock provider
    this.mockProvider.debit(agentId, amount, chain, asset);
  }

  lockFunds(agentId: string, amount: number): boolean {
    return (this.mockProvider as any).lockFunds(agentId, amount);
  }

  lockBond(agentId: string, amount: number): boolean {
    return (this.mockProvider as any).lockBond(agentId, amount);
  }

  unlock(agentId: string, amount: number): void {
    // Legacy method - delegate to release() (which matches interface)
    this.mockProvider.release(agentId, amount);
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
    // v2 Phase 2+: Pass chain/asset to lock operations
    this.mockProvider.lock(intent.from, intent.amount, intent.chain, intent.asset);

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
        // v2 Phase 2+: Store chain/asset in handle metadata
        chain: intent.chain,
        asset: intent.asset,
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
      // If already pending, return pending result (idempotent)
      if (handle.status === "pending") {
        const pendingState = this.pendingCommits.get(handle_id);
        return {
          ok: false,
          status: "pending",
          paid_amount: 0,
          handle_id: handle.handle_id,
          attempts: pendingState?.pollCount || 0,
          last_attempt_ms: pendingState?.pollCount ? Date.now() : undefined,
          meta: handle.meta,
        };
      }
      throw new Error(`Cannot capture handle in status "${handle.status}"`);
    }

    // Get from/to from handle.meta
    const intentFrom = (handle.meta?.from as string) || "";
    const intentTo = (handle.meta?.to as string) || "";

    if (!intentFrom || !intentTo) {
      throw new Error(`Handle missing from/to information (should be stored in meta during prepare)`);
    }

    // v1.7.2+: Async commit behavior
    if (this.config.asyncCommit) {
      // Mark as pending (do NOT transfer funds yet)
      handle.status = "pending";
      this.pendingCommits.set(handle_id, { pollCount: 0 });
      
      return {
        ok: false,
        status: "pending" as const,
        paid_amount: 0,
        handle_id: handle.handle_id,
        attempts: 0,
        last_attempt_ms: Date.now(),
        meta: handle.meta,
      };
    }

    // Synchronous commit: Transfer locked funds from buyer to seller immediately
    // v2 Phase 2+: Get chain/asset from handle metadata and pass to settlement operations
    const chain = handle.meta?.chain as string | undefined;
    const asset = handle.meta?.asset as string | undefined;
    // First release locked (release decreases locked, increases balance)
    this.mockProvider.release(intentFrom, handle.locked_amount, chain, asset);
    // Then debit from buyer and credit to seller (transfer)
    this.mockProvider.debit(intentFrom, handle.locked_amount, chain, asset);
    this.mockProvider.credit(intentTo, handle.locked_amount, chain, asset);

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

    // Can abort from "prepared" or "pending" status (v1.7.2+)
    if (handle.status !== "prepared" && handle.status !== "pending") {
      throw new Error(`Cannot void handle in status "${handle.status}"`);
    }

    // If pending, clear pending state
    if (handle.status === "pending") {
      this.pendingCommits.delete(handle_id);
    }

    // Get from from handle.meta
    const intentFrom = (handle.meta?.from as string) || "";
    if (!intentFrom) {
      throw new Error(`Handle missing from information (should be stored in meta during prepare)`);
    }

    // Void authorization: Release locked funds back to available balance
    // v2 Phase 2+: Get chain/asset from handle metadata and pass to settlement operations
    const chain = handle.meta?.chain as string | undefined;
    const asset = handle.meta?.asset as string | undefined;
    this.mockProvider.release(intentFrom, handle.locked_amount, chain, asset);

    // Update handle status
    handle.status = "aborted";

    // Store reason in meta if provided
    if (reason) {
      handle.meta = { ...handle.meta, void_reason: reason };
    }
  }

  /**
   * Poll settlement status for async operations (v1.7.2+).
   * Resolves pending commits after delay or returns current status.
   */
  async poll(handle_id: string): Promise<SettlementResult> {
    const handle = this.handles.get(handle_id);
    if (!handle) {
      throw new Error(`Settlement handle not found: ${handle_id}`);
    }

    // If already committed, return committed result (idempotent)
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

    // Get pending state if exists
    const pendingState = this.pendingCommits.get(handle_id);
    
    // If handle has failed state (tracked in pendingCommits), return failed result (idempotent)
    if (pendingState?.failedAtMs) {
      return {
        ok: false,
        status: "failed",
        paid_amount: 0,
        handle_id: handle.handle_id,
        attempts: pendingState.pollCount || 0,
        last_attempt_ms: pendingState.failedAtMs,
        failure_code: "SETTLEMENT_FAILED",
        failure_reason: "Settlement failed during async processing",
        meta: handle.meta,
      };
    }

    // If pending, check if delay has elapsed
    if (handle.status === "pending") {
      if (!pendingState) {
        // Should not happen, but handle gracefully
        return {
          ok: false,
          status: "pending",
          paid_amount: 0,
          handle_id: handle.handle_id,
          meta: handle.meta,
        };
      }

      // Increment poll count
      pendingState.pollCount = (pendingState.pollCount || 0) + 1;
      pendingState.last_attempt_ms = Date.now();

      // Check if we should force pending (v1.7.3+)
      const forcePendingUntil = this.config.forcePendingUntilPoll;
      if (forcePendingUntil !== undefined && pendingState.pollCount < forcePendingUntil) {
        // Force pending - return pending status regardless of commitDelayTicks
        return {
          ok: false,
          status: "pending",
          paid_amount: 0,
          handle_id: handle.handle_id,
          attempts: pendingState.pollCount,
          last_attempt_ms: pendingState.last_attempt_ms,
          meta: handle.meta,
        };
      }

      // Check if delay has elapsed
      const delayTicks = this.config.commitDelayTicks || 3;
      if (pendingState.pollCount >= delayTicks) {
        // Resolve pending commit
        const intentFrom = (handle.meta?.from as string) || "";
        const intentTo = (handle.meta?.to as string) || "";

        if (!intentFrom || !intentTo) {
          throw new Error(`Handle missing from/to information`);
        }

        // v2 Phase 2+: Get chain/asset from handle metadata and pass to settlement operations
        const chain = handle.meta?.chain as string | undefined;
        const asset = handle.meta?.asset as string | undefined;

        if (this.config.failCommit) {
          // Resolve to failed: release locked funds, do NOT pay seller
          this.mockProvider.release(intentFrom, handle.locked_amount, chain, asset);
          // Keep handle status as "pending" but mark as failed in pendingCommits
          pendingState.failedAtMs = Date.now();
          this.pendingCommits.set(handle_id, pendingState); // Update state
          
          return {
            ok: false,
            status: "failed",
            paid_amount: 0,
            handle_id: handle.handle_id,
            attempts: pendingState.pollCount,
            last_attempt_ms: pendingState.failedAtMs,
            failure_code: "SETTLEMENT_FAILED",
            failure_reason: "Settlement failed during async processing",
            meta: handle.meta,
          };
        } else {
          // Resolve to committed: transfer funds (only once)
          this.mockProvider.release(intentFrom, handle.locked_amount, chain, asset);
          this.mockProvider.debit(intentFrom, handle.locked_amount, chain, asset);
          this.mockProvider.credit(intentTo, handle.locked_amount, chain, asset);

          const capture_id = this.generateCaptureId(handle_id);
          this.captureIds.set(handle_id, capture_id);
          handle.status = "committed";
          pendingState.committedAtMs = Date.now();
          this.pendingCommits.delete(handle_id); // Clean up

          return {
            ok: true,
            status: "committed",
            paid_amount: handle.locked_amount,
            handle_id: handle.handle_id,
            attempts: pendingState.pollCount,
            last_attempt_ms: pendingState.committedAtMs,
            meta: {
              ...handle.meta,
              capture_id,
              payment_intent_id: handle.meta?.auth_id || handle.meta?.payment_intent_id,
            },
          };
        }
      } else {
        // Still pending
        return {
          ok: false,
          status: "pending",
          paid_amount: 0,
          handle_id: handle.handle_id,
          attempts: pendingState.pollCount,
          last_attempt_ms: pendingState.last_attempt_ms,
          meta: handle.meta,
        };
      }
    }

    // For other statuses (prepared, aborted), return current status
    return {
      ok: handle.status === "prepared",
      status: handle.status as "prepared" | "aborted",
      paid_amount: 0,
      handle_id: handle.handle_id,
      meta: handle.meta,
    };
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

  // First-class refund API (v1.6.8+, C2) with idempotency
  async refund(refund: {
    dispute_id: string;
    from: string;
    to: string;
    amount: number;
    reason?: string;
    idempotency_key?: string;
  }): Promise<{ ok: boolean; refunded_amount: number; code?: string; reason?: string }> {
    // Check if original payment is still pending (if handle exists and is pending)
    const handleId = refund.idempotency_key || refund.dispute_id;
    const handle = this.handles.get(handleId);
    
    if (handle && handle.status === "pending") {
      // If original payment is still pending, refund may not be possible
      // For simplicity, treat as insufficient funds (or could return REFUND_NOT_SETTLED)
      return {
        ok: false,
        refunded_amount: 0,
        code: "REFUND_INSUFFICIENT_FUNDS",
        reason: "Original payment is still pending and not settled",
      };
    }

    // Delegate to underlying mock provider (which handles idempotency)
    return await this.mockProvider.refund(refund);
  }
}

