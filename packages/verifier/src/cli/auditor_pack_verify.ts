#!/usr/bin/env node
/**
 * Auditor Pack Verification CLI
 *
 * Verifies the integrity and correctness of an auditor pack ZIP.
 *
 * Usage:
 *   pact-verifier auditor-pack-verify --zip <path.zip> [--out <report.json>]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifyAuditorPackFromBytes, type VerifyReport } from "../verify_auditor_pack_core.js";
import { getConstitutionContent } from "../load_constitution_node.js";

// Version constants
const PACKAGE_VERSION = "auditor_pack_verify/1.0";
const VERIFIER_VERSION = "0.2.1";

// EPIPE handler for pipe safety
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

interface VerifyArgs {
  zip?: string;
  out?: string;
  allowNonstandard?: boolean;
}

function parseArgs(): VerifyArgs {
  const args: VerifyArgs = {};
  let i = 2;
  while (i < process.argv.length) {
    const arg = process.argv[i];
    if (arg === "--zip" && i + 1 < process.argv.length) {
      args.zip = process.argv[++i];
    } else if (arg === "--out" && i + 1 < process.argv.length) {
      args.out = process.argv[++i];
    } else if (arg === "--allow-nonstandard") {
      args.allowNonstandard = true;
    }
    i++;
  }
  return args;
}

function printUsage(): void {
  console.error("Usage: pact-verifier auditor-pack-verify --zip <path.zip> [--out <report.json>] [--allow-nonstandard]");
  console.error("");
  console.error("Options:");
  console.error("  --zip <path>              Path to auditor pack ZIP file (required)");
  console.error("  --out <path>              Optional path to write verification report");
  console.error("  --allow-nonstandard       Allow non-standard constitution hashes (not recommended)");
  console.error("");
  console.error("Examples:");
  console.error("  pact-verifier auditor-pack-verify --zip evidence.zip");
  console.error("  pact-verifier auditor-pack-verify --zip evidence.zip --out report.json");
  console.error("  pact-verifier auditor-pack-verify --zip evidence.zip --allow-nonstandard");
}

function sha256Node(content: string | Buffer): string {
  const hash = createHash("sha256");
  if (typeof content === "string") {
    hash.update(content, "utf8");
  } else {
    hash.update(content);
  }
  return hash.digest("hex");
}

/** Re-export for freeze protection tests. */
export { generateInsurerSummary } from "../auditor_pack_verify_shared.js";

/**
 * Main entry point
 */
export async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.zip) {
    printUsage();
    process.exit(1);
  }

  const report: VerifyReport = {
    version: PACKAGE_VERSION,
    ok: false,
    checksums_ok: false,
    recompute_ok: false,
    mismatches: [],
    tool_version: `@pact/verifier ${VERIFIER_VERSION}`,
  };

  try {
    const zipPath = isAbsolute(args.zip) ? args.zip : resolve(process.cwd(), args.zip);
    if (!existsSync(zipPath)) {
      report.mismatches.push(`ZIP file not found: ${args.zip}`);
      outputReport(report, args.out);
      process.exit(1);
    }

    const zipBuffer = readFileSync(zipPath);
    const standardConstitutionContent = getConstitutionContent();
    const sha256Async = (data: string | Uint8Array) =>
      Promise.resolve(
        typeof data === "string"
          ? sha256Node(data)
          : sha256Node(Buffer.from(data))
      );
    const result = await verifyAuditorPackFromBytes(new Uint8Array(zipBuffer), {
      sha256Async,
      standardConstitutionContent,
      allowNonstandard: args.allowNonstandard,
    });
    Object.assign(report, result);
    outputReport(report, args.out);
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    report.mismatches.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
    outputReport(report, args.out);
    process.exit(1);
  }
}

function outputReport(report: VerifyReport, outPath?: string): void {
  const reportJson = JSON.stringify(report, null, 2);

  // Always output to stdout
  console.log(reportJson);

  // Optionally write to file
  if (outPath) {
    const resolvedPath = isAbsolute(outPath) ? outPath : resolve(process.cwd(), outPath);
    writeFileSync(resolvedPath, reportJson);
    console.error(`Report written to: ${resolvedPath}`);
  }
}

const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("auditor_pack_verify.js") ||
    process.argv[1].endsWith("auditor_pack_verify.ts"));
if (isMainModule) {
  main();
}
