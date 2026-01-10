/**
 * Unit tests for settlement provider fallback logic (B2)
 */

import { describe, it, expect } from "vitest";
import { isRetryableFailure, buildFallbackPlan, type ProviderCandidate } from "../fallback";

describe("fallback", () => {
  describe("isRetryableFailure", () => {
    it("should return true for retryable settlement failures", () => {
      expect(isRetryableFailure("SETTLEMENT_FAILED")).toBe(true);
      expect(isRetryableFailure("SETTLEMENT_POLL_TIMEOUT")).toBe(true);
      expect(isRetryableFailure("SETTLEMENT_PENDING_UNRESOLVED")).toBe(true);
      expect(isRetryableFailure("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED")).toBe(true);
    });

    it("should return true for retryable provider errors", () => {
      expect(isRetryableFailure("PROVIDER_SIGNATURE_INVALID")).toBe(true);
      expect(isRetryableFailure("PROVIDER_SIGNER_MISMATCH")).toBe(true);
      expect(isRetryableFailure("PROVIDER_QUOTE_HTTP_ERROR")).toBe(true);
      expect(isRetryableFailure("PROVIDER_QUOTE_PARSE_ERROR")).toBe(true);
      expect(isRetryableFailure("HTTP_PROVIDER_ERROR")).toBe(true);
      expect(isRetryableFailure("HTTP_STREAMING_ERROR")).toBe(true);
      expect(isRetryableFailure("INVALID_MESSAGE_TYPE")).toBe(true);
    });

    it("should return false for non-retryable failures", () => {
      expect(isRetryableFailure("FAILED_PROOF")).toBe(false);
      expect(isRetryableFailure("PROVIDER_CREDENTIAL_INVALID")).toBe(false);
      expect(isRetryableFailure("PROVIDER_CREDENTIAL_EXPIRED")).toBe(false);
      expect(isRetryableFailure("PROVIDER_TRUST_TIER_INSUFFICIENT")).toBe(false);
      expect(isRetryableFailure("PROVIDER_TRUST_SCORE_TOO_LOW")).toBe(false);
      expect(isRetryableFailure("POLICY_CONSTRAINT_VIOLATION")).toBe(false);
      expect(isRetryableFailure("POLICY_INVALID_MODE")).toBe(false);
      expect(isRetryableFailure("UNTRUSTED_ISSUER")).toBe(false);
      expect(isRetryableFailure("MISSING_REQUIRED_CREDENTIALS")).toBe(false);
      expect(isRetryableFailure("BOND_INSUFFICIENT")).toBe(false);
    });

    it("should return false for unknown codes (default to non-retryable)", () => {
      expect(isRetryableFailure("UNKNOWN_ERROR")).toBe(false);
      expect(isRetryableFailure("RANDOM_CODE")).toBe(false);
    });
  });

  describe("buildFallbackPlan", () => {
    it("should return empty array for empty candidates", () => {
      const result = buildFallbackPlan({
        candidates: [],
        primaryProviderId: "provider1",
      });
      expect(result).toEqual([]);
    });

    it("should put primary candidate first", () => {
      const candidates: ProviderCandidate[] = [
        { provider_id: "provider1", pubkey_b58: "key1" },
        { provider_id: "provider2", pubkey_b58: "key2" },
        { provider_id: "provider3", pubkey_b58: "key3" },
      ];

      const result = buildFallbackPlan({
        candidates,
        primaryProviderId: "provider2",
      });

      expect(result).toHaveLength(3);
      expect(result[0].provider_id).toBe("provider2"); // Primary first
      expect(result[1].provider_id).toBe("provider1"); // Then remaining in order
      expect(result[2].provider_id).toBe("provider3");
    });

    it("should handle primary candidate at start", () => {
      const candidates: ProviderCandidate[] = [
        { provider_id: "provider1", pubkey_b58: "key1" },
        { provider_id: "provider2", pubkey_b58: "key2" },
        { provider_id: "provider3", pubkey_b58: "key3" },
      ];

      const result = buildFallbackPlan({
        candidates,
        primaryProviderId: "provider1",
      });

      expect(result).toHaveLength(3);
      expect(result[0].provider_id).toBe("provider1"); // Primary first
      expect(result[1].provider_id).toBe("provider2"); // Then remaining in order
      expect(result[2].provider_id).toBe("provider3");
    });

    it("should handle primary candidate at end", () => {
      const candidates: ProviderCandidate[] = [
        { provider_id: "provider1", pubkey_b58: "key1" },
        { provider_id: "provider2", pubkey_b58: "key2" },
        { provider_id: "provider3", pubkey_b58: "key3" },
      ];

      const result = buildFallbackPlan({
        candidates,
        primaryProviderId: "provider3",
      });

      expect(result).toHaveLength(3);
      expect(result[0].provider_id).toBe("provider3"); // Primary first
      expect(result[1].provider_id).toBe("provider1"); // Then remaining in order
      expect(result[2].provider_id).toBe("provider2");
    });

    it("should handle primary not found in candidates", () => {
      const candidates: ProviderCandidate[] = [
        { provider_id: "provider1", pubkey_b58: "key1" },
        { provider_id: "provider2", pubkey_b58: "key2" },
      ];

      const result = buildFallbackPlan({
        candidates,
        primaryProviderId: "provider99", // Not in candidates
      });

      // Should return candidates as-is when primary not found
      expect(result).toHaveLength(2);
      expect(result[0].provider_id).toBe("provider1");
      expect(result[1].provider_id).toBe("provider2");
    });

    it("should preserve candidate properties", () => {
      const candidates: ProviderCandidate[] = [
        {
          provider_id: "provider1",
          pubkey_b58: "key1",
          credentials: ["cred1"],
          region: "us-east",
          baseline_latency_ms: 100,
          endpoint: "http://example.com",
        },
        {
          provider_id: "provider2",
          pubkey_b58: "key2",
          credentials: ["cred2"],
        },
      ];

      const result = buildFallbackPlan({
        candidates,
        primaryProviderId: "provider2",
      });

      expect(result[0]).toEqual(candidates[1]); // Primary first
      expect(result[1]).toEqual(candidates[0]); // Then remaining
    });
  });
});

