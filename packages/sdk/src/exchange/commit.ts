import { createHash } from "node:crypto";

/**
 * Compute commit hash from payload and nonce.
 * commit_hash = sha256(payload_b64 || nonce_b64)
 */
export function computeCommitHash(payloadB64: string, nonceB64: string): string {
  const combined = payloadB64 + nonceB64;
  const hash = createHash("sha256");
  hash.update(combined, "utf8");
  return hash.digest("hex");
}

/**
 * Verify that a reveal matches the commit hash.
 */
export function verifyReveal(
  commitHashHex: string,
  payloadB64: string,
  nonceB64: string
): boolean {
  const computedHash = computeCommitHash(payloadB64, nonceB64);
  return computedHash.toLowerCase() === commitHashHex.toLowerCase();
}

