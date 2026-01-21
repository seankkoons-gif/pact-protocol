/**
 * Transcript v4 Creation and Utilities
 */

import * as crypto from "node:crypto";
import type { TranscriptV4, TranscriptRound } from "./replay";
import { computeInitialHash } from "./genesis";
import { stableCanonicalize } from "../../protocol/canonical";

/**
 * Create a new v4 transcript.
 */
export function createTranscriptV4(params: {
  intent_id: string;
  intent_type: string;
  created_at_ms: number;
  policy_hash: string;
  strategy_hash?: string;
  identity_snapshot_hash?: string;
}): TranscriptV4 {
  const transcript: Omit<TranscriptV4, "transcript_id" | "transcript_version"> = {
    intent_id: params.intent_id,
    intent_type: params.intent_type,
    created_at_ms: params.created_at_ms,
    policy_hash: params.policy_hash,
    strategy_hash: params.strategy_hash || "",
    identity_snapshot_hash: params.identity_snapshot_hash || "",
    rounds: [],
    arbiter_decision_ref: null,
  };

  // Compute transcript ID from canonical hash
  const canonical = stableCanonicalize(transcript);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  const transcript_id = `transcript-${hash}`;

  return {
    transcript_version: "pact-transcript/4.0",
    transcript_id,
    ...transcript,
  };
}

/**
 * Add a round to transcript.
 */
export function addRoundToTranscript(
  transcript: TranscriptV4,
  round: Omit<TranscriptRound, "round_number" | "previous_round_hash" | "round_hash">
): TranscriptV4 {
  const roundNumber = transcript.rounds.length;
  const previousRound = transcript.rounds[roundNumber - 1];
  // For round 0, use canonical initial hash (intent_id + created_at_ms)
  // For subsequent rounds, use previous round's hash
  const previousRoundHash = roundNumber === 0
    ? computeInitialHash(transcript.intent_id, transcript.created_at_ms)
    : (previousRound?.round_hash || "0".repeat(64));

  // Compute round hash
  const roundWithHash: TranscriptRound = {
    ...round,
    round_number: roundNumber,
    previous_round_hash: previousRoundHash,
    round_hash: computeRoundHash({
      ...round,
      round_number: roundNumber,
      previous_round_hash: previousRoundHash,
    }),
  };

  return {
    ...transcript,
    rounds: [...transcript.rounds, roundWithHash],
  };
}

/**
 * Compute round hash (excluding round_hash field itself).
 */
function computeRoundHash(round: Omit<TranscriptRound, "round_hash">): string {
  const canonical = stableCanonicalize(round);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  return hash;
}
