/**
 * Event/Evidence interface for acquire() phase/event pipeline
 * 
 * This module defines the event-driven architecture for the acquire() function,
 * enabling semantic-preserving refactoring with centralized retry, idempotency,
 * and failure mapping while preserving atomic commit gates and transcript ordering.
 */

/**
 * Event phase identifiers for the acquisition lifecycle
 */
export type AcquisitionPhase =
  | "policy_validation"
  | "provider_discovery"
  | "provider_evaluation"
  | "credential_verification"
  | "quote_fetch"
  | "negotiation"
  | "settlement_prepare"
  | "settlement_commit"
  | "settlement_reveal"
  | "settlement_streaming"
  | "settlement_complete"
  | "reconciliation"
  | "disputes_open"
  | "disputes_evidence"
  | "disputes_arbiter"
  | "disputes_remedy"
  | "transcript_commit";

/**
 * Evidence attached to events for auditability and debugging
 */
export interface EventEvidence {
  /** Phase where evidence was collected */
  phase: AcquisitionPhase;
  /** Timestamp (ms) when evidence was collected */
  timestamp_ms: number;
  /** Evidence type identifier */
  evidence_type: string;
  /** Evidence data (opaque, but should be serializable) */
  data: Record<string, unknown>;
  /** Optional hash for evidence integrity verification */
  hash?: string;
}

/**
 * Base event structure
 */
export interface BaseEvent {
  /** Unique event ID (for idempotency and ordering) */
  event_id: string;
  /** Phase when event occurred */
  phase: AcquisitionPhase;
  /** Timestamp (ms) when event was emitted */
  timestamp_ms: number;
  /** Intent ID this event belongs to */
  intent_id: string;
  /** Optional evidence attached to this event */
  evidence?: EventEvidence[];
  /** Sequence number for ordering (monotonic within intent_id) */
  sequence: number;
}

/**
 * Success event (phase completed successfully)
 */
export interface SuccessEvent extends BaseEvent {
  type: "success";
  /** Result data from the phase */
  result: Record<string, unknown>;
}

/**
 * Failure event (phase failed, may be retryable)
 */
export interface FailureEvent extends BaseEvent {
  type: "failure";
  /** Failure code (e.g., "SETTLEMENT_FAILED", "PROVIDER_QUOTE_HTTP_ERROR") */
  failure_code: string;
  /** Human-readable failure reason */
  failure_reason: string;
  /** Whether this failure is retryable */
  retryable: boolean;
  /** Optional metadata for failure */
  metadata?: Record<string, unknown>;
}

/**
 * Progress event (phase in progress, checkpoint for resumability)
 */
export interface ProgressEvent extends BaseEvent {
  type: "progress";
  /** Progress indicator (0.0 to 1.0) */
  progress: number;
  /** Status message */
  message: string;
  /** Optional checkpoint data for resumability */
  checkpoint?: Record<string, unknown>;
}

/**
 * Union type of all event types
 */
export type AcquisitionEvent = SuccessEvent | FailureEvent | ProgressEvent;

/**
 * Event handler function type
 */
export type EventHandler = (event: AcquisitionEvent) => void | Promise<void>;

/**
 * Event context for pipeline execution
 */
export interface EventContext {
  /** Intent ID for this acquisition */
  intent_id: string;
  /** Start timestamp */
  start_ms: number;
  /** Current sequence number (monotonic) */
  sequence: number;
  /** Registered event handlers */
  handlers: EventHandler[];
  /** Evidence accumulator */
  evidence: EventEvidence[];
  /** Event history (for replay/debugging) */
  history: AcquisitionEvent[];
}
