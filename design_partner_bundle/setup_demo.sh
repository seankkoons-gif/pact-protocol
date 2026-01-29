#!/bin/bash
# Setup script to copy H5 Golden Demo to design_partner_bundle
#
# This script:
# 1. Copies demo/h5-golden to design_partner_bundle/demo/h5-golden
# 2. Generates auditor packs for demo scenarios
# 3. Copies generated packs to design_partner_bundle/packs/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_SOURCE="$REPO_ROOT/demo/h5-golden"
DEMO_DEST="$SCRIPT_DIR/demo/h5-golden"
PACKS_DEST="$SCRIPT_DIR/packs"

echo "Setting up H5 Golden Demo in design_partner_bundle..."
echo ""

# Copy demo directory
if [ -d "$DEMO_SOURCE" ]; then
  echo "Copying demo/h5-golden to design_partner_bundle/demo/h5-golden..."
  mkdir -p "$SCRIPT_DIR/demo"
  cp -r "$DEMO_SOURCE" "$DEMO_DEST"
  echo "  ✓ Copied demo structure"
else
  echo "⚠️  Warning: $DEMO_SOURCE not found"
fi

# Generate demo packs if needed
if [ -d "$DEMO_DEST" ]; then
  echo ""
  echo "Generating demo auditor packs..."
  
  # Run success scenario
  if [ -f "$DEMO_DEST/success/run.sh" ]; then
    echo "  Running success scenario..."
    (cd "$DEMO_DEST/success" && bash run.sh > /dev/null 2>&1) || true
    if [ -f "$DEMO_DEST/success/auditor_pack_success.zip" ]; then
      cp "$DEMO_DEST/success/auditor_pack_success.zip" "$PACKS_DEST/" 2>/dev/null || true
      echo "    ✓ Generated auditor_pack_success.zip"
    fi
  fi
  
  # Run policy_abort scenario
  if [ -f "$DEMO_DEST/policy_abort/run.sh" ]; then
    echo "  Running policy_abort scenario..."
    (cd "$DEMO_DEST/policy_abort" && bash run.sh > /dev/null 2>&1) || true
    if [ -f "$DEMO_DEST/policy_abort/auditor_pack_101.zip" ]; then
      cp "$DEMO_DEST/policy_abort/auditor_pack_101.zip" "$PACKS_DEST/" 2>/dev/null || true
      echo "    ✓ Generated auditor_pack_101.zip"
    fi
  fi
  
  # Run tier3 scenario (tier T3 + SLA "daily digest")
  if [ -f "$DEMO_DEST/tier3/run.sh" ]; then
    echo "  Running tier3 scenario..."
    (cd "$DEMO_DEST/tier3" && bash run.sh > /dev/null 2>&1) || true
    if [ -f "$DEMO_DEST/tier3/auditor_pack_tier3.zip" ]; then
      cp "$DEMO_DEST/tier3/auditor_pack_tier3.zip" "$PACKS_DEST/" 2>/dev/null || true
      echo "    ✓ Generated auditor_pack_tier3.zip"
    fi
  fi

  # Note: tamper scenario pack should fail verification (expected behavior)
  echo ""
  echo "✓ Demo setup complete"
  echo ""
  echo "Note: Run 'bash verify_all.sh' to verify all packs including demo packs"
else
  echo "⚠️  Warning: Demo directory not found at $DEMO_DEST"
fi
