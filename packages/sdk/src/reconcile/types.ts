/**
 * Reconciliation Types
 * 
 * Types for reconciling pending settlement handles in transcripts (D2).
 */

import type { SettlementProvider } from "../settlement/provider";
import type { TranscriptV1 } from "../transcript/types";

/**
 * Input for reconcile() function.
 */
export interface ReconcileInput {
  /**
   * Path to transcript JSON file (optional if transcript is provided directly).
   */
  transcriptPath?: string;
  
  /**
   * Transcript object (optional if transcriptPath is provided).
   */
  transcript?: TranscriptV1;
  
  /**
   * Function to get current timestamp (for testing).
   */
  now: () => number;
  
  /**
   * Settlement provider to poll for pending handles.
   */
  settlement: SettlementProvider;
}

/**
 * Reconciliation event recording a status transition.
 */
export interface ReconcileEvent {
  /**
   * Timestamp when reconciliation occurred (ms since epoch).
   */
  ts_ms: number;
  
  /**
   * Settlement handle ID that was reconciled.
   */
  handle_id: string;
  
  /**
   * Previous status before reconciliation.
   */
  from_status: string;
  
  /**
   * New status after reconciliation.
   */
  to_status: string;
  
  /**
   * Optional note about the reconciliation.
   */
  note?: string;
}

/**
 * Result of reconcile() operation.
 */
export interface ReconcileResult {
  /**
   * Whether reconciliation succeeded (false only on errors, not on NOOP).
   */
  ok: boolean;
  
  /**
   * Reconciliation status.
   * - NOOP: No pending handles found, nothing to reconcile
   * - UPDATED: Transcript was updated with reconciliation results
   * - FAILED: Error occurred during reconciliation
   */
  status: "NOOP" | "UPDATED" | "FAILED";
  
  /**
   * Path to updated transcript file (if status is UPDATED).
   */
  updatedTranscriptPath?: string;
  
  /**
   * Error reason (if status is FAILED).
   */
  reason?: string;
  
  /**
   * List of handles that were reconciled.
   */
  reconciledHandles: Array<{
    handle_id: string;
    status: string;
  }>;
}




