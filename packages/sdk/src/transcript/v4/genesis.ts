/**
 * Genesis Hash Utilities for Pact v4 Transcripts
 * 
 * The genesis hash is the canonical initial hash for round 0 of a v4 transcript.
 * It is computed from the intent_id and created_at_ms to ensure deterministic
 * hash chains that can be verified by replay verifiers.
 */

import * as crypto from "node:crypto";

/**
 * Compute the canonical genesis hash for round 0 of a v4 transcript.
 * 
 * This is the expected `previous_round_hash` value for the first round (round 0).
 * It is derived from the transcript's intent_id and created_at_ms to ensure
 * deterministic, verifiable hash chains.
 * 
 * @param intent_id - The unique identifier for the intent
 * @param created_at_ms - The timestamp when the transcript was created (milliseconds)
 * @returns The SHA-256 hash of the combined intent_id and created_at_ms (hex string)
 * 
 * @example
 * ```typescript
 * const genesisHash = computeInitialHash("intent-abc123", 1234567890000);
 * // Round 0 previous_round_hash should equal this value
 * ```
 */
export function computeInitialHash(intent_id: string, created_at_ms: number): string {
  const combined = `${intent_id}:${created_at_ms}`;
  // Use the same hashing logic as replay.ts sha256() function
  const hash = crypto.createHash("sha256");
  hash.update(combined, "utf8");
  return hash.digest("hex");
}
