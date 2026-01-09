/**
 * Settlement Lifecycle Transcript Tests
 * 
 * Tests for settlement lifecycle metadata in transcripts (v1.6.3+).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { acquire } from "../../client/acquire";
import { MockSettlementProvider } from "../../settlement/mock";
import { createDefaultPolicy } from "../../policy/defaultPolicy";
import { InMemoryProviderDirectory } from "../../directory/registry";
import { generateKeypair } from "../../protocol/envelope";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";
import { replayTranscript } from "../replay";
import type { TranscriptV1 } from "../types";

describe("Settlement lifecycle in transcripts", () => {
  let tempDir: string;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), "test-transcripts-"));
  });
  
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("records settlement lifecycle metadata in transcript when provider is specified", async () => {
    // Create a minimal transcript object with settlement lifecycle
    const transcript: TranscriptV1 = {
      version: "1",
      intent_id: "test-intent-123",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        settlement: {
          provider: "mock",
          idempotency_key: "test-key-123",
        },
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: true },
      settlement_lifecycle: {
        provider: "mock",
        idempotency_key: "test-key-123",
        status: "committed",
        committed_at_ms: Date.now(),
        paid_amount: 0.001,
      },
    };

    // Verify structure
    expect(transcript.settlement_lifecycle).toBeDefined();
    expect(transcript.settlement_lifecycle?.provider).toBe("mock");
    expect(transcript.settlement_lifecycle?.idempotency_key).toBe("test-key-123");
    expect(transcript.settlement_lifecycle?.status).toBe("committed");
    expect(transcript.settlement_lifecycle?.paid_amount).toBeGreaterThan(0);
    expect(transcript.settlement_lifecycle?.committed_at_ms).toBeDefined();
  });

  it("records settlement lifecycle errors in transcript metadata", async () => {
    // Create a transcript with settlement lifecycle errors
    const transcript: TranscriptV1 = {
      version: "1",
      intent_id: "test-intent-error",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        settlement: {
          provider: "external",
          params: { rail: "test-rail" },
          idempotency_key: "test-key-external",
        },
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: {
        ok: false,
        code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
        reason: "Settlement provider not implemented: ExternalSettlementProvider not implemented",
      },
      settlement_lifecycle: {
        provider: "external",
        idempotency_key: "test-key-external",
        status: "aborted",
        aborted_at_ms: Date.now(),
        errors: [
          {
            code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
            reason: "Settlement operation (credit) failed: ExternalSettlementProvider not implemented",
          },
        ],
      },
    };

    // Verify error structure
    expect(transcript.settlement_lifecycle).toBeDefined();
    expect(transcript.settlement_lifecycle?.provider).toBe("external");
    expect(transcript.settlement_lifecycle?.idempotency_key).toBe("test-key-external");
    expect(transcript.settlement_lifecycle?.errors).toBeDefined();
    expect(transcript.settlement_lifecycle?.errors?.length).toBeGreaterThan(0);
    
    const error = transcript.settlement_lifecycle?.errors?.[0];
    expect(error?.code).toBe("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED");
    expect(error?.reason).toContain("Settlement operation");
    
    // Should have aborted status when errors occurred
    expect(transcript.settlement_lifecycle?.status).toBe("aborted");
    expect(transcript.settlement_lifecycle?.aborted_at_ms).toBeDefined();
  });

  it("replay validates settlement lifecycle invariants", async () => {
    // Test transcript with committed status
    const committedTranscript: TranscriptV1 = {
      version: "1",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: true },
      settlement_lifecycle: {
        provider: "mock",
        idempotency_key: "test-key",
        status: "committed",
        committed_at_ms: Date.now(),
        paid_amount: 0.001,
      },
    };

    const result1 = await replayTranscript(committedTranscript);
    expect(result1.ok).toBe(true);
    expect(result1.summary.settlement_lifecycle_verified).toBeGreaterThan(0);
    expect(result1.summary.settlement_lifecycle_failed).toBe(0);

    // Test transcript with committed status but missing paid_amount (should fail)
    const invalidCommittedTranscript: TranscriptV1 = {
      ...committedTranscript,
      settlement_lifecycle: {
        provider: "mock",
        status: "committed",
        committed_at_ms: Date.now(),
        // paid_amount missing
      },
    };

    const result2 = await replayTranscript(invalidCommittedTranscript);
    expect(result2.ok).toBe(false);
    expect(result2.failures.some(f => f.code === "SETTLEMENT_LIFECYCLE_INVALID")).toBe(true);
    expect(result2.summary.settlement_lifecycle_failed).toBeGreaterThan(0);

    // Test transcript with aborted status and paid_amount > 0 (should fail)
    const invalidAbortedTranscript: TranscriptV1 = {
      ...committedTranscript,
      settlement_lifecycle: {
        provider: "mock",
        status: "aborted",
        aborted_at_ms: Date.now(),
        paid_amount: 0.001, // Should be 0 or absent
      },
    };

    const result3 = await replayTranscript(invalidAbortedTranscript);
    expect(result3.ok).toBe(false);
    expect(result3.failures.some(f => f.code === "SETTLEMENT_LIFECYCLE_INVALID")).toBe(true);
    expect(result3.summary.settlement_lifecycle_failed).toBeGreaterThan(0);

    // Test transcript with prepared status but missing handle_id (should fail)
    const invalidPreparedTranscript: TranscriptV1 = {
      ...committedTranscript,
      settlement_lifecycle: {
        provider: "mock",
        status: "prepared",
        prepared_at_ms: Date.now(),
        // handle_id missing
      },
    };

    const result4 = await replayTranscript(invalidPreparedTranscript);
    expect(result4.ok).toBe(false);
    expect(result4.failures.some(f => f.code === "SETTLEMENT_LIFECYCLE_INVALID")).toBe(true);
    expect(result4.summary.settlement_lifecycle_failed).toBeGreaterThan(0);
  });
});

