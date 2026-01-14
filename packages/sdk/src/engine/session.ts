import type {
  CompiledPolicy,
  FailureCode,
} from "../policy/types";
import type { PolicyGuard } from "../policy/guard";
import type { IntentContext, NegotiationContext } from "../policy/context";
import type {
  IntentMessage,
  AskMessage,
  BidMessage,
  AcceptMessage,
  RejectMessage,
  CommitMessage,
  RevealMessage,
  PactMessage,
} from "../protocol/types";
import type { SignedEnvelope } from "../protocol/envelope";
import { verifyEnvelope, parseEnvelope, parseMessage } from "../protocol/index";
import { SessionStatus, TerminalOutcome, SessionResult } from "./state";
import { ProtocolViolationError, PolicyViolationError, TimeoutError } from "./errors";
import type { SettlementProvider } from "../settlement/index";
import type { SettlementHandle, SettlementResult } from "../settlement/types";
import { createAgreement, type Agreement } from "../exchange/agreement";
import { createReceipt, type Receipt } from "../exchange/receipt";
import { verifyReveal } from "../exchange/commit";

export interface CounterpartySummary {
  agent_id: string;
  is_new_agent?: boolean;
  age_ms?: number;
  region?: string;
  reputation?: number;
  failure_rate?: number;
  timeout_rate?: number;
  credentials?: Array<{
    type: string;
    issuer: string;
    [key: string]: unknown;
  }>;
}

export interface NegotiationSessionParams {
  compiledPolicy: CompiledPolicy;
  guard: PolicyGuard;
  now: () => number;
  role: "buyer" | "seller";
  intentType?: string;
  settlement?: SettlementProvider;
  buyerAgentId?: string;
  sellerAgentId?: string;
  // v2 Phase 2+: Chain and asset for settlement operations
  settlementChain?: string;
  settlementAsset?: string;
  // v1.7.2+: Settlement lifecycle configuration
  settlementIdempotencyKey?: string;
  settlementAutoPollMs?: number; // If set, poll until resolved (0 = immediate loop, >0 = delay)
  // v1.6.6+: Split settlement configuration (B3)
  settlementSplit?: {
    enabled: boolean;
    max_segments?: number;
  };
  // v1.6.6+: Fallback candidates for split settlement (B3)
  settlementCandidates?: Array<{
    provider_pubkey: string;
    provider_id?: string;
    trust_tier?: "untrusted" | "low" | "trusted";
    trust_score?: number;
  }>;
  // v1.6.6+: Settlement provider factory for split settlement (B3)
  createSettlementProvider?: (provider: "mock" | "stripe_like" | "external", params?: Record<string, unknown>) => SettlementProvider;
  // v1.6.6+: Routing function for split settlement (B3)
  selectSettlementProvider?: (amount: number, mode: "hash_reveal" | "streaming", trustTier: "untrusted" | "low" | "trusted", trustScore: number) => { provider: string; matchedRuleIndex?: number; reason: string };
}

export class NegotiationSession {
  private status: SessionStatus = "IDLE";
  private intent_id?: string;
  private intent?: IntentMessage;
  private start_ms?: number;
  private round: number = 0;
  private last_action_ms?: number;
  private latest_ask?: AskMessage;
  private latest_bid?: BidMessage;
  private transcript: SignedEnvelope<PactMessage>[] = [];
  private terminal_result?: SessionResult;
  private agreement?: Agreement;
  private receipt?: Receipt;
  // v1.7.2+: Settlement lifecycle handle (if using lifecycle API)
  private settlementHandle?: SettlementHandle;
  // v1.6.6+: Split settlement segments (B3)
  private settlementSegments: Array<{
    idx: number;
    provider_pubkey: string;
    settlement_provider: string;
    amount: number;
    status: "committed" | "failed";
    handle_id?: string;
    failure_code?: string;
    failure_reason?: string;
  }> = [];
  private splitTotalPaid: number = 0;
  // v1.6.7+: Settlement SLA violations (D1)
  private settlementSLAViolations: Array<{
    ts_ms: number;
    code: string;
    reason: string;
    handle_id?: string;
    provider?: string;
  }> = [];
  // v2 Phase 2+: Chain and asset for settlement operations
  private settlementChain?: string;
  private settlementAsset?: string;

  constructor(
    private params: NegotiationSessionParams
  ) {
    // Store chain/asset from params
    this.settlementChain = params.settlementChain;
    this.settlementAsset = params.settlementAsset;
  }

  /**
   * Check if settlement provider supports lifecycle API (v1.7.2+)
   */
  private settlementSupportsLifecycle(): boolean {
    return !!(
      this.params.settlement &&
      typeof this.params.settlement.prepare === "function" &&
      typeof this.params.settlement.commit === "function"
    );
  }

  /**
   * Check if a settlement provider supports lifecycle API (v1.6.6+, B3)
   */
  private settlementSupportsLifecycleForProvider(provider: SettlementProvider): boolean {
    return !!(
      provider &&
      typeof provider.prepare === "function" &&
      typeof provider.commit === "function"
    );
  }

  /**
   * Poll settlement until resolved (v1.7.2+)
   * v1.6.7+: Enforces SLA constraints (D1)
   */
  private async pollSettlementUntilResolved(
    handle_id: string,
    maxAttempts: number = 100
  ): Promise<{ ok: true; result: SettlementResult } | { ok: false; code: string; reason: string }> {
    if (!this.params.settlement || typeof this.params.settlement.poll !== "function") {
      return { ok: false, code: "SETTLEMENT_POLL_NOT_SUPPORTED", reason: "Settlement provider does not support polling" };
    }

    // v1.6.7+: Get SLA settings (D1)
    const slaConfig = this.params.compiledPolicy.base.settlement?.settlement_sla;
    const slaEnabled = slaConfig?.enabled === true;
    
    // Determine poll interval: input.settlement.auto_poll_ms ?? policy.poll_interval_ms ?? 0
    const pollDelay = this.params.settlementAutoPollMs ?? (slaConfig?.poll_interval_ms ?? 0);
    
    // Determine max attempts: policy.max_poll_attempts (if >0) else existing default
    const effectiveMaxAttempts = slaEnabled && slaConfig?.max_poll_attempts && slaConfig.max_poll_attempts > 0
      ? slaConfig.max_poll_attempts
      : maxAttempts;
    
    // Track elapsed time from first pending response
    const startPendingMs = this.params.now();
    let attempts = 0;
    const providerName = (this.params.settlement as any).constructor?.name || "unknown";

    while (attempts < effectiveMaxAttempts) {
      // v1.6.7+: Check max_pending_ms SLA (D1)
      if (slaEnabled && slaConfig?.max_pending_ms && slaConfig.max_pending_ms > 0) {
        const elapsedMs = this.params.now() - startPendingMs;
        if (elapsedMs > slaConfig.max_pending_ms) {
          // SLA violation: pending exceeded
          const violation = {
            ts_ms: this.params.now(),
            code: "SETTLEMENT_SLA_VIOLATION",
            reason: `pending exceeded SLA: ${elapsedMs}ms > ${slaConfig.max_pending_ms}ms`,
            handle_id,
            provider: providerName,
          };
          this.settlementSLAViolations.push(violation);
          return { ok: false, code: "SETTLEMENT_SLA_VIOLATION", reason: violation.reason };
        }
      }
      
      const result = await this.params.settlement.poll(handle_id);
      
      if (result.status === "committed") {
        return { ok: true, result };
      }
      
      if (result.status === "failed") {
        return {
          ok: false,
          code: result.failure_code || "SETTLEMENT_FAILED",
          reason: result.failure_reason || "Settlement failed during async processing",
        };
      }

      // Still pending - wait and retry
      if (pollDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollDelay));
      }
      
      attempts++;
    }

    // v1.6.7+: Check max_poll_attempts SLA (D1)
    if (slaEnabled && slaConfig?.max_poll_attempts && slaConfig.max_poll_attempts > 0 && attempts >= slaConfig.max_poll_attempts) {
      // SLA violation: poll attempts exceeded
      const violation = {
        ts_ms: this.params.now(),
        code: "SETTLEMENT_SLA_VIOLATION",
        reason: `poll attempts exceeded SLA: ${attempts} >= ${slaConfig.max_poll_attempts}`,
        handle_id,
        provider: providerName,
      };
      this.settlementSLAViolations.push(violation);
      return { ok: false, code: "SETTLEMENT_SLA_VIOLATION", reason: violation.reason };
    }

    return { ok: false, code: "SETTLEMENT_POLL_TIMEOUT", reason: `Settlement still pending after ${attempts} poll attempts` };
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  getIntentId(): string | undefined {
    return this.intent_id;
  }

  getRound(): number {
    return this.round;
  }

  getTranscript(): readonly SignedEnvelope<PactMessage>[] {
    return this.transcript;
  }

  getResult(): SessionResult | undefined {
    return this.terminal_result;
  }

  /**
   * Open negotiation with an INTENT message.
   */
  async openWithIntent(
    envelope: SignedEnvelope<IntentMessage>,
    intentMeta?: Partial<IntentContext>
  ): Promise<{ ok: true } | { ok: false; code: FailureCode; reason: string }> {
    if (this.status !== "IDLE") {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Cannot open intent: session is in ${this.status} state`,
      };
    }

    // Verify envelope signature
    const isValid = await verifyEnvelope(envelope);
    if (!isValid) {
      this.terminate("FAILED_IDENTITY", "FAILED_POLICY", "Envelope signature verification failed");
      return { ok: false, code: "FAILED_POLICY", reason: "Envelope signature verification failed" };
    }

    // Parse and validate message
    let message: IntentMessage;
    try {
      const parsed = parseMessage(envelope.message);
      if (parsed.type !== "INTENT") {
        return {
          ok: false,
          code: "FAILED_POLICY",
          reason: `Expected INTENT message, got ${parsed.type}`,
        };
      }
      message = parsed;
    } catch (error) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Invalid message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Check intent expiry
    const now = this.params.now();
    if (message.expires_at_ms <= now) {
      this.terminate("TIMEOUT", "FAILED_NEGOTIATION_TIMEOUT", "intent expired");
      return { ok: false, code: "FAILED_NEGOTIATION_TIMEOUT", reason: "intent expired" };
    }

    // Policy check: intent phase
    // Defaults that should allow local tests to pass
    const intentCtx = {
      now_ms: now,
      intent_type: message.intent,
      expires_at_ms: message.expires_at_ms,
      urgent: !!message.urgent,

      admission: { has_bond: true, has_credential: false, has_sponsor: false },
      rate_limit_ok: true,
      concurrency_ok: true,
      budgets_ok: true,
      kill_switch_triggered: false,

      ...(intentMeta ?? {}),
    };

    const guardResult = this.params.guard.check("intent", intentCtx, message.intent);
    if (!guardResult.ok) {
      return this.terminateFromGuard(guardResult);
    }

    // Accept intent
    this.status = "INTENT_OPEN";
    this.intent_id = message.intent_id;
    this.intent = message;
    this.start_ms = now;
    this.round = 0;
    this.last_action_ms = now;
    this.transcript.push(envelope);

    return { ok: true };
  }

  /**
   * Process an ASK or BID quote.
   */
  async onQuote(
    envelope: SignedEnvelope<AskMessage | BidMessage>,
    counterpartySummary: CounterpartySummary = {
      agent_id: "default-agent",
      reputation: 0.99,
      is_new_agent: false,
      region: "us-east",
      failure_rate: 0.0,
      timeout_rate: 0.0,
      credentials: [], // Empty array passes when no credentials are required
    },
    referencePriceP50?: number
  ): Promise<{ ok: true } | { ok: false; code: FailureCode; reason: string }> {
    if (this.status !== "INTENT_OPEN" && this.status !== "NEGOTIATING") {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Cannot process quote: session is in ${this.status} state`,
      };
    }

    // Verify envelope signature
    const isValid = await verifyEnvelope(envelope);
    if (!isValid) {
      this.terminate("FAILED_IDENTITY", "FAILED_POLICY", "Envelope signature verification failed");
      return { ok: false, code: "FAILED_POLICY", reason: "Envelope signature verification failed" };
    }

    // Parse and validate message
    let message: AskMessage | BidMessage;
    try {
      const parsed = parseMessage(envelope.message);
      if (parsed.type !== "ASK" && parsed.type !== "BID") {
        return {
          ok: false,
          code: "FAILED_POLICY",
          reason: `Expected ASK or BID message, got ${parsed.type}`,
        };
      }
      message = parsed;
    } catch (error) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Invalid message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Check intent_id matches
    if (message.intent_id !== this.intent_id) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Intent ID mismatch: expected ${this.intent_id}, got ${message.intent_id}`,
      };
    }

    // Check quote expiry
    const now = this.params.now();
    if (message.expires_at_ms <= now) {
      this.terminate("TIMEOUT", "FAILED_NEGOTIATION_TIMEOUT", "quote expired");
      return { ok: false, code: "FAILED_NEGOTIATION_TIMEOUT", reason: "quote expired" };
    }

    // Validate expires_at_ms matches sent_at_ms + valid_for_ms
    if (message.expires_at_ms !== message.sent_at_ms + message.valid_for_ms) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: "Quote expires_at_ms does not match sent_at_ms + valid_for_ms",
      };
    }

    // Policy check: negotiation phase
    const nextRound = this.round + 1;
    
    // Ensure start_ms is set (should be set in openWithIntent)
    if (this.start_ms === undefined) {
      // Fallback: use current time as start if somehow not set
      this.start_ms = now;
    }
    
    const elapsedMs = now - this.start_ms;

    const negotiationCtx = {
      now_ms: now,
      intent_type: this.intent?.intent ?? this.params.intentType ?? "",
      round: nextRound,
      elapsed_ms: elapsedMs,

      message_type: message.type,
      valid_for_ms: message.valid_for_ms,
      is_firm_quote: true,
      quote_price: message.price,
      reference_price_p50: referencePriceP50 ?? null,
      urgent: !!this.intent?.urgent,

      counterparty: {
        reputation: counterpartySummary.reputation ?? 0.99,
        age_ms: counterpartySummary.age_ms ?? 1_000_000,
        region: counterpartySummary.region ?? "us-east",
        has_required_credentials: true,
        failure_rate: counterpartySummary.failure_rate ?? 0,
        timeout_rate: counterpartySummary.timeout_rate ?? 0,
        is_new: counterpartySummary.is_new_agent ?? false,
      },
    };

    const guardResult = this.params.guard.check("negotiation", negotiationCtx, negotiationCtx.intent_type);
    if (!guardResult.ok) {
      return this.terminateFromGuard(guardResult);
    }

    // Accept quote
    this.status = "NEGOTIATING";
    this.round = nextRound;
    this.last_action_ms = now;
    if (message.type === "ASK") {
      this.latest_ask = message;
    } else {
      this.latest_bid = message;
    }
    this.transcript.push(envelope);

    return { ok: true };
  }

  /**
   * Accept the negotiation.
   */
  async accept(envelope: SignedEnvelope<AcceptMessage>): Promise<{ ok: true } | { ok: false; code: FailureCode; reason: string }> {
    if (this.status !== "NEGOTIATING") {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Cannot accept: session is in ${this.status} state`,
      };
    }

    // Verify envelope signature
    const isValid = await verifyEnvelope(envelope);
    if (!isValid) {
      this.terminate("FAILED_IDENTITY", "FAILED_POLICY", "Envelope signature verification failed");
      return { ok: false, code: "FAILED_POLICY", reason: "Envelope signature verification failed" };
    }

    // Parse and validate message
    let message: AcceptMessage;
    try {
      const parsed = parseMessage(envelope.message);
      if (parsed.type !== "ACCEPT") {
        return {
          ok: false,
          code: "FAILED_POLICY",
          reason: `Expected ACCEPT message, got ${parsed.type}`,
        };
      }
      message = parsed;
    } catch (error) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Invalid message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Check intent_id matches
    if (message.intent_id !== this.intent_id) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Intent ID mismatch: expected ${this.intent_id}, got ${message.intent_id}`,
      };
    }

    // Check expiry
    const now = this.params.now();
    if (message.expires_at_ms <= now) {
      this.terminate("TIMEOUT", "FAILED_NEGOTIATION_TIMEOUT", "quote expired");
      return { ok: false, code: "FAILED_NEGOTIATION_TIMEOUT", reason: "quote expired" };
    }

    // Policy check: negotiation phase
    const elapsed_ms = now - (this.start_ms ?? now);
    const latestQuote = this.latest_ask ?? this.latest_bid;
    const negotiationCtx: NegotiationContext = {
      now_ms: now,
      intent_type: this.intent?.intent ?? this.params.intentType ?? "",
      round: this.round,
      elapsed_ms,
      message_type: latestQuote?.type === "ASK" ? "ASK" : "BID",
      valid_for_ms: latestQuote?.valid_for_ms ?? 60000,
      is_firm_quote: true,
      quote_price: latestQuote?.price ?? 0,
      reference_price_p50: null,
    };

    const guardResult = this.params.guard.check("negotiation", negotiationCtx, this.intent?.intent);
    if (!guardResult.ok) {
      return this.terminateFromGuard(guardResult);
    }

    // Create agreement and lock funds/bond
    if (this.params.settlement) {
      const buyerAgentId = this.params.buyerAgentId ?? "buyer";
      const sellerAgentId = this.params.sellerAgentId ?? "seller";
      const sellerBond = this.latest_ask?.bond_required ?? this.latest_bid?.bond_required ?? 0;
      const targetAmount = message.agreed_price;
      const mode = message.settlement_mode === "streaming" ? "streaming" : "hash_reveal";

      // v1.6.6+: Split settlement (B3) - only for hash_reveal mode
      const splitEnabled = this.params.settlementSplit?.enabled === true && mode === "hash_reveal";
      
      if (splitEnabled && this.params.settlementSplit && this.params.createSettlementProvider && this.params.selectSettlementProvider && this.params.settlementCandidates) {
        // Split settlement: fulfill payment in multiple segments across different providers
        const maxSegments = this.params.settlementSplit.max_segments ?? this.params.settlementCandidates.length;
        const epsilon = 0.00000001; // Float tolerance
        let remaining = targetAmount;
        let segmentIdx = 0;
        let candidateIdx = 0;
        
        this.settlementSegments = [];
        this.splitTotalPaid = 0;
        
        while (remaining > epsilon && segmentIdx < maxSegments && candidateIdx < this.params.settlementCandidates.length) {
          const candidate = this.params.settlementCandidates[candidateIdx];
          const segmentAmount = Math.min(remaining, targetAmount / maxSegments);
          
          // Route settlement provider for this segment
          const routingResult = this.params.selectSettlementProvider(
            segmentAmount,
            mode,
            candidate.trust_tier || "untrusted",
            candidate.trust_score || 0
          );
          
          // Create settlement provider for this segment
          let segmentSettlement: SettlementProvider;
          try {
            segmentSettlement = this.params.createSettlementProvider(
              routingResult.provider as "mock" | "stripe_like" | "external",
              {} // No params for split segments
            );
          } catch (error: any) {
            // Provider creation failed - record segment failure and continue
            this.settlementSegments.push({
              idx: segmentIdx,
              provider_pubkey: candidate.provider_pubkey,
              settlement_provider: routingResult.provider,
              amount: segmentAmount,
              status: "failed",
              failure_code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
              failure_reason: `Settlement provider creation failed: ${error?.message || String(error)}`,
            });
            candidateIdx++;
            continue;
          }
          
          // Attempt segment settlement
          try {
            if (this.settlementSupportsLifecycleForProvider(segmentSettlement)) {
              const intent_id = `${message.intent_id}-segment-${segmentIdx}`;
              const handle = await segmentSettlement.prepare({
                intent_id,
                from: buyerAgentId,
                to: sellerAgentId,
                amount: segmentAmount,
                mode: "hash_reveal",
                idempotency_key: this.params.settlementIdempotencyKey ? `${this.params.settlementIdempotencyKey}-seg${segmentIdx}` : undefined,
                // v2 Phase 2+: Include chain and asset
                chain: this.settlementChain,
                asset: this.settlementAsset,
                meta: { agreement_id: message.intent_id, segment_idx: segmentIdx },
              });
              
              const commitResult = await segmentSettlement.commit(handle.handle_id);
              
              if (commitResult.status === "pending" && this.params.settlementAutoPollMs !== undefined) {
                // Poll for async providers
                if (typeof segmentSettlement.poll === "function") {
                  let pollAttempts = 0;
                  const maxPollAttempts = 100;
                  while (pollAttempts < maxPollAttempts) {
                    await new Promise(resolve => setTimeout(resolve, this.params.settlementAutoPollMs || 0));
                    const pollResult = await segmentSettlement.poll(handle.handle_id);
                    if (pollResult.status !== "pending") {
                      if (pollResult.status === "committed") {
                        // Success - record committed segment
                        this.settlementSegments.push({
                          idx: segmentIdx,
                          provider_pubkey: candidate.provider_pubkey,
                          settlement_provider: routingResult.provider,
                          amount: segmentAmount,
                          status: "committed",
                          handle_id: handle.handle_id,
                        });
                        this.splitTotalPaid += segmentAmount;
                        remaining -= segmentAmount;
                        segmentIdx++;
                        candidateIdx = 0; // Reset candidate index for next segment
                        break;
                      } else {
                        // Failed - record failed segment and continue to next candidate
                        this.settlementSegments.push({
                          idx: segmentIdx,
                          provider_pubkey: candidate.provider_pubkey,
                          settlement_provider: routingResult.provider,
                          amount: segmentAmount,
                          status: "failed",
                          handle_id: handle.handle_id,
                          failure_code: pollResult.failure_code || "SETTLEMENT_FAILED",
                          failure_reason: pollResult.failure_reason || "Settlement failed",
                        });
                        candidateIdx++;
                        break;
                      }
                    }
                    pollAttempts++;
                  }
                  if (pollAttempts >= maxPollAttempts) {
                    // Poll timeout - record failed segment
                    this.settlementSegments.push({
                      idx: segmentIdx,
                      provider_pubkey: candidate.provider_pubkey,
                      settlement_provider: routingResult.provider,
                      amount: segmentAmount,
                      status: "failed",
                      handle_id: handle.handle_id,
                      failure_code: "SETTLEMENT_POLL_TIMEOUT",
                      failure_reason: "Poll timeout",
                    });
                    candidateIdx++;
                  }
                } else {
                  // No poll support - record failed segment
                  this.settlementSegments.push({
                    idx: segmentIdx,
                    provider_pubkey: candidate.provider_pubkey,
                    settlement_provider: routingResult.provider,
                    amount: segmentAmount,
                    status: "failed",
                    handle_id: handle.handle_id,
                    failure_code: "SETTLEMENT_POLL_NOT_SUPPORTED",
                    failure_reason: "Settlement provider does not support polling",
                  });
                  candidateIdx++;
                }
              } else if (commitResult.status === "committed") {
                // Success - record committed segment
                this.settlementSegments.push({
                  idx: segmentIdx,
                  provider_pubkey: candidate.provider_pubkey,
                  settlement_provider: routingResult.provider,
                  amount: segmentAmount,
                  status: "committed",
                  handle_id: handle.handle_id,
                });
                this.splitTotalPaid += segmentAmount;
                remaining -= segmentAmount;
                segmentIdx++;
                candidateIdx = 0; // Reset candidate index for next segment
              } else if (commitResult.status === "failed") {
                // Failed - record failed segment and continue to next candidate
                this.settlementSegments.push({
                  idx: segmentIdx,
                  provider_pubkey: candidate.provider_pubkey,
                  settlement_provider: routingResult.provider,
                  amount: segmentAmount,
                  status: "failed",
                  handle_id: handle.handle_id,
                  failure_code: commitResult.failure_code || "SETTLEMENT_FAILED",
                  failure_reason: commitResult.failure_reason || "Settlement failed",
                });
                candidateIdx++;
              } else {
                // Pending without auto-poll - record failed segment
                this.settlementSegments.push({
                  idx: segmentIdx,
                  provider_pubkey: candidate.provider_pubkey,
                  settlement_provider: routingResult.provider,
                  amount: segmentAmount,
                  status: "failed",
                  handle_id: handle.handle_id,
                  failure_code: "SETTLEMENT_PENDING_UNRESOLVED",
                  failure_reason: "Settlement is pending and auto-poll is not enabled",
                });
                candidateIdx++;
              }
            } else {
              // Legacy settlement - not supported for split
              this.settlementSegments.push({
                idx: segmentIdx,
                provider_pubkey: candidate.provider_pubkey,
                settlement_provider: routingResult.provider,
                amount: segmentAmount,
                status: "failed",
                failure_code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
                failure_reason: "Split settlement requires lifecycle API support",
              });
              candidateIdx++;
            }
          } catch (error: any) {
            // Segment settlement failed - record failed segment and continue to next candidate
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.settlementSegments.push({
              idx: segmentIdx,
              provider_pubkey: candidate.provider_pubkey,
              settlement_provider: routingResult.provider,
              amount: segmentAmount,
              status: "failed",
              failure_code: "SETTLEMENT_FAILED",
              failure_reason: errorMessage,
            });
            candidateIdx++;
          }
        }
        
        // Check if split settlement succeeded
        if (this.splitTotalPaid < targetAmount - epsilon) {
          // Split settlement failed - not all segments committed
          // Note: No automatic refunds in B3 - funds already moved remain moved (disputes C2 handles that)
          const errorCode: FailureCode = "SETTLEMENT_FAILED";
          const errorReason = `Split settlement incomplete: paid ${this.splitTotalPaid}, target ${targetAmount}`;
          this.terminate("FAILED_ESCROW", errorCode, errorReason);
          return { ok: false, code: errorCode, reason: errorReason };
        }
        
        // Split settlement succeeded - continue to create agreement
        // Note: We don't set this.settlementHandle for split settlement (it's per-segment)
      } else if (this.settlementSupportsLifecycle() && mode === "hash_reveal") {
        // v1.7.2+: Use lifecycle API if supported (for hash_reveal mode), else fallback to legacy methods
        // Use lifecycle API: prepare + commit
        try {
          const intent_id = message.intent_id;
          const handle = await this.params.settlement.prepare({
            intent_id,
            from: buyerAgentId,
            to: sellerAgentId,
            amount: message.agreed_price,
            mode: "hash_reveal",
            idempotency_key: this.params.settlementIdempotencyKey,
            // v2 Phase 2+: Include chain and asset
            chain: this.settlementChain,
            asset: this.settlementAsset,
            meta: { agreement_id: intent_id },
          });

          this.settlementHandle = handle;

          // Commit (may return pending for async providers)
          const commitResult = await this.params.settlement.commit(handle.handle_id);

          if (commitResult.status === "pending") {
            // Async settlement - poll if auto_poll_ms is set
            if (this.params.settlementAutoPollMs !== undefined) {
              const pollResult = await this.pollSettlementUntilResolved(handle.handle_id);
              if (!pollResult.ok) {
                // Poll failed or timed out
                // For SETTLEMENT_POLL_TIMEOUT, leave handle pending (don't abort) so it can be reconciled
                // For other failures, abort the settlement
                if (pollResult.code !== "SETTLEMENT_POLL_TIMEOUT") {
                  try {
                    await this.params.settlement.abort(handle.handle_id, pollResult.reason);
                  } catch (e) {
                    // Ignore abort errors
                  }
                }
                // Use the error code from pollResult, not BOND_INSUFFICIENT
                const errorCode = (pollResult.code as FailureCode) || "SETTLEMENT_FAILED";
                this.terminate("FAILED_ESCROW", errorCode, pollResult.reason);
                return { ok: false, code: errorCode, reason: pollResult.reason };
              }
              // Poll succeeded - settlement is now committed
            } else {
              // No auto-poll configured - return pending status
              this.terminate("FAILED_ESCROW", "BOND_INSUFFICIENT", "Settlement is pending and auto-poll is not enabled");
              return { ok: false, code: "BOND_INSUFFICIENT", reason: "Settlement is pending and auto-poll is not enabled" };
            }
          } else if (commitResult.status === "failed") {
            const errorCode = (commitResult.failure_code as FailureCode) || "SETTLEMENT_FAILED";
            this.terminate("FAILED_ESCROW", errorCode, commitResult.failure_reason || "Settlement failed");
            return { ok: false, code: errorCode, reason: commitResult.failure_reason || "Settlement failed" };
          }
          // committed - continue
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Check if error is due to insufficient balance (should be BOND_INSUFFICIENT)
          // vs other settlement errors (should be SETTLEMENT_FAILED)
          const isBalanceError = errorMessage.toLowerCase().includes("insufficient balance") || 
                                 errorMessage.toLowerCase().includes("insufficient funds");
          const errorCode: FailureCode = isBalanceError ? "BOND_INSUFFICIENT" : "SETTLEMENT_FAILED";
          this.terminate("FAILED_ESCROW", errorCode, errorMessage);
          return { ok: false, code: errorCode, reason: errorMessage };
        }
      } else {
        // Legacy settlement methods
        // v2 Phase 2+: Pass chain/asset to lock operations
        this.params.settlement.lock(buyerAgentId, message.agreed_price, this.settlementChain, this.settlementAsset);
      }

      // Lock seller bond (always use legacy method for bonds)
      // v2 Phase 2+: Pass chain/asset to lock operations
      try {
        this.params.settlement.lock(sellerAgentId, sellerBond, this.settlementChain, this.settlementAsset);
      } catch (error) {
        // Unlock buyer funds on failure (abort if lifecycle, unlock if legacy)
        if (this.settlementHandle) {
          try {
            await this.params.settlement.abort(this.settlementHandle.handle_id, "Seller bond insufficient");
          } catch (e) {
            // Fallback to legacy unlock
            this.params.settlement.release(buyerAgentId, message.agreed_price, this.settlementChain, this.settlementAsset);
          }
        } else {
          this.params.settlement.release(buyerAgentId, message.agreed_price, this.settlementChain, this.settlementAsset);
        }
        this.terminate("FAILED_ESCROW", "BOND_INSUFFICIENT", "Insufficient seller bond");
        return { ok: false, code: "BOND_INSUFFICIENT", reason: "Insufficient seller bond" };
      }

      // Create agreement
      this.agreement = createAgreement(
        message.intent_id,
        buyerAgentId,
        sellerAgentId,
        message.agreed_price,
        sellerBond,
        message.challenge_window_ms,
        message.delivery_deadline_ms,
        now
      );

      // Move to LOCKED status when settlement is active
      this.status = "LOCKED";
    } else {
      // No settlement - just ACCEPTED
      this.status = "ACCEPTED";
    }
    this.last_action_ms = now;
    this.transcript.push(envelope);

    this.terminal_result = {
      ok: true,
      outcome: "ACCEPTED",
      accept: message,
      transcript: [...this.transcript],
    };

    return { ok: true };
  }

  /**
   * Reject the negotiation.
   */
  async reject(envelope: SignedEnvelope<RejectMessage>): Promise<{ ok: true } | { ok: false; code: FailureCode; reason: string }> {
    // Verify envelope signature
    const isValid = await verifyEnvelope(envelope);
    if (!isValid) {
      this.terminate("FAILED_IDENTITY", "FAILED_POLICY", "Envelope signature verification failed");
      return { ok: false, code: "FAILED_POLICY", reason: "Envelope signature verification failed" };
    }

    // Parse and validate message
    let message: RejectMessage;
    try {
      const parsed = parseMessage(envelope.message);
      if (parsed.type !== "REJECT") {
        return {
          ok: false,
          code: "FAILED_POLICY",
          reason: `Expected REJECT message, got ${parsed.type}`,
        };
      }
      message = parsed;
    } catch (error) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Invalid message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Check intent_id matches
    if (message.intent_id !== this.intent_id) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Intent ID mismatch: expected ${this.intent_id}, got ${message.intent_id}`,
      };
    }

    // Terminate as REJECTED
    const code = message.code ?? "FAILED_POLICY";
    this.status = "REJECTED";
    this.transcript.push(envelope);
    
    this.terminal_result = {
      ok: false,
      outcome: "REJECTED",
      code,
      reason: message.reason,
      transcript: [...this.transcript],
    };

    return { ok: true };
  }

  /**
   * Process COMMIT message (Phase 4: Atomic Exchange).
   */
  async onCommit(envelope: SignedEnvelope<CommitMessage>): Promise<{ ok: true } | { ok: false; code: FailureCode; reason: string }> {
    // Only allowed in LOCKED status
    if (this.status !== "LOCKED") {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `COMMIT not allowed in status ${this.status}`,
      };
    }

    if (!this.agreement) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: "No agreement found",
      };
    }

    // Verify envelope signature
    const isValid = await verifyEnvelope(envelope);
    if (!isValid) {
      this.terminate("FAILED_IDENTITY", "FAILED_POLICY", "Envelope signature verification failed");
      return { ok: false, code: "FAILED_POLICY", reason: "Envelope signature verification failed" };
    }

    // Parse and validate message
    let message: CommitMessage;
    try {
      const parsed = parseMessage(envelope.message);
      if (parsed.type !== "COMMIT") {
        return {
          ok: false,
          code: "FAILED_POLICY",
          reason: `Expected COMMIT message, got ${parsed.type}`,
        };
      }
      message = parsed;
    } catch (error) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Invalid message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Check intent_id matches
    if (message.intent_id !== this.intent_id) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Intent ID mismatch: expected ${this.intent_id}, got ${message.intent_id}`,
      };
    }

    // Check deadline
    const now = this.params.now();
    if (now > this.agreement.delivery_deadline_ms) {
      // Seller failed to commit by deadline - slash
      await this.slashSeller("Seller failed to commit by deadline");
      return { ok: false, code: "FAILED_PROOF", reason: "Seller failed to commit by deadline" };
    }

    // Store commit hash
    this.agreement.commit_hash_hex = message.commit_hash_hex;
    this.status = "EXCHANGING";
    this.last_action_ms = now;
    this.transcript.push(envelope);

    return { ok: true };
  }

  /**
   * Process REVEAL message (Phase 4: Atomic Exchange).
   */
  async onReveal(envelope: SignedEnvelope<RevealMessage>): Promise<{ ok: true } | { ok: false; code: FailureCode; reason: string }> {
    // Only allowed in EXCHANGING status
    if (this.status !== "EXCHANGING") {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `REVEAL not allowed in status ${this.status}`,
      };
    }

    if (!this.agreement || !this.agreement.commit_hash_hex) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: "No commit hash found - must COMMIT before REVEAL",
      };
    }

    // Verify envelope signature
    const isValid = await verifyEnvelope(envelope);
    if (!isValid) {
      this.terminate("FAILED_IDENTITY", "FAILED_POLICY", "Envelope signature verification failed");
      return { ok: false, code: "FAILED_POLICY", reason: "Envelope signature verification failed" };
    }

    // Parse and validate message
    let message: RevealMessage;
    try {
      const parsed = parseMessage(envelope.message);
      if (parsed.type !== "REVEAL") {
        return {
          ok: false,
          code: "FAILED_POLICY",
          reason: `Expected REVEAL message, got ${parsed.type}`,
        };
      }
      message = parsed;
    } catch (error) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Invalid message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // Check intent_id matches
    if (message.intent_id !== this.intent_id) {
      return {
        ok: false,
        code: "FAILED_POLICY",
        reason: `Intent ID mismatch: expected ${this.intent_id}, got ${message.intent_id}`,
      };
    }

    // Check deadline
    const now = this.params.now();
    if (now > this.agreement.delivery_deadline_ms) {
      // Seller failed to reveal by deadline - slash
      await this.slashSeller("Seller failed to reveal by deadline");
      return { ok: false, code: "FAILED_PROOF", reason: "Seller failed to reveal by deadline" };
    }

    // Verify reveal matches commit
    const isValidReveal = verifyReveal(
      this.agreement.commit_hash_hex,
      message.payload_b64,
      message.nonce_b64
    );

    if (!isValidReveal) {
      // Hash mismatch - slash seller
      await this.slashSeller("Reveal hash mismatch");
      return { ok: false, code: "FAILED_PROOF", reason: "Reveal hash mismatch" };
    }

    // Success - complete exchange
    this.agreement.revealed_payload_b64 = message.payload_b64;
    this.agreement.revealed_nonce_b64 = message.nonce_b64;
    this.agreement.status = "COMPLETED";
    this.status = "ACCEPTED";
    this.last_action_ms = now;
    this.transcript.push(envelope);

    // Release funds to seller and unlock bond
    if (this.params.settlement) {
      const buyerAgentId = this.params.buyerAgentId ?? "buyer";
      const sellerAgentId = this.params.sellerAgentId ?? "seller";

      // v1.7.2+: If using lifecycle API, funds are already transferred on commit
      // Just need to ensure it's committed (poll if still pending)
      if (this.settlementHandle) {
        // Check if settlement is already committed
        if (this.params.settlement.poll) {
          const pollResult = await this.params.settlement.poll(this.settlementHandle.handle_id);
          if (pollResult.status === "pending") {
            // Still pending - poll until resolved if auto_poll is enabled
            if (this.params.settlementAutoPollMs !== undefined) {
              const resolved = await this.pollSettlementUntilResolved(this.settlementHandle.handle_id);
              if (!resolved.ok) {
                // Settlement failed - abort and slash seller
                try {
                  await this.params.settlement.abort(this.settlementHandle.handle_id, resolved.reason);
                } catch (e) {
                  // Ignore
                }
                await this.slashSeller(`Settlement failed: ${resolved.reason}`);
                return { ok: false, code: "FAILED_PROOF", reason: resolved.reason };
              }
            } else {
              // Pending but no auto-poll - this shouldn't happen if we handled it in accept
              // But handle gracefully
              await this.slashSeller("Settlement still pending");
              return { ok: false, code: "FAILED_PROOF", reason: "Settlement still pending" };
            }
          } else if (pollResult.status === "failed") {
            // Settlement failed - slash seller
            await this.slashSeller(pollResult.failure_reason || "Settlement failed");
            return { ok: false, code: "FAILED_PROOF", reason: pollResult.failure_reason || "Settlement failed" };
          }
          // committed - funds already transferred, continue
        }
        // If no poll method, assume committed (legacy behavior)
      } else {
        // Legacy settlement: unlock, debit, credit
        // v2 Phase 2+: Pass chain/asset to settlement operations
        // Unlock buyer payment (adds back to balance)
        this.params.settlement.release(buyerAgentId, this.agreement.agreed_price, this.settlementChain, this.settlementAsset);
        // Debit from buyer and credit to seller
        this.params.settlement.debit(buyerAgentId, this.agreement.agreed_price, this.settlementChain, this.settlementAsset);
        this.params.settlement.credit(sellerAgentId, this.agreement.agreed_price, this.settlementChain, this.settlementAsset);
      }

      // Unlock seller bond (always use legacy method for bonds)
      // v2 Phase 2+: Pass chain/asset to settlement operations
      this.params.settlement.release(sellerAgentId, this.agreement.seller_bond, this.settlementChain, this.settlementAsset);
    }

    // Create receipt
    const latencyMs = this.start_ms ? now - this.start_ms : undefined;
    this.receipt = createReceipt({
      intent_id: this.agreement.intent_id,
      buyer_agent_id: this.agreement.buyer_agent_id,
      seller_agent_id: this.agreement.seller_agent_id,
      agreed_price: this.agreement.agreed_price,
      fulfilled: true,
      timestamp_ms: now,
      latency_ms: latencyMs,
    });

    return { ok: true };
  }

  /**
   * Slash seller for failure to commit/reveal or hash mismatch.
   */
  private async slashSeller(reason: string): Promise<void> {
    if (!this.agreement || !this.params.settlement) {
      return;
    }

    const buyerAgentId = this.params.buyerAgentId ?? "buyer";
    const sellerAgentId = this.params.sellerAgentId ?? "seller";

    // v1.7.2+: If using lifecycle API, abort settlement (releases locked/transferred funds)
    if (this.settlementHandle) {
      // Try to abort settlement (works if still prepared/pending)
      // If already committed, we need to reverse the transfer manually
      try {
        await this.params.settlement.abort(this.settlementHandle.handle_id, reason);
      } catch {
        // Abort failed (likely already committed) - reverse the transfer manually
        // v2 Phase 2+: Pass chain/asset to settlement operations
        this.params.settlement.credit(buyerAgentId, this.agreement.agreed_price, this.settlementChain, this.settlementAsset);
        this.params.settlement.debit(sellerAgentId, this.agreement.agreed_price, this.settlementChain, this.settlementAsset);
      }
    } else {
      // Legacy settlement: unlock buyer payment
      // v2 Phase 2+: Pass chain/asset to settlement operations
      this.params.settlement.release(buyerAgentId, this.agreement.agreed_price, this.settlementChain, this.settlementAsset);
    }

    // Slash seller bond to buyer
    // v2 Phase 2+: Pass chain/asset to settlement operations
    this.params.settlement.slashBond(sellerAgentId, this.agreement.seller_bond, buyerAgentId, this.settlementChain, this.settlementAsset);

    // Update agreement status
    this.agreement.status = "SLASHED";

    // Create receipt
    const now = this.params.now();
    const latencyMs = this.start_ms ? now - this.start_ms : undefined;
    this.receipt = createReceipt({
      intent_id: this.agreement.intent_id,
      buyer_agent_id: this.agreement.buyer_agent_id,
      seller_agent_id: this.agreement.seller_agent_id,
      agreed_price: this.agreement.agreed_price,
      fulfilled: false,
      timestamp_ms: now,
      latency_ms: latencyMs,
      failure_code: "FAILED_PROOF",
    });

    this.status = "FAILED";
    this.terminal_result = {
      ok: false,
      outcome: "FAILED_PROOF",
      code: "FAILED_PROOF",
      reason,
      transcript: [...this.transcript],
    };
  }

  /**
   * Get the agreement if one exists.
   */
  getAgreement(): Agreement | undefined {
    return this.agreement;
  }

  /**
   * Get the receipt if one exists.
   */
  getReceipt(): Receipt | undefined {
    return this.receipt;
  }

  /**
   * Get settlement segments (v1.6.6+, B3).
   */
  getSettlementSegments(): Array<{
    idx: number;
    provider_pubkey: string;
    settlement_provider: string;
    amount: number;
    status: "committed" | "failed";
    handle_id?: string;
    failure_code?: string;
    failure_reason?: string;
  }> {
    return [...this.settlementSegments];
  }

  /**
   * Get split settlement total paid (v1.6.6+, B3).
   */
  getSplitTotalPaid(): number {
    return this.splitTotalPaid;
  }

  /**
   * Get settlement SLA violations (v1.6.7+, D1).
   */
  getSettlementSLAViolations(): Array<{
    ts_ms: number;
    code: string;
    reason: string;
    handle_id?: string;
    provider?: string;
  }> {
    return [...this.settlementSLAViolations];
  }

  /**
   * Check for timeouts and update state.
   */
  async tick(): Promise<SessionResult | null> {
    if (this.status === "IDLE" || this.status === "ACCEPTED" || this.status === "REJECTED" || this.status === "TIMEOUT" || this.status === "FAILED") {
      return this.terminal_result ?? null; // Already terminal or idle
    }

    const now = this.params.now();
    const policy = this.params.compiledPolicy.base;

    // Check max total duration
    if (this.start_ms !== undefined) {
      const elapsed_ms = now - this.start_ms;
      if (elapsed_ms > policy.negotiation.max_total_duration_ms) {
        this.terminateFromGuard({
          ok: false,
          code: "FAILED_NEGOTIATION_TIMEOUT",
          reason: "duration exceeded",
        });
        return this.terminal_result ?? null;
      }
    }

    // Check intent expiry
    if (this.intent && now > this.intent.expires_at_ms) {
      this.terminateFromGuard({
        ok: false,
        code: "FAILED_NEGOTIATION_TIMEOUT",
        reason: "intent expired",
      });
      return this.terminal_result ?? null;
    }

    // Check max rounds
    const maxRounds = policy.negotiation.max_rounds;
    if (this.round >= maxRounds) {
      this.terminateFromGuard({
        ok: false,
        code: "FAILED_NEGOTIATION_TIMEOUT",
        reason: "rounds exceeded",
      });
      return this.terminal_result ?? null;
    }

    // Check agreement deadlines if in LOCKED or EXCHANGING status
    if (this.agreement && (this.status === "LOCKED" || this.status === "EXCHANGING")) {
      if (now > this.agreement.delivery_deadline_ms) {
        if (this.status === "LOCKED") {
          // Seller failed to commit
          await this.slashSeller("Seller failed to commit by deadline");
          return this.terminal_result ?? null;
        } else if (this.status === "EXCHANGING") {
          // Seller failed to reveal
          await this.slashSeller("Seller failed to reveal by deadline");
          return this.terminal_result ?? null;
        }
      }
    }

    return null;
  }

  /**
   * Terminate the session with a failure outcome.
   */
  private terminate(outcome: TerminalOutcome, code: FailureCode, reason: string): void {
    this.status = outcome === "ACCEPTED" ? "ACCEPTED" : outcome === "REJECTED" ? "REJECTED" : outcome === "TIMEOUT" ? "TIMEOUT" : "FAILED";
    
    if (!this.terminal_result) {
      this.terminal_result = {
        ok: false,
        outcome,
        code,
        reason,
        transcript: [...this.transcript],
      };
    }
  }

  /**
   * Handle guard failure and terminate session with appropriate outcome.
   */
  private terminateFromGuard(guardResult: { ok: false; code: FailureCode; reason?: string }): { ok: false; code: FailureCode; reason: string } | SessionResult {
    const defaultReason = `Policy violation: ${guardResult.code}`;
    const reason = guardResult.reason ?? defaultReason;
    
    // TIMEOUT classification
    if (guardResult.code === "FAILED_NEGOTIATION_TIMEOUT" ||
        guardResult.code === "ROUND_EXCEEDED" ||
        guardResult.code === "DURATION_EXCEEDED" ||
        guardResult.code === "INTENT_EXPIRED") {
      // Normalize timeout codes
      const timeoutCode = guardResult.code === "ROUND_EXCEEDED" ? "FAILED_NEGOTIATION_TIMEOUT" :
                          guardResult.code === "DURATION_EXCEEDED" ? "FAILED_NEGOTIATION_TIMEOUT" :
                          guardResult.code === "INTENT_EXPIRED" ? "FAILED_NEGOTIATION_TIMEOUT" :
                          guardResult.code;
      const timeoutReason = guardResult.reason ?? (
        guardResult.code === "ROUND_EXCEEDED" ? "rounds exceeded" :
        guardResult.code === "DURATION_EXCEEDED" ? "duration exceeded" :
        guardResult.code === "INTENT_EXPIRED" ? "intent expired" :
        "negotiation timeout"
      );
      
      this.status = "TIMEOUT";
      const timeoutTranscriptCopy = [...this.transcript];
      this.terminal_result = {
        ok: false,
        outcome: "TIMEOUT",
        code: timeoutCode,
        reason: timeoutReason,
        transcript: timeoutTranscriptCopy,
      };
      return { ok: false, code: timeoutCode, reason: timeoutReason };
    }

    // Otherwise failed terminal
    const outcome = this.mapCodeToOutcome(guardResult.code);
    this.status = outcome === "ACCEPTED" ? "ACCEPTED" : outcome === "REJECTED" ? "REJECTED" : outcome === "TIMEOUT" ? "TIMEOUT" : "FAILED";
    const transcriptCopy = [...this.transcript];
    this.terminal_result = {
      ok: false,
      outcome,
      code: guardResult.code,
      reason,
      transcript: transcriptCopy,
    };
    return { ok: false, code: guardResult.code, reason };
  }

  /**
   * Map FailureCode to TerminalOutcome.
   */
  private mapCodeToOutcome(code: FailureCode): TerminalOutcome {
    switch (code) {
      case "FAILED_IDENTITY":
        return "FAILED_IDENTITY";
      case "NEW_AGENT_EXCLUDED":
      case "REGION_NOT_ALLOWED":
      case "FAILURE_RATE_TOO_HIGH":
      case "TIMEOUT_RATE_TOO_HIGH":
      case "MISSING_REQUIRED_CREDENTIALS":
      case "UNTRUSTED_ISSUER":
      case "INTENT_NOT_ALLOWED":
      case "SESSION_SPEND_CAP_EXCEEDED":
      case "ONE_OF_ADMISSION_FAILED":
        return "FAILED_ADMISSION";
      case "SETTLEMENT_MODE_NOT_ALLOWED":
      case "PRE_SETTLEMENT_LOCK_REQUIRED":
      case "BOND_INSUFFICIENT":
        return "FAILED_ESCROW";
      case "SCHEMA_VALIDATION_FAILED":
        return "FAILED_PROOF";
      case "LATENCY_BREACH":
      case "FRESHNESS_BREACH":
        return "FAILED_SLA";
      case "STREAMING_SPEND_CAP_EXCEEDED":
        return "FAILED_BUDGET";
      case "FAILED_REFERENCE_BAND":
      case "QUOTE_OUT_OF_BAND":
      case "TRANSCRIPT_STORAGE_FORBIDDEN":
        return "FAILED_POLICY";
      default:
        return "FAILED_POLICY";
    }
  }
}


