# Stripe Integration Guide

This guide explains how to use Stripe API with PACT's settlement provider.

## Overview

PACT provides a **Stripe settlement provider** (`StripeSettlementProvider`) that works out of the box when the `stripe` package is installed.

**Naming Clarification:**
- **Provider Name:** `StripeSettlementProvider` (not "Stripe Live") - avoids confusion with Stripe's mode terminology
- **Mode Field:** Uses Stripe's terminology - `"sandbox"` (testing) or `"live"` (production)
- **String Identifier:** `"stripe_live"` is just an identifier (not a "live mode only" indicator)
- **Why This Matters:** Stripe uses "live" to mean "production mode", but our provider supports both sandbox and live modes via configuration

**Key Points:**
- **Works out of the box**: Install `stripe` package to enable real Stripe integration
- **Graceful fallback**: Without `stripe`, returns clear errors (boundary mode)
- **Optional dependency**: `stripe` is an optional peer dependency
- **Production ready**: Real Stripe API integration when `stripe` package is installed

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        acquire()                            │
│  (Calls SettlementProvider methods)                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ calls
                       ▼
┌─────────────────────────────────────────────────────────────┐
│         SettlementProvider Interface                        │
│  (Factory creates provider instance)                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│     mock     │ │ stripe_like  │ │ stripe      │
│ (testing)    │ │ (testing)    │ │ (provider)  │
└──────────────┘ └──────────────┘ └──────────────┘
                                            │
                                            │ extend
                                            ▼
                                ┌───────────────────────┐
                                │ YourStripeProvider   │
                                │ (production impl)     │
                                └───────────────────────┘
```

## Stripe Configuration

```typescript
interface StripeConfig {
  mode: "sandbox" | "live";      // Stripe's mode: "sandbox" for testing, "live" for production
  api_key?: string;              // From PACT_STRIPE_API_KEY env
  account_id?: string;           // Optional Stripe account ID
  idempotency_prefix?: string;   // Optional idempotency key prefix
  enabled: boolean;              // Must be true to use (requires api_key)
}
```

**Naming Clarification:**
- Provider name: **`StripeSettlementProvider`** (not "Stripe Live")
- Mode field: `"sandbox"` (testing) or `"live"` (production) - this is Stripe's terminology
- String identifier: `"stripe_live"` (just an identifier, doesn't mean "live mode only")

## Quick Start

### Option 1: Use Built-in Implementation (Recommended)

Simply install the `stripe` package alongside `@pact/sdk`:

```bash
npm install @pact/sdk stripe
# or
pnpm add @pact/sdk stripe
```

Then configure and use `StripeSettlementProvider` directly:

```typescript
import { StripeSettlementProvider, validateStripeConfig } from "@pact/sdk";

// Set environment variable
process.env.PACT_STRIPE_API_KEY = "sk_test_..."; // Your Stripe API key

// Validate and create provider
const configResult = validateStripeConfig({ 
  mode: "sandbox", // Stripe mode: "sandbox" for testing, "live" for production
  enabled: true 
});

if (!configResult.ok) {
  throw new Error(configResult.reason);
}

const settlement = new StripeSettlementProvider(configResult.config);

// Provider is now ready to use!
// Real Stripe integration works automatically when 'stripe' package is installed
```

**That's it!** The built-in implementation handles:
- PaymentIntent creation and confirmation
- Fund locking and release
- Payment transfers
- Refunds
- Idempotency

### Option 2: Extend StripeSettlementProvider (Advanced)

If you need custom behavior, you can extend the built-in provider:

```typescript
import { StripeSettlementProvider, StripeConfig } from "@pact/sdk";
import type { 
  SettlementIntent, 
  SettlementHandle, 
  SettlementResult,
  SettlementProvider 
} from "@pact/sdk";
import Stripe from "stripe";

export class MyStripeProvider extends StripeSettlementProvider {
  private stripe: Stripe;
  private mode: "sandbox" | "live";
  
  constructor(config: StripeConfig) {
    super(config); // Validates config, reads env vars
    
    if (!config.api_key) {
      throw new Error("Stripe API key required for production use");
    }
    
    // Initialize Stripe SDK
    this.stripe = new Stripe(config.api_key, {
      apiVersion: "2023-10-16", // Use latest stable version
      maxNetworkRetries: 3,
      timeout: 30000,
    });
    
    this.mode = config.mode;
  }
  
  async prepare(intent: SettlementIntent): Promise<SettlementHandle> {
    try {
      // Create PaymentIntent in Stripe
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(intent.amount * 100), // Convert to cents
        currency: intent.asset?.toLowerCase() === "usdc" ? "usd" : "usd", // Map assets
        metadata: {
          intent_id: intent.intent_id,
          buyer_id: intent.buyer_id,
          seller_id: intent.seller_id,
          pact_version: "1.0",
        },
        payment_method_types: ["card"], // Configure as needed
        capture_method: "manual", // Authorize now, capture later
        confirmation_method: "manual",
      }, {
        idempotencyKey: this.getIdempotencyKey(intent.intent_id, "prepare"),
      });
      
      return {
        handle_id: paymentIntent.id,
        status: paymentIntent.status === "requires_capture" ? "prepared" : "failed",
        amount: intent.amount,
        asset: intent.asset || "USDC",
        created_at_ms: Date.now(),
        meta: {
          payment_intent_id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          status: paymentIntent.status,
        },
      };
    } catch (error: any) {
      throw new Error(`Stripe prepare failed: ${error.message}`);
    }
  }
  
  async commit(handle_id: string): Promise<SettlementResult> {
    try {
      // Capture PaymentIntent
      const paymentIntent = await this.stripe.paymentIntents.capture(handle_id);
      
      if (paymentIntent.status === "succeeded") {
        return {
          ok: true,
          status: "committed",
          paid_amount: paymentIntent.amount / 100, // Convert from cents
          handle_id: paymentIntent.id,
          committed_at_ms: Date.now(),
          meta: {
            payment_intent_id: paymentIntent.id,
            charge_id: paymentIntent.latest_charge as string,
            status: paymentIntent.status,
          },
        };
      } else {
        return {
          ok: false,
          status: "failed",
          paid_amount: 0,
          handle_id: paymentIntent.id,
          failure_code: "STRIPE_CAPTURE_FAILED",
          failure_reason: `PaymentIntent status: ${paymentIntent.status}`,
        };
      }
    } catch (error: any) {
      // Handle idempotency (already captured)
      if (error.type === "StripeInvalidRequestError" && error.code === "payment_intent_unexpected_state") {
        // Check current status
        const paymentIntent = await this.stripe.paymentIntents.retrieve(handle_id);
        if (paymentIntent.status === "succeeded") {
          return {
            ok: true,
            status: "committed",
            paid_amount: paymentIntent.amount / 100,
            handle_id: paymentIntent.id,
            committed_at_ms: Date.now(),
          };
        }
      }
      
      return {
        ok: false,
        status: "failed",
        paid_amount: 0,
        handle_id,
        failure_code: "STRIPE_COMMIT_FAILED",
        failure_reason: error.message,
      };
    }
  }
  
  async abort(handle_id: string): Promise<SettlementResult> {
    try {
      // Cancel PaymentIntent (void authorization)
      const paymentIntent = await this.stripe.paymentIntents.cancel(handle_id);
      
      return {
        ok: true,
        status: "aborted",
        paid_amount: 0,
        handle_id: paymentIntent.id,
        aborted_at_ms: Date.now(),
        meta: {
          payment_intent_id: paymentIntent.id,
          status: paymentIntent.status,
        },
      };
    } catch (error: any) {
      // Handle idempotency (already canceled)
      if (error.type === "StripeInvalidRequestError" && error.code === "payment_intent_unexpected_state") {
        const paymentIntent = await this.stripe.paymentIntents.retrieve(handle_id);
        if (paymentIntent.status === "canceled") {
          return {
            ok: true,
            status: "aborted",
            paid_amount: 0,
            handle_id: paymentIntent.id,
            aborted_at_ms: Date.now(),
          };
        }
      }
      
      return {
        ok: false,
        status: "failed",
        paid_amount: 0,
        handle_id,
        failure_code: "STRIPE_ABORT_FAILED",
        failure_reason: error.message,
      };
    }
  }
  
  async poll(handle_id: string): Promise<SettlementHandle> {
    try {
      // Retrieve PaymentIntent status
      const paymentIntent = await this.stripe.paymentIntents.retrieve(handle_id);
      
      // Map Stripe status to PACT status
      let status: "prepared" | "committed" | "aborted" | "failed";
      switch (paymentIntent.status) {
        case "requires_capture":
          status = "prepared";
          break;
        case "succeeded":
          status = "committed";
          break;
        case "canceled":
          status = "aborted";
          break;
        default:
          status = "failed";
      }
      
      return {
        handle_id: paymentIntent.id,
        status,
        amount: paymentIntent.amount / 100,
        asset: "USDC", // Map from currency
        created_at_ms: paymentIntent.created * 1000,
        meta: {
          payment_intent_id: paymentIntent.id,
          status: paymentIntent.status,
          latest_charge: paymentIntent.latest_charge as string | undefined,
        },
      };
    } catch (error: any) {
      throw new Error(`Stripe poll failed: ${error.message}`);
    }
  }
  
  async refund(handle_id: string, amount: number, reason?: string): Promise<SettlementResult> {
    try {
      // Retrieve PaymentIntent to get charge ID
      const paymentIntent = await this.stripe.paymentIntents.retrieve(handle_id);
      const chargeId = paymentIntent.latest_charge as string;
      
      if (!chargeId) {
        return {
          ok: false,
          status: "failed",
          paid_amount: 0,
          handle_id,
          failure_code: "STRIPE_REFUND_FAILED",
          failure_reason: "No charge found for PaymentIntent",
        };
      }
      
      // Create refund
      const refund = await this.stripe.refunds.create({
        charge: chargeId,
        amount: Math.round(amount * 100), // Convert to cents
        reason: reason ? (reason as any) : undefined,
        metadata: {
          intent_id: paymentIntent.metadata.intent_id,
          refund_reason: reason || "requested_by_customer",
        },
      }, {
        idempotencyKey: this.getIdempotencyKey(handle_id, "refund"),
      });
      
      return {
        ok: true,
        status: "refunded",
        paid_amount: refund.amount / 100,
        handle_id: refund.id,
        refunded_at_ms: Date.now(),
        meta: {
          refund_id: refund.id,
          charge_id: chargeId,
          status: refund.status,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        status: "failed",
        paid_amount: 0,
        handle_id,
        failure_code: "STRIPE_REFUND_FAILED",
        failure_reason: error.message,
      };
    }
  }
  
  private getIdempotencyKey(intentId: string, operation: string): string {
    const prefix = this.config.idempotency_prefix || "pact";
    return `${prefix}_${intentId}_${operation}`;
  }
  
  // Implement other required SettlementProvider methods
  getBalance(_agentId: string, _chain?: string, _asset?: string): number {
    // Stripe doesn't maintain balances - this is for accounting only
    return 0;
  }
  
  lock(_agentId: string, _amount: number, _chain?: string, _asset?: string): void {
    // Locking handled via PaymentIntent creation
  }
  
  unlock(_agentId: string, _amount: number, _chain?: string, _asset?: string): void {
    // Unlocking handled via PaymentIntent cancellation
  }
  
  credit(_agentId: string, _amount: number, _chain?: string, _asset?: string): void {
    // Crediting handled via refunds
  }
  
  debit(_agentId: string, _amount: number, _chain?: string, _asset?: string): void {
    // Debiting handled via captures
  }
  
  pay(_buyerId: string, _sellerId: string, _amount: number, _chain?: string, _asset?: string): void {
    // Payment handled via PaymentIntent capture
  }
}
```

**Option B: Replace Factory Implementation**

```typescript
// In your service, replace the factory implementation
import { createSettlementProvider } from "@pact/sdk";
import { MyStripeProvider } from "./my-stripe";

// Override factory for stripe_live
const originalFactory = createSettlementProvider;
export function createSettlementProvider(config: SettlementProviderConfig): SettlementProvider {
  if (config.provider === "stripe_live") {
    const validation = validateStripeConfig(config.params || {});
    if (!validation.ok) {
      throw new Error(`Stripe config invalid: ${validation.reason}`);
    }
    return new MyStripeProvider(validation.config);
  }
  
  // Use default factory for other providers
  return originalFactory(config);
}
```

### Step 3: Configure Environment

```bash
# Set Stripe API key (never commit to repo)
export PACT_STRIPE_API_KEY=sk_live_...

# Set mode (optional, defaults to sandbox)
export PACT_STRIPE_MODE=live  # or sandbox
```

### Step 4: Use in acquire()

```typescript
import { acquire } from "@pact/sdk";
import { createSettlementProvider } from "./my-factory"; // Your custom factory

const settlement = createSettlementProvider({
  provider: "stripe_live",
  params: {
    mode: process.env.PACT_STRIPE_MODE || "sandbox",
    enabled: true,
    // api_key read from PACT_STRIPE_API_KEY env
  },
});

const result = await acquire({
  input: {
    intentType: "weather.data",
    // ... other params
  },
  settlement,
  // ... other params
});
```

## Payment Flow Mapping

PACT lifecycle → Stripe operations:

| PACT Operation | Stripe Operation | Description |
|---------------|------------------|-------------|
| `prepare()` | `paymentIntents.create()` | Authorize funds (don't capture yet) |
| `commit()` | `paymentIntents.capture()` | Capture authorized funds |
| `abort()` | `paymentIntents.cancel()` | Void authorization |
| `poll()` | `paymentIntents.retrieve()` | Check PaymentIntent status |
| `refund()` | `refunds.create()` | Refund captured payment |

## Testing

**Sandbox Mode:**

```typescript
// Use Stripe test mode
const settlement = createSettlementProvider({
  provider: "stripe_live",
  params: {
    mode: "sandbox", // Uses test API keys
    enabled: true,
  },
});
```

**Test Cards:**
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Requires auth: `4000 0025 0000 3155`

## Security Considerations

1. **Never commit API keys**: Always use environment variables
2. **Use idempotency keys**: Prevent duplicate operations
3. **Validate webhooks**: Verify webhook signatures
4. **Handle errors gracefully**: Network failures, rate limits, etc.
5. **Log securely**: Never log full API keys (redact middle characters)

## Error Handling

Handle common Stripe errors:

```typescript
try {
  const paymentIntent = await this.stripe.paymentIntents.create(/* ... */);
} catch (error: any) {
  if (error.type === "StripeCardError") {
    // Card declined
  } else if (error.type === "StripeRateLimitError") {
    // Rate limited - retry with backoff
  } else if (error.type === "StripeInvalidRequestError") {
    // Invalid request - check parameters
  } else if (error.type === "StripeAPIError") {
    // Stripe API error - retry later
  } else if (error.type === "StripeConnectionError") {
    // Network error - retry
  } else if (error.type === "StripeAuthenticationError") {
    // Authentication failed - check API key
  } else {
    // Unknown error
  }
}
```

## Limitations & Future Enhancements

**Current Limitations:**
- No built-in webhook handling
- No async commit support (manual polling required)
- No multi-currency support (assumes USD/USDC)

**Future Enhancements:**
- Webhook integration for async updates
- Multi-currency support
- Automatic retry with exponential backoff
- Webhook signature verification helpers

---

**Note**: This is an integration guide. Actual Stripe implementation requires Stripe SDK knowledge and API access.
