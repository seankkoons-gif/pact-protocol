/**
 * Auditor Pack CLI Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";
import { createHash } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../../..");

// Helper to run CLI
function runCLI(args: string[], cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  const cliPath = resolve(__dirname, "../../cli/auditor_pack.ts");
  try {
    const result = execSync(`npx tsx "${cliPath}" ${args.join(" ")}`, {
      encoding: "utf8",
      cwd: cwd || repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: result, stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      exitCode: error.status || 1,
    };
  }
}

describe("Auditor Pack CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auditor-pack-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("SUCCESS-001-simple.json", () => {
    it("should create a valid ZIP file", async () => {
      const outPath = join(tempDir, "test.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      const result = runCLI(["--transcript", transcriptPath, "--out", outPath]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(outPath)).toBe(true);

      // Verify it's a valid ZIP
      const zipBuffer = readFileSync(outPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      expect(Object.keys(zip.files).length).toBeGreaterThan(0);
    });

    it("should include all required files", async () => {
      const outPath = join(tempDir, "test.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      runCLI(["--transcript", transcriptPath, "--out", outPath]);

      const zipBuffer = readFileSync(outPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      // Check required files
      expect(zip.file("manifest.json")).not.toBeNull();
      expect(zip.file("checksums.sha256")).not.toBeNull();
      expect(zip.file("constitution/CONSTITUTION_v1.md")).not.toBeNull();
      expect(zip.file("input/transcript.json")).not.toBeNull();
      expect(zip.file("derived/gc_view.json")).not.toBeNull();
      expect(zip.file("derived/judgment.json")).not.toBeNull();
      expect(zip.file("derived/insurer_summary.json")).not.toBeNull();
      expect(zip.file("README.txt")).not.toBeNull();
    });

    it("should have valid manifest.json with constitution fields", async () => {
      const outPath = join(tempDir, "test.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      runCLI(["--transcript", transcriptPath, "--out", outPath]);

      const zipBuffer = readFileSync(outPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      const manifestContent = await zip.file("manifest.json")?.async("string");
      expect(manifestContent).toBeDefined();

      const manifest = JSON.parse(manifestContent!);
      
      // Verify constitution fields are present
      expect(manifest.constitution_version).toBeDefined();
      expect(manifest.constitution_version).toBe("constitution/1.0");
      expect(manifest.constitution_hash).toBeDefined();
      expect(typeof manifest.constitution_hash).toBe("string");
      expect(manifest.constitution_hash.length).toBe(64); // SHA-256 hex string
      
      // Verify constitution hash matches gc_view
      const gcViewContent = await zip.file("derived/gc_view.json")?.async("string");
      const gcView = JSON.parse(gcViewContent!);
      expect(manifest.constitution_hash).toBe(gcView.constitution.hash);
      expect(manifest.constitution_version).toBe(gcView.constitution.version);

      // Check required fields
      expect(manifest.package_version).toBe("auditor_pack/1.0");
      expect(manifest.created_at_ms).toBeTypeOf("number");
      expect(manifest.constitution_version).toBe("constitution/1.0");
      expect(manifest.constitution_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.transcript_id).toContain("transcript-");
      expect(manifest.transcript_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.tool_version).toContain("@pact/verifier");
      expect(manifest.included_artifacts).toBeInstanceOf(Array);
      expect(manifest.integrity.hash_chain).toBe("VALID");
      expect(manifest.integrity.signatures_verified.verified).toBe(3);
      expect(manifest.integrity.signatures_verified.total).toBe(3);
      expect(manifest.outcome).toBe("COMPLETED");
      expect(manifest.responsibility.fault_domain).toBe("NO_FAULT");
    });

    it("should have valid checksums", async () => {
      const outPath = join(tempDir, "test.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      runCLI(["--transcript", transcriptPath, "--out", outPath]);

      const zipBuffer = readFileSync(outPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      const checksumsContent = await zip.file("checksums.sha256")?.async("string");
      expect(checksumsContent).toBeDefined();

      const lines = checksumsContent!.trim().split("\n");
      for (const line of lines) {
        const [expectedHash, relativePath] = line.split("  ");
        const fileContent = await zip.file(relativePath)?.async("nodebuffer");
        expect(fileContent).toBeDefined();

        const actualHash = createHash("sha256").update(fileContent!).digest("hex");
        expect(actualHash).toBe(expectedHash);
      }
    });

    it("should have gc_view with COMPLETED status", async () => {
      const outPath = join(tempDir, "test.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      runCLI(["--transcript", transcriptPath, "--out", outPath]);

      const zipBuffer = readFileSync(outPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      const gcViewContent = await zip.file("derived/gc_view.json")?.async("string");
      expect(gcViewContent).toBeDefined();

      const gcView = JSON.parse(gcViewContent!);
      expect(gcView.executive_summary.status).toBe("COMPLETED");
    });
  });

  describe("PACT-101 (Policy Violation)", () => {
    it("should reflect ABORTED status for policy failure", async () => {
      const outPath = join(tempDir, "test.zip");
      const transcriptPath = join(repoRoot, "fixtures/failures/PACT-101-policy-violation.json");

      // Skip if fixture doesn't exist
      if (!existsSync(transcriptPath)) {
        console.warn("Skipping PACT-101 test - fixture not found");
        return;
      }

      runCLI(["--transcript", transcriptPath, "--out", outPath]);

      const zipBuffer = readFileSync(outPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      const manifestContent = await zip.file("manifest.json")?.async("string");
      expect(manifestContent).toBeDefined();

      const manifest = JSON.parse(manifestContent!);

      // PACT-101 should show policy failure status
      expect(manifest.outcome).toMatch(/ABORTED|FAILED/);
    });
  });

  describe("Optional inclusions", () => {
    it("should include passport snapshot when --include-passport is used", async () => {
      const outPath = join(tempDir, "test.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create a transcripts directory with the fixture
      const transcriptsDir = join(tempDir, "transcripts");
      mkdirSync(transcriptsDir, { recursive: true });
      const transcript = readFileSync(transcriptPath, "utf8");
      writeFileSync(join(transcriptsDir, "SUCCESS-001.json"), transcript);

      runCLI([
        "--transcript", transcriptPath,
        "--out", outPath,
        "--include-passport",
        "--transcripts-dir", transcriptsDir
      ]);

      const zipBuffer = readFileSync(outPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      expect(zip.file("derived/passport_snapshot.json")).not.toBeNull();

      const passportContent = await zip.file("derived/passport_snapshot.json")?.async("string");
      const passport = JSON.parse(passportContent!);
      expect(passport.version).toBe("passport_snapshot/1.0");
    });

    it("should include contention report when --include-contention is used", async () => {
      const outPath = join(tempDir, "test.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create a transcripts directory with the fixture
      const transcriptsDir = join(tempDir, "transcripts");
      mkdirSync(transcriptsDir, { recursive: true });
      const transcript = readFileSync(transcriptPath, "utf8");
      writeFileSync(join(transcriptsDir, "SUCCESS-001.json"), transcript);

      runCLI([
        "--transcript", transcriptPath,
        "--out", outPath,
        "--include-contention",
        "--transcripts-dir", transcriptsDir
      ]);

      const zipBuffer = readFileSync(outPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      expect(zip.file("derived/contention_report.json")).not.toBeNull();

      const contentionContent = await zip.file("derived/contention_report.json")?.async("string");
      const contention = JSON.parse(contentionContent!);
      expect(contention.version).toBe("contention_report/1.0");
    });
  });

  describe("Error handling", () => {
    it("should fail if transcript file not found", () => {
      const outPath = join(tempDir, "test.zip");
      const result = runCLI(["--transcript", "/nonexistent/file.json", "--out", outPath]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("not found");
    });

    it("should fail if --include-passport without --transcripts-dir", () => {
      const outPath = join(tempDir, "test.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      const result = runCLI(["--transcript", transcriptPath, "--out", outPath, "--include-passport"]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("--transcripts-dir");
    });
  });
});
