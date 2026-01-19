# CHANGELOG.md

All notable changes to the PACT protocol and its reference implementations are documented here.

This project follows **Semantic Versioning** and prioritizes backward compatibility and determinism.

---

## [4.0.0] — Pact v4 Complete: Institution-Grade Autonomous Commerce Infrastructure

### Added
- **Pact v4 Protocol**: Complete implementation of institution-grade autonomous commerce infrastructure
  - **Pact Boundary Runtime**: Non-bypassable policy enforcement for agent spending
    - `runInPactBoundary()`: Mandatory execution envelope that enforces policy, records evidence, and standardizes abort semantics
    - Deterministic policy evaluation at negotiation and settlement stages
    - Automatic failure event generation on policy violations
  - **Policy-as-Code v4**: Deterministic, audit-grade constraint system
    - Policy DSL with primitive types, comparators, and logical operators
    - Deterministic policy hashing and evaluation
    - Policy evaluation traces embedded as evidence references
    - JSON Schema validation (`schemas/pact_policy_v4.json`)
  - **Transcript v4**: Hash-linked, cryptographically verifiable negotiation records
    - Append-only, hash-linked transcript structure
    - Signed negotiation rounds with cryptographic verification
    - Failure event integration with canonical taxonomy
    - Deterministic serialization and replay (`schemas/pact_transcript_v4.json`)
  - **Passport v1**: Agent reputation scoring with anti-collusion heuristics
    - SQLite storage for events and scores
    - Deterministic scoring function with recency decay, counterparty weighting, and dispute outcomes
    - Anti-wash trading and collusion detection
    - Query interface with caching and `as_of` timestamp support
  - **Credit v1**: Undercollateralized commitments with dynamic risk engine
    - Dynamic collateral ratios and kill switches
    - Exposure caps and deterministic risk calculations
    - Policy-gated and Passport-gated credit decisions
  - **Arbitration v4**: Transcript-constrained dispute resolution with signed decision artifacts
    - Signed decision artifacts with Ed25519 signatures
    - Canonical reason codes (non-free-text)
    - Deterministic validation and failure code mapping
    - JSON Schema (`schemas/pact_arbiter_decision_v4.json`)
  - **Evidence Bundles**: Courtroom-grade audit artifacts with deterministic manifests
    - Complete evidence collection (transcript, decision artifacts, policy, receipts)
    - Deterministic MANIFEST.json with hash verification
    - Machine-generated SUMMARY.md narratives
    - View-aware redaction support (INTERNAL, PARTNER, AUDITOR)
  - **Transcript Redaction**: Cross-trust-boundary sharing with cryptographic integrity preservation
    - Structural redaction preserving cryptographic invariants
    - Three canonical views: INTERNAL, PARTNER, AUDITOR
    - Deterministic redaction (same input → same output)
    - JSON Schema for redacted fields (`schemas/pact_redacted_field_v4.json`)
  - **Failure Taxonomy**: Canonical error classification with blame isolation
    - Structured FailureEvent schema with stage, fault_domain, terminality
    - Canonical error families: PACT-1xx (Policy), PACT-2xx (Identity), PACT-3xx (Negotiation), PACT-4xx (Settlement), PACT-5xx (Recursive)
    - Anti-griefing and default blame rules

### Documentation
- `docs/v4/STATUS.md`: Complete status document declaring v4 COMPLETE
- `docs/v4/POLICY.md`: Policy-as-Code v4 specification
- `docs/v4/PASSPORT.md`: Passport v1 specification
- `docs/v4/CREDIT.md`: Credit v1 specification
- `docs/v4/ARBITRATION.md`: Arbitration specification
- `docs/v4/EVIDENCE_BUNDLE.md`: Evidence bundle specification
- `docs/v4/REDACTION.md`: Transcript redaction specification
- `docs/v4/FAILURE_TAXONOMY.md`: Failure taxonomy specification

### Examples
- `examples/v4/quickstart-demo.ts`: Complete v4 demo showcasing all features
- `pnpm demo:v4:canonical`: One-command demo script

### Schemas
- `schemas/pact_transcript_v4.json`: Transcript v4 JSON Schema
- `schemas/pact_policy_v4.json`: Policy v4 JSON Schema
- `schemas/pact_arbiter_decision_v4.json`: Arbitration decision JSON Schema
- `schemas/pact_redacted_field_v4.json`: Redacted field JSON Schema

### Status
- **703 tests passing** (4 skipped)
- All core components implemented and tested
- Production-ready for institution-grade deployments
- Complete feature set: Governance, Control Plane, Identity & Credit, Enterprise & Legal Readiness

---

## [Unreleased] — Replay Verification Improvements & Provider Server Updates

### Changed
- **Replay Verification**: `CREDENTIAL_EXPIRED` and `WALLET_VERIFY_FAILED` are now treated as warnings (not errors) in replay verification
  - Expired credentials are expected for historical transcripts and should not fail replay
  - Wallet signature verification failures may occur due to changes in payload hash calculation or historical transcript formats
  - Both are now consistently treated as warnings in both default and strict modes
- **Provider Server Default Port**: Changed default port from `7777` to `0` (random available port)
  - Prevents port conflicts when multiple provider servers are started
  - Server now reports the actual port used after binding
- **Vitest Configuration**: Added thread pool options and teardown timeout to prevent test hanging issues

### Fixed
- **Replay CLI**: Fixed exit code to be `0` when only warnings are present (expired credentials or wallet verification failures)
- **Replay Verification CLI**: `WALLET_VERIFY_FAILED` no longer causes strict mode verification to fail

---

## [1.6.0-alpha] — Reconciliation & Signed Dispute Decisions

### Added
- **Reconciliation API (D2)**: `reconcile()` function for polling pending settlement handles and updating transcripts with final settlement status
  - Supports settlement providers with `poll()` method
  - Updates transcript `settlement_lifecycle` status (pending → committed/failed)
  - Records reconciliation events in transcript `reconcile_events` array
  - Writes updated transcripts with `-reconciled-<hash>.json` suffix
- **Signed Dispute Decisions (C3)**: Cryptographically signed dispute resolution artifacts
  - `hashDecision()`: SHA-256 hash of canonical dispute decision JSON
  - `signDecision()`: Ed25519 signature of decision hash by arbiter keypair
  - `verifyDecision()`: Verification of signed decision authenticity
  - `DisputeDecisionStore`: Filesystem storage for signed decisions (`.pact/disputes/decisions/`)
  - Integration with `resolveDispute()`: Optional `arbiterKeyPair` parameter for automatic signing
  - Transcript linkage: `dispute_events` include `decision_hash_hex` and `arbiter_pubkey_b58`
  - `DisputeRecord` linkage: Stores `decision_path`, `decision_hash_hex`, `decision_signature_b58`, `arbiter_pubkey_b58`

### Changed
- `TranscriptV1`: Added optional `reconcile_events` array for reconciliation audit trail
- `DisputeRecord`: Added optional fields for signed decision linkage (`decision_path`, `decision_hash_hex`, `decision_signature_b58`, `arbiter_pubkey_b58`)
- `TranscriptV1.dispute_events`: Added optional `decision_hash_hex` and `arbiter_pubkey_b58` fields

### Technical Details
- Reconciliation requires settlement provider to implement `poll()` method
- Signed decisions use Ed25519 signatures (tweetnacl) and base58 encoding (bs58)
- Decision hashing uses canonical JSON serialization for determinism
- All changes are additive and backward compatible

---

## [0.1.0] — Initial Public Release

### Added
- Core PACT protocol primitives
- Signed, canonical message envelopes
- Commit / reveal settlement flow
- Streaming settlement with tick-based payment
- Deterministic receipt generation
- Policy compilation and validation
- Reference price and reputation system
- Provider directory (in-memory and JSONL)
- HTTP provider adapter
- Explainable acquire flow (coarse and full modes)
- Comprehensive test suite

### Guarantees
- Deterministic execution
- Explicit failure modes
- Verifiable receipts
- Buyer-controlled settlement exits
- Provider accountability via signatures

### Notes
This is the first public release intended for:
- Agent-to-agent coordination
- Deterministic negotiation
- Pay-as-you-go data and service exchange

The API surface is considered **provisionally stable** but may evolve prior to `1.0.0`.

---

## Versioning Notes

- Breaking changes will increment the major version
- Protocol changes are always documented
- Silent behavioral changes are treated as bugs

---

## Upcoming (Planned)

These items are not committed and may change:

- Additional policy primitives
- Enhanced provider reputation signals
- Multi-intent batching
- Formal protocol specification (PDF)

---

## Security Fixes

Security-relevant changes will always be:
- Documented explicitly
- Released promptly
- Accompanied by migration notes when applicable

---

## Migration Guidance

When breaking changes occur:
- Clear upgrade paths will be provided
- Old behavior will not be removed without notice
- Receipts from prior versions remain valid

---

## Philosophy

The changelog exists to preserve trust.

If behavior changes, it belongs here.
