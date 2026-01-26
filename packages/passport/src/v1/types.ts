/**
 * Passport v1 Types
 * 
 * Deterministic, replayable scoring module that updates ONLY from transcript + evidence + DBL outcomes.
 * No wall-clock randomness, no Date.now(), no network calls.
 */

// Local type definitions to avoid cross-package imports
// These are compatible with the canonical types from @pact/sdk and @pact/verifier

/**
 * TranscriptV4 - Compatible with @pact/sdk TranscriptV4
 */
export type TranscriptV4 = {
  transcript_version: "pact-transcript/4.0";
  transcript_id: string;
  intent_id: string;
  intent_type: string;
  created_at_ms: number;
  policy_hash: string;
  strategy_hash: string;
  identity_snapshot_hash: string;
  rounds: TranscriptRound[];
  failure_event?: FailureEvent;
  final_hash?: string;
  arbiter_decision_ref?: string | null;
  metadata?: Record<string, unknown> & {
    contention_key?: string;
    contention_scope?: "EXCLUSIVE" | "NON_EXCLUSIVE";
    contention_window_ms?: number;
  };
};

export type TranscriptRound = {
  round_number: number;
  round_type: "INTENT" | "ASK" | "BID" | "COUNTER" | "ACCEPT" | "REJECT" | "ABORT";
  message_hash: string;
  envelope_hash: string;
  signature: Signature;
  timestamp_ms: number;
  previous_round_hash: string;
  round_hash?: string;
  agent_id: string;
  public_key_b58: string;
  content_summary?: Record<string, unknown> & {
    contention_key?: string;
    contention_scope?: "EXCLUSIVE" | "NON_EXCLUSIVE";
    contention_window_ms?: number;
  };
};

export type Signature = {
  signer_public_key_b58: string;
  signature_b58: string;
  signed_at_ms: number;
  scheme?: "ed25519";
};

export type FailureEvent = {
  code: string;
  stage: string;
  fault_domain: string;
  terminality: "terminal" | "non_terminal";
  evidence_refs: string[];
  timestamp: number;
  transcript_hash: string;
  message?: string;
};

/**
 * JudgmentArtifact - DBL v2 judgment output (compatible with @pact/verifier)
 */
export type JudgmentArtifact = {
  version: "dbl/2.0";
  status: "OK" | "FAILED" | "INDETERMINATE";
  failureCode: string | null;
  lastValidRound: number;
  lastValidSummary: string;
  lastValidHash: string;
  requiredNextActor: "BUYER" | "PROVIDER" | "RAIL" | "SETTLEMENT" | "ARBITER" | "NONE";
  requiredAction: string;
  terminal: boolean;
  dblDetermination:
    | "NO_FAULT"
    | "BUYER_AT_FAULT"
    | "PROVIDER_AT_FAULT"
    | "BUYER_RAIL_AT_FAULT"
    | "PROVIDER_RAIL_AT_FAULT"
    | "INDETERMINATE";
  passportImpact: number;
  confidence: number;
  recommendation: string;
  evidenceRefs: string[];
  claimedEvidenceRefs?: string[];
  notes?: string;
  recommendedActions?: Array<{
    action: string;
    target: "BUYER" | "PROVIDER" | "RAIL" | "SYSTEM";
    reason: string;
    evidenceRefs: string[];
    claimedEvidenceRefs?: string[];
  }>;
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
  score_delta: number; // Change to score (can be negative)
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
 * Transcript summary extracted from a v4 transcript
 */
export type TranscriptSummary = {
  transcript_id: string;
  intent_id: string;
  created_at_ms: number;
  outcome: "success" | "abort" | "timeout" | "dispute" | "failure";
  failure_code?: string; // PACT-xxx code if applicable
  failure_stage?: string; // Stage where failure occurred
  failure_fault_domain?: string; // Fault domain from failure_event
  buyer_id: string;
  seller_id: string;
  // For dispute outcomes
  dispute_result?: "buyer_wins" | "seller_wins" | "dismissed" | "split";
};

/**
 * PassportInputs - Inputs to computePassportDelta
 */
export type PassportInputs = {
  transcript_summary: TranscriptSummary;
  dbl_judgment: JudgmentArtifact | null; // DBL judgment if available
  agent_id: string; // The agent whose passport is being updated
};
