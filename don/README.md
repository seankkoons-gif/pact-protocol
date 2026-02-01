# Don

Don is the official **packaging, proof, and presentation layer** for Pact. It assembles verifier output, constitution, and tooling into distributable artifacts and a viewer so that evidence produced by the protocol can be verified and reviewed without running agents or payment systems.

Don does **not** define protocol semantics. It packages and presents existing Pact evidence; it does not change how transcripts are verified, how blame is attributed, or what the constitution requires.

Don exists so that Pact evidence is **verifiable by auditors, insurers, and partners**. It provides a canonical design-partner kit, a read-only evidence viewer, constitution text and hash, and a release ritual—all without requiring access to the runtime SDK or provider stack.

## Canonical Artifacts

| Artifact | Location |
|----------|----------|
| **Design Partner Kit** (canonical implementation) | [design_partner_bundle](../design_partner_bundle) |
| **Evidence Viewer v0** (0.1.x) | [apps/evidence-viewer](../apps/evidence-viewer) |
| **Pact Constitution v1** | [don/constitution/PACT_CONSTITUTION_V1.md](./constitution/PACT_CONSTITUTION_V1.md) |
| **Release Ritual** | [don/release/RELEASE_RITUAL.md](./release/RELEASE_RITUAL.md) |

## Contents (Don layout)

| Folder | Purpose |
|--------|---------|
| [design_partner_kit](./design_partner_kit/) | Pre-built packs, verification scripts, and README for design partner distribution |
| [evidence_viewer](./evidence_viewer/) | Viewer app docs and packaging (GC view, insurer summary, claims package) |
| [constitution](./constitution/) | Constitution text, hash, and nonstandard / override docs |
| [release](./release/) | Release ritual, conformance fixtures, and trust signals |

Each subfolder has its own README describing what will go there.
