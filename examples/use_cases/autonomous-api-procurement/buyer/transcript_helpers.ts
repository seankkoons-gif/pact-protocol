/**
 * Transcript Helper Functions for Autonomous API Procurement
 * 
 * Provides utilities for creating, saving, and verifying v4 transcripts.
 * 
 * All transcript construction and verification uses canonical v4 utilities
 * from @pact/sdk to ensure transcripts are always valid and verifiable.
 * 
 * CANONICAL APPROACH:
 * - Use createTranscriptV4() to create transcripts
 * - Use addRound0ToTranscript() for round 0 (INTENT)
 * - Use addRoundToTranscript() for subsequent rounds (ASK, ACCEPT, etc.)
 * - Use writeAndVerifyTranscript() to write and immediately verify
 * - Use verifyTranscriptFile() to verify using the same code path as `pnpm replay:v4`
 * - Use bundleAndVerify() only after successful transcript verification
 * 
 * IMPORTANT: Always verify transcripts immediately after writing. Never proceed
 * with evidence bundle generation if transcript verification fails.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  replayTranscriptV4,
  createTranscriptV4,
  addRoundToTranscript,
  stableCanonicalize,
  publicKeyToB58,
  bytesToB58,
  type TranscriptV4,
  type TranscriptRound,
  type Signature,
} from "@pact/sdk";
import { spawn } from "child_process";

/**
 * Get provider URL from environment (default: http://localhost:3010)
 */
export function getProviderUrl(): string {
  return process.env.PROVIDER_URL || "http://localhost:3010";
}

/**
 * Generate Ed25519 keypair using Node.js crypto.
 */
export interface KeyPairWithObjects {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyObj: crypto.KeyObject;
  privateKeyObj: crypto.KeyObject;
}

export function generateKeyPair(): KeyPairWithObjects {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyJwk = publicKey.export({ format: "jwk" }) as { x: string };
  const privateKeyJwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
  const publicKeyBytes = Buffer.from(publicKeyJwk.x, "base64url");
  const privateKeyBytes = Buffer.from(privateKeyJwk.d, "base64url");
  return {
    publicKey: new Uint8Array(publicKeyBytes),
    secretKey: new Uint8Array(Buffer.concat([privateKeyBytes, publicKeyBytes])),
    publicKeyObj: publicKey,
    privateKeyObj: privateKey,
  };
}

/**
 * Create a signed round for transcript.
 * 
 * This function handles all crypto operations including base58 encoding,
 * so buyer scripts don't need to import bs58 directly.
 */
export function createSignedRound(
  roundType: "INTENT" | "ASK" | "ACCEPT",
  agentId: string,
  keypair: KeyPairWithObjects,
  timestampMs: number,
  intentId: string,
  contentSummary?: Record<string, unknown>
): Omit<TranscriptRound, "round_number" | "previous_round_hash" | "round_hash"> {
  const envelope: Record<string, unknown> = {
    type: roundType,
    intent_id: intentId,
    ...(contentSummary || {}),
  };
  const envelopeCanonical = stableCanonicalize(envelope);
  const envelopeHash = crypto.createHash("sha256").update(envelopeCanonical, "utf8").digest("hex");
  const hashBytes = Buffer.from(envelopeHash, "hex");
  const sigBytes = crypto.sign(null, hashBytes, keypair.privateKeyObj);
  const signatureB58 = bytesToB58(sigBytes);
  const publicKeyB58 = publicKeyToB58(keypair.publicKey);

  const signature: Signature = {
    signer_public_key_b58: publicKeyB58,
    signature_b58: signatureB58,
    signed_at_ms: timestampMs,
    scheme: "ed25519",
  };

  // CRITICAL: Filter out undefined values from content_summary
  // JSON serialization omits undefined, but stableCanonicalize includes them as null,
  // causing hash mismatches when transcript is saved and read back
  const finalContentSummary: Record<string, unknown> = {};
  if (contentSummary) {
    for (const [key, value] of Object.entries(contentSummary)) {
      if (value !== undefined) {
        finalContentSummary[key] = value;
      }
    }
  }
  
  return {
    round_type: roundType,
    message_hash: envelopeHash,
    envelope_hash: envelopeHash,
    signature,
    timestamp_ms: timestampMs,
    agent_id: agentId,
    public_key_b58: publicKeyB58,
    content_summary: finalContentSummary,
  };
}

/**
 * Compute initial hash for round 0 (same logic as replay.ts).
 * This is used to set previous_round_hash for the first round.
 * 
 * NOTE: This is exported for use in buyer scripts that need to manually
 * construct round 0. Prefer using addRound0ToTranscript when possible.
 */
export function computeInitialHash(intentId: string, createdAtMs: number): string {
  const combined = `${intentId}:${createdAtMs}`;
  return crypto.createHash("sha256").update(combined, "utf8").digest("hex");
}

/**
 * Compute round hash (excluding round_hash field itself).
 * 
 * This uses the same canonical logic as transcript.ts in the SDK.
 * NOTE: Prefer using addRoundToTranscript() or addRound0ToTranscript() when possible,
 * as they handle hash computation automatically.
 */
export function computeRoundHash(round: Omit<TranscriptRound, "round_hash">): string {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'transcript_helpers.ts:133',message:'computeRoundHash entry',data:{round:JSON.parse(JSON.stringify(round))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  const canonical = stableCanonicalize(round);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'transcript_helpers.ts:136',message:'computeRoundHash exit',data:{hash,canonical},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  return hash;
}

/**
 * Compute transcript hash up to failure point (excluding failure_event and final_hash).
 * 
 * This uses the same logic as replay.ts for computing failure_event.transcript_hash.
 * The hash is computed from the transcript excluding failure_event and final_hash fields.
 */
export function computeTranscriptHashUpToFailure(transcript: TranscriptV4): string {
  const { failure_event, final_hash, ...transcriptUpToFailure } = transcript;
  const canonical = stableCanonicalize(transcriptUpToFailure);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Write transcript to .pact/transcripts directory.
 * 
 * IMPORTANT: This function does NOT verify the transcript. Use verifyTranscriptFile
 * after writing to ensure the transcript is valid before proceeding.
 */
export function writeTranscript(transcript: TranscriptV4, repoRoot: string): string {
  const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
  if (!fs.existsSync(transcriptDir)) {
    fs.mkdirSync(transcriptDir, { recursive: true });
  }
  const transcriptPath = path.join(transcriptDir, `${transcript.transcript_id}.json`);
  fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
  return transcriptPath;
}

/**
 * Verify transcript using the same code path as `pnpm replay:v4`.
 * 
 * This uses replayTranscriptV4 directly (same function used by the CLI).
 * 
 * @returns Verification result with ok, integrity_status, errors, and warnings
 */
export async function verifyTranscript(transcript: TranscriptV4): Promise<{
  ok: boolean;
  integrity_status: string;
  errors: Array<{ type: string; message: string }>;
  warnings: string[];
}> {
  const result = await replayTranscriptV4(transcript);
  return {
    ok: result.ok,
    integrity_status: result.integrity_status,
    errors: result.errors,
    warnings: result.warnings,
  };
}

/**
 * Verify transcript file using the replay:v4 CLI (same as `pnpm replay:v4 <path>`).
 * 
 * This ensures we use the exact same verification logic as the CLI.
 * 
 * @param transcriptPath Path to transcript JSON file
 * @returns true if verification passes (exit code 0), false otherwise
 */
export async function verifyTranscriptFile(transcriptPath: string, repoRoot: string): Promise<boolean> {
  // Ensure transcript path exists and is absolute
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found: ${transcriptPath}`);
  }
  
  const absoluteTranscriptPath = path.isAbsolute(transcriptPath) 
    ? transcriptPath 
    : path.resolve(repoRoot, transcriptPath);
  
  if (!fs.existsSync(absoluteTranscriptPath)) {
    throw new Error(`Transcript file not found: ${absoluteTranscriptPath}`);
  }
  
  return new Promise<boolean>((resolve) => {
    const replayScript = path.join(repoRoot, "packages", "sdk", "src", "cli", "replay_v4.ts");
    const child = spawn("tsx", [replayScript, absoluteTranscriptPath], {
      stdio: "pipe",
      shell: false,
      cwd: repoRoot, // Ensure working directory is correct
    });
    
    let stdout = "";
    let stderr = "";
    
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    
    child.on("exit", (code) => {
      // Exit code 0 means verification passed
      resolve(code === 0);
    });
    
    child.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Write transcript and immediately verify it using replay:v4 CLI.
 * 
 * This ensures the transcript is valid before proceeding. If verification fails,
 * throws an error to abort execution.
 * 
 * @param transcript Transcript to write and verify
 * @param repoRoot Repository root directory
 * @returns Path to written transcript file
 * @throws Error if verification fails
 */
export async function writeAndVerifyTranscript(
  transcript: TranscriptV4,
  repoRoot: string
): Promise<string> {
  // Write transcript
  const transcriptPath = writeTranscript(transcript, repoRoot);
  
  // Ensure path is absolute
  const absoluteTranscriptPath = path.isAbsolute(transcriptPath) 
    ? transcriptPath 
    : path.resolve(repoRoot, transcriptPath);
  
  // Immediately verify using replay:v4 CLI (same code path as `pnpm replay:v4`)
  const verified = await verifyTranscriptFile(absoluteTranscriptPath, repoRoot);
  
  if (!verified) {
    throw new Error(
      `Transcript verification failed: ${absoluteTranscriptPath}\n` +
      `The transcript does not pass replay:v4 verification. ` +
      `This indicates the transcript is non-canonical or has been tampered with.`
    );
  }
  
  return absoluteTranscriptPath;
}

/**
 * Generate auditor evidence bundle and verify it.
 * 
 * IMPORTANT: This function assumes the transcript has already been verified.
 * Use writeAndVerifyTranscript before calling this function.
 * 
 * @param transcriptPath Path to verified transcript file
 * @param repoRoot Repository root directory
 * @returns Bundle path and verification status
 */
export async function bundleAndVerify(
  transcriptPath: string,
  repoRoot: string
): Promise<{ bundlePath: string; verified: boolean }> {
  // Ensure transcript path exists and is absolute
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found: ${transcriptPath}`);
  }
  
  const absoluteTranscriptPath = path.isAbsolute(transcriptPath) 
    ? transcriptPath 
    : path.resolve(repoRoot, transcriptPath);
  
  if (!fs.existsSync(absoluteTranscriptPath)) {
    throw new Error(`Transcript file not found: ${absoluteTranscriptPath}`);
  }
  
  const transcriptId = path.basename(absoluteTranscriptPath, ".json");
  const bundleDir = path.join(repoRoot, ".pact", "bundles", transcriptId);

  // Generate bundle - explicitly pass the absolute transcript path
  await new Promise<void>((resolve, reject) => {
    const bundleScript = path.join(repoRoot, "packages", "sdk", "src", "cli", "evidence_bundle.ts");
    const child = spawn("tsx", [bundleScript, absoluteTranscriptPath, "--out", bundleDir, "--view", "auditor"], {
      stdio: "inherit",
      shell: false,
      cwd: repoRoot, // Ensure working directory is correct
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`evidence_bundle exited with code ${code}. Transcript path: ${absoluteTranscriptPath}`));
      }
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to spawn evidence_bundle: ${error.message}. Transcript path: ${absoluteTranscriptPath}`));
    });
  });

  // Verify bundle
  let verified = false;
  await new Promise<void>((resolve) => {
    const verifyScript = path.join(repoRoot, "packages", "sdk", "src", "cli", "evidence_verify.ts");
    const manifestPath = path.join(bundleDir, "MANIFEST.json");
    const child = spawn("tsx", [verifyScript, manifestPath], {
      stdio: "pipe",
      shell: false,
    });
    let output = "";
    child.stdout?.on("data", (data) => {
      output += data.toString();
    });
    child.stderr?.on("data", (data) => {
      output += data.toString();
    });
    child.on("exit", () => {
      verified = output.includes("INTEGRITY PASS");
      resolve();
    });
  });

  return { bundlePath: bundleDir, verified };
}

/**
 * Helper to create round 0 (INTENT) with correct previous_round_hash.
 * 
 * This uses the canonical initial hash computation (same as replay.ts).
 * After creating round 0, use addRoundToTranscript for subsequent rounds.
 * 
 * @param transcript Transcript (from createTranscriptV4)
 * @param round Round data without round_number, previous_round_hash, round_hash
 * @returns Transcript with round 0 added
 */
export function addRound0ToTranscript(
  transcript: TranscriptV4,
  round: Omit<TranscriptRound, "round_number" | "previous_round_hash" | "round_hash">
): TranscriptV4 {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'transcript_helpers.ts:362',message:'addRound0ToTranscript entry',data:{round_type:round.round_type,content_summary:round.content_summary},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  // Compute initial hash (same logic as replay.ts)
  const initialHash = computeInitialHash(transcript.intent_id, transcript.created_at_ms);
  
  // Use addRoundToTranscript, then fix previous_round_hash for round 0
  const transcriptWithRound = addRoundToTranscript(transcript, round);
  
  // Fix round 0's previous_round_hash (addRoundToTranscript uses "0".repeat(64) by default)
  const round0 = transcriptWithRound.rounds[0];
  if (round0.round_number === 0) {
    // CRITICAL: Exclude round_hash from the object before canonicalization
    // Spreading round0 would include the old round_hash, which would be included in hash computation
    const { round_hash, ...round0WithoutHash } = round0;
    
    // Recompute round_hash with correct previous_round_hash
    const round0Fixed: Omit<TranscriptRound, "round_hash"> = {
      ...round0WithoutHash,
      previous_round_hash: initialHash,
    };
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'transcript_helpers.ts:380',message:'round0Fixed before hash',data:{round0Fixed:JSON.parse(JSON.stringify(round0Fixed))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // Recompute round_hash (same logic as transcript.ts)
    const canonical = stableCanonicalize(round0Fixed);
    const roundHash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'transcript_helpers.ts:388',message:'round0 hash computed',data:{roundHash,canonical},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    const round0WithHash: TranscriptRound = {
      ...round0Fixed,
      round_hash: roundHash,
    };
    
    const result = {
      ...transcriptWithRound,
      rounds: [round0WithHash, ...transcriptWithRound.rounds.slice(1)],
    };
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'transcript_helpers.ts:400',message:'addRound0ToTranscript exit',data:{round0_hash:result.rounds[0].round_hash,rounds_length:result.rounds.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    return result;
  }
  
  return transcriptWithRound;
}
