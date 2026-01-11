/**
 * Dispute Resolution Tests (C2)
 */

import { describe, it, expect, beforeEach } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveDispute, openDispute } from "../client";
import { createDefaultPolicy, compilePolicy } from "../../policy/index";
import { MockSettlementProvider } from "../../settlement/mock";
import { ExternalSettlementProvider } from "../../settlement/external";
import { createReceipt } from "../../exchange/receipt";
import { replayTranscript } from "../../transcript/replay";

describe("dispute resolution (C2)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-dispute-resolve-test-"));
  });

  // Helper to create keypairs
  function createKeyPair() {
    const keyPair = nacl.sign.keyPair();
    const id = bs58.encode(Buffer.from(keyPair.publicKey));
    return { keyPair, id };
  }

  it("should fail if disputes disabled", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    policy.base.disputes = {
      enabled: true, // Enable to open dispute
      window_ms: 100000,
      allow_partial: true,
      max_refund_pct: 1.0,
    };
    const compiled = compilePolicy(policy);
    const settlement = new MockSettlementProvider();
    settlement.setBalance(seller.id, 1.0);

    const receipt = createReceipt({
      intent_id: "test-intent",
      buyer_agent_id: buyer.id,
      seller_agent_id: seller.id,
      agreed_price: 0.1,
      paid_amount: 0.1,
      fulfilled: true,
      timestamp_ms: Date.now(),
    });

    // Open dispute first (disputes enabled)
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: Date.now(),
      policy: compiled.base as any,
      disputeDir: tempDir,
    });

    // Now disable disputes and try to resolve
    policy.base.disputes.enabled = false;
    const compiledDisabled = compilePolicy(policy);

    const result = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_FULL",
      now: Date.now(),
      policy: compiledDisabled.base as any,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("DISPUTES_NOT_ENABLED");
  });

  it("should refund buyer and debit seller for REFUND_FULL", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    policy.base.disputes = {
      enabled: true,
      window_ms: 100000,
      allow_partial: true,
      max_refund_pct: 1.0,
    };
    const compiled = compilePolicy(policy);
    const settlement = new MockSettlementProvider();
    settlement.setBalance(seller.id, 1.0); // Seller has funds
    settlement.setBalance(buyer.id, 0.0);

    const receipt = createReceipt({
      intent_id: "test-intent",
      buyer_agent_id: buyer.id,
      seller_agent_id: seller.id,
      agreed_price: 0.1,
      paid_amount: 0.1,
      fulfilled: true,
      timestamp_ms: Date.now(),
    });

    // Open dispute
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: Date.now(),
      policy: compiled.base as any,
      disputeDir: tempDir,
    });

    const sellerBalanceBefore = settlement.getBalance(seller.id);
    const buyerBalanceBefore = settlement.getBalance(buyer.id);

    const result = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_FULL",
      now: Date.now(),
      policy: compiled.base as any,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });

    expect(result.ok).toBe(true);
    expect(result.record?.status).toBe("RESOLVED");
    expect(result.record?.outcome).toBe("REFUND_FULL");
    expect(result.record?.refund_amount).toBe(0.1);

    // Check balances
    const sellerBalanceAfter = settlement.getBalance(seller.id);
    const buyerBalanceAfter = settlement.getBalance(buyer.id);

    expect(sellerBalanceAfter).toBe(sellerBalanceBefore - 0.1);
    expect(buyerBalanceAfter).toBe(buyerBalanceBefore + 0.1);
  });

  it("should respect max_refund_pct for REFUND_PARTIAL", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    policy.base.disputes = {
      enabled: true,
      window_ms: 100000,
      allow_partial: true,
      max_refund_pct: 1.0,
    };
    policy.base.disputes.allow_partial = true;
    policy.base.disputes.max_refund_pct = 0.5; // 50% max
    const compiled = compilePolicy(policy);
    const settlement = new MockSettlementProvider();
    settlement.setBalance(seller.id, 1.0);
    settlement.setBalance(buyer.id, 0.0);

    const receipt = createReceipt({
      intent_id: "test-intent",
      buyer_agent_id: buyer.id,
      seller_agent_id: seller.id,
      agreed_price: 0.1,
      paid_amount: 0.1,
      fulfilled: true,
      timestamp_ms: Date.now(),
    });

    // Open dispute
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: Date.now(),
      policy: compiled.base as any,
      disputeDir: tempDir,
    });

    // Try partial refund within max_refund_pct
    const result = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_PARTIAL",
      refund_amount: 0.05, // 50% of 0.1
      now: Date.now(),
      policy: compiled.base as any,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });

    expect(result.ok).toBe(true);
    expect(result.record?.refund_amount).toBe(0.05);

    // Try partial refund exceeding max_refund_pct
    const dispute2 = openDispute({
      receipt,
      reason: "Test dispute 2",
      now: Date.now(),
      policy: compiled.base as any,
      disputeDir: tempDir,
    });

    const result2 = await resolveDispute({
      dispute_id: dispute2.dispute_id,
      outcome: "REFUND_PARTIAL",
      refund_amount: 0.06, // 60% of 0.1 (exceeds 50% max)
      now: Date.now(),
      policy: compiled.base as any,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });

    expect(result2.ok).toBe(false);
    expect(result2.code).toBe("REFUND_EXCEEDS_MAX_PCT");
  });

  it("should be idempotent: resolving same dispute twice does not double-refund", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    policy.base.disputes = {
      enabled: true,
      window_ms: 100000,
      allow_partial: true,
      max_refund_pct: 1.0,
    };
    const compiled = compilePolicy(policy);
    const settlement = new MockSettlementProvider();
    settlement.setBalance(seller.id, 1.0);
    settlement.setBalance(buyer.id, 0.0);

    const receipt = createReceipt({
      intent_id: "test-intent",
      buyer_agent_id: buyer.id,
      seller_agent_id: seller.id,
      agreed_price: 0.1,
      paid_amount: 0.1,
      fulfilled: true,
      timestamp_ms: Date.now(),
    });

    // Open dispute
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: Date.now(),
      policy: compiled.base as any,
      disputeDir: tempDir,
    });

    const sellerBalanceBefore = settlement.getBalance(seller.id);
    const buyerBalanceBefore = settlement.getBalance(buyer.id);

    // Resolve first time
    const result1 = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_FULL",
      now: Date.now(),
      policy: compiled.base as any,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });

    expect(result1.ok).toBe(true);

    const sellerBalanceAfterFirst = settlement.getBalance(seller.id);
    const buyerBalanceAfterFirst = settlement.getBalance(buyer.id);

    // Try to resolve again (should fail because dispute is not OPEN)
    const result2 = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_FULL",
      now: Date.now(),
      policy: compiled.base as any,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });

    expect(result2.ok).toBe(false);
    expect(result2.code).toBe("DISPUTE_NOT_OPEN");

    // Balances should not have changed (idempotent)
    const sellerBalanceAfterSecond = settlement.getBalance(seller.id);
    const buyerBalanceAfterSecond = settlement.getBalance(buyer.id);

    expect(sellerBalanceAfterSecond).toBe(sellerBalanceAfterFirst);
    expect(buyerBalanceAfterSecond).toBe(buyerBalanceAfterFirst);
    expect(sellerBalanceAfterFirst).toBe(sellerBalanceBefore - 0.1);
    expect(buyerBalanceAfterFirst).toBe(buyerBalanceBefore + 0.1);
  });

  it("should handle external settlement provider not implemented error", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    policy.base.disputes = {
      enabled: true,
      window_ms: 100000,
      allow_partial: true,
      max_refund_pct: 1.0,
    };
    const compiled = compilePolicy(policy);
    const settlement = new ExternalSettlementProvider({ rail: "stripe" });

    const receipt = createReceipt({
      intent_id: "test-intent",
      buyer_agent_id: buyer.id,
      seller_agent_id: seller.id,
      agreed_price: 0.1,
      paid_amount: 0.1,
      fulfilled: true,
      timestamp_ms: Date.now(),
    });

    // Open dispute
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: Date.now(),
      policy: compiled.base as any,
      disputeDir: tempDir,
    });

    const result = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_FULL",
      now: Date.now(),
      policy: compiled.base as any,
      settlementProvider: settlement,
      receipt,
      disputeDir: tempDir,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED");
  });

  it("should write dispute event to transcript if transcriptPath provided", async () => {
    const buyer = createKeyPair();
    const seller = createKeyPair();
    const policy = createDefaultPolicy();
    policy.base.disputes = {
      enabled: true,
      window_ms: 100000,
      allow_partial: true,
      max_refund_pct: 1.0,
    };
    const compiled = compilePolicy(policy);
    const settlement = new MockSettlementProvider();
    settlement.setBalance(seller.id, 1.0);
    settlement.setBalance(buyer.id, 0.0);

    const receipt = createReceipt({
      intent_id: "test-intent",
      buyer_agent_id: buyer.id,
      seller_agent_id: seller.id,
      agreed_price: 0.1,
      paid_amount: 0.1,
      fulfilled: true,
      timestamp_ms: Date.now(),
    });

    // Create a transcript file
    const transcriptDir = path.join(tempDir, "transcripts");
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, "test-intent.json");
    
    const transcript = {
      version: "1",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      outcome: { ok: true },
      receipt,
    };
    
    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2), "utf-8");

    // Open dispute
    const dispute = openDispute({
      receipt,
      reason: "Test dispute",
      now: Date.now(),
      policy: compiled.base as any,
      transcriptPath,
      disputeDir: tempDir,
    });

    const result = await resolveDispute({
      dispute_id: dispute.dispute_id,
      outcome: "REFUND_FULL",
      now: Date.now(),
      policy: compiled.base as any,
      settlementProvider: settlement,
      receipt,
      transcriptPath,
      disputeDir: tempDir,
    });

    expect(result.ok).toBe(true);

    // Check transcript was updated
    const updatedTranscript = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
    expect(updatedTranscript.dispute_events).toBeDefined();
    expect(updatedTranscript.dispute_events.length).toBe(1);
    expect(updatedTranscript.dispute_events[0].dispute_id).toBe(dispute.dispute_id);
    expect(updatedTranscript.dispute_events[0].outcome).toBe("REFUND_FULL");
    expect(updatedTranscript.dispute_events[0].refund_amount).toBe(0.1);
    expect(updatedTranscript.dispute_events[0].status).toBe("resolved");

    // Check replay validation passes
    const replayResult = await replayTranscript(transcriptPath);
    expect(replayResult.ok).toBe(true);
  });
});

