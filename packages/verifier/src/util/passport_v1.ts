/**
 * Passport v1 - Self-contained implementation for verifier
 * 
 * Deterministic, replayable passport scoring engine.
 * No external dependencies on @pact/passport.
 */

import type { TranscriptV4, TranscriptRound } from "./transcript_types.js";
import { stableCanonicalize, hashMessageSync } from "./canonical.js";

// ============================================================================
// Types
// ============================================================================

/**
 * JudgmentArtifact - DBL judgment result (subset needed for passport)
 */
export type JudgmentArtifact = {
  version: string;
  transcript_id: string;
  status: "COMPLETED" | "FAILED_INTEGRITY" | "FAILED" | string;
  dblDetermination: 
    | "NO_FAULT"
    | "BUYER_AT_FAULT"
    | "PROVIDER_AT_FAULT"
    | "BUYER_RAIL_AT_FAULT"
    | "PROVIDER_RAIL_AT_FAULT"
    | "UNKNOWN"
    | string;
  passportImpact: number;
  confidence: number;
  notes?: string;
};

/**
 * PassportState - Canonical state for an agent
 */
export type PassportState = {
  version: "passport/1.0";
  agent_id: string;
  score: number; // Bounded [-1, +1]
  counters: {
    total_settlements: number;
    successful_settlements: number;
    disputes_lost: number;
    disputes_won: number;
    sla_violations: number;
    policy_aborts: number;
  };
};

/**
 * PassportDelta - Incremental update to PassportState
 */
export type PassportDelta = {
  agent_id: string;
  score_delta: number;
  counters_delta: {
    total_settlements?: number;
    successful_settlements?: number;
    disputes_lost?: number;
    disputes_won?: number;
    sla_violations?: number;
    policy_aborts?: number;
  };
};

/**
 * Transcript summary for passport scoring
 */
export type TranscriptSummary = {
  transcript_id: string;
  intent_id: string;
  created_at_ms: number;
  outcome: "success" | "abort" | "timeout" | "dispute" | "failure";
  failure_code?: string;
  failure_stage?: string;
  failure_fault_domain?: string;
  buyer_id: string;
  seller_id: string;
  dispute_result?: "buyer_wins" | "seller_wins" | "dismissed" | "split";
};

/**
 * Passport inputs for delta computation
 */
export type PassportInputs = {
  transcript_summary: TranscriptSummary;
  dbl_judgment: JudgmentArtifact | null;
  agent_id: string;
};

// ============================================================================
// Identity
// ============================================================================

/**
 * Get the canonical signer key from a round.
 */
export function getRoundSignerKey(round: TranscriptRound): string | null {
  if (round.signature?.signer_public_key_b58) {
    return round.signature.signer_public_key_b58;
  }
  if (round.public_key_b58) {
    return round.public_key_b58;
  }
  return null;
}

/**
 * Get all unique signer keys from a transcript (sorted lexicographically).
 */
export function getTranscriptSigners(transcript: TranscriptV4): string[] {
  const signerSet = new Set<string>();
  
  for (const round of transcript.rounds) {
    const signerKey = getRoundSignerKey(round);
    if (signerKey) {
      signerSet.add(signerKey);
    }
  }
  
  return Array.from(signerSet).sort();
}

// ============================================================================
// Summary Extraction
// ============================================================================

/**
 * Extract transcript summary from a TranscriptV4.
 */
export function extractTranscriptSummary(transcript: TranscriptV4): TranscriptSummary {
  const intentRound = transcript.rounds.find((r) => r.round_type === "INTENT");
  const buyerKey = intentRound ? getRoundSignerKey(intentRound) : null;
  
  const sellerRound = transcript.rounds.find((r) => {
    const roundKey = getRoundSignerKey(r);
    return roundKey && roundKey !== buyerKey && 
           (r.round_type === "ASK" || r.round_type === "COUNTER" || r.round_type === "ACCEPT");
  });
  const sellerKey = sellerRound ? getRoundSignerKey(sellerRound) : null;
  
  let outcome: "success" | "abort" | "timeout" | "dispute" | "failure";
  let failureCode: string | undefined;
  let failureStage: string | undefined;
  let failureFaultDomain: string | undefined;
  
  if (transcript.failure_event) {
    failureCode = transcript.failure_event.code;
    failureStage = transcript.failure_event.stage;
    failureFaultDomain = transcript.failure_event.fault_domain;
    
    if (failureCode === "PACT-101") {
      outcome = "abort";
    } else if (failureCode === "PACT-404") {
      outcome = "timeout";
    } else {
      outcome = "failure";
    }
  } else {
    const acceptRound = transcript.rounds.find((r) => r.round_type === "ACCEPT");
    if (acceptRound) {
      outcome = "success";
    } else {
      outcome = "failure";
    }
  }
  
  return {
    transcript_id: transcript.transcript_id,
    intent_id: transcript.intent_id,
    created_at_ms: transcript.created_at_ms,
    outcome,
    failure_code: failureCode,
    failure_stage: failureStage,
    failure_fault_domain: failureFaultDomain,
    buyer_id: buyerKey || "",
    seller_id: sellerKey || "",
  };
}

// ============================================================================
// Delta Computation
// ============================================================================

/**
 * Compute passport delta from inputs.
 */
export function computePassportDelta(inputs: PassportInputs): PassportDelta {
  const { transcript_summary, dbl_judgment, agent_id } = inputs;
  
  const delta: PassportDelta = {
    agent_id,
    score_delta: 0,
    counters_delta: {},
  };
  
  const outcome = transcript_summary.outcome;
  const failureCode = transcript_summary.failure_code;
  
  // Rule 1: Terminal success
  if (outcome === "success") {
    delta.counters_delta.total_settlements = 1;
    delta.counters_delta.successful_settlements = 1;
    delta.score_delta += 0.01;
    return delta;
  }
  
  // Rule 2: Policy abort (PACT-101)
  if (failureCode === "PACT-101" || outcome === "abort") {
    delta.counters_delta.policy_aborts = 1;
    delta.score_delta -= 0.01;
    return delta;
  }
  
  // Rule 3: SLA timeout/violation (PACT-404)
  if (failureCode === "PACT-404" || outcome === "timeout") {
    delta.counters_delta.sla_violations = 1;
    delta.score_delta -= 0.02;
    return delta;
  }
  
  // Rule 4: Disputes
  if (outcome === "dispute" && dbl_judgment) {
    const { buyer_id, seller_id } = transcript_summary;
    const isBuyer = agent_id === buyer_id;
    const isSeller = agent_id === seller_id;
    
    let isAtFault = false;
    if (isBuyer && (dbl_judgment.dblDetermination === "BUYER_AT_FAULT" || dbl_judgment.dblDetermination === "BUYER_RAIL_AT_FAULT")) {
      isAtFault = true;
    } else if (isSeller && (dbl_judgment.dblDetermination === "PROVIDER_AT_FAULT" || dbl_judgment.dblDetermination === "PROVIDER_RAIL_AT_FAULT")) {
      isAtFault = true;
    }
    
    const isExonerated = dbl_judgment.dblDetermination === "NO_FAULT" || 
                         (isBuyer && dbl_judgment.dblDetermination === "PROVIDER_AT_FAULT") ||
                         (isSeller && dbl_judgment.dblDetermination === "BUYER_AT_FAULT");
    
    if (isAtFault) {
      delta.counters_delta.disputes_lost = 1;
      delta.score_delta += dbl_judgment.passportImpact;
    } else if (isExonerated) {
      // No negative impact
    } else if (dbl_judgment.passportImpact > 0) {
      delta.counters_delta.disputes_won = 1;
      delta.score_delta += 0.01;
    }
    
    return delta;
  }
  
  // Rule 5: Integrity tamper
  if (dbl_judgment?.notes?.includes("final hash mismatch") || 
      dbl_judgment?.notes?.includes("FINAL_HASH_MISMATCH")) {
    delta.score_delta -= 0.2;
    return delta;
  }
  
  // Rule 6: Other failures
  if (outcome === "failure") {
    delta.counters_delta.total_settlements = 1;
    return delta;
  }
  
  return delta;
}

// ============================================================================
// Delta Application
// ============================================================================

/**
 * Apply a passport delta to state.
 */
export function applyDelta(state: PassportState, delta: PassportDelta): PassportState {
  const newScore = state.score + delta.score_delta;
  const clampedScore = Math.max(-1, Math.min(1, newScore));
  
  const newCounters = {
    total_settlements: state.counters.total_settlements + (delta.counters_delta.total_settlements || 0),
    successful_settlements: state.counters.successful_settlements + (delta.counters_delta.successful_settlements || 0),
    disputes_lost: state.counters.disputes_lost + (delta.counters_delta.disputes_lost || 0),
    disputes_won: state.counters.disputes_won + (delta.counters_delta.disputes_won || 0),
    sla_violations: state.counters.sla_violations + (delta.counters_delta.sla_violations || 0),
    policy_aborts: state.counters.policy_aborts + (delta.counters_delta.policy_aborts || 0),
  };
  
  return {
    version: "passport/1.0",
    agent_id: state.agent_id,
    score: clampedScore,
    counters: newCounters,
  };
}

// ============================================================================
// Stable ID & Recompute
// ============================================================================

/**
 * Get stable identifier for transcript ordering.
 */
export function getTranscriptStableId(transcript: TranscriptV4): string {
  if (transcript.final_hash) {
    return transcript.final_hash;
  }
  
  if (transcript.transcript_id) {
    return transcript.transcript_id;
  }
  
  const canonical = stableCanonicalize(transcript);
  const hash = hashMessageSync(canonical);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Recompute passport state from transcripts.
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
    
    let maxCount = 0;
    for (const count of signerCounts.values()) {
      maxCount = Math.max(maxCount, count);
    }
    
    const topSigners = Array.from(signerCounts.entries())
      .filter(([_, count]) => count === maxCount)
      .map(([signer]) => signer)
      .sort();
    
    targetSigner = topSigners[0];
  }
  
  // Sort and deduplicate
  const sortedTranscripts = [...transcripts].sort((a, b) => {
    const idA = getTranscriptStableId(a);
    const idB = getTranscriptStableId(b);
    return idA.localeCompare(idB);
  });
  
  const processedKeys = new Set<string>();
  const deduplicatedTranscripts: TranscriptV4[] = [];
  
  for (const transcript of sortedTranscripts) {
    const signers = getTranscriptSigners(transcript);
    if (!signers.includes(targetSigner)) {
      continue;
    }
    
    const stableId = getTranscriptStableId(transcript);
    const uniquenessKey = `${stableId}:${targetSigner}`;
    
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
  
  // Process transcripts
  let state = initialState;
  
  for (const transcript of deduplicatedTranscripts) {
    const summary = extractTranscriptSummary(transcript);
    const delta = computePassportDelta({
      transcript_summary: summary,
      dbl_judgment: null,
      agent_id: targetSigner,
    });
    state = applyDelta(state, delta);
  }
  
  return state;
}
