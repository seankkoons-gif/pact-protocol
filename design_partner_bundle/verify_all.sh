#!/usr/bin/env bash
#
# Design Partner Bundle - Verification Script
#
# Verifies all auditor packs in this bundle using the pact-verifier CLI.
# Self-contained: installs the verifier from included tarball if not available.
#
# Usage:
#   bash verify_all.sh
#
# Exit codes:
#   0 - All packs verified successfully
#   1 - One or more packs failed verification
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKS_DIR="$SCRIPT_DIR/packs"
VERIFIER_TGZ="$SCRIPT_DIR/verifier/pact-verifier-0.2.0.tgz"

echo "═══════════════════════════════════════════════════════════"
echo "  Pact Design Partner Bundle - Verification"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check for jq
if ! command -v jq &> /dev/null; then
  echo "❌ Error: jq is required but not installed."
  echo "   Install with: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi

# Prefer repo-built verifier when available (ensures tier/Merkle support matches packs)
REPO_VERIFIER="$SCRIPT_DIR/../bin/pact-verifier.mjs"
if [ -f "$REPO_VERIFIER" ]; then
  PACT_VERIFIER="node $REPO_VERIFIER"
  echo "Using repo verifier: $REPO_VERIFIER"
elif command -v pact-verifier &> /dev/null; then
  PACT_VERIFIER="pact-verifier"
  echo "Using installed pact-verifier: $(which pact-verifier)"
elif [ -f "$VERIFIER_TGZ" ]; then
  echo "Installing pact-verifier from included tarball..."
  
  # Create temp directory for installation
  TEMP_INSTALL_DIR=$(mktemp -d)
  trap "rm -rf '$TEMP_INSTALL_DIR'" EXIT
  
  cd "$TEMP_INSTALL_DIR"
  npm init -y > /dev/null 2>&1
  npm install "$VERIFIER_TGZ" > /dev/null 2>&1
  
  PACT_VERIFIER="$TEMP_INSTALL_DIR/node_modules/.bin/pact-verifier"
  
  if [ ! -f "$PACT_VERIFIER" ]; then
    echo "❌ Error: Failed to install pact-verifier from tarball"
    exit 1
  fi
  
  echo "   ✓ Installed pact-verifier from tarball"
  cd "$SCRIPT_DIR"
else
  echo "❌ Error: pact-verifier not found and tarball not available."
  echo "   Install with: npm install -g @pact/verifier"
  echo "   Or ensure $VERIFIER_TGZ exists"
  exit 1
fi

echo ""
echo "Verifying auditor packs..."
echo ""

FAILED=0
PASSED=0

for ZIP_FILE in "$PACKS_DIR"/*.zip; do
  if [ ! -f "$ZIP_FILE" ]; then
    echo "⚠️  No ZIP files found in $PACKS_DIR"
    exit 1
  fi
  
  PACK_NAME=$(basename "$ZIP_FILE")
  echo "  Verifying: $PACK_NAME"
  
  # Run verification - capture stdout only (JSON), ignore stderr
  # The CLI outputs JSON to stdout and errors/notifications to stderr
  VERIFY_OUTPUT=$(eval "$PACT_VERIFIER auditor-pack-verify --zip \"$ZIP_FILE\"" 2>/dev/null || true)
  
  # Parse results from stdout (JSON only)
  OK=$(echo "$VERIFY_OUTPUT" | jq -r '.ok' 2>/dev/null || echo "false")
  CHECKSUMS_OK=$(echo "$VERIFY_OUTPUT" | jq -r '.checksums_ok' 2>/dev/null || echo "false")
  RECOMPUTE_OK=$(echo "$VERIFY_OUTPUT" | jq -r '.recompute_ok' 2>/dev/null || echo "false")
  
  if [ "$OK" = "true" ] && [ "$CHECKSUMS_OK" = "true" ] && [ "$RECOMPUTE_OK" = "true" ]; then
    echo "    ✓ PASS: ok=$OK, checksums_ok=$CHECKSUMS_OK, recompute_ok=$RECOMPUTE_OK"
    PASSED=$((PASSED + 1))
  else
    echo "    ❌ FAIL: ok=$OK, checksums_ok=$CHECKSUMS_OK, recompute_ok=$RECOMPUTE_OK"
    echo "    JSON output: $VERIFY_OUTPUT"
    FAILED=$((FAILED + 1))
  fi
done

# Verify demo packs
DEMO_DIR="$SCRIPT_DIR/demo/h5-golden"
if [ -d "$DEMO_DIR" ]; then
  echo ""
  echo "Verifying demo packs..."
  echo ""
  
  for SCENARIO_DIR in "$DEMO_DIR"/success "$DEMO_DIR"/policy_abort "$DEMO_DIR"/tamper "$DEMO_DIR"/tier3; do
    if [ ! -d "$SCENARIO_DIR" ]; then
      continue
    fi
    
    SCENARIO_NAME=$(basename "$SCENARIO_DIR")
    
    for ZIP_FILE in "$SCENARIO_DIR"/*.zip; do
      if [ ! -f "$ZIP_FILE" ]; then
        continue
      fi
      
      PACK_NAME=$(basename "$ZIP_FILE")
      echo "  Verifying demo/$SCENARIO_NAME: $PACK_NAME"
      
      # Run verification - capture stdout only (JSON), ignore stderr
      # The CLI outputs JSON to stdout and errors/notifications to stderr
      VERIFY_OUTPUT=$(eval "$PACT_VERIFIER auditor-pack-verify --zip \"$ZIP_FILE\"" 2>/dev/null || true)
      
      # Parse results from stdout (JSON only)
      OK=$(echo "$VERIFY_OUTPUT" | jq -r '.ok' 2>/dev/null || echo "false")
      CHECKSUMS_OK=$(echo "$VERIFY_OUTPUT" | jq -r '.checksums_ok' 2>/dev/null || echo "false")
      RECOMPUTE_OK=$(echo "$VERIFY_OUTPUT" | jq -r '.recompute_ok' 2>/dev/null || echo "false")
      
      # For tamper scenario, ok=false is expected (tamper detected)
      if [ "$SCENARIO_NAME" = "tamper" ]; then
        if [ "$OK" = "false" ] && [ "$RECOMPUTE_OK" = "false" ]; then
          echo "    ✓ PASS (expected): ok=$OK, checksums_ok=$CHECKSUMS_OK, recompute_ok=$RECOMPUTE_OK (tamper correctly detected)"
          PASSED=$((PASSED + 1))
        else
          echo "    ❌ FAIL (unexpected): ok=$OK, checksums_ok=$CHECKSUMS_OK, recompute_ok=$RECOMPUTE_OK (tamper should have been detected)"
          FAILED=$((FAILED + 1))
        fi
      else
        if [ "$OK" = "true" ] && [ "$CHECKSUMS_OK" = "true" ] && [ "$RECOMPUTE_OK" = "true" ]; then
          echo "    ✓ PASS: ok=$OK, checksums_ok=$CHECKSUMS_OK, recompute_ok=$RECOMPUTE_OK"
          PASSED=$((PASSED + 1))
        else
          echo "    ❌ FAIL: ok=$OK, checksums_ok=$CHECKSUMS_OK, recompute_ok=$RECOMPUTE_OK"
          echo "    JSON output: $VERIFY_OUTPUT"
          FAILED=$((FAILED + 1))
        fi
      fi
    done
  done
fi

echo ""
echo "═══════════════════════════════════════════════════════════"

if [ "$FAILED" -eq 0 ]; then
  echo "  ✅ All $PASSED packs verified successfully!"
  echo "═══════════════════════════════════════════════════════════"
  exit 0
else
  echo "  ❌ $FAILED pack(s) failed verification, $PASSED passed"
  echo "═══════════════════════════════════════════════════════════"
  exit 1
fi
