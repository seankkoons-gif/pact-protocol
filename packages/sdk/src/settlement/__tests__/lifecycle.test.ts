/**
 * Settlement Lifecycle Tests
 * 
 * Tests for settlement lifecycle API (prepare, commit, abort) and idempotency.
 */

import { describe, it, expect } from "vitest";
import { MockSettlementProvider } from "../mock";
import type { SettlementIntent } from "../types";

describe("Settlement Lifecycle (v1.6.1+)", () => {
  it("prepare is idempotent - same handle returned for same (intent_id, idempotency_key)", async () => {
    const settlement = new MockSettlementProvider();
    settlement.credit("buyer1", 1.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-abc",
    };

    // First prepare
    const handle1 = await settlement.prepare(intent);
    expect(handle1.status).toBe("prepared");
    expect(handle1.intent_id).toBe("intent-123");
    expect(handle1.locked_amount).toBe(0.1);
    
    const locked1 = settlement.getLocked("buyer1");
    const balance1 = settlement.getBalance("buyer1");
    expect(locked1).toBe(0.1);
    expect(balance1).toBe(0.9);

    // Second prepare with same intent_id and idempotency_key
    const handle2 = await settlement.prepare(intent);
    expect(handle2.handle_id).toBe(handle1.handle_id);
    expect(handle2.status).toBe("prepared");
    expect(handle2.locked_amount).toBe(0.1);
    
    // Funds should not be locked again
    const locked2 = settlement.getLocked("buyer1");
    const balance2 = settlement.getBalance("buyer1");
    expect(locked2).toBe(0.1); // Same as before
    expect(balance2).toBe(0.9); // Same as before
  });

  it("prepare with different idempotency_key creates different handle", async () => {
    const settlement = new MockSettlementProvider();
    settlement.credit("buyer1", 1.0);

    const intent1: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-abc",
    };

    const intent2: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-xyz", // Different key
    };

    const handle1 = await settlement.prepare(intent1);
    const handle2 = await settlement.prepare(intent2);

    // Different handles should be created
    expect(handle1.handle_id).not.toBe(handle2.handle_id);
    
    // Both should lock funds (different handles)
    expect(settlement.getLocked("buyer1")).toBe(0.2); // 0.1 + 0.1
    expect(settlement.getBalance("buyer1")).toBe(0.8); // 1.0 - 0.2
  });

  it("commit is idempotent - returns same result on repeated calls", async () => {
    const settlement = new MockSettlementProvider();
    settlement.credit("buyer1", 1.0);
    settlement.credit("seller1", 0.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-abc",
    };

    const handle = await settlement.prepare(intent);
    
    // First commit
    const result1 = await settlement.commit(handle.handle_id);
    expect(result1.ok).toBe(true);
    expect(result1.status).toBe("committed");
    expect(result1.paid_amount).toBe(0.1);
    
    const balance1 = settlement.getBalance("seller1");
    expect(balance1).toBe(0.1);

    // Second commit (idempotent)
    const result2 = await settlement.commit(handle.handle_id);
    expect(result2.handle_id).toBe(result1.handle_id);
    expect(result2.status).toBe("committed");
    expect(result2.paid_amount).toBe(0.1);
    
    // Funds should not be transferred again
    const balance2 = settlement.getBalance("seller1");
    expect(balance2).toBe(0.1); // Same as before, not 0.2
  });

  it("abort releases funds and is idempotent", async () => {
    const settlement = new MockSettlementProvider();
    settlement.credit("buyer1", 1.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-abc",
    };

    const handle = await settlement.prepare(intent);
    expect(settlement.getLocked("buyer1")).toBe(0.1);
    expect(settlement.getBalance("buyer1")).toBe(0.9);

    // First abort
    await settlement.abort(handle.handle_id, "Test abort reason");
    
    const locked1 = settlement.getLocked("buyer1");
    const balance1 = settlement.getBalance("buyer1");
    expect(locked1).toBe(0);
    expect(balance1).toBe(1.0); // Funds released

    // Second abort (idempotent)
    await settlement.abort(handle.handle_id);
    
    // Funds should not be released again (already aborted)
    const locked2 = settlement.getLocked("buyer1");
    const balance2 = settlement.getBalance("buyer1");
    expect(locked2).toBe(0);
    expect(balance2).toBe(1.0); // Same as before
  });

  it("abort cannot be called on committed handle", async () => {
    const settlement = new MockSettlementProvider();
    settlement.credit("buyer1", 1.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-abc",
    };

    const handle = await settlement.prepare(intent);
    await settlement.commit(handle.handle_id);

    // Cannot abort committed handle
    await expect(settlement.abort(handle.handle_id)).rejects.toThrow(
      /Cannot abort handle in status "committed"/
    );
  });

  it("commit cannot be called on aborted handle", async () => {
    const settlement = new MockSettlementProvider();
    settlement.credit("buyer1", 1.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-abc",
    };

    const handle = await settlement.prepare(intent);
    await settlement.abort(handle.handle_id);

    // Cannot commit aborted handle
    await expect(settlement.commit(handle.handle_id)).rejects.toThrow(
      /Cannot commit handle in status "aborted"/
    );
  });

  it("prepare throws on insufficient balance", async () => {
    const settlement = new MockSettlementProvider();
    settlement.credit("buyer1", 0.05); // Less than amount

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-abc",
    };

    await expect(settlement.prepare(intent)).rejects.toThrow(
      /Insufficient balance/
    );
  });

  it("commit transfers locked funds from buyer to seller", async () => {
    const settlement = new MockSettlementProvider();
    settlement.credit("buyer1", 1.0);
    settlement.credit("seller1", 0.0);

    const intent: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      idempotency_key: "key-abc",
    };

    const handle = await settlement.prepare(intent);
    expect(settlement.getLocked("buyer1")).toBe(0.1);
    expect(settlement.getBalance("buyer1")).toBe(0.9);
    expect(settlement.getBalance("seller1")).toBe(0.0);

    await settlement.commit(handle.handle_id);

    expect(settlement.getLocked("buyer1")).toBe(0);
    expect(settlement.getBalance("buyer1")).toBe(0.9); // Unchanged (locked was transferred)
    expect(settlement.getBalance("seller1")).toBe(0.1); // Funds transferred
  });

  it("prepare without idempotency_key still works (uses empty key)", async () => {
    const settlement = new MockSettlementProvider();
    settlement.credit("buyer1", 1.0);

    const intent1: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      // No idempotency_key
    };

    const intent2: SettlementIntent = {
      intent_id: "intent-123",
      from: "buyer1",
      to: "seller1",
      amount: 0.1,
      mode: "hash_reveal",
      // No idempotency_key (same as intent1)
    };

    const handle1 = await settlement.prepare(intent1);
    const handle2 = await settlement.prepare(intent2);

    // Should be idempotent (same handle)
    expect(handle1.handle_id).toBe(handle2.handle_id);
    expect(settlement.getLocked("buyer1")).toBe(0.1); // Only locked once
  });
});




