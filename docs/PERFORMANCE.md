# Performance Considerations

This document outlines performance considerations and optimization strategies for PACT v3 implementations.

## Overview

PACT is designed for deterministic, verifiable negotiation between agents. Performance is important for real-world applications, but determinism and correctness take priority over raw speed.

## Performance Characteristics

### Negotiation

- **Time Complexity**: O(rounds × providers)
- **Typical Duration**: 10-100ms for 3 rounds with 1-10 providers
- **Bottlenecks**: Network latency (HTTP), provider response time, signature verification

### Settlement

- **Time Complexity**: O(1) for in-memory, O(network) for external
- **Typical Duration**: 5-50ms (in-memory), 100-1000ms (Stripe/external)
- **Bottlenecks**: External API calls, network latency, idempotency checks

### ZK-KYA Verification

- **Time Complexity**: O(1) for expiration checks, O(circuit_size) for verification
- **Typical Duration**: <1ms (expiration only), 10-1000ms (full Groth16 verification)
- **Bottlenecks**: Cryptographic verification, circuit complexity, key loading

## Optimization Strategies

### 1. Lazy Loading

Load optional dependencies only when needed:

```typescript
// Bad: Load stripe on construction
constructor(config: StripeConfig) {
  this.stripe = new Stripe(config.api_key); // Always loaded
}

// Good: Lazy load
private stripe?: Stripe;

private getStripe(): Stripe {
  if (!this.stripe) {
    this.stripe = new Stripe(this.config.api_key); // Load on first use
  }
  return this.stripe;
}
```

**Impact**: Reduces initialization time when optional dependencies aren't used.

### 2. Caching

Cache expensive operations:

```typescript
// Cache verifying keys for ZK-KYA
private verifyingKeyCache = new Map<string, any>();

async loadVerifyingKey(circuitId: string): Promise<any> {
  if (this.verifyingKeyCache.has(circuitId)) {
    return this.verifyingKeyCache.get(circuitId)!;
  }
  
  const key = await fetchVerifyingKey(circuitId); // Expensive operation
  this.verifyingKeyCache.set(circuitId, key);
  return key;
}
```

**Impact**: Reduces repeated key loads from ~100ms to ~0.1ms for cached keys.

### 3. Early Validation

Validate inputs before expensive operations:

```typescript
// Bad: Verify proof before checking expiration
async verify(proof: ZkKyaProof): Promise<boolean> {
  const isValid = await this.snarkjs.groth16.verify(/* ... */); // Expensive
  if (proof.expires_at_ms < Date.now()) {
    return false; // Too late!
  }
  return isValid;
}

// Good: Check expiration first
async verify(proof: ZkKyaProof): Promise<boolean> {
  if (proof.expires_at_ms && proof.expires_at_ms < Date.now()) {
    return false; // Fast path: expired
  }
  const isValid = await this.snarkjs.groth16.verify(/* ... */); // Only if not expired
  return isValid;
}
```

**Impact**: Expired proofs fail in <1ms instead of 100-1000ms.

### 4. Timeout Management

Set reasonable timeouts to prevent hanging:

```typescript
// Set timeouts for external operations
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

**Impact**: Prevents indefinite hangs, allows fallback strategies.

### 5. Idempotency Checks

Use idempotency keys to avoid duplicate operations:

```typescript
// Check idempotency before expensive operations
async prepare(intent: SettlementIntent): Promise<SettlementHandle> {
  const handleId = intent.idempotency_key 
    ? `${intent.intent_id}:${intent.idempotency_key}`
    : `${intent.intent_id}:${Date.now()}`;
  
  // Fast path: Already prepared
  const existing = this.handles.get(handleId);
  if (existing) {
    return existing; // O(1) lookup, no work needed
  }
  
  // Slow path: Lock funds
  this.lock(intent.from, intent.amount); // Expensive operation
  // ...
}
```

**Impact**: Duplicate requests return in ~0.1ms instead of ~50ms.

### 6. Batch Operations

Batch operations where possible:

```typescript
// Bad: Multiple individual queries
const balance1 = provider.getBalance(agent1);
const balance2 = provider.getBalance(agent2);
const balance3 = provider.getBalance(agent3);

// Good: Batch query (if supported)
const balances = provider.getBalances([agent1, agent2, agent3]);
```

**Impact**: Reduces network round trips (future optimization).

## Memory Considerations

### Settlement Provider

- **In-Memory**: ~1KB per agent (balance + locked)
- **Stripe**: No in-memory storage (queries API)
- **Cache**: ~100 bytes per verifying key (if cached)

### Transcripts

- **Size**: ~1-10KB per negotiation (JSON)
- **Storage**: File system or database
- **Compression**: Can be gzipped (70-90% reduction)

### Provider Directory

- **In-Memory**: ~500 bytes per provider
- **100 Providers**: ~50KB total
- **Scalability**: Linear with provider count

## Network Considerations

### Negotiation

- **Requests per Round**: 1 HTTP request per provider
- **Typical Latency**: 10-100ms per request
- **Parallelization**: Can query multiple providers in parallel

### Settlement

- **Stripe API**: 100-500ms per operation
- **Idempotency**: Use idempotency keys to enable safe retries
- **Retry Logic**: Exponential backoff for transient failures

### ZK-KYA

- **Verifying Key Load**: 100-500ms (first time, if not cached)
- **Verification**: 10-1000ms (depending on circuit)
- **No Network**: Expiration checks are local (<1ms)

## Benchmarking Guidelines

### Negotiation Performance

```typescript
// Measure negotiation time
const start = Date.now();
const result = await acquire({ /* ... */ });
const duration = Date.now() - start;

console.log(`Negotiation took ${duration}ms`);
console.log(`Rounds: ${result.receipt?.rounds || 0}`);
console.log(`Providers queried: ${directory.size()}`);
```

**Targets**:
- 3 rounds, 5 providers: <500ms
- 1 round, 1 provider: <100ms

### Settlement Performance

```typescript
// Measure settlement time
const start = Date.now();
const handle = await settlement.prepare(intent);
const result = await settlement.commit(handle.handle_id);
const duration = Date.now() - start;

console.log(`Settlement took ${duration}ms`);
```

**Targets**:
- In-memory: <10ms
- Stripe (sandbox): <500ms
- Stripe (production): <1000ms

### ZK-KYA Performance

```typescript
// Measure verification time
const start = Date.now();
const result = await verifier.verify({ proof, /* ... */ });
const duration = Date.now() - start;

console.log(`Verification took ${duration}ms`);
```

**Targets**:
- Expiration check: <1ms
- Full Groth16 verification: <1000ms

## Best Practices

1. **Profile First**: Use profiling to identify bottlenecks
2. **Optimize Hot Paths**: Focus on frequently executed code
3. **Cache Aggressively**: Cache expensive operations (keys, configurations)
4. **Validate Early**: Fail fast on invalid inputs
5. **Set Timeouts**: Prevent indefinite hangs
6. **Use Idempotency**: Enable safe retries
7. **Monitor Performance**: Track performance metrics in production

## Future Optimizations

1. **Parallel Provider Queries**: Query multiple providers simultaneously
2. **Batch Settlement**: Group multiple settlements into single operations
3. **Proof Pooling**: Reuse ZK proofs when valid
4. **Transcript Streaming**: Stream transcripts instead of storing full JSON
5. **Provider Caching**: Cache provider capabilities and pricing

## Summary

PACT's performance is sufficient for most real-world applications:
- **Negotiation**: 10-500ms (acceptable for agent-to-agent)
- **Settlement**: 5-1000ms (depends on backend)
- **ZK-KYA**: <1ms to 1000ms (depends on verification depth)

Optimizations focus on:
- **Lazy loading** optional dependencies
- **Caching** expensive operations
- **Early validation** to fail fast
- **Idempotency** to enable safe retries
- **Timeouts** to prevent hangs

Performance should not compromise determinism or correctness.
