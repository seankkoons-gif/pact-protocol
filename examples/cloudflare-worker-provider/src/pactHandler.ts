/**
 * Pact Protocol Handler for Cloudflare Workers
 * 
 * STATELESS PROVIDER DESIGN:
 * 
 * What is STATELESS?
 * - Each request is independent - no in-memory state between requests
 * - No negotiation state stored in worker memory
 * - Each message must be self-contained or state stored externally
 * 
 * What is STATEFUL? (opposite)
 * - Maintains in-memory state across requests (e.g., Map of negotiations)
 * - Worker remembers previous requests in the same execution context
 * - Faster but doesn't scale across multiple worker instances
 * 
 * For STATELESS providers:
 * - Store negotiation state in external storage (KV, Durable Objects, DB)
 * - OR use stateless negotiation where each message contains full context
 * - OR design negotiation to be single-round (INTENT → ASK is stateless)
 */

import type { SignedEnvelope, IntentMessage, AskMessage, AcceptMessage, RejectMessage } from "@pact/sdk";
import {
  parseEnvelope,
  signEnvelope,
  generateKeyPair,
  DefaultPolicyGuard,
  createDefaultPolicy,
  validatePolicyJson,
} from "@pact/sdk";

// Provider identity (in production: load from KV or Worker Secrets)
// NOTE: In Cloudflare Workers, secrets are available via env bindings
let providerKeypair = generateKeyPair();

// Policy guard (initialized once per worker instance)
const defaultPolicy = createDefaultPolicy();
defaultPolicy.counterparty.min_reputation = 0.0; // Relax for demo
const policyValidation = validatePolicyJson(defaultPolicy);
if (!policyValidation.ok) {
  throw new Error(`Policy validation failed: ${JSON.stringify(policyValidation.errors)}`);
}
const policyGuard = new DefaultPolicyGuard(policyValidation.policy);

export interface Env {
  // Cloudflare environment bindings
  // NEGOTIATIONS?: KVNamespace; // For storing negotiation state
  // PROVIDER_SECRET?: string; // Worker Secret for provider keypair
}

/**
 * Main handler - STATELESS design
 * 
 * Each request is handled independently. No in-memory state between requests.
 */
export async function handlePactRequest(
  envelope: SignedEnvelope,
  env?: Env
): Promise<SignedEnvelope> {
  // Parse and validate envelope (SDK handles protocol validation)
  const parsed = await parseEnvelope(envelope);

  // Emit transcript (logs to Cloudflare Workers console)
  emitTranscript(parsed.message);

  // Route by message type
  switch (parsed.message.type) {
    case "INTENT":
      return handleIntent(parsed.message as IntentMessage, env);

    case "ACCEPT":
      return handleAccept(parsed.message as AcceptMessage, env);

    case "REJECT":
      return handleReject(parsed.message as RejectMessage, env);

    default:
      throw new Error(`Unsupported message type: ${parsed.message.type}`);
  }
}

/**
 * Handle INTENT - Generate ASK quote (STATELESS)
 * 
 * This is naturally stateless: INTENT → ASK doesn't require previous state.
 * Each quote is calculated fresh from the intent.
 */
async function handleIntent(
  intent: IntentMessage,
  env?: Env
): Promise<SignedEnvelope> {
  // Validate intent against policy
  const intentContext = {
    intent_type: intent.intent,
    max_price: intent.max_price,
    constraints: intent.constraints,
    expires_at_ms: intent.expires_at_ms,
    sent_at_ms: intent.sent_at_ms,
    protocol_version: intent.protocol_version,
  };

  const validation = policyGuard.checkIntent(intentContext);
  if (!validation.ok) {
    throw new Error(`Intent validation failed: ${validation.code}`);
  }

  // Calculate quote (stateless - no previous state needed)
  const price = calculateQuotePrice(intent);
  const finalPrice = Math.min(price, intent.max_price);

  if (finalPrice > intent.max_price) {
    throw new Error(`Price ${finalPrice} exceeds max_price ${intent.max_price}`);
  }

  const nowMs = Date.now();
  const validForMs = 20000;

  // Build ASK message
  const askMessage: AskMessage = {
    protocol_version: "pact/1.0",
    type: "ASK",
    intent_id: intent.intent_id,
    price: finalPrice,
    unit: "request",
    latency_ms: intent.constraints.latency_ms,
    valid_for_ms: validForMs,
    bond_required: Math.max(0.00001, finalPrice * 2),
    sent_at_ms: nowMs,
    expires_at_ms: nowMs + validForMs,
  };

  // Sign response
  return await signEnvelope(askMessage, providerKeypair, nowMs);
}

/**
 * Handle ACCEPT - Prepare settlement (STATELESS with external delegation)
 * 
 * SETTLEMENT DELEGATION:
 * 
 * This provider is stateless and doesn't handle settlement directly.
 * Instead, settlement is delegated to external systems:
 * 
 * 1. On-chain escrow: Call smart contract (via external RPC)
 *    - Example: POST to settlement service → calls EVM contract
 * 
 * 2. Payment processor: Delegate to Stripe/PayPal API
 *    - Example: Call settlement webhook → processes payment
 * 
 * 3. Settlement service: Separate microservice handles funds
 *    - Example: POST /settlement/prepare → external service
 * 
 * The provider only coordinates - it doesn't custody funds or lock assets.
 * This keeps the worker lightweight and stateless.
 */
async function handleAccept(
  accept: AcceptMessage,
  env?: Env
): Promise<SignedEnvelope> {
  // In a STATELESS design, we don't store negotiation state
  // The ACCEPT message itself contains all needed info (intent_id, price, etc.)

  // Delegate settlement to external system (webhook, API, or smart contract)
  // Example: POST to settlement service webhook
  const settlementHandleId = await delegateSettlement({
    intentId: accept.intent_id,
    amount: accept.agreed_price,
    bondAmount: accept.agreed_price * 2,
    settlementMode: accept.settlement_mode,
  });

  // Log settlement delegation (for transcript/audit)
  console.log(`[Settlement] Delegated: handleId=${settlementHandleId}`);

  // Echo ACCEPT back (acknowledgment)
  const nowMs = Date.now();
  const acceptAck: AcceptMessage = {
    protocol_version: "pact/1.0",
    type: "ACCEPT",
    intent_id: accept.intent_id,
    agreed_price: accept.agreed_price,
    settlement_mode: accept.settlement_mode,
    proof_type: accept.proof_type,
    challenge_window_ms: accept.challenge_window_ms,
    delivery_deadline_ms: accept.delivery_deadline_ms,
    sent_at_ms: nowMs,
    expires_at_ms: accept.expires_at_ms,
  };

  return await signEnvelope(acceptAck, providerKeypair, nowMs);
}

/**
 * Handle REJECT - Cleanup (STATELESS)
 * 
 * In stateless design, no cleanup needed - just acknowledge rejection.
 */
async function handleReject(reject: RejectMessage, env?: Env): Promise<SignedEnvelope> {
  // No state to clean up in stateless design
  // Just acknowledge the rejection

  const nowMs = Date.now();
  const rejectAck: RejectMessage = {
    protocol_version: "pact/1.0",
    type: "REJECT",
    intent_id: reject.intent_id,
    reason: reject.reason || "Negotiation rejected",
    code: reject.code,
    sent_at_ms: nowMs,
    expires_at_ms: nowMs + 30000,
  };

  return await signEnvelope(rejectAck, providerKeypair, nowMs);
}

/**
 * Calculate quote price (stateless function)
 * 
 * Pure function - no external state needed.
 */
function calculateQuotePrice(intent: IntentMessage): number {
  // Base prices (in production: load from KV or Worker KV)
  const basePrices: Record<string, number> = {
    "weather.data": 0.00008,
    "compute.inference": 0.00012,
    "data.query": 0.00005,
  };

  const basePrice = basePrices[intent.intent] || 0.0001;
  let price = basePrice;

  // Adjust for constraints
  if (intent.constraints.latency_ms < 50) {
    price *= 1.2;
  }
  if (intent.constraints.freshness_sec < 10) {
    price *= 1.1;
  }
  if (intent.urgent) {
    price *= 1.15;
  }

  return price;
}

/**
 * Delegate settlement to external system
 * 
 * This demonstrates how a stateless worker delegates settlement:
 * - Calls external settlement service
 * - Or triggers smart contract via RPC
 * - Or sends webhook to payment processor
 * 
 * The worker doesn't custody funds - it just coordinates.
 */
async function delegateSettlement(params: {
  intentId: string;
  amount: number;
  bondAmount: number;
  settlementMode: string;
}): Promise<string> {
  const handleId = `settlement-${params.intentId}-${Date.now()}`;

  // Example: Delegate to external settlement service
  // In production, this would:
  // 1. Call settlement service API: await fetch(SETTLEMENT_SERVICE_URL, ...)
  // 2. Or trigger smart contract: await ethereumRpc.call(...)
  // 3. Or send webhook: await fetch(WEBHOOK_URL, ...)

  console.log(`[Settlement] Delegating to external service:`);
  console.log(`  Intent ID: ${params.intentId}`);
  console.log(`  Amount: ${params.amount}`);
  console.log(`  Settlement Mode: ${params.settlementMode}`);
  console.log(`  Handle ID: ${handleId}`);

  // In production, make actual HTTP call:
  // const response = await fetch(SETTLEMENT_SERVICE_URL, {
  //   method: "POST",
  //   body: JSON.stringify({ ...params, handleId }),
  // });
  // if (!response.ok) throw new Error("Settlement delegation failed");

  return handleId;
}

/**
 * Emit transcript (logs to Cloudflare Workers console)
 * 
 * In production: Send to logging service, KV store, or analytics.
 */
function emitTranscript(message: any): void {
  const transcript = {
    timestamp: new Date().toISOString(),
    message_type: message.type,
    intent_id: message.intent_id,
    price: message.price || message.agreed_price,
  };

  // Cloudflare Workers console (viewable in dashboard)
  console.log(`[Transcript] ${JSON.stringify(transcript)}`);

  // In production, also send to:
  // - Cloudflare Analytics
  // - External logging service (Datadog, etc.)
  // - KV store for audit trail
}
