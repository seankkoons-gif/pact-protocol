# Pact Provider Policy Profiles

Reusable policy configuration profiles for Pact v3 providers. These are pure configuration objects - no logic, just composable policy definitions.

## Quick Start

```typescript
import { 
  fastSmallPurchaseProfile,
  lowTrustHighRiskProfile,
  enterpriseComplianceProfile,
  createPolicyFromProfile 
} from "@pact/sdk";

// Create a policy from a profile
const policy = createPolicyFromProfile(fastSmallPurchaseProfile, {
  policy_id: "my-provider-policy-123"
});
```

## Available Profiles

### 1. `fastSmallPurchaseProfile`

**Use Case:** E-commerce, micro-payments, consumer services

**Characteristics:**
- ✅ **Max rounds:** 1 (INTENT → ASK → ACCEPT, no counter-offers)
- ✅ **Settlement rails:** `hash_reveal` only
- ✅ **Min KYA tier:** `untrusted` (no KYA required)
- ✅ **Dispute window:** 5 minutes
- ✅ **Strategy:** `fastest` (prioritize speed)

**Key Settings:**
- No minimum reputation requirement
- No ZK-KYA required
- Lower bonds (1x price)
- Short negotiation duration (30 seconds max)
- Consumer-friendly (low friction)

### 2. `lowTrustHighRiskProfile`

**Use Case:** High-value transactions, untrusted counterparties, risk-sensitive operations

**Characteristics:**
- ✅ **Max rounds:** 5 (allows careful negotiation)
- ✅ **Settlement rails:** `hash_reveal` only
- ✅ **Min KYA tier:** `trusted` (ZK-KYA required)
- ✅ **Dispute window:** 24 hours
- ✅ **Strategy:** `trusted_only` (only negotiate with trusted parties)

**Key Settings:**
- High reputation requirement (85%)
- ZK-KYA required with trusted issuers
- High bonds (5x price, buyer bond required)
- Long dispute window (24 hours)
- Strict failure/timeout rates (1% max)

### 3. `enterpriseComplianceProfile`

**Use Case:** Enterprise services, regulated industries, compliance-critical applications

**Characteristics:**
- ✅ **Max rounds:** 3 (standard negotiation)
- ✅ **Settlement rails:** `hash_reveal` only
- ✅ **Min KYA tier:** `trusted` (ZK-KYA required)
- ✅ **Dispute window:** 72 hours
- ✅ **Strategy:** `balanced` (balance speed, price, security)

**Key Settings:**
- Very high reputation requirement (90%)
- Enterprise credentials required
- Full transcript storage (compliance audit trail)
- Fine-grained explanations
- Strict anti-gaming (98% honor rate)
- Long dispute window (72 hours for enterprise review)

## Profile Comparison

| Feature | Fast Small Purchase | Low Trust High Risk | Enterprise Compliance |
|---------|-------------------|-------------------|---------------------|
| **Max Rounds** | 1 | 5 | 3 |
| **Strategy** | `fastest` | `trusted_only` | `balanced` |
| **Min KYA Tier** | `untrusted` | `trusted` | `trusted` |
| **ZK-KYA Required** | ❌ No | ✅ Yes | ✅ Yes |
| **Min Reputation** | 0.0 | 0.85 | 0.9 |
| **Bond Multiple** | 1.0x | 5.0x | 3.0x |
| **Buyer Bond** | Optional | Required (20%) | Required (15%) |
| **Dispute Window** | 5 min | 24 hours | 72 hours |
| **Transcript Storage** | ❌ No | ❌ No | ✅ Yes (full) |

## Composing Profiles

Profiles are composable - you can merge multiple profiles or override specific fields:

```typescript
import { createPolicyFromProfile, fastSmallPurchaseProfile } from "@pact/sdk";

// Override specific fields
const customPolicy = createPolicyFromProfile(fastSmallPurchaseProfile, {
  policy_id: "custom-policy",
  name: "my-custom-policy",
  negotiation: {
    ...fastSmallPurchaseProfile.negotiation,
    max_rounds: 2, // Allow 2 rounds instead of 1
  },
});
```

## Making Negotiation Behavior Hard to Copy

These profiles encode **composable policy configurations** that are:

1. **Reusable**: Same profile works across different providers
2. **Verifiable**: Configuration is explicit and auditable
3. **Composable**: Can be merged/extended for custom needs
4. **Hard to copy**: Well-structured configs require understanding the policy system

**Why hard to copy?**
- Policy structure is complex (many interrelated fields)
- Profiles encode nuanced trade-offs (speed vs security vs compliance)
- Composable design means copying surface-level configs isn't enough
- Understanding requires knowledge of Pact policy semantics

## Custom Profiles

Create your own profile by defining a `Partial<PactPolicy>`:

```typescript
const myCustomProfile: Partial<PactPolicy> = {
  name: "my-custom-profile",
  mode: "best_price",
  negotiation: {
    max_rounds: 2,
    // ... other negotiation settings
  },
  settlement: {
    allowed_modes: ["hash_reveal", "streaming"],
    // ... other settlement settings
  },
  // ... other policy sections
};

const policy = createPolicyFromProfile(myCustomProfile);
```

## Usage in Provider Code

```typescript
import { 
  createPolicyFromProfile, 
  fastSmallPurchaseProfile,
  validatePolicyJson 
} from "@pact/sdk";
import { DefaultPolicyGuard } from "@pact/sdk";

// Create policy from profile
const policy = createPolicyFromProfile(fastSmallPurchaseProfile, {
  policy_id: "provider-policy-001"
});

// Validate policy
const validation = validatePolicyJson(policy);
if (!validation.ok) {
  throw new Error(`Policy invalid: ${validation.errors}`);
}

// Use with policy guard
const policyGuard = new DefaultPolicyGuard(validation.policy);

// Use in negotiation
// ... provider code uses policyGuard.checkIntent(), etc.
```

## Documentation

- [Pact Policy Schema](../../../specs/pact-policy/1.0/schema.json)
- [Policy Types](./types.ts)
- [Default Policy](./defaultPolicy.ts)
