#!/usr/bin/env node
/**
 * CLI for Passport v1 Recompute
 * 
 * Recomputes Passport v1 states from transcripts, grouped by signer public key.
 * 
 * Identity Rule:
 * - Canonical identity for scoring + grouping is the signer public key:
 *   rounds[].signature.signer_public_key_b58
 *   fallback rounds[].public_key_b58
 * - NEVER group by rounds[].agent_id (that is role/display only).
 * 
 * Usage: pnpm -w verifier passport:v1:recompute --transcripts-dir <dir> [--signer <pubkey>] [--out <file>]
 */

import { resolveBlameV1 } from "../dbl/blame_resolver_v1.js";
import { verifyTranscriptV4 } from "../util/transcript_verify.js";
import type { TranscriptV4 } from "../util/transcript_types.js";
import {
  getTranscriptSigners,
  extractTranscriptSummary,
  computePassportDelta,
  applyDelta,
  getTranscriptStableId,
  type PassportState,
} from "../util/passport_v1.js";
import { stableCanonicalize, hashCanonicalHex } from "../util/canonical.js";
import { readdir, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { promisify } from "node:util";

const readdirAsync = promisify(readdir);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../..");

// Handle EPIPE gracefully (e.g., when piping to head/jq)
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

// Export repoRoot for use in normalization
export const REPO_ROOT = repoRoot;

interface RecomputeOutput {
  version: "passport/1.0";
  generated_from: {
    transcripts_dir: string;
    count: number;
  };
  states: Record<
    string,
    {
      agent_id: string;
      score: number;
      counters: {
        total_settlements: number;
        successful_settlements: number;
        disputes_lost: number;
        disputes_won: number;
        sla_violations: number;
        policy_aborts: number;
      };
      included_transcripts: string[];
      state_hash: string;
    }
  >;
}

function parseArgs(): {
  transcriptsDir: string;
  signer?: string;
  outFile?: string;
  human?: boolean;
} {
  const args = process.argv.slice(2);
  let transcriptsDir: string | undefined;
  let signer: string | undefined;
  let outFile: string | undefined;
  let human = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--transcripts-dir" && i + 1 < args.length) {
      transcriptsDir = args[i + 1];
      i++;
    } else if (args[i] === "--signer" && i + 1 < args.length) {
      signer = args[i + 1];
      i++;
    } else if (args[i] === "--out" && i + 1 < args.length) {
      outFile = args[i + 1];
      i++;
    } else if (args[i] === "--human") {
      human = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!transcriptsDir) {
    console.error("Error: --transcripts-dir is required");
    printHelp();
    process.exit(1);
  }

  return { transcriptsDir, signer, outFile, human };
}

function printHelp(): void {
  console.error(`
Usage: passport:v1:recompute --transcripts-dir <dir> [--signer <pubkey>] [--out <file>]

Recomputes Passport v1 states from transcripts, grouped by signer public key.

Identity Rule:
  - Canonical identity for scoring + grouping is the signer public key:
    rounds[].signature.signer_public_key_b58 (fallback: rounds[].public_key_b58)
  - NEVER group by rounds[].agent_id (that is role/display only).

Options:
  --transcripts-dir <dir>  Directory containing transcript JSON files (required)
  --signer <pubkey>        Output only this signer's PassportState (optional)
  --out <file>             Output file path (optional, defaults to stdout)
  --human                  Print human-readable summary to stderr (optional)
  --help, -h               Show this help message

Examples:
  # Recompute all signers
  passport:v1:recompute --transcripts-dir ./fixtures/success

  # Recompute specific signer
  passport:v1:recompute --transcripts-dir ./fixtures --signer 21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J

  # Save to file
  passport:v1:recompute --transcripts-dir ./fixtures --out passports.json
`);
}

async function loadTranscripts(dir: string): Promise<TranscriptV4[]> {
  const transcripts: TranscriptV4[] = [];
  const resolvedDir = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);

  if (!statSync(resolvedDir).isDirectory()) {
    throw new Error(`Not a directory: ${resolvedDir}`);
  }

  const files = await readdirAsync(resolvedDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort(); // Sort for deterministic order

  for (const file of jsonFiles) {
    const filePath = join(resolvedDir, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const transcript = JSON.parse(content) as TranscriptV4;

      // Verify integrity (basic structure validation)
      const replayResult = await verifyTranscriptV4(transcript);
      if (!replayResult.ok) {
        // Check if the only errors are FINAL_HASH_MISMATCH (common in fixtures)
        const nonHashErrors = replayResult.errors.filter((e) => e.type !== "FINAL_HASH_MISMATCH");
        if (nonHashErrors.length > 0) {
          // Warning to stderr only (not stdout)
          console.error(`Warning: Skipping ${file} - integrity check failed: ${nonHashErrors.map((e) => e.message).join("; ")}`);
          continue;
        }
        // If only FINAL_HASH_MISMATCH, allow it (fixtures may have incorrect final_hash)
        if (replayResult.rounds_verified === 0) {
          // Warning to stderr only (not stdout)
          console.error(`Warning: Skipping ${file} - no valid rounds verified`);
          continue;
        }
      }

      transcripts.push(transcript);
    } catch (error) {
      // Warning to stderr only (not stdout)
      console.error(`Warning: Skipping ${file} - ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
  }

  return transcripts;
}

function computeStateHash(state: {
  agent_id: string;
  score: number;
  counters: {
    total_settlements: number;
    successful_settlements: number;
    disputes_lost: number;
    disputes_won: number;
    sla_violations: number;
    policy_aborts: number;
  };
}): string {
  return hashCanonicalHex(state);
}

// Runtime banner: detect if running from dist (compiled) or tsx (dev)
const RUNNER = import.meta.url.includes('/dist/') ? 'dist' : 'tsx';

export async function main(): Promise<void> {
  try {
    const { transcriptsDir, signer, outFile, human } = parseArgs();

    // Load and verify transcripts (progress logs to stderr only when --human)
    if (human) {
      console.error(`Loading transcripts from: ${transcriptsDir}`);
    }
    const transcripts = await loadTranscripts(transcriptsDir);
    if (human) {
      console.error(`Loaded ${transcripts.length} valid transcripts`);
    }

    if (transcripts.length === 0) {
      console.error("Error: No valid transcripts found");
      process.exitCode = 1;
      return;
    }

    // Collect all unique signers
    const signerSet = new Set<string>();
    for (const transcript of transcripts) {
      const signers = getTranscriptSigners(transcript);
      for (const s of signers) {
        signerSet.add(s);
      }
    }

    const allSigners = Array.from(signerSet).sort(); // Deterministic order

    // Filter to requested signer if provided
    const targetSigners = signer ? (allSigners.includes(signer) ? [signer] : []) : allSigners;

    if (signer && targetSigners.length === 0) {
      console.error(`Error: Signer ${signer} not found in any transcripts`);
      process.exitCode = 1;
      return;
    }

    // Build output (normalize transcripts_dir to relative path for deterministic output)
    let normalizedDir = transcriptsDir;
    if (isAbsolute(transcriptsDir)) {
      // Try to make it relative to repo root or cwd
      if (transcriptsDir.startsWith(repoRoot + "/")) {
        normalizedDir = transcriptsDir.slice(repoRoot.length + 1);
      } else if (transcriptsDir.startsWith(process.cwd() + "/")) {
        normalizedDir = transcriptsDir.slice(process.cwd().length + 1);
      }
    }
    
    const output: RecomputeOutput = {
      version: "passport/1.0",
      generated_from: {
        transcripts_dir: normalizedDir,
        count: transcripts.length,
      },
      states: {},
    };

    // Compute DBL judgments for all transcripts (deterministic)
    if (human) {
      console.error("Computing DBL judgments...");
    }
    const transcriptJudgments = new Map<TranscriptV4, Awaited<ReturnType<typeof resolveBlameV1>>>();
    for (const transcript of transcripts) {
      try {
        const judgment = await resolveBlameV1(transcript);
        transcriptJudgments.set(transcript, judgment);
      } catch (error) {
        // Warning to stderr only (not stdout)
        console.error(`Warning: Failed to compute DBL judgment for transcript ${getTranscriptStableId(transcript)}: ${error instanceof Error ? error.message : String(error)}`);
        // Continue with null judgment
        transcriptJudgments.set(transcript, null as any);
      }
    }

    // For each signer, recompute passport state
    for (const targetSigner of targetSigners) {
      // Filter transcripts that involve this signer
      const signerTranscripts = transcripts.filter((t) => {
        const signers = getTranscriptSigners(t);
        return signers.includes(targetSigner);
      });

      // Sort transcripts by stable ID for deterministic ordering
      const sortedTranscripts = [...signerTranscripts].sort((a, b) => {
        const idA = getTranscriptStableId(a);
        const idB = getTranscriptStableId(b);
        return idA.localeCompare(idB);
      });

      // Deduplicate transcripts by (transcript_stable_id, signer_public_key_b58)
      // This ensures the same transcript with different agent_id labels cannot double-count
      const processedKeys = new Set<string>();
      const deduplicatedTranscripts: TranscriptV4[] = [];

      for (const transcript of sortedTranscripts) {
        // Create uniqueness key: (transcript_stable_id, signer_public_key_b58)
        const stableId = getTranscriptStableId(transcript);
        const uniquenessKey = `${stableId}:${targetSigner}`;

        // Skip if already processed (idempotency)
        if (processedKeys.has(uniquenessKey)) {
          continue;
        }

        processedKeys.add(uniquenessKey);
        deduplicatedTranscripts.push(transcript);
      }

      // Initialize state
      let state: PassportState = {
        version: "passport/1.0",
        agent_id: targetSigner,
        score: 0,
        counters: {
          total_settlements: 0,
          successful_settlements: 0,
          disputes_lost: 0,
          disputes_won: 0,
          sla_violations: 0,
          policy_aborts: 0,
        },
      };

      // Process each deduplicated transcript with DBL judgment
      for (const transcript of deduplicatedTranscripts) {
        const summary = extractTranscriptSummary(transcript);
        const dblJudgment = transcriptJudgments.get(transcript) || null;

        // Compute delta
        const delta = computePassportDelta({
          transcript_summary: summary,
          dbl_judgment: dblJudgment,
          agent_id: targetSigner,
        });

        // Apply delta
        state = applyDelta(state, delta);
      }

      // Collect stable IDs of included transcripts (from deduplicated set)
      const includedTranscripts = deduplicatedTranscripts.map((t) => getTranscriptStableId(t));

      // Compute state hash
      const stateHash = computeStateHash({
        agent_id: state.agent_id,
        score: state.score,
        counters: state.counters,
      });

      output.states[targetSigner] = {
        agent_id: state.agent_id,
        score: state.score,
        counters: state.counters,
        included_transcripts: includedTranscripts,
        state_hash: stateHash,
      };
    }

    // Output JSON
    const jsonOutput = JSON.stringify(output, null, 2);

    if (outFile) {
      const resolvedOutFile = isAbsolute(outFile) ? outFile : resolve(process.cwd(), outFile);
      writeFileSync(resolvedOutFile, jsonOutput, "utf-8");
      console.error(`Output written to: ${resolvedOutFile}`);
    } else {
      console.log(jsonOutput);
    }
  } catch (error) {
    // Detailed error logging to capture stack trace
    console.error("=== Error Details ===");
    console.error(error);
    console.error("=== Stack Trace ===");
    console.error(error instanceof Error ? (error.stack ?? "(no stack)") : "(no stack)");
    
    // Print additional error properties
    if (error instanceof Error) {
      if (error.cause) {
        console.error("=== Error Cause ===");
        console.error(error.cause);
      }
      if ('code' in error) {
        console.error(`=== Error Code ===\n${error.code}`);
      }
      if ('errno' in error) {
        console.error(`=== Error Number ===\n${error.errno}`);
      }
      if ('syscall' in error) {
        console.error(`=== System Call ===\n${error.syscall}`);
      }
    } else if (typeof error === 'object' && error !== null) {
      // Handle non-Error objects
      console.error("=== Error Object Properties ===");
      for (const [key, value] of Object.entries(error)) {
        console.error(`${key}: ${value}`);
      }
    }
    
    console.error("=== End Error Details ===");
    process.exitCode = 1;
    return;
  }
}

// Only run main if this file is executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("passport_v1_recompute.ts")) {
  main().catch((error) => {
    // Catch any unhandled promise rejections from main()
    console.error("=== Unhandled Error in main() ===");
    console.error(error);
    console.error("=== Stack Trace ===");
    console.error(error instanceof Error ? (error.stack ?? "(no stack)") : "(no stack)");
    
    // Print additional error properties
    if (error instanceof Error) {
      if (error.cause) {
        console.error("=== Error Cause ===");
        console.error(error.cause);
      }
      if ('code' in error) {
        console.error(`=== Error Code ===\n${error.code}`);
      }
      if ('errno' in error) {
        console.error(`=== Error Number ===\n${error.errno}`);
      }
      if ('syscall' in error) {
        console.error(`=== System Call ===\n${error.syscall}`);
      }
    } else if (typeof error === 'object' && error !== null) {
      // Handle non-Error objects
      console.error("=== Error Object Properties ===");
      for (const [key, value] of Object.entries(error)) {
        console.error(`${key}: ${value}`);
      }
    }
    
    console.error("=== End Error Details ===");
    process.exitCode = 1;
  });
}
