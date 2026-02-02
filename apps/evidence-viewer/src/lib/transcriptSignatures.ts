/**
 * Signature counts from input/transcript.json only.
 * Do not rely on derived/judgment JSON.
 * totalCount = rounds that include signature.signature_b58.
 * verifiedCount = those where nacl.sign.detached.verify(envelope_hash_bytes, sig_bytes, pubkey_bytes) is true.
 */

import bs58 from 'bs58';
import nacl from 'tweetnacl';

/** Minimal round shape from transcript v4 (only what we need for signature verification). */
interface RoundWithSignature {
  round_number?: number;
  round_type?: string;
  envelope_hash?: string;
  public_key_b58?: string;
  signature?: {
    signature_b58?: string;
    signer_public_key_b58?: string;
    scheme?: string;
  };
}

export interface TranscriptLike {
  rounds?: RoundWithSignature[];
}

export interface SignatureCounts {
  totalCount: number;
  verifiedCount: number;
  status: 'VALID' | 'INVALID' | 'UNAVAILABLE';
  failures: string[];
}

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function verifyOne(
  envelopeHash: string,
  signatureB58: string,
  publicKeyB58: string,
  scheme?: string
): boolean {
  try {
    if (scheme && scheme !== 'ed25519') return false;
    const pubBytes = bs58.decode(publicKeyB58);
    const sigBytes = bs58.decode(signatureB58);
    const hashBytes = hexToBytes(envelopeHash);
    return nacl.sign.detached.verify(hashBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}

/**
 * Parse input/transcript.json rounds and compute signature counts.
 * - totalCount = count of rounds that include signature.signature_b58.
 * - verifiedCount = count where nacl.sign.detached.verify(envelope_hash, sig, pubkey) returns true.
 * - If transcript is missing or no signatures exist, status is UNAVAILABLE.
 */
export function computeSignatureCounts(transcriptJson: TranscriptLike | null | undefined): SignatureCounts {
  const failures: string[] = [];
  if (transcriptJson == null || !Array.isArray(transcriptJson.rounds) || transcriptJson.rounds.length === 0) {
    return { totalCount: 0, verifiedCount: 0, status: 'UNAVAILABLE', failures };
  }

  const rounds = transcriptJson.rounds as RoundWithSignature[];
  let totalCount = 0;
  let verifiedCount = 0;

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    const sigB58 = round?.signature?.signature_b58;
    if (!sigB58) continue;

    totalCount++;
    const envelopeHash = round.envelope_hash;
    const pubKeyB58 = round.signature?.signer_public_key_b58 ?? round.public_key_b58;
    const scheme = round.signature?.scheme;

    if (!envelopeHash || !pubKeyB58) {
      failures.push(`Round ${round.round_number ?? i}: missing envelope_hash or public key`);
      continue;
    }

    if (verifyOne(envelopeHash, sigB58, pubKeyB58, scheme)) {
      verifiedCount++;
    } else {
      failures.push(`Round ${round.round_number ?? i} (${round.round_type ?? '?'}): signature verification failed`);
    }
  }

  if (totalCount === 0) {
    return { totalCount: 0, verifiedCount: 0, status: 'UNAVAILABLE', failures };
  }
  if (verifiedCount === totalCount) {
    return { totalCount, verifiedCount, status: 'VALID', failures };
  }
  return { totalCount, verifiedCount, status: 'INVALID', failures };
}
