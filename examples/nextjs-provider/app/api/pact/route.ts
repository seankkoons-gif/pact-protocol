/**
 * Next.js App Router - Pact Provider API Route
 * 
 * Handles Pact negotiation requests via POST /api/pact
 * 
 * DEPLOYMENT (Vercel):
 * 
 * 1. Deploy to Vercel:
 *    vercel deploy
 * 
 * 2. Environment Variables (Vercel Dashboard):
 *    - PACT_PROVIDER_SECRET (optional - for persistent keypair)
 *    - PACT_SETTLEMENT_WEBHOOK_URL (optional - for settlement delegation)
 * 
 * 3. Vercel automatically handles:
 *    - Serverless function execution
 *    - Edge runtime (if configured)
 *    - Automatic scaling
 *    - Zero-config HTTPS
 * 
 * SETTLEMENT INTEGRATION:
 * 
 * To add Stripe:
 *   1. Install: npm install stripe
 *   2. Set env: STRIPE_SECRET_KEY=sk_live_...
 *   3. Replace delegateSettlement() with Stripe API calls
 *   4. Use StripeSettlementProvider from @pact/sdk
 * 
 * To add Escrow (on-chain):
 *   1. Install: npm install ethers
 *   2. Set env: ETH_RPC_URL=https://...
 *   3. Replace delegateSettlement() with contract calls
 *   4. Use pact-escrow-evm package for contract integration
 * 
 * To add custom settlement service:
 *   1. POST to settlement webhook in delegateSettlement()
 *   2. Settlement service handles fund custody
 *   3. Provider only coordinates (doesn't custody funds)
 */

import { NextRequest, NextResponse } from "next/server";
import type {
  SignedEnvelope,
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
  createDefaultPolicy,
  validatePolicyJson,
} from "@pact/sdk";

// Provider keypair (in production: load from environment or secure storage)
// For Vercel: Store as environment variable and reconstruct keypair
const providerKeypair = generateKeyPair();

// Policy guard for validation (uses default policy)
const defaultPolicy = createDefaultPolicy();
// Relax policy for demo (allow any reputation)
defaultPolicy.counterparty.min_reputation = 0.0;
const policyValidation = validatePolicyJson(defaultPolicy);
if (!policyValidation.ok) {
  throw new Error(`Policy validation failed: ${JSON.stringify(policyValidation.errors)}`);
}
const policyGuard = new DefaultPolicyGuard(policyValidation.policy);

/**
 * POST /api/pact - Handle Pact negotiation requests
 * 
 * Supports: INTENT, ACCEPT, REJECT messages
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const envelope: SignedEnvelope = await request.json();

    // Parse and validate envelope (SDK handles protocol validation)
    const parsed = await parseEnvelope(envelope);

    // Emit transcript (for audit/debugging)
    emitTranscript(parsed.message);

    // Route by message type
    let response: SignedEnvelope;

    switch (parsed.message.type) {
      case "INTENT":
        response = await handleIntent(parsed.message as IntentMessage);
        break;

      case "ACCEPT":
        response = await handleAccept(parsed.message as AcceptMessage);
        break;

      case "REJECT":
        response = await handleReject(parsed.message as RejectMessage);
        break;

      default:
        return NextResponse.json(
          { error: `Unsupported message type: ${parsed.message.type}` },
          { status: 400 }
        );
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[Pact API] Error:", error.message);
    return NextResponse.json(
      { error: error.message || "Bad request" },
      { status: 400 }
    );
  }
}

/**
 * Handle INTENT message - Generate ASK quote
 * 
 * Demonstrates: Policy-based pricing (not hardcoded)
 * Pricing considers: intent type, constraints, urgency, policy rules
 */
async function handleIntent(intent: IntentMessage): Promise<SignedEnvelope> {
  // Validate intent against policy (SDK handles policy enforcement)
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

  // Policy-based pricing calculation (not hardcoded)
  const price = calculatePolicyBasedPrice(intent);

  // Ensure price is within buyer's max_price
  const finalPrice = Math.min(price, intent.max_price);

  if (finalPrice > intent.max_price) {
    throw new Error(`Price ${finalPrice} exceeds max_price ${intent.max_price}`);
  }

  const nowMs = Date.now();
  const validForMs = 20000; // Quote valid for 20 seconds

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

  // Sign response (SDK handles cryptographic signing)
  return await signEnvelope(askMessage, providerKeypair, nowMs);
}

/**
 * Handle ACCEPT message - Prepare settlement
 * 
 * Demonstrates: Settlement delegation to external service
 * In production: Replace with Stripe, escrow, or custom settlement
 */
async function handleAccept(accept: AcceptMessage): Promise<SignedEnvelope> {
  // Delegate settlement to external system
  // Options: Stripe, escrow contract, settlement webhook
  const settlementHandleId = await delegateSettlement({
    intentId: accept.intent_id,
    amount: accept.agreed_price,
    bondAmount: accept.agreed_price * 2,
    settlementMode: accept.settlement_mode,
  });

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
 * Handle REJECT message - Cleanup
 */
async function handleReject(reject: RejectMessage): Promise<SignedEnvelope> {
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
 * Calculate price based on policy and intent (NOT hardcoded)
 * 
 * Policy-based pricing considers:
 * - Intent type (different base prices)
 * - Constraints (latency, freshness requirements)
 * - Urgency (premium for urgent requests)
 * - Policy rules (max price, band constraints)
 * 
 * In production: Load base prices from database or config
 */
function calculatePolicyBasedPrice(intent: IntentMessage): number {
  // Base prices per intent type (in production: load from database/config)
  const basePrices: Record<string, number> = {
    "weather.data": 0.00008,
    "compute.inference": 0.00012,
    "data.query": 0.00005,
  };

  const basePrice = basePrices[intent.intent] || 0.0001;
  let price = basePrice;

  // Adjust for latency constraints (lower latency = higher price)
  if (intent.constraints.latency_ms < 50) {
    price *= 1.2; // 20% premium for low latency
  } else if (intent.constraints.latency_ms < 100) {
    price *= 1.1; // 10% premium for medium latency
  }

  // Adjust for freshness constraints (fresher data = higher price)
  if (intent.constraints.freshness_sec < 10) {
    price *= 1.1; // 10% premium for fresh data
  }

  // Urgency premium
  if (intent.urgent) {
    price *= 1.15; // 15% premium for urgent requests
  }

  // Apply policy constraints (e.g., reference price bands)
  // In production: Check against policy.economics.reference_price

  return price;
}

/**
 * Delegate settlement to external system
 * 
 * PLUGGING IN STRIPE:
 * 
 *   1. Install: npm install stripe @pact/sdk
 *   2. Set env: STRIPE_SECRET_KEY=sk_live_...
 *   3. Replace this function:
 * 
 *      import Stripe from "stripe";
 *      import { StripeSettlementProvider } from "@pact/sdk";
 * 
 *      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
 *      const settlement = new StripeSettlementProvider({ ... });
 * 
 *      const handle = await settlement.prepare({ intent, amount });
 *      return handle.handle_id;
 * 
 * PLUGGING IN ESCROW (EVM):
 * 
 *   1. Install: npm install ethers
 *   2. Set env: ETH_RPC_URL=https://mainnet.infura.io/...
 *   3. Replace this function:
 * 
 *      import { ethers } from "ethers";
 *      import { PactEscrowABI } from "pact-escrow-evm";
 * 
 *      const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
 *      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
 *      const escrow = new ethers.Contract(ESCROW_ADDRESS, PactEscrowABI, wallet);
 * 
 *      const tx = await escrow.lock(intentId, buyer, seller, amount, "ETH", proof);
 *      return tx.hash;
 * 
 * PLUGGING IN CUSTOM SETTLEMENT WEBHOOK:
 * 
 *   1. Set env: PACT_SETTLEMENT_WEBHOOK_URL=https://settlement.example.com/webhook
 *   2. Replace this function:
 * 
 *      const response = await fetch(process.env.PACT_SETTLEMENT_WEBHOOK_URL!, {
 *        method: "POST",
 *        headers: { "Content-Type": "application/json" },
 *        body: JSON.stringify({ intentId, amount, settlementMode }),
 *      });
 * 
 *      const { handleId } = await response.json();
 *      return handleId;
 */
async function delegateSettlement(params: {
  intentId: string;
  amount: number;
  bondAmount: number;
  settlementMode: string;
}): Promise<string> {
  const handleId = `settlement-${params.intentId}-${Date.now()}`;

  // STUB: In production, replace with actual settlement integration
  // See comments above for Stripe, Escrow, or Webhook integration examples

  console.log(`[Settlement] Preparing settlement:`);
  console.log(`  Intent ID: ${params.intentId}`);
  console.log(`  Amount: ${params.amount}`);
  console.log(`  Settlement Mode: ${params.settlementMode}`);
  console.log(`  Handle ID: ${handleId}`);

  // Example: Call settlement webhook if configured
  // const webhookUrl = process.env.PACT_SETTLEMENT_WEBHOOK_URL;
  // if (webhookUrl) {
  //   await fetch(webhookUrl, {
  //     method: "POST",
  //     body: JSON.stringify(params),
  //   });
  // }

  return handleId;
}

/**
 * Emit transcript for audit/debugging
 * 
 * In production: Also send to:
 * - Logging service (Datadog, LogDNA)
 * - Analytics (Vercel Analytics, PostHog)
 * - Database for audit trail
 */
function emitTranscript(message: any): void {
  const transcript = {
    timestamp: new Date().toISOString(),
    message_type: message.type,
    intent_id: message.intent_id,
    price: message.price || message.agreed_price,
  };

  // Console log (visible in Vercel logs)
  console.log(`[Transcript] ${JSON.stringify(transcript)}`);

  // In production, also:
  // - Store in database
  // - Send to analytics service
  // - Write to audit log file (if using file storage)
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
