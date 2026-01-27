#!/bin/bash
# =============================================================================
# H5 Golden Demo: Tamper Detection Scenario (Scenario C)
# =============================================================================
#
# This script demonstrates the verifier's ability to detect sophisticated
# semantic tampering attacks where an adversary:
#   1. Modifies derived artifacts (e.g., gc_view.json)
#   2. Recomputes checksums to pass checksum verification
#   3. Re-packages the auditor pack
#
# The attack WILL pass checksum verification but WILL FAIL recompute verification.
# This proves that checksum-only verification is insufficient for sovereign proof.
#
# Exit Codes:
#   0 - Tamper was correctly detected (verification failed as expected)
#   1 - Unexpected result (tamper not detected, or other error)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VERIFIER="$REPO_ROOT/bin/pact-verifier.mjs"

SOURCE_PACK="$SCRIPT_DIR/../success/auditor_pack_success.zip"
TAMPERED_PACK="$SCRIPT_DIR/auditor_pack_semantic_tampered.zip"
WORK_DIR="$SCRIPT_DIR/.tamper_workdir"

echo "==============================================================================" >&2
echo "  H5 Golden Demo: Tamper Detection Scenario (Scenario C)" >&2
echo "==============================================================================" >&2
echo "" >&2
echo "  Attacker Model: Rogue provider modifies records after the fact" >&2
echo "  Attack Vector:  Semantic tamper with checksum recalculation" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 0: Verify source pack exists
# -----------------------------------------------------------------------------
echo "Step 0: Verifying source auditor pack exists..." >&2

if [ ! -f "$SOURCE_PACK" ]; then
    echo "ERROR: Source auditor pack not found: $SOURCE_PACK" >&2
    echo "       Run demo/h5-golden/success/run.sh first to generate it." >&2
    exit 1
fi

echo "  Source: $SOURCE_PACK" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 1: Extract auditor pack to working directory
# -----------------------------------------------------------------------------
echo "Step 1: Extracting auditor pack to working directory..." >&2

rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
unzip -q "$SOURCE_PACK" -d "$WORK_DIR"

echo "  Extracted to: $WORK_DIR" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 2: Perform semantic tamper (modify gc_view.json)
# -----------------------------------------------------------------------------
echo "Step 2: Performing semantic tamper..." >&2
echo "  Target: derived/gc_view.json" >&2
echo "  Change: executive_summary.status = 'TAMPERED_STATUS'" >&2

GC_VIEW_FILE="$WORK_DIR/derived/gc_view.json"

if [ ! -f "$GC_VIEW_FILE" ]; then
    echo "ERROR: gc_view.json not found in auditor pack" >&2
    exit 1
fi

# Use node to perform the JSON modification (maintains valid JSON)
node -e "
const fs = require('fs');
const path = '$GC_VIEW_FILE';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

// Semantic tamper: change the outcome status
const originalStatus = data.executive_summary.status;
data.executive_summary.status = 'TAMPERED_STATUS';

// Also tamper the gc_takeaways to make it more obvious
if (data.gc_takeaways) {
    data.gc_takeaways.approval_risk = 'TAMPERED';
}

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.error('  Original status: ' + originalStatus);
console.error('  Tampered status: TAMPERED_STATUS');
"

echo "" >&2

# -----------------------------------------------------------------------------
# Step 3: Recompute checksums (simulate sophisticated attacker)
# -----------------------------------------------------------------------------
echo "Step 3: Recomputing checksums (simulating sophisticated attacker)..." >&2

CHECKSUM_FILE="$WORK_DIR/checksums.sha256"

# Recompute checksums for all files except checksums.sha256 itself
cd "$WORK_DIR"
rm -f checksums.sha256
TEMP_CHECKSUMS=$(mktemp)
for file in $(find . -type f ! -name "checksums.sha256" ! -name "*.new" | sort); do
    hash=$(shasum -a 256 "$file" | cut -d' ' -f1)
    relpath=$(echo "$file" | sed 's|^\./||')
    echo "$hash  $relpath" >> "$TEMP_CHECKSUMS"
done
mv "$TEMP_CHECKSUMS" checksums.sha256
cd "$SCRIPT_DIR"

echo "  Checksums recomputed to hide tamper from checksum-only verification" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 4: Repackage tampered auditor pack
# -----------------------------------------------------------------------------
echo "Step 4: Repackaging tampered auditor pack..." >&2

rm -f "$TAMPERED_PACK"
cd "$WORK_DIR"
zip -rq "$TAMPERED_PACK" .
cd "$SCRIPT_DIR"

echo "  Created: $TAMPERED_PACK" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 5: Run verification on tampered pack
# -----------------------------------------------------------------------------
echo "Step 5: Running auditor-pack-verify on tampered pack..." >&2
echo "------------------------------------------------------------------------------" >&2

# Capture output and exit code
set +e
VERIFY_OUTPUT=$("$VERIFIER" auditor-pack-verify --zip "$TAMPERED_PACK" 2>&1)
VERIFY_EXIT=$?
set -e

echo "$VERIFY_OUTPUT"
echo "------------------------------------------------------------------------------" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 6: Analyze verification result
# -----------------------------------------------------------------------------
echo "Step 6: Analyzing verification result..." >&2

# Parse key fields from JSON output
OK_VALUE=$(echo "$VERIFY_OUTPUT" | grep -o '"ok": *[a-z]*' | head -1 | grep -o 'true\|false' || echo "unknown")
CHECKSUMS_OK=$(echo "$VERIFY_OUTPUT" | grep -o '"checksums_ok": *[a-z]*' | head -1 | grep -o 'true\|false' || echo "unknown")
RECOMPUTE_OK=$(echo "$VERIFY_OUTPUT" | grep -o '"recompute_ok": *[a-z]*' | head -1 | grep -o 'true\|false' || echo "unknown")

echo "  ok:           $OK_VALUE" >&2
echo "  checksums_ok: $CHECKSUMS_OK" >&2
echo "  recompute_ok: $RECOMPUTE_OK" >&2
echo "" >&2

# -----------------------------------------------------------------------------
# Step 7: Verify expected outcome
# -----------------------------------------------------------------------------
echo "==============================================================================" >&2

# Expected: ok=false, checksums_ok=true, recompute_ok=false
if [ "$OK_VALUE" = "false" ] && [ "$RECOMPUTE_OK" = "false" ]; then
    echo "  TAMPER DETECTED: Verification correctly failed" >&2
    echo "==============================================================================" >&2
    echo "" >&2
    echo "  Attack Summary:" >&2
    echo "    - Semantic tamper: gc_view.json status changed to 'TAMPERED_STATUS'" >&2
    echo "    - Checksums: Recomputed by attacker (checksums_ok=$CHECKSUMS_OK)" >&2
    echo "    - Recompute: FAILED - derived artifacts don't match transcript" >&2
    echo "" >&2
    echo "  Security Proof:" >&2
    echo "    - Checksum-only verification: INSUFFICIENT (would have passed)" >&2
    echo "    - Recompute verification:     SOVEREIGN PROOF (detected tamper)" >&2
    echo "" >&2
    echo "  The verifier recomputed gc_view.json from the original transcript" >&2
    echo "  and detected that the packaged version was modified." >&2
    echo "" >&2

    # -------------------------------------------------------------------------
    # Step 7: Generate Customer Message
    # -------------------------------------------------------------------------
    echo "Step 7: Generating customer experience files..." >&2

    cat > "$SCRIPT_DIR/CUSTOMER_MESSAGE.txt" << 'CUSTOMER_EOF'
VERIFICATION FAILED - TAMPERING DETECTED

The transaction record you submitted has been altered after it was
originally created. The verification system detected that derived
documents do not match what would be computed from the original
signed transcript.

RESPONSIBILITY: Unknown - tampering was detected but the responsible
party cannot be determined from the evidence alone. This could indicate
malicious modification, storage corruption, or software error.

WHAT HAPPENS NEXT: This record cannot be relied upon for dispute
resolution or claims processing. Contact support for investigation.
The original signed rounds may still have forensic value.

MONEY MOVED: Unknown - the integrity of this record is compromised
and its claims cannot be trusted without further investigation.

HOW TO VERIFY: Run the following command to confirm the tamper detection:

    pact-verifier auditor-pack-verify --zip auditor_pack_semantic_tampered.zip

Verification will show "ok": false and "recompute_ok": false.
CUSTOMER_EOF

    echo "  Generated: CUSTOMER_MESSAGE.txt" >&2

    # -------------------------------------------------------------------------
    # Step 8: Generate Insurer Message
    # -------------------------------------------------------------------------
    cat > "$SCRIPT_DIR/INSURER_MESSAGE.txt" << 'INSURER_EOF'
UNDERWRITING SUMMARY

Outcome Category: COMPROMISED (integrity failure detected)

Coverage Recommendation: EXCLUDED
  - Record integrity compromised
  - Manual investigation required

Rationale:
  • Recompute verification failed - derived artifacts do not match transcript
  • Checksum verification passed - indicates sophisticated tampering attempt
INSURER_EOF

    echo "  Generated: INSURER_MESSAGE.txt" >&2
    echo "" >&2
    
    # Cleanup
    rm -rf "$WORK_DIR"
    
    exit 0
else
    echo "  ERROR: Unexpected verification result" >&2
    echo "==============================================================================" >&2
    echo "" >&2
    echo "  Expected: ok=false, recompute_ok=false" >&2
    echo "  Got:      ok=$OK_VALUE, recompute_ok=$RECOMPUTE_OK" >&2
    echo "" >&2
    echo "  This indicates a bug in the verification logic or the tamper script." >&2
    echo "" >&2
    
    # Cleanup
    rm -rf "$WORK_DIR"
    
    exit 1
fi
