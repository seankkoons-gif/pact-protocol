# PACT

**PACT** is a coordination, negotiation, and forensic layer for autonomous agents. It enables agents to transact safely without trusting themselves, their developers, or their runtime—only the transcript.

- **Negotiation**: Deterministic pricing and terms agreement between agents
- **Identity**: KYA verification with credential validation and cryptographic proof
- **Settlement**: Payment-rail agnostic coordination for execution boundaries (boundary, Stripe, escrow)
- **Forensics**: Cryptographically verifiable transcripts, evidence bundles, and replayable decision trails

```
Buyer Agent → negotiate → Provider → settle → transcript
```

## For Executives

Pact is **institution-grade autonomous commerce infrastructure**. It ensures that any AI agent authorized to spend money does so within a deterministic policy boundary, producing cryptographically verifiable records that explain what happened, why it happened, and who is responsible. 

**What Pact enables:**
- **Agents can spend money without trusting themselves** — Every decision is cryptographically recorded before settlement. If money moves, a Proof of Negotiation (PoN) transcript exists. If it doesn't exist, money cannot move.
- **Negotiation becomes a first-class, verifiable primitive** — Every ASK/BID/COUNTER is recorded and signed. You can audit price formation, prove an agent did not overpay, and detect predatory counterparties.
- **Policies are hard guarantees, not suggestions** — Policy-as-Code is enforced before settlement. Violations halt the transaction. You can promise "This agent will never pay more than $0.05" and prove it.
- **Failure is classified, not ambiguous** — Failures are typed events with blame attribution (PACT-101, PACT-202, etc.). You can distinguish who caused a failure, price risk, build insurance, and automate retries correctly.
- **Disputes can be resolved without humans or logs** — Disputes are resolved using only the transcript. Arbiters issue signed decisions constrained by evidence. No trust in narratives—only evidence.
- **Agents have reputation and credit, not just wallets** — Passport v1 provides agent reputation scoring. Credit v1 enables undercollateralized commitments. You can allow trusted agents to commit with reduced escrow.
- **Evidence is portable and role-aware** — Evidence bundles are cryptographically sealed with different views (internal, partner, auditor). Each audience sees exactly what they are allowed to see.
- **Time travel debugging exists** — You can deterministically replay decisions. This is the "flight recorder" moment for autonomous systems.

Pact does not move money or make decisions itself; it enforces constraints, records evidence, and standardizes failure, refund, and dispute resolution across payment rails. The result is that autonomous agents become auditable, insurable, and legally defensible — enabling enterprises to deploy them at scale without losing control.

## Run the canonical demo

**Pact v4** is complete and production-ready. Run the v4 demo:

```bash
pnpm i
pnpm demo:v4:canonical
```

**Expected output:**
```
═══════════════════════════════════════════════════════════
  PACT v4 Quickstart Demo
  Institution-Grade Autonomous Commerce Infrastructure
═══════════════════════════════════════════════════════════

📋 Setup:
   ✓ Created intent: weather.data (NYC)
   ✓ Created Policy v4: max_price <= $0.05
   ✓ Initialized Pact Boundary Runtime

🔄 Negotiation Starting...
  Intent: weather.data (NYC)
  Max price: $0.05 (enforced by Policy v4)
  Settlement: boundary (in-memory)

✅ Negotiation Complete!
  Agreed Price: $0.04
  Policy Hash: b4d401daf1ce1690...
  Transcript ID: transcript-...

🔍 Verifying Transcript...
     ✓ Integrity: VALID
     ✓ Signatures verified: X
     ✓ Hash chain verified: X rounds

🎉 Demo Complete!
```

**Replay transcript:**
```bash
pnpm replay:v4 .pact/transcripts/transcript-*.json
```

**Generate evidence bundle:**
```bash
pnpm evidence:bundle .pact/transcripts/transcript-*.json --out ./evidence-bundle
```

> **Note:** v3 remains stable and maintained. See [versions/v3/GETTING_STARTED.md](./docs/versions/v3/GETTING_STARTED.md) for v3 documentation.

---

## Pick your path

### v4 (Recommended — Complete & Production-Ready)

**Core Features:**
- **[Pact Boundary Runtime](./docs/versions/v4/POLICY.md)** — Non-bypassable policy enforcement (`pnpm demo:v4:canonical`)
- **[Policy-as-Code v4](./docs/versions/v4/POLICY.md)** — Deterministic, audit-grade constraint system
- **[Passport v1](./docs/versions/v4/PASSPORT.md)** — Agent reputation scoring and credit eligibility
- **[Evidence Bundles](./docs/versions/v4/EVIDENCE_BUNDLE.md)** — Courtroom-grade audit artifacts
- **[Transcript Redaction](./docs/versions/v4/REDACTION.md)** — Share transcripts across trust boundaries

**Real-world provider examples:**
- **[Weather Provider](./examples/providers/weather-provider/)** — Complete `weather.data` provider with deterministic pricing (`pnpm example:provider:weather`)
- **[LLM Verifier Provider](./examples/providers/llm-verifier-provider/)** — Complete `llm.verify` provider with KYA variants (`pnpm example:provider:llm`)

### v3 (Stable & Maintained)

**Use cases:**
- **[Negotiate only](./docs/versions/v3/PICK_YOUR_PATH.md#1-negotiate-only-no-money)** — Deterministic negotiation without settlement. See [`examples/v3/01-basic-negotiation.ts`](./examples/v3/01-basic-negotiation.ts).

- **[Negotiate + settle](./docs/versions/v3/PICK_YOUR_PATH.md#2-negotiate--settle-stripe--escrow)** — Negotiation with real settlement backends (Stripe, escrow). See [`examples/v3/04-stripe-integration.ts`](./examples/v3/04-stripe-integration.ts) or [`docs/integrations/INTEGRATION_ESCROW.md`](./docs/integrations/INTEGRATION_ESCROW.md).

- **[Multi-provider marketplace](./docs/versions/v3/PICK_YOUR_PATH.md#3-multi-provider-marketplace)** — Negotiate with multiple providers and select the best. See [`examples/v3/06-weather-api-agent.ts`](./examples/v3/06-weather-api-agent.ts).

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
- A canonical negotiation flow with hash-linked, replayable transcripts
- Multiple settlement modes with explicit guarantees
- Deterministic receipts and reputation signals
- Explainable selection and rejection logic
- Policy-as-Code enforcement (non-bypassable execution boundary)
- Canonical failure taxonomy with blame attribution
- Transcript-constrained arbitration with signed decision artifacts
- Agent reputation and credit systems (Passport v1, Credit v1)
- Evidence bundles for cross-trust-boundary sharing

If two agents both implement PACT, they can transact **without prior trust**.

## Use Cases

Because Pact exists, developers can build:

- **Autonomous procurement agents** — Agents that negotiate and purchase services autonomously within policy constraints
- **Agent-to-agent marketplaces** — Marketplaces where agents negotiate directly without centralized order books
- **SLA-enforced API brokers** — Brokers that enforce service level agreements through policy and evidence
- **Agent credit systems** — Credit systems that enable undercollateralized commitments based on reputation
- **Machine insurance products** — Insurance products that price risk based on failure taxonomy and evidence
- **Compliance-grade AI services** — AI services that produce auditable, legally defensible transaction records
- **Enterprise agent platforms** — Platforms that enable enterprises to deploy autonomous agents at scale with full auditability

All without building compliance infrastructure themselves.

---

## Status

**v4** is **COMPLETE** ✅ — Institution-grade autonomous commerce infrastructure. 

Pact v4 is the first moment where Pact can truthfully be described as **institution-grade autonomous commerce infrastructure**. All core components are implemented, tested, and production-ready:

- ✅ **Proof of Negotiation (PoN)** — Hash-linked, replayable transcripts
- ✅ **Pact Boundary Runtime** — Non-bypassable policy enforcement
- ✅ **Policy-as-Code v4** — Deterministic, audit-grade constraint system
- ✅ **Canonical Failure Taxonomy** — Typed failures with blame attribution
- ✅ **Arbitration** — Transcript-constrained dispute resolution
- ✅ **Passport v1** — Agent reputation scoring and credit eligibility
- ✅ **Credit v1** — Undercollateralized commitments
- ✅ **Evidence Bundles** — Courtroom-grade audit artifacts
- ✅ **Transcript Redaction** — Cross-trust-boundary sharing

See [versions/v4/STATUS.md](./docs/versions/v4/STATUS.md) for complete feature list.

**v3** is stable and maintained — Recommended for production until v4 migration complete. See [versions/v3/GETTING_STARTED.md](./docs/versions/v3/GETTING_STARTED.md).

**v1** is frozen at `v1.7.0-rc6` (read-only, critical fixes only). See [versions/v1/V1_READ_ONLY.md](./docs/versions/v1/V1_READ_ONLY.md) for details.

**v2** is active development on branch `v2` (architectural reset, breaking changes). See [versions/v2/ARCHITECTURE.md](./docs/versions/v2/ARCHITECTURE.md) for design.

---

## Getting Started

### Quick Start (v4 Recommended)

```bash
# Clone and install
git clone https://github.com/seankkoons-gif/pact_.git
cd pact
pnpm install

# Run the v4 canonical demo
pnpm demo:v4:canonical

# Replay the generated transcript
pnpm replay:v4 .pact/transcripts/transcript-*.json

# Generate an evidence bundle
pnpm evidence:bundle .pact/transcripts/transcript-*.json --out ./evidence-bundle --view auditor
```

See [getting-started/QUICKSTART.md](./docs/getting-started/QUICKSTART.md) for a complete walkthrough.

### Verify Transcripts

Strict mode skips pending transcripts and treats expired credentials as warnings (expected for historical transcripts):

```bash
pnpm replay:verify --strict --terminal-only -- .pact/transcripts
```

To skip historical transcripts (v1/v2 or older than threshold) and avoid expired credential warnings:

```bash
pnpm replay:verify:recent
# or
pnpm replay:verify --no-historical -- .pact/transcripts
# Custom threshold (default: 30 days)
pnpm replay:verify --no-historical --historical-days 7 -- .pact/transcripts
```

---

## Public API

PACT v4 provides a **complete, production-ready API** for institution-grade autonomous commerce. See [versions/v4/STATUS.md](./docs/versions/v4/STATUS.md) for complete feature list.

**v4 API (Recommended):**
- `runInPactBoundary()` — Non-bypassable policy enforcement
- `evaluatePolicy()` — Policy-as-Code evaluation
- `replayTranscriptV4()` — Transcript verification
- `evidence:bundle` — Evidence bundle generation
- `openDispute()` / `resolveDispute()` — Dispute resolution

**v3 API (Stable and maintained):**
- `acquire()` — Main entrypoint for negotiation and settlement
- `SettlementProvider` — Interface for settlement execution
- `replayTranscript()` / `verifyTranscriptFile()` — Transcript validation

See [V1_CONTRACT.md](./docs/versions/v1/V1_CONTRACT.md) for v1 API stability guarantees.

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
- **[getting-started/QUICKSTART.md](./docs/getting-started/QUICKSTART.md)** — Get started in <10 minutes
- **[versions/v4/STATUS.md](./docs/versions/v4/STATUS.md)** — v4 Status (COMPLETE ✅ — Institution-grade infrastructure)
- **[versions/v3/GETTING_STARTED.md](./docs/versions/v3/GETTING_STARTED.md)** — v3 Getting Started Guide
- **[versions/v3/RELEASE_NOTES.md](./docs/versions/v3/RELEASE_NOTES.md)** — v3 Release Notes (what's new, optional, experimental)
- **[reference/WHY_PACT.md](./docs/reference/WHY_PACT.md)** — Why PACT exists and what problems it solves

**v4 Features:**
- **[versions/v4/STATUS.md](./docs/versions/v4/STATUS.md)** — v4 Status (COMPLETE ✅ — Institution-grade infrastructure)
- **[versions/v4/USE_CASES.md](./docs/versions/v4/USE_CASES.md)** — Use cases enabled by Pact v4
- **[versions/v4/POLICY.md](./docs/versions/v4/POLICY.md)** — Policy-as-Code v4 (deterministic constraint system)
- **[versions/v4/PASSPORT.md](./docs/versions/v4/PASSPORT.md)** — Passport v1 (agent reputation scoring)
- **[versions/v4/CREDIT.md](./docs/versions/v4/CREDIT.md)** — Credit v1 (undercollateralized commitments)
- **[versions/v4/ARBITRATION.md](./docs/versions/v4/ARBITRATION.md)** — Arbitration (transcript-constrained dispute resolution)
- **[versions/v4/EVIDENCE_BUNDLE.md](./docs/versions/v4/EVIDENCE_BUNDLE.md)** — Evidence Bundles (courtroom-grade audit artifacts)
- **[versions/v4/REDACTION.md](./docs/versions/v4/REDACTION.md)** — Transcript Redaction (cross-trust-boundary sharing)
- **[versions/v4/FAILURE_TAXONOMY.md](./docs/versions/v4/FAILURE_TAXONOMY.md)** — Failure Taxonomy (canonical error classification)

**Integration Guides:**
- **[integrations/INTEGRATION_ESCROW.md](./docs/integrations/INTEGRATION_ESCROW.md)** — EVM escrow contract integration
- **[integrations/WALLET_VERIFICATION.md](./docs/integrations/WALLET_VERIFICATION.md)** — Wallet signature verification
- **[integrations/INTEGRATION_STRIPE_LIVE.md](./docs/integrations/INTEGRATION_STRIPE_LIVE.md)** — Stripe integration
- **[integrations/INTEGRATION_ZK_KYA.md](./docs/integrations/INTEGRATION_ZK_KYA.md)** — ZK-KYA external integration

**Distribution & Publishing:**
- **[distribution/DISTRIBUTION.md](./docs/distribution/DISTRIBUTION.md)** — How to share, install, and distribute PACT
- **[distribution/NPM_PUBLISHING.md](./docs/distribution/NPM_PUBLISHING.md)** — npm publishing guide

**Architecture & Security:**
- **[integrations/EXECUTION_BOUNDARY.md](./docs/integrations/EXECUTION_BOUNDARY.md)** — Execution boundary architecture
- **[security/SECURITY_MODEL.md](./docs/security/SECURITY_MODEL.md)** — Security model and practices
- **[architecture/ERROR_HANDLING.md](./docs/architecture/ERROR_HANDLING.md)** — Error handling patterns and edge cases
- **[architecture/PERFORMANCE.md](./docs/architecture/PERFORMANCE.md)** — Performance considerations and optimization

**Reference:**
- **[DOCUMENTATION_INDEX.md](./docs/DOCUMENTATION_INDEX.md)** — Complete documentation index
- **[V1_CONTRACT.md](./docs/versions/v1/V1_CONTRACT.md)** — API stability guarantees and contract
- **[PROTOCOL.md](./docs/reference/PROTOCOL.md)** — Protocol semantics and behavior
- **[versions/v2/V2_FOUNDATION.md](./docs/versions/v2/V2_FOUNDATION.md)** — v2 features foundation and roadmap
- **[examples/](./examples/)** — Working code examples

### Stable Entrypoints

**v4 API (Recommended):**
- **`runInPactBoundary()`** — Non-bypassable policy enforcement
- **`evaluatePolicy()`** — Policy-as-Code evaluation
- **`replayTranscriptV4()`** — v4 transcript verification
- **`evidence:bundle`** — Evidence bundle generation
- **`openDispute()` / `resolveDispute()`** — Dispute resolution

**v3 API (Stable and maintained):**
- **`acquire()`** — Main entrypoint for negotiation and settlement
- **`SettlementProvider`** — Interface for settlement execution
- **`reconcile()`** — Reconciliation for pending settlements
- **`replayTranscript()` / `verifyTranscriptFile()`** — Transcript validation

### Version Recommendation

For production use, we recommend:
- **v4** — Complete, production-ready, institution-grade autonomous commerce infrastructure
- **v3** — Stable and maintained, recommended until v4 migration complete
- **v1.7.2+** — API freeze with stable public entrypoints (v1 frozen)

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
- Quotes (ASK/BID/COUNTER)
- Acceptance (ACCEPT/REJECT)
- Locking of funds or bonds

No open-ended haggling. No hidden state. In v4, every round is hash-linked and cryptographically signed (Proof of Negotiation).

### 4. Policy-as-Code (v4)
Policies are executable constraints that define what is acceptable, not what is optimal. In v4, policies are enforced by a non-bypassable execution boundary (Pact Boundary Runtime). Violations halt transactions immediately.

### 5. Transcripts (v4)
Transcripts are deterministic, replayable, auditable records of negotiation and settlement. In v4, transcripts are hash-linked (Proof of Negotiation) and cryptographically verifiable. They are the source of truth, not a side effect of execution.

### 6. Evidence (v4)
Evidence bundles enable sharing transcripts across trust boundaries while preserving cryptographic integrity. Different views (internal, partner, auditor) show appropriate levels of detail.

---

## Settlement

PACT is **payment-rail agnostic**. The settlement interface can be implemented by custodial wallets, on-chain smart contracts, payment processors, or mock providers (default). See [V1_5.md](./docs/versions/v1/V1_5.md#settlement-seams-v155) for details.

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
- The same transcript is generated (v4: hash-linked Proof of Negotiation)

**v4 Transcripts** are deterministic, replayable, and cryptographically verifiable:
- Every round is hash-linked (previous_round_hash → round_hash)
- Every round is cryptographically signed
- Any tampering breaks verification immediately
- Replay produces identical results (time travel debugging)

**v4 Policy-as-Code** provides explainable constraints:
- Policies are evaluated deterministically
- Violations produce structured failure events (PACT-101, etc.)
- Evidence refs track which rules were violated
- Replay shows exact policy evaluation path

**v4 Evidence Bundles** enable cross-trust-boundary sharing:
- Cryptographically sealed bundles
- Role-aware views (internal, partner, auditor)
- Tamper detection via hash verification
- Machine-generated narratives

This is critical for debugging, auditing, governance, and legal defensibility.

### Error Codes (Handling Failures)

PACT uses explicit error codes for failure modes. Integrations should branch on `code`
and treat `reason` as human-readable context.

**v4 Failure Taxonomy** (Canonical error classification):
- **PACT-101** — Policy violation (policy constraint violated)
- **PACT-202** — KYA/credential expiry (identity verification failed)
- **PACT-303** — Negotiation deadlock (strategic failure)
- **PACT-404** — Settlement timeout (settlement rail failure)
- **PACT-505** — Recursive dependency failure (sub-agent failure)

Each failure includes: `stage`, `fault_domain`, `terminality`, `evidence_refs`. See [v4/FAILURE_TAXONOMY.md](./docs/v4/FAILURE_TAXONOMY.md) for complete taxonomy.

**v3/v1 Error Codes** (Legacy):
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

- **Explicit over implicit** — Policies, constraints, and decisions are explicit and verifiable
- **Determinism over convenience** — Same inputs → same outputs → same transcripts
- **Auditable outcomes over opaque success** — Every decision is recorded and replayable
- **Evidence over trust** — No trust in narratives; only cryptographic evidence
- **Institution-grade over quick wins** — Built for legal admissibility and regulatory compliance

If something cannot be explained after the fact, it does not belong in the protocol.

## The Standard We Set

Pact v4 establishes a new standard for autonomous agent commerce:

- **Agents can spend money without trusting themselves** — The boundary runtime ensures all spending occurs within policy constraints
- **Every negotiation is verifiable** — Hash-linked transcripts prove what happened and why
- **Policies are hard guarantees** — Policy violations halt transactions; no exceptions
- **Failures are classified** — Canonical failure taxonomy enables risk pricing and insurance
- **Disputes are evidence-based** — Arbitration decisions are constrained by transcript evidence only
- **Reputation is computable** — Passport scores are derived from deterministic transcript history
- **Evidence is portable** — Evidence bundles can be shared across trust boundaries while preserving integrity

This is the standard for institution-grade autonomous commerce infrastructure.

---

## Documentation

- `PROTOCOL.md` — how the protocol works
- `PRE_PUBLISH.md` — release guarantees and checklist
- Inline code comments — implementation details

If documentation and behavior ever diverge, the behavior is considered a bug.

---

## License

MIT
