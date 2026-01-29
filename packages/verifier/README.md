# @pact/verifier

Pact v4 Transcript Verifier and Default Blame Logic (DBL) - Standalone CLI.

## Installation

```bash
# Install globally
npm install -g @pact/verifier

# Or use npx (no install required)
npx @pact/verifier gc-view --transcript transcript.json
```

## Quickstart (Auditors / Insurers)

### Verify a Transaction (Offline)

```bash
pact-verifier gc-view --transcript transcript.json
```

### Verify an Auditor Pack (Offline)

```bash
pact-verifier auditor-pack-verify --zip auditor_pack.zip
```

Expected result:

```json
{
  "ok": true,
  "checksums_ok": true,
  "recompute_ok": true
}
```

### If Verification Fails

| Status | Meaning |
|--------|---------|
| `FAILED_INTEGRITY` | Do not approve (evidence compromised) |
| `ABORTED_POLICY` | Buyer misconfiguration |
| `FAILED_PROVIDER_*` | Provider responsibility |

---

## Quick Start

```bash
# Verify a transcript and get GC-readable summary
pact-verifier gc-view --transcript transcript.json

# Quick summary (no jq needed)
pact-verifier gc-summary --transcript transcript.json

# Get insurer/underwriter view
pact-verifier insurer-summary --transcript transcript.json

# Run DBL judgment
pact-verifier judge-v4 --transcript transcript.json

# Scan for double-commits
pact-verifier contention-scan --transcripts-dir ./transcripts
```

## Available Commands

| Command                  | Description                                                                 |
|--------------------------|-----------------------------------------------------------------------------|
| `auditor-pack`           | Create portable evidence ZIP for auditors/claims                            |
| `auditor-pack-verify`    | Verify integrity of an auditor pack ZIP                                     |
| `gc-view`                | Generate GC-readable summary from v4 transcript                             |
| `gc-summary`             | Quick one-liner GC fields (no jq needed)                                    |
| `insurer-summary`        | Underwriter-focused risk/coverage analysis                                 |
| `judge-v4`               | Run DBL judgment, output deterministic artifact                            |
| `passport-v1-recompute`  | Recompute Passport v1 states from transcripts (multi-source ready; see below) |
| `passport-v1-query`      | Query local passport registry by signer pubkey                             |
| `contention-scan`        | Detect DOUBLE_COMMIT and contention violations                             |

## GC View Example

```bash
pact-verifier gc-view --transcript transcript.json | jq '.constitution.hash'
```

Output includes:
- `constitution.hash` - Deterministic rulebook identifier
- `executive_summary.status` - Transaction outcome
- `integrity` - Hash chain and signature verification
- `responsibility.judgment` - Fault attribution

## GC Summary (Quick View)

```bash
pact-verifier gc-summary --transcript transcript.json
```

Output:
```
Constitution: a0ea6fe329251b8c...
Integrity: VALID
Outcome: COMPLETED
Fault Domain: NO_FAULT
Required Action: NONE
Approval Risk: LOW
```

## Insurer Summary

```bash
pact-verifier insurer-summary --transcript transcript.json
```

Output:
```json
{
  "version": "insurer_summary/1.0",
  "constitution_hash": "a0ea6fe329251b8c...",
  "integrity": "VALID",
  "outcome": "COMPLETED",
  "fault_domain": "NO_FAULT",
  "confidence": 1.0,
  "buyer": { "signer": "21wxunPRWg...", "passport_score": 0.01, "tier": "B" },
  "provider": { "signer": "HBUkwmmQ...", "passport_score": 0.01, "tier": "B" },
  "risk_factors": [],
  "surcharges": [],
  "coverage": "COVERED"
}
```

Coverage decisions: `COVERED | COVERED_WITH_SURCHARGE | ESCROW_REQUIRED | EXCLUDED`

## Passport v1 (Registry-Ready)

### Recompute (multi-source)

Recompute passport state from one or more transcript directories. **Multi-source ready**: you can pass multiple `--transcripts-dir` arguments; transcripts are merged deterministically (by stable transcript ID), and duplicate transcripts emit a warning (first occurrence wins).

```bash
# Single directory
pact-verifier passport-v1-recompute --transcripts-dir ./transcripts

# Multiple directories (merged deterministically; warns on duplicates)
pact-verifier passport-v1-recompute --transcripts-dir ./dir1 --transcripts-dir ./dir2 --out registry.json
```

Output includes `version`, `signer`, `role` (BUYER/PROVIDER/UNKNOWN), `score`, `tier` (A/B/C/D), `history`, `last_updated`, `constitution_hash`. No global registry is built by default; the CLI is ready for multi-source ingestion.

### Query local registry

Query a local JSON registry by signer public key:

```bash
pact-verifier passport-v1-query --signer <base58_pubkey> [--registry registry.json]
```

If `--registry` is omitted, a default path is used. See [Passport Registry Contract](../../docs/passport/PASSPORT_REGISTRY_CONTRACT.md) for immutability, determinism, append-only, and fault domain **INDETERMINATE_TAMPER** (integrity failure → no agent penalty, underwriter scrutiny).

## Auditor Pack (Evidence Export)

Create a portable, self-contained evidence package for claims, regulators, or auditors:

```bash
pact-verifier auditor-pack --transcript transcript.json --out evidence.zip
```

Optional flags for additional artifacts:
```bash
# Include passport snapshots
pact-verifier auditor-pack --transcript tx.json --out evidence.zip \
  --include-passport --transcripts-dir ./transcripts

# Include contention report
pact-verifier auditor-pack --transcript tx.json --out evidence.zip \
  --include-contention --transcripts-dir ./transcripts
```

Package contents:
```
evidence.zip/
├── manifest.json           # Package metadata + integrity summary
├── checksums.sha256        # SHA-256 checksums for all files
├── README.txt              # Verification instructions
├── constitution/
│   └── CONSTITUTION_v1.md  # The rulebook
├── input/
│   └── transcript.json     # Original transcript
└── derived/
    ├── gc_view.json        # GC-readable summary
    ├── judgment.json       # DBL judgment
    ├── insurer_summary.json
    ├── passport_snapshot.json    (optional)
    └── contention_report.json    (optional)
```

Verify offline (manual):
```bash
unzip evidence.zip -d evidence/
cd evidence/
sha256sum -c checksums.sha256
```

Verify with CLI:
```bash
pact-verifier auditor-pack-verify --zip evidence.zip
```

Output:
```json
{
  "version": "auditor_pack_verify/1.0",
  "ok": true,
  "checksums_ok": true,
  "recompute_ok": true,
  "mismatches": [],
  "tool_version": "@pact/verifier 0.2.1"
}
```

The verification:
1. Validates all file checksums match
2. Recomputes derived artifacts from the transcript
3. Compares recomputed artifacts to stored versions
4. Returns exit code 0 if valid, 1 if any mismatch

## Constitution Hash

Every GC View includes a constitution hash that identifies the exact rulebook used:

```json
"constitution": {
  "version": "constitution/1.0",
  "hash": "a0ea6fe329251b8c92112fd7518976a031eb8db76433e8c99c77060fc76d7d9d",
  "rules_applied": ["DBL-1", "DBL-2", "DET-1", "EVD-1", "INT-1", "LVSH-1"]
}
```

The same constitution hash guarantees the same judgment for the same transcript.

## Related Documentation

- [Passport Registry Contract](../../docs/passport/PASSPORT_REGISTRY_CONTRACT.md) — Immutability, determinism, append-only, INDETERMINATE_TAMPER, explicit non-goals
- [GC 5-Minute Approval Checklist](../../docs/gc/GC_5_MINUTE_APPROVAL_CHECKLIST.md)
- [Insurer Underwriting View](../../docs/gc/INSURER_UNDERWRITING_VIEW.md)
- [Provider Failures (PACT-420/421)](../../docs/pilots/PROVIDER_FAILURES.md)

## Versioning Guarantees

- **PATCH**: bug fixes, no semantic changes
- **MINOR**: new failure codes, new summaries
- **MAJOR**: constitution, DBL, or transcript format changes

Auditor packs are forward-compatible within a major version.

---

## Monorepo Development

When developing in the Pact monorepo:

### Build

```bash
# From monorepo root
pnpm verifier:build

# From packages/verifier
pnpm build
```

### Run from Monorepo

```bash
# Via bin/pact-verifier (repo root)
./bin/pact-verifier gc-view --transcript fixtures/success/SUCCESS-001-simple.json

# Via package scripts
pnpm verifier:gc-view --transcript fixtures/success/SUCCESS-001-simple.json
```

### Test

```bash
# Run all verifier tests
pnpm test:verifier

# Run smoke test (fresh install simulation)
pnpm -C packages/verifier smoke
```

### Pack & Publish

```bash
cd packages/verifier
pnpm build
npm pack  # Creates @pact-verifier-x.x.x.tgz
npm publish --access public
```

---

## Pipe-Safe Output

All commands output clean JSON to stdout (no banners or logs). Safe for piping to `jq`:

```bash
pact-verifier gc-view --transcript t.json | jq '.executive_summary.status'
pact-verifier judge-v4 --transcript t.json | jq '.dblDetermination'
pact-verifier insurer-summary --transcript t.json | jq '.coverage'
```

Logs and errors go to stderr.
