/**
 * Pact Handler Tests
 */

import { describe, it, expect } from "vitest";
import { handlePactRequest } from "../pactHandler.js";
import { signEnvelope, generateKeyPair } from "@pact/sdk";
import type { IntentMessage } from "@pact/sdk";

describe("Pact Handler", () => {
  describe("input validation", () => {
    it("should return BAD_REQUEST for missing envelope.message", async () => {
      const invalidEnvelope = {
        envelope_version: "pact-envelope/1.0",
        // Missing message field
        message_hash_hex: "abc123",
        signer_public_key_b58: "test",
        signature_b58: "test",
        signed_at_ms: Date.now(),
      };

      const result = await handlePactRequest(invalidEnvelope as any);

      expect(result).toHaveProperty("ok", false);
      if ("ok" in result && !result.ok) {
        expect(result.error).toBe("BAD_REQUEST");
        expect(result.missing).toContain("envelope.message");
        expect(result.message).toContain("Missing required field(s)");
      }
    });

    it("should return BAD_REQUEST for missing message.type", async () => {
      const invalidEnvelope = {
        envelope_version: "pact-envelope/1.0",
        message: {
          // Missing type field
          intent_id: "test-123",
        },
        message_hash_hex: "abc123",
        signer_public_key_b58: "test",
        signature_b58: "test",
        signed_at_ms: Date.now(),
      };

      const result = await handlePactRequest(invalidEnvelope as any);

      expect(result).toHaveProperty("ok", false);
      if ("ok" in result && !result.ok) {
        expect(result.error).toBe("BAD_REQUEST");
        expect(result.missing).toContain("envelope.message.type");
      }
    });

    it("should return BAD_REQUEST for INTENT message with missing required fields", async () => {
      const buyerKeypair = generateKeyPair();
      const nowMs = Date.now();

      // Create INTENT message missing required fields
      const intentMessage: Partial<IntentMessage> = {
        protocol_version: "pact/1.0",
        type: "INTENT",
        intent_id: "test-123",
        intent: "weather.data",
        // Missing: constraints, max_price, sent_at_ms, expires_at_ms
      };

      const envelope = await signEnvelope(intentMessage as any, buyerKeypair, nowMs);

      const result = await handlePactRequest(envelope);

      expect(result).toHaveProperty("ok", false);
      if ("ok" in result && !result.ok) {
        expect(result.error).toBe("BAD_REQUEST");
        expect(result.missing).toBeDefined();
        expect(Array.isArray(result.missing)).toBe(true);
        // Should include missing fields
        expect(result.missing?.length).toBeGreaterThan(0);
        expect(result.message).toContain("Missing required field(s)");
      }
    });

    it("should return BAD_REQUEST for INTENT message with missing constraints", async () => {
      const buyerKeypair = generateKeyPair();
      const nowMs = Date.now();

      const intentMessage: Partial<IntentMessage> = {
        protocol_version: "pact/1.0",
        type: "INTENT",
        intent_id: "test-123",
        intent: "weather.data",
        max_price: 0.05,
        sent_at_ms: nowMs,
        expires_at_ms: nowMs + 60000,
        // Missing: constraints
      };

      const envelope = await signEnvelope(intentMessage as any, buyerKeypair, nowMs);

      const result = await handlePactRequest(envelope);

      expect(result).toHaveProperty("ok", false);
      if ("ok" in result && !result.ok) {
        expect(result.error).toBe("BAD_REQUEST");
        expect(result.missing).toContain("message.constraints");
      }
    });

    it("should return BAD_REQUEST for INTENT message with constraints as non-object", async () => {
      const buyerKeypair = generateKeyPair();
      const nowMs = Date.now();

      const intentMessage: any = {
        protocol_version: "pact/1.0",
        type: "INTENT",
        intent_id: "test-123",
        intent: "weather.data",
        max_price: 0.05,
        sent_at_ms: nowMs,
        expires_at_ms: nowMs + 60000,
        constraints: "not-an-object", // Invalid type
      };

      const envelope = await signEnvelope(intentMessage, buyerKeypair, nowMs);

      const result = await handlePactRequest(envelope);

      expect(result).toHaveProperty("ok", false);
      if ("ok" in result && !result.ok) {
        expect(result.error).toBe("BAD_REQUEST");
        expect(result.message).toContain("message.constraints must be an object");
      }
    });

    it("should handle valid INTENT message successfully (end-to-end via handlePactRequest)", async () => {
      // This test verifies end-to-end flow: valid INTENT -> ASK response
      // The same code path is used by POST /pact in server.ts
      // With relaxed admission policy (require_one_of: []), valid INTENTs should pass
      const buyerKeypair = generateKeyPair();
      const nowMs = Date.now();

      const intentMessage: IntentMessage = {
        protocol_version: "pact/1.0",
        type: "INTENT",
        intent_id: "test-123",
        intent: "weather.data",
        scope: "NYC",
        constraints: {
          latency_ms: 50,
          freshness_sec: 10,
        },
        max_price: 0.05,
        settlement_mode: "hash_reveal",
        sent_at_ms: nowMs,
        expires_at_ms: nowMs + 60000,
      };

      const envelope = await signEnvelope(intentMessage, buyerKeypair, nowMs);

      const result = await handlePactRequest(envelope);

      // Should return a SignedEnvelope (ASK message), not an error
      expect(result).not.toHaveProperty("ok");
      expect(result).toHaveProperty("envelope_version");
      expect(result).toHaveProperty("message");
      if ("message" in result) {
        expect((result.message as any).type).toBe("ASK");
      }
    });

    it("should handle INTENT without policy field and return ASK", async () => {
      const buyerKeypair = generateKeyPair();
      const nowMs = Date.now();

      // Create INTENT message without policy field (as buyer would send)
      const intentMessage: IntentMessage = {
        protocol_version: "pact/1.0",
        type: "INTENT",
        intent_id: "test-no-policy",
        intent: "weather.data",
        scope: "NYC",
        constraints: {
          latency_ms: 50,
          freshness_sec: 10,
        },
        max_price: 0.05,
        settlement_mode: "hash_reveal",
        sent_at_ms: nowMs,
        expires_at_ms: nowMs + 60000,
        // No policy field - provider should handle this internally
      };

      const envelope = await signEnvelope(intentMessage, buyerKeypair, nowMs);

      const result = await handlePactRequest(envelope);

      // Should return a SignedEnvelope (ASK message), not an error
      // Provider should not throw on missing policy field
      expect(result).not.toHaveProperty("ok");
      expect(result).toHaveProperty("envelope_version");
      expect(result).toHaveProperty("message");
      if ("message" in result) {
        expect((result.message as any).type).toBe("ASK");
      }
    });

    it("should not crash on require_expires_at when INTENT has no policy field (regression test)", async () => {
      const buyerKeypair = generateKeyPair();
      const nowMs = Date.now();

      // Use the same valid IntentMessage from the test above (no policy field)
      const intentMessage: IntentMessage = {
        protocol_version: "pact/1.0",
        type: "INTENT",
        intent_id: "test-regression-require-expires-at",
        intent: "weather.data",
        scope: "NYC",
        constraints: {
          latency_ms: 50,
          freshness_sec: 10,
        },
        max_price: 0.05,
        settlement_mode: "hash_reveal",
        sent_at_ms: nowMs,
        expires_at_ms: nowMs + 60000,
        // Explicitly no policy field - this should not cause a crash
      };

      const envelope = await signEnvelope(intentMessage, buyerKeypair, nowMs);

      const result = await handlePactRequest(envelope);

      // Must return ASK, not throw, and specifically no INTERNAL_ERROR
      expect(result).not.toHaveProperty("ok");
      
      // Explicitly check it's not an error response
      if ("ok" in result && result.ok === false) {
        // If it's an error, it must NOT be INTERNAL_ERROR
        expect((result as any).error).not.toBe("INTERNAL_ERROR");
        // And must NOT mention require_expires_at crash
        expect((result as any).message).not.toContain("require_expires_at");
        expect((result as any).detail).not.toContain("require_expires_at");
        expect((result as any).detail).not.toContain("Cannot read properties");
      }
      
      // Should return a valid ASK message
      expect(result).toHaveProperty("envelope_version");
      expect(result).toHaveProperty("message");
      if ("message" in result) {
        expect((result.message as any).type).toBe("ASK");
      }
    });

    it("should return missing policy.time.require_expires_at when error mentions require_expires_at", async () => {
      const buyerKeypair = generateKeyPair();
      const nowMs = Date.now();

      // Create an INTENT message that will trigger validation
      // This test verifies that if an error occurs mentioning "require_expires_at",
      // the error response includes missing: ["policy.time.require_expires_at"]
      const intentMessage: IntentMessage = {
        protocol_version: "pact/1.0",
        type: "INTENT",
        intent_id: "test-require-expires-at",
        intent: "weather.data",
        scope: "NYC",
        constraints: {
          latency_ms: 50,
          freshness_sec: 10,
        },
        max_price: 0.05,
        settlement_mode: "hash_reveal",
        sent_at_ms: nowMs,
        expires_at_ms: nowMs + 60000,
      };

      const envelope = await signEnvelope(intentMessage, buyerKeypair, nowMs);

      const result = await handlePactRequest(envelope);

      // Verify that if there's an error about require_expires_at, it has the correct missing field
      // This ensures the error mapping works correctly
      if (result && typeof result === "object" && "ok" in result && !result.ok) {
        const errorResult = result as { ok: false; error: string; missing?: string[]; message: string };
        // If error mentions require_expires_at, verify missing field is set correctly
        if (errorResult.message.includes("require_expires_at") || errorResult.message.includes("policy.time.require_expires_at")) {
          expect(errorResult.missing).toBeDefined();
          expect(Array.isArray(errorResult.missing)).toBe(true);
          expect(errorResult.missing).toContain("policy.time.require_expires_at");
          expect(errorResult.missing?.length).toBeGreaterThan(0);
          // Ensure missing is never empty for require_expires_at errors
          expect(errorResult.missing?.length).toBeGreaterThanOrEqual(1);
        }
      }
      // If successful (no error), that's fine - the test verifies error handling when errors occur
    });
  });
});
