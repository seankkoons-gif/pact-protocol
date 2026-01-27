#!/bin/bash
# =============================================================================
# H5 Golden Demo: Success Scenario (Scenario A - Happy Path)
# =============================================================================
#
# This script demonstrates the complete verification workflow for a successfully
# completed Pact negotiation transcript.
#
# Steps:
#   1. Generate an auditor pack from the transcript
#   2. Verify the auditor pack integrity
#   3. Display GC summary for quick assessment
#
# Exit Codes:
#   0 - All verification steps passed
#   1 - One or more verification steps failed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FIXTURE="$REPO_ROOT/fixtures/success/SUCCESS-001-simple.json"
AUDITOR_PACK="$SCRIPT_DIR/auditor_pack_success.zip"
VERIFIER="$REPO_ROOT/bin/pact-verifier.mjs"

echo "==============================================================================" >&2
echo "  H5 Golden Demo: Success Scenario (Scenario A - Happy Path)" >&2
echo "==============================================================================" >&2
echo "" >&2
echo "Fixture: $FIXTURE" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 1: Generate Auditor Pack
# -----------------------------------------------------------------------------
echo "Step 1: Generating auditor pack..." >&2

"$VERIFIER" auditor-pack \
    --transcript "$FIXTURE" \
    --out "$AUDITOR_PACK"

if [ ! -f "$AUDITOR_PACK" ]; then
    echo "ERROR: Failed to generate auditor pack" >&2
    exit 1
fi

echo "  Generated: $AUDITOR_PACK" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 2: Verify Auditor Pack
# -----------------------------------------------------------------------------
echo "Step 2: Verifying auditor pack integrity..." >&2

VERIFY_OUTPUT=$("$VERIFIER" auditor-pack-verify --zip "$AUDITOR_PACK")
VERIFY_EXIT=$?

# Parse and display verification result
echo "$VERIFY_OUTPUT"

# Check if ok=true in JSON output
OK_VALUE=$(echo "$VERIFY_OUTPUT" | grep -o '"ok": *[a-z]*' | head -1 | grep -o 'true\|false')

if [ "$OK_VALUE" != "true" ]; then
    echo "" >&2
    echo "ERROR: Auditor pack verification failed (ok=$OK_VALUE)" >&2
    exit 1
fi

echo "" >&2
echo "  Verification: ok=true" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 3: Display GC Summary
# -----------------------------------------------------------------------------
echo "Step 3: GC Summary..." >&2
echo "------------------------------------------------------------------------------" >&2

"$VERIFIER" gc-summary --transcript "$FIXTURE"

echo "------------------------------------------------------------------------------" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 4: Generate Customer Message
# -----------------------------------------------------------------------------
echo "Step 4: Generating customer experience files..." >&2

cat > "$SCRIPT_DIR/CUSTOMER_MESSAGE.txt" << 'CUSTOMER_EOF'
TRANSACTION COMPLETED SUCCESSFULLY

Your transaction has been completed successfully. The buyer and provider
reached agreement on terms, and the negotiation concluded normally with
mutual acceptance.

RESPONSIBILITY: No fault was identified. Both parties fulfilled their
obligations under the protocol.

WHAT HAPPENS NEXT: No further action is required. This transaction is
complete and the record is final.

MONEY MOVED: Yes - funds were transferred according to the agreed terms.

HOW TO VERIFY: Run the following command to independently verify this
transaction:

    pact-verifier auditor-pack-verify --zip auditor_pack_success.zip

A successful verification will show "ok": true in the output.
CUSTOMER_EOF

echo "  Generated: CUSTOMER_MESSAGE.txt" >&2

# -----------------------------------------------------------------------------
# Step 5: Generate Insurer Message
# -----------------------------------------------------------------------------
cat > "$SCRIPT_DIR/INSURER_MESSAGE.txt" << 'INSURER_EOF'
UNDERWRITING SUMMARY

Outcome Category: COMPLETED (successful transaction)

Coverage Recommendation: COVERED
  - No surcharges apply
  - Standard coverage terms

Rationale:
  • Transaction completed normally with valid signatures and intact hash chain
  • No fault identified; both parties performed as expected
INSURER_EOF

echo "  Generated: INSURER_MESSAGE.txt" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo "==============================================================================" >&2
echo "  SUCCESS: All verification steps passed" >&2
echo "==============================================================================" >&2
echo "" >&2
echo "  Transcript:     SUCCESS-001-simple.json" >&2
echo "  Auditor Pack:   auditor_pack_success.zip" >&2
echo "  Verification:   ok=true" >&2
echo "  Integrity:      VALID" >&2
echo "  Fault Domain:   NO_FAULT" >&2
echo "  Approval Risk:  LOW" >&2
echo "" >&2

exit 0
