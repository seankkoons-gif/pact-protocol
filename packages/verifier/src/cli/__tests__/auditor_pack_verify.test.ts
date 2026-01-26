/**
 * Auditor Pack Verify CLI Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../../..");

// Helper to run auditor-pack CLI
function runAuditorPack(args: string[], cwd?: string): { stdout: string; stderr: string; exitCode: number } {
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

// Helper to run auditor-pack-verify CLI
function runAuditorPackVerify(args: string[], cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  const cliPath = resolve(__dirname, "../../cli/auditor_pack_verify.ts");
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

describe("Auditor Pack Verify CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auditor-pack-verify-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("Valid pack verification", () => {
    it("should pass verification for untampered pack", async () => {
      const zipPath = join(tempDir, "valid.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      const packResult = runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);
      expect(packResult.exitCode).toBe(0);
      expect(existsSync(zipPath)).toBe(true);

      // Verify pack
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(0);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.version).toBe("auditor_pack_verify/1.0");
      expect(report.ok).toBe(true);
      expect(report.checksums_ok).toBe(true);
      expect(report.recompute_ok).toBe(true);
      expect(report.mismatches).toHaveLength(0);
      expect(report.tool_version).toContain("@pact/verifier");
    });

    it("should output report to file when --out is specified", async () => {
      const zipPath = join(tempDir, "valid.zip");
      const reportPath = join(tempDir, "report.json");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Verify pack with --out
      runAuditorPackVerify(["--zip", zipPath, "--out", reportPath]);

      expect(existsSync(reportPath)).toBe(true);
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      expect(report.ok).toBe(true);
    });
  });

  describe("Tampered pack detection", () => {
    it("should fail when gc_view.json is tampered", async () => {
      const zipPath = join(tempDir, "tampered.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Tamper with gc_view.json
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const gcViewContent = await zip.file("derived/gc_view.json")!.async("string");
      const tampered = gcViewContent + "\n/* tampered */";
      zip.file("derived/gc_view.json", tampered);

      const tamperedBuffer = await zip.generateAsync({ type: "nodebuffer" });
      writeFileSync(zipPath, tamperedBuffer);

      // Verify pack should fail
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.checksums_ok).toBe(false);
      expect(report.mismatches.length).toBeGreaterThan(0);
      expect(report.mismatches.some((m: string) => m.includes("gc_view.json"))).toBe(true);
    });

    it("should fail when transcript.json is tampered", async () => {
      const zipPath = join(tempDir, "tampered.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Tamper with transcript.json
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const transcriptContent = await zip.file("input/transcript.json")!.async("string");
      const parsed = JSON.parse(transcriptContent);
      parsed.transcript_id = "tampered-id";
      zip.file("input/transcript.json", JSON.stringify(parsed, null, 2));

      const tamperedBuffer = await zip.generateAsync({ type: "nodebuffer" });
      writeFileSync(zipPath, tamperedBuffer);

      // Verify pack should fail
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
    });

    it("should fail when a required file is missing", async () => {
      const zipPath = join(tempDir, "incomplete.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Remove a required file
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      zip.remove("derived/judgment.json");

      const incompleteBuffer = await zip.generateAsync({ type: "nodebuffer" });
      writeFileSync(zipPath, incompleteBuffer);

      // Verify pack should fail
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.mismatches.some((m: string) => m.includes("judgment.json"))).toBe(true);
    });
  });

  describe("Error handling", () => {
    it("should fail if zip file not found", () => {
      const verifyResult = runAuditorPackVerify(["--zip", "/nonexistent/file.zip"]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.mismatches.some((m: string) => m.includes("not found"))).toBe(true);
    });

    it("should show usage when no arguments provided", () => {
      const verifyResult = runAuditorPackVerify([]);
      expect(verifyResult.exitCode).toBe(1);
      expect(verifyResult.stderr).toContain("Usage:");
    });
  });

  describe("Exit codes", () => {
    it("should exit 0 for valid pack", async () => {
      const zipPath = join(tempDir, "valid.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);

      expect(verifyResult.exitCode).toBe(0);
    });

    it("should exit 1 for invalid pack", async () => {
      const zipPath = join(tempDir, "tampered.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Tamper
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      zip.file("derived/gc_view.json", "{}");
      const tamperedBuffer = await zip.generateAsync({ type: "nodebuffer" });
      writeFileSync(zipPath, tamperedBuffer);

      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);
    });
  });

  describe("Advanced: tampered derived with regenerated checksums", () => {
    it("should detect recompute mismatch when derived content is modified but checksums are updated", async () => {
      const zipPath = join(tempDir, "sneaky-tampered.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Tamper with gc_view.json content (not just append)
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      // Modify gc_view deterministic content
      const gcViewContent = await zip.file("derived/gc_view.json")!.async("string");
      const gcView = JSON.parse(gcViewContent);
      gcView.executive_summary.status = "FAKE_STATUS"; // Tamper with deterministic field
      const tamperedGcView = JSON.stringify(gcView, null, 2);
      zip.file("derived/gc_view.json", tamperedGcView);

      // Regenerate checksums to match tampered files
      const newChecksums: string[] = [];
      const files = Object.keys(zip.files).filter((f) => !f.endsWith("/") && f !== "checksums.sha256");
      for (const file of files.sort()) {
        const content = await zip.file(file)!.async("nodebuffer");
        const hash = createHash("sha256").update(content).digest("hex");
        newChecksums.push(`${hash}  ${file}`);
      }
      zip.file("checksums.sha256", newChecksums.join("\n") + "\n");

      const tamperedBuffer = await zip.generateAsync({ type: "nodebuffer" });
      writeFileSync(zipPath, tamperedBuffer);

      // Verify pack - checksums should pass, but recompute should fail
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.checksums_ok).toBe(true); // Checksums were regenerated
      expect(report.recompute_ok).toBe(false); // But recompute should detect tampering
      expect(report.mismatches.some((m: string) => m.includes("gc_view.json"))).toBe(true);
    });
  });
});
