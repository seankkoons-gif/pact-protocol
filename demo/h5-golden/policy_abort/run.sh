#!/bin/bash
# =============================================================================
# H5 Golden Demo: Policy Abort Scenario (Scenario B - PACT-101)
# =============================================================================
#
# This script demonstrates the verification workflow for a negotiation that
# terminated due to policy constraint violation. The buyer's declared policy
# could not be satisfied by the provider's offer.
#
# Key Characteristics:
#   - Outcome: ABORTED_POLICY
#   - Fault Domain: BUYER_AT_FAULT
#   - Required Action: FIX_POLICY_OR_PARAMS
#   - Money Moved: FALSE (no funds at risk)
#
# Steps:
#   1. Generate an auditor pack from the transcript
#   2. Verify the auditor pack integrity
#   3. Display GC summary
#   4. Display insurer summary (underwriting view)
#
# Exit Codes:
#   0 - All verification steps passed
#   1 - One or more verification steps failed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FIXTURE="$REPO_ROOT/fixtures/failures/PACT-101-policy-violation.json"
AUDITOR_PACK="$SCRIPT_DIR/auditor_pack_101.zip"
VERIFIER="$REPO_ROOT/bin/pact-verifier.mjs"

echo "==============================================================================" >&2
echo "  H5 Golden Demo: Policy Abort Scenario (Scenario B - PACT-101)" >&2
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
# Step 4: Display Insurer Summary
# -----------------------------------------------------------------------------
echo "Step 4: Insurer Summary (Underwriting View)..." >&2
echo "------------------------------------------------------------------------------" >&2

"$VERIFIER" insurer-summary --transcript "$FIXTURE"

echo "------------------------------------------------------------------------------" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 5: Generate Customer Message
# -----------------------------------------------------------------------------
echo "Step 5: Generating customer experience files..." >&2

cat > "$SCRIPT_DIR/CUSTOMER_MESSAGE.txt" << 'CUSTOMER_EOF'
TRANSACTION ABORTED - POLICY CONSTRAINT

Your transaction was automatically terminated because the provider's offer
did not meet your pre-configured policy requirements. This is a protective
measure that prevented you from accepting terms outside your specified
constraints.

RESPONSIBILITY: The buyer's policy constraints could not be satisfied by
the available provider. This is not an error - your policy worked as
designed to protect you from unwanted terms.

WHAT HAPPENS NEXT: Review your policy settings and consider whether they
should be adjusted. You may retry with different providers or modified
policy parameters.

MONEY MOVED: No - no funds were committed or transferred. The transaction
was terminated before any financial commitment was made.

HOW TO VERIFY: Run the following command to independently verify this
transaction:

    pact-verifier auditor-pack-verify --zip auditor_pack_101.zip

A successful verification will show "ok": true in the output.
CUSTOMER_EOF

echo "  Generated: CUSTOMER_MESSAGE.txt" >&2

# -----------------------------------------------------------------------------
# Step 6: Generate Insurer Message
# -----------------------------------------------------------------------------
cat > "$SCRIPT_DIR/INSURER_MESSAGE.txt" << 'INSURER_EOF'
UNDERWRITING SUMMARY

Outcome Category: ABORTED_POLICY (policy constraint violation)

Coverage Recommendation: COVERED_WITH_SURCHARGE
  - Tier B party surcharge applies
  - Buyer passport score impacted (-0.05)

Rationale:
  • Buyer's policy constraints were unsatisfiable by provider's offer
  • No financial exposure - transaction terminated before commitment
INSURER_EOF

echo "  Generated: INSURER_MESSAGE.txt" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo "==============================================================================" >&2
echo "  POLICY ABORT: Negotiation terminated by policy constraint" >&2
echo "==============================================================================" >&2
echo "" >&2
echo "  Transcript:       PACT-101-policy-violation.json" >&2
echo "  Auditor Pack:     auditor_pack_101.zip" >&2
echo "  Verification:     ok=true" >&2
echo "" >&2
echo "  Outcome:          ABORTED_POLICY" >&2
echo "  Fault Domain:     BUYER_AT_FAULT" >&2
echo "  Required Action:  FIX_POLICY_OR_PARAMS" >&2
echo "  Approval Risk:    MEDIUM" >&2
echo "" >&2
echo "  MONEY MOVED:      FALSE" >&2
echo "  (No escrow committed, no funds transferred, no financial exposure)" >&2
echo "" >&2

exit 0
