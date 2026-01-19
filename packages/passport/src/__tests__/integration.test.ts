/**
 * Passport v4 Integration Tests
 * 
 * Tests Passport integration with Pact v4 artifacts:
 * - Determinism and stable output
 * - Reason code stability
 * - Replayer integration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { PassportStorage } from "../storage";
import { ingestTranscriptOutcome } from "../ingestion";
import { queryPassport, requirePassport, clearCache } from "../query";
import { getPassportReplayContext, narratePassportDenial } from "../replayer";
import type { TranscriptV4 } from "../types";

// Helper to load fixture
function loadFixture(filename: string): TranscriptV4 {
  const fixturePath = path.join(__dirname, "../../../..", "fixtures", filename);
  const content = fs.readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as TranscriptV4;
}

describe("Passport v4 Integration", () => {
  let storage: PassportStorage;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(__dirname, "../../../..", ".tmp", `passport-integration-test-${Date.now()}.db`);
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    storage = new PassportStorage(dbPath);
    clearCache();
  });

  afterEach(() => {
    if (storage) {
      storage.close();
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    clearCache();
  });

  describe("Determinism and Stable Output", () => {
    it("should produce identical scores for same inputs (deterministic)", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Ingest same transcripts in same order
      for (let i = 0; i < 5; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-det-${i}`;
        success.intent_id = `intent-det-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      // Compute score multiple times - should be identical
      const score1 = computePassportScore("buyer", storage, now);
      const score2 = computePassportScore("buyer", storage, now);
      const score3 = computePassportScore("buyer", storage, now);

      expect(score1.score).toBe(score2.score);
      expect(score2.score).toBe(score3.score);
      expect(score1.confidence).toBe(score2.confidence);
      expect(score2.confidence).toBe(score3.confidence);
    });

    it("should produce stable reason codes across versions", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with low score (single failure)
      const success = loadFixture("success/SUCCESS-001-simple.json");
      success.created_at_ms = baseTime;
      success.rounds.forEach((r) => {
        r.timestamp_ms = baseTime;
      });
      success.transcript_id = "transcript-reason-1";
      success.intent_id = "intent-reason-1";
      ingestTranscriptOutcome(storage, success);

      // Add a policy violation failure
      const failure = loadFixture("failures/PACT-101-policy-violation.json");
      failure.created_at_ms = baseTime + 1000;
      failure.rounds.forEach((r) => {
        r.timestamp_ms = baseTime + 1000;
      });
      if (failure.failure_event) {
        failure.failure_event.timestamp = baseTime + 1000;
      }
      failure.transcript_id = "transcript-reason-2";
      failure.intent_id = "intent-reason-2";
      ingestTranscriptOutcome(storage, failure);

      // Check policy gate - should return SCORE_TOO_LOW, LOW_SCORE (backward compat), or RECENT_POLICY_VIOLATION
      const result = requirePassport(storage, "buyer", 60, undefined, now);

      expect(result.pass).toBe(false);
      expect(result.reason).toMatch(/SCORE_TOO_LOW|LOW_SCORE|RECENT_POLICY_VIOLATION|INSUFFICIENT_HISTORY/);
      expect(result.triggering_factor).toBeDefined();
    });

    it("should produce identical policy results for same state", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with good score
      for (let i = 0; i < 10; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-stable-${i}`;
        success.intent_id = `intent-stable-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      // Query policy check multiple times - should be identical
      const result1 = requirePassport(storage, "buyer", 60, 0.5, now);
      const result2 = requirePassport(storage, "buyer", 60, 0.5, now);
      const result3 = requirePassport(storage, "buyer", 60, 0.5, now);

      expect(result1.pass).toBe(result2.pass);
      expect(result2.pass).toBe(result3.pass);
      expect(result1.reason).toBe(result2.reason);
      expect(result2.reason).toBe(result3.reason);
    });
  });

  describe("Reason Code Stability", () => {
    it("should return LOW_SCORE for score below threshold", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with low score (insufficient successes)
      const failure = loadFixture("failures/PACT-101-policy-violation.json");
      failure.created_at_ms = baseTime;
      failure.rounds.forEach((r) => {
        r.timestamp_ms = baseTime;
      });
      if (failure.failure_event) {
        failure.failure_event.timestamp = baseTime;
      }
      failure.transcript_id = "transcript-low-score-1";
      failure.intent_id = "intent-low-score-1";
      ingestTranscriptOutcome(storage, failure);

      // Need at least 3 events for score computation
      // Add 2 more failures to get to 3
      for (let i = 2; i <= 3; i++) {
        const f2 = loadFixture("failures/PACT-101-policy-violation.json");
        f2.created_at_ms = baseTime + i * 1000;
        f2.rounds.forEach((r) => {
          r.timestamp_ms = baseTime + i * 1000;
        });
        if (f2.failure_event) {
          f2.failure_event.timestamp = baseTime + i * 1000;
        }
        f2.transcript_id = `transcript-low-score-${i}`;
        f2.intent_id = `intent-low-score-${i}`;
        ingestTranscriptOutcome(storage, f2);
      }

      const result = requirePassport(storage, "buyer", 50, undefined, now);

      expect(result.pass).toBe(false);
      // Should be SCORE_TOO_LOW, LOW_SCORE (backward compat), or RECENT_POLICY_VIOLATION
      expect(result.reason).toMatch(/SCORE_TOO_LOW|LOW_SCORE|RECENT_POLICY_VIOLATION/);
    });

    it("should return LOW_CONFIDENCE for confidence below threshold", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with low confidence (few transactions)
      for (let i = 0; i < 3; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-low-conf-${i}`;
        success.intent_id = `intent-low-conf-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      const result = requirePassport(storage, "buyer", 50, 0.8, now);

      expect(result.pass).toBe(false);
      expect(result.reason).toBe("LOW_CONFIDENCE");
    });

    it("should return INSUFFICIENT_HISTORY for bootstrap condition", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with only 2 transactions (below bootstrap threshold of 3)
      for (let i = 0; i < 2; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-insufficient-${i}`;
        success.intent_id = `intent-insufficient-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      const result = requirePassport(storage, "buyer", 50, undefined, now);

      expect(result.pass).toBe(false);
      expect(result.reason).toBe("INSUFFICIENT_HISTORY");
      expect(result.confidence).toBe(0.0);
    });
  });

  describe("Replayer Integration", () => {
    it("should provide Passport context for transcript replay", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with good score
      for (let i = 0; i < 5; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-replay-${i}`;
        success.intent_id = `intent-replay-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      // Create a transcript to replay
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      transcript.created_at_ms = baseTime + 5000;
      transcript.rounds.forEach((r) => {
        r.timestamp_ms = baseTime + 5000;
      });
      transcript.transcript_id = "transcript-replay-context";

      // Get Passport context at negotiation time
      const context = getPassportReplayContext(storage, transcript, 60, 0.5);

      expect(context.available).toBe(true);
      expect(context.score_at_negotiation).toBeDefined();
      expect(context.confidence_at_negotiation).toBeDefined();
      expect(context.computed_as_of).toBe(transcript.created_at_ms);
    });

    it("should generate human-readable denial narratives", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with low score
      const failure = loadFixture("failures/PACT-101-policy-violation.json");
      failure.created_at_ms = baseTime;
      failure.rounds.forEach((r) => {
        r.timestamp_ms = baseTime;
      });
      if (failure.failure_event) {
        failure.failure_event.timestamp = baseTime;
      }
      failure.transcript_id = "transcript-narrative-1";
      failure.intent_id = "intent-narrative-1";
      ingestTranscriptOutcome(storage, failure);

      // Add 2 more to get to 3 events
      for (let i = 2; i <= 3; i++) {
        const f2 = loadFixture("failures/PACT-101-policy-violation.json");
        f2.created_at_ms = baseTime + i * 1000;
        f2.rounds.forEach((r) => {
          r.timestamp_ms = baseTime + i * 1000;
        });
        if (f2.failure_event) {
          f2.failure_event.timestamp = baseTime + i * 1000;
        }
        f2.transcript_id = `transcript-narrative-${i}`;
        f2.intent_id = `intent-narrative-${i}`;
        ingestTranscriptOutcome(storage, f2);
      }

      const policyResult = requirePassport(storage, "buyer", 60, undefined, now);
      const narrative = narratePassportDenial(policyResult);

      expect(narrative).toContain("Passport policy gate denied");
      // Narrative should contain reason code (SCORE_TOO_LOW or RECENT_POLICY_VIOLATION) or the narrative text itself
      expect(narrative).toMatch(/SCORE_TOO_LOW|LOW_SCORE|RECENT_POLICY_VIOLATION|below required minimum/);
      if (policyResult.triggering_factor) {
        expect(narrative).toContain(policyResult.triggering_factor);
      }
    });

    it("should handle unavailable Passport context gracefully", () => {
      // Create transcript for agent with no Passport history
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      transcript.created_at_ms = Date.now();
      transcript.rounds.forEach((r) => {
        r.timestamp_ms = Date.now();
      });
      transcript.transcript_id = "transcript-new-agent";

      // Get context for agent with no history
      const context = getPassportReplayContext(storage, transcript, 60, 0.5);

      // Context should indicate Passport was not available
      // (agent not yet scored at negotiation time)
      expect(context.available).toBe(false);
      expect(context.score_at_negotiation).toBeNull();
      expect(context.confidence_at_negotiation).toBeNull();
    });
  });

  describe("Timestamp Reproducibility", () => {
    it("should reproduce scores at specific timestamps", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Ingest transcripts at different times
      for (let i = 0; i < 10; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 10000; // 10 seconds apart
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-repro-${i}`;
        success.intent_id = `intent-repro-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      // Query at specific timestamp (after 5 transactions)
      const asOf = baseTime + 50000; // After 5th transaction
      const score1 = queryPassport(storage, "buyer", asOf);
      const score2 = queryPassport(storage, "buyer", asOf);
      const score3 = queryPassport(storage, "buyer", asOf);

      // All queries at same timestamp should produce identical results
      expect(score1.score).toBe(score2.score);
      expect(score2.score).toBe(score3.score);
      expect(score1.updated_at).toBe(asOf);
      expect(score2.updated_at).toBe(asOf);
      expect(score3.updated_at).toBe(asOf);
    });
  });
});

// Import computePassportScore for test
import { computePassportScore } from "../scoring";
