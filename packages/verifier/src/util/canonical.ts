import { createHash } from "node:crypto";

/**
 * Canonical JSON serialization for deterministic hashing.
 * Sorts object keys recursively while preserving array order.
 * 
 * This is a duplicate of packages/sdk/src/protocol/canonical.ts
 * to avoid SDK dependencies in the CLI execution path.
 */
export function stableCanonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }

  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    const items = obj.map((item) => stableCanonicalize(item));
    return `[${items.join(",")}]`;
  }

  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((key) => {
      const value = (obj as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${stableCanonicalize(value)}`;
    });
    return `{${pairs.join(",")}}`;
  }

  return JSON.stringify(obj);
}

/**
 * Synchronous SHA-256 hash of canonical JSON representation.
 * Returns hash as Uint8Array.
 * 
 * This is a duplicate of packages/sdk/src/protocol/canonical.ts
 * to avoid SDK dependencies in the CLI execution path.
 */
export function hashMessageSync(obj: unknown): Uint8Array {
  const canonical = stableCanonicalize(obj);
  const hash = createHash("sha256");
  hash.update(canonical, "utf8");
  return new Uint8Array(hash.digest());
}

/**
 * Compute SHA-256 hash of canonical JSON and return as hex string.
 * 
 * @param obj - Object to hash
 * @returns Hexadecimal string (64 characters)
 */
export function hashCanonicalHex(obj: unknown): string {
  const hash = hashMessageSync(obj);
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
