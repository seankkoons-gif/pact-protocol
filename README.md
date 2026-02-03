# Pact Protocol

Pact is an evidence and verification standard for agent transactions.

It defines how negotiation and settlement outcomes are recorded, sealed, and judged so that disputes can be resolved from evidence alone, without trusting any agent, provider, or runtime.

This repository contains the protocol distribution: schemas, verifier CLI, deterministic recomputation, auditor packs, and constitution enforcement.

If an agent can spend money, make commitments, or trigger settlement, Pact defines how that action becomes provable.

## What this repo is

An offline, deterministic verification system.

Use this repo to:

- Verify Pact transcripts
- Attribute responsibility (DBL)
- Produce GC / insurer-grade summaries
- Detect tampering—even with recomputed checksums
- Recompute reputation / credit from raw transcripts

No agents run here. No payments happen here.

## In scope

- **Verifier (CLI)** — Transcript verification, DBL blame resolution, GC view, insurer summary
- **Passport recompute** — Deterministic credit / reputation state from transcripts
- **Auditor packs** — Sealed evidence bundles (success, failure, tier demos)
- **Constitution enforcement** — Rules of evidence and responsibility attribution

## Explicitly out of scope

- **Runtime SDK / agent execution** → see pact-examples
- **Payment rails, escrow, marketplaces** → not implemented here

## Mental model

Pact splits agent systems into two layers:

- **Runtime (SDK):** agents negotiate, settle, and emit signed transcripts
- **Protocol (Verifier):** an offline system verifies those transcripts, attributes blame, and produces audit-grade evidence

Agents create evidence. Pact judges it.

## 60-second mental model

```
Agent runtime (SDK)        Pact Protocol (this repo)
------------------        --------------------------
negotiate()      ──▶      transcript.json
settle()         ──▶      signed rounds
dispute()        ──▶      evidence bundle (.zip)
                              │
                              ▼
                        verifier (offline)
                              │
                              ▼
                 GC view · Insurer summary · DBL judgment
```

**Runtime creates evidence. Pact verifies it.**

That separation is the entire point.

## Quickstart (verification only)

```bash
pnpm install --frozen-lockfile
pnpm release:gate
bash demo/h5-golden/run_all.sh
bash design_partner_bundle/verify_all.sh
```

The release gate:

- Builds and tests verifier + passport
- Runs secret scan and pack check
- Skips SDK/examples by design
- Verifies evidence only

### Verified command set (version-pinned)

Use this exact sequence from repo root for a reproducible run:

```bash
pnpm install
pnpm -C packages/verifier build

./design_partner_bundle/verify_all.sh

node packages/verifier/dist/bin/pact-verifier.js auditor-pack-verify --zip design_partner_bundle/packs/auditor_pack_101.zip
node packages/verifier/dist/bin/pact-verifier.js auditor-pack-verify --zip design_partner_bundle/packs/auditor_pack_420.zip
node packages/verifier/dist/bin/pact-verifier.js auditor-pack-verify --zip design_partner_bundle/demo/h5-golden/tamper/auditor_pack_semantic_tampered.zip

pnpm --filter @pact/evidence-viewer build
pnpm --filter @pact/evidence-viewer dev
```

Then open the URL Vite prints (e.g. http://localhost:5173) for the Evidence Viewer.

**Run viewer dev from the same repo root** where you built/verified—not from a different clone. Avoids port conflicts and wrong-repo confusion. See [docs/WORKFLOW_CONVENTIONS.md](docs/WORKFLOW_CONVENTIONS.md).

For agent integration, SDK usage, and example workflows, see **pact-examples**.
