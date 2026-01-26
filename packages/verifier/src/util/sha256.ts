import { createHash } from "node:crypto";

/**
 * Compute SHA-256 hash of input and return as hex string.
 * 
 * @param input - String or Buffer to hash
 * @returns Hexadecimal string (64 characters)
 */
export function sha256Hex(input: string | Buffer): string {
  const hash = createHash("sha256");
  if (typeof input === "string") {
    hash.update(input, "utf8");
  } else {
    hash.update(input);
  }
  return hash.digest("hex");
}
