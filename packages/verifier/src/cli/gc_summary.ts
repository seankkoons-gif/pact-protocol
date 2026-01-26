#!/usr/bin/env node
/**
 * GC Summary CLI
 *
 * Prints only GC-relevant fields in a concise, human-readable format.
 * Designed for quick terminal review without piping through jq.
 *
 * Usage:
 *   pact-verifier gc-summary --transcript <path>
 *
 * Output:
 *   Constitution: a0ea6fe329251b8c...
 *   Integrity: VALID
 *   Outcome: COMPLETED
 *   Fault Domain: NO_FAULT
 *   Required Action: NONE
 *   Approval Risk: LOW
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { TranscriptV4 } from "../util/transcript_verify.js";
import { renderGCView } from "../gc_view/renderer.js";

// EPIPE handler for pipe safety
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

interface ParsedArgs {
  transcript?: string;
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {};
  let i = 2;

  while (i < process.argv.length) {
    const arg = process.argv[i];

    if (arg === "--transcript" && i + 1 < process.argv.length) {
      args.transcript = process.argv[++i];
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
    i++;
  }

  return args;
}

function printUsage(): void {
  console.error("GC Summary - Quick GC-relevant fields");
  console.error("");
  console.error("Usage:");
  console.error("  pact-verifier gc-summary --transcript <path>");
  console.error("");
  console.error("Output:");
  console.error("  Constitution: a0ea6fe329251b8c...");
  console.error("  Integrity: VALID");
  console.error("  Outcome: COMPLETED");
  console.error("  Fault Domain: NO_FAULT");
  console.error("  Required Action: NONE");
  console.error("  Approval Risk: LOW");
}

function loadTranscript(transcriptPath: string): TranscriptV4 {
  const resolved = isAbsolute(transcriptPath) ? transcriptPath : resolve(process.cwd(), transcriptPath);
  
  if (!existsSync(resolved)) {
    console.error(`Error: Transcript file not found: ${resolved}`);
    process.exit(1);
  }

  try {
    const content = readFileSync(resolved, "utf-8");
    return JSON.parse(content) as TranscriptV4;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error reading transcript: ${message}`);
    process.exit(1);
  }
}

function truncateHash(hash: string, length: number = 16): string {
  if (hash.length <= length) return hash;
  return hash.substring(0, length) + "...";
}

function determineIntegrityStatus(gcView: ReturnType<typeof renderGCView>): string {
  const integrity = gcView.integrity;
  
  if (integrity.hash_chain !== "VALID") {
    return "INVALID (hash chain broken)";
  }
  
  if (integrity.signatures_verified.verified !== integrity.signatures_verified.total) {
    return `INVALID (${integrity.signatures_verified.verified}/${integrity.signatures_verified.total} sigs)`;
  }
  
  if (integrity.final_hash_validation === "MISMATCH") {
    return "VALID (final_hash warning)";
  }
  
  return "VALID";
}

export async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.transcript) {
    printUsage();
    process.exit(1);
  }

  const transcript = loadTranscript(args.transcript);
  const gcView = await renderGCView(transcript);

  // Extract GC-relevant fields
  const constitutionHash = truncateHash(gcView.constitution.hash);
  const integrity = determineIntegrityStatus(gcView);
  const outcome = gcView.executive_summary.status;
  const faultDomain = gcView.responsibility.judgment.fault_domain;
  const requiredAction = gcView.responsibility.judgment.required_action;
  const approvalRisk = gcView.gc_takeaways.approval_risk;

  // Print concise summary
  console.log(`Constitution: ${constitutionHash}`);
  console.log(`Integrity: ${integrity}`);
  console.log(`Outcome: ${outcome}`);
  console.log(`Fault Domain: ${faultDomain}`);
  console.log(`Required Action: ${requiredAction}`);
  console.log(`Approval Risk: ${approvalRisk}`);
}

// Check if running as main module (direct invocation)
const isMainModule = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith("gc_summary.ts") ||
  process.argv[1].endsWith("gc_summary.js")
);

if (isMainModule) {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
