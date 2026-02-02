#!/usr/bin/env bash
#
# Regenerate derived/gc_view.json inside auditor pack ZIP(s) using the current
# verifier renderer. Updates only derived/gc_view.json and checksums.sha256.
# Use when the renderer/canonicalizer changed and packs fail with
# "derived/gc_view.json mismatch after canonicalization".
#
# Usage (from repo root):
#   ./scripts/regenerate-pack-gc-view.sh design_partner_bundle/packs/auditor_pack_101.zip design_partner_bundle/packs/auditor_pack_420.zip
#
# Requires: unzip, zip, node, and pact-verifier (run pnpm verifier:build first).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v unzip &>/dev/null || ! command -v zip &>/dev/null; then
  echo "Error: unzip and zip are required." >&2
  exit 1
fi

VERIFIER_DIST="$REPO_ROOT/packages/verifier/dist/cli/gc_view.js"
if [[ ! -f "$VERIFIER_DIST" ]]; then
  echo "Error: Verifier not built. Run: pnpm verifier:build" >&2
  exit 1
fi

for ZIP_PATH in "$@"; do
  if [[ ! -f "$ZIP_PATH" ]]; then
    echo "Error: Not a file: $ZIP_PATH" >&2
    exit 1
  fi
  ZIP_ABS="$(cd "$(dirname "$ZIP_PATH")" && pwd)/$(basename "$ZIP_PATH")"
  TMPDIR="$(mktemp -d)"
  trap "rm -rf '$TMPDIR'" EXIT

  echo "Regenerating gc_view in: $ZIP_PATH"
  unzip -q -o "$ZIP_ABS" -d "$TMPDIR"

  if [[ ! -f "$TMPDIR/input/transcript.json" ]]; then
    echo "Error: Pack missing input/transcript.json: $ZIP_PATH" >&2
    exit 1
  fi

  node "$VERIFIER_DIST" --transcript "$TMPDIR/input/transcript.json" --out "$TMPDIR/derived/gc_view.json" 2>/dev/null || {
    echo "Error: gc-view failed for $ZIP_PATH" >&2
    exit 1
  }

  NEW_HASH="$(node -e "
    const fs = require('fs');
    const c = require('crypto');
    const p = process.argv[1];
    console.log(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
  " "$TMPDIR/derived/gc_view.json")"

  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    const newHash = process.argv[2];
    let content = fs.readFileSync(p, 'utf8');
    content = content.replace(/^[a-f0-9]{64}\s+derived\/gc_view\.json\s*$/m, newHash + '  derived/gc_view.json');
    fs.writeFileSync(p, content);
  " "$TMPDIR/checksums.sha256" "$NEW_HASH"

  (cd "$TMPDIR" && zip -r -q - .) > "${ZIP_ABS}.new"
  mv "${ZIP_ABS}.new" "$ZIP_ABS"
  echo "  Updated: $ZIP_PATH"
done

echo "Done."
