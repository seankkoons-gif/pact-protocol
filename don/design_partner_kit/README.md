# Design Partner Kit

This folder is the Don-level canonical **path** for the Design Partner Kit. The current canonical **implementation** lives at [design_partner_bundle](../../design_partner_bundle). This folder exists to anchor official references under `/don` until the bundle layout is finalized.

**Purpose:** Single kit for design partners containing pre-built auditor packs, verification scripts, and a short README.

**What will go here:**

- **packs/** — Pre-generated auditor packs (success, failure, tier demos) ready to open in the evidence viewer or verify via script
- **verify_all.sh** — Bash script to verify all packs (checksums, recompute, tamper detection)
- **verify_all.ps1** — PowerShell equivalent for Windows
- **README.md** — Quick start: how to verify packs, how to open in evidence viewer, link to constitution

No protocol semantics; only packaging of existing Pact evidence and verification of that packaging.

## Verification

- **Run:** `./don/design_partner_kit/verify_all.sh` (from the repository root).
- This delegates to the canonical kit at [design_partner_bundle](../../design_partner_bundle) to avoid drift.
- The packs and scripts in `design_partner_bundle` are the current source of truth.

## Current Status

This folder is an index/wrapper, not a duplicate kit. Scripts and content live in `design_partner_bundle`; this README and structure under `don/` provide the official Don path for the kit until the bundle layout is settled.
