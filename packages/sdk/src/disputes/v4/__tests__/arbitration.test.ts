/**
 * Tests for Pact v4 Arbitration Verifier and Hooks
 */

import { describe, it, expect } from "vitest";
import {
  type ArbiterDecisionV4,
  type ArbiterDecision,
  type ArbiterReasonCode,
  verifyDecisionSignature,
  validateDecisionArtifact,
  computeDecisionId,
  canonicalizeDecision,
  mapReasonCodeToFailureCode,
  attachDecisionReference,
  type TranscriptV4,
} from "../arbitration";
import nacl from "tweetnacl";
import bs58 from "bs58";
import * as crypto from "node:crypto";
import { hashMessageSync } from "../../../protocol/canonical";

describe("Pact v4 Arbitration", () => {
  // Generate test arbiter keypair
  const arbiterKeyPair = nacl.sign.keyPair();
  const arbiterPubkeyB58 = bs58.encode(arbiterKeyPair.publicKey);

  // Create a minimal valid decision for testing
  function createTestDecision(
    overrides?: Partial<ArbiterDecisionV4>
  ): ArbiterDecisionV4 {
    const issuedAt = Date.now();
    const transcriptHash = "transcript-" + "a".repeat(64);
    return {
      decision_id: computeDecisionId(transcriptHash, "arbiter-001", issuedAt),
      transcript_hash: transcriptHash,
      decision: "RELEASE" as ArbiterDecision,
      reason_codes: ["POLICY_VIOLATION_CONFIRMED"] as ArbiterReasonCode[],
      evidence_refs: [
        {
          type: "round_hash",
          ref: "a".repeat(64),
        },
      ],
      arbiter_id: "arbiter-001",
      arbiter_pubkey: arbiterPubkeyB58,
      issued_at: issuedAt,
      signature: {
        signer_public_key_b58: arbiterPubkeyB58,
        signature_b58: "", // Will be computed after canonicalization
        signed_at_ms: issuedAt,
        scheme: "ed25519" as const,
      },
      schema_version: "pact-arbiter-decision/4.0",
      ...overrides,
    };
  }

  describe("computeDecisionId", () => {
    it("should compute deterministic decision_id from inputs", () => {
      const transcriptHash = "transcript-" + "a".repeat(64);
      const arbiterId = "arbiter-001";
      const issuedAt = 1234567890000;

      const id1 = computeDecisionId(transcriptHash, arbiterId, issuedAt);
      const id2 = computeDecisionId(transcriptHash, arbiterId, issuedAt);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^decision-[a-f0-9]{64}$/);
    });

    it("should produce different IDs for different inputs", () => {
      const transcriptHash = "transcript-" + "a".repeat(64);
      const id1 = computeDecisionId(transcriptHash, "arbiter-001", 1000);
      const id2 = computeDecisionId(transcriptHash, "arbiter-002", 1000);
      const id3 = computeDecisionId(transcriptHash, "arbiter-001", 2000);

      expect(id1).not.toBe(id2);
      expect(id1).not.toBe(id3);
    });
  });

  describe("canonicalizeDecision", () => {
    it("should produce deterministic canonical JSON", () => {
      const decision = createTestDecision();
      delete (decision as any).signature.signature_b58; // Remove signature for canonicalization

      const canonical1 = canonicalizeDecision(decision);
      const canonical2 = canonicalizeDecision(decision);

      expect(canonical1).toBe(canonical2);
      expect(canonical1).not.toContain("signature"); // Signature field excluded
    });

    it("should exclude signature field from canonicalization", () => {
      const decision = createTestDecision();
      const decision2 = { ...decision };
      decision2.signature = { ...decision.signature, signature_b58: "different-signature" };

      const canonical1 = canonicalizeDecision(decision);
      const canonical2 = canonicalizeDecision(decision2);

      expect(canonical1).toBe(canonical2); // Should be identical (signature excluded)
    });
  });

  describe("verifyDecisionSignature", () => {
    it("should verify valid signature", () => {
      const decision = createTestDecision();
      const canonical = canonicalizeDecision(decision);
      const hashBytes = hashMessageSync(canonical);
      const signatureBytes = nacl.sign.detached(hashBytes, arbiterKeyPair.secretKey);
      decision.signature.signature_b58 = bs58.encode(signatureBytes);

      const valid = verifyDecisionSignature(decision);
      expect(valid).toBe(true);
    });

    it("should reject invalid signature", () => {
      const decision = createTestDecision();
      decision.signature.signature_b58 = bs58.encode(new Uint8Array(64)); // Invalid signature

      const valid = verifyDecisionSignature(decision);
      expect(valid).toBe(false);
    });

    it("should reject signature with mismatched public key", () => {
      const decision = createTestDecision();
      const canonical = canonicalizeDecision(decision);
      const hashBytes = hashMessageSync(canonical);
      const signatureBytes = nacl.sign.detached(hashBytes, arbiterKeyPair.secretKey);
      decision.signature.signature_b58 = bs58.encode(signatureBytes);
      decision.signature.signer_public_key_b58 = bs58.encode(nacl.sign.keyPair().publicKey); // Different pubkey

      const valid = verifyDecisionSignature(decision);
      expect(valid).toBe(false);
    });
  });

  describe("validateDecisionArtifact", () => {
    it("should validate valid decision artifact", () => {
      const decision = createTestDecision();
      const canonical = canonicalizeDecision(decision);
      const hashBytes = hashMessageSync(canonical);
      const signatureBytes = nacl.sign.detached(hashBytes, arbiterKeyPair.secretKey);
      decision.signature.signature_b58 = bs58.encode(signatureBytes);

      const result = validateDecisionArtifact(decision);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject decision with invalid decision_id", () => {
      const decision = createTestDecision();
      decision.decision_id = "invalid-id";
      const canonical = canonicalizeDecision(decision);
      const hashBytes = hashMessageSync(canonical);
      const signatureBytes = nacl.sign.detached(hashBytes, arbiterKeyPair.secretKey);
      decision.signature.signature_b58 = bs58.encode(signatureBytes);

      const result = validateDecisionArtifact(decision);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("decision_id"))).toBe(true);
    });

    it("should reject decision with mismatched transcript_hash", () => {
      const decision = createTestDecision();
      const canonical = canonicalizeDecision(decision);
      const hashBytes = hashMessageSync(canonical);
      const signatureBytes = nacl.sign.detached(hashBytes, arbiterKeyPair.secretKey);
      decision.signature.signature_b58 = bs58.encode(signatureBytes);

      const transcript: TranscriptV4 = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "transcript-" + "b".repeat(64), // Different hash
        intent_id: "intent-test",
        intent_type: "test",
        created_at_ms: 1000,
        policy_hash: "a".repeat(64),
        strategy_hash: "b".repeat(64),
        identity_snapshot_hash: "c".repeat(64),
        rounds: [],
      };

      const result = validateDecisionArtifact(decision, transcript);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("transcript_hash"))).toBe(true);
    });

    it("should require amounts for SPLIT decision", () => {
      const decision = createTestDecision({ decision: "SPLIT" as ArbiterDecision });
      delete decision.amounts;
      const canonical = canonicalizeDecision(decision);
      const hashBytes = hashMessageSync(canonical);
      const signatureBytes = nacl.sign.detached(hashBytes, arbiterKeyPair.secretKey);
      decision.signature.signature_b58 = bs58.encode(signatureBytes);

      const result = validateDecisionArtifact(decision);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("amounts"))).toBe(true);
    });

    it("should validate SPLIT decision with amounts", () => {
      const decision = createTestDecision({
        decision: "SPLIT" as ArbiterDecision,
        amounts: {
          buyer_amount: 50,
          provider_amount: 50,
          currency: "USD",
        },
      });
      const canonical = canonicalizeDecision(decision);
      const hashBytes = hashMessageSync(canonical);
      const signatureBytes = nacl.sign.detached(hashBytes, arbiterKeyPair.secretKey);
      decision.signature.signature_b58 = bs58.encode(signatureBytes);

      const result = validateDecisionArtifact(decision);
      expect(result.valid).toBe(true);
    });
  });

  describe("mapReasonCodeToFailureCode", () => {
    it("should map reason codes to Pact failure codes", () => {
      expect(mapReasonCodeToFailureCode("POLICY_VIOLATION_CONFIRMED")).toBe("PACT-101");
      expect(mapReasonCodeToFailureCode("IDENTITY_SNAPSHOT_INVALID")).toBe("PACT-201");
      expect(mapReasonCodeToFailureCode("DEADLOCK_CONFIRMED")).toBe("PACT-303");
      expect(mapReasonCodeToFailureCode("RAIL_TIMEOUT_CONFIRMED")).toBe("PACT-404");
      expect(mapReasonCodeToFailureCode("RECURSIVE_DEPENDENCY_FAILURE")).toBe("PACT-505");
    });
  });

  describe("attachDecisionReference", () => {
    it("should attach decision reference to transcript", () => {
      const transcript: TranscriptV4 = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "transcript-" + "a".repeat(64),
        intent_id: "intent-test",
        intent_type: "test",
        created_at_ms: 1000,
        policy_hash: "a".repeat(64),
        strategy_hash: "b".repeat(64),
        identity_snapshot_hash: "c".repeat(64),
        rounds: [],
      };

      const decisionId = "decision-" + "b".repeat(64);
      const updated = attachDecisionReference(transcript, decisionId);

      expect(updated.arbiter_decision_ref).toBe(decisionId);
      expect(updated.transcript_id).toBe(transcript.transcript_id); // Other fields unchanged
    });
  });
});
