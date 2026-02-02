# Pact Evidence Viewer

Read-only evidence viewer for Auditor Packs (ZIP archives).

## Features

- **Upload or drag-and-drop** Auditor Pack ZIP files
- **Parse ZIP files client-side** (no backend required)
- **Display all panels** from the Evidence Viewer specification:
  1. Case Header (with Transcript ID)
  2. Outcome Panel
  3. Integrity Panel
  4. Responsibility Panel
  5. Insurance Panel
  6. Evidence Files Panel
  7. Verify Locally CTA
  8. **Passport Panel** — Buyer/provider tiers and scores from insurer summary; warnings for non-standard constitution, low confidence, or recent failures
- **Copy Transcript ID** — One-click copy to clipboard; truncated display with full ID on hover
- **Export GC View as Legal PDF** — Multi-page, institutional-style PDF for legal and compliance teams (Executive Summary, Responsibility & Outcome, Integrity & Verification, Insurer View)
- **Export Insurer Summary PDF** — Underwriting-grade PDF for insurers and risk teams; NOT INSURABLE / NON-STANDARD RULES banners when applicable
- **Generate Claims Intake Package** — Single ZIP for claims systems: README, verify command, underwriting summary PDF, GC summary PDF, auditor pack, metadata JSON
- **Load demo pack** dropdown (Success / Policy Abort / Timeout / Tamper (derived output altered))
- **Download** raw artifacts from the pack
- **Institutional, document-viewer aesthetic**

## Development

```bash
pnpm install
pnpm -C apps/evidence-viewer dev
```

Open http://localhost:5173 in your browser.

## Demo Packs

Demo packs can be loaded from:
- `public/packs/` (if copied there)
- `design_partner_bundle/packs/` (relative paths)
- `demo/h5-golden/*/` (relative paths)

To make demo packs available, copy them to `public/packs/`:
```bash
mkdir -p apps/evidence-viewer/public/packs
cp design_partner_bundle/packs/auditor_pack_success.zip apps/evidence-viewer/public/packs/
cp design_partner_bundle/packs/auditor_pack_101.zip apps/evidence-viewer/public/packs/
cp demo/h5-golden/tamper/auditor_pack_semantic_warning.zip apps/evidence-viewer/public/packs/
```

## Usage

1. Choose a demo pack from the dropdown or drag-and-drop an Auditor Pack ZIP file
2. The viewer parses and displays all panels, including the Passport Panel when insurer summary is present
3. **Copy Transcript ID** — Click the copy button next to the Transcript ID in the Case Header
4. **Export PDFs** — Use "Export GC View (PDF)" or "Export Insurer Summary (PDF)" for legal/underwriting summaries
5. **Claims Intake Package** — Use "Generate Claims Intake Package" to create a ZIP for claims submission
6. Use "Download" to extract individual files; use "Copy Verify Command" to verify the pack locally

## What NOT to change (viewer-only)

This app is **presentation only**. It reads packs and verifier output as-is and may normalize **display** (e.g. labels, tooltips, verdict summary). UI and PDFs display **"INDETERMINATE"** only—never "INDETERMINATE_TAMPER"—so auditors do not see "tamper" as an accusation. Do **not** change:

- **Verifier output** — Do not change what the pact-verifier CLI or packages produce.
- **Pack structure** — Do not change the auditor pack ZIP layout or required artifacts.
- **DBL semantics** — Do not change Default Blame Logic or judgment semantics; only how they are displayed.
- **Claims intake logic** — Do not change coverage, underwriting, or claims rules; only how they are presented (PDFs, metadata, README).

All changes in this app are **viewer-only**.

## Architecture

- **Vite + React + TypeScript**: Modern frontend stack
- **jszip**: Client-side ZIP parsing (loaded on demand when you upload a pack or download a file)
- **jspdf**: PDF generation (loaded on demand when you export a PDF or generate the claims package)
- **Lazy-loaded heavy libs**: jsPDF and JSZip are loaded only when needed (first export, first pack load, or first file download). This keeps the initial bundle smaller and improves first-load performance.
- **No backend**: Fully client-side, no data leaves your browser
- **Read-only**: No editing, no auth, no data storage

## Acceptance Criteria

✅ Upload `auditor_pack_success.zip`  
✅ See status: COMPLETED  
✅ See integrity: VALID  
✅ See constitution hash displayed  
✅ Load demo pack dropdown and drag-drop work when packs are in public/packs/  
✅ Semantic warning pack shows warnings; real tamper shows TAMPERED  
✅ Download raw artifacts  
✅ Copy verification command  
✅ Copy Transcript ID to clipboard  
✅ Export GC View as Legal PDF  
✅ Export Insurer Summary PDF (with NOT INSURABLE / NON-STANDARD banners when applicable)  
✅ **PDF export sanity:** Both GC and Insurer PDFs show **Integrity (pack verification): VALID** for success/101/420 packs; any mismatch warnings appear under **"Warnings & Exceptions"** (as "Warnings: …"), never as "Integrity Verdict"  
✅ Generate Claims Intake Package (ZIP)  
✅ Passport Panel shows buyer/provider tiers and scores; warnings for non-standard / low confidence / recent failures
