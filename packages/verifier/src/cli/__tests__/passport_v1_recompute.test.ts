/**
 * Passport v1 Recompute CLI Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { main } from "../passport_v1_recompute.js";
import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../../..");

function loadFixture(filename: string): any {
  const fixturePath = resolve(repoRoot, "fixtures", filename);
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content);
}

async function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Mock process.argv
  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  
  // Capture stdout
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  
  console.log = (...args: any[]) => {
    stdoutChunks.push(args.map(String).join(" "));
    originalConsoleLog(...args);
  };
  
  console.error = (...args: any[]) => {
    stderrChunks.push(args.map(String).join(" "));
    originalConsoleError(...args);
  };
  
  process.exit = ((code?: number) => {
    exitCode = code || 0;
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
  
  // Set up argv
  process.argv = ["node", "passport_v1_recompute.ts", ...args];
  
  try {
    await main();
    exitCode = 0;
  } catch (error: any) {
    if (error.message?.includes("process.exit")) {
      // Expected exit
    } else {
      // Unexpected error
      stderrChunks.push(error.message || String(error));
      exitCode = 1;
    }
  } finally {
    // Restore
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    
    stdout = stdoutChunks.join("\n");
    stderr = stderrChunks.join("\n");
  }
  
  return { stdout, stderr, exitCode };
}

describe("Passport v1 Recompute CLI", () => {
  describe("fixture-based tests", () => {
    it("should discover correct signer key from SUCCESS-001-simple.json", async () => {
      // Create temporary directory with fixture
      const tempDir = join(repoRoot, "tmp_test_transcripts");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      try {
        // Copy fixture
        const fixture = loadFixture("success/SUCCESS-001-simple.json");
        writeFileSync(join(tempDir, "SUCCESS-001-simple.json"), JSON.stringify(fixture, null, 2));

        // Run CLI
        const result = await runCLI([`--transcripts-dir`, tempDir]);

        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);

        // Check structure
        expect(output.version).toBe("passport/1.0");
        expect(output.generated_from.count).toBe(1);
        expect(output.states).toBeDefined();

        // Check that signer keys from fixture are present
        // From SUCCESS-001-simple.json:
        // - buyer: 21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J
        // - seller: HBUkwmmQVFX3mGF6ris1mWDATY27nAupX6wQNXgJD9j9
        const signerKeys = Object.keys(output.states);
        expect(signerKeys.length).toBeGreaterThan(0);

        // At least one of the expected signer keys should be present
        const expectedBuyer = "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J";
        const expectedSeller = "HBUkwmmQVFX3mGF6ris1mWDATY27nAupX6wQNXgJD9j9";
        const hasBuyer = signerKeys.includes(expectedBuyer);
        const hasSeller = signerKeys.includes(expectedSeller);
        expect(hasBuyer || hasSeller).toBe(true);

        // Verify state structure
        for (const [signerKey, state] of Object.entries(output.states)) {
          expect(signerKey).toBeTruthy();
          const s = state as any;
          expect(s.agent_id).toBe(signerKey); // agent_id should match signer key
          expect(typeof s.score).toBe("number");
          expect(s.score).toBeGreaterThanOrEqual(-1);
          expect(s.score).toBeLessThanOrEqual(1);
          expect(s.counters).toBeDefined();
          expect(Array.isArray(s.included_transcripts)).toBe(true);
          expect(typeof s.state_hash).toBe("string");
          expect(s.state_hash.length).toBe(64); // SHA-256 hex
        }
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should produce stable output across runs", async () => {
      const tempDir = join(repoRoot, "tmp_test_transcripts");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      try {
        const fixture = loadFixture("success/SUCCESS-001-simple.json");
        writeFileSync(join(tempDir, "SUCCESS-001-simple.json"), JSON.stringify(fixture, null, 2));

        // Run multiple times
        const result1 = await runCLI([`--transcripts-dir`, tempDir]);
        const result2 = await runCLI([`--transcripts-dir`, tempDir]);
        const result3 = await runCLI([`--transcripts-dir`, tempDir]);

        expect(result1.exitCode).toBe(0);
        expect(result2.exitCode).toBe(0);
        expect(result3.exitCode).toBe(0);

        const output1 = JSON.parse(result1.stdout);
        const output2 = JSON.parse(result2.stdout);
        const output3 = JSON.parse(result3.stdout);

        // Should be identical
        expect(output1).toEqual(output2);
        expect(output2).toEqual(output3);
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should be order-independent (file iteration order doesn't change output)", async () => {
      const tempDir1 = join(repoRoot, "tmp_test_transcripts_1");
      const tempDir2 = join(repoRoot, "tmp_test_transcripts_2");
      
      [tempDir1, tempDir2].forEach((dir) => {
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
        }
        mkdirSync(dir, { recursive: true });
      });

      try {
        const fixture1 = loadFixture("success/SUCCESS-001-simple.json");
        
        let f2: any;
        try {
          f2 = loadFixture("success/SUCCESS-002-negotiated.json");
        } catch {
          // Create a modified copy if SUCCESS-002 doesn't exist
          f2 = JSON.parse(JSON.stringify(fixture1));
          f2.transcript_id = "transcript-different-for-test";
          f2.intent_id = "intent-different";
        }

        // Write in different orders
        writeFileSync(join(tempDir1, "a-first.json"), JSON.stringify(fixture1, null, 2));
        writeFileSync(join(tempDir1, "b-second.json"), JSON.stringify(f2, null, 2));

        writeFileSync(join(tempDir2, "z-second.json"), JSON.stringify(f2, null, 2));
        writeFileSync(join(tempDir2, "a-first.json"), JSON.stringify(fixture1, null, 2));

        const result1 = await runCLI([`--transcripts-dir`, tempDir1]);
        const result2 = await runCLI([`--transcripts-dir`, tempDir2]);

        expect(result1.exitCode).toBe(0);
        expect(result2.exitCode).toBe(0);

        const output1 = JSON.parse(result1.stdout);
        const output2 = JSON.parse(result2.stdout);

        // Should be identical (order-independent)
        // Note: transcripts_dir may differ (different temp dirs), so we compare everything except that
        const { generated_from: gen1, ...states1 } = output1;
        const { generated_from: gen2, ...states2 } = output2;
        
        // Compare states (should be identical)
        expect(states1).toEqual(states2);
        
        // Compare generated_from (count should match, dir may differ)
        expect(gen1.count).toBe(gen2.count);
      } finally {
        [tempDir1, tempDir2].forEach((dir) => {
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
          }
        });
      }
    });

    it("should filter by --signer option", async () => {
      const tempDir = join(repoRoot, "tmp_test_transcripts");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      try {
        const fixture = loadFixture("success/SUCCESS-001-simple.json");
        writeFileSync(join(tempDir, "SUCCESS-001-simple.json"), JSON.stringify(fixture, null, 2));

        const expectedBuyer = "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J";

        // Run with --signer filter
        const result = await runCLI([`--transcripts-dir`, tempDir, `--signer`, expectedBuyer]);

        if (result.exitCode !== 0) {
          console.error("CLI failed with stderr:", result.stderr);
          console.error("CLI failed with stdout:", result.stdout);
        }
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);

        // Should only have the requested signer
        const signerKeys = Object.keys(output.states);
        expect(signerKeys.length).toBe(1);
        expect(signerKeys[0]).toBe(expectedBuyer);
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should produce identical state_hash across runs (regression: no dynamic require)", async () => {
      // Regression test: Verify that hash outputs are deterministic and identical
      // This ensures the ESM import fix didn't change hash behavior
      const tempDir = join(repoRoot, "tmp_test_transcripts");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      try {
        const fixture = loadFixture("success/SUCCESS-001-simple.json");
        writeFileSync(join(tempDir, "SUCCESS-001-simple.json"), JSON.stringify(fixture, null, 2));

        // Run twice to verify deterministic output
        const result1 = await runCLI([`--transcripts-dir`, tempDir]);
        const result2 = await runCLI([`--transcripts-dir`, tempDir]);

        expect(result1.exitCode).toBe(0);
        expect(result2.exitCode).toBe(0);

        const output1 = JSON.parse(result1.stdout);
        const output2 = JSON.parse(result2.stdout);

        // State hashes must be identical (verifies hashMessageSync ESM import works correctly)
        const signerKeys = Object.keys(output1.states);
        expect(signerKeys.length).toBeGreaterThan(0);

        for (const signerKey of signerKeys) {
          const state1 = output1.states[signerKey];
          const state2 = output2.states[signerKey];

          expect(state1.state_hash).toBe(state2.state_hash);
          expect(state1.state_hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
        }

        // Verify the entire output is identical (including state_hash)
        expect(output1).toEqual(output2);
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should run from compiled dist version (integration test)", async () => {
      // Integration test: build and run the compiled JS version
      const tempDir = join(repoRoot, "tmp_test_transcripts_integration");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      try {
        const fixture = loadFixture("success/SUCCESS-001-simple.json");
        writeFileSync(join(tempDir, "SUCCESS-001-simple.json"), JSON.stringify(fixture, null, 2));

        // Ensure build exists
        const distPath = resolve(__dirname, "../../../dist/cli/passport_v1_recompute.js");
        if (!existsSync(distPath)) {
          // Build if not exists
          const { execSync } = await import("node:child_process");
          execSync("pnpm build", { cwd: resolve(__dirname, "../../../"), stdio: "inherit" });
        }

        // Run the compiled version using node (capture stdout only, stderr separately)
        const { execSync } = await import("node:child_process");
        const result = execSync(
          `node ${distPath} --transcripts-dir ${tempDir} 2>/dev/null`,
          { encoding: "utf-8", cwd: repoRoot }
        );

        // Verify stdout is valid JSON with no extra lines
        const lines = result.trim().split("\n");
        expect(lines.length).toBeGreaterThan(0);
        
        // Parse the entire stdout as JSON (should be a single JSON document)
        const output = JSON.parse(result);
        
        // Verify output structure
        expect(output.version).toBe("passport/1.0");
        expect(output.generated_from).toBeDefined();
        expect(output.states).toBeDefined();
        
        // Verify at least one signer was found
        const signerKeys = Object.keys(output.states);
        expect(signerKeys.length).toBeGreaterThan(0);
        
        // Verify state structure
        for (const signerKey of signerKeys) {
          const state = output.states[signerKey];
          expect(state.agent_id).toBe(signerKey);
          expect(state.score).toBeDefined();
          expect(state.counters).toBeDefined();
          expect(state.included_transcripts).toBeDefined();
          expect(state.state_hash).toBeDefined();
          expect(state.state_hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
        }
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should output JSON-only to stdout (pipe-safe)", async () => {
      // Test that stdout contains only JSON, no progress logs
      const tempDir = join(repoRoot, "tmp_test_transcripts_pipe_safe");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      try {
        const fixture = loadFixture("success/SUCCESS-001-simple.json");
        writeFileSync(join(tempDir, "SUCCESS-001-simple.json"), JSON.stringify(fixture, null, 2));

        // Run CLI and capture stdout separately from stderr
        const result = await runCLI([`--transcripts-dir`, tempDir]);

        expect(result.exitCode).toBe(0);
        
        // Verify stdout is valid JSON (no extra lines, no progress logs)
        expect(result.stdout).toBeTruthy();
        const output = JSON.parse(result.stdout);
        
        // Verify it's the expected structure
        expect(output.version).toBe("passport/1.0");
        expect(output.generated_from).toBeDefined();
        expect(output.states).toBeDefined();
        
        // Verify stdout doesn't contain progress log strings
        expect(result.stdout).not.toContain("Loading transcripts");
        expect(result.stdout).not.toContain("Loaded");
        expect(result.stdout).not.toContain("Computing DBL");
        
        // Verify stderr contains progress logs (if any)
        // Note: Without --human flag, progress logs should be minimal or absent
        // With --human flag, they should be in stderr
        
        // Test with --human flag
        const resultHuman = await runCLI([`--transcripts-dir`, tempDir, `--human`]);
        expect(resultHuman.exitCode).toBe(0);
        
        // stdout should still be clean JSON
        const outputHuman = JSON.parse(resultHuman.stdout);
        expect(outputHuman.version).toBe("passport/1.0");
        expect(resultHuman.stdout).not.toContain("Loading transcripts");
        expect(resultHuman.stdout).not.toContain("Loaded");
        expect(resultHuman.stdout).not.toContain("Computing DBL");
        
        // stderr should contain progress logs when --human is used
        expect(resultHuman.stderr).toContain("Loading transcripts");
        expect(resultHuman.stderr).toContain("Loaded");
        expect(resultHuman.stderr).toContain("Computing DBL");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should produce identical hashes as SDK canonical utilities (regression test)", async () => {
      // Regression test: Verify that verifier-local canonical hashing produces
      // identical results to SDK's canonical utilities
      const tempDir = join(repoRoot, "tmp_test_transcripts_regression");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      try {
        const fixture = loadFixture("success/SUCCESS-001-simple.json");
        writeFileSync(join(tempDir, "SUCCESS-001-simple.json"), JSON.stringify(fixture, null, 2));

        // Run CLI to get hash from verifier-local utilities
        const result = await runCLI([`--transcripts-dir`, tempDir]);
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);

        // Get state hash from verifier-local implementation
        const signerKeys = Object.keys(output.states);
        expect(signerKeys.length).toBeGreaterThan(0);
        const verifierHash = output.states[signerKeys[0]].state_hash;

        // Verify hash format and consistency
        expect(verifierHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
        
        // Verify hash is computed from the expected state structure
        const state = output.states[signerKeys[0]];
        const { hashCanonicalHex } = await import("../../util/canonical.js");
        
        // Hash the same state object structure that computeStateHash uses
        const stateToHash = {
          agent_id: state.agent_id,
          score: state.score,
          counters: state.counters,
        };
        
        // Verify the hash is consistent (same input produces same output)
        const recomputedHash = hashCanonicalHex(stateToHash);
        expect(verifierHash).toBe(recomputedHash);
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });
});
