/**
 * Trust Scoring Tests
 * 
 * Tests for credential trust scoring functionality.
 */

import { describe, it, expect } from "vitest";
import { computeCredentialTrustScore } from "../trust";
import type { KyaTrustConfig } from "../../policy/types";

describe("computeCredentialTrustScore", () => {
  const defaultTrustConfig: KyaTrustConfig = {
    require_trusted_issuer: false,
    trusted_issuers: ["self"],
    issuer_weights: { "self": 0.2 },
    min_trust_score: 0.0,
  };

  it("strict mode rejects issuer not in trusted_issuers", () => {
    const strictConfig: KyaTrustConfig = {
      require_trusted_issuer: true,
      trusted_issuers: ["trusted-issuer"],
      issuer_weights: { "trusted-issuer": 0.5, "self": 0.2 },
      min_trust_score: 0.0,
    };

    const result = computeCredentialTrustScore({
      credential: { issuer: "untrusted-issuer" },
      policyTrustConfig: strictConfig,
    });

    expect(result.trust_score).toBe(0);
    expect(result.tier).toBe("untrusted");
    expect(result.reasons).toContain('Issuer "untrusted-issuer" not in trusted issuers list');
  });

  it("trusted issuer > self issuer score", () => {
    const config: KyaTrustConfig = {
      require_trusted_issuer: false,
      trusted_issuers: ["trusted-issuer", "self"],
      issuer_weights: { "trusted-issuer": 0.6, "self": 0.2 },
      min_trust_score: 0.0,
    };

    const trustedResult = computeCredentialTrustScore({
      credential: { issuer: "trusted-issuer" },
      policyTrustConfig: config,
    });

    const selfResult = computeCredentialTrustScore({
      credential: { issuer: "self" },
      policyTrustConfig: config,
    });

    expect(trustedResult.trust_score).toBeGreaterThan(selfResult.trust_score);
    expect(trustedResult.trust_score).toBe(0.6); // Base weight
    expect(selfResult.trust_score).toBe(0.2); // Base weight
  });

  it("sla_verified increases score", () => {
    const resultWithoutSla = computeCredentialTrustScore({
      credential: { issuer: "self", claims: [] },
      policyTrustConfig: defaultTrustConfig,
    });

    const resultWithSla = computeCredentialTrustScore({
      credential: { issuer: "self", claims: ["sla_verified"] },
      claims: ["sla_verified"],
      policyTrustConfig: defaultTrustConfig,
    });

    expect(resultWithSla.trust_score).toBeGreaterThan(resultWithoutSla.trust_score);
    expect(resultWithSla.trust_score).toBe(0.2 + 0.1); // Base weight + SLA boost
    expect(resultWithSla.reasons).toContain("SLA verified boost (+0.1)");
  });

  it("region match increases score", () => {
    const result = computeCredentialTrustScore({
      credential: { issuer: "self", region: "us-east" },
      requestContext: { region: "us-east" },
      policyTrustConfig: defaultTrustConfig,
    });

    expect(result.trust_score).toBe(0.2 + 0.05); // Base weight + region boost
    expect(result.reasons).toContain("Region match boost (+0.05)");
  });

  it("settlement mode match increases score", () => {
    const result = computeCredentialTrustScore({
      credential: { issuer: "self", modes: ["hash_reveal"] },
      requestContext: { settlementMode: "hash_reveal" },
      policyTrustConfig: defaultTrustConfig,
    });

    expect(result.trust_score).toBe(0.2 + 0.05); // Base weight + settlement mode boost
    expect(result.reasons).toContain("Settlement mode match boost (+0.05)");
  });

  it("determines tier correctly", () => {
    const highTrustConfig: KyaTrustConfig = {
      require_trusted_issuer: false,
      trusted_issuers: ["self"],
      issuer_weights: { "self": 0.8 },
      min_trust_score: 0.0,
    };

    const trustedResult = computeCredentialTrustScore({
      credential: { issuer: "self", claims: ["sla_verified"] },
      claims: ["sla_verified"],
      policyTrustConfig: highTrustConfig,
    });

    expect(trustedResult.trust_score).toBeGreaterThanOrEqual(0.7);
    expect(trustedResult.tier).toBe("trusted");

    const lowResult = computeCredentialTrustScore({
      credential: { issuer: "self" },
      policyTrustConfig: defaultTrustConfig,
    });

    expect(lowResult.trust_score).toBeLessThan(0.3);
    expect(lowResult.tier).toBe("untrusted");
  });

  it("clamps trust score to [0, 1]", () => {
    const highWeightConfig: KyaTrustConfig = {
      require_trusted_issuer: false,
      trusted_issuers: ["self"],
      issuer_weights: { "self": 1.0 },
      min_trust_score: 0.0,
    };

    const result = computeCredentialTrustScore({
      credential: { issuer: "self", claims: ["sla_verified"] },
      claims: ["sla_verified"],
      requestContext: { region: "us-east", settlementMode: "hash_reveal" },
      policyTrustConfig: highWeightConfig,
    });

    // Should be clamped even with all boosts
    expect(result.trust_score).toBeLessThanOrEqual(1.0);
    expect(result.trust_score).toBeGreaterThanOrEqual(0.0);
  });
});

