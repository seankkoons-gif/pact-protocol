/**
 * Pact v4 Transcript Types
 * 
 * Self-contained type definitions for the verifier package.
 * No external dependencies on @pact/sdk.
 */

/**
 * Signature embedded in a round
 */
export type Signature = {
  signer_public_key_b58: string;
  signature_b58: string;
  signed_at_ms?: number;
  signed_hash?: string;
  scheme?: "ed25519";
};

/**
 * A single round in a transcript
 */
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

/**
 * Failure event in a transcript
 */
export type FailureEvent = {
  code: string;
  stage: string;
  fault_domain: string;
  terminality: "terminal" | "non_terminal";
  evidence_refs: string[];
  timestamp: number;
  transcript_hash: string;
};

/**
 * Pact v4 Transcript
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

/**
 * Replay result from transcript verification
 */
export type ReplayResult = {
  ok: boolean;
  integrity_status: "VALID" | "TAMPERED" | "INVALID" | "PARTIAL";
  errors: Array<{
    type: "SIGNATURE_INVALID" | "HASH_CHAIN_BROKEN" | "FINAL_HASH_MISMATCH" | "TIMESTAMP_NON_MONOTONIC" | "ROUND_SEQUENCE_INVALID" | "INVALID_STRUCTURE";
    round_number?: number;
    message: string;
  }>;
  warnings: string[];
  signature_verifications: number;
  hash_chain_verifications: number;
  rounds_verified: number;
};
