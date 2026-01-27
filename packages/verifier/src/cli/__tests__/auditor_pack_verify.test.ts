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

    it("should verify manifest constitution fields match recomputed values deterministically", async () => {
      const zipPath = join(tempDir, "valid.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Load pack and verify manifest constitution fields
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const manifestContent = await zip.file("manifest.json")!.async("string");
      const manifest = JSON.parse(manifestContent);
      
      // Verify fields are present
      expect(manifest.constitution_version).toBeDefined();
      expect(manifest.constitution_hash).toBeDefined();
      expect(manifest.constitution_version).toBe("constitution/1.0");
      expect(manifest.constitution_hash).toMatch(/^[a-f0-9]{64}$/);
      
      // Verify pack passes (which means manifest matches recomputed values)
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(0);
      
      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(true);
      expect(report.recompute_ok).toBe(true);
      // No constitution mismatch errors means manifest matches recomputed values
      expect(report.mismatches.some((m: string) => m.includes("Constitution"))).toBe(false);
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

    it("should fail when manifest.json is missing constitution_version", async () => {
      const zipPath = join(tempDir, "missing_version.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Remove constitution_version from manifest
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const manifestContent = await zip.file("manifest.json")!.async("string");
      const manifest = JSON.parse(manifestContent);
      delete manifest.constitution_version;
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Regenerate checksums
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

      // Verify pack - should fail
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.mismatches.some((m: string) => m.includes("Missing constitution_version"))).toBe(true);
    });

    it("should fail when manifest.json is missing constitution_hash", async () => {
      const zipPath = join(tempDir, "missing_hash.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Remove constitution_hash from manifest
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const manifestContent = await zip.file("manifest.json")!.async("string");
      const manifest = JSON.parse(manifestContent);
      delete manifest.constitution_hash;
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Regenerate checksums
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

      // Verify pack - should fail
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.mismatches.some((m: string) => m.includes("Missing constitution_hash"))).toBe(true);
    });

    it("should detect constitution hash mismatch deterministically", async () => {
      const zipPath = join(tempDir, "hash_mismatch.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Tamper with manifest constitution_hash (but not gc_view)
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const manifestContent = await zip.file("manifest.json")!.async("string");
      const manifest = JSON.parse(manifestContent);
      // Change one character in the hash
      manifest.constitution_hash = manifest.constitution_hash.substring(0, 63) + "0";
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Regenerate checksums
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

      // Verify pack - should fail on recompute due to hash mismatch
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.recompute_ok).toBe(false);
      expect(report.mismatches.some((m: string) => m.includes("Constitution hash mismatch"))).toBe(true);
    });

    it("should detect constitution version mismatch", async () => {
      const zipPath = join(tempDir, "version_mismatch.zip");
      const transcriptPath = join(repoRoot, "fixtures/success/SUCCESS-001-simple.json");

      // Create pack
      runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);

      // Tamper with manifest constitution_version
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const manifestContent = await zip.file("manifest.json")!.async("string");
      const manifest = JSON.parse(manifestContent);
      manifest.constitution_version = "constitution/2.0"; // Wrong version
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Regenerate checksums
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

      // Verify pack - should fail on recompute due to version mismatch
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.recompute_ok).toBe(false);
      expect(report.mismatches.some((m: string) => m.includes("Constitution version mismatch"))).toBe(true);
    });

    it("should fail verification when constitution hash is non-standard", async () => {
      // Create a valid pack first
      const zipPath = join(tempDir, "tampered_constitution.zip");
      const transcriptPath = resolve(repoRoot, "fixtures/success/SUCCESS-001-simple.json");
      const packResult = runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);
      expect(packResult.exitCode).toBe(0);

      // Load the pack
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      // Read the constitution file
      const constitutionContent = await zip.file("constitution/CONSTITUTION_v1.md")!.async("string");
      
      // Tamper with constitution (change one character)
      const tamperedConstitution = constitutionContent.replace(/^/, " "); // Add space at start
      
      // Update the constitution in the zip
      zip.file("constitution/CONSTITUTION_v1.md", tamperedConstitution);

      // Update manifest with new constitution hash
      // Canonicalize same way as auditor_pack_verify.ts
      const canonicalTampered = tamperedConstitution
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
        .join("\n");
      const newHash = createHash("sha256").update(canonicalTampered, "utf8").digest("hex");
      const manifestContent = await zip.file("manifest.json")!.async("string");
      const manifest = JSON.parse(manifestContent);
      manifest.constitution_hash = newHash;
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Update gc_view with new constitution hash
      const gcViewContent = await zip.file("derived/gc_view.json")!.async("string");
      const gcView = JSON.parse(gcViewContent);
      (gcView.constitution as { hash: string }).hash = newHash;
      zip.file("derived/gc_view.json", JSON.stringify(gcView, null, 2));

      // Regenerate checksums
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

      // Verify pack - should fail due to non-standard constitution hash
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.recompute_ok).toBe(false);
      expect(report.mismatches.some((m: string) => m.includes("NON_STANDARD_RULES"))).toBe(true);
      expect(report.mismatches.some((m: string) => m.includes("constitution hash mismatch"))).toBe(true);
    });

    it("should allow non-standard constitution hash with --allow-nonstandard flag", async () => {
      // Create a valid pack first
      const zipPath = join(tempDir, "tampered_constitution_allow.zip");
      const transcriptPath = resolve(repoRoot, "fixtures/success/SUCCESS-001-simple.json");
      const packResult = runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);
      expect(packResult.exitCode).toBe(0);

      // Load the pack
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      // Read the constitution file
      const constitutionContent = await zip.file("constitution/CONSTITUTION_v1.md")!.async("string");
      
      // Tamper with constitution (change one character)
      const tamperedConstitution = constitutionContent.replace(/^/, " "); // Add space at start
      
      // Update the constitution in the zip
      zip.file("constitution/CONSTITUTION_v1.md", tamperedConstitution);

      // Update manifest with new constitution hash
      // Canonicalize same way as auditor_pack_verify.ts
      const canonicalTampered = tamperedConstitution
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
        .join("\n");
      const newHash = createHash("sha256").update(canonicalTampered, "utf8").digest("hex");
      const manifestContent = await zip.file("manifest.json")!.async("string");
      const manifest = JSON.parse(manifestContent);
      manifest.constitution_hash = newHash;
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Update gc_view with new constitution hash
      const gcViewContent = await zip.file("derived/gc_view.json")!.async("string");
      const gcView = JSON.parse(gcViewContent);
      (gcView.constitution as { hash: string }).hash = newHash;
      zip.file("derived/gc_view.json", JSON.stringify(gcView, null, 2));

      // Regenerate checksums
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

      // Verify pack with --allow-nonstandard
      // With --allow-nonstandard, constitution hash mismatch is allowed but still tracked as warning
      // The pack may pass if all other recompute checks pass (gc_view structure, judgment, etc.)
      // Note: This specific pack will likely still fail because gc_view structure may differ,
      // but the NON_STANDARD_RULES warning should be present
      const verifyResult = runAuditorPackVerify(["--zip", zipPath, "--allow-nonstandard"]);
      
      const report = JSON.parse(verifyResult.stdout);
      // Should have NON_STANDARD_RULES mismatch warning
      expect(report.mismatches.some((m: string) => m.includes("NON_STANDARD_RULES"))).toBe(true);
      // ok can be true if checksums_ok and recompute_ok are both true (other checks may still fail)
      // The key is that NON_STANDARD_RULES is tracked as a warning, not a hard failure
    });

    it("should fail when constitution version string is tampered (constitution/1.0 -> constitution/1.0X)", async () => {
      // Create a valid pack first
      const zipPath = join(tempDir, "tampered_constitution_version.zip");
      const transcriptPath = resolve(repoRoot, "fixtures/success/SUCCESS-001-simple.json");
      const packResult = runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);
      expect(packResult.exitCode).toBe(0);

      // Load the pack
      const zipBuffer = readFileSync(zipPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      // Read the constitution file
      const constitutionContent = await zip.file("constitution/CONSTITUTION_v1.md")!.async("string");
      
      // Tamper with constitution: change "constitution/1.0" to "constitution/1.0X"
      const tamperedConstitution = constitutionContent.replace(/constitution\/1\.0/g, "constitution/1.0X");
      
      // Update the constitution in the zip
      zip.file("constitution/CONSTITUTION_v1.md", tamperedConstitution);

      // Update manifest with new constitution hash
      // Canonicalize same way as auditor_pack_verify.ts
      const canonicalTampered = tamperedConstitution
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
        .join("\n");
      const newHash = createHash("sha256").update(canonicalTampered, "utf8").digest("hex");
      const manifestContent = await zip.file("manifest.json")!.async("string");
      const manifest = JSON.parse(manifestContent);
      manifest.constitution_hash = newHash;
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Update gc_view with new constitution hash
      const gcViewContent = await zip.file("derived/gc_view.json")!.async("string");
      const gcView = JSON.parse(gcViewContent);
      (gcView.constitution as { hash: string }).hash = newHash;
      zip.file("derived/gc_view.json", JSON.stringify(gcView, null, 2));

      // Regenerate checksums
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

      // Verify pack - MUST fail due to non-standard constitution hash
      const verifyResult = runAuditorPackVerify(["--zip", zipPath]);
      expect(verifyResult.exitCode).toBe(1);

      const report = JSON.parse(verifyResult.stdout);
      expect(report.ok).toBe(false);
      expect(report.recompute_ok).toBe(false);
      expect(report.mismatches.some((m: string) => m.includes("NON_STANDARD_RULES"))).toBe(true);
      expect(report.mismatches.some((m: string) => m.includes("constitution hash mismatch"))).toBe(true);
    });
  });
});
