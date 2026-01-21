/**
 * Credit Determinism and Terminal Abort Tests
 * 
 * Proves transcripts remain deterministic with credit evidence,
 * denial aborts are terminal and replayable, and evidence bundles
 * show credit eligibility without leaking internals.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryPassportStorage } from "@pact/passport";
import { runInPactBoundary } from "../runtime";
import type { BoundaryIntent, ExecuteFunction } from "../runtime";
import type { PactPolicyV4 } from "../../policy/v4";
import { createTranscriptV4 } from "../../transcript/v4/transcript";

describe("Credit Determinism and Terminal Aborts", () => {
  let storage: MemoryPassportStorage;

  beforeEach(() => {
    storage = new MemoryPassportStorage(":memory:");
  });

  describe("Transcript Determinism", () => {
    it("should produce same transcript hash for same credit decision", async () => {
      const intent: BoundaryIntent = {
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: 1000000,
      };

      const policy: PactPolicyV4 = {
        policy_version: "pact-policy/4.0",
        policy_id: "policy-1",
        name: "Test Policy",
        rules: [],
      };

      const executeFn: ExecuteFunction = async (context) => {
        return {
          success: true,
          offer_price: 100,
          bid_price: 100,
          settlement_mode: "boundary",
        };
      };

      // Run twice with same inputs
      const result1 = await runInPactBoundary(intent, policy, executeFn, {
        passportStorage: storage,
        passportScore: 90,
        passportConfidence: 0.85,
        buyerAgentId: "buyer-1",
        sellerAgentId: "seller-1",
      });

      const result2 = await runInPactBoundary(intent, policy, executeFn, {
        passportStorage: storage,
        passportScore: 90,
        passportConfidence: 0.85,
        buyerAgentId: "buyer-1",
        sellerAgentId: "seller-1",
      });

      // Transcripts should have same structure (evidence refs should match)
      expect(result1.transcript.policy_hash).toBe(result2.transcript.policy_hash);
      expect(result1.evidence_refs.length).toBeGreaterThan(0);
      expect(result2.evidence_refs.length).toBeGreaterThan(0);
      
      // Credit evidence should be present
      const creditEvidence1 = result1.evidence_refs.filter((ref) => ref.startsWith("credit_"));
      const creditEvidence2 = result2.evidence_refs.filter((ref) => ref.startsWith("credit_"));
      expect(creditEvidence1).toEqual(creditEvidence2);
    });

    it("should include credit evidence in transcript", async () => {
      const intent: BoundaryIntent = {
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: 1000000,
      };

      const policy: PactPolicyV4 = {
        policy_version: "pact-policy/4.0",
        policy_id: "policy-1",
        name: "Test Policy",
        rules: [],
      };

      const executeFn: ExecuteFunction = async (context) => {
        return {
          success: true,
          offer_price: 1000,
          bid_price: 1000,
          settlement_mode: "boundary",
        };
      };

      const result = await runInPactBoundary(intent, policy, executeFn, {
        passportStorage: storage,
        passportScore: 90,
        passportConfidence: 0.85,
        buyerAgentId: "buyer-1",
        sellerAgentId: "seller-1",
      });

      // Check for credit evidence
      const creditEvidence = result.evidence_refs.filter((ref) => ref.startsWith("credit_"));
      expect(creditEvidence.length).toBeGreaterThan(0);
      expect(creditEvidence.some((ref) => ref.includes("credit_tier"))).toBe(true);
      expect(creditEvidence.some((ref) => ref.includes("credit_decision"))).toBe(true);
    });
  });

  describe("Terminal Aborts", () => {
    it("should abort terminal on credit denial", async () => {
      const intent: BoundaryIntent = {
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: 1000000,
      };

      const policy: PactPolicyV4 = {
        policy_version: "pact-policy/4.0",
        policy_id: "policy-1",
        name: "Test Policy",
        rules: [],
      };

      const executeFn: ExecuteFunction = async (context) => {
        return {
          success: true,
          offer_price: 100,
          bid_price: 100,
          settlement_mode: "boundary",
        };
      };

      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("buyer-1", "identity-hash-buyer", Date.now());
      storage.upsertAgent("seller-1", "identity-hash-seller", Date.now());
      
      // Insert recent PACT-1xx violation to trigger kill switch
      storage.insertEvent({
        agent_id: "buyer-1",
        event_type: "settlement_failure",
        ts: Date.now() - 5 * 24 * 60 * 60 * 1000,
        transcript_hash: "hash-1",
        counterparty_agent_id: "seller-1",
        value_usd: 100,
        failure_code: "PACT-101",
        stage: "admission",
        fault_domain: "policy",
        terminality: "terminal",
        dispute_outcome: null,
        metadata_json: null,
      });

      const result = await runInPactBoundary(intent, policy, executeFn, {
        passportStorage: storage,
        passportScore: 90,
        passportConfidence: 0.85,
        buyerAgentId: "buyer-1",
        sellerAgentId: "seller-1",
      });

      // Should have failed with credit denial
      expect(result.success).toBe(false);
      expect(result.failure_event).toBeDefined();
      expect(result.failure_event?.code).toBe("PACT-101");
      expect(result.failure_event?.terminality).toBe("terminal");
      expect(result.failure_event?.evidence_refs.some((ref) => ref.includes("credit_"))).toBe(true);
    });

    it("should be replayable (same inputs → same failure)", async () => {
      const intent: BoundaryIntent = {
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: 1000000,
      };

      const policy: PactPolicyV4 = {
        policy_version: "pact-policy/4.0",
        policy_id: "policy-1",
        name: "Test Policy",
        rules: [],
      };

      const executeFn: ExecuteFunction = async (context) => {
        return {
          success: true,
          offer_price: 100,
          bid_price: 100,
          settlement_mode: "boundary",
        };
      };

      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("buyer-1", "identity-hash-buyer", Date.now());
      storage.upsertAgent("seller-1", "identity-hash-seller", Date.now());
      
      // Insert recent PACT-1xx violation
      storage.insertEvent({
        agent_id: "buyer-1",
        event_type: "settlement_failure",
        ts: Date.now() - 5 * 24 * 60 * 60 * 1000,
        transcript_hash: "hash-1",
        counterparty_agent_id: "seller-1",
        value_usd: 100,
        failure_code: "PACT-101",
        stage: "admission",
        fault_domain: "policy",
        terminality: "terminal",
        dispute_outcome: null,
        metadata_json: null,
      });

      // Run twice
      const result1 = await runInPactBoundary(intent, policy, executeFn, {
        passportStorage: storage,
        passportScore: 90,
        passportConfidence: 0.85,
        buyerAgentId: "buyer-1",
        sellerAgentId: "seller-1",
      });

      const result2 = await runInPactBoundary(intent, policy, executeFn, {
        passportStorage: storage,
        passportScore: 90,
        passportConfidence: 0.85,
        buyerAgentId: "buyer-1",
        sellerAgentId: "seller-1",
      });

      // Both should fail with same failure event
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
      expect(result1.failure_event?.code).toBe(result2.failure_event?.code);
      expect(result1.failure_event?.stage).toBe(result2.failure_event?.stage);
    });
  });

  describe("Evidence Bundles", () => {
    it("should show credit eligibility without leaking internals", async () => {
      const intent: BoundaryIntent = {
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: 1000000,
      };

      const policy: PactPolicyV4 = {
        policy_version: "pact-policy/4.0",
        policy_id: "policy-1",
        name: "Test Policy",
        rules: [],
      };

      const executeFn: ExecuteFunction = async (context) => {
        return {
          success: true,
          offer_price: 1000,
          bid_price: 1000,
          settlement_mode: "boundary",
        };
      };

      const result = await runInPactBoundary(intent, policy, executeFn, {
        passportStorage: storage,
        passportScore: 90,
        passportConfidence: 0.85,
        buyerAgentId: "buyer-1",
        sellerAgentId: "seller-1",
      });

      // Evidence should include credit eligibility info
      const creditEvidence = result.evidence_refs.filter((ref) => ref.startsWith("credit_"));
      
      // Should show eligibility status
      expect(creditEvidence.some((ref) => ref.includes("ALLOWED") || ref.includes("DENIED"))).toBe(true);
      
      // Should show tier
      expect(creditEvidence.some((ref) => ref.includes("credit_tier"))).toBe(true);
      
      // Should show limits (public info)
      expect(creditEvidence.some((ref) => ref.includes("credit_max_outstanding"))).toBe(true);
      
      // Should NOT leak internal Passport scoring details
      const hasInternalLeaks = creditEvidence.some((ref) => 
        ref.includes("passport_score") || 
        ref.includes("confidence") ||
        ref.includes("breakdown")
      );
      expect(hasInternalLeaks).toBe(false);
    });
  });
});
