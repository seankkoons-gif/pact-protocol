/**
 * Contention Semantics v1.5: Intent Fingerprint
 * 
 * Defines intent_fingerprint as: hash(canonical intent + buyer signer pubkey + policy hash)
 * 
 * Used for:
 * - Detecting multiple terminal transcripts with same intent_fingerprint (double commit)
 * - Contention scanning across transcript directories
 */

import { createHash } from "node:crypto";
import { stableCanonicalize } from "../util/canonical.js";
import type { TranscriptV4, TranscriptRound } from "../util/transcript_types.js";

/**
 * Compute canonical intent representation.
 * Includes: intent_type, scope, constraints (normalized)
 */
function computeCanonicalIntent(transcript: TranscriptV4, intentRound: TranscriptRound): string {
  // Extract intent details from transcript and round
  const intentData = {
    intent_type: transcript.intent_type,
    scope: intentRound.content_summary?.scope || transcript.intent_id, // Fallback to intent_id if scope not in round
    constraints: intentRound.content_summary?.constraints || {},
  };
  
  return stableCanonicalize(intentData);
}

/**
 * Compute intent_fingerprint v1.5.
 * 
 * Formula: hash(canonical intent + buyer signer pubkey + policy hash)
 * 
 * @param transcript - The transcript v4
 * @returns intent_fingerprint string (SHA-256 hex)
 */
export function computeIntentFingerprintV15(transcript: TranscriptV4): string | null {
  // Find INTENT round
  const intentRound = transcript.rounds.find((r) => r.round_type === "INTENT");
  if (!intentRound) {
    return null; // No INTENT round found
  }

  // Get buyer signer pubkey from INTENT round signature
  const buyerSignerPubkey = intentRound.signature.signer_public_key_b58;
  if (!buyerSignerPubkey) {
    return null; // No signer pubkey
  }

  // Get policy hash
  const policyHash = transcript.policy_hash || "";

  // Compute canonical intent
  const canonicalIntent = computeCanonicalIntent(transcript, intentRound);

  // Concatenate: canonical intent + buyer signer pubkey + policy hash
  const combined = `${canonicalIntent}${buyerSignerPubkey}${policyHash}`;

  // Hash with SHA-256
  const hash = createHash("sha256").update(combined, "utf8").digest("hex");
  return hash;
}

/**
 * Extract intent_fingerprint from INTENT round if present.
 * Falls back to computing it if not present.
 */
export function getIntentFingerprint(transcript: TranscriptV4): string | null {
  // First, check if intent_fingerprint is already in INTENT round
  const intentRound = transcript.rounds.find((r) => r.round_type === "INTENT");
  if (intentRound?.content_summary?.intent_fingerprint) {
    return intentRound.content_summary.intent_fingerprint as string;
  }

  // Fallback: compute it
  return computeIntentFingerprintV15(transcript);
}
