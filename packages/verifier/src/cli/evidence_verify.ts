#!/usr/bin/env node
/**
 * Wrapper CLI for evidence verification
 * 
 * Delegates to the SDK's evidence_verify implementation at
 * packages/sdk/src/cli/evidence_verify.ts
 * 
 * This wrapper exists to maintain compatibility with scripts
 * that reference packages/verifier/src/cli/evidence_verify.ts
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sdkPath = resolve(__dirname, "../../../sdk/src/cli/evidence_verify.ts");

// Forward all arguments to the SDK implementation
const args = process.argv.slice(2);
const child = spawn("tsx", [sdkPath, ...args], {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
