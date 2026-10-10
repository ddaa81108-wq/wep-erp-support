$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$reportPath = Join-Path $projectRoot 'artifacts\installed-smoke.log'
Push-Location $projectRoot
try {
  & node.exe 'tests\installed-smoke.ts' *>&1 | Tee-Object -FilePath $reportPath
  if ($LASTEXITCODE -ne 0) { throw "Installed smoke test failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
