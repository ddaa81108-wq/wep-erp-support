$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $sourceRoot 'artifacts\installed-smoke.log'

try {
  Push-Location $sourceRoot
  & node 'tests\installed-smoke.ts' *>&1 | Tee-Object -FilePath $logPath
  if ($LASTEXITCODE -ne 0) { throw "Installed smoke test exited with code $LASTEXITCODE." }
  exit 0
} catch {
  $_ | Format-List * -Force | Out-File -LiteralPath $logPath -Append -Encoding utf8
  exit 1
} finally {
  Pop-Location
}
