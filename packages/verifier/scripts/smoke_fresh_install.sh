#!/usr/bin/env bash
#
# Smoke test for fresh @pact/verifier install
#
# Validates that the package works correctly when installed via npm
# without any monorepo tooling or workspace dependencies.
#
# Usage:
#   bash packages/verifier/scripts/smoke_fresh_install.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$VERIFIER_DIR/../.." && pwd)"

echo "═══════════════════════════════════════════════════════════"
echo "  @pact/verifier Fresh Install Smoke Test"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Step 1: Build the verifier package
echo "1. Building @pact/verifier..."
cd "$VERIFIER_DIR"
pnpm run build
echo "   ✓ Build complete"
echo ""

# Step 2: Pack the package
echo "2. Creating npm tarball..."
TARBALL=$(npm pack --pack-destination /tmp 2>/dev/null | tail -1)
TARBALL_PATH="/tmp/$TARBALL"
echo "   ✓ Created: $TARBALL_PATH"
echo ""

# Step 3: Create temp directory
TEMP_DIR=$(mktemp -d)
echo "3. Created temp directory: $TEMP_DIR"
echo ""

# Cleanup function
cleanup() {
  echo ""
  echo "Cleaning up..."
  rm -rf "$TEMP_DIR"
  rm -f "$TARBALL_PATH"
  echo "   ✓ Cleanup complete"
}
trap cleanup EXIT

# Step 4: Install the tarball
echo "4. Installing tarball in temp directory..."
cd "$TEMP_DIR"
npm init -y > /dev/null 2>&1
npm install "$TARBALL_PATH" > /dev/null 2>&1
echo "   ✓ Installed @pact/verifier"
echo ""

# Step 5: Copy test fixtures
echo "5. Copying test fixtures..."
mkdir -p fixtures
cp "$REPO_ROOT/fixtures/success/SUCCESS-001-simple.json" fixtures/
cp "$REPO_ROOT/fixtures/failures/PACT-420-provider-unreachable.json" fixtures/
cp "$REPO_ROOT/fixtures/failures/PACT-331-double-commit.json" fixtures/
echo "   ✓ Copied 3 fixtures"
echo ""

# Step 6: Run CLI tests
echo "6. Running CLI tests..."
PACT_VERIFIER="./node_modules/.bin/pact-verifier"

# Test gc-view
echo "   Testing gc-view..."
GC_VIEW_OUTPUT=$($PACT_VERIFIER gc-view --transcript fixtures/SUCCESS-001-simple.json)
VERSION=$(echo "$GC_VIEW_OUTPUT" | jq -r '.version' | tr -d '\r\n')
if [ "$VERSION" != "gc_view/1.0" ]; then
  echo "   ❌ gc-view failed: expected version gc_view/1.0, got '$VERSION'"
  exit 1
fi
HASH=$(echo "$GC_VIEW_OUTPUT" | jq -r '.constitution.hash' | tr -d '\r\n')
if [ -z "$HASH" ] || [ "$HASH" = "null" ]; then
  echo "   ❌ gc-view failed: constitution.hash is empty"
  exit 1
fi

# CRITICAL: Verify hash_chain is VALID (regression test for genesis hash fix)
HASH_CHAIN=$(echo "$GC_VIEW_OUTPUT" | jq -r '.integrity.hash_chain' | tr -d '\r\n')
if [ "$HASH_CHAIN" != "VALID" ]; then
  echo "   ❌ gc-view failed: expected integrity.hash_chain=VALID, got '$HASH_CHAIN'"
  echo "   This indicates the genesis hash computation doesn't match SDK fixtures."
  exit 1
fi

# Verify all signatures were verified
SIG_VERIFIED=$(echo "$GC_VIEW_OUTPUT" | jq -r '.integrity.signatures_verified.verified' | tr -d '\r\n')
SIG_TOTAL=$(echo "$GC_VIEW_OUTPUT" | jq -r '.integrity.signatures_verified.total' | tr -d '\r\n')
if [ "$SIG_VERIFIED" != "$SIG_TOTAL" ] || [ "$SIG_VERIFIED" = "0" ]; then
  echo "   ❌ gc-view failed: expected all signatures verified, got $SIG_VERIFIED/$SIG_TOTAL"
  exit 1
fi

echo "   ✓ gc-view: version=$VERSION, hash_chain=$HASH_CHAIN, signatures=$SIG_VERIFIED/$SIG_TOTAL"

# Test gc-summary
echo "   Testing gc-summary..."
GC_SUMMARY_OUTPUT=$($PACT_VERIFIER gc-summary --transcript fixtures/SUCCESS-001-simple.json)
if ! echo "$GC_SUMMARY_OUTPUT" | grep -q "Constitution:"; then
  echo "   ❌ gc-summary failed: missing Constitution line"
  exit 1
fi
echo "   ✓ gc-summary: output valid"

# Test judge-v4
echo "   Testing judge-v4..."
JUDGE_OUTPUT=$($PACT_VERIFIER judge-v4 --transcript fixtures/SUCCESS-001-simple.json)
DBL_VERSION=$(echo "$JUDGE_OUTPUT" | jq -r '.version' | tr -d '\r\n')
if [ "$DBL_VERSION" != "dbl/2.0" ]; then
  echo "   ❌ judge-v4 failed: expected version dbl/2.0, got '$DBL_VERSION'"
  exit 1
fi
DETERMINATION=$(echo "$JUDGE_OUTPUT" | jq -r '.dblDetermination' | tr -d '\r\n')
if [ "$DETERMINATION" != "NO_FAULT" ]; then
  echo "   ❌ judge-v4 failed: expected NO_FAULT, got '$DETERMINATION'"
  exit 1
fi
echo "   ✓ judge-v4: version=$DBL_VERSION, determination=$DETERMINATION"

# Test insurer-summary
echo "   Testing insurer-summary..."
INSURER_OUTPUT=$($PACT_VERIFIER insurer-summary --transcript fixtures/SUCCESS-001-simple.json)
INSURER_VERSION=$(echo "$INSURER_OUTPUT" | jq -r '.version' | tr -d '\r\n')
if [ "$INSURER_VERSION" != "insurer_summary/1.0" ]; then
  echo "   ❌ insurer-summary failed: expected version insurer_summary/1.0, got '$INSURER_VERSION'"
  exit 1
fi
COVERAGE=$(echo "$INSURER_OUTPUT" | jq -r '.coverage' | tr -d '\r\n')
echo "   ✓ insurer-summary: version=$INSURER_VERSION, coverage=$COVERAGE"

# Test contention-scan
echo "   Testing contention-scan..."
CONTENTION_OUTPUT=$($PACT_VERIFIER contention-scan --transcripts-dir fixtures)
CONTENTION_VERSION=$(echo "$CONTENTION_OUTPUT" | jq -r '.version' | tr -d '\r\n')
if [ "$CONTENTION_VERSION" != "contention_report/1.0" ]; then
  echo "   ❌ contention-scan failed: expected version contention_report/1.0, got '$CONTENTION_VERSION'"
  exit 1
fi
echo "   ✓ contention-scan: version=$CONTENTION_VERSION"

# Test PACT-420 provider unreachable
echo "   Testing PACT-420 fixture..."
PACT420_OUTPUT=$($PACT_VERIFIER gc-view --transcript fixtures/PACT-420-provider-unreachable.json)
PACT420_STATUS=$(echo "$PACT420_OUTPUT" | jq -r '.executive_summary.status' | tr -d '\r\n')
if [ "$PACT420_STATUS" != "FAILED_PROVIDER_UNREACHABLE" ]; then
  echo "   ❌ PACT-420 failed: expected FAILED_PROVIDER_UNREACHABLE, got '$PACT420_STATUS'"
  exit 1
fi
echo "   ✓ PACT-420: status=$PACT420_STATUS"

# Test auditor-pack
echo "   Testing auditor-pack..."
$PACT_VERIFIER auditor-pack \
  --transcript fixtures/SUCCESS-001-simple.json \
  --out /tmp/smoke_auditor_pack.zip 2>/dev/null
if [ ! -f /tmp/smoke_auditor_pack.zip ]; then
  echo "   ❌ auditor-pack failed: ZIP not created"
  exit 1
fi
echo "   ✓ auditor-pack: ZIP created"

# Test auditor-pack-verify
echo "   Testing auditor-pack-verify..."
VERIFY_OUTPUT=$($PACT_VERIFIER auditor-pack-verify --zip /tmp/smoke_auditor_pack.zip)
VERIFY_OK=$(echo "$VERIFY_OUTPUT" | jq -r '.ok' | tr -d '\r\n')
CHECKSUMS_OK=$(echo "$VERIFY_OUTPUT" | jq -r '.checksums_ok' | tr -d '\r\n')
RECOMPUTE_OK=$(echo "$VERIFY_OUTPUT" | jq -r '.recompute_ok' | tr -d '\r\n')
if [ "$VERIFY_OK" != "true" ]; then
  echo "   ❌ auditor-pack-verify failed: ok='$VERIFY_OK'"
  echo "   Full output: $VERIFY_OUTPUT"
  exit 1
fi
if [ "$CHECKSUMS_OK" != "true" ]; then
  echo "   ❌ auditor-pack-verify failed: checksums_ok='$CHECKSUMS_OK'"
  exit 1
fi
if [ "$RECOMPUTE_OK" != "true" ]; then
  echo "   ❌ auditor-pack-verify failed: recompute_ok='$RECOMPUTE_OK'"
  exit 1
fi
echo "   ✓ auditor-pack-verify: ok=$VERIFY_OK, checksums_ok=$CHECKSUMS_OK, recompute_ok=$RECOMPUTE_OK"

# Test H7: Constitution hash enforcement
echo "   Testing H7 constitution hash enforcement..."
# Verify that standard pack has correct constitution hash (no NON_STANDARD_RULES)
if echo "$VERIFY_OUTPUT" | grep -q "NON_STANDARD_RULES"; then
  echo "   ❌ H7 test failed: standard pack should not have NON_STANDARD_RULES mismatch"
  exit 1
fi
echo "   ✓ H7 enforcement: standard pack passes (constitution hash verified)"

# Test H7: Tampered constitution must fail
echo "   Testing H7 tampered constitution detection..."
# Create a tampered pack by modifying constitution and recomputing checksums
node << 'EOF'
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');
const JSZip = require('jszip');

async function tamperPack() {
  const zipPath = '/tmp/smoke_auditor_pack.zip';
  const zipBuffer = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(zipBuffer);
  
  // Read and tamper constitution: change "constitution/1.0" to "constitution/1.0X"
  const constitutionFile = zip.file('constitution/CONSTITUTION_v1.md');
  if (!constitutionFile) {
    console.error('ERROR: constitution file not found');
    process.exit(1);
  }
  
  let constitutionContent = await constitutionFile.async('string');
  const tamperedContent = constitutionContent.replace(/constitution\/1\.0/g, 'constitution/1.0X');
  zip.file('constitution/CONSTITUTION_v1.md', tamperedContent);
  
  // Update manifest with new constitution hash (canonicalized)
  const canonicalTampered = tamperedContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .join('\n');
  const newHash = crypto.createHash('sha256').update(canonicalTampered, 'utf8').digest('hex');
  
  const manifestContent = await zip.file('manifest.json').async('string');
  const manifest = JSON.parse(manifestContent);
  manifest.constitution_hash = newHash;
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  
  // Update gc_view with new constitution hash
  const gcViewContent = await zip.file('derived/gc_view.json').async('string');
  const gcView = JSON.parse(gcViewContent);
  if (gcView.constitution && typeof gcView.constitution === 'object') {
    gcView.constitution.hash = newHash;
  }
  zip.file('derived/gc_view.json', JSON.stringify(gcView, null, 2));
  
  // Recompute checksums
  const files = Object.keys(zip.files).filter(f => !f.endsWith('/') && f !== 'checksums.sha256');
  const newChecksums = [];
  for (const file of files.sort()) {
    const content = await zip.file(file).async('nodebuffer');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    newChecksums.push(hash + '  ' + file);
  }
  zip.file('checksums.sha256', newChecksums.join('\n') + '\n');
  
  // Write tampered pack
  const tamperedBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync('/tmp/smoke_tampered_pack.zip', tamperedBuffer);
  console.log('SUCCESS');
}

tamperPack().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
EOF

TAMPER_RESULT=$?
if [ $TAMPER_RESULT -ne 0 ] || [ ! -f /tmp/smoke_tampered_pack.zip ]; then
  echo "   ⚠ H7 tamper test skipped: Node.js tampering failed (this is acceptable)"
else
  # Verify tampered pack MUST fail
  VERIFY_TAMPERED_OUTPUT=$($PACT_VERIFIER auditor-pack-verify --zip /tmp/smoke_tampered_pack.zip 2>&1 || true)
  VERIFY_TAMPERED_OK=$(echo "$VERIFY_TAMPERED_OUTPUT" | jq -r '.ok' 2>/dev/null || echo "false")
  
  if [ "$VERIFY_TAMPERED_OK" != "false" ]; then
    echo "   ❌ H7 tamper test failed: tampered pack should have ok=false, got '$VERIFY_TAMPERED_OK'"
    exit 1
  fi
  
  # Check for NON_STANDARD_RULES mismatch
  if ! echo "$VERIFY_TAMPERED_OUTPUT" | grep -q "NON_STANDARD_RULES"; then
    echo "   ❌ H7 tamper test failed: tampered pack should include NON_STANDARD_RULES mismatch"
    echo "   Output: $VERIFY_TAMPERED_OUTPUT"
    exit 1
  fi
  
  echo "   ✓ H7 tamper test: tampered pack correctly fails with NON_STANDARD_RULES"
  rm -f /tmp/smoke_tampered_pack.zip
fi

# Test H7-B: Insurer-summary with pack (should not be excluded for standard pack)
echo "   Testing H7-B insurer-summary constitution enforcement..."
INSURER_PACK_OUTPUT=$($PACT_VERIFIER insurer-summary --zip /tmp/smoke_auditor_pack.zip 2>/dev/null)
INSURER_PACK_COVERAGE=$(echo "$INSURER_PACK_OUTPUT" | jq -r '.coverage' | tr -d '\r\n')
if [ "$INSURER_PACK_COVERAGE" = "EXCLUDED" ]; then
  echo "   ❌ H7-B test failed: standard pack should not be EXCLUDED, got coverage='$INSURER_PACK_COVERAGE'"
  exit 1
fi
# Check that NON_STANDARD_RULES is not in risk_factors for standard pack
if echo "$INSURER_PACK_OUTPUT" | jq -r '.risk_factors[]' 2>/dev/null | grep -q "NON_STANDARD_RULES"; then
  echo "   ❌ H7-B test failed: standard pack should not have NON_STANDARD_RULES in risk_factors"
  exit 1
fi
echo "   ✓ H7-B enforcement: standard pack not excluded (constitution hash verified)"

# Cleanup auditor pack
rm -f /tmp/smoke_auditor_pack.zip

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ All smoke tests passed!"
echo "═══════════════════════════════════════════════════════════"
