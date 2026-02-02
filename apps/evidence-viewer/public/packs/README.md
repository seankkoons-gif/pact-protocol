# Demo Packs (fixtures)

**These are fixtures for the Evidence Viewer demo.** The `.zip` files in this directory are **not committed** to the repo. The canonical source is `design_partner_bundle/packs/` (and `design_partner_bundle/demo/h5-golden/tamper/` for semantic warning pack).

- **Load Demo Pack** dropdown: fetches `/packs/<filename>`. To enable it, copy packs here (see below).
- **Drag-drop or design_partner_bundle**: you can always load packs from `design_partner_bundle/packs/` by opening that folder and dragging a `.zip` into the viewer.

## Canonical source

| Demo option       | Filename                          | Source |
|-------------------|-----------------------------------|--------|
| Success           | `auditor_pack_success.zip`        | `design_partner_bundle/packs/` |
| Policy Abort 101  | `auditor_pack_101.zip`            | `design_partner_bundle/packs/` |
| Timeout 420       | `auditor_pack_420.zip`            | `design_partner_bundle/packs/` |
| Tamper (derived output altered) | `auditor_pack_semantic_tampered.zip`  | `design_partner_bundle/demo/h5-golden/tamper/` |

## Enabling the demo dropdown (optional)

From repo root, copy fixtures so the in-app **Load Demo Pack** dropdown works:

```bash
cp design_partner_bundle/packs/auditor_pack_success.zip apps/evidence-viewer/public/packs/
cp design_partner_bundle/packs/auditor_pack_101.zip apps/evidence-viewer/public/packs/
cp design_partner_bundle/packs/auditor_pack_420.zip apps/evidence-viewer/public/packs/
cp design_partner_bundle/demo/h5-golden/tamper/auditor_pack_semantic_tampered.zip apps/evidence-viewer/public/packs/
```

The dropdown shows **Tamper (derived output altered)**; the file is `auditor_pack_semantic_tampered.zip`.

Optional legacy filenames in `public/packs/`: `success.zip`, `policy_abort.zip`, `tamper.zip` — same scenarios if present; the dropdown uses the canonical filenames above.

## One-command verification (integrity path)

After copying the packs above, you can verify the new integrity path in two ways.

**A) In the viewer (manual)**  
1. Load **Success** (`auditor_pack_success.zip`). Confirm: **Banner:** Integrity: VALID · **Integrity panel:** Hash chain: VALID, Signatures: 2/2 verified (or actual count), Checksums: VALID (or UNAVAILABLE).  
2. Load **Tamper (derived output altered)** (`auditor_pack_semantic_tampered.zip`). Confirm: warnings shown; Integrity VALID or INDETERMINATE (no cryptographic tamper detected).

**B) One command (tests)**  
From repo root, with packs in `apps/evidence-viewer/public/packs/`:

```bash
pnpm --filter @pact/evidence-viewer test -- src/lib/__tests__/loadPack.integrity.test.ts
```

Tests are skipped if the pack files are missing.
