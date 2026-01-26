/**
 * Canonical JSON serialization for deterministic hashing.
 * Local copy to avoid cross-package imports during build.
 */

import { createHash } from "node:crypto";

/**
 * Canonical JSON serialization for deterministic hashing.
 * Sorts object keys recursively while preserving array order.
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
 * Synchronous version using Node.js crypto.
 */
export function hashMessageSync(obj: unknown): Uint8Array {
  const canonical = stableCanonicalize(obj);
  const hash = createHash("sha256");
  hash.update(canonical, "utf8");
  return new Uint8Array(hash.digest());
}
