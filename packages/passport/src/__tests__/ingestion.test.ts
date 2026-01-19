/**
 * Passport Ingestion Tests
 * 
 * Tests ingestion of Pact v4 transcripts with fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { PassportStorage } from "../storage";
import { ingestTranscriptOutcome } from "../ingestion";
import type { TranscriptV4 } from "../types";

// Helper to load fixture
function loadFixture(filename: string): TranscriptV4 {
  const fixturePath = path.join(__dirname, "../../../..", "fixtures", filename);
  const content = fs.readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as TranscriptV4;
}

describe("Passport Ingestion", () => {
  let storage: PassportStorage;
  let dbPath: string;

  beforeEach(() => {
    // Create temporary database file
    dbPath = path.join(__dirname, "../../../..", ".tmp", `passport-test-${Date.now()}.db`);
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    storage = new PassportStorage(dbPath);
  });

  afterEach(() => {
    // Clean up database
    if (storage) {
      storage.close();
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe("Success Transcripts", () => {
    it("should ingest SUCCESS-001-simple.json and record 2 settlement_success events", () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const result = ingestTranscriptOutcome(storage, transcript);

      expect(result.ingested).toBe(true);
      expect(result.event_type).toBe("settlement_success");

      // Check event counts
      const counts = storage.getEventCounts();
      const successCount = counts.find((c) => c.event_type === "settlement_success")?.count || 0;
      expect(successCount).toBe(2); // buyer + seller

      // Check buyer events
      const buyerEvents = storage.getEventsByAgent("buyer");
      expect(buyerEvents.length).toBe(1);
      expect(buyerEvents[0].event_type).toBe("settlement_success");
      expect(buyerEvents[0].counterparty_agent_id).toBe("seller");
      expect(buyerEvents[0].value_usd).toBe(0.00005);
      expect(buyerEvents[0].failure_code).toBeNull();
      expect(buyerEvents[0].stage).toBeNull();
      expect(buyerEvents[0].fault_domain).toBeNull();
      expect(buyerEvents[0].terminality).toBeNull();

      // Check seller events
      const sellerEvents = storage.getEventsByAgent("seller");
      expect(sellerEvents.length).toBe(1);
      expect(sellerEvents[0].event_type).toBe("settlement_success");
      expect(sellerEvents[0].counterparty_agent_id).toBe("buyer");
      expect(sellerEvents[0].value_usd).toBe(0.00005);
    });

    it("should ingest SUCCESS-002-negotiated.json and record 2 settlement_success events", () => {
      const transcript = loadFixture("success/SUCCESS-002-negotiated.json");
      const result = ingestTranscriptOutcome(storage, transcript);

      expect(result.ingested).toBe(true);
      expect(result.event_type).toBe("settlement_success");

      // Check event counts
      const counts = storage.getEventCounts();
      const successCount = counts.find((c) => c.event_type === "settlement_success")?.count || 0;
      expect(successCount).toBe(2); // buyer + seller

      // Check buyer events
      const buyerEvents = storage.getEventsByAgent("buyer");
      expect(buyerEvents.length).toBe(1);
      expect(buyerEvents[0].value_usd).toBe(0.00009);

      // Check seller events
      const sellerEvents = storage.getEventsByAgent("seller");
      expect(sellerEvents.length).toBe(1);
      expect(sellerEvents[0].value_usd).toBe(0.00009);
    });
  });

  describe("Failure Transcripts", () => {
    it("should ingest PACT-101-policy-violation.json and record 2 settlement_failure events", () => {
      const transcript = loadFixture("failures/PACT-101-policy-violation.json");
      const result = ingestTranscriptOutcome(storage, transcript);

      expect(result.ingested).toBe(true);
      expect(result.event_type).toBe("settlement_failure");

      // Check event counts
      const counts = storage.getEventCounts();
      const failureCount = counts.find((c) => c.event_type === "settlement_failure")?.count || 0;
      expect(failureCount).toBe(2); // buyer + seller

      // Check buyer events
      const buyerEvents = storage.getEventsByAgent("buyer");
      expect(buyerEvents.length).toBe(1);
      expect(buyerEvents[0].event_type).toBe("settlement_failure");
      expect(buyerEvents[0].failure_code).toBe("PACT-101");
      expect(buyerEvents[0].stage).toBe("negotiation");
      expect(buyerEvents[0].fault_domain).toBe("policy");
      expect(buyerEvents[0].terminality).toBe("terminal");
      expect(buyerEvents[0].value_usd).toBeNull();

      // Check seller events
      const sellerEvents = storage.getEventsByAgent("seller");
      expect(sellerEvents.length).toBe(1);
      expect(sellerEvents[0].failure_code).toBe("PACT-101");
      expect(sellerEvents[0].stage).toBe("negotiation");
      expect(sellerEvents[0].fault_domain).toBe("policy");
      expect(sellerEvents[0].terminality).toBe("terminal");
    });

    it("should ingest PACT-202-kya-expiry.json and record 2 settlement_failure events", () => {
      const transcript = loadFixture("failures/PACT-202-kya-expiry.json");
      const result = ingestTranscriptOutcome(storage, transcript);

      expect(result.ingested).toBe(true);
      expect(result.event_type).toBe("settlement_failure");

      // Check event counts
      const counts = storage.getEventCounts();
      const failureCount = counts.find((c) => c.event_type === "settlement_failure")?.count || 0;
      expect(failureCount).toBe(2);

      // Check buyer events
      const buyerEvents = storage.getEventsByAgent("buyer");
      expect(buyerEvents[0].failure_code).toBe("PACT-202");
      expect(buyerEvents[0].stage).toBe("admission");
      expect(buyerEvents[0].fault_domain).toBe("identity");
    });

    it("should ingest PACT-303-strategic-deadlock.json and record 2 settlement_failure events", () => {
      const transcript = loadFixture("failures/PACT-303-strategic-deadlock.json");
      const result = ingestTranscriptOutcome(storage, transcript);

      expect(result.ingested).toBe(true);
      expect(result.event_type).toBe("settlement_failure");

      const buyerEvents = storage.getEventsByAgent("buyer");
      expect(buyerEvents[0].failure_code).toBe("PACT-303");
      expect(buyerEvents[0].stage).toBe("negotiation");
      expect(buyerEvents[0].fault_domain).toBe("negotiation");
    });

    it("should ingest PACT-404-settlement-timeout.json but NOT record events (non_terminal)", () => {
      const transcript = loadFixture("failures/PACT-404-settlement-timeout.json");
      const result = ingestTranscriptOutcome(storage, transcript);

      // PACT-404 has terminality: "non_terminal", so it should not be ingested
      expect(result.ingested).toBe(false);
      expect(result.reason).toContain("Non-terminal failure");

      // Check no events were recorded
      const counts = storage.getEventCounts();
      expect(counts.length).toBe(0);
    });

    it("should ingest PACT-505-recursive-failure.json and record 1 settlement_failure event (buyer only)", () => {
      const transcript = loadFixture("failures/PACT-505-recursive-failure.json");
      const result = ingestTranscriptOutcome(storage, transcript);

      expect(result.ingested).toBe(true);
      expect(result.event_type).toBe("settlement_failure");

      // Check event counts (only buyer has a round, seller is missing)
      const counts = storage.getEventCounts();
      const failureCount = counts.find((c) => c.event_type === "settlement_failure")?.count || 0;
      expect(failureCount).toBe(1); // Only buyer

      const buyerEvents = storage.getEventsByAgent("buyer");
      expect(buyerEvents[0].failure_code).toBe("PACT-505");
      expect(buyerEvents[0].stage).toBe("discovery");
      expect(buyerEvents[0].fault_domain).toBe("recursive");
    });
  });

  describe("Idempotency", () => {
    it("should be idempotent when ingesting the same transcript twice", () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");

      // First ingestion
      const result1 = ingestTranscriptOutcome(storage, transcript);
      expect(result1.ingested).toBe(true);

      // Second ingestion (should be idempotent)
      const result2 = ingestTranscriptOutcome(storage, transcript);
      expect(result2.ingested).toBe(false);
      expect(result2.reason).toContain("already ingested");

      // Check event counts (should still be 2, not 4)
      const counts = storage.getEventCounts();
      const successCount = counts.find((c) => c.event_type === "settlement_success")?.count || 0;
      expect(successCount).toBe(2);
    });
  });

  describe("Agent Records", () => {
    it("should create agent records when ingesting transcripts", () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      ingestTranscriptOutcome(storage, transcript);

      // Agents should be created (we can't query directly, but events should reference them)
      const buyerEvents = storage.getEventsByAgent("buyer");
      expect(buyerEvents.length).toBeGreaterThan(0);

      const sellerEvents = storage.getEventsByAgent("seller");
      expect(sellerEvents.length).toBeGreaterThan(0);
    });
  });

  describe("Multiple Transcripts", () => {
    it("should ingest multiple transcripts and accumulate events", () => {
      // Ingest multiple success transcripts
      const success1 = loadFixture("success/SUCCESS-001-simple.json");
      const success2 = loadFixture("success/SUCCESS-002-negotiated.json");

      ingestTranscriptOutcome(storage, success1);
      ingestTranscriptOutcome(storage, success2);

      // Should have 4 success events (2 per transcript)
      const counts = storage.getEventCounts();
      const successCount = counts.find((c) => c.event_type === "settlement_success")?.count || 0;
      expect(successCount).toBe(4);

      // Buyer should have 2 events
      const buyerEvents = storage.getEventsByAgent("buyer");
      expect(buyerEvents.length).toBe(2);
      expect(buyerEvents.every((e) => e.event_type === "settlement_success")).toBe(true);
    });

    it("should ingest mix of success and failure transcripts", () => {
      const success = loadFixture("success/SUCCESS-001-simple.json");
      const failure = loadFixture("failures/PACT-101-policy-violation.json");

      ingestTranscriptOutcome(storage, success);
      ingestTranscriptOutcome(storage, failure);

      // Check event counts
      const counts = storage.getEventCounts();
      const successCount = counts.find((c) => c.event_type === "settlement_success")?.count || 0;
      const failureCount = counts.find((c) => c.event_type === "settlement_failure")?.count || 0;

      expect(successCount).toBe(2);
      expect(failureCount).toBe(2);

      // Buyer should have 1 success and 1 failure
      const buyerEvents = storage.getEventsByAgent("buyer");
      expect(buyerEvents.length).toBe(2);
      const buyerSuccess = buyerEvents.filter((e) => e.event_type === "settlement_success");
      const buyerFailure = buyerEvents.filter((e) => e.event_type === "settlement_failure");
      expect(buyerSuccess.length).toBe(1);
      expect(buyerFailure.length).toBe(1);
    });
  });
});
