/**
 * Transcript Store
 * 
 * Writes audit/debug transcripts to disk.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/**
 * Find repository root by walking up from current directory
 * looking for package.json or .git directory.
 */
function findRepoRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root; // Get filesystem root (e.g., "/" or "C:\")
  
  while (current !== root) {
    // Check for repo root markers
    const hasPackageJson = fs.existsSync(path.join(current, "package.json"));
    const hasGit = fs.existsSync(path.join(current, ".git"));
    const hasPnpmWorkspace = fs.existsSync(path.join(current, "pnpm-workspace.yaml"));
    
    if (hasPackageJson && (hasGit || hasPnpmWorkspace)) {
      return current;
    }
    
    const parent = path.dirname(current);
    if (parent === current) break; // Reached root
    current = parent;
  }
  
  // Fallback to startDir if repo root not found
  return startDir;
}

export class TranscriptStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    // Check for PACT_TRANSCRIPT_DIR env var first, then use provided baseDir, then default
    const envDir = process.env.PACT_TRANSCRIPT_DIR;
    const dir = baseDir || envDir || ".pact/transcripts";
    
    // If relative path, resolve against repo root (not process.cwd())
    if (!path.isAbsolute(dir)) {
      const repoRoot = findRepoRoot();
      this.baseDir = path.resolve(repoRoot, dir);
    } else {
      this.baseDir = dir;
    }
  }

  /**
   * Generate a random 6-character hex string for filename uniqueness.
   */
  private generateRandomSuffix(): string {
    return crypto.randomBytes(3).toString("hex");
  }

  /**
   * Write a transcript to disk.
   * @param intentId The intent ID (used as filename)
   * @param transcript The transcript data
   * @param customDir Optional custom directory (overrides baseDir)
   * @returns The path where the transcript was written
   */
  async writeTranscript(
    intentId: string,
    transcript: any,
    customDir?: string
  ): Promise<string> {
    const targetDir = customDir || this.baseDir;
    
    // Ensure directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // H1: Set transcript_version if not already set
    if (!transcript.transcript_version) {
      transcript.transcript_version = "1.0";
    }
    
    // Sanitize intentId for filename (remove invalid chars)
    const sanitizedId = intentId.replace(/[^a-zA-Z0-9_-]/g, "_");
    
    // Include timestamp_ms in filename for uniqueness
    // Use transcript.timestamp_ms if available, otherwise use current time
    const timestamp = transcript?.timestamp_ms || Date.now();
    
    // Add random suffix to ensure uniqueness even when timestamp is constant
    const rand6 = this.generateRandomSuffix();
    const filename = `${sanitizedId}-${timestamp}-${rand6}.json`;
    const filepath = path.join(targetDir, filename);
    
    // Write pretty JSON
    fs.writeFileSync(
      filepath,
      JSON.stringify(transcript, null, 2),
      "utf-8"
    );
    
    return filepath;
  }
}

