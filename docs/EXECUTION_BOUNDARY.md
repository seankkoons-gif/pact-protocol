# Execution Boundary Architecture (v2)

This document explains the execution boundary architecture for settlement providers in Pact v2. It defines the separation between deterministic (testable) providers and live (production) providers, and how to extend the system without modifying `acquire()`.

---

## Overview

Pact's settlement system uses a **provider boundary pattern** to separate:

1. **Deterministic Providers**: Fully testable, no external dependencies (e.g., `mock`, `stripe_like`)
2. **Live Providers**: Require external integration, intentionally incomplete in OSS (e.g., `stripe_live`)

This architecture ensures:
- ✅ `acquire()` never needs to change when adding new providers
- ✅ Deterministic providers enable full test coverage
- ✅ Live providers define clear integration boundaries
- ✅ Factory pattern enables runtime provider selection

---

## Deterministic vs Live Providers

### Deterministic Providers

**Purpose**: Fully testable settlement providers with no external dependencies.

**Characteristics**:
- ✅ No network calls
- ✅ No external APIs
- ✅ Deterministic behavior (same inputs → same outputs)
- ✅ Suitable for CI/CD and automated testing
- ✅ Can be used in examples and demos

**Examples**:
- `mock`: In-memory accounting (default)
- `stripe_like`: Simulated Stripe semantics (authorize/capture/void)

**Usage**:
```typescript
const settlement = createSettlementProvider({
  provider: "mock", // or "stripe_like"
  params: { /* optional config */ },
});
```

### Live Providers

**Purpose**: Boundary/skeleton implementations that require external integration.

**Characteristics**:
- ⚠️ Intentionally incomplete in OSS
- ⚠️ Return "not implemented" errors for all operations
- ⚠️ Validate configuration only
- ⚠️ No network calls in OSS repo
- ✅ Define clear integration interface
- ✅ Enable policy-driven routing

**Examples**:
- `stripe_live`: Stripe Live API integration boundary

**Usage**:
```typescript
const settlement = createSettlementProvider({
  provider: "stripe_live",
  params: {
    mode: "live", // or "sandbox"
    // api_key read from PACT_STRIPE_API_KEY env
  },
});
// All operations return "not implemented" until integrated externally
```

---

## Why `stripe_like` Exists

### Purpose

`stripe_like` is a **deterministic simulation** of Stripe's payment semantics for testing and development.

### Design Rationale

1. **Testing**: Enables testing Stripe-like flows (authorize/capture/void) without external dependencies
2. **Development**: Allows developers to work with Stripe semantics locally
3. **CI/CD**: Deterministic behavior enables automated testing
4. **Examples**: Can be used in examples and demos without API keys

### Semantics

`stripe_like` maps Pact's settlement lifecycle to Stripe's payment flow:

- `prepare()` → **Authorize** (lock funds, create payment_intent)
- `commit()` → **Capture** (move locked funds from buyer to seller)
- `abort()` → **Void authorization** (release locked funds back)

### Implementation

`stripe_like` delegates to `MockSettlementProvider` for accounting, but adds:
- Payment intent tracking
- Capture ID generation
- Async commit support (v1.7.2+)
- Idempotency handling

**Example**:
```typescript
const settlement = createSettlementProvider({
  provider: "stripe_like",
  params: {
    asyncCommit: true,        // Enable async commit
    commitDelayTicks: 3,      // Poll 3 times before commit resolves
    failCommit: false,        // Simulate commit failures
  },
});
```

### When to Use

- ✅ Testing Stripe-like flows
- ✅ Local development
- ✅ CI/CD pipelines
- ✅ Examples and demos
- ❌ Production (use `stripe_live` with external integration)

---

## Why `stripe_live` is Intentionally Incomplete

### Purpose

`stripe_live` is a **boundary/skeleton** that defines the integration interface for Stripe Live API without implementing it in the OSS repo.

### Design Rationale

1. **No Secrets in OSS**: Live API keys should never be in the public repository
2. **Integration Boundary**: Defines clear interface for external integration
3. **Policy Routing**: Enables policy-driven selection of live providers
4. **Configuration Validation**: Validates config without making network calls

### What It Does

✅ **Configuration Validation**:
- Validates `mode` ("sandbox" | "live")
- Reads `api_key` from `PACT_STRIPE_API_KEY` env (never logged)
- Validates `account_id`, `idempotency_prefix`
- Ensures `enabled=true` only if API key present

✅ **Interface Definition**:
- Implements `SettlementProvider` interface
- Defines `StripeConfig` type (supports both sandbox and live modes)
- Provides `validateStripeConfig()` function

❌ **What It Doesn't Do**:
- No network calls
- No Stripe SDK usage
- No actual payment processing
- All operations return "not implemented" errors

### Implementation

All operational methods return deterministic failures:

```typescript
async prepare(_intent: SettlementIntent): Promise<SettlementHandle> {
  throw new Error(
    redactApiKey("stripe_live is a boundary only; enable via env and integrate externally")
  );
}

async commit(_handle_id: string): Promise<SettlementResult> {
  return {
    ok: false,
    status: "failed",
    paid_amount: 0,
    handle_id: _handle_id,
    failure_code: "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
    failure_reason: redactApiKey("stripe_live is a boundary only; enable via env and integrate externally"),
  };
}
```

### Integration Path

To use `stripe_live` in production:

1. **Fork or extend** the OSS repo
2. **Replace** `StripeSettlementProvider` implementation (or extend it)
3. **Add** Stripe SDK integration
4. **Implement** `prepare()`, `commit()`, `abort()`, `poll()`, `refund()`
5. **Keep** configuration validation and secret redaction

**Example Integration**:
```typescript
// In your service (not OSS repo)
import { StripeSettlementProvider, StripeConfig } from "@pact/sdk";
import Stripe from "stripe";

class MyStripeProvider extends StripeSettlementProvider {
  private stripe: Stripe;
  
  constructor(config: StripeConfig) {
    super(config);
    this.stripe = new Stripe(config.api_key!);
  }
  
  async prepare(intent: SettlementIntent): Promise<SettlementHandle> {
    // Actual Stripe API call
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: intent.amount * 100, // Convert to cents
      currency: "usd",
      // ... other params
    });
    
    return {
      handle_id: paymentIntent.id,
      status: "prepared",
      // ...
    };
  }
  
  // ... implement other methods
}
```

---

## How to Extend Without Touching `acquire()`

### Architecture Pattern

Pact uses a **factory pattern** with a **provider interface** to enable extension without modifying `acquire()`.

### Extension Steps

#### 1. Define Your Provider Interface

Your provider must implement `SettlementProvider`:

```typescript
import type { SettlementProvider } from "@pact/sdk";

export class MyCustomProvider implements SettlementProvider {
  // Implement all required methods
  getBalance(agentId: string, chain?: string, asset?: string): number { /* ... */ }
  lock(agentId: string, amount: number, chain?: string, asset?: string): void { /* ... */ }
  // ... etc
}
```

#### 2. Add to Factory

Update `packages/sdk/src/settlement/factory.ts`:

```typescript
import { MyCustomProvider } from "./my_custom";

export interface SettlementProviderConfig {
  provider: "mock" | "external" | "stripe_like" | "stripe_live" | "my_custom"; // Add here
  params?: Record<string, unknown>;
  idempotency_key?: string;
}

export function createSettlementProvider(config: SettlementProviderConfig): SettlementProvider {
  switch (config.provider) {
    // ... existing cases ...
    
    case "my_custom": {
      // Validate config
      const validation = validateMyCustomConfig(config.params || {});
      if (!validation.ok) {
        throw new Error(`MyCustom provider config invalid: ${validation.reason}`);
      }
      return new MyCustomProvider(validation.config);
    }
    
    default:
      throw new Error(`Unknown settlement provider type: ${config.provider}`);
  }
}
```

#### 3. Add to Routing (Optional)

If you want policy-driven routing, update `packages/sdk/src/settlement/routing.ts`:

```typescript
export interface SettlementRoutingResult {
  provider: "mock" | "stripe_like" | "external" | "stripe_live" | "my_custom"; // Add here
  matchedRuleIndex?: number;
  reason: string;
}
```

And update policy types in `packages/sdk/src/policy/types.ts`:

```typescript
export interface SettlementRoutingRule {
  when?: { /* ... */ };
  use: "mock" | "stripe_like" | "external" | "stripe_live" | "my_custom"; // Add here
}
```

#### 4. Add to Transcript Types (Optional)

If you want transcripts to record your provider, update `packages/sdk/src/transcript/types.ts`:

```typescript
export type TranscriptV1 = {
  // ...
  settlement_lifecycle?: {
    provider?: string; // "mock" | "stripe_like" | "external" | "stripe_live" | "my_custom"
    // ...
  };
  // ...
};
```

### Key Principles

1. **Never Modify `acquire()`**: All provider logic is in the provider implementation
2. **Factory Pattern**: `acquire()` calls `createSettlementProvider()`, not provider constructors
3. **Interface Contract**: All providers implement `SettlementProvider` interface
4. **Configuration Validation**: Validate config in factory, not in `acquire()`
5. **Secret Redaction**: Use `redactApiKey()` for any error messages containing secrets

### Example: Adding a New Deterministic Provider

```typescript
// packages/sdk/src/settlement/my_deterministic.ts
import type { SettlementProvider } from "./provider";
import { MockSettlementProvider } from "./mock";

export class MyDeterministicProvider implements SettlementProvider {
  private mock: MockSettlementProvider;
  
  constructor() {
    this.mock = new MockSettlementProvider();
  }
  
  // Delegate to mock for accounting
  getBalance(agentId: string): number {
    return this.mock.getBalance(agentId);
  }
  
  // Add custom logic
  async prepare(intent: SettlementIntent): Promise<SettlementHandle> {
    // Custom deterministic logic
    return { handle_id: "custom-123", status: "prepared" };
  }
  
  // ... implement other methods
}
```

### Example: Adding a New Live Provider Boundary

```typescript
// packages/sdk/src/settlement/my_live.ts
import type { SettlementProvider } from "./provider";

export interface MyLiveConfig {
  api_key?: string; // From env
  enabled: boolean;
}

export function validateMyLiveConfig(input: unknown): 
  | { ok: true; config: MyLiveConfig }
  | { ok: false; code: string; reason: string } {
  // Validate config
  // ...
}

export class MyLiveSettlementProvider implements SettlementProvider {
  private config: MyLiveConfig;
  
  constructor(config: MyLiveConfig) {
    this.config = config;
  }
  
  // All methods return "not implemented"
  async prepare(_intent: SettlementIntent): Promise<SettlementHandle> {
    throw new Error("my_live is a boundary only; integrate externally");
  }
  
  // ... implement other methods with "not implemented" errors
}
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        acquire()                            │
│  (Never changes when adding providers)                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ calls
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              createSettlementProvider()                     │
│                    (Factory)                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│    mock      │ │ stripe_like  │ │ stripe_live  │
│ (deterministic)│ (deterministic)│ (boundary)    │
└──────────────┘ └──────────────┘ └──────────────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │ SettlementProvider   │
            │    (Interface)       │
            └──────────────────────┘
```

---

## Best Practices

### For Deterministic Providers

1. ✅ Use `MockSettlementProvider` for accounting
2. ✅ Make all operations deterministic (no randomness)
3. ✅ Support async operations via `poll()` if needed
4. ✅ Include comprehensive tests
5. ✅ Document configuration options

### For Live Provider Boundaries

1. ✅ Validate configuration only
2. ✅ Return "not implemented" for all operations
3. ✅ Never make network calls in OSS
4. ✅ Use `redactApiKey()` for error messages
5. ✅ Document integration requirements
6. ✅ Provide clear error messages

### For Integration

1. ✅ Fork or extend OSS repo
2. ✅ Replace boundary implementation
3. ✅ Keep configuration validation
4. ✅ Keep secret redaction
5. ✅ Add comprehensive error handling
6. ✅ Test with sandbox mode first

---

## Summary

- **Deterministic Providers** (`mock`, `stripe_like`): Fully testable, no external dependencies
- **Live Provider Boundaries** (`stripe_live`): Intentionally incomplete, require external integration
- **Factory Pattern**: Enables extension without modifying `acquire()`
- **Interface Contract**: All providers implement `SettlementProvider`
- **Configuration Validation**: Validate in factory, not in `acquire()`

This architecture ensures that:
- ✅ `acquire()` remains stable and testable
- ✅ New providers can be added without core changes
- ✅ Deterministic providers enable full test coverage
- ✅ Live providers define clear integration boundaries

---

## References

- `packages/sdk/src/settlement/provider.ts`: SettlementProvider interface
- `packages/sdk/src/settlement/factory.ts`: Provider factory
- `packages/sdk/src/settlement/mock.ts`: Deterministic mock provider
- `packages/sdk/src/settlement/stripe_like.ts`: Deterministic Stripe-like provider
- `packages/sdk/src/settlement/stripe_live.ts`: Live Stripe boundary
- `packages/sdk/src/client/acquire.ts`: Core acquisition function (never modify for providers)
