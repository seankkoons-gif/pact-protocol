#!/bin/bash
# H5 Golden Demo - Run All Scenarios
#
# Executes all demonstration scenarios in sequence.
# Exits with non-zero status if any scenario fails.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=============================================="
echo "        H5 Golden Demo - Full Suite          "
echo "=============================================="
echo ""

FAILURES=0

# --- Success Scenario ---
echo ">>> Running: Success Scenario"
echo "----------------------------------------------"
if "$SCRIPT_DIR/success/run.sh"; then
    echo ""
    echo "[PASS] Success scenario completed"
else
    echo ""
    echo "[FAIL] Success scenario failed"
    FAILURES=$((FAILURES + 1))
fi
echo ""

# --- Policy Abort Scenario ---
echo ">>> Running: Policy Abort Scenario"
echo "----------------------------------------------"
if "$SCRIPT_DIR/policy_abort/run.sh"; then
    echo ""
    echo "[PASS] Policy abort scenario completed"
else
    echo ""
    echo "[FAIL] Policy abort scenario failed"
    FAILURES=$((FAILURES + 1))
fi
echo ""

# --- Tamper Detection Scenario ---
echo ">>> Running: Tamper Detection Scenario"
echo "----------------------------------------------"
if "$SCRIPT_DIR/tamper/run.sh"; then
    echo ""
    echo "[PASS] Tamper detection scenario completed"
else
    echo ""
    echo "[FAIL] Tamper detection scenario failed"
    FAILURES=$((FAILURES + 1))
fi
echo ""

# --- Tier T3 + SLA Scenario (optional: RUN_TIER3=1 to enable) ---
if [ "${RUN_TIER3:-0}" = "1" ]; then
    echo ">>> Running: Tier T3 + SLA Scenario"
    echo "----------------------------------------------"
    if "$SCRIPT_DIR/tier3/run.sh"; then
        echo ""
        echo "[PASS] Tier T3 + SLA scenario completed"
    else
        echo ""
        echo "[FAIL] Tier T3 + SLA scenario failed"
        FAILURES=$((FAILURES + 1))
    fi
    echo ""
else
    echo ">>> Skipping: Tier T3 + SLA Scenario (set RUN_TIER3=1 to include)"
    echo ""
fi

# --- Summary ---
echo "=============================================="
echo "                  Summary                     "
echo "=============================================="

if [ $FAILURES -eq 0 ]; then
    echo "All scenarios completed successfully."
    echo ""
    echo "Exit code: 0"
    exit 0
else
    echo "Failures: $FAILURES scenario(s) did not complete as expected."
    echo ""
    echo "Exit code: 1"
    exit 1
fi
