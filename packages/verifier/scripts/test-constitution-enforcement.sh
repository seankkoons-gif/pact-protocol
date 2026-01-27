#!/bin/bash
# Manual test script for constitution hash enforcement
#
# This script:
# 1. Creates a valid auditor pack
# 2. Tamper with the constitution (add one character)
# 3. Updates hashes in manifest and gc_view
# 4. Verifies that auditor-pack-verify fails
# 5. Verifies that --allow-nonstandard allows it (but recompute still fails)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FIXTURE="$REPO_ROOT/fixtures/success/SUCCESS-001-simple.json"
TEMP_DIR=$(mktemp -d)
PACK="$TEMP_DIR/test_pack.zip"
TAMPERED_PACK="$TEMP_DIR/tampered_pack.zip"

echo "Testing Constitution Hash Enforcement"
echo "====================================="
echo ""

# Step 1: Create a valid pack
echo "Step 1: Creating valid auditor pack..."
cd "$REPO_ROOT"
node packages/verifier/dist/cli/auditor_pack.js \
    --transcript "$FIXTURE" \
    --out "$PACK" > /dev/null 2>&1

if [ ! -f "$PACK" ]; then
    echo "ERROR: Failed to create pack"
    exit 1
fi
echo "  ✓ Pack created"
echo ""

# Step 2: Extract and tamper
echo "Step 2: Tampering with constitution..."
cd "$TEMP_DIR"
unzip -q "$PACK" -d pack_contents

# Tamper: add space at start of constitution
CONSTITUTION_FILE="pack_contents/constitution/CONSTITUTION_v1.md"
ORIGINAL=$(cat "$CONSTITUTION_FILE")
echo " $ORIGINAL" > "$CONSTITUTION_FILE"

# Compute new hash
NEW_HASH=$(cd pack_contents && shasum -a 256 constitution/CONSTITUTION_v1.md | cut -d' ' -f1)

echo "  Original hash: $(cat pack_contents/manifest.json | grep -o '"constitution_hash":"[^"]*' | cut -d'"' -f4 | head -c 16)..."
echo "  New hash: ${NEW_HASH:0:16}..."
echo ""

# Step 3: Update manifest and gc_view
echo "Step 3: Updating manifest and gc_view with new hash..."
node -e "
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('pack_contents/manifest.json', 'utf8'));
manifest.constitution_hash = '$NEW_HASH';
fs.writeFileSync('pack_contents/manifest.json', JSON.stringify(manifest, null, 2));

const gcView = JSON.parse(fs.readFileSync('pack_contents/derived/gc_view.json', 'utf8'));
gcView.constitution.hash = '$NEW_HASH';
fs.writeFileSync('pack_contents/derived/gc_view.json', JSON.stringify(gcView, null, 2));
"
echo "  ✓ Updated hashes"
echo ""

# Step 4: Regenerate checksums and repackage
echo "Step 4: Regenerating checksums and repackaging..."
cd pack_contents
rm -f checksums.sha256
find . -type f ! -name "checksums.sha256" | sort | while read file; do
    hash=$(shasum -a 256 "$file" | cut -d' ' -f1)
    relpath=$(echo "$file" | sed 's|^\./||')
    echo "$hash  $relpath" >> checksums.sha256
done
cd ..
zip -rq "$TAMPERED_PACK" pack_contents/*
echo "  ✓ Repackaged"
echo ""

# Step 5: Test verification (should fail)
echo "Step 5: Testing verification (should fail)..."
cd "$REPO_ROOT"
VERIFY_OUTPUT=$(node packages/verifier/dist/cli/auditor_pack_verify.js --zip "$TAMPERED_PACK" 2>&1 || true)
VERIFY_EXIT=$?

if [ $VERIFY_EXIT -eq 1 ]; then
    echo "  ✓ Verification correctly failed (exit code: $VERIFY_EXIT)"
    if echo "$VERIFY_OUTPUT" | grep -q "Non-standard constitution hash"; then
        echo "  ✓ Error message mentions non-standard constitution hash"
    else
        echo "  ⚠️  Warning: Error message doesn't mention non-standard constitution hash"
        echo "     Output: $VERIFY_OUTPUT"
    fi
else
    echo "  ✗ ERROR: Verification should have failed but didn't (exit code: $VERIFY_EXIT)"
    exit 1
fi
echo ""

# Step 6: Test with --allow-nonstandard (should not fail on constitution check)
echo "Step 6: Testing with --allow-nonstandard flag..."
VERIFY_OUTPUT2=$(node packages/verifier/dist/cli/auditor_pack_verify.js --zip "$TAMPERED_PACK" --allow-nonstandard 2>&1 || true)
VERIFY_EXIT2=$?

if [ $VERIFY_EXIT2 -eq 1 ]; then
    echo "  ✓ Verification still fails (exit code: $VERIFY_EXIT2) - expected due to recompute mismatch"
    if echo "$VERIFY_OUTPUT2" | grep -q "Non-standard constitution hash"; then
        echo "  ✗ ERROR: Should not fail on constitution hash with --allow-nonstandard"
        exit 1
    else
        echo "  ✓ Constitution hash check bypassed (fails on recompute instead)"
    fi
else
    echo "  ⚠️  Verification passed (unexpected - recompute should have failed)"
fi
echo ""

# Cleanup
rm -rf "$TEMP_DIR"

echo "====================================="
echo "✓ All tests passed!"
echo ""
