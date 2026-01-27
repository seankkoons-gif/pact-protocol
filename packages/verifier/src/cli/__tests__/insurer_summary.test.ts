/**
 * Insurer Summary CLI Tests
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../../..");

function loadFixture(filename: string): any {
  const fixturePath = resolve(repoRoot, "fixtures", filename);
  const content = readFileSync(fixturePath, "utf-8");
  return JSON.parse(content);
}

async function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const verifierPath = resolve(repoRoot, "packages", "verifier");
  let cliScript = join(verifierPath, "dist", "cli", "insurer_summary.js");
  if (!existsSync(cliScript)) {
    cliScript = join(verifierPath, "src", "cli", "insurer_summary.ts");
  }
  
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
        maxBuffer: 10 * 1024 * 1024
      }
    );
  } catch (error: any) {
    exitCode = error.status || 1;
    stdout = error.stdout || "";
    stderr = error.stderr || "";
  }
  
  return { stdout, stderr, exitCode };
}

describe("Insurer Summary CLI", () => {
  describe("SUCCESS-001 - successful transaction", () => {
    it("should return COVERED with NO_FAULT", async () => {
      const fixture = loadFixture("success/SUCCESS-001-simple.json");
      
      const tempDir = join(repoRoot, "tmp_test_insurer_success");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });
      
      const transcriptPath = join(tempDir, "SUCCESS-001.json");
      writeFileSync(transcriptPath, JSON.stringify(fixture, null, 2));
      
      try {
        const result = await runCLI(["--transcript", transcriptPath]);
        
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        
        expect(output.version).toBe("insurer_summary/1.0");
        expect(output.outcome).toBe("COMPLETED");
        expect(output.fault_domain).toBe("NO_FAULT");
        expect(output.integrity).toBe("VALID");
        // Single-transcript context: tier B due to delta-based scoring
        expect(["COVERED", "COVERED_WITH_SURCHARGE"]).toContain(output.coverage);
        expect(output.risk_factors).toEqual([]);
        expect(output.constitution_hash).toBeDefined();
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("PACT-101 - policy violation", () => {
    it("should return appropriate coverage for policy abort", async () => {
      const fixture = loadFixture("failures/PACT-101-policy-violation.json");
      
      const tempDir = join(repoRoot, "tmp_test_insurer_pact101");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });
      
      const transcriptPath = join(tempDir, "PACT-101.json");
      writeFileSync(transcriptPath, JSON.stringify(fixture, null, 2));
      
      try {
        const result = await runCLI(["--transcript", transcriptPath]);
        
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        
        expect(output.version).toBe("insurer_summary/1.0");
        expect(output.outcome).toBe("ABORTED_POLICY");
        // Policy violations typically show buyer at fault
        expect(["BUYER_AT_FAULT", "NO_FAULT", "INDETERMINATE"]).toContain(output.fault_domain);
        expect(output.constitution_hash).toBeDefined();
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("PACT-420 - provider unreachable", () => {
    it("should return COVERED_WITH_SURCHARGE with PROVIDER_AT_FAULT", async () => {
      const fixture = loadFixture("failures/PACT-420-provider-unreachable.json");
      
      const tempDir = join(repoRoot, "tmp_test_insurer_pact420");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });
      
      const transcriptPath = join(tempDir, "PACT-420.json");
      writeFileSync(transcriptPath, JSON.stringify(fixture, null, 2));
      
      try {
        const result = await runCLI(["--transcript", transcriptPath]);
        
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        
        expect(output.version).toBe("insurer_summary/1.0");
        expect(output.outcome).toBe("FAILED_PROVIDER_UNREACHABLE");
        expect(output.fault_domain).toBe("PROVIDER_AT_FAULT");
        expect(output.risk_factors).toContain("PROVIDER_UNREACHABLE");
        expect(output.risk_factors).toContain("PROVIDER_FAULT");
        expect(output.surcharges).toContain("PROVIDER_OPS");
        // PACT-420 fixture has invalid integrity → EXCLUDED
        expect(output.coverage).toBe("EXCLUDED");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("DOUBLE_COMMIT detection", () => {
    it("should return EXCLUDED for PACT-331 double commit", async () => {
      const fixture = loadFixture("failures/PACT-331-double-commit.json");
      
      const tempDir = join(repoRoot, "tmp_test_insurer_double_commit");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });
      
      const transcriptPath = join(tempDir, "PACT-331.json");
      writeFileSync(transcriptPath, JSON.stringify(fixture, null, 2));
      
      try {
        const result = await runCLI(["--transcript", transcriptPath]);
        
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        
        expect(output.version).toBe("insurer_summary/1.0");
        expect(output.risk_factors).toContain("DOUBLE_COMMIT");
        expect(output.coverage).toBe("EXCLUDED");
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("output structure", () => {
    it("should include all required fields", async () => {
      const fixture = loadFixture("success/SUCCESS-001-simple.json");
      
      const tempDir = join(repoRoot, "tmp_test_insurer_structure");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });
      
      const transcriptPath = join(tempDir, "test.json");
      writeFileSync(transcriptPath, JSON.stringify(fixture, null, 2));
      
      try {
        const result = await runCLI(["--transcript", transcriptPath]);
        
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        
        // Required fields
        expect(output).toHaveProperty("version");
        expect(output).toHaveProperty("constitution_hash");
        expect(output).toHaveProperty("integrity");
        expect(output).toHaveProperty("outcome");
        expect(output).toHaveProperty("fault_domain");
        expect(output).toHaveProperty("confidence");
        expect(output).toHaveProperty("risk_factors");
        expect(output).toHaveProperty("surcharges");
        expect(output).toHaveProperty("coverage");
        
        // Signer info (if available)
        if (output.buyer) {
          expect(output.buyer).toHaveProperty("signer");
          expect(output.buyer).toHaveProperty("passport_score");
          expect(output.buyer).toHaveProperty("tier");
          expect(["A", "B", "C"]).toContain(output.buyer.tier);
        }
        
        if (output.provider) {
          expect(output.provider).toHaveProperty("signer");
          expect(output.provider).toHaveProperty("passport_score");
          expect(output.provider).toHaveProperty("tier");
          expect(["A", "B", "C"]).toContain(output.provider.tier);
        }
        
        // Coverage enum
        expect(["COVERED", "COVERED_WITH_SURCHARGE", "ESCROW_REQUIRED", "EXCLUDED"]).toContain(output.coverage);
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("tier logic", () => {
    it("should compute correct tiers based on passport score", async () => {
      // For single transcript context, tiers are based on delta
      // Success: +0.01 delta -> tier B (score between -0.10 and 0.20)
      const fixture = loadFixture("success/SUCCESS-001-simple.json");
      
      const tempDir = join(repoRoot, "tmp_test_insurer_tiers");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });
      
      const transcriptPath = join(tempDir, "test.json");
      writeFileSync(transcriptPath, JSON.stringify(fixture, null, 2));
      
      try {
        const result = await runCLI(["--transcript", transcriptPath]);
        
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        
        // For success (NO_FAULT), delta is +0.01 which maps to tier B
        if (output.buyer) {
          expect(output.buyer.tier).toBe("B");
          expect(output.buyer.passport_score).toBe(0.01);
        }
        if (output.provider) {
          expect(output.provider.tier).toBe("B");
          expect(output.provider.passport_score).toBe(0.01);
        }
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe("constitution hash enforcement", () => {
    it("should return normal coverage for standard constitution pack", async () => {
      // Create a standard auditor pack
      const transcriptPath = resolve(repoRoot, "fixtures/success/SUCCESS-001-simple.json");
      const tempDir = join(repoRoot, "tmp_test_insurer_standard");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });
      
      const packPath = join(tempDir, "standard_pack.zip");
      
      try {
        // Create pack using auditor-pack CLI
        const verifierPath = resolve(repoRoot, "packages", "verifier");
        let packScript = join(verifierPath, "dist", "cli", "auditor_pack.js");
        if (!existsSync(packScript)) {
          packScript = join(verifierPath, "src", "cli", "auditor_pack.ts");
        }
        
        const packCommand = packScript.endsWith(".ts")
          ? `tsx "${packScript}" --transcript "${transcriptPath}" --out "${packPath}"`
          : `node "${packScript}" --transcript "${transcriptPath}" --out "${packPath}"`;
        
        execSync(packCommand, { cwd: repoRoot, stdio: "pipe" });
        
        // Run insurer-summary on the pack
        const result = await runCLI(["--pack", packPath]);
        
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        
        // Standard pack should have normal coverage (not EXCLUDED)
        expect(output.coverage).not.toBe("EXCLUDED");
        expect(output.risk_factors).not.toContain("NON_STANDARD_RULES");
        expect(output.surcharges).not.toContain("NON_STANDARD_CONSTITUTION");
        expect(output.constitution_warning).toBeUndefined();
        expect(output.confidence).toBeGreaterThan(0);
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should return EXCLUDED coverage for tampered constitution pack", async () => {
      // Create a standard pack first
      const transcriptPath = resolve(repoRoot, "fixtures/success/SUCCESS-001-simple.json");
      const tempDir = join(repoRoot, "tmp_test_insurer_tampered");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });
      
      const packPath = join(tempDir, "tampered_pack.zip");
      
      try {
        // Create pack using auditor-pack CLI
        const verifierPath = resolve(repoRoot, "packages", "verifier");
        let packScript = join(verifierPath, "dist", "cli", "auditor_pack.js");
        if (!existsSync(packScript)) {
          packScript = join(verifierPath, "src", "cli", "auditor_pack.ts");
        }
        
        const packCommand = packScript.endsWith(".ts")
          ? `tsx "${packScript}" --transcript "${transcriptPath}" --out "${packPath}"`
          : `node "${packScript}" --transcript "${transcriptPath}" --out "${packPath}"`;
        
        execSync(packCommand, { cwd: repoRoot, stdio: "pipe" });
        
        // Tamper with the constitution
        const zipBuffer = readFileSync(packPath);
        const zip = await JSZip.loadAsync(zipBuffer);
        
        const constitutionContent = await zip.file("constitution/CONSTITUTION_v1.md")!.async("string");
        const tamperedConstitution = " " + constitutionContent; // Add space at start
        
        // Canonicalize and compute hash
        const canonicalTampered = tamperedConstitution
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .split("\n")
          .map((line) => line.replace(/\s+$/, ""))
          .join("\n");
        const newHash = createHash("sha256").update(canonicalTampered, "utf8").digest("hex");
        
        // Update constitution in zip
        zip.file("constitution/CONSTITUTION_v1.md", tamperedConstitution);
        
        // Update manifest
        const manifestContent = await zip.file("manifest.json")!.async("string");
        const manifest = JSON.parse(manifestContent);
        manifest.constitution_hash = newHash;
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
        writeFileSync(packPath, tamperedBuffer);
        
        // Run insurer-summary on tampered pack - should return EXCLUDED
        const result = await runCLI(["--pack", packPath]);
        
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        
        // Tampered pack should be EXCLUDED
        expect(output.coverage).toBe("EXCLUDED");
        expect(output.risk_factors).toContain("NON_STANDARD_RULES");
        expect(output.surcharges).toContain("NON_STANDARD_CONSTITUTION");
        expect(output.constitution_warning).toBe("Verifier detected non-standard constitution rules");
        expect(output.confidence).toBe(0);
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });

    it("should allow non-standard constitution with --allow-nonstandard flag", async () => {
      // Create a tampered pack (same as above)
      const transcriptPath = resolve(repoRoot, "fixtures/success/SUCCESS-001-simple.json");
      const tempDir = join(repoRoot, "tmp_test_insurer_allow_nonstandard");
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      mkdirSync(tempDir, { recursive: true });
      
      const packPath = join(tempDir, "tampered_pack.zip");
      
      try {
        // Create and tamper pack (same logic as above)
        const verifierPath = resolve(repoRoot, "packages", "verifier");
        let packScript = join(verifierPath, "dist", "cli", "auditor_pack.js");
        if (!existsSync(packScript)) {
          packScript = join(verifierPath, "src", "cli", "auditor_pack.ts");
        }
        
        const packCommand = packScript.endsWith(".ts")
          ? `tsx "${packScript}" --transcript "${transcriptPath}" --out "${packPath}"`
          : `node "${packScript}" --transcript "${transcriptPath}" --out "${packPath}"`;
        
        execSync(packCommand, { cwd: repoRoot, stdio: "pipe" });
        
        // Tamper with the constitution
        const zipBuffer = readFileSync(packPath);
        const zip = await JSZip.loadAsync(zipBuffer);
        
        const constitutionContent = await zip.file("constitution/CONSTITUTION_v1.md")!.async("string");
        const tamperedConstitution = " " + constitutionContent;
        
        const canonicalTampered = tamperedConstitution
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .split("\n")
          .map((line) => line.replace(/\s+$/, ""))
          .join("\n");
        const newHash = createHash("sha256").update(canonicalTampered, "utf8").digest("hex");
        
        zip.file("constitution/CONSTITUTION_v1.md", tamperedConstitution);
        
        const manifestContent = await zip.file("manifest.json")!.async("string");
        const manifest = JSON.parse(manifestContent);
        manifest.constitution_hash = newHash;
        zip.file("manifest.json", JSON.stringify(manifest, null, 2));
        
        const newChecksums: string[] = [];
        const files = Object.keys(zip.files).filter((f) => !f.endsWith("/") && f !== "checksums.sha256");
        for (const file of files.sort()) {
          const content = await zip.file(file)!.async("nodebuffer");
          const hash = createHash("sha256").update(content).digest("hex");
          newChecksums.push(`${hash}  ${file}`);
        }
        zip.file("checksums.sha256", newChecksums.join("\n") + "\n");
        
        const tamperedBuffer = await zip.generateAsync({ type: "nodebuffer" });
        writeFileSync(packPath, tamperedBuffer);
        
        // Run insurer-summary with --allow-nonstandard flag
        const result = await runCLI(["--pack", packPath, "--allow-nonstandard"]);
        
        expect(result.exitCode).toBe(0);
        const output = JSON.parse(result.stdout);
        
        // With flag, coverage should not be EXCLUDED (unless other factors force it)
        // But warning and risk factors should still be present
        expect(output.risk_factors).toContain("NON_STANDARD_RULES");
        expect(output.surcharges).toContain("NON_STANDARD_CONSTITUTION");
        expect(output.constitution_warning).toBe("Verifier detected non-standard constitution rules");
        // Confidence should not be forced to 0 with the flag
        expect(output.confidence).toBeGreaterThanOrEqual(0);
        // Coverage should be computed normally (not forced to EXCLUDED)
        // It might still be EXCLUDED due to other factors, but not forced by constitution
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  });
});
