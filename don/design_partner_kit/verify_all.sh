#!/usr/bin/env bash
set -euo pipefail

# Resolve repo root by walking up from this script's location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CANONICAL_SCRIPT="${REPO_ROOT}/design_partner_bundle/verify_all.sh"

if [[ ! -f "$CANONICAL_SCRIPT" ]]; then
  echo "Don Design Partner Kit wrapper: canonical script not found." >&2
  echo "Run design_partner_bundle/verify_all.sh from the repository root." >&2
  echo "Expected path: $CANONICAL_SCRIPT" >&2
  exit 1
fi

echo "Don Design Partner Kit wrapper"
echo "Delegating to canonical kit: /design_partner_bundle"
exec "$CANONICAL_SCRIPT" "$@"
