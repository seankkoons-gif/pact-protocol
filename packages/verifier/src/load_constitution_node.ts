/**
 * Load Constitution v1 from filesystem (Node only).
 * Used by CLI; not loaded when viewer passes constitutionContent + sha256Async.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "./util/sha256.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve path to CONSTITUTION_v1.md (for reading content). */
export function getConstitutionPath(constitutionPath?: string): string {
  let path: string | undefined;

  if (constitutionPath && existsSync(constitutionPath)) {
    path = constitutionPath;
  }

  // Try package resources: works when __dirname is src/ or dist/cli/
  if (!path) {
    const fromSrc = resolve(__dirname, "..", "resources", "CONSTITUTION_v1.md");
    if (existsSync(fromSrc)) path = fromSrc;
  }
  if (!path) {
    const fromDistCli = resolve(__dirname, "..", "..", "resources", "CONSTITUTION_v1.md");
    if (existsSync(fromDistCli)) path = fromDistCli;
  }
  // Repo root fallbacks (when run from bin/pact-verifier.mjs, cwd is repo root; __dirname is dist/cli so repo root = __dirname/../../..)
  if (!path) {
    const repoRoot = resolve(__dirname, "..", "..", "..", "..");
    const mono = join(repoRoot, "packages", "verifier", "resources", "CONSTITUTION_v1.md");
    if (existsSync(mono)) path = mono;
    else {
      const docs = join(repoRoot, "docs", "CONSTITUTION_v1.md");
      if (existsSync(docs)) path = docs;
    }
  }

  if (!path) throw new Error("Could not find CONSTITUTION_v1.md in any expected location");
  return path;
}

/** Read raw constitution content (for verify_auditor_pack_core). */
export function getConstitutionContent(constitutionPath?: string): string {
  return readFileSync(getConstitutionPath(constitutionPath), "utf8");
}

export function loadConstitution(constitutionPath?: string): { version: "constitution/1.0"; hash: string } {
  const content = getConstitutionContent(constitutionPath);
  const canonicalContent = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
  const hash = sha256Hex(canonicalContent);
  return { version: "constitution/1.0", hash };
}
