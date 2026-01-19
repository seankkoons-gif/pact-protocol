/**
 * Failure Event v4 Types
 */

export type FailureEvent = {
  code: string;
  stage: string;
  fault_domain: string;
  terminality: "terminal" | "non_terminal" | "ABORT" | "NEEDS_ARBITRATION";
  evidence_refs: string[];
  timestamp: number;
  transcript_hash: string;
};
