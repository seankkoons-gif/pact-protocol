/**
 * Passport v4 Types
 * 
 * Type definitions for Passport storage and ingestion.
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
  metadata?: Record<string, unknown>;
};

export type TranscriptRound = {
  round_number: number;
  round_type: "INTENT" | "ASK" | "BID" | "COUNTER" | "ACCEPT" | "REJECT" | "ABORT";
  message_hash: string;
  envelope_hash: string;
  signature: {
    signer_public_key_b58: string;
    signature_b58: string;
    signed_at_ms: number;
    scheme?: "ed25519";
  };
  timestamp_ms: number;
  previous_round_hash: string;
  round_hash?: string;
  agent_id: string;
  public_key_b58: string;
  content_summary?: Record<string, unknown>;
};

export type FailureEvent = {
  code: string;
  stage: string;
  fault_domain: string;
  terminality: "terminal" | "non_terminal";
  evidence_refs: string[];
  timestamp: number;
  transcript_hash: string;
};

export type PassportEventType = "settlement_success" | "settlement_failure" | "dispute_resolved";

export type PassportEvent = {
  id: number;
  agent_id: string;
  event_type: PassportEventType;
  ts: number;
  transcript_hash: string;
  counterparty_agent_id: string | null;
  value_usd: number | null;
  failure_code: string | null;
  stage: string | null;
  fault_domain: string | null;
  terminality: "terminal" | "non_terminal" | null;
  dispute_outcome: string | null;
  metadata_json: string | null;
};

export type PassportScore = {
  agent_id: string;
  computed_at: number;
  score: number;
  confidence: number;
  breakdown_json: string;
};
