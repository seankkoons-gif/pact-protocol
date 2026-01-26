#!/usr/bin/env node
/**
 * Release Proof: demo:v4:gc
 *
 * Single-command release proof:
 * 1. Start provider (or assert it's running)
 * 2. Run buyer success
 * 3. Replay v4
 * 4. gc_view and print constitution hash + NO_FAULT
 *
 * Uses canonical (quickstart) demo by default—no provider required.
 * Set USE_PROVIDER=1 to use provider-backed demo; then provider must
 * be reachable (providers.jsonl + health check).
 *
 * Usage: pnpm demo:v4:gc
 */

import { execSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const TRANSCRIPTS_DIR = join(REPO_ROOT, ".pact", "transcripts");
const PROVIDERS_PATH = join(REPO_ROOT, "providers.jsonl");

function run(cmd, opts = {}) {
  const { silent } = opts;
  return execSync(cmd, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: silent ? "pipe" : "inherit",
  });
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    if (e.stderr) process.stderr.write(e.stderr);
    throw e;
  }
}

function log(msg) {
  console.log(msg);
}

function err(msg) {
  console.error(msg);
}

async function checkProviderHealth(endpoint) {
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

function getFirstProviderEndpoint() {
  if (!existsSync(PROVIDERS_PATH)) return null;
  const content = readFileSync(PROVIDERS_PATH, "utf8");
  const lines = content.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (rec.intentType === "weather.data" && rec.endpoint) return rec.endpoint;
    } catch {
      /* skip malformed */
    }
  }
  return null;
}

function ensureVerifierBuilt() {
  const gcPath = join(REPO_ROOT, "packages", "verifier", "dist", "cli", "gc_view.js");
  if (!existsSync(gcPath)) {
    log("   Building verifier...");
    run("pnpm verifier:build");
  }
}

function latestTranscript() {
  if (!existsSync(TRANSCRIPTS_DIR)) return null;
  const files = readdirSync(TRANSCRIPTS_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("error-"))
    .map((f) => ({
      path: join(TRANSCRIPTS_DIR, f),
      mtime: statSync(join(TRANSCRIPTS_DIR, f)).mtimeMs,
    }));
  if (files.length === 0) return null;
  files.sort((a, b) => b.mtime - a.mtime);
  return files[0].path;
}

async function main() {
  log("═══════════════════════════════════════════════════════════");
  log("  PACT v4 Release Proof (demo:v4:gc)");
  log("═══════════════════════════════════════════════════════════\n");

  const useProvider = process.env.USE_PROVIDER === "1";
  const endpoint = useProvider ? getFirstProviderEndpoint() : null;

  if (useProvider && endpoint) {
    log("1. Provider (assert running)");
    const healthy = await checkProviderHealth(endpoint);
    if (!healthy) {
      err(`   Provider not reachable at ${endpoint}`);
      err("   Start with: pnpm example:provider:weather");
      err("   Register with: pnpm provider:register -- --intent weather.data --pubkey <pubkey> --endpoint " + endpoint);
      process.exit(1);
    }
    log(`   ✓ Provider reachable at ${endpoint}\n`);
  } else {
    log("1. Provider");
    log("   Using canonical demo (no provider). Set USE_PROVIDER=1 for provider-backed.\n");
  }

  log("2. Buyer success");
  const pactDir = join(REPO_ROOT, ".pact");
  if (existsSync(pactDir)) {
    try {
      rmSync(pactDir, { recursive: true, force: true });
    } catch (_) {}
  }

  const demoScript = useProvider && endpoint
    ? "examples/v4/provider-backed-weather-demo.ts"
    : "examples/v4/quickstart-demo.ts";
  const demo = spawnSync("pnpm", ["-w", "exec", "tsx", demoScript], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (demo.status !== 0) {
    err("   Buyer demo failed (exit " + demo.status + ")");
    process.exit(1);
  }
  log("   ✓ Buyer success\n");

  let transcriptPath = latestTranscript();
  if (!transcriptPath || !existsSync(transcriptPath)) {
    err("   Could not find transcript path");
    process.exit(1);
  }

  log("3. Replay v4");
  try {
    run(`pnpm replay:v4 "${transcriptPath}"`);
  } catch {
    err("   Replay failed");
    process.exit(1);
  }
  log("   ✓ Replay OK\n");

  log("4. gc_view (constitution hash + NO_FAULT)");
  ensureVerifierBuilt();
  const gcPath = join(REPO_ROOT, "packages", "verifier", "dist", "cli", "gc_view.js");
  let gcJson;
  try {
    gcJson = runSilent(`node "${gcPath}" --transcript "${transcriptPath}"`);
  } catch (e) {
    err("   gc_view failed");
    if (e.stderr) process.stderr.write(e.stderr);
    process.exit(1);
  }

  let gc;
  try {
    gc = JSON.parse(gcJson);
  } catch {
    err("   gc_view output is not valid JSON");
    process.exit(1);
  }

  const hash = gc.constitution?.hash;
  const fault = gc.responsibility?.judgment?.fault_domain ?? gc.responsibility?.judgment?.dblDetermination;

  if (!hash) {
    err("   Missing constitution.hash in gc_view output");
    process.exit(1);
  }

  log(`   constitution_hash: ${hash}`);
  log(`   fault_domain: ${fault ?? "(missing)"}`);

  if (fault !== "NO_FAULT") {
    err("   Expected fault_domain NO_FAULT, got: " + (fault || "undefined"));
    process.exit(1);
  }
  log("   ✓ NO_FAULT\n");

  log("═══════════════════════════════════════════════════════════");
  log("  ✅ Release proof passed");
  log("═══════════════════════════════════════════════════════════\n");
  log("  constitution_hash: " + hash);
  log("  fault_domain: NO_FAULT");
  log("  transcript: " + transcriptPath + "\n");
}

main().catch((e) => {
  err(e?.message || e);
  process.exit(1);
});
