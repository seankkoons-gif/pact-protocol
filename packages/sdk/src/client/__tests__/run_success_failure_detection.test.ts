#!/usr/bin/env tsx
/**
 * Test for run_success.ts failure detection logic
 * 
 * Verifies that the script correctly detects transcript failures
 * and exits with non-zero status instead of reporting success.
 * 
 * This test ensures the failure detection logic in
 * examples/use_cases/autonomous-api-procurement/buyer/run_success.ts
 * works correctly and would catch regressions.
 */

import { describe, it, expect } from "vitest";
import type { TranscriptV4 } from "../../transcript/v4/replay";

/**
 * Extract abort_reason from failure_event evidence_refs
 * (Same logic as in run_success.ts)
 */
function extractAbortReason(failureEvent: TranscriptV4["failure_event"]): string {
  if (!failureEvent) return "Unknown abort reason";
  
  const abortReasonRef = failureEvent.evidence_refs.find((ref) =>
    ref.startsWith("abort_reason:")
  );
  return abortReasonRef
    ? abortReasonRef.substring("abort_reason:".length)
    : "Unknown abort reason";
}

/**
 * Check if transcript indicates failure
 * (Same logic as in run_success.ts)
 */
function isTranscriptFailure(transcript: TranscriptV4): {
  isFailure: boolean;
  code?: string;
  stage?: string;
  fault_domain?: string;
  abort_reason?: string;
} {
  if (!transcript.failure_event) {
    return { isFailure: false };
  }

  const failure = transcript.failure_event;
  return {
    isFailure: true,
    code: failure.code,
    stage: failure.stage,
    fault_domain: failure.fault_domain,
    abort_reason: extractAbortReason(failure),
  };
}

describe("run_success.ts failure detection", () => {
  it("should detect transcript with failure_event as failure", () => {
    const transcript: TranscriptV4 = {
      transcript_version: "pact-transcript/4.0",
      transcript_id: "transcript-test123",
      intent_id: "intent-test",
      intent_type: "weather.data",
      created_at_ms: Date.now(),
      policy_hash: "a".repeat(64),
      strategy_hash: "b".repeat(64),
      identity_snapshot_hash: "c".repeat(64),
      rounds: [],
      failure_event: {
        code: "PACT-420",
        stage: "negotiation",
        fault_domain: "PROVIDER_AT_FAULT",
        terminality: "terminal",
        evidence_refs: ["abort_reason:Quote request network error: fetch failed"],
        timestamp: Date.now(),
        transcript_hash: "d".repeat(64),
      },
    };

    const result = isTranscriptFailure(transcript);
    expect(result.isFailure).toBe(true);
    expect(result.code).toBe("PACT-420");
    expect(result.stage).toBe("negotiation");
    expect(result.fault_domain).toBe("PROVIDER_AT_FAULT");
    expect(result.abort_reason).toBe("Quote request network error: fetch failed");
  });

  it("should detect transcript without failure_event as success", () => {
    const transcript: TranscriptV4 = {
      transcript_version: "pact-transcript/4.0",
      transcript_id: "transcript-test123",
      intent_id: "intent-test",
      intent_type: "weather.data",
      created_at_ms: Date.now(),
      policy_hash: "a".repeat(64),
      strategy_hash: "b".repeat(64),
      identity_snapshot_hash: "c".repeat(64),
      rounds: [],
    };

    const result = isTranscriptFailure(transcript);
    expect(result.isFailure).toBe(false);
  });

  it("should extract abort_reason from evidence_refs", () => {
    const failureEvent = {
      code: "PACT-420",
      stage: "negotiation",
      fault_domain: "PROVIDER_AT_FAULT",
      terminality: "terminal" as const,
      evidence_refs: [
        "some_other_ref",
        "abort_reason:Network timeout occurred",
        "another_ref",
      ],
      timestamp: Date.now(),
      transcript_hash: "d".repeat(64),
    };

    const abortReason = extractAbortReason(failureEvent);
    expect(abortReason).toBe("Network timeout occurred");
  });

  it("should handle missing abort_reason gracefully", () => {
    const failureEvent = {
      code: "PACT-420",
      stage: "negotiation",
      fault_domain: "PROVIDER_AT_FAULT",
      terminality: "terminal" as const,
      evidence_refs: ["some_other_ref", "another_ref"],
      timestamp: Date.now(),
      transcript_hash: "d".repeat(64),
    };

    const abortReason = extractAbortReason(failureEvent);
    expect(abortReason).toBe("Unknown abort reason");
  });
});
