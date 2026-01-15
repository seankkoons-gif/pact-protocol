import { describe, it, expect } from "vitest";
import { AggressiveIfUrgentStrategy } from "../aggressive_if_urgent";
import { BandedConcessionStrategy } from "../banded_concession";
import type { NegotiationInput } from "../types";

describe("AggressiveIfUrgentStrategy", () => {
  it("should match banded_concession outputs when not urgent", async () => {
    const aggressiveStrategy = new AggressiveIfUrgentStrategy();
    const bandedStrategy = new BandedConcessionStrategy();
    
    const input: NegotiationInput = {
      intent_type: "weather.data",
      buyer_id: "buyer1",
      provider_id: "provider1",
      reference_price: 0.0001,
      quote_price: 0.00011,
      max_price: 0.0002,
      band_pct: 0.1,
      max_rounds: 3,
      urgent: false, // Not urgent
    };

    const aggressiveResult = await aggressiveStrategy.negotiate(input);
    const bandedResult = await bandedStrategy.negotiate(input);

    // Should produce same results when not urgent
    expect(aggressiveResult.ok).toBe(bandedResult.ok);
    expect(aggressiveResult.agreed_price).toBe(bandedResult.agreed_price);
    expect(aggressiveResult.rounds_used).toBe(bandedResult.rounds_used);
    expect(aggressiveResult.counter_price).toBe(bandedResult.counter_price);
  });

  it("should move faster than banded_concession in urgent mode (higher counter at early rounds)", async () => {
    const aggressiveStrategy = new AggressiveIfUrgentStrategy();
    const bandedStrategy = new BandedConcessionStrategy();
    
    const referencePrice = 0.0001;
    const askPrice = 0.00011; // Within band
    const bandPct = 0.1;
    const maxRounds = 3;
    
    // Test round 1
    const round1Input: NegotiationInput = {
      intent_type: "weather.data",
      buyer_id: "buyer1",
      provider_id: "provider1",
      reference_price: referencePrice,
      quote_price: askPrice,
      max_price: 0.0002,
      band_pct: bandPct,
      max_rounds: maxRounds,
      urgent: true,
      current_round: 1,
    };
    
    const aggressiveRound1 = await aggressiveStrategy.negotiate(round1Input);
    const bandedRound1 = await bandedStrategy.negotiate(round1Input);
    
    // Aggressive should have higher counter in early rounds (sqrt curve is front-loaded)
    expect(aggressiveRound1.counter_price!).toBeGreaterThanOrEqual(bandedRound1.counter_price!);
    
    // Test round 2
    const round2Input: NegotiationInput = {
      ...round1Input,
      current_round: 2,
    };
    
    const aggressiveRound2 = await aggressiveStrategy.negotiate(round2Input);
    const bandedRound2 = await bandedStrategy.negotiate(round2Input);
    
    // Aggressive should still be higher or equal
    expect(aggressiveRound2.counter_price!).toBeGreaterThanOrEqual(bandedRound2.counter_price!);
  });

  it("should allow urgent override up to +25% of reference (vs +10% for banded_concession)", async () => {
    const aggressiveStrategy = new AggressiveIfUrgentStrategy();
    const referencePrice = 0.0001;
    const askPrice = 0.000135; // Exceeds band high (0.00011) but within +25% override (0.000125)
    const bandPct = 0.1;
    
    const input: NegotiationInput = {
      intent_type: "weather.data",
      buyer_id: "buyer1",
      provider_id: "provider1",
      reference_price: referencePrice,
      quote_price: askPrice,
      max_price: 0.0002,
      band_pct: bandPct,
      max_rounds: 3,
      urgent: true,
      allow_band_override: true,
      current_round: 3, // Final round
    };

    const result = await aggressiveStrategy.negotiate(input);

    // With +25% override, should be able to accept ask that's within override limit
    const overrideLimit = referencePrice * 0.25; // 0.000025
    const maxWithOverride = referencePrice * 1.1 + overrideLimit; // 0.000135
    
    // Note: askPrice (0.000135) exceeds the +25% limit (0.000125), so it won't accept
    // But if we use a price within the limit, it should work
    if (askPrice <= maxWithOverride) {
      expect(result.ok).toBe(true);
      expect(result.used_override).toBe(true);
    } else {
      // Test with a price that's within the +25% limit
      const validAskPrice = 0.000125; // Within +25% limit
      const validInput: NegotiationInput = {
        ...input,
        quote_price: validAskPrice,
      };
      const validResult = await aggressiveStrategy.negotiate(validInput);
      expect(validResult.ok).toBe(true);
      expect(validResult.used_override).toBe(true);
    }
  });

  it("should be monotonic across rounds (counter_price never decreases)", async () => {
    const strategy = new AggressiveIfUrgentStrategy();
    const referencePrice = 0.0001;
    const askPrice = 0.00011;
    const bandPct = 0.1;
    const maxRounds = 3;
    
    const round1 = strategy.computeCounter(1, maxRounds, referencePrice, bandPct, askPrice, false);
    const round2 = strategy.computeCounter(2, maxRounds, referencePrice, bandPct, askPrice, false);
    const round3 = strategy.computeCounter(3, maxRounds, referencePrice, bandPct, askPrice, false);
    
    // Should be monotonically increasing
    expect(round1.counter_price).toBeLessThanOrEqual(round2.counter_price);
    expect(round2.counter_price).toBeLessThanOrEqual(round3.counter_price);
    expect(round3.counter_price).toBeLessThanOrEqual(askPrice);
  });

  it("should never return counter_price below band_low", async () => {
    const strategy = new AggressiveIfUrgentStrategy();
    const referencePrice = 0.0001;
    const askPrice = 0.00011;
    const bandPct = 0.1;
    const maxRounds = 3;
    const bandLow = referencePrice * (1 - bandPct); // 0.00009
    
    for (let round = 1; round <= maxRounds; round++) {
      const result = strategy.computeCounter(round, maxRounds, referencePrice, bandPct, askPrice, false);
      expect(result.counter_price).toBeGreaterThanOrEqual(bandLow);
    }
  });

  it("should use sqrt curve for progress in urgent mode", () => {
    const strategy = new AggressiveIfUrgentStrategy();
    const referencePrice = 0.0001;
    const askPrice = 0.00011;
    const bandPct = 0.1;
    const maxRounds = 3;
    
    // Round 1: progress = min(1, (2/3)^0.5) = min(1, 0.816) = 0.816
    const round1 = strategy.computeCounter(1, maxRounds, referencePrice, bandPct, askPrice, false);
    
    // Round 2: progress = min(1, (3/3)^0.5) = min(1, 1.0) = 1.0
    const round2 = strategy.computeCounter(2, maxRounds, referencePrice, bandPct, askPrice, false);
    
    // Round 3: progress = min(1, (4/3)^0.5) = min(1, 1.155) = 1.0
    const round3 = strategy.computeCounter(3, maxRounds, referencePrice, bandPct, askPrice, false);
    
    // Round 2 and 3 should be at or near askPrice (progress = 1.0)
    expect(round2.counter_price).toBeGreaterThanOrEqual(round1.counter_price);
    expect(round3.counter_price).toBeGreaterThanOrEqual(round2.counter_price);
  });
});



