#!/usr/bin/env node
/**
 * CLI for Default Blame Logic (DBL) v2
 * 
 * Takes a verified v4 transcript and outputs a deterministic Judgment Artifact.
 * 
 * Usage:
 *   node dist/cli/judge_v4.js --transcript <path> [--out <file>]
 *   node dist/cli/judge_v4.js <path> [--out <file>]
 */

import { resolveBlameV1 } from "../dbl/blame_resolver_v1.js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Repo root is 3 levels up from packages/verifier/src/cli/judge_v4.ts
const repoRoot = resolve(__dirname, "../../../..");

// Handle EPIPE gracefully (e.g., when piping to head/jq)
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

interface ParsedArgs {
  transcript?: string;
  out?: string;
  json?: boolean;
  human?: boolean;
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {
    json: true, // Default: output JSON
  };
  let i = 2;
  let positionalArgs: string[] = [];

  while (i < process.argv.length) {
    const arg = process.argv[i];

    if (arg === "--transcript" && i + 1 < process.argv.length) {
      args.transcript = process.argv[++i];
    } else if (arg === "--out" && i + 1 < process.argv.length) {
      args.out = process.argv[++i];
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--human") {
      args.human = true;
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      // Positional argument
      positionalArgs.push(arg);
    }
    i++;
  }

  // If --transcript not provided, use first positional arg
  if (!args.transcript && positionalArgs.length > 0) {
    args.transcript = positionalArgs[0];
  }

  return args;
}

/**
 * Load transcript from file.
 */
function loadTranscript(path: string): any {
  let resolvedPath: string;
  if (isAbsolute(path)) {
    resolvedPath = path;
  } else if (existsSync(path)) {
    resolvedPath = resolve(process.cwd(), path);
  } else {
    resolvedPath = resolve(repoRoot, path);
    if (!existsSync(resolvedPath)) {
      throw new Error(
        `Transcript file not found: ${path}\n  Tried: ${resolve(process.cwd(), path)}\n  Tried: ${resolvedPath}`
      );
    }
  }

  const content = readFileSync(resolvedPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Normalize dbl/2.0 judgment fields to ensure they are never null/undefined.
 * This function enforces defaults at the FINAL output assembly point (just before JSON stringify).
 * 
 * Creates/ensures a `judgment` object with snake_case fields:
 * - judgment.required_next_actor
 * - judgment.required_action
 * - judgment.terminal
 * 
 * Rules:
 * - If version is "dbl/2.0" then enforce non-null defaults in judgment object
 * - terminal: boolean (never null)
 * - required_next_actor: string enum (never null, default "NONE")
 * - required_action: string enum (never null, default "NONE")
 * 
 * Defaults by scenario:
 * - NO_FAULT success => terminal=true, required_next_actor="NONE", required_action="NONE"
 * - PACT-101 => terminal=true, required_next_actor="BUYER", required_action="FIX_POLICY_OR_PARAMS"
 * - PACT-404 => terminal=false, required_next_actor="PROVIDER", required_action="COMPLETE_SETTLEMENT_OR_REFUND"
 * - INTEGRITY failure => terminal=true, required_next_actor="NONE", required_action="NONE"
 */
function normalizeDblV2Fields(artifact: any, transcript: any): any {
  // Only normalize if version is dbl/2.0
  if (!artifact.version || artifact.version !== "dbl/2.0") {
    return artifact;
  }

  const normalized = { ...artifact };

  // Ensure judgment object exists
  if (!normalized.judgment) {
    normalized.judgment = {};
  }

  // Determine defaults based on scenario
  let defaultTerminal: boolean = true;
  let defaultRequiredNextActor: string = "NONE";
  let defaultRequiredAction: string = "NONE";

  // Scenario: NO_FAULT success
  if (artifact.dblDetermination === "NO_FAULT" && artifact.status === "OK") {
    defaultTerminal = true;
    defaultRequiredNextActor = "NONE";
    defaultRequiredAction = "NONE";
  }
  // Scenario: PACT-101 (policy violation)
  else if (artifact.failureCode === "PACT-101") {
    defaultTerminal = true;
    defaultRequiredNextActor = "BUYER";
    defaultRequiredAction = "FIX_POLICY_OR_PARAMS";
  }
  // Scenario: PACT-404 (settlement timeout)
  else if (artifact.failureCode === "PACT-404") {
    defaultTerminal = false;
    defaultRequiredNextActor = "PROVIDER";
    defaultRequiredAction = "COMPLETE_SETTLEMENT_OR_REFUND";
  }
  // Scenario: INTEGRITY failure / FINAL_HASH_MISMATCH
  else if (artifact.status === "FAILED" && (
    artifact.notes?.includes("final hash") || 
    artifact.notes?.includes("FINAL_HASH") ||
    artifact.notes?.includes("integrity") ||
    artifact.notes?.includes("INTEGRITY")
  )) {
    defaultTerminal = true;
    defaultRequiredNextActor = "NONE";
    defaultRequiredAction = "NONE";
  }

  // Enforce non-null defaults in judgment object (snake_case)
  if (normalized.judgment.terminal === null || normalized.judgment.terminal === undefined) {
    // Also check top-level fields as fallback (for backward compatibility during transition)
    const terminalValue = normalized.judgment.terminal ?? normalized.terminal ?? defaultTerminal;
    normalized.judgment.terminal = Boolean(terminalValue);
  } else {
    normalized.judgment.terminal = Boolean(normalized.judgment.terminal);
  }

  if (normalized.judgment.required_next_actor === null || normalized.judgment.required_next_actor === undefined) {
    // Also check top-level fields as fallback (for backward compatibility during transition)
    const actorValue = normalized.judgment.required_next_actor ?? normalized.requiredNextActor ?? defaultRequiredNextActor;
    normalized.judgment.required_next_actor = String(actorValue);
  } else {
    normalized.judgment.required_next_actor = String(normalized.judgment.required_next_actor);
  }

  if (normalized.judgment.required_action === null || normalized.judgment.required_action === undefined) {
    // Also check top-level fields as fallback (for backward compatibility during transition)
    const actionValue = normalized.judgment.required_action ?? normalized.requiredAction ?? defaultRequiredAction;
    normalized.judgment.required_action = String(actionValue);
  } else {
    normalized.judgment.required_action = String(normalized.judgment.required_action);
  }

  return normalized;
}

(async () => {
  try {
    const args = parseArgs();

    if (!args.transcript) {
      console.error("Usage: judge_v4.js --transcript <path> [--out <file>] [--human]");
      console.error("   or: judge_v4.js <path> [--out <file>] [--human]");
      console.error("");
      console.error("Options:");
      console.error("  --transcript <path>  Transcript file path (required)");
      console.error("  --out <file>         Write JSON to file instead of stdout");
      console.error("  --human              Print human-readable summary to stderr");
      console.error("  --json               Output JSON (default: true)");
      process.exit(1);
    }

    // Load transcript
    const transcript = loadTranscript(args.transcript);

    // Resolve blame (async)
    const judgment = await resolveBlameV1(transcript);

    // Normalize dbl/2.0 fields to ensure they are never null (enforce at FINAL output assembly point)
    const normalizedJudgment = normalizeDblV2Fields(judgment, transcript);

    // Output JSON (stdout only) - default behavior
    if (args.json !== false) {
      const jsonOutput = JSON.stringify(normalizedJudgment, null, 2);

      if (args.out) {
        // Write to file
        writeFileSync(args.out, jsonOutput, "utf-8");
      } else {
        // Write to stdout (ONLY JSON, with trailing newline for proper formatting)
        console.log(jsonOutput);
      }
    }

    // Output compact human-readable line to stderr (only if --human flag is passed)
    if (args.human) {
      const compactLine = [
        `Status: ${normalizedJudgment.status}`,
        normalizedJudgment.failureCode ? `Code: ${normalizedJudgment.failureCode}` : null,
        `LVSH: Round ${normalizedJudgment.lastValidRound} (${normalizedJudgment.lastValidSummary})`,
        `Determination: ${normalizedJudgment.dblDetermination}`,
        `Passport: ${normalizedJudgment.passportImpact >= 0 ? '+' : ''}${normalizedJudgment.passportImpact}`,
        `Confidence: ${(normalizedJudgment.confidence * 100).toFixed(0)}%`,
        normalizedJudgment.recommendation ? `→ ${normalizedJudgment.recommendation}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      console.error(compactLine);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
})();
