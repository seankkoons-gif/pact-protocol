/**
 * Settlement Provider Routing Tests
 * 
 * Tests for policy-driven settlement provider selection (B1).
 */

import { describe, it, expect } from "vitest";
import { selectSettlementProvider } from "../routing";
import { compilePolicy } from "../../policy/index";
import { createDefaultPolicy as createDefaultPolicyBase } from "../../policy/defaultPolicy";
import type { PactPolicy } from "../../policy/types";

// Helper to create policy with overrides (similar to compiler.test.ts)
function createDefaultPolicy(overrides?: Partial<PactPolicy>): PactPolicy {
  const base = createDefaultPolicyBase();
  return { ...base, ...overrides } as PactPolicy;
}

describe("Settlement Provider Routing", () => {
  it("should return default provider when no routing config", () => {
    const policy = createDefaultPolicy();
    delete (policy as any).settlement_routing; // Remove routing config
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("mock");
    expect(result.matchedRuleIndex).toBeUndefined();
    expect(result.reason).toContain("No settlement_routing configured");
  });
  
  it("should return default provider when no rules match", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_amount: 0.001, // Higher than test amount
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: 0.0001, // Below min_amount
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("mock");
    expect(result.matchedRuleIndex).toBeUndefined();
    expect(result.reason).toContain("default_provider");
  });
  
  it("should match rule based on min_amount", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_amount: 0.00005,
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: 0.0001, // Above min_amount
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("stripe_like");
    expect(result.matchedRuleIndex).toBe(0);
    expect(result.reason).toContain("Matched rule 0");
  });
  
  it("should match rule based on max_amount", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            max_amount: 0.0001,
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: 0.00005, // Within max_amount
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("stripe_like");
    expect(result.matchedRuleIndex).toBe(0);
  });
  
  it("should match rule with amount range (inclusive)", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_amount: 0.00005,
            max_amount: 0.0001,
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    // Test at minimum (inclusive)
    const result1 = selectSettlementProvider(compiled, {
      amount: 0.00005,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    expect(result1.provider).toBe("stripe_like");
    
    // Test at maximum (inclusive)
    const result2 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    expect(result2.provider).toBe("stripe_like");
    
    // Test below range
    const result3 = selectSettlementProvider(compiled, {
      amount: 0.00004,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    expect(result3.provider).toBe("mock");
    
    // Test above range
    const result4 = selectSettlementProvider(compiled, {
      amount: 0.00011,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    expect(result4.provider).toBe("mock");
  });
  
  it("should match rule based on mode", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            mode: "streaming",
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "streaming",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("stripe_like");
    expect(result.matchedRuleIndex).toBe(0);
  });
  
  it("should not match rule if mode differs", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            mode: "streaming",
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("mock");
    expect(result.matchedRuleIndex).toBeUndefined();
  });
  
  it("should match rule based on min_trust_tier", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_trust_tier: "low",
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    // Test with "low" tier (matches)
    const result1 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "low",
      trustScore: 0.5,
    });
    expect(result1.provider).toBe("stripe_like");
    
    // Test with "trusted" tier (matches - higher than low)
    const result2 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "trusted",
      trustScore: 0.9,
    });
    expect(result2.provider).toBe("stripe_like");
    
    // Test with "untrusted" tier (doesn't match - lower than low)
    const result3 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    expect(result3.provider).toBe("mock");
  });
  
  it("should match rule based on min_trust_score", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_trust_score: 0.5,
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    // Test with score above threshold
    const result1 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.6,
    });
    expect(result1.provider).toBe("stripe_like");
    
    // Test with score at threshold
    const result2 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.5,
    });
    expect(result2.provider).toBe("stripe_like");
    
    // Test with score below threshold
    const result3 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.4,
    });
    expect(result3.provider).toBe("mock");
  });
  
  it("should match rule with multiple conditions", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_amount: 0.00005,
            max_amount: 0.0001,
            mode: "hash_reveal",
            min_trust_tier: "low",
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    // Test all conditions match
    const result1 = selectSettlementProvider(compiled, {
      amount: 0.000075,
      mode: "hash_reveal",
      trustTier: "low",
      trustScore: 0.5,
    });
    expect(result1.provider).toBe("stripe_like");
    
    // Test one condition fails (amount too low)
    const result2 = selectSettlementProvider(compiled, {
      amount: 0.00004,
      mode: "hash_reveal",
      trustTier: "low",
      trustScore: 0.5,
    });
    expect(result2.provider).toBe("mock");
    
    // Test one condition fails (mode differs)
    const result3 = selectSettlementProvider(compiled, {
      amount: 0.000075,
      mode: "streaming",
      trustTier: "low",
      trustScore: 0.5,
    });
    expect(result3.provider).toBe("mock");
    
    // Test one condition fails (trust tier too low)
    const result4 = selectSettlementProvider(compiled, {
      amount: 0.000075,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    expect(result4.provider).toBe("mock");
  });
  
  it("should match first rule when multiple rules match", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_amount: 0.00005,
          },
          use: "stripe_like",
        },
        {
          when: {
            min_amount: 0.00003, // Also matches
          },
          use: "external",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: 0.0001, // Matches both rules
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("stripe_like"); // First match wins
    expect(result.matchedRuleIndex).toBe(0);
  });
  
  it("should match rule with no 'when' conditions", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          use: "stripe_like", // No 'when' clause - always matches
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("stripe_like");
    expect(result.matchedRuleIndex).toBe(0);
    expect(result.reason).toContain("no conditions");
  });
  
  it("should handle invalid amount (NaN) by using default", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_amount: 0.00005,
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: NaN,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("mock");
    expect(result.reason).toContain("Invalid amount");
  });
  
  it("should handle invalid amount (Infinity) by using default", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "stripe_like",
      rules: [],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: Infinity,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("stripe_like"); // Uses default
    expect(result.reason).toContain("Invalid amount");
  });
  
  it("should handle negative amount by using default", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [],
    };
    const compiled = compilePolicy(policy);
    
    const result = selectSettlementProvider(compiled, {
      amount: -0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    
    expect(result.provider).toBe("mock");
    expect(result.reason).toContain("Invalid amount");
  });
  
  it("should clamp trust score outside valid range [0.0, 1.0]", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_trust_score: 0.5,
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    // Test with score > 1.0 (should be clamped to 1.0, which is >= 0.5, so matches)
    const result1 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 2.0, // Invalid, should be clamped
    });
    expect(result1.provider).toBe("stripe_like");
    
    // Test with score < 0.0 (should be clamped to 0.0, which is < 0.5, so doesn't match)
    const result2 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: -0.5, // Invalid, should be clamped to 0.0
    });
    expect(result2.provider).toBe("mock");
  });
  
  it("should handle invalid trust tier by defaulting to untrusted", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_trust_tier: "low",
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    // Test with invalid tier (not in valid set)
    // Note: TypeScript prevents this at compile time, but at runtime could happen with type coercion
    const result = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "invalid_tier" as any, // Simulate invalid tier
      trustScore: 0.9,
    });
    
    // Invalid tier should be treated as "untrusted", which is < "low", so rule doesn't match
    expect(result.provider).toBe("mock");
  });
  
  it("should handle trust tier comparison correctly for all valid tiers", () => {
    const policy = createDefaultPolicy();
    policy.settlement_routing = {
      default_provider: "mock",
      rules: [
        {
          when: {
            min_trust_tier: "trusted",
          },
          use: "stripe_like",
        },
      ],
    };
    const compiled = compilePolicy(policy);
    
    // Test with "untrusted" tier (< "trusted", so doesn't match)
    const result1 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "untrusted",
      trustScore: 0.0,
    });
    expect(result1.provider).toBe("mock"); // Default because rule doesn't match
    
    // Test with "low" tier (< "trusted", so doesn't match)
    const result2 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "low",
      trustScore: 0.0,
    });
    expect(result2.provider).toBe("mock"); // Default because rule doesn't match
    
    // Test with "trusted" tier (>= "trusted", so matches)
    const result3 = selectSettlementProvider(compiled, {
      amount: 0.0001,
      mode: "hash_reveal",
      trustTier: "trusted",
      trustScore: 0.9,
    });
    expect(result3.provider).toBe("stripe_like"); // Rule matches
  });
});

