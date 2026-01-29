# Tiered Verification Spec (Doc Only)

**Status:** Specification (doc-only for v4.0.5-rc1)  
**Version:** TIERED_VERIFICATION_SPEC_v1

---

## 1. Purpose

This document specifies **tiered verification** in Pact v4: how audit tier and SLA metadata relate to verification, evidence, and the execution boundary. Tiering is **an audit cadence label only**. It does not change Proof of Negotiation (PoN), fault domains, coverage, or admissibility. The Boundary is always real-time. PoN transcripts remain the canonical evidence for verification and admissibility.

---

## 2. Definitions (Normative)

- **Tiering (audit tier / audit SLA):** A **label** used solely for **audit cadence**—i.e., how often or how quickly evidence is reviewed. It does not denote a different verification standard, a different evidence standard, or a different admissibility standard. Tiering is informational only.
- **Boundary:** The execution boundary (policy, velocity, credit) is enforced **in real time** at transaction time. Prevention (e.g. policy violations, aborts) happens before settlement. **No tier reduces, relaxes, or delays Boundary enforcement.** Boundary is always real-time regardless of tier.
- **Proof of Negotiation (PoN) / Transcript:** The PoN transcript is the **canonical evidence** for verification and admissibility. Hash chain, signatures, and recompute semantics are identical for all tiers. Tier metadata does not alter what counts as evidence or how evidence is verified.
- **Merkle digest:** Not part of v4.0.5 or v4.x guarantees. If a future Merkle digest is implemented, it is additive summarization only; it does not replace or alter PoN or transcript canonicity. See [MERKLE_DIGEST_v1.md](./MERKLE_DIGEST_v1.md) (reserved / not shipped / not relied upon in v4.x).

---

## 3. Guarantees (Lawyer-Proof)

1. **Tiering = audit cadence label only.** Audit tier (T1 / T2 / T3) and audit SLA (e.g. "daily digest", "replay within 15m") are labels for scheduling and cadence. They do not denote different verification rules, different evidence rules, or different admissibility rules.
2. **Boundary always real-time.** Policy, velocity, and credit enforcement occur at transaction time. No tier permits deferred or relaxed Boundary enforcement.
3. **PoN transcripts remain canonical evidence.** Verification and admissibility are determined by the transcript and frozen verification rules. Tier does not change which evidence is canonical or how it is interpreted.
4. **Same verification rules for all tiers.** A T3 transaction is verified with the same rules as a T1 transaction. Tier and SLA do not change fault domains, coverage, integrity semantics, or recompute semantics.
5. **Default and absence.** Default tier when not specified is T1. Packs without tier metadata remain fully valid and are treated identically for verification and admissibility.

---

## 4. Summary Table

| Concept | Role |
|--------|------|
| **audit_tier** | Label only: T1 / T2 / T3 — audit schedule / cadence; no impact on verification or admissibility |
| **audit_sla** | Label only: e.g. "daily digest", "replay within 15m" — informational; no impact on verification or admissibility |
| **Boundary** | Always real-time; policy, velocity, credit at transaction time |
| **PoN / Transcript** | Canonical evidence; same verification rules for all tiers |
| **Tier / SLA** | Audit cadence label only; no impact on admissibility or verification correctness |

---

## 5. Implementation Status (v4.0.5-rc1)

- **Shipped:** Tier and SLA metadata may appear in manifest, GC View, and insurer summary as additive fields (see [ADDITIVE_FIELD_WHITELIST_v4x.md](./ADDITIVE_FIELD_WHITELIST_v4x.md)). Evidence Viewer may display them for audit scheduling context only.
- **Merkle:** Not part of v4.0.5 guarantees. Not shipped. Not relied upon in v4.x. See [MERKLE_DIGEST_v1.md](./MERKLE_DIGEST_v1.md).

---

**Last Updated:** January 2026
