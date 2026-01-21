/**
 * Pact v4 Transcript Replayer
 * 
 * Validates signatures, verifies hash chains, and renders human-readable replay output.
 * Designed for legal admissibility and deterministic verification.
 */

import * as crypto from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { stableCanonicalize } from "../../protocol/canonical";
import { computeInitialHash } from "./genesis";

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
  arbiter_decision_ref?: string | null; // Decision artifact hash (added after arbitration)
  metadata?: Record<string, unknown> & {
    // Optional contention fields (see PACT_CONSTITUTION_V1.md Section 6)
    contention_key?: string; // hash(intent_type, resource_id, scope, time_window)
    contention_scope?: "EXCLUSIVE" | "NON_EXCLUSIVE";
    contention_window_ms?: number; // Claim window for exclusivity
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
    // Optional contention fields (see PACT_CONSTITUTION_V1.md Section 6)
    contention_key?: string; // hash(intent_type, resource_id, scope, time_window)
    contention_scope?: "EXCLUSIVE" | "NON_EXCLUSIVE";
    contention_window_ms?: number; // Claim window for exclusivity
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
};

export type ReplayResult = {
  ok: boolean;
  integrity_status: "VALID" | "TAMPERED" | "INVALID";
  errors: Array<{
    type: "SIGNATURE_INVALID" | "HASH_CHAIN_BROKEN" | "FINAL_HASH_MISMATCH" | "TIMESTAMP_NON_MONOTONIC" | "ROUND_SEQUENCE_INVALID";
    round_number?: number;
    message: string;
  }>;
  warnings: string[];
  signature_verifications: number;
  hash_chain_verifications: number;
  rounds_verified: number;
};

/**
 * Compute SHA-256 hash of canonical JSON serialization.
 */
function sha256(canonical: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(canonical, "utf8");
  return hash.digest("hex");
}

/**
 * Compute round hash (excluding round_hash field itself).
 */
function computeRoundHash(round: TranscriptRound): string {
  const { round_hash, ...roundWithoutHash } = round;
  const canonical = stableCanonicalize(roundWithoutHash);
  return sha256(canonical);
}

/**
 * Compute transcript hash (excluding final_hash field itself).
 */
function computeTranscriptHash(transcript: TranscriptV4): string {
  const { final_hash, ...transcriptWithoutHash } = transcript;
  const canonical = stableCanonicalize(transcriptWithoutHash);
  return sha256(canonical);
}

/**
 * Compute previous round hash for round 0 (uses intent_id + created_at_ms).
 * This is the canonical genesis hash for v4 transcripts.
 * 
 * @deprecated Import from "./genesis" instead. This export is maintained for backward compatibility.
 */
export { computeInitialHash } from "./genesis";

/**
 * Verify Ed25519 signature over envelope hash.
 */
function verifySignature(
  envelopeHash: string,
  signature: Signature,
  publicKeyB58: string
): boolean {
  try {
    if (signature.scheme && signature.scheme !== "ed25519") {
      return false;
    }

    if (signature.signer_public_key_b58 !== publicKeyB58) {
      return false;
    }

    const pubBytes = bs58.decode(publicKeyB58);
    const sigBytes = bs58.decode(signature.signature_b58);
    const hashBytes = Buffer.from(envelopeHash, "hex");

    return nacl.sign.detached.verify(hashBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}

/**
 * Replay and verify a v4 transcript.
 */
export async function replayTranscriptV4(transcript: TranscriptV4): Promise<ReplayResult> {
  const result: ReplayResult = {
    ok: true,
    integrity_status: "VALID",
    errors: [],
    warnings: [],
    signature_verifications: 0,
    hash_chain_verifications: 0,
    rounds_verified: 0,
  };

  // Validate basic structure
  if (transcript.transcript_version !== "pact-transcript/4.0") {
    result.ok = false;
    result.integrity_status = "INVALID";
    result.errors.push({
      type: "ROUND_SEQUENCE_INVALID",
      message: `Invalid transcript version: ${transcript.transcript_version}`,
    });
    return result;
  }

  if (transcript.rounds.length === 0) {
    result.ok = false;
    result.integrity_status = "INVALID";
    result.errors.push({
      type: "ROUND_SEQUENCE_INVALID",
      message: "Transcript has no rounds",
    });
    return result;
  }

  // Verify round sequence
  for (let i = 0; i < transcript.rounds.length; i++) {
    if (transcript.rounds[i].round_number !== i) {
      result.ok = false;
      result.integrity_status = "TAMPERED";
      result.errors.push({
        type: "ROUND_SEQUENCE_INVALID",
        round_number: i,
        message: `Round sequence invalid: expected round_number ${i}, got ${transcript.rounds[i].round_number}`,
      });
      return result; // Critical: halt on sequence error
    }
  }

  // Verify timestamp monotonicity
  for (let i = 1; i < transcript.rounds.length; i++) {
    if (transcript.rounds[i].timestamp_ms < transcript.rounds[i - 1].timestamp_ms) {
      result.ok = false;
      result.integrity_status = "TAMPERED";
      result.errors.push({
        type: "TIMESTAMP_NON_MONOTONIC",
        round_number: i,
        message: `Timestamp non-monotonic: round ${i} timestamp (${transcript.rounds[i].timestamp_ms}) < round ${i - 1} timestamp (${transcript.rounds[i - 1].timestamp_ms})`,
      });
      return result; // Critical: halt on timestamp violation
    }
  }

  // Verify hash chain
  let previousHash: string | undefined = undefined;

  for (let i = 0; i < transcript.rounds.length; i++) {
    const round = transcript.rounds[i];

    // Compute expected previous_round_hash
    const expectedPreviousHash =
      i === 0
        ? computeInitialHash(transcript.intent_id, transcript.created_at_ms)
        : previousHash;

    // Verify previous_round_hash
    if (round.previous_round_hash !== expectedPreviousHash) {
      result.ok = false;
      result.integrity_status = "TAMPERED";
      result.errors.push({
        type: "HASH_CHAIN_BROKEN",
        round_number: i,
        message: `Hash chain broken at round ${i}: expected previous_round_hash ${expectedPreviousHash}, got ${round.previous_round_hash}`,
      });
      return result; // Critical: halt on hash chain break
    }

    // Compute and verify round_hash
    const computedRoundHash = computeRoundHash(round);
    if (round.round_hash) {
      if (round.round_hash !== computedRoundHash) {
        result.ok = false;
        result.integrity_status = "TAMPERED";
        result.errors.push({
          type: "HASH_CHAIN_BROKEN",
          round_number: i,
          message: `Round hash mismatch at round ${i}: expected ${computedRoundHash}, got ${round.round_hash}`,
        });
        return result; // Critical: halt on round hash mismatch
      }
      result.hash_chain_verifications++;
    }

    // Verify signature
    const signatureValid = verifySignature(round.envelope_hash, round.signature, round.public_key_b58);
    if (!signatureValid) {
      result.ok = false;
      result.integrity_status = "TAMPERED";
      result.errors.push({
        type: "SIGNATURE_INVALID",
        round_number: i,
        message: `Signature verification failed for round ${i} (${round.round_type})`,
      });
      return result; // Critical: halt on signature failure
    }
    result.signature_verifications++;

    previousHash = round.round_hash || computedRoundHash;
    result.rounds_verified++;
  }

  // Verify final_hash if present
  if (transcript.final_hash) {
    const computedFinalHash = computeTranscriptHash(transcript);
    if (transcript.final_hash !== computedFinalHash) {
      result.ok = false;
      result.integrity_status = "TAMPERED";
      result.errors.push({
        type: "FINAL_HASH_MISMATCH",
        message: `Final hash mismatch: expected ${computedFinalHash}, got ${transcript.final_hash}`,
      });
      return result; // Critical: halt on final hash mismatch
    }
  }

  // Verify failure_event transcript_hash if present
  if (transcript.failure_event) {
    // Compute transcript hash up to failure point
    // For MVP, we'll compute hash of transcript excluding failure_event and final_hash
    const { failure_event, final_hash, ...transcriptUpToFailure } = transcript;
    const computedFailureHash = sha256(stableCanonicalize(transcriptUpToFailure));

    if (transcript.failure_event.transcript_hash !== computedFailureHash) {
      result.warnings.push(
        `Failure event transcript_hash mismatch: expected ${computedFailureHash}, got ${transcript.failure_event.transcript_hash}`
      );
    }
  }

  return result;
}
