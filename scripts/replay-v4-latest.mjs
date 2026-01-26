#!/usr/bin/env node
/**
 * Replay the most recent transcript using replay_v4.ts
 * 
 * Usage:
 *   node scripts/replay-v4-latest.mjs
 * 
 * Finds the latest transcript and runs replay_v4.ts on it.
 */

import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");

// Import the transcript-latest script logic
async function getLatestTranscript() {
  const { readdir, stat } = await import("node:fs/promises");
  const TRANSCRIPTS_DIR = join(REPO_ROOT, ".pact", "transcripts");
  
  try {
    const files = await readdir(TRANSCRIPTS_DIR);
    const jsonFiles = files.filter(f => f.endsWith(".json"));
    
    if (jsonFiles.length === 0) {
      throw new Error("No transcript files found");
    }
    
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
    
    filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return filesWithStats[0].path;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Transcripts directory not found: ${TRANSCRIPTS_DIR}`);
    }
    throw error;
  }
}

async function replayLatest() {
  try {
    const latestTranscript = await getLatestTranscript();
    console.log(`📄 Replaying latest transcript: ${latestTranscript}\n`);
    
    // Run replay_v4.ts on the latest transcript
    // Using the same pattern as the existing replay:v4 script
    execSync(
      `pnpm --filter @pact/sdk exec tsx src/cli/replay_v4.ts "${latestTranscript}"`,
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
      }
    );
  } catch (error) {
    if (error.message.includes("No transcript files found") || error.message.includes("not found")) {
      console.error(`❌ ${error.message}`);
      console.error("   Run a demo or test that generates transcripts first.");
      process.exit(1);
    } else if (error.status !== undefined) {
      // execSync error (non-zero exit)
      process.exit(error.status);
    } else {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    }
  }
}

replayLatest();
