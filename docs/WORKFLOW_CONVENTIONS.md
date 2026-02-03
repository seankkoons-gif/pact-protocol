# Workflow Conventions

Conventions to avoid confusion and ensure reproducible runs.

## 1. Never use global `pact-verifier` in docs

**Do not use:** `pact-verifier auditor-pack-verify --zip ...`

**Always use:** `node packages/verifier/dist/bin/pact-verifier.js ...`

Example:

```bash
node packages/verifier/dist/bin/pact-verifier.js auditor-pack-verify --zip design_partner_bundle/packs/auditor_pack_101.zip
```

**Why:** The global `pact-verifier` may point to a different version (npm-installed, another clone). Running via `node packages/verifier/dist/bin/pact-verifier.js` guarantees you use the verifier from this repo, built from the same source you verified against.

## 2. Run Evidence Viewer dev from the same repo you built/verified

When running `pnpm evidence-viewer:dev` or `pnpm --filter @pact/evidence-viewer dev`:

- **Run from the same repo root** where you ran `pnpm -C packages/verifier build` and `./design_partner_bundle/verify_all.sh`
- **Do not** run viewer dev from a different clone or directory

**Why:** Running from a different path can cause:
- Port conflicts (two Vite dev servers)
- Wrong-repo confusion (viewer serving packs from a different checkout)
- Stale or mismatched verifier output

**Correct workflow:**

```bash
cd /path/to/pact   # your single repo
pnpm install
pnpm -C packages/verifier build
./design_partner_bundle/verify_all.sh
pnpm evidence-viewer:dev
```
