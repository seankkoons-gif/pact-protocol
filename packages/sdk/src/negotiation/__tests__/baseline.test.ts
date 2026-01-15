import { describe, it, expect } from "vitest";
import { BaselineNegotiationStrategy } from "../baseline";
import type { NegotiationInput } from "../types";

describe("BaselineNegotiationStrategy", () => {
  it("should accept quote price when within max price", async () => {
    const strategy = new BaselineNegotiationStrategy();
    const input: NegotiationInput = {
      intent_type: "weather.data",
      buyer_id: "buyer1",
      provider_id: "provider1",
      quote_price: 0.0001,
      max_price: 0.0002,
    };

    const result = await strategy.negotiate(input);

    expect(result.ok).toBe(true);
    expect(result.agreed_price).toBe(0.0001);
    expect(result.rounds_used).toBeGreaterThanOrEqual(1);
    expect(result.log.length).toBeGreaterThan(0);
    expect(result.log[0].decision.type).toBe("start");
    expect(result.log.some(entry => entry.decision.type === "accepted_quote")).toBe(true);
    expect(result.log.some(entry => entry.decision.type === "done")).toBe(true);
  });

  it("should reject when quote price exceeds max price", async () => {
    const strategy = new BaselineNegotiationStrategy();
    const input: NegotiationInput = {
      intent_type: "weather.data",
      buyer_id: "buyer1",
      provider_id: "provider1",
      quote_price: 0.0002,
      max_price: 0.0001,
    };

    const result = await strategy.negotiate(input);

    expect(result.ok).toBe(false);
    expect(result.agreed_price).toBe(0.0002);
    expect(result.rounds_used).toBe(1);
    expect(result.log.length).toBeGreaterThan(0);
    expect(result.reason).toContain("exceeds max price");
    expect(result.log.some(entry => entry.decision.type === "rejected")).toBe(true);
  });

  it("should include reference price in input when provided", async () => {
    const strategy = new BaselineNegotiationStrategy();
    const input: NegotiationInput = {
      intent_type: "weather.data",
      buyer_id: "buyer1",
      provider_id: "provider1",
      reference_price: 0.00009,
      quote_price: 0.0001,
      max_price: 0.0002,
    };

    const result = await strategy.negotiate(input);

    expect(result.ok).toBe(true);
    expect(result.agreed_price).toBe(0.0001);
  });

  it("should handle urgent flag", async () => {
    const strategy = new BaselineNegotiationStrategy();
    const input: NegotiationInput = {
      intent_type: "weather.data",
      buyer_id: "buyer1",
      provider_id: "provider1",
      quote_price: 0.0001,
      max_price: 0.0002,
      urgent: true,
    };

    const result = await strategy.negotiate(input);

    expect(result.ok).toBe(true);
    expect(result.agreed_price).toBe(0.0001);
  });
});



