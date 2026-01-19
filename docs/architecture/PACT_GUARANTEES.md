# Pact Guarantees

**Protocol Version:** `pact-transcript/4.0`  
**Document Version:** 1.0  
**Last Updated:** 2025-01-27

This document enumerates the guarantees provided by the Pact protocol. Each guarantee is declarative, testable, and backed by a verifiable artifact.

---

## 1. Transcript Immutability

**Guarantee:** Pact guarantees that once a transcript is generated, it cannot be modified without detection.

**Testability:** Any modification to a transcript file (addition, deletion, or alteration of bytes) will cause transcript verification to fail. Verification computes a hash chain from the initial hash through all rounds; any tampering breaks the chain.

**Artifact:** Transcript file (`.pact/transcripts/*.json`) with hash-linked rounds. Verification command: `pnpm replay:v4 <transcript_path>`.

**Verification Result:** `INTEGRITY: VALID` or `INTEGRITY: FAIL` with specific hash mismatch errors.

---

## 2. Cryptographic Signature Verification

**Guarantee:** Pact guarantees that every negotiation round is cryptographically signed and that signatures can be verified independently.

**Testability:** Each round contains a `signature` object with `signer_public_key_b58`, `signature_b58`, and `scheme`. Verification validates the signature against the round's envelope hash using the signer's public key.

**Artifact:** Transcript rounds with embedded signatures. Verification command: `pnpm replay:v4 <transcript_path>`.

**Verification Result:** Signature validation errors are reported per round if verification fails.

---

## 3. Policy Enforcement

**Guarantee:** Pact guarantees that policy constraints are evaluated before settlement and that policy violations halt transaction execution.

**Testability:** A transaction with a policy violation (e.g., `max_price: 0.05` with an offer of `0.10`) will produce a transcript with a `failure_event` containing `code: "PACT-101"` and `stage: "NEGOTIATION"` or `"SETTLEMENT"`. No settlement will occur.

**Artifact:** Transcript with `failure_event` and `evidence_refs` pointing to violated policy rules. Policy hash is embedded in transcript root.

**Verification Result:** Transcript replay shows policy evaluation trace and identifies violated rules.

---

## 4. Deterministic Replay

**Guarantee:** Pact guarantees that given the same transcript file, replay produces identical results.

**Testability:** Replaying the same transcript file multiple times produces identical verification results, hash computations, and narrative outputs. No non-deterministic behavior (random numbers, timestamps, external calls) affects replay.

**Artifact:** Transcript file. Verification command: `pnpm replay:v4 <transcript_path>` (run multiple times).

**Verification Result:** Identical output across all replays, including hash values, signature verification results, and narrative text.

---

## 5. Failure Attribution

**Guarantee:** Pact guarantees that every failed transaction produces exactly one `FailureEvent` with unambiguous blame attribution.

**Testability:** Every transcript with `failure_event` contains: `code` (canonical error code), `stage` (negotiation stage where failure occurred), `fault_domain` (BUYER, PROVIDER, RAIL, or SYSTEM), and `terminality` (TERMINAL or RECOVERABLE). The failure taxonomy ensures no ambiguity.

**Artifact:** Transcript with `failure_event` object. Failure codes are enumerated in `docs/versions/v4/FAILURE_TAXONOMY.md`.

**Verification Result:** Replay identifies the failure code, stage, fault domain, and whether the failure was terminal.

---

## 6. Evidence Bundle Integrity

**Guarantee:** Pact guarantees that evidence bundles are tamper-evident and that any modification to bundle contents is detectable.

**Testability:** The `MANIFEST.json` in an evidence bundle contains SHA-256 hashes of every file. Modifying any file (transcript, decision artifact, summary) causes manifest verification to fail.

**Artifact:** Evidence bundle directory with `MANIFEST.json`. Verification command: `pnpm evidence:verify <bundle_dir>`.

**Verification Result:** `INTEGRITY PASS` or `INTEGRITY FAIL` with list of files with hash mismatches.

---

## 7. Arbitration Decision Verifiability

**Guarantee:** Pact guarantees that arbitration decision artifacts are cryptographically signed and can be verified independently of the transcript.

**Testability:** An arbitration decision artifact contains `arbiter_pubkey`, `signature`, and `transcript_hash`. Verification validates the signature against the canonical serialization of the decision and confirms `transcript_hash` matches the transcript.

**Artifact:** Decision artifact file (`schemas/pact_arbiter_decision_v4.json`). Verification is performed by `evidence:verify` command.

**Verification Result:** Signature verification passes or fails; transcript hash linkage is validated.

---

## 8. Transcript Permanence

**Guarantee:** Pact guarantees that v4 transcripts generated today will remain verifiable indefinitely under the v4 specification.

**Testability:** A transcript generated by v4.0.0 must be verifiable by any future v4.x release. The v4 specification is frozen; no breaking changes will be introduced to `pact-transcript/4.0`.

**Artifact:** Transcript file with `version: "pact-transcript/4.0"`. Specification authority: `schemas/pact_transcript_v4.json`, `docs/versions/v4/FAILURE_TAXONOMY.md`, `docs/versions/v4/ARBITRATION.md`.

**Verification Result:** Transcripts remain verifiable across all v4.x releases.

---

## 9. Policy Hash Stability

**Guarantee:** Pact guarantees that identical policies produce identical policy hashes across all executions.

**Testability:** Two policy objects with identical structure and values produce the same `policy_hash` when serialized canonically. Policy hash computation is deterministic and does not depend on execution context.

**Artifact:** Policy object and computed `policy_hash` embedded in transcript root.

**Verification Result:** Identical policies produce identical hashes; policy hash is stable across replays.

---

## 10. Redaction Integrity Preservation

**Guarantee:** Pact guarantees that redacted transcript views preserve cryptographic integrity and that redacted fields can be verified against original hashes.

**Testability:** A redacted transcript view (PARTNER or AUDITOR) replaces sensitive fields with `{ redacted: true, hash: <sha256(original)> }`. Verification confirms that redacted field hashes match the original transcript's computed hashes.

**Artifact:** Redacted transcript view (`VIEW.json` in evidence bundle) with `source_transcript_hash` pointing to original transcript.

**Verification Result:** Redacted view verification confirms hash matches for all redacted fields; original transcript hash is preserved.

---

## 11. Settlement Coordination Determinism

**Guarantee:** Pact guarantees that settlement coordination is deterministic and that identical negotiation inputs produce identical settlement instructions.

**Testability:** Two negotiations with identical inputs (intent, policy, provider quotes, buyer responses) produce identical transcripts, including settlement amounts, recipient addresses, and settlement mode.

**Artifact:** Transcript with settlement coordination details embedded in rounds and receipt.

**Verification Result:** Replay produces identical settlement instructions; no non-deterministic settlement logic.

---

## 12. Failure Event Uniqueness

**Guarantee:** Pact guarantees that every failed transaction produces exactly one `FailureEvent` and that no transaction can have multiple failure events.

**Testability:** Transcript schema enforces that `failure_event` is optional and, if present, is a single object (not an array). Once a `failure_event` is present, no further rounds can be appended.

**Artifact:** Transcript with `failure_event` object (if transaction failed) or no `failure_event` (if transaction succeeded).

**Verification Result:** Schema validation enforces single failure event; transcript structure is validated.

---

## 13. Evidence Reference Validity

**Guarantee:** Pact guarantees that `evidence_refs` in failure events and decision artifacts reference valid locations within the transcript or external artifacts.

**Testability:** Evidence references follow a deterministic format (e.g., `policy_rule:max_price`, `round:2`, `transcript_hash:...`). Verification confirms that referenced rounds exist, policy rules are defined, and external artifact hashes are present.

**Artifact:** Transcript with `failure_event.evidence_refs` array or decision artifact with `evidence_refs` array.

**Verification Result:** Evidence references are validated against transcript structure; invalid references are reported.

---

## 14. Passport Score Determinism

**Guarantee:** Pact guarantees that Passport scores are computed deterministically from transcript history and that identical event histories produce identical scores.

**Testability:** Two agents with identical `passport_events` histories (same events, same timestamps, same counterparties) produce identical Passport scores, confidence values, and breakdowns when computed at the same timestamp.

**Artifact:** Passport score query result with `score`, `confidence`, and `breakdown` fields. Input: `passport_events` table entries derived from transcripts.

**Verification Result:** Identical event histories produce identical scores; score computation is deterministic and replayable.

---

## 15. Credit Decision Determinism

**Guarantee:** Pact guarantees that credit decisions are deterministic and based solely on Passport scores, exposure history, and policy constraints.

**Testability:** Two credit requests with identical inputs (agent_id, requested_amount, current_exposure, Passport score) produce identical credit decisions (approved/denied, required_collateral, denial_reason).

**Artifact:** Credit decision embedded in boundary runtime abort event or settlement preparation result.

**Verification Result:** Identical inputs produce identical credit decisions; no non-deterministic risk assessment.

---

## Specification Authority

The guarantees enumerated above are defined by the following authoritative documents:

- **Transcript Schema:** `schemas/pact_transcript_v4.json`
- **Failure Taxonomy:** `docs/versions/v4/FAILURE_TAXONOMY.md`
- **Arbitration:** `docs/versions/v4/ARBITRATION.md`
- **Policy Evaluation:** `docs/versions/v4/POLICY.md`
- **Evidence Bundles:** `docs/versions/v4/EVIDENCE_BUNDLE.md`
- **Redaction:** `docs/versions/v4/REDACTION.md`
- **Protocol Stability:** `docs/versions/v4/STATUS.md` (Protocol Stability & Guarantees section)

---

## Verification Commands

All guarantees can be verified using the following commands:

- **Transcript Verification:** `pnpm replay:v4 <transcript_path>`
- **Evidence Bundle Verification:** `pnpm evidence:verify <bundle_dir>`
- **Transcript Replay:** `pnpm replay:v4 <transcript_path>`
- **Policy Evaluation:** Policy evaluation is deterministic and embedded in transcript replay

---

**Document Status:** This document enumerates guarantees for `pact-transcript/4.0`. These guarantees are stable and will not be modified within the v4.x release series.
