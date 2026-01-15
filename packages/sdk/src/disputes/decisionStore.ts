/**
 * Dispute Decision Store (C3)
 * 
 * Filesystem-based storage for signed dispute decisions.
 */

import * as fs from "fs";
import * as path from "path";
import type { SignedDecision } from "./decision";

const DEFAULT_DECISION_DIR = path.join(process.cwd(), ".pact", "disputes", "decisions");

/**
 * Get the decision store directory.
 */
export function getDecisionDir(customDir?: string): string {
  if (customDir) {
    return customDir;
  }
  // If customDir not provided, use default relative to .pact/disputes/decisions
  return DEFAULT_DECISION_DIR;
}

/**
 * Ensure the decision directory exists.
 */
function ensureDecisionDir(decisionDir: string): void {
  if (!fs.existsSync(decisionDir)) {
    fs.mkdirSync(decisionDir, { recursive: true });
  }
}

/**
 * Get the file path for a decision.
 */
function getDecisionFilePath(decisionId: string, decisionDir: string): string {
  return path.join(decisionDir, `${decisionId}.json`);
}

/**
 * Write a signed decision to disk.
 * @param signedDecision The signed decision to store
 * @param customDir Optional custom directory (defaults to .pact/disputes/decisions)
 * @returns The path where the decision was written
 */
export function writeDecision(
  signedDecision: SignedDecision,
  customDir?: string
): string {
  const dir = getDecisionDir(customDir);
  ensureDecisionDir(dir);
  const filePath = getDecisionFilePath(signedDecision.decision.decision_id, dir);
  fs.writeFileSync(filePath, JSON.stringify(signedDecision, null, 2), "utf-8");
  return filePath;
}

/**
 * Load a signed decision from disk.
 * @param decisionId The decision ID
 * @param customDir Optional custom directory (defaults to .pact/disputes/decisions)
 * @returns The signed decision or null if not found
 */
export function loadDecision(
  decisionId: string,
  customDir?: string
): SignedDecision | null {
  const dir = getDecisionDir(customDir);
  const filePath = getDecisionFilePath(decisionId, dir);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as SignedDecision;
  } catch (error) {
    return null;
  }
}

/**
 * Load a signed decision from a file path.
 * @param filePath The full path to the decision file
 * @returns The signed decision or null if not found
 */
export function loadDecisionFromPath(filePath: string): SignedDecision | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as SignedDecision;
  } catch (error) {
    return null;
  }
}




