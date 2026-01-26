#!/usr/bin/env node
/**
 * Find and print the most recent transcript file path
 * 
 * Usage:
 *   node scripts/transcript-latest.mjs
 * 
 * Prints the path to the most recent .pact/transcripts/*.json file (by mtime)
 * or exits with error if no transcripts found.
 */

import { readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const TRANSCRIPTS_DIR = join(REPO_ROOT, ".pact", "transcripts");

async function findLatestTranscript() {
  try {
    // Check if transcripts directory exists
    const files = await readdir(TRANSCRIPTS_DIR);
    
    // Filter to only .json files
    const jsonFiles = files.filter(f => f.endsWith(".json"));
    
    if (jsonFiles.length === 0) {
      console.error("❌ No transcript files found in .pact/transcripts/");
      process.exit(1);
    }
    
    // Get stats for all JSON files and sort by mtimeMs (descending)
    const filesWithStats = await Promise.all(
      jsonFiles.map(async (file) => {
        const filePath = join(TRANSCRIPTS_DIR, file);
        const stats = await stat(filePath);
        return {
          path: filePath,
          mtimeMs: stats.mtimeMs,
        };
      })
    );
    
    // Sort by mtimeMs descending (most recent first)
    filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    
    // Print the most recent file path
    console.log(filesWithStats[0].path);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`❌ Transcripts directory not found: ${TRANSCRIPTS_DIR}`);
      console.error("   Run a demo or test that generates transcripts first.");
      process.exit(1);
    } else {
      console.error(`❌ Error finding latest transcript: ${error.message}`);
      process.exit(1);
    }
  }
}

findLatestTranscript();
