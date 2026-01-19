/**
 * Passport Query Tests
 * 
 * Tests query interface, caching, reproducibility, and policy helper.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { PassportStorage } from "../storage";
import { ingestTranscriptOutcome } from "../ingestion";
import { queryPassport, requirePassport, clearCache } from "../query";
import type { TranscriptV4 } from "../types";

// Helper to load fixture
function loadFixture(filename: string): TranscriptV4 {
  const fixturePath = path.join(__dirname, "../../../..", "fixtures", filename);
  const content = fs.readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as TranscriptV4;
}

describe("Passport Query", () => {
  let storage: PassportStorage;
  let dbPath: string;

  beforeEach(() => {
    // Create temporary database file
    dbPath = path.join(__dirname, "../../../..", ".tmp", `passport-query-test-${Date.now()}.db`);
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    storage = new PassportStorage(dbPath);
    clearCache(); // Clear cache before each test
  });

  afterEach(() => {
    // Clean up database
    if (storage) {
      storage.close();
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    clearCache();
  });

  describe("Query Stability", () => {
    it("should return stable response for same ledger state", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Ingest some transcripts
      for (let i = 0; i < 5; i++) {
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

      // Query multiple times - should return same result
      const query1 = queryPassport(storage, "buyer");
      const query2 = queryPassport(storage, "buyer");
      const query3 = queryPassport(storage, "buyer");

      // All queries should return identical scores
      expect(query1.score).toBe(query2.score);
      expect(query2.score).toBe(query3.score);
      expect(query1.confidence).toBe(query2.confidence);
      expect(query2.confidence).toBe(query3.confidence);
      expect(query1.updated_at).toBe(query2.updated_at);
      expect(query2.updated_at).toBe(query3.updated_at);
    });

    it("should return stable response for as_of timestamp queries", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Ingest transcripts at different times
      for (let i = 0; i < 5; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-asof-${i}`;
        success.intent_id = `intent-asof-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      // Query with as_of timestamp
      const asOf = baseTime + 3000; // After 3 transactions
      const query1 = queryPassport(storage, "buyer", asOf);
      const query2 = queryPassport(storage, "buyer", asOf);
      const query3 = queryPassport(storage, "buyer", asOf);

      // All queries with same as_of should return identical results
      expect(query1.score).toBe(query2.score);
      expect(query2.score).toBe(query3.score);
      expect(query1.confidence).toBe(query2.confidence);
      expect(query1.updated_at).toBe(asOf); // Should be as_of timestamp
    });

    it("should cache queries within time window", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Ingest some transcripts
      for (let i = 0; i < 3; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-cache-${i}`;
        success.intent_id = `intent-cache-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      // First query should compute
      const query1 = queryPassport(storage, "buyer");
      const updatedAt1 = query1.updated_at;

      // Second query within cache window should return cached result (same updated_at)
      // Note: Cache TTL is 1 minute, so this should hit cache in same test
      const query2 = queryPassport(storage, "buyer");
      expect(query2.updated_at).toBe(updatedAt1);
      expect(query2.score).toBe(query1.score);
    });
  });

  describe("Policy Helper", () => {
    it("should pass when score and confidence meet thresholds", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with good score (multiple successes)
      for (let i = 0; i < 10; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        // Adjust timestamps - set all to recent time
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime; // Set all rounds to same time (event time)
        });
        success.transcript_id = `transcript-policy-pass-${i}`;
        success.intent_id = `intent-policy-pass-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      const result = requirePassport(storage, "buyer", 50, 0.3);

      expect(result.pass).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.reason).toBeUndefined();
    });

    it("should fail when score is too low", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with low score (failures)
      for (let i = 0; i < 3; i++) {
        const failure = loadFixture("failures/PACT-101-policy-violation.json");
        const eventTime = baseTime + i * 1000;
        failure.created_at_ms = eventTime;
        failure.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        if (failure.failure_event) {
          failure.failure_event.timestamp = eventTime;
        }
        failure.transcript_id = `transcript-policy-fail-score-${i}`;
        failure.intent_id = `intent-policy-fail-score-${i}`;
        ingestTranscriptOutcome(storage, failure);
      }

      const result = requirePassport(storage, "buyer", 70, 0.3);

      expect(result.pass).toBe(false);
      expect(result.reason).toBe("SCORE_TOO_LOW");
      expect(result.score).toBeLessThan(70);
      expect(result.min_score_required).toBe(70);
    });

    it("should fail when confidence is too low even if score is high", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with high score but low confidence (few events, same counterparty)
      // Use wash trading scenario (same counterparty repeatedly)
      for (let i = 0; i < 3; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-policy-low-conf-${i}`;
        success.intent_id = `intent-policy-low-conf-${i}`;
        // All with same counterparty (wash trading)
        ingestTranscriptOutcome(storage, success);
      }

      const result = requirePassport(storage, "buyer", 50, 0.8); // Require high confidence

      expect(result.pass).toBe(false);
      expect(result.reason).toBe("LOW_CONFIDENCE");
      expect(result.score).toBeGreaterThanOrEqual(50); // Score meets threshold
      expect(result.confidence).toBeLessThan(0.8); // But confidence is too low
      expect(result.min_confidence_required).toBe(0.8);
    });

    it("should pass when min_confidence not specified even if confidence is low", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Create agent with low confidence (few events)
      for (let i = 0; i < 3; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-policy-no-conf-${i}`;
        success.intent_id = `intent-policy-no-conf-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      // Require score but not confidence
      const result = requirePassport(storage, "buyer", 50);

      expect(result.pass).toBe(true); // Should pass even with low confidence
      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(result.min_confidence_required).toBeUndefined();
    });

    it("should return appropriate reason codes", () => {
      // Test invalid inputs
      const invalidScore = requirePassport(storage, "buyer", -1);
      expect(invalidScore.pass).toBe(false);
      expect(invalidScore.reason).toBe("INVALID_MIN_SCORE");

      const invalidConfidence = requirePassport(storage, "buyer", 50, 2.0);
      expect(invalidConfidence.pass).toBe(false);
      expect(invalidConfidence.reason).toBe("INVALID_MIN_CONFIDENCE");
    });

    it("should work with as_of timestamp for policy checks", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Ingest transcripts at different times
      for (let i = 0; i < 5; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-policy-asof-${i}`;
        success.intent_id = `intent-policy-asof-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      // Policy check at earlier time
      const asOf = baseTime + 2000; // After 2 transactions
      const result = requirePassport(storage, "buyer", 50, undefined, asOf);

      expect(result.pass).toBe(true); // Should pass based on state at asOf
      expect(result.score).toBeDefined();
    });
  });

  describe("Query Response Format", () => {
    it("should return correct response format", () => {
      const now = Date.now();
      const baseTime = now - 1000000;

      // Ingest some transcripts
      for (let i = 0; i < 5; i++) {
        const success = loadFixture("success/SUCCESS-001-simple.json");
        const eventTime = baseTime + i * 1000;
        success.created_at_ms = eventTime;
        success.rounds.forEach((r) => {
          r.timestamp_ms = eventTime;
        });
        success.transcript_id = `transcript-format-${i}`;
        success.intent_id = `intent-format-${i}`;
        ingestTranscriptOutcome(storage, success);
      }

      const result = queryPassport(storage, "buyer");

      // Verify response structure
      expect(result).toHaveProperty("agent_id");
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("breakdown");
      expect(result).toHaveProperty("updated_at");

      expect(result.agent_id).toBe("buyer");
      expect(typeof result.score).toBe("number");
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(typeof result.confidence).toBe("number");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.updated_at).toBe("number");
      expect(result.updated_at).toBeGreaterThan(0);

      // Verify breakdown structure
      expect(result.breakdown).toHaveProperty("success_score");
      expect(result.breakdown).toHaveProperty("failure_score");
      expect(result.breakdown).toHaveProperty("dispute_score");
      expect(result.breakdown).toHaveProperty("final_score");
      expect(result.breakdown).toHaveProperty("confidence");
      expect(result.breakdown).toHaveProperty("factors");
      expect(result.breakdown.factors).toHaveProperty("positive");
      expect(result.breakdown.factors).toHaveProperty("negative");
      expect(Array.isArray(result.breakdown.factors.positive)).toBe(true);
      expect(Array.isArray(result.breakdown.factors.negative)).toBe(true);
    });
  });
});
