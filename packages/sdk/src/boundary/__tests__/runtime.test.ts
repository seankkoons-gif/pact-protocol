/**
 * Tests for Pact Boundary Runtime
 */

import { describe, it, expect } from "vitest";
import { runInPactBoundary, BoundaryAbortError } from "../runtime";
import type { PactPolicyV4, BoundaryIntent } from "../runtime";

describe("Pact Boundary Runtime", () => {
  const baseIntent: BoundaryIntent = {
    intent_id: "intent-test-123",
    intent_type: "weather.data",
    created_at_ms: Date.now(),
  };

  const basePolicy: PactPolicyV4 = {
    policy_version: "pact-policy/4.0",
    policy_id: "policy-test-123",
    rules: [],
  };

  it("should embed policy hash in transcript", async () => {
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

    const result = await runInPactBoundary(baseIntent, policy, async (context) => {
      return {
        success: true,
        offer_price: 0.04,
      };
    });

    expect(result.transcript.policy_hash).toBeTruthy();
    expect(result.transcript.policy_hash).toMatch(/^[a-f0-9]+$/);
    expect(result.success).toBe(true);
  });

  it("should abort on policy violation during execution (early)", async () => {
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

    const result = await runInPactBoundary(baseIntent, policy, async (context) => {
      // Simulate policy evaluation during negotiation
      const offerPrice = 0.10; // Violates max_price
      if (offerPrice > 0.05) {
        context.abort("Offer price exceeds maximum allowed", "PACT-101");
      }
      return { success: true };
    });

    expect(result.success).toBe(false);
    expect(result.failure_event).toBeDefined();
    expect(result.failure_event?.code).toBe("PACT-101");
    expect(result.failure_event?.terminality).toBe("terminal");
    expect(result.transcript.failure_event).toBeDefined();
  });

  it("should abort on policy violation before settlement (late)", async () => {
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

    const result = await runInPactBoundary(baseIntent, policy, async (context) => {
      // Return success but with violating price
      return {
        success: true,
        offer_price: 0.10, // Violates max_price - should be caught before settlement
      };
    });

    // Boundary should catch violation before settlement
    expect(result.success).toBe(false);
    expect(result.failure_event?.code).toBe("PACT-101");
    expect(result.failure_event?.evidence_refs.some((ref) => ref.includes("policy_rule:max_price"))).toBe(true);
  });

  it("should allow execution when policy passes", async () => {
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

    const result = await runInPactBoundary(baseIntent, policy, async (context) => {
      return {
        success: true,
        offer_price: 0.04, // Within limit
      };
    });

    expect(result.success).toBe(true);
    expect(result.failure_event).toBeUndefined();
    expect(result.transcript.failure_event).toBeUndefined();
  });

  it("should produce identical transcript hash for identical intent + policy", async () => {
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

    const intent1: BoundaryIntent = {
      intent_id: "intent-identical",
      intent_type: "weather.data",
      created_at_ms: 1000000000000,
    };

    const intent2: BoundaryIntent = {
      intent_id: "intent-identical",
      intent_type: "weather.data",
      created_at_ms: 1000000000000,
    };

    const result1 = await runInPactBoundary(intent1, policy, async (context) => {
      return { success: true, offer_price: 0.04 };
    });

    const result2 = await runInPactBoundary(intent2, policy, async (context) => {
      return { success: true, offer_price: 0.04 };
    });

    // Transcript IDs should be identical (based on same content)
    expect(result1.transcript.transcript_id).toBe(result2.transcript.transcript_id);
    expect(result1.policy_hash).toBe(result2.policy_hash);
  });

  it("should include policy evaluation evidence_refs in failure event", async () => {
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

    const result = await runInPactBoundary(baseIntent, policy, async (context) => {
      return {
        success: true,
        offer_price: 0.10, // Violates policy
      };
    });

    expect(result.success).toBe(false);
    expect(result.failure_event?.evidence_refs.length).toBeGreaterThan(0);
    expect(result.failure_event?.evidence_refs.some((ref) => ref.includes("policy_hash"))).toBe(
      true
    );
    expect(result.failure_event?.evidence_refs.some((ref) => ref.includes("policy_rule"))).toBe(
      true
    );
  });

  it("should ensure abort is distinguishable from negotiation deadlock", async () => {
    const policy: PactPolicyV4 = {
      ...basePolicy,
      rules: [
        {
          name: "require_escrow",
          condition: {
            field: "settlement_mode",
            operator: "==",
            value: "escrow",
          },
        },
      ],
    };

    const result = await runInPactBoundary(baseIntent, policy, async (context) => {
      // Return with wrong settlement mode
      return {
        success: true,
        settlement_mode: "boundary", // Not escrow
      };
    });

    // Should abort (not deadlock)
    expect(result.success).toBe(false);
    expect(result.failure_event?.code).toBe("PACT-101"); // Policy violation, not deadlock
    expect(result.failure_event?.fault_domain).toBe("policy");
    // Deadlock would be PACT-303 with fault_domain "negotiation"
  });
});
