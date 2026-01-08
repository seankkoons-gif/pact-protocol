import type {
  ProviderQuoteRequest,
  ProviderQuoteResponse,
  CommitRequest,
  CommitResponse,
  RevealRequest,
  RevealResponse,
  StreamChunkRequest,
  StreamChunkResponse,
  ProviderCredentialRequest,
  ProviderCredentialResponse,
  SignedEnvelope,
} from "./types";
import type { Keypair, CredentialMessage } from "@pact/sdk";
import { signEnvelope } from "@pact/sdk";
import { createHash, randomBytes } from "node:crypto";

function computeCommitHash(payloadB64: string, nonceB64: string): string {
  const combined = payloadB64 + nonceB64;
  const hash = createHash("sha256");
  hash.update(combined, "utf8");
  return hash.digest("hex");
}

export async function handleQuote(
  req: ProviderQuoteRequest,
  sellerKeyPair: Keypair,
  nowMs: () => number
): Promise<ProviderQuoteResponse> {
  // Deterministic price based on intent_type and urgency
  let basePrice = 0.00008; // Default for weather.data
  
  // Adjust base price by intent_type (simple mapping)
  if (req.intent_type.includes("compute") || req.intent_type.includes("inference")) {
    basePrice = 0.00012; // Higher for compute
  }
  
  // Apply urgent premium (+10%)
  if (req.urgent) {
    basePrice *= 1.1;
  }
  
  // Enforce max_price constraint
  const price = Math.min(basePrice, req.max_price);
  
  // If price would exceed max_price, return error (handled by caller)
  if (basePrice > req.max_price) {
    throw new Error("Price exceeds max_price");
  }
  
  const sentAtMs = nowMs();
  const validForMs = 20000;
  const bondRequired = Math.max(0.00001, price * 2); // seller_bond_multiple = 2
  
  // Build ASK message
  const askMsg = {
    protocol_version: "pact/1.0" as const,
    type: "ASK" as const,
    intent_id: req.intent_id,
    price,
    unit: "request" as const,
    latency_ms: req.constraints.latency_ms,
    valid_for_ms: validForMs,
    bond_required: bondRequired,
    sent_at_ms: sentAtMs,
    expires_at_ms: sentAtMs + validForMs,
  };
  
  // Sign the ASK envelope
  const envelope = await signEnvelope(askMsg, sellerKeyPair, sentAtMs);
  
  return {
    envelope,
  };
}

export async function handleCommit(
  req: CommitRequest,
  sellerKeyPair: Keypair,
  nowMs: () => number
): Promise<CommitResponse> {
  const commitHash = computeCommitHash(req.payload_b64, req.nonce_b64);
  const sentAtMs = nowMs();
  
  // Build COMMIT message
  const commitMsg = {
    protocol_version: "pact/1.0" as const,
    type: "COMMIT" as const,
    intent_id: req.intent_id,
    commit_hash_hex: commitHash,
    sent_at_ms: sentAtMs,
    expires_at_ms: sentAtMs + 10000,
  };
  
  // Sign the COMMIT envelope
  const envelope = await signEnvelope(commitMsg, sellerKeyPair, sentAtMs);
  
  return {
    envelope,
  };
}

export async function handleReveal(
  req: RevealRequest,
  sellerKeyPair: Keypair,
  nowMs: () => number
): Promise<RevealResponse> {
  // Recompute commit hash from payload and nonce
  const computedHash = computeCommitHash(req.payload_b64, req.nonce_b64);
  const sentAtMs = nowMs();
  
  // DEV-ONLY: Bad reveal mode (for demo/testing)
  // If PACT_DEV_BAD_REVEAL env var is set, return mismatching payload
  const badRevealMode = process.env.PACT_DEV_BAD_REVEAL === "1";
  let actualPayloadB64 = req.payload_b64;
  let actualNonceB64 = req.nonce_b64;
  
  if (badRevealMode) {
    // Return a different payload that won't match the commit hash
    actualPayloadB64 = Buffer.from("BAD_REVEAL_PAYLOAD").toString("base64");
    actualNonceB64 = Buffer.from("BAD_REVEAL_NONCE").toString("base64");
  }
  
  // Build REVEAL message (use actual payload/nonce, not the bad one for the message)
  const revealMsg = {
    protocol_version: "pact/1.0" as const,
    type: "REVEAL" as const,
    intent_id: req.intent_id,
    payload_b64: actualPayloadB64,
    nonce_b64: actualNonceB64,
    sent_at_ms: sentAtMs,
    expires_at_ms: sentAtMs + 10000,
  };
  
  // Sign the REVEAL envelope (always sign, even if hash mismatch)
  const envelope = await signEnvelope(revealMsg, sellerKeyPair, sentAtMs);
  
  // Check if commit hash matches (this will fail in bad-reveal mode)
  const actualHash = computeCommitHash(actualPayloadB64, actualNonceB64);
  if (actualHash.toLowerCase() !== req.commit_hash_hex.toLowerCase()) {
    return {
      envelope,
      ok: false,
      code: "FAILED_PROOF",
      reason: badRevealMode ? "DEV: Bad reveal mode (intentional mismatch)" : "Commit hash mismatch",
    };
  }
  
  return {
    envelope,
    ok: true,
  };
}

export async function handleStreamChunk(
  req: StreamChunkRequest,
  sellerKeyPair: Keypair,
  nowMs: () => number
): Promise<StreamChunkResponse> {
  const sentAtMs = req.sent_at_ms ?? nowMs();
  
  // Deterministic chunk_b64 based on seq (for stable tests)
  // For seq=0: "AA==", seq=1: "AQ==", etc.
  const chunkBytes = Buffer.from([req.seq % 256]);
  const chunkB64 = chunkBytes.toString("base64");
  
  // Build STREAM_CHUNK message
  const chunkMsg = {
    protocol_version: "pact/1.0" as const,
    type: "STREAM_CHUNK" as const,
    intent_id: req.intent_id,
    seq: req.seq,
    chunk_b64: chunkB64,
    sent_at_ms: sentAtMs,
    expires_at_ms: sentAtMs + 10000,
  };
  
  // Sign the STREAM_CHUNK envelope
  const envelope = await signEnvelope(chunkMsg, sellerKeyPair, sentAtMs);
  
  return {
    envelope,
  };
}

export async function handleCredential(
  req: ProviderCredentialRequest,
  sellerKeyPair: Keypair,
  sellerId: string, // pubkey b58
  nowMs: () => number,
  capabilities: Array<{ intentType: string; modes: ("hash_reveal" | "streaming")[]; region?: string; credentials?: string[] }>
): Promise<ProviderCredentialResponse> {
  const issuedAtMs = nowMs();
  const expiresAtMs = issuedAtMs + (365 * 24 * 60 * 60 * 1000); // 1 year validity
  
  // Generate credential ID
  const credentialId = Buffer.from(randomBytes(16)).toString("base64");
  const nonce = Buffer.from(randomBytes(16)).toString("base64");
  
  // Filter capabilities by intent if requested
  let relevantCapabilities = capabilities;
  if (req.intent) {
    relevantCapabilities = capabilities.filter(cap => cap.intentType === req.intent);
  }
  
  // Build credential message
  const credentialMsg: CredentialMessage = {
    protocol_version: "pact/1.0",
    credential_version: "1",
    credential_id: credentialId,
    provider_pubkey_b58: sellerId,
    issuer: "self", // Self-signed for v1
    issued_at_ms: issuedAtMs,
    expires_at_ms: expiresAtMs,
    capabilities: relevantCapabilities,
    nonce,
  };
  
  // Sign the credential envelope
  const envelope = await signEnvelope(credentialMsg, sellerKeyPair, issuedAtMs);
  
  return {
    envelope,
  };
}

