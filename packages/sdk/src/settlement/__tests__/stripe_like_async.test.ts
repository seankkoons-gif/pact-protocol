/**
 * Stripe-like Settlement Provider Async Tests (v1.7.2+)
 * 
 * Tests for async settlement behavior with retries and reconciliation.
 */

import { describe, it, expect } from "vitest";
import { StripeLikeSettlementProvider, type StripeLikeSettlementProviderConfig } from "../stripe_like";
import type { SettlementIntent } from "../types";

describe("StripeLikeSettlementProvider async behavior (v1.7.2+)", () => {
  it("asyncCommit=true: commit returns pending, poll resolves to committed, funds move exactly once", async () => {
    const config: StripeLikeSettlementProviderConfig = {
      asyncCommit: true,
      commitDelayTicks: 3,
      failCommit: false,
    };
    const settlement = new StripeLikeSettlementProvider(config);
    settlement.setBalance("buyer-1", 1.0);
    settlement.setBalance("seller-1", 0.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer-1",
      to: "seller-1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "retry-abc",
    };

    const handle = await settlement.prepare(intent);
    expect(handle.status).toBe("prepared");

    // First commit returns pending
    const commitResult1 = await settlement.commit(handle.handle_id);
    expect(commitResult1.status).toBe("pending");
    expect(commitResult1.paid_amount).toBe(0);
    expect(commitResult1.attempts).toBe(0);

    // Funds still locked (not transferred yet)
    let buyerAccount = settlement.getAccount("buyer-1");
    let sellerAccount = settlement.getAccount("seller-1");
    expect(buyerAccount.balance).toBe(0.9); // 1.0 - 0.1 (locked)
    expect(buyerAccount.locked).toBe(0.1);
    expect(sellerAccount.balance).toBe(0.0); // Not paid yet

    // Second commit returns same pending (idempotent)
    const commitResult2 = await settlement.commit(handle.handle_id);
    expect(commitResult2.status).toBe("pending");
    expect(commitResult2.handle_id).toBe(commitResult1.handle_id);

    // Poll 1: still pending
    const pollResult1 = await settlement.poll(handle.handle_id);
    expect(pollResult1.status).toBe("pending");
    expect(pollResult1.attempts).toBe(1);
    expect(buyerAccount.balance).toBe(0.9); // Still locked
    expect(sellerAccount.balance).toBe(0.0); // Still not paid

    // Poll 2: still pending
    const pollResult2 = await settlement.poll(handle.handle_id);
    expect(pollResult2.status).toBe("pending");
    expect(pollResult2.attempts).toBe(2);

    // Poll 3: resolves to committed (delay elapsed)
    const pollResult3 = await settlement.poll(handle.handle_id);
    expect(pollResult3.status).toBe("committed");
    expect(pollResult3.paid_amount).toBe(0.1);
    expect(pollResult3.attempts).toBe(3);
    expect(pollResult3.meta?.capture_id).toBeDefined();

    // Funds now transferred (exactly once)
    buyerAccount = settlement.getAccount("buyer-1");
    sellerAccount = settlement.getAccount("seller-1");
    expect(buyerAccount.balance).toBe(0.9); // 1.0 - 0.1
    expect(buyerAccount.locked).toBe(0.0); // Locked released
    expect(sellerAccount.balance).toBe(0.1); // Paid

    // Subsequent polls return committed (idempotent)
    const pollResult4 = await settlement.poll(handle.handle_id);
    expect(pollResult4.status).toBe("committed");
    expect(pollResult4.paid_amount).toBe(0.1);
    expect(pollResult4.meta?.capture_id).toBe(pollResult3.meta?.capture_id);

    // Verify no double-payment
    expect(sellerAccount.balance).toBe(0.1); // Still 0.1, not 0.2
  });

  it("failCommit=true: poll resolves to failed, locked funds released, no payout", async () => {
    const config: StripeLikeSettlementProviderConfig = {
      asyncCommit: true,
      commitDelayTicks: 2,
      failCommit: true, // Will fail on poll
    };
    const settlement = new StripeLikeSettlementProvider(config);
    settlement.setBalance("buyer-1", 1.0);
    settlement.setBalance("seller-1", 0.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer-1",
      to: "seller-1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "retry-abc",
    };

    const handle = await settlement.prepare(intent);
    const commitResult = await settlement.commit(handle.handle_id);
    expect(commitResult.status).toBe("pending");

    // Poll 1: still pending
    const pollResult1 = await settlement.poll(handle.handle_id);
    expect(pollResult1.status).toBe("pending");
    expect(pollResult1.attempts).toBe(1);

    // Poll 2: resolves to failed (delay elapsed, failCommit=true)
    const pollResult2 = await settlement.poll(handle.handle_id);
    expect(pollResult2.status).toBe("failed");
    expect(pollResult2.paid_amount).toBe(0);
    expect(pollResult2.attempts).toBe(2);
    expect(pollResult2.failure_code).toBe("SETTLEMENT_FAILED");
    expect(pollResult2.failure_reason).toBeDefined();

    // Funds released back to buyer, seller NOT paid
    const buyerAccount = settlement.getAccount("buyer-1");
    const sellerAccount = settlement.getAccount("seller-1");
    expect(buyerAccount.balance).toBe(1.0); // Restored (locked released)
    expect(buyerAccount.locked).toBe(0.0); // Released
    expect(sellerAccount.balance).toBe(0.0); // NOT paid

    // Subsequent polls return failed (idempotent)
    const pollResult3 = await settlement.poll(handle.handle_id);
    expect(pollResult3.status).toBe("failed");
    expect(pollResult3.failure_code).toBe("SETTLEMENT_FAILED");
  });

  it("idempotency: repeated commit/poll are stable", async () => {
    const config: StripeLikeSettlementProviderConfig = {
      asyncCommit: true,
      commitDelayTicks: 2,
      failCommit: false,
    };
    const settlement = new StripeLikeSettlementProvider(config);
    settlement.setBalance("buyer-1", 1.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer-1",
      to: "seller-1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "retry-abc",
    };

    const handle = await settlement.prepare(intent);

    // Multiple commits return same pending result
    const commit1 = await settlement.commit(handle.handle_id);
    const commit2 = await settlement.commit(handle.handle_id);
    const commit3 = await settlement.commit(handle.handle_id);

    expect(commit1.status).toBe("pending");
    expect(commit2.status).toBe(commit1.status);
    expect(commit3.status).toBe(commit1.status);
    expect(commit2.handle_id).toBe(commit1.handle_id);
    expect(commit3.handle_id).toBe(commit1.handle_id);

    // Poll until resolved
    let pollResult = await settlement.poll(handle.handle_id);
    expect(pollResult.status).toBe("pending");
    expect(pollResult.attempts).toBe(1);

    pollResult = await settlement.poll(handle.handle_id);
    expect(pollResult.status).toBe("committed");
    expect(pollResult.attempts).toBe(2);

    // Subsequent polls return same committed result
    const pollResult2 = await settlement.poll(handle.handle_id);
    const pollResult3 = await settlement.poll(handle.handle_id);

    expect(pollResult2.status).toBe("committed");
    expect(pollResult3.status).toBe("committed");
    expect(pollResult2.paid_amount).toBe(pollResult.paid_amount);
    expect(pollResult3.paid_amount).toBe(pollResult.paid_amount);
    expect(pollResult2.meta?.capture_id).toBe(pollResult.meta?.capture_id);
    expect(pollResult3.meta?.capture_id).toBe(pollResult.meta?.capture_id);
  });

  it("abort from pending releases funds", async () => {
    const config: StripeLikeSettlementProviderConfig = {
      asyncCommit: true,
      commitDelayTicks: 3,
      failCommit: false,
    };
    const settlement = new StripeLikeSettlementProvider(config);
    settlement.setBalance("buyer-1", 1.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer-1",
      to: "seller-1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "retry-abc",
    };

    const handle = await settlement.prepare(intent);
    await settlement.commit(handle.handle_id); // Returns pending

    // Verify funds locked
    let account = settlement.getAccount("buyer-1");
    expect(account.balance).toBe(0.9);
    expect(account.locked).toBe(0.1);

    // Abort from pending
    await settlement.abort(handle.handle_id, "Cancelled by user");

    // Funds released
    account = settlement.getAccount("buyer-1");
    expect(account.balance).toBe(1.0); // Restored
    expect(account.locked).toBe(0.0); // Released

    // Poll after abort returns aborted status
    const pollResult = await settlement.poll(handle.handle_id);
    expect(pollResult.status).toBe("aborted");
  });

  it("default behavior (asyncCommit=false) is synchronous committed", async () => {
    const settlement = new StripeLikeSettlementProvider(); // Default: asyncCommit=false
    settlement.setBalance("buyer-1", 1.0);
    settlement.setBalance("seller-1", 0.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer-1",
      to: "seller-1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "retry-abc",
    };

    const handle = await settlement.prepare(intent);
    const commitResult = await settlement.commit(handle.handle_id);

    // Synchronous: immediately committed
    expect(commitResult.status).toBe("committed");
    expect(commitResult.paid_amount).toBe(0.1);

    // Funds immediately transferred
    const buyerAccount = settlement.getAccount("buyer-1");
    const sellerAccount = settlement.getAccount("seller-1");
    expect(buyerAccount.balance).toBe(0.9);
    expect(sellerAccount.balance).toBe(0.1);
  });

  it("poll on non-pending handle returns current status", async () => {
    const settlement = new StripeLikeSettlementProvider();
    settlement.setBalance("buyer-1", 1.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer-1",
      to: "seller-1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "retry-abc",
    };

    const handle = await settlement.prepare(intent);
    
    // Poll on prepared returns prepared
    const pollPrepared = await settlement.poll(handle.handle_id);
    expect(pollPrepared.status).toBe("prepared");

    // Commit (synchronous)
    await settlement.commit(handle.handle_id);

    // Poll on committed returns committed
    const pollCommitted = await settlement.poll(handle.handle_id);
    expect(pollCommitted.status).toBe("committed");
    expect(pollCommitted.paid_amount).toBe(0.1);
  });
});




