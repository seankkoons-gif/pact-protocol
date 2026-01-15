#!/usr/bin/env node
/**
 * API Snapshot Generator
 * 
 * Extracts exported symbols from packages/sdk/src/index.ts
 * and generates a deterministic snapshot for API freeze checking.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");
const indexPath = join(repoRoot, "packages", "sdk", "src", "index.ts");
const snapshotPath = join(repoRoot, "docs", "api_snapshot.json");

// Read index.ts
const content = readFileSync(indexPath, "utf-8");

const values = [];
const types = [];

// Extract exports
const lines = content.split("\n");
for (const line of lines) {
  const trimmed = line.trim();
  
  // Match: export { name1, name2 } from "..."
  // Match: export * from "..."
  // Match: export type { name1, name2 } from "..."
  // Match: export { name1, name2 as alias } from "..."
  
  if (trimmed.startsWith("export type {")) {
    // Extract type names
    const match = trimmed.match(/export type \{([^}]+)\}/);
    if (match) {
      const names = match[1]
        .split(",")
        .map(n => n.trim().split(" as ")[0].trim())
        .filter(n => n);
      types.push(...names);
    }
  } else if (trimmed.startsWith("export {")) {
    // Extract value names
    const match = trimmed.match(/export \{([^}]+)\}/);
    if (match) {
      const names = match[1]
        .split(",")
        .map(n => n.trim().split(" as ")[0].trim())
        .filter(n => n);
      values.push(...names);
    }
  } else if (trimmed.startsWith("export * from")) {
    // Re-export all - we'll need to track this differently
    // For now, we'll note the module
    const match = trimmed.match(/export \* from ["']([^"']+)["']/);
    if (match) {
      // This is a wildcard export - we can't enumerate all exports
      // We'll track the module path instead
      values.push(`* from ${match[1]}`);
    }
  } else if (trimmed.startsWith("export ") && !trimmed.includes(" from ")) {
    // Direct export: export function name() or export const name = ...
    const match = trimmed.match(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/);
    if (match) {
      if (trimmed.includes("type ") || trimmed.includes("interface ")) {
        types.push(match[1]);
      } else {
        values.push(match[1]);
      }
    }
  }
}

// Sort for deterministic output
values.sort();
types.sort();

const snapshot = {
  generated_at: new Date().toISOString(),
  exports: {
    values,
    types,
  },
  source: "packages/sdk/src/index.ts",
};

// Write snapshot
writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");

console.log(`✅ API snapshot generated: ${snapshotPath}`);
console.log(`   Values: ${values.length}`);
console.log(`   Types: ${types.length}`);



