# Tiered Verification Note

This note clarifies how **prevention**, **evidence**, and **tiering** interact in Pact v4. Tier and SLA metadata are for audit scheduling only; they do not change verification correctness or admissibility.

---

## Prevention is always real-time (Boundary)

- **Pact Boundary** enforcement (policy, velocity, credit) runs at transaction time.
- Policy violations, velocity limits, and credit checks are evaluated before settlement.
- Aborts (e.g. PACT-101) are deterministic and recorded in the transcript; **money does not move** on abort.
- Tier metadata does **not** relax or replace Boundary checks.

---

## Evidence can be summarized (Merkle) for scale (future)

- **Evidence plane** artifacts (e.g. auditor packs, GC view, insurer summary) support both per-transcript and batched workflows.
- **Merkle digest** is a future, doc-only additive anchor: a daily (or periodic) Merkle root over many transcript hashes, with inclusion proofs per transcript. See [MERKLE_DIGEST_v1.md](../MERKLE_DIGEST_v1.md). **Not implemented in v4.0.5-rc1.**
- Merkle digests would enable efficient commitment over large volumes (e.g. “daily root” for 10,000 transcripts) while keeping each pack self-contained with its own inclusion proof.
- Merkle is **not** used as “verification instead of PoN.” It would be an extra anchor for evidence summarization and audit scale; verification still relies on the full transcript and PoN guarantees.

---

## Tiering does NOT reduce admissibility

- **Audit tier** (T1 / T2 / T3) and **audit SLA** (e.g. “daily digest”, “replay within 15m”) are **informational only**.
- They affect **audit cadence and scheduling** (how often or how quickly evidence is reviewed), not whether a transaction is admissible or verifiable.
- A T3 transaction with SLA “daily digest” is verified with the **same** rules as a T1 transaction; tier and SLA do not change hash chain, signature, or recompute semantics.
- Default tier is T1 when not specified; existing packs without tier metadata remain fully valid and unchanged.

---

## Summary

| Concept            | Role                                      |
|--------------------|-------------------------------------------|
| **Prevention**     | Real-time (Boundary); policy, velocity, credit |
| **Evidence**       | Per-transcript; Merkle summarization is doc-only future (see [MERKLE_DIGEST_v1.md](../MERKLE_DIGEST_v1.md)) |
| **Tier / SLA**     | Audit schedule only; no impact on admissibility |

For implementation details, see the Evidence Viewer spec (tier/SLA display), [TIERED_VERIFICATION_SPEC.md](../TIERED_VERIFICATION_SPEC.md), and verifier CLI (auditor-pack with tier metadata; merkle-digest not shipped in v4.0.5-rc1).
