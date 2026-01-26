/**
 * Passport v1 Tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptV4 } from "../../../sdk/src/transcript/v4/replay";
import { getTranscriptSigners, getRoundSignerKey } from "../identity";
import { recomputeFromTranscripts } from "../recompute";
import { computePassportDelta } from "../compute";
import { applyDelta } from "../apply";
import { extractTranscriptSummary } from "../summary";
import type { PassportState } from "../types";

/**
 * Load a fixture file
 */
function loadFixture(filename: string): TranscriptV4 {
  // Resolve from workspace root (fixtures are at root level)
  // From packages/passport/src/v1/__tests__/ we need to go up to workspace root
  const workspaceRoot = join(__dirname, "../../../../../");
  const fixturePath = join(workspaceRoot, "fixtures", filename);
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as TranscriptV4;
}

describe("Passport v1", () => {
  describe("identity", () => {
    it("getTranscriptSigners returns correct signer key(s) from SUCCESS-001-simple.json", () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const signers = getTranscriptSigners(transcript);
      
      // Should have 2 signers: buyer and seller
      expect(signers.length).toBe(2);
      expect(signers).toContain("21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J"); // buyer
      expect(signers).toContain("HBUkwmmQVFX3mGF6ris1mWDATY27nAupX6wQNXgJD9j9"); // seller
      
      // Should be in sorted order
      expect(signers[0] < signers[1]).toBe(true);
    });
    
    it("getRoundSignerKey uses signature.signer_public_key_b58", () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const round = transcript.rounds[0];
      
      const signerKey = getRoundSignerKey(round);
      expect(signerKey).toBe("21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J");
    });
    
    it("getRoundSignerKey falls back to public_key_b58", () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const round = transcript.rounds[0];
      
      // Create a round without signature.signer_public_key_b58
      const roundWithoutSig = { ...round, signature: { ...round.signature, signer_public_key_b58: "" } };
      const signerKey = getRoundSignerKey(roundWithoutSig);
      expect(signerKey).toBe("21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J");
    });
  });
  
  describe("recomputeFromTranscripts", () => {
    it("yields deterministic PassportState and score bounds", () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const state = recomputeFromTranscripts([transcript]);
      
      // Check structure
      expect(state.version).toBe("passport/1.0");
      expect(state.agent_id).toBeTruthy();
      expect(state.score).toBeGreaterThanOrEqual(-1);
      expect(state.score).toBeLessThanOrEqual(1);
      expect(state.counters).toBeDefined();
      expect(state.counters.total_settlements).toBeGreaterThanOrEqual(0);
      expect(state.counters.successful_settlements).toBeGreaterThanOrEqual(0);
    });
    
    it("is order-independent (shuffle list of transcripts, same output)", () => {
      const transcript1 = loadFixture("success/SUCCESS-001-simple.json");
      let t2: TranscriptV4;
      try {
        t2 = loadFixture("success/SUCCESS-002-negotiated.json");
      } catch {
        // Create a modified copy of transcript1 for testing
        t2 = JSON.parse(JSON.stringify(transcript1));
        t2.transcript_id = "transcript-different-id-for-test";
        t2.intent_id = "intent-different-id";
      }
      
      // Recompute with order 1
      const state1 = recomputeFromTranscripts([transcript1, t2], { forSigner: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J" });
      
      // Recompute with reversed order
      const state2 = recomputeFromTranscripts([t2, transcript1], { forSigner: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J" });
      
      // Should be identical
      expect(state1.agent_id).toBe(state2.agent_id);
      expect(state1.score).toBe(state2.score);
      expect(state1.counters).toEqual(state2.counters);
    });
    
    it("recompute equals fold(applyDelta(computeDelta)) over sorted transcripts", () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const signers = getTranscriptSigners(transcript);
      const targetSigner = signers[0];
      
      // Recompute using recomputeFromTranscripts
      const state1 = recomputeFromTranscripts([transcript], { forSigner: targetSigner });
      
      // Manual fold using computeDelta and applyDelta
      const initialState: PassportState = {
        version: "passport/1.0",
        agent_id: targetSigner,
        score: 0,
        counters: {
          total_settlements: 0,
          successful_settlements: 0,
          disputes_lost: 0,
          disputes_won: 0,
          sla_violations: 0,
          policy_aborts: 0,
        },
      };
      
      const summary = extractTranscriptSummary(transcript);
      const delta = computePassportDelta({
        transcript_summary: summary,
        dbl_judgment: null,
        agent_id: targetSigner,
      });
      const state2 = applyDelta(initialState, delta);
      
      // Should be identical
      expect(state1.agent_id).toBe(state2.agent_id);
      expect(state1.score).toBe(state2.score);
      expect(state1.counters).toEqual(state2.counters);
    });
  });
  
  describe("applyDelta", () => {
    it("clamps score [-1, +1]", () => {
      const state: PassportState = {
        version: "passport/1.0",
        agent_id: "test-agent",
        score: 0.5,
        counters: {
          total_settlements: 0,
          successful_settlements: 0,
          disputes_lost: 0,
          disputes_won: 0,
          sla_violations: 0,
          policy_aborts: 0,
        },
      };
      
      // Test clamping at upper bound
      const delta1 = {
        agent_id: "test-agent",
        score_delta: 1.0, // Would push to 1.5
        counters_delta: {},
      };
      const result1 = applyDelta(state, delta1);
      expect(result1.score).toBe(1);
      
      // Test clamping at lower bound
      const delta2 = {
        agent_id: "test-agent",
        score_delta: -2.0, // Would push to -1.5
        counters_delta: {},
      };
      const result2 = applyDelta(state, delta2);
      expect(result2.score).toBe(-1);
      
      // Test normal range
      const delta3 = {
        agent_id: "test-agent",
        score_delta: 0.3,
        counters_delta: {},
      };
      const result3 = applyDelta(state, delta3);
      expect(result3.score).toBe(0.8);
    });
  });
  
  describe("computePassportDelta", () => {
    it("computes success delta correctly", () => {
      const summary = extractTranscriptSummary(loadFixture("success/SUCCESS-001-simple.json"));
      const delta = computePassportDelta({
        transcript_summary: summary,
        dbl_judgment: null,
        agent_id: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
      });
      
      expect(delta.score_delta).toBe(0.01);
      expect(delta.counters_delta.total_settlements).toBe(1);
      expect(delta.counters_delta.successful_settlements).toBe(1);
    });
    
    it("computes policy abort delta correctly", () => {
      const summary = extractTranscriptSummary(loadFixture("failures/PACT-101-policy-violation.json"));
      const delta = computePassportDelta({
        transcript_summary: summary,
        dbl_judgment: null,
        agent_id: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
      });
      
      expect(delta.score_delta).toBe(-0.01);
      expect(delta.counters_delta.policy_aborts).toBe(1);
    });
    
    it("computes SLA violation delta correctly", () => {
      const summary = extractTranscriptSummary(loadFixture("failures/PACT-404-settlement-timeout.json"));
      const delta = computePassportDelta({
        transcript_summary: summary,
        dbl_judgment: null,
        agent_id: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
      });
      
      expect(delta.score_delta).toBe(-0.02);
      expect(delta.counters_delta.sla_violations).toBe(1);
    });
  });
});
