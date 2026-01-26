#!/usr/bin/env node
/**
 * Pact Verifier CLI - Standalone Entrypoint
 *
 * Single executable for the @pact/verifier package.
 * Dispatches to subcommands without monorepo tooling.
 *
 * Usage:
 *   pact-verifier gc-view --transcript <path>
 *   pact-verifier gc-summary --transcript <path>
 *   pact-verifier insurer-summary --transcript <path>
 *   pact-verifier judge-v4 --transcript <path>
 *   pact-verifier passport-v1-recompute --transcripts-dir <dir>
 *   pact-verifier contention-scan --transcripts-dir <dir>
 */

// EPIPE handler for pipe safety
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

const subcommand = process.argv[2];

const subcommands: Record<string, () => Promise<void>> = {
  "auditor-pack": async () => {
    const { main } = await import("../cli/auditor_pack.js");
    await main();
  },
  "auditor-pack-verify": async () => {
    const { main } = await import("../cli/auditor_pack_verify.js");
    await main();
  },
  "gc-view": async () => {
    const { main } = await import("../cli/gc_view.js");
    await main();
  },
  "gc-summary": async () => {
    const { main } = await import("../cli/gc_summary.js");
    await main();
  },
  "insurer-summary": async () => {
    const { main } = await import("../cli/insurer_summary.js");
    await main();
  },
  "judge-v4": async () => {
    // judge_v4 uses IIFE pattern, import will execute it
    await import("../cli/judge_v4.js");
  },
  "passport-v1-recompute": async () => {
    const { main } = await import("../cli/passport_v1_recompute.js");
    await main();
  },
  "contention-scan": async () => {
    // contention_scan uses IIFE pattern, import will execute it
    await import("../cli/contention_scan.js");
  },
};

function printUsage(): void {
  console.error("Usage: pact-verifier <subcommand> [args...]");
  console.error("");
  console.error("Available subcommands:");
  for (const cmd of Object.keys(subcommands).sort()) {
    console.error(`  ${cmd}`);
  }
  console.error("");
  console.error("Examples:");
  console.error("  pact-verifier gc-view --transcript transcript.json");
  console.error("  pact-verifier gc-summary --transcript transcript.json");
  console.error("  pact-verifier insurer-summary --transcript transcript.json");
  console.error("  pact-verifier judge-v4 --transcript transcript.json");
  console.error("  pact-verifier passport-v1-recompute --transcripts-dir ./transcripts");
  console.error("  pact-verifier contention-scan --transcripts-dir ./transcripts");
  console.error("  pact-verifier auditor-pack --transcript transcript.json --out evidence.zip");
  console.error("  pact-verifier auditor-pack-verify --zip evidence.zip");
}

async function main(): Promise<void> {
  if (!subcommand || subcommand === "-h" || subcommand === "--help") {
    printUsage();
    process.exit(subcommand ? 0 : 1);
  }

  const handler = subcommands[subcommand];
  if (!handler) {
    console.error(`Error: Unknown subcommand: ${subcommand}`);
    console.error("");
    printUsage();
    process.exit(1);
  }

  // Shift argv so subcommand sees its args starting at index 2
  process.argv = [process.argv[0], process.argv[1], ...process.argv.slice(3)];

  try {
    await handler();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
