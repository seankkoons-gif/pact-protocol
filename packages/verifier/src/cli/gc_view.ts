#!/usr/bin/env node
/**
 * GC View CLI
 *
 * Generates a General Counsel-readable summary from a v4 transcript.
 * Default: transcript-only (--transcript). Optional: evidence bundle (--bundle).
 *
 * Usage:
 *   pnpm -C packages/verifier gc-view --transcript <path> [--out <file>]
 *   pnpm -C packages/verifier gc-view --bundle <dir> [--out <file>]
 *   pnpm -C packages/verifier gc-view --bundle-id <id> [--out <file>]
 * 
 * Bundle resolution:
 *   - If --bundle is provided and exists, use it (takes precedence).
 *   - Else if --bundle looks like an id (no slashes), treat as bundle-id.
 *   - If --bundle-id is provided, search for .pact/bundles/<id> walking up from cwd.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, isAbsolute, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TranscriptV4 } from "../util/transcript_verify.js";
import { renderGCView } from "../gc_view/renderer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../..");

interface ParsedArgs {
  transcript?: string;
  bundle?: string;
  bundleId?: string;
  out?: string;
  constitutionPath?: string;
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {};
  let i = 2;

  while (i < process.argv.length) {
    const arg = process.argv[i];

    if (arg === "--transcript" && i + 1 < process.argv.length) {
      args.transcript = process.argv[++i];
    } else if (arg === "--bundle" && i + 1 < process.argv.length) {
      args.bundle = process.argv[++i];
    } else if (arg === "--bundle-id" && i + 1 < process.argv.length) {
      args.bundleId = process.argv[++i];
    } else if (arg === "--out" && i + 1 < process.argv.length) {
      args.out = process.argv[++i];
    } else if (arg === "--constitution-path" && i + 1 < process.argv.length) {
      args.constitutionPath = process.argv[++i];
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
    i++;
  }

  return args;
}

/**
 * Validate transcript shape early to prevent crashes from malformed JSON.
 * Checks for required fields before any property access.
 */
function validateTranscriptShape(transcript: any, filePath: string): asserts transcript is TranscriptV4 {
  if (!transcript || typeof transcript !== "object") {
    console.error(`Error: Invalid transcript: file does not contain a valid JSON object`);
    console.error(`File: ${filePath}`);
    process.exit(1);
  }

  if (typeof transcript.transcript_version !== "string") {
    console.error(`Error: Invalid transcript: missing or invalid transcript_version field`);
    console.error(`File: ${filePath}`);
    console.error(`Expected: "pact-transcript/4.0"`);
    console.error(`Got: ${transcript.transcript_version === undefined ? "undefined" : typeof transcript.transcript_version}`);
    process.exit(1);
  }

  if (transcript.transcript_version !== "pact-transcript/4.0") {
    console.error(`Error: Invalid transcript version: ${transcript.transcript_version}`);
    console.error(`File: ${filePath}`);
    console.error(`Expected: "pact-transcript/4.0"`);
    process.exit(1);
  }

  if (!Array.isArray(transcript.rounds)) {
    console.error(`Error: Invalid transcript: rounds field is missing or not an array`);
    console.error(`File: ${filePath}`);
    console.error(`Expected: array`);
    console.error(`Got: ${transcript.rounds === undefined ? "undefined" : typeof transcript.rounds}`);
    process.exit(1);
  }
}

/**
 * Load transcript from file.
 */
function loadTranscript(path: string): TranscriptV4 {
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
  let transcript: any;
  try {
    transcript = JSON.parse(content);
  } catch (error: any) {
    console.error(`Error: Invalid JSON in transcript file: ${resolvedPath}`);
    console.error(`Details: ${error.message}`);
    process.exit(1);
  }

  // Validate transcript shape early before any property access
  validateTranscriptShape(transcript, resolvedPath);
  
  return transcript as TranscriptV4;
}

/**
 * Find bundle directory by ID, walking up from current directory.
 * Searches for .pact/bundles/<id> starting from process.cwd() and walking up to filesystem root.
 */
function findBundleById(bundleId: string): string {
  const searchedRoots: string[] = [];
  let currentDir = process.cwd();
  const root = resolve("/");
  
  while (currentDir !== root && currentDir !== dirname(currentDir)) {
    const candidatePath = join(currentDir, ".pact", "bundles", bundleId);
    searchedRoots.push(candidatePath);
    
    if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
      return candidatePath;
    }
    
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break; // Reached filesystem root
    }
    currentDir = parentDir;
  }
  
  // Also check filesystem root
  const rootCandidate = join(root, ".pact", "bundles", bundleId);
  searchedRoots.push(rootCandidate);
  
  throw new Error(
    `Bundle ID not found: ${bundleId}\n` +
    `Searched for .pact/bundles/${bundleId} starting from:\n` +
    `  ${process.cwd()}\n` +
    `Searched paths:\n` +
    searchedRoots.map((p) => `  ${p}`).join("\n")
  );
}

/**
 * Resolve bundle path from --bundle or --bundle-id argument.
 * Resolution logic:
 * 1) If --bundle is provided and exists, use it (takes precedence over --bundle-id).
 * 2) Else if --bundle looks like an id (no slashes), treat as bundle-id.
 * 3) If --bundle-id is provided (and --bundle not provided), search for .pact/bundles/<id> walking up from cwd.
 */
function resolveBundlePath(bundleArg?: string, bundleIdArg?: string): string {
  // If bundle arg is provided, it takes precedence over bundle-id
  if (bundleArg) {
    // If it's an absolute path and exists, use it
    if (isAbsolute(bundleArg)) {
      if (existsSync(bundleArg) && statSync(bundleArg).isDirectory()) {
        return bundleArg;
      }
      throw new Error(`Bundle directory not found: ${bundleArg}`);
    }
    
    // If it exists as a relative path, use it
    if (existsSync(bundleArg) && statSync(bundleArg).isDirectory()) {
      return resolve(process.cwd(), bundleArg);
    }
    
    // If it looks like an id (no slashes), treat as bundle-id
    if (!bundleArg.includes("/") && !bundleArg.includes("\\")) {
      return findBundleById(bundleArg);
    }
    
    // Try relative to cwd and repo root
    const cwdPath = resolve(process.cwd(), bundleArg);
    const repoPath = resolve(repoRoot, bundleArg);
    
    if (existsSync(cwdPath) && statSync(cwdPath).isDirectory()) {
      return cwdPath;
    }
    if (existsSync(repoPath) && statSync(repoPath).isDirectory()) {
      return repoPath;
    }
    
    throw new Error(
      `Bundle directory not found: ${bundleArg}\n  Tried: ${cwdPath}\n  Tried: ${repoPath}`
    );
  }
  
  // If explicit bundle-id is provided (and no bundle arg), use it
  if (bundleIdArg) {
    return findBundleById(bundleIdArg);
  }
  
  throw new Error("No bundle path or bundle-id provided");
}

/**
 * Load transcript from evidence bundle directory.
 * Looks for transcript.json, manifest.json entries, or any .json with transcript_version pact-transcript/4.0.
 */
function loadTranscriptFromBundle(bundleDir: string): { transcript: TranscriptV4; transcriptPath: string } {
  const resolvedDir = bundleDir;

  const transcriptPath = join(resolvedDir, "transcript.json");
  if (existsSync(transcriptPath)) {
    return {
      transcript: loadTranscript(transcriptPath),
      transcriptPath,
    };
  }

  const manifestPath = join(resolvedDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (manifest.entries && Array.isArray(manifest.entries)) {
      const transcriptEntry = manifest.entries.find((e: { type?: string }) => e.type === "transcript");
      if (transcriptEntry?.path) {
        const foundPath = join(resolvedDir, transcriptEntry.path);
        if (existsSync(foundPath)) {
          return {
            transcript: loadTranscript(foundPath),
            transcriptPath: foundPath,
          };
        }
      }
    }
  }

  const files = readdirSync(resolvedDir);
  for (const file of files) {
    if (file.endsWith(".json") && file !== "manifest.json") {
      const candidatePath = join(resolvedDir, file);
      try {
        const content = JSON.parse(readFileSync(candidatePath, "utf-8"));
        // Validate shape before checking version
        if (typeof content.transcript_version === "string" && content.transcript_version === "pact-transcript/4.0") {
          // Validate full shape before returning
          validateTranscriptShape(content, candidatePath);
          return {
            transcript: content as TranscriptV4,
            transcriptPath: candidatePath,
          };
        }
      } catch (error: any) {
        // Skip invalid files, but log if it's a validation error (not JSON parse error)
        if (error.message && error.message.includes("Invalid transcript")) {
          // This will have already printed error and exited, so we won't reach here
        }
        /* skip other errors */
      }
    }
  }

  throw new Error(`No transcript found in bundle directory: ${bundleDir}`);
}

/**
 * Normalize path to relative if possible.
 */
function normalizePath(path: string): string {
  if (isAbsolute(path)) {
    if (path.startsWith(repoRoot + "/")) {
      return path.slice(repoRoot.length + 1);
    }
    if (path.startsWith(process.cwd() + "/")) {
      return path.slice(process.cwd().length + 1);
    }
  }
  return path;
}

// Handle EPIPE gracefully (e.g., when piping to head/jq)
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

export async function main(): Promise<void> {
  try {
    const args = parseArgs();

    let transcript: TranscriptV4;
    let transcriptPath: string;
    let bundlePath: string | undefined;

    if (args.bundle || args.bundleId) {
      const resolvedBundlePath = resolveBundlePath(args.bundle, args.bundleId);
      const result = loadTranscriptFromBundle(resolvedBundlePath);
      transcript = result.transcript;
      transcriptPath = normalizePath(result.transcriptPath);
      bundlePath = normalizePath(resolvedBundlePath);
    } else if (args.transcript) {
      transcript = loadTranscript(args.transcript);
      transcriptPath = normalizePath(args.transcript);
    } else {
      console.error("Usage: gc_view --transcript <path> [--out <file>]");
      console.error("   or: gc_view --bundle <dir> [--out <file>]");
      console.error("   or: gc_view --bundle-id <id> [--out <file>]");
      process.exitCode = 1;
      return;
    }

    const gcView = await renderGCView(transcript, {
      transcriptPath,
      bundlePath,
      constitutionPath: args.constitutionPath,
    });

    const jsonOutput = JSON.stringify(gcView, null, 2);

    if (args.out) {
      const resolvedOut = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out);
      writeFileSync(resolvedOut, jsonOutput, "utf-8");
      console.error(`GC view written to: ${resolvedOut}`);
    } else {
      console.log(jsonOutput);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
    return;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("gc_view.ts")) {
  main().catch((error) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exitCode = 1;
  });
}
