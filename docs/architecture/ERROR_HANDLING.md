# Error Handling and Edge Cases

This document describes error handling patterns and edge case considerations for PACT v3 implementations.

## Error Handling Principles

1. **Fail Fast**: Validate inputs and fail early with clear error messages
2. **Graceful Degradation**: Optional dependencies should degrade gracefully
3. **Clear Error Messages**: Errors should guide developers to solutions
4. **Type Safety**: Use typed errors where possible
5. **Idempotency**: Operations should be safe to retry

## Stripe Integration Error Handling

### Network Failures

```typescript
// Real implementation should handle network failures
async prepare(intent: SettlementIntent): Promise<SettlementHandle> {
  try {
    // Stripe API call with timeout
    const paymentIntent = await Promise.race([
      this.stripe.paymentIntents.create({ /* ... */ }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Network timeout")), 30000)
      ),
    ]);
  } catch (error: any) {
    // Classify error types
    if (error.code === "card_declined") {
      throw new Error("Payment declined: Insufficient funds or card limit");
    } else if (error.type === "StripeConnectionError") {
      throw new Error("Network error: Unable to connect to Stripe. Retry later.");
    } else if (error.type === "StripeAPIError" && error.statusCode >= 500) {
      // Transient server error - could retry
      throw new Error("Stripe server error: Retry later");
    } else {
      // Redact API keys from error messages
      throw new Error(`Stripe error: ${redactApiKey(error.message)}`);
    }
  }
}
```

### Edge Cases

1. **Idempotency**: Same `idempotency_key` should return same result
2. **Race Conditions**: Handle concurrent requests to same intent
3. **Amount Precision**: Stripe uses cents; handle rounding correctly
4. **Currency Mismatch**: Ensure consistent currency across operations
5. **Account States**: Handle suspended/deleted Stripe accounts

### Retry Logic

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  backoffMs: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      // Only retry on transient errors
      if (i === maxRetries - 1 || !isTransientError(error)) {
        throw error;
      }
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, i)));
    }
  }
  throw new Error("Max retries exceeded");
}
```

## ZK-KYA Verification Error Handling

### Invalid Proofs

```typescript
async verify(input: {
  agent_id: string;
  proof: ZkKyaProof;
  now_ms: number;
}): Promise<ZkKyaVerificationResult> {
  // Validate proof structure first
  if (!input.proof.scheme || !input.proof.circuit_id) {
    return {
      ok: false,
      reason: "ZK_KYA_INVALID: Proof missing required fields (scheme, circuit_id)",
    };
  }

  // Check expiration (before expensive verification)
  if (input.proof.expires_at_ms && input.now_ms > input.proof.expires_at_ms) {
    return {
      ok: false,
      reason: `ZK_KYA_EXPIRED: Proof expired at ${input.proof.expires_at_ms}`,
    };
  }

  // Validate circuit_id format
  if (!/^[a-z0-9_]+$/.test(input.proof.circuit_id)) {
    return {
      ok: false,
      reason: "ZK_KYA_INVALID: Invalid circuit_id format",
    };
  }

  // ... rest of verification
}
```

### Edge Cases

1. **Expired Proofs**: Check expiration before expensive verification
2. **Malformed Proofs**: Validate proof structure before processing
3. **Missing Circuit Keys**: Handle missing verifying keys gracefully
4. **Proof Size Limits**: Reject proofs exceeding size limits
5. **Verification Timeouts**: Set timeout for verification operations

## Settlement Provider Error Handling

### Insufficient Balance

```typescript
lock(agentId: string, amount: number): void {
  if (amount < 0) {
    throw new Error(`Invalid lock amount: ${amount} (must be >= 0)`);
  }
  
  if (amount === 0) {
    // Edge case: locking zero is a no-op, but don't throw
    return;
  }
  
  const balance = this.balances.get(agentId) || 0;
  if (balance < amount) {
    // Include available balance in error for debugging
    throw new Error(
      `Insufficient balance: ${balance} < ${amount} (agent: ${agentId})`
    );
  }
  
  // ... lock operation
}
```

### Concurrency

```typescript
// Use locks or atomic operations for concurrent access
private locks = new Map<string, Promise<void>>();

async prepare(intent: SettlementIntent): Promise<SettlementHandle> {
  const lockKey = intent.intent_id;
  
  // Acquire lock for this intent
  if (this.locks.has(lockKey)) {
    await this.locks.get(lockKey);
  }
  
  const lockPromise = this.doPrepare(intent);
  this.locks.set(lockKey, lockPromise);
  
  try {
    return await lockPromise;
  } finally {
    this.locks.delete(lockKey);
  }
}
```

## Performance Considerations

### Lazy Loading

```typescript
// Don't load optional dependencies until needed
private stripe?: Stripe;

private getStripe(): Stripe {
  if (!this.stripe) {
    this.stripe = new Stripe(this.config.api_key);
  }
  return this.stripe;
}
```

### Caching

```typescript
// Cache verifying keys to avoid repeated loads
private verifyingKeyCache = new Map<string, any>();

async loadVerifyingKey(circuitId: string): Promise<any> {
  if (this.verifyingKeyCache.has(circuitId)) {
    return this.verifyingKeyCache.get(circuitId);
  }
  
  const key = await fetchVerifyingKey(circuitId);
  this.verifyingKeyCache.set(circuitId, key);
  return key;
}
```

### Timeout Management

```typescript
// Set reasonable timeouts for external operations
const STRIPE_TIMEOUT_MS = 30000; // 30 seconds
const ZK_VERIFICATION_TIMEOUT_MS = 60000; // 60 seconds

async withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  );
  
  return Promise.race([promise, timeout]);
}
```

## Best Practices

1. **Validate Early**: Check inputs before expensive operations
2. **Fail Gracefully**: Optional dependencies should degrade, not crash
3. **Log Errors**: Log errors with context (without secrets)
4. **Use Types**: Type errors to enable better error handling
5. **Test Edge Cases**: Include edge cases in tests
6. **Document Errors**: Document expected errors in API docs

## Error Classification

- **User Errors**: Invalid inputs, validation failures (400s)
- **Transient Errors**: Network failures, timeouts (500s, retriable)
- **Permanent Errors**: Invalid API keys, unsupported operations (400s, non-retriable)
- **System Errors**: Internal failures, bugs (500s)
