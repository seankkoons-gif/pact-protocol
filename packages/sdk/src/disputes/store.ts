/**
 * Dispute Store
 * 
 * Filesystem-based storage for dispute records.
 */

import * as fs from "fs";
import * as path from "path";
import type { DisputeRecord } from "./types";

const DEFAULT_DISPUTE_DIR = path.join(process.cwd(), ".pact", "disputes");

/**
 * Get the dispute store directory.
 */
export function getDisputeDir(customDir?: string): string {
  return customDir || DEFAULT_DISPUTE_DIR;
}

/**
 * Ensure the dispute directory exists.
 */
function ensureDisputeDir(disputeDir: string): void {
  if (!fs.existsSync(disputeDir)) {
    fs.mkdirSync(disputeDir, { recursive: true });
  }
}

/**
 * Get the file path for a dispute record.
 */
function getDisputeFilePath(disputeId: string, disputeDir: string): string {
  return path.join(disputeDir, `${disputeId}.json`);
}

/**
 * Create a new dispute record.
 */
export function createDispute(record: DisputeRecord, disputeDir?: string): void {
  const dir = getDisputeDir(disputeDir);
  ensureDisputeDir(dir);
  const filePath = getDisputeFilePath(record.dispute_id, dir);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
}

/**
 * Load a dispute record by ID.
 */
export function loadDispute(disputeId: string, disputeDir?: string): DisputeRecord | null {
  const dir = getDisputeDir(disputeDir);
  const filePath = getDisputeFilePath(disputeId, dir);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as DisputeRecord;
  } catch (error) {
    return null;
  }
}

/**
 * List all dispute records.
 */
export function listDisputes(disputeDir?: string): DisputeRecord[] {
  const dir = getDisputeDir(disputeDir);
  
  if (!fs.existsSync(dir)) {
    return [];
  }
  
  const files = fs.readdirSync(dir);
  const disputes: DisputeRecord[] = [];
  
  for (const file of files) {
    if (file.endsWith(".json")) {
      const disputeId = file.slice(0, -5); // Remove .json extension
      const dispute = loadDispute(disputeId, disputeDir);
      if (dispute) {
        disputes.push(dispute);
      }
    }
  }
  
  return disputes;
}

/**
 * Update an existing dispute record.
 */
export function updateDispute(record: DisputeRecord, disputeDir?: string): void {
  const dir = getDisputeDir(disputeDir);
  const filePath = getDisputeFilePath(record.dispute_id, dir);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dispute ${record.dispute_id} not found`);
  }
  
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
}




