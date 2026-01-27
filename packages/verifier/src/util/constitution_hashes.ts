/**
 * Accepted Constitution Hashes
 * 
 * This module defines the list of accepted constitution hashes that are recognized
 * as standard. Any transcript or auditor pack using a non-standard constitution
 * hash will trigger warnings or failures depending on the verification context.
 */

/**
 * Accepted constitution hashes for constitution/1.0
 * 
 * These are SHA-256 hashes of the canonicalized CONSTITUTION_v1.md content.
 * Only hashes in this list are considered standard and safe for production use.
 */
export const ACCEPTED_CONSTITUTION_HASHES: readonly string[] = [
  // Constitution v1.0 (standard)
  "a0ea6fe329251b8c92112fd7518976a031eb8db76433e8c99c77060fc76d7d9d",
] as const;

/**
 * Check if a constitution hash is accepted (standard)
 * 
 * @param hash - The constitution hash to check
 * @returns true if the hash is in the accepted list, false otherwise
 */
export function isAcceptedConstitutionHash(hash: string): boolean {
  return ACCEPTED_CONSTITUTION_HASHES.includes(hash);
}

/**
 * Get the list of accepted constitution hashes
 * 
 * @returns Array of accepted hashes
 */
export function getAcceptedConstitutionHashes(): readonly string[] {
  return ACCEPTED_CONSTITUTION_HASHES;
}
