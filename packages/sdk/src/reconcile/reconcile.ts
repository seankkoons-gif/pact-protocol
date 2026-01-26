/**
 * Reconciliation Implementation
 * 
 * Reconciles pending settlement handles in transcripts (D2).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { ReconcileInput, ReconcileResult, ReconcileEvent } from "./types";
import type { TranscriptV1 } from "../transcript/types";
import type { SettlementResult } from "../settlement/types";

/**
 * Generate a short hash for filename suffix.
 */
function generateShortHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").substring(0, 8);
}

/**
 * Reconcile pending settlement handles in a transcript.
 * 
 * @param input Reconciliation input with transcript and settlement provider
 * @returns Reconciliation result with updated transcript path
 */
export async function reconcile(input: ReconcileInput): Promise<ReconcileResult> {
  const { transcriptPath, transcript: transcriptObj, now, settlement } = input;

  // Load transcript
  let transcript: TranscriptV1;
  if (transcriptPath) {
    try {
      const content = fs.readFileSync(transcriptPath, "utf-8");
      transcript = JSON.parse(content);
    } catch (error: any) {
      return {
        ok: false,
        status: "FAILED",
        reason: `Failed to load transcript from ${transcriptPath}: ${error.message}`,
        reconciledHandles: [],
      };
    }
  } else if (transcriptObj) {
    transcript = transcriptObj;
  } else {
    return {
      ok: false,
      status: "FAILED",
      reason: "Either transcriptPath or transcript must be provided",
      reconciledHandles: [],
    };
  }

  // Check if settlement_lifecycle exists and has pending handles
  const lifecycle = transcript.settlement_lifecycle;
  if (!lifecycle || !lifecycle.handle_id) {
    return {
      ok: true,
      status: "NOOP",
      reason: "No settlement_lifecycle or handle_id found in transcript",
      reconciledHandles: [],
    };
  }

  // Check if handle is pending
  const currentStatus = lifecycle.status;
  if (currentStatus !== "pending") {
    return {
      ok: true,
      status: "NOOP",
      reason: `Settlement handle is not pending (current status: ${currentStatus})`,
      reconciledHandles: [],
    };
  }

  // Check if settlement provider supports poll
  if (!settlement.poll) {
    return {
      ok: false,
      status: "FAILED",
      reason: "Settlement provider does not support poll() method",
      reconciledHandles: [],
    };
  }

  // Poll the handle once
  const handleId = lifecycle.handle_id;
  let pollResult: SettlementResult;
  try {
    pollResult = await settlement.poll(handleId);
  } catch (error: any) {
    return {
      ok: false,
      status: "FAILED",
      reason: `Failed to poll handle ${handleId}: ${error.message}`,
      reconciledHandles: [],
    };
  }

  // Check if status changed
  const newStatus = pollResult.status;
  if (newStatus === "pending") {
    // Still pending - no change
    return {
      ok: true,
      status: "NOOP",
      reason: `Handle ${handleId} is still pending after poll`,
      reconciledHandles: [],
    };
  }

  // Status changed - update transcript
  const timestamp = now();
  const reconcileEvent: ReconcileEvent = {
    ts_ms: timestamp,
    handle_id: handleId,
    from_status: currentStatus,
    to_status: newStatus,
    note: newStatus === "committed" 
      ? `Settlement committed with paid_amount: ${pollResult.paid_amount}`
      : newStatus === "failed"
      ? `Settlement failed: ${pollResult.failure_reason || pollResult.failure_code || "unknown"}`
      : undefined,
  };

  // Initialize reconcile_events array if needed
  if (!transcript.reconcile_events) {
    transcript.reconcile_events = [];
  }
  transcript.reconcile_events.push(reconcileEvent);

  // Update settlement_lifecycle status
  if (!transcript.settlement_lifecycle) {
    transcript.settlement_lifecycle = {};
  }
  transcript.settlement_lifecycle.status = newStatus;

  // Update lifecycle fields based on new status
  if (newStatus === "committed") {
    transcript.settlement_lifecycle.committed_at_ms = timestamp;
    if (pollResult.paid_amount !== undefined) {
      transcript.settlement_lifecycle.paid_amount = pollResult.paid_amount;
    }
  } else if (newStatus === "failed") {
    if (pollResult.failure_code) {
      transcript.settlement_lifecycle.failure_code = pollResult.failure_code;
    }
    if (pollResult.failure_reason) {
      transcript.settlement_lifecycle.failure_reason = pollResult.failure_reason;
    }
  }

  // Write updated transcript to file
  let updatedPath: string | undefined;
  if (transcriptPath) {
    try {
      // Generate filename with "-reconciled-<short>.json" suffix
      const dir = path.dirname(transcriptPath);
      const basename = path.basename(transcriptPath, path.extname(transcriptPath));
      const shortHash = generateShortHash(`${handleId}-${timestamp}`);
      const newFilename = `${basename}-reconciled-${shortHash}.json`;
      updatedPath = path.join(dir, newFilename);

      // Write pretty JSON
      fs.writeFileSync(updatedPath, JSON.stringify(transcript, null, 2), "utf-8");
    } catch (error: any) {
      return {
        ok: false,
        status: "FAILED",
        reason: `Failed to write updated transcript: ${error.message}`,
        reconciledHandles: [],
      };
    }
  }

  return {
    ok: true,
    status: "UPDATED",
    updatedTranscriptPath: updatedPath,
    reconciledHandles: [
      {
        handle_id: handleId,
        status: newStatus,
      },
    ],
  };
}

