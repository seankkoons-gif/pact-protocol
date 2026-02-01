# Don Design Partner Kit wrapper: delegates to design_partner_bundle/verify_all.ps1
$ErrorActionPreference = 'Stop'

# Resolve repo root from this script's location (don/design_partner_kit -> repo root = two levels up)
$ScriptDir = $PSScriptRoot
$RepoRoot = Split-Path (Split-Path $ScriptDir -Parent) -Parent
$CanonicalScript = Join-Path $RepoRoot 'design_partner_bundle\verify_all.ps1'

if (-not (Test-Path -LiteralPath $CanonicalScript)) {
  Write-Error "Don Design Partner Kit wrapper: canonical script not found. The canonical Design Partner Kit currently lives at design_partner_bundle. Run design_partner_bundle\verify_all.ps1 from the repository root. Expected path: $CanonicalScript"
  exit 1
}

& $CanonicalScript @args
exit $LASTEXITCODE
