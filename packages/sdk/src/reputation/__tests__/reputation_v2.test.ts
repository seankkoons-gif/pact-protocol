/**
 * Reputation V2 Tests
 * 
 * Tests for credential-aware, volume-weighted reputation scoring.
 */

import { describe, it, expect } from "vitest";
import { agentScoreV2, type AgentScoreV2Context } from "../scoreV2";
import type { Receipt } from "../../exchange/receipt";

describe("reputation v2", () => {
  describe("agentScoreV2", () => {
    it("returns default score for agent with no trades", () => {
      const score = agentScoreV2("agent1", []);
      expect(score.reputation).toBe(0.5);
      expect(score.trades).toBe(0);
      expect(score.volume).toBe(0);
      expect(score.penalties.failedProof).toBe(0);
      expect(score.penalties.buyerStopped).toBe(0);
    });

    it("gives credential bonus when credential is present", () => {
      // Use receipts that result in reputation < 1.0 so boost is visible
      const receipts: (Receipt | any)[] = [
        { receipt_id: "r1", intent_id: "i1", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.01, fulfilled: true, timestamp_ms: 1000 },
        { receipt_id: "r2", intent_id: "i2", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.01, fulfilled: false, timestamp_ms: 2000 },
      ];

      const scoreWithoutCredential = agentScoreV2("agent1", receipts, { credentialPresent: false });
      const scoreWithCredential = agentScoreV2("agent1", receipts, { credentialPresent: true });

      // Credential should give a small boost (5%)
      expect(scoreWithCredential.reputation).toBeGreaterThan(scoreWithoutCredential.reputation);
      expect(scoreWithCredential.reputation).toBeLessThanOrEqual(1.0);
      expect(scoreWithCredential.notes.some(n => n.includes("Credential verified"))).toBe(true);
    });

    it("micro trade doesn't inflate score", () => {
      // Create many tiny trades that would inflate trade count
      const microTrades: (Receipt | any)[] = [];
      for (let i = 0; i < 100; i++) {
        microTrades.push({
          receipt_id: `r${i}`,
          intent_id: `i${i}`,
          buyer_agent_id: "b",
          seller_agent_id: "agent1",
          agreed_price: 1e-8, // Very small amount
          fulfilled: true,
          timestamp_ms: 1000 + i,
        });
      }

      // Add one substantial trade
      microTrades.push({
        receipt_id: "r100",
        intent_id: "i100",
        buyer_agent_id: "b",
        seller_agent_id: "agent1",
        agreed_price: 0.1, // Substantial amount
        fulfilled: true,
        timestamp_ms: 2000,
      });

      const score = agentScoreV2("agent1", microTrades);

      // Volume should be weighted - micro trades should contribute very little
      // The substantial trade should dominate
      expect(score.volume).toBeLessThan(0.2); // Weighted volume should be much less than raw sum
      expect(score.trades).toBe(101); // All trades counted
      expect(score.reputation).toBeGreaterThan(0); // Should still have positive reputation
    });

    it("FAILED_PROOF slashes reputation meaningfully", () => {
      const receipts: (Receipt | any)[] = [
        { receipt_id: "r1", intent_id: "i1", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, fulfilled: true, timestamp_ms: 1000 },
        { receipt_id: "r2", intent_id: "i2", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, fulfilled: true, timestamp_ms: 2000 },
        { receipt_id: "r3", intent_id: "i3", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, fulfilled: false, failure_code: "FAILED_PROOF", timestamp_ms: 3000 },
      ];

      const score = agentScoreV2("agent1", receipts);

      // FAILED_PROOF should significantly reduce reputation
      expect(score.penalties.failedProof).toBe(1);
      expect(score.reputation).toBeLessThan(0.5); // Should be penalized below neutral
      expect(score.notes.some(n => n.includes("FAILED_PROOF"))).toBe(true);
    });

    it("BUYER_STOPPED penalizes buyer reputation more than seller", () => {
      // Seller perspective
      const sellerReceipts: (Receipt | any)[] = [
        { receipt_id: "r1", intent_id: "i1", buyer_agent_id: "buyer1", seller_agent_id: "seller1", agreed_price: 0.1, fulfilled: false, failure_code: "BUYER_STOPPED", timestamp_ms: 1000 },
        { receipt_id: "r2", intent_id: "i2", buyer_agent_id: "buyer1", seller_agent_id: "seller1", agreed_price: 0.1, fulfilled: true, timestamp_ms: 2000 },
      ];

      // Buyer perspective
      const buyerReceipts: (Receipt | any)[] = [
        { receipt_id: "r1", intent_id: "i1", buyer_agent_id: "buyer1", seller_agent_id: "seller1", agreed_price: 0.1, fulfilled: false, failure_code: "BUYER_STOPPED", timestamp_ms: 1000 },
        { receipt_id: "r2", intent_id: "i2", buyer_agent_id: "buyer1", seller_agent_id: "seller1", agreed_price: 0.1, fulfilled: true, timestamp_ms: 2000 },
      ];

      const sellerScore = agentScoreV2("seller1", sellerReceipts);
      const buyerScore = agentScoreV2("buyer1", buyerReceipts);

      // Buyer should be penalized more than seller for BUYER_STOPPED
      expect(buyerScore.penalties.buyerStopped).toBe(1);
      expect(sellerScore.penalties.buyerStopped).toBe(0); // Seller doesn't get penalized for buyer stopping
      
      // Buyer reputation should be lower due to penalty
      expect(buyerScore.reputation).toBeLessThan(sellerScore.reputation);
      expect(buyerScore.notes.some(n => n.includes("BUYER_STOPPED"))).toBe(true);
    });

    it("credentialPresent improves selection score marginally", () => {
      // Use receipts that result in reputation < 1.0 so boost is visible
      const receipts: (Receipt | any)[] = [
        { receipt_id: "r1", intent_id: "i1", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, fulfilled: true, timestamp_ms: 1000 },
        { receipt_id: "r2", intent_id: "i2", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, fulfilled: false, timestamp_ms: 2000 },
      ];

      const context: AgentScoreV2Context = {
        credentialPresent: true,
        credentialClaims: {
          credentials: ["sla_verified"],
          region: "us-east",
          modes: ["hash_reveal"],
        },
        intentType: "weather.data",
      };

      const scoreWithCredential = agentScoreV2("agent1", receipts, context);
      const scoreWithoutCredential = agentScoreV2("agent1", receipts, { credentialPresent: false });

      // Credential should give a small boost (5%)
      expect(scoreWithCredential.reputation).toBeGreaterThan(scoreWithoutCredential.reputation);
      expect(scoreWithCredential.reputation).toBeLessThanOrEqual(1.0);
      expect(scoreWithCredential.notes.some(n => n.includes("Credential verified"))).toBe(true);
    });

    it("uses paid_amount when present for volume calculation", () => {
      const receipts: (Receipt | any)[] = [
        { receipt_id: "r1", intent_id: "i1", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, paid_amount: 0.05, fulfilled: true, timestamp_ms: 1000 },
        { receipt_id: "r2", intent_id: "i2", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, fulfilled: true, timestamp_ms: 2000 },
      ];

      const score = agentScoreV2("agent1", receipts);

      // Volume should use paid_amount (0.05) for first receipt, agreed_price (0.1) for second
      // Weighted volume should reflect this
      expect(score.volume).toBeGreaterThan(0);
      expect(score.trades).toBe(2);
    });

    it("handles multiple FAILED_PROOF penalties correctly", () => {
      const receipts: (Receipt | any)[] = [
        { receipt_id: "r1", intent_id: "i1", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, fulfilled: true, timestamp_ms: 1000 },
        { receipt_id: "r2", intent_id: "i2", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, fulfilled: false, failure_code: "FAILED_PROOF", timestamp_ms: 2000 },
        { receipt_id: "r3", intent_id: "i3", buyer_agent_id: "b", seller_agent_id: "agent1", agreed_price: 0.1, fulfilled: false, failure_code: "FAILED_PROOF", timestamp_ms: 3000 },
      ];

      const score = agentScoreV2("agent1", receipts);

      expect(score.penalties.failedProof).toBe(2);
      // With 2 out of 3 trades being FAILED_PROOF, reputation should be very low
      expect(score.reputation).toBeLessThan(0.3);
    });
  });
});

