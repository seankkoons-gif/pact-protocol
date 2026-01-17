# PACT

**PACT** coordinates negotiation, KYA (Know Your Agent) verification, and settlement between autonomous agents.

- **Negotiation**: Deterministic pricing and terms agreement between agents
- **Identity**: KYA verification with credential validation and cryptographic proof
- **Settlement**: Payment-rail agnostic coordination for execution boundaries (boundary, Stripe, escrow)

```
Buyer Agent → negotiate → Provider → settle → transcript
```

## Run the canonical demo

```bash
pnpm i
pnpm demo:v3:canonical
```

**Expected output:**
```
═══════════════════════════════════════════════════════════
  PACT v3 Quickstart Demo
  One-command demo: Negotiation + Transcripts
═══════════════════════════════════════════════════════════

📋 Setup:
   ✓ Generated keypairs (buyer & seller)
   ✓ Registered weather data provider
   ✓ Created receipt history (5 transactions)
   ✓ Initialized settlement (in-memory)

🔄 Negotiation Starting...
  Intent: weather.data (NYC)
  Max price: $0.0002
  Strategy: banded_concession

✅ Negotiation Complete!
  Agreed Price: $0.0001
  Transcript: .pact/transcripts/intent-...

🎉 Demo Complete!
```

**Replay transcript:**
```bash
pnpm pact:replay .pact/transcripts/intent-*.json
```

---

## Pick your path

**Real-world provider examples:**
- **[Weather Provider](./examples/providers/weather-provider/)** — Complete `weather.data` provider with deterministic pricing (`pnpm example:provider:weather`)
- **[LLM Verifier Provider](./examples/providers/llm-verifier-provider/)** — Complete `llm.verify` provider with KYA variants (`pnpm example:provider:llm`)

**Use cases:**
- **[Negotiate only](./docs/v3/PICK_YOUR_PATH.md#1-negotiate-only-no-money)** — Deterministic negotiation without settlement. See [`examples/v3/01-basic-negotiation.ts`](./examples/v3/01-basic-negotiation.ts).

- **[Negotiate + settle](./docs/v3/PICK_YOUR_PATH.md#2-negotiate--settle-stripe--escrow)** — Negotiation with real settlement backends (Stripe, escrow). See [`examples/v3/04-stripe-integration.ts`](./examples/v3/04-stripe-integration.ts) or [`docs/INTEGRATION_ESCROW.md`](./docs/INTEGRATION_ESCROW.md).

- **[Multi-provider marketplace](./docs/v3/PICK_YOUR_PATH.md#3-multi-provider-marketplace)** — Negotiate with multiple providers and select the best. See [`examples/v3/06-weather-api-agent.ts`](./examples/v3/06-weather-api-agent.ts).

---

## How Pact differs

Pact is not a payment rail: it coordinates settlement but doesn't move money. Payment execution happens through pluggable boundaries (Stripe, escrow, mock).

Pact is not a marketplace: it's a deterministic negotiation protocol. No order books, no limit orders, no real-time price feeds.

Pact is a protocol layer: negotiation semantics, identity verification (KYA), and settlement coordination. Execution (wallets, payments, chains) happens outside Pact through clear interfaces.

---

## What PACT Solves

Most agent interactions today fail in one of three ways:
1. No shared negotiation semantics
2. No enforceable settlement guarantees
3. No post-hoc explanation of *why* something happened

PACT addresses this by defining:
- A canonical negotiation flow
- Multiple settlement modes with explicit guarantees
- Deterministic receipts and reputation signals
- Explainable selection and rejection logic

If two agents both implement PACT, they can transact **without prior trust**.

---

## Status

**v1** is frozen at `v1.7.0-rc6` (read-only, critical fixes only). See [V1_READ_ONLY.md](./docs/V1_READ_ONLY.md) for details.

**v2** is active development on branch `v2` (architectural reset, breaking changes). See [v2 Architecture](./docs/v2/ARCHITECTURE.md) for design.

---

## Getting Started

### Clone & Checkout

```bash
git clone https://github.com/seankkoons-gif/pact_.git
cd pact_
git checkout v1.7.0-rc5
```

### Install & Verify

```bash
pnpm install
pnpm build
pnpm test
```

### Run Provider (Terminal A)

```bash
PACT_DEV_IDENTITY_SEED=pact-provider-default-seed-v1 pnpm provider:serve
```

### Run Examples (Terminal B)

```bash
pnpm example:happy
pnpm example:timeout
pnpm example:dispute
pnpm example:reconcile
```

### Verify Transcripts

```bash
# Default mode: warnings for pending settlements
pnpm replay:verify -- .pact/transcripts

# Strict mode: verify only terminal transcripts (skip pending)
pnpm replay:verify --strict --terminal-only -- .pact/transcripts
```

**If all steps pass, you're synced and ready to go!**

---

## Public API

PACT v1.7.2+ provides a **stable public API** with guaranteed backward compatibility within the v1 major version. See [V1_CONTRACT.md](./V1_CONTRACT.md) for complete API stability guarantees.

### Quickstart

```bash
# Install dependencies
pnpm install

# Build packages
pnpm build

# Run tests
pnpm test

# Start provider server
PACT_DEV_IDENTITY_SEED=pact-provider-default-seed-v1 pnpm provider:serve

# Run examples
pnpm example:happy          # Basic happy path
pnpm example:timeout        # Streaming with timeout
pnpm example:dispute        # Dispute resolution
pnpm example:reconcile      # Reconcile pending settlement

# Run v3 quickstart demo (recommended first step)
pnpm demo:v3:quickstart     # One-command demo: negotiation + transcripts

# Run v3 examples
pnpm example:v3:01          # Basic negotiation (no wallets/escrow)
pnpm example:v3:02          # Wallet + escrow boundary demonstration
pnpm example:v3:03          # ML-assisted negotiation
pnpm example:v3:04          # Stripe integration (requires stripe package)
pnpm example:v3:05          # ZK-KYA verification (requires snarkjs package)
pnpm example:v3:06          # Weather API agent (multi-provider negotiation)
```

### Optional Dependencies

PACT supports optional built-in implementations for real-world integrations:

- **Stripe Integration**: Install `stripe` to enable real Stripe payments
  ```bash
  npm install @pact/sdk stripe
  ```
  Works out of the box with `StripeSettlementProvider` when `stripe` is installed.

- **ZK-KYA Verification**: Install `snarkjs` to enable real Groth16 proof verification
  ```bash
  npm install @pact/sdk snarkjs
  ```
  Works out of the box with `DefaultZkKyaVerifier` when `snarkjs` is installed.

Without these packages, PACT uses boundary mode (clear errors, no external calls). The core protocol works regardless.

### Documentation

**Getting Started:**
- **[QUICKSTART.md](./docs/QUICKSTART.md)** — Get started in <10 minutes
- **[v3/GETTING_STARTED.md](./docs/v3/GETTING_STARTED.md)** — v3 Getting Started Guide
- **[v3/RELEASE_NOTES.md](./docs/v3/RELEASE_NOTES.md)** — v3 Release Notes (what's new, optional, experimental)
- **[WHY_PACT.md](./docs/WHY_PACT.md)** — Why PACT exists and what problems it solves

**Integration Guides:**
- **[INTEGRATION_ESCROW.md](./docs/INTEGRATION_ESCROW.md)** — EVM escrow contract integration
- **[WALLET_VERIFICATION.md](./docs/WALLET_VERIFICATION.md)** — Wallet signature verification
- **[INTEGRATION_STRIPE_LIVE.md](./docs/INTEGRATION_STRIPE_LIVE.md)** — Stripe integration
- **[INTEGRATION_ZK_KYA.md](./docs/INTEGRATION_ZK_KYA.md)** — ZK-KYA external integration

**Distribution & Publishing:**
- **[DISTRIBUTION.md](./docs/DISTRIBUTION.md)** — How to share, install, and distribute PACT
- **[NPM_PUBLISHING.md](./docs/NPM_PUBLISHING.md)** — npm publishing guide

**Architecture & Security:**
- **[EXECUTION_BOUNDARY.md](./docs/EXECUTION_BOUNDARY.md)** — Execution boundary architecture
- **[SECURITY_MODEL.md](./docs/SECURITY_MODEL.md)** — Security model and practices
- **[ERROR_HANDLING.md](./docs/ERROR_HANDLING.md)** — Error handling patterns and edge cases
- **[PERFORMANCE.md](./docs/PERFORMANCE.md)** — Performance considerations and optimization

**Reference:**
- **[DOCUMENTATION_INDEX.md](./docs/DOCUMENTATION_INDEX.md)** — Complete documentation index
- **[V1_CONTRACT.md](./V1_CONTRACT.md)** — API stability guarantees and contract
- **[PROTOCOL.md](./PROTOCOL.md)** — Protocol semantics and behavior
- **[v2/V2_FOUNDATION.md](./docs/v2/V2_FOUNDATION.md)** — v2 features foundation and roadmap
- **[examples/](./examples/)** — Working code examples

### Stable Entrypoints

- **`acquire()`** — Main entrypoint for negotiation and settlement
- **`SettlementProvider`** — Interface for settlement execution
- **`openDispute()` / `resolveDispute()`** — Dispute resolution
- **`reconcile()`** — Reconciliation for pending settlements
- **`replayTranscript()` / `verifyTranscriptFile()`** — Transcript validation

### Version Recommendation

For production use, we recommend:
- **v1.7.2+** — API freeze with stable public entrypoints
- **v1.6.0-alpha+** — Includes reconciliation and signed dispute decisions

See [CHANGELOG.md](./CHANGELOG.md) for detailed version history.

---

## Core Concepts

### 1. Intent
A buyer declares *what it wants*, under what constraints, and how it is willing to settle.

### 2. Providers
Sellers advertise their capability to satisfy an intent, either:
- Locally (in-process)
- Via HTTP (remote agents)
- Via a persistent registry

### 3. Negotiation
PACT defines a bounded, deterministic negotiation process:
- Quotes
- Acceptance
- Locking of funds or bonds

No open-ended haggling. No hidden state.

---

## Settlement

PACT is **payment-rail agnostic**. The settlement interface can be implemented by custodial wallets, on-chain smart contracts, payment processors, or mock providers (default). See [V1_5.md](./V1_5.md#settlement-seams-v155) for details.

## Settlement Modes

PACT currently supports two settlement modes:

### Hash-Reveal
- Seller commits to a payload hash
- Payload is later revealed and verified
- Buyer pays in full on successful reveal

Best for:
- Discrete results
- Atomic delivery
- Simple verification

### Streaming
- Seller delivers incremental chunks
- Buyer pays incrementally per tick
- Either side may stop early

Best for:
- Continuous data
- Long-running tasks
- Partial fulfillment

Settlement behavior is explicit and negotiated up front.

---

## Determinism & Explainability

PACT is deterministic by design.

Given the same inputs:
- The same provider is selected
- The same settlement path is followed
- The same receipt is produced

The `acquire()` API can optionally return **explanations**, describing:
- Why providers were rejected
- Why a winner was selected
- Which constraints or policies applied

Additionally, `acquire()` can save **transcripts** (v1.5.4+) — complete JSON audit trails of each acquisition, including directory, credential checks, quotes, selection, settlement, and receipt. Enable with `saveTranscript: true`.

**Reconciliation (v1.6.0-alpha)**: The `reconcile()` function polls pending settlement handles and updates transcripts with final settlement status (committed/failed), enabling post-transaction status updates for async settlement providers.

**Signed Dispute Decisions (v1.6.0-alpha)**: Dispute resolution now supports cryptographically signed decision artifacts with arbiter Ed25519 signatures, enabling verifiable dispute outcomes and audit trails.

This is critical for debugging, auditing, and governance.

### Error Codes (Handling Failures)

PACT uses explicit error codes for failure modes. Integrations should branch on `code`
and treat `reason` as human-readable context.

Common `acquire()` failure codes:

#### Discovery / selection
- `DIRECTORY_EMPTY` — no providers available for this intent
- `NO_PROVIDERS` — directory returned no providers
- `NO_ELIGIBLE_PROVIDERS` — providers existed, but all were rejected (policy/identity/etc.)

#### Identity / verification
- `PROVIDER_SIGNATURE_INVALID` — provider envelope signature failed verification
- `PROVIDER_SIGNER_MISMATCH` — signer pubkey didn't match expected provider pubkey
- `UNTRUSTED_ISSUER` — provider credential issuer not in trusted issuers list
- `FAILED_IDENTITY` — identity verification failed

#### Policy / constraints
- `PROVIDER_MISSING_REQUIRED_CREDENTIALS` — provider lacked required credentials (e.g. `sla_verified`)
- `PROVIDER_QUOTE_POLICY_REJECTED` — quote rejected by policy guard
- `PROVIDER_QUOTE_OUT_OF_BAND` — price violated reference band constraints
- `FAILED_REFERENCE_BAND` — quote price outside acceptable reference price band
- `QUOTE_OUT_OF_BAND` — alternative code for out-of-band quotes

#### Settlement
- `FAILED_ESCROW` — insufficient funds / lock failure
- `FAILED_PROOF` — commit/reveal verification failed
- `BUYER_STOPPED` — buyer halted streaming early (not necessarily a provider fault)
- `HTTP_STREAMING_ERROR` — HTTP streaming endpoint failed
- `HTTP_PROVIDER_ERROR` — HTTP provider endpoint error
- `STREAMING_NOT_CONFIGURED` — streaming policy not configured
- `NO_AGREEMENT` — no agreement found after ACCEPT
- `NO_RECEIPT` — no receipt generated after settlement

#### Other
- `INVALID_POLICY` — policy validation failed

When `explain` is enabled, each provider rejection includes a structured reason with these codes.

---

## Packages

This repository contains multiple packages:

### `@pact/sdk`
The core protocol implementation.

Includes:
- Message schemas
- Negotiation engine
- Settlement logic
- Reputation and receipt accounting
- Provider directory implementations

This is the package most integrators will depend on.

### `@pact/provider-adapter`
A reference provider implementation.

Includes:
- HTTP provider server
- CLI for registering providers
- Example provider behavior

This package is optional but recommended for testing and integration.

---

## Quickstart (2 Terminals)

Get PACT running in under 5 minutes:

### Terminal A: Start Provider Server

```bash
pnpm provider:serve:demo
```

This starts a provider server on `http://127.0.0.1:7777` with a deterministic demo identity.

**Identity modes:**
- **Demo** (`provider:serve:demo`): Uses deterministic seed for consistent demo setup
- **Production** (`provider:serve`): Set `PACT_PROVIDER_SECRET_KEY_B58` or `PACT_PROVIDER_KEYPAIR_FILE` env vars
- **Dev seed** (opt-in): Set `PACT_DEV_IDENTITY_SEED` env var (prints warning)
- **Ephemeral** (default): Random keypair on each start (no warning)

**Example output:**
```
[Provider Server] sellerId: 8MAHFtsAtkENKMukXZoRUhNXCtJExDHEsUPSR19rjBDp
[Provider Server] Started on http://127.0.0.1:7777
[Provider Server] Identity mode: dev_seed
```

### Terminal B: Register Provider & Run Demo

**Step 1: Register the provider**

```bash
pnpm provider:register -- \
  --intent weather.data \
  --pubkey <sellerId_from_terminal_A> \
  --endpoint http://127.0.0.1:7777 \
  --credentials sla_verified \
  --region us-east \
  --baselineLatencyMs 50
```

Replace `<sellerId_from_terminal_A>` with the `sellerId` printed in Terminal A.

**Note**: With `provider:serve:demo`, the `sellerId` is deterministic and will be the same every time, so you only need to register once. The pubkey will match the demo seed.

This creates/updates `providers.jsonl` in the repo root.

**Step 2: Run the buyer demo**

```bash
pnpm demo:happy
```

This runs the demo with:
- Registry: `./providers.jsonl` (relative to repo root)
- Intent: `weather.data`
- Explain: `coarse`

**Expected output:**
- Provider discovery from registry
- Credential verification (automatic for HTTP providers in v1.5+)
- Quote negotiation
- Settlement execution (hash_reveal)
- Receipt with balances

### Registry Setup

The registry is a JSONL file (one provider per line). Example entry:

```json
{"provider_id":"8MAHFtsA","intentType":"weather.data","pubkey_b58":"8MAHFtsAtkENKMukXZoRUhNXCtJExDHEsUPSR19rjBDp","endpoint":"http://127.0.0.1:7777","credentials":["sla_verified"],"region":"us-east","baseline_latency_ms":50}
```

**Important gotcha**: The `endpoint` must **exactly match** what the provider server prints:
- ✅ `http://127.0.0.1:7777` (matches server output)
- ❌ `http://localhost:7777` (different hostname, will fail signer verification)

### List Registered Providers

```bash
pnpm provider:list -- --intent weather.data
```

---

## Provider Identity Modes

PACT v1.5 introduces flexible provider identity management for production deployments while maintaining backward compatibility.

### Identity Loading Precedence

Provider identity is determined in the following order (first available wins):

1. **`PACT_PROVIDER_SECRET_KEY_B58`** (environment variable)
   - Base58-encoded 64-byte Ed25519 secret key
   - Highest precedence for production deployments
   - Example: `export PACT_PROVIDER_SECRET_KEY_B58="<base58_secret_key>"`

2. **`PACT_PROVIDER_KEYPAIR_FILE`** (environment variable)
   - Path to JSON file containing `secretKeyB58` (and optionally `publicKeyB58`)
   - Example: `export PACT_PROVIDER_KEYPAIR_FILE="/path/to/keypair.json"`

3. **`PACT_DEV_IDENTITY_SEED`** (environment variable - explicit opt-in)
   - Deterministic dev identity seed (must be explicitly set)
   - **Warning**: Only for development/testing
   - Example: `export PACT_DEV_IDENTITY_SEED="my-dev-seed"`
   - Used by `provider:serve:demo` script with seed `pact-provider-default-seed-v1`

4. **Ephemeral keypair** (fallback)
   - Random keypair generated on each server start
   - No warning (acceptable for testing/demos)
   - Identity changes on each restart

### Running Demo Provider with Deterministic Identity

For demos and testing, use the `provider:serve:demo` script which uses a deterministic seed:

```bash
pnpm provider:serve:demo
```

This ensures the provider's `sellerId` is consistent across runs, making it easy to register once and reuse.

### HTTP Provider Credential Verification

In v1.5, HTTP providers present a signed credential that `acquire()` automatically verifies before marking the provider eligible. The credential verification checks:

- **Signature validity**: Credential envelope signature must be valid
- **Signer match**: Credential signer must match provider's directory `pubkey_b58`
- **Expiration**: Credential must not be expired
- **Capability**: Credential must support the requested intent type

If verification fails, the provider is rejected with `PROVIDER_CREDENTIAL_INVALID`. For backward compatibility, providers without a credential endpoint (404 response) are allowed to proceed (graceful degradation).

---

## Basic Usage

### Importing the SDK

```ts
import { acquire, validatePolicyJson } from "@pact/sdk";
```

### Running a Provider (example)

**For demos:**
```bash
pnpm provider:serve:demo
```

**For production:**
```bash
pnpm provider:serve
```

### Registering a Provider

```bash
pnpm provider:register -- \
  --intent weather.data \
  --pubkey <BASE58_PUBKEY> \
  --endpoint http://127.0.0.1:7777
```

**Note:** It is recommended that `./providers.jsonl` lives at the repository root.

---

## Status

PACT is stable but evolving.

**What is stable:**
- Protocol semantics
- Message schemas
- Settlement behavior
- Determinism guarantees

**What may change:**
- Helper APIs
- CLI ergonomics
- Additional settlement modes

Breaking changes follow semantic versioning.

---

## Design Philosophy

PACT values:

- Explicit over implicit
- Determinism over convenience
- Auditable outcomes over opaque success

If something cannot be explained after the fact, it does not belong in the protocol.

---

## Documentation

- `PROTOCOL.md` — how the protocol works
- `PRE_PUBLISH.md` — release guarantees and checklist
- Inline code comments — implementation details

If documentation and behavior ever diverge, the behavior is considered a bug.

---

## License

MIT
