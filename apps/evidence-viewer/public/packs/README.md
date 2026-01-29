# Demo Packs

This directory contains pre-generated auditor packs for the Evidence Viewer demo mode.

## Files

- `success.zip` - Success scenario (COMPLETED, NO_FAULT)
- `policy_abort.zip` - Policy abort scenario (ABORTED_POLICY, BUYER_AT_FAULT)
- `tamper.zip` - Tamper detection scenario (FAILED_INTEGRITY)

## Source

These packs are copied from:
- `design_partner_bundle/packs/auditor_pack_success.zip` → `success.zip`
- `design_partner_bundle/packs/auditor_pack_101.zip` → `policy_abort.zip`
- `demo/h5-golden/tamper/auditor_pack_semantic_tampered.zip` → `tamper.zip`

## Regenerating

To update these packs, run the demo scripts and copy the generated files:

```bash
# Run demos to generate packs
bash demo/h5-golden/run_all.sh

# Copy to public folder
cp design_partner_bundle/packs/auditor_pack_success.zip apps/evidence-viewer/public/packs/success.zip
cp design_partner_bundle/packs/auditor_pack_101.zip apps/evidence-viewer/public/packs/policy_abort.zip
cp demo/h5-golden/tamper/auditor_pack_semantic_tampered.zip apps/evidence-viewer/public/packs/tamper.zip
```
