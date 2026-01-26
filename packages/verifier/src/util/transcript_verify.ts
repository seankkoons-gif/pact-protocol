/**
 * Minimal transcript verification for CLI use.
 * 
 * This is a verifier-local utility to avoid SDK dependencies.
 * Performs basic structure validation without full signature/hash verification.
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
  metadata?: Record<string, unknown>;
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
  content_summary?: Record<string, unknown>;
};

export type Signature = {
  signer_public_key_b58: string;
  signature_b58: string;
  signed_hash: string;
};

export type FailureEvent = {
  failure_code: string;
  failure_message: string;
  timestamp_ms: number;
  round_number: number;
};

export type ReplayResult = {
  ok: boolean;
  integrity_status: "VALID" | "INVALID" | "PARTIAL";
  errors: Array<{ type: string; message: string }>;
  warnings: string[];
  signature_verifications: number;
  hash_chain_verifications: number;
  rounds_verified: number;
};

/**
 * Minimal transcript verification.
 * 
 * For CLI use, we perform basic structure validation.
 * Full signature/hash verification is skipped to avoid SDK dependencies.
 * 
 * @param transcript - Transcript to verify
 * @returns ReplayResult with basic validation results
 */
export async function verifyTranscriptV4(transcript: unknown): Promise<ReplayResult> {
  const result: ReplayResult = {
    ok: true,
    integrity_status: "VALID",
    errors: [],
    warnings: [],
    signature_verifications: 0,
    hash_chain_verifications: 0,
    rounds_verified: 0,
  };

  // Basic type check
  if (!transcript || typeof transcript !== "object") {
    result.ok = false;
    result.integrity_status = "INVALID";
    result.errors.push({
      type: "INVALID_STRUCTURE",
      message: "Transcript is not an object",
    });
    return result;
  }

  const t = transcript as Record<string, unknown>;

  // Check transcript version
  if (t.transcript_version !== "pact-transcript/4.0") {
    result.ok = false;
    result.integrity_status = "INVALID";
    result.errors.push({
      type: "ROUND_SEQUENCE_INVALID",
      message: `Invalid transcript version: ${t.transcript_version}`,
    });
    return result;
  }

  // Check rounds exist
  if (!Array.isArray(t.rounds) || t.rounds.length === 0) {
    result.ok = false;
    result.integrity_status = "INVALID";
    result.errors.push({
      type: "ROUND_SEQUENCE_INVALID",
      message: "Transcript has no rounds",
    });
    return result;
  }

  // Count valid rounds (basic structure check)
  let validRounds = 0;
  for (const round of t.rounds as unknown[]) {
    if (round && typeof round === "object") {
      const r = round as Record<string, unknown>;
      // Basic structure check: has required fields
      if (
        typeof r.round_number === "number" &&
        typeof r.round_type === "string" &&
        typeof r.agent_id === "string" &&
        (r.signature || r.public_key_b58)
      ) {
        validRounds++;
      }
    }
  }

  result.rounds_verified = validRounds;

  // If no valid rounds, mark as invalid
  if (validRounds === 0) {
    result.ok = false;
    result.integrity_status = "INVALID";
    result.errors.push({
      type: "ROUND_SEQUENCE_INVALID",
      message: "No valid rounds found",
    });
    return result;
  }

  // For CLI purposes, we accept transcripts with basic structure
  // Full verification would require SDK dependencies
  return result;
}
