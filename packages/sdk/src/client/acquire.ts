import type { PactPolicy } from "../policy/types";
import type { SettlementProvider } from "../settlement/provider";
import type { Receipt } from "../exchange/receipt";
import type { AcquireInput, AcquireResult } from "./types";
import type { ExplainLevel, DecisionCode, ProviderDecision, AcquireExplain } from "./explain";
import { validatePolicyJson, compilePolicy, DefaultPolicyGuard } from "../policy/index";
import { NegotiationSession } from "../engine/session";
import { signEnvelope } from "../protocol/envelope";
import { computeCommitHash } from "../exchange/commit";
import { StreamingExchange } from "../exchange/streaming";
import { createReceipt } from "../exchange/receipt";
import { priceStats, agentScore } from "../reputation/compute";
import { agentScoreV2, type AgentScoreV2Context } from "../reputation/scoreV2";
import { routeExecution } from "../router/route";
import type { ReceiptStore } from "../reputation/store";
import type { ProviderDirectory, ProviderRecord } from "../directory/types";
import type { NegotiationContext, IdentityContext } from "../policy/context";
import { fetchQuote, fetchCommit, fetchReveal, fetchStreamChunk, fetchCredential } from "../adapters/http/client";
import { verifyEnvelope, parseEnvelope } from "../protocol/envelope";
import type { SettlementMode, CommitMessage, RevealMessage } from "../protocol/types";
import type { SignedEnvelope } from "../protocol/envelope";
import type { TranscriptV1 } from "../transcript/types";
import { TranscriptStore } from "../transcript/store";
import { computeCredentialTrustScore } from "../kya/trust";
import { createSettlementProvider } from "../settlement/factory";
import { MockSettlementProvider } from "../settlement/mock";
import { selectSettlementProvider } from "../settlement/routing";

const round8 = (x: number) => Math.round(x * 1e8) / 1e8;

export async function acquire(params: {
  input: AcquireInput;
  buyerKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
  sellerKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
  sellerKeyPairsByPubkeyB58?: Record<string, { publicKey: Uint8Array; secretKey: Uint8Array }>;
  buyerId: string;
  sellerId: string;
  policy: PactPolicy;
  settlement?: SettlementProvider; // Optional: if not provided, use routing or input.settlement.provider
  store?: ReceiptStore;
  directory?: ProviderDirectory;
  rfq?: {
    fanout?: number;
    maxCandidates?: number;
  };
  now?: () => number;
}): Promise<AcquireResult> {
  const { input, buyerKeyPair, sellerKeyPair, buyerId, sellerId, policy, settlement: explicitSettlement, store, directory, rfq, now: nowFn } = params;
  
  // Initialize transcript collection if requested (needed for recordLifecycleError)
  const saveTranscript = input.saveTranscript ?? false;
  const transcriptData: Partial<TranscriptV1> | null = saveTranscript ? {
    version: "1",
    intent_type: input.intentType,
    timestamp_ms: nowFn ? nowFn() : Date.now(),
    input: { ...input }, // Sanitized copy (can remove sensitive data if needed)
    directory: [],
    credential_checks: [],
    quotes: [],
    outcome: { ok: false },
    // Initialize settlement lifecycle metadata (v1.6.3+)
    settlement_lifecycle: input.settlement?.provider ? {
      provider: input.settlement.provider,
      idempotency_key: input.settlement.idempotency_key,
      errors: [],
    } : undefined,
  } : null;
  
  // Helper to record settlement lifecycle error in transcript (v1.6.3+)
  // Must be declared after transcriptData initialization
  const recordLifecycleError = (code: string, reason: string) => {
    if (transcriptData?.settlement_lifecycle) {
      if (!transcriptData.settlement_lifecycle.errors) {
        transcriptData.settlement_lifecycle.errors = [];
      }
      transcriptData.settlement_lifecycle.errors.push({ code, reason });
    }
  };

  // Helper to record settlement lifecycle event (v1.7.2+)
  const recordLifecycleEvent = (
    op: "prepare" | "commit" | "poll" | "abort",
    status: "prepared" | "committed" | "aborted" | "pending" | "failed",
    meta?: Record<string, unknown>
  ) => {
    if (transcriptData?.settlement_lifecycle) {
      if (!transcriptData.settlement_lifecycle.settlement_events) {
        transcriptData.settlement_lifecycle.settlement_events = [];
      }
      transcriptData.settlement_lifecycle.settlement_events.push({
        ts_ms: nowFn ? nowFn() : Date.now(),
        op,
        status,
        meta,
      });
      // Update current status
      transcriptData.settlement_lifecycle.status = status;
      // Update timestamps based on operation
      const now = nowFn ? nowFn() : Date.now();
      if (op === "prepare" && status === "prepared") {
        transcriptData.settlement_lifecycle.prepared_at_ms = now;
        transcriptData.settlement_lifecycle.handle_id = meta?.handle_id as string;
      } else if (op === "commit" && status === "committed") {
        transcriptData.settlement_lifecycle.committed_at_ms = now;
        transcriptData.settlement_lifecycle.paid_amount = meta?.paid_amount as number;
      } else if (op === "commit" && status === "pending") {
        // Pending commit - record attempts
        transcriptData.settlement_lifecycle.attempts = meta?.attempts as number;
        transcriptData.settlement_lifecycle.last_attempt_ms = meta?.last_attempt_ms as number;
      } else if (op === "poll" && status === "committed") {
        transcriptData.settlement_lifecycle.committed_at_ms = now;
        transcriptData.settlement_lifecycle.paid_amount = meta?.paid_amount as number;
        transcriptData.settlement_lifecycle.attempts = meta?.attempts as number;
        transcriptData.settlement_lifecycle.last_attempt_ms = meta?.last_attempt_ms as number;
      } else if (op === "poll" && status === "failed") {
        transcriptData.settlement_lifecycle.failure_code = meta?.failure_code as string;
        transcriptData.settlement_lifecycle.failure_reason = meta?.failure_reason as string;
        transcriptData.settlement_lifecycle.attempts = meta?.attempts as number;
        transcriptData.settlement_lifecycle.last_attempt_ms = meta?.last_attempt_ms as number;
      } else if (op === "commit" && status === "failed") {
        // Handle commit failures (when commit returns failed status directly)
        transcriptData.settlement_lifecycle.failure_code = meta?.failure_code as string;
        transcriptData.settlement_lifecycle.failure_reason = meta?.failure_reason as string;
        if (meta?.attempts !== undefined) {
          transcriptData.settlement_lifecycle.attempts = meta.attempts as number;
        }
        if (meta?.last_attempt_ms !== undefined) {
          transcriptData.settlement_lifecycle.last_attempt_ms = meta.last_attempt_ms as number;
        }
      } else if (op === "abort" && status === "aborted") {
        transcriptData.settlement_lifecycle.aborted_at_ms = now;
      }
    }
  };

  // Settlement provider selection (v1.6.2+)
  // If caller passes settlement instance explicitly, that wins (backward compatibility).
  // Else if input.settlement.provider is provided, create provider via factory.
  // Else defer to policy-driven routing (after provider selection to get amount/trust info).
  let settlement: SettlementProvider | undefined;
  let settlementRoutingResult: { provider: string; matchedRuleIndex?: number; reason: string } | undefined;
  
  // Only create settlement provider early if explicitly provided (for backward compatibility)
  if (explicitSettlement) {
    // Explicit instance wins (backward compatibility)
    settlement = explicitSettlement;
  } else if (input.settlement?.provider) {
    // Explicit provider specified - create now
    try {
      settlement = createSettlementProvider({
        provider: input.settlement.provider,
        params: input.settlement.params,
        idempotency_key: input.settlement.idempotency_key,
      });
    } catch (error: any) {
      // Handle factory creation errors (e.g., invalid config)
      const errorMsg = error?.message || String(error);
      const explainLevel: ExplainLevel = input.explain ?? "none";
      const explain: AcquireExplain | null = explainLevel !== "none" ? {
        level: explainLevel,
        intentType: input.intentType,
        settlement: "hash_reveal",
        regime: "posted",
        fanout: 0,
        providers_considered: 0,
        providers_eligible: 0,
        log: [],
      } : null;
      
      // Record lifecycle error in transcript
      recordLifecycleError("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED", `Settlement provider creation failed: ${errorMsg}`);
      
      return {
        ok: false,
        code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
        reason: `Settlement provider not implemented: ${errorMsg}`,
        explain: explain || undefined,
      };
    }
  }
  // If neither explicit settlement nor input.settlement.provider, defer to routing after provider selection
  
  // Initialize explain if requested
  const explainLevel: ExplainLevel = input.explain ?? "none";
  const explain: AcquireExplain | null = explainLevel !== "none" ? {
    level: explainLevel,
    intentType: input.intentType,
    settlement: "hash_reveal", // Will be updated when settlement mode is determined
    regime: "posted", // Will be updated from plan
    fanout: 0, // Will be updated
    providers_considered: 0,
    providers_eligible: 0,
    log: [],
  } : null;

  // Helper to push decision to explain log
  const pushDecision = (
    provider: { provider_id: string; pubkey_b58: string; endpoint?: string },
    step: ProviderDecision["step"],
    ok: boolean,
    code: DecisionCode,
    reason: string,
    meta?: Record<string, any>
  ) => {
    if (!explain) return;
    const decision: ProviderDecision = {
      provider_id: provider.provider_id,
      pubkey_b58: provider.pubkey_b58,
      endpoint: provider.endpoint,
      step,
      ok,
      code,
      reason,
      ts_ms: nowFn ? nowFn() : Date.now(),
    };
    if (explainLevel === "full" && meta) {
      decision.meta = meta;
    }
    explain.log.push(decision);
  };

  // 1) Validate + compile policy
  const validated = validatePolicyJson(policy);
  if (!validated.ok) {
    return {
      ok: false,
      code: "INVALID_POLICY",
      reason: `Policy validation failed: ${validated.errors.join(", ")}`,
      ...(explain ? { explain } : {}),
    };
  }

  const compiled = compilePolicy(validated.policy);
  const guard = new DefaultPolicyGuard(compiled);

  // 2) Compute market stats from store (if provided)
  let p50: number | null = null;
  let p90: number | null = null;
  let tradeCount = 0;

  if (store) {
    const receiptsForIntent = store.list({ intentType: input.intentType });
    const stats = priceStats(receiptsForIntent);
    p50 = stats.p50;
    p90 = stats.p90;
    tradeCount = stats.n;
  }

  // 3) Route execution
  const plan = routeExecution({
    intentType: input.intentType,
    urgency: !!input.urgent,
    tradeCount,
    p50,
    p90,
    policyMaxRounds: compiled.base.negotiation.max_rounds,
  });

  const chosenMode = input.modeOverride ?? plan.settlement;
  const overrideActive = input.modeOverride != null;

  // 4) Build provider candidate list (BEFORE creating session)
  let internalNow = 0;
  const nowFunction = nowFn || (() => {
    const current = internalNow;
    internalNow += 1000;
    return current;
  });

  // Build provider candidates
  type ProviderCandidate = {
    provider_id: string;
    pubkey_b58: string;
    credentials?: string[];
    region?: string;
    baseline_latency_ms?: number;
    endpoint?: string; // HTTP endpoint for real providers
  };

  let candidates: ProviderCandidate[] = [];
  
  if (directory) {
    // Use directory for fanout
    const allProviders = directory.listProviders(input.intentType);
    
    // Log directory empty
    if (allProviders.length === 0) {
      if (explain) {
        explain.regime = plan.regime;
        explain.settlement = chosenMode;
        explain.fanout = plan.fanout;
        explain.providers_considered = 0;
        explain.providers_eligible = 0;
        explain.log.push({
          provider_id: "",
          pubkey_b58: "",
          step: "directory",
          ok: false,
          code: "DIRECTORY_EMPTY",
          reason: "No providers found in directory for intent type",
          ts_ms: nowFunction(),
        });
      }
      return {
        ok: false,
        plan: {
          ...plan,
          overrideActive,
          offers_considered: 0,
        },
        code: "NO_PROVIDERS",
        reason: "Directory returned no providers for intent type",
        offers_eligible: 0,
        ...(explain ? { explain } : {}),
      };
    }
    
    // When explain is enabled, consider all providers to show rejections
    // Otherwise use the plan's fanout
    const baseFanout = explainLevel !== "none" 
      ? allProviders.length  // Consider all providers when explaining
      : (rfq?.fanout ?? plan.fanout);
    const effectiveFanout = Math.min(
      baseFanout,
      rfq?.maxCandidates ?? 100,
      allProviders.length
    );
    
    // Take first N providers (stable order)
    const selectedProviders = allProviders.slice(0, effectiveFanout);
    
    candidates = selectedProviders.map(record => {
      const provider = record as any;
      const candidate: ProviderCandidate = {
        provider_id: record.provider_id,
        pubkey_b58: provider.pubkey_b58 ?? provider.pubkeyB58 ?? provider.pubkey ?? record.provider_id,
        credentials: provider.credentials ?? provider.credential ?? [],
        region: provider.region,
        baseline_latency_ms: provider.baseline_latency_ms,
        endpoint: provider.endpoint,
      };
      
      // Collect directory data for transcript
      if (transcriptData) {
        transcriptData.directory!.push({
          provider_id: record.provider_id,
          pubkey_b58: candidate.pubkey_b58,
          endpoint: candidate.endpoint,
          region: candidate.region,
          credentials: candidate.credentials,
        });
      }
      
      // Log directory step (provider found) - don't use PROVIDER_SELECTED here, that's only for the winner
      // Just track that we found the provider (no decision code needed for positive directory lookup)
      
      return candidate;
    });
    
    if (explain) {
      explain.providers_considered = candidates.length;
    }
  } else {
    // Single seller path (backward compatible)
    candidates = [{
      provider_id: sellerId,
      pubkey_b58: sellerId,
      credentials: input.identity?.seller?.credentials ?? [],
      region: "us-east",
      baseline_latency_ms: input.constraints.latency_ms,
    }];
    
    if (explain) {
      // Log that we're using single seller path (no decision code needed for positive directory lookup)
      explain.providers_considered = 1;
    }
  }

  const cp: any = (params.policy as any).counterparty ?? {};

    // support both naming conventions
  const intentSpecific =
    cp.intent_specific?.[input.intentType] ??
    cp.intentSpecific?.[input.intentType] ??
    null;

  const requiredCreds: string[] =
    intentSpecific?.require_credentials ??
    intentSpecific?.requireCredentials ??
    cp.require_credentials ??
    cp.requireCredentials ??
    [];

  // Evaluate each candidate (side-effect free - no session.onQuote calls)
  type CandidateEvaluation = {
    provider: ProviderCandidate;
    providerPubkey: string;
    askPrice: number;
    utility: number;
    sellerReputation: number;
    hasRequiredCredentials: boolean;
    latencyMs: number;
  };

  const evaluations: CandidateEvaluation[] = [];
  const referenceP50 = p50 ?? 0.00009; // Bootstrap constant
  const askNow = nowFunction();
  
  // Track failure codes for priority selection when no eligible providers
  const failureCodes: DecisionCode[] = [];

  for (const provider of candidates) {
    // Use pubkey_b58 (never provider_id)
    const providerPubkey = provider.pubkey_b58;
    
    // Get credentials from provider and merge with identity
    const providerCreds = provider.credentials ?? [];
    const finalCreds = [...providerCreds, ...(input.identity?.seller?.credentials ?? [])];
    
    // Pre-filter by credentials
    const hasAllCreds = requiredCreds.length === 0 || requiredCreds.every(c => finalCreds.includes(c));
    
    if (!hasAllCreds) {
      // Log missing credentials
      const code = "PROVIDER_MISSING_REQUIRED_CREDENTIALS" as DecisionCode;
      failureCodes.push(code);
      pushDecision(
        provider,
        "capabilities",
        false,
        code,
        `Missing required credentials: ${requiredCreds.filter(c => !finalCreds.includes(c)).join(", ")}`,
        explainLevel === "full" ? {
          requiredCreds,
          providerCreds: finalCreds,
        } : undefined
      );
      continue; // Skip provider lacking required credentials
    }

    // Build identity context for seller verification
    const sellerIssuers = input.identity?.seller?.issuer_ids || [];
    const credentials: Array<{ type: string; issuer: string }> = [];
    
    // Add credentials with types (need issuers)
    if (finalCreds.length > 0) {
      finalCreds.forEach(type => {
        credentials.push({ type, issuer: sellerIssuers[0] || "default" });
      });
    }
    
    // Add issuer-based credentials (from issuer_ids)
    sellerIssuers.forEach(issuer => {
      credentials.push({ type: "verified", issuer });
    });

    // Track credential verification status for V2 scoring
    let credentialPresent = false;
    let credentialClaims: AgentScoreV2Context["credentialClaims"] = undefined;
    let trustResult: ReturnType<typeof computeCredentialTrustScore> | null = null;

    // Compute initial reputation for identity check (V1, will be recomputed later for utility if V2 enabled)
    let sellerReputation = store ? (() => {
      const score = agentScore(providerPubkey, store.list({ agentId: providerPubkey }));
      return score.reputation;
    })() : 0.5;

    const sellerIdentityCtx: IdentityContext = {
      agent_id: providerPubkey,
      credentials,
      region: provider.region,
      is_new_agent: false,
      reputation: sellerReputation,
    };

    // Check identity phase
    const identityCheck = guard.check("identity", sellerIdentityCtx, input.intentType);
    if (!identityCheck.ok) {
      // Log identity check failure
      const code = identityCheck.code === "MISSING_REQUIRED_CREDENTIALS" ? "PROVIDER_MISSING_REQUIRED_CREDENTIALS" : 
        identityCheck.code === "UNTRUSTED_ISSUER" ? "PROVIDER_UNTRUSTED_ISSUER" :
        "PROVIDER_INTENT_NOT_SUPPORTED" as DecisionCode;
      failureCodes.push(code);
      pushDecision(
        provider,
        "identity",
        false,
        code,
        `Identity check failed: ${identityCheck.code}`,
        explainLevel === "full" ? {
          code: identityCheck.code,
        } : undefined
      );
      
      // Skip this provider (will result in NO_ELIGIBLE_PROVIDERS if all fail)
      continue;
    }

    // For HTTP providers, fetch and verify credential before fetching quote
    if (provider.endpoint) {
      try {
        const credentialResponse = await fetchCredential(provider.endpoint, input.intentType);
        const credentialEnvelope = credentialResponse.envelope;
        
        // Verify credential envelope signature
        const credentialVerified = verifyEnvelope(credentialEnvelope);
        if (!credentialVerified) {
          const code = "PROVIDER_CREDENTIAL_INVALID" as DecisionCode;
          failureCodes.push(code);
          pushDecision(
            provider,
            "identity",
            false,
            code,
            "Credential signature verification failed",
            explainLevel === "full" ? {
              reason: "credential_signature_invalid",
            } : undefined
          );
          // Collect credential check for transcript
          if (transcriptData) {
            transcriptData.credential_checks!.push({
              provider_id: provider.provider_id,
              pubkey_b58: providerPubkey,
              ok: false,
              code: "PROVIDER_CREDENTIAL_INVALID",
              reason: "Credential signature verification failed",
            });
          }
          continue;
        }
        
        // Verify credential signer matches provider pubkey
        if (credentialEnvelope.signer_public_key_b58 !== providerPubkey) {
          const code = "PROVIDER_SIGNER_MISMATCH" as DecisionCode;
          failureCodes.push(code);
          pushDecision(
            provider,
            "identity",
            false,
            code,
            "Credential signer does not match provider pubkey",
            explainLevel === "full" ? {
              reason: "credential_signer_mismatch",
              expected: providerPubkey,
              actual: credentialEnvelope.signer_public_key_b58,
            } : undefined
          );
          continue;
        }
        
        // Parse credential message
        const credentialMsg = credentialEnvelope.message as any;
        
        // Verify credential is not expired
        const now = nowFunction();
        if (credentialMsg.expires_at_ms && credentialMsg.expires_at_ms < now) {
          const code = "PROVIDER_CREDENTIAL_INVALID" as DecisionCode;
          failureCodes.push(code);
          pushDecision(
            provider,
            "identity",
            false,
            code,
            "Credential expired",
            explainLevel === "full" ? {
              reason: "credential_expired",
              expires_at_ms: credentialMsg.expires_at_ms,
              now,
            } : undefined
          );
          continue;
        }
        
        // Verify credential supports requested intent type
        const capabilities = credentialMsg.capabilities || [];
        const supportsIntent = capabilities.some((cap: any) => cap.intentType === input.intentType);
        if (!supportsIntent && capabilities.length > 0) {
          const code = "PROVIDER_CREDENTIAL_INVALID" as DecisionCode;
          failureCodes.push(code);
          pushDecision(
            provider,
            "identity",
            false,
            code,
            `Credential does not support intent type: ${input.intentType}`,
            explainLevel === "full" ? {
              reason: "credential_intent_not_supported",
              requested: input.intentType,
              available: capabilities.map((cap: any) => cap.intentType),
            } : undefined
          );
          continue;
        }
        
        // Credential verified successfully - mark for V2 scoring
        credentialPresent = true;
        const matchedCapability = capabilities.find((cap: any) => cap.intentType === input.intentType);
        if (matchedCapability) {
          credentialClaims = {
            credentials: matchedCapability.credentials || [],
            region: matchedCapability.region || provider.region,
            modes: matchedCapability.modes || [],
          };
        }
        
        // Compute trust score (only if credential present)
        const baseTrustConfigForTrust = compiled.trustConfig!;
        if (credentialPresent) {
          trustResult = computeCredentialTrustScore({
            credential: {
              issuer: credentialMsg.issuer || "self",
              claims: matchedCapability?.credentials || [],
              region: matchedCapability?.region || provider.region,
              modes: matchedCapability?.modes || [],
            },
            claims: matchedCapability?.credentials || [],
            requestContext: {
              region: (input.constraints as any)?.region,
              settlementMode: chosenMode,
            },
            policyTrustConfig: baseTrustConfigForTrust,
          });
        }
        
        // Provider eligible - log trust score for full explain
        if (explainLevel === "full" && credentialPresent && trustResult) {
          pushDecision(
            provider,
            "identity",
            true,
            "PROVIDER_CREDENTIAL_TRUST_SCORE",
            `Credential trust score: ${trustResult.trust_score.toFixed(3)} (${trustResult.tier})`,
            {
              trust_score: trustResult.trust_score,
              tier: trustResult.tier,
              issuer: trustResult.issuer,
              reasons: trustResult.reasons,
            }
          );
        }
        
        // Store trust score and tier in evaluation context (for selection and reputation)
        if (credentialPresent && trustResult) {
          (provider as any)._trustScore = trustResult.trust_score;
          (provider as any)._trustTier = trustResult.tier;
        } else {
          (provider as any)._trustScore = 0;
          (provider as any)._trustTier = "untrusted";
        }
        
        // Collect successful credential check for transcript
        if (transcriptData && trustResult) {
          transcriptData.credential_checks!.push({
            provider_id: provider.provider_id,
            pubkey_b58: providerPubkey,
            ok: true,
            credential_summary: {
              signer_public_key_b58: credentialEnvelope.signer_public_key_b58,
              expires_at_ms: credentialMsg.expires_at_ms,
              capabilities: capabilities,
            },
            trust_score: trustResult.trust_score,
            trust_tier: trustResult.tier,
          });
        }
        
        // Credential verified successfully (no decision log entry for success, only failures)
      } catch (error: any) {
        // Credential fetch failed (provider may not support credential endpoint)
        // For v1.5, we allow graceful degradation: if credential endpoint doesn't exist (404),
        // continue without credential verification (backward compatibility)
        if (error.message?.includes("404") || error.message?.includes("Not found")) {
          // Credential endpoint not found - allow legacy providers (backward compatibility)
          // Don't log decision for 404 (graceful degradation)
          // credentialPresent remains false
        } else {
          // Other errors (network, parse) - reject provider
          const code = "PROVIDER_CREDENTIAL_INVALID" as DecisionCode;
          failureCodes.push(code);
          pushDecision(
            provider,
            "identity",
            false,
            code,
            `Credential fetch failed: ${error.message}`,
            explainLevel === "full" ? {
              reason: "credential_fetch_error",
              error: error.message,
            } : undefined
          );
          continue; // Skip provider if credential fetch fails (except 404)
        }
      }
    }
    
    // Get buyer overrides and merge with policy trust config (after credential verification attempt)
    const baseTrustConfig = compiled.trustConfig!;
    const requireCredential = input.requireCredential ?? baseTrustConfig.require_credential;
    
    // Check requireCredential (after credential verification attempt, whether success or 404)
    if (requireCredential && !credentialPresent) {
      const code = "PROVIDER_CREDENTIAL_REQUIRED" as DecisionCode;
      failureCodes.push(code);
      pushDecision(
        provider,
        "identity",
        false,
        code,
        "Credential required but provider does not present one",
        explainLevel === "full" ? {
          require_credential: requireCredential,
        } : undefined
      );
      continue;
    }
    
    // Get remaining trust config overrides
    const requireTrustedIssuer = baseTrustConfig.require_trusted_issuer; // Buyer override not provided for this
    const minTrustTier = input.minTrustTier ?? baseTrustConfig.min_trust_tier;
    const minTrustScore = input.minTrustScore ?? baseTrustConfig.min_trust_score;
    
    // Trust result was computed above if credentialPresent, otherwise it's null
    // If no credential, trust tier/score checks don't apply (already passed requireCredential check)
    if (credentialPresent && trustResult) {
      // 2. Check require_trusted_issuer
      if (requireTrustedIssuer && !baseTrustConfig.trusted_issuers.includes(trustResult.issuer)) {
        const code = "PROVIDER_ISSUER_UNTRUSTED" as DecisionCode;
        failureCodes.push(code);
        pushDecision(
          provider,
          "identity",
          false,
          code,
          `Issuer "${trustResult.issuer}" not in trusted issuers list`,
          explainLevel === "full" ? {
            issuer: trustResult.issuer,
            trusted_issuers: baseTrustConfig.trusted_issuers,
          } : undefined
        );
        continue;
      }
      
      // 3. Check trust tier
      // Tier ordering: untrusted < low < trusted
      const tierOrder: Record<"untrusted" | "low" | "trusted", number> = {
        untrusted: 0,
        low: 1,
        trusted: 2,
      };
      if (tierOrder[trustResult.tier] < tierOrder[minTrustTier]) {
        const code = "PROVIDER_TRUST_TIER_TOO_LOW" as DecisionCode;
        failureCodes.push(code);
        pushDecision(
          provider,
          "identity",
          false,
          code,
          `Trust tier "${trustResult.tier}" below minimum "${minTrustTier}"`,
          explainLevel === "full" ? {
            tier: trustResult.tier,
            min_trust_tier: minTrustTier,
            trust_score: trustResult.trust_score,
          } : undefined
        );
        continue;
      }
      
      // 4. Check trust score
      if (trustResult.trust_score < minTrustScore) {
        const code = "PROVIDER_TRUST_SCORE_TOO_LOW" as DecisionCode;
        failureCodes.push(code);
        pushDecision(
          provider,
          "identity",
          false,
          code,
          `Credential trust score ${trustResult.trust_score.toFixed(3)} below minimum ${minTrustScore}`,
          explainLevel === "full" ? {
            trust_score: trustResult.trust_score,
            min_trust_score: minTrustScore,
            tier: trustResult.tier,
            reasons: trustResult.reasons,
          } : undefined
        );
        continue;
      }
    }
    
    // Store trust score and tier for routing (even if no credential, default to untrusted/0)
    if (!credentialPresent || !trustResult) {
      (provider as any)._trustScore = 0;
      (provider as any)._trustTier = "untrusted";
    }

    // Generate or fetch quote price
    let askPrice: number;
    let latencyMs: number;
    
    if (provider.endpoint) {
      // HTTP provider: fetch signed quote envelope from endpoint
      try {
        const quoteResponse = await fetchQuote(provider.endpoint, {
          intent_id: `temp-${nowFunction()}`, // Temporary ID for quote request
          intent_type: input.intentType,
          max_price: input.maxPrice,
          constraints: input.constraints,
          urgent: input.urgent,
        });
        
        // Verify envelope signature (synchronous function)
        const quoteVerified = verifyEnvelope(quoteResponse.envelope);
        if (!quoteVerified) {
          // Invalid signature, skip this provider
          const code = "PROVIDER_SIGNATURE_INVALID" as DecisionCode;
          failureCodes.push(code);
          pushDecision(
            provider,
            "quote",
            false,
            code,
            "Quote envelope signature verification failed"
          );
          // Collect failed quote for transcript
          if (transcriptData) {
            transcriptData.quotes!.push({
              provider_id: provider.provider_id,
              pubkey_b58: providerPubkey,
              ok: false,
              code: "PROVIDER_SIGNATURE_INVALID",
              reason: "Quote envelope signature verification failed",
            });
          }
          continue;
        }
        
        // Parse envelope to get message
        let parsed;
        try {
          parsed = await parseEnvelope(quoteResponse.envelope);
        } catch (error: any) {
          const code = "PROVIDER_QUOTE_PARSE_ERROR" as DecisionCode;
          failureCodes.push(code);
          pushDecision(
            provider,
            "quote",
            false,
            code,
            `Failed to parse quote envelope: ${error.message}`,
            explainLevel === "full" ? { error: error.message } : undefined
          );
          continue;
        }
        
        // Know Your Agent: verify signer matches provider pubkey
        const signerMatches = parsed.signer_public_key_b58 === providerPubkey;
        if (!signerMatches) {
          // Signer doesn't match directory pubkey, skip this provider
          const code = "PROVIDER_SIGNER_MISMATCH" as DecisionCode;
          failureCodes.push(code);
          pushDecision(
            provider,
            "quote",
            false,
            code,
            `Signer ${parsed.signer_public_key_b58.substring(0, 8)} does not match provider ${providerPubkey.substring(0, 8)}`
          );
          continue;
        }
        
        // Use verified ASK message from envelope
        if (parsed.message.type !== "ASK") {
          const code = "PROVIDER_QUOTE_INVALID" as DecisionCode;
          failureCodes.push(code);
          pushDecision(
            provider,
            "quote",
            false,
            code,
            `Expected ASK message, got ${parsed.message.type}`
          );
          continue; // Invalid message type
        }
        
        askPrice = parsed.message.price;
        latencyMs = parsed.message.latency_ms;
        
        // Store the verified envelope for later use
        (provider as any)._verifiedAskEnvelope = quoteResponse.envelope;
        
        // Collect successful quote for transcript
        if (transcriptData) {
          transcriptData.quotes!.push({
            provider_id: provider.provider_id,
            pubkey_b58: providerPubkey,
            ok: true,
            signer_pubkey_b58: parsed.signer_public_key_b58,
            quote_summary: {
              quote_price: askPrice,
              reference_price_p50: referenceP50,
              valid_for_ms: parsed.message.valid_for_ms,
              is_firm_quote: (parsed.message as any).is_firm_quote,
              urgent: (parsed.message as any).urgent,
            },
          });
        }
      } catch (error: any) {
        // HTTP provider failed, skip this provider
        const code = "PROVIDER_QUOTE_HTTP_ERROR" as DecisionCode;
        failureCodes.push(code);
        pushDecision(
          provider,
          "quote",
          false,
          code,
          `HTTP error fetching quote: ${error.message}`,
          explainLevel === "full" ? { error: error.message } : undefined
        );
        continue;
      }
    } else {
      // Check if endpoint is required but missing
      // (This would be determined by policy, but for now we'll skip this check as it's handled elsewhere)
      // Local/simulated provider: generate deterministic quote
      const providerHash = providerPubkey.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const priceVariation = (providerHash % 20) / 1000; // 0-0.02 variation
      const basePrice = Math.min(input.maxPrice * 0.8, input.maxPrice);
      askPrice = basePrice * (1 - priceVariation);
      latencyMs = provider.baseline_latency_ms ?? input.constraints.latency_ms;
      
      // Collect local quote for transcript
      if (transcriptData) {
        transcriptData.quotes!.push({
          provider_id: provider.provider_id,
          pubkey_b58: providerPubkey,
          ok: true,
          quote_summary: {
            quote_price: askPrice,
            reference_price_p50: referenceP50,
            valid_for_ms: 20000,
            is_firm_quote: true,
            urgent: input.urgent,
          },
        });
      }
    }

    // Build negotiation context (same shape as policy vectors)
    // Note: intentNow will be set when we create the session
    const intentNowEstimate = nowFunction() - 1000; // Estimate - will be set properly later
    const negotiationCtx: NegotiationContext = {
      now_ms: askNow,
      intent_type: input.intentType,
      round: 1, // First round
      elapsed_ms: askNow - intentNowEstimate,
      message_type: "ASK",
      valid_for_ms: 20000,
      is_firm_quote: true,
      quote_price: askPrice,
      reference_price_p50: referenceP50,
      urgent: input.urgent || false,
      counterparty: {
        reputation: sellerReputation,
        age_ms: 1_000_000,
        region: provider.region ?? "us-east",
        has_required_credentials: hasAllCreds,
        failure_rate: 0,
        timeout_rate: 0,
        is_new: false,
      },
    };

    // Check negotiation phase (side-effect free, no session)
    const negotiationCheck = guard.check("negotiation", negotiationCtx, input.intentType);
    if (!negotiationCheck.ok) {
      // Log policy rejection
      // Check if it's an out-of-band rejection by checking if price is outside the band
      const isOutOfBand = askPrice > (referenceP50 * 1.5) || askPrice < (referenceP50 * 0.5);
      const reasonText = `Policy check failed: ${negotiationCheck.code}`;
      pushDecision(
        provider,
        "policy",
        false,
        isOutOfBand ? "PROVIDER_QUOTE_OUT_OF_BAND" : "PROVIDER_QUOTE_POLICY_REJECTED",
        reasonText,
        explainLevel === "full" ? {
          code: negotiationCheck.code,
          quote_price: askPrice,
          reference_price_p50: referenceP50,
          urgent: input.urgent || false,
        } : undefined
      );
      continue; // Skip provider that fails negotiation check
    }
    
    // Provider passed all checks - count as eligible
    if (explain) {
      explain.providers_eligible = (explain.providers_eligible || 0) + 1;
    }

    // Recompute reputation for utility calculation (V2 if enabled and credential verified, otherwise keep V1)
    if (store && input.useReputationV2 && credentialPresent) {
      // Use V2 scoring with credential context for utility calculation
      const trustScore = (provider as any)._trustScore || 0;
      const scoreV2 = agentScoreV2(providerPubkey, store.list({ agentId: providerPubkey }), {
        credentialPresent: true,
        credentialClaims,
        intentType: input.intentType,
        trustScore, // Pass trust score to reputation v2
      } as any);
      sellerReputation = scoreV2.reputation;
    }

    // Compute utility score (lower is better)
    // utility = price + 0.00000001 * latency_ms + 0.001 * failureRate - 0.000001 * reputation
    // Add trust-aware routing bonus: small monotonic bonus for higher tier/score
    // +0.02 for low tier, +0.05 for trusted tier, plus +0.02 * trust_score
    // This influences tie-breaks but doesn't dominate price/latency
    const trustScore = (provider as any)._trustScore || 0;
    const trustTier = (provider as any)._trustTier || "untrusted";
    let trustBonus = 0;
    if (trustTier === "trusted") {
      trustBonus = -0.05; // +0.05 bonus (negative because lower utility is better)
    } else if (trustTier === "low") {
      trustBonus = -0.02; // +0.02 bonus
    }
    trustBonus -= 0.02 * trustScore; // Additional score-based bonus
    const utility = askPrice +
      0.00000001 * latencyMs +
      0.001 * 0 - // failure_rate
      0.000001 * sellerReputation +
      trustBonus;

    evaluations.push({
      provider,
      providerPubkey,
      askPrice,
      utility,
      sellerReputation,
      hasRequiredCredentials: hasAllCreds,
      latencyMs,
    });
  }

  // Select best quote (lowest utility)
  if (evaluations.length === 0) {
    // Choose highest priority failure code
    // Priority: UNTRUSTED_ISSUER > PROVIDER_SIGNATURE_INVALID > PROVIDER_SIGNER_MISMATCH > 
    //           PROVIDER_MISSING_REQUIRED_CREDENTIALS > PROVIDER_QUOTE_HTTP_ERROR > NO_ELIGIBLE_PROVIDERS
    let finalCode: string = "NO_ELIGIBLE_PROVIDERS";
    if (failureCodes.includes("PROVIDER_UNTRUSTED_ISSUER")) {
      finalCode = "UNTRUSTED_ISSUER";
    } else if (failureCodes.includes("PROVIDER_SIGNATURE_INVALID")) {
      finalCode = "PROVIDER_SIGNATURE_INVALID";
    } else if (failureCodes.includes("PROVIDER_SIGNER_MISMATCH")) {
      finalCode = "PROVIDER_SIGNER_MISMATCH";
    } else if (failureCodes.includes("PROVIDER_MISSING_REQUIRED_CREDENTIALS")) {
      finalCode = "PROVIDER_MISSING_REQUIRED_CREDENTIALS";
    } else if (failureCodes.includes("PROVIDER_QUOTE_HTTP_ERROR")) {
      finalCode = "PROVIDER_QUOTE_HTTP_ERROR";
    }
    
    if (explain) {
      explain.regime = plan.regime;
      explain.settlement = chosenMode;
      explain.fanout = plan.fanout;
      explain.providers_eligible = 0;
      explain.log.push({
        provider_id: "",
        pubkey_b58: "",
        step: "selection",
        ok: false,
        code: "NO_ELIGIBLE_PROVIDERS" as DecisionCode,
        reason: "No providers passed all policy checks",
        ts_ms: nowFunction(),
      });
    }
    // Build and write transcript for error case
    let transcriptPath: string | undefined;
    if (saveTranscript && transcriptData) {
      // Generate intent_id for error case
      const errorIntentId = `error-${nowFunction()}`;
      transcriptData.intent_id = errorIntentId;
      transcriptData.explain = explain || undefined;
      transcriptData.outcome = {
        ok: false,
        code: finalCode,
        reason: finalCode === "UNTRUSTED_ISSUER" ? "All providers failed trusted issuer validation" : "No eligible providers",
      };
      
      // Finalize settlement lifecycle metadata for error case (v1.6.3+)
      if (transcriptData.settlement_lifecycle) {
        // If there were lifecycle errors, ensure status reflects that
        if (transcriptData.settlement_lifecycle.errors && transcriptData.settlement_lifecycle.errors.length > 0) {
          // Status may be set by error recording, but ensure it's consistent
          if (!transcriptData.settlement_lifecycle.status) {
            transcriptData.settlement_lifecycle.status = "aborted";
            transcriptData.settlement_lifecycle.aborted_at_ms = nowFn ? nowFn() : Date.now();
          }
        }
      }
      
      const transcriptStore = new TranscriptStore(input.transcriptDir);
      transcriptPath = await transcriptStore.writeTranscript(errorIntentId, transcriptData as TranscriptV1);
    }
    
    const errorResult: AcquireResult = {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
        offers_considered: candidates.length,
      },
      code: finalCode,
      reason: finalCode === "UNTRUSTED_ISSUER" ? "All providers failed trusted issuer validation" : "No eligible providers",
      offers_eligible: 0,
      ...(explain ? { explain } : {}),
      ...(transcriptPath ? { transcriptPath } : {}),
    };
    return errorResult;
  }

  evaluations.sort((a, b) => a.utility - b.utility);
  const bestQuote = evaluations[0];
  const selectedProvider = bestQuote.provider;
  const selectedProviderPubkey = bestQuote.providerPubkey;
  
  // Collect selection for transcript
  if (transcriptData) {
    transcriptData.selection = {
      selected_provider_id: selectedProvider.provider_id,
      selected_pubkey_b58: selectedProviderPubkey,
      reason: "Lowest utility score",
      utility_score: bestQuote.utility,
      alternatives_considered: evaluations.length,
    };
  }
  const selectedAskPrice = bestQuote.askPrice;
  
  // Log provider selection
  if (explain) {
    pushDecision(
      selectedProvider,
      "selection",
      true,
      "PROVIDER_SELECTED",
      `Selected provider with best utility score`,
      explainLevel === "full" ? {
        utility: bestQuote.utility,
        price: selectedAskPrice,
        latency_ms: bestQuote.latencyMs,
        reputation: bestQuote.sellerReputation,
      } : undefined
    );
    explain.selected_provider_id = selectedProvider.provider_id;
  }
  
  // Apply policy-driven settlement provider routing if needed (B1)
  // Only apply if caller did NOT pass settlement instance AND input.settlement.provider is undefined
  if (!settlement) {
    // Determine routing context from selected provider and negotiation state
    const routingAmount = selectedAskPrice; // Use selected quote price as amount estimate
    const routingMode = chosenMode;
    // Extract trust information from provider (set during evaluation phase)
    const providerTrustTier = (selectedProvider as any)._trustTier;
    const routingTrustTier: "untrusted" | "low" | "trusted" = 
      (providerTrustTier === "low" || providerTrustTier === "trusted") ? providerTrustTier : "untrusted";
    const routingTrustScore = (selectedProvider as any)._trustScore ?? 0;
    
    // Apply routing
    settlementRoutingResult = selectSettlementProvider(compiled, {
      amount: routingAmount,
      mode: routingMode,
      trustTier: routingTrustTier,
      trustScore: routingTrustScore,
    });
    
    // Create settlement provider based on routing result
    try {
      // Set input.settlement.provider so factory creates the chosen provider
      if (!input.settlement) {
        input.settlement = {};
      }
      input.settlement.provider = settlementRoutingResult.provider as "mock" | "stripe_like" | "external";
      
      settlement = createSettlementProvider({
        provider: settlementRoutingResult.provider as "mock" | "stripe_like" | "external",
        params: input.settlement.params,
        idempotency_key: input.settlement.idempotency_key,
      });
      
      // Record routing decision in transcript
      if (transcriptData) {
        if (!transcriptData.settlement_lifecycle) {
          transcriptData.settlement_lifecycle = {
            provider: settlementRoutingResult.provider,
            idempotency_key: input.settlement?.idempotency_key,
            errors: [],
          };
        } else {
          transcriptData.settlement_lifecycle.provider = settlementRoutingResult.provider;
        }
        // Store routing metadata (use validated/clamped values that were actually used for routing)
        (transcriptData.settlement_lifecycle as any).routing = {
          matched_rule_index: settlementRoutingResult.matchedRuleIndex,
          reason: settlementRoutingResult.reason,
          context: {
            amount: routingAmount, // Already validated (finite and non-negative) by routing function
            mode: routingMode,
            trust_tier: routingTrustTier, // Already validated (defaults to "untrusted" if invalid)
            trust_score: Math.max(0.0, Math.min(1.0, routingTrustScore)), // Clamp to [0.0, 1.0] to match routing function behavior
          },
        };
      }
    } catch (error: any) {
      // Handle factory creation errors
      const errorMsg = error?.message || String(error);
      // Defensive: settlementRoutingResult should be defined at this point, but check for safety
      const selectedProviderName = settlementRoutingResult?.provider ?? "unknown";
      recordLifecycleError("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED", `Settlement provider routing selected "${selectedProviderName}" but creation failed: ${errorMsg}`);
      
      return {
        ok: false,
        code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
        reason: `Settlement provider routing selected "${selectedProviderName}" but creation failed: ${errorMsg}`,
        explain: explain || undefined,
      };
    }
  }
  
  // Track verification status for HTTP providers (for demo output)
  let verification: {
    quoteVerified: boolean;
    signerMatched: boolean;
    commitVerified?: boolean;
    revealVerified?: boolean;
  } | undefined;

  // 7) Resolve seller keypair using normalized pubkey
  // For HTTP providers, we don't need the seller keypair (they sign their own messages)
  // For local providers, use the provided keypair
  const selectedSellerKp = selectedProvider.endpoint 
    ? params.sellerKeyPair // HTTP providers don't need specific keypair mapping
    : (params.sellerKeyPairsByPubkeyB58?.[selectedProviderPubkey] ?? params.sellerKeyPair);

  // 8) Create NegotiationSession with selected provider's pubkey
  const session = new NegotiationSession({
    compiledPolicy: compiled,
    guard,
    now: nowFunction,
    role: "buyer",
    intentType: input.intentType,
    settlement,
    buyerAgentId: buyerId,
    sellerAgentId: selectedProviderPubkey, // Use selected provider's pubkey
    // v1.7.2+: Settlement lifecycle configuration
    settlementIdempotencyKey: input.settlement?.idempotency_key,
    settlementAutoPollMs: input.settlement?.auto_poll_ms,
  });

  // 8.5) Check buyer identity (if policy requires it)
  const buyerCredentials = input.identity?.buyer?.credentials || [];
  const buyerIssuers = input.identity?.buyer?.issuer_ids || [];
  const buyerIdentityCtx: IdentityContext = {
    agent_id: buyerId,
    credentials: [
      ...buyerCredentials.map(type => ({ type, issuer: buyerIssuers[0] || "default" })),
      ...buyerIssuers.map(issuer => ({ type: "verified", issuer })),
    ],
    is_new_agent: false,
    reputation: store ? (() => {
      const score = agentScore(buyerId, store.list({ agentId: buyerId }));
      return score.reputation;
    })() : 0.5,
  };

  // Buyer identity check: only check non-credential requirements (reputation, region, etc.)
  // Credential requirements in counterparty section only apply to sellers
  const buyerIdentityCheck = guard.check("identity", buyerIdentityCtx);
  if (!buyerIdentityCheck.ok) {
    // For buyers, only fail on non-credential checks (reputation, region, etc.)
    // Credential requirements are for sellers only
    if (buyerIdentityCheck.code === "MISSING_REQUIRED_CREDENTIALS") {
      // Skip credential check for buyers - credentials are seller requirements
      // Only fail on other identity checks
    } else {
      return {
        ok: false,
        plan: {
          ...plan,
          overrideActive,
        },
        code: buyerIdentityCheck.code,
        reason: "Buyer identity check failed",
      };
    }
  }

  // 9) Build and sign INTENT envelope
  const intentId = `intent-${nowFunction()}`;
  const intentNow = nowFunction();
  const intentMsg = {
    protocol_version: "pact/1.0" as const,
    type: "INTENT" as const,
    intent_id: intentId,
    intent: input.intentType,
    scope: input.scope,
    constraints: input.constraints,
    max_price: input.maxPrice,
    settlement_mode: (chosenMode === "streaming" ? "streaming" : "hash_reveal") as SettlementMode,
    urgent: input.urgent || false,
    sent_at_ms: intentNow,
    expires_at_ms: intentNow + 60000,
  };

  const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
  const intentResult = await session.openWithIntent(intentEnvelope);

  if (!intentResult.ok) {
    if (explain) {
      explain.regime = plan.regime;
      explain.settlement = chosenMode;
      explain.fanout = plan.fanout;
    }
    return {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
      },
      code: intentResult.code,
      reason: intentResult.reason || "Failed to open intent",
      ...(explain ? { explain } : {}),
    };
  }

  // 10) Compute seller bond requirement deterministically from policy
  const bonding = compiled.base.economics.bonding;
  const sellerBondRequired = Math.max(
    bonding.seller_min_bond,
    selectedAskPrice * bonding.seller_bond_multiple
  );

  // 10.5) Ensure buyer and seller have enough balance (v1 simulation: top-up if needed)
  // This is needed especially when routing creates a new empty settlement provider
  try {
    // Credit buyer if needed (buyer needs balance to lock payment amount)
    const buyerBal = settlement.getBalance(buyerId);
    const paymentAmount = selectedAskPrice;
    const buyerBufferAmount = 0.1; // Buffer for tests/demo to ensure sufficient balance
    if (buyerBal < paymentAmount) {
      // v1: top-up buyer so lock can succeed during tests/demo
      settlement.credit(buyerId, paymentAmount - buyerBal + buyerBufferAmount);
    }
    
    // Credit seller if needed (seller needs balance for bond)
    const sellerBal = settlement.getBalance(selectedProviderPubkey);
    if (sellerBal < sellerBondRequired) {
      // v1: top-up seller so lockBond can succeed during tests/demo
      settlement.credit(selectedProviderPubkey, sellerBondRequired - sellerBal);
    }
  } catch (error: any) {
    // Handle settlement provider errors (e.g., ExternalSettlementProvider NotImplemented)
    const errorMsg = error?.message || String(error);
    if (errorMsg.includes("NotImplemented") || errorMsg.includes("ExternalSettlementProvider")) {
      recordLifecycleError("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED", `Settlement operation (credit) failed: ${errorMsg}`);
      if (explain) {
        pushDecision(
          selectedProvider,
          "settlement",
          false,
          "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
          `Settlement provider not implemented: ${errorMsg}`,
          explainLevel === "full" ? { error: errorMsg } : undefined
        );
      }
      return {
        ok: false,
        code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
        reason: `Settlement provider not implemented: ${errorMsg}`,
        explain: explain || undefined,
      };
    }
    // Re-throw other errors
    throw error;
  }

  // 11) Build and sign ASK envelope for selected provider
  // For HTTP providers, extract quote data from verified envelope and create new ASK with correct intent_id
  // For local providers, sign a new ASK message
  let askEnvelope;
  if (selectedProvider.endpoint) {
    // HTTP provider: extract quote data from verified envelope and create new ASK
    if ((selectedProvider as any)._verifiedAskEnvelope) {
      const verifiedEnvelope = (selectedProvider as any)._verifiedAskEnvelope;
      
      // Track verification status for HTTP provider
      try {
        const quoteVerified = verifyEnvelope(verifiedEnvelope);
        const parsed = await parseEnvelope(verifiedEnvelope);
        const signerMatched = parsed.signer_public_key_b58 === selectedProviderPubkey;
        
        verification = {
          quoteVerified,
          signerMatched,
        };
        
        // Extract quote data from verified envelope and create new ASK with correct intent_id
        // This ensures the envelope is properly signed and the intent_id matches the session
        if (parsed.message.type !== "ASK") {
          throw new Error(`Expected ASK message, got ${parsed.message.type}`);
        }
        const askMsg = {
          protocol_version: "pact/1.0" as const,
          type: "ASK" as const,
          intent_id: intentId, // Use session's intent_id
          price: parsed.message.price, // Use price from verified quote
          unit: parsed.message.unit ?? "request" as const,
          latency_ms: parsed.message.latency_ms,
          valid_for_ms: parsed.message.valid_for_ms ?? 20000,
          bond_required: sellerBondRequired,
          sent_at_ms: askNow,
          expires_at_ms: askNow + (parsed.message.valid_for_ms ?? 20000),
        };
        // Sign with seller keypair (ASK messages are signed by the seller)
        askEnvelope = await signEnvelope(askMsg, selectedSellerKp);
      } catch (error) {
        // If verification fails, still track it
        verification = {
          quoteVerified: false,
          signerMatched: false,
        };
        
        // Fall back to using selectedAskPrice
        const askMsg = {
          protocol_version: "pact/1.0" as const,
          type: "ASK" as const,
          intent_id: intentId,
          price: selectedAskPrice,
          unit: "request" as const,
          latency_ms: bestQuote.latencyMs,
          valid_for_ms: 20000,
          bond_required: sellerBondRequired,
          sent_at_ms: askNow,
          expires_at_ms: askNow + 20000,
        };
        askEnvelope = await signEnvelope(askMsg, selectedSellerKp);
      }
    } else {
      // HTTP provider but no pre-verified envelope (edge case - shouldn't normally happen)
      // Still track that we attempted HTTP provider verification
      verification = {
        quoteVerified: false,
        signerMatched: false,
      };
      
      // Fall back to signing locally
      const askMsg = {
        protocol_version: "pact/1.0" as const,
        type: "ASK" as const,
        intent_id: intentId,
        price: selectedAskPrice,
        unit: "request" as const,
        latency_ms: bestQuote.latencyMs,
        valid_for_ms: 20000,
        bond_required: sellerBondRequired,
        sent_at_ms: askNow,
        expires_at_ms: askNow + 20000,
      };
      askEnvelope = await signEnvelope(askMsg, selectedSellerKp);
    }
  } else {
    // Local provider: sign a new ASK message
    const askMsg = {
      protocol_version: "pact/1.0" as const,
      type: "ASK" as const,
      intent_id: intentId,
      price: selectedAskPrice,
      unit: "request" as const,
      latency_ms: bestQuote.latencyMs,
      valid_for_ms: 20000,
      bond_required: sellerBondRequired,
      sent_at_ms: askNow,
      expires_at_ms: askNow + 20000,
    };
    askEnvelope = await signEnvelope(askMsg, selectedSellerKp);
    // verification remains undefined for local providers
  }
  const counterpartySummary = {
    agent_id: selectedProviderPubkey,
    reputation: bestQuote.sellerReputation,
    age_ms: 1_000_000,
    region: selectedProvider.region ?? "us-east",
    failure_rate: 0,
    timeout_rate: 0,
    is_new: false,
  };

  const askResult = await session.onQuote(askEnvelope, counterpartySummary, referenceP50);
  if (!askResult.ok) {
    if (explain) {
      explain.regime = plan.regime;
      explain.settlement = chosenMode;
      explain.fanout = plan.fanout;
      pushDecision(
        selectedProvider,
        "policy",
        false,
        "PROVIDER_QUOTE_POLICY_REJECTED",
        askResult.reason || "ASK rejected by policy",
        explainLevel === "full" ? { code: askResult.code } : undefined
      );
    }
    return {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
        offers_considered: evaluations.length,
      },
      code: askResult.code,
      reason: askResult.reason || "ASK rejected",
      offers_eligible: evaluations.length,
      ...(explain ? { explain } : {}),
    };
  }

  // 7) Build and sign ACCEPT envelope
  const acceptNow = nowFunction();
  const acceptMsg = {
    protocol_version: "pact/1.0" as const,
    type: "ACCEPT" as const,
    intent_id: intentId,
    agreed_price: selectedAskPrice,
    settlement_mode: (chosenMode === "streaming" ? "streaming" : "hash_reveal") as SettlementMode,
    proof_type: (chosenMode === "streaming" ? "streaming" : "hash_reveal") as SettlementMode,
    challenge_window_ms: 150,
    delivery_deadline_ms: acceptNow + 30000, // 30 seconds to allow for commit/reveal process
    sent_at_ms: acceptNow,
    expires_at_ms: acceptNow + 10000,
  };

  const acceptEnvelope = await signEnvelope(acceptMsg, buyerKeyPair);
  const acceptResult = await session.accept(acceptEnvelope);
  if (!acceptResult.ok) {
    // Record settlement lifecycle failure (v1.7.2+)
    // When commit returns pending and auto_poll is enabled, failure happens during poll
    if (acceptResult.code === "SETTLEMENT_FAILED" && transcriptData?.settlement_lifecycle) {
      recordLifecycleEvent("poll", "failed", {
        failure_code: acceptResult.code,
        failure_reason: acceptResult.reason || "Settlement failed during async processing",
      });
    }
    
    if (explain) {
      explain.regime = plan.regime;
      explain.settlement = chosenMode;
      explain.fanout = plan.fanout;
      pushDecision(
        selectedProvider,
        "settlement",
        false,
        "SETTLEMENT_FAILED",
        acceptResult.reason || "ACCEPT failed",
        explainLevel === "full" ? { code: acceptResult.code } : undefined
      );
    }
    
    // Save transcript for settlement failure (v1.7.2+)
    let transcriptPath: string | undefined;
    if (saveTranscript && transcriptData) {
      transcriptData.intent_id = intentId;
      transcriptData.explain = explain || undefined;
      transcriptData.outcome = {
        ok: false,
        code: acceptResult.code,
        reason: acceptResult.reason || "ACCEPT failed",
      };
      
      const transcriptStore = new TranscriptStore(input.transcriptDir);
      transcriptPath = await transcriptStore.writeTranscript(intentId, transcriptData as TranscriptV1);
    }
    
    return {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
      },
      code: acceptResult.code,
      reason: acceptResult.reason || "ACCEPT failed",
      offers_eligible: evaluations.length,
      ...(explain ? { explain } : {}),
      ...(transcriptPath ? { transcriptPath } : {}),
    };
  }

  const agreement = session.getAgreement();
  if (!agreement) {
    return {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
      },
      code: "NO_AGREEMENT",
      reason: "No agreement found after ACCEPT",
      offers_eligible: evaluations.length,
      ...(explain ? { explain } : {}),
    };
  }

  // 8) Execute settlement
  let receipt: Receipt | null = null;
  
  // Log settlement start
  if (explain) {
    pushDecision(
      selectedProvider,
      "settlement",
      true,
      "SETTLEMENT_STARTED",
      `Starting ${chosenMode} settlement`,
      explainLevel === "full" ? { settlement_mode: chosenMode } : undefined
    );
  }

  if (chosenMode === "hash_reveal") {
    // Hash-reveal settlement
    const commitNow = nowFunction();
    const payload = JSON.stringify({ data: "delivered", scope: input.scope });
    const nonce = Buffer.from(`nonce-${commitNow}`).toString("base64");
    const payloadB64 = Buffer.from(payload).toString("base64");
    
    let commitHash: string;
    let revealOk: boolean = false;
    
    if (selectedProvider.endpoint) {
      // HTTP provider: use /commit and /reveal endpoints (signed envelopes)
      try {
        // Call /commit endpoint to get signed COMMIT envelope
        const commitResponse = await fetchCommit(selectedProvider.endpoint, {
          intent_id: intentId,
          payload_b64: payloadB64,
          nonce_b64: nonce,
        });

        // Verify COMMIT envelope signature (synchronous)
        const commitVerified = verifyEnvelope(commitResponse.envelope);
        if (!commitVerified) {
          throw new Error("Invalid COMMIT envelope signature");
        }

        // Parse COMMIT envelope (async)
        const parsedCommit = await parseEnvelope(commitResponse.envelope);
        
        // Track commit verification status (will update reveal later)
        if (verification) {
          verification.commitVerified = commitVerified;
        }
        
        // Know Your Agent: verify signer matches provider pubkey
        if (parsedCommit.signer_public_key_b58 !== selectedProviderPubkey) {
          throw new Error("COMMIT envelope signer doesn't match provider pubkey");
        }

        if (parsedCommit.message.type !== "COMMIT") {
          throw new Error("Invalid COMMIT message type");
        }

        commitHash = parsedCommit.message.commit_hash_hex;
        
        // Feed verified COMMIT envelope into session
        const commitResult = await session.onCommit(commitResponse.envelope as SignedEnvelope<CommitMessage>);
        
        if (!commitResult.ok) {
          // Log settlement failure
          if (explain) {
            pushDecision(
              selectedProvider,
              "settlement",
              false,
              "SETTLEMENT_FAILED",
              commitResult.reason || "COMMIT failed",
              explainLevel === "full" ? { code: commitResult.code } : undefined
            );
          }
          
          return {
            ok: false,
            plan: {
              ...plan,
              overrideActive,
            },
            code: commitResult.code,
            reason: commitResult.reason || "COMMIT failed",
            offers_eligible: evaluations.length,
            ...(explain ? { explain } : {}),
          };
        }
        
        // Call /reveal endpoint to get signed REVEAL envelope
        const revealResponse = await fetchReveal(selectedProvider.endpoint, {
          intent_id: intentId,
          payload_b64: payloadB64,
          nonce_b64: nonce,
          commit_hash_hex: commitHash,
        });

        // Verify REVEAL envelope signature (synchronous)
        const revealVerified = verifyEnvelope(revealResponse.envelope);
        if (!revealVerified) {
          throw new Error("Invalid REVEAL envelope signature");
        }

        // Parse REVEAL envelope (async)
        const parsedReveal = await parseEnvelope(revealResponse.envelope);
        
        // Know Your Agent: verify signer matches provider pubkey
        if (parsedReveal.signer_public_key_b58 !== selectedProviderPubkey) {
          throw new Error("REVEAL envelope signer doesn't match provider pubkey");
        }

        if (parsedReveal.message.type !== "REVEAL") {
          throw new Error("Invalid REVEAL message type");
        }
        
        // Track commit and reveal verification status
        if (verification) {
          verification.commitVerified = true; // Already verified above
          verification.revealVerified = revealVerified;
        }
        
        if (!revealResponse.ok) {
          // Provider rejected reveal (hash mismatch)
          // Still feed the verified envelope to record the failure
          const revealResult = await session.onReveal(revealResponse.envelope as SignedEnvelope<RevealMessage>);
          
          // Log settlement failure
          if (explain) {
            pushDecision(
              selectedProvider,
              "settlement",
              false,
              "SETTLEMENT_FAILED",
              revealResponse.reason || "REVEAL failed",
              explainLevel === "full" ? { code: revealResponse.code || "FAILED_PROOF" } : undefined
            );
          }
          
          return {
            ok: false,
            plan: {
              ...plan,
              overrideActive,
            },
            code: revealResponse.code || "FAILED_PROOF",
            reason: revealResponse.reason || "REVEAL failed",
            agreed_price: agreement.agreed_price,
            ...(explain ? { explain } : {}),
          };
        }
        
        revealOk = true;
        
        // For HTTP providers, use the verified envelope from the provider
        // For local providers, sign a new REVEAL message
        let revealEnvelopeToUse: SignedEnvelope<RevealMessage>;
        if (selectedProvider.endpoint) {
          // HTTP provider: use the verified envelope from the provider
          revealEnvelopeToUse = revealResponse.envelope as SignedEnvelope<RevealMessage>;
        } else {
          // Local provider: sign a new REVEAL message
          const revealNow = nowFunction();
          const revealMsg = {
            protocol_version: "pact/1.0" as const,
            type: "REVEAL" as const,
            intent_id: intentId,
            payload_b64: payloadB64,
            nonce_b64: nonce,
            sent_at_ms: revealNow,
            expires_at_ms: revealNow + 10000,
          };
          revealEnvelopeToUse = await signEnvelope(revealMsg, selectedSellerKp);
        }
        
        const revealResult = await session.onReveal(revealEnvelopeToUse);
        
        if (!revealResult.ok) {
          return {
            ok: false,
            plan: {
              ...plan,
              overrideActive,
            },
            code: revealResult.code,
            reason: revealResult.reason || "REVEAL failed",
            offers_eligible: evaluations.length,
            ...(explain ? { explain } : {}),
          };
        }
      } catch (error: any) {
        return {
          ok: false,
          plan: {
            ...plan,
            overrideActive,
          },
          code: "HTTP_PROVIDER_ERROR",
          reason: `HTTP provider error: ${error.message}`,
          offers_eligible: evaluations.length,
          ...(explain ? { explain } : {}),
        };
      }
    } else {
      // Local provider: generate commit/reveal locally
      commitHash = computeCommitHash(payloadB64, nonce);

      const commitMsg = {
        protocol_version: "pact/1.0" as const,
        type: "COMMIT" as const,
        intent_id: intentId,
        commit_hash_hex: commitHash,
        sent_at_ms: commitNow,
        expires_at_ms: commitNow + 10000,
      };

      const commitEnvelope = await signEnvelope(commitMsg, selectedSellerKp);
      const commitResult = await session.onCommit(commitEnvelope);

      if (!commitResult.ok) {
        return {
          ok: false,
          plan: {
            ...plan,
            overrideActive,
          },
          code: commitResult.code,
          reason: commitResult.reason || "COMMIT failed",
          offers_eligible: evaluations.length,
          ...(explain ? { explain } : {}),
        };
      }

      const revealNow = nowFunction();
      const revealMsg = {
        protocol_version: "pact/1.0" as const,
        type: "REVEAL" as const,
        intent_id: intentId,
        payload_b64: payloadB64,
        nonce_b64: nonce,
        sent_at_ms: revealNow,
        expires_at_ms: revealNow + 10000,
      };

      const revealEnvelope = await signEnvelope(revealMsg, selectedSellerKp);
      const revealResult = await session.onReveal(revealEnvelope);

      if (!revealResult.ok) {
        return {
          ok: false,
          plan: {
            ...plan,
            overrideActive,
          },
          code: revealResult.code,
          reason: revealResult.reason || "REVEAL failed",
          offers_eligible: evaluations.length,
          ...(explain ? { explain } : {}),
        };
      }
    }

    receipt = session.getReceipt() ?? null;
  } else {
    // Streaming settlement
    const streamingPolicy = compiled.base.settlement.streaming;
    if (!streamingPolicy) {
      return {
        ok: false,
        plan: {
          ...plan,
          overrideActive,
        },
        code: "STREAMING_NOT_CONFIGURED",
        reason: "Streaming policy not configured",
      };
    }

    // Unlock what the agreement locked (pay-as-you-go)
      try {
        settlement.unlock(buyerId, agreement.agreed_price);
        settlement.unlock(selectedProviderPubkey, agreement.seller_bond);
      } catch (error: any) {
        // Handle settlement provider errors (e.g., ExternalSettlementProvider NotImplemented)
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes("NotImplemented") || errorMsg.includes("ExternalSettlementProvider")) {
          recordLifecycleError("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED", `Settlement operation (unlock) failed: ${errorMsg}`);
          if (explain) {
            pushDecision(
              selectedProvider,
              "settlement",
              false,
              "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
              `Settlement provider not implemented: ${errorMsg}`,
              explainLevel === "full" ? { error: errorMsg } : undefined
            );
          }
          return {
            ok: false,
            code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
            reason: `Settlement provider not implemented: ${errorMsg}`,
            explain: explain || undefined,
          };
        }
        // Re-throw other errors
        throw error;
      }

    const totalBudget = agreement.agreed_price;
    const tickMs = streamingPolicy.tick_ms;
    const plannedTicks = 50;

    // Create dedicated streaming clock that the exchange will use
    let streamNow = nowFunction(); // start from whatever nowFunction returns
    const streamNowFn = () => streamNow; // THIS is the clock exchange will use

    const exchange = new StreamingExchange({
      settlement,
      policy: compiled,
      now: streamNowFn, // Use dedicated streaming clock, not nowFunction
      buyerId,
      sellerId: selectedProviderPubkey,
      intentId,
      totalBudget,
      tickMs,
      plannedTicks,
    });

        try {
          exchange.start();
        } catch (error: any) {
          // Handle settlement provider errors from exchange.start()
          const errorMsg = error?.message || String(error);
          if (errorMsg.includes("NotImplemented") || errorMsg.includes("ExternalSettlementProvider")) {
            recordLifecycleError("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED", `Settlement operation (exchange.start) failed: ${errorMsg}`);
            if (explain) {
              pushDecision(
                selectedProvider,
                "settlement",
                false,
                "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
                `Settlement provider not implemented: ${errorMsg}`,
                explainLevel === "full" ? { error: errorMsg } : undefined
              );
            }
            return {
              ok: false,
              code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
              reason: `Settlement provider not implemented: ${errorMsg}`,
              explain: explain || undefined,
            };
          }
          // Re-throw other errors
          throw error;
        }

    for (let i = 1; i <= plannedTicks; i++) {
      streamNow += tickMs + 5; // Always advance the streaming clock
      const tickNow = streamNow;

      // Fetch exactly one chunk per tick: seq = i - 1
      const chunkSeq = i - 1;
      
      if (selectedProvider.endpoint) {
        // HTTP provider: fetch signed chunk envelope
        try {
          const chunkResponse = await fetchStreamChunk(selectedProvider.endpoint, {
            intent_id: intentId,
            seq: chunkSeq,
            sent_at_ms: tickNow,
          });
          
          // Verify envelope signature (synchronous)
          if (!verifyEnvelope(chunkResponse.envelope)) {
            if (explain) {
              pushDecision(
                selectedProvider,
                "settlement",
                false,
                "PROVIDER_SIGNATURE_INVALID",
                "Invalid STREAM_CHUNK envelope signature"
              );
            }
            return {
              ok: false,
              plan: {
                ...plan,
                overrideActive,
              },
              code: "FAILED_IDENTITY",
              reason: "Invalid STREAM_CHUNK envelope signature",
              offers_eligible: evaluations.length,
              ...(explain ? { explain } : {}),
            };
          }
          
          // Parse envelope (async)
          const parsed = await parseEnvelope(chunkResponse.envelope);
          
          // Know Your Agent: verify signer matches provider pubkey
          const chunkSignerMatches = parsed.signer_public_key_b58 === selectedProviderPubkey;
          if (!chunkSignerMatches) {
            if (explain) {
              pushDecision(
                selectedProvider,
                "settlement",
                false,
                "PROVIDER_SIGNER_MISMATCH",
                `STREAM_CHUNK envelope signer ${parsed.signer_public_key_b58.substring(0, 8)} doesn't match provider ${selectedProviderPubkey.substring(0, 8)}`
              );
            }
            return {
              ok: false,
              plan: {
                ...plan,
                overrideActive,
              },
              code: "PROVIDER_SIGNER_MISMATCH",
              reason: "STREAM_CHUNK envelope signer doesn't match provider pubkey",
              offers_eligible: evaluations.length,
              ...(explain ? { explain } : {}),
            };
          }
          
          // Type assertion: we know this is a STREAM_CHUNK from the HTTP endpoint
          const chunkMsg = parsed.message as any;
          if (chunkMsg.type !== "STREAM_CHUNK") {
            return {
              ok: false,
              plan: {
                ...plan,
                overrideActive,
              },
              code: "INVALID_MESSAGE_TYPE",
              reason: "Expected STREAM_CHUNK message",
            };
          }
          
          // Call onChunk with the verified chunk message
          exchange.onChunk(chunkMsg);
        } catch (error: any) {
          return {
            ok: false,
            plan: {
              ...plan,
              overrideActive,
            },
            code: "HTTP_STREAMING_ERROR",
            reason: `HTTP streaming error: ${error.message}`,
          };
        }
      } else {
        // Local provider: generate chunk locally
        exchange.onChunk({
          protocol_version: "pact/1.0",
          type: "STREAM_CHUNK",
          intent_id: intentId,
          seq: chunkSeq,
          chunk_b64: "AA==",
          sent_at_ms: tickNow,
          expires_at_ms: tickNow + 60000,
        });
      }

      // Then call tick() to process payment
      let tickResult;
      try {
        tickResult = exchange.tick();
      } catch (error: any) {
        // Handle settlement provider errors from exchange.tick()
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes("NotImplemented") || errorMsg.includes("ExternalSettlementProvider")) {
          recordLifecycleError("SETTLEMENT_PROVIDER_NOT_IMPLEMENTED", `Settlement operation (exchange.tick) failed: ${errorMsg}`);
          if (explain) {
            pushDecision(
              selectedProvider,
              "settlement",
              false,
              "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
              `Settlement provider not implemented: ${errorMsg}`,
              explainLevel === "full" ? { error: errorMsg } : undefined
            );
          }
          return {
            ok: false,
            code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
            reason: `Settlement provider not implemented: ${errorMsg}`,
            explain: explain || undefined,
          };
        }
        // Re-throw other errors
        throw error;
      }
      const state = exchange.getState();

      // Check for receipt (completion or failure) - natural exit
      if (tickResult.receipt) {
        receipt = tickResult.receipt;
        break;
      }

      // Only stop early if buyerStopAfterTicks is explicitly set and we've reached it
      if (typeof input.buyerStopAfterTicks === "number" && i === input.buyerStopAfterTicks) {
        receipt = exchange.stop("buyer", "Buyer requested stop");
        break;
      }
    }

    // If no receipt yet, create one based on final state
    if (!receipt) {
      const state = exchange.getState();
      const eps = 1e-12;

      if (state.paid_amount + eps >= totalBudget) {
        // Budget exhausted - fulfilled receipt
        receipt = createReceipt({
          intent_id: intentId,
          buyer_agent_id: buyerId,
          seller_agent_id: selectedProviderPubkey,
          agreed_price: totalBudget,
          fulfilled: true,
          timestamp_ms: nowFunction(),
          paid_amount: round8(state.paid_amount),
          ticks: state.ticks,
          chunks: state.chunks,
        });
      } else {
        // Stream completed naturally (all ticks processed) - fulfilled receipt
        receipt = createReceipt({
          intent_id: intentId,
          buyer_agent_id: buyerId,
          seller_agent_id: selectedProviderPubkey,
          agreed_price: round8(state.paid_amount), // Use actual paid amount
          fulfilled: true,
          timestamp_ms: nowFunction(),
          paid_amount: round8(state.paid_amount),
          ticks: state.ticks,
          chunks: state.chunks,
        });
      }
    }

    if (agreement) {
      (agreement as any).status = "COMPLETED";
    }
  }

  if (!receipt) {
    if (explain) {
      explain.regime = plan.regime;
      explain.settlement = chosenMode;
      explain.fanout = plan.fanout;
      pushDecision(
        selectedProvider,
        "settlement",
        false,
        "SETTLEMENT_FAILED",
        "No receipt generated after settlement"
      );
    }
    return {
      ok: false,
      plan: {
        ...plan,
        overrideActive,
      },
      code: "NO_RECEIPT",
      reason: "No receipt generated after settlement",
      offers_eligible: evaluations.length,
      ...(explain ? { explain } : {}),
    };
  }

  // Log settlement completion
  if (explain && receipt) {
    pushDecision(
      selectedProvider,
      "settlement",
      true,
      "SETTLEMENT_COMPLETED",
      `Settlement completed successfully`,
      explainLevel === "full" ? {
        receipt_id: (receipt as any).intent_id,
        fulfilled: (receipt as any).fulfilled,
      } : undefined
    );
  }

  // Ingest receipt into store if provided
  if (store && receipt) {
    (receipt as any).intent_type = input.intentType;
    store.ingest(receipt);
    
    // Log receipt ingestion
    if (explain) {
      pushDecision(
        selectedProvider,
        "settlement",
        true,
        "RECEIPT_INGESTED",
        "Receipt ingested into store"
      );
    }
  }
  
  // Finalize explain metadata
  if (explain) {
    explain.regime = plan.regime;
    explain.settlement = chosenMode;
    explain.fanout = plan.fanout;
  }

  const baseResult = {
    ok: true as const,
    plan: {
      regime: plan.regime,
      settlement: chosenMode,
      fanout: plan.fanout,
      maxRounds: plan.maxRounds,
      reason: plan.reason,
      overrideActive,
      selected_provider_id: selectedProvider.provider_id,
      offers_considered: evaluations.length,
    },
    intent_id: intentId,
    buyer_agent_id: buyerId,
    seller_agent_id: selectedProviderPubkey,
    receipt,
    offers_eligible: evaluations.length,
  };
  
  // Build and write transcript if requested
  let transcriptPath: string | undefined;
  if (saveTranscript && transcriptData) {
    transcriptData.intent_id = intentId;
    transcriptData.settlement = {
      mode: chosenMode,
      verification_summary: verification,
    };
    transcriptData.receipt = receipt;
    transcriptData.explain = explain || undefined;
    transcriptData.outcome = { ok: true };
    
    // Finalize settlement lifecycle metadata (v1.6.3+)
    if (transcriptData.settlement_lifecycle) {
      // If successful, record committed status and paid amount from receipt
      // v1.7.2+: Preserve pending status if async settlement is in progress
      if (receipt && receipt.fulfilled) {
        // Only update if not already set to pending (preserve async status)
        if (!transcriptData.settlement_lifecycle.status || 
            (transcriptData.settlement_lifecycle.status !== "pending" && 
             transcriptData.settlement_lifecycle.status !== "failed")) {
          transcriptData.settlement_lifecycle.status = "committed";
        }
        if (!transcriptData.settlement_lifecycle.committed_at_ms) {
          transcriptData.settlement_lifecycle.committed_at_ms = receipt.timestamp_ms || (nowFn ? nowFn() : Date.now());
        }
        if (!transcriptData.settlement_lifecycle.paid_amount) {
          transcriptData.settlement_lifecycle.paid_amount = receipt.paid_amount || (receipt as any).agreed_price || 0;
        }
      }
    }
    
    const transcriptStore = new TranscriptStore(input.transcriptDir);
    transcriptPath = await transcriptStore.writeTranscript(intentId, transcriptData as TranscriptV1);
  }
  
  const finalResult: AcquireResult = explain 
    ? { ...baseResult, explain, ...(verification ? { verification } : {}), ...(transcriptPath ? { transcriptPath } : {}) }
    : { ...baseResult, ...(verification ? { verification } : {}), ...(transcriptPath ? { transcriptPath } : {}) };
  return finalResult;
}

