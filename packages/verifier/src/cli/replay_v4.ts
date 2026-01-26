#!/usr/bin/env node
/**
 * Wrapper CLI for v4 replay verification
 * 
 * Delegates to the SDK's replay_v4 implementation at
 * packages/sdk/src/cli/replay_v4.ts
 * 
 * This wrapper exists to maintain compatibility with scripts
 * that reference packages/verifier/src/cli/replay_v4.ts
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sdkPath = resolve(__dirname, "../../../sdk/src/cli/replay_v4.ts");

// Handle EPIPE gracefully (e.g., when piping to head/jq)
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

// Forward all arguments to the SDK implementation
// This wrapper is run via: pnpm --filter @pact/sdk exec tsx src/cli/replay_v4.ts
// So we spawn tsx from the SDK directory where dependencies are installed
const args = process.argv.slice(2);
const workspaceRoot = resolve(__dirname, "../../..");
const sdkDir = resolve(workspaceRoot, "packages/sdk");
const child = spawn("tsx", ["src/cli/replay_v4.ts", ...args], {
  stdio: "inherit",
  shell: false,
  cwd: sdkDir, // Run from SDK directory so Node can resolve dependencies
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
