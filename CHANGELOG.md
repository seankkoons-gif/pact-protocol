# CHANGELOG.md

All notable changes to the PACT protocol and its reference implementations are documented here.

This project follows **Semantic Versioning** and prioritizes backward compatibility and determinism.

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
