/**
 * ZK-KYA (Zero-Knowledge Know Your Agent) Module (v2 Phase 5)
 * 
 * Zero-knowledge proof-based identity verification interface.
 */

import * as crypto from "node:crypto";

/**
 * Canonicalize public inputs to stable JSON string.
 * 
 * Sorts object keys recursively while preserving array order.
 * This ensures deterministic hashing of public inputs.
 * 
 * @param inputs Public inputs object
 * @returns Canonical JSON string
 */
export function canonicalizePublicInputs(inputs: Record<string, unknown>): string {
  if (inputs === null || inputs === undefined) {
    return JSON.stringify(inputs);
  }
  
  if (typeof inputs !== "object") {
    return JSON.stringify(inputs);
  }
  
  if (Array.isArray(inputs)) {
    const items = inputs.map(item => 
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? canonicalizePublicInputs(item as Record<string, unknown>)
        : JSON.stringify(item)
    );
    return `[${items.join(",")}]`;
  }
  
  // Sort keys for deterministic output
  const keys = Object.keys(inputs).sort();
  const pairs = keys.map(key => {
    const value = inputs[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return `${JSON.stringify(key)}:${canonicalizePublicInputs(value as Record<string, unknown>)}`;
    } else if (Array.isArray(value)) {
      const items = value.map(item =>
        typeof item === "object" && item !== null && !Array.isArray(item)
          ? canonicalizePublicInputs(item as Record<string, unknown>)
          : JSON.stringify(item)
      );
      return `${JSON.stringify(key)}:[${items.join(",")}]`;
    } else {
      return `${JSON.stringify(key)}:${JSON.stringify(value)}`;
    }
  });
  
  return `{${pairs.join(",")}}`;
}

/**
 * Compute SHA-256 hash and return as hex string.
 * 
 * @param input Bytes (Uint8Array) or string
 * @returns SHA-256 hash as hex string
 */
export function sha256Hex(input: Uint8Array | string): string {
  let bytes: Uint8Array;
  
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = input;
  }
  
  const hash = crypto.createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

/**
 * Convert ZK-KYA input to proof (hashing public inputs and proof bytes).
 * 
 * @param input ZK-KYA input with raw data
 * @returns ZK-KYA proof with hashes
 */
export function convertZkKyaInputToProof(input: {
  scheme: "groth16" | "plonk" | "halo2" | "unknown";
  circuit_id: string;
  issuer_id?: string;
  public_inputs?: Record<string, unknown>;
  proof_bytes_b64?: string;
  issued_at_ms?: number;
  expires_at_ms?: number;
  meta?: Record<string, unknown>;
}): {
  proof: import("./types").ZkKyaProof;
  public_inputs_hash: string;
  proof_hash: string;
} {
  // Hash public inputs
  let public_inputs_hash: string;
  if (input.public_inputs) {
    const canonical = canonicalizePublicInputs(input.public_inputs);
    public_inputs_hash = sha256Hex(canonical);
  } else {
    public_inputs_hash = sha256Hex("{}");
  }
  
  // Hash proof bytes
  let proof_hash: string;
  if (input.proof_bytes_b64) {
    const proofBytes = Buffer.from(input.proof_bytes_b64, "base64");
    proof_hash = sha256Hex(proofBytes);
  } else {
    proof_hash = sha256Hex("");
  }
  
  const proof: import("./types").ZkKyaProof = {
    scheme: input.scheme,
    circuit_id: input.circuit_id,
    issuer_id: input.issuer_id,
    public_inputs_hash,
    proof_hash,
    issued_at_ms: input.issued_at_ms,
    expires_at_ms: input.expires_at_ms,
    meta: input.meta,
  };
  
  return { proof, public_inputs_hash, proof_hash };
}

export * from "./types";
export * from "./verifier";
export { createTestZkKyaVerifier } from "./verifier";
