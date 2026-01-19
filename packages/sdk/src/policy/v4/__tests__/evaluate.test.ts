/**
 * Tests for Policy v4 Evaluation Engine
 */

import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "../evaluate";
import { computePolicyHash } from "../hash";
import type { PactPolicyV4, PolicyEvaluationContext } from "../types";

describe("Policy v4 Evaluation", () => {
  const basePolicy: PactPolicyV4 = {
    policy_version: "pact-policy/4.0",
    policy_id: "policy-test123",
    rules: [],
  };

  it("should allow when all rules pass", () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "max_price",
          condition: {
            field: "offer_price",
            operator: "<=",
            value: 0.05,
          },
        },
      ],
    };

    const context: PolicyEvaluationContext = {
      offer_price: 0.04,
    };

    const result = evaluatePolicy(policy, context);

    expect(result.allowed).toBe(true);
    expect(result.violated_rules).toHaveLength(0);
    expect(result.mapped_failure_code).toBeUndefined();
  });

  it("should block when rule is violated (PACT-101)", () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "max_price",
          condition: {
            field: "offer_price",
            operator: "<=",
            value: 0.05,
          },
        },
      ],
    };

    const context: PolicyEvaluationContext = {
      offer_price: 0.10, // Exceeds max
    };

    const result = evaluatePolicy(policy, context);

    expect(result.allowed).toBe(false);
    expect(result.violated_rules).toHaveLength(1);
    expect(result.violated_rules[0].rule_name).toBe("max_price");
    expect(result.mapped_failure_code).toBe("PACT-101");
    expect(result.evidence_refs.length).toBeGreaterThan(0);
  });

  it("should support AND logical operator", () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "require_passport",
          condition: {
            AND: [
              {
                field: "counterparty_passport_score",
                operator: ">=",
                value: 80,
              },
              {
                field: "counterparty_passport_confidence",
                operator: ">=",
                value: 0.7,
              },
            ],
          },
        },
      ],
    };

    // Both conditions pass
    const contextPass: PolicyEvaluationContext = {
      counterparty_passport_score: 85,
      counterparty_passport_confidence: 0.8,
    };
    const resultPass = evaluatePolicy(policy, contextPass);
    expect(resultPass.allowed).toBe(true);

    // One condition fails
    const contextFail: PolicyEvaluationContext = {
      counterparty_passport_score: 75, // Below 80
      counterparty_passport_confidence: 0.8,
    };
    const resultFail = evaluatePolicy(policy, contextFail);
    expect(resultFail.allowed).toBe(false);
    expect(resultFail.violated_rules[0].rule_name).toBe("require_passport");
  });

  it("should support OR logical operator", () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "allow_boundary_or_stripe",
          condition: {
            OR: [
              {
                field: "settlement_mode",
                operator: "==",
                value: "boundary",
              },
              {
                field: "settlement_mode",
                operator: "==",
                value: "stripe",
              },
            ],
          },
        },
      ],
    };

    // Boundary (pass)
    const contextBoundary: PolicyEvaluationContext = {
      settlement_mode: "boundary",
    };
    const resultBoundary = evaluatePolicy(policy, contextBoundary);
    expect(resultBoundary.allowed).toBe(true);

    // Stripe (pass)
    const contextStripe: PolicyEvaluationContext = {
      settlement_mode: "stripe",
    };
    const resultStripe = evaluatePolicy(policy, contextStripe);
    expect(resultStripe.allowed).toBe(true);

    // Escrow (fail)
    const contextEscrow: PolicyEvaluationContext = {
      settlement_mode: "escrow",
    };
    const resultEscrow = evaluatePolicy(policy, contextEscrow);
    expect(resultEscrow.allowed).toBe(false);
  });

  it("should support NOT logical operator", () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "disallow_failure_codes",
          condition: {
            NOT: {
              field: "counterparty_recent_failures",
              operator: "IN",
              value: ["PACT-101", "PACT-202"],
            },
          },
        },
      ],
    };

    // No failures (pass)
    const contextNoFailures: PolicyEvaluationContext = {
      counterparty_recent_failures: [],
    };
    const resultNoFailures = evaluatePolicy(policy, contextNoFailures);
    expect(resultNoFailures.allowed).toBe(true);

    // Has disallowed failure (fail)
    const contextHasFailure: PolicyEvaluationContext = {
      counterparty_recent_failures: ["PACT-101"],
    };
    const resultHasFailure = evaluatePolicy(policy, contextHasFailure);
    expect(resultHasFailure.allowed).toBe(false);
  });

  it("should support IN operator", () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "allowed_intent_types",
          condition: {
            field: "intent_type",
            operator: "IN",
            value: ["weather.data", "llm.verify"],
          },
        },
      ],
    };

    // Allowed intent (pass)
    const contextAllowed: PolicyEvaluationContext = {
      intent_type: "weather.data",
    };
    const resultAllowed = evaluatePolicy(policy, contextAllowed);
    expect(resultAllowed.allowed).toBe(true);

    // Disallowed intent (fail)
    const contextDisallowed: PolicyEvaluationContext = {
      intent_type: "unknown.intent",
    };
    const resultDisallowed = evaluatePolicy(policy, contextDisallowed);
    expect(resultDisallowed.allowed).toBe(false);
  });

  it("should be deterministic (identical policy + context → identical result)", () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "max_price",
          condition: {
            field: "offer_price",
            operator: "<=",
            value: 0.05,
          },
        },
      ],
    };

    const context: PolicyEvaluationContext = {
      offer_price: 0.04,
    };

    // Run evaluation twice
    const result1 = evaluatePolicy(policy, context);
    const result2 = evaluatePolicy(policy, context);

    // Results must be identical
    expect(result1.allowed).toBe(result2.allowed);
    expect(result1.violated_rules).toEqual(result2.violated_rules);
    expect(result1.mapped_failure_code).toBe(result2.mapped_failure_code);
    expect(result1.evidence_refs).toEqual(result2.evidence_refs);
  });

  it("should include evidence_refs for violations", () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "max_price",
          condition: {
            field: "offer_price",
            operator: "<=",
            value: 0.05,
          },
        },
      ],
    };

    const context: PolicyEvaluationContext = {
      offer_price: 0.10, // Exceeds max (should violate)
    };

    const result = evaluatePolicy(policy, context);

    expect(result.allowed).toBe(false);
    expect(result.evidence_refs.length).toBeGreaterThan(0);
    expect(result.evidence_refs.some((ref) => ref.includes("policy_rule:max_price"))).toBe(true);
    expect(result.evidence_refs.some((ref) => ref.includes("policy_id"))).toBe(true);
  });

  it("should map policy violations to PACT-101", () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "max_price",
          condition: {
            field: "offer_price",
            operator: "<=",
            value: 0.05,
          },
        },
      ],
    };

    const context: PolicyEvaluationContext = {
      offer_price: 0.10,
    };

    const result = evaluatePolicy(policy, context);

    expect(result.allowed).toBe(false);
    expect(result.mapped_failure_code).toBe("PACT-101");
    expect(result.violated_rules[0].failure_code).toBe("PACT-101");
  });
});

describe("Policy v4 Hashing", () => {
  it("should produce identical hashes for identical policies", () => {
    const policy1: PactPolicyV4 = {
      policy_version: "pact-policy/4.0",
      policy_id: "policy-test123",
      rules: [
        {
          name: "max_price",
          condition: {
            field: "offer_price",
            operator: "<=",
            value: 0.05,
          },
        },
      ],
    };

    // Identical policy (different variable, same structure)
    const policy2: PactPolicyV4 = {
      policy_version: "pact-policy/4.0",
      policy_id: "policy-test123",
      rules: [
        {
          name: "max_price",
          condition: {
            field: "offer_price",
            operator: "<=",
            value: 0.05,
          },
        },
      ],
    };

    const hash1 = computePolicyHash(policy1);
    const hash2 = computePolicyHash(policy2);

    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different policies", () => {
    const policy1: PactPolicyV4 = {
      policy_version: "pact-policy/4.0",
      policy_id: "policy-test123",
      rules: [
        {
          name: "max_price",
          condition: {
            field: "offer_price",
            operator: "<=",
            value: 0.05,
          },
        },
      ],
    };

    const policy2: PactPolicyV4 = {
      ...policy1,
      rules: [
        {
          name: "max_price",
          condition: {
            field: "offer_price",
            operator: "<=",
            value: 0.10, // Different value
          },
        },
      ],
    };

    const hash1 = computePolicyHash(policy1);
    const hash2 = computePolicyHash(policy2);

    expect(hash1).not.toBe(hash2);
  });
});
