#!/usr/bin/env node
/**
 * Pact Verifier CLI Entrypoint (v4.5 F — verifier-only distribution)
 *
 * Single executable; no pnpm banners. Pipe-safe: JSON-only stdout, logs to stderr.
 *
 * Usage:
 *   ./bin/pact-verifier gc-view --transcript <path> | jq ...
 *   ./bin/pact-verifier judge-v4 --transcript <path> | jq ...
 *   ./bin/pact-verifier passport-v1-recompute --transcripts-dir <dir> | jq ...
 *   ./bin/pact-verifier contention-scan --transcripts-dir <dir> | jq ...
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const verifierDist = join(repoRoot, "packages", "verifier", "dist", "cli");

const subcommands = {
  "gc-view": join(verifierDist, "gc_view.js"),
  "gc-summary": join(verifierDist, "gc_summary.js"),
  "insurer-summary": join(verifierDist, "insurer_summary.js"),
  "judge-v4": join(verifierDist, "judge_v4.js"),
  "passport-v1-recompute": join(verifierDist, "passport_v1_recompute.js"),
  "contention-scan": join(verifierDist, "contention_scan.js"),
};

const subcommand = process.argv[2];

if (!subcommand || !subcommands[subcommand]) {
  console.error(`Usage: ${process.argv[1]} <subcommand> [args...]`);
  console.error("");
  console.error("Available subcommands:");
  for (const cmd of Object.keys(subcommands)) {
    console.error(`  ${cmd}`);
  }
  process.exit(1);
}

const scriptPath = subcommands[subcommand];
const args = process.argv.slice(3);

if (!existsSync(scriptPath)) {
  console.error(`Error: Verifier CLI not found: ${scriptPath}`);
  console.error("Run: pnpm verifier:build");
  process.exit(1);
}

const child = spawn("node", [scriptPath, ...args], {
  stdio: "inherit",
  shell: false,
  cwd: repoRoot,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error(`Error spawning verifier CLI: ${err.message}`);
  process.exit(1);
});
