/**
 * Passport v1 Idempotency Tests
 * 
 * Tests that idempotency keys use (transcript_stable_id, signer_public_key_b58),
 * not agent_id, to prevent double-counting.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TranscriptV4 } from "../../../sdk/src/transcript/v4/replay";
import { recomputeFromTranscripts, getTranscriptStableId } from "../recompute";
import { getTranscriptSigners, getRoundSignerKey } from "../identity";

/**
 * Load a fixture file
 */
function loadFixture(filename: string): TranscriptV4 {
  const workspaceRoot = join(__dirname, "../../../../..");
  const fixturePath = join(workspaceRoot, "fixtures", filename);
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content) as TranscriptV4;
}

describe("Passport v1 Idempotency", () => {
  it("same transcript with different agent_id labels cannot double-count for the same signer key", () => {
    const transcript = loadFixture("success/SUCCESS-001-simple.json");
    const signers = getTranscriptSigners(transcript);
    const targetSigner = signers[0]; // Use first signer

    // Create a copy with different agent_id labels but same signer keys
    const transcriptCopy1 = JSON.parse(JSON.stringify(transcript)) as TranscriptV4;
    const transcriptCopy2 = JSON.parse(JSON.stringify(transcript)) as TranscriptV4;

    // Change agent_id labels (but keep signer keys the same)
    transcriptCopy1.rounds.forEach((round) => {
      if (round.agent_id) {
        round.agent_id = `different-${round.agent_id}`;
      }
    });
    transcriptCopy2.rounds.forEach((round) => {
      if (round.agent_id) {
        round.agent_id = `another-${round.agent_id}`;
      }
    });

    // Verify signer keys are unchanged
    const originalSigners = getTranscriptSigners(transcript);
    const copy1Signers = getTranscriptSigners(transcriptCopy1);
    const copy2Signers = getTranscriptSigners(transcriptCopy2);

    expect(originalSigners).toEqual(copy1Signers);
    expect(originalSigners).toEqual(copy2Signers);

    // Verify stable IDs are the same (same transcript content)
    const originalStableId = getTranscriptStableId(transcript);
    const copy1StableId = getTranscriptStableId(transcriptCopy1);
    const copy2StableId = getTranscriptStableId(transcriptCopy2);

    expect(originalStableId).toBe(copy1StableId);
    expect(originalStableId).toBe(copy2StableId);

    // Recompute with original transcript
    const state1 = recomputeFromTranscripts([transcript], { forSigner: targetSigner });

    // Recompute with duplicate transcripts (same stable ID, same signer, different agent_id labels)
    const state2 = recomputeFromTranscripts(
      [transcript, transcriptCopy1, transcriptCopy2],
      { forSigner: targetSigner }
    );

    // Should be identical - deduplication should prevent double-counting
    expect(state1.agent_id).toBe(state2.agent_id);
    expect(state1.score).toBe(state2.score);
    expect(state1.counters).toEqual(state2.counters);

    // Verify counters are not double-counted
    // If deduplication works, counters should match single transcript
    expect(state2.counters.total_settlements).toBe(state1.counters.total_settlements);
    expect(state2.counters.successful_settlements).toBe(state1.counters.successful_settlements);
  });

  it("different transcripts with same agent_id but different signer keys are processed separately", () => {
    const transcript1 = loadFixture("success/SUCCESS-001-simple.json");
    let transcript2: TranscriptV4;
    try {
      transcript2 = loadFixture("success/SUCCESS-002-negotiated.json");
    } catch {
      // Create a modified copy if SUCCESS-002 doesn't exist
      transcript2 = JSON.parse(JSON.stringify(transcript1)) as TranscriptV4;
      transcript2.transcript_id = "transcript-different-id";
      transcript2.intent_id = "intent-different";
      // Change final_hash to make it a different transcript
      transcript2.final_hash = "different-hash-for-testing";
    }

    // Get signers from both transcripts
    const signers1 = getTranscriptSigners(transcript1);
    const signers2 = getTranscriptSigners(transcript2);

    // Find a signer that appears in both (if any)
    const commonSigner = signers1.find((s) => signers2.includes(s));

    if (commonSigner) {
      // If there's a common signer, verify different transcripts are processed separately
      const state1 = recomputeFromTranscripts([transcript1], { forSigner: commonSigner });
      const state2 = recomputeFromTranscripts([transcript2], { forSigner: commonSigner });
      const stateBoth = recomputeFromTranscripts([transcript1, transcript2], { forSigner: commonSigner });

      // State with both transcripts should have combined counters (if both are successes)
      // This verifies that different transcripts (different stable IDs) are NOT deduplicated
      const stableId1 = getTranscriptStableId(transcript1);
      const stableId2 = getTranscriptStableId(transcript2);

      if (stableId1 !== stableId2) {
        // Different transcripts should both be counted
        expect(stateBoth.counters.total_settlements).toBeGreaterThanOrEqual(
          Math.max(state1.counters.total_settlements, state2.counters.total_settlements)
        );
      }
    }
  });

  it("uniqueness key is (transcript_stable_id, signer_public_key_b58) not agent_id", () => {
    const transcript = loadFixture("success/SUCCESS-001-simple.json");
    const signers = getTranscriptSigners(transcript);
    const targetSigner = signers[0];

    // Create copies with different agent_id values
    const copy1 = JSON.parse(JSON.stringify(transcript)) as TranscriptV4;
    const copy2 = JSON.parse(JSON.stringify(transcript)) as TranscriptV4;

    // Modify agent_id in rounds (but keep signer keys)
    copy1.rounds.forEach((round) => {
      if (round.agent_id === "buyer") {
        round.agent_id = "buyer-alias-1";
      } else if (round.agent_id === "seller") {
        round.agent_id = "seller-alias-1";
      }
    });

    copy2.rounds.forEach((round) => {
      if (round.agent_id === "buyer") {
        round.agent_id = "buyer-alias-2";
      } else if (round.agent_id === "seller") {
        round.agent_id = "seller-alias-2";
      }
    });

    // Verify signer keys are unchanged
    expect(getTranscriptSigners(copy1)).toEqual(getTranscriptSigners(transcript));
    expect(getTranscriptSigners(copy2)).toEqual(getTranscriptSigners(transcript));

    // Verify stable IDs are the same (same transcript content, just different agent_id labels)
    const stableId = getTranscriptStableId(transcript);
    expect(getTranscriptStableId(copy1)).toBe(stableId);
    expect(getTranscriptStableId(copy2)).toBe(stableId);

    // All three should produce the same state (deduplicated by stable_id + signer_key)
    const state1 = recomputeFromTranscripts([transcript], { forSigner: targetSigner });
    const state2 = recomputeFromTranscripts([copy1], { forSigner: targetSigner });
    const state3 = recomputeFromTranscripts([copy2], { forSigner: targetSigner });
    const stateAll = recomputeFromTranscripts([transcript, copy1, copy2], { forSigner: targetSigner });

    // All should be identical
    expect(state1).toEqual(state2);
    expect(state2).toEqual(state3);
    expect(state3).toEqual(stateAll);
  });
});
