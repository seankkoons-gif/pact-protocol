/**
 * Replay v4 CLI Tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../../..");

function loadFixture(filename: string): any {
  const fixturePath = resolve(repoRoot, "fixtures", filename);
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content);
}

async function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const sdkPath = resolve(repoRoot, "packages", "sdk");
  // Try dist first, fallback to src for development
  let cliScript = join(sdkPath, "dist", "cli", "replay_v4.js");
  if (!existsSync(cliScript)) {
    cliScript = join(sdkPath, "src", "cli", "replay_v4.ts");
  }
  
  // Use execSync to run the CLI
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  
  try {
    const command = cliScript.endsWith(".ts") 
      ? `tsx "${cliScript}" ${args.map(a => `"${a}"`).join(" ")}`
      : `node "${cliScript}" ${args.map(a => `"${a}"`).join(" ")}`;
    
    stdout = execSync(
      command,
      { 
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      }
    );
  } catch (error: any) {
    exitCode = error.status || 1;
    stdout = error.stdout || "";
    stderr = error.stderr || "";
  }
  
  return { stdout, stderr, exitCode };
}

describe("Replay v4 CLI", () => {
  describe("malformed transcript handling", () => {
    it("should handle transcript with missing transcript_version gracefully", async () => {
      const malformedTranscript = {
        transcript_id: "test-123",
        intent_id: "intent-123",
        // Missing transcript_version
        rounds: [],
      };

      const tempDir = join(repoRoot, "tmp_test_replay_malformed_version");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      const transcriptPath = join(tempDir, "malformed.json");
      writeFileSync(transcriptPath, JSON.stringify(malformedTranscript, null, 2));

      try {
        const result = await runCLI([transcriptPath]);
        
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid transcript: missing or invalid transcript_version field");
        expect(result.stderr).toContain("Expected: \"pact-transcript/4.0\"");
        expect(result.stderr).toContain("Got: undefined");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should handle transcript with missing rounds array gracefully", async () => {
      const malformedTranscript = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "test-123",
        intent_id: "intent-123",
        // Missing rounds field
      };

      const tempDir = join(repoRoot, "tmp_test_replay_malformed_rounds");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      const transcriptPath = join(tempDir, "malformed.json");
      writeFileSync(transcriptPath, JSON.stringify(malformedTranscript, null, 2));

      try {
        const result = await runCLI([transcriptPath]);
        
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid transcript: rounds field is missing or not an array");
        expect(result.stderr).toContain("Expected: array");
        expect(result.stderr).toContain("Got: undefined");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should handle transcript with rounds as non-array gracefully", async () => {
      const malformedTranscript = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "test-123",
        intent_id: "intent-123",
        rounds: "not-an-array", // Wrong type
      };

      const tempDir = join(repoRoot, "tmp_test_replay_malformed_rounds_type");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      const transcriptPath = join(tempDir, "malformed.json");
      writeFileSync(transcriptPath, JSON.stringify(malformedTranscript, null, 2));

      try {
        const result = await runCLI([transcriptPath]);
        
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid transcript: rounds field is missing or not an array");
        expect(result.stderr).toContain("Expected: array");
        expect(result.stderr).toContain("Got: string");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should handle transcript with invalid JSON gracefully", async () => {
      const tempDir = join(repoRoot, "tmp_test_replay_invalid_json");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      const transcriptPath = join(tempDir, "invalid.json");
      writeFileSync(transcriptPath, "{ invalid json }");

      try {
        const result = await runCLI([transcriptPath]);
        
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid JSON in transcript file");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should handle transcript that is not an object gracefully", async () => {
      const tempDir = join(repoRoot, "tmp_test_replay_not_object");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      const transcriptPath = join(tempDir, "not-object.json");
      writeFileSync(transcriptPath, '"just a string"');

      try {
        const result = await runCLI([transcriptPath]);
        
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("Invalid transcript: file does not contain a valid JSON object");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("PACT-420/421 provider failure narratives", () => {
    it("should show PROVIDER_AT_FAULT for PACT-420 provider unreachable", async () => {
      let fixture;
      try {
        fixture = loadFixture("failures/PACT-420-provider-unreachable.json");
      } catch {
        // Fixture not available, skip test
        return;
      }

      const tempDir = join(repoRoot, "tmp_test_replay_pact420");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      const transcriptPath = join(tempDir, "PACT-420.json");
      writeFileSync(transcriptPath, JSON.stringify(fixture, null, 2));

      try {
        const result = await runCLI([transcriptPath]);
        const combinedOutput = result.stdout + result.stderr;
        
        // Check for PACT-420 code in output (may be stdout or stderr)
        expect(combinedOutput).toContain("PACT-420");
        
        // Should show PROVIDER_AT_FAULT for PACT-420
        expect(combinedOutput).toContain("PROVIDER_AT_FAULT");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should show PROVIDER_AT_FAULT for PACT-421 provider API mismatch", async () => {
      let fixture;
      try {
        fixture = loadFixture("failures/PACT-421-provider-api-mismatch.json");
      } catch {
        // Fixture not available, skip test
        return;
      }

      const tempDir = join(repoRoot, "tmp_test_replay_pact421");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });

      const transcriptPath = join(tempDir, "PACT-421.json");
      writeFileSync(transcriptPath, JSON.stringify(fixture, null, 2));

      try {
        const result = await runCLI([transcriptPath]);
        const combinedOutput = result.stdout + result.stderr;
        
        // Check for PACT-421 code in output (may be stdout or stderr)
        expect(combinedOutput).toContain("PACT-421");
        
        // Should show PROVIDER_AT_FAULT for PACT-421
        expect(combinedOutput).toContain("PROVIDER_AT_FAULT");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });
});
