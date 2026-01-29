#!/usr/bin/env node
/**
 * Verifier Smoke Test Script (v4.5 F)
 *
 * Tests verifier CLIs from fresh build:
 * 1. gc_view --transcript
 * 2. judge_v4 --transcript
 * 3. passport_v1_recompute --transcripts-dir
 * 4. contention_scan --transcripts-dir (with double-commit detection)
 *
 * Usage: pnpm verifier:smoke
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

const log = (msg) => console.log(`[verifier:smoke] ${msg}`);
const err = (msg) => console.error(`[verifier:smoke] ❌ ${msg}`);

function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: opts.silent ? "pipe" : "inherit",
    ...opts,
  });
}

function runJSON(cmd) {
  const result = spawnSync("sh", ["-c", cmd], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error(`Command failed: ${cmd}`);
  }
  return JSON.parse(result.stdout);
}

async function main() {
  log("═══════════════════════════════════════════════════════════");
  log("  Verifier Smoke Test");
  log("═══════════════════════════════════════════════════════════\n");

  // 1. Build verifier
  log("1. Building verifier...");
  try {
    run("pnpm verifier:build");
  } catch (e) {
    err("Build failed");
    process.exit(1);
  }
  log("   ✓ Build OK\n");

  // Check fixtures exist
  const successFixture = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");
  const failureFixture = join(repoRoot, "fixtures/failures/PACT-404-settlement-timeout.json");
  const policyFixture = join(repoRoot, "fixtures/failures/PACT-101-policy-violation.json");

  if (!existsSync(successFixture)) {
    err(`Missing fixture: ${successFixture}`);
    process.exit(1);
  }
  if (!existsSync(failureFixture)) {
    err(`Missing fixture: ${failureFixture}`);
    process.exit(1);
  }

  // 2. gc_view
  log("2. Testing gc_view...");
  try {
    const gcView = runJSON(
      `node packages/verifier/dist/cli/gc_view.js --transcript "${successFixture}"`
    );
    if (!gcView.version) {
      throw new Error("Missing version field in gc_view output");
    }
    if (!gcView.constitution?.hash) {
      throw new Error("Missing constitution.hash in gc_view output");
    }
    log(`   version: ${gcView.version}`);
    log(`   constitution.hash: ${gcView.constitution.hash.substring(0, 16)}...`);
    log("   ✓ gc_view OK\n");
  } catch (e) {
    err(`gc_view failed: ${e.message}`);
    process.exit(1);
  }

  // 3. judge_v4
  log("3. Testing judge_v4...");
  try {
    const judgment = runJSON(
      `node packages/verifier/dist/cli/judge_v4.js --transcript "${failureFixture}"`
    );
    if (!judgment.version) {
      throw new Error("Missing version field in judge_v4 output");
    }
    if (!judgment.dblDetermination) {
      throw new Error("Missing dblDetermination in judge_v4 output");
    }
    log(`   version: ${judgment.version}`);
    log(`   dblDetermination: ${judgment.dblDetermination}`);
    log("   ✓ judge_v4 OK\n");
  } catch (e) {
    err(`judge_v4 failed: ${e.message}`);
    process.exit(1);
  }

  // 3b. judge_v4 with PACT-101 (check judgment fields)
  log("3b. Testing judge_v4 judgment fields...");
  if (existsSync(policyFixture)) {
    try {
      const judgment = runJSON(
        `node packages/verifier/dist/cli/judge_v4.js --transcript "${policyFixture}"`
      );
      if (!judgment.judgment?.required_next_actor) {
        throw new Error("Missing judgment.required_next_actor");
      }
      log(`   judgment.required_next_actor: ${judgment.judgment.required_next_actor}`);
      log("   ✓ judgment fields OK\n");
    } catch (e) {
      err(`judge_v4 judgment fields failed: ${e.message}`);
      process.exit(1);
    }
  } else {
    log("   (skipped - PACT-101 fixture not found)\n");
  }

  // 4. passport_v1_recompute
  log("4. Testing passport_v1_recompute...");
  try {
    const passport = runJSON(
      `node packages/verifier/dist/cli/passport_v1_recompute.js --transcripts-dir fixtures/success`
    );
    if (passport.version !== "passport/1.0") {
      throw new Error(`Expected version passport/1.0, got ${passport.version}`);
    }
    log(`   version: ${passport.version}`);
    log(`   states: ${Object.keys(passport.states || {}).length} signers`);
    log("   ✓ passport_v1_recompute OK\n");
  } catch (e) {
    err(`passport_v1_recompute failed: ${e.message}`);
    process.exit(1);
  }

  // 5. contention_scan (double-commit detection)
  log("5. Testing contention_scan (double-commit)...");
  const tempDir = join(repoRoot, ".pact", "verifier-smoke-temp");
  try {
    // Create temp directory with 2 copies of the same transcript
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    mkdirSync(tempDir, { recursive: true });

    // Copy SUCCESS-001 twice (same intent_fingerprint = DOUBLE_COMMIT)
    copyFileSync(successFixture, join(tempDir, "tx-001.json"));
    copyFileSync(successFixture, join(tempDir, "tx-002.json"));

    const contention = runJSON(
      `node packages/verifier/dist/cli/contention_scan.js --transcripts-dir "${tempDir}"`
    );

    if (contention.version !== "contention_report/1.0") {
      throw new Error(`Expected version contention_report/1.0, got ${contention.version}`);
    }

    // Check for DOUBLE_COMMIT detection
    const doubleCommits = contention.double_commits || 0;
    const hasDoubleCommit = contention.groups?.some((g) => g.status === "DOUBLE_COMMIT");

    if (doubleCommits === 0 && !hasDoubleCommit) {
      throw new Error("Expected DOUBLE_COMMIT status for duplicate transcripts");
    }

    log(`   version: ${contention.version}`);
    log(`   double_commits: ${doubleCommits}`);
    log("   ✓ contention_scan DOUBLE_COMMIT detected\n");
  } catch (e) {
    err(`contention_scan failed: ${e.message}`);
    process.exit(1);
  } finally {
    // Cleanup
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // 6. Test bin/pact-verifier entrypoint
  log("6. Testing bin/pact-verifier entrypoint...");
  try {
    const gcView = runJSON(
      `node bin/pact-verifier.mjs gc-view --transcript "${successFixture}"`
    );
    if (!gcView.constitution?.hash) {
      throw new Error("Missing constitution.hash from pact-verifier gc-view");
    }
    log(`   constitution.hash: ${gcView.constitution.hash.substring(0, 16)}...`);
    log("   ✓ bin/pact-verifier OK\n");
  } catch (e) {
    err(`bin/pact-verifier failed: ${e.message}`);
    process.exit(1);
  }

  // 7. Freeze check: gc-summary constitution + status (SUCCESS-001 must be stable)
  log("7. Freeze check (gc-summary constitution + status)...");
  try {
    const result = spawnSync(
      "sh",
      ["-c", `node bin/pact-verifier.mjs gc-summary --transcript "${successFixture}"`],
      { cwd: repoRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    if (result.status !== 0) {
      throw new Error(`gc-summary exited ${result.status}: ${result.stderr}`);
    }
    const out = result.stdout.trim();
    const constitutionLine = out.split("\n").find((l) => l.startsWith("Constitution:"));
    const outcomeLine = out.split("\n").find((l) => l.startsWith("Outcome:"));
    if (!constitutionLine || !constitutionLine.startsWith("Constitution: a0ea6fe329251b8c")) {
      throw new Error(`Freeze: expected constitution hash prefix a0ea6fe329251b8c..., got: ${constitutionLine}`);
    }
    if (!outcomeLine || !outcomeLine.includes("COMPLETED")) {
      throw new Error(`Freeze: expected Outcome: COMPLETED, got: ${outcomeLine}`);
    }
    log("   constitution hash + outcome stable");
    log("   ✓ freeze check OK\n");
  } catch (e) {
    err(`freeze check failed: ${e.message}`);
    process.exit(1);
  }

  log("═══════════════════════════════════════════════════════════");
  log("  ✅ All verifier smoke tests passed");
  log("═══════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  err(e.message);
  process.exit(1);
});
