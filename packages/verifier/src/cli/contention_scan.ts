#!/usr/bin/env node
/**
 * Contention Scan CLI
 * 
 * Scans a directory of transcripts and detects contention:
 * - Multiple terminal transcripts with same intent_fingerprint
 * - Multiple settlements for same LVSH
 * 
 * Usage:
 *   node dist/cli/contention_scan.js --transcripts-dir <dir> [--out <file>]
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { stableCanonicalize } from "../util/canonical.js";
import type { TranscriptV4 } from "../util/transcript_types.js";
import { resolveBlameV1 } from "../dbl/blame_resolver_v1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../..");

// Handle EPIPE gracefully
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

interface ParsedArgs {
  transcriptsDir?: string;
  out?: string;
  human?: boolean;
  debug?: boolean;
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {};
  let i = 2;

  while (i < process.argv.length) {
    const arg = process.argv[i];

    if (arg === "--transcripts-dir" && i + 1 < process.argv.length) {
      args.transcriptsDir = process.argv[++i];
    } else if (arg === "--out" && i + 1 < process.argv.length) {
      args.out = process.argv[++i];
    } else if (arg === "--human") {
      args.human = true;
    } else if (arg === "--debug") {
      args.debug = true;
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
    i++;
  }

  return args;
}

/**
 * Compute intent_fingerprint from transcript.
 * 
 * Formula: hash(canonical intent + buyer signer pubkey + policy hash)
 * 
 * Canonical intent includes:
 * - intent_type
 * - scope (if present in content_summary)
 * - constraints (if present in content_summary)
 * 
 * Critical: intent_fingerprint must NOT depend on transcript hash or filename.
 */
function computeIntentFingerprint(transcript: TranscriptV4): string | null {
  const intentRound = transcript.rounds.find((r) => r.round_type === "INTENT");
  if (!intentRound) {
    return null;
  }

  // Extract buyer signer pubkey from INTENT round
  const buyerSignerPubkey = intentRound.signature?.signer_public_key_b58;
  if (!buyerSignerPubkey) {
    return null;
  }

  // Extract canonical intent from content_summary or transcript fields
  const contentSummary = intentRound.content_summary || {};
  const canonicalIntent = {
    intent_type: transcript.intent_type || contentSummary.intent_type,
    scope: contentSummary.scope || transcript.intent_id, // Fallback to intent_id if scope not present
    constraints: contentSummary.constraints || {},
  };

  // Normalize policy hash (may be string or null)
  const policyHash = transcript.policy_hash || "";

  // Compute hash: canonical intent + buyer signer pubkey + policy hash
  const toHash = {
    canonical_intent: stableCanonicalize(canonicalIntent),
    buyer_signer_pubkey: buyerSignerPubkey,
    policy_hash: policyHash,
  };

  const canonical = stableCanonicalize(toHash);
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return hash;
}

/**
 * Check if transcript is terminal (success or failed with no required next actor).
 */
async function isTerminal(transcript: TranscriptV4): Promise<boolean> {
  try {
    const judgment = await resolveBlameV1(transcript);
    return judgment.terminal === true;
  } catch {
    // If judgment fails, consider it non-terminal for safety
    return false;
  }
}

/**
 * Get LVSH (Last Valid Signed Hash) from transcript.
 */
async function getLVSH(transcript: TranscriptV4): Promise<string | null> {
  try {
    const judgment = await resolveBlameV1(transcript);
    return judgment.lastValidHash || null;
  } catch {
    return null;
  }
}

interface ContentionGroup {
  intent_fingerprint: string;
  status: "SINGLE" | "DOUBLE_COMMIT";
  terminal_count: number;
  transcripts: string[]; // Stable identifiers (transcript_id or filename)
  parties?: {
    buyer?: string;
    provider?: string;
  };
}

interface ContentionReport {
  version: "contention_report/1.0";
  scanned: {
    files: number;
    transcripts_loaded: number;
  };
  unique_intents: number;
  double_commits: number;
  groups: ContentionGroup[];
}

/**
 * Resolve and validate transcripts directory path.
 * Throws if directory does not exist.
 */
function resolveTranscriptsDir(transcriptsDir: string): string {
  let resolvedDir: string;
  if (isAbsolute(transcriptsDir)) {
    resolvedDir = transcriptsDir;
  } else if (existsSync(transcriptsDir)) {
    resolvedDir = resolve(process.cwd(), transcriptsDir);
  } else {
    resolvedDir = resolve(repoRoot, transcriptsDir);
  }

  // Check if resolved directory exists
  if (!existsSync(resolvedDir)) {
    throw new Error(`transcripts-dir not found: ${resolvedDir}`);
  }

  // Check if it's actually a directory
  const stat = statSync(resolvedDir);
  if (!stat.isDirectory()) {
    throw new Error(`transcripts-dir is not a directory: ${resolvedDir}`);
  }

  return resolvedDir;
}

/**
 * Scan transcripts directory and generate contention report.
 */
async function scanContention(transcriptsDir: string): Promise<ContentionReport> {
  const groups: Map<string, ContentionGroup> = new Map();
  let filesScanned = 0;
  let transcriptsLoaded = 0;

  // Resolve and validate transcripts directory
  const resolvedDir = resolveTranscriptsDir(transcriptsDir);

  // Read all JSON files in directory
  const files = readdirSync(resolvedDir).filter((f) => f.endsWith(".json"));
  filesScanned = files.length;

  for (const file of files) {
    const filePath = join(resolvedDir, file);
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      continue;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const transcript: TranscriptV4 = JSON.parse(content);
      transcriptsLoaded++;

      // Compute intent_fingerprint
      const intentFingerprint = computeIntentFingerprint(transcript);
      if (!intentFingerprint) {
        console.error(`Warning: Could not compute intent_fingerprint for ${file}`);
        continue;
      }

      // Check if terminal
      const terminal = await isTerminal(transcript);

      // Extract parties (buyer/provider signer keys) from INTENT round
      const intentRound = transcript.rounds.find((r) => r.round_type === "INTENT");
      const buyerPubkey = intentRound?.signature?.signer_public_key_b58;
      const providerRound = transcript.rounds.find((r) => r.round_type === "ASK" || r.round_type === "ACCEPT");
      const providerPubkey = providerRound?.signature?.signer_public_key_b58;

      // Add to group
      if (!groups.has(intentFingerprint)) {
        groups.set(intentFingerprint, {
          intent_fingerprint: intentFingerprint,
          status: "SINGLE",
          terminal_count: 0,
          transcripts: [],
          parties: buyerPubkey || providerPubkey ? {
            buyer: buyerPubkey,
            provider: providerPubkey,
          } : undefined,
        });
      }

      const group = groups.get(intentFingerprint)!;
      // Use transcript_id as stable identifier (even if duplicate, count separately for contention)
      group.transcripts.push(transcript.transcript_id);

      if (terminal) {
        group.terminal_count++;
      }
    } catch (error) {
      console.error(`Error processing ${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
  }

  // Determine status for each group
  let doubleCommits = 0;
  for (const group of groups.values()) {
    if (group.terminal_count > 1) {
      group.status = "DOUBLE_COMMIT";
      doubleCommits++;
    }
  }

  return {
    version: "contention_report/1.0",
    scanned: {
      files: filesScanned,
      transcripts_loaded: transcriptsLoaded,
    },
    unique_intents: groups.size,
    double_commits: doubleCommits,
    groups: Array.from(groups.values()),
  };
}

(async () => {
  try {
    const args = parseArgs();

    if (!args.transcriptsDir) {
      console.error("Usage: contention_scan.js --transcripts-dir <dir> [--out <file>] [--human] [--debug]");
      console.error("");
      console.error("Options:");
      console.error("  --transcripts-dir <dir>  Directory containing transcript JSON files (required)");
      console.error("  --out <file>             Write JSON to file instead of stdout");
      console.error("  --human                  Print human-readable summary to stderr");
      console.error("  --debug                  Show stack traces for errors");
      process.exit(1);
    }

    // Scan for contention
    const report = await scanContention(args.transcriptsDir);

    // Output JSON (stdout only)
    const jsonOutput = JSON.stringify(report, null, 2);

    if (args.out) {
      writeFileSync(args.out, jsonOutput, "utf-8");
    } else {
      console.log(jsonOutput);
    }

    // Output human-readable summary to stderr (only if --human flag is passed)
    if (args.human) {
      console.error(`\nScanned ${report.scanned.files} files, loaded ${report.scanned.transcripts_loaded} transcripts`);
      console.error(`Found ${report.unique_intents} unique intent fingerprints`);
      console.error(`Double commits detected: ${report.double_commits}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      // Check if it's a directory not found error (ENOENT or our custom message)
      const isDirNotFound = 
        error.message.includes("transcripts-dir not found") ||
        (error as NodeJS.ErrnoException).code === "ENOENT";
      
      if (isDirNotFound) {
        // Extract the path from error message or use a generic message
        const pathMatch = error.message.match(/transcripts-dir not found: (.+)/);
        const dirPath = pathMatch ? pathMatch[1] : args.transcriptsDir || "unknown";
        console.error(`Error: transcripts-dir not found: ${dirPath}`);
      } else {
        console.error(`Error: ${error.message}`);
        if (args.debug) {
          console.error("\nStack trace:");
          console.error(error.stack);
        }
      }
    } else {
      console.error(`Error: ${String(error)}`);
    }
    process.exit(1);
  }
})();
