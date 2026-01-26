/**
 * Transcript Summary Extraction
 * 
 * Extracts summary information from TranscriptV4 for passport scoring.
 */

import type { TranscriptV4, TranscriptSummary } from "./types";
import { getRoundSignerKey } from "./identity";

/**
 * Extract transcript summary from a TranscriptV4.
 * 
 * @param transcript TranscriptV4
 * @returns Transcript summary
 */
export function extractTranscriptSummary(transcript: TranscriptV4): TranscriptSummary {
  // Extract buyer and seller IDs (using signer keys, not agent_id)
  const intentRound = transcript.rounds.find((r) => r.round_type === "INTENT");
  const buyerKey = intentRound ? getRoundSignerKey(intentRound) : null;
  
  // Find seller (first ASK, COUNTER, or ACCEPT from a different agent)
  const sellerRound = transcript.rounds.find(
    (r) => {
      const roundKey = getRoundSignerKey(r);
      return roundKey && roundKey !== buyerKey && 
             (r.round_type === "ASK" || r.round_type === "COUNTER" || r.round_type === "ACCEPT");
    }
  );
  const sellerKey = sellerRound ? getRoundSignerKey(sellerRound) : null;
  
  // Determine outcome
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
    // Check for ACCEPT round (success)
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
