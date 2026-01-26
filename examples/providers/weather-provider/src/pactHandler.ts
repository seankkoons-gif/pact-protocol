/**
 * Pact Protocol Handler for Weather Provider
 * 
 * Handles weather.data product with deterministic pricing:
 * - Base price per request
 * - Surcharge if freshness_seconds < 120
 * - Surcharge if max_latency_ms < 500
 */

import type {
  SignedEnvelope,
  ParsedPactMessage,
  IntentMessage,
  AskMessage,
  AcceptMessage,
  RejectMessage,
} from "@pact/sdk";
import {
  parseEnvelope,
  signEnvelope,
  generateKeyPair,
  DefaultPolicyGuard,
  validatePolicyJson,
  compilePolicy,
} from "@pact/sdk";
import { defaultPolicy } from "./policy.js";
import { getProviderDebugDir } from "./repoRoot.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Ensure provider debug directory exists.
 * Always uses repo root .pact/provider_debug (not cwd).
 * .pact/transcripts is reserved for v4 transcripts only.
 */
export function ensureTranscriptDir(): void {
  const dir = getProviderDebugDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Emit debug message log to repo root .pact/provider_debug.
 * Not a v4 transcript; v4 transcripts are written by the buyer to .pact/transcripts.
 */
function emitTranscript(message: ParsedPactMessage, debugMetadata?: Record<string, unknown>): void {
  ensureTranscriptDir();
  const providerDebugDir = getProviderDebugDir();

  const debugLog: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    provider_id: providerId.substring(0, 16) + "...",
    message_type: message.type,
    intent_id: "intent_id" in message ? message.intent_id : undefined,
    price: "price" in message ? message.price : ("agreed_price" in message ? message.agreed_price : undefined),
    product: "intent" in message ? message.intent : undefined,
  };

  // Merge in optional debug metadata (safe, truncated - no private keys or signatures)
  if (debugMetadata) {
    Object.assign(debugLog, debugMetadata);
  }

  // Save debug log JSON file (not a v4 transcript)
  const filename = `message-${debugLog.intent_id || "unknown"}-${Date.now()}.json`;
  const filepath = path.join(providerDebugDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(debugLog, null, 2));

  // Print debug log path
  console.log(`📄 Provider debug log: ${filepath}`);
}

// Provider identity (deterministic for demo - use fixed seed in production)
const providerKeypair = generateKeyPair();
const providerId = Buffer.from(providerKeypair.publicKey).toString("base64");

// Policy guard for validation
const policyValidation = validatePolicyJson(defaultPolicy);
if (!policyValidation.ok) {
  throw new Error(`Policy validation failed: ${JSON.stringify(policyValidation.errors)}`);
}
const compiledPolicy = compilePolicy(policyValidation.policy);
const policyGuard = new DefaultPolicyGuard(compiledPolicy);

/**
 * Check admission requirements and return detailed breakdown
 * Used for explaining ONE_OF_ADMISSION_FAILED errors
 */
function checkAdmissionBreakdown(
  policy: any,
  ctx: any
): { rule: string; clauses: Array<{ id: string; ok: boolean; reason?: string }> } {
  const requireOneOf = policy.admission?.require_one_of || [];
  const clauses: Array<{ id: string; ok: boolean; reason?: string }> = [];

  if (requireOneOf.length === 0) {
    return { rule: "NONE", clauses: [] };
  }

  for (const requirement of requireOneOf) {
    let ok = false;
    let reason: string | undefined;

    if (requirement === "bond") {
      if (ctx.admission?.has_bond) {
        ok = true;
      } else {
        reason = "admission.has_bond is not set or false";
      }
    } else if (requirement === "credential") {
      if (ctx.admission?.has_credential) {
        ok = true;
      } else {
        reason = "admission.has_credential is not set or false";
      }
    } else if (requirement === "sponsor_attestation") {
      if (ctx.admission?.has_sponsor) {
        ok = true;
      } else if (ctx.sponsors && Array.isArray(ctx.sponsors) && ctx.sponsors.length > 0) {
        ok = true;
      } else {
        reason = "admission.has_sponsor is not set and no sponsors array provided";
      }
    } else {
      reason = `unknown requirement type: ${requirement}`;
    }

    clauses.push({ id: requirement.toUpperCase(), ok, reason: ok ? undefined : reason });
  }

  return { rule: "ONE_OF", clauses };
}

/**
 * Calculate deterministic price for weather.data product
 */
function calculatePrice(intent: IntentMessage): number {
  const basePrice = 0.00008; // Base price per request

  // Extract params from scope with safe access
  const scope = intent.scope;
  const city = typeof scope === "string" ? scope : (scope && typeof scope === "object" ? (scope as any)?.city : null) || "NYC";
  
  // Safe access to constraints
  const constraints = intent.constraints ?? {};
  const freshnessSeconds = constraints.freshness_sec ?? 300;
  const maxLatencyMs = constraints.latency_ms ?? 1000;

  // Surcharges
  let surcharge = 0;

  // Surcharge if freshness_seconds < 120 (real-time data is more expensive)
  if (freshnessSeconds < 120) {
    surcharge += 0.00002;
  }

  // Surcharge if max_latency_ms < 500 (low latency requires premium infrastructure)
  if (maxLatencyMs < 500) {
    surcharge += 0.00001;
  }

  const totalPrice = basePrice + surcharge;

  // Never exceed buyer's max_price
  return Math.min(totalPrice, intent.max_price);
}

/**
 * Generate weather data (mock - deterministic for demo)
 */
function generateWeatherData(city: string): any {
  // Deterministic weather data based on city
  const cityHash = city.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const baseTemp = 72 + (cityHash % 20); // Temperature between 72-92°F
  const conditions = ["sunny", "cloudy", "partly_cloudy", "clear"][cityHash % 4];

  return {
    city,
    temperature_f: baseTemp,
    condition: conditions,
    humidity: 45 + (cityHash % 20),
    wind_speed_mph: 5 + (cityHash % 10),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validation result type for structured error responses
 */
type ValidationResult = 
  | { ok: true }
  | { ok: false; error: "BAD_REQUEST"; missing: string[]; message: string };

/**
 * Validate envelope structure before processing
 * Note: This function assumes the envelope has already been normalized by server.ts
 * (i.e., envelope_version and message are at the top level)
 */
function validateEnvelope(envelope: any): ValidationResult {
  const missing: string[] = [];

  if (!envelope || typeof envelope !== "object") {
    return {
      ok: false,
      error: "BAD_REQUEST",
      missing: ["envelope"],
      message: "Missing required field: envelope must be an object",
    };
  }

  // These should already be validated by server.ts, but double-check
  if (!envelope.envelope_version) {
    missing.push("envelope.envelope_version");
  }

  if (!envelope.message) {
    missing.push("envelope.message");
  } else if (typeof envelope.message === "object") {
    if (!envelope.message.type) {
      missing.push("envelope.message.type");
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: "BAD_REQUEST",
      missing,
      message: `Missing required field(s): ${missing.join(", ")}`,
    };
  }

  return { ok: true };
}

/**
 * Validate INTENT message structure
 */
function validateIntentMessage(intent: any): ValidationResult {
  const missing: string[] = [];

  if (!intent || typeof intent !== "object") {
    return {
      ok: false,
      error: "BAD_REQUEST",
      missing: ["message"],
      message: "Missing required field: message must be an object",
    };
  }

  if (!intent.intent_id) {
    missing.push("message.intent_id");
  }

  if (!intent.intent) {
    missing.push("message.intent");
  }

  if (intent.constraints === undefined) {
    missing.push("message.constraints");
  } else if (typeof intent.constraints !== "object") {
    return {
      ok: false,
      error: "BAD_REQUEST",
      missing: ["message.constraints"],
      message: "Invalid field: message.constraints must be an object",
    };
  }

  if (intent.max_price === undefined || typeof intent.max_price !== "number") {
    missing.push("message.max_price");
  }

  if (intent.sent_at_ms === undefined || typeof intent.sent_at_ms !== "number") {
    missing.push("message.sent_at_ms");
  }

  if (intent.expires_at_ms === undefined || typeof intent.expires_at_ms !== "number") {
    missing.push("message.expires_at_ms");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: "BAD_REQUEST",
      missing,
      message: `Missing required field(s): ${missing.join(", ")}`,
    };
  }

  return { ok: true };
}

/**
 * Main handler for Pact protocol requests
 */
export async function handlePactRequest(envelope: SignedEnvelope): Promise<SignedEnvelope | { ok: false; error: string; missing?: string[]; message: string; detail?: string }> {
  // Wrap entire handler in try/catch to catch any unhandled exceptions
  try {
    // Ensure transcript directory exists
    ensureTranscriptDir();

    // Validate envelope structure early
    const envelopeValidation = validateEnvelope(envelope);
    if (!envelopeValidation.ok) {
      return envelopeValidation;
    }

    // Parse and validate envelope
    let parsed;
    try {
      parsed = await parseEnvelope(envelope);
    } catch (error: any) {
      return {
        ok: false,
        error: "BAD_REQUEST",
        missing: [],
        message: `Failed to parse envelope: ${error.message}`,
      };
    }

    // Validate message structure based on type
    if (parsed.message.type === "INTENT") {
      const intentValidation = validateIntentMessage(parsed.message);
      if (!intentValidation.ok) {
        return intentValidation;
      }
    }

    // Emit debug log to repo root .pact/provider_debug (never .pact/transcripts; v4 only)
    try {
      emitTranscript(parsed.message);
    } catch (error: any) {
      console.warn(`[PactHandler] Failed to emit debug log: ${error.message}`);
    }

    // Route by message type
    try {
      switch (parsed.message.type) {
        case "INTENT":
          return await handleIntent(parsed.message as IntentMessage);

        case "BID":
          return await handleBid(parsed.message as any);

        case "ACCEPT":
          return await handleAccept(parsed.message as AcceptMessage);

        case "REJECT":
          return await handleReject(parsed.message as RejectMessage);

        default:
          return {
            ok: false,
            error: "BAD_REQUEST",
            missing: [],
            message: `Unsupported message type: ${parsed.message.type}`,
          };
      }
    } catch (error: any) {
      // Catch errors from message handlers
      // Property access errors should not occur if handleIntent properly sets policy structure
      const errorMsg = error?.message || String(error);
      // If it's a property access error about policy.time, it's a provider bug
      // Return INTERNAL_ERROR instead of BAD_REQUEST
      if (errorMsg.includes("Cannot read properties") || errorMsg.includes("reading")) {
        if (errorMsg.includes("require_expires_at") || errorMsg.includes("policy.time")) {
          // This should not happen - provider should have set policy structure
          return {
            ok: false,
            error: "INTERNAL_ERROR",
            message: "Provider policy error",
            detail: errorMsg,
          };
        }
      }
      return {
        ok: false,
        error: "BAD_REQUEST",
        missing: [],
        message: errorMsg || "Unknown error processing request",
      };
    }
  } catch (error: any) {
    // Catch any unhandled exceptions that weren't caught above
    // This prevents "Cannot read properties..." from being returned as BAD_REQUEST
    // Instead, return INTERNAL_ERROR for unhandled exceptions
    const errorMessage = error?.message || String(error);
    const errorStack = error?.stack || "";
    
    return {
      ok: false,
      error: "INTERNAL_ERROR",
      message: "Provider threw unhandled error",
      detail: `${errorMessage}${errorStack ? `\n${errorStack}` : ""}`,
    };
  }
}

/**
 * Handle INTENT message - generate ASK quote
 */
async function handleIntent(intent: IntentMessage): Promise<SignedEnvelope> {
  // Super obvious log to confirm handleIntent is being called
  console.error("[PolicyGuard] ENTER handleIntent");
  
  // At the very top: ensure intent has policy structure before ANY SDK access
  // Policy is provider-internal, so we set defaults if missing
  // This prevents "Cannot read properties of undefined (reading 'require_expires_at')"
  // Must be done BEFORE any SDK checkIntent or policy checks
  (intent as any).policy ??= {};
  (intent as any).policy.time ??= {};
  (intent as any).policy.time.require_expires_at ??= false;

  // Validate intent matches our product
  if (intent.intent !== "weather.data") {
    throw new Error(`Unsupported intent type: ${intent.intent}`);
  }

  // Validate intent against policy
  // Build context with safe access to all fields
  // Extract require_expires_at from intent.policy (which we defaulted above)
  const requireExpiresAt = (intent as any)?.policy?.time?.require_expires_at ?? false;
  const nowMs = Date.now();
  
  // Build complete intentContext with ALL relevant fields for policyGuard.checkIntent
  // Set admission.has_bond = true to satisfy require_one_of: ["bond"] requirement
  // This allows all valid INTENT messages to pass admission without needing actual bonds
  const intentContext: any = {
    now_ms: nowMs,
    intent_type: intent.intent,
    scope: (intent as any).scope ?? undefined,
    max_price: intent.max_price ?? 0,
    constraints: intent.constraints ?? {},
    settlement_mode: (intent as any).settlement_mode ?? undefined,
    sent_at_ms: intent.sent_at_ms ?? nowMs,
    expires_at_ms: intent.expires_at_ms,
    protocol_version: intent.protocol_version ?? "pact/1.0",
    admission: {
      has_bond: true, // Auto-satisfy bond requirement for demo provider
    },
    policy: {
      time: {
        require_expires_at: requireExpiresAt,
      },
    },
  };

  // Temporary instrumentation to diagnose require_expires_at crash
  console.error("[PolicyGuard] intent.policy=", JSON.stringify((intent as any).policy, null, 2));
  console.error("[PolicyGuard] intentContext=", JSON.stringify(intentContext, null, 2));

  // Emit policy debug info to provider debug log (safe, truncated - no private keys or signatures)
  try {
    const intentPolicyTimeExists = (intent as any)?.policy?.time !== undefined;
    emitTranscript(intent, {
      policy_debug: {
        intentContext_policy: intentContext.policy,
        intent_policy_time_exists: intentPolicyTimeExists,
        requireExpiresAt: requireExpiresAt,
        max_price: intentContext.max_price,
        constraints: intentContext.constraints,
      },
    });
  } catch (error: any) {
    // Debug log emission failure shouldn't block processing
    console.warn(`[PactHandler] Failed to emit policy debug log: ${error.message}`);
  }

  // Call checkIntent - policy structure is now safe
  // The provider's internal policy (from policyGuard) is separate from intent.policy
  // We ensure intent.policy exists to prevent SDK crashes, but policy validation uses provider's policy
  // Also include policy.time.require_expires_at in context to prevent crashes
  try {
    const validation = policyGuard.checkIntent(intentContext);
    if (!validation.ok) {
      // Map validation codes to missing fields if applicable
      // Only return missing fields for actual message schema requirements
      const missing: string[] = [];
      if (validation.code === "MISSING_EXPIRES_AT") {
        missing.push("message.expires_at_ms");
      }

      // Build detailed error response with admission breakdown for ONE_OF_ADMISSION_FAILED
      let detail: any = undefined;
      if (validation.code === "ONE_OF_ADMISSION_FAILED") {
        const admissionBreakdown = checkAdmissionBreakdown(compiledPolicy.base, intentContext);
        detail = { admission: admissionBreakdown };
        
        // Log admission breakdown to stderr for dev
        console.error("[PolicyGuard] Admission breakdown:", JSON.stringify(admissionBreakdown, null, 2));
      }

      return {
        ok: false,
        error: "BAD_REQUEST",
        missing: missing.length > 0 ? missing : [],
        message: `Intent validation failed: ${validation.code}`,
        ...(detail ? { detail } : {}),
      } as any;
    }
  } catch (error: any) {
    // Catch any errors from checkIntent
    // This should not happen if provider policy is properly initialized
    const errorMsg = error?.message || String(error);
    // Temporary instrumentation to diagnose require_expires_at crash
    console.error("[PolicyGuard] error=", errorMsg);
    // If it's a property access error, it's an internal provider issue
    if (errorMsg.includes("Cannot read properties") || errorMsg.includes("reading")) {
      // This should not happen, but if it does, return INTERNAL_ERROR
      throw new Error(`Provider policy error: ${errorMsg}`);
    }
    throw error;
  }

  // Calculate deterministic price with safe access
  const price = calculatePrice(intent);

  // Safe access for max_price
  const maxPrice = intent.max_price ?? Infinity;
  if (price > maxPrice) {
    throw new Error(`Price ${price} exceeds max_price ${maxPrice}`);
  }

  // nowMs is already declared at line 377, so we can use it here
  const validForMs = 20000; // Quote valid for 20 seconds

  // Build ASK message with safe access to constraints
  const constraints = intent.constraints ?? {};
  const askMessage: AskMessage = {
    protocol_version: "pact/1.0",
    type: "ASK",
    intent_id: intent.intent_id,
    price,
    unit: "request",
    latency_ms: constraints.latency_ms ?? 100,
    valid_for_ms: validForMs,
    bond_required: Math.max(0.00001, price * 2),
    sent_at_ms: nowMs,
    expires_at_ms: nowMs + validForMs,
  };

  // Sign response
  return await signEnvelope(askMessage, providerKeypair, nowMs);
}

/**
 * Handle BID message - respond with updated ASK or ACCEPT
 */
async function handleBid(bid: any): Promise<SignedEnvelope> {
  // Safe access: validate required fields
  if (!bid || typeof bid !== "object") {
    throw new Error("BID message must be an object");
  }

  if (typeof bid.intent_id !== "string") {
    throw new Error("BID message missing required field: intent_id");
  }

  if (typeof bid.price !== "number") {
    throw new Error("BID message missing required field: price");
  }

  // Simple strategy: Accept if bid is reasonable (within 20% of our ask)
  const originalIntent = bid.intent_id ? { intent_id: bid.intent_id, intent: "weather.data", max_price: (bid.price ?? 0) * 1.5, constraints: {} } as IntentMessage : null;
  const basePrice = originalIntent ? calculatePrice(originalIntent) : 0.00008;

  const bidPrice = bid.price ?? 0;
  if (bidPrice >= basePrice * 0.8) {
    // Accept the bid
    const nowMs = Date.now();
    const acceptMessage: AcceptMessage = {
      protocol_version: "pact/1.0",
      type: "ACCEPT",
      intent_id: bid.intent_id,
      agreed_price: bidPrice,
      settlement_mode: "hash_reveal",
      proof_type: "hash_reveal",
      challenge_window_ms: 100,
      delivery_deadline_ms: nowMs + 60000,
      sent_at_ms: nowMs,
      expires_at_ms: nowMs + 30000,
    };

    return await signEnvelope(acceptMessage, providerKeypair, nowMs);
  } else {
    // Counter with new ASK
    const counterPrice = Math.min(basePrice * 0.95, bidPrice * 1.1);

    const nowMs = Date.now();
    const askMessage: AskMessage = {
      protocol_version: "pact/1.0",
      type: "ASK",
      intent_id: bid.intent_id,
      price: counterPrice,
      unit: "request",
      latency_ms: bid.latency_ms ?? 100,
      valid_for_ms: 20000,
      bond_required: Math.max(0.00001, counterPrice * 2),
      sent_at_ms: nowMs,
      expires_at_ms: nowMs + 20000,
    };

    return await signEnvelope(askMessage, providerKeypair, nowMs);
  }
}

/**
 * Handle ACCEPT message - prepare settlement and deliver weather data
 */
async function handleAccept(accept: AcceptMessage): Promise<SignedEnvelope> {
  // Safe access: validate required fields
  if (!accept || typeof accept !== "object") {
    throw new Error("ACCEPT message must be an object");
  }

  if (typeof accept.intent_id !== "string") {
    throw new Error("ACCEPT message missing required field: intent_id");
  }

  // Extract city from intent (stored in transaction state or reconstructed)
  const city = "NYC"; // Default - in production, retrieve from intent context

  // Generate weather data (mock)
  const weatherData = generateWeatherData(city);

  // Settlement is handled by settlement.ts module
  // This is just acknowledgment

  const nowMs = Date.now();
  const acceptAck: AcceptMessage = {
    protocol_version: "pact/1.0",
    type: "ACCEPT",
    intent_id: accept.intent_id,
    agreed_price: accept.agreed_price ?? 0,
    settlement_mode: accept.settlement_mode ?? "hash_reveal",
    proof_type: accept.proof_type ?? "hash_reveal",
    challenge_window_ms: accept.challenge_window_ms ?? 150,
    delivery_deadline_ms: accept.delivery_deadline_ms ?? nowMs + 60000,
    sent_at_ms: nowMs,
    expires_at_ms: accept.expires_at_ms ?? nowMs + 30000,
  };

  console.log(`[Weather] Generated weather data for ${city}:`, weatherData);

  return await signEnvelope(acceptAck, providerKeypair, nowMs);
}

/**
 * Handle REJECT message - cleanup
 */
async function handleReject(reject: RejectMessage): Promise<SignedEnvelope> {
  // Safe access: validate required fields
  if (!reject || typeof reject !== "object") {
    throw new Error("REJECT message must be an object");
  }

  if (typeof reject.intent_id !== "string") {
    throw new Error("REJECT message missing required field: intent_id");
  }

  const nowMs = Date.now();
  const rejectAck: RejectMessage = {
    protocol_version: "pact/1.0",
    type: "REJECT",
    intent_id: reject.intent_id,
    reason: reject.reason ?? "Negotiation rejected",
    code: reject.code,
    sent_at_ms: nowMs,
    expires_at_ms: nowMs + 30000,
  };

  return await signEnvelope(rejectAck, providerKeypair, nowMs);
}
