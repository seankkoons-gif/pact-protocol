/**
 * Credit Risk Engine Tests
 * 
 * Tests for deterministic credit terms computation and credit extension checks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PassportStorage } from "../../storage";
import {
  computeCreditTerms,
  canExtendCredit,
  applyCreditEventFromTranscript,
} from "../riskEngine";
import type { TranscriptV4 } from "../../types";

describe("Credit Risk Engine", () => {
  let storage: PassportStorage;

  beforeEach(() => {
    // Create in-memory database for tests
    storage = new PassportStorage(":memory:");
  });

  describe("computeCreditTerms", () => {
    it("should assign Tier C for low score", () => {
      const terms = computeCreditTerms("agent-1", storage, 65, 0.8, Date.now());
      expect(terms.tier).toBe("C");
      expect(terms.collateral_ratio).toBe(1.0);
      expect(terms.required_escrow).toBe(true);
      expect(terms.max_outstanding_exposure_usd).toBe(0);
    });

    it("should assign Tier C for low confidence", () => {
      const terms = computeCreditTerms("agent-1", storage, 75, 0.5, Date.now());
      expect(terms.tier).toBe("C");
    });

    it("should assign Tier B for medium score and confidence", () => {
      const terms = computeCreditTerms("agent-1", storage, 75, 0.75, Date.now());
      expect(terms.tier).toBe("B");
      expect(terms.collateral_ratio).toBe(0.5);
      expect(terms.required_escrow).toBe(true);
      expect(terms.max_outstanding_exposure_usd).toBe(1000);
    });

    it("should assign Tier A for high score and confidence", () => {
      const terms = computeCreditTerms("agent-1", storage, 90, 0.85, Date.now());
      expect(terms.tier).toBe("A");
      expect(terms.collateral_ratio).toBe(0.2);
      expect(terms.required_escrow).toBe(false);
      expect(terms.max_outstanding_exposure_usd).toBe(5000);
    });

    it("should be deterministic (same inputs → same tier)", () => {
      const score = 85;
      const confidence = 0.8;
      const asOf = Date.now();

      const terms1 = computeCreditTerms("agent-1", storage, score, confidence, asOf);
      const terms2 = computeCreditTerms("agent-1", storage, score, confidence, asOf);

      expect(terms1.tier).toBe(terms2.tier);
      expect(terms1.collateral_ratio).toBe(terms2.collateral_ratio);
      expect(terms1.max_outstanding_exposure_usd).toBe(terms2.max_outstanding_exposure_usd);
    });

    it("should trigger kill switch on recent PACT-1xx violation", () => {
      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      storage.upsertAgent("counterparty-1", "identity-hash-2", Date.now());
      
      // Insert a recent PACT-1xx failure
      storage.insertEvent({
        agent_id: "agent-1",
        event_type: "settlement_failure",
        ts: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
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

      const terms = computeCreditTerms("agent-1", storage, 90, 0.85, Date.now());
      expect(terms.tier).toBe("C");
      expect(terms.disabled_until).toBeDefined();
      expect(terms.reason).toBe("PACT-1xx_VIOLATION");
    });

    it("should trigger kill switch on recent PACT-2xx violation", () => {
      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      storage.upsertAgent("counterparty-1", "identity-hash-2", Date.now());
      
      storage.insertEvent({
        agent_id: "agent-1",
        event_type: "settlement_failure",
        ts: Date.now() - 5 * 24 * 60 * 60 * 1000,
        transcript_hash: "hash-1",
        counterparty_agent_id: "counterparty-1",
        value_usd: 100,
        failure_code: "PACT-201",
        stage: "admission",
        fault_domain: "identity",
        terminality: "terminal",
        dispute_outcome: null,
        metadata_json: null,
      });

      const terms = computeCreditTerms("agent-1", storage, 90, 0.85, Date.now());
      expect(terms.tier).toBe("C");
      expect(terms.disabled_until).toBeDefined();
      expect(terms.reason).toBe("IDENTITY_FAILURE");
    });

    it("should downgrade tier on excessive PACT-4xx failures", () => {
      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      storage.upsertAgent("counterparty-1", "identity-hash-2", Date.now());
      
      // Insert 3+ PACT-4xx failures in last 7 days
      for (let i = 0; i < 3; i++) {
        storage.insertEvent({
          agent_id: "agent-1",
          event_type: "settlement_failure",
          ts: Date.now() - i * 24 * 60 * 60 * 1000, // Last 3 days
          transcript_hash: `hash-${i}`,
          counterparty_agent_id: "counterparty-1",
          value_usd: 100,
          failure_code: "PACT-401",
          stage: "settlement",
          fault_domain: "settlement",
          terminality: "non_terminal",
          dispute_outcome: null,
          metadata_json: null,
        });
      }

      const terms = computeCreditTerms("agent-1", storage, 90, 0.85, Date.now());
      // Should downgrade from A to B
      expect(terms.tier).toBe("B");
    });

    it("should not trigger kill switch on old violations", () => {
      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      storage.upsertAgent("counterparty-1", "identity-hash-2", Date.now());
      
      // Insert an old PACT-1xx failure (outside window)
      storage.insertEvent({
        agent_id: "agent-1",
        event_type: "settlement_failure",
        ts: Date.now() - 35 * 24 * 60 * 60 * 1000, // 35 days ago (outside 30-day window)
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

      const terms = computeCreditTerms("agent-1", storage, 90, 0.85, Date.now());
      expect(terms.tier).toBe("A");
      expect(terms.disabled_until).toBeUndefined();
    });
  });

  describe("canExtendCredit", () => {
    it("should deny credit for Tier C", () => {
      const decision = canExtendCredit(
        "agent-1",
        "counterparty-1",
        100,
        storage,
        65,
        0.8,
        Date.now()
      );
      expect(decision.allowed).toBe(false);
      expect(decision.required_collateral_usd).toBe(100);
      expect(decision.reason_codes).toContain("TIER_TOO_LOW");
    });

    it("should allow credit for Tier A within limits", () => {
      const decision = canExtendCredit(
        "agent-1",
        "counterparty-1",
        100,
        storage,
        90,
        0.85,
        Date.now()
      );
      expect(decision.allowed).toBe(true);
      expect(decision.required_collateral_usd).toBe(20); // 20% of 100
      expect(decision.reason_codes).toEqual([]);
    });

    it("should deny credit if outstanding exposure exceeds limit", () => {
      // Insert agent first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      
      // Set existing exposure
      storage.upsertCreditExposure("agent-1", 4500, "{}", Date.now());

      const decision = canExtendCredit(
        "agent-1",
        "counterparty-1",
        1000,
        storage,
        90,
        0.85,
        Date.now()
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason_codes).toContain("OUTSTANDING_EXPOSURE_EXCEEDED");
    });

    it("should deny credit if per-intent exposure exceeds limit", () => {
      const decision = canExtendCredit(
        "agent-1",
        "counterparty-1",
        3000, // Exceeds Tier A max_per_intent_usd of 2000
        storage,
        90,
        0.85,
        Date.now()
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason_codes).toContain("PER_INTENT_EXPOSURE_EXCEEDED");
    });

    it("should deny credit if per-counterparty exposure exceeds limit", () => {
      // Insert agent first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      
      // Set existing exposure with this counterparty
      storage.upsertCreditExposure(
        "agent-1",
        0,
        JSON.stringify({ "counterparty-1": 900 }),
        Date.now()
      );

      const decision = canExtendCredit(
        "agent-1",
        "counterparty-1",
        200, // Would exceed Tier A max_per_counterparty_usd of 1000
        storage,
        90,
        0.85,
        Date.now()
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason_codes).toContain("PER_COUNTERPARTY_EXPOSURE_EXCEEDED");
    });

    it("should deny credit if kill switch is triggered", () => {
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

      const decision = canExtendCredit(
        "agent-1",
        "counterparty-1",
        100,
        storage,
        90,
        0.85,
        Date.now()
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason_codes.length).toBeGreaterThan(0);
    });
  });

  describe("applyCreditEventFromTranscript", () => {
    it("should be idempotent (same transcript_hash → no double-counting)", () => {
      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      storage.upsertAgent("counterparty-1", "identity-hash-2", Date.now());
      
      const transcript: TranscriptV4 = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "transcript-1",
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: Date.now(),
        policy_hash: "policy-hash",
        strategy_hash: "strategy-hash",
        identity_snapshot_hash: "identity-hash",
        rounds: [
          {
            round_number: 0,
            round_type: "INTENT",
            message_hash: "msg-hash",
            envelope_hash: "env-hash",
            signature: {
              signer_public_key_b58: "key",
              signature_b58: "sig",
              signed_at_ms: Date.now(),
            },
            timestamp_ms: Date.now(),
            previous_round_hash: "prev-hash",
            agent_id: "agent-1",
            public_key_b58: "key",
          },
          {
            round_number: 1,
            round_type: "ACCEPT",
            message_hash: "msg-hash-2",
            envelope_hash: "env-hash-2",
            signature: {
              signer_public_key_b58: "key",
              signature_b58: "sig",
              signed_at_ms: Date.now(),
            },
            timestamp_ms: Date.now(),
            previous_round_hash: "prev-hash-2",
            agent_id: "agent-1",
            public_key_b58: "key",
            content_summary: {
              agreed_price: 100,
            },
          },
        ],
      };

      // Apply first time (commitment: $100, collateral: $20, credit: $80)
      applyCreditEventFromTranscript(
        transcript,
        "agent-1",
        "counterparty-1",
        100, // commitment amount
        20, // collateral amount
        storage
      );
      const events1 = storage.getCreditEventsByAgent("agent-1");
      expect(events1.length).toBe(1);
      expect(events1[0].delta_usd).toBe(80); // $80 credit extended

      // Apply second time (should be idempotent)
      applyCreditEventFromTranscript(
        transcript,
        "agent-1",
        "counterparty-1",
        100,
        20,
        storage
      );
      const events2 = storage.getCreditEventsByAgent("agent-1");
      expect(events2.length).toBe(1); // No new event
    });

    it("should process different transcripts independently", () => {
      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      storage.upsertAgent("counterparty-1", "identity-hash-2", Date.now());
      
      const transcript1: TranscriptV4 = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "transcript-1",
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: Date.now(),
        policy_hash: "policy-hash",
        strategy_hash: "strategy-hash",
        identity_snapshot_hash: "identity-hash",
        rounds: [
          {
            round_number: 1,
            round_type: "ACCEPT",
            message_hash: "msg-hash",
            envelope_hash: "env-hash",
            signature: {
              signer_public_key_b58: "key",
              signature_b58: "sig",
              signed_at_ms: Date.now(),
            },
            timestamp_ms: Date.now(),
            previous_round_hash: "prev-hash",
            agent_id: "agent-1",
            public_key_b58: "key",
            content_summary: {
              agreed_price: 100,
            },
          },
        ],
      };

      const transcript2: TranscriptV4 = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "transcript-2",
        intent_id: "intent-2",
        intent_type: "weather.data",
        created_at_ms: Date.now(),
        policy_hash: "policy-hash",
        strategy_hash: "strategy-hash",
        identity_snapshot_hash: "identity-hash",
        rounds: [
          {
            round_number: 1,
            round_type: "ACCEPT",
            message_hash: "msg-hash-2",
            envelope_hash: "env-hash-2",
            signature: {
              signer_public_key_b58: "key",
              signature_b58: "sig",
              signed_at_ms: Date.now(),
            },
            timestamp_ms: Date.now(),
            previous_round_hash: "prev-hash-2",
            agent_id: "agent-1",
            public_key_b58: "key",
            content_summary: {
              agreed_price: 200,
            },
          },
        ],
      };

      applyCreditEventFromTranscript(transcript1, "agent-1", "counterparty-1", 100, 20, storage);
      applyCreditEventFromTranscript(transcript2, "agent-1", "counterparty-1", 200, 40, storage);

      const events = storage.getCreditEventsByAgent("agent-1");
      expect(events.length).toBe(2);
      expect(events[0].delta_usd).toBe(80); // $80 credit from first transcript
      expect(events[1].delta_usd).toBe(160); // $160 credit from second transcript
    });

    it("should handle failure events (negative delta)", () => {
      // Insert agents first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      storage.upsertAgent("counterparty-1", "identity-hash-2", Date.now());
      
      const transcript: TranscriptV4 = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "transcript-1",
        intent_id: "intent-1",
        intent_type: "weather.data",
        created_at_ms: Date.now(),
        policy_hash: "policy-hash",
        strategy_hash: "strategy-hash",
        identity_snapshot_hash: "identity-hash",
        rounds: [
          {
            round_number: 1,
            round_type: "ACCEPT",
            message_hash: "msg-hash",
            envelope_hash: "env-hash",
            signature: {
              signer_public_key_b58: "key",
              signature_b58: "sig",
              signed_at_ms: Date.now(),
            },
            timestamp_ms: Date.now(),
            previous_round_hash: "prev-hash",
            agent_id: "agent-1",
            public_key_b58: "key",
            content_summary: {
              agreed_price: 100,
            },
          },
        ],
        failure_event: {
          code: "PACT-101",
          stage: "commitment",
          fault_domain: "policy",
          terminality: "terminal",
          evidence_refs: [],
          timestamp: Date.now(),
          transcript_hash: "transcript-hash-1",
        },
      };

      // Apply failure event (credit released - negative delta)
      applyCreditEventFromTranscript(transcript, "agent-1", "counterparty-1", 100, 20, storage);
      const events1 = storage.getCreditEventsByAgent("agent-1");
      expect(events1.length).toBe(1);
      expect(events1[0].delta_usd).toBe(-80); // Negative: credit released due to failure

      // Apply again (idempotent - same transcript_hash)
      applyCreditEventFromTranscript(transcript, "agent-1", "counterparty-1", 100, 20, storage);
      const events2 = storage.getCreditEventsByAgent("agent-1");
      expect(events2.length).toBe(1); // Still 1 (idempotent - same transcript_hash)

      // Check exposure is updated
      const exposure = storage.getCreditExposure("agent-1");
      expect(exposure?.outstanding_usd).toBe(0); // No outstanding exposure (failure released credit, idempotent call didn't change it)
    });
  });

  describe("Deterministic Requirements", () => {
    it("should produce same credit terms for same ledger state", () => {
      const score = 85;
      const confidence = 0.8;
      const asOf = Date.now();

      // Compute terms twice
      const terms1 = computeCreditTerms("agent-1", storage, score, confidence, asOf);
      const terms2 = computeCreditTerms("agent-1", storage, score, confidence, asOf);

      expect(terms1.tier).toBe(terms2.tier);
      expect(terms1.collateral_ratio).toBe(terms2.collateral_ratio);
      expect(terms1.max_outstanding_exposure_usd).toBe(terms2.max_outstanding_exposure_usd);
    });

    it("should produce same credit decision for same exposure state", () => {
      // Insert agent first (required for FOREIGN KEY constraint)
      storage.upsertAgent("agent-1", "identity-hash-1", Date.now());
      
      const score = 90;
      const confidence = 0.85;

      // Set same exposure state
      storage.upsertCreditExposure("agent-1", 1000, "{}", Date.now());

      const decision1 = canExtendCredit(
        "agent-1",
        "counterparty-1",
        500,
        storage,
        score,
        confidence,
        Date.now()
      );
      const decision2 = canExtendCredit(
        "agent-1",
        "counterparty-1",
        500,
        storage,
        score,
        confidence,
        Date.now()
      );

      expect(decision1.allowed).toBe(decision2.allowed);
      expect(decision1.required_collateral_usd).toBe(decision2.required_collateral_usd);
    });
  });
});
