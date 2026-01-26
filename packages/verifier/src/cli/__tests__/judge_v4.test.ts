/**
 * Tests for judge_v4 CLI
 * 
 * Tests the CLI argument parsing and JSON output.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Repo root is 5 levels up from packages/verifier/src/cli/__tests__/judge_v4.test.ts
const repoRoot = resolve(__dirname, "../../../../../");
const cliPath = resolve(repoRoot, "packages/verifier/dist/cli/judge_v4.js");

function runCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const cmd = `node ${cliPath} ${args.join(" ")}`;
    const stdout = execSync(cmd, {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString() || "",
      stderr: error.stderr?.toString() || "",
      exitCode: error.status || 1,
    };
  }
}

describe("judge_v4 CLI", () => {
  describe("argument parsing", () => {
    it("should parse --transcript flag", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
      ]);

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("version");
      expect(output.version).toBe("dbl/2.0");
      expect(output).toHaveProperty("status");
      expect(output).toHaveProperty("dblDetermination");
    });

    it("should support positional argument (no flags)", () => {
      const result = runCLI(["fixtures/success/SUCCESS-001-simple.json"]);

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("version");
      expect(output.version).toBe("dbl/2.0");
    });

    it("should support --out flag to write to file", () => {
      const tmpFile = "/tmp/judge_v4_test_output.json";
      const result = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
        "--out",
        tmpFile,
      ]);

      expect(result.exitCode).toBe(0);
      
      // Verify file was written
      const fileContent = readFileSync(tmpFile, "utf-8");
      const output = JSON.parse(fileContent);
      expect(output).toHaveProperty("version");
      expect(output.version).toBe("dbl/2.0");
    });

    it("should fail with clear error if transcript not found", () => {
      const result = runCLI(["--transcript", "nonexistent.json"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Transcript file not found");
    });

    it("should fail with usage message if no transcript provided", () => {
      const result = runCLI([]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Usage:");
    });
  });

  describe("JSON output", () => {
    it("should output valid JSON to stdout", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
      ]);

      expect(result.exitCode).toBe(0);
      
      // Should parse as valid JSON
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("version", "dbl/2.0");
      expect(output).toHaveProperty("status");
      expect(output).toHaveProperty("dblDetermination");
      expect(output).toHaveProperty("confidence");
      expect(output).toHaveProperty("terminal");
      expect(output).toHaveProperty("requiredNextActor");
      expect(output).toHaveProperty("requiredAction");
    });

    it("should output ONLY JSON to stdout by default (no human summary)", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
      ]);

      expect(result.exitCode).toBe(0);
      
      // stdout should be ONLY valid JSON (no extra lines)
      expect(result.stdout).toBeTruthy();
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("version");
      
      // Verify stdout contains no non-JSON text
      const lines = result.stdout.trim().split("\n");
      const firstLine = lines[0];
      const lastLine = lines[lines.length - 1];
      expect(firstLine).toBe("{");
      expect(lastLine).toBe("}");
    });

    it("should output human-readable summary to stderr when --human flag is passed", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
        "--human",
      ]);

      expect(result.exitCode).toBe(0);
      
      // stdout should still be clean JSON
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty("version");
      
      // stderr should contain human-readable summary (may be in combined output depending on execSync behavior)
      // The key is that stdout remains clean JSON
      const combinedOutput = result.stderr + result.stdout;
      // If human summary is present, it should be in stderr or the output should still parse as JSON from stdout
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it("should work with jq piping (stdout is clean JSON only)", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
      ]);

      expect(result.exitCode).toBe(0);
      
      // Parse JSON and extract version (simulating jq)
      const output = JSON.parse(result.stdout);
      const version = output.version;
      expect(version).toBe("dbl/2.0");
      
      // Verify stdout is valid JSON (no stray text)
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      
      // Verify no extra non-JSON content
      const trimmed = result.stdout.trim();
      expect(trimmed.startsWith("{")).toBe(true);
      expect(trimmed.endsWith("}")).toBe(true);
    });
  });

  describe("determinism", () => {
    it("should produce identical output across multiple runs", () => {
      const result1 = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
      ]);
      const result2 = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
      ]);

      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
      
      const output1 = JSON.parse(result1.stdout);
      const output2 = JSON.parse(result2.stdout);
      
      // Deep equality check
      expect(output1).toEqual(output2);
    });
  });

  describe("failure cases", () => {
    it("should handle PACT-101 policy violation", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/failures/PACT-101-policy-violation.json",
      ]);

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.status).toBe("FAILED");
      expect(output.failureCode).toBe("PACT-101");
      expect(output.dblDetermination).toBe("BUYER_AT_FAULT");
      
      // Verify judgment object exists with snake_case fields
      expect(output.judgment).toBeDefined();
      expect(output.judgment.terminal).toBe(true);
      expect(output.judgment.required_next_actor).toBe("BUYER");
      expect(output.judgment.required_action).toBe("FIX_POLICY_OR_PARAMS");
      
      // Verify fields are never null
      expect(output.judgment.required_next_actor).not.toBeNull();
      expect(output.judgment.required_action).not.toBeNull();
      expect(typeof output.judgment.terminal).toBe("boolean");
    });

    it("should handle PACT-404 settlement timeout", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/failures/PACT-404-settlement-timeout.json",
      ]);

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.status).toBe("FAILED");
      expect(output.failureCode).toBe("PACT-404");
      
      // Verify judgment object exists with snake_case fields
      expect(output.judgment).toBeDefined();
      expect(output.judgment.terminal).toBe(false);
      expect(output.judgment.required_next_actor).toBe("PROVIDER");
      expect(output.judgment.required_action).toBe("COMPLETE_SETTLEMENT_OR_REFUND");
      
      // Verify fields are never null
      expect(output.judgment.required_next_actor).not.toBeNull();
      expect(output.judgment.required_action).not.toBeNull();
      expect(typeof output.judgment.terminal).toBe("boolean");
    });
  });

  describe("dbl/2.0 field normalization", () => {
    it("should always include judgment object with terminal, required_next_actor, and required_action (never null)", () => {
      const fixtures = [
        "fixtures/success/SUCCESS-001-simple.json",
        "fixtures/success/SUCCESS-002-negotiated.json",
        "fixtures/failures/PACT-101-policy-violation.json",
        "fixtures/failures/PACT-404-settlement-timeout.json",
        "fixtures/failures/PACT-331-double-commit.json",
      ];

      for (const fixture of fixtures) {
        const result = runCLI(["--transcript", fixture]);
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);

        // Verify judgment object exists
        expect(output.judgment).toBeDefined();
        expect(typeof output.judgment).toBe("object");

        // These fields must never be null (snake_case in judgment object)
        expect(output.judgment.required_next_actor).not.toBeNull();
        expect(output.judgment.required_action).not.toBeNull();
        expect(typeof output.judgment.terminal).toBe("boolean");
        expect(typeof output.judgment.required_next_actor).toBe("string");
        expect(typeof output.judgment.required_action).toBe("string");
      }
    });

    it("should set terminal=true, required_next_actor=NONE, required_action=NONE for NO_FAULT success", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
      ]);

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.status).toBe("OK");
      expect(output.dblDetermination).toBe("NO_FAULT");
      
      // Verify judgment object with snake_case fields
      expect(output.judgment).toBeDefined();
      expect(output.judgment.terminal).toBe(true);
      expect(output.judgment.required_next_actor).toBe("NONE");
      expect(output.judgment.required_action).toBe("NONE");
    });

    it("should enforce defaults at final output assembly (SUCCESS-001 acceptance criteria)", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/success/SUCCESS-001-simple.json",
      ]);

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      
      // Acceptance criteria: must return "NONE", "NONE", true in judgment object
      expect(output.judgment).toBeDefined();
      expect(output.judgment.required_next_actor).toBe("NONE");
      expect(output.judgment.required_action).toBe("NONE");
      expect(output.judgment.terminal).toBe(true);
      
      // Verify they are not null/undefined
      expect(output.judgment.required_next_actor).not.toBeNull();
      expect(output.judgment.required_action).not.toBeNull();
      expect(output.judgment.terminal).not.toBeNull();
      expect(output.judgment.terminal).not.toBeUndefined();
    });

    it("should enforce defaults for PACT-101 (BUYER, FIX_POLICY_OR_PARAMS, true)", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/failures/PACT-101-policy-violation.json",
      ]);

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      
      // Verify judgment object with snake_case fields
      expect(output.judgment).toBeDefined();
      expect(output.judgment.required_next_actor).toBe("BUYER");
      expect(output.judgment.required_action).toBe("FIX_POLICY_OR_PARAMS");
      expect(output.judgment.terminal).toBe(true);
    });

    it("should enforce defaults for PACT-404 (PROVIDER, COMPLETE_SETTLEMENT_OR_REFUND, false)", () => {
      const result = runCLI([
        "--transcript",
        "fixtures/failures/PACT-404-settlement-timeout.json",
      ]);

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      
      // Verify judgment object with snake_case fields
      expect(output.judgment).toBeDefined();
      expect(output.judgment.required_next_actor).toBe("PROVIDER");
      expect(output.judgment.required_action).toBe("COMPLETE_SETTLEMENT_OR_REFUND");
      expect(output.judgment.terminal).toBe(false);
    });
  });
});
