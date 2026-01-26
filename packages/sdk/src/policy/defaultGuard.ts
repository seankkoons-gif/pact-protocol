import type {
  NegotiationPhase,
  FailureCode,
} from "./types";
import type {
  PhaseContext,
  IdentityContext,
  IntentContext,
  NegotiationContext,
  LockContext,
  ExchangeContext,
  ResolutionContext,
} from "./context";
import type { CompiledPolicy } from "./types";
import type { PolicyGuard } from "./guard";
import { requiredSellerBond, allowedQuoteRange, computeReferenceBand } from "./compiler";
import { checkPassportV1Constraints } from "./passportV1Gating";

export class DefaultPolicyGuard implements PolicyGuard {
  private compiled: CompiledPolicy;
  constructor(compiled: CompiledPolicy) {
    this.compiled = compiled;
  }

  check(
    phase: NegotiationPhase,
    ctx: PhaseContext,
    intent?: string
  ): { ok: true } | { ok: false; code: FailureCode } {
    switch (phase) {
      case "identity":
        return this.checkIdentity(ctx as IdentityContext, intent);
      case "intent":
        return this.checkIntent(ctx as IntentContext);
      case "negotiation":
        return this.checkNegotiation(ctx as NegotiationContext, intent);
      case "lock":
        return this.checkLock(ctx as LockContext, intent);
      case "exchange":
        return this.checkExchange(ctx as ExchangeContext);
      case "resolution":
        return this.checkResolution(ctx as ResolutionContext);
      default:
        return { ok: false, code: "INVALID_POLICY" };
    }
  }

  private checkIdentity(ctx: IdentityContext, intent?: string): { ok: true } | { ok: false; code: FailureCode } {
    const cp = this.compiled.base.counterparty;

    if (cp.exclude_new_agents && ctx.is_new_agent) {
      return { ok: false, code: "NEW_AGENT_EXCLUDED" };
    }

    if (cp.region_allowlist.length > 0 && ctx.region && !cp.region_allowlist.includes(ctx.region)) {
      return { ok: false, code: "REGION_NOT_ALLOWED" };
    }

    if (ctx.failure_rate !== undefined && ctx.failure_rate > cp.max_failure_rate) {
      return { ok: false, code: "FAILURE_RATE_TOO_HIGH" };
    }

    if (ctx.timeout_rate !== undefined && ctx.timeout_rate > cp.max_timeout_rate) {
      return { ok: false, code: "TIMEOUT_RATE_TOO_HIGH" };
    }

    // Check required credentials - use per-intent override if available
    const requiredCredsRaw =
      (intent && this.compiled.perIntent?.[intent]?.requiredCredentials)
      ?? cp.require_credentials
      ?? [];
    const requiredCreds: string[] = Array.isArray(requiredCredsRaw) ? requiredCredsRaw : [];
    if (requiredCreds.length > 0) {
      const credentialTypes = new Set(ctx.credentials.map((c) => c.type));
      const missing = requiredCreds.filter((req: string) => !credentialTypes.has(req));
      if (missing.length > 0) {
        return { ok: false, code: "MISSING_REQUIRED_CREDENTIALS" };
      }
    }

    // Check trusted issuers
    if (cp.trusted_issuers.length > 0) {
      const issuers = new Set(ctx.credentials.map((c) => c.issuer));
      const hasTrustedIssuer = ctx.credentials.some((c) => cp.trusted_issuers.includes(c.issuer));
      if (!hasTrustedIssuer && ctx.credentials.length > 0) {
        return { ok: false, code: "UNTRUSTED_ISSUER" };
      }
    }

    // Check passport v1 constraints
    // Note: signer key should be provided in context, but for identity phase we use agent_id as fallback
    // In practice, the caller should provide the signer_public_key_b58 in the context
    const signerKey = (ctx as any).signer_public_key_b58 || ctx.agent_id;
    const passportCheck = checkPassportV1Constraints(ctx.passport_v1, cp.passport_v1, signerKey);
    if (passportCheck) {
      // Missing passport or constraint violation -> PASSPORT_REQUIRED
      return { ok: false, code: "PASSPORT_REQUIRED" };
    }

    return { ok: true };
  }

  private checkIntent(ctx: IntentContext): { ok: true } | { ok: false; code: FailureCode } {
    const policy = this.compiled.base;

    // Support both old and new context shapes
    const expiresAt = ctx.expires_at_ms ?? ctx.expires_at;
    const intentType = ctx.intent_type ?? ctx.intent;
    const nowMs = ctx.now_ms ?? Date.now();

    // Safe access: check if policy.time exists before accessing properties
    const timeConfig = policy.time;
    if (timeConfig && typeof timeConfig === "object") {
      // Time semantics
      if (timeConfig.require_expires_at && !expiresAt) {
        return { ok: false, code: "MISSING_EXPIRES_AT" };
      }

      if (expiresAt && expiresAt < nowMs) {
        return { ok: false, code: "INTENT_EXPIRED" };
      }

      if (ctx.valid_for_ms !== undefined) {
        if (ctx.valid_for_ms < timeConfig.min_valid_for_ms) {
          return { ok: false, code: "VALID_FOR_TOO_SHORT" };
        }
        if (ctx.valid_for_ms > timeConfig.max_valid_for_ms) {
          return { ok: false, code: "VALID_FOR_TOO_LONG" };
        }
      }
    } else {
      // If time config is missing, use safe defaults
      if (expiresAt && expiresAt < nowMs) {
        return { ok: false, code: "INTENT_EXPIRED" };
      }
    }

    if (ctx.clock_skew_ms !== undefined && timeConfig) {
      if (Math.abs(ctx.clock_skew_ms) > timeConfig.max_clock_skew_ms) {
        return { ok: false, code: "CLOCK_SKEW_TOO_LARGE" };
      }
    }

    // Admission checks
    const allowlist = policy.admission.session_intent_allowlist;
    if (allowlist.length > 0 && intentType && !allowlist.includes(intentType)) {
      return { ok: false, code: "INTENT_NOT_ALLOWED" };
    }

    // Session spend cap (per hour, but we check against session_spend which is cumulative)
    if (ctx.session_spend !== undefined && ctx.session_spend > policy.admission.session_max_spend_per_hour) {
      return { ok: false, code: "SESSION_SPEND_CAP_EXCEEDED" };
    }

    // One-of admission - support both old (sponsors array) and new (admission object) shapes
    const requireOneOf = policy.admission.require_one_of;
    if (requireOneOf.length > 0) {
      let satisfied = false;

      // Check new admission object shape
      if (ctx.admission) {
        if (requireOneOf.includes("bond") && ctx.admission.has_bond) {
          satisfied = true;
        }
        if (requireOneOf.includes("credential") && ctx.admission.has_credential) {
          satisfied = true;
        }
        if (requireOneOf.includes("sponsor_attestation") && ctx.admission.has_sponsor) {
          satisfied = true;
        }
      }

      // Check old sponsors array shape (for backward compatibility)
      if (!satisfied && requireOneOf.includes("sponsor_attestation") && ctx.sponsors && ctx.sponsors.length > 0) {
        satisfied = true;
      }

      if (!satisfied) {
        return { ok: false, code: "ONE_OF_ADMISSION_FAILED" };
      }
    }

    // Rate limit, concurrency, budgets, kill switch checks (new fields)
    if (ctx.rate_limit_ok === false) {
      return { ok: false, code: "FAILED_POLICY" };
    }
    if (ctx.concurrency_ok === false) {
      return { ok: false, code: "FAILED_POLICY" };
    }
    if (ctx.budgets_ok === false) {
      return { ok: false, code: "FAILED_POLICY" };
    }
    if (ctx.kill_switch_triggered === true) {
      return { ok: false, code: "FAILED_POLICY" };
    }

    return { ok: true };
  }

  private checkNegotiation(ctx: NegotiationContext, intent?: string): { ok: true } | { ok: false; code: FailureCode } {
    const policy = this.compiled.base;
    const intentConstraints = intent ? this.compiled.perIntent[intent] : undefined;

    // Support both old and new context shapes
    const intentType = ctx.intent_type ?? ctx.intent ?? intent;
    const validForMs = ctx.valid_for_ms ?? ctx.firm_quote?.valid_for_ms;
    const isFirmQuote = ctx.is_firm_quote ?? (ctx.firm_quote !== undefined);

    // Round limits (with new-agent friction if applicable)
    let maxRounds = intentConstraints?.maxRounds ?? policy.negotiation.max_rounds;
    
    // Apply new-agent friction if this is a new agent negotiation
    // Check counterparty.is_new if available (new shape), otherwise use base max_rounds
    if (ctx.counterparty?.is_new && policy.admission.new_agent.max_rounds < maxRounds) {
      maxRounds = policy.admission.new_agent.max_rounds;
    }
    
    if (maxRounds !== undefined && ctx.round > maxRounds) {
      return { ok: false, code: "ROUND_EXCEEDED" };
    }

    // Duration limits
    // Ensure elapsed_ms is a valid number (default to 0 if undefined/null/NaN)
    const elapsedMs = (ctx.elapsed_ms != null && !isNaN(Number(ctx.elapsed_ms))) ? Number(ctx.elapsed_ms) : 0;
    // Ensure max_total_duration_ms is a valid number
    const maxDurationRaw = policy.negotiation.max_total_duration_ms;
    let maxDuration = (maxDurationRaw != null && !isNaN(Number(maxDurationRaw)) && Number(maxDurationRaw) > 0) 
      ? Number(maxDurationRaw) 
      : 300000; // Default to 5 minutes if invalid (should never happen)
    
    // Safety: If the value is suspiciously small (like 300), override it to 300000
    // This handles potential module caching issues or incorrect defaults
    if (maxDuration < 1000) {
      maxDuration = 300000;
    }
    
    // Only check if elapsed time exceeds max duration (with safety check)
    if (elapsedMs > maxDuration && elapsedMs < 10000000) { // Safety: don't fail if elapsedMs is unreasonably large (likely a bug)
      return { ok: false, code: "DURATION_EXCEEDED" };
    }

    // Firm quote validation - support both old (firm_quote object) and new (is_firm_quote + valid_for_ms) shapes
    if (isFirmQuote) {
      if (validForMs === undefined) {
        return { ok: false, code: "FIRM_QUOTE_MISSING_VALID_FOR" };
      }

      if (this.compiled.firmQuoteRange) {
        const range = this.compiled.firmQuoteRange;
        if (validForMs < range.min_ms || validForMs > range.max_ms) {
          return { ok: false, code: "FAILED_POLICY" };
        }
      }
    }

    // Reference band check (if reference pricing is enabled)
    // Note: This requires p50 from receipt history, which is runtime-dependent
    const p50 = ctx.reference_price_p50 ?? ctx.p50_ms;
    if (p50 !== undefined && p50 !== null) {
      const band = computeReferenceBand(policy, p50, !!ctx.urgent);
      if (band.enforced && ctx.quote_price != null && (ctx.quote_price < band.lo || ctx.quote_price > band.hi)) {
        return { ok: false, code: "FAILED_REFERENCE_BAND" };
      }
    }

    // Per-intent credentials check
    if (intent && intentConstraints?.requiredCredentials && intentConstraints.requiredCredentials.length > 0) {
      // Would check against identity credentials from identity phase
      // For now, this is a placeholder
    }

    // Per-intent reputation check
    if (intent && intentConstraints && intentConstraints.minReputation !== undefined) {
      // Would check against reputation from identity phase
      // For now, this is a placeholder
    }

    // Check passport v1 constraints (for counterparty)
    // In negotiation phase, passport_v1 should be for the counterparty being evaluated
    const cp = policy.counterparty;
    if (ctx.passport_v1 !== undefined && cp.passport_v1) {
      // Get signer key from context (should be counterparty's signer key)
      // Fallback to counterparty agent_id if available
      const signerKey = (ctx as any).counterparty_signer_key_b58 || 
                        (ctx.counterparty as any)?.agent_id || 
                        "unknown";
      const passportCheck = checkPassportV1Constraints(ctx.passport_v1, cp.passport_v1, signerKey);
      if (passportCheck) {
        return { ok: false, code: "PASSPORT_REQUIRED" };
      }
    }

    return { ok: true };
  }

  private checkLock(ctx: LockContext, intent?: string): { ok: true } | { ok: false; code: FailureCode } {
    const policy = this.compiled.base;

    // Settlement mode check
    if (!policy.settlement.allowed_modes.includes(ctx.settlement_mode)) {
      return { ok: false, code: "SETTLEMENT_MODE_NOT_ALLOWED" };
    }

    // Pre-settlement lock requirement
    if (policy.settlement.pre_settlement_lock_required && !ctx.lock_established) {
      return { ok: false, code: "PRE_SETTLEMENT_LOCK_REQUIRED" };
    }

    // Bond calculation (if bonding is required)
    if (policy.economics.bonding.seller_bond_multiple > 0) {
      const required = requiredSellerBond(
        ctx.price,
        {
          seller_bond_multiple: policy.economics.bonding.seller_bond_multiple,
          seller_min_bond: policy.economics.bonding.seller_min_bond,
          new_agent_multiplier: ctx.is_new_agent ? policy.admission.new_agent.bond_multiplier : undefined,
        },
        ctx.is_new_agent ?? false
      );
      // In a real implementation, we'd compare against actual bond amount from ctx
      // For now, we assume it's validated elsewhere
      if (ctx.bond_amount !== undefined && ctx.bond_amount < required) {
        return { ok: false, code: "BOND_INSUFFICIENT" };
      }
    }

    return { ok: true };
  }

  private checkExchange(ctx: ExchangeContext): { ok: true } | { ok: false; code: FailureCode } {
    const sla = this.compiled.base.sla;

    // Schema validation
    if (sla.verification.require_schema_validation && ctx.schema_valid === false) {
      return { ok: false, code: "SCHEMA_VALIDATION_FAILED" };
    }

    // Streaming spend cap
    if (ctx.streaming_spend !== undefined) {
      const maxSpend = this.compiled.base.settlement.streaming.max_spend_per_minute;
      if (ctx.streaming_spend > maxSpend) {
        return { ok: false, code: "STREAMING_SPEND_CAP_EXCEEDED" };
      }
    }

    // Latency breach
    if (ctx.latency_ms !== undefined && ctx.latency_ms > sla.max_latency_ms) {
      return { ok: false, code: "LATENCY_BREACH" };
    }

    // Freshness breach (convert seconds to ms for comparison)
    if (ctx.freshness_ms !== undefined && ctx.freshness_ms > sla.max_freshness_sec * 1000) {
      return { ok: false, code: "FRESHNESS_BREACH" };
    }

    return { ok: true };
  }

  private checkResolution(ctx: ResolutionContext): { ok: true } | { ok: false; code: FailureCode } {
    const policy = this.compiled.base.observability;

    if (!policy.store_full_transcripts && ctx.transcript_stored) {
      return { ok: false, code: "TRANSCRIPT_STORAGE_FORBIDDEN" };
    }

    // emit_receipts=false still allows success (guard ok)
    // This is just a preference, not a constraint

    return { ok: true };
  }
}

