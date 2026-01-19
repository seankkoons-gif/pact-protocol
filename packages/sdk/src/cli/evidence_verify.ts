#!/usr/bin/env tsx
/**
 * Pact v4 Evidence Bundle Verifier CLI
 * 
 * Verifies evidence bundles by checking file hashes, transcript integrity, and decision artifacts.
 * 
 * Usage:
 *   tsx packages/sdk/src/cli/evidence_verify.ts <bundle_dir_or_manifest>
 * 
 * This command:
 * - Loads MANIFEST.json from bundle directory or explicit path
 * - Verifies all files match their manifest hashes
 * - Verifies transcript using v4 replay
 * - Verifies arbiter decision artifact (if present)
 * - Outputs INTEGRITY PASS or INTEGRITY FAIL
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { replayTranscriptV4, type TranscriptV4 } from "../transcript/v4/replay";
import {
  validateDecisionArtifact,
  type ArbiterDecisionV4,
} from "../disputes/v4/arbitration";

interface BundleManifest {
  bundle_version: "pact-evidence-bundle/4.0";
  bundle_id: string;
  transcript_hash: string;
  original_transcript_hash?: string;
  created_at_ms: number;
  view: "auditor" | "partner" | "internal";
  entries: Array<{
    type: "transcript" | "view" | "decision" | "policy" | "receipt" | "summary";
    path: string;
    content_hash: string;
    schema_version?: string;
  }>;
  redacted_fields?: Array<{
    path: string;
    hash: string;
    view: "auditor" | "partner" | "internal";
  }>;
  integrity: {
    transcript_valid: boolean;
    decision_valid: boolean | null;
    all_hashes_verified: boolean;
  };
}

interface VerificationResult {
  pass: boolean;
  failures: string[];
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
 * Check if this module is being run as the main entry point (ESM-safe).
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

/**
 * Verify evidence bundle.
 */
export async function verifyBundle(bundlePath: string): Promise<VerificationResult> {
  const failures: string[] = [];

  // Determine manifest path
  let manifestPath: string;
  let bundleDir: string;

  const stat = fs.statSync(bundlePath);
  if (stat.isDirectory()) {
    bundleDir = bundlePath;
    manifestPath = path.join(bundlePath, "MANIFEST.json");
  } else if (path.basename(bundlePath) === "MANIFEST.json") {
    manifestPath = bundlePath;
    bundleDir = path.dirname(bundlePath);
  } else {
    throw new Error(`Invalid path: ${bundlePath}. Must be a bundle directory or MANIFEST.json file.`);
  }

  // Load manifest
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`MANIFEST.json not found: ${manifestPath}`);
  }

  const manifestContent = fs.readFileSync(manifestPath, "utf8");
  const manifest: BundleManifest = JSON.parse(manifestContent);

  // Verify manifest structure
  if (manifest.bundle_version !== "pact-evidence-bundle/4.0") {
    failures.push(`Invalid bundle version: ${manifest.bundle_version}`);
  }

  // Verify all entries exist and match hashes (deterministic order: sort by path)
  const sortedEntries = [...manifest.entries].sort((a, b) => a.path.localeCompare(b.path));
  
  for (const entry of sortedEntries) {
    const filePath = path.join(bundleDir, entry.path);
    
    if (!fs.existsSync(filePath)) {
      failures.push(`Missing file: ${entry.path}`);
      continue;
    }

    const computedHash = computeFileHash(filePath);
    if (computedHash !== entry.content_hash) {
      failures.push(`Hash mismatch: ${entry.path} (expected ${entry.content_hash}, got ${computedHash})`);
    }
  }

  // Find and verify transcript OR view
  const originalTranscriptEntry = manifest.entries.find((e) => e.type === "transcript" && e.path === "ORIGINAL.json");
  const viewEntry = manifest.entries.find((e) => e.type === "view" && e.path === "VIEW.json");
  
  let originalTranscript: TranscriptV4 | null = null;

  // If ORIGINAL.json exists: verify PoN transcript
  if (originalTranscriptEntry) {
    const transcriptPath = path.join(bundleDir, originalTranscriptEntry.path);
    if (fs.existsSync(transcriptPath)) {
      try {
        const transcriptContent = fs.readFileSync(transcriptPath, "utf8");
        const transcript: TranscriptV4 = JSON.parse(transcriptContent);

        // Verify transcript version
        if (transcript.transcript_version !== "pact-transcript/4.0") {
          failures.push(`Invalid transcript version in ORIGINAL.json: ${transcript.transcript_version}`);
        } else {
          originalTranscript = transcript;
          
          // Run v4 transcript PoN verification (must pass)
          const replayResult = await replayTranscriptV4(transcript);
          
          const errors = Array.isArray(replayResult.errors) ? replayResult.errors : [];
          const warnings = Array.isArray(replayResult.warnings) ? replayResult.warnings : [];

          if (!replayResult.ok) {
            failures.push(`ORIGINAL.json PoN verification failed: ${errors.length} error(s)`);
            if (errors.length > 0) {
              const firstError = errors[0];
              const errorMessage = typeof firstError === "string"
                ? firstError
                : firstError?.message || JSON.stringify(firstError);
              failures.push(`  First error: ${errorMessage}`);
            }
          }

          // Verify transcript hash matches manifest
          if (transcript.transcript_id !== manifest.transcript_hash) {
            failures.push(`Transcript hash mismatch: manifest expects ${manifest.transcript_hash}, got ${transcript.transcript_id}`);
          }
        }
      } catch (error: any) {
        failures.push(`Failed to verify ORIGINAL.json: ${error.message || String(error)}`);
      }
    } else {
      failures.push(`ORIGINAL.json file not found: ${originalTranscriptEntry.path}`);
    }

    // If VIEW.json also exists, optionally validate view hashes match original
    if (viewEntry && originalTranscript) {
      const viewPath = path.join(bundleDir, viewEntry.path);
      if (fs.existsSync(viewPath)) {
        try {
          const viewContent = fs.readFileSync(viewPath, "utf8");
          const viewJson: any = JSON.parse(viewContent);
          
          // Validate VIEW.json schema
          if (viewJson.kind !== "view") {
            failures.push(`VIEW.json missing 'kind: view' field`);
          }
          if (viewJson.source_transcript_hash !== manifest.transcript_hash) {
            failures.push(`VIEW.json source_transcript_hash mismatch: expected ${manifest.transcript_hash}, got ${viewJson.source_transcript_hash}`);
          }
          if (!["INTERNAL", "PARTNER", "AUDITOR"].includes(viewJson.view)) {
            failures.push(`Invalid VIEW.json view type: ${viewJson.view}`);
          }
        } catch (error: any) {
          failures.push(`Failed to validate VIEW.json linkage: ${error.message || String(error)}`);
        }
      }
    }
  } else if (viewEntry) {
    // Only VIEW.json exists: validate view schema (do NOT run PoN verification)
    const viewPath = path.join(bundleDir, viewEntry.path);
    if (fs.existsSync(viewPath)) {
      try {
        const viewContent = fs.readFileSync(viewPath, "utf8");
        const viewJson: any = JSON.parse(viewContent);

        // Validate VIEW.json schema
        if (viewJson.kind !== "view") {
          failures.push(`VIEW.json missing 'kind: view' field`);
        }
        if (!viewJson.source_transcript_hash || typeof viewJson.source_transcript_hash !== "string") {
          failures.push(`VIEW.json missing or invalid source_transcript_hash`);
        } else {
          if (viewJson.source_transcript_hash !== manifest.transcript_hash) {
            failures.push(`VIEW.json source_transcript_hash mismatch: expected ${manifest.transcript_hash}, got ${viewJson.source_transcript_hash}`);
          }
        }
        if (!["INTERNAL", "PARTNER", "AUDITOR"].includes(viewJson.view)) {
          failures.push(`Invalid VIEW.json view type: ${viewJson.view}`);
        }
        if (!viewJson.transcript || typeof viewJson.transcript !== "object") {
          failures.push(`VIEW.json missing transcript object`);
        } else {
          // Validate redacted fields have redacted:true and hash
          const transcript = viewJson.transcript;
          if (transcript.policy_hash && typeof transcript.policy_hash === "object") {
            if (transcript.policy_hash.redacted !== true || !transcript.policy_hash.hash) {
              failures.push(`VIEW.json transcript.policy_hash is redacted but missing redacted:true or hash`);
            }
          }
          if (transcript.strategy_hash && typeof transcript.strategy_hash === "object") {
            if (transcript.strategy_hash.redacted !== true || !transcript.strategy_hash.hash) {
              failures.push(`VIEW.json transcript.strategy_hash is redacted but missing redacted:true or hash`);
            }
          }
        }
      } catch (error: any) {
        failures.push(`Failed to verify VIEW.json: ${error.message || String(error)}`);
      }
    } else {
      failures.push(`VIEW.json file not found: ${viewEntry.path}`);
    }
  } else {
    failures.push("No transcript (ORIGINAL.json) or view (VIEW.json) entry found in manifest");
  }

  // Find and verify decision artifact (if present)
  const decisionEntry = manifest.entries.find((e) => e.type === "decision");
  if (decisionEntry) {
    const decisionPath = path.join(bundleDir, decisionEntry.path);
    if (fs.existsSync(decisionPath)) {
      try {
        const decisionContent = fs.readFileSync(decisionPath, "utf8");
        const decision: ArbiterDecisionV4 = JSON.parse(decisionContent);

        // Use originalTranscript if available, otherwise we cannot validate decision
        if (originalTranscript) {
          const validation = validateDecisionArtifact(decision, originalTranscript);
          if (!validation.ok) {
            failures.push(`Decision artifact validation failed`);
            const errors = Array.isArray(validation.errors) ? validation.errors : [];
            if (errors.length > 0) {
              failures.push(`  ${errors[0]}`);
            }
          }

          // Verify decision hash matches manifest
          if (decision.transcript_hash !== manifest.transcript_hash) {
            failures.push(`Decision transcript hash mismatch: decision references ${decision.transcript_hash}, manifest has ${manifest.transcript_hash}`);
          }
        } else {
          // If only VIEW.json exists, we cannot validate decision (requires original PoN transcript)
          failures.push(`Cannot validate decision artifact: ORIGINAL.json not present (required for decision validation)`);
        }
      } catch (error: any) {
        failures.push(`Failed to verify decision artifact: ${error.message || String(error)}`);
      }
    } else {
      failures.push(`Decision file not found: ${decisionEntry.path}`);
    }
  }

  return {
    pass: failures.length === 0,
    failures: failures.sort(), // Deterministic ordering
  };
}

/**
 * CLI entry point.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bundlePath = args[0];

  if (!bundlePath) {
    console.error("Usage: tsx evidence_verify.ts <bundle_dir_or_manifest>");
    process.exit(1);
  }

  try {
    const result = await verifyBundle(bundlePath);

    if (result.pass) {
      console.log("INTEGRITY PASS");
      process.exit(0);
    } else {
      console.log("INTEGRITY FAIL");
      for (const failure of result.failures) {
        console.log(failure);
      }
      process.exit(1);
    }
  } catch (error: any) {
    console.error("INTEGRITY FAIL");
    console.error(error.message || String(error));
    process.exit(1);
  }
}

// CLI entry point
if (isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
