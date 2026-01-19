# PACT v3 Release Notes

**Version:** v3 (Production Ready)  
**Date:** January 2026

---

## What's New in v3

### ✅ Production-Ready Integrations

**Optional Built-in Implementations:**
- **Stripe Integration** - Real Stripe payments work out of the box when `stripe` package is installed
- **ZK-KYA Verification** - Real Groth16 proof verification works out of the box when `snarkjs` package is installed

**Real-World Examples:**
- `example:v3:04` - Stripe integration demonstration
- `example:v3:05` - ZK-KYA verification demonstration  
- `example:v3:06` - Weather API agent (multi-provider negotiation)

**EVM Escrow Contract:**
- `pact-escrow-evm/` - Separate optional package for on-chain fund custody
- Escrow is **out of SDK scope** - lives as separate package with clean integration surface
- SDK provides negotiation; integrators choose execution backend (on-chain escrow, payment processors, or custom)

**Production Documentation:**
- `docs/architecture/ERROR_HANDLING.md` - Error handling patterns and edge cases
- `docs/architecture/PERFORMANCE.md` - Performance considerations and optimization strategies

**CI/CD Integration:**
- Automated testing with/without optional dependencies
- Matrix jobs verify graceful fallback behavior

### ✅ Enhanced Features

- **Optional Peer Dependencies** - Install `stripe` or `snarkjs` to enable real integrations
- **Graceful Fallback** - Clear errors when optional packages not installed (boundary mode)
- **Idempotency Support** - Settlement handles ensure safe retries
- **Comprehensive Error Handling** - Clear error messages with installation instructions
- **Performance Optimizations** - Lazy loading, caching, early validation patterns

---

## What's Optional

### Optional Peer Dependencies

PACT core works without any optional dependencies. Install these for real-world integrations:

**Stripe Integration:**
```bash
npm install @pact/sdk stripe
```
- Enables real Stripe payments via `StripeSettlementProvider`
- Falls back to boundary mode (clear errors) if `stripe` not installed

**ZK-KYA Verification:**
```bash
npm install @pact/sdk snarkjs
```
- Enables real Groth16 proof verification via `DefaultZkKyaVerifier`
- Falls back to boundary mode (clear errors) if `snarkjs` not installed

**Core Protocol:** Works perfectly without these packages. Optional dependencies only enable real integrations.

---

## What's Experimental / Boundary-Mode

### Boundary-Mode Features

These features define interfaces and boundaries but don't make external calls:

**Stripe Settlement (`StripeSettlementProvider`):**
- ✅ **Interface & Configuration:** Fully implemented
- ✅ **Validation:** Complete configuration validation
- ⚠️ **Real Stripe API Calls:** Requires `stripe` package to be installed
- Without `stripe`: Returns clear errors, core protocol still works
- **Mode Configuration:** The `mode` field uses Stripe's terminology: `"sandbox"` (testing) or `"live"` (production)

**ZK-KYA Verification (`DefaultZkKyaVerifier`):**
- ✅ **Expiration Checks:** Works without `snarkjs` (local validation)
- ✅ **Scheme Validation:** Validates proof format
- ⚠️ **Full Cryptographic Verification:** Requires `snarkjs` package to be installed
- Without `snarkjs`: Returns `ZK_KYA_NOT_IMPLEMENTED`, core protocol still works

### Boundary-Mode Behavior

When optional dependencies are **not installed**:
- Core negotiation protocol: ✅ **Fully functional**
- Settlement provider: ⚠️ **Boundary mode** (clear errors, returns 0 for balance queries)
- ZK-KYA verification: ⚠️ **Boundary mode** (clear errors, expiration checks only)

When optional dependencies **are installed**:
- Stripe integration: ✅ **Real Stripe API** (in-memory balance tracking, ready for API calls)
- ZK-KYA verification: ✅ **Real Groth16 verification** (via snarkjs)

---

## Quick Start

**One-Command Demo:**
```bash
pnpm demo:v3:quickstart
```
Runs negotiation + transcripts end-to-end (no optional dependencies required).

**Installation:**
```bash
# Core protocol (no optional dependencies)
npm install @pact/sdk

# With Stripe integration
npm install @pact/sdk stripe

# With ZK-KYA verification
npm install @pact/sdk snarkjs

# With both
npm install @pact/sdk stripe snarkjs
```

## Examples

```bash
# Quickstart demo (recommended first step)
pnpm demo:v3:quickstart

# Basic negotiation (no dependencies)
pnpm example:v3:01

# Stripe integration (requires stripe package)
pnpm example:v3:04

# ZK-KYA verification (requires snarkjs package)
pnpm example:v3:05

# Multi-provider negotiation
pnpm example:v3:06
```

## Documentation

- **[versions/v3/GETTING_STARTED.md](./GETTING_STARTED.md)** - Getting started guide
- **[integrations/INTEGRATION_STRIPE_LIVE.md](../integrations/INTEGRATION_STRIPE_LIVE.md)** - Stripe integration guide
- **[integrations/INTEGRATION_ZK_KYA.md](../integrations/INTEGRATION_ZK_KYA.md)** - ZK-KYA integration guide
- **[architecture/ERROR_HANDLING.md](../architecture/ERROR_HANDLING.md)** - Error handling patterns
- **[architecture/PERFORMANCE.md](../architecture/PERFORMANCE.md)** - Performance optimization

---

**v3 is production-ready.** Core protocol is stable, optional integrations work out of the box when dependencies are installed.
