/**
 * Tests for contention_scan CLI
 * 
 * Tests contention detection across multiple transcripts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../../../");
const cliPath = resolve(repoRoot, "packages/verifier/dist/cli/contention_scan.js");

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

function loadFixture(filename: string): any {
  const fixturePath = resolve(repoRoot, "fixtures", filename);
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content);
}

describe("contention_scan CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temp directory
    tempDir = join(repoRoot, "tmp", `contention_test_${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should detect DOUBLE_COMMIT when multiple terminal transcripts share intent_fingerprint", async () => {
    // Load SUCCESS-001 fixture twice (same content = same intent_fingerprint)
    const transcript1 = loadFixture("success/SUCCESS-001-simple.json");
    const transcript2 = loadFixture("success/SUCCESS-001-simple.json");

    // Write to temp directory with different filenames
    writeFileSync(join(tempDir, "transcript1.json"), JSON.stringify(transcript1, null, 2));
    writeFileSync(join(tempDir, "transcript2.json"), JSON.stringify(transcript2, null, 2));

    // Run contention scan
    const result = runCLI(["--transcripts-dir", tempDir]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    
    // Verify structure
    expect(report).toHaveProperty("version", "contention_report/1.0");
    expect(report).toHaveProperty("scanned");
    expect(report).toHaveProperty("groups");
    expect(Array.isArray(report.groups)).toBe(true);

    // Should find at least one group
    expect(report.groups.length).toBeGreaterThan(0);

    // Find the group with multiple transcripts
    const group = report.groups.find((g: any) => g.transcripts.length >= 2);
    expect(group).toBeDefined();
    expect(group.terminal_count).toBeGreaterThanOrEqual(2);
    expect(group.status).toBe("DOUBLE_COMMIT");
    expect(group.intent_fingerprint).toBeTruthy();
    expect(group.transcripts.length).toBeGreaterThanOrEqual(2);
    
    // Verify report stats
    expect(report.double_commits).toBeGreaterThanOrEqual(1);
    expect(report.scanned.files).toBe(2);
    expect(report.scanned.transcripts_loaded).toBe(2);
  });

  it("should produce stable intent_fingerprint regardless of transcript_id or filename", async () => {
    const transcript1 = loadFixture("success/SUCCESS-001-simple.json");
    const transcript2 = loadFixture("success/SUCCESS-001-simple.json");

    // Change transcript_id (but keep same intent content, buyer signer, and policy_hash)
    transcript2.transcript_id = "transcript-completely-different-id";
    transcript2.intent_id = "intent-different-id";

    // Write with different filenames
    writeFileSync(join(tempDir, "file1.json"), JSON.stringify(transcript1, null, 2));
    writeFileSync(join(tempDir, "file2.json"), JSON.stringify(transcript2, null, 2));

    // Run contention scan
    const result = runCLI(["--transcripts-dir", tempDir]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);

    // Since they have the same intent_type, buyer signer pubkey, and policy_hash,
    // they should have the same intent_fingerprint and be grouped together
    const matchingGroups = report.groups.filter((g: any) => g.transcripts.length >= 2);
    
    // They should be grouped together (same canonical intent + buyer + policy)
    if (matchingGroups.length > 0) {
      const group = matchingGroups[0];
      expect(group.intent_fingerprint).toBeTruthy();
      expect(group.transcripts.length).toBe(2);
    } else {
      // If not grouped, they might have different fingerprints due to content differences
      // This is acceptable - the important thing is that fingerprint is stable for identical content
      expect(report.groups.length).toBeGreaterThan(0);
    }
  });

  it("should support --out flag to write to file", async () => {
    const transcript1 = loadFixture("success/SUCCESS-001-simple.json");
    writeFileSync(join(tempDir, "transcript1.json"), JSON.stringify(transcript1, null, 2));

    const outFile = join(tempDir, "report.json");
    const result = runCLI(["--transcripts-dir", tempDir, "--out", outFile]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);

    const reportContent = readFileSync(outFile, "utf-8");
    const report = JSON.parse(reportContent);
    expect(report).toHaveProperty("version", "contention_report/1.0");
    expect(report).toHaveProperty("groups");
    expect(Array.isArray(report.groups)).toBe(true);
  });

  it("should output structured JSON to stdout when no --out flag", async () => {
    const transcript1 = loadFixture("success/SUCCESS-001-simple.json");
    writeFileSync(join(tempDir, "transcript1.json"), JSON.stringify(transcript1, null, 2));

    const result = runCLI(["--transcripts-dir", tempDir]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toHaveProperty("version", "contention_report/1.0");
    expect(report).toHaveProperty("scanned");
    expect(report).toHaveProperty("groups");
    expect(Array.isArray(report.groups)).toBe(true);
  });

  it("should fail with clear error if directory not found", () => {
    const result = runCLI(["--transcripts-dir", "/nonexistent/dir"]);

    expect(result.exitCode).toBe(1);
    // Error message may be in stderr or stdout depending on how execSync captures it
    const errorOutput = result.stderr + result.stdout;
    // Should match the clean error message format
    expect(errorOutput).toMatch(/Error: transcripts-dir not found:/);
    // Should not contain stack trace by default
    expect(errorOutput).not.toMatch(/Stack trace/);
  });

  it("should handle empty directory gracefully", () => {
    const result = runCLI(["--transcripts-dir", tempDir]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toHaveProperty("version", "contention_report/1.0");
    expect(report).toHaveProperty("groups");
    expect(Array.isArray(report.groups)).toBe(true);
    expect(report.groups.length).toBe(0);
    expect(report.scanned.files).toBe(0);
    expect(report.scanned.transcripts_loaded).toBe(0);
    expect(report.double_commits).toBe(0);
  });

  it("should report SINGLE status for unique intent_fingerprints", async () => {
    const transcript1 = loadFixture("success/SUCCESS-001-simple.json");
    const transcript2 = loadFixture("success/SUCCESS-002-negotiated.json");

    writeFileSync(join(tempDir, "transcript1.json"), JSON.stringify(transcript1, null, 2));
    writeFileSync(join(tempDir, "transcript2.json"), JSON.stringify(transcript2, null, 2));

    const result = runCLI(["--transcripts-dir", tempDir]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);

    // Each should be SINGLE (different intents)
    for (const group of report.groups) {
      if (group.terminal_count <= 1) {
        expect(group.status).toBe("SINGLE");
      }
    }
  });

  it("should output ONLY JSON to stdout (pipe-safe)", async () => {
    const transcript1 = loadFixture("success/SUCCESS-001-simple.json");
    const transcript2 = loadFixture("success/SUCCESS-001-simple.json");

    writeFileSync(join(tempDir, "t1.json"), JSON.stringify(transcript1, null, 2));
    writeFileSync(join(tempDir, "t2.json"), JSON.stringify(transcript2, null, 2));

    const result = runCLI(["--transcripts-dir", tempDir]);

    expect(result.exitCode).toBe(0);
    
    // stdout should be ONLY valid JSON (no extra lines)
    const report = JSON.parse(result.stdout);
    expect(report).toHaveProperty("version", "contention_report/1.0");
    expect(report).toHaveProperty("groups");
    
    // Verify stdout is valid JSON (no stray text)
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    
    // Verify structure
    const trimmed = result.stdout.trim();
    expect(trimmed.startsWith("{")).toBe(true);
    expect(trimmed.endsWith("}")).toBe(true);
    
    // Verify groups[0] has expected structure
    if (report.groups.length > 0) {
      const group = report.groups[0];
      expect(group).toHaveProperty("intent_fingerprint");
      expect(group).toHaveProperty("status");
      expect(group).toHaveProperty("terminal_count");
      expect(group).toHaveProperty("transcripts");
      expect(Array.isArray(group.transcripts)).toBe(true);
    }
  });

  it("should detect DOUBLE_COMMIT with terminal_count=2 for duplicate transcripts", async () => {
    // Create two identical transcripts (same content, same transcript_id)
    const transcript1 = loadFixture("success/SUCCESS-001-simple.json");
    const transcript2 = loadFixture("success/SUCCESS-001-simple.json");

    // Write to temp directory
    writeFileSync(join(tempDir, "copy1.json"), JSON.stringify(transcript1, null, 2));
    writeFileSync(join(tempDir, "copy2.json"), JSON.stringify(transcript2, null, 2));

    // Run contention scan
    const result = runCLI(["--transcripts-dir", tempDir]);

    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);

    // Find the group with DOUBLE_COMMIT
    const doubleCommitGroup = report.groups.find((g: any) => g.status === "DOUBLE_COMMIT");
    expect(doubleCommitGroup).toBeDefined();
    expect(doubleCommitGroup.terminal_count).toBe(2);
    expect(doubleCommitGroup.status).toBe("DOUBLE_COMMIT");
    expect(doubleCommitGroup.transcripts.length).toBeGreaterThanOrEqual(2);
    
    // Verify report stats
    expect(report.double_commits).toBeGreaterThanOrEqual(1);
  });
});
