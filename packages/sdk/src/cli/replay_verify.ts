#!/usr/bin/env node
/**
 * H1: Replay Verification CLI
 * 
 * Verifies transcript files with stronger invariants.
 * 
 * Usage:
 *   pnpm replay:verify -- <path>
 * 
 * Supports:
 *   - Single file: pnpm replay:verify -- transcript.json
 *   - Glob pattern: pnpm replay:verify -- "*.json"
 *   - Directory: pnpm replay:verify -- .pact/transcripts
 */

import * as fs from "fs";
import * as path from "path";
import { verifyTranscriptFile } from "../transcript/replay";

/**
 * Recursively find all .json files in a directory.
 */
function findJsonFiles(dir: string): string[] {
  const files: string[] = [];
  
  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: pnpm replay:verify -- <path>");
    console.error("  <path> can be a file or directory");
    process.exit(1);
  }
  
  const inputPath = args[0];
  
  // Resolve files to verify
  let files: string[] = [];
  
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: ${inputPath} does not exist`);
    process.exit(1);
  }
  
  const stat = fs.statSync(inputPath);
  
  if (stat.isDirectory()) {
    // Directory: find all *.json files recursively
    files = findJsonFiles(path.resolve(inputPath));
  } else if (stat.isFile()) {
    // Single file
    if (!inputPath.endsWith(".json")) {
      console.error(`Error: ${inputPath} is not a .json file`);
      process.exit(1);
    }
    files = [path.resolve(inputPath)];
  } else {
    console.error(`Error: ${inputPath} is not a file or directory`);
    process.exit(1);
  }
  
  if (files.length === 0) {
    console.error(`No .json files found in: ${inputPath}`);
    process.exit(1);
  }
  
  // Verify each file
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalFiles = 0;
  
  for (const file of files) {
    totalFiles++;
    const result = await verifyTranscriptFile(file);
    
    if (result.errors.length > 0 || result.warnings.length > 0) {
      console.log(`\n${file}:`);
      
      if (result.warnings.length > 0) {
        totalWarnings += result.warnings.length;
        for (const warning of result.warnings) {
          console.log(`  ⚠️  WARNING: ${warning}`);
        }
      }
      
      if (result.errors.length > 0) {
        totalErrors += result.errors.length;
        for (const error of result.errors) {
          console.log(`  ❌ ERROR: ${error}`);
        }
      }
    }
  }
  
  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Files verified: ${totalFiles}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log(`Total warnings: ${totalWarnings}`);
  
  if (totalErrors > 0) {
    console.log(`\n❌ Verification failed with ${totalErrors} error(s)`);
    process.exit(1);
  } else {
    console.log(`\n✅ All transcripts verified successfully`);
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

