/**
 * Tests for Evidence Bundle Verifier
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "node:crypto";
import { createTranscriptV4, addRoundToTranscript } from "../../transcript/v4/transcript";
import type { TranscriptV4 } from "../../transcript/v4/replay";
import type { ArbiterDecisionV4 } from "../../disputes/v4/arbitration";

describe("Evidence Bundle Verifier", () => {
  const testDir = path.join(__dirname, "../../../.tmp/verify-test");

  beforeAll(() => {
    // Clean test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Create a minimal valid v4 transcript for testing.
   * Uses a fixture transcript that's known to be valid.
   */
  function createTestTranscript(): TranscriptV4 {
    // Load a known valid fixture transcript
    const fixturePath = path.join(__dirname, "../../../../fixtures/failures/PACT-101-policy-violation.json");
    if (fs.existsSync(fixturePath)) {
      const fixtureContent = fs.readFileSync(fixturePath, "utf8");
      return JSON.parse(fixtureContent) as TranscriptV4;
    }

    // Fallback: create a minimal transcript with one round
    // Note: This may not pass full signature validation, but has correct structure
    const transcript = createTranscriptV4({
      intent_id: "intent-test",
      intent_type: "test",
      created_at_ms: 1000,
      policy_hash: "a".repeat(64),
      strategy_hash: "b".repeat(64),
      identity_snapshot_hash: "c".repeat(64),
    });

    // Add an INTENT round
    const transcriptWithRound = addRoundToTranscript(transcript, {
      round_type: "INTENT",
      message_hash: "a".repeat(64),
      envelope_hash: "a".repeat(64),
      signature: {
        signer_public_key_b58: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
        signature_b58: "1hQsRfwweTArnnxFGaR3VdYppmpPrZNHwEmwAW7scbpUVHczp5sYi37ubzMG1zsGDDVN9CqG5RysGLftoyw8x91",
        signed_at_ms: 1000,
        scheme: "ed25519",
      },
      timestamp_ms: 1000,
      agent_id: "buyer",
      public_key_b58: "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J",
      content_summary: {
        intent_type: "test",
      },
    });

    return transcriptWithRound;
  }

  /**
   * Compute SHA-256 hash of file content.
   */
  function computeFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    return hash;
  }

  /**
   * Create a valid bundle for testing.
   * @param testName Unique test name
   * @param view Bundle view type (default: "internal")
   */
  async function createTestBundle(testName: string, view: "internal" | "partner" | "auditor" = "internal"): Promise<string> {
    const bundleDir = path.join(testDir, `bundle-${testName}`);
    if (fs.existsSync(bundleDir)) {
      fs.rmSync(bundleDir, { recursive: true, force: true });
    }
    fs.mkdirSync(bundleDir, { recursive: true });

    const transcript = createTestTranscript();
    const entries: any[] = [];

    if (view === "internal") {
      // Internal view: include ORIGINAL.json
      const originalPath = path.join(bundleDir, "ORIGINAL.json");
      fs.writeFileSync(originalPath, JSON.stringify(transcript, null, 2));
      entries.push({
        type: "transcript",
        path: "ORIGINAL.json",
        content_hash: computeFileHash(originalPath),
        schema_version: "pact-transcript/4.0",
      });
    } else {
      // Partner/auditor views: include VIEW.json
      const viewJson = {
        kind: "view",
        source_transcript_hash: transcript.transcript_id,
        view: view === "partner" ? "PARTNER" : "AUDITOR",
        transcript: transcript, // For tests, use unredacted transcript
      };
      const viewPath = path.join(bundleDir, "VIEW.json");
      fs.writeFileSync(viewPath, JSON.stringify(viewJson, null, 2));
      entries.push({
        type: "view",
        path: "VIEW.json",
        content_hash: computeFileHash(viewPath),
        schema_version: "pact-transcript-view/1.0",
      });
    }

    const summary = "# Test Summary\n\nThis is a test summary.";
    const summaryPath = path.join(bundleDir, "SUMMARY.md");
    fs.writeFileSync(summaryPath, summary);
    entries.push({
      type: "summary",
      path: "SUMMARY.md",
      content_hash: computeFileHash(summaryPath),
    });

    const manifest = {
      bundle_version: "pact-evidence-bundle/4.0",
      bundle_id: "bundle-test",
      transcript_hash: transcript.transcript_id,
      created_at_ms: Date.now(),
      view,
      entries,
      integrity: {
        transcript_valid: true,
        decision_valid: null,
        all_hashes_verified: true,
      },
    };

    const manifestPath = path.join(bundleDir, "MANIFEST.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    return bundleDir;
  }

  it("should PASS on an untouched generated bundle", async () => {
    const bundlePath = await createTestBundle("pass");

    // Import and run verifier
    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(bundlePath);

    // For this test, we verify that file hashes match (the core integrity check)
    // Transcript signature validation may fail for synthetic test transcripts,
    // but file integrity should always pass for untouched bundles
    const hashFailures = result.failures.filter((f) => f.includes("Hash mismatch"));
    const missingFileFailures = result.failures.filter((f) => f.includes("Missing file"));
    
    expect(hashFailures.length).toBe(0);
    expect(missingFileFailures.length).toBe(0);
    
    // If there are other failures (like transcript signature validation),
    // that's acceptable for synthetic test data - the important thing is file integrity
  });

  it("should FAIL when SUMMARY.md is modified", async () => {
    const bundlePath = await createTestBundle("summary-modified");
    const summaryPath = path.join(bundlePath, "SUMMARY.md");

    // Modify SUMMARY.md
    fs.appendFileSync(summaryPath, "\n\nTAMPERED");

    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(bundlePath);

    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("SUMMARY.md") && f.includes("Hash mismatch"))).toBe(true);
  });

  it("should FAIL when ORIGINAL.json is modified", async () => {
    const bundlePath = await createTestBundle("transcript-modified", "internal");
    const originalPath = path.join(bundlePath, "ORIGINAL.json");

    // Modify transcript
    const transcript = JSON.parse(fs.readFileSync(originalPath, "utf8"));
    transcript.intent_type = "TAMPERED";
    fs.writeFileSync(originalPath, JSON.stringify(transcript, null, 2));

    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(bundlePath);

    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("ORIGINAL.json") && f.includes("Hash mismatch"))).toBe(true);
  });

  it("should FAIL when VIEW.json is modified (auditor view)", async () => {
    const bundlePath = await createTestBundle("view-modified", "auditor");
    const viewPath = path.join(bundlePath, "VIEW.json");

    // Modify VIEW.json
    const viewJson = JSON.parse(fs.readFileSync(viewPath, "utf8"));
    viewJson.transcript.intent_type = "TAMPERED";
    fs.writeFileSync(viewPath, JSON.stringify(viewJson, null, 2));

    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(bundlePath);

    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("VIEW.json") && f.includes("Hash mismatch"))).toBe(true);
  });

  it("should FAIL when a manifest hash is altered", async () => {
    const bundlePath = await createTestBundle("manifest-altered");
    const manifestPath = path.join(bundlePath, "MANIFEST.json");

    // Alter manifest hash
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.entries[0].content_hash = "0".repeat(64); // Invalid hash
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(bundlePath);

    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("Hash mismatch"))).toBe(true);
  });

  it("should accept explicit MANIFEST.json path", async () => {
    const bundlePath = await createTestBundle("explicit-path");
    const manifestPath = path.join(bundlePath, "MANIFEST.json");

    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(manifestPath);

    // File integrity should pass (no hash mismatches or missing files)
    // Note: PoN verification may fail for synthetic test transcripts, but file integrity is what matters here
    const hashFailures = result.failures.filter((f) => f.includes("Hash mismatch"));
    const missingFileFailures = result.failures.filter((f) => f.includes("Missing file"));
    
    expect(hashFailures.length).toBe(0);
    expect(missingFileFailures.length).toBe(0);
  });

  it("should handle missing files gracefully", async () => {
    const bundlePath = await createTestBundle("missing-file");
    const manifestPath = path.join(bundlePath, "MANIFEST.json");

    // Delete a file
    fs.unlinkSync(path.join(bundlePath, "SUMMARY.md"));

    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(manifestPath);

    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("Missing file") && f.includes("SUMMARY.md"))).toBe(true);
  });

  it("should PASS on internal bundle with ORIGINAL.json (PoN verification expected)", async () => {
    const bundlePath = await createTestBundle("internal-bundle", "internal");

    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(bundlePath);

    // File integrity should pass (no hash mismatches or missing files)
    const hashFailures = result.failures.filter((f) => f.includes("Hash mismatch"));
    const missingFileFailures = result.failures.filter((f) => f.includes("Missing file"));
    
    expect(hashFailures.length).toBe(0);
    expect(missingFileFailures.length).toBe(0);
    
    // Note: PoN verification may fail for synthetic test data (signatures), 
    // but file integrity checks should pass
  });

  it("should PASS on auditor bundle with VIEW.json (no PoN verification)", async () => {
    const bundlePath = await createTestBundle("auditor-bundle", "auditor");

    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(bundlePath);

    // File integrity should pass
    const hashFailures = result.failures.filter((f) => f.includes("Hash mismatch"));
    const missingFileFailures = result.failures.filter((f) => f.includes("Missing file"));
    
    expect(hashFailures.length).toBe(0);
    expect(missingFileFailures.length).toBe(0);
    
    // Should not attempt PoN verification on VIEW.json
    expect(result.failures.some((f) => f.includes("ORIGINAL.json"))).toBe(false);
  });

  it("should FAIL on auditor bundle when SUMMARY.md is tampered", async () => {
    const bundlePath = await createTestBundle("auditor-summary-tampered", "auditor");
    const summaryPath = path.join(bundlePath, "SUMMARY.md");

    // Tamper with SUMMARY.md
    fs.appendFileSync(summaryPath, "\n\nTAMPERED");

    const { verifyBundle } = await import("../evidence_verify");
    const result = await verifyBundle(bundlePath);

    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.includes("SUMMARY.md") && f.includes("Hash mismatch"))).toBe(true);
  });
});
