#!/usr/bin/env node
/**
 * Release Gate Script
 * 
 * Runs the full release gate sequence:
 * 1. Clean .pact directory
 * 2. Build packages
 * 3. Run tests
 * 4. Check pack
 * 5. Run all examples
 * 6. Verify transcripts (strict + terminal-only)
 * 
 * Fails fast on any nonzero exit.
 */

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, rmSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

function runCommand(cmd, description) {
  console.log(`\n=== ${description} ===`);
  try {
    execSync(cmd, {
      cwd: repoRoot,
      stdio: "inherit",
    });
    console.log(`✅ ${description} passed\n`);
  } catch (error) {
    console.error(`\n❌ ${description} failed`);
    process.exit(1);
  }
}

console.log("🚀 Starting Release Gate\n");

// Step 1: Clean .pact directory
const pactDir = join(repoRoot, ".pact");
if (existsSync(pactDir)) {
  console.log("🧹 Cleaning .pact directory...");
  rmSync(pactDir, { recursive: true, force: true });
  console.log("✅ .pact directory cleaned\n");
} else {
  console.log("ℹ️  .pact directory does not exist, skipping cleanup\n");
}

// Step 2: Build
runCommand("pnpm build", "Build");

// Step 3: Test
runCommand("pnpm test", "Tests");

// Step 4: Pack check
runCommand("pnpm pack:check", "Pack Check");

// Step 5: Run all examples
runCommand("pnpm examples:all", "Examples");

// Step 6: Verify transcripts (strict + terminal-only)
runCommand("pnpm replay:verify:strict-terminal", "Transcript Verification");

console.log("\n✅ Release Gate: All checks passed!");
process.exit(0);



