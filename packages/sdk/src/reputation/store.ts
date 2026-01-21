/**
 * Receipt Store
 * 
 * In-memory store for receipts with optional JSONL persistence.
 */

import { readFileSync, existsSync, appendFileSync } from "node:fs";

export class ReceiptStore {
  private receipts: any[] = [];
  private jsonlPath?: string;
  // Track committed intent fingerprints to prevent double-commit (PACT-331)
  private committedFingerprints: Map<string, { transcriptId: string; timestamp_ms: number }> = new Map();

  constructor(opts?: { jsonlPath?: string }) {
    this.jsonlPath = opts?.jsonlPath;
  }

  /**
   * Ingest a receipt into the store.
   * If jsonlPath is set, append to file as JSON line.
   */
  ingest(receipt: any): void {
    this.receipts.push(receipt);
    
    if (this.jsonlPath) {
      try {
        const line = JSON.stringify(receipt) + "\n";
        appendFileSync(this.jsonlPath, line, "utf8");
      } catch (err) {
        // Ignore write errors in demo/test contexts
      }
    }
  }

  /**
   * List receipts with optional filters.
   */
  list(opts?: { limit?: number; intentType?: string; agentId?: string }): any[] {
    let filtered = [...this.receipts];

    if (opts?.intentType) {
      filtered = filtered.filter((r) => (r as any).intent_type === opts.intentType);
    }

    if (opts?.agentId) {
      filtered = filtered.filter(
        (r) => r.buyer_agent_id === opts.agentId || r.seller_agent_id === opts.agentId
      );
    }

    if (opts?.limit) {
      filtered = filtered.slice(-opts.limit);
    }

    return filtered;
  }

  /**
   * Check if an intent fingerprint has already been committed.
   * Returns the prior transcript_id if found, null otherwise.
   */
  hasCommittedFingerprint(fingerprint: string): { transcriptId: string; timestamp_ms: number } | null {
    const entry = this.committedFingerprints.get(fingerprint);
    return entry || null;
  }

  /**
   * Mark an intent fingerprint as committed (atomic reservation).
   * This should be called only after successful settlement commit.
   */
  markFingerprintCommitted(fingerprint: string, transcriptId: string, timestamp_ms: number): void {
    this.committedFingerprints.set(fingerprint, { transcriptId, timestamp_ms });
  }

  /**
   * Release a fingerprint reservation (on failure).
   * This allows retries of the same intent if the first attempt failed.
   */
  releaseFingerprint(fingerprint: string): void {
    this.committedFingerprints.delete(fingerprint);
  }

  /**
   * Load receipts from JSONL file if it exists.
   * Ignores malformed lines.
   */
  loadFromJsonl(): void {
    if (!this.jsonlPath || !existsSync(this.jsonlPath)) {
      return;
    }

    try {
      const content = readFileSync(this.jsonlPath, "utf8");
      const lines = content.trim().split("\n").filter((line) => line.trim());
      
      for (const line of lines) {
        try {
          const receipt = JSON.parse(line);
          this.receipts.push(receipt);
        } catch {
          // Ignore malformed lines
        }
      }
    } catch (err) {
      // Ignore read errors (file might not exist yet)
    }
  }
}

