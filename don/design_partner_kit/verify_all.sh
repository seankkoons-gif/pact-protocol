#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "Don Design Partner Kit wrapper"
echo "Delegating to canonical kit: $ROOT/design_partner_bundle"
exec bash "$ROOT/design_partner_bundle/verify_all.sh" "$@"
