# Additive Field Whitelist (v4.x)

**Status:** Contract (Binding for Pact v4.x)  
**Version:** ADDITIVE_FIELD_WHITELIST_v4x  
**Subtitle:** Allowed additive-only changes in v4.x

---

## 1. Purpose

Under [INTERFACE_FREEZE_v1.md](./INTERFACE_FREEZE_v1.md), existing CLI outputs and artifact schemas are frozen. **Existing fields SHALL NOT change meaning.** New fields MAY be added only in a backward-compatible, additive way.

This document defines the **additive field whitelist**: the exact paths, artifact extensions, and categories of change permitted within v4.x without breaking the freeze. Additive changes SHALL NOT introduce new guarantees, SHALL NOT weaken existing guarantees, and SHALL NOT cause semantic drift. Consumers MUST treat additive fields as optional and MUST NOT rely on their presence or absence for verification, coverage, or admissibility.

---

## 2. Invariants (No Exceptions)

- **No new guarantees.** Additive fields do not create new contractual obligations. They are informational or optional extensions only.
- **No weakening.** Additive fields do not relax, narrow, or override any frozen guarantee (CLI behavior, exit codes, fault domains, constitution enforcement, PoN, recompute).
- **No semantic drift.** The meaning of existing fields, commands, and artifacts SHALL NOT change. Additive content does not alter how verification, coverage, or admissibility are determined.

---

## 3. Exact Allowed Places

The following are the **only** categories where additive-only changes are permitted in v4.x:

| Category | Allowed | Not allowed |
|----------|---------|-------------|
| **Documentation** | New or updated docs (guides, specs, indexes). Clarifications that do not change contract meaning. | Docs that contradict INTERFACE_FREEZE_v1 or this whitelist. |
| **New CLI commands** | New optional subcommands (e.g. a future `merkle-digest`) that do not change behavior of existing subcommands. New optional flags on existing commands. | Removing or changing meaning of existing commands/flags; changing stdout JSON shape of existing commands. |
| **New optional derived files** | New optional files under `derived/` (e.g. a future `derived/merkle_digest.json`) that are not required for verification. Packs remain valid with or without them. | New required derived files; changing content or meaning of existing derived files. |
| **UI-only changes** | Evidence Viewer layout, panels, styling, new panels for additive fields, PDF layout, human-readable summaries. | UI that changes interpretation of verification outcome or coverage. |
| **Additive JSON paths** | Fields listed in §4 below, in the artifacts and locations specified. | New required fields; changes to existing field semantics. |

---

## 4. Allowed Additive Paths (Exact List)

The following paths are whitelisted for additive inclusion. Their presence MUST NOT change the semantic meaning of existing verification, recompute, or coverage outcomes.

| Path / scope | Description | Shipped in v4.0.5-rc1 |
|--------------|-------------|------------------------|
| `policy.audit` | Audit metadata (tier, SLA, note) on policy. Informational only. | Yes (metadata only) |
| `audit_tier` | Top-level audit tier (T1 / T2 / T3) in manifest or insurer_summary. Audit cadence label only. | Yes (metadata only) |
| `audit_sla` | Audit SLA string (e.g. "daily digest", "replay within 15m"). Informational only. | Yes (metadata only) |
| `gc_view.audit` | Audit block in GC View (tier, sla, note). Informational only. | Yes (metadata only) |
| `insurer_summary.audit_tier` / `insurer_summary.audit_sla` | Audit metadata in insurer summary. Informational only. | Yes (metadata only) |
| `derived.merkle_digest` | Future: optional Merkle digest artifact in packs. Reserved; not shipped in v4.0.5-rc1. See [MERKLE_DIGEST_v1.md](./MERKLE_DIGEST_v1.md). | No (doc-only; reserved) |

---

## 5. Rules for Implementations

- **Additive only.** New fields MUST NOT change the interpretation of existing fields. Verification (PoN, recompute, constitution, fault domains) is unchanged by additive fields.
- **Optional.** Consumers MUST treat whitelisted additive fields as optional. Absence of an additive field MUST NOT be treated as an error. Presence MUST NOT be required for verification or admissibility.
- **Freeze baseline.** When computing baseline hashes for freeze protection (e.g. regression tests), additive paths listed above are stripped before comparison so that adding them does not invalidate baselines.
- **Future artifacts.** Artifacts not yet shipped (e.g. `derived/merkle_digest.json`) are reserved and on the whitelist for forward compatibility only; they are not relied upon in v4.x.

---

## 6. What Is Not Additive

- Changing the meaning of existing CLI flags or JSON fields.
- Removing or renaming existing fields.
- Changing exit codes or success/failure semantics for existing commands.
- Adding required fields to frozen artifacts (all additive fields are optional).
- Any change that weakens, narrows, or contradicts INTERFACE_FREEZE_v1.

---

**Last Updated:** January 2026
