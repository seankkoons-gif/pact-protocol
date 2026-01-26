/**
 * Identity extraction for Passport v1
 * 
 * NON-NEGOTIABLE IDENTITY RULE:
 * - Canonical agent identity for scoring + grouping is the signer public key:
 *   rounds[].signature.signer_public_key_b58
 *   fallback rounds[].public_key_b58
 * - NEVER group by rounds[].agent_id (that is role/display only).
 */

import type { TranscriptV4, TranscriptRound } from "./types";

/**
 * Get the canonical signer key from a round.
 * Uses signature.signer_public_key_b58, falls back to public_key_b58.
 * 
 * @param round Transcript round
 * @returns Signer public key in base58, or null if not available
 */
export function getRoundSignerKey(round: TranscriptRound): string | null {
  // Primary: use signature.signer_public_key_b58
  if (round.signature?.signer_public_key_b58) {
    return round.signature.signer_public_key_b58;
  }
  
  // Fallback: use public_key_b58
  if (round.public_key_b58) {
    return round.public_key_b58;
  }
  
  return null;
}

/**
 * Get all unique signer keys from a transcript (in stable order).
 * 
 * @param transcript TranscriptV4
 * @returns Array of unique signer public keys (base58), sorted lexicographically
 */
export function getTranscriptSigners(transcript: TranscriptV4): string[] {
  const signerSet = new Set<string>();
  
  for (const round of transcript.rounds) {
    const signerKey = getRoundSignerKey(round);
    if (signerKey) {
      signerSet.add(signerKey);
    }
  }
  
  // Return in stable lexicographic order
  return Array.from(signerSet).sort();
}
