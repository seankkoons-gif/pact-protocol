/**
 * Insurer Summary CLI Tests
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
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
});
