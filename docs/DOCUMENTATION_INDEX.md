# PACT Documentation Index

Complete index of all PACT documentation for easy reference.

## Quick Start

**New to PACT?** Start here:
- **[QUICKSTART.md](./QUICKSTART.md)** - Quick start guide (v4 recommended)
- **[v4/STATUS.md](./v4/STATUS.md)** - v4 Status (COMPLETE ✅ — Institution-grade infrastructure)
- **[v4/USE_CASES.md](./v4/USE_CASES.md)** - Use cases enabled by Pact v4
- **[WHY_PACT.md](./WHY_PACT.md)** - Why PACT exists and what problems it solves
- **[v3/GETTING_STARTED.md](./v3/GETTING_STARTED.md)** - v3 Getting Started Guide (stable and maintained)
- **[v3/RELEASE_NOTES.md](./v3/RELEASE_NOTES.md)** - v3 Release Notes (what's new, optional, experimental)

## Integration Guides

**Ready to integrate?** These guides will help:

### Core Integration
- **[EXECUTION_BOUNDARY.md](./EXECUTION_BOUNDARY.md)** - Execution boundary architecture (settlement providers, wallets, escrow)
- **[INTEGRATION_ESCROW.md](./INTEGRATION_ESCROW.md)** - EVM escrow contract integration
- **[WALLET_VERIFICATION.md](./WALLET_VERIFICATION.md)** - Wallet signature verification guide

### External Integrations
- **[INTEGRATION_ZK_KYA.md](./INTEGRATION_ZK_KYA.md)** - ZK-KYA external integration (Groth16, PLONK, Halo2)
- **[INTEGRATION_STRIPE_LIVE.md](./INTEGRATION_STRIPE_LIVE.md)** - Stripe Live settlement integration

### Distribution
- **[NPM_PUBLISHING.md](./NPM_PUBLISHING.md)** - npm publishing guide
- **[DISTRIBUTION.md](./DISTRIBUTION.md)** - Package distribution and sharing

## User Guides

**Using PACT?** Check these:

- **[BUYER_GUIDE.md](./BUYER_GUIDE.md)** - Guide for buyers (consumers)
- **[PROVIDER_GUIDE.md](./PROVIDER_GUIDE.md)** - Guide for providers (sellers)

## Security & Architecture

**Understanding security and architecture:**

- **[SECURITY_MODEL.md](./SECURITY_MODEL.md)** - PACT security model
- **[SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md)** - Security checklist for integrators
- **[ZK_KYA.md](./ZK_KYA.md)** - Zero-Knowledge Know Your Agent documentation
- **[ERROR_HANDLING.md](./ERROR_HANDLING.md)** - Error handling patterns and edge cases
- **[PERFORMANCE.md](./PERFORMANCE.md)** - Performance considerations and optimization

## v2 Development

**Working on v2?** See:

- **[v2/ARCHITECTURE.md](./v2/ARCHITECTURE.md)** - v2 architecture design
- **[v2/GOALS.md](./v2/GOALS.md)** - v2 goals and objectives
- **[v2/NON_GOALS.md](./v2/NON_GOALS.md)** - v2 non-goals (what we're not doing)
- **[v2/V2_FOUNDATION.md](./v2/V2_FOUNDATION.md)** - v2 foundation and roadmap
- **[v2/TRAINING_DATA_FORMAT.md](./v2/TRAINING_DATA_FORMAT.md)** - ML training data format

## Version History

**Understanding PACT versions:**

- **[V1_READ_ONLY.md](./V1_READ_ONLY.md)** - v1 status (frozen at v1.7.0-rc6)
- **[v1-stability.md](./v1-stability.md)** - v1 stability guarantees

## Documentation by Topic

### Negotiation
- [v3/GETTING_STARTED.md](./v3/GETTING_STARTED.md) - Basic negotiation
- [WHY_PACT.md](./WHY_PACT.md) - Negotiation vs markets

### Settlement
- [EXECUTION_BOUNDARY.md](./EXECUTION_BOUNDARY.md) - Settlement boundaries
- [INTEGRATION_ESCROW.md](./INTEGRATION_ESCROW.md) - On-chain escrow
- [INTEGRATION_STRIPE_LIVE.md](./INTEGRATION_STRIPE_LIVE.md) - Stripe integration

### Wallets
- [WALLET_VERIFICATION.md](./WALLET_VERIFICATION.md) - Wallet verification
- [EXECUTION_BOUNDARY.md](./EXECUTION_BOUNDARY.md) - Wallet boundaries

### ZK-KYA
- [ZK_KYA.md](./ZK_KYA.md) - ZK-KYA overview
- [INTEGRATION_ZK_KYA.md](./INTEGRATION_ZK_KYA.md) - External ZK integration

### Policies
- [v4/POLICY.md](./v4/POLICY.md) - Policy-as-Code v4 (deterministic constraint system)
- [v3/GETTING_STARTED.md](./v3/GETTING_STARTED.md) - Policy basics (v3)
- [v2/V2_FOUNDATION.md](./v2/V2_FOUNDATION.md) - Executable policies (v2)

### Transcripts
- [v4/STATUS.md](./v4/STATUS.md) - v4 Transcripts (Proof of Negotiation, hash-linked)
- [v3/GETTING_STARTED.md](./v3/GETTING_STARTED.md) - Transcript basics (v3)
- [v2/V2_FOUNDATION.md](./v2/V2_FOUNDATION.md) - Transcript streams (v2)

### v4 Features
- [v4/STATUS.md](./v4/STATUS.md) - v4 Status (complete feature list)
- [v4/USE_CASES.md](./v4/USE_CASES.md) - Use cases enabled by v4
- [v4/POLICY.md](./v4/POLICY.md) - Policy-as-Code v4
- [v4/PASSPORT.md](./v4/PASSPORT.md) - Passport v1 (agent reputation)
- [v4/CREDIT.md](./v4/CREDIT.md) - Credit v1 (undercollateralized commitments)
- [v4/ARBITRATION.md](./v4/ARBITRATION.md) - Arbitration (transcript-constrained)
- [v4/EVIDENCE_BUNDLE.md](./v4/EVIDENCE_BUNDLE.md) - Evidence Bundles
- [v4/REDACTION.md](./v4/REDACTION.md) - Transcript Redaction
- [v4/FAILURE_TAXONOMY.md](./v4/FAILURE_TAXONOMY.md) - Failure Taxonomy

### ML & Training
- [v2/TRAINING_DATA_FORMAT.md](./v2/TRAINING_DATA_FORMAT.md) - Training data format

### Multi-Party & v2
- [v2/V2_FOUNDATION.md](./v2/V2_FOUNDATION.md) - Multi-party negotiations, long-lived sessions

## Quick Reference

### Common Tasks

**Getting Started (v4 recommended):**
1. Read [QUICKSTART.md](./QUICKSTART.md) and run `pnpm demo:v4:canonical`
2. Review [v4/STATUS.md](./v4/STATUS.md) for complete feature list
3. Review [v4/USE_CASES.md](./v4/USE_CASES.md) for use cases
4. Review [WHY_PACT.md](./WHY_PACT.md) for understanding

**Getting Started (v3):**
1. Read [GETTING_STARTED.md](./v3/GETTING_STARTED.md)
2. Run examples: `pnpm example:v3:01`, `pnpm example:v3:02`, `pnpm example:v3:03`
3. Review [WHY_PACT.md](./WHY_PACT.md) for understanding

**Advanced Examples:**
- `pnpm example:v3:04` - Stripe integration (requires `stripe` package)
- `pnpm example:v3:05` - ZK-KYA verification (requires `snarkjs` package)
- `pnpm example:v3:06` - Weather API agent (multi-provider negotiation)

**Integrating Escrow:**
1. Read [INTEGRATION_ESCROW.md](./INTEGRATION_ESCROW.md)
2. Deploy `pact-escrow-evm/contracts/PactEscrow.sol`
3. Integrate lock/release/refund/slash calls

**Integrating Stripe:**
1. Read [INTEGRATION_STRIPE_LIVE.md](./INTEGRATION_STRIPE_LIVE.md)
2. Use `StripeSettlementProvider` or extend it for custom behavior
3. Configure environment variables

**Integrating ZK-KYA:**
1. Read [INTEGRATION_ZK_KYA.md](./INTEGRATION_ZK_KYA.md)
2. Implement `ZkKyaVerifier` interface
3. Configure policy for ZK-KYA

**Publishing to npm:**
1. Read [NPM_PUBLISHING.md](./NPM_PUBLISHING.md)
2. Run pre-publish checklist
3. Publish packages

**Production Readiness:**
1. Read [ERROR_HANDLING.md](./ERROR_HANDLING.md) for error handling patterns
2. Review [PERFORMANCE.md](./PERFORMANCE.md) for optimization strategies
3. Test with/without optional dependencies (CI/CD)

## Implementation Log

See [../IMPLEMENTATION_LOG.md](../IMPLEMENTATION_LOG.md) for complete log of all implementations and improvements.

---

**Last Updated:** January 2026
