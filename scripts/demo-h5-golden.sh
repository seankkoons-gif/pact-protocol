#!/bin/bash
# =============================================================================
# H5 Golden Demo Runner
# =============================================================================
#
# Runs all three H5 Golden Demo scenarios and prints a summary with paths
# to generated artifacts.
#
# Usage:
#   bash scripts/demo-h5-golden.sh
#   pnpm demo:h5
#
# Exit Codes:
#   0 - All scenarios passed
#   1 - One or more scenarios failed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_DIR="$REPO_ROOT/demo/h5-golden"

# -----------------------------------------------------------------------------
# Header
# -----------------------------------------------------------------------------
echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║                        H5 GOLDEN DEMO                                    ║"
echo "║                   Pact Protocol Verification Suite                       ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# Check prerequisites
# -----------------------------------------------------------------------------
VERIFIER="$REPO_ROOT/bin/pact-verifier.mjs"
VERIFIER_DIST="$REPO_ROOT/packages/verifier/dist/cli/gc_view.js"

if [ ! -f "$VERIFIER_DIST" ]; then
    echo "Building verifier CLI..." >&2
    (cd "$REPO_ROOT" && pnpm verifier:build) >&2
    echo "" >&2
fi

# -----------------------------------------------------------------------------
# Run all scenarios
# -----------------------------------------------------------------------------
if ! bash "$DEMO_DIR/run_all.sh"; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════════╗"
    echo "║                              FAILED                                      ║"
    echo "╚══════════════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "One or more scenarios did not complete successfully."
    echo ""
    exit 1
fi

# -----------------------------------------------------------------------------
# Success Banner
# -----------------------------------------------------------------------------
echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║                           ALL SCENARIOS PASSED                           ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# Generated Artifacts
# -----------------------------------------------------------------------------
echo "Generated Artifacts:"
echo ""
echo "  Scenario A (Success):"
echo "    └── $DEMO_DIR/success/auditor_pack_success.zip"
echo "    └── $DEMO_DIR/success/CUSTOMER_MESSAGE.txt"
echo "    └── $DEMO_DIR/success/INSURER_MESSAGE.txt"
echo ""
echo "  Scenario B (Policy Abort):"
echo "    └── $DEMO_DIR/policy_abort/auditor_pack_101.zip"
echo "    └── $DEMO_DIR/policy_abort/CUSTOMER_MESSAGE.txt"
echo "    └── $DEMO_DIR/policy_abort/INSURER_MESSAGE.txt"
echo ""
echo "  Scenario C (Tamper Detection):"
echo "    └── $DEMO_DIR/tamper/auditor_pack_semantic_tampered.zip"
echo "    └── $DEMO_DIR/tamper/CUSTOMER_MESSAGE.txt"
echo "    └── $DEMO_DIR/tamper/INSURER_MESSAGE.txt"
echo ""

# -----------------------------------------------------------------------------
# Verification Commands
# -----------------------------------------------------------------------------
echo "Verification Commands:"
echo ""
echo "  # Verify success pack"
echo "  pact-verifier auditor-pack-verify --zip demo/h5-golden/success/auditor_pack_success.zip"
echo ""
echo "  # Verify policy abort pack"
echo "  pact-verifier auditor-pack-verify --zip demo/h5-golden/policy_abort/auditor_pack_101.zip"
echo ""
echo "  # Verify tampered pack (should show ok=false)"
echo "  pact-verifier auditor-pack-verify --zip demo/h5-golden/tamper/auditor_pack_semantic_tampered.zip"
echo ""

exit 0
