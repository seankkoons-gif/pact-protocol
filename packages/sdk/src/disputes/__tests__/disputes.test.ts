/**
 * Disputes Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { openDispute, resolveDispute, createDispute, loadDispute, listDisputes } from "../index";
import { createDefaultPolicy } from "../../policy/defaultPolicy";
import { createReceipt } from "../../exchange/receipt";
import { MockSettlementProvider } from "../../settlement/mock";

describe("disputes", () => {
  let tempDir: string;
  let policy: ReturnType<typeof createDefaultPolicy>;
  let settlement: MockSettlementProvider;

  beforeEach(() => {
    // Create temp directory for dispute store
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-disputes-test-"));
    
    // Create policy with disputes enabled
    policy = createDefaultPolicy();
    policy.base.disputes = {
      enabled: true,
      window_ms: 86400000, // 24 hours
      allow_partial: true,
      max_refund_pct: 1.0,
    };
    
    settlement = new MockSettlementProvider();
    settlement.credit("seller", 1.0);
    settlement.credit("buyer", 0.5);
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should fail to open dispute if policy.disputes.enabled=false", () => {
    policy.base.disputes!.enabled = false;
    
    const receipt = createReceipt({
      intent_id: "intent-1",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.1,
      fulfilled: true,
      timestamp_ms: 1000,
      paid_amount: 0.1,
    });
    
    expect(() => {
      openDispute({
        receipt,
        reason: "Test dispute",
        now: 2000,
        policy,
        disputeDir: tempDir,
      });
    }).toThrow("Disputes are not enabled in policy");
  });

  it("should fail to open dispute if window_ms=0", () => {
    policy.base.disputes!.window_ms = 0;
    
    const receipt = createReceipt({
      intent_id: "intent-1",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.1,
      fulfilled: true,
      timestamp_ms: 1000,
      paid_amount: 0.1,
    });
    
    expect(() => {
      openDispute({
        receipt,
        reason: "Test dispute",
        now: 2000,
        policy,
        disputeDir: tempDir,
      });
    }).toThrow("Dispute window_ms must be > 0");
  });

  it("should fail to open dispute if window expired", () => {
    const receipt = createReceipt({
      intent_id: "intent-1",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.1,
      fulfilled: true,
      timestamp_ms: 1000,
      paid_amount: 0.1,
    });
    
    // Try to open dispute after window expired
    const now = 1000 + policy.base.disputes!.window_ms + 1;
    
    expect(() => {
      openDispute({
        receipt,
        reason: "Test dispute",
        now,
        policy,
        disputeDir: tempDir,
      });
    }).toThrow("Dispute window expired");
  });

  it("should successfully open dispute within window and write file", () => {
    const receipt = createReceipt({
      intent_id: "intent-1",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.1,
      fulfilled: true,
      timestamp_ms: 1000,
      paid_amount: 0.1,
    });
    
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: 2000,
      policy,
      transcriptPath: "/tmp/transcript.json",
      settlementMeta: {
        settlement_provider: "mock",
        settlement_handle_id: "handle-123",
      },
      disputeDir: tempDir,
    });
    
    expect(dispute.dispute_id).toContain("dispute-receipt-intent-1-1000-");
    expect(dispute.receipt_id).toBe(receipt.receipt_id);
    expect(dispute.intent_id).toBe("intent-1");
    expect(dispute.buyer_agent_id).toBe("buyer");
    expect(dispute.seller_agent_id).toBe("seller");
    expect(dispute.status).toBe("OPEN");
    expect(dispute.reason).toBe("Test dispute");
    expect(dispute.transcript_path).toBe("/tmp/transcript.json");
    expect(dispute.settlement_provider).toBe("mock");
    expect(dispute.settlement_handle_id).toBe("handle-123");
    expect(dispute.evidence.transcript).toBe(true);
    expect(dispute.evidence.receipt).toBe(true);
    expect(dispute.evidence.settlement_events).toBe(true);
    expect(dispute.deadline_at_ms).toBe(1000 + policy.base.disputes!.window_ms);
    
    // Verify file was written
    const filePath = path.join(tempDir, `${dispute.dispute_id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
    
    const loaded = loadDispute(dispute.dispute_id, tempDir);
    expect(loaded).toBeDefined();
    expect(loaded?.dispute_id).toBe(dispute.dispute_id);
  });

  it("should resolve dispute with REFUND_FULL and move funds back", async () => {
    const receipt = createReceipt({
      intent_id: "intent-1",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.1,
      fulfilled: true,
      timestamp_ms: 1000,
      paid_amount: 0.1,
    });
    
    // Open dispute
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: 2000,
      policy,
      disputeDir: tempDir,
    });
    
    // Initial balances: seller=1.0, buyer=0.5
    // Simulate payment: seller gets 0.1, buyer loses 0.1
    settlement.debit("buyer", 0.1);
    settlement.credit("seller", 0.1);
    expect(settlement.getBalance("seller")).toBe(1.1);
    expect(settlement.getBalance("buyer")).toBe(0.4);
    
    // Resolve with full refund
    const resolved = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_FULL",
      refund_amount: 0.1,
      notes: "Refund approved",
      now: 3000,
      policy,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });
    
    expect(resolved.ok).toBe(true);
    expect(resolved.record?.status).toBe("RESOLVED");
    expect(resolved.record?.outcome).toBe("REFUND_FULL");
    expect(resolved.record?.refund_amount).toBe(0.1);
    expect(resolved.record?.notes).toBe("Refund approved");
    
    // Verify funds moved back
    expect(settlement.getBalance("seller")).toBe(1.0); // Lost 0.1
    expect(settlement.getBalance("buyer")).toBe(0.5); // Got 0.1 back
    
    // Verify file was updated
    const loaded = loadDispute(dispute.dispute_id, tempDir);
    expect(loaded?.status).toBe("RESOLVED");
    expect(loaded?.outcome).toBe("REFUND_FULL");
  });

  it("should resolve dispute with REFUND_PARTIAL and respect max_refund_pct", async () => {
    policy.base.disputes!.max_refund_pct = 0.5; // Max 50% refund
    
    const receipt = createReceipt({
      intent_id: "intent-1",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.1,
      fulfilled: true,
      timestamp_ms: 1000,
      paid_amount: 0.1,
    });
    
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: 2000,
      policy,
      disputeDir: tempDir,
    });
    
    // Resolve with partial refund (0.05 = 50% of 0.1)
    const resolved = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_PARTIAL",
      refund_amount: 0.05,
      notes: "Partial refund",
      now: 3000,
      policy,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });
    
    expect(resolved.ok).toBe(true);
    expect(resolved.record?.status).toBe("RESOLVED");
    expect(resolved.record?.outcome).toBe("REFUND_PARTIAL");
    expect(resolved.record?.refund_amount).toBe(0.05);
  });

  it("should fail partial refund if allow_partial=false", async () => {
    policy.base.disputes!.allow_partial = false;
    
    const receipt = createReceipt({
      intent_id: "intent-1",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.1,
      fulfilled: true,
      timestamp_ms: 1000,
      paid_amount: 0.1,
    });
    
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: 2000,
      policy,
      disputeDir: tempDir,
    });
    
    const result = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_PARTIAL",
      refund_amount: 0.05,
      now: 3000,
      policy,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });
    
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PARTIAL_REFUND_NOT_ALLOWED");
  });

  it("should fail refund if seller has insufficient funds", async () => {
    const receipt = createReceipt({
      intent_id: "intent-1",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.1,
      fulfilled: true,
      timestamp_ms: 1000,
      paid_amount: 0.1,
    });
    
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: 2000,
      policy,
      disputeDir: tempDir,
    });
    
    // Seller has no balance
    settlement.setBalance("seller", 0);
    
    await expect(async () => {
      const result = await resolveDispute({
        dispute_id: dispute.dispute_id,
        outcome: "REFUND_FULL",
        refund_amount: 0.1,
        now: 3000,
        policy,
        settlementProvider: settlement,
        receipt,
        disputeDir: tempDir,
      });
      if (!result.ok) {
        throw new Error(result.reason || result.code || "Refund failed");
      }
    }).rejects.toThrow();
  });

  it("should list all disputes", () => {
    const receipt1 = createReceipt({
      intent_id: "intent-1",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.1,
      fulfilled: true,
      timestamp_ms: 1000,
      paid_amount: 0.1,
    });
    
    const receipt2 = createReceipt({
      intent_id: "intent-2",
      buyer_agent_id: "buyer",
      seller_agent_id: "seller",
      agreed_price: 0.2,
      fulfilled: true,
      timestamp_ms: 2000,
      paid_amount: 0.2,
    });
    
    const dispute1 = openDispute({
      receipt: receipt1,
      reason: "Dispute 1",
      now: 3000,
      policy,
      disputeDir: tempDir,
    });
    
    const dispute2 = openDispute({
      receipt: receipt2,
      reason: "Dispute 2",
      now: 4000,
      policy,
      disputeDir: tempDir,
    });
    
    const disputes = listDisputes(tempDir);
    expect(disputes).toHaveLength(2);
    expect(disputes.map(d => d.dispute_id).sort()).toEqual([dispute1.dispute_id, dispute2.dispute_id].sort());
  });
});

