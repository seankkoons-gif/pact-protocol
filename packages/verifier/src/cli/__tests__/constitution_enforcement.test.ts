/**
 * Constitution Hash Enforcement Tests
 * 
 * Tests that non-standard constitution hashes are detected and rejected.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
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

describe("Constitution Hash Enforcement", () => {
  let tempDir: string;
  let zipPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "constitution-test-"));
    zipPath = join(tempDir, "test_pack.zip");
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should fail verification when constitution hash is non-standard", async () => {
    // Create a valid pack first
    const transcriptPath = resolve(repoRoot, "fixtures/success/SUCCESS-001-simple.json");
    const packResult = runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);
    expect(packResult.exitCode).toBe(0);

    // Load the pack
    const zipBuffer = readFileSync(zipPath);
    const zip = await JSZip.loadAsync(zipBuffer);

    // Read the constitution file
    const constitutionContent = await zip.file("constitution/CONSTITUTION_v1.md")!.async("string");
    
    // Tamper with constitution (change one character - add space at start)
    const tamperedConstitution = " " + constitutionContent;
    
    // Compute new hash (same canonicalization as auditor_pack_verify.ts)
    const canonicalTampered = tamperedConstitution
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n");
    const newHash = createHash("sha256").update(canonicalTampered, "utf8").digest("hex");
    
    // Update the constitution in the zip
    zip.file("constitution/CONSTITUTION_v1.md", tamperedConstitution);

    // Update manifest with new constitution hash
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
    // Should have NON_STANDARD_RULES mismatch
    expect(report.mismatches.some((m: string) => m.includes("NON_STANDARD_RULES"))).toBe(true);
  });

  it("should allow non-standard constitution hash with --allow-nonstandard flag", async () => {
    // Create a valid pack first
    const transcriptPath = resolve(repoRoot, "fixtures/success/SUCCESS-001-simple.json");
    const packResult = runAuditorPack(["--transcript", transcriptPath, "--out", zipPath]);
    expect(packResult.exitCode).toBe(0);

    // Load the pack
    const zipBuffer = readFileSync(zipPath);
    const zip = await JSZip.loadAsync(zipBuffer);

    // Read the constitution file
    const constitutionContent = await zip.file("constitution/CONSTITUTION_v1.md")!.async("string");
    
    // Tamper with constitution (change one character - add space at start)
    const tamperedConstitution = " " + constitutionContent;
    
    // Compute new hash (same canonicalization as auditor_pack_verify.ts)
    const canonicalTampered = tamperedConstitution
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n");
    const newHash = createHash("sha256").update(canonicalTampered, "utf8").digest("hex");
    
    // Update the constitution in the zip
    zip.file("constitution/CONSTITUTION_v1.md", tamperedConstitution);

    // Update manifest with new constitution hash
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
    // With --allow-nonstandard, if pack is internally consistent, it may pass
    // But gc_view recompute may still fail if structure differs (computed with different constitution)
    const verifyResult = runAuditorPackVerify(["--zip", zipPath, "--allow-nonstandard"]);
    
    const report = JSON.parse(verifyResult.stdout);
    // Should have NON_STANDARD_RULES mismatch warning (even if it passes)
    expect(report.mismatches.some((m: string) => m.includes("NON_STANDARD_RULES"))).toBe(true);
    
    // If recompute fails (gc_view structure differs), ok should be false
    // If recompute passes (gc_view structure matches minus constitution hash), ok may be true
    // Either way, NON_STANDARD_RULES warning must be present
    if (!report.recompute_ok) {
      expect(verifyResult.exitCode).toBe(1);
      expect(report.ok).toBe(false);
    } else {
      // If recompute passes, ok may be true with --allow-nonstandard
      expect(report.ok).toBe(true);
      expect(verifyResult.exitCode).toBe(0);
    }
  });
});
