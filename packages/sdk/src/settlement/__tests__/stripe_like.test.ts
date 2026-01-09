/**
 * Stripe-like Settlement Provider Tests
 * 
 * Tests for StripeLikeSettlementProvider lifecycle operations (v1.7.1+).
 */

import { describe, it, expect } from "vitest";
import { StripeLikeSettlementProvider } from "../stripe_like";
import type { SettlementIntent } from "../types";

describe("StripeLikeSettlementProvider", () => {
  it("prepare is idempotent (same idempotency_key returns same handle_id)", async () => {
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

    const handle1 = await settlement.prepare(intent);
    const handle2 = await settlement.prepare(intent);

    // Same handle_id for same (intent_id, idempotency_key)
    expect(handle2.handle_id).toBe(handle1.handle_id);
    expect(handle2.status).toBe("prepared");
    expect(handle2.locked_amount).toBe(0.1);
    expect(handle2.meta?.auth_id).toBe(handle1.meta?.auth_id);
    expect(handle2.meta?.payment_intent_id).toBe(handle1.meta?.payment_intent_id);

    // Funds locked only once (idempotent)
    const account = settlement.getAccount("buyer-1");
    expect(account.balance).toBe(0.9); // 1.0 - 0.1
    expect(account.locked).toBe(0.1);
  });

  it("commit is idempotent (second commit returns same result, no double-pay)", async () => {
    const settlement = new StripeLikeSettlementProvider();
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
    const result1 = await settlement.commit(handle.handle_id);
    const result2 = await settlement.commit(handle.handle_id);

    // Same result (idempotent)
    expect(result2.handle_id).toBe(result1.handle_id);
    expect(result2.status).toBe("committed");
    expect(result2.paid_amount).toBe(0.1);
    expect(result2.meta?.capture_id).toBe(result1.meta?.capture_id);
    expect(result2.meta?.payment_intent_id).toBe(result1.meta?.payment_intent_id);

    // No double-payment (idempotent)
    const buyerAccount = settlement.getAccount("buyer-1");
    const sellerAccount = settlement.getAccount("seller-1");
    expect(buyerAccount.balance).toBe(0.9); // 1.0 - 0.1
    expect(buyerAccount.locked).toBe(0.0); // Locked released on commit
    expect(sellerAccount.balance).toBe(0.1); // Paid once only
  });

  it("abort releases funds (balance restored, locked 0)", async () => {
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
    
    // Verify funds locked
    let account = settlement.getAccount("buyer-1");
    expect(account.balance).toBe(0.9);
    expect(account.locked).toBe(0.1);

    // Abort (void authorization)
    await settlement.abort(handle.handle_id, "Negotiation failed");

    // Verify funds released
    account = settlement.getAccount("buyer-1");
    expect(account.balance).toBe(1.0); // Restored
    expect(account.locked).toBe(0.0); // Released

    // Verify handle status - prepare returns existing handle with aborted status (idempotent)
    // This is correct for idempotency: same (intent_id, idempotency_key) always returns same handle
    const handleAfterAbort = await settlement.prepare(intent); // Returns existing handle (now aborted)
    expect(handleAfterAbort.handle_id).toBe(handle.handle_id);
    expect(handleAfterAbort.status).toBe("aborted");
    // Note: abort updates the handle in-place, so meta should contain void_reason
    // But prepare returns the handle as-is, so we need to check the handle directly
    // Actually, the handle is updated in-place, so the meta should be updated
    expect(handleAfterAbort.meta?.void_reason).toBe("Negotiation failed");
  });

  it("abort is idempotent (safe to call multiple times)", async () => {
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
    await settlement.abort(handle.handle_id, "First abort");
    
    // Idempotent: safe to abort again
    await settlement.abort(handle.handle_id, "Second abort");

    // Funds still restored (no double-release)
    const account = settlement.getAccount("buyer-1");
    expect(account.balance).toBe(1.0);
    expect(account.locked).toBe(0.0);
  });

  it("abort after commit throws error (cannot void after capture)", async () => {
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
    await settlement.commit(handle.handle_id);

    // Cannot abort after commit (void after capture not allowed)
    await expect(settlement.abort(handle.handle_id)).rejects.toThrow(
      /Cannot void authorization after capture/
    );

    // Verify invariants: seller received payment, buyer balance decreased
    const buyerAccount = settlement.getAccount("buyer-1");
    const sellerAccount = settlement.getAccount("seller-1");
    expect(buyerAccount.balance).toBe(0.9); // 1.0 - 0.1
    expect(sellerAccount.balance).toBe(0.1); // Payment received
    expect(buyerAccount.locked).toBe(0.0); // Locked released on commit
  });

  it("prepare stores auth_id in handle meta (Stripe payment_intent id)", async () => {
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

    // Verify Stripe-like metadata
    expect(handle.meta?.auth_id).toBeDefined();
    expect(handle.meta?.auth_id).toMatch(/^pi_/); // Stripe payment_intent format
    expect(handle.meta?.payment_intent_id).toBe(handle.meta?.auth_id);
    expect(handle.meta?.from).toBe("buyer-1");
    expect(handle.meta?.to).toBe("seller-1");
  });

  it("commit stores capture_id in result meta", async () => {
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
    const result = await settlement.commit(handle.handle_id);

    // Verify Stripe-like metadata
    expect(result.meta?.capture_id).toBeDefined();
    expect(result.meta?.capture_id).toMatch(/^capt_/); // Stripe capture format
    expect(result.meta?.payment_intent_id).toBe(handle.meta?.auth_id);
    expect(result.meta?.auth_id).toBe(handle.meta?.auth_id);
  });

  it("commit idempotency preserves same capture_id", async () => {
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
    const result1 = await settlement.commit(handle.handle_id);
    const result2 = await settlement.commit(handle.handle_id);

    // Same capture_id (idempotent)
    expect(result2.meta?.capture_id).toBe(result1.meta?.capture_id);
    expect(result2.meta?.payment_intent_id).toBe(result1.meta?.payment_intent_id);
  });

  it("handles multiple different intents with different handle_ids", async () => {
    const settlement = new StripeLikeSettlementProvider();
    settlement.setBalance("buyer-1", 2.0);

    const intent1: SettlementIntent = {
      intent_id: "intent-1",
      from: "buyer-1",
      to: "seller-1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-1",
    };

    const intent2: SettlementIntent = {
      intent_id: "intent-2",
      from: "buyer-1",
      to: "seller-1",
      amount: 0.2,
      mode: "hash_reveal",
      idempotency_key: "key-2",
    };

    const handle1 = await settlement.prepare(intent1);
    const handle2 = await settlement.prepare(intent2);

    // Different handle_ids for different intents
    expect(handle2.handle_id).not.toBe(handle1.handle_id);
    expect(handle2.meta?.auth_id).not.toBe(handle1.meta?.auth_id);

    // Both funds locked
    const account = settlement.getAccount("buyer-1");
    expect(account.balance).toBeCloseTo(1.7, 10); // 2.0 - 0.1 - 0.2
    expect(account.locked).toBeCloseTo(0.3, 10); // 0.1 + 0.2
  });

  it("throws error if insufficient balance for prepare", async () => {
    const settlement = new StripeLikeSettlementProvider();
    settlement.setBalance("buyer-1", 0.05); // Less than required

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer-1",
      to: "seller-1",
      amount: 0.1, // More than balance
      mode: "hash_reveal",
      idempotency_key: "retry-abc",
    };

    await expect(settlement.prepare(intent)).rejects.toThrow(
      /Insufficient balance/
    );
  });

  it("throws error if handle not found for commit", async () => {
    const settlement = new StripeLikeSettlementProvider();
    
    await expect(settlement.commit("non-existent-handle")).rejects.toThrow(
      /Settlement handle not found/
    );
  });

  it("throws error if handle not found for abort", async () => {
    const settlement = new StripeLikeSettlementProvider();
    
    await expect(settlement.abort("non-existent-handle")).rejects.toThrow(
      /Settlement handle not found/
    );
  });

  it("delegates core settlement operations to mock provider", () => {
    const settlement = new StripeLikeSettlementProvider();
    settlement.setBalance("agent-1", 1.0);
    settlement.setBalance("agent-2", 0.0);

    // Test credit/debit
    settlement.credit("agent-1", 0.5);
    expect(settlement.getBalance("agent-1")).toBe(1.5);

    settlement.debit("agent-1", 0.3);
    expect(settlement.getBalance("agent-1")).toBe(1.2);

    // Test pay
    settlement.pay("agent-1", "agent-2", 0.2);
    expect(settlement.getBalance("agent-1")).toBe(1.0);
    expect(settlement.getBalance("agent-2")).toBe(0.2);

    // Test lock/unlock
    settlement.lock("agent-1", 0.1);
    expect(settlement.getBalance("agent-1")).toBe(0.9);
    expect(settlement.getLocked("agent-1")).toBe(0.1);

    settlement.unlock("agent-1", 0.1);
    expect(settlement.getBalance("agent-1")).toBe(1.0);
    expect(settlement.getLocked("agent-1")).toBe(0.0);
  });
});

