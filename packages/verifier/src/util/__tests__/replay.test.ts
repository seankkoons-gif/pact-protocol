/**
 * Regression tests for v4 transcript replay/integrity verification.
 * 
 * These tests verify that the verifier computes the same hashes as the SDK,
 * ensuring fixtures validate correctly after npm pack/install.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { replayTranscriptV4, computeInitialHash } from "../replay.js";
import type { TranscriptV4 } from "../transcript_types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../../..");

function loadFixture(fixturePath: string): TranscriptV4 {
  const absolutePath = resolve(repoRoot, fixturePath);
  const content = readFileSync(absolutePath, "utf8");
  return JSON.parse(content);
}

describe("v4 Transcript Replay", () => {
  describe("Genesis Hash (Round 0 previous_round_hash)", () => {
    it("should compute genesis hash matching SDK format: intent_id:created_at_ms", () => {
      // This test verifies the genesis hash uses the SDK's format
      // NOT canonical JSON, but simple string concatenation
      const intentId = "intent-success1-test";
      const createdAtMs = 1000000000000;
      
      const hash = computeInitialHash(intentId, createdAtMs);
      
      // This is the expected hash from the SDK's genesis.ts
      // Computed as: sha256("intent-success1-test:1000000000000")
      expect(hash).toBe("ee7e4e8263cfcd2d25783caa3dfff65e2dcb609c65024b7079fd1a5d96084eb4");
    });
    
    it("should match SUCCESS-001 fixture round 0 previous_round_hash", () => {
      const transcript = loadFixture("fixtures/success/SUCCESS-001-simple.json");
      const round0 = transcript.rounds[0];
      
      const computedGenesis = computeInitialHash(transcript.intent_id, transcript.created_at_ms);
      
      expect(computedGenesis).toBe(round0.previous_round_hash);
    });
  });
  
  describe("SUCCESS-001-simple.json Integrity", () => {
    it("should verify hash_chain as VALID", async () => {
      const transcript = loadFixture("fixtures/success/SUCCESS-001-simple.json");
      
      const result = await replayTranscriptV4(transcript);
      
      expect(result.integrity_status).toBe("VALID");
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it("should verify all 3 signatures", async () => {
      const transcript = loadFixture("fixtures/success/SUCCESS-001-simple.json");
      
      const result = await replayTranscriptV4(transcript);
      
      expect(result.signature_verifications).toBe(3);
      expect(result.rounds_verified).toBe(3);
    });
    
    it("should verify hash chain for all rounds", async () => {
      const transcript = loadFixture("fixtures/success/SUCCESS-001-simple.json");
      
      const result = await replayTranscriptV4(transcript);
      
      // All 3 rounds should have hash_chain verified
      expect(result.hash_chain_verifications).toBe(3);
    });
  });
  
  describe("Fixture Round Hashes", () => {
    it("should compute correct round_hash for each round in SUCCESS-001", async () => {
      const transcript = loadFixture("fixtures/success/SUCCESS-001-simple.json");
      
      // Replay should succeed, meaning all round hashes matched
      const result = await replayTranscriptV4(transcript);
      
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      
      // Verify specific round hashes from fixture
      expect(transcript.rounds[0].round_hash).toBe("5504b6e270079be76ffa090147d679b54247086a98569d37d5ec1964a4e3b9d1");
      expect(transcript.rounds[1].round_hash).toBe("bc3185ee651c670bec525505b57db612dbd8a5b8e1be31b338ab28f34c6607f8");
      expect(transcript.rounds[2].round_hash).toBe("4bccccf505aaf6be17b7be92c89ab80b5bcf6a503e2c30d08484ac48b8f0608f");
    });
    
    it("should chain previous_round_hash correctly through all rounds", () => {
      const transcript = loadFixture("fixtures/success/SUCCESS-001-simple.json");
      
      // Round 0: previous = genesis
      const genesis = computeInitialHash(transcript.intent_id, transcript.created_at_ms);
      expect(transcript.rounds[0].previous_round_hash).toBe(genesis);
      
      // Round 1: previous = round 0's round_hash
      expect(transcript.rounds[1].previous_round_hash).toBe(transcript.rounds[0].round_hash);
      
      // Round 2: previous = round 1's round_hash
      expect(transcript.rounds[2].previous_round_hash).toBe(transcript.rounds[1].round_hash);
    });
  });
});
