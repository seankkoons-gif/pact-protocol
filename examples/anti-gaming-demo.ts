#!/usr/bin/env tsx
/**
 * Anti-Gaming Protections Demo
 * 
 * Demonstrates lightweight anti-gaming protections:
 * - Rate limiting per agent
 * - Reputation-weighted quote acceptance
 * - Rejection penalties
 * - Transcript flagging
 */

import { AntiGamingGuard, DEFAULT_ANTI_GAMING_CONFIG } from "@pact/sdk/anti-gaming";
import type { TranscriptV1 } from "@pact/sdk";

console.log("=== Pact v3 Anti-Gaming Protections Demo ===\n");

const guard = new AntiGamingGuard();

// Demo 1: Rate Limiting
console.log("1. Rate Limiting\n");

const agentId1 = "agent-123";
const now = Date.now();

for (let i = 0; i < 5; i++) {
  const check = guard.checkRateLimit(agentId1, "weather.data", now + i * 1000);
  console.log(`   Request ${i + 1}: ${check.ok ? "✅ Allowed" : "❌ Blocked"} (${check.currentCount}/${check.limit})`);
}

// Simulate rate limit exceeded
for (let i = 0; i < 30; i++) {
  guard.checkRateLimit(agentId1, "weather.data", now + 10000 + i * 100);
}
const exceeded = guard.checkRateLimit(agentId1, "weather.data", now + 14000);
console.log(`   Request 31: ${exceeded.ok ? "✅ Allowed" : "❌ Blocked"} - ${exceeded.reason}\n`);

// Demo 2: Reputation-Weighted Quote Acceptance
console.log("2. Reputation-Weighted Quote Acceptance\n");

const testCases = [
  { reputation: 0.9, bidPrice: 0.0001, askPrice: 0.0001, name: "High rep, equal price" },
  { reputation: 0.5, bidPrice: 0.0001, askPrice: 0.0001, name: "Medium rep, equal price" },
  { reputation: 0.2, bidPrice: 0.0001, askPrice: 0.0001, name: "Low rep, equal price" },
];

for (const test of testCases) {
  const decision = guard.calculateReputationWeightedAcceptance({
    agentId: "agent-456",
    reputation: test.reputation,
    bidPrice: test.bidPrice,
    askPrice: test.askPrice,
  });
  console.log(`   ${test.name}:`);
  console.log(`     Accept: ${decision.accept ? "✅" : "❌"}`);
  console.log(`     Adjusted Ask: ${decision.adjustedPrice?.toFixed(8)} (base: ${test.askPrice})`);
  console.log(`     Reason: ${decision.reason}`);
  if (decision.flags) {
    console.log(`     Flags: ${decision.flags.join(", ")}`);
  }
  console.log();
}

// Demo 3: Rejection Penalties
console.log("3. Rejection Penalties (Bad-Faith Bids)\n");

const agentId2 = "agent-789";
const baseTime = Date.now();

// Simulate 3 rejections (triggers bad-faith penalty)
for (let i = 0; i < 3; i++) {
  const result = guard.recordRejection({
    agentId: agentId2,
    intentId: `intent-${i}`,
    reason: "Price too low",
    priceOffered: 0.00005,
    priceAsked: 0.0001,
    nowMs: baseTime + i * 60000, // 1 minute apart
  });
  console.log(`   Rejection ${i + 1}:`);
  console.log(`     Bad-faith: ${result.badFaithDetected ? "⚠️  Yes" : "No"}`);
  console.log(`     Penalty: ${result.penaltyMultiplier.toFixed(3)}x`);
  console.log(`     Rejection count: ${result.rejectionCount}`);
  if (result.flags) {
    console.log(`     Flags: ${result.flags.join(", ")}`);
  }
  console.log();
}

// Check penalty applied to quote acceptance
const penaltyDecision = guard.calculateReputationWeightedAcceptance({
  agentId: agentId2,
  reputation: 0.8,
  bidPrice: 0.0001,
  askPrice: 0.0001,
  nowMs: baseTime + 180000,
});
console.log(`   Quote with penalty applied:`);
console.log(`     Accept: ${penaltyDecision.accept ? "✅" : "❌"}`);
console.log(`     Adjusted Ask: ${penaltyDecision.adjustedPrice?.toFixed(8)} (penalty: ${penaltyDecision.adjustedPrice! / 0.0001 > 1.0 ? "✅ Applied" : "None"})`);
console.log(`     Flags: ${penaltyDecision.flags?.join(", ") || "None"}\n`);

// Demo 4: Transcript Flagging
console.log("4. Transcript Flagging\n");

const mockTranscript: TranscriptV1 = {
  version: "1",
  transcript_version: "1.0",
  intent_id: "intent-demo",
  intent_type: "weather.data",
  timestamp_ms: baseTime,
  input: {
    intentType: "weather.data",
    scope: "NYC",
    constraints: { latency_ms: 50, freshness_sec: 10 },
    maxPrice: 0.0002,
  },
  directory: [],
  credential_checks: [],
  quotes: [],
  negotiation_rounds: [
    {
      round: 1,
      ask_price: 0.0001,
      counter_price: 0.00003, // 70% below ask - suspicious
      accepted: false,
      reason: "Price too low",
      timestamp_ms: baseTime,
    },
    {
      round: 2,
      ask_price: 0.00009,
      counter_price: 0.00002, // Also suspicious
      accepted: false,
      reason: "Price too low",
      timestamp_ms: baseTime + 1000,
    },
  ],
};

const flaggingResult = guard.flagTranscript(mockTranscript, agentId2, baseTime + 2000);
console.log(`   Flags detected: ${flaggingResult.flags.length > 0 ? "⚠️  " + flaggingResult.flags.join(", ") : "None"}`);
console.log(`   Agent status:`);
console.log(`     Rate limit: ${flaggingResult.agentStatus.rateLimitCount}/${flaggingResult.agentStatus.rateLimitLimit}`);
console.log(`     Bad-faith score: ${flaggingResult.agentStatus.badFaithScore.toFixed(3)}`);
console.log(`     Rejection count: ${flaggingResult.agentStatus.rejectionCount}`);
console.log(`     Penalty multiplier: ${flaggingResult.agentStatus.penaltyMultiplier.toFixed(3)}x`);

if (flaggingResult.flags.length > 0) {
  console.log(`\n   Explanations:`);
  for (const [flag, explanation] of Object.entries(flaggingResult.explanations)) {
    console.log(`     ${flag}: ${explanation}`);
  }
}

console.log("\n=== Demo Complete ===");
console.log("\nAll anti-gaming protections are:");
console.log("  ✅ Deterministic (same inputs = same outputs)");
console.log("  ✅ Transcript-backed (all decisions explainable)");
console.log("  ✅ In-memory (no databases, no external services)");
console.log("  ✅ Lightweight (fast, low overhead)");
