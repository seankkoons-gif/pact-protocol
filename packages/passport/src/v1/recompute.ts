/**
 * Passport v1 Recompute
 * 
 * Recomputes passport state from transcripts deterministically.
 * Order-independent: same transcripts in any order produce same result.
 */

import type { TranscriptV4, PassportState } from "./types";
import { getTranscriptSigners, getRoundSignerKey } from "./identity";
import { extractTranscriptSummary } from "./summary";
import { computePassportDelta } from "./compute";
import { applyDelta } from "./apply";
import { stableCanonicalize, hashMessageSync } from "./canonical";

/**
 * Get stable identifier for transcript ordering.
 * 
 * Canonical ordering for recompute:
 * - Prefer transcript.final_hash if present
 * - Else prefer transcript.sealed_hash if present (not in v4 schema, but check for future compatibility)
 * - Else use transcript.transcript_id
 * - Else use deterministic hash of canonical JSON
 * 
 * @param transcript TranscriptV4
 * @returns Stable identifier string for sorting
 */
export function getTranscriptStableId(transcript: TranscriptV4): string {
  // Prefer final_hash (most reliable integrity identifier)
  if (transcript.final_hash) {
    return transcript.final_hash;
  }
  
  // Fallback to transcript_id
  if (transcript.transcript_id) {
    return transcript.transcript_id;
  }
  
  // Last resort: deterministic hash of canonical JSON
  const canonical = stableCanonicalize(transcript);
  const hash = hashMessageSync(canonical);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Recompute passport state from transcripts.
 * 
 * Behavior:
 * - If opts.forSigner is provided: only include deltas for that signer (based on signer key presence in transcript rounds)
 * - Otherwise, recompute for a default signer: choose the most frequent signer in the transcript set (deterministically: tie-break lexicographically)
 * - Must be order-independent: shuffle transcripts input => same output
 * 
 * @param transcripts Array of TranscriptV4 transcripts
 * @param opts Optional: forSigner to filter by specific signer key
 * @returns Passport state
 */
export function recomputeFromTranscripts(
  transcripts: TranscriptV4[],
  opts?: { forSigner?: string }
): PassportState {
  if (transcripts.length === 0) {
    throw new Error("Cannot recompute passport from empty transcript list");
  }
  
  // Determine target signer
  let targetSigner: string;
  if (opts?.forSigner) {
    targetSigner = opts.forSigner;
  } else {
    // Find most frequent signer (deterministically: tie-break lexicographically)
    const signerCounts = new Map<string, number>();
    
    for (const transcript of transcripts) {
      const signers = getTranscriptSigners(transcript);
      for (const signer of signers) {
        signerCounts.set(signer, (signerCounts.get(signer) || 0) + 1);
      }
    }
    
    if (signerCounts.size === 0) {
      throw new Error("No signers found in transcripts");
    }
    
    // Find max count
    let maxCount = 0;
    for (const count of signerCounts.values()) {
      maxCount = Math.max(maxCount, count);
    }
    
    // Get all signers with max count, sort lexicographically, take first
    const topSigners = Array.from(signerCounts.entries())
      .filter(([_, count]) => count === maxCount)
      .map(([signer]) => signer)
      .sort();
    
    targetSigner = topSigners[0];
  }
  
  // Sort transcripts by stable identifier (for deterministic ordering)
  const sortedTranscripts = [...transcripts].sort((a, b) => {
    const idA = getTranscriptStableId(a);
    const idB = getTranscriptStableId(b);
    return idA.localeCompare(idB);
  });
  
  // Deduplicate transcripts by (transcript_stable_id, signer_public_key_b58)
  // This ensures the same transcript with different agent_id labels cannot double-count
  const processedKeys = new Set<string>();
  const deduplicatedTranscripts: TranscriptV4[] = [];
  
  for (const transcript of sortedTranscripts) {
    // Check if this transcript involves the target signer
    const signers = getTranscriptSigners(transcript);
    if (!signers.includes(targetSigner)) {
      continue; // Skip transcripts that don't involve target signer
    }
    
    // Create uniqueness key: (transcript_stable_id, signer_public_key_b58)
    const stableId = getTranscriptStableId(transcript);
    const uniquenessKey = `${stableId}:${targetSigner}`;
    
    // Skip if already processed (idempotency)
    if (processedKeys.has(uniquenessKey)) {
      continue;
    }
    
    processedKeys.add(uniquenessKey);
    deduplicatedTranscripts.push(transcript);
  }
  
  // Initialize state
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
  
  // Process each deduplicated transcript
  let state = initialState;
  
  for (const transcript of deduplicatedTranscripts) {
    // Extract summary
    const summary = extractTranscriptSummary(transcript);
    
    // For now, we don't have DBL judgment available in recompute
    // In a real implementation, you would need to call resolveBlameV1 for each transcript
    // For v1, we'll pass null and rely on transcript summary only
    const dblJudgment = null;
    
    // Compute delta
    const delta = computePassportDelta({
      transcript_summary: summary,
      dbl_judgment: dblJudgment,
      agent_id: targetSigner,
    });
    
    // Apply delta
    state = applyDelta(state, delta);
  }
  
  return state;
}
