# Anti-Gaming Protections for Pact v3

Lightweight, in-memory anti-gaming protections for provider-side negotiation security.

## Features

### 1. Rate Limiting (Per Agent Identity)

**In-memory rate limiting** to prevent request spam:
- Tracks requests per agent per intent type
- Rolling window (default: 60 seconds)
- Configurable limit (default: 30 requests/minute)

**Deterministic:** Same agent + same time window = same result

```typescript
const guard = new AntiGamingGuard();
const check = guard.checkRateLimit("agent-123", "weather.data");
if (!check.ok) {
  // Rate limit exceeded
}
```

### 2. Reputation-Weighted Quote Acceptance

**Adjusts acceptance threshold based on reputation:**
- Lower reputation agents must bid higher
- Formula: `adjusted_ask = ask * (1 - weight * (1 - reputation))`
- Configurable reputation influence (default: 30%)

**Deterministic:** Same reputation + same prices = same decision

```typescript
const decision = guard.calculateReputationWeightedAcceptance({
  agentId: "agent-123",
  reputation: 0.7, // 70% reputation
  bidPrice: 0.0001,
  askPrice: 0.0001,
});
// decision.accept = true/false
// decision.reason = explainable reason
// decision.adjustedPrice = price after reputation weighting
```

### 3. Rejection Penalties (Bad-Faith Bids)

**Tracks repeated rejections and applies penalties:**
- Counts rejections in time window (default: 5 minutes)
- Threshold triggers penalty (default: 3 rejections)
- Penalty multiplies ask price (default: +10%)
- Penalty decays over time (default: 1 hour)

**Deterministic:** Same rejection history = same penalty

```typescript
const result = guard.recordRejection({
  agentId: "agent-123",
  intentId: "intent-456",
  reason: "Price too low",
  priceOffered: 0.00005,
  priceAsked: 0.0001,
});
// result.badFaithDetected = true if threshold exceeded
// result.penaltyMultiplier = 1.0 to 1.1+
// result.flags = ["bad_faith_rejections"] if suspicious
```

### 4. Transcript Flagging (Suspicious Behavior)

**Flags transcripts with suspicious behavior indicators:**
- Rate limit violations
- Bad-faith rejection patterns
- Rapid rejection sequences
- Consistently low counter-offers

**All flags are deterministic and explainable**

```typescript
const flagged = guard.flagTranscript(transcript, "agent-123");
// flagged.explain.anti_gaming_flags = ["bad_faith_history", "rate_limit_exceeded"]
```

## Configuration

```typescript
const guard = new AntiGamingGuard({
  rateLimitPerMinute: 30,
  enableReputationWeighting: true,
  reputationWeightMultiplier: 0.3,
  badFaithThreshold: 3,
  rejectionPenaltyMultiplier: 1.1,
  suspiciousBehaviorThresholds: {
    rapidRejections: 5,
    lowPriceOffers: 0.5,
  },
});
```

## Usage in Provider

```typescript
import { AntiGamingGuard } from "@pact/sdk/anti-gaming";

const guard = new AntiGamingGuard();

// In negotiation handler:
async function handleIntent(intent: IntentMessage, agentId: string) {
  // 1. Check rate limit
  const rateCheck = guard.checkRateLimit(agentId, intent.intent);
  if (!rateCheck.ok) {
    throw new Error(rateCheck.reason);
  }
  
  // 2. Calculate quote (with reputation weighting)
  const askPrice = calculateQuotePrice(intent);
  
  // 3. If bid received, use reputation-weighted acceptance
  if (bidReceived) {
    const decision = guard.calculateReputationWeightedAcceptance({
      agentId,
      reputation: getReputation(agentId),
      bidPrice: bid.price,
      askPrice,
    });
    
    if (!decision.accept) {
      // Record rejection
      guard.recordRejection({
        agentId,
        intentId: intent.intent_id,
        reason: decision.reason,
        priceOffered: bid.price,
        priceAsked: askPrice,
      });
    }
  }
  
  // 4. Flag transcript before returning
  const transcript = generateTranscript(...);
  return guard.flagTranscript(transcript, agentId);
}
```

## Deterministic Behavior

**All operations are deterministic:**

- **Rate limiting:** Same agent + same time window = same result
- **Reputation weighting:** Same inputs = same acceptance decision
- **Penalties:** Same rejection history = same penalty multiplier
- **Flagging:** Same transcript + same agent = same flags

**Transcript-backed:** All decisions are explainable via `getAgentStatus()` and transcript flags.

## Memory Management

**In-memory state:**
- Rate limits: `Map<agentId:intentType, AgentRateLimit>`
- Rejection history: `Map<agentId, AgentRejectionHistory>`

**Cleanup:**
```typescript
// Call periodically to prevent memory leaks
const { rateLimitsRemoved, rejectionsRemoved } = guard.cleanup();
```

**No databases:** All state is in-memory Maps, cleaned up automatically based on time windows.

## Limitations

- **Stateless across restarts:** State lost on process restart (by design - no persistence)
- **Single-instance:** Rate limits per process instance (not shared across instances)
- **Memory growth:** Old entries cleaned up, but Maps can grow with many agents

**For production:**
- Use external rate limiting (Redis, etc.) for multi-instance deployments
- Persist rejection history to database for long-term tracking
- Use distributed state for cross-instance coordination

## Integration with Policy Guard

The `AntiGamingGuard` works alongside `DefaultPolicyGuard`:

- **Policy Guard:** Enforces policy rules (reputation thresholds, etc.)
- **Anti-Gaming Guard:** Adds runtime protections (rate limits, penalties)

Both are deterministic and explainable.

## Transcript Example

```json
{
  "transcript_version": "1.0",
  "intent_id": "intent-123",
  "explain": {
    "anti_gaming_flags": ["bad_faith_history", "low_price_offer"],
    "level": "coarse",
    ...
  },
  "negotiation_rounds": [
    {
      "round": 1,
      "ask_price": 0.0001,
      "counter_price": 0.00003, // 70% below ask - flagged
      "accepted": false
    }
  ]
}
```
