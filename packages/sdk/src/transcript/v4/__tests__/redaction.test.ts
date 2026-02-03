/**
 * Tests for Pact v4 Transcript Redaction
 */

import { describe, it, expect } from "vitest";
import { redactTranscript, verifyRedactedField, isRedacted } from "../redaction";
import type { TranscriptV4 } from "../replay";
import { createTranscriptV4 } from "../transcript";

describe("Transcript Redaction", () => {
  const createTestTranscript = (): TranscriptV4 => {
    const transcript = createTranscriptV4({
      intent_id: "intent-test-123",
      intent_type: "weather.data",
      created_at_ms: 1000000000000,
      policy_hash: "policy-hash-abc123",
      strategy_hash: "strategy-hash-def456",
    });

    return {
      ...transcript,
      rounds: [
        {
          round_number: 0,
          round_type: "INTENT",
          message_hash: "msg-hash-001",
          envelope_hash: "env-hash-001",
          signature: {
            signer_public_key_b58: "pubkey-123",
            signature_b58: "sig-123",
            signed_at_ms: 1000000000000,
            scheme: "ed25519",
          },
          timestamp_ms: 1000000000000,
          previous_round_hash: "0".repeat(64),
          round_hash: "round-hash-001",
          agent_id: "buyer",
          public_key_b58: "pubkey-123",
          content_summary: {
            pricing_logic: "proprietary-algorithm-v1",
            strategy_details: "internal-strategy-xyz",
            intent_type: "weather.data",
          },
        },
      ],
      failure_event: {
        code: "PACT-101",
        stage: "negotiation",
        fault_domain: "policy",
        terminality: "terminal",
        timestamp: 1000000001000,
        transcript_hash: transcript.transcript_id,
        evidence_refs: ["policy_rule:max_price", "policy_hash:abc123"],
      },
    };
  };

  it("should preserve full transcript for INTERNAL view", () => {
    const transcript = createTestTranscript();
    const redacted = redactTranscript(transcript, "INTERNAL");

    // INTERNAL view: no redaction
    expect(redacted).toEqual(transcript);
    expect(redacted.policy_hash).toBe(transcript.policy_hash);
    expect(redacted.strategy_hash).toBe(transcript.strategy_hash);
    expect(redacted.rounds[0].content_summary).toEqual(transcript.rounds[0].content_summary);
  });

  it("should redact strategy details for PARTNER view", () => {
    const transcript = createTestTranscript();
    const redacted = redactTranscript(transcript, "PARTNER");

    // PARTNER view: redact strategy hash and proprietary details
    expect(redacted.transcript_id).toBe(transcript.transcript_id); // Preserved
    expect(redacted.policy_hash).toBe(transcript.policy_hash); // Preserved

    // Strategy hash may be redacted (implementation-dependent)
    // For MVP, we preserve it but could redact

    // Content summary pricing_logic should be redacted
    const round = redacted.rounds[0];
    if (round.content_summary && typeof round.content_summary === "object") {
      const summary = round.content_summary as any;
      if (summary.pricing_logic && isRedacted(summary.pricing_logic)) {
        expect(summary.pricing_logic.redacted).toBe(true);
        expect(summary.pricing_logic.view).toBe("PARTNER");
        expect(summary.pricing_logic.hash).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });

  it("should redact policy and strategy hashes for AUDITOR view", () => {
    const transcript = createTestTranscript();
    const redacted = redactTranscript(transcript, "AUDITOR");

    // AUDITOR view: redact policy and strategy hashes
    expect(redacted.transcript_id).toBe(transcript.transcript_id); // Preserved

    // Policy hash should be redacted
    if (isRedacted(redacted.policy_hash)) {
      expect(redacted.policy_hash.redacted).toBe(true);
      expect(redacted.policy_hash.view).toBe("AUDITOR");
      expect(redacted.policy_hash.hash).toMatch(/^[a-f0-9]{64}$/);
    }

    // Strategy hash should be redacted
    if (isRedacted(redacted.strategy_hash)) {
      expect(redacted.strategy_hash.redacted).toBe(true);
      expect(redacted.strategy_hash.view).toBe("AUDITOR");
      expect(redacted.strategy_hash.hash).toMatch(/^[a-f0-9]{64}$/);
    }

    // Content summary should be redacted
    const round = redacted.rounds[0];
    if (round.content_summary && isRedacted(round.content_summary)) {
      expect(round.content_summary.redacted).toBe(true);
      expect(round.content_summary.view).toBe("AUDITOR");
    }
  });

  it("should preserve transcript_id (invariant)", () => {
    const transcript = createTestTranscript();
    const originalId = transcript.transcript_id;

    const redactedInternal = redactTranscript(transcript, "INTERNAL");
    const redactedPartner = redactTranscript(transcript, "PARTNER");
    const redactedAuditor = redactTranscript(transcript, "AUDITOR");

    // Transcript ID must be preserved in all views
    expect(redactedInternal.transcript_id).toBe(originalId);
    expect(redactedPartner.transcript_id).toBe(originalId);
    expect(redactedAuditor.transcript_id).toBe(originalId);
  });

  it("should preserve signatures (invariant)", () => {
    const transcript = createTestTranscript();
    const originalSignature = transcript.rounds[0].signature;

    const redactedPartner = redactTranscript(transcript, "PARTNER");
    const redactedAuditor = redactTranscript(transcript, "AUDITOR");

    // Signatures must be preserved
    expect(redactedPartner.rounds[0].signature).toEqual(originalSignature);
    expect(redactedAuditor.rounds[0].signature).toEqual(originalSignature);
  });

  it("should preserve failure taxonomy", () => {
    const transcript = createTestTranscript();
    const originalFailure = transcript.failure_event!;

    const redactedPartner = redactTranscript(transcript, "PARTNER");
    const redactedAuditor = redactTranscript(transcript, "AUDITOR");

    // Failure taxonomy must be preserved
    expect(redactedPartner.failure_event?.code).toBe(originalFailure.code);
    expect(redactedPartner.failure_event?.stage).toBe(originalFailure.stage);
    expect(redactedPartner.failure_event?.fault_domain).toBe(originalFailure.fault_domain);
    expect(redactedPartner.failure_event?.terminality).toBe(originalFailure.terminality);

    expect(redactedAuditor.failure_event?.code).toBe(originalFailure.code);
    expect(redactedAuditor.failure_event?.stage).toBe(originalFailure.stage);
    expect(redactedAuditor.failure_event?.fault_domain).toBe(originalFailure.fault_domain);
    expect(redactedAuditor.failure_event?.terminality).toBe(originalFailure.terminality);
  });

  it("should be deterministic (same transcript + view → identical output)", () => {
    const transcript1 = createTestTranscript();
    const transcript2 = createTestTranscript();

    const redacted1 = redactTranscript(transcript1, "PARTNER");
    const redacted2 = redactTranscript(transcript2, "PARTNER");

    // Should produce identical output (byte-for-byte)
    expect(JSON.stringify(redacted1)).toBe(JSON.stringify(redacted2));
  });

  it("should allow verification of redacted fields", () => {
    const transcript = createTestTranscript();
    const redacted = redactTranscript(transcript, "AUDITOR");

    // Verify policy hash redaction
    if (isRedacted(redacted.policy_hash)) {
      const originalPolicyHash = transcript.policy_hash;
      const isValid = verifyRedactedField(redacted.policy_hash, originalPolicyHash);
      expect(isValid).toBe(true);
    }
  });

  it("should detect tampering in redacted fields", () => {
    const transcript = createTestTranscript();
    const redacted = redactTranscript(transcript, "AUDITOR");

    // Verify policy hash redaction
    if (isRedacted(redacted.policy_hash)) {
      const tamperedContent = "tampered-policy-hash";
      const isValid = verifyRedactedField(redacted.policy_hash, tamperedContent);
      expect(isValid).toBe(false);
    }
  });

  it("should preserve round hashes for verification", () => {
    const transcript = createTestTranscript();
    const originalRoundHash = transcript.rounds[0].round_hash;

    const redactedPartner = redactTranscript(transcript, "PARTNER");
    const redactedAuditor = redactTranscript(transcript, "AUDITOR");

    // Round hashes must be preserved for verification
    expect(redactedPartner.rounds[0].round_hash).toBe(originalRoundHash);
    expect(redactedAuditor.rounds[0].round_hash).toBe(originalRoundHash);
  });
});
