/**
 * Narrative View Generator for Pact v4 Transcripts
 * 
 * Translates protocol rounds and failure events into plain English.
 */

import type { TranscriptRound, FailureEvent } from "./replay";

export type NarrativeRound = {
  round_number: number;
  round_type: string;
  narrative: string;
  timestamp: number;
  agent_id: string;
};

export type NarrativeFailure = {
  code: string;
  narrative: string;
  stage: string;
  fault_domain: string;
  terminality: string;
  evidence_refs: string[];
};

/**
 * Extract intent type from round content_summary or default.
 */
function getIntentType(round: TranscriptRound): string {
  if (round.content_summary && typeof round.content_summary.intent_type === "string") {
    return round.content_summary.intent_type;
  }
  return "unknown intent";
}

/**
 * Generate narrative for a single round.
 */
export function narrateRound(round: TranscriptRound): NarrativeRound {
  const timestamp = new Date(round.timestamp_ms).toISOString();
  
  let narrative = "";
  
  switch (round.round_type) {
    case "INTENT":
      narrative = `Buyer declares intent: "${round.agent_id}" initiated a negotiation for "${getIntentType(round)}" at ${timestamp}.`;
      break;
    case "ASK":
      narrative = `Seller asks: "${round.agent_id}" proposed a price via ASK message at ${timestamp}.`;
      break;
    case "BID":
      narrative = `Buyer bids: "${round.agent_id}" counter-proposed a price via BID message at ${timestamp}.`;
      break;
    case "COUNTER":
      narrative = `Counteroffer: "${round.agent_id}" made a counteroffer at ${timestamp}.`;
      break;
    case "ACCEPT":
      narrative = `Acceptance: "${round.agent_id}" accepted the negotiation terms at ${timestamp}. Negotiation completed successfully.`;
      break;
    case "REJECT":
      narrative = `Rejection: "${round.agent_id}" rejected the negotiation at ${timestamp}. Negotiation terminated.`;
      break;
    case "ABORT":
      narrative = `Abort: "${round.agent_id}" aborted the negotiation at ${timestamp}. Negotiation terminated.`;
      break;
    default:
      narrative = `Unknown round type: "${round.round_type}" from agent "${round.agent_id}" at ${timestamp}.`;
  }

  return {
    round_number: round.round_number,
    round_type: round.round_type,
    narrative,
    timestamp: round.timestamp_ms,
    agent_id: round.agent_id,
  };
}

/**
 * Generate narrative for a failure event.
 */
export function narrateFailure(failure: FailureEvent): NarrativeFailure {
  const stageDescriptions: Record<string, string> = {
    admission: "during admission checks",
    discovery: "during provider discovery",
    negotiation: "during price negotiation",
    commitment: "during commitment phase",
    reveal: "during reveal phase",
    settlement: "during settlement execution",
    fulfillment: "during service fulfillment",
    verification: "during verification checks",
  };

  const faultDomainDescriptions: Record<string, string> = {
    policy: "Policy constraint violation",
    identity: "Identity verification failure",
    negotiation: "Negotiation protocol failure",
    settlement: "Settlement rail failure",
    recursive: "Dependency or recursive failure",
    PROVIDER_AT_FAULT: "Provider at fault",
  };

  const stageDesc = stageDescriptions[failure.stage] || failure.stage;
  const faultDesc = faultDomainDescriptions[failure.fault_domain] || failure.fault_domain;
  const terminalityDesc = failure.terminality === "terminal" ? "terminal" : "non-terminal (retry possible)";

  // Special handling for provider unreachable (PACT-420)
  let narrative = "";
  if (failure.code === "PACT-420" && (failure.stage === "negotiation" || failure.fault_domain === "PROVIDER_AT_FAULT")) {
    narrative = "Provider unreachable during quote request. ";
    narrative += `Error code: ${failure.code}. `;
    narrative += `This is a ${terminalityDesc} failure. `;
  } else if (failure.code === "PACT-421" && (failure.stage === "negotiation" || failure.fault_domain === "PROVIDER_AT_FAULT")) {
    // Special handling for provider API mismatch (PACT-421)
    narrative = "Provider API mismatch (endpoint not found). ";
    narrative += `Error code: ${failure.code}. `;
    narrative += `This is a ${terminalityDesc} failure. `;
  } else {
    narrative = `${faultDesc} detected ${stageDesc}. `;
    narrative += `Error code: ${failure.code}. `;
    narrative += `This is a ${terminalityDesc} failure. `;
  }
  
  if (failure.evidence_refs.length > 0) {
    narrative += `Evidence references: ${failure.evidence_refs.length} artifact(s).`;
  }

  return {
    code: failure.code,
    narrative,
    stage: failure.stage,
    fault_domain: failure.fault_domain,
    terminality: failure.terminality,
    evidence_refs: failure.evidence_refs,
  };
}
