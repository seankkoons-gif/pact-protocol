/**
 * Client-side pack integrity from transcript, allFilesMap, and optional checksums.
 *
 * IntegrityResult: status (VALID | TAMPERED | INDETERMINATE), checksums, hashChain, signatures, warnings.
 *
 * Rules:
 * - Any checksums mismatch => status TAMPERED
 * - Any hash chain invalid (broken link) => status TAMPERED
 * - Any signature invalid => status TAMPERED
 * - Transcript missing/parse error => status INDETERMINATE
 * - Missing checksums file => checksums.status UNAVAILABLE (does not force INDETERMINATE)
 *
 * Claimed-vs-computed mismatches (e.g. round_hash, final_hash, failure_event.transcript_hash) are warnings only; never tamper if recompute passes.
 */

import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type { IntegrityResult } from '../types';

/** Minimal v4 transcript shape for verification. */
interface TranscriptV4Like {
  transcript_version?: string;
  intent_id: string;
  created_at_ms: number;
  rounds: TranscriptRoundLike[];
  final_hash?: string;
  failure_event?: { transcript_hash?: string };
}

interface TranscriptRoundLike {
  round_number: number;
  round_type: string;
  envelope_hash: string;
  previous_round_hash: string;
  round_hash?: string;
  public_key_b58?: string;
  signature?: {
    signer_public_key_b58?: string;
    signature_b58?: string;
    scheme?: string;
  };
}

/** Canonical JSON (pure JS, no Node). Sorts keys; no whitespace. */
function stableCanonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean')
    return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    const items = obj.map((item) => stableCanonicalize(item));
    return `[${items.join(',')}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((key) => {
      const value = (obj as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${stableCanonicalize(value)}`;
    });
    return `{${pairs.join(',')}}`;
  }
  return JSON.stringify(obj);
}

/**
 * Browser SHA-256: digest bytes with WebCrypto, return hex.
 * Used for checksums (file bytes from unzip) and transcript hash chain.
 */
async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Genesis hash for round 0: SHA-256(intent_id:created_at_ms). */
async function computeInitialHash(intentId: string, createdAtMs: number): Promise<string> {
  const combined = `${intentId}:${createdAtMs}`;
  return sha256Hex(combined);
}

/** Round hash (excluding round_hash field). */
async function computeRoundHash(round: TranscriptRoundLike): Promise<string> {
  const { round_hash: _r, ...rest } = round;
  return sha256Hex(stableCanonicalize(rest));
}

/** Transcript hash (excluding final_hash). */
async function computeTranscriptHash(transcript: TranscriptV4Like): Promise<string> {
  const { final_hash: _f, ...rest } = transcript;
  return sha256Hex(stableCanonicalize(rest));
}

/** Result of hash chain verification. INVALID only when links are broken; claimed-vs-computed mismatches are in claimedMismatches. */
interface HashChainResult {
  status: 'VALID' | 'INVALID';
  details?: string;
  claimedMismatches: string[];
}

/** Verify hash chain. INVALID only when previous_round_hash link is broken; claimed round_hash/final_hash mismatches are warnings only. */
async function verifyHashChain(transcript: TranscriptV4Like): Promise<HashChainResult> {
  const claimedMismatches: string[] = [];
  if (transcript.transcript_version !== 'pact-transcript/4.0') {
    return {
      status: 'INVALID',
      details: `Invalid transcript version: ${String(transcript.transcript_version)}`,
      claimedMismatches: [],
    };
  }
  const rounds = transcript.rounds ?? [];
  if (rounds.length === 0) {
    return { status: 'INVALID', details: 'Transcript has no rounds', claimedMismatches: [] };
  }

  let previousHash: string | undefined;

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    const expectedPrevious =
      i === 0
        ? await computeInitialHash(transcript.intent_id, transcript.created_at_ms)
        : previousHash!;

    if (round.previous_round_hash !== expectedPrevious) {
      return {
        status: 'INVALID',
        details: `Hash chain broken at round ${i}: previous_round_hash mismatch (expected ${expectedPrevious.slice(0, 16)}..., got ${round.previous_round_hash?.slice(0, 16)}...)`,
        claimedMismatches: [],
      };
    }

    const computedRoundHash = await computeRoundHash(round);
    if (round.round_hash != null && round.round_hash !== computedRoundHash) {
      claimedMismatches.push(`Round ${i}: claimed round_hash does not match computed`);
    }
    previousHash = round.round_hash ?? computedRoundHash;
  }

  if (transcript.final_hash != null) {
    const computedFinal = await computeTranscriptHash(transcript);
    if (transcript.final_hash !== computedFinal) {
      claimedMismatches.push('Claimed final_hash does not match computed transcript hash');
    }
  }

  return { status: 'VALID', claimedMismatches };
}

/** Verify Ed25519 over hexToBytes(envelope_hash) using tweetnacl + bs58. */
function verifySignature(
  envelopeHashHex: string,
  signatureB58: string,
  publicKeyB58: string
): boolean {
  try {
    const hashBytes = hexToBytes(envelopeHashHex);
    const sigBytes = bs58.decode(signatureB58);
    const pubBytes = bs58.decode(publicKeyB58);
    return nacl.sign.detached.verify(hashBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Verify Ed25519 signatures: pub key = round.public_key_b58 ?? round.signature?.signer_public_key_b58, sig = round.signature?.signature_b58. */
function verifySignatures(transcript: TranscriptV4Like): {
  status: 'VALID' | 'INVALID' | 'UNVERIFIABLE';
  verifiedCount: number;
  totalCount: number;
  failures: string[];
} {
  const rounds = transcript.rounds ?? [];
  const failures: string[] = [];
  let verified = 0;

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    const pub = round.public_key_b58 ?? round.signature?.signer_public_key_b58;
    const sigB58 = round.signature?.signature_b58;
    const envelopeHash = round.envelope_hash;

    if (!pub || !sigB58 || !envelopeHash) {
      failures.push(`Round ${i}: unverifiable (missing key or signature)`);
      continue;
    }
    if (round.signature?.scheme && round.signature.scheme !== 'ed25519') {
      failures.push(`Round ${i}: unsupported scheme ${round.signature.scheme}`);
      continue;
    }
    const ok = verifySignature(envelopeHash, sigB58, pub);
    if (ok) {
      verified++;
    } else {
      failures.push(`Round ${i} (${round.round_type}): signature verification failed`);
    }
  }

  const totalCount = rounds.length;
  if (totalCount === 0) {
    return { status: 'UNVERIFIABLE', verifiedCount: 0, totalCount: 0, failures: ['No rounds'] };
  }
  if (failures.length === totalCount && failures.every((f) => f.includes('unverifiable'))) {
    return { status: 'UNVERIFIABLE', verifiedCount: 0, totalCount, failures };
  }
  if (verified === totalCount) {
    return { status: 'VALID', verifiedCount: verified, totalCount, failures: [] };
  }
  return { status: 'INVALID', verifiedCount: verified, totalCount, failures };
}

/**
 * Checksums verification: parse checksums.sha256 lines "<hex>  <path>" (1+ spaces).
 * For each listed path that exists in allFilesMap, compute SHA-256 with crypto.subtle.digest and compare.
 * If a listed path does not exist in the pack, add a failure entry.
 */
async function verifyChecksums(
  allFilesMap: Map<string, ArrayBuffer>,
  checksumsText: string | null
): Promise<{
  status: 'VALID' | 'INVALID' | 'UNAVAILABLE';
  checkedCount: number;
  totalCount: number;
  failures: string[];
}> {
  if (checksumsText == null || checksumsText.trim() === '') {
    return { status: 'UNAVAILABLE', checkedCount: 0, totalCount: 0, failures: [] };
  }

  const lines = checksumsText.trim().split('\n').filter((l) => l.length > 0);
  const failures: string[] = [];
  let checkedCount = 0;

  for (const line of lines) {
    // <hex>  <path>: 64 hex chars then 1+ spaces then path
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
    if (!match) {
      failures.push(`Invalid checksum line: ${line}`);
      continue;
    }
    const [, expectedHash, pathRest] = match;
    const relativePath = pathRest.trim();
    const buf = allFilesMap.get(relativePath);
    if (buf == null) {
      failures.push(`File in checksums not found in pack: ${relativePath}`);
      continue;
    }
    const bytes = new Uint8Array(buf);
    const actualHash = await sha256Hex(bytes);
    checkedCount++;
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      failures.push(`Checksum mismatch for ${relativePath}`);
    }
  }

  const totalCount = lines.length;
  if (failures.length > 0) {
    return { status: 'INVALID', checkedCount, totalCount, failures };
  }
  return { status: 'VALID', checkedCount, totalCount, failures: [] };
}

/** Arguments for computePackIntegrity. */
export interface ComputePackIntegrityArgs {
  transcript: unknown;
  allFilesMap: Map<string, ArrayBuffer>;
  checksumsText: string | null;
}

const VALID_STATUSES: Array<IntegrityResult['status']> = ['VALID', 'TAMPERED', 'INDETERMINATE'];

function fullIndeterminateResult(warnings: string[]): IntegrityResult {
  return {
    status: 'INDETERMINATE',
    checksums: { status: 'UNAVAILABLE', checkedCount: 0, totalCount: 0, failures: [] },
    hashChain: { status: 'INVALID', details: 'Integrity computation failed' },
    signatures: { status: 'UNVERIFIABLE', verifiedCount: 0, totalCount: 0, failures: [] },
    warnings,
  };
}

/**
 * Compute pack integrity from transcript, allFilesMap, and optional checksums.
 * Always returns a full IntegrityResult (never throws). Exceptions are turned into INDETERMINATE + warning.
 */
export async function computePackIntegrity(args: ComputePackIntegrityArgs): Promise<IntegrityResult> {
  const { transcript: transcriptObj, allFilesMap, checksumsText } = args;
  const warnings: string[] = [];
  const transcript = transcriptObj as TranscriptV4Like;

  if (!transcript?.rounds?.length) {
    return fullIndeterminateResult(['Transcript missing or has no rounds.']);
  }

  let hashChainResult: HashChainResult;
  let checksumsResult: { status: 'VALID' | 'INVALID' | 'UNAVAILABLE'; checkedCount: number; totalCount: number; failures: string[] };
  let signaturesResult: { status: 'VALID' | 'INVALID' | 'UNVERIFIABLE'; verifiedCount: number; totalCount: number; failures: string[] };

  try {
    [hashChainResult, checksumsResult] = await Promise.all([
      verifyHashChain(transcript),
      verifyChecksums(allFilesMap, checksumsText),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`Hash chain or checksums verification failed: ${msg}`);
    return fullIndeterminateResult(warnings);
  }

  try {
    signaturesResult = verifySignatures(transcript);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`Signatures verification failed: ${msg}`);
    return fullIndeterminateResult(warnings);
  }

  warnings.push(...hashChainResult.claimedMismatches);

  try {
    if (transcript.failure_event?.transcript_hash && hashChainResult.status === 'VALID') {
      const { failure_event, final_hash: _f, ...upToFailure } = transcript;
      const computedFailureHash = await sha256Hex(stableCanonicalize(upToFailure));
      if (transcript.failure_event.transcript_hash !== computedFailureHash) {
        warnings.push(
          `Claimed failure-event transcript_hash does not match computed (claimed: ${transcript.failure_event.transcript_hash.substring(0, 16)}..., computed: ${computedFailureHash.substring(0, 16)}...)`
        );
      }
    }
  } catch {
    // Non-fatal; skip this warning
  }

  let status: IntegrityResult['status'];
  if (checksumsResult.status === 'INVALID') status = 'TAMPERED';
  else if (hashChainResult.status === 'INVALID') status = 'TAMPERED';
  else if (signaturesResult.status === 'INVALID') status = 'TAMPERED';
  else status = 'VALID';

  if (!VALID_STATUSES.includes(status)) {
    warnings.push(`Unexpected integrity status "${String(status)}"; treating as INDETERMINATE`);
    status = 'INDETERMINATE';
  }

  const result: IntegrityResult = {
    status,
    checksums: {
      status: checksumsResult.status,
      checkedCount: checksumsResult.checkedCount,
      totalCount: checksumsResult.totalCount,
      failures: checksumsResult.failures,
    },
    hashChain: {
      status: hashChainResult.status,
      details: hashChainResult.details,
    },
    signatures: {
      status: signaturesResult.status,
      verifiedCount: signaturesResult.verifiedCount,
      totalCount: signaturesResult.totalCount,
      failures: signaturesResult.failures,
    },
    warnings,
  };
  return result;
}
