/**
 * H1: Transcript Verification CLI Tests
 * 
 * Tests for verifyTranscriptFile() function.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { verifyTranscriptFile } from "../replay";
import type { TranscriptV1 } from "../types";

describe("verifyTranscriptFile", () => {
  let tempDir: string;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-verify-test-"));
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  function writeTranscriptFile(filename: string, transcript: TranscriptV1): string {
    const filepath = path.join(tempDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(transcript, null, 2), "utf-8");
    return filepath;
  }
  
  it("verifies valid transcript with version", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: true },
    };
    
    const filepath = writeTranscriptFile("valid.json", transcript);
    const result = await verifyTranscriptFile(filepath);
    
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
  
  it("warns when transcript_version is missing", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      // transcript_version missing
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: true },
    };
    
    const filepath = writeTranscriptFile("no-version.json", transcript);
    const result = await verifyTranscriptFile(filepath);
    
    expect(result.ok).toBe(true); // Should still pass (warning, not error)
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes("transcript_version"))).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
  
  it("detects invalid settlement_attempts outcome mismatch", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: false, code: "FAILED" },
      settlement_attempts: [
        {
          idx: 0,
          provider_pubkey: "provider1",
          outcome: "failed",
          failure_code: "SETTLEMENT_FAILED",
        },
        {
          idx: 1,
          provider_pubkey: "provider2",
          outcome: "success", // Last attempt is success but overall is failed
        },
      ],
    };
    
    const filepath = writeTranscriptFile("invalid-attempts.json", transcript);
    const result = await verifyTranscriptFile(filepath);
    
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes("settlement_attempts"))).toBe(true);
  });
  
  it("detects streaming_attempts total_paid_amount exceeds agreed_price", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: true },
      receipt: {
        receipt_id: "receipt-123",
        intent_id: "test-intent",
        buyer_agent_id: "buyer",
        seller_agent_id: "seller",
        agreed_price: 0.1,
        fulfilled: true,
        timestamp_ms: Date.now(),
      },
      streaming_summary: {
        total_ticks: 10,
        total_paid_amount: 0.2, // Exceeds agreed_price of 0.1
        attempts_used: 1,
      },
      streaming_attempts: [
        {
          idx: 0,
          provider_pubkey: "provider1",
          ticks_paid: 10,
          paid_amount: 0.2,
          outcome: "success",
        },
      ],
    };
    
    const filepath = writeTranscriptFile("invalid-streaming.json", transcript);
    const result = await verifyTranscriptFile(filepath);
    
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes("total_paid_amount") && e.includes("exceeds"))).toBe(true);
  });
  
  it("detects dispute_events refund_amount exceeds paid_amount", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: true },
      receipt: {
        receipt_id: "receipt-123",
        intent_id: "test-intent",
        buyer_agent_id: "buyer",
        seller_agent_id: "seller",
        agreed_price: 0.1,
        paid_amount: 0.1,
        fulfilled: true,
        timestamp_ms: Date.now(),
      },
      dispute_events: [
        {
          ts_ms: Date.now(),
          dispute_id: "dispute-123",
          outcome: "REFUND_FULL",
          refund_amount: 0.2, // Exceeds paid_amount of 0.1
          status: "resolved",
        },
      ],
    };
    
    const filepath = writeTranscriptFile("invalid-dispute.json", transcript);
    const result = await verifyTranscriptFile(filepath);
    
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes("refund_amount") && e.includes("exceeds"))).toBe(true);
  });
  
  it("detects reconcile_events missing handle_id", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: true },
      settlement_lifecycle: {
        handle_id: "handle-123",
        status: "committed",
      },
      reconcile_events: [
        {
          ts_ms: Date.now(),
          handle_id: "", // Missing handle_id
          from_status: "pending",
          to_status: "committed",
        },
      ],
    };
    
    const filepath = writeTranscriptFile("invalid-reconcile.json", transcript);
    const result = await verifyTranscriptFile(filepath);
    
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes("reconcile_events") && e.includes("handle_id"))).toBe(true);
  });
  
  it("returns error for non-existent file", async () => {
    const filepath = path.join(tempDir, "nonexistent.json");
    const result = await verifyTranscriptFile(filepath);
    
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes("Failed to load"))).toBe(true);
  });
  
  it("warns for pending settlement without resolution (default mode)", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: false, code: "SETTLEMENT_POLL_TIMEOUT" },
      settlement_lifecycle: {
        handle_id: "handle-123",
        status: "pending",
        failure_code: "SETTLEMENT_POLL_TIMEOUT",
        failure_reason: "Settlement still pending after 100 poll attempts",
        // No terminal resolution events
      },
    };
    
    const filepath = writeTranscriptFile("pending-no-resolution.json", transcript);
    const result = await verifyTranscriptFile(filepath, false); // Default mode
    
    expect(result.ok).toBe(true); // Should pass (warning, not error)
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes("SETTLEMENT_PENDING_UNRESOLVED"))).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
  
  it("errors for pending settlement without resolution (strict mode)", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: false, code: "SETTLEMENT_POLL_TIMEOUT" },
      settlement_lifecycle: {
        handle_id: "handle-123",
        status: "pending",
        failure_code: "SETTLEMENT_POLL_TIMEOUT",
        failure_reason: "Settlement still pending after 100 poll attempts",
        // No terminal resolution events
      },
    };
    
    const filepath = writeTranscriptFile("pending-no-resolution-strict.json", transcript);
    const result = await verifyTranscriptFile(filepath, true); // Strict mode
    
    expect(result.ok).toBe(false); // Should fail (error, not warning)
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes("SETTLEMENT_PENDING_UNRESOLVED"))).toBe(true);
  });
  
  it("allows reconcile transition pending -> aborted", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: false, code: "SETTLEMENT_POLL_TIMEOUT" },
      settlement_lifecycle: {
        handle_id: "handle-123",
        status: "aborted", // Final status is aborted
      },
      reconcile_events: [
        {
          ts_ms: Date.now(),
          handle_id: "handle-123",
          from_status: "pending",
          to_status: "aborted", // Valid transition: pending -> aborted
          note: "Settlement aborted after timeout",
        },
      ],
    };
    
    const filepath = writeTranscriptFile("reconcile-pending-to-aborted.json", transcript);
    const result = await verifyTranscriptFile(filepath);
    
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    // Should not have errors about invalid transition
    expect(result.errors.some(e => e.includes("invalid transition"))).toBe(false);
  });
  
  it("skips pending transcript in strict + terminal-only mode", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: false, code: "SETTLEMENT_POLL_TIMEOUT" },
      settlement_lifecycle: {
        handle_id: "handle-123",
        status: "pending", // Pending status
        failure_code: "SETTLEMENT_POLL_TIMEOUT",
        failure_reason: "Settlement still pending after 100 poll attempts",
        // No terminal resolution events
      },
    };
    
    const filepath = writeTranscriptFile("pending-skip.json", transcript);
    const result = await verifyTranscriptFile(filepath, true, true); // strict + terminal-only
    
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true); // Skipped files are considered ok
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
  
  it("verifies terminal transcript in strict + terminal-only mode", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      transcript_version: "1.0",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: true },
      settlement_lifecycle: {
        handle_id: "handle-123",
        status: "committed", // Terminal status
        paid_amount: 0.1,
        committed_at_ms: Date.now(),
      },
    };
    
    const filepath = writeTranscriptFile("terminal-committed.json", transcript);
    const result = await verifyTranscriptFile(filepath, true, true); // strict + terminal-only
    
    expect(result.skipped).toBeUndefined(); // Not skipped
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});


