#!/usr/bin/env node
/**
 * API Check Script
 * 
 * Compares current API exports to the frozen snapshot.
 * Exits with code 1 if API has changed.
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");
const snapshotPath = join(repoRoot, "docs", "api_snapshot.json");

// Generate current snapshot using the same logic
const indexPath = join(repoRoot, "packages", "sdk", "src", "index.ts");
const content = readFileSync(indexPath, "utf-8");

const values = [];
const types = [];

const lines = content.split("\n");
for (const line of lines) {
  const trimmed = line.trim();
  
  if (trimmed.startsWith("export type {")) {
    const match = trimmed.match(/export type \{([^}]+)\}/);
    if (match) {
      const names = match[1]
        .split(",")
        .map(n => n.trim().split(" as ")[0].trim())
        .filter(n => n);
      types.push(...names);
    }
  } else if (trimmed.startsWith("export {")) {
    const match = trimmed.match(/export \{([^}]+)\}/);
    if (match) {
      const names = match[1]
        .split(",")
        .map(n => n.trim().split(" as ")[0].trim())
        .filter(n => n);
      values.push(...names);
    }
  } else if (trimmed.startsWith("export * from")) {
    const match = trimmed.match(/export \* from ["']([^"']+)["']/);
    if (match) {
      values.push(`* from ${match[1]}`);
    }
  } else if (trimmed.startsWith("export ") && !trimmed.includes(" from ")) {
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

values.sort();
types.sort();

// Load snapshot
if (!existsSync(snapshotPath)) {
  console.error(`❌ API snapshot not found: ${snapshotPath}`);
  console.error("   Run 'pnpm api:snapshot' to generate it.");
  process.exit(1);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8"));
const snapshotValues = new Set(snapshot.exports.values || []);
const snapshotTypes = new Set(snapshot.exports.types || []);

const currentValues = new Set(values);
const currentTypes = new Set(types);

// Compare
const addedValues = values.filter(v => !snapshotValues.has(v));
const removedValues = Array.from(snapshotValues).filter(v => !currentValues.has(v));
const addedTypes = types.filter(t => !snapshotTypes.has(t));
const removedTypes = Array.from(snapshotTypes).filter(t => !currentTypes.has(t));

if (addedValues.length > 0 || removedValues.length > 0 || addedTypes.length > 0 || removedTypes.length > 0) {
  console.error("❌ API surface has changed!\n");
  
  if (addedValues.length > 0) {
    console.error("Added values:");
    addedValues.forEach(v => console.error(`  + ${v}`));
  }
  
  if (removedValues.length > 0) {
    console.error("Removed values:");
    removedValues.forEach(v => console.error(`  - ${v}`));
  }
  
  if (addedTypes.length > 0) {
    console.error("Added types:");
    addedTypes.forEach(t => console.error(`  + ${t}`));
  }
  
  if (removedTypes.length > 0) {
    console.error("Removed types:");
    removedTypes.forEach(t => console.error(`  - ${t}`));
  }
  
  console.error("\nIf this is intentional, run 'pnpm api:snapshot' to update the snapshot.");
  process.exit(1);
}

console.log("✅ API surface matches snapshot");
process.exit(0);



