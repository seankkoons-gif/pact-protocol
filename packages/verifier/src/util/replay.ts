/**
 * Pact v4 Transcript Replayer
 * 
 * Self-contained implementation for the verifier package.
 * Validates signatures, verifies hash chains, and verifies transcript integrity.
 */

import * as crypto from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { stableCanonicalize } from "./canonical.js";
import type { TranscriptV4, TranscriptRound, Signature, ReplayResult } from "./transcript_types.js";

// Re-export types for consumers
export type { TranscriptV4, TranscriptRound, Signature, FailureEvent, ReplayResult } from "./transcript_types.js";

/**
 * Compute SHA-256 hash of a string.
 */
function sha256(data: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(data, "utf8");
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
 * Compute initial hash for round 0 (genesis hash).
 * Uses intent_id:created_at_ms format for deterministic genesis.
 * 
 * NOTE: This MUST match the SDK's genesis.ts format exactly:
 * `${intent_id}:${created_at_ms}` (not canonical JSON)
 */
export function computeInitialHash(intentId: string, createdAtMs: number): string {
  const combined = `${intentId}:${createdAtMs}`;
  return sha256(combined);
}

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
 * 
 * Validates:
 * - Transcript structure
 * - Round sequence
 * - Timestamp monotonicity
 * - Hash chain integrity
 * - Ed25519 signatures
 * - Final hash (if present)
 * 
 * @param transcript - Transcript to verify
 * @returns ReplayResult with verification details
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

  if (!transcript.rounds || transcript.rounds.length === 0) {
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
      return result;
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
      return result;
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
      return result;
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
        return result;
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
      return result;
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
      return result;
    }
  }

  // Verify failure_event transcript_hash if present
  if (transcript.failure_event) {
    const { failure_event, final_hash, ...transcriptUpToFailure } = transcript;
    const computedFailureHash = sha256(stableCanonicalize(transcriptUpToFailure));

    if (transcript.failure_event.transcript_hash !== computedFailureHash) {
      result.warnings.push(
        `Claimed failure-event transcript_hash did not match computed transcript hash (claimed: ${transcript.failure_event.transcript_hash}, computed: ${computedFailureHash}).`
      );
    }
  }

  return result;
}
