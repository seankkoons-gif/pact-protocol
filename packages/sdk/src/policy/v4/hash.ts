/**
 * Policy v4 Hashing
 * 
 * Canonical JSON serialization and SHA-256 hashing for policy determinism.
 */

import * as crypto from "node:crypto";
import { stableCanonicalize } from "../../protocol/canonical";
import type { PactPolicyV4 } from "./types";

/**
 * Compute policy hash from canonical JSON serialization.
 * 
 * Requirements:
 * - All keys sorted alphabetically (recursive)
 * - No whitespace (compact JSON)
 * - UTF-8 encoding
 * - SHA-256 hash
 * - Hex encoding (lowercase)
 * 
 * @param policy Policy v4 object
 * @returns SHA-256 hash (hex, lowercase)
 */
export function computePolicyHash(policy: PactPolicyV4): string {
  // Use stableCanonicalize for deterministic JSON serialization
  const canonical = stableCanonicalize(policy);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  return hash;
}

/**
 * Verify policy hash matches expected value.
 * 
 * @param policy Policy v4 object
 * @param expectedHash Expected hash (hex, lowercase)
 * @returns true if hash matches
 */
export function verifyPolicyHash(policy: PactPolicyV4, expectedHash: string): boolean {
  const computed = computePolicyHash(policy);
  return computed === expectedHash.toLowerCase();
}
