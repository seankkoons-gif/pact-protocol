# ZK-KYA Integration Guide

This guide explains how to use ZK-KYA (Zero-Knowledge Know Your Agent) verification with PACT.

## Overview

PACT provides a **ZK-KYA verifier** that works out of the box when the `snarkjs` package is installed.

**Key Points:**
- **Works out of the box**: Install `snarkjs` package to enable real Groth16 verification
- **Graceful fallback**: Without `snarkjs`, returns clear errors (boundary mode)
- **Optional dependency**: `snarkjs` is an optional peer dependency
- **Production ready**: Real ZK verification when `snarkjs` package is installed

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        acquire()                            │
│  (Calls ZkKyaVerifier.verify() if ZK-KYA required)         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ calls
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              ZkKyaVerifier Interface                        │
│  (Pluggable - you implement this)                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Default    │ │    Test      │ │  Production  │
│   Verifier   │ │   Verifier   │ │  Verifier    │
│ (stub/CI)    │ │  (testing)   │ │ (your impl)  │
└──────────────┘ └──────────────┘ └──────────────┘
```

## ZK-KYA Verifier Interface

```typescript
export interface ZkKyaVerifier {
  /**
   * Verify a ZK-KYA proof.
   * 
   * @param input Verification input
   * @returns Verification result
   */
  verify(input: {
    agent_id: string;
    proof: ZkKyaVerifier;
    now_ms: number;
  }): Promise<ZkKyaVerificationResult>;
}
```

### Input

- `agent_id`: The agent identifier (buyer or seller)
- `proof`: The ZK-KYA proof object (see below)
- `now_ms`: Current timestamp in milliseconds (for expiry checks)

### Proof Structure

```typescript
interface ZkKyaProof {
  scheme: "groth16" | "plonk" | "halo2" | "unknown";
  circuit_id: string;                    // e.g., "kyc_v1", "reputation_v2"
  issuer_id?: string;                    // Optional issuer identifier
  public_inputs_hash: string;            // SHA-256 hash (hex) of canonicalized public inputs
  proof_hash: string;                     // SHA-256 hash (hex) of proof bytes
  issued_at_ms?: number;                  // Issuance timestamp (milliseconds)
  expires_at_ms?: number;                 // Expiration timestamp (milliseconds)
  meta?: Record<string, unknown>;         // Non-sensitive metadata
}
```

### Result

```typescript
type ZkKyaVerificationResult =
  | {
      ok: true;
      tier: "untrusted" | "low" | "trusted";
      trust_score: number; // 0.0 to 1.0
    }
  | {
      ok: false;
      reason: 
        | "ZK_KYA_NOT_IMPLEMENTED"
        | "ZK_KYA_INVALID"
        | "ZK_KYA_EXPIRED"
        | "ZK_KYA_TIER_TOO_LOW"
        | "ZK_KYA_ISSUER_NOT_ALLOWED";
    };
```

## Quick Start

### Option 1: Use Built-in Implementation (Recommended)

Simply install the `snarkjs` package alongside `@pact/sdk`:

```bash
npm install @pact/sdk snarkjs
# or
pnpm add @pact/sdk snarkjs
```

The built-in `DefaultZkKyaVerifier` automatically uses `snarkjs` when available:

```typescript
import { acquire, DefaultZkKyaVerifier } from "@pact/sdk";

// Default verifier automatically uses snarkjs if installed
const verifier = new DefaultZkKyaVerifier();

// Use in acquire() - ZK verification works automatically
const result = await acquire({
  // ... other options
  identity: {
    buyer: {
      zk_kya_proof: {
        scheme: "groth16",
        circuit_id: "kyc_v1",
        // ... proof data
      },
    },
  },
  // ZkKyaVerifier is used automatically if policy requires ZK-KYA
});
```

**That's it!** The built-in implementation handles:
- Groth16 proof verification (via snarkjs)
- Expiration checks
- Trust tier assignment

### Option 2: Custom Verifier (Advanced)

If you need custom verification logic or support for other ZK schemes, implement your own verifier:

## Implementation Steps (Custom Verifier)

### Step 1: Create Your Verifier

```typescript
import type { ZkKyaVerifier, ZkKyaProof, ZkKyaVerificationResult } from "@pact/sdk";

export class MyZkKyaVerifier implements ZkKyaVerifier {
  private verificationKey: Uint8Array; // Your verification key
  
  constructor(verificationKey: Uint8Array) {
    this.verificationKey = verificationKey;
  }
  
  async verify(input: {
    agent_id: string;
    proof: ZkKyaProof;
    now_ms: number;
  }): Promise<ZkKyaVerificationResult> {
    const { agent_id, proof, now_ms } = input;
    
    // 1. Validate proof expiry
    if (proof.expires_at_ms && proof.expires_at_ms < now_ms) {
      return {
        ok: false,
        reason: "ZK_KYA_EXPIRED",
      };
    }
    
    // 2. Validate issuer (if allow-listing required)
    if (proof.issuer_id && !this.isAllowedIssuer(proof.issuer_id)) {
      return {
        ok: false,
        reason: "ZK_KYA_ISSUER_NOT_ALLOWED",
      };
    }
    
    // 3. Verify proof using your ZK system (Groth16, PLONK, Halo2, etc.)
    // This is where you'd use your ZK library:
    // - snarkjs for Groth16
    // - halo2 or halo2-lib for Halo2
    // - circom for PLONK
    // etc.
    
    const isValid = await this.verifyProof(proof);
    
    if (!isValid) {
      return {
        ok: false,
        reason: "ZK_KYA_INVALID",
      };
    }
    
    // 4. Extract trust tier and score from public inputs or metadata
    const { tier, trustScore } = await this.extractTrustInfo(proof);
    
    // 5. Check minimum tier requirement
    if (tier === "untrusted" || (tier === "low" && this.requiresTrustedTier())) {
      return {
        ok: false,
        reason: "ZK_KYA_TIER_TOO_LOW",
      };
    }
    
    // 6. Return success
    return {
      ok: true,
      tier,
      trust_score: trustScore,
    };
  }
  
  private async verifyProof(proof: ZkKyaProof): Promise<boolean> {
    // Implement your ZK proof verification here
    // Example with snarkjs (Groth16):
    /*
    const { groth16 } = await import("snarkjs");
    
    // Reconstruct public inputs from proof metadata
    const publicInputs = await this.reconstructPublicInputs(proof);
    
    // Load verification key (stored separately, not in proof)
    const vk = await this.loadVerificationKey(proof.circuit_id);
    
    // Verify proof
    const isValid = await groth16.verify(
      vk,
      publicInputs,
      proof.proof_bytes // You'd need to store actual proof bytes separately
    );
    
    return isValid;
    */
    
    // For now, return false (implementation required)
    return false;
  }
  
  private async extractTrustInfo(proof: ZkKyaProof): Promise<{
    tier: "untrusted" | "low" | "trusted";
    trustScore: number;
  }> {
    // Extract trust tier and score from proof metadata or public inputs
    // This depends on your ZK circuit design
    
    // Example: Extract from meta field
    const tier = (proof.meta?.tier as string) || "untrusted";
    const trustScore = (proof.meta?.trust_score as number) || 0.0;
    
    return {
      tier: tier as "untrusted" | "low" | "trusted",
      trustScore,
    };
  }
  
  private isAllowedIssuer(issuerId: string): boolean {
    // Implement issuer allow-list check
    const allowedIssuers = [
      "issuer_pact_registry",
      "issuer_kyc_provider_v1",
      // ... your allowed issuers
    ];
    
    return allowedIssuers.includes(issuerId);
  }
  
  private requiresTrustedTier(): boolean {
    // Implement tier requirement check (from policy, config, etc.)
    return false; // or true if required
  }
}
```

### Step 2: Inject Verifier into acquire()

Currently, PACT doesn't have a verifier injection API. You'll need to:

**Option A: Fork PACT and Modify acquire()**

```typescript
// In your fork of PACT
import { MyZkKyaVerifier } from "./my-zk-verifier";

const result = await acquire({
  // ... other params
  zkKyaVerifier: new MyZkKyaVerifier(verificationKey), // Custom verifier
});
```

**Option B: Use Environment/Config (Future Enhancement)**

```typescript
// When verifier injection API is added
const result = await acquire({
  // ... other params
  zkKyaVerifier: process.env.ZK_KYA_VERIFIER === "custom" 
    ? new MyZkKyaVerifier(verificationKey)
    : undefined, // Use default
});
```

### Step 3: Configure Policy

Enable ZK-KYA in your policy:

```typescript
const policy = {
  // ... other policy fields
  base: {
    kya: {
      trust: { /* ... */ },
      zk_kya: {
        required: true,                // Require ZK-KYA proof
        require_issuer: true,          // Require issuer_id
        allowed_issuers: [             // Whitelist of trusted issuers
          "issuer_pact_registry",
          "issuer_kyc_provider_v1",
        ],
        min_tier: "trusted",           // Minimum trust tier required
      },
    },
  },
};
```

## Example: Groth16 Integration (snarkjs)

```typescript
import { groth16 } from "snarkjs";
import type { ZkKyaVerifier } from "@pact/sdk";

export class Groth16ZkKyaVerifier implements ZkKyaVerifier {
  private vkMap: Map<string, any>; // circuit_id -> verification key
  
  constructor(vkMap: Map<string, any>) {
    this.vkMap = vkMap;
  }
  
  async verify(input: {
    agent_id: string;
    proof: ZkKyaProof;
    now_ms: number;
  }): Promise<ZkKyaVerificationResult> {
    const { proof, now_ms } = input;
    
    // Check expiry
    if (proof.expires_at_ms && proof.expires_at_ms < now_ms) {
      return { ok: false, reason: "ZK_KYA_EXPIRED" };
    }
    
    // Load verification key for circuit
    const vk = this.vkMap.get(proof.circuit_id);
    if (!vk) {
      return { ok: false, reason: "ZK_KYA_INVALID" };
    }
    
    // Reconstruct public inputs (from hash or metadata)
    const publicInputs = await this.reconstructPublicInputs(proof);
    
    // Load proof bytes (stored separately, not in proof_hash)
    const proofBytes = await this.loadProofBytes(proof.proof_hash);
    
    // Verify proof
    try {
      const isValid = await groth16.verify(vk, publicInputs, proofBytes);
      
      if (!isValid) {
        return { ok: false, reason: "ZK_KYA_INVALID" };
      }
      
      // Extract trust info
      const { tier, trustScore } = await this.extractTrustInfo(publicInputs);
      
      return {
        ok: true,
        tier,
        trust_score: trustScore,
      };
    } catch (error: any) {
      return {
        ok: false,
        reason: "ZK_KYA_INVALID",
      };
    }
  }
  
  private async reconstructPublicInputs(proof: ZkKyaProof): Promise<number[]> {
    // Reconstruct public inputs from proof metadata or hash
    // This depends on your circuit design
    // Example:
    return [
      parseInt(proof.public_inputs_hash.substring(2, 10), 16), // age
      proof.meta?.verified ? 1 : 0, // verified flag
      // ... other public inputs
    ];
  }
  
  private async loadProofBytes(proofHash: string): Promise<any> {
    // Load actual proof bytes from storage using proof_hash as key
    // This is separate from the hash stored in proof
    // Example: load from database, IPFS, etc.
    const proofData = await this.proofStorage.get(proofHash);
    return proofData;
  }
  
  private async extractTrustInfo(publicInputs: number[]): Promise<{
    tier: "untrusted" | "low" | "trusted";
    trustScore: number;
  }> {
    // Extract trust tier and score from public inputs
    // This depends on your circuit design
    const trustScore = publicInputs[0] / 100; // Example: normalize to 0-1
    const tier = trustScore >= 0.8 ? "trusted" : trustScore >= 0.5 ? "low" : "untrusted";
    
    return { tier, trustScore };
  }
}
```

## Testing

Use the test verifier for unit tests:

```typescript
import { createTestZkKyaVerifier } from "@pact/sdk";

// Test verifier that always passes
const testVerifier = createTestZkKyaVerifier({
  shouldPass: true,
  tier: "trusted",
  trustScore: 0.9,
});

// Use in tests
const result = await acquire({
  // ... other params
  zkKyaVerifier: testVerifier,
});
```

## Security Considerations

1. **Never store raw proofs**: Only store hashes in transcripts
2. **Validate expiry**: Always check `expires_at_ms`
3. **Issuer allow-listing**: Restrict trusted issuers
4. **Tier enforcement**: Enforce minimum trust requirements
5. **Proof validation**: Verify proofs cryptographically (don't trust format checks)

## Limitations & Future Enhancements

**Current Limitations:**
- No verifier injection API (requires forking/modifying acquire())
- Proof bytes must be stored separately (proof_hash is just a hash)
- No proof caching or reuse

**Future Enhancements:**
- Verifier injection API for custom implementations
- Proof caching and reuse
- Multiple proof schemes in single acquisition
- Integration with external ZK proof services (IPFS, decentralized storage)

---

**Note**: This is an integration guide. Actual ZK implementation requires deep knowledge of ZK proof systems (Groth16, PLONK, Halo2, etc.).
