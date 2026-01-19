# PACT Documentation Index

Complete index of all PACT documentation for easy reference.

## Quick Start

**New to PACT?** Start here:
- **[getting-started/QUICKSTART.md](./getting-started/QUICKSTART.md)** - Quick start guide (v4 recommended)
- **[versions/v4/STATUS.md](./versions/v4/STATUS.md)** - v4 Status (COMPLETE ✅ — Institution-grade infrastructure)
- **[versions/v4/USE_CASES.md](./versions/v4/USE_CASES.md)** - Use cases enabled by Pact v4
- **[use_cases/AUTONOMOUS_API_PROCUREMENT.md](./use_cases/AUTONOMOUS_API_PROCUREMENT.md)** - Canonical flow for autonomous API procurement
- **[reference/WHY_PACT.md](./reference/WHY_PACT.md)** - Why PACT exists and what problems it solves
- **[versions/v3/GETTING_STARTED.md](./versions/v3/GETTING_STARTED.md)** - v3 Getting Started Guide (stable and maintained)
- **[versions/v3/RELEASE_NOTES.md](./versions/v3/RELEASE_NOTES.md)** - v3 Release Notes (what's new, optional, experimental)

## Integration Guides

**Ready to integrate?** These guides will help:

### Core Integration
- **[integrations/EXECUTION_BOUNDARY.md](./integrations/EXECUTION_BOUNDARY.md)** - Execution boundary architecture (settlement providers, wallets, escrow)
- **[integrations/INTEGRATION_ESCROW.md](./integrations/INTEGRATION_ESCROW.md)** - EVM escrow contract integration
- **[integrations/WALLET_VERIFICATION.md](./integrations/WALLET_VERIFICATION.md)** - Wallet signature verification guide

### External Integrations
- **[integrations/INTEGRATION_ZK_KYA.md](./integrations/INTEGRATION_ZK_KYA.md)** - ZK-KYA external integration (Groth16, PLONK, Halo2)
- **[integrations/INTEGRATION_STRIPE_LIVE.md](./integrations/INTEGRATION_STRIPE_LIVE.md)** - Stripe Live settlement integration

### Distribution
- **[distribution/NPM_PUBLISHING.md](./distribution/NPM_PUBLISHING.md)** - npm publishing guide
- **[distribution/DISTRIBUTION.md](./distribution/DISTRIBUTION.md)** - Package distribution and sharing

## User Guides

**Using PACT?** Check these:

- **[guides/BUYER_GUIDE.md](./guides/BUYER_GUIDE.md)** - Guide for buyers (consumers)
- **[guides/PROVIDER_GUIDE.md](./guides/PROVIDER_GUIDE.md)** - Guide for providers (sellers)

## Security & Architecture

**Understanding security and architecture:**

### Security
- **[security/SECURITY_MODEL.md](./security/SECURITY_MODEL.md)** - PACT security model
- **[security/SECURITY_CHECKLIST.md](./security/SECURITY_CHECKLIST.md)** - Security checklist for integrators
- **[security/SECURITY_THREAT_MODEL.md](./security/SECURITY_THREAT_MODEL.md)** - Security threat model
- **[security/ZK_KYA.md](./security/ZK_KYA.md)** - Zero-Knowledge Know Your Agent documentation

### Architecture
- **[architecture/ERROR_HANDLING.md](./architecture/ERROR_HANDLING.md)** - Error handling patterns and edge cases
- **[architecture/PERFORMANCE.md](./architecture/PERFORMANCE.md)** - Performance considerations and optimization
- **[architecture/PACT_GUARANTEES.md](./architecture/PACT_GUARANTEES.md)** - PACT guarantees and commitments
- **[architecture/PACT_COMPATIBILITY.md](./architecture/PACT_COMPATIBILITY.md)** - Compatibility information

## v2 Development

**Working on v2?** See:

- **[versions/v2/ARCHITECTURE.md](./versions/v2/ARCHITECTURE.md)** - v2 architecture design
- **[versions/v2/GOALS.md](./versions/v2/GOALS.md)** - v2 goals and objectives
- **[versions/v2/NON_GOALS.md](./versions/v2/NON_GOALS.md)** - v2 non-goals (what we're not doing)
- **[versions/v2/V2_FOUNDATION.md](./versions/v2/V2_FOUNDATION.md)** - v2 foundation and roadmap
- **[versions/v2/TRAINING_DATA_FORMAT.md](./versions/v2/TRAINING_DATA_FORMAT.md)** - ML training data format

## Version History

**Understanding PACT versions:**

- **[versions/v1/V1_READ_ONLY.md](./versions/v1/V1_READ_ONLY.md)** - v1 status (frozen at v1.7.0-rc6)
- **[versions/v1/v1-stability.md](./versions/v1/v1-stability.md)** - v1 stability guarantees

## Documentation by Topic

### Negotiation
- [versions/v3/GETTING_STARTED.md](./versions/v3/GETTING_STARTED.md) - Basic negotiation
- [reference/WHY_PACT.md](./reference/WHY_PACT.md) - Negotiation vs markets

### Settlement
- [integrations/EXECUTION_BOUNDARY.md](./integrations/EXECUTION_BOUNDARY.md) - Settlement boundaries
- [integrations/INTEGRATION_ESCROW.md](./integrations/INTEGRATION_ESCROW.md) - On-chain escrow
- [integrations/INTEGRATION_STRIPE_LIVE.md](./integrations/INTEGRATION_STRIPE_LIVE.md) - Stripe integration

### Wallets
- [integrations/WALLET_VERIFICATION.md](./integrations/WALLET_VERIFICATION.md) - Wallet verification
- [integrations/EXECUTION_BOUNDARY.md](./integrations/EXECUTION_BOUNDARY.md) - Wallet boundaries

### ZK-KYA
- [security/ZK_KYA.md](./security/ZK_KYA.md) - ZK-KYA overview
- [integrations/INTEGRATION_ZK_KYA.md](./integrations/INTEGRATION_ZK_KYA.md) - External ZK integration

### Policies
- [versions/v4/POLICY.md](./versions/v4/POLICY.md) - Policy-as-Code v4 (deterministic constraint system)
- [versions/v3/GETTING_STARTED.md](./versions/v3/GETTING_STARTED.md) - Policy basics (v3)
- [versions/v2/V2_FOUNDATION.md](./versions/v2/V2_FOUNDATION.md) - Executable policies (v2)

### Transcripts
- [versions/v4/STATUS.md](./versions/v4/STATUS.md) - v4 Transcripts (Proof of Negotiation, hash-linked)
- [versions/v3/GETTING_STARTED.md](./versions/v3/GETTING_STARTED.md) - Transcript basics (v3)
- [versions/v2/V2_FOUNDATION.md](./versions/v2/V2_FOUNDATION.md) - Transcript streams (v2)

### v4 Features
- [versions/v4/STATUS.md](./versions/v4/STATUS.md) - v4 Status (complete feature list)
- [versions/v4/USE_CASES.md](./versions/v4/USE_CASES.md) - Use cases enabled by v4
- [versions/v4/POLICY.md](./versions/v4/POLICY.md) - Policy-as-Code v4
- [versions/v4/PASSPORT.md](./versions/v4/PASSPORT.md) - Passport v1 (agent reputation)
- [versions/v4/CREDIT.md](./versions/v4/CREDIT.md) - Credit v1 (undercollateralized commitments)
- [versions/v4/ARBITRATION.md](./versions/v4/ARBITRATION.md) - Arbitration (transcript-constrained)
- [versions/v4/EVIDENCE_BUNDLE.md](./versions/v4/EVIDENCE_BUNDLE.md) - Evidence Bundles
- [versions/v4/REDACTION.md](./versions/v4/REDACTION.md) - Transcript Redaction
- [versions/v4/FAILURE_TAXONOMY.md](./versions/v4/FAILURE_TAXONOMY.md) - Failure Taxonomy

### ML & Training
- [versions/v2/TRAINING_DATA_FORMAT.md](./versions/v2/TRAINING_DATA_FORMAT.md) - Training data format

### Multi-Party & v2
- [versions/v2/V2_FOUNDATION.md](./versions/v2/V2_FOUNDATION.md) - Multi-party negotiations, long-lived sessions

## Quick Reference

### Common Tasks

**Getting Started (v4 recommended):**
1. Read [getting-started/QUICKSTART.md](./getting-started/QUICKSTART.md) and run `pnpm demo:v4:canonical`
2. Review [versions/v4/STATUS.md](./versions/v4/STATUS.md) for complete feature list
3. Review [versions/v4/USE_CASES.md](./versions/v4/USE_CASES.md) for use cases
4. Review [reference/WHY_PACT.md](./reference/WHY_PACT.md) for understanding

**Getting Started (v3):**
1. Read [versions/v3/GETTING_STARTED.md](./versions/v3/GETTING_STARTED.md)
2. Run examples: `pnpm example:v3:01`, `pnpm example:v3:02`, `pnpm example:v3:03`
3. Review [reference/WHY_PACT.md](./reference/WHY_PACT.md) for understanding

**Advanced Examples:**
- `pnpm example:v3:04` - Stripe integration (requires `stripe` package)
- `pnpm example:v3:05` - ZK-KYA verification (requires `snarkjs` package)
- `pnpm example:v3:06` - Weather API agent (multi-provider negotiation)

**Integrating Escrow:**
1. Read [integrations/INTEGRATION_ESCROW.md](./integrations/INTEGRATION_ESCROW.md)
2. Deploy `pact-escrow-evm/contracts/PactEscrow.sol`
3. Integrate lock/release/refund/slash calls

**Integrating Stripe:**
1. Read [integrations/INTEGRATION_STRIPE_LIVE.md](./integrations/INTEGRATION_STRIPE_LIVE.md)
2. Use `StripeSettlementProvider` or extend it for custom behavior
3. Configure environment variables

**Integrating ZK-KYA:**
1. Read [integrations/INTEGRATION_ZK_KYA.md](./integrations/INTEGRATION_ZK_KYA.md)
2. Implement `ZkKyaVerifier` interface
3. Configure policy for ZK-KYA

**Publishing to npm:**
1. Read [distribution/NPM_PUBLISHING.md](./distribution/NPM_PUBLISHING.md)
2. Run pre-publish checklist
3. Publish packages

**Production Readiness:**
1. Read [architecture/ERROR_HANDLING.md](./architecture/ERROR_HANDLING.md) for error handling patterns
2. Review [architecture/PERFORMANCE.md](./architecture/PERFORMANCE.md) for optimization strategies
3. Test with/without optional dependencies (CI/CD)

## Implementation Log

See [reference/IMPLEMENTATION_LOG.md](./reference/IMPLEMENTATION_LOG.md) for complete log of all implementations and improvements.

---

**Last Updated:** January 2026
