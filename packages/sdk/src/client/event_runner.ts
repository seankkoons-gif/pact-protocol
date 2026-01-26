/**
 * Central EventRunner for acquire() phase/event pipeline
 *
 * Provides centralized event emission, retry logic, idempotency checks,
 * and failure mapping while maintaining transcript ordering.
 *
 * Mapping surface: mapError, isRetryable, mapErrorToFailureTaxonomy are
 * owned by EventRunner only. Acquire uses eventRunner.mapError / .isRetryable
 * / .mapErrorToFailureTaxonomy and must not import those helpers directly.
 */

import type {
  AcquisitionEvent,
  AcquisitionPhase,
  EventContext,
  EventEvidence,
  EventHandler,
  FailureEvent,
  ProgressEvent,
  SuccessEvent,
} from "./events";

/** Logger abstraction for EventRunner (e.g. transcript save failures, handler errors). */
export interface EventRunnerLogger {
  error(message: string, err?: unknown): void;
}

const defaultLogger: EventRunnerLogger = {
  error(message: string, err?: unknown) {
    console.error(message, err);
  },
};

/**
 * EventRunner manages event emission, retry logic, and idempotency
 */
export class EventRunner {
  private context: EventContext;
  private idempotencyStore: Map<string, AcquisitionEvent> = new Map();
  private idempotencyKeyStore: Map<string, AcquisitionEvent> = new Map(); // Custom idempotency keys
  private logger: EventRunnerLogger;

  constructor(intentId: string, startMs: number, opts?: { logger?: EventRunnerLogger }) {
    this.logger = opts?.logger ?? defaultLogger;
    this.context = {
      intent_id: intentId,
      start_ms: startMs,
      sequence: 0,
      handlers: [],
      evidence: [],
      history: [],
    };
  }

  /** Log an error via the logger abstraction (e.g. "Failed to save PACT-330 v4 transcript"). */
  logError(message: string, err?: unknown): void {
    this.logger.error(message, err);
  }

  /** Map raw errors to failure codes. Use this instead of importing mapErrorToFailureCode. */
  mapError(error: unknown, context?: { phase?: AcquisitionPhase; operation?: string; errorMessage?: string }) {
    return mapErrorToFailureCode(error, context);
  }

  /** Check if a failure code is retryable. Use this instead of importing isRetryableFailureCode. */
  isRetryable(failure_code: string): boolean {
    return isRetryableFailureCode(failure_code);
  }

  /** Map errors to failure taxonomy (code, stage, fault_domain, terminality). Use this instead of importing mapErrorToFailureTaxonomy. */
  mapErrorToFailureTaxonomy(
    error: unknown,
    stage: AcquisitionPhase,
    context?: {
      phase?: AcquisitionPhase;
      operation?: string;
      errorMessage?: string;
      evidence_refs?: string[];
      intent_fingerprint?: string;
      prior_transcript_id?: string;
      contention_fingerprint?: string;
      selected_provider_id?: string;
      attempted_provider_id?: string;
    }
  ) {
    return mapErrorToFailureTaxonomy(error, stage, context);
  }

  /**
   * Register an event handler
   */
  on(handler: EventHandler): void {
    this.context.handlers.push(handler);
  }

  /**
   * Emit an event (centralized emission point)
   * 
   * Event IDs are deterministic: same intent_id + sequence = same event_id
   * This ensures idempotency: same input → same event IDs
   * 
   * @param event Event to emit (without event_id, sequence, and intent_id - these are added automatically)
   * @param idempotencyKey Optional custom idempotency key (e.g., settlement.idempotency_key)
   */
  async emitEvent(
    event: Omit<SuccessEvent, "event_id" | "sequence" | "intent_id"> | Omit<FailureEvent, "event_id" | "sequence" | "intent_id"> | Omit<ProgressEvent, "event_id" | "sequence" | "intent_id">,
    idempotencyKey?: string
  ): Promise<AcquisitionEvent> {
    const sequence = this.context.sequence++;
    // Event ID is deterministic: intent_id + sequence number
    // Same input (intent_id + phase order) → same event IDs
    const event_id = `${this.context.intent_id}-${sequence}`;

    const fullEvent: AcquisitionEvent = {
      ...event,
      event_id,
      sequence,
      timestamp_ms: event.timestamp_ms,
      intent_id: this.context.intent_id,
    };

    // Check idempotency by custom key first (if provided)
    if (idempotencyKey) {
      if (this.idempotencyKeyStore.has(idempotencyKey)) {
        return this.idempotencyKeyStore.get(idempotencyKey)!;
      }
      // Store for custom idempotency key
      this.idempotencyKeyStore.set(idempotencyKey, fullEvent);
    }

    // Check idempotency by event_id (if event_id already processed, return stored result)
    if (this.idempotencyStore.has(event_id)) {
      return this.idempotencyStore.get(event_id)!;
    }

    // Store event for idempotency
    this.idempotencyStore.set(event_id, fullEvent);

    // Add to history
    this.context.history.push(fullEvent);

    // Attach evidence if provided
    if (event.evidence) {
      this.context.evidence.push(...event.evidence);
    }

    // Call all registered handlers
    for (const handler of this.context.handlers) {
      try {
        await handler(fullEvent);
      } catch (error) {
        // Handler errors should not break the pipeline
        // Log but continue
        this.logError(`Event handler error for ${event_id}:`, error);
      }
    }

    return fullEvent;
  }

  /**
   * Emit a success event
   * 
   * @param idempotencyKey Optional custom idempotency key
   */
  async emitSuccess(
    phase: AcquisitionPhase,
    result: Record<string, unknown>,
    evidence?: EventEvidence[],
    idempotencyKey?: string
  ): Promise<SuccessEvent> {
    const now = Date.now();
    return (await this.emitEvent({
      type: "success",
      phase,
      timestamp_ms: now,
      result,
      evidence,
    }, idempotencyKey)) as SuccessEvent;
  }

  /**
   * Emit a failure event
   * 
   * @param idempotencyKey Optional custom idempotency key
   */
  async emitFailure(
    phase: AcquisitionPhase,
    failure_code: string,
    failure_reason: string,
    retryable: boolean,
    metadata?: Record<string, unknown>,
    evidence?: EventEvidence[],
    idempotencyKey?: string
  ): Promise<FailureEvent> {
    const now = Date.now();
    return (await this.emitEvent({
      type: "failure",
      phase,
      timestamp_ms: now,
      failure_code,
      failure_reason,
      retryable,
      metadata,
      evidence,
    }, idempotencyKey)) as FailureEvent;
  }

  /**
   * Emit a progress event
   * 
   * @param idempotencyKey Optional custom idempotency key
   */
  async emitProgress(
    phase: AcquisitionPhase,
    progress: number,
    message: string,
    checkpoint?: Record<string, unknown>,
    evidence?: EventEvidence[],
    idempotencyKey?: string
  ): Promise<ProgressEvent> {
    const now = Date.now();
    return (await this.emitEvent({
      type: "progress",
      phase,
      timestamp_ms: now,
      progress,
      message,
      checkpoint,
      evidence,
    }, idempotencyKey)) as ProgressEvent;
  }

  /**
   * Get current context
   */
  getContext(): Readonly<EventContext> {
    return { ...this.context };
  }

  /**
   * Get evidence collected so far
   */
  getEvidence(): Readonly<EventEvidence[]> {
    return [...this.context.evidence];
  }

  /**
   * Get event history
   */
  getHistory(): Readonly<AcquisitionEvent[]> {
    return [...this.context.history];
  }

  /**
   * Check if an event ID has been processed (idempotency check)
   */
  isProcessed(eventId: string): boolean {
    return this.idempotencyStore.has(eventId);
  }

  /**
   * Get processed event by ID (for idempotency)
   */
  getProcessedEvent(eventId: string): AcquisitionEvent | undefined {
    return this.idempotencyStore.get(eventId);
  }

  /**
   * Check if a custom idempotency key has been processed
   */
  isProcessedByKey(idempotencyKey: string): boolean {
    return this.idempotencyKeyStore.has(idempotencyKey);
  }

  /**
   * Get processed event by custom idempotency key
   */
  getProcessedEventByKey(idempotencyKey: string): AcquisitionEvent | undefined {
    return this.idempotencyKeyStore.get(idempotencyKey);
  }

  /**
   * Centralized retry decision for attempt failures
   * 
   * This is the single place that decides whether a failure should trigger a retry
   * (continue to next candidate) or terminate (return error).
   * 
   * @param failureCode Failure code from the attempt
   * @param failureReason Human-readable failure reason
   * @param attemptEntry Attempt entry to record failure in
   * @param settlementAttempts Array to push attempt entry to
   * @param transcriptData Optional transcript data to update
   * @param nowFunction Function to get current timestamp
   * @returns "continue" if retryable (try next candidate), "return" if non-retryable (terminate)
   */
  shouldRetryAfterFailure(
    failureCode: string,
    failureReason: string,
    attemptEntry: { idx: number; provider_pubkey: string; provider_id?: string; settlement_provider?: string; outcome: "success" | "failed"; failure_code?: string; failure_reason?: string; timestamp_ms?: number },
    settlementAttempts: Array<typeof attemptEntry>,
    transcriptData?: { settlement_attempts?: any[] } | null,
    nowFunction?: () => number
  ): "continue" | "return" {
    // Record attempt failure
    attemptEntry.outcome = "failed";
    attemptEntry.failure_code = failureCode;
    attemptEntry.failure_reason = failureReason;
    attemptEntry.timestamp_ms = nowFunction ? nowFunction() : Date.now();
    settlementAttempts.push(attemptEntry);
    
    // Check if retryable (centralized retry policy)
    if (!isRetryableFailureCode(failureCode)) {
      // Non-retryable failure - stop and return
      if (transcriptData) {
        transcriptData.settlement_attempts = settlementAttempts as any[];
      }
      return "return";
    }
    
    // Retryable failure - continue to next candidate
    return "continue";
  }
}

/**
 * Failure mapping: determines if a failure code is retryable
 * This centralizes the retry logic previously scattered in acquire()
 * Internal only. Use eventRunner.isRetryable() from acquire.
 */
function isRetryableFailureCode(failure_code: string): boolean {
  // Non-retryable failures (policy, protocol, identity issues)
  const nonRetryable = [
    "INVALID_POLICY",
    "ZK_KYA_REQUIRED",
    "ZK_KYA_EXPIRED",
    "ZK_KYA_INVALID",
    "ZK_KYA_ISSUER_NOT_ALLOWED",
    "ZK_KYA_TIER_TOO_LOW",
    "NO_PROVIDERS",
    "NO_ELIGIBLE_PROVIDERS",
    "PROVIDER_MISSING_REQUIRED_CREDENTIALS",
    "PROVIDER_UNTRUSTED_ISSUER",
    "PROVIDER_TRUST_TIER_TOO_LOW",
    "PROVIDER_TRUST_SCORE_TOO_LOW",
    "PROVIDER_CREDENTIAL_REQUIRED",
    "PROVIDER_QUOTE_POLICY_REJECTED",
    "PROVIDER_QUOTE_OUT_OF_BAND",
    "NEGOTIATION_FAILED",
    "NO_AGREEMENT",
    "FAILED_PROOF",
    "NO_RECEIPT",
    "WALLET_PROOF_FAILED",
    "REFUND_INSUFFICIENT_FUNDS", // Non-retryable (seller has no funds)
  ];

  if (nonRetryable.includes(failure_code)) {
    return false;
  }

  // Retryable failures (settlement, network, provider-specific issues)
  const retryable = [
    "SETTLEMENT_FAILED",
    "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
    "HTTP_PROVIDER_ERROR",
    "HTTP_STREAMING_ERROR",
    "PROVIDER_QUOTE_HTTP_ERROR",
    "PROVIDER_SIGNATURE_INVALID",
    "PROVIDER_SIGNER_MISMATCH",
    "INVALID_MESSAGE_TYPE",
    "SETTLEMENT_POLL_TIMEOUT",
    "STREAMING_NOT_CONFIGURED",
  ];

  if (retryable.includes(failure_code)) {
    return true;
  }

  // Default: treat unknown failures as retryable (conservative)
  return true;
}

/**
 * Map raw errors to failure codes (centralized error taxonomy)
 *
 * This is the single source of truth for error-to-failure-code mapping.
 * Internal only. Use eventRunner.mapError() from acquire.
 */
function mapErrorToFailureCode(error: unknown, context?: {
  phase?: AcquisitionPhase;
  operation?: string;
  errorMessage?: string;
}): { code: string; reason: string; retryable: boolean } {
  const errorMsg = error instanceof Error 
    ? error.message 
    : typeof error === "string" 
    ? error 
    : context?.errorMessage || String(error);
  
  const lowerMsg = errorMsg.toLowerCase();
  
  // Settlement provider errors
  if (lowerMsg.includes("notimplemented") || lowerMsg.includes("externalsettlementprovider")) {
    return {
      code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
      reason: `Settlement operation failed: ${errorMsg}`,
      retryable: isRetryableFailureCode("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED"),
    };
  }
  
  // HTTP errors
  if (lowerMsg.includes("404") || lowerMsg.includes("not found")) {
    return {
      code: "HTTP_PROVIDER_ERROR",
      reason: `HTTP error: ${errorMsg}`,
      retryable: isRetryableFailureCode("HTTP_PROVIDER_ERROR"),
    };
  }
  
  // Refund errors (check exact match first)
  if (lowerMsg.includes("refund_insufficient_funds") || errorMsg.includes("REFUND_INSUFFICIENT_FUNDS")) {
    return {
      code: "REFUND_INSUFFICIENT_FUNDS",
      reason: errorMsg,
      retryable: false, // Non-retryable (seller has no funds)
    };
  }
  
  // Network/timeout errors (retryable)
  if (lowerMsg.includes("timeout") || lowerMsg.includes("network") || lowerMsg.includes("econnrefused")) {
    return {
      code: "HTTP_PROVIDER_ERROR",
      reason: `Network error: ${errorMsg}`,
      retryable: true,
    };
  }
  
  // Parse errors (retryable - might be transient)
  if (lowerMsg.includes("parse") || lowerMsg.includes("json") || lowerMsg.includes("syntax")) {
    return {
      code: "HTTP_PROVIDER_ERROR",
      reason: `Parse error: ${errorMsg}`,
      retryable: true,
    };
  }
  
  // Streaming-specific errors
  if (errorMsg === "STREAMING_NOT_CONFIGURED" || lowerMsg.includes("streaming_not_configured")) {
    return {
      code: "STREAMING_NOT_CONFIGURED",
      reason: errorMsg,
      retryable: isRetryableFailureCode("STREAMING_NOT_CONFIGURED"),
    };
  }
  
  // Provider signature errors
  if (lowerMsg.includes("provider_signature_invalid") || lowerMsg.includes("invalid.*signature")) {
    return {
      code: "PROVIDER_SIGNATURE_INVALID",
      reason: errorMsg,
      retryable: isRetryableFailureCode("PROVIDER_SIGNATURE_INVALID"),
    };
  }
  
  // Provider signer mismatch
  if (lowerMsg.includes("signer.*match") || lowerMsg.includes("signer.*mismatch") || lowerMsg.includes("provider_signer_mismatch")) {
    return {
      code: "PROVIDER_SIGNER_MISMATCH",
      reason: errorMsg,
      retryable: isRetryableFailureCode("PROVIDER_SIGNER_MISMATCH"),
    };
  }
  
  // Invalid message type
  if (lowerMsg.includes("invalid.*message.*type") || lowerMsg.includes("invalid_message_type")) {
    return {
      code: "INVALID_MESSAGE_TYPE",
      reason: errorMsg,
      retryable: isRetryableFailureCode("INVALID_MESSAGE_TYPE"),
    };
  }
  
  // Settlement poll timeout
  if (lowerMsg.includes("settlement_poll_timeout") || lowerMsg.includes("poll.*timeout")) {
    return {
      code: "SETTLEMENT_POLL_TIMEOUT",
      reason: errorMsg,
      retryable: isRetryableFailureCode("SETTLEMENT_POLL_TIMEOUT"),
    };
  }
  
  // Settlement failed (COMMIT/REVEAL failures)
  if (lowerMsg.includes("settlement_failed") || lowerMsg.includes("commit failed") || lowerMsg.includes("reveal failed")) {
    return {
      code: "SETTLEMENT_FAILED",
      reason: errorMsg,
      retryable: isRetryableFailureCode("SETTLEMENT_FAILED"),
    };
  }
  
  // HTTP streaming errors
  if (lowerMsg.includes("http_streaming_error") || (lowerMsg.includes("streaming") && lowerMsg.includes("error"))) {
    return {
      code: "HTTP_STREAMING_ERROR",
      reason: errorMsg,
      retryable: isRetryableFailureCode("HTTP_STREAMING_ERROR"),
    };
  }
  
  // Default: map to generic error based on phase
  const defaultCode = context?.phase === "settlement_prepare" || context?.phase === "settlement_commit" || context?.phase === "settlement_streaming"
    ? "SETTLEMENT_FAILED"
    : context?.phase === "quote_fetch" || context?.phase === "provider_evaluation"
    ? "PROVIDER_QUOTE_HTTP_ERROR"
    : "HTTP_PROVIDER_ERROR";
  
  return {
    code: defaultCode,
    reason: errorMsg,
    retryable: isRetryableFailureCode(defaultCode),
  };
}

/**
 * Map error to full failure taxonomy structure
 * 
 * This is the single source of truth for error-to-failure-taxonomy mapping.
 * Returns complete taxonomy including code, stage, fault_domain, terminality, and evidence_refs.
 * Internal only. Use eventRunner.mapErrorToFailureTaxonomy() from acquire.
 */
function mapErrorToFailureTaxonomy(
  error: unknown,
  stage: AcquisitionPhase,
  context?: {
    phase?: AcquisitionPhase;
    operation?: string;
    errorMessage?: string;
    evidence_refs?: string[];
    intent_fingerprint?: string;
    prior_transcript_id?: string;
    contention_fingerprint?: string;
    selected_provider_id?: string;
    attempted_provider_id?: string;
  }
): {
  code: string;
  stage: string;
  fault_domain: string;
  terminality: "terminal" | "non_terminal";
  evidence_refs: string[];
} {
  const errorMsg = error instanceof Error 
    ? error.message 
    : typeof error === "string" 
    ? error 
    : context?.errorMessage || String(error);
  
  const lowerMsg = errorMsg.toLowerCase();
  
  // Check for PACT-330 (Contention exclusivity violation)
  if (errorMsg.includes("PACT-330") || errorMsg.includes("Contention exclusivity violated")) {
    const evidenceRefs: string[] = context?.evidence_refs || [];
    if (context?.contention_fingerprint) {
      evidenceRefs.push(`contention_fingerprint:${context.contention_fingerprint}`);
    }
    if (context?.selected_provider_id && context?.attempted_provider_id) {
      evidenceRefs.push(`selected_provider:${context.selected_provider_id}`);
      evidenceRefs.push(`attempted_provider:${context.attempted_provider_id}`);
    }
    
    return {
      code: "PACT-330",
      stage: "settlement",
      fault_domain: "provider",
      terminality: "terminal",
      evidence_refs: evidenceRefs,
    };
  }
  
  // Check for PACT-331 (Double commit detection)
  if (errorMsg.includes("PACT-331") || errorMsg.includes("Double commit detected")) {
    const evidenceRefs: string[] = context?.evidence_refs || [];
    if (context?.intent_fingerprint) {
      evidenceRefs.push(`intent_fingerprint:${context.intent_fingerprint}`);
    }
    if (context?.prior_transcript_id) {
      evidenceRefs.push(`prior_transcript_id:${context.prior_transcript_id}`);
    }
    
    return {
      code: "PACT-331",
      stage: "settlement",
      fault_domain: "buyer",
      terminality: "terminal",
      evidence_refs: evidenceRefs,
    };
  }
  
  // Map other errors using existing mapErrorToFailureCode
  const { code, retryable } = mapErrorToFailureCode(error, {
    phase: context?.phase || stage,
    operation: context?.operation,
    errorMessage: errorMsg,
  });
  
  // Determine fault domain based on error code
  let fault_domain = "unknown";
  if (code.startsWith("PROVIDER_") || code === "HTTP_PROVIDER_ERROR" || code === "HTTP_STREAMING_ERROR") {
    fault_domain = "provider";
  } else if (code.startsWith("SETTLEMENT_") || code === "SETTLEMENT_FAILED") {
    fault_domain = "settlement";
  } else if (code === "INVALID_POLICY" || code === "NO_PROVIDERS" || code === "NO_ELIGIBLE_PROVIDERS") {
    fault_domain = "buyer";
  } else if (code.includes("KYA") || code.includes("CREDENTIAL") || code.includes("TRUST")) {
    fault_domain = "identity";
  } else {
    fault_domain = "system";
  }
  
  // Determine terminality: non-retryable = terminal, retryable = non_terminal
  const terminality: "terminal" | "non_terminal" = retryable ? "non_terminal" : "terminal";
  
  // Build evidence_refs from context
  const evidence_refs: string[] = context?.evidence_refs || [];
  if (errorMsg && !evidence_refs.some(ref => ref.includes(errorMsg.substring(0, 50)))) {
    evidence_refs.push(`error:${errorMsg.substring(0, 200)}`);
  }
  
  return {
    code,
    stage,
    fault_domain,
    terminality,
    evidence_refs,
  };
}

/**
 * Create evidence from phase and data
 */
export function createEvidence(
  phase: AcquisitionPhase,
  evidence_type: string,
  data: Record<string, unknown>,
  timestamp_ms?: number
): EventEvidence {
  return {
    phase,
    timestamp_ms: timestamp_ms ?? Date.now(),
    evidence_type,
    data,
  };
}
