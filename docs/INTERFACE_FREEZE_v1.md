# Pact v4 Interface Freeze — Verifier & Evidence Contracts

**Status:** Contract (Binding for Pact v4.x)  
**Version:** INTERFACE_FREEZE_v1

---

## 1. Purpose (Non-Marketing)

This document defines the interfaces, semantics, and artifacts that are guaranteed stable for Pact v4.x. Any breaking change to these interfaces requires a v5 release.

**Backward-compatible:** A change is backward-compatible if existing valid artifacts and command invocations continue to verify and produce semantically equivalent outcomes.

---

## 2. Frozen CLI Interfaces (Hard Guarantees)

The following `pact-verifier` commands SHALL NOT change behavior in a breaking way within v4.x:

| Command | Description |
|---------|-------------|
| `pact-verifier gc-view` | GC-readable summary from v4 transcript |
| `pact-verifier gc-summary` | Quick one-liner GC fields |
| `pact-verifier insurer-summary` | Underwriter-focused risk/coverage analysis |
| `pact-verifier auditor-pack` | Create portable evidence ZIP |
| `pact-verifier auditor-pack-verify` | Verify integrity of an auditor pack ZIP |
| `pact-verifier judge-v4` | Run DBL judgment, output deterministic artifact |
| `pact-verifier passport-v1-recompute` | Recompute Passport v1 state from transcripts |
| `pact-verifier passport-v1-query` | Query local passport registry by signer |
| `pact-verifier contention-scan` | Detect DOUBLE_COMMIT and contention violations |

**Guarantee:** For each command above, the following are frozen:

- **Flags** — Existing flags SHALL NOT be removed or change meaning. New optional flags MAY be added in a backward-compatible way.
- **Exit codes** — Success (0) and failure (non-zero) semantics SHALL NOT change.
- **Semantic meaning of outputs** — The meaning of JSON fields and decision outputs (e.g. fault domains, coverage, integrity) SHALL NOT change. Formatting prettiness (whitespace, key order, human-readable summaries) is NOT guaranteed.
- **Stdout contract (for JSON commands)** — Commands that emit JSON SHALL emit valid JSON on stdout. Human-readable logs (if any) SHALL go to stderr. This guarantees machine-readability for auditors and downstream tooling; mixed or debug output on stdout is not permitted.

---

## 3. Frozen Artifact Schemas

The following artifacts are normative for Pact v4.x.

### Auditor Pack ZIP structure

- `manifest.json` — Package metadata and integrity summary
- `derived/gc_view.json` — GC View (gc_view/1.0)
- `derived/judgment.json` — DBL Judgment (dbl/2.0)
- `derived/insurer_summary.json` — Insurer Summary (insurer_summary/1.0)
- `constitution/CONSTITUTION_v1.md` — Rules document
- `checksums.sha256` — SHA-256 checksums for all files

The path `input/transcript.json` (original transcript) is normative; optional derived files (e.g. `derived/passport_snapshot.json`, `derived/contention_report.json`) MAY be added without breaking this contract.

**Rule:** Fields MAY be added in a backward-compatible way. Existing fields SHALL NOT change meaning. This protects Pact and downstream users.

### Schema version identifiers

The following version strings are normative for v4.x. Third parties MAY use them to validate artifacts and outputs quickly.

| Identifier | Artifact or output |
|------------|--------------------|
| `gc_view/1.0` | GC View JSON |
| `dbl/2.0` | DBL Judgment JSON |
| `insurer_summary/1.0` | Insurer Summary JSON |
| `passport/1.0` | Passport record (recompute/query) |
| `auditor_pack_verify/1.0` | auditor-pack-verify result JSON |
| `pact-transcript/4.0` | Pact v4 transcript |

---

## 4. Frozen Semantic Rules (Critical)

### Fault domains

The following fault domains are frozen. Their semantics SHALL NOT change in v4.x.

| Fault domain | Who is penalized | Who is not | Scrutiny |
|--------------|------------------|------------|----------|
| **NO_FAULT** | No one. | Buyer and provider. | None. |
| **BUYER_AT_FAULT** | Buyer (passport delta negative). | Provider. | Underwriting may apply buyer-specific risk/surcharge. |
| **PROVIDER_AT_FAULT** | Provider (passport delta negative). | Buyer. | Underwriting may apply provider-specific risk/surcharge. |
| **INDETERMINATE_TAMPER** | No agent. Passport delta SHALL be zero. | Both. | Underwriting SHALL treat differently from buyer/provider fault (e.g. surcharge TAMPER_SCRUTINY, risk factor INDETERMINATE_TAMPER). Fault is attributed to tamper or corruption of evidence, not to the agent. |

### Constitution enforcement

- **Accepted constitution for v4.x:** `a0ea6fe329251b8c92112fd7518976a031eb8db76433e8c99c77060fc76d7d9d` (constitution/1.0). This is the normative hash for the v4.x accepted constitution set; any other hash is non-standard unless explicitly allowed (e.g. `--allow-nonstandard`).
- **Constitution hash is authoritative.** The constitution hash under which a transcript was verified governs how that transcript is interpreted (including passport updates and coverage decisions).
- **Non-standard constitutions are excluded by default.** Packs or transcripts verified under a non-standard constitution hash SHALL be marked (e.g. NON_STANDARD) and SHALL NOT be treated as equivalent to the accepted constitution. Coverage SHALL be EXCLUDED unless explicitly overridden.
- **`auditor-pack-verify` SHALL fail by default on non-standard constitution.** Verification SHALL NOT pass when the pack’s constitution hash is non-standard unless `--allow-nonstandard` is set.
- **`insurer-summary` SHALL output EXCLUDED by default on non-standard constitution.** Coverage SHALL be EXCLUDED when the transcript or pack was verified under a non-standard constitution hash unless `--allow-nonstandard` is set.
- **`--allow-nonstandard` is an explicit override.** Where supported (e.g. `auditor-pack-verify`, `insurer-summary`), this flag allows processing of non-standard constitution hashes. Use is at the caller’s risk; semantics of non-standard constitutions are not guaranteed.

### Passport v1

- **Append-only** — Registry grows only by ingesting verified transcripts (or auditor-pack-verified evidence). No manual overrides, user-submitted score changes, or network submissions that bypass verification.
- **Deterministic recompute** — Same inputs (transcript, DBL judgment, signer role) → same score deltas. Recompute is replayable at any time.
- **No manual mutation** — Written fields (score, tier, history entry, constitution_hash) SHALL NOT be overwritten or edited. Corrections require a new transcript and full recompute.
- **No revocation** — Passport has no revocation mechanism; history is append-only.
- **No identity claims** — Passport does not assert or bind real-world identity; it is not KYC, access control, governance, or a token.

This section is why insurers trust Pact.

---

## 5. What Is Not Frozen (Important)

The following MAY change within v4.x without a major release:

- **UI / viewers** — Evidence Viewer layout, panels, styling, and features.
- **PDFs** — Export formats, page layout, and narrative text for GC View PDF, Insurer Summary PDF, or Claims Intake Package.
- **Demo scripts** — Example commands, demo provider behavior, and quickstart scripts.
- **Reference apps** — Example providers, buyer demos, and sample configurations.
- **Visual presentation** — Human-readable summaries, log messages, and any non-JSON output.

**Verifier warnings:** Credential expiry warnings do not invalidate transcript integrity; they indicate time-bounded KYA credentials and are expected for historical transcripts.

This protects Pact from future work on presentation and tooling without breaking the frozen interfaces and semantics above.

---

## 6. Versioning Promise

Pact v4.x guarantees backward compatibility for all interfaces defined in this document. Breaking changes will be introduced only in Pact v5 with explicit migration guidance.
