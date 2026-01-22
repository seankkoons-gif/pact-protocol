#!/usr/bin/env node
/**
 * GC View CLI
 *
 * Generates a General Counsel-readable summary from a v4 transcript.
 * Transcript-only input; bundle support is optional (see --bundle in later releases).
 *
 * Usage:
 *   pnpm -C packages/verifier gc-view --transcript <path> [--out <file>]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TranscriptV4 } from "../util/transcript_verify.js";
import { renderGCView } from "../gc_view/renderer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../../..");

interface ParsedArgs {
  transcript?: string;
  out?: string;
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {};
  let i = 2;

  while (i < process.argv.length) {
    const arg = process.argv[i];

    if (arg === "--transcript" && i + 1 < process.argv.length) {
      args.transcript = process.argv[++i];
    } else if (arg === "--out" && i + 1 < process.argv.length) {
      args.out = process.argv[++i];
    } else if (arg.startsWith("--")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
    i++;
  }

  return args;
}

/**
 * Load transcript from file.
 */
function loadTranscript(path: string): TranscriptV4 {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:loadTranscript:entry',message:'loadTranscript called',data:{path,isAbsolute:isAbsolute(path),cwd:process.cwd(),repoRoot},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  let resolvedPath: string;
  if (isAbsolute(path)) {
    resolvedPath = path;
  } else if (existsSync(path)) {
    resolvedPath = resolve(process.cwd(), path);
  } else {
    resolvedPath = resolve(repoRoot, path);
    if (!existsSync(resolvedPath)) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:loadTranscript:error',message:'File not found',data:{path,attemptedCwd:resolve(process.cwd(),path),attemptedRepoRoot:resolvedPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      throw new Error(
        `Transcript file not found: ${path}\n  Tried: ${resolve(process.cwd(), path)}\n  Tried: ${resolvedPath}`
      );
    }
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:loadTranscript:success',message:'Path resolved',data:{originalPath:path,resolvedPath,exists:existsSync(resolvedPath)},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  const content = readFileSync(resolvedPath, "utf-8");
  return JSON.parse(content) as TranscriptV4;
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

export async function main(): Promise<void> {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:main:entry',message:'main started',data:{argv:process.argv.slice(2),cwd:process.cwd(),repoRoot},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    const args = parseArgs();
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:main:argsParsed',message:'Args parsed',data:{args},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    if (!args.transcript) {
      console.error("Usage: gc_view --transcript <path> [--out <file>]");
      process.exitCode = 1;
      return;
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:main:beforeLoad',message:'About to load transcript',data:{transcriptPath:args.transcript},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    const transcript = loadTranscript(args.transcript);
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:main:afterLoad',message:'Transcript loaded',data:{transcriptId:transcript.transcript_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    const transcriptPath = normalizePath(args.transcript);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:main:beforeRender',message:'About to render GC view',data:{transcriptPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    const gcView = await renderGCView(transcript, {
      transcriptPath,
    });

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:main:afterRender',message:'GC view rendered',data:{version:gcView.version},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    const jsonOutput = JSON.stringify(gcView, null, 2);

    if (args.out) {
      const resolvedOut = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out);
      writeFileSync(resolvedOut, jsonOutput, "utf-8");
      console.error(`GC view written to: ${resolvedOut}`);
    } else {
      console.log(jsonOutput);
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:main:success',message:'main completed',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/d6fd9176-2481-40f5-93f3-71356369ce4a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'gc_view.ts:main:error',message:'Error in main',data:{errorMessage:error instanceof Error ? error.message : String(error),errorStack:error instanceof Error ? error.stack : undefined,errorName:error instanceof Error ? error.name : undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
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
