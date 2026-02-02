/**
 * Pact v4 Transcript Replayer
 *
 * Self-contained implementation for the verifier package.
 * Validates signatures, verifies hash chains, and verifies transcript integrity.
 * Uses canonical_pure (no node:crypto at top level) so this module can load in browser
 * when sha256Async is provided; node:crypto is only loaded on the sync path (Node CLI).
 */

import bs58 from "bs58";
import nacl from "tweetnacl";
import { stableCanonicalize } from "./canonical_pure.js";
import type { TranscriptV4, Signature, ReplayResult } from "./transcript_types.js";

// Re-export types for consumers
export type { TranscriptV4, TranscriptRound, Signature, FailureEvent, ReplayResult } from "./transcript_types.js";

export type Sha256Async = (data: string) => Promise<string>;

/** Hex string to bytes (runtime-agnostic, no Buffer). */
function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Compute transcript hash (excluding final_hash field itself).
 * Canonical content hash; same semantics as SDK replay computeTranscriptHash.
 * Exported for Merkle digest (content-derived leaves) and other integrity use.
 * Uses dynamic import("node:crypto") so browser bundles do not pull in node:crypto at load time.
 */
export async function computeTranscriptHash(transcript: TranscriptV4): Promise<string> {
  const crypto = await import("node:crypto");
  const { final_hash, ...transcriptWithoutHash } = transcript;
  const canonical = stableCanonicalize(transcriptWithoutHash);
  const hash = crypto.createHash("sha256");
  hash.update(canonical, "utf8");
  return hash.digest("hex");
}

/**
 * Compute initial hash for round 0 (genesis hash).
 * Uses intent_id:created_at_ms format for deterministic genesis.
 *
 * NOTE: This MUST match the SDK's genesis.ts format exactly:
 * `${intent_id}:${created_at_ms}` (not canonical JSON)
 * Uses dynamic import("node:crypto") so browser bundles do not pull in node:crypto at load time.
 */
export async function computeInitialHash(intentId: string, createdAtMs: number): Promise<string> {
  const crypto = await import("node:crypto");
  const combined = `${intentId}:${createdAtMs}`;
  const hash = crypto.createHash("sha256");
  hash.update(combined, "utf8");
  return hash.digest("hex");
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
    const hashBytes = hexToBytes(envelopeHash);

    return nacl.sign.detached.verify(hashBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}

/**
 * Replay and verify a v4 transcript.
 * When options.sha256Async is provided (e.g. browser WebCrypto), hashing is async and Node crypto is not used.
 *
 * @param transcript - Transcript to verify
 * @param options - Optional sha256Async for browser/runtime-agnostic hashing
 * @returns ReplayResult with verification details
 */
export async function replayTranscriptV4(
  transcript: TranscriptV4,
  options?: { sha256Async?: Sha256Async }
): Promise<ReplayResult> {
  const result: ReplayResult = {
    ok: true,
    integrity_status: "VALID",
    errors: [],
    warnings: [],
    signature_verifications: 0,
    hash_chain_verifications: 0,
    rounds_verified: 0,
  };

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

  const sha256Async = options?.sha256Async;
  if (sha256Async) {
    return replayHashChainAsync(transcript, result, sha256Async);
  }

  // Sync path: load node:crypto only here so browser never pulls it in (viewer uses sha256Async path).
  const nodeCrypto = await import("node:crypto");
  const sha256Sync = (data: string): string => {
    const hash = nodeCrypto.createHash("sha256");
    hash.update(data, "utf8");
    return hash.digest("hex");
  };

  let previousHash: string | undefined = undefined;

  for (let i = 0; i < transcript.rounds.length; i++) {
    const round = transcript.rounds[i];
    const expectedPreviousHash =
      i === 0
        ? sha256Sync(`${transcript.intent_id}:${transcript.created_at_ms}`)
        : previousHash;

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

    const { round_hash: _r, ...roundWithoutHash } = round;
    const computedRoundHash = sha256Sync(stableCanonicalize(roundWithoutHash));
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

  if (transcript.final_hash) {
    const { final_hash: _f, ...transcriptWithoutHash } = transcript;
    const computedFinalHash = sha256Sync(stableCanonicalize(transcriptWithoutHash));
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

  if (transcript.failure_event) {
    const { failure_event, final_hash, ...transcriptUpToFailure } = transcript;
    const computedFailureHash = sha256Sync(stableCanonicalize(transcriptUpToFailure));
    if (transcript.failure_event.transcript_hash !== computedFailureHash) {
      result.warnings.push(
        `Claimed failure-event transcript_hash did not match computed transcript hash (claimed: ${transcript.failure_event.transcript_hash}, computed: ${computedFailureHash}).`
      );
    }
  }

  return result;
}

/** Async hash chain path (uses sha256Async; no Node crypto). */
async function replayHashChainAsync(
  transcript: TranscriptV4,
  result: ReplayResult,
  sha256Async: Sha256Async
): Promise<ReplayResult> {
  let previousHash: string | undefined = undefined;

  for (let i = 0; i < transcript.rounds.length; i++) {
    const round = transcript.rounds[i];
    const expectedPreviousHash =
      i === 0
        ? await sha256Async(`${transcript.intent_id}:${transcript.created_at_ms}`)
        : previousHash!;

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

    const { round_hash: _r, ...roundWithoutHash } = round;
    const computedRoundHash = await sha256Async(stableCanonicalize(roundWithoutHash));
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

  if (transcript.final_hash) {
    const { final_hash: _f, ...rest } = transcript;
    const computedFinalHash = await sha256Async(stableCanonicalize(rest));
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

  if (transcript.failure_event) {
    const { failure_event, final_hash, ...transcriptUpToFailure } = transcript;
    const computedFailureHash = await sha256Async(stableCanonicalize(transcriptUpToFailure));
    if (transcript.failure_event.transcript_hash !== computedFailureHash) {
      result.warnings.push(
        `Claimed failure-event transcript_hash did not match computed transcript hash (claimed: ${transcript.failure_event.transcript_hash}, computed: ${computedFailureHash}).`
      );
    }
  }

  return result;
}
