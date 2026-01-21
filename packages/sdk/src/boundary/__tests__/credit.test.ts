/**
 * Credit Integration Tests for Pact Boundary
 * 
 * Tests credit evaluation, evidence embedding, and failure event generation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryPassportStorage } from "@pact/passport";
import {
  evaluateCreditBeforeSettlement,
  createCreditFailureEvent,
  type CreditEvaluationContext,
} from "../credit";
import type { TranscriptV4 } from "../../transcript/v4/replay";

describe("Credit Integration in Boundary", () => {
  let storage: MemoryPassportStorage;

  beforeEach(() => {
    storage = new MemoryPassportStorage(":memory:");
  });

  describe("evaluateCreditBeforeSettlement", () => {
    it("should allow credit for Tier A agent", () => {
      const context: CreditEvaluationContext = {
        agent_id: "agent-1",
        counterparty_id: "counterparty-1",
        commitment_amount_usd: 1000,
        passport_score: 90,
        passport_confidence: 0.85,
        as_of_ms: Date.now(),
      };

      const result = evaluateCreditBeforeSettlement(storage, context);

      expect(result.decision.allowed).toBe(true);
      expect(result.terms.tier).toBe("A");
      expect(result.required_collateral_usd).toBe(200); // 20% of 1000
      expect(result.credit_exposure_usd).toBe(800); // 80% credit
      expect(result.evidence_refs).toContain("credit_tier:agent-1:A");
      expect(result.evidence_refs).toContain("credit_decision:agent-1:ALLOWED");
    });

    it("should deny credit for Tier C agent", () => {
      const context: CreditEvaluationContext = {
        agent_id: "agent-1",
        counterparty_id: "counterparty-1",
        commitment_amount_usd: 100,
        passport_score: 65,
        passport_confidence: 0.8,
        as_of_ms: Date.now(),
      };

      const result = evaluateCreditBeforeSettlement(storage, context);

      expect(result.decision.allowed).toBe(false);
      expect(result.terms.tier).toBe("C");
      expect(result.required_collateral_usd).toBe(100); // 100% collateral
      expect(result.credit_exposure_usd).toBe(0);
      expect(result.evidence_refs).toContain("credit_denial_reason:TIER_TOO_LOW");
    });

    it("should include kill switch evidence if disabled", () => {
      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      storage.upsertAgent("counterparty-1", "identity-hash-2", Date.now());
      
      // Insert recent PACT-1xx violation
      storage.insertEvent({
        agent_id: "agent-1",
        event_type: "settlement_failure",
        ts: Date.now() - 5 * 24 * 60 * 60 * 1000,
        transcript_hash: "hash-1",
        counterparty_agent_id: "counterparty-1",
        value_usd: 100,
        failure_code: "PACT-101",
        stage: "admission",
        fault_domain: "policy",
        terminality: "terminal",
        dispute_outcome: null,
        metadata_json: null,
      });

      const context: CreditEvaluationContext = {
        agent_id: "agent-1",
        counterparty_id: "counterparty-1",
        commitment_amount_usd: 100,
        passport_score: 90,
        passport_confidence: 0.85,
        as_of_ms: Date.now(),
      };

      const result = evaluateCreditBeforeSettlement(storage, context);

      expect(result.decision.allowed).toBe(false);
      expect(result.evidence_refs.some((ref) => ref.includes("credit_disabled_until"))).toBe(true);
      expect(result.evidence_refs.some((ref) => ref.includes("credit_disable_reason"))).toBe(true);
    });
  });

  describe("createCreditFailureEvent", () => {
    it("should return null if credit is allowed", () => {
      const context: CreditEvaluationContext = {
        agent_id: "agent-1",
        counterparty_id: "counterparty-1",
        commitment_amount_usd: 1000,
        passport_score: 90,
        passport_confidence: 0.85,
        as_of_ms: Date.now(),
      };

      const creditResult = evaluateCreditBeforeSettlement(storage, context);
      const transcript: TranscriptV4 = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "transcript-1",
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: Date.now(),
        policy_hash: "policy-hash",
        strategy_hash: "strategy-hash",
        identity_snapshot_hash: "identity-hash",
        rounds: [],
      };

      const failureEvent = createCreditFailureEvent(creditResult, transcript, Date.now());

      expect(failureEvent).toBeNull();
    });

    it("should create failure event if credit is denied", () => {
      const context: CreditEvaluationContext = {
        agent_id: "agent-1",
        counterparty_id: "counterparty-1",
        commitment_amount_usd: 100,
        passport_score: 65,
        passport_confidence: 0.8,
        as_of_ms: Date.now(),
      };

      const creditResult = evaluateCreditBeforeSettlement(storage, context);
      const transcript: TranscriptV4 = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "transcript-1",
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: Date.now(),
        policy_hash: "policy-hash",
        strategy_hash: "strategy-hash",
        identity_snapshot_hash: "identity-hash",
        rounds: [],
      };

      const failureEvent = createCreditFailureEvent(creditResult, transcript, Date.now());

      expect(failureEvent).not.toBeNull();
      expect(failureEvent?.code).toBe("PACT-101");
      expect(failureEvent?.fault_domain).toBe("policy");
      expect(failureEvent?.stage).toBe("commitment");
      expect(failureEvent?.terminality).toBe("terminal");
      expect(failureEvent?.evidence_refs.length).toBeGreaterThan(0);
    });
  });

  describe("Deterministic Requirements", () => {
    it("should produce same evidence refs for same inputs", () => {
      const context: CreditEvaluationContext = {
        agent_id: "agent-1",
        counterparty_id: "counterparty-1",
        commitment_amount_usd: 1000,
        passport_score: 90,
        passport_confidence: 0.85,
        as_of_ms: Date.now(),
      };

      const result1 = evaluateCreditBeforeSettlement(storage, context);
      const result2 = evaluateCreditBeforeSettlement(storage, context);

      expect(result1.evidence_refs).toEqual(result2.evidence_refs);
      expect(result1.decision.allowed).toBe(result2.decision.allowed);
      expect(result1.required_collateral_usd).toBe(result2.required_collateral_usd);
    });
  });
});
